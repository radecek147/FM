/** Modifikátory pravidel — docs/DESIGN.md kap. 2.10 (BASE_MODIFIERS), příloha B a docs/ARCHITECTURE.md 2.6. */
import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  BASE_MODIFIERS,
  clampModifiers,
  combineModifiers,
  mergeDelta,
  modifierKeys,
} from '../../src/engine/effects/modifiers';
import type { ModifierDelta, Modifiers } from '../../src/engine/types';

describe('BASE_MODIFIERS', () => {
  it('odpovídá tabulce DESIGN 2.10 a příloze B', () => {
    const expected: Modifiers = {
      hands: 4,
      discards: 3,
      handSize: 8,
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
      shopWeightJoker: 12,
      shopWeightPranostika: 5,
      shopWeightRada: 3,
      shopWeightRazitko: 0.5,
      shopWeightPlayingCard: 0,
      editionRateMult: 1,
      probabilityMult: 1,
      targetMult: 1,
      // příloha B
      bossTargetMult: 1,
      shopPriceAdd: 0,
      playingCardEnhanceChance: 0.2,
      playingCardSealChance: 0,
      disableEnhancements: false,
      fixedCardChips: 0,
      // booleany false
      fourCardStraightFlush: false,
      straightGaps: false,
      straightWrap: false,
      allFaces: false,
      mergedSuits: false,
      allCardsScore: false,
      // pravidla runu pro výzvy (DESIGN 11.1, docs/DECISIONS.md „Výzvy: pravidla v enginu“) — výchozí vypnuto
      noJokers: false,
      noSkip: false,
      autoSkip: false,
      noReroll: false,
      flatShopPrice: 0,
      flatSellPrice: 0,
      handCost: 0,
      discardCost: 0,
      glassBreakOdds: 0,
      finalAnte: 8,
    };
    expect({ ...BASE_MODIFIERS }).toEqual(expected);
  });

  it('je zmražený a combine ho nemění', () => {
    expect(Object.isFrozen(BASE_MODIFIERS)).toBe(true);
    combineModifiers([{ hands: 3, editionRateMult: 2, allFaces: true }]);
    expect(BASE_MODIFIERS.hands).toBe(4);
    expect(BASE_MODIFIERS.editionRateMult).toBe(1);
    expect(BASE_MODIFIERS.allFaces).toBe(false);
  });

  it('modifierKeys vrací všechna pole', () => {
    expect([...modifierKeys()].sort()).toEqual(Object.keys(BASE_MODIFIERS).sort());
  });
});

describe('combineModifiers', () => {
  it('bez delt vrátí kopii základu', () => {
    const m = combineModifiers([]);
    expect(m).toEqual({ ...BASE_MODIFIERS });
    expect(m).not.toBe(BASE_MODIFIERS);
  });

  it('čísla sčítá (i záporná)', () => {
    const m = combineModifiers([
      { hands: 1 },
      { hands: 1, handSize: -1 },
      { interestCap: 3 },
      { shopPriceAdd: 1 },
    ]);
    expect(m.hands).toBe(6);
    expect(m.handSize).toBe(7);
    expect(m.interestCap).toBe(8);
    expect(m.shopPriceAdd).toBe(1);
  });

  it('pole končící na Mult násobí', () => {
    const m = combineModifiers([
      { editionRateMult: 2.5 },
      { editionRateMult: 1.4 },
      { targetMult: 1.1 },
      { probabilityMult: 2 },
    ]);
    expect(m.editionRateMult).toBeCloseTo(3.5);
    expect(m.targetMult).toBeCloseTo(1.1);
    expect(m.probabilityMult).toBe(2);
    expect(m.interestMult).toBe(1);
  });

  it('booleany ORuje — false už nastavené true nevypne', () => {
    const m = combineModifiers([{ allFaces: true }, { allFaces: false }, { disableEnhancements: true }]);
    expect(m.allFaces).toBe(true);
    expect(m.disableEnhancements).toBe(true);
    expect(m.straightWrap).toBe(false);
  });

  it('ignoruje null, undefined a undefined hodnoty', () => {
    const m = combineModifiers([null, undefined, { hands: undefined }, {}]);
    expect(m).toEqual({ ...BASE_MODIFIERS });
  });

  it('pořadí delt u součtů nehraje roli', () => {
    const deltas: ModifierDelta[] = [{ hands: 2 }, { hands: -1, discards: 1 }, { editionRateMult: 2 }];
    expect(combineModifiers(deltas)).toEqual(combineModifiers([...deltas].reverse()));
  });
});

describe('clampModifiers', () => {
  it('drží minima z DESIGN 2.4.1 (ruce ≥ 1, ruka ≥ 1, výběr ≥ 1, zahození ≥ 0, sloty ≥ 0)', () => {
    const m = combineModifiers([
      { hands: -10, handSize: -20, maxSelect: -5, discards: -9, jokerSlots: -7, consumableSlots: -3 },
    ]);
    expect(m.hands).toBe(1);
    expect(m.handSize).toBe(1);
    expect(m.maxSelect).toBe(1);
    expect(m.discards).toBe(0);
    expect(m.jokerSlots).toBe(0);
    expect(m.consumableSlots).toBe(0);
  });

  it('ořízne slevu na 0–100 %, šance na 0–1 a nezáporná pole', () => {
    const m = clampModifiers({
      ...BASE_MODIFIERS,
      shopDiscountPct: 140,
      playingCardEnhanceChance: 1.7,
      playingCardSealChance: -0.2,
      shopPriceAdd: -3,
      debtLimit: -5,
      moneyPerUnusedHand: -1,
      moneyPerUnusedDiscard: -2,
      fixedCardChips: -5,
      rerollBaseCost: -1,
      rerollCostStep: -1,
      interestStep: 0,
      interestCap: -1,
      editionRateMult: -1,
      shopCardSlots: -1,
      shopBoosterSlots: -1,
      shopVoucherSlots: -1,
    });
    expect(m.shopDiscountPct).toBe(100);
    expect(m.playingCardEnhanceChance).toBe(1);
    expect(m.playingCardSealChance).toBe(0);
    expect(m.shopPriceAdd).toBe(0);
    expect(m.debtLimit).toBe(0);
    expect(m.moneyPerUnusedHand).toBe(0);
    expect(m.moneyPerUnusedDiscard).toBe(0);
    expect(m.fixedCardChips).toBe(0);
    expect(m.rerollBaseCost).toBe(0);
    expect(m.rerollCostStep).toBe(0);
    expect(m.interestStep).toBe(1);
    expect(m.interestCap).toBe(0);
    expect(m.editionRateMult).toBe(0);
    expect(m.shopCardSlots + m.shopBoosterSlots + m.shopVoucherSlots).toBe(0);
    expect(clampModifiers({ ...BASE_MODIFIERS, shopDiscountPct: -10 }).shopDiscountPct).toBe(0);
  });

  it('Ležák: moneyPerUnusedHand −1 dá právě 0', () => {
    expect(combineModifiers([{ moneyPerUnusedHand: -1 }]).moneyPerUnusedHand).toBe(0);
  });
});

describe('applyDelta', () => {
  it('mutuje cíl a vrací ho', () => {
    const target: Modifiers = { ...BASE_MODIFIERS };
    expect(applyDelta(target, { hands: 2 })).toBe(target);
    expect(target.hands).toBe(6);
    expect(applyDelta(target, null)).toBe(target);
  });
});

describe('mergeDelta (RunState.extraModifiers)', () => {
  it('sčítá čísla, násobí *Mult (neutrální 1) a ORuje booleany', () => {
    const extra: ModifierDelta = { hands: -1 };
    mergeDelta(extra, { hands: -1, shopPriceAdd: 1 });
    mergeDelta(extra, { targetMult: 1.1 });
    mergeDelta(extra, { targetMult: 2, allFaces: true });
    mergeDelta(extra, { allFaces: false });
    expect(extra).toEqual({ hands: -2, shopPriceAdd: 1, targetMult: 2.2, allFaces: true });
  });

  it('výsledná delta dává stejné modifikátory jako postupné skládání', () => {
    const parts: ModifierDelta[] = [
      { hands: 1, editionRateMult: 2 },
      { hands: -2, editionRateMult: 1.5 },
    ];
    const merged = parts.reduce((acc, d) => mergeDelta(acc, d), {} as ModifierDelta);
    expect(combineModifiers([merged])).toEqual(combineModifiers(parts));
  });

  it('ignoruje neznámé klíče a null', () => {
    const extra: ModifierDelta = {};
    mergeDelta(extra, { nesmysl: 3 } as unknown as ModifierDelta);
    mergeDelta(extra, null);
    expect(extra).toEqual({});
  });
});
