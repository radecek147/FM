import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/content';
import { Game, serializeRun, type RunState } from '../../src/engine';

/**
 * Herní obrazovka: výběr útraty, výběr karet klávesami, myší i dotykem, zahrání a zahození, třídění,
 * náhled balíčku, Info o runu, pauza, pitva a Večerka (nákup a prodej žolíka). Konzole bez chyb a varování.
 */

interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

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

const game = (page: Page) => page.locator('.game');

async function startRun(page: Page, seed: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('newgame-start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'game');
}

/** Počká, až doběhnou animace (presenter). */
async function idle(page: Page): Promise<void> {
  await expect(game(page)).not.toHaveClass(/is-busy/, { timeout: 30_000 });
}

/** Uložený run v dané fázi (upravený stav enginu) — vloží se do localStorage před načtením stránky. */
async function seedSavedRun(page: Page, patch: (s: RunState) => void): Promise<void> {
  const state = structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed: 'E2EVECER' }, registry()).state);
  patch(state as RunState);
  const raw = serializeRun(state as RunState, '2026-10-01T00:00:00.000Z');
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('karban.run', value);
      sessionStorage.setItem('seeded', '1');
    }
  }, raw);
}

test('kolo klávesnicí: výběr útraty, 1–8, živý náhled, Enter, X, S, balíček, Info o runu, pauza', async ({
  page,
}) => {
  const log = watchConsole(page);
  await startRun(page, 'KARBAN1');
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  await expect(page.locator('.blind-card')).toHaveCount(3);
  await expect(page.getByTestId('blind-select-small')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await idle(page);
  const hand = page.getByTestId('hand').locator('.pcard');
  await expect(hand).toHaveCount(8);

  // Výběr klávesami a živý náhled čipy × mult.
  await expect(page.getByTestId('hand-name')).toHaveText('Vyber karty');
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(hand.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(hand.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hand-name')).not.toHaveText('Vyber karty');
  await expect(page.getByTestId('hand-chips')).not.toHaveText('0');
  await expect(page.getByTestId('play')).toBeEnabled();
  await page.screenshot({ path: 'test-results/game-select.png' });

  // Zahrát: karty na stůl, skóre kola roste, ruka se doplní.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('table').locator('.pcard')).not.toHaveCount(0);
  await idle(page);
  await expect(page.getByTestId('round-score')).not.toHaveText('0');
  await expect(page.getByTestId('hands-left')).toHaveText('3');
  await expect(hand).toHaveCount(8);
  await page.screenshot({ path: 'test-results/game-after-play.png' });

  // Zahodit klávesou X.
  await page.keyboard.press('3');
  await page.keyboard.press('x');
  await idle(page);
  await expect(page.getByTestId('discards-left')).toHaveText('2');
  await expect(hand).toHaveCount(8);

  // Třídění podle hodnoty (S).
  await page.keyboard.press('s');
  await idle(page);
  const ranks = await hand.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  expect(ranks).toHaveLength(8);

  // Náhled balíčku.
  await page.getByTestId('deck').click();
  await expect(page.getByTestId('deck-modal')).toBeVisible();
  await expect(page.getByTestId('deck-modal').locator('.deck-mini')).toHaveCount(52);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('deck-modal')).toHaveCount(0);

  // Info o runu: tajné kombinace jako ???.
  await page.getByTestId('run-info').click();
  await expect(page.getByTestId('run-info-hands').locator('tr.is-secret')).toHaveCount(3);
  await expect(page.getByTestId('run-info-seed')).toContainText('KARBAN1');
  await page.keyboard.press('Escape');

  // Esc ve hře = pauza; Pokračovat vrátí do hry.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-modal')).toBeVisible();
  await expect(page.getByTestId('pause-resume')).toBeFocused();
  await page.getByTestId('pause-resume').click();
  await expect(page.getByTestId('pause-modal')).toHaveCount(0);

  // Autosave: po reloadu Pokračovat obnoví rozehrané kolo.
  await page.reload();
  await page.getByTestId('menu-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'round');
  await expect(page.getByTestId('hands-left')).toHaveText('3');
  await expect(page.getByTestId('discards-left')).toHaveText('2');
  expectCleanConsole(log);
});

test('run do konce bez animací: pitva s hláškou, seedem a Novou hrou (uložený run zmizí)', async ({
  page,
}) => {
  const log = watchConsole(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('karban.settings'))
      localStorage.setItem('karban.settings', JSON.stringify({ animations: false }));
  });
  await startRun(page, 'PITVA1');
  await page.getByTestId('blind-select-small').click();
  // Hraje vždy jen jednu kartu — Malá útrata se tak vyhrát nedá.
  for (let i = 0; i < 4; i++) {
    await expect(game(page)).toHaveAttribute('data-phase', 'round');
    await page.getByTestId('hand').locator('.pcard').first().click();
    await page.getByTestId('play').click();
    await idle(page);
  }
  await expect(game(page)).toHaveAttribute('data-phase', 'game_over');
  await expect(page.getByTestId('game-over')).toContainText('Pitva');
  await expect(page.getByTestId('death-quote')).toContainText('Malé útratě');
  await expect(page.getByTestId('run-seed')).toHaveText('PITVA1');
  await expect(page.getByTestId('run-stats')).toContainText('Zahrané ruce');
  expect(await page.evaluate(() => localStorage.getItem('karban.run'))).toBeNull();
  await page.screenshot({ path: 'test-results/game-over.png' });

  await page.getByTestId('game-over-new').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'newGame');
  expectCleanConsole(log);
});

test('Večerka: koupit žolíka, detail s prodejem, Pokračovat k výběru útraty', async ({ page }) => {
  const log = watchConsole(page);
  const jokerId = Object.keys(registry().jokers)[0]!;
  await seedSavedRun(page, (s) => {
    s.phase = 'shop';
    s.money = 10;
    s.shop = {
      items: [
        {
          kind: 'joker',
          joker: {
            uid: 900,
            defId: jokerId,
            edition: null,
            state: {},
            sellBonus: 0,
            stickers: [],
            debuffed: false,
          },
          price: 4,
          sold: false,
        },
      ],
      boosters: [],
      vouchers: [],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
  });
  await page.goto('/');
  await page.getByTestId('menu-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'shop');
  await expect(page.getByTestId('shop')).toContainText('Večerka');
  await expect(page.getByTestId('shop-reroll')).toBeEnabled();

  await page.getByTestId('shop-buy-0').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('1/5');
  await expect(page.getByTestId('money')).toHaveText('6 Kč');
  await expect(page.getByTestId('shop-empty')).toContainText('Večerka zavřená');
  await page.screenshot({ path: 'test-results/game-shop.png' });

  await page.getByTestId('joker-row').locator('.kcard').first().click();
  await expect(page.getByTestId('joker-detail')).toBeVisible();
  await page.getByTestId('joker-sell').click();
  await idle(page);
  await expect(page.getByTestId('joker-count')).toHaveText('0/5');

  await page.getByTestId('shop-continue').click();
  await expect(game(page)).toHaveAttribute('data-phase', 'blind_select');
  expectCleanConsole(log);
});

test.describe('dotyk', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tap vybere kartu, druhý tap výběr zruší', async ({ page }) => {
    const log = watchConsole(page);
    await startRun(page, 'DOTYK1');
    await page.getByTestId('blind-select-small').tap();
    await expect(game(page)).toHaveAttribute('data-phase', 'round');
    await idle(page);
    const first = page.getByTestId('hand').locator('.pcard').first();
    await first.tap();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.tap();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    expectCleanConsole(log);
  });
});
