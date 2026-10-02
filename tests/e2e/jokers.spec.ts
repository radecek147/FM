import { expect, test, type Locator, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { Game, deserializeRun, serializeRun, type JokerInstance, type RunState } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { formatMoney, formatNumber } from '../../src/i18n/format';
import { jokerTexts } from '../../src/ui/describe';

/**
 * Žolíci a Večerka (fáze 4) — viewport 1366×768 (playwright.config.ts), stavy připravené enginem v Node a vložené
 * jako uložený run:
 *  1. Večerka myší: tooltip zboží (název, mechanika s čísly, flavor v „…“, cena a prodejní cena) → koupit → řada
 *     x/5 → tooltip a detail v řadě → přesun tažením (pořadí v uloženém stavu) → vykoupit → „Večerka zavřená –
 *     inventura“ → prodat (+prodejní cena) → Přehodit (cena +1 Kč) → koupený žolík ve skóre další ruky,
 *  2. dotyk: přesun žolíka tažením prstem, dlouhý stisk = tooltip (bez detailu), tap = detail a prodej,
 *  3. Napodobitel v kole: odznak se šipkou k cíli, zvýrazněný cíl, tooltip a Info o runu se stavem žolíků.
 * Ve všech testech: konzole bez chyb a varování.
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

const REG = registry();
const game = (page: Page) => page.locator('.game');
const row = (page: Page) => page.getByTestId('joker-row');
const rowJoker = (page: Page, uid: number) => row(page).locator(`[data-joker-uid="${uid}"]`);
const tooltip = (page: Page) => page.locator('#karban-tooltip.is-visible');

/** Číslo z českého zápisu („1 340“, „6 Kč“). */
function num(text: string | null): number {
  return Number((text ?? '').replace(/[^\d-]/g, ''));
}

async function idle(page: Page): Promise<void> {
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

async function readRun(page: Page): Promise<RunState> {
  const raw = await page.evaluate(() => localStorage.getItem('karban.run'));
  if (!raw) throw new Error('V localStorage není uložený run.');
  return deserializeRun(raw);
}

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

function newState(seed: string): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed }, REG).state) as RunState;
}

/** Žolík s počátečním stavem z definice. */
function joker(uid: number, defId: string, extra: Partial<JokerInstance> = {}): JokerInstance {
  const def = REG.jokers[defId];
  if (!def) throw new Error(`Neznámý žolík ${defId}`);
  return {
    uid,
    defId,
    edition: null,
    state: def.initState?.() ?? {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
    ...extra,
  };
}

/** Run ve Večerce s danými žolíky ve slotech a ve zboží (bez obálek a kupónu). */
function shopState(seed: string, money: number, owned: JokerInstance[], offer: [JokerInstance, number][]) {
  const s = newState(seed);
  s.phase = 'shop';
  s.money = money;
  s.jokers = owned;
  s.shop = {
    items: offer.map(([j, price]) => ({ kind: 'joker' as const, joker: j, price, sold: false })),
    boosters: [],
    vouchers: [],
    rerollCost: 4,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  return s;
}

/** Prodejní cena žolíka podle enginu (nad kopií stavu). */
function sellValueOf(state: RunState, uid: number): number {
  return Game.fromState(structuredClone(state), REG).sellValue(uid);
}

/** Skóre kola po zahrání karet — spočítané enginem nad kopií stavu (volitelně bez některých žolíků). */
function engineScore(state: RunState, cardIds: number[], withoutDefIds: string[] = []): number {
  const copy = structuredClone(state);
  copy.jokers = copy.jokers.filter((j) => !withoutDefIds.includes(j.defId));
  const g = Game.fromState(copy, REG);
  const res = g.dispatch({ type: 'play', cardIds });
  if (!res.ok) throw new Error(`Engine odmítl zahrát ${cardIds.join(', ')}: ${res.error}`);
  return g.state.round?.score ?? 0;
}

/** Texty žolíka, které musí být v tooltipu i detailu. */
function expectedTexts(defId: string, inst?: JokerInstance): { name: string; desc: string; flavor: string } {
  const tx = jokerTexts(defId, inst, { registry: REG });
  if (!tx.flavor) throw new Error(`Žolík ${defId} nemá flavor.`);
  return { name: tx.name, desc: tx.desc, flavor: t('art.tooltip.flavor', { text: tx.flavor }) };
}

async function expectJokerTexts(locator: Locator, defId: string, inst?: JokerInstance): Promise<void> {
  const tx = expectedTexts(defId, inst);
  await expect(locator).toContainText(tx.name);
  await expect(locator).toContainText(tx.desc);
  await expect(locator).toContainText(tx.flavor);
}

/** Tažení myší ze středu prvku na danou pozici (x) v jeho řadě. */
async function mouseDrag(page: Page, from: Locator, toX: number): Promise<void> {
  const box = await from.boundingBox();
  if (!box) throw new Error('Žolík není vidět.');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();
}

// ─────────────────────────── 1. Večerka myší ───────────────────────────

test('Večerka myší: tooltip s cenou → koupit → řada x/5 → tažení → inventura → prodej → Přehodit → žolík ve skóre', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const beerMat = joker(900, 'beer_mat');
  const gravedigger = joker(902, 'gravedigger');
  await seedSavedRun(
    page,
    shopState(
      'E2EZOLIK1',
      30,
      [joker(901, 'hearts_man')],
      [
        [beerMat, 4],
        [gravedigger, 5],
      ],
    ),
  );
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(30));
  await expect(page.getByTestId('joker-count')).toHaveText('1/5');

  // Tooltip zboží: název, mechanika s čísly, flavor v „…“, cena i prodejní cena po koupi.
  const beerMatDesc = expectedTexts('beer_mat').desc;
  expect(beerMatDesc).toMatch(/\+10\s+čipů/u);
  expect(beerMatDesc).toMatch(/\+2\s+mult/u);
  await page.getByTestId('shop-item-0').locator('.jcard').hover();
  await expect(tooltip(page)).toBeVisible();
  await expectJokerTexts(tooltip(page), 'beer_mat');
  await expect(tooltip(page)).toContainText(t('art.tooltip.price', { price: 4 }));
  await expect(tooltip(page)).toContainText(t('art.tooltip.sell', { price: 2 }));
  // Čísla v mechanice jsou barevně zvýrazněná (čipy / mult).
  await expect(tooltip(page).locator('.hl-chips')).toContainText('10');
  await expect(tooltip(page).locator('.hl-mult')).toContainText('2');
  await page.screenshot({ path: 'test-results/jokers-shop-tooltip.png', animations: 'disabled' });

  // Koupit → žolík je v řadě (2/5), peníze −4 Kč, pořadí v uloženém stavu.
  await page.getByTestId('shop-buy-0').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('2/5');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(26));
  await expect(rowJoker(page, 900)).toBeVisible();
  await expect(page.getByTestId('shop-item-0')).toHaveClass(/is-sold/);
  expect((await readRun(page)).jokers.map((j) => j.uid)).toEqual([901, 900]);

  // Tooltip v řadě: texty a prodejní cena (bez ceny ve Večerce).
  await rowJoker(page, 900).hover();
  await expect(tooltip(page)).toBeVisible();
  await expectJokerTexts(tooltip(page), 'beer_mat');
  await expect(tooltip(page)).toContainText(t('art.tooltip.sell', { price: 2 }));
  await expect(tooltip(page)).not.toContainText(t('art.tooltip.price', { price: 4 }));

  // Detail žolíka: název, mechanika, flavor, pozice; Esc zavře.
  await rowJoker(page, 900).click();
  const detail = page.getByTestId('joker-detail');
  await expect(detail).toBeVisible();
  await expectJokerTexts(detail, 'beer_mat');
  await expect(page.getByTestId('joker-position')).toHaveText(t('game.joker.position', { n: 2, max: 2 }));
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  // Tažení myší: Pivní tácek před Srdcaře → pořadí v uloženém stavu, detail se po tažení neotevře.
  const target = await rowJoker(page, 901).boundingBox();
  if (!target) throw new Error('Srdcař není vidět.');
  await mouseDrag(page, rowJoker(page, 900), target.x + target.width * 0.1);
  await idle(page);
  await expect.poll(async () => (await readRun(page)).jokers.map((j) => j.uid)).toEqual([900, 901]);
  await expect(row(page).locator('.kcard').first()).toHaveAttribute('data-joker-uid', '900');
  await expect(page.getByTestId('joker-detail')).toHaveCount(0);

  // Vykoupit Večerku → „Večerka zavřená – inventura“.
  await page.mouse.move(10, 10);
  await page.getByTestId('shop-buy-1').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('3/5');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(21));
  await expect(page.getByTestId('shop-empty')).toBeVisible();
  await expect(page.getByTestId('shop-empty')).toContainText(t('game.shop.empty'));
  await page.screenshot({ path: 'test-results/jokers-shop-empty.png', animations: 'disabled' });

  // Prodat Hrobníka z detailu → peníze + prodejní cena (podle enginu), 2/5.
  const sell = sellValueOf(await readRun(page), 902);
  expect(sell).toBe(2);
  await rowJoker(page, 902).click();
  await expect(page.getByTestId('joker-sell')).toContainText(formatMoney(sell));
  await page.getByTestId('joker-sell').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('2/5');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(21 + sell));
  await expect(rowJoker(page, 902)).toHaveCount(0);
  expect((await readRun(page)).jokers.map((j) => j.uid)).toEqual([900, 901]);

  // Přehodit: zaplatí cenu z tlačítka, další přehození je o 1 Kč dražší, Večerka se znovu naplní.
  const money = 21 + sell;
  const reroll = page.getByTestId('shop-reroll');
  const cost = num(await reroll.textContent());
  expect(cost).toBe((await readRun(page)).shop?.rerollCost);
  await reroll.click();
  await idle(page);
  await expect(page.getByTestId('money')).toHaveText(formatMoney(money - cost));
  await expect(reroll).toContainText(formatMoney(cost + 1));
  const afterReroll = await readRun(page);
  expect(afterReroll.shop?.rerollCost).toBe(cost + 1);
  expect(afterReroll.shop?.paidRerolls).toBe(1);
  await expect(page.getByTestId('shop-empty')).toHaveCount(0);

  // Pokračovat → Malá útrata → zahrát jednu kartu: skóre odpovídá enginu i s Pivním táckem (a bez něj by bylo nižší).
  await page.getByTestId('shop-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await page.getByTestId('blind-select-small').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  const before = await readRun(page);
  expect(before.jokers.map((j) => j.defId)).toEqual(['beer_mat', 'hearts_man']);
  const cardId = before.round!.hand[0]!;
  const withMat = engineScore(before, [cardId]);
  const withoutMat = engineScore(before, [cardId], ['beer_mat']);
  expect(withMat).toBeGreaterThan(withoutMat);
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await idle(page);
  await expect(page.getByTestId('round-score')).toHaveText(formatNumber(withMat));
  expect((await readRun(page)).round?.score).toBe(withMat);
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Dotyk ───────────────────────────

test.describe('dotyk', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tažení žolíka prstem mění pořadí, dlouhý stisk ukáže tooltip, tap otevře detail a prodá', async ({
    page,
  }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    await seedSavedRun(
      page,
      shopState(
        'E2EZOLIK2',
        10,
        [joker(901, 'hearts_man'), joker(902, 'gravedigger'), joker(903, 'beer_mat')],
        [],
      ),
    );
    await continueRun(page);
    await expect(game(page)).toHaveAttribute('data-phase', 'shop');
    await expect(page.getByTestId('joker-count')).toHaveText('3/5');

    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined || y === undefined ? [] : [{ x, y }],
      });

    // Tažení prstem: Srdcař (první) za Pivní tácek (poslední).
    const from = await rowJoker(page, 901).boundingBox();
    const last = await rowJoker(page, 903).boundingBox();
    if (!from || !last) throw new Error('Žolíci nejsou vidět.');
    const y = from.y + from.height / 2;
    const x0 = from.x + from.width / 2;
    const x1 = last.x + last.width * 0.9;
    await touch('touchStart', x0, y);
    for (let i = 1; i <= 12; i++) await touch('touchMove', x0 + ((x1 - x0) * i) / 12, y);
    await touch('touchEnd');
    await idle(page);
    await expect.poll(async () => (await readRun(page)).jokers.map((j) => j.uid)).toEqual([902, 903, 901]);
    await expect(row(page).locator('.kcard').last()).toHaveAttribute('data-joker-uid', '901');
    await expect(page.getByTestId('joker-detail')).toHaveCount(0);

    // Dlouhý stisk: tooltip s texty a prodejní cenou, detail se neotevře.
    const mat = await rowJoker(page, 903).boundingBox();
    if (!mat) throw new Error('Pivní tácek není vidět.');
    await touch('touchStart', mat.x + mat.width / 2, mat.y + mat.height / 2);
    await expect(tooltip(page)).toBeVisible();
    await touch('touchEnd');
    await expectJokerTexts(tooltip(page), 'beer_mat');
    await expect(tooltip(page)).toContainText(t('art.tooltip.sell', { price: 2 }));
    await expect(page.getByTestId('joker-detail')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/jokers-touch-tooltip.png', animations: 'disabled' });

    // Tap: detail → Prodat.
    const sell = sellValueOf(await readRun(page), 902);
    await rowJoker(page, 902).tap();
    await expect(page.getByTestId('joker-detail')).toBeVisible();
    await page.getByTestId('joker-sell').tap();
    await idle(page);
    await expect(page.getByTestId('joker-count')).toHaveText('2/5');
    await expect(page.getByTestId('money')).toHaveText(formatMoney(10 + sell));
    expect((await readRun(page)).jokers.map((j) => j.uid)).toEqual([903, 901]);
    expectCleanConsole(log);
  });
});

// ─────────────────────────── 3. Napodobitel a Info o runu ───────────────────────────

test('Napodobitel v kole: šipka k cíli, zvýrazněný cíl, tooltipy, Info o runu se stavem žolíků, skóre s kopií', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const s = newState('E2EZOLIK3');
  s.jokers = [
    joker(801, 'impersonator'),
    joker(802, 'beer_mat'),
    joker(803, 'flea_trader'),
    joker(804, 'regular', { state: { rounds: 3 } }),
    joker(805, 'gravedigger', { stickers: ['perishable'], perishRounds: 2 }),
  ];
  const g = Game.fromState(s, REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  const round = structuredClone(g.state) as RunState;
  // Cíl vybral engine při výběru útraty (náhodně, ale nikdy ne nekopírovatelného Bazarníka).
  const targetUid = round.jokers[0]!.state.target;
  expect(typeof targetUid).toBe('number');
  const target = round.jokers.find((j) => j.uid === targetUid)!;
  expect(target.defId).not.toBe('flea_trader');
  const targetName = t(`jokers.${target.defId}.name`);
  await seedSavedRun(page, round);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');

  // Odznak u Napodobitele (šipka doprava — cíl je vpravo) a zvýrazněný cíl.
  const imp = rowJoker(page, 801);
  await expect(imp).toHaveClass(/is-copying/);
  await expect(imp.getByTestId('joker-copying')).toHaveClass(/kcopy--right/);
  const label = t('art.copy.labelActive', { name: targetName }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(imp).toHaveAttribute('aria-label', new RegExp(label));
  await expect(rowJoker(page, target.uid)).toHaveClass(/is-copy-target/);
  await expect(rowJoker(page, target.uid).getByTestId('joker-copied')).toBeVisible();
  await expect(row(page).locator('.is-copy-target')).toHaveCount(1);

  // Tooltip Napodobitele: koho kopíruje + nejde kopírovat; tooltip cíle: kdo ho kopíruje.
  await imp.hover();
  await expect(tooltip(page)).toContainText(t('art.copy.active', { name: targetName }));
  await expect(tooltip(page)).toContainText(t('art.copy.notCopyable'));
  await rowJoker(page, target.uid).hover();
  await expect(tooltip(page)).toContainText(t('art.copy.copiedBy', { names: t('jokers.impersonator.name') }));
  await rowJoker(page, 803).hover();
  await expect(tooltip(page)).toContainText(t('art.copy.notCopyable'));
  // Zvětrávající: zbývající kola na odznaku i v tooltipu.
  await rowJoker(page, 805).hover();
  await expect(tooltip(page)).toContainText(t('art.stickers.perishable.left', { n: 2 }));
  await expect(rowJoker(page, 805).locator('.ksticker--perishable')).toContainText('2');
  await page.mouse.move(10, 10);
  await page.getByTestId('joker-row').screenshot({ path: 'test-results/jokers-impersonator-row.png' });

  // Info o runu: žolíci v pořadí s aktuálním stavem (Stálý host „teď +3 mult“), kopírováním a nálepkami.
  await page.getByTestId('run-info').click();
  const list = page.getByTestId('run-info-jokers');
  await expect(list.locator('li')).toHaveCount(5);
  await expect(list.locator('li').nth(0)).toContainText(t('art.copy.active', { name: targetName }));
  const regular = expectedTexts('regular', round.jokers[3]);
  await expect(list.locator('li').nth(3)).toContainText(regular.desc);
  await expect(list.locator('li').nth(3)).toContainText(
    `${formatNumber(3 * Number(REG.jokers.regular!.params?.mult ?? 1))}`,
  );
  await expect(list.locator('li').nth(4)).toContainText(t('art.stickers.perishable.left', { n: 2 }));
  await page.screenshot({ path: 'test-results/jokers-run-info.png', animations: 'disabled' });
  await page.getByTestId('run-info-close').click();

  // Skóre ruky s kopírovaným žolíkem odpovídá enginu.
  const before = await readRun(page);
  const cardId = before.round!.hand[0]!;
  const expected = engineScore(before, [cardId]);
  // Focus zůstal na „Info o runu“ (Enter by ho otevřel znovu) — zahrát tlačítkem.
  await page.keyboard.press('1');
  await page.getByTestId('play').click();
  await idle(page);
  await expect(page.getByTestId('round-score')).toHaveText(formatNumber(expected));
  expectCleanConsole(log);
});
