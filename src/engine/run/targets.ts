/** Cílová skóre útrat. Čísla viz docs/DESIGN.md (laděno simulací). */
import { BLIND_TARGET_MULT } from '../constants';
import type { BlindKind } from '../types';

/** Základ patra 1–8 pro křivky 1–3 (index křivky je 1-based). */
export const TARGET_CURVES: readonly (readonly number[])[] = [
  [250, 650, 1600, 4000, 9500, 20000, 40000, 80000],
  [250, 750, 2000, 5500, 14000, 32000, 70000, 150000],
  [250, 850, 2500, 7500, 20000, 50000, 115000, 250000],
];

/** Re-export pro starší importy — násobky útrat žijí v engine/constants.ts. */
export { BLIND_TARGET_MULT };
/** Výchozí násobek cíle šéfa (pokud `BossDef.targetMult` neurčí jinak). */
export const DEFAULT_BOSS_TARGET_MULT = BLIND_TARGET_MULT.boss;

/** Růst nekonečného režimu: g(a) = ENDLESS_GROWTH_BASE + ENDLESS_GROWTH_STEP × (a − 9). */
export const ENDLESS_GROWTH_BASE = 2.2;
export const ENDLESS_GROWTH_STEP = 0.15;

/**
 * „Hezké“ zaokrouhlení cílů (docs/DESIGN.md kap. 2.3.2): pod 100 na násobek 5, jinak na 2 platné
 * číslice; začíná-li číslo jedničkou, na 3 platné s krokem 5 (14 250 → 14 500, 375 → 380).
 */
export function niceRound(x: number): number {
  if (!Number.isFinite(x)) return Number.MAX_VALUE;
  if (x <= 0) return 0;
  if (x < 100) return Math.round(x / 5) * 5;
  let e = Math.floor(Math.log10(x));
  // Pojistka proti nepřesnosti log10 na hranách mocnin deseti.
  if (10 ** e > x) e--;
  else if (10 ** (e + 1) <= x) e++;
  let step = 10 ** (e - 1);
  if (Math.floor(x / 10 ** e) === 1) step /= 2;
  const out = Math.round(x / step) * step;
  return Number.isFinite(out) ? out : Number.MAX_VALUE;
}

/**
 * Základ patra. Patro < 1 (kupón „o patro zpět“) = 40 % prvního patra.
 * Nekonečný režim (patro a ≥ 9): base(a) = nice(base(8) × g(a)^(a − 8)), g(a) = 2,2 + 0,15 × (a − 9).
 */
export function anteBase(ante: number, curve: number): number {
  const c = TARGET_CURVES[Math.max(0, Math.min(TARGET_CURVES.length - 1, curve - 1))]!;
  if (ante < 1) return niceRound(c[0]! * 0.4);
  if (ante <= c.length) return c[ante - 1]!;
  const last = c.length;
  const g = ENDLESS_GROWTH_BASE + ENDLESS_GROWTH_STEP * (ante - (last + 1));
  return niceRound(c[last - 1]! * g ** (ante - last));
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
