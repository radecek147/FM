/**
 * Achievementy (src/content/achievements.ts, DESIGN 11.2): úplnost obsahu a textů a pro **každý** achievement
 * případ „těsně před splněním → nic, splněno → udělen (s oznámením)“ přes skutečné meta API (`startRun`,
 * `applyRunEvent`, `finishRun`, `refreshMeta`) s připraveným runem a profilem.
 */
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../src/assets/icons';
import { registry } from '../../src/content';
import { ACHIEVEMENTS } from '../../src/content/achievements';
import {
  ACHIEVEMENT_CATEGORIES,
  Game,
  MSG,
  TUTORIAL_STEPS,
  achievementProgress,
  applyRunEvent,
  applyRunEvents,
  createBot,
  createProfile,
  dailyRunSetup,
  deserializeProfile,
  finishRun,
  markTutorialStep,
  refreshMeta,
  serializeProfile,
  startRun,
  unlockedPoolFor,
} from '../../src/engine';
import type {
  GameEvent,
  HandType,
  JokerInstance,
  MetaCtx,
  MetaNotice,
  NewRunOptions,
  Profile,
  RoundState,
  RunState,
  ScoreResult,
  ScoreStep,
} from '../../src/engine';
import { HAND_TYPES, SECRET_HAND_TYPES } from '../../src/engine/types';
import { cs, hasKey, t } from '../../src/i18n/cs';

const NOW = '2026-10-02T10:00:00.000Z';
const reg = registry();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const BASE_HANDS = HAND_TYPES.filter((h) => !SECRET_HAND_TYPES.includes(h));
const LEGENDS = Object.values(reg.jokers)
  .filter((j) => j.rarity === 'legendary')
  .map((j) => j.id);
const PRANOSTIKY = Object.values(reg.consumables)
  .filter((c) => c.kind === 'pranostika')
  .map((c) => c.id);
const consumableOf = (kind: string): string =>
  Object.values(reg.consumables).find((c) => c.kind === kind)!.id;
const CHALLENGE_IDS = Object.keys(reg.challenges);
const JOKER_IDS = Object.keys(reg.jokers);
const DECK_IDS = Object.keys(reg.decks);

type GameOverInfo = Extract<GameEvent, { type: 'gameOver' }>['info'];

/** Prostředí jednoho případu: profil, aktuální (upravovaný) stav runu a poslední oznámení. */
class Env {
  p: Profile = createProfile(NOW);
  run!: RunState;
  game!: Game;
  ctx: MetaCtx = { registry: reg, nowIso: NOW };
  last: MetaNotice[] = [];
  private seq = 0;
  private uid = 1000;

  start(opts: Partial<NewRunOptions> = {}, extra: { seeded?: boolean; nowIso?: string } = {}): MetaNotice[] {
    this.ctx = { registry: reg, nowIso: extra.nowIso ?? NOW };
    this.game = Game.newRun({ seed: `ACHV${this.seq++}`, deckId: 'pub', stake: 1, ...opts }, reg);
    this.game.dispatch({ type: 'selectBlind' });
    this.run = clone(this.game.state);
    this.last = startRun(this.p, this.run, { ...this.ctx, seeded: extra.seeded === true });
    return this.last;
  }

  daily(nowIso: string): MetaNotice[] {
    const setup = dailyRunSetup(nowIso, reg);
    return this.start(
      {
        seed: setup.seed,
        deckId: setup.deckId,
        stake: setup.stake,
        daily: true,
        unlockedPool: unlockedPoolFor(this.p, reg, 'daily'),
      },
      { nowIso },
    );
  }

  set(patch: Partial<RunState>): this {
    this.run = { ...this.run, ...clone(patch) };
    return this;
  }

  round(patch: Partial<RoundState>): this {
    this.run = { ...this.run, round: { ...this.run.round!, ...clone(patch) } };
    return this;
  }

  stats(patch: Partial<RunState['stats']>): this {
    this.run = { ...this.run, stats: { ...this.run.stats, ...clone(patch) } };
    return this;
  }

  /** Upraví karty balíčku runu podle id. */
  cards(ids: readonly number[], patch: Partial<RunState['deck'][number]>): this {
    const set = new Set(ids);
    this.run = { ...this.run, deck: this.run.deck.map((c) => (set.has(c.id) ? { ...c, ...patch } : c)) };
    return this;
  }

  /** Id karet balíčku s danými hodnotami (každá jiná karta). */
  ranks(ranks: readonly number[]): number[] {
    const used = new Set<number>();
    return ranks.map((r) => {
      const c = this.run.deck.find((x) => x.rank === r && !used.has(x.id))!;
      used.add(c.id);
      return c.id;
    });
  }

  joker(defId: string, patch: Partial<JokerInstance> = {}): JokerInstance {
    return {
      uid: this.uid++,
      defId,
      edition: null,
      state: reg.jokers[defId]?.initState?.() ?? {},
      sellBonus: 0,
      stickers: [],
      debuffed: false,
      ...patch,
    };
  }

  /** Nastaví žolíky ve slotech a pošle `jokerAdded` posledního. */
  jokers(list: JokerInstance[]): MetaNotice[] {
    this.set({ jokers: list });
    const j = list.at(-1)!;
    return this.fire({ type: 'jokerAdded', uid: j.uid, defId: j.defId });
  }

  fire(e: GameEvent): MetaNotice[] {
    this.last = applyRunEvent(this.p, e, this.run, this.ctx);
    return this.last;
  }

  play(extra: Partial<ScoreResult> & { type?: HandType; scoringIds?: number[] } = {}): MetaNotice[] {
    const { type = 'pair', scoringIds = [], ...rest } = extra;
    const result: ScoreResult = {
      hand: { type, scoringIds, contains: [type] },
      playedIds: scoringIds,
      steps: [],
      chips: 10,
      mult: 1,
      score: 10,
      blockedReason: null,
      destroyedCardIds: [],
      moneyEarned: 0,
      ...rest,
    };
    return this.fire({ type: 'handPlayed', result, roundScore: result.score });
  }

  roundWon(score = 400, target = 300, blind: 'small' | 'big' | 'boss' = 'small'): MetaNotice[] {
    return this.fire({ type: 'roundWon', ante: this.run.ante, blind, score, target });
  }

  boss(bossId: string): MetaNotice[] {
    return this.fire({ type: 'bossDefeated', bossId });
  }

  ante(ante: number): MetaNotice[] {
    this.set({ ante });
    return this.fire({ type: 'anteChanged', ante });
  }

  use(defId: string): MetaNotice[] {
    return this.fire({ type: 'consumableUsed', uid: this.uid++, defId });
  }

  win(): MetaNotice[] {
    this.set({ phase: 'victory' });
    const n = this.fire({ type: 'victory', ante: this.run.ante });
    this.last = [...n, ...finishRun(this.p, this.run, this.ctx)];
    return this.last;
  }

  lose(info: Partial<GameOverInfo> = {}): MetaNotice[] {
    const full: GameOverInfo = {
      cause: 'small',
      ante: this.run.ante,
      blind: 'small',
      score: 10,
      target: 300,
      ...info,
    };
    this.set({ phase: 'game_over', gameOver: full });
    const n = this.fire({ type: 'gameOver', info: full });
    this.last = [...n, ...finishRun(this.p, this.run, this.ctx)];
    return this.last;
  }

  finish(): MetaNotice[] {
    this.last = finishRun(this.p, this.run, this.ctx);
    return this.last;
  }

  refresh(): MetaNotice[] {
    this.last = refreshMeta(this.p, this.ctx);
    return this.last;
  }

  has(id: string): boolean {
    return this.p.achievements.unlocked[id] !== undefined;
  }
}

/** Krok skórování: karta držená v ruce (ocelová) a prasklé sklo. */
const heldStep = (cardId: number): ScoreStep => ({
  source: 'held',
  cardId,
  xmult: 1.5,
  chipsAfter: 10,
  multAfter: 1.5,
});
const glassStep = (cardId: number): ScoreStep => ({
  source: 'card',
  cardId,
  message: MSG.glassBreak,
  chipsAfter: 10,
  multAfter: 1,
});
const money = (delta: number, total: number, reason = 'test'): GameEvent => ({
  type: 'moneyChanged',
  delta,
  money: total,
  reason,
});
const done = { attempts: 1, completed: 1, bestAnte: 8 };

interface Case {
  /** Začátek (výchozí: nový run Hospodského na Desítce s vybranou útratou). */
  start?(e: Env): void;
  /** Příprava profilu / runu těsně pod hranicí. */
  setup?(e: Env): void;
  /** Kroky, které podmínku ještě nesplní. */
  before(e: Env): void;
  /** Krok, který ji splní (poslední oznámení musí achievement obsahovat). */
  after(e: Env): void;
}

/** Hranice skóre achievementu podle `params`. */
const scoreOf = (id: string): number => Number(ACHIEVEMENTS.find((a) => a.id === id)!.params!.score);

const stakeCase = (level: number): Case => ({
  start: (e) => void e.start({ stake: level - 1 }),
  before: (e) => void e.win(),
  after: (e) => {
    e.start({ stake: level });
    e.win();
  },
});

const deckCase = (deckId: string): Case => ({
  before: (e) => void e.win(),
  after: (e) => {
    e.start({ deckId });
    e.win();
  },
});

const scoreCase = (id: string): Case => ({
  before: (e) => void e.play({ score: scoreOf(id) - 1 }),
  after: (e) => void e.play({ score: scoreOf(id) }),
});

const consumableCase = (
  kind: string,
  field: 'pranostikyUsed' | 'radyUsed' | 'razitkaUsed',
  target: number,
): Case => ({
  setup: (e) => void (e.p.stats.totals[field] = target - 2),
  before: (e) => void e.use(consumableOf(kind)),
  after: (e) => void e.use(consumableOf(kind)),
});

const CASES: Record<string, Case> = {
  // ── postup ──
  first_round: { before: (e) => void e.play({ score: 10 }), after: (e) => void e.roundWon() },
  first_boss: { before: (e) => void e.roundWon(), after: (e) => void e.boss('inventory') },
  halftime: { before: (e) => void e.ante(4), after: (e) => void e.ante(5) },
  closing_time: { before: (e) => void e.boss('inventory'), after: (e) => void e.win() },
  one_more: {
    before: (e) => {
      e.set({ ante: 9 });
      e.boss('inventory');
    },
    after: (e) => {
      e.set({ endless: true });
      e.boss('inventory');
    },
  },
  night_watchman: { before: (e) => void e.ante(11), after: (e) => void e.ante(12) },
  rooster_crows: { before: (e) => void e.ante(15), after: (e) => void e.ante(16) },
  heat_death: { before: (e) => void e.ante(29), after: (e) => void e.ante(30) },

  // ── skóre ──
  score_1k: scoreCase('score_1k'),
  score_10k: scoreCase('score_10k'),
  score_100k: scoreCase('score_100k'),
  score_1m: scoreCase('score_1m'),
  score_1g: scoreCase('score_1g'),
  scientific_notation: {
    before: (e) => void e.play({ score: 1e15 }),
    after: (e) => void e.play({ score: 2e15 }),
  },
  safety_margin: { before: (e) => void e.roundWon(2999, 300), after: (e) => void e.roundWon(3000, 300) },
  five_to_twelve: {
    before: (e) => {
      e.round({ handsLeft: 1 }).roundWon(301, 300);
      e.round({ handsLeft: 0 }).roundWon(315, 300);
    },
    after: (e) => void e.roundWon(314, 300),
  },

  // ── kombinace ──
  from_adam: {
    before: (e) => {
      e.play({ type: 'straight', scoringIds: e.ranks([2, 3, 4, 5, 6]) });
      e.play({ type: 'straight', scoringIds: e.ranks([10, 11, 12, 13, 14]) });
    },
    after: (e) => void e.play({ type: 'straight', scoringIds: e.ranks([14, 2, 3, 4, 5]) }),
  },
  coronation: {
    before: (e) => void e.play({ type: 'straight_flush' }),
    after: (e) => void e.play({ type: 'royal_flush' }),
  },
  five_committee: {
    before: (e) => void e.play({ type: 'four' }),
    after: (e) => void e.play({ type: 'five' }),
  },
  color_tv: {
    before: (e) => void e.play({ type: 'full_house' }),
    after: (e) => void e.play({ type: 'flush_house' }),
  },
  like_two_eggs: {
    before: (e) => void e.play({ type: 'five' }),
    after: (e) => void e.play({ type: 'flush_five' }),
  },
  career_ladder: {
    before: (e) => {
      e.set({ handLevels: { ...e.run.handLevels, pair: { level: 9, played: 0 } } });
      e.fire({ type: 'handLeveled', hand: 'pair', level: 9, delta: 1 });
    },
    after: (e) => {
      e.set({ handLevels: { ...e.run.handLevels, pair: { level: 10, played: 0 } } });
      e.fire({ type: 'handLeveled', hand: 'pair', level: 10, delta: 1 });
    },
  },
  full_menu: {
    before: (e) => {
      e.stats({ handTypeCounts: Object.fromEntries(BASE_HANDS.slice(0, 9).map((h) => [h, 1])) });
      e.play();
    },
    after: (e) => {
      e.stats({ handTypeCounts: Object.fromEntries(BASE_HANDS.map((h) => [h, 1])) });
      e.play();
    },
  },
  high_standards: {
    before: (e) => {
      e.round({ handTypesPlayed: ['high_card'] }).roundWon();
      e.round({ handTypesPlayed: ['high_card', 'pair'] }).roundWon();
    },
    after: (e) => void e.round({ handTypesPlayed: ['high_card', 'high_card'] }).roundWon(),
  },
  encyclopedist: {
    setup: (e) => {
      for (const h of HAND_TYPES) if (h !== 'flush_five') e.p.stats.handTypes[h] = 1;
    },
    before: (e) => void e.play({ type: 'pair' }),
    after: (e) => void e.play({ type: 'flush_five' }),
  },

  // ── ekonomika ──
  on_the_tab: {
    before: (e) => void e.set({ money: 0 }).roundWon(),
    after: (e) => void e.set({ money: -1 }).roundWon(),
  },
  stuffed_piggy: {
    before: (e) => void e.set({ money: 49 }).fire(money(45, 49)),
    after: (e) => void e.set({ money: 50 }).fire(money(1, 50)),
  },
  retirement: {
    before: (e) => void e.set({ money: 99 }).fire(money(95, 99)),
    after: (e) => void e.set({ money: 100 }).fire(money(1, 100)),
  },
  compound_interest: {
    before: (e) => {
      const m = e.game.modifiers();
      const interest = Math.floor(m.interestCap * m.interestMult);
      const rewards: GameEvent = {
        type: 'roundRewards',
        blindReward: 3,
        unusedHands: 0,
        unusedDiscards: 0,
        interest,
        extra: [],
        total: 3 + interest,
      };
      e.fire({ ...rewards, interest: interest - 1 });
      for (let i = 0; i < 4; i++) e.fire(rewards);
    },
    after: (e) => {
      const m = e.game.modifiers();
      const interest = Math.floor(m.interestCap * m.interestMult);
      e.fire({
        type: 'roundRewards',
        blindReward: 3,
        unusedHands: 0,
        unusedDiscards: 0,
        interest,
        extra: [],
        total: 3 + interest,
      });
    },
  },
  to_the_bone: {
    before: (e) => {
      e.set({ money: 1 }).fire({ type: 'shopLeft' });
      e.roundWon();
      e.set({ money: 0 }).fire({ type: 'shopLeft' });
    },
    after: (e) => void e.set({ money: 4 }).roundWon(),
  },
  shopping_spree: {
    setup: (e) => void e.fire({ type: 'shopEntered' }),
    before: (e) => {
      e.fire(money(-39, 1, 'purchase'));
      e.fire(money(-5, 1, 'test'));
    },
    after: (e) => void e.fire(money(-1, 0, 'purchase')),
  },
  just_looking: {
    setup: (e) => void e.fire({ type: 'shopEntered' }),
    before: (e) => {
      for (let i = 0; i < 9; i++) e.fire({ type: 'shopRerolled', cost: 5 });
    },
    after: (e) => void e.fire({ type: 'shopRerolled', cost: 5 }),
  },
  flea_market: {
    before: (e) =>
      void e.stats({ jokersSold: 5 }).fire({ type: 'jokerSold', uid: 1, defId: 'beer_mat', price: 2 }),
    after: (e) =>
      void e.stats({ jokersSold: 6 }).fire({ type: 'jokerSold', uid: 2, defId: 'beer_mat', price: 2 }),
  },

  // ── žolíci ──
  packed_pub: {
    before: (e) =>
      void e.jokers(['beer_mat', 'hearts_man', 'gravedigger', 'crusader'].map((id) => e.joker(id))),
    after: (e) =>
      void e.jokers(
        ['beer_mat', 'hearts_man', 'gravedigger', 'crusader', 'early_bird'].map((id) => e.joker(id)),
      ),
  },
  showcase: {
    before: (e) =>
      void e.jokers([
        e.joker('beer_mat', { edition: 'foil' }),
        e.joker('hearts_man', { edition: 'holo' }),
        e.joker('gravedigger', { edition: 'poly' }),
      ]),
    after: (e) =>
      void e.jokers([
        e.joker('beer_mat', { edition: 'foil' }),
        e.joker('hearts_man', { edition: 'holo' }),
        e.joker('gravedigger', { edition: 'poly' }),
        e.joker('crusader', { edition: 'negative' }),
      ]),
  },
  out_of_the_mountain: {
    before: (e) => void e.jokers([e.joker('snowman')]),
    after: (e) => void e.jokers([e.joker('faust')]),
  },
  old_czech_legends: {
    setup: (e) => void (e.p.discovered.jokers = LEGENDS.slice(0, -1)),
    before: (e) => void e.jokers([e.joker(LEGENDS[0]!)]),
    after: (e) => void e.jokers([e.joker(LEGENDS.at(-1)!)]),
  },
  abstainer: { before: (e) => void e.ante(3), after: (e) => void e.ante(4) },
  office_copier: {
    before: (e) => void e.jokers([e.joker('carbon_paper'), e.joker('beer_mat')]),
    after: (e) => void e.jokers([e.joker('carbon_paper'), e.joker('archivist')]),
  },
  like_water: {
    before: (e) => void e.jokers([e.joker('herbalist', { state: { mult: 48 } })]),
    after: (e) => void e.jokers([e.joker('herbalist', { state: { mult: 50 } })]),
  },
  july_snowman: {
    before: (e) => {
      e.set({ jokers: [e.joker('snowman')] }).boss('tax_audit');
      e.set({ jokers: [] }).boss('mayor');
    },
    after: (e) => void e.set({ jokers: [e.joker('snowman')] }).boss('mayor'),
  },

  // ── spotřebky a karty ──
  tree_frog: consumableCase('pranostika', 'pranostikyUsed', 50),
  happy_grandma: consumableCase('rada', 'radyUsed', 50),
  stamp_on_stamp: consumableCase('razitko', 'razitkaUsed', 25),
  weather_wise: {
    setup: (e) => void (e.p.discovered.consumables = PRANOSTIKY.slice(0, -1)),
    before: (e) => {
      e.set({ consumables: [{ uid: 900, defId: PRANOSTIKY[0]!, edition: null }] });
      e.fire({ type: 'consumableAdded', uid: 900, defId: PRANOSTIKY[0]! });
    },
    after: (e) => {
      e.set({ consumables: [{ uid: 901, defId: PRANOSTIKY.at(-1)!, edition: null }] });
      e.fire({ type: 'consumableAdded', uid: 901, defId: PRANOSTIKY.at(-1)! });
    },
  },
  notarized: {
    before: (e) => {
      const ids = e.ranks([2, 3, 4, 5, 6]);
      e.cards([ids[0]!], { seal: 'gold' })
        .cards([ids[1]!], { seal: 'red' })
        .cards([ids[2]!], { seal: 'blue' });
      e.cards([ids[3]!], { seal: 'blue' }).play({ type: 'straight', scoringIds: ids });
    },
    after: (e) => {
      const ids = e.ranks([2, 3, 4, 5, 6]);
      e.cards([ids[3]!], { seal: 'purple' }).play({ type: 'straight', scoringIds: ids });
    },
  },
  lucky_shards: {
    setup: (e) => void (e.p.stats.totals.glassBroken = 9),
    before: (e) => void e.play({ steps: [] }),
    after: (e) => void e.play({ steps: [glassStep(e.run.deck[0]!.id)] }),
  },
  iron_curtain: {
    before: (e) => {
      const ids = e.ranks([7, 8, 9, 10, 11]);
      e.cards(ids.slice(0, 4), { enhancement: 'steel' });
      e.play({ steps: ids.slice(0, 3).map(heldStep) });
      // čtvrtá „držená“ karta bez oceli nestačí
      e.play({ steps: [...ids.slice(0, 3), ids[4]!].map(heldStep) });
    },
    after: (e) => void e.play({ steps: e.ranks([7, 8, 9, 10]).map(heldStep) }),
  },
  stone_wall: {
    before: (e) => {
      const ids = e.ranks([2, 3, 4, 5, 6]);
      e.cards(ids.slice(0, 4), { enhancement: 'stone' }).play({ type: 'high_card', playedIds: ids });
      e.play({ type: 'high_card', playedIds: ids.slice(0, 4) });
    },
    after: (e) => {
      const ids = e.ranks([2, 3, 4, 5, 6]);
      e.cards(ids, { enhancement: 'stone' }).play({ type: 'high_card', playedIds: ids });
    },
  },

  // ── balíčky ──
  pub_crawl: {
    setup: (e) => {
      for (const id of DECK_IDS) if (id !== 'pub') e.p.stats.byDeck[id] = { played: 1, won: 1, bestStake: 1 };
    },
    before: (e) => void e.roundWon(),
    after: (e) => void e.win(),
  },
  flek_re_tutti: deckCase('marias'),
  installment_plan: deckCase('debtor'),
  fairy_court: deckCase('court'),

  // ── síla piva ──
  warmed_up: stakeCase(2),
  twelve_standing: stakeCase(3),
  special_care: stakeCase(4),
  five_beers: stakeCase(5),
  bock_on_side: stakeCase(6),
  double_hit: stakeCase(7),
  tap_emperor: stakeCase(8),
  district_legend: {
    start: (e) => void e.start({ stake: 7 }),
    setup: (e) => {
      for (const id of DECK_IDS.filter((d) => d !== 'pub').slice(0, 3))
        e.p.stats.byDeck[id] = { played: 1, won: 1, bestStake: 8 };
    },
    before: (e) => void e.win(),
    after: (e) => {
      e.start({ stake: 8 });
      e.win();
    },
  },

  // ── výzvy ──
  challenger: {
    start: (e) => void e.start({ challengeId: CHALLENGE_IDS[0]! }),
    before: (e) => void e.lose(),
    after: (e) => {
      e.start({ challengeId: CHALLENGE_IDS[0]! });
      e.win();
    },
  },
  decathlon: {
    start: (e) => void e.start({ challengeId: CHALLENGE_IDS[0]! }),
    setup: (e) => {
      for (const id of CHALLENGE_IDS.slice(1, 10)) e.p.stats.challenges[id] = { ...done };
    },
    before: (e) => void e.lose(),
    after: (e) => {
      e.start({ challengeId: CHALLENGE_IDS[0]! });
      e.win();
    },
  },
  national_champion: {
    start: (e) => void e.start({ challengeId: CHALLENGE_IDS[0]! }),
    setup: (e) => {
      for (const id of CHALLENGE_IDS.slice(1)) e.p.stats.challenges[id] = { ...done };
    },
    before: (e) => void e.lose(),
    after: (e) => {
      e.start({ challengeId: CHALLENGE_IDS[0]! });
      e.win();
    },
  },

  // ── sbírka ──
  coaster_collector: {
    setup: (e) => void (e.p.discovered.jokers = JOKER_IDS.slice(0, 49)),
    before: (e) => void e.jokers([e.joker(JOKER_IDS[0]!)]),
    after: (e) => void e.jokers([e.joker(JOKER_IDS[49]!)]),
  },
  joker_museum: {
    setup: (e) => void (e.p.discovered.jokers = JOKER_IDS.slice(0, -1)),
    before: (e) => void e.jokers([e.joker(JOKER_IDS[0]!)]),
    after: (e) => void e.jokers([e.joker(JOKER_IDS.at(-1)!)]),
  },
  voucher_maniac: {
    before: (e) => {
      const ids = Object.keys(reg.vouchers).slice(0, 7);
      e.set({ vouchers: ids }).fire({ type: 'voucherRedeemed', voucherId: ids.at(-1)! });
    },
    after: (e) => {
      const ids = Object.keys(reg.vouchers).slice(0, 8);
      e.set({ vouchers: ids }).fire({ type: 'voucherRedeemed', voucherId: ids.at(-1)! });
    },
  },

  // ── meta ──
  morning_exercise: {
    start: (e) => void e.daily(NOW),
    before: (e) => void e.ante(2),
    after: (e) => void e.ante(3),
  },
  week_straight: {
    start: (e) => {
      // oficiální denní pokusy 26.–30. 9.; 1. 10. je šestý den v řadě
      for (const d of ['20260926', '20260927', '20260928', '20260929', '20260930']) {
        e.p.daily[d] = {
          seed: `DEN-${d}`,
          deckId: 'pub',
          stake: 1,
          status: 'finished',
          outcome: 'lost',
          ante: 2,
          bestHand: 100,
          startedAt: NOW,
          finishedAt: NOW,
        };
      }
      e.daily('2026-10-01T10:00:00.000Z');
    },
    before: (e) => void e.finish(),
    after: (e) => void e.daily(NOW),
  },
  seed_sown: {
    before: (e) => {
      e.finish();
      e.start({ seed: 'XYZW2345' });
    },
    after: (e) => void e.start({ seed: 'SEMI2345' }, { seeded: true }),
  },
  pub_inventory: {
    setup: (e) => void (e.p.stats.runs.played = 98),
    before: (e) => void e.finish(),
    after: (e) => {
      e.start();
      e.finish();
    },
  },
  regulars_apprentice: {
    before: (e) => {
      for (const step of TUTORIAL_STEPS.slice(0, -1)) markTutorialStep(e.p, step);
      e.refresh();
    },
    after: (e) => {
      markTutorialStep(e.p, TUTORIAL_STEPS.at(-1)!);
      e.refresh();
    },
  },

  // ── kuriozity ──
  quick_beer: {
    before: (e) => {
      e.set({ ante: 2 }).lose({ ante: 2, blind: 'small' });
      e.start();
      e.lose({ ante: 1, blind: 'big', cause: 'big' });
    },
    after: (e) => {
      e.start();
      e.lose({ ante: 1, blind: 'small' });
    },
  },
  by_a_hair: {
    before: (e) => void e.lose({ score: 990, target: 1000 }),
    after: (e) => {
      e.start();
      e.lose({ score: 991, target: 1000 });
    },
  },
  one_blow: {
    before: (e) => {
      e.round({ handsPlayed: 1 }).roundWon(400, 300, 'small');
      e.round({ handsPlayed: 2 }).roundWon(400, 300, 'boss');
    },
    after: (e) => void e.round({ handsPlayed: 1 }).roundWon(400, 300, 'boss'),
  },
  nothing_wasted: {
    before: (e) => void e.stats({ discardsUsed: 1 }).win(),
    after: (e) => {
      e.start();
      e.win();
    },
  },
  papers_in_order: {
    before: (e) => {
      e.set({ money: 19 }).boss('tax_audit');
      e.set({ money: 25 }).boss('inventory');
    },
    after: (e) => void e.set({ money: 20 }).boss('tax_audit'),
  },
  shortcut: {
    before: (e) =>
      void e.stats({ blindsSkipped: 7 }).fire({ type: 'blindSkipped', blind: 'small', tagId: null }),
    after: (e) =>
      void e.stats({ blindsSkipped: 8 }).fire({ type: 'blindSkipped', blind: 'big', tagId: null }),
  },
};

// ─────────────────────────── Obsah a texty ───────────────────────────

describe('obsah achievementů', () => {
  it('78 achievementů s unikátním id, platnou kategorií a ikonou z ICON_NAMES; v registru', () => {
    expect(ACHIEVEMENTS).toHaveLength(78);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(reg.achievements ?? {})).toEqual(ids);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z0-9_]+$/);
      expect(ACHIEVEMENT_CATEGORIES, a.id).toContain(a.category);
      expect(ICON_NAMES as readonly string[], a.id).toContain(a.icon);
    }
    for (const c of ACHIEVEMENT_CATEGORIES)
      expect(
        ACHIEVEMENTS.some((a) => a.category === c),
        c,
      ).toBe(true);
  });

  it('skryté jsou přesně ty z DESIGN 11.2; jen „Semínko zaseto“ jde získat v seedovaném runu', () => {
    expect(ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id)).toEqual([
      'heat_death',
      'five_committee',
      'color_tv',
      'like_two_eggs',
      'office_copier',
      'july_snowman',
      'quick_beer',
      'by_a_hair',
    ]);
    expect(ACHIEVEMENTS.filter((a) => a.allowSeeded).map((a) => a.id)).toEqual(['seed_sown']);
  });

  it('texty: název (max 5 slov), podmínka a hláška; skryté navíc nápověda; parametry beze zbytku', () => {
    const texts = cs.achievements as Record<string, Record<string, string>>;
    expect(Object.keys(texts).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
    for (const a of ACHIEVEMENTS) {
      for (const field of ['name', 'desc', 'flavor'] as const) {
        expect(hasKey(`achievements.${a.id}.${field}`), `${a.id}.${field}`).toBe(true);
      }
      expect(hasKey(`achievements.${a.id}.hint`), `${a.id}.hint`).toBe(!!a.hidden);
      expect(t(`achievements.${a.id}.name`).split(/[\s\u00a0]+/).length, a.id).toBeLessThanOrEqual(5);
      for (const field of ['desc', 'hint', 'flavor']) {
        if (!hasKey(`achievements.${a.id}.${field}`)) continue;
        const text = t(`achievements.${a.id}.${field}`, a.params);
        expect(text, `${a.id}.${field}`).not.toMatch(/[{}⟦⟧]/);
        expect(text, `${a.id}.${field}`).toMatch(/[.!?…]$/);
      }
    }
  });

  it('názvy ze zadání (CLAUDE.md kap. 5) a čísla v textu z params', () => {
    const name = (id: string) => t(`achievements.${id}.name`).replace(/\u00a0/g, ' ');
    expect(name('five_beers')).toBe('Pět piv a jdu domů');
    expect(name('on_the_tab')).toBe('Na sekeru');
    expect(name('regulars_apprentice')).toBe('Štamgastův žák');
    expect(name('seed_sown')).toBe('Semínko zaseto');
    const def = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;
    expect(t('achievements.score_1m.desc', def('score_1m').params)).toBe(
      'Získej jednou rukou aspoň 1\u00a0000\u00a0000\u00a0bodů.',
    );
    expect(t('achievements.stuffed_piggy.desc', def('stuffed_piggy').params)).toBe(
      'Měj najednou aspoň 50\u00a0Kč.',
    );
    expect(t('achievements.like_water.desc', def('like_water').params)).toContain('×5');
  });
});

// ─────────────────────────── Každý achievement: přesně při splnění ───────────────────────────

describe('každý achievement se odemkne přesně při splnění, ne dřív', () => {
  it('každý achievement má testovací případ', () => {
    expect(Object.keys(CASES).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  for (const def of ACHIEVEMENTS) {
    it(def.id, () => {
      const c = CASES[def.id]!;
      const e = new Env();
      if (c.start) c.start(e);
      else e.start();
      c.setup?.(e);
      expect(e.has(def.id), 'splněno už po přípravě').toBe(false);
      c.before(e);
      expect(e.has(def.id), 'odemčeno dřív, než je podmínka splněná').toBe(false);
      c.after(e);
      expect(e.has(def.id), 'po splnění chybí').toBe(true);
      expect(e.p.achievements.unlocked[def.id]).toBe(e.ctx.nowIso);
      expect(e.last).toContainEqual({ kind: 'achievement', id: def.id });
      expect(e.p.unseen).toContain(`achievements:${def.id}`);
    });
  }
});

describe('hraniční případy', () => {
  it('Abstinent: s žolíkem kdykoli v runu ne', () => {
    const e = new Env();
    e.start();
    e.jokers([e.joker('beer_mat')]);
    e.set({ jokers: [] }).fire({ type: 'jokerSold', uid: 1, defId: 'beer_mat', price: 2 });
    e.ante(4);
    expect(e.has('abstainer')).toBe(false);
  });

  it('Plný lokál: s balíčkem o 6 slotech 5 žolíků nestačí', () => {
    const e = new Env();
    e.start({ deckId: 'regulars' });
    const five = ['beer_mat', 'hearts_man', 'gravedigger', 'crusader', 'early_bird'];
    e.jokers(five.map((id) => e.joker(id)));
    expect(e.has('packed_pub')).toBe(false);
    e.jokers([...five, 'night_shift'].map((id) => e.joker(id)));
    expect(e.has('packed_pub')).toBe(true);
  });

  it('Jak z vody: ×mult žolík (Sběrač hub) od ×5', () => {
    const e = new Env();
    e.start();
    // +×0,18 za kartu (kalibrace 1.0.1): 22 karet = ×4,96, 23 karet = ×5,14.
    e.jokers([e.joker('mushroom_picker', { state: { destroyed: 22 } })]);
    expect(e.has('like_water')).toBe(false);
    e.jokers([e.joker('mushroom_picker', { state: { destroyed: 23 } })]);
    expect(e.has('like_water')).toBe(true);
  });

  it('Ranní rozcvička: patro 3 v hlavní hře ani v denním runu mimo soutěž nestačí', () => {
    const e = new Env();
    e.start();
    e.ante(3);
    expect(e.has('morning_exercise')).toBe(false);
    e.daily(NOW);
    e.finish();
    e.daily(NOW); // druhý pokus dne = mimo soutěž
    expect(e.p.current?.official).toBe(false);
    e.ante(3);
    expect(e.has('morning_exercise')).toBe(false);
  });

  it('seedovaný run: jen „Semínko zaseto“, i po výhře s velkou rukou', () => {
    const e = new Env();
    expect(e.start({ deckId: 'marias' }, { seeded: true })).toEqual([
      { kind: 'achievement', id: 'seed_sown' },
    ]);
    e.play({ score: 5e6, type: 'royal_flush' });
    e.roundWon(10_000, 300);
    e.boss('tax_audit');
    e.win();
    expect(Object.keys(e.p.achievements.unlocked)).toEqual(['seed_sown']);
  });

  it('čistý profil a start běžného runu nic neudělí', () => {
    const e = new Env();
    expect(e.refresh()).toEqual([]);
    expect(e.start()).toEqual([]);
    expect(e.finish()).toEqual([]);
  });

  it('průběh pro sbírku: celoživotní z profilu, jednoho runu jako uložené maximum', () => {
    const e = new Env();
    e.start();
    e.p.stats.totals.pranostikyUsed = 30;
    expect(achievementProgress(e.p, e.ctx, 'tree_frog')).toEqual({ progress: 30, target: 50 });
    e.stats({ blindsSkipped: 5 }).fire({ type: 'blindSkipped', blind: 'small', tagId: null });
    e.finish();
    expect(achievementProgress(e.p, e.ctx, 'shortcut')).toEqual({ progress: 5, target: 8 });
    expect(achievementProgress(e.p, e.ctx, 'first_round')).toBeNull();
  });

  it('import profilu s výhrami udělí achievementy zpětně (refreshMeta)', () => {
    const e = new Env();
    e.p.stats.runs.won = 1;
    e.p.stats.byDeck.marias = { played: 1, won: 1, bestStake: 5 };
    const ids = e.refresh().map((n) => (n.kind === 'achievement' ? n.id : null));
    expect(ids).toEqual(expect.arrayContaining(['closing_time', 'flek_re_tutti', 'five_beers', 'warmed_up']));
    expect(e.has('bock_on_side')).toBe(false);
  });
});

describe('celý run botem s achievementy', () => {
  function play(seed: string): Profile {
    const profile = createProfile(NOW);
    const ctx: MetaCtx = { registry: reg, nowIso: NOW };
    const game = Game.newRun({ seed, deckId: 'pub', stake: 1 }, reg);
    startRun(profile, game.state, ctx);
    const bot = createBot('max');
    for (let i = 0; i < 4000; i++) {
      const phase = game.state.phase;
      if (phase === 'game_over' || phase === 'victory') break;
      let res = game.dispatch(bot.decide(game));
      if (!res.ok)
        res = game.dispatch(
          phase === 'shop'
            ? { type: 'leaveShop' }
            : phase === 'booster'
              ? { type: 'skipBooster' }
              : { type: 'cashOut' },
        );
      if (res.ok) applyRunEvents(profile, res.events, game.state, ctx);
    }
    finishRun(profile, game.state, ctx);
    return profile;
  }

  it('udělí aspoň první kolo, je deterministický a profil projde uložením', () => {
    const profile = play('ACHB2345');
    expect(profile.achievements.unlocked.first_round).toBe(NOW);
    expect(deserializeProfile(serializeProfile(profile, NOW))).toEqual(profile);
    expect(play('ACHB2345')).toEqual(profile);
  });
});
