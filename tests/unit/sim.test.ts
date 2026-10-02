/**
 * Headless simulace (src/engine/sim, scripts/simulate.ts): kouřové testy botů, determinismus, hodnocení rukou,
 * runner a souhrn, příkazy a přepis textového režimu `--play`.
 */
import { describe, expect, it } from 'vitest';
import {
  CliError,
  parseCli,
  PlaySession,
  playScript,
  renderState,
  reportJson,
  reportText,
  runSimulation,
} from '../../scripts/simulate';
import { buildRegistry } from '../../src/content/index';
import type { ContentRegistry } from '../../src/engine/content-types';
import { createCard } from '../../src/engine/cards/cards';
import { detectHand } from '../../src/engine/hands/detect';
import { Game } from '../../src/engine/run/game';
import {
  analyzeCards,
  BOT_NAMES,
  bestUtility,
  cardValue,
  createBot,
  DEFAULT_MAX_ACTIONS,
  estimatePlay,
  exactPlayScore,
  fallbackAction,
  makeEnv,
  parsePlayCommand,
  planCandidates,
  resolveBotName,
  shopOffers,
  simSeed,
  simulateMany,
  simulateRun,
  summarizeRuns,
  type Bot,
  type RunResult,
} from '../../src/engine/sim/index';
import { rngFromState } from '../../src/engine/rng/rng';
import type { Action, Card, HandType, RunState } from '../../src/engine/types';
import { HAND_TYPES, RANKS, SUITS } from '../../src/engine/types';
import { cs, t } from '../../src/i18n/cs';
import { addJokers, makeGame, makeRegistry, setupRound } from './fixtures/registry';

const reg = buildRegistry();
const fixtureReg = makeRegistry();

/** Stabilní RNG pro testy hodnocení. */
const testRng = () => rngFromState([1, 2, 3, 4]);

function ids(cards: readonly Card[]): number[] {
  return cards.map((c) => c.id);
}

/** Hra testovacího obsahu s rozehranou rukou a velkým cílem (aby se zahrání nevyplatilo hned). */
function roundWith(hand: string, opts: { target?: number; registry?: ContentRegistry } = {}) {
  const game = makeGame({ registry: opts.registry ?? fixtureReg, round: true });
  const cards = setupRound(game, hand);
  game._core.state.round!.target = opts.target ?? 100_000;
  return { game, cards };
}

// ─────────────────────────── Boti ───────────────────────────

describe('boti – kouřový test na Desítce (obsah hry)', () => {
  it('jména a aliasy botů podle DESIGN 12.2', () => {
    expect(BOT_NAMES).toEqual(['max', 'flush', 'pairs', 'econ', 'random', 'nojoker']);
    expect(resolveBotName('maxHand')).toBe('max');
    expect(resolveBotName('FlushChaser')).toBe('flush');
    expect(resolveBotName('pairsJokers')).toBe('pairs');
    expect(resolveBotName('economy')).toBe('econ');
    expect(resolveBotName('nojoker')).toBe('nojoker');
    expect(resolveBotName('kdovíco')).toBeNull();
  });

  it.each(BOT_NAMES.map((n) => [n]))(
    '%s: 20 runů doběhne bez výjimky a bez neplatných akcí, výsledky jsou deterministické',
    (name) => {
      const run = () =>
        simulateMany(reg, { runs: 20, seedPrefix: 'TEST', deckId: 'pub', stake: 1, bot: createBot(name) });
      const first = run();
      expect(run()).toEqual(first);
      expect(first).toHaveLength(20);
      for (const r of first) {
        expect(r.invalidActions, `${r.seed}: ${JSON.stringify(r.invalidByCode)}`).toBe(0);
        expect(r.cause).not.toBe('actionLimit');
        expect(r.won || r.cause !== null).toBe(true);
        expect(r.bot).toBe(name);
        expect(r.actions).toBeLessThan(DEFAULT_MAX_ACTIONS);
      }
      expect(new Set(first.map((r) => r.seed)).size).toBe(20);
    },
    60_000,
  );

  it('jedna instance bota pro víc runů: stejný seed = stejný výsledek (paměť a RNG se zakládají znovu)', () => {
    const bot = createBot('max');
    const opts = { seed: 'SAMESEED', deckId: 'pub', stake: 1, bot };
    const a = simulateRun(reg, opts);
    simulateRun(reg, { ...opts, seed: 'OTHERSEED' });
    expect(simulateRun(reg, opts)).toEqual(a);
  });

  it('rozumný bot je výrazně lepší než náhodný; náhodný prohraje v patrech 1–2 (DESIGN 12.1)', () => {
    const max = summarizeRuns(
      simulateMany(reg, { runs: 20, seedPrefix: 'CMP', deckId: 'pub', stake: 1, bot: createBot('max') }),
    );
    const random = summarizeRuns(
      simulateMany(reg, { runs: 20, seedPrefix: 'CMP', deckId: 'pub', stake: 1, bot: createBot('random') }),
    );
    expect(max.avgRoundsWon).toBeGreaterThan(random.avgRoundsWon + 1);
    expect(max.avgBestHand).toBeGreaterThan(random.avgBestHand * 3);
    expect(random.lostAtAnte[0]! + random.lostAtAnte[1]!).toBeGreaterThanOrEqual(0.9 * random.runs);
  }, 60_000);

  it('na vyšší síle piva i s jinými balíčky boti doběhnou bez neplatných akcí', () => {
    for (const [deckId, stake] of [
      ['court', 8],
      ['debtor', 5],
      ['tourist', 3],
      ['nouveau_riche', 2],
    ] as const) {
      const results = simulateMany(reg, {
        runs: 3,
        seedPrefix: 'DECK',
        deckId,
        stake,
        bot: createBot('max'),
      });
      for (const r of results) {
        expect(r.invalidActions).toBe(0);
        expect(r.deckId).toBe(deckId);
        expect(r.stake).toBe(stake);
      }
    }
  }, 60_000);
});

describe('boti – testovací obsah (žolíci, šéfové, štítky, obálky, spotřebky)', () => {
  it.each(BOT_NAMES.map((n) => [n]))(
    '%s: runy doběhnou bez výjimky a bez neplatných akcí, deterministicky',
    (name) => {
      const run = () =>
        simulateMany(fixtureReg, {
          runs: 6,
          seedPrefix: 'FIX',
          deckId: 'test',
          stake: 1,
          bot: createBot(name),
        });
      const first = run();
      expect(run()).toEqual(first);
      for (const r of first) {
        expect(r.invalidActions, `${r.seed}: ${JSON.stringify(r.invalidByCode)}`).toBe(0);
        expect(r.cause).not.toBe('actionLimit');
      }
    },
    60_000,
  );

  it('max kupuje žolíky a používá spotřebky, nojoker žolíky nekupuje; síla žolíků jde do souhrnu', () => {
    const max = simulateMany(fixtureReg, {
      runs: 6,
      seedPrefix: 'BUY',
      deckId: 'test',
      stake: 1,
      bot: createBot('max'),
    });
    expect(max.reduce((a, r) => a + r.jokersBought, 0)).toBeGreaterThan(0);
    expect(max.reduce((a, r) => a + r.consumablesUsed, 0)).toBeGreaterThan(0);
    expect(max.some((r) => r.jokerIds.length > 0)).toBe(true);
    const summary = summarizeRuns(max);
    expect(summary.jokers.length).toBeGreaterThan(0);
    for (const j of summary.jokers) expect(j.runs).toBeGreaterThan(0);
    const nojoker = simulateMany(fixtureReg, {
      runs: 6,
      seedPrefix: 'BUY',
      deckId: 'test',
      stake: 1,
      bot: createBot('nojoker'),
    });
    expect(nojoker.reduce((a, r) => a + r.jokersBought, 0)).toBe(0);
    expect(nojoker.every((r) => r.jokerIds.length === 0)).toBe(true);
  }, 60_000);

  it('bot řadí žolíky: +mult vlevo, ×mult vpravo', () => {
    const registry = makeRegistry({
      jokers: [
        { ...fixtureReg.jokers.times_mult!, tags: ['xmult'] },
        { ...fixtureReg.jokers.plus_mult!, tags: ['mult'] },
      ],
    });
    const game = makeGame({ registry, jokers: ['times_mult', 'plus_mult'] });
    const action = createBot('max').decide(game);
    const [times, plus] = game.state.jokers;
    expect(action).toEqual({ type: 'reorderJokers', uids: [plus!.uid, times!.uid] });
  });
});

// ─────────────────────────── Rozhodování v kole ───────────────────────────

describe('boti – rozhodování v kole', () => {
  it('zahraje ruku, která stačí na cíl', () => {
    const { game, cards } = roundWith('2H 7H 9H KH 4H 3S 8D JC', { target: 50 });
    const action = createBot('max').decide(game);
    expect(action.type).toBe('play');
    const played = (action as { cardIds: number[] }).cardIds;
    expect(played.sort()).toEqual(ids(cards.slice(0, 5)).sort());
  });

  it('flush zahazuje karty mimo svou barvu', () => {
    const { game, cards } = roundWith('AH 9H 6H 3H KS 8C 4D 2S');
    const action = createBot('flush').decide(game);
    expect(action.type).toBe('discard');
    expect((action as { cardIds: number[] }).cardIds.sort()).toEqual(ids(cards.slice(4)).sort());
  });

  it('pairs drží dvojice a zahazuje jednotlivé karty', () => {
    const { game, cards } = roundWith('KH KS 7D 7C 2H 4S 9D JC');
    const action = createBot('pairs').decide(game);
    expect(action.type).toBe('discard');
    const discarded = (action as { cardIds: number[] }).cardIds;
    for (const c of cards.slice(0, 4)) expect(discarded).not.toContain(c.id);
    expect(discarded.length).toBeGreaterThan(0);
  });

  it('bez zahození zahraje nejlepší ruku a doplní ji kartami „na vyhození“', () => {
    const { game, cards } = roundWith('KH KS 2D 7C 3H 4S 9D 5C');
    game._core.state.round!.discardsLeft = 0;
    const action = createBot('max').decide(game) as { type: string; cardIds: number[] };
    expect(action.type).toBe('play');
    expect(action.cardIds).toContain(cards[0]!.id);
    expect(action.cardIds).toContain(cards[1]!.id);
    // Doplněno o karty mimo rozehrané kombinace (2–5 patří do okna postupky, ty si bot nechá).
    expect(action.cardIds.length).toBeGreaterThan(2);
    for (const c of [cards[5]!, cards[7]!]) expect(action.cardIds).not.toContain(c.id);
  });

  it('karty lícem dolů bot nevidí — nepočítá s nimi do kombinace', () => {
    const { game, cards } = roundWith('KH KS^ 2D 7C 3H 4S 9D 5C');
    const env = makeEnv(game);
    const hand = game.state.round!.hand.map((id) => cardValue(game.card(id)!, env));
    expect(analyzeCards(hand, env).some((c) => c.type === 'pair')).toBe(false);
    const action = createBot('max').decide(game);
    if (action.type === 'play') expect(action.cardIds).not.toContain(cards[1]!.id);
  });

  it('se žolíky a pravidlem šéfa hodnotí tahy přesně na kopii hry (šéf, který opakování nepustí)', () => {
    const game = makeGame({ registry: fixtureReg });
    const s = game._core.state;
    s.blinds[2]!.bossId = 'neighbour';
    s.blinds[0]!.status = 'skipped';
    s.blinds[1]!.status = 'skipped';
    s.blinds[2]!.status = 'current';
    s.blindIndex = 2;
    game.dispatch({ type: 'selectBlind' });
    const cards = setupRound(game, 'KH KS 2D 7C 3H 4S 9D 5C');
    s.round!.handTypesPlayed = ['pair'];
    s.round!.discardsLeft = 0;
    s.round!.target = 100_000;
    const action = createBot('max').decide(game) as { type: string; cardIds: number[] };
    expect(action.type).toBe('play');
    // Dvojice by se nepočítala — bot zahraje Vysokou kartu (král) místo ní.
    expect(game.preview(action.cardIds).hand?.type).toBe('high_card');
    expect(action.cardIds).toContain(cards[0]!.id);
  });
});

// ─────────────────────────── Hodnocení rukou ───────────────────────────

describe('hodnocení rukou (hand-eval)', () => {
  it('analyzeCards najde nejlepší sadu karet pro každou kombinaci', () => {
    const { game, cards } = roundWith('AH KH QH JH 10H 2S 2D 5C');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const byType = new Map<string, number[]>();
    for (const c of analyzeCards(hand, env))
      if (!byType.has(c.type)) byType.set(c.type, ids(c.cards.map((x) => x.card)));
    expect(byType.get('royal_flush')!.sort()).toEqual(ids(cards.slice(0, 5)).sort());
    expect(byType.get('straight')).toHaveLength(5);
    expect(byType.get('flush')).toHaveLength(5);
    expect(byType.get('pair')!.sort()).toEqual(ids(cards.slice(5, 7)).sort());
    expect(byType.get('high_card')).toEqual([cards[0]!.id]);
  });

  it('najde Full house, Čtveřici, Dvě dvojice a kamenné karty přidá, když se vejdou', () => {
    const { game, cards } = roundWith('9H 9S 9D 4C 4H 9C 2S:stone 6D');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const types = new Set(analyzeCards(hand, env).map((c) => c.type));
    for (const type of ['four', 'full_house', 'two_pair', 'three', 'pair'])
      expect(types.has(type as never)).toBe(true);
    const four = analyzeCards(hand, env).find((c) => c.type === 'four')!;
    expect(four.cards.map((c) => c.id)).toContain(cards[6]!.id);
  });

  it('postupky s modifikátory (4 karty, mezery, kolem dokola) i Eso nízko', () => {
    const { game, cards } = roundWith('AS 2H 3D 4C 5S KD QH 8C');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const straight = analyzeCards(hand, env).find((c) => c.type === 'straight')!;
    expect(straight.cards.map((c) => c.id).sort()).toEqual(ids(cards.slice(0, 5)).sort());
    const mods = (delta: object) => ({ ...env, mods: { ...env.mods, ...delta } });
    const gaps = roundWith('3S 5H 6D 8C 9S KD 2H 2C');
    const gapHand = gaps.cards.map((c) => cardValue(c, env));
    expect(analyzeCards(gapHand, env).some((c) => c.type === 'straight')).toBe(false);
    expect(analyzeCards(gapHand, mods({ straightGaps: true })).some((c) => c.type === 'straight')).toBe(true);
    const wrap = roundWith('QS KH AD 2C 3S 7D 7H 9C');
    const wrapHand = wrap.cards.map((c) => cardValue(c, env));
    expect(analyzeCards(wrapHand, env).some((c) => c.type === 'straight')).toBe(false);
    expect(analyzeCards(wrapHand, mods({ straightWrap: true })).some((c) => c.type === 'straight')).toBe(
      true,
    );
    const four = roundWith('JH QH KH AH 2S 7D 7C 9C');
    const fourHand = four.cards.map((c) => cardValue(c, env));
    const fourTypes = analyzeCards(fourHand, mods({ fourCardStraightFlush: true })).map((c) => c.type);
    expect(fourTypes).toContain('royal_flush');
    expect(fourTypes).toContain('flush');
  });

  it('odhad tahu bez žolíků a náhody sedí přesně na skóre enginu', () => {
    const hands = [
      'KH KS 2D 7C 3H',
      '2H 7H 9H KH 4H',
      'AS:bonus AH:mult 5D 5C~foil 9S',
      '8D 8H~holo 8S@red QC QS',
      '10H JH QH KH AH',
      '4S 4D 9C:stone 2H 2S',
    ];
    for (const spec of hands) {
      const { game, cards } = roundWith(`${spec} 3C:steel 6D`, { target: 1_000_000 });
      const env = makeEnv(game);
      const byId = new Map(game.state.round!.hand.map((id) => [id, cardValue(game.card(id)!, env)]));
      const play = ids(cards.slice(0, 5));
      const est = estimatePlay(game, play, byId, env)!;
      const res = game.dispatch({ type: 'play', cardIds: play });
      expect(res.ok).toBe(true);
      const ev = res.ok ? res.events.find((e) => e.type === 'handPlayed') : undefined;
      expect(ev && ev.type === 'handPlayed' ? ev.result.score : -1, spec).toBe(Math.floor(est.raw));
    }
  });

  it('nejsilnější kombinace z rychlé analýzy = detekce enginu na celé ruce (i s modifikátory)', () => {
    const rng = testRng();
    const game = makeGame({ registry: fixtureReg });
    const base = makeEnv(game);
    const variants = [
      {},
      { fourCardStraightFlush: true },
      { straightGaps: true },
      { straightWrap: true },
      { mergedSuits: true },
    ];
    let checked = 0;
    for (const delta of variants) {
      const env = { ...base, mods: { ...base.mods, ...delta } };
      for (let i = 0; i < 300; i++) {
        const cards = Array.from({ length: 8 }, (_, k) =>
          createCard(k + 1, {
            rank: rng.pick(RANKS),
            suit: rng.pick(SUITS),
            enhancement: rng.chance(0.08) ? 'wild' : rng.chance(0.05) ? 'stone' : null,
          }),
        );
        const strongest = (types: readonly HandType[]) =>
          types.reduce(
            (a, b) => (HAND_TYPES.indexOf(b) > HAND_TYPES.indexOf(a) ? b : a),
            'high_card' as HandType,
          );
        const ours = strongest(
          analyzeCards(
            cards.map((c) => cardValue(c, env)),
            env,
          ).map((c) => c.type),
        );
        const engine = detectHand(cards, { mods: env.mods, enhancements: fixtureReg.enhancements })!.type;
        expect(
          ours,
          JSON.stringify({ delta, cards: cards.map((c) => [c.rank, c.suit, c.enhancement]) }),
        ).toBe(engine);
        checked++;
      }
    }
    expect(checked).toBe(1500);
  });

  it('bestUtility ořízne hodnotu na zbývající cíl', () => {
    const { game, cards } = roundWith('10H JH QH KH AH 2S 2D 5C');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    expect(bestUtility(hand, env)).toBeGreaterThan(1000);
    expect(bestUtility(hand, env, 300)).toBe(300);
    expect(bestUtility([], env)).toBe(0);
  });

  it('exactPlayScore počítá se žolíky a hru nemění', () => {
    const { game, cards } = roundWith('KH KS 2D 7C 3H 4S 9D 5C');
    addJokers(game, ['times_mult']);
    const before = JSON.stringify(game.state);
    const env = makeEnv(game);
    const byId = new Map(game.state.round!.hand.map((id) => [id, cardValue(game.card(id)!, env)]));
    const est = estimatePlay(game, ids(cards.slice(0, 2)), byId, env)!;
    expect(exactPlayScore(game, ids(cards.slice(0, 2)), testRng())).toBe(Math.floor(est.raw * 2));
    expect(JSON.stringify(game.state)).toBe(before);
    expect(exactPlayScore(game, [999_999], testRng())).toBe(-1);
  });

  it('planCandidates vrací tahy seřazené od nejlepšího a doplněné kartami na vyhození', () => {
    const { game, cards } = roundWith('KH KS 2D 7C 3H 4S 9D 5C');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const filler = [hand[2]!, hand[4]!, hand[5]!];
    const cands = planCandidates(game, hand, env, filler);
    expect(cands[0]!.type).toBe('pair');
    expect(cands[0]!.ids).toHaveLength(5);
    for (let i = 1; i < cands.length; i++)
      expect(cands[i - 1]!.value).toBeGreaterThanOrEqual(cands[i]!.value);
  });
});

// ─────────────────────────── Runner a souhrn ───────────────────────────

/** Bot, který v kole jen třídí ruku (platná akce bez pokroku) a jinde posílá nesmysl. */
const stubbornBot: Bot = {
  name: 'stubborn',
  decide: (game) =>
    game.state.phase === 'round' ? { type: 'sortHand', by: 'rank' } : { type: 'buy', slot: 99 },
};

function fakeResult(over: Partial<RunResult>): RunResult {
  return {
    seed: 'S',
    bot: 'fake',
    deckId: 'pub',
    stake: 1,
    won: false,
    ante: 1,
    blind: 'small',
    cause: 'small',
    score: 100,
    target: 200,
    roundsWon: 0,
    handsPlayed: 4,
    discardsUsed: 0,
    bestHand: 50,
    bestHandType: 'pair',
    moneyEarned: 0,
    moneySpent: 0,
    finalMoney: 5,
    jokersBought: 0,
    jokersSold: 0,
    consumablesUsed: 0,
    rerolls: 0,
    blindsSkipped: 0,
    actions: 10,
    invalidActions: 0,
    invalidByCode: {},
    jokerIds: [],
    jokerRounds: {},
    shopMoney: [],
    bosses: [],
    skipTags: [],
    ...over,
  };
}

describe('runner a souhrn', () => {
  it('seed runu i je SIM-<prefix>-<i>', () => {
    expect(simSeed('A', 7)).toBe('SIM-A-7');
  });

  it('limit akcí ukončí zacyklený run (příčina actionLimit), neplatné akce se počítají a obejdou', () => {
    const r = simulateRun(reg, { seed: 'LOOP', deckId: 'pub', stake: 1, bot: stubbornBot, maxActions: 40 });
    expect(r.actions).toBe(40);
    expect(r.cause).toBe('actionLimit');
    expect(r.won).toBe(false);
    expect(r.invalidActions).toBeGreaterThanOrEqual(3);
    expect(r.invalidByCode.wrongPhase).toBeGreaterThanOrEqual(3);
  });

  it('fallbackAction má bezpečnou akci pro každou fázi', () => {
    const game = Game.newRun({ seed: 'FALLBACK', deckId: 'pub', stake: 1 }, reg);
    const s = game._core.state as RunState;
    const expected: [RunState['phase'], Action['type']][] = [
      ['blind_select', 'selectBlind'],
      ['round_end', 'cashOut'],
      ['shop', 'leaveShop'],
      ['booster', 'skipBooster'],
      ['victory', 'continueEndless'],
      ['game_over', 'selectBlind'],
    ];
    for (const [phase, type] of expected) {
      s.phase = phase;
      expect(fallbackAction(game).type).toBe(type);
    }
    s.phase = 'blind_select';
    game.dispatch({ type: 'selectBlind' });
    expect(fallbackAction(game)).toEqual({ type: 'play', cardIds: [game.state.round!.hand[0]] });
  });

  it('summarizeRuns: výhry, dosažená patra, prohry podle patra, příčiny, peníze a síla žolíků', () => {
    const results = [
      fakeResult({
        won: true,
        cause: null,
        ante: 8,
        blind: 'boss',
        bestHand: 1000,
        jokerIds: ['a'],
        shopMoney: [{ ante: 1, money: 10 }],
      }),
      fakeResult({
        ante: 3,
        cause: 'boss_x',
        bestHand: 300,
        jokerIds: ['a', 'b'],
        shopMoney: [{ ante: 1, money: 6 }],
      }),
      fakeResult({ ante: 3, cause: 'boss_x', bestHand: 200, score: 50, target: 100 }),
      fakeResult({ ante: 1, cause: 'small', bestHand: 100, invalidActions: 2 }),
    ];
    const s = summarizeRuns(results);
    expect(s.runs).toBe(4);
    expect(s.wins).toBe(1);
    expect(s.winRate).toBe(25);
    expect(s.reachedAnte).toEqual([4, 3, 3, 1, 1, 1, 1, 1]);
    expect(s.lostAtAnte).toEqual([1, 0, 2, 0, 0, 0, 0, 0]);
    expect(s.causes).toEqual([
      { cause: 'boss_x', count: 2 },
      { cause: 'small', count: 1 },
    ]);
    expect(s.topCause).toBe('boss_x');
    expect(s.avgBestHand).toBe(400);
    expect(s.medianBestHand).toBe(250);
    expect(s.avgShopMoney).toEqual({ 1: 8 });
    expect(s.invalidActions).toBe(2);
    const a = s.jokers.find((j) => j.id === 'a')!;
    expect(a).toMatchObject({ runs: 2, wins: 1, winRateWith: 50, winRateWithout: 0, delta: 50 });
    const b = s.jokers.find((j) => j.id === 'b')!;
    expect(b.delta).toBeCloseTo(-100 / 3);
    expect(s.jokers[0]!.id).toBe('a');
    expect(summarizeRuns([]).winRate).toBe(0);
    expect(summarizeRuns(results, 2).jokers.map((j) => j.id)).toEqual(['a']);
  });
});

// ─────────────────────────── Textový režim ───────────────────────────

const ERROR_TEXTS = new Set([
  ...Object.keys(cs.errors).map((k) => t(`errors.${k}`)),
  ...Object.keys(cs.cli.play.errors).map((k) => t(`cli.play.errors.${k}`)),
]);

/** Akce bota → příkaz textového režimu (stejné číslování jako výpis). */
function toCommand(game: Game, a: Action): string {
  const s = game.state;
  const pos = (list: readonly number[], pool: readonly number[]) =>
    list.map((id) => pool.indexOf(id) + 1).join(' ');
  const offerIndex = (kind: 'item' | 'voucher', slot: number) =>
    shopOffers(s).findIndex((o) => o.kind === kind && o.slot === slot) + 1;
  const pool = s.phase === 'booster' ? (s.booster?.hand ?? []) : (s.round?.hand ?? []);
  const targets = (list?: number[]) => (list && list.length > 0 ? ` ${pos(list, pool)}` : '');
  switch (a.type) {
    case 'selectBlind':
      return 'v';
    case 'skipBlind':
    case 'skipBooster':
      return 'p';
    case 'play':
      return `h ${pos(a.cardIds, s.round!.hand)}`;
    case 'discard':
      return `z ${pos(a.cardIds, s.round!.hand)}`;
    case 'cashOut':
    case 'leaveShop':
    case 'continueEndless':
      return 'd';
    case 'buy':
      return `k ${offerIndex('item', a.slot)}`;
    case 'buyAndUse':
      return `ku ${offerIndex('item', a.slot)}`;
    case 'buyVoucher':
      return `k ${offerIndex('voucher', a.slot)}`;
    case 'buyBooster':
      return `o ${a.slot + 1}`;
    case 'reroll':
      return 'r';
    case 'pickBooster':
      return a.keep ? `ul ${a.index + 1}` : `k ${a.index + 1}${targets(a.targetIds)}`;
    case 'useConsumable':
      return `u ${s.consumables.findIndex((c) => c.uid === a.uid) + 1}${targets(a.targetIds)}`;
    case 'sellJoker':
      return `pz ${s.jokers.findIndex((j) => j.uid === a.uid) + 1}`;
    case 'sellConsumable':
      return `ps ${s.consumables.findIndex((c) => c.uid === a.uid) + 1}`;
    case 'reorderJokers': {
      const cur = s.jokers.map((j) => j.uid);
      const i = cur.findIndex((uid, k) => uid !== a.uids[k]);
      return `m ${cur.indexOf(a.uids[i]!) + 1} ${i + 1}`;
    }
    case 'sortHand':
      return a.by === 'rank' ? 's' : 'b';
    default:
      throw new Error(`bez příkazu: ${a.type}`);
  }
}

/** Odehraje celý run v textovém režimu příkazy podle bota; vrací přepis a hru. */
function playWholeRunAsText(registry: ContentRegistry, deck: string, seed: string, botName = 'max' as const) {
  const game = Game.newRun({ seed, deckId: deck, stake: 1 }, registry);
  const session = new PlaySession(game);
  const bot = createBot(botName);
  const out = session.intro({ seed, deck, stake: 1, script: null });
  let errors = 0;
  for (let step = 0; step < 2000 && !session.done; step++) {
    if (game.state.phase === 'victory') {
      out.push(...session.input('q'));
      break;
    }
    const cmd = toCommand(game, bot.decide(game));
    out.push(`> ${cmd}`, ...session.input(cmd));
    if (out.some((line) => ERROR_TEXTS.has(line))) errors++;
  }
  return { game, session, out, errors };
}

describe('textový režim (--play)', () => {
  it('parsePlayCommand převádí příkazy na akce podle pozic ve výpisu', () => {
    const game = Game.newRun({ seed: 'CMDTEST', deckId: 'pub', stake: 1 }, reg);
    expect(parsePlayCommand(game, '')).toEqual({ kind: 'show' });
    expect(parsePlayCommand(game, '?')).toEqual({ kind: 'help' });
    expect(parsePlayCommand(game, 'q')).toEqual({ kind: 'quit' });
    expect(parsePlayCommand(game, 'blabla')).toEqual({ kind: 'error', reason: 'unknown' });
    expect(parsePlayCommand(game, 'h 1')).toEqual({ kind: 'error', reason: 'phase' });
    expect(parsePlayCommand(game, 'l')).toEqual({ kind: 'error', reason: 'phase' });
    expect(parsePlayCommand(game, 'p')).toEqual({ kind: 'action', action: { type: 'skipBlind' } });
    expect(parsePlayCommand(game, 'v')).toEqual({ kind: 'action', action: { type: 'selectBlind' } });
    game.dispatch({ type: 'selectBlind' });
    const hand = game.state.round!.hand;
    expect(parsePlayCommand(game, 'h 1 3')).toEqual({
      kind: 'action',
      action: { type: 'play', cardIds: [hand[0], hand[2]] },
    });
    expect(parsePlayCommand(game, '  Z 2  ')).toEqual({
      kind: 'action',
      action: { type: 'discard', cardIds: [hand[1]] },
    });
    expect(parsePlayCommand(game, 'n 1 2')).toEqual({ kind: 'preview', cardIds: [hand[0], hand[1]] });
    expect(parsePlayCommand(game, 's')).toEqual({ kind: 'action', action: { type: 'sortHand', by: 'rank' } });
    expect(parsePlayCommand(game, 'b')).toEqual({ kind: 'action', action: { type: 'sortHand', by: 'suit' } });
    expect(parsePlayCommand(game, 'l')).toEqual({ kind: 'deck' });
    for (const bad of ['h', 'h 9', 'h 0', 'h x', 's 1', 'u 1', 'pz 1', 'm 1 2', 'k x'])
      expect(parsePlayCommand(game, bad), bad).toEqual({ kind: 'error', reason: 'args' });
    for (const wrong of ['v', 'p', 'd', 'r', 'o 1', 'ku 1', 'ul 1', 'k 1'])
      expect(parsePlayCommand(game, wrong), wrong).toEqual({ kind: 'error', reason: 'phase' });
  });

  it('příkazy Večerky, obálek, spotřebek a žolíků', () => {
    const game = makeGame({ registry: fixtureReg, jokers: ['noop', 'plus_mult', 'times_mult'] });
    const s = game._core.state;
    const [j1, j2, j3] = s.jokers;
    expect(parsePlayCommand(game, 'm 3 1')).toEqual({
      kind: 'action',
      action: { type: 'reorderJokers', uids: [j3!.uid, j1!.uid, j2!.uid] },
    });
    expect(parsePlayCommand(game, 'pz 2')).toEqual({
      kind: 'action',
      action: { type: 'sellJoker', uid: j2!.uid },
    });
    s.consumables.push({ uid: 900, defId: 'pr_pair', edition: null });
    expect(parsePlayCommand(game, 'ps 1')).toEqual({
      kind: 'action',
      action: { type: 'sellConsumable', uid: 900 },
    });
    expect(parsePlayCommand(game, 'u 1')).toEqual({
      kind: 'action',
      action: { type: 'useConsumable', uid: 900 },
    });
    // Do Večerky přes vyhrané kolo.
    game.dispatch({ type: 'selectBlind' });
    s.round!.target = 1;
    game.dispatch({ type: 'play', cardIds: [s.round!.hand[0]!] });
    game.dispatch({ type: 'cashOut' });
    expect(game.state.phase).toBe('shop');
    const offers = shopOffers(game.state);
    expect(offers.length).toBe(game.state.shop!.items.length + game.state.shop!.vouchers.length);
    expect(parsePlayCommand(game, 'k 1')).toEqual({ kind: 'action', action: { type: 'buy', slot: 0 } });
    expect(parsePlayCommand(game, 'ku 1')).toEqual({
      kind: 'action',
      action: { type: 'buyAndUse', slot: 0 },
    });
    expect(parsePlayCommand(game, 'o 2')).toEqual({
      kind: 'action',
      action: { type: 'buyBooster', slot: 1 },
    });
    expect(parsePlayCommand(game, 'r')).toEqual({ kind: 'action', action: { type: 'reroll' } });
    expect(parsePlayCommand(game, 'd')).toEqual({ kind: 'action', action: { type: 'leaveShop' } });
    expect(parsePlayCommand(game, 'k 99')).toEqual({ kind: 'error', reason: 'args' });
    expect(parsePlayCommand(game, 'k 1 2')).toEqual({ kind: 'error', reason: 'args' });
    s.phase = 'booster';
    s.booster = {
      boosterId: 'rada_pack',
      options: [],
      picksLeft: 1,
      hand: [s.deck[0]!.id, s.deck[1]!.id],
      returnTo: 'shop',
    };
    expect(parsePlayCommand(game, 'k 2 1 2')).toEqual({
      kind: 'action',
      action: { type: 'pickBooster', index: 1, targetIds: [s.deck[0]!.id, s.deck[1]!.id] },
    });
    expect(parsePlayCommand(game, 'k 1')).toEqual({
      kind: 'action',
      action: { type: 'pickBooster', index: 0 },
    });
    expect(parsePlayCommand(game, 'ul 3')).toEqual({
      kind: 'action',
      action: { type: 'pickBooster', index: 2, keep: true },
    });
    expect(parsePlayCommand(game, 'p')).toEqual({ kind: 'action', action: { type: 'skipBooster' } });
    expect(parsePlayCommand(game, 'u 1 2')).toEqual({
      kind: 'action',
      action: { type: 'useConsumable', uid: 900, targetIds: [s.deck[1]!.id] },
    });
    s.phase = 'victory';
    expect(parsePlayCommand(game, 'd')).toEqual({ kind: 'action', action: { type: 'continueEndless' } });
  });

  it('--play --script odehraje pár tahů česky', () => {
    const out = playScript({
      seed: 'PLAYTEST',
      deck: 'pub',
      stake: 1,
      script: ['?', 'v', 'n 1 2', 'h 1 2 3 4 5', 'z 1 2', 's', 'b', 'l', 'k 1', 'h 99', 'xyz', ''],
    });
    const text = out.join('\n');
    expect(text).not.toMatch(/⟦/);
    expect(out[0]).toContain('PLAYTEST');
    expect(text).toContain(t('cli.play.header', { ante: 1, final: 8, what: t('cli.blind.small') }));
    expect(text).toContain('> h 1 2 3 4 5');
    expect(out.some((l) => l.includes(' → ') && l.includes(' × '))).toBe(true);
    expect(out.some((l) => l.startsWith('Zahozeno:'))).toBe(true);
    expect(out.some((l) => l.includes('balíčku zbývá'))).toBe(true);
    expect(text).toContain(t('cli.play.errors.args'));
    expect(text).toContain(t('cli.play.errors.unknown'));
    expect(text).toContain(t('cli.play.errors.phase'));
    expect(out[out.length - 1]).toBe(t('cli.play.scriptEnd'));
    // Stejný seed a příkazy = stejný přepis.
    expect(
      playScript({
        seed: 'PLAYTEST',
        deck: 'pub',
        stake: 1,
        script: ['?', 'v', 'n 1 2', 'h 1 2 3 4 5', 'z 1 2', 's', 'b', 'l', 'k 1', 'h 99', 'xyz', ''],
      }),
    ).toEqual(out);
  });

  it('celý run jde dohrát v textovém režimu až do pitvy (obsah hry)', () => {
    const { game, session, out, errors } = playWholeRunAsText(reg, 'pub', 'TEXTRUN');
    expect(errors).toBe(0);
    expect(session.done).toBe(true);
    expect(game.state.phase).toBe('game_over');
    const text = out.join('\n');
    expect(text).not.toMatch(/⟦/);
    expect(text).toContain(t('cli.play.gameOver.title'));
    expect(text).toContain(t('cli.play.roundEnd.title'));
    expect(text).toContain(t('cli.play.shop.title'));
  });

  it('v textovém režimu jdou Večerka, obálky, spotřebky a žolíci (testovací obsah)', () => {
    const { session, out, errors } = playWholeRunAsText(fixtureReg, 'test', 'TEXTFIX');
    expect(errors).toBe(0);
    expect(session.done).toBe(true);
    const text = out.join('\n');
    expect(text).not.toMatch(/⟦/);
    expect(out.some((l) => l.startsWith('Koupeno:'))).toBe(true);
    expect(out.some((l) => l.startsWith('> o '))).toBe(true);
    expect(text).toContain(t('cli.play.shop.offers'));
    expect(text).toContain(t('cli.play.shop.boosters'));
  });

  it('výpis výhry a nekonečného režimu', () => {
    const game = Game.newRun({ seed: 'WINTEXT', deckId: 'pub', stake: 1 }, reg);
    (game._core.state as RunState).phase = 'victory';
    expect(renderState(game).join('\n')).toContain(t('cli.play.victory.line'));
    const session = new PlaySession(game);
    const out = session.input('d');
    expect(out).toContain(t('cli.play.events.endless'));
    expect(game.state.phase).toBe('round_end');
  });
});

// ─────────────────────────── scripts/simulate.ts ───────────────────────────

describe('scripts/simulate – volby a výstup', () => {
  it('parseCli: výchozí hodnoty, boti, aliasy, --json se souborem i bez', () => {
    const def = parseCli([], reg);
    expect(def).toEqual({
      mode: 'sim',
      sim: {
        runs: 500,
        stake: 1,
        deck: 'pub',
        bots: [...BOT_NAMES],
        seedPrefix: 'A',
        maxActions: undefined,
        json: null,
      },
    });
    const custom = parseCli(
      ['--runs', '7', '--stake', '3', '--bot', 'maxHand,flush,max', '--seed-prefix', 'X', '--json'],
      reg,
    );
    expect(custom).toMatchObject({
      mode: 'sim',
      sim: { runs: 7, stake: 3, bots: ['max', 'flush'], seedPrefix: 'X', json: '-' },
    });
    expect(parseCli(['--json', 'out.json', '--strategy', 'random'], reg)).toMatchObject({
      sim: { json: 'out.json', bots: ['random'] },
    });
    expect(parseCli(['--max-actions', '100'], reg)).toMatchObject({ sim: { maxActions: 100 } });
    expect(parseCli(['--help'], reg)).toEqual({ mode: 'help' });
    expect(parseCli(['--play', '--seed', 'ABC', '--script', 'v; h 1 2 ;d'], reg)).toEqual({
      mode: 'play',
      play: { seed: 'ABC', deck: 'pub', stake: 1, script: ['v', 'h 1 2', 'd'] },
    });
    const interactive = parseCli(['--play'], reg);
    expect(interactive.mode === 'play' && interactive.play.script).toBeNull();
    expect(interactive.mode === 'play' && interactive.play.seed).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('parseCli: chyby česky', () => {
    for (const args of [
      ['--runs', '0'],
      ['--runs', 'pět'],
      ['--stake', '9'],
      ['--deck', 'neexistuje'],
      ['--bot', 'nikdo'],
      ['--neznama'],
    ])
      expect(() => parseCli(args, reg), args.join(' ')).toThrow(CliError);
    expect(() => parseCli(['--stake', '9'], reg)).toThrow(t('cli.errors.stake', { max: 8 }));
  });

  it('výstup simulace je česky (DESIGN 12.3) a pro stejné parametry deterministický', () => {
    const opts = {
      runs: 3,
      stake: 1,
      deck: 'pub',
      bots: ['max', 'random'] as const,
      seedPrefix: 'T',
      maxActions: undefined,
      json: null,
    };
    const a = runSimulation({ ...opts, bots: [...opts.bots] }, reg);
    const b = runSimulation({ ...opts, bots: [...opts.bots] }, reg);
    expect(reportJson(a)).toBe(reportJson(b));
    expect(JSON.parse(reportJson(a)).summaries.max.runs).toBe(3);
    const text = reportText(a, reg).join('\n');
    expect(text).not.toMatch(/⟦/);
    expect(text).toContain(t('cli.sim.title'));
    expect(text).toContain('Dosažená patra:');
    expect(text).toContain('Nejčastější příčina prohry:');
    expect(text).toContain('Nejlepší rozumná strategie');
    // Obsah už má žolíky → poznámka o odložené kalibraci se nezobrazuje.
    expect(text).not.toContain(t('cli.sim.calibration'));
  });

  it('výstup se žolíky ukáže nejsilnější žolíky (testovací obsah)', () => {
    const report = runSimulation(
      { runs: 6, stake: 1, deck: 'test', bots: ['max'], seedPrefix: 'J', maxActions: undefined, json: null },
      fixtureReg,
    );
    const text = reportText(report, fixtureReg).join('\n');
    expect(text).not.toMatch(/⟦/);
    expect(text).toContain(t('cli.sim.jokersTitle'));
    expect(text).not.toContain(t('cli.sim.calibration'));
  });
});
