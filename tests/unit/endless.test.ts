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
  [9, 220e3, 330e3, 440e3, 260e3, 390e3, 520e3, 310e3, 470e3, 620e3],
  [10, 550e3, 830e3, 1.1e6, 660e3, 990e3, 1.3e6, 770e3, 1.15e6, 1.55e6],
  [11, 1.55e6, 2.3e6, 3.1e6, 1.9e6, 2.9e6, 3.8e6, 2.2e6, 3.3e6, 4.4e6],
  [12, 4.9e6, 7.4e6, 9.8e6, 5.9e6, 8.9e6, 12e6, 6.9e6, 10.5e6, 14e6],
  [13, 17e6, 26e6, 34e6, 21e6, 32e6, 42e6, 24e6, 36e6, 48e6],
  [14, 66e6, 99e6, 130e6, 79e6, 120e6, 160e6, 92e6, 140e6, 185e6],
  [15, 280e6, 420e6, 560e6, 330e6, 500e6, 660e6, 390e6, 590e6, 780e6],
  [16, 1.25e9, 1.9e9, 2.5e9, 1.5e9, 2.3e9, 3e9, 1.75e9, 2.6e9, 3.5e9],
  [17, 6.1e9, 9.2e9, 12e9, 7.3e9, 11e9, 14.5e9, 8.5e9, 13e9, 17e9],
  [18, 32e9, 48e9, 64e9, 38e9, 57e9, 76e9, 45e9, 68e9, 90e9],
  [19, 180e9, 270e9, 360e9, 210e9, 320e9, 420e9, 250e9, 380e9, 500e9],
  [20, 1050e9, 1600e9, 2100e9, 1250e9, 1900e9, 2500e9, 1500e9, 2300e9, 3000e9],
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

  it('orientační čísla z DESIGN 2.3.3 (křivka 1): patro 24 ≈ 2,4e15, 32 ≈ 1,1e23, 40 ≈ 5,5e31', () => {
    expect(anteBase(24, 1)).toBe(2.4e15);
    expect(anteBase(32, 1)).toBe(1.1e23);
    expect(anteBase(40, 1)).toBe(5.5e31);
    // Od 1e15 vědecký zápis s čárkou.
    expect(formatNumber(blindTarget(24, 'boss', 1))).toBe('4,8e15');
    expect(formatNumber(anteBase(32, 1))).toBe('1,1e23');
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
    expect(loaded.state.round!.target).toBe(220_000);
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
      // I nejvyšší násobek šéfa (Fronta na banány ×4,5) se v patře 208 vejde.
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
