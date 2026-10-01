/**
 * Obecný renderer `ArtSpec` → SVG (CLAUDE.md kap. 7, ARCHITECTURE 4): ikona + paleta + vzor pozadí + rekvizita,
 * zasazené do rámečku podle druhu obsahu:
 *
 *  - **žolík** — karta s rámečkem podle vzácnosti (cín / modrotisk / fialová / zlato) a drahokamy 1–4,
 *  - **spotřebky** — pranostika = list kalendáře s kroužky, babská rada = papír z notýsku s izolepou,
 *    úřední razítko = perforovaná známka s otiskem razítka,
 *  - **kupón** — lístek s výřezy a ústřižkem, **obálka** — dopisní obálka / tlustá obálka / krabice od bot,
 *  - **štítek** — kulatý odznak na provázku, **šéf** a útraty — hrací žeton (barva `BossDef.color`),
 *  - **síla piva** — pivní tácek, **balíček** — rub karty, **výzva** — karta s šachovnicovým rámem,
 *  - **vylepšení / pečeť** — malý dlaždicový odznak (sbírka, tooltipy).
 *
 * Markup je řetězec; id ve `<defs>` jsou pro každou instanci unikátní. Barvy z obsahu procházejí `safeColor`.
 */
import type { ArtSpec, BoosterDef, ContentRegistry, JokerRarity } from '../../engine/content-types';
import type { BlindKind, ConsumableKind } from '../../engine/types';
import { registry as defaultRegistry } from '../../content';
import { cardBackMarkup, labelSvg, withUniqueIds } from './cards';
import { escapeXml, iconMarkup, safeColor } from './icons';

export type ArtKind =
  | 'joker'
  | 'consumable'
  | 'voucher'
  | 'tag'
  | 'booster'
  | 'boss'
  | 'blind'
  | 'deck'
  | 'stake'
  | 'challenge'
  | 'enhancement'
  | 'seal';

export interface ArtOptions {
  /** Žolík: vzácnost (rámeček). */
  rarity?: JokerRarity;
  /** Spotřebka: typ (tvar rámečku). */
  consumableKind?: ConsumableKind;
  /** Kupón: úroveň v páru. */
  tier?: 1 | 2;
  /** Obálka: velikost. */
  boosterSize?: BoosterDef['size'];
  /** Šéf / útrata: barva žetonu. */
  color?: string;
  /** Přístupný popisek (`role="img"`); bez něj je obrázek dekorativní. */
  label?: string;
}

const ID = '%ID%';
const INK = '#1e1b16';
const PAPER = '#f4ecd8';

/** Rámečky vzácností — vlastní paleta: cín, modrotisk, fialová, zlato. */
export const RARITY_COLORS: Readonly<
  Record<JokerRarity, { frame: string; light: string; dark: string; gems: number }>
> = {
  common: { frame: '#7d8a96', light: '#d3dae0', dark: '#46505a', gems: 1 },
  rare: { frame: '#2f6fb5', light: '#a8cbef', dark: '#1b4272', gems: 2 },
  epic: { frame: '#7b3fb5', light: '#d4b3f0', dark: '#4a2370', gems: 3 },
  legendary: { frame: '#d6a21e', light: '#ffe69a', dark: '#7f5a0c', gems: 4 },
};

/** Barvy typů spotřebek. */
export const CONSUMABLE_COLORS: Readonly<
  Record<ConsumableKind, { frame: string; light: string; dark: string }>
> = {
  pranostika: { frame: '#35648f', light: '#b9d6ef', dark: '#1f3f5e' },
  rada: { frame: '#eadfc4', light: '#fffaf0', dark: '#5d7a2e' },
  razitko: { frame: '#a3272f', light: '#f4ecd8', dark: '#6b161c' },
};

/** Výchozí obrázky žetonů útrat bez šéfa (a šéfa, jehož definice chybí). */
export const BLIND_ART: Readonly<Record<BlindKind, { spec: ArtSpec; color: string }>> = {
  small: { spec: { icon: 'glass-shot', bg: '#1d3f66', fg: '#e8f1ff', pattern: 'dots' }, color: '#3b7fd8' },
  big: { spec: { icon: 'beer-stein', bg: '#5a3a0e', fg: '#fff3d1', pattern: 'stripes' }, color: '#e8a92a' },
  boss: { spec: { icon: 'crowned-skull', bg: '#3a1414', fg: '#ffe1dc', pattern: 'rays' }, color: '#c8372d' },
};

const VIEWBOX: Readonly<Record<ArtKind, string>> = {
  joker: '0 0 250 350',
  consumable: '0 0 250 350',
  voucher: '0 0 250 350',
  booster: '0 0 250 350',
  deck: '0 0 250 350',
  challenge: '0 0 250 350',
  tag: '0 0 120 120',
  boss: '0 0 120 120',
  blind: '0 0 120 120',
  stake: '0 0 120 120',
  enhancement: '0 0 120 120',
  seal: '0 0 120 120',
};

export function artViewBox(kind: ArtKind): string {
  return VIEWBOX[kind];
}

/** Je druh kulatý (žeton, odznak, tácek)? */
export function isRoundArt(kind: ArtKind): boolean {
  return VIEWBOX[kind] === '0 0 120 120';
}

const r1 = (n: number): string => String(Math.round(n * 100) / 100);

// ─────────────────────────── Paleta a vzory ───────────────────────────

interface Palette {
  bg: string;
  fg: string;
  accent: string;
}

function palette(spec: ArtSpec): Palette {
  const bg = safeColor(spec.bg, '#2b2b2b');
  const fg = safeColor(spec.fg, '#f4ecd8');
  return { bg, fg, accent: safeColor(spec.accent, fg) };
}

/** Dlaždice vzoru (`<pattern>`), nebo null pro `none`/`rays` (paprsky se kreslí zvlášť). */
function patternDef(pattern: ArtSpec['pattern'], color: string, scale: number): string | null {
  const s = (n: number): string => r1(n * scale);
  const open = (w: number, h: number, extra = ''): string =>
    `<pattern id="${ID}-pat" width="${s(w)}" height="${s(h)}" patternUnits="userSpaceOnUse"${extra}>`;
  switch (pattern) {
    case 'stripes':
      return `${open(20, 20, ' patternTransform="rotate(35)"')}<rect width="${s(8)}" height="${s(20)}" fill="${color}"/></pattern>`;
    case 'dots':
      return `${open(20, 20)}<circle cx="${s(5)}" cy="${s(5)}" r="${s(3)}" fill="${color}"/><circle cx="${s(15)}" cy="${s(15)}" r="${s(3)}" fill="${color}"/></pattern>`;
    case 'checker':
      return `${open(28, 28)}<rect width="${s(14)}" height="${s(14)}" fill="${color}"/><rect x="${s(14)}" y="${s(14)}" width="${s(14)}" height="${s(14)}" fill="${color}"/></pattern>`;
    case 'waves':
      return `${open(40, 18)}<path d="M0 ${s(9)}Q${s(10)} 0 ${s(20)} ${s(9)}T${s(40)} ${s(9)}" fill="none" stroke="${color}" stroke-width="${s(3)}"/></pattern>`;
    case 'grid':
      return `${open(22, 22)}<path d="M0 0H${s(22)}M0 0V${s(22)}" fill="none" stroke="${color}" stroke-width="${s(2.5)}"/></pattern>`;
    case 'zigzag':
      return `${open(32, 20)}<path d="M0 ${s(14)}L${s(8)} ${s(6)}L${s(16)} ${s(14)}L${s(24)} ${s(6)}L${s(32)} ${s(14)}" fill="none" stroke="${color}" stroke-width="${s(3)}" stroke-linejoin="round"/></pattern>`;
    default:
      return null;
  }
}

/** Paprsky ze středu (vzor `rays` a zlatá záře legendárních žolíků). */
function rays(cx: number, cy: number, radius: number, color: string, count = 16, opacity = 1): string {
  let d = '';
  const half = Math.PI / count / 2;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const x1 = cx + Math.cos(a - half) * radius;
    const y1 = cy + Math.sin(a - half) * radius;
    const x2 = cx + Math.cos(a + half) * radius;
    const y2 = cy + Math.sin(a + half) * radius;
    d += `M${r1(cx)} ${r1(cy)}L${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}z`;
  }
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }
  | { kind: 'circle'; cx: number; cy: number; r: number };

function shapeMarkup(shape: Shape, attrs: string): string {
  return shape.kind === 'rect'
    ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.rx}" ${attrs}/>`
    : `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" ${attrs}/>`;
}

function shapeCenter(shape: Shape): { cx: number; cy: number; half: number } {
  return shape.kind === 'rect'
    ? { cx: shape.x + shape.w / 2, cy: shape.y + shape.h / 2, half: Math.max(shape.w, shape.h) / 2 }
    : { cx: shape.cx, cy: shape.cy, half: shape.r };
}

interface WindowOpts {
  /** Velikost hlavní ikony (jinak podle tvaru). */
  iconSize?: number;
  /** Svislý posun ikony od středu okna. */
  iconDy?: number;
  /** Zlatá záře za ikonou (legendární). */
  glow?: string;
  /** Měřítko vzoru (malé žetony mají jemnější vzor). */
  patternScale?: number;
  /** Kreslit rekvizitu? */
  prop?: boolean;
}

/** Okno s obrázkem: podklad, vzor, vinětace, stín ikony, ikona, rekvizita. Vrací [defs, body]. */
function artWindow(spec: ArtSpec, shape: Shape, opts: WindowOpts = {}): [string, string] {
  const p = palette(spec);
  const { cx, cy, half } = shapeCenter(shape);
  const scale = opts.patternScale ?? 1;
  const pat = patternDef(spec.pattern, p.accent, scale);
  let defs =
    `<clipPath id="${ID}-clip">${shapeMarkup(shape, '')}</clipPath>` +
    `<radialGradient id="${ID}-vig" cx="50%" cy="45%" r="70%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>`;
  if (pat) defs += pat;

  const size = opts.iconSize ?? Math.round(half * 1.15);
  const iy = cy - size / 2 + (opts.iconDy ?? 0);
  const ix = cx - size / 2;
  let body =
    `<g clip-path="url(#${ID}-clip)">` +
    shapeMarkup(shape, `fill="${p.bg}"`) +
    (opts.glow ? rays(cx, cy + (opts.iconDy ?? 0), half * 1.6, opts.glow, 20, 0.35) : '') +
    (pat ? shapeMarkup(shape, `fill="url(#${ID}-pat)" opacity="0.2"`) : '') +
    (spec.pattern === 'rays' ? rays(cx, cy, half * 1.6, p.accent, 16, 0.16) : '') +
    shapeMarkup(shape, `fill="url(#${ID}-vig)"`) +
    `</g>` +
    `<g class="art-icon">` +
    iconMarkup(spec.icon, {
      x: ix + size * 0.03,
      y: iy + size * 0.05,
      size,
      color: '#000000',
      extra: 'opacity="0.28"',
    }) +
    iconMarkup(spec.icon, { x: ix, y: iy, size, color: p.fg }) +
    `</g>`;

  if (spec.prop && opts.prop !== false) {
    const ps = Math.round(size * 0.36);
    const pr = ps * 0.72;
    const pcx = shape.kind === 'rect' ? shape.x + shape.w - pr - 8 : cx + half * 0.6;
    const pcy = shape.kind === 'rect' ? shape.y + shape.h - pr - 8 : cy + half * 0.6;
    body +=
      `<g class="art-prop">` +
      `<circle cx="${r1(pcx)}" cy="${r1(pcy)}" r="${r1(pr)}" fill="${p.bg}" stroke="${p.accent}" stroke-width="${r1(Math.max(1.5, pr * 0.1))}"/>` +
      iconMarkup(spec.prop, {
        x: pcx - ps / 2,
        y: pcy - ps / 2,
        size: ps,
        color: p.accent,
      }) +
      `</g>`;
  }
  return [defs, body];
}

/** Kosočtverečné drahokamy (počet = úroveň vzácnosti, čitelné i bez barev). */
function gems(count: number, cy: number, color: string, stroke: string): string {
  const gap = 26;
  const start = 125 - ((count - 1) * gap) / 2;
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = start + i * gap;
    out += `<path d="M${r1(x)} ${cy - 10}l9 10l-9 10l-9-10z" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
  }
  return out;
}

// ─────────────────────────── Druhy rámečků ───────────────────────────

function jokerArt(spec: ArtSpec, rarity: JokerRarity): [string, string] {
  const r = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;
  const [defs, win] = artWindow(
    spec,
    { kind: 'rect', x: 16, y: 16, w: 218, h: 262, rx: 8 },
    {
      iconSize: 150,
      glow: rarity === 'legendary' ? r.light : undefined,
    },
  );
  const corners =
    rarity === 'epic' || rarity === 'legendary'
      ? [
          [16, 16],
          [234, 16],
          [16, 278],
          [234, 278],
        ]
          .map(
            ([x, y]) =>
              `<path d="M${x} ${(y ?? 0) - 9}l9 9l-9 9l-9-9z" fill="${r.light}" stroke="${r.dark}" stroke-width="2"/>`,
          )
          .join('')
      : '';
  const body =
    `<rect x="2" y="2" width="246" height="346" rx="18" fill="${r.frame}" stroke="${r.dark}" stroke-width="3"/>` +
    `<rect x="8" y="8" width="234" height="334" rx="13" fill="none" stroke="${r.light}" stroke-width="2" opacity="0.75"/>` +
    win +
    `<rect x="16" y="16" width="218" height="262" rx="8" fill="none" stroke="${r.dark}" stroke-width="3"/>` +
    corners +
    `<rect x="16" y="288" width="218" height="46" rx="8" fill="${r.dark}"/>` +
    gems(r.gems, 311, r.light, INK);
  return [defs, body];
}

function consumableArt(spec: ArtSpec, kind: ConsumableKind): [string, string] {
  const c = CONSUMABLE_COLORS[kind];
  if (kind === 'rada') {
    // Papír z notýsku: linky, červený okraj, izolepa; dole bylinkový štítek.
    const [defs, win] = artWindow(
      spec,
      { kind: 'rect', x: 30, y: 40, w: 196, h: 228, rx: 4 },
      { iconSize: 140 },
    );
    let lines = '';
    for (let y = 30; y < 340; y += 16)
      lines += `<path d="M10 ${y}H240" stroke="#9fb6cf" stroke-width="1" opacity="0.6"/>`;
    const body =
      `<rect x="2" y="2" width="246" height="346" rx="10" fill="${c.frame}" stroke="#b9a77d" stroke-width="3"/>` +
      lines +
      `<path d="M22 4V346" stroke="#d26b6b" stroke-width="2"/>` +
      win +
      `<rect x="30" y="40" width="196" height="228" rx="4" fill="none" stroke="#8a7a55" stroke-width="2.5"/>` +
      `<rect x="10" y="22" width="64" height="20" fill="#f3e39a" opacity="0.8" transform="rotate(-24 42 32)"/>` +
      `<rect x="176" y="22" width="64" height="20" fill="#f3e39a" opacity="0.8" transform="rotate(24 208 32)"/>` +
      `<rect x="30" y="284" width="196" height="46" rx="8" fill="${c.dark}"/>` +
      iconMarkup('linden-leaf', { x: 111, y: 293, size: 28, color: '#eaf3d2' });
    return [defs, body];
  }
  if (kind === 'razitko') {
    // Poštovní známka: perforovaný okraj (maska), červený rám, otisk razítka.
    const [defs, win] = artWindow(
      spec,
      { kind: 'rect', x: 24, y: 24, w: 202, h: 244, rx: 2 },
      { iconSize: 140 },
    );
    let holes = '';
    for (let x = 14; x <= 236; x += 22)
      holes += `<circle cx="${x}" cy="2" r="7"/><circle cx="${x}" cy="348" r="7"/>`;
    for (let y = 14; y <= 336; y += 22)
      holes += `<circle cx="2" cy="${y}" r="7"/><circle cx="248" cy="${y}" r="7"/>`;
    const mask = `<mask id="${ID}-perf"><rect width="250" height="350" fill="#fff"/><g fill="#000">${holes}</g></mask>`;
    const body =
      `<g mask="url(#${ID}-perf)"><rect x="0" y="0" width="250" height="350" fill="${c.light}"/></g>` +
      `<rect x="14" y="14" width="222" height="322" fill="none" stroke="${c.frame}" stroke-width="6"/>` +
      win +
      `<rect x="24" y="24" width="202" height="244" rx="2" fill="none" stroke="${c.dark}" stroke-width="2"/>` +
      `<rect x="24" y="282" width="202" height="44" rx="4" fill="${c.frame}"/>` +
      iconMarkup('stamper', { x: 111, y: 290, size: 28, color: c.light }) +
      `<g opacity="0.55" fill="none" stroke="${c.frame}"><circle cx="192" cy="236" r="40" stroke-width="5"/>` +
      `<circle cx="192" cy="236" r="30" stroke-width="2" stroke-dasharray="5 4"/>` +
      `<path d="M158 250l68-28" stroke-width="4"/></g>`;
    return [defs + mask, body];
  }
  // Pranostika: list z kalendáře s kroužkovou vazbou a záhlavím.
  const [defs, win] = artWindow(
    spec,
    { kind: 'rect', x: 16, y: 66, w: 218, h: 210, rx: 6 },
    { iconSize: 136 },
  );
  const body =
    `<rect x="2" y="10" width="246" height="338" rx="14" fill="${c.light}" stroke="${c.dark}" stroke-width="3"/>` +
    `<path d="M2 24a14 14 0 0 1 14-14h218a14 14 0 0 1 14 14v34H2z" fill="${c.frame}"/>` +
    `<path d="M16 46H234" stroke="${c.light}" stroke-width="2" opacity="0.5" stroke-dasharray="6 6"/>` +
    [70, 180]
      .map(
        (x) =>
          `<circle cx="${x}" cy="22" r="8" fill="${INK}" opacity="0.7"/><rect x="${x - 4}" y="0" width="8" height="24" rx="4" fill="#c9ccd1" stroke="#555b63" stroke-width="2"/>`,
      )
      .join('') +
    win +
    `<rect x="16" y="66" width="218" height="210" rx="6" fill="none" stroke="${c.dark}" stroke-width="3"/>` +
    `<rect x="16" y="288" width="218" height="46" rx="8" fill="${c.frame}"/>` +
    iconMarkup('fluffy-cloud', { x: 109, y: 295, size: 32, color: c.light });
  return [defs, body];
}

function voucherArt(spec: ArtSpec, tier: 1 | 2): [string, string] {
  const frame = tier === 2 ? '#b8860b' : '#2f6b4f';
  const light = tier === 2 ? '#ffe69a' : '#cfe8d8';
  const [defs, win] = artWindow(
    spec,
    { kind: 'rect', x: 20, y: 20, w: 210, h: 240, rx: 8 },
    { iconSize: 140 },
  );
  const mask =
    `<mask id="${ID}-tick"><rect width="250" height="350" fill="#fff"/>` +
    `<circle cx="0" cy="282" r="16" fill="#000"/><circle cx="250" cy="282" r="16" fill="#000"/></mask>`;
  const body =
    `<g mask="url(#${ID}-tick)"><rect x="2" y="2" width="246" height="346" rx="16" fill="${frame}" stroke="${INK}" stroke-opacity="0.4" stroke-width="3"/>` +
    `<rect x="10" y="10" width="230" height="330" rx="10" fill="none" stroke="${light}" stroke-width="2" stroke-dasharray="8 5"/></g>` +
    win +
    `<rect x="20" y="20" width="210" height="240" rx="8" fill="none" stroke="${light}" stroke-width="3"/>` +
    `<path d="M22 282H228" stroke="${light}" stroke-width="3" stroke-dasharray="7 7"/>` +
    iconMarkup('ticket', { x: 105, y: 296, size: 40, color: light }) +
    (tier === 2 ? `<path d="M40 316l6-14l6 14l-14-9h16zM198 316l6-14l6 14l-14-9h16z" fill="${light}"/>` : '');
  return [defs + mask, body];
}

function boosterArt(spec: ArtSpec, size: BoosterDef['size']): [string, string] {
  const p = palette(spec);
  const pat = patternDef(spec.pattern, p.accent, 1.2);
  const fill = pat ? `url(#${ID}-pat)` : 'none';
  if (size === 'mega') {
    // Krabice od bot: víko + krabice + štítek.
    const body =
      `<rect x="14" y="118" width="222" height="226" rx="6" fill="${p.bg}" stroke="${INK}" stroke-width="3"/>` +
      `<rect x="14" y="118" width="222" height="226" rx="6" fill="${fill}" opacity="0.2"/>` +
      `<rect x="4" y="70" width="242" height="62" rx="8" fill="${p.bg}" stroke="${INK}" stroke-width="3"/>` +
      `<rect x="4" y="70" width="242" height="62" rx="8" fill="#000" opacity="0.18"/>` +
      `<path d="M4 120H246" stroke="${INK}" stroke-width="2" opacity="0.4"/>` +
      `<rect x="62" y="170" width="126" height="126" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>` +
      iconMarkup(spec.icon, { x: 70, y: 178, size: 110, color: p.bg }) +
      `<path d="M30 96h40M180 96h40" stroke="${p.fg}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`;
    return [pat ?? '', body];
  }
  const envelope = (dx: number, dy: number, back: boolean): string =>
    `<g transform="translate(${dx} ${dy})"${back ? ' opacity="0.75"' : ''}>` +
    `<rect x="4" y="38" width="234" height="300" rx="12" fill="${p.bg}" stroke="${INK}" stroke-width="3"/>` +
    (back
      ? ''
      : `<rect x="4" y="38" width="234" height="300" rx="12" fill="${fill}" opacity="0.2"/>` +
        `<path d="M8 330L121 210L234 330" fill="none" stroke="${INK}" stroke-width="2" opacity="0.35"/>` +
        `<path d="M4 50a12 12 0 0 1 12-12h210a12 12 0 0 1 12 12L121 172z" fill="${p.bg}" stroke="${INK}" stroke-width="3"/>` +
        `<path d="M4 50a12 12 0 0 1 12-12h210a12 12 0 0 1 12 12L121 172z" fill="#000" opacity="0.15"/>` +
        `<circle cx="121" cy="168" r="17" fill="#b91c1c" stroke="${INK}" stroke-width="2"/>` +
        `<circle cx="121" cy="168" r="10" fill="none" stroke="#fca5a5" stroke-width="2"/>` +
        iconMarkup(spec.icon, { x: 71, y: 196, size: 100, color: p.fg })) +
    `</g>`;
  const body = size === 'jumbo' ? envelope(10, -10, true) + envelope(0, 4, false) : envelope(4, 0, false);
  return [pat ?? '', body];
}

/** Hrací žeton (šéf, útrata): okraj v barvě žetonu se zářezy, uprostřed obrázek. */
function chipArt(spec: ArtSpec, color: string): [string, string] {
  const c = safeColor(color, '#c8372d');
  let notches = '';
  for (let i = 0; i < 8; i++) {
    notches += `<rect x="55" y="4" width="10" height="16" rx="2" fill="${PAPER}" opacity="0.92" transform="rotate(${i * 45} 60 60)"/>`;
  }
  const [defs, win] = artWindow(
    spec,
    { kind: 'circle', cx: 60, cy: 60, r: 38 },
    {
      iconSize: 50,
      patternScale: 0.6,
      prop: false,
    },
  );
  const body =
    `<circle cx="60" cy="60" r="56" fill="${c}" stroke="${INK}" stroke-width="2.5"/>` +
    notches +
    `<circle cx="60" cy="60" r="44" fill="none" stroke="${PAPER}" stroke-width="2" stroke-dasharray="4 4" opacity="0.8"/>` +
    win +
    `<circle cx="60" cy="60" r="38" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return [defs, body];
}

/** Štítek: kulatý odznak na provázku. */
function tagArt(spec: ArtSpec): [string, string] {
  const [defs, win] = artWindow(
    spec,
    { kind: 'circle', cx: 60, cy: 64, r: 38 },
    {
      iconSize: 48,
      patternScale: 0.6,
    },
  );
  const body =
    `<path d="M60 14C52 6 44 2 36 2" fill="none" stroke="#b08a4a" stroke-width="2.5"/>` +
    `<circle cx="60" cy="64" r="52" fill="#e3c76a" stroke="${INK}" stroke-width="2.5"/>` +
    `<circle cx="60" cy="64" r="46" fill="none" stroke="#8a6410" stroke-width="2" stroke-dasharray="3 4"/>` +
    win +
    `<circle cx="60" cy="64" r="38" fill="none" stroke="#8a6410" stroke-width="2"/>` +
    `<circle cx="60" cy="17" r="4" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`;
  return [defs, body];
}

/** Síla piva: pivní tácek se zoubkovaným okrajem. */
function stakeArt(spec: ArtSpec): [string, string] {
  const p = palette(spec);
  let d = '';
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * 2 * i) / n;
    const rr = i % 2 === 0 ? 57 : 53;
    d += `${i === 0 ? 'M' : 'L'}${r1(60 + Math.cos(a) * rr)} ${r1(60 + Math.sin(a) * rr)}`;
  }
  const [defs, win] = artWindow(
    spec,
    { kind: 'circle', cx: 60, cy: 60, r: 40 },
    {
      iconSize: 52,
      patternScale: 0.6,
    },
  );
  const body =
    `<path d="${d}z" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>` +
    `<circle cx="60" cy="60" r="47" fill="none" stroke="${p.bg}" stroke-width="4"/>` +
    win +
    `<circle cx="60" cy="60" r="40" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.6"/>`;
  return [defs, body];
}

/** Výzva: karta s šachovnicovým (cílovým) rámem. */
function challengeArt(spec: ArtSpec): [string, string] {
  const [defs, win] = artWindow(
    spec,
    { kind: 'rect', x: 22, y: 22, w: 206, h: 306, rx: 6 },
    { iconSize: 150 },
  );
  const checker = `<pattern id="${ID}-chk" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="${PAPER}"/><rect width="10" height="10" fill="${INK}"/><rect x="10" y="10" width="10" height="10" fill="${INK}"/></pattern>`;
  const body =
    `<rect x="2" y="2" width="246" height="346" rx="16" fill="url(#${ID}-chk)" stroke="${INK}" stroke-width="3"/>` +
    win +
    `<rect x="22" y="22" width="206" height="306" rx="6" fill="none" stroke="${INK}" stroke-width="3"/>`;
  return [defs + checker, body];
}

/** Vylepšení / pečeť: zaoblená dlaždice s ikonou (sbírka, tooltipy). */
function tileArt(spec: ArtSpec, round: boolean): [string, string] {
  const shape: Shape = round
    ? { kind: 'circle', cx: 60, cy: 60, r: 52 }
    : { kind: 'rect', x: 8, y: 8, w: 104, h: 104, rx: 18 };
  const [defs, win] = artWindow(spec, shape, { iconSize: 66, patternScale: 0.6, prop: false });
  return [defs, win + shapeMarkup(shape, `fill="none" stroke="${INK}" stroke-width="3"`)];
}

// ─────────────────────────── Veřejné API ───────────────────────────

/** SVG markup obrázku obsahu (unikátní id ve `<defs>`). */
export function artMarkup(kind: ArtKind, spec: ArtSpec, opts: ArtOptions = {}): string {
  if (kind === 'deck') {
    // Balíček = rub karty v barvách balíčku.
    return cardBackMarkup(spec).replace('class="pc-svg pc-back"', 'class="art-svg art-deck"');
  }
  let parts: [string, string];
  switch (kind) {
    case 'joker':
      parts = jokerArt(spec, opts.rarity ?? 'common');
      break;
    case 'consumable':
      parts = consumableArt(spec, opts.consumableKind ?? 'pranostika');
      break;
    case 'voucher':
      parts = voucherArt(spec, opts.tier ?? 1);
      break;
    case 'booster':
      parts = boosterArt(spec, opts.boosterSize ?? 'normal');
      break;
    case 'boss':
    case 'blind':
      parts = chipArt(spec, opts.color ?? BLIND_ART.boss.color);
      break;
    case 'tag':
      parts = tagArt(spec);
      break;
    case 'stake':
      parts = stakeArt(spec);
      break;
    case 'challenge':
      parts = challengeArt(spec);
      break;
    case 'seal':
      parts = tileArt(spec, true);
      break;
    case 'enhancement':
    default:
      parts = tileArt(spec, false);
      break;
  }
  const [defs, body] = parts;
  const data = [
    `data-kind="${kind}"`,
    opts.rarity ? `data-rarity="${escapeXml(opts.rarity)}"` : '',
    opts.consumableKind ? `data-consumable="${escapeXml(opts.consumableKind)}"` : '',
    `data-icon-name="${escapeXml(spec.icon)}"`,
  ]
    .filter(Boolean)
    .join(' ');
  return withUniqueIds(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX[kind]}" class="art-svg art-${kind}" ${data} focusable="false">` +
      (defs ? `<defs>${defs}</defs>` : '') +
      body +
      `</svg>`,
  );
}

/** SVG element obrázku obsahu (s `label` přístupný jako `role="img"`). */
export function artElement(kind: ArtKind, spec: ArtSpec, opts: ArtOptions = {}): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = artMarkup(kind, spec, opts);
  return labelSvg(tpl.content.firstElementChild as SVGSVGElement, opts.label);
}

/** Záložní obrázek pro neznámé id (obsah se mohl mezi verzemi změnit). */
export const UNKNOWN_ART: ArtSpec = { icon: 'question', bg: '#3a3a3a', fg: '#f4ecd8', pattern: 'none' };

export type ContentArtKind = Exclude<ArtKind, 'blind'>;

/**
 * Obrázek obsahu podle id z registru (žolík, spotřebka, kupón, štítek, obálka, šéf, balíček, síla piva, výzva,
 * vylepšení, pečeť) — rámeček, vzácnost, typ i barvu žetonu vybere podle definice. Neznámé id → otazník.
 */
export function contentArt(
  kind: ContentArtKind,
  id: string,
  opts: { label?: string; registry?: ContentRegistry } = {},
): SVGSVGElement {
  const reg = opts.registry ?? defaultRegistry();
  const o: ArtOptions = { label: opts.label };
  let spec: ArtSpec | undefined;
  switch (kind) {
    case 'joker': {
      const def = reg.jokers[id];
      spec = def?.art;
      o.rarity = def?.rarity;
      break;
    }
    case 'consumable': {
      const def = reg.consumables[id];
      spec = def?.art;
      o.consumableKind = def?.kind;
      break;
    }
    case 'voucher': {
      const def = reg.vouchers[id];
      spec = def?.art;
      o.tier = def?.tier;
      break;
    }
    case 'booster': {
      const def = reg.boosters[id];
      spec = def?.art;
      o.boosterSize = def?.size;
      break;
    }
    case 'boss': {
      const def = reg.bosses[id];
      spec = def?.art;
      o.color = def?.color;
      break;
    }
    case 'tag':
      spec = reg.tags[id]?.art;
      break;
    case 'deck':
      spec = reg.decks[id]?.art;
      break;
    case 'stake':
      spec = reg.stakes[id]?.art;
      break;
    case 'challenge':
      spec = reg.challenges[id]?.art;
      break;
    case 'enhancement':
      spec = reg.enhancements[id]?.art;
      break;
    case 'seal':
      spec = reg.seals[id]?.art;
      break;
  }
  return artElement(kind, spec ?? UNKNOWN_ART, o);
}

/**
 * Žeton útraty: Malá a Velká mají vlastní obrázek (malé a velké pivo), šéf obrázek a barvu z `BossDef`
 * (u Velké útraty s pravidlem šéfa — Imperial — se ukáže šéf).
 */
export function blindArt(
  kind: BlindKind,
  bossId: string | null,
  opts: { label?: string; registry?: ContentRegistry } = {},
): SVGSVGElement {
  const reg = opts.registry ?? defaultRegistry();
  const boss = bossId ? reg.bosses[bossId] : undefined;
  if (boss) return artElement('boss', boss.art, { color: boss.color, label: opts.label });
  const base = BLIND_ART[kind];
  return artElement('blind', base.spec, { color: base.color, label: opts.label });
}
