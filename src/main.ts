/**
 * Vstupní bod aplikace: fonty a styly, aplikace (router, úložiště, profil hráče, registr obsahu), načtení ikon
 * (samostatný chunk), registrace obrazovek, tutoriál Štamgast (vypíná ho `?tutorial=off`), přepočet profilu,
 * globální ošetření chyb a první obrazovka (menu, nebo `#gallery`).
 */
import './assets/fonts/fonts.css';
import './ui/styles/base.css';
import './ui/styles/screens.css';
import { registry } from './content';
import { t } from './i18n/cs';
import type { ScreenId } from './ui/app';
import { App } from './ui/app';
import { loadIcons } from './ui/art/icons';
import { toast } from './ui/components/toast';
import { h, mount, qs } from './ui/dom';
import { challengesScreen } from './ui/screens/challenges';
import { collectionScreen } from './ui/screens/collection';
import { creditsScreen } from './ui/screens/credits';
import { dailyScreen } from './ui/screens/daily';
import { galleryScreen } from './ui/screens/gallery';
import { gameScreen } from './ui/screens/game';
import { menuScreen } from './ui/screens/menu';
import { newGameScreen } from './ui/screens/newGame';
import { settingsScreen } from './ui/screens/settings';
import { statsScreen } from './ui/screens/stats';
import { browserStore } from './ui/storage';
import { installTutorial } from './ui/tutorial';

/** Vývojářská galerie grafiky (`#gallery`) — není běžná obrazovka menu, router ji zná jen pod tímto id. */
const GALLERY = 'gallery' as ScreenId;
const GALLERY_HASH = '#gallery';
/** Nejvýš jedno chybové oznámení za tuto dobu (ať chyba ve smyčce nezaplaví obrazovku). */
const ERROR_TOAST_GAP_MS = 3000;

/** Neošetřené chyby: do konzole celé, hráči vtipná hláška místo tichého zamrznutí. */
function installErrorHandlers(): void {
  let last = -Infinity;
  const report = (label: string, err: unknown): void => {
    console.error(`[karban] ${label}`, err);
    const now = performance.now();
    if (now - last < ERROR_TOAST_GAP_MS) return;
    last = now;
    try {
      toast(t('errors.generic'), { kind: 'error', testId: 'toast-crash' });
    } catch {
      // DOM ještě není připravený — zůstane jen záznam v konzoli.
    }
  };
  window.addEventListener('error', (e) => {
    // Šum prohlížeče, ne chyba hry.
    if (typeof e.message === 'string' && e.message.includes('ResizeObserver loop')) return;
    report('Neošetřená chyba', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => report('Neošetřený slib', e.reason));
}

async function boot(): Promise<void> {
  installErrorHandlers();
  document.title = t('app.documentTitle');
  const root = qs('#app');
  mount(root, h('p', { class: 'boot-loading', role: 'status' }, t('app.loading')));

  const app = new App(root, browserStore(), registry());
  app.register('menu', menuScreen);
  app.register('newGame', newGameScreen);
  app.register('game', gameScreen);
  app.register('settings', settingsScreen);
  app.register('credits', creditsScreen);
  app.register('collection', collectionScreen);
  app.register('stats', statsScreen);
  app.register('challenges', challengesScreen);
  app.register('daily', dailyScreen);
  app.register(GALLERY, galleryScreen);
  // Tutoriál Štamgast (DESIGN 13.5); `?tutorial=off` ho vypne pro celé sezení (e2e testy).
  if (new URLSearchParams(location.search).get('tutorial') !== 'off') installTutorial(app);

  // Ikony (~355 kB) jsou samostatný chunk; chyba načtení hru nezastaví (náhradní glyfy).
  await loadIcons();
  // Odemčení a achievementy jen ze stavu profilu (nový obsah po aktualizaci, import) — oznámí se toastem.
  app.profiles.refresh();

  window.addEventListener('hashchange', () => {
    if (location.hash === GALLERY_HASH) app.go(GALLERY);
    else if (app.screenId === GALLERY) app.go('menu');
  });
  app.go(location.hash === GALLERY_HASH ? GALLERY : 'menu');
}

boot().catch((err: unknown) => {
  console.error('[karban] Start aplikace selhal', err);
  toast(t('errors.generic'), { kind: 'error', duration: 0, testId: 'toast-crash' });
});
