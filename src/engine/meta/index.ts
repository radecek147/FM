/**
 * Meta vrstva (fáze 8): profil hráče — nastavení, odemykání, objevy (sbírka), statistiky, historie, denní run,
 * achievementy, tutoriál. Čistý TypeScript bez DOM a bez hodin (čas dodává volající jako `nowIso`).
 * Přehled API: docs/ARCHITECTURE.md kap. 5.1.
 */
export * from './types';
export * from './settings';
export {
  PROFILE_VERSION,
  HISTORY_LIMIT,
  PROFILE_MIGRATIONS,
  TOTAL_STAT_KEYS,
  createProfile,
  normalizeProfile,
  migrateProfile,
  serializeProfile,
  deserializeProfile,
  restoreProfile,
  emptyRunCounters,
  type ProfileLoadOptions,
  type ProfileRestoreResult,
} from './profile';
export {
  CHALLENGE_UNLOCK_WINS,
  CHALLENGE_UNLOCK_GROUP,
  VOUCHER_TIER2_RUNS,
  VOUCHER_TIER2_WINS,
  evaluateUnlock,
  registerCustomUnlock,
  knownCustomUnlocks,
  challengeDefaultUnlock,
  unlockConditionFor,
  unlockedByDiscovery,
  isUnlocked,
  isJokerUnlocked,
  isDeckUnlocked,
  isVoucherUnlocked,
  isChallengeUnlocked,
  maxStakeLevel,
  maxStakeFor,
  isStakeUnlocked,
  unlockedPoolFor,
  refreshUnlocks,
  statValue,
  maxHandLevel,
  totalRunsPlayed,
  challengesCompleted,
  type UnlockProgress,
  type UnlockEvalCtx,
  type CustomUnlockFn,
  type PoolMode,
} from './unlocks';
export {
  achievementList,
  achievementCtx,
  evaluateAchievements,
  achievementProgress,
  grantAchievement,
} from './achievements';
export {
  startRun,
  resumeRun,
  applyRunEvent,
  applyRunEvents,
  finishRun,
  refreshMeta,
  currentMatches,
  type StartRunCtx,
} from './runs';
export {
  DAILY_MAX_STAKE,
  DAILY_SEED_PREFIX,
  dailyDateKey,
  dailyKeyFromSeed,
  dailySetupFromSeed,
  dailyRunSetup,
  parseSeedInput,
  isDailyAvailable,
  dailyStreak,
  type DailySetup,
  type SeedErrorCode,
  type SeedParseResult,
} from './daily';
export {
  TUTORIAL_STEPS,
  tutorialActive,
  nextTutorialStep,
  shouldShowTutorialStep,
  markTutorialStep,
  skipTutorial,
  restartTutorial,
  type TutorialStepId,
} from './tutorial';
export { collectionState, unseenKey, isUnseen, unseenCount, markSeen, topEntry, winRate } from './collection';
