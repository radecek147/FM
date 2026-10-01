/**
 * Skórovací pipeline. Pořadí (závazné, viz docs/ARCHITECTURE.md 2.5):
 *  0. žolíci `beforeScoring` (mohou např. zvýšit úroveň kombinace),
 *  1. základ kombinace (čipy + mult podle úrovně, případně upravený šéfem) + výsledky beforeScoring,
 *  2. skórující karty zleva doprava: čipy karty → vylepšení → edice → pečeť → žolíci `onCardScored`;
 *     opakované aktivace zopakují celou sekvenci,
 *  3. karty v ruce: vylepšení `onHeld` → žolíci `onCardHeld` (s opakováním),
 *  4. žolíci zleva doprava: edice „before“ → `onHandPlayed` → edice „after“,
 *  5. skóre = floor(čipy × mult), pak `afterHandScored`, zničení karet.
 */
import type { CardCtx, EffectResult, ScoringInfo } from '../content-types';
import { cardChips } from '../cards/cards';
import type { GameCore } from '../effects/core';
import { extend, toResults } from '../effects/core';
import { detectHand } from '../hands/detect';
import { handValueAtLevel } from '../hands/levels';
import type { Card, DetectedHand, HandPreview, ScoreResult, ScoreStep } from '../types';

interface Acc {
  chips: number;
  mult: number;
  steps: ScoreStep[];
  money: number;
  destroy: Set<number>;
}

type StepMeta = Pick<ScoreStep, 'source' | 'defId' | 'cardId' | 'jokerUid'>;

/** Bezpečné násobení (nekonečno → největší číslo, NaN → 0). */
function safe(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return Number.MAX_VALUE;
  if (n === -Infinity) return -Number.MAX_VALUE;
  return n;
}

function applyResult(core: GameCore, acc: Acc, res: EffectResult, meta: StepMeta, cardId?: number): void {
  const step: ScoreStep = { ...meta, chipsAfter: acc.chips, multAfter: acc.mult };
  let any = false;
  if (res.chips) {
    acc.chips = safe(acc.chips + res.chips);
    step.chips = res.chips;
    any = true;
  }
  if (res.mult) {
    acc.mult = safe(acc.mult + res.mult);
    step.mult = res.mult;
    any = true;
  }
  if (res.xmult !== undefined && res.xmult !== 1) {
    acc.mult = safe(acc.mult * res.xmult);
    step.xmult = res.xmult;
    any = true;
  }
  if (res.money) {
    core.api.addMoney(res.money, 'score');
    acc.money += res.money;
    step.money = res.money;
    any = true;
  }
  if (res.message) {
    step.message = res.message;
    any = true;
  }
  if (res.destroyCard && cardId !== undefined) acc.destroy.add(cardId);
  if (!any) return;
  step.chipsAfter = acc.chips;
  step.multAfter = acc.mult;
  acc.steps.push(step);
}

function applyAll(core: GameCore, acc: Acc, results: EffectResult[], meta: StepMeta, cardId?: number): boolean {
  for (const r of results) applyResult(core, acc, r, meta, cardId);
  return results.length > 0;
}

/** Detekce kombinace pro dané karty s aktuálními modifikátory. */
export function detectFor(core: GameCore, cards: readonly Card[]): DetectedHand | null {
  return detectHand(cards, { mods: core.mods(), enhancements: core.registry.enhancements });
}

/** Živý náhled „čipy × mult“ pro vybrané karty (bez náhody a bez efektů). */
export function previewHand(core: GameCore, cardIds: readonly number[]): HandPreview {
  const cards = cardIds.map((id) => core.card(id)).filter((c): c is Card => c !== undefined);
  const hand = detectFor(core, cards);
  if (!hand) return { hand: null, chips: 0, mult: 0, level: 0 };
  const def = core.registry.handTypes[hand.type];
  const level = core.state.handLevels[hand.type]?.level ?? 1;
  let { chips, mult } = handValueAtLevel(def, level);
  const boss = core.activeBoss();
  if (boss?.hooks.modifyBase && core.state.round) {
    const info = makeInfo(core, hand, cards, { chips, mult });
    ({ chips, mult } = boss.hooks.modifyBase(extend(core.bossCtx(), info), { chips, mult }));
  }
  return { hand, chips, mult, level };
}

function makeInfo(core: GameCore, hand: DetectedHand, played: readonly Card[], acc: { chips: number; mult: number }): ScoringInfo {
  const round = core.state.round!;
  const scoringSet = new Set(hand.scoringIds);
  const playedIds = new Set(played.map((c) => c.id));
  const scoring = played.filter((c) => scoringSet.has(c.id));
  const held = round.hand.filter((id) => !playedIds.has(id)).map((id) => core.mustCard(id));
  return {
    hand,
    played,
    scoring,
    held,
    get chips() {
      return acc.chips;
    },
    get mult() {
      return acc.mult;
    },
    round,
    firstHand: round.handsPlayed === 0,
    lastHand: round.handsLeft <= 1,
  };
}

/**
 * Vyhodnotí zahranou ruku. Předpoklad: karty jsou ještě v `round.hand` (run loop je přesune až potom),
 * `round.handsLeft` ještě nebyl snížen.
 */
export function scoreHand(core: GameCore, playedIds: readonly number[]): ScoreResult {
  const reg = core.registry;
  const played = playedIds.map((id) => core.mustCard(id));
  const hand = detectFor(core, played);
  if (!hand) throw new Error('scoreHand: no cards');
  const acc: Acc = { chips: 0, mult: 0, steps: [], money: 0, destroy: new Set() };
  const info = makeInfo(core, hand, played, acc);
  const result = (blockedReason: string | null): ScoreResult => ({
    hand,
    playedIds: [...playedIds],
    steps: acc.steps,
    chips: acc.chips,
    mult: acc.mult,
    score: blockedReason ? 0 : Math.floor(safe(acc.chips * acc.mult)),
    blockedReason,
    destroyedCardIds: [...acc.destroy],
    moneyEarned: acc.money,
  });

  // Šéf může ruku zakázat (ruka se spotřebuje, neskóruje).
  const boss = core.activeBoss();
  if (boss?.hooks.validateHand) {
    const reason = boss.hooks.validateHand(extend(core.bossCtx(), info));
    if (reason) {
      acc.steps.push({ source: 'boss', defId: boss.id, message: reason, chipsAfter: 0, multAfter: 0 });
      return result(reason);
    }
  }

  // 0. beforeScoring — výsledky se aplikují až po základu.
  const before: { results: EffectResult[]; uid: number; defId: string }[] = [];
  core.eachJoker('beforeScoring', withInfo(info, {}), (results, owner) => {
    if (results.length) before.push({ results, uid: owner.uid, defId: owner.defId });
  });

  // 1. základ kombinace
  const def = reg.handTypes[hand.type];
  const level = core.state.handLevels[hand.type]?.level ?? 1;
  let base = handValueAtLevel(def, level);
  if (boss?.hooks.modifyBase) base = boss.hooks.modifyBase(extend(core.bossCtx(), info), base);
  acc.chips = base.chips;
  acc.mult = base.mult;
  acc.steps.push({
    source: 'hand',
    defId: hand.type,
    chips: base.chips,
    mult: base.mult,
    chipsAfter: acc.chips,
    multAfter: acc.mult,
  });
  for (const b of before) applyAll(core, acc, b.results, { source: 'joker', jokerUid: b.uid, defId: b.defId });

  // 2. skórující karty
  for (const card of info.scoring) {
    if (card.debuffed) {
      acc.steps.push({ source: 'card', cardId: card.id, message: 'score.debuffed', chipsAfter: acc.chips, multAfter: acc.mult });
      continue;
    }
    const enhDef = card.enhancement ? reg.enhancements[card.enhancement] : undefined;
    const sealDef = card.seal ? reg.seals[card.seal] : undefined;
    const edDef = card.edition ? reg.editions[card.edition] : undefined;
    const cardCtx = (): CardCtx => extend(core.baseCtx('card'), info, { card });
    const extra = (sealDef?.retriggers ?? 0) + core.sumJokers('retriggerScored', withInfo(info, { card, isRetrigger: false }));
    const activations = 1 + Math.max(0, Math.floor(extra));
    for (let a = 0; a < activations; a++) {
      const meta: StepMeta = { source: 'card', cardId: card.id };
      if (a > 0) acc.steps.push({ ...meta, message: 'score.again', chipsAfter: acc.chips, multAfter: acc.mult });
      const chips = cardChips(card, reg.enhancements);
      if (chips) applyResult(core, acc, { chips }, meta, card.id);
      if (enhDef?.onScored) applyAll(core, acc, toResults(enhDef.onScored(cardCtx())), meta, card.id);
      if (edDef?.effect) applyResult(core, acc, edDef.effect(), meta, card.id);
      if (sealDef?.onScored) applyAll(core, acc, toResults(sealDef.onScored(cardCtx())), meta, card.id);
      core.eachJoker('onCardScored', withInfo(info, { card, isRetrigger: a > 0 }), (results, owner) => {
        applyAll(core, acc, results, { source: 'joker', jokerUid: owner.uid, defId: owner.defId, cardId: card.id }, card.id);
      });
    }
    if (enhDef?.afterScored) applyAll(core, acc, toResults(enhDef.afterScored(cardCtx())), { source: 'card', cardId: card.id }, card.id);
  }

  // 3. karty držené v ruce
  for (const card of info.held) {
    if (card.debuffed) continue;
    const enhDef = card.enhancement ? reg.enhancements[card.enhancement] : undefined;
    const sealDef = card.seal ? reg.seals[card.seal] : undefined;
    const cardCtx = (): CardCtx => extend(core.baseCtx('card'), info, { card });
    const extra = (sealDef?.retriggers ?? 0) + core.sumJokers('retriggerHeld', withInfo(info, { card, isRetrigger: false }));
    const activations = 1 + Math.max(0, Math.floor(extra));
    for (let a = 0; a < activations; a++) {
      const meta: StepMeta = { source: 'held', cardId: card.id };
      const startLen = acc.steps.length;
      if (a > 0) acc.steps.push({ ...meta, message: 'score.again', chipsAfter: acc.chips, multAfter: acc.mult });
      let any = false;
      if (enhDef?.onHeld) any = applyAll(core, acc, toResults(enhDef.onHeld(cardCtx())), meta, card.id) || any;
      core.eachJoker('onCardHeld', withInfo(info, { card, isRetrigger: a > 0 }), (results, owner) => {
        if (applyAll(core, acc, results, { source: 'joker', jokerUid: owner.uid, defId: owner.defId, cardId: card.id }, card.id)) any = true;
      });
      if (!any) {
        // Karta v ruce nic nedělá → žádné opakování.
        acc.steps.length = startLen;
        break;
      }
    }
  }

  // 4. žolíci
  const jokers = [...core.state.jokers];
  jokers.forEach((owner, index) => {
    if (owner.debuffed) return;
    const meta: StepMeta = { source: 'joker', jokerUid: owner.uid, defId: owner.defId };
    const ed = owner.edition ? reg.editions[owner.edition] : undefined;
    if (ed?.effect && ed.jokerTiming !== 'after') applyResult(core, acc, ed.effect(), meta);
    const resolved = core.resolveCopy(owner, index);
    if (resolved?.def.hooks.onHandPlayed) {
      const ctx = extend(core.jokerCtx(resolved.target, index, resolved.isCopy, resolved.def), info);
      applyAll(core, acc, toResults(resolved.def.hooks.onHandPlayed(ctx)), meta);
    }
    if (ed?.effect && ed.jokerTiming === 'after') applyResult(core, acc, ed.effect(), meta);
  });
  core.invalidate();

  const res = result(null);

  // 5. po skórování
  core.eachJoker('afterHandScored', withInfo(info, { score: res.score }));
  return res;
}

/** Kontext = ScoringInfo (s živými gettery chips/mult) + další pole. */
function withInfo(info: ScoringInfo, more: Record<string, unknown>): Record<string, unknown> {
  return extend({} as Record<string, unknown>, info, more);
}
