/**
 * Seedovaný generátor náhody: xoshiro128** se seedováním přes cyrb128.
 * Veškerá náhoda v enginu jde přes tyto streamy → stejný seed + stejné akce = identický run.
 */
import type { Rng } from '../content-types';
import { SEED_ALPHABET, SEED_LENGTH } from '../constants';
import type { RngState, RngStreamName } from '../types';

export const RNG_STREAMS: readonly RngStreamName[] = [
  'deck',
  'shop',
  'booster',
  'boss',
  'tag',
  'joker',
  'card',
  'consumable',
  'misc',
];

/** Hash řetězce na 4 × uint32 (cyrb128). */
export function cyrb128(str: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const s: RngState = [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  // xoshiro nesmí mít nulový stav
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 0x9e3779b9;
  return s;
}

/** Výchozí stavy všech streamů pro daný seed. */
export function createRngStates(seed: string): Record<RngStreamName, RngState> {
  const out = {} as Record<RngStreamName, RngState>;
  for (const name of RNG_STREAMS) out[name] = cyrb128(`${seed}:${name}`);
  return out;
}

/**
 * Rng nad sdíleným (serializovatelným) stavem. Mutuje předané pole `state` na místě,
 * takže pokrok streamu je vždy součástí RunState.
 */
export function rngFromState(state: RngState): Rng {
  const nextU32 = (): number => {
    const s0 = state[0];
    const s1 = state[1];
    const s2 = state[2];
    const s3 = state[3];
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    let n2 = (s2 ^ s0) >>> 0;
    let n3 = (s3 ^ s1) >>> 0;
    const n1 = (s1 ^ n2) >>> 0;
    const n0 = (s0 ^ n3) >>> 0;
    n2 = (n2 ^ t) >>> 0;
    n3 = rotl(n3, 11);
    state[0] = n0;
    state[1] = n1;
    state[2] = n2;
    state[3] = n3;
    return result;
  };
  const next = (): number => nextU32() / 4294967296;
  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max < min (${min}, ${max})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },
    weighted(items) {
      let total = 0;
      for (const it of items) total += Math.max(0, it.weight);
      if (items.length === 0 || total <= 0) throw new Error('rng.weighted: no positive weights');
      let r = next() * total;
      for (const it of items) {
        const w = Math.max(0, it.weight);
        if (r < w) return it.item;
        r -= w;
      }
      return items[items.length - 1]!.item;
    },
    chance(p) {
      return next() < p;
    },
  };
  return rng;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Náhodný seed pro nový run (`SEED_LENGTH` znaků z `SEED_ALPHABET` — bez zaměnitelných znaků). */
export function generateSeed(source: () => number): string {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i++) out += SEED_ALPHABET[Math.floor(source() * SEED_ALPHABET.length)];
  return out;
}

/** Seed denního runu z data (UTC) — stejný pro všechny hráče. */
export function dailySeed(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `DEN-${y}${m}${d}`;
}
