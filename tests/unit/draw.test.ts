/**
 * Unikátní id karet (`RunState.nextUid`) a lízání do velikosti ruky (DESIGN 1.2, ARCHITECTURE 2.1):
 * dobírací balíček se táhne z konce pole (`RoundState.drawPile`), ruka se po zahrání i zahození doplní
 * na `Modifiers.handSize`, s prázdným balíčkem jen tolik, kolik zbývá.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/run/game';
import type { RunState } from '../../src/engine/types';
import { card, makeGame } from './fixtures/registry';

/** Hra v Malé útratě s nedosažitelným cílem (kolo po zahrání neskončí). */
function roundGame(seed?: string): Game {
  const game = makeGame({ seed, round: true });
  game._core.state.round!.target = 1e15;
  return game;
}

describe('unikátní id karet (nextUid)', () => {
  it('standardní balíček dostane id 1–52 a čítač pokračuje od 53', () => {
    const game = makeGame();
    const ids = game.state.deck.map((c) => c.id);
    expect(ids).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
    expect(game.state.nextUid).toBe(53);
  });

  it('nové a kopírované karty i žolíci berou další id ze společného čítače — ani po uložení se neopakují', () => {
    const game = makeGame({ round: true });
    const api = game._core.api;
    const a = api.addCard(card('2C'));
    const b = api.copyCard(a.id)!;
    expect([a.id, b.id]).toEqual([53, 54]);

    const saved = JSON.parse(JSON.stringify(game.state)) as RunState;
    const restored = Game.fromState(saved, game.registry);
    const c = restored._core.api.addCard(card('3C'));
    expect(c.id).toBe(55);
    const all = restored.state.deck.map((x) => x.id);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('lízání do velikosti ruky', () => {
  it('začátek kola: 8 karet v ruce, 44 v dobíracím balíčku, každá karta právě jednou', () => {
    const game = makeGame({ round: true });
    const r = game.state.round!;
    expect(game.modifiers().handSize).toBe(8);
    expect(r.hand).toHaveLength(8);
    expect(r.drawPile).toHaveLength(44);
    expect(new Set([...r.hand, ...r.drawPile]).size).toBe(52);
  });

  it('po zahrání se ruka doplní z vršku balíčku (konec pole drawPile) zpět na 8', () => {
    const game = roundGame();
    const r = () => game.state.round!;
    const top = r().drawPile.slice(-3).reverse();
    const played = r().hand.slice(0, 3);
    expect(game.dispatch({ type: 'play', cardIds: played }).ok).toBe(true);
    expect(r().hand).toHaveLength(8);
    expect(r().drawPile).toHaveLength(41);
    expect(r().hand.slice(-3)).toEqual(top);
    // zahrané karty skončí po vyhodnocení ruky na odhazovací hromádce
    expect(r().playedPile).toEqual([]);
    expect(r().discardPile).toEqual(played);
    for (const id of played) expect(r().hand).not.toContain(id);
  });

  it('po zahození se ruka doplní stejně a karty jdou na odhazovací hromádku', () => {
    const game = roundGame();
    const r = () => game.state.round!;
    const top = r().drawPile.slice(-2).reverse();
    const discarded = r().hand.slice(2, 4);
    expect(game.dispatch({ type: 'discard', cardIds: discarded }).ok).toBe(true);
    expect(r().hand).toHaveLength(8);
    expect(r().drawPile).toHaveLength(42);
    expect(r().hand.slice(-2)).toEqual(top);
    expect(r().discardPile).toEqual(discarded);
  });

  it('když v balíčku dochází karty, dobere se jen to, co zbývá', () => {
    const game = roundGame();
    const r = () => game.state.round!;
    const rest = r().drawPile.splice(0, r().drawPile.length - 2);
    r().discardPile.push(...rest);
    expect(game.dispatch({ type: 'play', cardIds: r().hand.slice(0, 5) }).ok).toBe(true);
    expect(r().drawPile).toHaveLength(0);
    expect(r().hand).toHaveLength(5);
  });

  it('stejný seed ⇒ stejná ruka i stejné dobrání; jiný seed ⇒ jiná ruka', () => {
    const run = (seed: string) => {
      const game = roundGame(seed);
      const first = [...game.state.round!.hand];
      game.dispatch({ type: 'discard', cardIds: first.slice(0, 4) });
      return { first, after: [...game.state.round!.hand] };
    };
    expect(run('HANDSEED')).toEqual(run('HANDSEED'));
    expect(run('OTHERSD2').first).not.toEqual(run('HANDSEED').first);
  });
});
