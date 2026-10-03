/**
 * Opravy logiky po testu 1.0 (1.0.1) — engine:
 *  - `Game.check(action)`: zkouška akce nad kopií stavu (stav ani RNG se nezmění), shoda s `dispatch`,
 *  - „Koupit a použít“ počítá jen s kupovanou položkou (Výjimka z vyhlášky se 4/5 žolíky a žolíkem ve Večerce,
 *    Zaklepat na dřevo bez vlastních žolíků), `shopSellValue` po položkách,
 *  - obálka: `pickBooster` se spotřebkou respektuje `canUse` (Babiččina barva na karty stejné barvy),
 *  - limit výběru `maxSelect` (Minimalista) omezuje i počet cílů spotřebky (`consumableTargetRange`),
 *  - denní seed dneška a budoucích dní nejde zadat ručně (`parseSeedInput` s `todayKey`),
 *  - hloubková kontrola uloženého runu (`validateRunState`): poškozená data, neznámý obsah, stavy z reálných runů.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import type { JokerInstance, RunState, ShopItem } from '../../src/engine';
import { Game, createBot, deserializeRun, serializeRun, validateRunState } from '../../src/engine';
import { dailyPracticeError, parseSeedInput } from '../../src/engine/meta';

const REG = registry();

function newGame(seed: string, opts: { challengeId?: string } = {}): Game {
  return Game.newRun({ deckId: 'pub', stake: 1, seed, challengeId: opts.challengeId ?? null }, REG);
}

const commons = Object.keys(REG.jokers)
  .filter((id) => REG.jokers[id]!.rarity === 'common')
  .sort();

function jokerInst(uid: number, defId: string): JokerInstance {
  return { uid, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}

function jokerItem(uid: number, defId: string, price = 5): ShopItem {
  return { kind: 'joker', joker: jokerInst(uid, defId), price, sold: false };
}

function consumableItem(uid: number, defId: string, price = 4): ShopItem {
  return {
    kind: 'consumable',
    consumable: { uid, defId, edition: null },
    consumableKind: REG.consumables[defId]!.kind,
    price,
    sold: false,
  };
}

/** Stav ve Večerce s danými jokery, spotřebkami a zbožím. */
function shopState(
  items: ShopItem[],
  jokers: JokerInstance[],
  consumables: RunState['consumables'],
): RunState {
  const s = structuredClone(newGame('FIXSHOPA').state) as RunState;
  s.phase = 'shop';
  s.money = 50;
  s.jokers = jokers;
  s.consumables = consumables;
  s.nextUid = 2000;
  s.shop = {
    items,
    boosters: [],
    vouchers: [],
    rerollCost: 5,
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls: 0,
  };
  return s;
}

describe('Game.check — zkouška akce nad kopií', () => {
  it('nemění stav ani RNG a shoduje se s dispatch', () => {
    const game = newGame('FIXCHECK');
    const before = JSON.stringify(game.state);
    expect(game.check({ type: 'selectBlind' })).toEqual({ ok: true, events: [] });
    expect(game.check({ type: 'play', cardIds: [1] })).toEqual({ ok: false, error: 'wrongPhase' });
    expect(JSON.stringify(game.state)).toBe(before);
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    const hand = game.state.round!.hand;
    const snap = JSON.stringify(game.state);
    expect(game.check({ type: 'play', cardIds: [hand[0]!] }).ok).toBe(true);
    expect(game.check({ type: 'play', cardIds: [-5] })).toEqual({ ok: false, error: 'invalidSelection' });
    expect(JSON.stringify(game.state)).toBe(snap);
  });
});

describe('„Koupit a použít“ — jen kupovaná položka', () => {
  it('Výjimka z vyhlášky se 4/5 žolíky a žolíkem ve Večerce jde (slot pro legendárního je volný)', () => {
    const s = shopState(
      [jokerItem(901, commons[5]!), consumableItem(902, 'exemption', 6)],
      [0, 1, 2, 3].map((i) => jokerInst(800 + i, commons[i]!)),
      [
        { uid: 700, defId: 'tree_frog', edition: null },
        { uid: 701, defId: 'tree_frog', edition: null },
      ],
    );
    const game = Game.fromState(s, REG);
    expect(game.modifiers().jokerSlots).toBe(5);
    expect(game.check({ type: 'buyAndUse', slot: 1 }).ok).toBe(true);
    const res = game.dispatch({ type: 'buyAndUse', slot: 1 });
    expect(res.ok).toBe(true);
    expect(game.state.jokers).toHaveLength(5);
    expect(REG.jokers[game.state.jokers[4]!.defId]!.rarity).toBe('legendary');
  });

  it('Zaklepat na dřevo bez vlastních žolíků nejde, i když je žolík ve Večerce', () => {
    const s = shopState([jokerItem(911, commons[6]!), consumableItem(912, 'knock_on_wood')], [], []);
    const game = Game.fromState(s, REG);
    expect(game.check({ type: 'buyAndUse', slot: 1 })).toEqual({ ok: false, error: 'cannotUse' });
    expect(game.dispatch({ type: 'buyAndUse', slot: 1 })).toEqual({ ok: false, error: 'cannotUse' });
    // S vlastním žolíkem bez edice jde.
    const s2 = shopState(
      [jokerItem(911, commons[6]!), consumableItem(912, 'knock_on_wood')],
      [jokerInst(800, commons[0]!)],
      [],
    );
    expect(Game.fromState(s2, REG).check({ type: 'buyAndUse', slot: 1 }).ok).toBe(true);
  });

  it('bez peněz vrací notEnoughMoney', () => {
    const s = shopState([consumableItem(912, 'knock_on_wood')], [jokerInst(800, commons[0]!)], []);
    s.money = 0;
    expect(Game.fromState(s, REG).check({ type: 'buyAndUse', slot: 0 })).toEqual({
      ok: false,
      error: 'notEnoughMoney',
    });
  });

  it('shopSellValue: prodejní cena jako po koupi jen této položky; karta a prodané zboží null', () => {
    const s = shopState(
      [
        jokerItem(901, commons[0]!, 6),
        consumableItem(902, 'tree_frog', 4),
        {
          kind: 'card',
          card: {
            id: 950,
            suit: 'S',
            rank: 14,
            enhancement: null,
            seal: null,
            edition: null,
            bonusChips: 0,
            debuffed: false,
            faceDown: false,
          },
          price: 2,
          sold: false,
        },
        { ...jokerItem(903, commons[1]!), sold: true },
      ],
      [],
      [],
    );
    const game = Game.fromState(s, REG);
    const before = JSON.stringify(game.state);
    const jokerValue = game.shopSellValue(0);
    const consumableValue = game.shopSellValue(1);
    expect(game.shopSellValue(2)).toBeNull();
    expect(game.shopSellValue(3)).toBeNull();
    expect(game.shopSellValue(99)).toBeNull();
    expect(JSON.stringify(game.state)).toBe(before);
    expect(game.dispatch({ type: 'buy', slot: 0 }).ok).toBe(true);
    expect(game.sellValue(901)).toBe(jokerValue);
    expect(game.dispatch({ type: 'buy', slot: 1 }).ok).toBe(true);
    expect(game.sellValue(902)).toBe(consumableValue);
  });
});

/** Obálka babských rad s Babiččinou barvou jako první možností (ruka dobraná z obálky). */
function dyeBooster(challengeId?: string): Game {
  const game = newGame('FIXDYEAA', challengeId ? { challengeId } : {});
  game.startBooster('rada_normal', 'blind_select');
  const s = game._core.state;
  s.booster!.options[0] = {
    kind: 'consumable',
    consumable: { uid: 990, defId: 'grandmas_dye', edition: null },
    consumableKind: 'rada',
  };
  return game;
}

function sameAndOtherSuit(game: Game): { same: number[]; mixed: number[] } {
  const hand = game.state.booster!.hand;
  const cards = hand.map((id) => game.card(id)!);
  let same: number[] = [];
  let mixed: number[] = [];
  for (const a of cards)
    for (const b of cards) {
      if (a.id === b.id) continue;
      if (a.suit === b.suit && same.length === 0) same = [a.id, b.id];
      if (a.suit !== b.suit && mixed.length === 0) mixed = [a.id, b.id];
    }
  const order = (ids: number[]) => hand.filter((id) => ids.includes(id));
  return { same: order(same), mixed: order(mixed) };
}

describe('obálka — Použít respektuje canUse', () => {
  it('Babiččina barva na dvě karty stejné barvy nejde, na různé jde (check = dispatch)', () => {
    const game = dyeBooster();
    const { same, mixed } = sameAndOtherSuit(game);
    expect(same).toHaveLength(2);
    expect(mixed).toHaveLength(2);
    expect(game.check({ type: 'pickBooster', index: 0, targetIds: same })).toEqual({
      ok: false,
      error: 'cannotUse',
    });
    expect(game.dispatch({ type: 'pickBooster', index: 0, targetIds: same }).ok).toBe(false);
    expect(game.check({ type: 'pickBooster', index: 0, targetIds: mixed }).ok).toBe(true);
    expect(game.dispatch({ type: 'pickBooster', index: 0, targetIds: mixed }).ok).toBe(true);
  });
});

/**
 * Cíle pro Babiččinu barvu: nejlevější karta ruky, karta jiné barvy a zbytek — tři a čtyři karty v pořadí ruky
 * (rada tak vždy něco změní).
 */
function dyeTargets(game: Game, hand: readonly number[]): { four: number[]; three: number[] } {
  const lead = game.card(hand[0]!)!;
  const diff = hand.map((id) => game.card(id)!).find((c) => c.suit !== lead.suit)!;
  const rest = hand.filter((id) => id !== lead.id && id !== diff.id);
  const pick = (ids: (number | undefined)[]) => hand.filter((id) => ids.includes(id));
  const four = pick([lead.id, diff.id, rest[0], rest[1]]);
  const three = pick([lead.id, diff.id, rest[0]]);
  expect(four).toHaveLength(4);
  expect(three).toHaveLength(3);
  return { four, three };
}

describe('Minimalista — limit výběru platí i pro cíle spotřebek', () => {
  it('consumableTargetRange omezí horní mez na maxSelect (Babiččina barva 2–3 místo 2–4)', () => {
    expect(newGame('FIXMINAA').consumableTargetRange('grandmas_dye')).toEqual({ min: 2, max: 4 });
    const mini = newGame('FIXMINAA', { challengeId: 'minimalist' });
    expect(mini.modifiers().maxSelect).toBe(3);
    expect(mini.consumableTargetRange('grandmas_dye')).toEqual({ min: 2, max: 3 });
    expect(mini.consumableTargetRange('knock_on_wood')).toBeNull();
    expect(mini.consumableTargetRange('nope')).toBeNull();
  });

  it('obálka i slot: 4 cíle engine odmítne, 3 přijme', () => {
    const game = dyeBooster('minimalist');
    const { four, three } = dyeTargets(game, game.state.booster!.hand);
    expect(game.check({ type: 'pickBooster', index: 0, targetIds: four })).toEqual({
      ok: false,
      error: 'cannotUse',
    });
    expect(game.check({ type: 'pickBooster', index: 0, targetIds: three }).ok).toBe(true);

    // Slot spotřebek v kole: totéž přes canUseConsumable / useConsumable.
    const g2 = newGame('FIXMINAB', { challengeId: 'minimalist' });
    g2._core.state.consumables.push({ uid: 991, defId: 'grandmas_dye', edition: null });
    expect(g2.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    const { four: t4, three: t3 } = dyeTargets(g2, g2.state.round!.hand);
    expect(g2.canUseConsumable(991, t4)).toBe(false);
    expect(g2.dispatch({ type: 'useConsumable', uid: 991, targetIds: t4 })).toEqual({
      ok: false,
      error: 'cannotUse',
    });
    expect(g2.canUseConsumable(991, t3)).toBe(true);
    expect(g2.dispatch({ type: 'useConsumable', uid: 991, targetIds: t3 }).ok).toBe(true);
  });
});

describe('denní run nejde natrénovat ručním seedem', () => {
  it('parseSeedInput s todayKey: dnešek a budoucnost odmítne, minulé dny jdou', () => {
    const todayKey = '20261003';
    expect(parseSeedInput('DEN-20261003', { todayKey })).toEqual({ ok: false, error: 'dailyToday' });
    expect(parseSeedInput('den-2026 10 04', { todayKey })).toEqual({ ok: false, error: 'dailyFuture' });
    expect(parseSeedInput('DEN-20991231', { todayKey })).toEqual({ ok: false, error: 'dailyFuture' });
    expect(parseSeedInput('DEN-20261002', { todayKey })).toEqual({
      ok: true,
      kind: 'daily',
      seed: 'DEN-20261002',
      dateKey: '20261002',
    });
    // Neplatné datum má přednost; vlastní seed se dnem nesouvisí.
    expect(parseSeedInput('DEN-20991332', { todayKey })).toEqual({ ok: false, error: 'invalidDate' });
    expect(parseSeedInput('ABCD2345', { todayKey })).toEqual({ ok: true, kind: 'custom', seed: 'ABCD2345' });
    // Bez dne (nástroje, testy) se nic neomezuje.
    expect(parseSeedInput('DEN-20991231').ok).toBe(true);
  });

  it('dailyPracticeError', () => {
    expect(dailyPracticeError('20261003', '20261003')).toBe('dailyToday');
    expect(dailyPracticeError('20261004', '20261003')).toBe('dailyFuture');
    expect(dailyPracticeError('20251231', '20261003')).toBeNull();
    expect(dailyPracticeError('20261004', undefined)).toBeNull();
  });
});

/** Run v kole (po výběru Malé útraty), uložený a načtený jako z úložiště. */
function roundState(): RunState {
  const game = newGame('FIXVALID');
  game.dispatch({ type: 'selectBlind' });
  return deserializeRun(serializeRun(game.state as RunState));
}

function paths(state: unknown, kind?: 'corrupt' | 'unknownContent'): string[] {
  return validateRunState(state, REG)
    .filter((i) => !kind || i.kind === kind)
    .map((i) => i.path);
}

describe('validateRunState — hloubková kontrola uloženého runu', () => {
  it('stavy z reálného runu (bot přes všechny fáze) jsou v pořádku', () => {
    const game = newGame('FIXVALBT');
    const bot = createBot('max');
    const seen = new Set<string>();
    for (let i = 0; i < 400 && game.state.phase !== 'game_over' && game.state.phase !== 'victory'; i++) {
      const res = game.dispatch(bot.decide(game));
      if (!res.ok) break;
      seen.add(game.state.phase);
      expect(validateRunState(deserializeRun(serializeRun(game.state as RunState)), REG)).toEqual([]);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['round', 'round_end', 'shop', 'blind_select']));
  });

  it('poškozené kolo, karty a útraty = corrupt (import je odmítne, autosave se nenačte)', () => {
    const base = roundState();
    expect(paths(base)).toEqual([]);
    expect(paths({ ...base, round: {} }, 'corrupt')).toEqual(
      expect.arrayContaining(['round.blind', 'round.hand', 'round.flags']),
    );
    const hand = [9999, ...base.round!.hand.slice(1)];
    expect(paths({ ...base, round: { ...base.round!, hand } }, 'corrupt')).toEqual(['round.hand[0]']);
    // Karta v dobíracím balíčku i v ruce zároveň (hromádky se procházejí od dobíracího balíčku).
    const dup = { ...base.round!, drawPile: [...base.round!.drawPile, base.round!.hand[0]!] };
    expect(paths({ ...base, round: dup }, 'corrupt')).toEqual(['round.hand[0]']);
    expect(paths({ ...base, deck: [{}] }, 'corrupt')).toEqual(
      expect.arrayContaining(['deck[0].id', 'deck[0].suit', 'deck[0].rank']),
    );
    expect(paths({ ...base, deck: [...base.deck, base.deck[0]] }, 'corrupt')).toEqual([
      `deck[${base.deck.length}]`,
    ]);
    expect(paths({ ...base, round: null }, 'corrupt')).toEqual(['round']);
    expect(paths({ ...base, phase: 'blind_select', round: null, blindIndex: 9 }, 'corrupt')).toEqual([
      'blindIndex',
    ]);
    expect(paths({ ...base, phase: 'shop', shop: null }, 'corrupt')).toEqual(['shop']);
    expect(paths({ ...base, jokers: [{ uid: 5, defId: commons[0] }] }, 'corrupt')).toEqual(
      expect.arrayContaining(['jokers[0].state', 'jokers[0].stickers']),
    );
    expect(paths([], 'corrupt')).toEqual(['(root)']);
    expect(paths(null, 'corrupt')).toEqual(['(root)']);
  });

  it('neznámý obsah = unknownContent (hrát jde, import ho odmítne)', () => {
    const base = roundState();
    const withJoker = { ...base, jokers: [{ ...jokerInst(999, 'nope'), edition: 'plastic' }] };
    expect(validateRunState(withJoker, REG)).toEqual([
      { kind: 'unknownContent', path: 'jokers[0].defId' },
      { kind: 'unknownContent', path: 'jokers[0].edition' },
    ]);
    // Bez registru (načtení autosave) neznámý obsah nevadí.
    expect(validateRunState(withJoker)).toEqual([]);
    expect(paths({ ...base, consumables: [{ uid: 998, defId: 'nope', edition: null }] })).toEqual([
      'consumables[0].defId',
    ]);
    expect(paths({ ...base, deckId: 'nope', stake: 42 })).toEqual(['deckId', 'stake']);
  });

  it('obálka z Večerky bez Večerky a ruka obálky mimo balíček = corrupt', () => {
    const game = newGame('FIXVALBO');
    game.startBooster('rada_normal', 'blind_select');
    const s = deserializeRun(serializeRun(game.state as RunState));
    expect(paths(s)).toEqual([]);
    expect(paths({ ...s, booster: { ...s.booster!, returnTo: 'shop' } }, 'corrupt')).toEqual(['shop']);
    expect(paths({ ...s, booster: { ...s.booster!, hand: [12345] } }, 'corrupt')).toEqual([
      'booster.hand[0]',
    ]);
  });
});
