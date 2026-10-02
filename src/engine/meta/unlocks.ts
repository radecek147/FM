/**
 * Odemykání (DESIGN 9, 10, 11.1, 11.3): vyhodnocení `UnlockCondition`, stav odemčení položek, pool obsahu pro nový
 * run a obnova odemčení po každé události. Podmínky se vyhodnocují **jen ze stavu profilu** (statistiky
 * a rekordy se aktualizují živě během runu), takže stejná funkce dá i průběh do sbírky.
 */
import type { ContentRegistry, UnlockCondition, UnlockRecordStat, UnlockStat } from '../content-types';
import type { RunState } from '../types';
import { HAND_TYPES } from '../types';
import type { MetaNotice, Profile, UnlockCategory } from './types';

/** Výsledek vyhodnocení podmínky: splněno + průběh (`progress` ≤ `target`) pro sbírku. */
export interface UnlockProgress {
  met: boolean;
  progress: number;
  target: number;
}

/** Kontext vyhodnocení: run (pokud běží), registr a položka, jejíž podmínka se vyhodnocuje (tier 2 kupónu). */
export interface UnlockEvalCtx {
  run?: Readonly<RunState>;
  registry?: ContentRegistry;
  subject?: { category: UnlockCategory; id: string };
}

/** Vlastní vyhodnocovač podmínky `{ type: 'custom', id }`. Čistá funkce. */
export type CustomUnlockFn = (profile: Readonly<Profile>, ctx: UnlockEvalCtx) => boolean | UnlockProgress;

/** Kolik výher odemyká výzvy podle pořadí: 1–5 po 1 výhře, 6–10 po 3, 11–15 po 6, 16–20 po 10 (DESIGN 11.1). */
export const CHALLENGE_UNLOCK_WINS: readonly number[] = [1, 3, 6, 10];
/** Velikost skupiny výzev se stejnou podmínkou. */
export const CHALLENGE_UNLOCK_GROUP = 5;
/** Tier 2 kupónu: tier 1 koupený ve 2 různých runech, nebo 3 výhry (DESIGN 11.3). */
export const VOUCHER_TIER2_RUNS = 2;
export const VOUCHER_TIER2_WINS = 3;

function progress(value: number, target: number): UnlockProgress {
  const t = Math.max(1, target);
  const v = Number.isFinite(value) ? value : 0;
  return { met: v >= t, progress: Math.max(0, Math.min(v, t)), target: t };
}

function flag(met: boolean): UnlockProgress {
  return { met, progress: met ? 1 : 0, target: 1 };
}

/** Nejvyšší úroveň libovolné kombinace (výchozí 1). */
export function maxHandLevel(profile: Readonly<Profile>): number {
  return Math.max(1, ...Object.values(profile.stats.records.handLevels).map((n) => n ?? 1));
}

/** Celkem odehraných runů včetně výzev (ne seedovaných). */
export function totalRunsPlayed(profile: Readonly<Profile>): number {
  let n = profile.stats.runs.played;
  for (const c of Object.values(profile.stats.challenges)) n += c.attempts;
  return n;
}

/** Počet různých dokončených výzev. */
export function challengesCompleted(profile: Readonly<Profile>): number {
  return Object.values(profile.stats.challenges).filter((c) => c.completed > 0).length;
}

const RECORD_STATS: readonly UnlockRecordStat[] = [
  'maxMoney',
  'maxJokers',
  'maxSealedCards',
  'maxVouchers',
  'maxHandLevel',
  'highestAnte',
  'bestHandScore',
  'bestRoundScore',
];

/** Hodnota počítadla nebo rekordu profilu pro podmínku `stat`. */
export function statValue(profile: Readonly<Profile>, stat: UnlockStat): number {
  const s = profile.stats;
  if ((RECORD_STATS as readonly string[]).includes(stat)) {
    switch (stat as UnlockRecordStat) {
      case 'maxHandLevel':
        return maxHandLevel(profile);
      case 'bestHandScore':
        return s.bestHand?.score ?? 0;
      case 'maxMoney':
        return s.records.maxMoney;
      case 'maxJokers':
        return s.records.maxJokers;
      case 'maxSealedCards':
        return s.records.maxSealedCards;
      case 'maxVouchers':
        return s.records.maxVouchers;
      case 'highestAnte':
        return s.records.highestAnte;
      case 'bestRoundScore':
        return s.records.bestRoundScore;
    }
  }
  return s.totals[stat as keyof typeof s.totals] ?? 0;
}

/** Počet různých kombinací, které hráč kdy zahrál (napříč započítanými runy). */
export function distinctHandsPlayed(profile: Readonly<Profile>): number {
  return HAND_TYPES.filter((t) => (profile.stats.handTypes[t] ?? 0) > 0).length;
}

// ─────────────────────────── Vlastní podmínky ───────────────────────────

/**
 * Čísla vestavěných vlastních podmínek — sdílí je vyhodnocovač i text podmínky ve sbírce (`unlockText` dosadí
 * `count` / `level` / `runs` / `wins` do `meta.unlock.cond.custom.<id>`), takže text a pravidlo nemůžou odjet od sebe.
 */
export const CUSTOM_UNLOCK_PARAMS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  vouchersBought5: { count: 5 },
  sealedCardsInRun: { count: 5 },
  roundEndInDebt: {},
  radyUsed30: { count: 30 },
  jokersSold25: { count: 25 },
  handLevel6: { level: 6 },
  voucherTier1TwoRuns: { runs: VOUCHER_TIER2_RUNS, wins: VOUCHER_TIER2_WINS },
  distinctHands8: { count: 8 },
};

function customParam(id: string, key: string): number {
  return CUSTOM_UNLOCK_PARAMS[id]?.[key] ?? 1;
}

const BUILTIN_CUSTOM_UNLOCKS: Record<string, CustomUnlockFn> = {
  /** Úřednický: kup celkem 5 kupónů. */
  vouchersBought5: (p) => progress(p.stats.totals.vouchersBought, customParam('vouchersBought5', 'count')),
  /** Notářský: měj v jednom runu 5 karet s pečetí. */
  sealedCardsInRun: (p) => progress(p.stats.records.maxSealedCards, customParam('sealedCardsInRun', 'count')),
  /** Dlužník: dokonči kolo se záporným zůstatkem. */
  roundEndInDebt: (p) => flag((p.stats.records.minRoundEndMoney ?? 0) < 0),
  /** Babiččin: použij celkem 30 babských rad. */
  radyUsed30: (p) => progress(p.stats.totals.radyUsed, customParam('radyUsed30', 'count')),
  /** Vetešnický: prodej celkem 25 žolíků. */
  jokersSold25: (p) => progress(p.stats.totals.jokersSold, customParam('jokersSold25', 'count')),
  /** Kalendářový: zvyš libovolnou kombinaci na úroveň 6. */
  handLevel6: (p) => progress(maxHandLevel(p), customParam('handLevel6', 'level')),
  /** Pivní sommelier: zahraj 8 různých kombinací (napříč runy — ochutnávka se nemusí stihnout za jeden večer). */
  distinctHands8: (p) => progress(distinctHandsPlayed(p), customParam('distinctHands8', 'count')),
  /**
   * Tier 2 kupónu: jeho tier 1 (`requires`) koupený ve 2 různých runech, nebo 3 výhry. Bez známého subjektu
   * (kupón v registru) jen podle výher.
   */
  voucherTier1TwoRuns: (p, ctx) => {
    const wins = p.stats.runs.won;
    const id = ctx.subject?.category === 'vouchers' ? ctx.subject.id : null;
    const requires = id ? ctx.registry?.vouchers[id]?.requires : undefined;
    const runs = requires ? (p.stats.voucherRuns[requires] ?? 0) : 0;
    const met = runs >= VOUCHER_TIER2_RUNS || wins >= VOUCHER_TIER2_WINS;
    return {
      met,
      progress: met ? VOUCHER_TIER2_RUNS : Math.min(runs, VOUCHER_TIER2_RUNS),
      target: VOUCHER_TIER2_RUNS,
    };
  },
};

const customUnlocks: Record<string, CustomUnlockFn> = { ...BUILTIN_CUSTOM_UNLOCKS };

/** Zaregistruje vlastní vyhodnocovač podmínky `custom` (obsah, testy). Existující id přepíše. */
export function registerCustomUnlock(id: string, fn: CustomUnlockFn): void {
  customUnlocks[id] = fn;
}

/** Id všech známých vlastních podmínek (kontrola konzistence obsahu). */
export function knownCustomUnlocks(): string[] {
  return Object.keys(customUnlocks).sort();
}

// ─────────────────────────── Vyhodnocení ───────────────────────────

/**
 * Vyhodnotí podmínku odemčení nad profilem. Výhry (`winRun`, `winsTotal`) počítají hlavní hru a oficiální denní
 * run; počítadla a rekordy všechny započítané runy (i výzvy). Neznámá vlastní podmínka = nesplněno.
 */
export function evaluateUnlock(
  cond: UnlockCondition,
  profile: Readonly<Profile>,
  run?: Readonly<RunState>,
  ctx: Omit<UnlockEvalCtx, 'run'> = {},
): UnlockProgress {
  const s = profile.stats;
  switch (cond.type) {
    case 'winRun': {
      if (cond.deck) {
        const d = s.byDeck[cond.deck];
        return cond.stake !== undefined ? flag((d?.bestStake ?? 0) >= cond.stake) : flag((d?.won ?? 0) > 0);
      }
      if (cond.stake !== undefined) {
        const stake = cond.stake;
        return flag(Object.values(s.byDeck).some((d) => d.bestStake >= stake));
      }
      return flag(s.runs.won > 0);
    }
    case 'reachAnte':
      return progress(s.records.highestAnte, cond.ante);
    case 'playHand':
      return progress(s.handTypes[cond.hand] ?? 0, cond.count ?? 1);
    case 'scoreInHand':
      return progress(s.bestHand?.score ?? 0, cond.atLeast);
    case 'haveMoney':
      return progress(s.records.maxMoney, cond.atLeast);
    case 'winsTotal':
      return progress(s.runs.won, cond.count);
    case 'runsTotal':
      return progress(totalRunsPlayed(profile), cond.count);
    case 'discover':
      return progress(profile.discovered[cond.category]?.length ?? 0, cond.count);
    case 'stat':
      return progress(statValue(profile, cond.stat), cond.atLeast);
    case 'roundEndMoney': {
      const min = s.records.minRoundEndMoney;
      return flag(min !== null && min <= cond.atMost);
    }
    case 'handLevel': {
      const level = cond.hand ? (s.records.handLevels[cond.hand] ?? 1) : maxHandLevel(profile);
      return progress(level, cond.level);
    }
    case 'beatBoss':
      return progress(
        cond.boss ? (s.bosses[cond.boss]?.defeated ?? 0) : s.totals.bossesDefeated,
        cond.count ?? 1,
      );
    case 'useConsumable': {
      let n = s.totals.consumablesUsed;
      if (cond.id) n = s.consumableUses[cond.id] ?? 0;
      else if (cond.kind === 'pranostika') n = s.totals.pranostikyUsed;
      else if (cond.kind === 'rada') n = s.totals.radyUsed;
      else if (cond.kind === 'razitko') n = s.totals.razitkaUsed;
      return progress(n, cond.count ?? 1);
    }
    case 'winChallenge':
      return cond.challenge
        ? flag((s.challenges[cond.challenge]?.completed ?? 0) > 0)
        : progress(challengesCompleted(profile), cond.count ?? 1);
    case 'achievement':
      return flag(profile.achievements.unlocked[cond.id] !== undefined);
    case 'custom': {
      const fn = customUnlocks[cond.id];
      if (!fn) return flag(false);
      try {
        const r = fn(profile, { ...ctx, run });
        return typeof r === 'boolean' ? flag(r) : r;
      } catch {
        return flag(false);
      }
    }
  }
}

// ─────────────────────────── Stav odemčení položek ───────────────────────────

/** Výchozí podmínka výzvy podle pořadí v registru (výzva bez vlastního `unlock`). */
export function challengeDefaultUnlock(index: number): UnlockCondition {
  const group = Math.min(
    CHALLENGE_UNLOCK_WINS.length - 1,
    Math.max(0, Math.floor(index / CHALLENGE_UNLOCK_GROUP)),
  );
  return { type: 'winsTotal', count: CHALLENGE_UNLOCK_WINS[group] ?? 1 };
}

/**
 * Platná podmínka odemčení položky (pro sbírku a vyhodnocení): `unlock` z definice; u výzvy bez něj výchozí
 * podle pořadí; null = odemčeno od začátku. Legendární žolík bez `unlock` vrací null — odemyká se objevením
 * (`isJokerUnlocked`).
 */
export function unlockConditionFor(
  registry: ContentRegistry,
  category: UnlockCategory,
  id: string,
): UnlockCondition | null {
  switch (category) {
    case 'decks':
      return registry.decks[id]?.unlock ?? null;
    case 'jokers':
      return registry.jokers[id]?.unlock ?? null;
    case 'vouchers':
      return registry.vouchers[id]?.unlock ?? null;
    case 'challenges': {
      const def = registry.challenges[id];
      if (!def) return null;
      return def.unlock ?? challengeDefaultUnlock(Object.keys(registry.challenges).indexOf(id));
    }
  }
}

/** Legendární žolík bez vlastní podmínky — odemyká se objevením (DESIGN 11.3). */
export function unlockedByDiscovery(registry: ContentRegistry, jokerId: string): boolean {
  const def = registry.jokers[jokerId];
  return !!def && def.rarity === 'legendary' && !def.unlock;
}

export function isJokerUnlocked(profile: Readonly<Profile>, registry: ContentRegistry, id: string): boolean {
  const def = registry.jokers[id];
  if (!def) return false;
  if (unlockedByDiscovery(registry, id)) return profile.discovered.jokers.includes(id);
  return !def.unlock || profile.unlocks.jokers.includes(id);
}

export function isDeckUnlocked(profile: Readonly<Profile>, registry: ContentRegistry, id: string): boolean {
  const def = registry.decks[id];
  return !!def && (!def.unlock || profile.unlocks.decks.includes(id));
}

export function isVoucherUnlocked(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  id: string,
): boolean {
  const def = registry.vouchers[id];
  return !!def && (!def.unlock || profile.unlocks.vouchers.includes(id));
}

export function isChallengeUnlocked(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  id: string,
): boolean {
  return !!registry.challenges[id] && profile.unlocks.challenges.includes(id);
}

/** Je položka kategorie odemčená? */
export function isUnlocked(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  category: UnlockCategory,
  id: string,
): boolean {
  switch (category) {
    case 'decks':
      return isDeckUnlocked(profile, registry, id);
    case 'jokers':
      return isJokerUnlocked(profile, registry, id);
    case 'vouchers':
      return isVoucherUnlocked(profile, registry, id);
    case 'challenges':
      return isChallengeUnlocked(profile, registry, id);
  }
}

/** Nejvyšší úroveň síly piva v registru (aspoň 1). */
export function maxStakeLevel(registry: ContentRegistry): number {
  return Math.max(1, ...Object.values(registry.stakes).map((s) => s.level));
}

/** Nejvyšší odemčená síla piva pro balíček (Desítka vždy; DESIGN 10). */
export function maxStakeFor(profile: Readonly<Profile>, registry: ContentRegistry, deckId: string): number {
  return Math.max(1, Math.min(maxStakeLevel(registry), profile.unlocks.stakes[deckId] ?? 1));
}

export function isStakeUnlocked(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  deckId: string,
  stake: number,
): boolean {
  return stake >= 1 && stake <= maxStakeFor(profile, registry, deckId);
}

/** Pro jaký druh runu se pool skládá. */
export type PoolMode = 'normal' | 'challenge' | 'daily' | 'seeded';

/**
 * Obsah dostupný v novém runu (`NewRunOptions.unlockedPool` → `RunState.unlockedPool`). Denní a seedovaný run
 * používají celý obsah (stejný seed = stejný run pro všechny hráče, DESIGN 11.6–11.7); hlavní hra a výzvy jen
 * odemčené žolíky a kupóny. Legendární žolíci bez podmínky jsou v poolu vždy — odemykají se objevením
 * (z razítka), takže musí jít vytvořit. Obálky se neodemykají (null = vše).
 */
export function unlockedPoolFor(
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  mode: PoolMode,
): RunState['unlockedPool'] {
  if (mode === 'daily' || mode === 'seeded') return { jokers: null, vouchers: null, boosters: null };
  return {
    jokers: Object.keys(registry.jokers).filter(
      (id) => unlockedByDiscovery(registry, id) || isJokerUnlocked(profile, registry, id),
    ),
    vouchers: Object.keys(registry.vouchers).filter((id) => isVoucherUnlocked(profile, registry, id)),
    boosters: null,
  };
}

// ─────────────────────────── Obnova odemčení ───────────────────────────

/** Přidá `kategorie:id` mezi „Nové“ (bez duplicit). */
export function addUnseen(profile: Profile, key: string): void {
  if (!profile.unseen.includes(key)) profile.unseen.push(key);
}

const UNLOCK_ORDER: readonly UnlockCategory[] = ['decks', 'jokers', 'vouchers', 'challenges'];

function idsOf(registry: ContentRegistry, category: UnlockCategory): string[] {
  switch (category) {
    case 'decks':
      return Object.keys(registry.decks);
    case 'jokers':
      return Object.keys(registry.jokers);
    case 'vouchers':
      return Object.keys(registry.vouchers);
    case 'challenges':
      return Object.keys(registry.challenges);
  }
}

/**
 * Vyhodnotí podmínky všech dosud neodemčených položek a splněné zapíše do `profile.unlocks` (+ „Nové“).
 * Vrací oznámení o nových odemčeních. Mutuje profil.
 */
export function refreshUnlocks(
  profile: Profile,
  registry: ContentRegistry,
  run?: Readonly<RunState>,
): MetaNotice[] {
  const notices: MetaNotice[] = [];
  for (const category of UNLOCK_ORDER) {
    const list = profile.unlocks[category];
    for (const id of idsOf(registry, category)) {
      if (list.includes(id)) continue;
      const cond = unlockConditionFor(registry, category, id);
      if (!cond) continue;
      if (!evaluateUnlock(cond, profile, run, { registry, subject: { category, id } }).met) continue;
      list.push(id);
      addUnseen(profile, `${category}:${id}`);
      notices.push({ kind: 'unlock', category, id });
    }
  }
  return notices;
}
