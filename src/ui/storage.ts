/**
 * Bezpečný přístup k localStorage (soukromé okno / zablokované úložiště nesmí shodit hru).
 * Klíče: `karban.run` (rozehraný run), `karban.profile` (profil), `karban.settings` (nastavení).
 */
export const STORAGE_KEYS = {
  run: 'karban.run',
  profile: 'karban.profile',
  settings: 'karban.settings',
} as const;

/** Předpona záloh nečitelného rozehraného runu (`karban.run.backup.<ms>`) — jdou do exportu, reset je nemaže. */
export const RUN_BACKUP_PREFIX = `${STORAGE_KEYS.run}.backup.`;

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

/** Úložiště nad window.localStorage s ošetřením výjimek. */
export function browserStore(): KeyValueStore {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = ls();
        if (!s) return false;
        s.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        ls()?.removeItem(key);
      } catch {
        /* nic */
      }
    },
    keys() {
      try {
        const s = ls();
        if (!s) return [];
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

/** Úložiště v paměti (testy, fallback). */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => {
      data.set(k, v);
      return true;
    },
    remove: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

/**
 * Zapíše zálohu `raw` pod klíč `<prefix><ms>` a vrátí ho, nebo null, když ji úložiště odmítlo. Dvě zálohy v jedné
 * milisekundě se nepřepíšou (klíč se posune o 1 ms); stejný obsah pod stejným klíčem se nezdvojuje.
 */
export function writeBackup(store: KeyValueStore, prefix: string, raw: string, now: Date): string | null {
  let ms = now.getTime();
  let key = `${prefix}${ms}`;
  for (let existing = store.get(key); existing !== null && existing !== raw; existing = store.get(key))
    key = `${prefix}${++ms}`;
  return store.set(key, raw) ? key : null;
}
