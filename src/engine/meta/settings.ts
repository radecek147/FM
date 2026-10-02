/**
 * Nastavení hráče — součást profilu (`Profile.settings`, DESIGN 13.4). Čistá data bez DOM; promítnutí do stránky
 * (`applySettingsToDocument`) a úložiště řeší `src/ui/settings.ts`.
 */

export interface Settings {
  /** Hlasitost zvukových efektů 0–1. */
  sfxVolume: number;
  /** Hlasitost hudby 0–1. */
  musicVolume: number;
  /** Ztlumit všechno (klávesa M) — hlasitosti zůstanou, jen se nehraje. */
  muted: boolean;
  /** Rychlost hry 1–4. */
  speed: number;
  animations: boolean;
  screenShake: boolean;
  /** Barvoslepý režim (4barevný balíček). */
  colorblind: boolean;
  /** Velikost UI 0,8–1,4. */
  uiScale: number;
  /** Rady Štamgasta (tutoriál) zapnuté. */
  tutorial: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sfxVolume: 0.7,
  musicVolume: 0.5,
  muted: false,
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

/** Ze vstupu libovolného tvaru udělá platné nastavení (neznámé klíče zahodí, chybějící/neplatné doplní). */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, f: boolean): boolean => (typeof v === 'boolean' ? v : f);
  return {
    sfxVolume: clamp(r.sfxVolume, 0, 1, d.sfxVolume),
    musicVolume: clamp(r.musicVolume, 0, 1, d.musicVolume),
    muted: bool(r.muted, d.muted),
    speed: clamp(r.speed, 1, 4, d.speed),
    animations: bool(r.animations, d.animations),
    screenShake: bool(r.screenShake, d.screenShake),
    colorblind: bool(r.colorblind, d.colorblind),
    uiScale: clamp(r.uiScale, 0.8, 1.4, d.uiScale),
    tutorial: bool(r.tutorial, d.tutorial),
  };
}
