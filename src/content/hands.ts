/** Základní hodnoty kombinací (vlastní čísla; tabulka v docs/DESIGN.md kap. 2.2.1, laděno simulací). */
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
  high_card: def('high_card', 6, 1, 12, 1),
  pair: def('pair', 12, 2, 14, 1),
  two_pair: def('two_pair', 24, 2, 18, 1),
  three: def('three', 28, 3, 22, 2),
  straight: def('straight', 35, 4, 25, 2),
  flush: def('flush', 40, 4, 18, 2),
  full_house: def('full_house', 45, 5, 28, 2),
  four: def('four', 65, 6, 35, 3),
  straight_flush: def('straight_flush', 90, 9, 40, 3),
  royal_flush: def('royal_flush', 120, 10, 45, 3),
  five: def('five', 110, 11, 40, 3, true),
  flush_house: def('flush_house', 130, 13, 45, 4, true),
  flush_five: def('flush_five', 150, 15, 55, 3, true),
};
