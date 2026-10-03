/**
 * Písmo „Karban Digits“ — číslice 0–9 a písmena, která se v drobném textu pletou (C, c, Z a písmena s háčkem
 * a kroužkem), sestavené za běhu do TrueType (FontFace API).
 *
 * Proč: Pixelify Sans je krásné, ale v malých velikostech herního rozhraní se v něm pletou znaky — „5“ a „S“ jsou
 * stejné glyfy, „Z“ vypadá jako „2“, „3“, „6“ a „9“ se zavřou do „8“ („Patro 3/8“ se čte „8/8“), „C“ má otvor
 * menší než pixel a čte se jako „O“ („RUCE“ → „RUOE“) a háček je dvoupixelová tečka („Kč“ → „Kċ“). Hra je plná
 * čísel a českých slov, proto má tyhle znaky vlastní písmo, které se v `--font-game` řadí před Pixelify Sans
 * a díky `unicode-range` přebírá jen znaky, které opravdu kreslí (`DIGIT_FONT_RANGE`). Ostatní kreslí Pixelify Sans.
 *
 * Glyfy: obrysy Pixelify Sans (© 2021 The Pixelify Sans Project Authors, SIL Open Font License 1.1) ve stejných
 * jednotkách (UPM 1000, váhy 400 a 700). Číslice jsou přepsané do obdélníkové mřížky: „5“ má rovnou horní linku,
 * „2“ rovnou patku, „7“ přišla o háček vlevo, „3“ je vlevo otevřená (rovné ramenní linky, prostřední tah až od
 * středu), „6“ a „9“ nemají koncový háček, který se zavíral do „8“, a „0“ je užší než „O“. „Z“ má šikmou tahu po
 * schodech (mřížka „X“). „C“ a „c“ mají otvor široký přes dva pixely (kratší koncové tahy), písmena s háčkem
 * a kroužkem (Č č Ď Ě ě Ň ň Ř ř Š š Ť Ů ů Ž ž) mají původní základ a nový, širší háček ve tvaru „v“ a větší
 * kroužek. Odvozené písmo je tedy také pod OFL 1.1 a nenese rezervované jméno původního písma.
 * Nic se nestahuje — data jsou tady, binárka vzniká v prohlížeči.
 *
 * Bez FontFace API (testy, starý prohlížeč) se nic nestane: znaky kreslí Pixelify Sans jako dřív.
 */

/** Jméno rodiny v CSS (`--font-game` v base.css). */
export const DIGIT_FONT_FAMILY = 'Karban Digits';

const UNITS_PER_EM = 1000;
const ASCENT = 920;
const DESCENT = 280;
const CAP_HEIGHT = 631;

/**
 * Část glyfu na nepravidelné mřížce: `x` a `y` jsou hrany sloupců a řádků v jednotkách písma (y shora dolů),
 * `rows` řádky buněk (`#` = plno). Úzké sloupce/řádky (≈ 10 jednotek) jsou „zuby“ zaoblených rohů Pixelify Sans.
 */
interface GlyphPart {
  x: readonly number[];
  y: readonly number[];
  rows: readonly string[];
}

/**
 * Část glyfu jako hotové obrysy (základy písmen převzaté z Pixelify Sans): každý obrys je ploché pole
 * `[x0, y0, x1, y1, …]` bodů na křivce (osa y nahoru), vnější obrys po směru hodinových ručiček (TrueType).
 */
interface OutlinePart {
  outline: readonly (readonly number[])[];
}

type Part = GlyphPart | OutlinePart;

/** Číslice (jedna část) — tvar mřížky s šířkou znaku. */
interface DigitGrid extends GlyphPart {
  adv: number;
}

/** Glyf písma: kódový bod, šířka a části (Č = C + háček). */
interface GlyphDef {
  code: number;
  adv: number;
  parts: readonly Part[];
}

type Weight = 400 | 700;

// Společné mřížky (Pixelify Sans: číslice 0, 2, 3, 6–9 sdílejí sloupce; 2, 3 a nová 5 i řádky).
const X4 = [60, 151, 161, 423, 433, 525] as const;
const X7 = [61, 149, 188, 414, 453, 542] as const;
const Y4_S = [631, 540, 530, 440, 359, 350, 270, 260, 179, 88, 78, -12] as const;
const Y7_S = [638, 552, 501, 416, 381, 331, 297, 246, 211, 125, 74, -11] as const;
// „3“ má navíc sloupec uprostřed: prostřední tah začíná až tam (vlevo otevřená trojka ≠ „8“).
const X4_3 = [60, 151, 161, 251, 423, 433, 525] as const;
const X7_3 = [61, 149, 188, 276, 414, 453, 542] as const;
// „0“ je o zub užší než „O“ (stejná šířka znaku, užší tělo).
const X4_0 = [105, 196, 206, 378, 388, 480] as const;
const X7_0 = [105, 193, 232, 370, 409, 497] as const;

/** Tvary sdílené oběma vahami (liší se jen souřadnice mřížky). */
const SHAPES = {
  zero: ['.###.', '#####', '##.##', '#####', '.###.'],
  one: ['.###.', '#####', '##.##', '...##'],
  // Nová „2“: zaoblená hlava jako v Pixelify Sans, ale rovná patka s ostrými rohy (≠ „Z“).
  two: ['.###.', '#####', '##.##', '...##', '.####', '.###.', '####.', '##...', '##...', '#####', '#####'],
  // Nová „3“: rovná horní a dolní linka až k levému okraji, bez háčků vlevo, prostřední tah od středu (≠ „8“).
  three: [
    '#####.',
    '######',
    '....##',
    '....##',
    '...###',
    '...##.',
    '...###',
    '....##',
    '....##',
    '######',
    '#####.',
  ],
  four: [
    '.....###',
    '...#####',
    '...###.#',
    '.#####.#',
    '.###...#',
    '####...#',
    '##.....#',
    '########',
    '.......#',
  ],
  // Nová „5“: rovná horní linka s ostrými rohy, svislice vlevo, bříško vpravo (≠ „S“).
  five: ['#####', '#####', '##...', '##...', '####.', '####.', '#####', '...##', '##.##', '#####', '.###.'],
  // „6“ bez háčku vpravo nahoře (zavíral se do „8“): rovná horní linka s ostrým koncem.
  six: ['.####', '#####', '##...', '##...', '####.', '#####', '##.##', '#####', '.###.'],
  // „7“ bez háčku vlevo (v Pixelify Sans připomínala obrácené „ʃ“): rovná horní linka a svislice vpravo.
  seven: ['#####', '#####', '...##', '...##'],
  eight: ['.###.', '#####', '##.##', '#####', '.###.', '#####', '##.##', '#####', '.###.'],
  // „9“ zrcadlově k „6“: bez háčku vlevo dole, rovná dolní linka.
  nine: ['.###.', '#####', '##.##', '#####', '.####', '...##', '...##', '#####', '####.'],
} as const;

const GRIDS: Readonly<Record<Weight, readonly DigitGrid[]>> = {
  400: [
    { adv: 586, x: X4_0, y: [631, 540, 530, 88, 78, -12], rows: SHAPES.zero },
    { adv: 404, x: [60, 151, 161, 241, 251, 343], y: [631, 540, 530, 440, -12], rows: SHAPES.one },
    { adv: 586, x: X4, y: Y4_S, rows: SHAPES.two },
    { adv: 586, x: X4_3, y: Y4_S, rows: SHAPES.three },
    {
      adv: 586,
      x: [60, 151, 161, 241, 251, 333, 343, 423, 525],
      y: [631, 540, 530, 450, 440, 359, 350, 270, 169, -12],
      rows: SHAPES.four,
    },
    { adv: 586, x: X4, y: Y4_S, rows: SHAPES.five },
    { adv: 586, x: X4, y: [631, 540, 530, 440, 359, 270, 260, 88, 78, -12], rows: SHAPES.six },
    { adv: 586, x: X4, y: [631, 540, 530, 440, -12], rows: SHAPES.seven },
    { adv: 586, x: X4, y: [631, 540, 530, 359, 350, 270, 260, 88, 78, -12], rows: SHAPES.eight },
    { adv: 586, x: X4, y: [631, 540, 530, 359, 350, 260, 179, 88, 78, -12], rows: SHAPES.nine },
  ],
  700: [
    { adv: 603, x: X7_0, y: [638, 552, 501, 125, 74, -11], rows: SHAPES.zero },
    { adv: 426, x: [61, 149, 188, 237, 276, 365], y: [638, 552, 501, 416, -11], rows: SHAPES.one },
    { adv: 603, x: X7, y: Y7_S, rows: SHAPES.two },
    { adv: 603, x: X7_3, y: Y7_S, rows: SHAPES.three },
    {
      adv: 603,
      x: [61, 149, 188, 237, 276, 326, 365, 414, 542],
      y: [638, 552, 501, 467, 416, 381, 331, 297, 160, -11],
      rows: SHAPES.four,
    },
    { adv: 603, x: X7, y: Y7_S, rows: SHAPES.five },
    { adv: 603, x: X7, y: [638, 552, 501, 416, 381, 297, 246, 125, 74, -11], rows: SHAPES.six },
    { adv: 603, x: X7, y: [638, 552, 501, 416, -11], rows: SHAPES.seven },
    { adv: 603, x: X7, y: [638, 552, 501, 381, 331, 297, 246, 125, 74, -11], rows: SHAPES.eight },
    { adv: 603, x: X7, y: [638, 552, 501, 381, 331, 246, 211, 125, 74, -11], rows: SHAPES.nine },
  ],
};

/** „Z“ se šikmou tahou po schodech na mřížce písmene „X“ z Pixelify Sans (≠ „2“). */
const SHAPE_Z = [
  '#########',
  '#########',
  '.....###.',
  '...#####.',
  '...###...',
  '.#####...',
  '.###.....',
  '#########',
  '#########',
];

/**
 * Háček ve tvaru „v“: tři řádky, pět sloupců. Původní háček Pixelify Sans je jen ≈ 1,5 pixelu široký a v drobném
 * textu splyne v tečku („ċ“) — tenhle je široký přes tři pixely a nahoře má zářez.
 */
const SHAPE_CARON = ['#...#', '##.##', '.###.'];
/** Kroužek „ů“: čtvercový prstenec s viditelnou dírou (původní má díru menší než pixel). */
const SHAPE_RING = ['###', '#.#', '###'];

/** Základy písmen z Pixelify Sans (obrysy beze změny), „C“ a „c“ s větším otvorem. */
type BaseLetter = 'C' | 'c' | 'D' | 'E' | 'e' | 'N' | 'n' | 'R' | 'r' | 'S' | 's' | 'T' | 'U' | 'u' | 'z';

interface LetterSet {
  adv: number;
  z: GlyphPart;
  base: Readonly<Record<BaseLetter, OutlinePart>>;
  caronLower: GlyphPart;
  caronUpper: GlyphPart;
  ringLower: GlyphPart;
  ringUpper: GlyphPart;
}

const o = (...outline: (readonly number[])[]): OutlinePart => ({ outline });

const LETTERS: Readonly<Record<Weight, LetterSet>> = {
  400: {
    adv: 586,
    z: {
      x: [60, 151, 161, 241, 251, 333, 343, 423, 433, 525],
      y: [631, 540, 530, 359, 350, 270, 260, 88, 78, -12],
      rows: SHAPE_Z,
    },
    base: {
      // „C“: koncové tahy jen jeden pixel (původně se otvor zavíral na 80 jednotek).
      C: o([
        151, -12, 151, 78, 60, 78, 60, 540, 151, 540, 151, 631, 433, 631, 433, 540, 525, 540, 525, 440, 423,
        440, 423, 530, 161, 530, 161, 88, 423, 88, 423, 179, 525, 179, 525, 78, 433, 78, 433, -12,
      ]),
      // „c“: bez koncových tahů — otvor přes celou výšku mezi linkami.
      c: o([
        151, -12, 151, 78, 60, 78, 60, 359, 151, 359, 151, 450, 525, 450, 525, 350, 161, 350, 161, 88, 525,
        88, 525, -12,
      ]),
      D: o(
        [
          60, -12, 60, 631, 343, 631, 343, 540, 433, 540, 433, 450, 525, 450, 525, 169, 433, 169, 433, 78,
          343, 78, 343, -12,
        ],
        [161, 88, 333, 88, 333, 179, 423, 179, 423, 440, 333, 440, 333, 530, 161, 530],
      ),
      E: o([
        151, -12, 151, 78, 60, 78, 60, 540, 151, 540, 151, 631, 433, 631, 433, 540, 525, 540, 525, 440, 423,
        440, 423, 530, 161, 530, 161, 359, 343, 359, 343, 260, 161, 260, 161, 88, 423, 88, 423, 179, 525, 179,
        525, 78, 433, 78, 433, -12,
      ]),
      e: o([
        151, -12, 151, 78, 60, 78, 60, 359, 151, 359, 151, 450, 433, 450, 433, 359, 525, 359, 525, 260, 423,
        260, 423, 350, 161, 350, 161, 270, 343, 270, 343, 169, 161, 169, 161, 88, 423, 88, 423, 180, 525, 180,
        525, 79, 433, 79, 433, -12,
      ]),
      N: o([
        60, -12, 60, 631, 161, 631, 161, 540, 251, 540, 251, 450, 343, 450, 343, 179, 423, 179, 423, 631, 525,
        631, 525, -12, 423, -12, 423, 78, 333, 78, 333, 169, 241, 169, 241, 440, 161, 440, 161, -12,
      ]),
      n: o([
        60, -12, 60, 450, 433, 450, 433, 359, 525, 359, 525, -12, 423, -12, 423, 350, 161, 350, 161, -12,
      ]),
      R: o(
        [
          60, -12, 60, 540, 151, 540, 151, 631, 433, 631, 433, 540, 525, 540, 525, 260, 433, 260, 433, 169,
          389, 169, 389, 88, 479, 88, 479, -12, 379, -12, 379, 78, 287, 78, 287, 169, 161, 169, 161, -12,
        ],
        [161, 270, 423, 270, 423, 530, 161, 530],
      ),
      r: o([
        60, -12, 60, 359, 151, 359, 151, 450, 433, 450, 433, 359, 525, 359, 525, 260, 423, 260, 423, 350, 161,
        350, 161, -12,
      ]),
      S: o([
        151, -12, 151, 78, 60, 78, 60, 179, 161, 179, 161, 88, 423, 88, 423, 260, 151, 260, 151, 350, 60, 350,
        60, 540, 151, 540, 151, 631, 433, 631, 433, 540, 525, 540, 525, 440, 423, 440, 423, 530, 161, 530,
        161, 359, 433, 359, 433, 270, 525, 270, 525, 78, 433, 78, 433, -12,
      ]),
      s: o([
        60, -12, 60, 88, 423, 88, 423, 169, 151, 169, 151, 260, 60, 260, 60, 359, 151, 359, 151, 450, 525,
        450, 525, 350, 161, 350, 161, 270, 433, 270, 433, 179, 525, 179, 525, 78, 433, 78, 433, -12,
      ]),
      T: o([
        241, -12, 241, 530, 161, 530, 161, 440, 60, 440, 60, 540, 151, 540, 151, 631, 433, 631, 433, 540, 525,
        540, 525, 440, 423, 440, 423, 530, 343, 530, 343, -12,
      ]),
      U: o([
        151, -12, 151, 78, 60, 78, 60, 631, 161, 631, 161, 88, 423, 88, 423, 631, 525, 631, 525, 78, 433, 78,
        433, -12,
      ]),
      u: o([
        151, -12, 151, 78, 60, 78, 60, 450, 161, 450, 161, 88, 423, 88, 423, 450, 525, 450, 525, 78, 433, 78,
        433, -12,
      ]),
      z: o([
        60, -12, 60, 88, 151, 88, 151, 179, 241, 179, 241, 270, 333, 270, 333, 350, 60, 350, 60, 450, 525,
        450, 525, 350, 433, 350, 433, 260, 343, 260, 343, 169, 251, 169, 251, 88, 525, 88, 525, -12,
      ]),
    },
    caronLower: { x: [143, 203, 263, 323, 383, 443], y: [667, 612, 557, 502], rows: SHAPE_CARON },
    caronUpper: { x: [143, 203, 263, 323, 383, 443], y: [851, 796, 741, 686], rows: SHAPE_CARON },
    ringLower: { x: [183, 243, 343, 403], y: [702, 642, 562, 502], rows: SHAPE_RING },
    ringUpper: { x: [183, 243, 343, 403], y: [883, 823, 743, 683], rows: SHAPE_RING },
  },
  700: {
    adv: 603,
    z: {
      x: [61, 149, 188, 237, 276, 326, 365, 414, 453, 542],
      y: [638, 552, 501, 381, 331, 297, 246, 125, 74, -11],
      rows: SHAPE_Z,
    },
    base: {
      C: o([
        149, -11, 149, 74, 61, 74, 61, 552, 149, 552, 149, 638, 453, 638, 453, 552, 542, 552, 542, 416, 414,
        416, 414, 501, 188, 501, 188, 125, 414, 125, 414, 211, 542, 211, 542, 74, 453, 74, 453, -11,
      ]),
      c: o([
        149, -11, 149, 74, 61, 74, 61, 381, 149, 381, 149, 467, 542, 467, 542, 331, 188, 331, 188, 125, 542,
        125, 542, -11,
      ]),
      D: o(
        [
          61, -11, 61, 638, 365, 638, 365, 552, 453, 552, 453, 467, 542, 467, 542, 160, 453, 160, 453, 74,
          365, 74, 365, -11,
        ],
        [188, 125, 326, 125, 326, 211, 414, 211, 414, 416, 326, 416, 326, 501, 188, 501],
      ),
      E: o([
        149, -11, 149, 74, 61, 74, 61, 552, 149, 552, 149, 638, 453, 638, 453, 552, 542, 552, 542, 416, 414,
        416, 414, 501, 188, 501, 188, 381, 365, 381, 365, 246, 188, 246, 188, 125, 414, 125, 414, 211, 542,
        211, 542, 74, 453, 74, 453, -11,
      ]),
      e: o([
        149, -11, 149, 74, 61, 74, 61, 381, 149, 381, 149, 467, 453, 467, 453, 381, 542, 381, 542, 246, 414,
        246, 414, 331, 188, 331, 188, 297, 365, 297, 365, 160, 188, 160, 188, 125, 414, 125, 414, 212, 542,
        212, 542, 75, 453, 75, 453, -11,
      ]),
      N: o([
        61, -11, 61, 638, 188, 638, 188, 552, 276, 552, 276, 467, 365, 467, 365, 211, 414, 211, 414, 638, 542,
        638, 542, -11, 414, -11, 414, 74, 326, 74, 326, 160, 237, 160, 237, 416, 188, 416, 188, -11,
      ]),
      n: o([
        61, -11, 61, 467, 453, 467, 453, 381, 542, 381, 542, -11, 414, -11, 414, 331, 188, 331, 188, -11,
      ]),
      R: o(
        [
          61, -11, 61, 552, 149, 552, 149, 638, 453, 638, 453, 552, 542, 552, 542, 246, 453, 246, 453, 160,
          410, 160, 410, 125, 497, 125, 497, -11, 371, -11, 371, 74, 281, 74, 281, 160, 188, 160, 188, -11,
        ],
        [188, 297, 414, 297, 414, 501, 188, 501],
      ),
      r: o([
        61, -11, 61, 381, 149, 381, 149, 467, 453, 467, 453, 381, 542, 381, 542, 246, 414, 246, 414, 331, 188,
        331, 188, -11,
      ]),
      S: o([
        149, -11, 149, 74, 61, 74, 61, 211, 188, 211, 188, 125, 414, 125, 414, 246, 149, 246, 149, 331, 61,
        331, 61, 552, 149, 552, 149, 638, 453, 638, 453, 552, 542, 552, 542, 416, 414, 416, 414, 501, 188,
        501, 188, 381, 453, 381, 453, 297, 542, 297, 542, 74, 453, 74, 453, -11,
      ]),
      s: o([
        61, -11, 61, 125, 414, 125, 414, 160, 149, 160, 149, 246, 61, 246, 61, 381, 149, 381, 149, 467, 542,
        467, 542, 331, 188, 331, 188, 297, 453, 297, 453, 211, 542, 211, 542, 74, 453, 74, 453, -11,
      ]),
      T: o([
        237, -11, 237, 501, 188, 501, 188, 416, 61, 416, 61, 552, 149, 552, 149, 638, 453, 638, 453, 552, 542,
        552, 542, 416, 414, 416, 414, 501, 365, 501, 365, -11,
      ]),
      U: o([
        149, -11, 149, 74, 61, 74, 61, 638, 188, 638, 188, 125, 414, 125, 414, 638, 542, 638, 542, 74, 453,
        74, 453, -11,
      ]),
      u: o([
        149, -11, 149, 74, 61, 74, 61, 467, 188, 467, 188, 125, 414, 125, 414, 467, 542, 467, 542, 74, 453,
        74, 453, -11,
      ]),
      z: o([
        61, -11, 61, 125, 149, 125, 149, 211, 237, 211, 237, 297, 326, 297, 326, 331, 61, 331, 61, 467, 542,
        467, 542, 331, 453, 331, 453, 246, 365, 246, 365, 160, 276, 160, 276, 125, 542, 125, 542, -11,
      ]),
    },
    caronLower: { x: [137, 203, 269, 335, 401, 467], y: [717, 657, 597, 537], rows: SHAPE_CARON },
    caronUpper: { x: [137, 203, 269, 335, 401, 467], y: [888, 828, 768, 708], rows: SHAPE_CARON },
    ringLower: { x: [172, 242, 361, 431], y: [747, 677, 587, 517], rows: SHAPE_RING },
    ringUpper: { x: [172, 242, 361, 431], y: [918, 848, 758, 688], rows: SHAPE_RING },
  },
};

const CODE_ZERO = 0x30;

/** Všechny glyfy dané váhy seřazené podle kódového bodu (cmap to vyžaduje). */
function glyphDefs(weight: Weight): GlyphDef[] {
  const l = LETTERS[weight];
  const b = l.base;
  const letter = (ch: string, ...parts: Part[]): GlyphDef => ({
    code: ch.codePointAt(0)!,
    adv: l.adv,
    parts,
  });
  const defs: GlyphDef[] = [
    ...GRIDS[weight].map((g, i) => ({ code: CODE_ZERO + i, adv: g.adv, parts: [g] })),
    letter('C', b.C),
    letter('Z', l.z),
    letter('c', b.c),
    letter('Č', b.C, l.caronUpper),
    letter('č', b.c, l.caronLower),
    letter('Ď', b.D, l.caronUpper),
    letter('Ě', b.E, l.caronUpper),
    letter('ě', b.e, l.caronLower),
    letter('Ň', b.N, l.caronUpper),
    letter('ň', b.n, l.caronLower),
    letter('Ř', b.R, l.caronUpper),
    letter('ř', b.r, l.caronLower),
    letter('Š', b.S, l.caronUpper),
    letter('š', b.s, l.caronLower),
    letter('Ť', b.T, l.caronUpper),
    letter('Ů', b.U, l.ringUpper),
    letter('ů', b.u, l.ringLower),
    letter('Ž', l.z, l.caronUpper),
    letter('ž', b.z, l.caronLower),
  ];
  return defs.sort((a, b2) => a.code - b2.code);
}

/** Kódové body písma (vzestupně) — stejné pro obě váhy. */
export const DIGIT_FONT_CODES: readonly number[] = glyphDefs(400).map((d) => d.code);

/** `unicode-range` z kódových bodů: souvislé úseky jako `U+0030-0039`, samostatné jako `U+0043`. */
export function unicodeRange(codes: readonly number[]): string {
  const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
  const out: string[] = [];
  let start = -1;
  let prev = -1;
  for (const code of [...codes, Number.NaN]) {
    if (start >= 0 && code === prev + 1) {
      prev = code;
      continue;
    }
    if (start >= 0) out.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`);
    start = code;
    prev = code;
  }
  return out.join(', ');
}

/** `unicode-range` písma (FontFace) — jen znaky, které písmo opravdu má. */
export const DIGIT_FONT_RANGE = unicodeRange(DIGIT_FONT_CODES);

// ─────────────────────────── Obrysy z mřížky ───────────────────────────

type Point = readonly [number, number];

/**
 * Obrysy glyfu: hranice plných buněk, orientované po směru hodinových ručiček (vnější obrys TrueType,
 * osa y nahoru), díry vyjdou proti směru samy. Body na přímce se vynechají.
 */
export function digitContours(grid: GlyphPart): Point[][] {
  const nx = grid.x.length - 1;
  const ny = grid.y.length - 1;
  if (grid.rows.length !== ny || grid.rows.some((r) => r.length !== nx))
    throw new Error('digitFont: mřížka neodpovídá řádkům');
  const on = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < nx && j < ny && grid.rows[j]?.[i] === '#';
  // Hrany mezi vrcholy mřížky (i, j); j roste dolů (y klesá).
  const out = new Map<string, Array<[number, number]>>();
  const key = (i: number, j: number): string => `${i},${j}`;
  const add = (a: [number, number], b: [number, number]): void => {
    const k = key(a[0], a[1]);
    const list = out.get(k);
    if (list) list.push(b);
    else out.set(k, [b]);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!on(i, j)) continue;
      if (!on(i - 1, j)) add([i, j + 1], [i, j]); // levá strana nahoru
      if (!on(i, j - 1)) add([i, j], [i + 1, j]); // horní doprava
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]); // pravá dolů
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]); // spodní doleva
    }
  }
  const contours: Point[][] = [];
  for (;;) {
    const startKey = [...out.keys()].find((k) => (out.get(k)?.length ?? 0) > 0);
    if (startKey === undefined) break;
    const [si, sj] = startKey.split(',').map(Number) as [number, number];
    const loop: Array<[number, number]> = [];
    let cur: [number, number] = [si, sj];
    for (let guard = 0; guard < 10_000; guard++) {
      loop.push(cur);
      const list = out.get(key(cur[0], cur[1]));
      const next = list?.shift();
      if (!next) break;
      cur = next;
      if (cur[0] === si && cur[1] === sj) break;
    }
    // Vynechat body uprostřed rovné hrany.
    const pts = loop.filter((p, idx) => {
      const prev = loop[(idx - 1 + loop.length) % loop.length]!;
      const next = loop[(idx + 1) % loop.length]!;
      return !((prev[0] === p[0] && p[0] === next[0]) || (prev[1] === p[1] && p[1] === next[1]));
    });
    contours.push(pts.map(([i, j]) => [grid.x[i]!, grid.y[j]!] as const));
  }
  return contours;
}

/** Obrysy části glyfu: mřížka se převede (`digitContours`), hotové obrysy se jen rozbalí na body. */
function partContours(part: Part): Point[][] {
  if ('rows' in part) return digitContours(part);
  return part.outline.map((flat) => {
    if (flat.length < 6 || flat.length % 2 !== 0) throw new Error('digitFont: neplatný obrys');
    const pts: Point[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
    return pts;
  });
}

/** Obrysy glyfu pro kódový bod (testy čitelnosti: otevřená „3“, otvor „C“, šířka háčku). Neznámý znak = []. */
export function glyphContours(weight: Weight, code: number): Point[][] {
  const def = glyphDefs(weight).find((d) => d.code === code);
  return def ? def.parts.flatMap(partContours) : [];
}

// ─────────────────────────── Zápis TrueType ───────────────────────────

class Writer {
  private readonly bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff);
  }
  tag(s: string): this {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
    return this;
  }
  raw(data: ArrayLike<number>): this {
    for (let i = 0; i < data.length; i++) this.u8(data[i]!);
    return this;
  }
  pad4(): this {
    while (this.bytes.length % 4 !== 0) this.u8(0);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

interface BuiltGlyph {
  data: Uint8Array;
  adv: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  points: number;
  contours: number;
}

function buildGlyph(def: GlyphDef): BuiltGlyph {
  const contours = def.parts.flatMap(partContours);
  const all = contours.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const box = { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
  const w = new Writer();
  w.i16(contours.length).i16(box.xMin).i16(box.yMin).i16(box.xMax).i16(box.yMax);
  let end = -1;
  for (const c of contours) {
    end += c.length;
    w.u16(end);
  }
  w.u16(0); // bez instrukcí
  for (let i = 0; i < all.length; i++) w.u8(0x01); // každý bod na křivce, souřadnice jako int16
  let px = 0;
  for (const [x] of all) {
    w.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of all) {
    w.i16(y - py);
    py = y;
  }
  w.pad4();
  return { data: w.done(), adv: def.adv, ...box, points: all.length, contours: contours.length };
}

function utf16be(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c >> 8, c & 0xff);
  }
  return out;
}

function nameTable(weight: Weight): Uint8Array {
  const style = weight === 700 ? 'Bold' : 'Regular';
  const records: Array<[number, string]> = [
    [0, 'Glyphs derived from Pixelify Sans, (c) 2021 The Pixelify Sans Project Authors'],
    [1, DIGIT_FONT_FAMILY],
    [2, style],
    [3, `${DIGIT_FONT_FAMILY} ${style}`],
    [4, `${DIGIT_FONT_FAMILY} ${style}`],
    [5, 'Version 1.000'],
    [6, `KarbanDigits-${style}`],
    [13, 'SIL Open Font License, Version 1.1'],
    [14, 'https://openfontlicense.org'],
  ];
  const strings = records.map(([, s]) => utf16be(s));
  const w = new Writer();
  w.u16(0)
    .u16(records.length)
    .u16(6 + records.length * 12);
  let offset = 0;
  records.forEach(([id], i) => {
    const len = strings[i]!.length;
    w.u16(3).u16(1).u16(0x409).u16(id).u16(len).u16(offset);
    offset += len;
  });
  for (const s of strings) w.raw(s);
  return w.done();
}

/**
 * cmap formátu 4: souvislé úseky kódů se souvislými čísly glyfů (glyf 0 je .notdef) a povinný koncový
 * úsek 0xFFFF.
 */
function cmapTable(codes: readonly number[]): Uint8Array {
  const segs: Array<{ start: number; end: number; delta: number }> = [];
  codes.forEach((code, i) => {
    const glyph = i + 1;
    const last = segs[segs.length - 1];
    if (last && code === last.end + 1 && glyph - code === last.delta) last.end = code;
    else segs.push({ start: code, end: code, delta: glyph - code });
  });
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const sub = new Writer()
    .u16(4)
    .u16(16 + n * 8)
    .u16(0)
    .u16(n * 2)
    .u16(pow * 2)
    .u16(Math.log2(pow))
    .u16(n * 2 - pow * 2);
  for (const sg of segs) sub.u16(sg.end);
  sub.u16(0);
  for (const sg of segs) sub.u16(sg.start);
  for (const sg of segs) sub.i16(((sg.delta + 0x8000) & 0xffff) - 0x8000);
  for (let i = 0; i < n; i++) sub.u16(0);
  return new Writer().u16(0).u16(1).u16(3).u16(1).u32(12).raw(sub.done()).done();
}

/** Sestaví TrueType s glyfy .notdef + číslice a písmena (`DIGIT_FONT_CODES`) pro danou váhu. */
export function buildDigitFont(weight: Weight): Uint8Array {
  const defs = glyphDefs(weight);
  const glyphs: BuiltGlyph[] = [
    // .notdef — prázdný glyf (kreslit ho nikdy nebudeme, unicode-range pokrývá jen znaky písma)
    { data: new Uint8Array(0), adv: 500, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0 },
    ...defs.map(buildGlyph),
  ];
  const drawn = glyphs.slice(1);
  const bbox = {
    xMin: Math.min(...drawn.map((g) => g.xMin)),
    yMin: Math.min(...drawn.map((g) => g.yMin)),
    xMax: Math.max(...drawn.map((g) => g.xMax)),
    yMax: Math.max(...drawn.map((g) => g.yMax)),
  };
  const advMax = Math.max(...glyphs.map((g) => g.adv));
  const numGlyphs = glyphs.length;

  // glyf + loca (dlouhý formát)
  const glyf = new Writer();
  const loca = new Writer();
  for (const g of glyphs) {
    loca.u32(glyf.length);
    glyf.raw(g.data);
  }
  loca.u32(glyf.length);

  const head = new Writer()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment — doplní se na konci
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(UNITS_PER_EM)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(bbox.xMin)
    .i16(bbox.yMin)
    .i16(bbox.xMax)
    .i16(bbox.yMax)
    .u16(weight === 700 ? 1 : 0)
    .u16(8)
    .i16(2)
    .i16(1) // indexToLocFormat: long
    .i16(0);

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(advMax)
    .i16(Math.min(...drawn.map((g) => g.xMin)))
    .i16(Math.min(...drawn.map((g) => g.adv - g.xMax)))
    .i16(bbox.xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(numGlyphs);

  const hmtx = new Writer();
  for (const g of glyphs) hmtx.u16(g.adv).i16(g.xMin);

  const maxp = new Writer()
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(Math.max(...glyphs.map((g) => g.points)))
    .u16(Math.max(...glyphs.map((g) => g.contours)))
    .u16(0)
    .u16(0)
    .u16(2)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0);

  const codes = defs.map((d) => d.code);
  const firstCode = codes[0] ?? CODE_ZERO;
  const lastCode = codes[codes.length - 1] ?? CODE_ZERO;
  const cmap = cmapTable(codes);

  const avg = Math.round(drawn.reduce((s, g) => s + g.adv, 0) / drawn.length);
  const os2 = new Writer()
    .u16(4)
    .i16(avg)
    .u16(weight)
    .u16(5)
    .u16(0)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(75)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(350)
    .i16(50)
    .i16(300)
    .i16(0)
    .raw(new Array<number>(10).fill(0))
    .u32(0b101)
    .u32(0)
    .u32(0)
    .u32(0)
    .tag('NONE')
    .u16(weight === 700 ? 0x20 : 0x40)
    .u16(firstCode)
    .u16(lastCode)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(ASCENT)
    .u16(DESCENT)
    .u32(0b11)
    .u32(0)
    .i16(450)
    .i16(CAP_HEIGHT)
    .u16(0)
    .u16(0x20)
    .u16(0);

  const post = new Writer().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.done()],
    ['cmap', cmap],
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp.done()],
    ['name', nameTable(weight)],
    ['post', post.done()],
  ];

  const n = tables.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const font = new Writer()
    .u32(0x00010000)
    .u16(n)
    .u16(pow * 16)
    .u16(Math.log2(pow))
    .u16(n * 16 - pow * 16);
  let offset = 12 + n * 16;
  let headOffset = 0;
  for (const [tag, data] of tables) {
    if (tag === 'head') headOffset = offset;
    font.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of tables) font.raw(data).pad4();
  const bytes = font.done();
  const adjust = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adjust);
  return bytes;
}

let installed = false;

/**
 * Zaregistruje „Karban Digits“ (400 a 700) do `document.fonts`. Volá se jednou při startu aplikace;
 * bez FontFace API nebo při chybě se tiše vrátí (čísla pak kreslí Pixelify Sans).
 */
export function installDigitFont(): void {
  if (installed || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts)
    return;
  installed = true;
  for (const weight of [400, 700] as const) {
    try {
      const bytes = buildDigitFont(weight);
      const face = new FontFace(DIGIT_FONT_FAMILY, bytes.buffer as ArrayBuffer, {
        weight: String(weight),
        style: 'normal',
        unicodeRange: DIGIT_FONT_RANGE,
        display: 'swap',
      });
      document.fonts.add(face);
      face.load().catch(() => undefined);
    } catch {
      // Písmo je jen vylepšení čitelnosti — bez něj hra běží dál.
    }
  }
}
