/**
 * Vyhodnocení achievementů (DESIGN 11.2). Definice (`AchievementDef`) jsou obsah v `src/content/achievements.ts`
 * a do meta přicházejí přes `ContentRegistry.achievements`. Kontrola je čistá funkce nad `AchievementCtx`;
 * výjimka v ní = nesplněno (rozbitý achievement nesmí shodit hru).
 */
import type { ContentRegistry } from '../content-types';
import { BASE_MODIFIERS } from '../effects/modifiers';
import { Game } from '../run/game';
import type { GameEvent, Modifiers, RunState } from '../types';
import { addUnseen } from './unlocks';
import type { AchievementCtx, AchievementDef, CurrentRunMeta, MetaCtx, MetaNotice, Profile } from './types';

/** Achievementy z registru v pořadí obsahu. */
export function achievementList(registry: ContentRegistry): AchievementDef[] {
  return Object.values(registry.achievements ?? {});
}

/**
 * Modifikátory runu: z `MetaCtx.mods` (hodnota nebo funkce), jinak spočítané z **kopie** stavu runu přes engine
 * (run se nemění). Selže-li výpočet, vrátí základní modifikátory.
 */
export function resolveMods(
  mods: MetaCtx['mods'],
  run: Readonly<RunState>,
  registry: ContentRegistry,
): Readonly<Modifiers> {
  if (typeof mods === 'function') return mods();
  if (mods) return mods;
  try {
    const copy = JSON.parse(JSON.stringify(run)) as RunState;
    return Game.fromState(copy, registry).modifiers();
  } catch {
    return BASE_MODIFIERS;
  }
}

/** Sestaví kontext kontroly s líně počítanými modifikátory. */
export function achievementCtx(
  profile: Readonly<Profile>,
  ctx: MetaCtx,
  opts: { run?: Readonly<RunState>; event?: Readonly<GameEvent>; current?: Readonly<CurrentRunMeta> } = {},
): AchievementCtx {
  const out: { -readonly [K in keyof AchievementCtx]: AchievementCtx[K] } = {
    profile,
    registry: ctx.registry,
    nowIso: ctx.nowIso,
  };
  if (opts.run) out.run = opts.run;
  if (opts.event) out.event = opts.event;
  if (opts.current) out.current = opts.current;
  const run = opts.run;
  if (run) {
    let cached: Readonly<Modifiers> | null = null;
    Object.defineProperty(out, 'mods', {
      enumerable: true,
      get: () => (cached ??= resolveMods(ctx.mods, run, ctx.registry)),
    });
  }
  return out;
}

/** Bezpečně spustí kontrolu: `{ met, progress?, target? }`. */
function runCheck(
  def: AchievementDef,
  actx: AchievementCtx,
): { met: boolean; progress?: number; target?: number } {
  try {
    const r = def.check(actx);
    if (typeof r === 'boolean') return { met: r };
    if (!r || typeof r !== 'object') return { met: false };
    const progress = Number.isFinite(r.progress) ? r.progress : 0;
    const target = Number.isFinite(r.target) ? r.target : Infinity;
    return { met: progress >= target, progress, target };
  } catch {
    return { met: false };
  }
}

/** Udělí achievement (pokud ho hráč ještě nemá). Vrací true, když je nový. */
export function grantAchievement(profile: Profile, id: string, nowIso: string): boolean {
  if (profile.achievements.unlocked[id] !== undefined) return false;
  profile.achievements.unlocked[id] = nowIso;
  delete profile.achievements.progress[id];
  addUnseen(profile, `achievements:${id}`);
  return true;
}

/**
 * Zkontroluje všechny dosud nezískané achievementy a splněné udělí. `seededOnly` = jen ty s `allowSeeded`
 * (seedovaný / neoficiální denní run). Průběh (`progress`) se ukládá jako maximum. Mutuje profil.
 */
export function evaluateAchievements(
  profile: Profile,
  ctx: MetaCtx,
  opts: {
    run?: Readonly<RunState>;
    event?: Readonly<GameEvent>;
    current?: Readonly<CurrentRunMeta>;
    seededOnly?: boolean;
  } = {},
): MetaNotice[] {
  const defs = achievementList(ctx.registry);
  if (defs.length === 0) return [];
  const notices: MetaNotice[] = [];
  const actx = achievementCtx(profile, ctx, opts);
  for (const def of defs) {
    if (profile.achievements.unlocked[def.id] !== undefined) continue;
    if (opts.seededOnly && !def.allowSeeded) continue;
    const r = runCheck(def, actx);
    if (r.met) {
      if (grantAchievement(profile, def.id, ctx.nowIso)) notices.push({ kind: 'achievement', id: def.id });
    } else if (r.progress !== undefined && r.progress > 0) {
      const prev = profile.achievements.progress[def.id] ?? 0;
      if (r.progress > prev) profile.achievements.progress[def.id] = r.progress;
    }
  }
  return notices;
}

/**
 * Průběh achievementu pro sbírku: `{ progress, target }` z aktuálního profilu (bez runu), nebo null, když
 * kontrola průběh nevrací. Uložený průběh (maximum z runů) má přednost, je-li vyšší.
 */
export function achievementProgress(
  profile: Readonly<Profile>,
  ctx: MetaCtx,
  id: string,
): { progress: number; target: number } | null {
  const def = ctx.registry.achievements?.[id];
  if (!def) return null;
  const r = runCheck(def, achievementCtx(profile, ctx));
  if (r.target === undefined || !Number.isFinite(r.target)) return null;
  const stored = profile.achievements.progress[id] ?? 0;
  return { progress: Math.min(r.target, Math.max(r.progress ?? 0, stored)), target: r.target };
}
