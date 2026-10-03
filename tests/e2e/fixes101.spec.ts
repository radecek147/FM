import { expect, test, type Page } from '@playwright/test';
import { t } from '../../src/i18n/cs';
import { Game, type JokerInstance, type RunState } from '../../src/engine';
import {
  REG,
  continueRun,
  expectCleanConsole,
  game,
  handCards,
  idle,
  newState,
  presetSettings,
  roundState,
  seedSavedRun,
  shopState,
  snapshot,
  watchConsole,
} from './helpers';

/**
 * Opravy UI po testu 1.0 (1.0.1, docs/DECISIONS.md „2026-10-03 — Oprava UI po testu 1.0“) ve skutečném prohlížeči:
 * čitelné písmo (Karban Digits s „C“ a háčky), focus po výběru útraty, zpětná vazba výběru, Pan starosta, detail
 * zboží na dotyku, telefon 390 × 844 bez posouvání, Nová hra s kompaktními zamčenými balíčky a viditelnou chybou seedu.
 */

function joker(uid: number, defId: string): JokerInstance {
  const def = REG.jokers[defId]!;
  return {
    uid,
    defId,
    edition: null,
    state: def.initState?.() ?? {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
  };
}

async function box(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`${testId} není vidět`);
  return b;
}

test('písmo: Karban Digits kreslí číslice, C a písmena s háčkem; pangram v pořádku', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('16px "Karban Digits"', 'Kč 3/8 RUCE');
    const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Karban Digits');
    return {
      faces: faces.length,
      range: faces[0]?.unicodeRange ?? '',
      check: document.fonts.check('16px "Karban Digits"', 'Kč 3/8 RUCE Příliš žluťoučký kůň'),
    };
  });
  expect(fonts.faces).toBe(2);
  expect(fonts.check).toBe(true);
  // Prohlížeč rozsah normalizuje bez úvodních nul (U+0030 → U+30).
  for (const code of ['U+30-39', 'U+43', 'U+63', 'U+10C-10E', 'U+158-159', 'U+160-161'])
    expect(fonts.range).toContain(code);
  expectCleanConsole(log);
});

test('výběr útraty Enterem: focus na ruce; šestá karta a Enter bez výběru se ozvou', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  await seedSavedRun(page, newState('E2EFIX-FOCUS'));
  await continueRun(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await page.getByTestId('blind-select-small').focus();
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  await expect(page.getByTestId('hand')).toBeFocused();

  // Enter bez výběru: hláška místo ticha.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hand-alert')).toBeVisible();
  await expect(page.getByTestId('hand-alert')).toHaveText(t('game.hand.selectFirst'));
  // Šestá karta se nevybere tiše.
  for (const k of ['1', '2', '3', '4', '5', '6']) await page.keyboard.press(k);
  await expect(handCards(page).and(page.locator('.is-selected'))).toHaveCount(5);
  await expect(page.getByTestId('hand-alert')).toHaveText(t('game.hand.maxSelected', { max: 5 }));
  // Mimo kolo náhled kombinace v levém panelu není (ve výběru útraty schovaný, v kole vidět).
  await expect(page.locator('.gs-hand')).toBeVisible();
  expectCleanConsole(log);
});

test('Pan starosta: „Překonej: X“ po první ruce a varování u slabší ruky', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const s = newState('E2EFIX-MAYOR');
  s.ante = 8;
  s.blindIndex = 2;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  s.blinds[2]!.bossId = 'mayor';
  const g = Game.fromState(s, REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  // První ruka (pět nejvyšších karet) už zahraná v enginu.
  const top5 = g.state
    .round!.hand.map((id) => g.card(id)!)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map((c) => c.id);
  expect(g.dispatch({ type: 'play', cardIds: top5 }).ok).toBe(true);
  const beat = g.scoreToBeat();
  expect(beat).not.toBeNull();
  const state = snapshot(g);
  await seedSavedRun(page, state);
  await continueRun(page);
  await expect(page.getByTestId('hand-beat')).toBeVisible();
  await expect(page.getByTestId('hand-beat')).toContainText(
    t('game.sidebar.scoreToBeat', { score: beat! }).split(':')[0]!,
  );
  // Nejnižší karta sama laťku nepřekoná → jantarové varování v náhledu.
  const lowest = state.round!.hand.map((id) => g.card(id)!).sort((a, b) => a.rank - b.rank)[0]!;
  await page.getByTestId('hand').locator(`.pcard[data-card-id="${lowest.id}"]`).click();
  await expect(page.getByTestId('hand-blocked')).toBeVisible();
  await expect(page.locator('.gs-hand')).toHaveClass(/is-short/);
  expectCleanConsole(log);
});

test.describe('dotyk na tabletu', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('tap na zboží otevře detail s popisem; důvod neaktivního „Koupit“ je vidět bez hoveru', async ({
    page,
  }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    const s = shopState('E2EFIX-TAP', 3, {
      items: [{ kind: 'joker', joker: joker(950, 'hearts_man'), price: 5, sold: false }],
    });
    await seedSavedRun(page, s);
    await continueRun(page);
    await expect(game(page)).toHaveAttribute('data-phase', 'shop');
    // Na dotyku žádné nápovědy kláves.
    const slot = page.getByTestId('shop-item-0');
    await expect(slot.getByTestId('offer-why')).toHaveText(t('game.shop.cantAfford'));
    await slot.locator('.shop-slot__card button').tap();
    const detail = page.getByTestId('shop-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(t('jokers.hearts_man.name'));
    await expect(detail.getByTestId('detail-shop-buy-0')).toBeDisabled();
    await expect(detail.getByTestId('detail-why')).toHaveText(t('game.shop.cantAfford'));
    await page.getByTestId('offer-detail-close').tap();
    await expect(detail).toBeHidden();
    expectCleanConsole(log);
  });

  test('kolo na dotyku: čísla kláves pod kartami ani klávesy v nápovědě stolu nejsou', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    await seedSavedRun(page, roundState('E2EFIX-KEYS'));
    await continueRun(page);
    await expect(page.locator('.pcard__key').first()).toBeHidden();
    await expect(page.locator('.game-table__hint')).toHaveText(t('game.hand.tableHintTouch', { max: 5 }));
    expectCleanConsole(log);
  });
});

test.describe('telefon 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('ruka, Zahrát a Zahodit jsou vidět bez posouvání; možnosti obálky nad přehybem', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    const s = roundState('E2EFIX-PHONE');
    s.jokers = [1, 2, 3, 4, 5].map((i) => joker(800 + i, 'beer_mat'));
    await seedSavedRun(page, s);
    await continueRun(page);
    await expect(game(page)).toHaveAttribute('data-phase', 'round');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const id of ['hand', 'play', 'discard']) {
      const b = await box(page, id);
      expect(b.y + b.height, id).toBeLessThanOrEqual(844);
    }
    expectCleanConsole(log);
  });

  test('obálka: první možnost i s tlačítky nad přehybem', async ({ page }) => {
    const log = watchConsole(page);
    await presetSettings(page, { animations: false });
    const shop = shopState('E2EFIX-PHONE-BOOSTER', 20, {
      boosters: [{ boosterId: 'pranostika_normal', price: 4, sold: false }],
    });
    const g = Game.fromState(shop, REG);
    expect(g.dispatch({ type: 'buyBooster', slot: 0 }).ok).toBe(true);
    await seedSavedRun(page, snapshot(g) as RunState);
    await continueRun(page);
    await expect(game(page)).toHaveAttribute('data-phase', 'booster');
    const opt = await box(page, 'booster-option-0');
    expect(opt.y + opt.height).toBeLessThanOrEqual(844);
    expectCleanConsole(log);
  });
});

test('Nová hra: zamčené balíčky kompaktně, Síla piva blízko; neplatný seed ukáže chybu u pole', async ({
  page,
}) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-new-game').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  const locked = page.getByTestId('deck-locked-grid');
  await expect(locked).toBeVisible();
  await expect(locked.locator('.deck-option')).toHaveCount(Object.keys(REG.decks).length - 2);
  // Síla piva začíná do dvou výšek okna (dřív ji deset velkých zamčených dlaždic odsunulo daleko).
  const stake = await page.locator('#newgame-stake-title').boundingBox();
  expect(stake!.y).toBeLessThan(768 * 1.4);

  await page.getByTestId('seed-input').fill('O0I1ABCD');
  await page.getByTestId('newgame-start-top').click();
  const status = page.getByTestId('seed-status');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toBeInViewport();
  await expect(page.getByTestId('seed-input')).toBeFocused();
  // Tlačítko „Rozdat karty“ chybu nezakrývá (už neplave).
  const s = (await status.boundingBox())!;
  const start = (await page.getByTestId('newgame-start').boundingBox())!;
  expect(start.y).toBeGreaterThanOrEqual(s.y + s.height);
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  expectCleanConsole(log);
});
