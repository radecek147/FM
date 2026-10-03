// @vitest-environment happy-dom
/**
 * Opravy UI po testu 1.0 (1.0.1, docs/DECISIONS.md „2026-10-03 — Oprava UI po testu 1.0“):
 *  - Pan starosta: laťka `scoreToBeat` a odhad v náhledu (bez změny runu a RNG), „Překonej: X“ a varování,
 *  - levý panel: náhled kombinace jen v kole, poražená útrata, pohár na výherní obrazovce, velká čísla (`--chars`),
 *    výplata po startu nekonečného režimu, focus na ruku po výběru útraty,
 *  - ruka: šestá karta a Enter / X bez výběru dají zpětnou vazbu,
 *  - Večerka a obálka: tap na kartu otevře detail s tlačítky slotu, důvod neaktivního tlačítka je vidět,
 *  - nová hra: zamčené balíčky v kompaktní mřížce, chyba seedu u pole,
 *  - novinky: fronta vyřadí to, co ukazuje seznam na pitvě / výhře; postup „úroveň kombinace“ bez výchozí 1.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { JokerInstance, MetaNotice, RunState } from '../../src/engine';
import { Game, createBot, serializeRun } from '../../src/engine';
import { createProfile } from '../../src/engine/meta';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import { clearToasts, holdToasts, toast } from '../../src/ui/components/toast';
import { GameController } from '../../src/ui/controller';
import { NoticeQueue } from '../../src/ui/metaNotices';
import { unlockInfo } from '../../src/ui/metaText';
import { gameScreen } from '../../src/ui/screens/game';
import { setNumberText } from '../../src/ui/screens/game/sidebar';
import { newGameScreen } from '../../src/ui/screens/newGame';
import { memoryStore, STORAGE_KEYS, type KeyValueStore } from '../../src/ui/storage';

const REG = registry();

let app: App;
let store: KeyValueStore;
let root: HTMLElement;

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div><canvas id="fx"></canvas>';
  root = document.querySelector<HTMLElement>('#app')!;
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = new App(root, store, REG);
  app.register('game', gameScreen);
  app.register('newGame', newGameScreen);
  app.register('menu', () => ({ el: document.createElement('main') }));
});

beforeEach(() => {
  store.remove(STORAGE_KEYS.run);
});

afterEach(() => {
  closeAllModals();
  clearToasts();
});

// ─────────────────────────── Pomocníci ───────────────────────────

function newState(seed: string): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed }, REG).state) as RunState;
}

function bossRound(seed: string, bossId: string, ante = 8): RunState {
  const s = newState(seed);
  s.ante = ante;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  s.blinds[2]!.bossId = bossId;
  s.blindIndex = 2;
  const g = Game.fromState(s, REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  return structuredClone(g.state) as RunState;
}

function joker(uid: number, defId: string): JokerInstance {
  const def = REG.jokers[defId]!;
  return {
    uid,
    defId,
    edition: null,
    state: def.initState?.() ?? {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
  };
}

function open(state: RunState): GameController {
  store.set(STORAGE_KEYS.run, serializeRun(state, '2026-10-03T00:00:00.000Z'));
  const c = GameController.resume({ registry: REG, store });
  if (!c) throw new Error('resume failed');
  app.controller = c;
  app.go('game');
  return c;
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
}

const q = (testId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Pět karet s nejvyšší hodnotou (první ruka u Pana starosty). */
function topFive(
  hand: readonly number[],
  card: (id: number) => { id: number; rank: number } | undefined,
): number[] {
  return hand
    .map((id) => card(id)!)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map((c) => c.id);
}

/** Karta s nejnižší hodnotou v ruce (slabá ruka po silné). */
function lowestCard(c: GameController): number {
  const hand = c.state.round!.hand.map((id) => c.engine.card(id)!);
  hand.sort((a, b) => a.rank - b.rank);
  return hand[0]!.id;
}

// ─────────────────────────── Pan starosta ───────────────────────────

describe('Pan starosta: laťka a odhad v náhledu', () => {
  it('engine: scoreToBeat až po první ruce, odhad slabé ruky pod laťkou; dotaz nemění run ani RNG', () => {
    const g = Game.fromState(bossRound('MAYOR101', 'mayor'), REG);
    expect(g.scoreToBeat()).toBeNull();
    const res = g.dispatch({ type: 'play', cardIds: topFive(g.state.round!.hand, (id) => g.card(id)) });
    if (!res.ok) throw new Error(res.error);
    const played = res.events.find((e) => e.type === 'handPlayed');
    if (!played || played.type !== 'handPlayed') throw new Error('bez ruky');
    const raw = Math.floor(played.result.chips * played.result.mult);
    expect(g.scoreToBeat()).toBe(raw);

    const hand = g.state.round!.hand.map((id) => g.card(id)!).sort((a, b) => a.rank - b.rank);
    const before = JSON.stringify(g.state);
    const p = g.preview([hand[0]!.id]);
    expect(JSON.stringify(g.state)).toBe(before);
    expect(p.scoreToBeat).toBe(raw);
    expect(p.estimate).toBeDefined();
    expect(p.estimate!).toBeLessThanOrEqual(raw);
    // Bez laťky (jiný šéf) se odhad nepočítá.
    const other = Game.fromState(bossRound('MAYOR101', 'drilling_neighbor', 2), REG);
    const op = other.preview([other.state.round!.hand[0]!]);
    expect(op.scoreToBeat).toBeUndefined();
    expect(op.estimate).toBeUndefined();
  });

  it('levý panel: „Překonej: X“ po první ruce a varování, když odhad laťku nepřekoná', async () => {
    const c = open(bossRound('MAYOR102', 'mayor'));
    expect(q('hand-beat')!.hidden).toBe(true);
    for (const id of topFive(c.state.round!.hand, (id) => c.engine.card(id))) c.toggleSelect(id);
    await c.play();
    await settle(c);
    const beat = c.engine.scoreToBeat();
    expect(beat).not.toBeNull();
    expect(q('hand-beat')!.hidden).toBe(false);
    expect(norm(q('hand-beat')!.textContent)).toBe(norm(t('game.sidebar.scoreToBeat', { score: beat! })));
    c.toggleSelect(lowestCard(c));
    const p = c.preview();
    expect(q('hand-blocked')!.hidden).toBe(false);
    expect(norm(q('hand-blocked')!.textContent)).toBe(
      norm(t('game.sidebar.belowBeat', { estimate: p.estimate!, score: beat! })),
    );
    // Varování nese obě čísla — řádek „Překonej“ se schová.
    expect(q('hand-beat')!.hidden).toBe(true);
  });
});

// ─────────────────────────── Levý panel ───────────────────────────

describe('levý panel', () => {
  it('náhled kombinace jen v kole; výběr útraty ho schová, kolo ho ukáže a focus padne na ruku', async () => {
    const c = open(newState('SIDE101'));
    const handBox = document.querySelector<HTMLElement>('.gs-hand')!;
    expect(c.state.phase).toBe('blind_select');
    expect(handBox.hidden).toBe(true);
    q('blind-select-small')!.focus();
    q('blind-select-small')!.click();
    await settle(c);
    expect(c.state.phase).toBe('round');
    expect(handBox.hidden).toBe(false);
    expect(document.activeElement).toBe(q('hand'));
  });

  it('konec kola: útrata poražená (bez pravidla), výhra: pohár a bez dalšího šéfa', () => {
    const s = newState('SIDE102');
    const g = Game.fromState(s, REG);
    g.dispatch({ type: 'selectBlind' });
    const won = structuredClone(g.state) as RunState;
    won.round!.score = won.round!.target - 1;
    const g2 = Game.fromState(won, REG);
    const ids = createBot('max').decide(g2);
    g2.dispatch(ids);
    const roundEnd = structuredClone(g2.state) as RunState;
    expect(roundEnd.phase).toBe('round_end');
    open(roundEnd);
    expect(document.querySelector('.gs-blind')!.classList.contains('is-beaten')).toBe(true);
    expect(norm(q('blind-rule')!.textContent)).toBe(norm(t('game.sidebar.blindBeaten')));

    const v = structuredClone(roundEnd) as RunState;
    v.phase = 'victory';
    open(v);
    expect(norm(q('blind-name')!.textContent)).toBe(t('game.sidebar.phase.victory'));
    expect(q('blind-rule')!.hidden).toBe(true);
    expect(document.querySelector('.gs-blind__trophy')).not.toBeNull();
    expect(document.querySelector('.gs-blind')!.getAttribute('data-blind')).toBe('victory');
  });

  it('po „Nekonečný režim“ ukáže výplata, že jde o odměnu za finálového šéfa', () => {
    const s = bossRound('ENDLESS1', 'mayor');
    s.round!.score = s.round!.target + 1;
    s.phase = 'round_end';
    s.endless = true;
    s.rewards = { blindReward: 5, unusedHands: 0, unusedDiscards: 0, interest: 0, extra: [], total: 5 };
    open(s);
    expect(norm(document.querySelector('#round-end-title')!.textContent)).toBe(
      t('game.roundEnd.endlessTitle'),
    );
  });

  it('velká čísla: délka textu do --chars (CSS podle ní zmenší písmo, nezlomí skupinu číslic)', () => {
    const el = document.createElement('p');
    setNumberText(el, '987 654 321 098 765');
    expect(el.textContent).toBe('987 654 321 098 765');
    expect(el.style.getPropertyValue('--chars')).toBe('19');
  });
});

// ─────────────────────────── Ruka ───────────────────────────

describe('ruka: zpětná vazba výběru', () => {
  it('šestá karta se nevybere tiše; Enter i X bez výběru hlásí „nejdřív vyber karty“', () => {
    const g = Game.fromState(newState('HAND101'), REG);
    g.dispatch({ type: 'selectBlind' });
    const c = open(structuredClone(g.state) as RunState);
    const alert = q('hand-alert')!;
    expect(alert.hidden).toBe(true);
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="hand"] .pcard')];
    const max = c.engine.modifiers().maxSelect;
    for (const el of cards.slice(0, max + 1)) el.click();
    expect(c.selected).toHaveLength(max);
    expect(alert.hidden).toBe(false);
    expect(norm(alert.textContent)).toBe(norm(t('game.hand.maxSelected', { max })));

    c.clearSelection();
    alert.hidden = true;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(alert.hidden).toBe(false);
    expect(norm(alert.textContent)).toBe(norm(t('game.hand.selectFirst')));
    alert.hidden = true;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(alert.hidden).toBe(false);
    expect(c.state.round!.discardsLeft).toBe(c.engine.modifiers().discards);
  });
});

// ─────────────────────────── Večerka a obálka ───────────────────────────

describe('Večerka a obálka: detail na tap, důvod neaktivního tlačítka', () => {
  function shopState(): RunState {
    const s = newState('SHOP101');
    s.phase = 'shop';
    s.money = 3;
    s.jokers = [1, 2, 3, 4, 5].map((i) => joker(900 + i, 'beer_mat'));
    s.shop = {
      items: [{ kind: 'joker', joker: joker(950, 'hearts_man'), price: 5, sold: false }],
      boosters: [],
      vouchers: [],
      rerollCost: 4,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    } as unknown as RunState['shop'];
    return s;
  }

  it('Večerka: tap na kartu otevře detail s popisem a tlačítky; důvod je vidět pod slotem', () => {
    open(shopState());
    const slot = q('shop-item-0')!;
    expect(norm(slot.querySelector('[data-testid="offer-why"]')?.textContent)).toBe(
      norm(t('game.shop.cantAfford')),
    );
    const card = slot.querySelector<HTMLButtonElement>('.shop-slot__card button')!;
    expect(card.getAttribute('aria-haspopup')).toBe('dialog');
    expect(card.hasAttribute('aria-pressed')).toBe(false);
    card.click();
    const detail = q('shop-detail')!;
    expect(detail.textContent).toContain(t('jokers.hearts_man.name'));
    expect(q('detail-shop-buy-0')).not.toBeNull();
    expect((q('detail-shop-buy-0') as HTMLButtonElement).disabled).toBe(true);
    expect(norm(q('detail-why')!.textContent)).toBe(norm(t('game.shop.cantAfford')));
  });
});

// ─────────────────────────── Nová hra ───────────────────────────

describe('nová hra', () => {
  it('zamčené balíčky v kompaktní mřížce za odemčenými; neplatný seed nechá hráče u pole s chybou', () => {
    app.go('newGame');
    const locked = q('deck-locked-grid')!;
    expect(locked.querySelectorAll('.deck-option').length).toBe(Object.keys(REG.decks).length - 2);
    expect(locked.querySelector('[data-testid="deck-pub"]')).toBeNull();
    // Odemčené napřed (v DOM i pro šipky).
    const all = [...document.querySelectorAll<HTMLElement>('.deck-option')].map((d) => d.dataset.deck);
    expect(all.slice(0, 2)).toEqual(['pub', 'regulars']);
    const input = q('seed-input') as HTMLInputElement;
    input.value = 'O0I1ABCD';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q('newgame-start-top')!.click();
    expect(q('seed-status')!.dataset.state).toBe('error');
    expect(q('seed-status')!.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it('nápověda seedu odpovídá tomu, že seedovaný run dá jen „Semínko zaseto“', () => {
    expect(t('newGame.seed.seededNote')).toContain(t('achievements.seed_sown.name'));
    expect(t('meta.runEnd.notCounted')).toContain(t('achievements.seed_sown.name'));
  });
});

// ─────────────────────────── Novinky a odemykání ───────────────────────────

describe('novinky a odemykání', () => {
  it('NoticeQueue.drop: vyřadí čekající novinky i pozdržený toast se stejnou novinkou', () => {
    const shown: string[] = [];
    const q2 = new NoticeQueue(REG, (n, _r, onClose) => {
      shown.push(n.kind === 'achievement' ? n.id : n.kind);
      const h = toast(`novinka ${shown.length}`, { background: true, onClose });
      h.el.dataset.notice = n.kind === 'achievement' ? `achievement:${n.id}` : '';
    });
    holdToasts('test', true);
    const a: MetaNotice = { kind: 'achievement', id: 'seed_sown' };
    const b: MetaNotice = { kind: 'achievement', id: 'pub_inventory' };
    q2.push([a, b]);
    expect(shown).toEqual(['seed_sown']);
    expect(q2.pending).toBe(1);
    q2.drop([a, b]);
    expect(q2.pending).toBe(0);
    holdToasts('test', false);
    expect(document.querySelectorAll('.toast').length).toBe(0);
  });

  it('Kalendářový balíček: na čistém profilu bez „(1 / 6)“ (úroveň 1 má každý), s úrovní 2 postup ukáže', () => {
    const p = createProfile('2026-10-03T00:00:00.000Z');
    const info = unlockInfo(p, REG, 'decks', 'almanac');
    expect(info).not.toBeNull();
    expect(info!.progressText).toBeNull();
    p.stats.records.handLevels.flush = 2;
    expect(unlockInfo(p, REG, 'decks', 'almanac')!.progressText).toBe(
      t('meta.collection.progress', { progress: 2, target: 6 }),
    );
    // Počty dál ukazují i nulu („(0 / 5)“).
    expect(unlockInfo(p, REG, 'decks', 'clerk')!.progressText).toBe(
      t('meta.collection.progress', { progress: 0, target: 5 }),
    );
  });
});
