/**
 * Texty meta vrstvy pro UI (sbírka, nová hra, statistiky, oznámení): podmínky odemčení s průběhem, oznámení
 * `MetaNotice`, názvy obsahu podle id a datum bez `Intl` (deterministicky, česky). Vše přes `t()` ze src/i18n.
 */
import type { ContentRegistry, UnlockCondition } from '../engine';
import type { MetaNotice, Profile, UnlockCategory } from '../engine/meta';
import { evaluateUnlock, unlockConditionFor, unlockedByDiscovery } from '../engine/meta';
import type { UnlockTextSpec } from '../engine/meta/unlockText';
import { unlockText, unlockTextFor } from '../engine/meta/unlockText';
import { hasKey, t } from '../i18n/cs';
import { formatNumber } from '../i18n/format';

// ─────────────────────────── Názvy podle id ───────────────────────────

/** Text klíče, nebo záložní text (obsah se mohl mezi verzemi změnit — chybějící klíč nesmí ukázat ⟦…⟧). */
function textOr(key: string, fallback: string): string {
  return hasKey(key) ? t(key) : fallback;
}

export function deckName(id: string): string {
  return textOr(`decks.${id}.name`, id);
}

export function jokerName(id: string): string {
  return textOr(`jokers.${id}.name`, id);
}

export function bossName(id: string): string {
  return textOr(`bosses.${id}.name`, id);
}

export function challengeName(id: string): string {
  return textOr(`challenges.${id}.name`, id);
}

export function achievementName(id: string): string {
  return textOr(`achievements.${id}.name`, id);
}

export function handName(type: string): string {
  return textOr(`hands.${type}.name`, type);
}

/** Název síly piva podle úrovně (`Desítka`), neznámá úroveň = číslo. */
export function stakeName(registry: ContentRegistry, level: number): string {
  const stake = Object.values(registry.stakes).find((s) => s.level === level);
  return stake ? textOr(`stakes.${stake.id}.name`, stake.id) : formatNumber(level);
}

/** Název položky kategorie odemykání (balíček, žolík, kupón, výzva). */
export function unlockSubjectName(category: UnlockCategory, id: string): string {
  switch (category) {
    case 'decks':
      return deckName(id);
    case 'jokers':
      return jokerName(id);
    case 'vouchers':
      return textOr(`vouchers.${id}.name`, id);
    case 'challenges':
      return challengeName(id);
  }
}

// ─────────────────────────── Podmínky odemčení ───────────────────────────

/**
 * Věta z klíčů a parametrů `unlockText` (src/engine/meta/unlockText.ts): text konkrétní položky, je-li v i18n,
 * jinak obecná šablona; `refs` (názvy balíčků, šéfů, kombinací…) se přeloží a dosadí.
 */
export function unlockSpecText(spec: UnlockTextSpec): string {
  const params: Record<string, number | string> = { ...spec.params };
  for (const [name, key] of Object.entries(spec.refs)) params[name] = hasKey(key) ? t(key) : key;
  const key = spec.itemKey && hasKey(spec.itemKey) ? spec.itemKey : spec.key;
  return t(key, params);
}

/** Jedna věta s podmínkou odemčení (bez průběhu). */
export function unlockConditionText(
  cond: UnlockCondition,
  registry: ContentRegistry,
  subject?: { category: UnlockCategory; id: string },
): string {
  return unlockSpecText(unlockText(registry, cond, subject));
}

/** Podmínka odemčení položky s průběhem (sbírka, nová hra). */
export interface UnlockInfo {
  /** Podmínka jednou větou. */
  text: string;
  progress: number;
  target: number;
  met: boolean;
  /** „2 / 5“, nebo null u ano/ne podmínek. */
  progressText: string | null;
}

/**
 * Podmínka odemčení položky a průběh splnění; null = položka nemá podmínku (odemčená od začátku). Legendární žolík
 * bez podmínky se odemyká objevením.
 */
export function unlockInfo(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  category: UnlockCategory,
  id: string,
): UnlockInfo | null {
  const cond = unlockConditionFor(registry, category, id);
  if (!cond) {
    if (category !== 'jokers' || !unlockedByDiscovery(registry, id)) return null;
    const text = unlockSpecText(unlockTextFor(registry, category, id));
    return { text, progress: 0, target: 1, met: false, progressText: null };
  }
  const subject = { category, id };
  const p = evaluateUnlock(cond, profile, undefined, { registry, subject });
  return {
    text: unlockConditionText(cond, registry, subject),
    progress: p.progress,
    target: p.target,
    met: p.met,
    progressText:
      p.target > 1 ? t('meta.collection.progress', { progress: p.progress, target: p.target }) : null,
  };
}

// ─────────────────────────── Oznámení ───────────────────────────

/** Text oznámení „Odemčeno: …“ / „Achievement: …“. */
export function noticeText(notice: MetaNotice, registry: ContentRegistry): string {
  switch (notice.kind) {
    case 'unlock':
      return t(`meta.notice.unlock.${notice.category}`, { name: unlockSubjectName(notice.category, notice.id) });
    case 'stake':
      return t('meta.notice.stake', {
        stake: stakeName(registry, notice.stake),
        deck: deckName(notice.deckId),
      });
    case 'achievement':
      return t('meta.notice.achievement', { name: achievementName(notice.id) });
  }
}

// ─────────────────────────── Datum ───────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2. 10. 2026` (místní čas); neplatné datum = pomlčka. */
export function formatDate(iso: string): string {
  const d = parseDate(iso);
  if (!d) return t('meta.stats.overview.none');
  return t('meta.date.day', { d: d.getDate(), m: d.getMonth() + 1, y: d.getFullYear() });
}

/** `2. 10. 2026, 14:05` (místní čas); neplatné datum = pomlčka. */
export function formatDateTime(iso: string): string {
  const d = parseDate(iso);
  if (!d) return t('meta.stats.overview.none');
  return t('meta.date.dateTime', {
    d: d.getDate(),
    m: d.getMonth() + 1,
    y: d.getFullYear(),
    h: d.getHours(),
    min: pad2(d.getMinutes()),
  });
}

/** Klíč dne denního runu `YYYYMMDD` → `1. 10. 2026` (den v UTC, jak ho určuje seed). */
export function formatDateKey(key: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return key;
  return t('meta.date.day', { d: Number(m[3]), m: Number(m[2]), y: Number(m[1]) });
}
