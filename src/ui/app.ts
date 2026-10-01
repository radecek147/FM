/**
 * Aplikace: router obrazovek a sdílené služby (úložiště, nastavení, registr obsahu, rozehraný run).
 *
 * Obrazovka = funkce `(app, params) => Screen`. Router ji vloží do #app, předá jí klávesy
 * a při odchodu zavolá `dispose()`.
 */
import type { ContentRegistry } from '../engine';
import { AnimQueue } from './anim/queue';
import type { GameController } from './controller';
import { mount } from './dom';
import type { Settings } from './settings';
import { applySettingsToDocument, loadSettings, saveSettings } from './settings';
import type { KeyValueStore } from './storage';

export type ScreenId =
  'menu' | 'newGame' | 'game' | 'settings' | 'credits' | 'collection' | 'stats' | 'challenges' | 'daily';

export interface Screen {
  el: HTMLElement;
  /** Klávesa stisknutá, když je obrazovka aktivní. Vrať true, pokud ji obrazovka zpracovala. */
  onKey?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

export type ScreenFactory = (app: App, params?: Record<string, unknown>) => Screen;

export class App {
  readonly anim: AnimQueue;
  settings: Settings;
  /** Rozehraný run (pokud existuje). */
  controller: GameController | null = null;
  private current: { id: ScreenId; screen: Screen } | null = null;
  private screens = new Map<ScreenId, ScreenFactory>();

  constructor(
    readonly root: HTMLElement,
    readonly store: KeyValueStore,
    readonly registry: ContentRegistry,
  ) {
    this.settings = loadSettings(store);
    this.anim = new AnimQueue(() => ({ speed: this.settings.speed, enabled: this.settings.animations }));
    applySettingsToDocument(this.settings);
    document.addEventListener('keydown', (e) => this.handleKey(e));
  }

  register(id: ScreenId, factory: ScreenFactory): void {
    this.screens.set(id, factory);
  }

  get screenId(): ScreenId | null {
    return this.current?.id ?? null;
  }

  go(id: ScreenId, params?: Record<string, unknown>): void {
    const factory = this.screens.get(id);
    if (!factory) {
      console.warn(`[app] Neznámá obrazovka ${id}`);
      return;
    }
    this.current?.screen.dispose?.();
    const screen = factory(this, params);
    this.current = { id, screen };
    mount(this.root, screen.el);
    this.root.dataset.screen = id;
    // Přístupnost: focus na první nadpis nebo tlačítko nové obrazovky.
    const focusable = screen.el.querySelector<HTMLElement>('[autofocus], h1, h2, button:not([disabled])');
    focusable?.focus({ preventScroll: true });
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.store, this.settings);
    applySettingsToDocument(this.settings);
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === ' ' && this.anim.busy) {
      e.preventDefault();
      this.anim.skip();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      return;
    if (this.current?.screen.onKey?.(e)) e.preventDefault();
  }
}
