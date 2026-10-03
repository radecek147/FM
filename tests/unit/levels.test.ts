/** Úrovně kombinací — docs/DESIGN.md kap. 2.2.1: `čipy(L) = základ + přírůstek × (L − 1)`, totéž pro mult. */
import { describe, expect, it } from 'vitest';
import { HAND_TYPE_DEFS } from '../../src/content/hands';
import { handValueAtLevel, initialHandLevels } from '../../src/engine/hands/levels';
import type { HandType, HandTypeDef } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';

/**
 * Přepis tabulky DESIGN 2.2.1: [čipy, mult] na úrovni 1, 2 a 5 a součin na úrovni 1 a 5
 * (sloupce „Úr. 1 (čipy×mult)“ a „Úr. 5“). Úroveň 2 = základ + jeden přírůstek.
 */
const TABLE: Record<
  HandType,
  { l1: [number, number]; l2: [number, number]; l5: [number, number]; p1: number; p5: number }
> = {
  high_card: { l1: [8, 1], l2: [33, 3], l5: [108, 9], p1: 8, p5: 972 },
  pair: { l1: [14, 2], l2: [44, 4], l5: [134, 10], p1: 28, p5: 1340 },
  two_pair: { l1: [30, 2], l2: [68, 4], l5: [182, 10], p1: 60, p5: 1820 },
  three: { l1: [36, 2], l2: [84, 5], l5: [228, 14], p1: 72, p5: 3192 },
  straight: { l1: [45, 3], l2: [93, 7], l5: [237, 19], p1: 135, p5: 4503 },
  flush: { l1: [55, 3], l2: [97, 6], l5: [223, 15], p1: 165, p5: 3345 },
  full_house: { l1: [65, 4], l2: [123, 7], l5: [297, 16], p1: 260, p5: 4752 },
  four: { l1: [95, 5], l2: [175, 10], l5: [415, 25], p1: 475, p5: 10375 },
  straight_flush: { l1: [130, 6], l2: [220, 11], l5: [490, 26], p1: 780, p5: 12740 },
  royal_flush: { l1: [170, 7], l2: [270, 12], l5: [570, 27], p1: 1190, p5: 15390 },
  five: { l1: [165, 9], l2: [255, 13], l5: [525, 25], p1: 1485, p5: 13125 },
  flush_house: { l1: [190, 10], l2: [290, 16], l5: [590, 34], p1: 1900, p5: 20060 },
  flush_five: { l1: [220, 12], l2: [325, 17], l5: [640, 32], p1: 2640, p5: 20480 },
};

const value = (type: HandType, level: number): [number, number] => {
  const v = handValueAtLevel(HAND_TYPE_DEFS[type], level);
  return [v.chips, v.mult];
};

describe('handValueAtLevel (DESIGN 2.2.1)', () => {
  it('tabulka pokrývá všech 13 kombinací', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...HAND_TYPES].sort());
  });

  it.each(HAND_TYPES.map((t) => [t]))('%s: úroveň 1, 2 a 5 podle tabulky', (type) => {
    const row = TABLE[type];
    expect(value(type, 1)).toEqual(row.l1);
    expect(value(type, 2)).toEqual(row.l2);
    expect(value(type, 5)).toEqual(row.l5);
    expect(row.l1[0] * row.l1[1]).toBe(row.p1);
    expect(row.l5[0] * row.l5[1]).toBe(row.p5);
  });

  it.each(HAND_TYPES.map((t) => [t]))('%s: úroveň 1 = základ z definice', (type) => {
    const d = HAND_TYPE_DEFS[type];
    expect(handValueAtLevel(d, 1)).toEqual({ chips: d.baseChips, mult: d.baseMult });
  });

  it.each(HAND_TYPES.map((t) => [t]))('%s: každá další úroveň přidá přesně jeden přírůstek', (type) => {
    const d = HAND_TYPE_DEFS[type];
    for (let level = 1; level <= 30; level++) {
      expect(handValueAtLevel(d, level)).toEqual({
        chips: d.baseChips + d.chipsPerLevel * (level - 1),
        mult: d.baseMult + d.multPerLevel * (level - 1),
      });
    }
  });

  it.each(HAND_TYPES.map((t) => [t]))('%s: úroveň < 1 se bere jako 1', (type) => {
    for (const level of [0, -1, -5, -100]) expect(value(type, level)).toEqual(TABLE[type].l1);
  });

  it('silnější kombinace má na úrovni 1 vyšší základ (čipy × mult)', () => {
    const products = HAND_TYPES.map((t) => TABLE[t].p1);
    for (let i = 1; i < products.length; i++) expect(products[i]).toBeGreaterThan(products[i - 1]!);
  });

  it('Postupka roste po úrovních rychleji než Barva (DESIGN 2.2.1, poznámky)', () => {
    const d = HAND_TYPE_DEFS;
    expect(d.straight.chipsPerLevel).toBeGreaterThan(d.flush.chipsPerLevel);
    const [sc, sm] = value('straight', 5);
    const [fc, fm] = value('flush', 5);
    expect(sc * sm).toBeGreaterThan(fc * fm);
  });

  it('mult nikdy neklesne pod 1 (ochrana pro případné záporné přírůstky)', () => {
    const def: HandTypeDef = {
      type: 'high_card',
      baseChips: 5,
      baseMult: 2,
      chipsPerLevel: 3,
      multPerLevel: -1,
      secret: false,
    };
    expect(handValueAtLevel(def, 2)).toEqual({ chips: 8, mult: 1 });
    expect(handValueAtLevel(def, 10)).toEqual({ chips: 32, mult: 1 });
  });

  it('nemění definici kombinace', () => {
    const before = JSON.stringify(HAND_TYPE_DEFS);
    for (const t of HAND_TYPES) handValueAtLevel(HAND_TYPE_DEFS[t], 7);
    expect(JSON.stringify(HAND_TYPE_DEFS)).toBe(before);
  });
});

describe('initialHandLevels', () => {
  it('všech 13 kombinací na úrovni 1, zatím nezahraných, v pořadí HAND_TYPES', () => {
    const levels = initialHandLevels();
    expect(Object.keys(levels)).toEqual(HAND_TYPES);
    for (const t of HAND_TYPES) expect(levels[t]).toEqual({ level: 1, played: 0 });
  });

  it('i tajné kombinace začínají na úrovni 1 (DESIGN 2.2.4)', () => {
    const levels = initialHandLevels();
    expect(levels.five.level).toBe(1);
    expect(levels.flush_house.level).toBe(1);
    expect(levels.flush_five.level).toBe(1);
  });

  it('každé volání vrací nový objekt (žádné sdílené reference)', () => {
    const a = initialHandLevels();
    const b = initialHandLevels();
    a.pair.level = 5;
    a.flush.played = 3;
    expect(b.pair).toEqual({ level: 1, played: 0 });
    expect(b.flush).toEqual({ level: 1, played: 0 });
    expect(a.pair).not.toBe(b.pair);
  });

  it('je JSON-serializovatelné', () => {
    const levels = initialHandLevels();
    expect(JSON.parse(JSON.stringify(levels))).toEqual(levels);
  });

  it('úroveň 1 z initialHandLevels dá základ z tabulky', () => {
    const levels = initialHandLevels();
    for (const t of HAND_TYPES) expect(value(t, levels[t].level)).toEqual(TABLE[t].l1);
  });
});
