/**
 * Odhad hodnoty rukou pro boty (docs/DESIGN.md kap. 12.2).
 *
 * - `cardValue`: co karta přidá, když skóruje (čipy, vylepšení, edice, opakování pečetí) — bez žolíků.
 * - `analyzeCards`: rychlé hledání nejlepší sady karet pro každou kombinaci v libovolné hromádce karet (místo
 *   procházení všech 218 podmnožin ruky staví kandidáty přímo podle hodnot, barev a postupek). Slouží jako
 *   kandidáti tahu i jako hodnotící funkce Monte Carlo zahazování.
 * - `planCandidates`: kandidátní tahy ověřené náhledem enginu (`Game.preview` — detekce, úroveň, šéf).
 * - `exactPlayScore`: přesné skóre tahu včetně žolíků na kopii hry s přeseedovaným RNG (bot nesmí znát
 *   budoucí hody — dostane jen vzorek rozdělení).
 *
 * Vše jsou čisté funkce nad veřejným stavem: složení dobíracího balíčku bot zná (UI ho ukazuje), pořadí ne.
 */
import { cardChips, cardHasSuit, hasNoRankSuit } from '../cards/cards';
import type { ContentRegistry, Rng } from '../content-types';
import { straightKind } from '../hands/detect';
import { handValueAtLevel } from '../hands/levels';
import { Game } from '../run/game';
import type { Card, HandType, Modifiers, Rank, RngStreamName, RunState } from '../types';
import { HAND_TYPES, SUITS } from '../types';

/** Příspěvek karty ke skóre (už vynásobený počtem aktivací) a údaje pro detekci. */
export interface CardValue {
  readonly card: Readonly<Card>;
  readonly id: number;
  readonly rank: Rank;
  readonly stone: boolean;
  readonly faceDown: boolean;
  readonly debuffed: boolean;
  /** Bitmaska barev (bit i = `SUITS[i]`; divoká všechny, kamenná žádná, `mergedSuits` sloučené). */
  readonly suitMask: number;
  readonly chips: number;
  readonly mult: number;
  readonly xmult: number;
  /** ×mult, když karta zůstane v ruce (ocelová). */
  readonly heldXmult: number;
  /** Hrubá „cena“ karty pro výběr mezi kartami stejné hodnoty (víc = radši skórovat/držet). */
  readonly worth: number;
}

/** Prostředí hodnocení: pravidla runu, úrovně kombinací a preference bota. */
export interface EvalEnv {
  readonly registry: ContentRegistry;
  readonly mods: Readonly<Modifiers>;
  readonly enhancements: ContentRegistry['enhancements'];
  /** Základní čipy a mult každé kombinace na aktuální úrovni. */
  readonly base: Readonly<Record<HandType, { chips: number; mult: number }>>;
  /** Násobek hodnoty kombinace podle stylu bota (Barva u `flush`…); jen pro výběr, ne pro odhad skóre. */
  readonly pref: Readonly<Partial<Record<HandType, number>>>;
  readonly maxCards: number;
}

const NO_ENHANCEMENTS: ContentRegistry['enhancements'] = Object.freeze({});

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function makeEnv(game: Game, pref: Partial<Record<HandType, number>> = {}): EvalEnv {
  const mods = game.modifiers();
  const registry = game.registry;
  const base = {} as Record<HandType, { chips: number; mult: number }>;
  for (const type of HAND_TYPES) {
    const def = registry.handTypes[type];
    base[type] = def ? handValueAtLevel(def, game.state.handLevels[type]?.level ?? 1) : { chips: 0, mult: 1 };
  }
  return {
    registry,
    mods,
    enhancements: mods.disableEnhancements ? NO_ENHANCEMENTS : registry.enhancements,
    base,
    pref,
    maxCards: Math.max(1, mods.maxSelect),
  };
}

/** Co karta přidá, když skóruje — z `params` vylepšení (čipy, mult, šance „1 z N“, ×mult), edice a pečetě. */
export function cardValue(card: Readonly<Card>, env: EvalEnv): CardValue {
  const enh = env.enhancements;
  const stone = hasNoRankSuit(card, enh);
  let suitMask = 0;
  SUITS.forEach((suit, i) => {
    if (cardHasSuit(card, suit, env.mods, enh)) suitMask |= 1 << i;
  });
  let chips = 0;
  let mult = 0;
  let xmult = 1;
  let heldXmult = 1;
  if (!card.debuffed) {
    chips = cardChips(card, enh, env.mods);
    const def = card.enhancement ? enh[card.enhancement] : undefined;
    if (def) {
      const p = def.params ?? {};
      if (def.onScored) {
        chips += num(p.chips);
        const odds = num(p.multOdds);
        const chance = num(p.multChance) || 1;
        mult +=
          odds > 0 ? num(p.mult) * Math.min(1, (chance * env.mods.probabilityMult) / odds) : num(p.mult);
        if (num(p.xmult) > 0) xmult *= num(p.xmult);
      }
      if (def.onHeld && num(p.xmult) > 0) heldXmult = num(p.xmult);
    }
    const ed = card.edition ? env.registry.editions[card.edition]?.effect?.() : undefined;
    if (ed) {
      chips += num(ed.chips);
      mult += num(ed.mult);
      if (num(ed.xmult) > 0) xmult *= num(ed.xmult);
    }
    const seal = card.seal ? env.registry.seals[card.seal] : undefined;
    const activations = 1 + Math.max(0, Math.floor(num(seal?.retriggers)));
    chips *= activations;
    mult *= activations;
    xmult **= activations;
    heldXmult **= activations;
  }
  return {
    card,
    id: card.id,
    rank: card.rank,
    stone,
    faceDown: card.faceDown,
    debuffed: card.debuffed,
    suitMask,
    chips,
    mult,
    xmult,
    heldXmult,
    worth: chips + 8 * mult + 40 * (xmult - 1) + 20 * (heldXmult - 1),
  };
}

/** Odhad skóre kombinace se skórujícími kartami (pořadí efektů zjednodušeně: součty, pak ×mult). */
export function playValue(
  base: { chips: number; mult: number },
  scoring: readonly CardValue[],
  heldXmult = 1,
): number {
  let chips = base.chips;
  let mult = base.mult;
  let x = heldXmult;
  for (const c of scoring) {
    chips += c.chips;
    mult += c.mult;
    x *= c.xmult;
  }
  return chips * mult * x;
}

/** Kandidát kombinace z rychlé analýzy. */
export interface HandCandidate {
  type: HandType;
  /** Karty kombinace (+ kamenné, pokud se vejdou do `maxCards`). */
  cards: CardValue[];
  /** Odhad skóre bez preferencí bota. */
  raw: number;
  /** Odhad skóre × preference bota. */
  value: number;
}

const byWorth = (a: CardValue, b: CardValue): number => b.worth - a.worth || a.id - b.id;

/** Nejlepší karta každé hodnoty v hromádce. */
function bestPerRank(cards: readonly CardValue[]): Map<number, CardValue> {
  const out = new Map<number, CardValue>();
  for (const c of cards) {
    const cur = out.get(c.rank);
    if (!cur || byWorth(c, cur) < 0) out.set(c.rank, c);
  }
  return out;
}

/** Všechny k-prvkové kombinace prvků pole (malá pole — hodnoty v ruce). */
function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (start: number): void => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i <= items.length - (k - cur.length); i++) {
      cur.push(items[i]!);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/**
 * Postupky v hromádce karet: sady karet (jedna na hodnotu) a příznak „nejvyšší je vysoké Eso bez přetočení“
 * (základ Královské). Bez `straightGaps`/`straightWrap` rychle přes okna hodnot, jinak přes `straightKind` enginu.
 */
function findStraights(
  cards: readonly CardValue[],
  mods: Readonly<Modifiers>,
): { cards: CardValue[]; aceHigh: boolean }[] {
  const best = bestPerRank(cards);
  const lengths = mods.fourCardStraightFlush ? [5, 4] : [5];
  const out: { cards: CardValue[]; aceHigh: boolean }[] = [];
  if (best.size < lengths[lengths.length - 1]!) return out;
  if (!mods.straightGaps && !mods.straightWrap) {
    for (const len of lengths) {
      for (let top = 14; top >= len; top--) {
        const window: CardValue[] = [];
        for (let r = top - len + 1; r <= top; r++) {
          const c = best.get(r === 1 ? 14 : r);
          if (!c) break;
          window.push(c);
        }
        if (window.length === len) out.push({ cards: window, aceHigh: top === 14 });
      }
      if (out.length > 0) break;
    }
    return out;
  }
  const ranks = [...best.keys()].sort((a, b) => a - b) as Rank[];
  for (const len of lengths) {
    for (const combo of combinations(ranks, len)) {
      const kind = straightKind(combo, mods.straightGaps, mods.straightWrap);
      if (kind) out.push({ cards: combo.map((r) => best.get(r)!), aceHigh: kind === 'aceHigh' });
    }
    if (out.length > 0) break;
  }
  return out;
}

/**
 * Nejlepší sady karet pro každou dosažitelnou kombinaci (typ může být víckrát — např. několik postupek).
 * Karty lícem dolů se nepočítají (bot je nevidí); kamenné karty se přidají, pokud se vejdou.
 */
export function analyzeCards(cards: readonly CardValue[], env: EvalEnv): HandCandidate[] {
  const visible = cards.filter((c) => !c.faceDown);
  const ranked = visible.filter((c) => !c.stone);
  const stones = visible.filter((c) => c.stone).sort(byWorth);
  const out: HandCandidate[] = [];
  const add = (type: HandType, core: readonly CardValue[]): void => {
    // Víc karet, než smí hráč vybrat (šéf/žolík snížil `maxSelect`), zahrát nejde.
    if (core.length > env.maxCards) return;
    const set =
      core.length < env.maxCards ? [...core, ...stones.slice(0, env.maxCards - core.length)] : [...core];
    let held = 1;
    for (const c of visible) if (c.heldXmult !== 1 && !set.includes(c)) held *= c.heldXmult;
    const raw = playValue(env.base[type], set, held);
    out.push({ type, cards: set, raw, value: raw * (env.pref[type] ?? 1) });
  };
  if (ranked.length === 0) {
    if (stones.length > 0) add('high_card', []);
    return out;
  }

  // Vysoká karta: hraje se jediná karta, skóruje celá.
  let high: CardValue | null = null;
  let highValue = -1;
  for (const c of ranked) {
    const v = playValue(env.base.high_card, [c]);
    if (v > highValue || (v === highValue && high && c.rank > high.rank)) {
      high = c;
      highValue = v;
    }
  }
  if (high) add('high_card', [high]);

  // Skupiny stejné hodnoty: Dvojice … Pětice, Dvě dvojice, Full house.
  const groups = new Map<number, CardValue[]>();
  for (const c of ranked) {
    const g = groups.get(c.rank);
    if (g) g.push(c);
    else groups.set(c.rank, [c]);
  }
  const ranksDesc = [...groups.keys()].sort((a, b) => b - a);
  for (const g of groups.values()) g.sort(byWorth);
  const ofKind: Record<number, HandType> = { 2: 'pair', 3: 'three', 4: 'four', 5: 'five' };
  for (const r of ranksDesc) {
    const g = groups.get(r)!;
    for (let n = 2; n <= Math.min(5, g.length); n++) add(ofKind[n]!, g.slice(0, n));
  }
  const pairs = ranksDesc.filter((r) => groups.get(r)!.length >= 2);
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++)
      add('two_pair', [...groups.get(pairs[i]!)!.slice(0, 2), ...groups.get(pairs[j]!)!.slice(0, 2)]);
  for (const r3 of ranksDesc.filter((r) => groups.get(r)!.length >= 3))
    for (const r2 of pairs)
      if (r2 !== r3) add('full_house', [...groups.get(r3)!.slice(0, 3), ...groups.get(r2)!.slice(0, 2)]);

  // Postupky (z nejlepších karet každé hodnoty).
  for (const st of findStraights(ranked, env.mods)) add('straight', st.cards);

  // Barvy: Barva, Postupka v barvě / Královská, Barevný full house, Barevná pětice.
  const need = env.mods.fourCardStraightFlush ? 4 : 5;
  for (let bit = 0; bit < SUITS.length; bit++) {
    const suited = ranked.filter((c) => (c.suitMask & (1 << bit)) !== 0).sort(byWorth);
    if (suited.length < need) continue;
    add('flush', suited.slice(0, Math.max(need, Math.min(5, env.maxCards))));
    for (const st of findStraights(suited, env.mods))
      add(st.aceHigh ? 'royal_flush' : 'straight_flush', st.cards);
    if (suited.length >= 5) {
      const sg = new Map<number, CardValue[]>();
      for (const c of suited) {
        const g = sg.get(c.rank);
        if (g) g.push(c);
        else sg.set(c.rank, [c]);
      }
      const big = [...sg.values()].sort((a, b) => b.length - a.length || b[0]!.rank - a[0]!.rank);
      if (big[0] && big[0].length >= 5) add('flush_five', big[0].slice(0, 5));
      const trip = big.find((g) => g.length >= 3);
      const pair = trip ? big.find((g) => g !== trip && g.length >= 2) : undefined;
      if (trip && pair) add('flush_house', [...trip.slice(0, 3), ...pair.slice(0, 2)]);
    }
  }
  return out;
}

/**
 * Užitek nejlepší kombinace v hromádce karet: odhad skóre oříznutý na `cap` (body nad zbývající cíl kola nic
 * nepřinesou — u poslední ruky tak rozhoduje šance na výhru, ne průměr) × preference bota. 0 pro prázdnou.
 */
export function bestUtility(cards: readonly CardValue[], env: EvalEnv, cap = Infinity): number {
  let best = 0;
  for (const c of analyzeCards(cards, env)) {
    const u = Math.min(c.raw, cap) * (env.pref[c.type] ?? 1);
    if (u > best) best = u;
  }
  return best;
}

// ─────────────────────────── Kandidátní tahy ───────────────────────────

/** Tah ověřený náhledem enginu. */
export interface PlayCandidate {
  ids: number[];
  type: HandType | null;
  /** Odhad skóre (bez preferencí). */
  raw: number;
  /** Odhad × preference bota (podle toho se vybírá). */
  value: number;
}

/**
 * Odhad skóre konkrétního výběru karet: základ z náhledu enginu (detekce, úroveň, `modifyBase` šéfa)
 * + příspěvky skórujících karet + ocelové karty, které zůstanou v ruce. Žolíky nezná.
 */
export function estimatePlay(
  game: Game,
  ids: readonly number[],
  hand: ReadonlyMap<number, CardValue>,
  env: EvalEnv,
): PlayCandidate | null {
  const p = game.preview(ids);
  if (p.hidden || !p.hand) return null;
  const scoring: CardValue[] = [];
  for (const id of p.hand.scoringIds) {
    const c = hand.get(id);
    if (c) scoring.push(c);
  }
  let held = 1;
  for (const c of hand.values()) if (c.heldXmult !== 1 && !ids.includes(c.id)) held *= c.heldXmult;
  const raw = playValue({ chips: p.chips, mult: p.mult }, scoring, held);
  return { ids: [...ids], type: p.hand.type, raw, value: raw * (env.pref[p.hand.type] ?? 1) };
}

/**
 * Kandidátní tahy z ruky: nejlepší sady karet z `analyzeCards` (každá i „doplněná“ o karty z `filler` — karty,
 * kterých se bot chce zbavit; zahráním se protočí balíček), ověřené náhledem. Seřazeno od nejlepšího.
 */
export function planCandidates(
  game: Game,
  hand: readonly CardValue[],
  env: EvalEnv,
  filler: readonly CardValue[],
  limit = 8,
): PlayCandidate[] {
  const byId = new Map(hand.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: PlayCandidate[] = [];
  const consider = (ids: number[]): void => {
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const est = estimatePlay(game, ids, byId, env);
    if (est) out.push(est);
  };
  const cands = analyzeCards(hand, env)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  for (const cand of cands) {
    const ids = cand.cards.map((c) => c.id);
    if (ids.length === 0) continue;
    consider(ids);
    const room = env.maxCards - ids.length;
    if (room > 0) {
      const pad = filler.filter((c) => !ids.includes(c.id)).slice(0, room);
      if (pad.length > 0) consider([...ids, ...pad.map((c) => c.id)]);
    }
  }
  // Při shodě delší tah: doplněné karty jsou „na vyhození“ a zahráním se protočí balíček.
  out.sort((a, b) => b.value - a.value || b.ids.length - a.ids.length);
  return out;
}

// ─────────────────────────── Přesné skóre (žolíci, šéfové) ───────────────────────────

const RNG_STREAM_NAMES: readonly RngStreamName[] = [
  'deck',
  'shop',
  'booster',
  'boss',
  'tag',
  'joker',
  'card',
  'consumable',
  'misc',
];

/**
 * Kopie hry s RNG přeseedovaným z náhody bota (bot nesmí znát skutečné budoucí hody). `snapshot` = už
 * serializovaný `JSON.stringify(game.state)` (víc kopií téhož stavu se pak serializuje jen jednou); `mutate`
 * smí kopii stavu před vytvořením hry upravit (otázka „co kdyby“, např. po zahození).
 */
export function cloneGame(game: Game, rng: Rng, snapshot?: string, mutate?: (state: RunState) => void): Game {
  const state = JSON.parse(snapshot ?? JSON.stringify(game.state)) as RunState;
  mutate?.(state);
  for (const name of RNG_STREAM_NAMES) {
    state.rng[name] = [
      (Math.floor(rng.next() * 4294967296) | 1) >>> 0,
      Math.floor(rng.next() * 4294967296) >>> 0,
      Math.floor(rng.next() * 4294967296) >>> 0,
      Math.floor(rng.next() * 4294967296) >>> 0,
    ];
  }
  return Game.fromState(state, game.registry);
}

/**
 * Skóre tahu se vším všudy (žolíci, šéfova pravidla, `validateHand`) — zahraje ho na kopii hry. Vrací −1,
 * když engine tah odmítne.
 */
export function exactPlayScore(
  game: Game,
  ids: readonly number[],
  rng: Rng,
  snapshot?: string,
  mutate?: (state: RunState) => void,
): number {
  const res = cloneGame(game, rng, snapshot, mutate).dispatch({ type: 'play', cardIds: [...ids] });
  if (!res.ok) return -1;
  for (const e of res.events) if (e.type === 'handPlayed') return e.result.score;
  return 0;
}
