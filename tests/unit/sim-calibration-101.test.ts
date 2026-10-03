/**
 * Boti po kalibraci 1.0.1 (src/engine/sim/value.ts, bots.ts): splátky a výplaty držených štítků (sonda dohraje
 * kopii hry), ocenění kupónů s mechanikami 1.0.1 (každý N-tý nákup zdarma, přelosování šéfa, prodej za plnou cenu,
 * kupóny jen s hooky) a přelosování nebezpečného šéfa. Obsah hry (`buildRegistry`).
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { rngFromState } from '../../src/engine/rng/rng';
import type { Game } from '../../src/engine/run/game';
import { cloneGame, makeEnv } from '../../src/engine/sim/hand-eval';
import { createBot } from '../../src/engine/sim/index';
import {
  heldTagMoney,
  HOOK_VOUCHER_KC,
  makeView,
  modsWorth,
  probe,
  voucherWorth,
  type ValueStyle,
} from '../../src/engine/sim/value';
import { makeGame } from './fixtures/registry';

const reg = buildRegistry();

const MAX_STYLE: ValueStyle = {
  favorHands: [],
  suitFocus: false,
  rankFocus: false,
  buysJokers: true,
  fullReserve: false,
};

function view(game: Game) {
  return makeView(game, MAX_STYLE, makeEnv(game), 0, () => 1);
}

/** Nový run na výběru Malé útraty s daným štítkem za přeskočení. */
function atSmallBlind(tagId: string, money = 10): Game {
  const game = makeGame({ registry: reg, deckId: 'pub', money });
  game._core.state.blinds[0]!.skipTagId = tagId;
  return game;
}

/** Kopie hry po přeskočení Malé útraty a uid štítků, které tím přibyly. */
function skipped(game: Game): { clone: Game; uids: Set<number> } {
  const owned = new Set(game.state.tags.map((t) => t.uid));
  const clone = cloneGame(game, rngFromState([1, 2, 3, 4]));
  expect(clone.dispatch({ type: 'skipBlind' }).ok).toBe(true);
  return { clone, uids: new Set(clone.state.tags.filter((t) => !owned.has(t.uid)).map((t) => t.uid)) };
}

describe('heldTagMoney — co držený štítek vyplatí nebo strhne v rozpisu odměn', () => {
  it('Půjčka od tchána: +20 Kč hned, po šéfovi patra splátka −15 Kč (čistě +5 Kč)', () => {
    const game = atSmallBlind('in_law_loan');
    const { clone, uids } = skipped(game);
    expect(clone.state.money - game.state.money).toBe(20);
    expect(uids.size).toBe(1);
    expect(heldTagMoney(clone, uids)).toBe(-15);
  });

  it('Brigáda na chmelu: +6 Kč za každé z dalších 2 vyhraných kol', () => {
    const { clone, uids } = skipped(atSmallBlind('hop_picking'));
    expect(heldTagMoney(clone, uids)).toBe(12);
  });

  it('štítek bez peněz v rozpisu (Otevřené dveře) nic nevyplatí', () => {
    const { clone, uids } = skipped(atSmallBlind('open_doors'));
    expect(heldTagMoney(clone, uids)).toBe(0);
  });
});

describe('ocenění kupónů 1.0.1', () => {
  /** Hodnota kupónu `id` nabídnutého ve Večerce (sonda koupě, bez ceny). */
  function worthOf(id: string, ante = 1): number {
    const game = makeGame({ registry: reg, deckId: 'pub', money: 50 });
    const s = game._core.state;
    s.ante = ante;
    s.phase = 'shop';
    s.shop = {
      items: [],
      boosters: [],
      vouchers: [{ voucherId: id, price: 1, sold: false }],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    const v = view(game);
    const clone = probe(game, { type: 'buyVoucher', slot: 0 }, [1, 2, 3, 4], JSON.stringify(s));
    expect(clone, id).not.toBeNull();
    return voucherWorth(v, clone!, reg.vouchers[id]);
  }

  it('každý 5. nákup zdarma má cenu úměrnou zbytku runu', () => {
    const early = worthOf('loyalty_card', 1);
    const late = worthOf('loyalty_card', 7);
    expect(early).toBeGreaterThan(10);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(early / 3);
  });

  it('přelosování šéfa za patro a prodej za plnou cenu mají kladnou hodnotu', () => {
    expect(worthOf('village_newsletter')).toBeGreaterThan(5);
    expect(worthOf('deposit_bottle')).toBeGreaterThan(0);
  });

  it('kupón jen s hooky (Kniha stížností, Jarní úklid) dostane apriorní hodnotu za zbytek runu', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    const rounds = view(game).roundsLeft;
    expect(worthOf('complaints_book')).toBeCloseTo(HOOK_VOUCHER_KC * rounds, 5);
    expect(worthOf('spring_cleaning')).toBeCloseTo(HOOK_VOUCHER_KC * rounds, 5);
  });

  it('modsWorth: +1 přelosování šéfa za patro a „každý 3. nákup“ místo „každého 5.“', () => {
    const game = makeGame({ registry: reg, deckId: 'pub' });
    const v = view(game);
    const base = game.modifiers();
    expect(modsWorth(v, base, { ...base, bossRerollsPerAnte: 1 })).toBeGreaterThan(0);
    const five = modsWorth(v, base, { ...base, freePurchaseEvery: 5 });
    const three = modsWorth(v, base, { ...base, freePurchaseEvery: 3 });
    expect(three).toBeGreaterThan(five);
    expect(five).toBeGreaterThan(0);
  });
});

describe('přelosování šéfa botem', () => {
  /** Výběr útraty Šéf s daným šéfem a `rerolls` přelosováními. */
  function atBoss(bossId: string, rerolls: number, deckId = 'pub'): Game {
    const game = makeGame({ registry: reg, deckId, money: 0 });
    const s = game._core.state;
    s.blinds[0]!.status = 'defeated';
    s.blinds[1]!.status = 'defeated';
    s.blinds[2]!.status = 'current';
    s.blinds[2]!.bossId = bossId;
    s.blindIndex = 2;
    s.flags.bossRerolls = rerolls;
    s.stats.handsPlayed = 10;
    return game;
  }

  it('šéf, který buildu sebere většinu síly (Inventura proti Obrázkovému balíčku): přelosovat', () => {
    // Obrázkový balíček je ze ¾ figur — pod Inventurou skoro nic neskóruje, běžný šéf by byl v pohodě.
    expect(createBot('max').decide(atBoss('inventory', 1, 'court'))).toEqual({ type: 'rerollBoss' });
  });

  it('bez přelosování nebo s velkou rezervou: vybrat útratu', () => {
    expect(createBot('max').decide(atBoss('inventory', 0, 'court'))).toEqual({ type: 'selectBlind' });
    // Všechny kombinace na úrovni 12: i pod Inventurou zbývá mnohonásobek cíle patra 1.
    const strong = atBoss('inventory', 1, 'court');
    for (const lvl of Object.values(strong._core.state.handLevels)) lvl.level = 12;
    expect(createBot('max').decide(strong)).toEqual({ type: 'selectBlind' });
  });
});
