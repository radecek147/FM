/** Implementace EngineApi — příkazy a dotazy, které smí volat obsah (hooky). */
import type { CardSpec, CreateJokerOptions, EngineApi } from '../content-types';
import { cardChips, cardHasSuit, createCard, isFaceCard } from '../cards/cards';
import { drawCards, bossDebuffs, refreshDebuffs } from '../run/draw';
import { pickConsumableDefId, pickJokerDefId } from '../shop/pool';
import type { Card, ConsumableInstance, ConsumableKind, EditionId, HandType, JokerInstance } from '../types';
import type { GameCore } from './core';

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
    state: def.initState ? def.initState() : {},
    sellBonus: 0,
    stickers: [...stickers],
    debuffed: false,
  };
  if (stickers.includes('perishable')) j.perishRounds = 6; // DESIGN 2.10 PERISH_ROUNDS
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

/** Počet slotů žolíků, které by byly k dispozici po přidání žolíka s danou edicí. */
function jokerHasRoom(core: GameCore, edition: EditionId | null): boolean {
  const extra = edition ? (core.registry.editions[edition]?.extraSlots ?? 0) : 0;
  return core.state.jokers.length < core.mods().jokerSlots + extra;
}

function consumableHasRoom(core: GameCore, edition: EditionId | null): boolean {
  const extra = edition ? (core.registry.editions[edition]?.extraSlots ?? 0) : 0;
  return core.state.consumables.length < core.mods().consumableSlots + extra;
}

/** Přidá hotovou instanci žolíka (kontroluje sloty, pokud ignoreSlots není true). */
export function addJokerInstance(core: GameCore, joker: JokerInstance, ignoreSlots = false): boolean {
  if (!ignoreSlots && !jokerHasRoom(core, joker.edition)) return false;
  core.state.jokers.push(joker);
  core.invalidate();
  core.emit({ type: 'jokerAdded', uid: joker.uid, defId: joker.defId });
  return true;
}

export function addConsumableInstance(core: GameCore, c: ConsumableInstance, ignoreSlots = false): boolean {
  if (!ignoreSlots && !consumableHasRoom(core, c.edition)) return false;
  core.state.consumables.push(c);
  core.invalidate();
  core.emit({ type: 'consumableAdded', uid: c.uid, defId: c.defId });
  return true;
}

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

export function createApi(core: GameCore): EngineApi {
  const enh = () => core.registry.enhancements;

  const api: EngineApi = {
    addMoney(amount, reason) {
      if (!amount) return;
      const s = core.state;
      s.money += amount;
      if (amount > 0) s.stats.moneyEarned += amount;
      s.stats.minMoney = Math.min(s.stats.minMoney, s.money);
      s.stats.maxMoney = Math.max(s.stats.maxMoney, s.money);
      core.emit({ type: 'moneyChanged', delta: amount, money: s.money, reason });
    },

    addHands(n) {
      const r = core.state.round;
      if (!r || !n) return;
      r.handsLeft = Math.max(0, r.handsLeft + n);
    },

    addDiscards(n) {
      const r = core.state.round;
      if (!r || !n) return;
      r.discardsLeft = Math.max(0, r.discardsLeft + n);
    },

    drawCards(n) {
      drawCards(core, n);
    },

    levelUpHand(hand: HandType, levels = 1) {
      const hl = core.state.handLevels[hand];
      if (!hl || !levels) return;
      const before = hl.level;
      hl.level = Math.max(1, hl.level + levels);
      core.emit({ type: 'handLeveled', hand, level: hl.level, delta: hl.level - before });
    },

    createJoker(opts: CreateJokerOptions = {}) {
      const edition = opts.edition ?? null;
      if (!opts.ignoreSlots && !jokerHasRoom(core, edition)) return null;
      const rng = core.rng('joker');
      const defId = opts.defId ?? pickJokerDefId(core, rng, opts.rarity ? { rarity: opts.rarity } : {});
      if (!defId) return null;
      const j = newJokerInstance(core, defId, edition, opts.stickers ?? []);
      addJokerInstance(core, j, true);
      return j;
    },

    destroyJoker(uid, reason) {
      const s = core.state;
      const j = s.jokers.find((x) => x.uid === uid);
      if (!j || j.stickers.includes('eternal')) return;
      s.jokers = s.jokers.filter((x) => x !== j);
      core.invalidate();
      core.emit({ type: 'jokerDestroyed', uid, defId: j.defId, reason });
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
      Object.assign(card, patch);
      if (core.state.round) card.debuffed = bossDebuffs(core, card);
      core.emit({ type: 'cardChanged', cardId });
    },

    addTag(defId) {
      if (!core.registry.tags[defId]) throw new Error(`Unknown tag ${defId}`);
      const tag = { uid: core.uid(), defId, state: {} };
      core.state.tags.push(tag);
      core.invalidate();
      core.emit({ type: 'tagAdded', uid: tag.uid, defId });
      const def = core.registry.tags[defId]!;
      if (def.hooks.onAdded?.(core.tagCtx(tag))) {
        core.state.tags = core.state.tags.filter((t) => t !== tag);
        core.invalidate();
        core.emit({ type: 'tagTriggered', uid: tag.uid, defId });
      }
    },

    disableBoss() {
      const r = core.state.round;
      if (!r || !r.bossId || r.bossDisabled) return;
      r.bossDisabled = true;
      core.invalidate();
      refreshDebuffs(core);
      for (const id of r.hand) core.mustCard(id).faceDown = false;
      core.emit({ type: 'message', key: 'boss.disabled', params: { boss: r.bossId } });
    },

    message(key, params) {
      core.emit(params ? { type: 'message', key, params } : { type: 'message', key });
    },

    getCard: (id) => core.card(id),
    handCards: () => (core.state.round?.hand ?? []).map((id) => core.mustCard(id)),
    modifiers: () => core.mods(),
    handLevel: (hand) => core.state.handLevels[hand]?.level ?? 1,
    isFace: (card: Card) => isFaceCard(card, core.mods(), enh()),
    hasSuit: (card, suit) => cardHasSuit(card, suit, core.mods(), enh()),
    cardChips: (card) => cardChips(card, enh()),
    jokerSlots: () => core.mods().jokerSlots,
    sellValue(joker) {
      const def = core.registry.jokers[joker.defId];
      if (joker.stickers.includes('rental')) return 1;
      const edAdd = joker.edition ? (core.registry.editions[joker.edition]?.priceAdd ?? 0) : 0;
      const base = (def?.cost ?? 0) + edAdd;
      return Math.max(1, Math.floor(base / 2)) + joker.sellBonus;
    },
  };
  return api;
}
