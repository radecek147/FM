/**
 * npm run fetch-assets — připraví volně licencované assety do src/assets a přegeneruje ASSETS.md.
 *
 * Kroky:
 *  1. Fonty Pixelify Sans (OFL 1.1) z npm balíčku @fontsource/pixelify-sans → src/assets/fonts
 *     (woff2, váhy 400 a 700, subsety latin + latin-ext = české znaky) + fonts.css + OFL.txt.
 *  2. Kurátorovaný výběr ikon (pole ICONS) z npm balíčku @iconify-json/game-icons (CC BY 3.0)
 *     → src/assets/icons/<name>.svg + src/assets/icons/index.ts (path data jako řetězce, bez sítě).
 *  3. Best effort: dohledá autora každé ikony v repozitáři game-icons na GitHubu
 *     (cache src/assets/icons/authors.json — znovu se ptá jen na chybějící).
 *  4. Best effort: zkusí volitelné CC0 zdroje (Kenney). Když nejsou dostupné (v sandboxu proxy 403),
 *     jen to poznamená — hra je stejně kreslí procedurálně (src/ui/art).
 *  5. Vygeneruje ASSETS.md a výstupy zformátuje Prettierem (pokud je nainstalovaný).
 *
 * Build nikdy nezávisí na síti: vše potřebné se commituje do src/assets. Síťové kroky nikdy neshodí
 * běh (jen varování). Výstup je deterministický (žádná časová razítka), takže opakovaný běh nedělá diff.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────── Cesty a konstanty ───────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_PKG_DIR = path.join(ROOT, 'node_modules/@fontsource/pixelify-sans');
const ICON_PKG_DIR = path.join(ROOT, 'node_modules/@iconify-json/game-icons');
const FONTS_OUT = path.join(ROOT, 'src/assets/fonts');
const ICONS_OUT = path.join(ROOT, 'src/assets/icons');
const AUTHORS_CACHE = path.join(ICONS_OUT, 'authors.json');
const ASSETS_MD = path.join(ROOT, 'ASSETS.md');
/** Volitelné stažené zdroje — mimo git (node_modules je ignorovaný), build je nepoužívá. */
const OPTIONAL_CACHE = path.join(ROOT, 'node_modules/.cache/karban-assets');
const PRETTIER_BIN = path.join(ROOT, 'node_modules/prettier/bin/prettier.cjs');

const NET_TIMEOUT_MS = 8000;
const NET_CONCURRENCY = 12;

const FONT_FAMILY = 'Pixelify Sans';
const FONT_DESIGNER = 'Stefie Justprince';
const FONT_WEIGHTS = [400, 700] as const;
const FONT_SUBSETS = ['latin-ext', 'latin'] as const;

const ICON_SOURCE_URL = 'https://game-icons.net';
const ICON_LICENSE_URL = 'https://creativecommons.org/licenses/by/3.0/';
const ICON_ATTRIBUTION = 'game-icons.net authors (Lorc, Delapouite a další), CC BY 3.0';
const GAME_ICONS_RAW = 'https://raw.githubusercontent.com/game-icons/icons/master';

/**
 * Kurátorovaný výběr ikon pro žolíky, šéfy, spotřebky, kupóny, štítky a UI.
 * Jména = klíče v @iconify-json/game-icons (aliasy se dohledají). Neexistující jméno = varování + přeskočení.
 */
// prettier-ignore
const ICONS: readonly string[] = [
  // Hospoda a pití
  'beer-stein', 'beer-bottle', 'beer-horn', 'tavern-sign', 'barrel', 'tap', 'wine-bottle', 'wine-glass',
  'glass-shot', 'broken-bottle', 'cigar', 'smoking-pipe',
  // Jídlo
  'bread', 'cheese-wedge', 'sausage', 'hot-dog', 'ham-shank', 'roast-chicken', 'pretzel', 'dumpling',
  'cake-slice', 'gingerbread-man', 'full-pizza', 'shiny-apple', 'cherry', 'garlic', 'potato', 'cabbage',
  'wheat', 'mushroom', 'honey-jar', 'fried-eggs',
  // Peníze, obchod, úřady, čas
  'coins', 'coins-pile', 'crown-coin', 'money-stack', 'banknote', 'wallet', 'piggy-bank', 'take-my-money',
  'receive-money', 'bank', 'scales', 'stamper', 'post-stamp', 'contract', 'papers', 'scroll-unfurled',
  'open-book', 'newspaper', 'gavel', 'ticket', 'calendar', 'hourglass', 'alarm-clock', 'shopping-cart', 'shop',
  // Doprava
  'steam-locomotive', 'subway-train', 'bus', 'city-car', 'farm-tractor', 'dutch-bike', 'canoe', 'anchor',
  'airplane', 'rocket', 'flat-tire', 'traffic-cone',
  // Dům, panelák, chata, kutilství, zahrada
  'house', 'wood-cabin', 'castle', 'church', 'factory', 'window', 'bathtub', 'light-bulb', 'drill',
  'screwdriver', 'claw-hammer', 'monkey-wrench', 'toolbox', 'ladder', 'brick-wall', 'wheelbarrow',
  'watering-can', 'flower-pot', 'scythe', 'windmill',
  // Příroda a počasí
  'pine-tree', 'linden-leaf', 'clover', 'sunflower', 'sun', 'moon', 'fluffy-cloud', 'raining', 'lightning-storm',
  'snowflake-1', 'snowman', 'tornado', 'umbrella', 'fire', 'mountains',
  // Zvířata
  'pig', 'cow', 'rooster', 'chicken', 'cat', 'sitting-dog', 'tropical-fish', 'goat', 'sheep', 'duck', 'rabbit',
  'fox-head', 'owl', 'frog', 'bee',
  // Karty, hazard, zábava, odznaky
  'hearts', 'clubs', 'diamonds', 'spades', 'card-joker', 'card-random', 'card-draw', 'card-discard',
  'poker-hand', 'rolling-dices', 'coinflip', 'jester-hat', 'clown', 'drama-masks', 'top-hat', 'magic-hat',
  'crown', 'imperial-crown', 'king', 'trophy', 'present', 'firework-rocket',
  // Postavy, strašidla, profese
  'death-skull', 'crowned-skull', 'ghost', 'golem-head', 'robot-golem', 'witch-face', 'wizard-face',
  'devil-mask', 'angel-wings', 'dragon-head', 'vampire-dracula', 'farmer', 'chef-toque', 'miner', 'pirate-hat',
  'alien-stare',
  // Boj a výbuchy (Žižka, husité, Bílá hora…)
  'broadsword', 'crossed-swords', 'shield', 'battle-axe', 'warhammer', 'flail', 'eyepatch', 'old-wagon',
  'unlit-bomb', 'dynamite',
  // Tělo
  'eyeball', 'brain', 'hand', 'fist', 'thumb-up', 'thumb-down', 'footprint', 'tooth', 'mustache', 'beard',
  'spectacles', 'sunglasses',
  // Hudba, média, technika
  'guitar', 'drum', 'trumpet', 'accordion', 'megaphone', 'microphone', 'rotary-phone', 'smartphone', 'laptop',
  'tv',
  // UI a ovládání
  'cog', 'padlock', 'padlock-open', 'key', 'locked-chest', 'magnifying-glass', 'sparkles', 'upgrade',
  'anticlockwise-rotation', 'save', 'exit-door', 'speaker', 'speaker-off', 'musical-notes', 'pause-button',
  'play-button', 'help', 'cancel', 'stars-stack', 'round-star', 'ringing-bell', 'lantern', 'candle-light',
  // Vylepšení, pečetě a ukázky z docs/CONTENT-GUIDE.md (src/content/modifiers.ts je používá)
  'two-coins', 'glass-celebration', 'anvil', 'stone-block', 'gold-bar', 'cycle', 'crystal-ball',
  'old-lantern', 'quill-ink', 'stopwatch',
];

/** Složky autorů v repozitáři game-icons/icons (pořadí = podle počtu ikon, ať je co nejméně dotazů). */
const ICON_AUTHOR_DIRS: readonly (readonly [dir: string, name: string])[] = [
  ['lorc', 'Lorc'],
  ['delapouite', 'Delapouite'],
  ['skoll', 'Skoll'],
  ['sbed', 'Sbed'],
  ['carl-olsen', 'Carl Olsen'],
  ['john-colburn', 'John Colburn'],
  ['cathelineau', 'Cathelineau'],
  ['faithtoken', 'Faithtoken'],
  ['heavenly-dog', 'HeavenlyDog'],
  ['felbrigg', 'Felbrigg'],
  ['lord-berandas', 'Lord Berandas'],
  ['viscious-speed', 'Viscious Speed'],
  ['willdabeast', 'Willdabeast'],
  ['john-redman', 'John Redman'],
  ['priorblue', 'PriorBlue'],
  ['irongamer', 'Irongamer'],
  ['lucasms', 'Lucas'],
  ['andymeneely', 'Andy Meneely'],
  ['kier-heyl', 'Kier Heyl'],
  ['aussiesim', 'Aussiesim'],
  ['sparker', 'Sparker'],
  ['zeromancer', 'Zeromancer'],
  ['rihlsul', 'Rihlsul'],
  ['quoting', 'Quoting'],
  ['guard13007', 'Guard13007'],
  ['darkzaitzev', 'DarkZaitzev'],
  ['spencerdub', 'SpencerDub'],
  ['generalace135', 'GeneralAce135'],
  ['zajkonur', 'Zajkonur'],
  ['catsu', 'Catsu'],
  ['starseeker', 'Starseeker'],
  ['pepijn-poolman', 'Pepijn Poolman'],
  ['pierre-leducq', 'Pierre Leducq'],
  ['caro-asercion', 'Caro Asercion'],
  ['seregacthtuf', 'SeregaCthtuf'],
];

interface OptionalSource {
  id: string;
  name: string;
  url: string;
  license: string;
  replacement: string;
}

/** Volitelné CC0 zdroje. Hra je nepotřebuje — slouží jen jako případná reference/náhrada. */
const OPTIONAL_SOURCES: readonly OptionalSource[] = [
  {
    id: 'kenney-playing-cards-pack',
    name: 'Kenney — Playing Cards Pack',
    url: 'https://kenney.nl/assets/playing-cards-pack',
    license: 'CC0 1.0',
    replacement: 'vlastní SVG hrací karty v `src/ui/art`',
  },
  {
    id: 'kenney-boardgame-pack',
    name: 'Kenney — Boardgame Pack',
    url: 'https://kenney.nl/assets/boardgame-pack',
    license: 'CC0 1.0',
    replacement: 'vlastní SVG žetony a kostky v `src/ui/art`',
  },
];

// ─────────────────────────── Pomocníci ───────────────────────────

const warnings: string[] = [];

function warn(message: string): void {
  warnings.push(message);
  console.warn(`VAROVÁNÍ: ${message}`);
}

function rel(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function readJsonOptional<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch {
    return null;
  }
}

/** Escapuje řetězec do TS literálu v jednoduchých uvozovkách. */
function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
}

/** Klíč objektu v TS — bez uvozovek, pokud je to platný identifikátor. */
function tsKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : tsString(key);
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|');
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

type FetchOutcome = { ok: true; status: number; body: ArrayBuffer | null } | { ok: false; reason: string };

async function tryFetch(url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, status: res.status, body: method === 'GET' ? await res.arrayBuffer() : null };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: e.cause?.code ?? e.cause?.message ?? e.message ?? 'síťová chyba' };
  }
}

function ensurePackage(dir: string, pkg: string): void {
  if (!existsSync(dir)) {
    throw new Error(`Chybí balíček ${pkg} (${rel(dir)}). Spusť nejdřív „npm ci“.`);
  }
}

// ─────────────────────────── 1. Fonty ───────────────────────────

interface FontReport {
  version: string;
  attribution: string;
  repoUrl: string;
  licenseType: string;
  files: string[];
  licenseFrom: 'package' | 'embedded';
}

function extractUnicodeRange(css: string, faceId: string): string | null {
  const start = css.indexOf(`/* ${faceId} */`);
  if (start < 0) return null;
  const end = css.indexOf('}', start);
  const block = css.slice(start, end < 0 ? undefined : end);
  const match = /unicode-range:\s*([^;]+);/.exec(block);
  return match?.[1]?.trim() ?? null;
}

async function prepareFonts(): Promise<FontReport> {
  ensurePackage(FONT_PKG_DIR, '@fontsource/pixelify-sans');
  const pkg = await readJson<{ version: string; license?: string }>(path.join(FONT_PKG_DIR, 'package.json'));
  const meta = await readJsonOptional<{ license?: { type?: string; attribution?: string } }>(
    path.join(FONT_PKG_DIR, 'metadata.json'),
  );
  const unicode =
    (await readJsonOptional<Record<string, string>>(path.join(FONT_PKG_DIR, 'unicode.json'))) ?? {};
  const attribution =
    meta?.license?.attribution ??
    `Copyright The ${FONT_FAMILY} Project Authors (https://github.com/eifetx/Pixelify-Sans)`;
  const repoUrl = /\((https?:[^)]+)\)/.exec(attribution)?.[1] ?? 'https://github.com/eifetx/Pixelify-Sans';
  const licenseType = meta?.license?.type ?? pkg.license ?? 'OFL-1.1';

  await mkdir(FONTS_OUT, { recursive: true });
  for (const old of await readdir(FONTS_OUT)) {
    if (/^pixelify-sans-.*\.woff2?$/.test(old)) await rm(path.join(FONTS_OUT, old));
  }

  const faces: string[] = [];
  const files: string[] = [];
  for (const weight of FONT_WEIGHTS) {
    const weightCssFile = path.join(FONT_PKG_DIR, `${weight}.css`);
    const weightCss = existsSync(weightCssFile) ? await readFile(weightCssFile, 'utf8') : '';
    for (const subset of FONT_SUBSETS) {
      const faceId = `pixelify-sans-${subset}-${weight}-normal`;
      const file = `${faceId}.woff2`;
      await copyFile(path.join(FONT_PKG_DIR, 'files', file), path.join(FONTS_OUT, file));
      files.push(file);
      const range = extractUnicodeRange(weightCss, faceId) ?? unicode[subset];
      if (!range) warn(`Font ${file}: nenalezen unicode-range, @font-face bude bez něj.`);
      faces.push(
        [
          `/* ${faceId} */`,
          '@font-face {',
          `  font-family: '${FONT_FAMILY}';`,
          '  font-style: normal;',
          '  font-display: swap;',
          `  font-weight: ${weight};`,
          `  src: url('./${file}') format('woff2');`,
          ...(range ? [`  unicode-range: ${range.split(/\s*,\s*/).join(', ')};`] : []),
          '}',
        ].join('\n'),
      );
    }
  }

  const header = [
    '/*',
    ' * Vygenerováno skriptem scripts/fetch-assets.ts (npm run fetch-assets) — NEUPRAVUJ RUČNĚ.',
    ` * ${FONT_FAMILY} — ${FONT_DESIGNER}; ${attribution}.`,
    ` * Licence: SIL Open Font License 1.1 (viz OFL.txt). Zdroj: npm @fontsource/pixelify-sans@${pkg.version}.`,
    ` * Subsety ${FONT_SUBSETS.join(' + ')} (české znaky), váhy ${FONT_WEIGHTS.join(' a ')}.`,
    ' */',
  ].join('\n');
  await writeFile(path.join(FONTS_OUT, 'fonts.css'), `${header}\n\n${faces.join('\n\n')}\n`);

  const licenseSrc = path.join(FONT_PKG_DIR, 'LICENSE');
  let licenseFrom: FontReport['licenseFrom'] = 'package';
  if (existsSync(licenseSrc)) {
    await copyFile(licenseSrc, path.join(FONTS_OUT, 'OFL.txt'));
  } else {
    licenseFrom = 'embedded';
    warn('Balíček fontu neobsahuje LICENSE — zapisuji vestavěný text OFL 1.1.');
    await writeFile(path.join(FONTS_OUT, 'OFL.txt'), oflText(attribution));
  }

  console.log(`Fonty: woff2 × ${files.length} → ${rel(FONTS_OUT)} (+ fonts.css, OFL.txt)`);
  return { version: pkg.version, attribution, repoUrl, licenseType, files, licenseFrom };
}

// ─────────────────────────── 2. Ikony ───────────────────────────

interface IconifyIcon {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

interface IconifyAlias extends Partial<IconifyIcon> {
  parent: string;
}

interface IconifyJson {
  prefix: string;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, IconifyAlias>;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  lastModified?: number;
}

interface IconifyInfo {
  name?: string;
  total?: number;
  author?: { name: string; url?: string };
  license?: { title: string; spdx?: string; url?: string };
}

interface ExtractedIcon {
  name: string;
  body: string;
  viewBox: string;
}

interface IconReport {
  version: string;
  setAuthor: string;
  setAuthorUrl: string;
  license: string;
  licenseUrl: string;
  icons: ExtractedIcon[];
  missing: string[];
  defaultViewBox: string;
}

function resolveIcon(set: IconifyJson, name: string): { icon: IconifyIcon; via?: string } | null {
  let current = name;
  for (let depth = 0; depth < 8; depth++) {
    const icon = set.icons[current];
    if (icon) return current === name ? { icon } : { icon, via: current };
    const alias = set.aliases?.[current];
    if (!alias) return null;
    if (alias.rotate || alias.hFlip || alias.vFlip) {
      warn(`Ikona „${name}“: alias s transformací (rotace/zrcadlení) není podporovaný — přeskočeno.`);
      return null;
    }
    current = alias.parent;
  }
  return null;
}

async function extractIcons(): Promise<IconReport> {
  ensurePackage(ICON_PKG_DIR, '@iconify-json/game-icons');
  const pkg = await readJson<{ version: string; license?: string }>(path.join(ICON_PKG_DIR, 'package.json'));
  const set = await readJson<IconifyJson>(path.join(ICON_PKG_DIR, 'icons.json'));
  const info = (await readJsonOptional<IconifyInfo>(path.join(ICON_PKG_DIR, 'info.json'))) ?? {};

  const defW = set.width ?? 512;
  const defH = set.height ?? 512;
  const defaultViewBox = `${set.left ?? 0} ${set.top ?? 0} ${defW} ${defH}`;

  const names = [...new Set(ICONS)].sort();
  if (names.length !== ICONS.length) warn(`Seznam ICONS obsahuje ${ICONS.length - names.length} duplicit.`);

  const icons: ExtractedIcon[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const found = resolveIcon(set, name);
    if (!found) {
      if (!set.aliases?.[name]) warn(`Ikona „${name}“ v @iconify-json/game-icons neexistuje — přeskočeno.`);
      missing.push(name);
      continue;
    }
    const { icon, via } = found;
    if (icon.rotate || icon.hFlip || icon.vFlip) {
      warn(`Ikona „${name}“ má transformaci (rotace/zrcadlení) — přeskočeno.`);
      missing.push(name);
      continue;
    }
    const viewBox = `${icon.left ?? set.left ?? 0} ${icon.top ?? set.top ?? 0} ${icon.width ?? defW} ${icon.height ?? defH}`;
    if (via) console.log(`Ikona „${name}“ je alias → „${via}“.`);
    icons.push({ name, body: icon.body.trim(), viewBox });
  }

  return {
    version: pkg.version,
    setAuthor: info.author?.name ?? 'GameIcons',
    setAuthorUrl: info.author?.url ?? 'https://github.com/game-icons/icons',
    license: info.license?.title ?? pkg.license ?? 'CC BY 3.0',
    licenseUrl: info.license?.url ?? 'https://github.com/game-icons/icons/blob/master/license.txt',
    icons,
    missing,
    defaultViewBox,
  };
}

// ─────────────────────────── 3. Autoři ikon (best effort) ───────────────────────────

const UNKNOWN_AUTHOR = 'game-icons.net authors';

/**
 * „Podpis“ ikony = počáteční bod (moveto) hlavní cesty. V repozitáři game-icons je první <path> černé
 * pozadí (M0 0h512v512H0z); Iconify ho vynechává a cestu optimalizuje (oblouky místo křivek…),
 * počáteční bod ale zůstává stejný.
 */
function pathSignature(svg: string): string | null {
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)]
    .map((m) => m[1] ?? '')
    .filter((d) => d !== 'M0 0h512v512H0z');
  const numbers = paths[0]?.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  return numbers && numbers.length >= 2 ? numbers.slice(0, 2).map(Number).join(',') : null;
}

/**
 * Autor každé ikony podle složky v repozitáři game-icons/icons. Stejné jméno může mít víc autorů
 * (např. „castle“ od Lorce i Delapouita), proto se obsah porovná s tělem ikony z Iconify.
 */
async function resolveIconAuthors(icons: readonly ExtractedIcon[]): Promise<Record<string, string>> {
  const cache = (await readJsonOptional<Record<string, string>>(AUTHORS_CACHE)) ?? {};
  const authors: Record<string, string> = {};
  let pending: ExtractedIcon[] = [];
  for (const icon of icons) {
    const cached = cache[icon.name];
    if (cached) authors[icon.name] = cached;
    else pending.push(icon);
  }

  if (pending.length > 0) {
    const ping = await tryFetch(`${GAME_ICONS_RAW}/license.txt`, 'HEAD');
    if (!ping.ok) {
      warn(
        `Repozitář game-icons nedostupný (${ping.reason}) — autor ${pending.length} ikon zůstane neurčený.`,
      );
    } else {
      console.log(`Autoři ikon: dohledávám ${pending.length} ikon v ${GAME_ICONS_RAW} …`);
      /** Jméno nalezené u autora, ale s jiným obsahem — použije se, jen když nic nesedí přesně. */
      const fallback = new Map<string, string>();
      let networkErrors = 0;
      for (const [dir, author] of ICON_AUTHOR_DIRS) {
        if (pending.length === 0 || networkErrors > 20) break;
        const verdicts = await mapLimit(pending, NET_CONCURRENCY, async (icon) => {
          const res = await tryFetch(`${GAME_ICONS_RAW}/${dir}/${icon.name}.svg`);
          if (!res.ok) {
            if (res.reason !== 'HTTP 404') networkErrors++;
            return 'missing' as const;
          }
          const remote = pathSignature(Buffer.from(res.body ?? new ArrayBuffer(0)).toString('utf8'));
          return remote !== null && remote === pathSignature(icon.body)
            ? ('match' as const)
            : ('other' as const);
        });
        pending = pending.filter((icon, i) => {
          if (verdicts[i] === 'match') {
            authors[icon.name] = author;
            return false;
          }
          if (verdicts[i] === 'other' && !fallback.has(icon.name)) fallback.set(icon.name, author);
          return true;
        });
      }
      if (networkErrors > 0) warn(`Při dohledávání autorů ikon selhalo ${networkErrors} požadavků.`);
      pending = pending.filter((icon) => {
        const author = fallback.get(icon.name);
        if (!author) return true;
        warn(`Ikona „${icon.name}“: obsah se neshoduje s repozitářem, autor ${author} je jen odhad.`);
        authors[icon.name] = author;
        return false;
      });
    }
  }

  if (pending.length > 0) {
    const list = pending.map((i) => i.name).join(', ');
    warn(`Autor neurčen u ${pending.length} ikon: ${list} (uvedeno souhrnně „${UNKNOWN_AUTHOR}“).`);
  }

  const known = Object.fromEntries(
    Object.entries(authors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as Record<string, string>;
  await mkdir(ICONS_OUT, { recursive: true });
  await writeFile(AUTHORS_CACHE, `${JSON.stringify(known, null, 2)}\n`);
  for (const icon of pending) authors[icon.name] = UNKNOWN_AUTHOR;
  return authors;
}

/** Unikátní autoři seřazení podle počtu ikon (sestupně), neurčený autor na konci. */
function creditList(authors: Record<string, string>): { author: string; icons: string[] }[] {
  const byAuthor = new Map<string, string[]>();
  for (const [name, author] of Object.entries(authors)) {
    byAuthor.set(author, [...(byAuthor.get(author) ?? []), name]);
  }
  return [...byAuthor.entries()]
    .map(([author, icons]) => ({ author, icons: icons.sort() }))
    .sort((a, b) => {
      if (a.author === UNKNOWN_AUTHOR) return 1;
      if (b.author === UNKNOWN_AUTHOR) return -1;
      return b.icons.length - a.icons.length || (a.author < b.author ? -1 : 1);
    });
}

async function writeIcons(report: IconReport, authors: Record<string, string>): Promise<void> {
  await mkdir(ICONS_OUT, { recursive: true });
  for (const old of await readdir(ICONS_OUT)) {
    if (old.endsWith('.svg')) await rm(path.join(ICONS_OUT, old));
  }

  for (const icon of report.icons) {
    const [, , w, h] = icon.viewBox.split(' ');
    const note = `<!-- ${icon.name} | ${ICON_SOURCE_URL} | ${authors[icon.name] ?? UNKNOWN_AUTHOR} | CC BY 3.0 -->`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${w}" height="${h}" ` +
      `fill="currentColor">${note}${icon.body}</svg>\n`;
    await writeFile(path.join(ICONS_OUT, `${icon.name}.svg`), svg);
  }

  const credits = creditList(authors).map((c) => c.author);
  const viewBoxExceptions = report.icons.filter((i) => i.viewBox !== report.defaultViewBox);
  const lines: string[] = [
    '// Vygenerováno skriptem scripts/fetch-assets.ts (npm run fetch-assets) — NEUPRAVUJ RUČNĚ.',
    `// Zdroj: ${ICON_SOURCE_URL} přes npm @iconify-json/game-icons@${report.version}, licence CC BY 3.0.`,
    '// Úprava: barva = currentColor; ikony se vkládají inline do procedurálních SVG (src/ui/art):',
    '//   <svg viewBox={iconViewBox(name)} fill="currentColor">{ICON_SVGS[name]}</svg>',
    '// Atribuce (povinná, CC BY 3.0) patří do Titulků — viz ASSETS.md.',
    '',
    `export const ICON_ATTRIBUTION = ${tsString(ICON_ATTRIBUTION)};`,
    `export const ICON_SOURCE_URL = ${tsString(ICON_SOURCE_URL)};`,
    `export const ICON_LICENSE_URL = ${tsString(ICON_LICENSE_URL)};`,
    '',
    '/** Autoři použitých ikon (podle počtu ikon) — pro Titulky. */',
    `export const ICON_CREDITS: readonly string[] = [${credits.map(tsString).join(', ')}];`,
    '',
    '/** Výchozí viewBox ikon (výjimky v ICON_VIEWBOXES). */',
    `export const ICON_VIEWBOX = ${tsString(report.defaultViewBox)};`,
    '',
    'export const ICON_NAMES = [',
    ...report.icons.map((i) => `  ${tsString(i.name)},`),
    '] as const;',
    '',
    'export type IconName = (typeof ICON_NAMES)[number];',
    '',
    '/** Obsah elementu <svg> (path data, fill="currentColor") pro každou ikonu. */',
    'export const ICON_SVGS: Record<string, string> = {',
    ...report.icons.map((i) => `  ${tsKey(i.name)}: ${tsString(i.body)},`),
    '};',
    '',
    '/** Autor každé ikony (game-icons.net). */',
    'export const ICON_AUTHORS: Record<string, string> = {',
    ...report.icons.map((i) => `  ${tsKey(i.name)}: ${tsString(authors[i.name] ?? UNKNOWN_AUTHOR)},`),
    '};',
    '',
    '/** Ikony s jiným viewBoxem než ICON_VIEWBOX. */',
    viewBoxExceptions.length === 0
      ? 'export const ICON_VIEWBOXES: Record<string, string> = {};'
      : [
          'export const ICON_VIEWBOXES: Record<string, string> = {',
          ...viewBoxExceptions.map((i) => `  ${tsKey(i.name)}: ${tsString(i.viewBox)},`),
          '};',
        ].join('\n'),
    '',
    'export function isIconName(name: string): name is IconName {',
    '  return Object.prototype.hasOwnProperty.call(ICON_SVGS, name);',
    '}',
    '',
    'export function iconViewBox(name: string): string {',
    '  return ICON_VIEWBOXES[name] ?? ICON_VIEWBOX;',
    '}',
    '',
  ];
  await writeFile(path.join(ICONS_OUT, 'index.ts'), lines.join('\n'));

  const bytes = report.icons.reduce((sum, i) => sum + i.body.length, 0);
  console.log(
    `Ikony: ${report.icons.length} → ${rel(ICONS_OUT)} (*.svg + index.ts, path data ${(bytes / 1024).toFixed(0)} kB)`,
  );
}

// ─────────────────────────── 4. Volitelné CC0 zdroje (best effort) ───────────────────────────

interface OptionalResult {
  source: OptionalSource;
  ok: boolean;
  detail: string;
}

async function tryOptionalSources(): Promise<OptionalResult[]> {
  const results: OptionalResult[] = [];
  for (const source of OPTIONAL_SOURCES) {
    const res = await tryFetch(source.url);
    if (res.ok && res.body) {
      await mkdir(OPTIONAL_CACHE, { recursive: true });
      const file = path.join(
        OPTIONAL_CACHE,
        `${source.id}${path.extname(new URL(source.url).pathname) || '.html'}`,
      );
      await writeFile(file, Buffer.from(res.body));
      console.log(`Volitelný zdroj ${source.name}: staženo do ${rel(file)} (build ho nepoužívá).`);
      results.push({
        source,
        ok: true,
        detail: `dostupné; staženo do \`${rel(OPTIONAL_CACHE)}\`, hra ho nepoužívá`,
      });
    } else {
      const reason = res.ok ? 'prázdná odpověď' : res.reason;
      warn(`Volitelný zdroj ${source.name} nedostupný (${reason}) — nahrazeno procedurálním SVG.`);
      results.push({ source, ok: false, detail: `nedostupné (${reason}), nahrazeno procedurálním SVG` });
    }
  }
  return results;
}

// ─────────────────────────── 5. ASSETS.md ───────────────────────────

function renderAssetsMd(
  font: FontReport,
  icons: IconReport,
  authors: Record<string, string>,
  optional: OptionalResult[],
): string {
  const credits = creditList(authors);
  const namedAuthors = credits.filter((c) => c.author !== UNKNOWN_AUTHOR).map((c) => c.author);
  const row = (cells: string[]): string => `| ${cells.map(mdEscape).join(' | ')} |`;
  const fontFiles = `\`src/assets/fonts/pixelify-sans-{${FONT_SUBSETS.join(',')}}-{${FONT_WEIGHTS.join(',')}}-normal.woff2\`, \`fonts.css\`, \`OFL.txt\``;

  const out: string[] = [
    '# Assety a licence — Karban',
    '',
    '> Vygenerováno skriptem `scripts/fetch-assets.ts` (`npm run fetch-assets`). Ruční úpravy se při dalším',
    '> běhu přepíšou — měň skript. Build nezávisí na síti: všechny použité soubory jsou v `src/assets/`.',
    '> Žádný asset nepochází z Balatra ani jiné komerční hry.',
    '',
    '## Přehled',
    '',
    row(['Soubor / skupina', 'Zdroj', 'Autor', 'Licence', 'Úprava']),
    row(['---', '---', '---', '---', '---']),
    row([
      `Písmo ${FONT_FAMILY}: ${fontFiles}`,
      `https://fonts.google.com/specimen/Pixelify+Sans přes npm \`@fontsource/pixelify-sans@${font.version}\` (${font.repoUrl})`,
      `${FONT_DESIGNER} — ${font.attribution}`,
      `SIL Open Font License 1.1 (\`${font.licenseType}\`), text v \`src/assets/fonts/OFL.txt\`${font.licenseFrom === 'embedded' ? ' (vestavěný text, balíček neobsahoval LICENSE)' : ''}`,
      `beze změny glyfů; vybrány subsety ${FONT_SUBSETS.join(' + ')} a váhy ${FONT_WEIGHTS.join(' a ')}, vlastní \`fonts.css\``,
    ]),
    row([
      'Písmo Karban Digits (číslice 0–9, C, c, Z a písmena s háčkem a kroužkem): `src/ui/art/digitFont.ts`',
      `odvozeno z písma ${FONT_FAMILY} výše; binárka TrueType se skládá za běhu (FontFace API), nic se nestahuje`,
      `${FONT_DESIGNER} — ${font.attribution}; úpravy autoři projektu Karban`,
      'SIL Open Font License 1.1 (`OFL-1.1`) — odvozené dílo, bez rezervovaného jména původního písma',
      'číslice přepsané do pixelové mřížky; „5“, „2“, „3“, „6“, „7“, „9“, „0“ a „Z“ překreslené kvůli čitelnosti (5 ≠ S, Z ≠ 2, 3 ≠ 8, 0 ≠ O); „C“ a „c“ s větším otvorem; Č č Ď Ě ě Ň ň Ř ř Š š Ť Ů ů Ž ž = původní základ + nový širší háček / kroužek',
    ]),
    row([
      `Ikony (${icons.icons.length}): \`src/assets/icons/*.svg\`, \`src/assets/icons/index.ts\``,
      `${ICON_SOURCE_URL} přes npm \`@iconify-json/game-icons@${icons.version}\` (${icons.setAuthorUrl})`,
      `${icons.setAuthor} — ${namedAuthors.length > 0 ? namedAuthors.join(', ') : 'Lorc, Delapouite a další'} (rozpis níže)`,
      `${icons.license} (${ICON_LICENSE_URL}), podmínky sady: ${icons.licenseUrl}`,
      'přebarvení na `currentColor`, kompozice do procedurálních obrázků karet (`src/ui/art`)',
    ]),
    row([
      'Hrací karty, obrázky žolíků, šéfů, spotřebek, kupónů, štítků, pozadí a UI grafika',
      'vlastní procedurální SVG, kód v `src/ui/art`',
      'autoři projektu Karban',
      'licence projektu',
      '— (ikony výše se do nich jen vkládají)',
    ]),
    row([
      'Zvukové efekty a hudba (`src/ui/audio`)',
      'syntetizováno za běhu ve Web Audio API: vlastní syntezátor ve stylu jsfxr (`sfx.ts`), procedurální chiptune (`music.ts`)',
      'autoři projektu Karban',
      'licence projektu',
      '— žádné nahrávky ani stažené soubory; melodie jsou vlastní (seedovaný generátor), žádná převzatá',
    ]),
    '',
    '## Nedostupné a nepoužité zdroje',
    '',
    ...(optional.some((r) => !r.ok)
      ? [
          'Vývojové prostředí (sandbox), ve kterém hra vzniká, blokuje kenney.nl, opengameart.org, game-icons.net, wikimedia, freesound',
          'a fonts.google.com. Písmo a ikony se proto berou z npm balíčků (stejné soubory, stejné licence) a vše',
          'ostatní je vlastní procedurální grafika nebo syntetizovaný zvuk.',
        ]
      : [
          'Písmo a ikony se berou z npm balíčků (stejné soubory, stejné licence); volitelné CC0 zdroje níže hra',
          'nepoužívá — vše ostatní je vlastní procedurální grafika nebo syntetizovaný zvuk.',
        ]),
    '',
    row(['Zdroj', 'URL', 'Licence', 'Stav']),
    row(['---', '---', '---', '---']),
    ...optional.map((r) =>
      row([
        r.source.name,
        r.source.url,
        r.source.license,
        r.ok ? r.detail : `${r.detail}: ${r.source.replacement}`,
      ]),
    ),
    '',
    '## Povinné atribuce pro Titulky',
    '',
    `- **Písmo „${FONT_FAMILY}“** — ${FONT_DESIGNER}, ${font.attribution}. Licence SIL Open Font License 1.1 (https://openfontlicense.org).`,
    `- **Ikony** — Icons made by ${namedAuthors.length > 0 ? namedAuthors.join(', ') : 'Lorc, Delapouite and others'} from ${ICON_SOURCE_URL}. Licence CC BY 3.0 (${ICON_LICENSE_URL}). Upraveno: přebarveno a zkombinováno do obrázků karet.`,
    '',
    'V kódu jsou tyto údaje dostupné jako `ICON_ATTRIBUTION` a `ICON_CREDITS` v `src/assets/icons/index.ts`.',
    '',
    '## Ikony podle autorů',
    '',
    `Autor každé ikony je dohledán podle složky v repozitáři https://github.com/game-icons/icons (cache \`${rel(AUTHORS_CACHE)}\`).`,
    `Metadata balíčku uvádí souhrnně „${icons.setAuthor}“ (${icons.setAuthorUrl}).`,
    '',
    ...credits.map(
      (c) => `- **${c.author}** (${c.icons.length}): ${c.icons.map((n) => `\`${n}\``).join(', ')}`,
    ),
    '',
  ];
  if (icons.missing.length > 0) {
    out.push(
      '## Nenalezené ikony',
      '',
      `Tato jména ze seznamu \`ICONS\` v sadě neexistují a byla přeskočena: ${icons.missing.map((n) => `\`${n}\``).join(', ')}.`,
      '',
    );
  }
  return out.join('\n');
}

// ─────────────────────────── Prettier ───────────────────────────

function formatWithPrettier(files: string[]): void {
  if (!existsSync(PRETTIER_BIN)) {
    warn('Prettier není nainstalovaný — vygenerované soubory nejsou zformátované.');
    return;
  }
  const res = spawnSync(process.execPath, [PRETTIER_BIN, '--write', '--log-level', 'warn', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) warn(`Prettier selhal: ${(res.stderr || res.stdout || '').trim()}`);
}

// ─────────────────────────── Hlavní běh ───────────────────────────

async function main(): Promise<void> {
  console.log('Karban — příprava assetů\n');
  const font = await prepareFonts();
  const icons = await extractIcons();
  const authors = await resolveIconAuthors(icons.icons);
  await writeIcons(icons, authors);
  const optional = await tryOptionalSources();
  await writeFile(ASSETS_MD, renderAssetsMd(font, icons, authors, optional));

  formatWithPrettier([
    rel(path.join(FONTS_OUT, 'fonts.css')),
    rel(path.join(ICONS_OUT, 'index.ts')),
    rel(AUTHORS_CACHE),
    rel(ASSETS_MD),
  ]);

  console.log(`\nHotovo: fonty ${font.files.length}, ikony ${icons.icons.length}, ASSETS.md.`);
  if (icons.missing.length > 0) console.log(`Nenalezené ikony: ${icons.missing.join(', ')}`);
  if (warnings.length > 0) console.log(`Varování: ${warnings.length} (viz výše).`);
}

// ─────────────────────────── Záložní text OFL 1.1 ───────────────────────────

/** Použije se jen tehdy, když balíček fontu neobsahuje soubor LICENSE. */
function oflText(copyright: string): string {
  return `${copyright}

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

${OFL_BODY}`;
}

const OFL_BODY = `-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`;

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
