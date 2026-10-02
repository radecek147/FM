/**
 * Sbírka (codex, DESIGN 11.4): stav položky (neodemčená / neobjevená / objevená), štítek „Nové“ a pomocníci
 * statistik pro obrazovky.
 */
import type { ContentRegistry } from '../content-types';
import { SECRET_HAND_TYPES } from '../types';
import type { HandType } from '../types';
import {
  isChallengeUnlocked,
  isDeckUnlocked,
  isJokerUnlocked,
  isVoucherUnlocked,
  maxStakeFor,
} from './unlocks';
import type { CollectionCategory, CollectionState, Profile } from './types';

/** Stav položky ve sbírce. Neznámé id = `locked`. */
export function collectionState(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  category: CollectionCategory,
  id: string,
): CollectionState {
  const seen = (cat: keyof Profile['discovered']): CollectionState =>
    profile.discovered[cat].includes(id) ? 'discovered' : 'unknown';
  switch (category) {
    case 'jokers':
      if (!registry.jokers[id] || !isJokerUnlocked(profile, registry, id)) return 'locked';
      return seen('jokers');
    case 'vouchers':
      if (!registry.vouchers[id] || !isVoucherUnlocked(profile, registry, id)) return 'locked';
      return seen('vouchers');
    case 'consumables':
      return registry.consumables[id] ? seen('consumables') : 'locked';
    case 'tags':
      return registry.tags[id] ? seen('tags') : 'locked';
    case 'bosses':
      return registry.bosses[id] ? seen('bosses') : 'locked';
    case 'boosters':
      return registry.boosters[id] ? seen('boosters') : 'locked';
    case 'enhancements':
      return registry.enhancements[id] ? seen('enhancements') : 'locked';
    case 'seals':
      return registry.seals[id] ? seen('seals') : 'locked';
    case 'editions':
      return registry.editions[id] ? seen('editions') : 'locked';
    case 'decks':
      return isDeckUnlocked(profile, registry, id) ? 'discovered' : 'locked';
    case 'hands': {
      const def = registry.handTypes[id as HandType];
      if (!def) return 'locked';
      const secret = def.secret || SECRET_HAND_TYPES.includes(id as HandType);
      return !secret || profile.discovered.hands.includes(id) ? 'discovered' : 'unknown';
    }
    case 'stakes': {
      const stake = registry.stakes[id];
      if (!stake) return 'locked';
      return Object.keys(registry.decks).some((d) => maxStakeFor(profile, registry, d) >= stake.level)
        ? 'discovered'
        : 'locked';
    }
    case 'challenges':
      return isChallengeUnlocked(profile, registry, id) ? 'discovered' : 'locked';
    case 'achievements':
      return profile.achievements.unlocked[id] !== undefined ? 'discovered' : 'locked';
  }
}

// ─────────────────────────── „Nové“ ───────────────────────────

/** Klíč položky v `Profile.unseen`. */
export function unseenKey(category: CollectionCategory, id: string): string {
  return `${category}:${id}`;
}

/** Má položka štítek „Nové“? */
export function isUnseen(profile: Readonly<Profile>, category: CollectionCategory, id: string): boolean {
  return profile.unseen.includes(unseenKey(category, id));
}

/** Počet „Nových“ (v kategorii, nebo celkem). */
export function unseenCount(profile: Readonly<Profile>, category?: CollectionCategory): number {
  if (!category) return profile.unseen.length;
  const prefix = `${category}:`;
  return profile.unseen.filter((k) => k.startsWith(prefix)).length;
}

/** Hráč položky viděl — sundá štítek „Nové“. Mutuje profil. */
export function markSeen(profile: Profile, category: CollectionCategory, ids: readonly string[]): void {
  const keys = new Set(ids.map((id) => unseenKey(category, id)));
  profile.unseen = profile.unseen.filter((k) => !keys.has(k));
}

// ─────────────────────────── Statistiky ───────────────────────────

/** Klíč s nejvyšší hodnotou (shoda → abecedně první), nebo null. */
export function topEntry(
  map: Readonly<Record<string, number | undefined>>,
): { id: string; value: number } | null {
  let best: { id: string; value: number } | null = null;
  for (const id of Object.keys(map).sort()) {
    const value = map[id] ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { id, value };
  }
  return best;
}

/** Podíl výher 0–1 (0 při žádném runu). */
export function winRate(played: number, won: number): number {
  return played > 0 ? Math.min(1, won / played) : 0;
}
