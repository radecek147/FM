/** Vytvoření počátečního stavu runu (balíček, míchání se seedem, výchozí hodnoty). */
import type { ContentRegistry, NewRunOptions } from '../content-types';
import { createCard, standardDeckSpecs } from '../cards/cards';
import { initialHandLevels } from '../hands/levels';
import { createRngStates, rngFromState } from '../rng/rng';
import type { RunState, RunStats } from '../types';

/** Aktuální verze formátu uloženého runu (viz engine/save/migrations.ts). */
export const RUN_STATE_VERSION = 1;

export const STARTING_MONEY = 5;

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
  const deckDef = registry.decks[opts.deckId];
  const challenge = opts.challengeId ? registry.challenges[opts.challengeId] : undefined;
  const specs = challenge?.customDeck ?? deckDef?.buildDeck?.(rngFromState(rng.deck)) ?? standardDeckSpecs();
  let nextUid = 1;
  const deck = specs.map((spec) => createCard(nextUid++, spec));
  const money = challenge?.startingMoney ?? deckDef?.startingMoney ?? STARTING_MONEY;

  return {
    version: RUN_STATE_VERSION,
    seed: opts.seed,
    rng,
    deckId: opts.deckId,
    stake: Math.max(1, Math.min(8, opts.stake)),
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
    handLevels: initialHandLevels(),
    vouchers: [],
    tags: [],
    shop: null,
    booster: null,
    anteVouchers: [],
    extraModifiers: { ...(challenge?.extraModifiers ?? {}) },
    bannedJokers: [...(challenge?.bannedJokers ?? [])],
    unlockedPool: opts.unlockedPool ?? { jokers: null, vouchers: null, boosters: null },
    bossesSeen: [],
    lastConsumable: null,
    flags: {},
    stats: emptyStats(money),
    rewards: null,
    gameOver: null,
    nextUid,
  };
}
