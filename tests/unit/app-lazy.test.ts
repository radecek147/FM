// @vitest-environment happy-dom
/**
 * Code splitting routeru (src/ui/app.ts): líně registrované obrazovky se načtou při prvním `go()` (do té doby zůstává
 * stará obrazovka a `#app` má `aria-busy`), souběžná načtení sdílejí jeden slib, opožděný přechod se zahodí, když
 * hráč mezitím odešel jinam, a chyba načtení (offline bez service workeru) skončí hláškou, ne pádem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import { t } from '../../src/i18n/cs';
import type { ScreenFactory } from '../../src/ui/app';
import { App } from '../../src/ui/app';
import { clearToasts } from '../../src/ui/components/toast';
import { STORAGE_KEYS, memoryStore } from '../../src/ui/storage';

const REG = registry();

let root: HTMLElement;
let app: App;

const screen =
  (name: string): ScreenFactory =>
  () => {
    const el = document.createElement('main');
    el.dataset.name = name;
    return { el };
  };

/** Odložený slib, který test vyřeší ručně. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const shown = (): string | undefined => root.querySelector<HTMLElement>('main')?.dataset.name;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  const store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = new App(root, store, REG, { notify: () => undefined, onProblem: () => undefined });
  app.register('menu', screen('menu'));
});

afterEach(() => {
  clearToasts();
  vi.restoreAllMocks();
});

describe('líně načítané obrazovky', () => {
  it('první go() počká na chunk, pak přejde; další go() je synchronní', async () => {
    const chunk = deferred<ScreenFactory>();
    const loader = vi.fn(() => chunk.promise);
    app.registerLazy('stats', loader);
    app.go('menu');

    app.go('stats');
    expect(shown()).toBe('menu');
    expect(app.screenId).toBe('menu');
    expect(root.getAttribute('aria-busy')).toBe('true');

    chunk.resolve(screen('stats'));
    await flush();
    expect(shown()).toBe('stats');
    expect(app.screenId).toBe('stats');
    expect(root.hasAttribute('aria-busy')).toBe(false);

    app.go('menu');
    app.go('stats');
    expect(shown()).toBe('stats');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('předává parametry obrazovce i po načtení', async () => {
    let received: Record<string, unknown> | undefined;
    app.registerLazy('daily', () =>
      Promise.resolve<ScreenFactory>((_app, params) => {
        received = params;
        return { el: document.createElement('main') };
      }),
    );
    app.go('daily', { seed: 'ABC' });
    await flush();
    expect(received).toEqual({ seed: 'ABC' });
  });

  it('opožděný přechod se zahodí, když hráč mezitím odešel jinam', async () => {
    const chunk = deferred<ScreenFactory>();
    app.registerLazy('collection', () => chunk.promise);
    app.go('menu');
    app.go('collection');
    app.go('menu');
    chunk.resolve(screen('collection'));
    await flush();
    expect(app.screenId).toBe('menu');
    expect(shown()).toBe('menu');
  });

  it('preloadScreens načte všechny chunky jednou a přechody jsou pak okamžité', async () => {
    const a = vi.fn(() => Promise.resolve(screen('stats')));
    const b = vi.fn(() => Promise.resolve(screen('credits')));
    app.registerLazy('stats', a);
    app.registerLazy('credits', b);
    await Promise.all([app.preloadScreens(), app.preloadScreens()]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    app.go('credits');
    expect(shown()).toBe('credits');
  });

  it('chyba načtení: zůstane stará obrazovka, hláška místo pádu, další pokus jde znovu na síť', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = vi
      .fn<() => Promise<ScreenFactory>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(screen('settings'));
    app.registerLazy('settings', loader);
    app.go('menu');

    app.go('settings');
    await flush();
    expect(shown()).toBe('menu');
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="toast-screen-load"]')?.textContent).toContain(
      t('errors.screenLoad'),
    );

    app.go('settings');
    await flush();
    expect(shown()).toBe('settings');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('neznámá obrazovka jen varuje; synchronní registrace má přednost před línou', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    app.go('credits');
    expect(warn).toHaveBeenCalledTimes(1);
    const loader = vi.fn(() => Promise.resolve(screen('lazy-menu')));
    app.registerLazy('menu', loader);
    app.go('menu');
    expect(shown()).toBe('menu');
    expect(loader).not.toHaveBeenCalled();
  });
});
