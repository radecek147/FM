import { expect, test, type Locator, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import {
  Game,
  createBot,
  deserializeRun,
  serializeRun,
  type Action,
  type JokerInstance,
  type RunState,
} from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { formatMoney, formatNumber } from '../../src/i18n/format';

/**
 * Herní obrazovka (fáze 3, U4) — viewport 1366×768 (playwright.config.ts):
 *  1. kolo klávesnicí od výběru útraty po výhru (Vyplatit → Večerka → Pokračovat) nebo pitvu,
 *  2. autosave: reload → menu → Pokračovat → stejný stav,
 *  3. přeskočení Malé (a Velké) útraty,
 *  4. Info o runu, Nastavení a pauza ze hry (Esc zavírá, klávesy neprosakují pod dialog),
 *  5. myš (klik vybere / zruší, limit výběru, Zahrát, Zahodit, třídění, náhled balíčku),
 *  6. dotyk (tap vybere kartu, tap na Zahrát),
 *  7. fáze připravené uloženým runem z enginu: Večerka, pitva, výhra → Nekonečný režim.
 * Ve všech testech: konzole bez chyb a varování. Snímky klíčových obrazovek do test-results/.
 */

// ─────────────────────────── Konzole ───────────────────────────

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

// ─────────────────────────── Pomocníci ───────────────────────────

const game = (page: Page) => page.locator('.game');
const handCards = (page: Page) => page.getByTestId('hand').locator('.pcard');

/** Číslo z českého zápisu („1 340“, „6 Kč“). */
function num(text: string | null): number {
  return Number((text ?? '').replace(/[^\d-]/g, ''));
}

async function numberOf(locator: Locator): Promise<number> {
  return num(await locator.textContent());
}

/** Hlavní menu → Nová hra (výchozí balíček a síla piva) → daný seed → herní obrazovka. */
async function startRun(page: Page, seed: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('newgame-start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
}

/** Počká, až doběhnou animace (presenter). */
async function idle(page: Page): Promise<void> {
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

/** Uložený run z localStorage (autosave po každé akci). */
async function readRun(page: Page): Promise<RunState> {
  const raw = await page.evaluate(() => localStorage.getItem('karban.run'));
  if (!raw) throw new Error('V localStorage není uložený run.');
  return deserializeRun(raw);
}

/** Nastavení uložené před prvním načtením stránky (např. vypnuté animace). */
async function presetSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.settings')) localStorage.setItem('karban.settings', value);
  }, JSON.stringify(settings));
}

/** Vloží uložený run do localStorage (jen při prvním načtení stránky v kontextu). */
async function seedSavedRun(page: Page, state: RunState): Promise<void> {
  const raw = serializeRun(state, '2026-10-01T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('karban-e2e-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('karban-e2e-seeded', '1');
    }
  }, raw);
}

/** Menu → Pokračovat → herní obrazovka. */
async function continueRun(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

/** Nový run v enginu (stejný balíček a síla piva jako výchozí volba v UI). */
function engineRun(seed: string): Game {
  return Game.newRun({ deckId: 'pub', stake: 1, seed }, registry());
}

/** Kopie stavu enginu (ať úpravy pro test nesahají do instance hry). */
function snapshot(g: Game): RunState {
  return structuredClone(g.state) as RunState;
}

/** Vybere karty v ruce klávesami 1–8 podle jejich id (pořadí v ruce = pořadí v uloženém stavu). */
async function selectByKeys(page: Page, hand: readonly number[], ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    const i = hand.indexOf(id);
    expect(i, `karta ${id} musí být v ruce`).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(String(i + 1));
  }
}

/** Texty živého náhledu v levém panelu pro vybrané karty — spočítané enginem. */
function expectedPreview(
  state: RunState,
  ids: readonly number[],
): { name: string; chips: string; mult: string } {
  const p = Game.fromState(structuredClone(state), registry()).preview([...ids]);
  if (!p.hand) return { name: t('game.sidebar.handNothing'), chips: '0', mult: '0' };
  return { name: t(`hands.${p.hand.type}.name`), chips: formatNumber(p.chips), mult: formatNumber(p.mult) };
}

/**
 * Prvek je celý vidět bez posouvání: leží v okně i v posuvném jevišti (`.game-stage`), ve kterém je panel
 * fáze. Hlídá rozvržení na 1366×768 — Playwright při kliknutí posouvá sám, takže by ořez jinak nepoznal.
 */
async function expectUnclipped(locator: Locator): Promise<void> {
  const box = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const stage = el.closest('.game-stage')?.getBoundingClientRect() ?? null;
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      stage: stage && { top: stage.top, bottom: stage.bottom, left: stage.left, right: stage.right },
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  const bounds = box.stage ?? { top: 0, left: 0, bottom: box.vh, right: box.vw };
  expect(box.top, 'horní hrana').toBeGreaterThanOrEqual(Math.max(0, bounds.top) - 1);
  expect(box.left, 'levá hrana').toBeGreaterThanOrEqual(Math.max(0, bounds.left) - 1);
  expect(box.bottom, 'dolní hrana').toBeLessThanOrEqual(Math.min(box.vh, bounds.bottom) + 1);
  expect(box.right, 'pravá hrana').toBeLessThanOrEqual(Math.min(box.vw, bounds.right) + 1);
}

/** Testovací žolík do Večerky (obecně první žolík z registru — obsah doplňuje jiný workflow). */
function shopJoker(uid: number, defId = Object.keys(registry().jokers)[0]): JokerInstance {
  if (!defId) throw new Error('Registr nemá žádné žolíky.');
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

// ─────────────────────────── 1. Kolo klávesnicí ───────────────────────────

test('kolo klávesnicí: výběr útraty, 1–5, živý náhled, Enter, X, hra do výhry kola → Večerka → další útrata', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const log = watchConsole(page);
  await startRun(page, 'KARBAN1');
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await expect(page.locator('.blind-card')).toHaveCount(3);
  await expect(page.getByTestId('blind-small')).toHaveAttribute('data-status', 'current');
  await expect(page.getByTestId('blind-select-small')).toBeFocused();
  await expect(page.getByTestId('round-target')).not.toHaveText('–');
  // Všechny tři karty útrat i tlačítka se vejdou na obrazovku bez posouvání.
  for (const kind of ['small', 'big', 'boss']) await expectUnclipped(page.getByTestId(`blind-${kind}`));
  await expectUnclipped(page.getByTestId('blind-skip-small'));
  await expectUnclipped(page.getByTestId('deck'));
  await page.screenshot({ path: 'test-results/game-blind-select.png', animations: 'disabled' });

  // Enter = vybrat útratu.
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  await expect(handCards(page)).toHaveCount(8);
  await expect(page.getByTestId('hands-left')).toHaveText('4');
  await expect(page.getByTestId('discards-left')).toHaveText('3');
  await expect(page.getByTestId('round-score')).toHaveText('0');
  await expect(page.getByTestId('blind-name')).toHaveText('Malá útrata');
  await expect(page.getByTestId('deck-count')).toContainText('44');

  // Klávesy 1–5 vyberou prvních pět karet; levý panel ukáže kombinaci a čipy × mult jako engine.
  let state = await readRun(page);
  const hand = state.round!.hand;
  await expect(page.getByTestId('hand-name')).toHaveText(t('game.sidebar.handNone'));
  for (const key of ['1', '2', '3', '4', '5']) await page.keyboard.press(key);
  for (let i = 0; i < 5; i++) await expect(handCards(page).nth(i)).toHaveAttribute('aria-pressed', 'true');
  await expect(handCards(page).nth(5)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('selected-count')).toContainText('5');
  const preview = expectedPreview(state, hand.slice(0, 5));
  await expect(page.getByTestId('hand-name')).toHaveText(preview.name);
  await expect(page.getByTestId('hand-chips')).toHaveText(preview.chips);
  await expect(page.getByTestId('hand-mult')).toHaveText(preview.mult);
  await expect(page.getByTestId('hand-chips')).not.toHaveText('0');
  // Šestá karta se nevybere (max. 5).
  await page.keyboard.press('6');
  await expect(handCards(page).nth(5)).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'test-results/game-select.png', animations: 'disabled' });

  // Enter = zahrát: karty na stůl, během animace je obrazovka „busy“, pak skóre kola vzroste.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('table').locator('.pcard')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/game-scoring.png' });
  await idle(page);
  state = await readRun(page);
  const scoreAfterFirst = state.round!.score;
  expect(scoreAfterFirst).toBeGreaterThan(0);
  await expect(page.getByTestId('round-score')).toHaveText(formatNumber(scoreAfterFirst));
  await expect(page.getByTestId('hands-left')).toHaveText('3');
  await expect(page.getByTestId('table').locator('.pcard')).toHaveCount(0);
  await expect(handCards(page)).toHaveCount(8);
  await expect(page.getByTestId('hand-name')).toHaveText(t('game.sidebar.handNone'));
  await expect(page.getByTestId('deck-count')).toContainText('39');

  // X = zahodit (jedna karta), ruka se doplní.
  await page.keyboard.press('1');
  await page.keyboard.press('x');
  await idle(page);
  await expect(page.getByTestId('discards-left')).toHaveText('2');
  await expect(handCards(page)).toHaveCount(8);
  await expect(page.getByTestId('round-score')).toHaveText(formatNumber(scoreAfterFirst));

  // Hraj dál podle bota z enginu (rozhoduje nad uloženým stavem), mezerníkem přeskakuj animace.
  const bot = createBot('max');
  for (let turn = 0; turn < 12; turn++) {
    state = await readRun(page);
    if (state.phase !== 'round') break;
    const action: Action = bot.decide(Game.fromState(structuredClone(state), registry()));
    if (action.type !== 'play' && action.type !== 'discard')
      throw new Error(`Bot chce v kole nečekanou akci ${action.type}`);
    const before = await numberOf(page.getByTestId('round-score'));
    await selectByKeys(page, state.round!.hand, action.cardIds);
    if (action.type === 'play') {
      await expect(page.getByTestId('hand-name')).toHaveText(expectedPreview(state, action.cardIds).name);
    }
    await page.keyboard.press(action.type === 'play' ? 'Enter' : 'x');
    await page.keyboard.press(' ');
    await idle(page);
    const after = await readRun(page);
    if (action.type === 'play' && after.phase === 'round')
      expect(await numberOf(page.getByTestId('round-score'))).toBeGreaterThan(before);
  }

  const phase = await game(page).getAttribute('data-phase');
  if (phase === 'game_over') {
    // Prohra: pitva s hláškou a seedem (uložený run zmizel).
    await expect(page.getByTestId('death-quote')).toContainText('Malé útratě');
    await expect(page.getByTestId('run-seed')).toHaveText('KARBAN1');
    return expectCleanConsole(log);
  }

  // Výhra kola: rozpis odměn → Vyplatit → Večerka → Pokračovat → výběr Velké útraty.
  expect(phase).toBe('round_end');
  state = await readRun(page);
  await expect(page.getByTestId('round-end')).toBeVisible();
  await expect(page.getByTestId('cash-out')).toBeFocused();
  const total = state.rewards!.total;
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId('reward-total')).toContainText(String(total));
  await expect(page.getByTestId('round-number')).toHaveText('1');
  await page.screenshot({ path: 'test-results/game-round-end.png', animations: 'disabled' });
  const moneyBefore = state.money;
  await page.getByTestId('cash-out').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await idle(page);
  await expect(page.getByTestId('money')).toHaveText(formatMoney(moneyBefore + total));
  await expect(page.getByTestId('shop')).toContainText('Večerka');
  await expect(page.getByTestId('shop-continue')).toBeFocused();
  await expect(page.getByTestId('hand')).toBeHidden();
  await expectUnclipped(page.getByTestId('shop-continue'));
  await expectUnclipped(page.getByTestId('shop-reroll'));
  await expectUnclipped(page.getByTestId('shop-item-0'));
  await page.screenshot({ path: 'test-results/game-shop-after-round.png', animations: 'disabled' });

  await page.getByTestId('shop-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await expect(page.getByTestId('blind-small')).toHaveAttribute('data-status', 'defeated');
  await expect(page.getByTestId('blind-big')).toHaveAttribute('data-status', 'current');
  await expect(page.getByTestId('blind-select-big')).toBeFocused();
  await expect(page.getByTestId('blind-skip-small')).toHaveCount(0);
  await expect(page.getByTestId('round-number')).toHaveText('2');
  await expect(page.getByTestId('round-target')).toHaveText(
    formatNumber(Game.fromState(await readRun(page), registry()).blindTarget('big', null)),
  );
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Uložení a obnovení ───────────────────────────

test('autosave: po pár akcích reload → menu → Pokračovat obnoví stejné skóre, ruku i balíček', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { speed: 4 });
  await startRun(page, 'ULOZENI1');
  await page.keyboard.press('Enter');
  await idle(page);
  for (const key of ['1', '2', '3']) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await idle(page);
  await page.keyboard.press('2');
  await page.keyboard.press('x');
  await idle(page);
  // Třídění podle barvy je akce enginu — pořadí ruky se ukládá taky.
  await page.keyboard.press('b');
  await idle(page);

  const snapshotUi = async () => ({
    score: await page.getByTestId('round-score').textContent(),
    hands: await page.getByTestId('hands-left').textContent(),
    discards: await page.getByTestId('discards-left').textContent(),
    money: await page.getByTestId('money').textContent(),
    target: await page.getByTestId('round-target').textContent(),
    deck: await page.getByTestId('deck-count').textContent(),
    cards: await handCards(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
  });
  const before = await snapshotUi();
  expect(num(before.score)).toBeGreaterThan(0);
  expect(before.hands).toBe('3');
  expect(before.discards).toBe('2');
  expect(before.cards).toHaveLength(8);
  const savedBefore = await readRun(page);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  expect(await snapshotUi()).toEqual(before);
  // Výběr karet je jen stav UI — po obnovení je prázdný.
  await expect(page.getByTestId('hand-name')).toHaveText(t('game.sidebar.handNone'));
  expect((await readRun(page)).round!.hand).toEqual(savedBefore.round!.hand);

  // Obnovená hra jde hrát dál.
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await idle(page);
  await expect(page.getByTestId('hands-left')).toHaveText('2');
  expectCleanConsole(log);
});

// ─────────────────────────── 3. Přeskočení útraty ───────────────────────────

test('přeskočení Malé a Velké útraty: stav karet, focus, oznámení, šéf přeskočit nejde', async ({ page }) => {
  const log = watchConsole(page);
  await startRun(page, 'SKIP1');
  await expect(page.getByTestId('blind-skip-small')).toBeVisible();
  await expect(page.getByTestId('blind-skip-big')).toHaveCount(0);

  await page.getByTestId('blind-skip-small').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await expect(page.getByTestId('blind-small')).toHaveAttribute('data-status', 'skipped');
  await expect(page.getByTestId('blind-big')).toHaveAttribute('data-status', 'current');
  await expect(page.getByTestId('blind-select-big')).toBeFocused();
  await expect(page.getByTestId('blind-skip-small')).toHaveCount(0);
  await expect(page.getByTestId('toast-game-info').first()).toContainText('přeskočena');
  let state = await readRun(page);
  expect(state.blinds.map((b) => b.status)).toEqual(['skipped', 'current', 'upcoming']);
  expect(state.blindIndex).toBe(1);
  // Cíl v levém panelu = Velká útrata.
  await expect(page.getByTestId('round-target')).toHaveText(
    formatNumber(Game.fromState(state, registry()).blindTarget('big', null)),
  );
  await page.screenshot({ path: 'test-results/game-skip.png', animations: 'disabled' });

  // Velká útrata taky, šéf už přeskočit nejde.
  await page.getByTestId('blind-skip-big').click();
  await idle(page);
  await expect(page.getByTestId('blind-boss')).toHaveAttribute('data-status', 'current');
  await expect(page.getByTestId('blind-select-boss')).toBeFocused();
  await expect(page.locator('[data-testid^="blind-skip-"]')).toHaveCount(0);
  state = await readRun(page);
  expect(state.blinds.map((b) => b.status)).toEqual(['skipped', 'skipped', 'current']);

  // Enter vybere šéfa — kolo šéfa (2× cíl).
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  await expect(page.locator('.game')).toHaveClass(/is-boss/);
  state = await readRun(page);
  expect(state.round!.blind).toBe('boss');
  await expect(page.getByTestId('round-target')).toHaveText(formatNumber(state.round!.target));
  expectCleanConsole(log);
});

// ─────────────────────────── 4. Dialogy ze hry ───────────────────────────

test('Info o runu, Nastavení a pauza ze hry: otevřou se, Esc je zavře a klávesy neprosakují do hry', async ({
  page,
}) => {
  const log = watchConsole(page);
  await startRun(page, 'DIALOGY1');
  await page.getByTestId('blind-select-small').click();
  await idle(page);

  // Info o runu: tabulka kombinací (tajné jako ???), seed; Esc zavře a focus se vrátí na tlačítko.
  await page.getByTestId('run-info').click();
  const info = page.getByTestId('run-info-modal');
  await expect(info).toBeVisible();
  await expect(info.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('run-info-hands').locator('tbody tr')).toHaveCount(13);
  await expect(page.getByTestId('run-info-hands').locator('tr.is-secret')).toHaveCount(3);
  await expect(page.getByTestId('run-info-seed')).toContainText('DIALOGY1');
  await page.screenshot({ path: 'test-results/game-run-info.png', animations: 'disabled' });
  // Číslice v dialogu nevybírá karty.
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await expect(info).toHaveCount(0);
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);
  await expect(page.getByTestId('run-info')).toBeFocused();
  await expect(handCards(page).first()).toHaveAttribute('aria-pressed', 'false');

  // Nastavení ze hry: změna se projeví hned; Esc zavře, pauza se neotevře.
  await page.getByTestId('game-settings').click();
  const settings = page.getByTestId('settings-modal');
  await expect(settings).toBeVisible();
  await expect(settings.locator('.modal__close')).toBeFocused();
  await settings.locator('label[for="settings-colorblind"]').click();
  await expect(page.locator('html')).toHaveClass(/colorblind/);
  await page.screenshot({ path: 'test-results/game-settings.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);
  await expect(page.getByTestId('game-settings')).toBeFocused();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');

  // Esc ve hře = pauza → Nastavení → Esc zpět do hry → Esc → pauza → Pokračovat. (Myš pryč z karet:
  // Esc nejdřív zavře bublinu s detailem karty pod ukazatelem, WCAG 1.4.13.)
  await page.mouse.move(800, 320);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toBeVisible();
  await expect(page.getByTestId('pause-resume')).toBeFocused();
  await page.getByTestId('pause-settings').click();
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);

  // Hra po dialozích normálně reaguje na klávesy.
  await page.keyboard.press('1');
  await expect(handCards(page).first()).toHaveAttribute('aria-pressed', 'true');

  // Pauza → Hlavní menu; rozehraná hra zůstane uložená.
  await page.getByTestId('game-menu').click();
  await page.getByTestId('pause-menu').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  expectCleanConsole(log);
});

// ─────────────────────────── 5. Myš ───────────────────────────

test('myš: klik vybere a zruší kartu, limit výběru, Zahrát, Zahodit, třídění, náhled balíčku', async ({
  page,
}) => {
  const log = watchConsole(page);
  await startRun(page, 'MYS1');
  await page.getByTestId('blind-select-small').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);

  const cards = handCards(page);
  await expect(page.getByTestId('play')).toBeDisabled();
  await expect(page.getByTestId('discard')).toBeDisabled();
  await cards.nth(0).click();
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(0)).toHaveClass(/is-selected/);
  await expect(page.getByTestId('play')).toBeEnabled();
  await cards.nth(0).click();
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('play')).toBeDisabled();

  // Max. 5 vybraných karet.
  for (let i = 0; i < 6; i++) await cards.nth(i).click();
  await expect(page.locator('[data-testid="hand"] .pcard[aria-pressed="true"]')).toHaveCount(5);
  await expect(cards.nth(5)).toHaveAttribute('aria-pressed', 'false');
  // Zrušit dvě, nechat tři.
  await cards.nth(3).click();
  await cards.nth(4).click();
  const state = await readRun(page);
  const preview = expectedPreview(state, state.round!.hand.slice(0, 3));
  await expect(page.getByTestId('hand-name')).toHaveText(preview.name);
  await expect(page.getByTestId('hand-chips')).toHaveText(preview.chips);

  await page.getByTestId('play').click();
  await expect(page.getByTestId('table').locator('.pcard')).toHaveCount(3);
  // Mezerník přeskočí animaci skórování (bez přeskočení trvá ~3 s).
  await page.keyboard.press(' ');
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 1500 });
  await expect(page.getByTestId('hands-left')).toHaveText('3');
  expect(await numberOf(page.getByTestId('round-score'))).toBeGreaterThan(0);
  await expect(cards).toHaveCount(8);

  // Zahodit dvě karty myší.
  await cards.nth(6).click();
  await cards.nth(7).click();
  await page.getByTestId('discard').click();
  await idle(page);
  await expect(page.getByTestId('discards-left')).toHaveText('2');
  await expect(cards).toHaveCount(8);

  // Enter na kartě zaměřené kliknutím = Zahrát (ne přepnutí karty); mezerník přeskočí animaci, i když
  // focus zůstal na kartě v ruce.
  const focusedId = await cards.nth(7).getAttribute('data-card-id');
  const focused = page.locator(`[data-testid="hand"] .pcard[data-card-id="${focusedId}"]`);
  await focused.click();
  await focused.click();
  await expect(focused).toBeFocused();
  await expect(focused).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('table').locator('.pcard')).toHaveCount(1);
  await expect(focused).toBeFocused();
  await page.keyboard.press(' ');
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 1500 });
  await expect(page.getByTestId('hands-left')).toHaveText('2');
  await expect(focused).toHaveAttribute('aria-pressed', 'false');

  // Třídění podle hodnoty: sestupně podle hodnoty v ruce.
  await page.getByTestId('sort-rank').click();
  await idle(page);
  const sorted = await readRun(page);
  const ranks = sorted.round!.hand.map((id) => sorted.deck.find((c) => c.id === id)!.rank);
  expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);

  // Náhled balíčku: 52 karet, zahrané/zahozené zašedlé.
  await page.getByTestId('deck').click();
  await expect(page.getByTestId('deck-modal')).toBeVisible();
  await expect(page.getByTestId('deck-modal').locator('.deck-mini')).toHaveCount(52);
  await expect(page.getByTestId('deck-modal').locator('.deck-mini.is-out')).toHaveCount(52 - 38);
  await page.screenshot({ path: 'test-results/game-deck.png', animations: 'disabled' });
  await page.getByTestId('deck-close').click();
  await expect(page.getByTestId('deck-modal')).toHaveCount(0);
  expectCleanConsole(log);
});

// ─────────────────────────── 6. Dotyk ───────────────────────────

test.describe('dotyk', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tap vybere kartu, druhý tap výběr zruší, tap na Zahrát zahraje', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { speed: 4 });
    await startRun(page, 'DOTYK1');
    await page.getByTestId('blind-select-small').tap();
    await expect(game(page)).toHaveAttribute('data-phase', 'round');
    await idle(page);
    const cards = handCards(page);
    await cards.nth(0).tap();
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await cards.nth(0).tap();
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');
    // Tap nevyvolá dlouhý stisk (tooltip) ani nezůstane „viset“.
    await expect(page.locator('.ktip.is-visible')).toHaveCount(0);

    await cards.nth(1).tap();
    await cards.nth(2).tap();
    await expect(page.getByTestId('play')).toBeEnabled();
    await page.getByTestId('play').tap();
    await idle(page);
    await expect(page.getByTestId('hands-left')).toHaveText('3');
    expect(await numberOf(page.getByTestId('round-score'))).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/game-touch.png', animations: 'disabled' });
    expectCleanConsole(log);
  });
});

// ─────────────────────────── 7. Fáze z uloženého runu ───────────────────────────

test('Večerka z uloženého runu: koupit žolíka, přesun tažením, detail s prodejem, Přehodit, Pokračovat', async ({
  page,
}) => {
  const log = watchConsole(page);
  const defs = Object.keys(registry().jokers);
  const g = engineRun('E2EVECER');
  const s = snapshot(g);
  s.phase = 'shop';
  s.money = 10;
  s.jokers = [shopJoker(901, defs[1])];
  s.shop = {
    items: [{ kind: 'joker', joker: shopJoker(900, defs[0]), price: 4, sold: false }],
    boosters: [],
    vouchers: [],
    rerollCost: 5,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  await seedSavedRun(page, s);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('shop')).toContainText('Večerka');
  await expect(page.getByTestId('money')).toHaveText('10 Kč');
  await expect(page.getByTestId('joker-count')).toHaveText('1/5');
  await expect(page.getByTestId('shop-reroll')).toBeEnabled();
  await expect(page.getByTestId('shop-item-0')).toContainText(t(`jokers.${defs[0]}.name`));
  await page.screenshot({ path: 'test-results/game-shop.png', animations: 'disabled' });

  await page.getByTestId('shop-buy-0').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('2/5');
  await expect(page.getByTestId('money')).toHaveText('6 Kč');
  await expect(page.getByTestId('shop-empty')).toContainText('Večerka zavřená');
  expect((await readRun(page)).jokers.map((j) => j.uid)).toEqual([901, 900]);

  // Tažení myší: první žolík za druhého → nové pořadí se uloží, detail se po tažení neotevře.
  const row = page.getByTestId('joker-row');
  const first = await row.locator('[data-joker-uid="901"]').boundingBox();
  const second = await row.locator('[data-joker-uid="900"]').boundingBox();
  if (!first || !second) throw new Error('Žolíci nejsou vidět.');
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.9, first.y + first.height / 2, { steps: 8 });
  await page.mouse.up();
  await idle(page);
  await expect.poll(async () => (await readRun(page)).jokers.map((j) => j.uid)).toEqual([900, 901]);
  await expect(row.locator('.kcard').first()).toHaveAttribute('data-joker-uid', '900');
  await expect(page.getByTestId('joker-detail')).toHaveCount(0);

  // Detail žolíka → Prodat (prodejní cena podle enginu).
  const state = await readRun(page);
  const sellValue = Game.fromState(structuredClone(state), registry()).sellValue(900);
  await page.mouse.move(10, 10);
  await row.locator('.kcard').first().click();
  await expect(page.getByTestId('joker-detail')).toBeVisible();
  await expect(page.getByTestId('joker-position')).toContainText('1');
  await expect(page.getByTestId('joker-sell')).toContainText(formatMoney(sellValue));
  await page.getByTestId('joker-sell').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('1/5');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(6 + sellValue));

  // Přehodit za cenu z tlačítka naplní prázdnou Večerku.
  const money = 6 + sellValue;
  const rerollPriceShown = await numberOf(page.getByTestId('shop-reroll'));
  expect(rerollPriceShown).toBe((await readRun(page)).shop!.rerollCost);
  await page.getByTestId('shop-reroll').click();
  await idle(page);
  await expect(page.getByTestId('money')).toHaveText(formatMoney(money - rerollPriceShown));
  await expect(page.getByTestId('shop-empty')).toHaveCount(0);
  expect((await readRun(page)).shop!.rerollsThisShop).toBe(1);

  await page.getByTestId('shop-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  expectCleanConsole(log);
});

test('pitva z uloženého runu: poslední ruka nestačí → hláška, statistiky, seed, Menu (uložený run zmizí)', async ({
  page,
}) => {
  const log = watchConsole(page);
  const g = engineRun('E2EPITVA');
  g.dispatch({ type: 'selectBlind' });
  const s = snapshot(g);
  s.round!.handsLeft = 1;
  s.round!.discardsLeft = 0;
  await seedSavedRun(page, s);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await expect(page.getByTestId('hands-left')).toHaveText('1');
  await expect(page.getByTestId('discards-left')).toHaveText('0');
  // Klik vybere kartu (focus zůstane na ní); X bez zahození jen oznámí proč, Enter zahraje.
  await handCards(page).first().click();
  await expect(page.getByTestId('discard')).toBeDisabled();
  await page.keyboard.press('x');
  await expect(page.getByTestId('toast-action-error')).toContainText('Zahazovat už nemůžeš');
  await expect(handCards(page).first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over', { timeout: 30_000 });
  await idle(page);

  await expect(page.getByTestId('game-over')).toContainText('Pitva');
  await expect(page.getByTestId('death-quote')).toHaveText(t('game.death.small'));
  await expect(page.getByTestId('run-seed')).toHaveText('E2EPITVA');
  await expect(page.getByTestId('run-stats')).toContainText('Zahrané ruce');
  await expect(page.getByTestId('game-over-new')).toBeFocused();
  // Ruka ani tlačítka hry na pitvě nejsou.
  await expect(page.getByTestId('hand')).toBeHidden();
  await expect(page.getByTestId('play')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('karban.run'))).toBeNull();
  await page.screenshot({ path: 'test-results/game-over.png', animations: 'disabled' });

  // Kopírování seedu (schránka, nebo záložní hláška se seedem).
  await page.getByTestId('copy-seed').click();
  await expect(page.getByTestId('toast-seed')).toBeVisible();

  // Klávesy na pitvě nic nerozbijí.
  await page.keyboard.press('1');
  await page.keyboard.press('x');
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over');

  // Oznámení (chyba zahození + seed) v pravém dolním rohu nesmí blokovat tlačítka pitvy.
  await expect(page.getByTestId('toasts').locator('.toast')).not.toHaveCount(0);
  await page.getByTestId('game-over-menu').click({ timeout: 2000 });
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeDisabled();
  expectCleanConsole(log);
});

test('pitva bez animací: run do konce jednou kartou, Nová hra vede na výběr balíčku', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  await startRun(page, 'PITVA1');
  await page.getByTestId('blind-select-small').click();
  for (let i = 0; i < 4; i++) {
    await expect(game(page)).toHaveAttribute('data-phase', 'round');
    await handCards(page).first().click();
    await page.getByTestId('play').click();
    await idle(page);
  }
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over');
  await expect(page.getByTestId('death-quote')).toContainText('Malé útratě');
  await expect(page.getByTestId('run-seed')).toHaveText('PITVA1');
  await page.getByTestId('game-over-new').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  expectCleanConsole(log);
});

/** Stav: šéf 8. patra, chybí 1 bod do cíle — každá platná ruka vyhrává run. */
function finalBossState(seed: string): { state: RunState; play: number[] } {
  const g = engineRun(seed);
  const s = snapshot(g);
  s.ante = 8;
  s.blindIndex = 2;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  s.stats.roundsWon = 23;
  const boss = Game.fromState(s, registry());
  const res = boss.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`selectBlind: ${res.error}`);
  const state = snapshot(boss);
  state.round!.score = state.round!.target - 1;
  // Najdi ruku, která run opravdu vyhraje (pravidlo šéfa může některé kombinace blokovat): jednotlivé karty,
  // pak volba bota.
  const botPlay = createBot('max').decide(Game.fromState(structuredClone(state), registry()));
  const candidates = state.round!.hand.map((id) => [id]);
  if (botPlay.type === 'play') candidates.push(botPlay.cardIds);
  for (const ids of candidates) {
    const trial = Game.fromState(structuredClone(state), registry());
    trial.dispatch({ type: 'play', cardIds: ids });
    if (trial.state.phase === 'victory') return { state, play: ids };
  }
  throw new Error('finalBossState: žádná karta nevyhrává');
}

test('výhra z uloženého runu: šéf 8. patra → titulky → Nekonečný režim → rozpis → Večerka → patro 9', async ({
  page,
}) => {
  const log = watchConsole(page);
  const { state, play } = finalBossState('E2EVYHRA');
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await expect(page.getByTestId('ante')).toHaveText('8/8');
  await expect(page.locator('.game')).toHaveClass(/is-boss/);
  await selectByKeys(page, state.round!.hand, play);
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'victory', { timeout: 30_000 });
  await idle(page);

  await expect(page.getByTestId('victory')).toContainText('Výhra!');
  await expect(page.getByTestId('run-stats')).toBeVisible();
  await expect(page.getByTestId('run-seed')).toHaveText('E2EVYHRA');
  await expect(page.getByTestId('victory-endless')).toBeFocused();
  await expect(page.getByTestId('hand')).toBeHidden();
  // Výhra se ukládá (jde pokračovat Nekonečným režimem i po reloadu).
  expect((await readRun(page)).phase).toBe('victory');
  await page.screenshot({ path: 'test-results/game-victory.png', animations: 'disabled' });

  await page.reload();
  await page.getByTestId('menu-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'victory');

  // Nekonečný režim → rozpis odměn za šéfa → Vyplatit → Večerka → patro 9 v nekonečném režimu.
  await page.getByTestId('victory-endless').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round_end');
  await idle(page);
  await expect(page.getByTestId('round-end')).toBeVisible();
  await expect(page.getByTestId('cash-out')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await idle(page);
  await expect(page.getByTestId('ante')).toHaveText('9');
  await expect(page.locator('.gs-stat__note')).toHaveText(t('game.sidebar.endless'));
  const endless = await readRun(page);
  expect(endless.endless).toBe(true);
  expect(endless.ante).toBe(9);
  await page.getByTestId('shop-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await expect(page.getByTestId('round-target')).toHaveText(
    formatNumber(Game.fromState(await readRun(page), registry()).blindTarget('small', null)),
  );
  await page.screenshot({ path: 'test-results/game-endless.png', animations: 'disabled' });
  expectCleanConsole(log);
});

test('výhra → Konec: run se smaže a menu nenabízí Pokračovat', async ({ page }) => {
  const log = watchConsole(page);
  const { state, play } = finalBossState('E2EKONEC');
  await presetSettings(page, { animations: false });
  await seedSavedRun(page, state);
  await continueRun(page);
  await selectByKeys(page, state.round!.hand, play);
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'victory');
  await page.getByTestId('victory-end').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('karban.run'))).toBeNull();
  expectCleanConsole(log);
});
