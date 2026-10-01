/**
 * Ukládání runu (`src/engine/save/save.ts`, ARCHITECTURE kap. 5): obálka `{ format, kind, version, savedAt, data }`,
 * roundtrip v každé fázi runu, pokračování po načtení identické s během bez uložení, chybové kódy `SaveError`
 * a rámec migrací (vlastní tabulka v1 → v2 → v3, chybějící a selhavší migrace).
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/run/game';
import { RUN_STATE_VERSION } from '../../src/engine/run/init';
import type { Migration } from '../../src/engine/save/save';
import {
  RUN_MIGRATIONS,
  SAVE_FORMAT,
  SaveError,
  deserializeRun,
  migrate,
  serializeRun,
  unwrap,
  wrap,
} from '../../src/engine/save/save';
import type { ActionResult, RunPhase, RunState } from '../../src/engine/types';
import { botStep } from './fixtures/bot';
import { ART, makeGame, makeRegistry, selectBoss, winNextHand } from './fixtures/registry';

function ok(res: ActionResult): void {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
}

function winRound(game: Game): void {
  winNextHand(game);
  ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
}

const registry = makeRegistry({ decks: [{ id: 'easy', passive: () => ({ targetMult: 0.2 }), art: ART }] });

/** Hra dovedená do dané fáze (s žolíky, aby stav obsahoval i instance obsahu). */
function gameIn(phase: RunPhase): Game {
  const game = makeGame({
    registry,
    deckId: 'easy',
    seed: `SAVE${phase.length}`,
    jokers: ['late_train', 'counter'],
  });
  if (phase === 'blind_select') return game;
  if (phase === 'victory') {
    game._core.api.changeAnte(7);
    selectBoss(game, game.state.blinds[2]!.bossId!);
    winRound(game);
    return game;
  }
  ok(game.dispatch({ type: 'selectBlind' }));
  ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 2) }));
  if (phase === 'round') return game;
  if (phase === 'game_over') {
    game._core.state.round!.handsLeft = 1;
    game._core.state.round!.target = 1e12;
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    return game;
  }
  winRound(game);
  if (phase === 'round_end') return game;
  ok(game.dispatch({ type: 'cashOut' }));
  game._core.state.money = 40;
  if (phase === 'shop') return game;
  ok(game.dispatch({ type: 'buyBooster', slot: 0 }));
  return game;
}

const PHASES: RunPhase[] = ['blind_select', 'round', 'round_end', 'shop', 'booster', 'victory', 'game_over'];

describe('obálka uložení', () => {
  it('serializeRun: format, kind, verze, savedAt a data = stav', () => {
    const game = makeGame();
    const env = JSON.parse(serializeRun(game.state, '2026-10-01T12:00:00.000Z')) as Record<string, unknown>;
    expect(env).toEqual({
      format: SAVE_FORMAT,
      kind: 'run',
      version: RUN_STATE_VERSION,
      savedAt: '2026-10-01T12:00:00.000Z',
      data: JSON.parse(JSON.stringify(game.state)),
    });
    // Bez času od volajícího je savedAt pevný (engine nesmí číst hodiny).
    expect(JSON.parse(serializeRun(game.state)).savedAt).toBe(new Date(0).toISOString());
  });

  it('wrap/unwrap: obálka z objektu i z řetězce, kind profilu', () => {
    const env = wrap('profile', 3, { a: 1 }, 'x');
    expect(unwrap(env, 'profile')).toBe(env);
    expect(unwrap(JSON.stringify(env), 'profile')).toEqual(env);
  });
});

describe('roundtrip v každé fázi runu', () => {
  for (const phase of PHASES) {
    it(`${phase}: načtený stav je shodný s uloženým`, () => {
      const game = gameIn(phase);
      expect(game.state.phase).toBe(phase);
      const loaded = deserializeRun(serializeRun(game.state));
      expect(loaded).toEqual(JSON.parse(JSON.stringify(game.state)));
      expect(JSON.stringify(loaded)).toBe(JSON.stringify(game.state));
      // I z objektu (už rozparsovaného JSON); vstup se nezmění.
      const env = JSON.parse(serializeRun(game.state)) as Record<string, unknown>;
      const copy = JSON.stringify(env);
      expect(deserializeRun(env)).toEqual(loaded);
      expect(JSON.stringify(env)).toBe(copy);
    });

    it(`${phase}: po načtení pokračuje run identicky (stav i události)`, () => {
      const original = gameIn(phase);
      const restored = Game.fromState(deserializeRun(serializeRun(original.state)), original.registry);
      for (let i = 0; i < 40; i++) {
        const a = botStep(original);
        const b = botStep(restored);
        expect(b?.action).toEqual(a?.action);
        expect(b?.result).toEqual(a?.result);
        if (!a) break;
      }
      expect(JSON.stringify(restored.state)).toBe(JSON.stringify(original.state));
    });
  }

  it('neplatná akce po načtení vrátí stejnou chybu a stav nezmění', () => {
    const original = gameIn('shop');
    const restored = Game.fromState(deserializeRun(serializeRun(original.state)), original.registry);
    const before = JSON.stringify(restored.state);
    expect(restored.dispatch({ type: 'play', cardIds: [1] })).toEqual(
      original.dispatch({ type: 'play', cardIds: [1] }),
    );
    expect(JSON.stringify(restored.state)).toBe(before);
  });
});

describe('chyby načtení (SaveError)', () => {
  const valid = (): Record<string, unknown> =>
    JSON.parse(serializeRun(makeGame().state)) as Record<string, unknown>;

  function code(input: unknown): string {
    try {
      deserializeRun(input);
    } catch (e) {
      expect(e).toBeInstanceOf(SaveError);
      expect((e as SaveError).name).toBe('SaveError');
      return (e as SaveError).code;
    }
    return 'ok';
  }

  it('neplatný JSON → invalidJson', () => {
    expect(code('{"format": ')).toBe('invalidJson');
    expect(code('')).toBe('invalidJson');
  });

  it('cokoli jiného než obálka → invalidFormat', () => {
    for (const input of ['42', 'null', '[]', '"run"', 42, null, undefined, [], true])
      expect(code(input)).toBe('invalidFormat');
    expect(code({ ...valid(), format: 'jina-hra' })).toBe('invalidFormat');
    expect(code({ ...valid(), data: undefined })).toBe('invalidFormat');
    expect(code({ ...valid(), data: 'stav' })).toBe('invalidFormat');
    expect(code({ ...valid(), data: [] })).toBe('invalidFormat');
  });

  it('verze musí být kladné celé číslo', () => {
    for (const version of ['1', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(code({ ...valid(), version }), String(version)).toBe('invalidFormat');
    }
  });

  it('jiný druh uložení → wrongKind', () => {
    expect(code({ ...valid(), kind: 'profile' })).toBe('wrongKind');
    expect(code({ ...valid(), kind: undefined })).toBe('wrongKind');
  });

  it('novější verze, než engine zná → tooNew', () => {
    expect(code({ ...valid(), version: RUN_STATE_VERSION + 1 })).toBe('tooNew');
  });

  it('poškozený stav (chybějící pole, RNG stream, neplatná fáze) → invalidFormat', () => {
    const broken: ((d: Record<string, unknown>) => void)[] = [
      (d) => delete d.deck,
      (d) => (d.seed = 7),
      (d) => (d.phase = 'lunch'),
      (d) => delete (d.rng as Record<string, unknown>).boss,
      (d) => ((d.rng as Record<string, unknown>).deck = [1, 2, 3]),
      (d) => ((d.rng as Record<string, unknown>).deck = [1, 2, 3, null]),
      (d) => (d.rng = null),
      (d) => (d.money = null),
      (d) => (d.round = 'none'),
      (d) => delete d.jokers,
      (d) => (d.stats = []),
    ];
    for (const breakIt of broken) {
      const env = valid();
      breakIt(env.data as Record<string, unknown>);
      expect(code(env), breakIt.toString()).toBe('invalidFormat');
    }
  });
});

describe('migrace', () => {
  /** Fiktivní v1 → v2: přejmenuje `money` na `cash` a doplní nové pole; v2 → v3 přidá příznak. */
  const TEST_MIGRATIONS: Record<number, Migration> = {
    1: (d) => {
      const { money, ...rest } = d;
      return { ...rest, cash: money, newField: 'výchozí' };
    },
    2: (d) => ({ ...d, v3: true }),
  };

  it('migrate aplikuje migrace postupně a zapíše verzi', () => {
    const out = migrate({ version: 1, money: 7 }, 1, 3, TEST_MIGRATIONS);
    expect(out).toEqual({ version: 3, cash: 7, newField: 'výchozí', v3: true });
    expect(migrate({ version: 2, cash: 1 }, 2, 3, TEST_MIGRATIONS)).toEqual({
      version: 3,
      cash: 1,
      v3: true,
    });
    // Stejná verze = beze změny.
    const same = { version: 3 };
    expect(migrate(same, 3, 3, TEST_MIGRATIONS)).toBe(same);
  });

  it('chybějící migrace → migrationFailed', () => {
    expect(() => migrate({ version: 1 }, 1, 2, {})).toThrow(SaveError);
    try {
      migrate({ version: 1 }, 1, 4, TEST_MIGRATIONS);
    } catch (e) {
      expect((e as SaveError).code).toBe('migrationFailed');
      expect((e as SaveError).message).toContain('v3');
    }
  });

  it('migrace, která vyhodí výjimku nebo nevrátí objekt → migrationFailed', () => {
    const throwing: Record<number, Migration> = {
      1: () => {
        throw new Error('rozbité');
      },
    };
    expect(() => migrate({ version: 1 }, 1, 2, throwing)).toThrow(/rozbité/);
    try {
      migrate({ version: 1 }, 1, 2, throwing);
    } catch (e) {
      expect((e as SaveError).code).toBe('migrationFailed');
    }
    const empty = { 1: () => null } as unknown as Record<number, Migration>;
    expect(() => migrate({ version: 1 }, 1, 2, empty)).toThrow(SaveError);
  });

  it('deserializeRun s vlastní tabulkou: uložení v1 se načte jako v2', () => {
    const state = makeGame().state;
    const migrations: Record<number, Migration> = {
      1: (d) => ({ ...d, flags: { ...(d.flags as object), migrated: true } }),
    };
    const loaded = deserializeRun(serializeRun(state), { migrations, currentVersion: 2 });
    expect(loaded.version).toBe(2);
    expect(loaded.flags.migrated).toBe(true);
    expect(loaded.money).toBe(state.money);
    // Načtený stav jde hrát.
    const game = Game.fromState(loaded, makeRegistry());
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  });

  it('deserializeRun: chybějící migrace na novou verzi → migrationFailed; migrace rozbije stav → invalidFormat', () => {
    const save = serializeRun(makeGame().state);
    expect(() => deserializeRun(save, { migrations: {}, currentVersion: 2 })).toThrow(
      expect.objectContaining({ code: 'migrationFailed' }) as Error,
    );
    const breaking: Record<number, Migration> = { 1: ({ deck: _deck, ...rest }) => rest };
    expect(() => deserializeRun(save, { migrations: breaking, currentVersion: 2 })).toThrow(
      expect.objectContaining({ code: 'invalidFormat' }) as Error,
    );
  });

  it('uložení z novější verze nejde načíst starší verzí enginu', () => {
    const migrations: Record<number, Migration> = { 1: (d) => d };
    const v2 = deserializeRun(serializeRun(makeGame().state), { migrations, currentVersion: 2 });
    const env = { format: SAVE_FORMAT, kind: 'run', version: 2, savedAt: 'x', data: v2 };
    expect(() => deserializeRun(env)).toThrow(expect.objectContaining({ code: 'tooNew' }) as Error);
  });

  it('tabulka RUN_MIGRATIONS pokrývá každou starší verzi a je zmrazená', () => {
    for (let v = 1; v < RUN_STATE_VERSION; v++)
      expect(RUN_MIGRATIONS[v], `migrace v${v}`).toBeTypeOf('function');
    expect(Object.isFrozen(RUN_MIGRATIONS)).toBe(true);
    // Nový run má aktuální verzi.
    expect(makeGame().state.version).toBe(RUN_STATE_VERSION);
  });

  it('chybějící version v datech se po načtení doplní na aktuální', () => {
    const env = JSON.parse(serializeRun(makeGame().state)) as { data: Partial<RunState> };
    delete env.data.version;
    expect(deserializeRun(env).version).toBe(RUN_STATE_VERSION);
  });
});
