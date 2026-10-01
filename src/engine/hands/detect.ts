/**
 * Detekce pokerových kombinací (docs/DESIGN.md kap. 2.2.2–2.2.4).
 *
 * Princip: projdou se všechny podmnožiny zahraných karet s hodnotou o 1–5 kartách a u každé se určí,
 * kterými kombinacemi „přesně je“ (všechny její karty jsou součástí kombinace). Vyhodnocená kombinace je
 * nejlepší varianta podle pravidla z DESIGN 2.2.2:
 *   1. nejsilnější typ (pořadí `HAND_TYPES`),
 *   2. více skórujících karet,
 *   3. vyšší součet čipů skórujících karet (`cardChips`; u Vysoké karty rozhoduje hodnota karty),
 *   4. karty zahrané víc vlevo.
 *
 * Pravidla:
 * - Kombinace má nejvýš 5 karet (i při `maxSelect` > 5); ostatní zahrané karty jsou „kopy“ a neskórují.
 * - Kamenné karty (bez hodnoty a barvy) se do kombinace nepočítají, ale vždy skórují.
 * - Divoké karty patří do všech barev; `mergedSuits` slučuje ♥ = ♦ a ♠ = ♣.
 * - Debuffnuté a zakryté karty se do kombinace počítají normálně (detekce tyto příznaky nečte).
 * - Postupka: různé po sobě jdoucí hodnoty; A-2-3-4-5 i 10-J-Q-K-A ano; „kolem dokola“ (Q-K-A-2-3)
 *   jen s `straightWrap`. U duplicitní hodnoty skóruje jen jedna z karet (podle bodu 3 a 4 výše).
 * - `fourCardStraightFlush`: Postupka i Barva stačí ze 4 karet (5 karet má přednost — víc skórujících).
 * - `straightGaps`: mezi sousedními hodnotami Postupky smí chybět nejvýš jedna hodnota.
 * - Postupka v barvě = Postupka, jejíž karty mají všechny jednu barvu (ne „Postupka + Barva z různých karet“).
 * - Královská postupka = Postupka v barvě bez přetočení „kolem dokola“, jejíž nejvyšší karta je vysoké Eso.
 * - `contains` = vyhodnocená kombinace + všechny kombinace, které tvoří některá podmnožina zahraných karet;
 *   Vysoká karta je v `contains` jen tehdy, když je to vyhodnocená kombinace.
 * - `allCardsScore`: skórují všechny zahrané karty.
 */
import type { Card, DetectedHand, HandType, Modifiers, Rank } from '../types';
import { HAND_TYPES, SUITS } from '../types';
import type { EnhancementLookup } from '../cards/cards';
import { cardChips, cardHasSuit, hasNoRankSuit } from '../cards/cards';

export type DetectModifiers = Pick<
  Modifiers,
  'fourCardStraightFlush' | 'straightGaps' | 'straightWrap' | 'mergedSuits' | 'allCardsScore'
>;

export interface DetectOptions {
  mods: DetectModifiers;
  enhancements: EnhancementLookup;
}

/** Největší počet karet (bez kamenných), které tvoří kombinaci. */
export const MAX_HAND_CARDS = 5;

const HAND_STRENGTH: Record<HandType, number> = Object.fromEntries(
  HAND_TYPES.map((h, i) => [h, i]),
) as Record<HandType, number>;

/** Kladné, pokud je `a` silnější kombinace než `b`. */
export function compareHandTypes(a: HandType, b: HandType): number {
  return HAND_STRENGTH[a] - HAND_STRENGTH[b];
}

/** Druh postupky: `aceHigh` = bez přetočení a nejvyšší karta je vysoké Eso (základ Královské). */
export type StraightKind = 'normal' | 'aceHigh';

/** Jsou pozice (seřazené vzestupně, různé) postupkou s kroky 1…maxStep? */
function linearOk(sortedPositions: readonly number[], maxStep: number): boolean {
  for (let i = 1; i < sortedPositions.length; i++) {
    const d = sortedPositions[i]! - sortedPositions[i - 1]!;
    if (d < 1 || d > maxStep) return false;
  }
  return true;
}

/**
 * Tvoří různé hodnoty `ranks` postupku? Nekontroluje počet karet (to dělá volající).
 * Vrací druh postupky, nebo null.
 */
export function straightKind(ranks: readonly Rank[], gaps: boolean, wrap: boolean): StraightKind | null {
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) return null;
  const maxStep = gaps ? 2 : 1;
  // Pozice 0..12 = hodnoty 2..A.
  const pos = sorted.map((r) => r - 2);
  if (linearOk(pos, maxStep)) return sorted.includes(14) ? 'aceHigh' : 'normal';
  if (sorted.includes(14)) {
    // Eso jako jednička (pozice −1) — jen A-2-3-4-5 a podobné; Eso pak není nejvyšší karta.
    const low = [-1, ...pos.filter((p) => p !== 12)];
    if (linearOk(low, maxStep)) return 'normal';
  }
  if (wrap && pos.length > 1) {
    // Kruh 13 pozic: největší mezera je „vnějšek“ postupky, ostatní musí být v mezích.
    const circular = pos.map((p, i) => (i + 1 < pos.length ? pos[i + 1]! : pos[0]! + 13) - p);
    const outer = circular.indexOf(Math.max(...circular));
    if (circular.every((g, i) => i === outer || g <= maxStep)) return 'normal';
  }
  return null;
}

/** Bitmaska barev, do kterých karta patří (bit i = `SUITS[i]`): divoká do všech, kamenná do žádné. */
function suitMask(card: Card, opts: DetectOptions): number {
  let mask = 0;
  SUITS.forEach((suit, i) => {
    if (cardHasSuit(card, suit, opts.mods, opts.enhancements)) mask |= 1 << i;
  });
  return mask;
}

const ALL_SUITS = (1 << SUITS.length) - 1;

/** Bit kombinace v masce (bit i = `HAND_TYPES[i]`). */
const BIT = Object.fromEntries(HAND_TYPES.map((h, i) => [h, 1 << i])) as Record<HandType, number>;

const typesOf = (mask: number): HandType[] => HAND_TYPES.filter((h) => (mask & BIT[h]) !== 0);

/** Index nejsilnější kombinace v masce (nejvyšší nastavený bit). */
const strongest = (mask: number): number => 31 - Math.clz32(mask);

/** Velikost dvou největších skupin karet stejné hodnoty (karet je nejvýš 5). */
function topGroups(ranks: readonly Rank[]): [number, number] {
  let top = 0;
  let second = 0;
  for (let i = 0; i < ranks.length; i++) {
    if (ranks.indexOf(ranks[i]!) !== i) continue; // hodnota už započítaná
    let n = 0;
    for (let j = i; j < ranks.length; j++) if (ranks[j] === ranks[i]) n++;
    if (n > top) [top, second] = [n, top];
    else if (n > second) second = n;
  }
  return [top, second];
}

/**
 * Maska kombinací, kterými podmnožina karet přesně je (každá její karta je součástí kombinace).
 * `suitAnd` = průnik masek barev všech karet podmnožiny.
 */
function typeMask(ranks: readonly Rank[], suitAnd: number, opts: DetectOptions): number {
  const k = ranks.length;
  const need = opts.mods.fourCardStraightFlush ? 4 : 5;
  const [top, second] = topGroups(ranks);
  const flush = k >= need && suitAnd !== 0;
  const straight =
    k >= need && top === 1 ? straightKind(ranks, opts.mods.straightGaps, opts.mods.straightWrap) : null;
  const fullHouse = k === 5 && top === 3 && second === 2;
  const five = k === 5 && top === 5;

  let mask = 0;
  if (k === 1) mask |= BIT.high_card;
  if (k === 2 && top === 2) mask |= BIT.pair;
  if (k === 4 && top === 2 && second === 2) mask |= BIT.two_pair;
  if (k === 3 && top === 3) mask |= BIT.three;
  if (straight) mask |= BIT.straight;
  if (flush) mask |= BIT.flush;
  if (fullHouse) mask |= BIT.full_house;
  if (k === 4 && top === 4) mask |= BIT.four;
  if (straight && flush) mask |= BIT.straight_flush;
  if (straight === 'aceHigh' && flush) mask |= BIT.royal_flush;
  if (five) mask |= BIT.five;
  if (fullHouse && flush) mask |= BIT.flush_house;
  if (five && flush) mask |= BIT.flush_five;
  return mask;
}

/**
 * Všechny kombinace, kterými podmnožina karet s hodnotou přesně je (každá její karta je součástí
 * kombinace), seřazené podle síly. Např. 10-J-Q-K-A v jedné barvě → Postupka, Barva, Postupka v barvě,
 * Královská; 9-9-K → nic (K do Dvojice nepatří).
 */
export function exactHandTypes(cards: readonly Card[], opts: DetectOptions): HandType[] {
  if (cards.length === 0 || cards.length > MAX_HAND_CARDS) return [];
  // Kamenná karta nemá hodnotu ani barvu — podmnožina s ní „přesně není“ žádnou kombinací (DESIGN 2.2.2).
  if (cards.some((c) => hasNoRankSuit(c, opts.enhancements))) return [];
  const suitAnd = cards.reduce((m, c) => m & suitMask(c, opts), ALL_SUITS);
  return typesOf(
    typeMask(
      cards.map((c) => c.rank),
      suitAnd,
      opts,
    ),
  );
}

export function detectHand(played: readonly Card[], opts: DetectOptions): DetectedHand | null {
  if (played.length === 0) return null;
  const enh = opts.enhancements;
  const ranked = played.filter((c) => !hasNoRankSuit(c, enh));
  const n = ranked.length;
  const ranks = ranked.map((c) => c.rank);
  const suits = ranked.map((c) => suitMask(c, opts));
  const chips = ranked.map((c) => cardChips(c, enh));

  // Průchod všemi podmnožinami o 1–5 kartách (indexy vzestupně = pořadí zahrání).
  const idx: number[] = [];
  const subRanks: Rank[] = [];
  let found = 0;
  let bestType = -1;
  let bestValue = 0;
  let bestIdx: number[] = [];

  /** Je aktuální podmnožina lepší varianta než dosud nejlepší (DESIGN 2.2.2 „Výběr mezi variantami“)? */
  const better = (type: number, value: number): boolean => {
    if (type !== bestType) return type > bestType;
    if (idx.length !== bestIdx.length) return idx.length > bestIdx.length;
    if (value !== bestValue) return value > bestValue;
    // Víc vlevo = lexikograficky menší posloupnost indexů.
    for (let i = 0; i < idx.length; i++) if (idx[i] !== bestIdx[i]) return idx[i]! < bestIdx[i]!;
    return false;
  };

  const visit = (start: number, suitAnd: number, chipSum: number): void => {
    for (let i = start; i < n; i++) {
      idx.push(i);
      subRanks.push(ranks[i]!);
      const and = suitAnd & suits[i]!;
      const sum = chipSum + chips[i]!;
      const mask = typeMask(subRanks, and, opts);
      if (mask !== 0) {
        found |= mask;
        // Slabší typy téže podmnožiny by nikdy nevyhrály — stačí nejsilnější.
        const type = strongest(mask);
        // Bod 3: součet čipů; u Vysoké karty (1 karta) rozhoduje hodnota.
        const value = HAND_TYPES[type] === 'high_card' ? ranks[i]! : sum;
        if (better(type, value)) {
          bestType = type;
          bestValue = value;
          bestIdx = [...idx];
        }
      }
      if (idx.length < MAX_HAND_CARDS) visit(i + 1, and, sum);
      idx.pop();
      subRanks.pop();
    }
  };
  visit(0, ALL_SUITS, 0);

  // Jen kamenné karty → Vysoká karta, skórují jen kamenné.
  const type: HandType = bestType >= 0 ? HAND_TYPES[bestType]! : 'high_card';
  found |= BIT[type];
  if (type !== 'high_card') found &= ~BIT.high_card;
  const contains = typesOf(found);

  const core = new Set<Card>(bestIdx.map((i) => ranked[i]!));
  const scoringIds = played
    .filter((c) => opts.mods.allCardsScore || core.has(c) || hasNoRankSuit(c, enh))
    .map((c) => c.id);
  return { type, scoringIds, contains };
}
