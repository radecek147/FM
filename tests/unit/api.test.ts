/**
 * Rozšíření enginu z docs/DESIGN.md přílohy B (EngineApi, nové hooky, modifikátory) a pravidla skórování
 * z kap. 2.7, 2.8 a 3.1 (Ohmataná, sklo jednou za ruku, opakování, Bílá hora, Normalizace).
 */
import { describe, expect, it } from 'vitest';
import type { TagDef } from '../../src/engine/content-types';
import { MAX_ACTIVATIONS_PER_CARD, MSG } from '../../src/engine/constants';
import { handValueAtLevel } from '../../src/engine/hands/levels';
import { generateShop } from '../../src/engine/shop/shop';
import type { GameEvent, HandType, ScoreResult } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';
import type { Game } from '../../src/engine/run/game';
import {
  ART,
  boss,
  booster,
  consumable,
  gameInRound,
  joker,
  makeRegistry,
  newGame,
  setHand,
  spec,
} from './engine-fixtures';
import * as fx from './fixtures/registry';

function play(game: Game, ids: number[]): { result: ScoreResult; events: GameEvent[] } {
  const res = game.dispatch({ type: 'play', cardIds: ids });
  if (!res.ok) throw new Error(`play failed: ${res.error}`);
  const ev = res.events.find((e) => e.type === 'handPlayed');
  if (!ev || ev.type !== 'handPlayed') throw new Error('no handPlayed');
  return { result: ev.result, events: res.events };
}

/** Přeskočí Malou a Velkou útratu a vybere šéfa. */
function toBossRound(game: Game): void {
  for (const a of ['skipBlind', 'skipBlind', 'selectBlind'] as const) {
    const r = game.dispatch({ type: a });
    if (!r.ok) throw new Error(`${a}: ${r.error}`);
  }
}

const tag = (id: string, hooks: TagDef['hooks']): TagDef => ({ id, hooks, art: ART });

// ─────────────────────────── Skórování ───────────────────────────

describe('Ohmataná karta (worn)', () => {
  it('po ruce, ve které skórovala, trvale +3 čipy — jednou za ruku i s červenou pečetí', () => {
    const game = gameInRound(makeRegistry());
    const [k, held] = setHand(game, [
      spec('K♥', { enhancement: 'worn', seal: 'red' }),
      spec('2♣', { enhancement: 'worn' }),
    ]);
    const { result } = play(game, [k!.id]);
    expect(game.card(k!.id)!.bonusChips).toBe(3);
    expect(game.card(held!.id)!.bonusChips).toBe(0);
    expect(result.steps.filter((s) => s.message === MSG.worn)).toHaveLength(1);
    // skóre ruky se nezměnilo: (6 + 10 + 10) × 1
    expect(result.score).toBe(26);
  });

  it('karta mimo kombinaci (kop) nic nedostane', () => {
    const game = gameInRound(makeRegistry());
    const [a, b, kicker] = setHand(game, [spec('9♥'), spec('9♠'), spec('3♣', { enhancement: 'worn' })]);
    play(game, [a!.id, b!.id, kicker!.id]);
    expect(game.card(kicker!.id)!.bonusChips).toBe(0);
  });
});

describe('Skleněná karta', () => {
  it('hod na prasknutí jednou za ruku, i když se karta aktivovala dvakrát; zničí se až po skórování', () => {
    const game = gameInRound(makeRegistry());
    game._core.api.addPermanentModifier({ probabilityMult: 5 }); // 1 z 5 → jistota
    const [g] = setHand(game, [spec('5♥', { enhancement: 'glass', seal: 'red' })]);
    const { result, events } = play(game, [g!.id]);
    expect(result.steps.filter((s) => s.xmult === 2)).toHaveLength(2);
    expect(result.steps.filter((s) => s.message === MSG.glassBreak)).toHaveLength(1);
    expect(result.destroyedCardIds).toEqual([g!.id]);
    expect(game.card(g!.id)).toBeUndefined();
    expect(events.some((e) => e.type === 'cardDestroyed' && e.cardId === g!.id)).toBe(true);
    // (6 + 5 + 5) × 1 × 2 × 2
    expect(result.score).toBe(64);
  });
});

describe('opakované aktivace', () => {
  it(`strop MAX_ACTIVATIONS_PER_CARD = ${MAX_ACTIVATIONS_PER_CARD}`, () => {
    const reg = makeRegistry({ jokers: [joker('echo', { hooks: { retriggerScored: () => 100 } })] });
    const game = gameInRound(reg);
    game._core.api.createJoker({ defId: 'echo' });
    const [c] = setHand(game, [spec('7♦')]);
    const { result } = play(game, [c!.id]);
    expect(result.steps.filter((s) => s.cardId === c!.id && s.chips === 7)).toHaveLength(
      MAX_ACTIVATIONS_PER_CARD,
    );
    expect(result.steps.filter((s) => s.message === MSG.again)).toHaveLength(MAX_ACTIVATIONS_PER_CARD - 1);
  });

  it('červená pečeť opakuje i efekt v ruce (ocelová ×1,5 dvakrát)', () => {
    const game = gameInRound(makeRegistry());
    const [a, steel] = setHand(game, [spec('A♠'), spec('Q♠', { enhancement: 'steel', seal: 'red' })]);
    const { result } = play(game, [a!.id]);
    expect(result.steps.filter((s) => s.source === 'held' && s.xmult === 1.5)).toHaveLength(2);
    expect(result.mult).toBeCloseTo(2.25);
    expect(steel).toBeDefined();
  });

  it('debuffnutá karta nedává nic a neopakuje se', () => {
    const game = gameInRound(makeRegistry());
    const [a] = setHand(game, [spec('A♠', { seal: 'red', enhancement: 'bonus' })]);
    game._core.mustCard(a!.id).debuffed = true;
    const { result } = play(game, [a!.id]);
    expect(result.steps.filter((s) => s.cardId === a!.id).map((s) => s.message)).toEqual([MSG.debuffed]);
    expect(result.score).toBe(6);
  });
});

describe('Modifiers z přílohy B ve skórování', () => {
  it('disableEnhancements (Bílá hora): vylepšení nefungují, kamenná má zase hodnotu a barvu', () => {
    const game = gameInRound(makeRegistry());
    game._core.api.addPermanentModifier({ disableEnhancements: true });
    const [stone, k] = setHand(game, [
      spec('K♠', { enhancement: 'stone' }),
      spec('K♥', { enhancement: 'bonus' }),
    ]);
    const { result } = play(game, [stone!.id, k!.id]);
    expect(result.hand.type).toBe('pair');
    // (12 + 10 + 10) × 2 — bez +50 kamene a +25 prémie
    expect(result.score).toBe(64);
  });

  it('fixedCardChips (Normalizace): každá skórující karta dá právě 5 čipů, vylepšení dál platí', () => {
    const game = gameInRound(makeRegistry());
    game._core.api.addPermanentModifier({ fixedCardChips: 5 });
    const [a, b] = setHand(game, [spec('A♠', { bonusChips: 20 }), spec('A♥', { enhancement: 'bonus' })]);
    const { result } = play(game, [a!.id, b!.id]);
    // (12 + 5 + 5 + 25) × 2
    expect(result.score).toBe(94);
  });
});

describe('BossHooks.adjustHandScore', () => {
  it('upraví skóre ruky před afterHandScored a zapíše krok', () => {
    let seen = -1;
    const reg = makeRegistry({
      bosses: [boss('mayor', { hooks: { adjustHandScore: (_ctx, score) => score * 2 } })],
      jokers: [joker('scribe', { hooks: { afterHandScored: (ctx) => void (seen = ctx.score) } })],
    });
    const game = newGame(reg);
    game._core.api.createJoker({ defId: 'scribe' });
    toBossRound(game);
    const [a] = setHand(game, [spec('A♠')]);
    const { result } = play(game, [a!.id]);
    expect(result.score).toBe(34);
    expect(seen).toBe(34);
    expect(result.steps.at(-1)).toMatchObject({ source: 'boss', defId: 'mayor', message: MSG.bossAdjusted });
    expect(game.state.round!.score).toBe(34);
  });

  it('záporné nebo neplatné skóre se ořízne na 0', () => {
    const reg = makeRegistry({ bosses: [boss('mayor', { hooks: { adjustHandScore: () => Number.NaN } })] });
    const game = newGame(reg);
    toBossRound(game);
    const [a] = setHand(game, [spec('A♠')]);
    expect(play(game, [a!.id]).result.score).toBe(0);
  });
});

// ─────────────────────────── Konec kola ───────────────────────────

describe('TagHooks.onRoundLost (Lékařské potvrzení)', () => {
  const reg = makeRegistry({
    tags: [tag('sick_note', { onRoundLost: (ctx) => ctx.score * 2 >= ctx.target })],
    jokers: [joker('bones', { hooks: { preventGameOver: () => true } })],
  });

  function lastHand(game: Game, roundScore: number) {
    const round = game._core.state.round!;
    round.handsLeft = 1;
    round.score = roundScore;
    const [c] = setHand(game, [spec('2♣')]);
    return game.dispatch({ type: 'play', cardIds: [c!.id] });
  }

  it('zachrání kolo (bez odměny za útratu) a spotřebuje se — před žolíky', () => {
    const game = gameInRound(reg);
    game._core.api.addTag('sick_note');
    game._core.api.createJoker({ defId: 'bones' });
    const res = lastHand(game, 200);
    expect(res.ok).toBe(true);
    expect(game.state.phase).toBe('round_end');
    expect(game.state.rewards!.blindReward).toBe(0);
    expect(game.state.tags).toHaveLength(0);
    if (res.ok) {
      expect(res.events.some((e) => e.type === 'message' && e.key === MSG.tagSaved)).toBe(true);
      expect(res.events.some((e) => e.type === 'jokerTriggered' && e.message === MSG.jokerSaved)).toBe(false);
    }
  });

  it('když štítek nezachrání, přijde na řadu žolík (plná odměna)', () => {
    const game = gameInRound(reg);
    game._core.api.addTag('sick_note');
    game._core.api.createJoker({ defId: 'bones' });
    lastHand(game, 10);
    expect(game.state.phase).toBe('round_end');
    expect(game.state.rewards!.blindReward).toBe(3);
    expect(game.state.tags).toHaveLength(1);
  });

  it('bez záchrany konec runu', () => {
    const game = gameInRound(reg);
    game._core.api.addTag('sick_note');
    lastHand(game, 10);
    expect(game.state.phase).toBe('game_over');
  });
});

describe('prohra z nedostatku karet (DESIGN 1.2)', () => {
  it('prázdná ruka i dobírací balíček = konec runu', () => {
    const reg = makeRegistry({
      decks: [{ id: 'tiny', buildDeck: () => [spec('2♠'), spec('3♠'), spec('4♠')], art: ART }],
    });
    const game = gameInRound(reg, { deckId: 'tiny' });
    expect(game.state.round!.hand).toHaveLength(3);
    const res = game.dispatch({ type: 'discard', cardIds: [...game.state.round!.hand] });
    expect(res.ok).toBe(true);
    expect(game.state.phase).toBe('game_over');
  });
});

describe('DeckDef.onBossDefeated', () => {
  it('zavolá se po porážce šéfa s jeho id', () => {
    let defeated = '';
    const reg = makeRegistry({
      bosses: [boss('wall')],
      decks: [
        {
          id: 'almanac',
          onBossDefeated: (ctx) => {
            defeated = ctx.bossId;
            ctx.api.addMoney(7, 'deck');
          },
          art: ART,
        },
      ],
    });
    const game = newGame(reg, { deckId: 'almanac' });
    toBossRound(game);
    game._core.state.round!.score = game.state.round!.target;
    const money = game.state.money;
    play(game, [game.state.round!.hand[0]!]);
    expect(defeated).toBe('wall');
    expect(game.state.money).toBe(money + 7);
  });
});

describe('StakeDef.bigBlindBoss (Imperial)', () => {
  const reg = makeRegistry({
    bosses: [
      boss('a', { hooks: { passive: () => ({ hands: -1 }) } }),
      boss('b', { hooks: { passive: () => ({ hands: -1 }) } }),
      boss('c', { hooks: { passive: () => ({ hands: -1 }) } }),
      boss('binder', { targetMult: 3 }),
      boss('final', { final: true, hooks: { passive: () => ({ hands: -1 }) } }),
    ],
    stakes: [
      { id: 'one', level: 1, art: ART },
      { id: 'imperial', level: 2, bigBlindBoss: true, art: ART },
    ],
  });

  it('Velká útrata má pravidlo jiného běžného šéfa s pravidlem', () => {
    for (let i = 0; i < 30; i++) {
      const game = newGame(reg, { seed: `IMP${i}`, stake: 2 });
      const [small, big, bossSlot] = game.state.blinds;
      expect(small!.bossId).toBeNull();
      expect(big!.bossId).not.toBeNull();
      expect(big!.bossId).not.toBe(bossSlot!.bossId);
      expect(['binder', 'final']).not.toContain(big!.bossId);
    }
  });

  it('nižší obtížnost pravidlo ve Velké nemá', () => {
    expect(newGame(reg, { stake: 1 }).state.blinds[1]!.bossId).toBeNull();
  });

  it('cíl 1,5× a odměna 4 Kč zůstávají, pravidlo šéfa platí', () => {
    const game = newGame(reg, { stake: 2 });
    game.dispatch({ type: 'skipBlind' });
    game.dispatch({ type: 'selectBlind' });
    const round = game.state.round!;
    expect(round.blind).toBe('big');
    expect(round.bossId).toBe(game.state.blinds[1]!.bossId);
    expect(round.target).toBe(380);
    expect(round.handsLeft).toBe(3);
    game._core.state.round!.score = round.target;
    play(game, [round.hand[0]!]);
    expect(game.state.rewards!.blindReward).toBe(4);
  });
});

describe('zapůjčení a zvětrávající žolíci na konci kola (DESIGN 2.4.2, 4.6)', () => {
  const reg = makeRegistry({ jokers: [joker('lent'), joker('old')] });

  function winSmall(game: Game) {
    game._core.state.round!.score = game.state.round!.target;
    play(game, [game.state.round!.hand[0]!]);
  }

  it('poplatek −2 Kč za kolo', () => {
    const game = gameInRound(reg);
    game._core.api.createJoker({ defId: 'lent', stickers: ['rental'] });
    winSmall(game);
    const r = game.state.rewards!;
    expect(r.extra).toContainEqual(expect.objectContaining({ source: 'rental:lent', amount: -2 }));
    // útrata 3 + nevyužité ruce 3 + úrok 1 (z 5 Kč) − poplatek 2
    expect(r.total).toBe(3 + 3 + 1 - 2);
  });

  it('když poplatek nejde zaplatit ani do dluhu, žolík se při výplatě vrátí do půjčovny', () => {
    const game = gameInRound(reg);
    game._core.api.createJoker({ defId: 'lent', stickers: ['rental'] });
    game._core.state.money = -10;
    winSmall(game);
    expect(game.state.rewards!.extra).toContainEqual(
      expect.objectContaining({ source: 'rentalReturned:lent', amount: 0 }),
    );
    const res = game.dispatch({ type: 'cashOut' });
    expect(res.ok).toBe(true);
    expect(game.state.jokers).toHaveLength(0);
    expect(game.state.money).toBe(-10 + 6);
    if (res.ok)
      expect(res.events.some((e) => e.type === 'message' && e.key === MSG.rentalReturned)).toBe(true);
  });

  it('zvětrávající žolík po posledním kole zvětrá (trvale debuffnutý)', () => {
    const game = gameInRound(reg);
    const j = game._core.api.createJoker({ defId: 'old', stickers: ['perishable'] })!;
    j.perishRounds = 1;
    winSmall(game);
    expect(game.state.jokers[0]!.debuffed).toBe(true);
    expect(game.state.jokers[0]!.perishRounds).toBe(0);
  });
});

// ─────────────────────────── Hooky žolíků ───────────────────────────

describe('JokerHooks.onAcquire (Golem)', () => {
  const golem = joker('golem', {
    hooks: {
      onAcquire: (ctx) => {
        for (let i = 0; i < 2; i++)
          ctx.api.addCard({ ...spec('2♠'), enhancement: 'stone' }, { source: 'golem' });
      },
    },
  });
  const reg = makeRegistry({
    jokers: [golem],
    boosters: [booster('jokers', { options: 1 })],
    challenges: [{ id: 'quarry', deckId: 'test', startingJokers: [{ defId: 'golem' }], art: ART }],
  });

  it('zavolá se při createJoker', () => {
    const game = newGame(reg);
    game._core.api.createJoker({ defId: 'golem' });
    expect(game.state.deck).toHaveLength(54);
  });

  it('zavolá se při koupi ve Večerce', () => {
    const game = newGame(reg);
    const core = game._core;
    core.state.money = 50;
    core.state.phase = 'shop';
    core.state.shop = generateShop(core);
    const slot = game.state.shop!.items.findIndex((i) => i.kind === 'joker');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(game.dispatch({ type: 'buy', slot }).ok).toBe(true);
    expect(game.state.deck).toHaveLength(54);
  });

  it('zavolá se při výběru z obálky', () => {
    const game = newGame(reg);
    game.startBooster('jokers', 'blind_select');
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.deck).toHaveLength(54);
  });

  it('nezavolá se u startovních žolíků výzvy', () => {
    const game = newGame(reg, { challengeId: 'quarry' });
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['golem']);
    expect(game.state.deck).toHaveLength(52);
  });
});

// ─────────────────────────── EngineApi ───────────────────────────

describe('EngineApi z přílohy B', () => {
  it('discardFromHand: karta jde na odhazovací hromádku bez spotřeby zahození', () => {
    const game = gameInRound(makeRegistry());
    const core = game._core;
    const id = game.state.round!.hand[0]!;
    const discards = game.state.round!.discardsLeft;
    expect(core.api.discardFromHand(id)).toBe(true);
    expect(game.state.round!.hand).not.toContain(id);
    expect(game.state.round!.discardPile).toContain(id);
    expect(game.state.round!.discardsLeft).toBe(discards);
    expect(core.takeEvents()).toContainEqual({ type: 'cardsDiscarded', cardIds: [id], forced: true });
    expect(core.api.discardFromHand(id)).toBe(false);
  });

  it('setJokerDebuffed: dočasně do konce kola, zvětralého neoživí, mimo kolo nic', () => {
    const reg = makeRegistry({ jokers: [joker('a'), joker('b')] });
    const game = newGame(reg);
    const core = game._core;
    const a = core.api.createJoker({ defId: 'a' })!;
    const b = core.api.createJoker({ defId: 'b', stickers: ['perishable'] })!;
    core.api.setJokerDebuffed(a.uid, true);
    expect(a.debuffed).toBe(false); // mimo kolo
    game.dispatch({ type: 'selectBlind' });
    b.perishRounds = 0;
    b.debuffed = true;
    core.api.setJokerDebuffed(a.uid, true);
    core.api.setJokerDebuffed(b.uid, true);
    expect(a.debuffed).toBe(true);
    expect(game.state.round!.jokerDebuffs).toEqual([a.uid, b.uid]);
    core.api.setJokerDebuffed(b.uid, false);
    expect(b.debuffed).toBe(true);
    core.api.setJokerDebuffed(a.uid, false);
    expect(a.debuffed).toBe(false);
    core.api.setJokerDebuffed(a.uid, true);
    // konec kola debuff zruší
    game._core.state.round!.score = game.state.round!.target;
    play(game, [game.state.round!.hand[0]!]);
    expect(game.state.jokers.find((j) => j.uid === a.uid)!.debuffed).toBe(false);
  });

  it('setJokerDebuffed: debuffnutý žolík neskóruje; vypnutí šéfa debuff zruší', () => {
    const reg = makeRegistry({
      jokers: [joker('plus', { hooks: { onHandPlayed: () => ({ mult: 10 }) } })],
      bosses: [
        boss('bailiff', {
          hooks: { onRoundStart: (ctx) => ctx.api.setJokerDebuffed(ctx.state.jokers[0]!.uid, true) },
        }),
      ],
    });
    const game = newGame(reg);
    game._core.api.createJoker({ defId: 'plus' });
    toBossRound(game);
    expect(game.state.jokers[0]!.debuffed).toBe(true);
    const [a] = setHand(game, [spec('2♠'), spec('3♠')]);
    expect(play(game, [a!.id]).result.mult).toBe(1);
    game._core.api.disableBoss();
    expect(game.state.jokers[0]!.debuffed).toBe(false);
  });

  it('setCardFaceDown: náhled skryje, zahrání kartu otočí', () => {
    const game = gameInRound(makeRegistry());
    const core = game._core;
    const [a, b] = setHand(game, [spec('9♠'), spec('9♥')]);
    core.api.setCardFaceDown(a!.id, true);
    expect(game.card(a!.id)!.faceDown).toBe(true);
    expect(game.preview([a!.id, b!.id])).toEqual({ hand: null, chips: 0, mult: 0, level: 0, hidden: true });
    expect(game.preview([b!.id]).hidden).toBe(false);
    const { result } = play(game, [a!.id, b!.id]);
    expect(result.hand.type).toBe('pair');
    expect(game.card(a!.id)!.faceDown).toBe(false);
  });

  it('shuffleHand zamíchá pořadí ruky deterministicky', () => {
    const run = () => {
      const game = gameInRound(makeRegistry());
      const before = [...game.state.round!.hand];
      game._core.api.shuffleHand();
      return { before, after: [...game.state.round!.hand], events: game._core.takeEvents() };
    };
    const one = run();
    expect([...one.after].sort()).toEqual([...one.before].sort());
    expect(one.after).not.toEqual(one.before);
    expect(one.events).toContainEqual({ type: 'handShuffled', cardIds: one.after });
    expect(run().after).toEqual(one.after);
  });

  it('handBase = čipy a mult kombinace na úrovni', () => {
    const core = newGame(makeRegistry())._core;
    expect(core.api.handBase('flush', 1)).toEqual({ chips: 40, mult: 4 });
    expect(core.api.handBase('flush', 3)).toEqual(handValueAtLevel(core.registry.handTypes.flush, 3));
  });

  it('addRoundHandSize platí do konce kola', () => {
    const game = gameInRound(makeRegistry());
    const core = game._core;
    core.api.addRoundHandSize(-1);
    core.api.addRoundHandSize(-1);
    expect(game.modifiers().handSize).toBe(6);
    const [a] = setHand(game, [spec('2♠')]);
    play(game, [a!.id]);
    expect(game.state.round!.hand).toHaveLength(6);
    game._core.state.round!.score = game.state.round!.target;
    play(game, [game.state.round!.hand[0]!]);
    game.dispatch({ type: 'cashOut' });
    expect(game.modifiers().handSize).toBe(8);
    core.api.addRoundHandSize(2); // mimo kolo nic
    expect(game.modifiers().handSize).toBe(8);
  });

  it('setMoney nastaví přesně (i do mínusu), addMoney srážku ořízne dluhovým limitem', () => {
    const core = newGame(makeRegistry())._core;
    core.api.setMoney(3, 'test');
    expect(core.state.money).toBe(3);
    core.api.addMoney(-10, 'boss');
    expect(core.state.money).toBe(0);
    core.api.addPermanentModifier({ debtLimit: 5 });
    core.api.addMoney(-10, 'boss');
    expect(core.state.money).toBe(-5);
    core.api.setMoney(-20, 'test');
    expect(core.state.money).toBe(-20);
    core.api.addMoney(-1, 'boss');
    expect(core.state.money).toBe(-20);
    core.api.addMoney(4, 'gift');
    expect(core.state.money).toBe(-16);
    expect(core.state.stats.minMoney).toBe(-20);
  });

  it('changeAnte: nejníž patro 1, emituje anteChanged, neplatného šéfa přelosuje', () => {
    const reg = makeRegistry({ bosses: [boss('normal'), boss('final', { final: true })] });
    const game = newGame(reg);
    const core = game._core;
    core.api.changeAnte(-3);
    expect(game.state.ante).toBe(1);
    core.api.changeAnte(7);
    expect(game.state.ante).toBe(8);
    expect(game.state.blinds[2]!.bossId).toBe('final');
    core.api.changeAnte(-1);
    expect(game.state.ante).toBe(7);
    expect(game.state.blinds[2]!.bossId).toBe('normal');
    expect(core.takeEvents().filter((e) => e.type === 'anteChanged')).toHaveLength(2);
  });

  it('levelUpAll zvýší všechny kombinace včetně tajných', () => {
    const core = newGame(makeRegistry())._core;
    core.api.levelUpAll(2);
    for (const h of HAND_TYPES) expect(core.state.handLevels[h as HandType].level).toBe(3);
  });

  it('addPermanentModifier přičte deltu do extraModifiers', () => {
    const game = newGame(makeRegistry());
    game._core.api.addPermanentModifier({ hands: -1, targetMult: 1.1 });
    game._core.api.addPermanentModifier({ hands: -1 });
    expect(game.state.extraModifiers).toEqual({ hands: -2, targetMult: 1.1 });
    expect(game.modifiers().hands).toBe(2);
  });

  it('rerollBoss přelosuje šéfa patra; během kola šéfa nejde', () => {
    const reg = makeRegistry({ bosses: [boss('a'), boss('b'), boss('c')] });
    const game = newGame(reg);
    const core = game._core;
    const before = game.state.blinds[2]!.bossId;
    const after = core.api.rerollBoss();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(game.state.blinds[2]!.bossId).toBe(after);
    toBossRound(game);
    expect(core.api.rerollBoss()).toBeNull();
  });
});

// ─────────────────────────── Run ───────────────────────────

describe('RunState.discoveredHands', () => {
  it('nový run nic neobjevil; první zahrání kombinaci zapíše, tajná vyvolá handDiscovered', () => {
    const game = gameInRound(makeRegistry());
    expect(game.state.discoveredHands).toEqual([]);
    const [a, b] = setHand(game, [spec('9♠'), spec('9♥')]);
    const first = play(game, [a!.id, b!.id]);
    expect(game.state.discoveredHands).toEqual(['pair']);
    expect(first.events.some((e) => e.type === 'handDiscovered')).toBe(false);
    const five = setHand(
      game,
      Array.from({ length: 5 }, () => spec('A♥')),
    );
    const second = play(
      game,
      five.map((c) => c.id),
    );
    expect(second.result.hand.type).toBe('flush_five');
    expect(game.state.discoveredHands).toEqual(['pair', 'flush_five']);
    expect(second.events).toContainEqual({ type: 'handDiscovered', hand: 'flush_five' });
  });
});

describe('pečeť na debuffnuté kartě', () => {
  it('fialová pečeť při zahození debuffnuté karty nic nevytvoří', () => {
    const reg = makeRegistry({ consumables: [consumable('advice', { kind: 'rada' })] });
    const game = gameInRound(reg);
    const [a, b] = setHand(game, [spec('2♠', { seal: 'purple' }), spec('3♠', { seal: 'purple' })]);
    game._core.mustCard(a!.id).debuffed = true;
    game.dispatch({ type: 'discard', cardIds: [a!.id, b!.id] });
    expect(game.state.consumables).toHaveLength(1);
  });
});

// ─────────────────────────── EngineApi: příkazy a dotazy (testovací registr fixtures/registry.ts) ───────────────────────────

describe('api.createJoker', () => {
  it('respektuje sloty; negativní edice si slot přinese; ignoreSlots limit obejde', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    for (let i = 0; i < 5; i++) expect(api.createJoker({ defId: 'noop' })).not.toBeNull();
    expect(api.createJoker({ defId: 'noop' })).toBeNull();
    expect(game.state.jokers).toHaveLength(5);
    const neg = api.createJoker({ defId: 'noop', edition: 'negative' });
    expect(neg).toMatchObject({ defId: 'noop', edition: 'negative' });
    expect(api.jokerSlots()).toBe(6);
    expect(api.createJoker({ defId: 'noop' })).toBeNull();
    expect(api.createJoker({ defId: 'noop', ignoreSlots: true })).not.toBeNull();
    expect(game.state.jokers).toHaveLength(7);
  });

  it('nová instance: initState, nálepky, zvětrávání, událost jokerAdded', () => {
    const game = fx.makeGame();
    const core = game._core;
    const j = core.api.createJoker({ defId: 'counter', stickers: ['perishable'] })!;
    expect(j).toMatchObject({
      defId: 'counter',
      state: { hands: 0 },
      stickers: ['perishable'],
      perishRounds: 6,
    });
    expect(j.sellBonus).toBe(0);
    expect(core.takeEvents()).toContainEqual({ type: 'jokerAdded', uid: j.uid, defId: 'counter' });
  });

  it('rarity: vybere jen danou vzácnost; legendární i mimo obchod; vlastněný se nenabízí', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    expect(api.createJoker({ rarity: 'rare' })!.defId).toBe('rare_one');
    expect(api.createJoker({ rarity: 'rare' })).toBeNull(); // pool vyčerpaný, Pivní tácek v registru není
    expect(api.createJoker({ rarity: 'epic' })!.defId).toBe('epic_one');
    expect(api.createJoker({ rarity: 'legendary' })!.defId).toBe('legend');
  });

  it('náhodný žolík: deterministický podle seedu, bez duplicit a bez noShop; vyčerpaný pool → Pivní tácek', () => {
    const draw = (reg = fx.makeRegistry()) => {
      const game = fx.makeGame({ registry: reg });
      const ids: (string | null)[] = [];
      for (let i = 0; i < 80; i++) ids.push(game._core.api.createJoker({ ignoreSlots: true })?.defId ?? null);
      return ids;
    };
    const ids = draw();
    expect(draw()).toEqual(ids);
    const real = ids.filter((x): x is string => x !== null);
    expect(new Set(real).size).toBe(real.length);
    expect(real).not.toContain('legend');
    expect(ids.at(-1)).toBeNull();
    const withMat = draw(fx.makeRegistry({ jokers: [fx.joker('beer_mat')] }));
    // Pivní tácek je běžný žolík, který se smí opakovat — po vyčerpání poolu už jde jen on.
    expect(withMat.slice(-5)).toEqual(Array(5).fill('beer_mat'));
  });

  it('zakázaní a neodemčení žolíci se nevytvoří náhodně', () => {
    const game = fx.makeGame();
    const s = game._core.state;
    s.bannedJokers = ['rare_one'];
    expect(game._core.api.createJoker({ rarity: 'rare' })).toBeNull();
    s.unlockedPool = { jokers: ['epic_one'], vouchers: null, boosters: null };
    expect(game._core.api.createJoker({ rarity: 'epic' })!.defId).toBe('epic_one');
    expect(game._core.api.createJoker({ rarity: 'common' })).toBeNull();
  });

  it('onAcquire se zavolá jen novému žolíkovi (Golem přidá kamennou kartu)', () => {
    const game = fx.makeGame();
    const deck = game.state.deck.length;
    game._core.api.createJoker({ defId: 'golem' });
    expect(game.state.deck).toHaveLength(deck + 1);
    expect(game.state.deck.at(-1)).toMatchObject({ enhancement: 'stone' });
    expect(game._core.takeEvents()).toContainEqual(
      expect.objectContaining({ type: 'cardAdded', source: 'golem' }),
    );
  });
});

describe('api.destroyJoker', () => {
  it('zničí žolíka s událostí; přibitého ne; neznámé uid nic', () => {
    const game = fx.makeGame({ round: true });
    const core = game._core;
    const [a, eternal] = fx.addJokers(game, ['noop', { id: 'plus_mult', stickers: ['eternal'] }]);
    core.api.setJokerDebuffed(a!.uid, true);
    core.takeEvents();
    core.api.destroyJoker(a!.uid, 'test');
    core.api.destroyJoker(eternal!.uid, 'test');
    core.api.destroyJoker(9999, 'test');
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['plus_mult']);
    expect(game.state.round!.jokerDebuffs).toEqual([]);
    expect(core.takeEvents()).toEqual([
      { type: 'jokerDestroyed', uid: a!.uid, defId: 'noop', reason: 'test' },
    ]);
  });
});

describe('api.createConsumable', () => {
  it('respektuje sloty (2); ignoreSlots a negativní edice limit obejdou', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    expect(api.createConsumable({ defId: 'rada_a' })).not.toBeNull();
    expect(api.createConsumable({ kind: 'rada' })).not.toBeNull();
    expect(api.createConsumable({ defId: 'rada_a' })).toBeNull();
    expect(api.createConsumable({ defId: 'rada_a', edition: 'negative' })).toMatchObject({
      edition: 'negative',
    });
    expect(api.createConsumable({ defId: 'rada_b' })).toBeNull();
    expect(api.createConsumable({ defId: 'stamp', ignoreSlots: true })).not.toBeNull();
    expect(game.state.consumables).toHaveLength(4);
    expect(game.modifiers().consumableSlots).toBe(3);
  });

  it('forHand: pranostika dané kombinace (i tajné); bez pranostiky null', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    expect(api.createConsumable({ forHand: 'flush' })!.defId).toBe('pr_flush');
    expect(api.createConsumable({ forHand: 'flush_five' })!.defId).toBe('pr_flush_five');
    const bare = fx.makeGame({ registry: makeRegistry() });
    expect(bare._core.api.createConsumable({ forHand: 'flush' })).toBeNull();
  });

  it('náhodná pranostika: tajné až po objevu v runu', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    const secret = ['pr_five', 'pr_flush_house', 'pr_flush_five'];
    const drawn = () =>
      Array.from(
        { length: 120 },
        () => api.createConsumable({ kind: 'pranostika', ignoreSlots: true })!.defId,
      );
    expect(drawn().filter((id) => secret.includes(id))).toEqual([]);
    game._core.state.discoveredHands.push('five');
    const after = drawn();
    expect(after).toContain('pr_five');
    expect(after).not.toContain('pr_flush_house');
  });

  it('bez kind/defId/forHand nic; neznámé defId vyhodí chybu; váha 0 se nelosuje', () => {
    const reg = fx.makeRegistry({ consumables: [fx.consumable('never', { kind: 'razitko', weight: 0 })] });
    const game = fx.makeGame({ registry: reg });
    const api = game._core.api;
    expect(api.createConsumable({})).toBeNull();
    expect(() => api.createConsumable({ defId: 'nope' })).toThrow();
    for (let i = 0; i < 20; i++)
      expect(api.createConsumable({ kind: 'razitko', ignoreSlots: true })!.defId).toBe('stamp');
  });

  it('emituje consumableAdded', () => {
    const game = fx.makeGame();
    const c = game._core.api.createConsumable({ defId: 'rada_b' })!;
    expect(game._core.takeEvents()).toContainEqual({ type: 'consumableAdded', uid: c.uid, defId: 'rada_b' });
  });
});

describe('api.addCard / copyCard', () => {
  it('do ruky během kola; událost cardAdded a hook onCardAdded', () => {
    const seen: number[] = [];
    const reg = fx.makeRegistry({
      jokers: [fx.joker('watcher', { hooks: { onCardAdded: (ctx) => void seen.push(ctx.card.id) } })],
    });
    const game = fx.makeGame({ registry: reg, jokers: ['watcher'], round: true });
    const core = game._core;
    core.takeEvents();
    const c = core.api.addCard(fx.card('QH:glass@red'), { toHand: true, source: 'test' });
    expect(c).toMatchObject({ suit: 'H', rank: 12, enhancement: 'glass', seal: 'red', debuffed: false });
    expect(game.state.round!.hand.at(-1)).toBe(c.id);
    expect(game.state.round!.drawPile).not.toContain(c.id);
    expect(game.state.deck).toContainEqual(c);
    expect(seen).toEqual([c.id]);
    expect(core.takeEvents()).toContainEqual({ type: 'cardAdded', cardId: c.id, source: 'test' });
  });

  it('do dobíracího balíčku na místo určené seedem (stream deck)', () => {
    const position = (seed: string) => {
      const game = fx.makeGame({ seed, round: true });
      const c = game._core.api.addCard(fx.card('2C'));
      return game.state.round!.drawPile.indexOf(c.id);
    };
    const positions = ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => position(`POS${s}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(['A', 'B', 'C', 'D', 'E', 'F'].map((s) => position(`POS${s}`))).toEqual(positions);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it('mimo kolo jen do balíčku runu; s toHand v obálce do ruky obálky', () => {
    const game = fx.makeGame();
    const core = game._core;
    const c = core.api.addCard(fx.card('2C'), { toHand: true });
    expect(game.state.deck.at(-1)).toBe(c);
    game.startBooster('rada_pack', 'blind_select');
    expect(game.state.booster!.hand).toHaveLength(8);
    const d = core.api.addCard(fx.card('3C'), { toHand: true });
    expect(game.state.booster!.hand.at(-1)).toBe(d.id);
  });

  it('aktivní šéf nové kartě nastaví debuff', () => {
    const game = fx.makeGame();
    fx.selectBoss(game, 'heart_ban');
    expect(game._core.api.addCard(fx.card('KH')).debuffed).toBe(true);
    expect(game._core.api.addCard(fx.card('KS')).debuffed).toBe(false);
  });

  it('copyCard zkopíruje vše kromě id (vylepšení, pečeť, edice, bonusové čipy); neznámá karta null', () => {
    const game = fx.makeGame({ round: true });
    const core = game._core;
    const [src] = fx.setupRound(game, 'QH:glass@red~foil+7');
    core.takeEvents();
    const copy = core.api.copyCard(src!.id)!;
    expect(copy.id).not.toBe(src!.id);
    expect({ ...copy, id: 0 }).toEqual({ ...src!, id: 0 });
    expect(game.state.round!.drawPile).toContain(copy.id);
    expect(core.takeEvents()).toContainEqual({ type: 'cardAdded', cardId: copy.id, source: 'copy' });
    const inHand = core.api.copyCard(src!.id, { toHand: true })!;
    expect(game.state.round!.hand).toContain(inHand.id);
    expect(core.api.copyCard(99999)).toBeNull();
  });
});

describe('api.destroyCard', () => {
  it('odebere kartu z balíčku runu i ze všech hromádek kola; hook onCardDestroyed', () => {
    const gone: number[] = [];
    const reg = fx.makeRegistry({
      jokers: [fx.joker('mourner', { hooks: { onCardDestroyed: (ctx) => void gone.push(ctx.card.id) } })],
    });
    const game = fx.makeGame({ registry: reg, jokers: ['mourner'], round: true });
    const core = game._core;
    const round = core.state.round!;
    const inHand = round.hand[0]!;
    const inDraw = round.drawPile[0]!;
    const inDiscard = round.drawPile.pop()!;
    round.discardPile.push(inDiscard);
    const inPlayed = round.drawPile.pop()!;
    round.playedPile.push(inPlayed);
    const deck = game.state.deck.length;
    core.takeEvents();
    for (const id of [inHand, inDraw, inDiscard, inPlayed]) core.api.destroyCard(id, 'test');
    core.api.destroyCard(99999, 'test');
    expect(game.state.deck).toHaveLength(deck - 4);
    for (const id of [inHand, inDraw, inDiscard, inPlayed]) {
      expect(game.card(id)).toBeUndefined();
      for (const pile of [round.hand, round.drawPile, round.discardPile, round.playedPile])
        expect(pile).not.toContain(id);
    }
    expect(gone).toEqual([inHand, inDraw, inDiscard, inPlayed]);
    expect(core.takeEvents().filter((e) => e.type === 'cardDestroyed')).toHaveLength(4);
  });

  it('odebere kartu i z ruky obálky', () => {
    const game = fx.makeGame();
    game.startBooster('rada_pack', 'blind_select');
    const id = game.state.booster!.hand[0]!;
    game._core.api.destroyCard(id, 'test');
    expect(game.state.booster!.hand).not.toContain(id);
    expect(game.card(id)).toBeUndefined();
  });
});

describe('api.modifyCard', () => {
  it('změní povolená pole a emituje cardChanged; neplatné hodnoty a cizí pole ignoruje', () => {
    const game = fx.makeGame({ round: true });
    const core = game._core;
    const [c] = fx.setupRound(game, '2S');
    core.takeEvents();
    core.api.modifyCard(c!.id, {
      rank: 14,
      suit: 'D',
      enhancement: 'lucky',
      seal: 'gold',
      edition: 'holo',
      bonusChips: 4,
    });
    expect(c).toMatchObject({
      rank: 14,
      suit: 'D',
      enhancement: 'lucky',
      seal: 'gold',
      edition: 'holo',
      bonusChips: 4,
    });
    expect(core.takeEvents()).toEqual([{ type: 'cardChanged', cardId: c!.id }]);
    core.api.modifyCard(c!.id, { suit: undefined, id: 12345 } as never);
    expect(c).toMatchObject({ id: c!.id, suit: 'D' });
    core.api.modifyCard(99999, { rank: 2 });
  });

  it('debuff od šéfa se po změně přepočítá (barva, divoká karta)', () => {
    const game = fx.makeGame();
    fx.selectBoss(game, 'heart_ban');
    const [c] = fx.setupRound(game, 'KS');
    const api = game._core.api;
    expect(c!.debuffed).toBe(false);
    api.modifyCard(c!.id, { suit: 'H' });
    expect(c!.debuffed).toBe(true);
    api.modifyCard(c!.id, { suit: 'C' });
    expect(c!.debuffed).toBe(false);
    api.modifyCard(c!.id, { enhancement: 'wild' });
    expect(c!.debuffed).toBe(true);
  });

  it('mimo kolo debuff nenastavuje', () => {
    const game = fx.makeGame();
    const c = game.state.deck.find((x) => x.suit === 'S')!;
    game._core.api.modifyCard(c.id, { suit: 'H' });
    expect(game.card(c.id)).toMatchObject({ suit: 'H', debuffed: false });
  });
});

describe('api.addTag', () => {
  it('štítek, který se v onAdded spotřebuje, hned zmizí (cash_tag: +5 Kč)', () => {
    const game = fx.makeGame({ money: 0 });
    const core = game._core;
    core.takeEvents();
    core.api.addTag('cash_tag');
    expect(game.state.tags).toEqual([]);
    expect(game.state.money).toBe(5);
    const types = core.takeEvents().map((e) => e.type);
    expect(types).toEqual(['tagAdded', 'moneyChanged', 'tagTriggered']);
  });

  it('nespotřebovaný štítek zůstává (i po hooku, který vrátí false); neznámý vyhodí chybu', () => {
    const game = fx.makeGame();
    game._core.api.addTag('lazy_tag');
    game.dispatch({ type: 'selectBlind' });
    expect(game.state.tags.map((t) => t.defId)).toEqual(['lazy_tag']);
    expect(() => game._core.api.addTag('nope')).toThrow();
  });

  it('štítek s onRoundStart se spotřebuje na začátku kola (+1 ruka)', () => {
    const game = fx.makeGame();
    game._core.api.addTag('extra_hand');
    game.dispatch({ type: 'selectBlind' });
    expect(game.state.round!.handsLeft).toBe(5);
    expect(game.state.tags).toEqual([]);
  });
});

describe('api.disableBoss', () => {
  it('zruší debuffy karet, zakrytí v ruce a pravidla šéfa; podruhé nic', () => {
    const game = fx.makeGame();
    fx.selectBoss(game, 'heart_ban');
    const core = game._core;
    const [h] = fx.setupRound(game, 'KH KS');
    expect(h!.debuffed).toBe(true);
    core.takeEvents();
    core.api.disableBoss();
    expect(h!.debuffed).toBe(false);
    expect(game.state.deck.some((c) => c.debuffed)).toBe(false);
    expect(game.state.round!.bossDisabled).toBe(true);
    expect(core.activeBoss()).toBeNull();
    expect(core.takeEvents()).toContainEqual({
      type: 'message',
      key: MSG.bossDisabled,
      params: { boss: 'heart_ban' },
    });
    core.api.disableBoss();
    expect(core.takeEvents()).toEqual([]);
    // nová karta už debuff nedostane
    expect(core.api.addCard(fx.card('QH')).debuffed).toBe(false);
  });

  it('karty lícem dolů v ruce se otočí', () => {
    const game = fx.makeGame();
    fx.selectBoss(game, 'blind_draw');
    const hand = game.state.round!.hand.map((id) => game.card(id)!);
    expect(hand.filter((c) => c.faceDown)).toHaveLength(4);
    game._core.api.disableBoss();
    expect(hand.some((c) => c.faceDown)).toBe(false);
  });

  it('bez šéfa (Malá útrata) a mimo kolo nic', () => {
    const idle = fx.makeGame();
    idle._core.api.disableBoss();
    const game = fx.makeGame({ round: true });
    game._core.takeEvents();
    game._core.api.disableBoss();
    expect(game.state.round!.bossDisabled).toBe(false);
    expect(game._core.takeEvents()).toEqual([]);
  });
});

describe('api.levelUpHand / levelUpAll', () => {
  it('zvýší úroveň s událostí; nejníž úroveň 1; 0 a neznámá kombinace nic', () => {
    const game = fx.makeGame();
    const core = game._core;
    core.takeEvents();
    core.api.levelUpHand('flush');
    core.api.levelUpHand('flush', 3);
    expect(core.api.handLevel('flush')).toBe(5);
    core.api.levelUpHand('flush', -10);
    expect(core.api.handLevel('flush')).toBe(1);
    core.api.levelUpHand('flush', -1);
    core.api.levelUpHand('flush', 0);
    core.api.levelUpHand('nope' as HandType);
    expect(core.takeEvents()).toEqual([
      { type: 'handLeveled', hand: 'flush', level: 2, delta: 1 },
      { type: 'handLeveled', hand: 'flush', level: 5, delta: 3 },
      { type: 'handLeveled', hand: 'flush', level: 1, delta: -4 },
    ]);
  });

  it('levelUpAll zvýší i sníží všechny (nejníž 1) a projeví se ve skórování', () => {
    const game = fx.makeGame({ round: true });
    game._core.api.levelUpAll(2);
    const [a, b] = fx.setupRound(game, '9S 9H');
    expect(fx.play(game, [a!, b!]).result.steps[0]).toMatchObject({ chips: 68, mult: 6 });
    game._core.api.levelUpAll(-5);
    for (const h of HAND_TYPES) expect(game.state.handLevels[h].level).toBe(1);
  });
});

describe('api.sellValue', () => {
  it('polovina ceny (min. 1) + příplatek edice + sellBonus; zapůjčený 1 Kč', () => {
    const reg = fx.makeRegistry({ jokers: [fx.joker('cheap', { cost: 1 })] });
    const game = fx.makeGame({ registry: reg });
    const api = game._core.api;
    const value = (spec: fx.JokerSpec, sellBonus = 0) => {
      const [j] = fx.addJokers(game, [spec]);
      j!.sellBonus = sellBonus;
      return api.sellValue(j!);
    };
    expect(value({ id: 'noop' })).toBe(2);
    expect(value({ id: 'noop', edition: 'foil' })).toBe(2);
    expect(value({ id: 'noop', edition: 'holo' })).toBe(3);
    expect(value({ id: 'noop', edition: 'poly' })).toBe(4);
    expect(value({ id: 'noop', edition: 'negative' })).toBe(5);
    expect(value({ id: 'rare_one' })).toBe(3);
    expect(value({ id: 'epic_one' })).toBe(4);
    expect(value({ id: 'legend' })).toBe(8);
    expect(value({ id: 'cheap' })).toBe(1);
    expect(value({ id: 'noop' }, 3)).toBe(5);
    expect(value({ id: 'noop', stickers: ['rental'] }, 3)).toBe(1);
  });

  it('Game.sellValue i pro spotřebky; přibitý má hodnotu, ale prodat nejde', () => {
    const game = fx.makeGame();
    const api = game._core.api;
    const pr = api.createConsumable({ defId: 'pr_pair' })!;
    const neg = api.createConsumable({ defId: 'stamp', edition: 'negative' })!;
    expect(game.sellValue(pr.uid)).toBe(1);
    expect(game.sellValue(neg.uid)).toBe(6);
    expect(game.sellValue(424242)).toBe(0);
    const [eternal] = fx.addJokers(game, [{ id: 'noop', stickers: ['eternal'] }]);
    expect(game.sellValue(eternal!.uid)).toBe(2);
    expect(game.dispatch({ type: 'sellJoker', uid: eternal!.uid })).toEqual({
      ok: false,
      error: 'cannotSell',
    });
  });
});

describe('api: kolo a dotazy', () => {
  it('addHands / addDiscards / drawCards jen během kola, nejníž 0', () => {
    const idle = fx.makeGame();
    idle._core.api.addHands(2);
    idle._core.api.addDiscards(2);
    idle._core.api.drawCards(2);
    expect(idle.state.round).toBeNull();
    const game = fx.makeGame({ round: true });
    const api = game._core.api;
    api.addHands(2);
    api.addDiscards(-10);
    expect(game.state.round).toMatchObject({ handsLeft: 6, discardsLeft: 0 });
    api.addHands(-10);
    expect(game.state.round!.handsLeft).toBe(0);
    api.drawCards(3);
    expect(game.state.round!.hand).toHaveLength(11);
    expect(api.handCards().map((c) => c.id)).toEqual(game.state.round!.hand);
  });

  it('isFace (allFaces), hasSuit (divoká, kamenná, mergedSuits), cardChips (kamenná, fixedCardChips)', () => {
    const game = fx.makeGame({ round: true });
    const api = game._core.api;
    const [k, two, wild, stone] = fx.setupRound(game, 'KS 2D 3C:wild 4H:stone+5');
    expect([k, two, wild, stone].map((c) => api.isFace(c!))).toEqual([true, false, false, false]);
    expect(api.hasSuit(wild!, 'H')).toBe(true);
    expect(api.hasSuit(stone!, 'H')).toBe(false);
    expect(api.hasSuit(two!, 'H')).toBe(false);
    expect(api.cardChips(k!)).toBe(10);
    expect(api.cardChips(stone!)).toBe(5);
    api.addPermanentModifier({ allFaces: true, mergedSuits: true, fixedCardChips: 5 });
    expect([k, two, wild, stone].map((c) => api.isFace(c!))).toEqual([true, true, true, false]);
    expect(api.hasSuit(two!, 'H')).toBe(true);
    expect(api.cardChips(k!)).toBe(5);
    expect(api.getCard(k!.id)).toBe(k);
    expect(api.modifiers().fixedCardChips).toBe(5);
  });

  it('message emituje událost s parametry i bez nich', () => {
    const game = fx.makeGame();
    const core = game._core;
    core.takeEvents();
    core.api.message('score.again');
    core.api.message('score.again', { n: 2 });
    expect(core.takeEvents()).toEqual([
      { type: 'message', key: 'score.again' },
      { type: 'message', key: 'score.again', params: { n: 2 } },
    ]);
  });
});

describe('vypnutí šéfa vrátí ruce a zahození', () => {
  const reg = fx.makeRegistry({
    bosses: [
      fx.boss('lunch', { hooks: { passive: () => ({ hands: -3 }) } }),
      fx.boss('drought', { hooks: { passive: () => ({ discards: -3, hands: 1 }) } }),
    ],
  });

  it('Polední pauza (1 ruka) → po vypnutí zbývající ruce +3', () => {
    const game = fx.makeGame({ registry: reg });
    fx.selectBoss(game, 'lunch');
    expect(game.state.round!.handsLeft).toBe(1);
    game._core.api.disableBoss();
    expect(game.state.round!.handsLeft).toBe(4);
  });

  it('Sucho v obci (0 zahození, +1 ruka) → zahození +3, ruce −1, ale nejníž 1', () => {
    const game = fx.makeGame({ registry: reg });
    fx.selectBoss(game, 'drought');
    const round = game._core.state.round!;
    expect(round).toMatchObject({ handsLeft: 5, discardsLeft: 0 });
    round.handsLeft = 1;
    game._core.api.disableBoss();
    expect(game.state.round).toMatchObject({ handsLeft: 1, discardsLeft: 3 });
  });
});

describe('JokerHooks.onSell', () => {
  it('volá se všem žolíkům; prodávaný dostane isSelf = true, kopie jeho schopnosti ne', () => {
    const calls: { uid: number; sold: number; isSelf: boolean; isCopy: boolean }[] = [];
    const reg = fx.makeRegistry({
      jokers: [
        fx.joker('broker', {
          hooks: {
            onSell: (ctx) =>
              void calls.push({
                uid: ctx.self.uid,
                sold: ctx.sold.uid,
                isSelf: ctx.isSelf,
                isCopy: ctx.isCopy,
              }),
          },
        }),
      ],
    });
    const game = fx.makeGame({ registry: reg, jokers: ['copier', 'broker', 'noop'] });
    const [, broker, noop] = game.state.jokers;
    expect(game.dispatch({ type: 'sellJoker', uid: noop!.uid }).ok).toBe(true);
    expect(game.dispatch({ type: 'sellJoker', uid: broker!.uid }).ok).toBe(true);
    expect(calls).toEqual([
      { uid: broker!.uid, sold: noop!.uid, isSelf: false, isCopy: true },
      { uid: broker!.uid, sold: noop!.uid, isSelf: false, isCopy: false },
      { uid: broker!.uid, sold: broker!.uid, isSelf: false, isCopy: true },
      { uid: broker!.uid, sold: broker!.uid, isSelf: true, isCopy: false },
    ]);
  });
});

describe('skládání modifikátorů ze zdrojů', () => {
  it('kupón (passive) a štítek (passive s vlastním kontextem) se promítnou do Modifiers', () => {
    const seen: string[] = [];
    const reg = fx.makeRegistry({
      vouchers: [{ id: 'big_bag', tier: 1, cost: 8, passive: () => ({ handSize: 1 }), art: fx.ART }],
      tags: [
        fx.tag('coupon', {
          passive: (ctx) => {
            seen.push(ctx.self.defId);
            return { shopDiscountPct: 25 };
          },
        }),
      ],
    });
    const game = fx.makeGame({ registry: reg });
    game._core.state.vouchers.push('big_bag');
    game._core.api.addTag('coupon');
    game._core.invalidate();
    expect(game.modifiers()).toMatchObject({ handSize: 9, shopDiscountPct: 25 });
    expect(seen.at(-1)).toBe('coupon');
  });
});
