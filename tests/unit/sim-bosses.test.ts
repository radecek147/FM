/**
 * Boti a pravidla šéfů (src/engine/sim, docs/DESIGN.md kap. 8 a 12.2): pořadí žolíků pod šéfem, který vypíná
 * pozice, zakázané kombinace, karty lícem dolů, sonda zahození, žolíci vypnutí do první ruky, poslední ruka kola,
 * náhoda ve skórování, přeskakování útrat a letalita šéfů v souhrnu. Každý šéf hry: bot odehraje jeho kolo bez
 * neplatné akce.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import { discardEffects, jokersReturnAfterHand, positionalDebuffs } from '../../src/engine/sim/bots';
import {
  bestUtility,
  blockedTypes,
  cardValue,
  createBot,
  exactScale,
  makeEnv,
  planCandidates,
  simulateRun,
  summarizeRuns,
  type PlayCandidate,
  type RunResult,
} from '../../src/engine/sim/index';
import type { Action, JokerInstance } from '../../src/engine/types';
import { addJokers, boss, joker, makeGame, makeRegistry, selectBoss, setupRound } from './fixtures/registry';

const reg = buildRegistry();
const rng = () => rngFromState([1, 2, 3, 4]);

/**
 * Testovací obsah: šéf vypínající pravou polovinu řady, šéf vypínající žolíky do první ruky, žolíci se skutečným
 * efektem (bot je oceňuje měřením v laboratoři, src/engine/sim/lab.ts): ×2 a ×1,8 > +8 mult > +10 čipů > +2 mult.
 */
const positional = makeRegistry({
  bosses: [
    boss('right_half', {
      hooks: { isJokerDebuffed: (ctx, _joker, index) => index >= Math.ceil(ctx.state.jokers.length / 2) },
    }),
    boss('dark_first', { hooks: { isJokerDebuffed: (ctx) => ctx.round.handsPlayed === 0 } }),
  ],
  jokers: [
    joker('c_chips', { rarity: 'common', tags: ['chips'], hooks: { onHandPlayed: () => ({ chips: 10 }) } }),
    joker('c_mult', { rarity: 'common', tags: ['mult'], hooks: { onHandPlayed: () => ({ mult: 2 }) } }),
    joker('r_mult', { rarity: 'rare', tags: ['mult'], hooks: { onHandPlayed: () => ({ mult: 8 }) } }),
    joker('e_x', { rarity: 'epic', tags: ['xmult'], hooks: { onHandPlayed: () => ({ xmult: 2 }) } }),
    joker('e_x2', { rarity: 'epic', tags: ['xmult'], hooks: { onHandPlayed: () => ({ xmult: 1.8 }) } }),
  ],
});

const working = (game: Game): string[] =>
  game.state.jokers.filter((j: JokerInstance) => !j.debuffed).map((j) => j.defId);

/** Dobere se kolo s danou rukou, cíl je nedosažitelný a zahození dojdou (bot musí hrát). */
function forcedPlay(game: Game, hand: string): void {
  setupRound(game, hand);
  const round = game._core.state.round!;
  round.target = 1_000_000;
  round.discardsLeft = 0;
}

describe('pořadí žolíků pod šéfem, který vypíná pozice', () => {
  it('Jednooký hejtman (pravá polovina): nejlépe hodnocení žolíci jdou na fungující pozice, pak bot nepřeřazuje', () => {
    const game = makeGame({ registry: positional, jokers: ['e_x', 'c_chips', 'e_x2', 'c_mult', 'r_mult'] });
    selectBoss(game, 'right_half');
    expect(
      positionalDebuffs(
        game,
        game.state.jokers.map((j) => j.uid),
      ),
    ).toEqual(new Set([3, 4]));
    const bot = createBot('max');
    const action = bot.decide(game);
    expect(action.type).toBe('reorderJokers');
    expect(game.dispatch(action).ok).toBe(true);
    // Fungují 3 z 5: dva ×mult a +8 mult (měřená hodnota); v rámci fungujících +mult vlevo, ×mult vpravo.
    expect(working(game)).toEqual(['r_mult', 'e_x', 'e_x2']);
    expect(bot.decide(game).type).not.toBe('reorderJokers');
  });

  it('bez šéfa i pod šéfem, který vypíná všechny pozice (Výpadek proudu), platí běžné pořadí', () => {
    const plain = makeGame({ registry: positional, jokers: ['e_x', 'c_chips', 'r_mult'], round: true });
    expect(
      positionalDebuffs(
        plain,
        plain.state.jokers.map((j) => j.uid),
      ).size,
    ).toBe(0);
    const dark = makeGame({ registry: positional, jokers: ['e_x', 'c_chips', 'r_mult'] });
    selectBoss(dark, 'dark_first');
    expect(
      positionalDebuffs(
        dark,
        dark.state.jokers.map((j) => j.uid),
      ).size,
    ).toBe(3);
    const action = createBot('max').decide(dark);
    expect(action.type).toBe('reorderJokers');
    const uids = (action as Extract<Action, { type: 'reorderJokers' }>).uids;
    expect(uids.map((uid) => dark.state.jokers.find((j) => j.uid === uid)!.defId)).toEqual([
      'c_chips',
      'r_mult',
      'e_x',
    ]);
  });
});

describe('žolíci vypnutí jen do první ruky (Výpadek proudu)', () => {
  it('sonda pozná, že se žolíci po zahrané ruce vrátí; pozice Jednookého hejtmana se nevrátí', () => {
    const dark = makeGame({ registry: positional, jokers: ['e_x', 'c_chips'] });
    selectBoss(dark, 'dark_first');
    const hand = dark.state.round!.hand;
    expect(jokersReturnAfterHand(dark, rng(), hand.slice(0, 1))).toBe(true);
    const half = makeGame({ registry: positional, jokers: ['e_x', 'c_chips', 'r_mult'] });
    selectBoss(half, 'right_half');
    expect(jokersReturnAfterHand(half, rng(), half.state.round!.hand.slice(0, 1))).toBe(false);
  });

  it('bot v kole bez žolíků nezahazuje (zahození šetří na ruce se žolíky)', () => {
    const dark = makeGame({ registry: positional, jokers: ['e_x', 'r_mult'] });
    selectBoss(dark, 'dark_first');
    setupRound(dark, '2C 5D 9H JS 3H 8C KD 4S');
    dark._core.state.round!.target = 1_000_000;
    const bot = createBot('max');
    let action = bot.decide(dark);
    while (action.type === 'reorderJokers') {
      dark.dispatch(action);
      action = bot.decide(dark);
    }
    expect(action.type).toBe('play');
  });
});

describe('zakázané kombinace (Soused s vrtačkou)', () => {
  it('náhled označí zakázanou kombinaci a bot zahraje jinou', () => {
    const game = makeGame();
    selectBoss(game, 'neighbour');
    forcedPlay(game, '7H 7S 2C 9D KD 4S 3C JH');
    game._core.state.round!.handTypesPlayed = ['pair'];
    const env = makeEnv(game);
    const hand = game.state.round!.hand.map((id) => cardValue(game.card(id)!, env));
    const cands = planCandidates(game, hand, env, []);
    expect(blockedTypes(cands)).toEqual(new Set(['pair']));
    expect(cands.find((c) => c.type === 'pair')).toMatchObject({ raw: 0, value: 0, blocked: true });
    const action = createBot('max').decide(game) as Extract<Action, { type: 'play' }>;
    expect(action.type).toBe('play');
    expect(game.preview(action.cardIds).hand?.type).not.toBe('pair');
    expect(game.dispatch(action).ok).toBe(true);
  });

  it('se zakázanou kombinací v odhadu (EvalEnv.blocked) má kombinace užitek 0', () => {
    const game = makeGame({ round: true });
    const cards = setupRound(game, '7H 7S 2C');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const free = bestUtility(hand, env);
    const blocked = bestUtility(hand, { ...env, blocked: new Set(['pair']) });
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(free);
  });
});

describe('karty lícem dolů (Výluka na trati, Mlha nad Labem, Bílá paní)', () => {
  it('bot doplní tah kartami lícem dolů (protočí je), odhad počítá jen z viditelných', () => {
    const game = makeGame({ round: true });
    forcedPlay(game, '7H 7S 2C^ 9D^ KD 4S^ 3C JH');
    const action = createBot('max').decide(game) as Extract<Action, { type: 'play' }>;
    expect(action.type).toBe('play');
    const hidden = action.cardIds.filter((id) => game.card(id)!.faceDown);
    expect(hidden.length).toBeGreaterThan(0);
    expect(action.cardIds.length).toBeLessThanOrEqual(5);
    expect(game.dispatch(action).ok).toBe(true);
  });

  it('pod šéfem, který soudí celou ruku (validateHand), karty lícem dolů do tahu nepřidá', () => {
    const game = makeGame();
    selectBoss(game, 'neighbour');
    forcedPlay(game, '7H 7S 2C^ 9D^ KD 4S^ 3C JH');
    const action = createBot('max').decide(game) as Extract<Action, { type: 'play' }>;
    expect(action.type).toBe('play');
    expect(action.cardIds.some((id) => game.card(id)!.faceDown)).toBe(false);
  });
});

describe('sonda zahození (pravidla šéfa, která reagují na zahození a dobírání)', () => {
  const bossRound = (id: string): Game => {
    const game = makeGame({ registry: reg, deckId: 'pub', seed: `FX-${id}` });
    selectBoss(game, id);
    return game;
  };

  it('Bílá paní otočí držené karty, Tchyně vezme jednu navíc, Výluka dobírá lícem dolů', () => {
    const lady = bossRound('white_lady');
    expect(discardEffects(lady, rng(), lady.state.round!.hand.slice(0, 3))).toMatchObject({
      flip: true,
      lost: 0,
    });
    const mil = bossRound('mother_in_law');
    expect(discardEffects(mil, rng(), mil.state.round!.hand.slice(0, 3))).toMatchObject({
      flip: false,
      lost: 1,
    });
    const track = bossRound('track_closure');
    const fx = discardEffects(track, rng(), track.state.round!.hand.slice(0, 4));
    expect(fx.flip).toBe(false);
    expect(fx.hidden).toBeGreaterThan(0);
  });

  it('bez šéfa nebo se šéfem bez takového pravidla nic (a skutečná hra se nezmění)', () => {
    const plain = makeGame({ registry: reg, deckId: 'pub', round: true });
    const before = JSON.stringify(plain.state);
    expect(discardEffects(plain, rng(), plain.state.round!.hand.slice(0, 3))).toEqual({
      lost: 0,
      flip: false,
      hidden: 0,
    });
    const audit = bossRound('tax_audit');
    expect(discardEffects(audit, rng(), audit.state.round!.hand.slice(0, 3))).toEqual({
      lost: 0,
      flip: false,
      hidden: 0,
    });
    expect(JSON.stringify(plain.state)).toBe(before);
  });
});

describe('poslední ruka kola, náhoda a přepočet odhadu', () => {
  it('bestUtility v poslední ruce: ruka, která cíl dosáhne, má navíc celý cíl', () => {
    const game = makeGame({ round: true });
    const cards = setupRound(game, 'AH AS KD');
    const env = makeEnv(game);
    const hand = cards.map((c) => cardValue(c, env));
    const raw = bestUtility(hand, env);
    expect(bestUtility(hand, env, raw / 2, true)).toBe(raw);
    expect(bestUtility(hand, env, raw * 2, true)).toBe(raw);
    expect(bestUtility(hand, env, raw * 2, false)).toBe(raw);
  });

  it('exactScale: medián poměru přesného skóre k odhadu, bez přesných kandidátů 1', () => {
    const c = (raw: number, estRaw: number, exact = true): PlayCandidate => ({
      ids: [1],
      type: 'pair',
      raw,
      value: raw,
      exact,
      estRaw,
    });
    expect(exactScale([])).toBe(1);
    expect(exactScale([c(100, 10, false)])).toBe(1);
    expect(exactScale([c(100, 10), c(300, 100), c(0, 50), c(80, 10)])).toBe(8);
  });

  it('Polední pauza: s jedinou rukou bot zahazuje, dokud ruka cíl spolehlivě nedosáhne', () => {
    const game = makeGame({ registry: reg, deckId: 'pub', seed: 'LUNCH' });
    selectBoss(game, 'lunch_break');
    setupRound(game, '2C 5D 9H JS 3H 8C KD 4S');
    expect(game.state.round!.handsLeft).toBe(1);
    expect(createBot('max').decide(game).type).toBe('discard');
  });
});

describe('každý šéf hry: bot odehraje kolo bez neplatné akce', () => {
  const ids = Object.keys(reg.bosses).sort();
  const jokers = ['old_guard', 'hearts_man', 'innkeeper', 'beer_mat'].filter((id) => reg.jokers[id]);

  it.each(ids.map((id) => [id]))(
    '%s',
    (id) => {
      for (const name of ['max', 'pairs'] as const) {
        const game = makeGame({ registry: reg, deckId: 'pub', seed: `BOSSBOT-${id}`, money: 20 });
        addJokers(game, jokers);
        selectBoss(game, id);
        const bot = createBot(name);
        for (let step = 0; step < 80 && game.state.phase === 'round'; step++) {
          const action = bot.decide(game);
          const res = game.dispatch(action);
          expect(
            res.ok,
            `${name} ${id} krok ${step}: ${JSON.stringify(action)} → ${res.ok ? '' : res.error}`,
          ).toBe(true);
        }
        expect(game.state.phase, `${name} ${id}`).not.toBe('round');
      }
    },
    60_000,
  );
});

describe('souhrn: letalita šéfů a štítky za přeskočení', () => {
  const result = (over: Partial<RunResult>): RunResult => ({
    seed: 'S',
    bot: 'fake',
    deckId: 'pub',
    stake: 1,
    won: false,
    ante: 1,
    blind: 'small',
    cause: 'small',
    score: 0,
    target: 1,
    roundsWon: 0,
    handsPlayed: 0,
    discardsUsed: 0,
    bestHand: 0,
    bestHandType: null,
    moneyEarned: 0,
    moneySpent: 0,
    finalMoney: 0,
    jokersBought: 0,
    jokersSold: 0,
    consumablesUsed: 0,
    rerolls: 0,
    blindsSkipped: 0,
    actions: 1,
    invalidActions: 0,
    invalidByCode: {},
    jokerIds: [],
    jokerRounds: {},
    shopMoney: [],
    bosses: [],
    skipTags: [],
    ...over,
  });

  it('setkání v útratě Šéf a prohry na něm; prohra ve Velké útratě se šéfovi nepočítá', () => {
    const s = summarizeRuns([
      result({ ante: 2, blind: 'boss', cause: 'b', bosses: ['a', 'b'] }),
      result({ ante: 2, blind: 'big', cause: 'c', bosses: ['b'], blindsSkipped: 2, skipTags: ['t1', 't1'] }),
      result({ won: true, ante: 8, blind: 'boss', cause: null, bosses: ['a', 'c'], skipTags: ['t2'] }),
    ]);
    expect(s.bosses).toEqual([
      { id: 'b', encounters: 2, deaths: 1, lethality: 50 },
      { id: 'a', encounters: 2, deaths: 0, lethality: 0 },
      { id: 'c', encounters: 1, deaths: 0, lethality: 0 },
    ]);
    expect(s.skipTags).toEqual({ t1: 2, t2: 1 });
    expect(s.avgSkips).toBeCloseTo(2 / 3);
  });

  it('runner zapisuje šéfy a štítky z událostí běhu', () => {
    const seed = 'RUN-BOSSES';
    const firstBoss = Game.newRun({ seed, deckId: 'pub', stake: 1 }, reg).state.blinds[2]!.bossId;
    const r = simulateRun(reg, { seed, deckId: 'pub', stake: 1, bot: createBot('max') });
    // Šéf každého patra, do jehož útraty Šéf run došel (patro prohry jen při prohře na šéfovi).
    expect(r.bosses).toHaveLength(r.won || r.blind === 'boss' ? r.ante : r.ante - 1);
    if (r.bosses.length > 0) expect(r.bosses[0]).toBe(firstBoss);
    expect(r.skipTags).toHaveLength(r.blindsSkipped);
  }, 60_000);
});
