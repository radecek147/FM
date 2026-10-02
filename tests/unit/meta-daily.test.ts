/**
 * Denní run a seed (src/engine/meta/daily.ts): `DEN-YYYYMMDD` v UTC, balíček a síla piva ze seedu, zadání seedu,
 * série denních runů. Tutoriál Štamgast (src/engine/meta/tutorial.ts).
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import {
  DAILY_MAX_STAKE,
  SEED_ALPHABET,
  SEED_LENGTH,
  TUTORIAL_STEPS,
  createProfile,
  dailyDateKey,
  dailyKeyFromSeed,
  dailyRunSetup,
  dailySeed,
  dailySetupFromSeed,
  dailyStreak,
  isDailyAvailable,
  markTutorialStep,
  nextTutorialStep,
  parseSeedInput,
  restartTutorial,
  shouldShowTutorialStep,
  skipTutorial,
  tutorialActive,
} from '../../src/engine';
import type { DailyRecord, Profile } from '../../src/engine';

const reg = registry();

describe('dailyRunSetup', () => {
  it('seed DEN-YYYYMMDD v UTC (i pozdě večer místního času)', () => {
    expect(dailyDateKey('2026-10-01T23:59:59.000Z')).toBe('20261001');
    expect(dailyDateKey(new Date(Date.UTC(2026, 0, 5, 0, 0, 1)))).toBe('20260105');
    const setup = dailyRunSetup('2026-10-01T22:30:00.000Z', reg);
    expect(setup.seed).toBe('DEN-20261001');
    expect(setup.seed).toBe(dailySeed(new Date('2026-10-01T22:30:00.000Z')));
    expect(setup.dateKey).toBe('20261001');
  });

  it('je deterministický: stejný den = stejný balíček a síla piva', () => {
    const a = dailyRunSetup('2026-10-01T08:00:00.000Z', reg);
    const b = dailyRunSetup(new Date('2026-10-01T20:00:00.000Z'), reg);
    expect(b).toEqual(a);
    expect(dailySetupFromSeed('DEN-20261001', reg)).toEqual(a);
  });

  it('balíček z celé dvanáctky, síla piva 1–5; dny se liší', () => {
    const decks = new Set<string>();
    const stakes = new Set<number>();
    for (let d = 0; d < 60; d++) {
      const s = dailyRunSetup(new Date(Date.UTC(2026, 9, 1 + d)), reg);
      expect(reg.decks[s.deckId]).toBeDefined();
      expect(s.stake).toBeGreaterThanOrEqual(1);
      expect(s.stake).toBeLessThanOrEqual(DAILY_MAX_STAKE);
      decks.add(s.deckId);
      stakes.add(s.stake);
    }
    expect(decks.size).toBeGreaterThanOrEqual(6);
    expect(stakes.size).toBe(DAILY_MAX_STAKE);
  });

  it('neplatný seed nebo datum odmítne', () => {
    expect(() => dailySetupFromSeed('ABCD2345', reg)).toThrow();
    expect(() => dailySetupFromSeed('DEN-20260230', reg)).toThrow();
    expect(() => dailyRunSetup('včera', reg)).toThrow();
    expect(dailyKeyFromSeed('DEN-20240229')).toBe('20240229');
    expect(dailyKeyFromSeed('DEN-20250229')).toBeNull();
  });
});

describe('parseSeedInput', () => {
  it('velká písmena, mezery se ignorují', () => {
    expect(parseSeedInput(' ab cd\t23 45 ')).toEqual({ ok: true, kind: 'custom', seed: 'ABCD2345' });
    const all = SEED_ALPHABET.slice(0, SEED_LENGTH).toLowerCase();
    expect(parseSeedInput(all)).toEqual({ ok: true, kind: 'custom', seed: all.toUpperCase() });
  });

  it('abeceda bez I, O, 0, 1 a délka 8', () => {
    expect(parseSeedInput('ABCD234I')).toEqual({ ok: false, error: 'invalidChars' });
    expect(parseSeedInput('abcd234o')).toEqual({ ok: false, error: 'invalidChars' });
    expect(parseSeedInput('ABCD2340')).toEqual({ ok: false, error: 'invalidChars' });
    expect(parseSeedInput('ABCD2341')).toEqual({ ok: false, error: 'invalidChars' });
    expect(parseSeedInput('ŽLUŤOUČK')).toEqual({ ok: false, error: 'invalidChars' });
    expect(parseSeedInput('ABCD234')).toEqual({ ok: false, error: 'tooShort' });
    expect(parseSeedInput('ABCD23456')).toEqual({ ok: false, error: 'tooLong' });
    expect(parseSeedInput('')).toEqual({ ok: false, error: 'empty' });
    expect(parseSeedInput('   ')).toEqual({ ok: false, error: 'empty' });
  });

  it('seed denního runu jde zadat ručně; jiné tvary s pomlčkou ne', () => {
    expect(parseSeedInput('den-2026 10 01')).toEqual({
      ok: true,
      kind: 'daily',
      seed: 'DEN-20261001',
      dateKey: '20261001',
    });
    expect(parseSeedInput('DEN-20261332')).toEqual({ ok: false, error: 'invalidDate' });
    expect(parseSeedInput('DEN-2026101')).toEqual({ ok: false, error: 'invalidDate' });
    expect(parseSeedInput('SIM-A-1')).toEqual({ ok: false, error: 'reserved' });
    expect(parseSeedInput('ABC-2345')).toEqual({ ok: false, error: 'reserved' });
  });
});

describe('denní runy v profilu', () => {
  const rec = (seed: string): DailyRecord => ({
    seed,
    deckId: 'pub',
    stake: 1,
    status: 'finished',
    outcome: 'lost',
    ante: 3,
    bestHand: 100,
    startedAt: '',
    finishedAt: '',
  });
  const withDays = (keys: string[]): Profile => {
    const p = createProfile('2026-10-01T00:00:00.000Z');
    for (const k of keys) p.daily[k] = rec(`DEN-${k}`);
    return p;
  };

  it('oficiální pokus je jeden za den', () => {
    const p = withDays(['20261001']);
    expect(isDailyAvailable(p, '2026-10-01T18:00:00.000Z')).toBe(false);
    expect(isDailyAvailable(p, '2026-10-02T00:00:01.000Z')).toBe(true);
  });

  it('série: nejdelší a aktuální (končící dnes nebo včera), i přes konec měsíce', () => {
    const p = withDays([
      '20260927',
      '20260928',
      '20260929',
      '20260930',
      '20261001',
      '20261002',
      '20261003',
      '20261010',
    ]);
    expect(dailyStreak(p).longest).toBe(7);
    expect(dailyStreak(p, '2026-10-10T12:00:00.000Z').current).toBe(1);
    expect(dailyStreak(p, '2026-10-11T12:00:00.000Z').current).toBe(1);
    expect(dailyStreak(p, '2026-10-12T12:00:00.000Z').current).toBe(0);
    expect(dailyStreak(p, '2026-10-04T12:00:00.000Z').current).toBe(7);
    expect(dailyStreak(withDays([])).longest).toBe(0);
  });
});

describe('tutoriál Štamgast', () => {
  it('prochází kroky (i mimo pořadí) a na konci je dokončený', () => {
    const p = createProfile('2026-10-01T00:00:00.000Z');
    expect(tutorialActive(p)).toBe(true);
    expect(nextTutorialStep(p)).toBe('select');
    expect(markTutorialStep(p, 'boss')).toBe(false);
    expect(nextTutorialStep(p)).toBe('select');
    expect(shouldShowTutorialStep(p, 'boss')).toBe(false);
    for (const s of TUTORIAL_STEPS.filter((x) => x !== 'skip')) expect(markTutorialStep(p, s)).toBe(false);
    expect(p.tutorial.step).toBe(TUTORIAL_STEPS.indexOf('skip'));
    expect(markTutorialStep(p, 'skip')).toBe(true);
    expect(p.tutorial.completed).toBe(true);
    expect(tutorialActive(p)).toBe(false);
    expect(nextTutorialStep(p)).toBeNull();
    expect(markTutorialStep(p, 'skip')).toBe(false);
  });

  it('přeskočení vypne rady, znovuzapnutí začne od začátku', () => {
    const p = createProfile('2026-10-01T00:00:00.000Z');
    markTutorialStep(p, 'select');
    skipTutorial(p);
    expect(p.settings.tutorial).toBe(false);
    expect(tutorialActive(p)).toBe(false);
    restartTutorial(p);
    expect(p.settings.tutorial).toBe(true);
    expect(p.tutorial).toEqual({ step: 0, seen: [], completed: false, skipped: false });
    expect(nextTutorialStep(p)).toBe('select');
    // vypnuté rady v nastavení = tutoriál neběží
    p.settings.tutorial = false;
    expect(nextTutorialStep(p)).toBeNull();
  });
});
