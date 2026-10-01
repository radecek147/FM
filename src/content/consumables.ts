/**
 * Obsah: spotřebky. Definice žijí podle typu v `pranostiky.ts`, `rady.ts` a `razitka.ts` (CLAUDE.md kap. 2);
 * tento soubor je jen spojí do jednoho pole pro registr.
 * Texty v src/i18n/cs/{pranostiky,rady,razitka}.ts (sloučené pod `consumables`). Návod: docs/CONTENT-GUIDE.md.
 */
import type { ConsumableDef } from '../engine/content-types';
import { PRANOSTIKY } from './pranostiky';
import { RADY } from './rady';
import { RAZITKA } from './razitka';

export const CONSUMABLES: ConsumableDef[] = [...PRANOSTIKY, ...RADY, ...RAZITKA];
