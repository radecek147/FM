/**
 * Ukládání: verzovaná obálka + migrace. Formát:
 * `{ format: 'karban-save', kind: 'run' | 'profile', version: N, savedAt, data }`.
 * Migrace jsou čisté funkce vN → vN+1; načtení starší verze je postupně aplikuje.
 */
import { RNG_STREAMS } from '../rng/rng';
import { RUN_STATE_VERSION } from '../run/init';
import type { RunPhase, RunState } from '../types';

export const SAVE_FORMAT = 'karban-save';

export type SaveKind = 'run' | 'profile';

export interface SaveEnvelope<T = unknown> {
  format: typeof SAVE_FORMAT;
  kind: SaveKind;
  version: number;
  savedAt: string;
  data: T;
}

export type SaveErrorCode = 'invalidJson' | 'invalidFormat' | 'wrongKind' | 'tooNew' | 'migrationFailed';

export class SaveError extends Error {
  constructor(
    public readonly code: SaveErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SaveError';
  }
}

/** Migrace stavu runu: klíč = verze, ze které se migruje (v → v+1). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
export const RUN_MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  // Příklad budoucí migrace:
  // 1: (d) => ({ ...d, newField: defaultValue }),
});

/**
 * Postupně aplikuje migrace `from → from + 1 → … → to`. Chybějící nebo selhavší migrace = `SaveError`
 * s kódem `migrationFailed`. Každý krok zapíše do dat novou `version`.
 */
export function migrate(
  data: Record<string, unknown>,
  from: number,
  to: number,
  migrations: Readonly<Record<number, Migration>>,
): Record<string, unknown> {
  let cur = data;
  for (let v = from; v < to; v++) {
    const m = migrations[v];
    if (!m) throw new SaveError('migrationFailed', `Missing migration from v${v}`);
    let next: unknown;
    try {
      next = m(cur);
    } catch (e) {
      throw new SaveError('migrationFailed', `Migration v${v} failed: ${(e as Error).message}`);
    }
    if (!isRecord(next)) throw new SaveError('migrationFailed', `Migration v${v} returned no object`);
    cur = next;
    cur.version = v + 1;
  }
  return cur;
}

export function wrap<T>(kind: SaveKind, version: number, data: T, savedAt: string): SaveEnvelope<T> {
  return { format: SAVE_FORMAT, kind, version, savedAt, data };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Platná verze formátu: kladné celé číslo (NaN, nekonečno, desetinná čísla a 0 ne). */
function isVersion(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** Rozbalí a zvaliduje obálku (z JSON řetězce nebo objektu). */
export function unwrap(input: unknown, kind: SaveKind): SaveEnvelope<Record<string, unknown>> {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      throw new SaveError('invalidJson');
    }
  }
  if (!isRecord(obj)) throw new SaveError('invalidFormat');
  const env = obj as Partial<SaveEnvelope>;
  if (env.format !== SAVE_FORMAT || !isVersion(env.version) || !isRecord(env.data)) {
    throw new SaveError('invalidFormat');
  }
  if (env.kind !== kind) throw new SaveError('wrongKind');
  return env as SaveEnvelope<Record<string, unknown>>;
}

const RUN_PHASES: readonly RunPhase[] = [
  'blind_select',
  'round',
  'round_end',
  'shop',
  'booster',
  'game_over',
  'victory',
];

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Základní kontrola tvaru uloženého runu (po migracích): pole, která engine čte hned po načtení. Poškozené nebo
 * cizí uložení tak skončí `SaveError('invalidFormat')` místo pádu uprostřed hry.
 */
function isRunStateShape(d: Record<string, unknown>): boolean {
  const rng = d.rng;
  if (!isRecord(rng)) return false;
  for (const stream of RNG_STREAMS) {
    const st = rng[stream];
    if (!Array.isArray(st) || st.length !== 4 || !st.every((n) => isFiniteNumber(n))) return false;
  }
  return (
    typeof d.seed === 'string' &&
    typeof d.deckId === 'string' &&
    typeof d.phase === 'string' &&
    RUN_PHASES.includes(d.phase as RunPhase) &&
    isFiniteNumber(d.ante) &&
    isFiniteNumber(d.money) &&
    isFiniteNumber(d.stake) &&
    isFiniteNumber(d.blindIndex) &&
    isFiniteNumber(d.nextUid) &&
    Array.isArray(d.deck) &&
    Array.isArray(d.blinds) &&
    Array.isArray(d.jokers) &&
    Array.isArray(d.consumables) &&
    Array.isArray(d.tags) &&
    isRecord(d.handLevels) &&
    isRecord(d.stats) &&
    (d.round === null || isRecord(d.round)) &&
    (d.shop === null || isRecord(d.shop)) &&
    (d.booster === null || isRecord(d.booster))
  );
}

/** Uloží stav runu do obálky jako JSON. `savedAt` dodá volající (engine nesmí číst čas). */
export function serializeRun(state: RunState, savedAt = new Date(0).toISOString()): string {
  return JSON.stringify(wrap('run', RUN_STATE_VERSION, state, savedAt));
}

export interface DeserializeOptions {
  /** Tabulka migrací (výchozí `RUN_MIGRATIONS`; testy předají vlastní). */
  migrations?: Readonly<Record<number, Migration>>;
  /** Aktuální verze formátu (výchozí `RUN_STATE_VERSION`). */
  currentVersion?: number;
}

/**
 * Načte run z obálky (JSON řetězec nebo objekt): ověří obálku, odmítne novější verzi (`tooNew`), starší zmigruje
 * a zkontroluje tvar stavu. Chyby jsou `SaveError` s kódem.
 */
export function deserializeRun(input: unknown, opts: DeserializeOptions = {}): RunState {
  const migrations = opts.migrations ?? RUN_MIGRATIONS;
  const current = opts.currentVersion ?? RUN_STATE_VERSION;
  const env = unwrap(input, 'run');
  if (env.version > current) throw new SaveError('tooNew');
  // Vstupní objekt (předaný přímo, ne řetězec) se nesmí změnit — migrace zapisují `version`.
  const data = migrate(structuredCloneJson(env.data), env.version, current, migrations);
  data.version = current;
  if (!isRunStateShape(data)) throw new SaveError('invalidFormat');
  return data as unknown as RunState;
}

/** Hluboká kopie JSON dat (uložení je vždy JSON). */
function structuredCloneJson<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
