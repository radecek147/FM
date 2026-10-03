/**
 * Základní hodnoty kombinací (vlastní čísla; tabulka v docs/DESIGN.md kap. 2.2.1). Od 1.0.1 „čipová“ tabulka:
 * kombinace dávají víc čipů a méně multu (mult střední třídy Trojice–Barva jen 2–3, velký skok až u Čtveřice) a
 * úrovně přidávají hlavně čipy — mult je hlavně věc žolíků. Pozdní hra dál škáluje úrovněmi (přírůstky z fáze 10
 * přeskládané, síla typických rukou ±10 % proti 1.0; docs/DECISIONS.md 2026-10-03 „Odlišení od Balatra…“).
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
  high_card: def('high_card', 8, 1, 25, 2),
  pair: def('pair', 14, 2, 30, 2),
  two_pair: def('two_pair', 30, 2, 38, 2),
  three: def('three', 36, 2, 48, 3),
  straight: def('straight', 45, 3, 48, 4),
  flush: def('flush', 55, 3, 42, 3),
  full_house: def('full_house', 65, 4, 58, 3),
  four: def('four', 95, 5, 80, 5),
  straight_flush: def('straight_flush', 130, 6, 90, 5),
  royal_flush: def('royal_flush', 170, 7, 100, 5),
  five: def('five', 165, 9, 90, 4, true),
  flush_house: def('flush_house', 190, 10, 100, 6, true),
  flush_five: def('flush_five', 220, 12, 105, 5, true),
};
