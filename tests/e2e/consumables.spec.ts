import { expect, test, type Page } from '@playwright/test';
import { Game, type BoosterOption, type Card, type RunState } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { formatMoney } from '../../src/i18n/format';
import { cardLabel } from '../../src/ui/describe';
import {
  REG,
  consumable,
  continueRun,
  expectCleanConsole,
  game,
  handCard,
  idle,
  overlaps,
  presetSettings,
  readRun,
  roundState,
  seedSavedRun,
  shopConsumable,
  shopState,
  snapshot,
  watchConsole,
} from './helpers';

/**
 * Spotřebky, obálky a kupóny v UI (fáze 5) — viewport 1366×768, stavy připravené enginem v Node a vložené jako
 * uložený run (tests/e2e/helpers.ts). Animace vypnuté (presenter běží hned), konzole bez chyb a varování.
 *  1. Večerka: pranostika do slotu → použít ze slotu → úroveň kombinace v Info o runu; babská rada s cíli nejde
 *     „Koupit a použít“ (ve Večerce není ruka — tlačítko je neaktivní a řekne proč), ani použít ze slotu; prodej,
 *  2. kupón: Druhý regál přidá slot zboží hned v otevřené Večerce, Věrnostní kartička hned ukáže nákup zdarma,
 *  3. obálka babských rad: otevřít, vybrat cíl v dobrané ruce, použít → vylepšení na kartě i v uloženém stavu,
 *  4. obálka pranostik: „Nechat si“ → spotřebka ve slotu,
 *  5. obálka hracích karet: vybrat kartu → balíček má o kartu víc,
 *  6. v kole: Babiččina barva přebarví vybrané karty, razítko dá vybrané kartě pečeť,
 *  7. rozložení: mega obálka (6 možností) v jedné řadě nad dobranou rukou i na 1024 × 768 a tabletu, tlačítka
 *     v jedné linii; hláška ve Večerce na tabletu jde do volného místa pod panelem (nezakryje zboží).
 */

/** Text jako regulární výraz (bez zvláštních znaků). */
const re = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const consumableEl = (page: Page, uid: number) =>
  page.getByTestId('consumable-row').locator(`[data-consumable-uid="${uid}"]`);

/** Otevře obálku `boosterId` ve Večerce (v kopii stavu) a vrátí stav s otevřenou obálkou. */
function openedBooster(state: RunState): RunState {
  const g = Game.fromState(structuredClone(state), REG);
  const res = g.dispatch({ type: 'buyBooster', slot: 0 });
  if (!res.ok) throw new Error(`Engine odmítl otevřít obálku: ${res.error}`);
  return snapshot(g);
}

function boosterShop(seed: string, boosterId: string): RunState {
  const price = REG.boosters[boosterId]?.cost ?? 4;
  return shopState(seed, 30, { boosters: [{ boosterId, price, sold: false }] });
}

/**
 * Najde seed, u kterého otevřená obálka babských rad nabídne radu s vylepšením (podle enginu: použití na první
 * kartu dobrané ruky jí dá vylepšení). Vrací stav Večerky před otevřením, index možnosti a očekávané vylepšení.
 */
function radaBoosterWithEnhancer(): { state: RunState; index: number; cardId: number; enhancement: string } {
  for (let i = 1; i <= 60; i++) {
    const state = boosterShop(`E2ERADY-${i}`, 'rada_mega');
    const opened = openedBooster(state);
    const b = opened.booster!;
    const cardId = b.hand[0];
    if (cardId === undefined) continue;
    const before = opened.deck.find((c) => c.id === cardId)!;
    for (let index = 0; index < b.options.length; index++) {
      const opt = b.options[index]!;
      if (opt.kind !== 'consumable') continue;
      const target = REG.consumables[opt.consumable.defId]?.target;
      if (!target || target.min > 1) continue;
      const g = Game.fromState(structuredClone(opened), REG);
      if (!g.dispatch({ type: 'pickBooster', index, targetIds: [cardId] }).ok) continue;
      const after = g.state.deck.find((c) => c.id === cardId);
      if (after?.enhancement && after.enhancement !== before.enhancement)
        return { state, index, cardId, enhancement: after.enhancement };
    }
  }
  throw new Error('Žádný seed nenabídl babskou radu s vylepšením.');
}

// ─────────────────────────── 1. Večerka ───────────────────────────

test('Večerka: pranostika do slotu → použít → úroveň v Info o runu; rada s cíli bez ruky nejde; prodej', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const medard = consumable(900, 'medard_drop');
  const chili = consumable(901, 'chili');
  await seedSavedRun(
    page,
    shopState('E2ESPOTREBKY1', 20, { items: [shopConsumable(medard, 3), shopConsumable(chili, 3)] }),
  );
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  const start = await readRun(page);
  const flushBefore = start.handLevels.flush?.level ?? 1;
  const pricePranostika = start.shop!.items[0]!.price;

  // (a) Koupit pranostiku do slotu → 1/2, peníze dolů.
  await page.getByTestId('shop-buy-0').click();
  await idle(page);
  await expect(page.getByTestId('consumable-count')).toHaveText('1/2');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(20 - pricePranostika));
  await expect(consumableEl(page, 900)).toBeVisible();

  // (b) „Koupit a použít“ u babské rady s cíli: ve Večerce není ruka → neaktivní (aria-disabled), klik vysvětlí.
  const useRada = page.getByTestId('shop-use-1');
  await expect(useRada).toHaveAttribute('aria-disabled', 'true');
  await expect(useRada).toHaveAttribute('title', t('game.shop.useNeedsHand'));
  // Neaktivní, ale fokusovatelné: Enter (i klik) jen vysvětlí, proč to nejde.
  await useRada.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast-shop-use')).toContainText(t('game.shop.useNeedsHand'));
  await page.screenshot({ path: 'test-results/consumables-shop.png', animations: 'disabled' });
  // Hláška je pod panelem Večerky (nebo pod jejím záhlavím): nepřekrývá Přehodit / Pokračovat ani tlačítka zboží.
  const toastBox = await page.getByTestId('toast-shop-use').boundingBox();
  for (const id of ['shop-reroll', 'shop-continue', 'shop-buy-1', 'shop-use-1']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(toastBox && box && overlaps(toastBox, box), id).toBe(false);
  }
  const afterTry = await readRun(page);
  expect(afterTry.shop!.items[1]!.sold).toBe(false);
  expect(afterTry.money).toBe(20 - pricePranostika);
  // Pranostika bez cílů „Koupit a použít“ měla (tlačítko je pryč, protože slot je vyprodaný).
  await expect(page.getByTestId('shop-item-0')).toHaveClass(/is-sold/);

  // (a) Použít pranostiku ze slotu → hláška, úroveň Barvy +1 v uloženém stavu i v Info o runu.
  await consumableEl(page, 900).click();
  const detail = page.getByTestId('consumable-detail');
  await expect(detail).toContainText(t('consumables.medard_drop.name'));
  await expect(page.getByTestId('consumable-use')).toBeEnabled();
  await page.getByTestId('consumable-use').click();
  await idle(page);
  await expect(detail).toHaveCount(0);
  await expect(page.getByTestId('consumable-count')).toHaveText('0/2');
  expect((await readRun(page)).handLevels.flush?.level).toBe(flushBefore + 1);
  await page.getByTestId('run-info').click();
  const flushRow = page.getByTestId('run-info-hands').locator('tr[data-hand="flush"]');
  await expect(flushRow.locator('td').first()).toHaveText(String(flushBefore + 1));
  await page.screenshot({ path: 'test-results/consumables-run-info.png', animations: 'disabled' });
  await page.getByTestId('run-info-close').click();

  // (b) Radu koupit do slotu jde; použít ze slotu ve Večerce ne (Použít neaktivní s vysvětlením). Cenu engine po
  // každé akci ve Večerce přepočítá — platí ta aktuální.
  const priceRada = (await readRun(page)).shop!.items[1]!.price;
  await expect(page.getByTestId('shop-buy-1')).toContainText(formatMoney(priceRada));
  await page.getByTestId('shop-buy-1').click();
  await idle(page);
  await expect(page.getByTestId('consumable-count')).toHaveText('1/2');
  const money = 20 - pricePranostika - priceRada;
  await expect(page.getByTestId('money')).toHaveText(formatMoney(money));
  await consumableEl(page, 901).click();
  await expect(page.getByTestId('consumable-use')).toBeDisabled();
  await expect(page.getByTestId('consumable-warning')).toHaveText(t('game.consumable.needsHand'));

  // (h) Prodej spotřebky z detailu → +prodejní cena (podle enginu), slot prázdný.
  const sell = Game.fromState(await readRun(page), REG).sellValue(901);
  expect(sell).toBeGreaterThan(0);
  await expect(page.getByTestId('consumable-sell')).toContainText(formatMoney(sell));
  await page.getByTestId('consumable-sell').click();
  await idle(page);
  await expect(page.getByTestId('consumable-count')).toHaveText('0/2');
  await expect(page.getByTestId('money')).toHaveText(formatMoney(money + sell));
  await expect(consumableEl(page, 901)).toHaveCount(0);
  const end = await readRun(page);
  expect(end.consumables).toEqual([]);
  expect(end.money).toBe(money + sell);
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Kupón ───────────────────────────

test('kupón: Druhý regál přidá slot zboží hned, Věrnostní kartička hned ukáže nákup zdarma', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = shopState('E2EKUPON1', 40, {
    items: [shopConsumable(consumable(900, 'medard_drop'), 3), shopConsumable(consumable(901, 'chili'), 3)],
    vouchers: [
      { voucherId: 'second_shelf', price: REG.vouchers.second_shelf!.cost, sold: false },
      { voucherId: 'loyalty_card', price: REG.vouchers.loyalty_card!.cost, sold: false },
    ],
  });
  // Na kartičce už jsou 4 razítka (počítadlo nákupů) — s uplatněnou kartičkou je hned příští nákup zdarma.
  state.flags.loyaltyPurchases = 4;
  // Ceny podle enginu (kupón přepočítá ceny i sloty hned v otevřené Večerce).
  const g = Game.fromState(structuredClone(state), REG);
  expect(g.dispatch({ type: 'buyVoucher', slot: 0 }).ok).toBe(true);
  const afterShelf = snapshot(g);
  expect(g.dispatch({ type: 'buyVoucher', slot: 1 }).ok).toBe(true);
  const afterLoyalty = snapshot(g);
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('shop').locator('.shop-section--items .shop-slot')).toHaveCount(2);

  // Druhý regál → třetí slot zboží hned.
  await page.getByTestId('shop-redeem-0').click();
  await idle(page);
  await expect(page.getByTestId('shop-voucher-0')).toHaveClass(/is-sold/);
  await expect(page.getByTestId('shop').locator('.shop-section--items .shop-slot')).toHaveCount(3);
  await expect(page.getByTestId('shop-item-2')).toBeVisible();
  expect((await readRun(page)).shop!.items).toHaveLength(afterShelf.shop!.items.length);
  expect((await readRun(page)).vouchers).toContain('second_shelf');

  // Věrnostní kartička → příští nákup zdarma: ceny zboží hned na 0 (stejně jako v enginu).
  const before = (await readRun(page)).shop!.items.map((i) => i.price);
  await page.getByTestId('shop-redeem-1').click();
  await idle(page);
  const after = (await readRun(page)).shop!.items.map((i) => i.price);
  expect(after).toEqual(afterLoyalty.shop!.items.map((i) => i.price));
  expect(after.some((p, i) => p < (before[i] ?? 0))).toBe(true);
  expect(after.every((p) => p === 0)).toBe(true);
  await expect(page.getByTestId('shop-buy-0')).toContainText(formatMoney(after[0]!));
  await expect(page.getByTestId('money')).toHaveText(formatMoney(afterLoyalty.money));
  await page.getByTestId('run-info').click();
  await expect(page.getByTestId('run-info-modal')).toContainText(t('vouchers.loyalty_card.name'));
  await page.getByTestId('run-info-close').click();
  expectCleanConsole(log);
});

// ─────────────────────────── 3. Obálka babských rad ───────────────────────────

test('obálka babských rad: otevřít, vybrat cíl v dobrané ruce, použít → vylepšení na kartě i v uloženém stavu', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const { state, index, cardId, enhancement } = radaBoosterWithEnhancer();
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');

  // Otevřít → výběr z obálky s dobranou rukou dole.
  await page.getByTestId('shop-open-0').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  await expect(page.getByTestId('booster')).toBeVisible();
  const opened = await readRun(page);
  expect(opened.booster?.hand.length).toBeGreaterThan(0);
  await expect(page.getByTestId('hand').locator('.pcard')).toHaveCount(opened.booster!.hand.length);
  // Bez cíle je Použít neaktivní (rada potřebuje vybranou kartu).
  await expect(page.getByTestId(`booster-use-${index}`)).toBeDisabled();

  // Vybrat cíl (první karta dobrané ruky) klikem → Použít.
  await handCard(page, cardId).click();
  await expect(handCard(page, cardId)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`booster-use-${index}`)).toBeEnabled();
  await page.screenshot({ path: 'test-results/consumables-booster-rada.png', animations: 'disabled' });
  await page.getByTestId(`booster-use-${index}`).click();
  await idle(page);

  // Krabice od bot má 2 výběry: obálka zůstane otevřená a karta v ruce ukazuje vylepšení.
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  await expect(handCard(page, cardId)).toHaveClass(new RegExp(`enh-${enhancement}`));
  await expect(handCard(page, cardId)).toHaveAttribute(
    'aria-label',
    re(t(`enhancements.${enhancement}.name`)),
  );
  const saved = await readRun(page);
  expect(saved.deck.find((c) => c.id === cardId)?.enhancement).toBe(enhancement);
  expect(saved.booster?.picksLeft).toBe(1);

  // Přeskočit zbytek → zpět ve Večerce, vylepšení zůstalo v balíčku (i v náhledu balíčku).
  await page.getByTestId('booster-skip').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await page.getByTestId('deck').click();
  await expect(page.getByTestId('deck-modal').locator(`[data-card-id="${cardId}"]`)).toHaveClass(
    new RegExp(`enh-${enhancement}`),
  );
  await page.getByTestId('deck-close').click();
  expect((await readRun(page)).deck.find((c) => c.id === cardId)?.enhancement).toBe(enhancement);
  expectCleanConsole(log);
});

// ─────────────────────────── 4. Obálka pranostik ───────────────────────────

test('obálka pranostik: „Nechat si“ → spotřebka ve slotu', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  await seedSavedRun(page, boosterShop('E2EPRANOSTIKY1', 'pranostika_normal'));
  await continueRun(page);
  await page.getByTestId('shop-open-0').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  const opened = await readRun(page);
  const options = opened.booster!.options;
  expect(options.length).toBeGreaterThan(0);
  const opt = options[0] as Extract<BoosterOption, { kind: 'consumable' }>;
  expect(opt.kind).toBe('consumable');
  expect(opt.consumableKind).toBe('pranostika');
  // Pranostika nepotřebuje ruku — obálka žádnou nedobírá.
  expect(opened.booster!.hand).toEqual([]);
  await expect(page.getByTestId('booster-option-0')).toContainText(
    t(`consumables.${opt.consumable.defId}.name`),
  );

  await page.getByTestId('booster-keep-0').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('consumable-count')).toHaveText('1/2');
  await expect(consumableEl(page, opt.consumable.uid)).toBeVisible();
  const saved = await readRun(page);
  expect(saved.consumables.map((c) => c.defId)).toEqual([opt.consumable.defId]);
  // Úroveň se nezvedla (spotřebka čeká ve slotu).
  expect(saved.handLevels).toEqual(opened.handLevels);
  expectCleanConsole(log);
});

// ─────────────────────────── 5. Obálka hracích karet ───────────────────────────

test('obálka hracích karet: vybrat kartu → balíček má o kartu víc', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  await seedSavedRun(page, boosterShop('E2EKARTY1', 'card_normal'));
  await continueRun(page);
  const total = (await readRun(page)).deck.length;
  await expect(page.getByTestId('deck-count')).toHaveText(`${total}/${total}`);
  await page.getByTestId('shop-open-0').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  const opened = await readRun(page);
  const opt = opened.booster!.options[1] as Extract<BoosterOption, { kind: 'card' }>;
  expect(opt.kind).toBe('card');

  await page.getByTestId('booster-take-1').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('deck-count')).toHaveText(`${total + 1}/${total + 1}`);
  const saved = await readRun(page);
  expect(saved.deck).toHaveLength(total + 1);
  const added = saved.deck.find((c) => !opened.deck.some((o) => o.id === c.id)) as Card;
  expect({ suit: added.suit, rank: added.rank, enhancement: added.enhancement, seal: added.seal }).toEqual({
    suit: opt.card.suit,
    rank: opt.card.rank,
    enhancement: opt.card.enhancement,
    seal: opt.card.seal,
  });
  expectCleanConsole(log);
});

// ─────────────────────────── 6. V kole ───────────────────────────

test('v kole: Babiččina barva přebarví vybrané karty, razítko dá vybrané kartě pečeť', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = roundState('E2EKOLO-RADY', [consumable(950, 'grandmas_dye'), consumable(951, 'notarized')]);
  const hand = state.round!.hand;
  const cardOf = (id: number) => state.deck.find((c) => c.id === id)!;
  // Dvě karty různých barev: levá dá barvu pravé.
  const left = hand.findIndex((id) => hand.some((o) => cardOf(o).suit !== cardOf(id).suit));
  const right = hand.findIndex((id, i) => i > left && cardOf(id).suit !== cardOf(hand[left]!).suit);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeGreaterThan(left);
  const leftId = hand[left]!;
  const rightId = hand[right]!;
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await expect(page.getByTestId('consumable-count')).toHaveText('2/2');

  // Bez výběru: Použít neaktivní s nápovědou.
  await consumableEl(page, 950).click();
  await expect(page.getByTestId('consumable-use')).toBeDisabled();
  await expect(page.getByTestId('consumable-warning')).toHaveText(t('game.consumable.cannotUse'));
  await page.keyboard.press('Escape');

  // Vybrat dvě karty (klávesy podle pozice) → Babiččina barva → pravá má barvu levé.
  await page.keyboard.press(String(left + 1));
  await page.keyboard.press(String(right + 1));
  await consumableEl(page, 950).click();
  await expect(page.getByTestId('consumable-use')).toBeEnabled();
  await page.getByTestId('consumable-use').click();
  await idle(page);
  const afterDye = await readRun(page);
  const recolored = afterDye.deck.find((c) => c.id === rightId)!;
  expect(recolored.suit).toBe(cardOf(leftId).suit);
  expect(afterDye.consumables.map((c) => c.uid)).toEqual([951]);
  await expect(handCard(page, rightId)).toHaveAttribute('aria-label', cardLabel(recolored, REG));
  const maxSelect = Game.fromState(structuredClone(state), REG).modifiers().maxSelect;
  await expect(page.getByTestId('selected-count')).toHaveText(
    t('game.hand.selected', { n: 0, max: maxSelect }),
  );

  // Razítko „ověřeno“: jedna vybraná karta → zlatá pečeť (na kartě v popisku i v uloženém stavu).
  await page.keyboard.press(String(left + 1));
  await consumableEl(page, 951).click();
  await page.getByTestId('consumable-use').click();
  await idle(page);
  const afterStamp = await readRun(page);
  const sealed = afterStamp.deck.find((c) => c.id === leftId)!;
  expect(sealed.seal).toBe('gold');
  await expect(handCard(page, leftId)).toHaveAttribute('aria-label', re(t('seals.gold.name')));
  expect(afterStamp.consumables).toEqual([]);
  await page.getByTestId('hand').screenshot({ path: 'test-results/consumables-round-hand.png' });

  // Zahraná karta s pečetí skóruje i s ní (skóre podle enginu).
  const g = Game.fromState(structuredClone(afterStamp), REG);
  expect(g.dispatch({ type: 'play', cardIds: [leftId] }).ok).toBe(true);
  await handCard(page, leftId).click();
  await page.getByTestId('play').click();
  await idle(page);
  expect((await readRun(page)).round?.score).toBe(g.state.round?.score);
  expectCleanConsole(log);
});

// ─────────────────────────── 7. Rozložení ───────────────────────────

type Box = { x: number; y: number; width: number; height: number };

const boxes = (page: Page, selector: string): Promise<Box[]> =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );

for (const vp of [
  { name: '1024×768', width: 1024, height: 768, touch: false },
  { name: 'tablet 820×1180', width: 820, height: 1180, touch: true },
]) {
  test.describe(`rozložení ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });

    test('mega obálka rad: 6 možností v jedné řadě nad dobranou rukou, tlačítka v jedné linii', async ({
      page,
    }) => {
      const log = watchConsole(page);
      await presetSettings(page, { animations: false });
      const opened = openedBooster(boosterShop('E2EMEGA-1', 'rada_mega'));
      expect(opened.booster!.options).toHaveLength(6);
      expect(opened.booster!.hand.length).toBeGreaterThan(0);
      await seedSavedRun(page, opened);
      await continueRun(page);
      await expect(game(page)).toHaveAttribute('data-phase', 'booster');
      await expect(page.locator('.booster-option')).toHaveCount(6);

      // Jedna řada (druhá by zajela pod ruku).
      const options = await boxes(page, '.booster-option');
      expect(new Set(options.map((b) => Math.round(b.y))).size).toBe(1);
      // Žádné tlačítko nezajede pod dobranou ruku ani pod balíček.
      const hand = (await page.getByTestId('hand').boundingBox())!;
      const deck = (await page.getByTestId('deck').boundingBox())!;
      for (const btn of await boxes(page, '.booster-option .btn')) {
        expect(overlaps(btn, hand)).toBe(false);
        expect(overlaps(btn, deck)).toBe(false);
      }
      // Použít / Nechat si ve všech možnostech v jedné linii i pod dvouřádkovým názvem (± stín stisknutí).
      for (const kind of ['use', 'keep']) {
        const tops = (await boxes(page, `.booster-option [data-testid^="booster-${kind}-"]`)).map((b) => b.y);
        expect(tops).toHaveLength(6);
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(3);
      }
      expectCleanConsole(log);
    });
  });
}

test.describe('rozložení tablet 820×1180 — hlášky', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test('hláška ve Večerce jde do rohu mimo panel a nezakryje zboží ani tlačítka', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    await seedSavedRun(
      page,
      shopState('E2EHLASKA-TABLET', 20, {
        items: [
          shopConsumable(consumable(900, 'medard_drop'), 3),
          shopConsumable(consumable(901, 'chili'), 3),
        ],
      }),
    );
    await continueRun(page);
    await expect(game(page)).toHaveAttribute('data-phase', 'shop');
    await page.getByTestId('shop-use-1').tap({ force: true });
    const toastEl = page.getByTestId('toast-shop-use');
    await expect(toastEl).toContainText(t('game.shop.useNeedsHand'));
    const toastBox = (await toastEl.boundingBox())!;
    // Úzké rozvržení: roh nahoře v okně (nad levým panelem), ne přes Večerku.
    expect(toastBox.y).toBeGreaterThanOrEqual(0);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(1180);
    for (const slot of await boxes(page, '.shop-slot')) expect(overlaps(toastBox, slot)).toBe(false);
    for (const id of ['shop-reroll', 'shop-continue', 'deck'])
      expect(overlaps(toastBox, (await page.getByTestId(id).boundingBox())!)).toBe(false);
    expectCleanConsole(log);
  });
});
