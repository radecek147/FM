/**
 * Společní pomocníci e2e testů spotřebek a ruky (consumables.spec.ts, hand.spec.ts): hlídání konzole, příprava
 * stavu enginem v Node a jeho vložení jako uloženého runu, čekání na konec animací a čtení uloženého stavu.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import {
  Game,
  createBot,
  deserializeRun,
  serializeRun,
  type ConsumableInstance,
  type RunState,
  type ShopState,
} from '../../src/engine';

export const REG = registry();

export interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

export function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], warnings: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.errors.push(`console: ${msg.text()}`);
    if (msg.type() === 'warning') log.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => log.errors.push(`pageerror: ${err.message}`));
  return log;
}

export function expectCleanConsole(log: ConsoleLog): void {
  expect(log.errors).toEqual([]);
  expect(log.warnings).toEqual([]);
}

export const game = (page: Page): Locator => page.locator('.game');
export const handCards = (page: Page): Locator => page.getByTestId('hand').locator('.pcard');
export const handCard = (page: Page, id: number): Locator =>
  page.getByTestId('hand').locator(`.pcard[data-card-id="${id}"]`);

export async function idle(page: Page): Promise<void> {
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

export async function readRun(page: Page): Promise<RunState> {
  const raw = await page.evaluate(() => localStorage.getItem('karban.run'));
  if (!raw) throw new Error('V localStorage není uložený run.');
  return deserializeRun(raw);
}

/** Pořadí karet v ruce, jak ho ukazuje DOM. */
export async function domHandOrder(page: Page): Promise<number[]> {
  return (
    await handCards(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-card-id'))))
  ).filter((n) => Number.isFinite(n));
}

export async function presetSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.settings')) localStorage.setItem('karban.settings', value);
  }, JSON.stringify(settings));
}

/** Vloží uložený run do localStorage (jen při prvním načtení stránky v kontextu). */
export async function seedSavedRun(page: Page, state: RunState): Promise<void> {
  const raw = serializeRun(state, '2026-10-02T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('karban-e2e-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('karban-e2e-seeded', '1');
    }
  }, raw);
}

/** Menu → Pokračovat → herní obrazovka. */
export async function continueRun(page: Page): Promise<void> {
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

export function newState(seed: string): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed }, REG).state) as RunState;
}

/** Kopie stavu hry (pro uložení do localStorage). */
export function snapshot(g: Game): RunState {
  return structuredClone(g.state) as RunState;
}

export function consumable(uid: number, defId: string): ConsumableInstance {
  if (!REG.consumables[defId]) throw new Error(`Neznámá spotřebka ${defId}`);
  return { uid, defId, edition: null };
}

/** Položka zboží Večerky se spotřebkou. */
export function shopConsumable(c: ConsumableInstance, price: number): ShopState['items'][number] {
  const def = REG.consumables[c.defId]!;
  return { kind: 'consumable', consumable: c, consumableKind: def.kind, price, sold: false };
}

/** Run ve Večerce s daným zbožím, obálkami a kupóny (bez přehazování zdarma). */
export function shopState(
  seed: string,
  money: number,
  shop: Partial<Pick<ShopState, 'items' | 'boosters' | 'vouchers'>> = {},
): RunState {
  const s = newState(seed);
  s.phase = 'shop';
  s.money = money;
  s.shop = {
    items: shop.items ?? [],
    boosters: shop.boosters ?? [],
    vouchers: shop.vouchers ?? [],
    rerollCost: 4,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  return s;
}

/** Run v Malé útratě (výběr útraty proběhl v enginu) s volitelnými spotřebkami ve slotech. */
export function roundState(seed: string, consumables: ConsumableInstance[] = []): RunState {
  const s = newState(seed);
  s.consumables = consumables;
  const g = Game.fromState(s, REG);
  const res = g.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl výběr útraty: ${res.error}`);
  return snapshot(g);
}

/** Vybere karty v ruce klávesami 1–8 podle id (pořadí v ruce = pořadí v uloženém stavu). */
export async function selectByKeys(
  page: Page,
  hand: readonly number[],
  ids: readonly number[],
): Promise<void> {
  for (const id of ids) {
    const i = hand.indexOf(id);
    expect(i, `karta ${id} musí být v ruce`).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(String(i + 1));
  }
}

/**
 * Stav: šéf 8. patra (Hospodský balíček, Desítka), chybí 1 bod do cíle. Vrací stav a karty, které run opravdu
 * vyhrají (pravidlo šéfa může některé kombinace blokovat): jednotlivé karty, pak volba bota.
 */
export function finalBossState(seed: string): { state: RunState; play: number[] } {
  const s = newState(seed);
  s.ante = 8;
  s.blindIndex = 2;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  s.stats.roundsWon = 23;
  const boss = Game.fromState(s, REG);
  const res = boss.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl výběr šéfa: ${res.error}`);
  const state = snapshot(boss);
  state.round!.score = state.round!.target - 1;
  const botPlay = createBot('max').decide(Game.fromState(structuredClone(state), REG));
  const candidates = state.round!.hand.map((id) => [id]);
  if (botPlay.type === 'play') candidates.push(botPlay.cardIds);
  for (const ids of candidates) {
    const trial = Game.fromState(structuredClone(state), REG);
    trial.dispatch({ type: 'play', cardIds: ids });
    if (trial.state.phase === 'victory') return { state, play: ids };
  }
  throw new Error('finalBossState: žádná ruka nevyhrává');
}

/** Tažení myší ze středu prvku vodorovně na `toX`. */
export async function mouseDrag(page: Page, from: Locator, toX: number): Promise<void> {
  const box = await from.boundingBox();
  if (!box) throw new Error('Prvek k tažení není vidět.');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 12 });
  await page.mouse.up();
}

/** Obdélníky se protínají (s tolerancí 1 px na hranách)? */
export function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height
  );
}
