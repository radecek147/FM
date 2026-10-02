/**
 * Prvky, které se při najetí myší posunou nahoru, se nesmí třást, když kurzor stojí u jejich spodní hrany
 * (posun by kurzor z prvku „vysunul“, hover zmizel a prvek sjel zpět — dokola). Našel to ui-walkthrough
 * (karta v ruce „not stable“ po kliku na Přeskočit, kurzor zůstal nad spodní hranou karty). Oprava: pás pod
 * posunutým prvkem v src/ui/styles/fx.css.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  continueRun,
  expectCleanConsole,
  handCards,
  presetSettings,
  roundState,
  seedSavedRun,
  watchConsole,
} from './helpers';

/** Polohy prvku v 12 po sobě jdoucích snímcích (jedinečné hodnoty). */
async function framePositions(page: Page, target: Locator): Promise<string[]> {
  const handle = await target.elementHandle();
  return page.evaluate(
    (el) =>
      new Promise<string[]>((resolve) => {
        const out = new Set<string>();
        let n = 0;
        const step = (): void => {
          const r = el!.getBoundingClientRect();
          out.add(`${r.x.toFixed(1)},${r.y.toFixed(1)}`);
          if (++n < 12) requestAnimationFrame(step);
          else resolve([...out]);
        };
        requestAnimationFrame(step);
      }),
    handle,
  );
}

/** Kurzor těsně nad spodní hranou prvku (v pásu, o který se prvek při hoveru posune). */
async function hoverBottomEdge(page: Page, target: Locator, inset = 2): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - inset);
  // Doběhnutí přechodu transformace (rychlost 1×: --t-fast).
  await page.waitForTimeout(400);
}

test('karta v ruce a tlačítko menu se u spodní hrany při hoveru netřesou', async ({ page }) => {
  const log = watchConsole(page);
  await presetSettings(page, { animations: true, speed: 1 });
  await seedSavedRun(page, roundState('HOVERAAA'));
  await continueRun(page);

  const card = handCards(page).nth(1);
  await hoverBottomEdge(page, card);
  const positions = await framePositions(page, card);
  expect(positions, 'karta se nesmí v každém snímku posouvat nahoru a dolů').toHaveLength(1);
  // Karta je opravdu „zvednutá“ hoverem (kurzor zůstal nad ní).
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');

  await page.goto('/?tutorial=off');
  const item = page.getByTestId('menu-new-game');
  await expect(item).toBeVisible();
  await hoverBottomEdge(page, item, 1);
  expect(await framePositions(page, item)).toHaveLength(1);

  expectCleanConsole(log);
});
