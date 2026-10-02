/**
 * Service worker (src/sw/sw.ts + plugin scripts/sw-plugin.ts): seznam souborů pro precache, verze svázaná
 * s obsahem buildu, výsledný `sw.js` jako klasický skript a jeho chování nad falešnými `caches` / `fetch`
 * (instalace mimo HTTP cache, převzetí hashovaných souborů ze staré verze, úklid starých cache, app shell
 * pro navigace s parametry, cache-first pro soubory buildu, cizí adresy a POST bez zásahu).
 * Skutečný offline běh v prohlížeči ověřuje tests/e2e/offline.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SW_FILE as SW_FILE_PLUGIN,
  buildServiceWorker,
  buildVersion,
  precacheList,
} from '../../scripts/sw-plugin';
import { SW_FILE } from '../../src/ui/serviceWorker';

const SCOPE = 'https://hra.example/FM/';

describe('plugin karban-sw', () => {
  it('precache: všechny soubory buildu kromě map a workeru, index.html jako adresář', () => {
    const list = precacheList([
      'index.html',
      'assets/index-AAAAAAAA.js',
      'assets/index-AAAAAAAA.js.map',
      'assets/index-BBBBBBBB.css',
      'assets/pixelify-sans-latin-400-normal-CCCCCCCC.woff2',
      'sw.js',
    ]);
    expect(list).toEqual([
      './',
      'assets/index-AAAAAAAA.js',
      'assets/index-BBBBBBBB.css',
      'assets/pixelify-sans-latin-400-normal-CCCCCCCC.woff2',
    ]);
    expect(() => precacheList(['assets/a.js'])).toThrow(/index\.html/);
  });

  it('název souboru se shoduje s registrací', () => {
    expect(SW_FILE_PLUGIN).toBe(SW_FILE);
  });

  it('verze závisí na obsahu, ne na pořadí souborů', () => {
    const a = buildVersion([
      ['index.html', '<html>'],
      ['assets/a.js', 'x'],
    ]);
    const b = buildVersion([
      ['assets/a.js', 'x'],
      ['index.html', '<html>'],
    ]);
    const c = buildVersion([
      ['assets/a.js', 'y'],
      ['index.html', '<html>'],
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('sw.js je klasický skript s doplněnou verzí a seznamem souborů', async () => {
    const code = await buildServiceWorker('abc123def456', ['./', 'assets/a-AAAAAAAA.js']);
    expect(code).toContain('const __SW_VERSION__ = "abc123def456";');
    expect(code).toContain('const __SW_PRECACHE__ = ["./","assets/a-AAAAAAAA.js"];');
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toMatch(/\binterface\b|declare const/);
    expect(code).not.toContain('skipWaiting');
  });
});

// ─────────────── Chování workeru nad falešným prostředím ───────────────

type Listener = (e: unknown) => void;

class FakeCache {
  readonly store = new Map<string, Response>();
  match(req: Request | string): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    return Promise.resolve(this.store.get(url)?.clone());
  }
  put(req: Request | string, res: Response): Promise<void> {
    this.store.set(typeof req === 'string' ? req : req.url, res);
    return Promise.resolve();
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) this.caches.set(name, (c = new FakeCache()));
    return Promise.resolve(c);
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.caches.keys()]);
  }
  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.caches.delete(name));
  }
}

/** Žádost, jak ji worker dostane (Node neumí `mode: 'navigate'` v konstruktoru Request). */
function req(url: string, opts: { mode?: string; method?: string } = {}): Request {
  return { url, method: opts.method ?? 'GET', mode: opts.mode ?? 'cors' } as Request;
}

async function startWorker(version: string, precache: string[], storage = new FakeCacheStorage()) {
  const code = await buildServiceWorker(version, precache);
  const listeners: Record<string, Listener> = {};
  const claim = vi.fn(() => Promise.resolve());
  const fetched: Array<{ url: string; cache: RequestCache | undefined }> = [];
  const fetchFn = vi.fn((input: Request | string) => {
    const url = typeof input === 'string' ? input : input.url;
    fetched.push({ url, cache: typeof input === 'string' ? undefined : input.cache });
    return Promise.resolve(new Response(`síť:${url}`));
  });
  const self = {
    registration: { scope: SCOPE },
    clients: { claim },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
  };
  new Function('self', 'caches', 'fetch', code)(self, storage, fetchFn);

  const lifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    let work: Promise<unknown> = Promise.resolve();
    listeners[type]!({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  /** Vrátí text odpovědi, nebo null, když worker žádost nechal na prohlížeči. */
  const request = async (r: Request): Promise<string | null> => {
    const out: { res: Promise<Response> | null } = { res: null };
    listeners['fetch']!({ request: r, respondWith: (p: Promise<Response>) => (out.res = p) });
    return out.res ? (await out.res).text() : null;
  };
  return { storage, claim, fetched, lifecycle, request };
}

describe('sw.js za běhu', () => {
  const PRECACHE = ['./', 'assets/index-AAAAAAAA.js', 'assets/game-BBBBBBBB.js'];

  it('instalace uloží celý build mimo HTTP cache, aktivace převezme stránky', async () => {
    const w = await startWorker('v1', PRECACHE);
    await w.lifecycle('install');
    const cache = w.storage.caches.get('karban-v1')!;
    expect([...cache.store.keys()].sort()).toEqual([
      `${SCOPE}`,
      `${SCOPE}assets/game-BBBBBBBB.js`,
      `${SCOPE}assets/index-AAAAAAAA.js`,
    ]);
    expect(w.fetched.every((f) => f.cache === 'reload')).toBe(true);
    await w.lifecycle('activate');
    expect(w.claim).toHaveBeenCalledTimes(1);
  });

  it('aktualizace: hashované soubory převezme ze staré cache, starou cache smaže až při aktivaci', async () => {
    const storage = new FakeCacheStorage();
    const v1 = await startWorker('v1', PRECACHE, storage);
    await v1.lifecycle('install');
    await v1.lifecycle('activate');

    const v2 = await startWorker(
      'v2',
      ['./', 'assets/index-AAAAAAAA.js', 'assets/game-CCCCCCCC.js'],
      storage,
    );
    await v2.lifecycle('install');
    // Nezměněný chunk se nestahuje znovu; index.html (bez otisku) a nový chunk ano.
    expect(v2.fetched.map((f) => f.url).sort()).toEqual([SCOPE, `${SCOPE}assets/game-CCCCCCCC.js`]);
    expect([...storage.caches.keys()].sort()).toEqual(['karban-v1', 'karban-v2']);

    await v2.lifecycle('activate');
    expect([...storage.caches.keys()]).toEqual(['karban-v2']);
  });

  it('cizí cache (jiné aplikace na stejném originu) nechá být', async () => {
    const storage = new FakeCacheStorage();
    await storage.open('jina-aplikace');
    const w = await startWorker('v1', PRECACHE, storage);
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...storage.caches.keys()].sort()).toEqual(['jina-aplikace', 'karban-v1']);
  });

  it('fetch: navigace na hru dostane app shell (i s parametry), soubory buildu jdou z cache', async () => {
    const w = await startWorker('v1', PRECACHE);
    await w.lifecycle('install');
    w.fetched.length = 0;

    expect(await w.request(req(`${SCOPE}?seed=ABC&tutorial=off`, { mode: 'navigate' }))).toBe(`síť:${SCOPE}`);
    expect(await w.request(req(`${SCOPE}index.html#gallery`, { mode: 'navigate' }))).toBe(`síť:${SCOPE}`);
    expect(await w.request(req(`${SCOPE}assets/game-BBBBBBBB.js`))).toBe(
      `síť:${SCOPE}assets/game-BBBBBBBB.js`,
    );
    expect(w.fetched).toEqual([]);

    // Co v cache není, jde na síť (bez ukládání).
    expect(await w.request(req(`${SCOPE}assets/neznamy-ZZZZZZZZ.js`))).toBe(
      `síť:${SCOPE}assets/neznamy-ZZZZZZZZ.js`,
    );
    expect(await w.request(req(`${SCOPE}ASSETS.md`, { mode: 'navigate' }))).toBe(`síť:${SCOPE}ASSETS.md`);
    expect(w.fetched).toHaveLength(2);
  });

  it('cizí adresy, adresy mimo rozsah a POST nechá prohlížeči', async () => {
    const w = await startWorker('v1', PRECACHE);
    await w.lifecycle('install');
    expect(await w.request(req('https://fonts.example/font.woff2'))).toBeNull();
    expect(await w.request(req('https://hra.example/jina-hra/'))).toBeNull();
    expect(await w.request(req(`${SCOPE}api`, { method: 'POST' }))).toBeNull();
  });

  it('instalace selže, když soubor buildu chybí (neúplná cache by offline nefungovala)', async () => {
    const code = await buildServiceWorker('v1', ['./']);
    const listeners: Record<string, Listener> = {};
    const self = {
      registration: { scope: SCOPE },
      clients: { claim: () => Promise.resolve() },
      addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    };
    const notFound = (): Promise<Response> => Promise.resolve(new Response('', { status: 404 }));
    new Function('self', 'caches', 'fetch', code)(self, new FakeCacheStorage(), notFound);
    let work: Promise<unknown> = Promise.resolve();
    listeners['install']!({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await expect(work).rejects.toThrow(/HTTP 404/);
  });
});
