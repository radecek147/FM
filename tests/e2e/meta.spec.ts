import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { RunState } from '../../src/engine';
import { serializeRun } from '../../src/engine';
import type { Profile } from '../../src/engine/meta';
import { collectionState, createProfile, dailyRunSetup, serializeProfile } from '../../src/engine/meta';
import { t } from '../../src/i18n/cs';
import { unlockInfo } from '../../src/ui/metaText';
import {
  REG,
  expectCleanConsole,
  finalBossState,
  game,
  handCards,
  idle,
  selectByKeys,
  watchConsole,
} from './helpers';

/**
 * Meta vrstva fáze 8 od začátku do konce:
 *  1. čerstvý profil — zamčené balíčky a síly piva v Nové hře, sbírka se siluetami a podmínkami,
 *  2. výhra runu (uložený run těsně před porážkou šéfa patra 8) — další síla piva, oznámení, historie, statistiky,
 *     achievement,
 *  3. seedovaný run se do odemykání, statistik ani achievementů nepočítá (jen historie),
 *  4. denní run — seed `DEN-…`, oficiální pokus, druhý pokus mimo soutěž, výsledek ke sdílení,
 *  5. výzvy — zamčené s podmínkou, start, pravidla v Info o runu,
 *  6. tutoriál Štamgast — bubliny podle hry, přeskočení, znovu zapnout v Nastavení,
 *  7. export → reset → import profilu; poškozený profil → záloha a oznámení,
 *  8. sbírka — filtr, řazení, štítek „Nové“.
 * Ostatní e2e testy tutoriál vypínají parametrem `?tutorial=off`. Konzole musí zůstat bez chyb a varování.
 */

const screen = (page: Page) => page.locator('#app');
const NOW = '2026-10-02T00:00:00.000Z';

/** Profil s vypnutými animacemi a tutoriálem, upravený funkcí `edit` (výzvy a odemčení dopočítá hra při startu). */
function profileJson(edit: (p: Profile) => void = () => {}, tutorial = false): string {
  const p = createProfile(NOW);
  p.settings.animations = false;
  p.settings.tutorial = tutorial;
  edit(p);
  return serializeProfile(p, NOW);
}

function profileWithWins(won: number, tutorial = false): string {
  return profileJson((p) => {
    p.stats.runs.won = won;
    p.stats.runs.played = won;
  }, tutorial);
}

/** Vloží profil do localStorage (jen když v kontextu ještě žádný není). */
async function presetProfile(page: Page, raw: string): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.profile')) localStorage.setItem('karban.profile', value);
  }, raw);
}

/** Vloží uložený run (jen při prvním načtení stránky v kontextu). */
async function presetRun(page: Page, state: RunState): Promise<void> {
  await page.addInitScript(
    (value) => {
      if (!sessionStorage.getItem('karban-e2e-run')) {
        localStorage.setItem('karban.run', value);
        sessionStorage.setItem('karban-e2e-run', '1');
      }
    },
    serializeRun(state, NOW),
  );
}

/** Profil z localStorage (data obálky). */
async function storedProfile(page: Page): Promise<Profile> {
  const raw = await page.evaluate(() => localStorage.getItem('karban.profile'));
  if (!raw) throw new Error('V localStorage není profil.');
  return (JSON.parse(raw) as { data: Profile }).data;
}

/** Klíče záloh profilu v localStorage → surová data. */
async function storedBackups(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const k of Object.keys(localStorage))
      if (k.startsWith('karban.profile.backup.')) out[k] = localStorage.getItem(k)!;
    return out;
  });
}

/** Všechny viditelné ovládací prvky v obrazovce mají přístupný název. */
async function expectNamedControls(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#app button, #app [role="button"], #app a[href]')]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => !(el.getAttribute('aria-label') ?? el.textContent ?? '').trim())
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
}

/** Menu → Pokračovat → herní obrazovka. */
async function continueFromMenu(page: Page): Promise<void> {
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

/** Výběr útraty → Malá útrata → jednotlivé karty, dokud run neskončí (žádná karta sama cíl nedá). */
async function loseFirstBlind(page: Page): Promise<void> {
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await page.getByTestId('blind-select-small').click();
  await idle(page);
  for (let i = 0; i < 12; i++) {
    if ((await game(page).getAttribute('data-phase')) === 'game_over') break;
    await handCards(page).first().click();
    await page.getByTestId('play').click();
    await idle(page);
  }
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over');
}

const decks = Object.values(REG.decks);
const stakes = Object.values(REG.stakes).sort((a, b) => a.level - b.level);
const stakeId = (level: number): string => stakes.find((s) => s.level === level)!.id;

// ─────────────────────────── 1. Čerstvý profil ───────────────────────────

test('čerstvý profil: zamčené balíčky a síly piva v Nové hře, sbírka ukazuje siluety a podmínky', async ({
  page,
}) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  // Profil se založí a hned uloží; čerstvý profil nemá co oznamovat.
  const fresh = await storedProfile(page);
  expect(fresh.stats.runs.played).toBe(0);
  expect(fresh.unlocks.decks).toEqual([]);
  await expect(page.locator('.toast--meta')).toHaveCount(0);
  await expect(page.getByTestId('menu-challenges').locator('.btn__badge')).toHaveCount(0);

  // ── Nová hra: odemčené jen balíčky bez podmínky, zamčené s podmínkou a průběhem ──
  await page.getByTestId('menu-new-game').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'newGame');
  const open = decks.filter((d) => !d.unlock);
  expect(open.map((d) => d.id)).toEqual(['pub', 'regulars']);
  await expect(page.getByTestId('deck-unlocked-count')).toHaveText(
    t('newGame.deck.unlockedCount', { n: open.length, total: decks.length }),
  );
  const profile = createProfile(NOW);
  for (const deck of decks) {
    const item = page.getByTestId(`deck-${deck.id}`);
    if (!deck.unlock) {
      await expect(item).not.toHaveAttribute('data-locked', 'true');
      continue;
    }
    await expect(item).toHaveAttribute('data-locked', 'true');
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    const info = unlockInfo(profile, REG, 'decks', deck.id)!;
    const condition = page.getByTestId(`deck-condition-${deck.id}`);
    await expect(condition).toContainText(info.text);
    if (info.progressText) await expect(condition).toContainText(info.progressText);
  }
  await expect(page.getByTestId('deck-tourist')).toHaveAccessibleName(
    t('newGame.deck.lockedLabel', { name: t('decks.tourist.name') }),
  );
  // Zamčený balíček nejde vybrat myší ani šipkami (radiogroup ho přeskočí).
  await expect(page.getByTestId('deck-pub')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('deck-clerk').click({ force: true });
  await expect(page.getByTestId('deck-clerk')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('deck-pub')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('deck-pub').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('deck-regulars')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('deck-pub')).toBeFocused();
  await expect(page.getByTestId('deck-pub')).toHaveAttribute('aria-checked', 'true');

  // Síla piva: jen Desítka, ostatní zamčené s poznámkou, co odemkne další úroveň.
  await expect(page.getByTestId('stake-1')).toHaveAttribute('aria-checked', 'true');
  for (const s of stakes.slice(1))
    await expect(page.getByTestId(`stake-${s.level}`)).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('stake-2').click({ force: true });
  await expect(page.getByTestId('stake-2')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('stake-1')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('stake-lock-note')).toBeVisible();
  await expect(page.getByTestId('stake-lock-note')).toContainText(t(`stakes.${stakeId(2)}.name`));
  await expect(page.getByTestId('stake-lock-note')).toContainText(t('decks.pub.name'));
  await expectNamedControls(page);
  await page.screenshot({ path: 'test-results/meta-fresh-newgame.png', fullPage: true });

  // ── Sbírka: nic objeveného, siluety, zamčené s podmínkou, neobjevené „???“ ──
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-collection').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'collection');
  const jokers = Object.values(REG.jokers);
  await expect(page.getByTestId('codex-count')).toHaveText(
    t('meta.collection.count', { n: 0, total: jokers.length }),
  );
  const locked = jokers.filter((j) => collectionState(profile, REG, 'jokers', j.id) === 'locked');
  expect(locked.length).toBeGreaterThan(0);
  await expect(page.locator('.codex-item')).toHaveCount(jokers.length);
  await expect(page.locator('.codex-item[data-state="discovered"]')).toHaveCount(0);
  await expect(page.locator('.codex-item[data-state="locked"]')).toHaveCount(locked.length);
  await expect(page.locator('.codex-item__art:not(.is-silhouette)')).toHaveCount(0);

  // Zamčený žolík: „Zamčeno“, detail s podmínkou a průběhem.
  const herbalist = page.getByTestId('codex-item-herbalist');
  await expect(herbalist).toHaveAttribute('data-state', 'locked');
  await expect(herbalist.locator('.codex-item__name')).toHaveText(t('meta.collection.locked'));
  await herbalist.click();
  const herbInfo = unlockInfo(profile, REG, 'jokers', 'herbalist')!;
  await expect(page.getByTestId('codex-detail-condition')).toContainText(herbInfo.text);
  await expect(page.getByTestId('codex-detail-condition')).toContainText(herbInfo.progressText!);
  await expect(page.getByTestId('codex-detail-desc')).toHaveCount(0);
  await page.getByTestId('codex-detail-close').click();

  // Odemčený, ale neobjevený žolík: „???“ a nápověda, žádný popis.
  const common = jokers.find((j) => collectionState(profile, REG, 'jokers', j.id) === 'unknown')!;
  const unknown = page.getByTestId(`codex-item-${common.id}`);
  await expect(unknown).toHaveAttribute('data-state', 'unknown');
  await expect(unknown.locator('.codex-item__name')).toHaveText(t('meta.collection.unknownName'));
  await unknown.click();
  await expect(page.getByTestId('codex-detail-note')).toHaveText(t('meta.collection.unknownHint'));
  await expect(page.getByTestId('codex-detail-condition')).toHaveCount(0);
  await page.getByTestId('codex-detail-close').click();

  // Balíčky a síly piva ukazují název i zamčené, s podmínkou.
  await page.getByTestId('codex-tab-decks').click();
  await expect(page.getByTestId('codex-item-clerk')).toHaveAttribute('data-state', 'locked');
  await page.getByTestId('codex-item-clerk').click();
  await expect(page.getByTestId('codex-detail-condition')).toContainText(
    unlockInfo(profile, REG, 'decks', 'clerk')!.text,
  );
  await page.getByTestId('codex-detail-close').click();
  await page.getByTestId('codex-tab-stakes').click();
  await expect(page.getByTestId(`codex-item-${stakeId(2)}`)).toHaveAttribute('data-state', 'locked');
  await page.getByTestId('codex-tab-achievements').click();
  await expect(page.locator('.codex-item[data-state="discovered"]')).toHaveCount(0);
  await expect(page.getByTestId('codex-item-closing_time')).toHaveAttribute('data-state', 'locked');
  await expectNamedControls(page);
  expectCleanConsole(log);
});

// ─────────────────────────── 2. Výhra runu ───────────────────────────

test('výhra runu: další síla piva pro balíček, oznámení, achievement, záznam v historii a statistikách', async ({
  page,
}) => {
  const log = watchConsole(page);
  const { state, play } = finalBossState('E2EVYHRA');
  await presetProfile(page, profileJson());
  await presetRun(page, state);
  await page.goto('/?tutorial=off');
  await continueFromMenu(page);
  await expect(page.getByTestId('ante')).toHaveText('8/8');
  // Run z uložení, který profil nezná, se zaeviduje jako započítaný run hlavní hry.
  const before = await storedProfile(page);
  expect(before.current).toMatchObject({ seed: 'E2EVYHRA', mode: 'normal', seeded: false, counted: true });

  await selectByKeys(page, state.round!.hand, play);
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'victory', { timeout: 30_000 });
  await idle(page);

  // Souhrn novinek runu na výherní obrazovce — tytéž novinky se už neohlašují toasty (1.0.1: nepřekážejí výhře).
  await expect(page.getByTestId('run-news')).toBeVisible();
  await expect(page.locator('.toast--meta:not(.toast--leaving)')).toHaveCount(0);
  const jedenactka = t(`stakes.${stakeId(2)}.name`);
  const news = page.getByTestId('run-news');
  await expect(news.getByTestId('run-news-stake')).toContainText(jedenactka);
  await expect(
    news.getByTestId('run-news-achievement').filter({ hasText: t('achievements.closing_time.name') }),
  ).toHaveCount(1);
  await expect(
    news.getByTestId('run-news-unlock').filter({ hasText: t('jokers.new_years_eve.name') }),
  ).toHaveCount(1);
  await page.screenshot({ path: 'test-results/meta-victory.png', fullPage: true });

  // Výhra je v profilu hned (statistiky, síla piva, achievement); historie až po odchodu z výherní obrazovky.
  const won = await storedProfile(page);
  expect(won.unlocks.stakes.pub).toBe(2);
  expect(won.stats.runs).toMatchObject({ played: 1, won: 1, currentStreak: 1 });
  expect(won.stats.byDeck.pub).toMatchObject({ played: 1, won: 1, bestStake: 1 });
  expect(won.achievements.unlocked.closing_time).toBeTruthy();
  expect(won.unlocks.jokers).toContain('new_years_eve');
  expect(won.unlocks.challenges).toHaveLength(5);
  expect(won.history).toHaveLength(0);

  // Další síla piva je v seznamu, ne v toastu (fronta ji vyřadila).
  await page.waitForTimeout(500);
  await expect(page.getByTestId('toast-unlock').filter({ hasText: jedenactka })).toHaveCount(0);

  await page.getByTestId('victory-end').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  const closed = await storedProfile(page);
  expect(closed.current).toBeNull();
  expect(closed.history).toHaveLength(1);
  expect(closed.history[0]).toMatchObject({
    seed: 'E2EVYHRA',
    deckId: 'pub',
    stake: 1,
    mode: 'normal',
    outcome: 'won',
    ante: 8,
    seeded: false,
  });
  // Menu: nové výzvy (odemčené první výhrou).
  await expect(page.getByTestId('menu-challenges').locator('.btn__badge')).toHaveText(
    t('menu.challenges.badge', { n: 5 }),
  );

  // Statistiky: výhra v přehledu, run v historii.
  await page.getByTestId('menu-stats').click();
  await expect(page.getByTestId('stats-played')).toHaveText('1');
  await expect(page.getByTestId('stats-won')).toHaveText('1');
  await page.getByTestId('stats-tab-history').click();
  const entry = page.getByTestId(`history-${closed.history[0]!.no}`);
  await expect(entry).toHaveAttribute('data-outcome', 'won');
  await expect(entry).toContainText('E2EVYHRA');
  await expect(entry).toContainText(t('meta.history.mode.normal'));
  await page.getByTestId('back').click();

  // Sbírka: získaný achievement.
  await page.getByTestId('menu-collection').click();
  await page.getByTestId('codex-tab-achievements').click();
  await expect(page.getByTestId('codex-item-closing_time')).toHaveAttribute('data-state', 'discovered');
  await page.getByTestId('back').click();

  // Nová hra: Jedenáctka pro Hospodský odemčená, tácek s vyhranou silou piva; pro jiný balíček ne.
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('stake-2')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('stake-3')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('deck-coaster-pub')).toBeVisible();
  await page.getByTestId('stake-2').click();
  await expect(page.getByTestId('stake-2')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('deck-regulars').click();
  await expect(page.getByTestId('stake-2')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('stake-1')).toHaveAttribute('aria-checked', 'true');
  expectCleanConsole(log);
});

// ─────────────────────────── 3. Seedovaný run ───────────────────────────

test('seedovaný run: výhra jde jen do historie, ne do odemykání, statistik ani achievementů', async ({
  page,
}) => {
  const log = watchConsole(page);
  const seed = 'E2ESEMNK';
  const { state, play } = finalBossState(seed);
  await presetProfile(page, profileJson());
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('seed-input').fill(seed.toLowerCase());
  await expect(page.getByTestId('seed-status')).toHaveAttribute('data-state', 'seeded');
  await expect(page.getByTestId('seed-status')).toHaveText(t('newGame.seed.seededNote'));
  await page.getByTestId('newgame-start').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  const started = await storedProfile(page);
  expect(started.current).toMatchObject({ seed, seeded: true, counted: false });
  // „Semínko zaseto“ je jediný achievement, který seedovaný run dává.
  expect(Object.keys(started.achievements.unlocked)).toEqual(['seed_sown']);

  // Stejný run (seed, balíček, síla piva) těsně před porážkou šéfa patra 8 — profil ho dál vede jako seedovaný.
  await page.evaluate((raw) => localStorage.setItem('karban.run', raw), serializeRun(state, NOW));
  await page.goto('/?tutorial=off');
  await continueFromMenu(page);
  await selectByKeys(page, state.round!.hand, play);
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'victory', { timeout: 30_000 });
  await idle(page);
  const news = page.getByTestId('run-news');
  await expect(news).toContainText(t('meta.runEnd.notCounted'));
  await expect(news.getByTestId('run-news-stake')).toHaveCount(0);
  await expect(news.getByTestId('run-news-unlock')).toHaveCount(0);
  await expect(page.getByTestId('toast-unlock')).toHaveCount(0);

  const won = await storedProfile(page);
  expect(won.unlocks.stakes.pub ?? 1).toBe(1);
  expect(won.unlocks.challenges).toEqual([]);
  expect(won.unlocks.jokers).toEqual([]);
  expect(won.stats.runs).toMatchObject({ played: 0, won: 0 });
  expect(won.stats.totals.handsPlayed).toBe(0);
  expect(won.stats.bestHand).toBeNull();
  expect(Object.keys(won.achievements.unlocked)).toEqual(['seed_sown']);

  await page.getByTestId('victory-end').click();
  const closed = await storedProfile(page);
  expect(closed.history).toHaveLength(1);
  expect(closed.history[0]).toMatchObject({ seed, outcome: 'won', seeded: true, mode: 'normal' });
  expect(closed.stats.runs.played).toBe(0);

  await page.getByTestId('menu-stats').click();
  await expect(page.getByTestId('stats-won')).toHaveText('0');
  await page.getByTestId('stats-tab-history').click();
  const entry = page.getByTestId(`history-${closed.history[0]!.no}`);
  await expect(entry).toHaveAttribute('data-outcome', 'won');
  await expect(entry).toContainText(t('meta.history.seeded'));
  await page.getByTestId('back').click();
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('stake-2')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('deck-coaster-pub')).toHaveCount(0);
  expectCleanConsole(log);
});

// ─────────────────────────── 4. Denní run ───────────────────────────

test('denní run: seed DEN-…, oficiální pokus, druhý pokus mimo soutěž, výsledek ke sdílení', async ({
  page,
  context,
}) => {
  const log = watchConsole(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await presetProfile(page, profileWithWins(0));
  await page.goto('/?tutorial=off');
  const nowIso = new Date().toISOString();
  const setup = dailyRunSetup(nowIso, REG);
  const today = nowIso.slice(0, 10).replace(/-/g, '');
  expect(setup.seed).toBe(`DEN-${today}`);

  await expect(page.getByTestId('menu-daily').locator('.btn__badge')).toHaveText(t('menu.daily.badge'));
  await page.getByTestId('menu-daily').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'daily');
  await expect(page.getByTestId('daily-seed')).toHaveText(setup.seed);
  await expect(page.getByTestId('daily-deck')).toHaveText(t(`decks.${setup.deckId}.name`));
  await expect(page.getByTestId('daily-stake')).toHaveText(t(`stakes.${stakeId(setup.stake)}.name`));
  await expect(page.getByTestId('daily-today')).toHaveAttribute('data-state', 'available');
  await expect(page.getByTestId('daily-replay')).toHaveCount(0);
  await expectNamedControls(page);
  await page.screenshot({ path: 'test-results/daily.png', fullPage: true });

  // ── Oficiální pokus: run s balíčkem a silou ze seedu, celý obsah ──
  await page.getByTestId('daily-play').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('karban.run') ?? 'null'));
  expect(run.data).toMatchObject({ seed: setup.seed, daily: true, deckId: setup.deckId, stake: setup.stake });
  const official = await storedProfile(page);
  expect(official.current).toMatchObject({ mode: 'daily', official: true, counted: true });
  expect(official.daily[today]).toMatchObject({ status: 'playing', seed: setup.seed });

  // Odchod do menu a Pokračovat z obrazovky denního runu.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-daily').locator('.btn__badge')).toHaveCount(0);
  await page.getByTestId('menu-daily').click();
  await expect(page.getByTestId('daily-today')).toHaveAttribute('data-state', 'playing');
  await page.getByTestId('daily-continue').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  await idle(page);
  await loseFirstBlind(page);

  // Pitva: výsledek ke sdílení (oficiální pokus — bez poznámky „mimo soutěž“), kopírování do schránky.
  const finished = await storedProfile(page);
  const rec = finished.daily[today]!;
  expect(rec).toMatchObject({ status: 'finished', outcome: 'lost', ante: 1 });
  const share = t('meta.daily.share', { seed: setup.seed, ante: 1, score: rec.bestHand });
  const daily = page.getByTestId('run-daily');
  await expect(daily.getByTestId('run-daily-share-text')).toHaveText(share);
  await expect(daily).not.toContainText(t('meta.runEnd.dailyUnofficial'));
  await daily.getByTestId('run-daily-share').click();
  await expect(page.getByTestId('toast-daily-share')).toContainText(t('meta.daily.copied'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(share);
  expect(finished.history[0]).toMatchObject({ mode: 'daily', official: true, outcome: 'lost' });
  expect(finished.stats.runs.played).toBe(1);

  // ── Denní run po oficiálním pokusu: výsledek, „Hrát znovu mimo soutěž“ ──
  await page.getByTestId('game-over-menu').click();
  await expect(page.getByTestId('menu-daily').locator('.btn__badge')).toHaveCount(0);
  await page.getByTestId('menu-daily').click();
  await expect(page.getByTestId('daily-today')).toHaveAttribute('data-state', 'finished');
  await expect(page.getByTestId('daily-share-text')).toHaveText(share);
  await expect(page.getByTestId('daily-play')).toHaveCount(0);
  await expect(page.getByTestId(`daily-${today}`)).toBeVisible();
  await page.getByTestId('daily-replay').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  const replay = await storedProfile(page);
  expect(replay.current).toMatchObject({ seed: setup.seed, mode: 'daily', official: false, counted: false });
  await idle(page);
  await loseFirstBlind(page);
  await expect(page.getByTestId('run-daily')).toContainText(t('meta.runEnd.dailyUnofficial'));
  await expect(page.getByTestId('run-news')).toContainText(t('meta.runEnd.notCounted'));

  // Pokus mimo soutěž oficiální výsledek ani statistiky nemění; v historii je s poznámkou.
  const after = await storedProfile(page);
  expect(after.daily[today]).toEqual(rec);
  expect(after.stats.runs.played).toBe(1);
  expect(after.history[0]).toMatchObject({ mode: 'daily', official: false, outcome: 'lost' });
  await page.getByTestId('game-over-menu').click();
  await page.getByTestId('menu-stats').click();
  await page.getByTestId('stats-tab-history').click();
  await expect(page.getByTestId(`history-${after.history[0]!.no}`)).toContainText(
    t('meta.history.mode.dailyUnofficial'),
  );
  await expect(page.getByTestId(`history-${after.history[1]!.no}`)).toContainText(
    t('meta.history.mode.daily'),
  );
  await page.getByTestId('stats-tab-daily').click();
  await expect(page.getByTestId(`daily-${today}`)).toContainText(share);
  expectCleanConsole(log);
});

// ─────────────────────────── 5. Výzvy ───────────────────────────

test('výzvy: zamčené s podmínkou, po výhře odemčená várka, start výzvy → pravidla v Info o runu', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetProfile(page, profileWithWins(1));
  await page.goto('/?tutorial=off');
  // Odemčení z profilu se oznámí toasty s ikonou (nejvýš dva naráz, další čekají ve frontě).
  await expect(page.getByTestId('toast-unlock').first()).toBeVisible();
  await expect(page.getByTestId('toast-unlock').first().locator('.toast__media svg')).toBeVisible();
  expect(await page.locator('.toast--meta:not(.toast--leaving)').count()).toBeLessThanOrEqual(2);

  await page.getByTestId('menu-challenges').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'challenges');
  await expect(page.locator('.challenge-item')).toHaveCount(20);
  await expect(page.locator('.challenge-item[data-status="open"]')).toHaveCount(5);
  await expect(page.locator('.challenge-item[data-status="locked"]')).toHaveCount(15);

  // Zamčená výzva: podmínka s průběhem, žádné tlačítko Hrát.
  await page.getByTestId('challenge-dry_february').click();
  await expect(page.getByTestId('challenge-detail')).toHaveAttribute('data-status', 'locked');
  await expect(page.getByTestId('challenge-condition')).toContainText('10');
  await expect(page.getByTestId('challenge-start')).toHaveCount(0);

  // Odemčená výzva: pravidla a start (klávesnicí — šipky v seznamu, Tab na detail).
  const greenhouse = REG.challenges.greenhouse!;
  await page.getByTestId('challenge-greenhouse').click();
  await expect(page.getByTestId('challenge-rules').locator('li')).toHaveCount(greenhouse.ruleKeys!.length);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('challenge-detail')).toHaveAttribute('data-challenge', 'christmas_carp');
  await page.keyboard.press('ArrowUp');
  await expectNamedControls(page);
  await page.screenshot({ path: 'test-results/challenges.png', fullPage: true });
  await page.getByTestId('challenge-start').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('karban.run') ?? 'null'));
  expect(run.data.challengeId).toBe('greenhouse');
  expect(run.data.deckId).toBe(greenhouse.deckId);
  // Pravidla výzvy platí: ♥ a ♦ jsou skleněné, ve slotech dvě babské rady.
  const cards = run.data.deck as { suit: string; enhancement: string | null }[];
  expect(cards.filter((c) => c.suit === 'H' || c.suit === 'D').every((c) => c.enhancement === 'glass')).toBe(
    true,
  );
  expect((run.data.consumables as { defId: string }[]).map((c) => c.defId)).toEqual(
    greenhouse.startingConsumables,
  );
  const profile = await storedProfile(page);
  expect(profile.current).toMatchObject({ mode: 'challenge', challengeId: 'greenhouse', counted: true });
  expect(profile.stats.challenges.greenhouse).toMatchObject({ attempts: 1, completed: 0 });

  // Info o runu: název výzvy a všechna její pravidla.
  await idle(page);
  await page.getByTestId('run-info').click();
  const modal = page.getByTestId('run-info-modal');
  await expect(modal.getByTestId('run-info-challenge')).toContainText(t('challenges.greenhouse.name'));
  const section = modal.locator('.run-info__section', { has: page.getByTestId('run-info-challenge') });
  await expect(section.locator('li')).toHaveCount(greenhouse.ruleKeys!.length);
  await page.screenshot({ path: 'test-results/challenge-run-info.png' });
  await page.getByTestId('run-info-close').click();
  await expect(modal).toBeHidden();
  expectCleanConsole(log);
});

// ─────────────────────────── 6. Tutoriál ───────────────────────────

test('tutoriál Štamgast: bubliny podle hry, nebrání hraní, jde přeskočit a v Nastavení zapnout znovu', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetProfile(page, profileWithWins(0, true));
  await page.goto('/');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('newgame-start').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  const bubble = page.getByTestId('tutorial');
  // Výběr útraty: žádná rada (přeskakování přijde až po první výplatě).
  await expect(bubble).toBeHidden();
  await page.getByTestId('blind-select-small').click();
  await idle(page);
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute('data-step', 'select');
  await expect(bubble).toHaveAttribute('aria-modal', 'false');
  await expect(bubble.locator('.tutorial__avatar svg')).toBeVisible();
  await expect(page.getByTestId('tutorial-next')).toHaveAccessibleName(/Rozumím/);
  await page.screenshot({ path: 'test-results/tutorial-select.png' });

  // Bublina nebere focus a nebrání výběru karty ani zahrání (klávesnicí i myší).
  const firstCard = page.getByTestId('hand').locator('.pcard').first();
  await firstCard.click();
  await expect(bubble).toHaveAttribute('data-step', 'play');
  await page.getByTestId('play').click();
  await idle(page);
  await expect(bubble).toHaveAttribute('data-step', 'discard');
  await page.getByTestId('tutorial-next').click();
  await expect(bubble).toHaveAttribute('data-step', 'goal');

  // Přeskočit celý tutoriál.
  await page.getByTestId('tutorial-skip').click();
  await expect(bubble).toBeHidden();
  await expect(page.getByTestId('toast-tutorial-skipped')).toBeVisible();
  const tutorial = await page.evaluate(
    () => JSON.parse(localStorage.getItem('karban.profile')!).data.tutorial,
  );
  expect(tutorial.skipped).toBe(true);
  expect(tutorial.seen).toEqual(expect.arrayContaining(['select', 'play', 'discard']));

  // Přeskočený tutoriál se po načtení stránky nevrací.
  await page.reload();
  await continueFromMenu(page);
  await expect(bubble).toBeHidden();

  // Nastavení ze hry → Zapnout tutoriál znovu → rady od začátku.
  await page.getByTestId('game-settings').click();
  await page.getByTestId('settings-tutorial-restart').click();
  await expect(page.getByTestId('settings-tutorial')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute('data-step', 'select');
  expectCleanConsole(log);
});

// ─────────────────────────── 7. Export, reset, import, poškozený profil ───────────────────────────

test('export → reset → import profilu obnoví odemčení, statistiky i achievementy; zálohy zůstanou', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetProfile(
    page,
    profileJson((p) => {
      p.stats.runs.played = 4;
      p.stats.runs.won = 3;
      p.stats.byDeck.pub = { played: 4, won: 3, bestStake: 2 };
      p.unlocks.stakes.pub = 3;
    }),
  );
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-settings').click();

  // Export: soubor JSON s profilem v aktuální verzi.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  const download = await downloadPromise;
  const exportedText = readFileSync((await download.path())!, 'utf8');
  const exported = JSON.parse(exportedText);
  expect(exported.profile.data.stats.runs.won).toBe(3);
  expect(exported.profile.data.unlocks.stakes.pub).toBe(3);
  // Tři výhry: odemčené výzvy 1–10 a achievement Zavíračka (dopočítané při startu).
  expect(exported.profile.data.unlocks.challenges).toHaveLength(10);
  expect(exported.profile.data.achievements.unlocked.closing_time).toBeTruthy();
  const achievements = Object.keys(exported.profile.data.achievements.unlocked).length;

  // Reset (dvojí potvrzení) → čistý profil, předchozí v záloze.
  await page.getByTestId('settings-reset').click();
  await page.getByTestId('reset-confirm-1').getByTestId('confirm-ok').click();
  await page.getByTestId('reset-confirm-2').getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast-reset-done')).toBeVisible();
  const reset = await storedProfile(page);
  expect(reset.stats.runs.won).toBe(0);
  expect(reset.unlocks.stakes).toEqual({});
  const afterReset = await storedBackups(page);
  expect(Object.values(afterReset).map((raw) => JSON.parse(raw).data.stats.runs.won)).toEqual([3]);
  await page.getByTestId('back').click();
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('stake-2')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('back').click();

  // Import exportu → potvrzení s obsahem souboru → stav jako před resetem.
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-import-file').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  const confirm = page.getByTestId('import-confirm');
  await expect(confirm).toContainText(t('settings.import.summary.profile', { runs: 4, achievements }));
  await confirm.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast-import-done')).toBeVisible();
  const imported = await storedProfile(page);
  expect(imported.stats.runs).toMatchObject({ played: 4, won: 3 });
  expect(imported.unlocks.stakes.pub).toBe(3);
  expect(imported.unlocks.challenges).toHaveLength(10);
  expect(Object.keys(imported.achievements.unlocked)).toHaveLength(achievements);
  // Import přepisovaný (čistý) profil taky zazálohoval — obě zálohy jsou na místě.
  const afterImport = await storedBackups(page);
  expect(
    Object.values(afterImport)
      .map((raw) => JSON.parse(raw).data.stats.runs.won)
      .sort(),
  ).toEqual([0, 3]);

  await page.getByTestId('back').click();
  await expect(page.getByTestId('menu-challenges')).toBeVisible();
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('stake-3')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('stake-4')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('deck-coaster-pub')).toBeVisible();
  expectCleanConsole(log);
});

test('poškozený profil v localStorage: hra se spustí, data jsou v záloze a hráč dostane oznámení', async ({
  page,
}) => {
  const log = watchConsole(page);
  const garbage = '{"format":"karban-save","kind":"profile","version":1,"data":{"stats":';
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('karban-e2e-corrupt')) {
      localStorage.setItem('karban.profile', value);
      sessionStorage.setItem('karban-e2e-corrupt', '1');
    }
  }, garbage);
  await page.goto('/?tutorial=off');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  const notice = page.getByTestId('toast-profile-corrupt');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(t('meta.profile.corruptTitle'));
  await page.screenshot({ path: 'test-results/meta-profile-corrupt.png' });

  // Původní data jsou nedotčená v záloze, na jejich místě je nový platný profil.
  const backups = await storedBackups(page);
  expect(Object.values(backups)).toEqual([garbage]);
  const fresh = await storedProfile(page);
  expect(fresh.stats.runs.played).toBe(0);

  // Hra jde normálně hrát a po načtení stránky se nic dalšího nezálohuje ani neoznamuje.
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('newgame-start').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await expect(page.getByTestId('toast-profile-corrupt')).toHaveCount(0);
  expect(Object.keys(await storedBackups(page))).toEqual(Object.keys(backups));

  // Záloha jde ven i v exportu uložení.
  await page.getByTestId('menu-settings').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  const exported = JSON.parse(readFileSync((await (await downloadPromise).path())!, 'utf8'));
  expect(exported.profileBackups).toEqual(backups);
  expectCleanConsole(log);
});

test('reset profilu: dvojí potvrzení, profil předtím v záloze', async ({ page }) => {
  const log = watchConsole(page);
  await presetProfile(page, profileWithWins(2));
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-reset').click();
  await page.getByTestId('reset-confirm-1').getByTestId('confirm-ok').click();
  await page.getByTestId('reset-confirm-2').getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast-reset-done')).toBeVisible();
  const stored = await page.evaluate(() => {
    const backups = Object.keys(localStorage).filter((k) => k.startsWith('karban.profile.backup.'));
    return {
      backups: backups.map((k) => JSON.parse(localStorage.getItem(k)!).data.stats.runs.won as number),
      won: JSON.parse(localStorage.getItem('karban.profile')!).data.stats.runs.won as number,
    };
  });
  expect(stored.won).toBe(0);
  expect(stored.backups).toContain(2);
  expectCleanConsole(log);
});

// ─────────────────────────── 8. Sbírka ───────────────────────────

test('sbírka: filtr vzácnosti a zaměření, řazení, štítek „Nové“ zmizí po prohlédnutí', async ({ page }) => {
  const log = watchConsole(page);
  const jokers = Object.values(REG.jokers);
  const byRarity = (r: string) => jokers.filter((j) => j.rarity === r);
  const commons = byRarity('common').slice(0, 4);
  const rare = byRarity('rare').find((j) => !j.unlock)!;
  const legendary = byRarity('legendary')[0]!;
  const found = [...commons, rare, legendary];
  const fresh = [commons[0]!, legendary];
  await presetProfile(
    page,
    profileJson((p) => {
      p.discovered.jokers = found.map((j) => j.id);
      p.unseen = fresh.map((j) => `jokers:${j.id}`);
      p.stats.jokerRounds = { [commons[2]!.id]: 4, [rare.id]: 9 };
    }),
  );
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('menu-collection').locator('.btn__badge')).toHaveText(
    t('menu.collection.badge', { n: fresh.length }),
  );
  await page.getByTestId('menu-collection').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'collection');
  await expect(page.getByTestId('codex-count')).toHaveText(
    t('meta.collection.count', { n: found.length, total: jokers.length }),
  );
  const tab = page.getByTestId('codex-tab-jokers');
  // Cedulka říká „N nových“ — holé číslo vedle počtu „x / y“ mátlo.
  await expect(tab.locator('.tabs__badge')).toHaveText(
    t('meta.collection.newBadgeCount', { n: fresh.length }),
  );
  for (const j of fresh)
    await expect(page.getByTestId(`codex-item-${j.id}`).locator('.codex-item__new')).toHaveText(
      t('meta.collection.newBadge'),
    );
  await expect(page.locator('.codex-item.is-new')).toHaveCount(fresh.length);
  // Objevený žolík má plnou kartu se jménem.
  const name = (id: string): string => t(`jokers.${id}.name`);
  await expect(page.getByTestId(`codex-item-${rare.id}`)).toHaveAttribute('data-state', 'discovered');
  await expect(page.getByTestId(`codex-item-${rare.id}`).locator('.codex-item__name')).toHaveText(
    name(rare.id),
  );

  // Filtr vzácnosti: jen legendární; pak zaměření; „Vše“ vrátí všechny.
  await page.getByTestId('codex-filter-rarity').selectOption('legendary');
  await expect(page.locator('.codex-item')).toHaveCount(byRarity('legendary').length);
  await expect(page.getByTestId(`codex-item-${legendary.id}`)).toHaveAttribute('data-state', 'discovered');
  await page.getByTestId('codex-filter-rarity').selectOption('');
  const tag = rare.tags[0]!;
  await page.getByTestId('codex-filter-tag').selectOption(tag);
  await expect(page.locator('.codex-item')).toHaveCount(jokers.filter((j) => j.tags.includes(tag)).length);
  await expect(page.getByTestId(`codex-item-${rare.id}`)).toBeVisible();
  await page.getByTestId('codex-filter-rarity').selectOption('epic');
  const none = jokers.filter((j) => j.rarity === 'epic' && j.tags.includes(tag)).length;
  if (none === 0) await expect(page.getByTestId('codex-empty')).toHaveText(t('meta.collection.emptyFilter'));
  else await expect(page.locator('.codex-item')).toHaveCount(none);
  await page.getByTestId('codex-filter-rarity').selectOption('');
  await page.getByTestId('codex-filter-tag').selectOption('');
  await expect(page.locator('.codex-item')).toHaveCount(jokers.length);

  // Řazení podle názvu: objevení abecedně (česky) napřed; podle použití: nejvíc kol ve slotu první.
  await page.getByTestId('codex-sort').selectOption('name');
  const names = found.map((j) => name(j.id)).sort((a, b) => a.localeCompare(b, 'cs'));
  const shown = await page.locator('.codex-item .codex-item__name').allTextContents();
  expect(shown.slice(0, found.length)).toEqual(names);
  await page.getByTestId('codex-sort').selectOption('usage');
  const ids = await page
    .locator('.codex-item')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
  expect(ids.slice(0, 2)).toEqual([rare.id, commons[2]!.id]);
  await page.getByTestId('codex-sort').selectOption('rarity');
  const first = await page.locator('.codex-item').first().getAttribute('data-id');
  expect(REG.jokers[first!]!.rarity).toBe('common');
  await expect(page.locator('.codex-item').last()).toHaveAttribute(
    'data-id',
    byRarity('legendary').at(-1)!.id,
  );

  // Detail sundá štítek „Nové“ (dlaždice, cedulka záložky, profil).
  await page.getByTestId(`codex-item-${commons[0]!.id}`).click();
  await expect(page.getByTestId('codex-detail-desc')).toBeVisible();
  await page.getByTestId('codex-detail-close').click();
  await expect(page.getByTestId(`codex-item-${commons[0]!.id}`).locator('.codex-item__new')).toHaveCount(0);
  await expect(tab.locator('.tabs__badge')).toHaveText(t('meta.collection.newBadgeCount', { n: 1 }));
  expect((await storedProfile(page)).unseen).toEqual([`jokers:${legendary.id}`]);

  // Odchod ze záložky sundá štítek i zbytku, co hráč v záložce viděl.
  await page.getByTestId('codex-tab-decks').click();
  await expect(tab.locator('.tabs__badge')).toBeHidden();
  expect((await storedProfile(page)).unseen).toEqual([]);
  await page.getByTestId('codex-tab-jokers').click();
  await expect(page.locator('.codex-item.is-new')).toHaveCount(0);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('menu-collection').locator('.btn__badge')).toHaveCount(0);
  expectCleanConsole(log);
});
