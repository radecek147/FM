/**
 * Legendární žolíci (docs/DESIGN.md kap. 4.8): přesná čísla mechaniky přes skutečné skórování (Game + setupRound +
 * play), hraniční podmínky, kopie (`isCopy`, testovací `copier` kopíruje souseda vpravo), uložení/načtení stavu
 * a vznik jen z razítka „Výjimka z vyhlášky“. Obsah: src/content/jokers/legendary.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { LEGENDARY_JOKERS } from '../../src/content/jokers/legendary';
import { PRANOSTIKY } from '../../src/content/pranostiky';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { addConsumableInstance, newConsumableInstance, newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import type { Card, GameEvent, JokerInstance, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import {
  boss,
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  setupRound,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

const IDS = [
  'forefather',
  'libuse',
  'blanik_knights',
  'bruncvik_sword',
  'faust',
  'krakonos',
  'silly_honza',
  'astro_clock',
];

/** Registr: testovací obsah + legendární žolíci, jediný bezzubý šéf (kola bez vedlejších účinků). */
function registry(mutate?: (reg: ContentRegistry) => void): ContentRegistry {
  const reg = makeRegistry({ jokers: LEGENDARY_JOKERS });
  reg.bosses = { calm: boss('calm'), final_boss: boss('final_boss', { final: true }) };
  mutate?.(reg);
  return reg;
}

function game(
  jokers: (string | JokerSpec)[] = [],
  opts: { money?: number; reg?: ContentRegistry } = {},
): Game {
  return makeGame({
    registry: opts.reg ?? registry(),
    jokers,
    ...(opts.money !== undefined ? { money: opts.money } : {}),
  });
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Nastaví ruku na `spec` a zahraje prvních `count` karet; kolo se tím nevyhraje ani neprohraje. */
function hand(g: Game, spec: string, count?: number, opts: SetupOptions = {}): ScoreResult {
  const cards = setupRound(g, spec, opts);
  const round = g._core.state.round!;
  round.target = 1e15;
  round.handsLeft = 10;
  return play(g, cards.slice(0, count ?? cards.length)).result;
}

/** Vyhraje běžící (případně právě vybrané) kolo první kartou ruky (cíl 1). */
function winRound(g: Game): GameEvent[] {
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
  const round = g._core.state.round!;
  round.target = 1;
  return ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
}

function nextRound(g: Game): void {
  ok(g.dispatch({ type: 'cashOut' }));
  ok(g.dispatch({ type: 'leaveShop' }));
  ok(g.dispatch({ type: 'selectBlind' }));
}

function reload(g: Game, reg: ContentRegistry = registry()): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)), reg);
}

/** Dá spotřebku do slotu (bez kontroly místa) a použije ji. */
function useConsumable(g: Game, defId: string, targets: readonly number[] = []): GameEvent[] {
  const c = newConsumableInstance(g._core, defId);
  addConsumableInstance(g._core, c, true);
  return ok(g.dispatch({ type: 'useConsumable', uid: c.uid, targetIds: [...targets] }));
}

const jokerSteps = (r: ScoreResult, defId: string) =>
  r.steps.filter((s) => s.source === 'joker' && s.defId === defId);

const def = (id: string): JokerDef => {
  const d = LEGENDARY_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`neznámý žolík ${id}`);
  return d;
};

const instance = (g: Game, id: string): JokerInstance => g.state.jokers.find((j) => j.defId === id)!;

/** Text popisku s parametry a stavem (NBSP → mezera kvůli čitelnosti očekávání). */
function descOf(id: string, state?: JokerInstance['state']): string {
  const d = def(id);
  const inst = newJokerInstance(game()._core, id);
  if (state) inst.state = state;
  return t(`jokers.${id}.desc`, { ...d.params, ...d.describe?.(inst) }).replaceAll(NBSP, ' ');
}

const messages = (events: readonly GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'message' ? [e.key] : []));

// Základy kombinací na úrovni 1 (DESIGN 2.2.1): Vysoká karta 6/1, Dvojice 12/2 (+14/+1 za úroveň), Dvě dvojice 24/2,
// Trojice 28/3. Dvojice králů na úrovni 1 = (12 + 10 + 10) čipů × 2 mult = 64 bodů.

// ─────────────────────────── Obsah a texty ───────────────────────────

describe('legendární žolíci — definice a texty', () => {
  it('8 žolíků podle DESIGN 4.8: legendární, cena 16 Kč, jen mimo obchod', () => {
    expect(LEGENDARY_JOKERS.map((j) => j.id)).toEqual(IDS);
    for (const d of LEGENDARY_JOKERS) {
      expect([d.rarity, d.cost, d.noShop], d.id).toEqual(['legendary', 16, true]);
    }
  });

  it('každý má název (nejvýš 3 slova), popis, flavor a štítky; {param} v popisku se celé dosadí', () => {
    for (const d of LEGENDARY_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${d.id}.${field}`), d.id).toBe(true);
      expect(t(`jokers.${d.id}.name`).split(/\s+/).length, d.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${d.id}.flavor`), d.id).not.toMatch(/^[„"]/);
      expect(d.tags.length, d.id).toBeGreaterThan(0);
      expect(descOf(d.id), d.id).not.toMatch(/[{}]/);
    }
    for (const key of ['forefather.settled', 'libuse.prophecy', 'bruncvik_sword.cut', 'krakonos.weather'])
      expect(hasKey(`jokers.${key}`), key).toBe(true);
  });

  it('popisky čtou čísla z params a stav z describe', () => {
    expect(descOf('forefather')).toBe(
      'První ruka každého kola ještě před skórováním zvýší úroveň zahrané kombinace o 1 (zatím +0 úrovní).',
    );
    expect(descOf('forefather', { levels: 3 })).toContain('(zatím +3 úrovně)');
    expect(descOf('libuse')).toBe(
      'Každá skórující dáma dá ×1,4 mult; na konci kola promění 1 náhodnou kartu drženou v ruce v dámu.',
    );
    expect(descOf('blanik_knights')).toBe('×3 mult, dokud skóre kola nedosáhne 50 % cíle.');
    expect(descOf('bruncvik_sword')).toBe(
      'Při prvním zahození v kole zničí nejnižší zahozenou kartu a trvale získá +×0,2 mult (teď ×1).',
    );
    expect(descOf('bruncvik_sword', { cuts: 3 })).toContain('(teď ×1,6)');
    expect(descOf('faust')).toBe('×1 mult a navíc +×0,06 za každou korunu, kterou máš (nejvýš ×5).');
    expect(descOf('krakonos')).toBe(
      'Každá použitá pranostika zvýší úroveň své kombinace o 1 navíc a dá +2 Kč.',
    );
    expect(descOf('silly_honza')).toBe('Vysoká karta a Dvojice dávají ×4 mult.');
    expect(descOf('astro_clock')).toBe('×2 mult v první ruce kola, ×3 ve druhé a ×4 v každé další.');
  });

  it('kopírovat jdou všichni; v obchodě se nenabízejí (jen výslovně legendární výběr)', () => {
    expect(LEGENDARY_JOKERS.filter((d) => d.copyable === false)).toEqual([]);
    const g = makeGame({ registry: buildRegistry(), deckId: 'pub' });
    const shopPool = g._core.api.availableJokers();
    expect(shopPool.some((id) => IDS.includes(id))).toBe(false);
    expect(g._core.api.availableJokers({ rarity: 'legendary' })).toEqual([...IDS].sort());
  });
});

// ─────────────────────────── Výjimka z vyhlášky (obsah hry) ───────────────────────────

describe('razítko „Výjimka z vyhlášky“ s obsahem hry', () => {
  it('vytvoří legendárního žolíka; prodejní cena 8 Kč', () => {
    const reg = buildRegistry();
    const g = makeGame({ registry: reg, deckId: 'pub', money: 20 });
    const events = useConsumable(g, 'exemption');
    expect(g.state.jokers).toHaveLength(1);
    const j = g.state.jokers[0]!;
    expect(IDS).toContain(j.defId);
    expect(events.some((e) => e.type === 'jokerAdded' && e.defId === j.defId)).toBe(true);
    expect(g._core.api.sellValue(j)).toBe(8);
  });

  it('postupně rozdá všech 8 různých legendárních; pak už nejde použít', () => {
    const reg = buildRegistry();
    const g = makeGame({ registry: reg, deckId: 'pub', money: 20 });
    g._core.api.addPermanentModifier({ jokerSlots: 10 });
    for (let i = 0; i < IDS.length; i++) useConsumable(g, 'exemption');
    expect(g.state.jokers.map((j) => j.defId).sort()).toEqual([...IDS].sort());
    const c = newConsumableInstance(g._core, 'exemption');
    addConsumableInstance(g._core, c, true);
    expect(g.canUseConsumable(c.uid, [])).toBe(false);
  });
});

// ─────────────────────────── Rozšíření EngineApi ───────────────────────────

describe('EngineApi.consumableHand a jokerCopyable', () => {
  it('consumableHand: kombinace pranostiky z registru, jinak null', () => {
    const api = game()._core.api;
    expect(api.consumableHand('pr_pair')).toBe('pair');
    expect(api.consumableHand('pr_flush_five')).toBe('flush_five');
    expect(api.consumableHand('rada_a')).toBeNull();
    expect(api.consumableHand('neexistuje')).toBeNull();
  });

  it('jokerCopyable: copyable !== false; neznámý žolík nejde kopírovat', () => {
    const api = game()._core.api;
    expect(api.jokerCopyable('plus_mult')).toBe(true);
    expect(api.jokerCopyable('forefather')).toBe(true);
    expect(api.jokerCopyable('uncopyable')).toBe(false);
    expect(api.jokerCopyable('neexistuje')).toBe(false);
  });
});

// ─────────────────────────── Praotec Čech ───────────────────────────

describe('Praotec Čech (forefather)', () => {
  it('první ruka kola zvýší úroveň ještě před skórováním: Dvojice úr. 2 = (26 + 20) × 3 = 138', () => {
    const g = game(['forefather']);
    const cards = setupRound(g, 'KS KH');
    g._core.state.round!.target = 1e15;
    const { result: r, events } = play(g, cards);
    expect(r.score).toBe(138);
    expect(r.steps[0]).toMatchObject({ source: 'hand', chips: 26, mult: 3 });
    expect(g.state.handLevels.pair.level).toBe(2);
    expect(instance(g, 'forefather').state.levels).toBe(1);
    expect(messages(events)).toContain('jokers.forefather.settled');
    expect(jokerSteps(r, 'forefather')).toEqual([]);
  });

  it('další ruka téhož kola už nic; v novém kole zase první ruka (úr. 3 = 60 × 4 = 240)', () => {
    const g = game(['forefather']);
    hand(g, 'KS KH');
    const second = hand(g, 'KS KH');
    expect(second.score).toBe(138);
    expect(jokerSteps(second, 'forefather')).toEqual([]);
    expect(g.state.handLevels.pair.level).toBe(2);
    winRound(g);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(240);
    expect(g.state.handLevels.pair.level).toBe(3);
    expect(instance(g, 'forefather').state.levels).toBe(2);
  });

  it('úroveň dostane zahraná kombinace (Vysoká karta úr. 2 = 18 + 10 = 28 × 2 = 56)', () => {
    const g = game(['forefather']);
    expect(hand(g, 'KS').score).toBe(56);
    expect(g.state.handLevels.high_card.level).toBe(2);
    expect(g.state.handLevels.pair.level).toBe(1);
  });

  it('kopie zvýší úroveň znovu, ale počítadlo nezvedá; stav přežije uložení a načtení', () => {
    const g = game(['copier', 'forefather']);
    expect(hand(g, 'KS KH').score).toBe(240);
    expect(g.state.handLevels.pair.level).toBe(3);
    expect(instance(g, 'forefather').state.levels).toBe(1);
    const g2 = reload(g);
    expect(instance(g2, 'forefather').state).toEqual({ levels: 1 });
  });
});

// ─────────────────────────── Kněžna Libuše ───────────────────────────

describe('Kněžna Libuše (libuse)', () => {
  it('každá skórující dáma ×1,4: Dvojice dam = 32 × 2 × 1,4 × 1,4 = 125', () => {
    const r = hand(game(['libuse']), 'QS QH');
    expect(r.score).toBe(Math.floor(32 * 2 * 1.4 * 1.4));
    const steps = jokerSteps(r, 'libuse');
    expect(steps.map((s) => s.xmult)).toEqual([1.4, 1.4]);
    expect(steps.every((s) => s.cardId !== undefined)).toBe(true);
  });

  it('jiné hodnoty ani kamenná dáma (nemá hodnotu) nic; divoká dáma ano', () => {
    expect(hand(game(['libuse']), 'KS KH').score).toBe(64);
    // Dvojice K + kamenná karta (+50 čipů): (12 + 10 + 10 + 50) × 2 = 164
    expect(hand(game(['libuse']), 'KS KH QS:stone').score).toBe(164);
    // Vysoká karta: divoká dáma (6 + 10) × 1 × 1,4 = 22,4 → 22
    expect(hand(game(['libuse']), 'QD:wild').score).toBe(22);
  });

  it('na konci kola promění 1 náhodnou drženou kartu (ne dámu) v dámu', () => {
    const g = game(['libuse']);
    ok(g.dispatch({ type: 'selectBlind' }));
    const cards = setupRound(g, 'KS 2H 3C 4D QS');
    g._core.state.round!.target = 1;
    const events = ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }));
    const rankOf = (c: Card) => g._core.card(c.id)!.rank;
    expect(rankOf(cards[0]!)).toBe(13);
    const changed = cards.slice(1, 4).filter((c) => rankOf(c) === 12);
    expect(changed).toHaveLength(1);
    expect(rankOf(cards[4]!)).toBe(12);
    expect(messages(events)).toContain('jokers.libuse.prophecy');
  });

  it('když v ruce zbyly jen dámy a kamenné karty, nic se nemění', () => {
    const g = game(['libuse']);
    ok(g.dispatch({ type: 'selectBlind' }));
    const cards = setupRound(g, 'KS QH 5C:stone');
    g._core.state.round!.target = 1;
    const events = ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }));
    expect(g._core.card(cards[2]!.id)!.rank).toBe(5);
    expect(messages(events)).not.toContain('jokers.libuse.prophecy');
  });

  it('kopie promění další kartu (chová se jako druhá instance)', () => {
    const g = game(['copier', 'libuse']);
    ok(g.dispatch({ type: 'selectBlind' }));
    const cards = setupRound(g, 'KS 2H 3C 4D');
    g._core.state.round!.target = 1;
    ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }));
    expect(cards.slice(1).filter((c) => g._core.card(c.id)!.rank === 12)).toHaveLength(2);
  });
});

// ─────────────────────────── Blaničtí rytíři ───────────────────────────

describe('Blaničtí rytíři (blanik_knights)', () => {
  function atScore(score: number): ScoreResult {
    const g = game(['blanik_knights']);
    const cards = setupRound(g, 'KS KH');
    const round = g._core.state.round!;
    round.target = 1000;
    round.score = score;
    return play(g, cards).result;
  }

  it('×3 mult, dokud je skóre kola pod polovinou cíle: 64 × 3 = 192', () => {
    expect(atScore(0).score).toBe(192);
    expect(atScore(499).score).toBe(192);
  });

  it('od přesně poloviny cíle nic', () => {
    const r = atScore(500);
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'blanik_knights')).toEqual([]);
  });

  it('rozhoduje skóre před rukou (ruka, která polovinu překročí, ještě násobí)', () => {
    const g = game(['blanik_knights']);
    const cards = setupRound(g, 'KS KH');
    g._core.state.round!.target = 300;
    expect(play(g, cards).result.score).toBe(192);
    const again = setupRound(g, 'KS KH');
    expect(play(g, again).result.score).toBe(64);
  });
});

// ─────────────────────────── Bruncvíkův meč ───────────────────────────

describe('Bruncvíkův meč (bruncvik_sword)', () => {
  function discard(g: Game, cards: readonly Card[]): GameEvent[] {
    return ok(g.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
  }
  const inDeck = (g: Game, c: Card) => g.state.deck.some((x) => x.id === c.id);

  it('první zahození v kole zničí nejnižší zahozenou kartu a trvale +×0,2', () => {
    const g = game(['bruncvik_sword']);
    const cards = setupRound(g, '9S 3H KD 2C 5S');
    const events = discard(g, cards.slice(0, 3));
    expect(inDeck(g, cards[1]!)).toBe(false);
    expect(inDeck(g, cards[0]!) && inDeck(g, cards[2]!)).toBe(true);
    expect(instance(g, 'bruncvik_sword').state.cuts).toBe(1);
    expect(events.some((e) => e.type === 'jokerTriggered' && e.message === 'jokers.bruncvik_sword.cut')).toBe(
      true,
    );
    // Druhé zahození v kole už nic.
    const more = setupRound(g, '2S 4H');
    discard(g, more);
    expect(inDeck(g, more[0]!)).toBe(true);
    expect(instance(g, 'bruncvik_sword').state.cuts).toBe(1);
    // Dvojice K × 1,2: 32 × 2,4 = 76,8 → 76
    expect(hand(g, 'KS KH').score).toBe(76);
  });

  it('bez zahození ×1 (žádný krok); kamenná karta hodnotu nemá; při shodě první zahozená', () => {
    const g = game(['bruncvik_sword']);
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'bruncvik_sword')).toEqual([]);
    const stoneOnly = setupRound(g, '2S:stone 3H:stone');
    discard(g, stoneOnly);
    expect(stoneOnly.every((c) => inDeck(g, c))).toBe(true);
    expect(instance(g, 'bruncvik_sword').state.cuts).toBe(0);

    const g2 = game(['bruncvik_sword']);
    const ties = setupRound(g2, '2S:stone 4S 4H');
    discard(g2, ties);
    expect([inDeck(g2, ties[0]!), inDeck(g2, ties[1]!), inDeck(g2, ties[2]!)]).toEqual([true, false, true]);
  });

  it('v každém kole znovu; stav přežije uložení a načtení', () => {
    const g = game(['bruncvik_sword']);
    discard(g, setupRound(g, '9S 3H'));
    winRound(g);
    nextRound(g);
    discard(g, setupRound(g, '7S 8H'));
    expect(instance(g, 'bruncvik_sword').state.cuts).toBe(2);
    const g2 = reload(g);
    expect(instance(g2, 'bruncvik_sword').state).toEqual({ cuts: 2 });
    // ×1,4: 32 × 2,8 = 89,6 → 89
    expect(hand(g2, 'KS KH').score).toBe(89);
  });

  it('kopie ×mult kopíruje, ale kartu nezničí znovu ani meč nenabrousí', () => {
    const g = game(['copier', { id: 'bruncvik_sword', state: { cuts: 2 } }]);
    expect(hand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.4 * 1.4));
    const deckSize = g.state.deck.length;
    discard(g, setupRound(g, '9S 3H 5C'));
    expect(g.state.deck.length).toBe(deckSize + 3 - 1);
    expect(instance(g, 'bruncvik_sword').state.cuts).toBe(3);
  });
});

// ─────────────────────────── Doktor Faust ───────────────────────────

describe('Doktor Faust (faust)', () => {
  it('×(1 + 0,06 × koruny): 20 Kč = ×2,2 → 32 × 4,4 = 140; 7 Kč = ×1,42 → 90', () => {
    expect(hand(game(['faust'], { money: 20 }), 'KS KH').score).toBe(140);
    const r = hand(game(['faust'], { money: 7 }), 'KS KH');
    expect(jokerSteps(r, 'faust')).toMatchObject([{ xmult: 1.42 }]);
    expect(r.score).toBe(90);
  });

  it('nejvýš ×5 (od 67 Kč); bez peněz a v dluhu nic', () => {
    expect(hand(game(['faust'], { money: 100 }), 'KS KH').score).toBe(320);
    expect(hand(game(['faust'], { money: 0 }), 'KS KH').score).toBe(64);
    const g = game(['faust'], { money: 0 });
    g._core.state.money = -5;
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'faust')).toEqual([]);
  });
});

// ─────────────────────────── Krakonoš ───────────────────────────

describe('Krakonoš (krakonos)', () => {
  it('pranostika zvýší úroveň o 1 navíc a dá +2 Kč', () => {
    const g = game(['krakonos'], { money: 10 });
    const events = useConsumable(g, 'pr_pair');
    expect(g.state.handLevels.pair.level).toBe(3);
    expect(g.state.money).toBe(12);
    expect(messages(events)).toContain('jokers.krakonos.weather');
  });

  it('jiné spotřebky nic; debuffnutý Krakonoš nic', () => {
    const g = game(['krakonos'], { money: 10 });
    useConsumable(g, 'rada_a');
    expect(g.state.money).toBe(10);
    const g2 = game([{ id: 'krakonos', debuffed: true }], { money: 10 });
    useConsumable(g2, 'pr_flush');
    expect(g2.state.handLevels.flush.level).toBe(2);
    expect(g2.state.money).toBe(10);
  });

  it('se skutečnou pranostikou obsahu hry: její kombinace +2 úrovně', () => {
    const reg = registry((r) => {
      for (const p of PRANOSTIKY) r.consumables[p.id] = p;
    });
    const p = PRANOSTIKY[0]!;
    const g = game(['krakonos'], { reg, money: 0 });
    useConsumable(g, p.id);
    expect(g.state.handLevels[p.hand!].level).toBe(3);
    expect(g.state.money).toBe(2);
  });

  it('kopie přidá úroveň i peníze znovu', () => {
    const g = game(['copier', 'krakonos'], { money: 0 });
    useConsumable(g, 'pr_pair');
    expect(g.state.handLevels.pair.level).toBe(4);
    expect(g.state.money).toBe(4);
  });
});

// ─────────────────────────── Hloupý Honza ───────────────────────────

describe('Hloupý Honza (silly_honza)', () => {
  it('Dvojice ×4: 64 × 4 = 256; Vysoká karta ×4: 16 × 4 = 64', () => {
    expect(hand(game(['silly_honza']), 'KS KH').score).toBe(256);
    expect(hand(game(['silly_honza']), 'KS').score).toBe(64);
  });

  it('jen přesně tyto kombinace, ne „obsahuje Dvojici“', () => {
    // Dvě dvojice: (24 + 30) × 2 = 108; Trojice: (28 + 30) × 3 = 174
    expect(hand(game(['silly_honza']), 'KS KH 5C 5D').score).toBe(108);
    const r = hand(game(['silly_honza']), 'KS KH KD');
    expect(r.score).toBe(174);
    expect(jokerSteps(r, 'silly_honza')).toEqual([]);
  });
});

// ─────────────────────────── Orloj ───────────────────────────

describe('Orloj (astro_clock)', () => {
  it('×2 v první ruce, ×3 ve druhé, ×4 v každé další; nové kolo začíná znovu', () => {
    const g = game(['astro_clock']);
    expect([1, 2, 3, 4].map(() => hand(g, 'KS KH').score)).toEqual([128, 192, 256, 256]);
    winRound(g);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(128);
  });

  it('kopie násobí stejně (×2 × ×2 v první ruce)', () => {
    expect(hand(game(['copier', 'astro_clock']), 'KS KH').score).toBe(256);
  });
});

// ─────────────────────────── Celý run ───────────────────────────

describe('legendární žolíci v celém runu', () => {
  it('stav všech je po hrách JSON-bezpečný a hra po načtení pokračuje stejně', () => {
    const g = game(IDS, { money: 30 });
    g._core.api.addPermanentModifier({ jokerSlots: 5 });
    hand(g, 'QS QH 4C');
    ok(g.dispatch({ type: 'discard', cardIds: setupRound(g, '9S 3H').map((c) => c.id) }));
    useConsumable(g, 'pr_pair');
    const g2 = reload(g);
    expect(JSON.parse(JSON.stringify(g2.state))).toEqual(g.state);
    expect(hand(g2, 'KS KH').score).toBe(hand(g, 'KS KH').score);
  });
});
