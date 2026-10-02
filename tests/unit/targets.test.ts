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
      [2, 550, 830, 1100],
      [3, 1100, 1650, 2200],
      [4, 2700, 4100, 5400],
      [5, 6700, 10000, 13500],
      [6, 16500, 25000, 33000],
      [7, 41000, 62000, 82000],
      [8, 100000, 150000, 200000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 550, 830, 1100],
      [3, 1200, 1800, 2400],
      [4, 3200, 4800, 6400],
      [5, 8000, 12000, 16000],
      [6, 20000, 30000, 40000],
      [7, 49000, 74000, 98000],
      [8, 120000, 180000, 240000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 600, 900, 1200],
      [3, 1300, 1950, 2600],
      [4, 3700, 5600, 7400],
      [5, 9400, 14000, 19000],
      [6, 22000, 33000, 44000],
      [7, 56000, 84000, 110000],
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
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(450000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 220_000, 330_000, 440_000, 260_000, 520_000, 310_000, 620_000],
    [10, 550_000, 830_000, 1_100_000, 660_000, 1_300_000, 770_000, 1_550_000],
    [11, 1_550_000, 2_300_000, 3_100_000, 1_900_000, 3_800_000, 2_200_000, 4_400_000],
    [12, 4_900_000, 7_400_000, 9_800_000, 5_900_000, 12_000_000, 6_900_000, 14_000_000],
    [13, 17_000_000, 26_000_000, 34_000_000, 21_000_000, 42_000_000, 24_000_000, 48_000_000],
    [14, 66_000_000, 99_000_000, 130_000_000, 79_000_000, 160_000_000, 92_000_000, 185_000_000],
    [15, 280_000_000, 420_000_000, 560_000_000, 330_000_000, 660_000_000, 390_000_000, 780_000_000],
    [16, 1_250_000_000, 1_900_000_000, 2_500_000_000, 1_500_000_000, 3_000_000_000, 1_750_000_000, 3_500_000_000],
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
