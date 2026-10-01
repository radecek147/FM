/**
 * Základní datové typy enginu.
 *
 * Pravidla:
 *  - Vše, co je ve stavu (RunState, Card, JokerInstance…), musí být čistě JSON-serializovatelné
 *    (žádné Set/Map/funkce/třídy). Stav se ukládá přes JSON.stringify.
 *  - Definice obsahu (JokerDef, BossDef…) žijí v src/content a obsahují funkce (hooky);
 *    ve stavu se na ně odkazuje jen přes `defId`.
 *  - Engine neobsahuje žádné texty pro hráče. Texty jsou v src/i18n pod klíči odvozenými z id.
 */

// ───────────────────────────── Karty ─────────────────────────────

/** ♠ piky, ♥ srdce, ♦ káry, ♣ kříže */
export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** 2–10, 11 = kluk (J), 12 = dáma (Q), 13 = král (K), 14 = eso (A) */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** Id vylepšení hrací karty (definice v src/content/modifiers.ts). */
export type EnhancementId = string;
/** Id pečeti (definice v src/content/modifiers.ts). */
export type SealId = string;
/** Id edice — sdílené pro karty i žolíky (lesklá/holografická/duhová/negativní…). */
export type EditionId = string;

export interface Card {
  /** Unikátní v rámci runu (RunState.nextUid). */
  id: number;
  suit: Suit;
  rank: Rank;
  enhancement: EnhancementId | null;
  seal: SealId | null;
  edition: EditionId | null;
  /** Trvalé čipy navíc (např. žolík, který kartám přidává čipy). */
  bonusChips: number;
  /** Kolo-specifické příznaky; engine je nuluje na konci kola. */
  debuffed: boolean;
  faceDown: boolean;
}

// ─────────────────────────── Kombinace ───────────────────────────

export type HandType =
  | 'high_card'
  | 'pair'
  | 'two_pair'
  | 'three'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four'
  | 'straight_flush'
  | 'royal_flush'
  | 'five'
  | 'flush_house'
  | 'flush_five';

/** Od nejslabší po nejsilnější. Pořadí určuje „nejvyšší nalezenou kombinaci“. */
export const HAND_TYPES: readonly HandType[] = [
  'high_card',
  'pair',
  'two_pair',
  'three',
  'straight',
  'flush',
  'full_house',
  'four',
  'straight_flush',
  'royal_flush',
  'five',
  'flush_house',
  'flush_five',
];

/** Tajné kombinace — v UI skryté, dokud je hráč nezahraje. */
export const SECRET_HAND_TYPES: readonly HandType[] = ['five', 'flush_house', 'flush_five'];

export interface HandTypeDef {
  type: HandType;
  baseChips: number;
  baseMult: number;
  /** Přírůstek za každou úroveň nad 1. */
  chipsPerLevel: number;
  multPerLevel: number;
  secret: boolean;
}

export interface HandLevelState {
  level: number;
  /** Kolikrát byla kombinace zahrána v tomto runu. */
  played: number;
}

export interface DetectedHand {
  type: HandType;
  /** Id karet, které skórují (v pořadí, v jakém byly zahrány). */
  scoringIds: number[];
  /** Všechny kombinace, které zahraná ruka obsahuje (např. Full house obsahuje i Trojici a Dvojici). */
  contains: HandType[];
}

// ─────────────────────────── Modifikátory ───────────────────────────

/**
 * Pravidla runu, která mohou měnit balíček, obtížnost, kupóny, žolíci, šéf, výzva.
 * Výsledné hodnoty = BASE_MODIFIERS + součet delt (čísla se sčítají; pole končící na `Mult`
 * se násobí; booleany se ORují). Viz engine/effects/modifiers.ts.
 */
export interface Modifiers {
  handSize: number;
  hands: number;
  discards: number;
  /** Max. počet karet, které lze vybrat/zahrát/zahodit naráz. */
  maxSelect: number;
  jokerSlots: number;
  consumableSlots: number;

  /** Úrok: +1 Kč za každých `interestStep` Kč, max `interestCap` Kč za kolo. */
  interestStep: number;
  interestCap: number;
  interestMult: number;
  moneyPerUnusedHand: number;
  moneyPerUnusedDiscard: number;
  /** Násobič odměny za útratu. */
  blindRewardMult: number;
  /** Jak hluboko smí jít peníze do mínusu (0 = nesmí). */
  debtLimit: number;

  shopCardSlots: number;
  shopBoosterSlots: number;
  shopVoucherSlots: number;
  rerollBaseCost: number;
  rerollCostStep: number;
  /** Sleva v obchodě v procentech (0–100). */
  shopDiscountPct: number;
  /** Váhy typů karet v kartových slotech obchodu. */
  shopWeightJoker: number;
  shopWeightPranostika: number;
  shopWeightRada: number;
  shopWeightRazitko: number;
  shopWeightPlayingCard: number;
  /** Násobič šance na lesklou/holografickou/duhovou edici (negativní nenásobí, DESIGN 2.6). */
  editionRateMult: number;
  /**
   * Příplatek ke každé ceně ve Večerce v Kč (Jedenáctka +1): žolíci, spotřebky, karty, obálky, kupóny
   * i přehození. Prodejní ceny ani položky zdarma nemění.
   */
  shopPriceAdd: number;
  /** Šance (0–1), že hrací karta nabízená ve Večerce má vylepšení (výchozí 0,2; Kartářka 0,5). */
  playingCardEnhanceChance: number;
  /** Šance (0–1), že hrací karta nabízená ve Večerce má pečeť (výchozí 0; Kartářka 0,2). */
  playingCardSealChance: number;

  /** Násobič čitatele všech pravděpodobností („1 z 4“ → „2 z 4“). */
  probabilityMult: number;
  /** Násobič cílového skóre útrat. */
  targetMult: number;

  /** Postupka a Barva stačí ze 4 karet. */
  fourCardStraightFlush: boolean;
  /** Postupka smí mít mezery o jednu hodnotu. */
  straightGaps: boolean;
  /** Postupka smí jít „kolem dokola“ (Q-K-A-2-3). */
  straightWrap: boolean;
  /** Všechny karty se počítají jako figury. */
  allFaces: boolean;
  /** ♥ = ♦ a ♠ = ♣ pro účely barev. */
  mergedSuits: boolean;
  /** Skórují všechny zahrané karty, ne jen ty v kombinaci. */
  allCardsScore: boolean;
  /**
   * Vylepšení hracích karet nefungují (Bílá hora): karta se chová, jako by vylepšení neměla —
   * žádné efekty, kamenná má zase hodnotu a barvu, divoká jen svou barvu.
   */
  disableEnhancements: boolean;
  /**
   * Pevné čipy každé karty místo hodnoty + `bonusChips` (Normalizace: 5). 0 = vypnuto.
   * Vylepšení a edice fungují normálně (kamenná tedy dá pevné čipy + svých +50).
   */
  fixedCardChips: number;
}

export type ModifierDelta = Partial<Modifiers>;

// ─────────────────────────── Instance obsahu ───────────────────────────

/** JSON-serializovatelný vnitřní stav žolíka/štítku (počítadla, nabíjení…). */
export type JsonValue = number | string | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type InstanceState = { [k: string]: JsonValue };

/** Nálepky obtížností na žolících: přibitý, zvětrávající, zapůjčený (DESIGN 4.6). Žolík má nejvýš jednu. */
export type StickerId = 'eternal' | 'perishable' | 'rental';

export interface JokerInstance {
  uid: number;
  defId: string;
  edition: EditionId | null;
  state: InstanceState;
  /** Prodejní cena navíc (roste u některých žolíků). */
  sellBonus: number;
  stickers: StickerId[];
  /** Zvětrávající žolík: kolik dokončených kol zbývá, než zvětrá (0 = zvětralý, trvale debuffnutý). */
  perishRounds?: number;
  debuffed: boolean;
}

export type ConsumableKind = 'pranostika' | 'rada' | 'razitko';

export interface ConsumableInstance {
  uid: number;
  defId: string;
  edition: EditionId | null;
}

export interface TagInstance {
  uid: number;
  defId: string;
  state: InstanceState;
}

// ─────────────────────────── Útraty a kola ───────────────────────────

export type BlindKind = 'small' | 'big' | 'boss';
export const BLIND_KINDS: readonly BlindKind[] = ['small', 'big', 'boss'];

export interface BlindSlot {
  kind: BlindKind;
  /** Id šéfa: u `boss` šéf patra; u `big` pravidlo šéfa navíc (Imperial, `StakeDef.bigBlindBoss`), jinak null. */
  bossId: string | null;
  /** Štítek, který hráč dostane za přeskočení (jen small/big). */
  skipTagId: string | null;
  status: 'upcoming' | 'current' | 'defeated' | 'skipped';
}

export interface RoundState {
  blind: BlindKind;
  bossId: string | null;
  bossDisabled: boolean;
  target: number;
  score: number;
  handsLeft: number;
  discardsLeft: number;
  /** Id karet; konec pole = vršek balíčku (táhne se z konce). */
  drawPile: number[];
  /** Id karet v ruce v pořadí zobrazení. */
  hand: number[];
  discardPile: number[];
  /** Zahrané karty už mimo ruku (do konce kola). */
  playedPile: number[];
  handsPlayed: number;
  discardsUsed: number;
  /** Typy kombinací zahrané v tomto kole (v pořadí). */
  handTypesPlayed: HandType[];
  /** Dočasná změna velikosti ruky do konce kola (`EngineApi.addRoundHandSize`; Velká voda, Rozložené noviny). */
  handSizeDelta: number;
  /** Uid žolíků dočasně debuffnutých do konce kola (`EngineApi.setJokerDebuffed`; Exekutor, Krajský úřad…). */
  jokerDebuffs: number[];
  /**
   * Id karet vrácených do provozu do konce kola (`EngineApi.cleanseCard`; Česnek na krk) — šéf je nedebuffne.
   * Volitelné kvůli uloženým runům ze starší verze (chybí = žádné).
   */
  cleansedCards?: number[];
  /** Volné pole pro šéfy/žolíky s per-kolo stavem (např. dočasné debuffy karet od Černé kočky). */
  flags: InstanceState;
}

// ─────────────────────────── Obchod a boostery ───────────────────────────

/** Společná pole položek Večerky. */
export interface ShopPriced {
  /** Aktuální cena v Kč (engine ji přepočítá po každé akci ve Večerce — slevy, `shopPriceAdd`). */
  price: number;
  sold: boolean;
  /** Zdarma (štítek, efekt): cena je 0, a to i při `shopPriceAdd`. */
  free?: boolean;
}

export type ShopItem = ShopPriced &
  (
    | { kind: 'joker'; joker: JokerInstance }
    | { kind: 'consumable'; consumable: ConsumableInstance; consumableKind: ConsumableKind }
    | { kind: 'card'; card: Card }
  );

/** Obálka nabízená ve Večerce. */
export interface ShopBooster extends ShopPriced {
  boosterId: string;
}

/** Kupón nabízený ve Večerce (drží se přes všechny Večerky patra). */
export interface ShopVoucher extends ShopPriced {
  voucherId: string;
}

export interface ShopState {
  items: ShopItem[];
  boosters: ShopBooster[];
  /** Kupóny nabízené v tomto patře (obnovují se po porážce šéfa). */
  vouchers: ShopVoucher[];
  /** Cena příštího přehození (0, pokud je k dispozici bezplatné přehození). */
  rerollCost: number;
  rerollsThisShop: number;
  /** Placená přehození v této Večerce (každé zdraží další o `rerollCostStep`). */
  paidRerolls: number;
  /** Počet bezplatných přehození (ze štítků). */
  freeRerolls: number;
}

export type BoosterOption =
  | { kind: 'joker'; joker: JokerInstance }
  | { kind: 'consumable'; consumable: ConsumableInstance; consumableKind: ConsumableKind }
  | { kind: 'card'; card: Card };

export interface BoosterState {
  boosterId: string;
  options: BoosterOption[];
  picksLeft: number;
  /** Při otevření babského/razítkového balíčku se dobere ruka, aby šly použít karty s cílem. */
  hand: number[];
  /** Kam se vrátit po zavření (obchod nebo výběr útraty u štítků). */
  returnTo: 'shop' | 'blind_select';
}

// ─────────────────────────── Run ───────────────────────────

export type RunPhase = 'blind_select' | 'round' | 'round_end' | 'shop' | 'booster' | 'game_over' | 'victory';

export type RngStreamName =
  'deck' | 'shop' | 'booster' | 'boss' | 'tag' | 'joker' | 'card' | 'consumable' | 'misc';

export type RngState = [number, number, number, number];

export interface RunStats {
  handsPlayed: number;
  discardsUsed: number;
  cardsPlayed: number;
  cardsDiscarded: number;
  bestHandScore: number;
  bestHandType: HandType | null;
  moneyEarned: number;
  moneySpent: number;
  jokersBought: number;
  jokersSold: number;
  consumablesUsed: number;
  rerolls: number;
  /** Kolikrát hráč vstoupil do Večerky (první Večerka runu má zaručenou Žolíkovou obálku). */
  shopsEntered: number;
  blindsSkipped: number;
  bossesDefeated: number;
  roundsWon: number;
  /** Kolikrát kterou kombinaci hráč zahrál. */
  handTypeCounts: Partial<Record<HandType, number>>;
  /** defId → počet kol, kdy žolík byl ve slotu. */
  jokerRoundCounts: Record<string, number>;
  /** Nejnižší dosažený zůstatek (pro achievementy typu „Na sekeru“). */
  minMoney: number;
  maxMoney: number;
}

/** Rozpis odměn za vyhrané kolo (čeká na „Vyúčtovat“). */
export interface RoundRewards {
  blindReward: number;
  unusedHands: number;
  unusedDiscards: number;
  interest: number;
  /** Bonusy a srážky (`source` např. `held`, `joker:<id>`, `rental:<id>`, `rentalReturned:<id>`). */
  extra: { source: string; amount: number; jokerUid?: number }[];
  total: number;
}

export interface GameOverInfo {
  /** Důvod pro „pitvu“: id šéfa nebo 'small'/'big'. */
  cause: string;
  ante: number;
  blind: BlindKind;
  score: number;
  target: number;
}

export interface RunState {
  /** Verze formátu uložení (viz engine/save). */
  version: number;
  seed: string;
  rng: Record<RngStreamName, RngState>;
  deckId: string;
  stake: number;
  challengeId: string | null;
  daily: boolean;

  ante: number;
  endless: boolean;
  blindIndex: number;
  blinds: BlindSlot[];
  phase: RunPhase;

  money: number;
  /** Všechny karty, které hráč vlastní (balíček runu). */
  deck: Card[];
  round: RoundState | null;
  jokers: JokerInstance[];
  consumables: ConsumableInstance[];
  handLevels: Record<HandType, HandLevelState>;
  /**
   * Kombinace zahrané (objevené) v tomto runu, v pořadí objevu. Pranostiky tajných kombinací se v obchodě
   * a obálkách nabízejí až po objevu (DESIGN 2.2.4).
   */
  discoveredHands: HandType[];
  vouchers: string[];
  tags: TagInstance[];
  shop: ShopState | null;
  booster: BoosterState | null;
  /** Kupóny nabídnuté v aktuálním patře (drží se přes všechny obchody patra). */
  anteVouchers: string[];
  /** Pravidla výzvy/jiná trvalá pravidla runu navíc (delta). */
  extraModifiers: ModifierDelta;
  /** Jokery zakázané v tomto runu (výzvy). */
  bannedJokers: string[];
  /** Které obsahové položky jsou pro tento run odemčené (z profilu). Prázdné = vše. */
  unlockedPool: { jokers: string[] | null; vouchers: string[] | null; boosters: string[] | null };
  /** Id použitých šéfů (aby se neopakovali, dokud jde vybírat). */
  bossesSeen: string[];
  /** Poslední použitá spotřebka (pro babskou radu „zopakuj poslední“). */
  lastConsumable: string | null;
  /** Kolikrát se dnes přehazoval šéf apod. — volné per-run příznaky. */
  flags: InstanceState;
  stats: RunStats;
  /** Odměny za právě vyhrané kolo (fáze round_end / victory), jinak null. */
  rewards: RoundRewards | null;
  gameOver: GameOverInfo | null;
  nextUid: number;
}

// ─────────────────────────── Akce ───────────────────────────

export type Action =
  | { type: 'selectBlind' }
  | { type: 'skipBlind' }
  | { type: 'rerollBoss' }
  | { type: 'play'; cardIds: number[] }
  | { type: 'discard'; cardIds: number[] }
  | { type: 'reorderHand'; cardIds: number[] }
  | { type: 'sortHand'; by: 'rank' | 'suit' }
  | { type: 'cashOut' }
  | { type: 'buy'; slot: number }
  | { type: 'buyAndUse'; slot: number; targetIds?: number[] }
  | { type: 'buyBooster'; slot: number }
  | { type: 'buyVoucher'; slot: number }
  | { type: 'reroll' }
  | { type: 'leaveShop' }
  /**
   * Výběr z obálky. Spotřebka se použije hned (s cíli `targetIds`), nebo se s `keep: true` uloží
   * do volného slotu spotřebek (DESIGN 2.9).
   */
  | { type: 'pickBooster'; index: number; targetIds?: number[]; keep?: boolean }
  | { type: 'skipBooster' }
  | { type: 'sellJoker'; uid: number }
  | { type: 'sellConsumable'; uid: number }
  | { type: 'useConsumable'; uid: number; targetIds?: number[] }
  | { type: 'reorderJokers'; uids: number[] }
  | { type: 'continueEndless' };

export type ActionType = Action['type'];

/** Kódy chyb — UI je překládá přes i18n klíč `errors.<code>`. */
export type ActionErrorCode =
  | 'wrongPhase'
  | 'invalidSelection'
  | 'noHandsLeft'
  | 'noDiscardsLeft'
  | 'notEnoughMoney'
  | 'slotsFull'
  | 'soldOut'
  | 'invalidTarget'
  | 'cannotSell'
  | 'cannotUse'
  | 'unknownItem'
  | 'cannotSkip';

export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; error: ActionErrorCode };

// ─────────────────────────── Skórování ───────────────────────────

export type ScoreSourceKind =
  'hand' | 'card' | 'held' | 'joker' | 'boss' | 'deck' | 'consumable' | 'tag' | 'voucher' | 'stake';

export interface ScoreStep {
  source: ScoreSourceKind;
  /** defId zdroje (žolík, šéf…) nebo id kombinace. */
  defId?: string;
  cardId?: number;
  jokerUid?: number;
  chips?: number;
  mult?: number;
  xmult?: number;
  money?: number;
  /** i18n klíč zvláštní hlášky (např. 'score.retrigger', 'score.glassBreak'). */
  message?: string;
  /** Průběžný stav po aplikaci kroku (pro animaci počítadla). */
  chipsAfter: number;
  multAfter: number;
}

export interface ScoreResult {
  hand: DetectedHand;
  playedIds: number[];
  steps: ScoreStep[];
  chips: number;
  mult: number;
  /** floor(chips × mult); 0, pokud šéf ruku zakázal. */
  score: number;
  /** Důvod, proč ruka neskóruje (i18n klíč), např. 'boss.repeatHand'. */
  blockedReason: string | null;
  destroyedCardIds: number[];
  moneyEarned: number;
}

/** Náhled pro živé „čipy × mult“ při výběru karet (bez náhody, bez efektů žolíků). */
export interface HandPreview {
  hand: DetectedHand | null;
  chips: number;
  mult: number;
  level: number;
  /** Výběr obsahuje kartu lícem dolů — náhled se nepočítá a UI ukáže „?“ (DESIGN 2.1). */
  hidden: boolean;
}

// ─────────────────────────── Události ───────────────────────────

export type GameEvent =
  | { type: 'runStarted'; seed: string }
  | { type: 'blindSelected'; blind: BlindKind; bossId: string | null; target: number }
  | { type: 'blindSkipped'; blind: BlindKind; tagId: string | null }
  | { type: 'bossRerolled'; bossId: string }
  | { type: 'roundStarted'; ante: number; blind: BlindKind; target: number }
  | { type: 'cardsDrawn'; cardIds: number[] }
  | { type: 'handPlayed'; result: ScoreResult; roundScore: number }
  /**
   * Zahozené karty; `forced` = zahození efektem (šéf), ne akcí hráče. Hráčovo zahození přijde před reakcemi na něj
   * (peníze žolíka, nucené zahození šéfem).
   */
  | { type: 'cardsDiscarded'; cardIds: number[]; forced?: boolean }
  /** Pořadí karet v ruce se změnilo efektem (zamíchání). */
  | { type: 'handShuffled'; cardIds: number[] }
  | { type: 'cardDestroyed'; cardId: number; reason: string }
  | { type: 'cardAdded'; cardId: number; source: string }
  | { type: 'cardChanged'; cardId: number }
  | { type: 'roundWon'; ante: number; blind: BlindKind; score: number; target: number }
  | ({ type: 'roundRewards' } & RoundRewards)
  | { type: 'cashedOut'; amount: number }
  | { type: 'moneyChanged'; delta: number; money: number; reason: string }
  | { type: 'shopEntered' }
  /** Přehození nabídky; `cost` = zaplacená cena (0 = bezplatné přehození), cena dalšího je v `ShopState.rerollCost`. */
  | { type: 'shopRerolled'; cost: number }
  | { type: 'shopLeft' }
  | {
      type: 'itemBought';
      kind: 'joker' | 'consumable' | 'card' | 'booster' | 'voucher';
      defId: string;
      price: number;
    }
  | { type: 'jokerAdded'; uid: number; defId: string }
  | { type: 'jokerSold'; uid: number; defId: string; price: number }
  | { type: 'jokerDestroyed'; uid: number; defId: string; reason: string }
  | { type: 'jokerTriggered'; uid: number; defId: string; message: string }
  /** Žolík byl dočasně (do konce kola) debuffnut nebo debuff skončil. */
  | { type: 'jokerDebuffChanged'; uid: number; debuffed: boolean }
  /**
   * Žolíkovi se efektem změnila edice nebo nálepky (`setJokerEdition`, `removeJokerStickers`), nebo se proměnil
   * v jiného (`transformJoker`; `defId` je pak nové).
   */
  | { type: 'jokerChanged'; uid: number; defId: string }
  | { type: 'consumableAdded'; uid: number; defId: string }
  | { type: 'consumableUsed'; uid: number; defId: string }
  | { type: 'consumableSold'; uid: number; defId: string; price: number }
  | { type: 'boosterOpened'; boosterId: string }
  | { type: 'boosterPicked'; boosterId: string; index: number }
  | { type: 'boosterClosed'; boosterId: string; skipped: boolean }
  | { type: 'voucherRedeemed'; voucherId: string }
  | { type: 'tagAdded'; uid: number; defId: string }
  | { type: 'tagTriggered'; uid: number; defId: string }
  | { type: 'handLeveled'; hand: HandType; level: number; delta: number }
  | { type: 'handDiscovered'; hand: HandType }
  | { type: 'anteChanged'; ante: number }
  | { type: 'bossDefeated'; bossId: string }
  | { type: 'gameOver'; info: GameOverInfo }
  | { type: 'victory'; ante: number }
  | { type: 'endlessStarted' }
  | { type: 'message'; key: string; params?: Record<string, string | number> };

export type GameEventType = GameEvent['type'];
