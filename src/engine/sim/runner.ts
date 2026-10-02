/**
 * Headless runner simulace: odehraje run botem přes `Game.dispatch` (stejný engine jako hra) a shrne sadu runů
 * do metrik z docs/DESIGN.md kap. 12.3. Deterministický: run `i` sady má seed `SIM-<prefix>-<i>`.
 */
import type { ContentRegistry } from '../content-types';
import { FINAL_ANTE } from '../constants';
import { Game } from '../run/game';
import type { Action } from '../types';
import type {
  BossStat,
  Bot,
  BotStrength,
  JokerStat,
  RunResult,
  ShopMoneySample,
  SimSummary,
  SimulateRunOptions,
} from './types';

/** Pojistka proti zacyklení bota: výhra trvá zhruba 400 akcí (24 kol). */
export const DEFAULT_MAX_ACTIONS = 5000;
/** Po tolika neplatných akcích za sebou runner provede bezpečnou výchozí akci fáze. */
export const MAX_CONSECUTIVE_INVALID = 3;

/**
 * Cílové pásmo % výher rozumné strategie podle síly piva (DESIGN 10 a 12.1) — [min, max] v procentech, pro hotovou
 * hru se šéfy. Kalibrace po fázi 7 (plný obsah): všech 8 sil piva v pásmu (docs/DECISIONS.md „Balanc po fázi 7“).
 */
export const WIN_RATE_TARGETS: Readonly<Record<number, readonly [number, number]>> = Object.freeze({
  1: [25, 35],
  2: [20, 30],
  3: [14, 22],
  4: [10, 17],
  5: [7, 12],
  6: [4, 8],
  7: [3, 6],
  8: [1, 3],
});

/** Seed runu `i` (1…N) sady simulace (DESIGN 12.2). */
export function simSeed(prefix: string, i: number): string {
  return `SIM-${prefix}-${i}`;
}

/** Bezpečná akce pro fázi (když bot opakovaně posílá neplatné akce). */
export function fallbackAction(game: Game): Action {
  const s = game.state;
  switch (s.phase) {
    case 'round':
      return { type: 'play', cardIds: s.round?.hand.slice(0, 1) ?? [] };
    case 'round_end':
      return { type: 'cashOut' };
    case 'shop':
      return { type: 'leaveShop' };
    case 'booster':
      return { type: 'skipBooster' };
    case 'victory':
      return { type: 'continueEndless' };
    default:
      return { type: 'selectBlind' };
  }
}

/** Odehraje jeden run botem. Run končí výhrou (porážka šéfa patra 8), prohrou nebo limitem akcí. */
export function simulateRun(registry: ContentRegistry, opts: SimulateRunOptions): RunResult {
  const game = Game.newRun(
    { seed: opts.seed, deckId: opts.deckId, stake: opts.stake, challengeId: opts.challengeId ?? null },
    registry,
  );
  const maxActions = opts.maxActions ?? DEFAULT_MAX_ACTIONS;
  const shopMoney: ShopMoneySample[] = [];
  const bosses: string[] = [];
  const skipTags: string[] = [];
  const bestHandByAnte: number[] = [];
  let finalBossRatio: number | null = null;
  const invalidByCode: Record<string, number> = {};
  let actions = 0;
  let invalid = 0;
  let streak = 0;
  while (actions < maxActions) {
    const phase = game.state.phase;
    if (phase === 'game_over' || phase === 'victory') break;
    const action = streak >= MAX_CONSECUTIVE_INVALID ? fallbackAction(game) : opts.bot.decide(game);
    const res = game.dispatch(action);
    actions++;
    if (!res.ok) {
      invalid++;
      streak++;
      invalidByCode[res.error] = (invalidByCode[res.error] ?? 0) + 1;
      continue;
    }
    streak = 0;
    for (const e of res.events) {
      if (e.type === 'shopEntered') shopMoney.push({ ante: game.state.ante, money: game.state.money });
      else if (e.type === 'blindSelected' && e.blind === 'boss' && e.bossId) bosses.push(e.bossId);
      else if (e.type === 'blindSkipped' && e.tagId) skipTags.push(e.tagId);
      else if (e.type === 'handPlayed') {
        const i = Math.max(0, game.state.ante - 1);
        while (bestHandByAnte.length <= i) bestHandByAnte.push(0);
        bestHandByAnte[i] = Math.max(bestHandByAnte[i]!, e.result.score);
      } else if (e.type === 'roundWon' && e.ante === FINAL_ANTE && e.blind === 'boss' && e.target > 0)
        finalBossRatio = e.score / e.target;
      else if (e.type === 'gameOver' && e.info.ante === FINAL_ANTE && e.info.blind === 'boss' && e.info.target > 0)
        finalBossRatio = e.info.score / e.info.target;
    }
  }
  return buildResult(game, opts, {
    actions,
    invalid,
    invalidByCode,
    shopMoney,
    bosses,
    skipTags,
    bestHandByAnte,
    finalBossRatio,
  });
}

function buildResult(
  game: Game,
  opts: SimulateRunOptions,
  run: {
    actions: number;
    invalid: number;
    invalidByCode: Record<string, number>;
    shopMoney: ShopMoneySample[];
    bosses: string[];
    skipTags: string[];
    bestHandByAnte: number[];
    finalBossRatio: number | null;
  },
): RunResult {
  const s = game.state;
  const st = s.stats;
  const won = s.phase === 'victory';
  const over = s.gameOver;
  const current = s.blinds[s.blindIndex];
  const jokerRounds = { ...st.jokerRoundCounts };
  for (const j of s.jokers) jokerRounds[j.defId] ??= 0;
  return {
    seed: s.seed,
    bot: opts.bot.name,
    deckId: s.deckId,
    stake: s.stake,
    won,
    ante: over?.ante ?? s.ante,
    blind: over?.blind ?? (won ? 'boss' : (s.round?.blind ?? current?.kind ?? 'small')),
    cause: won ? null : (over?.cause ?? 'actionLimit'),
    score: over?.score ?? s.round?.score ?? 0,
    target: over?.target ?? s.round?.target ?? 0,
    roundsWon: st.roundsWon,
    handsPlayed: st.handsPlayed,
    discardsUsed: st.discardsUsed,
    bestHand: st.bestHandScore,
    bestHandType: st.bestHandType,
    moneyEarned: st.moneyEarned,
    moneySpent: st.moneySpent,
    finalMoney: s.money,
    jokersBought: st.jokersBought,
    jokersSold: st.jokersSold,
    consumablesUsed: st.consumablesUsed,
    rerolls: st.rerolls,
    blindsSkipped: st.blindsSkipped,
    actions: run.actions,
    invalidActions: run.invalid,
    invalidByCode: run.invalidByCode,
    jokerIds: Object.keys(jokerRounds)
      .filter((id) => (jokerRounds[id] ?? 0) > 0)
      .sort(),
    jokerRounds,
    shopMoney: run.shopMoney,
    bosses: run.bosses,
    skipTags: run.skipTags,
    bestHandByAnte: run.bestHandByAnte,
    finalBossRatio: run.finalBossRatio,
  };
}

export interface SimulateManyOptions {
  runs: number;
  seedPrefix: string;
  deckId: string;
  stake: number;
  bot: Bot;
  maxActions?: number;
  /** Volá se po každém runu (průběh ve skriptu). */
  onRun?: (result: RunResult, index: number) => void;
}

/** Sada runů jednoho bota se seedy `SIM-<prefix>-1` … `SIM-<prefix>-<runs>`. */
export function simulateMany(registry: ContentRegistry, opts: SimulateManyOptions): RunResult[] {
  const out: RunResult[] = [];
  for (let i = 1; i <= opts.runs; i++) {
    const result = simulateRun(registry, {
      seed: simSeed(opts.seedPrefix, i),
      deckId: opts.deckId,
      stake: opts.stake,
      bot: opts.bot,
      maxActions: opts.maxActions,
    });
    out.push(result);
    opts.onRun?.(result, i);
  }
  return out;
}

// ─────────────────────────── Souhrn ───────────────────────────

const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (part: number, whole: number): number => (whole > 0 ? (100 * part) / whole : 0);

/** Percentil `p` (0–1) metodou nejbližšího pořadí; prázdný seznam → 0. */
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

/** Metrika síly bota (DESIGN 12.3): nejlepší ruka v patře 8 a poměr skóre/cíl finálového šéfa. */
export function botStrength(results: readonly RunResult[]): BotStrength {
  const best8 = (rs: readonly RunResult[]): number[] =>
    rs.filter((r) => r.ante >= FINAL_ANTE).map((r) => r.bestHandByAnte?.[FINAL_ANTE - 1] ?? 0);
  const all = best8(results);
  const winners = best8(results.filter((r) => r.won));
  return {
    reached: all.length,
    medianBest8: median(all),
    p90Best8: percentile(all, 0.9),
    winnersMedianBest8: median(winners),
    winnersP90Best8: percentile(winners, 0.9),
    medianFinalRatio: median(
      results.map((r) => r.finalBossRatio).filter((x): x is number => typeof x === 'number'),
    ),
  };
}

/**
 * Souhrn sady runů (DESIGN 12.3): výhry, dosažená patra, příčiny proher, skóre, peníze, délka runu a síla žolíků
 * (% výher runů, kde byl žolík ve slotu na konci aspoň jednoho kola, proti runům bez něj).
 */
export function summarizeRuns(results: readonly RunResult[], minJokerRuns = 1): SimSummary {
  const runs = results.length;
  const wins = results.filter((r) => r.won).length;
  const maxAnte = Math.max(FINAL_ANTE, ...results.map((r) => r.ante));
  const reachedAnte = Array.from(
    { length: maxAnte },
    (_, i) => results.filter((r) => r.ante >= i + 1).length,
  );
  const lostAtAnte = Array.from({ length: maxAnte }, () => 0);
  const causeCounts = new Map<string, number>();
  const losses = results.filter((r) => !r.won);
  for (const r of losses) {
    lostAtAnte[Math.max(1, Math.min(maxAnte, r.ante)) - 1]!++;
    const cause = r.cause ?? 'actionLimit';
    causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
  }
  const causes = [...causeCounts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0));

  const shopByAnte = new Map<number, number[]>();
  for (const r of results)
    for (const sm of r.shopMoney) {
      const list = shopByAnte.get(sm.ante);
      if (list) list.push(sm.money);
      else shopByAnte.set(sm.ante, [sm.money]);
    }
  const avgShopMoney: Record<number, number> = {};
  for (const ante of [...shopByAnte.keys()].sort((a, b) => a - b))
    avgShopMoney[ante] = avg(shopByAnte.get(ante)!);

  const jokerIds = [...new Set(results.flatMap((r) => r.jokerIds))].sort();
  const jokers: JokerStat[] = jokerIds
    .map((id) => {
      const withJ = results.filter((r) => r.jokerIds.includes(id));
      const without = results.filter((r) => !r.jokerIds.includes(id));
      const winsWith = withJ.filter((r) => r.won).length;
      const winRateWith = pct(winsWith, withJ.length);
      const winRateWithout = pct(without.filter((r) => r.won).length, without.length);
      return {
        id,
        runs: withJ.length,
        wins: winsWith,
        winRateWith,
        winRateWithout,
        delta: winRateWith - winRateWithout,
      };
    })
    .filter((j) => j.runs >= minJokerRuns)
    .sort((a, b) => b.delta - a.delta || b.runs - a.runs || (a.id < b.id ? -1 : 1));

  // Letalita šéfů: setkání v útratě Šéf a prohry na něm (prohra ve Velké útratě s pravidlem šéfa se nepočítá).
  const bossCounts = new Map<string, { encounters: number; deaths: number }>();
  for (const r of results) {
    for (const id of r.bosses ?? []) {
      const b = bossCounts.get(id) ?? { encounters: 0, deaths: 0 };
      b.encounters++;
      bossCounts.set(id, b);
    }
    if (!r.won && r.blind === 'boss' && r.cause) {
      const b = bossCounts.get(r.cause);
      if (b) b.deaths++;
    }
  }
  const bosses: BossStat[] = [...bossCounts.entries()]
    .map(([id, b]) => ({ id, ...b, lethality: pct(b.deaths, b.encounters) }))
    .sort((a, b) => b.lethality - a.lethality || b.encounters - a.encounters || (a.id < b.id ? -1 : 1));
  const skipTags: Record<string, number> = {};
  for (const r of results) for (const id of r.skipTags ?? []) skipTags[id] = (skipTags[id] ?? 0) + 1;

  return {
    bot: results[0]?.bot ?? '',
    runs,
    wins,
    winRate: pct(wins, runs),
    reachedAnte,
    lostAtAnte,
    causes,
    topCause: causes[0]?.cause ?? null,
    avgAnte: avg(results.map((r) => r.ante)),
    avgBestHand: avg(results.map((r) => r.bestHand)),
    medianBestHand: median(results.map((r) => r.bestHand)),
    avgLossScore: avg(losses.map((r) => r.score)),
    avgLossRatio: avg(losses.filter((r) => r.target > 0).map((r) => r.score / r.target)),
    avgRoundsWon: avg(results.map((r) => r.roundsWon)),
    avgHands: avg(results.map((r) => r.handsPlayed)),
    avgActions: avg(results.map((r) => r.actions)),
    avgMoneyEarned: avg(results.map((r) => r.moneyEarned)),
    avgMoneySpent: avg(results.map((r) => r.moneySpent)),
    avgShopMoney,
    jokers,
    bosses,
    avgSkips: avg(results.map((r) => r.blindsSkipped)),
    skipTags,
    invalidActions: results.reduce((a, r) => a + r.invalidActions, 0),
    strength: botStrength(results),
  };
}
