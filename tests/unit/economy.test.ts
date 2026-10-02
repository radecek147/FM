/**
 * Ekonomika Večerky — docs/DESIGN.md kap. 2.5 (ceny, prodej, nabídka), 2.6 (edice), 2.9 (obálky), 4.6 (nálepky).
 */
import { describe, expect, it } from 'vitest';
import type { CardSpec, Rng } from '../../src/engine/content-types';
import {
  BOOSTER_CARD_ENHANCE_CHANCE,
  FALLBACK_JOKER_ID,
  PERISH_ROUNDS,
  RENTAL_BUY_PRICE,
} from '../../src/engine/constants';
import { newJokerInstance } from '../../src/engine/effects/api';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { cyrb128, rngFromState } from '../../src/engine/rng/rng';
import { pickConsumableDefId, pickJokerDefId, rollEdition } from '../../src/engine/shop/pool';
import {
  boosterPrice,
  cardPrice,
  consumablePrice,
  consumableSellValue,
  jokerPrice,
  jokerSellValue,
  refreshShopPrices,
  rerollPrice,
  roundHalfUp,
  shopPrice,
  voucherPrice,
} from '../../src/engine/shop/prices';
import {
  generateBoosterOptions,
  generateShop,
  randomPlayingCard,
  rollStickers,
} from '../../src/engine/shop/shop';
import type { Card, ShopItem } from '../../src/engine/types';
import { ART, booster, consumable, joker, makeRegistry, newCore, newGame } from './engine-fixtures';

const mods = (extra: Partial<typeof BASE_MODIFIERS> = {}) => ({ ...BASE_MODIFIERS, ...extra });

/** Rng, které vrací předem dané hodnoty `next()` (pro přesné testy prahů). */
function scripted(values: number[]): Rng {
  const real = rngFromState(cyrb128('scripted'));
  let i = 0;
  return { ...real, next: () => values[i++] ?? 0.999999 };
}

describe('shopPrice (DESIGN 2.5.2)', () => {
  it('bez slevy a příplatku = základ', () => {
    expect(shopPrice(mods(), 5)).toBe(5);
  });

  it('sleva se zaokrouhluje polovinou nahoru', () => {
    expect(shopPrice(mods({ shopDiscountPct: 20 }), 5)).toBe(4);
    expect(shopPrice(mods({ shopDiscountPct: 25 }), 6)).toBe(5); // 4,5 → 5
    expect(shopPrice(mods({ shopDiscountPct: 50 }), 3)).toBe(2); // 1,5 → 2
    expect(shopPrice(mods({ shopDiscountPct: 40 }), 7)).toBe(4); // 4,2 → 4
    expect(shopPrice(mods({ shopDiscountPct: 40 }), 9)).toBe(5); // 5,4 → 5
    expect(shopPrice(mods({ shopDiscountPct: 20 }), 13)).toBe(10); // 10,4 → 10
  });

  it('cena po slevě je nejméně 1 Kč', () => {
    expect(shopPrice(mods({ shopDiscountPct: 50 }), 1)).toBe(1); // 0,5 → 1
    expect(shopPrice(mods({ shopDiscountPct: 100 }), 10)).toBe(1);
  });

  it('shopPriceAdd se přičte až po slevě a minimu', () => {
    expect(shopPrice(mods({ shopPriceAdd: 1 }), 5)).toBe(6);
    expect(shopPrice(mods({ shopPriceAdd: 1, shopDiscountPct: 100 }), 10)).toBe(2);
    expect(shopPrice(mods({ shopPriceAdd: 1, shopDiscountPct: 20 }), 5)).toBe(5);
  });

  it('zdarma = 0 i se shopPriceAdd (a nulový základ je zdarma)', () => {
    expect(shopPrice(mods({ shopPriceAdd: 1 }), 8, true)).toBe(0);
    expect(shopPrice(mods({ shopPriceAdd: 1 }), 0)).toBe(0);
  });

  it('roundHalfUp', () => {
    expect([0.5, 1.5, 2.4999, 2.5, 4.2, 10].map(roundHalfUp)).toEqual([1, 2, 2, 3, 4, 10]);
  });
});

describe('rerollPrice', () => {
  it('4 Kč a každé další placené přehození v téže Večerce +1 Kč', () => {
    expect([0, 1, 2, 3].map((n) => rerollPrice(mods(), n))).toEqual([4, 5, 6, 7]);
  });

  it('sleva přehození nezlevňuje, shopPriceAdd ano', () => {
    expect(rerollPrice(mods({ shopDiscountPct: 40 }), 0)).toBe(4);
    expect(rerollPrice(mods({ shopPriceAdd: 1 }), 2)).toBe(7);
  });

  it('kupóny: základ −1 (Kamarád za pultem), krok 0 (Švagr vedoucí)', () => {
    expect(rerollPrice(mods({ rerollBaseCost: 3 }), 0)).toBe(3);
    expect([0, 1, 5].map((n) => rerollPrice(mods({ rerollCostStep: 0 }), n))).toEqual([4, 4, 4]);
  });
});

describe('ceny položek ve Večerce', () => {
  const reg = makeRegistry({
    jokers: [joker('cheap', { cost: 5 }), joker('pricey', { cost: 7 }), joker('mid', { cost: 4 })],
    consumables: [
      consumable('omen', { kind: 'pranostika', cost: 3, hand: 'pair' }),
      consumable('advice', { kind: 'rada', cost: 4 }),
      consumable('stamp', { kind: 'razitko', cost: 6 }),
    ],
    boosters: [booster('jumbo', { cost: 7 })],
    vouchers: [{ id: 'v', tier: 1, cost: 10, art: ART }],
  });

  it('žolík = cena + příplatek za edici; zapůjčený stojí RENTAL_BUY_PRICE', () => {
    const core = newCore(reg);
    expect(jokerPrice(core, newJokerInstance(core, 'cheap'))).toBe(5);
    expect(jokerPrice(core, newJokerInstance(core, 'cheap', 'foil'))).toBe(6);
    expect(jokerPrice(core, newJokerInstance(core, 'cheap', 'negative'))).toBe(11);
    expect(jokerPrice(core, newJokerInstance(core, 'pricey', 'poly', ['rental']))).toBe(RENTAL_BUY_PRICE);
    expect(jokerPrice(core, newJokerInstance(core, 'cheap'), true)).toBe(0);
  });

  it('spotřebky 3 / 4 / 6 Kč, obálka a kupón podle definice', () => {
    const core = newCore(reg);
    expect(consumablePrice(core, { defId: 'omen', edition: null })).toBe(3);
    expect(consumablePrice(core, { defId: 'advice', edition: null })).toBe(4);
    expect(consumablePrice(core, { defId: 'stamp', edition: 'negative' })).toBe(12);
    expect(boosterPrice(core, 'jumbo')).toBe(7);
    expect(voucherPrice(core, 'v')).toBe(10);
  });

  it('hrací karta 2 Kč + vylepšení 1 + pečeť 2 + edice', () => {
    const core = newCore(reg);
    const c = (extra: Partial<Card>): Card => ({
      id: 1,
      suit: 'H',
      rank: 5,
      enhancement: null,
      seal: null,
      edition: null,
      bonusChips: 0,
      debuffed: false,
      faceDown: false,
      ...extra,
    });
    expect(cardPrice(core, c({}))).toBe(2);
    expect(cardPrice(core, c({ enhancement: 'glass' }))).toBe(3);
    expect(cardPrice(core, c({ seal: 'red' }))).toBe(4);
    expect(cardPrice(core, c({ enhancement: 'bonus', seal: 'gold', edition: 'poly' }))).toBe(9);
  });

  it('sleva a Jedenáctka (shopPriceAdd) platí na všechno', () => {
    const core = newCore(reg);
    core.api.addPermanentModifier({ shopDiscountPct: 20, shopPriceAdd: 1 });
    expect(jokerPrice(core, newJokerInstance(core, 'pricey'))).toBe(7); // round(5,6)=6, +1
    expect(consumablePrice(core, { defId: 'omen', edition: null })).toBe(3); // round(2,4)=2, +1
    expect(boosterPrice(core, 'jumbo')).toBe(7); // round(5,6)=6, +1
    expect(voucherPrice(core, 'v')).toBe(9);
    expect(jokerPrice(core, newJokerInstance(core, 'mid', null, ['rental']))).toBe(3); // round(1,6)=2, +1
  });
});

describe('prodejní ceny (DESIGN 2.5.2, 5.1)', () => {
  const reg = makeRegistry({
    jokers: [
      joker('j4', { cost: 4 }),
      joker('j5', { cost: 5 }),
      joker('j7', { cost: 7 }),
      joker('j1', { cost: 1 }),
    ],
    consumables: [
      consumable('omen', { kind: 'pranostika', cost: 3, hand: 'pair' }),
      consumable('advice', { kind: 'rada', cost: 4 }),
      consumable('stamp', { kind: 'razitko', cost: 6 }),
    ],
  });

  it('žolík: max(1, floor(základ / 2)) + sellBonus, základ = cena + edice', () => {
    const core = newCore(reg);
    expect(jokerSellValue(core, newJokerInstance(core, 'j4'))).toBe(2);
    expect(jokerSellValue(core, newJokerInstance(core, 'j5'))).toBe(2);
    expect(jokerSellValue(core, newJokerInstance(core, 'j7'))).toBe(3);
    expect(jokerSellValue(core, newJokerInstance(core, 'j4', 'holo'))).toBe(3);
    expect(jokerSellValue(core, newJokerInstance(core, 'j1'))).toBe(1);
    const grown = newJokerInstance(core, 'j5');
    grown.sellBonus = 3;
    expect(jokerSellValue(core, grown)).toBe(5);
  });

  it('zapůjčený žolík se prodá za 1 Kč', () => {
    const core = newCore(reg);
    expect(jokerSellValue(core, newJokerInstance(core, 'j7', 'poly', ['rental']))).toBe(1);
  });

  it('sleva ani shopPriceAdd prodejní cenu nemění', () => {
    const core = newCore(reg);
    core.api.addPermanentModifier({ shopDiscountPct: 50, shopPriceAdd: 1 });
    expect(jokerSellValue(core, newJokerInstance(core, 'j7'))).toBe(3);
    expect(consumableSellValue(core, { defId: 'advice', edition: null })).toBe(2);
  });

  it('spotřebky: pranostika 1 Kč, babská rada 2 Kč, razítko 3 Kč', () => {
    const core = newCore(reg);
    expect(
      ['omen', 'advice', 'stamp'].map((id) => consumableSellValue(core, { defId: id, edition: null })),
    ).toEqual([1, 2, 3]);
  });

  it('Game: přibitého žolíka prodat nejde, zapůjčený vrátí 1 Kč', () => {
    const game = newGame(reg);
    const core = game._core;
    core.api.createJoker({ defId: 'j7', stickers: ['eternal'] });
    core.api.createJoker({ defId: 'j7', stickers: ['rental'] });
    const [eternal, rental] = core.state.jokers;
    expect(game.dispatch({ type: 'sellJoker', uid: eternal!.uid })).toEqual({
      ok: false,
      error: 'cannotSell',
    });
    const before = game.state.money;
    expect(game.sellValue(rental!.uid)).toBe(1);
    expect(game.dispatch({ type: 'sellJoker', uid: rental!.uid }).ok).toBe(true);
    expect(game.state.money).toBe(before + 1);
    expect(game.state.jokers).toHaveLength(1);
  });
});

describe('rollEdition (DESIGN 2.6)', () => {
  const reg = makeRegistry();

  function distribution(target: 'joker' | 'card', n: number, extraMods = {}): Record<string, number> {
    const core = newCore(reg);
    if (Object.keys(extraMods).length) core.api.addPermanentModifier(extraMods);
    const rng = rngFromState(cyrb128(`editions:${target}`));
    const out: Record<string, number> = { none: 0, foil: 0, holo: 0, poly: 0, negative: 0 };
    for (let i = 0; i < n; i++) {
      const ed = rollEdition(core, rng, target) ?? 'none';
      out[ed] = (out[ed] ?? 0) + 1;
    }
    return out;
  }

  /** Očekávaný počet ± 5 směrodatných odchylek binomického rozdělení. */
  function expectNear(actual: number, n: number, p: number): void {
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    expect(Math.abs(actual - mean), `${actual} vs ${mean.toFixed(1)}`).toBeLessThanOrEqual(5 * sd);
  }

  it('žolíci: negativní 0,25 % samostatně, pak lesklá 2,5 %, holo 1,5 %, duhová 0,4 %', () => {
    const n = 200_000;
    const d = distribution('joker', n);
    const notNeg = 1 - 0.0025;
    expectNear(d.negative!, n, 0.0025);
    expectNear(d.foil!, n, notNeg * 0.025);
    expectNear(d.holo!, n, notNeg * 0.015);
    expectNear(d.poly!, n, notNeg * 0.004);
  });

  it('hrací karty: lesklá 5 %, holo 2,5 %, duhová 1 %, nikdy negativní', () => {
    const n = 200_000;
    const d = distribution('card', n);
    expect(d.negative).toBe(0);
    expectNear(d.foil!, n, 0.05);
    expectNear(d.holo!, n, 0.025);
    expectNear(d.poly!, n, 0.01);
  });

  it('editionRateMult násobí lesklou/holo/duhovou, negativní ne', () => {
    const n = 200_000;
    const d = distribution('joker', n, { editionRateMult: 2.5 });
    const notNeg = 1 - 0.0025;
    expectNear(d.negative!, n, 0.0025);
    expectNear(d.foil!, n, notNeg * 0.0625);
    expectNear(d.holo!, n, notNeg * 0.0375);
    expectNear(d.poly!, n, notNeg * 0.01);
  });

  it('jeden hod r proti kumulativním šancím od nejvzácnější: duhová → holo → lesklá', () => {
    const core = newCore(reg);
    // žolík: první next() = hod na negativní, druhý = r
    expect(rollEdition(core, scripted([0.002]), 'joker')).toBe('negative');
    expect(rollEdition(core, scripted([0.5, 0.0039]), 'joker')).toBe('poly');
    expect(rollEdition(core, scripted([0.5, 0.004]), 'joker')).toBe('holo');
    expect(rollEdition(core, scripted([0.5, 0.0189]), 'joker')).toBe('holo');
    expect(rollEdition(core, scripted([0.5, 0.019]), 'joker')).toBe('foil');
    expect(rollEdition(core, scripted([0.5, 0.0439]), 'joker')).toBe('foil');
    expect(rollEdition(core, scripted([0.5, 0.0441]), 'joker')).toBeNull();
    // karta: bez hodu na negativní
    expect(rollEdition(core, scripted([0.0099]), 'card')).toBe('poly');
    expect(rollEdition(core, scripted([0.0101]), 'card')).toBe('holo');
    expect(rollEdition(core, scripted([0.0349]), 'card')).toBe('holo');
    expect(rollEdition(core, scripted([0.0351]), 'card')).toBe('foil');
    expect(rollEdition(core, scripted([0.0849]), 'card')).toBe('foil');
    expect(rollEdition(core, scripted([0.0851]), 'card')).toBeNull();
  });

  it('stejný seed = stejné edice', () => {
    expect(distribution('joker', 5000)).toEqual(distribution('joker', 5000));
  });
});

describe('nálepky (DESIGN 4.6)', () => {
  const stake = (level: number, stickerChance: Record<string, number>) => ({
    id: `s${level}`,
    level,
    stickerChance,
    art: ART,
  });
  const reg = makeRegistry({
    jokers: [joker('plain'), joker('free_spirit', { noEternal: true, noRental: true, noPerishable: true })],
    stakes: [stake(1, {}), stake(2, { perishable: 0.25 }), stake(3, { eternal: 0.2, rental: 0.15 })],
  });

  it('pořadí přibitý → zapůjčený → zvětrávající, první úspěšný hod vyhrává', () => {
    const core = newCore(reg, { stake: 3 });
    expect(rollStickers(core, scripted([0.1]), 'plain')).toEqual(['eternal']);
    expect(rollStickers(core, scripted([0.5, 0.1]), 'plain')).toEqual(['rental']);
    expect(rollStickers(core, scripted([0.5, 0.5, 0.2]), 'plain')).toEqual(['perishable']);
    expect(rollStickers(core, scripted([0.5, 0.5, 0.5]), 'plain')).toEqual([]);
  });

  it('nízká síla piva nálepky nedává; vyšší úrovně se kumulují', () => {
    expect(rollStickers(newCore(reg, { stake: 1 }), scripted([0]), 'plain')).toEqual([]);
    expect(rollStickers(newCore(reg, { stake: 2 }), scripted([0.1]), 'plain')).toEqual(['perishable']);
  });

  it('noEternal/noRental/noPerishable nálepky vyloučí', () => {
    expect(rollStickers(newCore(reg, { stake: 3 }), scripted([0, 0, 0]), 'free_spirit')).toEqual([]);
  });

  it('podíly na Doppelbocku ≈ 20 % / 12 % / 17 %', () => {
    const core = newCore(reg, { stake: 3 });
    const rng = rngFromState(cyrb128('stickers'));
    const n = 50_000;
    const counts: Record<string, number> = { eternal: 0, rental: 0, perishable: 0, none: 0 };
    for (let i = 0; i < n; i++) {
      const s = rollStickers(core, rng, 'plain')[0] ?? 'none';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    expect(counts.eternal! / n).toBeCloseTo(0.2, 1);
    expect(counts.rental! / n).toBeCloseTo(0.8 * 0.15, 1);
    expect(counts.perishable! / n).toBeCloseTo(0.8 * 0.85 * 0.25, 1);
  });

  it('zvětrávající žolík dostane PERISH_ROUNDS kol', () => {
    const core = newCore(reg);
    expect(newJokerInstance(core, 'plain', null, ['perishable']).perishRounds).toBe(PERISH_ROUNDS);
    expect(newJokerInstance(core, 'plain').perishRounds).toBeUndefined();
  });
});

describe('pool žolíků (DESIGN 2.5.1)', () => {
  it('nenabízí vlastněné ani už nabízené; vyčerpaný pool → Pivní tácek', () => {
    const reg = makeRegistry({ jokers: [joker('a'), joker('b'), joker(FALLBACK_JOKER_ID)] });
    const core = newCore(reg);
    const rng = rngFromState(cyrb128('pool'));
    core.api.createJoker({ defId: 'a' });
    for (let i = 0; i < 30; i++) {
      const id = pickJokerDefId(core, rng, { exclude: ['b'] });
      expect(id).toBe(FALLBACK_JOKER_ID);
    }
    core.api.createJoker({ defId: FALLBACK_JOKER_ID });
    // Pivní tácek se smí opakovat i vlastněný
    expect(pickJokerDefId(core, rng, { exclude: ['b', FALLBACK_JOKER_ID] })).toBe(FALLBACK_JOKER_ID);
  });

  it('bez Pivního tácku v registru vrací vyčerpaný pool null', () => {
    const reg = makeRegistry({ jokers: [joker('a')] });
    const core = newCore(reg);
    core.api.createJoker({ defId: 'a' });
    expect(pickJokerDefId(core, rngFromState(cyrb128('x')))).toBeNull();
  });

  it('vzácnosti podle RARITY_WEIGHTS 68 / 26 / 6, legendární nikdy', () => {
    const reg = makeRegistry({
      jokers: [
        joker('c', { rarity: 'common' }),
        joker('r', { rarity: 'rare' }),
        joker('e', { rarity: 'epic' }),
        joker('l', { rarity: 'legendary', cost: 16 }),
      ],
    });
    const core = newCore(reg);
    const rng = rngFromState(cyrb128('rarity'));
    const n = 20_000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const id = pickJokerDefId(core, rng)!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.l).toBeUndefined();
    expect(counts.c! / n).toBeCloseTo(0.68, 1);
    expect(counts.r! / n).toBeCloseTo(0.26, 1);
    expect(counts.e! / n).toBeCloseTo(0.06, 1);
  });

  it('createJoker s rarity: legendary vytvoří legendárního', () => {
    const reg = makeRegistry({ jokers: [joker('c'), joker('l', { rarity: 'legendary', noShop: true })] });
    const core = newCore(reg);
    expect(core.api.createJoker({ rarity: 'legendary' })?.defId).toBe('l');
  });
});

describe('spotřebky v nabídce', () => {
  it('pranostika tajné kombinace až po objevu v runu', () => {
    const reg = makeRegistry({
      consumables: [consumable('p_five', { kind: 'pranostika', cost: 3, hand: 'five' })],
    });
    const core = newCore(reg);
    const rng = rngFromState(cyrb128('c'));
    expect(pickConsumableDefId(core, rng, 'pranostika')).toBeNull();
    core.state.discoveredHands.push('five');
    expect(pickConsumableDefId(core, rng, 'pranostika')).toBe('p_five');
  });

  it('váha spotřebky (Výjimka z vyhlášky 0,25)', () => {
    const reg = makeRegistry({
      consumables: [
        consumable('normal', { kind: 'razitko', cost: 6 }),
        consumable('exception', { kind: 'razitko', cost: 6, weight: 0.25 }),
      ],
    });
    const core = newCore(reg);
    const rng = rngFromState(cyrb128('w'));
    let rare = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (pickConsumableDefId(core, rng, 'razitko') === 'exception') rare++;
    expect(rare / n).toBeCloseTo(0.2, 1);
  });
});

describe('hrací karty v obchodě a obálkách (DESIGN 2.5.3, 2.9)', () => {
  const marias: CardSpec[] = [];
  for (const suit of ['S', 'H', 'D', 'C'] as const)
    for (const rank of [7, 8, 9, 10, 11, 12, 13, 14] as const) marias.push({ suit, rank, seal: 'red' });

  const reg = makeRegistry({
    decks: [{ id: 'marias', buildDeck: () => marias, art: ART }],
    boosters: [booster('cards', { kind: 'card', options: 3 })],
  });

  it('hodnota a barva jen z výchozího složení balíčku (ostatní vlastnosti ne)', () => {
    const core = newCore(reg, { deckId: 'marias' });
    const rng = rngFromState(cyrb128('cards'));
    for (let i = 0; i < 300; i++) {
      const c = randomPlayingCard(core, rng, { enhancement: 0, seal: 0 });
      expect(c.rank).toBeGreaterThanOrEqual(7);
      expect(c.seal).toBeNull();
      expect(c.enhancement).toBeNull();
    }
    // výchozí složení se nemění s balíčkem runu
    core.state.deck = core.state.deck.filter((c) => c.rank !== 14);
    const ranks = new Set(
      Array.from({ length: 300 }, () => randomPlayingCard(core, rng, { enhancement: 0, seal: 0 }).rank),
    );
    expect(ranks.has(14)).toBe(true);
  });

  it('šance na vylepšení a pečeť z modifikátorů (obchod 20 % / 0 %)', () => {
    const core = newCore(reg);
    const rng = rngFromState(cyrb128('shopcards'));
    const n = 5000;
    let enh = 0;
    let seal = 0;
    const m = core.mods();
    for (let i = 0; i < n; i++) {
      const c = randomPlayingCard(core, rng, {
        enhancement: m.playingCardEnhanceChance,
        seal: m.playingCardSealChance,
      });
      if (c.enhancement) enh++;
      if (c.seal) seal++;
    }
    expect(enh / n).toBeCloseTo(0.2, 1);
    expect(seal).toBe(0);
  });

  it('karetní obálka: vylepšení 35 %, pečeť 15 %', () => {
    const core = newCore(reg);
    let enh = 0;
    let seal = 0;
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      for (const opt of generateBoosterOptions(core, 'cards')) {
        if (opt.kind !== 'card') continue;
        total++;
        if (opt.card.enhancement) enh++;
        if (opt.card.seal) seal++;
      }
    }
    expect(BOOSTER_CARD_ENHANCE_CHANCE).toBe(0.35);
    expect(enh / total).toBeCloseTo(BOOSTER_CARD_ENHANCE_CHANCE, 1);
    expect(seal / total).toBeCloseTo(0.15, 1);
  });
});

describe('nabídka Večerky', () => {
  it('první Večerka runu má v prvním slotu normální Žolíkovou obálku', () => {
    const reg = makeRegistry({
      jokers: [joker('a'), joker('b'), joker('c')],
      boosters: [
        booster('a_cards', { kind: 'card', weight: 100 }),
        booster('jokers_big', { kind: 'joker', size: 'jumbo', weight: 1 }),
        booster('jokers_normal', { kind: 'joker', size: 'normal', weight: 0.0001 }),
      ],
    });
    const core = newCore(reg);
    const first = generateShop(core, { firstShop: true });
    expect(first.boosters[0]!.boosterId).toBe('jokers_normal');
    expect(first.boosters).toHaveLength(2);
    const later = generateShop(core, { firstShop: false });
    expect(later.boosters.every((b) => b.boosterId === 'a_cards' || b.boosterId === 'jokers_big')).toBe(true);
  });

  it('Game: první vstup do Večerky použije zaručenou obálku, další už ne', () => {
    const reg = makeRegistry({
      boosters: [booster('jokers_normal'), booster('cards', { kind: 'card', weight: 1000 })],
    });
    const game = newGame(reg);
    game.dispatch({ type: 'selectBlind' });
    game._core.state.round!.score = game._core.state.round!.target;
    // vyhrát kolo zahráním jedné karty
    game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] });
    expect(game.state.phase).toBe('round_end');
    game.dispatch({ type: 'cashOut' });
    expect(game.state.phase).toBe('shop');
    expect(game.state.shop!.boosters[0]!.boosterId).toBe('jokers_normal');
    expect(game.state.stats.shopsEntered).toBe(1);
  });

  it('ceny se po změně modifikátorů přepočítají, zdarma zůstává zdarma', () => {
    const reg = makeRegistry({ jokers: [joker('a', { cost: 6 }), joker('b', { cost: 6 })] });
    const core = newCore(reg);
    const shop = generateShop(core);
    const items = shop.items.filter((i): i is ShopItem & { kind: 'joker' } => i.kind === 'joker');
    expect(items.length).toBeGreaterThan(0);
    items[0]!.free = true;
    core.api.addPermanentModifier({ shopPriceAdd: 1 });
    refreshShopPrices(core, shop);
    expect(items[0]!.price).toBe(0);
    for (const it of items.slice(1)) expect(it.price).toBe(jokerPrice(core, it.joker));
    expect(shop.rerollCost).toBe(5);
    shop.freeRerolls = 1;
    refreshShopPrices(core, shop);
    expect(shop.rerollCost).toBe(0);
  });

  it('Game: přehození zdraží další přehození, nová Večerka začíná od základu', () => {
    const reg = makeRegistry({ jokers: [joker('a'), joker('b'), joker('c')] });
    const game = newGame(reg);
    const core = game._core;
    core.state.money = 100;
    core.state.phase = 'shop';
    core.state.shop = generateShop(core);
    expect(game.state.shop!.rerollCost).toBe(4);
    expect(game.dispatch({ type: 'reroll' }).ok).toBe(true);
    expect(game.state.money).toBe(96);
    expect(game.state.shop!.rerollCost).toBe(5);
    expect(game.dispatch({ type: 'reroll' }).ok).toBe(true);
    expect(game.state.money).toBe(91);
    expect(game.state.shop!.paidRerolls).toBe(2);
  });
});

describe('obálky (DESIGN 2.9)', () => {
  const reg = makeRegistry({
    consumables: [
      consumable('coin', { kind: 'rada', cost: 4, use: (ctx) => ctx.api.addMoney(10, 'test') }),
      consumable('coin2', { kind: 'rada', cost: 4, use: (ctx) => ctx.api.addMoney(20, 'test') }),
    ],
    boosters: [booster('advice', { kind: 'rada', options: 2, picks: 1 })],
  });

  function openAdvice() {
    const game = newGame(reg);
    game.startBooster('advice', 'blind_select');
    return game;
  }

  it('vybranou spotřebku jde hned použít', () => {
    const game = openAdvice();
    const before = game.state.money;
    expect(game.dispatch({ type: 'pickBooster', index: 0 }).ok).toBe(true);
    expect(game.state.money).toBeGreaterThan(before);
    expect(game.state.consumables).toHaveLength(0);
    expect(game.state.phase).toBe('blind_select');
  });

  it('…nebo s keep uložit do volného slotu', () => {
    const game = openAdvice();
    const before = game.state.money;
    const defId = (game.state.booster!.options[1] as { consumable: { defId: string } }).consumable.defId;
    expect(game.dispatch({ type: 'pickBooster', index: 1, keep: true }).ok).toBe(true);
    expect(game.state.money).toBe(before);
    expect(game.state.consumables.map((c) => c.defId)).toEqual([defId]);
  });

  it('bez volného slotu uložit nejde (stav se nemění)', () => {
    const game = openAdvice();
    game._core.api.createConsumable({ defId: 'coin' });
    game._core.api.createConsumable({ defId: 'coin2' });
    const res = game.dispatch({ type: 'pickBooster', index: 0, keep: true });
    expect(res).toEqual({ ok: false, error: 'slotsFull' });
    expect(game.state.booster!.options).toHaveLength(2);
  });

  it('možnosti v jedné obálce se neopakují', () => {
    const big = makeRegistry({
      consumables: [consumable('only', { kind: 'rada', cost: 4 })],
      boosters: [booster('advice', { kind: 'rada', options: 4 })],
    });
    const core = newCore(big);
    expect(generateBoosterOptions(core, 'advice')).toHaveLength(1);
  });
});
