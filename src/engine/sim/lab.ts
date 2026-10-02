/**
 * Laboratoř buildu pro boty (docs/DESIGN.md kap. 12.2): přesné skóre „typických rukou“ bota se zvolenou sestavou
 * žolíků, mezní hodnota vlastního žolíka a hodnota +1 úrovně kombinace. Boti tak oceňují žolíky a pranostiky
 * podle skutečného skórování (včetně synergií se sestavou a úrovněmi), ne podle tabulky vzácností.
 *
 * Typická ruka = náhodná ruka z **veřejného složení** balíčku (ne z pořadí — to bot nezná) o `handSize + LAB_EXTRA`
 * kartách (rezerva za zahazování), z níž bot vybere tah svým odhadem; skóruje se na syntetickém kole bez šéfa
 * čistou funkcí enginu `scoreHand` nad kopií stavu. Vzorky i RNG skórování jsou seedované seedem runu, patrem,
 * útratou a otiskem balíčku, ne stavem RNG hry — bot nevidí budoucí hody.
 *
 * Výsledky jsou čisté funkce vstupu, proto je smí sdílet paměť napříč rozhodnutími i runy: klíč obsahuje otisk
 * celého (normalizovaného) stavu, ze kterého se počítá, a sestavu žolíků. Determinismus to neporuší.
 */
import type { Rng } from '../content-types';
import { GameCore } from '../effects/core';
import { handValueAtLevel } from '../hands/levels';
import { cyrb128, rngFromState } from '../rng/rng';
import { Game } from '../run/game';
import { scoreHand } from '../scoring/score';
import type { HandType, JokerInstance, RoundState, RunState } from '../types';
import { HAND_TYPES } from '../types';
import { cardValue, planCandidates, RNG_STREAM_NAMES, type CardValue, type EvalEnv } from './hand-eval';

/** Počet typických rukou (přesně skórovaných). */
export const LAB_SAMPLES = 8;
/** Karet navíc nad velikost ruky (náhrada za zahazování — bot si z větší hromádky vybere lepší tah). */
export const LAB_EXTRA = 3;
/**
 * Peníze v šabloně: pevná „typická“ částka. Skórování peníze skoro nečte (ze 101 žolíků dva) a se skutečnými penězi
 * by se šablona měnila s každým nákupem — laboratoř by stejné nabídky ve Večerce přepočítávala znovu a znovu.
 */
const LAB_MONEY = 25;
/** Uid nových instancí v laboratoři (za všemi skutečnými). */
const LAB_UID_BASE = 1e7;
/** Strop paměti výsledků (při překročení se vymaže celá). */
const MEMO_MAX = 20000;

/** Krok skórování pro přehrání: [uid žolíka nebo −1, druh (0 = základ, 1 = +čipy, 2 = +mult, 3 = ×mult), a, b]. */
type ReplayStep = readonly [number, number, number, number];
type Replay = readonly ReplayStep[];

interface Scored {
  scores: number[];
  steps: Replay[];
}

const SCORE_MEMO = new Map<string, Scored>();
const SAMPLE_MEMO = new Map<string, LabSample[]>();

export interface LabSample {
  /** Karty v ruce (tah + držené). */
  hand: number[];
  /** Zahraný tah. */
  play: number[];
  type: HandType | null;
  /** Kolikátá ruka kola (0 = první) — žolíci na první/poslední ruku se tak průměrují. */
  handsPlayed: number;
}

export interface BuildLab {
  readonly samples: readonly LabSample[];
  /** Podíl kombinace mezi typickými tahy (0–1). */
  readonly typeShare: Readonly<Partial<Record<HandType, number>>>;
  /** Součet skóre typických rukou se současnými žolíky. */
  readonly base: number;
  /** Součet skóre typických rukou se sestavou `jokers` (v tomto pořadí; instance se kopírují). */
  score(jokers: readonly Readonly<JokerInstance>[]): number;
  /**
   * Odhad skóre současné sestavy bez žolíka `uid`: kroky skórování se přehrají bez kroků toho žolíka (aditivní
   * čipy a mult, ×mult). Nepřímé účinky (opakování karet, kopie) zůstanou — mezní hodnota pro výběr nejslabšího
   * žolíka, ne přesné skóre.
   */
  without(uid: number): number;
  /** Odhad skóre současné sestavy s kombinací `hand` o `levels` úrovní výš (přehrání se zvýšeným základem). */
  levelUp(hand: HandType, levels?: number): number;
  /**
   * Sestava `jokers` (přesně) a odhady téže sestavy bez jednoho žolíka (přehráním, jako `without`) — výměna žolíka
   * se tak ocení jedním přepočtem pro všechny kandidáty na prodej. `samples` = jen prvních tolik typických rukou
   * (rychlé síto; `base` je pak součet současné sestavy přes tytéž ruce).
   */
  variants(
    jokers: readonly Readonly<JokerInstance>[],
    samples?: number,
  ): { total: number; base: number; without(uid: number): number };
}

/** Otisk balíčku (seed vzorků): složení karet včetně úprav. */
function deckKey(s: Readonly<RunState>): string {
  let h = '';
  for (const c of s.deck)
    h += `${c.id}.${c.rank}${c.suit}${c.enhancement ?? ''}${c.seal ?? ''}${c.edition ?? ''};`;
  return cyrb128(h).join('.');
}

function jokersKey(jokers: readonly Readonly<JokerInstance>[]): string {
  return JSON.stringify(
    jokers.map((j) => [j.defId, j.edition, j.state, j.debuffed, j.stickers, j.perishRounds]),
  );
}

/**
 * Syntetický stav kola bez šéfa (šablona; ruka a žolíci se doplní pro každý vzorek). Pole, která skórování
 * nečte a která se mění s každou akcí ve Večerce (RNG, statistiky nákupů, uid nových instancí a spotřebek, štítky,
 * peníze — viz `LAB_MONEY`), se ustálí — šablona (a klíč paměti) se pak mění jen se skutečnou změnou buildu.
 */
function templateState(game: Game, money: number): RunState {
  const st = JSON.parse(JSON.stringify(game.state)) as RunState;
  const mods = game.modifiers();
  st.phase = 'round';
  st.shop = null;
  st.booster = null;
  st.gameOver = null;
  st.money = money;
  st.nextUid = LAB_UID_BASE;
  st.tags = [];
  st.consumables.forEach((c, i) => (c.uid = LAB_UID_BASE - 1 - i));
  for (const name of RNG_STREAM_NAMES) st.rng[name] = [1, 0, 0, 0];
  for (const c of st.deck) {
    c.debuffed = false;
    c.faceDown = false;
  }
  st.jokers = [];
  st.stats = {
    ...st.stats,
    moneyEarned: 0,
    moneySpent: 0,
    jokersBought: 0,
    jokersSold: 0,
    consumablesUsed: 0,
    rerolls: 0,
    shopsEntered: 0,
    blindsSkipped: 0,
    bestHandScore: 0,
    bestHandType: null,
    jokerRoundCounts: {},
    minMoney: 0,
    maxMoney: 0,
  };
  const round: RoundState = {
    blind: 'small',
    bossId: null,
    bossDisabled: false,
    target: Number.MAX_SAFE_INTEGER,
    score: 0,
    handsLeft: Math.max(1, mods.hands),
    discardsLeft: Math.max(0, mods.discards),
    drawPile: [],
    hand: [],
    discardPile: [],
    playedPile: [],
    handsPlayed: 0,
    discardsUsed: 0,
    handTypesPlayed: [],
    handSizeDelta: 0,
    jokerDebuffs: [],
    cleansedCards: [],
    ruleJokerDebuffs: [],
    flags: {},
  };
  st.round = round;
  return st;
}

/** Přehraje kroky skórování (bez kroků žolíka `skip`, se základem kombinace `base`). */
function replay(steps: Replay, skip: number, base?: { chips: number; mult: number }): number {
  let chips = 0;
  let mult = 0;
  for (const [uid, kind, a, b] of steps) {
    if (skip >= 0 && uid === skip) continue;
    if (kind === 0) {
      chips = base ? base.chips : a;
      mult = base ? base.mult : b;
    } else if (kind === 1) chips += a;
    else if (kind === 2) mult += a;
    else mult *= a;
  }
  return Math.max(0, chips * mult);
}

/**
 * Laboratoř pro stav `game`. `filler` = karty, kterých se bot chce zbavit (doplní jimi tah jako v kole), `tag` =
 * jméno bota (styl ovlivňuje výběr tahu; paměť vzorků je podle něj oddělená).
 */
export function makeLab(
  game: Game,
  env: EvalEnv,
  filler: (cards: readonly CardValue[]) => CardValue[],
  tag = '',
  samples = LAB_SAMPLES,
): BuildLab {
  const s = game.state;
  const reg = game.registry;
  const realJokers = s.jokers.map((j) => ({ ...j }));
  const template = templateState(game, LAB_MONEY);
  const templateJson = JSON.stringify(template);
  const tplKey = cyrb128(templateJson).join('.');
  const mods = game.modifiers();
  const handSize = Math.max(1, mods.handSize);
  const hands = Math.max(1, mods.hands);

  const sampleMemoKey = `${tplKey}|${tag}|${JSON.stringify(env.pref)}|${samples}`;
  let list = SAMPLE_MEMO.get(sampleMemoKey);
  if (!list) {
    list = [];
    const evalGame = Game.fromState(JSON.parse(templateJson) as RunState, reg);
    const evalEnv: EvalEnv = { ...env, blocked: undefined, hiddenPad: false };
    const rng: Rng = rngFromState(cyrb128(`${s.seed}:lab:${s.ante}:${s.blindIndex}:${deckKey(s)}`));
    const ids = s.deck.map((c) => c.id);
    for (let k = 0; k < samples && ids.length > 0; k++) {
      const take = Math.min(ids.length, handSize + LAB_EXTRA);
      for (let i = 0; i < take; i++) {
        const j = i + Math.floor(rng.next() * (ids.length - i));
        const tmp = ids[i]!;
        ids[i] = ids[j]!;
        ids[j] = tmp;
      }
      const pile = ids.slice(0, take);
      const cards = pile.map((id) => cardValue(evalGame.card(id)!, evalEnv));
      const best = planCandidates(evalGame, cards, evalEnv, filler(cards))[0];
      if (!best) continue;
      const rest = pile.filter((id) => !best.ids.includes(id));
      const hand = [...best.ids, ...rest.slice(0, Math.max(0, handSize - best.ids.length))];
      list.push({ hand, play: best.ids, type: best.type, handsPlayed: k % hands });
    }
    if (SAMPLE_MEMO.size >= MEMO_MAX / 10) SAMPLE_MEMO.clear();
    SAMPLE_MEMO.set(sampleMemoKey, list);
  }
  const counts: Partial<Record<HandType, number>> = {};
  for (const x of list) if (x.type) counts[x.type] = (counts[x.type] ?? 0) + 1;
  const typeShare: Partial<Record<HandType, number>> = {};
  for (const t of HAND_TYPES) if (counts[t]) typeShare[t] = counts[t]! / Math.max(1, list.length);
  const sampleKey = list.map((x) => `${x.play.join(',')}/${x.hand.join(',')}`).join('|');
  const deckIds = s.deck.map((c) => c.id);

  const scoreOne = (sample: LabSample, k: number, jokersJson: string, stepsOut: Replay[]): number => {
    const st = JSON.parse(templateJson) as RunState;
    st.jokers = JSON.parse(jokersJson) as JokerInstance[];
    const round = st.round!;
    const inHand = new Set(sample.hand);
    round.hand = [...sample.hand];
    round.drawPile = deckIds.filter((id) => !inHand.has(id));
    round.handsPlayed = sample.handsPlayed;
    round.handsLeft = Math.max(1, hands - sample.handsPlayed);
    const seed = cyrb128(`${s.seed}:labrng:${k}`);
    for (const name of RNG_STREAM_NAMES) st.rng[name] = [(seed[0]! | 1) >>> 0, seed[1]!, seed[2]!, seed[3]!];
    try {
      const res = scoreHand(new GameCore(st, reg), sample.play);
      const out: ReplayStep[] = [];
      for (const step of res.steps) {
        const uid = step.jokerUid ?? -1;
        if (step.source === 'hand') out.push([uid, 0, step.chips ?? 0, step.mult ?? 0]);
        else {
          if (step.chips) out.push([uid, 1, step.chips, 0]);
          if (step.mult) out.push([uid, 2, step.mult, 0]);
          if (step.xmult !== undefined && step.xmult !== 1) out.push([uid, 3, step.xmult, 0]);
        }
      }
      stepsOut.push(out);
      return res.blockedReason ? 0 : Math.max(0, res.score);
    } catch {
      stepsOut.push([]);
      return 0;
    }
  };

  /**
   * Skóre a kroky prvních `n` vzorků se sestavou `jokers` (paměť podle otisku šablony, vzorků a sestavy; vzorky se
   * dopočítávají postupně, takže rychlé síto a plné ocenění sdílí práci).
   */
  const scored = (jokers: readonly Readonly<JokerInstance>[], n = list.length): Scored => {
    // Dočasné vypnutí (šéf, kolo) se do laboratoře nepřenáší — jen zvětralí žolíci zůstanou mimo provoz.
    const norm = jokers.map((j) => ({ ...j, debuffed: j.perishRounds === 0 }));
    const key = `${tplKey}|${sampleKey}|${jokersKey(norm)}`;
    let out = SCORE_MEMO.get(key);
    if (!out) {
      out = { scores: [], steps: [] };
      if (SCORE_MEMO.size >= MEMO_MAX) SCORE_MEMO.clear();
      SCORE_MEMO.set(key, out);
    }
    const want = Math.min(n, list.length);
    if (out.scores.length < want) {
      const json = JSON.stringify(norm);
      for (let k = out.scores.length; k < want; k++) out.scores.push(scoreOne(list[k]!, k, json, out.steps));
    }
    return out;
  };

  const sum = (xs: readonly number[], n = xs.length): number => xs.slice(0, n).reduce((a, b) => a + b, 0);
  const baseScored = scored(realJokers);
  const base = sum(baseScored.scores);

  /**
   * Součet přes prvních `n` vzorků: přesné skóre × poměr přehrání se změnou / přehrání beze změny (null = beze
   * změny).
   */
  const adjustedOf = (
    sc: Scored,
    change: (steps: Replay, k: number) => number | null,
    n = list.length,
  ): number => {
    let total = 0;
    sc.steps.slice(0, n).forEach((steps, k) => {
      const score = sc.scores[k]!;
      const changed = change(steps, k);
      const full = changed === null ? 0 : replay(steps, -1);
      total += changed !== null && full > 0 ? (score * changed) / full : score;
    });
    return total;
  };
  const adjusted = (change: (steps: Replay, k: number) => number | null): number =>
    adjustedOf(baseScored, change);

  return {
    samples: list,
    typeShare,
    base,
    score: (jokers) => sum(scored(jokers).scores),
    without: (uid) => adjusted((steps) => replay(steps, uid)),
    variants: (jokers, n = list.length) => {
      const sc = scored(jokers, n);
      const m = Math.min(n, sc.scores.length);
      return {
        total: sum(sc.scores, m),
        base: sum(baseScored.scores, m),
        without: (uid) => adjustedOf(sc, (steps) => replay(steps, uid), m),
      };
    },
    levelUp: (hand, levels = 1) => {
      const def = reg.handTypes[hand];
      if (!def) return base;
      const value = handValueAtLevel(def, (s.handLevels[hand]?.level ?? 1) + levels);
      return adjusted((steps, k) => (list[k]!.type === hand ? replay(steps, -1, value) : null));
    },
  };
}
