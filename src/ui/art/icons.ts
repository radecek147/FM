/**
 * Ikony (game-icons.net, CC BY 3.0) pro procedurální SVG.
 *
 * Data ikon mají ~355 kB, proto se načítají **dynamickým importem jako samostatný chunk** — `loadIcons()` se volá
 * při startu aplikace před prvním vykreslením. Potom je `iconMarkup()` synchronní. Dokud ikony nejsou načtené
 * (nebo ikona neexistuje), vrací náhradní glyf, takže se nic nerozbije.
 *
 * Vestavěné glyfy (`suit-S|H|D|C`, `star`, `sparkle`, `arrow`, `question`) jsou k dispozici vždy, i bez načtení.
 */

interface IconData {
  svgs: Readonly<Record<string, string>>;
  viewBox(name: string): string;
}

const DEFAULT_VIEWBOX = '0 0 512 512';

let data: IconData | null = null;
let loading: Promise<void> | null = null;

/**
 * Obrysy barev karet (♠ ♥ ♦ ♣) ve čtverci 512 × 512 — sdílí je hrací karty (src/ui/art/cards.ts)
 * i vestavěné glyfy `suit-S|H|D|C`.
 */
export const SUIT_PATH_D = {
  S: 'M256 24C316 116 492 196 492 316c0 70-56 118-118 118c-42 0-74-20-96-50c4 50 24 82 64 104H170c40-22 60-54 64-104c-22 30-54 50-96 50c-62 0-118-48-118-118C20 196 196 116 256 24z',
  H: 'M256 470C150 392 24 300 24 168C24 94 82 40 150 40c48 0 86 26 106 64c20-38 58-64 106-64c68 0 126 54 126 128c0 132-126 224-232 302z',
  D: 'M256 16c56 90 128 170 214 240c-86 70-158 150-214 240C200 406 128 326 42 256C128 186 200 106 256 16z',
  C: 'M256 44a96 96 0 1 1 0 192a96 96 0 1 1 0-192zM150 204a96 96 0 1 1 0 192a96 96 0 1 1 0-192zM362 204a96 96 0 1 1 0 192a96 96 0 1 1 0-192zM210 220H302L300 330H212zM268 320C268 400 292 448 336 480H176C220 448 244 400 244 320z',
} as const;

const glyphPath = (d: string): string => `<path fill="currentColor" d="${d}"/>`;

/** Vestavěné glyfy (viewBox 0 0 512 512, `fill="currentColor"`). */
const BUILTIN: Readonly<Record<string, string>> = {
  'suit-S': glyphPath(SUIT_PATH_D.S),
  'suit-H': glyphPath(SUIT_PATH_D.H),
  'suit-D': glyphPath(SUIT_PATH_D.D),
  'suit-C': glyphPath(SUIT_PATH_D.C),
  star: glyphPath('M256 28l64 148l160 14l-122 106l38 158l-140-86l-140 86l38-158L32 190l160-14z'),
  sparkle: glyphPath(
    'M256 32c20 144 80 204 224 224c-144 20-204 80-224 224c-20-144-80-204-224-224c144-20 204-80 224-224z',
  ),
  /** Šipka doprava (doleva = CSS `scaleX(-1)`). */
  arrow: glyphPath('M48 216h300l-96-96 56-56 192 192-192 192-56-56 96-96H48z'),
  question: glyphPath(
    'M256 24a232 232 0 1 0 0 464a232 232 0 0 0 0-464zm0 56c62 0 108 38 108 92c0 44-28 66-56 84c-22 14-28 22-28 44v12h-56v-18c0-38 16-56 46-76c22-14 36-26 36-46c0-24-20-40-50-40c-32 0-52 18-56 48l-58-8c8-58 52-92 114-92zm-30 296h60v58h-60z',
  ),
};

/** Náhradní glyf pro neznámou nebo dosud nenačtenou ikonu. */
const FALLBACK = BUILTIN['sparkle'] as string;

/**
 * Načte data ikon (samostatný chunk). Opakované volání vrací stejný slib; chyba načtení se zaloguje
 * a ikony zůstanou na náhradním glyfu (hra jde hrát dál).
 */
export function loadIcons(): Promise<void> {
  loading ??= import('../../assets/icons/index')
    .then((mod) => {
      data = { svgs: mod.ICON_SVGS, viewBox: mod.iconViewBox };
    })
    .catch((err: unknown) => {
      console.warn('[icons] Ikony se nepodařilo načíst, použiji náhradní glyfy.', err);
      loading = null;
    });
  return loading;
}

/** Jsou data ikon načtená? */
export function iconsLoaded(): boolean {
  return data !== null;
}

/** Existuje ikona (vestavěná, nebo načtená z game-icons)? Před načtením zná jen vestavěné. */
export function hasIcon(name: string): boolean {
  return Object.hasOwn(BUILTIN, name) || (data !== null && Object.hasOwn(data.svgs, name));
}

/** Vnitřek ikony (cesty s `fill="currentColor"`) — při neznámé/nenačtené ikoně náhradní glyf. */
export function iconPaths(name: string): string {
  if (Object.hasOwn(BUILTIN, name)) return BUILTIN[name] as string;
  if (data && Object.hasOwn(data.svgs, name)) return data.svgs[name] as string;
  return FALLBACK;
}

/** viewBox ikony. */
export function iconViewBox(name: string): string {
  if (Object.hasOwn(BUILTIN, name) || !data || !Object.hasOwn(data.svgs, name)) return DEFAULT_VIEWBOX;
  return data.viewBox(name);
}

export interface IconBox {
  x?: number;
  y?: number;
  /** Šířka i výška (čtverec). */
  size?: number;
  /** CSS barva ikony (jinak dědí `currentColor`). */
  color?: string;
  /** Doplňkové atributy (už escapované), např. `opacity="0.3"`. */
  extra?: string;
}

/** Escapuje text pro atribut nebo obsah XML/HTML. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|rgba|hsl|hsla)\([\d\s.,%/-]+\)|var\(--[\w-]+(,\s*#[0-9a-f]{3,8})?\))$/i;

/** Barva z dat obsahu, nebo `fallback`, pokud nevypadá jako bezpečná CSS barva. */
export function safeColor(value: string | undefined, fallback: string): string {
  return value && SAFE_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** Číslo do atributu SVG (2 desetinná místa, bez koncových nul). */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** Rozparsovaný viewBox ikony: [minX, minY, šířka, výška]. */
function parseViewBox(name: string): [number, number, number, number] {
  const parts = iconViewBox(name)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [x = 0, y = 0, w = 512, h = 512] = parts;
  return [x, y, w > 0 ? w : 512, h > 0 ? h : 512];
}

/**
 * Synchronní SVG markup ikony jako skupina `<g fill="currentColor" transform="…">` k vložení do jiného SVG —
 * ikona se vepíše do čtverce `box` (bez vnořeného `<svg>`, takže ji nerozbijí globální CSS pravidla pro `svg`).
 * Neznámá nebo dosud nenačtená ikona → náhradní glyf.
 *
 * @example iconMarkup('beer-stein', { x: 50, y: 60, size: 150, color: '#f4ecd8' })
 */
export function iconMarkup(name: string, box: IconBox = {}): string {
  const [vx, vy, vw, vh] = parseViewBox(name);
  const size = box.size ?? Math.max(vw, vh);
  const s = size / Math.max(vw, vh);
  // Vycentrování nečtvercového viewBoxu do čtverce.
  const ox = (box.x ?? 0) + (size - vw * s) / 2 - vx * s;
  const oy = (box.y ?? 0) + (size - vh * s) / 2 - vy * s;
  const attrs = [
    'fill="currentColor"',
    `transform="translate(${fmt(ox)} ${fmt(oy)}) scale(${Math.round(s * 10000) / 10000})"`,
    box.color ? `color="${escapeXml(safeColor(box.color, 'currentColor'))}"` : '',
    box.extra ?? '',
    `data-icon="${escapeXml(hasIcon(name) ? name : 'fallback')}"`,
  ].filter(Boolean);
  return `<g ${attrs.join(' ')}>${iconPaths(name)}</g>`;
}

/** Samostatný SVG markup ikony (`<svg viewBox fill="currentColor">`) pro vložení do HTML. */
export function iconSvgMarkup(name: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeXml(iconViewBox(name))}" fill="currentColor" data-icon="${escapeXml(
    hasIcon(name) ? name : 'fallback',
  )}">${iconPaths(name)}</svg>`;
}

/** Samostatný SVG element ikony pro HTML (dekorativní, `aria-hidden`; velikost řídí CSS, např. `1em`). */
export function iconElement(name: string, opts: { className?: string } = {}): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = iconSvgMarkup(name);
  const el = tpl.content.firstElementChild as SVGSVGElement;
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', ['icon', opts.className].filter(Boolean).join(' '));
  return el;
}
