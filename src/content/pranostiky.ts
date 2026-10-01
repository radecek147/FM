/**
 * Pranostiky (zvyšují úroveň kombinací) — docs/DESIGN.md kap. 5.2. Texty v src/i18n/cs/pranostiky.ts
 * (`consumables.<id>.name|desc|flavor`). Návod: docs/CONTENT-GUIDE.md.
 *
 * Každá kombinace má právě jednu pranostiku. Pranostiky tajných kombinací (Pětice, Barevný full house,
 * Barevná pětice) engine nenabízí v obchodě ani v obálkách, dokud hráč kombinaci v runu neobjeví
 * (`consumableAllowed` v src/engine/shop/pool.ts podle `HandTypeDef.secret` a `RunState.discoveredHands`).
 */
import type { ArtSpec, ConsumableDef } from '../engine/content-types';
import type { HandType } from '../engine/types';
import { HAND_TYPE_DEFS } from './hands';

/** Cena pranostiky ve Večerce (DESIGN 5.2). */
export const PRANOSTIKA_COST = 3;
/** O kolik úrovní pranostika kombinaci zvedne. */
export const PRANOSTIKA_LEVELS = 1;

/**
 * Pranostika pro kombinaci `hand`. Popisek ukazuje přírůstek za úroveň přímo z tabulky kombinací
 * (`chipsPerLevel`, `multPerLevel`), takže čísla v textu a v mechanice jsou vždy stejná.
 */
function pranostika(id: string, hand: HandType, art: ArtSpec): ConsumableDef {
  const ht = HAND_TYPE_DEFS[hand];
  return {
    id,
    kind: 'pranostika',
    cost: PRANOSTIKA_COST,
    hand,
    params: { levels: PRANOSTIKA_LEVELS, chips: ht.chipsPerLevel, mult: ht.multPerLevel },
    use: (ctx) => ctx.api.levelUpHand(hand, PRANOSTIKA_LEVELS),
    art,
  };
}

export const PRANOSTIKY: ConsumableDef[] = [
  // 1 — Vysoká karta
  pranostika('hen_step', 'high_card', {
    icon: 'chicken',
    bg: '#5b6b7a',
    fg: '#f4f1e8',
    accent: '#e0b84a',
    pattern: 'dots',
  }),
  // 2 — Dvojice
  pranostika('philip_jacob', 'pair', {
    icon: 'witch-face',
    bg: '#3a2a4a',
    fg: '#f6e7c8',
    accent: '#e8742c',
    pattern: 'rays',
    prop: 'fire',
  }),
  // 3 — Dvě dvojice
  pranostika('snakes_scorpions', 'two_pair', {
    icon: 'dragon-head',
    bg: '#2f5a3a',
    fg: '#eaf6dc',
    accent: '#c8d86a',
    pattern: 'zigzag',
  }),
  // 4 — Trojice
  pranostika('three_kings', 'three', {
    icon: 'crown',
    bg: '#2b3f73',
    fg: '#fff3c4',
    accent: '#f2c94c',
    pattern: 'stripes',
  }),
  // 5 — Postupka
  pranostika('saint_anne', 'straight', {
    icon: 'sunflower',
    bg: '#6a5a2a',
    fg: '#fff6d6',
    accent: '#9ec5e8',
    pattern: 'waves',
  }),
  // 6 — Barva
  pranostika('medard_drop', 'flush', {
    icon: 'raining',
    bg: '#2a4a6a',
    fg: '#e4f1ff',
    accent: '#7fb3e6',
    pattern: 'waves',
    prop: 'umbrella',
  }),
  // 7 — Full house
  pranostika('martin_horse', 'full_house', {
    icon: 'house',
    bg: '#4a5568',
    fg: '#ffffff',
    accent: '#cbd5e1',
    pattern: 'checker',
    prop: 'snowflake-1',
  }),
  // 8 — Čtveřice
  pranostika('ice_saints', 'four', {
    icon: 'snowflake-1',
    bg: '#1f4f6b',
    fg: '#e6f7ff',
    accent: '#a5e3ff',
    pattern: 'grid',
  }),
  // 9 — Postupka v barvě
  pranostika('march_april_may', 'straight_flush', {
    icon: 'calendar',
    bg: '#3f6b3a',
    fg: '#f3ffe6',
    accent: '#f7d154',
    pattern: 'stripes',
    prop: 'linden-leaf',
  }),
  // 10 — Královská postupka
  pranostika('saint_wenceslas', 'royal_flush', {
    icon: 'shield',
    bg: '#7a1f2b',
    fg: '#fff1d6',
    accent: '#e8c15a',
    pattern: 'rays',
    prop: 'crown',
  }),
  // 11 — Pětice (tajná)
  pranostika('candlemas', 'five', {
    icon: 'candle-light',
    bg: '#2a2438',
    fg: '#fff4d1',
    accent: '#ffcf5a',
    pattern: 'rays',
  }),
  // 12 — Barevný full house (tajná)
  pranostika('catherine_ice', 'flush_house', {
    icon: 'snowman',
    bg: '#35506b',
    fg: '#f0f8ff',
    accent: '#b9e2ff',
    pattern: 'dots',
    prop: 'house',
  }),
  // 13 — Barevná pětice (tajná)
  pranostika('lucy_night', 'flush_five', {
    icon: 'moon',
    bg: '#141a33',
    fg: '#e8e6ff',
    accent: '#9d8cff',
    pattern: 'dots',
    prop: 'candle-light',
  }),
];
