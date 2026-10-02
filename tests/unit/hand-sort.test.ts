/**
 * Trvalé třídění ruky (`RunState.handSort`): tlačítko Hodnota / Barva seřadí ruku a nově dobrané karty se pak
 * zařazují samy; ruční přesun karty třídění vypne. Platí přes kola runu i po uložení.
 */
import { describe, expect, it } from 'vitest';
import { compareCards } from '../../src/engine/cards/cards';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import type { ActionResult, HandSortMode, RunState } from '../../src/engine/types';
import { makeGame, makeRegistry, winNextHand } from './fixtures/registry';

function ok(res: ActionResult): void {
  if (!res.ok) throw new Error(`action failed: ${res.error}`);
}

function isSorted(game: Game, ids: readonly number[], by: HandSortMode): boolean {
  const enh = game._core.enhancements();
  return ids.every((id, i) => i === 0 || compareCards(game.card(ids[i - 1]!)!, game.card(id)!, by, enh) <= 0);
}

describe('trvalé třídění ruky', () => {
  it('po seřazení podle hodnoty se i nově dobrané karty zařadí', () => {
    const game = makeGame({ round: true });
    expect(game.state.handSort ?? null).toBeNull();
    ok(game.dispatch({ type: 'sortHand', by: 'rank' }));
    expect(game.state.handSort).toBe('rank');
    const before = [...game.state.round!.hand];
    ok(game.dispatch({ type: 'discard', cardIds: before.slice(0, 3) }));
    const hand = game.state.round!.hand;
    expect(hand.filter((id) => !before.includes(id))).toHaveLength(3);
    expect(isSorted(game, hand, 'rank')).toBe(true);
  });

  it('podle barvy platí i po zahrané ruce', () => {
    const game = makeGame({ round: true });
    ok(game.dispatch({ type: 'sortHand', by: 'suit' }));
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    if (game.state.phase === 'round') expect(isSorted(game, game.state.round!.hand, 'suit')).toBe(true);
  });

  it('ruční přesun karty třídění vypne — nové karty pak přijdou na konec', () => {
    const game = makeGame({ round: true });
    ok(game.dispatch({ type: 'sortHand', by: 'rank' }));
    const reversed = [...game.state.round!.hand].reverse();
    ok(game.dispatch({ type: 'reorderHand', cardIds: reversed }));
    expect(game.state.handSort).toBeNull();
    expect(game.state.round!.hand).toEqual(reversed);
    ok(game.dispatch({ type: 'discard', cardIds: reversed.slice(0, 2) }));
    expect(game.state.round!.hand.slice(0, reversed.length - 2)).toEqual(reversed.slice(2));
  });

  it('třídění drží přes další kolo a přežije uložení', () => {
    const game = makeGame({ round: true });
    ok(game.dispatch({ type: 'sortHand', by: 'suit' }));
    winNextHand(game);
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(game.state.phase).toBe('round_end');
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'leaveShop' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.handSort).toBe('suit');
    expect(isSorted(game, game.state.round!.hand, 'suit')).toBe(true);
    const loaded = Game.fromState(deserializeRun(serializeRun(game.state)), makeRegistry());
    expect(loaded.state.handSort).toBe('suit');
    ok(loaded.dispatch({ type: 'discard', cardIds: loaded.state.round!.hand.slice(0, 2) }));
    expect(isSorted(loaded, loaded.state.round!.hand, 'suit')).toBe(true);
  });

  it('starší uložení bez handSort se načte a ruku samo netřídí', () => {
    const game = makeGame({ round: true });
    const state = structuredClone(game.state) as RunState;
    delete state.handSort;
    const loaded = Game.fromState(deserializeRun(serializeRun(state)), makeRegistry());
    const hand = [...loaded.state.round!.hand];
    ok(loaded.dispatch({ type: 'discard', cardIds: hand.slice(0, 2) }));
    expect(loaded.state.round!.hand.slice(0, hand.length - 2)).toEqual(hand.slice(2));
  });
});
