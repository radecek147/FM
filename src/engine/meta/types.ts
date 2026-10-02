/**
 * Typy meta vrstvy: profil hráče (odemčení, objevy, statistiky, historie, denní runy, achievementy, tutoriál,
 * nastavení) a definice achievementů. Vše v profilu je čistě JSON-serializovatelné a verzované
 * (`PROFILE_VERSION`, migrace v `profile.ts`). Herní pravidla: docs/DESIGN.md kap. 11 a 13.4–13.5.
 */
import type { ContentRegistry, UnlockTotalStat } from '../content-types';
import type { ConsumableKind, GameEvent, HandType, Modifiers, RunState } from '../types';
import type { Settings } from './settings';

// ─────────────────────────── Druhy runů ───────────────────────────

/** Druh runu: hlavní hra, denní run, nebo výzva. */
export type RunMode = 'normal' | 'daily' | 'challenge';

/** Výsledek runu: výhra (poražen šéf posledního patra), prohra, nebo opuštění (nová hra, reset…). */
export type RunOutcome = 'won' | 'lost' | 'abandoned';

// ─────────────────────────── Odemčení a objevy ───────────────────────────

/** Co se odemyká podmínkou (`UnlockCondition`); síla piva má vlastní záznam `ProfileUnlocks.stakes`. */
export type UnlockCategory = 'decks' | 'jokers' | 'vouchers' | 'challenges';

export interface ProfileUnlocks {
  /** Balíčky odemčené podmínkou (balíček bez `unlock` je odemčený vždy). */
  decks: string[];
  /** Nejvyšší odemčená síla piva podle balíčku (chybí = 1, Desítka). */
  stakes: Record<string, number>;
  /** Žolíci odemčení podmínkou (bez `unlock` odemčení vždy; legendární bez `unlock` objevením). */
  jokers: string[];
  /** Kupóny odemčené podmínkou (tier 1 bez `unlock` vždy). */
  vouchers: string[];
  /** Výzvy odemčené podmínkou (výchozí podmínka podle pořadí, DESIGN 11.1). */
  challenges: string[];
}

/** Kategorie, ve kterých se sleduje, co se hráči už ukázalo (sbírka, DESIGN 11.4). */
export type DiscoveryCategory =
  | 'jokers'
  | 'consumables'
  | 'vouchers'
  | 'tags'
  | 'bosses'
  | 'boosters'
  | 'decks'
  | 'hands'
  | 'enhancements'
  | 'seals'
  | 'editions';

export const DISCOVERY_CATEGORIES: readonly DiscoveryCategory[] = [
  'jokers',
  'consumables',
  'vouchers',
  'tags',
  'bosses',
  'boosters',
  'decks',
  'hands',
  'enhancements',
  'seals',
  'editions',
];

/** Záložky sbírky (stav položky dává `collectionState`). */
export type CollectionCategory = DiscoveryCategory | 'stakes' | 'challenges' | 'achievements';

/**
 * Stav položky ve sbírce: neodemčená (silueta + podmínka), odemčená ale neobjevená (silueta + „???“), objevená
 * (plná karta). Achievementy: `locked` = nezískaný, `discovered` = získaný.
 */
export type CollectionState = 'locked' | 'unknown' | 'discovered';

// ─────────────────────────── Statistiky ───────────────────────────

/** Celoživotní počítadla (DESIGN 11.5) — klíče jsou zároveň `UnlockTotalStat`. */
export type StatTotals = Record<UnlockTotalStat, number>;

export interface ProfileRecords {
  maxMoney: number;
  maxJokers: number;
  /** Nejvíc karet s pečetí v balíčku najednou. */
  maxSealedCards: number;
  /** Nejvíc kupónů v jednom runu. */
  maxVouchers: number;
  /** Nejvyšší dosažené patro (i nekonečný režim a výzvy). */
  highestAnte: number;
  /** Nejvyšší patro v nekonečném režimu (0 = ještě nikdy). */
  highestEndlessAnte: number;
  bestRoundScore: number;
  /** Nejnižší zůstatek na konci kola (null = ještě žádné vyhrané kolo). */
  minRoundEndMoney: number | null;
  /** Nejvyšší dosažená úroveň podle kombinace. */
  handLevels: Partial<Record<HandType, number>>;
}

export interface BestHandRecord {
  score: number;
  handType: HandType | null;
  seed: string;
  deckId: string;
}

export interface FastestWinRecord {
  /** Počet zahraných rukou do výhry. */
  hands: number;
  seed: string;
  deckId: string;
  stake: number;
}

export interface WinLossCount {
  played: number;
  won: number;
}

export interface DeckStats extends WinLossCount {
  /** Nejvyšší síla piva, na které hráč s balíčkem vyhrál (0 = ještě nikdy) — „tácek“ v menu. */
  bestStake: number;
}

export interface BossStats {
  defeated: number;
  /** Kolikrát na něm run skončil. */
  lostTo: number;
}

export interface ChallengeStats {
  attempts: number;
  completed: number;
  bestAnte: number;
}

/** Souhrn runů hlavní hry a oficiálních denních runů (výzvy mají `ProfileStats.challenges`). */
export interface RunsSummary {
  played: number;
  won: number;
  lost: number;
  abandoned: number;
  currentStreak: number;
  bestStreak: number;
}

export interface ProfileStats {
  runs: RunsSummary;
  byDeck: Record<string, DeckStats>;
  /** Klíč = úroveň síly piva jako řetězec („1“ … „8“). */
  byStake: Record<string, WinLossCount>;
  bosses: Record<string, BossStats>;
  /** Příčiny proher (pro pitvu): id šéfa, `small` nebo `big` → počet. */
  losses: Record<string, number>;
  challenges: Record<string, ChallengeStats>;
  totals: StatTotals;
  records: ProfileRecords;
  bestHand: BestHandRecord | null;
  fastestWin: FastestWinRecord | null;
  /** Kolikrát kterou kombinaci hráč zahrál. */
  handTypes: Partial<Record<HandType, number>>;
  /** defId → počet kol ve slotu (nejpoužívanější žolík). */
  jokerRounds: Record<string, number>;
  /** defId → počet koupí (nejčastěji kupovaný žolík). */
  jokerBuys: Record<string, number>;
  /** defId → počet použití spotřebky. */
  consumableUses: Record<string, number>;
  /** id kupónu → v kolika různých runech ho hráč koupil (odemčení tier 2). */
  voucherRuns: Record<string, number>;
}

// ─────────────────────────── Historie a denní runy ───────────────────────────

export interface HistoryEntry {
  /** Pořadové číslo runu v profilu. */
  no: number;
  startedAt: string;
  finishedAt: string;
  seed: string;
  deckId: string;
  stake: number;
  mode: RunMode;
  challengeId: string | null;
  /** Seed zadal hráč (run se nepočítá do statistik, odemykání ani achievementů). */
  seeded: boolean;
  /** Oficiální pokus denního runu. */
  official: boolean;
  outcome: RunOutcome;
  /** Nejvyšší dosažené patro. */
  ante: number;
  endless: boolean;
  /** Příčina prohry (id šéfa / `small` / `big`), jinak null. */
  cause: string | null;
  bestHand: number;
  bestHandType: HandType | null;
  /** Žolíci na konci runu (defId zleva doprava). */
  jokers: string[];
  handsPlayed: number;
  roundsWon: number;
}

/** Oficiální pokus denního runu (klíč v `Profile.daily` = `YYYYMMDD`). */
export interface DailyRecord {
  seed: string;
  deckId: string;
  stake: number;
  status: 'playing' | 'finished';
  outcome: RunOutcome | null;
  ante: number;
  bestHand: number;
  startedAt: string;
  finishedAt: string | null;
}

// ─────────────────────────── Achievementy a tutoriál ───────────────────────────

export interface AchievementsState {
  /** id → datum získání (ISO). */
  unlocked: Record<string, string>;
  /** id → průběžný stav (nejvyšší dosažený `progress` z `AchievementDef.check`). */
  progress: Record<string, number>;
}

export interface TutorialState {
  /** Index dalšího nedokončeného kroku v `TUTORIAL_STEPS`. */
  step: number;
  /** Dokončené kroky. */
  seen: string[];
  completed: boolean;
  skipped: boolean;
}

// ─────────────────────────── Rozehraný run ───────────────────────────

/** Počítadla jednoho runu pro achievementy, které stav runu sám nenese. */
export interface RunCounters {
  /** Hráč měl v runu někdy aspoň jednoho žolíka (Abstinent). */
  hadJoker: boolean;
  /** Utraceno / přehozeno v aktuální Večerce. */
  shopSpent: number;
  shopRerolls: number;
  /** Nejvíc utraceno / přehozeno v jedné Večerce runu. */
  maxShopSpent: number;
  maxShopRerolls: number;
  /** Kola po sobě s maximálním úrokem (aktuální a nejdelší série). */
  interestStreak: number;
  maxInterestStreak: number;
  /** Poslední Večerka opuštěná s 0 Kč — čeká se na výhru dalšího kola (Na dřeň). */
  leftShopBroke: boolean;
  /** Kolo vyhrané po odchodu z Večerky s 0 Kč. */
  brokeRoundWon: boolean;
  /** Nejnižší zůstatek na konci kola v tomto runu (null = žádné vyhrané kolo). */
  minRoundEndMoney: number | null;
  glassBroken: number;
  consumablesUsed: Record<ConsumableKind, number>;
  /** Kupóny koupené ve Večerce v tomto runu. */
  vouchersBought: string[];
  /** Kola vyhraná první rukou; z toho šéfové. */
  firstHandRoundWins: number;
  bossesFirstHand: number;
  /**
   * `RunState.nextUid` při zaevidování runu: žolíci a spotřebky s nižším uid jsou startovní výbava (balíček,
   * výzva) a do sbírky se zapíšou až po první vyhrané útratě — opakované zakládání runu sbírku „nefarmí“.
   * 0 = bez omezení (starší profil).
   */
  startUid: number;
}

/** Meta údaje rozehraného runu (v profilu, aby přežily reload a šlo zapsat i opuštěný run). */
export interface CurrentRunMeta {
  no: number;
  seed: string;
  deckId: string;
  stake: number;
  challengeId: string | null;
  daily: boolean;
  mode: RunMode;
  seeded: boolean;
  official: boolean;
  /** Počítá se do statistik, odemykání a achievementů (ne seedovaný a ne neoficiální denní run). */
  counted: boolean;
  startedAt: string;
  /** Výsledek už zapsaný do statistik (výhra hned při `victory`, prohra při `gameOver`), jinak null. */
  outcome: RunOutcome | null;
  /** Příčina prohry z `gameOver` (id šéfa / `small` / `big`), jinak null. */
  cause: string | null;
  maxAnte: number;
  endless: boolean;
  bestHand: number;
  bestHandType: HandType | null;
  jokers: string[];
  handsPlayed: number;
  roundsWon: number;
  counters: RunCounters;
}

// ─────────────────────────── Profil ───────────────────────────

export interface Profile {
  version: number;
  createdAt: string;
  settings: Settings;
  unlocks: ProfileUnlocks;
  discovered: Record<DiscoveryCategory, string[]>;
  /** Položky se štítkem „Nové“ (`kategorie:id`, např. `jokers:golem`, `achievements:first_round`). */
  unseen: string[];
  stats: ProfileStats;
  /** Posledních `HISTORY_LIMIT` runů, nejnovější první. */
  history: HistoryEntry[];
  /** Oficiální denní pokusy: `YYYYMMDD` → výsledek. */
  daily: Record<string, DailyRecord>;
  achievements: AchievementsState;
  tutorial: TutorialState;
  /** Rozehraný run (null = žádný). */
  current: CurrentRunMeta | null;
  /** Pořadové číslo příštího runu. */
  nextRunNo: number;
}

// ─────────────────────────── API ───────────────────────────

/** Kontext volání meta funkcí. Engine hodiny nečte — čas dodá volající. */
export interface MetaCtx {
  registry: ContentRegistry;
  /** Aktuální čas (ISO 8601, UTC). */
  nowIso: string;
  /**
   * Modifikátory runu (UI: `() => controller.engine.modifiers()`). Chybí = spočítají se líně ze stavu runu
   * (kopie, run se nemění).
   */
  mods?: Readonly<Modifiers> | (() => Readonly<Modifiers>);
}

/** Oznámení pro UI (toast „Odemčeno: …“, „Achievement: …“). */
export type MetaNotice =
  | { kind: 'unlock'; category: UnlockCategory; id: string }
  | { kind: 'stake'; deckId: string; stake: number }
  | { kind: 'achievement'; id: string };

export type AchievementCategory =
  | 'progress'
  | 'score'
  | 'hands'
  | 'economy'
  | 'jokers'
  | 'cards'
  | 'decks'
  | 'stakes'
  | 'challenges'
  | 'collection'
  | 'meta'
  | 'curiosity';

export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = [
  'progress',
  'score',
  'hands',
  'economy',
  'jokers',
  'cards',
  'decks',
  'stakes',
  'challenges',
  'collection',
  'meta',
  'curiosity',
];

/**
 * Kontext kontroly achievementu. Kontrola běží po každé události runu (`run` + `event`, stav runu je po celé
 * akci), na konci runu (`run`, bez `event`) a mimo run (`refreshMeta`: jen profil). Profil už obsahuje
 * statistiky včetně právě zpracované události.
 */
export interface AchievementCtx {
  readonly profile: Readonly<Profile>;
  readonly registry: ContentRegistry;
  readonly nowIso: string;
  readonly run?: Readonly<RunState>;
  readonly event?: Readonly<GameEvent>;
  /** Meta údaje rozehraného runu (počítadla `RunCounters`). */
  readonly current?: Readonly<CurrentRunMeta>;
  /** Modifikátory runu (jen s `run`; počítají se líně při prvním čtení). */
  readonly mods?: Readonly<Modifiers>;
}

/** `true` = splněno; `{ progress, target }` = průběh (splněno při `progress >= target`). */
export type AchievementResult = boolean | { progress: number; target: number };

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  /** Skrytý: ve sbírce „???“, dokud ho hráč nezíská. */
  hidden?: boolean;
  /** Smí se získat i v seedovaném (nezapočítaném) runu — jen „Semínko zaseto“ (DESIGN 11.2). */
  allowSeeded?: boolean;
  /** Ikona (název z `ICON_NAMES`) pro sbírku a toast. */
  icon?: string;
  /**
   * Čísla do textů (`{param}` v `achievements.<id>.desc|hint`) — stejné konstanty čte `check`, takže text a podmínka
   * nemůžou odjet od sebe (jako `JokerDef.params`).
   */
  params?: Record<string, number | string>;
  /**
   * Čistá funkce (nic nemění); výjimka = nesplněno. Texty: `achievements.<id>.name|desc|flavor`, skrytý navíc
   * `hint` (nápověda místo „???“).
   */
  check(ctx: AchievementCtx): AchievementResult;
}
