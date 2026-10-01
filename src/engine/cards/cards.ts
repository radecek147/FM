/** Hrací karty: tvorba, čipy, barvy, figury. */
import type { CardSpec, EnhancementDef } from '../content-types';
import type { Card, Modifiers, Rank, Suit } from '../types';
import { RANKS, SUITS } from '../types';

export type EnhancementLookup = Readonly<Record<string, Pick<EnhancementDef, 'noRankSuit' | 'allSuits'>>>;

export function createCard(id: number, spec: CardSpec): Card {
  return {
    id,
    suit: spec.suit,
    rank: spec.rank,
    enhancement: spec.enhancement ?? null,
    seal: spec.seal ?? null,
    edition: spec.edition ?? null,
    bonusChips: spec.bonusChips ?? 0,
    debuffed: false,
    faceDown: false,
  };
}

/** Standardní balíček 52 karet (♠ ♥ ♦ ♣ × 2–A). */
export function standardDeckSpecs(): CardSpec[] {
  const out: CardSpec[] = [];
  for (const suit of SUITS) for (const rank of RANKS) out.push({ suit, rank });
  return out;
}

/** Základní čipy podle hodnoty: 2–10 = číslo, J/Q/K = 10, A = 11. */
export function rankChips(rank: Rank): number {
  if (rank === 14) return 11;
  if (rank >= 11) return 10;
  return rank;
}

/** Nemá karta hodnotu ani barvu (kamenná)? */
export function hasNoRankSuit(card: Card, enh: EnhancementLookup): boolean {
  return card.enhancement !== null && enh[card.enhancement]?.noRankSuit === true;
}

/** Patří karta do všech barev (divoká)? */
export function isWild(card: Card, enh: EnhancementLookup): boolean {
  return card.enhancement !== null && enh[card.enhancement]?.allSuits === true;
}

/** Základní čipy karty bez efektů vylepšení: kamenná 0, jinak podle hodnoty + bonusChips. */
export function cardChips(card: Card, enh: EnhancementLookup): number {
  return (hasNoRankSuit(card, enh) ? 0 : rankChips(card.rank)) + card.bonusChips;
}

/** Sjednocení barev při `mergedSuits`: ♥ = ♦, ♠ = ♣. */
export function suitGroup(suit: Suit, mods: Pick<Modifiers, 'mergedSuits'>): Suit {
  if (!mods.mergedSuits) return suit;
  if (suit === 'D') return 'H';
  if (suit === 'C') return 'S';
  return suit;
}

/** Má karta danou barvu? Divoká = všechny, kamenná = žádná. */
export function cardHasSuit(
  card: Card,
  suit: Suit,
  mods: Pick<Modifiers, 'mergedSuits'>,
  enh: EnhancementLookup,
): boolean {
  if (hasNoRankSuit(card, enh)) return false;
  if (isWild(card, enh)) return true;
  return suitGroup(card.suit, mods) === suitGroup(suit, mods);
}

/** Je karta figura (J/Q/K)? Při `allFaces` jsou figury všechny karty s hodnotou. */
export function isFaceCard(card: Card, mods: Pick<Modifiers, 'allFaces'>, enh: EnhancementLookup): boolean {
  if (hasNoRankSuit(card, enh)) return false;
  if (mods.allFaces) return true;
  return card.rank >= 11 && card.rank <= 13;
}

/** Řazení ruky: podle hodnoty (sestupně, pak barva) nebo podle barvy (pak hodnota sestupně). */
const SUIT_ORDER: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
export function compareCards(a: Card, b: Card, by: 'rank' | 'suit', enh: EnhancementLookup): number {
  const aStone = hasNoRankSuit(a, enh);
  const bStone = hasNoRankSuit(b, enh);
  if (aStone !== bStone) return aStone ? 1 : -1;
  if (by === 'rank') {
    return b.rank - a.rank || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.id - b.id;
  }
  return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || b.rank - a.rank || a.id - b.id;
}

export const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};
