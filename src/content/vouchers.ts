/**
 * Kupóny (docs/DESIGN.md kap. 6): 12 párů základ (tier 1) → vylepšení (tier 2 s `requires`), ceny 8–15 Kč.
 * Texty v src/i18n/cs/vouchers.ts (`vouchers.<id>.name|desc|flavor`). Návod: docs/CONTENT-GUIDE.md kap. 6.
 *
 * Efekty platí do konce runu. `passive` vrací deltu `Modifiers` — delty se sčítají (pole `*Mult` násobí), takže
 * tier 2 přidává jen rozdíl proti tier 1 (věrnostní kartička 5 − 2 = každý 3. nákup). Jednorázové věci (−1 patro,
 * přelosování šéfa v rozehraném patře) jsou v `onRedeem`, reakce na události runu v `hooks`. Engine kupón uplatní
 * hned: ceny ve Večerce se přepočítají a sloty, které kupón přidal, se v otevřené Večerce doplní (`syncShopSlots`).
 * Čísla jsou jen v konstantách níže — mechanika i popisek (`params`) čtou stejné hodnoty.
 *
 * 1.0.1 (docs/DECISIONS.md 2026-10-03): pět párů s vlastní mechanikou místo převzaté — Věrnostní kartička (každý N-tý
 * nákup zdarma), Zpravodaj obce (přelosování šéfa za patro), Zálohovaná lahev (prodej za plnou cenu), Kniha stížností
 * (úrovně za nové a opakované kombinace) a Jarní úklid (edice žolíkům po šéfovi).
 */
import type { ArtSpec, BaseCtx, UnlockCondition, VoucherCtx, VoucherDef } from '../engine/content-types';
import { RENTAL_SELL_PRICE } from '../engine/constants';
import { BASE_MODIFIERS } from '../engine/effects/modifiers';
import { EDITIONS } from './modifiers';

// ─────────────────────────── Čísla (DESIGN 6) ───────────────────────────

/** 1 Druhý regál / Regál u pokladny: sloty Večerky navíc. */
const SHELF_CARD_SLOTS = 1;
const CHECKOUT_BOOSTER_SLOTS = 1;
/** 2 Věrnostní kartička / Kmenový zákazník: zdarma každý N-tý nákup ve Večerce. */
const LOYALTY_EVERY = 5;
const REGULAR_EVERY = 3;
/** 3 Zpravodaj obce / Obecní rozhlas: přelosování šéfa zdarma za patro (celkem), o kolik % nižší cíl šéfa. */
const NEWSLETTER_REROLLS = 1;
const RADIO_REROLLS = 2;
const RADIO_BOSS_PCT = 10;
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
/** 7 Zálohovaná lahev / Výkupna: prodej spotřebek / žolíků za plnou cenu (jen přepínače `Modifiers`). */
/** 8 Úzký věšák / Pořádný věšák. */
const NARROW_JOKER_SLOTS = 1;
const NARROW_HAND_SIZE_LOSS = 1;
const PROPER_HAND_SIZE = 1;
/** 9 Kniha stížností / Vyřízená stížnost: úrovně za první zahrání kombinace v runu, za každé N-té zahrání. */
const COMPLAINT_LEVELS = 1;
const SETTLED_EVERY = 6;
const SETTLED_LEVELS = 1;
/** 10 Stánek s kartami / Sběratelská burza: váha hracích karet, šance na vylepšení a pečeť v % (celkem). */
const STALL_CARD_WEIGHT = 5;
const FAIR_ENHANCE_PCT = 50;
const FAIR_SEAL_PCT = 20;
/** 11 Jarní úklid / Generální úklid: edice, kterou po porážce šéfa dostane náhodný žolík bez edice. */
const SPRING_EDITION = 'foil';
const DEEP_EDITION = 'holo';
const SPRING_ID = 'spring_cleaning';
const DEEP_ID = 'deep_cleaning';
/** Hodnoty edic do popisků (jediný zdroj čísel je `EDITIONS`). */
const editionParam = (id: string, key: string): number => {
  const v = EDITIONS.find((e) => e.id === id)?.params?.[key];
  return typeof v === 'number' ? v : 0;
};

/** Hlášky kupónů (i18n klíče). */
const MSG_COMPLAINT = 'vouchers.complaints_book.leveled';
const MSG_SETTLED = 'vouchers.complaint_settled.leveled';
const MSG_CLEANING = 'vouchers.spring_cleaning.cleaned';
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

/**
 * Jarní úklid po porážce šéfa: náhodný žolík bez edice (stream `misc`) dostane lesklou edici, s Generálním úklidem
 * holografickou. Bez žolíka bez edice nic.
 */
function springCleaning(ctx: VoucherCtx): void {
  const bare = ctx.state.jokers.filter((j) => j.edition === null);
  if (bare.length === 0) return;
  const edition = ctx.state.vouchers.includes(DEEP_ID) ? DEEP_EDITION : SPRING_EDITION;
  ctx.api.setJokerEdition(ctx.rng.pick(bare).uid, edition);
  ctx.api.message(MSG_CLEANING);
}

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

  // 2 — věrnostní kartička (každý N-tý nákup zdarma)
  tier1(
    'loyalty_card',
    10,
    {
      icon: 'post-stamp',
      prop: 'shopping-cart',
      bg: '#1f3b3a',
      fg: '#fff7c2',
      accent: '#facc15',
      pattern: 'dots',
    },
    {
      params: { every: LOYALTY_EVERY },
      passive: () => ({ freePurchaseEvery: LOYALTY_EVERY }),
    },
  ),
  tier2(
    'regular_customer',
    'loyalty_card',
    13,
    {
      icon: 'crown-coin',
      prop: 'shopping-cart',
      bg: '#3b2f12',
      fg: '#ffe9a8',
      accent: '#f4c430',
      pattern: 'rays',
    },
    {
      params: { every: REGULAR_EVERY, from: LOYALTY_EVERY },
      // Modifikátory se sčítají: 5 − 2 = každý 3. nákup.
      passive: () => ({ freePurchaseEvery: REGULAR_EVERY - LOYALTY_EVERY }),
    },
  ),

  // 3 — zpravodaj obce (přelosování šéfa za patro)
  tier1(
    'village_newsletter',
    9,
    { icon: 'newspaper', prop: 'house', bg: '#4a3b5c', fg: '#f3ecff', accent: '#c3a6ff', pattern: 'waves' },
    {
      params: { rerolls: NEWSLETTER_REROLLS },
      passive: () => ({ bossRerollsPerAnte: NEWSLETTER_REROLLS }),
      // Přelosování platí už v rozehraném patře (další patra je dostanou na začátku).
      onRedeem: (ctx) => ctx.api.addBossRerolls(NEWSLETTER_REROLLS),
    },
  ),
  tier2(
    'village_radio',
    'village_newsletter',
    12,
    {
      icon: 'megaphone',
      prop: 'church',
      bg: '#5c3b4a',
      fg: '#ffeef3',
      accent: '#ff9fb2',
      pattern: 'checker',
    },
    {
      params: { rerolls: RADIO_REROLLS, pct: RADIO_BOSS_PCT },
      passive: () => ({
        bossRerollsPerAnte: RADIO_REROLLS - NEWSLETTER_REROLLS,
        bossTargetMult: 1 - RADIO_BOSS_PCT / 100,
      }),
      onRedeem: (ctx) => ctx.api.addBossRerolls(RADIO_REROLLS - NEWSLETTER_REROLLS),
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

  // 7 — zálohovaná lahev (prodej za plnou cenu)
  tier1(
    'deposit_bottle',
    8,
    {
      icon: 'beer-bottle',
      prop: 'coins',
      bg: '#2b4162',
      fg: '#eaf2ff',
      accent: '#9ad1d4',
      pattern: 'stripes',
    },
    {
      passive: () => ({ consumableSellFull: true }),
    },
  ),
  tier2(
    'bottle_return',
    'deposit_bottle',
    12,
    {
      icon: 'wheelbarrow',
      bg: '#1d3557',
      fg: '#f1faee',
      accent: '#a8dadc',
      pattern: 'grid',
      prop: 'beer-bottle',
    },
    {
      params: { rental: RENTAL_SELL_PRICE },
      passive: () => ({ jokerSellFull: true }),
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

  // 9 — kniha stížností (úrovně za nové a opakované kombinace)
  tier1(
    'complaints_book',
    8,
    {
      icon: 'open-book',
      prop: 'quill-ink',
      bg: '#7a2e2e',
      fg: '#fff1e6',
      accent: '#ffb4a2',
      pattern: 'grid',
    },
    {
      params: { levels: COMPLAINT_LEVELS },
      hooks: {
        afterHandPlayed: (ctx) => {
          if (ctx.played !== 1) return;
          ctx.api.levelUpHand(ctx.hand, COMPLAINT_LEVELS);
          ctx.api.message(MSG_COMPLAINT);
        },
      },
    },
  ),
  tier2(
    'complaint_settled',
    'complaints_book',
    12,
    {
      icon: 'stamper',
      bg: '#6b3e1f',
      fg: '#fff4e0',
      accent: '#f9c74f',
      pattern: 'checker',
      prop: 'thumb-up',
    },
    {
      params: { every: SETTLED_EVERY, levels: SETTLED_LEVELS },
      hooks: {
        afterHandPlayed: (ctx) => {
          if (ctx.played <= 0 || ctx.played % SETTLED_EVERY !== 0) return;
          ctx.api.levelUpHand(ctx.hand, SETTLED_LEVELS);
          ctx.api.message(MSG_SETTLED);
        },
      },
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
    'collectors_fair',
    'card_stall',
    12,
    { icon: 'magnifying-glass', bg: '#2e1a47', fg: '#f3e8ff', accent: '#a78bfa', pattern: 'waves' },
    {
      // Procenta, ne „…Chance“: UI by je jinak násobilo `probabilityMult`, který tyto šance nemění.
      params: { enhancePct: FAIR_ENHANCE_PCT, sealPct: FAIR_SEAL_PCT },
      passive: () => ({
        playingCardEnhanceChance: FAIR_ENHANCE_PCT / 100 - BASE_MODIFIERS.playingCardEnhanceChance,
        playingCardSealChance: FAIR_SEAL_PCT / 100 - BASE_MODIFIERS.playingCardSealChance,
      }),
    },
  ),

  // 11 — jarní úklid (edice žolíkům po porážce šéfa)
  tier1(
    SPRING_ID,
    9,
    { icon: 'window', prop: 'sparkles', bg: '#264653', fg: '#e9f5f2', accent: '#e9c46a', pattern: 'rays' },
    {
      params: { chips: editionParam(SPRING_EDITION, 'chips') },
      hooks: { onBossDefeated: springCleaning },
    },
  ),
  tier2(
    DEEP_ID,
    SPRING_ID,
    12,
    {
      icon: 'toolbox',
      prop: 'stars-stack',
      bg: '#3d2c5e',
      fg: '#f4ecff',
      accent: '#7ee8fa',
      pattern: 'waves',
    },
    {
      // Mechaniku nese Jarní úklid (`springCleaning` čte, jestli je Generální úklid uplatněný) — bez hooku tady.
      params: { mult: editionParam(DEEP_EDITION, 'mult') },
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
