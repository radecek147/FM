/**
 * Nastavení jako součást profilu (src/ui/settings.ts nad src/engine/meta): migrace starého klíče
 * `karban.settings`, zápis do `karban.profile`, záloha poškozeného profilu (`karban.profile.backup.<timestamp>`).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createProfile, deserializeProfile, serializeProfile } from '../../src/engine';
import {
  PROFILE_BACKUP_PREFIX,
  loadSettings,
  loadStoredProfile,
  sanitizeSettings,
  saveSettings,
  saveStoredProfile,
} from '../../src/ui/settings';
import type { KeyValueStore } from '../../src/ui/storage';
import { STORAGE_KEYS, memoryStore } from '../../src/ui/storage';

const NOW = new Date('2026-10-02T10:00:00.000Z');

describe('nastavení v profilu', () => {
  it('API zůstává: DEFAULT_SETTINGS a sanitizeSettings', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ uiScale: 3, musicVolume: -1 })).toMatchObject({ uiScale: 1.4, musicVolume: 0 });
  });

  it('staré karban.settings zmigruje do profilu a smaže', () => {
    const store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false, speed: 3 }) });
    const s = loadSettings(store);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, animations: false, speed: 3 });
    expect(store.get(STORAGE_KEYS.settings)).toBeNull();
    const profile = deserializeProfile(store.get(STORAGE_KEYS.profile));
    expect(profile.settings).toEqual(s);
  });

  it('saveSettings zapíše do profilu, ne do starého klíče; zbytek profilu zůstane', () => {
    const store = memoryStore();
    const p = createProfile(NOW.toISOString());
    p.stats.runs.won = 7;
    saveStoredProfile(store, p, NOW);
    saveSettings(store, { ...DEFAULT_SETTINGS, colorblind: true });
    expect(store.get(STORAGE_KEYS.settings)).toBeNull();
    const loaded = deserializeProfile(store.get(STORAGE_KEYS.profile));
    expect(loaded.settings.colorblind).toBe(true);
    expect(loaded.stats.runs.won).toBe(7);
    expect(loadSettings(store).colorblind).toBe(true);
  });

  it('platný profil má přednost před starým klíčem (ten se jen uklidí)', () => {
    const p = createProfile(NOW.toISOString(), { speed: 2 });
    const store = memoryStore({
      [STORAGE_KEYS.profile]: serializeProfile(p, NOW.toISOString()),
      [STORAGE_KEYS.settings]: JSON.stringify({ speed: 4 }),
    });
    expect(loadSettings(store).speed).toBe(2);
    expect(store.get(STORAGE_KEYS.settings)).toBeNull();
  });

  it('poškozený profil zazálohuje do karban.profile.backup.<timestamp> a založí nový', () => {
    const store = memoryStore({ [STORAGE_KEYS.profile]: '{rozbité' });
    const profile = loadStoredProfile(store, NOW);
    expect(profile.stats.runs.played).toBe(0);
    expect(store.get(`${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`)).toBe('{rozbité');
    expect(() => deserializeProfile(store.get(STORAGE_KEYS.profile))).not.toThrow();
    expect(PROFILE_BACKUP_PREFIX).toBe('karban.profile.backup.');
  });

  it('když zálohu nejde zapsat, poškozený profil nepřepíše (ani saveSettings)', () => {
    const inner = memoryStore({ [STORAGE_KEYS.profile]: '{rozbité' });
    const store: KeyValueStore = {
      ...inner,
      set: (k, v) => (k.startsWith(PROFILE_BACKUP_PREFIX) ? false : inner.set(k, v)),
    };
    const profile = loadStoredProfile(store, NOW);
    expect(profile.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.get(STORAGE_KEYS.profile)).toBe('{rozbité');
    saveSettings(store, { ...DEFAULT_SETTINGS, speed: 2 });
    expect(store.get(STORAGE_KEYS.profile)).toBe('{rozbité');
  });
});
