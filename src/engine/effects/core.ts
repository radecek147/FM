/**
 * GameCore — vnitřní jádro enginu: drží stav, registr obsahu, event bus, RNG streamy,
 * skládá modifikátory a volá hooky obsahu. Používají ho skórování, API pro obsah i run loop.
 * UI s ním nikdy nepracuje přímo (jen přes `Game`).
 */
import type {
  BaseCtx,
  BossCtx,
  BossDef,
  CardCtx,
  ChallengeDef,
  ChallengeRoundCtx,
  ContentRegistry,
  EngineApi,
  HookResult,
  EffectResult,
  JokerCtx,
  JokerDef,
  JokerHooks,
  Rng,
  TagCtx,
  TagHooks,
} from '../content-types';
import { EventBus } from '../events';
import { rngFromState } from '../rng/rng';
import type {
  Card,
  GameEvent,
  JokerInstance,
  ModifierDelta,
  Modifiers,
  RngStreamName,
  RunState,
  TagInstance,
} from '../types';
import { BASE_MODIFIERS, combineModifiers } from './modifiers';
import { createApi } from './api';

/** Hooky žolíků, které se volají všem žolíkům zleva doprava (ne `passive`, kopírování, záchrana a získání). */
export type JokerHookName = Exclude<
  keyof JokerHooks,
  'passive' | 'copyTarget' | 'preventGameOver' | 'onAcquire'
>;

const NO_ENHANCEMENTS: Readonly<Record<string, never>> = Object.freeze({});

/**
 * Jako Object.assign, ale kopíruje deskriptory (gettery zůstávají živé — např. průběžné čipy/mult).
 * Pomalé (deskriptory se alokují) — pro data sdílená mnoha kontexty (ScoringInfo ruky) použij vrstvu
 * `GameCore.ctxLayer`, která se vytvoří jednou a kontexty ji dědí přes prototyp.
 */
export function extend<T extends object, A extends object, B extends object = object>(
  target: T,
  a: A,
  b?: B,
): T & A & B {
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(a));
  if (b) Object.defineProperties(target, Object.getOwnPropertyDescriptors(b));
  return target as T & A & B;
}

/**
 * Vrstva kontextu (prototyp): vlastnosti sdílené mnoha kontexty hooků — typicky `ScoringInfo` jedné zahrané ruky,
 * které dostane každý žolík u každé aktivace karty. Kontext ji zdědí místo kopírování (`extend` zabíral ~45 % času
 * skórování). Vytváří ji jen `GameCore.ctxLayer`.
 */
export interface CtxLayer {
  readonly __ctxLayer: true;
}

/** Normalizuje výsledek hooku na pole (prázdné položky pole — `null`, čísla… — z JS obsahu přeskočí). */
export function toResults(r: HookResult): EffectResult[] {
  if (!r || typeof r !== 'object') return [];
  if (!Array.isArray(r)) return [r];
  return r.filter((x): x is EffectResult => !!x && typeof x === 'object');
}

/**
 * Nejvyšší hloubka vnoření téhož hooku žolíků (např. `onCardAdded` → `api.addCard` → `onCardAdded`…). Hlubší
 * volání se přeskočí — chybný obsah tak engine nezacyklí (místo přetečení zásobníku).
 */
export const MAX_NESTED_HOOK_DEPTH = 3;

/**
 * Vnitřní pole kontextu (symboly — nejsou vidět v `Object.keys` ani `for…in`): stream, příznak dotazu bez vedlejších
 * účinků (`readOnly` → RNG nad kopií streamu) a líně vytvořené RNG.
 */
const CTX_STREAM = Symbol('ctxStream');
const CTX_DETACHED = Symbol('ctxDetached');
const CTX_RNG = Symbol('ctxRng');

interface CtxInternals {
  [CTX_STREAM]: RngStreamName;
  [CTX_DETACHED]: boolean;
  [CTX_RNG]: Rng | null;
  rng: Rng;
  chance: BaseCtx['chance'];
}

export class GameCore {
  readonly bus = new EventBus<GameEvent>();
  readonly api: EngineApi;
  private collected: GameEvent[] = [];
  private modsCache: Readonly<Modifiers> | null = null;
  private computingMods = false;
  /** > 0 = běží dotaz bez vedlejších účinků (`readOnly`): RNG streamy se jen kopírují, stav se neposune. */
  private detachedRng = 0;
  /** Aktuální hloubka vnoření jednotlivých hooků žolíků (`eachJoker`). */
  private hookDepth: Partial<Record<JokerHookName, number>> = {};
  /**
   * Společný prototyp všech kontextů hooků: živé `state` a `mods` (gettery) a `api`. Kontext je pak jen
   * `Object.create` + pár vlastních polí (`rng`, `chance`, `self`…), bez kopírování getterů pro každé volání.
   */
  private readonly ctxRoot: object;

  constructor(
    public state: RunState,
    public readonly registry: ContentRegistry,
  ) {
    this.api = createApi(this);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const core = this;
    this.ctxRoot = Object.create(Object.prototype, {
      state: { get: () => core.state, enumerable: true },
      mods: { get: () => core.mods(), enumerable: true },
      // Zapisovatelné: přiřazení `ctx.api = …` (testy) vytvoří vlastní pole kontextu, prototyp se nemění.
      api: { value: this.api, enumerable: true, writable: true },
      // RNG streamu vzniká až při prvním použití (většina hooků náhodu nepotřebuje). Obal mutuje pole stavu na místě,
      // takže pozdější vytvoření dá stejnou posloupnost jako dřívější; v `readOnly` pracuje na kopii streamu.
      rng: {
        get(this: CtxInternals): Rng {
          if (this[CTX_RNG]) return this[CTX_RNG];
          const st = core.state.rng[this[CTX_STREAM]];
          return (this[CTX_RNG] = rngFromState(this[CTX_DETACHED] ? [st[0], st[1], st[2], st[3]] : st));
        },
        set(this: CtxInternals, value: Rng) {
          Object.defineProperty(this, 'rng', { value, writable: true, enumerable: true, configurable: true });
        },
        enumerable: true,
      },
    }) as object;
  }

  // ── události ──

  /** Zařadí událost; na bus se doručí až po úspěšném dokončení akce (`flush`). */
  emit(event: GameEvent): void {
    this.collected.push(event);
  }

  /** Vrátí a zahodí nasbírané události (bez doručení na bus). */
  takeEvents(): GameEvent[] {
    const out = this.collected;
    this.collected = [];
    return out;
  }

  /** Doručí nasbírané události na bus a vrátí je. */
  flush(): GameEvent[] {
    const out = this.takeEvents();
    for (const e of out) this.bus.emit(e);
    return out;
  }

  // ── RNG ──

  rng(stream: RngStreamName): Rng {
    const st = this.state.rng[stream];
    return rngFromState(this.detachedRng > 0 ? [st[0], st[1], st[2], st[3]] : st);
  }

  /**
   * Spustí dotaz bez vedlejších účinků na náhodu: RNG v kontextech vytvořených uvnitř pracuje na kopii streamu,
   * takže stav runu se neposune. Pro `passive` (skládání modifikátorů), náhled ruky a `canUse` — jinak by výsledek
   * runu závisel na tom, jak často se UI ptá (náhled, modifikátory) nebo kdy se zneplatní cache.
   */
  readOnly<T>(fn: () => T): T {
    this.detachedRng++;
    try {
      return fn();
    } finally {
      this.detachedRng--;
    }
  }

  uid(): number {
    return this.state.nextUid++;
  }

  // ── modifikátory ──

  invalidate(): void {
    this.modsCache = null;
  }

  /**
   * Výsledné modifikátory (cache do `invalidate`). Objekt je **zmrazený** — volající (obsah, UI) ho nesmí měnit;
   * změna pravidel jde jen přes deltu (`passive`, `api.addPermanentModifier`…). `passive` volající `mods()` dostane
   * výchozí hodnoty (ochrana proti rekurzi).
   */
  mods(): Readonly<Modifiers> {
    if (this.computingMods) return BASE_MODIFIERS;
    if (this.modsCache) return this.modsCache;
    this.computingMods = true;
    try {
      this.modsCache = Object.freeze(combineModifiers(this.readOnly(() => this.collectDeltas())));
    } finally {
      this.computingMods = false;
    }
    return this.modsCache;
  }

  private collectDeltas(): ModifierDelta[] {
    const s = this.state;
    const r = this.registry;
    const deltas: ModifierDelta[] = [];
    const ctx = this.baseCtx('misc');
    const stakes = Object.values(r.stakes)
      .filter((st) => st.level <= s.stake)
      .sort((a, b) => a.level - b.level);
    for (const st of stakes) deltas.push(st.passive?.(ctx) ?? {});
    const deck = r.decks[s.deckId];
    if (deck?.passive) deltas.push(deck.passive(ctx));
    deltas.push(s.extraModifiers);
    const challenge = this.challenge();
    if (challenge?.passive) deltas.push(challenge.passive(ctx));
    for (const v of s.vouchers) {
      const vd = r.vouchers[v];
      if (vd?.passive) deltas.push(vd.passive(ctx));
    }
    for (const tag of s.tags) {
      const td = r.tags[tag.defId];
      if (td?.hooks.passive) deltas.push(td.hooks.passive(this.tagCtx(tag)));
    }
    s.jokers.forEach((j, index) => {
      // Negativní (a jiné slotové) edice platí i u debuffnutého žolíka.
      const ed = j.edition ? r.editions[j.edition] : undefined;
      if (ed?.extraSlots) deltas.push({ jokerSlots: ed.extraSlots });
      if (j.debuffed) return;
      const def = r.jokers[j.defId];
      if (def?.hooks.passive) deltas.push(def.hooks.passive(this.jokerCtx(j, index, false)));
    });
    for (const c of s.consumables) {
      const ed = c.edition ? r.editions[c.edition] : undefined;
      if (ed?.extraSlots) deltas.push({ consumableSlots: ed.extraSlots });
    }
    const boss = this.activeBoss();
    if (boss?.hooks.passive) deltas.push(boss.hooks.passive(this.bossCtx()));
    // Dočasná velikost ruky do konce kola (EngineApi.addRoundHandSize).
    const roundHandSize = s.round?.handSizeDelta ?? 0;
    if (roundHandSize) deltas.push({ handSize: roundHandSize });
    return deltas;
  }

  /**
   * Vylepšení, která právě platí: při `Modifiers.disableEnhancements` (Bílá hora) prázdný registr — karty
   * se pak chovají, jako by vylepšení neměly (detekce, čipy, barvy, efekty).
   */
  enhancements(): ContentRegistry['enhancements'] {
    return this.mods().disableEnhancements ? NO_ENHANCEMENTS : this.registry.enhancements;
  }

  // ── kontexty ──

  chance(numerator: number, denominator: number, rng: Rng): boolean {
    if (denominator <= 0) return true;
    const p = (numerator * this.mods().probabilityMult) / denominator;
    if (p >= 1) return true;
    return rng.next() < p;
  }

  /**
   * Vrstva kontextu ze sdílených vlastností (gettery zůstávají živé). Vytvoří se jednou (např. `ScoringInfo` ruky)
   * a kontexty vytvořené s ní (`baseCtx`, `jokerCtx`, `bossCtx`, `eachJoker`) ji dědí přes prototyp.
   */
  ctxLayer<T extends object>(props: T): CtxLayer & T {
    return Object.create(this.ctxRoot, Object.getOwnPropertyDescriptors(props)) as CtxLayer & T;
  }

  /**
   * Základní kontext hooku: `state`, `mods` a `api` (z prototypu), vlastní `rng` streamu a `chance`.
   * `layer` = sdílená vrstva (ScoringInfo), kterou kontext zdědí.
   */
  baseCtx(stream: RngStreamName, layer?: CtxLayer): BaseCtx {
    const ctx = Object.create(layer ?? this.ctxRoot) as CtxInternals;
    ctx[CTX_STREAM] = stream;
    // Kontext vytvořený v dotazu bez vedlejších účinků (`readOnly`) dostane RNG nad kopií streamu.
    ctx[CTX_DETACHED] = this.detachedRng > 0;
    ctx[CTX_RNG] = null;
    ctx.chance = (n: number, d: number) => this.chance(n, d, ctx.rng);
    return ctx as unknown as BaseCtx;
  }

  /**
   * Kontext hooku žolíka. Při `isCopy` (kopírující žolík volá hook cíle) dostane hook **kopii** instance cíle:
   * čte její stav, ale změny `self.state`/`sellBonus` se zahodí — počítadla cíle se tak nenavýší dvakrát, ani když
   * hook `isCopy` nekontroluje (ARCHITECTURE 2.7).
   */
  jokerCtx(joker: JokerInstance, index: number, isCopy: boolean, def?: JokerDef, layer?: CtxLayer): JokerCtx {
    const d = def ?? this.jokerDef(joker);
    const self = isCopy ? (JSON.parse(JSON.stringify(joker)) as JokerInstance) : joker;
    const ctx = this.baseCtx('joker', layer) as BaseCtx & {
      self: JokerInstance;
      def: JokerDef;
      index: number;
      isCopy: boolean;
    };
    ctx.self = self;
    ctx.def = d;
    ctx.index = index;
    ctx.isCopy = isCopy;
    return ctx;
  }

  tagCtx(tag: TagInstance): TagCtx {
    return Object.assign(this.baseCtx('tag'), { self: tag });
  }

  /** Kontext pravidla výzvy během kola (`ChallengeDef.isCardDebuffed`, `isJokerDebuffed`; stream `misc`). */
  challengeCtx(): ChallengeRoundCtx {
    const round = this.state.round;
    if (!round) throw new Error('challengeCtx: no active round');
    return Object.assign(this.baseCtx('misc'), { round });
  }

  bossCtx(layer?: CtxLayer): BossCtx {
    const round = this.state.round;
    if (!round) throw new Error('bossCtx: no active round');
    return Object.assign(this.baseCtx('boss', layer), { round });
  }

  /** Kontext efektu hrací karty (vylepšení, pečeť) — `layer` nese ScoringInfo ruky. */
  cardCtx(card: Card, layer: CtxLayer): CardCtx {
    return Object.assign(this.baseCtx('card', layer), { card }) as unknown as CardCtx;
  }

  // ── obsah ──

  jokerDef(joker: JokerInstance): JokerDef {
    const def = this.registry.jokers[joker.defId];
    if (!def) throw new Error(`Unknown joker: ${joker.defId}`);
    return def;
  }

  /** Definice výzvy runu; null = běžný run (nebo výzva, kterou registr nezná — obsah odebraný od uložení). */
  challenge(): ChallengeDef | null {
    const id = this.state.challengeId;
    return id ? (this.registry.challenges[id] ?? null) : null;
  }

  /** Šéf aktuálního kola, pokud je aktivní (kolo běží a šéf není vypnutý). */
  activeBoss(): BossDef | null {
    const round = this.state.round;
    if (!round || !round.bossId || round.bossDisabled) return null;
    return this.registry.bosses[round.bossId] ?? null;
  }

  /** Zvětralý žolík (zvětrávající s vypršelými koly) — trvale debuffnutý. */
  isPerished(joker: JokerInstance): boolean {
    return (
      joker.stickers.includes('perishable') && joker.perishRounds !== undefined && joker.perishRounds <= 0
    );
  }

  /** Zruší dočasné debuffy žolíků z tohoto kola (konec kola, vypnutí šéfa). */
  clearJokerDebuffs(): void {
    const round = this.state.round;
    // Žolíci vypnutí pravidlem šéfa (`isJokerDebuffed`) jsou podmnožinou `jokerDebuffs` — ruší se s nimi.
    if (round?.ruleJokerDebuffs?.length) round.ruleJokerDebuffs = [];
    if (!round || round.jokerDebuffs.length === 0) return;
    for (const uid of round.jokerDebuffs) {
      const j = this.state.jokers.find((x) => x.uid === uid);
      if (!j) continue;
      j.debuffed = this.isPerished(j);
      if (!j.debuffed) this.emit({ type: 'jokerDebuffChanged', uid, debuffed: false });
    }
    round.jokerDebuffs = [];
    this.invalidate();
  }

  card(id: number): Card | undefined {
    return this.state.deck.find((c) => c.id === id);
  }

  mustCard(id: number): Card {
    const c = this.card(id);
    if (!c) throw new Error(`Unknown card id ${id}`);
    return c;
  }

  /**
   * Žolík, jehož schopnost `joker` (na pozici `index`) efektivně používá — sleduje řetěz kopírování. Každý článek
   * řetězu dostane do `copyTarget` **svou** pozici (kopírující „vpravo od sebe“ tak funguje i v řetězu); cyklus,
   * debuffnutý nebo nekopírovatelný cíl = null. Žolík s id, které registr nezná (obsah odebraný od uložení), nic
   * nedělá (null) — stejně jako neznámý šéf, štítek nebo vylepšení.
   */
  resolveCopy(
    joker: JokerInstance,
    index: number,
  ): { target: JokerInstance; def: JokerDef; isCopy: boolean } | null {
    let current = joker;
    const first = this.registry.jokers[current.defId];
    if (!first) return null;
    // Běžný žolík (bez kopírování) — bez alokací, volá se pro každého žolíka u každého hooku.
    if (!first.hooks.copyTarget) return { target: joker, def: first, isCopy: false };
    let def: JokerDef = first;
    const visited = new Set<number>([current.uid]);
    let isCopy = false;
    while (def.hooks.copyTarget) {
      const pos = current === joker ? index : this.state.jokers.indexOf(current);
      const targetUid = def.hooks.copyTarget(this.jokerCtx(current, pos, isCopy, def));
      const target = targetUid === null ? undefined : this.state.jokers.find((j) => j.uid === targetUid);
      if (!target || visited.has(target.uid) || target.debuffed) return null;
      const tdef = this.registry.jokers[target.defId];
      if (!tdef || tdef.copyable === false) return null;
      visited.add(target.uid);
      current = target;
      def = tdef;
      isCopy = true;
    }
    return { target: current, def, isCopy };
  }

  /**
   * Zavolá hook u všech (nedebuffnutých) žolíků zleva doprava, včetně kopírujících.
   * `extra` se přimíchá do kontextu — buď stejné pro všechny, nebo funkce vlastníka slotu (např. `isSelf` u `onSell`).
   * `onResult` dostane výsledky přiřazené vlastníkovi slotu.
   *
   * Po každém hooku se zneplatní cache modifikátorů (hook mohl změnit stav, na kterém závisí `passive` — další
   * žolíci i engine pak čtou aktuální hodnoty). Vnoření téhož hooku je omezené `MAX_NESTED_HOOK_DEPTH`.
   * `layer` = sdílená vrstva kontextu (ScoringInfo ruky), kterou kontexty zdědí místo kopírování; `extra` se do
   * kontextu kopíruje hodnotami (prostá data).
   */
  eachJoker<K extends JokerHookName>(
    hook: K,
    extra: Record<string, unknown> | ((owner: JokerInstance) => Record<string, unknown>),
    onResult?: (results: EffectResult[], owner: JokerInstance, index: number, value: unknown) => void,
    layer?: CtxLayer,
  ): void {
    const depth = this.hookDepth[hook] ?? 0;
    if (depth >= MAX_NESTED_HOOK_DEPTH) return;
    this.hookDepth[hook] = depth + 1;
    try {
      const jokers = [...this.state.jokers];
      jokers.forEach((owner) => {
        // Aktuální pozice (ne pozice ve snímku): žolík zničený dřív v průchodu posune ostatní doleva.
        const index = this.state.jokers.indexOf(owner);
        if (owner.debuffed || index < 0) return;
        const resolved = this.resolveCopy(owner, index);
        if (!resolved) return;
        const fn = resolved.def.hooks[hook] as ((ctx: unknown) => unknown) | undefined;
        if (!fn) return;
        const more = typeof extra === 'function' ? extra(owner) : extra;
        // `extra` jsou prostá data (kopírují se hodnoty); živé gettery patří do `layer`.
        const ctx = Object.assign(
          this.jokerCtx(resolved.target, index, resolved.isCopy, resolved.def, layer),
          more,
        );
        const value = fn(ctx);
        this.invalidate();
        onResult?.(typeof value === 'number' ? [] : toResults(value as HookResult), owner, index, value);
      });
    } finally {
      this.hookDepth[hook] = depth;
    }
    this.invalidate();
  }

  /** Součet číselných návratových hodnot hooku (např. retriggerScored, roundEndMoney). */
  sumJokers<K extends JokerHookName>(hook: K, extra: Record<string, unknown>, layer?: CtxLayer): number {
    let total = 0;
    this.eachJoker(
      hook,
      extra,
      (_r, _o, _i, value) => {
        if (typeof value === 'number' && Number.isFinite(value)) total += value;
      },
      layer,
    );
    return total;
  }

  /** Zavolá hook štítků; štítky, které vrátí true, se odeberou. (`onRoundLost` volá run loop zvlášť.) */
  eachTag(hook: Exclude<keyof TagHooks, 'passive' | 'onRoundLost'>): void {
    for (const tag of [...this.state.tags]) {
      if (!this.state.tags.includes(tag)) continue;
      const def = this.registry.tags[tag.defId];
      const fn = def?.hooks[hook];
      if (!fn) continue;
      const consumed = fn(this.tagCtx(tag));
      this.invalidate();
      if (consumed) {
        this.state.tags = this.state.tags.filter((t) => t !== tag);
        this.emit({ type: 'tagTriggered', uid: tag.uid, defId: tag.defId });
      }
    }
    this.invalidate();
  }
}
