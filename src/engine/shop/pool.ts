/** Losování obsahu (žolíci, spotřebky, edice) z dostupných poolů. */
import type { ConsumableDef, EditionDef, JokerDef, JokerRarity, Rng } from '../content-types';
import { FALLBACK_JOKER_ID, RARITY_WEIGHTS } from '../constants';
import type { GameCore } from '../effects/core';
import type { ConsumableKind, EditionId } from '../types';

export { RARITY_WEIGHTS };

/**
 * Řazení id podle kódových jednotek (jako `Array.prototype.sort()` bez komparátoru). Ne `localeCompare`: to závisí
 * na jazyce prostředí (v češtině je „ch“ až za „h“), takže by stejný seed dal v různých prohlížečích jiný run.
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function jokerAllowed(core: GameCore, def: JokerDef): boolean {
  const s = core.state;
  if (s.bannedJokers.includes(def.id)) return false;
  const pool = s.unlockedPool.jokers;
  if (pool && !pool.includes(def.id)) return false;
  return true;
}

/** Pivní tácek — náhradní žolík pro vyčerpaný pool (jen pokud je v registru a není v runu zakázaný). */
function fallbackJoker(core: GameCore): string | null {
  const def = core.registry.jokers[FALLBACK_JOKER_ID];
  return def && !core.state.bannedJokers.includes(def.id) ? def.id : null;
}

/**
 * Vybere id žolíka (DESIGN 2.5.1). Bez `rarity` losuje vzácnost podle `RARITY_WEIGHTS` (jen mezi vzácnostmi,
 * které v obchodě vůbec jsou). Nabízí jen odemčené žolíky, které hráč **nevlastní** a které nejsou v `exclude`
 * (aktuální nabídka). Je-li pool vyčerpaný, vrátí Pivní tácek (`FALLBACK_JOKER_ID`, smí se opakovat), a není-li
 * v registru, null.
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
    if (available.length === 0) return fallbackJoker(core);
    rarity = rng.weighted(available.map((r) => ({ item: r, weight: RARITY_WEIGHTS[r] })));
  }
  const owned = new Set(core.state.jokers.map((j) => j.defId));
  const exclude = new Set(opts.exclude ?? []);
  const pool = all
    .filter((d) => d.rarity === rarity && (opts.rarity === 'legendary' || !d.noShop))
    // Pivní tácek se smí opakovat (v nabídce i ve slotech).
    .filter((d) => d.id === FALLBACK_JOKER_ID || (!owned.has(d.id) && !exclude.has(d.id)))
    .map((d) => d.id)
    .sort();
  if (pool.length === 0) return fallbackJoker(core);
  return rng.pick(pool);
}

function consumableAllowed(core: GameCore, def: ConsumableDef): boolean {
  if (def.noShop) return false;
  // Pranostiky tajných kombinací až po jejich objevení v tomto runu (DESIGN 2.2.4).
  if (def.hand) {
    const ht = core.registry.handTypes[def.hand];
    if (ht?.secret && !core.state.discoveredHands.includes(def.hand)) return false;
  }
  return true;
}

/**
 * Vybere id spotřebky daného typu (vážené `ConsumableDef.weight`, výchozí 1). Preferuje id mimo `exclude`;
 * když žádné nezbývá, vezme libovolné (volající, který nesmí opakovat, si to ohlídá).
 */
export function pickConsumableDefId(
  core: GameCore,
  rng: Rng,
  kind: ConsumableKind,
  opts: { exclude?: readonly string[] } = {},
): string | null {
  const exclude = new Set(opts.exclude ?? []);
  const pool = Object.values(core.registry.consumables)
    .filter((d) => d.kind === kind && consumableAllowed(core, d) && (d.weight ?? 1) > 0)
    .sort((a, b) => compareIds(a.id, b.id));
  if (pool.length === 0) return null;
  const fresh = pool.filter((d) => !exclude.has(d.id));
  return rng.weighted((fresh.length > 0 ? fresh : pool).map((d) => ({ item: d.id, weight: d.weight ?? 1 })));
}

/** Na čem se edice losuje: žolík (obchod, obálka) nebo hrací karta. */
export type EditionTarget = 'joker' | 'card';

/** Šance edice v procentech pro daný cíl. */
function editionChance(e: EditionDef, target: EditionTarget): number {
  return Math.max(0, target === 'joker' ? e.weight : e.weightCard);
}

/**
 * Náhodná edice podle DESIGN 2.6. Šance jsou v procentech (`EditionDef.weight` u žolíka, `weightCard`
 * u hrací karty). Nejdřív samostatné hody na edice se `separateRoll` (negativní — jen žolíci, bez násobiče),
 * pak jeden hod `r` proti kumulativním šancím ostatních edic od nejvzácnější (duhová → holografická → lesklá),
 * vynásobeným `Modifiers.editionRateMult × rateMult`.
 */
export function rollEdition(core: GameCore, rng: Rng, target: EditionTarget, rateMult = 1): EditionId | null {
  const eds = Object.values(core.registry.editions).sort((a, b) => compareIds(a.id, b.id));
  if (target === 'joker') {
    for (const e of eds) {
      if (e.separateRoll && e.weight > 0 && rng.next() * 100 < e.weight) return e.id;
    }
  }
  const pool = eds
    .filter((e) => !e.separateRoll && editionChance(e, target) > 0)
    .sort((a, b) => editionChance(a, target) - editionChance(b, target) || compareIds(a.id, b.id));
  if (pool.length === 0) return null;
  const mult = core.mods().editionRateMult * rateMult;
  const r = rng.next() * 100;
  let acc = 0;
  for (const e of pool) {
    acc += editionChance(e, target) * mult;
    if (r < acc) return e.id;
  }
  return null;
}
