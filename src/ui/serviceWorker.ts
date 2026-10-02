/**
 * Registrace service workeru (offline hra, docs/ARCHITECTURE.md „Service worker“).
 *
 * Jen v produkčním buildu: `sw.js` vzniká až při `vite build` (plugin `karban-sw` ve vite.config.ts) se seznamem
 * všech souborů buildu. Cesta i rozsah jsou relativní k `base` (`./` i `/FM/` pro GitHub Pages).
 *
 * Aktualizace je bezpečná: nový worker se nainstaluje na pozadí, ale převezme hru až při příštím spuštění
 * (žádné `skipWaiting`) — rozehraná hra tak nikdy nemíchá soubory dvou verzí. Hráči to oznámí toast.
 */
import { t } from '../i18n/cs';
import { toast } from './components/toast';

/** Soubor workeru vedle index.html (musí odpovídat `SW_FILE` ve vite.config.ts). */
export const SW_FILE = 'sw.js';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}${SW_FILE}`)
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          // První instalace (bez controlleru) není aktualizace — hra se jen potichu připravila na offline.
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('app.updateReady'), { kind: 'info', testId: 'toast-update' });
          }
        });
      });
    })
    .catch((err: unknown) => {
      // Offline režim je bonus: hra běží dál i bez workeru (soukromé okno, zakázané workery, file://).
      console.warn('[karban] Service worker se nepodařilo zaregistrovat', err);
    });
}
