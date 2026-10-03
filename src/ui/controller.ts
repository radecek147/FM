/**
 * GameController — most mezi UI a enginem.
 *  - drží instanci `Game` a stav UI, který do enginu nepatří (výběr karet),
 *  - akce posílá do `game.dispatch`, po úspěchu autosave, ohlášení událostí pozorovateli (profil — meta vrstva)
 *    a přehrání událostí přes `present`,
 *  - během animací blokuje další akce (kromě přeskočení),
 *  - obrazovky se přihlásí přes `subscribe` a po každé změně se překreslí.
 * UI nikdy nemění stav enginu přímo.
 */
import type {
  Action,
  ActionResult,
  ContentRegistry,
  GameEvent,
  HandPreview,
  NewRunOptions,
  RunState,
} from '../engine';
import { Game, deserializeRun, serializeRun, validateRunState } from '../engine';
import type { KeyValueStore } from './storage';
import { RUN_BACKUP_PREFIX, STORAGE_KEYS, writeBackup } from './storage';

export type Presenter = (events: readonly GameEvent[], controller: GameController) => Promise<void>;

/**
 * Pozorovatel runu (profil hráče, src/ui/profile.ts): dostane události každé úspěšné akce hned po uložení runu
 * (stav enginu je už po celé akci) a znovu se ozve, až doběhnou animace (oznámení „Odemčeno: …“ nepřeskočí
 * skórování). Chyba pozorovatele hru nezastaví.
 */
export interface RunObserver {
  onEvents(events: readonly GameEvent[], controller: GameController): void;
  onSettled?(controller: GameController): void;
}

export interface ControllerDeps {
  registry: ContentRegistry;
  store: KeyValueStore;
  /** Přehraje události (animace, zvuky). Výchozí: nic. */
  present?: Presenter;
  /** Pozorovatel událostí (profil). Jde nastavit i později (`setObserver`). */
  observer?: RunObserver;
}

/** Volby nového runu pro controller: jako `NewRunOptions`, seed je povinný (generuje ho UI). */
export type ControllerRunOptions = Omit<NewRunOptions, 'seed'> & { seed: string };

type Listener = () => void;

export class GameController {
  /** Vybrané karty v ruce (id v pořadí výběru). */
  selected: number[] = [];
  private listeners = new Set<Listener>();
  private animating = false;
  /** Pořadí přehrávání událostí; `cancelPresentation` ho posune, takže dobíhající přehrávání už nic neovlivní. */
  private presentSeq = 0;
  private presenter: Presenter;
  private observer: RunObserver | null;
  private eventListeners = new Set<(events: readonly GameEvent[]) => void>();

  private constructor(
    private game: Game,
    private readonly deps: ControllerDeps,
  ) {
    this.presenter = deps.present ?? (async () => undefined);
    this.observer = deps.observer ?? null;
  }

  static newRun(opts: ControllerRunOptions, deps: ControllerDeps): GameController {
    const game = Game.newRun(opts, deps.registry);
    const c = new GameController(game, deps);
    c.save();
    return c;
  }

  /**
   * Obnoví rozehraný run z úložiště, nebo vrátí null. Kromě obálky a verze (`deserializeRun`) ověří i vnitřní
   * konzistenci (`validateRunState`: karty v ruce a hromádkách, `round`, data fáze…) — poškozený run by jinak spadl
   * až při Zahrát. Neznámý obsah (žolík odebraný v nové verzi) načtení nebrání, engine ho snese. Uložená data
   * nemaže: zálohu a úklid nečitelného runu dělá volající (`backupSavedRun`).
   */
  static resume(deps: ControllerDeps): GameController | null {
    const raw = deps.store.get(STORAGE_KEYS.run);
    if (!raw) return null;
    try {
      const state = deserializeRun(raw);
      if (state.phase === 'game_over') return null;
      const broken = validateRunState(state).filter((i) => i.kind === 'corrupt');
      if (broken.length > 0) {
        console.warn('[save] Rozehraný run je poškozený', broken.map((i) => i.path).join(', '));
        return null;
      }
      return new GameController(Game.fromState(state, deps.registry), deps);
    } catch (e) {
      console.warn('[save] Nepodařilo se načíst rozehraný run', e);
      return null;
    }
  }

  static hasSavedRun(store: KeyValueStore): boolean {
    return store.get(STORAGE_KEYS.run) !== null;
  }

  setPresenter(p: Presenter): void {
    this.presenter = p;
  }

  /** Nastaví pozorovatele událostí (null = žádný). */
  setObserver(o: RunObserver | null): void {
    this.observer = o;
  }

  get hasObserver(): boolean {
    return this.observer !== null;
  }

  get state(): Readonly<RunState> {
    return this.game.state;
  }

  get registry(): ContentRegistry {
    return this.deps.registry;
  }

  /** Přímý přístup k Game (jen ke čtení: preview, targetCurve, sellValue…). */
  get engine(): Game {
    return this.game;
  }

  get busy(): boolean {
    return this.animating;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Události každé úspěšné akce (po uložení a po profilu, před animacemi) — např. tutoriál pozná zahranou ruku.
   * Chyba posluchače hru nezastaví. Vrací odhlášení.
   */
  onEvents(fn: (events: readonly GameEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  notify(): void {
    for (const l of [...this.listeners]) l();
  }

  preview(): HandPreview {
    return this.game.preview(this.selected);
  }

  toggleSelect(cardId: number): void {
    if (this.animating) return;
    const hand = this.handIds();
    if (!hand.includes(cardId)) return;
    if (this.selected.includes(cardId)) {
      this.selected = this.selected.filter((id) => id !== cardId);
    } else if (this.selected.length < this.game.modifiers().maxSelect) {
      this.selected = [...this.selected, cardId];
    }
    this.notify();
  }

  clearSelection(): void {
    this.selected = [];
    this.notify();
  }

  /** Karty, ze kterých se teď vybírá (ruka v kole, nebo dobraná ruka obálky). */
  handIds(): readonly number[] {
    const s = this.game.state;
    if (s.phase === 'booster' && s.booster) return s.booster.hand;
    return s.round?.hand ?? [];
  }

  /** Vybrané karty seřazené podle pořadí v ruce (tak se i hrají — zleva doprava). */
  selectedInHandOrder(): number[] {
    const hand = this.handIds();
    return hand.filter((id) => this.selected.includes(id));
  }

  async act(action: Action): Promise<ActionResult> {
    if (this.animating) return { ok: false, error: 'wrongPhase' };
    const res = this.game.dispatch(action);
    if (!res.ok) {
      this.notify();
      return res;
    }
    this.save();
    this.observe(() => this.observer?.onEvents(res.events, this));
    for (const fn of [...this.eventListeners]) this.observe(() => fn(res.events));
    const hand = this.handIds();
    this.selected = this.selected.filter((id) => hand.includes(id));
    const seq = ++this.presentSeq;
    this.animating = true;
    try {
      await this.presenter(res.events, this);
    } finally {
      // Zrušené přehrávání (hráč mezitím odešel z herní obrazovky) už vstup neblokuje ani neodblokuje.
      if (seq === this.presentSeq) this.animating = false;
    }
    if (seq !== this.presentSeq) return res;
    this.settle();
    return res;
  }

  /** Konec přehrávání: překreslení a odložená oznámení pozorovatele (odemčení až po animacích). */
  private settle(): void {
    this.notify();
    this.observe(() => this.observer?.onSettled?.(this));
  }

  /**
   * Zruší běžící přehrávání událostí (herní obrazovka se zavírá — odchod do menu během skórování): vstup se hned
   * odblokuje, odložená oznámení se ukážou a dobíhající presenter už stav controlleru nezmění. Stav enginu je po
   * akci hotový od začátku (animace jen dohánějí obrazovku), takže po návratu do hry se hraje hned dál.
   */
  cancelPresentation(): void {
    if (!this.animating) return;
    this.presentSeq++;
    this.animating = false;
    this.settle();
  }

  /** Zavolá pozorovatele; jeho chyba (meta vrstva) nesmí shodit rozehranou hru. */
  private observe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.error('[profile] Zpracování události runu selhalo', e);
    }
  }

  /**
   * Zahraje vybrané karty. Výběr se nemaže předem: po úspěchu z něj `act` vyřadí karty, které už nejsou
   * v ruce (tj. všechny zahrané), a neplatná akce (např. došla zahození) výběr hráči nechá.
   */
  play(): Promise<ActionResult> {
    return this.act({ type: 'play', cardIds: this.selectedInHandOrder() });
  }

  discard(): Promise<ActionResult> {
    return this.act({ type: 'discard', cardIds: this.selectedInHandOrder() });
  }

  save(): void {
    const s = this.game.state;
    if (s.phase === 'game_over') {
      this.deps.store.remove(STORAGE_KEYS.run);
      return;
    }
    this.deps.store.set(STORAGE_KEYS.run, serializeRun(s as RunState, new Date().toISOString()));
  }

  /** Smaže uložený run (např. po prohře nebo při startu nového). */
  static clearSaved(store: KeyValueStore): void {
    store.remove(STORAGE_KEYS.run);
  }

  /**
   * Uložený run, který nejde načíst (poškozený, z novější verze…), zazálohuje do `karban.run.backup.<ms>` a teprve
   * pak ho smaže — data se neztratí a jdou do exportu. Když zálohu nejde zapsat (plné úložiště), run nechá na místě.
   * Vrací klíč zálohy, nebo null (nebylo co zálohovat / záloha selhala).
   */
  static backupSavedRun(store: KeyValueStore, now: Date = new Date()): string | null {
    const raw = store.get(STORAGE_KEYS.run);
    if (raw === null) return null;
    const key = writeBackup(store, RUN_BACKUP_PREFIX, raw, now);
    if (key) store.remove(STORAGE_KEYS.run);
    return key;
  }
}
