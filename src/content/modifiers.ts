/**
 * Úpravy hracích karet: vylepšení, pečetě, edice (edice sdílí i žolíci).
 * Čísla viz docs/DESIGN.md. Texty v src/i18n/cs/modifiers.ts.
 */
import type { EditionDef, EnhancementDef, SealDef } from '../engine/content-types';

export const ENHANCEMENTS: EnhancementDef[] = [
  {
    id: 'bonus',
    params: { chips: 25 },
    onScored: () => ({ chips: 25 }),
    art: { icon: 'two-coins', bg: '#2f5d8a', fg: '#e8f1ff', pattern: 'dots' },
  },
  {
    id: 'mult',
    params: { mult: 5 },
    onScored: () => ({ mult: 5 }),
    art: { icon: 'fire', bg: '#8a2f2f', fg: '#ffe8e8', pattern: 'rays' },
  },
  {
    id: 'glass',
    params: { xmult: 2, chance: 1, odds: 5 },
    onScored: () => ({ xmult: 2 }),
    afterScored: (ctx) => (ctx.chance(1, 5) ? { destroyCard: true, message: 'score.glassBreak' } : undefined),
    art: { icon: 'glass-celebration', bg: '#7fb8c9', fg: '#ffffff', pattern: 'grid' },
  },
  {
    id: 'steel',
    params: { xmult: 1.5 },
    onHeld: () => ({ xmult: 1.5 }),
    art: { icon: 'anvil', bg: '#6b7280', fg: '#f3f4f6', pattern: 'checker' },
  },
  {
    id: 'stone',
    noRankSuit: true,
    params: { chips: 50 },
    onScored: () => ({ chips: 50 }),
    art: { icon: 'stone-block', bg: '#57534e', fg: '#e7e5e4', pattern: 'none' },
  },
  {
    id: 'gold',
    params: { money: 3 },
    roundEndHeldMoney: () => 3,
    art: { icon: 'gold-bar', bg: '#b8860b', fg: '#fff8dc', pattern: 'stripes' },
  },
  {
    id: 'lucky',
    params: { mult: 15, multOdds: 4, money: 15, moneyOdds: 12 },
    onScored: (ctx) => {
      const out = [];
      if (ctx.chance(1, 4)) out.push({ mult: 15, message: 'score.lucky' });
      if (ctx.chance(1, 12)) out.push({ money: 15, message: 'score.lucky' });
      return out;
    },
    art: { icon: 'clover', bg: '#2f7a3d', fg: '#eaffea', pattern: 'waves' },
  },
  {
    id: 'wild',
    allSuits: true,
    art: { icon: 'card-joker', bg: '#6d28d9', fg: '#f5f3ff', pattern: 'zigzag' },
  },
];

export const SEALS: SealDef[] = [
  {
    id: 'gold',
    params: { money: 3 },
    onScored: () => ({ money: 3 }),
    art: { icon: 'coins', bg: '#b8860b', fg: '#fff8dc' },
  },
  {
    id: 'red',
    retriggers: 1,
    art: { icon: 'cycle', bg: '#b91c1c', fg: '#fff1f2' },
  },
  {
    id: 'blue',
    onRoundEndHeld: (ctx) => {
      if (ctx.lastHand) ctx.api.createConsumable({ forHand: ctx.lastHand });
    },
    art: { icon: 'cloud', bg: '#1d4ed8', fg: '#eff6ff' },
  },
  {
    id: 'purple',
    onDiscarded: (ctx) => {
      ctx.api.createConsumable({ kind: 'rada' });
    },
    art: { icon: 'crystal-ball', bg: '#7e22ce', fg: '#faf5ff' },
  },
];

export const EDITIONS: EditionDef[] = [
  { id: 'foil', params: { chips: 50 }, effect: () => ({ chips: 50 }), jokerTiming: 'before', priceAdd: 2, weight: 2.5, forCards: true },
  { id: 'holo', params: { mult: 10 }, effect: () => ({ mult: 10 }), jokerTiming: 'before', priceAdd: 3, weight: 1.5, forCards: true },
  { id: 'poly', params: { xmult: 1.5 }, effect: () => ({ xmult: 1.5 }), jokerTiming: 'after', priceAdd: 5, weight: 0.4, forCards: true },
  { id: 'negative', params: { slots: 1 }, extraSlots: 1, priceAdd: 5, weight: 0.3, forCards: false },
];
