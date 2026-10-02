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
      [5, 6500, 9800, 13000],
      [6, 16000, 24000, 32000],
      [7, 39000, 59000, 78000],
      [8, 95000, 145000, 190000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 550, 830, 1100],
      [3, 1200, 1800, 2400],
      [4, 3100, 4700, 6200],
      [5, 7500, 11500, 15000],
      [6, 18500, 28000, 37000],
      [7, 45000, 68000, 90000],
      [8, 110000, 165000, 220000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 600, 900, 1200],
      [3, 1300, 1950, 2600],
      [4, 3300, 5000, 6600],
      [5, 7800, 11500, 15500],
      [6, 19000, 29000, 38000],
      [7, 47000, 71000, 94000],
      [8, 115000, 175000, 230000],
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
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(430000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 210_000, 320_000, 420_000, 240_000, 480_000, 250_000, 500_000],
    [10, 520_000, 780_000, 1_050_000, 610_000, 1_200_000, 640_000, 1_300_000],
    [11, 1_500_000, 2_300_000, 3_000_000, 1_700_000, 3_400_000, 1_800_000, 3_600_000],
    [12, 4_700_000, 7_100_000, 9_400_000, 5_400_000, 11_000_000, 5_700_000, 11_500_000],
    [13, 16_500_000, 25_000_000, 33_000_000, 19_000_000, 38_000_000, 20_000_000, 40_000_000],
    [14, 63_000_000, 95_000_000, 125_000_000, 72_000_000, 145_000_000, 76_000_000, 150_000_000],
    [15, 260_000_000, 390_000_000, 520_000_000, 300_000_000, 600_000_000, 320_000_000, 640_000_000],
    [
      16, 1_200_000_000, 1_800_000_000, 2_400_000_000, 1_350_000_000, 2_700_000_000, 1_450_000_000,
      2_900_000_000,
    ],
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
