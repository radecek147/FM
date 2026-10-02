/**
 * Přechody obrazovek (DESIGN 13.6): nová obrazovka se po vložení krátce objeví (~200 ms při 1×) — jen
 * `opacity` a `transform`, žádné změny layoutu. Router (`App.go`) zůstává synchronní: stará obrazovka zmizí hned,
 * nová je v DOM a má focus okamžitě, animuje se jen její vzhled.
 *
 *   const spec = screenTransition('collection', 'menu', app.settings);   // null = bez přechodu
 *   if (spec) el.animate(spec.keyframes, { duration: spec.duration, easing: spec.easing });
 *
 *  - z menu dál: přijede zprava, zpět do menu: zleva (posun 18 px + prolnutí),
 *  - herní obrazovka jen prolnutím (žádný posun — rozměry karet a žolíků sedí od prvního snímku, tažení i testy
 *    měří hned),
 *  - vypnuté animace nebo `prefers-reduced-motion` = bez přechodu; rychlost 1×–4× dělí délku.
 */
import { motionAllowed, scaledDuration, type MotionSettings } from './motion';

/** Délka přechodu při rychlosti 1× (ms). */
export const SCREEN_TRANSITION_MS = 200;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SHIFT_PX = 18;

export interface TransitionSpec {
  keyframes: Keyframe[];
  duration: number;
  easing: string;
}

/** Přechod na obrazovku `to` z `from` (null = první obrazovka), nebo null, když se přechod nemá hrát. */
export function screenTransition(
  to: string,
  from: string | null,
  settings: Pick<MotionSettings, 'animations' | 'speed'>,
): TransitionSpec | null {
  if (!from || from === to || !motionAllowed(settings)) return null;
  const duration = scaledDuration(SCREEN_TRANSITION_MS, settings);
  if (duration <= 0) return null;
  if (to === 'game' || from === 'game') {
    return { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration, easing: 'ease-out' };
  }
  const dx = to === 'menu' ? -SHIFT_PX : SHIFT_PX;
  return {
    keyframes: [
      { opacity: 0, transform: `translate3d(${dx}px, 0, 0)` },
      { opacity: 1, transform: 'none' },
    ],
    duration,
    easing: EASE_OUT,
  };
}

/**
 * Přehraje přechod na prvku obrazovky. Vrací animaci (nebo null — bez přechodu, prostředí bez Web Animations).
 * Výplň `backwards`: první snímek začne už průhledný (žádné probliknutí hotové obrazovky).
 */
export function playScreenTransition(el: HTMLElement, spec: TransitionSpec | null): Animation | null {
  if (!spec || typeof el.animate !== 'function') return null;
  try {
    return el.animate(spec.keyframes, { duration: spec.duration, easing: spec.easing, fill: 'backwards' });
  } catch {
    return null;
  }
}
