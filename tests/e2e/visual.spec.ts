import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { Game, createBot, serializeRun, type BoosterState, type RunState } from '../../src/engine';

/**
 * Vizuální kontrola (fáze 3, U5): jen fotí obrazovky do `test-results/visual/<rozlišení>/` a nic neověřuje
 * kromě čisté konzole. Ke každému snímku zapíše do `test-results/visual/report.jsonl` metriky pro ruční
 * kontrolu: horizontální přetečení stránky, uříznuté texty a (na dotykových zařízeních) malé dotykové cíle.
 *
 * Spuštění (po buildu je preview na portu 4173 — řeší playwright.config.ts):
 *   KARBAN_VISUAL=1 npx playwright test visual
 * Bez proměnné se testy přeskočí, ať běžné `npm run test:e2e` nezdržují.
 */

test.skip(!process.env.KARBAN_VISUAL, 'vizuální snímky jen s KARBAN_VISUAL=1');
test.describe.configure({ mode: 'parallel' });

const OUT = 'test-results/visual';
const SEED = 'VIZUAL01';

interface Viewport {
  name: string;
  width: number;
  height: number;
  touch?: boolean;
}

const VIEWPORTS: Viewport[] = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: 'tablet-820x1180', width: 820, height: 1180, touch: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true },
];

// ─────────────────────────── Příprava stavů přes engine ───────────────────────────

/** Odehraje run botem, dokud neplatí podmínka; vrátí kopii stavu. */
function driveTo(until: (g: Game) => boolean, seed = SEED): RunState {
  const g = Game.newRun({ deckId: 'pub', stake: 1, seed }, registry());
  const bot = createBot('max');
  for (let i = 0; i < 5000 && !until(g); i++) g.dispatch(bot.decide(g));
  if (!until(g)) throw new Error('driveTo: podmínka nesplněna');
  return structuredClone(g.state) as RunState;
}

const atShop = (g: Game) => g.state.phase === 'shop' && g.state.ante >= 2 && g.state.jokers.length >= 2;
const atRound = (g: Game) =>
  g.state.phase === 'blind_select' && g.state.ante >= 2 && g.state.jokers.length >= 2;

/** Vloží uložený run do localStorage (jen při prvním načtení stránky). */
async function seedRun(page: Page, state: RunState): Promise<void> {
  const raw = serializeRun(state, '2026-10-01T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('visual-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('visual-seeded', '1');
    }
  }, raw);
}

async function seedSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.settings')) localStorage.setItem('karban.settings', value);
  }, JSON.stringify(settings));
}

async function continueRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

// ─────────────────────────── Konzole a snímky ───────────────────────────

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function idle(page: Page): Promise<void> {
  const game = page.locator('.game');
  if ((await game.count()) > 0) await expect(game).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

/** Metriky pro ruční kontrolu (přetečení, uříznutý text, malé dotykové cíle). */
async function metrics(page: Page, touch: boolean) {
  return page.evaluate((isTouch) => {
    const doc = document.documentElement;
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const cls = (el.getAttribute('class') ?? '').split(' ')[0];
      const text = (el.textContent ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''} „${text}“`;
    };
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement) || !visible(el)) continue;
      if (!el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      const hides = (v: string) => v === 'hidden' || v === 'clip';
      if (el.classList.contains('visually-hidden')) continue;
      const overX = el.scrollWidth > el.clientWidth + 1 && hides(cs.overflowX);
      const overY = el.scrollHeight > el.clientHeight + 1 && hides(cs.overflowY);
      if ((overX || overY) && el.clientWidth > 0) clipped.push(`${label(el)} ${overX ? 'X' : ''}${overY ? 'Y' : ''}`);
    }
    // Prvky vyčnívající z okna (vodorovně).
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('#app *'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) {
        const parent = el.parentElement;
        const pr = parent?.getBoundingClientRect();
        // hlásit jen „nejvyšší“ vyčnívající prvek
        if (pr && (pr.right > innerWidth + 1 || pr.left < -1)) continue;
        outside.push(label(el));
      }
    }
    const small: string[] = [];
    if (isTouch) {
      const sel = 'button, [role="button"], [role="radio"], [role="tab"], a[href], input, select, .pcard, .kcard';
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth,
      scrollHeight: doc.scrollHeight,
      innerHeight,
      hScroll: doc.scrollWidth > innerWidth + 1,
      clipped: clipped.slice(0, 30),
      outside: outside.slice(0, 30),
      small: small.slice(0, 40),
    };
  }, touch);
}

async function shot(page: Page, vp: Viewport, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const dir = `${OUT}/${vp.name}`;
  mkdirSync(dir, { recursive: true });
  const m = await metrics(page, Boolean(vp.touch));
  appendFileSync(`${OUT}/report.jsonl`, `${JSON.stringify({ viewport: vp.name, shot: name, ...m })}\n`);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage ?? false });
}

/** Krátká pauza na doběhnutí CSS přechodů (vstupní animace panelů). */
const settle = (page: Page, ms = 450) => page.waitForTimeout(ms);

// ─────────────────────────── Snímky ───────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: Boolean(vp.touch) });

    test('menu, nová hra, nastavení, titulky, galerie', async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto('/');
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
      await settle(page);
      await shot(page, vp, '01-menu');
      await shot(page, vp, '01-menu-full', { fullPage: true });

      await page.getByTestId('menu-new-game').click();
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
      await settle(page);
      await shot(page, vp, '02-new-game');
      await shot(page, vp, '02-new-game-full', { fullPage: true });

      await page.goto('/');
      await page.getByTestId('menu-settings').click();
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');
      await settle(page);
      await shot(page, vp, '03-settings');
      await shot(page, vp, '03-settings-full', { fullPage: true });

      await page.goto('/');
      await page.getByTestId('menu-credits').click();
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'credits');
      await settle(page, 900);
      await shot(page, vp, '04-credits');

      await page.goto('/#gallery');
      await expect(page.getByTestId('gallery')).toBeVisible();
      await settle(page);
      await shot(page, vp, '05-gallery');
      await shot(page, vp, '05-gallery-full', { fullPage: true });
      expect(problems).toEqual([]);
    });

    test('výběr útraty, kolo s výběrem, skórování, Info o runu, pauza', async ({ page }) => {
      const problems = watchConsole(page);
      await seedRun(page, driveTo(atRound));
      await continueRun(page);
      await settle(page);
      await shot(page, vp, '06-blind-select');

      await page.getByTestId('blind-select-small').click();
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'round');
      await idle(page);
      await settle(page, 300);
      await shot(page, vp, '07-round');

      // Vybrat nejlepší dvojici (nebo první tři karty) a ukázat živý náhled.
      const cards = page.getByTestId('hand').locator('.pcard');
      const n = await cards.count();
      for (let i = 0; i < Math.min(3, n); i++) await cards.nth(i).click();
      await settle(page, 250);
      await shot(page, vp, '08-round-selected');

      await page.getByTestId('play').click();
      await page.waitForTimeout(900);
      await shot(page, vp, '09-scoring');
      await idle(page);
      await settle(page, 300);
      await shot(page, vp, '10-after-play');

      await page.getByTestId('run-info').click();
      await expect(page.getByTestId('run-info-modal')).toBeVisible();
      await settle(page);
      await shot(page, vp, '11-run-info');
      await page.keyboard.press('Escape');

      await page.getByTestId('deck').click();
      await expect(page.getByTestId('deck-modal')).toBeVisible();
      await settle(page);
      await shot(page, vp, '12-deck');
      await page.keyboard.press('Escape');

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('pause-modal')).toBeVisible();
      await settle(page);
      await shot(page, vp, '13-pause');
      await page.keyboard.press('Escape');

      await page.getByTestId('joker-row').locator('.kcard').first().click();
      await expect(page.getByTestId('joker-detail')).toBeVisible();
      await settle(page);
      await shot(page, vp, '14-joker-detail');
      expect(problems).toEqual([]);
    });

    test('konec kola', async ({ page }) => {
      const problems = watchConsole(page);
      await seedRun(
        page,
        driveTo((g) => g.state.phase === 'round_end' && g.state.ante >= 2),
      );
      await continueRun(page);
      await settle(page, 1500);
      await shot(page, vp, '15-round-end');
      expect(problems).toEqual([]);
    });

    test('Večerka s položkami', async ({ page }) => {
      const problems = watchConsole(page);
      const s = driveTo(atShop);
      s.money = 30;
      await seedRun(page, s);
      await continueRun(page);
      await settle(page);
      await shot(page, vp, '16-shop');
      await shot(page, vp, '16-shop-full', { fullPage: true });
      expect(problems).toEqual([]);
    });

    test('Večerka prázdná', async ({ page }) => {
      const problems = watchConsole(page);
      const s = driveTo(atShop);
      for (const it of s.shop?.items ?? []) it.sold = true;
      for (const b of s.shop?.boosters ?? []) b.sold = true;
      for (const v of s.shop?.vouchers ?? []) v.sold = true;
      s.money = 3;
      await seedRun(page, s);
      await continueRun(page);
      await settle(page);
      await shot(page, vp, '18-shop-empty');
      expect(problems).toEqual([]);
    });

    for (const withHand of [false, true]) {
      test(`obálka${withHand ? ' s dobranou rukou' : ''}`, async ({ page }) => {
        const problems = watchConsole(page);
        const reg = registry();
        const s = driveTo(atShop);
        // Obálky v registru zatím nejsou (fáze 5) — stav obálky se sestaví ručně: žolíci + hrací karty.
        const boosterId = Object.keys(reg.boosters)[0] ?? 'visual_pack';
        const jokerIds = Object.keys(reg.jokers).filter((id) => !s.jokers.some((j) => j.defId === id));
        let uid = s.nextUid;
        const options: BoosterState['options'] = [
          ...jokerIds.slice(0, 3).map((defId, i) => ({
            kind: 'joker' as const,
            joker: {
              uid: uid++,
              defId,
              edition: i === 1 ? ('foil' as const) : null,
              state: {},
              sellBonus: 0,
              stickers: [],
              debuffed: false,
            },
          })),
          ...s.deck.slice(0, 2).map((card) => ({ kind: 'card' as const, card: { ...card, id: uid++ } })),
        ];
        s.nextUid = uid;
        s.booster = {
          boosterId,
          options,
          picksLeft: 1,
          hand: withHand ? s.deck.slice(10, 18).map((c) => c.id) : [],
          returnTo: 'shop',
        };
        s.phase = 'booster';
        await seedRun(page, s);
        await continueRun(page);
        await settle(page);
        await shot(page, vp, withHand ? '19-booster-hand' : '17-booster');
        expect(problems).toEqual([]);
      });
    }

    test('pitva a výhra', async ({ page }) => {
      const problems = watchConsole(page);
      const s = driveTo((g) => g.state.phase === 'round' && g.state.ante >= 2 && g.state.jokers.length >= 2);
      const round = s.round!;
      round.handsLeft = 1;
      round.target = 1e9;
      await seedRun(page, s);
      await continueRun(page);
      await page.getByTestId('hand').locator('.pcard').first().click();
      await page.getByTestId('play').click();
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'game_over', { timeout: 30_000 });
      await idle(page);
      await settle(page, 800);
      await shot(page, vp, '20-game-over');
      await shot(page, vp, '20-game-over-full', { fullPage: true });
      expect(problems).toEqual([]);
    });

    test('výhra', async ({ page }) => {
      const problems = watchConsole(page);
      const s = driveTo((g) => g.state.phase === 'round' && g.state.ante >= 2 && g.state.jokers.length >= 2);
      const finalBoss = Object.values(registry().bosses).find((b) => b.final);
      s.ante = 8;
      s.blindIndex = 2;
      s.blinds.forEach((b, i) => (b.status = i < 2 ? 'defeated' : 'current'));
      if (finalBoss) s.blinds[2]!.bossId = finalBoss.id;
      const round = s.round!;
      round.blind = 'boss';
      round.bossId = finalBoss?.id ?? null;
      round.target = 10;
      s.stats.roundsWon = 23;
      s.stats.handsPlayed = 61;
      s.stats.bestHandScore = 1_340_000;
      await seedRun(page, s);
      await continueRun(page);
      await settle(page, 300);
      await shot(page, vp, '21-final-boss-round');
      await page.getByTestId('hand').locator('.pcard').first().click();
      await page.getByTestId('play').click();
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'victory', { timeout: 30_000 });
      await idle(page);
      await settle(page, 1200);
      await shot(page, vp, '22-victory');
      await shot(page, vp, '22-victory-full', { fullPage: true });
      expect(problems).toEqual([]);
    });

    test('barvoslepý režim a velikost UI 140 %', async ({ page }) => {
      const problems = watchConsole(page);
      await seedSettings(page, { colorblind: true, uiScale: 1.4 });
      await seedRun(page, driveTo(atRound));
      await continueRun(page);
      await page.getByTestId('blind-select-small').click();
      await idle(page);
      const cards = page.getByTestId('hand').locator('.pcard');
      await cards.nth(0).click();
      await cards.nth(1).click();
      await settle(page, 300);
      await shot(page, vp, '23-colorblind-ui140');
      await page.goto('/');
      await settle(page);
      await shot(page, vp, '24-menu-ui140');
      expect(problems).toEqual([]);
    });

    test('barvoslepý režim 100 %', async ({ page }) => {
      const problems = watchConsole(page);
      await seedSettings(page, { colorblind: true });
      await seedRun(page, driveTo(atRound));
      await continueRun(page);
      await page.getByTestId('blind-select-small').click();
      await idle(page);
      await settle(page, 300);
      await shot(page, vp, '25-colorblind');
      expect(problems).toEqual([]);
    });
  });
}
