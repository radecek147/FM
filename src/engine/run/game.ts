/**
 * Game — stavový automat jednoho runu. Jediný vstupní bod pro UI a simulaci:
 * `dispatch(action)` → změna stavu + události. Neplatná akce stav nemění.
 */
import type { BaseCtx, ConsumableCtx, ContentRegistry, NewRunOptions } from '../content-types';
import { compareCards } from '../cards/cards';
import { BLIND_REWARDS, BOSS_REROLL_COST, FINAL_ANTE, MSG, RENTAL_FEE } from '../constants';
import {
  addConsumableInstance,
  addJokerInstance,
  consumableHasRoom,
  jokerHasRoom,
  newConsumableInstance,
  newJokerInstance,
  pendingBoosterIds,
} from '../effects/api';
import { GameCore, extend } from '../effects/core';
import { createRngStates } from '../rng/rng';
import type { EventBus } from '../events';
import { afterScoredCards, previewHand, safe, scoreHand } from '../scoring/score';
import { pickStartingJokers } from '../shop/pool';
import { consumableSellValue, jokerSellValue, refreshShopPrices } from '../shop/prices';
import {
  generateShop,
  generateShopItems,
  openBooster,
  rollAnteVouchers,
  shopJokerIds,
  syncShopSlots,
  voucherAvailable,
} from '../shop/shop';
import type {
  Action,
  ActionErrorCode,
  ActionResult,
  BlindKind,
  BlindSlot,
  Card,
  ConsumableInstance,
  GameEvent,
  HandPreview,
  HandSortMode,
  Modifiers,
  RoundRewards,
  RoundState,
  RunState,
} from '../types';
import { BLIND_KINDS } from '../types';
import { pickBigBlindBossId, pickBossId, rerollBossSlot, stakeBigBlindBoss } from './bosses';
import { drawCards, fillHand, refreshBossDebuffs, refreshBossJokerDebuffs, refreshDebuffs } from './draw';
import { createRunState } from './init';
import { blindTarget } from './targets';

/** Re-export pro starší importy — konstanty žijí v engine/constants.ts. */
export { BLIND_REWARDS, FINAL_ANTE };

/** Částka z obsahu do rozpisu odměn: jen konečné číslo (NaN/nekonečno = 0 — rozpis je součástí uloženého stavu). */
function rewardAmount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

class ActionError extends Error {
  constructor(public readonly code: ActionErrorCode) {
    super(code);
  }
}

function fail(code: ActionErrorCode): never {
  throw new ActionError(code);
}

/** Hluboká kopie JSON-serializovatelné instance (žolík, spotřebka) — žádné sdílené objekty ve stavu runu. */
function detached<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export class Game {
  private readonly core: GameCore;

  private constructor(core: GameCore) {
    this.core = core;
  }

  // ─────────────────────────── Vytvoření ───────────────────────────

  static newRun(opts: NewRunOptions, registry: ContentRegistry): Game {
    // Seed generuje volající (UI/simulace) — engine nesmí používat Math.random.
    const seed = (opts.seed ?? '').trim().toUpperCase();
    if (!seed) throw new Error('Game.newRun: seed is required');
    const state = createRunState({ ...opts, seed }, registry);
    const game = new Game(new GameCore(state, registry));
    game.initRun(opts);
    game.core.takeEvents();
    return game;
  }

  /** Obnoví hru z uloženého (a zmigrovaného) stavu. */
  static fromState(state: RunState, registry: ContentRegistry): Game {
    return new Game(new GameCore(state, registry));
  }

  private initRun(opts: NewRunOptions): void {
    const core = this.core;
    const s = core.state;
    const reg = core.registry;
    const ctx = core.baseCtx('misc');
    for (const st of Object.values(reg.stakes).sort((a, b) => a.level - b.level)) {
      if (st.level <= s.stake) st.onRunStart?.(ctx);
    }
    const deck = reg.decks[s.deckId];
    for (const v of deck?.startingVouchers ?? []) this.redeemVoucher(v);
    deck?.onRunStart?.(ctx);
    const ch = opts.challengeId ? reg.challenges[opts.challengeId] : undefined;
    if (ch) {
      // Startovní žolíci výzvy nejsou „získaní“ — `onAcquire` se nevolá (např. Golem v Kamenolomu).
      for (const j of ch.startingJokers ?? []) {
        const joker = newJokerInstance(core, j.defId, j.edition ?? null, j.stickers ?? []);
        addJokerInstance(core, joker, { ignoreSlots: true });
      }
      for (const spec of ch.startingRandomJokers ?? []) {
        for (const defId of pickStartingJokers(core, spec)) {
          const joker = newJokerInstance(core, defId, spec.edition ?? null, spec.stickers ?? []);
          addJokerInstance(core, joker, { ignoreSlots: true });
        }
      }
      for (const c of ch.startingConsumables ?? [])
        addConsumableInstance(core, newConsumableInstance(core, c), true);
      for (const v of ch.startingVouchers ?? []) this.redeemVoucher(v);
      ch.onRunStart?.(ctx);
    }
    core.invalidate();
    s.stats.minMoney = Math.min(s.stats.minMoney, s.money);
    s.stats.maxMoney = Math.max(s.stats.maxMoney, s.money);
    this.setupAnte();
    core.emit({ type: 'runStarted', seed: s.seed });
    // Obálka zdarma ze štítku přidaného na startu (výzva) se otevře hned; Rovnou za ředitelem přeskočí útraty.
    this.settle();
  }

  // ─────────────────────────── Veřejné API ───────────────────────────

  get state(): Readonly<RunState> {
    return this.core.state;
  }

  get bus(): EventBus<GameEvent> {
    return this.core.bus;
  }

  get registry(): ContentRegistry {
    return this.core.registry;
  }

  modifiers(): Readonly<Modifiers> {
    return this.core.mods();
  }

  preview(cardIds: readonly number[]): HandPreview {
    const p = previewHand(this.core, cardIds);
    if (p.hidden || !p.hand || p.blockedReason) return p;
    const beat = this.scoreToBeat();
    if (beat === null) return p;
    const estimate = this.estimateScore(cardIds);
    return estimate === null ? { ...p, scoreToBeat: beat } : { ...p, scoreToBeat: beat, estimate };
  }

  /**
   * Laťka aktivního šéfa pro příští ruku (`BossHooks.scoreToBeat`, Pan starosta), nebo null. Čistý dotaz pro UI —
   * běží v `readOnly`, chyba obsahu = bez laťky.
   */
  scoreToBeat(): number | null {
    const core = this.core;
    const s = core.state;
    if (s.phase !== 'round' || !s.round) return null;
    const hook = core.activeBoss()?.hooks.scoreToBeat;
    if (!hook) return null;
    try {
      const v = core.readOnly(() => hook(core.bossCtx()));
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Odhad skóre ruky `floor(čipy × mult)` se všemi efekty: zahraje ji na kopii stavu s náhradními RNG proudy
   * (odhad tak neprozradí skutečný výsledek náhody a skutečný run se nezmění). Null = nejde spočítat.
   */
  private estimateScore(cardIds: readonly number[]): number | null {
    try {
      const copy = structuredClone(this.core.state) as RunState;
      copy.rng = createRngStates(`${copy.seed}:preview`);
      const res = Game.fromState(copy, this.core.registry).dispatch({ type: 'play', cardIds: [...cardIds] });
      if (!res.ok) return null;
      const played = res.events.find((e) => e.type === 'handPlayed');
      if (!played || played.type !== 'handPlayed' || played.result.blockedReason) return null;
      const raw = Math.floor(played.result.chips * played.result.mult);
      return Number.isFinite(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  card(id: number): Readonly<Card> | undefined {
    return this.core.card(id);
  }

  /** Prodejní cena žolíka nebo spotřebky (podle uid), 0 když neexistuje. */
  sellValue(uid: number): number {
    const j = this.core.state.jokers.find((x) => x.uid === uid);
    if (j) return jokerSellValue(this.core, j);
    const c = this.core.state.consumables.find((x) => x.uid === uid);
    return c ? consumableSellValue(this.core, c) : 0;
  }

  /** Lze spotřebku teď použít s danými cíli? */
  canUseConsumable(uid: number, targetIds: readonly number[] = []): boolean {
    const c = this.core.state.consumables.find((x) => x.uid === uid);
    if (!c) return false;
    try {
      return this.consumableUsable(c, targetIds);
    } catch {
      return false;
    }
  }

  /**
   * Kolik cílů spotřebka teď smí mít: rozsah z definice, horní mez navíc omezená `Modifiers.maxSelect` — pravidlo
   * „vybrat jde nejvýš N karet“ (Minimalista, Garsonka 1+kk) platí pro každý výběr z ruky, i pro cíle spotřebky.
   * Null = spotřebka cíle nemá (nebo ji registr nezná).
   */
  consumableTargetRange(defId: string): { min: number; max: number } | null {
    const target = this.core.registry.consumables[defId]?.target;
    if (!target) return null;
    return { min: target.min, max: Math.min(target.max, this.core.mods().maxSelect) };
  }

  /**
   * Šla by akce teď provést? Zkusí ji na kopii stavu — skutečný run se nezmění ani neposune RNG — a vrátí výsledek
   * (úspěch bez událostí, nebo kód chyby). UI se tak ptá přímo enginu (např. „Koupit a použít“ ve Večerce, „Použít“
   * v obálce) a nemůže s ním nesouhlasit. Výjimka z obsahu = `cannotUse`.
   */
  check(action: Action): ActionResult {
    try {
      const copy = new Game(new GameCore(detached(this.core.state), this.core.registry));
      const res = copy.dispatch(action);
      return res.ok ? { ok: true, events: [] } : res;
    } catch {
      return { ok: false, error: 'cannotUse' };
    }
  }

  /**
   * Prodejní cena zboží ze slotu Večerky, jako by ho hráč koupil — jen tuhle jednu položku, nic dalšího z Večerky
   * (počítá se nad kopií stavu, vzorec zůstává v `sellValue`). Hrací karta (neprodává se), prodaná nebo neexistující
   * položka = null.
   */
  shopSellValue(slot: number): number | null {
    const item = this.core.state.shop?.items[slot];
    if (!item || item.sold || item.kind === 'card') return null;
    try {
      const copy = detached(this.core.state);
      if (item.kind === 'joker') copy.jokers.push(detached(item.joker));
      else copy.consumables.push(detached(item.consumable));
      const game = new Game(new GameCore(copy, this.core.registry));
      return game.sellValue(item.kind === 'joker' ? item.joker.uid : item.consumable.uid);
    } catch {
      return null;
    }
  }

  /** Aktuální křivka cílů (podle obtížnosti). */
  targetCurve(): number {
    let curve = 1;
    for (const st of Object.values(this.core.registry.stakes)) {
      if (st.level <= this.core.state.stake && st.targetCurve) curve = Math.max(curve, st.targetCurve);
    }
    return curve;
  }

  /** Cíl útraty v aktuálním patře (šéf navíc × `bossTargetMult` — Šéf má chřipku). */
  blindTarget(kind: BlindKind, bossId: string | null = null): number {
    const boss = bossId ? this.core.registry.bosses[bossId] : undefined;
    const m = this.core.mods();
    return blindTarget(this.core.state.ante, kind, this.targetCurve(), {
      bossMult: boss?.targetMult,
      targetMult: kind === 'boss' ? m.targetMult * m.bossTargetMult : m.targetMult,
    });
  }

  /**
   * Odměna za útratu v aktuálním patře (DESIGN 2.4.2, položka 1) — stejné číslo pro výběr útrat i rozpis odměn:
   * Malá 3 / Velká 4 / šéf `BossDef.reward` (výchozí 5) Kč, Malá 0 při `StakeDef.noSmallBlindReward`,
   * × `blindRewardMult`, dolů na celé koruny. Pravidlo šéfa ve Velké útratě (Imperial) odměnu nemění.
   */
  blindReward(kind: BlindKind, bossId: string | null = null): number {
    const reg = this.core.registry;
    const boss = kind === 'boss' && bossId ? reg.bosses[bossId] : undefined;
    let reward = kind === 'boss' ? (boss?.reward ?? BLIND_REWARDS.boss) : BLIND_REWARDS[kind];
    if (
      kind === 'small' &&
      Object.values(reg.stakes).some((st) => st.level <= this.core.state.stake && st.noSmallBlindReward)
    )
      reward = 0;
    return Math.floor(rewardAmount(reward) * this.core.mods().blindRewardMult);
  }

  dispatch(action: Action): ActionResult {
    const core = this.core;
    const snapshot = JSON.stringify(core.state);
    core.invalidate();
    core.takeEvents();
    try {
      this.apply(action);
      // Pravidlo šéfa o žolících (Jednooký hejtman) platí i po přeřazení, prodeji nebo novém žolíkovi během kola.
      if (core.state.phase === 'round') refreshBossJokerDebuffs(core);
      // Obálky zdarma ze štítků (`api.openBooster`) se otevřou, jakmile je výběr útraty nebo Večerka; pak případné
      // automatické přeskočení útrat (`Modifiers.autoSkip`).
      this.settle();
      this.ensureRoundPlayable();
      this.keepHandSorted();
      core.invalidate();
      // Ceny ve Večerce sledují aktuální modifikátory (kupón se slevou, Amnestie…).
      if (core.state.shop) refreshShopPrices(core, core.state.shop);
    } catch (e) {
      // Neplatná akce nesmí změnit stav. Neočekávaná výjimka (chyba v obsahu) také ne: stav se vrátí do stavu před
      // akcí (autosave tak neuloží napůl provedenou akci) a výjimka letí dál.
      core.state = JSON.parse(snapshot) as RunState;
      core.invalidate();
      core.takeEvents();
      if (e instanceof ActionError) return { ok: false, error: e.code };
      throw e;
    }
    // Události se doručí až po dokončení akce — chyba posluchače (UI) už stav nevrací.
    return { ok: true, events: core.flush() };
  }

  // ─────────────────────────── Akce ───────────────────────────

  private apply(a: Action): void {
    switch (a.type) {
      case 'selectBlind':
        return this.selectBlind();
      case 'skipBlind':
        return this.skipBlind();
      case 'rerollBoss':
        return this.rerollBoss();
      case 'play':
        return this.play(a.cardIds);
      case 'discard':
        return this.discard(a.cardIds);
      case 'reorderHand':
        return this.reorderHand(a.cardIds);
      case 'sortHand':
        return this.sortHand(a.by);
      case 'cashOut':
        return this.cashOut();
      case 'buy':
        return this.buy(a.slot, false, undefined);
      case 'buyAndUse':
        return this.buy(a.slot, true, a.targetIds);
      case 'buyBooster':
        return this.buyBooster(a.slot);
      case 'buyVoucher':
        return this.buyVoucher(a.slot);
      case 'reroll':
        return this.reroll();
      case 'leaveShop':
        return this.leaveShop();
      case 'pickBooster':
        return this.pickBooster(a.index, a.targetIds, a.keep === true);
      case 'skipBooster':
        return this.closeBooster(true);
      case 'sellJoker':
        return this.sellJoker(a.uid);
      case 'sellConsumable':
        return this.sellConsumable(a.uid);
      case 'useConsumable':
        return this.useConsumable(a.uid, a.targetIds ?? []);
      case 'reorderJokers':
        return this.reorderJokers(a.uids);
      case 'continueEndless':
        return this.continueEndless();
      default:
        // Neznámá akce (chybný vstup z textového režimu, starší UI) — stav se nemění.
        return fail('wrongPhase');
    }
  }

  private requirePhase(...phases: RunState['phase'][]): void {
    if (!phases.includes(this.core.state.phase)) fail('wrongPhase');
  }

  private pay(price: number): void {
    const s = this.core.state;
    if (price > 0 && s.money - price < -this.core.mods().debtLimit) fail('notEnoughMoney');
    if (price !== 0) {
      this.core.api.addMoney(-price, 'purchase');
      s.stats.moneySpent += Math.max(0, price);
    }
  }

  // ── útraty ──

  private setupAnte(): void {
    const core = this.core;
    const s = core.state;
    const challenge = core.challenge();
    // Začátek patra pro pravidlo výzvy (Krátká paměť: úrovně kombinací zpět na 1) — před losováním útrat.
    if (challenge?.onAnteStart) {
      challenge.onAnteStart(extend(core.baseCtx('misc'), { ante: s.ante }));
      core.invalidate();
    }
    const bossId = pickBossId(core);
    // Imperial: Velká útrata má navíc pravidlo jiného běžného šéfa.
    const bigBossId = stakeBigBlindBoss(core) ? pickBigBlindBossId(core, bossId) : null;
    const tagRng = core.rng('tag');
    const bannedTags = challenge?.bannedTags ?? [];
    const tags = Object.values(core.registry.tags)
      .filter((t) => (t.minAnte ?? 1) <= s.ante && !bannedTags.includes(t.id))
      .map((t) => t.id)
      .sort();
    // Malá a Velká mají různé štítky (DESIGN 7); stejný jen tehdy, když je v poolu jediný.
    const pickTag = (exclude: string | null): string | null => {
      const pool = tags.filter((t) => t !== exclude);
      if (pool.length > 0) return tagRng.pick(pool);
      return tags.length > 0 ? tagRng.pick(tags) : null;
    };
    // Útraty, které nejde přeskočit (`Modifiers.noSkip`), štítek nemají.
    const noSkip = core.mods().noSkip;
    const smallTag = noSkip ? null : pickTag(null);
    const bigTag = noSkip ? null : pickTag(smallTag);
    s.blinds = BLIND_KINDS.map((kind): BlindSlot => ({
      kind,
      bossId: kind === 'boss' ? bossId : kind === 'big' ? bigBossId : null,
      skipTagId: kind === 'small' ? smallTag : kind === 'big' ? bigTag : null,
      status: kind === 'small' ? 'current' : 'upcoming',
    }));
    s.blindIndex = 0;
    s.anteVouchers = rollAnteVouchers(core);
  }

  private currentBlind(): BlindSlot {
    const b = this.core.state.blinds[this.core.state.blindIndex];
    if (!b) fail('wrongPhase');
    return b;
  }

  private selectBlind(): void {
    this.requirePhase('blind_select');
    const core = this.core;
    const s = core.state;
    const blind = this.currentBlind();
    s.round = {
      blind: blind.kind,
      bossId: blind.bossId,
      bossDisabled: false,
      target: 0,
      score: 0,
      handsLeft: 0,
      discardsLeft: 0,
      drawPile: [],
      hand: [],
      discardPile: [],
      playedPile: [],
      handsPlayed: 0,
      discardsUsed: 0,
      handTypesPlayed: [],
      handSizeDelta: 0,
      jokerDebuffs: [],
      flags: {},
    };
    core.invalidate();
    core.eachJoker('onBlindSelect', {});
    core.eachTag('onBlindSelect');
    const round = s.round!;
    const m = core.mods();
    round.target = this.blindTarget(blind.kind, blind.bossId);
    round.handsLeft = m.hands;
    round.discardsLeft = m.discards;
    const ids = s.deck.map((c) => c.id);
    core.rng('deck').shuffle(ids);
    round.drawPile = ids;
    for (const c of s.deck) {
      c.faceDown = false;
      c.debuffed = false;
    }
    refreshDebuffs(core);
    core.emit({ type: 'blindSelected', blind: blind.kind, bossId: blind.bossId, target: round.target });
    const boss = core.activeBoss();
    if (boss?.hooks.onRoundStart) {
      boss.hooks.onRoundStart(core.bossCtx());
      // Hook mohl změnit stav, na kterém závisí `passive` šéfa (round.flags) — modifikátory se přepočítají.
      core.invalidate();
      // Pravidlo vylosované na začátku kola (Pověrčivá babka) platí pro celý balíček.
      refreshBossDebuffs(core);
    }
    // Žolíci mimo provoz podle pravidla šéfa (Jednooký hejtman, Výpadek proudu) — před `onRoundStart` žolíků a před
    // přepočtem rukou/zahození níže (pasivní efekty vypnutých žolíků se nezapočítají).
    refreshBossJokerDebuffs(core);
    core.eachJoker('onRoundStart', {});
    core.eachTag('onRoundStart');
    s.phase = 'round';
    core.emit({ type: 'roundStarted', ante: s.ante, blind: blind.kind, target: round.target });
    // Hodnoty se mohly změnit hooky začátku kola (štítky/šéf).
    const m2 = core.mods();
    if (m2.hands !== m.hands) round.handsLeft = Math.max(1, round.handsLeft + (m2.hands - m.hands));
    if (m2.discards !== m.discards)
      round.discardsLeft = Math.max(0, round.discardsLeft + (m2.discards - m.discards));
    fillHand(core);
  }

  private skipBlind(): void {
    this.requirePhase('blind_select');
    if (this.core.mods().noSkip) fail('cannotSkip');
    this.skipCurrentBlind();
  }

  /** Přeskočí aktuální Malou/Velkou útratu a dá její štítek (akce hráče i automatické přeskočení). */
  private skipCurrentBlind(): void {
    const core = this.core;
    const s = core.state;
    const blind = this.currentBlind();
    if (blind.kind === 'boss') fail('cannotSkip');
    blind.status = 'skipped';
    s.stats.blindsSkipped++;
    s.blindIndex++;
    const next = s.blinds[s.blindIndex];
    if (next) next.status = 'current';
    core.emit({ type: 'blindSkipped', blind: blind.kind, tagId: blind.skipTagId });
    core.eachJoker('onSkipBlind', {});
    // Štítek, který registr nezná (obsah odebraný od uložení), se přeskočí — jinak by útrata nešla přeskočit.
    if (blind.skipTagId && core.registry.tags[blind.skipTagId]) core.api.addTag(blind.skipTagId);
  }

  private rerollBoss(): void {
    this.requirePhase('blind_select');
    const core = this.core;
    const s = core.state;
    const left = typeof s.flags.bossRerolls === 'number' ? s.flags.bossRerolls : 0;
    const unlimited = s.flags.bossRerollUnlimited === true;
    if (!unlimited && left <= 0) fail('cannotUse');
    const cost = typeof s.flags.bossRerollCost === 'number' ? s.flags.bossRerollCost : BOSS_REROLL_COST;
    const bossSlot = s.blinds.find((b) => b.kind === 'boss');
    if (!bossSlot || (bossSlot.status !== 'upcoming' && bossSlot.status !== 'current')) fail('cannotUse');
    this.pay(cost);
    if (!unlimited) s.flags.bossRerolls = left - 1;
    if (rerollBossSlot(core) === null) fail('cannotUse');
  }

  // ── kolo ──

  private validateSelection(ids: readonly number[], pool: readonly number[]): void {
    const max = this.core.mods().maxSelect;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) fail('invalidSelection');
    if (new Set(ids).size !== ids.length) fail('invalidSelection');
    for (const id of ids) if (!pool.includes(id)) fail('invalidSelection');
  }

  private round(): RoundState {
    const r = this.core.state.round;
    if (!r) fail('wrongPhase');
    return r;
  }

  private play(cardIds: readonly number[]): void {
    this.requirePhase('round');
    const core = this.core;
    const s = core.state;
    const round = this.round();
    if (round.handsLeft <= 0) fail('noHandsLeft');
    this.validateSelection(cardIds, round.hand);

    // Karty lícem dolů se při zahrání otočí (DESIGN 2.1).
    for (const id of cardIds) core.mustCard(id).faceDown = false;

    const result = scoreHand(core, cardIds);
    const type = result.hand.type;

    // přesun karet
    round.hand = round.hand.filter((id) => !cardIds.includes(id));
    // Karta zničená už během skórování (efekt žolíka) do hromádek nepatří.
    round.playedPile.push(...cardIds.filter((id) => core.card(id)));
    round.handsLeft--;
    round.handsPlayed++;
    round.handTypesPlayed.push(type);

    // statistiky a objevy (objev v runu i v profilu = první zahrání, DESIGN 2.2.4)
    // Záznam může chybět ve starším uložení (kombinace přidaná později) — doplní se výchozí.
    const hl = (s.handLevels[type] ??= { level: 1, played: 0 });
    hl.played++;
    if (!s.discoveredHands.includes(type)) {
      s.discoveredHands.push(type);
      if (core.registry.handTypes[type]?.secret) core.emit({ type: 'handDiscovered', hand: type });
    }
    s.stats.handsPlayed++;
    s.stats.cardsPlayed += cardIds.length;
    s.stats.handTypeCounts[type] = (s.stats.handTypeCounts[type] ?? 0) + 1;
    // Byrokracie: poplatek za zahranou ruku (jen do dluhového limitu — ruku jde zahrát vždy).
    const handCost = core.mods().handCost;
    if (handCost > 0) core.api.addMoney(-handCost, 'handCost');

    const boss = core.activeBoss();
    if (boss?.hooks.afterHandPlayed) {
      const played = cardIds.map((id) => core.card(id)).filter((c): c is Card => c !== undefined);
      boss.hooks.afterHandPlayed(
        extend(core.bossCtx(), {
          hand: result.hand,
          played,
          scoring: played.filter((c) => result.hand.scoringIds.includes(c.id)),
          held: round.hand.map((id) => core.mustCard(id)),
          chips: result.chips,
          mult: result.mult,
          round,
          firstHand: round.handsPlayed === 1,
          lastHand: round.handsLeft === 0,
        }),
      );
      core.invalidate();
    }

    // Konec kroku 5: hod skla, Ohmataná… (jednou za ruku), pak zničení označených karet.
    afterScoredCards(core, result, { firstHand: round.handsPlayed === 1, lastHand: round.handsLeft === 0 });
    // Šéf mohl v afterHandPlayed zapsat dočasné debuffy do round.flags (Černá kočka), nebo jeho pravidlo závisí na
    // průběhu kola — debuffy platí hned i pro ruku. Až po afterScored: zahrané karty dohrají ve stavu, v jakém skórovaly.
    refreshBossDebuffs(core);
    // Přetečení skóre kola → Number.MAX_VALUE (nekonečno by se v JSON uložení změnilo na null, DESIGN 1.3).
    round.score = safe(round.score + result.score);
    if (result.score > s.stats.bestHandScore) {
      s.stats.bestHandScore = result.score;
      s.stats.bestHandType = type;
    }
    core.emit({ type: 'handPlayed', result, roundScore: round.score });

    for (const id of result.destroyedCardIds) core.api.destroyCard(id, 'score');
    // zahrané karty jdou na odhazovací hromádku
    round.discardPile.push(...round.playedPile);
    round.playedPile = [];

    // Pravidlo šéfa o žolících se mohlo změnit průběhem kola (Výpadek proudu po první ruce) — před dobráním ruky.
    refreshBossJokerDebuffs(core);

    if (round.score >= round.target) {
      this.winRound();
    } else if (round.handsLeft <= 0) {
      this.roundLost();
    } else {
      fillHand(core);
      this.checkOutOfCards();
    }
  }

  /** Kolo skončilo pod cílem: zachrání ho štítek nebo žolík, jinak konec runu. */
  private roundLost(): void {
    if (!this.tryPreventGameOver()) this.loseRun();
  }

  /**
   * Po každé akci: kolo nesmí uváznout s prázdnou rukou (spotřebka zničila celou ruku, prázdný balíček…) — ruka se
   * dobere, a když ani pak nejsou karty, je to prohra z nedostatku karet. Jinak by nezbyla jediná platná akce.
   */
  private ensureRoundPlayable(): void {
    const s = this.core.state;
    if (s.phase !== 'round' || !s.round || s.round.hand.length > 0) return;
    fillHand(this.core);
    this.checkOutOfCards();
  }

  /** Prázdná ruka i dobírací balíček (a cíl nesplněn) = prohra z nedostatku karet (DESIGN 1.2). */
  private checkOutOfCards(): void {
    const s = this.core.state;
    const round = s.round;
    if (s.phase !== 'round' || !round) return;
    if (round.hand.length === 0 && round.drawPile.length === 0) this.roundLost();
  }

  /**
   * Pokus o záchranu prohraného kola: nejdřív štítky (`onRoundLost`; kolo se počítá jako vyhrané bez odměny
   * za útratu, štítek se spotřebuje), pak žolíci (`preventGameOver`; plná odměna).
   */
  private tryPreventGameOver(): boolean {
    const core = this.core;
    const round = this.round();
    for (const tag of [...core.state.tags]) {
      const onRoundLost = core.registry.tags[tag.defId]?.hooks.onRoundLost;
      if (!onRoundLost) continue;
      if (!onRoundLost(extend(core.tagCtx(tag), { score: round.score, target: round.target }))) continue;
      core.state.tags = core.state.tags.filter((t) => t !== tag);
      core.invalidate();
      core.emit({ type: 'tagTriggered', uid: tag.uid, defId: tag.defId });
      core.emit({ type: 'message', key: MSG.tagSaved, params: { tag: tag.defId } });
      this.winRound({ noBlindReward: true });
      return true;
    }
    const jokers = [...core.state.jokers];
    for (let i = 0; i < jokers.length; i++) {
      const j = jokers[i]!;
      if (j.debuffed) continue;
      const def = core.registry.jokers[j.defId];
      if (!def?.hooks.preventGameOver) continue;
      const saved = def.hooks.preventGameOver(
        extend(core.jokerCtx(j, i, false, def), { score: round.score, target: round.target }),
      );
      if (saved) {
        core.emit({ type: 'jokerTriggered', uid: j.uid, defId: j.defId, message: MSG.jokerSaved });
        this.winRound();
        return true;
      }
    }
    return false;
  }

  private discard(cardIds: readonly number[]): void {
    this.requirePhase('round');
    const core = this.core;
    const s = core.state;
    const round = this.round();
    if (round.discardsLeft <= 0) fail('noDiscardsLeft');
    this.validateSelection(cardIds, round.hand);
    const cards = cardIds.map((id) => core.mustCard(id));
    const firstDiscard = round.discardsUsed === 0;

    // Karty opustí ruku ještě před hooky: obsah (šéf `onDiscard`, žolíci, pečetě) vidí v ruce jen zbylé karty a nucené
    // zahození (`api.discardFromHand`, Tchyně na návštěvě) nevezme kartu, která se právě zahazuje — jinak by její id
    // bylo na odhazovací hromádce dvakrát. Zahození se počítá hned (hooky vidí `discardsLeft` po něm).
    round.hand = round.hand.filter((id) => !cardIds.includes(id));
    round.discardPile.push(...cardIds);
    round.discardsLeft--;
    round.discardsUsed++;
    s.stats.discardsUsed++;
    s.stats.cardsDiscarded += cardIds.length;
    core.emit({ type: 'cardsDiscarded', cardIds: [...cardIds] });
    // Byrokracie: poplatek za zahození (jen do dluhového limitu).
    const discardCost = core.mods().discardCost;
    if (discardCost > 0) core.api.addMoney(-discardCost, 'discardCost');

    core.eachJoker('onDiscard', { discarded: cards, firstDiscard }, (results, owner) => {
      for (const r of results) {
        if (r.money) core.api.addMoney(r.money, 'joker');
        if (r.message)
          core.emit({ type: 'jokerTriggered', uid: owner.uid, defId: owner.defId, message: r.message });
      }
    });
    for (const c of cards) {
      // Debuffnutá karta nespouští ani pečeť (DESIGN 2.1).
      const seal = c.seal && !c.debuffed ? core.registry.seals[c.seal] : undefined;
      seal?.onDiscarded?.(extend(core.baseCtx('card'), { card: c }));
    }
    core.invalidate();
    const boss = core.activeBoss();
    if (boss?.hooks.onDiscard) {
      boss.hooks.onDiscard(extend(core.bossCtx(), { discarded: cards }));
      // Šéf mohl změnit round.flags, na kterých závisí jeho `passive` (velikost ruky pro dobírání níže).
      core.invalidate();
      refreshBossDebuffs(core);
    }
    refreshBossJokerDebuffs(core);
    fillHand(core);
    this.checkOutOfCards();
  }

  /** Ruka, kterou jde přeřadit: ruka kola (jen během kola) nebo ruka obálky. */
  private sortableHand(): number[] {
    const s = this.core.state;
    if (s.phase === 'booster' && s.booster) return s.booster.hand;
    if (s.phase === 'round' && s.round) return s.round.hand;
    return fail('wrongPhase');
  }

  private reorderHand(cardIds: readonly number[]): void {
    const target = this.sortableHand();
    if (
      !Array.isArray(cardIds) ||
      cardIds.length !== target.length ||
      new Set(cardIds).size !== cardIds.length
    )
      fail('invalidSelection');
    for (const id of cardIds) if (!target.includes(id)) fail('invalidSelection');
    target.splice(0, target.length, ...cardIds);
    // Vlastní pořadí hráče má přednost — trvalé třídění se vypne.
    this.core.state.handSort = null;
  }

  /**
   * Třídění ruky podle hodnoty / barvy. Karty lícem dolů se podle skryté hodnoty netřídí — pořadí by prozradilo, co je
   * pod rubem (Výluka na trati, Mlha nad Labem, Bílá paní): zůstanou za odkrytými kartami v dosavadním pořadí.
   */
  private sortHand(by: HandSortMode): void {
    const target = this.sortableHand();
    if (by !== 'rank' && by !== 'suit') fail('invalidSelection');
    this.core.state.handSort = by;
    this.sortIds(target, by);
  }

  private sortIds(target: number[], by: HandSortMode): void {
    const core = this.core;
    const enh = core.enhancements();
    const faceUp = target.filter((id) => !core.mustCard(id).faceDown);
    const faceDown = target.filter((id) => core.mustCard(id).faceDown);
    faceUp.sort((a, b) => compareCards(core.mustCard(a), core.mustCard(b), by, enh));
    target.splice(0, target.length, ...faceUp, ...faceDown);
  }

  /**
   * Trvalé třídění (`RunState.handSort`): po každé akci se ruka v kole i v obálce znovu seřadí, takže nově dobrané
   * a přidané karty se zařadí na své místo. Karty lícem dolů zůstanou vzadu v dosavadním pořadí (`sortHand`).
   */
  private keepHandSorted(): void {
    const s = this.core.state;
    const by = s.handSort;
    if (by !== 'rank' && by !== 'suit') return;
    if (s.phase === 'round' && s.round) this.sortIds(s.round.hand, by);
    else if (s.phase === 'booster' && s.booster) this.sortIds(s.booster.hand, by);
  }

  // ── konec kola ──

  /**
   * Rozpis odměn za vyhrané kolo (DESIGN 2.4.2, v tomto pořadí): útrata, nevyužité ruce a zahození, úrok,
   * bonusy (zlaté karty, žolíci, balíček), nakonec poplatky za zapůjčené žolíky. Poplatek, který nejde
   * zaplatit ani do dluhového limitu, se nestrhne a žolík se při výplatě vrátí do půjčovny.
   */
  private computeRewards(moneyAtWin: number, opts: { noBlindReward?: boolean } = {}): RoundRewards {
    const core = this.core;
    const s = core.state;
    const m = core.mods();
    const round = this.round();
    const reg = core.registry;
    // Všechny položky se zaokrouhlují dolů na celé koruny (DESIGN 2.4.2).
    const blindReward = opts.noBlindReward ? 0 : this.blindReward(round.blind, round.bossId);
    const unusedHands = Math.floor(round.handsLeft * m.moneyPerUnusedHand);
    const unusedDiscards = Math.floor(round.discardsLeft * m.moneyPerUnusedDiscard);
    // Úrok ze zůstatku v okamžiku výhry kola — před hooky konce kola a před výplatou (DESIGN 2.4.2).
    const interest =
      moneyAtWin > 0
        ? Math.floor(Math.min(m.interestCap, Math.floor(moneyAtWin / m.interestStep)) * m.interestMult)
        : 0;
    const extra: RoundRewards['extra'] = [];
    const ctx = core.baseCtx('misc');
    // zlaté karty v ruce, modré pečetě (debuffnuté nic nedávají; Bílá hora vypíná vylepšení)
    const lastHand = round.handTypesPlayed[round.handTypesPlayed.length - 1] ?? null;
    const enhancements = core.enhancements();
    let heldMoney = 0;
    for (const id of round.hand) {
      const c = core.mustCard(id);
      if (c.debuffed) continue;
      const enh = c.enhancement ? enhancements[c.enhancement] : undefined;
      if (enh?.roundEndHeldMoney)
        heldMoney += rewardAmount(enh.roundEndHeldMoney(extend(core.baseCtx('card'), { card: c })));
      const seal = c.seal ? reg.seals[c.seal] : undefined;
      seal?.onRoundEndHeld?.(extend(core.baseCtx('card'), { card: c, lastHand }));
    }
    // Bonusy v pořadí DESIGN 2.4.2: zlaté karty v ruce, žolíci (`roundEndMoney`), balíček.
    heldMoney = Math.floor(heldMoney);
    if (heldMoney) extra.push({ source: 'held', amount: heldMoney });
    for (const j of [...s.jokers]) {
      // Aktuální pozice; zničený (efektem jiného žolíka) nebo neznámý žolík nic nedává.
      const i = s.jokers.indexOf(j);
      const def = core.registry.jokers[j.defId];
      if (i < 0 || j.debuffed || !def?.hooks.roundEndMoney) continue;
      const amount = Math.floor(rewardAmount(def.hooks.roundEndMoney(core.jokerCtx(j, i, false, def))));
      if (amount) extra.push({ source: `joker:${j.defId}`, amount, jokerUid: j.uid });
    }
    const deckMoney = Math.floor(rewardAmount(reg.decks[s.deckId]?.roundEndMoney?.(ctx)));
    if (deckMoney) extra.push({ source: `deck:${s.deckId}`, amount: deckMoney });
    // Štítky (Termínovaný vklad) — za balíčkem; spotřebovat se smí až v `onRoundEnd`, který běží po rozpisu.
    for (const tag of s.tags) {
      const roundEndMoney = reg.tags[tag.defId]?.hooks.roundEndMoney;
      if (!roundEndMoney) continue;
      const amount = Math.floor(rewardAmount(roundEndMoney(core.tagCtx(tag))));
      if (amount) extra.push({ source: `tag:${tag.defId}`, amount });
    }
    const sum = () =>
      blindReward + unusedHands + unusedDiscards + interest + extra.reduce((a, e) => a + e.amount, 0);
    // Krok 6: zapůjčení žolíci (i debuffnutí) — poplatek jen do výše dluhového limitu.
    for (const j of s.jokers) {
      if (!j.stickers.includes('rental')) continue;
      if (s.money + sum() - RENTAL_FEE >= -m.debtLimit) {
        extra.push({ source: `rental:${j.defId}`, amount: -RENTAL_FEE, jokerUid: j.uid });
      } else {
        extra.push({ source: `rentalReturned:${j.defId}`, amount: 0, jokerUid: j.uid });
      }
    }
    return { blindReward, unusedHands, unusedDiscards, interest, extra, total: safe(sum()) };
  }

  /** Kolo vyhráno (cíl splněn nebo zachráněno). `noBlindReward` = bez odměny za útratu (záchrana štítkem). */
  private winRound(opts: { noBlindReward?: boolean } = {}): void {
    const core = this.core;
    const s = core.state;
    const round = this.round();
    const blind = this.currentBlind();
    const moneyAtWin = s.money;
    blind.status = 'defeated';
    s.stats.roundsWon++;
    core.emit({
      type: 'roundWon',
      ante: s.ante,
      blind: round.blind,
      score: round.score,
      target: round.target,
    });
    if (round.blind === 'boss') {
      s.stats.bossesDefeated++;
      if (round.bossId) {
        core.emit({ type: 'bossDefeated', bossId: round.bossId });
        core.eachJoker('onBossDefeated', { bossId: round.bossId });
        core.registry.decks[s.deckId]?.onBossDefeated?.(
          extend(core.baseCtx('misc'), { bossId: round.bossId }),
        );
        core.invalidate();
      }
    }
    core.eachJoker('onRoundEnd', { blind: round.blind, bossId: round.bossId });
    const rewards = this.computeRewards(moneyAtWin, opts);
    s.rewards = rewards;
    // Události nesdílí objekty se stavem (posluchač si je smí upravit, např. seřadit rozpis).
    core.emit({ type: 'roundRewards', ...rewards, extra: rewards.extra.map((e) => ({ ...e })) });
    // Štítky až po rozpisu: štítek, který vyplácí v rozpisu (`roundEndMoney`), se tu smí spotřebovat.
    core.eachTag('onRoundEnd');

    // Dočasné debuffy žolíků platí do konce kola (včetně výpočtu odměn).
    core.clearJokerDebuffs();
    // nálepky a statistiky žolíků
    for (const j of s.jokers) {
      s.stats.jokerRoundCounts[j.defId] = (s.stats.jokerRoundCounts[j.defId] ?? 0) + 1;
      if (j.stickers.includes('perishable') && j.perishRounds !== undefined && j.perishRounds > 0) {
        j.perishRounds--;
        if (j.perishRounds === 0) {
          j.debuffed = true;
          core.emit({ type: 'jokerTriggered', uid: j.uid, defId: j.defId, message: MSG.jokerPerished });
        }
      }
    }
    for (const c of s.deck) {
      c.debuffed = false;
      c.faceDown = false;
    }
    core.invalidate();
    // Výhra = porážka šéfa patra `Modifiers.finalAnte` (výchozí 8; Konec světa 12).
    if (round.blind === 'boss' && s.ante >= core.mods().finalAnte && !s.endless) {
      s.phase = 'victory';
      core.emit({ type: 'victory', ante: s.ante });
    } else {
      s.phase = 'round_end';
    }
  }

  private loseRun(): void {
    const core = this.core;
    const s = core.state;
    const round = this.round();
    s.gameOver = {
      cause: round.bossId ?? round.blind,
      ante: s.ante,
      blind: round.blind,
      score: round.score,
      target: round.target,
    };
    s.phase = 'game_over';
    core.emit({ type: 'gameOver', info: { ...s.gameOver } });
  }

  private continueEndless(): void {
    this.requirePhase('victory');
    const s = this.core.state;
    s.endless = true;
    s.phase = 'round_end';
    this.core.emit({ type: 'endlessStarted' });
  }

  private cashOut(): void {
    this.requirePhase('round_end');
    const core = this.core;
    const s = core.state;
    const round = this.round();
    const total = s.rewards?.total ?? 0;
    if (total) core.api.addMoney(total, 'roundReward');
    core.emit({ type: 'cashedOut', amount: total });
    // Zapůjčení žolíci, za které nešlo zaplatit, se vracejí do půjčovny.
    for (const e of s.rewards?.extra ?? []) {
      if (!e.source.startsWith('rentalReturned:') || e.jokerUid === undefined) continue;
      const j = s.jokers.find((x) => x.uid === e.jokerUid);
      if (!j) continue;
      core.api.destroyJoker(j.uid, 'rental');
      core.emit({ type: 'message', key: MSG.rentalReturned, params: { joker: j.defId } });
    }
    s.rewards = null;
    const wasBoss = round.blind === 'boss';
    s.round = null;
    core.invalidate();
    if (wasBoss) {
      s.ante++;
      core.emit({ type: 'anteChanged', ante: s.ante });
      this.setupAnte();
    } else {
      s.blindIndex++;
      const next = s.blinds[s.blindIndex];
      if (next) next.status = 'current';
    }
    this.enterShop();
  }

  // ── obchod ──

  private enterShop(): void {
    const core = this.core;
    const s = core.state;
    s.phase = 'shop';
    const firstShop = s.stats.shopsEntered === 0;
    s.stats.shopsEntered++;
    s.shop = generateShop(core, { firstShop });
    // Štítky „v příští Večerce“ upravují už vygenerovanou nabídku (žolík navíc, edice, kupón, přehození zdarma).
    core.eachTag('onShopEnter');
    core.eachJoker('onShopEnter', {});
    core.emit({ type: 'shopEntered' });
  }

  private shop() {
    const shop = this.core.state.shop;
    if (!shop) fail('wrongPhase');
    return shop;
  }

  private buy(slot: number, use: boolean, targetIds: readonly number[] | undefined): void {
    this.requirePhase('shop');
    const core = this.core;
    const s = core.state;
    const item = this.shop().items[slot];
    if (!item) fail('unknownItem');
    if (item.sold) fail('soldOut');
    if (item.kind === 'joker') {
      if (use) fail('cannotUse');
      if (!jokerHasRoom(core, item.joker.edition)) fail('slotsFull');
      this.pay(item.price);
      item.sold = true;
      // Vlastní kopie: prodaný slot nesmí sdílet objekt (a tím `state`) s žolíkem v řadě — po uložení a načtení
      // by se jinak živý a načtený stav rozešly.
      addJokerInstance(core, detached(item.joker), { ignoreSlots: true, acquire: true });
      s.stats.jokersBought++;
      core.emit({ type: 'itemBought', kind: 'joker', defId: item.joker.defId, price: item.price });
    } else if (item.kind === 'consumable') {
      if (use) {
        if (!this.consumableUsable(item.consumable, targetIds ?? [])) fail('cannotUse');
        this.pay(item.price);
        item.sold = true;
        core.emit({
          type: 'itemBought',
          kind: 'consumable',
          defId: item.consumable.defId,
          price: item.price,
        });
        this.runConsumable(item.consumable, targetIds ?? []);
      } else {
        if (!consumableHasRoom(core, item.consumable.edition)) fail('slotsFull');
        this.pay(item.price);
        item.sold = true;
        addConsumableInstance(core, detached(item.consumable), true);
        core.emit({
          type: 'itemBought',
          kind: 'consumable',
          defId: item.consumable.defId,
          price: item.price,
        });
      }
    } else {
      if (use) fail('cannotUse');
      this.pay(item.price);
      item.sold = true;
      const c = item.card;
      core.api.addCard(
        {
          suit: c.suit,
          rank: c.rank,
          enhancement: c.enhancement,
          seal: c.seal,
          edition: c.edition,
          bonusChips: c.bonusChips,
        },
        { source: 'shop' },
      );
      core.emit({ type: 'itemBought', kind: 'card', defId: `${c.rank}${c.suit}`, price: item.price });
    }
  }

  private buyBooster(slot: number): void {
    this.requirePhase('shop');
    const core = this.core;
    const b = this.shop().boosters[slot];
    if (!b) fail('unknownItem');
    if (b.sold) fail('soldOut');
    this.pay(b.price);
    b.sold = true;
    core.emit({ type: 'itemBought', kind: 'booster', defId: b.boosterId, price: b.price });
    this.startBooster(b.boosterId, 'shop');
  }

  /** Otevře booster (z obchodu nebo ze štítku). Obsah ho otevírá přes `api.openBooster` (fronta ve flags). */
  startBooster(boosterId: string, returnTo: 'shop' | 'blind_select'): void {
    const core = this.core;
    const s = core.state;
    s.booster = openBooster(core, boosterId, returnTo);
    s.phase = 'booster';
    core.emit({ type: 'boosterOpened', boosterId });
    core.eachJoker('onBoosterOpened', { boosterId });
  }

  /**
   * Dorovnání stavu po akci: otevře čekající obálku zdarma a při `Modifiers.autoSkip` (Rovnou za ředitelem) přeskočí
   * aktuální Malou nebo Velkou útratu i se štítkem — opakovaně, dokud není na řadě šéf nebo se neotevře obálka
   * (po jejím zavření se pokračuje v další akci).
   */
  private settle(): void {
    const core = this.core;
    const s = core.state;
    // Pojistka: v jednom patře jsou nejvýš dvě útraty k přeskočení.
    for (let i = 0; i < 4; i++) {
      this.openPendingBooster();
      if (s.phase !== 'blind_select' || !core.mods().autoSkip) return;
      const blind = s.blinds[s.blindIndex];
      if (!blind || blind.kind === 'boss' || blind.status !== 'current') return;
      this.skipCurrentBlind();
      core.invalidate();
    }
  }

  /**
   * Otevře první obálku zdarma z fronty `flags.pendingBoosters` (`api.openBooster`), je-li fáze výběr útraty nebo
   * Večerka — zavřením se vrátí tam a další z fronty se otevře po té akci. Neznámá obálka se z fronty zahodí.
   */
  private openPendingBooster(): void {
    const s = this.core.state;
    while (s.phase === 'blind_select' || s.phase === 'shop') {
      const [next, ...rest] = pendingBoosterIds(s.flags);
      if (next === undefined) {
        delete s.flags.pendingBoosters;
        return;
      }
      if (rest.length > 0) s.flags.pendingBoosters = rest;
      else delete s.flags.pendingBoosters;
      if (this.core.registry.boosters[next]) {
        this.startBooster(next, s.phase);
        return;
      }
    }
  }

  private buyVoucher(slot: number): void {
    this.requirePhase('shop');
    const core = this.core;
    const v = this.shop().vouchers[slot];
    if (!v) fail('unknownItem');
    if (v.sold) fail('soldOut');
    // Vlastněný kupón (jednou za run), tier 2 bez vlastněného tier 1 a kupón, který teď nemá smysl (Úřední škrt
    // v patře 1), koupit nejde — hráč by jinak zaplatil za nic.
    if (core.state.vouchers.includes(v.voucherId)) fail('cannotUse');
    const requires = core.registry.vouchers[v.voucherId]?.requires;
    if (requires && !core.state.vouchers.includes(requires)) fail('cannotUse');
    if (!voucherAvailable(core, v.voucherId)) fail('cannotUse');
    this.pay(v.price);
    v.sold = true;
    core.emit({ type: 'itemBought', kind: 'voucher', defId: v.voucherId, price: v.price });
    this.redeemVoucher(v.voucherId);
  }

  /**
   * Uplatní kupón: zapíše ho do runu, zavolá `onRedeem` a v otevřené Večerce hned doplní sloty, které kupón přidal
   * (`syncShopSlots`); ceny přepočítá `dispatch` po akci.
   */
  private redeemVoucher(id: string): void {
    const core = this.core;
    const s = core.state;
    const def = core.registry.vouchers[id];
    if (!def || s.vouchers.includes(id)) return;
    s.vouchers.push(id);
    s.anteVouchers = s.anteVouchers.filter((x) => x !== id);
    core.invalidate();
    def.onRedeem?.(core.baseCtx('misc'));
    core.invalidate();
    if (s.shop) syncShopSlots(core, s.shop);
    core.emit({ type: 'voucherRedeemed', voucherId: id });
  }

  private reroll(): void {
    this.requirePhase('shop');
    const core = this.core;
    const s = core.state;
    const shop = this.shop();
    // Rychlík bez zastávky: Večerka nemá přehození (ani bezplatná).
    if (core.mods().noReroll) fail('cannotUse');
    // Zaplacená cena (0 = bezplatné přehození ze štítku); cena dalšího přehození je v `shop.rerollCost`.
    let cost = 0;
    if (shop.freeRerolls > 0) {
      shop.freeRerolls--;
    } else {
      cost = shop.rerollCost;
      this.pay(cost);
      shop.paidRerolls++;
    }
    refreshShopPrices(core, shop);
    shop.rerollsThisShop++;
    s.stats.rerolls++;
    // Položky navíc ze štítků (`extra`) přehození nemění; žolíci z nich se znovu nenabídnou.
    const extras = shop.items.filter((it) => it.extra && !it.sold);
    shop.items = [...generateShopItems(core, shopJokerIds(extras)), ...extras];
    core.eachJoker('onReroll', {});
    core.emit({ type: 'shopRerolled', cost });
  }

  private leaveShop(): void {
    this.requirePhase('shop');
    const s = this.core.state;
    s.shop = null;
    s.phase = 'blind_select';
    this.core.emit({ type: 'shopLeft' });
  }

  // ── boostery ──

  /**
   * Výběr z obálky (DESIGN 2.9): žolík jde do slotu (bez místa nejde, leda je negativní), hrací karta
   * do balíčku, spotřebka se buď hned použije (`targetIds`), nebo s `keep` uloží do volného slotu.
   */
  private pickBooster(index: number, targetIds: readonly number[] | undefined, keep: boolean): void {
    this.requirePhase('booster');
    const core = this.core;
    const s = core.state;
    const b = s.booster;
    if (!b) fail('wrongPhase');
    const opt = b.options[index];
    if (!opt) fail('unknownItem');
    if (opt.kind === 'joker') {
      if (!jokerHasRoom(core, opt.joker.edition)) fail('slotsFull');
      addJokerInstance(core, opt.joker, { ignoreSlots: true, acquire: true });
    } else if (opt.kind === 'card') {
      const c = opt.card;
      core.api.addCard(
        {
          suit: c.suit,
          rank: c.rank,
          enhancement: c.enhancement,
          seal: c.seal,
          edition: c.edition,
          bonusChips: c.bonusChips,
        },
        { source: 'booster' },
      );
    } else if (keep) {
      if (!consumableHasRoom(core, opt.consumable.edition)) fail('slotsFull');
      addConsumableInstance(core, opt.consumable, true);
    } else {
      if (!this.consumableUsable(opt.consumable, targetIds ?? [])) fail('cannotUse');
      this.runConsumable(opt.consumable, targetIds ?? []);
    }
    b.options.splice(index, 1);
    b.picksLeft--;
    core.emit({ type: 'boosterPicked', boosterId: b.boosterId, index });
    if (b.picksLeft <= 0 || b.options.length === 0) this.closeBooster(false);
  }

  private closeBooster(skipped: boolean): void {
    this.requirePhase('booster');
    const core = this.core;
    const s = core.state;
    const b = s.booster;
    if (!b) fail('wrongPhase');
    if (skipped) core.eachJoker('onBoosterSkipped', { boosterId: b.boosterId });
    s.booster = null;
    s.phase = b.returnTo;
    core.emit({ type: 'boosterClosed', boosterId: b.boosterId, skipped });
  }

  // ── prodej a spotřebky ──

  private requireActivePhase(): void {
    this.requirePhase('blind_select', 'round', 'round_end', 'shop', 'booster');
  }

  private sellJoker(uid: number): void {
    this.requireActivePhase();
    const core = this.core;
    const s = core.state;
    const j = s.jokers.find((x) => x.uid === uid);
    if (!j) fail('unknownItem');
    if (j.stickers.includes('eternal')) fail('cannotSell');
    const price = jokerSellValue(core, j);
    // Prodávaný žolík dostane isSelf = true (kopie jeho schopnosti v jiném slotu ne).
    core.eachJoker('onSell', (owner) => ({ sold: j, isSelf: owner === j }));
    s.jokers = s.jokers.filter((x) => x !== j);
    core.invalidate();
    core.api.addMoney(price, 'sell');
    s.stats.jokersSold++;
    core.emit({ type: 'jokerSold', uid, defId: j.defId, price });
  }

  private sellConsumable(uid: number): void {
    this.requireActivePhase();
    const core = this.core;
    const s = core.state;
    const c = s.consumables.find((x) => x.uid === uid);
    if (!c) fail('unknownItem');
    const price = consumableSellValue(core, c);
    s.consumables = s.consumables.filter((x) => x !== c);
    core.invalidate();
    core.api.addMoney(price, 'sell');
    core.emit({ type: 'consumableSold', uid, defId: c.defId, price });
  }

  /** Karty, které jdou použít jako cíle (ruka v kole nebo ruka boosteru). */
  private targetPool(): readonly number[] {
    const s = this.core.state;
    if (s.phase === 'booster' && s.booster) return s.booster.hand;
    if (s.phase === 'round' && s.round) return s.round.hand;
    return [];
  }

  /**
   * Kontext spotřebky. Cíle jsou seřazené zleva doprava podle pozice v ruce (ne podle pořadí výběru), takže
   * „levá“ a „pravá“ karta z DESIGN 5.1 (Zrcátko v předsíni, Kopřivový odvar, Sloučení spisů) nezávisí na UI.
   */
  private consumableCtx(inst: ConsumableInstance, targetIds: readonly number[]): ConsumableCtx {
    const core = this.core;
    const pool = this.targetPool();
    const pos = (id: number) => {
      const i = pool.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const targets = [...targetIds].sort((a, b) => pos(a) - pos(b)).map((id) => core.mustCard(id));
    return Object.assign(core.baseCtx('consumable'), { self: inst, targets });
  }

  private consumableUsable(inst: ConsumableInstance, targetIds: readonly number[]): boolean {
    const def = this.core.registry.consumables[inst.defId];
    if (!def) return false;
    const pool = this.targetPool();
    if (!Array.isArray(targetIds) || new Set(targetIds).size !== targetIds.length) return false;
    for (const id of targetIds) if (!pool.includes(id)) return false;
    const range = this.consumableTargetRange(inst.defId);
    if (range) {
      if (targetIds.length < range.min || targetIds.length > range.max) return false;
    } else if (targetIds.length > 0) {
      return false;
    }
    // Dotaz bez vedlejších účinků: `canUse` nesmí posunout RNG (UI se ptá libovolně často).
    const canUse = def.canUse;
    // Kopie instance: `canUse` je dotaz a instanci nesmí změnit.
    return canUse ? this.core.readOnly(() => canUse(this.consumableCtx({ ...inst }, targetIds))) : true;
  }

  private runConsumable(inst: ConsumableInstance, targetIds: readonly number[]): void {
    const core = this.core;
    const s = core.state;
    const def = core.registry.consumables[inst.defId]!;
    def.use(this.consumableCtx(inst, targetIds));
    s.stats.consumablesUsed++;
    s.lastConsumable = inst.defId;
    core.invalidate();
    core.emit({ type: 'consumableUsed', uid: inst.uid, defId: inst.defId });
    core.eachJoker('onConsumableUsed', { defId: inst.defId, kind: def.kind });
  }

  private useConsumable(uid: number, targetIds: readonly number[]): void {
    this.requireActivePhase();
    const s = this.core.state;
    const c = s.consumables.find((x) => x.uid === uid);
    if (!c) fail('unknownItem');
    if (!this.consumableUsable(c, targetIds)) fail('cannotUse');
    s.consumables = s.consumables.filter((x) => x !== c);
    this.core.invalidate();
    this.runConsumable(c, targetIds);
  }

  private reorderJokers(uids: readonly number[]): void {
    this.requireActivePhase();
    const s = this.core.state;
    if (!Array.isArray(uids) || uids.length !== s.jokers.length || new Set(uids).size !== uids.length)
      fail('invalidSelection');
    const byUid = new Map(s.jokers.map((j) => [j.uid, j]));
    const next = uids.map((u) => byUid.get(u));
    if (next.some((j) => !j)) fail('invalidSelection');
    s.jokers = next as typeof s.jokers;
  }

  // ─────────────────────────── Pro obsah/testy ───────────────────────────

  /** Kontext pro ruční volání obsahu (testy, debug). */
  ctx(): BaseCtx {
    return this.core.baseCtx('misc');
  }

  /** Přímý přístup k jádru (jen testy a simulace — UI ho nesmí používat). */
  get _core(): GameCore {
    return this.core;
  }

  /** Vynutí lízání (testy). */
  _draw(n: number): void {
    drawCards(this.core, n);
  }
}
