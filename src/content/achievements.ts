/**
 * Obsah: achievementy (DESIGN 11.2). Texty v src/i18n/cs/achievements.ts (`achievements.<id>.name|desc`).
 * Typ a vyhodnocení: `AchievementDef` v src/engine/meta/types.ts, `evaluateAchievements` v src/engine/meta.
 * Kontrola (`check`) je čistá funkce nad `AchievementCtx` (profil, run, událost, počítadla runu, modifikátory).
 */
import type { AchievementDef } from '../engine/meta/types';

export const ACHIEVEMENTS: AchievementDef[] = [];
