/**
 * Snímky obrazovek a animovaný GIF do README (`docs/media/`).
 *
 *   npx tsx scripts/readme-media.ts [--no-build] [--only menu,shop,…] [--no-gif] [--port 4180]
 *
 * Skript sestaví hru (`npm run build`, s `--no-build` použije existující `dist/`), spustí `vite preview`,
 * stavy připraví enginem v Node (uložený run a profil vloží do localStorage stejně jako e2e testy) a projde
 * obrazovky v Chromiu z Playwrightu v rozlišení 1366×768. GIF vzniká ze záznamu obrazovky (CDP screencast),
 * snímky se převzorkují na stálou snímkovou frekvenci a do GIFu je převede `ffmpeg` (paleta + rozdílové snímky);
 * bez `ffmpeg` na PATH (nebo v proměnné `FFMPEG`) se GIF přeskočí. Výstup je deterministický až na časování
 * animací (seed i stavy jsou pevné).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { registry } from '../src/content';
// Moduly enginu přímo (ne přes `src/engine/index.ts`): skript nepotřebuje simulaci a botům se tak vyhne.
import {
  DISCOVERY_CATEGORIES,
  createProfile,
  refreshMeta,
  serializeProfile,
  type DiscoveryCategory,
  type Profile,
} from '../src/engine/meta';
import { Game } from '../src/engine/run/game';
import { niceRound } from '../src/engine/run/targets';
import { serializeRun } from '../src/engine/save/save';
import {
  HAND_TYPES,
  type Card,
  type EditionId,
  type JokerInstance,
  type Rank,
  type RunState,
  type Suit,
} from '../src/engine/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/media');
const REG = registry();
const NOW = '2026-10-02T18:00:00.000Z';
const SEED = 'KARBANKA';
const VIEWPORT = { width: 1366, height: 768 };

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}
const PORT = Number(arg('port') ?? 4180);
const BASE = `http://localhost:${PORT}/`;
const ONLY = arg('only')?.split(',').filter(Boolean) ?? null;
const wanted = (name: string): boolean => !ONLY || ONLY.includes(name);

// ─────────────────────────── Stavy z enginu ───────────────────────────

const ids = (rec: Record<string, unknown>): string[] => Object.keys(rec);

function joker(s: RunState, defId: string, edition: EditionId | null = null): JokerInstance {
  const def = REG.jokers[defId];
  if (!def) throw new Error(`Neznámý žolík ${defId}`);
  return {
    uid: s.nextUid++,
    defId,
    edition,
    state: def.initState ? (structuredClone(def.initState() ?? {}) as JokerInstance['state']) : {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
  };
}

/** Žolíci na ukázku: reagují na Full house s králi a srdci, různé vzácnosti a edice. */
const SHOWCASE_JOKERS: Array<[string, EditionId | null]> = [
  ['hearts_man', null],
  ['beer_mat', 'holo'],
  ['party_for_two', null],
  ['derby_fans', 'foil'],
  ['round_for_everyone', 'poly'],
];

/** Run ve 3. patře na výběru útraty: pět žolíků, šéf Soused s vrtačkou. */
function showcaseBase(): RunState {
  const s = structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed: SEED }, REG).state) as RunState;
  s.ante = 3;
  s.money = 17;
  s.stats.roundsWon = 6;
  s.jokers = SHOWCASE_JOKERS.map(([id, ed]) => joker(s, id, ed));
  s.blinds[2]!.bossId = 'drilling_neighbor';
  Object.assign(s.stats, {
    handsPlayed: 17,
    discardsUsed: 11,
    cardsPlayed: 64,
    cardsDiscarded: 38,
    bestHandScore: 2940,
    bestHandType: 'flush',
    moneyEarned: 58,
    moneySpent: 41,
    jokersBought: 6,
    jokersSold: 1,
    consumablesUsed: 4,
    rerolls: 3,
    shopsEntered: 6,
    blindsSkipped: 1,
    bossesDefeated: 2,
    roundsWon: 6,
    handTypeCounts: { pair: 6, flush: 4, two_pair: 3, three: 2, high_card: 2 },
  });
  return s;
}

type CardSpec = [Suit, Rank, string | null, string | null, EditionId | null];
/** Ruka po rozdání (seřazená podle hodnoty): tři králové, dvě sedmy a tři „vatové“ karty. */
const SHOWCASE_HAND: CardSpec[] = [
  ['H', 13, null, null, 'foil'],
  ['S', 13, null, null, null],
  ['D', 13, 'mult', null, null],
  ['C', 11, null, null, null],
  ['D', 9, null, null, null],
  ['H', 7, null, 'red', null],
  ['C', 7, null, null, null],
  ['S', 2, null, null, null],
];
/** Pozice (od 0) karet Full house v ruce. */
const FULL_HOUSE = [0, 1, 2, 5, 6];

/** Malá útrata 3. patra s připravenou rukou; cíl je nad skóre jedné ruky, aby kolo po zahrání neskončilo. */
function showcaseRound(): RunState {
  const g = Game.fromState(showcaseBase(), REG);
  const res = g.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl výběr útraty: ${res.error}`);
  const s = structuredClone(g.state) as RunState;
  const round = s.round!;
  round.hand.forEach((id, i) => {
    const card = s.deck.find((c) => c.id === id) as Card;
    const [suit, rank, enhancement, seal, edition] = SHOWCASE_HAND[i]!;
    Object.assign(card, { suit, rank, enhancement, seal, edition, debuffed: false, faceDown: false });
  });
  const trial = Game.fromState(structuredClone(s), REG);
  trial.dispatch({ type: 'play', cardIds: FULL_HOUSE.map((i) => round.hand[i]!) });
  const scored = trial.state.round?.score ?? round.target;
  if (round.target < scored * 1.3) round.target = niceRound(scored * 1.8);
  return s;
}

/** Večerka se žolíky, obálkami a kupónem. */
function showcaseShop(): RunState {
  const s = showcaseBase();
  s.jokers = s.jokers.slice(0, 3);
  s.phase = 'shop';
  s.money = 31;
  const shopJoker = (id: string, ed: EditionId | null = null) => {
    const j = joker(s, id, ed);
    const price = REG.jokers[id]!.cost + (ed ? (REG.editions[ed]?.priceAdd ?? 0) : 0);
    return { kind: 'joker' as const, joker: j, price, sold: false };
  };
  const voucherId = ids(REG.vouchers).find((v) => REG.vouchers[v]!.tier === 1)!;
  s.shop = {
    items: [shopJoker('svejk'), shopJoker('krakonos', 'holo')],
    boosters: [
      { boosterId: 'rada_jumbo', price: REG.boosters.rada_jumbo!.cost, sold: false },
      { boosterId: 'joker_normal', price: REG.boosters.joker_normal!.cost, sold: false },
    ],
    vouchers: [{ voucherId, price: REG.vouchers[voucherId]!.cost, sold: false }],
    rerollCost: 5,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  return s;
}

/** Otevřená tlustá obálka babských rad (s dobranou rukou). */
function showcaseBooster(): RunState {
  const g = Game.fromState(showcaseShop(), REG);
  const res = g.dispatch({ type: 'buyBooster', slot: 0 });
  if (!res.ok) throw new Error(`Engine odmítl obálku: ${res.error}`);
  return structuredClone(g.state) as RunState;
}

/** Šéf Kontrola z finančáku, poslední ruka a nedosažitelný cíl → pitva po zahrání. */
function showcaseDoomed(): RunState {
  const s = showcaseBase();
  s.ante = 4;
  s.blindIndex = 2;
  s.blinds.forEach((b, i) => (b.status = i < 2 ? 'defeated' : 'current'));
  s.blinds[2]!.bossId = 'tax_audit';
  Object.assign(s.stats, {
    handsPlayed: 31,
    discardsUsed: 19,
    cardsPlayed: 118,
    cardsDiscarded: 66,
    bestHandScore: 4830,
    bestHandType: 'full_house',
    moneyEarned: 97,
    moneySpent: 84,
    jokersBought: 8,
    jokersSold: 3,
    consumablesUsed: 7,
    rerolls: 5,
    shopsEntered: 10,
    bossesDefeated: 3,
    roundsWon: 11,
  });
  const g = Game.fromState(s, REG);
  const res = g.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`Engine odmítl šéfa: ${res.error}`);
  const out = structuredClone(g.state) as RunState;
  out.round!.handsLeft = 1;
  out.round!.score = Math.round(out.round!.target * 0.62);
  return out;
}

// ─────────────────────────── Profil ───────────────────────────

function allOf(c: DiscoveryCategory): string[] {
  switch (c) {
    case 'jokers':
      return ids(REG.jokers);
    case 'consumables':
      return ids(REG.consumables);
    case 'vouchers':
      return ids(REG.vouchers);
    case 'tags':
      return ids(REG.tags);
    case 'bosses':
      return ids(REG.bosses);
    case 'boosters':
      return ids(REG.boosters);
    case 'decks':
      return ids(REG.decks);
    case 'hands':
      return [...HAND_TYPES];
    case 'enhancements':
      return ids(REG.enhancements);
    case 'seals':
      return ids(REG.seals);
    case 'editions':
      return ids(REG.editions);
  }
}

/** Ohraný profil: skoro všechno objevené, dvě třetiny achievementů, statistiky a kus historie. */
function veteranProfile(settings: Partial<Profile['settings']> = {}): string {
  const p = createProfile(NOW);
  Object.assign(p.settings, { tutorial: false }, settings);
  for (const c of DISCOVERY_CATEGORIES) p.discovered[c] = allOf(c);
  // Devět neobjevených žolíků (sbírka ukáže postup), ale ne ti, kteří jsou v ukázkové Večerce.
  const hidden = ids(REG.jokers)
    .filter((j) => j !== 'krakonos')
    .slice(-9);
  p.discovered.jokers = ids(REG.jokers).filter((j) => !hidden.includes(j));
  p.discovered.hands = HAND_TYPES.filter((h) => h !== 'flush_five');
  p.unlocks.decks = ids(REG.decks);
  p.unlocks.jokers = ids(REG.jokers);
  p.unlocks.vouchers = ids(REG.vouchers);
  p.unlocks.challenges = ids(REG.challenges).slice(0, 14);
  for (const d of ids(REG.decks)) p.unlocks.stakes[d] = d === 'pub' ? 6 : 3;
  const ach = ids(REG.achievements ?? {});
  ach.forEach((id, i) => {
    if (i % 3 !== 2)
      p.achievements.unlocked[id] = `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T20:00:00.000Z`;
  });
  const s = p.stats;
  s.runs = { played: 87, won: 19, lost: 64, abandoned: 4, currentStreak: 2, bestStreak: 4 };
  ids(REG.decks).forEach((d, i) => {
    s.byDeck[d] = { played: 4 + ((i * 5) % 11), won: (i * 3) % 4, bestStake: 1 + (i % 5) };
  });
  for (let st = 1; st <= 8; st++)
    s.byStake[String(st)] = { played: Math.max(1, 30 - st * 4), won: Math.max(0, 9 - st * 2) };
  ids(REG.bosses).forEach((b, i) => {
    s.bosses[b] = { defeated: 2 + (i % 7), lostTo: i % 3 };
    if (i % 3) s.losses[b] = i % 3;
  });
  s.losses.small = 5;
  s.losses.big = 11;
  s.bestHand = { score: 3_480_200, handType: 'flush_house', seed: 'SVATOMIR', deckId: 'grandmas' };
  s.fastestWin = { hands: 31, seed: 'RYCHLYAA', deckId: 'pub', stake: 2 };
  Object.assign(s.handTypes, {
    pair: 524,
    two_pair: 311,
    flush: 287,
    three: 243,
    high_card: 191,
    straight: 158,
    full_house: 122,
    four: 35,
    straight_flush: 4,
    royal_flush: 1,
    five: 3,
    flush_house: 2,
  });
  ids(REG.challenges)
    .slice(0, 9)
    .forEach((c, i) => {
      s.challenges[c] = { attempts: 2 + (i % 4), completed: i % 3 === 0 ? 1 : 0, bestAnte: 3 + (i % 6) };
    });
  ids(REG.jokers).forEach((j, i) => {
    s.jokerRounds[j] = (i * 37) % 97;
    s.jokerBuys[j] = (i * 13) % 17;
  });
  s.jokerRounds.hearts_man = 160;
  Object.assign(s.totals, {
    handsPlayed: 2140,
    cardsPlayed: 8312,
    discards: 1530,
    cardsDiscarded: 4890,
    moneyEarned: 6420,
    moneySpent: 6105,
    jokersBought: 412,
    jokersSold: 268,
    vouchersBought: 131,
    consumablesUsed: 905,
    pranostikyUsed: 388,
    radyUsed: 401,
    razitkaUsed: 116,
    rerolls: 744,
    blindsSkipped: 163,
    roundsWon: 612,
    bossesDefeated: 188,
    glassBroken: 57,
    boostersOpened: 489,
    cardsAdded: 302,
    cardsDestroyed: 247,
    firstHandRoundWins: 96,
    shopsEntered: 604,
  });
  s.records.highestAnte = 11;
  s.records.highestEndlessAnte = 11;
  s.records.bestRoundScore = 5_912_400;
  s.records.maxMoney = 143;
  p.nextRunNo = 88;
  refreshMeta(p, { registry: REG, nowIso: NOW });
  p.unseen = [];
  return serializeProfile(p, NOW);
}

// ─────────────────────────── Prohlížeč ───────────────────────────

interface Storage {
  profile?: string;
  run?: RunState;
}

/** Kurzor myši pro GIF (headless Chromium žádný nekreslí). */
const CURSOR_SCRIPT = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-60px,-60px)';
  c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, { capture: true, passive: true });
});`;

async function openPage(browser: Browser, store: Storage, cursor = false): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, baseURL: BASE });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.error(`${msg.type()}: ${msg.text()}`);
  });
  const values = {
    profile: store.profile ?? veteranProfile(),
    run: store.run ? serializeRun(store.run, NOW) : null,
  };
  await page.addInitScript((v) => {
    if (sessionStorage.getItem('readme-seeded')) return;
    localStorage.setItem('karban.profile', v.profile);
    if (v.run) localStorage.setItem('karban.run', v.run);
    sessionStorage.setItem('readme-seeded', '1');
  }, values);
  if (cursor) await page.addInitScript(CURSOR_SCRIPT);
  return page;
}

const settle = (page: Page, ms = 500) => page.waitForTimeout(ms);

async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('.game.is-busy'), null, { timeout: 30_000 });
}

async function screenIs(page: Page, id: string): Promise<void> {
  await page.waitForSelector(`#app[data-screen="${id}"]`, { timeout: 15_000 });
}

async function continueRun(page: Page): Promise<void> {
  await page.goto('?tutorial=off');
  await page.getByTestId('menu-continue').click();
  await screenIs(page, 'game');
  await idle(page);
  await settle(page);
}

/** Posune všechny posuvné oblasti nahoru (klik na záložku mohl obsah odscrollovat). */
async function scrollTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*')))
      if (el.scrollTop) el.scrollTop = 0;
  });
  await settle(page, 250);
}

const shots: Array<{ file: string; bytes: number }> = [];

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  compressPng(file);
  shots.push({ file, bytes: statSync(file).size });
  console.log(`  ${name}.png`);
}

/** Pozice karty v ruce → klik (myší, s plynulým pohybem kvůli kurzoru v GIFu). */
async function clickHandCard(page: Page, index: number, steps = 1): Promise<void> {
  const card = page.getByTestId('hand').locator('.pcard').nth(index);
  const box = await card.boundingBox();
  if (!box) throw new Error(`Karta ${index} není vidět`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.45, { steps });
  await page.mouse.down();
  await page.mouse.up();
}

// ─────────────────────────── Snímky ───────────────────────────

type Scene = (browser: Browser) => Promise<void>;

const scenes: Record<string, Scene> = {
  async menu(browser) {
    const page = await openPage(browser, { run: showcaseBase() });
    await page.goto('?tutorial=off');
    await screenIs(page, 'menu');
    await settle(page, 900);
    await shot(page, '01-menu');
    await page.context().close();
  },

  async blind(browser) {
    const page = await openPage(browser, { run: showcaseBase() });
    await continueRun(page);
    await page.mouse.move(1, 1);
    await shot(page, '02-vyber-utraty');
    await page.context().close();
  },

  async round(browser) {
    const page = await openPage(browser, { run: showcaseRound() });
    await continueRun(page);
    for (const i of FULL_HOUSE) await clickHandCard(page, i);
    await page.mouse.move(1, 1);
    await settle(page, 600);
    await shot(page, '03-kolo-vyber');
    await page.getByTestId('play').click();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(Number(arg('scoring-ms') ?? 2300));
    await shot(page, '04-skorovani');
    await page.context().close();
  },

  async shop(browser) {
    const page = await openPage(browser, { run: showcaseShop() });
    await continueRun(page);
    await page.mouse.move(1, 1);
    await shot(page, '05-vecerka');
    await page.context().close();
  },

  async booster(browser) {
    const page = await openPage(browser, { run: showcaseBooster() });
    await continueRun(page);
    await page.mouse.move(1, 1);
    await shot(page, '06-obalka');
    await page.context().close();
  },

  async collection(browser) {
    const page = await openPage(browser, {});
    await page.goto('?tutorial=off');
    await page.getByTestId('menu-collection').click();
    await screenIs(page, 'collection');
    await page.getByTestId('codex-tab-jokers').click();
    await scrollTop(page);
    await shot(page, '07-sbirka');
    await page.getByTestId('codex-tab-achievements').click();
    await scrollTop(page);
    await shot(page, '09-achievementy');
    await page.context().close();
  },

  async stats(browser) {
    const page = await openPage(browser, {});
    await page.goto('?tutorial=off');
    await page.getByTestId('menu-stats').click();
    await screenIs(page, 'stats');
    await page.getByTestId('stats-tab-overview').click();
    await scrollTop(page);
    await shot(page, '08-statistiky');
    await page.context().close();
  },

  async pitva(browser) {
    const page = await openPage(browser, { run: showcaseDoomed() });
    await continueRun(page);
    await clickHandCard(page, 0);
    await page.getByTestId('play').click();
    await page.waitForSelector('.game[data-phase="game_over"]', { timeout: 30_000 });
    await idle(page);
    await page.mouse.move(1, 1);
    await settle(page, 1200);
    await shot(page, '10-pitva');
    await page.context().close();
  },

  async colorblind(browser) {
    const page = await openPage(browser, {
      profile: veteranProfile({ colorblind: true }),
      run: showcaseRound(),
    });
    await continueRun(page);
    for (const i of [0, 1, 2]) await clickHandCard(page, i);
    await page.mouse.move(1, 1);
    await settle(page, 600);
    await shot(page, '11-barvoslepy');
    await page.context().close();
  },
};

// ─────────────────────────── GIF ───────────────────────────

function ffmpegBin(): string | null {
  const bin = process.env.FFMPEG ?? 'ffmpeg';
  return spawnSync(bin, ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0 ? bin : null;
}

/**
 * Zmenší PNG na 256barevnou paletu (ffmpeg palettegen + paletteuse s ditheringem) — na snímcích hry okem
 * nerozeznatelné, soubor je asi třetinový. Bez ffmpeg zůstane plnobarevné PNG.
 */
function compressPng(file: string): void {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) return;
  const tmp = file.replace(/\.png$/, '.pal8.png');
  const filter =
    'split[a][b];[a]palettegen=max_colors=256:reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a';
  const res = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-i', file, '-vf', filter, '-pix_fmt', 'pal8', tmp],
    {
      stdio: 'inherit',
    },
  );
  if (res.status === 0) renameSync(tmp, file);
  else rmSync(tmp, { force: true });
}

async function recordGif(browser: Browser): Promise<void> {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) {
    console.warn('ffmpeg nenalezen (PATH nebo proměnná FFMPEG) — GIF přeskočen.');
    return;
  }
  const FPS = Number(arg('fps') ?? 12);
  const WIDTH = Number(arg('gif-width') ?? 900);
  const page = await openPage(browser, { run: showcaseRound() }, true);
  await continueRun(page);
  await page.mouse.move(VIEWPORT.width * 0.62, VIEWPORT.height * 0.45);

  const cdp = await page.context().newCDPSession(page);
  const frames: Array<{ t: number; data: Buffer }> = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, data: Buffer.from(f.data, 'base64') });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await page.waitForTimeout(700);
  for (const i of FULL_HOUSE) {
    await clickHandCard(page, i, 14);
    await page.waitForTimeout(380);
  }
  await page.waitForTimeout(900);
  const play = await page.getByTestId('play').boundingBox();
  if (!play) throw new Error('Tlačítko Zahrát není vidět');
  await page.mouse.move(play.x + play.width / 2, play.y + play.height / 2, { steps: 16 });
  await page.waitForTimeout(250);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(VIEWPORT.width * 0.55, VIEWPORT.height * 0.2, { steps: 20 });
  await idle(page);
  await page.waitForTimeout(1800);
  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  await page.context().close();
  if (frames.length < 2) throw new Error('Screencast nevrátil žádné snímky');

  // Převzorkování na stálou frekvenci: v každém kroku poslední snímek, který už byl k dispozici.
  const dir = mkdtempSync(path.join(tmpdir(), 'karban-gif-'));
  frames.sort((a, b) => a.t - b.t);
  const t0 = Math.max(start, frames[0]!.t);
  let fi = 0;
  let n = 0;
  for (let t = t0; t <= end; t += 1 / FPS) {
    while (fi + 1 < frames.length && frames[fi + 1]!.t <= t) fi++;
    writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.jpg`), frames[fi]!.data);
  }
  const out = path.join(OUT, 'karban.gif');
  const filter =
    `scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];` +
    '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  const res = spawnSync(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      path.join(dir, 'f%04d.jpg'),
      '-vf',
      filter,
      '-loop',
      '0',
      out,
    ],
    { stdio: 'inherit' },
  );
  rmSync(dir, { recursive: true, force: true });
  if (res.status !== 0) throw new Error('ffmpeg selhal při tvorbě GIFu');
  shots.push({ file: out, bytes: statSync(out).size });
  console.log(`  karban.gif (${n} snímků, ${(n / FPS).toFixed(1)} s)`);
}

// ─────────────────────────── Běh ───────────────────────────

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server ještě neběží
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server na ${url} nenaběhl`);
}

async function main(): Promise<void> {
  if (arg('no-build') === null) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Build selhal');
  }
  mkdirSync(OUT, { recursive: true });
  const server: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  try {
    await waitForServer(BASE);
    const browser = await chromium.launch();
    try {
      for (const [name, scene] of Object.entries(scenes)) if (wanted(name)) await scene(browser);
      if (arg('no-gif') === null && wanted('gif')) await recordGif(browser);
    } finally {
      await browser.close();
    }
  } finally {
    if (server.pid) process.kill(-server.pid);
  }
  for (const s of shots) console.log(`${path.relative(ROOT, s.file)}  ${(s.bytes / 1024).toFixed(0)} kB`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
