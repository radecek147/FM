/** Implementace EngineApi — příkazy a dotazy, které smí volat obsah (hooky). */
import type { CardSpec, CreateJokerOptions, EngineApi } from '../content-types';
import { MSG, PERISH_ROUNDS } from '../constants';
import { cardChips, cardHasSuit, createCard, hasNoRankSuit, isFaceCard } from '../cards/cards';
import { handValueAtLevel } from '../hands/levels';
import { rerollBossSlot, revalidateBoss } from '../run/bosses';
import { drawCards, bossDebuffs, refreshDebuffs } from '../run/draw';
import {
  availableJokerIds,
  consumableInRun,
  pickConsumableDefId,
  pickJokerDefId,
  stickerAllowed,
} from '../shop/pool';
import { addShopJoker, addShopVoucher, boosterInRun, setShopJokerEdition } from '../shop/shop';
import { jokerSellValue } from '../shop/prices';
import type {
  Card,
  ConsumableInstance,
  ConsumableKind,
  EditionId,
  HandType,
  InstanceState,
  JokerInstance,
} from '../types';
import { HAND_TYPES } from '../types';
import type { GameCore } from './core';
import { mergeDelta } from './modifiers';

export function newJokerInstance(
  core: GameCore,
  defId: string,
  edition: EditionId | null = null,
  stickers: JokerInstance['stickers'] = [],
): JokerInstance {
  const def = core.registry.jokers[defId];
  if (!def) throw new Error(`Unknown joker ${defId}`);
  const j: JokerInstance = {
    uid: core.uid(),
    defId,
    edition,
    // Kopie: `initState` vracející pořád stejný objekt by jinak spojil stav všech instancí (do uložení a načtení).
    state: def.initState ? (JSON.parse(JSON.stringify(def.initState() ?? {})) as JokerInstance['state']) : {},
    sellBonus: 0,
    stickers: [...stickers],
    debuffed: false,
  };
  if (stickers.includes('perishable')) j.perishRounds = PERISH_ROUNDS;
  return j;
}

export function newConsumableInstance(
  core: GameCore,
  defId: string,
  edition: EditionId | null = null,
): ConsumableInstance {
  if (!core.registry.consumables[defId]) throw new Error(`Unknown consumable ${defId}`);
  return { uid: core.uid(), defId, edition };
}

/** Vejde se žolík s danou edicí do slotů? (negativní edice si slot přinese sama) */
export function jokerHasRoom(core: GameCore, edition: EditionId | null): boolean {
  const extra = edition ? (core.registry.editions[edition]?.extraSlots ?? 0) : 0;
  return core.state.jokers.length < core.mods().jokerSlots + extra;
}

/** Vejde se spotřebka s danou edicí do slotů? */
export function consumableHasRoom(core: GameCore, edition: EditionId | null): boolean {
  const extra = edition ? (core.registry.editions[edition]?.extraSlots ?? 0) : 0;
  return core.state.consumables.length < core.mods().consumableSlots + extra;
}

/**
 * Přidá hotovou instanci žolíka do slotů. `ignoreSlots` = bez kontroly místa; `acquire` = žolík byl
 * získán ve hře (koupě, obálka, efekt) → zavolá se jeho `onAcquire`. Vrací false, když není místo.
 */
export function addJokerInstance(
  core: GameCore,
  joker: JokerInstance,
  opts: { ignoreSlots?: boolean; acquire?: boolean } = {},
): boolean {
  if (!opts.ignoreSlots && !jokerHasRoom(core, joker.edition)) return false;
  core.state.jokers.push(joker);
  core.invalidate();
  core.emit({ type: 'jokerAdded', uid: joker.uid, defId: joker.defId });
  if (opts.acquire) {
    const def = core.registry.jokers[joker.defId];
    if (def?.hooks.onAcquire) {
      def.hooks.onAcquire(core.jokerCtx(joker, core.state.jokers.indexOf(joker), false, def));
      core.invalidate();
    }
  }
  return true;
}

export function addConsumableInstance(core: GameCore, c: ConsumableInstance, ignoreSlots = false): boolean {
  if (!ignoreSlots && !consumableHasRoom(core, c.edition)) return false;
  core.state.consumables.push(c);
  core.invalidate();
  core.emit({ type: 'consumableAdded', uid: c.uid, defId: c.defId });
  return true;
}

/** Pole karty, která smí měnit `EngineApi.modifyCard`. */
const CARD_PATCH_KEYS = ['suit', 'rank', 'enhancement', 'seal', 'edition', 'bonusChips'] as const;

/** Odebere kartu ze všech hromádek kola. */
function removeFromPiles(core: GameCore, cardId: number): void {
  const r = core.state.round;
  if (r) {
    r.hand = r.hand.filter((id) => id !== cardId);
    r.drawPile = r.drawPile.filter((id) => id !== cardId);
    r.discardPile = r.discardPile.filter((id) => id !== cardId);
    r.playedPile = r.playedPile.filter((id) => id !== cardId);
  }
  const b = core.state.booster;
  if (b) b.hand = b.hand.filter((id) => id !== cardId);
}

/**
 * Fronta obálek zdarma čekajících na otevření (`EngineApi.openBooster`; `RunState.flags.pendingBoosters`). Neplatné
 * záznamy (starší uložení, ruční úprava) se zahodí.
 */
export function pendingBoosterIds(flags: Readonly<InstanceState>): string[] {
  const v = flags.pendingBoosters;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Ořízne číslo do konečného rozsahu (přetečení → ±`Number.MAX_VALUE`; JSON by nekonečno uložil jako `null`). */
function finite(n: number): number {
  return Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, n));
}

/** Celočíselná změna z obsahu: NaN/nekonečno = 0 (nic se nezmění), desetinná čísla se useknou. */
function intDelta(n: number): number {
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Změní peníze o `delta` bez jakýchkoli limitů (jen bez přetečení) a zapíše statistiky + událost. */
function changeMoney(core: GameCore, delta: number, reason: string): void {
  if (!delta) return;
  const s = core.state;
  const before = s.money;
  s.money = finite(s.money + delta);
  const change = s.money - before;
  if (!change) return;
  if (change > 0) s.stats.moneyEarned = finite(s.stats.moneyEarned + change);
  s.stats.minMoney = Math.min(s.stats.minMoney, s.money);
  s.stats.maxMoney = Math.max(s.stats.maxMoney, s.money);
  core.emit({ type: 'moneyChanged', delta: change, money: s.money, reason });
}

export function createApi(core: GameCore): EngineApi {
  const api: EngineApi = {
    addMoney(amount, reason) {
      if (!amount || !Number.isFinite(amount)) return;
      let delta = amount;
      if (delta < 0) {
        // Srážka se provede jen do výše dluhového limitu (DESIGN 2.4.3); pod limitem už nic nestrhne.
        const floor = -core.mods().debtLimit;
        delta = Math.max(delta, Math.min(0, floor - core.state.money));
      }
      changeMoney(core, delta, reason);
    },

    setMoney(n, reason) {
      if (!Number.isFinite(n)) return;
      changeMoney(core, Math.trunc(n) - core.state.money, reason);
    },

    addHands(n) {
      const r = core.state.round;
      const d = intDelta(n);
      if (!r || !d) return;
      r.handsLeft = Math.max(0, r.handsLeft + d);
    },

    addDiscards(n) {
      const r = core.state.round;
      const d = intDelta(n);
      if (!r || !d) return;
      r.discardsLeft = Math.max(0, r.discardsLeft + d);
    },

    drawCards(n) {
      drawCards(core, n);
    },

    levelUpHand(hand: HandType, levels = 1) {
      const hl = core.state.handLevels[hand];
      const d = intDelta(levels);
      if (!hl || !d) return;
      const before = hl.level;
      hl.level = Math.max(1, hl.level + d);
      if (hl.level !== before)
        core.emit({ type: 'handLeveled', hand, level: hl.level, delta: hl.level - before });
    },

    levelUpAll(levels) {
      for (const hand of HAND_TYPES) api.levelUpHand(hand, levels);
    },

    handBase(hand, level) {
      const def = core.registry.handTypes[hand];
      if (!def) throw new Error(`Unknown hand type ${hand}`);
      return handValueAtLevel(def, level);
    },

    createJoker(opts: CreateJokerOptions = {}) {
      const edition = opts.edition ?? null;
      // Suchý únor (`Modifiers.noJokers`): žolíci nevznikají ani efekty.
      if (core.mods().noJokers) return null;
      if (!opts.ignoreSlots && !jokerHasRoom(core, edition)) return null;
      const rng = core.rng('joker');
      const defId = opts.defId ?? pickJokerDefId(core, rng, opts.rarity ? { rarity: opts.rarity } : {});
      if (!defId) return null;
      // Vynucená nálepka výzvy (Půjčovna kostýmů, Svatba na doživotí) platí i pro žolíky z efektů.
      const forced = core.challenge()?.jokerSticker;
      const stickers =
        forced && stickerAllowed(core.registry.jokers[defId], forced) ? [forced] : (opts.stickers ?? []);
      const j = newJokerInstance(core, defId, edition, stickers);
      addJokerInstance(core, j, { ignoreSlots: true, acquire: true });
      return j;
    },

    destroyJoker(uid, reason) {
      const s = core.state;
      const j = s.jokers.find((x) => x.uid === uid);
      if (!j || j.stickers.includes('eternal')) return;
      s.jokers = s.jokers.filter((x) => x !== j);
      if (s.round) s.round.jokerDebuffs = s.round.jokerDebuffs.filter((x) => x !== uid);
      core.invalidate();
      core.emit({ type: 'jokerDestroyed', uid, defId: j.defId, reason });
    },

    setJokerDebuffed(uid, on) {
      const r = core.state.round;
      const j = core.state.jokers.find((x) => x.uid === uid);
      if (!r || !j) return;
      const before = j.debuffed;
      if (on) {
        if (!r.jokerDebuffs.includes(uid)) r.jokerDebuffs.push(uid);
        j.debuffed = true;
      } else {
        // Ruší jen dočasný debuff — zvětralý žolík zůstává mimo provoz.
        if (!r.jokerDebuffs.includes(uid)) return;
        r.jokerDebuffs = r.jokerDebuffs.filter((x) => x !== uid);
        j.debuffed = core.isPerished(j);
      }
      core.invalidate();
      if (j.debuffed !== before) core.emit({ type: 'jokerDebuffChanged', uid, debuffed: j.debuffed });
    },

    createConsumable(opts: {
      kind?: ConsumableKind;
      defId?: string;
      forHand?: HandType;
      edition?: EditionId | null;
      ignoreSlots?: boolean;
    }) {
      const edition = opts.edition ?? null;
      if (!opts.ignoreSlots && !consumableHasRoom(core, edition)) return null;
      let defId = opts.defId ?? null;
      if (!defId && opts.forHand) {
        defId =
          Object.values(core.registry.consumables)
            .filter((d) => d.kind === 'pranostika' && d.hand === opts.forHand)
            .map((d) => d.id)
            .sort()[0] ?? null;
        if (!defId) return null;
      }
      if (!defId) {
        if (!opts.kind) return null;
        defId = pickConsumableDefId(core, core.rng('consumable'), opts.kind);
      }
      if (!defId) return null;
      // Spotřebka, kterou výzva vyřadila (Kamenolom: babské rady), nevznikne ani efektem (pečeť, balíček).
      const def = core.registry.consumables[defId];
      if (def && !consumableInRun(core, def)) return null;
      const c = newConsumableInstance(core, defId, edition);
      addConsumableInstance(core, c, true);
      return c;
    },

    addCard(spec: CardSpec, opts = {}) {
      const s = core.state;
      const card = createCard(core.uid(), spec);
      s.deck.push(card);
      const r = s.round;
      if (r) {
        card.debuffed = bossDebuffs(core, card);
        if (opts.toHand) {
          r.hand.push(card.id);
        } else {
          // Zamíchat na náhodné místo dobíracího balíčku.
          const idx = core.rng('deck').int(0, r.drawPile.length);
          r.drawPile.splice(idx, 0, card.id);
        }
      } else if (opts.toHand && s.booster) {
        s.booster.hand.push(card.id);
      }
      core.emit({ type: 'cardAdded', cardId: card.id, source: opts.source ?? 'effect' });
      core.eachJoker('onCardAdded', { card });
      return card;
    },

    copyCard(cardId, opts = {}) {
      const src = core.card(cardId);
      if (!src) return null;
      return api.addCard(
        {
          suit: src.suit,
          rank: src.rank,
          enhancement: src.enhancement,
          seal: src.seal,
          edition: src.edition,
          bonusChips: src.bonusChips,
        },
        { toHand: opts.toHand ?? false, source: 'copy' },
      );
    },

    destroyCard(cardId, reason) {
      const s = core.state;
      const card = core.card(cardId);
      if (!card) return;
      s.deck = s.deck.filter((c) => c.id !== cardId);
      removeFromPiles(core, cardId);
      core.emit({ type: 'cardDestroyed', cardId, reason });
      core.eachJoker('onCardDestroyed', { card });
    },

    modifyCard(cardId, patch) {
      const card = core.card(cardId);
      if (!card) return;
      // Jen povolená pole a jen definované hodnoty (`{ suit: undefined }` kartu nerozbije, `id` nejde změnit).
      for (const key of CARD_PATCH_KEYS) {
        const value = patch[key];
        if (value !== undefined) Object.assign(card, { [key]: value });
      }
      if (core.state.round) card.debuffed = bossDebuffs(core, card);
      core.emit({ type: 'cardChanged', cardId });
    },

    discardFromHand(cardId) {
      const r = core.state.round;
      if (!r || !r.hand.includes(cardId)) return false;
      r.hand = r.hand.filter((id) => id !== cardId);
      r.discardPile.push(cardId);
      core.emit({ type: 'cardsDiscarded', cardIds: [cardId], forced: true });
      return true;
    },

    setCardFaceDown(cardId, on) {
      const card = core.card(cardId);
      if (!card || card.faceDown === on) return;
      card.faceDown = on;
      core.emit({ type: 'cardChanged', cardId });
    },

    shuffleHand() {
      const r = core.state.round;
      if (!r || r.hand.length < 2) return;
      core.rng('deck').shuffle(r.hand);
      core.emit({ type: 'handShuffled', cardIds: [...r.hand] });
    },

    addRoundHandSize(n) {
      const r = core.state.round;
      const d = intDelta(n);
      if (!r || !d) return;
      r.handSizeDelta += d;
      core.invalidate();
    },

    changeAnte(delta) {
      const s = core.state;
      const next = Math.max(1, s.ante + intDelta(delta));
      if (next === s.ante) return;
      s.ante = next;
      core.invalidate();
      core.emit({ type: 'anteChanged', ante: s.ante });
      revalidateBoss(core);
    },

    addPermanentModifier(delta) {
      mergeDelta(core.state.extraModifiers, delta);
      core.invalidate();
    },

    rerollBoss() {
      return rerollBossSlot(core);
    },

    setJokerEdition(uid, edition) {
      const j = core.state.jokers.find((x) => x.uid === uid);
      if (!j || j.edition === edition) return;
      if (edition !== null && !core.registry.editions[edition]) throw new Error(`Unknown edition ${edition}`);
      j.edition = edition;
      core.invalidate();
      core.emit({ type: 'jokerChanged', uid, defId: j.defId });
    },

    removeJokerStickers(uid, stickers) {
      const j = core.state.jokers.find((x) => x.uid === uid);
      if (!j) return;
      const remove = stickers ?? j.stickers;
      const next = j.stickers.filter((st) => !remove.includes(st));
      if (next.length === j.stickers.length) return;
      j.stickers = next;
      if (!next.includes('perishable')) delete j.perishRounds;
      if (!next.includes('rental')) delete j.rentalPaid;
      // Zvětralý žolík ožije; dočasný debuff z tohoto kola (šéf) trvá dál.
      const before = j.debuffed;
      j.debuffed = core.isPerished(j) || (core.state.round?.jokerDebuffs.includes(uid) ?? false);
      core.invalidate();
      core.emit({ type: 'jokerChanged', uid, defId: j.defId });
      if (j.debuffed !== before) core.emit({ type: 'jokerDebuffChanged', uid, debuffed: j.debuffed });
    },

    copyJoker(uid, opts = {}) {
      const src = core.state.jokers.find((x) => x.uid === uid);
      if (!src || !core.registry.jokers[src.defId]) return null;
      const edition = opts.edition !== undefined ? opts.edition : src.edition;
      if (!opts.ignoreSlots && !jokerHasRoom(core, edition)) return null;
      const copy: JokerInstance = {
        uid: core.uid(),
        defId: src.defId,
        edition,
        state: JSON.parse(JSON.stringify(src.state)) as JokerInstance['state'],
        sellBonus: src.sellBonus,
        stickers: [...src.stickers],
        debuffed: false,
      };
      if (src.perishRounds !== undefined) copy.perishRounds = src.perishRounds;
      if (src.rentalPaid !== undefined) copy.rentalPaid = src.rentalPaid;
      copy.debuffed = core.isPerished(copy);
      addJokerInstance(core, copy, { ignoreSlots: true, acquire: true });
      return copy;
    },

    transformJoker(uid, defId) {
      const s = core.state;
      const j = s.jokers.find((x) => x.uid === uid);
      const def = core.registry.jokers[defId];
      if (!j || !def || j.defId === defId) return null;
      // Na místě: uid, pozice, edice, nálepky i odpočet zvětrávání zůstávají, stav a prodejní bonus ne.
      j.defId = defId;
      j.state = def.initState
        ? (JSON.parse(JSON.stringify(def.initState() ?? {})) as JokerInstance['state'])
        : {};
      j.sellBonus = 0;
      core.invalidate();
      core.emit({ type: 'jokerChanged', uid, defId });
      if (def.hooks.onAcquire) {
        def.hooks.onAcquire(core.jokerCtx(j, s.jokers.indexOf(j), false, def));
        core.invalidate();
      }
      return j;
    },

    cleanseCard(cardId) {
      const r = core.state.round;
      const card = core.card(cardId);
      if (!r || !card) return;
      const cleansed = r.cleansedCards ?? [];
      if (!cleansed.includes(cardId)) r.cleansedCards = [...cleansed, cardId];
      const changed = card.debuffed || card.faceDown;
      card.debuffed = false;
      card.faceDown = false;
      if (changed) core.emit({ type: 'cardChanged', cardId });
    },

    addTag(defId) {
      if (!core.registry.tags[defId]) throw new Error(`Unknown tag ${defId}`);
      const tag = { uid: core.uid(), defId, state: {} };
      core.state.tags.push(tag);
      core.invalidate();
      core.emit({ type: 'tagAdded', uid: tag.uid, defId });
      const def = core.registry.tags[defId]!;
      const consumed = def.hooks.onAdded?.(core.tagCtx(tag));
      // Hook mohl změnit stav štítku, na kterém závisí jeho `passive`.
      core.invalidate();
      if (consumed) {
        core.state.tags = core.state.tags.filter((t) => t !== tag);
        core.invalidate();
        core.emit({ type: 'tagTriggered', uid: tag.uid, defId });
      }
    },

    openBooster(boosterId) {
      const def = core.registry.boosters[boosterId];
      // Obálka druhu, který se v runu neobjevuje (Suchý únor: žolíci), se neotevře.
      if (!def || !boosterInRun(core, def)) return false;
      const s = core.state;
      s.flags.pendingBoosters = [...pendingBoosterIds(s.flags), boosterId];
      return true;
    },

    addFreeRerolls(n) {
      const k = intDelta(n);
      if (k <= 0) return;
      const s = core.state;
      if (s.shop) {
        s.shop.freeRerolls += k;
        return;
      }
      const pending = typeof s.flags.freeRerolls === 'number' ? s.flags.freeRerolls : 0;
      s.flags.freeRerolls = pending + k;
    },

    addShopJoker(opts = {}) {
      return addShopJoker(core, opts);
    },

    setShopJokerEdition(edition, opts = {}) {
      return setShopJokerEdition(core, edition, opts.noSurcharge === true);
    },

    addShopVoucher() {
      return addShopVoucher(core);
    },

    disableBoss() {
      const r = core.state.round;
      if (!r || !r.bossId || r.bossDisabled) return;
      const before = core.mods();
      r.bossDisabled = true;
      core.invalidate();
      // Pravidlo šéfa přestane platit i pro ruce a zahození (Polední pauza, Sucho v obci, Kocovina):
      // rozdíl modifikátorů se promítne do zbývajících, ruce nejníž 1 (kolo nesmí uváznout bez ruky).
      const after = core.mods();
      if (after.hands !== before.hands) r.handsLeft = Math.max(1, r.handsLeft + after.hands - before.hands);
      if (after.discards !== before.discards)
        r.discardsLeft = Math.max(0, r.discardsLeft + after.discards - before.discards);
      refreshDebuffs(core);
      core.clearJokerDebuffs();
      for (const id of r.hand) core.mustCard(id).faceDown = false;
      core.emit({ type: 'message', key: MSG.bossDisabled, params: { boss: r.bossId } });
    },

    message(key, params) {
      core.emit(params ? { type: 'message', key, params } : { type: 'message', key });
    },

    getCard: (id) => core.card(id),
    handCards: () => (core.state.round?.hand ?? []).map((id) => core.mustCard(id)),
    modifiers: () => core.mods(),
    handLevel: (hand) => core.state.handLevels[hand]?.level ?? 1,
    isFace: (card: Card) => isFaceCard(card, core.mods(), core.enhancements()),
    cardRank: (card: Card) => (hasNoRankSuit(card, core.enhancements()) ? null : card.rank),
    hasSuit: (card, suit) => cardHasSuit(card, suit, core.mods(), core.enhancements()),
    cardChips: (card) => cardChips(card, core.enhancements(), core.mods()),
    jokerSlots: () => core.mods().jokerSlots,
    availableJokers: (opts) => availableJokerIds(core, opts),
    jokerRarity: (defId) => core.registry.jokers[defId]?.rarity ?? null,
    consumableKind: (defId) => core.registry.consumables[defId]?.kind ?? null,
    consumableHand: (defId) => core.registry.consumables[defId]?.hand ?? null,
    jokerCopyable: (defId) => {
      const def = core.registry.jokers[defId];
      return def !== undefined && def.copyable !== false;
    },
    sellValue: (joker) => jokerSellValue(core, joker),
  };
  return api;
}
