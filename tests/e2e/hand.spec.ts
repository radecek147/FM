import { expect, test, type Page } from '@playwright/test';
import { Game, type RunState } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import {
  REG,
  consumable,
  continueRun,
  domHandOrder,
  expectCleanConsole,
  game,
  handCard,
  handCards,
  idle,
  mouseDrag,
  newState,
  overlaps,
  presetSettings,
  readRun,
  roundState,
  seedSavedRun,
  shopState,
  snapshot,
  watchConsole,
} from './helpers';

/**
 * Ruka, náhled balíčku a hlášky (fáze 5, DESIGN 13.2–13.3) — viewport 1366×768, stavy připravené enginem:
 *  1. myš: krátký klik vybírá, tažení přesouvá (pořadí v uloženém stavu, výběr zůstane), Shift + ← / → posune
 *     vybranou i zaměřenou kartu (focus zůstane na ní), na kraji jen hláška,
 *  2. dotyk: tah prstem přesune kartu, tap dál vybírá,
 *  3. ruka obálky babských rad: tažení i Shift + šipka mění pořadí dobrané ruky,
 *  4. náhled balíčku pod Výlukou na trati neprozradí karty lícem dolů (jen dobírací balíček + počet zakrytých),
 *  5. hlášky: nejvýš 3 naráz ve sloupci nad stolem — mimo ruku, Zahrát / Zahodit a balíček; opakovaná hláška
 *     jen přičte „×2“.
 * Ve všech testech: konzole bez chyb a varování.
 */

const centerX = async (page: Page, id: number): Promise<number> => {
  const box = await handCard(page, id).boundingBox();
  if (!box) throw new Error(`Karta ${id} není vidět.`);
  return box.x + box.width / 2;
};

/** Pořadí karet: `ids` s prvkem `from` přesunutým na index `to`. */
function moved(ids: readonly number[], from: number, to: number): number[] {
  const out = [...ids];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

// ─────────────────────────── 1. Myš a klávesnice ───────────────────────────

test('ruka myší: klik vybírá, tažení přesouvá, Shift + šipka posune vybranou i zaměřenou kartu', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  await seedSavedRun(page, roundState('E2ERUKA1'));
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  const hand0 = (await readRun(page)).round!.hand;
  expect(hand0.length).toBeGreaterThanOrEqual(5);
  const [a, b, c] = hand0 as [number, number, number];

  // Krátký klik = výběr (pořadí beze změny).
  await handCard(page, a).click();
  await expect(handCard(page, a)).toHaveAttribute('aria-pressed', 'true');
  expect((await readRun(page)).round!.hand).toEqual(hand0);

  // Tažení: první karta za třetí → pořadí v uloženém stavu i v DOM, výběr zůstal (klik po tažení se pohltil).
  await mouseDrag(page, handCard(page, a), (await centerX(page, c)) + 12);
  await idle(page);
  const hand1 = moved(hand0, 0, 2);
  await expect.poll(async () => (await readRun(page)).round!.hand).toEqual(hand1);
  expect(await domHandOrder(page)).toEqual(hand1);
  await expect(handCard(page, a)).toHaveAttribute('aria-pressed', 'true');
  await expect(handCard(page, a)).toHaveAttribute('aria-keyshortcuts', '3');
  await page.screenshot({ path: 'test-results/hand-drag.png', animations: 'disabled' });

  // Shift + → posune vybranou kartu o místo doprava; čtečka se dozví novou pozici.
  await page.mouse.move(5, 5);
  await page.keyboard.press('Shift+ArrowRight');
  await idle(page);
  const hand2 = moved(hand1, 2, 3);
  await expect.poll(async () => (await readRun(page)).round!.hand).toEqual(hand2);
  expect(await domHandOrder(page)).toEqual(hand2);
  await expect(page.getByTestId('hand-live')).toContainText('4. karta zleva');

  // Zaměřená (nevybraná) karta: Tab-focus → Shift + ← ji posune a focus na ní zůstane.
  await handCard(page, a).click(); // zrušit výběr
  await expect(handCard(page, a)).toHaveAttribute('aria-pressed', 'false');
  await handCard(page, b).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await idle(page);
  const hand3 = moved(hand2, 0, 0); // b je první (index 0) — na kraji se nic nestane
  expect((await readRun(page)).round!.hand).toEqual(hand3);
  await expect(page.getByTestId('hand-live')).toHaveText(t('game.hand.moveEdge'));
  await page.keyboard.press('Shift+ArrowRight');
  await idle(page);
  const hand4 = moved(hand3, 0, 1);
  await expect.poll(async () => (await readRun(page)).round!.hand).toEqual(hand4);
  await expect(handCard(page, b)).toBeFocused();
  // Výběr se klávesami nezměnil (Shift + šipka nevybírá).
  await expect(page.getByTestId('hand').locator('.pcard[aria-pressed="true"]')).toHaveCount(0);

  // Nápověda kláves v nastavení zná nový přesun.
  await page.getByTestId('game-settings').click();
  await expect(page.getByTestId('keys-table')).toContainText(t('settings.keys.items.move.key'));
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Dotyk ───────────────────────────

test.describe('dotyk', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tah prstem přesune kartu v ruce, tap dál vybírá', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    await seedSavedRun(page, roundState('E2ERUKA2'));
    await continueRun(page);
    const hand0 = (await readRun(page)).round!.hand;
    const first = hand0[0]!;
    const last = hand0[hand0.length - 1]!;

    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined || y === undefined ? [] : [{ x, y }],
      });

    // Tah prstem: první karta až za poslední.
    const from = await handCard(page, first).boundingBox();
    const to = await handCard(page, last).boundingBox();
    if (!from || !to) throw new Error('Karty nejsou vidět.');
    const y = from.y + from.height / 2;
    const x0 = from.x + from.width / 2;
    const x1 = to.x + to.width * 0.9;
    // Tah jako prstem: postupně a před puštěním se zastavit (rychlé „švihnutí“ by Chrome bral jako setrvačný
    // pohyb a první následující tap by spolkl — stejně jako na skutečném dotykovém displeji).
    await touch('touchStart', x0, y);
    for (let i = 1; i <= 14; i++) {
      await touch('touchMove', x0 + ((x1 - x0) * i) / 14, y);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(120);
    await touch('touchEnd');
    await idle(page);
    const hand1 = moved(hand0, 0, hand0.length - 1);
    await expect.poll(async () => (await readRun(page)).round!.hand).toEqual(hand1);
    expect(await domHandOrder(page)).toEqual(hand1);
    // Tah kartu nevybral.
    await expect(handCard(page, first)).toHaveAttribute('aria-pressed', 'false');

    // Tap = výběr (i na kartě, kterou jsme právě táhli).
    await handCard(page, first).tap();
    await expect(handCard(page, first)).toHaveAttribute('aria-pressed', 'true');
    await handCard(page, hand1[0]!).tap();
    await expect(handCard(page, hand1[0]!)).toHaveAttribute('aria-pressed', 'true');
    expect((await readRun(page)).round!.hand).toEqual(hand1);
    await page.screenshot({ path: 'test-results/hand-touch.png', animations: 'disabled' });
    expectCleanConsole(log);
  });
});

// ─────────────────────────── 3. Ruka obálky ───────────────────────────

test('ruka obálky babských rad: tažení i Shift + šipka mění pořadí dobrané ruky', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const shop = shopState('E2ERUKA-OBALKA', 30, {
    boosters: [{ boosterId: 'rada_normal', price: 4, sold: false }],
  });
  const g = Game.fromState(shop, REG);
  expect(g.dispatch({ type: 'buyBooster', slot: 0 }).ok).toBe(true);
  await seedSavedRun(page, snapshot(g));
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'booster');
  const hand0 = (await readRun(page)).booster!.hand;
  expect(hand0.length).toBeGreaterThanOrEqual(4);
  await expect(handCards(page)).toHaveCount(hand0.length);

  // Tažení druhé karty na začátek.
  const firstBox = await handCard(page, hand0[0]!).boundingBox();
  if (!firstBox) throw new Error('Karta není vidět.');
  await mouseDrag(page, handCard(page, hand0[1]!), firstBox.x + 4);
  await idle(page);
  const hand1 = moved(hand0, 1, 0);
  await expect.poll(async () => (await readRun(page)).booster!.hand).toEqual(hand1);
  expect(await domHandOrder(page)).toEqual(hand1);
  await expect(page.getByTestId('booster')).toBeVisible();

  // Výběr klávesou 1 a Shift + → → vybraná karta o místo doprava.
  await page.mouse.move(5, 5);
  await page.keyboard.press('1');
  await expect(handCard(page, hand1[0]!)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+ArrowRight');
  await idle(page);
  const hand2 = moved(hand1, 0, 1);
  await expect.poll(async () => (await readRun(page)).booster!.hand).toEqual(hand2);
  expect(await domHandOrder(page)).toEqual(hand2);
  expectCleanConsole(log);
});

// ─────────────────────────── 4. Náhled balíčku ───────────────────────────

/** Kolo šéfa Výluka na trati (polovina ruky lícem dolů) připravené enginem. */
function closureRound(seed: string): RunState {
  const s = newState(seed);
  const [small, big, boss] = s.blinds;
  if (!small || !big || !boss) throw new Error('Run nemá tři útraty.');
  small.status = 'defeated';
  big.status = 'defeated';
  boss.status = 'current';
  boss.bossId = 'track_closure';
  s.blindIndex = 2;
  s.ante = 2;
  s.stats.roundsWon = 5;
  s.bossesSeen = ['track_closure'];
  const g = Game.fromState(s, REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  return snapshot(g);
}

test('náhled balíčku: karty lícem dolů neprozradí, jinak ukáže i ztlumené karty venku', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = closureRound('E2ERUKA-VYLUKA');
  const hidden = state.round!.hand.filter((id) => state.deck.find((c) => c.id === id)?.faceDown);
  expect(hidden.length).toBeGreaterThan(0);
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await expect(page.getByTestId('hand').locator('.pcard.is-face-down')).toHaveCount(hidden.length);

  await page.getByTestId('deck').click();
  const modal = page.getByTestId('deck-modal');
  await expect(modal).toBeVisible();
  // Zakryté karty: žádná podle hodnoty (ani ztlumeně), jen počet a ruby.
  for (const id of hidden) await expect(modal.locator(`[data-card-id="${id}"]`)).toHaveCount(0);
  await expect(page.getByTestId('deck-hidden')).toContainText(t('game.deck.hidden', { n: hidden.length }));
  await expect(page.getByTestId('deck-hidden').locator('.pcard')).toHaveCount(hidden.length);
  await expect(page.getByTestId('deck-legend')).toHaveText(t('game.deck.legendHidden'));
  // Jen dobírací balíček: žádná karta „venku“.
  const drawPile = state.round!.drawPile;
  await expect(modal.locator('.deck-mini.is-out[data-card-id]')).toHaveCount(0);
  await expect(modal.locator('.deck-mini[data-card-id]')).toHaveCount(drawPile.length);
  await page.screenshot({ path: 'test-results/hand-deck-hidden.png', animations: 'disabled' });
  await page.getByTestId('deck-close').click();
  expectCleanConsole(log);
});

test('náhled balíčku bez zakrytých karet: ztlumené karty venku podle hodnoty', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = roundState('E2ERUKA-BALICEK');
  await seedSavedRun(page, state);
  await continueRun(page);
  await page.getByTestId('deck').click();
  const modal = page.getByTestId('deck-modal');
  await expect(page.getByTestId('deck-hidden')).toHaveCount(0);
  await expect(page.getByTestId('deck-legend')).toHaveText(t('game.deck.legend'));
  await expect(modal.locator('.deck-mini.is-out[data-card-id]')).toHaveCount(state.round!.hand.length);
  for (const id of state.round!.hand)
    await expect(modal.locator(`[data-card-id="${id}"]`)).toHaveClass(/is-out/);
  expectCleanConsole(log);
});

// ─────────────────────────── 5. Hlášky ───────────────────────────

test('hlášky: v rohu mimo hrací plochu nejvýš 2 (další čekají), mimo stůl, ruku, tlačítka a balíček; opakovaná „×2“', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false, speed: 1 });
  const state = roundState('E2EHLASKY', [consumable(960, 'medard_drop'), consumable(961, 'saint_anne')]);
  state.round!.discardsLeft = 0;
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  const toasts = page.getByTestId('toasts').locator('.toast:not(.toast--leaving)');

  // Dvě pranostiky = 4 hlášky (použito + nová úroveň) → v rohu jsou vidět dvě, další čekají ve frontě.
  for (const uid of [960, 961]) {
    await page.getByTestId('consumable-row').locator(`[data-consumable-uid="${uid}"]`).click();
    await page.getByTestId('consumable-use').click();
    await idle(page);
  }
  await expect(toasts).toHaveCount(2);
  await expect(page.getByTestId('toasts')).toHaveClass(/toast-region--anchored/);
  // Zavřená hláška uvolní místo další z fronty (Svatá Anna = Postupka).
  await toasts
    .first()
    .getByRole('button', { name: t('common.dismiss') })
    .click();
  await toasts
    .first()
    .getByRole('button', { name: t('common.dismiss') })
    .click();
  await expect(toasts.filter({ hasText: t('hands.straight.name') })).toHaveCount(1);

  // Zahodit bez zahození → chyba (nečeká ve frontě); podruhé stejná chyba jen „×2“.
  await page.keyboard.press('1');
  await page.keyboard.press('x');
  await expect(page.getByTestId('toast-action-error')).toHaveCount(1);
  await page.keyboard.press('x');
  await expect(page.getByTestId('toast-action-error')).toHaveCount(1);
  await expect(page.getByTestId('toast-action-error').getByTestId('toast-count')).toHaveText(
    t('common.repeated', { n: 2 }),
  );
  expect(await toasts.count()).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'test-results/hand-toasts.png', animations: 'disabled' });

  // Sloupec je vpravo nahoře v řadě žolíků a spotřebek — nepřekrývá stůl, ruku, Zahrát / Zahodit ani balíček.
  const top = await page.locator('.game-top').boundingBox();
  const region = await page.getByTestId('toasts').boundingBox();
  if (!top || !region) throw new Error('Řada žolíků nebo hlášky nejsou vidět.');
  expect(region.x + region.width).toBeLessThanOrEqual(top.x + top.width + 1);
  expect(region.x).toBeGreaterThan(top.x + top.width / 2);
  expect(region.y).toBeLessThan(top.y + top.height);
  const blockers = [
    await page.getByTestId('table').boundingBox(),
    await page.getByTestId('hand').boundingBox(),
    await page.getByTestId('play').boundingBox(),
    await page.getByTestId('discard').boundingBox(),
    await page.getByTestId('deck').boundingBox(),
  ];
  for (const box of await toasts.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  )) {
    for (const blocker of blockers) {
      if (!blocker) continue;
      expect(overlaps(box, blocker)).toBe(false);
    }
  }

  // Pod dialogem: otevřená pauza hlášky překryje (bod uprostřed hlášky patří dialogové vrstvě).
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-layer')).toBeVisible();
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.toast');
    if (!el) return 'none';
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at?.closest('.modal-layer') ? 'modal' : at?.closest('.toast') ? 'toast' : 'other';
  });
  expect(['modal', 'none']).toContain(hit);
  await page.keyboard.press('Escape');
  expectCleanConsole(log);
});

test('výběr klávesami 1–9 po zavření detailu žolíka: Enter zahraje ruku, neotevře znovu žolíka', async ({
  page,
}) => {
  // Našel ui-walkthrough: po Esc se focus vrátí na žolíka a Enter by ho místo Zahrát znovu otevřel.
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const s = roundState('ENTERJKR');
  const def = REG.jokers['beer_mat']!;
  s.jokers = [
    {
      uid: 900,
      defId: 'beer_mat',
      edition: null,
      state: def.initState?.() ?? {},
      sellBonus: 0,
      stickers: [],
      debuffed: false,
    },
  ];
  await seedSavedRun(page, s);
  await continueRun(page);

  const jokerCard = page.locator('[data-joker-uid="900"]');
  await jokerCard.click();
  await expect(page.getByTestId('joker-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('joker-detail')).toHaveCount(0);
  await expect(jokerCard).toBeFocused();

  const handsBefore = (await readRun(page)).round!.handsLeft;
  await page.keyboard.press('1');
  await expect(page.getByTestId('hand')).toBeFocused();
  await page.keyboard.press('Enter');
  await idle(page);
  await expect(page.getByTestId('joker-detail')).toHaveCount(0);
  expect((await readRun(page)).round!.handsLeft).toBe(handsBefore - 1);
  expectCleanConsole(log);
});
