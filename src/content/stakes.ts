/**
 * Obtížnosti „Síla piva“ (docs/DESIGN.md kap. 10). Každá úroveň přidává právě jedno ztížení; kumulaci řeší engine —
 * obtížnost N aplikuje `passive`, `targetCurve` (nejvyšší), `stickerChance` (maximum), `noSmallBlindReward`
 * a `bigBlindBoss` všech úrovní ≤ N.
 * Texty v src/i18n/cs/stakes.ts (`stakes.<id>.name|desc|flavor`, `{param}` = hodnoty z `params`).
 * Návod: docs/CONTENT-GUIDE.md.
 */
import type { StakeDef } from '../engine/content-types';
import { PERISH_ROUNDS, RENTAL_BUY_PRICE, RENTAL_FEE, RENTAL_INSTALLMENTS } from '../engine/constants';
import { anteBase } from '../engine/run/targets';
import { shopPrice } from '../engine/shop/prices';

/**
 * Jedenáctka: příplatek k ceně každého přehození ve Večerce (Kč) — od patra `REROLL_PRICE_FROM_ANTE`. Dřív +1 Kč ke
 * všemu ve Večerce: se silnějšími boty fáze 10 (víc nákupů za run) srazil výhry z ~29 na ~10 % (i od 6. patra jen
 * na ~21 %); příplatek jen na přehození stojí ~6 p. b. (DECISIONS 2026-10-02 „Fáze 10: balanc…“).
 */
export const REROLL_PRICE_ADD = 1;
export const REROLL_PRICE_FROM_ANTE = 2;
/**
 * Ležák: změna peněz za každou nevyužitou ruku (Kč) — až od patra `UNUSED_HAND_FROM_ANTE`. Bez dýška od začátku
 * srazilo výhry ze Speciálu (~13 %) na ~3 % (pásmo 7–12 %).
 */
export const UNUSED_HAND_PENALTY = -1;
export const UNUSED_HAND_FROM_ANTE = 3;
/**
 * Speciál: šance na zvětrávajícího žolíka v obchodě a obálce. Dřív 25 % — boti fáze 10 oceňují zvětrávající žolíky
 * podle zbývajících kol a 25 % je skoro nebrzdilo (Dvanáctka → Speciál −2 p. b.); se 40 % stojí ~8 p. b.
 */
export const PERISHABLE_CHANCE = 0.4;
/**
 * Doppelbock: šance na přibitého a zapůjčeného žolíka. Dřív 20 % a 15 % — Doppelbock (5,75 %) i Imperial (4 %) byly
 * nad pásmem; s 25 % / 25 % a vyšší křivkou 3 jsou v pásmu (DECISIONS 2026-10-02 „Balanc po fázi 7“). Ne 30 %:
 * to je číslo žebříčku předlohy (DESIGN příloha A).
 */
export const ETERNAL_CHANCE = 0.25;
export const RENTAL_CHANCE = 0.25;

/**
 * Imperial: násobek cílů útrat Šéf (vedle pravidla šéfa ve Velké útratě). Po fázi 7 ×1,2; s cíli fáze 10 (patro 8
 * se základem 95 000) a ×1,2 vyhrával nejlepší bot pod 1 %, s ×1,1 v pásmu 1–3 % (DECISIONS 2026-10-02 „Fáze 10:
 * balanc…“).
 */
export const IMPERIAL_BOSS_TARGET_MULT = 1.1;

/** Pravděpodobnost v procentech pro popisek (0,25 → 25). */
const pct = (p: number): number => Math.round(p * 100);

/** Základ Malé útraty v patře 8 dané křivky — popisek ukazuje, kam až cíle dorostou. */
const finalSmall = (curve: number): number => anteBase(8, curve);

/** Doppelbock: cena zapůjčeného žolíka ve Večerce (`RENTAL_BUY_PRICE` nahrazuje základ ceny). */
const RENTAL_SHOP_PRICE = shopPrice({ shopDiscountPct: 0, shopPriceAdd: 0 }, RENTAL_BUY_PRICE);

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
    passive: (ctx) => (ctx.state.ante >= REROLL_PRICE_FROM_ANTE ? { rerollBaseCost: REROLL_PRICE_ADD } : {}),
    params: { add: REROLL_PRICE_ADD, fromAnte: REROLL_PRICE_FROM_ANTE },
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
    passive: (ctx) =>
      ctx.state.ante >= UNUSED_HAND_FROM_ANTE ? { moneyPerUnusedHand: UNUSED_HAND_PENALTY } : {},
    params: { money: -UNUSED_HAND_PENALTY, fromAnte: UNUSED_HAND_FROM_ANTE },
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
      installments: RENTAL_INSTALLMENTS,
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
    passive: () => ({ bossTargetMult: IMPERIAL_BOSS_TARGET_MULT }),
    params: { boss: Math.round((IMPERIAL_BOSS_TARGET_MULT - 1) * 100) },
    art: { icon: 'imperial-crown', bg: '#1a0f08', fg: '#f5d76e', accent: '#7a1f1f', pattern: 'rays' },
  },
];
