/**
 * GameCore — vnitřní jádro enginu: drží stav, registr obsahu, event bus, RNG streamy,
 * skládá modifikátory a volá hooky obsahu. Používají ho skórování, API pro obsah i run loop.
 * UI s ním nikdy nepracuje přímo (jen přes `Game`).
 */
import type {
  BaseCtx,
  BossCtx,
  BossDef,
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

export type JokerHookName = Exclude<keyof JokerHooks, 'passive' | 'copyTarget' | 'preventGameOver'>;

/**
 * Jako Object.assign, ale kopíruje deskriptory (gettery zůstávají živé — např. průběžné čipy/mult).
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

/** Normalizuje výsledek hooku na pole. */
export function toResults(r: HookResult): EffectResult[] {
  if (!r || typeof r !== 'object') return [];
  return Array.isArray(r) ? r : [r];
}

export class GameCore {
  readonly bus = new EventBus<GameEvent>();
  readonly api: EngineApi;
  private collected: GameEvent[] = [];
  private modsCache: Modifiers | null = null;
  private computingMods = false;

  constructor(
    public state: RunState,
    public readonly registry: ContentRegistry,
  ) {
    this.api = createApi(this);
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
    return rngFromState(this.state.rng[stream]);
  }

  uid(): number {
    return this.state.nextUid++;
  }

  // ── modifikátory ──

  invalidate(): void {
    this.modsCache = null;
  }

  mods(): Modifiers {
    if (this.computingMods) return { ...BASE_MODIFIERS };
    if (this.modsCache) return this.modsCache;
    this.computingMods = true;
    try {
      this.modsCache = combineModifiers(this.collectDeltas());
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
    for (const v of s.vouchers) {
      const vd = r.vouchers[v];
      if (vd?.passive) deltas.push(vd.passive(ctx));
    }
    for (const tag of s.tags) {
      const td = r.tags[tag.defId];
      if (td?.hooks.passive) deltas.push(td.hooks.passive({ ...ctx, self: tag }));
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
    return deltas;
  }

  // ── kontexty ──

  chance(numerator: number, denominator: number, rng: Rng): boolean {
    if (denominator <= 0) return true;
    const p = (numerator * this.mods().probabilityMult) / denominator;
    if (p >= 1) return true;
    return rng.next() < p;
  }

  baseCtx(stream: RngStreamName): BaseCtx {
    const rng = this.rng(stream);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const core = this;
    return {
      get state() {
        return core.state;
      },
      api: this.api,
      rng,
      get mods() {
        return core.mods();
      },
      chance: (n: number, d: number) => core.chance(n, d, rng),
    };
  }

  jokerCtx(joker: JokerInstance, index: number, isCopy: boolean, def?: JokerDef): JokerCtx {
    const d = def ?? this.jokerDef(joker);
    return Object.assign(this.baseCtx('joker'), { self: joker, def: d, index, isCopy });
  }

  tagCtx(tag: TagInstance): TagCtx {
    return Object.assign(this.baseCtx('tag'), { self: tag });
  }

  bossCtx(): BossCtx {
    const round = this.state.round;
    if (!round) throw new Error('bossCtx: no active round');
    return Object.assign(this.baseCtx('boss'), { round });
  }

  // ── obsah ──

  jokerDef(joker: JokerInstance): JokerDef {
    const def = this.registry.jokers[joker.defId];
    if (!def) throw new Error(`Unknown joker: ${joker.defId}`);
    return def;
  }

  /** Šéf aktuálního kola, pokud je aktivní (kolo běží a šéf není vypnutý). */
  activeBoss(): BossDef | null {
    const round = this.state.round;
    if (!round || !round.bossId || round.bossDisabled) return null;
    return this.registry.bosses[round.bossId] ?? null;
  }

  card(id: number): Card | undefined {
    return this.state.deck.find((c) => c.id === id);
  }

  mustCard(id: number): Card {
    const c = this.card(id);
    if (!c) throw new Error(`Unknown card id ${id}`);
    return c;
  }

  /** Žolík, jehož schopnost `joker` efektivně používá (sleduje řetěz kopírování). */
  resolveCopy(joker: JokerInstance, index: number): { target: JokerInstance; def: JokerDef; isCopy: boolean } | null {
    let current = joker;
    let def = this.jokerDef(current);
    const visited = new Set<number>([current.uid]);
    let isCopy = false;
    while (def.hooks.copyTarget) {
      const targetUid = def.hooks.copyTarget(this.jokerCtx(current, index, isCopy, def));
      const target = targetUid === null ? undefined : this.state.jokers.find((j) => j.uid === targetUid);
      if (!target || visited.has(target.uid) || target.debuffed) return null;
      const tdef = this.jokerDef(target);
      if (tdef.copyable === false) return null;
      visited.add(target.uid);
      current = target;
      def = tdef;
      isCopy = true;
    }
    return { target: current, def, isCopy };
  }

  /**
   * Zavolá hook u všech (nedebuffnutých) žolíků zleva doprava, včetně kopírujících.
   * `extra` se přimíchá do kontextu. `onResult` dostane výsledky přiřazené vlastníkovi slotu.
   */
  eachJoker<K extends JokerHookName>(
    hook: K,
    extra: Record<string, unknown>,
    onResult?: (results: EffectResult[], owner: JokerInstance, index: number, value: unknown) => void,
  ): void {
    const jokers = [...this.state.jokers];
    jokers.forEach((owner, index) => {
      if (owner.debuffed || !this.state.jokers.includes(owner)) return;
      const resolved = this.resolveCopy(owner, index);
      if (!resolved) return;
      const fn = resolved.def.hooks[hook] as ((ctx: unknown) => unknown) | undefined;
      if (!fn) return;
      const ctx = extend(this.jokerCtx(resolved.target, index, resolved.isCopy, resolved.def), extra);
      const value = fn(ctx);
      onResult?.(typeof value === 'number' ? [] : toResults(value as HookResult), owner, index, value);
    });
    this.invalidate();
  }

  /** Součet číselných návratových hodnot hooku (např. retriggerScored, roundEndMoney). */
  sumJokers<K extends JokerHookName>(hook: K, extra: Record<string, unknown>): number {
    let total = 0;
    this.eachJoker(hook, extra, (_r, _o, _i, value) => {
      if (typeof value === 'number' && Number.isFinite(value)) total += value;
    });
    return total;
  }

  /** Zavolá hook štítků; štítky, které vrátí true, se odeberou. */
  eachTag(hook: Exclude<keyof TagHooks, 'passive'>): void {
    for (const tag of [...this.state.tags]) {
      if (!this.state.tags.includes(tag)) continue;
      const def = this.registry.tags[tag.defId];
      const fn = def?.hooks[hook];
      if (!fn) continue;
      const consumed = fn(this.tagCtx(tag));
      if (consumed) {
        this.state.tags = this.state.tags.filter((t) => t !== tag);
        this.emit({ type: 'tagTriggered', uid: tag.uid, defId: tag.defId });
      }
    }
    this.invalidate();
  }
}
