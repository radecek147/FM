/**
 * Kupóny (docs/DESIGN.md kap. 6) přes skutečný engine (Game + dispatch buyVoucher): 12 párů s cenami z tabulky,
 * texty, nabídka (tier 2 jen s vlastněným tier 1, kupón drží celé patro, „−1 patro“ až od patra 2), přesný efekt
 * každého kupónu a to, že se projeví hned (ceny i sloty otevřené Večerky). Obsah: src/content/vouchers.ts,
 * texty src/i18n/cs/vouchers.ts; obecná rozšíření enginu: `VoucherDef.available`, `syncShopSlots`.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { BOOSTERS } from '../../src/content/boosters';
import { CONSUMABLES } from '../../src/content/consumables';
import { buildRegistry, validateRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import { VOUCHERS } from '../../src/content/vouchers';
import type { ContentRegistry, VoucherDef } from '../../src/engine/content-types';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { Game } from '../../src/engine/run/game';
import { blindTarget } from '../../src/engine/run/targets';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import {
  eligibleVouchers,
  generateShopItems,
  syncShopSlots,
  voucherAvailable,
  voucherOffers,
} from '../../src/engine/shop/shop';
import type { GameEvent, ShopItem } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { ART, boss, makeGame, makeRegistry, winNextHand } from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** DESIGN 6: [tier 1, cena, tier 2, cena] v pořadí tabulky. */
const PAIRS: [string, number, string, number][] = [
  ['second_shelf', 9, 'checkout_shelf', 12],
  ['loyalty_card', 10, 'gold_loyalty', 13],
  ['counter_buddy', 9, 'manager_inlaw', 11],
  ['late_hours', 12, 'nonstop', 15],
  ['dumpster', 9, 'recycling_yard', 12],
  ['bigger_table', 12, 'folding_table', 15],
  ['savings_account', 9, 'building_savings', 12],
  ['narrow_rack', 11, 'proper_rack', 13],
  ['tear_calendar', 8, 'grandmas_pantry', 11],
  ['card_stall', 9, 'fortune_teller', 12],
  ['polish', 9, 'holo_foil', 12],
  ['official_strike', 12, 'amnesty', 14],
];
const TIER1 = PAIRS.map((p) => p[0]);
const NBSP = ' ';

/**
 * Registr: skuteční žolíci, kupóny, spotřebky a obálky (testovací štítky a balíček); jediný šéf `wall` (jen vyšší
 * cíl), aby šéfovská pravidla nerušila peníze ani ruku.
 */
function registry(): ContentRegistry {
  const reg = makeRegistry({ vouchers: VOUCHERS });
  reg.jokers = Object.fromEntries(JOKERS.map((j) => [j.id, j]));
  reg.consumables = Object.fromEntries(CONSUMABLES.map((c) => [c.id, c]));
  reg.boosters = Object.fromEntries(BOOSTERS.map((b) => [b.id, b]));
  reg.bosses = { wall: boss('wall', { targetMult: 4 }) };
  return reg;
}

function game(money = 200): Game {
  return makeGame({ registry: registry(), money });
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Vybere útratu (je-li třeba). */
function startRound(g: Game): void {
  if (g.state.phase === 'shop') ok(g.dispatch({ type: 'leaveShop' }));
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
  expect(g.state.phase).toBe('round');
}

/** Vyhraje kolo první rukou (1 karta, cíl 1) a vrátí rozpis odměn. */
function winRound(g: Game): NonNullable<Game['state']['rewards']> {
  startRound(g);
  winNextHand(g);
  ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
  expect(g.state.phase).toBe('round_end');
  return g.state.rewards!;
}

/** Z výběru útraty (nebo z Večerky) do další Večerky: vybrat, vyhrát, vyplatit. */
function toShop(g: Game): void {
  winRound(g);
  ok(g.dispatch({ type: 'cashOut' }));
  expect(g.state.phase).toBe('shop');
}

/** Vystaví ve Večerce právě tento kupón (jako by ho vylosovalo patro). */
function offer(g: Game, id: string): void {
  const s = g._core.state;
  s.anteVouchers = [id];
  s.shop!.vouchers = voucherOffers(g._core);
  expect(s.shop!.vouchers.map((v) => v.voucherId)).toEqual([id]);
}

/** Koupí kupón ve Večerce přes `buyVoucher` (vystaví ho, zaplatí, uplatní). */
function buy(g: Game, ...ids: string[]): GameEvent[] {
  const events: GameEvent[] = [];
  for (const id of ids) {
    offer(g, id);
    events.push(...ok(g.dispatch({ type: 'buyVoucher', slot: 0 })));
  }
  return events;
}

/** Hra ve Večerce (po Malé útratě) s koupenými kupóny. */
function shopWith(...ids: string[]): Game {
  const g = game();
  toShop(g);
  buy(g, ...ids);
  return g;
}

function def(id: string): VoucherDef {
  const d = VOUCHERS.find((v) => v.id === id);
  if (!d) throw new Error(`neznámý kupón ${id}`);
  return d;
}

/** Druhy položek z `n` nezávisle vygenerovaných nabídek kartových slotů (stream `shop`). */
function sampleItems(g: Game, n: number): ShopItem[] {
  const out: ShopItem[] = [];
  for (let i = 0; i < n; i++) out.push(...generateShopItems(g._core));
  return out;
}

const kindOf = (it: ShopItem): string => (it.kind === 'consumable' ? it.consumableKind : it.kind);

// ─────────────────────────── Definice a texty ───────────────────────────

describe('kupóny – definice (DESIGN 6)', () => {
  it('24 kupónů = 12 párů tier 1 → tier 2 s cenami z tabulky (8–15 Kč)', () => {
    expect(VOUCHERS).toHaveLength(24);
    expect(VOUCHERS.map((v) => v.id).sort()).toEqual(PAIRS.flatMap((p) => [p[0], p[2]]).sort());
    for (const [t1, c1, t2, c2] of PAIRS) {
      expect(def(t1), t1).toMatchObject({ tier: 1, cost: c1 });
      expect(def(t1).requires, t1).toBeUndefined();
      expect(def(t2), t2).toMatchObject({ tier: 2, requires: t1, cost: c2 });
      expect(def(t2).unlock, t2).toEqual({ type: 'custom', id: 'voucherTier1TwoRuns' });
    }
    for (const v of VOUCHERS) {
      expect(v.cost, v.id).toBeGreaterThanOrEqual(8);
      expect(v.cost, v.id).toBeLessThanOrEqual(15);
    }
    expect(validateRegistry(buildRegistry()).filter((p) => p.includes('voucher'))).toEqual([]);
  });

  it('ikony jen z ICON_NAMES, obrázky páru se liší', () => {
    for (const v of VOUCHERS) {
      expect(isIconName(v.art.icon), `${v.id}: ${v.art.icon}`).toBe(true);
      if (v.art.prop) expect(isIconName(v.art.prop), `${v.id}: ${v.art.prop}`).toBe(true);
    }
    for (const [t1, , t2] of PAIRS) expect(def(t1).art, t1).not.toEqual(def(t2).art);
  });

  it('každý kupón má název (max. 3 slova), popis a flavor; {param} z params, po dosazení nic nezbyde', () => {
    for (const v of VOUCHERS) {
      for (const f of ['name', 'desc', 'flavor'])
        expect(hasKey(`vouchers.${v.id}.${f}`), `${v.id}.${f}`).toBe(true);
      expect(t(`vouchers.${v.id}.name`).split(/\s+/).length, v.id).toBeLessThanOrEqual(3);
      const raw = t(`vouchers.${v.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(v.params ?? {}, `${v.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`vouchers.${v.id}.desc`, v.params ?? {}), v.id).not.toMatch(/[{}]/);
      expect(t(`vouchers.${v.id}.flavor`), v.id).not.toMatch(/[„“"]/);
    }
  });

  it('popisky čtou stejná čísla jako mechanika', () => {
    const d = (id: string) => t(`vouchers.${id}.desc`, def(id).params ?? {});
    expect(d('loyalty_card')).toBe(`Zboží ve Večerce je o${NBSP}20${NBSP}% levnější (přehození ne).`);
    expect(d('gold_loyalty')).toContain(`o${NBSP}40${NBSP}%`);
    expect(d('counter_buddy')).toContain(`o${NBSP}1${NBSP}Kč levnější (začíná na 3${NBSP}Kč)`);
    expect(d('nonstop')).toBe(
      `+1${NBSP}ruka v${NBSP}každém kole a${NBSP}+1${NBSP}Kč navíc za každou nevyužitou ruku.`,
    );
    expect(d('savings_account')).toContain(`na 8${NBSP}Kč`);
    expect(d('building_savings')).toContain(`na 12${NBSP}Kč`);
    expect(d('tear_calendar')).toContain(`z${NBSP}3${NBSP}na 7`);
    expect(d('grandmas_pantry')).toContain('7 → 8,5');
    expect(d('fortune_teller')).toContain(`50${NBSP}% šanci na vylepšení a${NBSP}20${NBSP}% šanci na pečeť`);
    expect(d('polish')).toContain('2,5× častěji');
    expect(d('holo_foil')).toContain('3,5× častěji (místo 2,5×)');
    expect(d('official_strike')).toContain('×1,1');
    expect(d('amnesty')).toContain(`o${NBSP}1${NBSP}Kč víc`);
  });
});

// ─────────────────────────── Nabídka ───────────────────────────

describe('kupóny – nabídka a koupě', () => {
  it('na začátku runu jen tier 1; „−1 patro“ (Úřední škrt) se v patře 1 nenabízí', () => {
    const g = game();
    expect(eligibleVouchers(g._core)).toEqual(TIER1.filter((id) => id !== 'official_strike').sort());
    expect(g.state.anteVouchers).toHaveLength(1);
    expect(TIER1).toContain(g.state.anteVouchers[0]);
    g._core.state.ante = 2;
    expect(eligibleVouchers(g._core)).toEqual([...TIER1].sort());
  });

  it('tier 2 se nabídne až s vlastněným tier 1; vlastněný kupón už ne', () => {
    const g = game();
    toShop(g);
    expect(eligibleVouchers(g._core)).not.toContain('gold_loyalty');
    buy(g, 'loyalty_card');
    const pool = eligibleVouchers(g._core);
    expect(pool).toContain('gold_loyalty');
    expect(pool).not.toContain('loyalty_card');
    expect(pool.filter((id) => def(id).tier === 2)).toEqual(['gold_loyalty']);
    buy(g, 'gold_loyalty');
    expect(eligibleVouchers(g._core)).not.toContain('gold_loyalty');
    expect(g.state.vouchers).toEqual(['loyalty_card', 'gold_loyalty']);
  });

  it('tier 2 bez tier 1 koupit nejde (ani vnucený do nabídky) — stav se nezmění', () => {
    const g = game();
    toShop(g);
    g._core.state.shop!.vouchers = [{ voucherId: 'gold_loyalty', price: 13, sold: false }];
    const before = JSON.stringify(g.state);
    expect(g.dispatch({ type: 'buyVoucher', slot: 0 })).toMatchObject({ ok: false, error: 'cannotUse' });
    expect(JSON.stringify(g.state)).toBe(before);
  });

  it('kupón drží celé patro (nekoupený i ve Večerce po Velké útratě), po porážce šéfa nový los', () => {
    const g = game();
    g._core.state.anteVouchers = ['polish'];
    toShop(g); // po Malé
    expect(g.state.shop!.vouchers.map((v) => v.voucherId)).toEqual(['polish']);
    toShop(g); // po Velké — stále týž kupón
    expect(g.state.shop!.vouchers.map((v) => v.voucherId)).toEqual(['polish']);
    ok(g.dispatch({ type: 'buyVoucher', slot: 0 }));
    expect(g.state.anteVouchers).toEqual([]);
    toShop(g); // po šéfovi → patro 2, nový kupón
    expect(g.state.ante).toBe(2);
    expect(g.state.anteVouchers).toHaveLength(1);
    const offered = g.state.anteVouchers[0]!;
    expect(offered).not.toBe('polish');
    expect(eligibleVouchers(g._core)).toContain(offered);
    expect(g.state.shop!.vouchers.map((v) => v.voucherId)).toEqual([offered]);
  });

  it('koupě zaplatí cenu, emituje události v pořadí a kupón přežije uložení a načtení (s efektem)', () => {
    const g = game(50);
    toShop(g);
    const money = g.state.money;
    const events = buy(g, 'late_hours');
    expect(events.map((e) => e.type)).toEqual(['moneyChanged', 'itemBought', 'voucherRedeemed']);
    expect(g.state.money).toBe(money - 12);
    const loaded = Game.fromState(deserializeRun(serializeRun(g._core.state)), registry());
    expect(loaded.state.vouchers).toEqual(['late_hours']);
    expect(loaded.modifiers().hands).toBe(BASE_MODIFIERS.hands + 1);
  });

  it('bez peněz koupit nejde', () => {
    const g = game(0);
    toShop(g);
    g._core.state.money = 5;
    offer(g, 'tear_calendar');
    expect(g.dispatch({ type: 'buyVoucher', slot: 0 })).toMatchObject({ ok: false, error: 'notEnoughMoney' });
    expect(g.state.vouchers).toEqual([]);
  });
});

// ─────────────────────────── Efekty ───────────────────────────

describe('1 Druhý regál / Regál u pokladny', () => {
  it('Druhý regál: +1 kartový slot hned v otevřené Večerce, po přehození i v příští Večerce', () => {
    const g = game();
    toShop(g);
    const shop = g.state.shop!;
    const before = JSON.stringify(shop.items);
    expect(shop.items).toHaveLength(2);
    const boosters = JSON.stringify(shop.boosters);
    buy(g, 'second_shelf');
    expect(g.modifiers().shopCardSlots).toBe(3);
    expect(g.state.shop!.items).toHaveLength(3);
    // Vystavené zboží zůstalo, nový slot má cenu podle aktuálních modifikátorů.
    expect(JSON.stringify(g.state.shop!.items.slice(0, 2))).toBe(before);
    expect(g.state.shop!.items[2]!.price).toBeGreaterThan(0);
    expect(JSON.stringify(g.state.shop!.boosters)).toBe(boosters);
    ok(g.dispatch({ type: 'reroll' }));
    expect(g.state.shop!.items).toHaveLength(3);
    toShop(g);
    expect(g.state.shop!.items).toHaveLength(3);
  });

  it('Regál u pokladny: +1 slot obálky hned i v příští Večerce', () => {
    const g = shopWith('second_shelf');
    expect(g.state.shop!.boosters).toHaveLength(2);
    buy(g, 'checkout_shelf');
    expect(g.modifiers().shopBoosterSlots).toBe(3);
    expect(g.state.shop!.boosters).toHaveLength(3);
    expect(g.state.shop!.boosters[2]!.price).toBeGreaterThan(0);
    toShop(g);
    expect(g.state.shop!.boosters).toHaveLength(3);
    expect(g.state.shop!.items).toHaveLength(3);
  });
});

describe('2 Věrnostní karta / Zlatá věrnostní', () => {
  /** Obálky (4 / 7 / 10 Kč) jako vzorek cen. */
  const boosterPrices = (g: Game) => g.state.shop!.boosters.map((b) => [b.boosterId, b.price] as const);
  const cost = (id: string) => BOOSTERS.find((b) => b.id === id)!.cost;

  it('Věrnostní karta: zboží o 20 % levnější hned (polovina nahoru), přehození ne', () => {
    const g = game();
    toShop(g);
    const rerollCost = g.state.shop!.rerollCost;
    buy(g, 'loyalty_card');
    expect(g.modifiers().shopDiscountPct).toBe(20);
    const expected: Record<number, number> = { 4: 3, 7: 6, 10: 8 };
    for (const [id, price] of boosterPrices(g)) expect(price, id).toBe(expected[cost(id)]);
    expect(g.state.shop!.rerollCost).toBe(rerollCost);
    offer(g, 'gold_loyalty');
    expect(g.state.shop!.vouchers[0]!.price).toBe(10); // 13 × 0,8 = 10,4
  });

  it('Zlatá věrnostní: celkem 40 %', () => {
    const g = shopWith('loyalty_card', 'gold_loyalty');
    expect(g.modifiers().shopDiscountPct).toBe(40);
    const expected: Record<number, number> = { 4: 2, 7: 4, 10: 6 };
    for (const [id, price] of boosterPrices(g)) expect(price, id).toBe(expected[cost(id)]);
    expect(g.state.shop!.rerollCost).toBe(4);
  });
});

describe('3 Kamarád za pultem / Švagr vedoucí', () => {
  it('Kamarád za pultem: přehození začíná na 3 Kč (hned), dál roste o 1 Kč', () => {
    const g = shopWith('counter_buddy');
    expect(g.state.shop!.rerollCost).toBe(3);
    const money = g.state.money;
    ok(g.dispatch({ type: 'reroll' }));
    expect(g.state.money).toBe(money - 3);
    expect(g.state.shop!.rerollCost).toBe(4);
  });

  it('Švagr vedoucí: cena přehození v téže Večerce neroste (i po už zaplacených přehozeních)', () => {
    const g = shopWith('counter_buddy');
    ok(g.dispatch({ type: 'reroll' }));
    ok(g.dispatch({ type: 'reroll' }));
    expect(g.state.shop!.rerollCost).toBe(5);
    buy(g, 'manager_inlaw');
    expect(g.modifiers().rerollCostStep).toBe(0);
    expect(g.state.shop!.rerollCost).toBe(3);
    const money = g.state.money;
    for (let i = 0; i < 3; i++) ok(g.dispatch({ type: 'reroll' }));
    expect(g.state.money).toBe(money - 9);
    expect(g.state.shop!.rerollCost).toBe(3);
  });
});

describe('4 Prodloužená otvíračka / Nonstop', () => {
  it('Prodloužená otvíračka: +1 ruka v každém kole', () => {
    const g = shopWith('late_hours');
    expect(g.modifiers().hands).toBe(5);
    startRound(g);
    expect(g.state.round!.handsLeft).toBe(5);
  });

  it('Nonstop: další +1 ruka a +1 Kč navíc za každou nevyužitou ruku (2 Kč za ruku)', () => {
    const g = shopWith('late_hours', 'nonstop');
    expect(g.modifiers()).toMatchObject({ hands: 6, moneyPerUnusedHand: 2 });
    startRound(g);
    expect(g.state.round!.handsLeft).toBe(6);
    const rewards = winRound(g);
    expect(rewards.unusedHands).toBe(5 * 2);
  });
});

describe('5 Kontejner před domem / Sběrný dvůr', () => {
  it('Kontejner před domem: +1 zahození v každém kole', () => {
    const g = shopWith('dumpster');
    startRound(g);
    expect(g.state.round!.discardsLeft).toBe(4);
  });

  it('Sběrný dvůr: další +1 zahození a +1 Kč za každé nevyužité zahození', () => {
    const g = game();
    const plain = winRound(g);
    expect(plain.unusedDiscards).toBe(0);
    ok(g.dispatch({ type: 'cashOut' }));
    buy(g, 'dumpster', 'recycling_yard');
    expect(g.modifiers()).toMatchObject({ discards: 5, moneyPerUnusedDiscard: 1 });
    startRound(g);
    expect(g.state.round!.discardsLeft).toBe(5);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    expect(winRound(g).unusedDiscards).toBe(4);
  });
});

describe('6 Větší stůl / Rozkládací stůl', () => {
  it('Větší stůl: +1 karta v ruce', () => {
    const g = shopWith('bigger_table');
    startRound(g);
    expect(g.state.round!.hand).toHaveLength(9);
  });

  it('Rozkládací stůl: další +1 karta, v kole Šéfa ještě +1 navíc (jen tam)', () => {
    const g = shopWith('bigger_table', 'folding_table');
    expect(g.modifiers().handSize).toBe(10);
    startRound(g); // Velká útrata
    expect(g.state.round!.blind).toBe('big');
    expect(g.state.round!.hand).toHaveLength(10);
    toShop(g);
    startRound(g); // Šéf
    expect(g.state.round!.blind).toBe('boss');
    expect(g.modifiers().handSize).toBe(11);
    expect(g.state.round!.hand).toHaveLength(11);
    winRound(g);
    ok(g.dispatch({ type: 'cashOut' }));
    expect(g.modifiers().handSize).toBe(10);
  });
});

describe('7 Spořicí účet / Stavební spoření', () => {
  it('bez kupónu strop 5 Kč, Spořicí účet 8 Kč, Stavební spoření 12 Kč', () => {
    const g = game(200);
    expect(winRound(g).interest).toBe(5);
    ok(g.dispatch({ type: 'cashOut' }));
    buy(g, 'savings_account');
    expect(g.modifiers().interestCap).toBe(8);
    expect(winRound(g).interest).toBe(8);
    ok(g.dispatch({ type: 'cashOut' }));
    buy(g, 'building_savings');
    expect(g.modifiers().interestCap).toBe(12);
    expect(winRound(g).interest).toBe(12);
  });

  it('strop jen omezuje: s 20 Kč je úrok stále 4 Kč', () => {
    const g = shopWith('savings_account');
    g._core.state.money = 20;
    expect(winRound(g).interest).toBe(4);
  });
});

describe('8 Úzký věšák / Pořádný věšák', () => {
  it('Úzký věšák: +1 slot žolíka, −1 karta v ruce; Pořádný věšák vrátí kartu', () => {
    const g = shopWith('narrow_rack');
    expect(g.modifiers()).toMatchObject({ jokerSlots: 6, handSize: 7 });
    expect(g._core.api.jokerSlots()).toBe(6);
    startRound(g);
    expect(g.state.round!.hand).toHaveLength(7);
    toShop(g);
    buy(g, 'proper_rack');
    expect(g.modifiers()).toMatchObject({ jokerSlots: 6, handSize: 8 });
    startRound(g);
    expect(g.state.round!.hand).toHaveLength(8);
  });
});

describe('9 Trhací kalendář / Babiččina spíž', () => {
  it('Trhací kalendář: váha pranostik a babských rad 3 → 7; spotřebky ve Večerce častěji', () => {
    const plain = game();
    toShop(plain);
    const share = (items: ShopItem[]) =>
      items.filter((it) => ['pranostika', 'rada'].includes(kindOf(it))).length / items.length;
    const before = share(sampleItems(plain, 300));
    const g = shopWith('tear_calendar');
    expect(g.modifiers()).toMatchObject({ shopWeightPranostika: 7, shopWeightRada: 7, shopWeightJoker: 14 });
    const after = share(sampleItems(g, 300));
    // Očekávaný podíl 6/20 = 30 % → 14/28 = 50 %.
    expect(before).toBeGreaterThan(0.22);
    expect(before).toBeLessThan(0.38);
    expect(after).toBeGreaterThan(0.42);
    expect(after).toBeLessThan(0.58);
  });

  it('Babiččina spíž: +1 slot spotřebky, ve Večerce i razítka (bez spíže nikdy), váhy 8,5', () => {
    const plain = game();
    toShop(plain);
    expect(sampleItems(plain, 200).some((it) => kindOf(it) === 'razitko')).toBe(false);
    const g = shopWith('tear_calendar', 'grandmas_pantry');
    expect(g.modifiers()).toMatchObject({
      consumableSlots: 3,
      shopWeightRazitko: 2,
      shopWeightPranostika: 8.5,
      shopWeightRada: 8.5,
    });
    const razitka = sampleItems(g, 200).filter((it) => kindOf(it) === 'razitko');
    expect(razitka.length).toBeGreaterThan(0);
    for (const it of razitka) expect(it.price).toBe(6);
  });
});

describe('10 Stánek s kartami / Kartářka', () => {
  it('Stánek s kartami: ve Večerce se objevují hrací karty (bez kupónu nikdy); vylepšení ~20 %, pečeť 0 %', () => {
    const plain = game();
    toShop(plain);
    expect(sampleItems(plain, 200).some((it) => it.kind === 'card')).toBe(false);
    const g = shopWith('card_stall');
    expect(g.modifiers().shopWeightPlayingCard).toBe(5);
    const cards = sampleItems(g, 400).flatMap((it) => (it.kind === 'card' ? [it.card] : []));
    expect(cards.length).toBeGreaterThan(100);
    const enhanced = cards.filter((c) => c.enhancement).length / cards.length;
    expect(enhanced).toBeGreaterThan(0.12);
    expect(enhanced).toBeLessThan(0.28);
    expect(cards.some((c) => c.seal)).toBe(false);
  });

  it('Kartářka: vylepšení 50 %, pečeť 20 %', () => {
    const g = shopWith('card_stall', 'fortune_teller');
    expect(g.modifiers().playingCardEnhanceChance).toBe(0.5);
    expect(g.modifiers().playingCardSealChance).toBe(0.2);
    const cards = sampleItems(g, 600).flatMap((it) => (it.kind === 'card' ? [it.card] : []));
    expect(cards.length).toBeGreaterThan(200);
    const enhanced = cards.filter((c) => c.enhancement).length / cards.length;
    const sealed = cards.filter((c) => c.seal).length / cards.length;
    expect(enhanced).toBeGreaterThan(0.42);
    expect(enhanced).toBeLessThan(0.58);
    expect(sealed).toBeGreaterThan(0.13);
    expect(sealed).toBeLessThan(0.27);
  });
});

describe('11 Leštěnka / Hologramová fólie', () => {
  /** Podíl žolíků s lesklou/holografickou/duhovou edicí ve vzorku nabídek. */
  function editionShare(g: Game, n: number): number {
    const jokers = sampleItems(g, n).flatMap((it) => (it.kind === 'joker' ? [it.joker] : []));
    return jokers.filter((j) => j.edition && j.edition !== 'negative').length / jokers.length;
  }

  it('Leštěnka ×2,5 a Hologramová fólie celkem ×3,5 (šance 4,4 % → 11 % → 15,4 %)', () => {
    const plain = game();
    toShop(plain);
    const base = editionShare(plain, 1500);
    const g = shopWith('polish');
    expect(g.modifiers().editionRateMult).toBe(2.5);
    const polished = editionShare(g, 1500);
    buy(g, 'holo_foil');
    expect(g.modifiers().editionRateMult).toBe(3.5);
    const foiled = editionShare(g, 1500);
    expect(base).toBeLessThan(0.07);
    expect(polished).toBeGreaterThan(0.08);
    expect(polished).toBeLessThan(0.14);
    expect(foiled).toBeGreaterThan(0.12);
    expect(foiled).toBeLessThan(0.19);
  });
});

describe('12 Úřední škrt / Amnestie', () => {
  /** Hra ve Večerce po Malé útratě v daném patře. */
  function shopAtAnte(ante: number): Game {
    const g = game(200);
    g._core.state.ante = ante;
    toShop(g);
    return g;
  }

  it('Úřední škrt: patro hned −1 (událost anteChanged), cíle útrat do konce runu ×1,1', () => {
    const g = shopAtAnte(3);
    const events = buy(g, 'official_strike');
    expect(g.state.ante).toBe(2);
    expect(events.filter((e) => e.type === 'anteChanged')).toEqual([{ type: 'anteChanged', ante: 2 }]);
    expect(g.modifiers().targetMult).toBe(1.1);
    // Pokračuje se další útratou v pořadí (Velká) s cíli nového patra.
    startRound(g);
    expect(g.state.round!.blind).toBe('big');
    const expected = blindTarget(2, 'big', 1, { targetMult: 1.1 });
    expect(g.state.round!.target).toBe(expected);
    expect(expected).toBeGreaterThan(blindTarget(2, 'big', 1));
  });

  it('Úřední škrt v patře 1: nenabízí se a koupit nejde (cannotUse, stav beze změny)', () => {
    const g = shopAtAnte(1);
    expect(eligibleVouchers(g._core)).not.toContain('official_strike');
    g._core.state.shop!.vouchers = [{ voucherId: 'official_strike', price: 12, sold: false }];
    const before = JSON.stringify(g.state);
    expect(g.dispatch({ type: 'buyVoucher', slot: 0 })).toMatchObject({ ok: false, error: 'cannotUse' });
    expect(JSON.stringify(g.state)).toBe(before);
  });

  it('Amnestie: další −1 patro a ve Večerce hned všechno o 1 Kč dražší (i přehození), prodej beze změny', () => {
    const g = shopAtAnte(4);
    buy(g, 'official_strike');
    expect(g.state.ante).toBe(3);
    const shop = g.state.shop!;
    const items = shop.items.map((i) => i.price);
    const boosters = shop.boosters.map((b) => b.price);
    const reroll = shop.rerollCost;
    buy(g, 'amnesty');
    expect(g.state.ante).toBe(2);
    expect(g.modifiers().shopPriceAdd).toBe(1);
    expect(g.modifiers().targetMult).toBe(1.1);
    expect(g.state.shop!.items.map((i) => i.price)).toEqual(items.map((p) => p + 1));
    expect(g.state.shop!.boosters.map((b) => b.price)).toEqual(boosters.map((p) => p + 1));
    expect(g.state.shop!.rerollCost).toBe(reroll + 1);
  });

  it('Amnestie v patře 1 nejde (ani s vlastněným Úředním škrtem)', () => {
    const g = shopAtAnte(2);
    buy(g, 'official_strike');
    expect(g.state.ante).toBe(1);
    expect(eligibleVouchers(g._core)).not.toContain('amnesty');
    g._core.state.shop!.vouchers = [{ voucherId: 'amnesty', price: 14, sold: false }];
    expect(g.dispatch({ type: 'buyVoucher', slot: 0 })).toMatchObject({ ok: false, error: 'cannotUse' });
    g._core.state.ante = 2;
    expect(eligibleVouchers(g._core)).toContain('amnesty');
  });
});

// ─────────────────────────── Engine (obecně) ───────────────────────────

describe('engine: VoucherDef.available a syncShopSlots', () => {
  it('available je čistá funkce: kontrola neposune RNG ani stav; neznámý kupón není dostupný', () => {
    let calls = 0;
    const reg = registry();
    reg.vouchers = {
      gated: {
        id: 'gated',
        tier: 1,
        cost: 8,
        art: ART,
        available: (ctx) => {
          calls++;
          ctx.rng.next();
          return ctx.state.money >= 100;
        },
      },
    };
    const g = makeGame({ registry: reg, money: 50 });
    const rng = JSON.stringify(g.state.rng);
    expect(voucherAvailable(g._core, 'gated')).toBe(false);
    expect(eligibleVouchers(g._core)).toEqual([]);
    g._core.state.money = 100;
    expect(eligibleVouchers(g._core)).toEqual(['gated']);
    expect(voucherAvailable(g._core, 'unknown')).toBe(false);
    expect(calls).toBeGreaterThan(0);
    expect(JSON.stringify(g.state.rng)).toBe(rng);
  });

  it('syncShopSlots doplní chybějící sloty, ale nikdy neubírá', () => {
    const g = game();
    toShop(g);
    const shop = g._core.state.shop!;
    shop.items = shop.items.slice(0, 1);
    syncShopSlots(g._core, shop);
    expect(shop.items).toHaveLength(2);
    g._core.state.extraModifiers = { shopCardSlots: -1, shopBoosterSlots: -2 };
    g._core.invalidate();
    const before = JSON.stringify(shop);
    syncShopSlots(g._core, shop);
    expect(JSON.stringify(shop)).toBe(before);
  });
});
