/**
 * Titulky: autoři, nástroje, atribuce písma (Pixelify Sans, OFL) a ikon (game-icons.net, CC BY 3.0, autoři
 * podle `src/assets/icons/authors.json`), „inspirováno hrou Balatro“ a poděkování.
 *
 * Titulky pomalu rolují (CSS transform). Bez animací, s `prefers-reduced-motion` nebo po „Zastavit“ jsou statické
 * a dají se posouvat. Najetí myší nebo focus uvnitř rolování pozastaví. Esc / Zpět vrátí do menu.
 * Vlastní jména (autoři, písmo, nástroje) jsou data, věty jsou v i18n (`credits.*`).
 */
import iconAuthors from '../../assets/icons/authors.json';
import { t, tList } from '../../i18n/cs';
import type { ScreenFactory } from '../app';
import { backButton, button } from '../components/button';
import { h } from '../dom';

/** Písmo (ASSETS.md). */
const FONT_CREDIT = {
  name: 'Pixelify Sans',
  author: 'Stefie Justprince',
  copyright: '© 2021 The Pixelify Sans Project Authors',
  url: 'https://github.com/eifetx/Pixelify-Sans',
  licenseUrl: 'https://openfontlicense.org',
};

/** Ikony (ASSETS.md). */
const ICON_CREDIT = {
  site: 'game-icons.net',
  url: 'https://game-icons.net',
  license: 'CC BY 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
};

/** Nástroje, se kterými hra vznikla. */
const TOOLS = [
  'TypeScript',
  'Vite',
  'Vitest',
  'Playwright',
  'ESLint',
  'Prettier',
  'Web Audio API',
  'Claude Code',
];

/** Rychlost rolování (px za sekundu při rychlosti hry 1×). */
const ROLL_SPEED = 36;

/** Autoři ikon seřazení podle počtu ikon (sestupně), při shodě abecedně. */
export function iconAuthorCounts(
  authors: Readonly<Record<string, string>>,
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const author of Object.values(authors)) counts.set(author, (counts.get(author) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'credits__link' }, text);
}

function block(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return h('section', { class: 'credits__block' }, h('h2', { class: 'credits__heading' }, title), children);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const creditsScreen: ScreenFactory = (app) => {
  const authors = iconAuthorCounts(iconAuthors as Record<string, string>);

  const roll = h(
    'div',
    { class: 'credits__roll', 'data-testid': 'credits-roll' },
    h(
      'div',
      { class: 'credits__logo' },
      h('p', { class: 'credits__game' }, t('app.title')),
      h('p', { class: 'credits__subtitle' }, t('app.subtitle')),
    ),
    block(
      t('credits.game.title'),
      h('p', { class: 'credits__role' }, t('credits.game.made')),
      h('p', { class: 'credits__name' }, t('credits.game.authors')),
    ),
    block(
      t('credits.tools.title'),
      h('p', null, t('credits.tools.text')),
      h(
        'ul',
        { class: 'credits__list credits__list--inline', role: 'list' },
        TOOLS.map((tool) => h('li', { class: 'credits__name' }, tool)),
      ),
    ),
    block(
      t('credits.font.title'),
      h('p', { class: 'credits__name' }, link(FONT_CREDIT.url, FONT_CREDIT.name)),
      h('p', null, FONT_CREDIT.author),
      h('p', { class: 'credits__small' }, FONT_CREDIT.copyright),
      h('p', { class: 'credits__small' }, link(FONT_CREDIT.licenseUrl, t('credits.font.license'))),
      h('p', { class: 'credits__small' }, t('credits.font.digits')),
    ),
    block(
      t('credits.icons.title'),
      h('p', { 'data-testid': 'credits-icons' }, t('credits.icons.text')),
      h(
        'p',
        { class: 'credits__small' },
        link(ICON_CREDIT.url, ICON_CREDIT.site),
        ' · ',
        link(ICON_CREDIT.licenseUrl, ICON_CREDIT.license),
      ),
      h('h3', { class: 'credits__subheading' }, t('credits.icons.authors')),
      h(
        'ul',
        { class: 'credits__list', role: 'list', 'data-testid': 'credits-icon-authors' },
        authors.map((a) =>
          h(
            'li',
            null,
            h('span', { class: 'credits__name' }, a.name),
            ' ',
            h('span', { class: 'credits__small' }, t('credits.icons.count', { n: a.count })),
          ),
        ),
      ),
    ),
    block(t('credits.sound.title'), h('p', null, t('credits.sound.text'))),
    block(
      t('credits.inspiration.title'),
      h('p', { 'data-testid': 'credits-inspiration' }, t('credits.inspiration.text')),
    ),
    block(
      t('credits.thanks.title'),
      h(
        'ul',
        { class: 'credits__list', role: 'list' },
        tList('credits.thanks.items').map((line) => h('li', null, line)),
      ),
    ),
    h('p', { class: 'credits__end' }, t('credits.end')),
  );

  const viewport = h(
    'div',
    {
      class: 'credits__viewport',
      role: 'region',
      'aria-label': t('credits.rollLabel'),
      tabindex: '0',
    },
    roll,
  );

  const canRoll = app.settings.animations && !prefersReducedMotion();
  let rolling = canRoll;

  const toggle = button({
    label: rolling ? t('credits.pause') : t('credits.resume'),
    variant: 'ghost',
    size: 'small',
    testId: 'credits-toggle',
    onClick: () => setRolling(!rolling),
  });
  toggle.setAttribute('aria-pressed', String(!rolling));
  if (!canRoll) toggle.hidden = true;

  const el = h(
    'main',
    { class: 'screen credits', 'aria-labelledby': 'credits-title' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'credits-title', class: 'screen-title' }, t('credits.title')),
      ),
      toggle,
    ),
    viewport,
  );

  /** Délka jednoho průjezdu podle výšky obsahu a rychlosti hry (měří se jednou po vložení do stránky). */
  const measure = (): void => {
    const start = viewport.clientHeight;
    const distance = start + roll.offsetHeight;
    const seconds = Math.max(20, distance / (ROLL_SPEED * Math.max(1, app.settings.speed)));
    // První průjezd nezačíná u spodního okraje, ale s logem nahoře (záporné zpoždění = už rozjeté).
    const lead = (start * 0.85 * seconds) / distance;
    roll.style.setProperty('--roll-start', `${start}px`);
    roll.style.setProperty('--roll-duration', `${seconds.toFixed(1)}s`);
    roll.style.animationDelay = `-${lead.toFixed(2)}s`;
  };

  const setRolling = (on: boolean): void => {
    rolling = on && canRoll;
    el.classList.toggle('credits--rolling', rolling);
    el.classList.toggle('credits--static', !rolling);
    toggle.querySelector('.btn__label')!.textContent = rolling ? t('credits.pause') : t('credits.resume');
    toggle.setAttribute('aria-pressed', String(!rolling));
    if (!rolling) viewport.scrollTop = 0;
  };

  setRolling(rolling);
  let frame = 0;
  if (canRoll) frame = requestAnimationFrame(measure);

  return {
    el,
    onKey(e) {
      if (e.key === 'Escape') {
        app.go('menu');
        return true;
      }
      return false;
    },
    dispose: () => cancelAnimationFrame(frame),
  };
};
