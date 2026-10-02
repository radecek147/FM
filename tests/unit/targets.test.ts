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
      [4, 2200, 3300, 4400],
      [5, 4300, 6500, 8600],
      [6, 7800, 11500, 15500],
      [7, 13500, 20000, 27000],
      [8, 21000, 32000, 42000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 550, 830, 1100],
      [3, 1100, 1650, 2200],
      [4, 2300, 3500, 4600],
      [5, 4500, 6800, 9000],
      [6, 8000, 12000, 16000],
      [7, 14000, 21000, 28000],
      [8, 23000, 35000, 46000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 550, 830, 1100],
      [3, 1150, 1750, 2300],
      [4, 2400, 3600, 4800],
      [5, 4700, 7100, 9400],
      [6, 8600, 13000, 17000],
      [7, 15500, 23000, 31000],
      [8, 26000, 39000, 52000],
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
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(95000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 46_000, 69_000, 92_000, 51_000, 100_000, 57_000, 115_000],
    [10, 115_000, 175_000, 230_000, 125_000, 250_000, 145_000, 290_000],
    [11, 330_000, 500_000, 660_000, 360_000, 720_000, 410_000, 820_000],
    [12, 1_050_000, 1_600_000, 2_100_000, 1_150_000, 2_300_000, 1_300_000, 2_600_000],
    [13, 3_600_000, 5_400_000, 7_200_000, 4_000_000, 8_000_000, 4_500_000, 9_000_000],
    [14, 14_000_000, 21_000_000, 28_000_000, 15_000_000, 30_000_000, 17_000_000, 34_000_000],
    [15, 58_000_000, 87_000_000, 115_000_000, 63_000_000, 125_000_000, 72_000_000, 145_000_000],
    [16, 260_000_000, 390_000_000, 520_000_000, 290_000_000, 580_000_000, 320_000_000, 640_000_000],
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
