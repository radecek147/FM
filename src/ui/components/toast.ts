/**
 * Krátká oznámení („toasty“).
 *
 *   toast(t('settings.export.done'), { kind: 'success' })
 *   toast(t('errors.generic'), { kind: 'error' })
 *   setToastAnchor(stage)              // sloupec nahoře uprostřed prvku; null = zpět do rohu
 *   setToastAnchor((needed) => rect)   // nebo obdélník spočítaný až při umístění podle výšky sloupce (hra)
 *
 * - Oblast oznámení je mimo #app (router ji nemaže) a mimo modální vrstvu (zůstává klikací).
 * - Umístění: bez kotvy vpravo dole; s kotvou (herní obrazovka → jeviště nad stolem; u panelu Večerky či obálky
 *   volné místo pod panelem, když se tam sloupec celý vejde, jinak hned pod záhlavím) sloupec nahoře uprostřed
 *   kotvy, aby se hlášky nevršily přes ruku, tlačítka a balíček. Poloha se změří při každém novém oznámení a při
 *   změně velikosti okna (žádné čtení layoutu v animaci).
 * - Fronta: nejvýš `MAX_VISIBLE` (3) naráz, nejnovější dole; když přijde další, nejstarší odejde. Stejné oznámení
 *   znovu (např. opakovaná chyba) nepřibude, jen se obnoví jeho čas a naskočí počet „×2“.
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
  /** Zavoláno jednou, když oznámení odejde (vypršení, křížek, vytlačení novějším, `clearToasts`). */
  onClose?: () => void;
}

export interface ToastHandle {
  el: HTMLElement;
  dismiss(): void;
}

/** Nejvíc oznámení naráz — starší ustoupí. */
export const MAX_VISIBLE = 3;
/** Výchozí doba zobrazení při rychlosti 1× (ms). */
const DEFAULT_DURATION: Record<ToastKind, number> = { info: 4000, success: 4000, warning: 5000, error: 6000 };
/** Nejkratší doba zobrazení i při rychlosti 4× (ms) — hláška se musí dát přečíst. */
const MIN_DURATION: Record<ToastKind, number> = { info: 2200, success: 2200, warning: 2800, error: 4000 };
const ICONS: Record<ToastKind, string> = { info: 'i', success: '✓', warning: '!', error: '✕' };
/** Odstup sloupce od horního okraje kotvy (px). */
export const TOAST_ANCHOR_GAP = 8;
/** Nejširší sloupec v kotvě (px) — užší než oblast v rohu, ať nezakryje tlačítka v záhlaví panelů. */
const ANCHOR_MAX_WIDTH = 384;

interface ToastState {
  key: string;
  count: number;
  duration: number;
  timer: ReturnType<typeof setTimeout> | null;
  gone: boolean;
  countEl: HTMLElement;
  onClose?: (() => void) | undefined;
}

let region: HTMLElement | null = null;
/**
 * Kotva: prvek, nebo funkce, která vrátí obdélník (v souřadnicích okna) až při umístění. Funkce dostane výšku
 * sloupce (px, i s odcházejícími hláškami), aby ho mohla dát tam, kde se celý vejde.
 */
export type ToastAnchor = HTMLElement | ((needed: number) => DOMRect | null);

let anchor: ToastAnchor | null = null;
let resizeBound = false;
const states = new WeakMap<HTMLElement, ToastState>();
const handles = new WeakMap<HTMLElement, ToastHandle>();

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
    'aria-live': 'polite',
    'aria-label': t('common.notifications'),
    'data-testid': 'toasts',
  });
  document.body.appendChild(region);
  placeRegion();
  return region;
}

/**
 * Kotva oznámení: sloupec nahoře uprostřed prvku / obdélníku (herní obrazovka → jeviště nad stolem). `null` =
 * výchozí umístění vpravo dole (menu, nastavení).
 */
export function setToastAnchor(next: ToastAnchor | null): void {
  anchor = next;
  if (next && !resizeBound && typeof window !== 'undefined') {
    resizeBound = true;
    window.addEventListener('resize', () => placeRegion(), { passive: true });
  }
  placeRegion();
}

/** Umístí oblast podle kotvy (jedno měření; volá se při novém oznámení a při změně velikosti okna). */
function placeRegion(): void {
  const r = region;
  if (!r) return;
  const a = anchor;
  const first = typeof a === 'function' ? a(0) : a?.isConnected ? a.getBoundingClientRect() : null;
  // Kotva mimo stránku nebo bez rozměrů (skrytá, test bez layoutu) → výchozí roh.
  if (!first || first.width < 160 || first.height <= 0) {
    r.classList.remove('toast-region--anchored');
    r.style.removeProperty('left');
    r.style.removeProperty('top');
    r.style.removeProperty('width');
    return;
  }
  const width = Math.min(ANCHOR_MAX_WIDTH, first.width - 2 * TOAST_ANCHOR_GAP);
  r.classList.add('toast-region--anchored');
  r.style.width = `${Math.round(width)}px`;
  // Kotva-funkce dostane výšku sloupce v jeho šířce (jedno měření) a může ho posunout tam, kde se celý vejde.
  const rect = typeof a === 'function' && r.childElementCount > 0 ? (a(r.offsetHeight) ?? first) : first;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  // Jeviště odscrollované nahoru (telefon) → sloupec u horního okraje okna.
  const top = Math.min(
    Math.max(TOAST_ANCHOR_GAP, rect.top + TOAST_ANCHOR_GAP),
    Math.max(TOAST_ANCHOR_GAP, vh - 160),
  );
  r.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  r.style.top = `${Math.round(top)}px`;
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

export function toast(message: string, opts: ToastOptions = {}): ToastHandle {
  const kind = opts.kind ?? 'info';
  const container = toastRegion();
  const key = `${kind}\u0000${opts.title ?? ''}\u0000${message}`;
  const duration = opts.duration ?? toastDuration(kind, gameSpeed());

  // Stejné oznámení už visí → obnovit čas a ukázat počet místo dalšího oznámení.
  for (const existing of visibleToasts(container)) {
    const st = states.get(existing);
    if (!st || st.key !== key) continue;
    st.count++;
    st.duration = duration;
    st.countEl.textContent = t('common.repeated', { n: st.count });
    st.countEl.hidden = false;
    existing.classList.remove('toast--bump');
    if (!animationsOff()) {
      // Vynucený reflow jen u opakovaného oznámení, aby se krátké „ťuknutí“ spustilo znovu.
      void existing.offsetWidth;
      existing.classList.add('toast--bump');
    }
    const handle = handles.get(existing);
    if (handle) {
      startTimer(st, handle.dismiss);
      return handle;
    }
  }

  const countEl = h('span', { class: 'toast__count', 'data-testid': 'toast-count', hidden: true });
  const st: ToastState = {
    key,
    count: 1,
    duration,
    timer: null,
    gone: false,
    countEl,
    onClose: opts.onClose,
  };

  const remove = (): void => {
    if (!el.isConnected) return;
    withFlip(container, () => el.remove());
  };
  const dismiss = (): void => {
    if (st.gone) return;
    st.gone = true;
    if (st.timer) clearTimeout(st.timer);
    st.onClose?.();
    // Bez animací pryč hned; jinak po krátké animaci (pojistka: timeout, kdyby `animationend` nepřišel).
    if (animationsOff()) {
      remove();
      return;
    }
    el.classList.add('toast--leaving');
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 400);
  };

  const el = h(
    'div',
    {
      class: ['toast', `toast--${kind}`, opts.media ? 'toast--media' : '', opts.className],
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

  withFlip(container, () => {
    container.appendChild(el);
    // Nejstarší oznámení ustoupí, když jich je moc.
    const all = visibleToasts(container);
    for (let i = 0; i < all.length - MAX_VISIBLE; i++) {
      const old = all[i];
      if (old) (handles.get(old)?.dismiss ?? (() => old.remove()))();
    }
    // Umístění až s novou hláškou (výška sloupce); případný přesun sloupce plynule dorovná FLIP.
    placeRegion();
  });

  startTimer(st, dismiss);
  return handle;
}

/** Zavře všechna oznámení (např. při resetu profilu). */
export function clearToasts(): void {
  if (!region) return;
  const closed: (() => void)[] = [];
  for (const el of Array.from(region.querySelectorAll<HTMLElement>('.toast'))) {
    const st = states.get(el);
    if (st && !st.gone) {
      st.gone = true;
      if (st.timer) clearTimeout(st.timer);
      if (st.onClose) closed.push(st.onClose);
    }
  }
  region.replaceChildren();
  // Až po vyčištění — fronta (např. oznámení meta vrstvy) smí hned ukázat další.
  for (const fn of closed) fn();
}
