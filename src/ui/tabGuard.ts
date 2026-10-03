/**
 * Jedna aktivní karta prohlížeče. Profil i rozehraný run leží v jednom `localStorage` a každá karta ho po každé akci
 * přepisuje — dvě otevřené karty by si tiše přepisovaly hru (ztracený run, vrácené nastavení, „save-scumming“,
 * dva oficiální pokusy denního runu).
 *
 * Řešení: vlastník hry. Každá karta má náhodné id; kdo hru převezme (start aplikace, „Hrát tady“), zapíše své id
 * do `karban.tab`. Ostatní karty se to dozví událostí `storage` (chodí jen do *jiných* karet) a zablokují se
 * modalem (`installTabLock`). Pojistka proti souběhu: chráněné úložiště (`TabGuard.store`) před každým zápisem
 * klíče hry ověří, že je vlastník pořád on — karta, které událost ještě nedorazila, nic nepřepíše a rovnou se
 * zablokuje. Zablokovaná karta nezapisuje vůbec (zápis tiše zahodí — data patří aktivní kartě) a převzetím se
 * profil i run načtou znovu z úložiště (`App.reloadFromStorage`), takže nic nevrátí zpět.
 *
 * Bez `localStorage` (soukromé okno) se nic neukládá a karty se nemají jak přepsat — hlídání pak nic nedělá.
 */
import type { KeyValueStore } from './storage';
import { STORAGE_KEYS } from './storage';

/** Klíč vlastníka hry (id karty, která smí zapisovat). */
export const TAB_OWNER_KEY = 'karban.tab';
/** Klíče hry, jejichž zápis hlídá vlastnictví (všechny `karban.*` kromě klíče vlastníka). */
const GAME_PREFIX = 'karban.';
/** Klíče, jejichž změna z jiné karty znamená, že hraje jinde. */
const WATCHED_KEYS: readonly string[] = [TAB_OWNER_KEY, STORAGE_KEYS.profile, STORAGE_KEYS.run];

/** Náhodné id karty (UI smí `crypto` / `Math.random`; engine ne). */
export function randomTabId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface TabGuardOptions {
  /** Id této karty (testy); výchozí náhodné. */
  tabId?: string;
}

export class TabGuard {
  readonly tabId: string;
  /** Úložiště hry: čtení beze změny, zápis klíčů hry jen pro vlastníka. */
  readonly store: KeyValueStore;
  private lostControl = false;
  private listeners = new Set<(active: boolean) => void>();
  private foreignListeners = new Set<() => void>();

  constructor(
    private readonly base: KeyValueStore,
    opts: TabGuardOptions = {},
  ) {
    this.tabId = opts.tabId ?? randomTabId();
    const guarded = (key: string): boolean => key.startsWith(GAME_PREFIX) && key !== TAB_OWNER_KEY;
    this.store = {
      get: (key) => base.get(key),
      keys: () => base.keys(),
      set: (key, value) => {
        // Zahozený zápis hlásí úspěch: data patří aktivní kartě a hráč tu vidí modal (žádná hláška „uložení selhalo“).
        if (guarded(key) && !this.verify()) return true;
        return base.set(key, value);
      },
      remove: (key) => {
        if (guarded(key) && !this.verify()) return;
        base.remove(key);
      },
    };
  }

  /** Smí tahle karta hrát (zapisovat)? */
  get active(): boolean {
    return !this.lostControl;
  }

  /** Převezme hru: zapíše se jako vlastník (ostatní karty se zablokují) a odblokuje se. */
  claim(): void {
    // Plné úložiště zápis odmítne: starý vlastník se smaže (to jde vždy), jinak by se karta zablokovala sama
    // o sobě. Bez vlastníka pak hlídání jen nebrání v hraní (zapisovat se stejně skoro nedá).
    if (!this.base.set(TAB_OWNER_KEY, this.tabId)) this.base.remove(TAB_OWNER_KEY);
    if (this.lostControl) {
      this.lostControl = false;
      this.emit();
    }
  }

  /**
   * Událost `storage` z jiné karty (`key` null = jiná karta úložiště smazala). Změna vlastníka na cizí id, nebo zápis
   * profilu či runu, zatímco vlastníkem není tahle karta, = hraje se jinde → zablokovat.
   */
  handleStorage(key: string | null, newValue: string | null): void {
    if (this.lostControl) return;
    if (key === TAB_OWNER_KEY) {
      if (newValue !== null && newValue !== this.tabId) this.lose();
      return;
    }
    if (key !== null && !WATCHED_KEYS.includes(key)) return;
    const owner = this.base.get(TAB_OWNER_KEY);
    if (owner !== null && owner !== this.tabId) {
      this.lose();
      return;
    }
    // Vlastník je tahle karta, a přesto někdo zapsal (souběh při převzetí, karta se starší verzí hry bez hlídání):
    // aktivní karta má přednost — posluchači uloží svůj stav znovu.
    if (key !== null) for (const fn of [...this.foreignListeners]) fn();
  }

  /** Zavolá `fn`, když jiná karta přepsala profil nebo run, ačkoli vlastníkem je tahle karta. Vrací odhlášení. */
  onForeignWrite(fn: () => void): () => void {
    this.foreignListeners.add(fn);
    return () => this.foreignListeners.delete(fn);
  }

  /** Zavolá `fn(active)` při každé změně (ztráta / převzetí hry). Vrací odhlášení. */
  onChange(fn: (active: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Před zápisem: je tahle karta pořád vlastníkem? Cizí id v úložišti (událost ještě nedorazila) kartu zablokuje.
   * Chybějící vlastník (úložiště smazané, starší verze) = karta hru převezme.
   */
  private verify(): boolean {
    if (this.lostControl) return false;
    const owner = this.base.get(TAB_OWNER_KEY);
    if (owner === null) {
      this.base.set(TAB_OWNER_KEY, this.tabId);
      return true;
    }
    if (owner === this.tabId) return true;
    this.lose();
    return false;
  }

  private lose(): void {
    if (this.lostControl) return;
    this.lostControl = true;
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(!this.lostControl);
      } catch (e) {
        console.error('[tabs] Posluchač změny aktivní karty selhal', e);
      }
    }
  }
}

/** Napojí hlídání na události `storage` okna (jen změny `localStorage` z jiných karet). Vrací odhlášení. */
export function watchStorageEvents(guard: TabGuard, win: Window = window): () => void {
  const onStorage = (e: StorageEvent): void => {
    try {
      if (e.storageArea && e.storageArea !== win.localStorage) return;
    } catch {
      return;
    }
    guard.handleStorage(e.key, e.newValue);
  };
  win.addEventListener('storage', onStorage);
  return () => win.removeEventListener('storage', onStorage);
}
