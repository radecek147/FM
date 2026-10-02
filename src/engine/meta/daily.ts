/**
 * Denní run a zadání seedu (DESIGN 11.6–11.7). Engine hodiny nečte: datum dostává jako `Date` nebo ISO řetězec.
 */
import type { ContentRegistry } from '../content-types';
import { SEED_ALPHABET, SEED_LENGTH } from '../constants';
import { compareIds } from '../shop/pool';
import { createRngStates, dailySeed, rngFromState } from '../rng/rng';
import type { Profile } from './types';

/** Nejvyšší síla piva denního runu (DESIGN 11.7: 1–5). */
export const DAILY_MAX_STAKE = 5;
/** Předpona seedu denního runu. */
export const DAILY_SEED_PREFIX = 'DEN-';

const DAILY_SEED_RE = /^DEN-(\d{4})(\d{2})(\d{2})$/;

function toDate(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(date)}`);
  return d;
}

/** Klíč dne v UTC: `YYYYMMDD` (klíč `Profile.daily`). */
export function dailyDateKey(date: Date | string): string {
  return dailySeed(toDate(date)).slice(DAILY_SEED_PREFIX.length);
}

/** Je `YYYYMMDD` skutečné datum (gregoriánský kalendář, UTC)? */
function isValidDateKey(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 9999) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Klíč dne ze seedu denního runu (`DEN-20261001` → `20261001`), jinak null. */
export function dailyKeyFromSeed(seed: string): string | null {
  const m = DAILY_SEED_RE.exec(seed);
  if (!m) return null;
  return isValidDateKey(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}${m[2]}${m[3]}` : null;
}

export interface DailySetup {
  /** `DEN-YYYYMMDD` */
  seed: string;
  /** `YYYYMMDD` */
  dateKey: string;
  deckId: string;
  stake: number;
}

/**
 * Nastavení denního runu ze seedu `DEN-YYYYMMDD` — balíček z celého registru (seřazená id), síla piva 1–5
 * (nejvýš nejvyšší úroveň v registru); obojí z vlastní kopie streamu `misc` seedu, takže to stejné dá všem
 * hráčům i opakovaně. Run se pak zakládá s `daily: true` a `unlockedPool` = vše (`unlockedPoolFor(..., 'daily')`).
 */
export function dailySetupFromSeed(seed: string, registry: ContentRegistry): DailySetup {
  const dateKey = dailyKeyFromSeed(seed);
  if (!dateKey) throw new Error(`Not a daily seed: ${seed}`);
  const decks = Object.keys(registry.decks).sort(compareIds);
  if (decks.length === 0) throw new Error('Registry has no decks');
  const levels = Object.values(registry.stakes).map((s) => s.level);
  const maxStake = Math.max(1, Math.min(DAILY_MAX_STAKE, levels.length ? Math.max(...levels) : 1));
  const rng = rngFromState(createRngStates(seed).misc);
  const deckId = rng.pick(decks);
  const stake = rng.int(1, maxStake);
  return { seed, dateKey, deckId, stake };
}

/** Nastavení denního runu pro daný den (UTC). */
export function dailyRunSetup(date: Date | string, registry: ContentRegistry): DailySetup {
  return dailySetupFromSeed(dailySeed(toDate(date)), registry);
}

/** Kódy chyb zadání seedu (texty v i18n). */
export type SeedErrorCode = 'empty' | 'invalidChars' | 'tooShort' | 'tooLong' | 'invalidDate' | 'reserved';

export type SeedParseResult =
  | { ok: true; kind: 'custom'; seed: string }
  | { ok: true; kind: 'daily'; seed: string; dateKey: string }
  | { ok: false; error: SeedErrorCode };

/**
 * Zadání seedu hráčem (DESIGN 11.6): mezery se ignorují, písmena se převedou na velká; platný je seed
 * `SEED_LENGTH` znaků z `SEED_ALPHABET` (bez I, O, 0, 1), nebo seed denního runu `DEN-YYYYMMDD` (přehraje daný den
 * mimo soutěž). Jiné tvary s pomlčkou (např. `SIM-…`) hra odmítne (`reserved`). Prázdné zadání = `empty`
 * (UI pak vygeneruje náhodný seed).
 */
export function parseSeedInput(input: string): SeedParseResult {
  const s = input.replace(/\s+/g, '').toUpperCase();
  if (s === '') return { ok: false, error: 'empty' };
  if (s.includes('-')) {
    if (!s.startsWith(DAILY_SEED_PREFIX)) return { ok: false, error: 'reserved' };
    const key = dailyKeyFromSeed(s);
    return key ? { ok: true, kind: 'daily', seed: s, dateKey: key } : { ok: false, error: 'invalidDate' };
  }
  for (const ch of s) if (!SEED_ALPHABET.includes(ch)) return { ok: false, error: 'invalidChars' };
  if (s.length < SEED_LENGTH) return { ok: false, error: 'tooShort' };
  if (s.length > SEED_LENGTH) return { ok: false, error: 'tooLong' };
  return { ok: true, kind: 'custom', seed: s };
}

/** Má hráč dnes (UTC) ještě oficiální pokus denního runu? */
export function isDailyAvailable(profile: Readonly<Profile>, nowIso: string): boolean {
  return profile.daily[dailyDateKey(nowIso)] === undefined;
}

/**
 * Doplní do profilu `target` záznamy denních runů z `source`, které v něm chybí (import staršího profilu):
 * oficiální pokus dne zůstane spotřebovaný — import ho nevrátí (DESIGN 11.7, jeden oficiální pokus denně).
 * Záznamy, které `target` má, nemění. Vrací počet doplněných dní. Mutuje `target`.
 */
export function mergeDailyRecords(target: Profile, source: Readonly<Profile>): number {
  let added = 0;
  for (const [key, rec] of Object.entries(source.daily)) {
    if (target.daily[key] !== undefined) continue;
    target.daily[key] = { ...rec };
    added++;
  }
  return added;
}

/** Následující den klíče `YYYYMMDD`. */
function nextDayKey(key: string): string {
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) + 1);
  return dailyDateKey(new Date(t));
}

/**
 * Série denních runů (oficiální pokusy): `longest` = nejdelší řada po sobě jdoucích dní, `current` = řada končící
 * dnem `nowIso` nebo předchozím dnem (dnešek ještě jde dohrát).
 */
export function dailyStreak(
  profile: Readonly<Profile>,
  nowIso?: string,
): { current: number; longest: number } {
  const keys = Object.keys(profile.daily).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  const runEnding: Record<string, number> = {};
  for (const k of keys) {
    run = prev !== null && nextDayKey(prev) === k ? run + 1 : 1;
    runEnding[k] = run;
    longest = Math.max(longest, run);
    prev = k;
  }
  let current = 0;
  if (nowIso) {
    const today = dailyDateKey(nowIso);
    const t = Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(4, 6)) - 1,
      Number(today.slice(6, 8)) - 1,
    );
    const yesterday = dailyDateKey(new Date(t));
    current = runEnding[today] ?? runEnding[yesterday] ?? 0;
  }
  return { current, longest };
}
