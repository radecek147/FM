/** Všichni šéfové (docs/DESIGN.md kap. 8). Skupiny v src/content/bosses/*.ts, texty v src/i18n/cs/bosses/*.ts. */
import type { BossDef } from '../engine/content-types';
import { BOSSES_A } from './bosses/a';
import { BOSSES_B } from './bosses/b';
import { BOSSES_FINAL } from './bosses/final';

export const BOSSES: BossDef[] = [...BOSSES_A, ...BOSSES_B, ...BOSSES_FINAL];
