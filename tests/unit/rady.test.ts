/**
 * Babské rady (docs/DESIGN.md kap. 5.3): každá rada přes skutečný engine (`useConsumable` s cíli) — přesný efekt,
 * špatný počet cílů = `cannotUse`, hraniční případy (sloty, „jen v kole“, peníze v mínusu, poslední spotřebka…),
 * texty a `ArtSpec`. Navíc obecná rozšíření enginu, která rady potřebují (pořadí cílů, `cleanseCard`,
 * `transformJoker`, `jokerRarity`, `consumableKind`).
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { ENHANCEMENTS } from '../../src/content/modifiers';
import { RADY, RADA_COST } from '../../src/content/rady';
import type { ContentRegistry } from '../../src/engine/content-types';
import { addConsumableInstance, newConsumableInstance } from '../../src/engine/effects/api';
import { refreshDebuffs } from '../../src/engine/run/draw';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import type { ActionResult, Card, HandType } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import {
  addJokers,
  joker,
  makeGame,
  makeRegistry,
  selectBoss,
  setupRound,
  TEST_JOKERS,
  winNextHand,
} from './fixtures/registry';

/** Testovací registr (pranostiky `pr_<kombinace>`, razítko `stamp`, testovací žolíci) + skutečné babské rady. */
const reg = makeRegistry({ consumables: RADY });

const HAND = '2H 5S 9D KC 7H 10S 4C AD';

function def(id: string) {
  const d = RADY.find((r) => r.id === id);
  if (!d) throw new Error(`Chybí rada ${id}`);
  return d;
}

/** Vloží spotřebku do slotů (bez kontroly místa) a vrátí její uid. */
function give(game: Game, id: string): number {
  const core = game._core;
  const inst = newConsumableInstance(core, id);
  addConsumableInstance(core, inst, true);
  return inst.uid;
}

function use(game: Game, uid: number, targets: readonly (Card | number)[] = []): ActionResult {
  return game.dispatch({
    type: 'useConsumable',
    uid,
    targetIds: targets.map((c) => (typeof c === 'number' ? c : c.id)),
  });
}

/** Použití musí projít. */
function useOk(game: Game, uid: number, targets: readonly (Card | number)[] = []): void {
  const res = use(game, uid, targets);
  if (!res.ok) throw new Error(`useConsumable selhalo: ${res.error}`);
}

function expectCannot(game: Game, uid: number, targets: readonly (Card | number)[] = []): void {
  expect(use(game, uid, targets)).toEqual({ ok: false, error: 'cannotUse' });
  // Neúspěšné použití spotřebku nespotřebuje.
  expect(game.state.consumables.some((c) => c.uid === uid)).toBe(true);
}

/** Hra v kole s nastavenou rukou a nedosažitelným cílem. */
function roundGame(hand = HAND, registry: ContentRegistry = reg): { game: Game; cards: Card[] } {
  const game = makeGame({ registry, round: true });
  game._core.state.round!.target = 1e9;
  const cards = setupRound(game, hand);
  return { game, cards };
}

const card = (game: Game, id: number): Card => game._core.mustCard(id);
const inDeck = (game: Game, id: number): boolean => game.state.deck.some((c) => c.id === id);
const consumableIds = (game: Game): string[] => game.state.consumables.map((c) => c.defId);

describe('babské rady – obsah', () => {
  it('22 rad podle DESIGN 5.3, všechny za 4 Kč, druh rada, unikátní id', () => {
    expect(RADY).toHaveLength(22);
    expect(new Set(RADY.map((r) => r.id)).size).toBe(22);
    expect(RADY.map((r) => r.id)).toEqual([
      'chamomile',
      'chili',
      'glass_cabinet',
      'cast_iron_pot',
      'cabbage_stone',
      'ducat',
      'four_leaf',
      'fern_bloom',
      'grandpas_wallet',
      'grandmas_dye',
      'hall_mirror',
      'risen_dough',
      'spring_cleaning',
      'apple_tree',
      'nettle_tea',
      'under_mattress',
      'tree_frog',
      'grandmas_recipe',
      'knock_on_wood',
      'cauldron',
      'cold_compress',
      'garlic',
    ]);
    expect(RADA_COST).toBe(4);
    for (const r of RADY) expect([r.id, r.kind, r.cost]).toEqual([r.id, 'rada', 4]);
  });

  it('cíle odpovídají sloupci „Cíl“ v DESIGN 5.3', () => {
    const targets = Object.fromEntries(RADY.map((r) => [r.id, r.target ?? null]));
    expect(targets).toEqual({
      chamomile: { min: 1, max: 3 },
      chili: { min: 1, max: 2 },
      glass_cabinet: { min: 1, max: 1 },
      cast_iron_pot: { min: 1, max: 1 },
      cabbage_stone: { min: 1, max: 2 },
      ducat: { min: 1, max: 1 },
      four_leaf: { min: 1, max: 2 },
      fern_bloom: { min: 1, max: 2 },
      grandpas_wallet: { min: 1, max: 3 },
      grandmas_dye: { min: 2, max: 4 },
      hall_mirror: { min: 2, max: 2 },
      risen_dough: { min: 1, max: 3 },
      spring_cleaning: { min: 1, max: 3 },
      apple_tree: { min: 1, max: 1 },
      nettle_tea: { min: 2, max: 2 },
      under_mattress: null,
      tree_frog: null,
      grandmas_recipe: null,
      knock_on_wood: null,
      cauldron: null,
      cold_compress: null,
      garlic: { min: 1, max: 3 },
    });
  });

  it('každá rada má název (max 3 slova), popis a flavor; {param} v popisku je v params', () => {
    for (const r of RADY) {
      for (const field of ['name', 'desc', 'flavor']) {
        expect(hasKey(`consumables.${r.id}.${field}`), `${r.id}.${field}`).toBe(true);
      }
      expect(t(`consumables.${r.id}.name`).split(/\s+/).length, r.id).toBeLessThanOrEqual(3);
      const raw = t(`consumables.${r.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(r.params ?? {}, `${r.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`consumables.${r.id}.desc`, r.params ?? {}), r.id).not.toMatch(/[{}]/);
      expect(t(`consumables.${r.id}.flavor`), r.id).not.toMatch(/[„“"]/);
    }
  });

  it('popisky čtou čísla z params (vylepšení i samotné rady)', () => {
    const desc = (id: string) => t(`consumables.${id}.desc`, def(id).params ?? {});
    expect(desc('chamomile')).toContain('+25\u00a0čipů');
    expect(desc('chamomile')).toContain('Až 3\u00a0vybrané karty');
    expect(desc('glass_cabinet')).toContain('×2\u00a0mult');
    expect(desc('glass_cabinet')).toContain('1\u00a0z\u00a05');
    expect(desc('under_mattress')).toContain('50\u00a0%');
    expect(desc('under_mattress')).toContain('12\u00a0Kč');
    expect(desc('knock_on_wood')).toMatch(/^1\u00a0z\u00a03/);
    expect(desc('cold_compress')).toContain('+2\u00a0zahození');
  });

  it('ikony jsou z ICON_NAMES a každá rada vypadá jinak', () => {
    for (const r of RADY) {
      expect(isIconName(r.art.icon), r.id).toBe(true);
      if (r.art.prop) expect(isIconName(r.art.prop), `${r.id} prop`).toBe(true);
    }
    expect(new Set(RADY.map((r) => `${r.art.icon}|${r.art.prop ?? ''}`)).size).toBe(RADY.length);
  });
});

// ─────────────────────────── Vylepšení ───────────────────────────

describe('babské rady – vylepšení (DESIGN 2.7, sloupec „Zdroj“)', () => {
  const cases: [string, string, number][] = [
    ['chamomile', 'bonus', 3],
    ['chili', 'mult', 2],
    ['glass_cabinet', 'glass', 1],
    ['cast_iron_pot', 'steel', 1],
    ['cabbage_stone', 'stone', 2],
    ['ducat', 'gold', 1],
    ['four_leaf', 'lucky', 2],
    ['fern_bloom', 'wild', 2],
    ['grandpas_wallet', 'worn', 3],
  ];

  it.each(cases)('%s dá až %s kartám vylepšení %s', (id, enhancement, max) => {
    const { game, cards } = roundGame();
    const uid = give(game, id);
    expectCannot(game, uid, []);
    expectCannot(game, uid, cards.slice(0, max + 1));
    useOk(game, uid, cards.slice(0, max));
    for (const c of cards.slice(0, max)) expect(card(game, c.id).enhancement, `${id} cíl`).toBe(enhancement);
    for (const c of cards.slice(max)) expect(card(game, c.id).enhancement, `${id} mimo cíl`).toBeNull();
    expect(game.state.consumables).toHaveLength(0);
    expect(game.state.lastConsumable).toBe(id);
  });

  it('params rad nesou čísla vylepšení ze src/content/modifiers.ts', () => {
    for (const [id, enhancement, max] of cases) {
      const e = ENHANCEMENTS.find((x) => x.id === enhancement)!;
      expect(def(id).params, id).toEqual({ ...(e.params ?? {}), cards: max });
    }
  });

  it('vylepšení přepíše předchozí a ostatní úpravy karty zůstanou', () => {
    const { game, cards } = roundGame('KH:glass@red~foil+4 2S');
    useOk(game, give(game, 'chamomile'), [cards[0]!]);
    expect(card(game, cards[0]!.id)).toMatchObject({
      rank: 13,
      suit: 'H',
      enhancement: 'bonus',
      seal: 'red',
      edition: 'foil',
      bonusChips: 4,
    });
  });

  it('jde použít i mimo kolo jen s cíli – bez ruky ve Večerce ne', () => {
    const game = makeGame({ registry: reg });
    const uid = give(game, 'chamomile');
    expectCannot(game, uid, [game.state.deck[0]!.id]);
  });
});

// ─────────────────────────── Barva a hodnota ───────────────────────────

describe('Babiččina barva', () => {
  it('všechny vybrané karty převezmou barvu karty nejvíc vlevo v ruce (ne první vybrané)', () => {
    const { game, cards } = roundGame('2H 5S 9D KC 7H');
    // vybráno v pořadí 5S, KC, 2H – vlevo v ruce je 2H
    useOk(game, give(game, 'grandmas_dye'), [cards[1]!, cards[3]!, cards[0]!]);
    expect([1, 3, 0].map((i) => card(game, cards[i]!.id).suit)).toEqual(['H', 'H', 'H']);
    expect(card(game, cards[2]!.id).suit).toBe('D');
    expect(card(game, cards[3]!.id).rank).toBe(13);
  });

  it('chce 2–4 karty', () => {
    const { game, cards } = roundGame();
    const uid = give(game, 'grandmas_dye');
    expectCannot(game, uid, [cards[0]!]);
    expectCannot(game, uid, cards.slice(0, 5));
    useOk(game, uid, cards.slice(0, 4));
    expect(cards.slice(0, 4).map((c) => card(game, c.id).suit)).toEqual(['H', 'H', 'H', 'H']);
  });

  it('bez platného cíle (všechny už mají barvu levé karty) Použít nejde', () => {
    const { game, cards } = roundGame('2H 7H KH 5S');
    const uid = give(game, 'grandmas_dye');
    expectCannot(game, uid, cards.slice(0, 3));
    useOk(game, uid, cards.slice(0, 4));
    expect(card(game, cards[3]!.id).suit).toBe('H');
  });
});

describe('Zrcátko v předsíni', () => {
  it('levá karta převezme hodnotu pravé, vše ostatní si nechá', () => {
    const { game, cards } = roundGame('3H:bonus@red~foil 9D KS');
    // vybráno pozpátku: pravá KS, levá 3H
    useOk(game, give(game, 'hall_mirror'), [cards[2]!, cards[0]!]);
    expect(card(game, cards[0]!.id)).toMatchObject({
      rank: 13,
      suit: 'H',
      enhancement: 'bonus',
      seal: 'red',
      edition: 'foil',
    });
    expect(card(game, cards[2]!.id)).toMatchObject({ rank: 13, suit: 'S', enhancement: null });
    expect(card(game, cards[1]!.id).rank).toBe(9);
  });

  it('chce přesně 2 karty', () => {
    const { game, cards } = roundGame();
    const uid = give(game, 'hall_mirror');
    expectCannot(game, uid, [cards[0]!]);
    expectCannot(game, uid, cards.slice(0, 3));
  });

  it('dvě karty stejné hodnoty nic nezmění — Použít nejde', () => {
    const { game, cards } = roundGame('9H 9S KD');
    const uid = give(game, 'hall_mirror');
    expectCannot(game, uid, [cards[0]!, cards[1]!]);
    useOk(game, uid, [cards[0]!, cards[2]!]);
    expect(card(game, cards[0]!.id).rank).toBe(13);
  });
});

describe('Kynuté těsto', () => {
  it('hodnota +1, z desítky kluk, eso zůstane esem', () => {
    const { game, cards } = roundGame('10H AS 2C 9D');
    useOk(game, give(game, 'risen_dough'), cards.slice(0, 3));
    expect(cards.map((c) => card(game, c.id).rank)).toEqual([11, 14, 3, 9]);
  });

  it('nejvýš 3 karty', () => {
    const { game, cards } = roundGame();
    expectCannot(game, give(game, 'risen_dough'), cards.slice(0, 4));
  });

  it('samá esa (strop) nic nezmění — Použít nejde', () => {
    const { game, cards } = roundGame('AH AS 4C');
    const uid = give(game, 'risen_dough');
    expectCannot(game, uid, cards.slice(0, 2));
    useOk(game, uid, cards.slice(0, 3));
    expect(cards.map((c) => card(game, c.id).rank)).toEqual([14, 14, 5]);
  });
});

// ─────────────────────────── Ničení a kopie ───────────────────────────

describe('Generální úklid', () => {
  it('zničí vybrané karty (z ruky i z balíčku) a za každou dá 1 Kč', () => {
    const { game, cards } = roundGame();
    const money = game.state.money;
    const deckSize = game.state.deck.length;
    useOk(game, give(game, 'spring_cleaning'), cards.slice(0, 3));
    for (const c of cards.slice(0, 3)) {
      expect(inDeck(game, c.id)).toBe(false);
      expect(game.state.round!.hand).not.toContain(c.id);
    }
    expect(game.state.deck).toHaveLength(deckSize - 3);
    expect(game.state.money).toBe(money + 3);
  });

  it('jedna karta = 1 Kč; víc než 3 karty nejde', () => {
    const { game, cards } = roundGame();
    const money = game.state.money;
    expectCannot(game, give(game, 'spring_cleaning'), cards.slice(0, 4));
    useOk(game, game.state.consumables[0]!.uid, [cards[5]!]);
    expect(game.state.money).toBe(money + 1);
  });
});

describe('Jablko od stromu', () => {
  it('přidá kopii do balíčku i do ruky – s vylepšením, pečetí a bonusovými čipy, bez edice', () => {
    const { game, cards } = roundGame('KH:glass@blue~holo+7 2S');
    const deckSize = game.state.deck.length;
    useOk(game, give(game, 'apple_tree'), [cards[0]!]);
    expect(game.state.deck).toHaveLength(deckSize + 1);
    const hand = game.state.round!.hand;
    expect(hand).toHaveLength(3);
    const copy = card(game, hand[2]!);
    expect(copy.id).not.toBe(cards[0]!.id);
    expect(copy).toMatchObject({
      rank: 13,
      suit: 'H',
      enhancement: 'glass',
      seal: 'blue',
      edition: null,
      bonusChips: 7,
    });
    expect(card(game, cards[0]!.id).edition).toBe('holo');
  });

  it('chce přesně 1 kartu', () => {
    const { game, cards } = roundGame();
    expectCannot(game, give(game, 'apple_tree'), cards.slice(0, 2));
  });
});

describe('Kopřivový odvar', () => {
  it('levá karta se zničí, pravá trvale získá její čipy (hodnota + bonusové)', () => {
    const { game, cards } = roundGame('2S+3 KH+5 9D');
    // vybráno pozpátku – levá je KH (index 1), pravá 9D (index 2)
    useOk(game, give(game, 'nettle_tea'), [cards[2]!, cards[1]!]);
    expect(inDeck(game, cards[1]!.id)).toBe(false);
    expect(card(game, cards[2]!.id).bonusChips).toBe(10 + 5);
    expect(card(game, cards[0]!.id).bonusChips).toBe(3);
  });

  it('kamenná levá karta nemá hodnotu, takže nic nepředá; eso předá 11', () => {
    const { game, cards } = roundGame('2S:stone AH 5D 6C');
    useOk(game, give(game, 'nettle_tea'), [cards[0]!, cards[2]!]);
    expect(card(game, cards[2]!.id).bonusChips).toBe(0);
    useOk(game, give(game, 'nettle_tea'), [cards[1]!, cards[3]!]);
    expect(card(game, cards[3]!.id).bonusChips).toBe(11);
  });

  it('chce přesně 2 karty', () => {
    const { game, cards } = roundGame();
    const uid = give(game, 'nettle_tea');
    expectCannot(game, uid, [cards[0]!]);
    expectCannot(game, uid, cards.slice(0, 3));
  });
});

// ─────────────────────────── Peníze a tvorba spotřebek ───────────────────────────

describe('Pod slamníkem', () => {
  function mattress(money: number): number {
    const game = makeGame({ registry: reg, money });
    useOk(game, give(game, 'under_mattress'));
    return game.state.money - money;
  }

  it('+50 % peněz dolů, nejvýš +12 Kč; při nule a dluhu nic', () => {
    expect(mattress(10)).toBe(5);
    expect(mattress(7)).toBe(3);
    expect(mattress(24)).toBe(12);
    expect(mattress(40)).toBe(12);
    expect(mattress(1)).toBe(0);
    expect(mattress(0)).toBe(0);
    expect(mattress(-6)).toBe(0);
  });

  it('jde použít na výběru útraty i v kole, cíle nebere', () => {
    const { game, cards } = roundGame();
    game._core.state.money = 8;
    expectCannot(game, give(game, 'under_mattress'), [cards[0]!]);
    useOk(game, game.state.consumables[0]!.uid);
    expect(game.state.money).toBe(12);
  });
});

describe('Rosnička', () => {
  function frogGame(played: Partial<Record<HandType, number>>): Game {
    const game = makeGame({ registry: reg });
    for (const [hand, n] of Object.entries(played)) game._core.state.handLevels[hand as HandType].played = n;
    return game;
  }

  it('vytvoří pranostiku nejčastější kombinace a 1 náhodnou (rada uvolní svůj slot)', () => {
    const game = frogGame({ pair: 4, flush: 2, three: 1 });
    useOk(game, give(game, 'tree_frog'));
    const ids = consumableIds(game);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('pr_pair');
    expect(ids[1]).toMatch(/^pr_/);
  });

  it('při shodě vybere silnější kombinaci', () => {
    const game = frogGame({ pair: 3, flush: 3, two_pair: 3 });
    useOk(game, give(game, 'tree_frog'));
    expect(consumableIds(game)[0]).toBe('pr_flush');
  });

  it('bez zahraných rukou Vysoká karta', () => {
    const game = frogGame({});
    useOk(game, give(game, 'tree_frog'));
    expect(consumableIds(game)[0]).toBe('pr_high_card');
  });

  it('náhodná pranostika nikdy není tajná neobjevená kombinace', () => {
    for (let i = 0; i < 40; i++) {
      const game = makeGame({ registry: reg, seed: `FROG${i}` });
      useOk(game, give(game, 'tree_frog'));
      expect(['pr_five', 'pr_flush_house', 'pr_flush_five']).not.toContain(consumableIds(game)[1]);
    }
  });

  it('s jediným volným slotem vytvoří jen pranostiku nejčastější kombinace; bez slotu nejde', () => {
    const game = frogGame({ four: 1 });
    give(game, 'rada_a');
    useOk(game, give(game, 'tree_frog'));
    expect(consumableIds(game)).toEqual(['rada_a', 'pr_four']);

    const full = frogGame({});
    give(full, 'rada_a');
    give(full, 'rada_b');
    const uid = give(full, 'tree_frog'); // třetí spotřebka nad limit slotů
    expectCannot(full, uid);
  });
});

describe('Babiččin recept', () => {
  it('zopakuje naposledy použitou babskou radu', () => {
    const { game, cards } = roundGame();
    useOk(game, give(game, 'chamomile'), [cards[0]!]);
    useOk(game, give(game, 'grandmas_recipe'));
    expect(consumableIds(game)).toEqual(['chamomile']);
    expect(game.state.lastConsumable).toBe('grandmas_recipe');
  });

  it('zopakuje i pranostiku', () => {
    const game = makeGame({ registry: reg });
    useOk(game, give(game, 'pr_pair'));
    useOk(game, give(game, 'grandmas_recipe'));
    expect(consumableIds(game)).toEqual(['pr_pair']);
  });

  it('nejde bez předchozí spotřebky, po razítku ani po sobě samém', () => {
    const game = makeGame({ registry: reg });
    const uid = give(game, 'grandmas_recipe');
    expectCannot(game, uid);
    useOk(game, give(game, 'stamp'));
    expectCannot(game, uid);
    useOk(game, give(game, 'rada_a'));
    useOk(game, uid);
    expect(consumableIds(game)).toEqual(['rada_a']);
    const again = give(game, 'grandmas_recipe');
    expectCannot(game, again);
  });

  it('bez volného slotu nejde', () => {
    const game = makeGame({ registry: reg });
    useOk(game, give(game, 'rada_a'));
    give(game, 'rada_b');
    give(game, 'pr_pair');
    expectCannot(game, give(game, 'grandmas_recipe'));
  });
});

// ─────────────────────────── Žolíci ───────────────────────────

describe('Zaklepat na dřevo', () => {
  it('při úspěchu dá náhodnému žolíkovi bez edice lesklou nebo holografickou edici', () => {
    const editions = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const game = makeGame({
        registry: reg,
        seed: `SPELL${i}`,
        jokers: [{ id: 'noop', edition: 'poly' }, 'plus_mult'],
      });
      game.ctx().api.addPermanentModifier({ probabilityMult: 3 }); // „3 z 3“ – jistota
      const money = game.state.money;
      useOk(game, give(game, 'knock_on_wood'));
      expect(game.state.jokers[0]!.edition).toBe('poly');
      const e = game.state.jokers[1]!.edition;
      expect(['foil', 'holo']).toContain(e);
      editions.add(e!);
      expect(game.state.money).toBe(money);
    }
    expect([...editions].sort()).toEqual(['foil', 'holo']);
  });

  it('při neúspěchu dá +2 Kč útěchou a edici nemění', () => {
    const game = makeGame({ registry: reg, jokers: ['noop'] });
    game.ctx().api.addPermanentModifier({ probabilityMult: 0 });
    const money = game.state.money;
    useOk(game, give(game, 'knock_on_wood'));
    expect(game.state.jokers[0]!.edition).toBeNull();
    expect(game.state.money).toBe(money + 2);
  });

  it('šance je zhruba 1 z 3', () => {
    let hits = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const game = makeGame({ registry: reg, seed: `ODDS${i}`, jokers: ['noop'] });
      useOk(game, give(game, 'knock_on_wood'));
      if (game.state.jokers[0]!.edition) hits++;
    }
    expect(hits / n).toBeGreaterThan(0.25);
    expect(hits / n).toBeLessThan(0.42);
  });

  it('bez žolíka bez edice nejde použít', () => {
    const none = makeGame({ registry: reg });
    expectCannot(none, give(none, 'knock_on_wood'));
    const allEdition = makeGame({ registry: reg, jokers: [{ id: 'noop', edition: 'foil' }] });
    expectCannot(allEdition, give(allEdition, 'knock_on_wood'));
  });
});

describe('Kouzelný kotlík', () => {
  it('promění žolíka nejvíc vlevo v jiného stejné vzácnosti; uid, pozice, edice a nálepka zůstanou', () => {
    const game = makeGame({
      registry: reg,
      jokers: [{ id: 'noop', edition: 'holo', stickers: ['rental'] }, 'plus_mult'],
    });
    const [left, right] = game.state.jokers;
    game._core.state.jokers[0]!.sellBonus = 3;
    useOk(game, give(game, 'cauldron'));
    const j = game.state.jokers[0]!;
    expect(j.uid).toBe(left!.uid);
    expect(j.defId).not.toBe('noop');
    expect(j.defId).not.toBe('plus_mult'); // vlastněný žolík se nenabízí
    expect(reg.jokers[j.defId]!.rarity).toBe('common');
    expect(j.edition).toBe('holo');
    expect(j.stickers).toEqual(['rental']);
    expect(j.sellBonus).toBe(0);
    expect(game.state.jokers[1]!.uid).toBe(right!.uid);
  });

  it('nový žolík dostane čerstvý stav a onAcquire (Golem přidá kamennou kartu)', () => {
    const only: ContentRegistry = {
      ...reg,
      jokers: {
        counter: TEST_JOKERS.find((j) => j.id === 'counter')!,
        golem: TEST_JOKERS.find((j) => j.id === 'golem')!,
      },
    };
    const game = makeGame({ registry: only, jokers: [{ id: 'counter', state: { hands: 5 } }] });
    const deck = game.state.deck.length;
    useOk(game, give(game, 'cauldron'));
    expect(game.state.jokers[0]!.defId).toBe('golem');
    expect(game.state.jokers[0]!.state).toEqual({});
    expect(game.state.deck).toHaveLength(deck + 1);
    expect(game.state.deck.at(-1)!.enhancement).toBe('stone');
  });

  it('legendárního, přibitého ani bez náhrady stejné vzácnosti nepromění; bez žolíků nejde', () => {
    for (const spec of [
      { id: 'legend' },
      { id: 'noop', stickers: ['eternal' as const] },
      { id: 'rare_one' },
    ]) {
      const game = makeGame({ registry: reg, jokers: [spec, 'plus_mult'] });
      expectCannot(game, give(game, 'cauldron'));
    }
    const empty = makeGame({ registry: reg });
    expectCannot(empty, give(empty, 'cauldron'));
  });

  it('rozhoduje jen žolík nejvíc vlevo', () => {
    const extra = makeRegistry({
      consumables: RADY,
      jokers: [joker('rare_two', { rarity: 'rare', cost: 6 })],
    });
    const game = makeGame({ registry: extra, jokers: ['rare_one', 'legend'] });
    useOk(game, give(game, 'cauldron'));
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['rare_two', 'legend']);
  });
});

// ─────────────────────────── Kolo ───────────────────────────

describe('Studený obklad', () => {
  it('v kole +2 zahození', () => {
    const { game } = roundGame();
    const before = game.state.round!.discardsLeft;
    useOk(game, give(game, 'cold_compress'));
    expect(game.state.round!.discardsLeft).toBe(before + 2);
  });

  it('mimo kolo nejde (výběr útraty, Večerka)', () => {
    const game = makeGame({ registry: reg });
    expectCannot(game, give(game, 'cold_compress'));
  });
});

describe('Česnek na krk', () => {
  it('vrátí karty do provozu a šéf je do konce kola znovu nevyřadí', () => {
    const game = makeGame({ registry: reg });
    selectBoss(game, 'heart_ban');
    game._core.state.round!.target = 1e9;
    const cards = setupRound(game, '2H KH 5H 9S 4D');
    expect(cards.slice(0, 3).every((c) => card(game, c.id).debuffed)).toBe(true);
    useOk(game, give(game, 'garlic'), [cards[0]!, cards[1]!]);
    expect(card(game, cards[0]!.id).debuffed).toBe(false);
    expect(card(game, cards[1]!.id).debuffed).toBe(false);
    expect(card(game, cards[2]!.id).debuffed).toBe(true);
    refreshDebuffs(game._core);
    expect(card(game, cards[1]!.id).debuffed).toBe(false);
    expect(card(game, cards[2]!.id).debuffed).toBe(true);
    // Vyčištěné srdce skóruje: Dvojice králů? Ne – zahraje se jen KH jako Vysoká karta s jeho čipy.
    const res = game.dispatch({ type: 'play', cardIds: [cards[1]!.id] });
    expect(res.ok).toBe(true);
    const ev = res.ok ? res.events.find((e) => e.type === 'handPlayed') : undefined;
    expect(ev && ev.type === 'handPlayed' ? ev.result.chips : 0).toBe(6 + 10);
  });

  it('otočí karty lícem nahoru', () => {
    const { game, cards } = roundGame('2H^ KS^ 5D');
    useOk(game, give(game, 'garlic'), [cards[0]!]);
    expect(card(game, cards[0]!.id).faceDown).toBe(false);
    expect(card(game, cards[1]!.id).faceDown).toBe(true);
  });

  it('jen v kole a nejvýš 3 karty', () => {
    const { game, cards } = roundGame();
    expectCannot(game, give(game, 'garlic'), cards.slice(0, 4));
    const outside = makeGame({ registry: reg });
    expectCannot(outside, give(outside, 'garlic'));
  });

  it('ochrana platí jen do konce kola', () => {
    const game = makeGame({ registry: reg });
    selectBoss(game, 'heart_ban');
    const cards = setupRound(game, '2H KH 5H 9S 4D');
    useOk(game, give(game, 'garlic'), [cards[0]!]);
    expect(game.state.round!.cleansedCards).toEqual([cards[0]!.id]);
    winNextHand(game);
    expect(game.dispatch({ type: 'play', cardIds: [cards[3]!.id] }).ok).toBe(true);
    expect(game.state.phase).toBe('round_end');
    game.dispatch({ type: 'cashOut' });
    expect(game.state.round).toBeNull();
    // Další kolo (nové patro, Malá útrata) začíná bez ochrany.
    game.dispatch({ type: 'leaveShop' });
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    expect(game.state.round!.cleansedCards ?? []).toEqual([]);
  });
});

// ─────────────────────────── Rozšíření enginu ───────────────────────────

describe('engine: rozšíření pro babské rady', () => {
  it('cíle spotřebky jsou seřazené podle pozice v ruce, ne podle pořadí výběru', () => {
    let seen: number[] = [];
    const spy = makeRegistry({
      consumables: [
        { ...def('hall_mirror'), id: 'order_spy', use: (ctx) => void (seen = ctx.targets.map((c) => c.id)) },
      ],
    });
    const { game, cards } = roundGame('2H 3H 4H 5H', spy);
    useOk(game, give(game, 'order_spy'), [cards[3]!, cards[1]!]);
    expect(seen).toEqual([cards[1]!.id, cards[3]!.id]);
  });

  it('cleanseCard mimo kolo nic nedělá; vyčištěná karta přežije uložení a načtení', () => {
    const outside = makeGame({ registry: reg });
    outside.ctx().api.cleanseCard(outside.state.deck[0]!.id);
    expect(outside.state.round).toBeNull();

    const game = makeGame({ registry: reg });
    selectBoss(game, 'heart_ban');
    const cards = setupRound(game, '2H KH 9S');
    game.ctx().api.cleanseCard(cards[0]!.id);
    const loaded = Game.fromState(deserializeRun(serializeRun(game._core.state)), reg);
    refreshDebuffs(loaded._core);
    expect(loaded._core.mustCard(cards[0]!.id).debuffed).toBe(false);
    expect(loaded._core.mustCard(cards[1]!.id).debuffed).toBe(true);
  });

  it('transformJoker: neznámý žolík nebo stejné id = null; emituje jokerChanged', () => {
    const game = makeGame({ registry: reg, jokers: ['noop'] });
    const uid = game.state.jokers[0]!.uid;
    const api = game.ctx().api;
    expect(api.transformJoker(uid, 'noop')).toBeNull();
    expect(api.transformJoker(uid, 'neexistuje')).toBeNull();
    expect(api.transformJoker(999999, 'plus_mult')).toBeNull();
    game._core.takeEvents();
    expect(api.transformJoker(uid, 'plus_mult')?.defId).toBe('plus_mult');
    expect(game._core.takeEvents()).toContainEqual({ type: 'jokerChanged', uid, defId: 'plus_mult' });
  });

  it('jokerRarity a consumableKind čtou definice z registru', () => {
    const api = makeGame({ registry: reg }).ctx().api;
    expect([api.jokerRarity('noop'), api.jokerRarity('legend'), api.jokerRarity('nic')]).toEqual([
      'common',
      'legendary',
      null,
    ]);
    expect([api.consumableKind('chili'), api.consumableKind('pr_pair'), api.consumableKind('stamp')]).toEqual(
      ['rada', 'pranostika', 'razitko'],
    );
    expect(api.consumableKind('nic')).toBeNull();
  });

  it('rady fungují i s vlastními žolíky ze sady testů (addJokers)', () => {
    const game = makeGame({ registry: reg });
    addJokers(game, ['noop']);
    useOk(game, give(game, 'cauldron'));
    expect(game.state.jokers[0]!.defId).not.toBe('noop');
  });
});
