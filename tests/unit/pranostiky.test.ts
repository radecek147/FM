/**
 * Pranostiky (docs/DESIGN.md kap. 5.2) přes skutečný engine: každá zvedne úroveň právě své kombinace o 1
 * (v kole, mimo kolo, z obálky, z Večerky „Koupit a použít“), nesnese cíle, popisek čte stejná čísla jako
 * tabulka kombinací a pranostiky tajných kombinací se nenabízejí, dokud kombinace v runu není objevená.
 * Obsah: src/content/pranostiky.ts, texty src/i18n/cs/pranostiky.ts.
 */
import { describe, expect, it } from 'vitest';
import { HAND_TYPE_DEFS } from '../../src/content/hands';
import { PRANOSTIKA_COST, PRANOSTIKA_LEVELS, PRANOSTIKY } from '../../src/content/pranostiky';
import type { ConsumableDef, ContentRegistry } from '../../src/engine/content-types';
import { addConsumableInstance, newConsumableInstance } from '../../src/engine/effects/api';
import { consumablePrice } from '../../src/engine/shop/prices';
import { generateBoosterOptions, generateShopItems } from '../../src/engine/shop/shop';
import { Game } from '../../src/engine/run/game';
import type { GameEvent, HandType, ScoreResult } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { booster, makeGame, makeRegistry, play, setupRound } from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Tabulka DESIGN 5.2: kombinace → id pranostiky. */
const TABLE: Record<HandType, string> = {
  high_card: 'hen_step',
  pair: 'philip_jacob',
  two_pair: 'snakes_scorpions',
  three: 'three_kings',
  straight: 'saint_anne',
  flush: 'medard_drop',
  full_house: 'martin_horse',
  four: 'ice_saints',
  straight_flush: 'march_april_may',
  royal_flush: 'saint_wenceslas',
  five: 'candlemas',
  flush_house: 'catherine_ice',
  flush_five: 'lucy_night',
};
const SECRET_IDS = ['candlemas', 'catherine_ice', 'lucy_night'];

/** Registr: testovací obsah, ale ze spotřebek JEN skutečné pranostiky + obálka se všemi možnostmi. */
function registry(): ContentRegistry {
  const reg = makeRegistry({ boosters: [booster('pr_all', { kind: 'pranostika', options: 13, picks: 1 })] });
  reg.consumables = Object.fromEntries(PRANOSTIKY.map((d) => [d.id, d]));
  return reg;
}

function game(round = false): Game {
  return makeGame({ registry: registry(), round, money: 50 });
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Dá pranostiku do slotu a vrátí její uid. */
function give(g: Game, defId: string): number {
  const c = newConsumableInstance(g._core, defId);
  addConsumableInstance(g._core, c, true);
  return c.uid;
}

function levels(g: Game): Record<HandType, number> {
  return Object.fromEntries(HAND_TYPES.map((h) => [h, g.state.handLevels[h].level])) as Record<
    HandType,
    number
  >;
}

/** Základ kombinace ze skutečného skórování (krok `hand`). */
function base(r: ScoreResult): { chips: number; mult: number } {
  const step = r.steps.find((st) => st.source === 'hand');
  if (!step) throw new Error('chybí krok základu kombinace');
  return { chips: step.chipsAfter, mult: step.multAfter };
}

function def(id: string): ConsumableDef {
  const d = PRANOSTIKY.find((x) => x.id === id);
  if (!d) throw new Error(`neznámá pranostika ${id}`);
  return d;
}

// ─────────────────────────── Definice ───────────────────────────

describe('pranostiky — definice (DESIGN 5.2)', () => {
  it('13 pranostik, na každou kombinaci právě jedna, za 3 Kč', () => {
    expect(PRANOSTIKY).toHaveLength(13);
    expect(PRANOSTIKA_COST).toBe(3);
    for (const hand of HAND_TYPES) {
      const forHand = PRANOSTIKY.filter((d) => d.hand === hand);
      expect(
        forHand.map((d) => d.id),
        hand,
      ).toEqual([TABLE[hand]]);
    }
    for (const d of PRANOSTIKY) {
      expect(d.kind, d.id).toBe('pranostika');
      expect(d.cost, d.id).toBe(PRANOSTIKA_COST);
      expect(d.target, d.id).toBeUndefined();
      expect(d.weight ?? 1, d.id).toBe(1);
    }
  });

  it('popisek ukazuje přírůstek za úroveň přesně podle tabulky kombinací', () => {
    for (const d of PRANOSTIKY) {
      const ht = HAND_TYPE_DEFS[d.hand!];
      expect(d.params, d.id).toEqual({
        levels: PRANOSTIKA_LEVELS,
        chips: ht.chipsPerLevel,
        mult: ht.multPerLevel,
      });
      for (const field of ['name', 'desc', 'flavor']) {
        expect(hasKey(`consumables.${d.id}.${field}`), `${d.id}.${field}`).toBe(true);
      }
      const desc = t(`consumables.${d.id}.desc`, d.params);
      expect(desc, d.id).not.toMatch(/[{}]/);
      expect(desc.startsWith(t(`hands.${d.hand}.name`)), d.id).toBe(true);
      expect(t(`consumables.${d.id}.name`).split(/\s+/).length, d.id).toBeLessThanOrEqual(3);
    }
    expect(t('consumables.medard_drop.desc', def('medard_drop').params)).toBe(
      'Barva +1 úroveň (+36 čipů a +4 mult za úroveň).',
    );
  });
});

// ─────────────────────────── Použití ───────────────────────────

describe('pranostiky — použití přes engine', () => {
  it.each(HAND_TYPES.map((h) => [TABLE[h], h] as const))(
    '%s zvedne úroveň kombinace %s o 1 a nic jiného',
    (id, hand) => {
      const g = game(true);
      const before = levels(g);
      const uid = give(g, id);
      const events = ok(g.dispatch({ type: 'useConsumable', uid }));
      expect(levels(g)).toEqual({ ...before, [hand]: before[hand] + 1 });
      expect(events).toContainEqual({ type: 'handLeveled', hand, level: before[hand] + 1, delta: 1 });
      expect(events).toContainEqual({ type: 'consumableUsed', uid, defId: id });
      expect(g.state.consumables).toHaveLength(0);
      expect(g.state.lastConsumable).toBe(id);
    },
  );

  it('vyšší úroveň opravdu přidá čipy a mult podle tabulky (Barva 1 → 2: +36 čipů, +4 mult)', () => {
    const g = game(true);
    const cards = setupRound(g, 'AH 9H 7H 4H 2H');
    g._core.state.round!.target = 1e9;
    const before = play(g, cards).result;
    ok(g.dispatch({ type: 'useConsumable', uid: give(g, 'medard_drop') }));
    const again = setupRound(g, 'AH 9H 7H 4H 2H');
    const after = play(g, again).result;
    expect(before.hand.type).toBe('flush');
    expect(base(after).chips - base(before).chips).toBe(36);
    expect(base(after).mult - base(before).mult).toBe(4);
  });

  it('jde použít i mimo kolo (výběr útraty) a skládá se (2× = +2 úrovně)', () => {
    const g = game(false);
    expect(g.state.phase).toBe('blind_select');
    ok(g.dispatch({ type: 'useConsumable', uid: give(g, 'saint_anne') }));
    ok(g.dispatch({ type: 'useConsumable', uid: give(g, 'saint_anne') }));
    expect(g.state.handLevels.straight.level).toBe(3);
  });

  it('s vybranými kartami použít nejde (pranostika nemá cíl) a stav se nezmění', () => {
    const g = game(true);
    const uid = give(g, 'three_kings');
    const target = g.state.round!.hand[0]!;
    expect(g.canUseConsumable(uid, [target])).toBe(false);
    const res = g.dispatch({ type: 'useConsumable', uid, targetIds: [target] });
    expect(res).toMatchObject({ ok: false, error: 'cannotUse' });
    expect(g.state.handLevels.three.level).toBe(1);
    expect(g.state.consumables).toHaveLength(1);
  });

  it('z pranostikové obálky se vybraná pranostika hned použije', () => {
    const g = game(false);
    g.startBooster('pr_all', 'blind_select');
    const opt = g.state.booster!.options[0]!;
    if (opt.kind !== 'consumable') throw new Error('čekal jsem spotřebku');
    const hand = def(opt.consumable.defId).hand!;
    ok(g.dispatch({ type: 'pickBooster', index: 0 }));
    expect(g.state.handLevels[hand].level).toBe(2);
    expect(g.state.phase).toBe('blind_select');
  });

  it('ve Večerce „Koupit a použít“ zaplatí 3 Kč a zvedne úroveň i s plnými sloty', () => {
    const g = game(true);
    g._core.state.round!.target = 1;
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    ok(g.dispatch({ type: 'cashOut' }));
    expect(g.state.phase).toBe('shop');
    give(g, 'hen_step');
    give(g, 'hen_step'); // plné sloty (2/2)
    const core = g._core;
    const inst = newConsumableInstance(core, 'ice_saints');
    const price = consumablePrice(core, inst);
    expect(price).toBe(PRANOSTIKA_COST);
    core.state.shop!.items[0] = {
      kind: 'consumable',
      consumable: inst,
      consumableKind: 'pranostika',
      price,
      sold: false,
    };
    const money = g.state.money;
    ok(g.dispatch({ type: 'buyAndUse', slot: 0 }));
    expect(g.state.money).toBe(money - PRANOSTIKA_COST);
    expect(g.state.handLevels.four.level).toBe(2);
    expect(g.state.consumables).toHaveLength(2);
  });

  it('úroveň přežije uložení a načtení', () => {
    const g = game(true);
    ok(g.dispatch({ type: 'useConsumable', uid: give(g, 'lucy_night') }));
    const loaded = Game.fromState(JSON.parse(JSON.stringify(g.state)), registry());
    expect(loaded.state.handLevels.flush_five.level).toBe(2);
  });
});

// ─────────────────────────── Tajné kombinace ───────────────────────────

describe('pranostiky tajných kombinací (DESIGN 2.2.4)', () => {
  const offered = (g: Game): string[] =>
    generateBoosterOptions(g._core, 'pr_all')
      .map((o) => (o.kind === 'consumable' ? o.consumable.defId : ''))
      .sort();

  it('dokud kombinace není objevená, obálka ani Večerka tajnou pranostiku nenabídne', () => {
    const g = game(false);
    const ids = offered(g);
    expect(ids).toHaveLength(10);
    for (const id of SECRET_IDS) expect(ids).not.toContain(id);
    // Večerka: samé pranostiky (ostatní váhy 0), mnoho přehození.
    const core = g._core;
    const m = core.mods();
    core.api.addPermanentModifier({
      shopWeightJoker: -m.shopWeightJoker,
      shopWeightRada: -m.shopWeightRada,
      shopCardSlots: 6,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (const item of generateShopItems(core))
        if (item.kind === 'consumable') seen.add(item.consumable.defId);
    }
    expect(seen.size).toBe(10);
    for (const id of SECRET_IDS) expect(seen.has(id)).toBe(false);
  });

  it('po zahrání Pětice se nabízí Na Hromnice (ostatní tajné dál ne)', () => {
    const g = game(true);
    const cards = setupRound(g, 'KS KH KD KC KS');
    g._core.state.round!.target = 1e9;
    const { result, events } = play(g, cards);
    expect(result.hand.type).toBe('five');
    expect(events).toContainEqual({ type: 'handDiscovered', hand: 'five' });
    const ids = offered(g);
    expect(ids).toHaveLength(11);
    expect(ids).toContain('candlemas');
    expect(ids).not.toContain('catherine_ice');
    expect(ids).not.toContain('lucy_night');
  });

  it('objevené všechny tři → obálka nabídne všech 13', () => {
    const g = game(false);
    g._core.state.discoveredHands.push('five', 'flush_house', 'flush_five');
    expect(offered(g)).toEqual(Object.values(TABLE).sort());
  });

  it('tajná pranostika, kterou hráč už drží (např. z modré pečeti), jde použít', () => {
    const g = game(true);
    ok(g.dispatch({ type: 'useConsumable', uid: give(g, 'catherine_ice') }));
    expect(g.state.handLevels.flush_house.level).toBe(2);
  });
});
