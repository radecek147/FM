/**
 * Fináloví šéfové F1–F5 (docs/DESIGN.md kap. 8.3) přes skutečný engine (Game + selectBoss + setupRound + play):
 * přesná pravidla s čísly, hranice, Odvolání (`disableBoss`), uložení a načtení. Obsah: src/content/bosses/final.ts.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES_FINAL, FLOOD_FLAG, MAYOR_FLAG } from '../../src/content/bosses/final';
import type { ContentRegistry } from '../../src/engine/content-types';
import { MSG } from '../../src/engine/constants';
import { bossFitsAnte, bossHasRule, pickBossId } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import { anteBase, niceRound } from '../../src/engine/run/targets';
import type { GameEvent, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { formatNumber } from '../../src/i18n/format';
import {
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

function registry(): ContentRegistry {
  return makeRegistry({ bosses: BOSSES_FINAL });
}

function bossGame(id: string, opts: { jokers?: (string | JokerSpec)[]; seed?: string } = {}): Game {
  const g = makeGame({ registry: registry(), jokers: opts.jokers ?? [], seed: opts.seed });
  selectBoss(g, id);
  return g;
}

/** Nastaví ruku a zahraje prvních `count` karet; kolo se tím nevyhraje ani neprohraje. */
function hand(g: Game, spec: string, count?: number, opts: SetupOptions = {}): ScoreResult {
  const cards = setupRound(g, spec, opts);
  const round = g._core.state.round!;
  round.target = 1e15;
  round.handsLeft = Math.max(round.handsLeft, 2);
  return play(g, cards.slice(0, count ?? cards.length)).result;
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

function reload(g: Game): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)) as Game['state'], registry());
}

// ─────────────────────────── Data a texty ───────────────────────────

describe('fináloví šéfové – data (DESIGN 8.3)', () => {
  it('id, finálový příznak a cíl odpovídají tabulce', () => {
    const table: Record<string, number> = {
      mayor: 2.5,
      regional_office: 2.25,
      great_flood: 2.5,
      white_lady: 1.5,
      noise_barrier: 4.5,
    };
    expect(BOSSES_FINAL.map((b) => b.id).sort()).toEqual(Object.keys(table).sort());
    for (const b of BOSSES_FINAL) {
      expect(b.final, b.id).toBe(true);
      expect(b.targetMult ?? 2, b.id).toBe(table[b.id]);
      expect(b.reward ?? 5, b.id).toBe(5);
      expect(bossHasRule(b), b.id).toBe(b.id !== 'noise_barrier');
    }
  });

  it('jen v patře 8 a každém dalším 8. patře', () => {
    for (const b of BOSSES_FINAL) {
      for (const ante of [1, 7, 9, 15]) expect(bossFitsAnte(b, ante), `${b.id} ${ante}`).toBe(false);
      for (const ante of [8, 16, 24]) expect(bossFitsAnte(b, ante), `${b.id} ${ante}`).toBe(true);
    }
    const reg = registry();
    delete reg.bosses.final_boss;
    const g = makeGame({ registry: reg });
    g._core.state.ante = 8;
    for (let i = 0; i < 10; i++) expect(BOSSES_FINAL.map((b) => b.id)).toContain(pickBossId(g._core));
  });

  it('texty: name (max 3 slova), rule, intro, defeat, death; čísla v pravidle sedí s params', () => {
    for (const b of BOSSES_FINAL) {
      for (const field of ['name', 'rule', 'intro', 'defeat', 'death']) {
        expect(hasKey(`bosses.${b.id}.${field}`), `bosses.${b.id}.${field}`).toBe(true);
      }
      expect(t(`bosses.${b.id}.name`).split(/\s+/).length, b.id).toBeLessThanOrEqual(3);
      // Čísla jen přes `{param}`: po dosazení nic nezbyde, každé číslo z params v textu je a změna params text změní.
      const rule = t(`bosses.${b.id}.rule`, b.params);
      expect(rule, b.id).not.toMatch(/[{}]/);
      for (const [k, v] of Object.entries(b.params ?? {})) {
        if (typeof v !== 'number') continue;
        expect(rule, `${b.id}.${k}`).toContain(formatNumber(v));
        expect(t(`bosses.${b.id}.rule`, { ...b.params, [k]: 37 }), `${b.id}.${k}`).toContain('37');
      }
    }
    const rule = (id: string): string =>
      t(`bosses.${id}.rule`, BOSSES_FINAL.find((b) => b.id === id)?.params);
    expect(rule('noise_barrier')).toContain('4,5×');
    expect(rule('great_flood')).toContain('o\u00a01\u00a0kartu');
    expect(t('bosses.great_flood.rule', { cards: 2 })).toContain('o\u00a02\u00a0karty');
    // Pitva podle DESIGN příloha C.
    expect(t('bosses.mayor.death')).toBe('Sliby chyby.');
    expect(t('bosses.noise_barrier.death')).toBe('Hlavou zeď neprorazíš.');
  });
});

// ─────────────────────────── F1 Pan starosta ───────────────────────────

describe('Pan starosta (mayor)', () => {
  it('první ruka vždy, další jen s vyšším skóre než předchozí ruka (i nezapočítaná)', () => {
    const g = bossGame('mayor');
    const round = g._core.state.round!;
    const r1 = hand(g, 'KH KS');
    expect(r1.score).toBe(64);
    expect(round.score).toBe(64);
    // Horší ruka se nezapočítá.
    const r2 = hand(g, '2C');
    expect(r2.score).toBe(0);
    expect(r2.steps.at(-1)).toMatchObject({ source: 'boss', defId: 'mayor', message: MSG.bossAdjusted });
    expect(round.score).toBe(64);
    // Lepší než předchozí (8), i když horší než první (64): započítá se.
    const r3 = hand(g, '3H 3S');
    expect(r3.score).toBe((12 + 6) * 2);
    expect(round.score).toBe(64 + 36);
    // Stejné skóre není vyšší.
    expect(hand(g, '3D 3C').score).toBe(0);
    expect(round.score).toBe(100);
  });

  it('předchozí skóre přežije uložení a načtení; Odvolání pravidlo vypne', () => {
    let g = bossGame('mayor');
    hand(g, 'KH KS');
    g = reload(g);
    expect(g.state.round!.flags[MAYOR_FLAG]).toBe(64);
    expect(hand(g, '2C').score).toBe(0);
    g._core.api.disableBoss();
    expect(hand(g, '2D').score).toBe(8);
  });
});

// ─────────────────────────── F2 Krajský úřad ───────────────────────────

describe('Krajský úřad (regional_office)', () => {
  it('po každé ruce vypne 1 náhodného fungujícího žolíka do konce kola', () => {
    const g = bossGame('regional_office', { jokers: ['plus_mult', 'plus_mult', 'plus_mult'] });
    const round = g._core.state.round!;
    const mults = [14, 10, 6, 2];
    mults.forEach((mult, i) => {
      const r = hand(g, 'KH KS');
      expect(r.score, `ruka ${i + 1}`).toBe((12 + 20) * mult);
      expect(round.jokerDebuffs, `ruka ${i + 1}`).toHaveLength(Math.min(3, i + 1));
    });
    expect(g.state.jokers.every((j) => j.debuffed)).toBe(true);
  });

  it('nefungujícího (zvětralého) žolíka nevybere; konec kola vrátí žolíky do provozu', () => {
    const g = bossGame('regional_office', {
      jokers: [{ id: 'noop', stickers: ['perishable'], debuffed: true }, 'plus_mult'],
    });
    g._core.state.jokers[0]!.perishRounds = 0;
    const [perished, working] = g.state.jokers.map((j) => j.uid);
    hand(g, 'KH KS');
    expect(g.state.round!.jokerDebuffs).toEqual([working]);
    const round = g._core.state.round!;
    round.target = 1;
    ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
    expect(g.state.jokers.find((j) => j.uid === working)!.debuffed).toBe(false);
    expect(g.state.jokers.find((j) => j.uid === perished)!.debuffed).toBe(true);
  });

  it('výběr je deterministický (stejný seed = stejný žolík)', () => {
    const picks = [1, 2].map(() => {
      const g = bossGame('regional_office', {
        jokers: ['noop', 'coaster', 'plus_mult', 'times_mult'],
        seed: 'URAD',
      });
      hand(g, 'KH KS');
      return g.state.jokers.findIndex((j) => j.debuffed);
    });
    expect(picks[0]).toBeGreaterThanOrEqual(0);
    expect(picks[0]).toBe(picks[1]);
  });
});

// ─────────────────────────── F3 Protihluková stěna ───────────────────────────

describe('Protihluková stěna (noise_barrier)', () => {
  it('cíl je 4,5× základ patra (hezky zaokrouhlený, DESIGN 2.3.2)', () => {
    const g = bossGame('noise_barrier');
    expect(g.state.round!.target).toBe(niceRound(anteBase(1, 1) * 4.5));
    expect(g.state.round!.target).toBe(1150);
    g._core.state.ante = 8;
    expect(g.blindTarget('boss', 'noise_barrier')).toBe(niceRound(anteBase(8, 1) * 4.5));
    // Víc než dvojnásobek běžného šéfa (2× základ patra).
    expect(g.blindTarget('boss', 'noise_barrier')).toBeGreaterThan(2 * niceRound(anteBase(8, 1) * 2));
  });
});

// ─────────────────────────── F4 Velká voda ───────────────────────────

describe('Velká voda (great_flood)', () => {
  it('každá zahraná ruka zmenší ruku o 1 kartu do konce kola', () => {
    const g = bossGame('great_flood');
    const round = g._core.state.round!;
    expect(round.hand).toHaveLength(8);
    hand(g, 'KH KS 2C 3D 4H 5S 6C 7D', 2);
    expect(g.modifiers().handSize).toBe(7);
    expect(round.hand).toHaveLength(7);
    hand(g, 'KH KS 2C 3D 4H 5S 6C', 2);
    expect(g.modifiers().handSize).toBe(6);
    expect(round.hand).toHaveLength(6);
  });

  it('ruka nejmíň 1 karta; počítadlo přežije uložení a načtení; Odvolání vrátí velikost', () => {
    let g = bossGame('great_flood');
    g._core.state.round!.flags[FLOOD_FLAG] = 20;
    g._core.invalidate();
    expect(g.modifiers().handSize).toBe(1);
    g._core.state.round!.flags[FLOOD_FLAG] = 2;
    g = reload(g);
    expect(g.modifiers().handSize).toBe(6);
    g._core.api.disableBoss();
    expect(g.modifiers().handSize).toBe(8);
  });

  it('nový kolo začíná s plnou rukou', () => {
    const g = bossGame('great_flood');
    hand(g, 'KH KS', 2);
    const round = g._core.state.round!;
    round.target = 1;
    ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
    ok(g.dispatch({ type: 'cashOut' }));
    ok(g.dispatch({ type: 'leaveShop' }));
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.modifiers().handSize).toBe(8);
    expect(g.state.round!.hand).toHaveLength(8);
  });
});

// ─────────────────────────── F5 Bílá paní ───────────────────────────

describe('Bílá paní (white_lady)', () => {
  it('po zahrání: zbylé karty lícem dolů a zamíchané, dobrané lícem nahoru', () => {
    const g = bossGame('white_lady');
    const cards = setupRound(g, 'KH KS 2C 3D 4H 5S 6C 7D');
    g._core.state.round!.target = 1e15;
    const { events } = play(g, cards.slice(0, 2));
    const kept = cards.slice(2).map((c) => c.id);
    const round = g.state.round!;
    expect(round.hand).toHaveLength(8);
    for (const id of kept) expect(g.card(id)!.faceDown, `karta ${id}`).toBe(true);
    const drawn = round.hand.filter((id) => !kept.includes(id));
    expect(drawn).toHaveLength(2);
    for (const id of drawn) expect(g.card(id)!.faceDown).toBe(false);
    expect(events.some((e) => e.type === 'handShuffled')).toBe(true);
    // Zakrytá karta ve výběru = náhled se nepočítá.
    expect(g.preview([kept[0]!]).hidden).toBe(true);
  });

  it('po zahození: všechny karty v ruce (i dosud odkryté) lícem dolů', () => {
    const g = bossGame('white_lady');
    const cards = setupRound(g, 'KH KS 2C 3D 4H 5S 6C 7D');
    ok(g.dispatch({ type: 'discard', cardIds: [cards[0]!.id] }));
    const round = g.state.round!;
    const kept = cards.slice(1).map((c) => c.id);
    for (const id of kept) expect(g.card(id)!.faceDown).toBe(true);
    expect(round.hand.filter((id) => !kept.includes(id)).map((id) => g.card(id)!.faceDown)).toEqual([false]);
  });

  it('zakrytá karta jde zahrát a skóruje normálně; Odvolání karty odkryje', () => {
    const g = bossGame('white_lady');
    const cards = setupRound(g, 'KH^ KS^ 2C');
    g._core.state.round!.target = 1e15;
    expect(play(g, cards.slice(0, 2)).result.score).toBe(64);
    g._core.api.disableBoss();
    for (const id of g.state.round!.hand) expect(g.card(id)!.faceDown).toBe(false);
  });
});
