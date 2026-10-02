/**
 * Konzole bez chyb a varování na všech obrazovkách mimo hru (CLAUDE.md kap. 8 a 10): s profilem, kde je všechno
 * odemčené a objevené, projde každou záložku sbírky (s detailem první položky), statistik, všechny výzvy, denní run,
 * titulky, galerii grafiky a nastavení (přepínače, export). Líně načítané obrazovky se při tom načítají z chunků.
 */
import { expect, test, type Page } from '@playwright/test';
import { createProfile, serializeProfile } from '../../src/engine/meta';
import { REG, expectCleanConsole, watchConsole } from './helpers';

const NOW = '2026-10-02T00:00:00.000Z';
// Záložky jako v src/ui/screens/{collection,stats}.ts (moduly obrazovek importují CSS, Node je nenačte).
const COLLECTION_TABS = [
  'jokers',
  'pranostiky',
  'rady',
  'razitka',
  'vouchers',
  'boosters',
  'tags',
  'bosses',
  'decks',
  'stakes',
  'mods',
  'hands',
  'challenges',
  'achievements',
];
const STATS_TABS = ['overview', 'decks', 'stakes', 'bosses', 'history', 'daily'];

/** Profil se vším odemčeným a objeveným (sbírka pak ukazuje plné detaily, ne siluety). */
function fullProfile(): string {
  const p = createProfile(NOW, { animations: false, tutorial: false });
  p.unlocks = {
    decks: Object.keys(REG.decks),
    stakes: Object.fromEntries(Object.keys(REG.decks).map((id) => [id, 8])),
    jokers: Object.keys(REG.jokers),
    vouchers: Object.keys(REG.vouchers),
    challenges: Object.keys(REG.challenges),
  };
  p.discovered.jokers = Object.keys(REG.jokers);
  p.discovered.consumables = Object.keys(REG.consumables);
  p.discovered.vouchers = Object.keys(REG.vouchers);
  p.discovered.boosters = Object.keys(REG.boosters);
  p.discovered.bosses = Object.keys(REG.bosses);
  p.discovered.tags = Object.keys(REG.tags);
  p.discovered.decks = Object.keys(REG.decks);
  p.discovered.enhancements = Object.keys(REG.enhancements);
  p.discovered.seals = Object.keys(REG.seals);
  p.discovered.editions = Object.keys(REG.editions);
  p.stats.runs.won = 10;
  p.stats.runs.played = 12;
  return serializeProfile(p, NOW);
}

const screen = (page: Page) => page.locator('#app');

async function backToMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
}

test('všechny obrazovky mimo hru bez chyb a varování v konzoli', async ({ page }) => {
  test.setTimeout(120_000);
  const log = watchConsole(page);
  await page.addInitScript((value) => {
    if (!localStorage.getItem('karban.profile')) localStorage.setItem('karban.profile', value);
  }, fullProfile());
  await page.goto('/?tutorial=off');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Sbírka: každá záložka, detail první položky.
  await page.getByTestId('menu-collection').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'collection');
  for (const tab of COLLECTION_TABS) {
    await page.getByTestId(`codex-tab-${tab}`).click();
    const first = page.locator('[data-testid^="codex-item-"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByTestId('codex-detail')).toBeVisible();
    await page.getByTestId('codex-detail-close').click();
  }
  await backToMenu(page);

  // Statistiky: každá záložka.
  await page.getByTestId('menu-stats').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'stats');
  for (const tab of STATS_TABS) {
    await page.getByTestId(`stats-tab-${tab}`).click();
    await expect(page.getByTestId(`stats-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  }
  await backToMenu(page);

  // Výzvy: každá v seznamu (detail s pravidly).
  await page.getByTestId('menu-challenges').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'challenges');
  for (const id of Object.keys(REG.challenges)) await page.getByTestId(`challenge-${id}`).click();
  await expect(page.getByTestId('challenge-start')).toBeEnabled();
  await backToMenu(page);

  // Denní run a titulky.
  await page.getByTestId('menu-daily').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'daily');
  await expect(page.getByTestId('daily-play')).toBeVisible();
  await backToMenu(page);
  await page.getByTestId('menu-credits').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'credits');
  await backToMenu(page);

  // Nastavení: přepínače tam a zpět, export.
  await page.getByTestId('menu-settings').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  for (const id of ['settings-colorblind', 'settings-shake', 'settings-animations', 'settings-mute']) {
    const label = page.locator(`label[for="${id}"]`);
    const before = await page.getByTestId(id).isChecked();
    await label.click();
    await expect(page.getByTestId(id)).toBeChecked({ checked: !before });
    await label.click();
    await expect(page.getByTestId(id)).toBeChecked({ checked: before });
  }
  const download = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  await download;
  await backToMenu(page);

  // Vývojářská galerie grafiky (#gallery) — všechny žolíky, karty a žetony naráz.
  await page.goto('/?tutorial=off#gallery');
  await expect(screen(page)).toHaveAttribute('data-screen', 'gallery');
  await expect(page.locator('.art-svg').first()).toBeVisible();

  expectCleanConsole(log);
});
