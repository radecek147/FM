/**
 * Ukládání: verzovaná obálka + migrace. Formát:
 * `{ format: 'karban-save', kind: 'run' | 'profile', version: N, savedAt, data }`.
 * Migrace jsou čisté funkce vN → vN+1; načtení starší verze je postupně aplikuje.
 */
import { RUN_STATE_VERSION } from '../run/init';
import type { RunState } from '../types';

export const SAVE_FORMAT = 'karban-save';

export type SaveKind = 'run' | 'profile';

export interface SaveEnvelope<T = unknown> {
  format: typeof SAVE_FORMAT;
  kind: SaveKind;
  version: number;
  savedAt: string;
  data: T;
}

export class SaveError extends Error {
  constructor(
    public readonly code: 'invalidJson' | 'invalidFormat' | 'wrongKind' | 'tooNew' | 'migrationFailed',
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Migrace stavu runu: klíč = verze, ze které se migruje (v → v+1). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
export const RUN_MIGRATIONS: Record<number, Migration> = {
  // Příklad budoucí migrace:
  // 1: (d) => ({ ...d, newField: defaultValue, version: 2 }),
};

export function migrate(
  data: Record<string, unknown>,
  from: number,
  to: number,
  migrations: Record<number, Migration>,
): Record<string, unknown> {
  let cur = data;
  for (let v = from; v < to; v++) {
    const m = migrations[v];
    if (!m) throw new SaveError('migrationFailed', `Missing migration from v${v}`);
    try {
      cur = m(cur);
    } catch (e) {
      throw new SaveError('migrationFailed', `Migration v${v} failed: ${(e as Error).message}`);
    }
    cur.version = v + 1;
  }
  return cur;
}

export function wrap<T>(kind: SaveKind, version: number, data: T, savedAt: string): SaveEnvelope<T> {
  return { format: SAVE_FORMAT, kind, version, savedAt, data };
}

/** Rozbalí a zvaliduje obálku (z JSON řetězce nebo objektu). */
export function unwrap(input: string | unknown, kind: SaveKind): SaveEnvelope<Record<string, unknown>> {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      throw new SaveError('invalidJson');
    }
  }
  if (!obj || typeof obj !== 'object') throw new SaveError('invalidFormat');
  const env = obj as Partial<SaveEnvelope>;
  if (
    env.format !== SAVE_FORMAT ||
    typeof env.version !== 'number' ||
    !env.data ||
    typeof env.data !== 'object'
  ) {
    throw new SaveError('invalidFormat');
  }
  if (env.kind !== kind) throw new SaveError('wrongKind');
  return env as SaveEnvelope<Record<string, unknown>>;
}

export function serializeRun(state: RunState, savedAt = new Date(0).toISOString()): string {
  return JSON.stringify(wrap('run', RUN_STATE_VERSION, state, savedAt));
}

export function deserializeRun(input: string | unknown): RunState {
  const env = unwrap(input, 'run');
  if (env.version > RUN_STATE_VERSION) throw new SaveError('tooNew');
  const data = migrate(env.data, env.version, RUN_STATE_VERSION, RUN_MIGRATIONS);
  const st = data as unknown as RunState;
  if (!Array.isArray(st.deck) || typeof st.seed !== 'string' || !st.rng || typeof st.phase !== 'string') {
    throw new SaveError('invalidFormat');
  }
  return st;
}
