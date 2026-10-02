import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Game, type JokerInstance, type Rank, type RunState } from '../../src/engine';
import {
  REG,
  continueRun,
  expectCleanConsole,
  finalBossState,
  idle,
  newState,
  presetSettings,
  seedSavedRun,
  selectByKeys,
  shopState,
  snapshot,
  watchConsole,
} from './helpers';

/**
 * „Šťáva“ (fáze 9, DESIGN 13.6) v prohlížeči — viewport 1366 × 768:
 *  1. velké skóre se spoustou kroků (5 žolíků, Královská postupka v ♥ s vylepšeními, ocelové karty v ruce):
 *     bubliny ×mult, obří zlatá bublina, záblesk, částice opravdu nakreslené na plátně, screen shake jen přes
 *     `transform` na `.game-main` a po doznění zpět; konzole čistá,
 *  2. vypnuté animace: nic z toho (žádné bubliny, záblesk, částice ani shake),
 *  3. přechod obrazovek: s animacemi se na nové obrazovce přehraje (Web Animations), bez nich ne.
 *
 * S `KARBAN_JUICE=1` navíc snímky uprostřed animací do `test-results/phase9/` (velké skóre, jiskry ×mult,
 * konfety výhry, náklon karty) a měření délky snímků (rAF) během skórování — medián / 95. percentil a počet
 * přepočtů layoutu (CDP `Performance.getMetrics`) na snímek:
 *   KARBAN_JUICE=1 npx playwright test juice            (KARBAN_JUICE_MUTE=1 = měření bez zvuku)
 */

const OUT = process.env.KARBAN_JUICE_OUT ?? 'test-results/phase9';

function joker(uid: number, defId: string): JokerInstance {
  if (!REG.jokers[defId]) throw new Error(`Neznámý žolík ${defId}`);
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

/**
 * Kolo s pěti žolíky (+čipy, +mult na ♥, ×mult) a rukou, ve které je Královská postupka v ♥ (vylepšení, edice,
 * pečeť → hodně kroků) a tři ocelové karty (×mult v ruce). Vrací stav a karty k zahrání.
 */
function juiceState(seed: string): { state: RunState; play: number[] } {
  const s = newState(seed);
  s.jokers = [
    joker(901, 'beer_mat'),
    joker(902, 'hearts_man'),
    joker(903, 'pe_teacher'),
    joker(904, 'innkeeper'),
    joker(905, 'snowman'),
  ];
  const g = Game.fromState(s, REG);
  const res = g.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl výběr útraty: ${res.error}`);
  const state = snapshot(g);
  const hand = state.round!.hand;
  const ranks: Rank[] = [10, 11, 12, 13, 14];
  hand.forEach((id, i) => {
    const card = state.deck.find((c) => c.id === id)!;
    if (i < 5) {
      card.suit = 'H';
      card.rank = ranks[i]!;
      card.enhancement = i === 1 ? 'mult' : i === 3 ? 'bonus' : null;
      card.edition = i === 2 ? 'foil' : i === 4 ? 'holo' : null;
      card.seal = i === 0 ? 'red' : null;
    } else {
      card.suit = 'S';
      card.rank = (2 + i) as Rank;
      card.enhancement = 'steel';
      card.seal = null;
      card.edition = null;
    }
  });
  return { state, play: hand.slice(0, 5) };
}

/**
 * Záznam „šťávy“ ve stránce: třídy přidaných prvků (bubliny, záblesk), největší počet nakreslených pixelů na
 * plátně částic a jestli `.game-main` dostal `transform` (screen shake).
 */
async function recordJuice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __juice: { classes: string[]; painted: number; shook: boolean; shakeOther: boolean };
    };
    const rec = { classes: [] as string[], painted: 0, shook: false, shakeOther: false };
    w.__juice = rec;
    const canvas = document.querySelector<HTMLCanvasElement>('#fx')!;
    // Kopie plátna do pomocného plátna pro čtení (čtení z plátna hry by zpomalovalo a varovalo v konzoli).
    const probe = document.createElement('canvas');
    const sample = (): void => {
      if (!canvas.width || !canvas.height) return;
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, probe.width, probe.height);
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 16) if (data[i]) n++;
      rec.painted = Math.max(rec.painted, n);
    };
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') {
          const el = m.target as HTMLElement;
          if (!el.style.transform) continue;
          if (el.classList.contains('game-main')) rec.shook = true;
          else if (el.closest('.game') && !el.closest('.game-main')) rec.shakeOther = true;
          continue;
        }
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          for (const cls of node.classList) if (!rec.classes.includes(cls)) rec.classes.push(cls);
          if (node.classList.contains('game-bubble--xmult') || node.classList.contains('game-bubble--huge'))
            requestAnimationFrame(() => requestAnimationFrame(sample));
        }
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  });
}

async function juiceRecord(
  page: Page,
): Promise<{ classes: string[]; painted: number; shook: boolean; shakeOther: boolean }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __juice: { classes: string[]; painted: number; shook: boolean; shakeOther: boolean };
        }
      ).__juice,
  );
}

async function playJuiceHand(page: Page, state: RunState, play: number[]): Promise<void> {
  await selectByKeys(page, state.round!.hand, play);
  await page.keyboard.press('Enter');
}

test('velké skóre: bubliny ×mult, obří bublina, záblesk, částice na plátně, shake jen hlavní části', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { speed: 2, screenShake: true });
  const { state, play } = juiceState('JUICE01');
  await seedSavedRun(page, state);
  await continueRun(page);
  await recordJuice(page);
  await playJuiceHand(page, state, play);
  await page.locator('.game-bubble--huge').waitFor({ state: 'attached' });
  await idle(page);
  const rec = await juiceRecord(page);
  for (const cls of [
    'game-bubble--chips',
    'game-bubble--mult',
    'game-bubble--xmult',
    'game-bubble--huge',
    'game-flash',
  ])
    expect(rec.classes, cls).toContain(cls);
  expect(rec.painted, 'částice nakreslené na plátně').toBeGreaterThan(0);
  expect(rec.shook, 'screen shake na .game-main').toBe(true);
  expect(rec.shakeOther, 'shake nesmí hýbat levým panelem').toBe(false);
  // Po doznění je obal zpět bez transformace.
  await expect
    .poll(() => page.locator('.game-main').evaluate((el) => (el as HTMLElement).style.transform))
    .toBe('');
  const canvas = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#fx')!;
    return {
      w: c.width,
      h: c.height,
      dpr: Math.min(2, devicePixelRatio || 1),
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  expect(canvas.w).toBe(Math.round(canvas.vw * canvas.dpr));
  expect(canvas.h).toBe(Math.round(canvas.vh * canvas.dpr));
  expectCleanConsole(log);
});

test('vypnuté animace: žádné bubliny, záblesk, částice ani shake', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const { state, play } = juiceState('JUICE02');
  await seedSavedRun(page, state);
  await continueRun(page);
  await recordJuice(page);
  await playJuiceHand(page, state, play);
  await idle(page);
  const rec = await juiceRecord(page);
  expect(rec.classes.filter((c) => c.startsWith('game-bubble') || c === 'game-flash')).toEqual([]);
  expect(rec.painted).toBe(0);
  expect(rec.shook).toBe(false);
  expectCleanConsole(log);
});

test('přechod obrazovek: s animacemi se přehraje, bez nich ne; focus zůstává', async ({ browser }) => {
  for (const animations of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const log = watchConsole(page);
    await page.addInitScript((anim) => {
      localStorage.setItem('karban.settings', JSON.stringify({ animations: anim }));
      // Zaznamená Web Animations na kořeni obrazovek (#app > *).
      const calls: string[] = [];
      (window as unknown as { __screenAnims: string[] }).__screenAnims = calls;
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
        if (this.parentElement?.id === 'app') calls.push(this.getAttribute('data-testid') ?? this.tagName);
        return orig.apply(this, args);
      };
    }, animations);
    await page.goto('/?tutorial=off');
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
    await page.getByTestId('menu-settings').click();
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');
    // Focus je uvnitř nové obrazovky hned (router je synchronní).
    expect(await page.evaluate(() => document.querySelector('#app')!.contains(document.activeElement))).toBe(
      true,
    );
    const calls = await page.evaluate(() => (window as unknown as { __screenAnims: string[] }).__screenAnims);
    if (animations) expect(calls.length).toBeGreaterThanOrEqual(1);
    else expect(calls).toEqual([]);
    expectCleanConsole(log);
    await context.close();
  }
});

// ─────────────────────────── Snímky a výkon (KARBAN_JUICE=1) ───────────────────────────

test.describe('snímky a výkon', () => {
  test.skip(!process.env.KARBAN_JUICE, 'snímky a měření jen s KARBAN_JUICE=1');
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('snímky uprostřed animací: jiskry ×mult, velké skóre, náklon karty', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { speed: 1 });
    const { state, play } = juiceState('JUICE03');
    await seedSavedRun(page, state);
    await continueRun(page);
    // Náklon a odlesk: myš u pravého horního rohu karty.
    const card = page.getByTestId('hand').locator('.pcard').nth(2);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2);
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.15, { steps: 4 });
    await page.waitForTimeout(250);
    await page.getByTestId('hand').screenshot({ path: `${OUT}/hover-tilt.png` });
    await page.mouse.move(5, 5);

    await playJuiceHand(page, state, play);
    await page.locator('.game-bubble--xmult').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(70);
    await page.screenshot({ path: `${OUT}/xmult-sparks.png` });
    await page.locator('.game-bubble--huge').waitFor({ state: 'attached' });
    await page.waitForTimeout(160);
    await page.screenshot({ path: `${OUT}/big-score.png` });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/big-score-late.png` });
    await idle(page);
    expectCleanConsole(log);
  });

  test('snímek: Večerka při najetí (zboží se nadzvedne, žolík zakolébá)', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { speed: 1 });
    const offer = joker(950, 'snowman');
    await seedSavedRun(
      page,
      shopState('JUICESHOP', 20, {
        items: [
          { kind: 'joker', joker: offer, price: 8, sold: false },
          { kind: 'joker', joker: joker(951, 'beer_mat'), price: 4, sold: false },
        ],
      }),
    );
    await continueRun(page);
    await expect(page.locator('.game')).toHaveAttribute('data-phase', 'shop');
    const slot = page.locator('.shop-slot--joker').first();
    await slot.locator('.kcard').hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(180);
    await page.getByTestId('shop').screenshot({ path: `${OUT}/shop-hover.png` });
    await page.mouse.move(5, 5);
    expectCleanConsole(log);
  });

  test('snímek: konfety výhry', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { speed: 1 });
    const { state, play } = finalBossState('JUICEWIN');
    await seedSavedRun(page, state);
    await continueRun(page);
    await selectByKeys(page, state.round!.hand, play);
    await page.keyboard.press('Enter');
    await page.getByTestId('victory').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(380);
    await page.screenshot({ path: `${OUT}/victory-confetti.png` });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/victory-confetti-late.png` });
    await idle(page);
    expectCleanConsole(log);
  });

  test('výkon: délka snímků během skórování (medián, 95. percentil) a přepočty layoutu', async ({ page }) => {
    const log = watchConsole(page);
    // KARBAN_JUICE_MUTE=1: měření bez zvuku (porovnání ceny syntézy zvuku).
    await presetSettings(page, process.env.KARBAN_JUICE_MUTE ? { speed: 1, muted: true } : { speed: 1 });
    const { state, play } = juiceState('JUICE04');
    await seedSavedRun(page, state);
    await continueRun(page);
    await selectByKeys(page, state.round!.hand, play);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async (): Promise<Record<string, number>> => {
      const { metrics } = (await cdp.send('Performance.getMetrics')) as {
        metrics: { name: string; value: number }[];
      };
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    };
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __sampling: boolean; __long: number[] };
      w.__frames = [];
      w.__long = [];
      w.__sampling = true;
      let last = performance.now();
      const loop = (t: number): void => {
        w.__frames.push(t - last);
        last = t;
        if (w.__sampling) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__long.push(e.duration);
        }).observe({ type: 'longtask', buffered: false });
      } catch {
        // longtask nemusí být k dispozici
      }
    });
    const before = await metric();
    await page.keyboard.press('Enter');
    await page.locator('.game-bubble--huge').waitFor({ state: 'attached' });
    await idle(page);
    const after = await metric();
    const { frames, long } = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __sampling: boolean; __long: number[] };
      w.__sampling = false;
      return { frames: w.__frames.slice(1), long: w.__long };
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    const layouts = (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0);
    const styles = (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0);
    const report = {
      frames: frames.length,
      medianMs: Number(pct(0.5).toFixed(2)),
      p95Ms: Number(pct(0.95).toFixed(2)),
      maxMs: Number(sorted[sorted.length - 1]!.toFixed(2)),
      over20ms: frames.filter((f) => f > 20).length,
      longTasks: long.length,
      layoutCount: layouts,
      layoutsPerFrame: Number((layouts / Math.max(1, frames.length)).toFixed(3)),
      recalcStyleCount: styles,
      layoutMs: Number((((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000).toFixed(1)),
      scriptMs: Number((((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000).toFixed(1)),
    };
    console.log(`[juice-perf] ${JSON.stringify(report)}`);
    test.info().annotations.push({ type: 'juice-perf', description: JSON.stringify(report) });
    expect(frames.length).toBeGreaterThan(30);
    // 60 fps: medián ~16,7 ms; 95. percentil pod 2 snímky.
    expect(report.medianMs).toBeLessThan(20);
    expect(report.p95Ms).toBeLessThan(34);
    // Žádný layout thrashing: nejvýš pár přepočtů layoutu na snímek (měření prvků před zápisy).
    expect(report.layoutsPerFrame).toBeLessThan(2);
    expectCleanConsole(log);
  });
});
