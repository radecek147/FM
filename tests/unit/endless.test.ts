/**
 * Nekonečný režim se skutečným obsahem hry (docs/DESIGN.md kap. 1.3 a 2.3.3): cíle pater 9–24 pro všechny tři
 * křivky, průchod patry 9–24 po výhře (finálový šéf v patrech 16 a 24, jinde běžní šéfové, porážka už není výhra),
 * přetečení cíle i skóre na `Number.MAX_VALUE` (≈ patro 210) a jeho zobrazení jako „∞“, uložení a načtení.
 * Základní tabulka pater 9–16 je i v tests/unit/targets.test.ts, zrychlený průchod s testovacím obsahem
 * v tests/unit/game.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import type { ContentRegistry } from '../../src/engine/content-types';
import { FINAL_ANTE } from '../../src/engine/constants';
import {
  anteBase,
  blindTarget,
  ENDLESS_GROWTH_BASE,
  ENDLESS_GROWTH_STEP,
  niceRound,
  TARGET_CURVES,
} from '../../src/engine/run/targets';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import type { BlindKind, GameEvent, RunState } from '../../src/engine/types';
import { formatNumber } from '../../src/i18n/format';
import { addJokers, joker, play, selectBoss } from './fixtures/registry';

const reg = buildRegistry();

/** Patro, od kterého se cíl (i Malé útraty) přestane vejít do konečného čísla — ve všech křivkách. */
const OVERFLOW_ANTE = 210;

// [patro, křivka 1: malá, velká, šéf, křivka 2: malá, velká, šéf, křivka 3: malá, velká, šéf]
// Přepočítáno nezávisle podle vzorce DESIGN 1.3: base(a) = nice(base(8) × g(a)^(a − 8)), g(a) = 2,2 + 0,15 × (a − 9).
type Row = [number, number, number, number, number, number, number, number, number, number];
const ROWS: Row[] = [
  [9, 210e3, 320e3, 420e3, 240e3, 360e3, 480e3, 250e3, 380e3, 500e3],
  [10, 520e3, 780e3, 1.05e6, 610e3, 920e3, 1.2e6, 640e3, 960e3, 1.3e6],
  [11, 1.5e6, 2.3e6, 3e6, 1.7e6, 2.6e6, 3.4e6, 1.8e6, 2.7e6, 3.6e6],
  [12, 4.7e6, 7.1e6, 9.4e6, 5.4e6, 8.1e6, 11e6, 5.7e6, 8.6e6, 11.5e6],
  [13, 16.5e6, 25e6, 33e6, 19e6, 29e6, 38e6, 20e6, 30e6, 40e6],
  [14, 63e6, 95e6, 125e6, 72e6, 110e6, 145e6, 76e6, 115e6, 150e6],
  [15, 260e6, 390e6, 520e6, 300e6, 450e6, 600e6, 320e6, 480e6, 640e6],
  [16, 1.2e9, 1.8e9, 2.4e9, 1.35e9, 2e9, 2.7e9, 1.45e9, 2.2e9, 2.9e9],
  [17, 5.8e9, 8.7e9, 11.5e9, 6.7e9, 10e9, 13.5e9, 7e9, 10.5e9, 14e9],
  [18, 30e9, 45e9, 60e9, 35e9, 53e9, 70e9, 37e9, 56e9, 74e9],
  [19, 170e9, 260e9, 340e9, 195e9, 290e9, 390e9, 200e9, 300e9, 400e9],
  [20, 1000e9, 1500e9, 2000e9, 1150e9, 1750e9, 2300e9, 1200e9, 1800e9, 2400e9],
];

describe('nekonečný režim – cíle pater 9–20 (DESIGN 1.3, 2.3.3)', () => {
  it.each(ROWS)('patro %d', (ante, ...targets) => {
    for (const curve of [1, 2, 3]) {
      const [small, big, boss] = targets.slice((curve - 1) * 3, curve * 3);
      expect(anteBase(ante, curve), `křivka ${curve}`).toBe(small);
      expect(blindTarget(ante, 'small', curve), `křivka ${curve} malá`).toBe(small);
      expect(blindTarget(ante, 'big', curve), `křivka ${curve} velká`).toBe(big);
      expect(blindTarget(ante, 'boss', curve), `křivka ${curve} šéf`).toBe(boss);
    }
  });

  it('základ je nice(base(8) × g(a)^(a − 8)) a poměr mezi patry roste (nadexponenciální růst)', () => {
    expect([ENDLESS_GROWTH_BASE, ENDLESS_GROWTH_STEP]).toEqual([2.2, 0.15]);
    for (const curve of [1, 2, 3]) {
      const base8 = TARGET_CURVES[curve - 1]![7]!;
      let prevRatio = 0;
      for (let ante = 9; ante <= 40; ante++) {
        const g = 2.2 + 0.15 * (ante - 9);
        expect(anteBase(ante, curve)).toBe(niceRound(base8 * g ** (ante - 8)));
        // Poměr sousedních pater (bez zaokrouhlení) roste: ×2,2 v patře 9, ×4,5 kolem patra 16.
        const ratio = g ** (ante - 8) / (ante === 9 ? 1 : (g - 0.15) ** (ante - 9));
        expect(ratio).toBeGreaterThan(prevRatio);
        prevRatio = ratio;
      }
    }
  });

  it('orientační čísla z DESIGN 2.3.3 (křivka 1): patro 24 ≈ 2,2e15, 32 ≈ 1,05e23, 40 ≈ 5,2e31', () => {
    expect(anteBase(24, 1)).toBe(2.2e15);
    expect(anteBase(32, 1)).toBe(1.05e23);
    expect(anteBase(40, 1)).toBe(5.2e31);
    // Od 1e15 vědecký zápis s čárkou.
    expect(formatNumber(blindTarget(24, 'boss', 1))).toBe('4,4e15');
    expect(formatNumber(anteBase(32, 1))).toBe('1,05e23');
  });
});

// ─────────────────────────── Průchod patry se skutečným obsahem ───────────────────────────

/** Vyhraje vybranou útratu: vypne pravidlo šéfa, nastaví cíl 1 a zahraje jednu kartu. */
function winSelected(g: Game): GameEvent[] {
  g._core.api.disableBoss();
  g._core.state.round!.target = 1;
  const res = g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
  if (!res.ok) throw new Error(`play: ${res.error}`);
  return res.events;
}

/** Run Hospodského balíčku dovedený do výhry v patře 8 (finálový šéf) a pokračování v nekonečném režimu. */
function endlessGame(seed: string, stake = 1, registry: ContentRegistry = reg): Game {
  const g = Game.newRun({ seed, deckId: 'pub', stake }, registry);
  g._core.api.changeAnte(FINAL_ANTE - 1);
  expect(g.state.ante).toBe(FINAL_ANTE);
  const finalBoss = g.state.blinds[2]!.bossId!;
  expect(reg.bosses[finalBoss]!.final).toBe(true);
  selectBoss(g, finalBoss);
  const events = winSelected(g);
  expect(events).toContainEqual({ type: 'victory', ante: FINAL_ANTE });
  expect(g.state.phase).toBe('victory');
  const cont = g.dispatch({ type: 'continueEndless' });
  expect(cont.ok).toBe(true);
  expect(g.state.endless).toBe(true);
  g.dispatch({ type: 'cashOut' });
  g.dispatch({ type: 'leaveShop' });
  expect([g.state.phase, g.state.ante]).toEqual(['blind_select', FINAL_ANTE + 1]);
  return g;
}

describe('nekonečný režim – průchod patry 9–24 se skutečným obsahem', () => {
  it('cíle podle křivky, finálový šéf jen v patrech 16 a 24, porážka šéfa už není výhra', () => {
    const g = endlessGame('ENDLESSWALK');
    const bosses: { ante: number; id: string; final: boolean }[] = [];
    for (let ante = 9; ante <= 24; ante++) {
      expect(g.state.ante).toBe(ante);
      for (const kind of ['small', 'big', 'boss'] as BlindKind[]) {
        expect(g.state.phase).toBe('blind_select');
        const sel = g.dispatch({ type: 'selectBlind' });
        expect(sel.ok, `${ante} ${kind}`).toBe(true);
        const round = g.state.round!;
        expect(round.blind).toBe(kind);
        const boss = round.bossId ? reg.bosses[round.bossId]! : null;
        const expected = blindTarget(ante, kind, 1, {
          bossMult: kind === 'boss' ? boss?.targetMult : undefined,
        });
        expect(round.target, `${ante} ${kind}`).toBe(expected);
        if (kind === 'small') expect(round.target).toBe(anteBase(ante, 1));
        if (kind === 'boss') bosses.push({ ante, id: round.bossId!, final: boss!.final === true });
        const events = winSelected(g);
        expect(events.some((e) => e.type === 'victory')).toBe(false);
        expect(g.state.phase).toBe('round_end');
        g.dispatch({ type: 'cashOut' });
        g.dispatch({ type: 'leaveShop' });
      }
    }
    expect(bosses.filter((b) => b.final).map((b) => b.ante)).toEqual([16, 24]);
    // Běžní šéfové respektují `minAnte` a v patrech mimo násobky 8 nikdy není finálový.
    for (const b of bosses) expect((reg.bosses[b.id]!.minAnte ?? 1) <= b.ante).toBe(true);
    expect(g.state.ante).toBe(25);
    expect(g.state.stats.bossesDefeated).toBe(17);
    expect(g.state.endless).toBe(true);
  });

  it('cíle Malé útraty v patrech 9–20 odpovídají tabulce i ve hře (křivka podle síly piva)', () => {
    for (const [stake, curve] of [
      [1, 1],
      [3, 2],
      [6, 3],
    ] as const) {
      const g = endlessGame(`ENDLESSCURVE${stake}`, stake);
      for (let ante = 9; ante <= 20; ante++) {
        if (ante > 9) g._core.api.changeAnte(1);
        expect(g.blindTarget('small')).toBe(ROWS[ante - 9]![1 + (curve - 1) * 3]);
        expect(g.blindTarget('big')).toBe(ROWS[ante - 9]![2 + (curve - 1) * 3]);
      }
    }
  });

  it('nekonečný režim přežije uložení a načtení', () => {
    const g = endlessGame('ENDLESSSAVE');
    const loaded = Game.fromState(deserializeRun(serializeRun(g.state as RunState)), reg);
    expect(loaded.state.endless).toBe(true);
    expect(loaded.state.ante).toBe(9);
    loaded.dispatch({ type: 'selectBlind' });
    expect(loaded.state.round!.target).toBe(210_000);
  });
});

// ─────────────────────────── Přetečení ───────────────────────────

describe('nekonečný režim – přetečení (≈ patro 210)', () => {
  it('cíl Malé útraty v patře 209 je konečný (šéfa do 208), od patra 210 Number.MAX_VALUE ve všech křivkách; UI ukáže „∞“', () => {
    for (const curve of [1, 2, 3]) {
      expect(Number.isFinite(blindTarget(OVERFLOW_ANTE - 1, 'small', curve))).toBe(true);
      expect(blindTarget(OVERFLOW_ANTE - 1, 'small', curve)).toBeLessThan(Number.MAX_VALUE);
      for (const kind of ['small', 'big', 'boss'] as BlindKind[]) {
        const before = blindTarget(OVERFLOW_ANTE - 2, kind, curve);
        expect(Number.isFinite(before)).toBe(true);
        expect(before).toBeLessThan(Number.MAX_VALUE);
        expect(formatNumber(before)).not.toContain('∞');
        expect(blindTarget(OVERFLOW_ANTE, kind, curve)).toBe(Number.MAX_VALUE);
        expect(blindTarget(OVERFLOW_ANTE + 50, kind, curve)).toBe(Number.MAX_VALUE);
      }
      // I násobek šéfa ×4,5 (víc než nejvyšší ve hře, Fronta na banány ×3,5) se v patře 208 vejde.
      expect(blindTarget(OVERFLOW_ANTE - 2, 'boss', curve, { bossMult: 4.5 })).toBeLessThan(Number.MAX_VALUE);
    }
    expect(formatNumber(blindTarget(OVERFLOW_ANTE, 'boss', 1))).toBe('∞');
  });

  it('ve hře: cíl i skóre se zastaví na Number.MAX_VALUE, kolo jde vyhrát, uložení nemá null ani Infinity', () => {
    // Testovací žolík s ×1e308 (skutečný obsah k přetečení skóre nedorůstá) — ostatní je skutečný obsah hry.
    const bigBang = joker('big_bang', { hooks: { onHandPlayed: () => ({ xmult: 1e308 }) } });
    const g = endlessGame('ENDLESSOVERFLOW', 1, { ...reg, jokers: { ...reg.jokers, big_bang: bigBang } });
    g._core.api.changeAnte(OVERFLOW_ANTE - g.state.ante);
    expect(g.state.ante).toBe(OVERFLOW_ANTE);
    expect(reg.bosses[g.state.blinds[2]!.bossId!]!.final).not.toBe(true);
    g.dispatch({ type: 'selectBlind' });
    const round = g._core.state.round!;
    expect(round.target).toBe(Number.MAX_VALUE);
    expect(formatNumber(round.target)).toBe('∞');

    // Uložení uprostřed kola: cíl zůstane MAX_VALUE (JSON by nekonečno zapsal jako null).
    const json = serializeRun(g.state as RunState);
    expect(json).not.toContain('Infinity');
    expect(deserializeRun(json).round!.target).toBe(Number.MAX_VALUE);

    // Bez přetečení skóre se strop nesplní: běžná ruka k MAX_VALUE × 0,99 nic nepřidá (přesnost doublu).
    round.score = Number.MAX_VALUE * 0.99;
    g._core.api.disableBoss();
    const first = play(g, g.state.round!.hand.slice(0, 1));
    expect(first.events.find((e) => e.type === 'handPlayed')).toMatchObject({
      roundScore: Number.MAX_VALUE * 0.99,
    });
    expect(g.state.phase).toBe('round');

    // Ruka, jejíž skóre přeteče: skóre ruky i kola = MAX_VALUE (ne nekonečno) a strop splní cíl.
    addJokers(g, ['big_bang']);
    const { result, events } = play(g, g.state.round!.hand.slice(0, 1));
    expect(result.score).toBe(Number.MAX_VALUE);
    expect(events.find((e) => e.type === 'handPlayed')).toMatchObject({ roundScore: Number.MAX_VALUE });
    expect(formatNumber(result.score)).toBe('∞');
    expect(g.state.phase).toBe('round_end');
    expect(g.state.rewards).not.toBeNull();
    const after = deserializeRun(serializeRun(g.state as RunState));
    expect(after.round!.score).toBe(Number.MAX_VALUE);
    expect(after.stats.bestHandScore).toBe(Number.MAX_VALUE);
    expect(after.endless).toBe(true);
  });

  it('finálový šéf i za přetečením: patra 208 a 216 mají finálového šéfa, 210 běžného', () => {
    const g = endlessGame('ENDLESSFINALS');
    for (const [ante, final] of [
      [208, true],
      [210, false],
      [216, true],
    ] as const) {
      g._core.api.changeAnte(ante - g.state.ante);
      expect(g.state.ante).toBe(ante);
      expect(reg.bosses[g.state.blinds[2]!.bossId!]!.final === true, `patro ${ante}`).toBe(final);
    }
  });
});
