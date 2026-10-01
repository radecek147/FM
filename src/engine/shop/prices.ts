/**
 * Ceny ve Večerce a prodejní ceny — docs/DESIGN.md kap. 2.5.2.
 *
 *  - Výsledná cena = `max(1, round((základ + příplatky) × (100 − shopDiscountPct) / 100)) + shopPriceAdd`,
 *    round = polovina nahoru. Zdarma = 0 (i při `shopPriceAdd`).
 *  - Přehození: `rerollBaseCost + rerollCostStep × placená přehození + shopPriceAdd` (sleva ho nezlevňuje).
 *  - Prodej žolíka/spotřebky: `max(1, floor(základní cena / 2)) + sellBonus`, základní cena = cena z definice
 *    + příplatek za edici (bez slev a `shopPriceAdd`). Zapůjčený žolík 1 Kč, přibitý nejde prodat.
 */
import {
  PLAYING_CARD_BASE_PRICE,
  PLAYING_CARD_ENHANCEMENT_PRICE,
  PLAYING_CARD_SEAL_PRICE,
  RENTAL_BUY_PRICE,
  RENTAL_SELL_PRICE,
} from '../constants';
import type { GameCore } from '../effects/core';
import type {
  Card,
  ConsumableInstance,
  EditionId,
  JokerInstance,
  Modifiers,
  ShopItem,
  ShopState,
} from '../types';

/** Zaokrouhlení „polovina nahoru“ pro nezáporná čísla (2,5 → 3), odolné vůči nepřesnosti doublu. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/**
 * Výsledná cena položky ve Večerce ze základní ceny (vč. příplatků). `free` = zdarma (cena 0).
 * Základ ≤ 0 se bere jako zdarma.
 */
export function shopPrice(
  mods: Pick<Modifiers, 'shopDiscountPct' | 'shopPriceAdd'>,
  base: number,
  free = false,
): number {
  if (free || base <= 0) return 0;
  // round(base × (100 − sleva) / 100) polovinou nahoru — v celých číslech (bez chyb doublu u x,5).
  const discounted = Math.floor((base * (100 - mods.shopDiscountPct) + 50) / 100);
  return Math.max(1, discounted) + mods.shopPriceAdd;
}

/** Cena příštího placeného přehození (sleva neplatí, `shopPriceAdd` ano). */
export function rerollPrice(
  mods: Pick<Modifiers, 'rerollBaseCost' | 'rerollCostStep' | 'shopPriceAdd'>,
  paidRerolls: number,
): number {
  return Math.max(0, mods.rerollBaseCost + mods.rerollCostStep * paidRerolls) + mods.shopPriceAdd;
}

/** Příplatek za edici (Kč). */
export function editionPriceAdd(core: GameCore, edition: EditionId | null): number {
  return edition ? (core.registry.editions[edition]?.priceAdd ?? 0) : 0;
}

/** Základní cena žolíka pro obchod: zapůjčený `RENTAL_BUY_PRICE` (místo ceny), jinak cena + edice. */
export function jokerBasePrice(core: GameCore, joker: JokerInstance): number {
  if (joker.stickers.includes('rental')) return RENTAL_BUY_PRICE;
  return (core.registry.jokers[joker.defId]?.cost ?? 0) + editionPriceAdd(core, joker.edition);
}

/** Základní cena spotřebky: cena z definice + edice. */
export function consumableBasePrice(
  core: GameCore,
  c: Pick<ConsumableInstance, 'defId' | 'edition'>,
): number {
  return (core.registry.consumables[c.defId]?.cost ?? 0) + editionPriceAdd(core, c.edition);
}

/** Základní cena hrací karty: 2 Kč + vylepšení 1 Kč + pečeť 2 Kč + edice. */
export function cardBasePrice(core: GameCore, card: Card): number {
  return (
    PLAYING_CARD_BASE_PRICE +
    (card.enhancement ? PLAYING_CARD_ENHANCEMENT_PRICE : 0) +
    (card.seal ? PLAYING_CARD_SEAL_PRICE : 0) +
    editionPriceAdd(core, card.edition)
  );
}

/** Základní cena položky kartového slotu. */
export function shopItemBasePrice(core: GameCore, item: ShopItem): number {
  if (item.kind === 'joker') return jokerBasePrice(core, item.joker);
  if (item.kind === 'consumable') return consumableBasePrice(core, item.consumable);
  return cardBasePrice(core, item.card);
}

export function jokerPrice(core: GameCore, joker: JokerInstance, free = false): number {
  return shopPrice(core.mods(), jokerBasePrice(core, joker), free);
}

export function consumablePrice(
  core: GameCore,
  c: Pick<ConsumableInstance, 'defId' | 'edition'>,
  free = false,
): number {
  return shopPrice(core.mods(), consumableBasePrice(core, c), free);
}

export function cardPrice(core: GameCore, card: Card, free = false): number {
  return shopPrice(core.mods(), cardBasePrice(core, card), free);
}

export function boosterPrice(core: GameCore, boosterId: string, free = false): number {
  return shopPrice(core.mods(), core.registry.boosters[boosterId]?.cost ?? 0, free);
}

export function voucherPrice(core: GameCore, voucherId: string, free = false): number {
  return shopPrice(core.mods(), core.registry.vouchers[voucherId]?.cost ?? 0, free);
}

/** Prodejní cena žolíka (zapůjčený `RENTAL_SELL_PRICE`). Přibitého prodat nejde — to hlídá `Game`. */
export function jokerSellValue(core: GameCore, joker: JokerInstance): number {
  if (joker.stickers.includes('rental')) return RENTAL_SELL_PRICE;
  const base = (core.registry.jokers[joker.defId]?.cost ?? 0) + editionPriceAdd(core, joker.edition);
  return Math.max(1, Math.floor(base / 2)) + joker.sellBonus;
}

/** Prodejní cena spotřebky (pranostika 1 Kč, babská rada 2 Kč, razítko 3 Kč; + edice). */
export function consumableSellValue(
  core: GameCore,
  c: Pick<ConsumableInstance, 'defId' | 'edition'>,
): number {
  return Math.max(1, Math.floor(consumableBasePrice(core, c) / 2));
}

/**
 * Přepočítá ceny všech neprodaných položek Večerky a přehození podle aktuálních modifikátorů
 * (např. po koupi kupónu se slevou). Položky zdarma zůstávají za 0.
 */
export function refreshShopPrices(core: GameCore, shop: ShopState): void {
  const mods = core.mods();
  for (const item of shop.items) {
    if (!item.sold) item.price = shopPrice(mods, shopItemBasePrice(core, item), item.free);
  }
  for (const b of shop.boosters) if (!b.sold) b.price = boosterPrice(core, b.boosterId, b.free);
  for (const v of shop.vouchers) if (!v.sold) v.price = voucherPrice(core, v.voucherId, v.free);
  shop.rerollCost = shop.freeRerolls > 0 ? 0 : rerollPrice(mods, shop.paidRerolls);
}
