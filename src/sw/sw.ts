/**
 * Service worker Karbanu — hra funguje offline po prvním načtení (docs/ARCHITECTURE.md „Service worker“).
 *
 * Ručně psaný, bez knihoven. Při `vite build` ho plugin `karban-sw` (scripts/sw-plugin.ts) přeloží do `sw.js`
 * vedle index.html a doplní mu `__SW_VERSION__` (otisk buildu) a `__SW_PRECACHE__` (všechny soubory buildu kromě
 * source map; index.html jako `./`). Registruje ho jen produkční build (src/ui/serviceWorker.ts).
 *
 * Strategie:
 *  - install: stáhne celý build do cache `karban-<verze>` (obejde HTTP cache, ať se nesmíchají verze); soubory
 *    s otiskem v názvu (`assets/…-<hash>.js`), které už má starší cache, jen zkopíruje,
 *  - activate: smaže cache starších verzí a převezme otevřené stránky,
 *  - fetch: navigace na hru → uložený index.html (app shell, i s `?seed=…`), ostatní soubory buildu z cache,
 *    všechno ostatní (a cokoli, co v cache chybí) ze sítě,
 *  - aktualizace: nový worker čeká, dokud běží stará verze (žádné `skipWaiting`) — rozehraná hra nikdy nedostane
 *    soubory jiné verze. Stránka hráči oznámí, že nová verze naskočí při příštím spuštění.
 *
 * Píše se proti vlastním minimálním typům (projekt se typuje s knihovnou DOM, ne WebWorker).
 */

declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: readonly string[];

interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface SwGlobalScope {
  readonly registration: { readonly scope: string };
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (e: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: SwFetchEvent) => void): void;
}

declare const self: SwGlobalScope;

const CACHE_PREFIX = 'karban-';
const CACHE_NAME = `${CACHE_PREFIX}${__SW_VERSION__}`;
/** Rozsah workeru = adresář hry (`/` lokálně, `/FM/` na GitHub Pages). */
const SCOPE = self.registration.scope;
/** Klíč app shellu (index.html) v cache. */
const SHELL_URL = new URL('./', SCOPE).href;
const INDEX_URL = new URL('index.html', SCOPE).href;
const PRECACHE_URLS = __SW_PRECACHE__.map((path) => new URL(path, SCOPE).href);
/** Soubory s otiskem obsahu v názvu se nikdy nemění — při aktualizaci je lze převzít ze staré cache. */
const HASHED_ASSET = /\/assets\/[^/]+-[\w-]{8,}\.\w+$/;

function oldCacheNames(): Promise<string[]> {
  return caches.keys().then((keys) => keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME));
}

/** Uloží jeden soubor buildu: z předchozí verze (hashovaný asset), jinak ze sítě mimo HTTP cache. */
async function precacheOne(cache: Cache, url: string, previous: readonly Cache[]): Promise<void> {
  if (HASHED_ASSET.test(url)) {
    for (const old of previous) {
      const hit = await old.match(url);
      if (hit) {
        await cache.put(url, hit);
        return;
      }
    }
  }
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response.ok) throw new Error(`Precache ${url}: HTTP ${response.status}`);
  // Přesměrovanou odpověď (`/FM` → `/FM/`) nesmí worker vrátit navigaci — uloží se jako čistá kopie.
  const clean = response.redirected
    ? new Response(await response.blob(), { status: response.status, headers: response.headers })
    : response;
  await cache.put(url, clean);
}

async function install(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const previous = await Promise.all((await oldCacheNames()).map((name) => caches.open(name)));
  // Chyba kteréhokoli souboru shodí instalaci — neúplná cache by offline nefungovala (zkusí se znovu příště).
  await Promise.all(PRECACHE_URLS.map((url) => precacheOne(cache, url, previous)));
}

async function activate(): Promise<void> {
  await Promise.all((await oldCacheNames()).map((name) => caches.delete(name)));
  await self.clients.claim();
}

/** Navigace na samotnou hru (adresář nebo index.html, s libovolnými parametry). */
function isAppNavigation(request: Request): boolean {
  if (request.mode !== 'navigate') return false;
  const url = new URL(request.url);
  const page = `${url.origin}${url.pathname}`;
  return page === SHELL_URL || page === INDEX_URL;
}

async function respond(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = isAppNavigation(request) ? await cache.match(SHELL_URL) : await cache.match(request);
  return cached ?? fetch(request);
}

self.addEventListener('install', (e) => e.waitUntil(install()));
self.addEventListener('activate', (e) => e.waitUntil(activate()));
self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Jen soubory hry (rozsah obsahuje i origin); cizí adresy a POST jdou rovnou na síť.
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  e.respondWith(respond(request));
});

export {};
