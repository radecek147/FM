/**
 * Nekonečný režim se skutečným obsahem hry (docs/DESIGN.md kap. 1.3 a 2.3.3): cíle pater 9–24 pro všechny tři
 * křivky, průchod patry 9–24 po výhře (finálový šéf v patrech 16 a 24, jinde běžní šéfové, porážka už není výhra),
 * přetečení cíle i skóre na `Number.MAX_VALUE` (≈ patro 295) a jeho zobrazení jako „∞“, uložení a načtení.
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
const OVERFLOW_ANTE = 295;

// [patro, křivka 1: malá, velká, šéf, křivka 2: malá, velká, šéf, křivka 3: malá, velká, šéf]
// Přepočítáno nezávisle podle vzorce DESIGN 1.3: base(a) = nice(base(8) × g(a)^(a − 8)), g(a) = 1,5 + 0,035 × (a − 9).
type Row = [number, number, number, number, number, number, number, number, number, number];
const ROWS: Row[] = [
  [9, 150e3, 230e3, 300e3, 175e3, 260e3, 350e3, 200e3, 300e3, 400e3],
  [10, 240e3, 360e3, 480e3, 270e3, 410e3, 540e3, 320e3, 480e3, 640e3],
  [11, 390e3, 590e3, 780e3, 450e3, 680e3, 900e3, 520e3, 780e3, 1.05e6],
  [12, 660e3, 990e3, 1.3e6, 760e3, 1.15e6, 1.5e6, 900e3, 1.35e6, 1.8e6],
  [13, 1.2e6, 1.8e6, 2.4e6, 1.35e6, 2e6, 2.7e6, 1.6e6, 2.4e6, 3.2e6],
  [14, 2.2e6, 3.3e6, 4.4e6, 2.5e6, 3.8e6, 5e6, 3e6, 4.5e6, 6e6],
  [15, 4.3e6, 6.5e6, 8.6e6, 4.9e6, 7.4e6, 9.8e6, 5.8e6, 8.7e6, 11.5e6],
  [16, 8.6e6, 13e6, 17e6, 9.9e6, 15e6, 20e6, 11.5e6, 17.5e6, 23e6],
  [17, 18e6, 27e6, 36e6, 21e6, 32e6, 42e6, 24e6, 36e6, 48e6],
  [18, 39e6, 59e6, 78e6, 45e6, 68e6, 90e6, 52e6, 78e6, 105e6],
  [19, 87e6, 130e6, 175e6, 100e6, 150e6, 200e6, 115e6, 175e6, 230e6],
  [20, 200e6, 300e6, 400e6, 230e6, 350e6, 460e6, 270e6, 410e6, 540e6],
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

  it('základ je nice(base(8) × g(a)^(a − 8)) a poměr mezi patry plynule roste (×1,5 → ×2 v patře 16 → pod ×4)', () => {
    expect([ENDLESS_GROWTH_BASE, ENDLESS_GROWTH_STEP]).toEqual([1.5, 0.035]);
    for (const curve of [1, 2, 3]) {
      const base8 = TARGET_CURVES[curve - 1]![7]!;
      let prevRatio = 0;
      for (let ante = 9; ante <= 40; ante++) {
        const g = 1.5 + 0.035 * (ante - 9);
        expect(anteBase(ante, curve)).toBe(niceRound(base8 * g ** (ante - 8)));
        // Poměr sousedních pater (bez zaokrouhlení) plynule roste: ×1,5 v patře 9, ×2 v patře 16, ×3,1 v patře 30,
        // ×3,9 v patře 40 — začátek nekonečného režimu je mírný, dál zrychluje (Tepelná smrt vesmíru = patro 30).
        const ratio = g ** (ante - 8) / (ante === 9 ? 1 : (g - 0.035) ** (ante - 9));
        expect(ratio).toBeGreaterThanOrEqual(prevRatio);
        expect(ratio).toBeLessThan(4);
        prevRatio = ratio;
      }
    }
  });

  it('orientační čísla z DESIGN 2.3.3 (křivka 1): patro 24 ≈ 8e9, 30 ≈ 4,8e12, 32 ≈ 5,1e13, 40 ≈ 1,6e18', () => {
    expect(anteBase(24, 1)).toBe(8e9);
    expect(anteBase(30, 1)).toBe(4.8e12);
    expect(anteBase(32, 1)).toBe(5.1e13);
    expect(anteBase(40, 1)).toBe(1.6e18);
    // Od 1e15 vědecký zápis s čárkou.
    expect(formatNumber(blindTarget(40, 'boss', 1))).toBe('3,2e18');
    expect(formatNumber(anteBase(40, 1))).toBe('1,6e18');
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
    expect(loaded.state.round!.target).toBe(150_000);
  });
});

// ─────────────────────────── Přetečení ───────────────────────────

describe('nekonečný režim – přetečení (≈ patro 295)', () => {
  it('cíl Malé útraty v patře 294 je konečný (šéf v 293), od patra 295 Number.MAX_VALUE ve všech křivkách; UI ukáže „∞“', () => {
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
      // I násobek šéfa ×4,5 (víc než nejvyšší ve hře, ×2,5) se v patře 293 vejde.
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

  it('finálový šéf i za přetečením: patra 392 a 400 mají finálového šéfa, 393 běžného', () => {
    const g = endlessGame('ENDLESSFINALS');
    for (const [ante, final] of [
      [392, true],
      [393, false],
      [400, true],
    ] as const) {
      g._core.api.changeAnte(ante - g.state.ante);
      expect(g.state.ante).toBe(ante);
      expect(reg.bosses[g.state.blinds[2]!.bossId!]!.final === true, `patro ${ante}`).toBe(final);
    }
  });
});
