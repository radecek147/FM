/**
 * Skládání modifikátorů pravidel.
 * Čísla se sčítají, pole končící na `Mult` se násobí, booleany se ORují.
 * Výchozí hodnoty = docs/DESIGN.md kap. 2.10 (`BASE_MODIFIERS`) + příloha B.
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
  shopPriceAdd: 0,
  playingCardEnhanceChance: 0.2,
  playingCardSealChance: 0,

  probabilityMult: 1,
  targetMult: 1,
  bossTargetMult: 1,

  fourCardStraightFlush: false,
  straightGaps: false,
  straightWrap: false,
  allFaces: false,
  mergedSuits: false,
  allCardsScore: false,
  disableEnhancements: false,
  fixedCardChips: 0,
});

const MODIFIER_KEYS = Object.keys(BASE_MODIFIERS) as (keyof Modifiers)[];

function isMultKey(key: string): boolean {
  return key.endsWith('Mult');
}

/** Sečte/vynásobí číselný modifikátor; neplatná hodnota (NaN, ±∞) nebo přetečení výsledku se ignoruje. */
function combineNumber(key: string, current: number, value: number): number {
  if (!Number.isFinite(value)) return current;
  const next = isMultKey(key) ? current * value : current + value;
  return Number.isFinite(next) ? next : current;
}

/**
 * Přičte jednu deltu k modifikátorům (mutuje `target`). Neplatná čísla z obsahu (NaN, nekonečno) se ignorují —
 * jinak by se přes `handsLeft`/`discardsLeft` dostala do stavu a JSON uložení by je změnilo na `null`.
 */
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
      t[key] = combineNumber(key, current, value);
    }
  }
  return target;
}

/**
 * Přičte deltu do jiné (částečné) delty se stejnými pravidly jako `applyDelta` — chybějící číslo se bere
 * jako neutrální prvek (0, u `*Mult` 1). Mutuje a vrací `target` (použití: `RunState.extraModifiers`). Neplatná
 * čísla (NaN, nekonečno) se ignorují — delta je součástí uloženého stavu.
 */
export function mergeDelta(target: ModifierDelta, delta: ModifierDelta | null | undefined): ModifierDelta {
  if (!delta) return target;
  const t = target as Record<string, number | boolean | undefined>;
  for (const key of Object.keys(delta) as (keyof Modifiers)[]) {
    const value = delta[key];
    if (value === undefined || !(key in BASE_MODIFIERS)) continue;
    const base = BASE_MODIFIERS[key];
    if (typeof base === 'boolean') {
      t[key] = Boolean(t[key]) || Boolean(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      const current = t[key];
      const neutral = isMultKey(key) ? 1 : 0;
      t[key] = combineNumber(key, typeof current === 'number' ? current : neutral, value);
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
  m.shopPriceAdd = Math.max(0, m.shopPriceAdd);
  m.playingCardEnhanceChance = Math.min(1, Math.max(0, m.playingCardEnhanceChance));
  m.playingCardSealChance = Math.min(1, Math.max(0, m.playingCardSealChance));
  m.moneyPerUnusedHand = Math.max(0, m.moneyPerUnusedHand);
  m.moneyPerUnusedDiscard = Math.max(0, m.moneyPerUnusedDiscard);
  m.editionRateMult = Math.max(0, m.editionRateMult);
  m.probabilityMult = Math.max(0, m.probabilityMult);
  m.bossTargetMult = Math.max(0, m.bossTargetMult);
  m.fixedCardChips = Math.max(0, m.fixedCardChips);
  m.debtLimit = Math.max(0, m.debtLimit);
  return m;
}

export function modifierKeys(): readonly (keyof Modifiers)[] {
  return MODIFIER_KEYS;
}
