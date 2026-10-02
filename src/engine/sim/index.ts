/** Headless simulace: boti, runner a příkazy textového režimu (docs/DESIGN.md kap. 12). */
export { BOT_ALIASES, BOT_NAMES, createBot, resolveBotName } from './bots';
export { parsePlayCommand, shopOffers, type PlayCommand, type ShopOffer } from './commands';
export {
  analyzeCards,
  bestUtility,
  blockedTypes,
  cardValue,
  estimatePlay,
  exactScale,
  exactPlayScore,
  makeEnv,
  planCandidates,
  playValue,
  type CardValue,
  type EvalEnv,
  type HandCandidate,
  type PlayCandidate,
} from './hand-eval';
export {
  botStrength,
  DEFAULT_MAX_ACTIONS,
  fallbackAction,
  MAX_CONSECUTIVE_INVALID,
  simSeed,
  simulateMany,
  simulateRun,
  summarizeRuns,
  WIN_RATE_TARGETS,
  type SimulateManyOptions,
} from './runner';
export type {
  BossStat,
  Bot,
  BotName,
  BotStrength,
  JokerStat,
  RunResult,
  ShopMoneySample,
  SimSummary,
  SimulateRunOptions,
} from './types';
