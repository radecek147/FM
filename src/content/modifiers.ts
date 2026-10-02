/**
 * Úpravy hracích karet: vylepšení, pečetě, edice (edice sdílí i žolíci).
 * Čísla viz docs/DESIGN.md kap. 2.6–2.8. Texty v src/i18n/cs/modifiers.ts (`{param}` = hodnoty z `params`).
 */
import type { EditionDef, EffectResult, EnhancementDef, SealDef } from '../engine/content-types';
import { MSG } from '../engine/constants';

/** Čísla vylepšení — jediný zdroj pro mechaniku i popisky (`params`). */
const BONUS_CHIPS = 25;
const MULT_MULT = 5;
const GLASS_XMULT = 2;
const GLASS_BREAK_ODDS = 5;
const STEEL_XMULT = 1.5;
const STONE_CHIPS = 50;
const GOLD_MONEY = 3;
const LUCKY_MULT = 15;
const LUCKY_MULT_ODDS = 4;
const LUCKY_MONEY = 15;
const LUCKY_MONEY_ODDS = 12;
const WORN_CHIPS = 3;

export const ENHANCEMENTS: EnhancementDef[] = [
  {
    id: 'bonus',
    params: { chips: BONUS_CHIPS },
    onScored: () => ({ chips: BONUS_CHIPS }),
    art: { icon: 'two-coins', bg: '#2f5d8a', fg: '#e8f1ff', pattern: 'dots' },
  },
  {
    id: 'mult',
    params: { mult: MULT_MULT },
    onScored: () => ({ mult: MULT_MULT }),
    art: { icon: 'fire', bg: '#8a2f2f', fg: '#ffe8e8', pattern: 'rays' },
  },
  {
    id: 'glass',
    params: { xmult: GLASS_XMULT, chance: 1, odds: GLASS_BREAK_ODDS },
    onScored: () => ({ xmult: GLASS_XMULT }),
    // Hod na prasknutí jednou za ruku (afterScored), karta se zničí až po sečtení skóre.
    afterScored: (ctx) =>
      ctx.chance(1, GLASS_BREAK_ODDS) ? { destroyCard: true, message: MSG.glassBreak } : undefined,
    art: { icon: 'glass-celebration', bg: '#7fb8c9', fg: '#ffffff', pattern: 'grid' },
  },
  {
    id: 'steel',
    params: { xmult: STEEL_XMULT },
    onHeld: () => ({ xmult: STEEL_XMULT }),
    art: { icon: 'anvil', bg: '#6b7280', fg: '#f3f4f6', pattern: 'checker' },
  },
  {
    id: 'stone',
    noRankSuit: true,
    params: { chips: STONE_CHIPS },
    onScored: () => ({ chips: STONE_CHIPS }),
    art: { icon: 'stone-block', bg: '#57534e', fg: '#e7e5e4', pattern: 'none' },
  },
  {
    id: 'gold',
    params: { money: GOLD_MONEY },
    roundEndHeldMoney: () => GOLD_MONEY,
    art: { icon: 'gold-bar', bg: '#b8860b', fg: '#fff8dc', pattern: 'stripes' },
  },
  {
    id: 'lucky',
    params: {
      mult: LUCKY_MULT,
      multChance: 1,
      multOdds: LUCKY_MULT_ODDS,
      money: LUCKY_MONEY,
      moneyChance: 1,
      moneyOdds: LUCKY_MONEY_ODDS,
    },
    // Hody proběhnou při každé aktivaci (červená pečeť = dvě šance).
    onScored: (ctx) => {
      const out: EffectResult[] = [];
      if (ctx.chance(1, LUCKY_MULT_ODDS)) out.push({ mult: LUCKY_MULT, message: MSG.lucky });
      if (ctx.chance(1, LUCKY_MONEY_ODDS)) out.push({ money: LUCKY_MONEY, message: MSG.luckyMoney });
      return out;
    },
    art: { icon: 'clover', bg: '#2f7a3d', fg: '#eaffea', pattern: 'waves' },
  },
  {
    id: 'wild',
    allSuits: true,
    art: { icon: 'card-joker', bg: '#6d28d9', fg: '#f5f3ff', pattern: 'zigzag' },
  },
  {
    id: 'worn',
    params: { chips: WORN_CHIPS },
    // Po každé ruce, ve které skórovala, trvale +3 čipy (jednou za ruku, i při opakované aktivaci).
    afterScored: (ctx) => {
      ctx.api.modifyCard(ctx.card.id, { bonusChips: ctx.card.bonusChips + WORN_CHIPS });
      return { message: MSG.worn };
    },
    art: { icon: 'hand', bg: '#8b6b4a', fg: '#fdf3e6', pattern: 'waves' },
  },
];

/** Čísla pečetí. */
const GOLD_SEAL_MONEY = 2;

export const SEALS: SealDef[] = [
  {
    id: 'gold',
    params: { money: GOLD_SEAL_MONEY },
    onScored: () => ({ money: GOLD_SEAL_MONEY }),
    art: { icon: 'coins', bg: '#b8860b', fg: '#fff8dc' },
  },
  {
    id: 'red',
    params: { retriggers: 1 },
    // Aktivuje kartu 1× navíc ve skórování i v ruce (engine sčítá `retriggers`).
    retriggers: 1,
    art: { icon: 'cycle', bg: '#b91c1c', fg: '#fff1f2' },
  },
  {
    id: 'blue',
    onRoundEndHeld: (ctx) => {
      if (ctx.lastHand) ctx.api.createConsumable({ forHand: ctx.lastHand });
    },
    art: { icon: 'fluffy-cloud', bg: '#1d4ed8', fg: '#eff6ff' },
  },
  {
    id: 'purple',
    onDiscarded: (ctx) => {
      ctx.api.createConsumable({ kind: 'rada' });
    },
    art: { icon: 'crystal-ball', bg: '#7e22ce', fg: '#faf5ff' },
  },
];

/**
 * Edice (DESIGN 2.6): `weight` = šance u žolíka v %, `weightCard` = šance u hrací karty v %.
 * Negativní se losuje samostatně (jen žolíci) a nenásobí ji `editionRateMult`.
 * Šance u hrací karty jsou vlastní (5 / 2,5 / 1 %) — 4 / 2,8 / 1,2 % by byla převzatá čísla (DESIGN příloha A).
 */
export const EDITIONS: EditionDef[] = [
  {
    id: 'foil',
    params: { chips: 50 },
    effect: () => ({ chips: 50 }),
    jokerTiming: 'before',
    priceAdd: 1,
    weight: 2.5,
    weightCard: 5,
  },
  {
    id: 'holo',
    params: { mult: 10 },
    effect: () => ({ mult: 10 }),
    jokerTiming: 'before',
    priceAdd: 2,
    weight: 1.5,
    weightCard: 2.5,
  },
  {
    id: 'poly',
    params: { xmult: 1.5 },
    effect: () => ({ xmult: 1.5 }),
    jokerTiming: 'after',
    priceAdd: 4,
    weight: 0.4,
    weightCard: 1,
  },
  {
    id: 'negative',
    params: { slots: 1 },
    extraSlots: 1,
    priceAdd: 6,
    weight: 0.25,
    weightCard: 0,
    separateRoll: true,
  },
];
