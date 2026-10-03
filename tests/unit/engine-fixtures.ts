/**
 * Pomocníci pro testy enginu: malý testovací registr obsahu (skutečné kombinace a úpravy karet + testovací
 * žolíci, šéfové, štítky…), založení hry a ruční nastavení ruky.
 */
import { EDITIONS, ENHANCEMENTS, SEALS } from '../../src/content/modifiers';
import { TEST_HAND_TYPE_DEFS } from './fixtures/hand-table';
import type {
  ArtSpec,
  BoosterDef,
  BossDef,
  CardSpec,
  ChallengeDef,
  ConsumableDef,
  ContentRegistry,
  DeckDef,
  JokerDef,
  NewRunOptions,
  StakeDef,
  TagDef,
  VoucherDef,
} from '../../src/engine/content-types';
import { GameCore } from '../../src/engine/effects/core';
import { Game } from '../../src/engine/run/game';
import { createRunState } from '../../src/engine/run/init';
import type { Card, Rank, Suit } from '../../src/engine/types';

export const ART: ArtSpec = { icon: 'card-joker', bg: '#000000', fg: '#ffffff' };

export interface RegistryParts {
  jokers?: JokerDef[];
  consumables?: ConsumableDef[];
  bosses?: BossDef[];
  tags?: TagDef[];
  vouchers?: VoucherDef[];
  boosters?: BoosterDef[];
  decks?: DeckDef[];
  stakes?: StakeDef[];
  challenges?: ChallengeDef[];
}

function byId<T extends { id: string }>(items: readonly T[] = []): Record<string, T> {
  return Object.fromEntries(items.map((it) => [it.id, it]));
}

/** Registr se skutečnými kombinacemi, vylepšeními, pečetěmi a edicemi + dodaným testovacím obsahem. */
export function makeRegistry(parts: RegistryParts = {}): ContentRegistry {
  return {
    handTypes: TEST_HAND_TYPE_DEFS,
    jokers: byId(parts.jokers),
    consumables: byId(parts.consumables),
    enhancements: byId(ENHANCEMENTS),
    seals: byId(SEALS),
    editions: byId(EDITIONS),
    bosses: byId(parts.bosses),
    tags: byId(parts.tags),
    vouchers: byId(parts.vouchers),
    boosters: byId(parts.boosters),
    decks: byId(parts.decks),
    stakes: byId(parts.stakes),
    challenges: byId(parts.challenges),
  };
}

/** Jednoduchý testovací žolík. */
export function joker(id: string, extra: Partial<JokerDef> = {}): JokerDef {
  return { id, rarity: 'common', cost: 4, tags: [], hooks: {}, art: ART, ...extra };
}

/** Jednoduchý testovací šéf. */
export function boss(id: string, extra: Partial<BossDef> = {}): BossDef {
  return { id, color: '#880000', hooks: {}, art: ART, ...extra };
}

export function booster(id: string, extra: Partial<BoosterDef> = {}): BoosterDef {
  return {
    id,
    kind: 'joker',
    size: 'normal',
    options: 2,
    picks: 1,
    cost: 4,
    weight: 1,
    art: ART,
    ...extra,
  };
}

export function consumable(id: string, extra: Partial<ConsumableDef> = {}): ConsumableDef {
  return { id, kind: 'rada', cost: 4, use: () => {}, art: ART, ...extra };
}

export const DEFAULT_RUN: NewRunOptions = { seed: 'TESTSEED', deckId: 'test', stake: 1 };

export function newGame(reg: ContentRegistry, opts: Partial<NewRunOptions> = {}): Game {
  return Game.newRun({ ...DEFAULT_RUN, ...opts }, reg);
}

/** Holé jádro nad čerstvým stavem runu (bez útrat a efektů `onRunStart`). */
export function newCore(reg: ContentRegistry, opts: Partial<NewRunOptions> = {}): GameCore {
  const o = { ...DEFAULT_RUN, ...opts };
  return new GameCore(createRunState({ ...o, seed: o.seed ?? 'TESTSEED' }, reg), reg);
}

const RANKS: Record<string, Rank> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** `'K♥'`, `'10♠'` → CardSpec (♠ S, ♥ H, ♦ D, ♣ C) + volitelné úpravy. */
export function spec(code: string, extra: Partial<CardSpec> = {}): CardSpec {
  const suitChar = code.slice(-1);
  const suit = ({ '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' } as Record<string, Suit>)[suitChar];
  const rank = RANKS[code.slice(0, -1)];
  if (!suit || !rank) throw new Error(`Bad card code ${code}`);
  return { suit, rank, ...extra };
}

/**
 * Nahradí ruku v běžícím kole novými kartami (přidají se do balíčku runu). Vrací karty v pořadí ruky.
 * Dosavadní karty ruky se vrátí na spodek dobíracího balíčku.
 */
export function setHand(game: Game, specs: CardSpec[]): Card[] {
  const core = game._core;
  const round = core.state.round;
  if (!round) throw new Error('setHand: no round');
  round.drawPile.unshift(...round.hand);
  round.hand = [];
  return specs.map((s) => core.api.addCard(s, { toHand: true, source: 'test' }));
}

/** Založí hru a rovnou vybere první útratu (Malou). */
export function gameInRound(reg: ContentRegistry, opts: Partial<NewRunOptions> = {}): Game {
  const game = newGame(reg, opts);
  const res = game.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`selectBlind failed: ${res.error}`);
  return game;
}
