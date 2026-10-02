/**
 * Revize obsahu fáze 5 — kombinace se skutečným enginem (Game + dispatch) a celým obsahem hry:
 *
 *  - každá spotřebka (pranostiky, babské rady, razítka) v kole šéfa, s prázdnou rukou, na výběru útraty,
 *    ve Večerce přes „Koupit a použít“ (s volnými i plnými sloty) a v obálce (použít hned / nechat si) — výsledek
 *    přesně podle DESIGN 5.1 (cíle jen v kole a v obálce s rukou, „jen v kole“, tvorba spotřebek potřebuje slot),
 *    `canUseConsumable` sedí s `dispatch`, neúspěch nezmění stav, úspěch nechá JSON-bezpečný stav,
 *  - tajné pranostiky se netvoří ani nenabízejí před objevem kombinace,
 *  - každý kupón přežije uložení a načtení (modifikátory, stav i další průběh runu shodné),
 *  - chaos fuzz přes všechny akce (spotřebky s náhodnými cíli, Večerka, obálky, kupóny) a boti na všech balíčcích:
 *    žádná výjimka, žádná neplatná akce botů, stav po uložení a načtení stejný.
 *
 * Registr = skutečný obsah + testoví šéfové (skutečné šéfy přinese fáze 6; Odvolání potřebuje šéfovské pravidlo)
 * + dva testoví legendární žolíci (skutečné přinese fáze 7; Výjimka z vyhlášky potřebuje legendárního žolíka).
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import type { ConsumableDef, ContentRegistry, Rng } from '../../src/engine/content-types';
import { addConsumableInstance, newConsumableInstance } from '../../src/engine/effects/api';
import { cyrb128, rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { eligibleVouchers, voucherOffers } from '../../src/engine/shop/shop';
import { BOT_NAMES, createBot } from '../../src/engine/sim/index';
import type { Action, ActionResult, HandType } from '../../src/engine/types';
import { joker, makeGame, selectBoss, TEST_BOSSES, winNextHand } from './fixtures/registry';

// ─────────────────────────── Registr a pomocníci ───────────────────────────

function fullRegistry(): ContentRegistry {
  const reg = buildRegistry();
  reg.bosses = { ...reg.bosses, ...Object.fromEntries(TEST_BOSSES.map((b) => [b.id, b])) };
  reg.jokers = {
    ...reg.jokers,
    legend_a: joker('legend_a', {
      rarity: 'legendary',
      cost: 16,
      hooks: { onHandPlayed: () => ({ xmult: 2 }) },
    }),
    legend_b: joker('legend_b', { rarity: 'legendary', cost: 16 }),
  };
  return reg;
}

const reg = fullRegistry();
const CONSUMABLES: ConsumableDef[] = Object.values(reg.consumables).sort((a, b) => (a.id < b.id ? -1 : 1));
const IDS = CONSUMABLES.map((c) => c.id);
const TARGETED = new Set(CONSUMABLES.filter((c) => c.target).map((c) => c.id));
/** Spotřebky bez cíle, které přesto potřebují běžící kolo (Studený obklad, Odvolání) nebo ruku (Zpětný odběr). */
const NEEDS_ROUND = new Set(['cold_compress', 'appeal']);
const NEEDS_HAND = new Set(['buyback']);
/** Spotřebky, které vytvoří spotřebku nebo ubírají slot spotřebky — s plnými sloty nejdou (DESIGN 5.1). */
const NEEDS_CONSUMABLE_SLOT = new Set(['tree_frog', 'grandmas_recipe', 'occupancy_permit']);

/** Dva skuteční běžní žolíci: první bez nálepky (Kouzelný kotlík, Ověřená kopie), druhý zapůjčený (Prominutí pokut). */
const COMMONS = JOKERS.filter((j) => j.rarity === 'common')
  .map((j) => j.id)
  .sort()
  .slice(0, 2);

/**
 * „Bohatá“ hra, ve které má každá spotřebka platný cíl: 2 žolíci bez edice (jeden zapůjčený), 30 Kč, naposledy
 * použitá pranostika (Babiččin recept), volný slot žolíka (Výjimka z vyhlášky, Daňové přiznání).
 */
function richGame(seed = 'REVIEW5'): Game {
  const g = makeGame({
    registry: reg,
    seed,
    deckId: 'pub',
    money: 30,
    jokers: [{ id: COMMONS[0]! }, { id: COMMONS[1]!, stickers: ['rental'] }],
  });
  g._core.state.lastConsumable = 'hen_step';
  return g;
}

function give(g: Game, id: string): number {
  const inst = newConsumableInstance(g._core, id);
  addConsumableInstance(g._core, inst, true);
  return inst.uid;
}

/** Stav musí jít uložit a načíst beze změny a nesmí obsahovat NaN, nekonečno ani undefined. */
function expectJsonSafe(g: Game, label: string): void {
  const bad: string[] = [];
  const walk = (x: unknown, path: string): void => {
    if (typeof x === 'number' && !Number.isFinite(x)) bad.push(path);
    else if (x === undefined) bad.push(path);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
  };
  walk(g.state, 'state');
  expect(bad, label).toEqual([]);
  const loaded = Game.fromState(deserializeRun(serializeRun(g.state)), reg);
  expect(JSON.stringify(loaded.state), label).toBe(JSON.stringify(g.state));
  expect(loaded.modifiers(), label).toEqual(g.modifiers());
}

/**
 * Provede akci a ověří její výsledek: `expected` = 'ok' nebo kód chyby. Neúspěch nesmí změnit stav, úspěch musí
 * nechat JSON-bezpečný stav.
 */
function expectOutcome(g: Game, action: Action, expected: 'ok' | string, label: string): ActionResult {
  const before = JSON.stringify(g.state);
  const res = g.dispatch(action);
  expect(res.ok ? 'ok' : res.error, label).toBe(expected);
  if (res.ok) expectJsonSafe(g, label);
  else expect(JSON.stringify(g.state), `${label}: neúspěch změnil stav`).toBe(before);
  return res;
}

/**
 * Platné cíle pro spotřebku z dané hromádky (nebo nic): nejvýš `max` karet, u rad, které by jinak nic nezměnily,
 * karty, na kterých se něco stane (Babiččina barva: levá + karty jiné barvy; Zrcátko: různé hodnoty; Kynuté
 * těsto: ne esa).
 */
function targetsFor(g: Game, def: ConsumableDef, pool: readonly number[]): number[] {
  if (!def.target) return [];
  const cards = pool.map((id) => g._core.mustCard(id));
  const max = def.target.max;
  let picked = cards;
  if (def.id === 'grandmas_dye') picked = [cards[0]!, ...cards.filter((c) => c.suit !== cards[0]!.suit)];
  if (def.id === 'hall_mirror') picked = [cards[0]!, cards.find((c) => c.rank !== cards[0]!.rank)!];
  if (def.id === 'risen_dough') picked = cards.filter((c) => c.rank < 14);
  // Pořadí v ruce (levá/pravá karta) určuje engine sám.
  return picked.slice(0, max).map((c) => c.id);
}

/** Hra ve Večerce (po vyhrané Malé útratě) s penězi na nákup. */
function richShop(seed: string): Game {
  const g = richGame(seed);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  winNextHand(g);
  expect(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }).ok).toBe(true);
  expect(g.dispatch({ type: 'cashOut' }).ok).toBe(true);
  expect(g.state.phase).toBe('shop');
  g._core.state.money = 30;
  return g;
}

/** Vystaví spotřebku v prvním kartovém slotu Večerky. */
function stock(g: Game, id: string): void {
  const def = reg.consumables[id]!;
  g._core.state.shop!.items[0] = {
    kind: 'consumable',
    consumable: newConsumableInstance(g._core, id),
    consumableKind: def.kind,
    price: def.cost,
    sold: false,
  };
}

/** Otevře obálku druhu spotřebky (babská a razítková dobere ruku) a dá spotřebku na první místo. */
function boosterWith(seed: string, id: string): Game {
  const g = richGame(seed);
  const def = reg.consumables[id]!;
  g.startBooster(`${def.kind}_normal`, 'blind_select');
  g._core.state.booster!.options[0] = {
    kind: 'consumable',
    consumable: newConsumableInstance(g._core, id),
    consumableKind: def.kind,
  };
  return g;
}

// ─────────────────────────── Spotřebky × kontext ───────────────────────────

describe('každá spotřebka v každém kontextu (DESIGN 5.1)', () => {
  it('máme všech 51 spotřebek a dva skutečné běžné žolíky pro „bohatou“ hru', () => {
    expect(IDS).toHaveLength(13 + 22 + 16);
    expect(COMMONS).toHaveLength(2);
  });

  it.each(IDS.map((id) => [id]))('%s: v kole šéfa s plnou rukou jde použít (platný cíl existuje)', (id) => {
    const g = richGame(`R5-BOSS-${id}`);
    selectBoss(g, 'heart_ban');
    g._core.state.round!.target = 1e12;
    const uid = give(g, id);
    const targets = targetsFor(g, reg.consumables[id]!, g.state.round!.hand);
    expect(g.canUseConsumable(uid, targets), id).toBe(true);
    expectOutcome(g, { type: 'useConsumable', uid, targetIds: targets }, 'ok', id);
    expect(
      g.state.consumables.some((c) => c.uid === uid),
      id,
    ).toBe(false);
    expect(g.state.lastConsumable).toBe(id);
  });

  it.each(IDS.map((id) => [id]))(
    '%s: v kole s prázdnou rukou — spotřebky s cílem a Zpětný odběr ne',
    (id) => {
      const g = richGame(`R5-EMPTY-${id}`);
      selectBoss(g, 'heart_ban');
      const round = g._core.state.round!;
      round.target = 1e12;
      round.drawPile.push(...round.hand);
      round.hand = [];
      const uid = give(g, id);
      const expected = TARGETED.has(id) || NEEDS_HAND.has(id) ? 'cannotUse' : 'ok';
      expect(g.canUseConsumable(uid, []), id).toBe(expected === 'ok');
      expectOutcome(g, { type: 'useConsumable', uid, targetIds: [] }, expected, id);
    },
  );

  it.each(IDS.map((id) => [id]))('%s: na výběru útraty — jen spotřebky bez cíle a mimo kolo', (id) => {
    const g = richGame(`R5-SEL-${id}`);
    const uid = give(g, id);
    const blocked = TARGETED.has(id) || NEEDS_ROUND.has(id) || NEEDS_HAND.has(id);
    expectOutcome(g, { type: 'useConsumable', uid, targetIds: [] }, blocked ? 'cannotUse' : 'ok', id);
  });

  it.each(IDS.map((id) => [id]))('%s: Večerka — „Koupit a použít“ s volnými i plnými sloty', (id) => {
    const blocked = TARGETED.has(id) || NEEDS_ROUND.has(id) || NEEDS_HAND.has(id);
    // volné sloty
    const free = richShop(`R5-SHOP-${id}`);
    stock(free, id);
    const money = free.state.money;
    expectOutcome(free, { type: 'buyAndUse', slot: 0 }, blocked ? 'cannotUse' : 'ok', `${id} volné sloty`);
    if (!blocked) {
      expect(free.state.shop!.items[0]!.sold).toBe(true);
      expect(free.state.lastConsumable).toBe(id);
      // Pranostika na peníze nesahá: zaplatí se právě cena.
      if (reg.consumables[id]!.kind === 'pranostika') expect(free.state.money, id).toBe(money - 3);
    }
    // plné sloty (2 jiné spotřebky)
    const full = richShop(`R5-SHOPF-${id}`);
    stock(full, id);
    give(full, 'hen_step');
    give(full, 'philip_jacob');
    expect(full.state.consumables).toHaveLength(full.modifiers().consumableSlots);
    const fullBlocked = blocked || NEEDS_CONSUMABLE_SLOT.has(id);
    expectOutcome(full, { type: 'buyAndUse', slot: 0 }, fullBlocked ? 'cannotUse' : 'ok', `${id} plné sloty`);
    // sloty spotřebek se nikdy nepřeplní
    expect(full.state.consumables.length).toBeLessThanOrEqual(full.modifiers().consumableSlots);
    // obyčejná koupě do plných slotů nejde
    expectOutcome(full, { type: 'buy', slot: 0 }, fullBlocked ? 'slotsFull' : 'soldOut', `${id} koupě`);
  });

  it.each(IDS.map((id) => [id]))('%s: obálka — použít hned na ruku obálky, nebo nechat do slotu', (id) => {
    const def = reg.consumables[id]!;
    // Studený obklad, Česnek na krk a Odvolání jen v kole; Zpětný odběr bere ruku obálky.
    const blocked = NEEDS_ROUND.has(id) || id === 'garlic';
    const g = boosterWith(`R5-BOOST-${id}`, id);
    const hand = g.state.booster!.hand;
    if (def.kind !== 'pranostika') expect(hand.length).toBe(g.modifiers().handSize);
    expectOutcome(
      g,
      { type: 'pickBooster', index: 0, targetIds: targetsFor(g, def, hand) },
      blocked ? 'cannotUse' : 'ok',
      `${id} použít`,
    );
    if (!blocked) {
      expect(g.state.phase).toBe('blind_select');
      expect(g.state.lastConsumable).toBe(id);
    }
    // nechat si: s volným slotem ano, s plnými sloty ne
    const keep = boosterWith(`R5-KEEP-${id}`, id);
    expectOutcome(keep, { type: 'pickBooster', index: 0, keep: true }, 'ok', `${id} nechat`);
    expect(keep.state.consumables.map((c) => c.defId)).toEqual([id]);
    const keepFull = boosterWith(`R5-KEEPF-${id}`, id);
    give(keepFull, 'hen_step');
    give(keepFull, 'philip_jacob');
    expectOutcome(keepFull, { type: 'pickBooster', index: 0, keep: true }, 'slotsFull', `${id} nechat plné`);
  });

  it('špatný počet cílů = cannotUse pro každou spotřebku s cílem (o jednu méně i víc)', () => {
    for (const def of CONSUMABLES.filter((c) => c.target)) {
      const g = richGame(`R5-COUNT-${def.id}`);
      selectBoss(g, 'heart_ban');
      const hand = g.state.round!.hand;
      const uid = give(g, def.id);
      for (const n of [def.target!.min - 1, def.target!.max + 1]) {
        if (n < 0) continue;
        expectOutcome(
          g,
          { type: 'useConsumable', uid, targetIds: hand.slice(0, n) },
          'cannotUse',
          `${def.id} ${n}`,
        );
      }
      // cíl mimo ruku ani duplicitní cíl
      const outside = g.state.deck.find((c) => !hand.includes(c.id))!.id;
      expectOutcome(
        g,
        { type: 'useConsumable', uid, targetIds: [outside] },
        'cannotUse',
        `${def.id} mimo ruku`,
      );
      if (def.target!.max >= 2)
        expectOutcome(
          g,
          { type: 'useConsumable', uid, targetIds: [hand[0]!, hand[0]!] },
          'cannotUse',
          `${def.id} duplicita`,
        );
    }
  });

  it('negativní spotřebka použitá ze slotu si odnese i svůj slot (Rosnička, Babiččin recept, Kolaudace)', () => {
    for (const id of ['tree_frog', 'grandmas_recipe', 'occupancy_permit']) {
      const g = richGame(`R5-NEG-${id}`);
      const inst = newConsumableInstance(g._core, id, 'negative');
      addConsumableInstance(g._core, inst, true);
      give(g, 'hen_step');
      give(g, 'philip_jacob');
      // 2 sloty + 1 z negativní edice = 3; po použití zbudou 2 sloty pro 2 jiné spotřebky — nic se nevejde.
      expect(g.modifiers().consumableSlots).toBe(3);
      expectOutcome(g, { type: 'useConsumable', uid: inst.uid, targetIds: [] }, 'cannotUse', id);
      g._core.state.consumables.pop();
      g._core.invalidate();
      expectOutcome(g, { type: 'useConsumable', uid: inst.uid, targetIds: [] }, 'ok', `${id} s místem`);
      expect(g.state.consumables.length, id).toBeLessThanOrEqual(g.modifiers().consumableSlots);
    }
  });

  it('spotřebky bez cíle odmítnou jakýkoli cíl', () => {
    for (const def of CONSUMABLES.filter((c) => !c.target)) {
      const g = richGame(`R5-NOTGT-${def.id}`);
      selectBoss(g, 'heart_ban');
      const uid = give(g, def.id);
      expectOutcome(
        g,
        { type: 'useConsumable', uid, targetIds: [g.state.round!.hand[0]!] },
        'cannotUse',
        def.id,
      );
    }
  });
});

// ─────────────────────────── Tajné pranostiky ───────────────────────────

describe('tajné pranostiky jen po objevu kombinace', () => {
  const SECRET: Record<string, HandType> = {
    candlemas: 'five',
    catherine_ice: 'flush_house',
    lucy_night: 'flush_five',
  };

  it('createConsumable (Rosnička, modrá pečeť, štítky) ani obálka je před objevem nevytvoří, po objevu ano', () => {
    const g = richGame('R5-SECRET');
    const core = g._core;
    const made = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = core.api.createConsumable({ kind: 'pranostika', ignoreSlots: true });
      if (c) made.add(c.defId);
    }
    for (const id of Object.keys(SECRET)) expect(made.has(id), id).toBe(false);
    expect(made.size).toBe(10);
    for (let i = 0; i < 30; i++) {
      g.startBooster('pranostika_mega', 'blind_select');
      for (const o of g.state.booster!.options)
        if (o.kind === 'consumable') expect(Object.keys(SECRET)).not.toContain(o.consumable.defId);
      expect(g.dispatch({ type: 'skipBooster' }).ok).toBe(true);
    }
    core.state.discoveredHands.push('five', 'flush_house', 'flush_five');
    for (let i = 0; i < 800; i++) {
      const c = core.api.createConsumable({ kind: 'pranostika', ignoreSlots: true });
      if (c) made.add(c.defId);
    }
    expect(made.size).toBe(13);
  });

  it('pranostiku tajné kombinace, kterou už hráč drží, jde použít i bez objevu', () => {
    for (const [id, hand] of Object.entries(SECRET)) {
      const g = richGame(`R5-SECRETUSE-${id}`);
      const uid = give(g, id);
      const before = g.state.handLevels[hand].level;
      expectOutcome(g, { type: 'useConsumable', uid, targetIds: [] }, 'ok', id);
      expect(g.state.handLevels[hand].level).toBe(before + 1);
    }
  });
});

// ─────────────────────────── Kupóny + uložení ───────────────────────────

describe('každý kupón přežije uložení a načtení', () => {
  const VOUCHER_IDS = Object.keys(reg.vouchers).sort();

  function buyVoucher(g: Game, id: string): void {
    const s = g._core.state;
    s.anteVouchers = [id];
    s.shop!.vouchers = voucherOffers(g._core);
    const res = g.dispatch({ type: 'buyVoucher', slot: 0 });
    if (!res.ok) throw new Error(`buyVoucher ${id}: ${res.error}`);
  }

  it.each(VOUCHER_IDS.map((id) => [id]))('%s: koupě → uložit → načíst → stejný stav i další průběh', (id) => {
    const g = richShop(`R5-V-${id}`);
    g._core.state.money = 100;
    const def = reg.vouchers[id]!;
    // „−1 patro“ až od patra 2 (Amnestie potřebuje patro 2 i po Úředním škrtu)
    if (def.available) g._core.state.ante = 3;
    if (def.requires) buyVoucher(g, def.requires);
    buyVoucher(g, id);
    expect(g.state.vouchers).toContain(id);
    expectJsonSafe(g, id);

    const loaded = Game.fromState(deserializeRun(serializeRun(g.state)), reg);
    expect(loaded.modifiers()).toEqual(g.modifiers());
    // Další průběh: přehodit, odejít, vybrat útratu, zahrát — obě hry dopadnou stejně.
    const script: Action[] = [{ type: 'reroll' }, { type: 'leaveShop' }, { type: 'selectBlind' }];
    for (const a of script) {
      const r1 = g.dispatch(a);
      const r2 = loaded.dispatch(a);
      expect(r2.ok, `${id} ${a.type}`).toBe(r1.ok);
    }
    const play: Action = { type: 'play', cardIds: g.state.round!.hand.slice(0, 2) };
    expect(loaded.dispatch(play).ok).toBe(g.dispatch(play).ok);
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(g.state));
    expect(loaded.modifiers()).toEqual(g.modifiers());
  });
});

// ─────────────────────────── Fuzz ───────────────────────────

/** Náhodná podmnožina hromádky dané velikosti. */
function pickSome(r: Rng, pool: readonly number[], n: number): number[] {
  return r.shuffle([...pool]).slice(0, Math.max(0, Math.min(n, pool.length)));
}

/** Kandidátní akce chaos bota pro aktuální fázi (platné i neplatné). */
function chaosCandidates(g: Game, r: Rng): Action[] {
  const s = g.state;
  const acts: Action[] = [];
  const consumableActs = (): void => {
    const pool = s.phase === 'booster' ? s.booster!.hand : s.phase === 'round' ? s.round!.hand : [];
    for (const c of s.consumables) {
      const d = reg.consumables[c.defId]!;
      for (let k = 0; k < 3; k++) {
        const n = d.target ? r.int(d.target.min, d.target.max) : 0;
        acts.push({ type: 'useConsumable', uid: c.uid, targetIds: pickSome(r, pool, n) });
      }
      if (r.next() < 0.05) acts.push({ type: 'sellConsumable', uid: c.uid });
    }
    if (s.jokers.length && r.next() < 0.03) acts.push({ type: 'sellJoker', uid: r.pick(s.jokers).uid });
    if (s.jokers.length > 1 && r.next() < 0.1)
      acts.push({ type: 'reorderJokers', uids: r.shuffle(s.jokers.map((j) => j.uid)) });
  };
  switch (s.phase) {
    case 'blind_select':
      acts.push({ type: 'selectBlind' }, { type: 'skipBlind' });
      consumableActs();
      break;
    case 'round': {
      const hand = s.round!.hand;
      for (let k = 0; k < 3; k++)
        acts.push({ type: 'play', cardIds: pickSome(r, hand, r.int(1, Math.min(5, hand.length))) });
      acts.push({ type: 'discard', cardIds: pickSome(r, hand, r.int(1, Math.min(5, hand.length))) });
      consumableActs();
      consumableActs();
      break;
    }
    case 'round_end':
      acts.push({ type: 'cashOut' });
      consumableActs();
      break;
    case 'shop': {
      const shop = s.shop!;
      shop.items.forEach((it, i) => {
        if (!it.sold) acts.push({ type: 'buy', slot: i }, { type: 'buyAndUse', slot: i });
      });
      shop.boosters.forEach((b, i) => {
        if (!b.sold) acts.push({ type: 'buyBooster', slot: i });
      });
      shop.vouchers.forEach((v, i) => {
        if (!v.sold) acts.push({ type: 'buyVoucher', slot: i });
      });
      acts.push({ type: 'reroll' }, { type: 'leaveShop' });
      consumableActs();
      break;
    }
    case 'booster': {
      const b = s.booster!;
      b.options.forEach((o, i) => {
        const d = o.kind === 'consumable' ? reg.consumables[o.consumable.defId]! : null;
        for (let k = 0; k < 2; k++) {
          const n = d?.target ? r.int(d.target.min, d.target.max) : 0;
          acts.push({ type: 'pickBooster', index: i, targetIds: pickSome(r, b.hand, n) });
        }
        acts.push({ type: 'pickBooster', index: i, keep: true });
      });
      acts.push({ type: 'skipBooster' });
      consumableActs();
      break;
    }
    default:
      break;
  }
  return acts;
}

/** Bezpečná akce fáze, když chaos bot nic platného nenajde. */
function safeAction(g: Game): Action {
  const s = g.state;
  if (s.phase === 'round') return { type: 'play', cardIds: s.round!.hand.slice(0, 1) };
  if (s.phase === 'shop') return { type: 'leaveShop' };
  if (s.phase === 'booster') return { type: 'skipBooster' };
  if (s.phase === 'round_end') return { type: 'cashOut' };
  if (s.phase === 'victory') return { type: 'continueEndless' };
  return { type: 'selectBlind' };
}

interface FuzzReport {
  actions: number;
  used: Set<string>;
  vouchers: Set<string>;
  boosters: Set<string>;
  problems: string[];
}

/**
 * Chaos run: náhodné akce (spotřebky s náhodnými cíli, nákupy, obálky, kupóny, prodej, přeřazení). Platnost akce
 * se zjistí na kopii hry; skutečná hra pak musí dopadnout stejně (canUse/dispatch konzistentní a deterministické).
 * Občas pošle i neplatnou akci — ta nesmí změnit stav. Do slotů, Večerky a obálek vnucuje náhodný obsah, aby se
 * vystřídalo všechno; 85 % kol má cíl 1, aby run došel daleko.
 */
function chaosRun(run: number, out: FuzzReport): void {
  const CONS = IDS;
  const BOOSTERS = Object.keys(reg.boosters).sort();
  const decks = Object.keys(reg.decks).sort();
  const seed = `CHAOS-${run}`;
  const r = rngFromState(cyrb128(`${seed}:chaos`));
  const g = Game.newRun({ seed, deckId: decks[run % decks.length]!, stake: 1 + (run % 8) }, reg);
  let roundKey = '';
  let shopKey = '';
  for (let step = 0; step < 1200 && g.state.phase !== 'game_over'; step++) {
    const s = g._core.state;
    if (s.phase === 'round' && roundKey !== `${s.ante}:${s.round!.blind}:${s.stats.roundsWon}`) {
      roundKey = `${s.ante}:${s.round!.blind}:${s.stats.roundsWon}`;
      if (r.next() < 0.85) s.round!.target = 1;
      if (r.next() < 0.5 && s.consumables.length < 4) give(g, r.pick(CONS));
    }
    if (s.phase === 'shop' && shopKey !== `${s.ante}:${s.stats.roundsWon}`) {
      shopKey = `${s.ante}:${s.stats.roundsWon}`;
      s.money = Math.max(s.money, 25);
      for (const it of s.shop!.items) {
        if (it.kind !== 'consumable' || r.next() >= 0.7) continue;
        const id = r.pick(CONS);
        it.consumable = newConsumableInstance(g._core, id);
        it.consumableKind = reg.consumables[id]!.kind;
      }
      for (const b of s.shop!.boosters) if (r.next() < 0.7) b.boosterId = r.pick(BOOSTERS);
      const eligible = eligibleVouchers(g._core);
      if (eligible.length && s.shop!.vouchers.length) s.shop!.vouchers[0]!.voucherId = r.pick(eligible);
      g._core.invalidate();
    }
    let done = false;
    for (const a of r.shuffle(chaosCandidates(g, r)).slice(0, 12)) {
      if (a.type === 'leaveShop' && r.next() < 0.7) continue;
      if (a.type === 'skipBooster' && r.next() < 0.6) continue;
      const probe = Game.fromState(JSON.parse(JSON.stringify(g.state)), reg).dispatch(a);
      if (!probe.ok) {
        if (r.next() < 0.05) {
          const before = JSON.stringify(g.state);
          const res = g.dispatch(a);
          if (res.ok) out.problems.push(`${seed}#${step}: kopie odmítla, hra přijala ${JSON.stringify(a)}`);
          else if (JSON.stringify(g.state) !== before)
            out.problems.push(`${seed}#${step}: neúspěch změnil stav`);
        }
        continue;
      }
      const res = g.dispatch(a);
      out.actions++;
      if (!res.ok) {
        out.problems.push(`${seed}#${step}: kopie přijala, hra odmítla (${res.error}) ${JSON.stringify(a)}`);
        continue;
      }
      for (const e of res.events) {
        if (e.type === 'consumableUsed') out.used.add(e.defId);
        if (e.type === 'voucherRedeemed') out.vouchers.add(e.voucherId);
        if (e.type === 'boosterOpened') out.boosters.add(e.boosterId);
      }
      done = true;
      break;
    }
    if (!done) {
      const res = g.dispatch(safeAction(g));
      if (!res.ok) {
        out.problems.push(`${seed}#${step}: bezpečná akce selhala (${res.error}) ve fázi ${s.phase}`);
        break;
      }
    }
    if (step % 50 === 0) expectJsonSafe(g, `${seed}#${step}`);
  }
  expectJsonSafe(g, `${seed}#konec`);
}

describe('fuzz se vším obsahem', () => {
  it('chaos: 60 runů bez výjimky, canUse = dispatch, neúspěch beze změny stavu, vystřídá se všechno', () => {
    const out: FuzzReport = {
      actions: 0,
      used: new Set(),
      vouchers: new Set(),
      boosters: new Set(),
      problems: [],
    };
    for (let run = 0; run < 60; run++) chaosRun(run, out);
    expect(out.problems).toEqual([]);
    expect(out.actions).toBeGreaterThan(3000);
    expect(IDS.filter((id) => !out.used.has(id))).toEqual([]);
    expect(Object.keys(reg.boosters).filter((id) => !out.boosters.has(id))).toEqual([]);
    expect(Object.keys(reg.vouchers).filter((id) => !out.vouchers.has(id))).toEqual([]);
  }, 120_000);

  it('všichni boti na všech balíčcích (Desítka i Imperial): 0 neplatných akcí, JSON-bezpečný stav', () => {
    for (const name of BOT_NAMES) {
      const bot = createBot(name);
      for (const deckId of Object.keys(reg.decks).sort()) {
        for (const stake of [1, 8]) {
          const g = Game.newRun({ seed: `R5BOT-${name}-${deckId}-${stake}`, deckId, stake }, reg);
          let invalid = 0;
          for (let i = 0; i < 3000 && g.state.phase !== 'game_over' && g.state.phase !== 'victory'; i++) {
            const res = g.dispatch(bot.decide(g));
            if (!res.ok) {
              invalid++;
              if (!g.dispatch(safeAction(g)).ok) break;
            }
          }
          expect(invalid, `${name} ${deckId} ${stake}`).toBe(0);
          expect(['game_over', 'victory']).toContain(g.state.phase);
          expectJsonSafe(g, `${name} ${deckId} ${stake}`);
        }
      }
    }
  }, 240_000);
});
