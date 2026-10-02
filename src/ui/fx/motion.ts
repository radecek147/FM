/**
 * Pohybové předvolby pro „šťávu“ (DESIGN 13.4 a 13.6): vypnuté animace, rychlost hry 1×–4× a
 * `prefers-reduced-motion`. Jediné místo, kde se pohybové předvolby skládají dohromady — částice, screen shake,
 * přechody obrazovek i fronta animací se ptají tady.
 *
 *   if (shakeAllowed(app.settings)) shaker.shake(0.4);
 *   const ms = scaledDuration(200, app.settings);   // 200 ms ÷ rychlost, zkrácené při reduced motion, 0 = vypnuto
 *
 * Pravidla:
 *  - animace vypnuté v nastavení → všechno okamžitě (0 ms), bez částic, bez shaku, bez přechodů,
 *  - rychlost 1–4 → délky ÷ rychlost,
 *  - `prefers-reduced-motion` → bez screen shaku, bez částic a pohybových přechodů; čekání ve frontě animací se
 *    zkrátí na `REDUCED_MOTION_FACTOR` (CSS animace zkracuje base.css).
 */

/** Čím se násobí délky animací při `prefers-reduced-motion` (zkrácení, ne vypnutí — hráč musí stihnout číst). */
export const REDUCED_MOTION_FACTOR = 0.5;

/** Co z nastavení pohyb ovlivňuje (podmnožina `Settings`). */
export interface MotionSettings {
  animations: boolean;
  /** 1–4 */
  speed: number;
  screenShake?: boolean;
}

let query: MediaQueryList | null | undefined;

/** Uživatel si v systému přeje omezit pohyb? (Jeden `MediaQueryList` — čtení nic nealokuje.) */
export function prefersReducedMotion(): boolean {
  if (query === undefined)
    query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return query?.matches ?? false;
}

/** Zapomene uložený `MediaQueryList` (testy, které podvrhují `matchMedia`). */
export function resetMotionQuery(): void {
  query = undefined;
}

/** Rychlost hry oříznutá na 1–4 (neplatná hodnota = 1). */
export function clampSpeed(speed: number): number {
  return Number.isFinite(speed) ? Math.min(4, Math.max(1, speed)) : 1;
}

/** Smí se něco hýbat (částice, přechody obrazovek)? */
export function motionAllowed(s: Pick<MotionSettings, 'animations'>): boolean {
  return s.animations && !prefersReducedMotion();
}

/** Smí se třást obrazovkou? Vypíná ho nastavení „screen shake“, vypnuté animace i `prefers-reduced-motion`. */
export function shakeAllowed(s: MotionSettings): boolean {
  return s.animations && s.screenShake !== false && !prefersReducedMotion();
}

/** Délka animace v ms podle rychlosti a reduced motion; 0 = animace vypnuté. */
export function scaledDuration(ms: number, s: Pick<MotionSettings, 'animations' | 'speed'>): number {
  if (!s.animations || ms <= 0) return 0;
  const factor = prefersReducedMotion() ? REDUCED_MOTION_FACTOR : 1;
  return Math.round((ms * factor) / clampSpeed(s.speed));
}

/** Rychlost hry z CSS proměnné `--speed` na `<html>` (pro moduly bez přístupu k nastavení — oznámení). */
export function documentSpeed(doc: Document | undefined = globalThis.document): number {
  if (!doc) return 1;
  return clampSpeed(Number.parseFloat(doc.documentElement.style.getPropertyValue('--speed')));
}

/** Jsou animace vypnuté podle stavu dokumentu (`html.no-anim` z nastavení nebo reduced motion)? */
export function documentMotionOff(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return true;
  return doc.documentElement.classList.contains('no-anim') || prefersReducedMotion();
}
