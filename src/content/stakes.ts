/**
 * Obtížnosti „Síla piva“ (docs/DESIGN.md kap. 10). Každá úroveň přidává právě jedno ztížení; kumulaci řeší engine —
 * obtížnost N aplikuje `passive`, `targetCurve` (nejvyšší), `stickerChance` (maximum), `noSmallBlindReward`
 * a `bigBlindBoss` všech úrovní ≤ N.
 * Texty v src/i18n/cs/stakes.ts (`stakes.<id>.name|desc|flavor`, `{param}` = hodnoty z `params`).
 * Návod: docs/CONTENT-GUIDE.md.
 */
import type { StakeDef } from '../engine/content-types';
import { PERISH_ROUNDS, RENTAL_BUY_PRICE, RENTAL_FEE } from '../engine/constants';
import { anteBase } from '../engine/run/targets';
import { shopPrice } from '../engine/shop/prices';

/** Jedenáctka: příplatek ke každé ceně ve Večerce (Kč). */
export const SHOP_PRICE_ADD = 1;
/** Ležák: změna peněz za každou nevyužitou ruku (Kč). */
export const UNUSED_HAND_PENALTY = -1;
/** Speciál: šance na zvětrávajícího žolíka v obchodě a obálce. */
export const PERISHABLE_CHANCE = 0.25;
/** Doppelbock: šance na přibitého a zapůjčeného žolíka. */
export const ETERNAL_CHANCE = 0.2;
export const RENTAL_CHANCE = 0.15;

/** Pravděpodobnost v procentech pro popisek (0,25 → 25). */
const pct = (p: number): number => Math.round(p * 100);

/** Základ Malé útraty v patře 8 dané křivky — popisek ukazuje, kam až cíle dorostou. */
const finalSmall = (curve: number): number => anteBase(8, curve);

/**
 * Doppelbock: cena zapůjčeného žolíka ve Večerce. `RENTAL_BUY_PRICE` nahrazuje jen základ ceny — příplatek Jedenáctky
 * (`shopPriceAdd`, platí na Doppelbocku vždy) se přičte jako ke všemu ostatnímu (DECISIONS: ceny ve Večerce).
 */
const RENTAL_SHOP_PRICE = shopPrice({ shopDiscountPct: 0, shopPriceAdd: SHOP_PRICE_ADD }, RENTAL_BUY_PRICE);

export const STAKES: StakeDef[] = [
  {
    id: 'desitka',
    level: 1,
    targetCurve: 1,
    params: { small8: finalSmall(1) },
    art: { icon: 'beer-stein', bg: '#c9a227', fg: '#fff8e1', accent: '#ffffff', pattern: 'none' },
  },
  {
    id: 'jedenactka',
    level: 2,
    passive: () => ({ shopPriceAdd: SHOP_PRICE_ADD }),
    params: { add: SHOP_PRICE_ADD },
    art: { icon: 'take-my-money', bg: '#b8860b', fg: '#fff8dc', accent: '#ffe08a', pattern: 'dots' },
  },
  {
    id: 'dvanactka',
    level: 3,
    targetCurve: 2,
    params: { small8: finalSmall(2) },
    art: { icon: 'beer-bottle', bg: '#a0522d', fg: '#fff1e0', accent: '#ffcf8a', pattern: 'stripes' },
  },
  {
    id: 'special',
    level: 4,
    stickerChance: { perishable: PERISHABLE_CHANCE },
    params: { perishable: pct(PERISHABLE_CHANCE), rounds: PERISH_ROUNDS },
    art: { icon: 'hourglass', bg: '#7a5c2e', fg: '#f7ecd8', accent: '#d9b77a', pattern: 'waves' },
  },
  {
    id: 'lezak',
    level: 5,
    passive: () => ({ moneyPerUnusedHand: UNUSED_HAND_PENALTY }),
    params: { money: -UNUSED_HAND_PENALTY },
    art: { icon: 'tap', bg: '#8c6d1f', fg: '#fffbe6', accent: '#f2d16b', pattern: 'grid' },
  },
  {
    id: 'bock',
    level: 6,
    targetCurve: 3,
    params: { small8: finalSmall(3) },
    art: { icon: 'barrel', bg: '#4a2c17', fg: '#f3e2cc', accent: '#c08552', pattern: 'checker' },
  },
  {
    id: 'doppelbock',
    level: 7,
    stickerChance: { eternal: ETERNAL_CHANCE, rental: RENTAL_CHANCE },
    params: {
      eternal: pct(ETERNAL_CHANCE),
      rental: pct(RENTAL_CHANCE),
      price: RENTAL_SHOP_PRICE,
      fee: RENTAL_FEE,
    },
    art: {
      icon: 'claw-hammer',
      bg: '#2e1a0f',
      fg: '#ead7c0',
      accent: '#a86b3c',
      pattern: 'zigzag',
      prop: 'ticket',
    },
  },
  {
    id: 'imperial',
    level: 8,
    bigBlindBoss: true,
    art: { icon: 'imperial-crown', bg: '#1a0f08', fg: '#f5d76e', accent: '#7a1f1f', pattern: 'rays' },
  },
];
