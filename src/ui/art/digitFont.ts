/**
 * Písmo „Karban Digits“ — číslice 0–9 a písmena Z / Ž skládané z pixelové mřížky a sestavené za běhu
 * do TrueType (FontFace API).
 *
 * Proč: v Pixelify Sans jsou „5“ a „S“ stejné glyfy a „Z“ vypadá jako „2“, takže cíl „650“ vypadal jako „6S0“
 * a tlačítko „Zahrát“ jako „2ahrát“. Hra je plná čísel, proto má tyhle znaky vlastní písmo, které se
 * v `--font-game` řadí před Pixelify Sans a díky `unicode-range` přebírá jen U+0030–0039, U+005A a U+017D.
 * Ostatní znaky dál kreslí Pixelify Sans.
 *
 * Glyfy: obrysy Pixelify Sans (© 2021 The Pixelify Sans Project Authors, SIL Open Font License 1.1) přepsané
 * do obdélníkové mřížky ve stejných jednotkách (UPM 1000, váhy 400 a 700). „5“ dostala rovnou horní linku
 * s ostrými rohy, „2“ rovnou patku, „7“ přišla o háček vlevo a „Z“ má šikmou tahu po schodech (mřížka „X“),
 * háček „Ž“ je původní. Odvozené písmo je tedy také pod OFL 1.1 a nenese rezervované jméno původního písma.
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

/** Číslice (jedna část) — tvar mřížky s šířkou znaku. */
interface DigitGrid extends GlyphPart {
  adv: number;
}

/** Glyf písma: kódový bod, šířka a části (Ž = Z + háček). */
interface GlyphDef {
  code: number;
  adv: number;
  parts: readonly GlyphPart[];
}

type Weight = 400 | 700;

// Společné mřížky (Pixelify Sans: číslice 0, 2, 3, 6–9 sdílejí sloupce; 2, 3 a nová 5 i řádky).
const X4 = [60, 151, 161, 423, 433, 525] as const;
const X7 = [61, 149, 188, 414, 453, 542] as const;
const Y4_S = [631, 540, 530, 440, 359, 350, 270, 260, 179, 88, 78, -12] as const;
const Y7_S = [638, 552, 501, 416, 381, 331, 297, 246, 211, 125, 74, -11] as const;

/** Tvary sdílené oběma vahami (liší se jen souřadnice mřížky). */
const SHAPES = {
  zero: ['.###.', '#####', '##.##', '#####', '.###.'],
  one: ['.###.', '#####', '##.##', '...##'],
  // Nová „2“: zaoblená hlava jako v Pixelify Sans, ale rovná patka s ostrými rohy (≠ „Z“).
  two: ['.###.', '#####', '##.##', '...##', '.####', '.###.', '####.', '##...', '##...', '#####', '#####'],
  three: ['.###.', '#####', '##.##', '...##', '.####', '.###.', '.####', '...##', '##.##', '#####', '.###.'],
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
  six: ['.###.', '#####', '##.##', '##...', '####.', '#####', '##.##', '#####', '.###.'],
  // „7“ bez háčku vlevo (v Pixelify Sans připomínala obrácené „ʃ“): rovná horní linka a svislice vpravo.
  seven: ['#####', '#####', '...##', '...##'],
  eight: ['.###.', '#####', '##.##', '#####', '.###.', '#####', '##.##', '#####', '.###.'],
  nine: ['.###.', '#####', '##.##', '#####', '.####', '...##', '##.##', '#####', '.###.'],
} as const;

const GRIDS: Readonly<Record<Weight, readonly DigitGrid[]>> = {
  400: [
    { adv: 586, x: X4, y: [631, 540, 530, 88, 78, -12], rows: SHAPES.zero },
    { adv: 404, x: [60, 151, 161, 241, 251, 343], y: [631, 540, 530, 440, -12], rows: SHAPES.one },
    { adv: 586, x: X4, y: Y4_S, rows: SHAPES.two },
    { adv: 586, x: X4, y: Y4_S, rows: SHAPES.three },
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
    { adv: 603, x: X7, y: [638, 552, 501, 125, 74, -11], rows: SHAPES.zero },
    { adv: 426, x: [61, 149, 188, 237, 276, 365], y: [638, 552, 501, 416, -11], rows: SHAPES.one },
    { adv: 603, x: X7, y: Y7_S, rows: SHAPES.two },
    { adv: 603, x: X7, y: Y7_S, rows: SHAPES.three },
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
const SHAPE_CARON = ['##.##', '#####', '.###.'];

const LETTERS: Readonly<Record<Weight, { adv: number; z: GlyphPart; caron: GlyphPart }>> = {
  400: {
    adv: 586,
    z: {
      x: [60, 151, 161, 241, 251, 333, 343, 423, 433, 525],
      y: [631, 540, 530, 359, 350, 270, 260, 88, 78, -12],
      rows: SHAPE_Z,
    },
    caron: { x: [220, 265, 275, 311, 321, 366], y: [806, 760, 751, 705], rows: SHAPE_CARON },
  },
  700: {
    adv: 603,
    z: {
      x: [61, 149, 188, 237, 276, 326, 365, 414, 453, 542],
      y: [638, 552, 501, 381, 331, 297, 246, 125, 74, -11],
      rows: SHAPE_Z,
    },
    caron: { x: [217, 261, 299, 305, 344, 388], y: [818, 775, 725, 681], rows: SHAPE_CARON },
  },
};

const CODE_ZERO = 0x30;
const CODE_Z = 0x5a;
const CODE_Z_CARON = 0x17d;

/** Všechny glyfy dané váhy seřazené podle kódového bodu. */
function glyphDefs(weight: Weight): GlyphDef[] {
  const l = LETTERS[weight];
  return [
    ...GRIDS[weight].map((g, i) => ({ code: CODE_ZERO + i, adv: g.adv, parts: [g] })),
    { code: CODE_Z, adv: l.adv, parts: [l.z] },
    { code: CODE_Z_CARON, adv: l.adv, parts: [l.z, l.caron] },
  ];
}

/** `unicode-range` písma (FontFace) — jen znaky, které písmo opravdu má. */
export const DIGIT_FONT_RANGE = 'U+0030-0039, U+005A, U+017D';

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
  const contours = def.parts.flatMap(digitContours);
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

/** Sestaví TrueType s glyfy .notdef + 0–9, Z, Ž pro danou váhu. */
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
