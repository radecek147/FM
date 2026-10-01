/** Losování obsahu (žolíci, spotřebky, edice) z dostupných poolů. */
import type { ConsumableDef, JokerDef, JokerRarity, Rng } from '../content-types';
import type { GameCore } from '../effects/core';
import type { ConsumableKind, EditionId } from '../types';

/** Váhy vzácností žolíků v obchodě/boosterech (legendární jen speciálně). */
export const RARITY_WEIGHTS: Record<JokerRarity, number> = { common: 70, rare: 25, epic: 5, legendary: 0 };

function jokerAllowed(core: GameCore, def: JokerDef): boolean {
  const s = core.state;
  if (s.bannedJokers.includes(def.id)) return false;
  const pool = s.unlockedPool.jokers;
  if (pool && !pool.includes(def.id)) return false;
  return true;
}

/**
 * Vybere id žolíka. Bez `rarity` losuje vzácnost podle RARITY_WEIGHTS.
 * Preferuje žolíky, které hráč ještě nevlastní; když žádný nezbývá, vezme jakéhokoli.
 */
export function pickJokerDefId(
  core: GameCore,
  rng: Rng,
  opts: { rarity?: JokerRarity; exclude?: readonly string[] } = {},
): string | null {
  const all = Object.values(core.registry.jokers).filter((d) => jokerAllowed(core, d));
  if (all.length === 0) return null;
  let rarity = opts.rarity;
  if (!rarity) {
    const available = (Object.keys(RARITY_WEIGHTS) as JokerRarity[]).filter(
      (r) => RARITY_WEIGHTS[r] > 0 && all.some((d) => d.rarity === r && !d.noShop),
    );
    if (available.length === 0) return null;
    rarity = rng.weighted(available.map((r) => ({ item: r, weight: RARITY_WEIGHTS[r] })));
  }
  const owned = new Set(core.state.jokers.map((j) => j.defId));
  const exclude = new Set(opts.exclude ?? []);
  const ofRarity = all.filter((d) => d.rarity === rarity && (opts.rarity === 'legendary' || !d.noShop));
  if (ofRarity.length === 0) return null;
  const fresh = ofRarity.filter((d) => !owned.has(d.id) && !exclude.has(d.id));
  const pool = fresh.length > 0 ? fresh : ofRarity;
  return rng.pick(pool.map((d) => d.id).sort());
}

function consumableAllowed(core: GameCore, def: ConsumableDef): boolean {
  if (def.noShop) return false;
  // Pranostiky tajných kombinací až po jejich objevení.
  if (def.hand) {
    const ht = core.registry.handTypes[def.hand];
    if (ht?.secret && (core.state.handLevels[def.hand]?.played ?? 0) === 0) return false;
  }
  return true;
}

export function pickConsumableDefId(
  core: GameCore,
  rng: Rng,
  kind: ConsumableKind,
  opts: { exclude?: readonly string[] } = {},
): string | null {
  const exclude = new Set(opts.exclude ?? []);
  const pool = Object.values(core.registry.consumables)
    .filter((d) => d.kind === kind && consumableAllowed(core, d))
    .map((d) => d.id)
    .sort();
  if (pool.length === 0) return null;
  const fresh = pool.filter((id) => !exclude.has(id));
  return rng.pick(fresh.length > 0 ? fresh : pool);
}

/**
 * Náhodná edice podle vah edic × Modifiers.editionRateMult.
 * `baseChance` je celková šance na jakoukoli edici při násobiči 1 (součet vah se škáluje na ni).
 */
export function rollEdition(core: GameCore, rng: Rng, forCards: boolean, rateMult = 1): EditionId | null {
  const eds = Object.values(core.registry.editions).filter((e) => (forCards ? e.forCards : true) && e.weight > 0);
  if (eds.length === 0) return null;
  const mult = core.mods().editionRateMult * rateMult;
  // Váhy edic jsou v procentech (např. 2,5 = 2,5 %).
  let r = rng.next() * 100;
  for (const e of eds.sort((a, b) => a.id.localeCompare(b.id))) {
    const w = e.weight * mult;
    if (r < w) return e.id;
    r -= w;
  }
  return null;
}
