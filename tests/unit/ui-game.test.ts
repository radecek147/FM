// @vitest-environment happy-dom
/**
 * Herní obrazovka (src/ui/screens/game) a presenter: vykreslení každé fáze runu bez výjimky a bez
 * ⟦chybějících textů⟧, ovládání klávesami (1–8 i česká QWERTZ, Enter, X, S/B, Esc), nákup ve Večerce,
 * detail žolíka, dialogy a čisté pomocné funkce (rozpis odměn, hláška pitvy, číslo kola…).
 * Animace jsou vypnuté (presenter běží okamžitě).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { JokerInstance, RunState } from '../../src/engine';
import { Game, serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import { GameController } from '../../src/ui/controller';
import { stepDuration, tickNumber } from '../../src/ui/present';
import { digitIndex, gameScreen } from '../../src/ui/screens/game';
import { deathQuote } from '../../src/ui/screens/game/endScreens';
import { rewardLines, rewardSourceLabel } from '../../src/ui/screens/game/roundEnd';
import { roundNumber } from '../../src/ui/screens/game/shared';
import { memoryStore, STORAGE_KEYS, type KeyValueStore } from '../../src/ui/storage';

const REG = registry();
const SEED = 'UITEST1';

let app: App;
let store: KeyValueStore;
let root: HTMLElement;

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div><canvas id="fx"></canvas>';
  root = document.querySelector<HTMLElement>('#app')!;
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = new App(root, store, REG);
  app.register('game', gameScreen);
  app.register('menu', () => ({ el: document.createElement('main') }));
  app.register('newGame', () => ({ el: document.createElement('main') }));
});

beforeEach(() => {
  store.remove(STORAGE_KEYS.run);
});

afterEach(() => {
  closeAllModals();
});

const deps = () => ({ registry: REG, store });

/** Spustí herní obrazovku nad controllerem. */
function open(c: GameController): void {
  app.controller = c;
  app.go('game');
}

/** Controller z (upraveného) stavu přes uložení — stejně jako Pokračovat z menu. */
function fromState(state: RunState): GameController {
  store.set(STORAGE_KEYS.run, serializeRun(state, '2026-10-01T00:00:00.000Z'));
  const c = GameController.resume(deps());
  if (!c) throw new Error('resume failed');
  return c;
}

function freshState(): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed: SEED }, REG).state) as RunState;
}

function phase(): string | undefined {
  return root.querySelector<HTMLElement>('.game')?.dataset.phase;
}

/** Žádný chybějící text (⟦klíč⟧) ani nedosazený {parametr} v textu ani v popiscích. */
function expectNoMissingTexts(): void {
  const scope = document.body;
  expect(scope.textContent ?? '').not.toContain('⟦');
  expect(scope.textContent ?? '').not.toMatch(/\{[a-z]+(\|[^}]*)?\}/i);
  for (const el of scope.querySelectorAll('[aria-label], [title]')) {
    const text = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`;
    expect(text).not.toContain('⟦');
  }
}

/** Počká, až doběhne akce i překreslení (presenter je asynchronní i bez animací). */
async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
}

function press(key: string, code = ''): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
}

function testJoker(uid: number, defId = Object.keys(REG.jokers)[0]!): JokerInstance {
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

async function inRound(): Promise<GameController> {
  const c = GameController.newRun({ deckId: 'pub', stake: 1, seed: SEED }, deps());
  open(c);
  await c.act({ type: 'selectBlind' });
  await settle(c);
  return c;
}

describe('herní obrazovka – fáze runu', () => {
  it('výběr útraty: tři karty s cílem a odměnou, Malá je na řadě', () => {
    const c = GameController.newRun({ deckId: 'pub', stake: 1, seed: SEED }, deps());
    open(c);
    expect(phase()).toBe('blind_select');
    const cards = root.querySelectorAll('.blind-card');
    expect(cards).toHaveLength(3);
    expect(root.querySelector('[data-testid="blind-small"]')?.getAttribute('data-status')).toBe('current');
    expect(root.querySelector('[data-testid="blind-select-small"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="blind-skip-small"]')).not.toBeNull();
    // Šéf patra: jeho jméno z textů (bez šéfů v registru obecné pravidlo), žádný chybějící text.
    const bossId = c.state.blinds[2]?.bossId;
    expect(root.querySelector('[data-testid="blind-boss"]')?.textContent).toContain(
      bossId ? t(`bosses.${bossId}.name`) : t('game.blinds.bossNoRule'),
    );
    expect(root.querySelector('[data-testid="round-target"]')?.textContent).not.toBe('–');
    expectNoMissingTexts();
  });

  it('kolo: ruka 8 karet se zkratkami, Zahrát/Zahodit neaktivní bez výběru, balíček zbývá/celkem', async () => {
    const c = await inRound();
    expect(phase()).toBe('round');
    const hand = root.querySelectorAll('[data-testid="hand"] .pcard');
    expect(hand).toHaveLength(8);
    expect(hand[0]?.getAttribute('aria-keyshortcuts')).toBe('1');
    expect(root.querySelector<HTMLButtonElement>('[data-testid="play"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="discard"]')?.disabled).toBe(true);
    expect(root.querySelector('[data-testid="deck-count"]')?.textContent).toBe(
      t('game.deck.count', { left: c.state.round!.drawPile.length, total: 52 }),
    );
    expectNoMissingTexts();
  });

  it('konec kola: rozpis odměn s celkovou částkou a Vyplatit', () => {
    const s = freshState();
    const g = Game.fromState(s, REG);
    g.dispatch({ type: 'selectBlind' });
    const st = structuredClone(g.state) as RunState;
    st.phase = 'round_end';
    st.round!.score = st.round!.target;
    st.rewards = {
      blindReward: 3,
      unusedHands: 2,
      unusedDiscards: 0,
      interest: 1,
      extra: [{ source: 'held', amount: 3 }],
      total: 9,
    };
    open(fromState(st));
    expect(phase()).toBe('round_end');
    expect(root.querySelectorAll('.round-end__line')).toHaveLength(5);
    expect(root.querySelector('[data-testid="reward-total"]')?.textContent).toBe(
      t('game.roundEnd.amount', { n: 9 }),
    );
    expect(root.querySelector('[data-testid="cash-out"]')?.textContent).toContain(
      t('game.roundEnd.cashOut', { n: 9 }),
    );
    expectNoMissingTexts();
  });

  it('Večerka: nákup žolíka přes tlačítko, prázdná Večerka hlásí inventuru', async () => {
    const s = freshState();
    s.phase = 'shop';
    s.money = 10;
    s.shop = {
      items: [{ kind: 'joker', joker: testJoker(500), price: 4, sold: false }],
      boosters: [],
      vouchers: [],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    const c = fromState(s);
    open(c);
    expect(phase()).toBe('shop');
    expect(root.querySelector('[data-testid="shop-empty"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="shop-buy-0"]')!.click();
    await settle(c);
    expect(c.state.jokers).toHaveLength(1);
    expect(c.state.money).toBe(6);
    expect(root.querySelectorAll('[data-testid="joker-row"] .kcard')).toHaveLength(1);
    expect(root.querySelector('[data-testid="money"]')?.textContent).toBe('6 Kč');
    // Vše vyprodané → „Večerka zavřená – inventura“.
    expect(root.querySelector('[data-testid="shop-empty"]')?.textContent).toContain(t('game.shop.empty'));
    expectNoMissingTexts();
  });

  it('obálka: možnosti s Vzít / Do balíčku a Přeskočit (obálka mimo registr má obecný název)', async () => {
    const s = freshState();
    s.phase = 'booster';
    s.booster = {
      boosterId: 'neznama_obalka',
      options: [
        { kind: 'joker', joker: testJoker(600) },
        { kind: 'card', card: { ...s.deck[0]!, id: 9999 } },
      ],
      picksLeft: 1,
      hand: [],
      returnTo: 'blind_select',
    };
    const c = fromState(s);
    open(c);
    expect(phase()).toBe('booster');
    expect(root.querySelectorAll('.booster-option')).toHaveLength(2);
    expect(root.querySelector('[data-testid="booster-picks"]')?.textContent).toBe(
      t('game.booster.pick', { n: 1 }),
    );
    expectNoMissingTexts();
    root.querySelector<HTMLButtonElement>('[data-testid="booster-take-0"]')!.click();
    await settle(c);
    expect(c.state.phase).toBe('blind_select');
    expect(c.state.jokers).toHaveLength(1);
    expect(phase()).toBe('blind_select');
  });

  it('pitva: příčina, hláška Malé útraty, statistiky a seed; uložený run je smazaný', async () => {
    const c = await inRound();
    for (let i = 0; i < 4 && c.state.phase === 'round'; i++) {
      c.toggleSelect(c.handIds()[0]!);
      await c.play();
    }
    expect(c.state.phase).toBe('game_over');
    expect(phase()).toBe('game_over');
    expect(root.querySelector('[data-testid="death-quote"]')?.textContent).toBe(t('game.death.small'));
    expect(root.querySelector('[data-testid="run-seed"]')?.textContent).toBe(SEED);
    expect(root.querySelector('[data-testid="run-stats"]')).not.toBeNull();
    expect(store.get(STORAGE_KEYS.run)).toBeNull();
    expectNoMissingTexts();
  });

  it('výhra: titulky se statistikou, Konec / Nekonečný režim → konec kola', async () => {
    const g = Game.fromState(freshState(), REG);
    g.dispatch({ type: 'selectBlind' });
    const st = structuredClone(g.state) as RunState;
    st.phase = 'victory';
    st.ante = 8;
    st.rewards = { blindReward: 5, unusedHands: 0, unusedDiscards: 0, interest: 0, extra: [], total: 5 };
    const c = fromState(st);
    open(c);
    expect(phase()).toBe('victory');
    expect(root.querySelector('[data-testid="victory"]')?.textContent).toContain(t('game.victory.title'));
    expectNoMissingTexts();
    root.querySelector<HTMLButtonElement>('[data-testid="victory-endless"]')!.click();
    await settle(c);
    expect(c.state.phase).toBe('round_end');
    expect(c.state.endless).toBe(true);
    expect(phase()).toBe('round_end');
    expect(root.querySelector('[data-testid="ante"]')?.textContent).toBe('8');
  });
});

describe('herní obrazovka – ovládání', () => {
  it('klávesy 1–8 vybírají karty (i česká QWERTZ podle kódu klávesy), náhled ukáže kombinaci', async () => {
    const c = await inRound();
    press('1', 'Digit1');
    expect(c.selected).toHaveLength(1);
    const first = root.querySelector('[data-testid="hand"] .pcard');
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    // Česká klávesnice: na místě dvojky je „ě“.
    press('ě', 'Digit2');
    expect(c.selected).toHaveLength(2);
    expect(root.querySelector('[data-testid="hand-name"]')?.textContent).not.toBe(t('game.sidebar.handNone'));
    expect(root.querySelector<HTMLButtonElement>('[data-testid="play"]')?.disabled).toBe(false);
    press('1', 'Digit1');
    expect(c.selected).toHaveLength(1);
  });

  it('Enter zahraje vybrané karty, X zahodí, S a B seřadí ruku', async () => {
    const c = await inRound();
    press('1', 'Digit1');
    press('Enter', 'Enter');
    await settle(c);
    expect(c.state.round?.handsPlayed).toBe(1);
    expect(Number(root.querySelector('[data-testid="hands-left"]')?.textContent)).toBe(3);
    expect(root.querySelector('[data-testid="round-score"]')?.textContent).toBe(String(c.state.round!.score));

    press('2', 'Digit2');
    press('x', 'KeyX');
    await settle(c);
    expect(c.state.round?.discardsUsed).toBe(1);
    expect(root.querySelectorAll('[data-testid="hand"] .pcard')).toHaveLength(8);

    press('s', 'KeyS');
    await settle(c);
    const ranks = c.handIds().map((id) => c.engine.card(id)!.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    const domOrder = [...root.querySelectorAll<HTMLElement>('[data-testid="hand"] .pcard')].map((el) =>
      Number(el.dataset.cardId),
    );
    expect(domOrder).toEqual([...c.handIds()]);
    press('b', 'KeyB');
    await settle(c);
    expect(root.querySelectorAll('[data-testid="hand"] .pcard')).toHaveLength(8);
  });

  it('Enter na kartě zaměřené kliknutím zahraje vybrané karty (kartu nepřepne)', async () => {
    const c = await inRound();
    const cards = root.querySelectorAll<HTMLButtonElement>('[data-testid="hand"] .pcard');
    cards[0]!.click();
    cards[1]!.click();
    cards[1]!.focus();
    expect(c.selected).toHaveLength(2);
    const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    cards[1]!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await settle(c);
    expect(c.state.round?.handsPlayed).toBe(1);
    expect(c.state.stats.cardsPlayed).toBe(2);
  });

  it('neplatné zahození (došla zahození) výběr nechá a oznámí důvod', async () => {
    const g = Game.fromState(freshState(), REG);
    g.dispatch({ type: 'selectBlind' });
    const st = structuredClone(g.state) as RunState;
    st.round!.discardsLeft = 0;
    const c = fromState(st);
    open(c);
    press('1', 'Digit1');
    press('2', 'Digit2');
    press('x', 'KeyX');
    await settle(c);
    expect(c.selected).toHaveLength(2);
    expect(c.state.round?.discardsUsed).toBe(0);
    expect(document.querySelector('[data-testid="toast-action-error"]')?.textContent).toContain(
      t('errors.noDiscardsLeft'),
    );
    // Zahrání pak vezme oba vybrané a výběr vyprázdní.
    press('Enter', 'Enter');
    await settle(c);
    expect(c.state.round?.handsPlayed).toBe(1);
    expect(c.selected).toEqual([]);
  });

  it('Enter ve výběru útraty vybere útratu; Esc otevře pauzu, Pokračovat ji zavře', async () => {
    const c = GameController.newRun({ deckId: 'pub', stake: 1, seed: SEED }, deps());
    open(c);
    press('Enter', 'Enter');
    await settle(c);
    expect(c.state.phase).toBe('round');
    expect(phase()).toBe('round');
    press('Escape', 'Escape');
    const pause = document.querySelector('[data-testid="pause-modal"]');
    expect(pause).not.toBeNull();
    expectNoMissingTexts();
    document.querySelector<HTMLButtonElement>('[data-testid="pause-resume"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="pause-modal"]')).toBeNull());
  });

  it('detail žolíka: posun doprava mění pořadí, Prodat prodá', async () => {
    const s = freshState();
    s.jokers = [testJoker(701), testJoker(702, Object.keys(REG.jokers)[1]!)];
    const c = fromState(s);
    open(c);
    const first = root.querySelector<HTMLElement>('[data-joker-uid="701"]');
    expect(first).not.toBeNull();
    first!.click();
    expect(document.querySelector('[data-testid="joker-detail"]')).not.toBeNull();
    expectNoMissingTexts();
    document.querySelector<HTMLButtonElement>('[data-testid="joker-move-right"]')!.click();
    await settle(c);
    expect(c.state.jokers.map((j) => j.uid)).toEqual([702, 701]);
    expect(document.querySelector('[data-testid="joker-position"]')?.textContent).toBe(
      t('game.joker.position', { n: 2, max: 2 }),
    );
    const before = c.state.money;
    document.querySelector<HTMLButtonElement>('[data-testid="joker-sell"]')!.click();
    await settle(c);
    expect(c.state.jokers.map((j) => j.uid)).toEqual([702]);
    expect(c.state.money).toBeGreaterThan(before);
    expect(root.querySelectorAll('[data-testid="joker-row"] .kcard')).toHaveLength(1);
  });

  it('Info o runu ukáže úrovně kombinací (tajné jako ???) a náhled balíčku všech 52 karet', async () => {
    const c = await inRound();
    await settle(c);
    root.querySelector<HTMLButtonElement>('[data-testid="run-info"]')!.click();
    const table = document.querySelector('[data-testid="run-info-hands"]');
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(13);
    expect(table?.querySelectorAll('tr.is-secret')).toHaveLength(3);
    // Tajná kombinace objevená v profilu (v dřívějším runu) je vidět i v dalších runech (DESIGN 2.2.4).
    closeAllModals();
    app.profile.discovered.hands.push('five');
    root.querySelector<HTMLButtonElement>('[data-testid="run-info"]')!.click();
    const again = document.querySelector('[data-testid="run-info-hands"]');
    expect(again?.querySelectorAll('tr.is-secret')).toHaveLength(2);
    expect(again?.querySelector('tr[data-hand="five"]')?.textContent).toContain(t('hands.five.name'));
    expect(document.querySelector('[data-testid="run-info-seed"]')?.textContent).toContain(SEED);
    expectNoMissingTexts();
    closeAllModals();
    root.querySelector<HTMLButtonElement>('[data-testid="deck"]')!.click();
    const modal = document.querySelector('[data-testid="deck-modal"]');
    expect(modal?.querySelectorAll('.deck-mini')).toHaveLength(52);
    // V ruce je 8 karet → venku (zašedlé).
    expect(modal?.querySelectorAll('.deck-mini.is-out')).toHaveLength(8);
    expectNoMissingTexts();
  });

  it('bez rozehrané hry ukáže cestu zpět do menu', () => {
    app.controller = null;
    app.go('game');
    expect(root.textContent).toContain(t('game.noGame'));
  });
});

describe('pomocné funkce herní obrazovky', () => {
  it('rozpis odměn vynechá nulové položky kromě odměny za útratu', () => {
    const lines = rewardLines(
      {
        blindReward: 0,
        unusedHands: 0,
        unusedDiscards: 2,
        interest: 0,
        extra: [{ source: 'rental:x', amount: -2 }],
        total: 0,
      },
      0,
      2,
    );
    expect(lines.map(([, n]) => n)).toEqual([0, 2, -2]);
    expect(lines[1]?.[0]).toBe(t('game.roundEnd.discards', { n: 2 }));
  });

  it('popisky zdrojů bonusů: zlaté karty, žolík podle id, balíček, neznámé', () => {
    const jokerId = Object.keys(REG.jokers)[0]!;
    expect(rewardSourceLabel('held')).toBe(t('game.roundEnd.held'));
    expect(rewardSourceLabel(`joker:${jokerId}`)).toBe(t(`jokers.${jokerId}.name`));
    expect(rewardSourceLabel('deck:pub')).toBe(t('decks.pub.name'));
    expect(rewardSourceLabel('cosi')).toBe(t('game.roundEnd.other'));
  });

  it('hláška pitvy: Malá, Velká, šéf bez textu', () => {
    expect(deathQuote('small')).toBe(t('game.death.small'));
    expect(deathQuote('big')).toBe(t('game.death.big'));
    expect(deathQuote('neznamy_sef')).toBe(t('game.death.boss'));
  });

  it('klávesy 1–9 podle kódu i znaku, ostatní nic', () => {
    expect(digitIndex({ key: '1', code: 'Digit1' })).toBe(0);
    expect(digitIndex({ key: 'é', code: 'Digit9' })).toBe(8);
    expect(digitIndex({ key: '3', code: 'Numpad3' })).toBe(2);
    expect(digitIndex({ key: '4', code: '' })).toBe(3);
    expect(digitIndex({ key: '0', code: 'Digit0' })).toBeNull();
    expect(digitIndex({ key: 'x', code: 'KeyX' })).toBeNull();
  });

  it('číslo kola: rozehrané / příští kolo, po výhře počet vyhraných', () => {
    const s = freshState();
    expect(roundNumber(s)).toBe(1);
    s.stats.roundsWon = 2;
    s.phase = 'shop';
    expect(roundNumber(s)).toBe(2);
    s.phase = 'round';
    expect(roundNumber(s)).toBe(3);
  });

  it('délka kroku skórování se u dlouhých řetězů zkracuje v mezích', () => {
    expect(stepDuration(1)).toBe(380);
    expect(stepDuration(100)).toBe(150);
    expect(stepDuration(20)).toBeLessThan(stepDuration(5));
  });

  it('počítadlo bez animací rovnou ukáže cílové číslo', async () => {
    const el = document.createElement('span');
    await tickNumber(app.anim, el, 0, 1234, 600);
    expect(el.textContent).toBe('1 234');
  });
});
