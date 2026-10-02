/**
 * Odemykání (src/engine/meta/unlocks.ts): každý typ `UnlockCondition`, vlastní podmínky obsahu, stav položek,
 * pool pro nový run, výzvy podle počtu výher, sbírka.
 */
import { describe, expect, it } from 'vitest';
import { registry, validateRegistry } from '../../src/content';
import {
  CHALLENGE_UNLOCK_WINS,
  collectionState,
  createProfile,
  evaluateUnlock,
  isChallengeUnlocked,
  isDeckUnlocked,
  isJokerUnlocked,
  isStakeUnlocked,
  isUnseen,
  isVoucherUnlocked,
  knownCustomUnlocks,
  markSeen,
  maxStakeFor,
  refreshUnlocks,
  registerCustomUnlock,
  statValue,
  unlockConditionFor,
  unlockedPoolFor,
  unseenCount,
} from '../../src/engine';
import type { ChallengeDef, ContentRegistry, Profile, UnlockCondition } from '../../src/engine';
import { ART, joker, makeRegistry } from './engine-fixtures';

const NOW = '2026-10-02T10:00:00.000Z';
const fresh = (): Profile => createProfile(NOW);

type Case<K extends UnlockCondition['type']> = {
  cond: Extract<UnlockCondition, { type: K }>;
  satisfy(p: Profile): void;
};

/** Jeden případ na každý typ podmínky — chybějící typ je chyba kompilace. */
const CASES: { [K in UnlockCondition['type']]: Case<K> } = {
  winRun: {
    cond: { type: 'winRun', deck: 'pub', stake: 2 },
    satisfy: (p) => void (p.stats.byDeck.pub = { played: 3, won: 1, bestStake: 2 }),
  },
  reachAnte: { cond: { type: 'reachAnte', ante: 5 }, satisfy: (p) => void (p.stats.records.highestAnte = 5) },
  playHand: {
    cond: { type: 'playHand', hand: 'straight', count: 25 },
    satisfy: (p) => void (p.stats.handTypes.straight = 25),
  },
  scoreInHand: {
    cond: { type: 'scoreInHand', atLeast: 1000 },
    satisfy: (p) => void (p.stats.bestHand = { score: 1000, handType: 'pair', seed: 'X', deckId: 'pub' }),
  },
  haveMoney: {
    cond: { type: 'haveMoney', atLeast: 50 },
    satisfy: (p) => void (p.stats.records.maxMoney = 51),
  },
  winsTotal: { cond: { type: 'winsTotal', count: 3 }, satisfy: (p) => void (p.stats.runs.won = 3) },
  runsTotal: {
    cond: { type: 'runsTotal', count: 5 },
    satisfy: (p) => {
      p.stats.runs.played = 3;
      p.stats.challenges.dry_february = { attempts: 2, completed: 0, bestAnte: 2 };
    },
  },
  discover: {
    cond: { type: 'discover', category: 'bosses', count: 2 },
    satisfy: (p) => void (p.discovered.bosses = ['tax_audit', 'inventory']),
  },
  stat: {
    cond: { type: 'stat', stat: 'glassBroken', atLeast: 10 },
    satisfy: (p) => void (p.stats.totals.glassBroken = 10),
  },
  roundEndMoney: {
    cond: { type: 'roundEndMoney', atMost: -1 },
    satisfy: (p) => void (p.stats.records.minRoundEndMoney = -3),
  },
  handLevel: {
    cond: { type: 'handLevel', level: 6, hand: 'flush' },
    satisfy: (p) => void (p.stats.records.handLevels.flush = 6),
  },
  beatBoss: {
    cond: { type: 'beatBoss', boss: 'tax_audit', count: 2 },
    satisfy: (p) => void (p.stats.bosses.tax_audit = { defeated: 2, lostTo: 1 }),
  },
  useConsumable: {
    cond: { type: 'useConsumable', kind: 'rada', count: 3 },
    satisfy: (p) => void (p.stats.totals.radyUsed = 3),
  },
  winChallenge: {
    cond: { type: 'winChallenge', count: 2 },
    satisfy: (p) => {
      p.stats.challenges.a = { attempts: 3, completed: 1, bestAnte: 8 };
      p.stats.challenges.b = { attempts: 1, completed: 2, bestAnte: 8 };
    },
  },
  achievement: {
    cond: { type: 'achievement', id: 'first_round' },
    satisfy: (p) => void (p.achievements.unlocked.first_round = NOW),
  },
  custom: {
    cond: { type: 'custom', id: 'jokersSold25' },
    satisfy: (p) => void (p.stats.totals.jokersSold = 25),
  },
};

describe('evaluateUnlock — každý typ podmínky', () => {
  for (const [type, c] of Object.entries(CASES) as [string, Case<UnlockCondition['type']>][]) {
    it(`${type}: nesplněno na čistém profilu, splněno po dosažení`, () => {
      const p = fresh();
      const before = evaluateUnlock(c.cond, p);
      expect(before.met).toBe(false);
      expect(before.progress).toBeLessThan(before.target);
      c.satisfy(p);
      const after = evaluateUnlock(c.cond, p);
      expect(after.met).toBe(true);
      expect(after.progress).toBe(after.target);
    });
  }

  it('průběh pro sbírku (část cíle)', () => {
    const p = fresh();
    p.stats.handTypes.straight = 10;
    expect(evaluateUnlock({ type: 'playHand', hand: 'straight', count: 25 }, p)).toEqual({
      met: false,
      progress: 10,
      target: 25,
    });
    p.stats.handTypes.four = 1;
    expect(evaluateUnlock({ type: 'playHand', hand: 'four' }, p).met).toBe(true);
  });

  it('winRun: s balíčkem bez síly, se silou bez balíčku, úplně bez parametrů', () => {
    const p = fresh();
    expect(evaluateUnlock({ type: 'winRun', deck: 'marias' }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'winRun' }, p).met).toBe(false);
    p.stats.byDeck.marias = { played: 1, won: 1, bestStake: 1 };
    p.stats.runs.won = 1;
    expect(evaluateUnlock({ type: 'winRun', deck: 'marias' }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'winRun', deck: 'pub' }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'winRun' }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'winRun', stake: 2 }, p).met).toBe(false);
    p.stats.byDeck.pub = { played: 1, won: 1, bestStake: 4 };
    expect(evaluateUnlock({ type: 'winRun', stake: 2 }, p).met).toBe(true);
  });

  it('stat: počítadla i rekordy', () => {
    const p = fresh();
    expect(statValue(p, 'maxHandLevel')).toBe(1);
    p.stats.records.handLevels = { pair: 4, flush: 7 };
    p.stats.bestHand = { score: 12345, handType: 'flush', seed: 'X', deckId: 'pub' };
    p.stats.records.maxJokers = 6;
    p.stats.totals.rerolls = 9;
    expect(statValue(p, 'maxHandLevel')).toBe(7);
    expect(statValue(p, 'bestHandScore')).toBe(12345);
    expect(evaluateUnlock({ type: 'stat', stat: 'maxJokers', atLeast: 5 }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'stat', stat: 'rerolls', atLeast: 10 }, p)).toEqual({
      met: false,
      progress: 9,
      target: 10,
    });
    expect(evaluateUnlock({ type: 'handLevel', level: 6 }, p).met).toBe(true);
  });

  it('useConsumable, beatBoss a winChallenge v dalších tvarech', () => {
    const p = fresh();
    p.stats.consumableUses.medard = 2;
    p.stats.totals.consumablesUsed = 4;
    p.stats.totals.razitkaUsed = 1;
    p.stats.totals.bossesDefeated = 3;
    p.stats.challenges.quarry = { attempts: 2, completed: 1, bestAnte: 8 };
    expect(evaluateUnlock({ type: 'useConsumable', id: 'medard', count: 2 }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'useConsumable', count: 5 }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'useConsumable', kind: 'razitko' }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'useConsumable', kind: 'pranostika' }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'beatBoss', count: 3 }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'beatBoss', boss: 'inventory' }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'winChallenge', challenge: 'quarry' }, p).met).toBe(true);
    expect(evaluateUnlock({ type: 'winChallenge', challenge: 'express' }, p).met).toBe(false);
  });
});

describe('vlastní podmínky (custom)', () => {
  const satisfy: Record<string, (p: Profile) => void> = {
    vouchersBought5: (p) => void (p.stats.totals.vouchersBought = 5),
    sealedCardsInRun: (p) => void (p.stats.records.maxSealedCards = 5),
    roundEndInDebt: (p) => void (p.stats.records.minRoundEndMoney = -1),
    radyUsed30: (p) => void (p.stats.totals.radyUsed = 30),
    jokersSold25: (p) => void (p.stats.totals.jokersSold = 25),
    handLevel6: (p) => void (p.stats.records.handLevels.pair = 6),
    voucherTier1TwoRuns: (p) => void (p.stats.runs.won = 3),
  };

  it('každá vestavěná podmínka obsahu má vyhodnocovač', () => {
    for (const id of Object.keys(satisfy)) expect(knownCustomUnlocks()).toContain(id);
  });

  for (const [id, fn] of Object.entries(satisfy)) {
    it(`${id}`, () => {
      const p = fresh();
      expect(evaluateUnlock({ type: 'custom', id }, p).met).toBe(false);
      fn(p);
      expect(evaluateUnlock({ type: 'custom', id }, p).met).toBe(true);
    });
  }

  it('roundEndInDebt: 0 Kč na konci kola nestačí', () => {
    const p = fresh();
    p.stats.records.minRoundEndMoney = 0;
    expect(evaluateUnlock({ type: 'custom', id: 'roundEndInDebt' }, p).met).toBe(false);
    expect(evaluateUnlock({ type: 'roundEndMoney', atMost: 0 }, p).met).toBe(true);
  });

  it('voucherTier1TwoRuns: tier 1 koupený ve 2 různých runech (podle `requires` kupónu)', () => {
    const reg = registry();
    const tier2 = Object.values(reg.vouchers).find((v) => v.tier === 2 && v.requires)!;
    const subject = { category: 'vouchers' as const, id: tier2.id };
    const cond = unlockConditionFor(reg, 'vouchers', tier2.id)!;
    expect(cond).toEqual({ type: 'custom', id: 'voucherTier1TwoRuns' });
    const p = fresh();
    p.stats.voucherRuns[tier2.requires!] = 1;
    expect(evaluateUnlock(cond, p, undefined, { registry: reg, subject })).toEqual({
      met: false,
      progress: 1,
      target: 2,
    });
    p.stats.voucherRuns[tier2.requires!] = 2;
    expect(evaluateUnlock(cond, p, undefined, { registry: reg, subject }).met).toBe(true);
    // jiný tier 2 (jiný tier 1) zatím ne
    const other = Object.values(reg.vouchers).find((v) => v.tier === 2 && v.requires !== tier2.requires)!;
    expect(
      evaluateUnlock(cond, p, undefined, { registry: reg, subject: { category: 'vouchers', id: other.id } })
        .met,
    ).toBe(false);
  });

  it('neznámá nebo padající podmínka = nesplněno; registerCustomUnlock přidá vlastní', () => {
    const p = fresh();
    expect(evaluateUnlock({ type: 'custom', id: 'meta_test_nope' }, p).met).toBe(false);
    registerCustomUnlock('meta_test_throws', () => {
      throw new Error('boom');
    });
    expect(evaluateUnlock({ type: 'custom', id: 'meta_test_throws' }, p).met).toBe(false);
    registerCustomUnlock('meta_test_runs', (prof, ctx) => prof.stats.runs.played >= 1 && !!ctx.run);
    p.stats.runs.played = 1;
    expect(evaluateUnlock({ type: 'custom', id: 'meta_test_runs' }, p).met).toBe(false);
    expect(knownCustomUnlocks()).toContain('meta_test_runs');
  });
});

describe('stav odemčení a pool (skutečný obsah)', () => {
  const reg = registry();

  it('na začátku: Hospodský a Štamgastův, Desítka pro každý balíček, všech 12 tier 1 kupónů, žádná výzva', () => {
    const p = fresh();
    const decks = Object.keys(reg.decks).filter((id) => isDeckUnlocked(p, reg, id));
    expect(decks).toEqual(['pub', 'regulars']);
    for (const id of Object.keys(reg.decks)) {
      expect(maxStakeFor(p, reg, id)).toBe(1);
      expect(isStakeUnlocked(p, reg, id, 1)).toBe(true);
      expect(isStakeUnlocked(p, reg, id, 2)).toBe(false);
    }
    const vouchers = Object.values(reg.vouchers).filter((v) => isVoucherUnlocked(p, reg, v.id));
    expect(vouchers).toHaveLength(12);
    expect(vouchers.every((v) => v.tier === 1)).toBe(true);
    expect(Object.keys(reg.challenges).filter((id) => isChallengeUnlocked(p, reg, id))).toEqual([]);
  });

  it('pool hlavní hry: odemčení žolíci (legendární vždy) a kupóny; denní a seedovaný run vše', () => {
    const p = fresh();
    const pool = unlockedPoolFor(p, reg, 'normal');
    const legendary = Object.values(reg.jokers).filter((j) => j.rarity === 'legendary');
    expect(legendary.length).toBeGreaterThanOrEqual(6);
    for (const j of legendary) {
      expect(pool.jokers).toContain(j.id);
      expect(isJokerUnlocked(p, reg, j.id)).toBe(false);
    }
    for (const j of Object.values(reg.jokers)) {
      expect(pool.jokers!.includes(j.id)).toBe(j.rarity === 'legendary' || !j.unlock);
    }
    expect(pool.vouchers).toHaveLength(12);
    expect(pool.boosters).toBeNull();
    expect(unlockedPoolFor(p, reg, 'challenge').vouchers).toEqual(pool.vouchers);
    for (const mode of ['daily', 'seeded'] as const) {
      expect(unlockedPoolFor(p, reg, mode)).toEqual({ jokers: null, vouchers: null, boosters: null });
    }
  });

  it('legendární žolík se odemkne objevením (sbírka: silueta → plná karta)', () => {
    const p = fresh();
    const id = Object.values(reg.jokers).find((j) => j.rarity === 'legendary')!.id;
    expect(collectionState(p, reg, 'jokers', id)).toBe('locked');
    p.discovered.jokers.push(id);
    expect(isJokerUnlocked(p, reg, id)).toBe(true);
    expect(collectionState(p, reg, 'jokers', id)).toBe('discovered');
  });

  it('refreshUnlocks: balíček podle podmínky, oznámení jen jednou, štítek „Nové“', () => {
    const p = fresh();
    expect(refreshUnlocks(p, reg)).toEqual([]);
    p.stats.totals.vouchersBought = 5;
    p.stats.handTypes.four = 1;
    const notices = refreshUnlocks(p, reg);
    expect(notices).toEqual([
      { kind: 'unlock', category: 'decks', id: 'clerk' },
      { kind: 'unlock', category: 'decks', id: 'marias' },
    ]);
    expect(isDeckUnlocked(p, reg, 'clerk')).toBe(true);
    expect(isUnseen(p, 'decks', 'clerk')).toBe(true);
    expect(refreshUnlocks(p, reg)).toEqual([]);
    expect(unseenCount(p, 'decks')).toBe(2);
    markSeen(p, 'decks', ['clerk']);
    expect(isUnseen(p, 'decks', 'clerk')).toBe(false);
    expect(unseenCount(p)).toBe(1);
  });

  it('výzvy se odemykají počtem výher (0 → 20)', () => {
    const p = fresh();
    const ids = Object.keys(reg.challenges);
    expect(ids).toHaveLength(20);
    let last = 0;
    for (const wins of [1, 3, 6, 10]) {
      p.stats.runs.won = wins;
      refreshUnlocks(p, reg);
      const n = ids.filter((id) => isChallengeUnlocked(p, reg, id)).length;
      expect(n).toBeGreaterThan(last);
      last = n;
    }
    expect(last).toBe(20);
  });

  it('obsah nemá neznámé vlastní podmínky; neznámou validace najde', () => {
    expect(validateRegistry(reg).filter((x) => x.includes('custom unlock'))).toEqual([]);
    const bad: ContentRegistry = {
      ...reg,
      jokers: { ...reg.jokers, x: joker('x', { unlock: { type: 'custom', id: 'nope' } }) },
    };
    expect(validateRegistry(bad)).toContain('joker x: unknown custom unlock nope');
  });
});

describe('odemykání s testovacím obsahem', () => {
  const challenge = (id: string, unlock?: UnlockCondition): ChallengeDef => ({
    id,
    deckId: 'test',
    art: ART,
    unlock,
  });

  it('výzvy bez vlastní podmínky: 1–5 po 1 výhře, 6–10 po 3, 11–15 po 6, 16–20 po 10', () => {
    const challenges = Array.from({ length: 20 }, (_, i) => challenge(`c${i + 1}`));
    challenges.push(challenge('special', { type: 'beatBoss', count: 1 }));
    const reg = makeRegistry({ challenges });
    const p = fresh();
    const unlocked = () => Object.keys(reg.challenges).filter((id) => isChallengeUnlocked(p, reg, id));
    expect(unlockConditionFor(reg, 'challenges', 'c7')).toEqual({
      type: 'winsTotal',
      count: CHALLENGE_UNLOCK_WINS[1],
    });
    expect(unlocked()).toEqual([]);
    const expected = [5, 10, 15, 20];
    CHALLENGE_UNLOCK_WINS.forEach((wins, i) => {
      p.stats.runs.won = wins;
      const notices = refreshUnlocks(p, reg);
      expect(notices.every((n) => n.kind === 'unlock' && n.category === 'challenges')).toBe(true);
      expect(unlocked()).toHaveLength(expected[i]!);
    });
    expect(unlocked()).not.toContain('special');
    p.stats.totals.bossesDefeated = 1;
    refreshUnlocks(p, reg);
    expect(unlocked()).toContain('special');
  });

  it('žolík s podmínkou: mimo pool, dokud se neodemkne; pak oznámení a „Nové“', () => {
    const reg = makeRegistry({
      jokers: [
        joker('free'),
        joker('locked', { unlock: { type: 'stat', stat: 'jokersSold', atLeast: 2 } }),
        joker('legend', { rarity: 'legendary' }),
      ],
    });
    const p = fresh();
    expect(unlockedPoolFor(p, reg, 'normal').jokers).toEqual(['free', 'legend']);
    expect(collectionState(p, reg, 'jokers', 'locked')).toBe('locked');
    expect(collectionState(p, reg, 'jokers', 'free')).toBe('unknown');
    p.stats.totals.jokersSold = 2;
    expect(refreshUnlocks(p, reg)).toEqual([{ kind: 'unlock', category: 'jokers', id: 'locked' }]);
    expect(unlockedPoolFor(p, reg, 'normal').jokers).toEqual(['free', 'locked', 'legend']);
    expect(isUnseen(p, 'jokers', 'locked')).toBe(true);
  });

  it('sbírka: kombinace, síla piva, achievementy a objevy', () => {
    const reg = registry();
    const p = fresh();
    expect(collectionState(p, reg, 'hands', 'pair')).toBe('discovered');
    expect(collectionState(p, reg, 'hands', 'flush_five')).toBe('unknown');
    p.discovered.hands.push('flush_five');
    expect(collectionState(p, reg, 'hands', 'flush_five')).toBe('discovered');
    expect(collectionState(p, reg, 'stakes', 'desitka')).toBe('discovered');
    expect(collectionState(p, reg, 'stakes', 'jedenactka')).toBe('locked');
    p.unlocks.stakes.court = 2;
    expect(collectionState(p, reg, 'stakes', 'jedenactka')).toBe('discovered');
    expect(collectionState(p, reg, 'bosses', 'tax_audit')).toBe('unknown');
    p.discovered.bosses.push('tax_audit');
    expect(collectionState(p, reg, 'bosses', 'tax_audit')).toBe('discovered');
    expect(collectionState(p, reg, 'bosses', 'nope')).toBe('locked');
    expect(collectionState(p, reg, 'decks', 'pub')).toBe('discovered');
    expect(collectionState(p, reg, 'decks', 'court')).toBe('locked');
    expect(collectionState(p, reg, 'achievements', 'x')).toBe('locked');
    p.achievements.unlocked.x = NOW;
    expect(collectionState(p, reg, 'achievements', 'x')).toBe('discovered');
  });
});
