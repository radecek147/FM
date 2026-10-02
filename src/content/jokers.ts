/**
 * Všichni žolíci. Jednotlivé skupiny žijí v src/content/jokers/*.ts (texty v src/i18n/cs/jokers/*.ts).
 * Návod: docs/CONTENT-GUIDE.md.
 */
import type { JokerDef } from '../engine/content-types';
import { COMMON_JOKERS } from './jokers/common';
import { COMMON2_JOKERS } from './jokers/common2';
import { EPIC_JOKERS } from './jokers/epic';
import { EPIC2_JOKERS } from './jokers/epic2';
import { LEGENDARY_JOKERS } from './jokers/legendary';
import { RARE_JOKERS } from './jokers/rare';
import { RARE2_JOKERS } from './jokers/rare2';
import { SPECIAL_JOKERS } from './jokers/special';

export const JOKERS: JokerDef[] = [
  ...COMMON_JOKERS,
  ...COMMON2_JOKERS,
  ...RARE_JOKERS,
  ...RARE2_JOKERS,
  ...EPIC_JOKERS,
  ...EPIC2_JOKERS,
  ...LEGENDARY_JOKERS,
  ...SPECIAL_JOKERS,
];
