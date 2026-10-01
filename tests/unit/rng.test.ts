import { describe, expect, it } from 'vitest';
import {
  RNG_STREAMS,
  createRngStates,
  cyrb128,
  dailySeed,
  generateSeed,
  rngFromState,
} from '../../src/engine/rng/rng';
import type { RngState } from '../../src/engine/types';

function sequence(state: RngState, n: number): number[] {
  const rng = rngFromState(state);
  return Array.from({ length: n }, () => rng.next());
}

describe('cyrb128', () => {
  it('je deterministický a vrací 4 × uint32 (ne samé nuly)', () => {
    const a = cyrb128('KARBAN');
    expect(a).toEqual(cyrb128('KARBAN'));
    expect(a).toHaveLength(4);
    for (const x of a) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2 ** 32);
    }
    expect(a.some((x) => x !== 0)).toBe(true);
    expect(cyrb128('KARBAN')).not.toEqual(cyrb128('KARBAM'));
  });
});

describe('rngFromState — determinismus', () => {
  it('stejný seed dá stejnou sekvenci', () => {
    const a = createRngStates('ABCD1234');
    const b = createRngStates('ABCD1234');
    expect(sequence(a.deck, 100)).toEqual(sequence(b.deck, 100));
  });

  it('různé seedy dají různé sekvence', () => {
    const a = createRngStates('ABCD1234');
    const b = createRngStates('ABCD1235');
    expect(sequence(a.deck, 20)).not.toEqual(sequence(b.deck, 20));
  });

  it('různé streamy téhož seedu jsou různé', () => {
    const states = createRngStates('ABCD1234');
    expect(Object.keys(states).sort()).toEqual([...RNG_STREAMS].sort());
    const firsts = RNG_STREAMS.map((name) => sequence(states[name], 5).join(','));
    expect(new Set(firsts).size).toBe(RNG_STREAMS.length);
  });

  it('čerpání jednoho streamu neovlivní jiný', () => {
    const a = createRngStates('SEED');
    const b = createRngStates('SEED');
    sequence(a.shop, 50); // přehazování obchodu…
    expect(sequence(a.deck, 10)).toEqual(sequence(b.deck, 10)); // …nezmění míchání balíčku
  });

  it('next() je v [0, 1)', () => {
    const rng = rngFromState(cyrb128('range'));
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('Rng API', () => {
  it('int(min, max) je v mezích včetně a pokryje všechny hodnoty', () => {
    const rng = rngFromState(cyrb128('int'));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = rng.int(3, 8);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(8);
      seen.add(x);
    }
    expect([...seen].sort((p, q) => p - q)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(rng.int(5, 5)).toBe(5);
    expect(() => rng.int(5, 4)).toThrow();
  });

  it('pick vybere prvek pole, prázdné pole vyhodí chybu', () => {
    const rng = rngFromState(cyrb128('pick'));
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle je permutace (na místě) a je deterministický', () => {
    const original = Array.from({ length: 52 }, (_, i) => i);
    const arr = [...original];
    const result = rngFromState(cyrb128('shuffle')).shuffle(arr);
    expect(result).toBe(arr);
    expect([...arr].sort((p, q) => p - q)).toEqual(original);
    expect(arr).not.toEqual(original);
    const again = rngFromState(cyrb128('shuffle')).shuffle([...original]);
    expect(again).toEqual(arr);
  });

  it('weighted nikdy nevybere položku s nulovou (nebo zápornou) váhou', () => {
    const rng = rngFromState(cyrb128('weighted'));
    const items = [
      { item: 'nikdy', weight: 0 },
      { item: 'často', weight: 9 },
      { item: 'záporná', weight: -5 },
      { item: 'občas', weight: 1 },
    ];
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) {
      const x = rng.weighted(items);
      counts[x] = (counts[x] ?? 0) + 1;
    }
    expect(counts['nikdy']).toBeUndefined();
    expect(counts['záporná']).toBeUndefined();
    expect(counts['často']).toBeGreaterThan(counts['občas'] ?? 0);
    expect(() => rng.weighted([{ item: 'x', weight: 0 }])).toThrow();
    expect(() => rng.weighted([])).toThrow();
  });

  it('chance respektuje krajní hodnoty', () => {
    const rng = rngFromState(cyrb128('chance'));
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe('stav RNG ve stavu runu', () => {
  it('rngFromState mutuje předané pole na místě', () => {
    const state = cyrb128('mutate');
    const before = [...state];
    rngFromState(state).next();
    expect(state).not.toEqual(before);
  });

  it('pokračování po JSON roundtripu dá stejnou sekvenci', () => {
    const states = createRngStates('ROUNDTRIP');
    const live = rngFromState(states.deck);
    for (let i = 0; i < 37; i++) live.next();

    const saved = JSON.parse(JSON.stringify(states)) as typeof states;
    const restored = rngFromState(saved.deck);

    const fromLive = Array.from({ length: 20 }, () => live.next());
    const fromRestored = Array.from({ length: 20 }, () => restored.next());
    expect(fromRestored).toEqual(fromLive);
  });
});

describe('seedy', () => {
  it('dailySeed má formát DEN-YYYYMMDD v UTC', () => {
    expect(dailySeed(new Date(Date.UTC(2026, 9, 1, 12)))).toBe('DEN-20261001');
    expect(dailySeed(new Date(Date.UTC(2026, 0, 5, 23, 59)))).toBe('DEN-20260105');
    expect(dailySeed(new Date(Date.UTC(2027, 11, 31, 0, 0)))).toBe('DEN-20271231');
    expect(dailySeed(new Date())).toMatch(/^DEN-\d{8}$/);
  });

  it('generateSeed vrací 8 znaků bez zaměnitelných znaků', () => {
    const rng = rngFromState(cyrb128('seed'));
    for (let i = 0; i < 50; i++) {
      const seed = generateSeed(() => rng.next());
      expect(seed).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });
});
