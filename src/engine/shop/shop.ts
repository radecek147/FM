/** Večerka: generování nabídky, nálepky, kupóny, obálky (boostery). Ceny viz shop/prices.ts. */
import type { BoosterDef, CardSpec, JokerRarity, Rng } from '../content-types';
import { BOOSTER_CARD_ENHANCE_CHANCE, BOOSTER_CARD_SEAL_CHANCE } from '../constants';
import { createCard } from '../cards/cards';
import { newConsumableInstance, newJokerInstance } from '../effects/api';
import type { GameCore } from '../effects/core';
import { cyrb128, rngFromState } from '../rng/rng';
import { startingDeckSpecs } from '../run/init';
import type {
  BoosterOption,
  BoosterState,
  Card,
  ConsumableKind,
  EditionId,
  ShopItem,
  ShopState,
  StickerId,
} from '../types';
import {
  compareIds,
  consumableKindInRun,
  pickConsumableDefId,
  pickJokerDefId,
  rollEdition,
  stickerAllowed,
} from './pool';
import {
  boosterPrice,
  cardPrice,
  consumablePrice,
  jokerPrice,
  refreshShopPrices,
  rerollPrice,
  shopItemBasePrice,
  shopPrice,
  voucherPrice,
} from './prices';

/** Kumulativní šance nálepek z obtížností ≤ aktuální úroveň (maximum přes úrovně). */
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

/** Pořadí hodů na nálepky (DESIGN 4.6): první úspěšný hod vyhrává, žolík má nejvýš jednu nálepku. */
const STICKER_ORDER: readonly StickerId[] = ['eternal', 'rental', 'perishable'];

/**
 * Vylosuje nálepku pro žolíka z obchodu/obálky: přibitý → zapůjčený → zvětrávající, každý vlastním hodem
 * se šancí podle síly piva; nálepky zakázané v definici žolíka (`noEternal`…) se přeskočí bez hodu. Výzva
 * s vynucenou nálepkou (`ChallengeDef.jokerSticker`) ji dá každému žolíkovi, který ji smí nést, bez hodu.
 */
export function rollStickers(core: GameCore, rng: Rng, defId?: string): StickerId[] {
  const def = defId ? core.registry.jokers[defId] : undefined;
  const forced = core.challenge()?.jokerSticker;
  if (forced && stickerAllowed(def, forced)) return [forced];
  const ch = stakeStickerChance(core);
  const blocked: Record<StickerId, boolean> = {
    eternal: def?.noEternal === true,
    rental: def?.noRental === true,
    perishable: def?.noPerishable === true,
  };
  for (const sticker of STICKER_ORDER) {
    const p = ch[sticker] ?? 0;
    if (p <= 0 || blocked[sticker]) continue;
    if (rng.next() < p) return [sticker];
  }
  return [];
}

/**
 * Výchozí složení startovního balíčku runu (pro hodnoty a barvy hracích karet v obchodě a obálkách).
 * Počítá se stejně jako při založení runu (stejný seed streamu `deck`), takže vyjde stejné složení.
 */
export function defaultDeckComposition(core: GameCore): CardSpec[] {
  const s = core.state;
  return startingDeckSpecs(core.registry, s.deckId, s.challengeId, rngFromState(cyrb128(`${s.seed}:deck`)));
}

/**
 * Náhodná hrací karta (pro obchod a karetní obálky): hodnota a barva rovnoměrně z výchozího složení
 * startovního balíčku, pak vylepšení, pečeť a edice (DESIGN 2.6) s danými šancemi. Karta není v balíčku,
 * dokud se nekoupí/nevybere.
 */
export function randomPlayingCard(
  core: GameCore,
  rng: Rng,
  chances: { enhancement: number; seal: number },
): Card {
  const base = rng.pick(defaultDeckComposition(core));
  const card = createCard(core.uid(), { suit: base.suit, rank: base.rank });
  const enhancements = Object.keys(core.registry.enhancements).sort();
  const seals = Object.keys(core.registry.seals).sort();
  if (enhancements.length && rng.next() < chances.enhancement) card.enhancement = rng.pick(enhancements);
  if (seals.length && rng.next() < chances.seal) card.seal = rng.pick(seals);
  card.edition = rollEdition(core, rng, 'card');
  return card;
}

type SlotKind = 'joker' | ConsumableKind | 'card';

function generateItem(core: GameCore, rng: Rng, takenJokers: string[]): ShopItem | null {
  const m = core.mods();
  const reg = core.registry;
  // Druh spotřebky, který se v runu neobjevuje (žádná v registru, nebo ji vyřadila výzva), slot nedostane.
  const hasConsumable = (k: ConsumableKind) => consumableKindInRun(core, k);
  const hasJokers = Object.keys(reg.jokers).length > 0 && !m.noJokers;
  const weights: { item: SlotKind; weight: number }[] = [
    { item: 'joker' as const, weight: hasJokers ? m.shopWeightJoker : 0 },
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
    const joker = newJokerInstance(
      core,
      defId,
      rollEdition(core, rng, 'joker'),
      rollStickers(core, rng, defId),
    );
    return { kind: 'joker', joker, price: jokerPrice(core, joker), sold: false };
  }
  if (kind === 'card') {
    const card = randomPlayingCard(core, rng, {
      enhancement: m.playingCardEnhanceChance,
      seal: m.playingCardSealChance,
    });
    return { kind: 'card', card, price: cardPrice(core, card), sold: false };
  }
  const defId = pickConsumableDefId(core, rng, kind);
  if (!defId) return null;
  const consumable = newConsumableInstance(core, defId);
  return {
    kind: 'consumable',
    consumable,
    consumableKind: kind,
    price: consumablePrice(core, consumable),
    sold: false,
  };
}

/**
 * Vygeneruje kartové sloty obchodu (stream `shop`). `exclude` = žolíci, kteří už ve Večerce jsou (položky navíc ze
 * štítků, které přehození nemění) — znovu se nenabídnou.
 */
export function generateShopItems(core: GameCore, exclude: readonly string[] = []): ShopItem[] {
  const rng = core.rng('shop');
  const items: ShopItem[] = [];
  const taken: string[] = [...exclude];
  const n = core.mods().shopCardSlots;
  for (let i = 0; i < n; i++) {
    const item = generateItem(core, rng, taken);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Objevuje se druh obálky v tomto runu? Ne Žolíková při `Modifiers.noJokers`, ne druh vyřazený výzvou
 * (`ChallengeDef.bannedBoosterKinds`) a ne obálka spotřebek, jejichž druh výzva vyřadila (`bannedConsumableKinds`).
 * Platí pro Večerku i obálky zdarma ze štítků (`EngineApi.openBooster`).
 */
export function boosterInRun(core: GameCore, def: Pick<BoosterDef, 'kind'>): boolean {
  const ch = core.challenge();
  if (ch?.bannedBoosterKinds?.includes(def.kind)) return false;
  if (def.kind === 'joker') return !core.mods().noJokers;
  if (def.kind === 'card') return true;
  return !ch?.bannedConsumableKinds?.includes(def.kind);
}

function boosterAllowed(core: GameCore, id: string): boolean {
  const def = core.registry.boosters[id];
  if (def && !boosterInRun(core, def)) return false;
  const pool = core.state.unlockedPool.boosters;
  return !pool || pool.includes(id);
}

/** Normální Žolíková obálka pro první Večerku runu (první podle id), nebo null, když v registru není. */
export function firstShopBoosterId(core: GameCore): string | null {
  const ids = Object.values(core.registry.boosters)
    .filter((b) => b.kind === 'joker' && b.size === 'normal' && boosterAllowed(core, b.id))
    .map((b) => b.id)
    .sort();
  return ids[0] ?? null;
}

/**
 * Obálky ve Večerce (vážené losování, stream `shop`). První Večerka runu má v prvním slotu vždy normální
 * Žolíkovou obálku (DESIGN 2.5.1), pokud v registru je.
 */
export function generateShopBoosters(
  core: GameCore,
  opts: { firstShop?: boolean } = {},
): ShopState['boosters'] {
  const rng = core.rng('shop');
  const out: ShopState['boosters'] = [];
  const guaranteed = opts.firstShop ? firstShopBoosterId(core) : null;
  for (let i = 0; i < core.mods().shopBoosterSlots; i++) {
    const id = i === 0 && guaranteed ? guaranteed : rollShopBoosterId(core, rng);
    if (!id) break;
    out.push({ boosterId: id, price: boosterPrice(core, id), sold: false });
  }
  return out;
}

/** Jedna obálka do slotu Večerky podle vah (null = žádná obálka v registru/poolu). */
function rollShopBoosterId(core: GameCore, rng: Rng): string | null {
  const defs = Object.values(core.registry.boosters)
    .filter((b) => b.weight > 0 && boosterAllowed(core, b.id))
    .sort((a, b) => compareIds(a.id, b.id));
  if (defs.length === 0) return null;
  return rng.weighted(defs.map((d) => ({ item: d.id, weight: d.weight })));
}

/**
 * Doplní otevřenou Večerku na aktuální počet kartových slotů a slotů obálek (kupón „Druhý regál“ / „Regál
 * u pokladny“ platí hned, ne až v příští Večerce). Chybějící sloty se vylosují (stream `shop`) stejně jako při
 * vstupu; vystavené i prodané zboží zůstává. Sloty nikdy neubírá (to se projeví až při přehození / v příští Večerce).
 */
export function syncShopSlots(core: GameCore, shop: ShopState): void {
  const m = core.mods();
  const rng = core.rng('shop');
  // Položky navíc ze štítků (`extra`) se do slotů nepočítají a zůstávají na konci nabídky.
  const regular = shop.items.filter((it) => !it.extra);
  if (regular.length < m.shopCardSlots) {
    const taken = shopJokerIds(shop.items);
    for (let i = regular.length; i < m.shopCardSlots; i++) {
      const item = generateItem(core, rng, taken);
      if (!item) break;
      regular.push(item);
    }
    shop.items = [...regular, ...shop.items.filter((it) => it.extra)];
  }
  for (let i = shop.boosters.length; i < m.shopBoosterSlots; i++) {
    const id = rollShopBoosterId(core, rng);
    if (!id) break;
    shop.boosters.push({ boosterId: id, price: boosterPrice(core, id), sold: false });
  }
}

/** Id žolíků v nabídce (prodaných i neprodaných) — aby se ve stejné Večerce neopakovali. */
export function shopJokerIds(items: readonly ShopItem[]): string[] {
  return items.flatMap((it) => (it.kind === 'joker' ? [it.joker.defId] : []));
}

/**
 * Žolík navíc do otevřené Večerky (`EngineApi.addShopJoker`; štítky Doporučení od známého, Protekce): stream `shop`,
 * jen žolík, který hráč nevlastní a ve Večerce není; edice podle `opts.edition` (jinak hod jako v obchodě), nálepky
 * podle obtížnosti. Položka má `extra` (přehození ji nemění). Vrací false bez Večerky nebo bez žolíka v poolu.
 */
export function addShopJoker(
  core: GameCore,
  opts: {
    rarity?: JokerRarity;
    edition?: EditionId | null;
    priceMult?: number;
    noEditionSurcharge?: boolean;
  } = {},
): boolean {
  const shop = core.state.shop;
  if (!shop) return false;
  const rng = core.rng('shop');
  const defId = pickJokerDefId(core, rng, {
    ...(opts.rarity ? { rarity: opts.rarity } : {}),
    exclude: shopJokerIds(shop.items),
  });
  if (!defId) return false;
  const edition = opts.edition !== undefined ? opts.edition : rollEdition(core, rng, 'joker');
  if (edition !== null && !core.registry.editions[edition]) throw new Error(`Unknown edition ${edition}`);
  const joker = newJokerInstance(core, defId, edition, rollStickers(core, rng, defId));
  const item: ShopItem = { kind: 'joker', joker, price: 0, sold: false, extra: true };
  if (opts.priceMult !== undefined && Number.isFinite(opts.priceMult)) item.priceMult = opts.priceMult;
  if (opts.noEditionSurcharge) item.noEditionSurcharge = true;
  item.price = shopPrice(core.mods(), shopItemBasePrice(core, item));
  shop.items.push(item);
  return true;
}

/**
 * Edice pro prvního neprodaného žolíka bez edice v otevřené Večerce (`EngineApi.setShopJokerEdition`), s `noSurcharge`
 * bez příplatku. Vrací false, když takový žolík v nabídce není.
 */
export function setShopJokerEdition(core: GameCore, edition: EditionId, noSurcharge: boolean): boolean {
  if (!core.registry.editions[edition]) throw new Error(`Unknown edition ${edition}`);
  const shop = core.state.shop;
  const item = shop?.items.find((it) => it.kind === 'joker' && !it.sold && it.joker.edition === null);
  if (!item || item.kind !== 'joker') return false;
  item.joker.edition = edition;
  if (noSurcharge) item.noEditionSurcharge = true;
  item.price = shopPrice(core.mods(), shopItemBasePrice(core, item), item.free);
  return true;
}

/**
 * Kupón navíc jen pro otevřenou Večerku (`EngineApi.addShopVoucher`; Leták ve schránce): stream `shop`, z kupónů, které jde
 * teď koupit (`eligibleVouchers`) a v nabídce nejsou. Do kupónů patra se nezapíše. Vrací id nebo null.
 */
export function addShopVoucher(core: GameCore): string | null {
  const shop = core.state.shop;
  if (!shop) return null;
  const offered = shop.vouchers.map((v) => v.voucherId);
  const pool = eligibleVouchers(core).filter((id) => !offered.includes(id));
  if (pool.length === 0) return null;
  const id = core.rng('shop').pick(pool);
  shop.vouchers.push({ voucherId: id, price: voucherPrice(core, id), sold: false, extra: true });
  return id;
}

/** Smí se kupón teď nabídnout/koupit (`VoucherDef.available`, čistá funkce)? Neznámý kupón ne. */
export function voucherAvailable(core: GameCore, id: string): boolean {
  const def = core.registry.vouchers[id];
  if (!def) return false;
  const check = def.available;
  return !check || core.readOnly(() => check(core.baseCtx('misc')));
}

/**
 * Kupóny, které lze v tomto runu nabídnout (nevlastněné, splněný předpoklad, odemčené, nezakázané a teď dostupné
 * podle `VoucherDef.available`).
 */
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
        !banned.includes(v.id) &&
        voucherAvailable(core, v.id),
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
    .map((id) => ({ voucherId: id, price: voucherPrice(core, id), sold: false }));
}

/** Nová Večerka (při vstupu). `firstShop` = první Večerka runu (zaručená Žolíková obálka). */
export function generateShop(core: GameCore, opts: { firstShop?: boolean } = {}): ShopState {
  const freeRerolls = typeof core.state.flags.freeRerolls === 'number' ? core.state.flags.freeRerolls : 0;
  core.state.flags.freeRerolls = 0;
  const shop: ShopState = {
    items: generateShopItems(core),
    boosters: generateShopBoosters(core, opts),
    vouchers: voucherOffers(core),
    rerollCost: rerollPrice(core.mods(), 0),
    rerollsThisShop: 0,
    paidRerolls: 0,
    freeRerolls,
  };
  refreshShopPrices(core, shop);
  return shop;
}

// ─────────────────────────── Obálky ───────────────────────────

/** Možnosti v obálce (stream `booster`). Možnosti v jedné obálce se neopakují. */
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
      out.push({
        kind: 'joker',
        joker: newJokerInstance(core, defId, rollEdition(core, rng, 'joker'), rollStickers(core, rng, defId)),
      });
    } else if (def.kind === 'card') {
      out.push({
        kind: 'card',
        card: randomPlayingCard(core, rng, {
          enhancement: BOOSTER_CARD_ENHANCE_CHANCE,
          seal: BOOSTER_CARD_SEAL_CHANCE,
        }),
      });
    } else {
      const defId = pickConsumableDefId(core, rng, def.kind, { exclude: taken });
      if (!defId || taken.includes(defId)) break;
      taken.push(defId);
      out.push({
        kind: 'consumable',
        consumable: newConsumableInstance(core, defId),
        consumableKind: def.kind,
      });
    }
  }
  return out;
}

/** Otevře obálku (stav + případná ruka pro cílení babských rad/razítek). */
export function openBooster(
  core: GameCore,
  boosterId: string,
  returnTo: BoosterState['returnTo'],
): BoosterState {
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
