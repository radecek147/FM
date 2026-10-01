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
      [2, 650, 980, 1300],
      [3, 1600, 2400, 3200],
      [4, 4000, 6000, 8000],
      [5, 9500, 14500, 19000],
      [6, 20000, 30000, 40000],
      [7, 40000, 60000, 80000],
      [8, 80000, 120000, 160000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 750, 1150, 1500],
      [3, 2000, 3000, 4000],
      [4, 5500, 8300, 11000],
      [5, 14000, 21000, 28000],
      [6, 32000, 48000, 64000],
      [7, 70000, 105000, 140000],
      [8, 150000, 230000, 300000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 850, 1300, 1700],
      [3, 2500, 3800, 5000],
      [4, 7500, 11500, 15000],
      [5, 20000, 30000, 40000],
      [6, 50000, 75000, 100000],
      [7, 115000, 175000, 230000],
      [8, 250000, 380000, 500000],
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
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(360000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 175_000, 260_000, 350_000, 330_000, 660_000, 550_000, 1_100_000],
    [10, 440_000, 660_000, 880_000, 830_000, 1_650_000, 1_400_000, 2_800_000],
    [11, 1_250_000, 1_900_000, 2_500_000, 2_300_000, 4_600_000, 3_900_000, 7_800_000],
    [12, 3_900_000, 5_900_000, 7_800_000, 7_400_000, 15_000_000, 12_500_000, 25_000_000],
    [13, 14_000_000, 21_000_000, 28_000_000, 26_000_000, 52_000_000, 43_000_000, 86_000_000],
    [14, 53_000_000, 80_000_000, 105_000_000, 99_000_000, 200_000_000, 165_000_000, 330_000_000],
    [15, 220_000_000, 330_000_000, 440_000_000, 410_000_000, 820_000_000, 690_000_000, 1_400_000_000],
    [16, 1e9, 1.5e9, 2e9, 1.85e9, 3.7e9, 3.1e9, 6.2e9],
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
