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
import { FINAL_ANTE, RENTAL_FEE, RENTAL_INSTALLMENTS } from '../constants';
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
} from '../types';
import { HAND_TYPES, SUITS } from '../types';
import {
  analyzeCards,
  bestUtility,
  blockedTypes,
  cardValue,
  cloneGame,
  exactPlayScore,
  exactScale,
  makeEnv,
  planCandidates,
  type CardValue,
  type EvalEnv,
  type PlayCandidate,
} from './hand-eval';
import { LAB_SAMPLES, makeLab, type BuildLab } from './lab';
import type { Bot, BotName } from './types';
import {
  cardWorth,
  clamp,
  expectedMaxOfK,
  JOKER_KC,
  levelWorth,
  makeView,
  planTargets,
  probe,
  probeSeed,
  roundsLeft,
  sampledDelta,
  heldTagMoney,
  stateDelta,
  voucherWorth,
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

// ─────────────────────────── Měřená hodnota žolíků (src/engine/sim/lab.ts) ───────────────────────────

/**
 * Ladicí čísla měřeného oceňování (src/engine/sim/lab.ts). Objekt je měnitelný jen kvůli experimentům simulace
 * (scratch skripty mění hodnoty před během); hra ani testy ho nemění.
 */
export const BOT_TUNING = {
  /** Kč za jednotku ln(skóre typických rukou) — ×1,5 ve skórování ≈ 18 Kč. */
  powerKc: 45,
  /** Žolík bez skórovacího efektu (ekonomika, užitek): heuristika × tolik Kč za jednotku hodnocení. */
  nonScoringKc: 4,
  /** Ekonomická a škálovací složka skórujícího žolíka (Kč × vzácnost, do konce runu). */
  econExtraKc: 3,
  scalingExtraKc: 3,
  /** Koupit žolíka do volného slotu, když měřená hodnota ≥ cena × poměr × pocit z ceny (při málo žolících nižší). */
  jokerBuyRatio: 0.8,
  jokerFewRatio: 0.45,
  /** Výměna žolíka: zisk musí převýšit čistou cenu (cena − prodej) × poměr + rezervu. */
  jokerSwapRatio: 1,
  jokerSwapMarginKc: 1.5,
  /** Apriorní hodnota +1 úrovně kombinace (Kč × podíl na historii runu / oblíbenost stylu). */
  levelPriorKc: 2,
  /** Váha měřené hodnoty úrovně hlavní kombinace buildu a ostatních kombinací. */
  mainLevelMult: 2,
  otherLevelMult: 0.5,
  /** Počet typických rukou laboratoře. */
  labSamples: LAB_SAMPLES,
};
/** Štítky efektů, které se projeví přímo ve skórování (měří je laboratoř). */
const SCORING_TAGS: readonly JokerTag[] = ['chips', 'mult', 'xmult', 'retrigger', 'copy'];
/** Negativní edice nezabírá slot. */
const NEGATIVE_EXTRA_KC = 5;
/** Nejnižší hodnota +1 úrovně kombinace (Kč). */
const LEVEL_FLOOR_KC = 0.4;
/** Rychlé síto nabídek žolíků: tolik typických rukou; nabídka pod potřebou o víc než `QUICK_SKIP_KC` vypadne. */
const QUICK_SAMPLES = 3;
const QUICK_SKIP_KC = 3;

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
/** S volným slotem +1 přehození za každých `REROLL_RICH_KC` Kč nad rezervou, celkem nejvýš `MAX_SHOP_REROLLS_RICH`. */
const MAX_SHOP_REROLLS_RICH = 6;
const REROLL_RICH_KC = 10;
/** S plnými sloty přehazovat jen s penězi nad rezervou aspoň cena + tolik (1 přehození za každých tolik Kč). */
const REROLL_UPGRADE_KC = 6;
/** Rezerva na úrok se rozpouští: za posledních tolik kol 0, za dvojnásobek polovina. */
const RESERVE_END_ROUNDS = 3;

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
/** Vzorků přesného skóre kandidáta, když skórování závisí na náhodě (průměr; v poslední ruce kola minimum). */
const CHANCE_SAMPLES = 2;
const CHANCE_SAMPLES_LAST = 3;
/**
 * Hodnota karty lícem dolů pro držení: bot ji nezná (pravidlo šéfa), počítá s průměrnou kartou — viditelné slabé
 * karty mimo kombinace jdou pryč dřív, silnější a rozehrané zůstanou.
 */
const FACE_DOWN_KEEP = 7;
/** Přeskakovat útraty až po tolika zahraných rukách runu (`RunStats.handsPlayed`). */
const SKIP_MIN_HANDS = 4;
/** Vzorků ruky pro odhad síly buildu před přeskočením útraty. */
const STRENGTH_SAMPLES = 4;
/**
 * Přeskočení útraty za štítek (src/engine/sim/bots.ts `blindChoice`): co bot ztratí — odměnu za útratu, peníze
 * za nevyužité ruce (odhad `SKIP_UNUSED_HANDS` rukou), úrok a návštěvu Večerky (`SHOP_VISIT_KC`).
 */
const SKIP_UNUSED_HANDS = 1.5;
const SHOP_VISIT_KC = 3;
/** Štítek musí mít aspoň tolikanásobek ztráty. */
const SKIP_VALUE_RATIO = 1.1;
/** Síla buildu (průměrná nejlepší ruka × ruce) musí být aspoň tolikrát nad cílem následující útraty. */
const SKIP_SAFETY = 2.5;
/** Sond na hodnotu štítku (štítky s náhodou — Bazar u silnice). */
const SKIP_PROBES = 2;
/** Štítek, který čeká na později (příští Večerka, příští kolo) a jehož účinek sonda hned nevidí. */
const DEFERRED_TAG_KC = 4;
/** Nižší cíl šéfa (Šéf má chřipku): Kč za celý cíl (× poměrné snížení). */
const BOSS_TARGET_KC = 40;
/**
 * Přelosovat šéfa, když odhad „síla × ruce / cíl“ pod jeho pravidlem klesne pod tolikanásobek téhož odhadu bez pravidla
 * (běžný šéf 2×) a zároveň pod `BOSS_REROLL_SAFE` (s velkou rezervou není co řešit).
 */
const BOSS_REROLL_RATIO = 0.75;
const BOSS_REROLL_SAFE = 3;

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
  /**
   * Laboratoř buildu pro **jedno** rozhodnutí (líně vytvořená, na začátku každého `decide` zahozená) — bot tak
   * mezi rozhodnutími nic nedrží; výsledky skórování sdílí jen čistá paměť v lab.ts.
   */
  private labCache: { game: Game; lab: BuildLab } | null = null;

  constructor(private readonly style: Style) {
    this.name = style.name;
  }

  decide(game: Game): Action {
    this.labCache = null;
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
    // Pořadí: +čipy/+mult vlevo, ×mult vpravo; pod pravidlem šéfa, které vypíná pozice (Jednooký hejtman),
    // nejlepší žolíci na fungující pozice.
    if (s.jokers.length > 1) {
      const uids = this.jokerOrder(game);
      if (uids.some((uid, i) => s.jokers[i]?.uid !== uid)) return { type: 'reorderJokers', uids };
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

  /**
   * Cílové pořadí žolíků (uid): +čipy/+mult vlevo, ×mult vpravo (stabilně podle dosavadního pořadí). Když pravidlo
   * šéfa vypíná žolíky podle pozice (`positionalDebuffs`), dostanou fungující pozice nejlépe hodnocené žolíky
   * (v rámci fungujících i vypnutých pozic zase podle klíče pořadí). Výsledek nezávisí na současném pořadí víc,
   * než je nutné (stabilní řazení), takže po přeřazení bot znovu nepřeřazuje.
   */
  private jokerOrder(game: Game): number[] {
    const s = game.state;
    const keyed = s.jokers.map((j, i) => ({ j, i, key: slotOrderKey(game, j) }));
    const byKey = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => a.key - b.key || a.i - b.i;
    const base = [...keyed].sort(byKey);
    const off = positionalDebuffs(
      game,
      base.map((x) => x.j.uid),
    );
    if (off.size === 0 || off.size >= s.jokers.length) return base.map((x) => x.j.uid);
    const safeCount = s.jokers.length - off.size;
    // Žolík vypnutý jinak než pozicí (Exekutor) nefunguje nikde — fungující pozici nepotřebuje.
    const ruled = new Set(s.round?.ruleJokerDebuffs ?? []);
    // Hodnota žolíka z kanonického pořadí (klíč, uid) — nezávisí na současném pořadí, jinak by se bot přeřazoval
    // donekonečna.
    const canon = [...s.jokers].sort(
      (a, b) => slotOrderKey(game, a) - slotOrderKey(game, b) || a.uid - b.uid,
    );
    const lab = this.lab(game);
    const v = lab.variants(canon);
    const rating = (j: JokerInstance): number =>
      j.debuffed && !ruled.has(j.uid) ? 0 : this.powerKc(v.without(j.uid), v.total) + this.extrasKc(game, j);
    const ranked = [...keyed].sort((a, b) => rating(b.j) - rating(a.j) || a.i - b.i);
    const good = ranked.slice(0, safeCount).sort(byKey);
    const rest = ranked.slice(safeCount).sort(byKey);
    const out: number[] = [];
    for (let i = 0; i < s.jokers.length; i++) out.push((off.has(i) ? rest : good).shift()!.j.uid);
    return out;
  }

  /** Ocenění stavu pro toto rozhodnutí (src/engine/sim/value.ts) s měřenou hodnotou úrovní a žolíků. */
  private view(game: Game): ValueView {
    return makeView(
      game,
      this.style,
      makeEnv(game, this.handPref(game)),
      mainDeckSuit(game),
      (g, j) => this.jokerRating(g, j),
      {
        levelKc: (hand) => this.levelKc(game, hand),
        jokersDelta: (after) => this.jokersDelta(game, after.state.jokers),
      },
    );
  }

  // ── laboratoř buildu: měřená hodnota žolíků a úrovní ──

  /** Laboratoř pro skutečnou hru tohoto rozhodnutí (líně, jednou za `decide`). */
  private lab(game: Game): BuildLab {
    if (this.labCache?.game === game) return this.labCache.lab;
    const favor = suitFavor(game);
    const lab = makeLab(
      game,
      makeEnv(game, this.handPref(game)),
      (cards) => this.filler(cards, drawInfo(cards, favor)),
      this.name,
      BOT_TUNING.labSamples,
    );
    this.labCache = { game, lab };
    return lab;
  }

  /** Sestava v pořadí, které by bot nastavil (+čipy/+mult vlevo, ×mult vpravo; stabilně). */
  private ordered(game: Game, jokers: readonly JokerInstance[]): JokerInstance[] {
    const tags = (j: JokerInstance): readonly JokerTag[] => game.registry.jokers[j.defId]?.tags ?? [];
    return jokers
      .map((j, i) => ({ j, i, key: jokerOrderKey(tags(j)) }))
      .sort((a, b) => a.key - b.key || a.i - b.i)
      .map((x) => x.j);
  }

  /** Podíl zbytku runu, po který žolík bude fungovat (zvětrávající jen `perishRounds` kol). */
  private activeShare(game: Game, j: JokerInstance): number {
    if (j.perishRounds === undefined) return 1;
    return clamp(j.perishRounds / roundsLeft(game), 0, 1);
  }

  /**
   * Nečíselná složka hodnoty žolíka v Kč: žolík bez skórovacího efektu podle heuristiky (`jokerRating`),
   * skórující žolík s ekonomikou nebo růstem navíc paušál do konce runu; negativní edice (slot navíc), nájem.
   */
  private extrasKc(game: Game, j: JokerInstance): number {
    const def = game.registry.jokers[j.defId];
    if (!def) return 0;
    const left = roundsLeft(game);
    const rarity = RARITY_VALUE[def.rarity] ?? 1;
    let v = 0;
    if (!def.tags.some((t) => SCORING_TAGS.includes(t)))
      v += this.jokerRating(game, j) * BOT_TUNING.nonScoringKc;
    else {
      if (def.tags.includes('economy')) v += BOT_TUNING.econExtraKc * rarity * clamp(left / 12, 0, 1);
      if (def.tags.includes('scaling')) v += BOT_TUNING.scalingExtraKc * rarity * clamp(left / 15, 0, 1);
      v *= this.activeShare(game, j);
    }
    if (j.edition === 'negative') v += NEGATIVE_EXTRA_KC;
    // Na splátky: zbývající splátky (nejvýš do konce runu), pak je žolík bota.
    if (j.stickers.includes('rental'))
      v -= RENTAL_FEE * Math.min(left, Math.max(0, RENTAL_INSTALLMENTS - (j.rentalPaid ?? 0)));
    return v;
  }

  /** Kč za změnu skóre typických rukou z `from` na `to`. */
  private powerKc(from: number, to: number): number {
    return BOT_TUNING.powerKc * Math.log((to + 1) / (from + 1));
  }

  /** Kč, o které by sestava `jokers` (v pořadí bota) byla lepší než současná sestava. */
  private jokersDelta(game: Game, jokers: readonly JokerInstance[]): number {
    const cur = game.state.jokers;
    const same =
      jokers.length === cur.length &&
      jokers.every((j, i) => {
        const c = cur[i]!;
        return c.uid === j.uid && c.defId === j.defId && c.edition === j.edition;
      });
    if (same) return 0;
    const lab = this.lab(game);
    let extras = 0;
    for (const j of jokers) extras += this.extrasKc(game, j);
    for (const j of cur) extras -= this.extrasKc(game, j);
    return this.powerKc(lab.base, lab.score(this.ordered(game, [...jokers]))) + extras;
  }

  /**
   * Měřená hodnota žolíka `j` v Kč: přidání do sestavy proti současné sestavě (skórovací část × podíl zbytku runu,
   * kdy žolík funguje — zvětrávání) a nejlepší výměna: sestava s `j` bez jednoho vlastního žolíka (mimo přibité),
   * odhadnutá přehráním z téhož přepočtu. `swap` = null, když není koho prodat.
   */
  private offerKc(
    game: Game,
    j: JokerInstance,
    samples?: number,
  ): { add: number; swap: { uid: number; kc: number } | null } {
    const lab = this.lab(game);
    const cur = game.state.jokers;
    const v = lab.variants(this.ordered(game, [...cur, j]), samples);
    const share = this.activeShare(game, j);
    const extra = this.extrasKc(game, j);
    const add = this.powerKc(v.base, v.total) * share + extra;
    let swap: { uid: number; kc: number } | null = null;
    for (const w of cur) {
      if (w.stickers.includes('eternal')) continue;
      const kc = this.powerKc(v.base, v.without(w.uid)) * share + extra - this.extrasKc(game, w);
      if (!swap || kc > swap.kc) swap = { uid: w.uid, kc };
    }
    return { add, swap };
  }

  /** Měřená hodnota žolíka `j` přidaného do volného slotu (Kč). */
  private addKc(game: Game, j: JokerInstance): number {
    return this.offerKc(game, j).add;
  }

  /**
   * +1 úroveň kombinace v Kč: změna skóre typických rukou (laboratoř přepočte vzorky zahrané touto kombinací),
   * u kombinace, kterou bot v typických rukou nehraje, jen malá apriorní hodnota podle oblíbenosti a historie runu.
   */
  private levelKc(game: Game, hand: HandType): number {
    const lab = this.lab(game);
    const measured = lab.typeShare[hand] ? this.powerKc(lab.base, lab.levelUp(hand)) : 0;
    const played = game.state.stats.handTypeCounts[hand] ?? 0;
    const total = Math.max(1, game.state.stats.handsPlayed);
    const prior = (this.style.favorHands.includes(hand) ? 0.6 : 0) + (0.8 * played) / total;
    // Hlavní kombinace: úrovně se sčítají přes celý run a každá další ji dělá hranější — bot do ní investuje víc
    // než do ostatních (ty jen poloviční vahou).
    const focus = hand === this.mainHand(game) ? BOT_TUNING.mainLevelMult : BOT_TUNING.otherLevelMult;
    // Úroveň čehokoli má aspoň malou cenu (pranostiku je lepší použít než držet, z obálky vzít než přeskočit).
    return Math.max(LEVEL_FLOOR_KC, focus * measured + BOT_TUNING.levelPriorKc * prior);
  }

  /**
   * Hlavní kombinace buildu: nejčastější tah typických rukou (laboratoř vybírá tah podle úrovní a preferencí bota)
   * s přihlédnutím k historii runu; při shodě vyšší úroveň.
   */
  private mainHand(game: Game): HandType | null {
    const lab = this.lab(game);
    const counts = game.state.stats.handTypeCounts;
    const total = Math.max(1, game.state.stats.handsPlayed);
    let best: HandType | null = null;
    let bestScore = 0;
    for (const t of HAND_TYPES) {
      const score =
        (lab.typeShare[t] ?? 0) +
        (0.5 * (counts[t] ?? 0)) / total +
        0.01 * (game.state.handLevels[t]?.level ?? 1);
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
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

  /**
   * Přeskočit útratu? Jen za štítek, který má víc než to, o co bot přijde (`skipCost`: odměna, nevyužité ruce,
   * úrok, Večerka), a jen se silným buildem: průměrná nejlepší ruka × ruce ≥ `SKIP_SAFETY` × cíl následující
   * útraty (po Malé Velká, po Velké šéf). Odhad síly (kopie hry) až nakonec a jen tehdy, když na to stačí aspoň
   * nejlepší ruka runu (průměr ji skoro nikdy nepřekoná).
   */
  private blindChoice(game: Game, rng: Rng): Action {
    const s = game.state;
    const blind = s.blinds[s.blindIndex];
    const select: Action = { type: 'selectBlind' };
    if (blind?.kind === 'boss') return this.bossReroll(game, rng) ?? select;
    if (!blind || !blind.skipTagId || !this.style.skipBlinds || s.stats.handsPlayed < SKIP_MIN_HANDS)
      return select;
    const next = blind.kind === 'small' ? s.blinds[1] : s.blinds[2];
    if (!next) return select;
    const need = SKIP_SAFETY * game.blindTarget(next.kind, next.bossId);
    const hands = game.modifiers().hands;
    if (s.stats.bestHandScore * hands < need) return select;
    const cost = SKIP_VALUE_RATIO * this.skipCost(game, blind.kind);
    let sell: number | null = null;
    if (this.tagWorth(game) < cost) {
      // Štítek, který dá žolíka jen do volného slotu (Pouťová tombola), s plnými sloty: hráč nejdřív prodá
      // nejslabšího žolíka, když se mu to i se ztrátou vyplatí — pak už (s volným slotem) přeskočí.
      const weakest = this.style.buysJokers && !jokerRoom(game) ? this.weakestJoker(game) : null;
      if (weakest === null || this.tagWorth(game, weakest) < cost) return select;
      sell = weakest;
    }
    if (this.buildStrength(game, rng) * hands < need) return select;
    return sell !== null ? { type: 'sellJoker', uid: sell } : { type: 'skipBlind' };
  }

  /**
   * Přelosovat šéfa (kupóny Zpravodaj obce, Obecní rozhlas)? Jen na výběru útraty Šéf (bot ví nejvíc o buildu). Odhad
   * „síla × ruce / cíl“ (kopie hry v kole šéfa: nejlepší tah z rozdané ruky) pod pravidlem šéfa a bez něj (běžný šéf
   * 2×): když pravidlo tomuto buildu vezme víc než průměrný šéf (pod `BOSS_REROLL_RATIO` × odhad bez pravidla) a build
   * nemá velkou rezervu (`BOSS_REROLL_SAFE`), je náhodný jiný šéf lepší sázka. Bot pravidla nepoznává podle id.
   */
  private bossReroll(game: Game, rng: Rng): Action | null {
    const left = game.state.flags.bossRerolls;
    if (typeof left !== 'number' || left <= 0) return null;
    const ruled = this.roundEstimate(game, rng);
    // Totéž kolo bez pravidla šéfa (běžný šéf 2×) — srovnání odliší „těžký šéf“ od „slabého buildu“.
    const plain = this.roundEstimate(game, rng, (st) => {
      const slot = st.blinds[st.blindIndex];
      if (slot) slot.bossId = null;
    });
    if (!ruled || !plain || ruled.target <= 0 || plain.target <= 0) return null;
    const r = (ruled.strength * ruled.hands) / ruled.target;
    const p = (plain.strength * plain.hands) / plain.target;
    return r < BOSS_REROLL_RATIO * p && r < BOSS_REROLL_SAFE ? { type: 'rerollBoss' } : null;
  }

  /** Nejslabší vlastní žolík, kterého jde prodat (měřená ztráta sestavy bez něj + nečíselná složka), nebo null. */
  private weakestJoker(game: Game): number | null {
    const jokers = game.state.jokers;
    const v = this.lab(game).variants(this.ordered(game, [...jokers]));
    let best: { uid: number; kc: number } | null = null;
    for (const j of jokers) {
      if (j.stickers.includes('eternal')) continue;
      const kc = this.powerKc(v.without(j.uid), v.total) + this.extrasKc(game, j);
      if (!best || kc < best.kc) best = { uid: j.uid, kc };
    }
    return best?.uid ?? null;
  }

  /** O co bot přeskočením útraty přijde (Kč): odměna, nevyužité ruce, úrok a návštěva Večerky. */
  private skipCost(game: Game, kind: 'small' | 'big'): number {
    const m = game.modifiers();
    const interest =
      m.interestStep > 0
        ? Math.min(m.interestCap, Math.floor(Math.max(0, game.state.money) / m.interestStep)) * m.interestMult
        : 0;
    return game.blindReward(kind) + SKIP_UNUSED_HANDS * m.moneyPerUnusedHand + interest + SHOP_VISIT_KC;
  }

  /**
   * Hodnota štítku útraty (Kč) sondou — bot štítky nepoznává podle id: přeskočení zkusí na kopii hry a ocení změnu
   * stavu (peníze, úrovně, žolíci, spotřebky); obálku zdarma odhadem její hodnoty; štítek, který zůstal čekat,
   * podle nižšího cíle šéfa, podle peněz, které vyplatí nebo strhne v rozpisu odměn (`heldTagMoney` — splátka Půjčky
   * od tchána, Brigáda na chmelu), jinak paušálem `DEFERRED_TAG_KC`. `sellUid`: hodnota „prodat žolíka, pak
   * přeskočit“ (štítek, který dá žolíka jen do volného slotu).
   */
  private tagWorth(game: Game, sellUid: number | null = null): number {
    const s = game.state;
    const view = this.view(game);
    const snapshot = JSON.stringify(s);
    const boss = s.blinds[2];
    const owned = new Set(s.tags.map((t) => t.uid));
    let total = 0;
    for (let k = 0; k < SKIP_PROBES; k++) {
      const seed = probeSeed(game, `skip:${k}`);
      let clone = probe(
        game,
        sellUid === null ? { type: 'skipBlind' } : { type: 'sellJoker', uid: sellUid },
        seed,
        snapshot,
      );
      if (clone && sellUid !== null && !clone.dispatch({ type: 'skipBlind' }).ok) clone = null;
      if (!clone) return 0;
      let v = stateDelta(view, clone).total;
      const opened = clone.state.phase === 'booster' ? clone.state.booster : null;
      if (opened) v += this.boosterWorth(clone, view, game.registry.boosters[opened.boosterId]);
      const held = clone.state.tags.filter((t) => !owned.has(t.uid)).map((t) => t.uid);
      if (held.length > 0) {
        const before = boss ? game.blindTarget('boss', boss.bossId) : 0;
        const after = boss ? clone.blindTarget('boss', boss.bossId) : 0;
        if (before > 0 && after < before) v += BOSS_TARGET_KC * (1 - after / before);
        else {
          // Štítek, který vyplácí nebo strhává v rozpisu odměn (Brigáda na chmelu, splátka Půjčky od tchána):
          // dohrát kopii a sečíst rozpis; jinak paušál za štítek „na později“.
          const money = heldTagMoney(cloneGame(clone, rngFromState([...seed])), new Set(held));
          v += money !== 0 ? money : DEFERRED_TAG_KC;
        }
      }
      total += v;
    }
    return total / SKIP_PROBES;
  }

  /**
   * Síla buildu: průměrný odhad nejlepšího tahu z několika náhodných rukou. Ruka se rozdá na kopii hry
   * s přeseedovaným RNG (bot nezná pořadí balíčku) a ohodnotí stejně jako v kole — vč. žolíků a úrovní kombinací.
   */
  private buildStrength(game: Game, rng: Rng): number {
    return this.roundEstimate(game, rng)?.strength ?? 0;
  }

  /** Odhad kola aktuální útraty na kopii hry: síla buildu (viz `buildStrength`), ruce a cíl kola (i s pravidlem šéfa). */
  private roundEstimate(
    game: Game,
    rng: Rng,
    mutate?: (state: RunState) => void,
  ): { strength: number; hands: number; target: number } | null {
    let sum = 0;
    let hands = 0;
    let target = 0;
    for (let k = 0; k < STRENGTH_SAMPLES; k++) {
      const clone = cloneGame(game, rng, undefined, mutate);
      const round = clone.dispatch({ type: 'selectBlind' }).ok ? clone.state.round : null;
      if (!round || clone.state.phase !== 'round') return null;
      hands = round.handsLeft;
      target = round.target;
      const env = makeEnv(clone, this.handPref(clone));
      const hand = cardsOf(clone, round.hand).map((c) => cardValue(c, env));
      sum += this.rankedPlays(clone, rng, env, hand, drawInfo(hand, suitFavor(clone)), true)[0]?.raw ?? 0;
    }
    return { strength: sum / STRENGTH_SAMPLES, hands, target };
  }

  // ── kolo ──

  /** Hodnota karty pro držení (vyšší = nechat si): cena + příslušnost k rozehrané kombinaci podle stylu. */
  private keepScore(c: CardValue, info: DrawInfo): number {
    if (c.faceDown) return FACE_DOWN_KEEP;
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

  /**
   * Karty, kterých se bot chce zbavit (doplní jimi tah, aby se protočil balíček), od nejméně cenné. Karty lícem
   * dolů sem patří taky: s neznámou kartou nejde plánovat a zahraná skóruje normálně.
   */
  private filler(hand: readonly CardValue[], info: DrawInfo): CardValue[] {
    return hand
      .filter((c) => c.faceDown || c.debuffed || this.drawBonus(c, info) === 0)
      .sort((a, b) => this.keepScore(a, info) - this.keepScore(b, info) || a.id - b.id);
  }

  private needsExact(game: Game): boolean {
    return game.state.jokers.length > 0 || bossJudgesHand(game);
  }

  /** Prostředí hodnocení kola: preference, zákaz doplňování kartami lícem dolů pod šéfem, který soudí celou ruku. */
  private roundEnv(game: Game): EvalEnv {
    return { ...makeEnv(game, this.handPref(game)), hiddenPad: !bossJudgesHand(game) };
  }

  private roundAction(game: Game, rng: Rng): Action {
    const s = game.state;
    const round = s.round as RoundState;
    const env = this.roundEnv(game);
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
    if (best.raw < need && round.discardsLeft > 0 && !jokersReturnAfterHand(game, rng, best.ids)) {
      // Kombinace, které pravidlo šéfa zakázalo (Soused s vrtačkou), mají i v odhadu po zahození skóre 0.
      const blocked = blockedTypes(cands);
      const discardEnv = blocked.size > 0 ? { ...env, blocked } : env;
      // Monte Carlo počítá bez žolíků: zbývající cíl se přepočte poměrem přesného skóre k odhadu.
      const cap = need / exactScale(cands);
      const discard = this.chooseDiscard(game, rng, discardEnv, hand, info, cap, () =>
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
    const list = cands.map((c) => ({ ...c, exact: false, estRaw: c.raw }));
    const order = (a: (typeof list)[number], b: (typeof list)[number]) =>
      b.value - a.value || b.ids.length - a.ids.length;
    // Náhoda ve skórování (žolíci a karty se šancí): první přepočet se udělá víckrát; když se vzorky liší, bere se
    // tolik vzorků u každého kandidáta — jeden šťastný hod by jinak sliboval skóre, které nepřijde. Průměr,
    // v poslední ruce kola nejhorší ze `CHANCE_SAMPLES_LAST` vzorků (rozhoduje, jestli ruka cíl dosáhne spolehlivě,
    // ne jednou za čas).
    let samples = 0;
    const lastHand = (game.state.round?.handsLeft ?? 0) <= 1;
    const chanceSamples = lastHand ? CHANCE_SAMPLES_LAST : CHANCE_SAMPLES;
    const verify = (c: (typeof list)[number]): void => {
      // Karty lícem dolů se do přesného přepočtu nepočítají — bot jejich hodnotu nezná.
      const visible = c.ids.filter((id) => !game.card(id)?.faceDown);
      if (visible.length === 0) {
        c.raw = 0;
      } else {
        const score = (): number => Math.max(0, exactPlayScore(game, visible, rng, snapshot));
        const got = [score()];
        if (samples === 0) {
          while (got.length < chanceSamples) got.push(score());
          samples = got.every((x) => x === got[0]) ? 1 : chanceSamples;
        }
        while (got.length < samples) got.push(score());
        got.sort((a, b) => a - b);
        c.raw = lastHand ? got[0]! : got.reduce((a, b) => a + b, 0) / got.length;
      }
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
    const lastHand = round.handsLeft <= 1;
    const now = bestUtility(hand, env, need, lastHand);
    // Co se při zahození stane navíc (pravidlo šéfa): ztracené držené karty, otočené karty, dobrání lícem dolů.
    const fx = discardEffects(
      game,
      rng,
      options[0]!.map((c) => c.id),
    );
    const plans = options
      .map((opt) => {
        const kept = hand.filter((c) => !opt.includes(c));
        const draw = Math.min(Math.max(0, handSize - kept.length + fx.lost), pool.length);
        return { opt, kept, draw, sum: 0 };
      })
      .filter((p) => p.draw > 0);
    if (plans.length === 0) return null;
    const maxDraw = Math.max(...plans.map((p) => p.draw));
    const scratch = [...pool];
    const hiddenAt: boolean[] = new Array<boolean>(maxDraw).fill(false);
    // Společné náhodné vzorky pro všechny možnosti (common random numbers): rozdíl mezi možnostmi pak neruší
    // šum jednotlivých vzorků a stačí jich málo.
    for (let k = 0; k < this.style.samples; k++) {
      // Částečný Fisher–Yates: prvních `maxDraw` karet je náhodný vzorek bez opakování.
      for (let i = 0; i < maxDraw; i++) {
        const j = i + Math.floor(rng.next() * (scratch.length - i));
        const tmp = scratch[i]!;
        scratch[i] = scratch[j]!;
        scratch[j] = tmp;
        hiddenAt[i] = fx.hidden > 0 && rng.next() < fx.hidden;
      }
      const lostRoll = fx.lost > 0 ? rng.next() : 0;
      for (const p of plans) {
        // Otočené držené karty bot nevidí; ztracené vybere los (stejný pro všechny možnosti).
        let kept = fx.flip ? [] : p.kept;
        if (fx.lost > 0 && kept.length > 0) {
          const at = Math.floor(lostRoll * kept.length);
          kept = [...kept.slice(0, at), ...kept.slice(at + fx.lost)];
        }
        const drawn = scratch.slice(0, p.draw).filter((_, i) => !hiddenAt[i]);
        p.sum += bestUtility([...kept, ...drawn], env, need, lastHand);
      }
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
    const r = Math.min(full, Math.max(0, mods.interestStep * (game.state.ante - 1)));
    // Úrok se vyplatí jen za zbývající kola: na konci runu se rezerva rozpustí.
    const left = roundsLeft(game);
    return left <= RESERVE_END_ROUNDS ? 0 : left <= 2 * RESERVE_END_ROUNDS ? r / 2 : r;
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
   * Nákup nebo výměna žolíka podle měřené hodnoty (laboratoř): do volného slotu nabídka s největším přebytkem
   * hodnoty nad cenou × poměr × pocit z ceny (i na dluh, když to dluhový limit dovolí; při málo žolících stačí
   * nižší poměr), při plných slotech prodá nejslabšího, když výměna přinese víc než čistou cenu a rezervu.
   * Bot `econ` navíc kupuje jen nad prahem heuristického hodnocení (`minJokerRating`).
   */
  private jokerPurchase(game: Game): Action | null {
    const shop = game.state.shop;
    if (!shop || !this.style.buysJokers) return null;
    const s = game.state;
    const few = s.jokers.length < Math.min(game.modifiers().jokerSlots, s.ante + 1);
    const pf = this.priceFactor(game);
    let best: { action: Action; score: number } | null = null;
    shop.items.forEach((it, i) => {
      if (it.kind !== 'joker' || it.sold) return;
      if (this.style.minJokerRating > 1 && this.jokerRating(game, it.joker) < this.style.minJokerRating)
        return;
      if (jokerRoom(game, it.joker)) {
        if (!(this.affordable(game, it.price) || this.debtAffordable(game, it.price))) return;
        const need = it.price * (few ? BOT_TUNING.jokerFewRatio : BOT_TUNING.jokerBuyRatio) * pf;
        // Rychlé síto na několika typických rukou: zjevně slabou nabídku bot celou nepřepočítává.
        if (this.offerKc(game, it.joker, QUICK_SAMPLES).add < need - QUICK_SKIP_KC) return;
        const surplus = this.addKc(game, it.joker) - need;
        if (surplus >= 0 && (!best || surplus > best.score))
          best = { action: { type: 'buy', slot: i }, score: surplus };
        return;
      }
      const maxSell = Math.max(0, ...s.jokers.map((j) => game.sellValue(j.uid)));
      if (!this.affordable(game, it.price - maxSell)) return;
      const quick = this.offerKc(game, it.joker, QUICK_SAMPLES).swap;
      if (
        !quick ||
        quick.kc < Math.max(0, it.price - maxSell) * BOT_TUNING.jokerSwapRatio * pf - QUICK_SKIP_KC
      )
        return;
      const swap = this.offerKc(game, it.joker).swap;
      if (!swap) return;
      const net = it.price - game.sellValue(swap.uid);
      if (!this.affordable(game, net)) return;
      const surplus =
        swap.kc - Math.max(0, net) * BOT_TUNING.jokerSwapRatio * pf - BOT_TUNING.jokerSwapMarginKc;
      if (surplus >= 0 && (!best || surplus > best.score))
        best = { action: { type: 'sellJoker', uid: swap.uid }, score: surplus };
    });
    return (best as { action: Action; score: number } | null)?.action ?? null;
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
      const clone = probe(game, action, probeSeed(game, `voucher:${v.voucherId}:0`), snapshot);
      if (!clone) continue;
      const worth = voucherWorth(view, clone, reg.vouchers[v.voucherId]);
      if (this.worthBuying(game, worth, v.price, VOUCHER_RATIO)) return action;
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
    // Výzva bez přehození (`Modifiers.noReroll`, Rychlík bez zastávky) — engine by přehození odmítl.
    if (
      this.style.rerolls &&
      this.style.buysJokers &&
      hasJokers &&
      !game.modifiers().noReroll &&
      canPay(game, shop.rerollCost)
    ) {
      const free = s.money - this.reserve(game);
      const room = jokerRoom(game);
      // S volným slotem stačí 2× cena přehození nad rezervou (DESIGN 12.2); s plnými sloty se přehazuje kvůli
      // výměně — jen s penězi na koupi po přehození a víckrát, čím víc peněz nad rezervou bot má.
      const limit = Math.min(
        MAX_SHOP_REROLLS_RICH,
        room
          ? MAX_SHOP_REROLLS + Math.floor(free / REROLL_RICH_KC)
          : Math.floor((free - REROLL_UPGRADE_KC) / REROLL_UPGRADE_KC),
      );
      if (
        shop.rerollsThisShop < limit &&
        ((room && free >= 2 * shop.rerollCost) || (!room && free >= shop.rerollCost + REROLL_UPGRADE_KC))
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
        if (jokerRoom(game, opt.joker)) {
          offer(this.addKc(game, opt.joker), pick);
          return;
        }
        const swap = this.offerKc(game, opt.joker).swap;
        if (!swap) return;
        const gain = swap.kc - BOT_TUNING.jokerSwapMarginKc;
        if (gain > 0) offer(gain + game.sellValue(swap.uid), { type: 'sellJoker', uid: swap.uid });
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

/**
 * Jsou žolíci vypnutí pravidlem šéfa jen do první zahrané ruky (Výpadek proudu)? Sonda: zahraje `ids` na kopii hry
 * a porovná počet žolíků vypnutých pravidlem. Pak bot nezahazuje — zahození by spotřeboval v kole bez žolíků
 * a zbylé ruce se žolíky by už neměly čím vylepšovat.
 */
export function jokersReturnAfterHand(game: Game, rng: Rng, ids: readonly number[]): boolean {
  const round = game.state.round;
  const off = round?.ruleJokerDebuffs?.length ?? 0;
  if (!round || off === 0 || round.handsLeft <= 1) return false;
  const clone = cloneGame(game, rng);
  if (!clone.dispatch({ type: 'play', cardIds: [...ids] }).ok) return false;
  const after = clone.state.round;
  return clone.state.phase === 'round' && !!after && (after.ruleJokerDebuffs?.length ?? 0) < off;
}

/** Co zahození udělá navíc (sonda `discardEffects`). */
export interface DiscardEffects {
  /** Kolik držených karet zahození navíc vezme z ruky (Tchyně na návštěvě). */
  lost: number;
  /** Držené karty se otočí lícem dolů (Bílá paní) — po zahození je bot neuvidí. */
  flip: boolean;
  /** Podíl dobraných karet, které přijdou lícem dolů (Výluka na trati, Mlha nad Labem). */
  hidden: number;
}

const NO_DISCARD_EFFECTS: DiscardEffects = { lost: 0, flip: false, hidden: 0 };

/**
 * Sonda zahození na kopii hry (bot pravidla nezná podle id): kolik držených karet z ruky zmizelo navíc, jestli se
 * držené karty otočily lícem dolů a jaký podíl dobraných karet přišel lícem dolů. Jen v kole se šéfem, jehož
 * pravidlo na zahození nebo dobírání reaguje (`onDiscard`, `onDraw`, `isDrawnFaceDown`) — jinak nic.
 */
export function discardEffects(game: Game, rng: Rng, ids: readonly number[]): DiscardEffects {
  const round = game.state.round;
  if (!round?.bossId || round.bossDisabled || ids.length === 0) return NO_DISCARD_EFFECTS;
  const hooks = game.registry.bosses[round.bossId]?.hooks;
  if (!hooks?.onDiscard && !hooks?.onDraw && !hooks?.isDrawnFaceDown) return NO_DISCARD_EFFECTS;
  const clone = cloneGame(game, rng);
  if (!clone.dispatch({ type: 'discard', cardIds: [...ids] }).ok) return NO_DISCARD_EFFECTS;
  const before = new Set(round.hand);
  const after = clone.state.round?.hand ?? [];
  const afterSet = new Set(after);
  const kept = round.hand.filter((id) => !ids.includes(id));
  const keptVisible = kept.filter((id) => !game.card(id)?.faceDown);
  const flipped = keptVisible.filter((id) => afterSet.has(id) && clone.card(id)?.faceDown).length;
  const drawn = after.filter((id) => !before.has(id));
  return {
    lost: kept.filter((id) => !afterSet.has(id)).length,
    flip: keptVisible.length > 0 && 2 * flipped >= keptVisible.length,
    hidden: drawn.length > 0 ? drawn.filter((id) => clone.card(id)?.faceDown).length / drawn.length : 0,
  };
}

/**
 * Soudí pravidlo aktivního šéfa celou ruku (`validateHand` — Soused s vrtačkou, `adjustHandScore` — Pan starosta)?
 * Pak bot tahy přepočítává přesně a nedoplňuje je kartami lícem dolů.
 */
function bossJudgesHand(game: Game): boolean {
  const round = game.state.round;
  if (!round?.bossId || round.bossDisabled) return false;
  const hooks = game.registry.bosses[round.bossId]?.hooks;
  return Boolean(hooks?.validateHand || hooks?.adjustHandScore);
}

/** RNG pro sondy, u kterých na náhodě nezáleží (přeřazení žolíků je deterministické). */
const FIXED_PROBE_SEED: readonly [number, number, number, number] = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 1];

/**
 * Pozice v řadě žolíků, které pravidlo aktivního šéfa vypíná bez ohledu na to, který žolík na nich stojí (Jednooký
 * hejtman: pravá polovina). Bot pravidlo nezná podle id: na kopii hry zkusí pořadí `uids` a pořadí obrácené
 * a vezme pozice, kde je v obou případech žolík vypnutý pravidlem (`round.ruleJokerDebuffs`). Pravidlo, které
 * vypíná všechny (Výpadek proudu), vrátí všechny pozice — pak na pořadí nezáleží.
 */
export function positionalDebuffs(game: Game, uids: readonly number[]): Set<number> {
  const s = game.state;
  const round = s.round;
  const out = new Set<number>();
  if (s.phase !== 'round' || !round?.bossId || round.bossDisabled) return out;
  if (!game.registry.bosses[round.bossId]?.hooks.isJokerDebuffed) return out;
  const snapshot = JSON.stringify(s);
  const offAt = (order: readonly number[]): Set<number> | null => {
    const clone = cloneGame(game, rngFromState([...FIXED_PROBE_SEED]), snapshot);
    if (!clone.dispatch({ type: 'reorderJokers', uids: [...order] }).ok) return null;
    const ruled = new Set(clone.state.round?.ruleJokerDebuffs ?? []);
    const set = new Set<number>();
    clone.state.jokers.forEach((j, i) => {
      if (ruled.has(j.uid)) set.add(i);
    });
    return set;
  };
  const a = offAt(uids);
  const b = offAt([...uids].reverse());
  if (!a || !b) return out;
  for (const i of a) if (b.has(i)) out.add(i);
  return out;
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
        // `noSkip` (výzva) se kontroluje před hodem — mimo výzvy se spotřeba RNG nemění.
        if (blind && blind.kind !== 'boss' && !mods.noSkip && rng.next() < 0.2) return { type: 'skipBlind' };
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
        if (!mods.noReroll && shop.rerollsThisShop < RANDOM_MAX_SHOP_REROLLS && canPay(game, shop.rerollCost))
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
