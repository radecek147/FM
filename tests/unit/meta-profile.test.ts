/**
 * Profil hráče (src/engine/meta/profile.ts): založení, obálka, migrace (vč. starého `karban.settings`),
 * roundtrip, oprava poškozených polí a tolerantní obnova.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import {
  DEFAULT_SETTINGS,
  Game,
  HISTORY_LIMIT,
  PROFILE_VERSION,
  SAVE_FORMAT,
  SaveError,
  applyRunEvents,
  createProfile,
  deserializeProfile,
  finishRun,
  migrateProfile,
  normalizeProfile,
  restoreProfile,
  serializeProfile,
  serializeRun,
  startRun,
} from '../../src/engine';
import type { Profile } from '../../src/engine';

const NOW = '2026-10-02T10:00:00.000Z';

function envelope(data: unknown, version = PROFILE_VERSION, kind = 'profile'): string {
  return JSON.stringify({ format: SAVE_FORMAT, kind, version, savedAt: NOW, data });
}

function saveError(fn: () => unknown): SaveError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SaveError) return e;
    throw e;
  }
  throw new Error('expected SaveError');
}

/** Profil s trochou dat z opravdového runu (statistiky, objevy, historie). */
function playedProfile(): Profile {
  const reg = registry();
  const profile = createProfile(NOW);
  const game = Game.newRun({ seed: 'ABCD2345', deckId: 'pub', stake: 1 }, reg);
  const ctx = { registry: reg, nowIso: NOW };
  startRun(profile, game.state, ctx);
  const sel = game.dispatch({ type: 'selectBlind' });
  if (!sel.ok) throw new Error(sel.error);
  applyRunEvents(profile, sel.events, game.state, ctx);
  const hand = game.state.round!.hand.slice(0, 5);
  const play = game.dispatch({ type: 'play', cardIds: hand });
  if (!play.ok) throw new Error(play.error);
  applyRunEvents(profile, play.events, game.state, ctx);
  finishRun(profile, game.state, ctx);
  return profile;
}

describe('createProfile', () => {
  it('založí prázdný profil s výchozím nastavením', () => {
    const p = createProfile(NOW);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.createdAt).toBe(NOW);
    expect(p.settings).toEqual(DEFAULT_SETTINGS);
    expect(p.stats.runs).toEqual({
      played: 0,
      won: 0,
      lost: 0,
      abandoned: 0,
      currentStreak: 0,
      bestStreak: 0,
    });
    expect(p.stats.totals.handsPlayed).toBe(0);
    expect(p.history).toEqual([]);
    expect(p.current).toBeNull();
    expect(p.nextRunNo).toBe(1);
    expect(p.tutorial).toEqual({ step: 0, seen: [], completed: false, skipped: false });
    expect(p.unlocks).toEqual({ decks: [], stakes: {}, jokers: [], vouchers: [], challenges: [] });
  });

  it('převezme nastavení libovolného tvaru přes sanitizeSettings', () => {
    const p = createProfile(NOW, { animations: false, speed: 9, junk: 1 });
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, animations: false, speed: 4 });
  });

  it('je čistě JSON-serializovatelný', () => {
    const p = playedProfile();
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('serializeProfile / deserializeProfile', () => {
  it('roundtrip zachová celý profil (i po odehraném runu)', () => {
    const p = playedProfile();
    expect(p.history).toHaveLength(1);
    expect(p.stats.totals.handsPlayed).toBe(1);
    const text = serializeProfile(p, NOW);
    const env = JSON.parse(text) as { format: string; kind: string; version: number; savedAt: string };
    expect(env).toMatchObject({
      format: SAVE_FORMAT,
      kind: 'profile',
      version: PROFILE_VERSION,
      savedAt: NOW,
    });
    expect(deserializeProfile(text)).toEqual(p);
    // i z objektu (ne řetězce) a bez změny vstupu
    const obj = JSON.parse(text) as unknown;
    const before = JSON.stringify(obj);
    expect(deserializeProfile(obj)).toEqual(p);
    expect(JSON.stringify(obj)).toBe(before);
  });

  it('odmítne poškozená a cizí data se SaveError', () => {
    expect(saveError(() => deserializeProfile('{nope')).code).toBe('invalidJson');
    expect(saveError(() => deserializeProfile('[1,2]')).code).toBe('invalidFormat');
    expect(saveError(() => deserializeProfile(JSON.stringify({ hello: 1 }))).code).toBe('invalidFormat');
    expect(saveError(() => deserializeProfile(envelope({}, 0))).code).toBe('invalidFormat');
    expect(saveError(() => deserializeProfile(envelope('x'))).code).toBe('invalidFormat');
    expect(saveError(() => deserializeProfile(envelope({}, PROFILE_VERSION + 1))).code).toBe('tooNew');
    const game = Game.newRun({ seed: 'ABCD2345', deckId: 'pub', stake: 1 }, registry());
    expect(saveError(() => deserializeProfile(serializeRun(game.state, NOW))).code).toBe('wrongKind');
  });
});

describe('migrace profilu', () => {
  const v1 = (): Record<string, unknown> => ({
    ...JSON.parse(JSON.stringify(createProfile(NOW))),
    legacyWins: 4,
  });
  // Testovací migrace v1 → v2: přejmenuje pole (skutečné migrace se píšou stejně).
  const migrations = {
    1: (d: Record<string, unknown>) => {
      const { legacyWins, ...rest } = d;
      const stats = rest.stats as { runs: { won: number } };
      stats.runs.won = Number(legacyWins);
      return rest;
    },
  };

  it('aplikuje migrace postupně a výsledek opraví', () => {
    const p = migrateProfile(v1(), 1, { migrations, currentVersion: 2 });
    expect(p.stats.runs.won).toBe(4);
    expect((p as unknown as Record<string, unknown>).legacyWins).toBeUndefined();
    // obálka se starší verzí projde migracemi i přes deserializeProfile
    const q = deserializeProfile(envelope(v1(), 1), { migrations, currentVersion: 2 });
    expect(q.stats.runs.won).toBe(4);
  });

  it('chybějící nebo rozbitá migrace = migrationFailed, novější verze = tooNew', () => {
    expect(saveError(() => migrateProfile(v1(), 1, { migrations: {}, currentVersion: 2 })).code).toBe(
      'migrationFailed',
    );
    const broken = {
      1: () => {
        throw new Error('boom');
      },
    };
    expect(saveError(() => migrateProfile(v1(), 1, { migrations: broken, currentVersion: 2 })).code).toBe(
      'migrationFailed',
    );
    const notObject = { 1: () => null as unknown as Record<string, unknown> };
    expect(saveError(() => migrateProfile(v1(), 1, { migrations: notObject, currentVersion: 2 })).code).toBe(
      'migrationFailed',
    );
    expect(saveError(() => migrateProfile(v1(), 3, { currentVersion: 2 })).code).toBe('tooNew');
  });

  it('migrace nemění vstup', () => {
    const data = v1();
    const before = JSON.stringify(data);
    migrateProfile(data, 1, { migrations, currentVersion: 2 });
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('normalizeProfile (oprava poškozených polí)', () => {
  it('neplatné hodnoty nahradí výchozími a zahodí neplatné položky', () => {
    const p = playedProfile();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    raw.settings = { speed: 99, uiScale: 'x', animations: 'yes' };
    raw.stats.totals.handsPlayed = 'many';
    raw.stats.totals.jokersSold = -5;
    raw.stats.handTypes = { pair: 3, bogus: 7, flush: 'x' };
    raw.stats.byDeck = { pub: { played: 2, won: 'x', bestStake: 3 }, junk: 5 };
    raw.unlocks = {
      decks: ['court', 7, 'court'],
      stakes: { pub: 99, regulars: 0, bad: 'x' },
      jokers: 'nope',
    };
    raw.discovered = { jokers: ['a', null, 'a'], bosses: 'x' };
    raw.history = [...raw.history, { nope: true }, 42];
    raw.daily = { '20261001': { seed: 'DEN-20261001', ante: 3 }, bad: { seed: 'x' }, '20261002': 5 };
    raw.achievements = { unlocked: { a: NOW, b: 3 }, progress: { c: 2, d: 'x' } };
    raw.current = { seed: 5 };
    raw.nextRunNo = -1;
    const n = normalizeProfile(raw);
    expect(n.settings).toEqual({ ...DEFAULT_SETTINGS, speed: 4 });
    expect(n.stats.totals.handsPlayed).toBe(0);
    expect(n.stats.totals.jokersSold).toBe(0);
    expect(n.stats.handTypes).toEqual({ pair: 3 });
    expect(n.stats.byDeck).toEqual({ pub: { played: 2, won: 0, bestStake: 3 } });
    expect(n.unlocks.decks).toEqual(['court']);
    expect(n.unlocks.stakes).toEqual({ pub: 8, regulars: 1 });
    expect(n.unlocks.jokers).toEqual([]);
    expect(n.discovered.jokers).toEqual(['a']);
    expect(n.discovered.bosses).toEqual([]);
    expect(n.history).toHaveLength(1);
    expect(Object.keys(n.daily)).toEqual(['20261001']);
    expect(n.daily['20261001']).toMatchObject({ seed: 'DEN-20261001', ante: 3, status: 'finished' });
    expect(n.achievements).toEqual({ unlocked: { a: NOW }, progress: { c: 2 } });
    expect(n.current).toBeNull();
    expect(n.nextRunNo).toBe(2);
  });

  it('z čehokoli udělá platný profil a historii ořízne na limit', () => {
    expect(normalizeProfile(null).stats.runs.played).toBe(0);
    const history = Array.from({ length: HISTORY_LIMIT + 7 }, (_, i) => ({
      seed: `S${i}`,
      deckId: 'pub',
      no: i + 1,
    }));
    const n = normalizeProfile({ history });
    expect(n.history).toHaveLength(HISTORY_LIMIT);
    expect(n.nextRunNo).toBe(HISTORY_LIMIT + 1);
    expect(n.history[0]).toMatchObject({
      seed: 'S0',
      outcome: 'abandoned',
      mode: 'normal',
      stake: 1,
      ante: 1,
    });
  });

  it('platná obálka s poškozenými poli se načte (opraví), ne zahodí', () => {
    const p = playedProfile();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    raw.stats = 'broken';
    const loaded = deserializeProfile(envelope(raw));
    expect(loaded.history).toEqual(p.history);
    expect(loaded.stats.runs.played).toBe(0);
  });
});

describe('restoreProfile', () => {
  it('bez profilu založí nový; se starým karban.settings převezme nastavení', () => {
    expect(restoreProfile({ raw: null, nowIso: NOW })).toMatchObject({ status: 'created' });
    const legacy = restoreProfile({
      raw: null,
      legacySettings: JSON.stringify({ animations: false }),
      nowIso: NOW,
    });
    expect(legacy.status).toBe('legacy');
    expect(legacy.profile.settings).toEqual({ ...DEFAULT_SETTINGS, animations: false });
    expect(legacy.profile.createdAt).toBe(NOW);
    // nečitelné staré nastavení = výchozí
    const bad = restoreProfile({ raw: '', legacySettings: '{oops', nowIso: NOW });
    expect(bad.status).toBe('created');
    expect(bad.profile.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('platný profil načte (staré nastavení ignoruje)', () => {
    const p = playedProfile();
    const res = restoreProfile({
      raw: serializeProfile(p, NOW),
      legacySettings: JSON.stringify({ animations: false }),
      nowIso: NOW,
    });
    expect(res.status).toBe('loaded');
    expect(res.profile).toEqual(p);
    expect(res.backup).toBeUndefined();
  });

  it('poškozený nebo novější profil: nový profil + původní data k záloze', () => {
    const corrupt = restoreProfile({
      raw: '{broken',
      legacySettings: JSON.stringify({ speed: 2 }),
      nowIso: NOW,
    });
    expect(corrupt).toMatchObject({ status: 'corrupt', error: 'invalidJson', backup: '{broken' });
    expect(corrupt.profile.settings.speed).toBe(2);
    const newer = envelope({}, PROFILE_VERSION + 5);
    expect(restoreProfile({ raw: newer, nowIso: NOW })).toMatchObject({
      status: 'corrupt',
      error: 'tooNew',
      backup: newer,
    });
  });
});
