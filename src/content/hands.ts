/**
 * Základní hodnoty kombinací (vlastní čísla; tabulka v docs/DESIGN.md kap. 2.2.1, laděno simulací). Přírůstky
 * za úroveň jsou od fáze 10 dvojnásobné (pozdní hra škáluje hlavně úrovněmi — patro 8 se základem 100 000,
 * docs/DECISIONS.md „Fáze 10: silnější boti, úrovně ×2 a cíle patra 8“).
 */
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
  high_card: def('high_card', 6, 1, 24, 2),
  pair: def('pair', 12, 2, 28, 2),
  two_pair: def('two_pair', 24, 2, 36, 2),
  three: def('three', 28, 3, 44, 4),
  straight: def('straight', 35, 4, 50, 4),
  flush: def('flush', 40, 4, 36, 4),
  full_house: def('full_house', 45, 5, 56, 4),
  four: def('four', 65, 6, 70, 6),
  straight_flush: def('straight_flush', 90, 9, 80, 6),
  royal_flush: def('royal_flush', 120, 10, 90, 6),
  five: def('five', 110, 11, 80, 6, true),
  flush_house: def('flush_house', 130, 13, 90, 8, true),
  flush_five: def('flush_five', 150, 15, 110, 6, true),
};
