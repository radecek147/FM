/**
 * Výzvy (docs/DESIGN.md kap. 11.1) — 20 předpřipravených runů se zvláštními pravidly, v pořadí tabulky (= pořadí
 * v menu) seřazené po pěticích podle obtížnosti (simulace botem, docs/DECISIONS.md „Výzvy: pořadí a ladění“).
 * Hrají se na Desítce (`ChallengeDef.stake`, výchozí 1); dokončení = porážka šéfa patra 8 (Konec světa 12).
 * Texty v src/i18n/cs/challenges.ts (`challenges.<id>.name|desc|flavor|rules.<klíč>`, `{param}` = `params`).
 * Návod: docs/CONTENT-GUIDE.md.
 *
 * Pravidla jdou přes data, která engine zná (docs/DECISIONS.md „Výzvy: pravidla v enginu“): číselná a přepínací
 * v `extraModifiers` (`noJokers`, `noSkip`, `autoSkip`, `noReroll`, `flatShopPrice`, `handCost`, `glassBreakOdds`,
 * `finalAnte`…), ostatní v polích definice (`maxScoringHand`, `jokerSticker`, `banned*`, `startingHandLevels`,
 * `consumableCost`) a v hoocích (`onAnteStart`, `isCardDebuffed`, `isJokerDebuffed`).
 *
 * Zákazy obsahu navíc (`bannedVouchers`, `bannedConsumables`, `bannedTags`) jen vyřazují položky, které by pravidla
 * výzvy udělala bezcennými (kupón na přehození bez přehození, štítek se žolíkem bez žolíků…).
 */
import type { CardSpec, ChallengeDef, UnlockCondition } from '../engine/content-types';
import { standardDeckSpecs } from '../engine/cards/cards';
import { FINAL_ANTE, RENTAL_BUY_PRICE, RENTAL_FEE, RENTAL_SELL_PRICE } from '../engine/constants';
import { BASE_MODIFIERS } from '../engine/effects/modifiers';
import type { HandType, Suit } from '../engine/types';
import { HAND_TYPES, RANKS, SUITS } from '../engine/types';

// ─────────────────────────── Odemykání (DESIGN 11.1) ───────────────────────────

/** Výzvy 1–5 po první výhře, 6–10 po 3, 11–15 po 6, 16–20 po 10 výhrách (napříč balíčky a obtížnostmi). */
export const CHALLENGE_UNLOCK_WINS: readonly number[] = [1, 3, 6, 10];
/** Kolik výzev odemyká jeden práh výher. */
export const CHALLENGES_PER_UNLOCK_TIER = 5;

function unlockAfterWins(index: number): UnlockCondition {
  const tier = Math.min(CHALLENGE_UNLOCK_WINS.length - 1, Math.floor(index / CHALLENGES_PER_UNLOCK_TIER));
  return { type: 'winsTotal', count: CHALLENGE_UNLOCK_WINS[tier]! };
}

// ─────────────────────────── Čísla výzev ───────────────────────────

/** Suchý únor: sloty spotřebek navíc, startovní peníze a poloviční cíle (bez žolíků se jinak nedá škálovat). */
export const DRY_FEBRUARY_CONSUMABLE_SLOTS = 2;
export const DRY_FEBRUARY_MONEY = 10;
export const DRY_FEBRUARY_TARGET_MULT = 0.5;
/** Skleník: sklo praská 1 z 2 (DESIGN původně 1 z 3 — bot vyhrával ~85 %). */
export const GREENHOUSE_GLASS_ODDS = 2;
/** Skleník: skleněné barvy. */
export const GREENHOUSE_SUITS: readonly Suit[] = ['H', 'D'];
/** Kamenolom: kamenné karty navíc ke standardním 52. */
export const QUARRY_STONES = 12;
/** Byrokracie: poplatek za ruku i zahození, dluhový limit, start. */
export const BUREAUCRACY_FEE = 1;
export const BUREAUCRACY_DEBT = 15;
export const BUREAUCRACY_MONEY = 15;
/**
 * Švejkova anabáze: nejsilnější skórující kombinace a startovní úroveň Vysoké karty a Dvojice (4, ne 6 — s úrovní 6
 * bot vyhrával ~90 %).
 */
export const SVEJK_MAX_HAND: HandType = 'pair';
export const SVEJK_LEVEL = 4;
/** Rychlík bez zastávky: ruka navíc. */
export const EXPRESS_HANDS = 1;
/** Rovnou za ředitelem: start. */
export const STRAIGHT_TO_BOSS_MONEY = 10;
/** Minimalista: nejvýš 3 vybrané karty, startovní úroveň Vysoké karty, Dvojice a Trojice. */
export const MINIMALIST_CARDS = 3;
export const MINIMALIST_LEVEL = 3;
/** Jednotná cena: vše ve Večerce 5 Kč, prodej 2 Kč. */
export const FLAT_PRICE = 5;
export const FLAT_SELL = 2;
/** Půjčovna kostýmů: start. */
export const COSTUME_RENTAL_MONEY = 10;
/** Krátká paměť: cena pranostiky. */
export const SHORT_MEMORY_PRANOSTIKA_COST = 1;
/** Velký třesk: násobek cílů a počet náhodných legendárních žolíků. */
export const BIG_BANG_TARGET_MULT = 3;
export const BIG_BANG_LEGENDARIES = 2;
/** Večer při svíčkách: ruka navíc. */
export const CANDLELIGHT_HANDS = 1;
/** Čtyři roční období: debuffnutá barva podle patra (patra 1 a 5, 2 a 6, 3 a 7, 4 a 8; dál dokola). */
export const SEASON_SUITS: readonly Suit[] = ['H', 'S', 'D', 'C'];
/** Vánoční kapr: ruce a karty v ruce navíc (zahození 0). */
export const CARP_HANDS = 2;
export const CARP_HAND_SIZE = 1;
/** Mariáš u Vaňků: startovní úroveň Barvy a Postupky v barvě, násobek cílů. */
export const MARIAS_PARTY_LEVEL = 3;
export const MARIAS_PARTY_TARGET_MULT = 1.25;
/**
 * Malometrážní byt: velikost ruky, ruka navíc a sloty žolíků navíc. Ruka 6 a +1 ruka, ne ruka 5 (DESIGN původně):
 * s pěti kartami bot prohrál ~88 % runů hned v první útratě, kdy ještě nemá žolíky.
 */
export const MICRO_FLAT_HAND_SIZE = 6;
export const MICRO_FLAT_HANDS = 1;
export const MICRO_FLAT_JOKER_SLOTS = 2;
/** Konec světa: násobek cílů a patro, jehož šéf rozhodne. */
export const END_OF_WORLD_TARGET_MULT = 1.25;
export const END_OF_WORLD_FINAL_ANTE = 12;
/** Startovní peníze výzev bez zvláštního startu (DESIGN 11.1: „5 Kč“). */
const DEFAULT_MONEY = 5;

// ─────────────────────────── Pomocníci ───────────────────────────

/** Barva debuffnutá ve všech útratách patra `ante` (Čtyři roční období). */
export function seasonSuit(ante: number): Suit {
  const i = (((Math.trunc(ante) - 1) % SEASON_SUITS.length) + SEASON_SUITS.length) % SEASON_SUITS.length;
  return SEASON_SUITS[i]!;
}

/** Skleník: standardních 52 karet, ♥ a ♦ skleněné. */
function greenhouseDeck(): CardSpec[] {
  return standardDeckSpecs().map((c) =>
    GREENHOUSE_SUITS.includes(c.suit) ? { ...c, enhancement: 'glass' } : c,
  );
}

/**
 * Kamenolom: standardních 52 karet + 12 kamenných. Kamenné hodnotu ani barvu nemají; pod nimi je rozložení
 * ♠ ♥ ♦ ♣ × 2–K (projeví se jen tehdy, když šéf vypne vylepšení — Bílá hora).
 */
function quarryDeck(): CardSpec[] {
  const stones: CardSpec[] = [];
  for (let i = 0; i < QUARRY_STONES; i++) {
    stones.push({ suit: SUITS[i % SUITS.length]!, rank: RANKS[i % RANKS.length]!, enhancement: 'stone' });
  }
  return [...standardDeckSpecs(), ...stones];
}

/** Kasino u hranic: všech 52 karet šťastných. */
function casinoDeck(): CardSpec[] {
  return standardDeckSpecs().map((c) => ({ ...c, enhancement: 'lucky' }));
}

/** Kupóny přehození — bez přehození (nebo s pevnou cenou) bezcenné. */
const REROLL_VOUCHERS = ['counter_buddy', 'manager_inlaw'];

// ─────────────────────────── Výzvy ───────────────────────────

const DEFS: Omit<ChallengeDef, 'unlock'>[] = [
  // ── 1. skupina: odemkne se po 1 výhře ──
  // 1 — Skleník: ♥ a ♦ skleněné, sklo praská 1 z 2.
  {
    id: 'greenhouse',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    customDeck: greenhouseDeck(),
    startingConsumables: ['apple_tree', 'apple_tree'],
    extraModifiers: { glassBreakOdds: GREENHOUSE_GLASS_ODDS },
    ruleKeys: ['glass', 'odds', 'start'],
    params: { odds: GREENHOUSE_GLASS_ODDS, count: 2 },
    art: {
      icon: 'flower-pot',
      prop: 'glass-celebration',
      bg: '#2f6b4f',
      fg: '#ecfdf5',
      accent: '#a7f3d0',
      pattern: 'grid',
    },
  },
  // 2 — Vánoční kapr: žádné zahazování, ruce a karta v ruce navíc.
  {
    id: 'christmas_carp',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { discards: -BASE_MODIFIERS.discards, hands: CARP_HANDS, handSize: CARP_HAND_SIZE },
    bannedVouchers: ['dumpster', 'recycling_yard'],
    ruleKeys: ['noDiscards', 'hands', 'handSize'],
    params: { hands: CARP_HANDS, cards: CARP_HAND_SIZE },
    art: {
      icon: 'tropical-fish',
      prop: 'bathtub',
      bg: '#1d4ed8',
      fg: '#eff6ff',
      accent: '#93c5fd',
      pattern: 'waves',
    },
  },
  // 3 — Jednotná cena: vše za 5 Kč, prodej za 2 Kč.
  {
    id: 'flat_price',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { flatShopPrice: FLAT_PRICE, flatSellPrice: FLAT_SELL },
    // Slevy nic nezlevní a Amnestie by byla −1 patro zadarmo (příplatek pevná cena přebije).
    bannedVouchers: ['yellow_price', 'relabeled_price', ...REROLL_VOUCHERS, 'amnesty'],
    ruleKeys: ['price', 'sell'],
    params: { price: FLAT_PRICE, sell: FLAT_SELL },
    art: {
      icon: 'take-my-money',
      prop: 'scales',
      bg: '#facc15',
      fg: '#422006',
      accent: '#a16207',
      pattern: 'checker',
    },
  },
  // 4 — Švejkova anabáze: nad Dvojici se neboduje; Vysoká karta a Dvojice od úrovně 4.
  {
    id: 'svejk_anabasis',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    startingJokers: [{ defId: 'svejk' }],
    maxScoringHand: SVEJK_MAX_HAND,
    // Pranostiky silnějších kombinací se nabízejí dál (a jsou k ničemu) — s jejich zákazem by Dvojice rostla
    // z každé pranostiky a výzva by byla zadarmo.
    startingHandLevels: { high_card: SVEJK_LEVEL, pair: SVEJK_LEVEL },
    ruleKeys: ['maxHand', 'levels', 'start'],
    params: { level: SVEJK_LEVEL },
    art: {
      icon: 'footprint',
      prop: 'smoking-pipe',
      bg: '#4d5b3a',
      fg: '#f7f3e3',
      accent: '#c9b56b',
      pattern: 'zigzag',
    },
  },
  // 5 — Rychlík bez zastávky: nepřeskakuje se, nepřehazuje se, ruka navíc.
  {
    id: 'express',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { noSkip: true, noReroll: true, hands: EXPRESS_HANDS },
    bannedVouchers: REROLL_VOUCHERS,
    bannedTags: ['open_doors'],
    ruleKeys: ['noSkip', 'noReroll', 'hands'],
    params: { hands: EXPRESS_HANDS },
    art: {
      icon: 'steam-locomotive',
      prop: 'stopwatch',
      bg: '#1e3a5f',
      fg: '#eff6ff',
      accent: '#fbbf24',
      pattern: 'stripes',
    },
  },
  // ── 2. skupina: odemkne se po 3 výhrách ──
  // 6 — Mariáš u Vaňků: Mariášový balíček, Barva a Postupka v barvě od úrovně 3, bez karetních obálek.
  {
    id: 'marias_party',
    deckId: 'marias',
    startingMoney: DEFAULT_MONEY,
    startingHandLevels: { flush: MARIAS_PARTY_LEVEL, straight_flush: MARIAS_PARTY_LEVEL },
    bannedBoosterKinds: ['card'],
    bannedTags: ['cottage_marias'],
    extraModifiers: { targetMult: MARIAS_PARTY_TARGET_MULT },
    ruleKeys: ['levels', 'noCards', 'targets'],
    params: { level: MARIAS_PARTY_LEVEL, mult: MARIAS_PARTY_TARGET_MULT },
    art: {
      icon: 'clubs',
      prop: 'beer-bottle',
      bg: '#14532d',
      fg: '#f0fdf4',
      accent: '#facc15',
      pattern: 'checker',
    },
  },
  // 7 — Minimalista: nejvýš 3 karty; Vysoká karta, Dvojice a Trojice od úrovně 3.
  {
    id: 'minimalist',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { maxSelect: MINIMALIST_CARDS - BASE_MODIFIERS.maxSelect },
    // Ze 3 karet jde složit jen Vysoká karta, Dvojice a Trojice; pranostiky ostatních kombinací se nabízejí dál
    // (jako ve Švejkově anabázi — jejich zákaz by výzvu zlehčil).
    startingHandLevels: { high_card: MINIMALIST_LEVEL, pair: MINIMALIST_LEVEL, three: MINIMALIST_LEVEL },
    ruleKeys: ['maxSelect', 'levels'],
    params: { cards: MINIMALIST_CARDS, level: MINIMALIST_LEVEL },
    art: {
      icon: 'poker-hand',
      prop: 'magnifying-glass',
      bg: '#e7e5e4',
      fg: '#1c1917',
      accent: '#78716c',
      pattern: 'none',
    },
  },
  // 8 — Velký třesk: cíle ×3, ale 2 náhodní legendární žolíci (přibití).
  {
    id: 'big_bang',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { targetMult: BIG_BANG_TARGET_MULT },
    startingRandomJokers: [{ rarity: 'legendary', count: BIG_BANG_LEGENDARIES, stickers: ['eternal'] }],
    ruleKeys: ['targets', 'start'],
    params: { mult: BIG_BANG_TARGET_MULT, count: BIG_BANG_LEGENDARIES },
    art: {
      icon: 'dynamite',
      prop: 'stars-stack',
      bg: '#111827',
      fg: '#fef3c7',
      accent: '#f97316',
      pattern: 'rays',
    },
  },
  // 9 — Kasino u hranic: všech 52 karet šťastných, peníze jen ze štěstí (bez úroku, odměn a dýška).
  {
    id: 'border_casino',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    customDeck: casinoDeck(),
    // Peníze jen ze štěstí: bez úroku, odměn za útraty a peněz za nevyužité ruce (jen úrok — bot vyhrával ~85 %).
    extraModifiers: {
      interestMult: 0,
      blindRewardMult: 0,
      moneyPerUnusedHand: -BASE_MODIFIERS.moneyPerUnusedHand,
    },
    bannedVouchers: ['savings_account', 'building_savings', 'nonstop'],
    ruleKeys: ['lucky', 'noIncome'],
    params: { cards: 52 },
    art: {
      icon: 'rolling-dices',
      prop: 'clover',
      bg: '#7f1d1d',
      fg: '#fef2f2',
      accent: '#22c55e',
      pattern: 'dots',
    },
  },
  // 10 — Malometrážní byt: ruka 6 karet, +1 ruka, +2 sloty žolíků.
  {
    id: 'micro_flat',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: {
      handSize: MICRO_FLAT_HAND_SIZE - BASE_MODIFIERS.handSize,
      hands: MICRO_FLAT_HANDS,
      jokerSlots: MICRO_FLAT_JOKER_SLOTS,
    },
    ruleKeys: ['handSize', 'hands', 'slots'],
    params: { cards: MICRO_FLAT_HAND_SIZE, hands: MICRO_FLAT_HANDS, slots: MICRO_FLAT_JOKER_SLOTS },
    art: {
      icon: 'brick-wall',
      prop: 'window',
      bg: '#9a3412',
      fg: '#fff7ed',
      accent: '#fed7aa',
      pattern: 'checker',
    },
  },
  // ── 3. skupina: odemkne se po 6 výhrách ──
  // 11 — Večer při svíčkách: žolíci nefungují v první ruce kola, ruka navíc.
  {
    id: 'candlelight',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: { hands: CANDLELIGHT_HANDS },
    isJokerDebuffed: (ctx) => ctx.round.handsPlayed === 0,
    ruleKeys: ['dark', 'hands'],
    params: { hands: CANDLELIGHT_HANDS },
    art: {
      icon: 'candle-light',
      prop: 'moon',
      bg: '#1f1a2e',
      fg: '#fde68a',
      accent: '#f59e0b',
      pattern: 'none',
    },
  },
  // 12 — Čtyři roční období: v každém patře je jedna barva mimo provoz.
  {
    id: 'four_seasons',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    isCardDebuffed: (ctx, card) => ctx.api.hasSuit(card, seasonSuit(ctx.state.ante)),
    ruleKeys: ['seasons', 'spring', 'summer', 'autumn', 'winter'],
    art: {
      icon: 'sun',
      prop: 'snowflake-1',
      bg: '#0f766e',
      fg: '#f0fdfa',
      accent: '#fcd34d',
      pattern: 'grid',
    },
  },
  // 13 — Kamenolom: 64 karet (12 kamenných), babské rady nikde, přibitý Golem.
  {
    id: 'quarry',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    customDeck: quarryDeck(),
    startingJokers: [{ defId: 'golem', stickers: ['eternal'] }],
    bannedConsumableKinds: ['rada'],
    bannedTags: ['grandma_parcel'],
    ruleKeys: ['deck', 'noRady', 'start'],
    params: { stones: QUARRY_STONES, cards: 52 + QUARRY_STONES },
    art: {
      icon: 'miner',
      prop: 'stone-block',
      bg: '#57534e',
      fg: '#f5f5f4',
      accent: '#d6d3d1',
      pattern: 'checker',
    },
  },
  // 14 — Krátká paměť: úrovně kombinací se na začátku patra vrací na 1, pranostiky za 1 Kč.
  {
    id: 'short_memory',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    consumableCost: { pranostika: SHORT_MEMORY_PRANOSTIKA_COST },
    onAnteStart: (ctx) => {
      for (const hand of HAND_TYPES) {
        const level = ctx.api.handLevel(hand);
        if (level > 1) ctx.api.levelUpHand(hand, 1 - level);
      }
    },
    ruleKeys: ['reset', 'cheap'],
    params: { price: SHORT_MEMORY_PRANOSTIKA_COST },
    art: {
      icon: 'brain',
      prop: 'hourglass',
      bg: '#be185d',
      fg: '#fdf2f8',
      accent: '#fbcfe8',
      pattern: 'waves',
    },
  },
  // 15 — Byrokracie: každá ruka i zahození za korunu, dluh až do −15 Kč.
  {
    id: 'bureaucracy',
    deckId: 'pub',
    startingMoney: BUREAUCRACY_MONEY,
    extraModifiers: {
      handCost: BUREAUCRACY_FEE,
      discardCost: BUREAUCRACY_FEE,
      debtLimit: BUREAUCRACY_DEBT,
    },
    ruleKeys: ['fees', 'debt', 'start'],
    params: { fee: BUREAUCRACY_FEE, debt: BUREAUCRACY_DEBT, money: BUREAUCRACY_MONEY },
    art: {
      icon: 'stamper',
      prop: 'papers',
      bg: '#7c2d12',
      fg: '#fff7ed',
      accent: '#fdba74',
      pattern: 'stripes',
    },
  },
  // ── 4. skupina: odemkne se po 10 výhrách ──
  // 16 — Rovnou za ředitelem: Malá a Velká se přeskakují samy (se štítky).
  {
    id: 'straight_to_boss',
    deckId: 'pub',
    startingMoney: STRAIGHT_TO_BOSS_MONEY,
    extraModifiers: { autoSkip: true },
    ruleKeys: ['autoSkip', 'start'],
    params: { money: STRAIGHT_TO_BOSS_MONEY },
    art: {
      icon: 'ladder',
      prop: 'top-hat',
      bg: '#3f3f46',
      fg: '#fafafa',
      accent: '#facc15',
      pattern: 'rays',
    },
  },
  // 17 — Svatba na doživotí: Štamgastův balíček, všichni žolíci přibití.
  {
    id: 'lifelong_wedding',
    deckId: 'regulars',
    jokerSticker: 'eternal',
    ruleKeys: ['eternal', 'deck'],
    art: {
      icon: 'ringing-bell',
      prop: 'padlock',
      bg: '#fdf2f8',
      fg: '#831843',
      accent: '#f9a8d4',
      pattern: 'dots',
    },
  },
  // 18 — Půjčovna kostýmů: všichni žolíci zapůjčení.
  {
    id: 'costume_rental',
    deckId: 'pub',
    startingMoney: COSTUME_RENTAL_MONEY,
    jokerSticker: 'rental',
    ruleKeys: ['rental', 'start'],
    params: { money: COSTUME_RENTAL_MONEY, buy: RENTAL_BUY_PRICE, fee: RENTAL_FEE, sell: RENTAL_SELL_PRICE },
    art: {
      icon: 'drama-masks',
      prop: 'ticket',
      bg: '#6d28d9',
      fg: '#f5f3ff',
      accent: '#f0abfc',
      pattern: 'waves',
    },
  },
  // 19 — Suchý únor: žolíci nikde (i kupóny, spotřebky a štítky se žolíky), poloviční cíle.
  {
    id: 'dry_february',
    deckId: 'pub',
    startingMoney: DRY_FEBRUARY_MONEY,
    startingVouchers: ['tear_calendar'],
    extraModifiers: {
      noJokers: true,
      consumableSlots: DRY_FEBRUARY_CONSUMABLE_SLOTS,
      targetMult: DRY_FEBRUARY_TARGET_MULT,
    },
    bannedVouchers: ['narrow_rack', 'proper_rack'],
    bannedConsumables: [
      'knock_on_wood',
      'cauldron',
      'exemption',
      'certified_copy',
      'bulk_processing',
      'tax_return',
      'expropriation',
      'fine_waiver',
    ],
    bannedTags: ['uncle_envelope', 'polished_cutlery', 'dental_xray', 'referral', 'connections'],
    ruleKeys: ['noJokers', 'slots', 'targets', 'start'],
    params: {
      slots: DRY_FEBRUARY_CONSUMABLE_SLOTS,
      money: DRY_FEBRUARY_MONEY,
      mult: DRY_FEBRUARY_TARGET_MULT,
    },
    art: {
      icon: 'beer-stein',
      prop: 'cancel',
      bg: '#5b7c99',
      fg: '#f1f5f9',
      accent: '#e2e8f0',
      pattern: 'dots',
    },
  },
  // 20 — Konec světa: cíle ×1,25 a rozhoduje až šéf patra 12 (finálový šéf v patře 8 i 12).
  {
    id: 'end_of_world',
    deckId: 'pub',
    startingMoney: DEFAULT_MONEY,
    extraModifiers: {
      targetMult: END_OF_WORLD_TARGET_MULT,
      finalAnte: END_OF_WORLD_FINAL_ANTE - FINAL_ANTE,
    },
    ruleKeys: ['targets', 'longer', 'finals'],
    params: { mult: END_OF_WORLD_TARGET_MULT, ante: END_OF_WORLD_FINAL_ANTE, firstFinal: FINAL_ANTE },
    art: {
      icon: 'lightning-storm',
      prop: 'crowned-skull',
      bg: '#18181b',
      fg: '#fafafa',
      accent: '#ef4444',
      pattern: 'zigzag',
    },
  },
];

/** Všech 20 výzev v pořadí DESIGN 11.1 s podmínkou odemčení podle pořadí (`CHALLENGE_UNLOCK_WINS`). */
export const CHALLENGES: ChallengeDef[] = DEFS.map((def, i) => ({ ...def, unlock: unlockAfterWins(i) }));
