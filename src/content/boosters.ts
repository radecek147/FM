/**
 * Obálky (boostery) do Večerky (docs/DESIGN.md kap. 2.9): 5 druhů × 3 velikosti = 15 obálek.
 * Texty v src/i18n/cs/boosters.ts (`boosters.<id>.name|desc`; `{picks}` a `{options}` dosadí UI z definice).
 * Návod: docs/CONTENT-GUIDE.md.
 *
 * Id = `<druh>_<velikost>` (`joker_normal`, `rada_mega`…); štítky a výzvy na ně odkazují, po vydání se nemění.
 * Co v obálce je, losuje engine (src/engine/shop/shop.ts): žolíci 68/26/6 s edicemi a nálepkami, hrací karty
 * ze složení startovního balíčku (vylepšení 40 %, pečeť 15 %), spotřebky bez opakování; babská a razítková
 * obálka dobere ruku jen pro výběr cílů.
 */
import type { ArtSpec, BoosterDef, BoosterKind } from '../engine/content-types';

type BoosterSize = BoosterDef['size'];

/** Velikosti: Obálka / Tlustá obálka / Krabice od bot — cena v Kč (DESIGN 2.5.2). */
export const BOOSTER_COSTS: Readonly<Record<BoosterSize, number>> = { normal: 4, jumbo: 7, mega: 10 };

/** Řádek tabulky DESIGN 2.9: počet možností, výběrů a váha v obchodě pro každou velikost. */
interface BoosterRow {
  options: Record<BoosterSize, number>;
  picks: Record<BoosterSize, number>;
  weight: Record<BoosterSize, number>;
  art: Omit<ArtSpec, 'pattern' | 'prop'>;
}

const PICKS: Record<BoosterSize, number> = { normal: 1, jumbo: 1, mega: 2 };

/** Tabulka DESIGN 2.9 (počty možností a váhy jsou vlastní, viz příloha A). */
export const BOOSTER_TABLE: Readonly<Record<BoosterKind, BoosterRow>> = {
  pranostika: {
    options: { normal: 3, jumbo: 4, mega: 6 },
    picks: PICKS,
    weight: { normal: 5, jumbo: 2.5, mega: 0.6 },
    art: { icon: 'calendar', bg: '#1f3f66', fg: '#e8f2ff', accent: '#7dd3fc' },
  },
  rada: {
    options: { normal: 3, jumbo: 4, mega: 6 },
    picks: PICKS,
    weight: { normal: 5, jumbo: 2.5, mega: 0.6 },
    art: { icon: 'flower-pot', bg: '#36502c', fg: '#f3f9e6', accent: '#bef264' },
  },
  razitko: {
    options: { normal: 2, jumbo: 3, mega: 5 },
    picks: PICKS,
    weight: { normal: 1, jumbo: 0.5, mega: 0.1 },
    art: { icon: 'stamper', bg: '#5a1f2b', fg: '#ffe8ec', accent: '#fb7185' },
  },
  joker: {
    options: { normal: 2, jumbo: 3, mega: 5 },
    picks: PICKS,
    weight: { normal: 1.5, jumbo: 0.7, mega: 0.2 },
    art: { icon: 'card-joker', bg: '#3b1f5c', fg: '#f5ecff', accent: '#facc15' },
  },
  card: {
    options: { normal: 3, jumbo: 4, mega: 6 },
    picks: PICKS,
    weight: { normal: 3.5, jumbo: 1.5, mega: 0.4 },
    art: { icon: 'poker-hand', bg: '#14532d', fg: '#ecfdf5', accent: '#fde68a' },
  },
};

const KINDS: readonly BoosterKind[] = ['pranostika', 'rada', 'razitko', 'joker', 'card'];
const SIZES: readonly BoosterSize[] = ['normal', 'jumbo', 'mega'];

/** Vzhled podle velikosti: tlustá obálka má proužky, krabice od bot kostky a dárek navrch. */
const SIZE_ART: Record<BoosterSize, Pick<ArtSpec, 'pattern' | 'prop'>> = {
  normal: { pattern: 'none' },
  jumbo: { pattern: 'stripes', prop: 'papers' },
  mega: { pattern: 'checker', prop: 'present' },
};

/** Id obálky daného druhu a velikosti. */
export function boosterId(kind: BoosterKind, size: BoosterSize): string {
  return `${kind}_${size}`;
}

export const BOOSTERS: BoosterDef[] = KINDS.flatMap((kind) =>
  SIZES.map((size): BoosterDef => {
    const row = BOOSTER_TABLE[kind];
    return {
      id: boosterId(kind, size),
      kind,
      size,
      options: row.options[size],
      picks: row.picks[size],
      cost: BOOSTER_COSTS[size],
      weight: row.weight[size],
      art: { ...row.art, ...SIZE_ART[size] },
    };
  }),
);
