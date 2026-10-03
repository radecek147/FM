// @vitest-environment happy-dom
/**
 * Meta obrazovky (src/ui/screens/{newGame,collection,stats,menu}.ts): nová hra podle odemčení (zamčené balíčky
 * a síly piva s podmínkou, tácek, seed přes `parseSeedInput` s chybami, seedovaný a ručně zadaný denní run),
 * sbírka (záložky, stavy položek, detail, štítek „Nové“, filtry, řazení, počítadlo, klávesnice) a statistiky
 * (přehled, tabulky, historie s kopírováním seedu, denní runy) — bez ⟦chybějících textů⟧.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import type { ContentRegistry } from '../../src/engine';
import type { AchievementDef, HistoryEntry, Profile } from '../../src/engine/meta';
import { createProfile, dailySetupFromSeed } from '../../src/engine/meta';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import type { GameController } from '../../src/ui/controller';
import { clearToasts } from '../../src/ui/components/toast';
import {
  COLLECTION_TABS,
  arrangeEntries,
  collectionEntries,
  collectionScreen,
} from '../../src/ui/screens/collection';
import { menuScreen } from '../../src/ui/screens/menu';
import { interpretSeed, newGameScreen } from '../../src/ui/screens/newGame';
import { STATS_TABS, rateText, statsScreen, statsTabContent } from '../../src/ui/screens/stats';
import { STORAGE_KEYS, memoryStore, type KeyValueStore } from '../../src/ui/storage';

const REG = registry();
const NOW = new Date('2026-10-02T10:00:00.000Z');

let app: App;
let store: KeyValueStore;
let root: HTMLElement;

function makeApp(reg: ContentRegistry = REG): App {
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  const a = new App(root, store, reg, {
    now: () => NOW,
    notify: () => undefined,
    onProblem: () => undefined,
  });
  a.register('menu', menuScreen);
  a.register('newGame', newGameScreen);
  a.register('collection', collectionScreen);
  a.register('stats', statsScreen);
  a.register('game', () => ({ el: document.createElement('main') }));
  return a;
}

/** Žádný chybějící text (⟦klíč⟧) ani nedosazený {parametr} v textu ani v popiscích. */
function expectNoMissingTexts(scope: ParentNode = document.body): void {
  const text = (scope as Element).textContent ?? '';
  expect(text).not.toContain('⟦');
  expect(text).not.toMatch(/\{[a-z]+(\|[^}]*)?\}/i);
  for (const el of scope.querySelectorAll('[aria-label], [title]')) {
    const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`;
    expect(label).not.toContain('⟦');
  }
}

/** Rozehraný run aplikace (funkce — TS po `app.controller = null` jinak zúží typ na null). */
function running(): GameController | null {
  return app.controller;
}

function q<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`nenalezeno: ${sel}`);
  return el;
}

function key(target: Element, k: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** Profil s něčím ve všech kategoriích (objevy, odemčení, statistiky, historie, denní runy). */
function richProfile(p: Profile): void {
  const jokers = Object.keys(REG.jokers);
  p.discovered.jokers = jokers.slice(0, 10);
  p.discovered.consumables = Object.keys(REG.consumables).slice(0, 8);
  p.discovered.bosses = Object.keys(REG.bosses).slice(0, 4);
  p.discovered.tags = Object.keys(REG.tags).slice(0, 3);
  p.discovered.vouchers = Object.keys(REG.vouchers).slice(0, 2);
  p.discovered.enhancements = Object.keys(REG.enhancements).slice(0, 2);
  p.discovered.editions = Object.keys(REG.editions).slice(0, 1);
  p.discovered.hands = ['five'];
  p.unlocks.decks.push('clerk');
  p.unlocks.stakes.pub = 3;
  p.unlocks.challenges.push(Object.keys(REG.challenges)[0]!);
  p.unseen = [`jokers:${jokers[0]}`, `jokers:${jokers[1]}`, 'decks:clerk'];
  const s = p.stats;
  s.runs = { played: 6, won: 2, lost: 3, abandoned: 1, currentStreak: 1, bestStreak: 2 };
  s.byDeck.pub = { played: 6, won: 2, bestStake: 2 };
  s.byStake['1'] = { played: 4, won: 2 };
  s.byStake['2'] = { played: 2, won: 0 };
  const boss = Object.keys(REG.bosses)[0]!;
  s.bosses[boss] = { defeated: 3, lostTo: 1 };
  s.losses = { small: 1, big: 1, [boss]: 1 };
  s.bestHand = { score: 1_340_000, handType: 'flush', seed: 'NEJLEPSI', deckId: 'pub' };
  s.fastestWin = { hands: 31, seed: 'RYCHLYAA', deckId: 'pub', stake: 1 };
  s.handTypes = { pair: 40, flush: 12 };
  s.jokerRounds = { [jokers[0]!]: 17 };
  s.jokerBuys = { [jokers[1]!]: 4 };
  s.consumableUses = { [Object.keys(REG.consumables)[0]!]: 2 };
  s.totals.handsPlayed = 220;
  s.totals.moneyEarned = 480;
  s.records.highestAnte = 9;
  s.records.highestEndlessAnte = 9;
  s.records.bestRoundScore = 2_000_000;
  s.records.handLevels = { flush: 4 };
  const entry = (no: number, patch: Partial<HistoryEntry>): HistoryEntry => ({
    no,
    startedAt: '2026-10-01T18:00:00.000Z',
    finishedAt: '2026-10-01T19:05:00.000Z',
    seed: `HIST${no}AAA`.slice(0, 8),
    deckId: 'pub',
    stake: 1,
    mode: 'normal',
    challengeId: null,
    seeded: false,
    official: false,
    outcome: 'lost',
    ante: 3,
    endless: false,
    cause: 'small',
    bestHand: 1234,
    bestHandType: 'pair',
    jokers: jokers.slice(0, 2),
    handsPlayed: 20,
    roundsWon: 6,
    ...patch,
  });
  p.history = [
    entry(4, { outcome: 'won', cause: null, ante: 9, endless: true, bestHandType: 'flush' }),
    entry(3, { mode: 'daily', official: true, seed: 'DEN-20261001', cause: boss }),
    entry(2, {
      mode: 'challenge',
      challengeId: Object.keys(REG.challenges)[0]!,
      outcome: 'abandoned',
      cause: null,
    }),
    entry(1, { seeded: true, jokers: [], bestHandType: null }),
  ];
  p.daily['20261001'] = {
    seed: 'DEN-20261001',
    deckId: 'pub',
    stake: 2,
    status: 'finished',
    outcome: 'lost',
    ante: 7,
    bestHand: 1_234_560,
    startedAt: '2026-10-01T08:00:00.000Z',
    finishedAt: '2026-10-01T09:00:00.000Z',
  };
  p.daily['20260930'] = {
    seed: 'DEN-20260930',
    deckId: 'marias',
    stake: 1,
    status: 'finished',
    outcome: 'won',
    ante: 8,
    bestHand: 50_000,
    startedAt: '2026-09-30T08:00:00.000Z',
    finishedAt: '2026-09-30T09:00:00.000Z',
  };
}

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector<HTMLElement>('#app')!;
});

beforeEach(() => {
  app = makeApp();
});

afterEach(() => {
  closeAllModals();
  clearToasts();
});

// ─────────────────────────── Nová hra ───────────────────────────

describe('nová hra podle profilu', () => {
  it('čistý profil: odemčené jen Hospodský a Štamgastův, zamčené s podmínkou; jen Desítka', () => {
    app.go('newGame');
    const decks = [...document.querySelectorAll<HTMLElement>('.deck-option')];
    const open = decks.filter((d) => d.getAttribute('aria-disabled') !== 'true').map((d) => d.dataset.deck);
    expect(open).toEqual(['pub', 'regulars']);
    const clerk = q('[data-testid="deck-clerk"]');
    expect(clerk.getAttribute('aria-disabled')).toBe('true');
    expect(q('[data-testid="deck-condition-clerk"]').textContent).toContain(t('newGame.deck.locked'));
    expect(q('[data-testid="deck-unlocked-count"]').textContent).toBe(
      t('newGame.deck.unlockedCount', { n: 2, total: Object.keys(REG.decks).length }),
    );
    // Klik na zamčený balíček nic nevybere.
    clerk.click();
    expect(clerk.getAttribute('aria-checked')).toBe('false');
    expect(q('[data-testid="deck-pub"]').getAttribute('aria-checked')).toBe('true');
    // Síla piva: jen Desítka.
    const stakes = [...document.querySelectorAll<HTMLElement>('.stake-option')];
    expect(stakes.filter((s) => s.getAttribute('aria-disabled') !== 'true')).toHaveLength(1);
    expect(q('[data-testid="stake-lock-note"]').hidden).toBe(false);
    expectNoMissingTexts();
  });

  it('šipky v balíčcích přeskočí zamčené; síla piva podle balíčku a tácek nejsilnější výhry', () => {
    app.profile.unlocks.stakes.pub = 3;
    app.profile.stats.byDeck.pub = { played: 3, won: 2, bestStake: 2 };
    app.go('newGame');
    expect(q('[data-testid="deck-coaster-pub"]').textContent).toContain(
      t('newGame.deck.coaster', { level: 2 }),
    );
    const open = [...document.querySelectorAll<HTMLElement>('.stake-option')].filter(
      (s) => s.getAttribute('aria-disabled') !== 'true',
    );
    expect(open.map((s) => s.dataset.stake)).toEqual(['1', '2', '3']);
    q('[data-testid="stake-3"]').click();
    expect(q('[data-testid="stake-3"]').getAttribute('aria-checked')).toBe('true');
    expect(q('[data-testid="stake-rules"]').querySelectorAll('li')).toHaveLength(3);
    // Štamgastův má jen Desítku → síla piva spadne na 1.
    const pub = q('[data-testid="deck-pub"]');
    pub.focus();
    key(pub, 'ArrowRight');
    expect(q('[data-testid="deck-regulars"]').getAttribute('aria-checked')).toBe('true');
    expect(q('[data-testid="stake-1"]').getAttribute('aria-checked')).toBe('true');
    key(q('[data-testid="deck-regulars"]'), 'ArrowRight');
    // Za Štamgastovým jsou samé zamčené → zpět na Hospodský.
    expect(q('[data-testid="deck-pub"]').getAttribute('aria-checked')).toBe('true');
  });

  it('interpretSeed: prázdné, vylosovaný, vlastní, denní a chyby', () => {
    expect(interpretSeed('', null)).toEqual({ kind: 'random' });
    expect(interpretSeed('  ', null)).toEqual({ kind: 'random' });
    expect(interpretSeed('ABCD EFGH', 'ABCDEFGH')).toEqual({ kind: 'generated', seed: 'ABCDEFGH' });
    expect(interpretSeed('abcdefgh', null)).toEqual({ kind: 'custom', seed: 'ABCDEFGH' });
    expect(interpretSeed('den-20261001', null)).toEqual({
      kind: 'daily',
      seed: 'DEN-20261001',
      dateKey: '20261001',
    });
    expect(interpretSeed('abc', null)).toEqual({ kind: 'error', error: 'tooShort' });
    expect(interpretSeed('ABCDEFGHJ', null)).toEqual({ kind: 'error', error: 'tooLong' });
    expect(interpretSeed('PIVO1234', null)).toEqual({ kind: 'error', error: 'invalidChars' });
    expect(interpretSeed('SIM-A-1', null)).toEqual({ kind: 'error', error: 'reserved' });
    expect(interpretSeed('DEN-20261301', null)).toEqual({ kind: 'error', error: 'invalidDate' });
  });

  it('pole seedu: chyba hned pod polem, start ji nespustí; poznámka o seedovaném a denním runu', () => {
    app.go('newGame');
    const input = q<HTMLInputElement>('[data-testid="seed-input"]');
    const status = q('[data-testid="seed-status"]');
    const type = (v: string): void => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('pivo1');
    expect(status.dataset.state).toBe('error');
    expect(status.textContent).toBe(t('newGame.seed.errors.invalidChars'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    expect(app.controller).toBeNull();
    type('abc');
    expect(status.textContent).toBe(t('newGame.seed.errors.tooShort', { n: 8 }));
    type('ZELVY234');
    expect(status.dataset.state).toBe('seeded');
    expect(status.textContent).toBe(t('newGame.seed.seededNote'));
    type('DEN-20261001');
    expect(status.dataset.state).toBe('daily');
    expect(status.textContent).toContain(t(`decks.${dailySetupFromSeed('DEN-20261001', REG).deckId}.name`));
    type('');
    expect(status.hidden).toBe(true);
    expectNoMissingTexts();
  });

  it('start se zadaným seedem = seedovaný run (celý obsah, nepočítá se)', async () => {
    app.go('newGame');
    const input = q<HTMLInputElement>('[data-testid="seed-input"]');
    input.value = 'zelvy234';
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.controller?.state.seed).toBe('ZELVY234');
    expect(app.controller?.state.unlockedPool.jokers).toBeNull();
    expect(app.profile.current).toMatchObject({ seed: 'ZELVY234', seeded: true, counted: false });
    expect(store.get('karban.newGame')).toContain('pub');
  });

  it('start bez seedu i s vylosovaným seedem = započítaný run s poolem z profilu', async () => {
    app.go('newGame');
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.controller?.state.seed).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(app.profile.current).toMatchObject({ seeded: false, counted: true });
    expect(app.controller?.state.unlockedPool.jokers).not.toBeNull();

    app.controller = null;
    store.remove(STORAGE_KEYS.run);
    app.go('newGame');
    q<HTMLButtonElement>('[data-testid="seed-random"]').click();
    const seed = q<HTMLInputElement>('[data-testid="seed-input"]').value;
    expect(q('[data-testid="seed-status"]').hidden).toBe(true);
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(running()?.state.seed).toBe(seed);
    expect(app.profile.current).toMatchObject({ seed, seeded: false, counted: true });
  });

  it('ručně zadaný denní seed: balíček a síla ze seedu, denní run mimo soutěž', async () => {
    app.go('newGame');
    q<HTMLInputElement>('[data-testid="seed-input"]').value = 'DEN-20261001';
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    await new Promise((r) => setTimeout(r, 0));
    const setup = dailySetupFromSeed('DEN-20261001', REG);
    expect(app.controller?.state).toMatchObject({
      seed: 'DEN-20261001',
      daily: true,
      deckId: setup.deckId,
      stake: setup.stake,
    });
    expect(app.profile.current).toMatchObject({ mode: 'daily', official: false, counted: false });
    expect(app.profile.daily).toEqual({});
  });
});

// ─────────────────────────── Menu ───────────────────────────

describe('menu', () => {
  it('Sbírka a Statistiky jsou aktivní, Sbírka ukazuje počet novinek', () => {
    app.profile.unseen = ['jokers:golem', 'decks:clerk'];
    app.go('menu');
    const coll = q<HTMLButtonElement>('[data-testid="menu-collection"]');
    expect(coll.getAttribute('aria-disabled')).toBeNull();
    expect(coll.querySelector('.btn__badge')?.textContent).toBe('2');
    expect(coll.getAttribute('aria-label')).toBe(t('menu.collection.labelNew', { n: 2 }));
    coll.click();
    expect(app.screenId).toBe('collection');
    app.go('menu');
    q<HTMLButtonElement>('[data-testid="menu-stats"]').click();
    expect(app.screenId).toBe('stats');
  });
});

// ─────────────────────────── Sbírka ───────────────────────────

describe('sbírka', () => {
  it('všechny záložky se vykreslí bez chybějících textů (čistý i bohatý profil)', () => {
    for (const rich of [false, true]) {
      app = makeApp();
      if (rich) richProfile(app.profile);
      app.go('collection');
      for (const tab of COLLECTION_TABS) {
        q(`[data-testid="codex-tab-${tab}"]`).click();
        expect(q('#codex-panel').dataset.tab).toBe(tab);
        expect(document.querySelector('[data-testid="codex-count"]')).not.toBeNull();
        expectNoMissingTexts();
        // Detail první položky (zamčené, neobjevené i objevené).
        const first = document.querySelector<HTMLButtonElement>('.codex-item');
        if (first) {
          first.click();
          expect(document.querySelector('[data-testid="codex-detail"]')).not.toBeNull();
          expectNoMissingTexts();
          closeAllModals();
        }
      }
    }
  });

  it('stavy žolíků: zamčený (podmínka), neobjevený (???), objevený (mechanika, cena, statistika)', () => {
    const ids = Object.keys(REG.jokers);
    const locked = ids.find((id) => REG.jokers[id]?.unlock);
    const plain = ids.find((id) => !REG.jokers[id]?.unlock && REG.jokers[id]?.rarity !== 'legendary')!;
    const other = ids.find(
      (id) => id !== plain && !REG.jokers[id]?.unlock && REG.jokers[id]?.rarity !== 'legendary',
    )!;
    app.profile.discovered.jokers = [plain];
    app.profile.stats.jokerRounds[plain] = 12;
    app.go('collection');
    const known = q(`[data-testid="codex-item-${plain}"]`);
    expect(known.dataset.state).toBe('discovered');
    expect(known.textContent).toContain(t(`jokers.${plain}.name`));
    expect(q(`[data-testid="codex-item-${other}"]`).dataset.state).toBe('unknown');
    expect(q(`[data-testid="codex-item-${other}"]`).textContent).toContain(t('meta.collection.unknownName'));
    expect(q('[data-testid="codex-count"]').textContent).toBe(
      t('meta.collection.count', { n: 1, total: ids.length }),
    );
    // Čtečka dostane celé znění skrytým textem; `aria-label` na <p> je zakázaný (axe aria-prohibited-attr).
    const countLabel = q('[data-testid="codex-count-label"]');
    expect(countLabel.textContent).toBe(t('meta.collection.countLabel', { n: 1, total: ids.length }));
    expect(countLabel.classList.contains('visually-hidden')).toBe(true);
    expect(countLabel.parentElement?.hasAttribute('aria-label')).toBe(false);

    known.click();
    const detail = q('[data-testid="codex-detail"]');
    expect(detail.textContent).toContain(t('meta.collection.usage.jokerRounds', { n: 12 }));
    expect(q('[data-testid="codex-detail-desc"]').textContent?.length).toBeGreaterThan(5);
    closeAllModals();

    q(`[data-testid="codex-item-${other}"]`).click();
    expect(q('[data-testid="codex-detail-note"]').textContent).toBe(t('meta.collection.unknownHint'));
    closeAllModals();

    if (locked) {
      const el = q(`[data-testid="codex-item-${locked}"]`);
      expect(el.dataset.state).toBe('locked');
      el.click();
      expect(q('[data-testid="codex-detail-condition"]').textContent).toContain(
        t('meta.collection.detail.condition'),
      );
      closeAllModals();
    }
  });

  it('štítek „Nové“: na položce i záložce; detail ho sundá, odchod ze záložky taky', () => {
    const [a, b] = Object.keys(REG.jokers);
    app.profile.discovered.jokers = [a!, b!];
    app.profile.unseen = [`jokers:${a}`, `jokers:${b}`, 'jokers:odebrany_zolik', 'decks:pub'];
    app.go('collection');
    const tab = q('[data-testid="codex-tab-jokers"]');
    // Cedulka říká „2 nové“ (ne holé číslo vedle počtu „x / y“); neznámé id z profilu se nepočítá.
    expect(tab.querySelector('.tabs__badge')?.textContent).toBe(t('meta.collection.newBadgeCount', { n: 2 }));
    expect(tab.querySelector('.tabs__badge')?.textContent?.replace(/\s/g, ' ')).toBe('2 nové');
    expect(q(`[data-testid="codex-item-${a}"]`).classList.contains('is-new')).toBe(true);
    q(`[data-testid="codex-item-${a}"]`).click();
    closeAllModals();
    expect(app.profile.unseen).not.toContain(`jokers:${a}`);
    expect(q(`[data-testid="codex-item-${a}"]`).classList.contains('is-new')).toBe(false);
    expect(tab.querySelector('.tabs__badge')?.textContent).toBe(t('meta.collection.newBadgeCount', { n: 1 }));
    // Přepnutí záložky: zbytek viděných novinek se sundá (balíček zůstává, dokud se na něj nepodívá).
    q('[data-testid="codex-tab-decks"]').click();
    expect(app.profile.unseen).toEqual(['jokers:odebrany_zolik', 'decks:pub']);
    expect((tab.querySelector('.tabs__badge') as HTMLElement).hidden).toBe(true);
    app.go('menu');
    expect(app.profile.unseen).toEqual(['jokers:odebrany_zolik']);
  });

  it('filtr podle vzácnosti a zaměření, řazení podle názvu', () => {
    app.profile.discovered.jokers = Object.keys(REG.jokers);
    app.go('collection');
    const rarity = q<HTMLSelectElement>('[data-testid="codex-filter-rarity"]');
    rarity.value = 'legendary';
    rarity.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = [...document.querySelectorAll<HTMLElement>('.codex-item')].map((e) => e.dataset.id!);
    expect(shown.length).toBeGreaterThan(0);
    for (const id of shown) expect(REG.jokers[id]?.rarity).toBe('legendary');
    rarity.value = '';
    rarity.dispatchEvent(new Event('change', { bubbles: true }));
    const tag = q<HTMLSelectElement>('[data-testid="codex-filter-tag"]');
    tag.value = 'xmult';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    for (const el of document.querySelectorAll<HTMLElement>('.codex-item'))
      expect(REG.jokers[el.dataset.id!]?.tags).toContain('xmult');
    tag.value = '';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    const sort = q<HTMLSelectElement>('[data-testid="codex-sort"]');
    sort.value = 'name';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    // Objevené podle abecedy, zamčené (bez názvu) až za nimi.
    const items = [...document.querySelectorAll<HTMLElement>('.codex-item')];
    const states = items.map((e) => e.dataset.state);
    const firstHidden = states.findIndex((st) => st !== 'discovered');
    if (firstHidden >= 0) expect(states.slice(firstHidden).every((st) => st !== 'discovered')).toBe(true);
    const names = items
      .filter((e) => e.dataset.state === 'discovered')
      .map((e) => e.querySelector('.codex-item__name')?.textContent ?? '');
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, 'cs')));
  });

  it('arrangeEntries: neobjevené na konec při řazení podle názvu, četnost sestupně', () => {
    const p = createProfile(NOW.toISOString());
    const [a, b, c] = Object.keys(REG.jokers);
    p.discovered.jokers = [b!, c!];
    p.stats.jokerRounds = { [c!]: 5, [b!]: 1 };
    const entries = collectionEntries('jokers', p, REG);
    const byName = arrangeEntries(entries, { sort: 'name' });
    expect(byName.slice(0, 2).map((e) => e.state)).toEqual(['discovered', 'discovered']);
    const byUsage = arrangeEntries(entries, { sort: 'usage' });
    expect(byUsage.slice(0, 2).map((e) => e.id)).toEqual([c, b]);
    expect(entries.find((e) => e.id === a)?.state).toMatch(/locked|unknown/);
  });

  it('klávesnice: šipky přepínají záložky, Esc vrátí do menu', () => {
    app.go('collection');
    const tab = q('[data-testid="codex-tab-jokers"]');
    tab.focus();
    key(tab, 'ArrowRight');
    expect(q('#codex-panel').dataset.tab).toBe('pranostiky');
    expect(document.activeElement).toBe(q('[data-testid="codex-tab-pranostiky"]'));
    key(document.activeElement!, 'End');
    expect(q('#codex-panel').dataset.tab).toBe('achievements');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(app.screenId).toBe('menu');
  });

  it('achievementy: skrytý jako „???“ s nápovědou, nezískaný s průběhem, získaný s datem', () => {
    const achievements: Record<string, AchievementDef> = {
      tajny: { id: 'tajny', category: 'curiosity', hidden: true, check: () => false },
      prubeh: {
        id: 'prubeh',
        category: 'progress',
        check: (c) => ({ progress: c.profile.stats.runs.won, target: 5 }),
      },
      ziskany: { id: 'ziskany', category: 'meta', check: () => true },
    };
    app = makeApp({ ...REG, achievements });
    app.profile.stats.runs.won = 2;
    app.profile.achievements.unlocked.ziskany = '2026-10-01T12:00:00.000Z';
    app.go('collection', { tab: 'achievements' });
    expect(q('[data-testid="codex-count"]').textContent).toBe(t('meta.collection.count', { n: 1, total: 3 }));
    expect(q('[data-testid="codex-item-tajny"]').textContent).toContain('???');
    q('[data-testid="codex-item-tajny"]').click();
    expect(q('[data-testid="codex-detail-note"]').textContent).toBeTruthy();
    closeAllModals();
    q('[data-testid="codex-item-prubeh"]').click();
    expect(q('[data-testid="codex-detail-condition"]').textContent).toContain(
      t('meta.collection.progress', { progress: 2, target: 5 }),
    );
    closeAllModals();
    q('[data-testid="codex-item-ziskany"]').click();
    expect(q('[data-testid="codex-detail"]').textContent).toContain('2026');
    closeAllModals();
  });
});

// ─────────────────────────── Statistiky ───────────────────────────

describe('statistiky', () => {
  it('rateText: procenta s desetinnou čárkou', () => {
    expect(rateText(0, 0)).toBe(t('meta.stats.rate', { n: 0 }));
    expect(rateText(3, 1)).toBe(t('meta.stats.rate', { n: 33.3 }));
  });

  it('čistý profil: prázdné stavy ve všech záložkách', () => {
    app.go('stats');
    for (const tab of STATS_TABS) {
      q(`[data-testid="stats-tab-${tab}"]`).click();
      expectNoMissingTexts();
    }
    q('[data-testid="stats-tab-history"]').click();
    expect(document.querySelector('[data-testid="history-empty"]')).not.toBeNull();
    q('[data-testid="stats-tab-daily"]').click();
    expect(document.querySelector('[data-testid="daily-empty"]')).not.toBeNull();
    expect(q('[data-testid="stats-daily-today"]').textContent).toBe(t('meta.daily.todayAvailable'));
  });

  it('bohatý profil: přehled, tabulky, historie se seedem a denní runy se sdílením', () => {
    richProfile(app.profile);
    app.go('stats');
    expect(q('[data-testid="stats-played"]').textContent).toBe('6');
    expect(q('[data-testid="stats-rate"]').textContent).toBe(rateText(6, 2));
    expect(q('[data-testid="stats-best-seed"]').textContent).toBe('NEJLEPSI');
    expect(q('[data-testid="stats-best-hand"]').textContent).toContain(t('hands.flush.name'));
    expectNoMissingTexts();

    q('[data-testid="stats-tab-decks"]').click();
    expect(q('[data-testid="stats-decks-table"]').querySelectorAll('tbody tr')).toHaveLength(
      Object.keys(REG.decks).length,
    );
    q('[data-testid="stats-tab-bosses"]').click();
    expect(q('[data-testid="stats-losses"]').textContent).toContain(t('meta.stats.losses.small'));
    expectNoMissingTexts();

    q('[data-testid="stats-tab-history"]').click();
    const items = document.querySelectorAll('[data-testid="history-list"] > li');
    expect(items).toHaveLength(4);
    expect(q('[data-testid="history-4"]').dataset.outcome).toBe('won');
    expect(q('[data-testid="history-4"]').textContent).toContain(t('meta.history.anteEndless', { ante: 9 }));
    expect(q('[data-testid="history-2"]').textContent).toContain(
      t('meta.history.mode.challenge', { name: t(`challenges.${Object.keys(REG.challenges)[0]}.name`) }),
    );
    expect(q('[data-testid="history-1"]').textContent).toContain(t('meta.history.seeded'));
    expect(document.querySelector('[data-testid="history-copy-4"]')).not.toBeNull();
    expectNoMissingTexts();

    q('[data-testid="stats-tab-daily"]').click();
    const days = document.querySelectorAll('[data-testid="daily-list"] > li');
    expect(days).toHaveLength(2);
    expect(days[0]?.getAttribute('data-testid')).toBe('daily-20261001');
    expect(q('[data-testid="daily-20261001"]').textContent).toContain(
      t('meta.daily.share', { seed: 'DEN-20261001', ante: 7, score: 1_234_560 }),
    );
    expectNoMissingTexts();
  });

  it('statsTabContent je čistá funkce nad profilem', () => {
    const p = createProfile(NOW.toISOString());
    richProfile(p);
    for (const tab of STATS_TABS) {
      const els = statsTabContent(tab, p, REG, NOW.toISOString());
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) expectNoMissingTexts(el);
    }
  });
});
