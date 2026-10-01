/**
 * Hlavní menu: Nová hra, Pokračovat (jen s uloženým runem), Výzvy / Denní run / Sbírka / Statistiky
 * („Už brzy“ — fáze 8), Nastavení, Titulky; náhodná rada Štamgasta, verze a kontrolní věta pro font.
 * Ovládání: Tab / šipky nahoru a dolů mezi položkami, Enter / mezerník aktivuje.
 */
import { version } from '../../../package.json';
import { t, tList } from '../../i18n/cs';
import type { App, ScreenFactory } from '../app';
import { button, focusWhenMounted } from '../components/button';
import { toast } from '../components/toast';
import { GameController } from '../controller';
import { h } from '../dom';

/** Fáze, ve které přibudou zatím neaktivní položky (ROADMAP: Fáze 8 — Meta). */
const META_PHASE = 8;

/** Náhodná rada (UI smí použít Math.random — náhoda enginu jde výhradně přes seedovaný RNG). */
function pickTip(tips: readonly string[], previous?: string): string | null {
  if (tips.length === 0) return null;
  if (tips.length === 1) return tips[0] ?? null;
  let tip = previous;
  while (tip === previous) tip = tips[Math.floor(Math.random() * tips.length)];
  return tip ?? null;
}

/** Je k dispozici rozehraný run (v paměti, nebo v úložišti)? */
export function hasContinuableRun(app: App): boolean {
  const c = app.controller;
  if (c && c.state.phase !== 'game_over') return true;
  return GameController.hasSavedRun(app.store);
}

/** Pokračuje v rozehraném runu: nejdřív ten v paměti, jinak obnoví uložený. Vrací false, když není co. */
export function continueRun(app: App): boolean {
  let c = app.controller && app.controller.state.phase !== 'game_over' ? app.controller : null;
  c ??= GameController.resume({ registry: app.registry, store: app.store });
  if (!c) return false;
  app.controller = c;
  app.go('game');
  return true;
}

export const menuScreen: ScreenFactory = (app) => {
  const tips = tList('loadingTips');
  let tip = pickTip(tips);
  const soon = t('menu.comingSoon', { phase: META_PHASE });
  const notifySoon = (): void => void toast(soon, { kind: 'info' });

  const hintEl = h('p', { class: 'menu__hint', 'aria-hidden': 'true' }, t('menu.newGame.hint'));

  /** Položka menu s popiskem (aria-describedby) a nápovědou na tabuli při najetí / fokusu. */
  const item = (
    id: string,
    opts: {
      onClick?: () => void;
      primary?: boolean;
      disabled?: boolean;
      soon?: boolean;
    },
  ): HTMLElement => {
    const hintId = `menu-hint-${id}`;
    const hint = t(`menu.${id}.hint`);
    const btn = button({
      label: t(`menu.${id}.label`),
      variant: opts.primary ? 'primary' : 'paper',
      size: 'large',
      testId: `menu-${id.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
      describedBy: hintId,
      disabled: opts.disabled,
      onClick: opts.onClick,
      ...(opts.soon ? { comingSoon: soon, onComingSoon: notifySoon, badge: t('menu.comingSoonBadge') } : {}),
      className: 'menu__item',
    });
    const show = (): void => {
      hintEl.textContent = opts.soon ? `${hint} ${soon}` : hint;
    };
    btn.addEventListener('pointerenter', show);
    btn.addEventListener('focus', show);
    return h('li', null, btn, h('span', { id: hintId, class: 'visually-hidden' }, hint));
  };

  const canContinue = hasContinuableRun(app);

  const tipText = h('span', { class: 'menu__tip-text', 'data-testid': 'loading-tip' }, tip ?? '');
  const tipEl = tip
    ? h(
        'aside',
        { class: 'menu__tip', 'aria-labelledby': 'menu-tip-label' },
        h('span', { id: 'menu-tip-label', class: 'menu__tip-label' }, t('app.tipLabel')),
        tipText,
        h(
          'button',
          {
            type: 'button',
            class: 'menu__tip-next',
            'aria-label': t('menu.tipNext'),
            title: t('menu.tipNext'),
            'data-testid': 'tip-next',
            onClick: () => {
              tip = pickTip(tips, tip ?? undefined);
              tipText.textContent = tip ?? '';
            },
          },
          h('span', { 'aria-hidden': 'true' }, '↻'),
        ),
      )
    : null;

  const nav = h(
    'nav',
    { class: 'menu__board', 'aria-label': t('menu.label') },
    h(
      'ul',
      { class: 'menu__list', role: 'list' },
      item('newGame', { primary: true, onClick: () => app.go('newGame') }),
      item('continue', {
        disabled: !canContinue,
        onClick: () => {
          if (!continueRun(app)) {
            toast(t('menu.continue.failed'), { kind: 'error' });
            GameController.clearSaved(app.store);
            const btn = nav.querySelector<HTMLButtonElement>('[data-testid="menu-continue"]');
            if (btn) btn.disabled = true;
          }
        },
      }),
      item('challenges', { soon: true }),
      item('daily', { soon: true }),
      item('collection', { soon: true }),
      item('stats', { soon: true }),
      item('settings', { onClick: () => app.go('settings') }),
      item('credits', { onClick: () => app.go('credits') }),
    ),
    hintEl,
  );

  const el = h(
    'main',
    { class: 'screen menu', 'aria-labelledby': 'game-title' },
    h(
      'header',
      { class: 'menu__logo' },
      h('h1', { id: 'game-title', class: 'menu__title' }, t('app.title')),
      h('p', { class: 'menu__subtitle' }, t('app.subtitle')),
      h('p', { class: 'menu__tagline' }, t('app.tagline')),
    ),
    nav,
    tipEl,
    h('p', { class: 'menu__typo', lang: 'cs', 'data-testid': 'typo-test' }, t('typoTest')),
    h(
      'footer',
      { class: 'menu__footer' },
      h('span', { 'data-testid': 'version' }, t('app.version', { version })),
      h('span', null, t('app.footerNote')),
    ),
  );

  const first = nav.querySelector<HTMLButtonElement>('.menu__item');
  if (first) focusWhenMounted(first);

  /** Šipky nahoru/dolů posouvají focus mezi položkami menu (dokola). */
  const moveFocus = (delta: number): boolean => {
    const items = [...nav.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)')];
    if (items.length === 0) return false;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : (idx + delta + items.length) % items.length;
    items[next]?.focus();
    return true;
  };

  return {
    el,
    onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'ArrowDown') return moveFocus(1);
      if (e.key === 'ArrowUp') return moveFocus(-1);
      return false;
    },
  };
};
