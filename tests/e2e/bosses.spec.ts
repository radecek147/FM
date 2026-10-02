import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { Game, deserializeRun, serializeRun, type JokerInstance, type RunState } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { formatNumber } from '../../src/i18n/format';
import { bossTexts, tagTexts } from '../../src/ui/describe';

/**
 * Šéfové a štítky (fáze 6) — viewport 1366×768 (playwright.config.ts), stavy připravené enginem v Node a vložené
 * jako uložený run:
 *  1. Výluka na trati: pravidlo ve výběru útraty (žeton, cíl, odměna) → výběr → plakát s hláškou příchodu,
 *     pravidlo v levém panelu, polovina ruky lícem dolů (rub) s vysvětlením v tooltipu, Info o runu se šéfem,
 *  2. Inventura: figury mimo provoz s vysvětlením v tooltipu → prohra na šéfovi → pitva s hláškou `death`,
 *  3. Jednooký hejtman: žolík v pravé polovině řady vypnutý s vysvětlením (i po přeřazení podle pozice),
 *  4. Soused s vrtačkou: zakázaná kombinace je vidět už v náhledu; Velká voda: velikost ruky klesá,
 *  5. přeskočení Malé útraty: štítek v levém panelu s tooltipem; štítek s obálkou ji otevře hned.
 * Snímky do test-results/phase6/. Ve všech testech: konzole bez chyb a varování.
 */

const OUT = 'test-results/phase6';
mkdirSync(OUT, { recursive: true });

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
const tooltip = (page: Page) => page.locator('#karban-tooltip.is-visible');
const handCards = (page: Page) => page.getByTestId('hand').locator('.pcard');

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
  const raw = serializeRun(state, '2026-10-02T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('karban-e2e-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('karban-e2e-seeded', '1');
    }
  }, raw);
}

/** Menu → Pokračovat → herní obrazovka. */
async function continueRun(page: Page): Promise<void> {
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

function newState(seed: string): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed }, REG).state) as RunState;
}

/** Run ve výběru útraty se šéfem na řadě (Malá a Velká poražené). */
function bossSelectState(seed: string, bossId: string, ante = 2, jokers: JokerInstance[] = []): RunState {
  const s = newState(seed);
  s.ante = ante;
  s.stats.roundsWon = (ante - 1) * 3 + 2;
  const [small, big, boss] = s.blinds;
  if (!small || !big || !boss) throw new Error('Run nemá tři útraty.');
  small.status = 'defeated';
  big.status = 'defeated';
  boss.status = 'current';
  boss.bossId = bossId;
  s.blindIndex = 2;
  s.jokers = jokers;
  s.bossesSeen = [bossId];
  return s;
}

/** Stejný run už v kole šéfa (výběr útraty proběhl v enginu). */
function bossRoundState(seed: string, bossId: string, ante = 2, jokers: JokerInstance[] = []): RunState {
  const g = Game.fromState(bossSelectState(seed, bossId, ante, jokers), REG);
  const res = g.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl vybrat útratu: ${res.error}`);
  return structuredClone(g.state) as RunState;
}

/** Žolík s počátečním stavem z definice. */
function joker(uid: number, defId: string): JokerInstance {
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
  };
}

const FACE_RANKS = [11, 12, 13];

/** První seed, u kterého má Inventura v ruce aspoň 2 figury i 2 jiné karty. */
function inventorySeed(): string {
  for (let i = 1; i < 200; i++) {
    const seed = `E2ESEF-INV${i}`;
    const s = bossRoundState(seed, 'inventory');
    const hand = s.round!.hand.map((id) => s.deck.find((c) => c.id === id)!);
    const faces = hand.filter((c) => FACE_RANKS.includes(c.rank)).length;
    if (faces >= 2 && hand.length - faces >= 2) return seed;
  }
  throw new Error('Žádný seed s figurami v ruce.');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
}

// ─────────────────────────── 1. Výluka na trati ───────────────────────────

test('Výluka na trati: pravidlo ve výběru útraty → plakát příchodu → pravidlo v panelu → karty lícem dolů s vysvětlením', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { speed: 4 });
  const state = bossSelectState('E2ESEF-VYLUKA', 'track_closure');
  await seedSavedRun(page, state);
  await continueRun(page);
  const tx = bossTexts('track_closure', { registry: REG });
  const engine = Game.fromState(structuredClone(state), REG);

  // Výběr útraty: karta šéfa se jménem, pravidlem, cílem a odměnou; tooltip žetonu s hláškou.
  const card = page.getByTestId('blind-boss');
  await expect(card).toHaveAttribute('data-status', 'current');
  await expect(card).toContainText(tx.name);
  await expect(card.locator('.blind-card__rule')).toHaveText(tx.rule);
  await expect(card.locator('.blind-card__target')).toHaveText(
    formatNumber(engine.blindTarget('boss', 'track_closure')),
  );
  await expect(card.locator('.blind-card__reward')).toContainText(
    String(engine.blindReward('boss', 'track_closure')),
  );
  await expect(page.getByTestId('blind-rule')).toContainText(tx.name);
  await shot(page, 'blind-select-boss');
  await card.locator('.blind-card__token').hover();
  await expect(tooltip(page)).toContainText(tx.rule);
  await expect(tooltip(page)).toContainText(tx.intro!);
  await page.mouse.move(5, 5);

  // Výběr → plakát s hláškou příchodu, pravidlo v levém panelu.
  await page.getByTestId('blind-select-boss').click();
  const banner = page.getByTestId('boss-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(tx.name);
  await expect(banner).toContainText(tx.rule);
  await expect(banner).toContainText(tx.intro!);
  await expect(page.getByTestId('blind-name')).toHaveText(tx.name);
  await expect(page.getByTestId('blind-rule')).toHaveText(tx.rule);
  await idle(page);
  await expect(game(page)).toHaveClass(/is-boss/);
  await shot(page, 'round-boss-intro');

  // Každá druhá líznutá karta je lícem dolů (rub) — UI ukazuje přesně ty, které engine zakryl.
  const run = await readRun(page);
  const downIds = run.round!.hand.filter((id) => run.deck.find((c) => c.id === id)?.faceDown);
  expect(downIds.length).toBe(Math.floor(run.round!.hand.length / 2));
  await expect(page.getByTestId('hand').locator('.pcard.is-face-down')).toHaveCount(downIds.length);
  const down = page.getByTestId('hand').locator(`[data-card-id="${downIds[0]}"]`);
  await expect(down.locator('svg[data-back="1"]')).toHaveCount(1);
  await down.hover();
  await expect(tooltip(page)).toContainText(t('art.card.faceDownHint'));
  await expect(tooltip(page)).toContainText(t('art.tooltip.bossReason', { name: tx.name, rule: tx.rule }));
  await shot(page, 'round-boss-facedown-tooltip');
  await page.mouse.move(5, 5);

  // Info o runu: šéf patra s pravidlem.
  await page.getByTestId('run-info').click();
  await expect(page.getByTestId('run-info-boss')).toContainText(tx.name);
  await expect(page.getByTestId('run-info-boss')).toContainText(tx.rule);
  await page.getByTestId('run-info-close').click();

  // Plakát po pár sekundách zmizí sám.
  await expect(banner).toBeHidden({ timeout: 8_000 });
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Inventura a pitva ───────────────────────────

test('Inventura: figury mimo provoz s vysvětlením → prohra na šéfovi → pitva s hláškou šéfa', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { speed: 4 });
  const state = bossRoundState(inventorySeed(), 'inventory');
  state.round!.handsLeft = 1;
  await seedSavedRun(page, state);
  await continueRun(page);
  const tx = bossTexts('inventory', { registry: REG });
  await expect(page.getByTestId('blind-rule')).toHaveText(tx.rule);

  // Figury jsou mimo provoz (přeškrtnuté) a tooltip říká proč; ostatní karty fungují.
  const hand = state.round!.hand.map((id) => state.deck.find((c) => c.id === id)!);
  const faces = hand.filter((c) => FACE_RANKS.includes(c.rank));
  await expect(page.getByTestId('hand').locator('.pcard.is-debuffed')).toHaveCount(faces.length);
  const face = page.getByTestId('hand').locator(`[data-card-id="${faces[0]!.id}"]`);
  await expect(face).toHaveClass(/is-debuffed/);
  await face.hover();
  await expect(tooltip(page)).toContainText(t('art.card.debuffedHint'));
  await expect(tooltip(page)).toContainText(t('art.tooltip.bossReason', { name: tx.name, rule: tx.rule }));
  await shot(page, 'round-inventory-tooltip');
  await page.mouse.move(5, 5);

  // Poslední ruka s jedinou kartou nestačí → pitva: příčina šéf, jeho žeton, hláška `death` a pravidlo.
  const other = hand.find((c) => !FACE_RANKS.includes(c.rank))!;
  await page.getByTestId('hand').locator(`[data-card-id="${other.id}"]`).click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 30_000 });
  await idle(page);
  await expect(page.getByTestId('death-quote')).toHaveText(t('game.gameOver.quote', { text: tx.death! }));
  await expect(page.getByTestId('death-boss')).toHaveAttribute('data-boss-id', 'inventory');
  await expect(page.getByTestId('death-boss')).toContainText(tx.rule);
  await expect(page.getByTestId('game-over')).toContainText(tx.name);
  await shot(page, 'game-over-boss');
  expectCleanConsole(log);
});

test('pitva na Malé útratě: obecná hláška bez šéfa', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const g = Game.fromState(newState('E2ESEF-MALA'), REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  const state = structuredClone(g.state) as RunState;
  state.round!.handsLeft = 1;
  await seedSavedRun(page, state);
  await continueRun(page);
  await handCards(page).first().click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('death-quote')).toHaveText(t('game.death.small'));
  await expect(page.getByTestId('death-boss')).toHaveCount(0);
  expectCleanConsole(log);
});

// ─────────────────────────── 3. Jednooký hejtman ───────────────────────────

test('Jednooký hejtman: žolík v pravé polovině řady je vypnutý s vysvětlením, i po přeřazení', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const jokers = [joker(901, 'beer_mat'), joker(902, 'hearts_man'), joker(903, 'gravedigger')];
  await seedSavedRun(page, bossRoundState('E2ESEF-HEJTMAN', 'one_eyed_hetman', 3, jokers));
  await continueRun(page);
  const tx = bossTexts('one_eyed_hetman', { registry: REG });
  const rowJoker = (uid: number) => page.getByTestId('joker-row').locator(`[data-joker-uid="${uid}"]`);

  // Tři žolíci: prostřední funguje, vypnutý je jen ten vpravo.
  await expect(rowJoker(903)).toHaveClass(/is-debuffed/);
  await expect(rowJoker(902)).not.toHaveClass(/is-debuffed/);
  await expect(rowJoker(901)).not.toHaveClass(/is-debuffed/);
  await rowJoker(903).hover();
  await expect(tooltip(page)).toContainText(t('art.tooltip.jokerDebuffed'));
  await expect(tooltip(page)).toContainText(t('art.tooltip.bossReason', { name: tx.name, rule: tx.rule }));
  await shot(page, 'round-hetman-jokers');
  await page.mouse.move(5, 5);

  // Přesun Hrobníka doleva (detail → Posunout doleva ×2) → vypnutý je teď ten, kdo je vpravo.
  await rowJoker(903).click();
  await page.getByTestId('joker-move-left').click();
  await idle(page);
  await page.getByTestId('joker-move-left').click();
  await idle(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await readRun(page)).jokers.map((j) => j.uid)).toEqual([903, 901, 902]);
  await expect(rowJoker(902)).toHaveClass(/is-debuffed/);
  await expect(rowJoker(903)).not.toHaveClass(/is-debuffed/);
  expectCleanConsole(log);
});

// ─────────────────────────── 4. Soused s vrtačkou, Velká voda ───────────────────────────

test('Soused s vrtačkou: zakázaná kombinace je vidět už v náhledu a ruka se nepočítá', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = bossRoundState('E2ESEF-VRTACKA', 'drilling_neighbor');
  state.round!.handTypesPlayed = ['high_card'];
  await seedSavedRun(page, state);
  await continueRun(page);
  const reason = t('bosses.drilling_neighbor.blocked');

  await handCards(page).first().click();
  await expect(page.getByTestId('hand-name')).toHaveText(t('hands.high_card.name'));
  await expect(page.getByTestId('hand-blocked')).toHaveText(t('game.sidebar.handBlocked', { reason }));
  await shot(page, 'round-drilling-blocked');
  await page.getByTestId('play').click();
  await idle(page);
  await expect(page.getByTestId('toast-game-warning')).toContainText(reason);
  await expect(page.getByTestId('round-score')).toHaveText('0');
  expectCleanConsole(log);
});

test('Velká voda: po zahrané ruce se zmenší velikost ruky a hra to oznámí', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = bossRoundState('E2ESEF-VODA', 'great_flood', 8);
  await seedSavedRun(page, state);
  await continueRun(page);
  const size = state.round!.hand.length;
  const name = bossTexts('great_flood', { registry: REG }).name;

  await expect(page.getByTestId('hand-size')).toHaveText(t('game.hand.handSize', { n: size }));
  await handCards(page).first().click();
  await page.getByTestId('play').click();
  await idle(page);
  await expect(page.getByTestId('hand-size')).toHaveText(
    t('game.hand.handSizeDelta', { n: size - 1, delta: -1 }),
  );
  await expect(page.getByTestId('hand-size')).toHaveClass(/is-reduced/);
  await expect(page.getByTestId('toast-hand-size')).toContainText(
    t('game.hand.handSizeDownBoss', { name, n: size - 1 }),
  );
  await expect(handCards(page)).toHaveCount(size - 1);
  await shot(page, 'round-great-flood');
  expectCleanConsole(log);
});

// ─────────────────────────── 5. Štítky ───────────────────────────

test('přeskočení Malé útraty: štítek v levém panelu s tooltipem, štítek s obálkou ji otevře hned', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  const state = newState('E2ESEF-STITEK');
  state.blinds[0]!.skipTagId = 'boss_flu';
  state.blinds[1]!.skipTagId = 'uncle_envelope';
  await seedSavedRun(page, state);
  await continueRun(page);
  const flu = tagTexts('boss_flu', { registry: REG });
  const uncle = tagTexts('uncle_envelope', { registry: REG });

  // Výběr útraty: štítek za přeskočení s názvem a popisem; panel štítků je zatím prázdný.
  await expect(page.getByTestId('blind-small')).toContainText(flu.name);
  await expect(page.getByTestId('blind-small')).toContainText(flu.desc);
  await expect(page.getByTestId('active-tags')).toBeHidden();
  // Cíl šéfa po přeskočení (Šéf má chřipku: −25 %) — spočítaný enginem nad kopií stavu.
  const skipped = Game.fromState(structuredClone(state), REG);
  const before = skipped.blindTarget('boss', state.blinds[2]!.bossId);
  expect(skipped.dispatch({ type: 'skipBlind' }).ok).toBe(true);
  const bossTarget = skipped.blindTarget('boss', state.blinds[2]!.bossId);
  expect(bossTarget).toBeLessThan(before);

  // Přeskočit → štítek je v levém panelu, tooltip s názvem, popisem a hláškou; cíl šéfa −25 %.
  await page.getByTestId('blind-skip-small').click();
  await idle(page);
  const tags = page.getByTestId('active-tags');
  await expect(tags).toBeVisible();
  await expect(tags.locator('.kcard')).toHaveCount(1);
  await expect(tags.locator('.kcard')).toHaveAttribute('data-def-id', 'boss_flu');
  await tags.locator('.kcard').hover();
  await expect(tooltip(page)).toContainText(flu.name);
  await expect(tooltip(page)).toContainText(flu.desc);
  await expect(tooltip(page)).toContainText(flu.flavor!);
  await expect(page.getByTestId('blind-boss').locator('.blind-card__target')).toHaveText(
    formatNumber(bossTarget),
  );
  await shot(page, 'tags-sidebar');
  await page.mouse.move(5, 5);

  // Info o runu vypíše aktivní štítky.
  await page.getByTestId('run-info').click();
  await expect(page.getByTestId('run-info-modal')).toContainText(flu.name);
  await page.getByTestId('run-info-close').click();

  // Přeskočit Velkou za Obálku od strýce → obálka žolíků se otevře hned, zavření vrátí výběr útraty.
  await page.getByTestId('blind-skip-big').click();
  await idle(page);
  await expect(page.getByTestId('booster')).toBeVisible();
  // Jedna hláška: přeskočení se štítkem a co udělal.
  const skipToast = page.getByTestId('toast-game-info').filter({ hasText: uncle.name });
  await expect(skipToast).toContainText(uncle.desc);
  await expect(page.getByTestId('toast-tag')).toHaveCount(0);
  await shot(page, 'tag-booster');
  await page.getByTestId('booster-skip').click();
  await idle(page);
  await expect(page.getByTestId('blind-select')).toBeVisible();
  await expect(page.getByTestId('blind-boss')).toHaveAttribute('data-status', 'current');
  await expect(tags.locator('.kcard')).toHaveCount(1);
  expectCleanConsole(log);
});

test('Večerka po štítcích: žolík navíc se slevou, edice bez příplatku a kupón navíc mají nálepku', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: false });
  // Run těsně po vyhraném kole se třemi štítky „na příští Večerku“ (připravené enginem).
  const g = Game.fromState(newState('E2ESEF-VECERKA'), REG);
  for (const id of ['referral', 'polished_cutlery', 'mailbox_flyer']) g._core.api.addTag(id);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  g._core.state.round!.target = 1;
  expect(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }).ok).toBe(true);
  expect(g.state.phase).toBe('round_end');
  await seedSavedRun(page, structuredClone(g.state) as RunState);
  await continueRun(page);
  await expect(page.getByTestId('active-tags').locator('.kcard')).toHaveCount(3);

  await page.getByTestId('cash-out').click();
  await idle(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  const run = await readRun(page);
  const extraSlot = run.shop!.items.findIndex((i) => i.extra);
  const editionSlot = run.shop!.items.findIndex((i) => !i.extra && i.noEditionSurcharge);
  const voucherSlot = run.shop!.vouchers.findIndex((v) => v.extra);
  expect(extraSlot).toBeGreaterThanOrEqual(0);
  expect(voucherSlot).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId(`shop-item-${extraSlot}-badge`)).toHaveText(
    `${t('game.shop.badgeExtra')} · ${t('game.shop.badgeDiscount', { pct: 50 })}`,
  );
  if (editionSlot >= 0)
    await expect(page.getByTestId(`shop-item-${editionSlot}-badge`)).toHaveText(t('game.shop.badgeEdition'));
  await expect(page.getByTestId(`shop-voucher-${voucherSlot}-badge`)).toHaveText(t('game.shop.badgeExtra'));
  // Štítky se spotřebovaly: hlášky a prázdný panel.
  await expect(page.getByTestId('toast-tag')).toHaveCount(3);
  await expect(page.getByTestId('active-tags')).toBeHidden();
  await shot(page, 'shop-tags');
  expectCleanConsole(log);
});

test('Imperial: Velká útrata má pravidlo šéfa navíc ve výběru, na plakátu i v levém panelu', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetSettings(page, { speed: 4 });
  const s = structuredClone(
    Game.newRun({ deckId: 'pub', stake: 8, seed: 'E2ESEF-IMP' }, REG).state,
  ) as RunState;
  const extra = s.blinds[1]!.bossId!;
  expect(REG.bosses[extra]).toBeDefined();
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'current';
  s.blindIndex = 1;
  await seedSavedRun(page, s);
  await continueRun(page);
  const rule = t('game.blinds.extraRule', { rule: bossTexts(extra, { registry: REG }).rule });

  await expect(page.getByTestId('blind-big').locator('.blind-card__rule')).toHaveText(rule);
  await shot(page, 'blind-select-imperial');
  await page.getByTestId('blind-select-big').click();
  await expect(page.getByTestId('boss-banner')).toContainText(t('game.bossBanner.extraLabel'));
  await idle(page);
  await expect(page.getByTestId('blind-name')).toHaveText(t('art.blind.big'));
  await expect(page.getByTestId('blind-rule')).toHaveText(rule);
  expectCleanConsole(log);
});
