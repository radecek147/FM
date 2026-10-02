/**
 * Sledování runů v profilu (src/engine/meta/runs.ts): statistiky po každé události, objevy, odemykání síly piva
 * po balíčcích, výsledek a historie (max 50), seedované runy, oficiální denní pokus, výzvy, achievementy.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import {
  Game,
  HISTORY_LIMIT,
  MSG,
  applyRunEvent,
  applyRunEvents,
  createBot,
  createProfile,
  dailyRunSetup,
  deserializeProfile,
  finishRun,
  isDailyAvailable,
  isDeckUnlocked,
  isUnseen,
  maxStakeFor,
  refreshMeta,
  resumeRun,
  serializeProfile,
  startRun,
  unlockedPoolFor,
} from '../../src/engine';
import type {
  Action,
  AchievementDef,
  ContentRegistry,
  GameEvent,
  MetaCtx,
  MetaNotice,
  NewRunOptions,
  Profile,
  RunState,
  ScoreResult,
} from '../../src/engine';
import { ART } from './engine-fixtures';

const NOW = '2026-10-02T10:00:00.000Z';
const reg = registry();
const ctxOf = (r: ContentRegistry = reg, nowIso = NOW): MetaCtx => ({ registry: r, nowIso });

function newGame(opts: Partial<NewRunOptions> = {}, r: ContentRegistry = reg): Game {
  return Game.newRun({ seed: 'ABCD2345', deckId: 'pub', stake: 1, ...opts }, r);
}

function act(profile: Profile, game: Game, action: Action, ctx: MetaCtx = ctxOf()): MetaNotice[] {
  const res = game.dispatch(action);
  if (!res.ok) throw new Error(`${action.type}: ${res.error}`);
  return applyRunEvents(profile, res.events, game.state, ctx);
}

/** Kopie stavu runu s úpravou (pro události, které by jinak vyžadovaly celý run). */
function patched(run: Readonly<RunState>, patch: Partial<RunState>): RunState {
  return { ...(JSON.parse(JSON.stringify(run)) as RunState), ...patch };
}

/** Odehraje „vyhraný“ run: start → victory → konec. Vrací oznámení z výhry. */
function winRun(profile: Profile, opts: Partial<NewRunOptions>, ctx: MetaCtx = ctxOf()): MetaNotice[] {
  const game = newGame(opts, ctx.registry);
  startRun(profile, game.state, ctx);
  const won = patched(game.state, { phase: 'victory', ante: 8 });
  const notices = applyRunEvent(profile, { type: 'victory', ante: 8 }, won, ctx);
  finishRun(profile, won, ctx);
  return notices;
}

/** Odehraje prohraný run na šéfovi `cause`. */
function loseRun(profile: Profile, cause: string, ctx: MetaCtx = ctxOf()): void {
  const game = newGame({}, ctx.registry);
  startRun(profile, game.state, ctx);
  const info = { cause, ante: 3, blind: 'boss' as const, score: 10, target: 100 };
  const lost = patched(game.state, { phase: 'game_over', ante: 3, gameOver: info });
  applyRunEvent(profile, { type: 'gameOver', info }, lost, ctx);
  finishRun(profile, lost, ctx);
}

function scoreResult(extra: Partial<ScoreResult> = {}): ScoreResult {
  return {
    hand: { type: 'pair', scoringIds: [], contains: ['pair', 'high_card'] },
    playedIds: [1, 2],
    steps: [],
    chips: 10,
    mult: 2,
    score: 20,
    blockedReason: null,
    destroyedCardIds: [],
    moneyEarned: 0,
    ...extra,
  };
}

describe('start runu', () => {
  it('zaeviduje run, objeví balíček, šéfa a štítky z výběru útraty', () => {
    const p = createProfile(NOW);
    const game = newGame();
    expect(startRun(p, game.state, ctxOf())).toEqual([]);
    expect(p.current).toMatchObject({
      no: 1,
      seed: 'ABCD2345',
      deckId: 'pub',
      stake: 1,
      mode: 'normal',
      seeded: false,
      official: false,
      counted: true,
      outcome: null,
    });
    expect(p.nextRunNo).toBe(2);
    expect(p.discovered.decks).toEqual(['pub']);
    const boss = game.state.blinds.find((b) => b.kind === 'boss')!.bossId!;
    expect(p.discovered.bosses).toContain(boss);
    for (const b of game.state.blinds) if (b.skipTagId) expect(p.discovered.tags).toContain(b.skipTagId);
    expect(isUnseen(p, 'bosses', boss)).toBe(true);
  });

  it('předchozí neuzavřený run se zapíše jako opuštěný', () => {
    const p = createProfile(NOW);
    startRun(p, newGame().state, ctxOf());
    startRun(p, newGame({ seed: 'BBBB2345' }).state, ctxOf());
    expect(p.history).toHaveLength(1);
    expect(p.history[0]).toMatchObject({ no: 1, seed: 'ABCD2345', outcome: 'abandoned' });
    expect(p.stats.runs).toMatchObject({ played: 1, abandoned: 1, won: 0 });
    expect(p.current?.seed).toBe('BBBB2345');
  });
});

describe('události runu', () => {
  it('zahraná ruka a zahození: počítadla, kombinace, nejlepší ruka, objevy', () => {
    const p = createProfile(NOW);
    const game = newGame();
    startRun(p, game.state, ctxOf());
    act(p, game, { type: 'selectBlind' });
    act(p, game, { type: 'discard', cardIds: game.state.round!.hand.slice(0, 3) });
    act(p, game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 5) });
    const s = p.stats;
    expect(s.totals.handsPlayed).toBe(1);
    expect(s.totals.cardsPlayed).toBe(5);
    expect(s.totals.discards).toBe(1);
    expect(s.totals.cardsDiscarded).toBe(3);
    const type = game.state.stats.bestHandType!;
    expect(s.handTypes[type]).toBe(1);
    expect(s.bestHand).toEqual({
      score: game.state.stats.bestHandScore,
      handType: type,
      seed: 'ABCD2345',
      deckId: 'pub',
    });
    expect(p.discovered.hands).toContain(type);
    expect(p.current!.handsPlayed).toBe(1);
  });

  it('prasklé sklo, peníze, kupóny ve více runech, spotřebky podle druhu', () => {
    const p = createProfile(NOW);
    const game = newGame();
    const ctx = ctxOf();
    startRun(p, game.state, ctx);
    const run = game.state;
    const glass = scoreResult({
      steps: [
        { source: 'card', cardId: 1, message: MSG.glassBreak, chipsAfter: 0, multAfter: 0 },
        { source: 'card', cardId: 2, message: MSG.glassBreak, chipsAfter: 0, multAfter: 0 },
      ],
    });
    const rada = Object.values(reg.consumables).find((c) => c.kind === 'rada')!.id;
    const voucher = Object.values(reg.vouchers).find((v) => v.tier === 1)!.id;
    const events: GameEvent[] = [
      { type: 'handPlayed', result: glass, roundScore: 20 },
      { type: 'moneyChanged', delta: 7, money: 11, reason: 'roundReward' },
      { type: 'shopEntered' },
      { type: 'moneyChanged', delta: -6, money: 5, reason: 'purchase' },
      { type: 'itemBought', kind: 'voucher', defId: voucher, price: 6 },
      { type: 'itemBought', kind: 'voucher', defId: voucher, price: 0 },
      { type: 'moneyChanged', delta: -5, money: 0, reason: 'purchase' },
      { type: 'shopRerolled', cost: 5 },
      { type: 'consumableUsed', uid: 9, defId: rada },
      { type: 'moneyChanged', delta: -1, money: -1, reason: 'handCost' },
    ];
    applyRunEvents(p, events, run, ctx);
    const t = p.stats.totals;
    expect(t.glassBroken).toBe(2);
    expect(p.current!.counters.glassBroken).toBe(2);
    expect(t.moneyEarned).toBe(7);
    expect(t.moneySpent).toBe(11);
    expect(p.current!.counters.maxShopSpent).toBe(11);
    expect(t.vouchersBought).toBe(2);
    expect(p.stats.voucherRuns[voucher]).toBe(1);
    expect(t.rerolls).toBe(1);
    expect(p.current!.counters.maxShopRerolls).toBe(1);
    expect(t.consumablesUsed).toBe(1);
    expect(t.radyUsed).toBe(1);
    expect(p.stats.consumableUses[rada]).toBe(1);
    // nový Večerka nuluje počítadla jedné Večerky; kupón v dalším runu = druhý run
    applyRunEvent(p, { type: 'shopEntered' }, run, ctx);
    expect(p.current!.counters.shopSpent).toBe(0);
    expect(p.current!.counters.maxShopSpent).toBe(11);
    finishRun(p, run, ctx);
    const g2 = newGame({ seed: 'CCCC2345' });
    startRun(p, g2.state, ctx);
    applyRunEvent(p, { type: 'itemBought', kind: 'voucher', defId: voucher, price: 6 }, g2.state, ctx);
    expect(p.stats.voucherRuns[voucher]).toBe(2);
  });

  it('konec kola: první ruka, zůstatek v mínusu (Dlužník), Na dřeň, žolíci ve slotu', () => {
    const p = createProfile(NOW);
    const game = newGame();
    const ctx = ctxOf();
    startRun(p, game.state, ctx);
    act(p, game, { type: 'selectBlind' });
    applyRunEvent(p, { type: 'shopLeft' }, patched(game.state, { money: 0 }), ctx);
    expect(p.current!.counters.leftShopBroke).toBe(true);
    const round = { ...game.state.round!, handsPlayed: 1 };
    const inDebt = patched(game.state, { money: -3, round });
    expect(isDeckUnlocked(p, reg, 'debtor')).toBe(false);
    const notices = applyRunEvent(
      p,
      { type: 'roundWon', ante: 1, blind: 'small', score: 500, target: 300 },
      inDebt,
      ctx,
    );
    expect(notices).toContainEqual({ kind: 'unlock', category: 'decks', id: 'debtor' });
    expect(p.stats.totals.roundsWon).toBe(1);
    expect(p.stats.totals.firstHandRoundWins).toBe(1);
    expect(p.stats.records.minRoundEndMoney).toBe(-3);
    expect(p.stats.records.bestRoundScore).toBe(500);
    expect(p.current!.counters).toMatchObject({
      firstHandRoundWins: 1,
      minRoundEndMoney: -3,
      brokeRoundWon: true,
      leftShopBroke: false,
    });
  });

  it('série maximálního úroku (modifikátory z kontextu i spočítané ze stavu)', () => {
    const p = createProfile(NOW);
    const game = newGame();
    startRun(p, game.state, ctxOf());
    const rewards = (interest: number): GameEvent => ({
      type: 'roundRewards',
      blindReward: 3,
      unusedHands: 0,
      unusedDiscards: 0,
      interest,
      extra: [],
      total: 3 + interest,
    });
    const cap = game.modifiers().interestCap;
    for (let i = 0; i < 3; i++) applyRunEvent(p, rewards(cap), game.state, ctxOf());
    expect(p.current!.counters).toMatchObject({ interestStreak: 3, maxInterestStreak: 3 });
    applyRunEvent(p, rewards(cap - 1), game.state, ctxOf());
    expect(p.current!.counters).toMatchObject({ interestStreak: 0, maxInterestStreak: 3 });
    // vyšší strop z kupónu: modifikátory dodá UI
    const mods = { ...game.modifiers(), interestCap: cap + 2 };
    applyRunEvent(p, rewards(cap), game.state, { ...ctxOf(), mods: () => mods });
    expect(p.current!.counters.interestStreak).toBe(0);
    applyRunEvent(p, rewards(cap + 2), game.state, { ...ctxOf(), mods });
    expect(p.current!.counters.interestStreak).toBe(1);
  });

  it('legendární žolík se objevením odemkne (oznámení)', () => {
    const p = createProfile(NOW);
    const game = newGame();
    startRun(p, game.state, ctxOf());
    const legend = Object.values(reg.jokers).find((j) => j.rarity === 'legendary')!.id;
    const joker = {
      uid: 99,
      defId: legend,
      edition: 'negative',
      state: {},
      sellBonus: 0,
      stickers: [],
      debuffed: false,
    };
    const run = patched(game.state, { jokers: [joker] });
    const notices = applyRunEvent(p, { type: 'jokerAdded', uid: 99, defId: legend }, run, ctxOf());
    expect(notices).toContainEqual({ kind: 'unlock', category: 'jokers', id: legend });
    expect(p.discovered.jokers).toContain(legend);
    expect(p.discovered.editions).toContain('negative');
    expect(p.current!.counters.hadJoker).toBe(true);
    expect(p.stats.records.maxJokers).toBe(1);
    expect(applyRunEvent(p, { type: 'jokerAdded', uid: 99, defId: legend }, run, ctxOf())).toEqual([]);
  });

  it('bez zaevidovaného runu ho první událost zaeviduje (pokračování z uložení)', () => {
    const p = createProfile(NOW);
    const game = newGame();
    act(p, game, { type: 'selectBlind' });
    expect(p.current).toMatchObject({ seed: 'ABCD2345', counted: true, seeded: false });
    const before = JSON.stringify(p);
    expect(resumeRun(p, game.state, ctxOf())).toEqual([]);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('výsledek runu a síla piva', () => {
  it('výhra na N odemkne N + 1 jen pro daný balíček (bez přeskakování)', () => {
    const p = createProfile(NOW);
    expect(winRun(p, { deckId: 'pub', stake: 1 })).toContainEqual({ kind: 'stake', deckId: 'pub', stake: 2 });
    expect(maxStakeFor(p, reg, 'pub')).toBe(2);
    expect(maxStakeFor(p, reg, 'regulars')).toBe(1);
    expect(isUnseen(p, 'stakes', 'jedenactka')).toBe(true);
    // opakovaná výhra na nižší úrovni nic neodemkne
    expect(winRun(p, { deckId: 'pub', stake: 1 }).filter((n) => n.kind === 'stake')).toEqual([]);
    expect(maxStakeFor(p, reg, 'pub')).toBe(2);
    winRun(p, { deckId: 'pub', stake: 2 });
    expect(maxStakeFor(p, reg, 'pub')).toBe(3);
    winRun(p, { deckId: 'regulars', stake: 1 });
    expect(maxStakeFor(p, reg, 'regulars')).toBe(2);
    // Imperial je strop
    p.unlocks.stakes.pub = 8;
    expect(winRun(p, { deckId: 'pub', stake: 8 }).filter((n) => n.kind === 'stake')).toEqual([]);
    expect(maxStakeFor(p, reg, 'pub')).toBe(8);
    expect(p.stats.byDeck.pub).toEqual({ played: 4, won: 4, bestStake: 8 });
    expect(p.stats.byStake['1']).toEqual({ played: 3, won: 3 });
    expect(p.stats.runs).toMatchObject({ played: 5, won: 5, currentStreak: 5, bestStreak: 5 });
    expect(p.history).toHaveLength(5);
    expect(p.history[0]).toMatchObject({ outcome: 'won', stake: 8, ante: 8, mode: 'normal' });
  });

  it('výhra odemkne balíček s podmínkou winRun (Obrázkový po Mariášovém)', () => {
    const p = createProfile(NOW);
    const notices = winRun(p, { deckId: 'marias', stake: 1 });
    expect(notices).toContainEqual({ kind: 'unlock', category: 'decks', id: 'court' });
    expect(p.stats.fastestWin).toMatchObject({ deckId: 'marias', stake: 1 });
  });

  it('prohra: příčina pro pitvu, šéf, přerušená série', () => {
    const p = createProfile(NOW);
    winRun(p, { deckId: 'pub', stake: 1 });
    loseRun(p, 'tax_audit');
    expect(p.stats.runs).toMatchObject({ played: 2, won: 1, lost: 1, currentStreak: 0, bestStreak: 1 });
    expect(p.stats.losses).toEqual({ tax_audit: 1 });
    expect(p.stats.bosses.tax_audit).toEqual({ defeated: 0, lostTo: 1 });
    expect(p.history[0]).toMatchObject({ outcome: 'lost', cause: 'tax_audit', ante: 3 });
    loseRun(p, 'small');
    expect(p.stats.losses).toEqual({ tax_audit: 1, small: 1 });
    expect(p.stats.bosses.small).toBeUndefined();
  });

  it('opuštění z Večerky; finishRun podruhé nic nezapíše', () => {
    const p = createProfile(NOW);
    const game = newGame();
    startRun(p, game.state, ctxOf());
    const shop = patched(game.state, { phase: 'shop', ante: 2 });
    finishRun(p, shop, ctxOf());
    expect(p.history[0]).toMatchObject({ outcome: 'abandoned', ante: 2, cause: null });
    expect(p.current).toBeNull();
    expect(finishRun(p, shop, ctxOf())).toEqual([]);
    expect(p.history).toHaveLength(1);
    expect(p.stats.runs.played).toBe(1);
  });

  it(`historie drží posledních ${HISTORY_LIMIT} runů, nejnovější první`, () => {
    const p = createProfile(NOW);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const game = newGame({ seed: `SEED${String(i).padStart(4, '2')}` });
      startRun(p, game.state, ctxOf());
      finishRun(p, game.state, ctxOf());
    }
    expect(p.history).toHaveLength(HISTORY_LIMIT);
    expect(p.history[0]!.no).toBe(HISTORY_LIMIT + 5);
    expect(p.history.at(-1)!.no).toBe(6);
    expect(p.stats.runs.played).toBe(HISTORY_LIMIT + 5);
  });
});

describe('seedovaný run', () => {
  const achievements: Record<string, AchievementDef> = {
    seed_sown: {
      id: 'seed_sown',
      category: 'meta',
      allowSeeded: true,
      check: ({ current }) => !!current?.seeded,
    },
    any_hand: { id: 'any_hand', category: 'score', check: ({ event }) => event?.type === 'handPlayed' },
  };
  const reg2: ContentRegistry = { ...reg, achievements };

  it('jde jen do historie: žádné statistiky, objevy, odemčení ani achievementy (kromě Semínko zaseto)', () => {
    const p = createProfile(NOW);
    const ctx = ctxOf(reg2);
    const game = newGame({ deckId: 'marias' });
    const start = startRun(p, game.state, { ...ctx, seeded: true });
    expect(start).toEqual([{ kind: 'achievement', id: 'seed_sown' }]);
    expect(p.current).toMatchObject({ seeded: true, counted: false, mode: 'normal' });
    act(p, game, { type: 'selectBlind' }, ctx);
    act(p, game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 5) }, ctx);
    const won = patched(game.state, { phase: 'victory', ante: 8 });
    expect(applyRunEvent(p, { type: 'victory', ante: 8 }, won, ctx)).toEqual([]);
    finishRun(p, won, ctx);
    expect(p.stats.totals.handsPlayed).toBe(0);
    expect(p.stats.runs.played).toBe(0);
    expect(p.stats.handTypes).toEqual({});
    expect(p.discovered.decks).toEqual([]);
    expect(p.discovered.bosses).toEqual([]);
    expect(isDeckUnlocked(p, reg, 'court')).toBe(false);
    expect(maxStakeFor(p, reg, 'marias')).toBe(1);
    expect(Object.keys(p.achievements.unlocked)).toEqual(['seed_sown']);
    expect(p.history[0]).toMatchObject({ seeded: true, outcome: 'won', deckId: 'marias' });
    // započítaný run achievementy dostane
    const g2 = newGame({ seed: 'DDDD2345' });
    startRun(p, g2.state, ctx);
    act(p, g2, { type: 'selectBlind' }, ctx);
    const notices = act(p, g2, { type: 'play', cardIds: g2.state.round!.hand.slice(0, 5) }, ctx);
    expect(notices).toContainEqual({ kind: 'achievement', id: 'any_hand' });
  });
});

describe('denní run', () => {
  const setup = dailyRunSetup(NOW, reg);
  const dailyGame = (seed = setup.seed): Game =>
    newGame({
      seed,
      deckId: setup.deckId,
      stake: setup.stake,
      daily: true,
      unlockedPool: unlockedPoolFor(createProfile(NOW), reg, 'daily'),
    });

  it('první pokus dne je oficiální, další mimo soutěž', () => {
    const p = createProfile(NOW);
    const g1 = dailyGame();
    expect(g1.state.unlockedPool).toEqual({ jokers: null, vouchers: null, boosters: null });
    expect(isDailyAvailable(p, NOW)).toBe(true);
    startRun(p, g1.state, ctxOf());
    expect(p.current).toMatchObject({ mode: 'daily', official: true, counted: true });
    expect(p.daily[setup.dateKey]).toMatchObject({
      seed: setup.seed,
      status: 'playing',
      deckId: setup.deckId,
    });
    expect(isDailyAvailable(p, NOW)).toBe(false);
    act(p, g1, { type: 'selectBlind' });
    act(p, g1, { type: 'play', cardIds: g1.state.round!.hand.slice(0, 5) });
    const lostInfo = { cause: 'small', ante: 1, blind: 'small' as const, score: 1, target: 300 };
    const lost = patched(g1.state, { phase: 'game_over', gameOver: lostInfo });
    applyRunEvent(p, { type: 'gameOver', info: lostInfo }, lost, ctxOf());
    finishRun(p, lost, ctxOf());
    expect(p.daily[setup.dateKey]).toMatchObject({
      status: 'finished',
      outcome: 'lost',
      ante: 1,
      bestHand: g1.state.stats.bestHandScore,
      finishedAt: NOW,
    });
    expect(p.history[0]).toMatchObject({ mode: 'daily', official: true });
    // druhý pokus téhož dne: mimo soutěž (nepočítá se)
    const g2 = dailyGame();
    startRun(p, g2.state, ctxOf());
    expect(p.current).toMatchObject({ official: false, counted: false });
    act(p, g2, { type: 'selectBlind' });
    finishRun(p, g2.state, ctxOf());
    expect(p.daily[setup.dateKey]!.outcome).toBe('lost');
    expect(p.stats.runs.played).toBe(1);
  });

  it('výhra denního runu se počítá, ale sílu piva neodemyká', () => {
    const p = createProfile(NOW);
    const g = dailyGame();
    startRun(p, g.state, ctxOf());
    const won = patched(g.state, { phase: 'victory', ante: 8 });
    const notices = applyRunEvent(p, { type: 'victory', ante: 8 }, won, ctxOf());
    expect(notices.filter((n) => n.kind === 'stake')).toEqual([]);
    expect(p.stats.runs.won).toBe(1);
    expect(maxStakeFor(p, reg, setup.deckId)).toBe(1);
  });

  it('ručně zadaný nebo starý seed dne je mimo soutěž; pokračování oficiálního pokusu zůstane oficiální', () => {
    const p = createProfile(NOW);
    const old = dailyRunSetup('2026-09-01T10:00:00.000Z', reg);
    const gOld = newGame({ seed: old.seed, deckId: old.deckId, stake: old.stake, daily: true });
    startRun(p, gOld.state, ctxOf());
    expect(p.current).toMatchObject({ official: false, counted: false });
    expect(p.daily).toEqual({});
    const g = dailyGame();
    startRun(p, g.state, { ...ctxOf(), seeded: true });
    expect(p.current).toMatchObject({ official: false, counted: false, seeded: true });
    expect(isDailyAvailable(p, NOW)).toBe(true);
    // oficiální pokus, profil o rozehraném runu „zapomene“ (import) → pokračování ho pozná podle záznamu dne
    const g2 = dailyGame();
    startRun(p, g2.state, ctxOf());
    expect(p.current!.official).toBe(true);
    p.current = null;
    resumeRun(p, g2.state, ctxOf());
    expect(p.current).toMatchObject({ official: true, counted: true });
    // další den už oficiální není
    p.current = null;
    resumeRun(p, g2.state, ctxOf(reg, '2026-10-03T10:00:00.000Z'));
    expect(p.current!.official).toBe(false);
  });
});

describe('výzvy', () => {
  const reg2: ContentRegistry = {
    ...reg,
    challenges: { ...reg.challenges, meta_test: { id: 'meta_test', deckId: 'pub', art: ART } },
  };

  it('vlastní statistika: pokusy, dokončení, nejlepší patro; souhrn runů ani síla piva se nemění', () => {
    const p = createProfile(NOW);
    const ctx = ctxOf(reg2);
    const game = newGame({ challengeId: 'meta_test' }, reg2);
    startRun(p, game.state, ctx);
    expect(p.current).toMatchObject({ mode: 'challenge', counted: true, challengeId: 'meta_test' });
    act(p, game, { type: 'selectBlind' }, ctx);
    act(p, game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 5) }, ctx);
    expect(p.stats.totals.handsPlayed).toBe(1);
    const won = patched(game.state, { phase: 'victory', ante: 8 });
    const notices = applyRunEvent(p, { type: 'victory', ante: 8 }, won, ctx);
    expect(notices.filter((n) => n.kind === 'stake')).toEqual([]);
    finishRun(p, won, ctx);
    expect(p.stats.challenges.meta_test).toEqual({ attempts: 1, completed: 1, bestAnte: 8 });
    expect(p.stats.runs.played).toBe(0);
    expect(p.stats.byDeck).toEqual({});
    expect(p.history[0]).toMatchObject({ mode: 'challenge', challengeId: 'meta_test', outcome: 'won' });
  });
});

describe('achievementy', () => {
  const achievements: Record<string, AchievementDef> = {
    first_round: {
      id: 'first_round',
      category: 'progress',
      check: ({ event }) => event?.type === 'roundWon',
    },
    two_hands: {
      id: 'two_hands',
      category: 'score',
      check: ({ profile }) => ({ progress: profile.stats.totals.handsPlayed, target: 2 }),
    },
    broken: {
      id: 'broken',
      category: 'curiosity',
      check: () => {
        throw new Error('rozbitý obsah');
      },
    },
    big_hand: { id: 'big_hand', category: 'jokers', check: ({ mods }) => (mods?.handSize ?? 0) >= 8 },
    tutorial: { id: 'tutorial', category: 'meta', check: ({ profile }) => profile.tutorial.completed },
  };
  const reg2: ContentRegistry = {
    ...reg,
    achievements,
    decks: {
      ...reg.decks,
      meta_deck: { id: 'meta_deck', art: ART, unlock: { type: 'achievement', id: 'first_round' } },
    },
  };

  it('udělí po události, uloží průběh, ignoruje rozbitou kontrolu, řetězí odemčení', () => {
    const p = createProfile(NOW);
    const ctx = ctxOf(reg2);
    const game = newGame({}, reg2);
    // modifikátory se spočítají ze stavu runu (UI je nedodalo)
    expect(startRun(p, game.state, ctx)).toEqual([{ kind: 'achievement', id: 'big_hand' }]);
    act(p, game, { type: 'selectBlind' }, ctx);
    act(p, game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }, ctx);
    expect(p.achievements.progress.two_hands).toBe(1);
    const notices = applyRunEvent(
      p,
      { type: 'roundWon', ante: 1, blind: 'small', score: 400, target: 300 },
      game.state,
      ctx,
    );
    expect(notices).toEqual([
      { kind: 'achievement', id: 'first_round' },
      { kind: 'unlock', category: 'decks', id: 'meta_deck' },
    ]);
    expect(p.achievements.unlocked.first_round).toBe(NOW);
    expect(isUnseen(p, 'achievements', 'first_round')).toBe(true);
    act(p, game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }, ctx);
    expect(p.achievements.unlocked.two_hands).toBe(NOW);
    expect(p.achievements.progress.two_hands).toBeUndefined();
    expect(p.achievements.unlocked.broken).toBeUndefined();
    // mimo run: tutoriál
    p.tutorial.completed = true;
    expect(refreshMeta(p, ctx)).toEqual([{ kind: 'achievement', id: 'tutorial' }]);
    expect(refreshMeta(p, ctx)).toEqual([]);
  });
});

describe('celý run botem', () => {
  function playWithMeta(seed: string): { profile: Profile; game: Game } {
    const profile = createProfile(NOW);
    const ctx = ctxOf();
    const game = newGame({ seed });
    startRun(profile, game.state, ctx);
    const bot = createBot('max');
    for (let i = 0; i < 4000; i++) {
      const phase = game.state.phase;
      if (phase === 'game_over' || phase === 'victory') break;
      const res = game.dispatch(bot.decide(game));
      if (!res.ok) {
        const fallback = game.dispatch(
          phase === 'shop'
            ? { type: 'leaveShop' }
            : phase === 'booster'
              ? { type: 'skipBooster' }
              : { type: 'cashOut' },
        );
        if (fallback.ok) applyRunEvents(profile, fallback.events, game.state, ctx);
        continue;
      }
      applyRunEvents(profile, res.events, game.state, ctx);
    }
    finishRun(profile, game.state, ctx);
    return { profile, game };
  }

  it('statistiky profilu sedí se statistikami runu; historie, objevy a determinismus', () => {
    const { profile, game } = playWithMeta('META2345');
    const st = game.state.stats;
    const t = profile.stats.totals;
    expect(game.state.phase === 'game_over' || game.state.phase === 'victory').toBe(true);
    expect(t.handsPlayed).toBe(st.handsPlayed);
    expect(t.cardsPlayed).toBe(st.cardsPlayed);
    expect(t.discards).toBe(st.discardsUsed);
    expect(t.cardsDiscarded).toBe(st.cardsDiscarded);
    expect(t.roundsWon).toBe(st.roundsWon);
    expect(t.bossesDefeated).toBe(st.bossesDefeated);
    expect(t.jokersBought).toBe(st.jokersBought);
    expect(t.jokersSold).toBe(st.jokersSold);
    expect(t.consumablesUsed).toBe(st.consumablesUsed);
    expect(t.rerolls).toBe(st.rerolls);
    expect(t.blindsSkipped).toBe(st.blindsSkipped);
    expect(t.shopsEntered).toBe(st.shopsEntered);
    expect(t.moneyEarned).toBe(st.moneyEarned);
    expect(t.moneySpent).toBe(st.moneySpent);
    expect(profile.stats.handTypes).toEqual(st.handTypeCounts);
    expect(profile.stats.jokerRounds).toEqual(st.jokerRoundCounts);
    expect(profile.stats.bestHand?.score).toBe(st.bestHandScore);
    expect(profile.stats.records.highestAnte).toBe(game.state.ante);
    expect(profile.stats.runs.played).toBe(1);
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0]).toMatchObject({
      seed: 'META2345',
      outcome: game.state.phase === 'victory' ? 'won' : 'lost',
      ante: game.state.ante,
      handsPlayed: st.handsPlayed,
      roundsWon: st.roundsWon,
      jokers: game.state.jokers.map((j) => j.defId),
    });
    for (const boss of game.state.bossesSeen) expect(profile.discovered.bosses).toContain(boss);
    for (const j of game.state.jokers) expect(profile.discovered.jokers).toContain(j.defId);
    expect(profile.current).toBeNull();
    expect(deserializeProfile(serializeProfile(profile, NOW))).toEqual(profile);
    // stejný seed + stejné akce = stejný profil
    expect(playWithMeta('META2345').profile).toEqual(profile);
  });
});
