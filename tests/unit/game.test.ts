/**
 * Stavový automat runu (`Game.dispatch`, DESIGN kap. 1, 2.4, 2.5, 2.9, 7, 8, 10; ARCHITECTURE 2.2):
 * výběr a přeskočení útrat, kolo (zahrání, zahození, validace výběru), výhra a rozpis odměn, výplata, Večerka,
 * obálky, prodej, spotřebky, přeřazení, porážka šéfa a další patro, prohra, výhra v patře 8 a nekonečný režim.
 * Každá neplatná akce musí vrátit kód chyby, nezměnit stav a nedoručit na bus jedinou událost.
 */
import { describe, expect, it } from 'vitest';
import type { ConsumableDef, ContentRegistry, StakeDef, VoucherDef } from '../../src/engine/content-types';
import { BLIND_REWARDS, FINAL_ANTE, MSG, RENTAL_FEE, STARTING_MONEY } from '../../src/engine/constants';
import { createCard } from '../../src/engine/cards/cards';
import { newConsumableInstance, newJokerInstance } from '../../src/engine/effects/api';
import { pickBossId } from '../../src/engine/run/bosses';
import type { Game } from '../../src/engine/run/game';
import { blindTarget } from '../../src/engine/run/targets';
import { refreshShopPrices } from '../../src/engine/shop/prices';
import type {
  Action,
  ActionErrorCode,
  ActionResult,
  GameEvent,
  GameEventType,
  RoundRewards,
  ShopItem,
} from '../../src/engine/types';
import {
  ART,
  addJokers,
  boss,
  booster,
  consumable,
  joker,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  tag,
  winNextHand,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Úspěšná akce → její události (jinak výjimka s kódem chyby). */
function ok(res: ActionResult): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

function types(events: readonly GameEvent[]): GameEventType[] {
  return events.map((e) => e.type);
}

/** Najde první událost daného typu. */
function find<T extends GameEventType>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Odposlech busu (vrací doručené události a odhlášení). */
function listen(game: Game): { got: GameEvent[]; off: () => void } {
  const got: GameEvent[] = [];
  const off = game.bus.onAny((e) => got.push(e));
  return { got, off };
}

/** Neplatná akce: vrátí kód chyby, stav se nezmění a na bus nedorazí nic. */
function expectRejected(game: Game, action: Action, code: ActionErrorCode): void {
  const before = JSON.stringify(game.state);
  const { got, off } = listen(game);
  const res = game.dispatch(action);
  off();
  expect(res).toEqual({ ok: false, error: code });
  expect(JSON.stringify(game.state)).toBe(before);
  expect(got).toEqual([]);
}

/** Vyhraje běžící kolo jednou kartou (cíl 1). */
function winRound(game: Game): GameEvent[] {
  winNextHand(game);
  return ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
}

/** Z výběru útraty: vybrat, vyhrát, vyplatit → Večerka. */
function clearBlind(game: Game): void {
  ok(game.dispatch({ type: 'selectBlind' }));
  winRound(game);
  ok(game.dispatch({ type: 'cashOut' }));
}

/** Vyhraje Malou útratu a vrátí rozpis odměn. */
function rewardsOfWin(game: Game): RoundRewards {
  if (game.state.phase === 'blind_select') ok(game.dispatch({ type: 'selectBlind' }));
  winRound(game);
  expect(game.state.phase).toBe('round_end');
  return game.state.rewards!;
}

/** Registr s jediným (bezzubým) šéfem — odměny a průběh bez vedlejších účinků šéfa. */
function calmRegistry(parts: Parameters<typeof makeRegistry>[0] = {}): ContentRegistry {
  const reg = makeRegistry(parts);
  const bosses = Object.values(reg.bosses).filter((b) => parts.bosses?.some((p) => p.id === b.id));
  reg.bosses = Object.fromEntries(
    [boss('calm'), boss('final_boss', { final: true }), ...bosses].map((b) => [b.id, b]),
  );
  return reg;
}

function voucher(id: string, extra: Partial<VoucherDef> = {}): VoucherDef {
  return { id, tier: 1, cost: 10, art: ART, ...extra };
}

function stake(id: string, level: number, extra: Partial<StakeDef> = {}): StakeDef {
  return { id, level, art: ART, ...extra };
}

/** Položky Večerky pro testy (ceny dopočítá `refreshShopPrices`). */
function jokerItem(game: Game, defId: string, edition: string | null = null): ShopItem {
  return { kind: 'joker', joker: newJokerInstance(game._core, defId, edition), price: 0, sold: false };
}

function consumableItem(game: Game, defId: string): ShopItem {
  const def = game.registry.consumables[defId]!;
  return {
    kind: 'consumable',
    consumable: newConsumableInstance(game._core, defId),
    consumableKind: def.kind,
    price: 0,
    sold: false,
  };
}

function cardItem(game: Game): ShopItem {
  const card = createCard(game._core.uid(), { suit: 'H', rank: 14, enhancement: 'bonus' });
  return { kind: 'card', card, price: 0, sold: false };
}

function stock(game: Game, items: ShopItem[]): void {
  const shop = game._core.state.shop!;
  shop.items = items;
  refreshShopPrices(game._core, shop);
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Testovací spotřebky: bez cíle (+10 Kč), s cíli (1–2 karty → Prémiová), nepoužitelná. */
const CONSUMABLES: ConsumableDef[] = [
  consumable('coin', { use: (ctx) => ctx.api.addMoney(10, 'test') }),
  consumable('polish', {
    target: { min: 1, max: 2 },
    use: (ctx) => {
      for (const c of ctx.targets) ctx.api.modifyCard(c.id, { enhancement: 'bonus' });
    },
  }),
  consumable('never', { canUse: () => false }),
];

// ─────────────────────────── Založení runu ───────────────────────────

describe('založení runu', () => {
  it('výběr útraty v patře 1: Malá aktuální, šéf vylosovaný předem, výchozí peníze', () => {
    const game = makeGame();
    const s = game.state;
    expect(s.phase).toBe('blind_select');
    expect(s.ante).toBe(1);
    expect(s.money).toBe(STARTING_MONEY);
    expect(s.round).toBeNull();
    expect(s.blinds.map((b) => [b.kind, b.status])).toEqual([
      ['small', 'current'],
      ['big', 'upcoming'],
      ['boss', 'upcoming'],
    ]);
    const bossId = s.blinds[2]!.bossId!;
    expect(game.registry.bosses[bossId]!.final).not.toBe(true);
    expect(s.bossesSeen).toEqual([bossId]);
    expect(s.blinds[0]!.bossId).toBeNull();
    expect(s.blinds[1]!.bossId).toBeNull();
    expect(s.blinds[2]!.skipTagId).toBeNull();
  });

  it('Malá a Velká mají různé štítky (DESIGN 7), pokud jsou v poolu aspoň dva', () => {
    for (const seed of ['TAGSEED1', 'TAGSEED2', 'TAGSEED3', 'TAGSEED4', 'TAGSEED5', 'TAGSEED6']) {
      const s = makeGame({ seed }).state;
      expect(s.blinds[0]!.skipTagId).not.toBeNull();
      expect(s.blinds[1]!.skipTagId).not.toBeNull();
      expect(s.blinds[0]!.skipTagId).not.toBe(s.blinds[1]!.skipTagId);
    }
  });

  it('jediný štítek v poolu dostanou obě útraty; bez štítků žádný; minAnte se respektuje', () => {
    const one = makeRegistry();
    one.tags = { cash_tag: one.tags.cash_tag!, later: tag('later', {}, { minAnte: 2 }) };
    const s = makeGame({ registry: one }).state;
    expect(s.blinds.map((b) => b.skipTagId)).toEqual(['cash_tag', 'cash_tag', null]);
    const none = makeRegistry();
    none.tags = {};
    expect(makeGame({ registry: none }).state.blinds.map((b) => b.skipTagId)).toEqual([null, null, null]);
  });
});

// ─────────────────────────── Kolo ───────────────────────────

describe('výběr útraty a kolo (DESIGN 2.4.1)', () => {
  it('selectBlind: 4 ruce, 3 zahození, 8 karet, cíl podle křivky; události v pořadí', () => {
    const game = makeGame();
    const { got, off } = listen(game);
    const events = ok(game.dispatch({ type: 'selectBlind' }));
    off();
    expect(types(events)).toEqual(['blindSelected', 'roundStarted', 'cardsDrawn']);
    expect(got).toEqual(events);
    const r = game.state.round!;
    expect(game.state.phase).toBe('round');
    expect(r.blind).toBe('small');
    expect(r.target).toBe(250);
    expect(find(events, 'blindSelected')).toEqual({
      type: 'blindSelected',
      blind: 'small',
      bossId: null,
      target: 250,
    });
    expect([r.handsLeft, r.discardsLeft, r.hand.length, r.drawPile.length]).toEqual([4, 3, 8, 44]);
    expect(game.state.blinds[0]!.status).toBe('current');
  });

  it('Velká má cíl 1,5×, šéf 2× nebo vlastní násobek (BossDef.targetMult)', () => {
    const game = makeGame({ registry: calmRegistry({ bosses: [boss('wall', { targetMult: 4 })] }) });
    ok(game.dispatch({ type: 'skipBlind' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.target).toBe(380);
    const other = makeGame({ registry: calmRegistry({ bosses: [boss('wall', { targetMult: 4 })] }) });
    selectBoss(other, 'calm');
    expect(other.state.round!.target).toBe(500);
    const wall = makeGame({ registry: calmRegistry({ bosses: [boss('wall', { targetMult: 4 })] }) });
    selectBoss(wall, 'wall');
    expect(wall.state.round!.target).toBe(1000);
    expect(wall.blindTarget('boss', 'wall')).toBe(1000);
  });

  it('akce mimo svou fázi se odmítnou', () => {
    const game = makeGame();
    expectRejected(game, { type: 'play', cardIds: [1] }, 'wrongPhase');
    expectRejected(game, { type: 'discard', cardIds: [1] }, 'wrongPhase');
    expectRejected(game, { type: 'cashOut' }, 'wrongPhase');
    expectRejected(game, { type: 'reroll' }, 'wrongPhase');
    expectRejected(game, { type: 'leaveShop' }, 'wrongPhase');
    expectRejected(game, { type: 'buy', slot: 0 }, 'wrongPhase');
    expectRejected(game, { type: 'pickBooster', index: 0 }, 'wrongPhase');
    expectRejected(game, { type: 'skipBooster' }, 'wrongPhase');
    expectRejected(game, { type: 'continueEndless' }, 'wrongPhase');
    expectRejected(game, { type: 'reorderHand', cardIds: [] }, 'wrongPhase');
    expectRejected(game, { type: 'sortHand', by: 'rank' }, 'wrongPhase');
    ok(game.dispatch({ type: 'selectBlind' }));
    expectRejected(game, { type: 'selectBlind' }, 'wrongPhase');
    expectRejected(game, { type: 'skipBlind' }, 'wrongPhase');
    expectRejected(game, { type: 'rerollBoss' }, 'wrongPhase');
  });

  it('neznámá akce se odmítne a nic nezmění', () => {
    const game = makeGame({ round: true });
    expectRejected(game, { type: 'dance' } as unknown as Action, 'wrongPhase');
  });

  describe('validace výběru karet (zahrát i zahodit)', () => {
    for (const type of ['play', 'discard'] as const) {
      it(`${type}: prázdný, nad maxSelect, duplicitní, mimo ruku, neznámé id, ne pole`, () => {
        const game = makeGame({ round: true });
        const r = game.state.round!;
        const hand = r.hand;
        expectRejected(game, { type, cardIds: [] }, 'invalidSelection');
        expectRejected(game, { type, cardIds: hand.slice(0, 6) }, 'invalidSelection');
        expectRejected(game, { type, cardIds: [hand[0]!, hand[0]!] }, 'invalidSelection');
        expectRejected(game, { type, cardIds: [r.drawPile[0]!] }, 'invalidSelection');
        expectRejected(game, { type, cardIds: [99999] }, 'invalidSelection');
        expectRejected(game, { type, cardIds: 'abc' as unknown as number[] }, 'invalidSelection');
        expectRejected(game, { type } as unknown as Action, 'invalidSelection');
      });
    }

    it('maxSelect z modifikátorů (passive žolíka) mění limit', () => {
      const reg = makeRegistry({
        jokers: [joker('studio', { hooks: { passive: () => ({ maxSelect: -1 }) } })],
      });
      const game = makeGame({ registry: reg, jokers: ['studio'], round: true });
      const hand = game.state.round!.hand;
      expectRejected(game, { type: 'play', cardIds: hand.slice(0, 5) }, 'invalidSelection');
      ok(game.dispatch({ type: 'play', cardIds: hand.slice(0, 4) }));
    });

    it('bez rukou nejde hrát, bez zahození zahazovat', () => {
      const game = makeGame({ round: true });
      game._core.state.round!.discardsLeft = 0;
      expectRejected(
        game,
        { type: 'discard', cardIds: game.state.round!.hand.slice(0, 1) },
        'noDiscardsLeft',
      );
      game._core.state.round!.handsLeft = 0;
      expectRejected(game, { type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }, 'noHandsLeft');
    });
  });

  it('zahrání: karty z ruky na odhazovací hromádku, dobrání do 8, skóre a statistiky', () => {
    const game = makeGame({ round: true });
    const cards = setupRound(game, 'KH KS 2C 3D 4H 7S 8S 9C');
    const before = game.state.round!.drawPile.length;
    const { result, events } = play(game, cards.slice(0, 2));
    const r = game.state.round!;
    expect(types(events)).toEqual(['handPlayed', 'cardsDrawn']);
    expect(result.hand.type).toBe('pair');
    expect(r.hand).not.toContain(cards[0]!.id);
    expect(r.discardPile).toEqual([cards[0]!.id, cards[1]!.id]);
    expect(r.playedPile).toEqual([]);
    expect(r.hand).toHaveLength(8);
    expect(r.drawPile).toHaveLength(before - 2);
    expect([r.handsLeft, r.handsPlayed, r.score]).toEqual([3, 1, result.score]);
    expect(r.handTypesPlayed).toEqual(['pair']);
    expect(find(events, 'handPlayed')!.roundScore).toBe(result.score);
    const st = game.state.stats;
    expect([st.handsPlayed, st.cardsPlayed, st.handTypeCounts.pair, st.bestHandType]).toEqual([
      1,
      2,
      1,
      'pair',
    ]);
    expect(st.bestHandScore).toBe(result.score);
    expect(game.state.handLevels.pair.played).toBe(1);
  });

  it('zahození: karty na hromádku, dobrání, zahození se spotřebuje; události v pořadí', () => {
    const game = makeGame({ round: true, jokers: ['discard_cash'] });
    const ids = game.state.round!.hand.slice(0, 3);
    const events = ok(game.dispatch({ type: 'discard', cardIds: ids }));
    expect(types(events)).toEqual(['cardsDiscarded', 'moneyChanged', 'cardsDrawn']);
    expect(find(events, 'cardsDiscarded')).toEqual({ type: 'cardsDiscarded', cardIds: ids });
    const r = game.state.round!;
    expect(r.discardPile).toEqual(ids);
    expect(r.hand).toHaveLength(8);
    expect([r.discardsLeft, r.discardsUsed, r.handsLeft]).toEqual([2, 1, 4]);
    expect([game.state.stats.discardsUsed, game.state.stats.cardsDiscarded]).toEqual([1, 3]);
    expect(game.state.money).toBe(STARTING_MONEY + 1);
  });

  it('dosažení cíle kolo hned ukončí (bez dobírání); zbylé ruce jsou nevyužité', () => {
    const game = makeGame({ round: true });
    const events = winRound(game);
    expect(types(events)).toEqual(['handPlayed', 'roundWon', 'roundRewards']);
    expect(game.state.phase).toBe('round_end');
    expect(find(events, 'roundWon')).toMatchObject({ ante: 1, blind: 'small', target: 1 });
    expect(game.state.blinds[0]!.status).toBe('defeated');
    expect(game.state.stats.roundsWon).toBe(1);
    expect(game.state.rewards!.unusedHands).toBe(3);
  });

  it('dojdou ruce pod cílem → konec runu s příčinou pro pitvu (útrata)', () => {
    const game = makeGame({ round: true });
    game._core.state.round!.handsLeft = 1;
    game._core.state.round!.target = 1e12;
    const events = ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(game.state.phase).toBe('game_over');
    const info = game.state.gameOver!;
    expect(info).toMatchObject({ cause: 'small', ante: 1, blind: 'small', target: 1e12 });
    expect(info.score).toBe(game.state.round!.score);
    expect(types(events)).toEqual(['handPlayed', 'gameOver']);
    expect(find(events, 'gameOver')!.info).toEqual(info);
  });

  it('prohra u šéfa (i Velké s pravidlem šéfa) má jako příčinu id šéfa', () => {
    const game = makeGame({ registry: calmRegistry() });
    selectBoss(game, 'calm');
    game._core.state.round!.handsLeft = 1;
    game._core.state.round!.target = 1e12;
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(game.state.gameOver).toMatchObject({ cause: 'calm', blind: 'boss' });
  });

  it('po konci runu se odmítne každá akce (i přeřazení a prodej)', () => {
    const game = makeGame({ round: true, jokers: ['noop'] });
    game._core.api.createConsumable({ defId: 'rada_a' });
    game._core.state.round!.handsLeft = 1;
    game._core.state.round!.target = 1e12;
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }));
    const uid = game.state.jokers[0]!.uid;
    const actions: Action[] = [
      { type: 'selectBlind' },
      { type: 'play', cardIds: game.state.round!.hand.slice(0, 1) },
      { type: 'discard', cardIds: game.state.round!.hand.slice(0, 1) },
      { type: 'cashOut' },
      { type: 'continueEndless' },
      { type: 'sellJoker', uid },
      { type: 'sellConsumable', uid: game.state.consumables[0]!.uid },
      { type: 'useConsumable', uid: game.state.consumables[0]!.uid },
      { type: 'reorderJokers', uids: [uid] },
      { type: 'reorderHand', cardIds: [...game.state.round!.hand] },
      { type: 'sortHand', by: 'suit' },
    ];
    for (const a of actions) expectRejected(game, a, 'wrongPhase');
  });
});

// ─────────────────────────── Rozpis odměn ───────────────────────────

describe('rozpis odměn (DESIGN 2.4.2)', () => {
  it('Malá v první ruce: 3 Kč + 3 nevyužité ruce + úrok 1 z 5 Kč = 7 Kč', () => {
    const game = makeGame({ round: true });
    const events = winRound(game);
    const rewards = game.state.rewards!;
    expect(rewards).toEqual({
      blindReward: BLIND_REWARDS.small,
      unusedHands: 3,
      unusedDiscards: 0,
      interest: 1,
      extra: [],
      total: 7,
    });
    expect(find(events, 'roundRewards')).toEqual({ type: 'roundRewards', ...rewards });
  });

  it('Velká 4 Kč, šéf 5 Kč nebo vlastní BossDef.reward', () => {
    const reg = calmRegistry({ bosses: [boss('rich', { reward: 8 })] });
    const big = makeGame({ registry: reg, money: 0 });
    ok(big.dispatch({ type: 'skipBlind' }));
    expect(rewardsOfWin(big).blindReward).toBe(BLIND_REWARDS.big);
    const calm = makeGame({ registry: reg, money: 0 });
    selectBoss(calm, 'calm');
    expect(rewardsOfWin(calm).blindReward).toBe(BLIND_REWARDS.boss);
    const rich = makeGame({ registry: reg, money: 0 });
    selectBoss(rich, 'rich');
    expect(rewardsOfWin(rich).blindReward).toBe(8);
  });

  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [9, 1],
    [24, 4],
    [25, 5],
    [100, 5],
  ])('úrok z %i Kč = %i Kč (1 Kč za každých 5 Kč, strop 5)', (money, interest) => {
    const game = makeGame({ round: true, money });
    expect(rewardsOfWin(game).interest).toBe(interest);
  });

  it('úrok se počítá ze zůstatku před výplatou této odměny (ne po ní)', () => {
    const game = makeGame({ round: true, money: 9 });
    const rewards = rewardsOfWin(game);
    expect(rewards.interest).toBe(1);
    ok(game.dispatch({ type: 'cashOut' }));
    expect(game.state.money).toBe(9 + rewards.total);
  });

  it('úrok ze zůstatku v okamžiku výhry — peníze z hooků konce kola (štítek, žolík) se nepočítají', () => {
    const reg = makeRegistry({
      tags: [
        tag('payday', {
          onRoundEnd: (ctx) => {
            ctx.api.addMoney(20, 'tag');
            return true;
          },
        }),
      ],
      jokers: [joker('tipper', { hooks: { onRoundEnd: (ctx) => ctx.api.addMoney(20, 'joker') } })],
    });
    const game = makeGame({ registry: reg, round: true, money: 4, jokers: ['tipper'] });
    game._core.api.addTag('payday');
    const rewards = rewardsOfWin(game);
    expect(game.state.money).toBe(44);
    expect(rewards.interest).toBe(0);
  });

  it('ze záporného zůstatku není úrok ani penále', () => {
    const reg = makeRegistry({ decks: [{ id: 'debtor', passive: () => ({ debtLimit: 20 }), art: ART }] });
    const game = makeGame({ registry: reg, deckId: 'debtor', round: true, money: -7 });
    const rewards = rewardsOfWin(game);
    expect(rewards.interest).toBe(0);
    expect(rewards.total).toBe(6);
  });

  it('modifikátory: interestStep/Cap/Mult, blindRewardMult, peníze za nevyužité ruce a zahození', () => {
    const reg = makeRegistry({
      decks: [
        {
          id: 'banker',
          // Delty: čísla se sčítají, `*Mult` násobí → krok 10, strop 3, ×2.
          passive: () => ({
            interestStep: 5,
            interestCap: -2,
            interestMult: 2,
            blindRewardMult: 1.5,
            moneyPerUnusedHand: 1,
            moneyPerUnusedDiscard: 1,
          }),
          art: ART,
        },
      ],
    });
    const game = makeGame({ registry: reg, deckId: 'banker', round: true, money: 100 });
    const rewards = rewardsOfWin(game);
    expect(rewards).toMatchObject({
      blindReward: 4, // floor(3 × 1,5)
      unusedHands: 6, // 3 ruce × 2 Kč
      unusedDiscards: 3,
      interest: 6, // min(3, floor(100 / 10)) × 2
    });
    expect(rewards.total).toBe(19);
  });

  it('položky se zaokrouhlují dolů na celé koruny (i neceločíselné sazby)', () => {
    const reg = makeRegistry({
      decks: [
        {
          id: 'halves',
          passive: () => ({ moneyPerUnusedHand: -0.5, moneyPerUnusedDiscard: 0.5, interestMult: 0.5 }),
          art: ART,
          roundEndMoney: () => 2.7,
        },
      ],
      jokers: [joker('fraction', { hooks: { roundEndMoney: () => 1.5 } })],
    });
    const game = makeGame({ registry: reg, deckId: 'halves', round: true, money: 15, jokers: ['fraction'] });
    const rewards = rewardsOfWin(game);
    expect(rewards.unusedHands).toBe(1); // floor(3 × 0,5)
    expect(rewards.unusedDiscards).toBe(1); // floor(3 × 0,5)
    expect(rewards.interest).toBe(1); // floor(3 × 0,5)
    expect(rewards.extra.map((e) => e.amount)).toEqual([1, 2]);
    expect(Number.isInteger(rewards.total)).toBe(true);
  });

  it('bonusy v pořadí: zlaté karty v ruce → žolíci → balíček → zapůjčení žolíci (−2 Kč)', () => {
    const reg = makeRegistry({ decks: [{ id: 'bonus_deck', roundEndMoney: () => 1, art: ART }] });
    const game = makeGame({ registry: reg, deckId: 'bonus_deck', money: 0, round: true });
    const [rental] = addJokers(game, [{ id: 'noop', stickers: ['rental'] }]);
    const [cash] = addJokers(game, ['round_cash']);
    const cards = setupRound(game, 'AS 2C:gold 3D:gold 4H');
    winNextHand(game);
    play(game, [cards[0]!]);
    const rewards = game.state.rewards!;
    expect(rewards.extra).toEqual([
      { source: 'held', amount: 6 },
      { source: 'joker:round_cash', amount: 2, jokerUid: cash!.uid },
      { source: 'deck:bonus_deck', amount: 1 },
      { source: 'rental:noop', amount: -RENTAL_FEE, jokerUid: rental!.uid },
    ]);
    expect(rewards.total).toBe(3 + 3 + 6 + 2 + 1 - RENTAL_FEE);
  });

  it('debuffnutá zlatá karta ani debuffnutý žolík nic nedají', () => {
    const reg = calmRegistry({
      bosses: [boss('heart_ban', { hooks: { isCardDebuffed: (ctx, c) => ctx.api.hasSuit(c, 'H') } })],
    });
    const game = makeGame({ registry: reg, money: 0 });
    addJokers(game, [{ id: 'round_cash', debuffed: true }]);
    selectBoss(game, 'heart_ban');
    const cards = setupRound(game, 'AS 2H:gold 3C:gold');
    winNextHand(game);
    play(game, [cards[0]!]);
    expect(game.state.rewards!.extra).toEqual([{ source: 'held', amount: 3 }]);
  });

  it('Ležák (moneyPerUnusedHand −1, DESIGN 10): nevyužité ruce nedávají peníze; nižší síla piva ano', () => {
    const stakes = [stake('tenner', 1), stake('eleven', 2, { passive: () => ({ shopPriceAdd: 1 }) })];
    stakes.push(stake('lezak', 5, { passive: () => ({ moneyPerUnusedHand: -1 }) }));
    const reg = makeRegistry({ stakes });
    const lezak = makeGame({ registry: reg, stake: 5, round: true });
    expect(rewardsOfWin(lezak).unusedHands).toBe(0);
    const eleven = makeGame({ registry: reg, stake: 2, round: true });
    expect(rewardsOfWin(eleven).unusedHands).toBe(3);
  });

  it('StakeDef.noSmallBlindReward: Malá útrata bez odměny, Velká ano', () => {
    const reg = makeRegistry({
      stakes: [stake('tenner', 1), stake('stingy', 2, { noSmallBlindReward: true })],
    });
    const game = makeGame({ registry: reg, stake: 2, round: true });
    expect(rewardsOfWin(game).blindReward).toBe(0);
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'leaveShop' }));
    expect(rewardsOfWin(game).blindReward).toBe(BLIND_REWARDS.big);
  });
});

// ─────────────────────────── Výplata ───────────────────────────

describe('výplata (cashOut) a další útrata', () => {
  it('vyplatí přesně total, vstoupí do Večerky a posune útratu', () => {
    const game = makeGame({ round: true });
    const total = rewardsOfWin(game).total;
    const before = game.state.money;
    const events = ok(game.dispatch({ type: 'cashOut' }));
    expect(types(events)).toEqual(['moneyChanged', 'cashedOut', 'shopEntered']);
    expect(find(events, 'moneyChanged')).toMatchObject({ delta: total, reason: 'roundReward' });
    expect(find(events, 'cashedOut')).toEqual({ type: 'cashedOut', amount: total });
    const s = game.state;
    expect(s.money).toBe(before + total);
    expect([s.phase, s.round, s.rewards, s.blindIndex]).toEqual(['shop', null, null, 1]);
    expect(s.blinds.map((b) => b.status)).toEqual(['defeated', 'current', 'upcoming']);
    expect(s.stats.shopsEntered).toBe(1);
    expect(s.stats.moneyEarned).toBeGreaterThanOrEqual(total);
  });

  it('nulová odměna nepošle moneyChanged', () => {
    const reg = makeRegistry({
      stakes: [stake('tenner', 1), stake('stingy', 2, { noSmallBlindReward: true })],
    });
    const game = makeGame({ registry: reg, stake: 2, money: 0, round: true });
    game._core.state.round!.handsLeft = 1;
    rewardsOfWin(game);
    expect(game.state.rewards!.total).toBe(0);
    const events = ok(game.dispatch({ type: 'cashOut' }));
    expect(types(events)).toEqual(['cashedOut', 'shopEntered']);
  });

  it('leaveShop → výběr útraty; Velká pak běží jako další kolo', () => {
    const game = makeGame();
    clearBlind(game);
    const events = ok(game.dispatch({ type: 'leaveShop' }));
    expect(types(events)).toEqual(['shopLeft']);
    expect(game.state.phase).toBe('blind_select');
    expect(game.state.shop).toBeNull();
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.blind).toBe('big');
    expect(game.state.round!.target).toBe(380);
  });

  it('v každém kole se balíček zamíchá znovu a zahrané karty se vrátí', () => {
    const game = makeGame();
    clearBlind(game);
    ok(game.dispatch({ type: 'leaveShop' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    const r = game.state.round!;
    expect(r.hand.length + r.drawPile.length).toBe(game.state.deck.length);
    expect(r.discardPile).toEqual([]);
    expect(game.state.deck.every((c) => !c.debuffed && !c.faceDown)).toBe(true);
  });
});

// ─────────────────────────── Večerka ───────────────────────────

describe('Večerka (DESIGN 2.5)', () => {
  const reg = (): ContentRegistry =>
    makeRegistry({
      consumables: CONSUMABLES,
      vouchers: [
        voucher('coupon', { passive: () => ({ shopDiscountPct: 50 }) }),
        voucher('coupon_plus', { tier: 2, requires: 'coupon' }),
      ],
      jokers: [joker('shop_watcher', { hooks: { onShopEnter: (ctx) => ctx.api.addMoney(1, 'joker') } })],
    });

  function shopGame(money = 100, registry = reg()): Game {
    const game = makeGame({ registry, money });
    clearBlind(game);
    game._core.state.money = money;
    return game;
  }

  it('nabídka: 2 kartové sloty, 2 obálky (první Večerka: Žolíková obálka), kupón patra, přehození 4 Kč', () => {
    const game = shopGame();
    const shop = game.state.shop!;
    expect(shop.items).toHaveLength(2);
    expect(shop.boosters).toHaveLength(2);
    expect(shop.boosters[0]!.boosterId).toBe('joker_pack');
    expect(shop.vouchers.map((v) => v.voucherId)).toEqual(['coupon']);
    expect(game.state.anteVouchers).toEqual(['coupon']);
    expect([shop.rerollCost, shop.paidRerolls, shop.freeRerolls]).toEqual([4, 0, 0]);
  });

  it('onShopEnter žolíka se zavolá po vygenerování nabídky', () => {
    const game = makeGame({ registry: reg(), jokers: ['shop_watcher'], round: true });
    winRound(game);
    const events = ok(game.dispatch({ type: 'cashOut' }));
    expect(types(events).slice(-2)).toEqual(['moneyChanged', 'shopEntered']);
  });

  it('koupě žolíka: zaplatí, přidá, označí prodané; události v pořadí', () => {
    const game = shopGame();
    stock(game, [jokerItem(game, 'noop'), jokerItem(game, 'rare_one')]);
    const events = ok(game.dispatch({ type: 'buy', slot: 1 }));
    expect(types(events)).toEqual(['moneyChanged', 'jokerAdded', 'itemBought']);
    expect(find(events, 'itemBought')).toEqual({
      type: 'itemBought',
      kind: 'joker',
      defId: 'rare_one',
      price: 6,
    });
    expect(game.state.money).toBe(94);
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['rare_one']);
    expect(game.state.shop!.items[1]!.sold).toBe(true);
    expect([game.state.stats.jokersBought, game.state.stats.moneySpent]).toEqual([1, 6]);
    expectRejected(game, { type: 'buy', slot: 1 }, 'soldOut');
    expectRejected(game, { type: 'buy', slot: 7 }, 'unknownItem');
    expectRejected(game, { type: 'buyAndUse', slot: 0 }, 'cannotUse');
  });

  it('koupený žolík i spotřebka jsou samostatné objekty — prodaný slot s nimi nesdílí stav (živý = uložený)', () => {
    const game = shopGame();
    stock(game, [jokerItem(game, 'noop'), consumableItem(game, 'coin')]);
    ok(game.dispatch({ type: 'buy', slot: 0 }));
    ok(game.dispatch({ type: 'buy', slot: 1 }));
    const s = game._core.state;
    const [soldJoker, soldConsumable] = s.shop!.items;
    if (soldJoker?.kind !== 'joker' || soldConsumable?.kind !== 'consumable') throw new Error('nabídka');
    expect(soldJoker.joker).not.toBe(s.jokers[0]);
    expect(soldJoker.joker).toEqual(s.jokers[0]);
    expect(soldConsumable.consumable).not.toBe(s.consumables[0]);
    // Změna stavu žolíka v řadě se do prodaného slotu nepropíše (po uložení a načtení by se jinak lišil).
    s.jokers[0]!.state.mult = 2;
    expect(soldJoker.joker.state.mult).toBeUndefined();
  });

  it('bez peněz nebo bez volného slotu se nekoupí nic; dluhový limit nákup povolí', () => {
    const game = shopGame(3);
    stock(game, [jokerItem(game, 'noop'), jokerItem(game, 'noop', 'negative')]);
    expectRejected(game, { type: 'buy', slot: 0 }, 'notEnoughMoney');
    game._core.state.money = 100;
    addJokers(game, ['noop', 'noop', 'noop', 'noop', 'noop']);
    expectRejected(game, { type: 'buy', slot: 0 }, 'slotsFull');
    // Negativní edice si slot přinese sama.
    ok(game.dispatch({ type: 'buy', slot: 1 }));
    expect(game.state.jokers).toHaveLength(6);

    const debtReg = reg();
    debtReg.decks.debtor = { id: 'debtor', passive: () => ({ debtLimit: 5 }), art: ART };
    const debtor = makeGame({ registry: debtReg, deckId: 'debtor' });
    clearBlind(debtor);
    debtor._core.state.money = 0;
    stock(debtor, [jokerItem(debtor, 'noop'), jokerItem(debtor, 'rare_one')]);
    ok(debtor.dispatch({ type: 'buy', slot: 0 }));
    expect(debtor.state.money).toBe(-4);
    expectRejected(debtor, { type: 'buy', slot: 1 }, 'notEnoughMoney');
  });

  it('spotřebka do slotu; plné sloty → slotsFull; buyAndUse bez cíle se rovnou použije', () => {
    const game = shopGame();
    stock(game, [consumableItem(game, 'coin'), consumableItem(game, 'coin')]);
    ok(game.dispatch({ type: 'buy', slot: 0 }));
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['coin']);
    expect(game.state.money).toBe(96);
    game._core.api.createConsumable({ defId: 'rada_a' });
    expectRejected(game, { type: 'buy', slot: 1 }, 'slotsFull');
    const events = ok(game.dispatch({ type: 'buyAndUse', slot: 1 }));
    expect(types(events)).toEqual(['moneyChanged', 'itemBought', 'moneyChanged', 'consumableUsed']);
    expect(game.state.money).toBe(96 - 4 + 10);
    expect([game.state.stats.consumablesUsed, game.state.lastConsumable]).toEqual([1, 'coin']);
    expect(game.state.consumables).toHaveLength(2);
  });

  it('buyAndUse spotřebky s cíli nebo nepoužitelné nejde (ve Večerce není ruka)', () => {
    const game = shopGame();
    stock(game, [consumableItem(game, 'polish'), consumableItem(game, 'never')]);
    expectRejected(game, { type: 'buyAndUse', slot: 0 }, 'cannotUse');
    expectRejected(game, { type: 'buyAndUse', slot: 0, targetIds: [1] }, 'cannotUse');
    expectRejected(game, { type: 'buyAndUse', slot: 1 }, 'cannotUse');
  });

  it('hrací karta jde do balíčku (cardAdded se zdrojem shop); použít ji nejde', () => {
    const game = shopGame();
    stock(game, [cardItem(game)]);
    expect(game.state.shop!.items[0]!.price).toBe(3);
    expectRejected(game, { type: 'buyAndUse', slot: 0 }, 'cannotUse');
    const size = game.state.deck.length;
    const events = ok(game.dispatch({ type: 'buy', slot: 0 }));
    expect(find(events, 'cardAdded')).toMatchObject({ source: 'shop' });
    expect(find(events, 'itemBought')).toMatchObject({ kind: 'card', defId: '14H', price: 3 });
    expect(game.state.deck).toHaveLength(size + 1);
    expect(game.state.deck[size]).toMatchObject({ rank: 14, suit: 'H', enhancement: 'bonus' });
  });

  it('obálka: zaplatit → otevřít (returnTo shop) → vybrat → zpět do Večerky', () => {
    const game = shopGame();
    const events = ok(game.dispatch({ type: 'buyBooster', slot: 0 }));
    expect(types(events)).toEqual(['moneyChanged', 'itemBought', 'boosterOpened']);
    expect(game.state.phase).toBe('booster');
    expect(game.state.booster).toMatchObject({ boosterId: 'joker_pack', picksLeft: 1, returnTo: 'shop' });
    expect(game.state.shop!.boosters[0]!.sold).toBe(true);
    const picked = ok(game.dispatch({ type: 'pickBooster', index: 0 }));
    expect(types(picked)).toEqual(['jokerAdded', 'boosterPicked', 'boosterClosed']);
    expect(find(picked, 'boosterClosed')).toEqual({
      type: 'boosterClosed',
      boosterId: 'joker_pack',
      skipped: false,
    });
    expect(game.state.phase).toBe('shop');
    expect(game.state.booster).toBeNull();
    expectRejected(game, { type: 'buyBooster', slot: 0 }, 'soldOut');
    expectRejected(game, { type: 'buyBooster', slot: 5 }, 'unknownItem');
  });

  it('kupón: sleva platí hned (ceny se přepočítají), drží se do konce patra, další patro nabídne tier 2', () => {
    const game = shopGame();
    stock(game, [jokerItem(game, 'noop')]);
    expect(game.state.shop!.items[0]!.price).toBe(4);
    const events = ok(game.dispatch({ type: 'buyVoucher', slot: 0 }));
    expect(types(events)).toEqual(['moneyChanged', 'itemBought', 'voucherRedeemed']);
    expect(game.state.money).toBe(90);
    expect(game.state.vouchers).toEqual(['coupon']);
    expect(game.state.anteVouchers).toEqual([]);
    expect(game.state.shop!.items[0]!.price).toBe(2);
    expect(game.state.shop!.rerollCost).toBe(4); // přehození sleva nezlevňuje
    expectRejected(game, { type: 'buyVoucher', slot: 0 }, 'soldOut');
    expectRejected(game, { type: 'buyVoucher', slot: 3 }, 'unknownItem');
    // Další Večerka téhož patra už kupón nenabízí.
    ok(game.dispatch({ type: 'leaveShop' }));
    clearBlind(game);
    expect(game.state.shop!.vouchers).toEqual([]);
    // Po porážce šéfa nové patro → nový kupón (tier 2 až s vlastněným tier 1).
    ok(game.dispatch({ type: 'leaveShop' }));
    game._core.state.blinds[2]!.bossId = 'wall';
    clearBlind(game);
    expect(game.state.ante).toBe(2);
    expect(game.state.anteVouchers).toEqual(['coupon_plus']);
    expect(game.state.shop!.vouchers.map((v) => v.voucherId)).toEqual(['coupon_plus']);
  });

  it('přehození: 4 Kč, pak 5 Kč…; nová nabídka karet, obálky zůstávají; událost nese zaplacenou cenu', () => {
    const game = shopGame(20);
    const boosters = JSON.stringify(game.state.shop!.boosters);
    const first = ok(game.dispatch({ type: 'reroll' }));
    expect(find(first, 'shopRerolled')).toEqual({ type: 'shopRerolled', cost: 4 });
    expect(game.state.money).toBe(16);
    const second = ok(game.dispatch({ type: 'reroll' }));
    expect(find(second, 'shopRerolled')).toEqual({ type: 'shopRerolled', cost: 5 });
    expect(game.state.money).toBe(11);
    const shop = game.state.shop!;
    expect([shop.rerollCost, shop.paidRerolls, shop.rerollsThisShop]).toEqual([6, 2, 2]);
    expect(shop.items).toHaveLength(2);
    expect(JSON.stringify(shop.boosters)).toBe(boosters);
    expect(game.state.stats.rerolls).toBe(2);
    game._core.state.money = 5;
    expectRejected(game, { type: 'reroll' }, 'notEnoughMoney');
    // Nová Večerka začíná od základu.
    ok(game.dispatch({ type: 'leaveShop' }));
    clearBlind(game);
    expect(game.state.shop!.rerollCost).toBe(4);
  });

  it('bezplatná přehození (štítek přes flags.freeRerolls) jdou první, pak se platí od základu', () => {
    const game = makeGame({ registry: reg(), money: 50 });
    game._core.state.flags.freeRerolls = 2;
    clearBlind(game);
    game._core.state.money = 50;
    expect(game.state.flags.freeRerolls).toBe(0);
    expect([game.state.shop!.freeRerolls, game.state.shop!.rerollCost]).toEqual([2, 0]);
    expect(find(ok(game.dispatch({ type: 'reroll' })), 'shopRerolled')!.cost).toBe(0);
    expect(game.state.shop!.rerollCost).toBe(0);
    ok(game.dispatch({ type: 'reroll' }));
    expect(game.state.money).toBe(50);
    expect(game.state.shop!.rerollCost).toBe(4);
    expect(find(ok(game.dispatch({ type: 'reroll' })), 'shopRerolled')!.cost).toBe(4);
    expect(game.state.money).toBe(46);
  });

  it('Jedenáctka (shopPriceAdd +1): všechno o 1 Kč dražší včetně přehození; prodej se nemění', () => {
    const registry = reg();
    registry.stakes = {
      tenner: stake('tenner', 1),
      eleven: stake('eleven', 2, { passive: () => ({ shopPriceAdd: 1 }) }),
    };
    const game = makeGame({ registry, stake: 2 });
    clearBlind(game);
    stock(game, [jokerItem(game, 'noop'), consumableItem(game, 'coin')]);
    const shop = game.state.shop!;
    expect(shop.items.map((i) => i.price)).toEqual([5, 5]);
    expect(shop.boosters[0]!.price).toBe(5);
    expect(shop.vouchers[0]!.price).toBe(11);
    expect(shop.rerollCost).toBe(5);
    const [j] = addJokers(game, ['noop']);
    expect(game.sellValue(j!.uid)).toBe(2);
  });
});

// ─────────────────────────── Přeskočení útraty ───────────────────────────

describe('přeskočení útraty (DESIGN 7)', () => {
  it('Malá: štítek, žádná odměna ani Večerka, Velká je na řadě', () => {
    const reg = makeRegistry({
      jokers: [
        joker('skip_fan', {
          initState: () => ({ skips: 0 }),
          hooks: { onSkipBlind: (ctx) => void (ctx.self.state.skips = num(ctx.self.state.skips) + 1) },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['skip_fan'] });
    game._core.state.blinds[0]!.skipTagId = 'cash_tag';
    const events = ok(game.dispatch({ type: 'skipBlind' }));
    expect(types(events)).toEqual(['blindSkipped', 'tagAdded', 'moneyChanged', 'tagTriggered']);
    expect(find(events, 'blindSkipped')).toEqual({ type: 'blindSkipped', blind: 'small', tagId: 'cash_tag' });
    const s = game.state;
    expect(s.phase).toBe('blind_select');
    expect(s.money).toBe(STARTING_MONEY + 5);
    expect(s.blinds.map((b) => b.status)).toEqual(['skipped', 'current', 'upcoming']);
    expect([s.blindIndex, s.stats.blindsSkipped, s.stats.shopsEntered]).toEqual([1, 1, 0]);
    expect(s.rewards).toBeNull();
    expect(s.jokers[0]!.state.skips).toBe(1);
  });

  it('nespotřebovaný štítek zůstává ve frontě; šéfa přeskočit nejde', () => {
    const game = makeGame();
    game._core.state.blinds[0]!.skipTagId = 'lazy_tag';
    game._core.state.blinds[1]!.skipTagId = 'sick_note';
    ok(game.dispatch({ type: 'skipBlind' }));
    ok(game.dispatch({ type: 'skipBlind' }));
    expect(game.state.tags.map((t) => t.defId)).toEqual(['lazy_tag', 'sick_note']);
    expect(game.state.blinds[2]!.status).toBe('current');
    expectRejected(game, { type: 'skipBlind' }, 'cannotSkip');
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.blind).toBe('boss');
    expect(game.state.round!.bossId).toBe(game.state.blinds[2]!.bossId);
  });

  it('štítek s onRoundStart (+1 ruka) se spotřebuje v příštím kole', () => {
    const game = makeGame();
    game._core.state.blinds[0]!.skipTagId = 'extra_hand';
    ok(game.dispatch({ type: 'skipBlind' }));
    const events = ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.handsLeft).toBe(5);
    expect(game.state.tags).toEqual([]);
    expect(types(events)).toContain('tagTriggered');
  });
});

// ─────────────────────────── Přelosování šéfa ───────────────────────────

describe('přelosování šéfa (rerollBoss)', () => {
  it('bez povolení (flags.bossRerolls) nejde', () => {
    expectRejected(makeGame(), { type: 'rerollBoss' }, 'cannotUse');
  });

  it('s povolením přelosuje jiného šéfa a ubere pokus; po vyčerpání nejde', () => {
    const game = makeGame();
    game._core.state.flags.bossRerolls = 1;
    const before = game.state.blinds[2]!.bossId;
    const events = ok(game.dispatch({ type: 'rerollBoss' }));
    const after = game.state.blinds[2]!.bossId!;
    expect(after).not.toBe(before);
    expect(find(events, 'bossRerolled')).toEqual({ type: 'bossRerolled', bossId: after });
    expect(game.state.flags.bossRerolls).toBe(0);
    expect(game.state.bossesSeen).toEqual([before, after]);
    expectRejected(game, { type: 'rerollBoss' }, 'cannotUse');
  });

  it('neomezené přelosování a cena (flags.bossRerollCost); bez peněz nejde', () => {
    const game = makeGame({ money: 4 });
    game._core.state.flags.bossRerollUnlimited = true;
    game._core.state.flags.bossRerollCost = 2;
    ok(game.dispatch({ type: 'rerollBoss' }));
    ok(game.dispatch({ type: 'rerollBoss' }));
    expect(game.state.money).toBe(0);
    expectRejected(game, { type: 'rerollBoss' }, 'notEnoughMoney');
  });

  it('bez šéfů v registru přelosovat nejde', () => {
    const reg = makeRegistry();
    reg.bosses = {};
    const game = makeGame({ registry: reg });
    game._core.state.flags.bossRerolls = 3;
    expect(game.state.blinds[2]!.bossId).toBeNull();
    expectRejected(game, { type: 'rerollBoss' }, 'cannotUse');
  });
});

// ─────────────────────────── Porážka šéfa ───────────────────────────

describe('porážka šéfa → další patro', () => {
  const reg = (): ContentRegistry =>
    makeRegistry({
      vouchers: [voucher('coupon'), voucher('other')],
      jokers: [
        joker('trophy', {
          initState: () => ({ bosses: [] }),
          hooks: {
            onBossDefeated: (ctx) => {
              ctx.self.state.bosses = [...(ctx.self.state.bosses as string[]), ctx.bossId];
            },
          },
        }),
      ],
    });

  it('bossDefeated, nové patro: anteChanged, nové útraty, nový šéf a kupóny; Večerka', () => {
    const game = makeGame({ registry: reg(), jokers: ['trophy'] });
    const bossId = game.state.blinds[2]!.bossId!;
    ok(game.dispatch({ type: 'skipBlind' }));
    ok(game.dispatch({ type: 'skipBlind' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    const won = winRound(game);
    expect(types(won)).toEqual(expect.arrayContaining(['roundWon', 'bossDefeated', 'roundRewards']));
    expect(find(won, 'bossDefeated')).toEqual({ type: 'bossDefeated', bossId });
    expect(game.state.phase).toBe('round_end');
    expect(game.state.stats.bossesDefeated).toBe(1);
    expect(game.state.jokers[0]!.state.bosses).toEqual([bossId]);
    const vouchersBefore = [...game.state.anteVouchers];
    const events = ok(game.dispatch({ type: 'cashOut' }));
    expect(types(events)).toEqual(['moneyChanged', 'cashedOut', 'anteChanged', 'shopEntered']);
    expect(find(events, 'anteChanged')).toEqual({ type: 'anteChanged', ante: 2 });
    const s = game.state;
    expect(s.ante).toBe(2);
    expect(s.phase).toBe('shop');
    expect(s.blinds.map((b) => b.status)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(s.blindIndex).toBe(0);
    const next = s.blinds[2]!.bossId!;
    expect(next).not.toBe(bossId);
    expect(s.bossesSeen).toEqual([bossId, next]);
    expect(s.anteVouchers).toHaveLength(1);
    expect(vouchersBefore).toHaveLength(1);
    ok(game.dispatch({ type: 'leaveShop' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.target).toBe(blindTarget(2, 'small', 1));
  });

  it('šéfové se neopakují, dokud jsou nevidění; pak se pool obnoví (DESIGN 8.1)', () => {
    const r = makeRegistry();
    r.bosses = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, boss(id)]));
    const game = makeGame({ registry: r });
    const core = game._core;
    core.state.bossesSeen = [];
    const picks = Array.from({ length: 9 }, () => pickBossId(core)!);
    for (let i = 0; i < 9; i += 3) expect([...picks.slice(i, i + 3)].sort()).toEqual(['a', 'b', 'c']);
    expect(core.state.bossesSeen).toHaveLength(3);
  });

  it('finálový šéf jen v patře 8 a každém 8. patře nekonečného režimu', () => {
    const game = makeGame();
    const core = game._core;
    for (const [ante, final] of [
      [1, false],
      [7, false],
      [8, true],
      [9, false],
      [15, false],
      [16, true],
      [24, true],
    ] as const) {
      core.state.ante = ante;
      const id = pickBossId(core)!;
      expect(game.registry.bosses[id]!.final === true, `patro ${ante}`).toBe(final);
    }
  });
});

// ─────────────────────────── Záchrana a prohra ───────────────────────────

describe('záchrana prohraného kola', () => {
  function lastHand(game: Game, score: number): GameEvent[] {
    const round = game._core.state.round!;
    round.handsLeft = 1;
    round.target = 100;
    round.score = score;
    const cards = setupRound(game, '2C');
    return ok(game.dispatch({ type: 'play', cardIds: [cards[0]!.id] }));
  }

  it('štítek onRoundLost: kolo vyhrané bez odměny za útratu, štítek se spotřebuje', () => {
    const game = makeGame({ round: true });
    game._core.api.addTag('sick_note');
    const events = lastHand(game, 60);
    expect(game.state.phase).toBe('round_end');
    expect(game.state.rewards!.blindReward).toBe(0);
    expect(game.state.tags).toEqual([]);
    expect(types(events)).toEqual(
      expect.arrayContaining(['tagTriggered', 'message', 'roundWon', 'roundRewards']),
    );
    expect(find(events, 'message')).toMatchObject({ key: MSG.tagSaved });
  });

  it('žolík preventGameOver: plná odměna; debuffnutý žolík nezachrání', () => {
    const game = makeGame({ round: true, jokers: ['lifeline'] });
    const events = lastHand(game, 30);
    expect(game.state.phase).toBe('round_end');
    expect(game.state.rewards!.blindReward).toBe(BLIND_REWARDS.small);
    expect(find(events, 'jokerTriggered')).toMatchObject({ defId: 'lifeline', message: MSG.jokerSaved });

    const off = makeGame({ round: true, jokers: [{ id: 'lifeline', debuffed: true }] });
    lastHand(off, 30);
    expect(off.state.phase).toBe('game_over');
  });

  it('ani štítek, ani žolík nestačí → konec runu', () => {
    const game = makeGame({ round: true, jokers: ['lifeline'] });
    game._core.api.addTag('sick_note');
    lastHand(game, 10);
    expect(game.state.phase).toBe('game_over');
    expect(game.state.tags.map((t) => t.defId)).toEqual(['sick_note']);
  });
});

// ─────────────────────────── Výhra a nekonečný režim ───────────────────────────

describe('výhra v patře 8 a nekonečný režim (DESIGN 1.2, 1.3)', () => {
  /** Posune run do patra `ante` a vyhraje kolo šéfa (`target` = cíl kola před výhrou). */
  function beatBossAt(game: Game, ante: number): GameEvent[] & { target?: number } {
    game._core.api.changeAnte(ante - game.state.ante);
    const bossId = game.state.blinds[2]!.bossId!;
    selectBoss(game, bossId);
    const target = game.state.round!.target;
    return Object.assign(winRound(game), { target });
  }

  it('šéf patra 7 není výhra', () => {
    const game = makeGame();
    beatBossAt(game, 7);
    expect(game.state.phase).toBe('round_end');
  });

  it('porážka finálového šéfa patra 8 = výhra; pak jen nekonečný režim', () => {
    const game = makeGame();
    const events = beatBossAt(game, FINAL_ANTE);
    expect(game.state.round!.bossId).toBe('final_boss');
    expect(game.state.phase).toBe('victory');
    expect(types(events)).toEqual(['handPlayed', 'roundWon', 'bossDefeated', 'roundRewards', 'victory']);
    expect(find(events, 'victory')).toEqual({ type: 'victory', ante: 8 });
    expect(game.state.rewards).not.toBeNull();
    expectRejected(game, { type: 'cashOut' }, 'wrongPhase');
    expectRejected(game, { type: 'selectBlind' }, 'wrongPhase');
    expectRejected(game, { type: 'leaveShop' }, 'wrongPhase');

    const cont = ok(game.dispatch({ type: 'continueEndless' }));
    expect(types(cont)).toEqual(['endlessStarted']);
    expect([game.state.phase, game.state.endless]).toEqual(['round_end', true]);
    expectRejected(game, { type: 'continueEndless' }, 'wrongPhase');

    const paid = ok(game.dispatch({ type: 'cashOut' }));
    expect(find(paid, 'anteChanged')).toEqual({ type: 'anteChanged', ante: 9 });
    expect(game.state.phase).toBe('shop');
    ok(game.dispatch({ type: 'leaveShop' }));
    expect(game.registry.bosses[game.state.blinds[2]!.bossId!]!.final).not.toBe(true);
    ok(game.dispatch({ type: 'selectBlind' }));
    // Cíle nekonečného režimu (DESIGN 2.3.3): patro 9, křivka 1, Malá 51 000.
    expect(game.state.round!.target).toBe(51_000);
  });

  it('v nekonečném režimu má patro 16 finálového šéfa, ale jeho porážka už není výhra', () => {
    const game = makeGame();
    beatBossAt(game, FINAL_ANTE);
    ok(game.dispatch({ type: 'continueEndless' }));
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'leaveShop' }));
    const events = beatBossAt(game, 16);
    expect(game.state.round!.bossId).toBe('final_boss');
    expect(events.target).toBe(blindTarget(16, 'boss', 1));
    expect(events.target).toBe(520_000_000);
    expect(game.state.phase).toBe('round_end');
    expect(types(events)).not.toContain('victory');
  });
});

// ─────────────────────────── Obálky ───────────────────────────

describe('obálky (DESIGN 2.9)', () => {
  const reg = (): ContentRegistry =>
    makeRegistry({
      consumables: CONSUMABLES,
      boosters: [
        booster('advice', { kind: 'rada', options: 3, picks: 2 }),
        booster('cards', { kind: 'card', options: 3, picks: 1 }),
      ],
      jokers: [
        joker('pack_rat', {
          initState: () => ({ opened: 0, skipped: 0 }),
          hooks: {
            onBoosterOpened: (ctx) => void (ctx.self.state.opened = num(ctx.self.state.opened) + 1),
            onBoosterSkipped: (ctx) => void (ctx.self.state.skipped = num(ctx.self.state.skipped) + 1),
          },
        }),
      ],
    });

  function open(boosterId: string, returnTo: 'shop' | 'blind_select' = 'blind_select'): Game {
    const game = makeGame({ registry: reg(), jokers: ['pack_rat'] });
    game.startBooster(boosterId, returnTo);
    return game;
  }

  it('babská obálka dobere ruku pro cíle; vybrat 2 z 3, pak se zavře a vrátí na výběr útraty', () => {
    const game = open('advice');
    const b = game._core.state.booster!;
    expect(b.hand).toHaveLength(8);
    expect(b.options).toHaveLength(3);
    expect(b.options.every((o) => o.kind === 'consumable' && o.consumableKind === 'rada')).toBe(true);
    expect(game.state.jokers[0]!.state.opened).toBe(1);
    const core = game._core;
    b.options = ['coin', 'polish', 'rada_a'].map((defId) => ({
      kind: 'consumable' as const,
      consumable: newConsumableInstance(core, defId),
      consumableKind: 'rada' as const,
    }));
    const first = ok(game.dispatch({ type: 'pickBooster', index: 0, keep: true }));
    expect(types(first)).toEqual(['consumableAdded', 'boosterPicked']);
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['coin']);
    expect(game.state.phase).toBe('booster');
    expect(game.state.booster!.picksLeft).toBe(1);
    expect(game.state.booster!.options).toHaveLength(2);
    // Druhý výběr: spotřebka s cílem z ruky obálky se rovnou použije.
    const target = game.state.booster!.hand[0]!;
    expectRejected(game, { type: 'pickBooster', index: 0 }, 'cannotUse');
    expectRejected(game, { type: 'pickBooster', index: 0, targetIds: [99999] }, 'cannotUse');
    const used = ok(game.dispatch({ type: 'pickBooster', index: 0, targetIds: [target] }));
    expect(types(used)).toEqual(['cardChanged', 'consumableUsed', 'boosterPicked', 'boosterClosed']);
    expect(game.card(target)!.enhancement).toBe('bonus');
    expect(game.state.phase).toBe('blind_select');
    expect(game.state.booster).toBeNull();
  });

  it('karetní obálka přidá kartu do balíčku; neznámá možnost → unknownItem', () => {
    const game = open('cards', 'shop');
    expectRejected(game, { type: 'pickBooster', index: 3 }, 'unknownItem');
    const size = game.state.deck.length;
    const events = ok(game.dispatch({ type: 'pickBooster', index: 1 }));
    expect(find(events, 'cardAdded')).toMatchObject({ source: 'booster' });
    expect(game.state.deck).toHaveLength(size + 1);
    expect(game.state.phase).toBe('shop');
  });

  it('žolík z obálky potřebuje volný slot (negativní ne)', () => {
    const game = makeGame({ registry: reg() });
    addJokers(game, ['noop', 'noop', 'noop', 'noop', 'noop']);
    game.startBooster('joker_pack', 'blind_select');
    game._core.state.booster!.options = [
      { kind: 'joker', joker: newJokerInstance(game._core, 'noop') },
      { kind: 'joker', joker: newJokerInstance(game._core, 'noop', 'negative') },
    ];
    expectRejected(game, { type: 'pickBooster', index: 0 }, 'slotsFull');
    ok(game.dispatch({ type: 'pickBooster', index: 1 }));
    expect(game.state.jokers).toHaveLength(6);
  });

  it('přeskočení obálky: onBoosterSkipped, návrat podle returnTo', () => {
    const game = open('advice', 'shop');
    const events = ok(game.dispatch({ type: 'skipBooster' }));
    expect(types(events)).toEqual(['boosterClosed']);
    expect(find(events, 'boosterClosed')!.skipped).toBe(true);
    expect(game.state.phase).toBe('shop');
    expect(game.state.jokers[0]!.state.skipped).toBe(1);
  });

  it('obálka se zavře i po vyčerpání možností', () => {
    const game = open('advice');
    game._core.state.booster!.options.splice(1);
    ok(game.dispatch({ type: 'pickBooster', index: 0, keep: true }));
    expect(game.state.phase).toBe('blind_select');
  });

  it('přeřazení a třídění v obálce mění ruku obálky', () => {
    const game = open('advice');
    const hand = [...game.state.booster!.hand];
    ok(game.dispatch({ type: 'reorderHand', cardIds: [...hand].reverse() }));
    expect(game.state.booster!.hand).toEqual([...hand].reverse());
    ok(game.dispatch({ type: 'sortHand', by: 'rank' }));
    const ranks = game.state.booster!.hand.map((id) => game.card(id)!.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });
});

// ─────────────────────────── Prodej ───────────────────────────

describe('prodej žolíků a spotřebek', () => {
  it('sellJoker: peníze, událost, statistika; přibitý ne, zapůjčený za 1 Kč, neznámý → unknownItem', () => {
    const game = makeGame({ money: 0 });
    const [rare, eternal, rental] = addJokers(game, [
      'rare_one',
      { id: 'noop', stickers: ['eternal'] },
      { id: 'noop', stickers: ['rental'] },
    ]);
    const events = ok(game.dispatch({ type: 'sellJoker', uid: rare!.uid }));
    expect(types(events)).toEqual(['moneyChanged', 'jokerSold']);
    expect(find(events, 'jokerSold')).toEqual({
      type: 'jokerSold',
      uid: rare!.uid,
      defId: 'rare_one',
      price: 3,
    });
    expect([game.state.money, game.state.stats.jokersSold]).toEqual([3, 1]);
    expectRejected(game, { type: 'sellJoker', uid: eternal!.uid }, 'cannotSell');
    ok(game.dispatch({ type: 'sellJoker', uid: rental!.uid }));
    expect(game.state.money).toBe(4);
    expectRejected(game, { type: 'sellJoker', uid: 424242 }, 'unknownItem');
    expect(game.state.jokers.map((j) => j.uid)).toEqual([eternal!.uid]);
  });

  it('prodej jde v kole, po kole, ve Večerce i v obálce', () => {
    const game = makeGame();
    addJokers(game, ['noop', 'noop', 'noop', 'noop']);
    const sell = () => ok(game.dispatch({ type: 'sellJoker', uid: game.state.jokers[0]!.uid }));
    ok(game.dispatch({ type: 'selectBlind' }));
    sell();
    winRound(game);
    sell();
    ok(game.dispatch({ type: 'cashOut' }));
    sell();
    game.startBooster('joker_pack', 'shop');
    sell();
    expect(game.state.jokers).toHaveLength(0);
  });

  it('sellConsumable: peníze a událost; neznámý → unknownItem', () => {
    const game = makeGame({ money: 0 });
    const c = game._core.api.createConsumable({ defId: 'stamp' })!;
    const events = ok(game.dispatch({ type: 'sellConsumable', uid: c.uid }));
    expect(find(events, 'consumableSold')).toEqual({
      type: 'consumableSold',
      uid: c.uid,
      defId: 'stamp',
      price: 3,
    });
    expect(game.state.money).toBe(3);
    expect(game.state.consumables).toEqual([]);
    expectRejected(game, { type: 'sellConsumable', uid: c.uid }, 'unknownItem');
  });
});

// ─────────────────────────── Spotřebky ───────────────────────────

describe('použití spotřebky (useConsumable)', () => {
  const reg = (): ContentRegistry =>
    makeRegistry({
      consumables: CONSUMABLES,
      jokers: [
        joker('collector', {
          initState: () => ({ used: [] }),
          hooks: {
            onConsumableUsed: (ctx) => {
              ctx.self.state.used = [...(ctx.self.state.used as string[]), `${ctx.kind}:${ctx.defId}`];
            },
          },
        }),
      ],
    });

  it('v kole s cíli z ruky: validace počtu, duplicit a karet mimo ruku', () => {
    const game = makeGame({ registry: reg(), round: true, jokers: ['collector'] });
    const c = game._core.api.createConsumable({ defId: 'polish' })!;
    const hand = game.state.round!.hand;
    const use = (targetIds?: number[]): Action => ({ type: 'useConsumable', uid: c.uid, targetIds });
    expectRejected(game, use(), 'cannotUse');
    expectRejected(game, use(hand.slice(0, 3)), 'cannotUse');
    expectRejected(game, use([hand[0]!, hand[0]!]), 'cannotUse');
    expectRejected(game, use([game.state.round!.drawPile[0]!]), 'cannotUse');
    expect(game.canUseConsumable(c.uid, hand.slice(0, 2))).toBe(true);
    expect(game.canUseConsumable(c.uid)).toBe(false);
    expect(game.canUseConsumable(9999)).toBe(false);
    const events = ok(game.dispatch(use(hand.slice(0, 2))));
    expect(types(events)).toEqual(['cardChanged', 'cardChanged', 'consumableUsed']);
    expect(hand.slice(0, 2).map((id) => game.card(id)!.enhancement)).toEqual(['bonus', 'bonus']);
    expect(game.state.consumables).toEqual([]);
    expect([game.state.stats.consumablesUsed, game.state.lastConsumable]).toEqual([1, 'polish']);
    expect(game.state.jokers[0]!.state.used).toEqual(['rada:polish']);
  });

  it('bez cílů: pranostika zvýší úroveň; cíle navíc → cannotUse; jde i mimo kolo', () => {
    const game = makeGame({ registry: reg() });
    const pr = game._core.api.createConsumable({ defId: 'pr_pair' })!;
    expectRejected(game, { type: 'useConsumable', uid: pr.uid, targetIds: [1] }, 'cannotUse');
    const events = ok(game.dispatch({ type: 'useConsumable', uid: pr.uid }));
    expect(types(events)).toEqual(['handLeveled', 'consumableUsed']);
    expect(game.state.handLevels.pair.level).toBe(2);
  });

  it('canUse false, neznámá spotřebka a odebraný obsah → odmítnuto', () => {
    const game = makeGame({ registry: reg(), round: true });
    const never = game._core.api.createConsumable({ defId: 'never' })!;
    expectRejected(game, { type: 'useConsumable', uid: never.uid }, 'cannotUse');
    expectRejected(game, { type: 'useConsumable', uid: 777 }, 'unknownItem');
    game._core.state.consumables.push({ uid: 778, defId: 'removed_from_content', edition: null });
    expectRejected(game, { type: 'useConsumable', uid: 778 }, 'cannotUse');
  });

  it('canUse dostane skutečnou instanci (i s edicí) a nesmí ji změnit', () => {
    let seen: unknown = null;
    const registry = makeRegistry({
      consumables: [
        consumable('picky', {
          canUse: (ctx) => {
            seen = ctx.self.edition;
            (ctx.self as { edition: string | null }).edition = 'hacked';
            return true;
          },
        }),
      ],
    });
    const game = makeGame({ registry, round: true });
    const c = game._core.api.createConsumable({ defId: 'picky', edition: 'negative' })!;
    expect(game.canUseConsumable(c.uid)).toBe(true);
    expect(seen).toBe('negative');
    expect(game.state.consumables[0]!.edition).toBe('negative');
  });

  it('v obálce: cíle z ruky obálky (ne z kola)', () => {
    const game = makeGame({ registry: reg() });
    game.startBooster('rada_pack', 'blind_select');
    const c = game._core.api.createConsumable({ defId: 'polish' })!;
    const target = game.state.booster!.hand[2]!;
    expectRejected(game, { type: 'useConsumable', uid: c.uid, targetIds: [424242] }, 'cannotUse');
    ok(game.dispatch({ type: 'useConsumable', uid: c.uid, targetIds: [target] }));
    expect(game.card(target)!.enhancement).toBe('bonus');
    expect(game.state.phase).toBe('booster');
  });

  it('ve Večerce a po kole jen spotřebky bez cílů', () => {
    const game = makeGame({ registry: reg(), round: true });
    winRound(game);
    const polish = game._core.api.createConsumable({ defId: 'polish' })!;
    expectRejected(
      game,
      { type: 'useConsumable', uid: polish.uid, targetIds: [game.state.round!.hand[0]!] },
      'cannotUse',
    );
    const coin = game._core.api.createConsumable({ defId: 'coin', ignoreSlots: true })!;
    ok(game.dispatch({ type: 'useConsumable', uid: coin.uid }));
  });
});

// ─────────────────────────── Přeřazení ───────────────────────────

describe('přeřazení žolíků a ruky', () => {
  it('reorderJokers: permutace projde; špatná délka, duplicita a neznámé uid ne', () => {
    const game = makeGame();
    const [a, b, c] = addJokers(game, ['noop', 'plus_mult', 'times_mult']);
    ok(game.dispatch({ type: 'reorderJokers', uids: [c!.uid, a!.uid, b!.uid] }));
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['times_mult', 'noop', 'plus_mult']);
    expectRejected(game, { type: 'reorderJokers', uids: [a!.uid, b!.uid] }, 'invalidSelection');
    expectRejected(game, { type: 'reorderJokers', uids: [a!.uid, a!.uid, b!.uid] }, 'invalidSelection');
    expectRejected(game, { type: 'reorderJokers', uids: [a!.uid, b!.uid, 999] }, 'invalidSelection');
    expectRejected(game, { type: 'reorderJokers' } as unknown as Action, 'invalidSelection');
  });

  it('reorderHand / sortHand jen během kola; po kole už ruka nejde měnit', () => {
    const game = makeGame({ round: true });
    const cards = setupRound(game, '2S KH 10D AS 2H');
    const ids = cards.map((c) => c.id);
    ok(game.dispatch({ type: 'reorderHand', cardIds: [...ids].reverse() }));
    expect(game.state.round!.hand).toEqual([...ids].reverse());
    expectRejected(game, { type: 'reorderHand', cardIds: ids.slice(1) }, 'invalidSelection');
    expectRejected(
      game,
      { type: 'reorderHand', cardIds: [ids[0]!, ids[0]!, ids[1]!, ids[2]!, ids[3]!] },
      'invalidSelection',
    );
    expectRejected(game, { type: 'reorderHand', cardIds: [...ids.slice(1), 9999] }, 'invalidSelection');
    expectRejected(game, { type: 'sortHand', by: 'color' as 'rank' }, 'invalidSelection');
    ok(game.dispatch({ type: 'sortHand', by: 'rank' }));
    expect(game.state.round!.hand.map((id) => game.card(id)!.rank)).toEqual([14, 13, 10, 2, 2]);
    ok(game.dispatch({ type: 'sortHand', by: 'suit' }));
    const suits = game.state.round!.hand.map((id) => game.card(id)!.suit);
    expect(suits).toEqual(['S', 'S', 'H', 'H', 'D']);
    winRound(game);
    expectRejected(game, { type: 'reorderHand', cardIds: [...game.state.round!.hand] }, 'wrongPhase');
    expectRejected(game, { type: 'sortHand', by: 'rank' }, 'wrongPhase');
  });
});

// ─────────────────────────── Zahození a šéf ───────────────────────────

describe('zahození: šéf onDiscard vidí jen zbylou ruku (oprava z ROADMAP)', () => {
  it('nucené zahození (Tchyně) nevezme zahazovanou kartu, id nejsou na hromádce dvakrát', () => {
    const seenHands: number[][] = [];
    const refused: boolean[] = [];
    const reg = calmRegistry({
      bosses: [
        boss('mother_in_law', {
          hooks: {
            onDiscard: (ctx) => {
              const hand = ctx.api.handCards();
              seenHands.push(hand.map((c) => c.id));
              for (const c of ctx.discarded) refused.push(ctx.api.discardFromHand(c.id));
              ctx.api.discardFromHand(ctx.rng.pick(hand).id);
            },
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg });
    selectBoss(game, 'mother_in_law');
    const discarded = game.state.round!.hand.slice(0, 3);
    const events = ok(game.dispatch({ type: 'discard', cardIds: discarded }));
    expect(seenHands[0]!.some((id) => discarded.includes(id))).toBe(false);
    expect(seenHands[0]).toHaveLength(5);
    expect(refused).toEqual([false, false, false]);
    const r = game.state.round!;
    expect(new Set(r.discardPile).size).toBe(r.discardPile.length);
    expect(r.discardPile).toHaveLength(4);
    expect(r.discardPile.slice(0, 3)).toEqual(discarded);
    const all = [...r.hand, ...r.drawPile, ...r.discardPile].sort((x, y) => x - y);
    expect(all).toEqual(game.state.deck.map((c) => c.id).sort((x, y) => x - y));
    expect(r.hand).toHaveLength(8);
    // Hráčovo zahození přijde před nuceným.
    const discards = events.filter((e) => e.type === 'cardsDiscarded');
    expect(discards.map((e) => (e.type === 'cardsDiscarded' ? (e.forced ?? false) : null))).toEqual([
      false,
      true,
    ]);
  });

  it('žolík onDiscard vidí ruku bez zahazovaných karet a zahození už započtené', () => {
    const seen: { hand: number; discardsLeft: number; first: boolean }[] = [];
    const reg = makeRegistry({
      jokers: [
        joker('watcher', {
          hooks: {
            onDiscard: (ctx) => {
              seen.push({
                hand: ctx.api.handCards().length,
                discardsLeft: ctx.state.round!.discardsLeft,
                first: ctx.firstDiscard,
              });
            },
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['watcher'], round: true });
    ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 2) }));
    ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(seen).toEqual([
      { hand: 6, discardsLeft: 2, first: true },
      { hand: 7, discardsLeft: 1, first: false },
    ]);
  });

  it('žolík, který zahazovanou kartu zničí, ji z hromádky odebere', () => {
    const reg = makeRegistry({
      jokers: [
        joker('shredder', {
          hooks: { onDiscard: (ctx) => ctx.api.destroyCard(ctx.discarded[0]!.id, 'test') },
        }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['shredder'], round: true });
    const ids = game.state.round!.hand.slice(0, 2);
    ok(game.dispatch({ type: 'discard', cardIds: ids }));
    expect(game.state.round!.discardPile).toEqual([ids[1]]);
    expect(game.card(ids[0]!)).toBeUndefined();
  });
});

// ─────────────────────────── Bus ───────────────────────────

describe('události na busu', () => {
  it('úspěšná akce doručí na bus přesně události z výsledku, ve stejném pořadí', () => {
    const game = makeGame({ round: true, jokers: ['discard_cash'] });
    const { got, off } = listen(game);
    const all: GameEvent[] = [];
    all.push(...ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 2) })));
    all.push(...winRound(game));
    all.push(...ok(game.dispatch({ type: 'cashOut' })));
    off();
    expect(got).toEqual(all);
  });

  it('typoví posluchači dostanou jen svůj typ', () => {
    const game = makeGame({ round: true });
    const played: number[] = [];
    game.bus.on('handPlayed', (e) => played.push(e.roundScore));
    winRound(game);
    expect(played).toHaveLength(1);
  });

  it('chyba posluchače stav nevrací (akce už proběhla) a propadne volajícímu', () => {
    const game = makeGame();
    game.bus.on('blindSelected', () => {
      throw new Error('UI spadlo');
    });
    expect(() => game.dispatch({ type: 'selectBlind' })).toThrow('UI spadlo');
    expect(game.state.phase).toBe('round');
  });

  it('události z neúspěšné akce se zahodí a neprosáknou do další akce', () => {
    const game = makeGame({ round: true });
    expectRejected(game, { type: 'play', cardIds: [] }, 'invalidSelection');
    const events = ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(types(events)).toEqual(['cardsDiscarded', 'cardsDrawn']);
  });
});

// ─────────────────────────── Založení s výzvou a další okrajové případy ───────────────────────────

describe('založení runu s výzvou, balíčkem a obtížností', () => {
  it('výzva: vlastní balíček, peníze, startovní žolíci/spotřebky/kupóny, pravidla; pořadí onRunStart', () => {
    const order: string[] = [];
    const reg = makeRegistry({
      vouchers: [voucher('starter', { passive: () => ({ discards: 1 }) })],
      decks: [{ id: 'plain', onRunStart: () => void order.push('deck'), art: ART }],
      stakes: [
        stake('tenner', 1, { onRunStart: () => void order.push('stake1') }),
        stake('eleven', 2, { onRunStart: () => void order.push('stake2') }),
      ],
      challenges: [
        {
          id: 'trial',
          deckId: 'plain',
          startingMoney: 12,
          customDeck: [
            { suit: 'S', rank: 14 },
            { suit: 'H', rank: 13 },
            { suit: 'D', rank: 12 },
          ],
          startingJokers: [{ defId: 'golem', edition: 'foil' }],
          startingConsumables: ['rada_a'],
          startingVouchers: ['starter', 'unknown_voucher'],
          bannedJokers: ['legend'],
          extraModifiers: { hands: 1 },
          onRunStart: () => void order.push('challenge'),
          art: ART,
        },
      ],
    });
    const game = makeGame({ registry: reg, deckId: 'plain', stake: 2, challengeId: 'trial' });
    const s = game.state;
    expect(order).toEqual(['stake1', 'stake2', 'deck', 'challenge']);
    expect(s.money).toBe(12);
    // Golem je startovní žolík výzvy — onAcquire se nevolá, balíček zůstane 3 karty.
    expect(s.deck).toHaveLength(3);
    expect(s.jokers.map((j) => [j.defId, j.edition])).toEqual([['golem', 'foil']]);
    expect(s.consumables.map((c) => c.defId)).toEqual(['rada_a']);
    expect(s.vouchers).toEqual(['starter']);
    expect(s.bannedJokers).toEqual(['legend']);
    expect([s.stats.minMoney, s.stats.maxMoney]).toEqual([12, 12]);
    ok(game.dispatch({ type: 'selectBlind' }));
    expect([game.state.round!.handsLeft, game.state.round!.discardsLeft]).toEqual([5, 4]);
  });
});

describe('okrajové případy kola', () => {
  it('šéf onDraw dostane líznuté karty; jeho změna round.flags se projeví hned (passive)', () => {
    const drawn: number[][] = [];
    const reg = calmRegistry({
      bosses: [
        boss('flood', {
          hooks: {
            passive: (ctx) => ({ handSize: -num(ctx.round.flags.shrink) }),
            onDraw: (ctx) => {
              drawn.push(ctx.drawn.map((c) => c.id));
              ctx.round.flags.shrink = 1;
            },
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg });
    selectBoss(game, 'flood');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toEqual(game.state.round!.hand);
    ok(game.dispatch({ type: 'play', cardIds: game.state.round!.hand.slice(0, 3) }));
    expect(game.state.round!.hand).toHaveLength(7);
    expect(drawn).toHaveLength(2);
  });

  it('šéf onRoundStart, který změní vlastní passive (ruce, zahození), upraví zbývající hned', () => {
    const reg = calmRegistry({
      bosses: [
        boss('drought', {
          hooks: {
            passive: (ctx) => (ctx.round.flags.dry ? { discards: -3, hands: 1 } : {}),
            onRoundStart: (ctx) => void (ctx.round.flags.dry = true),
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg });
    selectBoss(game, 'drought');
    expect([game.state.round!.handsLeft, game.state.round!.discardsLeft]).toEqual([5, 0]);
  });

  it('žolík onDiscard se zprávou pošle jokerTriggered', () => {
    const reg = makeRegistry({
      jokers: [joker('chatty', { hooks: { onDiscard: () => ({ message: 'jokers.chatty.msg' }) } })],
    });
    const game = makeGame({ registry: reg, jokers: ['chatty'], round: true });
    const events = ok(game.dispatch({ type: 'discard', cardIds: game.state.round!.hand.slice(0, 1) }));
    expect(find(events, 'jokerTriggered')).toMatchObject({ defId: 'chatty', message: 'jokers.chatty.msg' });
  });

  it('canUse, které vyhodí výjimku, znamená „nejde použít“', () => {
    const reg = makeRegistry({
      consumables: [
        consumable('broken', {
          canUse: () => {
            throw new Error('chyba v obsahu');
          },
        }),
      ],
    });
    const game = makeGame({ registry: reg, round: true });
    const c = game._core.api.createConsumable({ defId: 'broken' })!;
    expect(game.canUseConsumable(c.uid)).toBe(false);
  });

  it('pomocníci pro testy a obsah: ctx() a _draw()', () => {
    const game = makeGame({ round: true });
    expect(game.ctx().state).toBe(game.state);
    expect(game.ctx().mods.handSize).toBe(8);
    const before = game.state.round!.hand.length;
    game._draw(2);
    expect(game.state.round!.hand).toHaveLength(before + 2);
  });
});

describe('Imperial: pravidlo Velké útraty po přelosování šéfa', () => {
  it('když přelosovaný šéf patra vyjde stejně jako pravidlo Velké, Velká dostane jiné', () => {
    const rule = { onRoundStart: () => {} };
    const reg = makeRegistry({ stakes: [stake('tenner', 1), stake('imperial', 8, { bigBlindBoss: true })] });
    reg.bosses = { a: boss('a', { hooks: rule }), b: boss('b', { hooks: rule }) };
    const game = makeGame({ registry: reg, stake: 8 });
    const s = game._core.state;
    s.blinds[2]!.bossId = 'a';
    s.blinds[1]!.bossId = 'b';
    s.flags.bossRerolls = 1;
    ok(game.dispatch({ type: 'rerollBoss' }));
    expect(game.state.blinds[2]!.bossId).toBe('b');
    expect(game.state.blinds[1]!.bossId).toBe('a');
  });
});
