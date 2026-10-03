import { expect, test } from '@playwright/test';
import { serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import {
  continueRun,
  expectCleanConsole,
  game,
  handCards,
  idle,
  newState,
  readRun,
  roundState,
  seedSavedRun,
  watchConsole,
} from './helpers';

/**
 * Opravy po testu 1.0 (1.0.1) v prohlížeči:
 *  1. dvě karty se stejným profilem: starší se zablokuje modalem „Hra je otevřená v jiné kartě“ a nic nepřepíše;
 *     „Hrát tady“ hru převezme zpět (načte stav z úložiště) a zablokuje druhou kartu,
 *  2. odchod do menu během skórování a Pokračovat: hra hned reaguje (žádné sekundy „mrtvé“ obrazovky),
 *  3. import poškozeného runu (karta v ruce, která není v balíčku) se odmítne a rozehraná hra zůstane.
 */

test('dvě karty: neaktivní se zablokuje a nepřepíše hru, „Hrát tady“ ji převezme', async ({ context }) => {
  const a = await context.newPage();
  const logA = watchConsole(a);
  await seedSavedRun(a, newState('E2ETABAA'));
  await continueRun(a);
  await expect(game(a)).toHaveAttribute('data-phase', 'blind_select');

  // Druhá karta hru převezme; první se zablokuje.
  const b = await context.newPage();
  const logB = watchConsole(b);
  await continueRun(b);
  await expect(a.getByTestId('tab-lock')).toBeVisible();
  await expect(a.getByTestId('tab-lock')).toContainText(t('app.tabLock.title'));
  await expect(b.getByTestId('tab-lock')).toHaveCount(0);

  // B hraje dál (vybere útratu); zablokovaná A nemůže nic udělat ani přepsat.
  await b.keyboard.press('Enter');
  await idle(b);
  expect((await readRun(b)).phase).toBe('round');
  // Esc modal nezavře a klávesy hry pod něj neprosakují (X = zahodit).
  await a.keyboard.press('Escape');
  await a.keyboard.press('x');
  await expect(a.getByTestId('tab-lock')).toBeVisible();
  expect((await readRun(a)).phase).toBe('round');

  // A převezme hru: načte stav, který uložila B (kolo), a zablokuje B.
  await a.getByTestId('tab-lock-take').click();
  await expect(a.getByTestId('tab-lock')).toHaveCount(0);
  await expect(game(a)).toHaveAttribute('data-phase', 'round');
  await expect(b.getByTestId('tab-lock')).toBeVisible();
  await idle(a);
  await a.keyboard.press('1');
  await expect(a.getByTestId('hand').locator('.pcard.is-selected')).toHaveCount(1);
  expectCleanConsole(logA);
  expectCleanConsole(logB);
});

test('odchod do menu během skórování: po Pokračovat hra hned reaguje', async ({ page }) => {
  const log = watchConsole(page);
  await seedSavedRun(page, roundState('E2EESCMN'));
  await continueRun(page);
  // Pět karet a zahrát — skórování trvá několik sekund.
  for (const k of ['1', '2', '3', '4', '5']) await page.keyboard.press(k);
  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveClass(/is-busy/);
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
  await page.getByTestId('menu-continue').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
  // Hned po návratu: žádné „is-busy“ a výběr karty funguje (dřív až po doběhnutí animací mimo obrazovku).
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 1000 });
  const run = await readRun(page);
  expect(run.round?.handsPlayed).toBe(1);
  if (run.phase === 'round') {
    await page.keyboard.press('1');
    await expect(page.getByTestId('hand').locator('.pcard.is-selected')).toHaveCount(1, { timeout: 1000 });
    await expect(handCards(page)).toHaveCount(run.round!.hand.length);
  }
  expectCleanConsole(log);
});

test('import poškozeného runu se odmítne a rozehraná hra zůstane', async ({ page }) => {
  const log = watchConsole(page);
  const current = newState('E2EIMPOK');
  await seedSavedRun(page, current);
  await page.goto('/?tutorial=off');
  const before = await page.evaluate(() => localStorage.getItem('karban.run'));
  await page.getByTestId('menu-settings').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');

  const broken = roundState('E2EIMPBR');
  broken.round!.hand[0] = 9999;
  await page.getByTestId('settings-import-file').setInputFiles({
    name: 'karban-poskozeny.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeRun(broken, '2026-10-03T00:00:00.000Z')),
  });
  await expect(page.getByTestId('toast-import-error')).toContainText(t('settings.import.errors.corruptRun'));
  await expect(page.getByTestId('import-confirm')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('karban.run'))).toBe(before);
  expectCleanConsole(log);
});
