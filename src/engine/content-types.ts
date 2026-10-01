/**
 * Rozhraní definic obsahu (žolíci, šéfové, spotřebky…) a kontextů hooků.
 *
 * Obsah žije v src/content/*.ts jako pole objektů těchto typů. Engine dostává obsah
 * přes `ContentRegistry` (dependency injection) — díky tomu jde engine testovat
 * s malým testovacím obsahem a engine nikdy neimportuje src/content přímo.
 *
 * Konvence textů (src/i18n): `jokers.<id>.name|desc|flavor`, `bosses.<id>.name|rule|intro|defeat|death`,
 * `consumables.<id>.name|desc|flavor`, `vouchers.<id>.name|desc|flavor`, `tags.<id>.name|desc|flavor`,
 * `decks.<id>.name|desc|flavor`, `stakes.<id>.name|desc|flavor`, `challenges.<id>.name|desc|flavor`,
 * `boosters.<id>.name|desc`, `enhancements.<id>.name|desc|flavor`, `seals.<id>…`, `editions.<id>…`,
 * `hands.<type>.name|desc`. Popisky (`desc`) smí obsahovat `{param}` — hodnoty dodá `params`
 * a u žolíků navíc `describe(self)`.
 */
import type {
  Card,
  ConsumableInstance,
  ConsumableKind,
  DetectedHand,
  EditionId,
  HandType,
  HandTypeDef,
  JokerInstance,
  ModifierDelta,
  Modifiers,
  Rank,
  RoundState,
  RunState,
  StickerId,
  Suit,
  TagInstance,
} from './types';

// ─────────────────────────── RNG ───────────────────────────

export interface Rng {
  /** Rovnoměrně v [0, 1). */
  next(): number;
  /** Celé číslo v [min, max] včetně. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Zamíchá pole na místě (Fisher–Yates) a vrátí ho. */
  shuffle<T>(items: T[]): T[];
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
  /** true s pravděpodobností p. */
  chance(p: number): boolean;
}

// ─────────────────────────── Výsledky efektů ───────────────────────────

/**
 * Výsledek hooku při skórování. Aplikuje se v pořadí chips → mult → xmult → money.
 * Hook smí vrátit i pole výsledků (aplikují se postupně).
 */
export interface EffectResult {
  chips?: number;
  mult?: number;
  xmult?: number;
  money?: number;
  /** i18n klíč „bubliny“ nad zdrojem (např. 'score.again', 'jokers.pendolino.delay'). */
  message?: string;
  /** Jen v onCardScored/afterCardScored: karta se po vyhodnocení ruky zničí. */
  destroyCard?: boolean;
}

export type HookResult = EffectResult | EffectResult[] | void | null | undefined;

// ─────────────────────────── API pro hooky ───────────────────────────

export interface CardSpec {
  suit: Suit;
  rank: Rank;
  enhancement?: string | null;
  seal?: string | null;
  edition?: EditionId | null;
  bonusChips?: number;
}

export interface CreateJokerOptions {
  defId?: string;
  rarity?: JokerRarity;
  edition?: EditionId | null;
  stickers?: StickerId[];
  /** Ignorovat limit slotů (např. negativní edice se kontroluje zvlášť). */
  ignoreSlots?: boolean;
}

/**
 * Příkazy, které smí obsah volat. Všechny jsou deterministické (náhoda jde přes RNG streamy),
 * emitují odpovídající události a respektují limity (sloty, dluh…).
 */
export interface EngineApi {
  addMoney(amount: number, reason: string): void;
  addHands(n: number): void;
  addDiscards(n: number): void;
  /** Dobere n karet do ruky (jen během kola). */
  drawCards(n: number): void;
  levelUpHand(hand: HandType, levels?: number): void;
  /** Vrátí null, když nejsou volné sloty. */
  createJoker(opts?: CreateJokerOptions): JokerInstance | null;
  destroyJoker(uid: number, reason: string): void;
  /** Vrátí null, když nejsou volné sloty (pokud ignoreSlots není true). */
  createConsumable(opts: {
    kind?: ConsumableKind;
    defId?: string;
    /** Pranostika pro danou kombinaci. */
    forHand?: HandType;
    edition?: EditionId | null;
    ignoreSlots?: boolean;
  }): ConsumableInstance | null;
  /** Přidá kartu do balíčku runu; volitelně rovnou do ruky. */
  addCard(spec: CardSpec, opts?: { toHand?: boolean; source?: string }): Card;
  copyCard(cardId: number, opts?: { toHand?: boolean }): Card | null;
  destroyCard(cardId: number, reason: string): void;
  modifyCard(
    cardId: number,
    patch: Partial<Pick<Card, 'suit' | 'rank' | 'enhancement' | 'seal' | 'edition' | 'bonusChips'>>,
  ): void;
  addTag(defId: string): void;
  disableBoss(): void;
  message(key: string, params?: Record<string, string | number>): void;

  // ── dotazy ──
  getCard(id: number): Card | undefined;
  handCards(): Card[];
  modifiers(): Modifiers;
  handLevel(hand: HandType): number;
  /** Figura? (respektuje allFaces a debuff se nebere v potaz). */
  isFace(card: Card): boolean;
  /** Má karta danou barvu? (divoká = všechny, kamenná = žádná, mergedSuits…) */
  hasSuit(card: Card, suit: Suit): boolean;
  /** Základní čipy karty (2–10 = číslo, J/Q/K = 10, A = 11, kamenná 0) + bonusChips. */
  cardChips(card: Card): number;
  /** Plný počet slotů žolíků po započtení negativních edicí. */
  jokerSlots(): number;
  /** Prodejní cena žolíka. */
  sellValue(joker: JokerInstance): number;
}

// ─────────────────────────── Kontexty hooků ───────────────────────────

export interface BaseCtx {
  /** Stav runu — POUZE ke čtení. Měň ho výhradně přes `api` (výjimka: `self.state` u žolíků/štítků). */
  readonly state: Readonly<RunState>;
  readonly api: EngineApi;
  readonly rng: Rng;
  readonly mods: Readonly<Modifiers>;
  /** „numerator z denominator“ — respektuje Modifiers.probabilityMult. */
  chance(numerator: number, denominator: number): boolean;
}

export interface ScoringInfo {
  readonly hand: DetectedHand;
  readonly played: readonly Card[];
  readonly scoring: readonly Card[];
  readonly held: readonly Card[];
  /** Průběžné hodnoty v okamžiku volání. */
  readonly chips: number;
  readonly mult: number;
  readonly round: Readonly<RoundState>;
  /** První ruka kola? */
  readonly firstHand: boolean;
  /** Poslední ruka kola (po ní už nezbývá žádná)? */
  readonly lastHand: boolean;
}

export interface JokerCtx extends BaseCtx {
  /** Instance žolíka — `self.state` smí hook měnit. */
  readonly self: JokerInstance;
  readonly def: JokerDef;
  /** Pozice v řadě žolíků (0 = nejvíc vlevo). */
  readonly index: number;
  /** true, pokud je hook volán kopírujícím žolíkem — pak NEMĚŇ self.state. */
  readonly isCopy: boolean;
}

export type JokerScoringCtx = JokerCtx & ScoringInfo;
export type JokerCardCtx = JokerScoringCtx & { readonly card: Card; readonly isRetrigger: boolean };

export interface JokerHooks {
  /** Trvalá změna pravidel (sloty, velikost ruky, Postupka ze 4 karet…). Musí být čistá funkce. */
  passive?(ctx: JokerCtx): ModifierDelta;
  onBlindSelect?(ctx: JokerCtx): void;
  onRoundStart?(ctx: JokerCtx): void;
  /** Po detekci kombinace, před skórováním (vylepšení kombinace, úpravy karet, nabíjení). */
  beforeScoring?(ctx: JokerScoringCtx): HookResult;
  /** Skórující karta (krok 2 pořadí). Volá se pro každou aktivaci karty, včetně opakovaných. */
  onCardScored?(ctx: JokerCardCtx): HookResult;
  /** Kolikrát má skórující karta skórovat navíc. */
  retriggerScored?(ctx: JokerCardCtx): number;
  /** Karta držená v ruce (krok 3). */
  onCardHeld?(ctx: JokerCardCtx): HookResult;
  retriggerHeld?(ctx: JokerCardCtx): number;
  /** Hlavní efekt „po zahrání ruky“ (krok 4): +čipy, +mult, ×mult. */
  onHandPlayed?(ctx: JokerScoringCtx): HookResult;
  /** Po sečtení skóre ruky — aktualizace stavu (počítadla), peníze. */
  afterHandScored?(ctx: JokerScoringCtx & { readonly score: number }): void;
  onDiscard?(
    ctx: JokerCtx & { readonly discarded: readonly Card[]; readonly firstDiscard: boolean },
  ): HookResult;
  onRoundEnd?(ctx: JokerCtx & { readonly blind: RoundState['blind']; readonly bossId: string | null }): void;
  /** Peníze navíc v rozpisu odměn na konci kola. */
  roundEndMoney?(ctx: JokerCtx): number;
  onShopEnter?(ctx: JokerCtx): void;
  onReroll?(ctx: JokerCtx): void;
  /** Volá se všem žolíkům, když se prodává žolík (včetně sebe: `isSelf`). */
  onSell?(ctx: JokerCtx & { readonly sold: JokerInstance; readonly isSelf: boolean }): void;
  onCardAdded?(ctx: JokerCtx & { readonly card: Card }): void;
  onCardDestroyed?(ctx: JokerCtx & { readonly card: Card }): void;
  onConsumableUsed?(ctx: JokerCtx & { readonly defId: string; readonly kind: ConsumableKind }): void;
  onBossDefeated?(ctx: JokerCtx & { readonly bossId: string }): void;
  onSkipBlind?(ctx: JokerCtx): void;
  onBoosterOpened?(ctx: JokerCtx & { readonly boosterId: string }): void;
  onBoosterSkipped?(ctx: JokerCtx & { readonly boosterId: string }): void;
  /** Poslední ruka nestačila: vrať true, pokud žolík zachrání run (kolo se počítá jako vyhrané). */
  preventGameOver?(ctx: JokerCtx & { readonly score: number; readonly target: number }): boolean;
  /** Kopírující žolík: vrátí uid žolíka, jehož schopnost kopíruje (nebo null). */
  copyTarget?(ctx: JokerCtx): number | null;
}

export type JokerRarity = 'common' | 'rare' | 'epic' | 'legendary';
export const JOKER_RARITIES: readonly JokerRarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Štítky pro simulaci/AI a filtrování ve sbírce. */
export type JokerTag =
  | 'chips'
  | 'mult'
  | 'xmult'
  | 'economy'
  | 'scaling'
  | 'retrigger'
  | 'hand'
  | 'suit'
  | 'face'
  | 'rank'
  | 'discard'
  | 'utility'
  | 'consumable'
  | 'deck'
  | 'copy';

/**
 * Procedurální obrázek: ikona (id SVG ze src/assets/icons nebo vestavěný glyf) + paleta + vzor.
 * UI z toho skládá jednotný styl karty žolíka (viz src/ui/art).
 */
export interface ArtSpec {
  icon: string;
  bg: string;
  fg: string;
  accent?: string;
  pattern?: 'none' | 'stripes' | 'dots' | 'checker' | 'waves' | 'rays' | 'grid' | 'zigzag';
  /** Doplňková rekvizita (druhá menší ikona). */
  prop?: string;
}

export type UnlockCondition =
  | { type: 'winRun'; deck?: string; stake?: number }
  | { type: 'reachAnte'; ante: number }
  | { type: 'playHand'; hand: HandType; count?: number }
  | { type: 'scoreInHand'; atLeast: number }
  | { type: 'haveMoney'; atLeast: number }
  | { type: 'winsTotal'; count: number }
  | { type: 'runsTotal'; count: number }
  | { type: 'discover'; category: 'jokers' | 'consumables' | 'vouchers'; count: number }
  | { type: 'custom'; id: string };

export interface JokerDef {
  id: string;
  rarity: JokerRarity;
  cost: number;
  tags: JokerTag[];
  /** Čísla do popisku (`{mult}` apod.) — popisek i mechanika musí používat stejná čísla. */
  params?: Record<string, number | string>;
  /** Dynamické hodnoty do popisku podle stavu (např. „aktuálně +12 mult“). */
  describe?(self: JokerInstance): Record<string, number | string>;
  initState?(): JokerInstance['state'];
  hooks: JokerHooks;
  art: ArtSpec;
  unlock?: UnlockCondition;
  /** Jde kopírovat kopírujícími žolíky? (default true) */
  copyable?: boolean;
  /** Nelze najít v obchodě (např. jen ze speciálních efektů). */
  noShop?: boolean;
}

// ─────────────────────────── Úpravy karet ───────────────────────────

export type CardCtx = BaseCtx & ScoringInfo & { readonly card: Card };

export interface EnhancementDef {
  id: string;
  /** Kamenná: karta nemá hodnotu ani barvu, vždy skóruje, nedává základní čipy. */
  noRankSuit?: boolean;
  /** Divoká: patří do všech barev. */
  allSuits?: boolean;
  params?: Record<string, number | string>;
  onScored?(ctx: CardCtx): HookResult;
  /** Po skórování — např. skleněná může prasknout (destroyCard). */
  afterScored?(ctx: CardCtx): HookResult;
  onHeld?(ctx: CardCtx): HookResult;
  /** Peníze za kartu drženou v ruce na konci kola (zlatá). */
  roundEndHeldMoney?(ctx: BaseCtx & { readonly card: Card }): number;
  art: ArtSpec;
}

export interface SealDef {
  id: string;
  params?: Record<string, number | string>;
  /** Kolikrát navíc karta skóruje (červená = 1). */
  retriggers?: number;
  onScored?(ctx: CardCtx): HookResult;
  /** Karta držená v ruce na konci kola (modrá: vytvoří pranostiku). */
  onRoundEndHeld?(ctx: BaseCtx & { readonly card: Card; readonly lastHand: HandType | null }): void;
  onDiscarded?(ctx: BaseCtx & { readonly card: Card }): void;
  art: ArtSpec;
}

export interface EditionDef {
  id: string;
  params?: Record<string, number | string>;
  /** Efekt edice (karta při skórování / žolík po svém efektu). */
  effect?(): EffectResult;
  /** Kdy se efekt edice žolíka aplikuje vůči jeho vlastnímu efektu. */
  jokerTiming?: 'before' | 'after';
  /** Sloty žolíků/spotřebek navíc (negativní). */
  extraSlots?: number;
  /** Příplatek k ceně v obchodě. */
  priceAdd: number;
  /** Váha při losování edice. */
  weight: number;
  /** Může se objevit na hracích kartách? */
  forCards: boolean;
}

// ─────────────────────────── Spotřebky ───────────────────────────

export interface ConsumableCtx extends BaseCtx {
  readonly self: ConsumableInstance;
  /** Vybrané karty v ruce (cíle). */
  readonly targets: readonly Card[];
}

export interface ConsumableDef {
  id: string;
  kind: ConsumableKind;
  cost: number;
  /** Pranostika: kterou kombinaci zvyšuje. */
  hand?: HandType;
  /** Kolik karet v ruce musí být vybráno (např. {min:1,max:2}). */
  target?: { min: number; max: number };
  params?: Record<string, number | string>;
  canUse?(ctx: ConsumableCtx): boolean;
  use(ctx: ConsumableCtx): void;
  art: ArtSpec;
  unlock?: UnlockCondition;
  /** Nelze najít v obchodě/boosteru běžně (jen speciálně). */
  noShop?: boolean;
}

// ─────────────────────────── Šéfové ───────────────────────────

export type BossCtx = BaseCtx & { readonly round: Readonly<RoundState> };

export interface BossHooks {
  passive?(ctx: BossCtx): ModifierDelta;
  onRoundStart?(ctx: BossCtx): void;
  isCardDebuffed?(ctx: BossCtx, card: Card): boolean;
  /** Má se karta líznout lícem dolů? */
  isDrawnFaceDown?(ctx: BossCtx, card: Card, info: { drawIndex: number; handsPlayed: number }): boolean;
  /** Vrátí i18n klíč důvodu, proč ruka neskóruje, nebo null. Ruka se tím spotřebuje. */
  validateHand?(ctx: BossCtx & ScoringInfo): string | null;
  /** Úprava základu kombinace před skórováním (např. poloviční čipy i mult). */
  modifyBase?(
    ctx: BossCtx & ScoringInfo,
    base: { chips: number; mult: number },
  ): { chips: number; mult: number };
  /** Po zahrání ruky (ztráta peněz, zahození náhodných karet…). */
  afterHandPlayed?(ctx: BossCtx & ScoringInfo): void;
  onDiscard?(ctx: BossCtx & { readonly discarded: readonly Card[] }): void;
  onDraw?(ctx: BossCtx & { readonly drawn: readonly Card[] }): void;
}

export interface BossDef {
  id: string;
  /** Finálový šéf — jen v patře 8 (a každém 8. patře nekonečného režimu). */
  final?: boolean;
  /** Od kterého patra se může objevit. */
  minAnte?: number;
  /** Násobek základního cíle patra (default 2). */
  targetMult?: number;
  /** Odměna v Kč (default 5). */
  reward?: number;
  /** Barva šéfa v UI (CSS barva). */
  color: string;
  hooks: BossHooks;
  art: ArtSpec;
}

// ─────────────────────────── Štítky, kupóny, boostery ───────────────────────────

export type TagCtx = BaseCtx & { readonly self: TagInstance };

/** Každý hook vrací true, pokud se štítek tímto spotřeboval (odebere se). */
export interface TagHooks {
  onAdded?(ctx: TagCtx): boolean;
  onBlindSelect?(ctx: TagCtx): boolean;
  onRoundStart?(ctx: TagCtx): boolean;
  onRoundEnd?(ctx: TagCtx): boolean;
  onShopEnter?(ctx: TagCtx): boolean;
  /** Úprava cen/obsahu obchodu při generování (po onShopEnter). */
  passive?(ctx: TagCtx): ModifierDelta;
}

export interface TagDef {
  id: string;
  minAnte?: number;
  params?: Record<string, number | string>;
  hooks: TagHooks;
  art: ArtSpec;
}

export interface VoucherDef {
  id: string;
  tier: 1 | 2;
  /** Tier 2 vyžaduje vlastnictví tier 1. */
  requires?: string;
  cost: number;
  params?: Record<string, number | string>;
  passive?(ctx: BaseCtx): ModifierDelta;
  onRedeem?(ctx: BaseCtx): void;
  art: ArtSpec;
  unlock?: UnlockCondition;
}

export type BoosterKind = 'pranostika' | 'rada' | 'razitko' | 'joker' | 'card';

export interface BoosterDef {
  id: string;
  kind: BoosterKind;
  size: 'normal' | 'jumbo' | 'mega';
  /** Kolik možností se nabídne. */
  options: number;
  /** Kolik si hráč smí vybrat. */
  picks: number;
  cost: number;
  /** Váha v obchodě. */
  weight: number;
  art: ArtSpec;
}

// ─────────────────────────── Balíčky, obtížnosti, výzvy ───────────────────────────

export interface DeckDef {
  id: string;
  /** Vlastní složení balíčku; default 52 karet. */
  buildDeck?(rng: Rng): CardSpec[];
  passive?(ctx: BaseCtx): ModifierDelta;
  onRunStart?(ctx: BaseCtx): void;
  /** Peníze navíc na konci kola. */
  roundEndMoney?(ctx: BaseCtx): number;
  startingMoney?: number;
  params?: Record<string, number | string>;
  art: ArtSpec;
  unlock?: UnlockCondition;
}

export interface StakeDef {
  id: string;
  /** 1 = Desítka … 8 = Imperial. Obtížnost N zahrnuje efekty všech nižších. */
  level: number;
  /** Ztížení přidané touto úrovní (kumuluje se s nižšími). */
  passive?(ctx: BaseCtx): ModifierDelta;
  onRunStart?(ctx: BaseCtx): void;
  /** Křivka cílů (index do tabulky v engine/run/targets.ts). Vyšší úroveň přepisuje nižší. */
  targetCurve?: number;
  /** Malá útrata nedává odměnu. */
  noSmallBlindReward?: boolean;
  /** Šance (0–1), že žolík v obchodě dostane nálepku. */
  stickerChance?: Partial<Record<StickerId, number>>;
  art: ArtSpec;
}

export interface ChallengeDef {
  id: string;
  deckId: string;
  extraModifiers?: ModifierDelta;
  startingMoney?: number;
  startingJokers?: { defId: string; edition?: EditionId | null; stickers?: StickerId[] }[];
  startingConsumables?: string[];
  startingVouchers?: string[];
  bannedJokers?: string[];
  bannedVouchers?: string[];
  customDeck?: CardSpec[];
  /** Další pravidla (i18n klíče pod `challenges.<id>.rules`). */
  ruleKeys?: string[];
  onRunStart?(ctx: BaseCtx): void;
  art: ArtSpec;
  unlock?: UnlockCondition;
}

// ─────────────────────────── Registr ───────────────────────────

export interface ContentRegistry {
  handTypes: Record<HandType, HandTypeDef>;
  jokers: Record<string, JokerDef>;
  consumables: Record<string, ConsumableDef>;
  enhancements: Record<string, EnhancementDef>;
  seals: Record<string, SealDef>;
  editions: Record<string, EditionDef>;
  bosses: Record<string, BossDef>;
  tags: Record<string, TagDef>;
  vouchers: Record<string, VoucherDef>;
  boosters: Record<string, BoosterDef>;
  decks: Record<string, DeckDef>;
  stakes: Record<string, StakeDef>;
  challenges: Record<string, ChallengeDef>;
}

export interface NewRunOptions {
  seed?: string;
  deckId: string;
  stake: number;
  challengeId?: string | null;
  daily?: boolean;
  unlockedPool?: RunState['unlockedPool'];
}
