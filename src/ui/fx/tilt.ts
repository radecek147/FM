/**
 * Jemný 3D náklon karty za ukazatelem myši + odlesk (DESIGN 13.6): jen CSS proměnné, které čte `transform`
 * vnitřku karty (`--tilt-x`, `--tilt-y`) a odlesku (`--glare-x`, `--glare-y`) — styles/cards.css.
 *
 *   bindTilt(cardEl);                    // hrací karta (.pcard__inner)
 *   bindTilt(jokerEl, { max: 7 });       // žolík (.kcard__inner — vnitřek se při překreslení mění, hledá se znovu)
 *
 * Výkon: nejvýš jeden zápis za snímek (requestAnimationFrame) a rozměry karty se měří jen při najetí / stisku —
 * pohyb myši nevynucuje přepočet layoutu. Dotyk se nenaklání (na dotyku žádný „hover“), tažená karta také ne.
 * Vypnuté animace a `prefers-reduced-motion` náklon vypnou (návrat je plynulý přechodem z CSS).
 */
import { documentMotionOff } from './motion';

export interface TiltOptions {
  /** Největší náklon ve stupních u okraje karty (kolem svislé osy; kolem vodorovné ~0,8×). Výchozí 6. */
  max?: number;
}

/** Vnitřek karty (přímý potomek — u žolíka se při překreslení vymění). */
function innerOf(el: HTMLElement): HTMLElement | null {
  for (const child of el.children)
    if (child.classList.contains('pcard__inner') || child.classList.contains('kcard__inner'))
      return child as HTMLElement;
  return null;
}

/** Je karta (nebo její obal v řadě) právě tažená? */
function dragging(el: HTMLElement): boolean {
  return el.classList.contains('is-dragging') || !!el.parentElement?.classList.contains('is-dragging');
}

/** Naváže náklon na kartu. Vrací odpojení. */
export function bindTilt(el: HTMLElement, opts: TiltOptions = {}): () => void {
  const maxY = opts.max ?? 6;
  const maxX = maxY * 0.82;
  let rect: DOMRect | null = null;
  let last: { x: number; y: number } | null = null;
  let frame = 0;
  let inner: HTMLElement | null = null;
  let off = false;

  const clear = (): void => {
    if (!inner) return;
    inner.style.removeProperty('--tilt-x');
    inner.style.removeProperty('--tilt-y');
    inner.style.removeProperty('--glare-x');
    inner.style.removeProperty('--glare-y');
    inner.classList.remove('is-tilted');
    inner = null;
  };

  const apply = (): void => {
    frame = 0;
    if (!last || off) return;
    rect ??= el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const current = innerOf(el);
    if (current !== inner) clear();
    inner = current;
    if (!inner) return;
    const dx = Math.min(0.5, Math.max(-0.5, (last.x - rect.left) / rect.width - 0.5));
    const dy = Math.min(0.5, Math.max(-0.5, (last.y - rect.top) / rect.height - 0.5));
    inner.style.setProperty('--tilt-x', `${(-dy * 2 * maxX).toFixed(2)}deg`);
    inner.style.setProperty('--tilt-y', `${(dx * 2 * maxY).toFixed(2)}deg`);
    inner.style.setProperty('--glare-x', `${(dx * 50).toFixed(1)}%`);
    inner.style.setProperty('--glare-y', `${(dy * 50).toFixed(1)}%`);
    inner.classList.add('is-tilted');
  };

  const reset = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    rect = null;
    clear();
  };

  // Najetí a stisk (výběr kartu povytáhne) = změřit znovu; animace se ověří jednou za najetí.
  const onEnter = (e: PointerEvent): void => {
    rect = null;
    off = e.pointerType === 'touch' || documentMotionOff();
  };
  const onDown = (): void => {
    rect = null;
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || off) return;
    // Tažená karta (přesun v ruce / řadě žolíků) se nenaklání — změřený obdélník by s posunem neseděl.
    if (dragging(el)) {
      if (last) reset();
      return;
    }
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  };

  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointercancel', reset);
  return () => {
    reset();
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', reset);
    el.removeEventListener('pointercancel', reset);
  };
}
