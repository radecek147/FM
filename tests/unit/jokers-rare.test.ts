/**
 * Vzácní žolíci #16–25 (docs/DESIGN.md kap. 4.7): přesná čísla mechaniky přes skutečné skórování (Game + setupRound +
 * play), hraniční podmínky, kopie (`isCopy`) a uložení/načtení stavu. Obsah: src/content/jokers/rare.ts.
 */
import { describe, expect, it } from 'vitest';
import { RARE_JOKERS } from '../../src/content/jokers/rare';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { MSG } from '../../src/engine/constants';
import { newJokerInstance } from '../../src/engine/effects/api';
import { rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import type { GameEvent, JokerInstance, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import {
  addJokers,
  boss,
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  setupRound,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Registr: testovací obsah + vzácní žolíci (nahradí testovacího `late_train`), jediný bezzubý šéf. */
function registry(): ContentRegistry {
  const reg = makeRegistry({ jokers: RARE_JOKERS });
  reg.bosses = { calm: boss('calm'), final_boss: boss('final_boss', { final: true }) };
  return reg;
}

function game(jokers: (string | JokerSpec)[] = [], seed?: string): Game {
  return makeGame({ registry: registry(), jokers, ...(seed ? { seed } : {}) });
}

/**
 * Nastaví ruku na `spec` a zahraje prvních `count` karet (výchozí všechny). Kolo se tím nevyhraje ani neprohraje
 * (velký cíl a dost rukou), takže jde hrát další ruce stejného kola.
 */
function hand(g: Game, spec: string, count?: number, opts: SetupOptions = {}): ScoreResult {
  const cards = setupRound(g, spec, opts);
  const round = g._core.state.round!;
  round.target = 1e15;
  round.handsLeft = 10;
  return play(g, cards.slice(0, count ?? cards.length)).result;
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Vyhraje běžící (případně právě vybrané) kolo jednou kartou (cíl 1). */
function winRound(g: Game): GameEvent[] {
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
  const round = g._core.state.round!;
  round.target = 1;
  return ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
}

/** Po výhře kola: vyplatit, odejít z Večerky a vybrat další útratu. */
function nextRound(g: Game): void {
  ok(g.dispatch({ type: 'cashOut' }));
  ok(g.dispatch({ type: 'leaveShop' }));
  ok(g.dispatch({ type: 'selectBlind' }));
}

/** Uložení a načtení přes JSON (stejně jako save). */
function reload(g: Game): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)), registry());
}

const jokerSteps = (r: ScoreResult, defId: string) =>
  r.steps.filter((s) => s.source === 'joker' && s.defId === defId);

const def = (id: string): JokerDef => {
  const d = RARE_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`neznámý žolík ${id}`);
  return d;
};

/** Text popisku s parametry a stavem čerstvé instance (NBSP → mezera kvůli čitelnosti očekávání). */
function descOf(id: string, self?: JokerInstance): string {
  const d = def(id);
  const g = game();
  const inst = self ?? newJokerInstance(g._core, id);
  return t(`jokers.${id}.desc`, { ...d.params, ...d.describe?.(inst) }).replace(/\u00a0/g, ' ');
}

// Základy kombinací na úrovni 1 (DESIGN 2.2.1): Vysoká karta 6/1, Dvojice 12/2, Postupka 35/4.
// Dvojice králů = 12 + 10 + 10 = 32 čipů × 2 mult = 64 bodů.

// ─────────────────────────── Obsah a texty ───────────────────────────

describe('vzácní žolíci — definice a texty', () => {
  it('id, cena a vzácnost podle DESIGN 4.7', () => {
    expect(RARE_JOKERS.map((j) => [j.id, j.cost, j.rarity])).toEqual([
      ['late_train', 6, 'rare'],
      ['head_waiter', 7, 'rare'],
      ['old_guard', 6, 'rare'],
      ['herbalist', 6, 'rare'],
      ['regular', 6, 'rare'],
      ['beer_belly', 6, 'rare'],
      ['carousel', 6, 'rare'],
      ['echo', 7, 'rare'],
      ['lucky_seven', 6, 'rare'],
      ['tab', 6, 'rare'],
    ]);
  });

  it('každý má název (nejvýš 3 slova), popis, flavor a štítky; {param} v popisku se celé dosadí', () => {
    for (const d of RARE_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${d.id}.${field}`), d.id).toBe(true);
      expect(t(`jokers.${d.id}.name`).split(/\s+/).length, d.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${d.id}.flavor`), d.id).not.toMatch(/^[„"]/);
      expect(d.tags.length, d.id).toBeGreaterThan(0);
      expect(descOf(d.id), d.id).not.toMatch(/[{}]/);
    }
  });

  it('popisky čtou čísla z params (stejná čísla jako mechanika)', () => {
    expect(descOf('late_train')).toBe('×1,5 mult; 1 ze 6, že efekt „nabere zpoždění“ a nenastane.');
    expect(descOf('head_waiter')).toBe('×2 mult, pokud zahraná ruka má nejvýš 3 karty.');
    expect(descOf('old_guard')).toBe('×1,5 mult, pokud má zahraná kombinace úroveň aspoň 3.');
    expect(descOf('herbalist')).toBe(
      'Po každé použité babské radě trvale +1,5 mult; po kole, ve kterém se žádná rada nepoužila, bylinky zvadnou: −1 mult (teď +0 mult).',
    );
    expect(descOf('regular')).toBe('+1 mult za každé kolo, které od koupě strávil ve slotu (teď +0 mult).');
    expect(descOf('beer_belly')).toBe('Po každé zahrané ruce trvale +3 čipy (teď +0 čipů).');
    expect(descOf('carousel')).toBe(
      'Postupka smí jít kolem dokola (např. Q-K-A-2-3) a každá Postupka dá +14 mult.',
    );
    expect(descOf('echo')).toBe('Poslední skórující karta skóruje ještě 4×.');
    expect(descOf('lucky_seven')).toBe('Každá skórující karta: 1 ze 7, že skóruje ještě 7×.');
    expect(descOf('tab')).toBe(
      'Můžeš jít do mínusu až −15 Kč; +1 mult za každou korunu, která ti chybí do 15 Kč.',
    );
    expect(hasKey('jokers.late_train.delay')).toBe(true);
  });

  it('describe ukazuje aktuální stav', () => {
    const g = game();
    const inst = (id: string, state: JokerInstance['state']) => ({ ...newJokerInstance(g._core, id), state });
    expect(descOf('herbalist', inst('herbalist', { mult: 6 }))).toContain('(teď +6 mult)');
    expect(descOf('regular', inst('regular', { rounds: 4 }))).toContain('(teď +4 mult)');
    expect(descOf('beer_belly', inst('beer_belly', { chips: 22 }))).toContain('(teď +22 čipů)');
    expect(descOf('beer_belly', inst('beer_belly', { chips: 4 }))).toContain('(teď +4 čipy)');
  });

  it('nálepky: rostoucí s časem nejsou zvětrávající', () => {
    expect(def('regular').noPerishable).toBe(true);
    expect(def('beer_belly').noPerishable).toBe(true);
    expect(RARE_JOKERS.every((j) => j.copyable !== false)).toBe(true);
  });
});

// ─────────────────────────── #16 Zpožděný rychlík ───────────────────────────

describe('Zpožděný rychlík (late_train)', () => {
  it('bez zpoždění ×1,5 mult: Dvojice K = 32 × 3 = 96', () => {
    const g = game(['late_train']);
    g._core.api.addPermanentModifier({ probabilityMult: 0 }); // šance na zpoždění 0
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(96);
    expect(jokerSteps(r, 'late_train')).toMatchObject([{ xmult: 1.5, multAfter: 3 }]);
  });

  it('se zpožděním nedá nic, jen hlášku (probabilityMult 6 → 6 z 6)', () => {
    const g = game([{ id: 'late_train', edition: 'poly' }]);
    g._core.api.addPermanentModifier({ probabilityMult: 6 });
    const r = hand(g, 'KS KH');
    const steps = jokerSteps(r, 'late_train');
    expect(steps.some((s) => s.message === 'jokers.late_train.delay')).toBe(true);
    // vlastní ×1,5 odpadne, duhová edice (×1,5 po efektu) platí dál: 32 × 2 × 1,5 = 96
    expect(steps.filter((s) => s.xmult !== undefined)).toEqual([expect.objectContaining({ xmult: 1.5 })]);
    expect(r.score).toBe(96);
  });

  it.each([1, 2])(
    'hod jde přes ctx.chance a RNG žolíků: výsledek odpovídá streamu (seed, probabilityMult %i)',
    (pm) => {
      const g = game(['late_train'], 'RYCHLIK1');
      if (pm !== 1) g._core.api.addPermanentModifier({ probabilityMult: pm });
      ok(g.dispatch({ type: 'selectBlind' }));
      let delays = 0;
      for (let i = 0; i < 30; i++) {
        // Předpověď z kopie streamu `joker` (nastavení ruky ho neposouvá): zpoždění, když next() < (1 × pm) / 6.
        const st = g.state.rng.joker;
        const delayed = rngFromState([st[0], st[1], st[2], st[3]]).next() < pm / 6;
        const r = hand(g, 'KS KH');
        expect(r.score, `ruka ${i}`).toBe(delayed ? 64 : 96);
        if (delayed) delays++;
      }
      // Obě větve se na 30 rukách se seedem RYCHLIK1 opravdu vyskytnou.
      expect(delays).toBeGreaterThan(0);
      expect(delays).toBeLessThan(30);
    },
  );

  it('stejný seed = stejná posloupnost zpoždění, i po uložení a načtení', () => {
    const run = (reloadAt: number | null) => {
      let g = game(['late_train'], 'RYCHLIK2');
      const scores: number[] = [];
      for (let i = 0; i < 12; i++) {
        if (i === reloadAt) g = reload(g);
        scores.push(hand(g, 'KS KH').score);
      }
      return scores;
    };
    expect(run(null)).toEqual(run(5));
  });
});

// ─────────────────────────── #17 Pan vrchní ───────────────────────────

describe('Pan vrchní (head_waiter)', () => {
  it('×2 mult, když zahraná ruka má nejvýš 3 karty (počítají se i neskórující)', () => {
    // 3 karty: Dvojice K + 2 (neskóruje) → 32 × 2 × 2 = 128
    expect(hand(game(['head_waiter']), 'KS KH 2C').score).toBe(128);
    // 1 karta: Vysoká karta A = 17 × 1 × 2 = 34
    expect(hand(game(['head_waiter']), 'AS').score).toBe(34);
  });

  it('4 karty už ne', () => {
    const r = hand(game(['head_waiter']), 'KS KH 2C 3D');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'head_waiter')).toEqual([]);
  });
});

// ─────────────────────────── #18 Stará garda ───────────────────────────

describe('Stará garda (old_guard)', () => {
  it('×1,5 mult od úrovně 3: Dvojice úr. 3 = (68 + 20) × 6 × 1,5 = 792', () => {
    const r = hand(game(['old_guard']), 'KS KH', undefined, { levels: { pair: 3 } });
    expect(r.score).toBe(792);
    expect(jokerSteps(r, 'old_guard')).toMatchObject([{ xmult: 1.5 }]);
  });

  it('na úrovni 2 nic: (40 + 20) × 4 = 240', () => {
    const r = hand(game(['old_guard']), 'KS KH', undefined, { levels: { pair: 2 } });
    expect(r.score).toBe(240);
    expect(jokerSteps(r, 'old_guard')).toEqual([]);
  });
});

// ─────────────────────────── #19 Kořenářka ───────────────────────────

describe('Kořenářka (herbalist)', () => {
  function useConsumable(g: Game, defId: string): void {
    const c = g._core.api.createConsumable({ defId, ignoreSlots: true });
    ok(g.dispatch({ type: 'useConsumable', uid: c!.uid }));
  }

  it('začíná na +0; každá babská rada trvale +1,5 mult, jiné spotřebky nic', () => {
    const g = game(['herbalist']);
    const r0 = hand(g, 'KS KH');
    expect(r0.score).toBe(64);
    expect(jokerSteps(r0, 'herbalist')).toEqual([]);
    useConsumable(g, 'rada_a');
    expect(hand(g, 'KS KH').score).toBe(32 * 3.5);
    useConsumable(g, 'pr_pair'); // pranostika (Dvojice +1 úroveň) — Kořenářku nezajímá
    useConsumable(g, 'stamp'); // razítko taky ne
    expect(g.state.jokers[0]!.state.mult).toBe(1.5);
    useConsumable(g, 'rada_b');
    // Dvojice úr. 2 = 40 + 20 = 60 čipů, mult 4 + 3 = 7
    expect(hand(g, 'KS KH').score).toBe(60 * 7);
  });

  it('bylinky vadnou: kolo bez babské rady −1 mult (nejméně 0), kolo s radou ne', () => {
    const g = game(['herbalist']);
    useConsumable(g, 'rada_a');
    winRound(g);
    // V kole se rada použila → beze ztráty.
    expect(g.state.jokers[0]!.state.mult).toBe(1.5);
    nextRound(g);
    winRound(g);
    expect(g.state.jokers[0]!.state.mult).toBe(0.5);
    nextRound(g);
    winRound(g);
    nextRound(g);
    winRound(g);
    expect(g.state.jokers[0]!.state.mult).toBe(0);
  });

  it('kopie nenavyšuje počítadlo, ale bonus kopíruje; stav přežije uložení a načtení', () => {
    let g = game(['copier', 'herbalist']);
    useConsumable(g, 'rada_a');
    expect(g.state.jokers[1]!.state.mult).toBe(1.5);
    g = reload(g);
    expect(g.state.jokers[1]!.state.mult).toBe(1.5);
    // +1,5 (kopie) +1,5 (originál): 32 × 5 = 160
    expect(hand(g, 'KS KH').score).toBe(160);
    winRound(g);
    // vadne jen originál, jednou
    expect(g.state.jokers[1]!.state.mult).toBe(1.5);
  });
});

// ─────────────────────────── #20 Stálý host ───────────────────────────

describe('Stálý host (regular)', () => {
  it('+1 mult za každé dokončené kolo ve slotu', () => {
    const g = game(['regular']);
    expect(hand(g, 'KS KH').score).toBe(64);
    winRound(g);
    expect(g.state.jokers[0]!.state.rounds).toBe(1);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(32 * 3);
    winRound(g);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(32 * 4);
    // Ruce v rámci kola stav nemění.
    expect(hand(g, 'KS KH').score).toBe(32 * 4);
  });

  it('kopie počítadlo nezvedá; stav přežije uložení a načtení', () => {
    let g = game(['copier', 'regular']);
    winRound(g);
    nextRound(g);
    g = reload(g);
    expect(g.state.jokers[1]!.state.rounds).toBe(1);
    // +1 (kopie) +1 (originál): 32 × 4 = 128
    expect(hand(g, 'KS KH').score).toBe(128);
  });
});

// ─────────────────────────── #21 Pivní břicho ───────────────────────────

describe('Pivní břicho (beer_belly)', () => {
  it('po každé ruce trvale +3 čipy, začíná na +0, platí i přes kola', () => {
    const g = game(['beer_belly']);
    const r1 = hand(g, 'KS KH');
    expect(r1.score).toBe(64);
    expect(jokerSteps(r1, 'beer_belly')).toEqual([]);
    expect(hand(g, 'KS KH').score).toBe(35 * 2);
    expect(hand(g, 'KS KH').score).toBe(38 * 2);
    winRound(g); // 4. ruka (+9 čipů) → stav 12
    expect(g.state.jokers[0]!.state.chips).toBe(12);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(44 * 2);
  });

  it('kopie nepřičítá dvakrát; uložení a načtení', () => {
    let g = game(['copier', 'beer_belly']);
    hand(g, 'KS KH');
    hand(g, 'KS KH');
    g = reload(g);
    expect(g.state.jokers[1]!.state.chips).toBe(6);
    // +6 (kopie) +6 (originál): (32 + 12) × 2 = 88
    expect(hand(g, 'KS KH').score).toBe(88);
  });
});

// ─────────────────────────── #22 Kolotoč na pouti ───────────────────────────

describe('Kolotoč na pouti (carousel)', () => {
  it('pasivně povolí Postupku kolem dokola', () => {
    expect(game().modifiers().straightWrap).toBe(false);
    expect(game(['carousel']).modifiers().straightWrap).toBe(true);
  });

  it('Q-K-A-2-3 je Postupka a dá +14 mult: (35 + 36) × (4 + 14) = 1 278', () => {
    const r = hand(game(['carousel']), 'QS KH AD 2C 3S');
    expect(r.hand.type).toBe('straight');
    expect(r.score).toBe(1278);
    expect(jokerSteps(r, 'carousel')).toMatchObject([{ mult: 14 }]);
    // Bez Kolotoče to Postupka není.
    expect(hand(game(), 'QS KH AD 2C 3S').hand.type).toBe('high_card');
  });

  it('+14 mult i za běžnou Postupku a Postupku v barvě, za jiné kombinace ne', () => {
    expect(hand(game(['carousel']), '5S 6H 7D 8C 9S').score).toBe((35 + 35) * (4 + 14));
    const sf = hand(game(['carousel']), '5S 6S 7S 8S 9S');
    expect(sf.hand.type).toBe('straight_flush');
    expect(sf.score).toBe((90 + 35) * (9 + 14));
    const pair = hand(game(['carousel']), 'KS KH');
    expect(pair.score).toBe(64);
    expect(jokerSteps(pair, 'carousel')).toEqual([]);
  });
});

// ─────────────────────────── #23 Ozvěna z propasti ───────────────────────────

describe('Ozvěna z propasti (echo)', () => {
  it('poslední skórující karta skóruje ještě 4×: 12 + 10 + 10 + 4 × 10 = 72 × 2 = 144', () => {
    const g = game(['echo']);
    const cards = setupRound(g, 'KS KH');
    g._core.state.round!.target = 1e15;
    const r = play(g, cards).result;
    expect(r.score).toBe(144);
    const again = r.steps.filter((s) => s.message === MSG.again);
    expect(again.map((s) => s.cardId)).toEqual(Array(4).fill(cards[1]!.id));
  });

  it('neskórující karta na konci se nepočítá — opakuje se poslední skórující', () => {
    const g = game(['echo']);
    const cards = setupRound(g, 'KS KH 2C');
    g._core.state.round!.target = 1e15;
    const r = play(g, cards).result;
    expect(r.score).toBe(144);
    expect(r.steps.filter((s) => s.message === MSG.again).map((s) => s.cardId)).toEqual(
      Array(4).fill(cards[1]!.id),
    );
  });

  it('sčítá se s červenou pečetí (6 aktivací): 12 + 10 + 6 × 10 = 82 × 2 = 164', () => {
    expect(hand(game(['echo']), 'KS KH@red').score).toBe(164);
  });
});

// ─────────────────────────── #24 Šťastná sedmička ───────────────────────────

describe('Šťastná sedmička (lucky_seven)', () => {
  it('výhra = karta skóruje ještě 7× (probabilityMult 7 → 7 ze 7): Dvojice K = (12 + 8 × 10 + 8 × 10) × 2', () => {
    const g = game(['lucky_seven']);
    g._core.api.addPermanentModifier({ probabilityMult: 7 });
    const r = hand(g, 'KS KH');
    expect(r.score).toBe((12 + 8 * 10 + 8 * 10) * 2);
    expect(r.steps.filter((s) => s.message === MSG.again)).toHaveLength(14);
  });

  it('vylepšení se opakuje taky: Pálivá 7 → 8 × +5 mult; kamenná karta se losuje jako každá jiná', () => {
    const g = game(['lucky_seven']);
    g._core.api.addPermanentModifier({ probabilityMult: 7 });
    // čipy 12 + 8 × 7 + 8 × 7 = 124, mult 2 + 8 × 5 = 42
    expect(hand(g, '7S:mult 7H').score).toBe(124 * 42);
    // Dvojice dvojek + kamenná karta (8 × 50 čipů): 12 + 8 × 2 + 8 × 2 + 8 × 50 = 444 × 2
    expect(hand(g, '2S 2H 7S:stone').score).toBe(444 * 2);
  });

  it('bez štěstí (probabilityMult 0) nic', () => {
    const g = game(['lucky_seven']);
    g._core.api.addPermanentModifier({ probabilityMult: 0 });
    const r = hand(g, '7S 7H');
    expect(r.score).toBe((12 + 7 + 7) * 2);
    expect(r.steps.filter((s) => s.message === MSG.again)).toEqual([]);
  });

  it('jeden hod přes ctx.chance a RNG žolíků za každou skórující kartu (předpověď ze streamu)', () => {
    const g = game(['lucky_seven'], 'SEDMICKA1');
    ok(g.dispatch({ type: 'selectBlind' }));
    let lucky = 0;
    for (let i = 0; i < 40; i++) {
      const st = g.state.rng.joker;
      const rng = rngFromState([st[0], st[1], st[2], st[3]]);
      const wins = [rng.next() < 1 / 7, rng.next() < 1 / 7];
      const r = hand(g, 'KS KH');
      const chips = 12 + wins.reduce((a, w) => a + (w ? 8 : 1) * 10, 0);
      expect(r.score, `ruka ${i}`).toBe(chips * 2);
      lucky += wins.filter(Boolean).length;
    }
    // Na 80 kartách se seedem SEDMICKA1 padne výhra, ale zdaleka ne pokaždé.
    expect(lucky).toBeGreaterThan(0);
    expect(lucky).toBeLessThan(40);
  });

  it('stejný seed = stejné výhry, i po uložení a načtení', () => {
    const run = (reloadAt: number | null) => {
      let g = game(['lucky_seven'], 'SEDMICKA2');
      const scores: number[] = [];
      for (let i = 0; i < 12; i++) {
        if (i === reloadAt) g = reload(g);
        scores.push(hand(g, '5S 5H 9C 9D').score);
      }
      return scores;
    };
    expect(run(null)).toEqual(run(5));
  });

  it('nejvýš MAX_ACTIVATIONS_PER_CARD aktivací i s více žolíky', () => {
    const jokers = Array.from({ length: 6 }, () => 'lucky_seven');
    const g = game(jokers);
    g._core.api.addPermanentModifier({ probabilityMult: 7 });
    // 1 + 6 × 7 = 43 → oříznuto na 10 aktivací: Vysoká karta 6 + 10 × 7 = 76
    expect(hand(g, '7S').score).toBe(76);
  });
});

// ─────────────────────────── #25 Sekera ───────────────────────────

describe('Sekera (tab)', () => {
  it('pasivně dluhový limit 15 Kč (sčítá se)', () => {
    expect(game().modifiers().debtLimit).toBe(0);
    expect(game(['tab']).modifiers().debtLimit).toBe(15);
    expect(game(['tab', 'tab']).modifiers().debtLimit).toBe(30);
    const g = game(['tab']);
    g._core.state.money = 0;
    g._core.api.addMoney(-40, 'test');
    expect(g.state.money).toBe(-15);
  });

  it('+1 mult za každou korunu, která chybí do 15 Kč (i v dluhu)', () => {
    const at = (money: number): ScoreResult => {
      const g = game(['tab']);
      g._core.state.money = money;
      return hand(g, 'KS KH');
    };
    const full = at(15);
    expect(full.score).toBe(64);
    expect(jokerSteps(full, 'tab')).toEqual([]);
    expect(at(40).score).toBe(64);
    expect(at(14).score).toBe(32 * 3);
    expect(jokerSteps(at(0), 'tab')).toMatchObject([{ mult: 15 }]);
    expect(at(0).score).toBe(32 * 17);
    expect(at(-15).score).toBe(32 * 32);
  });

  it('nákup ve Večerce do mínusu až do −15 Kč', () => {
    const g = game(['tab']);
    winRound(g);
    ok(g.dispatch({ type: 'cashOut' }));
    g._core.state.money = 0;
    const item = g.state.shop!.items.findIndex((i) => i.price <= 15);
    expect(item).toBeGreaterThanOrEqual(0);
    const price = g.state.shop!.items[item]!.price;
    ok(g.dispatch({ type: 'buy', slot: item }));
    expect(g.state.money).toBe(-price);
  });

  it('kopie Sekery dá mult navíc (pasivní limit se nekopíruje)', () => {
    const g = game(['copier', 'tab']);
    expect(g.modifiers().debtLimit).toBe(15);
    g._core.state.money = -5;
    // chybí 20 Kč: +20 (kopie) +20 → 32 × 42
    expect(hand(g, 'KS KH').score).toBe(32 * 42);
  });
});

// ─────────────────────────── Společné ───────────────────────────

describe('vzácní žolíci v celém runu', () => {
  it('stav všech je po hrách JSON-bezpečný a hra po načtení pokračuje stejně', () => {
    const ids = RARE_JOKERS.map((j) => j.id);
    const a = game([], 'VZACNI1');
    addJokers(a, ids);
    const b = reload(a);
    for (let i = 0; i < 6; i++) {
      expect(hand(b, '5S 6H 7D 8C 9S').score).toBe(hand(a, '5S 6H 7D 8C 9S').score);
    }
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
    expect(JSON.stringify(b.state.jokers)).toBe(JSON.stringify(a.state.jokers));
  });
});
