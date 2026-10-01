/**
 * Sestavení registru obsahu pro engine + kontrola konzistence.
 * Engine obsah nikdy neimportuje přímo — dostává ho přes `ContentRegistry`.
 */
import type { ContentRegistry } from '../engine/content-types';
import { BOOSTERS } from './boosters';
import { BOSSES } from './bosses';
import { CHALLENGES } from './challenges';
import { CONSUMABLES } from './consumables';
import { DECKS } from './decks';
import { HAND_TYPE_DEFS } from './hands';
import { JOKERS } from './jokers';
import { EDITIONS, ENHANCEMENTS, SEALS } from './modifiers';
import { STAKES } from './stakes';
import { TAGS } from './tags';
import { VOUCHERS } from './vouchers';

function byId<T extends { id: string }>(kind: string, items: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const it of items) {
    if (out[it.id]) throw new Error(`Duplicate ${kind} id: ${it.id}`);
    out[it.id] = it;
  }
  return out;
}

export function buildRegistry(): ContentRegistry {
  return {
    handTypes: HAND_TYPE_DEFS,
    jokers: byId('joker', JOKERS),
    consumables: byId('consumable', CONSUMABLES),
    enhancements: byId('enhancement', ENHANCEMENTS),
    seals: byId('seal', SEALS),
    editions: byId('edition', EDITIONS),
    bosses: byId('boss', BOSSES),
    tags: byId('tag', TAGS),
    vouchers: byId('voucher', VOUCHERS),
    boosters: byId('booster', BOOSTERS),
    decks: byId('deck', DECKS),
    stakes: byId('stake', STAKES),
    challenges: byId('challenge', CHALLENGES),
  };
}

/** Vrátí seznam problémů konzistence (prázdný = vše v pořádku). */
export function validateRegistry(reg: ContentRegistry): string[] {
  const problems: string[] = [];
  for (const v of Object.values(reg.vouchers)) {
    if (v.requires && !reg.vouchers[v.requires])
      problems.push(`voucher ${v.id} requires unknown ${v.requires}`);
    if (v.tier === 2 && !v.requires) problems.push(`voucher ${v.id} is tier 2 without requires`);
  }
  for (const c of Object.values(reg.challenges)) {
    if (!reg.decks[c.deckId]) problems.push(`challenge ${c.id} uses unknown deck ${c.deckId}`);
    for (const j of c.startingJokers ?? [])
      if (!reg.jokers[j.defId]) problems.push(`challenge ${c.id}: unknown joker ${j.defId}`);
    for (const j of c.bannedJokers ?? [])
      if (!reg.jokers[j]) problems.push(`challenge ${c.id}: unknown banned joker ${j}`);
    for (const v of c.startingVouchers ?? [])
      if (!reg.vouchers[v]) problems.push(`challenge ${c.id}: unknown voucher ${v}`);
    for (const v of c.startingConsumables ?? [])
      if (!reg.consumables[v]) problems.push(`challenge ${c.id}: unknown consumable ${v}`);
  }
  for (const c of Object.values(reg.consumables)) {
    if (c.kind === 'pranostika' && !c.hand) problems.push(`pranostika ${c.id} has no hand`);
    if (c.hand && !reg.handTypes[c.hand]) problems.push(`consumable ${c.id}: unknown hand ${c.hand}`);
  }
  const levels = Object.values(reg.stakes)
    .map((s) => s.level)
    .sort((a, b) => a - b);
  levels.forEach((l, i) => {
    if (l !== i + 1) problems.push(`stake levels must be 1..N contiguous (got ${levels.join(',')})`);
  });
  return [...new Set(problems)];
}

let cached: ContentRegistry | null = null;
/** Sdílený registr (sestaví se jednou). */
export function registry(): ContentRegistry {
  if (!cached) cached = buildRegistry();
  return cached;
}
