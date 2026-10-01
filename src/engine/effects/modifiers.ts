/**
 * Skládání modifikátorů pravidel.
 * Čísla se sčítají, pole končící na `Mult` se násobí, booleany se ORují.
 */
import type { ModifierDelta, Modifiers } from '../types';

export const BASE_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  handSize: 8,
  hands: 4,
  discards: 3,
  maxSelect: 5,
  jokerSlots: 5,
  consumableSlots: 2,

  interestStep: 5,
  interestCap: 5,
  interestMult: 1,
  moneyPerUnusedHand: 1,
  moneyPerUnusedDiscard: 0,
  blindRewardMult: 1,
  debtLimit: 0,

  shopCardSlots: 2,
  shopBoosterSlots: 2,
  shopVoucherSlots: 1,
  rerollBaseCost: 4,
  rerollCostStep: 1,
  shopDiscountPct: 0,
  shopWeightJoker: 14,
  shopWeightPranostika: 3,
  shopWeightRada: 3,
  shopWeightRazitko: 0,
  shopWeightPlayingCard: 0,
  editionRateMult: 1,

  probabilityMult: 1,
  targetMult: 1,

  fourCardStraightFlush: false,
  straightGaps: false,
  straightWrap: false,
  allFaces: false,
  mergedSuits: false,
  allCardsScore: false,
});

const MODIFIER_KEYS = Object.keys(BASE_MODIFIERS) as (keyof Modifiers)[];

function isMultKey(key: string): boolean {
  return key.endsWith('Mult');
}

/** Přičte jednu deltu k modifikátorům (mutuje `target`). */
export function applyDelta(target: Modifiers, delta: ModifierDelta | null | undefined): Modifiers {
  if (!delta) return target;
  const t = target as unknown as Record<string, number | boolean>;
  for (const key of Object.keys(delta) as (keyof Modifiers)[]) {
    const value = delta[key];
    if (value === undefined) continue;
    const current = t[key];
    if (typeof current === 'boolean') {
      t[key] = current || Boolean(value);
    } else if (typeof current === 'number' && typeof value === 'number') {
      t[key] = isMultKey(key) ? current * value : current + value;
    }
  }
  return target;
}

/** Výsledné modifikátory = základ + všechny delty v daném pořadí. */
export function combineModifiers(deltas: readonly (ModifierDelta | null | undefined)[]): Modifiers {
  const out: Modifiers = { ...BASE_MODIFIERS };
  for (const d of deltas) applyDelta(out, d);
  return clampModifiers(out);
}

/** Ochrana proti nesmyslným hodnotám (záporné sloty apod.). */
export function clampModifiers(m: Modifiers): Modifiers {
  m.handSize = Math.max(1, m.handSize);
  m.hands = Math.max(1, m.hands);
  m.discards = Math.max(0, m.discards);
  m.maxSelect = Math.max(1, m.maxSelect);
  m.jokerSlots = Math.max(0, m.jokerSlots);
  m.consumableSlots = Math.max(0, m.consumableSlots);
  m.interestStep = Math.max(1, m.interestStep);
  m.interestCap = Math.max(0, m.interestCap);
  m.shopCardSlots = Math.max(0, m.shopCardSlots);
  m.shopBoosterSlots = Math.max(0, m.shopBoosterSlots);
  m.shopVoucherSlots = Math.max(0, m.shopVoucherSlots);
  m.rerollBaseCost = Math.max(0, m.rerollBaseCost);
  m.rerollCostStep = Math.max(0, m.rerollCostStep);
  m.shopDiscountPct = Math.min(100, Math.max(0, m.shopDiscountPct));
  m.debtLimit = Math.max(0, m.debtLimit);
  return m;
}

export function modifierKeys(): readonly (keyof Modifiers)[] {
  return MODIFIER_KEYS;
}
