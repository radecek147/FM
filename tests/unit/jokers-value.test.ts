/**
 * Měření hodnoty žolíků (scripts/joker-value.ts, docs/DESIGN.md 4.2–4.3): projekce na referenční ruce R1/R2,
 * izolovaný efekt, hodnocení podle pásem a kouřové měření na skutečném obsahu (malé počty seedů).
 */
import { describe, expect, it } from 'vitest';
import {
  BANDS,
  botFor,
  DEFAULT_OPTIONS,
  effectOf,
  measureJoker,
  parseOptions,
  projectValue,
  R2_ROUNDS_HELD,
  REFERENCE,
  reportText,
  verdict,
  type BaseCache,
  type JokerValue,
  type WindowValue,
} from '../../scripts/joker-value';
import { buildRegistry } from '../../src/content/index';
import type { ScoreResult } from '../../src/engine/types';

const reg = buildRegistry();
const opts = { ...DEFAULT_OPTIONS, runs: 3, seedPrefix: 'TEST' };

const score = (chips: number, mult: number): ScoreResult =>
  ({ chips, mult, score: Math.floor(chips * mult) }) as ScoreResult;

function windowOf(avg: number | null, peak = avg): WindowValue {
  return {
    hands: avg === null ? 0 : 10,
    avg,
    peak,
    max: peak,
    fired: avg ? 1 : 0,
    effect: { chips: 0, mult: 0, xmult: 1 },
  };
}

function fake(v: Partial<JokerValue> & Pick<JokerValue, 'rarity'>): JokerValue {
  return {
    id: 'fake',
    tags: [],
    bot: 'max',
    buyAnte: 1,
    realMode: false,
    r1: windowOf(null),
    r2: windowOf(null),
    real: null,
    money: null,
    sim: {
      runs: 0,
      anteWith: 0,
      anteWithout: 0,
      roundsWith: 0,
      roundsWithout: 0,
      winsWith: 0,
      winsWithout: 0,
    },
    ...v,
  };
}

describe('hodnota žolíků – projekce na referenční ruce (DESIGN 4.2)', () => {
  it('ukázky z DESIGN 4.3: Pivní tácek, Srdcař (2,5 ♥ na ruku), Zpožděný rychlík (×1,5 s šancí 5/6)', () => {
    expect(REFERENCE).toEqual({ r1: { chips: 60, mult: 8 }, r2: { chips: 200, mult: 40 } });
    expect(projectValue(REFERENCE.r1, { chips: 10, mult: 2, xmult: 1 })).toBeCloseTo(45.83, 2);
    expect(projectValue(REFERENCE.r2, { chips: 10, mult: 2, xmult: 1 })).toBeCloseTo(10.25, 2);
    expect(projectValue(REFERENCE.r1, { chips: 12.5, mult: 5, xmult: 1 })).toBeCloseTo(96.35, 2);
    const train = 1 + (0.5 * 5) / 6;
    expect(projectValue(REFERENCE.r1, { chips: 0, mult: 0, xmult: train })).toBeCloseTo(41.67, 2);
    expect(projectValue(REFERENCE.r2, { chips: 0, mult: 0, xmult: train })).toBeCloseTo(41.67, 2);
  });

  it('izolovaný efekt: ×mult u žolíků se štítkem xmult, jinak Δmult; čipy vždy jako rozdíl', () => {
    const mat = reg.jokers.beer_mat!;
    const train = reg.jokers.late_train!;
    expect(effectOf(mat, score(30, 2), score(40, 4))).toEqual({ chips: 10, mult: 2, xmult: 1 });
    expect(effectOf(train, score(30, 2), score(30, 3))).toEqual({ chips: 0, mult: 0, xmult: 1.5 });
    // Bez žolíka nešlo zahrát nic (jen karty, které přinesl): celé čipy ruky jsou jeho.
    expect(effectOf(mat, null, score(50, 1))).toEqual({ chips: 50, mult: 0, xmult: 1 });
  });

  it('pásma podle vzácnosti (DESIGN 4.3)', () => {
    expect(BANDS.common).toEqual({ r1: [35, 100], r2: [8, 30], money: [2, 3], sim: [2, 6] });
    expect(BANDS.rare.r2).toEqual([20, 60]);
    expect(BANDS.epic.r1).toEqual([80, 180]);
    expect(BANDS.legendary.money).toBeNull();
  });
});

describe('hodnota žolíků – hodnocení podle pravidel 1–3 a ekonomiky', () => {
  it('stačí dolní hranice v jednom okně; horní hranici nesmí překročit žádné okno', () => {
    expect(verdict(fake({ rarity: 'common', r1: windowOf(20), r2: windowOf(10) })).kind).toBe('ok');
    expect(verdict(fake({ rarity: 'common', r1: windowOf(40), r2: windowOf(5) })).kind).toBe('ok');
    expect(verdict(fake({ rarity: 'common', r1: windowOf(20), r2: windowOf(5) })).kind).toBe('low');
    expect(verdict(fake({ rarity: 'common', r1: windowOf(120), r2: windowOf(10) })).kind).toBe('high');
    expect(verdict(fake({ rarity: 'rare', r1: windowOf(60), r2: windowOf(70) })).kind).toBe('high');
  });

  it('špička: 95. percentil rukou okna R2 nejvýš 2× horní hranice R2 (v R1 se nehodnotí)', () => {
    expect(verdict(fake({ rarity: 'common', r1: windowOf(50, 250), r2: windowOf(10, 50) })).kind).toBe('ok');
    expect(verdict(fake({ rarity: 'common', r1: windowOf(50), r2: windowOf(10, 61) })).kind).toBe('peak');
  });

  it('ekonomický žolík podle Kč/kolo, užitkový jen simulací', () => {
    const money = (all: number) => ({ all, r1: all, rounds: 10 });
    expect(verdict(fake({ rarity: 'common', money: money(2.4) }))).toEqual({ kind: 'ok', basis: 'money' });
    expect(verdict(fake({ rarity: 'common', money: money(1.1) })).kind).toBe('low');
    expect(verdict(fake({ rarity: 'common', money: money(3.5) })).kind).toBe('high');
    expect(verdict(fake({ rarity: 'common', r1: windowOf(0), r2: windowOf(0) }))).toEqual({
      kind: 'na',
      basis: 'sim',
    });
  });

  it('bot „vhodné strategie“ podle štítků a params', () => {
    expect(botFor(reg.jokers.hearts_man!)).toBe('flush');
    expect(botFor(reg.jokers.party_for_two!)).toBe('pairs');
    expect(botFor(reg.jokers.beer_mat!)).toBe('max');
    expect(botFor(reg.jokers.carousel!)).toBe('max');
  });

  it('volby příkazové řádky', () => {
    const p = parseOptions(['--runs', '7', '--joker', 'beer_mat, echo', '--bot', 'pairs', '--json']);
    expect(p.opts.runs).toBe(7);
    expect(p.opts.bot).toBe('pairs');
    expect(p.jokers).toEqual(['beer_mat', 'echo']);
    expect(p.json).toBe('-');
    expect(parseOptions([]).opts).toEqual(DEFAULT_OPTIONS);
    expect(() => parseOptions(['--runs', '0'])).toThrow();
  });
});

// Celé runy botů (se spotřebkami a od fáze 5 delší — snazší křivka cílů): víc než výchozích 5 s.
describe('hodnota žolíků – měření na skutečném obsahu (kouřový test)', { timeout: 60_000 }, () => {
  const cache: BaseCache = new Map();

  it('Pivní tácek: každá ruka přesně +10 čipů a +2 mult → R1 +45,8 %, R2 +10,4 %; měření je deterministické', () => {
    const v = measureJoker(reg, 'beer_mat', opts, cache);
    expect(v.r1.hands).toBeGreaterThan(0);
    expect(v.r1.avg).toBeCloseTo(45.83, 1);
    expect(v.r2.avg).toBeCloseTo(10.4, 1);
    expect(v.r1.fired).toBe(1);
    expect(v.r1.effect).toEqual({ chips: 10, mult: 2, xmult: 1 });
    expect(v.sim.runs).toBe(3);
    expect(verdict(v).kind).toBe('ok');
    expect(measureJoker(reg, 'beer_mat', opts, new Map())).toEqual(v);
  });

  it('škálující žolík (Stálý host): koupě v patře 2, v R2 stav po 16 kolech = +16 mult', () => {
    const v = measureJoker(reg, 'regular', opts, cache);
    expect(v.buyAnte).toBe(2);
    expect(v.r2.hands).toBeGreaterThan(0);
    // Δmult se měří proti nejlepšímu tahu bez žolíka — bez +16 mult bot občas zahraje jinou kombinaci (jiný základní
    // mult). S dvojnásobnými přírůstky úrovní (fáze 10) se základní mult kombinací na úrovni R2 liší víc, takže průměr
    // vychází pod +16 (3 seedy: ~8,7); stav žolíka po 16 kolech je ale +16 a víc nedá.
    expect(v.r2.effect.mult).toBeGreaterThan(R2_ROUNDS_HELD / 2);
    expect(v.r2.effect.mult).toBeLessThanOrEqual(R2_ROUNDS_HELD + 0.5);
  });

  it('ekonomický žolík (Pokladnička) se měří v Kč za kolo', () => {
    const v = measureJoker(reg, 'piggy_bank', opts, cache);
    expect(v.money).not.toBeNull();
    expect(v.money!.all).toBeGreaterThanOrEqual(2);
    expect(verdict(v).basis).toBe('money');
  });

  it('kopírující žolík se měří na skutečné sestavě; výstup je česky', () => {
    const v = measureJoker(reg, 'impersonator', opts, cache);
    expect(v.realMode).toBe(true);
    const text = reportText([v], opts).join('\n');
    expect(text).toContain('Napodobitel');
    expect(text).toContain('skutečná sestava');
  });
});
