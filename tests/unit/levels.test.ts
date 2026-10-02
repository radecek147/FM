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
  high_card: { l1: [6, 1], l2: [30, 3], l5: [102, 9], p1: 6, p5: 918 },
  pair: { l1: [12, 2], l2: [40, 4], l5: [124, 10], p1: 24, p5: 1240 },
  two_pair: { l1: [24, 2], l2: [60, 4], l5: [168, 10], p1: 48, p5: 1680 },
  three: { l1: [28, 3], l2: [72, 7], l5: [204, 19], p1: 84, p5: 3876 },
  straight: { l1: [35, 4], l2: [85, 8], l5: [235, 20], p1: 140, p5: 4700 },
  flush: { l1: [40, 4], l2: [76, 8], l5: [184, 20], p1: 160, p5: 3680 },
  full_house: { l1: [45, 5], l2: [101, 9], l5: [269, 21], p1: 225, p5: 5649 },
  four: { l1: [65, 6], l2: [135, 12], l5: [345, 30], p1: 390, p5: 10350 },
  straight_flush: { l1: [90, 9], l2: [170, 15], l5: [410, 33], p1: 810, p5: 13530 },
  royal_flush: { l1: [120, 10], l2: [210, 16], l5: [480, 34], p1: 1200, p5: 16320 },
  five: { l1: [110, 11], l2: [190, 17], l5: [430, 35], p1: 1210, p5: 15050 },
  flush_house: { l1: [130, 13], l2: [220, 21], l5: [490, 45], p1: 1690, p5: 22050 },
  flush_five: { l1: [150, 15], l2: [260, 21], l5: [590, 39], p1: 2250, p5: 23010 },
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
