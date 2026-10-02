/**
 * Profil hráče: založení, verzovaný formát, migrace, (de)serializace a tolerantní obnova.
 *
 * Profil se nikdy nesmí ztratit (docs/ARCHITECTURE.md 5): `deserializeProfile` při neplatné obálce nebo novější
 * verzi vyhodí `SaveError` a `restoreProfile` z toho udělá nový profil + vrátí původní data k záloze
 * (`karban.profile.backup.<timestamp>` zapisuje UI). Platná obálka s poškozenými poli se **opraví**
 * (`normalizeProfile`: neplatné hodnoty nahradí výchozími), ne zahodí.
 */
import type { UnlockTotalStat } from '../content-types';
import { MAX_STAKE } from '../constants';
import type { Migration, SaveErrorCode } from '../save/save';
import { SaveError, migrate, unwrap, wrap } from '../save/save';
import type { ConsumableKind, HandType } from '../types';
import { HAND_TYPES } from '../types';
import { sanitizeSettings } from './settings';
import type {
  AchievementsState,
  BestHandRecord,
  ChallengeStats,
  CurrentRunMeta,
  DailyRecord,
  DeckStats,
  DiscoveryCategory,
  FastestWinRecord,
  HistoryEntry,
  Profile,
  ProfileRecords,
  ProfileStats,
  ProfileUnlocks,
  RunCounters,
  RunMode,
  RunOutcome,
  RunsSummary,
  StatTotals,
  TutorialState,
  WinLossCount,
} from './types';
import { DISCOVERY_CATEGORIES } from './types';

/** Aktuální verze formátu profilu. */
export const PROFILE_VERSION = 1;

/** Kolik runů drží historie (DESIGN 11.5). */
export const HISTORY_LIMIT = 50;

/**
 * Migrace profilu: klíč = verze, ze které se migruje (v → v+1). Po migracích vždy proběhne `normalizeProfile`,
 * takže migrace řeší jen přejmenování/převody — chybějící pole doplní normalizace.
 */
export const PROFILE_MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  // 1: (d) => ({ ...d, newField: defaultValue }),
});

/** Všechna celoživotní počítadla (`StatTotals`) v pevném pořadí. */
export const TOTAL_STAT_KEYS: readonly UnlockTotalStat[] = [
  'handsPlayed',
  'cardsPlayed',
  'discards',
  'cardsDiscarded',
  'moneyEarned',
  'moneySpent',
  'jokersBought',
  'jokersSold',
  'vouchersBought',
  'consumablesUsed',
  'pranostikyUsed',
  'radyUsed',
  'razitkaUsed',
  'rerolls',
  'blindsSkipped',
  'roundsWon',
  'bossesDefeated',
  'glassBroken',
  'boostersOpened',
  'cardsAdded',
  'cardsDestroyed',
  'firstHandRoundWins',
  'shopsEntered',
];

const RUN_MODES: readonly RunMode[] = ['normal', 'daily', 'challenge'];
const RUN_OUTCOMES: readonly RunOutcome[] = ['won', 'lost', 'abandoned'];
const CONSUMABLE_KINDS: readonly ConsumableKind[] = ['pranostika', 'rada', 'razitko'];

// ─────────────────────────── Výchozí hodnoty ───────────────────────────

export function emptyTotals(): StatTotals {
  const out = {} as StatTotals;
  for (const k of TOTAL_STAT_KEYS) out[k] = 0;
  return out;
}

export function emptyRecords(): ProfileRecords {
  return {
    maxMoney: 0,
    maxJokers: 0,
    maxSealedCards: 0,
    maxVouchers: 0,
    highestAnte: 0,
    highestEndlessAnte: 0,
    bestRoundScore: 0,
    minRoundEndMoney: null,
    handLevels: {},
  };
}

export function emptyRunsSummary(): RunsSummary {
  return { played: 0, won: 0, lost: 0, abandoned: 0, currentStreak: 0, bestStreak: 0 };
}

export function emptyProfileStats(): ProfileStats {
  return {
    runs: emptyRunsSummary(),
    byDeck: {},
    byStake: {},
    bosses: {},
    losses: {},
    challenges: {},
    totals: emptyTotals(),
    records: emptyRecords(),
    bestHand: null,
    fastestWin: null,
    handTypes: {},
    jokerRounds: {},
    jokerBuys: {},
    consumableUses: {},
    voucherRuns: {},
  };
}

export function emptyRunCounters(): RunCounters {
  return {
    hadJoker: false,
    shopSpent: 0,
    shopRerolls: 0,
    maxShopSpent: 0,
    maxShopRerolls: 0,
    interestStreak: 0,
    maxInterestStreak: 0,
    leftShopBroke: false,
    brokeRoundWon: false,
    minRoundEndMoney: null,
    glassBroken: 0,
    consumablesUsed: { pranostika: 0, rada: 0, razitko: 0 },
    vouchersBought: [],
    firstHandRoundWins: 0,
    bossesFirstHand: 0,
    startUid: 0,
  };
}

function emptyDiscovered(): Record<DiscoveryCategory, string[]> {
  const out = {} as Record<DiscoveryCategory, string[]>;
  for (const c of DISCOVERY_CATEGORIES) out[c] = [];
  return out;
}

function emptyUnlocks(): ProfileUnlocks {
  return { decks: [], stakes: {}, jokers: [], vouchers: [], challenges: [] };
}

export function emptyTutorial(): TutorialState {
  return { step: 0, seen: [], completed: false, skipped: false };
}

/**
 * Nový profil. `settings` = nastavení libovolného tvaru (např. ze starého klíče `karban.settings`), projde
 * `sanitizeSettings`.
 */
export function createProfile(nowIso: string, settings?: unknown): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: nowIso,
    settings: sanitizeSettings(settings),
    unlocks: emptyUnlocks(),
    discovered: emptyDiscovered(),
    unseen: [],
    stats: emptyProfileStats(),
    history: [],
    daily: {},
    achievements: { unlocked: {}, progress: {} },
    tutorial: emptyTutorial(),
    current: null,
    nextRunNo: 1,
  };
}

// ─────────────────────────── Normalizace (oprava tvaru) ───────────────────────────

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function fin(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function count(x: unknown): number {
  return Math.max(0, Math.floor(fin(x)));
}

function str(x: unknown, fallback = ''): string {
  return typeof x === 'string' ? x : fallback;
}

function strOrNull(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function bool(x: unknown, fallback = false): boolean {
  return typeof x === 'boolean' ? x : fallback;
}

function strList(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter((s): s is string => typeof s === 'string'))];
}

/** Mapa id → konečné číslo (neplatné položky zahodí). */
function numMap(x: unknown, map: (n: number) => number = (n) => n): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRec(x)) return out;
  for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = map(v);
  return out;
}

function handType(x: unknown): HandType | null {
  return typeof x === 'string' && (HAND_TYPES as readonly string[]).includes(x) ? (x as HandType) : null;
}

function handMap(x: unknown): Partial<Record<HandType, number>> {
  const out: Partial<Record<HandType, number>> = {};
  for (const [k, v] of Object.entries(numMap(x, count))) {
    const t = handType(k);
    if (t) out[t] = v;
  }
  return out;
}

function recMap<T>(x: unknown, fn: (v: Rec) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRec(x)) return out;
  for (const [k, v] of Object.entries(x)) if (isRec(v)) out[k] = fn(v);
  return out;
}

function oneOf<T extends string>(x: unknown, options: readonly T[], fallback: T): T {
  return typeof x === 'string' && (options as readonly string[]).includes(x) ? (x as T) : fallback;
}

function normWinLoss(v: Rec): WinLossCount {
  return { played: count(v.played), won: count(v.won) };
}

function normStats(x: unknown): ProfileStats {
  const s = isRec(x) ? x : {};
  const base = emptyProfileStats();
  const runs = isRec(s.runs) ? s.runs : {};
  const totals = isRec(s.totals) ? s.totals : {};
  const rec = isRec(s.records) ? s.records : {};
  for (const k of TOTAL_STAT_KEYS) base.totals[k] = Math.max(0, fin(totals[k]));
  const best = isRec(s.bestHand) ? s.bestHand : null;
  const fast = isRec(s.fastestWin) ? s.fastestWin : null;
  return {
    runs: {
      played: count(runs.played),
      won: count(runs.won),
      lost: count(runs.lost),
      abandoned: count(runs.abandoned),
      currentStreak: count(runs.currentStreak),
      bestStreak: count(runs.bestStreak),
    },
    byDeck: recMap(s.byDeck, (v): DeckStats => ({ ...normWinLoss(v), bestStake: count(v.bestStake) })),
    byStake: recMap(s.byStake, normWinLoss),
    bosses: recMap(s.bosses, (v) => ({ defeated: count(v.defeated), lostTo: count(v.lostTo) })),
    losses: numMap(s.losses, count),
    challenges: recMap(s.challenges, (v): ChallengeStats => ({
      attempts: count(v.attempts),
      completed: count(v.completed),
      bestAnte: count(v.bestAnte),
    })),
    totals: base.totals,
    records: {
      maxMoney: fin(rec.maxMoney),
      maxJokers: count(rec.maxJokers),
      maxSealedCards: count(rec.maxSealedCards),
      maxVouchers: count(rec.maxVouchers),
      highestAnte: count(rec.highestAnte),
      highestEndlessAnte: count(rec.highestEndlessAnte),
      bestRoundScore: Math.max(0, fin(rec.bestRoundScore)),
      minRoundEndMoney:
        typeof rec.minRoundEndMoney === 'number' && Number.isFinite(rec.minRoundEndMoney)
          ? rec.minRoundEndMoney
          : null,
      handLevels: handMap(rec.handLevels),
    },
    bestHand:
      best && typeof best.score === 'number' && Number.isFinite(best.score)
        ? ({
            score: best.score,
            handType: handType(best.handType),
            seed: str(best.seed),
            deckId: str(best.deckId),
          } satisfies BestHandRecord)
        : null,
    fastestWin:
      fast && typeof fast.hands === 'number' && Number.isFinite(fast.hands)
        ? ({
            hands: count(fast.hands),
            seed: str(fast.seed),
            deckId: str(fast.deckId),
            stake: count(fast.stake),
          } satisfies FastestWinRecord)
        : null,
    handTypes: handMap(s.handTypes),
    jokerRounds: numMap(s.jokerRounds, count),
    jokerBuys: numMap(s.jokerBuys, count),
    consumableUses: numMap(s.consumableUses, count),
    voucherRuns: numMap(s.voucherRuns, count),
  };
}

function normHistoryEntry(v: Rec, i: number): HistoryEntry | null {
  if (typeof v.seed !== 'string' || typeof v.deckId !== 'string') return null;
  return {
    no: count(v.no) || i + 1,
    startedAt: str(v.startedAt),
    finishedAt: str(v.finishedAt),
    seed: v.seed,
    deckId: v.deckId,
    stake: Math.max(1, count(v.stake)),
    mode: oneOf(v.mode, RUN_MODES, 'normal'),
    challengeId: strOrNull(v.challengeId),
    seeded: bool(v.seeded),
    official: bool(v.official),
    outcome: oneOf(v.outcome, RUN_OUTCOMES, 'abandoned'),
    ante: Math.max(1, count(v.ante)),
    endless: bool(v.endless),
    cause: strOrNull(v.cause),
    bestHand: Math.max(0, fin(v.bestHand)),
    bestHandType: handType(v.bestHandType),
    jokers: Array.isArray(v.jokers) ? v.jokers.filter((s): s is string => typeof s === 'string') : [],
    handsPlayed: count(v.handsPlayed),
    roundsWon: count(v.roundsWon),
  };
}

function normDaily(x: unknown): Record<string, DailyRecord> {
  const out: Record<string, DailyRecord> = {};
  if (!isRec(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (!/^\d{8}$/.test(k) || !isRec(v) || typeof v.seed !== 'string') continue;
    out[k] = {
      seed: v.seed,
      deckId: str(v.deckId),
      stake: Math.max(1, count(v.stake)),
      status: oneOf(v.status, ['playing', 'finished'] as const, 'finished'),
      outcome: typeof v.outcome === 'string' ? oneOf(v.outcome, RUN_OUTCOMES, 'abandoned') : null,
      ante: Math.max(1, count(v.ante)),
      bestHand: Math.max(0, fin(v.bestHand)),
      startedAt: str(v.startedAt),
      finishedAt: strOrNull(v.finishedAt),
    };
  }
  return out;
}

function normCounters(x: unknown): RunCounters {
  const c = isRec(x) ? x : {};
  const base = emptyRunCounters();
  const used = isRec(c.consumablesUsed) ? c.consumablesUsed : {};
  for (const k of CONSUMABLE_KINDS) base.consumablesUsed[k] = count(used[k]);
  return {
    ...base,
    hadJoker: bool(c.hadJoker),
    shopSpent: Math.max(0, fin(c.shopSpent)),
    shopRerolls: count(c.shopRerolls),
    maxShopSpent: Math.max(0, fin(c.maxShopSpent)),
    maxShopRerolls: count(c.maxShopRerolls),
    interestStreak: count(c.interestStreak),
    maxInterestStreak: count(c.maxInterestStreak),
    leftShopBroke: bool(c.leftShopBroke),
    brokeRoundWon: bool(c.brokeRoundWon),
    minRoundEndMoney:
      typeof c.minRoundEndMoney === 'number' && Number.isFinite(c.minRoundEndMoney)
        ? c.minRoundEndMoney
        : null,
    glassBroken: count(c.glassBroken),
    vouchersBought: strList(c.vouchersBought),
    firstHandRoundWins: count(c.firstHandRoundWins),
    bossesFirstHand: count(c.bossesFirstHand),
    startUid: count(c.startUid),
  };
}

function normCurrent(x: unknown): CurrentRunMeta | null {
  if (!isRec(x) || typeof x.seed !== 'string' || typeof x.deckId !== 'string') return null;
  const seeded = bool(x.seeded);
  const official = bool(x.official);
  const mode = oneOf(x.mode, RUN_MODES, 'normal');
  return {
    no: Math.max(1, count(x.no)),
    seed: x.seed,
    deckId: x.deckId,
    stake: Math.max(1, count(x.stake)),
    challengeId: strOrNull(x.challengeId),
    daily: bool(x.daily),
    mode,
    seeded,
    official,
    counted: bool(x.counted, !seeded && (mode !== 'daily' || official)),
    startedAt: str(x.startedAt),
    outcome: typeof x.outcome === 'string' ? oneOf(x.outcome, RUN_OUTCOMES, 'abandoned') : null,
    cause: strOrNull(x.cause),
    maxAnte: Math.max(1, count(x.maxAnte)),
    endless: bool(x.endless),
    bestHand: Math.max(0, fin(x.bestHand)),
    bestHandType: handType(x.bestHandType),
    jokers: Array.isArray(x.jokers) ? x.jokers.filter((s): s is string => typeof s === 'string') : [],
    handsPlayed: count(x.handsPlayed),
    roundsWon: count(x.roundsWon),
    counters: normCounters(x.counters),
  };
}

/**
 * Opraví tvar profilu po migracích: chybějící nebo neplatná pole nahradí výchozími, neplatné položky seznamů
 * a map zahodí. Nikdy nevyhazuje — platná obálka profilu se tak nikdy neztratí kvůli jednomu poškozenému poli.
 */
export function normalizeProfile(raw: unknown, fallbackIso = new Date(0).toISOString()): Profile {
  const d = isRec(raw) ? raw : {};
  const unlocks = isRec(d.unlocks) ? d.unlocks : {};
  const discovered = isRec(d.discovered) ? d.discovered : {};
  const ach = isRec(d.achievements) ? d.achievements : {};
  const tut = isRec(d.tutorial) ? d.tutorial : {};
  const disc = emptyDiscovered();
  for (const c of DISCOVERY_CATEGORIES) disc[c] = strList(discovered[c]);
  const history = (Array.isArray(d.history) ? d.history : [])
    .map((v, i) => (isRec(v) ? normHistoryEntry(v, i) : null))
    .filter((v): v is HistoryEntry => v !== null)
    .slice(0, HISTORY_LIMIT);
  const maxNo = Math.max(0, ...history.map((h) => h.no));
  const current = normCurrent(d.current);
  const achievements: AchievementsState = {
    unlocked: Object.fromEntries(
      Object.entries(isRec(ach.unlocked) ? ach.unlocked : {}).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    ),
    progress: numMap(ach.progress, (n) => Math.max(0, n)),
  };
  return {
    version: PROFILE_VERSION,
    createdAt: str(d.createdAt, fallbackIso) || fallbackIso,
    settings: sanitizeSettings(d.settings),
    unlocks: {
      decks: strList(unlocks.decks),
      stakes: numMap(unlocks.stakes, (n) => Math.min(MAX_STAKE, Math.max(1, Math.floor(n)))),
      jokers: strList(unlocks.jokers),
      vouchers: strList(unlocks.vouchers),
      challenges: strList(unlocks.challenges),
    },
    discovered: disc,
    unseen: strList(d.unseen),
    stats: normStats(d.stats),
    history,
    daily: normDaily(d.daily),
    achievements,
    tutorial: {
      step: count(tut.step),
      seen: strList(tut.seen),
      completed: bool(tut.completed),
      skipped: bool(tut.skipped),
    },
    current,
    nextRunNo: Math.max(count(d.nextRunNo), maxNo + 1, (current?.no ?? 0) + 1, 1),
  };
}

// ─────────────────────────── Migrace a (de)serializace ───────────────────────────

export interface ProfileLoadOptions {
  /** Tabulka migrací (výchozí `PROFILE_MIGRATIONS`; testy předají vlastní). */
  migrations?: Readonly<Record<number, Migration>>;
  /** Aktuální verze formátu (výchozí `PROFILE_VERSION`). */
  currentVersion?: number;
}

/**
 * Zmigruje data profilu z verze `fromVersion` na aktuální a opraví tvar. Vstup nemění. Novější verze =
 * `SaveError('tooNew')`, chybějící/selhavší migrace = `SaveError('migrationFailed')`.
 */
export function migrateProfile(
  data: Record<string, unknown>,
  fromVersion: number,
  opts: ProfileLoadOptions = {},
): Profile {
  const current = opts.currentVersion ?? PROFILE_VERSION;
  if (fromVersion > current) throw new SaveError('tooNew');
  const copy = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const migrated = migrate(copy, fromVersion, current, opts.migrations ?? PROFILE_MIGRATIONS);
  return normalizeProfile(migrated, typeof data.createdAt === 'string' ? data.createdAt : undefined);
}

/** Uloží profil do obálky `karban-save` (kind `profile`). `savedAt` dodá volající. */
export function serializeProfile(profile: Profile, savedAt = new Date(0).toISOString()): string {
  return JSON.stringify(wrap('profile', PROFILE_VERSION, profile, savedAt));
}

/**
 * Načte profil z obálky (JSON řetězec nebo objekt): ověří obálku, odmítne novější verzi, zmigruje a opraví tvar.
 * Chyby jsou `SaveError` (`invalidJson`, `invalidFormat`, `wrongKind`, `tooNew`, `migrationFailed`) — zálohu
 * poškozených dat řeší volající (`restoreProfile`).
 */
export function deserializeProfile(input: unknown, opts: ProfileLoadOptions = {}): Profile {
  const env = unwrap(input, 'profile');
  const current = opts.currentVersion ?? PROFILE_VERSION;
  if (env.version > current) throw new SaveError('tooNew');
  const copy = JSON.parse(JSON.stringify(env.data)) as Record<string, unknown>;
  const migrated = migrate(copy, env.version, current, opts.migrations ?? PROFILE_MIGRATIONS);
  return normalizeProfile(migrated, typeof env.savedAt === 'string' ? env.savedAt : undefined);
}

/** Výsledek `restoreProfile`. */
export interface ProfileRestoreResult {
  profile: Profile;
  /**
   * `loaded` = profil načten; `created` = žádný profil ani staré nastavení, nový profil; `legacy` = nový profil
   * se starým nastavením z `karban.settings` (volající pak starý klíč smaže); `corrupt` = uložený profil nejde
   * načíst — nový profil, původní data jsou v `backup` a volající je **musí** zálohovat dřív, než profil přepíše.
   */
  status: 'loaded' | 'created' | 'legacy' | 'corrupt';
  error?: SaveErrorCode;
  /** Původní poškozená data (jen u `corrupt`). */
  backup?: string;
}

function parseLegacySettings(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Obnoví profil z úložiště a nikdy nevyhodí: `raw` = obsah klíče `karban.profile` (nebo null), `legacySettings` =
 * obsah starého klíče `karban.settings` (migrace nastavení z doby před profilem).
 */
export function restoreProfile(input: {
  raw: string | null | undefined;
  legacySettings?: string | null;
  nowIso: string;
  options?: ProfileLoadOptions;
}): ProfileRestoreResult {
  const legacy = parseLegacySettings(input.legacySettings);
  if (input.raw === null || input.raw === undefined || input.raw === '') {
    return {
      profile: createProfile(input.nowIso, legacy),
      status: legacy === undefined ? 'created' : 'legacy',
    };
  }
  try {
    return { profile: deserializeProfile(input.raw, input.options), status: 'loaded' };
  } catch (e) {
    return {
      profile: createProfile(input.nowIso, legacy),
      status: 'corrupt',
      error: e instanceof SaveError ? e.code : 'invalidFormat',
      backup: input.raw,
    };
  }
}
