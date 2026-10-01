/**
 * Česká typografie a formátování čísel — čisté funkce bez DOM a bez `Intl`.
 *
 * Proč ne `Intl.NumberFormat`: výstup se liší mezi prohlížeči/verzemi ICU (např. U+202F místo NBSP),
 * a my potřebujeme deterministický text (testy, screenshoty, sdílené seedy).
 *
 * Konvence (viz docs/CONTENT-GUIDE.md, kap. 12):
 *  - oddělovač tisíců NBSP (U+00A0): `1 340 000`,
 *  - desetinná čárka, nejvýš 2 desetinná místa, bez koncových nul: `1,5`, `393,75`,
 *  - zápor znakem minus U+2212: `−5`,
 *  - od |n| ≥ 1e15 vědecký zápis s čárkou: `1,23e16`,
 *  - `×1,5`, `5 Kč` (s NBSP).
 */

export const NBSP = '\u00a0';
/** Typografické minus (U+2212). */
export const MINUS = '−';
/** Znak násobení (U+00D7). */
export const TIMES = '×';
/** Od této absolutní hodnoty se čísla píšou vědecky. */
export const SCIENTIFIC_THRESHOLD = 1e15;
/** Jednotka měny. */
export const CURRENCY = 'Kč';

// ─────────────────────────── Skloňování ───────────────────────────

/** Tvary slova pro 1 / 2–4 / 0, 5+ a necelá čísla. */
export type PluralForms = readonly [one: string, few: string, many: string];

/**
 * Vybere tvar slova podle čísla: 1 → `one`, 2–4 → `few`, 0, 5+ a necelá čísla → `many`.
 * Záporná čísla se řídí absolutní hodnotou (−1 → `one`).
 *
 * @example plural(3, 'karta', 'karty', 'karet') // 'karty'
 */
export function plural<T>(n: number, one: T, few: T, many: T): T {
  if (!Number.isFinite(n)) return many;
  const a = Math.abs(n);
  if (!Number.isInteger(a)) return many;
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/**
 * Číslo + správný tvar slova, spojené nezlomitelnou mezerou.
 *
 * @example pluralize(5, ['karta', 'karty', 'karet']) // '5 karet' (s NBSP)
 */
export function pluralize(n: number, forms: PluralForms): string {
  return `${formatNumber(n)}${NBSP}${plural(n, forms[0], forms[1], forms[2])}`;
}

// ─────────────────────────── Čísla ───────────────────────────

/** Seskupí řetězec číslic po třech zprava pomocí NBSP. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Nezáporné konečné číslo pod prahem: seskupené tisíce, max. 2 desetinná místa. */
function formatFixed(a: number): string {
  let int = Math.floor(a);
  // Desetinnou část zaokrouhlujeme zvlášť — u velkých čísel by a × 100 překročilo přesnost doublu.
  let cents = Math.round((a - int) * 100);
  if (cents >= 100) {
    int += 1;
    cents -= 100;
  }
  if (int >= SCIENTIFIC_THRESHOLD) return formatScientific(int);
  const intStr = groupThousands(String(int));
  if (cents === 0) return intStr;
  let frac = String(cents).padStart(2, '0');
  if (frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${intStr},${frac}`;
}

/** Nezáporné konečné číslo vědecky: mantisa na 2 desetinná místa bez koncových nul, `1,23e16`. */
function formatScientific(a: number): string {
  const [mantissa = '0', exponent = '0'] = a.toExponential(2).split('e');
  const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
  return `${trimmed.replace('.', ',')}e${Number(exponent)}`;
}

/**
 * Česky formátované číslo: `1 340 000`, `1,5`, `−5`, `1,23e16`, `∞`.
 * NaN se zobrazí jako `0` (raději nula než „NaN“ v UI).
 */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return '0';
  if (n === Infinity) return '∞';
  if (n === -Infinity) return `${MINUS}∞`;
  const a = Math.abs(n);
  const body = a >= SCIENTIFIC_THRESHOLD ? formatScientific(a) : formatFixed(a);
  // Zaokrouhlení na nulu (např. −0,001) se zobrazí bez znaménka.
  return n < 0 && body !== '0' ? `${MINUS}${body}` : body;
}

/** Číslo se znaménkem: `+5`, `−5`, `0`. */
export function formatSigned(n: number): string {
  const body = formatNumber(n);
  if (body === '0' || body.startsWith(MINUS)) return body;
  return `+${body}`;
}

/**
 * Čipy přidané efektem („bublina“): `+30`. Pro průběžný stav počítadla použij `formatNumber`.
 */
export function formatChips(n: number): string {
  return formatSigned(n);
}

/** +mult přidaný efektem: `+4`. Pro průběžný stav počítadla použij `formatNumber`. */
export function formatMult(n: number): string {
  return formatSigned(n);
}

/** Násobič multu: `×1,5`, `×2`. */
export function formatXMult(n: number): string {
  return `${TIMES}${formatNumber(n)}`;
}

/** Peníze: `5 Kč`, `−3 Kč`, `0 Kč` (s NBSP). */
export function formatMoney(n: number): string {
  return `${formatNumber(n)}${NBSP}${CURRENCY}`;
}

// ─────────────────────────── Typografie ───────────────────────────

/**
 * Jednopísmenné předložky a spojky (k, s, v, z, o, u, a, i) na začátku slova, za nimiž následuje mezera
 * a další text. Lookbehind kontroluje původní řetězec, takže zvládne i řetězce „a v lese“.
 */
const SINGLE_LETTER_WORD = /(?<=^|[\s(„‚"'[{–—])([ksvzouaiKSVZOUAI]) +(?=\S)/g;
/** Číslo následované mezerou a slovem/jednotkou/procentem: `5 Kč`, `3 karty`, `10 %`. */
const NUMBER_WITH_UNIT = /(\d) +(?=[\p{L}%])/gu;
/** Mezera před větnou pomlčkou (pomlčka nesmí začínat řádek): `ne – ten` → `ne\u00a0– ten`. */
const SPACE_BEFORE_DASH = / +(?=– )/g;
/** Rovné uvozovky v páru → české „…“. */
const STRAIGHT_QUOTES = /"([^"\n]*)"/g;

/**
 * Česká typografie pro text hráči:
 *  - nezlomitelná mezera za jednopísmennými předložkami a spojkami (`v ruce`, `a k tomu`),
 *  - nezlomitelná mezera mezi číslem a slovem/jednotkou (`5 Kč`, `3 karty`, `10 %`),
 *  - nezlomitelná mezera před větnou pomlčkou `–` (pomlčka nezačne řádek),
 *  - `...` → `…`,
 *  - rovné uvozovky `"x"` → české `„x“`.
 *
 * Funkce je idempotentní (`typo(typo(x)) === typo(x)`).
 */
export function typo(text: string): string {
  return text
    .replace(/\.\.\./g, '…')
    .replace(STRAIGHT_QUOTES, '„$1“')
    .replace(SINGLE_LETTER_WORD, `$1${NBSP}`)
    .replace(NUMBER_WITH_UNIT, `$1${NBSP}`)
    .replace(SPACE_BEFORE_DASH, NBSP);
}

// ─────────────────────────── Interpolace ───────────────────────────

export type InterpolationParams = Readonly<Record<string, string | number>>;

/** `{key}` nebo `{key|filtr}` nebo `{key|filtr:argumenty}`. */
const PLACEHOLDER = /\{([\w.]+)(?:\|(\w+)(?::([^}]*))?)?\}/g;

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function parseForms(arg: string | undefined): PluralForms | null {
  if (arg === undefined) return null;
  const parts = arg.split(',').map((s) => s.trim());
  if (parts.length !== 3 || parts.some((p) => p === '')) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function formatValue(value: string | number): string {
  return typeof value === 'number' ? formatNumber(value) : value;
}

function applyFilter(value: string | number, filter: string | undefined, arg: string | undefined): string {
  if (filter === undefined || filter === 'raw') {
    return filter === 'raw' ? String(value) : formatValue(value);
  }
  const n = toNumber(value);
  if (Number.isNaN(n)) return formatValue(value);
  switch (filter) {
    case 'plural': {
      const forms = parseForms(arg);
      return forms ? pluralize(n, forms) : formatNumber(n);
    }
    case 'word': {
      const forms = parseForms(arg);
      return forms ? plural(n, forms[0], forms[1], forms[2]) : formatNumber(n);
    }
    case 'money':
      return formatMoney(n);
    case 'signed':
      return formatSigned(n);
    case 'x':
      return formatXMult(n);
    default:
      return formatValue(value);
  }
}

/**
 * Dosadí parametry do šablony.
 *
 *  - `{key}` — číslo se naformátuje česky (`formatNumber`), řetězec se vloží beze změny,
 *  - `{key|plural:karta,karty,karet}` — číslo + tvar slova (`3 karty` s NBSP),
 *  - `{key|word:karta,karty,karet}` — jen tvar slova (`karty`),
 *  - `{key|money}` → `5 Kč`, `{key|signed}` → `+5`, `{key|x}` → `×1,5`, `{key|raw}` → bez formátování.
 *
 * Chybějící parametr nechá zástupný symbol beze změny (aby chyba byla v UI vidět).
 */
export function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(
    PLACEHOLDER,
    (match: string, key: string, filter: string | undefined, arg: string | undefined) => {
      if (!Object.hasOwn(params, key)) return match;
      const value = params[key];
      if (value === undefined) return match;
      return applyFilter(value, filter, arg);
    },
  );
}
