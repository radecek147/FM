/** Vytvoření počátečního stavu runu (balíček, míchání se seedem, výchozí hodnoty). */
import type { CardSpec, ContentRegistry, NewRunOptions, Rng } from '../content-types';
import { createCard, standardDeckSpecs } from '../cards/cards';
import { MAX_STAKE, STARTING_MONEY } from '../constants';
import { initialHandLevels } from '../hands/levels';
import { createRngStates, rngFromState } from '../rng/rng';
import type { HandType, RunState, RunStats } from '../types';

/** Aktuální verze formátu uloženého runu (viz engine/save/migrations.ts). */
export const RUN_STATE_VERSION = 2;

/** Re-export pro starší importy — konstanta žije v engine/constants.ts. */
export { STARTING_MONEY };

/**
 * Složení startovního balíčku: vlastní balíček výzvy, jinak `DeckDef.buildDeck(rng)`, jinak standardních 52 karet.
 * Používá ho založení runu i hrací karty v obchodě a obálkách (výchozí složení, DESIGN 2.5.3 a 2.9).
 */
export function startingDeckSpecs(
  registry: ContentRegistry,
  deckId: string,
  challengeId: string | null | undefined,
  rng: Rng,
): CardSpec[] {
  const challenge = challengeId ? registry.challenges[challengeId] : undefined;
  return challenge?.customDeck ?? registry.decks[deckId]?.buildDeck?.(rng) ?? standardDeckSpecs();
}

export function emptyStats(money: number): RunStats {
  return {
    handsPlayed: 0,
    discardsUsed: 0,
    cardsPlayed: 0,
    cardsDiscarded: 0,
    bestHandScore: 0,
    bestHandType: null,
    moneyEarned: 0,
    moneySpent: 0,
    jokersBought: 0,
    jokersSold: 0,
    consumablesUsed: 0,
    rerolls: 0,
    shopsEntered: 0,
    blindsSkipped: 0,
    bossesDefeated: 0,
    roundsWon: 0,
    handTypeCounts: {},
    jokerRoundCounts: {},
    minMoney: money,
    maxMoney: money,
  };
}

/**
 * Čistý počáteční stav runu: karty balíčku (ze `DeckDef.buildDeck`, výzvy nebo standardních 52),
 * RNG streamy ze seedu. Neobsahuje ještě útraty patra ani efekty `onRunStart` — ty doplní `Game.newRun`.
 */
export function createRunState(opts: NewRunOptions & { seed: string }, registry: ContentRegistry): RunState {
  const rng = createRngStates(opts.seed);
  const challenge = opts.challengeId ? registry.challenges[opts.challengeId] : undefined;
  // Výzva určuje balíček i sílu piva sama (DESIGN 11.1: hraje se na Desítce, pokud výzva neříká jinak).
  const deckId = challenge?.deckId ?? opts.deckId;
  const stake = challenge ? (challenge.stake ?? 1) : opts.stake;
  const deckDef = registry.decks[deckId];
  const specs = startingDeckSpecs(registry, deckId, opts.challengeId, rngFromState(rng.deck));
  let nextUid = 1;
  const deck = specs.map((spec) => createCard(nextUid++, spec));
  const money = challenge?.startingMoney ?? deckDef?.startingMoney ?? STARTING_MONEY;
  const handLevels = initialHandLevels();
  // Startovní úrovně kombinací výzvy (Švejkova anabáze, Minimalista, Mariáš u Vaňků) — celé číslo ≥ 1.
  for (const [hand, level] of Object.entries(challenge?.startingHandLevels ?? {}) as [HandType, number][]) {
    const hl = handLevels[hand];
    if (hl && Number.isFinite(level)) hl.level = Math.max(1, Math.trunc(level));
  }

  return {
    version: RUN_STATE_VERSION,
    seed: opts.seed,
    rng,
    deckId,
    stake: Number.isFinite(stake) ? Math.max(1, Math.min(MAX_STAKE, Math.trunc(stake))) : 1,
    challengeId: opts.challengeId ?? null,
    daily: opts.daily ?? false,
    ante: 1,
    endless: false,
    blindIndex: 0,
    blinds: [],
    phase: 'blind_select',
    money,
    deck,
    round: null,
    jokers: [],
    consumables: [],
    handLevels,
    discoveredHands: [],
    vouchers: [],
    tags: [],
    shop: null,
    booster: null,
    anteVouchers: [],
    extraModifiers: { ...(challenge?.extraModifiers ?? {}) },
    bannedJokers: [...(challenge?.bannedJokers ?? [])],
    // Kopie: pole odemčených položek patří profilu — jeho pozdější změna nesmí měnit rozehraný (seedovaný) run.
    unlockedPool: {
      jokers: opts.unlockedPool?.jokers ? [...opts.unlockedPool.jokers] : null,
      vouchers: opts.unlockedPool?.vouchers ? [...opts.unlockedPool.vouchers] : null,
      boosters: opts.unlockedPool?.boosters ? [...opts.unlockedPool.boosters] : null,
    },
    bossesSeen: [],
    lastConsumable: null,
    flags: {},
    stats: emptyStats(money),
    rewards: null,
    gameOver: null,
    nextUid,
  };
}
