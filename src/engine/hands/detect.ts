/**
 * Detekce pokerových kombinací.
 *
 * - Kamenné karty (bez hodnoty a barvy) se do kombinace nepočítají, ale vždy skórují.
 * - Divoké karty patří do všech barev.
 * - Debuffnuté a zakryté karty se do kombinace počítají normálně.
 * - Postupka: A-2-3-4-5 i 10-J-Q-K-A ano; „kolem dokola“ (Q-K-A-2-3) jen s `straightWrap`.
 * - `fourCardStraightFlush`: Postupka i Barva stačí ze 4 karet.
 * - `straightGaps`: mezi sousedními hodnotami Postupky smí chybět jedna hodnota.
 * - Postupka v barvě = v zahrané ruce je zároveň Postupka i Barva (skórují karty obou).
 * - Královská postupka = Postupka v barvě, jejíž postupka obsahuje jen 10–A a končí esem.
 * - `allCardsScore`: skórují všechny zahrané karty.
 */
import type { Card, DetectedHand, HandType, Modifiers, Rank, Suit } from '../types';
import { HAND_TYPES, SUITS } from '../types';
import type { EnhancementLookup } from '../cards/cards';
import { cardHasSuit, hasNoRankSuit, isWild } from '../cards/cards';

export type DetectModifiers = Pick<
  Modifiers,
  'fourCardStraightFlush' | 'straightGaps' | 'straightWrap' | 'mergedSuits' | 'allCardsScore'
>;

export interface DetectOptions {
  mods: DetectModifiers;
  enhancements: EnhancementLookup;
}

const HAND_STRENGTH: Record<HandType, number> = Object.fromEntries(
  HAND_TYPES.map((h, i) => [h, i]),
) as Record<HandType, number>;

/** Kladné, pokud je `a` silnější kombinace než `b`. */
export function compareHandTypes(a: HandType, b: HandType): number {
  return HAND_STRENGTH[a] - HAND_STRENGTH[b];
}

interface StraightInfo {
  ranks: Set<Rank>;
  royal: boolean;
}

/**
 * Najde nejlepší postupku mezi různými hodnotami. Vrací množinu hodnot postupky (nebo null).
 * Hrubou silou přes podmnožiny — karet je málo (typicky ≤ 5, max ~8).
 */
export function findStraight(
  ranksPresent: readonly Rank[],
  need: number,
  gaps: boolean,
  wrap: boolean,
): StraightInfo | null {
  const distinct = [...new Set(ranksPresent)].sort((a, b) => a - b);
  if (distinct.length < need) return null;
  const maxStep = gaps ? 2 : 1;
  let best: { ranks: Rank[]; score: number } | null = null;
  const n = distinct.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: Rank[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(distinct[i]!);
    if (subset.length < need) continue;
    if (!isValidStraight(subset, maxStep, wrap)) continue;
    // Preferuj delší postupku, pak vyšší hodnoty.
    const score = subset.length * 1000 + subset.reduce((s, r) => s + r, 0);
    if (!best || score > best.score) best = { ranks: subset, score };
  }
  if (!best) return null;
  const set = new Set(best.ranks);
  const royal = set.has(14) && best.ranks.every((r) => r >= 10);
  return { ranks: set, royal };
}

function linearOk(positions: number[], maxStep: number): boolean {
  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d < 1 || d > maxStep) return false;
  }
  return true;
}

/** Hodnoty seřazené vzestupně, různé. */
function isValidStraight(ranks: Rank[], maxStep: number, wrap: boolean): boolean {
  // pozice 0..12 (2..A)
  const pos = ranks.map((r) => r - 2);
  if (wrap) {
    // Na kruhu 13 pozic: odstraníme největší mezeru (to je „vnějšek“), zbytek musí být v mezích.
    const sorted = [...pos].sort((a, b) => a - b);
    const gapsList: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 13;
      gapsList.push(next - sorted[i]!);
    }
    const maxIdx = gapsList.indexOf(Math.max(...gapsList));
    return gapsList.every((g, i) => i === maxIdx || (g >= 1 && g <= maxStep));
  }
  if (linearOk(pos, maxStep)) return true;
  // Eso jako jednička (pozice −1).
  if (ranks.includes(14)) {
    const low = pos.map((p) => (p === 12 ? -1 : p));
    if (linearOk(low, maxStep)) return true;
  }
  return false;
}

/** Najde barvu s nejvíce kartami. Vrací karty té barvy (včetně divokých), pokud jich je ≥ need. */
function findFlush(cards: readonly Card[], need: number, opts: DetectOptions): Card[] | null {
  let best: { cards: Card[]; natural: number } | null = null;
  for (const suit of SUITS as readonly Suit[]) {
    const matching = cards.filter((c) => cardHasSuit(c, suit, opts.mods, opts.enhancements));
    if (matching.length < need) continue;
    const natural = matching.filter((c) => !isWild(c, opts.enhancements)).length;
    if (
      !best ||
      matching.length > best.cards.length ||
      (matching.length === best.cards.length && natural > best.natural)
    ) {
      best = { cards: matching, natural };
    }
  }
  return best ? best.cards : null;
}

export function detectHand(played: readonly Card[], opts: DetectOptions): DetectedHand | null {
  if (played.length === 0) return null;
  const enh = opts.enhancements;
  const stones = played.filter((c) => hasNoRankSuit(c, enh));
  const ranked = played.filter((c) => !hasNoRankSuit(c, enh));
  const need = opts.mods.fourCardStraightFlush ? 4 : 5;

  // Skupiny podle hodnoty, seřazené: větší skupina, pak vyšší hodnota.
  const byRank = new Map<Rank, Card[]>();
  for (const c of ranked) {
    const g = byRank.get(c.rank);
    if (g) g.push(c);
    else byRank.set(c.rank, [c]);
  }
  const groups = [...byRank.entries()]
    .map(([rank, cards]) => ({ rank, cards }))
    .sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);

  const g0 = groups[0];
  const g1 = groups[1];
  const fiveGroup = g0 && g0.cards.length >= 5 ? g0 : null;
  const fourGroup = g0 && g0.cards.length >= 4 ? g0 : null;
  const threeGroup = g0 && g0.cards.length >= 3 ? g0 : null;
  const pairGroups = groups.filter((g) => g.cards.length >= 2);
  const fullHouse = threeGroup && g1 && g1.cards.length >= 2 ? [...threeGroup.cards, ...g1.cards] : null;

  const flushCards = ranked.length >= need ? findFlush(ranked, need, opts) : null;
  const straight =
    ranked.length >= need
      ? findStraight(
          ranked.map((c) => c.rank),
          need,
          opts.mods.straightGaps,
          opts.mods.straightWrap,
        )
      : null;
  const straightCards = straight ? ranked.filter((c) => straight.ranks.has(c.rank)) : null;

  const flushSet = new Set(flushCards ?? []);
  const fiveIsFlush =
    fiveGroup !== null && flushCards !== null && fiveGroup.cards.every((c) => flushSet.has(c));
  const fhIsFlush = fullHouse !== null && flushCards !== null && fullHouse.every((c) => flushSet.has(c));

  let type: HandType;
  let core: Card[];
  if (fiveGroup && fiveIsFlush) {
    type = 'flush_five';
    core = union(fiveGroup.cards, flushCards!);
  } else if (fullHouse && fhIsFlush) {
    type = 'flush_house';
    core = union(fullHouse, flushCards!);
  } else if (fiveGroup) {
    type = 'five';
    core = fiveGroup.cards;
  } else if (straight && flushCards && straight.royal) {
    type = 'royal_flush';
    core = union(straightCards!, flushCards);
  } else if (straight && flushCards) {
    type = 'straight_flush';
    core = union(straightCards!, flushCards);
  } else if (fourGroup) {
    type = 'four';
    core = fourGroup.cards;
  } else if (fullHouse) {
    type = 'full_house';
    core = fullHouse;
  } else if (flushCards) {
    type = 'flush';
    core = flushCards;
  } else if (straight) {
    type = 'straight';
    core = straightCards!;
  } else if (threeGroup) {
    type = 'three';
    core = threeGroup.cards;
  } else if (pairGroups.length >= 2) {
    type = 'two_pair';
    core = [...pairGroups[0]!.cards, ...pairGroups[1]!.cards];
  } else if (pairGroups.length === 1) {
    type = 'pair';
    core = pairGroups[0]!.cards;
  } else {
    type = 'high_card';
    core = g0 ? [g0.cards[0]!] : [];
  }

  const contains: HandType[] = [];
  const has: Record<HandType, boolean> = {
    high_card: true,
    pair: pairGroups.length >= 1,
    two_pair: pairGroups.length >= 2,
    three: threeGroup !== null,
    straight: straight !== null,
    flush: flushCards !== null,
    full_house: fullHouse !== null,
    four: fourGroup !== null,
    straight_flush: straight !== null && flushCards !== null,
    royal_flush: straight !== null && flushCards !== null && straight.royal,
    five: fiveGroup !== null,
    flush_house: fhIsFlush,
    flush_five: fiveIsFlush,
  };
  for (const h of HAND_TYPES) if (has[h]) contains.push(h);

  const scoringSet = new Set<number>(
    opts.mods.allCardsScore ? played.map((c) => c.id) : [...core, ...stones].map((c) => c.id),
  );
  const scoringIds = played.filter((c) => scoringSet.has(c.id)).map((c) => c.id);
  return { type, scoringIds, contains };
}

function union(a: readonly Card[], b: readonly Card[]): Card[] {
  const out = [...a];
  for (const c of b) if (!out.includes(c)) out.push(c);
  return out;
}
