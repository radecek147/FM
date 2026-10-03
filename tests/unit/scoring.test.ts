/**
 * Skórovací pipeline — přesné hodnoty a pořadí kroků podle docs/ARCHITECTURE.md 2.5 a docs/DESIGN.md kap. 3
 * (včetně pracovního příkladu z kap. 3.2). Testovací obsah: tests/unit/fixtures/registry.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ACTIVATIONS_PER_CARD, MSG } from '../../src/engine/constants';
import { HAND_TYPE_DEFS } from '../../src/content/hands';
import { activationCount, scoreHand } from '../../src/engine/scoring/score';
import type { RunState, ScoreStep } from '../../src/engine/types';
import {
  addJokers,
  hookLog,
  joker,
  LATE_TRAIN_DELAY,
  makeGame,
  makeRegistry,
  type MakeGameOptions,
  NEIGHBOUR_BLOCKED,
  play,
  selectBoss,
  setupRound,
  stepSummary,
  winNextHand,
} from './fixtures/registry';

/** Kroky bez nedefinovaných polí (pro `toEqual` s přesným pořadím). */
const steps = (list: readonly ScoreStep[]) => list.map(stepSummary);

/** Hra v Malé útratě (s danými žolíky apod.). */
const inRound = (opts: MakeGameOptions = {}) => makeGame({ round: true, ...opts });

// ─────────────────────────── Pracovní příklad (DESIGN 3.2) ───────────────────────────

describe('pracovní příklad z DESIGN 3.2', () => {
  function setup(probabilityMult: number) {
    // Pracovní příklad počítá se skutečnou tabulkou kombinací (DESIGN 2.2.1), ne s testovací tabulkou z 1.0.
    const game = makeGame({
      registry: { ...makeRegistry(), handTypes: HAND_TYPE_DEFS },
      jokers: [
        { id: 'heart_fan', edition: 'holo' },
        { id: 'coaster' },
        { id: 'late_train', edition: 'poly' },
      ],
    });
    // 0 = Zpožděný rychlík nikdy nenabere zpoždění a sklo nepraskne; 6 = obojí jistě.
    game._core.api.addPermanentModifier({ probabilityMult });
    const cards = setupRound(game, 'KH:mult KS~foil KD 5C:bonus 5H:glass@red QS:steel QC 7D', {
      levels: { full_house: 2 },
    });
    const [fan, coaster, train] = game.state.jokers;
    return { game, cards, fan: fan!.uid, coaster: coaster!.uid, train: train!.uid };
  }

  it('přesné pořadí kroků a výsledek floor(268 × 236,25) = 63 315', () => {
    const { game, cards, fan, coaster, train } = setup(0);
    const [kh, ks, kd, c5, h5, qs] = cards.map((c) => c.id);
    const { result } = play(game, [kh!, ks!, kd!, c5!, h5!]);
    const card = (cardId: number, rest: Partial<ScoreStep>) => ({ source: 'card', cardId, ...rest });
    const fanOn = (cardId: number, rest: Partial<ScoreStep>) => ({
      source: 'joker',
      defId: 'heart_fan',
      jokerUid: fan,
      cardId,
      ...rest,
    });
    expect(result.hand.type).toBe('full_house');
    expect(steps(result.steps)).toEqual([
      { source: 'hand', defId: 'full_house', chips: 123, mult: 7, chipsAfter: 123, multAfter: 7 },
      card(kh!, { chips: 10, chipsAfter: 133, multAfter: 7 }),
      card(kh!, { mult: 5, chipsAfter: 133, multAfter: 12 }),
      fanOn(kh!, { chips: 5, chipsAfter: 138, multAfter: 12 }),
      fanOn(kh!, { mult: 2, chipsAfter: 138, multAfter: 14 }),
      card(ks!, { chips: 10, chipsAfter: 148, multAfter: 14 }),
      card(ks!, { chips: 50, chipsAfter: 198, multAfter: 14 }),
      card(kd!, { chips: 10, chipsAfter: 208, multAfter: 14 }),
      card(c5!, { chips: 5, chipsAfter: 213, multAfter: 14 }),
      card(c5!, { chips: 25, chipsAfter: 238, multAfter: 14 }),
      card(h5!, { chips: 5, chipsAfter: 243, multAfter: 14 }),
      card(h5!, { xmult: 2, chipsAfter: 243, multAfter: 28 }),
      fanOn(h5!, { chips: 5, chipsAfter: 248, multAfter: 28 }),
      fanOn(h5!, { mult: 2, chipsAfter: 248, multAfter: 30 }),
      card(h5!, { message: MSG.again, chipsAfter: 248, multAfter: 30 }),
      card(h5!, { chips: 5, chipsAfter: 253, multAfter: 30 }),
      card(h5!, { xmult: 2, chipsAfter: 253, multAfter: 60 }),
      fanOn(h5!, { chips: 5, chipsAfter: 258, multAfter: 60 }),
      fanOn(h5!, { mult: 2, chipsAfter: 258, multAfter: 62 }),
      { source: 'held', cardId: qs, xmult: 1.5, chipsAfter: 258, multAfter: 93 },
      { source: 'joker', defId: 'heart_fan', jokerUid: fan, mult: 10, chipsAfter: 258, multAfter: 103 },
      { source: 'joker', defId: 'coaster', jokerUid: coaster, chips: 10, chipsAfter: 268, multAfter: 103 },
      { source: 'joker', defId: 'coaster', jokerUid: coaster, mult: 2, chipsAfter: 268, multAfter: 105 },
      {
        source: 'joker',
        defId: 'late_train',
        jokerUid: train,
        xmult: 1.5,
        chipsAfter: 268,
        multAfter: 157.5,
      },
      {
        source: 'joker',
        defId: 'late_train',
        jokerUid: train,
        xmult: 1.5,
        chipsAfter: 268,
        multAfter: 236.25,
      },
    ]);
    expect(result.chips).toBe(268);
    expect(result.mult).toBe(236.25);
    expect(result.score).toBe(63315);
    expect(result.destroyedCardIds).toEqual([]);
    expect(game.state.round!.score).toBe(63315);
  });

  it('zpožděný rychlík: jeho ×1,5 odpadne, duhová edice platí dál → 42 210; sklo praskne až po sečtení', () => {
    const { game, cards, train } = setup(6);
    const [kh, ks, kd, c5, h5] = cards.map((c) => c.id);
    const { result } = play(game, [kh!, ks!, kd!, c5!, h5!]);
    const tail = steps(result.steps).slice(-3);
    expect(tail).toEqual([
      {
        source: 'joker',
        defId: 'late_train',
        jokerUid: train,
        message: LATE_TRAIN_DELAY,
        chipsAfter: 268,
        multAfter: 105,
      },
      {
        source: 'joker',
        defId: 'late_train',
        jokerUid: train,
        xmult: 1.5,
        chipsAfter: 268,
        multAfter: 157.5,
      },
      { source: 'card', cardId: h5, message: MSG.glassBreak, chipsAfter: 268, multAfter: 157.5 },
    ]);
    expect(result.score).toBe(42210);
    expect(result.destroyedCardIds).toEqual([h5]);
    expect(game.card(h5!)).toBeUndefined();
  });
});

// ─────────────────────────── Krok 1: základ ───────────────────────────

describe('krok 1 — základ kombinace', () => {
  it('Dvojice na úrovni 1: 12 × 2, pak čipy karet zleva doprava', () => {
    const game = inRound();
    const [a, b] = setupRound(game, '9S 9H');
    const { result } = play(game, [a!, b!]);
    expect(steps(result.steps)).toEqual([
      { source: 'hand', defId: 'pair', chips: 12, mult: 2, chipsAfter: 12, multAfter: 2 },
      { source: 'card', cardId: a!.id, chips: 9, chipsAfter: 21, multAfter: 2 },
      { source: 'card', cardId: b!.id, chips: 9, chipsAfter: 30, multAfter: 2 },
    ]);
    expect(result.score).toBe(60);
  });

  it('Dvojice na úrovni 3: (12 + 2 × 28) × (2 + 2 × 2)', () => {
    const game = inRound();
    const [a, b] = setupRound(game, '9S 9H', { levels: { pair: 3 } });
    const { result } = play(game, [a!, b!]);
    expect(result.steps[0]).toMatchObject({ chips: 68, mult: 6 });
    expect(result.score).toBe((68 + 18) * 6);
  });

  it('každá kombinace na úrovni 1 dává základ z tabulky DESIGN 2.2.1', () => {
    const cases: [string, string, number, number][] = [
      ['AS', 'high_card', 6, 1],
      ['2S 2H', 'pair', 12, 2],
      ['2S 2H 3S 3H', 'two_pair', 24, 2],
      ['2S 2H 2D', 'three', 28, 3],
      ['2S 3H 4D 5C 6S', 'straight', 35, 4],
      ['2H 5H 7H 9H JH', 'flush', 40, 4],
      ['2S 2H 2D 3S 3H', 'full_house', 45, 5],
      ['2S 2H 2D 2C', 'four', 65, 6],
      ['2H 3H 4H 5H 6H', 'straight_flush', 90, 9],
      ['10S JS QS KS AS', 'royal_flush', 120, 10],
      ['2S 2H 2D 2C 2S', 'five', 110, 11],
      ['2S 2S 2S 3S 3S', 'flush_house', 130, 13],
      ['2S 2S 2S 2S 2S', 'flush_five', 150, 15],
    ];
    for (const [hand, type, chips, mult] of cases) {
      const game = inRound();
      const cards = setupRound(game, hand);
      const { result } = play(game, cards);
      expect(result.hand.type, hand).toBe(type);
      expect(result.steps[0], hand).toMatchObject({ source: 'hand', defId: type, chips, mult });
    }
  });

  it('karty se vyhodnocují v pořadí zahrání, ne v pořadí v ruce; kop neskóruje', () => {
    const game = inRound();
    const [ks, two, kh] = setupRound(game, 'KS 2C KH');
    const { result } = play(game, [kh!, two!, ks!]);
    expect(result.hand.scoringIds).toEqual([kh!.id, ks!.id]);
    expect(result.steps.filter((s) => s.source === 'card').map((s) => s.cardId)).toEqual([kh!.id, ks!.id]);
    expect(result.score).toBe((12 + 20) * 2);
  });

  it('beforeScoring smí zvýšit úroveň kombinace ještě před základem (leveler v první ruce)', () => {
    const game = inRound({ jokers: ['leveler'] });
    const [a, b] = setupRound(game, '9S 9H');
    const first = play(game, [a!, b!]);
    expect(first.result.steps[0]).toMatchObject({ source: 'hand', chips: 40, mult: 4 });
    expect(first.result.score).toBe((40 + 18) * 4);
    expect(first.events).toContainEqual({ type: 'handLeveled', hand: 'pair', level: 2, delta: 1 });
    const [c, d] = setupRound(game, '8S 8H');
    const second = play(game, [c!, d!]);
    expect(second.result.steps[0]).toMatchObject({ chips: 40, mult: 4 });
    expect(game.state.handLevels.pair.level).toBe(2);
  });

  it('výsledky beforeScoring se aplikují hned po základu (před kartami)', () => {
    const reg = makeRegistry({ jokers: [joker('pre', { hooks: { beforeScoring: () => ({ chips: 7 }) } })] });
    const game = makeGame({ registry: reg, jokers: ['pre'], round: true });
    const [a] = setupRound(game, 'AS');
    const uid = game.state.jokers[0]!.uid;
    const { result } = play(game, [a!]);
    expect(steps(result.steps)).toEqual([
      { source: 'hand', defId: 'high_card', chips: 6, mult: 1, chipsAfter: 6, multAfter: 1 },
      { source: 'joker', defId: 'pre', jokerUid: uid, chips: 7, chipsAfter: 13, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 24, multAfter: 1 },
    ]);
  });
});

// ─────────────────────────── Krok 2: vylepšení, edice, pečetě ───────────────────────────

describe('krok 2 — vylepšení karet', () => {
  it('Prémiová: +25 čipů po čipech karty', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS:bonus');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 17, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 25, chipsAfter: 42, multAfter: 1 },
    ]);
    expect(result.score).toBe(42);
  });

  it('Pálivá: +5 mult', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS:mult');
    expect(play(game, [a!]).result.score).toBe(17 * 6);
  });

  it('Skleněná: ×2 mult; bez prasknutí zůstává v balíčku', () => {
    const game = inRound();
    game._core.api.addPermanentModifier({ probabilityMult: 0 });
    const [a] = setupRound(game, 'AS:glass');
    const { result } = play(game, [a!]);
    expect(result.steps[2]).toMatchObject({ source: 'card', xmult: 2, multAfter: 2 });
    expect(result.score).toBe(34);
    expect(result.destroyedCardIds).toEqual([]);
    expect(game.card(a!.id)).toBeDefined();
    expect(game.state.round!.discardPile).toContain(a!.id);
  });

  it('Skleněná praskne podle seedu deterministicky; karta ruku dohraje a pak se zničí', () => {
    const outcome = (seed: string) => {
      const game = makeGame({ seed, round: true });
      const [a] = setupRound(game, 'AS:glass');
      const { result, events } = play(game, [a!]);
      return { game, a: a!, result, events, broken: result.destroyedCardIds.length > 0 };
    };
    const seeds = Array.from({ length: 40 }, (_, i) => `GLASS${i}`);
    const results = seeds.map((s) => outcome(s).broken);
    expect(results).toContain(true);
    expect(results).toContain(false);
    // stejný seed ⇒ stejný výsledek
    expect(seeds.map((s) => outcome(s).broken)).toEqual(results);
    const seed = seeds[results.indexOf(true)]!;
    const { game, a, result, events } = outcome(seed);
    expect(result.score).toBe(34);
    expect(game.card(a.id)).toBeUndefined();
    expect(game.state.deck.some((c) => c.id === a.id)).toBe(false);
    expect(game.state.round!.discardPile).not.toContain(a.id);
    const played = events.findIndex((e) => e.type === 'handPlayed');
    const destroyed = events.findIndex((e) => e.type === 'cardDestroyed');
    expect(destroyed).toBeGreaterThan(played);
  });

  it('Ocelová v ruce: ×1,5; skóre = floor(17 × 1,5) = 25', () => {
    const game = inRound();
    const [a, steel] = setupRound(game, 'AS QS:steel');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).at(-1)).toEqual({
      source: 'held',
      cardId: steel!.id,
      xmult: 1.5,
      chipsAfter: 17,
      multAfter: 1.5,
    });
    expect(result.score).toBe(25);
  });

  it('Ocelová zahraná (ne v ruce) nedává nic', () => {
    const game = inRound();
    const [a] = setupRound(game, 'QS:steel');
    expect(play(game, [a!]).result.score).toBe(16);
  });

  it('Kamenná: +50 čipů, žádné čipy hodnoty, vždy skóruje (v pořadí zahrání)', () => {
    const game = inRound();
    const [stone, ace] = setupRound(game, 'KS:stone AH');
    const { result } = play(game, [stone!, ace!]);
    expect(result.hand.type).toBe('high_card');
    expect(result.hand.scoringIds).toEqual([stone!.id, ace!.id]);
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: stone!.id, chips: 50, chipsAfter: 56, multAfter: 1 },
      { source: 'card', cardId: ace!.id, chips: 11, chipsAfter: 67, multAfter: 1 },
    ]);
    expect(result.score).toBe(67);
  });

  it('Zlatá: zahraná nic, držená v ruce na konci kola +3 Kč', () => {
    const game = inRound();
    const [a, gold] = setupRound(game, 'AS:gold QD:gold');
    winNextHand(game);
    const { result } = play(game, [a!]);
    expect(result.score).toBe(17);
    expect(result.moneyEarned).toBe(0);
    expect(game.state.phase).toBe('round_end');
    expect(game.state.rewards!.extra).toContainEqual({ source: 'held', amount: 3 });
    expect(gold).toBeDefined();
  });

  it('Šťastná: s probabilityMult 12 obě šance jistě (+15 mult, +15 Kč)', () => {
    const game = inRound();
    game._core.api.addPermanentModifier({ probabilityMult: 12 });
    const money = game.state.money;
    const [a] = setupRound(game, 'AS:lucky');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 17, multAfter: 1 },
      { source: 'card', cardId: a!.id, mult: 15, message: MSG.lucky, chipsAfter: 17, multAfter: 16 },
      { source: 'card', cardId: a!.id, money: 15, message: MSG.luckyMoney, chipsAfter: 17, multAfter: 16 },
    ]);
    expect(result.score).toBe(17 * 16);
    expect(result.moneyEarned).toBe(15);
    expect(game.state.money).toBe(money + 15);
  });

  it('Šťastná: s probabilityMult 4 je mult jistý, peníze 4 z 12; s 0 nic', () => {
    const game = inRound();
    game._core.api.addPermanentModifier({ probabilityMult: 4 });
    game._core.state.round!.target = 1e12;
    let moneyHits = 0;
    for (let i = 0; i < 30; i++) {
      const [a] = setupRound(game, 'AS:lucky');
      game._core.state.round!.handsLeft = 2;
      const { result } = play(game, [a!]);
      expect(result.steps.some((s) => s.message === MSG.lucky)).toBe(true);
      if (result.moneyEarned === 15) moneyHits++;
    }
    expect(moneyHits).toBeGreaterThan(0);
    expect(moneyHits).toBeLessThan(30);

    const never = inRound();
    never._core.api.addPermanentModifier({ probabilityMult: 0 });
    const [b] = setupRound(never, 'AS:lucky');
    const { result } = play(never, [b!]);
    expect(result.steps).toHaveLength(2);
    expect(result.score).toBe(17);
  });

  it('Šťastná s červenou pečetí hází při každé aktivaci', () => {
    const game = inRound();
    game._core.api.addPermanentModifier({ probabilityMult: 12 });
    const [a] = setupRound(game, 'AS:lucky@red');
    const { result } = play(game, [a!]);
    expect(result.steps.filter((s) => s.message === MSG.lucky)).toHaveLength(2);
    expect(result.moneyEarned).toBe(30);
    expect(result.score).toBe((6 + 22) * 31);
  });

  it('Divoká: patří do všech barev — doplní Barvu', () => {
    const game = inRound();
    const cards = setupRound(game, '2H 5H 7H 9H JS:wild');
    const { result } = play(game, cards);
    expect(result.hand.type).toBe('flush');
    expect(result.score).toBe((40 + 2 + 5 + 7 + 9 + 10) * 4);
  });

  it('Ohmataná: po ruce zpráva a trvale +3 čipy, které platí až od další ruky', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS:worn');
    const first = play(game, [a!]);
    expect(steps(first.result.steps).at(-1)).toEqual({
      source: 'card',
      cardId: a!.id,
      message: MSG.worn,
      chipsAfter: 17,
      multAfter: 1,
    });
    expect(first.result.score).toBe(17);
    expect(game.card(a!.id)!.bonusChips).toBe(3);
    // stejná karta znovu do ruky
    const round = game._core.state.round!;
    round.discardPile = round.discardPile.filter((id) => id !== a!.id);
    round.drawPile.unshift(...round.hand);
    round.hand = [a!.id];
    const second = play(game, [a!.id]);
    expect(second.result.steps[1]).toMatchObject({ chips: 14 });
    expect(game.card(a!.id)!.bonusChips).toBe(6);
  });
});

describe('krok 2 — edice karet (po vylepšení)', () => {
  it('Pálivá + duhová: čipy → +5 mult → ×1,5', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS:mult~poly');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 17, multAfter: 1 },
      { source: 'card', cardId: a!.id, mult: 5, chipsAfter: 17, multAfter: 6 },
      { source: 'card', cardId: a!.id, xmult: 1.5, chipsAfter: 17, multAfter: 9 },
    ]);
    expect(result.score).toBe(153);
  });

  it('Prémiová + lesklá: +25, pak +50', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS:bonus~foil');
    const { result } = play(game, [a!]);
    expect(result.steps.slice(1).map((s) => s.chips)).toEqual([11, 25, 50]);
    expect(result.score).toBe(92);
  });

  it('Holografická: +10 mult', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS~holo');
    expect(play(game, [a!]).result.score).toBe(17 * 11);
  });

  it('Edice platí i u karty bez vylepšení a u kamenné karty', () => {
    const game = inRound();
    const [stone] = setupRound(game, '2S:stone~poly');
    const { result } = play(game, [stone!]);
    expect(result.steps.slice(1).map((s) => [s.chips, s.xmult])).toEqual([
      [50, undefined],
      [undefined, 1.5],
    ]);
    expect(result.score).toBe(Math.floor(56 * 1.5));
  });
});

describe('krok 2 — pečetě', () => {
  it('Zlatá pečeť: +2 Kč při skórování (po edici)', () => {
    const game = inRound();
    const money = game.state.money;
    const [a] = setupRound(game, 'AS@gold~foil');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 17, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 50, chipsAfter: 67, multAfter: 1 },
      { source: 'card', cardId: a!.id, money: 2, chipsAfter: 67, multAfter: 1 },
    ]);
    expect(result.moneyEarned).toBe(2);
    expect(game.state.money).toBe(money + 2);
  });

  it('Zlatá pečeť na kopu (mimo kombinaci) nic nedá', () => {
    const game = inRound();
    const [a, b, kicker] = setupRound(game, '9S 9H 3C@gold');
    expect(play(game, [a!, b!, kicker!]).result.moneyEarned).toBe(0);
  });

  it('Červená pečeť: 2 aktivace celé sekvence (čipy, vylepšení, žolíci)', () => {
    const game = inRound({ jokers: ['card_chips'] });
    const uid = game.state.jokers[0]!.uid;
    const [a] = setupRound(game, 'AS:bonus@red');
    const { result } = play(game, [a!]);
    const joker = { source: 'joker', defId: 'card_chips', jokerUid: uid, cardId: a!.id };
    expect(steps(result.steps).slice(1)).toEqual([
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 17, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 25, chipsAfter: 42, multAfter: 1 },
      { ...joker, chips: 3, chipsAfter: 45, multAfter: 1 },
      { source: 'card', cardId: a!.id, message: MSG.again, chipsAfter: 45, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 11, chipsAfter: 56, multAfter: 1 },
      { source: 'card', cardId: a!.id, chips: 25, chipsAfter: 81, multAfter: 1 },
      { ...joker, chips: 3, chipsAfter: 84, multAfter: 1 },
    ]);
    expect(result.score).toBe(84);
  });

  it('Červená pečeť v ruce: ocelová ×1,5 dvakrát', () => {
    const game = inRound();
    const [a, steel] = setupRound(game, 'AS QS:steel@red');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(2)).toEqual([
      { source: 'held', cardId: steel!.id, xmult: 1.5, chipsAfter: 17, multAfter: 1.5 },
      { source: 'held', cardId: steel!.id, message: MSG.again, chipsAfter: 17, multAfter: 1.5 },
      { source: 'held', cardId: steel!.id, xmult: 1.5, chipsAfter: 17, multAfter: 2.25 },
    ]);
    expect(result.score).toBe(Math.floor(17 * 2.25));
  });

  it('Červená pečeť na držené kartě bez efektu nic nevypíše', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS 7D@red');
    expect(play(game, [a!]).result.steps).toHaveLength(2);
  });

  it('Modrá pečeť: držená na konci kola vytvoří pranostiku poslední zahrané kombinace', () => {
    const game = inRound();
    const [a, b] = setupRound(game, '9S 9H 7D@blue 6C@blue');
    winNextHand(game);
    play(game, [a!, b!]);
    expect(game.state.phase).toBe('round_end');
    // dvě modré karty = dvě pranostiky (do zaplnění slotů)
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['pr_pair', 'pr_pair']);
  });

  it('Modrá pečeť bez volného slotu nic nevytvoří', () => {
    const game = inRound();
    const core = game._core;
    core.api.createConsumable({ defId: 'rada_a' });
    const [a, b] = setupRound(game, '9S 9H 7D@blue 6C@blue');
    winNextHand(game);
    play(game, [a!, b!]);
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['rada_a', 'pr_pair']);
  });

  it('Modrá pečeť: zahraná nebo debuffnutá nic', () => {
    const game = inRound();
    const [a, b, held] = setupRound(game, '9S@blue 9H 7D@blue!');
    winNextHand(game);
    play(game, [a!, b!]);
    expect(game.state.consumables).toEqual([]);
    expect(held!.debuffed).toBe(false); // konec kola debuffy zruší
  });

  it('Fialová pečeť: při zahození vytvoří babskou radu, bez volného slotu nic', () => {
    const game = inRound();
    const [a, b, c] = setupRound(game, '2S@purple 3S@purple 4S@purple 5S');
    expect(game.dispatch({ type: 'discard', cardIds: [a!.id, b!.id, c!.id] }).ok).toBe(true);
    expect(game.state.consumables.map((x) => game.registry.consumables[x.defId]!.kind)).toEqual([
      'rada',
      'rada',
    ]);
  });
});

// ─────────────────────────── Debuff ───────────────────────────

describe('debuffnutá karta', () => {
  it('od šéfa: počítá se do kombinace, ale nedává čipy ani reakce žolíků', () => {
    const game = makeGame({ jokers: ['card_chips', 'heart_fan'] });
    selectBoss(game, 'heart_ban');
    const [h, s] = setupRound(game, '9H:bonus@red 9S');
    expect(h!.debuffed).toBe(true);
    const { result } = play(game, [h!, s!]);
    expect(result.hand.type).toBe('pair');
    const [cc] = game.state.jokers;
    expect(steps(result.steps)).toEqual([
      { source: 'hand', defId: 'pair', chips: 12, mult: 2, chipsAfter: 12, multAfter: 2 },
      { source: 'card', cardId: h!.id, message: MSG.debuffed, chipsAfter: 12, multAfter: 2 },
      { source: 'card', cardId: s!.id, chips: 9, chipsAfter: 21, multAfter: 2 },
      {
        source: 'joker',
        defId: 'card_chips',
        jokerUid: cc!.uid,
        cardId: s!.id,
        chips: 3,
        chipsAfter: 24,
        multAfter: 2,
      },
    ]);
    expect(result.score).toBe(48);
  });

  it('debuffnutá držená karta nedává nic (ani ocelová)', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS QS:steel!');
    expect(play(game, [a!]).result.score).toBe(17);
  });

  it('debuffnutá Ohmataná ani Skleněná nespustí afterScored', () => {
    const game = inRound();
    game._core.api.addPermanentModifier({ probabilityMult: 5 });
    const [w, g] = setupRound(game, 'AS:worn! AH:glass!');
    const { result } = play(game, [w!, g!]);
    expect(result.destroyedCardIds).toEqual([]);
    expect(game.card(w!.id)!.bonusChips).toBe(0);
  });
});

// ─────────────────────────── Krok 3: držené karty ───────────────────────────

describe('krok 3 — karty v ruce', () => {
  it('zleva doprava v pořadí ruky: vylepšení → žolíci onCardHeld', () => {
    const game = inRound({ jokers: ['queen_holder'] });
    const uid = game.state.jokers[0]!.uid;
    const [a, qs, qc, d7] = setupRound(game, 'AS QS:steel QC 7D');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(2)).toEqual([
      { source: 'held', cardId: qs!.id, xmult: 1.5, chipsAfter: 17, multAfter: 1.5 },
      {
        source: 'joker',
        defId: 'queen_holder',
        jokerUid: uid,
        cardId: qs!.id,
        mult: 3,
        chipsAfter: 17,
        multAfter: 4.5,
      },
      {
        source: 'joker',
        defId: 'queen_holder',
        jokerUid: uid,
        cardId: qc!.id,
        mult: 3,
        chipsAfter: 17,
        multAfter: 7.5,
      },
    ]);
    expect(result.steps.some((s) => s.cardId === d7!.id)).toBe(false);
    expect(result.score).toBe(127);
  });

  it('retriggerHeld zopakuje aktivaci držené karty', () => {
    const game = inRound({ jokers: ['queen_holder', 'held_echo'] });
    const [a, qc] = setupRound(game, 'AS QC 7D');
    const { result } = play(game, [a!]);
    const held = result.steps.slice(2);
    expect(held.map((s) => [s.cardId, s.mult, s.message])).toEqual([
      [qc!.id, 3, undefined],
      [qc!.id, undefined, MSG.again],
      [qc!.id, 3, undefined],
    ]);
    expect(result.score).toBe(17 * 7);
  });

  it('karta lícem dolů v ruce funguje normálně', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS QS:steel^');
    expect(play(game, [a!]).result.score).toBe(25);
  });
});

// ─────────────────────────── Krok 4: žolíci a jejich edice ───────────────────────────

describe('krok 4 — žolíci zleva doprava a edice', () => {
  it('+mult patří doleva, ×mult doprava (pořadí žolíků mění výsledek)', () => {
    const left = inRound({ jokers: ['plus_mult', 'times_mult'] });
    const [a] = setupRound(left, 'AS');
    expect(play(left, [a!]).result.score).toBe(17 * 10);
    const right = inRound({ jokers: ['times_mult', 'plus_mult'] });
    const [b] = setupRound(right, 'AS');
    expect(play(right, [b!]).result.score).toBe(17 * 6);
  });

  it('přesunutí žolíků akcí reorderJokers změní pořadí efektů', () => {
    const game = inRound({ jokers: ['times_mult', 'plus_mult'] });
    const [x, p] = game.state.jokers;
    expect(game.dispatch({ type: 'reorderJokers', uids: [p!.uid, x!.uid] }).ok).toBe(true);
    const [a] = setupRound(game, 'AS');
    expect(play(game, [a!]).result.score).toBe(170);
  });

  it('lesklá (+50 čipů) před efektem, i když žolík sám nic nedělá', () => {
    const game = inRound({ jokers: [{ id: 'noop', edition: 'foil' }] });
    const uid = game.state.jokers[0]!.uid;
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).at(-1)).toEqual({
      source: 'joker',
      defId: 'noop',
      jokerUid: uid,
      chips: 50,
      chipsAfter: 67,
      multAfter: 1,
    });
    expect(result.score).toBe(67);
  });

  it('holografická (+10 mult) před vlastním ×2', () => {
    const game = inRound({ jokers: [{ id: 'times_mult', edition: 'holo' }] });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.steps.slice(-2).map((s) => [s.mult, s.xmult, s.multAfter])).toEqual([
      [10, undefined, 11],
      [undefined, 2, 22],
    ]);
    expect(result.score).toBe(374);
  });

  it('duhová (×1,5) až po vlastním +4 mult', () => {
    const game = inRound({ jokers: [{ id: 'plus_mult', edition: 'poly' }] });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.steps.slice(-2).map((s) => [s.mult, s.xmult, s.multAfter])).toEqual([
      [4, undefined, 5],
      [undefined, 1.5, 7.5],
    ]);
    expect(result.score).toBe(127);
  });

  it('negativní edice ve skórování nic nedělá', () => {
    const game = inRound({ jokers: [{ id: 'noop', edition: 'negative' }] });
    const [a] = setupRound(game, 'AS');
    expect(play(game, [a!]).result.steps).toHaveLength(2);
  });

  it('debuffnutý žolík nedává nic, ani efekt edice', () => {
    const game = inRound({ jokers: [{ id: 'plus_mult', edition: 'foil', debuffed: true }] });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.steps.some((s) => s.source === 'joker')).toBe(false);
    expect(result.score).toBe(17);
  });

  it('afterHandScored dostane konečné skóre; počítadlo ve self.state roste po každé ruce', () => {
    const game = inRound({ jokers: ['counter'] });
    const counter = game.state.jokers[0]!;
    for (let hand = 0; hand < 3; hand++) {
      const [a] = setupRound(game, 'AS');
      const { result } = play(game, [a!]);
      expect(result.score).toBe(17 * (1 + hand));
    }
    expect(counter.state.hands).toBe(3);
  });

  it('passive: fourCardStraightFlush (Postupka v barvě ze 4 karet) a handSize', () => {
    const game = inRound({ jokers: ['four_fingers'] });
    const cards = setupRound(game, '5H 6H 7H 8H 2C');
    const { result } = play(game, cards);
    expect(result.hand.type).toBe('straight_flush');
    expect(result.score).toBe((90 + 5 + 6 + 7 + 8) * 9);

    const big = makeGame({ jokers: ['big_hand'], round: true });
    expect(big.modifiers().handSize).toBe(10);
    expect(big.state.round!.hand).toHaveLength(10);
  });

  it('allCardsScore: skórují i kopy', () => {
    const game = inRound({ jokers: ['all_score'] });
    const [a, b, k] = setupRound(game, '9S 9H 2C');
    const { result } = play(game, [a!, b!, k!]);
    expect(result.hand.type).toBe('pair');
    expect(result.hand.scoringIds).toEqual([a!.id, b!.id, k!.id]);
    expect(result.score).toBe((12 + 9 + 9 + 2) * 2);
  });

  it('žolík zničený během kroku 4 už neskóruje', () => {
    const reg = makeRegistry({
      jokers: [
        joker('assassin', {
          hooks: {
            onHandPlayed: (ctx) => ctx.api.destroyJoker(ctx.state.jokers[ctx.index + 1]!.uid, 'test'),
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['assassin', 'plus_mult'], round: true });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['assassin']);
    expect(result.score).toBe(17);
  });
});

// ─────────────────────────── Opakování ───────────────────────────

describe('opakované aktivace', () => {
  it('červená pečeť + retriggerScored figur = 3 aktivace', () => {
    const game = inRound({ jokers: ['face_echo'] });
    const [k] = setupRound(game, 'KH@red');
    const { result } = play(game, [k!]);
    expect(result.steps.filter((s) => s.chips === 10)).toHaveLength(3);
    expect(result.steps.filter((s) => s.message === MSG.again)).toHaveLength(2);
    expect(result.score).toBe(36);
  });

  it('retriggerScored nefiguruje u ne-figury', () => {
    const game = inRound({ jokers: ['face_echo'] });
    const [a] = setupRound(game, 'AS');
    expect(play(game, [a!]).result.steps).toHaveLength(2);
  });

  it(`strop MAX_ACTIVATIONS_PER_CARD = ${MAX_ACTIVATIONS_PER_CARD} pro skórující i držené karty`, () => {
    const reg = makeRegistry({
      jokers: [joker('mega_echo', { hooks: { retriggerScored: () => 1000, retriggerHeld: () => Infinity } })],
    });
    const game = makeGame({ registry: reg, jokers: ['mega_echo'], round: true });
    const [a, steel] = setupRound(game, 'AS QS:steel');
    const { result } = play(game, [a!]);
    expect(result.steps.filter((s) => s.cardId === a!.id && s.chips === 11)).toHaveLength(
      MAX_ACTIVATIONS_PER_CARD,
    );
    // Infinity (neplatné číslo) se bere jako 0 opakování
    expect(result.steps.filter((s) => s.cardId === steel!.id && s.xmult === 1.5)).toHaveLength(1);
  });

  it('activationCount: 1 + opakování, nejvýš strop, neplatná čísla = 0', () => {
    expect(activationCount(0)).toBe(1);
    expect(activationCount(2.7)).toBe(3);
    expect(activationCount(-5)).toBe(1);
    expect(activationCount(Number.NaN)).toBe(1);
    expect(activationCount(Infinity)).toBe(1);
    expect(activationCount(99)).toBe(MAX_ACTIVATIONS_PER_CARD);
  });
});

// ─────────────────────────── Kopírující žolíci ───────────────────────────

describe('kopírující žolík (copyTarget)', () => {
  beforeEach(() => {
    hookLog.length = 0;
  });

  it('volá hook cíle s isCopy = true a obalí ho svou edicí; krok patří slotu kopírujícího', () => {
    const game = inRound({ jokers: [{ id: 'copier', edition: 'poly' }, 'plus_mult'] });
    const [copier, plus] = game.state.jokers;
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(steps(result.steps).slice(2)).toEqual([
      { source: 'joker', defId: 'copier', jokerUid: copier!.uid, mult: 4, chipsAfter: 17, multAfter: 5 },
      { source: 'joker', defId: 'copier', jokerUid: copier!.uid, xmult: 1.5, chipsAfter: 17, multAfter: 7.5 },
      { source: 'joker', defId: 'plus_mult', jokerUid: plus!.uid, mult: 4, chipsAfter: 17, multAfter: 11.5 },
    ]);
    expect(result.score).toBe(195);
  });

  it('isCopy se předává do všech hooků (onCardScored i onHandPlayed)', () => {
    const game = inRound({ jokers: ['copier', 'spy'] });
    const spy = game.state.jokers[1]!;
    const [a] = setupRound(game, 'AS');
    play(game, [a!]);
    expect(hookLog).toEqual([
      { hook: 'onCardScored', uid: spy.uid, isCopy: true },
      { hook: 'onCardScored', uid: spy.uid, isCopy: false },
      { hook: 'onHandPlayed', uid: spy.uid, isCopy: true },
      { hook: 'onHandPlayed', uid: spy.uid, isCopy: false },
    ]);
  });

  it('kopie nemění self.state cíle (počítadlo roste jen jednou za ruku)', () => {
    const game = inRound({ jokers: ['copier', 'counter'] });
    const counter = game.state.jokers[1]!;
    const [a] = setupRound(game, 'AS');
    play(game, [a!]);
    expect(counter.state.hands).toBe(1);
    const [b] = setupRound(game, 'AS');
    expect(play(game, [b!]).result.score).toBe(17 * 3);
  });

  it('engine ochrání stav cíle, i když hook isCopy ignoruje', () => {
    const game = inRound({ jokers: ['copier', 'greedy_counter'] });
    const greedy = game.state.jokers[1]!;
    const [a] = setupRound(game, 'AS');
    play(game, [a!]);
    expect(greedy.state.hands).toBe(1);
    expect(greedy.sellBonus).toBe(1);
  });

  it('řetěz kopírujících žolíků dojde až k cíli', () => {
    const game = inRound({ jokers: ['copier', 'copier', 'plus_mult'] });
    const [a] = setupRound(game, 'AS');
    expect(play(game, [a!]).result.score).toBe(17 * 13);
  });

  it('cyklus kopírování nic nedělá a nezacyklí se', () => {
    const game = inRound({ jokers: ['copier', 'copier_left', 'plus_mult'] });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.steps.filter((s) => s.source === 'joker').map((s) => s.defId)).toEqual(['plus_mult']);
    expect(result.score).toBe(17 * 5);
  });

  it('nekopíruje žolíka s copyable: false, debuffnutého ani nic za koncem řady', () => {
    for (const jokers of [
      ['copier', 'uncopyable'],
      ['copier', { id: 'plus_mult', debuffed: true }],
      ['copier'],
    ]) {
      const game = inRound({ jokers });
      const [a] = setupRound(game, 'AS');
      const { result } = play(game, [a!]);
      expect(result.steps.some((s) => s.defId === 'copier')).toBe(false);
    }
  });

  it('kopíruje i opakování (retriggerScored) a beforeScoring', () => {
    const echo = inRound({ jokers: ['copier', 'face_echo'] });
    const [k] = setupRound(echo, 'KS');
    expect(play(echo, [k!]).result.score).toBe(36);
    const lvl = inRound({ jokers: ['copier', 'leveler'] });
    const [a, b] = setupRound(lvl, '9S 9H');
    play(lvl, [a!, b!]);
    expect(lvl.state.handLevels.pair.level).toBe(3);
  });
});

// ─────────────────────────── Šéfové ───────────────────────────

describe('šéf ve skórování', () => {
  it('validateHand: ruka se spotřebuje se skóre 0 a blockedReason; žolíci ani karty nic', () => {
    const game = makeGame({ jokers: ['card_chips', 'leveler'] });
    selectBoss(game, 'neighbour');
    const [a, b] = setupRound(game, '9S 9H');
    expect(play(game, [a!, b!]).result.score).toBeGreaterThan(0);
    const levels = game.state.handLevels.pair.level;
    const before = game.state.round!.score;
    const [c, d] = setupRound(game, '5S 5H');
    const { result } = play(game, [c!, d!]);
    expect(result.score).toBe(0);
    expect(result.blockedReason).toBe(NEIGHBOUR_BLOCKED);
    expect(steps(result.steps)).toEqual([
      { source: 'boss', defId: 'neighbour', message: NEIGHBOUR_BLOCKED, chipsAfter: 0, multAfter: 0 },
    ]);
    const round = game.state.round!;
    expect(round.score).toBe(before);
    expect(round.handsLeft).toBe(2);
    expect(round.discardPile).toEqual(expect.arrayContaining([c!.id, d!.id]));
    expect(game.state.handLevels.pair.level).toBe(levels);
  });

  it('modifyBase: poloviční základ (krok 1)', () => {
    const game = makeGame();
    selectBoss(game, 'halver');
    const [a, b] = setupRound(game, '9S 9H');
    const { result } = play(game, [a!, b!]);
    expect(result.steps[0]).toMatchObject({ source: 'hand', chips: 6, mult: 1 });
    expect(result.score).toBe(24);
  });

  it('šéf vypnutý žolíkem v beforeScoring už základ neupraví', () => {
    const game = makeGame({ jokers: ['boss_breaker'] });
    selectBoss(game, 'halver');
    const [a, b] = setupRound(game, '9S 9H');
    const { result } = play(game, [a!, b!]);
    expect(result.steps[0]).toMatchObject({ chips: 12, mult: 2 });
    expect(result.score).toBe(60);
  });

  it('adjustHandScore: poloviční skóre jako poslední krok', () => {
    const game = makeGame();
    selectBoss(game, 'mayor');
    const [a, b] = setupRound(game, '9S 9H');
    const { result } = play(game, [a!, b!]);
    expect(result.score).toBe(30);
    expect(steps(result.steps).at(-1)).toEqual({
      source: 'boss',
      defId: 'mayor',
      message: MSG.bossAdjusted,
      chipsAfter: 30,
      multAfter: 2,
    });
  });

  it('afterHandPlayed (srážka) běží po skórování', () => {
    const game = makeGame({ money: 4 });
    selectBoss(game, 'tax');
    const [a] = setupRound(game, 'AS@gold');
    play(game, [a!]);
    expect(game.state.money).toBe(4 + 2 - 1);
  });
});

// ─────────────────────────── Náhled ───────────────────────────

describe('previewHand', () => {
  const rngOf = (state: Readonly<RunState>) => JSON.stringify(state.rng);

  it('jen kombinace, úroveň a základ — bez karet, žolíků a náhody', () => {
    const game = inRound({ jokers: ['plus_mult', 'late_train'] });
    const [a, b, lucky] = setupRound(game, '9S 9H AS:lucky', { levels: { pair: 3 } });
    const rng = rngOf(game.state);
    const p = game.preview([a!.id, b!.id, lucky!.id]);
    expect(p).toMatchObject({ chips: 68, mult: 6, level: 3, hidden: false });
    expect(p.hand!.type).toBe('pair');
    expect(rngOf(game.state)).toBe(rng);
    expect(game.preview([lucky!.id])).toMatchObject({ chips: 6, mult: 1, level: 1 });
    expect(game.preview([])).toEqual({ hand: null, chips: 0, mult: 0, level: 0, hidden: false });
  });

  it('se šéfem: modifyBase se projeví i v náhledu', () => {
    const game = makeGame();
    selectBoss(game, 'halver');
    const [a, b] = setupRound(game, '9S 9H');
    expect(game.preview([a!.id, b!.id])).toMatchObject({ chips: 6, mult: 1, level: 1 });
  });

  it('se šéfem: zákaz ruky (validateHand) je v náhledu jako blockedReason, bez posunu RNG', () => {
    const game = makeGame();
    selectBoss(game, 'neighbour');
    const [a, b, c, d] = setupRound(game, '9S 9H 5C 5D KS');
    expect(game.preview([a!.id, b!.id])).not.toHaveProperty('blockedReason');
    play(game, [a!, b!]);
    const rng = rngOf(game.state);
    const p = game.preview([c!.id, d!.id]);
    expect(p.hand!.type).toBe('pair');
    expect(p.blockedReason).toBe(NEIGHBOUR_BLOCKED);
    expect(p).toMatchObject({ level: 1, hidden: false });
    expect(p.chips).toBeGreaterThan(0);
    expect(rngOf(game.state)).toBe(rng);
    // Jiná kombinace projde; vypnutý šéf (Odvolání) nezakazuje nic.
    expect(game.preview([c!.id])).not.toHaveProperty('blockedReason');
    game._core.state.round!.bossDisabled = true;
    expect(game.preview([c!.id, d!.id])).not.toHaveProperty('blockedReason');
  });

  it('karta lícem dolů náhled skryje; mimo kolo jde náhled spočítat', () => {
    const game = inRound();
    const [a, b] = setupRound(game, '9S^ 9H');
    expect(game.preview([a!.id, b!.id]).hidden).toBe(true);
    const idle = makeGame();
    const id = idle.state.deck[0]!.id;
    expect(idle.preview([id])).toMatchObject({ chips: 6, mult: 1, hidden: false });
  });
});

// ─────────────────────────── Velká čísla ───────────────────────────

describe('velká čísla', () => {
  const reg = makeRegistry({
    jokers: [
      joker('big_chips', { hooks: { onHandPlayed: () => ({ chips: 1e12 }) } }),
      joker('big_x', { hooks: { onHandPlayed: () => ({ xmult: 1e6 }) } }),
      joker('huge_x', { hooks: { onHandPlayed: () => ({ xmult: 1e200 }) } }),
      joker('inf_x', { hooks: { onHandPlayed: () => ({ xmult: Infinity }) } }),
      joker('nan', {
        hooks: { onHandPlayed: () => ({ chips: Number.NaN, xmult: Number.NaN, money: Number.NaN }) },
      }),
    ],
  });

  it('nad 1e15 se počítá přesně floor(čipy × mult)', () => {
    const game = makeGame({ registry: reg, jokers: ['big_chips', 'big_x'], round: true });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.chips).toBe(1e12 + 17);
    expect(result.mult).toBe(1e6);
    expect(result.score).toBe(Math.floor((1e12 + 17) * 1e6));
    expect(result.score).toBeGreaterThan(1e15);
  });

  it('přetečení do nekonečna → Number.MAX_VALUE (skóre ruky i kola zůstává konečné)', () => {
    const game = makeGame({ registry: reg, jokers: ['huge_x', 'huge_x'], round: true });
    const round = game._core.state.round!;
    round.target = Number.MAX_VALUE;
    round.score = Number.MAX_VALUE * 0.9;
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.mult).toBe(Number.MAX_VALUE);
    expect(result.score).toBe(Number.MAX_VALUE);
    expect(game.state.phase).toBe('round_end');
    expect(Number.isFinite(game.state.stats.bestHandScore)).toBe(true);
    // stav jde dál uložit přes JSON (nekonečno by se změnilo na null)
    const saved = JSON.parse(JSON.stringify(game.state)) as RunState;
    expect(saved.round!.score).toBe(Number.MAX_VALUE);
  });

  it('×Infinity od žolíka se ořízne na Number.MAX_VALUE', () => {
    const game = makeGame({ registry: reg, jokers: ['inf_x'], round: true });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.mult).toBe(Number.MAX_VALUE);
    expect(result.score).toBe(Number.MAX_VALUE);
  });

  it('NaN ve výsledku efektu se ignoruje (nevynuluje mult ani peníze)', () => {
    const game = makeGame({ registry: reg, jokers: ['nan'], round: true });
    const money = game.state.money;
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(result.score).toBe(17);
    expect(result.steps.some((s) => s.source === 'joker')).toBe(false);
    expect(game.state.money).toBe(money);
  });
});

// ─────────────────────────── Přímé volání pipeline ───────────────────────────

describe('scoreHand (přímo)', () => {
  it('bez karet vyhodí chybu; nemění zahrané karty ani ruku', () => {
    const game = inRound();
    const [a] = setupRound(game, 'AS');
    expect(() => scoreHand(game._core, [])).toThrow();
    const res = scoreHand(game._core, [a!.id]);
    expect(res.score).toBe(17);
    expect(res.playedIds).toEqual([a!.id]);
    expect(game.state.round!.hand).toEqual([a!.id]);
  });

  it('firstHand/lastHand v ScoringInfo', () => {
    const seen: [boolean, boolean][] = [];
    const reg = makeRegistry({
      jokers: [
        joker('flags', { hooks: { onHandPlayed: (ctx) => void seen.push([ctx.firstHand, ctx.lastHand]) } }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['flags'], round: true });
    for (let i = 0; i < 4; i++) {
      const [a] = setupRound(game, '2C');
      play(game, [a!]);
      if (game.state.phase !== 'round') break;
    }
    expect(seen).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ]);
  });
});

describe('addJokers (fixture) respektuje pořadí', () => {
  it('žolíci jdou zleva doprava v pořadí přidání', () => {
    const game = makeGame();
    addJokers(game, ['noop', { id: 'plus_mult', edition: 'holo' }]);
    expect(game.state.jokers.map((j) => [j.defId, j.edition])).toEqual([
      ['noop', null],
      ['plus_mult', 'holo'],
    ]);
  });
});

describe('ScoringInfo v kontextu hooků', () => {
  it('chips a mult jsou živé hodnoty v okamžiku volání; mods a held jsou k dispozici', () => {
    const reg = makeRegistry({
      jokers: [
        joker('doubler', { hooks: { onHandPlayed: (ctx) => ({ chips: ctx.chips, mult: ctx.mult }) } }),
        joker('per_held', {
          hooks: { onHandPlayed: (ctx) => ({ mult: ctx.held.length * (ctx.mods.handSize === 8 ? 1 : 100) }) },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['plus_mult', 'doubler', 'per_held'], round: true });
    const [a] = setupRound(game, 'AS 2C 3D');
    const { result } = play(game, [a!]);
    // 17 čipů, mult 1 + 4 = 5 → doubler: +17 čipů, +5 mult → 34 / 10 → per_held: +2 mult
    expect(result.chips).toBe(34);
    expect(result.mult).toBe(12);
    expect(result.score).toBe(408);
  });
});

describe('peníze ve skórování', () => {
  it('srážka se zapíše ve skutečné výši (oříznutá dluhovým limitem)', () => {
    const reg = makeRegistry({ jokers: [joker('fine', { hooks: { onHandPlayed: () => ({ money: -3 }) } })] });
    const game = makeGame({ registry: reg, jokers: ['fine', 'fine'], money: 1, round: true });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(game.state.money).toBe(0);
    expect(result.moneyEarned).toBe(-1);
    expect(result.steps.filter((s) => s.money !== undefined).map((s) => s.money)).toEqual([-1]);
  });

  it('onCardScored s destroyCard: karta skóruje a po ruce se zničí', () => {
    const reg = makeRegistry({
      jokers: [joker('shredder', { hooks: { onCardScored: () => ({ chips: 1, destroyCard: true }) } })],
    });
    const game = makeGame({ registry: reg, jokers: ['shredder'], round: true });
    const [a, b] = setupRound(game, '9S 9H');
    const { result } = play(game, [a!, b!]);
    expect(result.score).toBe((12 + 10 + 10) * 2);
    expect(result.destroyedCardIds).toEqual([a!.id, b!.id]);
    expect(game.card(a!.id)).toBeUndefined();
  });
});
