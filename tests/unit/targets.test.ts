import { describe, expect, it } from 'vitest';
import { anteBase, blindTarget, niceRound, TARGET_CURVES } from '../../src/engine/run/targets';

describe('niceRound (docs/DESIGN.md kap. 2.3.2)', () => {
  it.each([
    [0, 0],
    [42, 40],
    [43, 45],
    [99, 100],
    [100, 100],
    [375, 380],
    [975, 980],
    [1125, 1150],
    [1300, 1300],
    [8250, 8300],
    [11250, 11500],
    [14250, 14500],
    [115000, 115000],
    [172500, 175000],
    [995_762_000, 1_000_000_000],
  ])('nice(%d) = %d', (x, expected) => {
    expect(niceRound(x)).toBe(expected);
  });

  it('přesné mocniny deseti zůstávají beze změny', () => {
    for (let e = 2; e <= 20; e++) expect(niceRound(10 ** e)).toBe(10 ** e);
  });

  it('nekonečno a přetečení vrací Number.MAX_VALUE', () => {
    expect(niceRound(Infinity)).toBe(Number.MAX_VALUE);
    expect(niceRound(Number.NaN)).toBe(Number.MAX_VALUE);
  });
});

describe('cíle pater 1–8 (docs/DESIGN.md kap. 2.3.1)', () => {
  // [patro, malá, velká, šéf] pro každou křivku — přepis tabulky z DESIGN.md.
  const table: Record<number, [number, number, number, number][]> = {
    1: [
      [1, 250, 380, 500],
      [2, 600, 900, 1200],
      [3, 1300, 1950, 2600],
      [4, 3600, 5400, 7200],
      [5, 9400, 14000, 19000],
      [6, 23000, 35000, 46000],
      [7, 53000, 80000, 105000],
      [8, 105000, 160000, 210000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 600, 900, 1200],
      [3, 1400, 2100, 2800],
      [4, 4100, 6200, 8200],
      [5, 11000, 16500, 22000],
      [6, 27000, 41000, 54000],
      [7, 61000, 92000, 120000],
      [8, 120000, 180000, 240000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 650, 980, 1300],
      [3, 1550, 2300, 3100],
      [4, 4700, 7100, 9400],
      [5, 12500, 19000, 25000],
      [6, 31000, 47000, 62000],
      [7, 70000, 105000, 140000],
      [8, 140000, 210000, 280000],
    ],
  };

  it('engine má 3 křivky po 8 patrech', () => {
    expect(TARGET_CURVES).toHaveLength(3);
    for (const c of TARGET_CURVES) expect(c).toHaveLength(8);
  });

  for (const [curve, rows] of Object.entries(table)) {
    it.each(rows)(`křivka ${curve}, patro %d: %d / %d / %d`, (ante, small, big, boss) => {
      const c = Number(curve);
      expect(anteBase(ante, c)).toBe(small);
      expect(blindTarget(ante, 'small', c)).toBe(small);
      expect(blindTarget(ante, 'big', c)).toBe(big);
      expect(blindTarget(ante, 'boss', c)).toBe(boss);
    });
  }

  it('násobek šéfa a Modifiers.targetMult se zaokrouhlí přes nice()', () => {
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(470000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 160_000, 240_000, 320_000, 180_000, 360_000, 210_000, 420_000],
    [10, 250_000, 380_000, 500_000, 280_000, 560_000, 330_000, 660_000],
    [11, 410_000, 620_000, 820_000, 460_000, 920_000, 540_000, 1_100_000],
    [12, 700_000, 1_050_000, 1_400_000, 800_000, 1_600_000, 930_000, 1_850_000],
    [13, 1_250_000, 1_900_000, 2_500_000, 1_400_000, 2_800_000, 1_650_000, 3_300_000],
    [14, 2_300_000, 3_500_000, 4_600_000, 2_700_000, 5_400_000, 3_100_000, 6_200_000],
    [15, 4_500_000, 6_800_000, 9_000_000, 5_100_000, 10_000_000, 6_000_000, 12_000_000],
    [16, 9_000_000, 13_500_000, 18_000_000, 10_500_000, 21_000_000, 12_000_000, 24_000_000],
  ];

  it.each(rows)('patro %d', (ante, s1, b1, boss1, s2, boss2, s3, boss3) => {
    expect(blindTarget(ante, 'small', 1)).toBe(s1);
    expect(blindTarget(ante, 'big', 1)).toBe(b1);
    expect(blindTarget(ante, 'boss', 1)).toBe(boss1);
    expect(blindTarget(ante, 'small', 2)).toBe(s2);
    expect(blindTarget(ante, 'boss', 2)).toBe(boss2);
    expect(blindTarget(ante, 'small', 3)).toBe(s3);
    expect(blindTarget(ante, 'boss', 3)).toBe(boss3);
  });

  it('cíle rostou monotónně a při přetečení se zastaví na Number.MAX_VALUE', () => {
    let prev = 0;
    for (let ante = 1; ante <= 400; ante++) {
      const target = blindTarget(ante, 'small', 1);
      expect(target).toBeGreaterThanOrEqual(prev);
      expect(Number.isFinite(target)).toBe(true);
      prev = target;
    }
    expect(prev).toBe(Number.MAX_VALUE);
  });
});
