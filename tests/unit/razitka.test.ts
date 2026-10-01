/**
 * Úřední razítka (docs/DESIGN.md kap. 5.4) přes skutečný engine (Game + dispatch useConsumable/pickBooster s cíli):
 * přesný efekt, cena, kterou razítko účtuje, hraniční případy (`cannotUse` při špatném počtu cílů, plných slotech,
 * bez platného cíle) a obecná rozšíření EngineApi, která razítka potřebují (`setJokerEdition`, `removeJokerStickers`,
 * `copyJoker`, `availableJokers`). Obsah: src/content/razitka.ts, texty src/i18n/cs/razitka.ts.
 */
import { describe, expect, it } from 'vitest';
import { RAZITKA, RAZITKO_COST } from '../../src/content/razitka';
import type { ConsumableDef, ContentRegistry } from '../../src/engine/content-types';
import { addConsumableInstance, newConsumableInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { pickConsumableDefId } from '../../src/engine/shop/pool';
import type { Card, GameEvent, HandType, JokerInstance } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import {
  booster,
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** DESIGN 5.4 v pořadí tabulky. */
const IDS = [
  'notarized',
  'duty_stamp',
  'blue_form',
  'registered_mail',
  'exemption',
  'buyback',
  'certified_copy',
  'bulk_processing',
  'office_hours',
  'id_check',
  'merge_files',
  'tax_return',
  'occupancy_permit',
  'appeal',
  'expropriation',
  'fine_waiver',
];
const ROLLED_EDITIONS = ['foil', 'holo', 'poly'];

/** Registr: testovací obsah (žolíci vč. `epic_one` a `legend`, šéfové), ze spotřebek JEN razítka + razítková obálka. */
function registry(mutate?: (reg: ContentRegistry) => void): ContentRegistry {
  const reg = makeRegistry({ boosters: [booster('raz_pack', { kind: 'razitko', options: 2, picks: 1 })] });
  reg.consumables = Object.fromEntries(RAZITKA.map((d) => [d.id, d]));
  mutate?.(reg);
  return reg;
}

interface GameOpts {
  round?: boolean;
  jokers?: (string | JokerSpec)[];
  money?: number;
  registry?: ContentRegistry;
}

function game(opts: GameOpts = {}): Game {
  return makeGame({
    registry: opts.registry ?? registry(),
    round: opts.round ?? false,
    money: opts.money ?? 20,
    ...(opts.jokers ? { jokers: opts.jokers } : {}),
  });
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Dá razítko do slotu (bez kontroly místa) a vrátí jeho uid. */
function give(g: Game, defId: string): number {
  const c = newConsumableInstance(g._core, defId);
  addConsumableInstance(g._core, c, true);
  return c.uid;
}

/** Použije razítko ze slotu (s cíli = karty nebo id). */
function use(g: Game, defId: string, targets: readonly (Card | number)[] = []): GameEvent[] {
  const uid = give(g, defId);
  return ok(
    g.dispatch({
      type: 'useConsumable',
      uid,
      targetIds: targets.map((c) => (typeof c === 'number' ? c : c.id)),
    }),
  );
}

/** Pokus o použití, který musí selhat s `cannotUse`; stav runu se nezmění. */
function expectCannotUse(g: Game, defId: string, targets: readonly (Card | number)[] = []): void {
  const uid = give(g, defId);
  const ids = targets.map((c) => (typeof c === 'number' ? c : c.id));
  const before = JSON.stringify(g.state);
  expect(g.canUseConsumable(uid, ids), defId).toBe(false);
  const res = g.dispatch({ type: 'useConsumable', uid, targetIds: ids });
  expect(res, defId).toMatchObject({ ok: false, error: 'cannotUse' });
  expect(JSON.stringify(g.state)).toBe(before);
  g._core.state.consumables = g._core.state.consumables.filter((c) => c.uid !== uid);
}

function card(g: Game, id: number): Card {
  const c = g.state.deck.find((x) => x.id === id);
  if (!c) throw new Error(`karta ${id} není v balíčku`);
  return c;
}

const inDeck = (g: Game, id: number) => g.state.deck.some((c) => c.id === id);
const jokerIds = (g: Game) => g.state.jokers.map((j) => j.defId);

function def(id: string): ConsumableDef {
  const d = RAZITKA.find((x) => x.id === id);
  if (!d) throw new Error(`neznámé razítko ${id}`);
  return d;
}

function reload(g: Game, reg = registry()): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)), reg);
}

// ─────────────────────────── Definice a texty ───────────────────────────

describe('razítka — definice (DESIGN 5.4)', () => {
  it('16 razítek v pořadí tabulky, všechna za 6 Kč; Výjimka z vyhlášky má váhu 0,25', () => {
    expect(RAZITKA.map((d) => d.id)).toEqual(IDS);
    expect(RAZITKO_COST).toBe(6);
    for (const d of RAZITKA) {
      expect(d.kind, d.id).toBe('razitko');
      expect(d.cost, d.id).toBe(RAZITKO_COST);
      expect(d.weight ?? 1, d.id).toBe(d.id === 'exemption' ? 0.25 : 1);
    }
  });

  it('cíle na hrací karty: pečetě a Kontrola totožnosti 1, Sloučení spisů přesně 2, ostatní žádné', () => {
    const targets = Object.fromEntries(RAZITKA.map((d) => [d.id, d.target ?? null]));
    for (const id of ['notarized', 'duty_stamp', 'blue_form', 'registered_mail', 'id_check'])
      expect(targets[id], id).toEqual({ min: 1, max: 1 });
    expect(targets.merge_files).toEqual({ min: 2, max: 2 });
    const withTarget = ['notarized', 'duty_stamp', 'blue_form', 'registered_mail', 'id_check', 'merge_files'];
    for (const id of IDS.filter((x) => !withTarget.includes(x))) expect(targets[id], id).toBeNull();
  });

  it('každé razítko má název (max. 3 slova), popis a flavor; {param} v popisku existují v params', () => {
    for (const d of RAZITKA) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`consumables.${d.id}.${field}`), `${d.id}.${field}`).toBe(true);
      expect(t(`consumables.${d.id}.name`).split(/\s+/).length, d.id).toBeLessThanOrEqual(3);
      const raw = t(`consumables.${d.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(d.params ?? {}, `${d.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`consumables.${d.id}.desc`, d.params ?? {}), d.id).not.toMatch(/[{}]/);
      expect(t(`consumables.${d.id}.flavor`), d.id).not.toMatch(/[„“"]/);
    }
    expect(t('consumables.notarized.desc', def('notarized').params)).toContain('+2 Kč');
    expect(t('consumables.bulk_processing.desc', def('bulk_processing').params)).toContain(
      'lesklá 50 %, holografická 35 %, duhová 15 %',
    );
    expect(t('consumables.office_hours.desc', def('office_hours').params)).toBe(
      'Všechny kombinace +2 úrovně; trvale −1 ruka v každém kole.',
    );
    expect(t('consumables.occupancy_permit.desc', def('occupancy_permit').params)).toContain(
      'aspoň 2 sloty spotřebek',
    );
  });

  it('Výjimka z vyhlášky padá z razítkové nabídky ~4× méně často než ostatní razítka', () => {
    const g = game();
    const counts: Record<string, number> = {};
    const rng = g._core.rng('consumable');
    for (let i = 0; i < 6000; i++) {
      const id = pickConsumableDefId(g._core, rng, 'razitko')!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const others = IDS.filter((id) => id !== 'exemption').map((id) => counts[id] ?? 0);
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    // Očekávání: 6000 × 0,25 / 15,25 ≈ 98, ostatní ≈ 393.
    expect(counts.exemption ?? 0).toBeGreaterThan(avg * 0.15);
    expect(counts.exemption ?? 0).toBeLessThan(avg * 0.4);
  });
});

// ─────────────────────────── 1–4 Pečetě ───────────────────────────

describe('razítka s pečetí (Ověřeno notářem, Kolek, Modrý formulář, Doporučeně)', () => {
  it.each([
    ['notarized', 'gold'],
    ['duty_stamp', 'red'],
    ['blue_form', 'blue'],
    ['registered_mail', 'purple'],
  ] as const)('%s dá vybrané kartě pečeť %s (a nic jiného)', (id, seal) => {
    const g = game({ round: true });
    const [a, b] = setupRound(g, 'KH:bonus 5S');
    const events = use(g, id, [a!]);
    expect(card(g, a!.id)).toMatchObject({ seal, enhancement: 'bonus', rank: 13, suit: 'H' });
    expect(card(g, b!.id).seal).toBeNull();
    expect(events).toContainEqual({ type: 'cardChanged', cardId: a!.id });
  });

  it('pečeť přepíše dosavadní pečeť karty', () => {
    const g = game({ round: true });
    const [a] = setupRound(g, 'KH@red');
    use(g, 'notarized', [a!]);
    expect(card(g, a!.id).seal).toBe('gold');
  });

  it.each(['notarized', 'duty_stamp', 'blue_form', 'registered_mail'])(
    '%s: 0 nebo 2 cíle a použití mimo kolo/obálku = cannotUse',
    (id) => {
      const g = game({ round: true });
      const [a, b] = setupRound(g, 'KH 5S');
      expectCannotUse(g, id, []);
      expectCannotUse(g, id, [a!, b!]);
      const out = game();
      expectCannotUse(out, id, [out.state.deck[0]!.id]);
    },
  );

  it('Ověřeno notářem: karta se zlatou pečetí pak při skórování dá +2 Kč', () => {
    const g = game({ round: true });
    const [a] = setupRound(g, 'AS 3H');
    use(g, 'notarized', [a!]);
    g._core.state.round!.target = 1e9;
    const money = g.state.money;
    play(g, [a!]);
    expect(g.state.money).toBe(money + 2);
  });

  it('Kolek: karta s červenou pečetí skóruje dvakrát', () => {
    const g = game({ round: true });
    const [a] = setupRound(g, 'AS 3H');
    use(g, 'duty_stamp', [a!]);
    g._core.state.round!.target = 1e9;
    const { result } = play(g, [a!]);
    expect(
      result.steps.filter((st) => st.source === 'card' && st.cardId === a!.id && st.chips === 11),
    ).toHaveLength(2);
  });

  it('v razítkové obálce jde pečeť dát kartě z dobrané ruky obálky', () => {
    const g = game();
    g.startBooster('raz_pack', 'blind_select');
    const b = g._core.state.booster!;
    b.options[0] = {
      kind: 'consumable',
      consumable: newConsumableInstance(g._core, 'blue_form'),
      consumableKind: 'razitko',
    };
    const target = b.hand[0]!;
    expect(b.hand).toHaveLength(8);
    ok(g.dispatch({ type: 'pickBooster', index: 0, targetIds: [target] }));
    expect(card(g, target).seal).toBe('blue');
    expect(g.state.phase).toBe('blind_select');
  });
});

// ─────────────────────────── 5 Výjimka z vyhlášky ───────────────────────────

describe('Výjimka z vyhlášky (legendární žolík)', () => {
  it('vytvoří legendárního žolíka (i `noShop`) do volného slotu', () => {
    const g = game({ jokers: ['noop'] });
    const events = use(g, 'exemption');
    expect(jokerIds(g)).toEqual(['noop', 'legend']);
    expect(events.some((e) => e.type === 'jokerAdded' && e.defId === 'legend')).toBe(true);
  });

  it('bez volného slotu, bez legendárního žolíka v registru nebo když ho už má = cannotUse', () => {
    expectCannotUse(game({ jokers: ['noop', 'coaster', 'plus_mult', 'times_mult', 'counter'] }), 'exemption');
    expectCannotUse(game({ registry: registry((reg) => delete reg.jokers.legend) }), 'exemption');
    expectCannotUse(game({ jokers: ['legend'] }), 'exemption');
  });

  it('nikdy nevytvoří náhradního žolíka (Pivní tácek) místo legendárního', () => {
    const g = game({ registry: registry((reg) => delete reg.jokers.legend) });
    expect(g._core.api.availableJokers({ rarity: 'legendary' })).toEqual([]);
    expectCannotUse(g, 'exemption');
    expect(g.state.jokers).toHaveLength(0);
  });
});

// ─────────────────────────── 6 Zpětný odběr ───────────────────────────

describe('Zpětný odběr', () => {
  it('v kole zničí polovinu ruky (8 → 4 karty) a za každou dá 4 Kč', () => {
    const g = game({ round: true, money: 3 });
    const hand = [...g.state.round!.hand];
    const deckSize = g.state.deck.length;
    use(g, 'buyback');
    const left = g.state.round!.hand;
    expect(left).toHaveLength(4);
    expect(left.every((id) => hand.includes(id))).toBe(true);
    expect(g.state.deck).toHaveLength(deckSize - 4);
    expect(hand.filter((id) => !inDeck(g, id))).toHaveLength(4);
    expect(g.state.money).toBe(3 + 4 * 4);
  });

  it('lichý počet karet se zaokrouhlí nahoru (5 → zničí 3, +12 Kč)', () => {
    const g = game({ round: true, money: 0 });
    setupRound(g, 'AS KS QS JS 10S');
    use(g, 'buyback');
    expect(g.state.round!.hand).toHaveLength(2);
    expect(g.state.money).toBe(12);
  });

  it('jediná karta v ruce: zničí ji, dá 4 Kč a ruka se po akci dobere', () => {
    const g = game({ round: true, money: 0 });
    const [only] = setupRound(g, 'AS');
    use(g, 'buyback');
    expect(inDeck(g, only!.id)).toBe(false);
    expect(g.state.money).toBe(4);
    expect(g.state.round!.hand.length).toBeGreaterThan(0);
  });

  it('v razítkové obálce ničí karty dobrané ruky obálky', () => {
    const g = game({ money: 0 });
    g.startBooster('raz_pack', 'blind_select');
    const b = g._core.state.booster!;
    b.options[0] = {
      kind: 'consumable',
      consumable: newConsumableInstance(g._core, 'buyback'),
      consumableKind: 'razitko',
    };
    const deckSize = g.state.deck.length;
    ok(g.dispatch({ type: 'pickBooster', index: 0 }));
    expect(g.state.deck).toHaveLength(deckSize - 4);
    expect(g.state.money).toBe(16);
  });

  it('bez ruky (výběr útraty) = cannotUse; stejný seed zničí stejné karty', () => {
    expectCannotUse(game(), 'buyback');
    const run = () => {
      const g = game({ round: true });
      use(g, 'buyback');
      return [...g.state.round!.hand];
    };
    expect(run()).toEqual(run());
  });
});

// ─────────────────────────── 7 Ověřená kopie ───────────────────────────

describe('Ověřená kopie', () => {
  it('zkopíruje žolíka nejvíc vlevo i se stavem (bez negativní edice), ostatní kromě přibitých zničí', () => {
    const g = game({
      jokers: [
        { id: 'counter', edition: 'negative', state: { hands: 3 } },
        'noop',
        { id: 'plus_mult', stickers: ['eternal'] },
        { id: 'times_mult', edition: 'foil' },
      ],
    });
    const original = g.state.jokers[0]!;
    use(g, 'certified_copy');
    expect(jokerIds(g)).toEqual(['counter', 'plus_mult', 'counter']);
    const copy = g.state.jokers[2]!;
    expect(copy.uid).not.toBe(original.uid);
    expect(copy.edition).toBeNull();
    expect(copy.state).toEqual({ hands: 3 });
    expect(copy.state).not.toBe(original.state);
    expect(g.state.jokers[0]!.edition).toBe('negative');
  });

  it('kopie zachová lesklou edici, nálepky i odpočet zvětrávání a projde `onAcquire`', () => {
    const g = game({ jokers: [{ id: 'golem', edition: 'foil', stickers: ['perishable'] }, 'noop'] });
    g._core.state.jokers[0]!.perishRounds = 2;
    const deckSize = g.state.deck.length;
    use(g, 'certified_copy');
    expect(jokerIds(g)).toEqual(['golem', 'golem']);
    expect(g.state.jokers[1]).toMatchObject({ edition: 'foil', stickers: ['perishable'], perishRounds: 2 });
    expect(g.state.deck).toHaveLength(deckSize + 1); // Golem: kamenná karta při získání
  });

  it('kopie žolíka se stavem funguje nezávisle a přežije uložení a načtení', () => {
    const g = game({ round: true, jokers: [{ id: 'counter', state: { hands: 2 } }] });
    use(g, 'certified_copy');
    g._core.state.round!.target = 1e9;
    play(g, setupRound(g, '2S'));
    const loaded = reload(g);
    expect(loaded.state.jokers.map((j) => j.state.hands)).toEqual([3, 3]);
  });

  it('bez žolíků nebo když přibití žolíci nenechají slot pro kopii = cannotUse', () => {
    expectCannotUse(game(), 'certified_copy');
    const eternal = (id: string): JokerSpec => ({ id, stickers: ['eternal'] });
    expectCannotUse(
      game({
        jokers: ['noop', eternal('coaster'), eternal('plus_mult'), eternal('times_mult'), eternal('counter')],
      }),
      'certified_copy',
    );
    // Zničený negativní žolík si odnese svůj slot: 5 zbylých v 5 slotech, na kopii místo není.
    expectCannotUse(
      game({
        jokers: [
          'noop',
          eternal('coaster'),
          eternal('plus_mult'),
          eternal('times_mult'),
          eternal('counter'),
          { id: 'heart_fan', edition: 'negative' },
        ],
      }),
      'certified_copy',
    );
  });

  it('se 3 přibitými se kopie vejde (4 + kopie = 5 slotů)', () => {
    const eternal = (id: string): JokerSpec => ({ id, stickers: ['eternal'] });
    const g = game({
      jokers: ['noop', eternal('coaster'), eternal('plus_mult'), eternal('times_mult'), 'counter'],
    });
    use(g, 'certified_copy');
    expect(jokerIds(g)).toEqual(['noop', 'coaster', 'plus_mult', 'times_mult', 'noop']);
  });
});

// ─────────────────────────── 8 Hromadné vyřízení ───────────────────────────

describe('Hromadné vyřízení', () => {
  it('žolíci bez edice dostanou lesklou/holografickou/duhovou edici, ostatní nechá; trvale −1 karta v ruce', () => {
    const g = game({ jokers: ['noop', { id: 'plus_mult', edition: 'negative' }, 'times_mult'] });
    expect(g.modifiers().handSize).toBe(8);
    const events = use(g, 'bulk_processing');
    const [a, b, c] = g.state.jokers;
    expect(ROLLED_EDITIONS).toContain(a!.edition);
    expect(b!.edition).toBe('negative');
    expect(ROLLED_EDITIONS).toContain(c!.edition);
    expect(events.filter((e) => e.type === 'jokerChanged')).toHaveLength(2);
    expect(g.modifiers().handSize).toBe(7);
    // trvale: i v dalším kole a po uložení
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.round!.hand).toHaveLength(7);
    expect(reload(g).modifiers().handSize).toBe(7);
  });

  it('rozložení edic odpovídá 50 / 35 / 15 %', () => {
    const g = game({ jokers: ['noop', 'coaster', 'plus_mult', 'times_mult', 'counter'] });
    const core = g._core;
    const counts: Record<string, number> = { foil: 0, holo: 0, poly: 0 };
    for (let i = 0; i < 300; i++) {
      for (const j of core.state.jokers) j.edition = null;
      core.state.extraModifiers = {};
      core.invalidate();
      use(g, 'bulk_processing');
      for (const j of core.state.jokers) counts[j.edition!]! += 1;
    }
    const total = 1500;
    expect(counts.foil! / total).toBeCloseTo(0.5, 1);
    expect(counts.holo! / total).toBeCloseTo(0.35, 1);
    expect(counts.poly! / total).toBeCloseTo(0.15, 1);
  });

  it('bez žolíka bez edice nebo při velikosti ruky 1 = cannotUse', () => {
    expectCannotUse(game(), 'bulk_processing');
    expectCannotUse(game({ jokers: [{ id: 'noop', edition: 'holo' }] }), 'bulk_processing');
    const g = game({ jokers: ['noop'] });
    g._core.api.addPermanentModifier({ handSize: -7 });
    expectCannotUse(g, 'bulk_processing');
  });
});

// ─────────────────────────── 9 Úřední hodiny ───────────────────────────

describe('Úřední hodiny', () => {
  it('všechny kombinace (i tajné) +2 úrovně; trvale −1 ruka od dalšího kola', () => {
    const g = game({ round: true });
    expect(g.state.round!.handsLeft).toBe(4);
    use(g, 'office_hours');
    for (const h of HAND_TYPES) expect(g.state.handLevels[h as HandType].level, h).toBe(3);
    expect(g.state.round!.handsLeft).toBe(4); // rozehrané kolo se nemění
    expect(g.modifiers().hands).toBe(3);
    g._core.state.round!.target = 1;
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    ok(g.dispatch({ type: 'cashOut' }));
    ok(g.dispatch({ type: 'leaveShop' }));
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.round!.handsLeft).toBe(3);
  });

  it('s jedinou rukou za kolo = cannotUse', () => {
    const g = game();
    g._core.api.addPermanentModifier({ hands: -3 });
    expectCannotUse(g, 'office_hours');
  });
});

// ─────────────────────────── 10 Kontrola totožnosti ───────────────────────────

describe('Kontrola totožnosti', () => {
  it('karta bez edice dostane lesklou, holografickou nebo duhovou edici', () => {
    const g = game({ round: true });
    const [a] = setupRound(g, 'QD:steel@red');
    use(g, 'id_check', [a!]);
    expect(ROLLED_EDITIONS).toContain(card(g, a!.id).edition);
    expect(card(g, a!.id)).toMatchObject({ enhancement: 'steel', seal: 'red' });
  });

  it('karta s edicí, 0 nebo 2 cíle = cannotUse', () => {
    const g = game({ round: true });
    const [a, b] = setupRound(g, 'QD~foil 4C');
    expectCannotUse(g, 'id_check', [a!]);
    expectCannotUse(g, 'id_check', []);
    expectCannotUse(g, 'id_check', [a!, b!]);
  });
});

// ─────────────────────────── 11 Sloučení spisů ───────────────────────────

describe('Sloučení spisů', () => {
  it('pravá karta se zničí, levá převezme jen to, co nemá (pořadí podle ruky, ne výběru)', () => {
    const g = game({ round: true });
    const [left, mid, right] = setupRound(g, 'KH:bonus 7C 5S:mult@red~foil');
    use(g, 'merge_files', [right!, left!]);
    expect(inDeck(g, right!.id)).toBe(false);
    expect(g.state.round!.hand).toEqual([left!.id, mid!.id]);
    expect(card(g, left!.id)).toMatchObject({
      rank: 13,
      suit: 'H',
      enhancement: 'bonus',
      seal: 'red',
      edition: 'foil',
    });
  });

  it('levá karta bez úprav převezme všechno', () => {
    const g = game({ round: true });
    const [left, right] = setupRound(g, '2C AD:glass@purple~holo');
    use(g, 'merge_files', [left!, right!]);
    expect(card(g, left!.id)).toMatchObject({
      rank: 2,
      suit: 'C',
      enhancement: 'glass',
      seal: 'purple',
      edition: 'holo',
    });
    expect(g.state.deck.find((c) => c.id === right!.id)).toBeUndefined();
  });

  it('1 nebo 3 cíle = cannotUse', () => {
    const g = game({ round: true });
    const [a, b, c] = setupRound(g, '2C 3C 4C');
    expectCannotUse(g, 'merge_files', [a!]);
    expectCannotUse(g, 'merge_files', [a!, b!, c!]);
  });
});

// ─────────────────────────── 12 Daňové přiznání ───────────────────────────

describe('Daňové přiznání', () => {
  it('vytvoří epického žolíka a peníze nastaví na 0 Kč', () => {
    const g = game({ money: 37 });
    use(g, 'tax_return');
    expect(jokerIds(g)).toEqual(['epic_one']);
    expect(g.state.money).toBe(0);
  });

  it('dluh zůstane (−3 Kč → −3 Kč)', () => {
    const g = game({ money: -3 });
    use(g, 'tax_return');
    expect(jokerIds(g)).toEqual(['epic_one']);
    expect(g.state.money).toBe(-3);
  });

  it('bez volného slotu nebo bez dostupného epického žolíka = cannotUse (peníze zůstanou)', () => {
    expectCannotUse(
      game({ jokers: ['noop', 'coaster', 'plus_mult', 'times_mult', 'counter'] }),
      'tax_return',
    );
    expectCannotUse(game({ jokers: ['epic_one'] }), 'tax_return');
  });
});

// ─────────────────────────── 13 Kolaudace ───────────────────────────

describe('Kolaudace', () => {
  it('trvale +1 slot žolíka a −1 slot spotřebky', () => {
    const g = game();
    give(g, 'fine_waiver'); // druhá spotřebka ve slotu
    use(g, 'occupancy_permit');
    expect(g.modifiers().jokerSlots).toBe(6);
    expect(g.modifiers().consumableSlots).toBe(1);
    expect(g.state.consumables.map((c) => c.defId)).toEqual(['fine_waiver']);
    expect(reload(g).modifiers()).toMatchObject({ jokerSlots: 6, consumableSlots: 1 });
  });

  it('s jediným slotem spotřebky = cannotUse', () => {
    const g = game();
    g._core.api.addPermanentModifier({ consumableSlots: -1 });
    expectCannotUse(g, 'occupancy_permit');
  });
});

// ─────────────────────────── 14 Odvolání ───────────────────────────

describe('Odvolání', () => {
  it('v kole šéfa vypne pravidlo (debuff srdcí zmizí) a stojí 5 Kč', () => {
    const g = game({ money: 10 });
    selectBoss(g, 'heart_ban');
    const [heart] = setupRound(g, 'KH 2S');
    expect(card(g, heart!.id).debuffed).toBe(true);
    use(g, 'appeal');
    expect(g.state.money).toBe(5);
    expect(g.state.round!.bossDisabled).toBe(true);
    expect(card(g, heart!.id).debuffed).toBe(false);
  });

  it('smí jít do dluhu, ale jen do dluhového limitu', () => {
    const g = game({ money: 3 });
    selectBoss(g, 'tax');
    expectCannotUse(g, 'appeal');
    g._core.api.addPermanentModifier({ debtLimit: 2 });
    use(g, 'appeal');
    expect(g.state.money).toBe(-2);
  });

  it('mimo kolo šéfa, mimo kolo nebo s už vypnutým šéfem = cannotUse', () => {
    expectCannotUse(game({ round: true, money: 50 }), 'appeal'); // Malá útrata
    expectCannotUse(game({ money: 50 }), 'appeal'); // výběr útraty
    const g = game({ money: 50 });
    selectBoss(g, 'neighbour');
    use(g, 'appeal');
    expectCannotUse(g, 'appeal');
  });
});

// ─────────────────────────── 15 Vyvlastnění ───────────────────────────

describe('Vyvlastnění', () => {
  it('zničí žolíka nejvíc vpravo, který není přibitý, a dá 3× jeho prodejní cenu', () => {
    const g = game({
      money: 0,
      jokers: ['noop', { id: 'epic_one', edition: 'holo' }, { id: 'times_mult', stickers: ['eternal'] }],
    });
    const target = g.state.jokers[1]!;
    const value = g.sellValue(target.uid);
    expect(value).toBe(5); // (8 + 2) / 2
    use(g, 'expropriation');
    expect(jokerIds(g)).toEqual(['noop', 'times_mult']);
    expect(g.state.money).toBe(3 * value);
  });

  it('zapůjčený žolík (prodejní cena 1 Kč) vynese 3 Kč', () => {
    const g = game({ money: 0, jokers: [{ id: 'noop', stickers: ['rental'] }] });
    use(g, 'expropriation');
    expect(g.state.jokers).toHaveLength(0);
    expect(g.state.money).toBe(3);
  });

  it('bez žolíků nebo jen s přibitými = cannotUse', () => {
    expectCannotUse(game(), 'expropriation');
    expectCannotUse(game({ jokers: [{ id: 'noop', stickers: ['eternal'] }] }), 'expropriation');
  });
});

// ─────────────────────────── 16 Prominutí pokut ───────────────────────────

describe('Prominutí pokut', () => {
  it('odstraní všechny nálepky; zvětralý žolík znovu funguje, přibitý jde prodat', () => {
    const g = game({
      jokers: [
        { id: 'noop', stickers: ['eternal'] },
        { id: 'coaster', stickers: ['perishable'] },
        { id: 'plus_mult', stickers: ['rental', 'eternal'] },
        'times_mult',
      ],
    });
    const perished = g._core.state.jokers[1]!;
    perished.perishRounds = 0;
    perished.debuffed = true;
    const events = use(g, 'fine_waiver');
    for (const j of g.state.jokers) expect(j.stickers, j.defId).toEqual([]);
    expect(g.state.jokers[1]!.perishRounds).toBeUndefined();
    expect(g.state.jokers[1]!.debuffed).toBe(false);
    expect(events).toContainEqual({ type: 'jokerDebuffChanged', uid: perished.uid, debuffed: false });
    expect(events.filter((e) => e.type === 'jokerChanged')).toHaveLength(3);
    ok(g.dispatch({ type: 'sellJoker', uid: g.state.jokers[0]!.uid }));
  });

  it('dočasný debuff šéfa z kola zůstane', () => {
    const g = game({ round: true, jokers: [{ id: 'coaster', stickers: ['perishable'] }] });
    const j = g.state.jokers[0]!;
    g._core.api.setJokerDebuffed(j.uid, true);
    use(g, 'fine_waiver');
    expect(g.state.jokers[0]).toMatchObject({ stickers: [], debuffed: true });
  });

  it('žádný žolík s nálepkou = cannotUse', () => {
    expectCannotUse(game(), 'fine_waiver');
    expectCannotUse(game({ jokers: ['noop', { id: 'coaster', edition: 'foil' }] }), 'fine_waiver');
  });
});

// ─────────────────────────── Rozšíření EngineApi ───────────────────────────

describe('EngineApi pro razítka', () => {
  it('setJokerEdition: nastaví i odebere edici, negativní přidá slot, neznámá edice = výjimka', () => {
    const g = game({ jokers: ['noop'] });
    const api = g._core.api;
    const uid = g.state.jokers[0]!.uid;
    api.setJokerEdition(uid, 'negative');
    expect(g.modifiers().jokerSlots).toBe(6);
    api.setJokerEdition(uid, null);
    expect(g.state.jokers[0]!.edition).toBeNull();
    expect(g.modifiers().jokerSlots).toBe(5);
    expect(() => api.setJokerEdition(uid, 'plaid')).toThrow();
    api.setJokerEdition(999, 'foil'); // neexistující žolík = nic
  });

  it('removeJokerStickers: jen vyjmenované nálepky; bez změny žádná událost', () => {
    const g = game({ jokers: [{ id: 'noop', stickers: ['eternal', 'rental'] }] });
    const api = g._core.api;
    const uid = g.state.jokers[0]!.uid;
    api.removeJokerStickers(uid, ['rental']);
    expect(g.state.jokers[0]!.stickers).toEqual(['eternal']);
    api.removeJokerStickers(uid, ['perishable']);
    expect(g.state.jokers[0]!.stickers).toEqual(['eternal']);
  });

  it('copyJoker: bez místa vrátí null (pokud není ignoreSlots); kopie má nové uid a vlastní stav', () => {
    const g = game({
      jokers: ['noop', 'coaster', 'plus_mult', 'times_mult', { id: 'counter', state: { hands: 4 } }],
    });
    const api = g._core.api;
    const src = g.state.jokers[4]!;
    expect(api.copyJoker(src.uid)).toBeNull();
    expect(api.copyJoker(src.uid, { edition: 'negative' })).not.toBeNull(); // negativní si slot přinese
    const forced = api.copyJoker(src.uid, { ignoreSlots: true }) as JokerInstance;
    expect(forced.state).toEqual({ hands: 4 });
    expect(new Set(g.state.jokers.map((j) => j.uid)).size).toBe(g.state.jokers.length);
    expect(api.copyJoker(999)).toBeNull();
  });

  it('availableJokers: bez vlastněných, legendární i noShop jen na vyžádání', () => {
    const g = game({ jokers: ['rare_one'] });
    const api = g._core.api;
    expect(api.availableJokers({ rarity: 'legendary' })).toEqual(['legend']);
    expect(api.availableJokers({ rarity: 'rare' })).toEqual([]);
    expect(api.availableJokers({ rarity: 'epic' })).toEqual(['epic_one']);
    const all = api.availableJokers();
    expect(all).toContain('noop');
    expect(all).toContain('epic_one');
    expect(all).not.toContain('legend');
    expect(all).not.toContain('rare_one');
  });
});
