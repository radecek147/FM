/**
 * SVG hrací karty — líc a rub (vlastní procedurální grafika, CLAUDE.md kap. 7).
 *
 *  - viewBox 250 × 350 (poměr 5 : 7), ostré a čitelné při šířce ~70–110 px,
 *  - rohové indexy 2–10, J, Q, K, A + symbol barvy **vždy** (kvůli barvoslepým),
 *  - pipy 2–10 v klasickém rozložení, eso s velkým symbolem,
 *  - figury stylizované česky: Kluk s čepicí a peřím, Dáma v šátku na puntíky s korálemi, Král s korunou,
 *    knírem a hermelínem — dvouhlavé (zrcadlené) jako skutečné karty,
 *  - barva karty = `currentColor` z CSS proměnných `--suit-spades|hearts|diamonds|clubs`
 *    (barvoslepý režim je přepne třídou `.colorblind`, viz styles/cards.css),
 *  - vylepšení mění podklad/rámeček (kamenná nemá index ani barvu), pečeť je odznak vlevo dole,
 *    edice a stav „mimo provoz“ řeší CSS na obalu (components/card.ts).
 *
 * Markup se skládá jako řetězec (rychlé, kešovatelné); id ve `<defs>` jsou pro každou instanci unikátní.
 */
import type { ArtSpec, ContentRegistry } from '../../engine/content-types';
import type { Card, Rank, Suit } from '../../engine/types';
import { registry as defaultRegistry } from '../../content';
import { t } from '../../i18n/cs';
import { SUIT_PATH_D, escapeXml, iconMarkup, iconsLoaded, safeColor } from './icons';

export const CARD_WIDTH = 250;
export const CARD_HEIGHT = 350;
export const CARD_VIEWBOX = `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`;
/** Výška / šířka karty. */
export const CARD_RATIO = CARD_HEIGHT / CARD_WIDTH;

/** Co karta potřebuje k vykreslení líce. */
export type CardFace = Pick<Card, 'suit' | 'rank' | 'enhancement' | 'seal'>;

/** CSS proměnná barvy podle `Suit` (+ záložní barva, kdyby styly chyběly). */
export const SUIT_VARS: Readonly<Record<Suit, { cssVar: string; fallback: string; name: string }>> = {
  S: { cssVar: '--suit-spades', fallback: '#1e1b16', name: 'spades' },
  H: { cssVar: '--suit-hearts', fallback: '#c8372d', name: 'hearts' },
  D: { cssVar: '--suit-diamonds', fallback: '#c8372d', name: 'diamonds' },
  C: { cssVar: '--suit-clubs', fallback: '#1e1b16', name: 'clubs' },
};

const C = {
  paper: '#fbf6e9',
  paperEdge: '#cdbf9c',
  ink: '#1e1b16',
  skin: '#f2d2ab',
  cheek: '#e58e7a',
  hair: '#6b4423',
  hairDark: '#3b2a1a',
  gold: '#d9a521',
  goldDark: '#8a6410',
  white: '#fffaf0',
  red: '#c8372d',
  frameTint: '#f4ead0',
};

const ID = '%ID%';

// ─────────────────────────── Pomocné kreslení ───────────────────────────

const r1 = (n: number): string => String(Math.round(n * 100) / 100);
const r3 = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Symbol barvy se středem v (cx, cy), velikost `size`; `flip` = otočený o 180° (spodní polovina karty). */
function suitGlyph(suit: Suit, cx: number, cy: number, size: number, flip = false, extra = ''): string {
  const s = size / 512;
  const move = `translate(${r1(cx - size / 2)} ${r1(cy - size / 2)}) scale(${r3(s)})`;
  const tr = flip ? `rotate(180 ${r1(cx)} ${r1(cy)}) ${move}` : move;
  return `<path d="${SUIT_PATH_D[suit]}" transform="${tr}" fill="currentColor"${extra ? ` ${extra}` : ''}/>`;
}

/**
 * Tahy znaků rohového indexu (box 26 × 40, tah 5,5) — kreslené cestami, ne písmem, aby byl index ostrý a stejný
 * všude (pixelový font je v malé velikosti nečitelný). Znaky, které tu nejsou, se vykreslí textem.
 */
const INDEX_GLYPHS: Readonly<Record<string, { d: string; w: number }>> = {
  '0': { d: 'M13 0C6 0 3 9 3 20s3 20 10 20s10-9 10-20s-3-20-10-20z', w: 26 },
  '1': { d: 'M5 7l8-7v40', w: 18 },
  '2': { d: 'M3 10C3 3 9 0 13 0c6 0 10 4 10 10c0 7-7 12-20 30h21', w: 26 },
  '3': {
    d: 'M3 4c3-3 6-4 10-4c6 0 10 4 10 9c0 6-5 10-11 10c7 0 12 4 12 10c0 7-5 11-11 11c-5 0-9-2-11-5',
    w: 26,
  },
  '4': { d: 'M18 40V0L2 28h24', w: 26 },
  '5': { d: 'M22 1H6L4 18c3-2 6-3 9-3c7 0 11 5 11 12c0 8-5 13-12 13c-4 0-8-2-10-5', w: 26 },
  '6': {
    d: 'M21 3c-3-2-6-3-8-3C6 0 2 8 2 20c0 13 4 20 11 20c7 0 11-5 11-13c0-7-4-12-11-12c-6 0-10 4-11 9',
    w: 26,
  },
  '7': { d: 'M2 1h22c-8 11-13 24-15 39', w: 26 },
  '8': {
    d: 'M13 19c-6 0-10-4-10-9.5S7 0 13 0s10 4 10 9.5S19 19 13 19c-7 0-11 5-11 10.5S7 40 13 40s11-4 11-10.5S20 19 13 19z',
    w: 26,
  },
  '9': {
    d: 'M5 37c3 2 6 3 8 3c7 0 11-8 11-20C24 7 20 0 13 0C6 0 2 5 2 13c0 7 4 12 11 12c6 0 10-4 11-9',
    w: 26,
  },
  J: { d: 'M20 0v29c0 7-4 11-9 11s-9-3-9-9', w: 24 },
  Q: { d: 'M13 0C6 0 2 8 2 19s4 19 11 19s11-8 11-19S20 0 13 0zM15 30l9 10', w: 26 },
  K: { d: 'M3 0v40M23 0L3 24M10 16l14 24', w: 26 },
  A: { d: 'M2 40L13 0l11 40M6 27h14', w: 26 },
};

/** Hodnota v rohu: tahy znaků vycentrované na x = 30, výška 44 od y = 18. Širší popisky (10) se zúží. */
function rankGlyphs(label: string): string {
  const chars = [...label];
  if (chars.length === 0 || chars.some((ch) => !INDEX_GLYPHS[ch])) {
    return `<text x="30" y="60" text-anchor="middle" class="pc-rank" font-size="46" font-weight="700" fill="currentColor">${escapeXml(label)}</text>`;
  }
  const scale = 1.1;
  const maxWidth = 38;
  const gap = 3;
  const width = chars.reduce((sum, ch) => sum + (INDEX_GLYPHS[ch]?.w ?? 0), 0) + gap * (chars.length - 1);
  const sx = Math.min(scale, maxWidth / width);
  let x = 0;
  let d = '';
  for (const ch of chars) {
    const g = INDEX_GLYPHS[ch];
    if (!g) continue;
    d += `<path d="${g.d}" transform="translate(${x} 0)"/>`;
    x += g.w + gap;
  }
  const tx = 30 - (width * sx) / 2;
  return `<g class="pc-rank" transform="translate(${r1(tx)} 18) scale(${r3(sx)} ${scale})" fill="none" stroke="currentColor" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
}

/** Rohový index (hodnota + barva) v levém horním rohu; druhý roh je otočený o 180°. */
function cornerIndex(suit: Suit, rank: Rank): string {
  const one = `<g class="pc-corner">${rankGlyphs(t(`ranks.${rank}.short`))}${suitGlyph(suit, 30, 89, 28)}</g>`;
  return `${one}<g transform="rotate(180 125 175)">${one}</g>`;
}

/** Rozložení pipů 2–10: [x, y] v jednotkách karty. Spodní polovina (y > 175) se kreslí otočeně. */
const XL = 80;
const XC = 125;
const XR = 170;
const YT = 74;
const YB = 276;
const YM = 175;
const Y13 = YT + (YB - YT) / 3;
const Y23 = YT + ((YB - YT) * 2) / 3;
const PIP_LAYOUT: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [
    [XC, YT],
    [XC, YB],
  ],
  3: [
    [XC, YT],
    [XC, YM],
    [XC, YB],
  ],
  4: [
    [XL, YT],
    [XR, YT],
    [XL, YB],
    [XR, YB],
  ],
  5: [
    [XL, YT],
    [XR, YT],
    [XC, YM],
    [XL, YB],
    [XR, YB],
  ],
  6: [
    [XL, YT],
    [XR, YT],
    [XL, YM],
    [XR, YM],
    [XL, YB],
    [XR, YB],
  ],
  7: [
    [XL, YT],
    [XR, YT],
    [XC, (YT + YM) / 2],
    [XL, YM],
    [XR, YM],
    [XL, YB],
    [XR, YB],
  ],
  8: [
    [XL, YT],
    [XR, YT],
    [XC, (YT + YM) / 2],
    [XL, YM],
    [XR, YM],
    [XC, (YM + YB) / 2],
    [XL, YB],
    [XR, YB],
  ],
  9: [
    [XL, YT],
    [XR, YT],
    [XL, Y13],
    [XR, Y13],
    [XC, YM],
    [XL, Y23],
    [XR, Y23],
    [XL, YB],
    [XR, YB],
  ],
  10: [
    [XL, YT],
    [XR, YT],
    [XC, (YT + Y13) / 2],
    [XL, Y13],
    [XR, Y13],
    [XL, Y23],
    [XR, Y23],
    [XC, (Y23 + YB) / 2],
    [XL, YB],
    [XR, YB],
  ],
};

function pips(suit: Suit, rank: Rank): string {
  const layout = PIP_LAYOUT[rank] ?? [];
  const size = rank >= 9 ? 46 : 50;
  return `<g class="pc-pips">${layout.map(([x, y]) => suitGlyph(suit, x, y, size, y > YM + 0.5)).join('')}</g>`;
}

function ace(suit: Suit): string {
  return (
    `<g class="pc-ace">` +
    `<circle cx="125" cy="175" r="84" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 7" opacity="0.35"/>` +
    `<circle cx="125" cy="175" r="92" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2"/>` +
    suitGlyph(suit, 125, 175, 116) +
    `</g>`
  );
}

// ─────────────────────────── Figury ───────────────────────────

const stroke = (w = 2): string => `stroke="${C.ink}" stroke-width="${w}" stroke-linejoin="round"`;

/** Obličej (společný pro všechny figury); `lips` = rtěnka (Dáma). */
function face(lips: boolean): string {
  return (
    `<rect x="115" y="110" width="20" height="20" fill="${C.skin}" ${stroke(1.5)}/>` +
    `<ellipse cx="125" cy="94" rx="20" ry="23" fill="${C.skin}" ${stroke()}/>` +
    `<circle cx="113" cy="103" r="4.2" fill="${C.cheek}" opacity="0.55"/>` +
    `<circle cx="137" cy="103" r="4.2" fill="${C.cheek}" opacity="0.55"/>` +
    `<circle cx="117" cy="92" r="2.4" fill="${C.ink}"/><circle cx="133" cy="92" r="2.4" fill="${C.ink}"/>` +
    `<path d="M112 86q5-3 9 0M129 86q5-3 9 0" fill="none" ${stroke(1.4)} stroke-linecap="round"/>` +
    `<path d="M125 94q-3 6 1 8" fill="none" ${stroke(1.4)} stroke-linecap="round"/>` +
    (lips
      ? `<path d="M119.5 108.5q5.5 3.5 11 0q-5.5 5-11 0z" fill="${C.red}"/>`
      : `<path d="M120 108q5 3.5 10 0" fill="none" ${stroke(1.5)} stroke-linecap="round"/>`)
  );
}

/** Kluk: sametová čepice s peřím, vesta s knoflíky a výšivkou. */
function jackHalf(): string {
  return (
    // vesta (barva karty) a košile
    `<path d="M60 175V157c0-17 20-28 42-30h46c22 2 42 13 42 30v18z" fill="currentColor" ${stroke()}/>` +
    `<path d="M108 126l17 22l17-22z" fill="${C.white}" ${stroke(1.5)}/>` +
    `<circle cx="125" cy="156" r="2.8" fill="${C.gold}"/><circle cx="125" cy="167" r="2.8" fill="${C.gold}"/>` +
    folkFlower(84, 152, 5) +
    folkFlower(166, 152, 5) +
    face(false) +
    // vlasy pod čepicí
    `<path d="M105 92c-2-12 4-18 8-20h24c4 2 10 8 8 20c-3-7-10-11-20-11s-17 4-20 11z" fill="${C.hair}"/>` +
    // čepice s páskem a peřím
    `<path d="M97 80c-2-20 18-30 36-27c20 3 26 16 22 27z" fill="currentColor" ${stroke()}/>` +
    `<rect x="98" y="75" width="57" height="8" rx="3" fill="${C.gold}" ${stroke(1.4)}/>` +
    `<path d="M147 77c10-16 22-28 40-37c-5 17-17 31-36 40z" fill="${C.white}" ${stroke(1.4)}/>` +
    `<path d="M150 78c11-13 22-25 34-34" fill="none" ${stroke(1)}/>` +
    `<circle cx="104" cy="79" r="3.2" fill="${C.red}" ${stroke(1)}/>`
  );
}

/** Dáma: šátek na puntíky (barva karty) uvázaný pod bradou, korále, kroj s bílými rukávci. */
function queenHalf(): string {
  const dots = [
    [106, 62],
    [118, 55],
    [132, 55],
    [144, 62],
    [100, 80],
    [150, 80],
    [99, 99],
    [151, 99],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${C.white}"/>`)
    .join('');
  return (
    // rukávce, živůtek, výšivka
    `<ellipse cx="78" cy="156" rx="21" ry="19" fill="${C.white}" ${stroke()}/>` +
    `<ellipse cx="172" cy="156" rx="21" ry="19" fill="${C.white}" ${stroke()}/>` +
    `<path d="M70 150q8 6 16 0M164 150q8 6 16 0" fill="none" ${stroke(1)}/>` +
    `<path d="M95 175v-38c8-9 52-9 60 0v38z" fill="currentColor" ${stroke()}/>` +
    `<path d="M108 128l17 16l17-16z" fill="${C.white}" ${stroke(1.4)}/>` +
    folkFlower(125, 160, 6) +
    // šátek — zadní díl kolem hlavy
    `<path d="M96 104c-4-40 12-56 29-56s33 16 29 56c-2 12-8 18-14 20h-30c-6-2-12-8-14-20z" fill="currentColor" ${stroke()}/>` +
    dots +
    face(true) +
    // ofina a čelní díl šátku
    `<path d="M107 85c6-7 30-7 36 0c-6-3-30-3-36 0z" fill="${C.hair}" ${stroke(1)}/>` +
    `<path d="M103 86c1-15 11-22 22-22s21 7 22 22c-7-9-14-12-22-12s-15 3-22 12z" fill="currentColor" ${stroke(1.5)}/>` +
    // uzel pod bradou
    `<path d="M119 120l-13 15l16-6zM131 120l13 15l-16-6z" fill="currentColor" ${stroke(1.4)}/>` +
    `<circle cx="125" cy="123" r="4.5" fill="currentColor" ${stroke(1.4)}/>` +
    // korále
    [
      [111, 129],
      [117, 132],
      [125, 133],
      [133, 132],
      [139, 129],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="${C.red}" ${stroke(0.8)}/>`)
      .join('')
  );
}

/** Král: koruna, knír s bradkou, plášť (barva karty) se zlatým pruhem, hermelínový límec a žezlo. */
function kingHalf(): string {
  const ermine = [
    [99, 133],
    [112, 129],
    [138, 129],
    [151, 133],
  ]
    .map(([x, y]) => `<path d="M${x} ${y}v4.5l-1.5 2M${x} ${y}v4.5l1.5 2" fill="none" ${stroke(1.3)}/>`)
    .join('');
  return (
    // žezlo (za ramenem)
    `<path d="M72 175L90 116" stroke="${C.goldDark}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M72 175L90 116" stroke="${C.gold}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<circle cx="91" cy="112" r="6" fill="${C.gold}" ${stroke(1.4)}/>` +
    // plášť se zlatým pruhem
    `<path d="M60 175V159c0-18 20-29 42-31h46c22 2 42 13 42 31v16z" fill="currentColor" ${stroke()}/>` +
    `<rect x="116" y="136" width="18" height="39" fill="${C.gold}" ${stroke(1.2)}/>` +
    `<path d="M125 144l4 5l-4 5l-4-5zM125 160l4 5l-4 5l-4-5z" fill="${C.ink}"/>` +
    face(false) +
    // hermelínový límec kolem krku
    `<path d="M88 138c3-13 18-16 37-16s34 3 37 16c-3 6-10 8-16 5c-6-5-13-7-21-7s-15 2-21 7c-6 3-13 1-16-5z" fill="${C.white}" ${stroke(1.5)}/>` +
    ermine +
    // vlasy po stranách
    `<path d="M102 100c-4-16 2-26 10-28h26c8 2 14 12 10 28c-2-11-9-17-23-17s-21 6-23 17z" fill="${C.hair}"/>` +
    // bradka a knír
    `<path d="M112 112c4 14 9 20 13 22c4-2 9-8 13-22c-5 5-21 5-26 0z" fill="${C.hairDark}"/>` +
    `<path d="M105 103c6-6 14-5 20-1c6-4 14-5 20 1c3 5-1 9-6 7c-5-2-9-3-14-1c-5-2-9-1-14 1c-5 2-9-2-6-7z" fill="${C.hairDark}"/>` +
    // koruna
    `<path d="M100 76l1-28l12 13l12-19l12 19l12-13l1 28z" fill="${C.gold}" ${stroke()}/>` +
    `<rect x="99" y="70" width="52" height="9" rx="2" fill="${C.gold}" ${stroke(1.5)}/>` +
    `<circle cx="125" cy="74.5" r="3.2" fill="currentColor" ${stroke(1)}/>` +
    `<circle cx="110" cy="74.5" r="2.4" fill="${C.red}"/><circle cx="140" cy="74.5" r="2.4" fill="${C.red}"/>` +
    `<circle cx="101" cy="47" r="3" fill="${C.gold}" ${stroke(1)}/><circle cx="125" cy="41" r="3.2" fill="${C.gold}" ${stroke(1)}/>` +
    `<circle cx="149" cy="47" r="3" fill="${C.gold}" ${stroke(1)}/>`
  );
}

/** Lidový kvítek (výšivka): pět lístků kolem středu. */
function folkFlower(cx: number, cy: number, r: number): string {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    petals += `<circle cx="${r1(cx + Math.cos(a) * r)}" cy="${r1(cy + Math.sin(a) * r)}" r="${r1(r * 0.62)}" fill="${C.gold}"/>`;
  }
  return `${petals}<circle cx="${cx}" cy="${cy}" r="${r1(r * 0.5)}" fill="${C.red}"/>`;
}

function courtCard(suit: Suit, rank: Rank): string {
  const half = rank === 11 ? jackHalf() : rank === 12 ? queenHalf() : kingHalf();
  const top = `<g class="pc-figure">${half}${suitGlyph(suit, 66, 54, 20)}</g>`;
  return (
    `<g class="pc-court">` +
    `<rect x="50" y="36" width="150" height="278" rx="6" fill="${C.frameTint}" fill-opacity="0.65"/>` +
    `<g clip-path="url(#${ID}-court)">${top}<g transform="rotate(180 125 175)">${top}</g></g>` +
    `<line x1="50" y1="175" x2="200" y2="175" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>` +
    `<rect x="50" y="36" width="150" height="278" rx="6" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
    `</g>`
  );
}

/** Ořez figury do rámečku (každá polovina končí na středové lince). */
const COURT_CLIP = `<clipPath id="${ID}-court"><rect x="50" y="36" width="150" height="278" rx="6"/></clipPath>`;

// ─────────────────────────── Vylepšení a pečetě ───────────────────────────

interface Surface {
  /** Výplň podkladu (barva nebo `url(#…)`). */
  fill: string;
  fillOpacity?: number;
  edge: string;
  /** Vnitřní rámeček (barva) — zvýrazní vylepšení i při malé velikosti. */
  inner?: string;
  defs?: string;
  /** Kresba nad podkladem, pod pipy. */
  under?: string;
  /** Kresba nad vším (lesk, ohnutý roh). */
  over?: string;
}

function surface(enhancement: string | null, reg: ContentRegistry): Surface {
  switch (enhancement) {
    case null:
      return { fill: C.paper, edge: C.paperEdge };
    case 'bonus':
      return { fill: '#e7f0fb', edge: '#8fb3e0', inner: '#3b7fd8' };
    case 'mult':
      return { fill: '#fbe8e2', edge: '#e0a294', inner: '#d9452f' };
    case 'glass':
      return {
        fill: '#e2f4f8',
        fillOpacity: 0.8,
        edge: '#7fb8c9',
        inner: '#a9d6e2',
        over:
          `<path d="M24 120L120 24h34L24 154zM40 330L226 144v26L66 330z" fill="#ffffff" opacity="0.45"/>` +
          `<path d="M196 60l12 14l-6 10l10 12" fill="none" stroke="#7fb8c9" stroke-width="1.5" opacity="0.8"/>`,
      };
    case 'steel':
      return {
        fill: `url(#${ID}-steel)`,
        edge: '#6b7280',
        inner: '#9aa3ad',
        defs: `<linearGradient id="${ID}-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef1f4"/><stop offset="0.45" stop-color="#b9c0c8"/><stop offset="0.55" stop-color="#d7dce1"/><stop offset="1" stop-color="#9aa3ad"/></linearGradient>`,
        under: [
          [13, 13],
          [237, 13],
          [13, 337],
          [237, 337],
        ]
          .map(
            ([x, y]) =>
              `<circle cx="${x}" cy="${y}" r="4.5" fill="#d1d5db" stroke="#4b5563" stroke-width="1.5"/>`,
          )
          .join(''),
      };
    case 'gold':
      return {
        fill: `url(#${ID}-gold)`,
        edge: '#a8780f',
        inner: '#c8961a',
        defs: `<linearGradient id="${ID}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeaa0"/><stop offset="0.5" stop-color="#e2b33a"/><stop offset="1" stop-color="#f6d97a"/></linearGradient>`,
        over: `<path d="M24 90L90 24h20L24 110z" fill="#fffbe6" opacity="0.5"/>`,
      };
    case 'lucky':
      return {
        fill: '#eaf6e6',
        edge: '#8cc497',
        inner: '#2f7a3d',
        under: `<g opacity="0.13" color="#2f7a3d">${iconMarkup('clover', { x: 45, y: 95, size: 160 })}</g>`,
      };
    case 'wild':
      return {
        fill: '#f6f0fd',
        edge: '#b69be0',
        inner: `url(#${ID}-wild)`,
        defs: `<linearGradient id="${ID}-wild" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9452f"/><stop offset="0.33" stop-color="#e8a92a"/><stop offset="0.66" stop-color="#2f9e57"/><stop offset="1" stop-color="#3b7fd8"/></linearGradient>`,
      };
    case 'worn':
      return {
        fill: '#efe0bd',
        edge: '#b89c6a',
        under:
          `<circle cx="168" cy="250" r="38" fill="none" stroke="#a0763f" stroke-width="5" opacity="0.18"/>` +
          `<path d="M20 210q60 -8 210 6" fill="none" stroke="#b89c6a" stroke-width="1.5" opacity="0.5"/>`,
        over: `<path d="M248 52V2h-50z" fill="#d8c393" stroke="#b89c6a" stroke-width="2"/><path d="M198 2l50 50h-50z" fill="#c9b07a" stroke="#b89c6a" stroke-width="2"/>`,
      };
    default: {
      // Neznámé (budoucí) vylepšení: rámeček v barvě jeho obrázku.
      const def = reg.enhancements[enhancement];
      const color = safeColor(def?.art.bg, '#6d28d9');
      return { fill: C.paper, edge: color, inner: color };
    }
  }
}

/** Odznak vylepšení vpravo nahoře (barva a ikona z `EnhancementDef.art`). */
function enhancementBadge(enhancement: string, reg: ContentRegistry): string {
  const art = reg.enhancements[enhancement]?.art;
  if (!art) return '';
  const bg = safeColor(art.bg, '#555555');
  const fg = safeColor(art.fg, '#ffffff');
  return (
    `<g class="pc-enh-badge">` +
    `<circle cx="222" cy="28" r="16" fill="${bg}" stroke="${C.white}" stroke-width="2.5"/>` +
    iconMarkup(art.icon, { x: 211, y: 17, size: 22, color: fg }) +
    `</g>`
  );
}

/** Pečeť vlevo dole: voskový odznak v barvě `SealDef.art`. */
function sealBadge(seal: string, reg: ContentRegistry): string {
  const art = reg.seals[seal]?.art;
  const bg = safeColor(art?.bg, '#7e22ce');
  const fg = safeColor(art?.fg, '#ffffff');
  let wax = '';
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    wax += `<circle cx="${r1(30 + Math.cos(a) * 15)}" cy="${r1(320 + Math.sin(a) * 15)}" r="5" fill="${bg}"/>`;
  }
  return (
    `<g class="pc-seal" data-seal="${escapeXml(seal)}">` +
    wax +
    `<circle cx="30" cy="320" r="16" fill="${bg}"/>` +
    `<circle cx="30" cy="320" r="11.5" fill="none" stroke="${fg}" stroke-width="1.5" opacity="0.6"/>` +
    iconMarkup(art?.icon ?? 'star', { x: 22, y: 312, size: 16, color: fg }) +
    `</g>`
  );
}

/** Kamenná karta: bez hodnoty a barvy — jen kámen. */
function stoneFace(): string {
  return (
    `<rect x="2" y="2" width="246" height="346" rx="18" fill="#8b8580" stroke="#57534e" stroke-width="3"/>` +
    `<rect x="12" y="12" width="226" height="326" rx="10" fill="none" stroke="#6f6a64" stroke-width="2"/>` +
    `<g fill="#9d978f" stroke="#6f6a64" stroke-width="2" stroke-linejoin="round">` +
    `<path d="M24 30h70l10 52l-46 18l-34-10z"/><path d="M112 26h112v64l-58 10l-48-26z"/>` +
    `<path d="M24 104l42-6l30 40l-12 66l-60 8z"/><path d="M104 96l60 14l62-8v96l-70 18l-48-40z"/>` +
    `<path d="M24 226l64-10l46 34l-6 76h-104z"/><path d="M140 248l86-30v108h-92z"/>` +
    `</g>` +
    `<path d="M70 150l18 24l-8 30M180 140l-14 36l20 22M60 270l30 12" fill="none" stroke="#57534e" stroke-width="2" opacity="0.7"/>` +
    `<path d="M24 30h70l10 52M112 26h112" fill="none" stroke="#b5afa7" stroke-width="2" opacity="0.6"/>`
  );
}

// ─────────────────────────── Sestavení ───────────────────────────

function svgRoot(classes: string, style: string, data: string, body: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CARD_VIEWBOX}" class="${classes}" style="${style}" ${data} focusable="false">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    `</svg>`
  );
}

/** Styl kořene: barva karty z CSS proměnné (se zálohou). */
export function suitColorStyle(suit: Suit): string {
  const v = SUIT_VARS[suit];
  return `color: var(${v.cssVar}, ${v.fallback})`;
}

function buildFace(card: CardFace, reg: ContentRegistry): string {
  const enh = card.enhancement;
  const noRankSuit = enh !== null && reg.enhancements[enh]?.noRankSuit === true;
  const data =
    `data-suit="${card.suit}" data-rank="${card.rank}"` +
    (enh ? ` data-enhancement="${escapeXml(enh)}"` : '') +
    (card.seal ? ` data-seal="${escapeXml(card.seal)}"` : '');
  const seal = card.seal ? sealBadge(card.seal, reg) : '';
  if (noRankSuit) {
    return svgRoot('pc-svg pc-face pc-stone', 'color: #57534e', data, stoneFace() + seal);
  }
  const sf = surface(enh, reg);
  const content =
    card.rank === 14
      ? ace(card.suit)
      : card.rank >= 11
        ? courtCard(card.suit, card.rank)
        : pips(card.suit, card.rank);
  const body =
    `<rect x="2" y="2" width="246" height="346" rx="18" fill="${sf.fill}"${
      sf.fillOpacity !== undefined ? ` fill-opacity="${sf.fillOpacity}"` : ''
    } stroke="${sf.edge}" stroke-width="3"/>` +
    (sf.inner
      ? `<rect x="9" y="9" width="232" height="332" rx="12" fill="none" stroke="${sf.inner}" stroke-width="4"/>`
      : '') +
    (sf.under ?? '') +
    content +
    cornerIndex(card.suit, card.rank) +
    (sf.over ?? '') +
    (enh ? enhancementBadge(enh, reg) : '') +
    seal;
  const defs = (sf.defs ?? '') + (card.rank >= 11 && card.rank <= 13 ? COURT_CLIP : '');
  return svgRoot(`pc-svg pc-face pc-suit-${card.suit}`, suitColorStyle(card.suit), data, body, defs);
}

/** Klíč vzhledu líce (pro keš a pro rozhodnutí, zda kartu překreslit). */
export function cardFaceKey(card: CardFace): string {
  return `${card.suit}${card.rank}|${card.enhancement ?? ''}|${card.seal ?? ''}`;
}

const faceCache = new Map<string, string>();

/**
 * SVG markup líce karty (s placeholderem `%ID%` pro id ve `<defs>` — použij `withUniqueIds`, nebo rovnou
 * `cardFaceElement`). Výsledek se kešuje podle hodnoty, barvy, vylepšení a pečeti.
 */
export function cardFaceMarkupRaw(card: CardFace, reg: ContentRegistry = defaultRegistry()): string {
  const key = `${cardFaceKey(card)}|${iconsLoaded() ? 1 : 0}|${reg === defaultRegistry() ? '' : 'x'}`;
  let markup = faceCache.get(key);
  if (markup === undefined) {
    markup = buildFace(card, reg);
    if (reg === defaultRegistry()) faceCache.set(key, markup);
  }
  return markup;
}

let uid = 0;
/** Nahradí placeholder id unikátním prefixem (každá instance SVG má vlastní `<defs>`). */
export function withUniqueIds(markup: string): string {
  if (!markup.includes(ID)) return markup;
  uid += 1;
  return markup.split(ID).join(`ka${uid}`);
}

/** SVG markup líce karty připravený k vložení (unikátní id). */
export function cardFaceMarkup(card: CardFace, reg?: ContentRegistry): string {
  return withUniqueIds(cardFaceMarkupRaw(card, reg));
}

/**
 * Rub karty: vínová s lidovou mřížkou a tulipánem; s `ArtSpec` balíčku v jeho barvách a s jeho ikonou.
 */
export function cardBackMarkup(spec?: ArtSpec): string {
  const bg = safeColor(spec?.bg, '#7a2230');
  const fg = safeColor(spec?.fg, C.gold);
  const accent = safeColor(spec?.accent, fg);
  const emblem = spec
    ? iconMarkup(spec.icon, { x: 85, y: 135, size: 80, color: fg })
    : `<g fill="${fg}">` +
      `<path d="M125 240v-46" stroke="${fg}" stroke-width="4" fill="none"/>` +
      `<path d="M125 234c-15-8-25-22-27-34c14 4 24 16 27 26zM125 234c15-8 25-22 27-34c-14 4-24 16-27 26z"/>` +
      `<path d="M100 150c0 26 12 42 25 42s25-16 25-42c-8 10-14 10-18 0c-2-10-4-20-7-26c-3 6-5 16-7 26c-4 10-10 10-18 0z"/>` +
      `</g>`;
  const body =
    `<rect x="2" y="2" width="246" height="346" rx="18" fill="${bg}" stroke="${C.ink}" stroke-opacity="0.35" stroke-width="3"/>` +
    `<rect x="14" y="14" width="222" height="322" rx="10" fill="url(#${ID}-lat)"/>` +
    `<rect x="14" y="14" width="222" height="322" rx="10" fill="none" stroke="${accent}" stroke-width="3"/>` +
    `<rect x="22" y="22" width="206" height="306" rx="6" fill="none" stroke="${accent}" stroke-width="1" opacity="0.6"/>` +
    `<ellipse cx="125" cy="175" rx="58" ry="76" fill="${bg}" stroke="${accent}" stroke-width="3"/>` +
    `<ellipse cx="125" cy="175" rx="50" ry="68" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="4 4"/>` +
    emblem;
  const defs = `<pattern id="${ID}-lat" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45 125 175)"><path d="M0 0H22M0 0V22" stroke="${fg}" stroke-width="2" opacity="0.32"/><circle cx="11" cy="11" r="2" fill="${fg}" opacity="0.4"/></pattern>`;
  return withUniqueIds(svgRoot('pc-svg pc-back', '', 'data-back="1"', body, defs));
}

function parseSvg(markup: string): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/** Přístupnost SVG: s popiskem `role="img"`, jinak dekorativní (`aria-hidden`). */
export function labelSvg(el: SVGSVGElement, label?: string): SVGSVGElement {
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

/** SVG element líce (nebo rubu, když `faceDown`). */
export function cardFaceElement(
  card: CardFace & { faceDown?: boolean },
  opts: { label?: string; registry?: ContentRegistry; back?: ArtSpec } = {},
): SVGSVGElement {
  const markup = card.faceDown ? cardBackMarkup(opts.back) : cardFaceMarkup(card, opts.registry);
  return labelSvg(parseSvg(markup), opts.label);
}

/** SVG element rubu karty (balíček, karty lícem dolů). */
export function cardBackElement(opts: { label?: string; spec?: ArtSpec } = {}): SVGSVGElement {
  return labelSvg(parseSvg(cardBackMarkup(opts.spec)), opts.label);
}

/** Vyprázdní keš líců (např. po načtení ikon, aby odznaky dostaly skutečné ikony). */
export function clearCardCache(): void {
  faceCache.clear();
}
