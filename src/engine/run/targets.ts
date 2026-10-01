/** Cílová skóre útrat. Čísla viz docs/DESIGN.md (laděno simulací). */
import type { BlindKind } from '../types';

/** Základ patra 1–8 pro křivky 1–3 (index křivky je 1-based). */
export const TARGET_CURVES: readonly (readonly number[])[] = [
  [250, 650, 1600, 4000, 9500, 20000, 40000, 80000],
  [250, 750, 2000, 5500, 14000, 32000, 70000, 150000],
  [250, 850, 2500, 7500, 20000, 50000, 115000, 250000],
];

export const BLIND_TARGET_MULT: Record<Exclude<BlindKind, 'boss'>, number> = { small: 1, big: 1.5 };
export const DEFAULT_BOSS_TARGET_MULT = 2;

/** Zaokrouhlí na „hezké“ číslo: pod 1000 na desítky, jinak na 3 platné číslice (2 nad milion). */
export function niceRound(x: number): number {
  if (!Number.isFinite(x)) return Number.MAX_VALUE;
  if (x < 1000) return Math.max(10, Math.round(x / 10) * 10);
  const digits = Math.floor(Math.log10(x)) + 1;
  const sig = x >= 1e6 ? 2 : 3;
  const factor = 10 ** (digits - sig);
  return Math.round(x / factor) * factor;
}

/** Základ patra. Patro < 1 (kupón „o patro zpět“) = 40 % prvního patra. Nekonečný režim od patra 9. */
export function anteBase(ante: number, curve: number): number {
  const c = TARGET_CURVES[Math.max(0, Math.min(TARGET_CURVES.length - 1, curve - 1))]!;
  if (ante < 1) return niceRound(c[0]! * 0.4);
  if (ante <= c.length) return c[ante - 1]!;
  let v = c[c.length - 1]!;
  for (let a = c.length + 1; a <= ante; a++) {
    v *= 2.2 + 0.15 * (a - (c.length + 1));
    if (!Number.isFinite(v)) return Number.MAX_VALUE;
  }
  return niceRound(v);
}

/** Cíl útraty: základ × násobek útraty (šéf: vlastní násobek) × Modifiers.targetMult. */
export function blindTarget(
  ante: number,
  kind: BlindKind,
  curve: number,
  opts: { bossMult?: number; targetMult?: number } = {},
): number {
  const kindMult = kind === 'boss' ? (opts.bossMult ?? DEFAULT_BOSS_TARGET_MULT) : BLIND_TARGET_MULT[kind];
  return niceRound(anteBase(ante, curve) * kindMult * (opts.targetMult ?? 1));
}
