/**
 * Pomocníci pro tlačítka (jednotný vzhled, přístupnost, „Už brzy“ položky).
 *
 *   button({ label: t('menu.newGame.label'), onClick: () => app.go('newGame'), variant: 'primary' })
 *   backButton(() => app.go('menu'))
 *
 * Neaktivní položka „Už brzy“ (`comingSoon`) zůstává fokusovatelná (aria-disabled), aby šel přečíst
 * tooltip i popisek; klik na ni volá `onComingSoon` místo `onClick`.
 */
import { t } from '../../i18n/cs';
import type { Child } from '../dom';
import { h } from '../dom';

export type ButtonVariant = 'primary' | 'paper' | 'ghost' | 'danger';
export type ButtonSize = 'small' | 'normal' | 'large';

export interface ButtonOptions {
  label: Child;
  onClick?: (e: MouseEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** Text tooltipu „Už brzy…“ — tlačítko je pak aria-disabled a klik volá `onComingSoon`. */
  comingSoon?: string;
  onComingSoon?: () => void;
  title?: string;
  ariaLabel?: string;
  /** Id elementu s popisem (aria-describedby). */
  describedBy?: string;
  testId?: string;
  className?: string;
  /** Označí výchozí focus (data-autofocus — dialog si ho po otevření najde; atribut autofocus nepoužíváme,
   * protože na dynamicky vloženém obsahu jen hlásí varování do konzole). */
  autofocus?: boolean;
  /** Krátká cedulka vpravo (např. „Už brzy“). */
  badge?: string;
}

export function button(opts: ButtonOptions): HTMLButtonElement {
  const soon = opts.comingSoon !== undefined;
  const classes = [
    'btn',
    `btn--${opts.variant ?? 'paper'}`,
    opts.size && opts.size !== 'normal' ? `btn--${opts.size}` : '',
    soon ? 'btn--soon' : '',
    opts.className ?? '',
  ];
  const btn = h(
    'button',
    {
      type: opts.type ?? 'button',
      class: classes,
      disabled: opts.disabled === true,
      'aria-disabled': soon ? true : undefined,
      title: opts.comingSoon ?? opts.title,
      'aria-label': opts.ariaLabel,
      'aria-describedby': opts.describedBy,
      'data-testid': opts.testId,
      'data-autofocus': opts.autofocus === true ? 'true' : undefined,
      onClick: (e: MouseEvent) => {
        if (soon) {
          e.preventDefault();
          opts.onComingSoon?.();
          return;
        }
        opts.onClick?.(e);
      },
    },
    h('span', { class: 'btn__label' }, opts.label),
    opts.badge ? h('span', { class: 'btn__badge', 'aria-hidden': 'true' }, opts.badge) : null,
  );
  return btn;
}

/** Tlačítko „Zpět“ (šipka je jen ozdoba, čtečky přečtou popisek). */
export function backButton(
  onClick: () => void,
  label: string = t('common.back'),
  testId = 'back',
): HTMLButtonElement {
  return button({
    label: [h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '‹'), label],
    onClick,
    variant: 'ghost',
    size: 'small',
    testId,
    className: 'btn--back',
  });
}

/** Zapne/vypne tlačítko (skutečný `disabled`). */
export function setButtonDisabled(btn: HTMLButtonElement, disabled: boolean): void {
  btn.disabled = disabled;
}

/**
 * Dá prvku focus hned po vložení obrazovky do stránky. Router (`App.go`) fokusuje první `h1` / tlačítko
 * v pořadí dokumentu; obrazovka, která chce focus jinde (první položka menu, vybraný balíček), si ho vezme
 * v mikroúloze po `mount`.
 */
export function focusWhenMounted(el: HTMLElement): void {
  queueMicrotask(() => {
    if (el.isConnected) el.focus({ preventScroll: true });
  });
}
