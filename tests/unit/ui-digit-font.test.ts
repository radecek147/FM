/**
 * Písmo „Karban Digits“ (src/ui/art/digitFont.ts): platná struktura TrueType (hlavička, tabulky, kontrolní
 * součet), cmap pro číslice a „problémová“ písmena (C, c, Z, háčky, kroužky), obrysy skládané z mřížky (orientace,
 * díry) a čitelnost v drobném textu (otevřená „3“, otvor „C“, široký háček — test 1.0.1).
 */
import { describe, expect, it } from 'vitest';
import {
  DIGIT_FONT_CODES,
  DIGIT_FONT_RANGE,
  buildDigitFont,
  digitContours,
  glyphContours,
  installDigitFont,
  unicodeRange,
} from '../../src/ui/art/digitFont';

const code = (ch: string): number => ch.codePointAt(0)!;
/** Znaky písma: číslice, C/c, Z a česká písmena s háčkem a kroužkem (ď a ť mají apostrof — zůstávají Pixelify). */
const CHARS = '0123456789CZcČčĎĚěŇňŘřŠšŤŮůŽž';

const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number): number => ((u16(b, o) << 16) | u16(b, o + 2)) >>> 0;
const i16 = (b: Uint8Array, o: number): number => {
  const v = u16(b, o);
  return v >= 0x8000 ? v - 0x10000 : v;
};

function tables(font: Uint8Array): Map<string, { offset: number; length: number; checksum: number }> {
  const n = u16(font, 4);
  const out = new Map<string, { offset: number; length: number; checksum: number }>();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(font[r]!, font[r + 1]!, font[r + 2]!, font[r + 3]!);
    out.set(tag, { checksum: u32(font, r + 4), offset: u32(font, r + 8), length: u32(font, r + 12) });
  }
  return out;
}

function sum(bytes: Uint8Array, from = 0, length = bytes.length): number {
  let s = 0;
  for (let i = from; i < from + length; i += 4) {
    const w =
      ((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0);
    s = (s + (w >>> 0)) >>> 0;
  }
  return s;
}

/** Glyf pro kódový bod podle cmap formátu 4 (platforma 3, kódování 1). */
function glyphFor(font: Uint8Array, code: number): number {
  const cmap = tables(font).get('cmap')!;
  const sub = cmap.offset + u32(font, cmap.offset + 8);
  expect(u16(font, sub)).toBe(4);
  const segX2 = u16(font, sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  for (let i = 0; i < segX2 / 2; i++) {
    const end = u16(font, ends + i * 2);
    const start = u16(font, starts + i * 2);
    if (code >= start && code <= end) return (code + i16(font, deltas + i * 2)) & 0xffff;
  }
  return 0;
}

describe('Karban Digits', () => {
  for (const weight of [400, 700] as const) {
    it(`váha ${weight}: platné sfnt s povinnými tabulkami a kontrolním součtem`, () => {
      const font = buildDigitFont(weight);
      expect(u32(font, 0)).toBe(0x00010000);
      const t = tables(font);
      expect([...t.keys()]).toEqual([
        'OS/2',
        'cmap',
        'glyf',
        'head',
        'hhea',
        'hmtx',
        'loca',
        'maxp',
        'name',
        'post',
      ]);
      for (const [tag, rec] of t) {
        expect(rec.offset % 4, tag).toBe(0);
        expect(rec.offset + rec.length).toBeLessThanOrEqual(font.length);
        if (tag !== 'head') expect(sum(font, rec.offset, rec.length), tag).toBe(rec.checksum);
      }
      const head = t.get('head')!;
      expect(u32(font, head.offset + 12)).toBe(0x5f0f3cf5);
      expect(u16(font, head.offset + 18)).toBe(1000);
      // Celý soubor (s checkSumAdjustment) musí dát magické 0xB1B0AFBA.
      expect(sum(font)).toBe(0xb1b0afba);
      // maxp: .notdef + všechny znaky písma
      expect(u16(font, t.get('maxp')!.offset + 4)).toBe(1 + CHARS.length);
    });

    it(`váha ${weight}: cmap pokrývá číslice, C, c, Z a písmena s háčkem a kroužkem, jinak .notdef`, () => {
      const font = buildDigitFont(weight);
      const sorted = [...CHARS].map(code).sort((a, b) => a - b);
      sorted.forEach((c, i) => expect(glyphFor(font, c), String.fromCodePoint(c)).toBe(i + 1));
      expect(glyphFor(font, code('A'))).toBe(0);
      expect(glyphFor(font, code('S'))).toBe(0); // „S“ zůstává Pixelify Sans (jen Š má nový háček)
      expect(glyphFor(font, code('ď'))).toBe(0);
    });

    it(`váha ${weight}: „3“ je vlevo otevřená (žádný háček vlevo mezi horní a dolní linkou)`, () => {
      const pts = glyphContours(weight, code('3')).flat();
      const leftEdge = Math.min(...pts.map(([x]) => x));
      // Body na levém kraji jsou jen u horní a dolní linky (nahoře ≥ 500, dole ≤ 130) — nic uprostřed.
      const leftMid = pts.filter(([x, y]) => x < leftEdge + 120 && y > 130 && y < 500);
      expect(leftMid).toEqual([]);
    });

    it(`váha ${weight}: „6“ a „9“ nemají koncový háček, „0“ je užší než ostatní číslice`, () => {
      const six = glyphContours(weight, code('6')).flat();
      // Pravý kraj „6“ mezi horní linkou a bříškem je prázdný.
      expect(six.filter(([x, y]) => x > 420 && y > 400 && y < 500)).toEqual([]);
      const nine = glyphContours(weight, code('9')).flat();
      expect(nine.filter(([x, y]) => x < 160 && y > 130 && y < 240)).toEqual([]);
      const width = (c: string): number => {
        const xs = glyphContours(weight, code(c))
          .flat()
          .map(([x]) => x);
        return Math.max(...xs) - Math.min(...xs);
      };
      expect(width('0')).toBeLessThan(width('8') - 60);
    });

    it(`váha ${weight}: „C“ a „c“ mají otvor vpravo přes dva pixely`, () => {
      for (const [ch, lo, hi] of [
        ['C', 220, 410],
        ['c', 140, 320],
      ] as const) {
        const pts = glyphContours(weight, code(ch)).flat();
        const right = Math.max(...pts.map(([x]) => x));
        // Na pravém okraji (svislice / konce linek) není žádný bod v pásmu otvoru.
        expect(
          pts.filter(([x, y]) => x > right - 120 && y > lo && y < hi),
          ch,
        ).toEqual([]);
      }
    });

    it(`váha ${weight}: háček je široký „v“ (≥ 250 jednotek, se zářezem), ne tečka`, () => {
      for (const ch of 'čČšŠžŽěřň') {
        const contours = glyphContours(weight, code(ch));
        const base = ch === ch.toLowerCase() ? 480 : 660;
        const caron = contours.flat().filter(([, y]) => y > base);
        const xs = caron.map(([x]) => x);
        expect(Math.max(...xs) - Math.min(...xs), ch).toBeGreaterThanOrEqual(250);
      }
    });
  }

  it('unicode-range odpovídá cmap', () => {
    expect(DIGIT_FONT_CODES).toEqual([...CHARS].map(code).sort((a, b) => a - b));
    expect(DIGIT_FONT_RANGE).toBe(
      'U+0030-0039, U+0043, U+005A, U+0063, U+010C-010E, U+011A-011B, U+0147-0148, U+0158-0159, U+0160-0161, ' +
        'U+0164, U+016E-016F, U+017D-017E',
    );
    expect(unicodeRange([0x41, 0x42, 0x43, 0x45])).toBe('U+0041-0043, U+0045');
  });

  it('obrysy: plný čtverec = jeden obrys po směru hodinových ručiček, prstenec = obrys + díra', () => {
    const square = digitContours({ x: [0, 10, 20], y: [20, 10, 0], rows: ['##', '##'] });
    expect(square).toEqual([
      [
        [0, 20],
        [20, 20],
        [20, 0],
        [0, 0],
      ],
    ]);
    const ring = digitContours({ x: [0, 10, 20, 30], y: [30, 20, 10, 0], rows: ['###', '#.#', '###'] });
    expect(ring).toHaveLength(2);
    // Plocha se znaménkem (shoelace, osa y nahoru): vnější obrys záporná (po směru), díra kladná.
    const area = (pts: readonly (readonly [number, number])[]): number =>
      pts.reduce((a, [x, y], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length]!;
        return a + (x * ny - nx * y);
      }, 0) / 2;
    const areas = ring.map(area).sort((a, b) => a - b);
    expect(areas[0]).toBe(-900);
    expect(areas[1]).toBe(100);
  });

  it('nesedící mřížka je chyba, ne tichý nesmysl', () => {
    expect(() => digitContours({ x: [0, 10], y: [10, 0], rows: ['##'] })).toThrow();
  });

  it('bez FontFace API (Node) se instalace tiše vynechá', () => {
    expect(() => installDigitFont()).not.toThrow();
  });
});
