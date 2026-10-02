/**
 * Krátká oznámení („toasty“) v pravém dolním rohu.
 *
 *   toast(t('settings.export.done'), { kind: 'success' })
 *   toast(t('errors.generic'), { kind: 'error' })
 *
 * Oblast oznámení je mimo #app (router ji nemaže) a mimo modální vrstvu (zůstává klikací).
 * Chyby mají role="alert" (čtečka je přečte hned), ostatní jdou přes živou oblast `polite`.
 * Animuje se jen transform/opacity (CSS třídy v screens.css).
 */
import { t } from '../../i18n/cs';
import { h } from '../dom';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Doba zobrazení v ms (výchozí 4 s, chyba 6 s). 0 = do zavření. */
  duration?: number;
  testId?: string;
  /** Tučný nadpis nad textem (jméno šéfa, název štítku). */
  title?: string;
  /** Obrázek místo ikony druhu (žeton šéfa, štítek) — dekorativní, text musí stačit sám. */
  media?: Node;
  className?: string;
}

export interface ToastHandle {
  el: HTMLElement;
  dismiss(): void;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION: Record<ToastKind, number> = { info: 4000, success: 4000, warning: 5000, error: 6000 };
const ICONS: Record<ToastKind, string> = { info: 'i', success: '✓', warning: '!', error: '✕' };

let region: HTMLElement | null = null;

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
  return region;
}

export function toast(message: string, opts: ToastOptions = {}): ToastHandle {
  const kind = opts.kind ?? 'info';
  const container = toastRegion();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gone = false;

  const dismiss = (): void => {
    if (gone) return;
    gone = true;
    if (timer) clearTimeout(timer);
    el.classList.add('toast--leaving');
    // Po krátké animaci pryč; bez animací (nebo když událost nepřijde) zajistí odstranění timeout.
    const remove = (): void => el.remove();
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
          h('p', { class: 'toast__title' }, opts.title),
          h('p', { class: 'toast__text' }, message),
        )
      : h('p', { class: 'toast__text' }, message),
    h(
      'button',
      { type: 'button', class: 'toast__close', 'aria-label': t('common.dismiss'), onClick: dismiss },
      h('span', { 'aria-hidden': 'true' }, '×'),
    ),
  );

  container.appendChild(el);
  // Nejstarší oznámení ustoupí, když jich je moc.
  const all = container.querySelectorAll<HTMLElement>('.toast:not(.toast--leaving)');
  for (let i = 0; i < all.length - MAX_VISIBLE; i++) all[i]?.remove();

  const duration = opts.duration ?? DEFAULT_DURATION[kind];
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { el, dismiss };
}

/** Zavře všechna oznámení (např. při resetu profilu). */
export function clearToasts(): void {
  region?.replaceChildren();
}
