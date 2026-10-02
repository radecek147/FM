/**
 * Kupóny (docs/DESIGN.md kap. 6): 12 párů základ (tier 1) → vylepšení (tier 2 s `requires`), ceny 8–15 Kč.
 * Texty v src/i18n/cs/vouchers.ts (`vouchers.<id>.name|desc|flavor`). Návod: docs/CONTENT-GUIDE.md kap. 6.
 *
 * Efekty platí do konce runu. `passive` vrací deltu `Modifiers` — delty se sčítají (pole `*Mult` násobí), takže
 * tier 2 přidává jen rozdíl proti tier 1 (sleva 20 + 20 = 40 %, edice ×2,5 × 1,4 = ×3,5). Jednorázové věci
 * (−1 patro) jsou v `onRedeem`. Engine kupón uplatní hned: ceny ve Večerce se přepočítají a sloty, které kupón
 * přidal, se v otevřené Večerce doplní (`syncShopSlots`). Čísla jsou jen v konstantách níže — mechanika i popisek
 * (`params`) čtou stejné hodnoty.
 */
import type { ArtSpec, BaseCtx, UnlockCondition, VoucherDef } from '../engine/content-types';
import { BASE_MODIFIERS } from '../engine/effects/modifiers';

// ─────────────────────────── Čísla (DESIGN 6) ───────────────────────────

/** 1 Druhý regál / Regál u pokladny: sloty Večerky navíc. */
const SHELF_CARD_SLOTS = 1;
const CHECKOUT_BOOSTER_SLOTS = 1;
/** 2 Věrnostní karta / Zlatá věrnostní: sleva ve Večerce v % (celkem). */
const LOYALTY_PCT = 20;
const GOLD_LOYALTY_PCT = 40;
/** 3 Kamarád za pultem: přehození o tolik Kč levnější. Švagr vedoucí: cena v téže Večerce neroste. */
const BUDDY_REROLL_DISCOUNT = 1;
/** 4 Prodloužená otvíračka / Nonstop: ruce navíc, Kč navíc za nevyužitou ruku. */
const LATE_HOURS_HANDS = 1;
const NONSTOP_HANDS = 1;
const NONSTOP_MONEY_PER_HAND = 1;
/** 5 Kontejner před domem / Sběrný dvůr: zahození navíc, Kč za nevyužité zahození. */
const DUMPSTER_DISCARDS = 1;
const YARD_DISCARDS = 1;
const YARD_MONEY_PER_DISCARD = 1;
/** 6 Větší stůl / Rozkládací stůl: karty v ruce navíc (Rozkládací ještě navíc v kole Šéfa). */
const TABLE_HAND_SIZE = 1;
const FOLDING_HAND_SIZE = 1;
const FOLDING_BOSS_HAND_SIZE = 1;
/** 7 Spořicí účet / Stavební spoření: strop úroku v Kč (celkem). */
const SAVINGS_INTEREST_CAP = 8;
const BUILDING_INTEREST_CAP = 12;
/** 8 Úzký věšák / Pořádný věšák. */
const NARROW_JOKER_SLOTS = 1;
const NARROW_HAND_SIZE_LOSS = 1;
const PROPER_HAND_SIZE = 1;
/** 9 Trhací kalendář / Babiččina spíž: váhy typů kartových slotů navíc (DESIGN 2.5.3), sloty spotřebek. */
const CALENDAR_WEIGHT = 4;
const PANTRY_WEIGHT = 1.5;
const PANTRY_RAZITKO_WEIGHT = 2;
const PANTRY_CONSUMABLE_SLOTS = 1;
/** 10 Stánek s kartami / Kartářka: váha hracích karet, šance na vylepšení a pečeť v % (celkem). */
const STALL_CARD_WEIGHT = 5;
const TELLER_ENHANCE_PCT = 50;
const TELLER_SEAL_PCT = 20;
/** 11 Leštěnka / Hologramová fólie: násobič šance na lesklou, holografickou a duhovou edici (celkem). */
const POLISH_EDITION_MULT = 2.5;
const HOLO_FOIL_EDITION_MULT = 3.5;
/** 12 Úřední škrt / Amnestie: o kolik pater zpět, postih, od kterého patra má kupón smysl. */
const STRIKE_ANTES = 1;
const STRIKE_TARGET_MULT = 1.1;
const AMNESTY_PRICE_ADD = 1;
const STRIKE_MIN_ANTE = 2;

/**
 * Tier 2 se odemyká koupí jeho tier 1 ve 2 různých runech, nebo všechny najednou po 3 výhrách (DESIGN 11.3).
 * Podmínku vyhodnotí meta (fáze 8) podle `requires`; do té doby je `unlockedPool.vouchers` null = vše odemčené.
 */
const TIER2_UNLOCK: UnlockCondition = { type: 'custom', id: 'voucherTier1TwoRuns' };

// ─────────────────────────── Pomocníci ───────────────────────────

/** „−1 patro“ jde koupit/nabídnout jen tam, kde se patro opravdu sníží (v patře 1 by zbyl jen postih). */
const anteCanDrop = (ctx: BaseCtx): boolean => ctx.state.ante >= STRIKE_MIN_ANTE;

/** Tier 1 (bez `requires`). */
function tier1(
  id: string,
  cost: number,
  art: ArtSpec,
  extra: Omit<VoucherDef, 'id' | 'tier' | 'cost' | 'art'>,
): VoucherDef {
  return { id, tier: 1, cost, ...extra, art };
}

/** Tier 2 — vyžaduje vlastnictví `requires` (tier 1 páru). */
function tier2(
  id: string,
  requires: string,
  cost: number,
  art: ArtSpec,
  extra: Omit<VoucherDef, 'id' | 'tier' | 'requires' | 'cost' | 'art' | 'unlock'>,
): VoucherDef {
  return { id, tier: 2, requires, cost, ...extra, art, unlock: TIER2_UNLOCK };
}

// ─────────────────────────── Kupóny ───────────────────────────

export const VOUCHERS: VoucherDef[] = [
  // 1 — sloty Večerky
  tier1(
    'second_shelf',
    9,
    { icon: 'shop', bg: '#2f4858', fg: '#f1f7ed', accent: '#f6ae2d', pattern: 'grid' },
    {
      params: { slots: SHELF_CARD_SLOTS },
      passive: () => ({ shopCardSlots: SHELF_CARD_SLOTS }),
    },
  ),
  tier2(
    'checkout_shelf',
    'second_shelf',
    12,
    { icon: 'shopping-cart', bg: '#33658a', fg: '#fdfcdc', accent: '#f6ae2d', pattern: 'rays' },
    {
      params: { slots: CHECKOUT_BOOSTER_SLOTS },
      passive: () => ({ shopBoosterSlots: CHECKOUT_BOOSTER_SLOTS }),
    },
  ),

  // 2 — sleva
  tier1(
    'loyalty_card',
    10,
    { icon: 'ticket', bg: '#1f3b3a', fg: '#e8f1d4', accent: '#9bc53d', pattern: 'dots' },
    {
      params: { pct: LOYALTY_PCT },
      passive: () => ({ shopDiscountPct: LOYALTY_PCT }),
    },
  ),
  tier2(
    'gold_loyalty',
    'loyalty_card',
    13,
    { icon: 'crown-coin', bg: '#3b2f12', fg: '#ffe9a8', accent: '#f4c430', pattern: 'rays' },
    {
      params: { pct: GOLD_LOYALTY_PCT },
      // Modifikátory se sčítají: 20 + 20 = 40 %.
      passive: () => ({ shopDiscountPct: GOLD_LOYALTY_PCT - LOYALTY_PCT }),
    },
  ),

  // 3 — přehození
  tier1(
    'counter_buddy',
    9,
    { icon: 'anticlockwise-rotation', bg: '#4a3b5c', fg: '#f3ecff', accent: '#c3a6ff', pattern: 'waves' },
    {
      params: {
        discount: BUDDY_REROLL_DISCOUNT,
        cost: BASE_MODIFIERS.rerollBaseCost - BUDDY_REROLL_DISCOUNT,
      },
      passive: () => ({ rerollBaseCost: -BUDDY_REROLL_DISCOUNT }),
    },
  ),
  tier2(
    'manager_inlaw',
    'counter_buddy',
    11,
    { icon: 'mustache', bg: '#5c3b4a', fg: '#ffeef3', accent: '#ff9fb2', pattern: 'checker' },
    {
      // Přírůstek ceny přehození se vynuluje (výchozí krok 1 Kč → 0 Kč).
      passive: () => ({ rerollCostStep: -BASE_MODIFIERS.rerollCostStep }),
    },
  ),

  // 4 — ruce
  tier1(
    'late_hours',
    12,
    { icon: 'moon', bg: '#1b2a49', fg: '#e9ecf5', accent: '#ffd166', pattern: 'dots' },
    {
      params: { hands: LATE_HOURS_HANDS },
      passive: () => ({ hands: LATE_HOURS_HANDS }),
    },
  ),
  tier2(
    'nonstop',
    'late_hours',
    15,
    { icon: 'alarm-clock', bg: '#2a1b49', fg: '#f3e9ff', accent: '#ffd166', pattern: 'rays' },
    {
      params: { hands: NONSTOP_HANDS, money: NONSTOP_MONEY_PER_HAND },
      passive: () => ({ hands: NONSTOP_HANDS, moneyPerUnusedHand: NONSTOP_MONEY_PER_HAND }),
    },
  ),

  // 5 — zahození
  tier1(
    'dumpster',
    9,
    {
      icon: 'card-discard',
      bg: '#3d4a3d',
      fg: '#eef5e9',
      accent: '#a3b18a',
      pattern: 'stripes',
      prop: 'broken-bottle',
    },
    {
      params: { discards: DUMPSTER_DISCARDS },
      passive: () => ({ discards: DUMPSTER_DISCARDS }),
    },
  ),
  tier2(
    'recycling_yard',
    'dumpster',
    12,
    { icon: 'cycle', bg: '#24543a', fg: '#e9fbe9', accent: '#7ae582', pattern: 'zigzag' },
    {
      params: { discards: YARD_DISCARDS, money: YARD_MONEY_PER_DISCARD },
      passive: () => ({ discards: YARD_DISCARDS, moneyPerUnusedDiscard: YARD_MONEY_PER_DISCARD }),
    },
  ),

  // 6 — velikost ruky
  tier1(
    'bigger_table',
    12,
    { icon: 'card-draw', bg: '#5a3e2b', fg: '#fbefe3', accent: '#e0a96d', pattern: 'grid' },
    {
      params: { cards: TABLE_HAND_SIZE },
      passive: () => ({ handSize: TABLE_HAND_SIZE }),
    },
  ),
  tier2(
    'folding_table',
    'bigger_table',
    15,
    {
      icon: 'poker-hand',
      bg: '#6b4226',
      fg: '#fff3e6',
      accent: '#f4a259',
      pattern: 'checker',
      prop: 'crowned-skull',
    },
    {
      params: { cards: FOLDING_HAND_SIZE, bossCards: FOLDING_BOSS_HAND_SIZE },
      // V kole Šéfa (round.blind === 'boss') ještě karta navíc; modifikátory se přepočítají při výběru útraty.
      passive: (ctx) => ({
        handSize: FOLDING_HAND_SIZE + (ctx.state.round?.blind === 'boss' ? FOLDING_BOSS_HAND_SIZE : 0),
      }),
    },
  ),

  // 7 — úrok
  tier1(
    'savings_account',
    9,
    { icon: 'piggy-bank', bg: '#2b4162', fg: '#eaf2ff', accent: '#9ad1d4', pattern: 'stripes' },
    {
      params: { cap: SAVINGS_INTEREST_CAP },
      passive: () => ({ interestCap: SAVINGS_INTEREST_CAP - BASE_MODIFIERS.interestCap }),
    },
  ),
  tier2(
    'building_savings',
    'savings_account',
    12,
    { icon: 'house', bg: '#1d3557', fg: '#f1faee', accent: '#a8dadc', pattern: 'grid', prop: 'coins' },
    {
      params: { cap: BUILDING_INTEREST_CAP },
      // Rozdíl proti Spořicímu účtu (8 → 12 Kč).
      passive: () => ({ interestCap: BUILDING_INTEREST_CAP - SAVINGS_INTEREST_CAP }),
    },
  ),

  // 8 — věšák (sloty žolíků za kartu v ruce)
  tier1(
    'narrow_rack',
    11,
    { icon: 'jester-hat', bg: '#4b2142', fg: '#fde8f5', accent: '#e56b9f', pattern: 'stripes' },
    {
      params: { slots: NARROW_JOKER_SLOTS, cards: NARROW_HAND_SIZE_LOSS },
      passive: () => ({ jokerSlots: NARROW_JOKER_SLOTS, handSize: -NARROW_HAND_SIZE_LOSS }),
    },
  ),
  tier2(
    'proper_rack',
    'narrow_rack',
    13,
    { icon: 'top-hat', bg: '#3a1f4b', fg: '#f6e9ff', accent: '#c77dff', pattern: 'rays' },
    {
      params: { cards: PROPER_HAND_SIZE },
      passive: () => ({ handSize: PROPER_HAND_SIZE }),
    },
  ),

  // 9 — spotřebky ve Večerce
  tier1(
    'tear_calendar',
    8,
    { icon: 'calendar', bg: '#7a2e2e', fg: '#fff1e6', accent: '#ffb4a2', pattern: 'grid' },
    {
      params: {
        from: BASE_MODIFIERS.shopWeightPranostika,
        to: BASE_MODIFIERS.shopWeightPranostika + CALENDAR_WEIGHT,
        joker: BASE_MODIFIERS.shopWeightJoker,
      },
      passive: () => ({ shopWeightPranostika: CALENDAR_WEIGHT, shopWeightRada: CALENDAR_WEIGHT }),
    },
  ),
  tier2(
    'grandmas_pantry',
    'tear_calendar',
    11,
    {
      icon: 'honey-jar',
      bg: '#6b3e1f',
      fg: '#fff4e0',
      accent: '#f9c74f',
      pattern: 'checker',
      prop: 'post-stamp',
    },
    {
      params: {
        slots: PANTRY_CONSUMABLE_SLOTS,
        stamps: PANTRY_RAZITKO_WEIGHT,
        from: BASE_MODIFIERS.shopWeightPranostika + CALENDAR_WEIGHT,
        to: BASE_MODIFIERS.shopWeightPranostika + CALENDAR_WEIGHT + PANTRY_WEIGHT,
      },
      passive: () => ({
        consumableSlots: PANTRY_CONSUMABLE_SLOTS,
        shopWeightRazitko: PANTRY_RAZITKO_WEIGHT,
        shopWeightPranostika: PANTRY_WEIGHT,
        shopWeightRada: PANTRY_WEIGHT,
      }),
    },
  ),

  // 10 — hrací karty ve Večerce
  tier1(
    'card_stall',
    9,
    { icon: 'card-random', bg: '#14532d', fg: '#ecfdf5', accent: '#fde68a', pattern: 'dots' },
    {
      params: { weight: STALL_CARD_WEIGHT, joker: BASE_MODIFIERS.shopWeightJoker },
      passive: () => ({ shopWeightPlayingCard: STALL_CARD_WEIGHT }),
    },
  ),
  tier2(
    'card_reader',
    'card_stall',
    12,
    { icon: 'crystal-ball', bg: '#2e1a47', fg: '#f3e8ff', accent: '#a78bfa', pattern: 'waves' },
    {
      // Procenta, ne „…Chance“: UI by je jinak násobilo `probabilityMult`, který tyto šance nemění.
      params: { enhancePct: TELLER_ENHANCE_PCT, sealPct: TELLER_SEAL_PCT },
      passive: () => ({
        playingCardEnhanceChance: TELLER_ENHANCE_PCT / 100 - BASE_MODIFIERS.playingCardEnhanceChance,
        playingCardSealChance: TELLER_SEAL_PCT / 100 - BASE_MODIFIERS.playingCardSealChance,
      }),
    },
  ),

  // 11 — edice
  tier1(
    'polish',
    9,
    { icon: 'sparkles', bg: '#264653', fg: '#e9f5f2', accent: '#e9c46a', pattern: 'rays' },
    {
      params: { mult: POLISH_EDITION_MULT },
      passive: () => ({ editionRateMult: POLISH_EDITION_MULT }),
    },
  ),
  tier2(
    'holo_foil',
    'polish',
    12,
    { icon: 'stars-stack', bg: '#3d2c5e', fg: '#f4ecff', accent: '#7ee8fa', pattern: 'waves' },
    {
      params: { mult: HOLO_FOIL_EDITION_MULT, base: POLISH_EDITION_MULT },
      // Násobiče se násobí: 2,5 × 1,4 = 3,5.
      passive: () => ({ editionRateMult: HOLO_FOIL_EDITION_MULT / POLISH_EDITION_MULT }),
    },
  ),

  // 12 — −1 patro za trvalý postih
  tier1(
    'official_strike',
    12,
    {
      icon: 'contract',
      bg: '#3a3a3a',
      fg: '#f5f5f5',
      accent: '#e63946',
      pattern: 'stripes',
      prop: 'quill-ink',
    },
    {
      params: { antes: STRIKE_ANTES, targetMult: STRIKE_TARGET_MULT, minAnte: STRIKE_MIN_ANTE },
      available: anteCanDrop,
      onRedeem: (ctx) => ctx.api.changeAnte(-STRIKE_ANTES),
      passive: () => ({ targetMult: STRIKE_TARGET_MULT }),
    },
  ),
  tier2(
    'amnesty',
    'official_strike',
    14,
    { icon: 'padlock-open', bg: '#2d3a2e', fg: '#effaf0', accent: '#90be6d', pattern: 'rays' },
    {
      params: { antes: STRIKE_ANTES, priceAdd: AMNESTY_PRICE_ADD, minAnte: STRIKE_MIN_ANTE },
      available: anteCanDrop,
      onRedeem: (ctx) => ctx.api.changeAnte(-STRIKE_ANTES),
      passive: () => ({ shopPriceAdd: AMNESTY_PRICE_ADD }),
    },
  ),
];
