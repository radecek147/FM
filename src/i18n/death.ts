/**
 * Hláška pitvy pro prohru na Malé nebo Velké útratě (DESIGN příloha C): víc variant v `game.death.small|big`, výběr
 * deterministicky podle seedu runu — stejný run (i po načtení, v textovém režimu simulace) má vždy stejnou hlášku.
 */
import { tList } from './cs';

/** FNV-1a 32 bit — stabilní hash řetězce (bez závislosti na jazyce prostředí). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Index varianty z `count` možností pro seed runu a druh útraty. */
export function deathVariantIndex(kind: 'small' | 'big', seed: string, count: number): number {
  return count > 0 ? hash(`${kind}|${seed}`) % count : 0;
}

/** Hláška pitvy pro prohru na Malé / Velké útratě v runu se seedem `seed`. */
export function blindDeathQuote(kind: 'small' | 'big', seed: string): string {
  const list = tList(`game.death.${kind}`);
  return list[deathVariantIndex(kind, seed, list.length)] ?? '';
}
