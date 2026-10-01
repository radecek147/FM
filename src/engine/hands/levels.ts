/** Úrovně kombinací. */
import type { HandLevelState, HandType, HandTypeDef } from '../types';
import { HAND_TYPES } from '../types';

/** Čipy a mult kombinace na dané úrovni (úroveň 1 = základ; úroveň < 1 se bere jako 1). */
export function handValueAtLevel(d: HandTypeDef, level: number): { chips: number; mult: number } {
  const extra = Math.max(0, level - 1);
  return { chips: d.baseChips + d.chipsPerLevel * extra, mult: Math.max(1, d.baseMult + d.multPerLevel * extra) };
}

export function initialHandLevels(): Record<HandType, HandLevelState> {
  const out = {} as Record<HandType, HandLevelState>;
  for (const h of HAND_TYPES) out[h] = { level: 1, played: 0 };
  return out;
}
