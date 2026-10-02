/**
 * Hodnota změn stavu pro boty (docs/DESIGN.md kap. 12.2) — v „korunách“, aby šla porovnat s cenou.
 *
 * Boti spotřebky, obálky ani kupóny nepoznávají podle id: akci zkusí na kopii hry („sonda“, RNG kopie je
 * přeseedovaný — bot nezná skutečné hody) a porovnají stav před a po. Hodnota se skládá z:
 *
 * - peněz (1 Kč = 1),
 * - úrovní kombinací (`LEVEL_KC` × podíl kombinace na hře bota),
 * - modifikátorů runu (ruce, zahození, velikost ruky, sloty, Večerka, cíle…) a patra,
 * - žolíků (součet hodnocení bota × `JOKER_KC`), nových spotřebek,
 * - balíčku: hodnota karty = „afinita“ (jak často karta skóruje ve hře bota: hlavní barva, hodnoty do párů,
 *   vysoké karty) × (strukturní hodnota + co karta přidá při skórování) + co dá držená v ruce (ocelová) + peníze
 *   z vylepšení a pečetí za zbytek runu. Balíček = průměr hodnot karet × 52, takže zničení slabé karty balíček
 *   zlepší a přidání slabé ho zředí.
 *
 * Čísla jsou heuristika pro rozhodování botů (kalibrace cílů simulací), ne herní pravidla. Vše jsou čisté funkce
 * nad veřejným stavem; sondy hru nemění.
 */
import { FINAL_ANTE } from '../constants';
import type { Rng } from '../content-types';
import { cyrb128, rngFromState } from '../rng/rng';
import type { Game } from '../run/game';
import type { Action, Card, HandType, JokerInstance, Modifiers, Rank, RunState } from '../types';
import { HAND_TYPES } from '../types';
import { cardValue, cloneGame, type EvalEnv } from './hand-eval';

// ─────────────────────────── Konstanty (Kč) ───────────────────────────

/** +1 úroveň kombinace, kterou bot hraje vždy (× podíl kombinace na hře). */
export const LEVEL_KC = 30;
/** Jedna jednotka hodnocení žolíka (běžný žolík ≈ 1). */
export const JOKER_KC = 5;
/** Strukturní hodnota karty, která skóruje vždy (afinita 1) — tvoří kombinace. */
const STRUCT_KC = 3;
/** Kč za bod „ceny“ karty při skórování (čipy + 8 × mult + 40 × (×mult − 1)). */
const WORTH_KC = 0.05;
/** Kolo s kartou zničenou z ruky přijde o kartu do dalšího dobrání. */
const ROUND_HAND_CARD_KC = 0.6;
/** Karta v ruce, která v kole přestala být debuffnutá (Česnek na krk proti šéfovi). */
const ROUND_CLEANSE_KC = 1;
const ROUND_HAND_KC = 6;
const ROUND_DISCARD_KC = 1.2;
const BOSS_OFF_KC = 6;
/** −1 patro = celé patro kol, peněz a Večerek navíc. */
const ANTE_KC = 7;
/** Nová spotřebka, která není pranostika. */
const CONSUMABLE_KC: Readonly<Record<string, number>> = { rada: 1.2, razitko: 1.5 };
/** Spotřebka držená pro žolíka ×mult za držené spotřebky: Kč za každých +1 ×mult. */
const HOLD_KC = 25;
/**
 * Škálující žolík, kterého akce „nakrmí“ (číselný stav vzroste — Kořenářka po babské radě, Sběrač hub po zničené
 * kartě): Kč za jednotku růstu, nejvýš `FEED_MAX` jednotek na žolíka.
 */
const FEED_KC = 1.5;
const FEED_MAX = 3;

/** Váhy trvalých modifikátorů (Kč za +1, případně za jednotku). */
const MOD_KC = {
  hands: 20,
  discards: 7,
  handSize: 14,
  maxSelect: 8,
  jokerSlots: 16,
  consumableSlots: 2.5,
  shopCardSlots: 5,
  shopBoosterSlots: 2.5,
  shopVoucherSlots: 2,
  debtLimit: 0.1,
  shopWeightPranostika: 0.25,
  shopWeightRada: 0.25,
  shopWeightRazitko: 0.2,
  shopWeightPlayingCard: -0.3,
} as const;
/** Kč za kolo zbývajícího runu (peníze, které modifikátor přinese nebo ušetří v každém kole / Večerce). */
const PER_ROUND_KC = {
  moneyPerUnusedHand: 0.6,
  moneyPerUnusedDiscard: 0.9,
  blindRewardMult: 2.4,
  /** Sleva: Kč za 1 % (průměrná útrata ve Večerce ≈ 6 Kč). */
  shopDiscountPct: 0.04,
  shopPriceAdd: -1.4,
  rerollBaseCost: -0.5,
  rerollCostStep: -0.5,
} as const;
/** Kč za Kč stropu úroku za kolo zbývajícího runu (bot, který drží plnou rezervu / ostatní). */
const INTEREST_CAP_KC = { full: 0.2, other: 0.06 } as const;
/** Přepínače pravidel kombinací. */
const FLAG_KC: Partial<Record<keyof Modifiers, number>> = {
  fourCardStraightFlush: 4,
  straightGaps: 2,
  straightWrap: 1,
  mergedSuits: 3,
  allCardsScore: 3,
  disableEnhancements: -3,
};
/** Logaritmické modifikátory: Kč × ln(po / před). */
const LOG_KC: Partial<Record<keyof Modifiers, number>> = {
  editionRateMult: 2,
  probabilityMult: 3,
  targetMult: -45,
};

/** Kolik kol se počítá peněz z karty (vylepšení, pečeť) — zbytek runu, nejvýš 12, s poloviční vahou. */
const MONEY_HORIZON = 12;
const MONEY_HORIZON_WEIGHT = 0.5;

// ─────────────────────────── Pohled bota ───────────────────────────

/** Co z bota potřebuje ocenění: styl a hodnocení žolíků. */
export interface ValueStyle {
  readonly favorHands: readonly HandType[];
  readonly suitFocus: boolean;
  readonly rankFocus: boolean;
  readonly buysJokers: boolean;
  readonly fullReserve: boolean;
}

/** Ocenění stavu jedné hry z pohledu bota (spočítané jednou pro rozhodnutí). */
export interface ValueView {
  readonly game: Game;
  readonly style: ValueStyle;
  readonly env: EvalEnv;
  /** Podíl kombinace na hře bota (součet 1). */
  readonly share: Readonly<Record<HandType, number>>;
  /** Váha rodiny Barvy a rodiny kombinací hodnot (0–1). */
  readonly flush: number;
  readonly pairs: number;
  /** Bit hlavní barvy balíčku (`SUITS[i]`). */
  readonly mainSuit: number;
  /** Počty hodnot v balíčku. */
  readonly rankCounts: ReadonlyMap<number, number>;
  /** Pravděpodobnost, že se karta v kole dostane do ruky. */
  readonly pDraw: number;
  /** Kola, za která se počítají peníze z karty (s vahou). */
  readonly horizon: number;
  /** Zbývající kola do konce hlavní hry (aspoň 1). */
  readonly roundsLeft: number;
  readonly rating: (game: Game, joker: JokerInstance) => number;
  /** Hodnota balíčku před změnou (mezivýsledek). */
  readonly deckWorth: number;
  /** Kolik Kč má každá spotřebka držená ve slotu (žolík ×mult za držené spotřebky — Babiččina truhla). */
  readonly holdWorth: number;
}

const FLUSH_FAMILY: readonly HandType[] = [
  'flush',
  'straight_flush',
  'royal_flush',
  'flush_house',
  'flush_five',
];
const PAIR_FAMILY: readonly HandType[] = [
  'pair',
  'two_pair',
  'three',
  'full_house',
  'four',
  'five',
  'flush_house',
  'flush_five',
];
/** Apriorní podíly kombinací (bez zahraných rukou) a váha oblíbených kombinací stylu. */
const PRIOR_SHARE: Partial<Record<HandType, number>> = {
  high_card: 1,
  pair: 2,
  two_pair: 1.5,
  three: 0.7,
  straight: 0.5,
  flush: 0.6,
  full_house: 0.3,
};
const FAVOR_PRIOR = 2;

/** Zbývající kola hlavní hry (patro 8 = poslední; v nekonečném režimu aspoň 1). */
export function roundsLeft(game: Game): number {
  const s = game.state;
  return Math.max(1, (FINAL_ANTE - s.ante) * 3 + (3 - s.blindIndex));
}

export function makeView(
  game: Game,
  style: ValueStyle,
  env: EvalEnv,
  mainSuit: number,
  rating: (game: Game, joker: JokerInstance) => number,
): ValueView {
  const s = game.state;
  const raw = {} as Record<HandType, number>;
  let total = 0;
  for (const t of HAND_TYPES) {
    const v =
      (s.stats.handTypeCounts[t] ?? 0) +
      (PRIOR_SHARE[t] ?? 0) +
      (style.favorHands.includes(t) ? FAVOR_PRIOR : 0);
    raw[t] = v;
    total += v;
  }
  const share = {} as Record<HandType, number>;
  for (const t of HAND_TYPES) share[t] = total > 0 ? raw[t] / total : 0;
  const sum = (types: readonly HandType[]): number => types.reduce((a, t) => a + share[t], 0);
  const flush = style.suitFocus ? Math.max(0.6, sum(FLUSH_FAMILY)) : sum(FLUSH_FAMILY);
  const pairs = style.rankFocus ? Math.max(0.6, sum(PAIR_FAMILY)) : sum(PAIR_FAMILY);
  const rankCounts = new Map<number, number>();
  for (const c of s.deck)
    if (!env.enhancements[c.enhancement ?? '']?.noRankSuit)
      rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  const left = roundsLeft(game);
  const n = Math.max(1, s.deck.length);
  const partial = {
    game,
    style,
    env,
    share,
    flush,
    pairs,
    mainSuit,
    rankCounts,
    pDraw: Math.min(1, (env.mods.handSize + 10) / n),
    horizon: Math.min(left, MONEY_HORIZON) * MONEY_HORIZON_WEIGHT,
    roundsLeft: left,
    rating,
    deckWorth: 0,
    holdWorth: holdWorth(game),
  };
  return { ...partial, deckWorth: deckWorth(partial, s.deck) };
}

/**
 * Hodnota spotřebky držené ve slotu: žolíci se štítky `consumable` a `xmult` (×mult za každou drženou spotřebku)
 * dávají `HOLD_KC` × (×mult − 1). Bot pak spotřebky drží a použije jen ty, které mají větší cenu.
 */
export function holdWorth(game: Game): number {
  let v = 0;
  for (const j of game.state.jokers) {
    if (j.debuffed) continue;
    const def = game.registry.jokers[j.defId];
    if (!def || !def.tags.includes('consumable') || !def.tags.includes('xmult')) continue;
    v += HOLD_KC * Math.max(0, num(def.params?.xmult) - 1);
  }
  return v;
}

// ─────────────────────────── Karty a balíček ───────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Jak často karta skóruje ve hře bota (0,05–0,95). */
export function affinity(view: ValueView, card: Readonly<Card>, suitMask: number, stone: boolean): number {
  if (stone) return clamp(0.45 - 0.25 * view.flush, 0.05, 0.95);
  let a = 0.22;
  a += suitMask & (1 << view.mainSuit) ? 0.45 * view.flush : -0.12 * view.flush;
  const dup = clamp(((view.rankCounts.get(card.rank) ?? 0) - 4) / 4, -1, 1);
  a += view.pairs * (0.15 + 0.1 * dup);
  if (card.rank >= 10) a += 0.06 * (1 - view.flush);
  return clamp(a, 0.05, 0.95);
}

/** Hodnota karty v balíčku v Kč (viz hlavička souboru). Dočasné stavy kola (debuff, lícem dolů) se nepočítají. */
export function cardWorth(view: ValueView, card: Readonly<Card>): number {
  const c = card.debuffed || card.faceDown ? { ...card, debuffed: false, faceDown: false } : card;
  const cv = cardValue(c, view.env);
  const aff = affinity(view, c, cv.suitMask, cv.stone);
  let play = cv.chips + 8 * cv.mult + 40 * (cv.xmult - 1);
  const held = 30 * (cv.heldXmult - 1);
  let money = 0;
  const enh = c.enhancement ? view.env.enhancements[c.enhancement] : undefined;
  if (enh) {
    const p = enh.params ?? {};
    // Peníze z karty držené na konci kola (zlatá).
    if (enh.roundEndHeldMoney) money += (1 - aff) * view.pDraw * num(p.money) * view.horizon;
    // Šťastná: šance na peníze při skórování.
    if (num(p.moneyOdds) > 0)
      money += (aff * view.pDraw * num(p.money) * 1.5 * view.horizon) / num(p.moneyOdds);
    // Rostoucí čipy po skórování (ohmataná): průměr růstu za zbytek runu.
    if (enh.afterScored && !enh.onScored && num(p.chips) > 0)
      play += (num(p.chips) * aff * view.pDraw * 1.5 * view.horizon) / 2;
  }
  const seal = c.seal ? view.game.registry.seals[c.seal] : undefined;
  if (seal) {
    if (seal.onScored) money += aff * view.pDraw * num(seal.params?.money) * 1.5 * view.horizon;
    if (seal.onRoundEndHeld) money += (1 - aff) * view.pDraw * 2 * view.horizon * 0.5;
    if (seal.onDiscarded) money += (1 - aff) * view.pDraw * 1.5 * view.horizon * 0.5;
  }
  return aff * (STRUCT_KC + WORTH_KC * play) + (1 - aff) * WORTH_KC * held + money;
}

type DeckView = Pick<
  ValueView,
  'env' | 'flush' | 'pairs' | 'mainSuit' | 'rankCounts' | 'pDraw' | 'horizon' | 'game'
>;

/** Hodnota balíčku: 52 × průměrná hodnota karty. */
export function deckWorth(view: DeckView, deck: readonly Readonly<Card>[]): number {
  if (deck.length === 0) return 0;
  let sum = 0;
  for (const c of deck) sum += cardWorth(view as ValueView, c);
  return (52 * sum) / deck.length;
}

// ─────────────────────────── Úrovně, modifikátory, spotřebky ───────────────────────────

/** +1 úroveň kombinace. */
export function levelWorth(view: ValueView, hand: HandType): number {
  return LEVEL_KC * ((view.share[hand] ?? 0) + 0.03);
}

/** Nová spotřebka (použije se později). */
export function consumableWorth(view: ValueView, defId: string): number {
  const def = view.game.registry.consumables[defId];
  if (!def) return 0;
  if (def.hand) return levelWorth(view, def.hand);
  return CONSUMABLE_KC[def.kind] ?? 1;
}

/** Změna modifikátorů runu v Kč. */
export function modsWorth(view: ValueView, before: Readonly<Modifiers>, after: Readonly<Modifiers>): number {
  let v = 0;
  for (const [key, kc] of Object.entries(MOD_KC) as [keyof typeof MOD_KC, number][]) {
    const d = num(after[key]) - num(before[key]);
    if (d === 0) continue;
    if (key === 'jokerSlots' && !view.style.buysJokers) continue;
    v += d * kc;
  }
  for (const [key, kc] of Object.entries(PER_ROUND_KC) as [keyof typeof PER_ROUND_KC, number][]) {
    const d = num(after[key]) - num(before[key]);
    if (d !== 0) v += d * kc * view.roundsLeft;
  }
  const cap = num(after.interestCap) - num(before.interestCap);
  if (cap !== 0)
    v += cap * (view.style.fullReserve ? INTEREST_CAP_KC.full : INTEREST_CAP_KC.other) * view.roundsLeft;
  for (const [key, kc] of Object.entries(FLAG_KC) as [keyof Modifiers, number][])
    if (Boolean(after[key]) !== Boolean(before[key])) v += after[key] ? kc : -kc;
  for (const [key, kc] of Object.entries(LOG_KC) as [keyof Modifiers, number][]) {
    const b = num(before[key]);
    const a = num(after[key]);
    if (a > 0 && b > 0 && a !== b) v += kc * Math.log(a / b);
  }
  return v;
}

function jokerSum(view: ValueView, game: Game): number {
  let sum = 0;
  for (const j of game.state.jokers) sum += view.rating(game, j);
  return sum;
}

// ─────────────────────────── Změna stavu ───────────────────────────

/** Rozpad hodnoty změny (peníze zvlášť — bot je drží, když spotřebka dá „jen peníze“ a málo). */
export interface Delta {
  total: number;
  money: number;
}

/** Hodnota přechodu ze stavu `view.game` do `after` (kopie hry po akci). */
export function stateDelta(view: ValueView, after: Game): Delta {
  const b = view.game.state;
  const a = after.state;
  const money = a.money - b.money;
  let v = money;
  for (const t of HAND_TYPES) {
    const d = (a.handLevels[t]?.level ?? 1) - (b.handLevels[t]?.level ?? 1);
    if (d !== 0) v += d * levelWorth(view, t);
  }
  const mb = view.game.modifiers();
  const ma = after.modifiers();
  v += modsWorth(view, mb, ma);
  if (a.ante < b.ante) v += (b.ante - a.ante) * ANTE_KC;
  if (b.round && a.round && a.phase === 'round') {
    const discards = a.round.discardsLeft - b.round.discardsLeft - (ma.discards - mb.discards);
    if (discards !== 0) v += discards * ROUND_DISCARD_KC;
    const hands = a.round.handsLeft - b.round.handsLeft - (ma.hands - mb.hands);
    if (hands !== 0) v += hands * ROUND_HAND_KC;
    if (b.round.bossId && !b.round.bossDisabled && a.round.bossDisabled) v += BOSS_OFF_KC;
    const deckIds = new Set(a.deck.map((c) => c.id));
    for (const id of b.round.hand) {
      if (!deckIds.has(id)) v -= ROUND_HAND_CARD_KC;
      else if (view.game.card(id)?.debuffed && after.card(id)?.debuffed === false) v += ROUND_CLEANSE_KC;
    }
  }
  if (view.style.buysJokers) v += (jokerSum(view, after) - jokerSum(view, view.game)) * JOKER_KC;
  else if (a.jokers.length > b.jokers.length) v -= JOKER_KC;
  const owned = new Set(b.consumables.map((c) => c.uid));
  for (const c of a.consumables) if (!owned.has(c.uid)) v += consumableWorth(view, c.defId);
  v += (a.consumables.length - b.consumables.length) * view.holdWorth;
  v += feedWorth(view, after);
  v += deckWorth(view, a.deck) - view.deckWorth;
  return { total: v, money };
}

/** Růst stavu škálujících žolíků po akci (viz `FEED_KC`). */
function feedWorth(view: ValueView, after: Game): number {
  let v = 0;
  for (const j of after.state.jokers) {
    const def = view.game.registry.jokers[j.defId];
    if (!def?.tags.includes('scaling') || j.debuffed) continue;
    const prev = view.game.state.jokers.find((x) => x.uid === j.uid);
    if (!prev) continue;
    let grow = 0;
    for (const [k, val] of Object.entries(j.state)) {
      const old = prev.state[k];
      if (typeof val === 'number' && typeof old === 'number' && val > old) grow += val - old;
    }
    v += FEED_KC * Math.min(FEED_MAX, grow);
  }
  return v;
}

// ─────────────────────────── Sondy ───────────────────────────

/** Ruka, na kterou míří spotřebky (ruka kola nebo obálky) — v kopii stavu. */
function targetHand(st: RunState): number[] | null {
  if (st.phase === 'booster' && st.booster) return st.booster.hand;
  if (st.phase === 'round' && st.round) return st.round.hand;
  return null;
}

/** Seed sond jednoho rozhodnutí — nezávislý na pořadí karet v ruce (plán se po přeřazení ruky nezmění). */
export function probeSeed(game: Game, key: string): [number, number, number, number] {
  const s = game.state;
  const hand = [...(targetHand(s as RunState) ?? [])].sort((x, y) => x - y).join(',');
  return cyrb128(`${s.seed}:probe:${key}:${s.nextUid}:${s.money}:${s.phase}:${hand}`);
}

/**
 * Zkusí akci na kopii hry (RNG kopie z `seed`, `order` = karty, které mají stát v ruce vlevo v tomto pořadí).
 * Vrací kopii po akci, nebo null, když ji engine odmítl.
 */
export function probe(
  game: Game,
  action: Action,
  seed: readonly number[],
  snapshot: string,
  order?: readonly number[],
): Game | null {
  const rng: Rng = rngFromState([seed[0]!, seed[1]!, seed[2]!, seed[3]!]);
  const clone = cloneGame(game, rng, snapshot, (st) => {
    const hand = order && order.length > 0 ? targetHand(st) : null;
    if (!hand) return;
    const rest = hand.filter((id) => !order!.includes(id));
    hand.splice(0, hand.length, ...order!, ...rest);
  });
  return clone.dispatch(action).ok ? clone : null;
}

/** Průměrná hodnota akce přes `samples` sond s různými seedy (náhodné efekty). Null = engine ji odmítl. */
export function sampledDelta(
  view: ValueView,
  action: Action,
  key: string,
  samples: number,
  snapshot: string,
): Delta | null {
  let total = 0;
  let money = 0;
  for (let k = 0; k < samples; k++) {
    const clone = probe(view.game, action, probeSeed(view.game, `${key}:${k}`), snapshot);
    if (!clone) return null;
    const d = stateDelta(view, clone);
    total += d.total;
    money += d.money;
  }
  return { total: total / samples, money: money / samples };
}

// ─────────────────────────── Výběr cílů ───────────────────────────

export interface TargetPlan {
  /** Cíle v pořadí, ve kterém mají stát v ruce (první = „levá“ karta). */
  targets: number[];
  value: number;
  /** Záleží na pořadí cílů v ruce (levá/pravá karta, kotva)? */
  ordered: boolean;
}

/** Čisté pole karty, které spotřebky mění (pro rozpoznání „stejné změny“ u všech cílů). */
const CARD_FIELDS = ['enhancement', 'seal', 'edition', 'suit', 'debuffed', 'faceDown'] as const;

interface Template {
  destroy: boolean;
  set: Partial<Card>;
  rankDelta: number;
  bonusDelta: number;
}

/**
 * Šablona změny, pokud všechny cíle změnila sonda stejně (vylepšení, pečeť, edice, barva, hodnota +n, bonusové
 * čipy, zničení) — pak jde efekt spočítat pro každou kartu zvlášť. Null = změna závisí na ostatních cílech.
 */
function templateOf(game: Game, clone: Game, ids: readonly number[]): Template | null {
  const before = ids.map((id) => game.card(id)!);
  const after = ids.map((id) => clone.state.deck.find((c) => c.id === id));
  const destroyed = after.map((c) => !c);
  if (destroyed.every(Boolean)) return { destroy: true, set: {}, rankDelta: 0, bonusDelta: 0 };
  if (destroyed.some(Boolean)) return null;
  const set: Partial<Card> = {};
  for (const f of CARD_FIELDS) {
    const values = after.map((c) => c![f]);
    const changed = before.some((c, i) => c[f] !== values[i]);
    if (!changed) continue;
    if (!values.every((v) => v === values[0])) return null;
    (set as Record<string, unknown>)[f] = values[0];
  }
  const rankDeltas = before.map((c, i) => after[i]!.rank - c.rank);
  const nonAce = rankDeltas.filter((_, i) => before[i]!.rank !== 14);
  const rankDelta = nonAce[0] ?? rankDeltas[0] ?? 0;
  if (!rankDeltas.every((d, i) => d === rankDelta || (before[i]!.rank === 14 && d === 0))) return null;
  const bonus = before.map((c, i) => after[i]!.bonusChips - c.bonusChips);
  if (!bonus.every((d) => d === bonus[0])) return null;
  return { destroy: false, set, rankDelta, bonusDelta: bonus[0] ?? 0 };
}

/** Stejný výsledek na kartách cílů? (Porovnání dvou sond s opačným pořadím cílů.) */
function sameOutcome(a: Game, b: Game, ids: readonly number[]): boolean {
  for (const id of ids) {
    const x = a.state.deck.find((c) => c.id === id);
    const y = b.state.deck.find((c) => c.id === id);
    if (!x || !y) {
      if (x !== y) return false;
      continue;
    }
    if (x.rank !== y.rank || x.bonusChips !== y.bonusChips) return false;
    for (const f of CARD_FIELDS) if (x[f] !== y[f]) return false;
  }
  return a.state.deck.length === b.state.deck.length && a.state.money === b.state.money;
}

/**
 * Nejlepší cíle spotřebky (`make` = akce s cíli: použití, výběr z obálky) v kartách `pool` a jejich hodnota.
 * Efekt se pozná sondami: jedna karta → zkusí každou; přesně dvě → každou uspořádanou dvojici; víc karet →
 * když je změna u všech cílů stejná (vylepšení…), spočítá přínos každé karty zvlášť a vezme ty s kladným
 * přínosem, jinak (barva podle první karty…) zkusí „kotvu“ s nejlepšími dvojicemi. Null = nic nejde.
 */
export function planTargets(
  view: ValueView,
  def: { target?: { min: number; max: number } },
  pool: readonly number[],
  make: (targets: number[]) => Action,
  key: string,
  snapshot: string,
): TargetPlan | null {
  const t = def.target;
  if (!t) return null;
  const game = view.game;
  const ids = [...pool].filter((id) => {
    const c = game.card(id);
    return c && !c.faceDown;
  });
  ids.sort((x, y) => x - y);
  const max = Math.min(t.max, ids.length);
  const min = Math.max(1, t.min);
  if (ids.length < min || max < min) return null;
  const seed = probeSeed(game, key);
  let best: TargetPlan | null = null;
  const tryPlan = (targets: number[], ordered: boolean): TargetPlan | null => {
    const clone = probe(game, make(targets), seed, snapshot, targets);
    if (!clone) return null;
    const plan = { targets, value: stateDelta(view, clone).total, ordered };
    if (!best || plan.value > best.value) best = plan;
    return plan;
  };

  // Jedna karta: zkusit každou.
  if (max === 1) {
    for (const id of ids) tryPlan([id], false);
    return best;
  }
  // Přesně dvě („levá“ a „pravá“): každá uspořádaná dvojice.
  if (min === 2 && max === 2) {
    for (const x of ids) for (const y of ids) if (x !== y) tryPlan([x, y], true);
    return best;
  }

  // Víc karet: sonda s nejcennějšími kartami a s opačným pořadím. Debuffnuté karty jdou do sondy první, aby se
  // ukázal i efekt, který mění jen je (Česnek na krk).
  const worth = new Map(ids.map((id) => [id, cardWorth(view, game.card(id)!)]));
  const debuffed = (id: number): number => (game.card(id)?.debuffed ? 1 : 0);
  const byWorth = [...ids].sort(
    (x, y) => debuffed(y) - debuffed(x) || worth.get(y)! - worth.get(x)! || x - y,
  );
  const s0 = byWorth.slice(0, max);
  const p0 = probe(game, make(s0), seed, snapshot, s0);
  const p1 = p0 ? probe(game, make([...s0].reverse()), seed, snapshot, [...s0].reverse()) : null;
  const tpl = p0 && p1 && sameOutcome(p0, p1, s0) ? templateOf(game, p0, s0) : null;
  if (p0 && tpl) {
    // Stejná změna u každé karty: přínos každé karty zvlášť (+ peníze za kartu).
    const n = Math.max(1, game.state.deck.length);
    const avg = view.deckWorth / 52;
    const perCardMoney = (p0.state.money - game.state.money) / s0.length;
    const inRound = game.state.phase === 'round';
    const gain = ids.map((id) => {
      const c = game.card(id)!;
      const v = worth.get(id)!;
      let g: number;
      if (tpl.destroy) {
        g = ((avg - v) * 52) / Math.max(1, n - 1) - (inRound ? ROUND_HAND_CARD_KC : 0);
      } else {
        const rank = Math.min(14, Math.max(2, c.rank + tpl.rankDelta)) as Rank;
        const next = { ...c, ...tpl.set, rank, bonusChips: c.bonusChips + tpl.bonusDelta };
        g = ((cardWorth(view, next) - v) * 52) / n;
        if (inRound && c.debuffed && tpl.set.debuffed === false) g += ROUND_CLEANSE_KC;
      }
      return { id, g: g + perCardMoney };
    });
    gain.sort((x, y) => y.g - x.g || x.id - y.id);
    const pick = gain.filter((x) => x.g > 0.05).slice(0, max);
    const chosen = (pick.length >= min ? pick : gain.slice(0, min)).map((x) => x.id);
    tryPlan(chosen, false);
    if (!best) tryPlan(s0, false);
    return best;
  }

  // Změna závisí na ostatních cílech: kotva (první karta) + karty s nejlepším přínosem ve dvojici s ní.
  if (min <= 2) {
    const pair = new Map<number, { id: number; v: number }[]>();
    for (const a of ids) {
      const list: { id: number; v: number }[] = [];
      for (const x of ids) {
        if (x === a) continue;
        const plan = tryPlan([a, x], true);
        if (plan) list.push({ id: x, v: plan.value });
      }
      list.sort((p, q) => q.v - p.v || p.id - q.id);
      pair.set(a, list);
    }
    for (const a of ids) {
      const rest = (pair.get(a) ?? []).filter((x) => x.v > 0).slice(0, max - 1);
      if (rest.length + 1 > 2 && rest.length + 1 >= min) tryPlan([a, ...rest.map((x) => x.id)], true);
    }
    if (min === 1) for (const id of ids) tryPlan([id], false);
    return best;
  }
  if (p0) tryPlan(s0, true);
  return best;
}

// ─────────────────────────── Obálky ───────────────────────────

/** Očekávané maximum hodnot `values` z `k` náhodně vybraných (bez opakování). */
export function expectedMaxOfK(values: readonly number[], k: number): number {
  const v = [...values].sort((a, b) => b - a);
  const n = v.length;
  if (n === 0 || k <= 0) return 0;
  if (k >= n) return v[0]!;
  // P(maximum = i-tá nejlepší) = C(n − i, k − 1) / C(n, k) (i od 1).
  let total = 0;
  let pRest = k / n; // i = 1
  for (let i = 1; i <= n - k + 1; i++) {
    total += v[i - 1]! * pRest;
    // C(n − i − 1, k − 1) / C(n − i, k − 1) = (n − i − k + 1) / (n − i)
    pRest *= (n - i - k + 1) / Math.max(1, n - i);
  }
  return total;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
