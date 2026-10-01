import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { buildRegistry, validateRegistry } from '../../src/content/index';
import type { ArtSpec } from '../../src/engine/content-types';
import { HAND_TYPES } from '../../src/engine/types';
import type { HandType } from '../../src/engine/types';

const reg = buildRegistry();

describe('registr obsahu', () => {
  it('je konzistentní', () => {
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('každá ikona v ArtSpec existuje v src/assets/icons (jinak ji doplň do scripts/fetch-assets.ts)', () => {
    const groups: Record<string, Record<string, { art?: ArtSpec }>> = {
      jokers: reg.jokers,
      consumables: reg.consumables,
      enhancements: reg.enhancements,
      seals: reg.seals,
      bosses: reg.bosses,
      tags: reg.tags,
      vouchers: reg.vouchers,
      boosters: reg.boosters,
      decks: reg.decks,
      stakes: reg.stakes,
      challenges: reg.challenges,
    };
    const missing: string[] = [];
    for (const [group, items] of Object.entries(groups)) {
      for (const [id, def] of Object.entries(items)) {
        if (!def.art) continue;
        for (const icon of [def.art.icon, def.art.prop]) {
          if (icon !== undefined && !isIconName(icon)) missing.push(`${group}.${id}: ${icon}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('kombinace (docs/DESIGN.md kap. 2.2.1)', () => {
  // [čipy, mult, +čipy/úr., +mult/úr.] — přepis tabulky z DESIGN.md (vlastní čísla, ne převzatá).
  const table: Record<HandType, [number, number, number, number]> = {
    high_card: [6, 1, 12, 1],
    pair: [12, 2, 14, 1],
    two_pair: [24, 2, 18, 1],
    three: [28, 3, 22, 2],
    straight: [35, 4, 25, 2],
    flush: [40, 4, 18, 2],
    full_house: [45, 5, 28, 2],
    four: [65, 6, 35, 3],
    straight_flush: [90, 9, 40, 3],
    royal_flush: [120, 10, 45, 3],
    five: [110, 11, 40, 3],
    flush_house: [130, 13, 45, 4],
    flush_five: [150, 15, 55, 3],
  };

  it.each(HAND_TYPES.map((type) => [type]))('%s odpovídá tabulce', (type) => {
    const def = reg.handTypes[type];
    const [chips, mult, chipsPerLevel, multPerLevel] = table[type];
    expect(def).toMatchObject({ type, baseChips: chips, baseMult: mult, chipsPerLevel, multPerLevel });
  });

  it('tajné jsou právě Pětice, Barevný full house a Barevná pětice', () => {
    const secret = HAND_TYPES.filter((type) => reg.handTypes[type].secret);
    expect(secret).toEqual(['five', 'flush_house', 'flush_five']);
  });
});

describe('edice (docs/DECISIONS.md, docs/DESIGN.md kap. 2.6)', () => {
  it('lesklá a holografická se u žolíka aplikují před jeho efektem, duhová po něm', () => {
    expect(reg.editions.foil?.jokerTiming).toBe('before');
    expect(reg.editions.holo?.jokerTiming).toBe('before');
    expect(reg.editions.poly?.jokerTiming).toBe('after');
  });

  it('efekty a příplatky odpovídají tabulce', () => {
    expect(reg.editions.foil?.effect?.()).toEqual({ chips: 50 });
    expect(reg.editions.holo?.effect?.()).toEqual({ mult: 10 });
    expect(reg.editions.poly?.effect?.()).toEqual({ xmult: 1.5 });
    expect(reg.editions.negative?.extraSlots).toBe(1);
    const surcharges = ['foil', 'holo', 'poly', 'negative'].map((id) => reg.editions[id]?.priceAdd);
    expect(surcharges).toEqual([1, 2, 4, 6]);
  });
});
