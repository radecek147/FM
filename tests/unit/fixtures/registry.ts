/**
 * Testovací registr obsahu a pomocníci pro testy skórování a EngineApi.
 *
 * Registr má testovací tabulku kombinací (čísla z 1.0, `fixtures/hand-table.ts`), skutečná vylepšení, pečetě a edice ze `src/content` a malou sadu TESTOVACÍCH žolíků,
 * šéfů, štítků, spotřebek, obálek, balíčků a obtížností — každý testuje jeden hook (seznam níže). Testy si
 * přes `makeRegistry(overrides)` mohou přidat nebo nahradit položky (podle id).
 *
 * Zápis karet (`card`, `setupRound`): `<hodnota><barva>[:vylepšení][@pečeť][~edice][+bonusové čipy][!][^]`
 *   hodnota 2–10, J, Q, K, A; barva S/H/D/C (nebo ♠ ♥ ♦ ♣); `!` debuffnutá, `^` lícem dolů.
 *   Např. `KH`, `10S`, `KH:mult`, `KS~foil`, `5H:glass@red`, `QS:steel`, `AS+20`, `9D!`.
 */
import { EDITIONS, ENHANCEMENTS, SEALS } from '../../../src/content/modifiers';
import { TEST_HAND_TYPE_DEFS } from './hand-table';
import { createCard } from '../../../src/engine/cards/cards';
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
  StakeDef,
  TagDef,
  VoucherDef,
} from '../../../src/engine/content-types';
import { addJokerInstance, newJokerInstance } from '../../../src/engine/effects/api';
import { bossDebuffs } from '../../../src/engine/run/draw';
import { Game } from '../../../src/engine/run/game';
import type {
  Card,
  EditionId,
  GameEvent,
  HandType,
  InstanceState,
  JokerInstance,
  Rank,
  ScoreResult,
  StickerId,
  Suit,
} from '../../../src/engine/types';
import { HAND_TYPES } from '../../../src/engine/types';

export const ART: ArtSpec = { icon: 'card-joker', bg: '#000000', fg: '#ffffff' };

// ─────────────────────────── Tovární funkce ───────────────────────────

export function joker(id: string, extra: Partial<JokerDef> = {}): JokerDef {
  return { id, rarity: 'common', cost: 4, tags: [], hooks: {}, art: ART, ...extra };
}

export function boss(id: string, extra: Partial<BossDef> = {}): BossDef {
  return { id, color: '#880000', hooks: {}, art: ART, ...extra };
}

export function tag(id: string, hooks: TagDef['hooks'], extra: Partial<TagDef> = {}): TagDef {
  return { id, hooks, art: ART, ...extra };
}

export function consumable(id: string, extra: Partial<ConsumableDef> = {}): ConsumableDef {
  return { id, kind: 'rada', cost: 4, use: () => {}, art: ART, ...extra };
}

export function booster(id: string, extra: Partial<BoosterDef> = {}): BoosterDef {
  return { id, kind: 'joker', size: 'normal', options: 2, picks: 1, cost: 4, weight: 1, art: ART, ...extra };
}

/** Klíč hlášky Zpožděného rychlíku (testovací obsah — texty nemá). */
export const LATE_TRAIN_DELAY = 'jokers.late_train.delay';
/** Důvod zákazu ruky šéfem Soused (testovací obsah). */
export const NEIGHBOUR_BLOCKED = 'bosses.neighbour.blocked';

/** Záznam volání hooků testovacích žolíků (`spy` žolík a `isCopy` kontrola). */
export const hookLog: { hook: string; uid: number; isCopy: boolean }[] = [];

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

// ─────────────────────────── Testovací obsah ───────────────────────────

/**
 * Testovací žolíci — každý pokrývá jeden hook:
 * - `noop` — nic (jen nosič edice),
 * - `card_chips` — `onCardScored`: +3 čipy za každou skórující kartu,
 * - `heart_fan` (Srdcař z DESIGN 3.2) — `onCardScored`: skórující ♥ +5 čipů a +2 mult,
 * - `coaster` (Pivní tácek z DESIGN 3.2) — `onHandPlayed`: +10 čipů a +2 mult,
 * - `plus_mult` — `onHandPlayed`: +4 mult; `times_mult` — `onHandPlayed`: ×2 mult,
 * - `late_train` (Zpožděný rychlík) — `onHandPlayed`: ×1,5, ale 1 z 6 nenastane (`ctx.chance`),
 * - `face_echo` — `retriggerScored`: figury skórují 1× navíc; `held_echo` — `retriggerHeld`: +1,
 * - `queen_holder` — `onCardHeld`: držená Q +3 mult,
 * - `leveler` — `beforeScoring`: v první ruce kola zvýší úroveň zahrané kombinace,
 * - `counter` — `afterHandScored` počítadlo v `self.state.hands` (při `isCopy` nemění), `onHandPlayed` +mult = počet,
 * - `greedy_counter` — jako `counter`, ale `isCopy` ignoruje (engine musí ochránit cizí stav),
 * - `copier` / `copier_left` — `copyTarget`: kopíruje souseda vpravo / vlevo,
 * - `uncopyable` — `copyable: false`, `onHandPlayed` +7 mult,
 * - `spy` — zapisuje volání hooků s `isCopy` do `hookLog`,
 * - `four_fingers` — `passive` fourCardStraightFlush; `big_hand` — `passive` handSize +2;
 *   `all_score` — `passive` allCardsScore,
 * - `lifeline` — `preventGameOver`, když skóre kola ≥ ¼ cíle,
 * - `golem` — `onAcquire`: přidá do balíčku kamennou kartu,
 * - `discard_cash` — `onDiscard`: +1 Kč; `round_cash` — `roundEndMoney`: +2 Kč,
 * - `boss_breaker` — `beforeScoring`: vypne šéfa,
 * - `rare_one` / `epic_one` / `legend` — vzácnosti (legendární jen mimo obchod).
 */
export const TEST_JOKERS: JokerDef[] = [
  joker('noop'),
  joker('card_chips', { hooks: { onCardScored: () => ({ chips: 3 }) } }),
  joker('heart_fan', {
    hooks: { onCardScored: (ctx) => (ctx.api.hasSuit(ctx.card, 'H') ? { chips: 5, mult: 2 } : null) },
  }),
  joker('coaster', { hooks: { onHandPlayed: () => ({ chips: 10, mult: 2 }) } }),
  joker('plus_mult', { hooks: { onHandPlayed: () => ({ mult: 4 }) } }),
  joker('times_mult', { hooks: { onHandPlayed: () => ({ xmult: 2 }) } }),
  joker('late_train', {
    hooks: {
      onHandPlayed: (ctx) => (ctx.chance(1, 6) ? { message: LATE_TRAIN_DELAY } : { xmult: 1.5 }),
    },
  }),
  joker('face_echo', { hooks: { retriggerScored: (ctx) => (ctx.api.isFace(ctx.card) ? 1 : 0) } }),
  joker('held_echo', { hooks: { retriggerHeld: () => 1 } }),
  joker('queen_holder', { hooks: { onCardHeld: (ctx) => (ctx.card.rank === 12 ? { mult: 3 } : null) } }),
  joker('leveler', {
    hooks: {
      beforeScoring: (ctx) => {
        if (ctx.firstHand) ctx.api.levelUpHand(ctx.hand.type, 1);
      },
    },
  }),
  joker('counter', {
    initState: () => ({ hands: 0 }),
    hooks: {
      onHandPlayed: (ctx) => ({ mult: num(ctx.self.state.hands) }),
      afterHandScored: (ctx) => {
        if (!ctx.isCopy) ctx.self.state.hands = num(ctx.self.state.hands) + 1;
      },
    },
  }),
  joker('greedy_counter', {
    initState: () => ({ hands: 0 }),
    hooks: {
      onHandPlayed: (ctx) => ({ mult: num(ctx.self.state.hands) }),
      afterHandScored: (ctx) => {
        ctx.self.state.hands = num(ctx.self.state.hands) + 1;
        ctx.self.sellBonus += 1;
      },
    },
  }),
  joker('copier', { hooks: { copyTarget: (ctx) => ctx.state.jokers[ctx.index + 1]?.uid ?? null } }),
  joker('copier_left', { hooks: { copyTarget: (ctx) => ctx.state.jokers[ctx.index - 1]?.uid ?? null } }),
  joker('uncopyable', { copyable: false, hooks: { onHandPlayed: () => ({ mult: 7 }) } }),
  joker('spy', {
    hooks: {
      onCardScored: (ctx) =>
        void hookLog.push({ hook: 'onCardScored', uid: ctx.self.uid, isCopy: ctx.isCopy }),
      onHandPlayed: (ctx) =>
        void hookLog.push({ hook: 'onHandPlayed', uid: ctx.self.uid, isCopy: ctx.isCopy }),
    },
  }),
  joker('four_fingers', { hooks: { passive: () => ({ fourCardStraightFlush: true }) } }),
  joker('big_hand', { hooks: { passive: () => ({ handSize: 2 }) } }),
  joker('all_score', { hooks: { passive: () => ({ allCardsScore: true }) } }),
  joker('lifeline', { hooks: { preventGameOver: (ctx) => ctx.score * 4 >= ctx.target } }),
  joker('golem', {
    hooks: {
      onAcquire: (ctx) => {
        ctx.api.addCard({ suit: 'S', rank: 2, enhancement: 'stone' }, { source: 'golem' });
      },
    },
  }),
  joker('discard_cash', { hooks: { onDiscard: () => ({ money: 1 }) } }),
  joker('round_cash', { hooks: { roundEndMoney: () => 2 } }),
  joker('boss_breaker', { hooks: { beforeScoring: (ctx) => ctx.api.disableBoss() } }),
  joker('rare_one', { rarity: 'rare', cost: 6 }),
  joker('epic_one', { rarity: 'epic', cost: 8 }),
  joker('legend', { rarity: 'legendary', cost: 16, noShop: true }),
];

/**
 * Testovací šéfové: `wall` (jen cíl ×4), `neighbour` (`validateHand`: zákaz opakování kombinace v kole),
 * `halver` (`modifyBase`: poloviční čipy i mult), `heart_ban` (`isCardDebuffed`: ♥), `blind_draw`
 * (`isDrawnFaceDown`: každá druhá líznutá karta), `tax` (`afterHandPlayed`: −1 Kč), `mayor`
 * (`adjustHandScore`: poloviční skóre), `final_boss` (finálový).
 */
export const TEST_BOSSES: BossDef[] = [
  boss('wall', { targetMult: 4 }),
  boss('neighbour', {
    hooks: {
      validateHand: (ctx) => (ctx.round.handTypesPlayed.includes(ctx.hand.type) ? NEIGHBOUR_BLOCKED : null),
    },
  }),
  boss('halver', {
    hooks: {
      modifyBase: (_ctx, base) => ({ chips: Math.floor(base.chips / 2), mult: Math.max(1, base.mult / 2) }),
    },
  }),
  boss('heart_ban', { hooks: { isCardDebuffed: (ctx, card) => ctx.api.hasSuit(card, 'H') } }),
  boss('blind_draw', { hooks: { isDrawnFaceDown: (_ctx, _card, info) => info.drawIndex % 2 === 0 } }),
  boss('tax', { hooks: { afterHandPlayed: (ctx) => ctx.api.addMoney(-1, 'boss') } }),
  boss('mayor', { hooks: { adjustHandScore: (_ctx, score) => Math.floor(score / 2) } }),
  boss('final_boss', { final: true }),
];

/**
 * Testovací štítky: `cash_tag` (`onAdded`: +5 Kč, spotřebuje se), `sick_note` (`onRoundLost`), `lazy_tag`
 * (`onBlindSelect` bez spotřeby), `extra_hand` (`onRoundStart`: +1 ruka, spotřebuje se).
 */
export const TEST_TAGS: TagDef[] = [
  tag('cash_tag', {
    onAdded: (ctx) => {
      ctx.api.addMoney(5, 'tag');
      return true;
    },
  }),
  tag('sick_note', { onRoundLost: (ctx) => ctx.score * 2 >= ctx.target }),
  tag('lazy_tag', { onBlindSelect: () => false }),
  tag('extra_hand', {
    onRoundStart: (ctx) => {
      ctx.api.addHands(1);
      return true;
    },
  }),
];

/** Pranostika `pr_<kombinace>` pro každou kombinaci (vč. tajných) + 2 babské rady + razítko. */
export const TEST_CONSUMABLES: ConsumableDef[] = [
  ...HAND_TYPES.map((hand) =>
    consumable(`pr_${hand}`, { kind: 'pranostika', cost: 3, hand, use: (ctx) => ctx.api.levelUpHand(hand) }),
  ),
  consumable('rada_a'),
  consumable('rada_b'),
  consumable('stamp', { kind: 'razitko', cost: 6 }),
];

export const TEST_BOOSTERS: BoosterDef[] = [
  booster('joker_pack'),
  booster('rada_pack', { kind: 'rada', options: 3 }),
];
export const TEST_DECKS: DeckDef[] = [{ id: 'test', art: ART }];
export const TEST_STAKES: StakeDef[] = [{ id: 'tenner', level: 1, art: ART }];
export const TEST_VOUCHERS: VoucherDef[] = [];
export const TEST_CHALLENGES: ChallengeDef[] = [];

export interface RegistryOverrides {
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

function byId<T extends { id: string }>(base: readonly T[], extra: readonly T[] = []): Record<string, T> {
  const out: Record<string, T> = {};
  for (const it of [...base, ...extra]) out[it.id] = it;
  return out;
}

/**
 * Registr: skutečné kombinace, vylepšení, pečetě a edice + testovací obsah. `overrides` přidají nebo nahradí
 * položky se stejným id.
 */
export function makeRegistry(overrides: RegistryOverrides = {}): ContentRegistry {
  return {
    handTypes: TEST_HAND_TYPE_DEFS,
    jokers: byId(TEST_JOKERS, overrides.jokers),
    consumables: byId(TEST_CONSUMABLES, overrides.consumables),
    enhancements: byId(ENHANCEMENTS),
    seals: byId(SEALS),
    editions: byId(EDITIONS),
    bosses: byId(TEST_BOSSES, overrides.bosses),
    tags: byId(TEST_TAGS, overrides.tags),
    vouchers: byId(TEST_VOUCHERS, overrides.vouchers),
    boosters: byId(TEST_BOOSTERS, overrides.boosters),
    decks: byId(TEST_DECKS, overrides.decks),
    stakes: byId(TEST_STAKES, overrides.stakes),
    challenges: byId(TEST_CHALLENGES, overrides.challenges),
  };
}

// ─────────────────────────── Karty ───────────────────────────

const RANK_OF: Record<string, Rank> = {
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
const SUIT_OF: Record<string, Suit> = {
  S: 'S',
  H: 'H',
  D: 'D',
  C: 'C',
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C',
};

const TOKEN = /^(10|[2-9JQKA])([SHDC♠♥♦♣])(?::(\w+))?(?:@(\w+))?(?:~(\w+))?(?:\+(\d+))?([!^]*)$/u;

/** Karta ze zápisu (viz hlavička souboru) → specifikace + příznaky kola. */
export function parseCard(token: string): { spec: CardSpec; debuffed: boolean; faceDown: boolean } {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`Neplatná karta: ${token}`);
  return {
    spec: {
      rank: RANK_OF[m[1]!]!,
      suit: SUIT_OF[m[2]!]!,
      enhancement: m[3] ?? null,
      seal: m[4] ?? null,
      edition: m[5] ?? null,
      bonusChips: m[6] ? Number(m[6]) : 0,
    },
    debuffed: (m[7] ?? '').includes('!'),
    faceDown: (m[7] ?? '').includes('^'),
  };
}

/** Zápis karty → CardSpec (příznaky `!`/`^` se ignorují). */
export function card(token: string): CardSpec {
  return parseCard(token).spec;
}

/** Seznam karet: řetězec oddělený mezerami nebo pole zápisů/specifikací. */
export type HandSpec = string | readonly (string | CardSpec)[];

function tokens(hand: HandSpec): (string | CardSpec)[] {
  return typeof hand === 'string' ? hand.trim().split(/\s+/).filter(Boolean) : [...hand];
}

// ─────────────────────────── Hra ───────────────────────────

export interface JokerSpec {
  id: string;
  edition?: EditionId | null;
  stickers?: StickerId[];
  state?: InstanceState;
  debuffed?: boolean;
}

export interface MakeGameOptions {
  registry?: ContentRegistry;
  seed?: string;
  deckId?: string;
  stake?: number;
  challengeId?: string | null;
  /** Žolíci (zleva doprava) přidaní bez kontroly slotů a bez `onAcquire`. */
  jokers?: (string | JokerSpec)[];
  money?: number;
  /** Rovnou vybrat první útratu (Malou). */
  round?: boolean;
}

export const DEFAULT_SEED = 'TESTSEED';

export function makeGame(opts: MakeGameOptions = {}): Game {
  const game = Game.newRun(
    {
      seed: opts.seed ?? DEFAULT_SEED,
      deckId: opts.deckId ?? 'test',
      stake: opts.stake ?? 1,
      challengeId: opts.challengeId ?? null,
    },
    opts.registry ?? makeRegistry(),
  );
  if (opts.money !== undefined) game._core.state.money = opts.money;
  if (opts.jokers) addJokers(game, opts.jokers);
  if (opts.round) {
    const res = game.dispatch({ type: 'selectBlind' });
    if (!res.ok) throw new Error(`selectBlind: ${res.error}`);
  }
  return game;
}

/** Přidá žolíky (newJokerInstance + addJokerInstance, bez kontroly slotů a bez `onAcquire`). */
export function addJokers(game: Game, specs: readonly (string | JokerSpec)[]): JokerInstance[] {
  const core = game._core;
  return specs.map((s) => {
    const sp: JokerSpec = typeof s === 'string' ? { id: s } : s;
    const j = newJokerInstance(core, sp.id, sp.edition ?? null, sp.stickers ?? []);
    if (sp.state) j.state = { ...j.state, ...sp.state };
    if (sp.debuffed) j.debuffed = true;
    addJokerInstance(core, j, { ignoreSlots: true });
    return j;
  });
}

/** Vybere útratu šéfa s daným id (Malá a Velká se označí jako přeskočené, bez štítků). */
export function selectBoss(game: Game, bossId: string): void {
  const s = game._core.state;
  if (s.phase !== 'blind_select') throw new Error(`selectBoss: phase ${s.phase}`);
  const slot = s.blinds[2]!;
  slot.bossId = bossId;
  s.blinds[0]!.status = 'skipped';
  s.blinds[1]!.status = 'skipped';
  slot.status = 'current';
  s.blindIndex = 2;
  const res = game.dispatch({ type: 'selectBlind' });
  if (!res.ok) throw new Error(`selectBlind: ${res.error}`);
}

export interface SetupOptions {
  /** Úrovně kombinací před zahráním. */
  levels?: Partial<Record<HandType, number>>;
}

/**
 * Nastaví ruku běžícího kola přesně na zadané karty (v daném pořadí). Když kolo neběží, vybere útratu.
 * Nové karty se přidají do balíčku runu přímo (bez hooků `onCardAdded`), dosavadní karty ruky jdou na spodek
 * dobíracího balíčku. Debuff od aktivního šéfa se přepočítá; `!` a `^` nastaví příznaky ručně.
 */
export function setupRound(game: Game, hand: HandSpec, opts: SetupOptions = {}): Card[] {
  const core = game._core;
  const s = core.state;
  if (s.phase === 'blind_select') {
    const res = game.dispatch({ type: 'selectBlind' });
    if (!res.ok) throw new Error(`selectBlind: ${res.error}`);
  }
  const round = s.round;
  if (!round || s.phase !== 'round') throw new Error(`setupRound: phase ${s.phase}`);
  for (const [type, level] of Object.entries(opts.levels ?? {})) s.handLevels[type as HandType].level = level;
  round.drawPile.unshift(...round.hand);
  round.hand = [];
  return tokens(hand).map((t) => {
    const parsed = typeof t === 'string' ? parseCard(t) : { spec: t, debuffed: false, faceDown: false };
    const c = createCard(core.uid(), parsed.spec);
    s.deck.push(c);
    round.hand.push(c.id);
    c.debuffed = parsed.debuffed || bossDebuffs(core, c);
    c.faceDown = parsed.faceDown;
    return c;
  });
}

export interface PlayOutcome {
  result: ScoreResult;
  events: GameEvent[];
}

/** Zahraje karty (karty nebo id); selhání akce = výjimka. */
export function play(game: Game, cards: readonly (Card | number)[]): PlayOutcome {
  const ids = cards.map((c) => (typeof c === 'number' ? c : c.id));
  const res = game.dispatch({ type: 'play', cardIds: ids });
  if (!res.ok) throw new Error(`play failed: ${res.error}`);
  const ev = res.events.find((e) => e.type === 'handPlayed');
  if (!ev || ev.type !== 'handPlayed') throw new Error('play: no handPlayed event');
  return { result: ev.result, events: res.events };
}

/** Zjednodušený krok pro porovnání pořadí (bez undefined polí). */
export function stepSummary(step: ScoreResult['steps'][number]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(step).filter(([, v]) => v !== undefined));
}

/** Kolo vyhraje příští zahraná ruka (cíl 1). */
export function winNextHand(game: Game): void {
  const round = game._core.state.round;
  if (!round) throw new Error('winNextHand: no round');
  round.target = 1;
}
