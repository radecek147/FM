/**
 * Štítky za přeskočení (docs/DESIGN.md kap. 7): přesné efekty přes skutečný engine (přeskočení útraty, výběr útrat,
 * Večerka, obálky zdarma, rozpis odměn, záchrana kola), hranice, hromadění, uložení a načtení, texty a `ArtSpec`.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { BOOSTERS } from '../../src/content/boosters';
import { buildRegistry } from '../../src/content/index';
import { forecastHand, TAGS } from '../../src/content/tags';
import { VOUCHERS } from '../../src/content/vouchers';
import type { ContentRegistry, JokerDef, TagDef } from '../../src/engine/content-types';
import { Game } from '../../src/engine/run/game';
import { blindTarget } from '../../src/engine/run/targets';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { editionPriceAdd, shopPrice } from '../../src/engine/shop/prices';
import type { ActionResult, GameEvent, ShopItem } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import { joker, makeGame, makeRegistry, setupRound, type JokerSpec } from './fixtures/registry';

// ─────────────────────────── Testovací obsah ───────────────────────────

/** Testovací žolíci, kteří řídí nabídku Večerky a přidávají štítky během hry. */
const HELPER_JOKERS: JokerDef[] = [
  // Večerka nabízí jen žolíky a bez edic (negativní má samostatný hod — v testech se kontroluje).
  joker('jokers_only', {
    hooks: { passive: () => ({ shopWeightPranostika: -3, shopWeightRada: -3, editionRateMult: 0 }) },
  }),
  // Večerka nenabízí žádné žolíky.
  joker('no_jokers', { hooks: { passive: () => ({ shopWeightJoker: -14, editionRateMult: 0 }) } }),
  // Prodej přidá štítek (štítek získaný ve Večerce nebo uprostřed kola).
  joker('envelope_seller', {
    hooks: { onSell: (ctx) => void (ctx.isSelf ? ctx.api.addTag('uncle_envelope') : undefined) },
  }),
  joker('sick_seller', {
    hooks: { onSell: (ctx) => void (ctx.isSelf ? ctx.api.addTag('sick_note') : undefined) },
  }),
  // Legendární žolík pro Pouťovou tombolu (jen ze speciálních efektů).
  joker('legend', { rarity: 'legendary', cost: 16, noShop: true }),
];

/** Testovací registr + skutečné štítky, obálky a kupóny. */
const reg: ContentRegistry = makeRegistry({
  tags: TAGS,
  boosters: BOOSTERS,
  vouchers: VOUCHERS,
  jokers: HELPER_JOKERS,
});

function def(id: string): TagDef {
  const d = TAGS.find((x) => x.id === id);
  if (!d) throw new Error(`Chybí štítek ${id}`);
  return d;
}

function ok(res: ActionResult): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

function newGame(opts: { jokers?: (string | JokerSpec)[]; money?: number; seed?: string } = {}): Game {
  return makeGame({ registry: reg, ...opts });
}

/** Přeskočí aktuální útratu se zadaným štítkem (štítek útraty se přepíše). */
function skipWith(game: Game, tagId: string): GameEvent[] {
  const s = game._core.state;
  s.blinds[s.blindIndex]!.skipTagId = tagId;
  return ok(game.dispatch({ type: 'skipBlind' }));
}

/** Vybere aktuální útratu a vyhraje ji první kartou (cíl 0) → rozpis odměn. */
function winCurrent(game: Game): void {
  ok(game.dispatch({ type: 'selectBlind' }));
  game._core.state.round!.target = 0;
  ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
  expect(game.state.phase).toBe('round_end');
}

/** Vyhraje aktuální útratu a vyplatí → Večerka. */
function winToShop(game: Game): void {
  winCurrent(game);
  ok(game.dispatch({ type: 'cashOut' }));
}

function tagIds(game: Game): string[] {
  return game.state.tags.map((x) => x.defId);
}

function jokerItems(game: Game): Extract<ShopItem, { kind: 'joker' }>[] {
  return (game.state.shop?.items ?? []).filter(
    (it): it is Extract<ShopItem, { kind: 'joker' }> => it.kind === 'joker',
  );
}

function reload(game: Game): Game {
  return Game.fromState(deserializeRun(JSON.parse(serializeRun(game.state))), game.registry);
}

// ─────────────────────────── Obsah a texty ───────────────────────────

describe('štítky — obsah (DESIGN 7)', () => {
  const EXPECTED: [string, number][] = [
    ['coat_change', 1],
    ['fair_raffle', 4],
    ['in_law_loan', 1],
    ['paper_drive', 1],
    ['open_doors', 1],
    ['uncle_envelope', 1],
    ['harvest_festival', 1],
    ['grandma_parcel', 1],
    ['moving_day', 2],
    ['mushroom_hunt', 1],
    ['polished_cutlery', 1],
    ['hop_picking', 1],
    ['referral', 1],
    ['connections', 3],
    ['mailbox_flyer', 1],
    ['boss_flu', 1],
    ['spread_newspaper', 1],
    ['forecast', 1],
    ['sick_note', 2],
    ['roadside_bazaar', 1],
  ];

  it('20 štítků se závaznými id a patrem, od kterého se nabízejí', () => {
    expect(TAGS.map((x) => [x.id, x.minAnte ?? 1])).toEqual(EXPECTED);
  });

  it('každý štítek má název (max 3 slova), popis a flavor; {param} v popisku jsou v params a po dosazení nic nezbyde', () => {
    for (const tag of TAGS) {
      for (const field of ['name', 'desc', 'flavor']) {
        expect(hasKey(`tags.${tag.id}.${field}`), `tags.${tag.id}.${field}`).toBe(true);
      }
      expect(t(`tags.${tag.id}.name`).split(/\s+/).length, tag.id).toBeLessThanOrEqual(3);
      const raw = t(`tags.${tag.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(tag.params ?? {}, `${tag.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`tags.${tag.id}.desc`, tag.params ?? {}), tag.id).not.toMatch(/[{}]/);
      expect(t(`tags.${tag.id}.flavor`), tag.id).not.toMatch(/[„“"]/);
    }
  });

  it('popisky ukazují čísla z params česky', () => {
    const desc = (id: string) => t(`tags.${id}.desc`, def(id).params ?? {}).replaceAll(NBSP, ' ');
    expect(desc('coat_change')).toBe('Dostaneš 12 Kč.');
    expect(desc('fair_raffle')).toContain('cena útěchy 12 Kč');
    expect(desc('in_law_loan')).toBe(
      'Hned dostaneš 20 Kč; po porážce šéfa tohoto patra se z odměny strhne 15 Kč.',
    );
    expect(desc('paper_drive')).toContain('3 karty s nejnižší hodnotou');
    expect(desc('hop_picking')).toBe('Další 2 vyhraná kola dostaneš v odměnách navíc 6 Kč (za každé).');
    expect(desc('harvest_festival')).toContain(
      '+1 úroveň každé kombinaci, která se v tomto runu hrála aspoň 3×',
    );
    expect(desc('moving_day')).toBe('+1 slot žolíka, ale −1 slot spotřebky do konce runu.');
    expect(desc('mushroom_hunt')).toContain('2 kopie náhodné karty');
    expect(desc('open_doors')).toContain('3 přehození zdarma');
    expect(desc('polished_cutlery')).toContain('lesklá 55 %, holografická 30 %, duhová 15 %');
    expect(desc('referral')).toContain('o 50 % levněji');
    expect(desc('mailbox_flyer')).toContain('1 kupón');
    expect(desc('boss_flu')).toContain('o 25 % nižší');
    expect(desc('spread_newspaper')).toBe('V příštím kole +2 karty v ruce a +1 zahození.');
    expect(desc('forecast')).toContain('+2 úrovně');
    expect(desc('sick_note')).toContain('aspoň 50 %');
    expect(desc('roadside_bazaar')).toContain('8 Kč');
  });

  it('ArtSpec: ikony z ICON_NAMES a každý štítek jinou kombinací ikony a rekvizity', () => {
    for (const tag of TAGS) {
      expect(isIconName(tag.art.icon), `${tag.id}: ${tag.art.icon}`).toBe(true);
      if (tag.art.prop) expect(isIconName(tag.art.prop), `${tag.id}: ${tag.art.prop}`).toBe(true);
    }
    expect(new Set(TAGS.map((x) => x.art.icon)).size).toBe(TAGS.length);
  });
});

// ─────────────────────────── Losování štítků útrat ───────────────────────────

describe('štítky útrat — losování (DESIGN 7)', () => {
  const real = buildRegistry();
  const late = new Set(TAGS.filter((x) => (x.minAnte ?? 1) > 1).map((x) => x.id));

  it('v patře 1 mají Malá a Velká různé štítky z poolu minAnte ≤ 1; šéf štítek nemá', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const game = Game.newRun({ seed: `TAGPOOL${i}`, deckId: 'pub', stake: 1 }, real);
      const [small, big, boss] = game.state.blinds;
      expect(small!.skipTagId).not.toBeNull();
      expect(big!.skipTagId).not.toBeNull();
      expect(small!.skipTagId).not.toBe(big!.skipTagId);
      expect(boss!.skipTagId).toBeNull();
      for (const id of [small!.skipTagId!, big!.skipTagId!]) {
        expect(late.has(id), id).toBe(false);
        seen.add(id);
      }
    }
    // Pool patra 1 = 16 štítků; za 240 losů padnou všechny.
    expect(seen.size).toBe(TAGS.length - late.size);
  });

  it('od patra 3 se nabízejí i štítky s vyšším minAnte (Stěhování, Protekce, Lékařské potvrzení)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const game = Game.newRun({ seed: `TAGANTE${i}`, deckId: 'pub', stake: 1 }, real);
      game._core.state.ante = 2;
      for (let k = 0; k < 3; k++) {
        winToShop(game);
        ok(game.dispatch({ type: 'leaveShop' }));
      }
      expect(game.state.ante).toBe(3);
      const [small, big] = game.state.blinds;
      expect(small!.skipTagId).not.toBe(big!.skipTagId);
      seen.add(small!.skipTagId!);
      seen.add(big!.skipTagId!);
    }
    expect([...late].filter((id) => seen.has(id)).length).toBeGreaterThan(0);
  });

  it('štítky se hromadí, i stejné: dvě Brigády na chmelu vyplatí po kole 2× 6 Kč', () => {
    const game = newGame();
    skipWith(game, 'hop_picking');
    skipWith(game, 'hop_picking');
    expect(tagIds(game)).toEqual(['hop_picking', 'hop_picking']);
    winCurrent(game);
    const extra = game.state.rewards!.extra.filter((e) => e.source === 'tag:hop_picking');
    expect(extra.map((e) => e.amount)).toEqual([6, 6]);
    expect(tagIds(game)).toEqual(['hop_picking', 'hop_picking']);
  });
});

// ─────────────────────────── Peníze hned ───────────────────────────

describe('štítky „hned“ — peníze', () => {
  it('Drobné v kabátě: +12 Kč a štítek se hned spotřebuje', () => {
    const game = newGame({ money: 5 });
    const events = skipWith(game, 'coat_change');
    expect(game.state.money).toBe(17);
    expect(tagIds(game)).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['blindSkipped', 'tagAdded', 'moneyChanged', 'tagTriggered']),
    );
    // Malá přeskočená, další na řadě je Velká.
    expect(game.state.blinds.map((b) => b.status)).toEqual(['skipped', 'current', 'upcoming']);
    expect(game.state.phase).toBe('blind_select');
  });

  it('Pouťová tombola: legendární žolík do volného slotu; s plnými sloty 12 Kč útěchy', () => {
    const game = newGame({ money: 0 });
    const events = skipWith(game, 'fair_raffle');
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['legend']);
    expect(events).toContainEqual({ type: 'message', key: 'tags.fair_raffle.won' });
    expect(game.state.money).toBe(0);
    expect(tagIds(game)).toEqual([]);

    const full = newGame({ money: 0, jokers: ['noop', 'noop', 'noop', 'noop', 'noop'] });
    skipWith(full, 'fair_raffle');
    expect(full.state.jokers).toHaveLength(5);
    expect(full.state.money).toBe(12);
    // Legendárka už ve slotu → pool prázdný → taky útěcha (ne Pivní tácek).
    const owned = newGame({ money: 0, jokers: ['legend'] });
    skipWith(owned, 'fair_raffle');
    expect(owned.state.jokers.map((j) => j.defId)).toEqual(['legend']);
    expect(owned.state.money).toBe(12);
  });

  it('Půjčka od tchána: +20 Kč hned, po porážce šéfa −15 Kč v rozpisu odměn, pak zmizí', () => {
    const game = newGame({ money: 0 });
    skipWith(game, 'in_law_loan');
    expect(game.state.money).toBe(20);
    expect(tagIds(game)).toEqual(['in_law_loan']);
    winCurrent(game); // Velká — nic
    expect(game.state.rewards!.extra.some((e) => e.source.startsWith('tag:'))).toBe(false);
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'leaveShop' }));
    winCurrent(game); // šéf
    const r = game.state.rewards!;
    expect(r.extra).toContainEqual({ source: 'tag:in_law_loan', amount: -15 });
    expect(r.total).toBe(r.blindReward + r.unusedHands + r.unusedDiscards + r.interest - 15);
    expect(tagIds(game)).toEqual([]);
  });

  it('Sběr papíru: zničí 3 nejnižší karty bez vylepšení, pečeti a edice a dá 3 Kč za každou', () => {
    const game = newGame({ money: 0 });
    const deck = game._core.state.deck;
    const size = deck.length;
    // Nejnižší dvojka dostane vylepšení — přeskočí se.
    const twos = deck.filter((c) => c.rank === 2).sort((a, b) => a.id - b.id);
    twos[0]!.enhancement = 'bonus';
    const expected = deck
      .filter((c) => c.enhancement === null && c.seal === null && c.edition === null)
      .sort((a, b) => a.rank - b.rank || a.id - b.id)
      .slice(0, 3)
      .map((c) => c.id);
    skipWith(game, 'paper_drive');
    expect(game.state.deck).toHaveLength(size - 3);
    for (const id of expected) expect(game.card(id)).toBeUndefined();
    expect(game.card(twos[0]!.id)).toBeDefined();
    expect(game.state.money).toBe(9);
    expect(tagIds(game)).toEqual([]);
  });

  it('Brigáda na chmelu: další 2 vyhraná kola +6 Kč v rozpisu, pak zmizí; stav přežije uložení', () => {
    let game = newGame({ money: 0 });
    skipWith(game, 'hop_picking');
    expect(game.state.money).toBe(0);
    for (let round = 1; round <= 2; round++) {
      winCurrent(game);
      expect(game.state.rewards!.extra, `kolo ${round}`).toContainEqual({
        source: 'tag:hop_picking',
        amount: 6,
      });
      ok(game.dispatch({ type: 'cashOut' }));
      game = reload(game);
      ok(game.dispatch({ type: 'leaveShop' }));
    }
    expect(tagIds(game)).toEqual([]);
    winCurrent(game);
    expect(game.state.rewards!.extra.some((e) => e.source === 'tag:hop_picking')).toBe(false);
  });

  it('Dožínky: +1 úroveň kombinacím hraným aspoň 3×; když žádná, nejhranější (bez rukou Vysoká karta)', () => {
    const game = newGame();
    const hl = game._core.state.handLevels;
    hl.pair.played = 3;
    hl.flush.played = 5;
    hl.three.played = 2;
    skipWith(game, 'harvest_festival');
    expect([game.state.handLevels.pair.level, game.state.handLevels.flush.level]).toEqual([2, 2]);
    expect(game.state.handLevels.three.level).toBe(1);
    expect(tagIds(game)).toEqual([]);
    const few = newGame();
    few._core.state.handLevels.three.played = 2;
    skipWith(few, 'harvest_festival');
    expect(few.state.handLevels.three.level).toBe(2);
    const fresh = newGame();
    skipWith(fresh, 'harvest_festival');
    expect(fresh.state.handLevels.high_card.level).toBe(2);
  });

  it('Stěhování: +1 slot žolíka a −1 slot spotřebky do konce runu (i po uložení)', () => {
    const game = newGame();
    const before = game.modifiers();
    skipWith(game, 'moving_day');
    expect(game.modifiers().jokerSlots).toBe(before.jokerSlots + 1);
    expect(game.modifiers().consumableSlots).toBe(before.consumableSlots - 1);
    expect(reload(game).modifiers().jokerSlots).toBe(before.jokerSlots + 1);
    expect(tagIds(game)).toEqual([]);
  });

  it('Houbaření: 2 kopie náhodné karty z balíčku i s vylepšením (deterministicky podle seedu)', () => {
    const game = newGame({ seed: 'HOUBY' });
    for (const c of game._core.state.deck) c.enhancement = 'mult';
    const size = game.state.deck.length;
    skipWith(game, 'mushroom_hunt');
    const deck = game.state.deck;
    expect(deck).toHaveLength(size + 2);
    const [a, b] = deck.slice(-2);
    expect(a).toMatchObject({ rank: b!.rank, suit: b!.suit, enhancement: 'mult' });
    expect(deck.filter((c) => c.rank === a!.rank && c.suit === a!.suit)).toHaveLength(3);
    const twin = newGame({ seed: 'HOUBY' });
    for (const c of twin._core.state.deck) c.enhancement = 'mult';
    skipWith(twin, 'mushroom_hunt');
    expect(twin.state.deck.slice(-1)[0]).toMatchObject({ rank: a!.rank, suit: a!.suit });
  });

  it('Bazar u silnice: náhodný běžný žolík; bez volného slotu +8 Kč', () => {
    const game = newGame({ money: 0 });
    skipWith(game, 'roadside_bazaar');
    expect(game.state.jokers).toHaveLength(1);
    expect(reg.jokers[game.state.jokers[0]!.defId]!.rarity).toBe('common');
    expect(game.state.money).toBe(0);

    const full = newGame({ money: 0, jokers: ['noop', 'noop', 'noop', 'noop', 'noop'] });
    skipWith(full, 'roadside_bazaar');
    expect(full.state.jokers).toHaveLength(5);
    expect(full.state.money).toBe(8);
    expect(tagIds(full)).toEqual([]);
  });

  it('Předpověď počasí: +2 úrovně nejčastěji hrané kombinace, při shodě silnější, bez rukou Vysoká karta', () => {
    const game = newGame();
    const hl = game._core.state.handLevels;
    hl.pair.played = 3;
    hl.flush.played = 3;
    hl.high_card.played = 2;
    expect(forecastHand(game.state)).toBe('flush');
    skipWith(game, 'forecast');
    expect(game.state.handLevels.flush.level).toBe(3);
    expect(game.state.handLevels.pair.level).toBe(1);
    expect(tagIds(game)).toEqual([]);

    const fresh = newGame();
    expect(HAND_TYPES.every((h) => fresh.state.handLevels[h].played === 0)).toBe(true);
    skipWith(fresh, 'forecast');
    expect(fresh.state.handLevels.high_card.level).toBe(3);
  });
});

// ─────────────────────────── Obálky zdarma ───────────────────────────

describe('štítky „hned“ — obálky zdarma (otevřou se hned, zavřením zpět na výběr útraty)', () => {
  const CASES: [string, string, number][] = [
    ['uncle_envelope', 'joker_jumbo', 3],
    ['grandma_parcel', 'rada_jumbo', 4],
  ];

  it.each(CASES)('%s otevře %s zdarma', (tagId, boosterId, options) => {
    const game = newGame({ money: 5 });
    const events = skipWith(game, tagId);
    expect(game.state.phase).toBe('booster');
    expect(game.state.booster).toMatchObject({ boosterId, returnTo: 'blind_select', picksLeft: 1 });
    expect(game.state.booster!.options.length).toBeLessThanOrEqual(options);
    expect(game.state.booster!.options.length).toBeGreaterThan(0);
    expect(game.state.money).toBe(5);
    expect(tagIds(game)).toEqual([]);
    expect(events.some((e) => e.type === 'boosterOpened' && e.boosterId === boosterId)).toBe(true);
    // babská a razítková obálka dobere ruku pro cíle
    const needsHand = boosterId.startsWith('rada') || boosterId.startsWith('razitko');
    expect(game.state.booster!.hand.length > 0).toBe(needsHand);
    ok(game.dispatch({ type: 'skipBooster' }));
    expect(game.state.phase).toBe('blind_select');
    expect(game.state.blindIndex).toBe(1);
    expect(game.state.flags.pendingBoosters).toBeUndefined();
  });

  it('vybraný žolík z obálky od strýce jde do slotu a hra pokračuje výběrem Velké útraty', () => {
    const game = newGame();
    skipWith(game, 'uncle_envelope');
    ok(game.dispatch({ type: 'pickBooster', index: 0 }));
    expect(game.state.jokers).toHaveLength(1);
    expect(game.state.phase).toBe('blind_select');
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.blind).toBe('big');
  });

  it('víc obálek ve frontě se otevře postupně v pořadí', () => {
    const game = newGame();
    game._core.state.flags.pendingBoosters = ['card_normal'];
    skipWith(game, 'uncle_envelope');
    expect(game.state.booster!.boosterId).toBe('card_normal');
    expect(game.state.flags.pendingBoosters).toEqual(['joker_jumbo']);
    ok(game.dispatch({ type: 'skipBooster' }));
    expect(game.state.booster!.boosterId).toBe('joker_jumbo');
    ok(game.dispatch({ type: 'skipBooster' }));
    expect(game.state.phase).toBe('blind_select');
  });

  it('štítek získaný ve Večerce otevře obálku hned a zavřením se vrátí do Večerky', () => {
    const game = newGame({ jokers: ['envelope_seller'] });
    winToShop(game);
    const uid = game.state.jokers[0]!.uid;
    ok(game.dispatch({ type: 'sellJoker', uid }));
    expect(game.state.booster).toMatchObject({ boosterId: 'joker_jumbo', returnTo: 'shop' });
    ok(game.dispatch({ type: 'skipBooster' }));
    expect(game.state.phase).toBe('shop');
  });

  it('štítek získaný uprostřed kola počká ve frontě (i přes uložení) a obálka se otevře při vstupu do Večerky', () => {
    let game = newGame({ jokers: ['envelope_seller'] });
    ok(game.dispatch({ type: 'selectBlind' }));
    ok(game.dispatch({ type: 'sellJoker', uid: game.state.jokers[0]!.uid }));
    expect(game.state.phase).toBe('round');
    expect(game.state.flags.pendingBoosters).toEqual(['joker_jumbo']);
    game = reload(game);
    game._core.state.round!.target = 0;
    ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
    expect(game.state.phase).toBe('round_end');
    ok(game.dispatch({ type: 'cashOut' }));
    expect(game.state.booster).toMatchObject({ boosterId: 'joker_jumbo', returnTo: 'shop' });
    expect(game.state.shop).not.toBeNull();
  });

  it('api.openBooster: neznámou obálku odmítne', () => {
    const game = newGame();
    expect(game._core.api.openBooster('neexistuje')).toBe(false);
    expect(game.state.flags.pendingBoosters).toBeUndefined();
  });
});

// ─────────────────────────── Příští Večerka ───────────────────────────

describe('štítky „příští Večerka“', () => {
  it('Otevřené dveře: po přeskočení Večerka není, v příští Večerce 3 přehození zdarma, pak od základní ceny', () => {
    const game = newGame({ money: 20 });
    skipWith(game, 'open_doors');
    expect(game.state.phase).toBe('blind_select');
    expect(tagIds(game)).toEqual(['open_doors']);
    winToShop(game);
    expect(tagIds(game)).toEqual([]);
    const money = game.state.money;
    expect(game.state.shop).toMatchObject({ freeRerolls: 3, rerollCost: 0 });
    for (let i = 0; i < 3; i++) ok(game.dispatch({ type: 'reroll' }));
    expect(game.state.money).toBe(money);
    expect(game.state.shop!.rerollCost).toBe(4);
    ok(game.dispatch({ type: 'reroll' }));
    expect(game.state.money).toBe(money - 4);
  });

  it('api.addFreeRerolls mimo Večerku: přehození čekají na příští Večerku', () => {
    const game = newGame();
    game._core.api.addFreeRerolls(2);
    expect(game.state.flags.freeRerolls).toBe(2);
    winToShop(game);
    expect(game.state.shop!.freeRerolls).toBe(2);
  });

  it('Vyleštěné příbory: první žolík bez edice v nabídce dostane lesklou/holo/duhovou edici bez příplatku', () => {
    const editions = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const game = newGame({ jokers: ['jokers_only'], seed: `CUTLERY${i}` });
      skipWith(game, 'polished_cutlery');
      winToShop(game);
      expect(tagIds(game)).toEqual([]);
      const items = jokerItems(game);
      const target = items.find((it) => it.noEditionSurcharge);
      expect(target, `seed ${i}`).toBeDefined();
      expect(['foil', 'holo', 'poly']).toContain(target!.joker.edition);
      editions.add(target!.joker.edition!);
      // bez příplatku = základní cena žolíka
      expect(target!.price).toBe(reg.jokers[target!.joker.defId]!.cost);
      // je to první žolík bez vlastní edice z vygenerované nabídky a nic se nepřidalo
      expect(items.filter((it) => it.extra)).toEqual([]);
      const firstBase = items.findIndex((it) => it === target || it.joker.edition === null);
      expect(items.indexOf(target!)).toBe(firstBase);
    }
    expect([...editions].sort()).toEqual(['foil', 'holo', 'poly']);
  });

  it('Vyleštěné příbory: bez žolíka v nabídce přibude žolík navíc s edicí (štítek nepropadne)', () => {
    const game = newGame({ jokers: ['no_jokers'] });
    skipWith(game, 'polished_cutlery');
    winToShop(game);
    const items = jokerItems(game);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ extra: true, noEditionSurcharge: true });
    expect(['foil', 'holo', 'poly']).toContain(items[0]!.joker.edition);
    expect(items[0]!.price).toBe(reg.jokers[items[0]!.joker.defId]!.cost);
  });

  it('Doporučení od známého: navíc vzácný žolík za poloviční cenu; přehození ho nemění', () => {
    const game = newGame({ jokers: ['no_jokers'], money: 50 });
    skipWith(game, 'referral');
    winToShop(game);
    const shop = game.state.shop!;
    expect(shop.items).toHaveLength(game.modifiers().shopCardSlots + 1);
    const extra = shop.items.find((it) => it.extra);
    expect(extra).toMatchObject({ kind: 'joker', priceMult: 0.5 });
    if (extra?.kind !== 'joker') throw new Error('chybí žolík navíc');
    expect(reg.jokers[extra.joker.defId]!.rarity).toBe('rare');
    const base = reg.jokers[extra.joker.defId]!.cost + editionPriceAdd(game._core, extra.joker.edition);
    expect(extra.price).toBe(shopPrice(game.modifiers(), base * 0.5));
    expect(extra.price).toBeLessThan(base);
    ok(game.dispatch({ type: 'reroll' }));
    expect(game.state.shop!.items).toHaveLength(game.modifiers().shopCardSlots + 1);
    expect(game.state.shop!.items.at(-1)).toEqual(extra);
    const money = game.state.money;
    ok(game.dispatch({ type: 'buy', slot: game.state.shop!.items.length - 1 }));
    expect(game.state.money).toBe(money - extra.price);
    // koupená položka navíc po přehození zmizí
    ok(game.dispatch({ type: 'reroll' }));
    expect(game.state.shop!.items.some((it) => it.extra)).toBe(false);
  });

  it('Protekce: navíc epický žolík za plnou cenu', () => {
    const game = newGame({ jokers: ['no_jokers'] });
    skipWith(game, 'connections');
    winToShop(game);
    const extra = game.state.shop!.items.find((it) => it.extra);
    if (extra?.kind !== 'joker') throw new Error('chybí žolík navíc');
    expect(reg.jokers[extra.joker.defId]!.rarity).toBe('epic');
    expect(extra.priceMult).toBeUndefined();
    const base = reg.jokers[extra.joker.defId]!.cost + editionPriceAdd(game._core, extra.joker.edition);
    expect(extra.price).toBe(base);
  });

  it('kupón přidávající slot doplní nabídku a položka navíc zůstane na konci', () => {
    const game = newGame({ jokers: ['no_jokers'], money: 100 });
    skipWith(game, 'referral');
    winToShop(game);
    const shop = game.state.shop!;
    shop.vouchers.push({ voucherId: 'second_shelf', price: 9, sold: false });
    ok(game.dispatch({ type: 'buyVoucher', slot: shop.vouchers.length - 1 }));
    const items = game.state.shop!.items;
    expect(items).toHaveLength(game.modifiers().shopCardSlots + 1);
    expect(items.filter((it) => it.extra)).toHaveLength(1);
    expect(items.at(-1)!.extra).toBe(true);
  });

  it('Leták ve schránce: v příští Večerce navíc 1 kupón (jiný než kupón patra), v další Večerce už ne', () => {
    const game = newGame({ money: 100 });
    skipWith(game, 'mailbox_flyer');
    winToShop(game);
    const vouchers = game.state.shop!.vouchers;
    expect(vouchers).toHaveLength(2);
    expect(new Set(vouchers.map((v) => v.voucherId)).size).toBe(2);
    expect(vouchers[1]).toMatchObject({ extra: true });
    expect(game.state.anteVouchers).not.toContain(vouchers[1]!.voucherId);
    ok(game.dispatch({ type: 'buyVoucher', slot: 1 }));
    expect(game.state.vouchers).toContain(vouchers[1]!.voucherId);
    ok(game.dispatch({ type: 'leaveShop' }));
    // šéf → další Večerka má jen kupón nového patra
    winToShop(game);
    expect(game.state.shop!.vouchers).toHaveLength(1);
  });
});

// ─────────────────────────── Kolo a šéf ───────────────────────────

describe('štítky kola a šéfa', () => {
  it('Šéf má chřipku: cíl šéfa −25 % (už v náhledu výběru útrat), Malá a Velká beze změny; spotřebuje se v kole šéfa', () => {
    const game = newGame();
    const bossId = game.state.blinds[2]!.bossId;
    const curve = game.targetCurve();
    const boss = bossId ? reg.bosses[bossId] : undefined;
    const full = game.blindTarget('boss', bossId);
    const big = game.blindTarget('big');
    skipWith(game, 'boss_flu');
    const reduced = blindTarget(1, 'boss', curve, { bossMult: boss?.targetMult, targetMult: 0.75 });
    expect(reduced).toBeLessThan(full);
    expect(game.blindTarget('boss', bossId)).toBe(reduced);
    expect(game.blindTarget('big')).toBe(big);
    winToShop(game);
    expect(tagIds(game)).toEqual(['boss_flu']);
    ok(game.dispatch({ type: 'leaveShop' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.target).toBe(reduced);
    expect(tagIds(game)).toEqual([]);
    expect(game.blindTarget('boss', bossId)).toBe(full);
  });

  it('Šéf má chřipku dvakrát: cíl šéfa × 0,75 × 0,75', () => {
    const game = newGame();
    const bossId = game.state.blinds[2]!.bossId;
    const boss = bossId ? reg.bosses[bossId] : undefined;
    skipWith(game, 'boss_flu');
    skipWith(game, 'boss_flu');
    ok(game.dispatch({ type: 'selectBlind' }));
    const expected = blindTarget(1, 'boss', game.targetCurve(), {
      bossMult: boss?.targetMult,
      targetMult: 0.75 * 0.75,
    });
    expect(game.state.round!.target).toBe(expected);
    expect(tagIds(game)).toEqual([]);
  });

  it('Rozložené noviny: v příštím kole +2 karty v ruce a +1 zahození, v dalším kole zase normálně', () => {
    const game = newGame();
    skipWith(game, 'spread_newspaper');
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.hand).toHaveLength(10);
    expect(game.state.round!.discardsLeft).toBe(4);
    expect(tagIds(game)).toEqual([]);
    game._core.state.round!.target = 0;
    ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'leaveShop' }));
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.hand).toHaveLength(8);
    expect(game.state.round!.discardsLeft).toBe(3);
  });

  describe('Lékařské potvrzení', () => {
    /** Skóre zahrané Dvojky ♥ jako Vysoké karty: 6 čipů kombinace + 2 čipy karty, mult 1. */
    const SCORE = 8;

    /** Kolo Velké útraty se štítkem: poslední ruka (Dvojka ♥), cíl `target`. Vrátí výsledek zahrání. */
    function lastHand(target: number, opts: { reload?: boolean } = {}) {
      let game = newGame();
      skipWith(game, 'sick_note');
      const two = setupRound(game, '2H 7C 9D 4S JC QD 3H 5S')[0]!;
      const round = game._core.state.round!;
      round.handsLeft = 1;
      round.target = target;
      if (opts.reload) game = reload(game);
      const res = game.dispatch({ type: 'play', cardIds: [two.id] });
      const played = ok(res).find((e) => e.type === 'handPlayed');
      expect(played?.type === 'handPlayed' ? played.result.score : null).toBe(SCORE);
      return { game, res };
    }

    it('přesně 50 % cíle: kolo se počítá jako vyhrané, bez odměny za útratu, štítek se spotřebuje', () => {
      const { game, res } = lastHand(SCORE * 2);
      expect(game.state.phase).toBe('round_end');
      expect(game.state.rewards!.blindReward).toBe(0);
      expect(tagIds(game)).toEqual([]);
      expect(ok(res).some((e) => e.type === 'message' && e.key === 'tag.saved')).toBe(true);
    });

    it('těsně pod 50 %: konec runu', () => {
      const { game } = lastHand(SCORE * 2 + 1);
      expect(game.state.phase).toBe('game_over');
    });

    it('platí i po uložení a načtení uprostřed kola', () => {
      const { game } = lastHand(SCORE * 2, { reload: true });
      expect(game.state.phase).toBe('round_end');
    });

    it('kolo vyhrané normálně: štítek „příštího kola“ propadne', () => {
      const game = newGame();
      skipWith(game, 'sick_note');
      winCurrent(game);
      expect(game.state.rewards!.blindReward).toBe(4);
      expect(tagIds(game)).toEqual([]);
    });

    it('štítek získaný uprostřed kola platí až od dalšího kola', () => {
      const game = newGame({ jokers: ['sick_seller'] });
      ok(game.dispatch({ type: 'selectBlind' }));
      ok(game.dispatch({ type: 'sellJoker', uid: game.state.jokers[0]!.uid }));
      expect(tagIds(game)).toEqual(['sick_note']);
      const round = game._core.state.round!;
      round.handsLeft = 1;
      round.target = 1e9;
      round.score = 1e9 / 2;
      ok(game.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
      expect(game.state.phase).toBe('game_over');
    });
  });
});

// ─────────────────────────── Engine: rozhraní pro štítky ───────────────────────────

describe('EngineApi a hooky pro štítky (docs/ARCHITECTURE.md 2.7)', () => {
  it('úpravy Večerky mimo Večerku nic nedělají', () => {
    const game = newGame();
    const api = game._core.api;
    expect(api.addShopJoker({ rarity: 'rare' })).toBe(false);
    expect(api.setShopJokerEdition('foil')).toBe(false);
    expect(api.addShopVoucher()).toBeNull();
    expect(game.state.shop).toBeNull();
  });

  it('neznámá edice je chyba obsahu', () => {
    const game = newGame({ jokers: ['jokers_only'] });
    winToShop(game);
    expect(() => game._core.api.setShopJokerEdition('plaid' as never)).toThrow();
    expect(() => game._core.api.addShopJoker({ edition: 'plaid' as never })).toThrow();
  });

  it('kupón navíc: když už žádný koupit nejde, nic nepřibude', () => {
    const game = newGame({ money: 100 });
    winToShop(game);
    game._core.state.vouchers = Object.keys(reg.vouchers);
    const before = game.state.shop!.vouchers.length;
    expect(game._core.api.addShopVoucher()).toBeNull();
    expect(game.state.shop!.vouchers).toHaveLength(before);
  });

  it('neznámá obálka ve frontě (starší uložení) se zahodí a otevře se další', () => {
    const game = newGame();
    game._core.state.flags.pendingBoosters = ['zmizela', 'joker_normal'];
    skipWith(game, 'coat_change');
    expect(game.state.booster?.boosterId).toBe('joker_normal');
    expect(game.state.flags.pendingBoosters).toBeUndefined();
  });

  it('roundEndMoney: neplatná částka (NaN) se do rozpisu nedostane; onRoundEnd štítku běží až po rozpisu', () => {
    const order: string[] = [];
    const custom = makeRegistry({
      tags: [
        {
          id: 'nan_money',
          hooks: {
            roundEndMoney: () => {
              order.push('money');
              return Number.NaN;
            },
            onRoundEnd: () => {
              order.push('end');
              return true;
            },
          },
          art: { icon: 'coins', bg: '#000000', fg: '#ffffff' },
        },
      ],
    });
    const game = makeGame({ registry: custom });
    game._core.api.addTag('nan_money');
    winCurrent(game);
    expect(game.state.rewards!.extra.some((e) => e.source.startsWith('tag:'))).toBe(false);
    expect(order).toEqual(['money', 'end']);
    expect(game.state.tags).toEqual([]);
  });
});
