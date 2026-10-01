/**
 * Všichni žolíci. Jednotlivé skupiny žijí v src/content/jokers/*.ts (texty v src/i18n/cs/jokers/*.ts).
 * Návod: docs/CONTENT-GUIDE.md.
 */
import type { JokerDef } from '../engine/content-types';
import { COMMON_JOKERS } from './jokers/common';
import { EPIC_JOKERS } from './jokers/epic';
import { LEGENDARY_JOKERS } from './jokers/legendary';
import { RARE_JOKERS } from './jokers/rare';
import { SPECIAL_JOKERS } from './jokers/special';

export const JOKERS: JokerDef[] = [
  ...COMMON_JOKERS,
  ...RARE_JOKERS,
  ...EPIC_JOKERS,
  ...LEGENDARY_JOKERS,
  ...SPECIAL_JOKERS,
];
