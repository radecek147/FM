/**
 * Skórovací pipeline. Pořadí (závazné, viz docs/ARCHITECTURE.md 2.5 a docs/DESIGN.md kap. 3.1):
 *  0. šéf `validateHand` (zákaz ruky), žolíci `beforeScoring` (mohou např. zvýšit úroveň kombinace),
 *  1. základ kombinace (čipy + mult podle úrovně, případně upravený šéfem) + výsledky beforeScoring,
 *  2. skórující karty zleva doprava: čipy karty → vylepšení → edice → pečeť → žolíci `onCardScored`;
 *     opakované aktivace (max. `MAX_ACTIVATIONS_PER_CARD`) zopakují celou sekvenci; ×mult dají jen první
 *     `MAX_XMULT_ACTIVATIONS_PER_CARD` aktivace karty (další opakování jen čipy, +mult a peníze),
 *  3. karty v ruce: vylepšení `onHeld` → žolíci `onCardHeld` (s opakováním, ×mult stejně omezený),
 *  4. žolíci zleva doprava: edice „before“ → `onHandPlayed` → edice „after“,
 *  5. skóre = floor(čipy × mult), šéf `adjustHandScore`, žolíci `afterHandScored`;
 *     run loop pak volá šéfa `afterHandPlayed` a `afterScoredCards` (hod skla, Ohmataná) a ničí karty.
 */
import type { BossCtx, EffectResult, JokerScoringCtx, ScoringInfo } from '../content-types';
import { cardChips } from '../cards/cards';
import { MAX_ACTIVATIONS_PER_CARD, MAX_XMULT_ACTIVATIONS_PER_CARD, MSG } from '../constants';
import type { CtxLayer, GameCore } from '../effects/core';
import { toResults } from '../effects/core';
import { compareHandTypes, detectHand } from '../hands/detect';
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

/** Příznaky ruky pro `ScoringInfo` (první/poslední ruka kola). */
export interface HandFlags {
  firstHand: boolean;
  lastHand: boolean;
}

/** Bezpečné číslo (nekonečno → největší číslo, NaN → 0). Skóre i stav musí zůstat konečné (JSON). */
export function safe(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return Number.MAX_VALUE;
  if (n === -Infinity) return -Number.MAX_VALUE;
  return n;
}

/** Počet aktivací karty: 1 + opakování, nejvýš `MAX_ACTIVATIONS_PER_CARD`. */
export function activationCount(extra: number): number {
  const n = 1 + Math.max(0, Math.floor(Number.isFinite(extra) ? extra : 0));
  return Math.min(MAX_ACTIVATIONS_PER_CARD, n);
}

/**
 * Smí aktivace karty s pořadím `activation` (0 = první) ještě násobit mult? Jen prvních
 * `MAX_XMULT_ACTIVATIONS_PER_CARD` aktivací — další opakování (Dechovka, Ozvěna, Šťastná sedmička) dají čipy, +mult
 * a peníze, ale ×mult ne.
 */
export function xmultAllowed(activation: number): boolean {
  return activation < MAX_XMULT_ACTIVATIONS_PER_CARD;
}

/** Výsledky efektu karty bez ×mult (pro aktivace nad `MAX_XMULT_ACTIVATIONS_PER_CARD`). */
function withoutXmult(results: EffectResult[]): EffectResult[] {
  return results
    .map((r) => (r.xmult === undefined ? r : { ...r, xmult: undefined }))
    .filter((r) => r.chips || r.mult || r.money || r.message || r.destroyCard);
}

/** Použitelné číslo efektu (ne NaN; nekonečno ořízne `safe`). */
function isNum(n: unknown): n is number {
  return typeof n === 'number' && !Number.isNaN(n);
}

/**
 * Aplikuje výsledek efektu v pořadí čipy → mult → ×mult → peníze (DESIGN 3.1). Každá změna je **samostatný**
 * `ScoreStep` s průběžnými hodnotami (UI je přehrává jako „tik tik tik“); zpráva efektu patří k jeho prvnímu kroku,
 * efekt jen se zprávou dá krok bez změny. Neplatné hodnoty (NaN, nekonečné peníze) se ignorují.
 */
function applyResult(core: GameCore, acc: Acc, res: EffectResult, meta: StepMeta, cardId?: number): void {
  if (res.destroyCard && cardId !== undefined) acc.destroy.add(cardId);
  let message = res.message;
  const push = (change: Partial<ScoreStep>): void => {
    const step: ScoreStep = { ...meta, ...change, chipsAfter: acc.chips, multAfter: acc.mult };
    if (message) {
      step.message = message;
      message = undefined;
    }
    acc.steps.push(step);
  };
  if (isNum(res.chips) && res.chips !== 0) {
    acc.chips = safe(acc.chips + res.chips);
    push({ chips: res.chips });
  }
  if (isNum(res.mult) && res.mult !== 0) {
    acc.mult = safe(acc.mult + res.mult);
    push({ mult: res.mult });
  }
  if (isNum(res.xmult) && res.xmult !== 1) {
    acc.mult = safe(acc.mult * res.xmult);
    push({ xmult: res.xmult });
  }
  if (typeof res.money === 'number' && Number.isFinite(res.money) && res.money !== 0) {
    // Zapíše se skutečně připsaná částka (srážku ořízne dluhový limit, DESIGN 2.4.3).
    const before = core.state.money;
    core.api.addMoney(res.money, 'score');
    const delta = core.state.money - before;
    if (delta !== 0) {
      acc.money += delta;
      push({ money: delta });
    }
  }
  if (message) push({});
}

function applyAll(
  core: GameCore,
  acc: Acc,
  results: EffectResult[],
  meta: StepMeta,
  cardId?: number,
): boolean {
  for (const r of results) applyResult(core, acc, r, meta, cardId);
  return results.length > 0;
}

/**
 * Výsledek `BossHooks.modifyBase`: neplatné číslo (NaN, chybějící pole) = původní hodnota, nekonečno se ořízne
 * (`safe`). Jinak by NaN otrávilo všechny další kroky skórování.
 */
function bossBase(
  out: { chips: number; mult: number } | null | undefined,
  base: { chips: number; mult: number },
): { chips: number; mult: number } {
  return {
    chips: isNum(out?.chips) ? safe(out.chips) : base.chips,
    mult: isNum(out?.mult) ? safe(out.mult) : base.mult,
  };
}

/** Detekce kombinace pro dané karty s aktuálními modifikátory (a platnými vylepšeními). */
export function detectFor(core: GameCore, cards: readonly Card[]): DetectedHand | null {
  return detectHand(cards, { mods: core.mods(), enhancements: core.enhancements() });
}

/**
 * Pravidlo výzvy „silnější kombinace neskórují“ (`ChallengeDef.maxScoringHand`, Švejkova anabáze): i18n klíč důvodu,
 * když je kombinace silnější než povolená, jinak null. Čistá funkce (náhled i skórování).
 */
export function challengeBlockedReason(core: GameCore, hand: DetectedHand): string | null {
  const max = core.challenge()?.maxScoringHand;
  return max && compareHandTypes(hand.type, max) > 0 ? MSG.challengeHandTooStrong : null;
}

/**
 * Živý náhled „čipy × mult“ pro vybrané karty (bez náhody a bez efektů). Obsahuje-li výběr kartu lícem
 * dolů, náhled se nepočítá (`hidden`).
 */
export function previewHand(core: GameCore, cardIds: readonly number[]): HandPreview {
  const cards = cardIds.map((id) => core.card(id)).filter((c): c is Card => c !== undefined);
  if (cards.some((c) => c.faceDown)) return { hand: null, chips: 0, mult: 0, level: 0, hidden: true };
  const hand = detectFor(core, cards);
  if (!hand) return { hand: null, chips: 0, mult: 0, level: 0, hidden: false };
  const def = core.registry.handTypes[hand.type];
  const level = core.state.handLevels[hand.type]?.level ?? 1;
  let { chips, mult } = handValueAtLevel(def, level);
  const boss = core.activeBoss();
  const modifyBase = boss?.hooks.modifyBase;
  const validateHand = boss?.hooks.validateHand;
  // Pravidlo výzvy má přednost před šéfem (ruka by se zakázala dřív, než se šéf zeptá).
  let blockedReason: string | null = challengeBlockedReason(core, hand);
  if ((modifyBase || validateHand) && core.state.round) {
    const layer = core.ctxLayer(makeInfo(core, hand, cards, { chips, mult }));
    const base = { chips, mult };
    // Náhled je dotaz UI: šéf v něm nesmí posunout RNG (jinak by run závisel na tom, kolikrát se UI zeptá).
    if (validateHand && !blockedReason)
      blockedReason = core.readOnly(() => validateHand(bossScoringCtx(core, layer))) ?? null;
    if (modifyBase)
      ({ chips, mult } = core.readOnly(() => bossBase(modifyBase(bossScoringCtx(core, layer), base), base)));
  }
  return blockedReason
    ? { hand, chips, mult, level, hidden: false, blockedReason }
    : { hand, chips, mult, level, hidden: false };
}

function makeInfo(
  core: GameCore,
  hand: DetectedHand,
  played: readonly Card[],
  acc: { chips: number; mult: number },
  flags?: HandFlags,
): ScoringInfo {
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
    firstHand: flags?.firstHand ?? round.handsPlayed === 0,
    lastHand: flags?.lastHand ?? round.handsLeft <= 1,
  };
}

/**
 * Vyhodnotí zahranou ruku (kroky 0–5 až po `afterHandScored`). Předpoklad: karty jsou ještě v `round.hand`
 * (run loop je přesune až potom), `round.handsLeft` ještě nebyl snížen.
 */
export function scoreHand(core: GameCore, playedIds: readonly number[]): ScoreResult {
  const reg = core.registry;
  const played = playedIds.map((id) => core.mustCard(id));
  const hand = detectFor(core, played);
  if (!hand) throw new Error('scoreHand: no cards');
  const acc: Acc = { chips: 0, mult: 0, steps: [], money: 0, destroy: new Set() };
  const info = makeInfo(core, hand, played, acc);
  // Sdílená vrstva kontextů: každý hook této ruky ji zdědí (gettery chips/mult zůstávají živé) — bez kopírování.
  const layer = core.ctxLayer(info);
  const result = (blockedReason: string | null, score: number): ScoreResult => ({
    hand,
    playedIds: [...playedIds],
    steps: acc.steps,
    chips: acc.chips,
    mult: acc.mult,
    score: blockedReason ? 0 : score,
    blockedReason,
    destroyedCardIds: [...acc.destroy],
    moneyEarned: acc.money,
  });

  // Výzva může ruku zakázat (Švejkova anabáze) — ruka se spotřebuje a neskóruje, stejně jako u šéfa.
  const challengeReason = challengeBlockedReason(core, hand);
  if (challengeReason) {
    const challengeId = core.state.challengeId ?? undefined;
    acc.steps.push({
      source: 'challenge',
      ...(challengeId ? { defId: challengeId } : {}),
      message: challengeReason,
      chipsAfter: 0,
      multAfter: 0,
    });
    return result(challengeReason, 0);
  }

  // Šéf může ruku zakázat (ruka se spotřebuje, neskóruje).
  const boss = core.activeBoss();
  if (boss?.hooks.validateHand) {
    const reason = boss.hooks.validateHand(bossScoringCtx(core, layer));
    if (reason) {
      acc.steps.push({ source: 'boss', defId: boss.id, message: reason, chipsAfter: 0, multAfter: 0 });
      return result(reason, 0);
    }
  }

  // 0. beforeScoring — výsledky se aplikují až po základu.
  const before: { results: EffectResult[]; uid: number; defId: string }[] = [];
  core.eachJoker(
    'beforeScoring',
    {},
    (results, owner) => {
      if (results.length) before.push({ results, uid: owner.uid, defId: owner.defId });
    },
    layer,
  );

  // 1. základ kombinace
  const def = reg.handTypes[hand.type];
  const level = core.state.handLevels[hand.type]?.level ?? 1;
  let base = handValueAtLevel(def, level);
  // Šéf se ověřuje znovu — žolík ho mohl v beforeScoring vypnout.
  const baseBoss = core.activeBoss();
  if (baseBoss?.hooks.modifyBase)
    base = bossBase(baseBoss.hooks.modifyBase(bossScoringCtx(core, layer), base), base);
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
  for (const b of before)
    applyAll(core, acc, b.results, { source: 'joker', jokerUid: b.uid, defId: b.defId });

  // Vylepšení, která v tomto kole platí (Bílá hora je vypne).
  const enh = core.enhancements();

  // 2. skórující karty
  for (const card of info.scoring) {
    if (card.debuffed) {
      acc.steps.push({
        source: 'card',
        cardId: card.id,
        message: MSG.debuffed,
        chipsAfter: acc.chips,
        multAfter: acc.mult,
      });
      continue;
    }
    const enhDef = card.enhancement ? enh[card.enhancement] : undefined;
    const sealDef = card.seal ? reg.seals[card.seal] : undefined;
    const edDef = card.edition ? reg.editions[card.edition] : undefined;
    const activations = activationCount(
      (sealDef?.retriggers ?? 0) + core.sumJokers('retriggerScored', { card, isRetrigger: false }, layer),
    );
    for (let a = 0; a < activations; a++) {
      const meta: StepMeta = { source: 'card', cardId: card.id };
      if (a > 0) acc.steps.push({ ...meta, message: MSG.again, chipsAfter: acc.chips, multAfter: acc.mult });
      // Opakování nad strop ×mult: efekty karty i žolíků dají jen čipy, +mult a peníze.
      const cap = xmultAllowed(a) ? (r: EffectResult[]) => r : withoutXmult;
      const chips = cardChips(card, enh, core.mods());
      if (chips) applyResult(core, acc, { chips }, meta, card.id);
      if (enhDef?.onScored)
        applyAll(core, acc, cap(toResults(enhDef.onScored(core.cardCtx(card, layer)))), meta, card.id);
      if (edDef?.effect) applyAll(core, acc, cap([edDef.effect()]), meta, card.id);
      if (sealDef?.onScored)
        applyAll(core, acc, cap(toResults(sealDef.onScored(core.cardCtx(card, layer)))), meta, card.id);
      core.eachJoker(
        'onCardScored',
        { card, isRetrigger: a > 0 },
        (results, owner) => {
          applyAll(
            core,
            acc,
            cap(results),
            { source: 'joker', jokerUid: owner.uid, defId: owner.defId, cardId: card.id },
            card.id,
          );
        },
        layer,
      );
    }
  }

  // 3. karty držené v ruce
  for (const card of info.held) {
    if (card.debuffed) continue;
    const enhDef = card.enhancement ? enh[card.enhancement] : undefined;
    const sealDef = card.seal ? reg.seals[card.seal] : undefined;
    const activations = activationCount(
      (sealDef?.retriggers ?? 0) + core.sumJokers('retriggerHeld', { card, isRetrigger: false }, layer),
    );
    for (let a = 0; a < activations; a++) {
      const meta: StepMeta = { source: 'held', cardId: card.id };
      const startLen = acc.steps.length;
      if (a > 0) acc.steps.push({ ...meta, message: MSG.again, chipsAfter: acc.chips, multAfter: acc.mult });
      const cap = xmultAllowed(a) ? (r: EffectResult[]) => r : withoutXmult;
      let any = false;
      // Bez `cardId`: `destroyCard` platí jen pro efekty skórující karty (EffectResult), ne pro kartu v ruce.
      if (enhDef?.onHeld)
        any = applyAll(core, acc, cap(toResults(enhDef.onHeld(core.cardCtx(card, layer)))), meta) || any;
      core.eachJoker(
        'onCardHeld',
        { card, isRetrigger: a > 0 },
        (results, owner) => {
          const jokerMeta: StepMeta = {
            source: 'joker',
            jokerUid: owner.uid,
            defId: owner.defId,
            cardId: card.id,
          };
          if (applyAll(core, acc, cap(results), jokerMeta)) any = true;
        },
        layer,
      );
      if (!any) {
        // Karta v ruce nic nedělá → žádné opakování.
        acc.steps.length = startLen;
        break;
      }
    }
  }

  // 4. žolíci
  const jokers = [...core.state.jokers];
  jokers.forEach((owner) => {
    // Aktuální pozice: žolík zničený dřív v kroku 4 posune ostatní doleva (kopírující „souseda“ musí vidět skutečnou).
    const index = core.state.jokers.indexOf(owner);
    // Debuffnutý nebo během kroku 4 zničený žolík (efekt jiného žolíka) nic nedává.
    if (owner.debuffed || index < 0) return;
    const meta: StepMeta = { source: 'joker', jokerUid: owner.uid, defId: owner.defId };
    const ed = owner.edition ? reg.editions[owner.edition] : undefined;
    if (ed?.effect && ed.jokerTiming !== 'after') applyResult(core, acc, ed.effect(), meta);
    const resolved = core.resolveCopy(owner, index);
    if (resolved?.def.hooks.onHandPlayed) {
      const ctx = core.jokerCtx(
        resolved.target,
        index,
        resolved.isCopy,
        resolved.def,
        layer,
      ) as JokerScoringCtx;
      const results = toResults(resolved.def.hooks.onHandPlayed(ctx));
      // Hook mohl změnit stav, na kterém závisí `passive` (další žolíci čtou aktuální modifikátory).
      core.invalidate();
      applyAll(core, acc, results, meta);
    }
    if (ed?.effect && ed.jokerTiming === 'after') applyResult(core, acc, ed.effect(), meta);
  });
  core.invalidate();

  // 5. výsledek (+ úprava šéfem), pak afterHandScored
  let score = Math.floor(safe(acc.chips * acc.mult));
  const bossNow = core.activeBoss();
  if (bossNow?.hooks.adjustHandScore) {
    const raw = bossNow.hooks.adjustHandScore(bossScoringCtx(core, layer), score);
    const adjusted = Number.isNaN(raw) ? 0 : Math.max(0, Math.floor(safe(raw)));
    if (adjusted !== score) {
      acc.steps.push({
        source: 'boss',
        defId: bossNow.id,
        message: MSG.bossAdjusted,
        chipsAfter: acc.chips,
        multAfter: acc.mult,
      });
      score = adjusted;
    }
  }
  const res = result(null, score);
  core.eachJoker('afterHandScored', { score: res.score }, undefined, layer);
  return res;
}

/**
 * Konec kroku 5 (po šéfovi `afterHandPlayed`): `afterScored` vylepšení každé skórující, nedebuffnuté karty —
 * **jednou za ruku**, i když se karta aktivovala vícekrát (hod skla, Ohmataná +3 čipy). Z výsledků se použije
 * jen zpráva, peníze a `destroyCard`; kroky a karty ke zničení se doplní do `result`. Zakázaná ruka nic nespustí.
 */
export function afterScoredCards(core: GameCore, result: ScoreResult, flags: HandFlags): void {
  if (result.blockedReason || !core.state.round) return;
  const enh = core.enhancements();
  const played = result.playedIds.map((id) => core.card(id)).filter((c): c is Card => c !== undefined);
  const acc: Acc = {
    chips: result.chips,
    mult: result.mult,
    steps: result.steps,
    money: result.moneyEarned,
    destroy: new Set(result.destroyedCardIds),
  };
  const info = makeInfo(core, result.hand, played, acc, flags);
  const layer = core.ctxLayer(info);
  for (const card of info.scoring) {
    if (card.debuffed) continue;
    const def = card.enhancement ? enh[card.enhancement] : undefined;
    if (!def?.afterScored) continue;
    const results = toResults(def.afterScored(core.cardCtx(card, layer)));
    for (const r of results) {
      const limited: EffectResult = { message: r.message, money: r.money, destroyCard: r.destroyCard };
      applyResult(core, acc, limited, { source: 'card', cardId: card.id }, card.id);
    }
  }
  result.destroyedCardIds = [...acc.destroy];
  result.moneyEarned = acc.money;
}

/** Kontext šéfa ve skórování: `BossCtx` + ScoringInfo ruky (zděděná z vrstvy). */
function bossScoringCtx(core: GameCore, layer: CtxLayer & ScoringInfo): BossCtx & ScoringInfo {
  return core.bossCtx(layer) as BossCtx & ScoringInfo;
}
