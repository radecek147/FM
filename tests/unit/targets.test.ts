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
      [5, 4200, 6300, 8400],
      [6, 7500, 11500, 15000],
      [7, 13000, 19500, 26000],
      [8, 22000, 33000, 44000],
    ],
    2: [
      [1, 250, 380, 500],
      [2, 600, 900, 1200],
      [3, 1200, 1800, 2400],
      [4, 2500, 3800, 5000],
      [5, 4900, 7400, 9800],
      [6, 9000, 13500, 18000],
      [7, 16000, 24000, 32000],
      [8, 27000, 41000, 54000],
    ],
    3: [
      [1, 250, 380, 500],
      [2, 650, 980, 1300],
      [3, 1300, 1950, 2600],
      [4, 2800, 4200, 5600],
      [5, 5800, 8700, 11500],
      [6, 11000, 16500, 22000],
      [7, 20000, 30000, 40000],
      [8, 35000, 53000, 70000],
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
    expect(blindTarget(8, 'boss', 1, { bossMult: 4.5 })).toBe(99000);
    expect(blindTarget(1, 'small', 1, { targetMult: 1.5 })).toBe(380);
  });

  it('patro 0 (kupón „o patro zpět“) = 40 % prvního patra', () => {
    expect(anteBase(0, 1)).toBe(100);
  });
});

describe('nekonečný režim (docs/DESIGN.md kap. 2.3.3)', () => {
  // [patro, křivka 1: malá, velká, šéf, křivka 2: malá, šéf, křivka 3: malá, šéf]
  const rows: [number, number, number, number, number, number, number, number][] = [
    [9, 48_000, 72_000, 96_000, 59_000, 120_000, 77_000, 155_000],
    [10, 120_000, 180_000, 240_000, 150_000, 300_000, 195_000, 390_000],
    [11, 340_000, 510_000, 680_000, 420_000, 840_000, 550_000, 1_100_000],
    [12, 1_100_000, 1_650_000, 2_200_000, 1_350_000, 2_700_000, 1_750_000, 3_500_000],
    [13, 3_800_000, 5_700_000, 7_600_000, 4_600_000, 9_200_000, 6_000_000, 12_000_000],
    [14, 14_500_000, 22_000_000, 29_000_000, 18_000_000, 36_000_000, 23_000_000, 46_000_000],
    [15, 61_000_000, 92_000_000, 120_000_000, 74_000_000, 150_000_000, 96_000_000, 190_000_000],
    [16, 270_000_000, 410_000_000, 540_000_000, 340_000_000, 680_000_000, 440_000_000, 880_000_000],
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
