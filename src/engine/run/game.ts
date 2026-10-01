/**
 * Game — stavový automat jednoho runu. Jediný vstupní bod pro UI a simulaci:
 * `dispatch(action)` → změna stavu + události. Neplatná akce stav nemění.
 */
import type { BaseCtx, ConsumableCtx, ContentRegistry, NewRunOptions } from '../content-types';
import { compareCards } from '../cards/cards';
import { addConsumableInstance, addJokerInstance, newConsumableInstance, newJokerInstance } from '../effects/api';
import { GameCore, extend } from '../effects/core';
import type { EventBus } from '../events';
import { generateSeed } from '../rng/rng';
import { previewHand, scoreHand } from '../scoring/score';
import {
  consumablePrice,
  generateShop,
  generateShopItems,
  openBooster,
  rollAnteVouchers,
} from '../shop/shop';
import type {
  Action,
  ActionErrorCode,
  ActionResult,
  BlindKind,
  BlindSlot,
  Card,
  GameEvent,
  HandPreview,
  Modifiers,
  RoundRewards,
  RoundState,
  RunState,
} from '../types';
import { BLIND_KINDS } from '../types';
import { drawCards, fillHand, refreshDebuffs } from './draw';
import { createRunState } from './init';
import { blindTarget } from './targets';

export const BLIND_REWARDS: Record<BlindKind, number> = { small: 3, big: 4, boss: 5 };
export const FINAL_ANTE = 8;
export const DEFAULT_BOSS_REROLL_COST = 10;

class ActionError extends Error {
  constructor(public readonly code: ActionErrorCode) {
    super(code);
  }
}

function fail(code: ActionErrorCode): never {
  throw new ActionError(code);
}

export class Game {
  private readonly core: GameCore;

  private constructor(core: GameCore) {
    this.core = core;
  }

  // ─────────────────────────── Vytvoření ───────────────────────────

  static newRun(opts: NewRunOptions, registry: ContentRegistry): Game {
    const seed = (opts.seed ?? generateSeed(Math.random)).trim().toUpperCase();
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
    reg.decks[s.deckId]?.onRunStart?.(ctx);
    const ch = opts.challengeId ? reg.challenges[opts.challengeId] : undefined;
    if (ch) {
      for (const j of ch.startingJokers ?? []) {
        addJokerInstance(core, newJokerInstance(core, j.defId, j.edition ?? null, j.stickers ?? []), true);
      }
      for (const c of ch.startingConsumables ?? []) addConsumableInstance(core, newConsumableInstance(core, c), true);
      for (const v of ch.startingVouchers ?? []) this.redeemVoucher(v);
      ch.onRunStart?.(ctx);
    }
    core.invalidate();
    s.stats.minMoney = Math.min(s.stats.minMoney, s.money);
    s.stats.maxMoney = Math.max(s.stats.maxMoney, s.money);
    this.setupAnte();
    core.emit({ type: 'runStarted', seed: s.seed });
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
    return previewHand(this.core, cardIds);
  }

  card(id: number): Readonly<Card> | undefined {
    return this.core.card(id);
  }

  sellValue(uid: number): number {
    const j = this.core.state.jokers.find((x) => x.uid === uid);
    return j ? this.core.api.sellValue(j) : 0;
  }

  /** Lze spotřebku teď použít s danými cíli? */
  canUseConsumable(uid: number, targetIds: readonly number[] = []): boolean {
    const c = this.core.state.consumables.find((x) => x.uid === uid);
    if (!c) return false;
    try {
      return this.consumableUsable(c.defId, c.uid, targetIds);
    } catch {
      return false;
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

  /** Cíl útraty v aktuálním patře. */
  blindTarget(kind: BlindKind, bossId: string | null = null): number {
    const boss = bossId ? this.core.registry.bosses[bossId] : undefined;
    return blindTarget(this.core.state.ante, kind, this.targetCurve(), {
      bossMult: boss?.targetMult,
      targetMult: this.core.mods().targetMult,
    });
  }

  dispatch(action: Action): ActionResult {
    const core = this.core;
    const snapshot = JSON.stringify(core.state);
    core.invalidate();
    core.takeEvents();
    try {
      this.apply(action);
      core.invalidate();
      return { ok: true, events: core.flush() };
    } catch (e) {
      if (e instanceof ActionError) {
        // Neplatná akce nesmí změnit stav.
        core.state = JSON.parse(snapshot) as RunState;
        core.invalidate();
        core.takeEvents();
        return { ok: false, error: e.code };
      }
      throw e;
    }
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
        return this.pickBooster(a.index, a.targetIds);
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
    const bossId = this.pickBoss();
    const tagRng = core.rng('tag');
    const tags = Object.values(core.registry.tags)
      .filter((t) => (t.minAnte ?? 1) <= s.ante)
      .map((t) => t.id)
      .sort();
    const pickTag = () => (tags.length ? tagRng.pick(tags) : null);
    s.blinds = BLIND_KINDS.map(
      (kind): BlindSlot => ({
        kind,
        bossId: kind === 'boss' ? bossId : null,
        skipTagId: kind === 'boss' ? null : pickTag(),
        status: kind === 'small' ? 'current' : 'upcoming',
      }),
    );
    s.blindIndex = 0;
    s.anteVouchers = rollAnteVouchers(core);
  }

  private pickBoss(exclude: readonly string[] = []): string | null {
    const core = this.core;
    const s = core.state;
    const isFinal = s.ante >= FINAL_ANTE && s.ante % FINAL_ANTE === 0;
    const all = Object.values(core.registry.bosses);
    let pool = all.filter((b) => (isFinal ? b.final : !b.final && (b.minAnte ?? 1) <= s.ante));
    if (pool.length === 0) pool = all.filter((b) => !b.final);
    if (pool.length === 0) return null;
    const notExcluded = pool.filter((b) => !exclude.includes(b.id));
    if (notExcluded.length > 0) pool = notExcluded;
    const unseen = pool.filter((b) => !s.bossesSeen.includes(b.id));
    const ids = (unseen.length > 0 ? unseen : pool).map((b) => b.id).sort();
    const id = core.rng('boss').pick(ids);
    if (!s.bossesSeen.includes(id)) s.bossesSeen.push(id);
    return id;
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
    boss?.hooks.onRoundStart?.(core.bossCtx());
    core.eachJoker('onRoundStart', {});
    core.eachTag('onRoundStart');
    s.phase = 'round';
    core.emit({ type: 'roundStarted', ante: s.ante, blind: blind.kind, target: round.target });
    // Hodnoty se mohly změnit hooky začátku kola (štítky/šéf).
    const m2 = core.mods();
    if (m2.hands !== m.hands) round.handsLeft = Math.max(1, round.handsLeft + (m2.hands - m.hands));
    if (m2.discards !== m.discards) round.discardsLeft = Math.max(0, round.discardsLeft + (m2.discards - m.discards));
    fillHand(core);
  }

  private skipBlind(): void {
    this.requirePhase('blind_select');
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
    if (blind.skipTagId) core.api.addTag(blind.skipTagId);
  }

  private rerollBoss(): void {
    this.requirePhase('blind_select');
    const core = this.core;
    const s = core.state;
    const left = typeof s.flags.bossRerolls === 'number' ? s.flags.bossRerolls : 0;
    const unlimited = s.flags.bossRerollUnlimited === true;
    if (!unlimited && left <= 0) fail('cannotUse');
    const cost = typeof s.flags.bossRerollCost === 'number' ? s.flags.bossRerollCost : DEFAULT_BOSS_REROLL_COST;
    const bossSlot = s.blinds.find((b) => b.kind === 'boss');
    if (!bossSlot || bossSlot.status !== 'upcoming' && bossSlot.status !== 'current') fail('cannotUse');
    this.pay(cost);
    if (!unlimited) s.flags.bossRerolls = left - 1;
    const id = this.pickBoss(bossSlot.bossId ? [bossSlot.bossId] : []);
    bossSlot.bossId = id;
    if (id) core.emit({ type: 'bossRerolled', bossId: id });
  }

  // ── kolo ──

  private validateSelection(ids: readonly number[], pool: readonly number[]): void {
    const max = this.core.mods().maxSelect;
    if (ids.length === 0 || ids.length > max) fail('invalidSelection');
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

    const result = scoreHand(core, cardIds);
    const type = result.hand.type;

    // přesun karet
    round.hand = round.hand.filter((id) => !cardIds.includes(id));
    round.playedPile.push(...cardIds);
    round.handsLeft--;
    round.handsPlayed++;
    round.handTypesPlayed.push(type);
    round.score += result.score;

    // statistiky a objevy
    const hl = s.handLevels[type];
    const firstTime = hl.played === 0;
    hl.played++;
    if (firstTime && core.registry.handTypes[type]?.secret) core.emit({ type: 'handDiscovered', hand: type });
    s.stats.handsPlayed++;
    s.stats.cardsPlayed += cardIds.length;
    s.stats.handTypeCounts[type] = (s.stats.handTypeCounts[type] ?? 0) + 1;
    if (result.score > s.stats.bestHandScore) {
      s.stats.bestHandScore = result.score;
      s.stats.bestHandType = type;
    }
    core.emit({ type: 'handPlayed', result, roundScore: round.score });

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
    }

    for (const id of result.destroyedCardIds) core.api.destroyCard(id, 'score');
    // zahrané karty jdou na odhazovací hromádku
    round.discardPile.push(...round.playedPile);
    round.playedPile = [];

    if (round.score >= round.target) {
      this.winRound();
    } else if (round.handsLeft <= 0) {
      if (!this.tryPreventGameOver()) this.loseRun();
    } else {
      fillHand(core);
    }
  }

  private tryPreventGameOver(): boolean {
    const core = this.core;
    const round = this.round();
    const jokers = [...core.state.jokers];
    for (let i = 0; i < jokers.length; i++) {
      const j = jokers[i]!;
      if (j.debuffed) continue;
      const def = core.jokerDef(j);
      if (!def.hooks.preventGameOver) continue;
      const saved = def.hooks.preventGameOver(
        extend(core.jokerCtx(j, i, false, def), { score: round.score, target: round.target }),
      );
      if (saved) {
        core.emit({ type: 'jokerTriggered', uid: j.uid, defId: j.defId, message: 'jokers.saved' });
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

    core.eachJoker('onDiscard', { discarded: cards, firstDiscard }, (results, owner) => {
      for (const r of results) {
        if (r.money) core.api.addMoney(r.money, 'joker');
        if (r.message) core.emit({ type: 'jokerTriggered', uid: owner.uid, defId: owner.defId, message: r.message });
      }
    });
    for (const c of cards) {
      const seal = c.seal ? core.registry.seals[c.seal] : undefined;
      seal?.onDiscarded?.(extend(core.baseCtx('card'), { card: c }));
    }
    const boss = core.activeBoss();
    boss?.hooks.onDiscard?.(extend(core.bossCtx(), { discarded: cards }));

    round.hand = round.hand.filter((id) => !cardIds.includes(id));
    round.discardPile.push(...cardIds.filter((id) => core.card(id)));
    round.discardsLeft--;
    round.discardsUsed++;
    s.stats.discardsUsed++;
    s.stats.cardsDiscarded += cardIds.length;
    core.emit({ type: 'cardsDiscarded', cardIds: [...cardIds] });
    fillHand(core);
  }

  private reorderHand(cardIds: readonly number[]): void {
    const s = this.core.state;
    const target = s.phase === 'booster' && s.booster ? s.booster.hand : s.round?.hand;
    if (!target) fail('wrongPhase');
    if (cardIds.length !== target.length || new Set(cardIds).size !== cardIds.length) fail('invalidSelection');
    for (const id of cardIds) if (!target.includes(id)) fail('invalidSelection');
    target.splice(0, target.length, ...cardIds);
  }

  private sortHand(by: 'rank' | 'suit'): void {
    const core = this.core;
    const s = core.state;
    const target = s.phase === 'booster' && s.booster ? s.booster.hand : s.round?.hand;
    if (!target) fail('wrongPhase');
    const enh = core.registry.enhancements;
    target.sort((a, b) => compareCards(core.mustCard(a), core.mustCard(b), by, enh));
  }

  // ── konec kola ──

  private computeRewards(): RoundRewards {
    const core = this.core;
    const s = core.state;
    const m = core.mods();
    const round = this.round();
    const reg = core.registry;
    const boss = round.bossId ? reg.bosses[round.bossId] : undefined;
    let blindReward = round.blind === 'boss' ? (boss?.reward ?? BLIND_REWARDS.boss) : BLIND_REWARDS[round.blind];
    if (round.blind === 'small') {
      const noReward = Object.values(reg.stakes).some((st) => st.level <= s.stake && st.noSmallBlindReward);
      if (noReward) blindReward = 0;
    }
    blindReward = Math.floor(blindReward * m.blindRewardMult);
    const unusedHands = round.handsLeft * m.moneyPerUnusedHand;
    const unusedDiscards = round.discardsLeft * m.moneyPerUnusedDiscard;
    const interest = s.money > 0 ? Math.floor(Math.min(m.interestCap, Math.floor(s.money / m.interestStep)) * m.interestMult) : 0;
    const extra: RoundRewards['extra'] = [];
    const ctx = core.baseCtx('misc');
    // zlaté karty v ruce, modré pečetě
    const lastHand = round.handTypesPlayed[round.handTypesPlayed.length - 1] ?? null;
    let heldMoney = 0;
    for (const id of round.hand) {
      const c = core.mustCard(id);
      if (c.debuffed) continue;
      const enh = c.enhancement ? reg.enhancements[c.enhancement] : undefined;
      if (enh?.roundEndHeldMoney) heldMoney += enh.roundEndHeldMoney(extend(core.baseCtx('card'), { card: c }));
      const seal = c.seal ? reg.seals[c.seal] : undefined;
      seal?.onRoundEndHeld?.(extend(core.baseCtx('card'), { card: c, lastHand }));
    }
    if (heldMoney) extra.push({ source: 'held', amount: heldMoney });
    const deckMoney = reg.decks[s.deckId]?.roundEndMoney?.(ctx) ?? 0;
    if (deckMoney) extra.push({ source: `deck:${s.deckId}`, amount: deckMoney });
    s.jokers.forEach((j, i) => {
      if (j.debuffed) return;
      const def = core.jokerDef(j);
      const amount = def.hooks.roundEndMoney?.(core.jokerCtx(j, i, false, def)) ?? 0;
      if (amount) extra.push({ source: `joker:${j.defId}`, amount });
      if (j.stickers.includes('rental')) extra.push({ source: `rental:${j.defId}`, amount: -3 });
    });
    const total = blindReward + unusedHands + unusedDiscards + interest + extra.reduce((a, e) => a + e.amount, 0);
    return { blindReward, unusedHands, unusedDiscards, interest, extra, total };
  }

  private winRound(): void {
    const core = this.core;
    const s = core.state;
    const round = this.round();
    const blind = this.currentBlind();
    blind.status = 'defeated';
    s.stats.roundsWon++;
    core.emit({ type: 'roundWon', ante: s.ante, blind: round.blind, score: round.score, target: round.target });
    if (round.blind === 'boss') {
      s.stats.bossesDefeated++;
      if (round.bossId) {
        core.emit({ type: 'bossDefeated', bossId: round.bossId });
        core.eachJoker('onBossDefeated', { bossId: round.bossId });
      }
    }
    core.eachJoker('onRoundEnd', { blind: round.blind, bossId: round.bossId });
    core.eachTag('onRoundEnd');
    const rewards = this.computeRewards();
    s.rewards = rewards;
    core.emit({ type: 'roundRewards', ...rewards });

    // nálepky a statistiky žolíků
    for (const j of s.jokers) {
      s.stats.jokerRoundCounts[j.defId] = (s.stats.jokerRoundCounts[j.defId] ?? 0) + 1;
      if (j.stickers.includes('perishable') && j.perishRounds !== undefined && j.perishRounds > 0) {
        j.perishRounds--;
        if (j.perishRounds === 0) j.debuffed = true;
      }
    }
    for (const c of s.deck) {
      c.debuffed = false;
      c.faceDown = false;
    }
    core.invalidate();
    if (round.blind === 'boss' && s.ante === FINAL_ANTE && !s.endless) {
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
    core.emit({ type: 'gameOver', info: s.gameOver });
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
    core.eachTag('onShopEnter');
    s.shop = generateShop(core);
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
      const extra = item.joker.edition ? (core.registry.editions[item.joker.edition]?.extraSlots ?? 0) : 0;
      if (s.jokers.length >= core.mods().jokerSlots + extra) fail('slotsFull');
      this.pay(item.price);
      item.sold = true;
      addJokerInstance(core, item.joker, true);
      s.stats.jokersBought++;
      core.emit({ type: 'itemBought', kind: 'joker', defId: item.joker.defId, price: item.price });
    } else if (item.kind === 'consumable') {
      if (use) {
        if (!this.consumableUsable(item.consumable.defId, item.consumable.uid, targetIds ?? [])) fail('cannotUse');
        this.pay(item.price);
        item.sold = true;
        core.emit({ type: 'itemBought', kind: 'consumable', defId: item.consumable.defId, price: item.price });
        this.runConsumable(item.consumable, targetIds ?? []);
      } else {
        const extra = item.consumable.edition ? (core.registry.editions[item.consumable.edition]?.extraSlots ?? 0) : 0;
        if (s.consumables.length >= core.mods().consumableSlots + extra) fail('slotsFull');
        this.pay(item.price);
        item.sold = true;
        addConsumableInstance(core, item.consumable, true);
        core.emit({ type: 'itemBought', kind: 'consumable', defId: item.consumable.defId, price: item.price });
      }
    } else {
      if (use) fail('cannotUse');
      this.pay(item.price);
      item.sold = true;
      const c = item.card;
      core.api.addCard(
        { suit: c.suit, rank: c.rank, enhancement: c.enhancement, seal: c.seal, edition: c.edition, bonusChips: c.bonusChips },
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

  /** Otevře booster (z obchodu nebo ze štítku). Používá se i z obsahu přes flags. */
  startBooster(boosterId: string, returnTo: 'shop' | 'blind_select'): void {
    const core = this.core;
    const s = core.state;
    s.booster = openBooster(core, boosterId, returnTo);
    s.phase = 'booster';
    core.emit({ type: 'boosterOpened', boosterId });
    core.eachJoker('onBoosterOpened', { boosterId });
  }

  private buyVoucher(slot: number): void {
    this.requirePhase('shop');
    const core = this.core;
    const v = this.shop().vouchers[slot];
    if (!v) fail('unknownItem');
    if (v.sold) fail('soldOut');
    this.pay(v.price);
    v.sold = true;
    core.emit({ type: 'itemBought', kind: 'voucher', defId: v.voucherId, price: v.price });
    this.redeemVoucher(v.voucherId);
  }

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
    core.emit({ type: 'voucherRedeemed', voucherId: id });
  }

  private reroll(): void {
    this.requirePhase('shop');
    const core = this.core;
    const s = core.state;
    const shop = this.shop();
    if (shop.freeRerolls > 0) {
      shop.freeRerolls--;
    } else {
      this.pay(shop.rerollCost);
      shop.rerollCost += core.mods().rerollCostStep;
    }
    const cost = shop.rerollCost;
    shop.rerollsThisShop++;
    s.stats.rerolls++;
    shop.items = generateShopItems(core);
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

  private pickBooster(index: number, targetIds: readonly number[] | undefined): void {
    this.requirePhase('booster');
    const core = this.core;
    const s = core.state;
    const b = s.booster;
    if (!b) fail('wrongPhase');
    const opt = b.options[index];
    if (!opt) fail('unknownItem');
    if (opt.kind === 'joker') {
      const extra = opt.joker.edition ? (core.registry.editions[opt.joker.edition]?.extraSlots ?? 0) : 0;
      if (s.jokers.length >= core.mods().jokerSlots + extra) fail('slotsFull');
      addJokerInstance(core, opt.joker, true);
    } else if (opt.kind === 'card') {
      const c = opt.card;
      core.api.addCard(
        { suit: c.suit, rank: c.rank, enhancement: c.enhancement, seal: c.seal, edition: c.edition, bonusChips: c.bonusChips },
        { source: 'booster' },
      );
    } else {
      // Spotřebky z boosteru se použijí hned.
      if (!this.consumableUsable(opt.consumable.defId, opt.consumable.uid, targetIds ?? [])) fail('cannotUse');
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
    const price = core.api.sellValue(j);
    core.eachJoker('onSell', { sold: j, isSelf: false });
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
    const price = Math.max(1, Math.floor(consumablePrice(core, c.defId) / 2));
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

  private consumableCtx(defId: string, uid: number, targetIds: readonly number[]): ConsumableCtx {
    const core = this.core;
    const targets = targetIds.map((id) => core.mustCard(id));
    return extend(core.baseCtx('consumable'), { self: { uid, defId, edition: null }, targets });
  }

  private consumableUsable(defId: string, uid: number, targetIds: readonly number[]): boolean {
    const def = this.core.registry.consumables[defId];
    if (!def) return false;
    const pool = this.targetPool();
    if (new Set(targetIds).size !== targetIds.length) return false;
    for (const id of targetIds) if (!pool.includes(id)) return false;
    if (def.target) {
      if (targetIds.length < def.target.min || targetIds.length > def.target.max) return false;
    } else if (targetIds.length > 0) {
      return false;
    }
    return def.canUse ? def.canUse(this.consumableCtx(defId, uid, targetIds)) : true;
  }

  private runConsumable(inst: { uid: number; defId: string; edition: string | null }, targetIds: readonly number[]): void {
    const core = this.core;
    const s = core.state;
    const def = core.registry.consumables[inst.defId]!;
    const ctx = extend(core.baseCtx('consumable'), {
      self: inst,
      targets: targetIds.map((id) => core.mustCard(id)),
    });
    def.use(ctx);
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
    if (!this.consumableUsable(c.defId, c.uid, targetIds)) fail('cannotUse');
    s.consumables = s.consumables.filter((x) => x !== c);
    this.core.invalidate();
    this.runConsumable(c, targetIds);
  }

  private reorderJokers(uids: readonly number[]): void {
    const s = this.core.state;
    if (uids.length !== s.jokers.length || new Set(uids).size !== uids.length) fail('invalidSelection');
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
