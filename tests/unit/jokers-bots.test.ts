/**
 * Boti simulace a žolíci (src/engine/sim/bots.ts, docs/DESIGN.md 4.5 a 12.2): řazení ve slotech, barva a kombinace,
 * které chtějí vlastní žolíci, nákup podle štítků a `params` (mrtví žolíci, dluh) a trest za zahození (Hostinský).
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import type { ContentRegistry } from '../../src/engine/content-types';
import { newJokerInstance } from '../../src/engine/effects/api';
import type { Game } from '../../src/engine/run/game';
import { createBot } from '../../src/engine/sim/index';
import type { Action, Card } from '../../src/engine/types';
import { consumable, makeGame, setupRound, type JokerSpec } from './fixtures/registry';

const reg = buildRegistry();

/** Hra skutečného obsahu (balíček Hospodský) s žolíky zleva doprava. */
function gameWith(jokers: (string | JokerSpec)[] = [], registry: ContentRegistry = reg): Game {
  return makeGame({ registry, deckId: 'pub', jokers });
}

/** Rozehrané kolo s danou rukou a velkým cílem (zahrání hned nestačí, bot zvažuje zahození). */
function roundWith(hand: string, jokers: (string | JokerSpec)[] = []): { game: Game; cards: Card[] } {
  const game = gameWith(jokers);
  const cards = setupRound(game, hand);
  game._core.state.round!.target = 100_000;
  return { game, cards };
}

/** Večerka jen se žolíky v nabídce (bez přehazování — limit přehození v této Večerce je vyčerpaný). */
function shopWith(
  offers: string[],
  opts: { money: number; owned?: string[]; registry?: ContentRegistry },
): Game {
  const game = gameWith(opts.owned ?? [], opts.registry ?? reg);
  const core = game._core;
  core.state.money = opts.money;
  core.state.phase = 'shop';
  core.state.shop = {
    items: offers.map((id) => ({
      kind: 'joker' as const,
      joker: newJokerInstance(core, id),
      price: core.registry.jokers[id]!.cost,
      sold: false,
    })),
    boosters: [],
    vouchers: [],
    rerollCost: 5,
    rerollsThisShop: 3,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  core.invalidate();
  return game;
}

const discarded = (a: Action): number[] => (a.type === 'discard' ? a.cardIds : []);

describe('boti a žolíci – řazení ve slotech', () => {
  it('+čipy/+mult vlevo, ×mult vpravo; kopírující žolík patří tam, kam patří jeho cíl', () => {
    const game = gameWith(['late_train', 'impersonator', 'beer_mat']);
    const [train, imp, mat] = game.state.jokers;
    // Bez cíle stojí Napodobitel uprostřed.
    expect(createBot('max').decide(game)).toEqual({
      type: 'reorderJokers',
      uids: [mat!.uid, imp!.uid, train!.uid],
    });
    // Kopíruje Pivní tácek (+mult) → patří vlevo k němu.
    game._core.state.jokers[1]!.state.target = mat!.uid;
    expect(createBot('max').decide(game)).toEqual({
      type: 'reorderJokers',
      uids: [imp!.uid, mat!.uid, train!.uid],
    });
  });
});

describe('boti a žolíci – barva a kombinace vlastních žolíků', () => {
  it('flush honí barvu, kterou chce jeho barevný žolík (Srdcař → ♥), i proti mírné převaze jiné barvy', () => {
    const hand = 'AS 9S 6S 4S KH 8H 5H 3H';
    const plain = roundWith(hand);
    const spades = plain.cards.slice(0, 4).map((c) => c.id);
    const hearts = plain.cards.slice(4).map((c) => c.id);
    // Bez žolíka: shoda počtu, rozhodne cena — drží piky.
    const a = discarded(createBot('flush').decide(plain.game));
    expect(a.length).toBeGreaterThan(0);
    for (const id of spades) expect(a).not.toContain(id);

    const withJoker = roundWith(hand, ['hearts_man']);
    const b = discarded(createBot('flush').decide(withJoker.game));
    expect(b.length).toBeGreaterThan(0);
    for (const id of withJoker.cards.slice(4).map((c) => c.id)) expect(b).not.toContain(id);
    expect(hearts.length).toBe(4);
  });
});

describe('boti a žolíci – nákup podle štítků a params', () => {
  it('spotřebkového žolíka bez spotřebek v obsahu ani žolíka na úroveň bez pranostik nekoupí', () => {
    const noConsumables: ContentRegistry = { ...reg, consumables: {} };
    const game = shopWith(['grandmas_chest', 'herbalist', 'old_guard', 'beer_mat'], {
      money: 50,
      registry: noConsumables,
    });
    expect(createBot('max').decide(game)).toEqual({ type: 'buy', slot: 3 });
  });

  it('s pranostikami v obsahu je Stará garda zase nejlepší nabídka', () => {
    const withPlanets: ContentRegistry = {
      ...reg,
      consumables: { test_planet: consumable('test_planet', { kind: 'pranostika', hand: 'pair' }) },
    };
    const game = shopWith(['old_guard', 'beer_mat'], { money: 50, registry: withPlanets });
    expect(createBot('max').decide(game)).toEqual({ type: 'buy', slot: 0 });
  });

  it('se Sekerou koupí žolíka i do mínusu, bez ní ne', () => {
    expect(createBot('max').decide(shopWith(['beer_mat'], { money: 1, owned: ['tab'] }))).toEqual({
      type: 'buy',
      slot: 0,
    });
    expect(createBot('max').decide(shopWith(['beer_mat'], { money: 1 }))).toEqual({ type: 'leaveShop' });
    // Šetřílek dluh nechce.
    expect(createBot('econ').decide(shopWith(['beer_mat'], { money: 1, owned: ['tab'] }))).toEqual({
      type: 'leaveShop',
    });
  });
});

describe('boti a žolíci – trest za zahození', () => {
  it('s Hostinským radši zahraje, než aby přišel o ×mult; bez něj zahazuje', () => {
    // Dvě dvojice (QQ 55): bez žolíka se vyplatí honit Full house, s Hostinským (×2,2) radši zahraje.
    const hand = 'QH QS 9D 4C 5H 5S 8D 7C';
    expect(createBot('max').decide(roundWith(hand).game).type).toBe('discard');
    expect(createBot('max').decide(roundWith(hand, ['innkeeper']).game).type).toBe('play');
  });
});
