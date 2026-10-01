/** Hrací karty — docs/DESIGN.md kap. 2.1 (čipy, barvy, figury, divoká/kamenná karta). */
import { describe, expect, it } from 'vitest';
import { ENHANCEMENTS } from '../../src/content/modifiers';
import type { EnhancementLookup } from '../../src/engine/cards/cards';
import {
  cardChips,
  cardHasSuit,
  compareCards,
  createCard,
  hasNoRankSuit,
  isFaceCard,
  isWild,
  rankChips,
  standardDeckSpecs,
  suitGroup,
} from '../../src/engine/cards/cards';
import type { Card, Rank, Suit } from '../../src/engine/types';
import { RANKS, SUITS } from '../../src/engine/types';

const ENH: EnhancementLookup = Object.fromEntries(ENHANCEMENTS.map((e) => [e.id, e]));
const NO_MERGE = { mergedSuits: false };
const MERGED = { mergedSuits: true };

let nextId = 1;
function card(rank: Rank, suit: Suit, extra: Partial<Card> = {}): Card {
  return { ...createCard(nextId++, { rank, suit }), ...extra };
}

describe('createCard', () => {
  it('vyplní výchozí hodnoty', () => {
    expect(createCard(7, { suit: 'H', rank: 12 })).toEqual({
      id: 7,
      suit: 'H',
      rank: 12,
      enhancement: null,
      seal: null,
      edition: null,
      bonusChips: 0,
      debuffed: false,
      faceDown: false,
    });
  });

  it('převezme vylepšení, pečeť, edici a bonusové čipy ze specifikace', () => {
    const c = createCard(3, {
      suit: 'S',
      rank: 14,
      enhancement: 'glass',
      seal: 'red',
      edition: 'foil',
      bonusChips: 6,
    });
    expect(c).toMatchObject({ enhancement: 'glass', seal: 'red', edition: 'foil', bonusChips: 6 });
  });
});

describe('standardDeckSpecs', () => {
  it('má 52 různých karet: 4 barvy × 13 hodnot', () => {
    const specs = standardDeckSpecs();
    expect(specs).toHaveLength(52);
    expect(new Set(specs.map((s) => `${s.rank}${s.suit}`)).size).toBe(52);
    for (const suit of SUITS) expect(specs.filter((s) => s.suit === suit)).toHaveLength(13);
    for (const rank of RANKS) expect(specs.filter((s) => s.rank === rank)).toHaveLength(4);
  });

  it('vrací pokaždé nové pole (balíček se smí měnit)', () => {
    const a = standardDeckSpecs();
    a.pop();
    expect(standardDeckSpecs()).toHaveLength(52);
  });
});

describe('rankChips', () => {
  it.each([
    [2, 2],
    [5, 5],
    [9, 9],
    [10, 10],
    [11, 10],
    [12, 10],
    [13, 10],
    [14, 11],
  ] as [Rank, number][])('hodnota %d dává %d čipů', (rank, chips) => {
    expect(rankChips(rank)).toBe(chips);
  });
});

describe('cardChips', () => {
  it('běžná karta = čipy hodnoty', () => {
    expect(cardChips(card(7, 'H'), ENH)).toBe(7);
    expect(cardChips(card(13, 'S'), ENH)).toBe(10);
    expect(cardChips(card(14, 'D'), ENH)).toBe(11);
  });

  it('přičítá trvalé bonusChips', () => {
    expect(cardChips(card(14, 'D', { bonusChips: 9 }), ENH)).toBe(20);
  });

  it('kamenná karta má 0 vlastních čipů (dává je její vylepšení), bonusChips ale platí', () => {
    expect(cardChips(card(14, 'D', { enhancement: 'stone' }), ENH)).toBe(0);
    expect(cardChips(card(14, 'D', { enhancement: 'stone', bonusChips: 3 }), ENH)).toBe(3);
  });

  it('jiná vylepšení vlastní čipy nemění', () => {
    expect(cardChips(card(8, 'C', { enhancement: 'bonus' }), ENH)).toBe(8);
    expect(cardChips(card(8, 'C', { enhancement: 'wild' }), ENH)).toBe(8);
  });

  it('bez platných vylepšení (Bílá hora) má kamenná karta zase čipy své hodnoty', () => {
    expect(cardChips(card(14, 'D', { enhancement: 'stone' }), {})).toBe(11);
  });

  it('fixedCardChips (Normalizace) dá každé kartě pevné čipy, i kamenné a s bonusem', () => {
    const mods = { fixedCardChips: 5 };
    expect(cardChips(card(14, 'D'), ENH, mods)).toBe(5);
    expect(cardChips(card(2, 'D', { bonusChips: 12 }), ENH, mods)).toBe(5);
    expect(cardChips(card(9, 'S', { enhancement: 'stone' }), ENH, mods)).toBe(5);
  });

  it('fixedCardChips 0 = vypnuto', () => {
    expect(cardChips(card(9, 'S', { bonusChips: 1 }), ENH, { fixedCardChips: 0 })).toBe(10);
  });
});

describe('cardHasSuit a suitGroup', () => {
  it('běžná karta má jen svou barvu', () => {
    const c = card(5, 'H');
    expect(SUITS.filter((s) => cardHasSuit(c, s, NO_MERGE, ENH))).toEqual(['H']);
  });

  it('divoká karta patří do všech barev', () => {
    const c = card(5, 'H', { enhancement: 'wild' });
    expect(SUITS.every((s) => cardHasSuit(c, s, NO_MERGE, ENH))).toBe(true);
    expect(isWild(c, ENH)).toBe(true);
  });

  it('kamenná karta nepatří do žádné barvy', () => {
    const c = card(5, 'H', { enhancement: 'stone' });
    expect(SUITS.some((s) => cardHasSuit(c, s, NO_MERGE, ENH))).toBe(false);
    expect(hasNoRankSuit(c, ENH)).toBe(true);
  });

  it('mergedSuits: ♥ = ♦ a ♠ = ♣', () => {
    expect(suitGroup('D', MERGED)).toBe('H');
    expect(suitGroup('C', MERGED)).toBe('S');
    expect(suitGroup('D', NO_MERGE)).toBe('D');
    const diamond = card(9, 'D');
    expect(cardHasSuit(diamond, 'H', MERGED, ENH)).toBe(true);
    expect(cardHasSuit(diamond, 'D', MERGED, ENH)).toBe(true);
    expect(cardHasSuit(diamond, 'S', MERGED, ENH)).toBe(false);
    expect(cardHasSuit(card(9, 'S'), 'C', MERGED, ENH)).toBe(true);
    expect(cardHasSuit(diamond, 'H', NO_MERGE, ENH)).toBe(false);
  });

  it('neznámé vylepšení se chová jako žádné', () => {
    const c = card(5, 'C', { enhancement: 'neexistuje' });
    expect(cardHasSuit(c, 'C', NO_MERGE, ENH)).toBe(true);
    expect(cardHasSuit(c, 'H', NO_MERGE, ENH)).toBe(false);
  });
});

describe('isFaceCard', () => {
  it('figury jsou J, Q, K — eso ani desítka ne', () => {
    const faces = RANKS.filter((r) => isFaceCard(card(r, 'S'), { allFaces: false }, ENH));
    expect(faces).toEqual([11, 12, 13]);
  });

  it('allFaces udělá figurou každou kartu s hodnotou', () => {
    expect(RANKS.every((r) => isFaceCard(card(r, 'S'), { allFaces: true }, ENH))).toBe(true);
  });

  it('kamenná karta není figura ani s allFaces', () => {
    const stone = card(12, 'S', { enhancement: 'stone' });
    expect(isFaceCard(stone, { allFaces: false }, ENH)).toBe(false);
    expect(isFaceCard(stone, { allFaces: true }, ENH)).toBe(false);
  });
});

describe('compareCards', () => {
  const sortBy = (cards: Card[], by: 'rank' | 'suit') =>
    [...cards].sort((a, b) => compareCards(a, b, by, ENH)).map((c) => `${c.rank}${c.suit}`);

  it('podle hodnoty: sestupně, při shodě barva ♠ ♥ ♣ ♦, kamenné na konec', () => {
    const cards = [
      card(5, 'D'),
      card(14, 'C'),
      card(5, 'S'),
      card(9, 'H', { enhancement: 'stone' }),
      card(13, 'H'),
    ];
    expect(sortBy(cards, 'rank')).toEqual(['14C', '13H', '5S', '5D', '9H']);
  });

  it('podle barvy: ♠ ♥ ♣ ♦, uvnitř barvy sestupně, kamenné na konec', () => {
    const cards = [
      card(5, 'D'),
      card(2, 'S', { enhancement: 'stone' }),
      card(14, 'D'),
      card(3, 'H'),
      card(10, 'S'),
    ];
    expect(sortBy(cards, 'suit')).toEqual(['10S', '3H', '14D', '5D', '2S']);
  });

  it('stejné karty řadí stabilně podle id', () => {
    const a = card(7, 'H');
    const b = card(7, 'H');
    expect(compareCards(a, b, 'rank', ENH)).toBeLessThan(0);
    expect(compareCards(b, a, 'suit', ENH)).toBeGreaterThan(0);
  });
});
