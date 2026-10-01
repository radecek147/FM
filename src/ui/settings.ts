/** Nastavení hráče (výchozí hodnoty viz docs/DESIGN.md 13.4). */
import type { KeyValueStore } from './storage';
import { STORAGE_KEYS } from './storage';

export interface Settings {
  sfxVolume: number; // 0–1
  musicVolume: number; // 0–1
  speed: number; // 1–4
  animations: boolean;
  screenShake: boolean;
  colorblind: boolean;
  uiScale: number; // 0.8–1.4
  tutorial: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sfxVolume: 0.7,
  musicVolume: 0.5,
  speed: 1,
  animations: true,
  screenShake: true,
  colorblind: false,
  uiScale: 1,
  tutorial: true,
});

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
  return {
    sfxVolume: clamp(r.sfxVolume, 0, 1, d.sfxVolume),
    musicVolume: clamp(r.musicVolume, 0, 1, d.musicVolume),
    speed: clamp(r.speed, 1, 4, d.speed),
    animations: bool(r.animations, d.animations),
    screenShake: bool(r.screenShake, d.screenShake),
    colorblind: bool(r.colorblind, d.colorblind),
    uiScale: clamp(r.uiScale, 0.8, 1.4, d.uiScale),
    tutorial: bool(r.tutorial, d.tutorial),
  };
}

export function loadSettings(store: KeyValueStore): Settings {
  const raw = store.get(STORAGE_KEYS.settings);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(store: KeyValueStore, s: Settings): void {
  store.set(STORAGE_KEYS.settings, JSON.stringify(s));
}

/** Promítne nastavení do CSS proměnných a tříd na <html>. */
export function applySettingsToDocument(s: Settings, doc: Document = document): void {
  const root = doc.documentElement;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.style.setProperty('--speed', String(s.speed));
  root.style.setProperty('--ui-scale', String(s.uiScale));
  root.classList.toggle('colorblind', s.colorblind);
  root.classList.toggle('no-anim', !s.animations);
  root.classList.toggle('no-shake', !s.screenShake || reduced);
}
