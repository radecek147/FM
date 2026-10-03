/**
 * Obsah: achievementy (DESIGN 11.2, 78 kusů). Texty v src/i18n/cs/achievements.ts (`achievements.<id>.name|desc|
 * flavor`, skryté navíc `hint`); čísla do textů jen přes `params` — stejné konstanty čte `check`.
 * Typ a vyhodnocení: `AchievementDef` v src/engine/meta/types.ts, `evaluateAchievements` v src/engine/meta.
 *
 * Kontrola (`check`) je čistá funkce nad `AchievementCtx` a běží po každé události započítaného runu (stav runu je
 * už po celé akci), na konci runu a mimo run (`refreshMeta`). Proto:
 *  - **celoživotní** podmínky čtou jen profil (statistiky a rekordy jsou v té chvíli už aktualizované) a vracejí
 *    průběh `{ progress, target }` pro sbírku — splní se i zpětně (import profilu);
 *  - **okamžikové** podmínky čtou událost (`on(ctx, 'roundWon')`) a stav runu po akci (kolo po výhře ještě existuje,
 *    peníze jsou před výplatou);
 *  - podmínky **jednoho runu** čtou `run` / `current.counters`; mimo run vracejí průběh 0, aby sbírka ukázala
 *    uložené maximum.
 * Seedovaný run (a denní run mimo soutěž) dává jen achievementy s `allowSeeded` (DESIGN 11.6).
 */
import type { ContentRegistry } from '../engine/content-types';
import { dailyStreak } from '../engine/meta/daily';
import type {
  AchievementCategory,
  AchievementCtx,
  AchievementDef,
  AchievementResult,
  Profile,
} from '../engine/meta/types';
import { isStartingItem } from '../engine/meta/runs';
import {
  challengesCompleted,
  distinctHandsPlayed,
  maxHandLevel,
  totalRunsPlayed,
} from '../engine/meta/unlocks';
import type { Card, GameEvent, HandType, JokerInstance, RunState } from '../engine/types';
import { HAND_TYPES, SECRET_HAND_TYPES } from '../engine/types';

// ─────────────────────────── Čísla (sdílí podmínka i text) ───────────────────────────

const HALFTIME_ANTE = 5;
const NIGHT_ANTE = 12;
const ROOSTER_ANTE = 16;
/**
 * Tepelná smrt vesmíru: patro nekonečného režimu (1.0.1 — dřív skóre ruky ≥ Number.MAX_VALUE, se stropem ×mult
 * z opakování a mírnějším růstem cílů nesplnitelné; cíl šéfa patra 30 je ≈ 1,2e14).
 */
const HEAT_DEATH_ANTE = 30;
const SCORE_TIERS = {
  score_1k: 1_000,
  score_10k: 10_000,
  score_100k: 100_000,
  score_1m: 1_000_000,
  score_1g: 1_000_000_000,
} as const;
/** Od této hranice formát čísel přepíná na vědecký zápis (CLAUDE.md kap. 3). */
const SCIENTIFIC_SCORE = 1e15;
const SAFETY_MULT = 10;
const PHOTO_FINISH_PCT = 5;
const CAREER_LEVEL = 10;
const HIGH_STANDARDS_HANDS = 2;
const PIGGY_MONEY = 50;
const RETIREMENT_MONEY = 100;
const INTEREST_STREAK = 5;
const SPREE_MONEY = 40;
const LOOKING_REROLLS = 10;
const FLEA_SOLD = 6;
const PACKED_MIN_SLOTS = 5;
const ABSTAIN_ANTE = 4;
const COPIERS = 2;
const GROWN_MULT = 50;
const GROWN_XMULT = 5;
const PRANOSTIKY_USED = 50;
const RADY_USED = 50;
const RAZITKA_USED = 25;
const GLASS_BROKEN = 10;
const STEEL_HELD = 4;
const STONE_PLAYED = 5;
const LEGEND_DECKS = 4;
const CHALLENGES_DECATHLON = 10;
const JOKERS_COLLECTOR = 50;
const VOUCHERS_IN_RUN = 8;
const DAILY_ANTE = 3;
const DAILY_STREAK_DAYS = 7;
const RUNS_INVENTORY = 100;
const HAIR_PCT = 1;
const AUDIT_BOSS = 'tax_audit';
const AUDIT_MONEY = 20;
const SKIPS_IN_RUN = 8;

/** Základních 10 kombinací (bez tajných). */
const BASE_HANDS: readonly HandType[] = HAND_TYPES.filter((t) => !SECRET_HAND_TYPES.includes(t));

// ─────────────────────────── Pomocníci ───────────────────────────

type EventOf<K extends GameEvent['type']> = Extract<GameEvent, { type: K }>;

/** Právě zpracovávaná událost daného typu, jinak null. */
function on<K extends GameEvent['type']>(ctx: AchievementCtx, type: K): Readonly<EventOf<K>> | null {
  const e = ctx.event;
  return e && e.type === type ? (e as Readonly<EventOf<K>>) : null;
}

/** Průběh pro sbírku (splněno při `progress >= target`). */
function prog(value: number, target: number): AchievementResult {
  return { progress: Number.isFinite(value) ? value : 0, target };
}

function bestHand(p: Readonly<Profile>): number {
  return p.stats.bestHand?.score ?? 0;
}

/** Výhry hlavní hry, oficiálních denních runů i dokončené výzvy. */
function anyWins(p: Readonly<Profile>): number {
  let n = p.stats.runs.won;
  for (const c of Object.values(p.stats.challenges)) n += c.completed;
  return n;
}

/** Hráč kombinaci někdy zahrál (statistika nebo sbírka). */
function handSeen(p: Readonly<Profile>, hand: HandType): boolean {
  return (p.stats.handTypes[hand] ?? 0) > 0 || p.discovered.hands.includes(hand);
}

function deckWon(p: Readonly<Profile>, deckId: string): boolean {
  return (p.stats.byDeck[deckId]?.won ?? 0) > 0;
}

/** Počet balíčků vyhraných aspoň na úrovni `level`. */
function decksWonAt(p: Readonly<Profile>, level: number): number {
  return Object.values(p.stats.byDeck).filter((d) => d.bestStake >= level).length;
}

/** Vyhrál hráč run na dané síle piva (nebo silnější) s libovolným balíčkem? */
function wonAtStake(p: Readonly<Profile>, registry: ContentRegistry, stakeId: string): boolean {
  const level = registry.stakes[stakeId]?.level;
  return level !== undefined && decksWonAt(p, level) > 0;
}

/** Karty runu podle id (v pořadí `ids`; chybějící se vynechají). */
function cardsOf(run: Readonly<RunState>, ids: readonly number[]): Card[] {
  const byId = new Map(run.deck.map((c) => [c.id, c]));
  const out: Card[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (c) out.push(c);
  }
  return out;
}

/** Kolik položek registru hráč objevil. */
function discoveredOf(list: readonly string[], ids: readonly string[]): number {
  const seen = new Set(list);
  return ids.filter((id) => seen.has(id)).length;
}

function legendaryIds(registry: ContentRegistry): string[] {
  return Object.values(registry.jokers)
    .filter((j) => j.rarity === 'legendary')
    .map((j) => j.id);
}

function pranostikaIds(registry: ContentRegistry): string[] {
  return Object.values(registry.consumables)
    .filter((c) => c.kind === 'pranostika')
    .map((c) => c.id);
}

/**
 * Dorostl škálující žolík? Hodnota z `describe(self).current` (stejné číslo, jaké ukazuje popisek): ×mult žolík
 * aspoň ×5, +mult žolík aspoň +50.
 */
function grown(joker: Readonly<JokerInstance>, registry: ContentRegistry): boolean {
  const def = registry.jokers[joker.defId];
  if (!def || !def.tags.includes('scaling') || !def.describe) return false;
  const value = def.describe(joker as JokerInstance).current;
  if (typeof value !== 'number') return false;
  if (def.tags.includes('xmult')) return value >= GROWN_XMULT;
  if (def.tags.includes('mult')) return value >= GROWN_MULT;
  return false;
}

function a(
  id: string,
  category: AchievementCategory,
  icon: string,
  check: AchievementDef['check'],
  extra: Pick<AchievementDef, 'hidden' | 'allowSeeded' | 'params'> = {},
): AchievementDef {
  return { id, category, icon, check, ...extra };
}

// ─────────────────────────── Achievementy ───────────────────────────

const PROGRESS: AchievementDef[] = [
  a('first_round', 'progress', 'beer-stein', ({ profile }) => profile.stats.totals.roundsWon > 0),
  a('first_boss', 'progress', 'crowned-skull', ({ profile }) => profile.stats.totals.bossesDefeated > 0),
  a(
    'halftime',
    'progress',
    'hourglass',
    ({ profile }) => prog(profile.stats.records.highestAnte, HALFTIME_ANTE),
    {
      params: { ante: HALFTIME_ANTE },
    },
  ),
  a('closing_time', 'progress', 'exit-door', ({ profile }) => anyWins(profile) > 0),
  a('one_more', 'progress', 'cycle', (ctx) => !!on(ctx, 'bossDefeated') && !!ctx.run?.endless),
  a(
    'night_watchman',
    'progress',
    'old-lantern',
    ({ profile }) => prog(profile.stats.records.highestAnte, NIGHT_ANTE),
    {
      params: { ante: NIGHT_ANTE },
    },
  ),
  a(
    'rooster_crows',
    'progress',
    'rooster',
    ({ profile }) => prog(profile.stats.records.highestAnte, ROOSTER_ANTE),
    { params: { ante: ROOSTER_ANTE } },
  ),
  a(
    'heat_death',
    'progress',
    'fire',
    ({ profile }) => prog(profile.stats.records.highestAnte, HEAT_DEATH_ANTE),
    { hidden: true, params: { ante: HEAT_DEATH_ANTE } },
  ),
];

const SCORE: AchievementDef[] = [
  ...(Object.entries(SCORE_TIERS) as [keyof typeof SCORE_TIERS, number][]).map(([id, score], i) =>
    a(
      id,
      'score',
      ['coins', 'coins-pile', 'banknote', 'money-stack', 'bank'][i] ?? 'coins',
      ({ profile }) => prog(bestHand(profile), score),
      { params: { score } },
    ),
  ),
  a('scientific_notation', 'score', 'light-bulb', ({ profile }) => bestHand(profile) > SCIENTIFIC_SCORE, {
    params: { score: SCIENTIFIC_SCORE },
  }),
  a(
    'safety_margin',
    'score',
    'shield',
    (ctx) => {
      const e = on(ctx, 'roundWon');
      return !!e && e.target > 0 && e.score >= SAFETY_MULT * e.target;
    },
    { params: { mult: SAFETY_MULT } },
  ),
  a(
    'five_to_twelve',
    'score',
    'alarm-clock',
    (ctx) => {
      const e = on(ctx, 'roundWon');
      const round = ctx.run?.round;
      if (!e || !round || round.handsLeft !== 0 || e.score < e.target) return false;
      return (e.score - e.target) * 100 < PHOTO_FINISH_PCT * e.target;
    },
    { params: { pct: PHOTO_FINISH_PCT } },
  ),
];

const HANDS: AchievementDef[] = [
  a('from_adam', 'hands', 'shiny-apple', (ctx) => {
    const e = on(ctx, 'handPlayed');
    if (!e || !ctx.run) return false;
    const type = e.result.hand.type;
    if (type !== 'straight' && type !== 'straight_flush') return false;
    const ranks = cardsOf(ctx.run, e.result.hand.scoringIds)
      .map((c) => c.rank)
      .sort((x, y) => x - y);
    return ranks.join(',') === '2,3,4,5,14';
  }),
  a('coronation', 'hands', 'imperial-crown', ({ profile }) => (profile.stats.handTypes.royal_flush ?? 0) > 0),
  a('five_committee', 'hands', 'gavel', ({ profile }) => handSeen(profile, 'five'), { hidden: true }),
  a('color_tv', 'hands', 'tv', ({ profile }) => handSeen(profile, 'flush_house'), { hidden: true }),
  a('like_two_eggs', 'hands', 'fried-eggs', ({ profile }) => handSeen(profile, 'flush_five'), {
    hidden: true,
  }),
  a('career_ladder', 'hands', 'ladder', ({ profile }) => prog(maxHandLevel(profile), CAREER_LEVEL), {
    params: { level: CAREER_LEVEL },
  }),
  a(
    'full_menu',
    'hands',
    'chef-toque',
    ({ run }) => {
      const counts = run?.stats.handTypeCounts ?? {};
      return prog(BASE_HANDS.filter((t) => (counts[t] ?? 0) > 0).length, BASE_HANDS.length);
    },
    { params: { count: BASE_HANDS.length } },
  ),
  a(
    'high_standards',
    'hands',
    'top-hat',
    (ctx) => {
      const played = on(ctx, 'roundWon') ? ctx.run?.round?.handTypesPlayed : undefined;
      return !!played && played.length >= HIGH_STANDARDS_HANDS && played.every((t) => t === 'high_card');
    },
    { params: { hands: HIGH_STANDARDS_HANDS } },
  ),
  a(
    'encyclopedist',
    'hands',
    'open-book',
    ({ profile }) => prog(distinctHandsPlayed(profile), HAND_TYPES.length),
    {
      params: { count: HAND_TYPES.length },
    },
  ),
];

const ECONOMY: AchievementDef[] = [
  a(
    'on_the_tab',
    'economy',
    'battle-axe',
    ({ profile }) => (profile.stats.records.minRoundEndMoney ?? 0) < 0,
  ),
  a(
    'stuffed_piggy',
    'economy',
    'piggy-bank',
    ({ profile }) => prog(profile.stats.records.maxMoney, PIGGY_MONEY),
    {
      params: { money: PIGGY_MONEY },
    },
  ),
  a(
    'retirement',
    'economy',
    'gold-bar',
    ({ profile }) => prog(profile.stats.records.maxMoney, RETIREMENT_MONEY),
    { params: { money: RETIREMENT_MONEY } },
  ),
  a(
    'compound_interest',
    'economy',
    'receive-money',
    ({ current }) => prog(current?.counters.maxInterestStreak ?? 0, INTEREST_STREAK),
    { params: { rounds: INTEREST_STREAK } },
  ),
  a('to_the_bone', 'economy', 'wallet', ({ current }) => !!current?.counters.brokeRoundWon),
  a(
    'shopping_spree',
    'economy',
    'shopping-cart',
    ({ current }) => prog(current?.counters.maxShopSpent ?? 0, SPREE_MONEY),
    { params: { money: SPREE_MONEY } },
  ),
  a(
    'just_looking',
    'economy',
    'magnifying-glass',
    ({ current }) => prog(current?.counters.maxShopRerolls ?? 0, LOOKING_REROLLS),
    { params: { count: LOOKING_REROLLS } },
  ),
  a('flea_market', 'economy', 'old-wagon', ({ run }) => prog(run?.stats.jokersSold ?? 0, FLEA_SOLD), {
    params: { count: FLEA_SOLD },
  }),
];

const JOKERS: AchievementDef[] = [
  a(
    'packed_pub',
    'jokers',
    'tavern-sign',
    // Modifikátory (sloty) se počítají líně — jen když je žolíků dost.
    (ctx) => {
      const n = ctx.run?.jokers.length ?? 0;
      return n >= PACKED_MIN_SLOTS && !!ctx.mods && n >= ctx.mods.jokerSlots;
    },
    { params: { count: PACKED_MIN_SLOTS } },
  ),
  a('showcase', 'jokers', 'sparkles', ({ run, registry }) => {
    const editions = Object.keys(registry.editions);
    const have = new Set(run?.jokers.map((j) => j.edition) ?? []);
    return prog(editions.filter((e) => have.has(e)).length, editions.length);
  }),
  a(
    'out_of_the_mountain',
    'jokers',
    'mountains',
    // Startovní výbava (Velký třesk) se počítá až po první vyhrané útratě — jinak by stačilo výzvu založit.
    ({ run, registry, current }) =>
      !!run?.jokers.some(
        (j) =>
          registry.jokers[j.defId]?.rarity === 'legendary' &&
          !(current && isStartingItem(j.uid, run, current)),
      ),
  ),
  a('old_czech_legends', 'jokers', 'castle', ({ profile, registry }) => {
    const ids = legendaryIds(registry);
    return prog(discoveredOf(profile.discovered.jokers, ids), Math.max(1, ids.length));
  }),
  a(
    'abstainer',
    'jokers',
    'cancel',
    ({ run, current }) =>
      !!run && !!current && run.ante >= ABSTAIN_ANTE && !current.counters.hadJoker && run.jokers.length === 0,
    { params: { ante: ABSTAIN_ANTE } },
  ),
  // Kopírující žolíci se navzájem nekopírují (DESIGN 4.4.7) — „kopírka“ tu je mít dva najednou.
  a(
    'office_copier',
    'jokers',
    'papers',
    ({ run, registry }) =>
      (run?.jokers.filter((j) => registry.jokers[j.defId]?.tags.includes('copy')).length ?? 0) >= COPIERS,
    { hidden: true, params: { count: COPIERS } },
  ),
  a('like_water', 'jokers', 'upgrade', ({ run, registry }) => !!run?.jokers.some((j) => grown(j, registry)), {
    params: { mult: GROWN_MULT, xmult: GROWN_XMULT },
  }),
  a(
    'july_snowman',
    'jokers',
    'snowman',
    (ctx) => {
      const e = on(ctx, 'bossDefeated');
      return (
        !!e && !!ctx.registry.bosses[e.bossId]?.final && !!ctx.run?.jokers.some((j) => j.defId === 'snowman')
      );
    },
    { hidden: true },
  ),
];

const CARDS: AchievementDef[] = [
  a(
    'tree_frog',
    'cards',
    'frog',
    ({ profile }) => prog(profile.stats.totals.pranostikyUsed, PRANOSTIKY_USED),
    {
      params: { count: PRANOSTIKY_USED },
    },
  ),
  a('happy_grandma', 'cards', 'cake-slice', ({ profile }) => prog(profile.stats.totals.radyUsed, RADY_USED), {
    params: { count: RADY_USED },
  }),
  a(
    'stamp_on_stamp',
    'cards',
    'stamper',
    ({ profile }) => prog(profile.stats.totals.razitkaUsed, RAZITKA_USED),
    {
      params: { count: RAZITKA_USED },
    },
  ),
  a('weather_wise', 'cards', 'farmer', ({ profile, registry }) => {
    const ids = pranostikaIds(registry);
    return prog(discoveredOf(profile.discovered.consumables, ids), Math.max(1, ids.length));
  }),
  a('notarized', 'cards', 'quill-ink', (ctx) => {
    const e = on(ctx, 'handPlayed');
    if (!e || !ctx.run) return false;
    const seals = new Set(cardsOf(ctx.run, e.result.hand.scoringIds).map((c) => c.seal));
    const all = Object.keys(ctx.registry.seals);
    return all.length > 0 && all.every((s) => seals.has(s));
  }),
  a(
    'lucky_shards',
    'cards',
    'broken-bottle',
    ({ profile }) => prog(profile.stats.totals.glassBroken, GLASS_BROKEN),
    {
      params: { count: GLASS_BROKEN },
    },
  ),
  a(
    'iron_curtain',
    'cards',
    'anvil',
    (ctx) => {
      const e = on(ctx, 'handPlayed');
      if (!e || !ctx.run) return false;
      const held = new Set<number>();
      for (const step of e.result.steps)
        if (step.source === 'held' && step.cardId !== undefined) held.add(step.cardId);
      return cardsOf(ctx.run, [...held]).filter((c) => c.enhancement === 'steel').length >= STEEL_HELD;
    },
    { params: { count: STEEL_HELD } },
  ),
  a(
    'stone_wall',
    'cards',
    'brick-wall',
    (ctx) => {
      const e = on(ctx, 'handPlayed');
      if (!e || !ctx.run || e.result.playedIds.length < STONE_PLAYED) return false;
      const cards = cardsOf(ctx.run, e.result.playedIds);
      return cards.length === e.result.playedIds.length && cards.every((c) => c.enhancement === 'stone');
    },
    { params: { count: STONE_PLAYED } },
  ),
];

const DECKS: AchievementDef[] = [
  a('pub_crawl', 'decks', 'dutch-bike', ({ profile, registry }) => {
    const ids = Object.keys(registry.decks);
    return prog(ids.filter((id) => deckWon(profile, id)).length, Math.max(1, ids.length));
  }),
  a('flek_re_tutti', 'decks', 'poker-hand', ({ profile }) => deckWon(profile, 'marias')),
  a('installment_plan', 'decks', 'take-my-money', ({ profile }) => deckWon(profile, 'debtor')),
  a('fairy_court', 'decks', 'king', ({ profile }) => deckWon(profile, 'court')),
];

/** Achievement za výhru na síle piva (nebo silnější) — id achievementu → id síly piva. */
const STAKE_WINS: readonly [string, string, string][] = [
  ['warmed_up', 'jedenactka', 'beer-bottle'],
  ['twelve_standing', 'dvanactka', 'barrel'],
  ['special_care', 'special', 'glass-celebration'],
  ['five_beers', 'lezak', 'house'],
  ['bock_on_side', 'bock', 'goat'],
  ['double_hit', 'doppelbock', 'crossed-swords'],
  ['tap_emperor', 'imperial', 'beer-horn'],
];

const STAKES: AchievementDef[] = [
  ...STAKE_WINS.map(([id, stakeId, icon]) =>
    a(id, 'stakes', icon, ({ profile, registry }) => wonAtStake(profile, registry, stakeId)),
  ),
  a(
    'district_legend',
    'stakes',
    'round-star',
    ({ profile, registry }) => {
      const level = registry.stakes.imperial?.level;
      return prog(level === undefined ? 0 : decksWonAt(profile, level), LEGEND_DECKS);
    },
    { params: { count: LEGEND_DECKS } },
  ),
];

const CHALLENGES: AchievementDef[] = [
  a('challenger', 'challenges', 'fist', ({ profile }) => challengesCompleted(profile) > 0),
  a(
    'decathlon',
    'challenges',
    'stopwatch',
    ({ profile }) => prog(challengesCompleted(profile), CHALLENGES_DECATHLON),
    {
      params: { count: CHALLENGES_DECATHLON },
    },
  ),
  a('national_champion', 'challenges', 'trophy', ({ profile, registry }) => {
    const ids = Object.keys(registry.challenges);
    const done = ids.filter((id) => (profile.stats.challenges[id]?.completed ?? 0) > 0).length;
    return prog(done, Math.max(1, ids.length));
  }),
];

const COLLECTION: AchievementDef[] = [
  a(
    'coaster_collector',
    'collection',
    'card-joker',
    ({ profile, registry }) =>
      prog(discoveredOf(profile.discovered.jokers, Object.keys(registry.jokers)), JOKERS_COLLECTOR),
    { params: { count: JOKERS_COLLECTOR } },
  ),
  a('joker_museum', 'collection', 'jester-hat', ({ profile, registry }) => {
    const ids = Object.keys(registry.jokers);
    return prog(discoveredOf(profile.discovered.jokers, ids), Math.max(1, ids.length));
  }),
  a(
    'voucher_maniac',
    'collection',
    'ticket',
    ({ profile }) => prog(profile.stats.records.maxVouchers, VOUCHERS_IN_RUN),
    { params: { count: VOUCHERS_IN_RUN } },
  ),
];

const META: AchievementDef[] = [
  a(
    'morning_exercise',
    'meta',
    'sun',
    ({ profile, run, current }) =>
      (current?.mode === 'daily' && current.official && (run?.ante ?? 0) >= DAILY_ANTE) ||
      Object.values(profile.daily).some((d) => d.ante >= DAILY_ANTE),
    { params: { ante: DAILY_ANTE } },
  ),
  a(
    'week_straight',
    'meta',
    'calendar',
    ({ profile }) => prog(dailyStreak(profile).longest, DAILY_STREAK_DAYS),
    {
      params: { days: DAILY_STREAK_DAYS },
    },
  ),
  a('seed_sown', 'meta', 'wheat', ({ current }) => !!current?.seeded, { allowSeeded: true }),
  a('pub_inventory', 'meta', 'shop', ({ profile }) => prog(totalRunsPlayed(profile), RUNS_INVENTORY), {
    params: { count: RUNS_INVENTORY },
  }),
  a('regulars_apprentice', 'meta', 'mustache', ({ profile }) => profile.tutorial.completed),
];

const CURIOSITY: AchievementDef[] = [
  a(
    'quick_beer',
    'curiosity',
    'glass-shot',
    (ctx) => {
      const e = on(ctx, 'gameOver');
      return !!e && e.info.ante === 1 && e.info.blind === 'small';
    },
    { hidden: true },
  ),
  a(
    'by_a_hair',
    'curiosity',
    'beard',
    (ctx) => {
      const e = on(ctx, 'gameOver');
      if (!e || e.info.score >= e.info.target) return false;
      return (e.info.target - e.info.score) * 100 < HAIR_PCT * e.info.target;
    },
    { hidden: true, params: { pct: HAIR_PCT } },
  ),
  a('one_blow', 'curiosity', 'warhammer', ({ current }) => (current?.counters.bossesFirstHand ?? 0) > 0),
  a(
    'nothing_wasted',
    'curiosity',
    'wheelbarrow',
    (ctx) => !!on(ctx, 'victory') && ctx.run?.stats.discardsUsed === 0,
  ),
  a(
    'papers_in_order',
    'curiosity',
    'contract',
    (ctx) => {
      const e = on(ctx, 'bossDefeated');
      return !!e && e.bossId === AUDIT_BOSS && (ctx.run?.money ?? 0) >= AUDIT_MONEY;
    },
    { params: { money: AUDIT_MONEY } },
  ),
  a('shortcut', 'curiosity', 'footprint', ({ run }) => prog(run?.stats.blindsSkipped ?? 0, SKIPS_IN_RUN), {
    params: { count: SKIPS_IN_RUN },
  }),
];

/** Všechny achievementy v pořadí sbírky (DESIGN 11.2). */
export const ACHIEVEMENTS: AchievementDef[] = [
  ...PROGRESS,
  ...SCORE,
  ...HANDS,
  ...ECONOMY,
  ...JOKERS,
  ...CARDS,
  ...DECKS,
  ...STAKES,
  ...CHALLENGES,
  ...COLLECTION,
  ...META,
  ...CURIOSITY,
];
