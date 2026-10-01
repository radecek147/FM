/**
 * Determinismus enginu (CLAUDE.md kap. 2 a 8, ARCHITECTURE 2.2–2.3): stejný seed ⇒ stejné zamíchání balíčku
 * (stream `deck`) a stejné výsledky šťastných a skleněných karet; jiný seed ⇒ jiné. Čerpání jiných streamů
 * míchání balíčku neovlivní a uložení přes JSON uprostřed kola pokračuje identicky.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/run/game';
import type { RunState, ScoreStep } from '../../src/engine/types';
import { makeGame, play, setupRound } from './fixtures/registry';

const SEEDS = ['ALPHA234', 'BRAVO567', 'CHARLIE8', 'DELTA9XY', 'ECHOZ234', 'FOXTROT5'];

/** Pořadí dobíracího balíčku (+ ruka) po výběru první útraty. */
function shuffled(seed: string): number[] {
  const game = makeGame({ seed, round: true });
  const r = game.state.round!;
  return [...r.drawPile, ...r.hand];
}

/** Kroky šťastných karet (5× Barva ze šťastných ♥) v několika rukách. */
function luckySteps(seed: string): Pick<ScoreStep, 'cardId' | 'message'>[][] {
  const game = makeGame({ seed, round: true });
  game._core.state.round!.target = 1e15;
  const out: Pick<ScoreStep, 'cardId' | 'message'>[][] = [];
  for (let hand = 0; hand < 3; hand++) {
    const cards = setupRound(game, '2H:lucky 4H:lucky 6H:lucky 8H:lucky 10H:lucky');
    const { result } = play(game, cards);
    out.push(
      result.steps
        .filter((s) => s.message)
        .map((s) => ({ cardId: cards.findIndex((c) => c.id === s.cardId), message: s.message })),
    );
  }
  return out;
}

/** Které skleněné karty (index v ruce) praskly v jedné ruce. */
function glassBreaks(seed: string): number[] {
  const game = makeGame({ seed, round: true });
  const cards = setupRound(game, '2S:glass 2H:glass 2D:glass 2C:glass');
  const { result } = play(game, cards);
  return result.destroyedCardIds.map((id) => cards.findIndex((c) => c.id === id)).sort();
}

describe('míchání balíčku (stream deck)', () => {
  it('stejný seed ⇒ stejné pořadí; jiný seed ⇒ jiné', () => {
    const a = shuffled('SEEDAAAA');
    expect(shuffled('SEEDAAAA')).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
    expect(shuffled('SEEDBBBB')).not.toEqual(a);
  });

  it('seed se normalizuje (mezery, malá písmena)', () => {
    expect(shuffled(' seedaaaa ')).toEqual(shuffled('SEEDAAAA'));
  });

  it('čerpání jiných streamů (žolíci, spotřebky, šéf) zamíchání neovlivní', () => {
    const plain = shuffled('ISOLATED');
    const game = makeGame({ seed: 'ISOLATED' });
    const api = game._core.api;
    game._core.state.bannedJokers = ['golem']; // Golem by přidal kartu do balíčku
    for (let i = 0; i < 5; i++) api.createJoker({ ignoreSlots: true });
    api.createConsumable({ kind: 'rada', ignoreSlots: true });
    api.rerollBoss();
    game.dispatch({ type: 'selectBlind' });
    const r = game.state.round!;
    expect([...r.drawPile, ...r.hand]).toEqual(plain);
  });

  it('každé kolo se balíček míchá znovu (stav streamu pokračuje)', () => {
    const game = makeGame({ seed: 'ROUNDS22', round: true });
    const first = [...game.state.round!.drawPile];
    game._core.state.round!.target = 1;
    play(game, [game.state.round!.hand[0]!]);
    game.dispatch({ type: 'cashOut' });
    game.dispatch({ type: 'leaveShop' });
    game.dispatch({ type: 'selectBlind' });
    expect(game.state.round!.drawPile).not.toEqual(first);
  });
});

describe('šťastné a skleněné karty', () => {
  it('stejný seed ⇒ stejné výsledky šťastných karet', () => {
    for (const seed of SEEDS.slice(0, 3)) expect(luckySteps(seed)).toEqual(luckySteps(seed));
  });

  it('jiný seed ⇒ jiné výsledky šťastných karet', () => {
    const all = SEEDS.map((s) => JSON.stringify(luckySteps(s)));
    expect(new Set(all).size).toBeGreaterThan(1);
  });

  it('stejný seed ⇒ stejné prasknutí skla; jiný seed ⇒ jiné', () => {
    for (const seed of SEEDS) expect(glassBreaks(seed)).toEqual(glassBreaks(seed));
    const all = SEEDS.map((s) => JSON.stringify(glassBreaks(s)));
    expect(new Set(all).size).toBeGreaterThan(1);
  });
});

describe('celý průběh', () => {
  /** Několik akcí: zahození, zahrání, výhra kola, Večerka, přehození, další kolo. */
  function scenario(game: Game): void {
    const ids = () => game.state.round!.hand;
    expect(game.dispatch({ type: 'discard', cardIds: ids().slice(0, 3) }).ok).toBe(true);
    expect(game.dispatch({ type: 'play', cardIds: ids().slice(0, 5) }).ok).toBe(true);
    game._core.state.round!.target = 1;
    expect(game.dispatch({ type: 'play', cardIds: ids().slice(0, 2) }).ok).toBe(true);
    expect(game.dispatch({ type: 'cashOut' }).ok).toBe(true);
    game._core.state.money = 50;
    game.dispatch({ type: 'reroll' });
    expect(game.dispatch({ type: 'leaveShop' }).ok).toBe(true);
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    expect(game.dispatch({ type: 'play', cardIds: ids().slice(0, 4) }).ok).toBe(true);
  }

  it('stejný seed + stejné akce ⇒ identický stav', () => {
    const a = makeGame({ seed: 'SAMESEED', jokers: ['late_train', 'counter'], round: true });
    const b = makeGame({ seed: 'SAMESEED', jokers: ['late_train', 'counter'], round: true });
    scenario(a);
    scenario(b);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it('uložení přes JSON uprostřed kola pokračuje identicky', () => {
    const original = makeGame({ seed: 'SAVELOAD', jokers: ['late_train'], round: true });
    original.dispatch({ type: 'discard', cardIds: original.state.round!.hand.slice(0, 2) });
    const saved = JSON.parse(JSON.stringify(original.state)) as RunState;
    const restored = Game.fromState(saved, original.registry);
    const next = (g: Game) => g.dispatch({ type: 'play', cardIds: g.state.round!.hand.slice(0, 5) });
    const r1 = next(original);
    const r2 = next(restored);
    expect(r2).toEqual(r1);
    expect(JSON.stringify(restored.state)).toBe(JSON.stringify(original.state));
  });
});
