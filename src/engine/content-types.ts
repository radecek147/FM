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
import type { AchievementDef } from './meta/types';

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
  /** Jen u efektů skórující karty (vylepšení, pečeť, `onCardScored`): karta se po vyhodnocení ruky zničí. */
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
  /**
   * Otevře zdarma obálku `boosterId` (štítky Obálka od strýce, Úřední dopis…). Obálka se zařadí do fronty
   * (`RunState.flags.pendingBoosters`) a engine ji otevře hned po akci, jakmile je fáze výběr útraty nebo Večerka
   * (zavřením se vrátí tam); víc obálek se otevře postupně. Vrací false, když obálku registr nezná.
   */
  openBooster(boosterId: string): boolean;
  /** Přidá bezplatná přehození: v otevřené Večerce hned, jinak do příští Večerky (Otevřené dveře). */
  addFreeRerolls(n: number): void;
  /**
   * Přidá do otevřené Večerky žolíka navíc (Doporučení od známého, Protekce): vzácnost `rarity` (bez ní podle vah),
   * edice `edition` (bez ní hod jako v obchodě), nálepky podle obtížnosti, cena × `priceMult`. Položka má `extra`:
   * přehození ji nemění. Bez otevřené Večerky nebo bez žolíka v poolu vrací false.
   */
  addShopJoker(opts?: {
    rarity?: JokerRarity;
    edition?: EditionId | null;
    priceMult?: number;
    noEditionSurcharge?: boolean;
  }): boolean;
  /**
   * Dá prvnímu neprodanému žolíkovi bez edice v otevřené Večerce edici `edition`, s `noSurcharge` bez příplatku
   * (Vyleštěné příbory, Fotonegativ). Vrací false, když takový žolík v nabídce není (nebo Večerka není otevřená).
   */
  setShopJokerEdition(edition: EditionId, opts?: { noSurcharge?: boolean }): boolean;
  /**
   * Přidá do otevřené Večerky kupón navíc jen pro tuto Večerku (Úřední poukaz) — z kupónů, které jde teď koupit
   * a v nabídce nejsou. Vrací id kupónu, nebo null (žádný není, Večerka zavřená).
   */
  addShopVoucher(): string | null;
  /**
   * Vypne pravidlo šéfa do konce kola (Odvolání): zruší debuffy karet i žolíků z kola, otočí karty v ruce lícem
   * nahoru a vrátí ruce/zahození, které šéf ubral (rozdíl modifikátorů; ruce nejníž 1). Cíl zůstává.
   */
  disableBoss(): void;
  message(key: string, params?: Record<string, string | number>): void;

  /**
   * Zahodí kartu z ruky efektem (Kapsář v tramvaji, Tchyně na návštěvě): karta jde na odhazovací hromádku,
   * nespotřebuje zahození a nespouští hooky zahození (žolíci, fialová pečeť). Nedobírá — ruka se doplní
   * při nejbližším běžném dobrání. Vrací false, když karta v ruce není.
   */
  discardFromHand(cardId: number): boolean;
  /**
   * Dočasně (do konce kola) debuffne žolíka, nebo debuff zruší (Exekutor, Jednooký hejtman, Krajský úřad,
   * Výpadek proudu). Zvětralého žolíka zrušení neoživí. Mimo kolo nedělá nic. Vypnutí šéfa debuffy zruší.
   */
  setJokerDebuffed(uid: number, on: boolean): void;
  /** Otočí kartu lícem dolů/nahoru (Bílá paní, Česnek na krk). Na konci kola se všechny otočí nahoru. */
  setCardFaceDown(cardId: number, on: boolean): void;
  /** Náhodně zamíchá pořadí karet v ruce (Bílá paní). */
  shuffleHand(): void;
  /** Základní čipy a mult kombinace na dané úrovni (Nová vyhláška, Influencerka Nikča v `modifyBase`). */
  handBase(hand: HandType, level: number): { chips: number; mult: number };
  /**
   * Změní velikost ruky do konce kola o `n` (Velká voda −1, Rozložené noviny +2). Ruka se nedobírá hned,
   * ale při nejbližším doplnění (při zmenšení se karty nezahazují). Mimo kolo nedělá nic.
   */
  addRoundHandSize(n: number): void;
  /** Nastaví peníze přesně na `n` Kč (Daňové přiznání); na rozdíl od `addMoney` neořezává dluhem. */
  setMoney(n: number, reason: string): void;
  /**
   * Posune patro o `delta` (Úřední škrt, Amnestie: −1), nejníž na patro 1. Rozehrané útraty patra
   * pokračují (cíle se počítají při výběru útraty); šéf se přelosuje, jen když pro nové patro neplatí.
   */
  changeAnte(delta: number): void;
  /** Zvýší úroveň všech kombinací, včetně tajných (Úřední hodiny). */
  levelUpAll(levels: number): void;
  /**
   * Trvale (do konce runu) přičte deltu modifikátorů do `RunState.extraModifiers` se stejnými pravidly
   * jako skládání (čísla +, `*Mult` ×, booleany OR). Ruce/zahození se projeví od dalšího kola.
   */
  addPermanentModifier(delta: ModifierDelta): void;
  /**
   * Zdarma přelosuje šéfa aktuálního patra (Známý na úřadě). Jde jen před jeho kolem; vrací nové id
   * šéfa nebo null, když přelosovat nejde.
   */
  rerollBoss(): string | null;
  /**
   * Nastaví edici žolíka (Hromadné vyřízení); `null` edici odebere. Negativní edice tím přidá/ubere slot.
   * Neznámá edice = výjimka (chyba obsahu).
   */
  setJokerEdition(uid: number, edition: EditionId | null): void;
  /**
   * Odebere žolíkovi nálepky — všechny, nebo jen vyjmenované (Prominutí pokut). Bez „zvětrávající“ zmizí
   * i odpočet kol a zvětralý žolík znovu funguje (dočasný debuff z kola zůstává).
   */
  removeJokerStickers(uid: number, stickers?: readonly StickerId[]): void;
  /**
   * Zkopíruje žolíka včetně stavu (`state`), nálepek, odpočtu zvětrávání a prodejního bonusu (Ověřená kopie).
   * `edition` přepíše edici kopie (výchozí = edice originálu). Kopie vstoupí do slotů jako získaná (`onAcquire`).
   * Vrátí null, když originál neexistuje nebo pro kopii není místo (pokud `ignoreSlots` není true).
   */
  copyJoker(uid: number, opts?: { edition?: EditionId | null; ignoreSlots?: boolean }): JokerInstance | null;
  /**
   * Promění žolíka v jiného (`defId`) na stejném místě (Kouzelný kotlík): `uid`, pozice, edice, nálepky
   * i odpočet zvětrávání zůstanou; stav se založí znovu (`initState`), prodejní bonus se vynuluje a nový žolík
   * dostane `onAcquire`. Emituje `jokerChanged`. Vrátí null, když žolík nebo `defId` neexistuje (nebo je stejné).
   */
  transformJoker(uid: number, defId: string): JokerInstance | null;
  /**
   * Vrátí kartu do provozu (Česnek na krk): zruší debuff a otočí ji lícem nahoru; šéf ji do konce kola znovu
   * nedebuffne (`RoundState.cleansedCards`). Jen během kola, jinak nic.
   */
  cleanseCard(cardId: number): void;

  // ── dotazy ──
  /** Vzácnost žolíka podle definice (null = registr ho nezná). */
  jokerRarity(defId: string): JokerRarity | null;
  /** Druh spotřebky podle definice (null = registr ji nezná) — Babiččin recept opakuje jen rady a pranostiky. */
  consumableKind(defId: string): ConsumableKind | null;
  /** Kombinace, kterou spotřebka zvyšuje (`ConsumableDef.hand`, pranostiky); jinak null — Krakonoš. */
  consumableHand(defId: string): HandType | null;
  /** Jde žolíka kopírovat (`JokerDef.copyable !== false`; registr ho nezná → false)? — Napodobitel. */
  jokerCopyable(defId: string): boolean;
  /**
   * Id žolíků, ze kterých by teď losoval `createJoker` se stejnou `rarity` (odemčené, nezakázané, nevlastněné;
   * legendární i `noShop`). Prázdné pole = `createJoker` by sáhl po náhradním žolíkovi (Výjimka z vyhlášky,
   * Daňové přiznání to kontrolují v `canUse`).
   */
  availableJokers(opts?: { rarity?: JokerRarity }): string[];
  getCard(id: number): Card | undefined;
  handCards(): Card[];
  /** Aktuální modifikátory — zmrazený objekt (jen ke čtení; pravidla mění delta, např. `addPermanentModifier`). */
  modifiers(): Readonly<Modifiers>;
  handLevel(hand: HandType): number;
  /** Figura? (respektuje allFaces a debuff se nebere v potaz). */
  isFace(card: Card): boolean;
  /** Hodnota karty pro pravidla; kamenná (`noRankSuit`, pokud vylepšení platí) hodnotu nemá → null (Sudé dny). */
  cardRank(card: Card): Rank | null;
  /** Má karta danou barvu? (divoká = všechny, kamenná = žádná, mergedSuits…) */
  hasSuit(card: Card, suit: Suit): boolean;
  /** Základní čipy karty (2–10 = číslo, J/Q/K = 10, A = 11, kamenná 0) + bonusChips; respektuje `fixedCardChips`. */
  cardChips(card: Card): number;
  /** Plný počet slotů žolíků po započtení negativních edicí. */
  jokerSlots(): number;
  /** Prodejní cena žolíka (DESIGN 2.5.2; zapůjčený 1 Kč). Přibitý se prodat nedá, ale hodnotu má. */
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
  /**
   * Žolík právě vstoupil do slotů — koupě, obálka nebo efekt (`createJoker`); ne startovní žolíci výzvy.
   * Volá se jen tomuto žolíkovi (Golem: přidá do balíčku 2 kamenné karty).
   */
  onAcquire?(ctx: JokerCtx): void;
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

/**
 * Celoživotní počítadla profilu — součty ze všech započítaných runů (hlavní hra, oficiální denní run, výzvy;
 * ne seedované runy). Vyhodnocuje meta (`src/engine/meta`), DESIGN 11.3 a 11.5.
 */
export type UnlockTotalStat =
  | 'handsPlayed'
  | 'cardsPlayed'
  | 'discards'
  | 'cardsDiscarded'
  | 'moneyEarned'
  | 'moneySpent'
  | 'jokersBought'
  | 'jokersSold'
  | 'vouchersBought'
  | 'consumablesUsed'
  | 'pranostikyUsed'
  | 'radyUsed'
  | 'razitkaUsed'
  | 'rerolls'
  | 'blindsSkipped'
  | 'roundsWon'
  | 'bossesDefeated'
  | 'glassBroken'
  | 'boostersOpened'
  | 'cardsAdded'
  | 'cardsDestroyed'
  /** Kola vyhraná hned první rukou. */
  | 'firstHandRoundWins'
  | 'shopsEntered';

/** Rekordy profilu — maximum dosažené v jednom okamžiku některého započítaného runu. */
export type UnlockRecordStat =
  | 'maxMoney'
  | 'maxJokers'
  /** Karty s pečetí v balíčku najednou. */
  | 'maxSealedCards'
  | 'maxVouchers'
  /** Nejvyšší úroveň libovolné kombinace. */
  | 'maxHandLevel'
  | 'highestAnte'
  | 'bestHandScore'
  | 'bestRoundScore';

export type UnlockStat = UnlockTotalStat | UnlockRecordStat;

/** Kategorie, ve kterých meta sleduje objevené položky a které umí podmínka `discover`. */
export type UnlockDiscoverCategory = 'jokers' | 'consumables' | 'vouchers' | 'tags' | 'bosses' | 'boosters';

/**
 * Podmínka odemčení (vyhodnocuje `evaluateUnlock` v `src/engine/meta/unlocks.ts` jen ze stavu profilu, takže jde
 * ukázat i průběh ve sbírce). Výhry počítají hlavní hru a oficiální denní run (ne výzvy ani seedované runy).
 */
export type UnlockCondition =
  /** Vyhraj run (volitelně s balíčkem a na síle piva aspoň `stake`). */
  | { type: 'winRun'; deck?: string; stake?: number }
  /** Dosáhni patra (rekord profilu, i v nekonečném režimu). */
  | { type: 'reachAnte'; ante: number }
  /** Zahraj kombinaci celkem `count`× (výchozí 1). */
  | { type: 'playHand'; hand: HandType; count?: number }
  | { type: 'scoreInHand'; atLeast: number }
  /** Měj najednou aspoň tolik Kč. */
  | { type: 'haveMoney'; atLeast: number }
  | { type: 'winsTotal'; count: number }
  | { type: 'runsTotal'; count: number }
  | { type: 'discover'; category: UnlockDiscoverCategory; count: number }
  /** Celoživotní počítadlo nebo rekord profilu ≥ `atLeast`. */
  | { type: 'stat'; stat: UnlockStat; atLeast: number }
  /** Dokonči kolo s nejvýš `atMost` Kč (Sekera: 0; Dlužník: −1 = v mínusu). */
  | { type: 'roundEndMoney'; atMost: number }
  /** Zvyš kombinaci (libovolnou, nebo `hand`) aspoň na úroveň `level`. */
  | { type: 'handLevel'; level: number; hand?: HandType }
  /** Poraz šéfa (`boss`, nebo libovolného) celkem `count`× (výchozí 1). */
  | { type: 'beatBoss'; boss?: string; count?: number }
  /** Použij spotřebku (druhu `kind`, konkrétní `id`, nebo libovolnou) celkem `count`× (výchozí 1). */
  | { type: 'useConsumable'; kind?: ConsumableKind; id?: string; count?: number }
  /** Dokonči výzvu (`challenge`, nebo libovolnou různou) — `count` různých výzev (výchozí 1). */
  | { type: 'winChallenge'; challenge?: string; count?: number }
  /** Získej achievement. */
  | { type: 'achievement'; id: string }
  /** Vlastní vyhodnocovač z registru `CUSTOM_UNLOCKS` v `src/engine/meta/unlocks.ts`. */
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
  /** Nikdy nedostane nálepku přibitý (např. žolík, který se sám ničí). */
  noEternal?: boolean;
  /** Nikdy nedostane nálepku zapůjčený. */
  noRental?: boolean;
  /** Nikdy nedostane nálepku zvětrávající (např. žolík, který roste s časem). */
  noPerishable?: boolean;
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
  /**
   * Hodnoty do popisku podle pravidel runu, přepíšou `params` (Skleněná: `odds` z `Modifiers.glassBreakOdds`).
   * Čistá funkce; UI ji volá s modifikátory runu, pokud je má.
   */
  describe?(mods: Readonly<Partial<Modifiers>>): Record<string, number | string>;
  onScored?(ctx: CardCtx): HookResult;
  /**
   * Jednou za zahranou ruku, ve které karta skórovala (i když se aktivovala vícekrát), až po sečtení skóre
   * (krok 5): skleněná může prasknout (`destroyCard`), ohmataná si přidá `bonusChips` přes `api.modifyCard`.
   * Z výsledku se použije jen `destroyCard`, `money` a `message` — skóre ruky už je dané.
   */
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
  /**
   * Efekt edice: u hrací karty při každé aktivaci ve skórování (po vylepšení, krok 2), u žolíka v kroku 4 před
   * nebo po jeho vlastním efektu podle `jokerTiming` — i když žolík sám nic nedělá (DESIGN 2.6).
   */
  effect?(): EffectResult;
  /** Kdy se efekt edice žolíka aplikuje vůči jeho vlastnímu efektu (výchozí `before`). */
  jokerTiming?: 'before' | 'after';
  /** Sloty žolíků/spotřebek navíc (negativní). */
  extraSlots?: number;
  /** Příplatek k ceně v obchodě (a k základní ceně pro prodej). */
  priceAdd: number;
  /** Šance v procentech u žolíka v obchodě a obálce (2,5 = 2,5 %). */
  weight: number;
  /** Šance v procentech u hrací karty v obchodě a obálce; 0 = na hracích kartách se neobjevuje. */
  weightCard: number;
  /**
   * Losuje se samostatným hodem před ostatními edicemi, jen u žolíků, a nenásobí ji `editionRateMult`
   * (negativní, DESIGN 2.6).
   */
  separateRoll?: boolean;
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
  /**
   * Relativní váha při losování spotřebky daného typu (obchod, obálka, náhodné vytvoření); výchozí 1.
   * Výjimka z vyhlášky má 0,25 (DESIGN 2.9).
   */
  weight?: number;
}

// ─────────────────────────── Šéfové ───────────────────────────

export type BossCtx = BaseCtx & { readonly round: Readonly<RoundState> };

export interface BossHooks {
  passive?(ctx: BossCtx): ModifierDelta;
  onRoundStart?(ctx: BossCtx): void;
  /**
   * Je karta debuffnutá? Smí číst `round.flags` (dočasné debuffy, Černá kočka) — engine přepočítá debuffy celého
   * balíčku po líznutí, po `onRoundStart`, `afterHandPlayed`, `onDiscard` a `onDraw` tohoto šéfa.
   */
  isCardDebuffed?(ctx: BossCtx, card: Card): boolean;
  /**
   * Má být žolík na pozici `index` podle pravidla mimo provoz (Jednooký hejtman: pravá polovina řady, Výpadek proudu:
   * do konce první ruky)? Čistá funkce stavu — engine ji přepočítá na začátku kola (po `onRoundStart`), po zahrání
   * ruky, po zahození a po každé akci během kola (přeřazení, prodej, nový žolík), takže platí i po přeřazení.
   * Rozdíl promítá přes `setJokerDebuffed` a vypnuté žolíky eviduje v `RoundState.ruleJokerDebuffs`.
   */
  isJokerDebuffed?(ctx: BossCtx, joker: JokerInstance, index: number): boolean;
  /** Má se karta líznout lícem dolů? */
  isDrawnFaceDown?(ctx: BossCtx, card: Card, info: { drawIndex: number; handsPlayed: number }): boolean;
  /** Vrátí i18n klíč důvodu, proč ruka neskóruje, nebo null. Ruka se tím spotřebuje. */
  validateHand?(ctx: BossCtx & ScoringInfo): string | null;
  /** Úprava základu kombinace před skórováním (např. poloviční čipy i mult). */
  modifyBase?(
    ctx: BossCtx & ScoringInfo,
    base: { chips: number; mult: number },
  ): { chips: number; mult: number };
  /**
   * Úprava výsledného skóre ruky po `floor(čipy × mult)` (Pan starosta: ruka se nezapočítá, když není lepší
   * než předchozí). Vrací nové skóre (ořízne se na konečné číslo ≥ 0). Volá se před `afterHandScored`.
   */
  adjustHandScore?(ctx: BossCtx & ScoringInfo, score: number): number;
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
  /** Čísla do textů šéfa (`bosses.<id>.rule` s `{param}`) — text i pravidlo musí používat stejná čísla. */
  params?: Record<string, number | string>;
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
  /** Výběr útraty — `round` už existuje, cíl ještě ne (počítá se hned po hooku z modifikátorů, vč. `passive`). */
  onBlindSelect?(ctx: TagCtx): boolean;
  /** Začátek kola — cíl, ruce a zahození jsou spočítané, ruka se dobere až po hooku (`addRoundHandSize` platí hned). */
  onRoundStart?(ctx: TagCtx): boolean;
  /**
   * Vyhrané kolo (i zachráněné) — **až po** sestavení rozpisu odměn (`roundEndMoney`), takže štítek, který vyplácí
   * v rozpisu, se smí spotřebovat tady. `ctx.state.round` je ještě k dispozici.
   */
  onRoundEnd?(ctx: TagCtx): boolean;
  /**
   * Vstup do Večerky — nabídka je už vygenerovaná (`passive` štítku při generování platí), štítek ji upraví přes
   * `api.addShopJoker`, `setShopJokerEdition`, `addShopVoucher`, `addFreeRerolls`. Před `onShopEnter` žolíků.
   */
  onShopEnter?(ctx: TagCtx): boolean;
  /**
   * Peníze v rozpisu odměn vyhraného kola (DESIGN 2.4.2 krok 5, za balíčkem; zdroj `tag:<id>`). Nespotřebovává —
   * spotřebovat se dá v `onRoundEnd`, který běží po rozpisu (Termínovaný vklad).
   */
  roundEndMoney?(ctx: TagCtx): number;
  /**
   * Kolo právě skončilo prohrou (došly ruce nebo karty). Vrať true, když štítek kolo zachrání: počítá se
   * jako vyhrané, ale **bez odměny za útratu**, a štítek se spotřebuje (Lékařské potvrzení). Štítky se ptají
   * před žolíky (`preventGameOver`).
   */
  onRoundLost?(ctx: TagCtx & { readonly score: number; readonly target: number }): boolean;
  /** Trvalá změna pravidel, dokud štítek trvá (čistá funkce; Šéf má chřipku: `bossTargetMult`). */
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
  /**
   * Smí se kupón teď nabídnout a koupit? (Úřední škrt a Amnestie až od patra 2 — v patře 1 by „−1 patro“ nic
   * neudělalo a zbyl by jen postih.) Čistá funkce (běží v `GameCore.readOnly`); výchozí ano. Kontroluje se při
   * losování kupónu patra i při koupi (`cannotUse`); startovní kupóny výzvy ji obcházejí.
   */
  available?(ctx: BaseCtx): boolean;
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
  /** Po porážce šéfa (po žolících `onBossDefeated`; Kalendářový: vytvoří pranostiku). */
  onBossDefeated?(ctx: BaseCtx & { readonly bossId: string }): void;
  startingMoney?: number;
  /**
   * Kupóny uplatněné zdarma na startu runu (Úřednický) — stejně jako `ChallengeDef.startingVouchers`: před
   * `onRunStart` balíčku, bez kontroly `VoucherDef.available`; kupón už uplatněný se přeskočí.
   */
  startingVouchers?: string[];
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
  /** Šance (0–1), že žolík v obchodě a obálce dostane nálepku (kumuluje se maximem přes úrovně). */
  stickerChance?: Partial<Record<StickerId, number>>;
  /** Čísla pro popisek (`stakes.<id>.desc`, `{param}`), stejně jako u balíčků a dalšího obsahu. */
  params?: Record<string, number | string>;
  /**
   * Velká útrata má navíc pravidlo náhodného běžného šéfa (Imperial): jiného než šéf patra, `minAnte ≤ patro`,
   * a jen šéfa, který má nějaké pravidlo (hook) — ne ty, co jen zvyšují cíl. Cíl 1,5× a odměna 4 Kč zůstávají.
   */
  bigBlindBoss?: boolean;
  art: ArtSpec;
}

/** Kontext pravidla výzvy během kola (stejný tvar jako u šéfa; RNG stream `misc`). */
export type ChallengeRoundCtx = BaseCtx & { readonly round: Readonly<RoundState> };

/**
 * Výzva (DESIGN 11.1): předpřipravený run se zvláštními pravidly. Číselná a přepínací pravidla jdou přes
 * `extraModifiers` (zkopírují se do `RunState.extraModifiers`, např. `noJokers`, `noSkip`, `flatShopPrice`,
 * `finalAnte`); pravidla s jinými daty (kombinace, nálepky, druhy obsahu) čte engine živě z definice podle
 * `RunState.challengeId` (`GameCore.challenge()`).
 */
export interface ChallengeDef {
  id: string;
  deckId: string;
  /** Síla piva výzvy (výchozí 1 = Desítka). `NewRunOptions.stake` se u výzvy ignoruje. */
  stake?: number;
  extraModifiers?: ModifierDelta;
  startingMoney?: number;
  /** Startovní žolíci — nejsou „získaní“ (`onAcquire` se nevolá) a nálepky mají přesně podle zadání. */
  startingJokers?: { defId: string; edition?: EditionId | null; stickers?: StickerId[] }[];
  /**
   * Náhodní startovní žolíci (Velký třesk: 2 legendární přibití) — stream `joker`, z celého registru bez ohledu
   * na odemčení (`unlockedPool`), bez zakázaných, bez opakování a bez žolíků, kteří zadanou nálepku nesmí mít.
   * Jako u `startingJokers` se `onAcquire` nevolá.
   */
  startingRandomJokers?: {
    rarity: JokerRarity;
    count: number;
    edition?: EditionId | null;
    stickers?: StickerId[];
  }[];
  startingConsumables?: string[];
  startingVouchers?: string[];
  /** Startovní úrovně kombinací (Švejkova anabáze: Vysoká karta a Dvojice na úrovni 6). */
  startingHandLevels?: Partial<Record<HandType, number>>;
  bannedJokers?: string[];
  bannedVouchers?: string[];
  /** Spotřebky, které se v runu neobjevují (Večerka, obálky, efekty). */
  bannedConsumables?: string[];
  /** Druhy spotřebek, které se v runu neobjevují — Večerka, obálky ani efekty (Kamenolom: babské rady). */
  bannedConsumableKinds?: ConsumableKind[];
  /** Druhy obálek, které se ve Večerce neprodávají a štítky je neotevřou (Mariáš u Vaňků: hrací karty). */
  bannedBoosterKinds?: BoosterKind[];
  /** Štítky, které se za přeskočení útrat nenabízejí (pravidla výzvy by je udělala bezcennými). */
  bannedTags?: string[];
  /**
   * Nálepka všech žolíků, které hráč v runu získá — Večerka, obálky i efekty (Půjčovna kostýmů: zapůjčený,
   * Svatba na doživotí: přibitý). Žolíci, kteří ji nesmí mít (`noRental`, `noEternal`…), se v runu neobjevují.
   */
  jokerSticker?: StickerId;
  /**
   * Nejsilnější kombinace, která skóruje (Švejkova anabáze: Dvojice). Silnější ruka se spotřebuje a dá 0 bodů
   * (`ScoreResult.blockedReason` = `MSG.challengeHandTooStrong`), stejně jako ruka zakázaná šéfem.
   */
  maxScoringHand?: HandType;
  /** Pevná základní cena spotřebek podle druhu (Krátká paměť: pranostiky 1 Kč); prodej = polovina jako jinak. */
  consumableCost?: Partial<Record<ConsumableKind, number>>;
  customDeck?: CardSpec[];
  /** Další pravidla (i18n klíče pod `challenges.<id>.rules`). */
  ruleKeys?: string[];
  /** Čísla do textů výzvy (`desc`, `flavor` i `rules.<klíč>` s `{param}`) — texty a pravidla mají stejná čísla. */
  params?: Record<string, number | string>;
  onRunStart?(ctx: BaseCtx): void;
  /** Trvalá změna pravidel podle stavu runu (čistá funkce, jako `StakeDef.passive`). */
  passive?(ctx: BaseCtx): ModifierDelta;
  /**
   * Začátek každého patra — na startu runu (patro 1, po `onRunStart`) a po každé porážce šéfa (před losováním
   * útrat nového patra). Ne při posunu patra efektem (`changeAnte`). Krátká paměť: úrovně kombinací zpět na 1.
   */
  onAnteStart?(ctx: BaseCtx & { readonly ante: number }): void;
  /**
   * Je karta podle pravidla výzvy debuffnutá? Platí ve všech útratách (ne jen u šéfa) a nezávisle na šéfovi
   * (vypnutí šéfa ho neruší); karty vrácené do provozu (`cleanseCard`) ne. Čtyři roční období.
   */
  isCardDebuffed?(ctx: ChallengeRoundCtx, card: Card): boolean;
  /**
   * Má být žolík na pozici `index` podle pravidla výzvy mimo provoz? Přepočítává se stejně jako
   * `BossHooks.isJokerDebuffed` (sdílí `RoundState.ruleJokerDebuffs`). Večer při svíčkách.
   */
  isJokerDebuffed?(ctx: ChallengeRoundCtx, joker: JokerInstance, index: number): boolean;
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
  /**
   * Achievementy (DESIGN 11.2) — čte je jen meta (`src/engine/meta`), run je nepoužívá. Volitelné, aby testovací
   * registry enginu nemusely nic doplňovat (chybí = žádné achievementy).
   */
  achievements?: Record<string, AchievementDef>;
}

export interface NewRunOptions {
  seed?: string;
  deckId: string;
  /** Síla piva 1–8; u výzvy se ignoruje (platí `ChallengeDef.stake`, výchozí 1). */
  stake: number;
  challengeId?: string | null;
  daily?: boolean;
  unlockedPool?: RunState['unlockedPool'];
}
