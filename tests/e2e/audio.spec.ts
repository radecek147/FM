/**
 * Zvuk v prohlížeči (DESIGN 13.6): `AudioContext` vznikne až po gestu hráče (žádné varování autoplay), hudba
 * podle obrazovky běží, posuvníky a „ztlumit vše“ (přepínač i klávesa M) fungují a konzole zůstane čistá.
 */
import { expect, test } from '@playwright/test';
import { expectCleanConsole, watchConsole } from './helpers';

interface AudioProbe {
  count: number;
  ctx: AudioContext | null;
}

declare global {
  interface Window {
    __audioProbe?: AudioProbe;
  }
}

test('AudioContext až po gestu, ztlumení klávesou M i přepínačem, čistá konzole', async ({ page }) => {
  const log = watchConsole(page);
  // Počítadlo vytvořených kontextů (obal kolem nativního AudioContext).
  await page.addInitScript(() => {
    const probe: AudioProbe = { count: 0, ctx: null };
    window.__audioProbe = probe;
    const Native = window.AudioContext;
    if (!Native) return;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.count++;
        probe.ctx = this;
      }
    };
  });
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('menu-settings')).toBeVisible();
  // Bez interakce žádný kontext (autoplay politika).
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__audioProbe?.count)).toBe(0);

  // První klik = gesto → kontext vznikne a běží; hudba v menu plánuje noty (čas kontextu běží).
  await page.getByTestId('menu-settings').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');
  await expect.poll(() => page.evaluate(() => window.__audioProbe?.count)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__audioProbe?.ctx?.state)).toBe('running');
  const t0 = await page.evaluate(() => window.__audioProbe?.ctx?.currentTime ?? 0);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__audioProbe?.ctx?.currentTime ?? 0)).toBeGreaterThan(t0);

  // Klávesa M ztlumí (hláška + přepínač v nastavení se srovná) a uloží se do profilu.
  await page.keyboard.press('m');
  await expect(page.getByTestId('toast-mute')).toBeVisible();
  await expect(page.getByTestId('settings-mute')).toBeChecked();
  const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('karban.profile') ?? '{}'));
  expect(muted.data.settings.muted).toBe(true);
  // Přepínač zvuk zase pustí.
  await page.locator('label[for="settings-mute"]').click();
  await expect(page.getByTestId('settings-mute')).not.toBeChecked();

  // Posuvník efektů: změna hlasitosti (puštění zahraje zkušební zvuk) se uloží.
  await page.getByTestId('settings-sfx').fill('40');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('karban.profile') ?? '{}'));
  expect(saved.data.settings.sfxVolume).toBeCloseTo(0.4);

  // Klávesová zkratka je v přehledu.
  await expect(page.getByTestId('keys-table')).toContainText('M');
  // Zpět do menu a nové hry: přechody obrazovek a zvuky nesmí nic hlásit do konzole.
  await page.getByTestId('back').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  expect(await page.evaluate(() => window.__audioProbe?.count)).toBe(1);
  expectCleanConsole(log);
});
