import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { createProfile, serializeProfile } from '../../src/engine';

/**
 * Kostra aplikace a vedlejší obrazovky: hlavní menu, nová hra, nastavení (barvoslepý režim, export/import,
 * reset), titulky. Každý test běží v čistém kontextu (prázdný localStorage).
 */

interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

/** CLAUDE.md kap. 8: konzole bez chyb a varování. */
function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], warnings: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.errors.push(`console: ${msg.text()}`);
    if (msg.type() === 'warning') log.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => log.errors.push(`pageerror: ${err.message}`));
  return log;
}

function expectCleanConsole(log: ConsoleLog): void {
  expect(log.errors).toEqual([]);
  expect(log.warnings).toEqual([]);
}

const screen = (page: Page) => page.locator('#app');

/** Profil se všemi balíčky a silami piva odemčenými (testy výběru balíčku a síly piva). */
function unlockedProfile(): string {
  const reg = registry();
  const p = createProfile('2026-10-02T00:00:00.000Z');
  p.unlocks.decks = Object.keys(reg.decks);
  for (const id of Object.keys(reg.decks)) p.unlocks.stakes[id] = 8;
  return serializeProfile(p, '2026-10-02T00:00:00.000Z');
}

/** Vloží odemčený profil (jen když v kontextu ještě žádný není). */
async function presetUnlockedProfile(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.profile')) localStorage.setItem('karban.profile', value);
  }, unlockedProfile());
}

/** Projde obrazovkou Nová hra a založí run (Mariášový balíček, Dvanáctka, daný seed) — s odemčeným profilem. */
async function startRun(page: Page, seed: string): Promise<void> {
  await page.getByTestId('menu-new-game').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'newGame');
  await page.getByTestId('deck-marias').click();
  await page.getByTestId('stake-3').click();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('newgame-start').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
}

async function storedRun(
  page: Page,
): Promise<{ data: { seed: string; deckId: string; stake: number } } | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('karban.run') ?? 'null'));
}

test('menu se načte bez chyb, Pokračovat je bez uložení neaktivní, všechny ostatní položky fungují', async ({
  page,
}) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Karban');
  await expect(page.getByTestId('menu-new-game')).toBeEnabled();
  await expect(page.getByTestId('menu-continue')).toBeDisabled();
  await expect(page.getByTestId('menu-settings')).toBeEnabled();
  await expect(page.getByTestId('menu-credits')).toBeEnabled();
  for (const id of ['challenges', 'daily', 'collection', 'stats']) {
    await expect(page.getByTestId(`menu-${id}`)).toBeEnabled();
    await expect(page.getByTestId(`menu-${id}`)).not.toHaveAttribute('aria-disabled', 'true');
  }
  await expect(page.locator('.btn--soon')).toHaveCount(0);
  // Denní run: cedulka „Dnes“, dokud čeká oficiální pokus.
  await expect(page.getByTestId('menu-daily')).toHaveAttribute(
    'aria-label',
    /^Denní run\s–\sDnes \(oficiální pokus ještě čeká\)$/,
  );

  // Klávesnice: focus začíná na Nové hře, šipka dolů přeskočí neaktivní Pokračovat.
  await expect(page.getByTestId('menu-new-game')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('menu-challenges')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('menu-new-game')).toBeFocused();

  // Výzvy a Denní run vedou na své obrazovky (Esc zpět).
  await page.getByTestId('menu-challenges').focus();
  await page.keyboard.press('Enter');
  await expect(screen(page)).toHaveAttribute('data-screen', 'challenges');
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await page.getByTestId('menu-daily').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'daily');
  await page.getByTestId('back').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Rada Štamgasta jde přepnout.
  await expect(page.getByTestId('loading-tip')).not.toBeEmpty();
  await page.getByTestId('tip-next').click();
  await expect(page.getByTestId('loading-tip')).not.toBeEmpty();

  await page.screenshot({ path: 'test-results/menu.png', fullPage: true });
  expectCleanConsole(log);
});

test('nová hra: výběr balíčku, síly piva a seedu → herní obrazovka, pak Pokračovat', async ({ page }) => {
  const log = watchConsole(page);
  await presetUnlockedProfile(page);
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-new-game').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'newGame');

  const decks = page.getByRole('radiogroup', { name: 'Balíček' }).getByRole('radio');
  expect(await decks.count()).toBeGreaterThan(1);
  await expect(page.getByTestId('deck-pub')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('deck-pub')).toBeFocused();

  // Myš i klávesnice (šipky v radiogroup).
  await page.getByTestId('deck-marias').click();
  await expect(page.getByTestId('deck-marias')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('deck-pub')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('deck-court')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('deck-court')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('deck-marias')).toHaveAttribute('aria-checked', 'true');

  // Síla piva: popis kumulativních ztížení.
  const stakes = page.getByRole('radiogroup', { name: 'Síla piva' }).getByRole('radio');
  await expect(stakes).toHaveCount(8);
  await page.getByTestId('stake-3').click();
  await expect(page.getByTestId('stake-3')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('stake-rules').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('stake-rules')).toContainText('Jedenáctka');
  await expect(page.getByTestId('stake-rules')).toContainText('Dvanáctka');

  // Seed: Náhodný vyplní pole, vlastní seed se převede na velká písmena; Enter v poli spustí hru.
  await page.getByTestId('seed-random').click();
  await expect(page.getByTestId('seed-input')).toHaveValue(/^[A-Z2-9]{8}$/);
  // Neplatný seed (I, O, 0, 1 a krátký) hra odmítne s hláškou a nespustí.
  await page.getByTestId('seed-input').fill('pivo1');
  await expect(page.getByTestId('seed-status')).toHaveAttribute('data-state', 'error');
  await page.getByTestId('seed-input').press('Enter');
  await expect(screen(page)).toHaveAttribute('data-screen', 'newGame');
  await page.getByTestId('seed-input').fill('zelvy234');
  await expect(page.getByTestId('seed-status')).toHaveAttribute('data-state', 'seeded');
  await page.getByTestId('seed-input').press('Enter');
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');

  const run = await storedRun(page);
  expect(run?.data.seed).toBe('ZELVY234');
  expect(run?.data.deckId).toBe('marias');
  expect(run?.data.stake).toBe(3);

  // Po reloadu jde rozehraná hra obnovit.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await expect(page.getByTestId('menu-continue')).toBeEnabled();
  await page.getByTestId('menu-continue').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');

  expectCleanConsole(log);
});

test('nová hra přes rozehraný run se ptá; Esc dialog zavře a focus se vrátí', async ({ page }) => {
  const log = watchConsole(page);
  await presetUnlockedProfile(page);
  await page.goto('/?tutorial=off');
  await startRun(page, 'PRVNHRA2');
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('seed-input').fill('DRUHY222');
  await page.getByTestId('newgame-start').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  // Nebezpečná akce: výchozí focus je na Zrušit.
  await expect(page.getByTestId('confirm-cancel')).toBeFocused();
  // Focus trap: Tab koluje uvnitř dialogu.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(screen(page)).toHaveAttribute('data-screen', 'newGame');
  await expect(page.getByTestId('newgame-start')).toBeFocused();
  expect((await storedRun(page))?.data.seed).toBe('PRVNHRA2');

  await page.getByTestId('newgame-start').click();
  await page.getByTestId('confirm-ok').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'game');
  expect((await storedRun(page))?.data.seed).toBe('DRUHY222');
  expectCleanConsole(log);
});

test('nastavení: barvoslepý režim přidá třídu na <html> a přežije reload', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-settings').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  await expect(page.locator('html')).not.toHaveClass(/colorblind/);

  await page.locator('label[for="settings-colorblind"]').click();
  await expect(page.getByTestId('settings-colorblind')).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/colorblind/);

  // Rychlost hry a velikost UI se promítnou do CSS proměnných.
  await page.locator('label:has([data-testid="settings-speed-3"])').click();
  await expect(page.locator('html')).toHaveAttribute('style', /--speed: 3/);
  await page.getByTestId('settings-ui-scale').fill('120');
  await expect(page.locator('html')).toHaveAttribute('style', /--ui-scale: 1\.2/);
  await expect(page.getByTestId('keys-table')).toContainText('Enter');

  await page.reload();
  await expect(page.locator('html')).toHaveClass(/colorblind/);
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-colorblind')).toBeChecked();
  await expect(page.getByTestId('settings-speed-3')).toBeChecked();

  // Esc vrátí do menu i z přepínače.
  await page.getByTestId('settings-colorblind').focus();
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  expectCleanConsole(log);
});

test('titulky obsahují „Balatro“, písmo a atribuci game-icons s autory', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-credits').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'credits');
  const roll = page.getByTestId('credits-roll');
  await expect(roll).toContainText('Balatro');
  await expect(roll).toContainText('game-icons.net');
  await expect(roll).toContainText('CC BY 3.0');
  await expect(roll).toContainText('Pixelify Sans');
  await expect(roll).toContainText('Open Font License');
  await expect(page.getByTestId('credits-icon-authors')).toContainText('Delapouite');
  await expect(page.getByTestId('credits-icon-authors')).toContainText('Lorc');

  // Rolování jde zastavit (statické, posouvatelné titulky).
  await expect(page.locator('.credits')).toHaveClass(/credits--rolling/);
  await page.getByTestId('credits-toggle').click();
  await expect(page.locator('.credits')).toHaveClass(/credits--static/);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  expectCleanConsole(log);
});

test('export uložení stáhne JSON s profilem, nastavením a rozehranou hrou; import ho vrátí', async ({
  page,
}) => {
  const log = watchConsole(page);
  await presetUnlockedProfile(page);
  await page.goto('/?tutorial=off');
  await startRun(page, 'EXPRT222');
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-settings').click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^karban-ulozeni-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported.format).toBe('karban-export');
  expect(exported.version).toBe(1);
  expect(exported.settings.colorblind).toBe(false);
  expect(exported.run.format).toBe('karban-save');
  expect(exported.run.data.seed).toBe('EXPRT222');
  await expect(page.getByTestId('toast-success')).toBeVisible();

  // Neplatný soubor → chybové oznámení, nic se nezmění.
  await page.getByTestId('settings-import-file').setInputFiles({
    name: 'nakup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('rohlíky, máslo, pivo'),
  });
  await expect(page.getByTestId('toast-import-error')).toContainText('JSON');
  expect((await storedRun(page))?.data.seed).toBe('EXPRT222');

  // Platný export (s barvoslepým režimem) → potvrzení → nahráno.
  exported.settings.colorblind = true;
  await page.getByTestId('settings-import-file').setInputFiles({
    name: 'karban.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast-import-done')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/colorblind/);
  expect((await storedRun(page))?.data.seed).toBe('EXPRT222');
  expectCleanConsole(log);
});

test('reset profilu vyžaduje dvojí potvrzení', async ({ page }) => {
  const log = watchConsole(page);
  await presetUnlockedProfile(page);
  await page.goto('/?tutorial=off');
  await startRun(page, 'RESET222');
  await page.goto('/?tutorial=off');
  await page.getByTestId('menu-settings').click();

  // První potvrzení zrušené → nic se nestane, focus zpět na tlačítku.
  await page.getByTestId('settings-reset').click();
  await expect(page.getByTestId('reset-confirm-1')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('settings-reset')).toBeFocused();
  expect(await storedRun(page)).not.toBeNull();

  // Obě potvrzení → smazáno.
  await page.getByTestId('settings-reset').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('reset-confirm-2')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast-reset-done')).toBeVisible();
  expect(await storedRun(page)).toBeNull();

  await page.getByTestId('back').click();
  await expect(page.getByTestId('menu-continue')).toBeDisabled();
  expectCleanConsole(log);
});
