/**
 * Průchod celým runem přes UI (QA fáze 3+): bot z enginu rozhoduje, prohlížeč akce provádí klávesami a myší
 * (střídavě), po každé akci se uložený stav (`karban.run`) porovná s tím, co by z předchozího uloženého stavu
 * udělal engine sám. Cestou dvakrát obnoví stránku (autosave → Pokračovat) a po výhře přejde do Nekonečného
 * režimu. Hlídá i konzoli (chyby a varování) a peníze / skóre v DOM.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npx tsx scripts/ui-walkthrough.ts [--seed WALK1] [--bot max|flush|pairs|econ] [--anim] [--url http://localhost:4173/]
 *
 * Výstup: JSON se souhrnem (fáze, akce, rozdíly, konzole); nenulový návratový kód při rozdílu nebo chybě.
 * Ruku UI libovolně přeřadit neumí (jen třídění) — akci `reorderHand` bot nahradí navazující akcí s cíli
 * v pořadí ruky.
 */
import { chromium, type Page } from '@playwright/test';
import { registry } from '../src/content';
import { Game, createBot, deserializeRun, type Action, type BotName, type RunState } from '../src/engine';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const SEED = arg('seed', 'WALK1');
const BOT = arg('bot', 'max') as Exclude<BotName, 'random'>;
const URL = arg('url', 'http://localhost:4173/');
const ANIM = process.argv.includes('--anim');
const MAX_TURNS = Number(arg('max-turns', '700'));
const RELOAD_AT = new Set([30, 61]);
const ENDLESS_TURNS = 40;

const reg = registry();
const bot = createBot(BOT);

function diff(x: unknown, y: unknown, path = ''): string[] {
  if (JSON.stringify(x) === JSON.stringify(y)) return [];
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null)
    return [`${path}: ${JSON.stringify(x)?.slice(0, 80)} ≠ ${JSON.stringify(y)?.slice(0, 80)}`];
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].flatMap((k) =>
    diff((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`),
  );
}

const handOf = (s: RunState): number[] =>
  s.phase === 'booster' && s.booster ? [...s.booster.hand] : [...(s.round?.hand ?? [])];
const inHandOrder = (hand: readonly number[], ids: readonly number[] = []): number[] =>
  hand.filter((id) => ids.includes(id));

/** Akce bota převedená na to, co UI umí: výběr karet vždy v pořadí ruky, bez libovolného přeřazení ruky. */
function decide(s: RunState): Action {
  let action = bot.decide(Game.fromState(structuredClone(s), reg));
  if (action.type === 'reorderHand') {
    const clone = Game.fromState(structuredClone(s), reg);
    clone.dispatch(action);
    action = bot.decide(clone);
  }
  const hand = handOf(s);
  if ('targetIds' in action && action.targetIds)
    action = { ...action, targetIds: inHandOrder(hand, action.targetIds) } as Action;
  if (action.type === 'play' || action.type === 'discard')
    action = { ...action, cardIds: inHandOrder(hand, action.cardIds) };
  return action;
}

const browser = await chromium.launch();
const page: Page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(15_000);
const consoleLog: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => consoleLog.push(`pageerror: ${e.message}`));
await page.addInitScript((anim) => {
  if (!localStorage.getItem('karban.settings'))
    localStorage.setItem('karban.settings', JSON.stringify(anim ? { speed: 4 } : { animations: false }));
}, ANIM);

const idle = async (): Promise<void> => {
  await page.waitForSelector('.game:not(.is-busy)', { timeout: 30_000 });
};
const phase = async (): Promise<string> => (await page.locator('.game').getAttribute('data-phase')) ?? '';
const readRun = async (): Promise<RunState | null> => {
  const raw = await page.evaluate(() => localStorage.getItem('karban.run'));
  return raw ? deserializeRun(raw) : null;
};
const continueFromMenu = async (): Promise<void> => {
  await page.reload();
  await page.getByTestId('menu-continue').click();
  await page.waitForSelector('.game[data-phase]');
  await idle();
};

/** Vybere karty (klávesy 1–9, jinak klik) podle pozice v aktuální ruce. */
async function select(hand: readonly number[], ids: readonly number[], mouse: boolean): Promise<void> {
  for (const id of ids) {
    const i = hand.indexOf(id);
    if (i < 0) throw new Error(`karta ${id} není v ruce`);
    if (!mouse && i < 9) await page.keyboard.press(String(i + 1));
    else await page.getByTestId('hand').locator(`[data-card-id="${id}"]`).click();
  }
}

/** Provede akci v UI. */
async function perform(s: RunState, action: Action, mouse: boolean): Promise<void> {
  const hand = handOf(s);
  const click = (testId: string) => page.getByTestId(testId).click();
  switch (action.type) {
    case 'selectBlind':
      if (mouse) await click(`blind-select-${s.blinds[s.blindIndex]!.kind}`);
      else await page.keyboard.press('Enter');
      return;
    case 'skipBlind':
      return click(`blind-skip-${s.blinds[s.blindIndex]!.kind}`);
    case 'play':
      await select(hand, action.cardIds, mouse);
      if (mouse) await click('play');
      else await page.keyboard.press('Enter');
      if (ANIM && !mouse) await page.keyboard.press(' ');
      return;
    case 'discard':
      await select(hand, action.cardIds, mouse);
      if (mouse) await click('discard');
      else await page.keyboard.press('x');
      return;
    case 'sortHand':
      return page.keyboard.press(action.by === 'rank' ? 's' : 'b');
    case 'cashOut':
      if (mouse) await click('cash-out');
      else await page.keyboard.press('Enter');
      return;
    case 'buy':
      return click(`shop-buy-${action.slot}`);
    case 'buyAndUse':
      return click(`shop-use-${action.slot}`);
    case 'buyBooster':
      return click(`shop-open-${action.slot}`);
    case 'buyVoucher':
      return click(`shop-redeem-${action.slot}`);
    case 'reroll':
      return click('shop-reroll');
    case 'leaveShop':
      return click('shop-continue');
    case 'skipBooster':
      return click('booster-skip');
    case 'pickBooster': {
      const opt = s.booster!.options[action.index]!;
      if (opt.kind === 'consumable' && action.keep) return click(`booster-keep-${action.index}`);
      if (opt.kind === 'consumable') {
        await select(hand, action.targetIds ?? [], mouse);
        return click(`booster-use-${action.index}`);
      }
      return click(`booster-take-${action.index}`);
    }
    case 'sellJoker':
      await page.locator(`[data-joker-uid="${action.uid}"]`).click();
      return click('joker-sell');
    case 'sellConsumable':
      await page.locator(`[data-consumable-uid="${action.uid}"]`).click();
      return click('consumable-sell');
    case 'useConsumable':
      await select(hand, action.targetIds ?? [], mouse);
      await page.locator(`[data-consumable-uid="${action.uid}"]`).click();
      return click('consumable-use');
    case 'reorderJokers':
      // Detail žolíka → „Posunout doleva“, dokud není na svém místě (přesun klávesnicí / myší bez tažení).
      for (let i = 0; i < action.uids.length; i++) {
        const uid = action.uids[i]!;
        let p = (await readRun())!.jokers.findIndex((j) => j.uid === uid);
        if (p === i) continue;
        await page.locator(`[data-joker-uid="${uid}"]`).click();
        for (; p > i; p--) {
          await click('joker-move-left');
          await idle();
        }
        await page.keyboard.press('Escape');
      }
      return;
    default:
      throw new Error(`akce ${action.type} nemá v průchodu obsluhu`);
  }
}

await page.goto(URL);
await page.getByTestId('menu-new-game').click();
await page.getByTestId('seed-input').fill(SEED);
await page.getByTestId('newgame-start').click();
await page.waitForSelector('.game[data-phase]');

const phases: Record<string, number> = {};
const actions: Record<string, number> = {};
const mismatches: string[] = [];
let turn = 0;
let reloads = 0;
let endlessTurns = -1;

try {
  for (; turn < MAX_TURNS; turn++) {
    const ph = await phase();
    phases[ph] = (phases[ph] ?? 0) + 1;
    if (ph === 'game_over') break;
    if (ph === 'victory') {
      if (endlessTurns >= 0) break;
      // Výhra se ukládá: reload → Pokračovat → Nekonečný režim.
      await continueFromMenu();
      await page.getByTestId('victory-endless').click();
      await idle();
      endlessTurns = 0;
      continue;
    }
    if (endlessTurns >= 0 && ++endlessTurns > ENDLESS_TURNS) break;
    if (RELOAD_AT.has(turn)) {
      const before = (await readRun())!;
      await continueFromMenu();
      const after = (await readRun())!;
      if (JSON.stringify(before) !== JSON.stringify(after))
        mismatches.push(`tah ${turn}: reload změnil stav`);
      reloads++;
    }

    const s = await readRun();
    if (!s) throw new Error('chybí uložený run');
    if (s.phase !== ph) mismatches.push(`tah ${turn}: fáze v DOM ${ph} ≠ uložená ${s.phase}`);
    const action = decide(s);
    actions[action.type] = (actions[action.type] ?? 0) + 1;
    const expected = Game.fromState(structuredClone(s), reg);
    const res = expected.dispatch(action);
    if (!res.ok) throw new Error(`bot navrhl neplatnou akci ${JSON.stringify(action)} (${res.error})`);

    await perform(s, action, turn % 3 === 0);
    await idle();

    const exp = expected.state;
    const after = await readRun();
    if (exp.phase === 'game_over') {
      if (after !== null) mismatches.push(`tah ${turn}: po prohře zůstal uložený run`);
      continue;
    }
    if (!after) throw new Error(`uložený run zmizel po ${action.type}`);
    const d = diff(after, exp);
    if (d.length > 0) {
      mismatches.push(`tah ${turn}: ${JSON.stringify(action)} → ${d.slice(0, 8).join('; ')}`);
      break;
    }
    const money = Number(((await page.getByTestId('money').textContent()) ?? '').replace(/[^\d-]/g, ''));
    if (money !== exp.money) mismatches.push(`tah ${turn}: peníze v DOM ${money} ≠ ${exp.money}`);
    if (exp.phase === 'round') {
      const text = (await page.getByTestId('round-score').textContent()) ?? '';
      if (Number(text.replace(/[^\d]/g, '')) !== exp.round!.score)
        mismatches.push(`tah ${turn}: skóre v DOM ${text} ≠ ${exp.round!.score}`);
    }
  }
} catch (err) {
  mismatches.push(`tah ${turn}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
}

const summary = {
  seed: SEED,
  bot: BOT,
  animations: ANIM,
  turns: turn,
  final: await phase(),
  ante: await page.getByTestId('ante').textContent(),
  reloads,
  endlessTurns: Math.max(0, endlessTurns),
  phases,
  actions,
  mismatches,
  console: consoleLog,
};
await browser.close();
console.log(JSON.stringify(summary, null, 2));
process.exitCode = mismatches.length > 0 || consoleLog.length > 0 ? 1 : 0;
