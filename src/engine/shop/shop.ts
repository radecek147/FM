/** Večerka: generování nabídky, ceny, kupóny, boostery. */
import type { Rng } from '../content-types';
import { standardDeckSpecs, createCard } from '../cards/cards';
import { newConsumableInstance, newJokerInstance } from '../effects/api';
import type { GameCore } from '../effects/core';
import type {
  BoosterOption,
  BoosterState,
  Card,
  ConsumableKind,
  JokerInstance,
  ShopItem,
  ShopState,
  StickerId,
} from '../types';
import { pickConsumableDefId, pickJokerDefId, rollEdition } from './pool';

export const BASE_CARD_PRICE = 1;

/** Cena po slevě (Modifiers.shopDiscountPct), nejméně 0. */
export function discounted(core: GameCore, price: number): number {
  const pct = core.mods().shopDiscountPct;
  return Math.max(0, Math.floor((price * (100 - pct)) / 100));
}

/** Kumulativní hodnota z obtížností ≤ aktuální úroveň. */
export function stakeStickerChance(core: GameCore): Partial<Record<StickerId, number>> {
  const out: Partial<Record<StickerId, number>> = {};
  for (const st of Object.values(core.registry.stakes)) {
    if (st.level > core.state.stake || !st.stickerChance) continue;
    for (const [k, v] of Object.entries(st.stickerChance) as [StickerId, number][]) {
      out[k] = Math.max(out[k] ?? 0, v);
    }
  }
  return out;
}

export function rollStickers(core: GameCore, rng: Rng): StickerId[] {
  const ch = stakeStickerChance(core);
  const out: StickerId[] = [];
  // Věčný a kazící se se vylučují.
  const r = rng.next();
  if (ch.eternal && r < ch.eternal) out.push('eternal');
  else if (ch.perishable && r < (ch.eternal ?? 0) + ch.perishable) out.push('perishable');
  if (ch.rental && rng.next() < ch.rental) out.push('rental');
  return out;
}

export function jokerPrice(core: GameCore, joker: JokerInstance): number {
  if (joker.stickers.includes('rental')) return 1;
  const def = core.registry.jokers[joker.defId];
  const ed = joker.edition ? (core.registry.editions[joker.edition]?.priceAdd ?? 0) : 0;
  return discounted(core, (def?.cost ?? 0) + ed);
}

export function consumablePrice(core: GameCore, defId: string): number {
  return discounted(core, core.registry.consumables[defId]?.cost ?? 0);
}

export function cardPrice(core: GameCore, card: Card): number {
  let price = BASE_CARD_PRICE;
  if (card.enhancement) price += 1;
  if (card.seal) price += 1;
  if (card.edition) price += core.registry.editions[card.edition]?.priceAdd ?? 0;
  return discounted(core, price);
}

/** Náhodná hrací karta (pro obchod a karetní boostery). Karta není v balíčku, dokud se nekoupí. */
export function randomPlayingCard(
  core: GameCore,
  rng: Rng,
  chances: { enhancement: number; seal: number; edition: boolean },
): Card {
  const spec = rng.pick(standardDeckSpecs());
  const enhancements = Object.keys(core.registry.enhancements).sort();
  const seals = Object.keys(core.registry.seals).sort();
  const card = createCard(core.uid(), spec);
  if (enhancements.length && rng.next() < chances.enhancement) card.enhancement = rng.pick(enhancements);
  if (seals.length && rng.next() < chances.seal) card.seal = rng.pick(seals);
  if (chances.edition) card.edition = rollEdition(core, rng, true);
  return card;
}

type SlotKind = 'joker' | ConsumableKind | 'card';

function generateItem(core: GameCore, rng: Rng, takenJokers: string[]): ShopItem | null {
  const m = core.mods();
  const reg = core.registry;
  const hasConsumable = (k: ConsumableKind) => Object.values(reg.consumables).some((c) => c.kind === k && !c.noShop);
  const weights: { item: SlotKind; weight: number }[] = [
    { item: 'joker' as const, weight: Object.keys(reg.jokers).length ? m.shopWeightJoker : 0 },
    { item: 'pranostika' as const, weight: hasConsumable('pranostika') ? m.shopWeightPranostika : 0 },
    { item: 'rada' as const, weight: hasConsumable('rada') ? m.shopWeightRada : 0 },
    { item: 'razitko' as const, weight: hasConsumable('razitko') ? m.shopWeightRazitko : 0 },
    { item: 'card' as const, weight: m.shopWeightPlayingCard },
  ].filter((w) => w.weight > 0);
  if (weights.length === 0) return null;
  const kind = rng.weighted(weights);
  if (kind === 'joker') {
    const defId = pickJokerDefId(core, rng, { exclude: takenJokers });
    if (!defId) return null;
    takenJokers.push(defId);
    const joker = newJokerInstance(core, defId, rollEdition(core, rng, false), rollStickers(core, rng));
    return { kind: 'joker', joker, price: jokerPrice(core, joker), sold: false };
  }
  if (kind === 'card') {
    const card = randomPlayingCard(core, rng, { enhancement: 0.3, seal: 0.1, edition: true });
    return { kind: 'card', card, price: cardPrice(core, card), sold: false };
  }
  const defId = pickConsumableDefId(core, rng, kind);
  if (!defId) return null;
  const consumable = newConsumableInstance(core, defId);
  return { kind: 'consumable', consumable, consumableKind: kind, price: consumablePrice(core, defId), sold: false };
}

/** Vygeneruje kartové sloty obchodu. */
export function generateShopItems(core: GameCore): ShopItem[] {
  const rng = core.rng('shop');
  const items: ShopItem[] = [];
  const taken: string[] = [];
  const n = core.mods().shopCardSlots;
  for (let i = 0; i < n; i++) {
    const item = generateItem(core, rng, taken);
    if (item) items.push(item);
  }
  return items;
}

function boosterAllowed(core: GameCore, id: string): boolean {
  const pool = core.state.unlockedPool.boosters;
  return !pool || pool.includes(id);
}

export function generateShopBoosters(core: GameCore): ShopState['boosters'] {
  const rng = core.rng('shop');
  const defs = Object.values(core.registry.boosters)
    .filter((b) => b.weight > 0 && boosterAllowed(core, b.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (defs.length === 0) return [];
  const out: ShopState['boosters'] = [];
  for (let i = 0; i < core.mods().shopBoosterSlots; i++) {
    const def = rng.weighted(defs.map((d) => ({ item: d, weight: d.weight })));
    out.push({ boosterId: def.id, price: discounted(core, def.cost), sold: false });
  }
  return out;
}

/** Kupóny, které lze v tomto runu nabídnout (nevlastněné, splněný předpoklad, odemčené, nezakázané). */
export function eligibleVouchers(core: GameCore): string[] {
  const s = core.state;
  const pool = s.unlockedPool.vouchers;
  const banned = s.challengeId ? (core.registry.challenges[s.challengeId]?.bannedVouchers ?? []) : [];
  return Object.values(core.registry.vouchers)
    .filter(
      (v) =>
        !s.vouchers.includes(v.id) &&
        (!v.requires || s.vouchers.includes(v.requires)) &&
        (!pool || pool.includes(v.id)) &&
        !banned.includes(v.id),
    )
    .map((v) => v.id)
    .sort();
}

/** Vylosuje kupóny pro nové patro. */
export function rollAnteVouchers(core: GameCore): string[] {
  const rng = core.rng('shop');
  const pool = eligibleVouchers(core);
  const out: string[] = [];
  const n = core.mods().shopVoucherSlots;
  for (let i = 0; i < n && pool.length > 0; i++) {
    const id = rng.pick(pool);
    out.push(id);
    pool.splice(pool.indexOf(id), 1);
  }
  return out;
}

export function voucherOffers(core: GameCore): ShopState['vouchers'] {
  return core.state.anteVouchers
    .filter((id) => !core.state.vouchers.includes(id) && core.registry.vouchers[id])
    .map((id) => ({ voucherId: id, price: discounted(core, core.registry.vouchers[id]!.cost), sold: false }));
}

export function generateShop(core: GameCore): ShopState {
  const freeRerolls = typeof core.state.flags.freeRerolls === 'number' ? core.state.flags.freeRerolls : 0;
  core.state.flags.freeRerolls = 0;
  return {
    items: generateShopItems(core),
    boosters: generateShopBoosters(core),
    vouchers: voucherOffers(core),
    rerollCost: discounted(core, core.mods().rerollBaseCost),
    rerollsThisShop: 0,
    freeRerolls,
  };
}

// ─────────────────────────── Boostery ───────────────────────────

export function generateBoosterOptions(core: GameCore, boosterId: string): BoosterOption[] {
  const def = core.registry.boosters[boosterId];
  if (!def) throw new Error(`Unknown booster ${boosterId}`);
  const rng = core.rng('booster');
  const out: BoosterOption[] = [];
  const taken: string[] = [];
  for (let i = 0; i < def.options; i++) {
    if (def.kind === 'joker') {
      const defId = pickJokerDefId(core, rng, { exclude: taken });
      if (!defId) break;
      taken.push(defId);
      out.push({ kind: 'joker', joker: newJokerInstance(core, defId, rollEdition(core, rng, false), rollStickers(core, rng)) });
    } else if (def.kind === 'card') {
      out.push({ kind: 'card', card: randomPlayingCard(core, rng, { enhancement: 0.4, seal: 0.15, edition: true }) });
    } else {
      const defId = pickConsumableDefId(core, rng, def.kind, { exclude: taken });
      if (!defId) break;
      taken.push(defId);
      out.push({ kind: 'consumable', consumable: newConsumableInstance(core, defId), consumableKind: def.kind });
    }
  }
  return out;
}

/** Otevře booster (stav + případná ruka pro cílení babských rad/razítek). */
export function openBooster(core: GameCore, boosterId: string, returnTo: BoosterState['returnTo']): BoosterState {
  const def = core.registry.boosters[boosterId]!;
  const needsHand = def.kind === 'rada' || def.kind === 'razitko';
  let hand: number[] = [];
  if (needsHand) {
    const ids = core.state.deck.map((c) => c.id);
    core.rng('booster').shuffle(ids);
    hand = ids.slice(0, core.mods().handSize);
  }
  return {
    boosterId,
    options: generateBoosterOptions(core, boosterId),
    picksLeft: def.picks,
    hand,
    returnTo,
  };
}
