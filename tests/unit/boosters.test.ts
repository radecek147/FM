/**
 * Obálky (docs/DESIGN.md kap. 2.9): 15 definic podle tabulky, texty, otevření přes skutečný engine (počty možností
 * a výběrů, žádné opakování, dobraná ruka u babských a razítkových obálek), výběr žolíka / karty / spotřebky
 * (použít hned, nebo nechat do slotu), přeskočení, zaručená Žolíková obálka v první Večerce, složení karetní obálky
 * podle startovního balíčku a váhy v obchodě.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { BOOSTER_COSTS, BOOSTER_TABLE, BOOSTERS, boosterId } from '../../src/content/boosters';
import { DECKS } from '../../src/content/decks';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import { RADY } from '../../src/content/rady';
import type { BoosterDef, ContentRegistry } from '../../src/engine/content-types';
import { newCore } from './engine-fixtures';
import { generateShopBoosters } from '../../src/engine/shop/shop';
import { boosterPrice } from '../../src/engine/shop/prices';
import type { Game } from '../../src/engine/run/game';
import type { BoosterOption } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { addJokers, consumable, makeGame, makeRegistry, winNextHand } from './fixtures/registry';

/** Testovací razítka (aby šla otestovat i Krabice od bot s 5 možnostmi nezávisle na skutečných razítkách). */
const STAMPS = ['stamp_a', 'stamp_b', 'stamp_c', 'stamp_d', 'stamp_e', 'stamp_f'].map((id) =>
  consumable(id, { kind: 'razitko', cost: 6 }),
);

/**
 * Registr pro obálky: testovací obsah (pranostiky `pr_<kombinace>`, šéfové, obtížnost) + skuteční žolíci,
 * startovní balíčky, babské rady a obálky. Testovací obálky z fixtures se nahradí skutečnými.
 */
function boosterRegistry(): ContentRegistry {
  const base = makeRegistry({ jokers: JOKERS, decks: DECKS, consumables: [...RADY, ...STAMPS] });
  return { ...base, boosters: Object.fromEntries(BOOSTERS.map((b) => [b.id, b])) };
}
const reg = boosterRegistry();

function boosterDef(id: string): BoosterDef {
  const d = BOOSTERS.find((b) => b.id === id);
  if (!d) throw new Error(`Chybí obálka ${id}`);
  return d;
}

/** Otevře obálku přímo (jako štítek na výběru útraty). */
function open(game: Game, id: string): NonNullable<Game['state']['booster']> {
  game.startBooster(id, 'blind_select');
  const b = game.state.booster;
  if (!b) throw new Error('obálka se neotevřela');
  return b;
}

function optionId(opt: BoosterOption): string {
  if (opt.kind === 'joker') return opt.joker.defId;
  if (opt.kind === 'consumable') return opt.consumable.defId;
  return `card:${opt.card.id}`;
}

describe('obálky – definice (DESIGN 2.9)', () => {
  it('15 obálek: 5 druhů × 3 velikosti s čísly z tabulky', () => {
    // [možností, vybereš, cena, váha]
    const table: Record<string, [number, number, number, number]> = {
      pranostika_normal: [3, 1, 4, 5],
      pranostika_jumbo: [4, 1, 7, 2.5],
      pranostika_mega: [6, 2, 10, 0.6],
      rada_normal: [3, 1, 4, 5],
      rada_jumbo: [4, 1, 7, 2.5],
      rada_mega: [6, 2, 10, 0.6],
      razitko_normal: [2, 1, 4, 1],
      razitko_jumbo: [3, 1, 7, 0.5],
      razitko_mega: [5, 2, 10, 0.1],
      joker_normal: [2, 1, 4, 1.5],
      joker_jumbo: [3, 1, 7, 0.7],
      joker_mega: [5, 2, 10, 0.2],
      card_normal: [3, 1, 4, 3.5],
      card_jumbo: [4, 1, 7, 1.5],
      card_mega: [6, 2, 10, 0.4],
    };
    expect(BOOSTERS.map((b) => b.id).sort()).toEqual(Object.keys(table).sort());
    for (const b of BOOSTERS) {
      expect([b.options, b.picks, b.cost, b.weight], b.id).toEqual(table[b.id]);
      expect(b.id).toBe(boosterId(b.kind, b.size));
      expect(b.id).toBe(`${b.kind}_${b.size}`);
    }
    expect(BOOSTER_COSTS).toEqual({ normal: 4, jumbo: 7, mega: 10 });
    expect(Object.keys(BOOSTER_TABLE).sort()).toEqual(['card', 'joker', 'pranostika', 'rada', 'razitko']);
  });

  it('součet vah 25,6 – normální 16 : tlusté 7,7 : krabice 1,9', () => {
    const sum = (f: (b: BoosterDef) => boolean) =>
      Math.round(BOOSTERS.filter(f).reduce((a, b) => a + b.weight, 0) * 100) / 100;
    expect(sum(() => true)).toBe(25.6);
    expect([
      sum((b) => b.size === 'normal'),
      sum((b) => b.size === 'jumbo'),
      sum((b) => b.size === 'mega'),
    ]).toEqual([16, 7.7, 1.9]);
    // druhy: pranostiky a babské rady po ≈ 32 %, karty ≈ 21 %, žolíci ≈ 9 %, razítka ≈ 6 %
    const share = (k: string) => sum((b) => b.kind === k) / 25.6;
    expect(share('pranostika')).toBeCloseTo(0.32, 2);
    expect(share('rada')).toBeCloseTo(0.32, 2);
    expect(share('card')).toBeCloseTo(0.21, 2);
    expect(share('joker')).toBeCloseTo(0.094, 2);
    expect(share('razitko')).toBeCloseTo(0.0625, 2);
  });

  it('skutečný registr obsahuje všech 15 obálek', () => {
    expect(Object.keys(buildRegistry().boosters).sort()).toEqual(BOOSTERS.map((b) => b.id).sort());
  });

  it('texty: název „Velikost · Druh“, popis s {picks} a {options} bez zbytků', () => {
    const sizes = { normal: 'Obálka', jumbo: 'Tlustá obálka', mega: 'Krabice od bot' };
    const kinds = {
      pranostika: 'Pranostiky',
      rada: 'Babské rady',
      razitko: 'Razítka',
      joker: 'Žolíci',
      card: 'Hrací karty',
    };
    for (const b of BOOSTERS) {
      expect(hasKey(`boosters.${b.id}.name`), b.id).toBe(true);
      expect(hasKey(`boosters.${b.id}.desc`), b.id).toBe(true);
      expect(t(`boosters.${b.id}.name`)).toBe(`${sizes[b.size]} · ${kinds[b.kind]}`);
      const desc = t(`boosters.${b.id}.desc`, { picks: b.picks, options: b.options });
      expect(desc, b.id).not.toMatch(/[{}]/);
      // „Nabídne N …, vybereš M.“ — bez „1 z 3“ (správně „ze 3“); tvar slova podle počtu.
      expect(desc, b.id).toMatch(new RegExp(`^Nabídne ${b.options}\u00a0\\S.*, vybereš ${b.picks}\\.`));
    }
    expect(t('boosters.rada_mega.desc', { picks: 2, options: 6 })).toMatch(
      /^Nabídne 6\u00a0babských rad, vybereš 2\./,
    );
    expect(t('boosters.razitko_normal.desc', { picks: 1, options: 2 })).toMatch(
      /^Nabídne 2\u00a0úřední razítka, vybereš 1\./,
    );
    expect(t('boosters.joker_mega.desc', { picks: 2, options: 5 })).toMatch(
      /^Nabídne 5\u00a0žolíků, vybereš 2\./,
    );
  });

  it('ikony z ICON_NAMES; velikosti se liší vzorem, druhy ikonou', () => {
    for (const b of BOOSTERS) {
      expect(isIconName(b.art.icon), b.id).toBe(true);
      if (b.art.prop) expect(isIconName(b.art.prop), `${b.id} prop`).toBe(true);
    }
    expect(new Set(BOOSTERS.map((b) => `${b.art.icon}|${b.art.pattern}`)).size).toBe(15);
  });

  it('cena ve Večerce = 4 / 7 / 10 Kč (bez slev)', () => {
    const core = newCore(reg);
    for (const b of BOOSTERS) expect(boosterPrice(core, b.id), b.id).toBe(BOOSTER_COSTS[b.size]);
  });
});

describe('obálky – otevření', () => {
  it.each(BOOSTERS.map((b) => [b.id]))('%s: počet možností a výběrů, bez opakování', (id) => {
    const def = boosterDef(id);
    for (let i = 0; i < 8; i++) {
      const game = makeGame({ registry: reg, deckId: 'pub', seed: `OPEN${i}` });
      const b = open(game, id);
      expect(game.state.phase).toBe('booster');
      expect(b.options, id).toHaveLength(def.options);
      expect(b.picksLeft).toBe(def.picks);
      const kind = def.kind === 'joker' || def.kind === 'card' ? def.kind : 'consumable';
      expect(b.options.every((o) => o.kind === kind)).toBe(true);
      if (kind === 'consumable') {
        expect(b.options.every((o) => o.kind === 'consumable' && o.consumableKind === def.kind)).toBe(true);
      }
      const ids = b.options.map(optionId).filter((x) => x !== 'beer_mat'); // Pivní tácek se smí opakovat
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it('babská a razítková obálka dobere ruku (velikost ruky) z balíčku, ostatní ne', () => {
    for (const b of BOOSTERS) {
      const game = makeGame({ registry: reg, deckId: 'pub' });
      const state = open(game, b.id);
      if (b.kind === 'rada' || b.kind === 'razitko') {
        expect(state.hand, b.id).toHaveLength(game.modifiers().handSize);
        expect(new Set(state.hand).size).toBe(state.hand.length);
        for (const cid of state.hand) expect(game.state.deck.some((c) => c.id === cid)).toBe(true);
      } else {
        expect(state.hand, b.id).toEqual([]);
      }
    }
  });

  it('pranostiky tajných kombinací se nabízejí až po objevu', () => {
    const secret = ['pr_five', 'pr_flush_house', 'pr_flush_five'];
    for (let i = 0; i < 30; i++) {
      const game = makeGame({ registry: reg, seed: `SECRET${i}` });
      const ids = open(game, 'pranostika_mega').options.map(optionId);
      expect(ids.some((x) => secret.includes(x))).toBe(false);
    }
    let seen = false;
    for (let i = 0; i < 30 && !seen; i++) {
      const game = makeGame({ registry: reg, seed: `FOUND${i}` });
      game._core.state.discoveredHands.push('five');
      seen = open(game, 'pranostika_mega').options.map(optionId).includes('pr_five');
    }
    expect(seen).toBe(true);
  });

  it('spotřebka s váhou 0 se v obálce neobjeví', () => {
    const zero: ContentRegistry = {
      ...reg,
      consumables: { ...reg.consumables, stamp_a: { ...reg.consumables.stamp_a!, weight: 0 } },
    };
    for (let i = 0; i < 20; i++) {
      const game = makeGame({ registry: zero, seed: `ZERO${i}` });
      expect(open(game, 'razitko_mega').options.map(optionId)).not.toContain('stamp_a');
    }
  });
});

describe('obálky – výběr', () => {
  it('žolík jde do slotu, normální obálka se po výběru zavře a vrátí na původní obrazovku', () => {
    const game = makeGame({ registry: reg });
    const b = open(game, 'joker_normal');
    const picked = b.options[0]!;
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.jokers.map((j) => j.uid)).toEqual([picked.kind === 'joker' ? picked.joker.uid : -1]);
    expect(game.state.booster).toBeNull();
    expect(game.state.phase).toBe('blind_select');
  });

  it('Krabice od bot: vybereš 2, pak se zavře', () => {
    const game = makeGame({ registry: reg });
    open(game, 'joker_mega');
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.booster?.picksLeft).toBe(1);
    expect(game.state.booster?.options).toHaveLength(4);
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.booster).toBeNull();
    expect(game.state.jokers).toHaveLength(2);
  });

  it('bez volného slotu žolíka vybrat nejde (negativní ano)', () => {
    const game = makeGame({ registry: reg });
    addJokers(game, ['noop', 'noop', 'noop', 'noop', 'noop']);
    open(game, 'joker_normal');
    expect(game.dispatch({ type: 'pickBooster', index: 0 })).toEqual({ ok: false, error: 'slotsFull' });
    // Neplatná akce vrací stav ze zálohy — instanci možnosti je potřeba vzít znovu.
    const opt = game._core.state.booster!.options[0]!;
    if (opt.kind === 'joker') opt.joker.edition = 'negative';
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.jokers).toHaveLength(6);
  });

  it('hrací karta se přidá do balíčku se všemi úpravami', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    const deck = game.state.deck.length;
    const b = open(game, 'card_normal');
    const opt = b.options[1]!;
    if (opt.kind !== 'card') throw new Error('čekal jsem kartu');
    expect(game.dispatch({ type: 'pickBooster', index: 1 }).ok).toBe(true);
    expect(game.state.deck).toHaveLength(deck + 1);
    const added = game.state.deck.at(-1)!;
    expect(added).toMatchObject({
      suit: opt.card.suit,
      rank: opt.card.rank,
      enhancement: opt.card.enhancement,
      seal: opt.card.seal,
      edition: opt.card.edition,
    });
  });

  it('pranostika: použít hned zvýší úroveň, „nechat“ ji uloží do slotu', () => {
    const game = makeGame({ registry: reg });
    open(game, 'pranostika_mega');
    const first = game.state.booster!.options[0]!;
    if (first.kind !== 'consumable') throw new Error('čekal jsem spotřebku');
    const hand = game.registry.consumables[first.consumable.defId]!.hand!;
    const level = game.state.handLevels[hand].level;
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.handLevels[hand].level).toBe(level + 1);
    expect(game.state.lastConsumable).toBe(first.consumable.defId);
    const second = game.state.booster!.options[0]!;
    expect(game.dispatch({ type: 'pickBooster', index: 0, keep: true }).ok).toBe(true);
    expect(game.state.consumables.map((c) => c.uid)).toEqual([
      second.kind === 'consumable' ? second.consumable.uid : -1,
    ]);
    expect(game.state.booster).toBeNull();
  });

  it('„nechat“ bez volného slotu spotřebky nejde, použít ano', () => {
    const game = makeGame({ registry: reg });
    for (const id of ['rada_a', 'rada_b']) {
      expect(game.ctx().api.createConsumable({ defId: id })).not.toBeNull();
    }
    open(game, 'pranostika_normal');
    expect(game.dispatch({ type: 'pickBooster', index: 0, keep: true })).toEqual({
      ok: false,
      error: 'slotsFull',
    });
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
  });

  it('babská rada z obálky se použije na kartu z dobrané ruky; karty zůstanou v balíčku', () => {
    for (let i = 0; i < 40; i++) {
      const game = makeGame({ registry: reg, deckId: 'pub', seed: `RADA${i}` });
      const b = open(game, 'rada_mega');
      const idx = b.options.findIndex((o) => o.kind === 'consumable' && o.consumable.defId === 'chamomile');
      if (idx < 0) continue;
      const deck = game.state.deck.length;
      const [c1, c2] = b.hand;
      // karta mimo dobranou ruku cílem být nesmí
      const outside = game.state.deck.find((c) => !b.hand.includes(c.id))!;
      expect(game.dispatch({ type: 'pickBooster', index: idx, targetIds: [outside.id] })).toEqual({
        ok: false,
        error: 'cannotUse',
      });
      expect(game.dispatch({ type: 'pickBooster', index: idx, targetIds: [c1!, c2!] }).ok).toBe(true);
      expect(game._core.mustCard(c1!).enhancement).toBe('bonus');
      expect(game._core.mustCard(c2!).enhancement).toBe('bonus');
      expect(game.state.booster?.picksLeft).toBe(1);
      game.dispatch({ type: 'skipBooster' });
      expect(game.state.booster).toBeNull();
      expect(game.state.deck).toHaveLength(deck);
      return;
    }
    throw new Error('Heřmánkový čaj se v obálkách neobjevil');
  });

  it('rada bez cíle jde z obálky použít i nechat; Generální úklid zničí kartu z dobrané ruky', () => {
    for (let i = 0; i < 60; i++) {
      const game = makeGame({ registry: reg, deckId: 'pub', seed: `CLEAN${i}` });
      const b = open(game, 'rada_mega');
      const idx = b.options.findIndex(
        (o) => o.kind === 'consumable' && o.consumable.defId === 'spring_cleaning',
      );
      if (idx < 0) continue;
      const victim = b.hand[0]!;
      const deck = game.state.deck.length;
      expect(game.dispatch({ type: 'pickBooster', index: idx, targetIds: [victim] }).ok).toBe(true);
      expect(game.state.deck).toHaveLength(deck - 1);
      expect(game.state.booster?.hand).not.toContain(victim);
      return;
    }
    throw new Error('Generální úklid se v obálkách neobjevil');
  });

  it('razítková obálka nabízí razítka a jde přeskočit bez výběru', () => {
    const game = makeGame({ registry: reg });
    const money = game.state.money;
    const b = open(game, 'razitko_jumbo');
    expect(b.options.map(optionId).every((id) => id.startsWith('stamp'))).toBe(true);
    expect(game.dispatch({ type: 'skipBooster' }).ok).toBe(true);
    expect(game.state.booster).toBeNull();
    expect(game.state.phase).toBe('blind_select');
    expect(game.state.money).toBe(money);
    expect(game.state.consumables).toHaveLength(0);
  });

  it('nákup ve Večerce stojí cenu obálky a otevře ji', () => {
    const game = makeGame({ registry: reg, round: true, money: 20 });
    winNextHand(game);
    game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] });
    game.dispatch({ type: 'cashOut' });
    expect(game.state.phase).toBe('shop');
    const shop = game._core.state.shop!;
    shop.boosters = [{ boosterId: 'card_jumbo', price: boosterPrice(game._core, 'card_jumbo'), sold: false }];
    const money = game.state.money;
    expect(game.dispatch({ type: 'buyBooster', slot: 0 }).ok).toBe(true);
    expect(game.state.money).toBe(money - 7);
    expect(game.state.booster?.boosterId).toBe('card_jumbo');
    expect(game.state.booster?.options).toHaveLength(4);
    game.dispatch({ type: 'skipBooster' });
    expect(game.state.phase).toBe('shop');
  });
});

describe('obálky ve Večerce', () => {
  it('první Večerka runu má v prvním slotu normální Žolíkovou obálku (skutečný obsah)', () => {
    const real = buildRegistry();
    for (let i = 0; i < 5; i++) {
      const game = makeGame({ registry: real, deckId: 'pub', seed: `FIRST${i}`, round: true });
      winNextHand(game);
      game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] });
      game.dispatch({ type: 'cashOut' });
      expect(game.state.phase).toBe('shop');
      expect(game.state.shop!.boosters[0]!.boosterId).toBe('joker_normal');
      expect(game.state.shop!.boosters).toHaveLength(2);
    }
  });

  it('losování obálek odpovídá vahám: normální ≈ 63 %, tlustá ≈ 30 %, krabice ≈ 7 %', () => {
    const core = newCore(reg);
    const counts = { normal: 0, jumbo: 0, mega: 0 };
    let total = 0;
    for (let i = 0; i < 3000; i++) {
      for (const b of generateShopBoosters(core)) {
        counts[reg.boosters[b.boosterId]!.size]++;
        total++;
      }
    }
    expect(counts.normal / total).toBeCloseTo(16 / 25.6, 1);
    expect(counts.jumbo / total).toBeCloseTo(7.7 / 25.6, 1);
    expect(counts.mega / total).toBeCloseTo(1.9 / 25.6, 1);
  });
});

describe('karetní obálka bere složení startovního balíčku', () => {
  function cardsFrom(deckId: string, n = 15): BoosterOption[] {
    const game = makeGame({ registry: reg, deckId, seed: `DECK${deckId}` });
    const out: BoosterOption[] = [];
    for (let i = 0; i < n; i++) {
      out.push(...open(game, 'card_mega').options);
      game.dispatch({ type: 'skipBooster' });
    }
    return out;
  }
  const ranks = (opts: BoosterOption[]) => opts.map((o) => (o.kind === 'card' ? o.card.rank : 0));

  it('Mariášový jen 7–A', () => {
    const r = ranks(cardsFrom('marias'));
    expect(r).toHaveLength(90);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(7);
  });

  it('Obrázkový jen J–A', () => {
    expect(Math.min(...ranks(cardsFrom('court')))).toBeGreaterThanOrEqual(11);
  });

  it('Hospodský (52 karet) nabízí i nízké hodnoty a všechny barvy', () => {
    const opts = cardsFrom('pub');
    expect(Math.min(...ranks(opts))).toBeLessThan(7);
    expect(new Set(opts.map((o) => (o.kind === 'card' ? o.card.suit : '')))).toEqual(
      new Set(['S', 'H', 'D', 'C']),
    );
  });

  it('vylepšení ≈ 35 %, pečeť ≈ 15 %', () => {
    const opts = cardsFrom('pub', 200);
    const share = (f: (o: BoosterOption) => boolean) => opts.filter(f).length / opts.length;
    expect(share((o) => o.kind === 'card' && o.card.enhancement !== null)).toBeCloseTo(0.35, 1);
    expect(share((o) => o.kind === 'card' && o.card.seal !== null)).toBeCloseTo(0.15, 1);
  });
});
