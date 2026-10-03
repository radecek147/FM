// @vitest-environment happy-dom
/**
 * Opravy logiky po testu 1.0 (1.0.1) — UI:
 *  - Večerka: „Koupit a použít“ podle enginu, každá položka zvlášť (Výjimka z vyhlášky, Zaklepat na dřevo),
 *  - obálka: „Použít“ neaktivní s vysvětlením, když spotřebku použít nejde (`canUse`); Minimalista: rozsah cílů 2–3,
 *  - Nová hra: dnešní a budoucí denní seed nejde zadat; profil takový run ani nezaloží,
 *  - odchod z herní obrazovky během animace: přehrávání se zruší a po návratu hra hned reaguje,
 *  - poškozený autosave se nenačte a před smazáním se zazálohuje (`karban.run.backup.<ms>`), export ho obsahuje,
 *    reset ho nechá; import hlubší validací odmítne poškozený run i neznámý obsah,
 *  - dvě karty prohlížeče: `TabGuard` (vlastník hry, zahozené zápisy neaktivní karty), modal „Hra je otevřená
 *    v jiné kartě“ a „Hrát tady“ (převzetí a nové načtení profilu i runu z úložiště).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { registry } from '../../src/content';
import type { JokerInstance, RunState, ShopItem } from '../../src/engine';
import { Game, createProfile, serializeProfile, serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import { clearToasts } from '../../src/ui/components/toast';
import { GameController } from '../../src/ui/controller';
import { ProfileController } from '../../src/ui/profile';
import { gameScreen } from '../../src/ui/screens/game';
import { menuScreen } from '../../src/ui/screens/menu';
import { newGameScreen } from '../../src/ui/screens/newGame';
import { ImportError, buildExport, parseImport, resetProfile } from '../../src/ui/screens/settings';
import { RUN_BACKUP_PREFIX, STORAGE_KEYS, memoryStore, type KeyValueStore } from '../../src/ui/storage';
import { TAB_OWNER_KEY, TabGuard } from '../../src/ui/tabGuard';
import { installTabLock } from '../../src/ui/tabLock';

const REG = registry();
const NOW = new Date('2026-10-03T10:00:00.000Z');
const NOW_ISO = NOW.toISOString();

let app: App;
let store: KeyValueStore;
let root: HTMLElement;

function makeApp(s: KeyValueStore): App {
  const a = new App(root, s, REG, { now: () => NOW, notify: () => undefined, onProblem: () => undefined });
  a.register('game', gameScreen);
  a.register('menu', menuScreen);
  a.register('newGame', newGameScreen);
  return a;
}

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div><canvas id="fx"></canvas>';
  root = document.querySelector<HTMLElement>('#app')!;
});

beforeEach(() => {
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = makeApp(store);
});

afterEach(() => {
  closeAllModals();
  clearToasts();
  vi.useRealTimers();
});

const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Chybí ${sel}`);
  return el;
};

function saveRun(state: RunState): void {
  store.set(STORAGE_KEYS.run, serializeRun(state, NOW_ISO));
}

function open(state: RunState): GameController {
  saveRun(state);
  const c = GameController.resume({ registry: REG, store });
  if (!c) throw new Error('resume failed');
  app.controller = c;
  app.go('game');
  return c;
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
}

const commons = Object.keys(REG.jokers)
  .filter((id) => REG.jokers[id]!.rarity === 'common')
  .sort();

function jokerInst(uid: number, defId: string): JokerInstance {
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

function freshState(seed: string, challengeId: string | null = null): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed, challengeId }, REG).state) as RunState;
}

function shopState(
  items: ShopItem[],
  jokers: JokerInstance[],
  consumables: RunState['consumables'],
): RunState {
  const s = freshState('UIFIXSHP');
  s.phase = 'shop';
  s.money = 50;
  s.jokers = jokers;
  s.consumables = consumables;
  s.shop = {
    items,
    boosters: [],
    vouchers: [],
    rerollCost: 5,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  return s;
}

function consumableItem(uid: number, defId: string, price = 4): ShopItem {
  return {
    kind: 'consumable',
    consumable: { uid, defId, edition: null },
    consumableKind: REG.consumables[defId]!.kind,
    price,
    sold: false,
  };
}

// ─────────────────────────── Večerka a obálka ───────────────────────────

describe('Večerka — „Koupit a použít“ podle enginu, po položkách', () => {
  it('Výjimka z vyhlášky se 4/5 žolíky a žolíkem ve Večerce je aktivní a nákup projde', async () => {
    const c = open(
      shopState(
        [
          { kind: 'joker', joker: jokerInst(901, commons[5]!), price: 5, sold: false },
          consumableItem(902, 'exemption', 6),
        ],
        [0, 1, 2, 3].map((i) => jokerInst(800 + i, commons[i]!)),
        [
          { uid: 700, defId: 'tree_frog', edition: null },
          { uid: 701, defId: 'tree_frog', edition: null },
        ],
      ),
    );
    const use = q<HTMLButtonElement>('[data-testid="shop-use-1"]');
    expect(use.disabled).toBe(false);
    use.click();
    await settle(c);
    expect(c.state.jokers).toHaveLength(5);
    expect(c.state.shop!.items[1]!.sold).toBe(true);
  });

  it('Zaklepat na dřevo bez vlastních žolíků je neaktivní s vysvětlením (žolík ve Večerce se nepočítá)', () => {
    open(
      shopState(
        [
          { kind: 'joker', joker: jokerInst(911, commons[6]!), price: 5, sold: false },
          consumableItem(912, 'knock_on_wood'),
        ],
        [],
        [],
      ),
    );
    const use = q<HTMLButtonElement>('[data-testid="shop-use-1"]');
    expect(use.disabled).toBe(true);
    expect(use.title).toBe(t('game.shop.useNotNow'));
  });
});

/** Run v obálce babských rad s Babiččinou barvou jako první možností. */
function dyeBoosterState(challengeId: string | null = null): RunState {
  const game = Game.fromState(freshState('UIFIXDYE', challengeId), REG);
  game.startBooster('rada_normal', 'blind_select');
  const s = structuredClone(game.state) as RunState;
  s.booster!.options[0] = {
    kind: 'consumable',
    consumable: { uid: 990, defId: 'grandmas_dye', edition: null },
    consumableKind: 'rada',
  };
  return s;
}

describe('obálka — „Použít“ jako slot spotřebek', () => {
  it('Babiččina barva na dvě karty stejné barvy: neaktivní s vysvětlením; na různé barvy aktivní', () => {
    const s = dyeBoosterState();
    const c = open(s);
    const cards = s.booster!.hand.map((id) => s.deck.find((x) => x.id === id)!);
    const lead = cards[0]!;
    const same = cards.find((x) => x.id !== lead.id && x.suit === lead.suit)!;
    const diff = cards.find((x) => x.suit !== lead.suit)!;
    c.toggleSelect(lead.id);
    c.toggleSelect(same.id);
    let use = q<HTMLButtonElement>('[data-testid="booster-use-0"]');
    expect(use.disabled).toBe(true);
    expect(use.title).toBe(t('game.consumable.cannotUse'));
    c.toggleSelect(same.id);
    c.toggleSelect(diff.id);
    use = q<HTMLButtonElement>('[data-testid="booster-use-0"]');
    expect(use.disabled).toBe(false);
  });

  it('Minimalista: rozsah cílů podle limitu výběru (2–3), čtvrtou kartu vybrat nejde', () => {
    const s = dyeBoosterState('minimalist');
    const c = open(s);
    const use = q<HTMLButtonElement>('[data-testid="booster-use-0"]');
    expect(use.title).toBe(t('game.consumable.targetsRange', { min: 2, max: 3 }));
    for (const id of s.booster!.hand.slice(0, 4)) c.toggleSelect(id);
    expect(c.selected).toHaveLength(3);
  });
});

// ─────────────────────────── Denní run ───────────────────────────

describe('Nová hra — denní seed dneška a budoucnosti nejde zadat', () => {
  function typeSeed(v: string): HTMLElement {
    const input = q<HTMLInputElement>('[data-testid="seed-input"]');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return q('[data-testid="seed-status"]');
  }

  it('dnešek a budoucnost = chyba pod polem, start nic nezaloží; minulý den jde', async () => {
    app.go('newGame');
    let status = typeSeed('DEN-20261003');
    expect(status.dataset.state).toBe('error');
    expect(status.textContent).toBe(t('newGame.seed.errors.dailyToday'));
    q<HTMLButtonElement>('[data-testid="newgame-start"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.controller).toBeNull();
    status = typeSeed('DEN-20991231');
    expect(status.textContent).toBe(t('newGame.seed.errors.dailyFuture'));
    status = typeSeed('DEN-20261002');
    expect(status.dataset.state).toBe('daily');
  });

  it('pojistka v profilu: trénink dnešního denního runu nevznikne', () => {
    const pc = new ProfileController(memoryStore(), REG, { now: () => NOW, notify: () => undefined });
    const req = { deckId: 'pub', stake: 1, daily: true, seeded: true };
    expect(() => pc.newRun({ ...req, seed: 'DEN-20261003' })).toThrow();
    expect(() => pc.newRun({ ...req, seed: 'DEN-20261104' })).toThrow();
    expect(pc.newRun({ ...req, seed: 'DEN-20261002' }).state.seed).toBe('DEN-20261002');
  });
});

// ─────────────────────────── Návrat do hry během animace ───────────────────────────

describe('odchod z herní obrazovky během animace', () => {
  it('controller.cancelPresentation odblokuje vstup hned; dobíhající přehrávání už nic nezmění', async () => {
    let release: () => void = () => undefined;
    const c = GameController.newRun({ deckId: 'pub', stake: 1, seed: 'UIFIXANI' }, { registry: REG, store });
    const settled = vi.fn();
    c.setObserver({ onEvents: () => undefined, onSettled: settled });
    c.setPresenter(() => new Promise<void>((r) => (release = r)));
    const pending = c.act({ type: 'selectBlind' });
    expect(c.busy).toBe(true);
    expect((await c.act({ type: 'sortHand', by: 'rank' })).ok).toBe(false);
    c.cancelPresentation();
    expect(c.busy).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
    // Nová akce s novým (zase pomalým) přehráváním; staré doběhne a nesmí ji odblokovat.
    const first = release;
    const next = c.act({ type: 'sortHand', by: 'rank' });
    expect(c.busy).toBe(true);
    first();
    await pending;
    expect(c.busy).toBe(true);
    release();
    expect((await next).ok).toBe(true);
    expect(c.busy).toBe(false);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('Esc → menu během skórování → Pokračovat: hra hned reaguje', async () => {
    // Časování animací (AnimQueue) zapnuté, Web Animations vypnuté: happy-dom při zrušení přechodu obrazovky
    // zamítne `Animation.finished`, i když ho nikdo nečte (prohlížeč ne).
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    onTestFinished(() => {
      if (animate) Object.defineProperty(Element.prototype, 'animate', animate);
    });
    app.updateSettings({ animations: true, speed: 1 });
    const c = GameController.newRun({ deckId: 'pub', stake: 1, seed: 'UIFIXESC' }, { registry: REG, store });
    app.controller = c;
    app.go('game');
    await c.act({ type: 'selectBlind' });
    await settle(c);
    const hand = c.state.round!.hand;
    const playing = c.act({ type: 'play', cardIds: hand.slice(0, 5) });
    expect(c.busy).toBe(true);
    app.go('menu');
    expect(c.busy).toBe(false);
    app.go('game');
    expect(c.busy).toBe(false);
    expect(root.querySelector('.game')?.classList.contains('is-busy')).toBe(false);
    // Akce projde hned (dřív controller odmítal vstup, dokud mimo obrazovku nedoběhlo celé skórování).
    expect((await c.act({ type: 'sortHand', by: 'suit' })).ok).toBe(true);
    expect(c.state.handSort).toBe('suit');
    await playing;
  });
});

// ─────────────────────────── Poškozený autosave a import ───────────────────────────

function roundRun(seed = 'UIFIXRND'): RunState {
  const g = Game.fromState(freshState(seed), REG);
  g.dispatch({ type: 'selectBlind' });
  return structuredClone(g.state) as RunState;
}

describe('poškozený autosave', () => {
  it('karta v ruce mimo balíček: resume vrátí null, data v úložišti zůstanou', () => {
    const s = roundRun();
    s.round!.hand[0] = 9999;
    saveRun(s);
    const raw = store.get(STORAGE_KEYS.run);
    expect(GameController.resume({ registry: REG, store })).toBeNull();
    expect(store.get(STORAGE_KEYS.run)).toBe(raw);
  });

  it('neznámý žolík (obsah odebraný v nové verzi) načtení nebrání', () => {
    const s = roundRun();
    s.jokers = [jokerInst(990, 'vyrazeny_zolik')];
    saveRun(s);
    expect(GameController.resume({ registry: REG, store })).not.toBeNull();
  });

  it('Pokračovat s nečitelným runem: záloha karban.run.backup.<ms>, smazání, hláška; export ji obsahuje, reset ji nechá', () => {
    const s = roundRun();
    s.round = {} as never;
    saveRun(s);
    const raw = store.get(STORAGE_KEYS.run)!;
    app.go('menu');
    q<HTMLButtonElement>('[data-testid="menu-continue"]').click();
    const backups = store.keys().filter((k) => k.startsWith(RUN_BACKUP_PREFIX));
    expect(backups).toHaveLength(1);
    expect(store.get(backups[0]!)).toBe(raw);
    expect(store.get(STORAGE_KEYS.run)).toBeNull();
    expect(q('[data-testid="toast-continue-failed"]').textContent).toContain(t('menu.continue.backedUp'));
    expect(q<HTMLButtonElement>('[data-testid="menu-continue"]').disabled).toBe(true);
    expect(buildExport(store, app.settings, NOW).runBackups).toEqual({ [backups[0]!]: raw });
    resetProfile(app, NOW);
    expect(store.get(backups[0]!)).toBe(raw);
  });

  it('záloha selže (plné úložiště) → run se nesmaže', () => {
    const full: KeyValueStore = {
      ...store,
      set: (k, v) => (k.startsWith(RUN_BACKUP_PREFIX) ? false : store.set(k, v)),
    };
    saveRun({ ...roundRun(), round: null });
    expect(GameController.backupSavedRun(full, NOW)).toBeNull();
    expect(store.get(STORAGE_KEYS.run)).not.toBeNull();
  });
});

describe('import — hlubší validace runu', () => {
  const importCode = (data: unknown): string => {
    const text = JSON.stringify({ format: 'karban-save', kind: 'run', version: 1, savedAt: NOW_ISO, data });
    try {
      parseImport(text, REG, NOW);
      return 'ok';
    } catch (e) {
      return e instanceof ImportError ? e.code : String(e);
    }
  };

  it('poškozený run = corruptRun, neznámý obsah = unknownContent, platný projde', () => {
    const base = roundRun();
    expect(importCode(base)).toBe('ok');
    expect(importCode({ ...base, round: {} })).toBe('corruptRun');
    expect(
      importCode({ ...base, round: { ...base.round!, hand: [9999, ...base.round!.hand.slice(1)] } }),
    ).toBe('corruptRun');
    expect(importCode({ ...base, deck: [{}] })).toBe('corruptRun');
    expect(importCode({ ...base, phase: 'blind_select', round: null, blindIndex: 9 })).toBe('corruptRun');
    expect(importCode({ ...base, jokers: [jokerInst(999, 'nope')] })).toBe('unknownContent');
    expect(importCode({ ...base, consumables: [{ uid: 998, defId: 'nope', edition: null }] })).toBe(
      'unknownContent',
    );
    expect(t('settings.import.errors.corruptRun')).not.toContain('⟦');
  });
});

// ─────────────────────────── Dvě karty prohlížeče ───────────────────────────

describe('TabGuard — jedna aktivní karta', () => {
  it('převzetí jinou kartou: událost storage zablokuje, zápisy neaktivní karty se zahodí', () => {
    const shared = memoryStore();
    const a = new TabGuard(shared, { tabId: 'A' });
    const b = new TabGuard(shared, { tabId: 'B' });
    a.claim();
    expect(a.store.set(STORAGE_KEYS.run, 'A1')).toBe(true);
    b.claim();
    const changes: boolean[] = [];
    a.onChange((active) => changes.push(active));
    a.handleStorage(TAB_OWNER_KEY, 'B');
    expect(a.active).toBe(false);
    expect(changes).toEqual([false]);
    expect(b.store.set(STORAGE_KEYS.run, 'B1')).toBe(true);
    // Neaktivní karta nic nepřepíše ani nesmaže (zápis hlásí úspěch — data patří aktivní kartě).
    expect(a.store.set(STORAGE_KEYS.run, 'A2')).toBe(true);
    a.store.remove(STORAGE_KEYS.run);
    expect(shared.get(STORAGE_KEYS.run)).toBe('B1');
    // „Hrát tady“: A převezme hru zpět.
    a.claim();
    expect(a.active).toBe(true);
    expect(changes).toEqual([false, true]);
    expect(shared.get(TAB_OWNER_KEY)).toBe('A');
    b.handleStorage(TAB_OWNER_KEY, 'A');
    expect(b.active).toBe(false);
  });

  it('souběh: zápis dřív, než dorazí událost, ověří vlastníka a kartu zablokuje', () => {
    const shared = memoryStore();
    const a = new TabGuard(shared, { tabId: 'A' });
    const b = new TabGuard(shared, { tabId: 'B' });
    a.claim();
    b.claim();
    expect(a.store.set(STORAGE_KEYS.profile, 'stary')).toBe(true);
    expect(shared.get(STORAGE_KEYS.profile)).toBeNull();
    expect(a.active).toBe(false);
    // Klíče mimo hru (nic) a klíč vlastníka hlídání neomezuje; chybějící vlastník = karta hru převezme.
    shared.remove(TAB_OWNER_KEY);
    expect(b.store.set(STORAGE_KEYS.run, 'B1')).toBe(true);
    expect(shared.get(TAB_OWNER_KEY)).toBe('B');
  });

  it('zápis profilu či runu z jiné karty: cizí vlastník zablokuje, vlastní karta uloží svůj stav znovu', () => {
    const shared = memoryStore();
    const a = new TabGuard(shared, { tabId: 'A' });
    a.claim();
    const foreign = vi.fn();
    a.onForeignWrite(foreign);
    a.handleStorage(STORAGE_KEYS.run, 'cizi');
    expect(foreign).toHaveBeenCalledTimes(1);
    expect(a.active).toBe(true);
    a.handleStorage('karban.newGame', 'x');
    expect(foreign).toHaveBeenCalledTimes(1);
    shared.set(TAB_OWNER_KEY, 'B');
    a.handleStorage(STORAGE_KEYS.profile, 'cizi');
    expect(a.active).toBe(false);
  });
});

describe('modal „Hra je otevřená v jiné kartě“', () => {
  it('zablokuje kartu (Esc ho nezavře); „Hrát tady“ převezme hru a načte profil i run z úložiště', async () => {
    const shared = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
    const guard = new TabGuard(shared, { tabId: 'A' });
    guard.claim();
    store = guard.store;
    app = makeApp(guard.store);
    installTabLock(app, guard);
    const c = open(roundRun('UIFIXTAB'));
    expect(c.state.phase).toBe('round');

    // Jiná karta (B) hru převezme, odehraje kus a uloží profil i run.
    shared.set(TAB_OWNER_KEY, 'B');
    guard.handleStorage(TAB_OWNER_KEY, 'B');
    const modal = q('[data-testid="tab-lock"]');
    expect(modal.textContent).toContain(t('app.tabLock.title'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-testid="tab-lock"]')).not.toBeNull();
    const other = roundRun('UIFIXTBB');
    shared.set(STORAGE_KEYS.run, serializeRun(other, NOW_ISO));
    const profile = createProfile(NOW_ISO);
    profile.settings.speed = 3;
    profile.settings.animations = false;
    shared.set(STORAGE_KEYS.profile, serializeProfile(profile, NOW_ISO));
    // Zablokovaná karta nic nepřepíše.
    await c.act({ type: 'sortHand', by: 'rank' });
    expect(shared.get(STORAGE_KEYS.run)).toBe(serializeRun(other, NOW_ISO));

    q<HTMLButtonElement>('[data-testid="tab-lock-take"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('[data-testid="tab-lock"]')).toBeNull();
    expect(guard.active).toBe(true);
    expect(shared.get(TAB_OWNER_KEY)).toBe('A');
    expect(app.settings.speed).toBe(3);
    expect(app.screenId).toBe('game');
    expect(app.controller?.state.seed).toBe('UIFIXTBB');
  });
});
