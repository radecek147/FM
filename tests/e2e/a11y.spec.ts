import { expect, test, type Locator, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { Game, createBot, serializeRun, type JokerInstance, type RunState } from '../../src/engine';

/**
 * Přístupnost a ovládání klávesnicí (CLAUDE.md kap. 4, DESIGN 13.3) na všech obrazovkách a fázích hry:
 *  - každý ovládací prvek (tlačítko, odkaz, pole, `role="button|radio|img"`) má přístupný název,
 *  - Tab prochází jen viditelné prvky a každý zaměřený prvek má viditelný focus (outline nebo stín),
 *  - modální dialogy drží focus uvnitř (Tab i Shift+Tab) a Esc focus vrátí,
 *  - konzole bez chyb a varování.
 * Stavy fází (konec kola, Večerka, obálka, pitva, výhra) připraví engine v Node a vloží je jako uložený run.
 */

// ─────────────────────────── Pomocníci ───────────────────────────

interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], warnings: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.errors.push(`console: ${msg.text()}`);
    if (msg.type() === 'warning') log.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => log.errors.push(`pageerror: ${err.message}`));
  return log;
}

function expectCleanConsole(log: ConsoleLog): void {
  expect(log.errors).toEqual([]);
  expect(log.warnings).toEqual([]);
}

const game = (page: Page) => page.locator('.game');

async function idle(page: Page): Promise<void> {
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

/** Vypnuté animace — audit se týká struktury, ne pohybu. */
async function presetSettings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem('karban.settings'))
      localStorage.setItem('karban.settings', JSON.stringify({ animations: false }));
  });
}

async function seedSavedRun(page: Page, state: RunState): Promise<void> {
  const raw = serializeRun(state, '2026-10-01T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('karban-a11y-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('karban-a11y-seeded', '1');
    }
  }, raw);
}

async function continueRun(page: Page): Promise<void> {
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

function engineRun(seed: string): Game {
  return Game.newRun({ deckId: 'pub', stake: 1, seed }, registry());
}

function snapshot(g: Game): RunState {
  return structuredClone(g.state) as RunState;
}

function joker(uid: number, defId: string): JokerInstance {
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

/**
 * Ovládací prvky bez přístupného názvu (zjednodušený výpočet accname: aria-labelledby → aria-label →
 * popisek pole → text bez aria-hidden → title). Prvky uvnitř `inert` / `aria-hidden` a skryté se přeskočí.
 */
async function unnamedControls(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [`scope ${sel} neexistuje`];
    const visibleText = (el: Element): string => {
      let out = '';
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
        else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true') {
          out += n.getAttribute('aria-label') ?? visibleText(n);
        }
      }
      return out;
    };
    const name = (el: HTMLElement): string => {
      const by = el.getAttribute('aria-labelledby');
      if (by)
        return by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      const label = el.getAttribute('aria-label');
      if (label?.trim()) return label.trim();
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        const l = [...(el.labels ?? [])].map((x) => x.textContent ?? '').join(' ');
        if (l.trim()) return l.trim();
      }
      const text = visibleText(el).trim();
      if (text) return text;
      return el.getAttribute('title')?.trim() ?? '';
    };
    const sels =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="img"], [role="dialog"], [tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(sels)) {
      if (el.closest('[inert], [aria-hidden="true"]')) continue;
      if (el.getClientRects().length === 0) continue;
      // Klávesnicí nedosažitelné kontejnery role=img uvnitř pojmenovaného tlačítka nevadí.
      if (el.getAttribute('role') === 'img' && el.parentElement?.closest('button, [role="button"]')) continue;
      if (!name(el)) {
        const id = el.dataset.testid ?? el.id ?? '';
        out.push(`<${el.tagName.toLowerCase()} class="${el.className}"${id ? ` #${id}` : ''}>`);
      }
    }
    return out;
  }, scope);
}

interface FocusInfo {
  desc: string;
  visible: boolean;
  ring: boolean;
  inDialog: boolean;
}

async function focusInfo(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    // Vzhled prvku (a u vizuálně skrytého inputu i jeho sousedního „obrazu“) se focusem musí změnit.
    const look = (): string => {
      const parts: string[] = [];
      for (const n of [el, el instanceof HTMLInputElement ? el.nextElementSibling : null]) {
        if (!n) continue;
        const cs = getComputedStyle(n);
        parts.push(
          cs.outlineStyle,
          cs.outlineWidth,
          cs.outlineColor,
          cs.boxShadow,
          cs.borderColor,
          cs.backgroundColor,
          cs.transform,
        );
      }
      return parts.join('|');
    };
    const focused = look();
    const hasRing = el.matches(':focus-visible');
    el.blur();
    const blurred = look();
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const id = el.dataset.testid ?? el.id ?? '';
    return {
      desc: `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"${id ? ` #${id}` : ''}>`,
      visible: r.width > 0 && r.height > 0,
      ring: hasRing && focused !== blurred,
      inDialog: !!el.closest('[role="dialog"]'),
    };
  });
}

/** Projde Tabem `n` kroků; vrátí problémy (neviditelný prvek nebo chybějící focus). */
async function tabWalk(page: Page, n: number, opts: { dialog?: boolean; shift?: boolean } = {}) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(opts.shift ? 'Shift+Tab' : 'Tab');
    const f = await focusInfo(page);
    if (!f) {
      if (opts.dialog) problems.push(`krok ${i}: focus utekl na <body>`);
      continue;
    }
    seen.add(f.desc);
    if (!f.visible) problems.push(`krok ${i}: neviditelný prvek ${f.desc}`);
    if (!f.ring) problems.push(`krok ${i}: bez viditelného focusu ${f.desc}`);
    if (opts.dialog && !f.inDialog) problems.push(`krok ${i}: focus mimo dialog ${f.desc}`);
  }
  return { problems: [...new Set(problems)], seen: seen.size };
}

/** Kompletní kontrola jedné obrazovky / fáze. */
/** Odkazy aria-labelledby / aria-describedby / aria-controls, jejichž id na stránce chybí. */
async function danglingAriaRefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) out.push(`${attr}="${id}" na <${el.tagName.toLowerCase()}>`);
        }
      }
    }
    return out;
  });
}

async function audit(page: Page, label: string, tabs = 30): Promise<void> {
  expect(await unnamedControls(page), `${label}: prvky bez přístupného názvu`).toEqual([]);
  expect(await danglingAriaRefs(page), `${label}: neplatné odkazy aria-*`).toEqual([]);
  // Focus začne od začátku dokumentu.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const walk = await tabWalk(page, tabs);
  expect(walk.problems, `${label}: Tab`).toEqual([]);
  expect(walk.seen, `${label}: Tab musí něco zaměřit`).toBeGreaterThan(0);
}

/**
 * Dialog otevřený klávesou Enter z `opener`: názvy, Tab i Shift+Tab zůstávají uvnitř, Esc zavře a vrátí
 * focus na `opener`.
 */
async function auditDialog(page: Page, label: string, testId: string, opener: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId(testId);
  await expect(dlg).toBeVisible();
  expect(await unnamedControls(page, `[data-testid="${testId}"]`), `${label}: bez názvu`).toEqual([]);
  expect(await danglingAriaRefs(page), `${label}: neplatné odkazy aria-*`).toEqual([]);
  const fwd = await tabWalk(page, 14, { dialog: true });
  expect(fwd.problems, `${label}: Tab v dialogu`).toEqual([]);
  const back = await tabWalk(page, 14, { dialog: true, shift: true });
  expect(back.problems, `${label}: Shift+Tab v dialogu`).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();
}

// ─────────────────────────── Stavy fází ───────────────────────────

/** Vyhrané kolo (rozpis odměn): poslední bod do cíle doplní jakákoli karta. */
function roundEndState(seed: string): RunState {
  const g = engineRun(seed);
  g.dispatch({ type: 'selectBlind' });
  const s = snapshot(g);
  s.round!.score = s.round!.target - 1;
  const g2 = Game.fromState(s, registry());
  const res = g2.dispatch({ type: 'play', cardIds: [s.round!.hand[0]!] });
  if (!res.ok || g2.state.phase !== 'round_end') throw new Error('roundEndState: kolo nevyhráno');
  return snapshot(g2);
}

/** Večerka s žolíkem v nabídce, žolíkem v řadě a vygenerovanými obálkami a kupónem. */
function shopState(seed: string): RunState {
  const g = Game.fromState(roundEndState(seed), registry());
  g.dispatch({ type: 'cashOut' });
  const s = snapshot(g);
  const defs = Object.keys(registry().jokers);
  s.money = 40;
  if (defs[0] && defs[1]) {
    s.jokers = [joker(901, defs[1])];
    s.shop!.items[0] = { kind: 'joker', joker: joker(900, defs[0]), price: 4, sold: false };
  }
  return s;
}

/** Otevřená obálka (první obálka z Večerky). */
function boosterState(seed: string): RunState | null {
  const s = shopState(seed);
  if ((s.shop?.boosters.length ?? 0) === 0) return null;
  const g = Game.fromState(s, registry());
  const res = g.dispatch({ type: 'buyBooster', slot: 0 });
  if (!res.ok || g.state.phase !== 'booster') return null;
  return snapshot(g);
}

/** Kolo s poslední rukou — jedna karta cíl nesplní, run skončí pitvou. */
function lastHandState(seed: string): RunState {
  const g = engineRun(seed);
  g.dispatch({ type: 'selectBlind' });
  const s = snapshot(g);
  s.round!.handsLeft = 1;
  return s;
}

/** Šéf 8. patra s chybějícím bodem — vrátí stav a ruku, která run vyhraje. */
function finalBossState(seed: string): { state: RunState; play: number[] } {
  const s = snapshot(engineRun(seed));
  s.ante = 8;
  s.blindIndex = 2;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  const boss = Game.fromState(s, registry());
  boss.dispatch({ type: 'selectBlind' });
  const state = snapshot(boss);
  state.round!.score = state.round!.target - 1;
  const botPlay = createBot('max').decide(Game.fromState(structuredClone(state), registry()));
  const candidates = state.round!.hand.map((id) => [id]);
  if (botPlay.type === 'play') candidates.push(botPlay.cardIds);
  for (const ids of candidates) {
    const trial = Game.fromState(structuredClone(state), registry());
    trial.dispatch({ type: 'play', cardIds: ids });
    if (trial.state.phase === 'victory') return { state, play: ids };
  }
  throw new Error('finalBossState: žádná ruka nevyhrává');
}

// ─────────────────────────── Testy ───────────────────────────

test('menu, nová hra, nastavení a titulky: názvy prvků a viditelný focus', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page);
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('menu-new-game')).toBeVisible();
  await audit(page, 'menu', 16);

  await page.getByTestId('menu-new-game').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  await audit(page, 'nová hra', 20);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');

  await page.getByTestId('menu-settings').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');
  await audit(page, 'nastavení', 40);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');

  await page.getByTestId('menu-credits').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'credits');
  await audit(page, 'titulky', 12);
  expectCleanConsole(log);
});

test('hra: výběr útraty, kolo, dialogy (Info o runu, balíček, pauza) — názvy, Tab, focus trap', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page);
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('seed-input').fill('AXYAXY22');
  await page.getByTestId('newgame-start').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await audit(page, 'výběr útraty');

  await page.getByTestId('blind-select-small').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  for (const key of ['1', '2']) await page.keyboard.press(key);
  await audit(page, 'kolo', 30);

  await auditDialog(page, 'Info o runu', 'run-info-modal', page.getByTestId('run-info'));
  await auditDialog(page, 'náhled balíčku', 'deck-modal', page.getByTestId('deck'));
  await auditDialog(page, 'pauza', 'pause-modal', page.getByTestId('game-menu'));

  // Esc mimo dialog otevře pauzu (DESIGN 13.3), druhý Esc ji zavře.
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);
  expectCleanConsole(log);
});

test('hra: konec kola → Vyplatit → Večerka — názvy a Tab', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page);

  await seedSavedRun(page, roundEndState('A11YKONEC'));
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round_end');
  await audit(page, 'konec kola', 14);

  await page.getByTestId('cash-out').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await idle(page);
  await audit(page, 'Večerka (po kole)', 24);
  expectCleanConsole(log);
});

test('hra: Večerka se žolíky a detail žolíka (focus trap)', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page);
  await seedSavedRun(page, shopState('A11YSHOP'));
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await audit(page, 'Večerka', 24);
  const row = page.getByTestId('joker-row');
  if ((await row.locator('.kcard').count()) > 0) {
    await auditDialog(page, 'detail žolíka', 'joker-detail', row.locator('.kcard').first());
  }
  expectCleanConsole(log);
});

test('hra: výběr z obálky', async ({ page }) => {
  const state = boosterState('A11YOBAL');
  test.skip(state === null, 'Večerka nemá obálku');
  const log = watchConsole(page);
  await presetSettings(page);
  await seedSavedRun(page, state!);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  await audit(page, 'obálka', 24);
  expectCleanConsole(log);
});

test('hra: pitva — názvy a Tab', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page);
  // Pitva se neukládá (run po prohře zmizí), proto ji vyvolá poslední ruka uloženého kola.
  await seedSavedRun(page, lastHandState('A11YPITVA'));
  await continueRun(page);
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over');
  await idle(page);
  await audit(page, 'pitva', 12);
  expectCleanConsole(log);
});

test('hra: výhra — názvy a Tab', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page);
  const { state, play } = finalBossState('A11YVYHRA');
  await seedSavedRun(page, state);
  await continueRun(page);
  const hand = state.round!.hand;
  for (const id of play) await page.keyboard.press(String(hand.indexOf(id) + 1));
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'victory');
  await idle(page);
  await audit(page, 'výhra', 12);
  expectCleanConsole(log);
});
