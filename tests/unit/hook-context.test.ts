/**
 * Kontexty hooků po optimalizaci skórování (ScoringInfo jako sdílená vrstva-prototyp místo kopírování přes
 * `extend`, líně vytvářené RNG): hooky musí vidět totéž co dřív — živé `chips`/`mult`, informace o ruce, vlastní pole
 * volání (`card`, `isRetrigger`, `score`), `state`/`mods`/`api`/`rng`/`chance`, a náhoda musí jít ve stejném pořadí.
 */
import { describe, expect, it } from 'vitest';
import type { JokerCardCtx, Rng } from '../../src/engine/content-types';
import { rngFromState } from '../../src/engine/rng/rng';
import type { RngState } from '../../src/engine/types';
import { boss, joker, makeGame, makeRegistry, play, selectBoss, setupRound } from './fixtures/registry';

describe('kontext hooku ve skórování', () => {
  it('onCardScored: vlastní card/isRetrigger, zděděná ScoringInfo s živými chips/mult a základ kontextu', () => {
    const seen: Record<string, unknown>[] = [];
    const reg = makeRegistry({
      jokers: [
        joker('inspector', {
          hooks: {
            onCardScored: (ctx: JokerCardCtx) => {
              seen.push({
                card: ctx.card.rank,
                isRetrigger: ctx.isRetrigger,
                hand: ctx.hand.type,
                played: ctx.played.length,
                scoring: ctx.scoring.length,
                held: ctx.held.length,
                chips: ctx.chips,
                mult: ctx.mult,
                round: ctx.round === ctx.state.round,
                firstHand: ctx.firstHand,
                lastHand: ctx.lastHand,
                index: ctx.index,
                isCopy: ctx.isCopy,
                self: ctx.self.defId,
                def: ctx.def.id,
                api: typeof ctx.api.addMoney,
                mods: ctx.mods.handSize,
                rng: typeof ctx.rng.next,
              });
              return { chips: 1 };
            },
            afterHandScored: (ctx) => {
              seen.push({ score: ctx.score, hasCard: 'card' in ctx, hand: ctx.hand.type });
            },
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['inspector'], round: true });
    const cards = setupRound(game, 'KH KS 2C');
    const { result } = play(game, cards.slice(0, 2));
    expect(seen).toEqual([
      {
        card: 13,
        isRetrigger: false,
        hand: 'pair',
        played: 2,
        scoring: 2,
        held: 1,
        chips: 22, // 12 základ Dvojice + 10 za krále
        mult: 2,
        round: true,
        firstHand: true,
        lastHand: false,
        index: 0,
        isCopy: false,
        self: 'inspector',
        def: 'inspector',
        api: 'function',
        mods: 8,
        rng: 'function',
      },
      expect.objectContaining({ card: 13, chips: 33 }), // +1 od žolíka, +10 za druhého krále
      { score: result.score, hasCard: false, hand: 'pair' },
    ]);
  });

  it('šéf ve skórování (validateHand, modifyBase, adjustHandScore) dostane ScoringInfo i round', () => {
    const seen: string[] = [];
    const reg = makeRegistry({
      bosses: [
        boss('observer', {
          hooks: {
            validateHand: (ctx) => {
              seen.push(`validate:${ctx.hand.type}:${ctx.round.blind}`);
              return null;
            },
            modifyBase: (ctx, base) => {
              seen.push(`base:${ctx.scoring.length}:${ctx.chips}`);
              return base;
            },
            adjustHandScore: (ctx, score) => {
              seen.push(`adjust:${ctx.mult}`);
              return score;
            },
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg });
    selectBoss(game, 'observer');
    const cards = setupRound(game, 'AS AD');
    play(game, cards);
    expect(seen).toEqual(['validate:pair:boss', 'base:2:0', 'adjust:2']);
  });

  it('vylepšení karty dostane card i ScoringInfo', () => {
    const reg = makeRegistry();
    const seen: string[] = [];
    reg.enhancements.probe = {
      id: 'probe',
      onScored: (ctx) => {
        seen.push(`${ctx.card.rank}:${ctx.hand.type}:${ctx.chips}`);
        return null;
      },
      art: { icon: 'x', bg: '#000', fg: '#fff' },
    };
    const game = makeGame({ registry: reg, round: true });
    const cards = setupRound(game, '5H:probe');
    play(game, cards);
    expect(seen).toEqual(['5:high_card:11']); // 6 základ Vysoké karty + 5
  });
});

describe('RNG v kontextu', () => {
  it('líně vytvořené RNG táhne ze streamu ve stejném pořadí jako dřív (jeden společný stav)', () => {
    const draws: number[] = [];
    const reg = makeRegistry({
      jokers: [
        joker('dice_a', { hooks: { onHandPlayed: (ctx) => void draws.push(ctx.rng.next()) } }),
        joker('dice_b', {
          hooks: { onHandPlayed: (ctx) => void draws.push(ctx.rng.next(), ctx.rng.next()) },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['dice_a', 'dice_b'], round: true });
    const initial = [...game.state.rng.joker] as RngState;
    play(game, game.state.round!.hand.slice(0, 1));
    const advanced = [...initial] as RngState;
    const expected = rngFromState(advanced);
    expect(draws).toEqual([expected.next(), expected.next(), expected.next()]);
    // Pokrok streamu je ve stavu runu.
    expect(game.state.rng.joker).toEqual(advanced);
  });

  it('chance jde použít i po destrukturování; přiřazení ctx.rng platí jen pro ten kontext', () => {
    const results: boolean[] = [];
    const fixed: Rng = { ...rngFromState([1, 2, 3, 4]), next: () => 0.99 };
    const reg = makeRegistry({
      jokers: [
        joker('lucky_one', {
          hooks: {
            onHandPlayed: (ctx) => {
              const { chance } = ctx;
              results.push(chance(1, 1));
              Object.assign(ctx, { rng: fixed });
              results.push(ctx.rng.next() === 0.99);
            },
          },
        }),
        joker('other', { hooks: { onHandPlayed: (ctx) => void results.push(ctx.rng !== fixed) } }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['lucky_one', 'other'], round: true });
    play(game, game.state.round!.hand.slice(0, 1));
    expect(results).toEqual([true, true, true]);
  });

  it('kontext vytvořený v dotazu (passive) pracuje na kopii streamu — stav runu se neposune', () => {
    const reg = makeRegistry({
      jokers: [
        joker('nervous', { hooks: { passive: (ctx) => (ctx.rng.next() < 2 ? { handSize: 1 } : {}) } }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['nervous'] });
    const before = JSON.stringify(game.state.rng);
    for (let i = 0; i < 5; i++) {
      game._core.invalidate();
      expect(game.modifiers().handSize).toBe(9);
    }
    expect(JSON.stringify(game.state.rng)).toBe(before);
  });
});
