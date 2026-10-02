/**
 * npx tsx scripts/joker-value.ts [--runs 60] [--seed-prefix JV] [--joker id,…] [--bot auto|max|flush|pairs]
 *                                [--deck pub] [--stake 1] [--r2-level 4] [--json [soubor]]
 *
 * Měření hodnoty žolíků podle docs/DESIGN.md 4.2–4.3 (vývojářský nástroj, výstup česky).
 *
 * Pro každého žolíka a každý seed `JV-<prefix>-<i>`:
 * 1. **Základní run** — bot („vhodná strategie“: barevní žolíci → `flush`, žolíci na Dvojici → `pairs`, jinak `max`)
 *    odehraje run bez zásahu (sdílený mezi žolíky téhož bota).
 * 2. **Větev se žolíkem** — stejný run do bodu koupě (začátek patra 1; škálující žolíci začátek patra 2 podle
 *    DESIGN 4.2), tam se žolík vloží do volného slotu (jako po koupi, ale zdarma; prvních `MIN_HOLD_ROUNDS` kol
 *    ho bot nesmí prodat) a bot hraje dál. Bot žolíka zná — hraje s ním (přesné skóre tahů se žolíky).
 * 3. **Každá ruka větve** (karty v ruce v okamžiku, kdy bot hrál; bez rukou, kdy byl žolík mimo provoz kvůli šéfovi)
 *    se přepočítá na kopiích stavu se stejným RNG:
 *    nejlepší tah jen se žolíkem proti nejlepšímu tahu bez žolíků (bez karet a čipů karet, které žolík přinesl).
 *    Izolovaný efekt (Δčipy, Δmult, nebo ×mult u žolíků se štítkem `xmult`) se promítne na referenční ruce
 *    DESIGN 4.2: `navýšení = (Rč + Δč)(Rm + Δm)·×/(Rč·Rm) − 1`, R1 = 60 × 8 (patra 1–3), R2 = 200 × 40.
 *    - R1: ruce z pater 1–3, úrovně kombinací střídavě 1 a 2 (definice R1);
 *    - R2: všechny ruce větve (runy patra 6–8 zatím skoro nedosáhnou), úrovně kombinací `--r2-level`
 *      (bez pranostik zůstávají na 1 — odhad do fáze 5); škálující žolíci mají stav lineárně extrapolovaný
 *      na 16 dokončených kol od koupě (koupě v patře 2, průměr pater 6–8) — počítadla žolíka i čipy karet;
 *    - kopírující žolíci (štítek `copy`) se izolovat nedají: počítá se poměr skóre skutečné sestavy s ním / bez něj;
 *    - „reálně“ = poměr skóre skutečné sestavy bota se žolíkem / bez něj (bez něj = lepší ze stejných karet a tahu,
 *      který by bot bez žolíka zahrál; skutečné úrovně, informativně).
 * 4. **Ekonomika**: Kč z rozpisu odměn připsané žolíkovi / počet kol, kdy byl ve slotu.
 * 5. **Simulace**: rozdíl dosaženého patra, vyhraných kol a výher větve se žolíkem proti základnímu runu
 *    (párově na stejných seedech; jen runy, které bodu koupě dosáhly).
 *
 * Pásma a pravidla 1–3 tabulky 4.3 hlídá `verdict` (dolní hranice aspoň v jednom okně, horní v žádném,
 * špička — 95. percentil rukou okna R2 — nejvýš 2× horní hranice). Nástroj je deterministický.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { registry as contentRegistry } from '../src/content/index';
import type { ContentRegistry, JokerDef, JokerRarity } from '../src/engine/content-types';
import { addJokerInstance, newJokerInstance } from '../src/engine/effects/api';
import { createRngStates } from '../src/engine/rng/rng';
import { Game } from '../src/engine/run/game';
import {
  cardValue,
  createBot,
  DEFAULT_MAX_ACTIONS,
  fallbackAction,
  makeEnv,
  MAX_CONSECUTIVE_INVALID,
  planCandidates,
} from '../src/engine/sim/index';
import type { Bot, BotName } from '../src/engine/sim/index';
import type { Action, Card, HandType, JokerInstance, RunState, ScoreResult } from '../src/engine/types';
import { HAND_TYPES } from '../src/engine/types';
import { hasKey, t } from '../src/i18n/cs';

// ─────────────────────────── Konstanty DESIGN 4.2–4.3 ───────────────────────────

/** Referenční ruce (DESIGN 4.2): R1 patra 1–3, R2 patra 6–8 (souhrnný ×3 ostatních žolíků se v poměru zkrátí). */
export const REFERENCE = {
  r1: { chips: 60, mult: 8 },
  r2: { chips: 200, mult: 40 },
} as const;

type Range = readonly [number, number];

export interface Band {
  /** Navýšení vůči R1 v % (patra 1–3). */
  r1: Range;
  /** Navýšení vůči R2 v % (patra 6–8). */
  r2: Range;
  /** Ekonomika Kč/kolo (legendární nemají). */
  money: Range | null;
  /** Δ výher v simulaci (p. b.). */
  sim: Range;
}

/** Cílová pásma podle vzácnosti (DESIGN 4.3). */
export const BANDS: Readonly<Record<JokerRarity, Band>> = {
  common: { r1: [35, 100], r2: [8, 30], money: [2, 3], sim: [2, 6] },
  rare: { r1: [50, 130], r2: [20, 60], money: [3, 5], sim: [4, 10] },
  epic: { r1: [80, 180], r2: [45, 110], money: [5, 7], sim: [7, 15] },
  legendary: { r1: [150, 350], r2: [100, 300], money: null, sim: [12, 25] },
};

/** Poslední patro okna R1. */
const R1_LAST_ANTE = 3;
/** Kol od koupě v patře 2 do průměru pater 6–8 (3 kola na patro: 12 … 20, průměr 16). */
export const R2_ROUNDS_HELD = 16;
/** Patro koupě škálujících žolíků (DESIGN 4.2: „koupě v patře 2 → patro 8“). */
const SCALING_BUY_ANTE = 2;

const PAIR_FAMILY: readonly string[] = ['pair', 'two_pair', 'three', 'full_house', 'four', 'five'];

// ─────────────────────────── Typy výsledku ───────────────────────────

export interface Effect {
  chips: number;
  mult: number;
  xmult: number;
}

export interface WindowValue {
  /** Počet změřených rukou. */
  hands: number;
  /** Průměrné navýšení v % (null = žádná ruka). */
  avg: number | null;
  /** Špička: 95. percentil navýšení jednotlivých rukou v % (`PEAK_PERCENTILE`). */
  peak: number | null;
  /** Nejvyšší navýšení jedné ruky v % (informativně). */
  max: number | null;
  /** Podíl rukou, ve kterých žolík skóre změnil (0–1). */
  fired: number;
  /** Průměrný izolovaný efekt na ruku. */
  effect: Effect;
}

export interface SimDelta {
  runs: number;
  anteWith: number;
  anteWithout: number;
  roundsWith: number;
  roundsWithout: number;
  winsWith: number;
  winsWithout: number;
}

export interface JokerValue {
  id: string;
  rarity: JokerRarity;
  tags: string[];
  bot: BotName;
  buyAnte: number;
  /** Izolovaný efekt nejde změřit (kopírování) — R1/R2 jsou poměry skutečné sestavy. */
  realMode: boolean;
  r1: WindowValue;
  r2: WindowValue;
  /** Poměr skóre skutečné sestavy s žolíkem / bez něj (všechny ruce, skutečné úrovně), %. */
  real: number | null;
  /** Kč/kolo z rozpisu odměn (null = žolík peníze nedává). */
  money: { all: number; r1: number; rounds: number } | null;
  sim: SimDelta;
}

export type VerdictKind = 'ok' | 'low' | 'high' | 'peak' | 'na';

export interface Verdict {
  kind: VerdictKind;
  /** Podle čeho se hodnotilo. */
  basis: 'hand' | 'money' | 'sim';
}

// ─────────────────────────── Projekce na referenční ruku ───────────────────────────

/** Navýšení referenční ruky efektem žolíka v % (DESIGN 4.2). */
export function projectValue(ref: { chips: number; mult: number }, e: Effect): number {
  return (((ref.chips + e.chips) * (ref.mult + e.mult) * e.xmult) / (ref.chips * ref.mult) - 1) * 100;
}

/**
 * Izolovaný efekt z výsledku ruky bez žolíka (`base`, null = bez žolíka nejde zahrát nic) a s ním. Žolíci se
 * štítkem `xmult` násobí (× = poměr multu), ostatní přičítají (Δmult); čipy vždy jako rozdíl.
 */
export function effectOf(def: JokerDef, base: ScoreResult | null, withJ: ScoreResult): Effect {
  if (!base) return { chips: withJ.chips, mult: 0, xmult: 1 };
  const chips = withJ.chips - base.chips;
  if (def.tags.includes('xmult'))
    return { chips, mult: 0, xmult: base.mult > 0 ? withJ.mult / base.mult : 1 };
  return { chips, mult: withJ.mult - base.mult, xmult: 1 };
}

// ─────────────────────────── Volby ───────────────────────────

export interface JokerValueOptions {
  runs: number;
  seedPrefix: string;
  deck: string;
  stake: number;
  /** null = podle štítků žolíka. */
  bot: BotName | null;
  /** Úroveň všech kombinací v okně R2. */
  r2Level: number;
  maxActions?: number;
}

export const DEFAULT_OPTIONS: JokerValueOptions = {
  runs: 60,
  seedPrefix: 'JV',
  deck: 'pub',
  stake: 1,
  bot: null,
  r2Level: 4,
};

/** Bot „vhodné strategie“ pro žolíka (DESIGN 4.2: strategie, která žolíka rozumně podporuje). */
export function botFor(def: JokerDef): BotName {
  if (def.tags.includes('suit')) return 'flush';
  const hands = Object.values(def.params ?? {}).filter((v): v is string => typeof v === 'string');
  if (hands.some((h) => PAIR_FAMILY.includes(h))) return 'pairs';
  return 'max';
}

const isScaling = (def: JokerDef): boolean => def.tags.includes('scaling');

// ─────────────────────────── Řízení runu ───────────────────────────

/** Bot, který měřeného žolíka neprodá (místo prodeje odejde z Večerky), dokud ho drží `MIN_HOLD_ROUNDS` kol. */
class KeepJokerBot implements Bot {
  readonly name: string;
  released = false;
  constructor(
    private readonly inner: Bot,
    private readonly uid: number,
  ) {
    this.name = inner.name;
  }
  decide(game: Game): Action {
    const a = this.inner.decide(game);
    if (!this.released && a.type === 'sellJoker' && a.uid === this.uid) return { type: 'leaveShop' };
    return a;
  }
}

/**
 * Žolík je ve slotu aspoň tolik kol (DESIGN 4.3, pravidlo 4: „žolík byl ve slotu aspoň 6 kol“); potom ho bot
 * smí prodat jako kteréhokoli jiného (ekonomické žolíky hráč v pozdní hře prodává).
 */
export const MIN_HOLD_ROUNDS = 6;

interface Driver {
  game: Game;
  actions: number;
  streak: number;
  maxActions: number;
}

const ended = (g: Game): boolean => g.state.phase === 'game_over' || g.state.phase === 'victory';

/**
 * Jedna akce bota (s pojistkou proti zacyklení jako `simulateRun`). `before` dostane akci před odesláním,
 * `after` události. Vrací false, když run skončil nebo došly akce.
 */
function step(
  d: Driver,
  bot: Bot,
  before?: (a: Action) => void,
  after?: (events: ReturnType<Game['dispatch']>) => void,
): boolean {
  if (ended(d.game) || d.actions >= d.maxActions) return false;
  const action = d.streak >= MAX_CONSECUTIVE_INVALID ? fallbackAction(d.game) : bot.decide(d.game);
  before?.(action);
  const res = d.game.dispatch(action);
  d.actions++;
  d.streak = res.ok ? 0 : d.streak + 1;
  after?.(res);
  return true;
}

interface RunOutcome {
  ante: number;
  rounds: number;
  won: boolean;
}

const outcome = (g: Game): RunOutcome => ({
  ante: g.state.gameOver?.ante ?? g.state.ante,
  rounds: g.state.stats.roundsWon,
  won: g.state.phase === 'victory',
});

/** Základní run: stav v bodech koupě (patro 1 a 2) a výsledek. Sdílí se mezi žolíky téhož bota. */
interface BaseRun {
  seed: string;
  /** Uložený stav na začátku patra (klíč = patro), pokud ho run dosáhl. */
  snapshots: Map<number, string>;
  /** Akce spotřebované do snímku. */
  actionsAt: Map<number, number>;
  result: RunOutcome;
}

const atBuyPoint = (g: Game, ante: number): boolean =>
  g.state.phase === 'blind_select' && g.state.ante === ante && g.state.blindIndex === 0;

function baseRun(reg: ContentRegistry, opts: JokerValueOptions, botName: BotName, seed: string): BaseRun {
  const game = Game.newRun({ seed, deckId: opts.deck, stake: opts.stake }, reg);
  const d: Driver = { game, actions: 0, streak: 0, maxActions: opts.maxActions ?? DEFAULT_MAX_ACTIONS };
  const bot = createBot(botName);
  const snapshots = new Map<number, string>();
  const actionsAt = new Map<number, number>();
  const snap = (): void => {
    for (const ante of [1, SCALING_BUY_ANTE])
      if (!snapshots.has(ante) && atBuyPoint(game, ante)) {
        snapshots.set(ante, JSON.stringify(game.state));
        actionsAt.set(ante, d.actions);
      }
  };
  snap();
  while (step(d, bot)) snap();
  return { seed, snapshots, actionsAt, result: outcome(game) };
}

// ─────────────────────────── Přepočet ruky na kopii ───────────────────────────

interface Scored {
  result: ScoreResult;
  /** Čipy navíc každé karty balíčku po zahrání (id → bonusChips). */
  bonus: Map<number, number>;
}

/**
 * Zahraje karty na kopii uloženého stavu upravené funkcí `mutate` (vrací id karet k zahrání, null = nehrát)
 * s pevným RNG (`rngSeed`) — kopie se žolíkem a bez něj tak mají stejné hody. Vrací výsledek ruky, nebo null.
 */
function scoreOn(
  reg: ContentRegistry,
  snap: string,
  rngSeed: string,
  mutate: (s: RunState) => number[] | null,
): Scored | null {
  const state = JSON.parse(snap) as RunState;
  state.rng = createRngStates(rngSeed);
  const ids = mutate(state);
  if (!ids || ids.length === 0) return null;
  const game = Game.fromState(state, reg);
  const res = game.dispatch({ type: 'play', cardIds: ids });
  if (!res.ok) return null;
  for (const e of res.events)
    if (e.type === 'handPlayed')
      return { result: e.result, bonus: new Map(game.state.deck.map((c) => [c.id, c.bonusChips])) };
  return null;
}

function setLevels(s: RunState, level: number): void {
  for (const type of HAND_TYPES as readonly HandType[]) {
    const hl = s.handLevels[type];
    if (hl) hl.level = level;
  }
}

/**
 * Tah „bez žolíka“: lepší ze (a) stejných karet a (b) nejlepších tahů, které by bot ve světě bez žolíka (ale s jeho
 * ostatními žolíky a skutečnými úrovněmi) zahrál — odhad `planCandidates`, přesně přepočítaných `alternatives`
 * nejlepších. Bez (b) by žolíci, kvůli kterým bot hraje jinak (Kolotoč, Pan vrchní), dostali i hodnotu tahu, který
 * by bez nich nikdo nezahrál. `world` připraví stav světa bez žolíka, `ids` jsou stejné karty (null = nejde nic).
 */
function chooseWithout(
  reg: ContentRegistry,
  s: HandSample,
  world: (st: RunState) => void,
  ids: number[] | null,
  alternatives: number,
): Scored | null {
  let best = ids ? scoreOn(reg, s.snap, s.rngSeed, (st) => (world(st), ids)) : null;
  const state = JSON.parse(s.snap) as RunState;
  world(state);
  const game = Game.fromState(state, reg);
  const round = game.state.round;
  if (!round || alternatives <= 0) return best;
  const env = makeEnv(game);
  const hand = round.hand.flatMap((id) => {
    const c = game.card(id);
    return c ? [cardValue(c, env)] : [];
  });
  const key = (xs: readonly number[]): string => [...xs].sort((x, y) => x - y).join(',');
  const sameKey = ids ? key(ids) : '';
  const cands = planCandidates(game, hand, env, [])
    .sort((x, y) => y.raw - x.raw)
    .filter((c) => key(c.ids) !== sameKey)
    .slice(0, alternatives);
  for (const c of cands) {
    const r = scoreOn(reg, s.snap, s.rngSeed, (st) => (world(st), c.ids));
    if (r && (!best || r.result.score > best.result.score)) best = r;
  }
  return best;
}

/**
 * Nejlepší tah z ruky snímku ve světě `world` (izolovaně: jen měřený žolík, nebo žádný): kandidáti = tahy
 * z `include` (tah, který bot skutečně zahrál) + `k` nejlepších odhadů `planCandidates`, každý přesně přepočítaný.
 * Izolovaný efekt se tak měří mezi nejlepším tahem se žolíkem a nejlepším tahem bez něj ze stejné ruky — bez vlivu
 * ostatních žolíků bota na výběr tahu (Pan vrchní, Kolotoč i Tělocvikář tak dostanou jen to, co opravdu přidají).
 */
function bestPlay(
  reg: ContentRegistry,
  s: HandSample,
  world: (st: RunState) => void,
  include: readonly (number[] | null)[],
  k: number,
): Scored | null {
  const state = JSON.parse(s.snap) as RunState;
  world(state);
  const game = Game.fromState(state, reg);
  const round = game.state.round;
  const lists: number[][] = include.filter((x): x is number[] => Boolean(x && x.length > 0));
  if (round) {
    const env = makeEnv(game);
    const hand = round.hand.flatMap((id) => {
      const c = game.card(id);
      return c ? [cardValue(c, env)] : [];
    });
    for (const c of planCandidates(game, hand, env, [])
      .sort((x, y) => y.raw - x.raw)
      .slice(0, k))
      lists.push(c.ids);
  }
  const seen = new Set<string>();
  let best: Scored | null = null;
  for (const ids of lists) {
    const key = [...ids].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = scoreOn(reg, s.snap, s.rngSeed, (st) => (world(st), ids));
    if (r && (!best || r.result.score > best.result.score)) best = r;
  }
  return best;
}

/** Snímek jedné zahrané ruky ve větvi se žolíkem. */
interface HandSample {
  snap: string;
  ids: number[];
  ante: number;
  index: number;
  rngSeed: string;
}

/** Stav žolíka na konci kola (pro extrapolaci škálování): kola od koupě, počítadla, ruce do té doby. */
interface GrowthPoint {
  rounds: number;
  state: Record<string, number>;
  samplesBefore: number;
}

/** Karty balíčku ze snímku ruky. */
const deckOf = (s: HandSample): Card[] => (JSON.parse(s.snap) as RunState).deck;

/** Klíč karty pro sdílení růstu mezi seedy (hodnota + barva; startovní balíček je ve všech runech stejný). */
const cardKey = (c: { suit: string; rank: number }): string => `${c.suit}${c.rank}`;

function numericState(j: JokerInstance): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.state)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

interface BranchData {
  samples: HandSample[];
  uid: number;
  /** Karty přidané žolíkem při získání (Golem) — bez žolíka by v balíčku nebyly. */
  acquired: Set<number>;
  /** Počítadla žolíka v okamžiku vložení. */
  stateAtBuy: Record<string, number>;
  growth: GrowthPoint | null;
  money: { all: number; r1: number; rounds: number; roundsR1: number };
  result: RunOutcome;
}

/** Větev se žolíkem od bodu koupě (uložený stav základního runu). */
function branchRun(
  reg: ContentRegistry,
  opts: JokerValueOptions,
  def: JokerDef,
  botName: BotName,
  base: BaseRun,
  buyAnte: number,
): BranchData | null {
  const snap = base.snapshots.get(buyAnte);
  if (!snap) return null;
  const game = Game.fromState(JSON.parse(snap) as RunState, reg);
  const core = game._core;
  // Žolík zabere normální slot jako po koupi (Bazarník počítá prázdné sloty). Přibitý, aby ho bot neprodal
  // a při plných slotech prodával jiné; žolíci, kteří se sami ničí (`noEternal`), přibití nejsou — prodej
  // jim zakáže `KeepJokerBot`. Když slot není volný, dostane negativní edici (slot navíc).
  const room = game.state.jokers.length < game.modifiers().jokerSlots;
  const negative = room
    ? null
    : (Object.values(reg.editions).find((e) => (e.extraSlots ?? 0) > 0)?.id ?? null);
  const joker = newJokerInstance(core, def.id, negative, def.noEternal ? [] : ['eternal']);
  core.takeEvents();
  addJokerInstance(core, joker, { ignoreSlots: true, acquire: true });
  core.invalidate();
  const acquired = new Set<number>();
  for (const e of core.takeEvents()) if (e.type === 'cardAdded') acquired.add(e.cardId);
  const uid = joker.uid;
  const stateAtBuy = numericState(joker);
  const d: Driver = {
    game,
    actions: base.actionsAt.get(buyAnte) ?? 0,
    streak: 0,
    maxActions: opts.maxActions ?? DEFAULT_MAX_ACTIONS,
  };
  const bot = new KeepJokerBot(createBot(botName), uid);
  const samples: HandSample[] = [];
  const money = { all: 0, r1: 0, rounds: 0, roundsR1: 0 };
  const roundsAtBuy = game.state.stats.roundsWon;
  let growth: GrowthPoint | null = null;
  const held = (): JokerInstance | undefined => game.state.jokers.find((j) => j.uid === uid);
  const before = (a: Action): void => {
    // Ruka, ve které žolík nefunguje (debuff od šéfa — Výpadek proudu, Jednooký hejtman, Exekutor…), o jeho
    // hodnotě nic neříká: měří se jen ruce, kdy je v provozu.
    if (a.type !== 'play' || game.state.phase !== 'round' || !held() || held()!.debuffed) return;
    const index = samples.length;
    samples.push({
      snap: JSON.stringify(game.state),
      ids: [...a.cardIds],
      ante: game.state.ante,
      index,
      rngSeed: `${base.seed}:jv:${def.id}:${index}`,
    });
  };
  const after = (res: ReturnType<Game['dispatch']>): void => {
    if (!res.ok) return;
    for (const e of res.events) {
      if (e.type !== 'roundRewards') continue;
      const j = held();
      const ante = game.state.ante;
      const amount = e.extra.filter((x) => x.jokerUid === uid).reduce((a, x) => a + x.amount, 0);
      // Kolo se počítá, i když žolík po výplatě zmizel (Pokladnička se rozbije až v rozpisu).
      if (j || amount !== 0) {
        money.rounds++;
        money.all += amount;
        if (ante <= R1_LAST_ANTE) {
          money.roundsR1++;
          money.r1 += amount;
        }
      }
      if (j) {
        growth = {
          rounds: game.state.stats.roundsWon - roundsAtBuy,
          state: numericState(j),
          samplesBefore: samples.length,
        };
        if (!bot.released && game.state.stats.roundsWon - roundsAtBuy >= MIN_HOLD_ROUNDS) {
          bot.released = true;
          core.state.jokers.find((x) => x.uid === uid)!.stickers = [];
          core.invalidate();
        }
      }
    }
  };
  while (step(d, bot, before, after));
  return { samples, uid, acquired, stateAtBuy, growth, money, result: outcome(game) };
}

// ─────────────────────────── Měření žolíka ───────────────────────────

interface Acc {
  values: number[];
  fired: number;
  chips: number;
  mult: number;
  xmult: number;
}

const newAcc = (): Acc => ({ values: [], fired: 0, chips: 0, mult: 0, xmult: 0 });

function addSample(acc: Acc, value: number, e: Effect): void {
  acc.values.push(value);
  if (Math.abs(value) > 1e-9) acc.fired++;
  acc.chips += e.chips;
  acc.mult += e.mult;
  acc.xmult += e.xmult;
}

/** Percentil (0–1) seřazených hodnot, lineární interpolace. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Percentil „špičky“: ideální, ale ne výjimečná ruka (max jedné ruky je jen šum vzorku). */
export const PEAK_PERCENTILE = 0.95;

function windowValue(acc: Acc): WindowValue {
  const n = acc.values.length;
  const sorted = [...acc.values].sort((a, b) => a - b);
  return {
    hands: n,
    avg: n ? acc.values.reduce((a, b) => a + b, 0) / n : null,
    peak: n ? percentile(sorted, PEAK_PERCENTILE) : null,
    max: n ? sorted[n - 1]! : null,
    fired: n ? acc.fired / n : 0,
    effect: n
      ? { chips: acc.chips / n, mult: acc.mult / n, xmult: acc.xmult / n }
      : { chips: 0, mult: 0, xmult: 1 },
  };
}

/** Kolik nejlepších jiných tahů (podle odhadu bez žolíků) se ve světě bez žolíka přepočítá přesně. */
const ALTERNATIVES = 2;
/** Kandidáti nejlepšího tahu izolovaně: se žolíkem (odhad žolíka nezná, proto víc) a bez žolíků (odhad je přesný). */
const WITH_CANDIDATES = 3;
const WITHOUT_CANDIDATES = 1;

/** Svět bez žolíka: bez čipů, které kartám přidal (`jb`), a bez karet, které přinesl, v ruce. */
function strip(st: RunState, br: BranchData, jb: ReadonlyMap<number, number>): void {
  for (const c of st.deck) c.bonusChips -= jb.get(c.id) ?? 0;
  if (st.round && br.acquired.size > 0) st.round.hand = st.round.hand.filter((id) => !br.acquired.has(id));
}

/** Stejné karty ve světě bez žolíka (bez karet, které přinesl); null = nezbylo nic. */
function withoutIds(br: BranchData, s: HandSample): number[] | null {
  const ids = s.ids.filter((id) => !br.acquired.has(id));
  return ids.length > 0 ? ids : null;
}

/** Sdílené základní runy (bot → seed → run). */
export type BaseCache = Map<string, BaseRun>;

/** Změří jednoho žolíka (DESIGN 4.2–4.3). */
export function measureJoker(
  reg: ContentRegistry,
  defId: string,
  opts: JokerValueOptions = DEFAULT_OPTIONS,
  cache: BaseCache = new Map(),
): JokerValue {
  const def = reg.jokers[defId];
  if (!def) throw new Error(`Unknown joker ${defId}`);
  const botName = opts.bot ?? botFor(def);
  const buyAnte = isScaling(def) ? SCALING_BUY_ANTE : 1;
  const realMode = def.tags.includes('copy');
  const r1 = newAcc();
  const r2 = newAcc();
  const real = newAcc();
  const money = { all: 0, r1: 0, rounds: 0, roundsR1: 0 };
  const sim: SimDelta = {
    runs: 0,
    anteWith: 0,
    anteWithout: 0,
    roundsWith: 0,
    roundsWithout: 0,
    winsWith: 0,
    winsWithout: 0,
  };
  const branches: BranchData[] = [];

  for (let i = 1; i <= opts.runs; i++) {
    const seed = `JV-${opts.seedPrefix}-${i}`;
    const key = `${botName}|${opts.deck}|${opts.stake}|${seed}`;
    let base = cache.get(key);
    if (!base) {
      base = baseRun(reg, opts, botName, seed);
      cache.set(key, base);
    }
    const br = branchRun(reg, opts, def, botName, base, buyAnte);
    if (!br) continue;
    branches.push(br);
    sim.runs++;
    sim.anteWith += br.result.ante;
    sim.anteWithout += base.result.ante;
    sim.roundsWith += br.result.rounds;
    sim.roundsWithout += base.result.rounds;
    sim.winsWith += br.result.won ? 1 : 0;
    sim.winsWithout += base.result.won ? 1 : 0;
    money.all += br.money.all;
    money.r1 += br.money.r1;
    money.rounds += br.money.rounds;
    money.roundsR1 += br.money.roundsR1;
  }

  // 1. průchod: skutečná sestava a R1. Zároveň se sleduje, kolik čipů karet přidal právě tento žolík
  // (`jBonus`: rozdíl čipů karet světa se žolíkem a bez něj) — jen ty se „bez žolíka“ odečtou.
  const jBonusAt = new Map<BranchData, Map<number, number>[]>();
  let growthRounds = 0;
  const stateGrowth: Record<string, number> = {};
  const cardGrowth = new Map<string, number>();
  for (const br of branches) {
    const { uid } = br;
    let jBonus = new Map<number, number>();
    const perSample: Map<number, number>[] = [];
    const g = br.growth as GrowthPoint | null;
    for (const s of br.samples) {
      perSample.push(jBonus);
      const jb = jBonus;
      const ids = withoutIds(br, s);
      const realWorld = (st: RunState): void => {
        st.jokers = st.jokers.filter((j) => j.uid !== uid);
        strip(st, br, jb);
      };
      const realWith = scoreOn(reg, s.snap, s.rngSeed, () => s.ids);
      const realWithout = ids ? scoreOn(reg, s.snap, s.rngSeed, (st) => (realWorld(st), ids)) : null;
      // Tah, který by bot zahrál bez žolíka (s ostatními svými žolíky).
      const realBest = chooseWithout(reg, s, realWorld, ids, ALTERNATIVES);
      if (realWith) {
        // Bez žolíka se nehrálo (zahrál by jen karty, které přinesl): čipy karet zůstaly jako před rukou.
        const without =
          realWithout?.bonus ??
          new Map(deckOf(s).map((c) => [c.id, c.bonusChips - (jb.get(c.id) ?? 0)] as [number, number]));
        const next = new Map<number, number>();
        for (const [id, after] of realWith.bonus) {
          const d = after - (without.get(id) ?? after);
          if (Math.abs(d) > 1e-9) next.set(id, d);
        }
        jBonus = next;
      }
      const realRatio =
        realWith && realBest && realBest.result.score > 0
          ? (realWith.result.score / realBest.result.score - 1) * 100
          : null;
      if (realRatio !== null) addSample(real, realRatio, { chips: 0, mult: 0, xmult: 1 + realRatio / 100 });

      if (realMode) {
        if (realRatio === null) continue;
        const e = { chips: 0, mult: 0, xmult: 1 + realRatio / 100 };
        if (s.ante <= R1_LAST_ANTE) addSample(r1, realRatio, e);
        addSample(r2, realRatio, e);
        continue;
      }

      // R1: patra 1–3, úrovně střídavě 1 a 2, skutečný stav žolíka.
      if (s.ante <= R1_LAST_ANTE) {
        const level = 1 + (s.index % 2);
        const w = bestPlay(
          reg,
          s,
          (st) => {
            st.jokers = st.jokers.filter((j) => j.uid === uid);
            setLevels(st, level);
          },
          [s.ids],
          WITH_CANDIDATES,
        );
        const wo = bestPlay(
          reg,
          s,
          (st) => {
            st.jokers = [];
            setLevels(st, level);
            strip(st, br, jb);
          },
          [ids],
          WITHOUT_CANDIDATES,
        );
        if (w) {
          const e = effectOf(def, wo?.result ?? null, w.result);
          addSample(r1, projectValue(REFERENCE.r1, e), e);
        }
      }
      // Růst do konce posledního dokončeného kola (počítadla žolíka i čipy karet, které přidal).
      if (g && g.rounds > 0 && s.index + 1 === g.samplesBefore)
        for (const c of deckOf(s)) {
          const b = jBonus.get(c.id);
          if (b) cardGrowth.set(cardKey(c), (cardGrowth.get(cardKey(c)) ?? 0) + b);
        }
    }
    jBonusAt.set(br, perSample);
    if (g && g.rounds > 0) {
      growthRounds += g.rounds;
      for (const [k, v] of Object.entries(g.state))
        stateGrowth[k] = (stateGrowth[k] ?? 0) + v - (br.stateAtBuy[k] ?? 0);
    }
  }
  const perRound = (total: number): number => (growthRounds > 0 ? total / growthRounds : 0);

  // 2. průchod: R2 (všechny ruce, úroveň `r2Level`, škálování extrapolované na R2_ROUNDS_HELD kol od koupě).
  if (!realMode)
    for (const br of branches) {
      const { uid } = br;
      const perSample = jBonusAt.get(br) ?? [];
      for (const s of br.samples) {
        const jb = perSample[s.index] ?? new Map<number, number>();
        const extrapolate = (st: RunState): void => {
          if (!isScaling(def)) return;
          const j = st.jokers.find((x) => x.uid === uid);
          if (j)
            for (const [k, total] of Object.entries(stateGrowth))
              j.state[k] = (br.stateAtBuy[k] ?? 0) + perRound(total) * R2_ROUNDS_HELD;
          // Čipy karet: sdružený růst za kolo rozdělený mezi karty stejné hodnoty a barvy.
          const counts = new Map<string, number>();
          for (const c of st.deck) counts.set(cardKey(c), (counts.get(cardKey(c)) ?? 0) + 1);
          for (const c of st.deck) {
            const total = cardGrowth.get(cardKey(c)) ?? 0;
            if (total === 0) continue;
            c.bonusChips +=
              (perRound(total) * R2_ROUNDS_HELD) / (counts.get(cardKey(c)) ?? 1) - (jb.get(c.id) ?? 0);
          }
        };
        const w = bestPlay(
          reg,
          s,
          (st) => {
            st.jokers = st.jokers.filter((j) => j.uid === uid);
            setLevels(st, opts.r2Level);
            extrapolate(st);
          },
          [s.ids],
          WITH_CANDIDATES,
        );
        const wo = bestPlay(
          reg,
          s,
          (st) => {
            st.jokers = [];
            setLevels(st, opts.r2Level);
            strip(st, br, jb);
          },
          [withoutIds(br, s)],
          WITHOUT_CANDIDATES,
        );
        if (w) {
          const e = effectOf(def, wo?.result ?? null, w.result);
          addSample(r2, projectValue(REFERENCE.r2, e), e);
        }
      }
    }

  return {
    id: def.id,
    rarity: def.rarity,
    tags: [...def.tags],
    bot: botName,
    buyAnte,
    realMode,
    r1: windowValue(r1),
    r2: windowValue(r2),
    real: real.values.length ? real.values.reduce((a, b) => a + b, 0) / real.values.length : null,
    money:
      money.all !== 0
        ? {
            all: money.rounds ? money.all / money.rounds : 0,
            r1: money.roundsR1 ? money.r1 / money.roundsR1 : 0,
            rounds: money.rounds,
          }
        : null,
    sim,
  };
}

// ─────────────────────────── Hodnocení podle 4.3 ───────────────────────────

/**
 * Pravidla 1–3 tabulky 4.3: dolní hranice aspoň v jednom okně, horní v žádném, špička (95. percentil rukou okna R2)
 * nejvýš 2× horní hranice R2.
 * Ekonomičtí žolíci (dávají peníze a skóre nemění) se hodnotí podle Kč/kolo, užitkoví (nemění ani jedno) jen
 * simulací — tady `na`.
 */
export function verdict(v: JokerValue): Verdict {
  const band = BANDS[v.rarity];
  const r1 = v.r1.avg;
  const r2 = v.r2.avg;
  const handEffect = (r1 !== null && Math.abs(r1) > 0.05) || (r2 !== null && Math.abs(r2) > 0.05);
  if (!handEffect && v.money && band.money) {
    const m = v.money.all;
    return { kind: m < band.money[0] ? 'low' : m > band.money[1] ? 'high' : 'ok', basis: 'money' };
  }
  if (!handEffect) return { kind: 'na', basis: 'sim' };
  const hi1 = band.r1[1];
  const hi2 = band.r2[1];
  if ((r1 ?? 0) > hi1 || (r2 ?? 0) > hi2) return { kind: 'high', basis: 'hand' };
  // Pravidlo 3 („ideální ruka, plný build“) se hodnotí v okně R2: v R1 plný build není a slabá referenční ruka
  // by „ideální“ ruku přecenila (i Srdcař z ukázky 4.3 má s pěti ♥ vůči R1 +219 %).
  if ((v.r2.peak ?? 0) > 2 * hi2) return { kind: 'peak', basis: 'hand' };
  if ((r1 ?? -Infinity) >= band.r1[0] || (r2 ?? -Infinity) >= band.r2[0])
    return { kind: 'ok', basis: 'hand' };
  return { kind: 'low', basis: 'hand' };
}

// ─────────────────────────── Výstup ───────────────────────────

const f1 = (x: number | null | undefined): string =>
  x === null || x === undefined ? '–' : (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const f0 = (x: number | null | undefined): string =>
  x === null || x === undefined ? '–' : String(Math.round(x));
const signed = (x: number): string => (x > 0 ? `+${f1(x)}` : f1(x));

const VERDICT_TEXT: Record<VerdictKind, string> = {
  ok: 'v pásmu',
  low: 'POD pásmem',
  high: 'NAD pásmem',
  peak: 'ŠPIČKA nad 2× horní hranicí',
  na: 'jen simulace',
};

const nameOf = (id: string): string => (hasKey(`jokers.${id}.name`) ? t(`jokers.${id}.name`) : id);

export function reportText(values: readonly JokerValue[], opts: JokerValueOptions): string[] {
  const lines = [
    'Karban — hodnota žolíků (docs/DESIGN.md 4.2–4.3)',
    `${opts.runs} seedů JV-${opts.seedPrefix}-1…${opts.runs} · balíček ${opts.deck} · síla piva ${opts.stake} · R2 úroveň kombinací ${opts.r2Level}`,
    'R1 = 60 × 8 (patra 1–3, úrovně 1–2) · R2 = 200 × 40 (všechny ruce, škálování extrapolované na 16 kol od koupě)',
    '',
  ];
  const header = [
    'žolík'.padEnd(20),
    'vzácn.',
    'bot'.padEnd(5),
    'R1 %'.padStart(7),
    'R2 %'.padStart(7),
    'špička'.padStart(13),
    'reálně'.padStart(7),
    'spuštění'.padStart(9),
    'Kč/kolo'.padStart(9),
    'Δ patro'.padStart(8),
    'Δ kol'.padStart(7),
    'Δ výher'.padStart(8),
    'hodnocení',
  ];
  lines.push(header.join(' '));
  for (const v of values) {
    const s = v.sim;
    const n = Math.max(1, s.runs);
    const dAnte = (s.anteWith - s.anteWithout) / n;
    const dRounds = (s.roundsWith - s.roundsWithout) / n;
    const dWins = (100 * (s.winsWith - s.winsWithout)) / n;
    const vd = verdict(v);
    lines.push(
      [
        nameOf(v.id).padEnd(20),
        v.rarity.padEnd(6),
        v.bot.padEnd(5),
        f1(v.r1.avg).padStart(7),
        f1(v.r2.avg).padStart(7),
        `${f0(v.r1.peak)}/${f0(v.r2.peak)}`.padStart(13),
        f1(v.real).padStart(7),
        `${f0(100 * v.r1.fired)}/${f0(100 * v.r2.fired)} %`.padStart(9),
        (v.money ? `${f1(v.money.all)}/${f1(v.money.r1)}` : '–').padStart(9),
        signed(dAnte).padStart(8),
        signed(dRounds).padStart(7),
        signed(dWins).padStart(8),
        `${VERDICT_TEXT[vd.kind]}${v.realMode ? ' (skutečná sestava)' : ''}`,
      ].join(' '),
    );
  }
  lines.push('');
  lines.push(
    'Pásma 4.3 (R1 / R2 / Kč za kolo): běžný 35–100 / 8–30 / 2–3 · vzácný 50–130 / 20–60 / 3–5 · epický 80–180 / 45–110 / 5–7',
  );
  lines.push(
    'špička = 95. percentil navýšení jedné ruky R1/R2 (pravidlo 3 se hodnotí v R2) · spuštění = podíl rukou, kde žolík skóre změnil (R1/R2) · Kč/kolo celkem/patra 1–3',
  );
  return lines;
}

// ─────────────────────────── CLI ───────────────────────────

export function parseOptions(argv: readonly string[]): {
  opts: JokerValueOptions;
  jokers: string[] | null;
  json: string | null;
} {
  const args = [...argv];
  let json: string | null = null;
  const ji = args.indexOf('--json');
  if (ji >= 0) {
    const next = args[ji + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    json = hasValue ? next : '-';
    args.splice(ji, hasValue ? 2 : 1);
  }
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: 'string', default: String(DEFAULT_OPTIONS.runs) },
      'seed-prefix': { type: 'string', default: DEFAULT_OPTIONS.seedPrefix },
      joker: { type: 'string' },
      bot: { type: 'string', default: 'auto' },
      deck: { type: 'string', default: DEFAULT_OPTIONS.deck },
      stake: { type: 'string', default: String(DEFAULT_OPTIONS.stake) },
      'r2-level': { type: 'string', default: String(DEFAULT_OPTIONS.r2Level) },
    },
    strict: true,
  });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs: ${values.runs}`);
  const bot = values.bot === 'auto' ? null : (values.bot as BotName);
  return {
    opts: {
      runs,
      seedPrefix: values['seed-prefix'],
      deck: values.deck,
      stake: Number(values.stake),
      bot,
      r2Level: Number(values['r2-level']),
    },
    jokers: values.joker ? values.joker.split(',').map((s) => s.trim()) : null,
    json,
  };
}

function main(): void {
  const reg = contentRegistry();
  const { opts, jokers, json } = parseOptions(process.argv.slice(2));
  const ids = jokers ?? Object.keys(reg.jokers);
  const cache: BaseCache = new Map();
  const started = performance.now();
  const values = ids.map((id) => {
    const v = measureJoker(reg, id, opts, cache);
    if (json !== '-')
      process.stderr.write(`  ${id} hotovo (${f1((performance.now() - started) / 1000)} s)\n`);
    return v;
  });
  if (json === '-') {
    process.stdout.write(`${JSON.stringify({ options: opts, values }, null, 2)}\n`);
    return;
  }
  if (json) writeFileSync(json, `${JSON.stringify({ options: opts, values }, null, 2)}\n`);
  const lines = reportText(values, opts);
  lines.push('');
  lines.push(`Doba měření: ${f1((performance.now() - started) / 1000)} s`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
