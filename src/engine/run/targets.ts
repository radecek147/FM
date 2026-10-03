/** Cílová skóre útrat. Čísla viz docs/DESIGN.md (laděno simulací). */
import { BLIND_TARGET_MULT } from '../constants';
import type { BlindKind } from '../types';

/**
 * Základ patra 1–8 pro křivky 1–3 (index křivky je 1-based). Kalibrace 1.0.1 (docs/DECISIONS.md 2026-10-03): patra 4–7
 * o 35–45 % výš a patro 8 o ~10 % (křivka 1: 2 700 / 6 500 / 16 000 / 39 000 / 95 000 → 3 600 / 9 400 / 23 000 / 53 000
 * / 105 000) — dřív se patra 1–5 vyhrávala první rukou a patro 8 bylo zeď (49 % proher runů, které ho dosáhly); křivka 3
 * je o ~15 % nad křivkou 2, aby Bock nebyl prázdný krok proti Ležáku. Hodnoty musí být „hezká“ čísla (`niceRound`).
 */
export const TARGET_CURVES: readonly (readonly number[])[] = [
  [250, 600, 1300, 3600, 9400, 23000, 53000, 105000],
  [250, 600, 1400, 4100, 11000, 27000, 61000, 120000],
  [250, 650, 1550, 4700, 12500, 31000, 70000, 140000],
];

/** Re-export pro starší importy — násobky útrat žijí v engine/constants.ts. */
export { BLIND_TARGET_MULT };
/** Výchozí násobek cíle šéfa (pokud `BossDef.targetMult` neurčí jinak). */
export const DEFAULT_BOSS_TARGET_MULT = BLIND_TARGET_MULT.boss;

/**
 * Růst nekonečného režimu: g(a) = ENDLESS_GROWTH_BASE + ENDLESS_GROWTH_STEP × (a − 9), base(a) = base(8) × g(a)^(a − 8).
 * Kalibrace 1.0.1 (docs/DECISIONS.md 2026-10-03): 1,5 + 0,035 × (a − 9) — mírný začátek (patro 9 ×1,5 proti patru 8,
 * patro 16 ×2 za patro), pak zrychluje (patro 30 ×3,1 za patro, základ 5,1e12 — „Tepelná smrt vesmíru“ je extrémní, ale
 * ne nemožná). S 2,3 + 0,01 × (a − 9) padal vítězný build botů v patře 9–10 (medián), s 2,2 + 0,15 × (a − 9) (do 1.0)
 * v patře 10–11 a patro 30 bylo nedosažitelné.
 */
export const ENDLESS_GROWTH_BASE = 1.5;
export const ENDLESS_GROWTH_STEP = 0.035;

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
 * Nekonečný režim (patro a ≥ 9): base(a) = nice(base(8) × g(a)^(a − 8)), g(a) = 1,5 + 0,035 × (a − 9).
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
