/**
 * Boti pro headless simulaci (docs/DESIGN.md kap. 12.2): `max`, `flush`, `pairs`, `econ`, `random`, `nojoker`.
 *
 * Společný „rozumný“ bot (`StrategyBot`) se liší jen konfigurací stylu:
 * - kolo: zahraje kandidáta s nejvyšším odhadem skóre (náhled enginu + příspěvky karet; se žolíky nebo pravidlem
 *   šéfa přesně na kopii hry), a když ruka nestačí na zbytek cíle, zahazuje — vybírá z několika „honiček“
 *   (držet jádro kombinace, barvu, postupku, páry) tu s nejlepším Monte Carlo odhadem po dobrání;
 * - Večerka: žolíci podle `JokerDef.tags`, nečíselných `params` (`suit`, `hand`, `level`), vzácnosti, edice a stylu
 *   (při plných slotech prodá nejslabšího; s dluhovým limitem i na dluh); kupóny, spotřebky a obálky podle hodnoty
 *   v Kč proti ceně (src/engine/sim/value.ts — sonda na kopii hry); přehození s penězi nad rezervou na úrok, i kvůli
 *   výměně slabého žolíka;
 * - kolo podle vlastních žolíků: honí barvu a kombinace, které chtějí (`params.suit`, `params.hand`), a zahazuje
 *   jen tehdy, když zahození nevezme víc, než přinese (žolíci se štítkem `discard`, např. Hostinský);
 * - spotřebky ve slotech i z obálek oceňuje sondou (pranostiky hned, spotřebky s cílem na karty s největším přínosem,
 *   u levé/pravé karty nejdřív přeřadí ruku; „jen pár korun“ počká), žolíky řadí +čipy/+mult vlevo, ×mult vpravo,
 *   kopírujícího žolíka k jeho cíli.
 *
 * Boti používají jen veřejné informace: ruku, složení (ne pořadí) dobíracího balíčku, nabídku a pravidla.
 *
 * Bot nemá **žádný stav mimo `RunState`**: rozhodnutí je čistá funkce stavu hry. Náhoda jde výhradně přes RNG
 * jednoho rozhodnutí seedovaný `<seed runu>:bot:<jméno>:<otisk stavu>` (`decisionRng`), počítadla (přehození
 * ve Večerce, zahrané ruce) bot čte ze stavu. Simulace je proto deterministická i při sdílení instance bota mezi
 * prokládanými runy a po uložení a načtení uprostřed runu pokračuje stejně.
 */
import { FINAL_ANTE } from '../constants';
import type { BoosterDef, JokerRarity, JokerTag, Rng } from '../content-types';
import { cyrb128, rngFromState } from '../rng/rng';
import type { Game } from '../run/game';
import type {
  Action,
  Card,
  ConsumableInstance,
  HandType,
  JokerInstance,
  RoundState,
  RunState,
  ShopItem,
} from '../types';
import { HAND_TYPES, SUITS } from '../types';
import {
  analyzeCards,
  bestUtility,
  cardValue,
  cloneGame,
  exactPlayScore,
  makeEnv,
  planCandidates,
  type CardValue,
  type EvalEnv,
  type PlayCandidate,
} from './hand-eval';
import type { Bot, BotName } from './types';
import {
  cardWorth,
  clamp,
  expectedMaxOfK,
  JOKER_KC,
  levelWorth,
  makeView,
  planTargets,
  sampledDelta,
  type Delta,
  type TargetPlan,
  type ValueView,
} from './value';

export const BOT_NAMES: readonly BotName[] = ['max', 'flush', 'pairs', 'econ', 'random', 'nojoker'];

/** Další jména botů (`--bot maxHand,flushChaser…`) → id podle DESIGN 12.2. */
export const BOT_ALIASES: Readonly<Record<string, BotName>> = Object.freeze({
  maxhand: 'max',
  flushchaser: 'flush',
  pairsjokers: 'pairs',
  economy: 'econ',
  economic: 'econ',
  baseline: 'random',
  nojokers: 'nojoker',
});

/** Id bota z jména nebo aliasu (bez ohledu na velikost písmen), neznámé → null. */
export function resolveBotName(name: string): BotName | null {
  const key = name.trim().toLowerCase();
  if ((BOT_NAMES as readonly string[]).includes(key)) return key as BotName;
  return BOT_ALIASES[key] ?? null;
}

// ─────────────────────────── Styl ───────────────────────────

type ChaseKind = 'core' | 'suit' | 'straight' | 'rank';

interface Style {
  readonly name: BotName;
  /** Preference kombinací při výběru tahu a honičce (násobek hodnoty). */
  readonly pref: Readonly<Partial<Record<HandType, number>>>;
  /** Kombinace, na které bot kupuje pranostiky a žolíky (kromě nejhranější kombinace runu). */
  readonly favorHands: readonly HandType[];
  readonly chase: readonly ChaseKind[];
  /** Drží nejčastější barvu (flush). */
  readonly suitFocus: boolean;
  /** Drží páry (pairs). */
  readonly rankFocus: boolean;
  readonly buysJokers: boolean;
  /** Rezerva na plný úrok vždy (econ). */
  readonly fullReserve: boolean;
  /** Nejnižší hodnocení žolíka, který ještě koupí. */
  readonly minJokerRating: number;
  readonly rerolls: boolean;
  /** Vzorků Monte Carlo na jednu možnost zahození. */
  readonly samples: number;
  readonly skipBlinds: boolean;
}

const FLUSH_FAMILY: readonly HandType[] = [
  'flush',
  'straight_flush',
  'royal_flush',
  'flush_house',
  'flush_five',
];
const PAIR_FAMILY: readonly HandType[] = ['pair', 'two_pair', 'three', 'full_house', 'four', 'five'];

/** Kombinace, které „obsahují“ kombinaci z `params.hand` žolíka (DESIGN 2.2.3, zjednodušeně po rodinách). */
const HAND_FAMILY: Readonly<Record<string, readonly HandType[]>> = {
  pair: [...PAIR_FAMILY, 'flush_house', 'flush_five'],
  two_pair: ['two_pair', 'full_house', 'flush_house'],
  three: ['three', 'full_house', 'four', 'five', 'flush_house', 'flush_five'],
  straight: ['straight', 'straight_flush', 'royal_flush'],
  flush: FLUSH_FAMILY,
};
/** Násobek preference kombinace, kterou chce vlastní žolík. */
const JOKER_HAND_PREF = 1.2;

const prefFor = (types: readonly HandType[], mult: number): Partial<Record<HandType, number>> =>
  Object.fromEntries(types.map((t) => [t, mult]));

const BASE_STYLE: Omit<Style, 'name'> = {
  pref: {},
  favorHands: [],
  chase: ['core', 'suit', 'straight', 'rank'],
  suitFocus: false,
  rankFocus: false,
  buysJokers: true,
  fullReserve: false,
  minJokerRating: 0.8,
  rerolls: true,
  samples: 24,
  skipBlinds: true,
};

const STYLES: Record<Exclude<BotName, 'random'>, Style> = {
  max: { ...BASE_STYLE, name: 'max' },
  flush: {
    ...BASE_STYLE,
    name: 'flush',
    pref: prefFor(FLUSH_FAMILY, 1.35),
    favorHands: FLUSH_FAMILY,
    chase: ['core', 'suit'],
    suitFocus: true,
  },
  pairs: {
    ...BASE_STYLE,
    name: 'pairs',
    pref: prefFor(PAIR_FAMILY, 1.25),
    favorHands: PAIR_FAMILY,
    chase: ['core', 'rank'],
    rankFocus: true,
  },
  econ: { ...BASE_STYLE, name: 'econ', fullReserve: true, minJokerRating: 1.3, skipBlinds: false },
  nojoker: { ...BASE_STYLE, name: 'nojoker', buysJokers: false },
};

/** Výchozí hodnota žolíka podle vzácnosti (DESIGN 4.3: cílové navýšení skóre roste se vzácností). */
const RARITY_VALUE: Readonly<Record<JokerRarity, number>> = {
  common: 1,
  rare: 1.5,
  epic: 2.2,
  legendary: 3.5,
};
/** Násobek podle kategorie efektu (DESIGN 4.5: ×mult je jádro pozdní hry, +čipy slábnou). */
const TAG_VALUE: Readonly<Partial<Record<JokerTag, number>>> = {
  xmult: 1.45,
  retrigger: 1.25,
  mult: 1.15,
  scaling: 1.1,
  copy: 1.05,
  chips: 1,
  economy: 1,
  utility: 0.95,
};
/** Násobek hodnocení žolíka, který za současného obsahu/stavu runu nic nedá. */
const DEAD_JOKER_VALUE = 0.25;
const EDITION_VALUE: Readonly<Record<string, number>> = { foil: 1.1, holo: 1.2, poly: 1.4, negative: 1.5 };
const STICKER_VALUE: Readonly<Record<string, number>> = { eternal: 0.95, perishable: 0.6, rental: 0.55 };

/** Pořadí žolíků: +čipy a +mult vlevo, ×mult vpravo (DESIGN 4.5). */
function jokerOrderKey(tags: readonly JokerTag[]): number {
  if (tags.includes('xmult')) return 3;
  if (tags.includes('chips')) return 0;
  if (tags.includes('mult')) return 1;
  return 2;
}

/**
 * Klíč pořadí žolíka ve slotech. Kopírující žolík (štítek `copy`) se vyhodnotí na svém místě, takže patří tam,
 * kam patří jeho aktuální cíl (veřejný stav `state.target` = uid kopírovaného žolíka, pokud ho žolík má).
 */
function slotOrderKey(game: Game, j: JokerInstance): number {
  const reg = game.registry;
  const tags = reg.jokers[j.defId]?.tags ?? [];
  if (tags.includes('copy')) {
    const target = game.state.jokers.find((x) => x.uid === j.state.target && x.uid !== j.uid);
    if (target) return jokerOrderKey(reg.jokers[target.defId]?.tags ?? []);
  }
  return jokerOrderKey(tags);
}

/** Barvy, které chtějí vlastní žolíci (`params.suit`, např. Srdcař ♥): bonus k počtu karet barvy na bit barvy. */
function suitFavor(game: Game): number[] {
  const favor = [0, 0, 0, 0];
  for (const j of game.state.jokers) {
    const suit = game.registry.jokers[j.defId]?.params?.suit;
    const bit = typeof suit === 'string' ? (SUITS as readonly string[]).indexOf(suit) : -1;
    if (bit >= 0 && !j.debuffed) favor[bit]! += SUIT_FAVOR_PER_JOKER;
  }
  return favor;
}

/** O kolik karet „víc“ bot počítá barvu, kterou chce jeden jeho žolík (honí ji i při mírné převaze jiné barvy). */
const SUIT_FAVOR_PER_JOKER = 1.5;

// ─────────────────────────── Náhoda rozhodnutí ───────────────────────────

/** Nejvýš tolik přehození v jedné Večerce (rozumný bot / náhodný bot) — počítadlo je ve stavu Večerky. */
const MAX_SHOP_REROLLS = 3;
const RANDOM_MAX_SHOP_REROLLS = 10;
/** S penězi nad rezervou aspoň `REROLL_RICH_KC` smí přehodit až `MAX_SHOP_REROLLS_RICH`×. */
const MAX_SHOP_REROLLS_RICH = 5;
const REROLL_RICH_KC = 20;
/** Přehazovat kvůli výměně žolíka jen s penězi nad rezervou aspoň cena + tolik a se žolíkem horším než tolik. */
const REROLL_UPGRADE_KC = 6;
const UPGRADE_WORST_MAX = 2;
/** Výměna žolíka: nový musí být aspoň o tolik lepší (násobek hodnocení). */
const UPGRADE_RATIO = 1.3;

// ─────────────────────────── Spotřebky, obálky, kupóny (Kč, src/engine/sim/value.ts) ───────────────────────────

/** Spotřebku použít, když ji sondy ocení aspoň na tolik Kč. */
const USE_MIN = 0.2;
/** Spotřebka, která dá jen peníze, počká, dokud nedá aspoň tolik. */
const MONEY_USE_MIN = 6;
/** Sond na spotřebku s náhodným efektem. */
const PROBE_SAMPLES = 3;
/** Koupit, když hodnota ≥ cena × poměr × pocit z ceny (`priceFactor`). */
const VOUCHER_RATIO = 0.95;
const PRANOSTIKA_RATIO = 0.8;
const BOOSTER_RATIO = 0.85;
/** Pocit z ceny klesá od `FREE_MONEY_FROM` Kč nad rezervou až na `MIN_PRICE_FACTOR` (o `FREE_MONEY_SPAN` Kč výš). */
const MIN_PRICE_FACTOR = 0.35;
const FREE_MONEY_FROM = 5;
const FREE_MONEY_SPAN = 25;
/** Spotřebku s cílem koupí do slotu, jen když po nákupu zbyde nad rezervou aspoň tolik Kč. */
const SURPLUS_TARGET_KC = 8;
/** Odhad nejlepší babské rady / razítka z obálky (Kč) a Žolíkové obálky při plných slotech. */
const BOOSTER_RADA_KC = 2.2;
const BOOSTER_RAZITKO_KC = 2.6;
const BOOSTER_JOKER_FULL_KC = 1;
/** Babská obálka má pro bota se žolíkem krmeným spotřebkami (Kořenářka) takový násobek hodnoty. */
const FEED_BOOSTER_MULT = 1.6;
/** Uložit spotřebku z obálky na později: hodnota, když teď nejde použít, a podíl hodnoty, když jen čeká. */
const KEEP_KC = 0.4;
const KEEP_FACTOR = 0.8;
/** Z obálky vybrat, jen když nejlepší možnost má aspoň tolik Kč. */
const PICK_MIN = 0.3;
/** Přeskakovat útraty až po tolika zahraných rukách runu (`RunStats.handsPlayed`). */
const SKIP_MIN_HANDS = 4;
/** Vzorků ruky pro odhad síly buildu před přeskočením útraty. */
const STRENGTH_SAMPLES = 4;

/**
 * Otisk stavu pro RNG rozhodnutí: hodnoty, které se mění s postupem runu (peníze, uid, ruka, statistiky, Večerka,
 * obálka, žolíci). Shoda otisku u dvou různých rozhodnutí jen zopakuje tatáž náhodná čísla — determinismus to
 * neporuší.
 */
function stateKey(s: Readonly<RunState>): string {
  const st = s.stats;
  const r = s.round;
  return [
    s.phase,
    s.ante,
    s.blindIndex,
    s.money,
    s.nextUid,
    st.handsPlayed,
    st.discardsUsed,
    st.shopsEntered,
    st.rerolls,
    st.consumablesUsed,
    st.jokersBought,
    st.jokersSold,
    r ? `${r.score}/${r.handsLeft}/${r.discardsLeft}/${r.hand.join(',')}` : '',
    s.shop ? s.shop.rerollsThisShop : '',
    s.booster ? `${s.booster.boosterId}/${s.booster.picksLeft}` : '',
    s.jokers.map((j) => j.uid).join(','),
    s.consumables.map((c) => c.uid).join(','),
  ].join('|');
}

/**
 * RNG jednoho rozhodnutí: seed runu + jméno bota + otisk stavu. Bot si nic nepamatuje mezi voláními, takže
 * stejný stav ⇒ stejná akce (nová instance, opakované volání, hra načtená z uložení).
 */
export function decisionRng(game: Game, botName: string): Rng {
  return rngFromState(cyrb128(`${game.state.seed}:bot:${botName}:${stateKey(game.state)}`));
}

// ─────────────────────────── Pomocné dotazy ───────────────────────────

function cardsOf(game: Game, ids: readonly number[]): Card[] {
  const out: Card[] = [];
  for (const id of ids) {
    const c = game.card(id);
    if (c) out.push(c as Card);
  }
  return out;
}

function jokerRoom(game: Game, joker?: Pick<JokerInstance, 'edition'>): boolean {
  const extra = joker?.edition ? (game.registry.editions[joker.edition]?.extraSlots ?? 0) : 0;
  return game.state.jokers.length < game.modifiers().jokerSlots + extra;
}

function consumableRoom(game: Game): boolean {
  return game.state.consumables.length < game.modifiers().consumableSlots;
}

/** Zaplatit jde (dluhový limit)? */
function canPay(game: Game, price: number): boolean {
  return game.state.money - price >= -game.modifiers().debtLimit;
}

/** Nejvyšší úroveň kombinace v runu. */
function maxHandLevel(game: Game): number {
  let max = 1;
  for (const hl of Object.values(game.state.handLevels)) if (hl && hl.level > max) max = hl.level;
  return max;
}

/** Jde v tomto obsahu zvyšovat úrovně kombinací (spotřebky s `hand` — pranostiky)? */
function canLevelUp(game: Game): boolean {
  return Object.values(game.registry.consumables).some((c) => Boolean(c.hand));
}

/** Nejhranější kombinace runu (při shodě silnější). */
function mostPlayed(game: Game, n: number): HandType[] {
  const counts = game.state.stats.handTypeCounts;
  return HAND_TYPES.filter((t) => (counts[t] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || HAND_TYPES.indexOf(b) - HAND_TYPES.indexOf(a))
    .slice(0, n);
}

/** Barva s nejvíc kartami v balíčku runu (divoké karty počítají do všech). */
function mainDeckSuit(game: Game): number {
  const env = makeEnv(game);
  const counts = [0, 0, 0, 0];
  for (const c of game.state.deck) {
    const v = cardValue(c, env);
    for (let bit = 0; bit < SUITS.length; bit++) if (v.suitMask & (1 << bit)) counts[bit]!++;
  }
  // Barva, kterou chtějí žolíci, má přednost i při mírně menším počtu karet v balíčku.
  const favor = suitFavor(game);
  const weight = (bit: number): number => counts[bit]! + 4 * (favor[bit] ?? 0);
  let best = 0;
  for (let bit = 1; bit < counts.length; bit++) if (weight(bit) > weight(best)) best = bit;
  return best;
}

/** Rozbor ruky pro honičku: počty hodnot, hlavní barva, nejlepší okno postupky. */
interface DrawInfo {
  rankCounts: Map<number, number>;
  suitCounts: number[];
  mainSuit: number;
  straight: Set<number>;
}

function drawInfo(hand: readonly CardValue[], favor: readonly number[] = [0, 0, 0, 0]): DrawInfo {
  const ranked = hand.filter((c) => !c.stone && !c.faceDown);
  const rankCounts = new Map<number, number>();
  const suitCounts = [0, 0, 0, 0];
  const suitWorth = [0, 0, 0, 0];
  for (const c of ranked) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    for (let bit = 0; bit < 4; bit++)
      if (c.suitMask & (1 << bit)) {
        suitCounts[bit]!++;
        suitWorth[bit]! += c.worth;
      }
  }
  // Hlavní barva: nejvíc karet (+ bonus za barvu, kterou chtějí žolíci), při shodě nejcennější.
  const weight = (bit: number): number => suitCounts[bit]! + (favor[bit] ?? 0);
  let mainSuit = 0;
  for (let bit = 1; bit < 4; bit++) {
    if (
      weight(bit) > weight(mainSuit) ||
      (weight(bit) === weight(mainSuit) && suitWorth[bit]! > suitWorth[mainSuit]!)
    )
      mainSuit = bit;
  }
  // Okno 5 po sobě jdoucích hodnot s nejvíc různými hodnotami (A smí být nízké).
  let straight = new Set<number>();
  let bestCount = 2;
  for (let top = 14; top >= 5; top--) {
    const ids: number[] = [];
    for (let r = top - 4; r <= top; r++) {
      const rank = r === 1 ? 14 : r;
      const c = ranked.filter((x) => x.rank === rank).sort((a, b) => b.worth - a.worth)[0];
      if (c) ids.push(c.id);
    }
    if (ids.length > bestCount) {
      bestCount = ids.length;
      straight = new Set(ids);
    }
  }
  return { rankCounts, suitCounts, mainSuit, straight };
}

// ─────────────────────────── Rozumný bot ───────────────────────────

class StrategyBot implements Bot {
  readonly name: string;

  constructor(private readonly style: Style) {
    this.name = style.name;
  }

  decide(game: Game): Action {
    const rng = decisionRng(game, this.name);
    switch (game.state.phase) {
      case 'blind_select':
        return this.maintenance(game) ?? this.blindChoice(game, rng);
      case 'round':
        return this.maintenance(game) ?? this.roundAction(game, rng);
      case 'round_end':
        return { type: 'cashOut' };
      case 'shop':
        return this.maintenance(game) ?? this.shopAction(game, rng);
      case 'booster':
        return this.maintenance(game) ?? this.boosterAction(game);
      case 'victory':
        return { type: 'continueEndless' };
      default:
        return { type: 'selectBlind' };
    }
  }

  // ── údržba: pořadí žolíků, spotřebky ve slotech ──

  private maintenance(game: Game): Action | null {
    const s = game.state;
    // Pořadí: +čipy/+mult vlevo, ×mult vpravo (stabilně podle dosavadního pořadí).
    if (s.jokers.length > 1) {
      const order = s.jokers
        .map((j, i) => ({ uid: j.uid, i, key: slotOrderKey(game, j) }))
        .sort((a, b) => a.key - b.key || a.i - b.i);
      if (order.some((o, i) => o.i !== i)) return { type: 'reorderJokers', uids: order.map((o) => o.uid) };
    }
    if (s.consumables.length === 0) return null;
    const view = this.view(game);
    const snapshot = JSON.stringify(s);
    for (const c of s.consumables) {
      const action = this.consumableUse(game, view, c, snapshot);
      if (action) return action;
    }
    return null;
  }

  /** Ocenění stavu pro toto rozhodnutí (src/engine/sim/value.ts). */
  private view(game: Game): ValueView {
    return makeView(game, this.style, makeEnv(game, this.handPref(game)), mainDeckSuit(game), (g, j) =>
      this.jokerRating(g, j),
    );
  }

  /**
   * Spotřebka ve slotu: pranostiku použije hned (vyšší úroveň čehokoli je lepší než nic — leda je držená spotřebka
   * cennější, Babiččina truhla), spotřebku bez cíle, když ji sondy ocení kladně (a nedá „jen pár korun“), spotřebku
   * s cílem na nejlepší cíle — v kole jen na jeho začátku (dokud se nehrálo ani nezahazovalo) a v obálce s rukou.
   * Když záleží na pořadí cílů (levá/pravá karta), nejdřív přeřadí ruku.
   */
  private consumableUse(game: Game, view: ValueView, c: ConsumableInstance, snapshot: string): Action | null {
    const def = game.registry.consumables[c.defId];
    if (!def) return null;
    const use: Action = { type: 'useConsumable', uid: c.uid };
    if (def.hand)
      return levelWorth(view, def.hand) > view.holdWorth && game.canUseConsumable(c.uid) ? use : null;
    if (!def.target) {
      if (!game.canUseConsumable(c.uid)) return null;
      const d = sampledDelta(view, use, `use:${c.uid}`, PROBE_SAMPLES, snapshot);
      return d && this.worthUsing(game, d) ? use : null;
    }
    const pool = targetPoolOf(game.state);
    if (!pool || !targetMoment(game.state)) return null;
    const plan = planTargets(
      view,
      def,
      pool,
      (targets) => ({ type: 'useConsumable', uid: c.uid, targetIds: targets }),
      `use:${c.uid}`,
      snapshot,
    );
    if (!plan || plan.value < USE_MIN) return null;
    return withOrder(pool, plan, { type: 'useConsumable', uid: c.uid, targetIds: plan.targets });
  }

  /**
   * Použít teď? Kladná hodnota; spotřebka, která dá jen peníze a málo (Pod slamníkem roste s penězi), počká —
   * leda jsou sloty plné nebo je poslední patro.
   */
  private worthUsing(game: Game, d: Delta): boolean {
    if (d.total < USE_MIN) return false;
    const onlyMoney = Math.abs(d.total - d.money) < 0.05;
    return !onlyMoney || d.money >= MONEY_USE_MIN || game.state.ante >= FINAL_ANTE || !consumableRoom(game);
  }

  /**
   * Preference kombinací: styl bota × kombinace, které chtějí jeho žolíci (`params.hand`, např. Párty pro dva →
   * vše, co obsahuje Dvojici; Kolotoč → Postupky). Ovlivní výběr kandidátů tahu a honičku při zahazování.
   */
  private handPref(game: Game): Partial<Record<HandType, number>> {
    const pref: Partial<Record<HandType, number>> = { ...this.style.pref };
    const favored = new Set<HandType>();
    for (const j of game.state.jokers) {
      if (j.debuffed) continue;
      for (const v of Object.values(game.registry.jokers[j.defId]?.params ?? {}))
        if (typeof v === 'string') for (const t of HAND_FAMILY[v] ?? []) favored.add(t);
    }
    for (const t of favored) pref[t] = (pref[t] ?? 1) * JOKER_HAND_PREF;
    return pref;
  }

  /** Kombinace, na kterou se vyplatí pranostika / žolík: oblíbená stylem nebo nejhranější v runu. */
  private wantsHand(game: Game, hand: HandType): boolean {
    if (this.style.favorHands.includes(hand)) return true;
    const played = mostPlayed(game, 2);
    return played.length === 0 ? hand === 'pair' || hand === 'two_pair' : played.includes(hand);
  }

  // ── výběr útraty ──

  private blindChoice(game: Game, rng: Rng): Action {
    const s = game.state;
    const blind = s.blinds[s.blindIndex];
    if (
      blind &&
      blind.kind !== 'boss' &&
      blind.skipTagId &&
      this.style.skipBlinds &&
      s.stats.handsPlayed >= SKIP_MIN_HANDS
    ) {
      // Přeskočit jen s výrazně silným buildem: průměrná nejlepší ruka × ruce ≥ 3× cíl Velké útraty. Odhad síly
      // (kopie hry) jen tehdy, když na to stačí aspoň nejlepší ruka runu (průměr ji skoro nikdy nepřekoná).
      const need = 3 * game.blindTarget('big');
      const hands = game.modifiers().hands;
      if (s.stats.bestHandScore * hands >= need && this.buildStrength(game, rng) * hands >= need)
        return { type: 'skipBlind' };
    }
    return { type: 'selectBlind' };
  }

  /**
   * Síla buildu: průměrný odhad nejlepšího tahu z několika náhodných rukou. Ruka se rozdá na kopii hry
   * s přeseedovaným RNG (bot nezná pořadí balíčku) a ohodnotí stejně jako v kole — vč. žolíků a úrovní kombinací.
   */
  private buildStrength(game: Game, rng: Rng): number {
    let sum = 0;
    for (let k = 0; k < STRENGTH_SAMPLES; k++) {
      const clone = cloneGame(game, rng);
      const round = clone.dispatch({ type: 'selectBlind' }).ok ? clone.state.round : null;
      if (!round || clone.state.phase !== 'round') return 0;
      const env = makeEnv(clone, this.handPref(clone));
      const hand = cardsOf(clone, round.hand).map((c) => cardValue(c, env));
      sum += this.rankedPlays(clone, rng, env, hand, drawInfo(hand, suitFavor(clone)), true)[0]?.raw ?? 0;
    }
    return sum / STRENGTH_SAMPLES;
  }

  // ── kolo ──

  /** Hodnota karty pro držení (vyšší = nechat si): cena + příslušnost k rozehrané kombinaci podle stylu. */
  private keepScore(c: CardValue, info: DrawInfo): number {
    if (c.debuffed) return -100 + c.worth;
    return c.worth + this.drawBonus(c, info);
  }

  private drawBonus(c: CardValue, info: DrawInfo): number {
    if (c.stone || c.faceDown) return 0;
    let bonus = 0;
    const pairs = (info.rankCounts.get(c.rank) ?? 0) >= 2;
    if (pairs) bonus += this.style.rankFocus ? 50 : 30;
    const suitNeed = this.style.suitFocus ? 2 : 3;
    if (c.suitMask & (1 << info.mainSuit) && info.suitCounts[info.mainSuit]! >= suitNeed)
      bonus += this.style.suitFocus ? 45 : 15;
    if (info.straight.has(c.id) && this.style.chase.includes('straight')) bonus += 12;
    return bonus;
  }

  /** Karty, kterých se bot chce zbavit (doplní jimi tah, aby se protočil balíček), od nejméně cenné. */
  private filler(hand: readonly CardValue[], info: DrawInfo): CardValue[] {
    return hand
      .filter((c) => !c.faceDown && (c.debuffed || this.drawBonus(c, info) === 0))
      .sort((a, b) => this.keepScore(a, info) - this.keepScore(b, info) || a.id - b.id);
  }

  private needsExact(game: Game): boolean {
    const s = game.state;
    if (s.jokers.length > 0) return true;
    const round = s.round;
    if (!round?.bossId || round.bossDisabled) return false;
    const hooks = game.registry.bosses[round.bossId]?.hooks;
    return Boolean(hooks?.validateHand || hooks?.adjustHandScore);
  }

  private roundAction(game: Game, rng: Rng): Action {
    const s = game.state;
    const round = s.round as RoundState;
    const env = makeEnv(game, this.handPref(game));
    const hand = cardsOf(game, round.hand).map((c) => cardValue(c, env));
    const info = drawInfo(hand, suitFavor(game));
    const need = Math.max(0, round.target - round.score);
    const cands = this.rankedPlays(game, rng, env, hand, info);
    if (cands.length === 0) {
      // Jen karty lícem dolů (nebo nic rozumného): zahraj, co jde.
      const ids = round.hand.slice(0, Math.min(env.maxCards, round.hand.length));
      return { type: 'play', cardIds: ids };
    }
    const best = cands[0]!;
    if (best.raw < need && round.discardsLeft > 0) {
      const discard = this.chooseDiscard(game, rng, env, hand, info, need, () =>
        this.discardPenalty(game, rng, best.ids),
      );
      if (discard) return { type: 'discard', cardIds: discard };
    }
    return { type: 'play', cardIds: best.ids };
  }

  /**
   * Kandidátní tahy od nejlepšího (se žolíky nebo pravidlem šéfa přepočítané přesně na kopii hry). `quick` = jen
   * odhad síly (přeskočení útraty): přesně se přepočítá nejlepší kandidát, nejvýš dva.
   */
  private rankedPlays(
    game: Game,
    rng: Rng,
    env: EvalEnv,
    hand: readonly CardValue[],
    info: DrawInfo,
    quick = false,
  ): PlayCandidate[] {
    const cands = planCandidates(game, hand, env, this.filler(hand, info));
    if (cands.length === 0 || !this.needsExact(game)) return cands;
    return quick ? this.rescoreExact(game, rng, cands, env, 1, 2) : this.rescoreExact(game, rng, cands, env);
  }

  /**
   * Kandidáti přepočítaní přesně (žolíci, pravidla šéfa) na kopii hry: nejlepších `first`, a dokud vede neověřený
   * kandidát (šéf mohl zakázat i ty další), ověřuje se dál — nejvýš `limit` přepočtů. Stav hry se serializuje
   * jednou pro všechny kopie.
   */
  private rescoreExact(
    game: Game,
    rng: Rng,
    cands: PlayCandidate[],
    env: EvalEnv,
    first = 3,
    limit = 6,
  ): PlayCandidate[] {
    const snapshot = JSON.stringify(game.state);
    const list = cands.map((c) => ({ ...c, exact: false }));
    const order = (a: (typeof list)[number], b: (typeof list)[number]) =>
      b.value - a.value || b.ids.length - a.ids.length;
    const verify = (c: (typeof list)[number]): void => {
      c.raw = Math.max(0, exactPlayScore(game, c.ids, rng, snapshot));
      c.value = c.raw * (c.type ? (env.pref[c.type] ?? 1) : 1);
      c.exact = true;
    };
    list.slice(0, first).forEach(verify);
    let checks = Math.min(first, list.length);
    list.sort(order);
    while (checks < limit && list[0] && !list[0].exact) {
      verify(list[0]);
      checks++;
      list.sort(order);
    }
    return list;
  }

  /** Možnosti zahození podle stylu (každá = karty k zahození, nejvýš `maxCards`). */
  private discardOptions(hand: readonly CardValue[], info: DrawInfo, env: EvalEnv): CardValue[][] {
    const options: CardValue[][] = [];
    const seen = new Set<string>();
    const byKeep = (a: CardValue, b: CardValue) =>
      this.keepScore(a, info) - this.keepScore(b, info) || a.id - b.id;
    const push = (keep: (c: CardValue) => boolean): void => {
      const out = hand
        .filter((c) => !keep(c))
        .sort(byKeep)
        .slice(0, env.maxCards);
      if (out.length === 0) return;
      const key = out
        .map((c) => c.id)
        .sort((a, b) => a - b)
        .join(',');
      if (seen.has(key)) return;
      seen.add(key);
      options.push(out);
    };
    for (const kind of this.style.chase) {
      if (kind === 'core') {
        const core = analyzeCards(hand, env).sort((a, b) => b.value - a.value)[0];
        const ids = new Set(core?.cards.map((c) => c.id) ?? []);
        push((c) => ids.has(c.id));
      } else if (kind === 'suit') {
        const bit = 1 << info.mainSuit;
        if (info.suitCounts[info.mainSuit]! >= (this.style.suitFocus ? 2 : 3))
          push((c) => !c.faceDown && (c.suitMask & bit) !== 0);
      } else if (kind === 'straight') {
        if (info.straight.size >= 3) push((c) => info.straight.has(c.id));
      } else {
        if ([...info.rankCounts.values()].some((n) => n >= 2))
          push((c) => !c.stone && !c.faceDown && (info.rankCounts.get(c.rank) ?? 0) >= 2);
      }
    }
    return options;
  }

  /**
   * Kolik skóre ruky zbude po zahození (0–1): žolíci se štítkem `discard` mohou zahazování trestat (Hostinský
   * násobí, jen dokud se v kole nezahazovalo). Přesně na kopii hry: nejlepší tah teď a po jednom zahození.
   */
  private discardPenalty(game: Game, rng: Rng, ids: readonly number[]): number {
    const reg = game.registry;
    if (!game.state.jokers.some((j) => !j.debuffed && reg.jokers[j.defId]?.tags.includes('discard')))
      return 1;
    const snapshot = JSON.stringify(game.state);
    const seed = cyrb128(`${rng.next()}`);
    const now = exactPlayScore(game, ids, rngFromState([...seed]), snapshot);
    const after = exactPlayScore(game, ids, rngFromState([...seed]), snapshot, (st) => {
      if (st.round) st.round.discardsUsed++;
    });
    return now > 0 && after >= 0 ? Math.min(1, after / now) : 1;
  }

  /**
   * Zahodit? Porovná užitek nejlepší kombinace teď s Monte Carlo odhadem po zahození a dobrání (vzorky
   * z veřejného složení dobíracího balíčku, zamíchané RNG bota), sníženým o trest za zahození (`penalty`, počítá
   * se až když zahození vychází). Vrací id karet, nebo null (radši hrát).
   */
  private chooseDiscard(
    game: Game,
    rng: Rng,
    env: EvalEnv,
    hand: readonly CardValue[],
    info: DrawInfo,
    need: number,
    penalty: () => number = () => 1,
  ): number[] | null {
    const round = game.state.round as RoundState;
    const options = this.discardOptions(hand, info, env);
    if (options.length === 0) return null;
    const pool = cardsOf(game, round.drawPile).map((c) => cardValue({ ...c, faceDown: false }, env));
    if (pool.length === 0) return null;
    const handSize = game.modifiers().handSize;
    const now = bestUtility(hand, env, need);
    const plans = options
      .map((opt) => {
        const kept = hand.filter((c) => !opt.includes(c));
        return { opt, kept, draw: Math.min(Math.max(0, handSize - kept.length), pool.length), sum: 0 };
      })
      .filter((p) => p.draw > 0);
    if (plans.length === 0) return null;
    const maxDraw = Math.max(...plans.map((p) => p.draw));
    const scratch = [...pool];
    // Společné náhodné vzorky pro všechny možnosti (common random numbers): rozdíl mezi možnostmi pak neruší
    // šum jednotlivých vzorků a stačí jich málo.
    for (let k = 0; k < this.style.samples; k++) {
      // Částečný Fisher–Yates: prvních `maxDraw` karet je náhodný vzorek bez opakování.
      for (let i = 0; i < maxDraw; i++) {
        const j = i + Math.floor(rng.next() * (scratch.length - i));
        const tmp = scratch[i]!;
        scratch[i] = scratch[j]!;
        scratch[j] = tmp;
      }
      for (const p of plans) p.sum += bestUtility([...p.kept, ...scratch.slice(0, p.draw)], env, need);
    }
    let best: { ids: number[]; ev: number } | null = null;
    for (const p of plans) {
      const ev = p.sum / this.style.samples;
      if (!best || ev > best.ev) best = { ids: p.opt.map((c) => c.id), ev };
    }
    if (!best || best.ev <= now * 1.05) return null;
    return best.ev * penalty() > now * 1.05 ? best.ids : null;
  }

  // ── Večerka ──

  /** Kolik Kč si bot nechává kvůli úroku. */
  private reserve(game: Game): number {
    const mods = game.modifiers();
    const full = Math.max(0, mods.interestStep * mods.interestCap);
    if (this.style.fullReserve) return full;
    if (game.state.jokers.length === 0) return 0;
    return Math.min(full, Math.max(0, mods.interestStep * (game.state.ante - 1)));
  }

  private affordable(game: Game, price: number, extra = 0): boolean {
    return canPay(game, price) && game.state.money - price >= this.reserve(game) + extra;
  }

  /**
   * Žolíka smí koupit i do mínusu, když to dluhový limit dovolí (Sekera, Dlužník): žolík je síla hned, úrok
   * z rezervy jen pomalu. Bot `econ` (drží plnou rezervu) se zadlužovat nechce.
   */
  private debtAffordable(game: Game, price: number): boolean {
    return !this.style.fullReserve && game.modifiers().debtLimit > 0 && canPay(game, price);
  }

  /**
   * Hodnocení žolíka (vzácnost × kategorie × synergie se stylem × edice × nálepky). Štítky a nečíselné `params`
   * (`suit`, `hand`, `level`) říkají, kdy žolík nic nedá: spotřebkový žolík bez spotřebek v obsahu, žolík na úroveň
   * kombinace, kterou nejde zvýšit, kopírující žolík bez žolíků ke kopírování.
   */
  private jokerRating(game: Game, joker: JokerInstance): number {
    const reg = game.registry;
    const def = reg.jokers[joker.defId];
    if (!def) return 0;
    if (joker.perishRounds === 0) return 0;
    let r = RARITY_VALUE[def.rarity] ?? 1;
    let tagMult = 1;
    for (const tag of def.tags) tagMult = Math.max(tagMult, TAG_VALUE[tag] ?? 1);
    r *= tagMult;
    const ante = game.state.ante;
    const params = def.params ?? {};
    const onlyChips = def.tags.includes('chips') && !def.tags.includes('mult') && !def.tags.includes('xmult');
    if (onlyChips && ante >= 5) r *= 0.8;
    if (def.tags.includes('economy')) r *= ante <= 3 ? (this.style.fullReserve ? 1.4 : 1.1) : 0.8;
    const handParams = Object.values(params).filter((v): v is string => typeof v === 'string');
    if (handParams.some((h) => this.wantsHand(game, h as HandType))) r *= 1.4;
    if (this.style.suitFocus && def.tags.includes('suit')) r *= 1.35;
    // Barevný žolík na barvu, kterou už chtějí jiní žolíci (nebo hlavní barvu balíčku u stylu `flush`).
    const suit = typeof params.suit === 'string' ? (SUITS as readonly string[]).indexOf(params.suit) : -1;
    if (suit >= 0) {
      const favored = suitFavor(game)[suit]! > 0 || (this.style.suitFocus && mainDeckSuit(game) === suit);
      if (favored) r *= 1.25;
    }
    if (this.style.rankFocus && (def.tags.includes('rank') || def.tags.includes('hand'))) r *= 1.15;
    // Spotřebkový žolík bez spotřebek v obsahu hry nic nedá.
    if (def.tags.includes('consumable') && Object.keys(reg.consumables).length === 0) r *= DEAD_JOKER_VALUE;
    // Žolík na úroveň kombinace (`params.level`): bez možnosti úrovně zvyšovat a pod tou úrovní nic nedá.
    if (typeof params.level === 'number' && maxHandLevel(game) < params.level)
      r *= canLevelUp(game) ? 0.8 : DEAD_JOKER_VALUE;
    // Kopírující žolík potřebuje aspoň dva jiné žolíky, aby měl z čeho vybírat.
    if (def.tags.includes('copy') && game.state.jokers.filter((j) => j.uid !== joker.uid).length < 2)
      r *= 0.6;
    if (joker.edition) r *= EDITION_VALUE[joker.edition] ?? 1;
    for (const st of joker.stickers) r *= STICKER_VALUE[st] ?? 1;
    return r;
  }

  private worstJoker(game: Game): { uid: number; rating: number } | null {
    let worst: { uid: number; rating: number } | null = null;
    for (const j of game.state.jokers) {
      if (j.stickers.includes('eternal')) continue;
      const rating = this.jokerRating(game, j);
      if (!worst || rating < worst.rating) worst = { uid: j.uid, rating };
    }
    return worst;
  }

  /** Peníze navíc nad rezervu na úrok (po zaplacení `price` zbyde aspoň `extra`). */
  private surplus(game: Game, price: number, extra: number): boolean {
    return this.affordable(game, price, extra);
  }

  /**
   * Kolik bot „cítí“ z ceny (0,35–1): peníze hluboko nad rezervou na úrok nic nevydělají, takže s nimi stačí
   * menší hodnota za korunu (bot jinak v pozdních patrech jen hromadí).
   */
  private priceFactor(game: Game): number {
    const free = game.state.money - this.reserve(game);
    return 1 - (1 - MIN_PRICE_FACTOR) * clamp((free - FREE_MONEY_FROM) / FREE_MONEY_SPAN, 0, 1);
  }

  /** Stojí položka za `price` s hodnotou `worth` (Kč) za koupi? Poměr × pocit z ceny a peníze nad rezervou. */
  private worthBuying(game: Game, worth: number, price: number, ratio: number): boolean {
    return worth >= price * ratio * this.priceFactor(game) && this.affordable(game, price);
  }

  /**
   * Nákup nebo výměna žolíka: nejlépe hodnocená nabídka nad `minJokerRating`, do volného slotu (i na dluh, když to
   * dluhový limit dovolí), při plných slotech prodá nejslabšího, je-li nabídka o 30 % lepší.
   */
  private jokerPurchase(game: Game): Action | null {
    const shop = game.state.shop;
    if (!shop || !this.style.buysJokers) return null;
    const offers = shop.items
      .map((it, i) => ({ it, i }))
      .filter(
        (x): x is { it: ShopItem & { kind: 'joker' }; i: number } => x.it.kind === 'joker' && !x.it.sold,
      )
      .map((x) => ({ ...x, rating: this.jokerRating(game, x.it.joker) }))
      .sort((a, b) => b.rating - a.rating || a.i - b.i);
    for (const o of offers) {
      if (o.rating < this.style.minJokerRating) continue;
      if (jokerRoom(game, o.it.joker)) {
        if (this.affordable(game, o.it.price) || this.debtAffordable(game, o.it.price))
          return { type: 'buy', slot: o.i };
        continue;
      }
      const worst = this.worstJoker(game);
      if (worst && o.rating > worst.rating * UPGRADE_RATIO) {
        const net = o.it.price - game.sellValue(worst.uid);
        if (this.affordable(game, net)) return { type: 'sellJoker', uid: worst.uid };
      }
    }
    return null;
  }

  /** Pranostiky, které teď může nabídnout obchod nebo obálka (tajné až po objevu). */
  private offeredHands(game: Game): HandType[] {
    const reg = game.registry;
    const hands = new Set<HandType>();
    for (const def of Object.values(reg.consumables)) {
      if (!def.hand || def.noShop || (def.weight ?? 1) <= 0) continue;
      if (reg.handTypes[def.hand]?.secret && !game.state.discoveredHands.includes(def.hand)) continue;
      hands.add(def.hand);
    }
    return [...hands];
  }

  /** Odhad hodnoty obálky před otevřením (Kč): nejlepší z `options` možností, × počet výběrů. */
  private boosterWorth(game: Game, view: ValueView, def: BoosterDef | undefined): number {
    if (!def) return 0;
    const picks = Math.max(1, def.picks);
    switch (def.kind) {
      case 'joker': {
        if (!this.style.buysJokers) return 0;
        const free = game.modifiers().jokerSlots - game.state.jokers.length;
        if (free <= 0) return BOOSTER_JOKER_FULL_KC;
        return (1.2 + 0.12 * (def.options - 2)) * JOKER_KC * Math.min(picks, free);
      }
      case 'pranostika': {
        const values = this.offeredHands(game).map((h) => levelWorth(view, h));
        return expectedMaxOfK(values, def.options) * (picks > 1 ? 1.7 : 1);
      }
      case 'rada':
        return (
          ((BOOSTER_RADA_KC + 0.25 * (def.options - 3)) * (feedsOnConsumables(game) ? FEED_BOOSTER_MULT : 1) +
            view.holdWorth) *
          picks
        );
      case 'razitko':
        return (BOOSTER_RAZITKO_KC + 0.3 * (def.options - 2) + view.holdWorth) * picks;
      case 'card':
        return (this.style.suitFocus || this.style.rankFocus ? 1.2 : 0.6) * picks;
      default:
        return 0;
    }
  }

  /**
   * Večerka (v tomto pořadí): žolík, dokud jich je málo (síla hned); kupóny podle hodnoty ze sondy (změna
   * modifikátorů a patra proti ceně); žolíci a výměny; pranostiky na hrané kombinace a spotřebky bez cíle, které
   * se hned vyplatí (koupit a použít); spotřebky s cílem a obálky podle odhadu hodnoty, s penězi navíc i slabší;
   * přehození, když je místo nebo slabý žolík k výměně a peníze nad rezervou.
   */
  private shopAction(game: Game, rng: Rng): Action {
    const s = game.state;
    const shop = s.shop;
    const leave: Action = { type: 'leaveShop' };
    if (!shop) return leave;
    const reg = game.registry;
    const view = this.view(game);
    const snapshot = JSON.stringify(s);

    // 1) žolík, dokud jich je málo
    const jokerBuy = this.jokerPurchase(game);
    const few = s.jokers.length < Math.min(game.modifiers().jokerSlots, s.ante + 1);
    if (few && jokerBuy) return jokerBuy;

    // 2) kupóny podle hodnoty
    for (let i = 0; i < shop.vouchers.length; i++) {
      const v = shop.vouchers[i]!;
      if (v.sold || !this.affordable(game, v.price)) continue;
      const action: Action = { type: 'buyVoucher', slot: i };
      const d = sampledDelta(view, action, `voucher:${v.voucherId}`, 1, snapshot);
      if (d && this.worthBuying(game, d.total + v.price, v.price, VOUCHER_RATIO)) return action;
    }

    // 3) žolíci (nákup, výměna)
    if (jokerBuy) return jokerBuy;

    // 4) spotřebky (s žolíkem ×mult za držené spotřebky i „do zásoby“ do slotu)
    const hold = view.holdWorth;
    const feeds = feedsOnConsumables(game);
    for (let i = 0; i < shop.items.length; i++) {
      const it = shop.items[i]!;
      if (it.kind !== 'consumable' || it.sold) continue;
      const def = reg.consumables[it.consumable.defId];
      if (!def) continue;
      const buyUse: Action = { type: 'buyAndUse', slot: i };
      const buy: Action = { type: 'buy', slot: i };
      const room = consumableRoom(game);
      if (def.hand) {
        const worth = levelWorth(view, def.hand);
        if (
          worth > hold &&
          this.worthBuying(game, worth, it.price, PRANOSTIKA_RATIO) &&
          this.validOnClone(game, rng, buyUse)
        )
          return buyUse;
        if (hold > 0 && room && this.worthBuying(game, hold, it.price, 1)) return buy;
      } else if (!def.target) {
        if (!this.affordable(game, it.price)) continue;
        const d = sampledDelta(view, buyUse, `buy:${it.consumable.uid}`, PROBE_SAMPLES, snapshot);
        if (
          d &&
          this.worthBuying(game, d.total + it.price, it.price, 1) &&
          this.worthUsing(game, { total: d.total + it.price, money: d.money + it.price })
        )
          return buyUse;
        if (hold > 0 && room && this.worthBuying(game, hold, it.price, 1)) return buy;
      } else if (
        room &&
        (this.surplus(game, it.price, SURPLUS_TARGET_KC) ||
          ((feeds || hold > 0) && this.affordable(game, it.price)))
      ) {
        return buy;
      }
    }

    // 5) obálky
    for (let i = 0; i < shop.boosters.length; i++) {
      const b = shop.boosters[i]!;
      if (b.sold) continue;
      const worth = this.boosterWorth(game, view, reg.boosters[b.boosterId]);
      if (this.worthBuying(game, worth, b.price, BOOSTER_RATIO)) return { type: 'buyBooster', slot: i };
    }

    // 6) přehození: s místem pro žolíka (peníze ≥ 2× cena nad rezervou, DESIGN 12.2), nebo se slabým žolíkem
    // k výměně (peníze navíc)
    const hasJokers = Object.keys(reg.jokers).length > 0;
    if (this.style.rerolls && this.style.buysJokers && hasJokers && canPay(game, shop.rerollCost)) {
      const free = s.money - this.reserve(game);
      const room = jokerRoom(game);
      const worst = room ? null : this.worstJoker(game);
      const upgrade = Boolean(worst && worst.rating < UPGRADE_WORST_MAX);
      const limit = free >= REROLL_RICH_KC ? MAX_SHOP_REROLLS_RICH : MAX_SHOP_REROLLS;
      if (
        shop.rerollsThisShop < limit &&
        ((room && free >= 2 * shop.rerollCost) || (upgrade && free >= shop.rerollCost + REROLL_UPGRADE_KC))
      )
        return { type: 'reroll' };
    }
    return leave;
  }

  /** Ověří nejistou akci (neznámá spotřebka, `canUse`) na kopii hry — bot nemá posílat neplatné akce. */
  private validOnClone(game: Game, rng: Rng, action: Action): boolean {
    return cloneGame(game, rng).dispatch(action).ok;
  }

  // ── obálky ──

  /**
   * Výběr z obálky: každou možnost ocení — žolíka hodnocením (při plných slotech nejdřív prodá nejslabšího, je-li
   * nový o 30 % lepší), hrací kartu přínosem pro balíček, spotřebku sondou (pranostika, spotřebka bez cíle použitá
   * hned nebo uložená na později, spotřebka s cílem na nejlepší karty z ruky obálky). Nic kladného → přeskočit.
   */
  private boosterAction(game: Game): Action {
    const s = game.state;
    const b = s.booster;
    const skip: Action = { type: 'skipBooster' };
    if (!b) return skip;
    const reg = game.registry;
    const view = this.view(game);
    const snapshot = JSON.stringify(s);
    const n = Math.max(1, s.deck.length);
    const avg = view.deckWorth / 52;
    let best: { score: number; action: Action } | null = null;
    const offer = (score: number, action: Action): void => {
      if (!best || score > best.score) best = { score, action };
    };
    b.options.forEach((opt, index) => {
      const pick: Action = { type: 'pickBooster', index };
      if (opt.kind === 'joker') {
        if (!this.style.buysJokers) return;
        const rating = this.jokerRating(game, opt.joker);
        if (jokerRoom(game, opt.joker)) {
          offer(rating * JOKER_KC, pick);
          return;
        }
        const worst = this.worstJoker(game);
        if (worst && rating > worst.rating * UPGRADE_RATIO)
          offer((rating - worst.rating) * JOKER_KC - 0.5, { type: 'sellJoker', uid: worst.uid });
      } else if (opt.kind === 'card') {
        offer(((cardWorth(view, opt.card) - avg) * 52) / (n + 1), pick);
      } else {
        const def = reg.consumables[opt.consumable.defId];
        if (!def) return;
        const key = `pick:${opt.consumable.uid}`;
        const keep: Action = { type: 'pickBooster', index, keep: true };
        const room = consumableRoom(game);
        if (def.hand || !def.target) {
          const d = sampledDelta(view, pick, key, def.hand ? 1 : PROBE_SAMPLES, snapshot);
          if (d && (def.hand || this.worthUsing(game, d))) offer(d.total, pick);
          if (room && (!d || !this.worthUsing(game, d) || view.holdWorth > 0))
            offer((d ? Math.max(0, d.total) * KEEP_FACTOR : KEEP_KC) + view.holdWorth, keep);
          return;
        }
        const plan = planTargets(
          view,
          def,
          b.hand,
          (targets) => ({ type: 'pickBooster', index, targetIds: targets }),
          key,
          snapshot,
        );
        if (plan)
          offer(plan.value, withOrder(b.hand, plan, { type: 'pickBooster', index, targetIds: plan.targets }));
        if (room && (!plan || view.holdWorth > 0)) offer(KEEP_KC + view.holdWorth, keep);
      }
    });
    const chosen = best as { score: number; action: Action } | null;
    return chosen && chosen.score >= PICK_MIN ? chosen.action : skip;
  }
}

/** Má bot žolíka, kterého použité spotřebky „krmí“ (štítky `consumable` a `scaling` — Kořenářka)? */
function feedsOnConsumables(game: Game): boolean {
  return game.state.jokers.some((j) => {
    const tags = game.registry.jokers[j.defId]?.tags ?? [];
    return !j.debuffed && tags.includes('consumable') && tags.includes('scaling');
  });
}

/** Ruka, na kterou teď míří spotřebky (ruka kola nebo obálky), nebo null. */
function targetPoolOf(s: Readonly<RunState>): readonly number[] | null {
  if (s.phase === 'booster' && s.booster && s.booster.hand.length > 0) return s.booster.hand;
  if (s.phase === 'round' && s.round) return s.round.hand;
  return null;
}

/** Spotřebky s cílem bot zkouší v obálce a v kole jen na začátku (dokud se nehrálo ani nezahazovalo). */
function targetMoment(s: Readonly<RunState>): boolean {
  if (s.phase === 'booster') return true;
  return s.phase === 'round' && !!s.round && s.round.handsPlayed === 0 && s.round.discardsUsed === 0;
}

/**
 * Akce s cíli, nebo nejdřív přeřazení ruky, když na pořadí cílů záleží (levá/pravá karta) a ruka ho nemá —
 * cíle dá doleva v pořadí plánu. Plán nezávisí na pořadí ruky, takže další rozhodnutí akci provede.
 */
function withOrder(pool: readonly number[], plan: TargetPlan, action: Action): Action {
  if (!plan.ordered || plan.targets.length < 2) return action;
  const pos = plan.targets.map((id) => pool.indexOf(id));
  if (pos.every((p, i) => i === 0 || p > pos[i - 1]!)) return action;
  return {
    type: 'reorderHand',
    cardIds: [...plan.targets, ...pool.filter((id) => !plan.targets.includes(id))],
  };
}

// ─────────────────────────── Náhodný bot ───────────────────────────

/** Náhodné legální akce (baseline, DESIGN 12.1: má prohrát v patrech 1–2 ve > 90 % runů). */
class RandomBot implements Bot {
  readonly name = 'random';

  decide(game: Game): Action {
    const rng = decisionRng(game, this.name);
    const s = game.state;
    const mods = game.modifiers();
    switch (s.phase) {
      case 'blind_select': {
        const blind = s.blinds[s.blindIndex];
        if (blind && blind.kind !== 'boss' && rng.next() < 0.2) return { type: 'skipBlind' };
        return { type: 'selectBlind' };
      }
      case 'round': {
        const round = s.round as RoundState;
        const hand = [...round.hand];
        const k = rng.int(1, Math.max(1, Math.min(mods.maxSelect, hand.length)));
        const ids = rng.shuffle(hand).slice(0, k);
        if (round.discardsLeft > 0 && rng.next() < 0.35) return { type: 'discard', cardIds: ids };
        return { type: 'play', cardIds: ids };
      }
      case 'round_end':
        return { type: 'cashOut' };
      case 'shop': {
        const shop = s.shop;
        const leave: Action = { type: 'leaveShop' };
        if (!shop) return leave;
        const acts: Action[] = [leave, leave, leave];
        shop.items.forEach((it, slot) => {
          if (it.sold || !canPay(game, it.price)) return;
          if (it.kind === 'joker' && !jokerRoom(game, it.joker)) return;
          if (it.kind === 'consumable' && !consumableRoom(game)) return;
          acts.push({ type: 'buy', slot });
        });
        shop.boosters.forEach((b, slot) => {
          if (!b.sold && canPay(game, b.price)) acts.push({ type: 'buyBooster', slot });
        });
        shop.vouchers.forEach((v, slot) => {
          if (!v.sold && canPay(game, v.price)) acts.push({ type: 'buyVoucher', slot });
        });
        if (shop.rerollsThisShop < RANDOM_MAX_SHOP_REROLLS && canPay(game, shop.rerollCost))
          acts.push({ type: 'reroll' });
        return rng.pick(acts);
      }
      case 'booster': {
        const b = s.booster;
        const skip: Action = { type: 'skipBooster' };
        if (!b) return skip;
        const acts: Action[] = [skip];
        b.options.forEach((opt, index) => {
          if (opt.kind === 'joker') {
            if (jokerRoom(game, opt.joker)) acts.push({ type: 'pickBooster', index });
          } else if (opt.kind === 'card') {
            acts.push({ type: 'pickBooster', index });
          } else if (consumableRoom(game)) {
            acts.push({ type: 'pickBooster', index, keep: true });
          }
        });
        return rng.pick(acts);
      }
      case 'victory':
        return { type: 'continueEndless' };
      default:
        return { type: 'selectBlind' };
    }
  }
}

/** Nová instance bota. Bot nemá stav (rozhodnutí = funkce stavu hry), instanci lze sdílet mezi runy i prokládaně. */
export function createBot(name: BotName): Bot {
  return name === 'random' ? new RandomBot() : new StrategyBot(STYLES[name]);
}
