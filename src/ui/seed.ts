/**
 * Seed v UI (DESIGN 11.6): náhodný seed z kryptograficky bezpečného zdroje (engine dostává hotový řetězec)
 * a texty chyb zadání (`parseSeedInput` → `newGame.seed.errors.<kód>`).
 */
import { SEED_LENGTH, generateSeed } from '../engine';
import type { SeedErrorCode } from '../engine/meta';
import { t } from '../i18n/cs';

/** Zdroj náhody 0–1: `crypto.getRandomValues`, záložně `Math.random` (UI smí, engine ne). */
function randomSource(): () => number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    return () => {
      c.getRandomValues(buf);
      return (buf[0] ?? 0) / 2 ** 32;
    };
  }
  return Math.random;
}

/** Náhodný seed (8 znaků z abecedy bez I, O, 0, 1). */
export function randomSeed(): string {
  return generateSeed(randomSource());
}

/** Text chyby zadání seedu; prázdné zadání chybou není (hra vylosuje náhodný seed) → null. */
export function seedErrorText(code: SeedErrorCode): string | null {
  if (code === 'empty') return null;
  return t(`newGame.seed.errors.${code}`, { n: SEED_LENGTH });
}
