/**
 * Nastavení hráče (výchozí hodnoty viz docs/DESIGN.md 13.4). Nastavení je součást profilu (`karban.profile`,
 * `Profile.settings` v src/engine/meta); tady je jen úložiště a promítnutí do stránky.
 *
 * `loadStoredProfile` obnoví profil z úložiště a nikdy ho neztratí: poškozená data nejdřív zazálohuje do
 * `karban.profile.backup.<timestamp>` a teprve pak zapíše nový profil; starý klíč `karban.settings` (doba před
 * profilem) zmigruje do profilu a smaže.
 */
import type { Profile, Settings } from '../engine/meta';
import { restoreProfile, sanitizeSettings, serializeProfile } from '../engine/meta';
import type { KeyValueStore } from './storage';
import { STORAGE_KEYS } from './storage';

export type { Settings };
export { DEFAULT_SETTINGS, sanitizeSettings } from '../engine/meta';

/** Předpona klíčů záloh poškozeného profilu (`karban.profile.backup.<timestamp>`). */
export const PROFILE_BACKUP_PREFIX = `${STORAGE_KEYS.profile}.backup.`;

/** Uloží profil (obálka `karban-save`, kind `profile`). Vrací false, když úložiště zápis odmítlo. */
export function saveStoredProfile(store: KeyValueStore, profile: Profile, now: Date = new Date()): boolean {
  return store.set(STORAGE_KEYS.profile, serializeProfile(profile, now.toISOString()));
}

/**
 * Obnoví profil z úložiště. `writable` = profil smí přepsat uložená data (false jen u poškozeného profilu, jehož
 * zálohu se nepodařilo zapsat — pak se nesmí přepsat, aby se data neztratila).
 */
function restoreFromStore(store: KeyValueStore, now: Date): { profile: Profile; writable: boolean } {
  const legacy = store.get(STORAGE_KEYS.settings);
  const res = restoreProfile({
    raw: store.get(STORAGE_KEYS.profile),
    legacySettings: legacy,
    nowIso: now.toISOString(),
  });
  if (res.status === 'loaded') {
    if (legacy !== null) store.remove(STORAGE_KEYS.settings);
    return { profile: res.profile, writable: true };
  }
  if (res.status === 'corrupt') {
    const backedUp =
      res.backup !== undefined && store.set(`${PROFILE_BACKUP_PREFIX}${now.getTime()}`, res.backup);
    if (!backedUp) return { profile: res.profile, writable: false };
  }
  if (saveStoredProfile(store, res.profile, now) && legacy !== null) store.remove(STORAGE_KEYS.settings);
  return { profile: res.profile, writable: true };
}

/**
 * Načte profil z úložiště (nebo založí nový). Poškozený profil zazálohuje a nový zapíše jen tehdy, když se záloha
 * povedla — jinak nechá původní data na místě a vrátí nový profil jen v paměti.
 */
export function loadStoredProfile(store: KeyValueStore, now: Date = new Date()): Profile {
  return restoreFromStore(store, now).profile;
}

export function loadSettings(store: KeyValueStore): Settings {
  return { ...loadStoredProfile(store).settings };
}

/** Zapíše nastavení do profilu v úložišti (načte → změní → uloží; nezazálohovaný poškozený profil nepřepíše). */
export function saveSettings(store: KeyValueStore, s: Settings): void {
  const now = new Date();
  const { profile, writable } = restoreFromStore(store, now);
  if (!writable) return;
  profile.settings = sanitizeSettings(s);
  saveStoredProfile(store, profile, now);
}

/** Promítne nastavení do CSS proměnných a tříd na <html>. */
export function applySettingsToDocument(s: Settings, doc: Document = document): void {
  const root = doc.documentElement;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.style.setProperty('--speed', String(s.speed));
  root.style.setProperty('--ui-scale', String(s.uiScale));
  root.classList.toggle('colorblind', s.colorblind);
  // Velké UI (120–140 %): rozvržení s pevnými prahy v px (kontejnerové dotazy) se přepne dřív (styles/*.css).
  root.classList.toggle('ui-large', s.uiScale >= 1.2);
  root.classList.toggle('no-anim', !s.animations);
  root.classList.toggle('no-shake', !s.screenShake || reduced);
}
