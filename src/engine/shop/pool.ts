/** Losování obsahu (žolíci, spotřebky, edice) z dostupných poolů. */
import type { ConsumableDef, EditionDef, JokerDef, JokerRarity, Rng } from '../content-types';
import { FALLBACK_JOKER_ID, RARITY_WEIGHTS } from '../constants';
import type { GameCore } from '../effects/core';
import type { ConsumableKind, EditionId, StickerId } from '../types';

export { RARITY_WEIGHTS };

/**
 * Řazení id podle kódových jednotek (jako `Array.prototype.sort()` bez komparátoru). Ne `localeCompare`: to závisí
 * na jazyce prostředí (v češtině je „ch“ až za „h“), takže by stejný seed dal v různých prohlížečích jiný run.
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Smí žolík nést nálepku? (`JokerDef.noEternal`, `noRental`, `noPerishable`) */
export function stickerAllowed(def: JokerDef | undefined, sticker: StickerId): boolean {
  if (sticker === 'eternal') return def?.noEternal !== true;
  if (sticker === 'rental') return def?.noRental !== true;
  return def?.noPerishable !== true;
}

/**
 * Smí se žolík v tomto runu vůbec objevit (bez ohledu na odemčení)? Ne při `Modifiers.noJokers` (Suchý únor), ne
 * zakázaný výzvou a ne žolík, který nesmí nést vynucenou nálepku výzvy (`ChallengeDef.jokerSticker`).
 */
export function jokerInRun(core: GameCore, def: JokerDef): boolean {
  if (core.mods().noJokers || core.state.bannedJokers.includes(def.id)) return false;
  const sticker = core.challenge()?.jokerSticker;
  return !sticker || stickerAllowed(def, sticker);
}

function jokerAllowed(core: GameCore, def: JokerDef): boolean {
  if (!jokerInRun(core, def)) return false;
  const pool = core.state.unlockedPool.jokers;
  if (pool && !pool.includes(def.id)) return false;
  return true;
}

/** Pivní tácek — náhradní žolík pro vyčerpaný pool (jen pokud je v registru a smí se v runu objevit). */
function fallbackJoker(core: GameCore): string | null {
  const def = core.registry.jokers[FALLBACK_JOKER_ID];
  return def && jokerInRun(core, def) ? def.id : null;
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
  const pool = jokerCandidates(core, all, rarity, opts.rarity === 'legendary', opts.exclude);
  if (pool.length === 0) return fallbackJoker(core);
  return rng.pick(pool);
}

/**
 * Seřazená id žolíků dané vzácnosti, ze kterých se losuje: nevlastněné a mimo `exclude` (Pivní tácek se smí
 * opakovat); `noShop` jen s `allowNoShop` (výslovně vyžádaný legendární žolík).
 */
function jokerCandidates(
  core: GameCore,
  all: readonly JokerDef[],
  rarity: JokerRarity,
  allowNoShop: boolean,
  exclude: readonly string[] = [],
): string[] {
  const owned = new Set(core.state.jokers.map((j) => j.defId));
  const excluded = new Set(exclude);
  return (
    all
      .filter((d) => d.rarity === rarity && (allowNoShop || !d.noShop))
      // Pivní tácek se smí opakovat (v nabídce i ve slotech).
      .filter((d) => d.id === FALLBACK_JOKER_ID || (!owned.has(d.id) && !excluded.has(d.id)))
      .map((d) => d.id)
      .sort()
  );
}

/**
 * Náhodní startovní žolíci výzvy (`ChallengeDef.startingRandomJokers`, Velký třesk): stream `joker`, z celého registru
 * dané vzácnosti **bez ohledu na odemčení** (výzva má pro všechny stejné podmínky), bez zakázaných, bez vlastněných,
 * bez opakování a bez žolíků, kteří nesmí nést zadané nálepky. `noShop` (legendární) nevadí — jsou vyžádaní výslovně.
 */
export function pickStartingJokers(
  core: GameCore,
  spec: { rarity: JokerRarity; count: number; stickers?: readonly StickerId[] },
): string[] {
  const owned = new Set(core.state.jokers.map((j) => j.defId));
  const pool = Object.values(core.registry.jokers)
    .filter(
      (d) =>
        d.rarity === spec.rarity &&
        jokerInRun(core, d) &&
        !owned.has(d.id) &&
        (spec.stickers ?? []).every((st) => stickerAllowed(d, st)),
    )
    .map((d) => d.id)
    .sort(compareIds);
  const rng = core.rng('joker');
  const out: string[] = [];
  const count = Number.isFinite(spec.count) ? Math.max(0, Math.trunc(spec.count)) : 0;
  for (let i = 0; i < count && pool.length > 0; i++) {
    const id = rng.pick(pool);
    out.push(id);
    pool.splice(pool.indexOf(id), 1);
  }
  return out;
}

/**
 * Id žolíků, ze kterých by teď losoval `pickJokerDefId` (a tedy `EngineApi.createJoker`) se stejnou `rarity` —
 * bez náhradního žolíka pro vyčerpaný pool. Bez `rarity` sjednocení vzácností, které se v obchodě losují.
 */
export function availableJokerIds(core: GameCore, opts: { rarity?: JokerRarity } = {}): string[] {
  const all = Object.values(core.registry.jokers).filter((d) => jokerAllowed(core, d));
  if (opts.rarity) return jokerCandidates(core, all, opts.rarity, opts.rarity === 'legendary');
  return (Object.keys(RARITY_WEIGHTS) as JokerRarity[])
    .filter((r) => RARITY_WEIGHTS[r] > 0)
    .flatMap((r) => jokerCandidates(core, all, r, false))
    .sort();
}

/**
 * Smí se spotřebka v tomto runu objevit? Ne zakázaná výzvou (`ChallengeDef.bannedConsumables`) a ne druh, který výzva
 * vyřadila (`bannedConsumableKinds`, Kamenolom: babské rady) — platí pro Večerku, obálky i efekty.
 */
export function consumableInRun(core: GameCore, def: Pick<ConsumableDef, 'id' | 'kind'>): boolean {
  const ch = core.challenge();
  if (!ch) return true;
  return !ch.bannedConsumableKinds?.includes(def.kind) && !ch.bannedConsumables?.includes(def.id);
}

/** Objevuje se v runu aspoň jedna spotřebka daného druhu (Večerka, obálky)? */
export function consumableKindInRun(core: GameCore, kind: ConsumableKind): boolean {
  return Object.values(core.registry.consumables).some(
    (c) => c.kind === kind && !c.noShop && (c.weight ?? 1) > 0 && consumableInRun(core, c),
  );
}

function consumableAllowed(core: GameCore, def: ConsumableDef): boolean {
  if (def.noShop || !consumableInRun(core, def)) return false;
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
