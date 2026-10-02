/**
 * Aplikace: router obrazovek a sdílené služby (úložiště, profil hráče s nastavením, registr obsahu, rozehraný
 * run).
 *
 * Obrazovka = funkce `(app, params) => Screen`. Router ji vloží do #app, předá jí klávesy
 * a při odchodu zavolá `dispose()`. Přechod mezi obrazovkami je krátké prolnutí / příjezd (src/ui/fx/transitions.ts);
 * router zůstává synchronní (nová obrazovka je v DOM a má focus hned).
 */
import type { ContentRegistry } from '../engine';
import type { Profile } from '../engine/meta';
import { AnimQueue } from './anim/queue';
import { installDigitFont } from './art/digitFont';
import { isModalOpen } from './components/modal';
import type { GameController } from './controller';
import { mount } from './dom';
import { prefersReducedMotion } from './fx/motion';
import { playScreenTransition, screenTransition } from './fx/transitions';
import type { ProfileControllerOptions } from './profile';
import { ProfileController } from './profile';
import type { Settings } from './settings';
import { applySettingsToDocument } from './settings';
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
  /** Profil hráče (nastavení, odemčení, sbírka, statistiky, historie) — src/ui/profile.ts. */
  readonly profiles: ProfileController;
  /** Rozehraný run (pokud existuje). */
  controller: GameController | null = null;
  /** Tutoriál Štamgast (src/ui/tutorial.ts) — null, když není nainstalovaný (testy, `?tutorial=off`). */
  tutorial: { refresh(): void } | null = null;
  private current: { id: ScreenId; screen: Screen } | null = null;
  /** Běžící přechod obrazovky (zruší se při dalším přechodu). */
  private transition: Animation | null = null;
  private screens = new Map<ScreenId, ScreenFactory>();
  private screenListeners = new Set<(id: ScreenId) => void>();
  private settingsListeners = new Set<(s: Settings) => void>();

  constructor(
    readonly root: HTMLElement,
    readonly store: KeyValueStore,
    readonly registry: ContentRegistry,
    profileOptions: ProfileControllerOptions = {},
  ) {
    // Profil se načte (a případně zazálohuje / zmigruje) jako první — nastavení je jeho součást.
    this.profiles = new ProfileController(store, registry, profileOptions);
    this.anim = new AnimQueue(() => ({
      speed: this.settings.speed,
      enabled: this.settings.animations,
      reducedMotion: prefersReducedMotion(),
    }));
    applySettingsToDocument(this.settings);
    // Číslice s čitelnou „5“ a „2“ (písmo se skládá za běhu, bez sítě).
    installDigitFont();
    // Mezerník během animace přeskočí — už ve fázi zachytávání, aby ho nespolkl zaměřený prvek
    // (karta, žolík), který mezerník jinak zastaví u sebe.
    document.addEventListener('keydown', (e) => this.handleSkipKey(e), true);
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
    const from = this.current?.id ?? null;
    this.current?.screen.dispose?.();
    this.transition?.cancel();
    this.transition = null;
    const screen = factory(this, params);
    this.current = { id, screen };
    mount(this.root, screen.el);
    this.root.dataset.screen = id;
    // Přechod (jen opacity/transform, src/ui/fx/transitions.ts) — obrazovka je v DOM a má focus hned.
    this.transition = playScreenTransition(screen.el, screenTransition(id, from, this.settings));
    // Přístupnost: focus na první nadpis nebo tlačítko nové obrazovky.
    const focusable = screen.el.querySelector<HTMLElement>('[autofocus], h1, h2, button:not([disabled])');
    focusable?.focus({ preventScroll: true });
    for (const fn of [...this.screenListeners]) {
      try {
        fn(id);
      } catch (e) {
        console.error('[app] Posluchač změny obrazovky selhal', e);
      }
    }
  }

  /** Zavolá `fn` po každém přechodu na obrazovku (tutoriál). Vrací odhlášení. */
  onScreenChange(fn: (id: ScreenId) => void): () => void {
    this.screenListeners.add(fn);
    return () => this.screenListeners.delete(fn);
  }

  /** Nastavení hráče (součást profilu, DESIGN 13.4). Měň ho jen přes `updateSettings`. */
  get settings(): Settings {
    return this.profiles.settings;
  }

  /** Profil hráče (jediná instance; meta funkce ji mutují, ukládá `profiles.save()`). */
  get profile(): Profile {
    return this.profiles.profile;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.profiles.updateSettings(patch);
    applySettingsToDocument(this.settings);
    for (const fn of [...this.settingsListeners]) {
      try {
        fn(this.settings);
      } catch (e) {
        console.error('[app] Posluchač změny nastavení selhal', e);
      }
    }
  }

  /** Zavolá `fn` po každé změně nastavení (zvuk — hlasitosti živě). Vrací odhlášení. */
  onSettingsChange(fn: (s: Settings) => void): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  private handleSkipKey(e: KeyboardEvent): void {
    if (e.key !== ' ' || !this.anim.busy || isModalOpen()) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      return;
    e.preventDefault();
    e.stopPropagation();
    this.anim.skip();
  }

  private handleKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      return;
    if (this.current?.screen.onKey?.(e)) e.preventDefault();
  }
}
