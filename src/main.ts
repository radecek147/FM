/**
 * Vstupní bod aplikace. Zatím vykreslí provizorní titulní obrazovku (fáze 0);
 * router obrazovek (`src/ui/app.ts`) přijde ve fázi 3.
 */
import './assets/fonts/fonts.css';
import './ui/styles/base.css';
import { version } from '../package.json';
import { t, tList } from './i18n/cs';
import { h, mount, qs } from './ui/dom';

function randomTip(): string | null {
  const tips = tList('loadingTips');
  if (tips.length === 0) return null;
  // UI smí použít Math.random — náhoda enginu jde výhradně přes seedovaný RNG.
  return tips[Math.floor(Math.random() * tips.length)] ?? null;
}

function titleScreen(): HTMLElement {
  const tip = randomTip();
  return h(
    'main',
    { class: 'title-screen', 'aria-labelledby': 'game-title' },
    h(
      'header',
      { class: 'title-screen__logo' },
      h('h1', { id: 'game-title', class: 'title-screen__title' }, t('app.title')),
      h('p', { class: 'title-screen__subtitle' }, t('app.subtitle')),
      h('p', { class: 'title-screen__tagline' }, t('app.tagline')),
    ),
    h(
      'nav',
      { class: 'title-screen__menu', 'aria-label': t('menu.label') },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          disabled: true,
          title: t('menu.comingSoon', { phase: 3 }),
          'data-testid': 'menu-new-game',
        },
        t('menu.newGame.label'),
      ),
    ),
    tip &&
      h(
        'aside',
        { class: 'title-screen__tip', 'aria-label': t('app.tipLabel') },
        h('span', { class: 'title-screen__tip-label' }, t('app.tipLabel')),
        h('span', { 'data-testid': 'loading-tip' }, tip),
      ),
    h('p', { class: 'title-screen__typo', lang: 'cs', 'data-testid': 'typo-test' }, t('typoTest')),
    h(
      'footer',
      { class: 'title-screen__footer' },
      h('span', { 'data-testid': 'version' }, t('app.version', { version })),
      h('span', null, t('app.footerNote')),
    ),
  );
}

function start(): void {
  document.title = t('app.documentTitle');
  mount(qs('#app'), titleScreen());
}

start();
