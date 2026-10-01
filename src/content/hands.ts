/** Základní hodnoty kombinací (vlastní čísla; laděno simulací — viz docs/DESIGN.md). */
import type { HandType, HandTypeDef } from '../engine/types';

const def = (
  type: HandType,
  baseChips: number,
  baseMult: number,
  chipsPerLevel: number,
  multPerLevel: number,
  secret = false,
): HandTypeDef => ({ type, baseChips, baseMult, chipsPerLevel, multPerLevel, secret });

export const HAND_TYPE_DEFS: Record<HandType, HandTypeDef> = {
  high_card: def('high_card', 5, 1, 10, 1),
  pair: def('pair', 10, 2, 15, 1),
  two_pair: def('two_pair', 20, 2, 20, 1),
  three: def('three', 25, 3, 20, 2),
  straight: def('straight', 35, 4, 25, 2),
  flush: def('flush', 40, 4, 15, 2),
  full_house: def('full_house', 45, 4, 25, 2),
  four: def('four', 60, 6, 30, 3),
  straight_flush: def('straight_flush', 90, 8, 40, 3),
  royal_flush: def('royal_flush', 120, 9, 45, 3),
  five: def('five', 110, 11, 35, 3, true),
  flush_house: def('flush_house', 130, 13, 40, 4, true),
  flush_five: def('flush_five', 150, 15, 50, 3, true),
};
