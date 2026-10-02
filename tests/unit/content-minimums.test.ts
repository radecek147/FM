/**
 * Definice hotovo v1.0 (CLAUDE.md kap. 3, 9 a 10): minimální počty obsahu. Hlídá, aby žádná úprava obsahu
 * nespadla pod zadání.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content';

const reg = buildRegistry();
const values = <T>(r: Record<string, T> | undefined): T[] => Object.values(r ?? {});

describe('minimální počty obsahu (v1.0)', () => {
  it('žolíci: 100+, z toho 6+ legendárních, všechny vzácnosti zastoupené', () => {
    const jokers = values(reg.jokers);
    expect(jokers.length).toBeGreaterThanOrEqual(100);
    for (const rarity of ['common', 'rare', 'epic'] as const)
      expect(jokers.filter((j) => j.rarity === rarity).length).toBeGreaterThan(0);
    expect(jokers.filter((j) => j.rarity === 'legendary').length).toBeGreaterThanOrEqual(6);
  });

  it('spotřebky: 13+ pranostik, 22+ babských rad, 16+ razítek', () => {
    const consumables = values(reg.consumables);
    const count = (kind: string): number => consumables.filter((c) => c.kind === kind).length;
    expect(count('pranostika')).toBeGreaterThanOrEqual(13);
    expect(count('rada')).toBeGreaterThanOrEqual(22);
    expect(count('razitko')).toBeGreaterThanOrEqual(16);
  });

  it('kombinace: 13, z toho 3 tajné; každá kombinace má svou pranostiku', () => {
    const hands = Object.values(reg.handTypes);
    expect(hands).toHaveLength(13);
    expect(hands.filter((h) => h.secret)).toHaveLength(3);
    expect(values(reg.consumables).filter((c) => c.kind === 'pranostika').length).toBeGreaterThanOrEqual(
      hands.length,
    );
  });

  it('úpravy karet: 8+ vylepšení, 4 pečetě, 3+ edice', () => {
    expect(values(reg.enhancements).length).toBeGreaterThanOrEqual(8);
    expect(values(reg.seals).length).toBeGreaterThanOrEqual(4);
    expect(values(reg.editions).length).toBeGreaterThanOrEqual(3);
  });

  it('šéfové: 25+ běžných a 5+ finálových', () => {
    const bosses = values(reg.bosses);
    expect(bosses.filter((b) => !b.final).length).toBeGreaterThanOrEqual(25);
    expect(bosses.filter((b) => b.final).length).toBeGreaterThanOrEqual(5);
  });

  it('štítky 20+, kupóny 24+ ve 12+ párech, obálky 5 druhů', () => {
    expect(values(reg.tags).length).toBeGreaterThanOrEqual(20);
    const vouchers = values(reg.vouchers);
    expect(vouchers.length).toBeGreaterThanOrEqual(24);
    const pairs = vouchers.filter((v) => v.tier === 2 && v.requires && reg.vouchers[v.requires]?.tier === 1);
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    expect(new Set(values(reg.boosters).map((b) => b.kind)).size).toBeGreaterThanOrEqual(5);
  });

  it('balíčky 12+, síly piva 8, výzvy 20+, achievementy 60+', () => {
    expect(values(reg.decks).length).toBeGreaterThanOrEqual(12);
    expect(values(reg.stakes)).toHaveLength(8);
    expect(values(reg.challenges).length).toBeGreaterThanOrEqual(20);
    expect(values(reg.achievements).length).toBeGreaterThanOrEqual(60);
  });
});
