/**
 * Běžní šéfové 1–13 (docs/DESIGN.md kap. 8.2): přesná pravidla přes skutečný engine (kolo šéfa, zahrání, zahození,
 * dobírání), hranice, Odvolání (`disableBoss`), uložení a načtení uprostřed kola, texty a `ArtSpec`.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { BOSSES_A } from '../../src/content/bosses/a';
import type { BossDef, ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { createCard } from '../../src/engine/cards/cards';
import { bossHasRule, pickBossId } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import { anteBase, niceRound } from '../../src/engine/run/targets';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import type { Card, GameEvent, Suit } from '../../src/engine/types';
import { SUITS } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { formatNumber, NBSP } from '../../src/i18n/format';
import {
  card,
  joker,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  winNextHand,
  type JokerSpec,
} from './fixtures/registry';

/** Testovací žolíci, kteří zvyšují hodnoty, na které šéfové dávají strop. */
const CAP_JOKERS: JokerDef[] = [
  joker('extra_hands', { hooks: { passive: () => ({ hands: 1 }) } }),
  joker('extra_discards', { hooks: { passive: () => ({ discards: 1 }) } }),
  joker('wide_grip', { hooks: { passive: () => ({ maxSelect: 1 }) } }),
  joker('court_painter', { hooks: { passive: () => ({ allFaces: true }) } }),
];

/** Testovací registr (kombinace, úpravy karet, testovací žolíci) + skuteční šéfové 1–13. */
const reg: ContentRegistry = makeRegistry({ bosses: BOSSES_A, jokers: CAP_JOKERS });

function def(id: string): BossDef {
  const d = BOSSES_A.find((b) => b.id === id);
  if (!d) throw new Error(`Chybí šéf ${id}`);
  return d;
}

interface BossGameOptions {
  jokers?: (string | JokerSpec)[];
  money?: number;
  seed?: string;
  /** Cíl kola (výchozí nedosažitelný — kolo neskončí výhrou). */
  target?: number;
}

/** Hra v kole šéfa `id` (Malá a Velká přeskočené bez štítků); události výběru útraty vrátí v `events`. */
function bossGame(id: string, opts: BossGameOptions = {}): { game: Game; events: GameEvent[] } {
  const game = makeGame({ registry: reg, jokers: opts.jokers, money: opts.money, seed: opts.seed });
  const events: GameEvent[] = [];
  const off = game.bus.onAny((e) => events.push(e));
  selectBoss(game, id);
  off();
  game._core.state.round!.target = opts.target ?? 1e12;
  return { game, events };
}

function hand(game: Game): Card[] {
  return game.state.round!.hand.map((id) => game._core.mustCard(id));
}

function reload(game: Game): Game {
  return Game.fromState(deserializeRun(JSON.parse(serializeRun(game.state))), game.registry);
}

/** Vloží kartu na vršek dobíracího balíčku (další líznutá). */
function putOnTop(game: Game, token: string): Card {
  const core = game._core;
  const c = createCard(core.uid(), card(token));
  core.state.deck.push(c);
  core.state.round!.drawPile.push(c.id);
  return c;
}

function discard(game: Game, cards: readonly Card[]) {
  return game.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) });
}

// ─────────────────────────── Definice a texty ───────────────────────────

describe('šéfové 1–13 – definice podle DESIGN 8.2', () => {
  const TABLE: [string, number, number][] = [
    // [id, od patra, násobek cíle] — cíle laděné simulací (DESIGN 8.2, DECISIONS „Fáze 6: ladění se šéfy“)
    ['tax_audit', 1, 2],
    ['track_closure', 2, 1],
    ['inventory', 1, 2],
    ['drilling_neighbor', 1, 2],
    ['lunch_break', 2, 0.65],
    ['superstitious_granny', 1, 2],
    ['black_cat', 2, 2],
    ['elbe_fog', 2, 2],
    ['parking_fee', 1, 2],
    ['studio_flat', 2, 1.6],
    ['village_drought', 2, 2],
    ['pickpocket', 2, 2.25],
    ['bailiff', 2, 1.75],
  ];

  it('13 šéfů v pořadí tabulky, od patra a cíle podle tabulky, odměna výchozí, nikdo finálový', () => {
    expect(BOSSES_A.map((b) => b.id)).toEqual(TABLE.map(([id]) => id));
    for (const [id, minAnte, mult] of TABLE) {
      const b = def(id);
      expect(b.minAnte, id).toBe(minAnte);
      expect(b.targetMult ?? 2, id).toBe(mult);
      expect(b.reward, id).toBeUndefined();
      expect(b.final, id).toBeUndefined();
      // Každý má pravidlo → smí se losovat i jako pravidlo Velké útraty (Imperial).
      expect(bossHasRule(b), id).toBe(true);
    }
  });

  it('čísla pravidel v params', () => {
    const params = Object.fromEntries(BOSSES_A.filter((b) => b.params).map((b) => [b.id, b.params]));
    expect(params).toEqual({
      tax_audit: { fee: 1 },
      lunch_break: { hands: 1 },
      black_cat: { cards: 2 },
      elbe_fog: { min: 2, max: 5 },
      parking_fee: { fee: 1 },
      studio_flat: { handSize: 2 },
      village_drought: { discards: 0, hands: 1 },
    });
  });

  it('každý má název, pravidlo, příchod, porážku a pitvu; čísla z params jsou v pravidle', () => {
    for (const b of BOSSES_A) {
      for (const key of ['name', 'rule', 'intro', 'defeat', 'death'])
        expect(hasKey(`bosses.${b.id}.${key}`), `${b.id}.${key}`).toBe(true);
      const name = t(`bosses.${b.id}.name`);
      expect(name.split(/\s+/).length, b.id).toBeLessThanOrEqual(3);
      // Čísla jen přes `{param}`: po dosazení nic nezbyde, každé číslo z params v textu je a změna params text změní.
      const rule = t(`bosses.${b.id}.rule`, b.params);
      expect(rule, b.id).not.toMatch(/[{}]/);
      for (const [k, v] of Object.entries(b.params ?? {})) {
        if (typeof v !== 'number') continue;
        expect(rule, `${b.id}: ${v}`).toContain(formatNumber(v));
        expect(t(`bosses.${b.id}.rule`, { ...b.params, [k]: 37 }), `${b.id}.${k}`).toContain('37');
      }
    }
    expect(t('bosses.track_closure.rule')).toContain('druhá');
    expect(t('bosses.tax_audit.rule', { fee: 1 })).toContain(`1${NBSP}Kč`);
    expect(t('bosses.studio_flat.rule', { handSize: 2 })).toBe(`−2${NBSP}karty v${NBSP}ruce.`);
    expect(t('bosses.parking_fee.rule', { fee: 1 })).toContain('× číslo patra');
    expect(t('bosses.black_cat.rule', { cards: 5 })).toContain(`5${NBSP}náhodných karet`);
    expect(t('bosses.tax_audit.death').replaceAll(NBSP, ' ')).toBe('Doklady k tomu nemáte, že?');
    expect(hasKey('bosses.drilling_neighbor.blocked')).toBe(true);
    for (const suit of SUITS) expect(hasKey(`bosses.superstitious_granny.omen.${suit}`), suit).toBe(true);
  });

  it('ArtSpec: ikony ze src/assets/icons, barvy, každý šéf jiná ikona', () => {
    for (const b of BOSSES_A) {
      expect(isIconName(b.art.icon), b.id).toBe(true);
      if (b.art.prop) expect(isIconName(b.art.prop), b.id).toBe(true);
      expect(b.color, b.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(BOSSES_A.map((b) => b.art.icon)).size).toBe(BOSSES_A.length);
  });

  it('v patře 1 se losují jen šéfové s minAnte 1', () => {
    const allowed = BOSSES_A.filter((b) => (b.minAnte ?? 1) <= 1).map((b) => b.id);
    expect(allowed).toEqual([
      'tax_audit',
      'inventory',
      'drilling_neighbor',
      'superstitious_granny',
      'parking_fee',
    ]);
    const regOnly = { ...reg, bosses: Object.fromEntries(BOSSES_A.map((b) => [b.id, b])) };
    for (let i = 0; i < 12; i++) {
      const game = makeGame({ registry: regOnly, seed: `ANTE1-${i}` });
      expect(allowed).toContain(pickBossId(game._core));
    }
  });
});

// ─────────────────────────── 1 Kontrola z finančáku ───────────────────────────

describe('Kontrola z finančáku (tax_audit)', () => {
  it('každá zahraná karta stojí 1 Kč (srážka po ruce), zahození nic', () => {
    const { game } = bossGame('tax_audit', { money: 20 });
    const { events } = play(game, [game.state.round!.hand[0]!]);
    expect(game.state.money).toBe(19);
    expect(events).toContainEqual({ type: 'moneyChanged', delta: -1, money: 19, reason: 'boss' });
    const { events: ev3 } = play(game, game.state.round!.hand.slice(0, 3));
    expect(game.state.money).toBe(16);
    expect(ev3).toContainEqual({ type: 'moneyChanged', delta: -3, money: 16, reason: 'boss' });
    expect(discard(game, [hand(game)[0]!]).ok).toBe(true);
    expect(game.state.money).toBe(16);
  });

  it('daň se strhne jen do dluhového limitu (2 Kč a 5 karet → 0 Kč)', () => {
    const { game } = bossGame('tax_audit', { money: 2 });
    play(game, game.state.round!.hand.slice(0, 5));
    expect(game.state.money).toBe(0);
  });

  it('bez peněz (a bez dluhového limitu) nestrhne nic; po Odvolání neplatí', () => {
    const { game } = bossGame('tax_audit', { money: 0 });
    play(game, [hand(game)[0]!]);
    expect(game.state.money).toBe(0);
    game._core.state.money = 5;
    game._core.api.disableBoss();
    play(game, [hand(game)[0]!]);
    expect(game.state.money).toBe(5);
  });
});

// ─────────────────────────── 2 Výluka na trati ───────────────────────────

describe('Výluka na trati (track_closure)', () => {
  it('na začátku kola je lícem dolů každá druhá líznutá karta (2., 4., 6., 8.)', () => {
    const { game } = bossGame('track_closure');
    expect(hand(game).map((c) => c.faceDown)).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('počítá se přes všechna dobrání kola (9. karta lícem nahoru, 10. dolů), i po uložení a načtení', () => {
    const { game } = bossGame('track_closure');
    play(game, [hand(game)[0]!]);
    const ninth = hand(game)[hand(game).length - 1]!;
    expect(ninth.faceDown).toBe(false);
    const restored = reload(game);
    const res = restored.dispatch({ type: 'discard', cardIds: [restored.state.round!.hand[0]!] });
    expect(res.ok).toBe(true);
    const r = restored.state.round!;
    const tenth = restored._core.mustCard(r.hand[r.hand.length - 1]!);
    expect(tenth.faceDown).toBe(true);
    expect(r.hand.filter((id) => restored._core.mustCard(id).faceDown)).toHaveLength(4);
  });

  it('zahraná karta lícem dolů se otočí a skóruje; Odvolání otočí ruku lícem nahoru', () => {
    const { game } = bossGame('track_closure');
    const hidden = hand(game)[1]!;
    const { result } = play(game, [hidden]);
    expect(hidden.faceDown).toBe(false);
    expect(result.chips).toBeGreaterThan(6);
    game._core.api.disableBoss();
    expect(hand(game).some((c) => c.faceDown)).toBe(false);
  });
});

// ─────────────────────────── 3 Inventura ───────────────────────────

describe('Inventura (inventory)', () => {
  it('figury J, Q, K jsou mimo provoz, eso, desítka a kamenná karta ne', () => {
    const { game } = bossGame('inventory');
    const cards = setupRound(game, 'JH QS KD AC 10H KS:stone');
    expect(cards.map((c) => c.debuffed)).toEqual([true, true, true, false, false, false]);
    // Celý balíček, nejen ruka.
    for (const c of game.state.deck)
      if (c.enhancement === null) expect(c.debuffed).toBe(c.rank >= 11 && c.rank <= 13);
  });

  it('Dvojice králů dá jen základ (12 × 2 = 24), bez šéfa 64', () => {
    const { game } = bossGame('inventory');
    const [k1, k2] = setupRound(game, 'KH KS 2C');
    expect(play(game, [k1!, k2!]).result.score).toBe(24);
    const plain = makeGame({ registry: reg, round: true });
    plain._core.state.round!.target = 1e12;
    const [p1, p2] = setupRound(plain, 'KH KS 2C');
    expect(play(plain, [p1!, p2!]).result.score).toBe(64);
  });

  it('s `allFaces` (všechny karty jsou figury) je mimo provoz každá karta s hodnotou', () => {
    const { game } = bossGame('inventory', { jokers: ['court_painter'] });
    const cards = setupRound(game, '2H 7S AD 9C:stone');
    expect(cards.map((c) => c.debuffed)).toEqual([true, true, true, false]);
  });

  it('po Odvolání figury znovu fungují', () => {
    const { game } = bossGame('inventory');
    const [k] = setupRound(game, 'KH 2C');
    game._core.api.disableBoss();
    expect(k!.debuffed).toBe(false);
  });
});

// ─────────────────────────── 4 Soused s vrtačkou ───────────────────────────

describe('Soused s vrtačkou (drilling_neighbor)', () => {
  it('kombinace už zahraná v tomto kole neskóruje (ruka se spotřebuje), jiná ano', () => {
    const { game } = bossGame('drilling_neighbor');
    let cards = setupRound(game, 'KH KS 2C 7D');
    const first = play(game, [cards[0]!, cards[1]!]).result;
    expect(first.hand.type).toBe('pair');
    expect(first.score).toBeGreaterThan(0);
    const scoreAfterFirst = game.state.round!.score;

    cards = setupRound(game, '5H 5S 9C 9D 9S');
    const handsBefore = game.state.round!.handsLeft;
    const blocked = play(game, [cards[0]!, cards[1]!]).result;
    expect(blocked.score).toBe(0);
    expect(blocked.blockedReason).toBe('bosses.drilling_neighbor.blocked');
    expect(game.state.round!.score).toBe(scoreAfterFirst);
    expect(game.state.round!.handsLeft).toBe(handsBefore - 1);

    cards = setupRound(game, '9C 9D 9S 2H');
    const three = play(game, [cards[0]!, cards[1]!, cards[2]!]).result;
    expect(three.hand.type).toBe('three');
    expect(three.score).toBeGreaterThan(0);
  });

  it('po Odvolání se kombinace smí opakovat', () => {
    const { game } = bossGame('drilling_neighbor');
    let cards = setupRound(game, '4H 4S');
    play(game, cards);
    game._core.api.disableBoss();
    cards = setupRound(game, '6H 6S');
    expect(play(game, cards).result.score).toBeGreaterThan(0);
  });
});

// ─────────────────────────── 5 Polední pauza ───────────────────────────

describe('Polední pauza (lunch_break)', () => {
  it('jen 1 ruka a cíl 0,65× základ patra', () => {
    const { game } = bossGame('lunch_break');
    const r = game.state.round!;
    expect(r.handsLeft).toBe(1);
    expect(game.modifiers().hands).toBe(1);
    expect(game.blindTarget('boss', 'lunch_break')).toBe(niceRound(anteBase(1, 1) * 0.65));
    expect(game.blindTarget('boss', 'lunch_break')).toBe(165);
  });

  it('strop platí i se žolíkem +1 ruka (pořád 1 ruka); zahození zůstávají', () => {
    const { game } = bossGame('lunch_break', { jokers: ['extra_hands'] });
    expect(game.state.round!.handsLeft).toBe(1);
    expect(game.state.round!.discardsLeft).toBe(3);
  });

  it('ruka pod cílem = konec runu', () => {
    const { game } = bossGame('lunch_break');
    play(game, [hand(game)[0]!]);
    expect(game.state.phase).toBe('game_over');
  });

  it('Odvolání vrátí ruce (1 → 4, se žolíkem 5); uložení a načtení strop zachová', () => {
    const { game } = bossGame('lunch_break', { jokers: ['extra_hands'] });
    const restored = reload(game);
    expect(restored.modifiers().hands).toBe(1);
    restored._core.api.disableBoss();
    expect(restored.state.round!.handsLeft).toBe(5);
  });
});

// ─────────────────────────── 6 Pověrčivá babka ───────────────────────────

describe('Pověrčivá babka (superstitious_granny)', () => {
  function suitOf(game: Game): Suit {
    const s = game.state.round!.flags['superstitious_granny.suit'];
    expect(SUITS).toContain(s);
    return s as Suit;
  }

  it('vylosuje barvu a ohlásí ji; karty té barvy (i divoké) jsou mimo provoz, ostatní a kamenné ne', () => {
    const { game, events } = bossGame('superstitious_granny');
    const suit = suitOf(game);
    expect(events).toContainEqual({ type: 'message', key: `bosses.superstitious_granny.omen.${suit}` });
    for (const c of game.state.deck) expect(c.debuffed, `${c.rank}${c.suit}`).toBe(c.suit === suit);
    const other = SUITS.find((s) => s !== suit)!;
    const [same, diff, wild, stone] = setupRound(game, [
      { suit, rank: 9 },
      { suit: other, rank: 9 },
      { suit: other, rank: 9, enhancement: 'wild' },
      { suit, rank: 9, enhancement: 'stone' },
    ]);
    expect([same, diff, wild, stone].map((c) => c!.debuffed)).toEqual([true, false, true, false]);
  });

  it('barva je daná seedem a mezi seedy se střídá', () => {
    const suits = new Set<Suit>();
    for (let i = 0; i < 16; i++) {
      const a = suitOf(bossGame('superstitious_granny', { seed: `BABKA-${i}` }).game);
      expect(suitOf(bossGame('superstitious_granny', { seed: `BABKA-${i}` }).game)).toBe(a);
      suits.add(a);
    }
    expect(suits.size).toBeGreaterThan(1);
  });

  it('po Odvolání barva neplatí', () => {
    const { game } = bossGame('superstitious_granny');
    game._core.api.disableBoss();
    expect(game.state.deck.some((c) => c.debuffed)).toBe(false);
  });
});

// ─────────────────────────── 7 Černá kočka ───────────────────────────

describe('Černá kočka (black_cat)', () => {
  it('po zahrané ruce jsou 2 náhodné karty, které zůstaly v ruce, mimo provoz; dobrané karty ne', () => {
    const { game } = bossGame('black_cat');
    const cards = setupRound(game, '2S 3S 4S 6H 7H 8H 9D JD');
    expect(cards.some((c) => c.debuffed)).toBe(false);
    play(game, [cards[0]!]);
    const held = cards.slice(1);
    const cursed = held.filter((c) => c.debuffed);
    expect(cursed).toHaveLength(2);
    expect(game.state.round!.flags['black_cat.cards']).toEqual(
      expect.arrayContaining(cursed.map((c) => c.id)),
    );
    const drawn = hand(game).filter((c) => !held.includes(c));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.debuffed).toBe(false);
  });

  it('kletba platí do konce kola: zahraná prokletá karta nedá čipy; další ruka prokleje 2 další', () => {
    const { game } = bossGame('black_cat');
    const cards = setupRound(game, '2S 3S 4S 6H 7H 8H 9D JD');
    play(game, [cards[0]!]);
    const cursed = hand(game).filter((c) => c.debuffed);
    const { result } = play(game, [cursed[0]!]);
    expect(result.chips).toBe(6); // jen základ Vysoké karty
    const nowCursed = hand(game).filter((c) => c.debuffed);
    // 1 prokletá zůstala v ruce + 2 nové
    expect(nowCursed).toHaveLength(3);
    expect(nowCursed).toContain(cursed[1]);
  });

  it('s jedinou kartou v ruce prokleje jen ji; stejný seed = stejné karty i po uložení a načtení', () => {
    const { game } = bossGame('black_cat');
    const [a, b] = setupRound(game, '5C 6C');
    game._core.state.round!.drawPile = [];
    play(game, [a!]);
    expect(b!.debuffed).toBe(true);

    const pick = (g: Game) => g.state.round!.flags['black_cat.cards'];
    const g1 = bossGame('black_cat', { seed: 'KOCKA' }).game;
    const g2 = reload(bossGame('black_cat', { seed: 'KOCKA' }).game);
    play(g1, [g1.state.round!.hand[0]!]);
    play(g2, [g2.state.round!.hand[0]!]);
    expect(pick(g2)).toEqual(pick(g1));
  });

  it('další kolo i Odvolání kletbu zruší', () => {
    const { game } = bossGame('black_cat');
    play(game, [hand(game)[0]!]);
    expect(hand(game).filter((c) => c.debuffed)).toHaveLength(2);
    game._core.api.disableBoss();
    expect(hand(game).some((c) => c.debuffed)).toBe(false);

    const won = bossGame('black_cat').game;
    play(won, [hand(won)[0]!]);
    winNextHand(won);
    play(won, [hand(won)[0]!]);
    expect(won.state.phase).toBe('round_end');
    expect(won.dispatch({ type: 'cashOut' }).ok).toBe(true);
    expect(won.dispatch({ type: 'leaveShop' }).ok).toBe(true);
    expect(won.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    expect(won.state.deck.some((c) => c.debuffed)).toBe(false);
  });
});

// ─────────────────────────── 8 Mlha nad Labem ───────────────────────────

describe('Mlha nad Labem (elbe_fog)', () => {
  it('karty 2–5 se lížou lícem dolů, 6 a výš lícem nahoru', () => {
    const { game } = bossGame('elbe_fog');
    for (const c of hand(game)) expect(c.faceDown, `${c.rank}${c.suit}`).toBe(c.rank >= 2 && c.rank <= 5);
  });

  it('hranice: 5 dolů, 6 nahoru; kamenná trojka hodnotu nemá → nahoru; platí i pro další dobrání', () => {
    const { game } = bossGame('elbe_fog');
    const six = putOnTop(game, '6H');
    const five = putOnTop(game, '5S');
    const stone = putOnTop(game, '3D:stone');
    expect(discard(game, hand(game).slice(0, 3)).ok).toBe(true);
    expect([stone.faceDown, five.faceDown, six.faceDown]).toEqual([false, true, false]);
  });
});

// ─────────────────────────── 9 Parkovné ───────────────────────────

describe('Parkovné (parking_fee)', () => {
  it('v patře 1 stojí každé zahození 1 Kč (bez ohledu na počet karet), zahrání nic', () => {
    const { game } = bossGame('parking_fee', { money: 10 });
    expect(game.state.ante).toBe(1);
    expect(discard(game, hand(game).slice(0, 3)).ok).toBe(true);
    expect(game.state.money).toBe(9);
    expect(discard(game, hand(game).slice(0, 1)).ok).toBe(true);
    expect(game.state.money).toBe(8);
    play(game, [hand(game)[0]!]);
    expect(game.state.money).toBe(8);
  });

  it('poplatek roste s patrem: v patře 4 stojí zahození 4 Kč', () => {
    const { game } = bossGame('parking_fee', { money: 10 });
    game._core.state.ante = 4;
    expect(discard(game, hand(game).slice(0, 2)).ok).toBe(true);
    expect(game.state.money).toBe(6);
  });

  it('bez peněz nestrhne nic; po Odvolání zahození nic nestojí', () => {
    const { game } = bossGame('parking_fee', { money: 0 });
    expect(discard(game, hand(game).slice(0, 1)).ok).toBe(true);
    expect(game.state.money).toBe(0);
    game._core.state.money = 3;
    game._core.api.disableBoss();
    expect(discard(game, hand(game).slice(0, 1)).ok).toBe(true);
    expect(game.state.money).toBe(3);
  });
});

// ─────────────────────────── 10 Garsonka 1+kk ───────────────────────────

describe('Garsonka 1+kk (studio_flat)', () => {
  it('ruka 6 karet, ale vybrat jde dál 5 karet (Postupka i Barva zůstávají)', () => {
    const { game } = bossGame('studio_flat');
    expect(hand(game)).toHaveLength(6);
    expect(game.modifiers().maxSelect).toBe(5);
    const ids = game.state.round!.hand;
    expect(game.dispatch({ type: 'play', cardIds: ids.slice(0, 5) }).ok).toBe(true);
    expect(hand(game)).toHaveLength(6);
  });

  it('výběr se žolíkem +1 neomezí; −2 karty se sčítají s většími rukama', () => {
    const { game } = bossGame('studio_flat', { jokers: ['wide_grip', 'big_hand'] });
    expect(game.modifiers().maxSelect).toBe(6);
    expect(hand(game)).toHaveLength(8);
  });

  it('Odvolání vrátí výběr i velikost ruky', () => {
    const { game } = bossGame('studio_flat', { jokers: ['wide_grip'] });
    game._core.api.disableBoss();
    expect(game.modifiers().maxSelect).toBe(6);
    expect(game.modifiers().handSize).toBe(8);
  });
});

// ─────────────────────────── 11 Sucho v obci ───────────────────────────

describe('Sucho v obci (village_drought)', () => {
  it('0 zahození a 5 rukou; zahodit nejde', () => {
    const { game } = bossGame('village_drought');
    expect(game.state.round!.discardsLeft).toBe(0);
    expect(game.state.round!.handsLeft).toBe(5);
    expect(discard(game, hand(game).slice(0, 1))).toMatchObject({ ok: false, error: 'noDiscardsLeft' });
  });

  it('0 zahození i se žolíkem +1 zahození; po Odvolání se zahození vrátí a ruka navíc zmizí', () => {
    const { game } = bossGame('village_drought', { jokers: ['extra_discards'] });
    expect(game.state.round!.discardsLeft).toBe(0);
    play(game, [hand(game)[0]!]);
    const restored = reload(game);
    expect(restored.state.round!.discardsLeft).toBe(0);
    restored._core.api.disableBoss();
    expect(restored.state.round!.discardsLeft).toBe(4);
    expect(restored.state.round!.handsLeft).toBe(3);
  });
});

// ─────────────────────────── 12 Kapsář v tramvaji ───────────────────────────

describe('Kapsář v tramvaji (pickpocket)', () => {
  it('po zahrané ruce zahodí z ruky kartu s nejvyšší hodnotou (při shodě tu nejvíc vlevo); ruka se dobere', () => {
    const { game } = bossGame('pickpocket');
    const cards = setupRound(game, 'KD 2H AS 3C 5S QH 7D AH');
    const { events } = play(game, [cards[1]!]);
    const r = game.state.round!;
    expect(r.hand).not.toContain(cards[2]!.id);
    expect(r.discardPile).toContain(cards[2]!.id);
    expect(r.hand).toContain(cards[7]!.id);
    expect(events).toContainEqual({ type: 'cardsDiscarded', cardIds: [cards[2]!.id], forced: true });
    expect(r.hand).toHaveLength(8);
    // Nucené zahození nespotřebuje zahození.
    expect(r.discardsLeft).toBe(3);
  });

  it('kamenná karta hodnotu nemá; bez karet v ruce nic', () => {
    const { game } = bossGame('pickpocket');
    const [stone, nine, two] = setupRound(game, 'KS:stone 9H 2C');
    game._core.state.round!.drawPile = [];
    play(game, [two!]);
    expect(game.state.round!.hand).toEqual([stone!.id]);
    expect(game.state.round!.discardPile).toContain(nine!.id);
    play(game, [stone!]);
    expect(game.state.phase).toBe('game_over');
  });

  it('po Odvolání nekrade', () => {
    const { game } = bossGame('pickpocket');
    const cards = setupRound(game, 'AS 2H');
    game._core.api.disableBoss();
    play(game, [cards[1]!]);
    expect(game.state.round!.hand).toContain(cards[0]!.id);
  });
});

// ─────────────────────────── 13 Exekutor ───────────────────────────

describe('Exekutor (bailiff)', () => {
  it('na začátku kola vyřadí žolíka s nejvyšší prodejní cenou; ten v kole nic nedělá', () => {
    const { game } = bossGame('bailiff', { jokers: ['plus_mult', 'epic_one', 'rare_one'] });
    const [plus, epic, rare] = game.state.jokers;
    const api = game._core.api;
    expect(api.sellValue(epic!)).toBeGreaterThan(api.sellValue(rare!));
    expect([plus!.debuffed, epic!.debuffed, rare!.debuffed]).toEqual([false, true, false]);
  });

  it('zabavený žolík přestane působit; přeřazení ani zahrání ruky debuff nezmění', () => {
    const { game } = bossGame('bailiff', { jokers: ['noop', { id: 'plus_mult', edition: 'poly' }] });
    const [noop, plus] = game.state.jokers;
    expect(plus!.debuffed).toBe(true);
    const cards = setupRound(game, 'AS');
    const { result } = play(game, cards);
    expect(result.steps.some((s) => s.source === 'joker')).toBe(false);
    expect(game.dispatch({ type: 'reorderJokers', uids: [plus!.uid, noop!.uid] }).ok).toBe(true);
    expect(game.state.jokers.map((j) => j.debuffed)).toEqual([true, false]);
  });

  it('při shodě ceny vezme žolíka nejvíc vlevo; žolík už mimo provoz (zvětralý) se přeskočí', () => {
    const tie = bossGame('bailiff', { jokers: ['epic_one', 'epic_one'] }).game;
    expect(tie.state.jokers.map((j) => j.debuffed)).toEqual([true, false]);

    const { game } = makeGameWithPerished();
    selectBoss(game, 'bailiff');
    expect(game.state.jokers.map((j) => j.debuffed)).toEqual([true, true, false]);
    expect(game.state.round!.jokerDebuffs).toEqual([game.state.jokers[1]!.uid]);
  });

  it('bez žolíků nic; po vyhraném kole i po Odvolání žolík znovu funguje', () => {
    expect(() => bossGame('bailiff')).not.toThrow();

    const { game } = bossGame('bailiff', { jokers: ['epic_one'] });
    game._core.api.disableBoss();
    expect(game.state.jokers[0]!.debuffed).toBe(false);

    const won = bossGame('bailiff', { jokers: ['epic_one'] }).game;
    expect(won.state.jokers[0]!.debuffed).toBe(true);
    winNextHand(won);
    play(won, [hand(won)[0]!]);
    expect(won.state.phase).toBe('round_end');
    expect(won.state.jokers[0]!.debuffed).toBe(false);
  });

  /** Zleva: zvětralý epický (nejdražší, ale už mimo provoz), vzácný, obyčejný → zabaví se vzácný (index 1). */
  function makeGameWithPerished(): { game: Game } {
    const game = makeGame({
      registry: reg,
      jokers: [{ id: 'epic_one', stickers: ['perishable'], debuffed: true }, 'rare_one', 'noop'],
    });
    game._core.state.jokers[0]!.perishRounds = 0;
    return { game };
  }
});
