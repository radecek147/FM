// @vitest-environment happy-dom
/**
 * Ruka, náhled balíčku, hlášky a spotřebky ve Večerce (fáze 5, UI):
 *  - přesun tažením (`attachDragSort`): čisté výpočty cílového místa, krátký klik zůstává klikem, tah přesune a klik
 *    po něm se pohltí, zrušení (pointercancel) nic nemění,
 *  - Shift + ← / → v kole i v ruce obálky (`pickMoveTarget`, akce `reorderHand`), nápověda kláves,
 *  - náhled balíčku neprozradí karty lícem dolů (`deckPreviewModel`, dialog),
 *  - hlášky: nejvýš 3, opakovaná jen „×2“, kotva nad stolem, doba podle rychlosti hry, bez animací hned pryč,
 *  - Večerka: „Koupit a použít“ u spotřebky s cíli je neaktivní a vysvětlí proč; detail spotřebky bez ruky.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { RunState } from '../../src/engine';
import { Game, serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { attachDragSort, dropIndex, moveItem, shiftFor } from '../../src/ui/components/dragSort';
import { closeAllModals } from '../../src/ui/components/modal';
import {
  MAX_VISIBLE,
  clearToasts,
  setToastAnchor,
  toast,
  toastDuration,
  toastRegion,
} from '../../src/ui/components/toast';
import { GameController } from '../../src/ui/controller';
import { h } from '../../src/ui/dom';
import { gameScreen } from '../../src/ui/screens/game';
import { pickMoveTarget } from '../../src/ui/screens/game/handArea';
import { deckPreviewModel } from '../../src/ui/screens/game/modals';
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
  app.register('menu', () => ({ el: document.createElement('main') }));
  app.register('newGame', () => ({ el: document.createElement('main') }));
});

beforeEach(() => {
  store.remove(STORAGE_KEYS.run);
});

afterEach(() => {
  closeAllModals();
  clearToasts();
  vi.useRealTimers();
});

const deps = () => ({ registry: REG, store });

function freshState(seed = 'UIHAND1'): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed }, REG).state) as RunState;
}

function fromState(state: RunState): GameController {
  store.set(STORAGE_KEYS.run, serializeRun(state, '2026-10-02T00:00:00.000Z'));
  const c = GameController.resume(deps());
  if (!c) throw new Error('resume failed');
  return c;
}

function open(c: GameController): void {
  app.controller = c;
  app.go('game');
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
}

function press(key: string, init: KeyboardEventInit = {}): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

function domHand(): number[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="hand"] .pcard')].map((el) =>
    Number(el.dataset.cardId),
  );
}

async function inRound(seed = 'UIHAND1'): Promise<GameController> {
  const c = GameController.newRun({ deckId: 'pub', stake: 1, seed }, deps());
  open(c);
  await c.act({ type: 'selectBlind' });
  await settle(c);
  return c;
}

// ─────────────────────────── Tažení: čisté výpočty ───────────────────────────

describe('attachDragSort – výpočty', () => {
  const centers = [50, 150, 250, 350];

  it('dropIndex: počet ostatních středů vlevo od taženého středu', () => {
    expect(dropIndex(centers, 0, 0)).toBe(0);
    expect(dropIndex(centers, 0, 120)).toBe(1);
    expect(dropIndex(centers, 0, 260)).toBe(2);
    expect(dropIndex(centers, 0, 999)).toBe(3);
    expect(dropIndex(centers, 3, -999)).toBe(0);
    expect(dropIndex(centers, 2, -120)).toBe(1);
  });

  it('shiftFor: položky mezi starým a novým místem uhnou o rozestup', () => {
    // 0 → 2: položky 1 a 2 doleva, 3 stojí.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    // 3 → 1: položky 1 a 2 doprava.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 100))).toEqual([0, 100, 100, 0]);
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 100))).toEqual([0, 0, 0]);
  });

  it('moveItem: přesune prvek, ostatní se posunou; mimo rozsah nic', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });
});

// ─────────────────────────── Tažení: události ───────────────────────────

describe('attachDragSort – myš a dotyk', () => {
  function row(n: number): { list: HTMLElement; items: HTMLElement[]; clicks: string[] } {
    const clicks: string[] = [];
    const items = Array.from({ length: n }, (_, i) =>
      h('button', { class: 'item', 'data-id': String(i), onClick: () => clicks.push(String(i)) }, String(i)),
    );
    items.forEach((el, i) => {
      el.getBoundingClientRect = () => new DOMRect(i * 100, 0, 90, 120);
    });
    const list = h('div', null, items);
    document.body.appendChild(list);
    return { list, items, clicks };
  }

  const ptr = (type: string, x: number, init: PointerEventInit = {}): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 60,
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      ...init,
    });

  it('krátký klik zůstane klikem, tah přesune a klik po něm se pohltí', () => {
    const { list, items, clicks } = row(4);
    const drops: string[][] = [];
    const sorter = attachDragSort(list, {
      item: (target) => target.closest<HTMLElement>('.item'),
      canStart: () => true,
      onDrop: (ordered) => drops.push(ordered.map((el) => el.dataset.id!)),
    });

    // Posun pod prahem (3 px) = klik.
    items[1]!.dispatchEvent(ptr('pointerdown', 145));
    items[1]!.dispatchEvent(ptr('pointermove', 148));
    expect(sorter.dragging).toBe(false);
    items[1]!.dispatchEvent(ptr('pointerup', 148));
    items[1]!.click();
    expect(clicks).toEqual(['1']);
    expect(drops).toEqual([]);

    // Tah první položky za třetí.
    items[0]!.dispatchEvent(ptr('pointerdown', 45));
    items[0]!.dispatchEvent(ptr('pointermove', 60));
    expect(sorter.dragging).toBe(true);
    expect(items[0]!.classList.contains('is-dragging')).toBe(true);
    expect(list.classList.contains('is-sorting')).toBe(true);
    items[0]!.dispatchEvent(ptr('pointermove', 260));
    expect(items[0]!.style.translate).toBe('215px 0');
    expect(items[1]!.style.translate).toBe('-100px 0');
    expect(items[2]!.style.translate).toBe('-100px 0');
    expect(items[3]!.style.translate).toBe('');
    items[0]!.dispatchEvent(ptr('pointerup', 260));
    items[0]!.click();
    expect(drops).toEqual([['1', '2', '0', '3']]);
    expect([...list.children].map((el) => (el as HTMLElement).dataset.id)).toEqual(['1', '2', '0', '3']);
    expect(clicks).toEqual(['1']); // klik po tahu se pohltil
    expect(sorter.dragging).toBe(false);
    expect(items.every((el) => el.style.translate === '')).toBe(true);
    expect(list.classList.contains('is-sorting')).toBe(false);
    sorter.dispose();
    list.remove();
  });

  it('neopatrný klik (posun pod 16 px a zpět na místě) projde jako klik, delší tah na místo ne', async () => {
    const { list, items, clicks } = row(3);
    const sorter = attachDragSort(list, {
      item: (target) => target.closest<HTMLElement>('.item'),
      canStart: () => true,
      onDrop: () => undefined,
    });
    items[1]!.dispatchEvent(ptr('pointerdown', 145));
    items[1]!.dispatchEvent(ptr('pointermove', 155));
    expect(sorter.dragging).toBe(true);
    items[1]!.dispatchEvent(ptr('pointerup', 152));
    items[1]!.click();
    expect(clicks).toEqual(['1']);
    await new Promise((r) => setTimeout(r, 0));
    items[1]!.dispatchEvent(ptr('pointerdown', 145));
    items[1]!.dispatchEvent(ptr('pointermove', 175));
    items[1]!.dispatchEvent(ptr('pointerup', 150));
    items[1]!.click();
    expect(clicks).toEqual(['1']);
    sorter.dispose();
    list.remove();
  });

  it('pointercancel tah zruší beze změny; canStart false = žádné tažení; prst má vyšší práh', async () => {
    const { list, items } = row(3);
    let allowed = true;
    const drops: string[][] = [];
    const sorter = attachDragSort(list, {
      item: (target) => target.closest<HTMLElement>('.item'),
      canStart: () => allowed,
      onDrop: (ordered) => drops.push(ordered.map((el) => el.dataset.id!)),
    });
    items[0]!.dispatchEvent(ptr('pointerdown', 45));
    items[0]!.dispatchEvent(ptr('pointermove', 250));
    items[0]!.dispatchEvent(ptr('pointercancel', 250));
    expect(drops).toEqual([]);
    expect([...list.children].map((el) => (el as HTMLElement).dataset.id)).toEqual(['0', '1', '2']);
    expect(items[0]!.style.translate).toBe('');

    allowed = false;
    items[0]!.dispatchEvent(ptr('pointerdown', 45));
    items[0]!.dispatchEvent(ptr('pointermove', 250));
    expect(sorter.dragging).toBe(false);
    items[0]!.dispatchEvent(ptr('pointerup', 250));
    expect(drops).toEqual([]);

    // Dotyk: 8 px je ještě tap (práh 10 px), 12 px už tah.
    allowed = true;
    await new Promise((r) => setTimeout(r, 0));
    const touch = { pointerType: 'touch' };
    items[1]!.dispatchEvent(ptr('pointerdown', 145, touch));
    items[1]!.dispatchEvent(ptr('pointermove', 153, touch));
    expect(sorter.dragging).toBe(false);
    items[1]!.dispatchEvent(ptr('pointermove', 157, touch));
    expect(sorter.dragging).toBe(true);
    items[1]!.dispatchEvent(ptr('pointerup', 157, touch));
    expect(drops).toEqual([]); // stejné místo → bez akce
    sorter.dispose();
    list.remove();
  });
});

// ─────────────────────────── Shift + šipka ───────────────────────────

describe('přesun karet v ruce klávesnicí', () => {
  it('pickMoveTarget: zaměřená vybraná > naposledy vybraná > zaměřená; mimo ruku nic', () => {
    expect(pickMoveTarget([1, 2, 3], [1, 3], 3)).toBe(3);
    expect(pickMoveTarget([1, 2, 3], [1, 3], 2)).toBe(3);
    expect(pickMoveTarget([1, 2, 3], [], 2)).toBe(2);
    expect(pickMoveTarget([1, 2, 3], [], null)).toBeNull();
    expect(pickMoveTarget([1, 2, 3], [9], 8)).toBeNull();
    expect(pickMoveTarget([1, 2, 3], [2, 9], null)).toBe(2);
  });

  it('v kole: Shift + → / ← posune vybranou kartu (engine i DOM), na kraji jen hláška', async () => {
    const c = await inRound();
    const hand0 = [...c.state.round!.hand];
    press('1');
    expect(c.selected).toEqual([hand0[0]]);
    press('ArrowRight', { shiftKey: true });
    await settle(c);
    const hand1 = moveItem(hand0, 0, 1);
    expect(c.state.round!.hand).toEqual(hand1);
    expect(domHand()).toEqual(hand1);
    // Výběr zůstal, zkratka karty se přečíslovala.
    expect(c.selected).toEqual([hand0[0]]);
    const moved = root.querySelector<HTMLElement>(`[data-testid="hand"] [data-card-id="${hand0[0]}"]`)!;
    expect(moved.getAttribute('aria-keyshortcuts')).toBe('2');
    expect(root.querySelector('[data-testid="hand-live"]')?.textContent).toContain(
      t('game.hand.moved', { name: '', n: 2, max: hand0.length }).slice(2),
    );
    press('ArrowLeft', { shiftKey: true });
    await settle(c);
    expect(c.state.round!.hand).toEqual(hand0);
    press('ArrowLeft', { shiftKey: true });
    await settle(c);
    expect(c.state.round!.hand).toEqual(hand0);
    expect(root.querySelector('[data-testid="hand-live"]')?.textContent).toBe(t('game.hand.moveEdge'));
    // Šipka bez Shiftu ani bez výběru nic nedělá.
    c.clearSelection();
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight');
    await settle(c);
    expect(c.state.round!.hand).toEqual(hand0);
  });

  it('zaměřená karta (Tab) se posune a focus na ní zůstane', async () => {
    const c = await inRound('UIHAND2');
    const hand0 = [...c.state.round!.hand];
    const card = root.querySelector<HTMLElement>(`[data-testid="hand"] [data-card-id="${hand0[2]}"]`)!;
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }),
    );
    await settle(c);
    expect(c.state.round!.hand).toEqual(moveItem(hand0, 2, 1));
    expect(document.activeElement).toBe(card);
  });

  it('ruka obálky babských rad jde přeskládat stejně', async () => {
    const s = freshState('UIHAND3');
    s.phase = 'shop';
    s.money = 20;
    s.shop = {
      items: [],
      boosters: [{ boosterId: 'rada_normal', price: 4, sold: false }],
      vouchers: [],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    const g = Game.fromState(s, REG);
    expect(g.dispatch({ type: 'buyBooster', slot: 0 }).ok).toBe(true);
    const c = fromState(structuredClone(g.state) as RunState);
    open(c);
    const hand0 = [...c.state.booster!.hand];
    expect(hand0.length).toBeGreaterThan(2);
    expect(domHand()).toEqual(hand0);
    press('3');
    press('ArrowLeft', { shiftKey: true });
    await settle(c);
    expect(c.state.booster!.hand).toEqual(moveItem(hand0, 2, 1));
    expect(domHand()).toEqual(moveItem(hand0, 2, 1));
  });
});

// ─────────────────────────── Náhled balíčku ───────────────────────────

describe('náhled balíčku a karty lícem dolů', () => {
  it('deckPreviewModel: zakryté karty mimo balíček → jen dobírací balíček a počet', () => {
    const g = Game.fromState(freshState(), REG);
    g.dispatch({ type: 'selectBlind' });
    const s = structuredClone(g.state) as RunState;
    const plain = deckPreviewModel(s);
    expect(plain.hidden).toBe(0);
    expect(plain.shown).toHaveLength(s.deck.length);
    expect(plain.remaining.size).toBe(s.round!.drawPile.length);

    const [a, b] = s.round!.hand;
    for (const id of [a, b]) s.deck.find((c) => c.id === id)!.faceDown = true;
    const hidden = deckPreviewModel(s);
    expect(hidden.hidden).toBe(2);
    expect(hidden.shown.map((c) => c.id).sort((x, y) => x - y)).toEqual(
      [...s.round!.drawPile].sort((x, y) => x - y),
    );
    // Mimo kolo (Večerka) se ukazuje celý balíček.
    const shop = structuredClone(s);
    shop.phase = 'shop';
    shop.round = null;
    for (const c of shop.deck) c.faceDown = false;
    expect(deckPreviewModel(shop)).toMatchObject({ hidden: 0 });
    expect(deckPreviewModel(shop).remaining.size).toBe(shop.deck.length);
  });

  it('dialog neukáže zakryté karty ani ztlumeně, jen jejich počet a ruby', async () => {
    const g = Game.fromState(freshState('UIHAND4'), REG);
    g.dispatch({ type: 'selectBlind' });
    const s = structuredClone(g.state) as RunState;
    const hiddenIds = s.round!.hand.slice(0, 3);
    for (const id of hiddenIds) s.deck.find((c) => c.id === id)!.faceDown = true;
    const c = fromState(s);
    open(c);
    root.querySelector<HTMLButtonElement>('[data-testid="deck"]')!.click();
    const modal = document.querySelector<HTMLElement>('[data-testid="deck-modal"]')!;
    expect(modal).not.toBeNull();
    for (const id of hiddenIds) expect(modal.querySelector(`[data-card-id="${id}"]`)).toBeNull();
    const row = modal.querySelector('[data-testid="deck-hidden"]')!;
    expect(row.getAttribute('aria-label')).toBe(t('game.deck.hiddenLabel', { n: 3 }));
    expect(row.querySelectorAll('.pcard')).toHaveLength(3);
    expect(modal.querySelectorAll('.deck-mini.is-out[data-card-id]')).toHaveLength(0);
    expect(modal.querySelector('[data-testid="deck-legend"]')?.textContent).toBe(t('game.deck.legendHidden'));
  });
});

// ─────────────────────────── Hlášky ───────────────────────────

describe('hlášky (toast)', () => {
  it('nejvýš 3 naráz, nejstarší ustoupí; stejná hláška jen přičte „×n“', () => {
    document.documentElement.classList.add('no-anim');
    try {
      for (const n of [1, 2, 3, 4, 5]) toast(`Hláška ${n}`);
      const region = toastRegion();
      const visible = () => [...region.querySelectorAll('.toast:not(.toast--leaving)')];
      expect(visible()).toHaveLength(MAX_VISIBLE);
      expect(visible().map((el) => el.querySelector('.toast__text')?.textContent)).toEqual([
        'Hláška 3',
        'Hláška 4',
        'Hláška 5',
      ]);
      const again = toast('Hláška 4');
      expect(visible()).toHaveLength(3);
      expect(again.el.querySelector('[data-testid="toast-count"]')?.textContent).toBe(
        t('common.repeated', { n: 2 }),
      );
      // Jiný druh se stejným textem je jiná hláška.
      toast('Hláška 5', { kind: 'warning' });
      expect(visible().map((el) => el.querySelector('.toast__text')?.textContent)).toEqual([
        'Hláška 4',
        'Hláška 5',
        'Hláška 5',
      ]);
    } finally {
      document.documentElement.classList.remove('no-anim');
    }
  });

  it('doba zobrazení: kratší při vyšší rychlosti hry, ale ne pod minimum; čas běží od poslední hlášky', () => {
    expect(toastDuration('info', 1)).toBe(4000);
    expect(toastDuration('info', 4)).toBe(2200);
    expect(toastDuration('warning', 2)).toBe(Math.round(5000 / Math.SQRT2));
    expect(toastDuration('error', 4)).toBe(4000);
    expect(toastDuration('info', Number.NaN)).toBe(4000);

    vi.useFakeTimers();
    document.documentElement.classList.add('no-anim');
    document.documentElement.style.setProperty('--speed', '4');
    try {
      const a = toast('Rychle pryč');
      vi.advanceTimersByTime(1500);
      toast('Rychle pryč'); // obnoví čas
      vi.advanceTimersByTime(1500);
      expect(a.el.isConnected).toBe(true);
      vi.advanceTimersByTime(800);
      expect(a.el.isConnected).toBe(false); // bez animací hned pryč
    } finally {
      document.documentElement.classList.remove('no-anim');
      document.documentElement.style.removeProperty('--speed');
    }
  });

  it('kotva: sloupec nahoře uprostřed jeviště; bez kotvy (nebo bez rozměrů) vpravo dole', () => {
    const stage = h('section', null);
    document.body.appendChild(stage);
    stage.getBoundingClientRect = () => new DOMRect(300, 150, 1000, 400);
    setToastAnchor(stage);
    toast('Nad stolem');
    const region = toastRegion();
    expect(region.classList.contains('toast-region--anchored')).toBe(true);
    expect(region.style.left).toBe('800px');
    expect(region.style.top).toBe('158px');
    expect(region.style.width).toBe('384px');
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    toast('Bez rozměrů');
    expect(region.classList.contains('toast-region--anchored')).toBe(false);
    // Kotva jako funkce (herní obrazovka: pod záhlavím panelu).
    setToastAnchor(() => new DOMRect(100, 300, 600, 200));
    toast('Pod záhlavím');
    expect(region.style.left).toBe('400px');
    expect(region.style.top).toBe('308px');
    // Funkce dostane výšku sloupce (herní obrazovka podle ní volí volné místo pod panelem, nebo záhlaví).
    const seen: number[] = [];
    Object.defineProperty(region, 'offsetHeight', { configurable: true, get: () => 120 });
    setToastAnchor((needed) => {
      seen.push(needed);
      return needed <= 150 ? new DOMRect(100, 500, 600, 200) : new DOMRect(100, 300, 600, 400);
    });
    toast('Pod panelem');
    expect(seen).toContain(120);
    expect(region.style.top).toBe('508px');
    Reflect.deleteProperty(region, 'offsetHeight');
    setToastAnchor(null);
    expect(region.style.left).toBe('');
    stage.remove();
  });
});

// ─────────────────────────── Večerka a detail spotřebky ───────────────────────────

describe('spotřebky ve Večerce', () => {
  function shopWith(defIds: string[]): RunState {
    const s = freshState('UIHAND5');
    s.phase = 'shop';
    s.money = 20;
    s.shop = {
      items: defIds.map((defId, i) => ({
        kind: 'consumable' as const,
        consumable: { uid: 700 + i, defId, edition: null },
        consumableKind: REG.consumables[defId]!.kind,
        price: 3,
        sold: false,
      })),
      boosters: [],
      vouchers: [],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    return s;
  }

  it('„Koupit a použít“: s cíli neaktivní (aria-disabled) a klik vysvětlí; bez cílů funguje', async () => {
    const c = fromState(shopWith(['chili', 'medard_drop']));
    open(c);
    const rada = root.querySelector<HTMLButtonElement>('[data-testid="shop-use-0"]')!;
    expect(rada.getAttribute('aria-disabled')).toBe('true');
    expect(rada.disabled).toBe(false); // fokusovatelné
    expect(rada.title).toBe(t('game.shop.useNeedsHand'));
    expect(document.getElementById(`shop-item-0-use-why`)?.textContent).toBe(t('game.shop.useNeedsHand'));
    rada.click();
    await settle(c);
    expect(document.querySelector('[data-testid="toast-shop-use"]')?.textContent).toContain(
      t('game.shop.useNeedsHand'),
    );
    expect(c.state.shop!.items[0]!.sold).toBe(false);
    expect(c.state.money).toBe(20);

    const pranostika = root.querySelector<HTMLButtonElement>('[data-testid="shop-use-1"]')!;
    expect(pranostika.getAttribute('aria-disabled')).toBeNull();
    expect(pranostika.disabled).toBe(false);
    const level = c.state.handLevels.flush?.level ?? 1;
    pranostika.click();
    await settle(c);
    expect(c.state.handLevels.flush?.level).toBe(level + 1);
  });

  it('detail spotřebky s cíli ve Večerce: Použít neaktivní s vysvětlením, že chybí ruka', async () => {
    const s = shopWith([]);
    s.consumables = [{ uid: 800, defId: 'chili', edition: null }];
    const c = fromState(s);
    open(c);
    root.querySelector<HTMLElement>('[data-consumable-uid="800"]')!.click();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="consumable-use"]')?.disabled).toBe(true);
    expect(document.querySelector('[data-testid="consumable-warning"]')?.textContent).toBe(
      t('game.consumable.needsHand'),
    );
  });
});

describe('nápověda kláves', () => {
  it('nastavení vypisuje i Shift + šipky', () => {
    expect(t('settings.keys.items.move.key')).toContain('Shift');
    expect(t('settings.keys.items.move.action')).not.toContain('⟦');
  });
});
