/**
 * Krátká oznámení („toasty“).
 *
 *   toast(t('settings.export.done'), { kind: 'success' })
 *   toast(t('errors.generic'), { kind: 'error' })
 *   setToastAnchor((needed) => ({ right: 8, top: 120, width: 340 }))   // místo pro sloupec; null = zpět do rohu
 *   holdToasts('busy', true)                                            // během animace pozdržet, pak vypustit
 *
 * - Oblast oznámení je mimo #app (router ji nemaže) a **pod modální vrstvou** (z-index pod dialogy): oznámení
 *   nikdy nepřekryje otevřený dialog. Oznámení „na pozadí“ (`background`: achievementy, odemčení) čekají, dokud je
 *   dialog otevřený; hláška, kterou vyvolala akce v dialogu (export, prodej z detailu žolíka), se ukáže v rohu okna
 *   nad zatemněním, ale mimo dialog (`toast-region--over-modal`).
 * - Umístění: bez kotvy vpravo dole; s kotvou (herní obrazovka) v rohu, který dodá kotva — mimo stůl, ruku,
 *   zboží a panely fází (src/ui/screens/game/index.ts). Prvky s `data-overlay-avoid` (bublina Štamgasta) sloupec
 *   obchází. Poloha se změří při každém novém oznámení, při změně velikosti okna a na vyžádání
 *   (`refreshToastPlacement`) — žádné čtení layoutu v animaci.
 * - Pozdržení (`holdToasts`): dokud trvá (animace skórování a dalších akcí), nová oznámení kromě chyb čekají ve
 *   frontě a vypustí se až po skončení — nepřekryjí skórování ani rozdávání.
 * - Fronta: nejvýš `MAX_VISIBLE` (3) naráz, nejnovější dole; když přijde další, nejstarší odejde. V rohu herní
 *   obrazovky nejvýš `MAX_VISIBLE_ANCHORED` (2) a další počkají, až některé odejde (chyba vytlačí nejstarší).
 *   Stejné oznámení znovu (např. opakovaná chyba) nepřibude, jen se obnoví jeho čas a naskočí počet „×2“.
 * - Rychlost hry (CSS `--speed`, 1×–4×) zkracuje výchozí dobu zobrazení (s dolní mezí, aby šlo dočíst), vypnuté
 *   animace (`html.no-anim`, prefers-reduced-motion) znamenají příchod i odchod bez animace.
 * - Chyby mají role="alert" (čtečka je přečte hned), ostatní jdou přes živou oblast `polite`.
 * - Animuje se jen transform/opacity (CSS třídy v screens.css, posun sloupce přes `translate`).
 */
import { t } from '../../i18n/cs';
import { h } from '../dom';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Doba zobrazení v ms (výchozí podle druhu a rychlosti hry). 0 = do zavření. */
  duration?: number;
  testId?: string;
  /** Tučný nadpis nad textem (jméno šéfa, název štítku). */
  title?: string;
  /** Obrázek místo ikony druhu (žeton šéfa, štítek) — dekorativní, text musí stačit sám. */
  media?: Node;
  /** Drobný štítek nad nadpisem („Achievement“, „Odemčeno · žolík“) — jen s `title`. */
  eyebrow?: string;
  className?: string;
  /**
   * Oznámení na pozadí (novinky meta vrstvy): počká, dokud je otevřený dialog, a nikdy se neukáže nad ním.
   * Bez příznaku jde o odezvu na akci hráče (ukáže se hned, i když je dialog otevřený).
   */
  background?: boolean;
  /** Zavoláno, když se oznámení opravdu ukáže (po případném pozdržení) — např. konfety z oznámení. */
  onShow?: (el: HTMLElement) => void;
  /** Zavoláno jednou, když oznámení odejde (vypršení, křížek, vytlačení novějším, `clearToasts`). */
  onClose?: () => void;
}

export interface ToastHandle {
  el: HTMLElement;
  dismiss(): void;
}

/**
 * Místo sloupce oznámení v souřadnicích okna: šířka a jedna vodorovná (`left` / `right`) a jedna svislá hrana
 * (`top` = sloupec roste dolů, `bottom` = roste nahoru) — vzdálenosti od okraje okna jako u `position: fixed`.
 */
export interface ToastSpot {
  width: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/** Kotva: funkce, která vrátí místo sloupce (dostane jeho výšku v px), nebo null = výchozí roh. */
export type ToastAnchor = (needed: number) => ToastSpot | null;

/** Nejvíc oznámení naráz — starší ustoupí. */
export const MAX_VISIBLE = 3;
/** V rohu herní obrazovky (kotva) nejvýš dvě — sloupec se vejde nad kapsu spotřebek. */
export const MAX_VISIBLE_ANCHORED = 2;
/** Nejvíc pozdržených oznámení — starší z fronty vypadnou (stejně by se jen přehnala přes obrazovku). */
const MAX_HELD = 8;
/** Výchozí doba zobrazení při rychlosti 1× (ms) — krátké, ať hlášky nevisí přes hru. */
const DEFAULT_DURATION: Record<ToastKind, number> = { info: 3200, success: 3200, warning: 4000, error: 5000 };
/** Nejkratší doba zobrazení i při rychlosti 4× (ms) — hláška se musí dát přečíst. */
const MIN_DURATION: Record<ToastKind, number> = { info: 2000, success: 2000, warning: 2500, error: 3500 };
const ICONS: Record<ToastKind, string> = { info: 'i', success: '✓', warning: '!', error: '✕' };
/** Odstup sloupce od okraje okna / kotvy (px). */
export const TOAST_ANCHOR_GAP = 8;
/** Nejužší sloupec, když ustupuje bublině Štamgasta do strany (px). */
const MIN_SIDE_WIDTH = 240;

interface ToastState {
  key: string;
  kind: ToastKind;
  count: number;
  duration: number;
  timer: ReturnType<typeof setTimeout> | null;
  gone: boolean;
  shown: boolean;
  background: boolean;
  countEl: HTMLElement;
  onShow?: ((el: HTMLElement) => void) | undefined;
  onClose?: (() => void) | undefined;
}

let region: HTMLElement | null = null;
let anchor: ToastAnchor | null = null;
let resizeBound = false;
const states = new WeakMap<HTMLElement, ToastState>();
const handles = new WeakMap<HTMLElement, ToastHandle>();
/** Aktivní důvody pozdržení (např. 'busy' = běží animace akce). */
const holds = new Set<string>();
/** Pozdržená oznámení v pořadí příchodu (prvky už postavené, ještě nevložené). */
let held: HTMLElement[] = [];

/** Rychlost hry z CSS proměnné `--speed` na <html> (nastavení, 1–4). */
function gameSpeed(): number {
  const raw = Number.parseFloat(document.documentElement.style.getPropertyValue('--speed'));
  return Number.isFinite(raw) ? Math.min(4, Math.max(1, raw)) : 1;
}

/** Jsou animace vypnuté (nastavení nebo prefers-reduced-motion)? */
function animationsOff(): boolean {
  if (document.documentElement.classList.contains('no-anim')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Je otevřený modální dialog (src/ui/components/modal.ts nastavuje `html.modal-open`)? */
function modalOpen(): boolean {
  return document.documentElement.classList.contains('modal-open');
}

/**
 * Výchozí doba zobrazení: při vyšší rychlosti hry kratší (÷ √rychlost), ale nikdy pod `MIN_DURATION`.
 * Čistá funkce (testy).
 */
export function toastDuration(kind: ToastKind, speed: number): number {
  const s = Math.min(4, Math.max(1, Number.isFinite(speed) ? speed : 1));
  return Math.max(MIN_DURATION[kind], Math.round(DEFAULT_DURATION[kind] / Math.sqrt(s)));
}

/** Oblast oznámení (vytvoří se při prvním použití). */
export function toastRegion(): HTMLElement {
  if (region && region.isConnected) return region;
  region = h('div', {
    class: 'toast-region',
    // Pojmenovaná oblast (landmark): `aria-label` na <div> bez role čtečky ignorují (axe aria-prohibited-attr).
    role: 'region',
    'aria-live': 'polite',
    'aria-label': t('common.notifications'),
    'data-testid': 'toasts',
  });
  document.body.appendChild(region);
  placeRegion();
  return region;
}

/** Kotva oznámení (herní obrazovka → roh mimo hrací plochu). `null` = výchozí umístění vpravo dole. */
export function setToastAnchor(next: ToastAnchor | null): void {
  anchor = next;
  if (next && !resizeBound && typeof window !== 'undefined') {
    resizeBound = true;
    window.addEventListener('resize', () => placeRegion(), { passive: true });
  }
  placeRegion();
}

/** Přepočítá polohu sloupce (např. když se pohnula bublina Štamgasta, kterou má obejít). */
export function refreshToastPlacement(): void {
  if (region && region.childElementCount > 0) placeRegion();
}

function clearPlacement(r: HTMLElement): void {
  r.classList.remove('toast-region--anchored');
  for (const p of ['left', 'right', 'top', 'bottom', 'width']) r.style.removeProperty(p);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Obdélníky prvků, které sloupec nemá zakrýt (bublina Štamgasta…). */
function avoidBoxes(): Box[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-avoid]'))
    .filter((el) => !el.hidden && el.getClientRects().length > 0)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
}

/**
 * Umístí oblast podle kotvy (jedno měření; volá se při novém oznámení, při změně velikosti okna a na vyžádání).
 * Nad otevřeným dialogem (odezva akce v dialogu) vždy v rohu okna.
 */
function placeRegion(): void {
  const r = region;
  if (!r) return;
  const overModal = modalOpen() && r.querySelector('.toast:not(.toast--leaving)') !== null;
  r.classList.toggle('toast-region--over-modal', overModal);
  const spot = !overModal && anchor ? anchor(r.childElementCount > 0 ? r.offsetHeight : 0) : null;
  if (!spot || !(spot.width >= 160)) {
    clearPlacement(r);
    return;
  }
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const fullWidth = Math.round(Math.min(spot.width, vw - 2 * TOAST_ANCHOR_GAP));
  const height = r.childElementCount > 0 ? r.offsetHeight : 0;
  let left = spot.left ?? vw - (spot.right ?? TOAST_ANCHOR_GAP) - fullWidth;
  let top = spot.top ?? vh - (spot.bottom ?? TOAST_ANCHOR_GAP) - height;
  // Bublina Štamgasta: sloupec ustoupí do strany (i za cenu užšího sloupce), jinak pod ni, nad ni, nebo k druhému
  // okraji okna.
  let width = fullWidth;
  const box = (): Box => ({ left, top, right: left + width, bottom: top + Math.max(height, 1) });
  for (const a of avoidBoxes()) {
    if (!intersects(box(), a)) continue;
    const roomRight = vw - TOAST_ANCHOR_GAP - (a.right + TOAST_ANCHOR_GAP);
    const roomLeft = a.left - TOAST_ANCHOR_GAP - TOAST_ANCHOR_GAP;
    const rightOfIt = left + width / 2 >= a.left + (a.right - a.left) / 2;
    if (rightOfIt && roomRight >= MIN_SIDE_WIDTH) {
      width = Math.round(Math.min(width, roomRight));
      left = a.right + TOAST_ANCHOR_GAP;
    } else if (!rightOfIt && roomLeft >= MIN_SIDE_WIDTH) {
      width = Math.round(Math.min(width, roomLeft));
      left = Math.min(left, a.left - TOAST_ANCHOR_GAP - width);
    } else if (a.bottom + TOAST_ANCHOR_GAP + height <= vh - TOAST_ANCHOR_GAP)
      top = a.bottom + TOAST_ANCHOR_GAP;
    else if (a.top - TOAST_ANCHOR_GAP - height >= TOAST_ANCHOR_GAP) top = a.top - TOAST_ANCHOR_GAP - height;
    else left = a.left >= vw - a.right ? TOAST_ANCHOR_GAP : vw - TOAST_ANCHOR_GAP - width;
  }
  left = Math.min(
    Math.max(TOAST_ANCHOR_GAP, left),
    Math.max(TOAST_ANCHOR_GAP, vw - width - TOAST_ANCHOR_GAP),
  );
  top = Math.max(TOAST_ANCHOR_GAP, top);
  r.classList.add('toast-region--anchored');
  r.style.width = `${width}px`;
  r.style.left = `${Math.round(left)}px`;
  r.style.removeProperty('right');
  if (spot.top === undefined) {
    // Sloupec roste nahoru od spodní hrany (pitva, výhra): odchod hlášky ho nenechá viset ve vzduchu.
    r.style.bottom = `${Math.round(Math.max(0, vh - top - height))}px`;
    r.style.removeProperty('top');
  } else {
    r.style.top = `${Math.round(top)}px`;
    r.style.removeProperty('bottom');
  }
}

/** Viditelná oznámení (bez odcházejících) od nejstaršího. */
function visibleToasts(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.toast:not(.toast--leaving)'));
}

/**
 * Změna obsahu sloupce s plynulým posunem ostatních oznámení (FLIP přes `translate`). Bez animací jen změna.
 */
function withFlip(container: HTMLElement, change: () => void): void {
  const items = animationsOff()
    ? []
    : Array.from(container.querySelectorAll<HTMLElement>('.toast')).filter(
        (el) => typeof el.animate === 'function',
      );
  const before = new Map(items.map((el) => [el, el.getBoundingClientRect().top]));
  change();
  if (items.length === 0) return;
  const duration = Math.round(180 / gameSpeed());
  for (const el of items) {
    if (!el.isConnected) continue;
    const dy = (before.get(el) ?? 0) - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    try {
      el.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration, easing: 'ease-out' });
    } catch {
      // Bez Web Animations se sloupec jen přeskládá.
    }
  }
}

function startTimer(st: ToastState, dismiss: () => void): void {
  if (st.timer) clearTimeout(st.timer);
  st.timer = st.duration > 0 ? setTimeout(dismiss, st.duration) : null;
}

/** Je roh herní obrazovky plný (kotva, nejvýš `MAX_VISIBLE_ANCHORED` hlášek)? Další počká, až některá odejde. */
function cornerFull(): boolean {
  if (!anchor || modalOpen() || !region || !region.classList.contains('toast-region--anchored')) return false;
  return visibleToasts(region).length >= MAX_VISIBLE_ANCHORED;
}

/**
 * Musí oznámení teď počkat (pozdržení, dialog, plný roh)? Chyby nečekají nikdy (v plném rohu vytlačí nejstarší).
 * V rohu herní obrazovky se hlášky řadí do fronty, místo aby se vytlačovaly — tři štítky naráz se ukážou postupně.
 */
function mustWait(st: Pick<ToastState, 'kind' | 'background'>): boolean {
  if (st.kind === 'error') return false;
  return holds.size > 0 || (st.background && modalOpen()) || cornerFull();
}

/** Vloží postavené oznámení do sloupce a spustí jeho čas. */
function show(el: HTMLElement): void {
  const st = states.get(el);
  const handle = handles.get(el);
  if (!st || !handle || st.gone || st.shown) return;
  st.shown = true;
  const container = toastRegion();
  withFlip(container, () => {
    container.appendChild(el);
    // Nejstarší oznámení ustoupí, když jich je moc (v rohu herní obrazovky dřív).
    const all = visibleToasts(container);
    const corner = anchor && !modalOpen() && container.classList.contains('toast-region--anchored');
    const max = corner ? MAX_VISIBLE_ANCHORED : MAX_VISIBLE;
    for (let i = 0; i < all.length - max; i++) {
      const old = all[i];
      if (old) (handles.get(old)?.dismiss ?? (() => old.remove()))();
    }
    // Umístění až s novou hláškou (výška sloupce); případný přesun sloupce plynule dorovná FLIP.
    placeRegion();
  });
  startTimer(st, handle.dismiss);
  st.onShow?.(el);
}

/** Vypustí pozdržená oznámení, která už smějí ven (po skončení animace / zavření dialogu). */
export function flushHeldToasts(): void {
  if (held.length === 0) {
    refreshToastPlacement();
    return;
  }
  const waiting: HTMLElement[] = [];
  for (const el of held) {
    const st = states.get(el);
    if (!st || st.gone) continue;
    if (mustWait(st)) waiting.push(el);
    else show(el);
  }
  held = waiting;
  refreshToastPlacement();
}

/**
 * Pozdrží (true) / pustí (false) oznámení z daného důvodu. Po posledním puštění se fronta vypustí.
 * Herní obrazovka drží 'busy' po dobu animace každé akce.
 */
export function holdToasts(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else if (holds.delete(reason) && holds.size === 0) flushHeldToasts();
}

/** Počet pozdržených oznámení (testy). */
export function heldToastCount(): number {
  return held.length;
}

export function toast(message: string, opts: ToastOptions = {}): ToastHandle {
  const kind = opts.kind ?? 'info';
  const container = toastRegion();
  const key = `${kind}\u0000${opts.title ?? ''}\u0000${message}`;
  const duration = opts.duration ?? toastDuration(kind, gameSpeed());
  const background = opts.background === true;

  // Stejné oznámení už visí (nebo čeká) → obnovit čas a ukázat počet místo dalšího oznámení.
  for (const existing of [...visibleToasts(container), ...held]) {
    const st = states.get(existing);
    if (!st || st.key !== key || st.gone) continue;
    st.count++;
    st.duration = duration;
    st.countEl.textContent = t('common.repeated', { n: st.count });
    st.countEl.hidden = false;
    const handle = handles.get(existing);
    if (!st.shown) {
      if (handle) return handle;
      continue;
    }
    existing.classList.remove('toast--bump');
    if (!animationsOff()) {
      // Vynucený reflow jen u opakovaného oznámení, aby se krátké „ťuknutí“ spustilo znovu.
      void existing.offsetWidth;
      existing.classList.add('toast--bump');
    }
    if (handle) {
      startTimer(st, handle.dismiss);
      return handle;
    }
  }

  const countEl = h('span', { class: 'toast__count', 'data-testid': 'toast-count', hidden: true });
  const st: ToastState = {
    key,
    kind,
    count: 1,
    duration,
    timer: null,
    gone: false,
    shown: false,
    background,
    countEl,
    onShow: opts.onShow,
    onClose: opts.onClose,
  };

  const remove = (): void => {
    held = held.filter((x) => x !== el);
    if (!el.isConnected) return;
    withFlip(container, () => el.remove());
  };
  const dismiss = (): void => {
    if (st.gone) return;
    st.gone = true;
    if (st.timer) clearTimeout(st.timer);
    st.onClose?.();
    // Uvolnilo se místo v rohu — čekající hláška smí ven (i během odchodu této).
    const flushSoon = (): void => {
      if (held.length > 0) queueMicrotask(() => flushHeldToasts());
    };
    // Bez animací (nebo ještě nevložené) pryč hned; jinak po krátké animaci (pojistka: timeout).
    if (animationsOff() || !el.isConnected) {
      remove();
      flushSoon();
      return;
    }
    el.classList.add('toast--leaving');
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 400);
    flushSoon();
  };

  const el = h(
    'div',
    {
      class: [
        'toast',
        `toast--${kind}`,
        opts.media ? 'toast--media' : '',
        background ? 'toast--background' : '',
        opts.className,
      ],
      role: kind === 'error' ? 'alert' : 'status',
      'data-testid': opts.testId ?? `toast-${kind}`,
    },
    opts.media
      ? h('span', { class: 'toast__media', 'aria-hidden': 'true' }, opts.media)
      : h('span', { class: 'toast__icon', 'aria-hidden': 'true' }, ICONS[kind]),
    opts.title
      ? h(
          'div',
          { class: 'toast__body' },
          opts.eyebrow ? h('p', { class: 'toast__eyebrow' }, opts.eyebrow) : null,
          h('p', { class: 'toast__title' }, opts.title),
          h('p', { class: 'toast__text' }, message),
        )
      : h('p', { class: 'toast__text' }, message),
    countEl,
    h(
      'button',
      { type: 'button', class: 'toast__close', 'aria-label': t('common.dismiss'), onClick: dismiss },
      h('span', { 'aria-hidden': 'true' }, '×'),
    ),
  );
  states.set(el, st);
  const handle: ToastHandle = { el, dismiss };
  handles.set(el, handle);

  if (mustWait(st)) {
    held.push(el);
    // Přeplněná fronta: nejstarší pozdržené oznámení vypadne (jeho `onClose` posune frontu meta vrstvy).
    while (held.length > MAX_HELD) {
      const old = held[0];
      if (old) (handles.get(old)?.dismiss ?? (() => held.shift()))();
      else held.shift();
    }
    return handle;
  }
  show(el);
  return handle;
}

/** Zavře oznámení (viditelná i pozdržená), pro která `match` vrátí true. */
export function dismissToasts(match: (el: HTMLElement) => boolean): void {
  const all = [...(region ? visibleToasts(region) : []), ...held];
  for (const el of all) if (match(el)) handles.get(el)?.dismiss();
}

/** Zavře všechna oznámení i pozdržená (např. při resetu profilu). */
export function clearToasts(): void {
  const closed: (() => void)[] = [];
  const all = [...(region ? Array.from(region.querySelectorAll<HTMLElement>('.toast')) : []), ...held];
  for (const el of all) {
    const st = states.get(el);
    if (st && !st.gone) {
      st.gone = true;
      if (st.timer) clearTimeout(st.timer);
      if (st.onClose) closed.push(st.onClose);
    }
  }
  held = [];
  region?.replaceChildren();
  // Až po vyčištění — fronta (např. oznámení meta vrstvy) smí hned ukázat další.
  for (const fn of closed) fn();
}
