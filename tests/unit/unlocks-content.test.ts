/**
 * Podmínky odemčení skutečného obsahu (DESIGN 9, 11.3): počty odemčených položek na startu, každá podmínka je
 * platná a jde splnit (ze stavu profilu i skutečnými událostmi runu), vlastní vyhodnocovače, texty podmínek pro
 * sbírku (`unlockText` → `meta.unlock.*`).
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import {
  CUSTOM_UNLOCK_PARAMS,
  Game,
  TOTAL_STAT_KEYS,
  applyRunEvent,
  createProfile,
  distinctHandsPlayed,
  evaluateUnlock,
  isDeckUnlocked,
  isJokerUnlocked,
  isVoucherUnlocked,
  knownCustomUnlocks,
  refreshUnlocks,
  startRun,
  unlockConditionFor,
  unlockText,
  unlockTextFor,
  unlockedPoolFor,
} from '../../src/engine';
import type {
  ConsumableKind,
  GameEvent,
  MetaCtx,
  Profile,
  RunState,
  UnlockCategory,
  UnlockCondition,
  UnlockDiscoverCategory,
  UnlockStat,
  UnlockTextSpec,
} from '../../src/engine';
import { HAND_TYPES } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';

const NOW = '2026-10-02T10:00:00.000Z';
const reg = registry();
const ctx: MetaCtx = { registry: reg, nowIso: NOW };
const fresh = (): Profile => createProfile(NOW);

const RECORD_STATS = [
  'maxMoney',
  'maxJokers',
  'maxSealedCards',
  'maxVouchers',
  'maxHandLevel',
  'highestAnte',
  'bestHandScore',
  'bestRoundScore',
] as const satisfies readonly UnlockStat[];
const ALL_STATS: readonly UnlockStat[] = [...TOTAL_STAT_KEYS, ...RECORD_STATS];
const DISCOVER_CATEGORIES = [
  'jokers',
  'consumables',
  'vouchers',
  'tags',
  'bosses',
  'boosters',
] as const satisfies readonly UnlockDiscoverCategory[];
const CONSUMABLE_KINDS = ['pranostika', 'rada', 'razitko'] as const satisfies readonly ConsumableKind[];

/** Položky obsahu s vlastní podmínkou (výzvy mají výchozí podle pořadí). */
function conditioned(category: UnlockCategory): { id: string; cond: UnlockCondition }[] {
  const ids =
    category === 'decks'
      ? Object.keys(reg.decks)
      : category === 'jokers'
        ? Object.keys(reg.jokers)
        : category === 'vouchers'
          ? Object.keys(reg.vouchers)
          : Object.keys(reg.challenges);
  const out: { id: string; cond: UnlockCondition }[] = [];
  for (const id of ids) {
    const cond = unlockConditionFor(reg, category, id);
    if (cond) out.push({ id, cond });
  }
  return out;
}

/** Splní podmínku čistě zápisem do profilu (stejná pole, která meta plní z událostí runu). */
const CUSTOM_SATISFY: Record<string, (p: Profile) => void> = {
  vouchersBought5: (p) => void (p.stats.totals.vouchersBought = 5),
  sealedCardsInRun: (p) => void (p.stats.records.maxSealedCards = 5),
  roundEndInDebt: (p) => void (p.stats.records.minRoundEndMoney = -1),
  radyUsed30: (p) => void (p.stats.totals.radyUsed = 30),
  jokersSold25: (p) => void (p.stats.totals.jokersSold = 25),
  handLevel6: (p) => void (p.stats.records.handLevels.flush = 6),
  voucherTier1TwoRuns: (p) => void (p.stats.runs.won = 3),
  distinctHands8: (p) => {
    for (const h of HAND_TYPES.slice(0, 8)) p.stats.handTypes[h] = 1;
  },
};

function satisfy(p: Profile, cond: UnlockCondition): void {
  const s = p.stats;
  switch (cond.type) {
    case 'winRun': {
      const deck = cond.deck ?? 'pub';
      s.byDeck[deck] = { played: 1, won: 1, bestStake: cond.stake ?? 1 };
      s.runs.won = Math.max(1, s.runs.won);
      return;
    }
    case 'reachAnte':
      s.records.highestAnte = cond.ante;
      return;
    case 'playHand':
      s.handTypes[cond.hand] = cond.count ?? 1;
      return;
    case 'scoreInHand':
      s.bestHand = { score: cond.atLeast, handType: 'pair', seed: 'X', deckId: 'pub' };
      return;
    case 'haveMoney':
      s.records.maxMoney = cond.atLeast;
      return;
    case 'winsTotal':
      s.runs.won = cond.count;
      return;
    case 'runsTotal':
      s.runs.played = cond.count;
      return;
    case 'discover':
      p.discovered[cond.category] = Array.from({ length: cond.count }, (_, i) => `x${i}`);
      return;
    case 'stat': {
      const stat = cond.stat;
      if ((TOTAL_STAT_KEYS as readonly string[]).includes(stat)) {
        s.totals[stat as (typeof TOTAL_STAT_KEYS)[number]] = cond.atLeast;
      } else if (stat === 'maxHandLevel') s.records.handLevels.pair = cond.atLeast;
      else if (stat === 'bestHandScore')
        s.bestHand = { score: cond.atLeast, handType: 'pair', seed: 'X', deckId: 'pub' };
      else (s.records as unknown as Record<string, number>)[stat] = cond.atLeast;
      return;
    }
    case 'roundEndMoney':
      s.records.minRoundEndMoney = cond.atMost;
      return;
    case 'handLevel':
      s.records.handLevels[cond.hand ?? 'pair'] = cond.level;
      return;
    case 'beatBoss':
      if (cond.boss) s.bosses[cond.boss] = { defeated: cond.count ?? 1, lostTo: 0 };
      else s.totals.bossesDefeated = cond.count ?? 1;
      return;
    case 'useConsumable': {
      const n = cond.count ?? 1;
      if (cond.id) s.consumableUses[cond.id] = n;
      else if (cond.kind === 'pranostika') s.totals.pranostikyUsed = n;
      else if (cond.kind === 'rada') s.totals.radyUsed = n;
      else if (cond.kind === 'razitko') s.totals.razitkaUsed = n;
      else s.totals.consumablesUsed = n;
      return;
    }
    case 'winChallenge':
      if (cond.challenge) s.challenges[cond.challenge] = { attempts: 1, completed: 1, bestAnte: 8 };
      else
        for (let i = 0; i < (cond.count ?? 1); i++)
          s.challenges[`c${i}`] = { attempts: 1, completed: 1, bestAnte: 8 };
      return;
    case 'achievement':
      p.achievements.unlocked[cond.id] = NOW;
      return;
    case 'custom':
      CUSTOM_SATISFY[cond.id]!(p);
      return;
  }
}

/** Složí text podmínky stejně jako UI (src/ui/metaText.ts `unlockSpecText`). */
function render(spec: UnlockTextSpec): { key: string; text: string } {
  const params: Record<string, number | string> = { ...spec.params };
  for (const [name, key] of Object.entries(spec.refs)) {
    expect(hasKey(key), `ref ${name} → ${key}`).toBe(true);
    params[name] = t(key);
  }
  const key = spec.itemKey && hasKey(spec.itemKey) ? spec.itemKey : spec.key;
  return { key, text: t(key, params) };
}

function expectGoodText(spec: UnlockTextSpec, label: string): string {
  const { key, text } = render(spec);
  expect(hasKey(key), `${label}: ${key}`).toBe(true);
  expect(text, label).not.toMatch(/[{}⟦⟧]/);
  expect(text.length, label).toBeGreaterThan(5);
  return text;
}

// ─────────────────────────── Počty na startu ───────────────────────────

describe('odemčeno na startu (DESIGN 11.3)', () => {
  const jokers = Object.values(reg.jokers);

  it('žolíci: ≈ 70 od začátku (všichni běžní, ~60 % vzácných, ~40 % epických), 23 s podmínkou, legendární objevem', () => {
    const p = fresh();
    const byRarity = (r: string) => jokers.filter((j) => j.rarity === r);
    const open = jokers.filter((j) => isJokerUnlocked(p, reg, j.id));
    expect(jokers).toHaveLength(101);
    expect(open).toHaveLength(70);
    expect(jokers.filter((j) => j.unlock)).toHaveLength(23);
    expect(byRarity('common').every((j) => !j.unlock)).toBe(true);
    expect(byRarity('rare').filter((j) => !j.unlock)).toHaveLength(19); // 19/32 ≈ 59 %
    expect(byRarity('epic').filter((j) => !j.unlock)).toHaveLength(7); // 7/17 ≈ 41 %
    for (const j of byRarity('legendary')) {
      expect(j.unlock, j.id).toBeUndefined();
      expect(isJokerUnlocked(p, reg, j.id)).toBe(false);
      expect(unlockedPoolFor(p, reg, 'normal').jokers).toContain(j.id);
    }
  });

  it('balíčky podle kap. 9: Hospodský a Štamgastův od začátku, ostatní s podmínkou', () => {
    const p = fresh();
    expect(Object.keys(reg.decks).filter((id) => isDeckUnlocked(p, reg, id))).toEqual(['pub', 'regulars']);
    expect(Object.fromEntries(conditioned('decks').map(({ id, cond }) => [id, cond]))).toEqual({
      clerk: { type: 'custom', id: 'vouchersBought5' },
      tourist: { type: 'playHand', hand: 'straight', count: 25 },
      marias: { type: 'playHand', hand: 'four' },
      court: { type: 'winRun', deck: 'marias' },
      notary: { type: 'custom', id: 'sealedCardsInRun' },
      nouveau_riche: { type: 'haveMoney', atLeast: 50 },
      debtor: { type: 'custom', id: 'roundEndInDebt' },
      grandmas: { type: 'custom', id: 'radyUsed30' },
      junk_shop: { type: 'custom', id: 'jokersSold25' },
      almanac: { type: 'custom', id: 'handLevel6' },
    });
  });

  it('kupóny: všech 12 tier 1 od začátku, tier 2 podmínkou', () => {
    const p = fresh();
    for (const v of Object.values(reg.vouchers)) {
      expect(isVoucherUnlocked(p, reg, v.id), v.id).toBe(v.tier === 1);
      if (v.tier === 2) expect(v.unlock).toEqual({ type: 'custom', id: 'voucherTier1TwoRuns' });
    }
  });

  it('seznam podmínek žolíků (DESIGN 11.3) — tematické a vyvážené', () => {
    expect(Object.fromEntries(conditioned('jokers').map(({ id, cond }) => [id, cond]))).toEqual({
      herbalist: { type: 'useConsumable', kind: 'rada', count: 10 },
      carousel: { type: 'playHand', hand: 'straight', count: 10 },
      lucky_seven: { type: 'stat', stat: 'handsPlayed', atLeast: 77 },
      tab: { type: 'roundEndMoney', atMost: 0 },
      office_connection: { type: 'beatBoss', boss: 'tax_audit' },
      glassblower: { type: 'stat', stat: 'glassBroken', atLeast: 5 },
      notary_public: { type: 'stat', stat: 'maxSealedCards', atLeast: 3 },
      witch: { type: 'useConsumable', kind: 'razitko', count: 5 },
      seer: { type: 'useConsumable', kind: 'pranostika', count: 10 },
      trodden_path: { type: 'stat', stat: 'blindsSkipped', atLeast: 10 },
      war_loot: { type: 'beatBoss', count: 10 },
      carbon_paper: { type: 'stat', stat: 'jokersBought', atLeast: 15 },
      defenestration: { type: 'stat', stat: 'cardsDiscarded', atLeast: 150 },
      snowman: { type: 'stat', stat: 'firstHandRoundWins', atLeast: 3 },
      mushroom_picker: { type: 'stat', stat: 'cardsDestroyed', atLeast: 20 },
      impersonator: { type: 'stat', stat: 'maxJokers', atLeast: 5 },
      beer_sommelier: { type: 'custom', id: 'distinctHands8' },
      archivist: { type: 'discover', category: 'jokers', count: 30 },
      tour_guide: { type: 'winRun', deck: 'tourist' },
      spartakiada: { type: 'stat', stat: 'cardsPlayed', atLeast: 500 },
      voucher_privatization: { type: 'stat', stat: 'vouchersBought', atLeast: 10 },
      new_years_eve: { type: 'winRun' },
      exchange_office: { type: 'stat', stat: 'moneyEarned', atLeast: 500 },
    });
  });
});

// ─────────────────────────── Platnost a splnitelnost ───────────────────────────

describe('každá podmínka obsahu je platná a jde splnit', () => {
  const all = (['decks', 'jokers', 'vouchers', 'challenges'] as const).flatMap((category) =>
    conditioned(category).map((x) => ({ category, ...x })),
  );

  it('odkazy na obsah, statistiky a vlastní vyhodnocovače existují; cíle jsou kladné a konečné', () => {
    const custom = knownCustomUnlocks();
    for (const { category, id, cond } of all) {
      const label = `${category}:${id}`;
      switch (cond.type) {
        case 'winRun':
          if (cond.deck) expect(reg.decks[cond.deck], label).toBeDefined();
          if (cond.stake !== undefined)
            expect(
              Object.values(reg.stakes).some((s) => s.level === cond.stake),
              label,
            ).toBe(true);
          break;
        case 'playHand':
          expect(reg.handTypes[cond.hand], label).toBeDefined();
          break;
        case 'stat':
          expect(ALL_STATS, label).toContain(cond.stat);
          expect(cond.atLeast, label).toBeGreaterThan(0);
          break;
        case 'beatBoss':
          if (cond.boss) {
            expect(reg.bosses[cond.boss], label).toBeDefined();
            // šéf musí jít potkat už v hlavní hře (ne jen ve finále)
            expect(reg.bosses[cond.boss]!.final, label).toBeFalsy();
          }
          break;
        case 'discover':
          expect(cond.count, label).toBeLessThanOrEqual(
            cond.category === 'jokers' ? Object.keys(reg.jokers).length : Infinity,
          );
          break;
        case 'custom':
          expect(custom, label).toContain(cond.id);
          break;
        default:
          break;
      }
      const p = fresh();
      const before = evaluateUnlock(cond, p, undefined, { registry: reg, subject: { category, id } });
      expect(before.met, `${label} nesmí být splněná na čistém profilu`).toBe(false);
      expect(Number.isFinite(before.target), label).toBe(true);
    }
  });

  it('po splnění se položka odemkne (refreshUnlocks) a jinou podmínku nepotřebuje', () => {
    for (const { category, id, cond } of all) {
      const p = fresh();
      satisfy(p, cond);
      refreshUnlocks(p, reg);
      expect(p.unlocks[category], `${category}:${id}`).toContain(id);
    }
  });

  it('žolík s podmínkou winRun na balíčku: balíček sám nezávisí na žolících (žádný kruh)', () => {
    for (const { id, cond } of conditioned('jokers')) {
      if (cond.type !== 'winRun' || !cond.deck) continue;
      const deckCond = unlockConditionFor(reg, 'decks', cond.deck);
      expect(deckCond?.type, id).not.toBe('achievement');
      expect(JSON.stringify(deckCond ?? {}), id).not.toContain('joker');
    }
  });
});

// ─────────────────────────── Odemčení skutečnými událostmi ───────────────────────────

describe('odemčení žolíků z událostí runu (applyRunEvent)', () => {
  function setup(): { p: Profile; run: RunState } {
    const p = fresh();
    const game = Game.newRun({ seed: 'ABCD2345', deckId: 'pub', stake: 1 }, reg);
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    const run = JSON.parse(JSON.stringify(game.state)) as RunState;
    startRun(p, run, ctx);
    return { p, run };
  }
  const fire = (p: Profile, run: RunState, e: GameEvent) => applyRunEvent(p, e, run, ctx);
  const roundWon: GameEvent = { type: 'roundWon', ante: 1, blind: 'small', score: 400, target: 300 };

  it('Sekera: kolo dokončené s 0 Kč (1 Kč nestačí)', () => {
    const { p, run } = setup();
    run.round = { ...run.round!, handsPlayed: 2 };
    expect(fire(p, { ...run, money: 1 }, roundWon)).not.toContainEqual(
      expect.objectContaining({ category: 'jokers', id: 'tab' }),
    );
    expect(fire(p, { ...run, money: 0 }, roundWon)).toContainEqual({
      kind: 'unlock',
      category: 'jokers',
      id: 'tab',
    });
    expect(isJokerUnlocked(p, reg, 'tab')).toBe(true);
  });

  it('Sněhulák: třetí kolo vyhrané hned první rukou', () => {
    const { p, run } = setup();
    const firstHand = { ...run, money: 5, round: { ...run.round!, handsPlayed: 1 } };
    for (let i = 0; i < 2; i++) fire(p, firstHand, roundWon);
    expect(isJokerUnlocked(p, reg, 'snowman')).toBe(false);
    fire(p, { ...firstHand, round: { ...firstHand.round, handsPlayed: 2 } }, roundWon);
    expect(isJokerUnlocked(p, reg, 'snowman')).toBe(false);
    expect(fire(p, firstHand, roundWon)).toContainEqual({
      kind: 'unlock',
      category: 'jokers',
      id: 'snowman',
    });
  });

  it('Známý na úřadě: porážka Kontroly z finančáku (jiný šéf ne)', () => {
    const { p, run } = setup();
    fire(p, run, { type: 'bossDefeated', bossId: 'inventory' });
    expect(isJokerUnlocked(p, reg, 'office_connection')).toBe(false);
    expect(fire(p, run, { type: 'bossDefeated', bossId: 'tax_audit' })).toContainEqual({
      kind: 'unlock',
      category: 'jokers',
      id: 'office_connection',
    });
  });

  it('Pivní sommelier: osmá různá kombinace (napříč runy)', () => {
    const { p, run } = setup();
    const played = (type: (typeof HAND_TYPES)[number]): GameEvent => ({
      type: 'handPlayed',
      roundScore: 10,
      result: {
        hand: { type, scoringIds: [], contains: [type] },
        playedIds: [],
        steps: [],
        chips: 1,
        mult: 1,
        score: 1,
        blockedReason: null,
        destroyedCardIds: [],
        moneyEarned: 0,
      },
    });
    for (const h of HAND_TYPES.slice(0, 7)) fire(p, run, played(h));
    fire(p, run, played(HAND_TYPES[0]!));
    expect(distinctHandsPlayed(p)).toBe(7);
    expect(isJokerUnlocked(p, reg, 'beer_sommelier')).toBe(false);
    expect(fire(p, run, played(HAND_TYPES[7]!))).toContainEqual({
      kind: 'unlock',
      category: 'jokers',
      id: 'beer_sommelier',
    });
  });

  it('Kořenářka: desátá babská rada', () => {
    const { p, run } = setup();
    const rada = Object.values(reg.consumables).find((c) => c.kind === 'rada')!.id;
    p.stats.totals.radyUsed = 8;
    fire(p, run, { type: 'consumableUsed', uid: 1, defId: rada });
    expect(isJokerUnlocked(p, reg, 'herbalist')).toBe(false);
    expect(fire(p, run, { type: 'consumableUsed', uid: 2, defId: rada })).toContainEqual({
      kind: 'unlock',
      category: 'jokers',
      id: 'herbalist',
    });
  });
});

// ─────────────────────────── Vlastní vyhodnocovače ───────────────────────────

describe('vlastní podmínky: čísla v CUSTOM_UNLOCK_PARAMS', () => {
  it('každá vestavěná podmínka má čísla a vyhodnocovač; cíl vyhodnocení = číslo z textu', () => {
    const p = fresh();
    for (const [id, params] of Object.entries(CUSTOM_UNLOCK_PARAMS)) {
      expect(knownCustomUnlocks(), id).toContain(id);
      const target = params.count ?? params.level ?? params.runs;
      if (target !== undefined) {
        expect(evaluateUnlock({ type: 'custom', id }, p).target, id).toBe(target);
      }
    }
  });

  it('distinctHands8: 7 různých kombinací nestačí, 8 ano (opakování se nepočítá)', () => {
    const p = fresh();
    for (const h of HAND_TYPES.slice(0, 7)) p.stats.handTypes[h] = 5;
    expect(evaluateUnlock({ type: 'custom', id: 'distinctHands8' }, p)).toEqual({
      met: false,
      progress: 7,
      target: 8,
    });
    p.stats.handTypes.flush_five = 1;
    expect(evaluateUnlock({ type: 'custom', id: 'distinctHands8' }, p).met).toBe(true);
  });
});

// ─────────────────────────── Texty podmínek ───────────────────────────

describe('texty podmínek odemčení (sbírka)', () => {
  it('každá položka obsahu má větu bez chybějících klíčů a parametrů', () => {
    for (const category of ['decks', 'jokers', 'vouchers', 'challenges'] as const) {
      const ids =
        category === 'decks'
          ? Object.keys(reg.decks)
          : category === 'jokers'
            ? Object.keys(reg.jokers)
            : category === 'vouchers'
              ? Object.keys(reg.vouchers)
              : Object.keys(reg.challenges);
      for (const id of ids) expectGoodText(unlockTextFor(reg, category, id), `${category}:${id}`);
    }
  });

  it('od začátku / objevem / podmínkou', () => {
    expect(unlockTextFor(reg, 'jokers', 'beer_mat').key).toBe('meta.unlock.fromStart');
    expect(unlockTextFor(reg, 'jokers', 'faust').key).toBe('meta.unlock.byDiscovery');
    expect(render(unlockTextFor(reg, 'jokers', 'carousel')).text).toBe('Zahraj celkem 10\u00a0Postupek.');
    expect(render(unlockTextFor(reg, 'decks', 'court')).text).toBe('Vyhraj run s\u00a0Mariášovým balíčkem.');
    expect(render(unlockTextFor(reg, 'jokers', 'office_connection')).text).toBe(
      'Poraz šéfa „Kontrola z\u00a0finančáku“.',
    );
    const tier2 = Object.values(reg.vouchers).find((v) => v.tier === 2)!;
    const text = render(unlockTextFor(reg, 'vouchers', tier2.id)).text;
    expect(text).toContain(t(`vouchers.${tier2.requires}.name`));
  });

  it('čísla v textu pochází z podmínky (vlastní podmínky z CUSTOM_UNLOCK_PARAMS)', () => {
    expect(render(unlockTextFor(reg, 'decks', 'grandmas')).text).toContain('30');
    expect(render(unlockTextFor(reg, 'decks', 'almanac')).text).toContain('6');
    expect(render(unlockTextFor(reg, 'jokers', 'beer_sommelier')).text).toContain('8');
    expect(render(unlockTextFor(reg, 'jokers', 'exchange_office')).text).toContain('500\u00a0Kč');
  });

  it('obecné šablony pokrývají každý typ podmínky, statistiku, kategorii objevu a druh spotřebky', () => {
    const conds: UnlockCondition[] = [
      { type: 'winRun' },
      { type: 'winRun', deck: 'pub' },
      { type: 'winRun', stake: 5 },
      { type: 'winRun', deck: 'pub', stake: 8 },
      { type: 'reachAnte', ante: 5 },
      { type: 'playHand', hand: 'flush' },
      { type: 'playHand', hand: 'flush', count: 3 },
      { type: 'scoreInHand', atLeast: 10_000 },
      { type: 'haveMoney', atLeast: 25 },
      { type: 'winsTotal', count: 3 },
      { type: 'runsTotal', count: 10 },
      ...DISCOVER_CATEGORIES.map((category): UnlockCondition => ({ type: 'discover', category, count: 5 })),
      ...ALL_STATS.map((stat): UnlockCondition => ({ type: 'stat', stat, atLeast: 7 })),
      { type: 'roundEndMoney', atMost: 0 },
      { type: 'roundEndMoney', atMost: -1 },
      { type: 'roundEndMoney', atMost: 3 },
      { type: 'handLevel', level: 4 },
      { type: 'handLevel', level: 4, hand: 'pair' },
      { type: 'beatBoss', count: 2 },
      { type: 'beatBoss', boss: 'inventory' },
      { type: 'beatBoss', boss: 'inventory', count: 3 },
      { type: 'useConsumable', count: 4 },
      ...CONSUMABLE_KINDS.map((kind): UnlockCondition => ({ type: 'useConsumable', kind, count: 2 })),
      { type: 'useConsumable', id: Object.keys(reg.consumables)[0]!, count: 2 },
      { type: 'winChallenge', count: 3 },
      { type: 'winChallenge', challenge: Object.keys(reg.challenges)[0]! },
      { type: 'achievement', id: 'first_round' },
      ...Object.keys(CUSTOM_UNLOCK_PARAMS).map((id): UnlockCondition => ({ type: 'custom', id })),
      { type: 'custom', id: 'nikdo_nezna' },
    ];
    for (const cond of conds) {
      const spec = unlockText(reg, cond);
      expect(spec.itemKey).toBeNull();
      expectGoodText(spec, JSON.stringify(cond));
    }
    expect(unlockText(reg, { type: 'custom', id: 'nikdo_nezna' }).key).toBe('meta.unlock.cond.unknown');
  });
});
