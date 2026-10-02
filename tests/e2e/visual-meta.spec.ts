import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import {
  DISCOVERY_CATEGORIES,
  Game,
  HAND_TYPES,
  createBot,
  createProfile,
  dailyDateKey,
  refreshMeta,
  serializeProfile,
  serializeRun,
  type DiscoveryCategory,
  type HistoryEntry,
  type Profile,
  type RunState,
  type TutorialStepId,
} from '../../src/engine';
import { VIEWPORTS, takeShot, watchProblems } from './visualKit';

/**
 * Vizuální kontrola meta obrazovek fáze 8: menu, nová hra se zamčenými položkami, sbírka (všechny záložky, čerstvý
 * i plný profil), statistiky a historie, výzvy, denní run, oznámení odemčení / achievementu, bubliny tutoriálu,
 * nastavení s exportem a importem, pitva a výhra s novinkami. Jen fotí do `test-results/phase8/<rozlišení>/`
 * a metriky (přetečení, uříznuté texty, malé dotykové cíle, kontrast) zapisuje do `report.jsonl`.
 *
 * Spuštění: KARBAN_VISUAL=1 npx playwright test visual-meta
 * (běžné `playwright test` maže test-results/ — jinam: KARBAN_VISUAL_OUT=<adresář>).
 */

test.skip(!process.env.KARBAN_VISUAL, 'vizuální snímky jen s KARBAN_VISUAL=1');
test.describe.configure({ mode: 'parallel' });

const OUT = process.env.KARBAN_VISUAL_OUT ?? 'test-results/phase8';
const REG = registry();
const NOW = new Date().toISOString();
const SEED = 'VIZUAL01';

const COLLECTION_TABS = [
  'jokers',
  'pranostiky',
  'rady',
  'razitka',
  'vouchers',
  'boosters',
  'tags',
  'bosses',
  'decks',
  'stakes',
  'mods',
  'hands',
  'challenges',
  'achievements',
] as const;
const STATS_TABS = ['overview', 'decks', 'stakes', 'bosses', 'history', 'daily'] as const;

// ─────────────────────────── Profily ───────────────────────────

/** Profil po přepočtu odemčení a achievementů (po načtení stránky už nic neoznamuje). */
function settled(p: Profile): string {
  refreshMeta(p, { registry: REG, nowIso: NOW });
  return serializeProfile(p, NOW);
}

function freshProfile(): Profile {
  const p = createProfile(NOW);
  p.settings.tutorial = false;
  return p;
}

const ids = (rec: Record<string, unknown>): string[] => Object.keys(rec);

function allOf(c: DiscoveryCategory): string[] {
  switch (c) {
    case 'jokers':
      return ids(REG.jokers);
    case 'consumables':
      return ids(REG.consumables);
    case 'vouchers':
      return ids(REG.vouchers);
    case 'tags':
      return ids(REG.tags);
    case 'bosses':
      return ids(REG.bosses);
    case 'boosters':
      return ids(REG.boosters);
    case 'decks':
      return ids(REG.decks);
    case 'hands':
      return [...HAND_TYPES];
    case 'enhancements':
      return ids(REG.enhancements);
    case 'seals':
      return ids(REG.seals);
    case 'editions':
      return ids(REG.editions);
  }
}

function historyEntry(no: number, patch: Partial<HistoryEntry>): HistoryEntry {
  const jokers = ids(REG.jokers);
  return {
    no,
    startedAt: '2026-10-01T18:00:00.000Z',
    finishedAt: '2026-10-01T19:05:00.000Z',
    seed: `HIST${no}AAAA`.slice(0, 8),
    deckId: 'pub',
    stake: 1,
    mode: 'normal',
    challengeId: null,
    seeded: false,
    official: false,
    outcome: 'lost',
    ante: 3,
    endless: false,
    cause: 'small',
    bestHand: 1234,
    bestHandType: 'pair',
    jokers: jokers.slice(no % 7, (no % 7) + 5),
    handsPlayed: 20,
    roundsWon: 6,
    ...patch,
  };
}

/** Skoro plný profil: všechno objevené kromě několika žolíků, půlka achievementů, statistiky a historie. */
function fullProfile(): Profile {
  const p = freshProfile();
  for (const c of DISCOVERY_CATEGORIES) p.discovered[c] = allOf(c);
  p.discovered.jokers = ids(REG.jokers).slice(0, -6);
  p.unlocks.decks = ids(REG.decks);
  p.unlocks.jokers = ids(REG.jokers).slice(0, -3);
  p.unlocks.vouchers = ids(REG.vouchers);
  p.unlocks.challenges = ids(REG.challenges).slice(0, 12);
  for (const d of ids(REG.decks)) p.unlocks.stakes[d] = d === 'pub' ? 8 : 3;
  const ach = ids(REG.achievements ?? {});
  ach.slice(0, Math.ceil(ach.length / 2)).forEach((id, i) => {
    p.achievements.unlocked[id] = `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T20:00:00.000Z`;
  });
  const s = p.stats;
  s.runs = { played: 142, won: 31, lost: 104, abandoned: 7, currentStreak: 2, bestStreak: 5 };
  ids(REG.decks).forEach((d, i) => {
    s.byDeck[d] = { played: 10 + i, won: Math.floor((10 + i) / 4), bestStake: (i % 8) + 1 };
  });
  for (let st = 1; st <= 8; st++)
    s.byStake[String(st)] = { played: 40 - st * 4, won: Math.max(0, 12 - st * 2) };
  ids(REG.bosses).forEach((b, i) => {
    s.bosses[b] = { defeated: 3 + (i % 9), lostTo: i % 4 };
    if (i % 4) s.losses[b] = i % 4;
  });
  s.losses.small = 9;
  s.losses.big = 14;
  ids(REG.challenges)
    .slice(0, 8)
    .forEach((c, i) => {
      s.challenges[c] = { attempts: 2 + i, completed: i % 3 === 0 ? 1 : 0, bestAnte: 3 + (i % 6) };
    });
  s.bestHand = { score: 48_250_000_000, handType: 'flush_five', seed: 'NEJLEPSI', deckId: 'almanac' };
  s.fastestWin = { hands: 27, seed: 'RYCHLYAA', deckId: 'pub', stake: 3 };
  HAND_TYPES.forEach((h, i) => (s.handTypes[h] = 600 - i * 45));
  ids(REG.jokers).forEach((j, i) => {
    s.jokerRounds[j] = (i * 37) % 211;
    s.jokerBuys[j] = (i * 13) % 29;
  });
  for (const k of Object.keys(s.totals) as (keyof typeof s.totals)[]) s.totals[k] = 1234 + k.length * 321;
  s.records.highestAnte = 14;
  s.records.highestEndlessAnte = 14;
  s.records.bestRoundScore = 9_876_543_210;
  s.records.maxMoney = 412;
  const jokers = ids(REG.jokers);
  const bosses = ids(REG.bosses);
  const challenges = ids(REG.challenges);
  p.history = Array.from({ length: 50 }, (_, i) => {
    const no = 142 - i;
    const kind = i % 5;
    return historyEntry(no, {
      outcome: kind === 0 ? 'won' : kind === 4 ? 'abandoned' : 'lost',
      cause: kind === 0 || kind === 4 ? null : kind === 1 ? 'big' : bosses[i % bosses.length]!,
      ante: kind === 0 ? 8 + (i % 7) : 2 + (i % 6),
      endless: kind === 0 && i % 2 === 0,
      mode: i % 7 === 3 ? 'daily' : i % 11 === 5 ? 'challenge' : 'normal',
      official: i % 7 === 3,
      challengeId: i % 11 === 5 ? challenges[i % challenges.length]! : null,
      seeded: i % 13 === 6,
      deckId: ids(REG.decks)[i % ids(REG.decks).length]!,
      stake: 1 + (i % 8),
      bestHand: 1_000 * (i + 1) ** 3,
      bestHandType: HAND_TYPES[i % HAND_TYPES.length]!,
      jokers: jokers.slice(i % 40, (i % 40) + 5 + (i % 3)),
    });
  });
  for (let d = 1; d <= 9; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    const key = dailyDateKey(date);
    p.daily[key] = {
      seed: `DEN-${key}`,
      deckId: ids(REG.decks)[d % ids(REG.decks).length]!,
      stake: 1 + (d % 4),
      status: 'finished',
      outcome: d % 3 === 0 ? 'won' : 'lost',
      ante: 3 + d,
      bestHand: 12_345 * d * d,
      startedAt: date.toISOString(),
      finishedAt: date.toISOString(),
    };
  }
  p.nextRunNo = 143;
  return p;
}

async function presetProfile(page: Page, raw: string): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.profile')) localStorage.setItem('karban.profile', value);
  }, raw);
}

// ─────────────────────────── Runy ───────────────────────────

function driveTo(until: (g: Game) => boolean, seed = SEED): RunState {
  const g = Game.newRun({ deckId: 'pub', stake: 1, seed }, REG);
  const bot = createBot('max');
  for (let i = 0; i < 5000 && !until(g); i++) g.dispatch(bot.decide(g));
  if (!until(g)) throw new Error('driveTo: podmínka nesplněna');
  return structuredClone(g.state) as RunState;
}

async function seedRun(page: Page, state: RunState): Promise<void> {
  const raw = serializeRun(state, '2026-10-01T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('visual-seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('visual-seeded', '1');
    }
  }, raw);
}

async function idle(page: Page): Promise<void> {
  const game = page.locator('.game');
  if ((await game.count()) > 0) await expect(game).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

async function continueRun(page: Page, url = '/?tutorial=off'): Promise<void> {
  await page.goto(url);
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await idle(page);
}

const settle = (page: Page, ms = 450) => page.waitForTimeout(ms);
const screenIs = (page: Page, id: string) => expect(page.locator('#app')).toHaveAttribute('data-screen', id);

/** Posune obsah tak, aby byl prvek vidět (snímek okna, ne celé stránky). */
async function scrollTo(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
  await settle(page, 200);
}

// ─────────────────────────── Snímky ───────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: Boolean(vp.touch) });
    const shot = (page: Page, name: string, fullPage = false) => takeShot(page, OUT, vp, name, { fullPage });

    test('menu a nová hra (čerstvý profil)', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      await page.goto('/?tutorial=off');
      await screenIs(page, 'menu');
      await expect(page.locator('#app')).not.toContainText('Už brzy');
      await settle(page);
      await shot(page, '01-menu-fresh');

      await page.getByTestId('menu-new-game').click();
      await screenIs(page, 'newGame');
      await settle(page);
      await shot(page, '02-newgame-locked');
      await scrollTo(page, 'stake-rules');
      await shot(page, '02-newgame-locked-stakes');
      await scrollTo(page, 'newgame-start');
      await shot(page, '02-newgame-locked-bottom');
      await shot(page, '02-newgame-locked-full', true);
      expect(problems).toEqual([]);
    });

    test('menu s novinkami a nová hra (plný profil)', async ({ page }) => {
      const problems = watchProblems(page);
      const p = fullProfile();
      const raw = settled(p);
      await presetProfile(page, raw);
      await page.goto('/?tutorial=off');
      await screenIs(page, 'menu');
      await settle(page);
      await shot(page, '03-menu-full');
      await page.getByTestId('menu-new-game').click();
      await screenIs(page, 'newGame');
      await settle(page);
      await shot(page, '04-newgame-full');
      expect(problems).toEqual([]);
    });

    test('oznámení odemčení a achievementu', async ({ page }) => {
      const problems = watchProblems(page);
      // Profil bez přepočtu: po startu se oznámí odemčené výzvy, balíček a achievementy.
      const p = freshProfile();
      p.stats.runs.won = 1;
      p.stats.runs.played = 3;
      p.stats.totals.roundsWon = 12;
      p.stats.totals.bossesDefeated = 3;
      p.stats.records.maxMoney = 60;
      await presetProfile(page, serializeProfile(p, NOW));
      await page.goto('/?tutorial=off');
      await screenIs(page, 'menu');
      await expect(page.locator('.toast--meta').first()).toBeVisible();
      await settle(page, 700);
      await shot(page, '05-toasts-menu');
      await page.getByTestId('menu-challenges').click();
      await screenIs(page, 'challenges');
      await settle(page, 300);
      await shot(page, '05-toasts-challenges');
      expect(problems).toEqual([]);
    });

    test('sbírka (čerstvý profil)', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-collection').click();
      await screenIs(page, 'collection');
      for (const tab of COLLECTION_TABS) {
        await page.getByTestId(`codex-tab-${tab}`).click();
        await settle(page, 250);
        await shot(page, `10-codex-fresh-${tab}`);
      }
      // Detail zamčené položky.
      await page.getByTestId('codex-tab-jokers').click();
      await page.locator('.codex-grid [data-testid^="codex-item-"]').nth(20).click();
      await expect(page.getByTestId('codex-detail')).toBeVisible();
      await settle(page);
      await shot(page, '11-codex-fresh-detail-locked');
      expect(problems).toEqual([]);
    });

    test('sbírka (plný profil)', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(fullProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-collection').click();
      await screenIs(page, 'collection');
      for (const tab of COLLECTION_TABS) {
        await page.getByTestId(`codex-tab-${tab}`).click();
        await settle(page, 250);
        await shot(page, `12-codex-full-${tab}`);
      }
      await page.getByTestId('codex-tab-jokers').click();
      await page.locator('.codex-grid [data-testid^="codex-item-"]').first().click();
      await expect(page.getByTestId('codex-detail')).toBeVisible();
      await settle(page);
      await shot(page, '13-codex-full-detail-joker');
      await page.keyboard.press('Escape');
      await page.getByTestId('codex-tab-achievements').click();
      await page.locator('.codex-grid [data-testid^="codex-item-"]').first().click();
      await expect(page.getByTestId('codex-detail')).toBeVisible();
      await settle(page);
      await shot(page, '13-codex-full-detail-achievement');
      await page.keyboard.press('Escape');
      await page.getByTestId('codex-tab-bosses').click();
      await page.locator('.codex-grid [data-testid^="codex-item-"]').first().click();
      await expect(page.getByTestId('codex-detail')).toBeVisible();
      await settle(page);
      await shot(page, '13-codex-full-detail-boss');
      await page.keyboard.press('Escape');
      await page.getByTestId('codex-tab-jokers').click();
      await settle(page, 250);
      await shot(page, '13-codex-full-jokers-page', true);
      expect(problems).toEqual([]);
    });

    test('statistiky a historie (plný profil)', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(fullProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-stats').click();
      await screenIs(page, 'stats');
      for (const tab of STATS_TABS) {
        await page.getByTestId(`stats-tab-${tab}`).click();
        await settle(page, 250);
        await shot(page, `20-stats-full-${tab}`);
      }
      await page.getByTestId('stats-tab-overview').click();
      await settle(page, 250);
      await shot(page, '21-stats-full-overview-page', true);
      expect(problems).toEqual([]);
    });

    test('statistiky (čerstvý profil)', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-stats').click();
      await screenIs(page, 'stats');
      for (const tab of STATS_TABS) {
        await page.getByTestId(`stats-tab-${tab}`).click();
        await settle(page, 250);
        await shot(page, `22-stats-fresh-${tab}`);
      }
      expect(problems).toEqual([]);
    });

    test('výzvy', async ({ page }) => {
      const problems = watchProblems(page);
      const p = freshProfile();
      p.stats.runs.won = 3;
      p.stats.runs.played = 9;
      p.stats.challenges.greenhouse = { attempts: 4, completed: 1, bestAnte: 8 };
      p.stats.challenges.christmas_carp = { attempts: 2, completed: 0, bestAnte: 5 };
      await presetProfile(page, settled(p));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-challenges').click();
      await screenIs(page, 'challenges');
      await settle(page);
      await shot(page, '30-challenges');
      await page.getByTestId('challenge-greenhouse').click();
      await settle(page, 250);
      await shot(page, '31-challenge-completed');
      await page.getByTestId('challenge-christmas_carp').click();
      await settle(page, 250);
      await shot(page, '32-challenge-open');
      await page.getByTestId('challenge-dry_february').click();
      await settle(page, 250);
      await shot(page, '33-challenge-locked');
      const last = ids(REG.challenges).at(-1)!;
      await page.getByTestId(`challenge-${last}`).click();
      await settle(page, 250);
      await shot(page, '34-challenge-last-locked');
      await shot(page, '35-challenges-page', true);
      expect(problems).toEqual([]);
    });

    test('denní run: čeká na pokus', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-daily').click();
      await screenIs(page, 'daily');
      await settle(page);
      await shot(page, '40-daily-available');
      await shot(page, '40-daily-available-page', true);
      expect(problems).toEqual([]);
    });

    test('denní run: odehraný se sdílením a historií', async ({ page }) => {
      const problems = watchProblems(page);
      const p = fullProfile();
      const key = dailyDateKey(new Date());
      p.daily[key] = {
        seed: `DEN-${key}`,
        deckId: 'pub',
        stake: 2,
        status: 'finished',
        outcome: 'lost',
        ante: 6,
        bestHand: 1_340_000,
        startedAt: NOW,
        finishedAt: NOW,
      };
      await presetProfile(page, settled(p));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-daily').click();
      await screenIs(page, 'daily');
      await settle(page);
      await shot(page, '41-daily-finished');
      await shot(page, '41-daily-finished-page', true);
      expect(problems).toEqual([]);
    });

    test('nastavení s exportem a importem', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(fullProfile()));
      await page.goto('/?tutorial=off');
      await page.getByTestId('menu-settings').click();
      await screenIs(page, 'settings');
      await settle(page);
      await shot(page, '50-settings');
      await scrollTo(page, 'settings-tutorial-restart');
      await shot(page, '51-settings-tutorial');
      await scrollTo(page, 'settings-reset');
      await shot(page, '52-settings-save');
      await page.getByTestId('settings-import-file').setInputFiles({
        name: 'karban-profil.json',
        mimeType: 'application/json',
        buffer: Buffer.from(settled(freshProfile())),
      });
      await expect(page.getByTestId('import-confirm')).toBeVisible();
      await settle(page);
      await shot(page, '53-settings-import-confirm');
      await page.getByTestId('import-confirm').getByTestId('confirm-cancel').click();
      await page.getByTestId('settings-reset').click();
      await expect(page.getByTestId('reset-confirm-1')).toBeVisible();
      await settle(page);
      await shot(page, '54-settings-reset-confirm');
      await page.keyboard.press('Escape');
      await shot(page, '55-settings-page', true);
      expect(problems).toEqual([]);
    });

    test('pitva s novinkami', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      const s = driveTo((g) => g.state.phase === 'round' && g.state.ante >= 2 && g.state.jokers.length >= 2);
      s.ante = 5;
      s.money = 60;
      s.round!.handsLeft = 1;
      s.round!.target = 1e9;
      await seedRun(page, s);
      await continueRun(page);
      await page.getByTestId('hand').locator('.pcard').first().click();
      await page.getByTestId('play').click();
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'game_over', { timeout: 30_000 });
      await idle(page);
      await settle(page, 900);
      await shot(page, '60-game-over-news');
      await shot(page, '60-game-over-news-page', true);
      expect(problems).toEqual([]);
    });

    test('výhra s novinkami', async ({ page }) => {
      const problems = watchProblems(page);
      await presetProfile(page, settled(freshProfile()));
      const s = driveTo((g) => g.state.phase === 'round' && g.state.ante >= 2 && g.state.jokers.length >= 2);
      const finalBoss = Object.values(REG.bosses).find((b) => b.final);
      s.ante = 8;
      s.money = 60;
      s.blindIndex = 2;
      s.blinds.forEach((b, i) => (b.status = i < 2 ? 'defeated' : 'current'));
      if (finalBoss) s.blinds[2]!.bossId = finalBoss.id;
      const round = s.round!;
      round.blind = 'boss';
      round.bossId = finalBoss?.id ?? null;
      round.target = 10;
      await seedRun(page, s);
      await continueRun(page);
      await page.getByTestId('hand').locator('.pcard').first().click();
      await page.getByTestId('play').click();
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'victory', { timeout: 30_000 });
      await idle(page);
      await settle(page, 1200);
      await shot(page, '61-victory-news');
      await shot(page, '61-victory-news-page', true);
      expect(problems).toEqual([]);
    });

    // ── Tutoriál: každý krok bubliny ve své fázi ──
    const TUTORIAL: Array<{
      step: TutorialStepId;
      seen: TutorialStepId[];
      state: () => RunState;
      select?: boolean;
    }> = [
      { step: 'select', seen: [], state: () => roundState() },
      { step: 'play', seen: [], state: () => roundState(), select: true },
      { step: 'discard', seen: ['select', 'play'], state: () => roundState() },
      { step: 'goal', seen: ['select', 'play', 'discard'], state: () => roundState() },
      { step: 'jokerOrder', seen: ['select', 'play', 'discard', 'goal'], state: () => roundState() },
      {
        step: 'roundEnd',
        seen: ['select', 'play', 'discard', 'goal', 'jokerOrder'],
        state: () => driveTo((g) => g.state.phase === 'round_end' && g.state.ante >= 2),
      },
      {
        step: 'shop',
        seen: ['select', 'play', 'discard', 'goal', 'jokerOrder', 'roundEnd'],
        state: () => {
          const st = driveTo(
            (g) => g.state.phase === 'shop' && g.state.ante >= 2 && g.state.jokers.length >= 2,
          );
          st.money = 30;
          return st;
        },
      },
      {
        step: 'boss',
        seen: ['select', 'play', 'discard', 'goal', 'jokerOrder', 'roundEnd', 'shop'],
        state: () =>
          driveTo(
            (g) => g.state.phase === 'blind_select' && g.state.blinds[g.state.blindIndex]?.kind === 'boss',
          ),
      },
      {
        step: 'skip',
        seen: ['select', 'play', 'discard', 'goal', 'jokerOrder', 'roundEnd', 'shop', 'boss'],
        state: () =>
          driveTo(
            (g) =>
              g.state.phase === 'blind_select' &&
              g.state.ante >= 2 &&
              g.state.blinds[g.state.blindIndex]?.kind === 'small',
          ),
      },
    ];
    for (const tcase of TUTORIAL) {
      test(`tutoriál: ${tcase.step}`, async ({ page }) => {
        const problems = watchProblems(page);
        const p = freshProfile();
        p.settings.tutorial = true;
        p.tutorial.seen = [...tcase.seen];
        p.tutorial.step = tcase.seen.length;
        await presetProfile(page, settled(p));
        await seedRun(page, tcase.state());
        await continueRun(page, '/');
        if (tcase.select) await page.getByTestId('hand').locator('.pcard').first().click();
        const bubble = page.getByTestId('tutorial');
        await expect(bubble).toBeVisible();
        await expect(bubble).toHaveAttribute('data-step', tcase.step);
        await settle(page, 600);
        await takeShot(page, OUT, vp, `70-tutorial-${tcase.step}`, { keepHover: Boolean(tcase.select) });
        expect(problems).toEqual([]);
      });
    }
  });
}

/** Run v kole s aspoň dvěma žolíky (výběr útraty proběhl v enginu). */
function roundState(): RunState {
  return driveTo((g) => g.state.phase === 'round' && g.state.ante >= 2 && g.state.jokers.length >= 2);
}
