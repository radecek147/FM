/**
 * Offline režim (CLAUDE.md kap. 2 a 10): po prvním načtení service worker uloží celý build, takže po odpojení
 * sítě jde stránku znovu načíst, projít menu, otevřít líně načítané obrazovky a začít run.
 */
import { expect, test } from '@playwright/test';
import { expectCleanConsole, idle, watchConsole } from './helpers';

test('po prvním načtení hra funguje offline: reload, menu, sbírka a nový run', async ({ page, context }) => {
  const log = watchConsole(page);
  // Relativní adresa: test projde i proti buildu s `BASE_PATH=/FM/` (baseURL …/FM/), jako na GitHub Pages.
  await page.goto('./?tutorial=off');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');

  // Worker je aktivní a převzal stránku; cache obsahuje celý build.
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      );
    }
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('karban-'))!);
    const urls = (await cache.keys()).map((r) => '/' + r.url.slice(reg.scope.length));
    return { scope: reg.scope, keys, urls, page: location.href };
  });
  // Rozsah = adresář hry (`/` lokálně, `/FM/` na GitHub Pages).
  expect(sw.page.startsWith(sw.scope)).toBe(true);
  expect(new URL(sw.scope).pathname).toBe(process.env.BASE_PATH ?? '/');
  expect(sw.keys.filter((k) => k.startsWith('karban-'))).toHaveLength(1);
  expect(sw.urls).toContain('/');
  expect(sw.urls.some((u) => /\/assets\/icons-.*\.js$/.test(u))).toBe(true);
  expect(sw.urls.some((u) => /\/assets\/game-.*\.js$/.test(u))).toBe(true);
  expect(sw.urls.some((u) => u.endsWith('.map'))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Karban');

  // Líně načítaná obrazovka (vlastní chunk) i bez sítě.
  await page.getByTestId('menu-collection').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'collection');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');

  // Nový run: výběr balíčku → herní obrazovka s rukou.
  await page.getByTestId('menu-new-game').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  await page.getByTestId('newgame-start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  await page.getByTestId('blind-select-small').click();
  await idle(page);
  await expect(page.getByTestId('hand').locator('.pcard')).toHaveCount(8);

  await context.setOffline(false);
  expectCleanConsole(log);
});
