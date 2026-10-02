/**
 * Přesun položek v řadě tažením myší i prstem — řada žolíků i ruka (DESIGN 13.2–13.3).
 *
 *   const sorter = attachDragSort(list, {
 *     item: (target) => target.closest<HTMLElement>('.gt-item'),
 *     canStart: () => !controller.busy,
 *     onDrop: (ordered) => void ctx.act({ type: 'reorderJokers', uids: ordered.map(uidOf) }),
 *   });
 *   if (sorter.dragging) return; // obrazovka se během tažení nepřekresluje
 *
 * - Krátký klik / tap zůstává obyčejným klikem (výběr karty, detail žolíka). Tažení začne až po posunu o práh
 *   (myš 6 px, prst 10 px); klik, který po tažení následuje, se pohltí — kromě „neopatrného kliku“ (posun pod
 *   `CLICK_SLOP` a puštění na původním místě).
 * - Jen transform: posun přes CSS vlastnost `translate` (skládá se s `transform` karty — výběr ji povytáhne),
 *   rozměry se změří jednou na začátku, ostatní položky uhýbají (`is-shifting` s přechodem v CSS).
 * - Po puštění se uzly přeskládají hned (žádné probliknutí do starého pořadí), puštěná položka dosedne
 *   (`settle`) a zavolá se `onDrop`. `pointercancel` (prohlížeč převzal posouvání) tažení zruší beze změny.
 * - Třídy: kontejner `is-sorting`, tažená položka `is-dragging`, uhýbající `is-shifting`.
 */

/** Posun (px), od kterého je stisk tažením (myš / dotyk). */
export const DRAG_THRESHOLD_MOUSE = 6;
export const DRAG_THRESHOLD_TOUCH = 10;
/**
 * Tah, který skončil na původním místě a nikdy nebyl dál než tolik px, je „neopatrný klik“: klik projde (výběr karty
 * se nesmí ztratit jen proto, že se ruka při kliknutí o pár pixelů pohnula).
 */
export const CLICK_SLOP = 16;

export interface DragSortOptions {
  /** Přetahovatelná položka pro cíl události — přímé dítě kontejneru, nebo null. */
  item(target: Element): HTMLElement | null;
  /** Smí tažení začít? Ptá se až po překročení prahu (do té doby je stisk obyčejný klik). */
  canStart(): boolean;
  /** Puštěno na jiné místo: položky v novém pořadí (DOM už je přeskládaný), přesunutá položka a její index. */
  onDrop(ordered: HTMLElement[], moved: HTMLElement, to: number): void;
  /** Tažení právě začalo (schovat tooltip…). */
  onStart?(el: HTMLElement): void;
  /** Dosednutí puštěné položky: `dx` = o kolik px byla při puštění vedle svého nového místa. */
  settle?(el: HTMLElement, dx: number): void;
}

export interface DragSort {
  /** Probíhá tažení? (Obrazovka se mezitím nepřekresluje.) */
  readonly dragging: boolean;
  dispose(): void;
}

interface DragState {
  pointerId: number;
  el: HTMLElement;
  startX: number;
  startY: number;
  started: boolean;
  touch: boolean;
  items: HTMLElement[];
  centers: number[];
  from: number;
  to: number;
  /** Vzdálenost sousedních položek — o tolik uhne položka, přes kterou se táhne. */
  shift: number;
  /** Největší vzdálenost od místa stisku (px) — rozliší tah od neopatrného kliku. */
  maxDist: number;
}

/**
 * Cílový index tažené položky: kolik ostatních položek má střed vlevo od jejího aktuálního středu.
 * Čistá funkce (testy).
 */
export function dropIndex(centers: readonly number[], from: number, dx: number): number {
  const center = (centers[from] ?? 0) + dx;
  let to = 0;
  centers.forEach((cx, i) => {
    if (i !== from && cx < center) to++;
  });
  return to;
}

/** Posun položky `i` (px), zatímco se tažená položka přesouvá z `from` na `to`. Čistá funkce (testy). */
export function shiftFor(i: number, from: number, to: number, shift: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -shift;
  if (from > to && i < from && i >= to) return shift;
  return 0;
}

/** Pole s prvkem přesunutým z `from` na `to` (ostatní se posunou). Čistá funkce (testy). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [moved] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, moved as T);
  return out;
}

export function attachDragSort(container: HTMLElement, opts: DragSortOptions): DragSort {
  let drag: DragState | null = null;
  let suppressClick = false;

  const suppressNextClick = (): void => {
    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 0);
  };

  const itemsOf = (): HTMLElement[] =>
    Array.from(container.children).filter(
      (n): n is HTMLElement => n instanceof HTMLElement && opts.item(n) === n,
    );

  const resetStyles = (d: DragState): void => {
    for (const el of d.items) {
      el.style.translate = '';
      el.classList.remove('is-dragging', 'is-shifting');
    }
    container.classList.remove('is-sorting');
  };

  const onDown = (e: PointerEvent): void => {
    if (drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target instanceof Element ? opts.item(e.target) : null;
    if (!el || el.parentElement !== container) return;
    drag = {
      pointerId: e.pointerId,
      el,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      touch: e.pointerType === 'touch',
      items: [],
      centers: [],
      from: 0,
      to: 0,
      shift: 0,
      maxDist: 0,
    };
  };

  const start = (d: DragState, e: PointerEvent): boolean => {
    const items = itemsOf();
    const from = items.indexOf(d.el);
    if (items.length < 2 || from < 0 || !opts.canStart()) return false;
    // Jediné měření za celé tažení (žádné čtení layoutu během pohybu).
    const rects = items.map((el) => el.getBoundingClientRect());
    d.started = true;
    d.items = items;
    d.centers = rects.map((r) => r.left + r.width / 2);
    d.from = from;
    d.to = from;
    const first = rects[0];
    const second = rects[1];
    d.shift = first && second ? second.left - first.left : (rects[from]?.width ?? 0);
    d.el.classList.add('is-dragging');
    container.classList.add('is-sorting');
    try {
      d.el.setPointerCapture(e.pointerId);
    } catch {
      // Některé prohlížeče capture odmítnou — tažení funguje i bez něj, dokud je ukazatel nad řadou.
    }
    opts.onStart?.(d.el);
    return true;
  };

  const onMove = (e: PointerEvent): void => {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dist = Math.hypot(dx, e.clientY - d.startY);
    d.maxDist = Math.max(d.maxDist, dist);
    if (!d.started) {
      if (dist < (d.touch ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE)) return;
      if (!start(d, e)) {
        drag = null;
        return;
      }
    }
    e.preventDefault();
    d.el.style.translate = `${dx}px 0`;
    const to = dropIndex(d.centers, d.from, dx);
    if (to === d.to) return;
    d.to = to;
    d.items.forEach((el, i) => {
      if (i === d.from) return;
      const offset = shiftFor(i, d.from, to, d.shift);
      el.classList.add('is-shifting');
      el.style.translate = offset ? `${offset}px 0` : '';
    });
  };

  const end = (e: PointerEvent, cancelled: boolean): void => {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    drag = null;
    if (!d.started) return;
    if (cancelled || d.to === d.from) {
      // Puštěno na původním místě: položka dosedne zpátky (zrušený tah skočí rovnou).
      const back = !cancelled && opts.settle ? d.el.getBoundingClientRect().left : null;
      resetStyles(d);
      if (back !== null) {
        const dx = back - d.el.getBoundingClientRect().left;
        if (Math.abs(dx) >= 1) opts.settle?.(d.el, dx);
      }
      // Neopatrný klik (krátký posun a zpátky na místě) projde jako klik; skutečný tah klik pohltí.
      if (cancelled || d.maxDist >= CLICK_SLOP) suppressNextClick();
      return;
    }
    // Klik, který po tažení následuje, nesmí vybrat kartu ani otevřít detail.
    suppressNextClick();
    const before = d.el.getBoundingClientRect().left;
    resetStyles(d);
    const ordered = moveItem(d.items, d.from, d.to);
    // Přeskládat hned (žádné probliknutí do starého pořadí), pak akce.
    ordered.forEach((node, i) => {
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] ?? null);
    });
    if (opts.settle) {
      const dx = before - d.el.getBoundingClientRect().left;
      if (Math.abs(dx) >= 1) opts.settle(d.el, dx);
    }
    opts.onDrop(ordered, d.el, d.to);
  };

  const onUp = (e: PointerEvent): void => end(e, false);
  const onCancel = (e: PointerEvent): void => end(e, true);
  const onLostCapture = (e: PointerEvent): void => {
    // Jen ztráta capture, které jsme nastavili na položku. Dotyk má implicitní capture na prvku pod prstem
    // (SVG v kartě) — `setPointerCapture` ho přesune na položku a ten prvek dostane `lostpointercapture`, který
    // tažení ukončit nesmí (jinak by se na dotykových zařízeních tažení hned po startu zrušilo).
    if (drag?.started && e.pointerId === drag.pointerId && e.target === drag.el) end(e, false);
  };
  // Zachycení kliku po tažení (fáze capture — dřív než klik položky).
  const onClick = (e: MouseEvent): void => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onCancel);
  container.addEventListener('lostpointercapture', onLostCapture);
  container.addEventListener('click', onClick, true);

  return {
    get dragging() {
      return drag?.started === true;
    },
    dispose() {
      if (drag?.started) resetStyles(drag);
      drag = null;
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onCancel);
      container.removeEventListener('lostpointercapture', onLostCapture);
      container.removeEventListener('click', onClick, true);
    },
  };
}
