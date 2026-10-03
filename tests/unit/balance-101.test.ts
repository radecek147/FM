/**
 * Designové opravy 1.0.1 (docs/DECISIONS.md 2026-10-03 „Odlišení od Balatra a designové opravy po testu 1.0“):
 * strop ×mult z opakovaných aktivací karty (Dechovka + sklo), šéfové po revizi, nekonečný režim.
 */
import { describe, expect, it } from 'vitest';
import { HAND_TYPE_DEFS } from '../../src/content/hands';
import { JOKERS } from '../../src/content/jokers';
import { MAX_XMULT_ACTIVATIONS_PER_CARD } from '../../src/engine/constants';
import type { ContentRegistry } from '../../src/engine/content-types';
import type { Game } from '../../src/engine/run/game';
import type { HandType, ScoreResult } from '../../src/engine/types';
import { makeGame, makeRegistry, play, setupRound } from './fixtures/registry';

/** Registr se skutečnou tabulkou kombinací a skutečnými žolíky (jako měřicí skript revize designu). */
const realReg: ContentRegistry = { ...makeRegistry({ jokers: JOKERS }), handTypes: HAND_TYPE_DEFS };

function playRound(
  jokers: string[],
  hand: string,
  levels: Partial<Record<HandType, number>> = {},
  reg: ContentRegistry = realReg,
): { game: Game; result: ScoreResult } {
  const game = makeGame({ registry: reg, jokers, round: true });
  const cards = setupRound(game, hand, { levels });
  const round = game._core.state.round!;
  round.target = 1e300;
  round.handsLeft = 5;
  return { game, result: play(game, cards).result };
}

/** Kolik kroků ×mult dala ve skórování která karta (z karty samotné i ze žolíků reagujících na ni). */
function xmultStepsPerCard(result: ScoreResult): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of result.steps) {
    if (s.cardId === undefined || s.xmult === undefined) continue;
    out.set(s.cardId, (out.get(s.cardId) ?? 0) + 1);
  }
  return out;
}

describe('strop ×mult z opakovaných aktivací karty (Dechovka + skleněné karty)', () => {
  it('Trojice králů úr. 3 se 3× sklem a Dechovkou: dřív ≈ 95,9 milionu, teď pod 250 000', () => {
    const { result } = playRound(['brass_band'], 'KS:glass KH:glass KD:glass', { three: 3 });
    expect(result.hand.type).toBe('three');
    expect(result.score).toBeLessThan(250_000);
    for (const n of xmultStepsPerCard(result).values()) expect(n).toBe(MAX_XMULT_ACTIVATIONS_PER_CARD);
    // Opakování nad strop dál dávají čipy: 5 aktivací × 10 čipů na kartu.
    const kingChips = result.steps.filter((s) => s.source === 'card' && s.chips === 10).length;
    expect(kingChips).toBe(15);
  });

  it('Čtveřice 4× sklo s Dechovkou: dřív ≈ 2,3e12, teď pod 3 miliony', () => {
    const { result } = playRound(['brass_band'], 'KS:glass KH:glass KD:glass KC:glass', { four: 3 });
    expect(result.hand.type).toBe('four');
    expect(result.score).toBeLessThan(3_000_000);
  });

  it('Dechovka se sklem nedá víc ×mult než červená pečeť se sklem', () => {
    const band = playRound(['brass_band'], 'KS:glass KH:glass KD:glass', { three: 3 }).result;
    const red = playRound([], 'KS:glass@red KH:glass@red KD:glass@red', { three: 3 }).result;
    expect(band.mult).toBeLessThanOrEqual(red.mult);
  });

  it('Ozvěna z propasti (sklo + červená pečeť): poslední karta dá ×mult jen 2×', () => {
    const { result } = playRound(['echo'], 'AS:glass@red');
    expect(result.steps.filter((s) => s.xmult === 2)).toHaveLength(MAX_XMULT_ACTIVATIONS_PER_CARD);
    // 6 aktivací: čipy esa (11) dostane každá.
    expect(result.steps.filter((s) => s.source === 'card' && s.chips === 11)).toHaveLength(6);
  });

  it('Šťastná sedmička: 8 aktivací skleněné karty, ×2 jen dvakrát', () => {
    const game = makeGame({ registry: realReg, jokers: ['lucky_seven'], round: true });
    // 7 ze 7 = sedmička padne jistě.
    game._core.api.addPermanentModifier({ probabilityMult: 7 });
    const cards = setupRound(game, 'KS:glass');
    game._core.state.round!.target = 1e300;
    const result = play(game, cards).result;
    expect(result.steps.filter((s) => s.source === 'card' && s.chips === 10)).toHaveLength(8);
    expect(result.steps.filter((s) => s.xmult === 2)).toHaveLength(MAX_XMULT_ACTIVATIONS_PER_CARD);
  });

  it('ocelová karta v ruce s červenou pečetí dá ×1,5 dvakrát (strop ji neomezí)', () => {
    const game = makeGame({ registry: realReg, round: true });
    const cards = setupRound(game, 'KS QS:steel@red');
    game._core.state.round!.target = 1e300;
    const result = play(game, [cards[0]!]).result;
    expect(result.steps.filter((s) => s.source === 'held' && s.xmult === 1.5)).toHaveLength(2);
  });
});
