import { expect, test } from '@playwright/test';

const PANGRAM = 'Příliš žluťoučký kůň úpěl ďábelské ódy';

test('hlavní menu se načte bez chyb a vykreslí češtinu fontem Pixelify Sans', async ({ page }) => {
  // CLAUDE.md kap. 8: konzole bez chyb a varování (včetně chybějících i18n klíčů „[i18n] …“).
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
  });

  // Statické texty v index.html dosazuje při buildu plugin z src/i18n/cs.ts (vite.config.ts).
  const rawHtml = await (await page.request.get('/')).text();
  expect(rawHtml).not.toContain('{{t:');
  expect(rawHtml).toMatch(/<title>Karban/);

  await page.goto('/');

  await expect(page).toHaveTitle(/Karban/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Karban');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('typo-test')).toContainText(PANGRAM);
  await expect(page.getByTestId('menu-new-game')).toBeEnabled();
  await expect(page.getByTestId('loading-tip')).not.toBeEmpty();
  await expect(page.getByTestId('version')).toContainText('verze');

  const fonts = await page.evaluate(async (text) => {
    await document.fonts.ready;
    const loaded = await document.fonts.load('16px "Pixelify Sans"', text);
    return {
      check: document.fonts.check('16px "Pixelify Sans"', text),
      loadedFaces: loaded.length,
      typoFont: getComputedStyle(document.querySelector('[data-testid="typo-test"]')!).fontFamily,
    };
  }, PANGRAM);
  expect(fonts.loadedFaces).toBeGreaterThan(0);
  expect(fonts.check).toBe(true);
  expect(fonts.typoFont).toContain('Pixelify Sans');

  await page.screenshot({ path: 'test-results/smoke-title.png', fullPage: true });

  expect(errors).toEqual([]);
  expect(warnings).toEqual([]);
});
