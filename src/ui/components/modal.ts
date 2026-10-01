/**
 * Přístupný modální dialog.
 *
 *   const m = openModal({ title: t('settings.title'), body: panel, actions: [...] });
 *   await m.closed;
 *   if (await confirmModal({ title, message, confirmLabel, danger: true })) { … }
 *
 * - role="dialog", aria-modal, aria-labelledby (nadpis), aria-describedby (volitelně),
 * - focus trap (Tab / Shift+Tab kolují uvnitř), Esc zavře (když `dismissible`), návrat focusu,
 * - zbytek stránky je `inert` (žádný klik ani focus za dialogem), dialogy lze vrstvit (stack),
 * - klávesy z dialogu se nešíří dál — obrazovky (App.onKey) je nedostanou, takže třeba Enter
 *   na tlačítku dialogu nezahraje ruku.
 */
import { t } from '../../i18n/cs';
import type { Child } from '../dom';
import { h } from '../dom';
import type { ButtonVariant } from './button';
import { button } from './button';

export interface ModalAction<T> {
  label: string;
  /** Hodnota, se kterou se dialog zavře. Když `onClick` vrátí false, dialog zůstane otevřený. */
  value?: T;
  onClick?: () => boolean | void;
  variant?: ButtonVariant;
  testId?: string;
  /** Výchozí focus po otevření. */
  autofocus?: boolean;
}

export interface ModalOptions<T> {
  title: string;
  /** Obsah dialogu; funkce dostane `close`. */
  body?: Child | ((close: (result?: T) => void) => Child);
  /** Text popisu (aria-describedby) — zobrazí se nad obsahem. */
  description?: string;
  actions?: ModalAction<T>[];
  /** Esc, křížek a klik na pozadí dialog zavřou (výchozí true). */
  dismissible?: boolean;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  testId?: string;
  /** Element (nebo selektor uvnitř dialogu), který dostane focus po otevření. */
  initialFocus?: HTMLElement | string;
  onClose?: (result: T | undefined) => void;
}

export interface ModalHandle<T> {
  /** Kořen vrstvy (pozadí + dialog). */
  el: HTMLElement;
  /** Element s role="dialog". */
  dialog: HTMLElement;
  body: HTMLElement;
  close(result?: T): void;
  readonly closed: Promise<T | undefined>;
  readonly isOpen: boolean;
}

interface StackEntry {
  layer: HTMLElement;
  dialog: HTMLElement;
  dismissible: boolean;
  close: () => void;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack: StackEntry[] = [];
let uid = 0;
let globalListener = false;

function top(): StackEntry | undefined {
  return stack[stack.length - 1];
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

/** Tab / Shift+Tab kolují mezi prvky dialogu. */
function trapTab(e: KeyboardEvent, dialog: HTMLElement): void {
  const items = focusables(dialog);
  if (items.length === 0) {
    e.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && dialog.contains(active);
  if (e.shiftKey && (active === first || !inside || active === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

function handleKey(e: KeyboardEvent, entry: StackEntry): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (entry.dismissible) entry.close();
  } else if (e.key === 'Tab') {
    trapTab(e, entry.dialog);
  }
}

/**
 * Klávesy mimo dialog (focus utekl na <body>, např. po kliknutí na pozadí): Tab vrátí focus do dialogu,
 * Esc zavře a nic dalšího se k obrazovce pod dialogem nedostane.
 */
function onDocumentKeyCapture(e: KeyboardEvent): void {
  const entry = top();
  if (!entry) return;
  if (e.target instanceof Node && entry.layer.contains(e.target)) return;
  if (e.target instanceof Node && (e.target as Element).closest?.('.toast-region')) return;
  e.stopPropagation();
  handleKey(e, entry);
}

/** Zneaktivní všechno v <body> kromě dané vrstvy a oznámení; vrátí funkci, která to vrátí zpět. */
function inertOthers(layer: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (const child of [...document.body.children]) {
    if (!(child instanceof HTMLElement) || child === layer) continue;
    if (child.classList.contains('toast-region') || child.inert) continue;
    child.inert = true;
    changed.push(child);
  }
  return () => {
    for (const el of changed) el.inert = false;
  };
}

export function openModal<T = unknown>(opts: ModalOptions<T>): ModalHandle<T> {
  const id = ++uid;
  const titleId = `modal-title-${id}`;
  const descId = `modal-desc-${id}`;
  const dismissible = opts.dismissible ?? true;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let open = true;
  let resolveClosed: (v: T | undefined) => void = () => undefined;
  const closed = new Promise<T | undefined>((resolve) => (resolveClosed = resolve));

  const close = (result?: T): void => {
    if (!open) return;
    open = false;
    const idx = stack.indexOf(entry);
    if (idx >= 0) stack.splice(idx, 1);
    restoreInert();
    layer.remove();
    if (stack.length === 0) document.documentElement.classList.remove('modal-open');
    if (returnFocus && returnFocus.isConnected && !returnFocus.closest('[inert]'))
      returnFocus.focus({ preventScroll: true });
    else top()?.dialog.focus();
    opts.onClose?.(result);
    resolveClosed(result);
  };

  const body = h(
    'div',
    { class: 'modal__body' },
    typeof opts.body === 'function' ? opts.body(close) : opts.body,
  );

  const actions = (opts.actions ?? []).map((a) =>
    button({
      label: a.label,
      variant: a.variant ?? 'paper',
      testId: a.testId,
      autofocus: a.autofocus,
      onClick: () => {
        if (a.onClick?.() === false) return;
        close(a.value);
      },
    }),
  );

  const dialog = h(
    'div',
    {
      class: ['modal', `modal--${opts.size ?? 'medium'}`, opts.className ?? ''],
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': opts.description ? descId : undefined,
      tabindex: '-1',
    },
    h(
      'header',
      { class: 'modal__header' },
      h('h2', { id: titleId, class: 'modal__title' }, opts.title),
      dismissible
        ? h(
            'button',
            {
              type: 'button',
              class: 'modal__close',
              'aria-label': t('common.close'),
              'data-testid': 'modal-close',
              onClick: () => close(),
            },
            h('span', { 'aria-hidden': 'true' }, '×'),
          )
        : null,
    ),
    opts.description ? h('p', { id: descId, class: 'modal__description' }, opts.description) : null,
    body,
    actions.length > 0 ? h('footer', { class: 'modal__actions' }, actions) : null,
  );

  const layer = h(
    'div',
    { class: 'modal-layer', 'data-testid': opts.testId ?? 'modal' },
    h('div', {
      class: 'modal-backdrop',
      'aria-hidden': 'true',
      onClick: () => {
        if (dismissible) close();
      },
    }),
    dialog,
  );

  const entry: StackEntry = { layer, dialog, dismissible, close: () => close() };

  // Klávesy z dialogu: Esc/Tab zpracuj, nic nepouštěj dál k obrazovce (App poslouchá na document).
  layer.addEventListener('keydown', (e) => {
    if (top() !== entry) return;
    e.stopPropagation();
    handleKey(e, entry);
  });

  if (!globalListener) {
    document.addEventListener('keydown', onDocumentKeyCapture, true);
    globalListener = true;
  }

  document.body.appendChild(layer);
  const restoreInert = inertOthers(layer);
  stack.push(entry);
  document.documentElement.classList.add('modal-open');

  // Výchozí focus: initialFocus → autofocus akce → první prvek obsahu → dialog.
  const initial =
    typeof opts.initialFocus === 'string'
      ? dialog.querySelector<HTMLElement>(opts.initialFocus)
      : (opts.initialFocus ?? null);
  const target =
    initial ??
    dialog.querySelector<HTMLElement>('[data-autofocus]') ??
    focusables(body)[0] ??
    actions[0] ??
    dialog;
  target.focus({ preventScroll: true });

  return {
    el: layer,
    dialog,
    body,
    close,
    closed,
    get isOpen() {
      return open;
    },
  };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Nebezpečná akce (červené potvrzovací tlačítko, focus na Zrušit). */
  danger?: boolean;
  testId?: string;
}

/** Potvrzovací dialog — vrátí true jen při potvrzení (Esc, křížek i pozadí = false). */
export async function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  const m = openModal<boolean>({
    title: opts.title,
    description: opts.message,
    size: 'small',
    testId: opts.testId ?? 'confirm',
    actions: [
      {
        label: opts.cancelLabel ?? t('common.cancel'),
        value: false,
        variant: 'ghost',
        testId: 'confirm-cancel',
        autofocus: opts.danger === true,
      },
      {
        label: opts.confirmLabel ?? t('common.confirm'),
        value: true,
        variant: opts.danger ? 'danger' : 'primary',
        testId: 'confirm-ok',
        autofocus: opts.danger !== true,
      },
    ],
  });
  return (await m.closed) === true;
}

/** Je otevřený nějaký dialog? */
export function isModalOpen(): boolean {
  return stack.length > 0;
}

/** Zavře všechny dialogy (např. při odchodu z obrazovky). */
export function closeAllModals(): void {
  while (stack.length > 0) top()?.close();
}
