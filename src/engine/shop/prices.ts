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
 * Základ ≤ 0 se bere jako zdarma. Pevná cena (`Modifiers.flatShopPrice`, Jednotná cena) přebíjí slevy i příplatky.
 */
export function shopPrice(
  mods: Pick<Modifiers, 'shopDiscountPct' | 'shopPriceAdd'> & Partial<Pick<Modifiers, 'flatShopPrice'>>,
  base: number,
  free = false,
): number {
  if (free || base <= 0) return 0;
  if (mods.flatShopPrice && mods.flatShopPrice > 0) return mods.flatShopPrice;
  // round(base × (100 − sleva) / 100) polovinou nahoru — v celých číslech (bez chyb doublu u x,5).
  const discounted = Math.floor((base * (100 - mods.shopDiscountPct) + 50) / 100);
  return Math.max(1, discounted) + mods.shopPriceAdd;
}

/** Cena příštího placeného přehození (sleva neplatí, `shopPriceAdd` ano; pevná cena `flatShopPrice` přebíjí vše). */
export function rerollPrice(
  mods: Pick<Modifiers, 'rerollBaseCost' | 'rerollCostStep' | 'shopPriceAdd'> &
    Partial<Pick<Modifiers, 'flatShopPrice'>>,
  paidRerolls: number,
): number {
  if (mods.flatShopPrice && mods.flatShopPrice > 0) return mods.flatShopPrice;
  return Math.max(0, mods.rerollBaseCost + mods.rerollCostStep * paidRerolls) + mods.shopPriceAdd;
}

/** Příplatek za edici (Kč). */
export function editionPriceAdd(core: GameCore, edition: EditionId | null): number {
  return edition ? (core.registry.editions[edition]?.priceAdd ?? 0) : 0;
}

/**
 * Základní cena žolíka pro obchod: zapůjčený `RENTAL_BUY_PRICE` (místo ceny), jinak cena + edice
 * (s `noEditionSurcharge` bez příplatku za edici — štítky Vyleštěné příbory a Rentgen od zubaře).
 */
export function jokerBasePrice(core: GameCore, joker: JokerInstance, noEditionSurcharge = false): number {
  if (joker.stickers.includes('rental')) return RENTAL_BUY_PRICE;
  const edition = noEditionSurcharge ? 0 : editionPriceAdd(core, joker.edition);
  return (core.registry.jokers[joker.defId]?.cost ?? 0) + edition;
}

/**
 * Základní cena spotřebky: cena z definice (nebo pevná cena druhu z výzvy, `ChallengeDef.consumableCost` — Krátká
 * paměť: pranostiky 1 Kč) + edice.
 */
export function consumableBasePrice(
  core: GameCore,
  c: Pick<ConsumableInstance, 'defId' | 'edition'>,
): number {
  const def = core.registry.consumables[c.defId];
  const override = def ? core.challenge()?.consumableCost?.[def.kind] : undefined;
  const cost = typeof override === 'number' && Number.isFinite(override) ? Math.max(0, override) : def?.cost;
  return (cost ?? 0) + editionPriceAdd(core, c.edition);
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

/**
 * Základní cena položky kartového slotu; `priceMult` položky (štítek: poloviční cena) ji násobí ještě před slevou
 * a `shopPriceAdd` (neplatný násobek se ignoruje).
 */
export function shopItemBasePrice(core: GameCore, item: ShopItem): number {
  let base: number;
  if (item.kind === 'joker') base = jokerBasePrice(core, item.joker, item.noEditionSurcharge === true);
  else if (item.kind === 'consumable') base = consumableBasePrice(core, item.consumable);
  else base = cardBasePrice(core, item.card);
  const mult = item.priceMult;
  return typeof mult === 'number' && Number.isFinite(mult) && mult >= 0 ? base * mult : base;
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

/**
 * Prodejní cena žolíka (zapůjčený `RENTAL_SELL_PRICE`; pevná `Modifiers.flatSellPrice` přebíjí vše). Přibitého
 * prodat nejde — to hlídá `Game`.
 */
export function jokerSellValue(core: GameCore, joker: JokerInstance): number {
  const flat = core.mods().flatSellPrice;
  if (flat > 0) return flat;
  if (joker.stickers.includes('rental')) return RENTAL_SELL_PRICE;
  const base = (core.registry.jokers[joker.defId]?.cost ?? 0) + editionPriceAdd(core, joker.edition);
  return Math.max(1, Math.floor(base / 2)) + joker.sellBonus;
}

/** Prodejní cena spotřebky (pranostika 1 Kč, babská rada 2 Kč, razítko 3 Kč; + edice; nebo `flatSellPrice`). */
export function consumableSellValue(
  core: GameCore,
  c: Pick<ConsumableInstance, 'defId' | 'edition'>,
): number {
  const flat = core.mods().flatSellPrice;
  if (flat > 0) return flat;
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
