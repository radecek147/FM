// @vitest-environment happy-dom
/**
 * Meta UI M5: obrazovky Výzvy a Denní run, menu bez „Už brzy“, oznámení meta vrstvy (toast s ikonou, fronta),
 * novinky runu na pitvě a výhře, výsledek denního runu ke sdílení, tutoriál Štamgast (výběr kroku, dokončení
 * událostmi, umístění bubliny, přeskočení, restart, achievement) a nastavení (záloha před resetem a importem,
 * souhrn importu). Bez ⟦chybějících textů⟧ a nedosazených {parametrů}.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { ContentRegistry, RunState } from '../../src/engine';
import { Game, serializeRun } from '../../src/engine';
import type { MetaNotice, Profile } from '../../src/engine/meta';
import {
  createProfile,
  dailyRunSetup,
  deserializeProfile,
  finishRun,
  serializeProfile,
} from '../../src/engine/meta';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { loadIcons } from '../../src/ui/art/icons';
import { closeAllModals } from '../../src/ui/components/modal';
import { clearToasts } from '../../src/ui/components/toast';
import type { GameController } from '../../src/ui/controller';
import {
  MAX_NOTICE_QUEUE,
  META_TOASTS_VISIBLE,
  NoticeQueue,
  noticeView,
  runNoveltiesBlock,
  uniqueNotices,
} from '../../src/ui/metaNotices';
import { challengeFinalAnte, challengeStatus, challengesScreen } from '../../src/ui/screens/challenges';
import { dailyScreen, dailyStatus, timeToNextDaily } from '../../src/ui/screens/daily';
import { gameScreen } from '../../src/ui/screens/game';
import { menuScreen } from '../../src/ui/screens/menu';
import {
  backupStoredProfile,
  importSummary,
  parseImport,
  settingsScreen,
} from '../../src/ui/screens/settings';
import { dailyShareText } from '../../src/ui/screens/stats';
import { PROFILE_BACKUP_PREFIX } from '../../src/ui/settings';
import { STORAGE_KEYS, memoryStore, type KeyValueStore } from '../../src/ui/storage';
import type { TutorialController } from '../../src/ui/tutorial';
import { installTutorial, pendingTutorialStep, placeBubble, tutorialStepNumber } from '../../src/ui/tutorial';

const REG = registry();
const NOW = new Date('2026-10-02T10:00:00.000Z');
const CHALLENGE_IDS = Object.keys(REG.challenges);

let app: App;
let store: KeyValueStore;
let root: HTMLElement;
let notices: MetaNotice[] = [];

function makeApp(initial: Record<string, string> = {}, reg: ContentRegistry = REG): App {
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }), ...initial });
  notices = [];
  const a = new App(root, store, reg, {
    now: () => NOW,
    notify: (n) => void notices.push(...n),
    onProblem: () => undefined,
  });
  a.register('menu', menuScreen);
  a.register('challenges', challengesScreen);
  a.register('daily', dailyScreen);
  a.register('settings', settingsScreen);
  a.register('game', gameScreen);
  a.register('newGame', () => ({ el: document.createElement('main') }));
  a.register('collection', () => ({ el: document.createElement('main') }));
  a.register('stats', () => ({ el: document.createElement('main') }));
  return a;
}

function q<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`nenalezeno: ${sel}`);
  return el;
}

function expectNoMissingTexts(scope: ParentNode = document.body): void {
  const text = (scope as Element).textContent ?? '';
  expect(text).not.toContain('⟦');
  expect(text).not.toMatch(/\{[a-z]+(\|[^}]*)?\}/i);
  for (const el of scope.querySelectorAll('[aria-label], [title]')) {
    const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`;
    expect(label).not.toContain('⟦');
    expect(label).not.toMatch(/\{[a-z]+(\|[^}]*)?\}/i);
  }
}

/** Profil s danými výhrami (odemčení výzev přepočítá `profiles.refresh`). */
function withWins(a: App, won: number): void {
  a.profile.stats.runs.won = won;
  a.profile.stats.runs.played = won;
  a.profiles.refresh();
}

/** Rozehraný run aplikace (funkce — TS po přiřazení jinak zúží typ). */
function running(): GameController {
  const c = app.controller;
  if (!c) throw new Error('žádný run');
  return c;
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
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
  document.querySelectorAll('.tutorial-layer').forEach((el) => el.remove());
});

// ─────────────────────────── Menu ───────────────────────────

describe('menu', () => {
  it('Výzvy a Denní run fungují (žádné „Už brzy“), cedulky „Dnes“ a nové výzvy', () => {
    app.profile.unseen = [`challenges:${CHALLENGE_IDS[0]}`, `challenges:${CHALLENGE_IDS[1]}`];
    app.go('menu');
    expect(document.querySelector('.btn--soon')).toBeNull();
    const ch = q<HTMLButtonElement>('[data-testid="menu-challenges"]');
    expect(ch.getAttribute('aria-disabled')).toBeNull();
    expect(ch.querySelector('.btn__badge')?.textContent).toBe('2');
    expect(ch.getAttribute('aria-label')).toBe(t('menu.challenges.labelNew', { n: 2 }));
    const daily = q<HTMLButtonElement>('[data-testid="menu-daily"]');
    expect(daily.querySelector('.btn__badge')?.textContent).toBe(t('menu.daily.badge'));
    expect(daily.getAttribute('aria-label')).toBe(t('menu.daily.labelOpen'));
    ch.click();
    expect(app.screenId).toBe('challenges');
    app.go('menu');
    q<HTMLButtonElement>('[data-testid="menu-daily"]').click();
    expect(app.screenId).toBe('daily');
  });

  it('po dnešním oficiálním pokusu cedulka „Dnes“ zmizí', () => {
    const setup = dailyRunSetup(NOW, REG);
    app.profile.daily[setup.dateKey] = {
      seed: setup.seed,
      deckId: setup.deckId,
      stake: setup.stake,
      status: 'finished',
      outcome: 'lost',
      ante: 2,
      bestHand: 100,
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
    };
    app.go('menu');
    expect(q('[data-testid="menu-daily"]').querySelector('.btn__badge')).toBeNull();
  });
});

// ─────────────────────────── Výzvy ───────────────────────────

describe('výzvy', () => {
  it('čistý profil: 20 zamčených výzev ve 4 várkách, detail s podmínkou a průběhem', () => {
    app.go('challenges');
    const items = [...document.querySelectorAll<HTMLButtonElement>('.challenge-item')];
    expect(items).toHaveLength(20);
    expect(items.every((b) => b.dataset.status === 'locked')).toBe(true);
    expect(document.querySelectorAll('.challenges__group')).toHaveLength(4);
    const detail = q('[data-testid="challenge-detail"]');
    expect(detail.dataset.status).toBe('locked');
    expect(q('[data-testid="challenge-condition"]').textContent).toBe(t('meta.unlock.cond.winsTotalFirst'));
    expect(detail.querySelector('[data-testid="challenge-start"]')).toBeNull();
    expect(q('[data-testid="challenges-next"]').textContent).toBe(
      t('meta.challenges.next', { wins: 1, have: 0 }),
    );
    expectNoMissingTexts();
  });

  it('po 1 výhře je odemčená první várka; detail má pravidla, balíček, cíl a start', () => {
    withWins(app, 1);
    app.go('challenges');
    const statuses = CHALLENGE_IDS.map((id) => q(`[data-testid="challenge-${id}"]`).dataset.status);
    expect(statuses.slice(0, 5)).toEqual(['open', 'open', 'open', 'open', 'open']);
    expect(statuses.slice(5).every((s) => s === 'locked')).toBe(true);
    const first = REG.challenges[CHALLENGE_IDS[0]!]!;
    expect(q('[data-testid="challenge-detail"]').dataset.challenge).toBe(first.id);
    expect(q('[data-testid="challenge-rules"]').querySelectorAll('li')).toHaveLength(
      first.ruleKeys?.length ?? 0,
    );
    expect(q('[data-testid="challenge-deck"]').textContent).toBe(t(`decks.${first.deckId}.name`));
    expect(q('[data-testid="challenge-stats"]').textContent).toBe(t('meta.challenges.detail.never'));
    expectNoMissingTexts();
  });

  it('každá výzva (odemčená i zamčená) se vykreslí bez chybějících textů; Konec světa končí 12. patrem', () => {
    withWins(app, 10);
    app.go('challenges');
    for (const id of CHALLENGE_IDS) {
      q<HTMLButtonElement>(`[data-testid="challenge-${id}"]`).click();
      expect(q('[data-testid="challenge-detail"]').dataset.challenge).toBe(id);
      expectNoMissingTexts();
    }
    expect(challengeFinalAnte(REG.challenges.end_of_world!)).toBe(12);
    expect(challengeFinalAnte(REG.challenges.greenhouse!)).toBe(8);
  });

  it('šipky přepínají výzvy, výběr sundá štítek „Nové“', () => {
    withWins(app, 1);
    const second = CHALLENGE_IDS[1]!;
    expect(app.profile.unseen).toContain(`challenges:${second}`);
    app.go('challenges');
    const first = q<HTMLButtonElement>(`[data-testid="challenge-${CHALLENGE_IDS[0]}"]`);
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(q('[data-testid="challenge-detail"]').dataset.challenge).toBe(second);
    expect(document.activeElement?.getAttribute('data-challenge')).toBe(second);
    expect(app.profile.unseen).not.toContain(`challenges:${second}`);
    expect(q(`[data-testid="challenge-${second}"]`).querySelector('.challenge-item__new')).toBeNull();
  });

  it('start výzvy založí run s výzvou, balíčkem a sílou piva z definice; statistika a odznak', async () => {
    withWins(app, 1);
    const id = CHALLENGE_IDS[2]!;
    const def = REG.challenges[id]!;
    app.go('challenges', { challengeId: id });
    q<HTMLButtonElement>('[data-testid="challenge-start"]').click();
    await vi.waitFor(() => expect(app.screenId).toBe('game'));
    const c = running();
    expect(c.state.challengeId).toBe(id);
    expect(c.state.deckId).toBe(def.deckId);
    expect(c.state.stake).toBe(def.stake ?? 1);
    expect(app.profile.stats.challenges[id]?.attempts).toBe(1);
    // Zpátky ve výzvách: rozehraná výzva → Pokračovat.
    app.go('challenges', { challengeId: id });
    expect(challengeStatus(app, def)).toBe('playing');
    expect(q('[data-testid="challenge-continue"]')).toBeTruthy();
    // Dokončená výzva: odznak a statistika.
    app.profile.stats.challenges[id] = { attempts: 3, completed: 1, bestAnte: 8 };
    app.controller = null;
    store.remove(STORAGE_KEYS.run);
    app.go('challenges', { challengeId: id });
    expect(q('[data-testid="challenge-completed-badge"]').textContent).toContain(
      t('meta.challenges.detail.badge'),
    );
    expect(q('[data-testid="challenge-stats"]').textContent).toContain('3');
    expect(q('[data-testid="challenges-completed"]').textContent).toBe(
      t('meta.challenges.countValue', { n: 1, total: 20 }),
    );
  });
});

// ─────────────────────────── Denní run ───────────────────────────

describe('denní run', () => {
  it('dnešní seed, balíček a síla piva ze seedu; oficiální pokus čeká', () => {
    app.go('daily');
    const setup = dailyRunSetup(NOW, REG);
    expect(q('[data-testid="daily-seed"]').textContent).toBe('DEN-20261002');
    expect(q('[data-testid="daily-deck"]').textContent).toBe(t(`decks.${setup.deckId}.name`));
    expect(q('[data-testid="daily-today"]').dataset.state).toBe('available');
    expect(q('[data-testid="daily-status"]').textContent).toContain(t('meta.dailyRun.state.available'));
    expect(q('[data-testid="daily-play"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="daily-replay"]')).toBeNull();
    expect(q('[data-testid="daily-next"]').textContent).toBe(t('meta.dailyRun.next', { h: 14, m: 0 }));
    expectNoMissingTexts();
  });

  it('oficiální pokus → rozehraný (Pokračovat) → po konci výsledek ke sdílení a pokus mimo soutěž', async () => {
    app.go('daily');
    q<HTMLButtonElement>('[data-testid="daily-play"]').click();
    await vi.waitFor(() => expect(app.screenId).toBe('game'));
    const c = running();
    expect(c.state.daily).toBe(true);
    expect(c.state.seed).toBe('DEN-20261002');
    expect(app.profile.current?.official).toBe(true);
    expect(app.profile.daily['20261002']?.status).toBe('playing');

    app.go('daily');
    expect(dailyStatus(app).state).toBe('playing');
    expect(q('[data-testid="daily-continue"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="daily-play"]')).toBeNull();

    // Konec oficiálního pokusu (opuštění) → odehráno, výsledek ke sdílení.
    finishRun(app.profile, c.state, app.profiles.metaCtx(c));
    app.controller = null;
    store.remove(STORAGE_KEYS.run);
    app.go('daily');
    expect(q('[data-testid="daily-today"]').dataset.state).toBe('finished');
    const rec = app.profile.daily['20261002']!;
    expect(q('[data-testid="daily-share-text"]').textContent).toBe(
      dailyShareText(rec.seed, rec.ante, rec.bestHand),
    );
    expect(dailyShareText('DEN-20261001', 7, 1_234_560)).toBe(
      'Karban DEN-20261001 · patro 7 · nejlepší ruka 1 234 560',
    );
    expectNoMissingTexts();

    q<HTMLButtonElement>('[data-testid="daily-replay"]').click();
    await vi.waitFor(() => expect(app.screenId).toBe('game'));
    expect(running().state.daily).toBe(true);
    expect(app.profile.current?.official).toBe(false);
    expect(app.profile.current?.counted).toBe(false);
  });

  it('timeToNextDaily: do půlnoci UTC', () => {
    expect(timeToNextDaily('2026-10-02T10:00:00.000Z')).toEqual({ h: 14, m: 0 });
    expect(timeToNextDaily('2026-10-02T23:59:30.000Z')).toEqual({ h: 0, m: 1 });
  });
});

// ─────────────────────────── Oznámení ───────────────────────────

describe('oznámení meta vrstvy', () => {
  const sample = (): MetaNotice[] => [
    { kind: 'unlock', category: 'decks', id: 'clerk' },
    { kind: 'unlock', category: 'jokers', id: Object.keys(REG.jokers)[0]! },
    { kind: 'unlock', category: 'vouchers', id: Object.keys(REG.vouchers)[0]! },
    { kind: 'unlock', category: 'challenges', id: CHALLENGE_IDS[0]! },
    { kind: 'stake', deckId: 'pub', stake: 2 },
    { kind: 'achievement', id: Object.keys(REG.achievements ?? {})[0]! },
  ];

  it('noticeView: štítek, název, popis a ikona pro každý druh bez chybějících textů', () => {
    for (const n of sample()) {
      const v = noticeView(n, REG);
      for (const text of [v.eyebrow, v.title, v.text]) {
        expect(text).not.toContain('⟦');
        expect(text).not.toMatch(/\{[a-z]+/i);
      }
      expect(v.icon).toMatch(/^[a-z0-9-]+$/);
      expect(v.title.length).toBeGreaterThan(0);
    }
    const ach = noticeView({ kind: 'achievement', id: 'regulars_apprentice' }, REG);
    expect(ach.title).toBe(t('achievements.regulars_apprentice.name'));
    expect(ach.eyebrow).toBe(t('meta.notice.eyebrow.achievement'));
  });

  it('NoticeQueue: dvě naráz, další po odchodu, přebytek shrne jedno oznámení, clear zahodí frontu', () => {
    const shown: { n: MetaNotice; close: () => void }[] = [];
    const queue = new NoticeQueue(REG, (n, _reg, close) => void shown.push({ n, close }));
    const many: MetaNotice[] = Array.from({ length: MAX_NOTICE_QUEUE + 5 }, (_, i) => ({
      kind: 'unlock',
      category: 'challenges',
      id: CHALLENGE_IDS[i % CHALLENGE_IDS.length]!,
    }));
    queue.push(many);
    expect(shown).toHaveLength(META_TOASTS_VISIBLE);
    expect(queue.pending).toBe(MAX_NOTICE_QUEUE - META_TOASTS_VISIBLE + 5);
    shown[0]!.close();
    shown[0]!.close(); // druhé zavření nic nedělá
    expect(shown).toHaveLength(META_TOASTS_VISIBLE + 1);
    queue.clear();
    expect(queue.pending).toBe(0);
    shown[1]!.close(); // starší oznámení po clear frontu neposouvá
    expect(shown).toHaveLength(META_TOASTS_VISIBLE + 1);
    expect(uniqueNotices([...sample(), ...sample()])).toHaveLength(sample().length);
  });

  it('runNoveltiesBlock: seznam novinek, prázdný stav, nezapočítaný run', () => {
    const block = runNoveltiesBlock([...sample(), sample()[0]!], REG, true);
    expect(block.querySelectorAll('.run-news__item')).toHaveLength(sample().length);
    expectNoMissingTexts(block);
    expect(runNoveltiesBlock([], REG, true).textContent).toContain(t('meta.runEnd.empty'));
    expect(runNoveltiesBlock([], REG, false).textContent).toContain(t('meta.runEnd.notCounted'));
    expect(block.querySelector('[data-testid="run-news-empty"]')).toBeNull();
    // Seedovaný run s „Semínkem zaseto“: achievement v seznamu, a přesto poznámka, že se run nepočítá.
    const seeded = runNoveltiesBlock([{ kind: 'achievement', id: 'seed_sown' }], REG, false);
    expect(seeded.querySelectorAll('.run-news__item')).toHaveLength(1);
    expect(seeded.querySelector('[data-testid="run-news-empty"]')?.textContent).toBe(
      t('meta.runEnd.notCounted'),
    );
  });
});

// ─────────────────────────── Pitva, výhra, novinky runu ───────────────────────────

describe('konec runu', () => {
  it('pitva ukáže novinky z runu (achievement za prohru) a u denního runu výsledek ke sdílení', async () => {
    app.go('daily');
    q<HTMLButtonElement>('[data-testid="daily-play"]').click();
    await vi.waitFor(() => expect(app.screenId).toBe('game'));
    const c = running();
    await c.act({ type: 'selectBlind' });
    await settle(c);
    // Poslední ruka jednou kartou cíl nesplní → pitva.
    for (let i = 0; i < 10 && c.state.phase === 'round'; i++) {
      const card = c.state.round!.hand[0]!;
      c.toggleSelect(card);
      await c.play();
      await settle(c);
    }
    expect(c.state.phase).toBe('game_over');
    const runNotices = app.profiles.runNotices(c.state);
    expect(runNotices.some((n) => n.kind === 'achievement')).toBe(true);
    const news = q('[data-testid="run-news"]');
    expect(news.querySelectorAll('.run-news__item').length).toBe(uniqueNotices(runNotices).length);
    expect(q('[data-testid="run-daily-share-text"]').textContent).toBe(
      dailyShareText(c.state.seed, c.state.ante, c.state.stats.bestHandScore),
    );
    expect(q('[data-testid="run-daily"]').textContent).not.toContain(t('meta.runEnd.dailyUnofficial'));
    expectNoMissingTexts();
  });

  it('runNotices po načtení stránky: achievementy získané od začátku runu podle data', () => {
    const p = createProfile(NOW.toISOString());
    const state = structuredClone(
      Game.newRun({ deckId: 'pub', stake: 1, seed: 'NOVINKYA' }, REG).state,
    ) as RunState;
    state.phase = 'victory';
    p.current = null;
    p.achievements.unlocked = {
      first_round: '2026-10-02T09:30:00.000Z',
      [Object.keys(REG.achievements ?? {})[1]!]: '2026-10-01T09:00:00.000Z',
    };
    p.history = [
      {
        no: 1,
        startedAt: '2026-10-02T09:00:00.000Z',
        finishedAt: '2026-10-02T10:00:00.000Z',
        seed: 'NOVINKYA',
        deckId: 'pub',
        stake: 1,
        mode: 'normal',
        challengeId: null,
        seeded: false,
        official: false,
        outcome: 'won',
        ante: 8,
        endless: false,
        cause: null,
        bestHand: 0,
        bestHandType: null,
        jokers: [],
        handsPlayed: 30,
        roundsWon: 24,
      },
    ];
    app = makeApp({ [STORAGE_KEYS.profile]: serializeProfile(p, NOW.toISOString()) });
    expect(app.profiles.runNotices(state)).toEqual([{ kind: 'achievement', id: 'first_round' }]);
    expect(app.profiles.runRecord(state)?.counted).toBe(true);
  });
});

// ─────────────────────────── Tutoriál ───────────────────────────

function roundState(seed = 'TUTORIAL'): RunState {
  const g = Game.newRun({ deckId: 'pub', stake: 1, seed }, REG);
  g.dispatch({ type: 'selectBlind' });
  return structuredClone(g.state) as RunState;
}

function profileWith(seen: string[], patch: Partial<Profile['tutorial']> = {}): Profile {
  const p = createProfile(NOW.toISOString());
  p.tutorial.seen = seen;
  Object.assign(p.tutorial, patch);
  return p;
}

describe('tutoriál: výběr kroku a umístění', () => {
  const view = { selected: 0, canSkip: true };

  it('pendingTutorialStep: kolo (výběr → Zahrát → Zahodit → cíl → pořadí žolíků), šéf má přednost', () => {
    const s = roundState();
    expect(pendingTutorialStep(profileWith([]), s, view)).toBe('select');
    expect(pendingTutorialStep(profileWith([]), s, { ...view, selected: 2 })).toBeNull();
    expect(pendingTutorialStep(profileWith(['select']), s, { ...view, selected: 2 })).toBe('play');
    expect(pendingTutorialStep(profileWith(['select']), s, view)).toBeNull();
    expect(pendingTutorialStep(profileWith(['select', 'play']), s, view)).toBe('discard');
    s.round!.discardsLeft = 0;
    expect(pendingTutorialStep(profileWith(['select', 'play']), s, view)).toBe('goal');
    const done = ['select', 'play', 'discard', 'goal'];
    expect(pendingTutorialStep(profileWith(done), s, view)).toBeNull();
    s.jokers = [
      {
        uid: 1,
        defId: Object.keys(REG.jokers)[0]!,
        edition: null,
        state: {},
        stickers: [],
        sellBonus: 0,
        debuffed: false,
      },
    ];
    expect(pendingTutorialStep(profileWith(done), s, view)).toBe('jokerOrder');
    s.round!.blind = 'boss';
    expect(pendingTutorialStep(profileWith([]), s, view)).toBe('boss');
  });

  it('pendingTutorialStep: konec kola, Večerka, výběr útraty (přeskočení až po první výplatě), vypnutý', () => {
    const s = roundState();
    s.phase = 'round_end';
    expect(pendingTutorialStep(profileWith([]), s, view)).toBe('roundEnd');
    s.phase = 'shop';
    expect(pendingTutorialStep(profileWith([]), s, view)).toBe('shop');
    expect(pendingTutorialStep(profileWith(['shop']), s, view)).toBeNull();
    const b = structuredClone(
      Game.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' }, REG).state,
    ) as RunState;
    expect(pendingTutorialStep(profileWith([]), b, view)).toBeNull();
    expect(pendingTutorialStep(profileWith(['roundEnd']), b, view)).toBe('skip');
    expect(pendingTutorialStep(profileWith(['roundEnd']), b, { ...view, canSkip: false })).toBeNull();
    b.blindIndex = 2;
    expect(pendingTutorialStep(profileWith([]), b, view)).toBe('boss');
    expect(pendingTutorialStep(profileWith([], { skipped: true }), b, view)).toBeNull();
    const off = profileWith([]);
    off.settings.tutorial = false;
    expect(pendingTutorialStep(off, b, view)).toBeNull();
  });

  it('tutorialStepNumber: číslo rady podle počtu viděných rad — roste o jedna v jakémkoli pořadí', () => {
    // Dřív podle pořadí v seznamu: 1 → 2 → 5 → 6 → 9 → 7 → 8.
    expect(tutorialStepNumber([], 'select')).toBe(1);
    expect(tutorialStepNumber(['select', 'play'], 'roundEnd')).toBe(3);
    expect(tutorialStepNumber(['select', 'play', 'roundEnd', 'shop'], 'skip')).toBe(5);
    expect(tutorialStepNumber(['select', 'play', 'roundEnd', 'shop', 'skip'], 'jokerOrder')).toBe(6);
    // Krok sám se nepočítá dvakrát a číslo nepřeroste počet kroků.
    expect(tutorialStepNumber(['select', 'play'], 'play')).toBe(2);
  });

  it('placeBubble: strana v pořadí, vyhne se ovládání, záložní místo, roh bez šipky', () => {
    const vp = { w: 1000, h: 800 };
    const size = { w: 300, h: 150 };
    const target = { left: 400, top: 600, right: 500, bottom: 650 };
    const top = placeBubble(target, size, vp, ['top', 'bottom']);
    expect(top.side).toBe('top');
    expect(top.y).toBe(600 - 150 - 14);
    expect(top.x + top.arrow).toBe(450);
    // Karty nad tlačítkem → bublina nad ně (záložní kotva), ne přes ně.
    const cards = { left: 100, top: 420, right: 900, bottom: 580 };
    const avoided = placeBubble(target, size, vp, ['top'], {
      obstacles: [cards],
      fallbacks: [{ box: cards, placements: ['top'] }],
    });
    expect(avoided.y + size.h).toBeLessThanOrEqual(cards.top);
    expect(avoided.side).toBe('top');
    // Nikde místo → pravý dolní roh bez šipky.
    const corner = placeBubble(target, { w: 990, h: 790 }, vp, ['top', 'left']);
    expect(corner.side).toBeNull();
    expect(placeBubble(null, size, vp, ['top']).side).toBeNull();
  });
});

describe('tutoriál ve hře', () => {
  let tutorial: TutorialController;

  beforeEach(() => {
    tutorial = installTutorial(app);
  });

  const bubble = (): HTMLElement => q('[data-testid="tutorial"]');

  it('bubliny navázané na hru: výběr → Zahrát → po zahrané ruce Zahodit; nebere focus, je přístupná', async () => {
    app.controller = app.profiles.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' });
    app.go('game');
    // Výběr útraty: první rady ještě ne (přeskočení až po první výplatě).
    expect(bubble().hidden).toBe(true);
    const c = running();
    await c.act({ type: 'selectBlind' });
    await settle(c);
    expect(bubble().hidden).toBe(false);
    expect(bubble().dataset.step).toBe('select');
    expect(tutorial.currentStep).toBe('select');
    expect(bubble().getAttribute('role')).toBe('dialog');
    expect(bubble().getAttribute('aria-modal')).toBe('false');
    expect(bubble().contains(document.activeElement)).toBe(false);
    expect(q('[data-testid="tutorial-live"]').textContent).toContain(t('meta.tutorial.steps.select.title'));
    expectNoMissingTexts(bubble());

    c.toggleSelect(c.state.round!.hand[0]!);
    expect(app.profile.tutorial.seen).toContain('select');
    expect(bubble().dataset.step).toBe('play');

    await c.play();
    await settle(c);
    expect(app.profile.tutorial.seen).toContain('play');
    expect(bubble().dataset.step).toBe('discard');
    expect(bubble().textContent).toContain(String(c.state.round!.discardsLeft));
    q<HTMLButtonElement>('[data-testid="tutorial-next"]').click();
    expect(app.profile.tutorial.seen).toContain('discard');
    expect(bubble().dataset.step).toBe('goal');
    expectNoMissingTexts(bubble());
    // Uloženo v profilu.
    expect(deserializeProfile(store.get(STORAGE_KEYS.profile)).tutorial.seen).toContain('discard');
  });

  it('rada se ukáže nejvýš jednou (další akce ji dokončí, přeřazení ne); číslo rady roste o jedna', async () => {
    app.controller = app.profiles.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' });
    app.go('game');
    const c = running();
    await c.act({ type: 'selectBlind' });
    await settle(c);
    const meta = (): string => q('.tutorial__meta').textContent ?? '';
    expect(meta()).toContain(t('meta.tutorial.step', { n: 1, total: 9 }));
    c.toggleSelect(c.state.round!.hand[0]!);
    expect(meta()).toContain(t('meta.tutorial.step', { n: 2, total: 9 }));
    await c.play();
    await settle(c);
    expect(bubble().dataset.step).toBe('discard');
    expect(meta()).toContain(t('meta.tutorial.step', { n: 3, total: 9 }));
    // Hráč radu nechá být a zahraje další ruku → rada je přečtená a už se nevrátí.
    c.toggleSelect(c.state.round!.hand[0]!);
    await c.play();
    await settle(c);
    expect(app.profile.tutorial.seen).toContain('discard');
    expect(bubble().dataset.step).toBe('goal');
    expect(meta()).toContain(t('meta.tutorial.step', { n: 4, total: 9 }));
    // Přeřazení ruky (akce bez událostí) radu nedokončí.
    await c.act({ type: 'sortHand', by: 'suit' });
    await settle(c);
    expect(app.profile.tutorial.seen).not.toContain('goal');
    expect(bubble().dataset.step).toBe('goal');
    // Bublinu obcházejí toasty a tooltipy.
    expect(bubble().hasAttribute('data-overlay-avoid')).toBe(true);
  });

  it('Štamgast v bublině se při připojení ke hře překreslí (tutoriál vzniká dřív, než dorazí ikony)', async () => {
    await loadIcons();
    const avatar = q('[data-testid="tutorial"] .tutorial__avatar');
    // Stav po startu bez ikon: náhradní glyf místo kníru a půllitru.
    avatar.innerHTML = '<svg class="stamgast"></svg>';
    app.controller = app.profiles.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' });
    app.go('game');
    expect(avatar.querySelector('svg.stamgast')).not.toBeNull();
    expect(avatar.querySelector('[data-icon="fallback"]')).toBeNull();
    expect(avatar.querySelector('[data-icon="mustache"]')).not.toBeNull();
    expect(avatar.querySelector('[data-icon="beer-stein"]')).not.toBeNull();
  });

  it('přeskočit tutoriál vypne rady; Nastavení → Zapnout tutoriál znovu ho vrátí od začátku', async () => {
    app.controller = app.profiles.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' });
    app.go('game');
    const c = running();
    await c.act({ type: 'selectBlind' });
    await settle(c);
    q<HTMLButtonElement>('[data-testid="tutorial-skip"]').click();
    expect(app.profile.tutorial.skipped).toBe(true);
    expect(app.settings.tutorial).toBe(false);
    expect(bubble().hidden).toBe(true);

    app.go('settings');
    q<HTMLButtonElement>('[data-testid="settings-tutorial-restart"]').click();
    expect(app.profile.tutorial).toMatchObject({ seen: [], completed: false, skipped: false });
    expect(app.settings.tutorial).toBe(true);
    expect(q<HTMLInputElement>('[data-testid="settings-tutorial"]').checked).toBe(true);
    app.go('game');
    expect(bubble().dataset.step).toBe('select');
  });

  it('dokončení všech kroků → achievement „Štamgastův žák“', () => {
    app.profile.tutorial.seen = [
      'select',
      'play',
      'discard',
      'goal',
      'roundEnd',
      'shop',
      'jokerOrder',
      'boss',
    ];
    const s = structuredClone(
      Game.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' }, REG).state,
    ) as RunState;
    store.set(STORAGE_KEYS.run, serializeRun(s, NOW.toISOString()));
    app.go('game');
    expect(bubble().dataset.step).toBe('skip');
    q<HTMLButtonElement>('[data-testid="tutorial-next"]').click();
    expect(app.profile.tutorial.completed).toBe(true);
    expect(app.profile.achievements.unlocked.regulars_apprentice).toBe(NOW.toISOString());
    expect(notices).toContainEqual({ kind: 'achievement', id: 'regulars_apprentice' });
    expect(bubble().hidden).toBe(true);
  });

  it('mimo herní obrazovku bublina zmizí', async () => {
    app.controller = app.profiles.newRun({ deckId: 'pub', stake: 1, seed: 'TUTORIAL' });
    app.go('game');
    const c = running();
    await c.act({ type: 'selectBlind' });
    await settle(c);
    expect(bubble().hidden).toBe(false);
    app.go('menu');
    expect(bubble().hidden).toBe(true);
  });
});

// ─────────────────────────── Nastavení: zálohy a import ───────────────────────────

describe('nastavení: zálohy profilu a souhrn importu', () => {
  it('backupStoredProfile: záloha uloženého profilu, dvě zálohy v jedné ms se nepřepíšou', () => {
    app.profile.stats.runs.played = 3;
    const k1 = backupStoredProfile(app, NOW);
    expect(k1).toBe(`${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`);
    expect(backupStoredProfile(app, NOW)).toBe(k1); // stejný obsah = stejná záloha
    app.profile.stats.runs.played = 4;
    const k2 = backupStoredProfile(app, NOW);
    expect(k2).not.toBe(k1);
    expect(deserializeProfile(store.get(k1!)).stats.runs.played).toBe(3);
    expect(deserializeProfile(store.get(k2!)).stats.runs.played).toBe(4);
  });

  it('importSummary: profil (runy, achievementy), rozehraná hra, jen nastavení', () => {
    const p = createProfile(NOW.toISOString());
    p.stats.runs.played = 5;
    p.achievements.unlocked = { first_round: NOW.toISOString() };
    const run = serializeRun(roundState(), NOW.toISOString());
    const plan = parseImport(
      JSON.stringify({
        format: 'karban-export',
        version: 1,
        exportedAt: NOW.toISOString(),
        appVersion: '0',
        settings: {},
        profile: JSON.parse(serializeProfile(p, NOW.toISOString())),
        run: JSON.parse(run),
      }),
      REG,
      NOW,
    );
    const text = importSummary(plan);
    expect(text).toContain(t('settings.import.summary.profile', { runs: 5, achievements: 1 }));
    expect(text).toContain(t('settings.import.summary.run', { deck: t('decks.pub.name'), ante: 1 }));
    expect(importSummary({ settings: undefined })).toContain(t('settings.import.summary.settingsOnly'));
    expect(text).not.toContain('⟦');
  });

  it('přepínač rad Štamgasta vrátí i přeskočený tutoriál', () => {
    app.profile.tutorial.skipped = true;
    app.updateSettings({ tutorial: false });
    app.go('settings');
    const toggle = q<HTMLInputElement>('[data-testid="settings-tutorial"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.settings.tutorial).toBe(true);
    expect(app.profile.tutorial.skipped).toBe(false);
  });
});
