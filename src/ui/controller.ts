/**
 * GameController — most mezi UI a enginem.
 *  - drží instanci `Game` a stav UI, který do enginu nepatří (výběr karet),
 *  - akce posílá do `game.dispatch`, po úspěchu autosave a přehrání událostí přes `present`,
 *  - během animací blokuje další akce (kromě přeskočení),
 *  - obrazovky se přihlásí přes `subscribe` a po každé změně se překreslí.
 * UI nikdy nemění stav enginu přímo.
 */
import type { Action, ActionResult, ContentRegistry, GameEvent, HandPreview, RunState } from '../engine';
import { Game, deserializeRun, serializeRun } from '../engine';
import type { KeyValueStore } from './storage';
import { STORAGE_KEYS } from './storage';

export type Presenter = (events: readonly GameEvent[], controller: GameController) => Promise<void>;

export interface ControllerDeps {
  registry: ContentRegistry;
  store: KeyValueStore;
  /** Přehraje události (animace, zvuky). Výchozí: nic. */
  present?: Presenter;
}

type Listener = () => void;

export class GameController {
  /** Vybrané karty v ruce (id v pořadí výběru). */
  selected: number[] = [];
  private listeners = new Set<Listener>();
  private animating = false;
  private presenter: Presenter;

  private constructor(
    private game: Game,
    private readonly deps: ControllerDeps,
  ) {
    this.presenter = deps.present ?? (async () => undefined);
  }

  static newRun(
    opts: { deckId: string; stake: number; seed: string; challengeId?: string | null; daily?: boolean },
    deps: ControllerDeps,
  ): GameController {
    const game = Game.newRun(opts, deps.registry);
    const c = new GameController(game, deps);
    c.save();
    return c;
  }

  /** Obnoví rozehraný run z úložiště, nebo vrátí null. */
  static resume(deps: ControllerDeps): GameController | null {
    const raw = deps.store.get(STORAGE_KEYS.run);
    if (!raw) return null;
    try {
      const state = deserializeRun(raw);
      if (state.phase === 'game_over') return null;
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
    const hand = this.handIds();
    this.selected = this.selected.filter((id) => hand.includes(id));
    this.animating = true;
    try {
      await this.presenter(res.events, this);
    } finally {
      this.animating = false;
    }
    this.notify();
    return res;
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
}
