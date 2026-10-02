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
  [9, 46e3, 69e3, 92e3, 51e3, 77e3, 100e3, 57e3, 86e3, 115e3],
  [10, 115e3, 175e3, 230e3, 125e3, 190e3, 250e3, 145e3, 220e3, 290e3],
  [11, 330e3, 500e3, 660e3, 360e3, 540e3, 720e3, 410e3, 620e3, 820e3],
  [12, 1.05e6, 1.6e6, 2.1e6, 1.15e6, 1.75e6, 2.3e6, 1.3e6, 1.95e6, 2.6e6],
  [13, 3.6e6, 5.4e6, 7.2e6, 4e6, 6e6, 8e6, 4.5e6, 6.8e6, 9e6],
  [14, 14e6, 21e6, 28e6, 15e6, 23e6, 30e6, 17e6, 26e6, 34e6],
  [15, 58e6, 87e6, 115e6, 63e6, 95e6, 125e6, 72e6, 110e6, 145e6],
  [16, 260e6, 390e6, 520e6, 290e6, 440e6, 580e6, 320e6, 480e6, 640e6],
  [17, 1.3e9, 1.95e9, 2.6e9, 1.4e9, 2.1e9, 2.8e9, 1.6e9, 2.4e9, 3.2e9],
  [18, 6.7e9, 10e9, 13.5e9, 7.3e9, 11e9, 14.5e9, 8.3e9, 12.5e9, 16.5e9],
  [19, 37e9, 56e9, 74e9, 41e9, 62e9, 82e9, 46e9, 69e9, 92e9],
  [20, 220e9, 330e9, 440e9, 240e9, 360e9, 480e9, 280e9, 420e9, 560e9],
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

  it('orientační čísla z DESIGN 2.3.3 (křivka 1): patro 24 ≈ 5e14, 32 ≈ 2,4e22, 40 ≈ 1,15e31', () => {
    expect(anteBase(24, 1)).toBe(5e14);
    expect(anteBase(32, 1)).toBe(2.4e22);
    expect(anteBase(40, 1)).toBe(1.15e31);
    // Od 1e15 vědecký zápis s čárkou.
    expect(formatNumber(blindTarget(24, 'boss', 1))).toBe('1e15');
    expect(formatNumber(anteBase(32, 1))).toBe('2,4e22');
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
    expect(loaded.state.round!.target).toBe(46_000);
  });
});

// ─────────────────────────── Přetečení ───────────────────────────

describe('nekonečný režim – přetečení (≈ patro 210)', () => {
  it('cíl patra 209 je konečný, od patra 210 Number.MAX_VALUE ve všech křivkách; UI ukáže „∞“', () => {
    for (const curve of [1, 2, 3]) {
      for (const kind of ['small', 'big', 'boss'] as BlindKind[]) {
        const before = blindTarget(OVERFLOW_ANTE - 1, kind, curve);
        expect(Number.isFinite(before)).toBe(true);
        expect(before).toBeLessThan(Number.MAX_VALUE);
        expect(formatNumber(before)).not.toContain('∞');
        expect(blindTarget(OVERFLOW_ANTE, kind, curve)).toBe(Number.MAX_VALUE);
        expect(blindTarget(OVERFLOW_ANTE + 50, kind, curve)).toBe(Number.MAX_VALUE);
      }
      // I nejvyšší násobek šéfa (Protihluková stěna ×4,5) se v patře 209 vejde.
      expect(blindTarget(OVERFLOW_ANTE - 1, 'boss', curve, { bossMult: 4.5 })).toBeLessThan(Number.MAX_VALUE);
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
