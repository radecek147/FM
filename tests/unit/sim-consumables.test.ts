/**
 * Boti a spotřebky, obálky, kupóny (src/engine/sim/value.ts, bots.ts): ocenění změny stavu sondou na kopii hry,
 * výběr cílů, pořadí levé/pravé karty, držení spotřebek, nákupy podle hodnoty. Obsah hry (`buildRegistry`).
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { addConsumableInstance, newConsumableInstance, newJokerInstance } from '../../src/engine/effects/api';
import type { Game } from '../../src/engine/run/game';
import { createBot } from '../../src/engine/sim/index';
import { makeEnv } from '../../src/engine/sim/hand-eval';
import {
  expectedMaxOfK,
  holdWorth,
  levelWorth,
  makeView,
  planTargets,
  stateDelta,
  type ValueStyle,
} from '../../src/engine/sim/value';
import type { Action, Card } from '../../src/engine/types';
import { SUITS } from '../../src/engine/types';
import { addJokers, makeGame, setupRound } from './fixtures/registry';

const reg = buildRegistry();

const FLUSH_STYLE: ValueStyle = {
  favorHands: ['flush', 'straight_flush', 'royal_flush', 'flush_house', 'flush_five'],
  suitFocus: true,
  rankFocus: false,
  buysJokers: true,
  fullReserve: false,
};
const MAX_STYLE: ValueStyle = { ...FLUSH_STYLE, favorHands: [], suitFocus: false };

const HEARTS = SUITS.indexOf('H');

function view(game: Game, style: ValueStyle = MAX_STYLE, mainSuit = HEARTS) {
  return makeView(game, style, makeEnv(game), mainSuit, () => 1);
}

/** Hra v kole (obsah hry) s danou rukou a nedosažitelným cílem. */
function round(hand: string, money = 10): { game: Game; cards: Card[] } {
  const game = makeGame({ registry: reg, deckId: 'pub', round: true, money });
  game._core.state.round!.target = 1e9;
  const cards = setupRound(game, hand);
  return { game, cards };
}

function give(game: Game, defId: string): number {
  const inst = newConsumableInstance(game._core, defId);
  addConsumableInstance(game._core, inst, true);
  return inst.uid;
}

/** Nechá bota rozhodovat, dokud nepošle akci jiného typu než `skip` (nejvýš `limit` kroků), a vrátí ji. */
function nextAction(
  game: Game,
  botName: Parameters<typeof createBot>[0],
  skip: Action['type'][] = [],
): Action {
  const bot = createBot(botName);
  for (let i = 0; i < 10; i++) {
    const a = bot.decide(game);
    if (!skip.includes(a.type)) return a;
    expect(game.dispatch(a).ok).toBe(true);
  }
  throw new Error('bot se zacyklil');
}

describe('value – pomocné výpočty', () => {
  it('expectedMaxOfK = průměr maxima přes všechny k-tice (hrubou silou)', () => {
    const values = [5, 1, 3, 3, 0.5, 2];
    for (let k = 1; k <= values.length; k++) {
      let sum = 0;
      let count = 0;
      const rec = (start: number, picked: number[]): void => {
        if (picked.length === k) {
          sum += Math.max(...picked);
          count++;
          return;
        }
        for (let i = start; i < values.length; i++) rec(i + 1, [...picked, values[i]!]);
      };
      rec(0, []);
      expect(expectedMaxOfK(values, k)).toBeCloseTo(sum / count, 10);
    }
    expect(expectedMaxOfK([], 3)).toBe(0);
  });

  it('úroveň kombinace má cenu podle podílu na hře; oblíbené kombinace stylu víc', () => {
    const { game } = round('2H 5S 9D KC 7H 10S 4C AD');
    const flush = view(game, FLUSH_STYLE);
    const max = view(game, MAX_STYLE);
    expect(levelWorth(flush, 'flush')).toBeGreaterThan(levelWorth(max, 'flush'));
    expect(levelWorth(flush, 'flush')).toBeGreaterThan(levelWorth(flush, 'high_card'));
    game._core.state.stats.handTypeCounts = { pair: 40 };
    expect(levelWorth(view(game), 'pair')).toBeGreaterThan(5 * levelWorth(view(game), 'straight'));
  });

  it('stateDelta: peníze, úrovně a modifikátory z kopie hry po akci', () => {
    const { game } = round('2H 5S 9D KC 7H 10S 4C AD');
    const v = view(game);
    const after = createCloneWith(game, (g) => {
      g._core.state.money += 7;
      g._core.state.handLevels.pair.level += 1;
    });
    const d = stateDelta(v, after);
    expect(d.money).toBe(7);
    expect(d.total).toBeCloseTo(7 + levelWorth(v, 'pair'), 6);
  });
});

/** Kopie hry upravená funkcí (stav nové hry je nezávislý). */
function createCloneWith(game: Game, mutate: (g: Game) => void): Game {
  const copy = makeGame({ registry: reg, deckId: 'pub' });
  copy._core.state = JSON.parse(JSON.stringify(game.state)) as typeof copy._core.state;
  copy._core.invalidate();
  mutate(copy);
  copy._core.invalidate();
  return copy;
}

describe('value – výběr cílů sondou', () => {
  it('Pálivá paprička u Barvaře: obě karty hlavní barvy, nejcennější', () => {
    const { game, cards } = round('AH KH 9H 4H 2S 3C 5D 6S');
    const uid = give(game, 'chili');
    const plan = planTargets(
      view(game, FLUSH_STYLE),
      reg.consumables.chili!,
      game.state.round!.hand,
      (t) => ({ type: 'useConsumable', uid, targetIds: t }),
      'test',
      JSON.stringify(game.state),
    );
    expect(plan).not.toBeNull();
    expect(plan!.targets).toHaveLength(2);
    expect(plan!.ordered).toBe(false);
    const hearts = new Set(cards.filter((c) => c.suit === 'H').map((c) => c.id));
    for (const id of plan!.targets) expect(hearts.has(id)).toBe(true);
    expect(plan!.value).toBeGreaterThan(0);
  });

  it('Generální úklid zničí slabé karty mimo hlavní barvu, ne srdce', () => {
    const { game, cards } = round('AH KH 9H 4H 2S 3C 5D 6S');
    const uid = give(game, 'spring_cleaning');
    const plan = planTargets(
      view(game, FLUSH_STYLE),
      reg.consumables.spring_cleaning!,
      game.state.round!.hand,
      (t) => ({ type: 'useConsumable', uid, targetIds: t }),
      'test',
      JSON.stringify(game.state),
    );
    expect(plan).not.toBeNull();
    const hearts = new Set(cards.filter((c) => c.suit === 'H').map((c) => c.id));
    expect(plan!.targets.length).toBeGreaterThan(0);
    for (const id of plan!.targets) expect(hearts.has(id)).toBe(false);
  });

  it('Sloučení spisů: levá (dobrá karta) převezme sklo a pečeť pravé; Barvař nejdřív přeřadí ruku', () => {
    // Skleněná křížová dvojka s červenou pečetí stojí vlevo od srdcového esa — plán chce eso vlevo.
    const { game, cards } = round('2C:glass@red 3H 4H AH 6H 7C 8D 9S');
    const two = cards[0]!;
    const ace = cards[3]!;
    give(game, 'merge_files');
    const first = nextAction(game, 'flush', ['reorderJokers']);
    expect(first.type).toBe('reorderHand');
    expect(game.dispatch(first).ok).toBe(true);
    const hand = game.state.round!.hand;
    expect(hand.indexOf(ace.id)).toBeLessThan(hand.indexOf(two.id));
    const second = nextAction(game, 'flush', ['reorderJokers']);
    expect(second).toMatchObject({ type: 'useConsumable', targetIds: [ace.id, two.id] });
    expect(game.dispatch(second).ok).toBe(true);
    const merged = game._core.mustCard(ace.id);
    expect([merged.enhancement, merged.seal]).toEqual(['glass', 'red']);
    expect(game.state.deck.some((c) => c.id === two.id)).toBe(false);
  });
});

describe('boti – spotřebky ve slotech', () => {
  it('pranostiku použije hned; s Babiččinou truhlou drží pranostiku málo hrané kombinace', () => {
    const { game } = round('2H 5S 9D KC 7H 10S 4C AD');
    const uid = give(game, 'hen_step');
    expect(nextAction(game, 'max')).toEqual({ type: 'useConsumable', uid });

    const chest = round('2H 5S 9D KC 7H 10S 4C AD');
    addJokers(chest.game, ['grandmas_chest']);
    give(chest.game, 'hen_step');
    expect(holdWorth(chest.game)).toBeGreaterThan(levelWorth(view(chest.game), 'high_card'));
    expect(nextAction(chest.game, 'max', ['reorderJokers']).type).not.toBe('useConsumable');
  });

  it('Pod slamníkem počká, dokud nedá aspoň 6 Kč (s 30 Kč ho použije)', () => {
    const poor = makeGame({ registry: reg, deckId: 'pub', money: 6 });
    give(poor, 'under_mattress');
    expect(nextAction(poor, 'max')).toEqual({ type: 'selectBlind' });

    const rich = makeGame({ registry: reg, deckId: 'pub', money: 30 });
    const uid = give(rich, 'under_mattress');
    expect(nextAction(rich, 'max')).toEqual({ type: 'useConsumable', uid });
    expect(rich.dispatch({ type: 'useConsumable', uid }).ok).toBe(true);
    expect(rich.state.money).toBe(42);
  });

  it('Ověřenou kopii nepoužije, když by zničila dobré žolíky; s jediným žolíkem ano', () => {
    const many = makeGame({ registry: reg, deckId: 'pub' });
    addJokers(many, ['late_train', 'head_waiter', 'innkeeper']);
    give(many, 'certified_copy');
    expect(nextAction(many, 'max', ['reorderJokers']).type).not.toBe('useConsumable');

    const one = makeGame({ registry: reg, deckId: 'pub' });
    addJokers(one, ['innkeeper']);
    const uid = give(one, 'certified_copy');
    expect(nextAction(one, 'max')).toEqual({ type: 'useConsumable', uid });
    expect(one.dispatch({ type: 'useConsumable', uid }).ok).toBe(true);
    expect(one.state.jokers.map((j) => j.defId)).toEqual(['innkeeper', 'innkeeper']);
  });

  it('Česnek na krk použije na začátku kola na debuffnutou kartu (jinak ne)', () => {
    const { game, cards } = round('2H 5S 9D! KC 7H 10S 4C AD');
    const uid = give(game, 'garlic');
    const a = nextAction(game, 'max');
    expect(a).toMatchObject({ type: 'useConsumable', uid });
    expect((a as { targetIds: number[] }).targetIds).toContain(cards[2]!.id);
    expect(game.dispatch(a).ok).toBe(true);
    expect(game._core.mustCard(cards[2]!.id).debuffed).toBe(false);

    const clean = round('2H 5S 9D KC 7H 10S 4C AD');
    give(clean.game, 'garlic');
    expect(nextAction(clean.game, 'max').type).not.toBe('useConsumable');
  });

  it('Úřední hodiny s jedinou rukou za kolo použít nejde a bot to nezkouší (0 neplatných akcí)', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    game.ctx().api.addPermanentModifier({ hands: -3 });
    give(game, 'office_hours');
    const a = nextAction(game, 'max');
    expect(a.type).not.toBe('useConsumable');
    expect(game.dispatch(a).ok).toBe(true);
  });
});

describe('boti – Večerka a obálky', () => {
  function shopGame(money: number): Game {
    const game = makeGame({ registry: reg, deckId: 'pub', money });
    const s = game._core.state;
    s.phase = 'shop';
    s.shop = {
      items: [],
      boosters: [],
      vouchers: [],
      rerollCost: 99,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    return game;
  }

  it('kupón kupuje podle hodnoty: Prodlouženou otvíračku ano, Stánek s kartami ne', () => {
    const good = shopGame(20);
    good._core.state.shop!.vouchers = [{ voucherId: 'late_hours', price: 12, sold: false }];
    expect(nextAction(good, 'max')).toEqual({ type: 'buyVoucher', slot: 0 });

    const bad = shopGame(20);
    bad._core.state.shop!.vouchers = [{ voucherId: 'card_stall', price: 9, sold: false }];
    expect(nextAction(bad, 'max')).toEqual({ type: 'leaveShop' });
  });

  it('pranostiku hrané kombinace koupí a hned použije', () => {
    const game = shopGame(10);
    game._core.state.stats.handTypeCounts = { flush: 12, pair: 3 };
    const c = newConsumableInstance(game._core, 'medard_drop');
    game._core.state.shop!.items = [
      { kind: 'consumable', consumable: c, consumableKind: 'pranostika', price: 3, sold: false },
    ];
    expect(nextAction(game, 'flush')).toEqual({ type: 'buyAndUse', slot: 0 });
  });

  it('z pranostikové obálky vybere pranostiku své hlavní kombinace', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    game._core.state.stats.handTypeCounts = { two_pair: 2, flush: 15 };
    game.startBooster('pranostika_normal', 'blind_select');
    const b = game._core.state.booster!;
    b.options = ['hen_step', 'medard_drop', 'three_kings'].map((id) => ({
      kind: 'consumable' as const,
      consumable: newConsumableInstance(game._core, id),
      consumableKind: 'pranostika' as const,
    }));
    expect(nextAction(game, 'max')).toEqual({ type: 'pickBooster', index: 1 });
  });

  it('žolíka z obálky do plných slotů nevybere, ale slabého prodá, je-li nový výrazně lepší', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    const weak = addJokers(game, ['beer_mat', 'beer_mat', 'beer_mat', 'beer_mat', 'beer_mat']);
    game.startBooster('joker_normal', 'blind_select');
    const b = game._core.state.booster!;
    b.options = [{ kind: 'joker', joker: newJokerInstance(game._core, 'innkeeper') }];
    const a = nextAction(game, 'max', ['reorderJokers']);
    expect(a.type).toBe('sellJoker');
    expect(weak.map((j) => j.uid)).toContain((a as { uid: number }).uid);
    expect(game.dispatch(a).ok).toBe(true);
    expect(nextAction(game, 'max', ['reorderJokers'])).toEqual({ type: 'pickBooster', index: 0 });
  });
});
