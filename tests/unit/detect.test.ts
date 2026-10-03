/**
 * Detekce kombinací — docs/DESIGN.md kap. 2.2.2 (definice a hraniční případy), 2.2.3 (relace „obsahuje“)
 * a 2.2.4 (tajné kombinace). Rozhodnutí k nejednoznačným případům: docs/DECISIONS.md.
 */
import { describe, expect, it } from 'vitest';
import { ENHANCEMENTS } from '../../src/content/modifiers';
import type { EnhancementLookup } from '../../src/engine/cards/cards';
import { createCard } from '../../src/engine/cards/cards';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import type { DetectModifiers } from '../../src/engine/hands/detect';
import {
  compareHandTypes,
  detectHand,
  exactHandTypes,
  MAX_HAND_CARDS,
  straightKind,
} from '../../src/engine/hands/detect';
import type { Card, DetectedHand, HandType, Rank, Suit } from '../../src/engine/types';
import { HAND_TYPES, SECRET_HAND_TYPES } from '../../src/engine/types';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Skutečná vylepšení z obsahu (divoká = `allSuits`, kamenná = `noRankSuit`). */
const ENH: EnhancementLookup = Object.fromEntries(ENHANCEMENTS.map((e) => [e.id, e]));

const RANK_OF: Record<string, Rank> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/**
 * Karta z řetězce: hodnota (2–10, J, Q, K, A) + barva (S, H, D, C) + nepovinné přípony:
 * `*` divoká, `#` kamenná, `!` debuffnutá, `^` lícem dolů, `+N` trvalé bonusové čipy.
 * Např. `AS`, `10H`, `KH*`, `QS#`, `9D!`, `QH+5`.
 */
function card(token: string, id: number): Card {
  const m = /^(10|[2-9JQKA])([SHDC])((?:[*#!^]|\+\d+)*)$/.exec(token);
  if (!m) throw new Error(`Neplatná karta: ${token}`);
  const flags = m[3] ?? '';
  const bonus = /\+(\d+)/.exec(flags);
  const c = createCard(id, {
    rank: RANK_OF[m[1]!]!,
    suit: m[2] as Suit,
    enhancement: flags.includes('*') ? 'wild' : flags.includes('#') ? 'stone' : null,
    bonusChips: bonus ? Number(bonus[1]) : 0,
  });
  c.debuffed = flags.includes('!');
  c.faceDown = flags.includes('^');
  return c;
}

/** Zahrané karty z řetězce oddělených mezerami; id = pořadí zahrání (0, 1, 2…). */
function hand(spec: string): Card[] {
  const tokens = spec.trim().split(/\s+/).filter(Boolean);
  return tokens.map((t, i) => card(t, i));
}

function mods(over: Partial<DetectModifiers> = {}): DetectModifiers {
  return { ...BASE_MODIFIERS, ...over };
}

interface Result extends DetectedHand {
  /** Skórující karty jako původní řetězce (v pořadí zahrání). */
  scoring: string[];
}

function detect(spec: string, over: Partial<DetectModifiers> = {}): Result {
  const tokens = spec.trim().split(/\s+/).filter(Boolean);
  const res = detectHand(hand(spec), { mods: mods(over), enhancements: ENH });
  if (!res) throw new Error(`Žádná kombinace pro „${spec}“`);
  return { ...res, scoring: res.scoringIds.map((id) => tokens[id]!) };
}

const typeOf = (spec: string, over: Partial<DetectModifiers> = {}): HandType => detect(spec, over).type;

// ─────────────────────────── Testy ───────────────────────────

describe('pomocník pro karty', () => {
  it('čte hodnoty, barvy a přípony', () => {
    const [a, b, c, d, e, f] = hand('AS 10H KH* QS# 9D!^ QH+5');
    expect(a).toMatchObject({ id: 0, rank: 14, suit: 'S', enhancement: null });
    expect(b).toMatchObject({ id: 1, rank: 10, suit: 'H' });
    expect(c).toMatchObject({ rank: 13, suit: 'H', enhancement: 'wild' });
    expect(d).toMatchObject({ rank: 12, suit: 'S', enhancement: 'stone' });
    expect(e).toMatchObject({ rank: 9, debuffed: true, faceDown: true });
    expect(f).toMatchObject({ rank: 12, bonusChips: 5 });
  });

  it('skutečná vylepšení z obsahu: divoká patří do všech barev, kamenná nemá hodnotu ani barvu', () => {
    expect(ENH.wild?.allSuits).toBe(true);
    expect(ENH.stone?.noRankSuit).toBe(true);
  });
});

describe('compareHandTypes', () => {
  it('pořadí síly odpovídá HAND_TYPES (DESIGN 2.2.1, sloupec 1)', () => {
    for (let i = 0; i < HAND_TYPES.length; i++) {
      expect(compareHandTypes(HAND_TYPES[i]!, HAND_TYPES[i]!)).toBe(0);
      for (let j = i + 1; j < HAND_TYPES.length; j++) {
        expect(compareHandTypes(HAND_TYPES[j]!, HAND_TYPES[i]!)).toBeGreaterThan(0);
        expect(compareHandTypes(HAND_TYPES[i]!, HAND_TYPES[j]!)).toBeLessThan(0);
      }
    }
  });

  it('klíčové dvojice', () => {
    expect(compareHandTypes('flush', 'straight')).toBeGreaterThan(0);
    expect(compareHandTypes('full_house', 'flush')).toBeGreaterThan(0);
    expect(compareHandTypes('four', 'full_house')).toBeGreaterThan(0);
    expect(compareHandTypes('royal_flush', 'straight_flush')).toBeGreaterThan(0);
    expect(compareHandTypes('five', 'royal_flush')).toBeGreaterThan(0);
    expect(compareHandTypes('flush_house', 'five')).toBeGreaterThan(0);
    expect(compareHandTypes('flush_five', 'flush_house')).toBeGreaterThan(0);
    expect(compareHandTypes('high_card', 'pair')).toBeLessThan(0);
  });

  it('řazení podle compareHandTypes dá HAND_TYPES', () => {
    const shuffled = [...HAND_TYPES].reverse();
    expect(shuffled.sort(compareHandTypes)).toEqual(HAND_TYPES);
  });
});

describe('počet zahraných karet', () => {
  it('prázdný výběr → null', () => {
    expect(detectHand([], { mods: mods(), enhancements: ENH })).toBeNull();
  });

  it('1 karta = Vysoká karta', () => {
    expect(detect('7D')).toEqual({
      type: 'high_card',
      scoringIds: [0],
      contains: ['high_card'],
      scoring: ['7D'],
    });
  });

  it.each([
    ['2 karty', '9S 9H', 'pair', ['9S', '9H']],
    ['2 karty bez shody', '9S KH', 'high_card', ['KH']],
    ['3 karty', '9S 9H 9D', 'three', ['9S', '9H', '9D']],
    ['3 karty s dvojicí', '9S 2H 9D', 'pair', ['9S', '9D']],
    ['4 karty', '9S 9H 9D 9C', 'four', ['9S', '9H', '9D', '9C']],
    ['4 karty, dvě dvojice', '9S 3H 9D 3C', 'two_pair', ['9S', '3H', '9D', '3C']],
    ['4 karty po sobě nejsou Postupka', '5S 6H 7D 8C', 'high_card', ['8C']],
    ['4 karty jedné barvy nejsou Barva', '5H 9H 2H KH', 'high_card', ['KH']],
    ['5 karet', '5S 6H 7D 8C 9S', 'straight', ['5S', '6H', '7D', '8C', '9S']],
  ])('%s: %s → %s', (_name, spec, type, scoring) => {
    const r = detect(spec);
    expect(r.type).toBe(type);
    expect(r.scoring).toEqual(scoring);
  });
});

describe('všech 13 kombinací: typ, skórující karty v pořadí zahrání, contains (DESIGN 2.2.2 a 2.2.3)', () => {
  // [zahrané karty, typ, skórující karty, contains]
  const cases: [string, HandType, string[], HandType[]][] = [
    ['2S 9H KD 4C 7S', 'high_card', ['KD'], ['high_card']],
    ['9S 2H KD 9C 7S', 'pair', ['9S', '9C'], ['pair']],
    ['9S KD 2C 9H KC', 'two_pair', ['9S', 'KD', '9H', 'KC'], ['pair', 'two_pair']],
    ['9S 9H 4C 9D KS', 'three', ['9S', '9H', '9D'], ['pair', 'three']],
    ['7S 5H 6D 9C 8S', 'straight', ['7S', '5H', '6D', '9C', '8S'], ['straight']],
    ['2H 9H KH 4H 7H', 'flush', ['2H', '9H', 'KH', '4H', '7H'], ['flush']],
    [
      '9S 4H 9H 4C 9D',
      'full_house',
      ['9S', '4H', '9H', '4C', '9D'],
      ['pair', 'two_pair', 'three', 'full_house'],
    ],
    ['9S 9H 4C 9D 9C', 'four', ['9S', '9H', '9D', '9C'], ['pair', 'three', 'four']],
    [
      '8C 5C 9C 6C 7C',
      'straight_flush',
      ['8C', '5C', '9C', '6C', '7C'],
      ['straight', 'flush', 'straight_flush'],
    ],
    [
      'AS KS QS JS 10S',
      'royal_flush',
      ['AS', 'KS', 'QS', 'JS', '10S'],
      ['straight', 'flush', 'straight_flush', 'royal_flush'],
    ],
    ['7S 7H 7D 7C 7S', 'five', ['7S', '7H', '7D', '7C', '7S'], ['pair', 'three', 'four', 'five']],
    [
      '7H 4H 7H 4H 7H',
      'flush_house',
      ['7H', '4H', '7H', '4H', '7H'],
      ['pair', 'two_pair', 'three', 'flush', 'full_house', 'flush_house'],
    ],
    [
      '7H 7H 7H 7H 7H',
      'flush_five',
      ['7H', '7H', '7H', '7H', '7H'],
      ['pair', 'three', 'flush', 'four', 'five', 'flush_five'],
    ],
  ];

  it('pokrývá všech 13 typů', () => {
    expect(cases.map((c) => c[1])).toEqual(HAND_TYPES);
  });

  it.each(cases)('%s → %s', (spec, type, scoring, contains) => {
    const r = detect(spec);
    expect(r.type).toBe(type);
    expect(r.scoring).toEqual(scoring);
    expect(r.contains).toEqual(contains);
  });

  it('scoringIds jsou id karet v pořadí zahrání', () => {
    expect(detect('KD 9S 2C 9H KC').scoringIds).toEqual([0, 1, 3, 4]);
  });

  it('contains splňuje tabulku 2.2.3 a obsahuje vyhodnocenou kombinaci', () => {
    const table: Partial<Record<HandType, HandType[]>> = {
      two_pair: ['pair'],
      three: ['pair'],
      full_house: ['three', 'two_pair', 'pair'],
      four: ['three', 'pair'],
      straight_flush: ['straight', 'flush'],
      royal_flush: ['straight_flush', 'straight', 'flush'],
      five: ['four', 'three', 'pair'],
      flush_house: ['full_house', 'flush', 'three', 'two_pair', 'pair'],
      flush_five: ['five', 'flush', 'four', 'three', 'pair'],
    };
    for (const [spec, type, , contains] of cases) {
      const expected = new Set<HandType>([type, ...(table[type] ?? [])]);
      expect(new Set(contains), spec).toEqual(expected);
      expect(detect(spec).contains).toEqual(HAND_TYPES.filter((h) => expected.has(h)));
    }
  });

  it('contains je seřazené podle síly (pořadí HAND_TYPES)', () => {
    const c = detect('7H 4H 7H 4H 7H').contains;
    expect([...c].sort(compareHandTypes)).toEqual(c);
  });
});

describe('Vysoká karta (DESIGN 2.2.2)', () => {
  it('skóruje karta s nejvyšší hodnotou, ne s nejvíc čipy (K i Q mají 10 čipů)', () => {
    expect(detect('QS KH JD').scoring).toEqual(['KH']);
    expect(detect('JD QS 2H').scoring).toEqual(['QS']);
  });

  it('Eso je nejvyšší', () => {
    expect(detect('2S AH KD').scoring).toEqual(['AH']);
  });

  it('bonusové čipy nižší karty nerozhodují', () => {
    expect(detect('QH+30 KS 3D').scoring).toEqual(['KS']);
  });

  it('Vysoká karta není obsažena v ničem jiném', () => {
    for (const spec of ['9S 9H', '9S KD 2C 9H KC', '7S 5H 6D 9C 8S', '2H 9H KH 4H 7H', 'AS KS QS JS 10S']) {
      expect(detect(spec).contains, spec).not.toContain('high_card');
    }
  });
});

describe('Dvojice, Trojice, Čtveřice, Dvě dvojice (DESIGN 2.2.2)', () => {
  it('kopy neskórují', () => {
    expect(detect('AS 9H 9D KC 2S').scoring).toEqual(['9H', '9D']);
    expect(detect('AS 9H 9D KC 9S').scoring).toEqual(['9H', '9D', '9S']);
    expect(detect('9C AS 9H 9D 9S').scoring).toEqual(['9C', '9H', '9D', '9S']);
  });

  it('Dvě dvojice v 5 kartách: pátá karta neskóruje, ať je kdekoli', () => {
    expect(detect('AS KH KD 3C 3S').scoring).toEqual(['KH', 'KD', '3C', '3S']);
    expect(detect('KH 3C AS KD 3S').scoring).toEqual(['KH', '3C', 'KD', '3S']);
    expect(detect('KH 3C KD 3S AS').scoring).toEqual(['KH', '3C', 'KD', '3S']);
  });

  it('dvě „dvojice“ stejné hodnoty jsou Čtveřice', () => {
    const r = detect('9S 9H 2D 9D 9C');
    expect(r.type).toBe('four');
    expect(r.contains).not.toContain('two_pair');
  });

  it('Trojice + kop není Full house', () => {
    expect(typeOf('9S 9H 9D 4C KS')).toBe('three');
  });

  it('Full house: Trojice + Dvojice jiné hodnoty', () => {
    expect(typeOf('KS 9H KD 9C KC')).toBe('full_house');
  });
});

describe('Postupka (DESIGN 2.2.2)', () => {
  it('A-2-3-4-5 (Eso nízké) platí a skórují všechny karty', () => {
    const r = detect('AS 2H 3D 4C 5S');
    expect(r.type).toBe('straight');
    expect(r.scoring).toEqual(['AS', '2H', '3D', '4C', '5S']);
    expect(r.contains).toEqual(['straight']);
  });

  it('10-J-Q-K-A (Eso vysoké) platí', () => {
    expect(typeOf('10S JH QD KC AS')).toBe('straight');
  });

  it('nezáleží na pořadí zahrání', () => {
    expect(typeOf('KC AS 10S QD JH')).toBe('straight');
    expect(typeOf('3D 5S AS 4C 2H')).toBe('straight');
  });

  it.each(['QS KH AD 2C 3S', 'KS AH 2D 3C 4S', 'JS QH KD AC 2S'])(
    'kolem dokola %s bez straightWrap neplatí',
    (spec) => {
      const r = detect(spec);
      expect(r.type).toBe('high_card');
      expect(r.scoring).toEqual([spec.split(' ').find((t) => t.startsWith('A'))]);
      expect(r.contains).toEqual(['high_card']);
    },
  );

  it.each(['QS KH AD 2C 3S', 'KS AH 2D 3C 4S', 'JS QH KD AC 2S'])(
    'kolem dokola %s se straightWrap platí',
    (spec) => {
      const r = detect(spec, { straightWrap: true });
      expect(r.type).toBe('straight');
      expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
    },
  );

  it('straightWrap nerozbije běžné postupky ani nepovolí díry', () => {
    const wrap = { straightWrap: true };
    expect(typeOf('AS 2H 3D 4C 5S', wrap)).toBe('straight');
    expect(typeOf('10S JH QD KC AS', wrap)).toBe('straight');
    expect(typeOf('5S 6H 7D 8C 9S', wrap)).toBe('straight');
    expect(typeOf('QS KH AD 2C 4S', wrap)).toBe('high_card');
    expect(typeOf('2S 4H 6D 8C 10S', wrap)).toBe('high_card');
  });

  it('chybějící hodnota bez straightGaps neplatí', () => {
    expect(typeOf('2S 3H 4D 5C 7S')).toBe('high_card');
    expect(typeOf('3S 5H 6D 8C 9S')).toBe('high_card');
  });

  it('straightGaps: v celé Postupce smí chybět jedna hodnota (3-4-6-7-8), dvě mezery ne (3-5-6-8-9)', () => {
    const gaps = { straightGaps: true };
    expect(typeOf('3S 4H 6D 7C 8S', gaps)).toBe('straight');
    expect(typeOf('2S 3H 4D 5C 7S', gaps)).toBe('straight');
    expect(typeOf('5S 6H 7D 8C 9S', gaps)).toBe('straight');
    // dvě mezery neplatí
    expect(typeOf('3S 5H 6D 8C 9S', gaps)).toBe('high_card');
    expect(typeOf('2S 4H 6D 8C 10S', gaps)).toBe('high_card');
    // mezera o 2 hodnoty (3 → 6) neplatí
    expect(typeOf('3S 6H 7D 8C 9S', gaps)).toBe('high_card');
    expect(typeOf('2S 3H 4D 5C 8S', gaps)).toBe('high_card');
  });

  it('straightGaps s Esem nízkým i vysokým', () => {
    const gaps = { straightGaps: true };
    expect(typeOf('AS 3H 4D 5C 6S', gaps)).toBe('straight');
    expect(typeOf('AS 2H 3D 5C 6S', gaps)).toBe('straight');
    expect(typeOf('AS 2H 3D 5C 7S', gaps)).toBe('high_card');
    expect(typeOf('9S JH QD KC AS', gaps)).toBe('straight');
    expect(typeOf('8S 10H QD KC AS', gaps)).toBe('high_card');
    // kolem dokola ani s mezerami bez straightWrap
    expect(typeOf('QS AH 2D 3C 4S', gaps)).toBe('high_card');
  });

  it('straightGaps + straightWrap', () => {
    expect(typeOf('QS AH 2D 3C 4S', { straightGaps: true, straightWrap: true })).toBe('straight');
    expect(typeOf('JS QH AD 2C 3S', { straightGaps: true, straightWrap: true })).toBe('straight');
    // dvě mezery ani kolem dokola ne
    expect(typeOf('JS KH AD 3C 4S', { straightGaps: true, straightWrap: true })).toBe('high_card');
  });

  it('duplicitní hodnota (4 karty + kopie): skóruje jen jedna karta každé hodnoty, ta víc vlevo', () => {
    const r = detect('5S 8H 6H 7D 8C', { fourCardStraightFlush: true });
    expect(r.type).toBe('straight');
    expect(r.scoring).toEqual(['5S', '8H', '6H', '7D']);
    expect(r.contains).toEqual(['pair', 'straight']);
  });

  it('duplicitní hodnota: rozhodnou bonusové čipy (vyšší součet čipů skórujících karet)', () => {
    const r = detect('5S 8H 6H 7D 8C+3', { fourCardStraightFlush: true });
    expect(r.scoring).toEqual(['5S', '6H', '7D', '8C+3']);
  });

  it('fourCardStraightFlush: Postupka ze 4 karet, pátá karta neskóruje', () => {
    const r = detect('5S KH 6H 7D 8C', { fourCardStraightFlush: true });
    expect(r.type).toBe('straight');
    expect(r.scoring).toEqual(['5S', '6H', '7D', '8C']);
  });

  it('fourCardStraightFlush: 5 karet po sobě má přednost (víc skórujících karet)', () => {
    expect(detect('5S 6H 7D 8C 9S', { fourCardStraightFlush: true }).scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('fourCardStraightFlush: J-Q-K-A i A-2-3-4', () => {
    expect(typeOf('JS QH KD AC', { fourCardStraightFlush: true })).toBe('straight');
    expect(typeOf('AS 2H 3D 4C', { fourCardStraightFlush: true })).toBe('straight');
    expect(typeOf('KS AH 2D 3C', { fourCardStraightFlush: true })).toBe('high_card');
  });

  it('fourCardStraightFlush + straightGaps', () => {
    expect(typeOf('3S 4H 6D 7C KS', { fourCardStraightFlush: true, straightGaps: true })).toBe('straight');
    expect(typeOf('3S 5H 7D 8C KS', { fourCardStraightFlush: true, straightGaps: true })).toBe('high_card');
  });
});

describe('Barva (DESIGN 2.2.2)', () => {
  it('divoká karta patří do všech barev', () => {
    const r = detect('2H 9H KS* 4H 7H');
    expect(r.type).toBe('flush');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('více divokých i samé divoké karty tvoří Barvu', () => {
    expect(typeOf('2H 9D* KS* 4H 7C*')).toBe('flush');
    expect(typeOf('KS* 2D* 5C* 9H* JS*')).toBe('flush');
  });

  it('kamenná karta do žádné barvy nepatří', () => {
    const r = detect('2H 9H KH 4H QH#');
    expect(r.type).toBe('high_card');
    expect(r.scoring).toEqual(['KH', 'QH#']);
  });

  it('mergedSuits: ♥ = ♦ a ♠ = ♣', () => {
    expect(typeOf('2H 9D KH 4D 7H')).toBe('high_card');
    expect(typeOf('2H 9D KH 4D 7H', { mergedSuits: true })).toBe('flush');
    expect(typeOf('2S 9C KS 4C 7S', { mergedSuits: true })).toBe('flush');
    expect(typeOf('2H 9S KH 4D 7H', { mergedSuits: true })).toBe('high_card');
    expect(typeOf('2H 9D KS* 4D 7H', { mergedSuits: true })).toBe('flush');
  });

  it('fourCardStraightFlush: Barva ze 4 karet, pátá karta neskóruje', () => {
    const r = detect('2H 9H KC 4H 7H', { fourCardStraightFlush: true });
    expect(r.type).toBe('flush');
    expect(r.scoring).toEqual(['2H', '9H', '4H', '7H']);
  });

  it('fourCardStraightFlush: 5 karet barvy skóruje všech 5', () => {
    expect(detect('2H 9H KH 4H 7H', { fourCardStraightFlush: true }).scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('Barva je silnější než Postupka (6 karet: Barva i Postupka z různých karet)', () => {
    const r = detect('2H 3H 4H 5H 6S 9H');
    expect(r.type).toBe('flush');
    expect(r.scoring).toEqual(['2H', '3H', '4H', '5H', '9H']);
    expect(r.contains).toEqual(['straight', 'flush']);
  });
});

describe('Full house vs Barva', () => {
  it('Full house je silnější než Barva', () => {
    expect(compareHandTypes('full_house', 'flush')).toBeGreaterThan(0);
  });

  it('Full house a Barva z různých karet (7 karet) → Full house, Barva v contains', () => {
    const r = detect('9H 9H 9S 4H 4C 2H KH');
    expect(r.type).toBe('full_house');
    expect(r.scoring).toEqual(['9H', '9H', '9S', '4H', '4C']);
    expect(r.contains).toEqual(['pair', 'two_pair', 'three', 'flush', 'full_house']);
  });

  it('Full house s kartami různých barev není Barevný full house', () => {
    expect(typeOf('7H 7H 7S 4H 4H')).toBe('full_house');
  });

  it('Full house, jehož všech 5 karet má jednu barvu, je Barevný full house', () => {
    expect(typeOf('7D 7D 7D 4D 4D')).toBe('flush_house');
  });
});

describe('Postupka v barvě a Královská postupka (DESIGN 2.2.2)', () => {
  it('A-2-3-4-5 v jedné barvě je Postupka v barvě, ne Královská', () => {
    const r = detect('AS 2S 3S 4S 5S');
    expect(r.type).toBe('straight_flush');
    expect(r.contains).not.toContain('royal_flush');
  });

  it('9-10-J-Q-K v jedné barvě není Královská (nejvyšší je Král)', () => {
    expect(typeOf('9H 10H JH QH KH')).toBe('straight_flush');
  });

  it('Postupka a Barva jen z části karet není Postupka v barvě', () => {
    expect(typeOf('AS 2S 3S 4S 5H')).toBe('straight');
  });

  it('divoká karta v Postupce v barvě i Královské', () => {
    expect(typeOf('5C 6C 7H* 8C 9C')).toBe('straight_flush');
    expect(typeOf('10H JH QS* KH AH')).toBe('royal_flush');
  });

  it('mergedSuits: Postupka v barvě z ♥ a ♦', () => {
    expect(typeOf('5H 6D 7H 8D 9H', { mergedSuits: true })).toBe('straight_flush');
    expect(typeOf('10S JC QS KC AS', { mergedSuits: true })).toBe('royal_flush');
  });

  it('kolem dokola (straightWrap) je Postupka v barvě, nikdy Královská', () => {
    for (const spec of ['QH KH AH 2H 3H', 'JH QH KH AH 2H', 'KH AH 2H 3H 4H']) {
      const r = detect(spec, { straightWrap: true });
      expect(r.type, spec).toBe('straight_flush');
      expect(r.contains, spec).toEqual(['straight', 'flush', 'straight_flush']);
    }
  });

  it('se straightWrap zůstává 10-J-Q-K-A v barvě Královská', () => {
    expect(typeOf('10H JH QH KH AH', { straightWrap: true })).toBe('royal_flush');
  });

  it('straightGaps: Postupka v barvě s mezerami; Královská, když je nejvyšší vysoké Eso', () => {
    expect(typeOf('3S 4S 6S 7S 8S', { straightGaps: true })).toBe('straight_flush');
    expect(typeOf('9S JS QS KS AS', { straightGaps: true })).toBe('royal_flush');
    expect(typeOf('AS 3S 4S 5S 6S', { straightGaps: true })).toBe('straight_flush');
    expect(typeOf('3S 5S 6S 8S 9S', { straightGaps: true })).toBe('flush');
  });

  it('fourCardStraightFlush: Postupka v barvě ze 4 karet stejné barvy po sobě', () => {
    const r = detect('QS 5H 6H 7H 8H', { fourCardStraightFlush: true });
    expect(r.type).toBe('straight_flush');
    expect(r.scoring).toEqual(['5H', '6H', '7H', '8H']);
    expect(r.contains).toEqual(['straight', 'flush', 'straight_flush']);
  });

  it('fourCardStraightFlush: Postupka a Barva z různých karet není Postupka v barvě', () => {
    // 5♥ 6♥ 7♥ 2♥ = Barva ze 4, 5-6-7-8 = Postupka ze 4, ale 8♠ nemá barvu ♥.
    const r = detect('5H 6H 7H 2H 8S', { fourCardStraightFlush: true });
    expect(r.type).toBe('flush');
    expect(r.scoring).toEqual(['5H', '6H', '7H', '2H']);
    expect(r.contains).toEqual(['straight', 'flush']);
  });

  it('fourCardStraightFlush: pátá karta stejné barvy mimo postupku neskóruje', () => {
    const r = detect('5H 6H 2H 7H 8H', { fourCardStraightFlush: true });
    expect(r.type).toBe('straight_flush');
    expect(r.scoring).toEqual(['5H', '6H', '7H', '8H']);
  });

  it('fourCardStraightFlush: 5 karet v barvě po sobě skóruje všech 5', () => {
    expect(detect('5H 6H 7H 8H 9H', { fourCardStraightFlush: true }).scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('fourCardStraightFlush: Královská ze 4 karet (J-Q-K-A v jedné barvě)', () => {
    const r = detect('JS QS 2H KS AS', { fourCardStraightFlush: true });
    expect(r.type).toBe('royal_flush');
    expect(r.scoring).toEqual(['JS', 'QS', 'KS', 'AS']);
    expect(r.contains).toEqual(['straight', 'flush', 'straight_flush', 'royal_flush']);
  });

  it('fourCardStraightFlush: Královská z 5 karet má přednost (víc skórujících)', () => {
    expect(detect('10S JS QS KS AS', { fourCardStraightFlush: true }).scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('fourCardStraightFlush: balíček Obrázkový — J-Q-K-A v barvě + kopie Esa', () => {
    const r = detect('JH QH KH AH AH', { fourCardStraightFlush: true });
    expect(r.type).toBe('royal_flush');
    expect(r.scoringIds).toEqual([0, 1, 2, 3]);
    expect(r.contains).toContain('pair');
  });

  it('fourCardStraightFlush: A-2-3-4 v barvě je Postupka v barvě, ne Královská', () => {
    expect(typeOf('AD 2D 3D 4D', { fourCardStraightFlush: true })).toBe('straight_flush');
  });
});

describe('tajné kombinace (DESIGN 2.2.4)', () => {
  it('jsou to nejsilnější tři kombinace', () => {
    expect(HAND_TYPES.slice(-3)).toEqual(SECRET_HAND_TYPES);
  });

  it('Pětice s divokými kartami (bez společné barvy)', () => {
    const r = detect('7S 7H* 7D 7C 7S*');
    expect(r.type).toBe('five');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
    expect(r.contains).toEqual(['pair', 'three', 'four', 'five']);
  });

  it('Pětice, kde divoké karty doplní barvu, je Barevná pětice', () => {
    const r = detect('7S 7H* 7S 7D* 7S');
    expect(r.type).toBe('flush_five');
    expect(r.contains).toEqual(['pair', 'three', 'flush', 'four', 'five', 'flush_five']);
  });

  it('Barevný full house s divokými kartami', () => {
    expect(typeOf('7H 7H 7S* 4H 4C*')).toBe('flush_house');
    expect(typeOf('7H 7H 7S* 4S 4C*')).toBe('full_house');
  });

  it('mergedSuits: Barevná pětice a Barevný full house z ♥ a ♦', () => {
    expect(typeOf('7H 7D 7H 7D 7H')).toBe('five');
    expect(typeOf('7H 7D 7H 7D 7H', { mergedSuits: true })).toBe('flush_five');
    expect(typeOf('7S 7C 7S 4C 4C', { mergedSuits: true })).toBe('flush_house');
  });

  it('Pětice je silnější než Královská i Čtveřice', () => {
    expect(compareHandTypes('five', 'royal_flush')).toBeGreaterThan(0);
    expect(compareHandTypes('five', 'four')).toBeGreaterThan(0);
  });
});

describe('kamenné karty (DESIGN 2.2.2)', () => {
  it('samotná kamenná karta = Vysoká karta a skóruje', () => {
    expect(detect('QS#')).toMatchObject({ type: 'high_card', scoringIds: [0], contains: ['high_card'] });
  });

  it('samé kamenné karty skórují všechny', () => {
    expect(detect('QS# 2H# AD#')).toMatchObject({ type: 'high_card', scoringIds: [0, 1, 2] });
  });

  it('kamenná karta skóruje vedle kombinace v pořadí zahrání', () => {
    const r = detect('9S KS# 9H 2C AD#');
    expect(r.type).toBe('pair');
    expect(r.scoring).toEqual(['9S', 'KS#', '9H', 'AD#']);
  });

  it('kamenná karta nemá hodnotu: netvoří Dvojici', () => {
    const r = detect('KS# KH');
    expect(r.type).toBe('high_card');
    expect(r.scoring).toEqual(['KS#', 'KH']);
  });

  it('kamenná karta se nepočítá do Postupky', () => {
    const r = detect('2S 3H 4D 5C 6S#');
    expect(r.type).toBe('high_card');
    expect(r.scoring).toEqual(['5C', '6S#']);
  });

  it('Vysoká karta se vybírá jen z karet s hodnotou', () => {
    expect(detect('AS# 3H').scoring).toEqual(['AS#', '3H']);
  });

  it('fourCardStraightFlush: Postupka ze 4 karet + kamenná → skóruje všech 5', () => {
    const r = detect('2S 3H 9S# 4D 5C', { fourCardStraightFlush: true });
    expect(r.type).toBe('straight');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('kamenná karta s Full housem z ostatních karet (6 karet)', () => {
    const r = detect('9S 9H AS# 4C 9D 4H');
    expect(r.type).toBe('full_house');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('debuffnuté a zakryté karty se do kombinace počítají', () => {
  it('debuffnutá karta tvoří Dvojici a je mezi skórujícími (nedá čipy až při skórování)', () => {
    const r = detect('9S! 9H 2C');
    expect(r.type).toBe('pair');
    expect(r.scoring).toEqual(['9S!', '9H']);
  });

  it('debuffnuté karty v Barvě a Postupce', () => {
    expect(typeOf('2H! 9H! KH 4H 7H!')).toBe('flush');
    expect(typeOf('5S 6H! 7D 8C! 9S')).toBe('straight');
  });

  it('karta lícem dolů se počítá normálně', () => {
    expect(typeOf('5S^ 6H 7D 8C 9S')).toBe('straight');
  });
});

describe('allCardsScore', () => {
  it('skórují všechny zahrané karty v pořadí zahrání', () => {
    const r = detect('AS 9H 9D KC 2S', { allCardsScore: true });
    expect(r.type).toBe('pair');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
    expect(r.contains).toEqual(['pair']);
  });

  it('u Vysoké karty, Dvou dvojic i s kamennými kartami', () => {
    expect(detect('2S 9H KD', { allCardsScore: true }).scoringIds).toEqual([0, 1, 2]);
    expect(detect('AS KH KD 3C 3S', { allCardsScore: true }).scoringIds).toEqual([0, 1, 2, 3, 4]);
    expect(detect('QS# 9H 2D', { allCardsScore: true }).scoringIds).toEqual([0, 1, 2]);
  });

  it('nemění typ kombinace', () => {
    expect(typeOf('2H 3H 4H 5H 6S 9H', { allCardsScore: true })).toBe('flush');
  });
});

describe('víc než 5 karet (maxSelect 6+): kombinace má nejvýš 5 karet', () => {
  it('Postupka ze 6 karet: skóruje 5 karet s vyšším součtem čipů', () => {
    const r = detect('2S 3H 4D 5C 6S 7H');
    expect(r.type).toBe('straight');
    expect(r.scoring).toEqual(['3H', '4D', '5C', '6S', '7H']);
  });

  it('A-2-3-4-5-6: Eso má 11 čipů, takže vyhraje A-2-3-4-5 (25) nad 2-3-4-5-6 (20)', () => {
    expect(detect('AS 2H 3D 4C 5S 6H').scoring).toEqual(['AS', '2H', '3D', '4C', '5S']);
  });

  it('Barva ze 6 karet: neskóruje karta s nejméně čipy', () => {
    const r = detect('2H 9H KH 4H 7H AH');
    expect(r.type).toBe('flush');
    expect(r.scoring).toEqual(['9H', 'KH', '4H', '7H', 'AH']);
  });

  it('Barva ze 6 karet se shodnými čipy: neskóruje karta nejvíc vpravo', () => {
    expect(detect('KH QH JH 10H 2H 2H').scoring).toEqual(['KH', 'QH', 'JH', '10H', '2H']);
  });

  it('šest karet stejné hodnoty: Pětice, šestá neskóruje', () => {
    const r = detect('7S 7H 7D 7C 7S 7H');
    expect(r.type).toBe('five');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('šest karet stejné hodnoty, pět z nich v jedné barvě → Barevná pětice', () => {
    const r = detect('7H 7S 7H 7H 7H 7H');
    expect(r.type).toBe('flush_five');
    expect(r.scoringIds).toEqual([0, 2, 3, 4, 5]);
  });

  it('tři dvojice: Dvě dvojice s vyšším součtem čipů', () => {
    const r = detect('2C AS KS 2D AH KH');
    expect(r.type).toBe('two_pair');
    expect(r.scoring).toEqual(['AS', 'KS', 'AH', 'KH']);
  });

  it('tři dvojice se shodnými čipy: rozhodne pořadí zahrání (ne hodnota)', () => {
    expect(detect('JS KS QS JH KH QH').scoring).toEqual(['JS', 'KS', 'JH', 'KH']);
    expect(detect('KS QS JS KH QH JH').scoring).toEqual(['KS', 'QS', 'KH', 'QH']);
  });

  it('tři dvojice: bonusové čipy rozhodnou před pořadím', () => {
    expect(detect('JS KS QS JH KH QH+5').scoring).toEqual(['JS', 'QS', 'JH', 'QH+5']);
  });

  it('dvě trojice: Full house z vyšší trojice a dvou karet druhé (víc vlevo)', () => {
    const r = detect('4C 9S 4H 9H 4S 9D');
    expect(r.type).toBe('full_house');
    expect(r.scoring).toEqual(['4C', '9S', '4H', '9H', '9D']);
  });

  it('Full house a další dvojice: skóruje nejlepších 5 karet', () => {
    const r = detect('2S 9S 9H 2D 9D KS KH');
    expect(r.type).toBe('full_house');
    expect(r.scoring).toEqual(['9S', '9H', '9D', 'KS', 'KH']);
  });

  it('dvě čtveřice: Čtveřice s vyšším součtem čipů', () => {
    const r = detect('7S 7H KS KH 7D 7C KD KC');
    expect(r.type).toBe('four');
    expect(r.scoring).toEqual(['KS', 'KH', 'KD', 'KC']);
    expect(r.contains).toEqual(['pair', 'two_pair', 'three', 'full_house', 'four']);
  });

  it('Postupka v barvě ze 6 karet s kopií: kopie neskóruje', () => {
    const r = detect('2H 3H 4H 5H 6H 6S');
    expect(r.type).toBe('straight_flush');
    expect(r.scoringIds).toEqual([0, 1, 2, 3, 4]);
    expect(r.contains).toEqual(['pair', 'straight', 'flush', 'straight_flush']);
  });

  it('Královská ze 6 karet v barvě (9-10-J-Q-K-A) má přednost před 9-K', () => {
    const r = detect('9S 10S JS QS KS AS');
    expect(r.type).toBe('royal_flush');
    expect(r.scoringIds).toEqual([1, 2, 3, 4, 5]);
  });

  it('i velký výběr (12 karet) se vyhodnotí deterministicky', () => {
    const spec = '2S 5H 9D JC 3S 5D 9H QC AS 7H 9S 2D';
    const a = detect(spec);
    const b = detect(spec);
    expect(a).toEqual(b);
    expect(a.type).toBe('full_house');
    expect(a.scoring).toEqual(['5H', '9D', '5D', '9H', '9S']);
  });

  it('MAX_HAND_CARDS je 5', () => {
    expect(MAX_HAND_CARDS).toBe(5);
  });
});

describe('výběr mezi variantami je deterministický (DESIGN 2.2.2)', () => {
  it('stejný vstup → stejný výstup', () => {
    const spec = '7S 7H 3D 3C 7D KS';
    expect(detect(spec)).toEqual(detect(spec));
  });

  it('pořadí zahrání mění jen pořadí scoringIds, ne typ ani množinu karet', () => {
    const a = detect('9S KD 2C 9H KC');
    const b = detect('KC 9H 2C KD 9S');
    expect(a.type).toBe(b.type);
    expect([...a.scoring].sort()).toEqual([...b.scoring].sort());
  });

  it('detekce nemění vstupní karty a výsledek je JSON-serializovatelný', () => {
    const cards = hand('9S KD# 2C 9H! KC*');
    const before = JSON.stringify(cards);
    const res = detectHand(cards, { mods: mods({ allCardsScore: false }), enhancements: ENH });
    expect(JSON.stringify(cards)).toBe(before);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('neznámé vylepšení se chová jako běžná karta', () => {
    const cards = hand('9S 9H');
    cards[0]!.enhancement = 'neexistuje';
    expect(detectHand(cards, { mods: mods(), enhancements: ENH })?.type).toBe('pair');
  });
});

describe('pomocné funkce detekce', () => {
  it('straightKind', () => {
    expect(straightKind([5, 6, 7, 8, 9], false, false)).toBe('normal');
    expect(straightKind([10, 11, 12, 13, 14], false, false)).toBe('aceHigh');
    expect(straightKind([14, 2, 3, 4, 5], false, false)).toBe('normal');
    expect(straightKind([12, 13, 14, 2, 3], false, false)).toBeNull();
    expect(straightKind([12, 13, 14, 2, 3], false, true)).toBe('normal');
    expect(straightKind([5, 6, 7, 8, 8], false, false)).toBeNull();
    expect(straightKind([3, 4, 6, 7, 8], true, false)).toBe('normal');
    expect(straightKind([3, 5, 6, 8, 9], true, false)).toBeNull();
    expect(straightKind([9, 11, 12, 13, 14], true, false)).toBe('aceHigh');
  });

  it('exactHandTypes: podmnožina „přesně je“ kombinací jen tehdy, když všechny karty patří do kombinace', () => {
    const o = { mods: mods(), enhancements: ENH };
    expect(exactHandTypes(hand('9S 9H'), o)).toEqual(['pair']);
    expect(exactHandTypes(hand('9S 9H KD'), o)).toEqual([]);
    expect(exactHandTypes(hand('AS KS QS JS 10S'), o)).toEqual([
      'straight',
      'flush',
      'straight_flush',
      'royal_flush',
    ]);
    expect(
      exactHandTypes(hand('7H 7H 7H 7H'), { ...o, mods: mods({ fourCardStraightFlush: true }) }),
    ).toEqual(['flush', 'four']);
    expect(exactHandTypes([], o)).toEqual([]);
    expect(exactHandTypes(hand('2S 3S 4S 5S 6S 7S'), o)).toEqual([]);
  });
});
