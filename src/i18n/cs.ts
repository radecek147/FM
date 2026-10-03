/**
 * Všechny texty hry v češtině — vstupní bod i18n.
 *
 * Pravidla (viz docs/CONTENT-GUIDE.md, kap. 12):
 *  - hráči tykáme (rodově neutrálně), české uvozovky „…“, trojtečka …, krátká pomlčka –,
 *    desetinná čárka, `×` pro násobení,
 *  - čísla do textu nikdy natvrdo neformátuj — použij `{param}` (formátuje `format.ts`)
 *    a u proměnného čísla se slovem `{n|plural:karta,karty,karet}`,
 *  - nezlomitelné mezery za jednopísmennými předložkami, mezi číslem a slovem a před pomlčkou
 *    doplní `t()` automaticky (`typo()`), ale nevadí, když je v textu napíšeš rovnou.
 *
 * Struktura: vnořený objekt; klíč = tečková cesta (`t('menu.newGame.label')`).
 *
 * Podmoduly: velké oblasti (žolíci, šéfové, spotřebky…) žijí v `src/i18n/cs/<oblast>.ts`
 * a skládají se sem. Další fáze je přidávají takto:
 *
 *   import { jokers } from './cs/jokers';
 *   import { bosses } from './cs/bosses';
 *   …
 *   export const cs = { app, menu, …, jokers, bosses } satisfies TextTree;
 *
 * Konvence klíčů pro obsah viz komentář v `src/engine/content-types.ts`
 * (`jokers.<id>.name|desc|flavor`, `bosses.<id>.name|rule|intro|defeat|death` …).
 */
import { art } from './cs/art';
import { achievements } from './cs/achievements';
import { boosters } from './cs/boosters';
import { bosses } from './cs/bosses';
import { challenges } from './cs/challenges';
import { meta } from './cs/meta';
import { cli } from './cs/cli';
import { consumables } from './cs/consumables';
import { decks } from './cs/decks';
import { game } from './cs/game';
import { hands } from './cs/hands';
import { jokers } from './cs/jokers';
import { boss, joker, score, tag } from './cs/messages';
import { editions, enhancements, seals } from './cs/modifiers';
import { stakes } from './cs/stakes';
import { tags } from './cs/tags';
import { vouchers } from './cs/vouchers';
import { common, credits, menu, newGame, settings } from './cs/ui';
import { interpolate, typo, type InterpolationParams } from './format';

/** Strom textů: listy jsou řetězce nebo seznamy řetězců. */
export type TextTree = { readonly [key: string]: TextNode };
export type TextNode = string | readonly string[] | TextTree;

// ─────────────────────────── Aplikace ───────────────────────────

const app = {
  title: 'Karban',
  subtitle: 'Hospodský roguelike se žolíky',
  tagline: 'Hraje se o čárky na tácku. A o čest. Hlavně o čárky.',
  documentTitle: 'Karban – hospodský roguelike se žolíky',
  /** Texty pro statické `index.html` (dosadí je Vite při buildu, viz vite.config.ts). */
  metaDescription: 'Karban – hospodský roguelike se žolíky. Česká karetní hra v prohlížeči.',
  noscript: 'Karban potřebuje zapnutý JavaScript. Bez něj se karty nerozdají.',
  loading: 'Míchám karty…',
  tipLabel: 'Štamgast radí',
  version: 'verze {version}',
  footerNote: 'Při výrobě nebyl zraněn žádný žolík.',
  /** Service worker stáhl novou verzi (převezme ji při příštím spuštění, src/ui/serviceWorker.ts). */
  updateReady: 'Dorazila nová verze Karbanu. Naskočí při příštím spuštění, rozehranou hru ti nikdo nebere.',
};

// Hlavní menu, nová hra, nastavení, titulky a společné popisky UI žijí v ./cs/ui.ts.

// ─────────────────────────── Karty ───────────────────────────

/** Barvy podle `Suit` z engine/types.ts. V běžném textu malými písmeny. */
const suits = {
  S: { name: 'piky', one: 'pik', adj: 'piková', symbol: '♠' },
  H: { name: 'srdce', one: 'srdce', adj: 'srdcová', symbol: '♥' },
  D: { name: 'káry', one: 'kára', adj: 'kárová', symbol: '♦' },
  C: { name: 'kříže', one: 'kříž', adj: 'křížová', symbol: '♣' },
};

/** Hodnoty podle `Rank` (2–14) z engine/types.ts; `short` = rohový index karty. */
const ranks = {
  2: { name: 'Dvojka', short: '2' },
  3: { name: 'Trojka', short: '3' },
  4: { name: 'Čtyřka', short: '4' },
  5: { name: 'Pětka', short: '5' },
  6: { name: 'Šestka', short: '6' },
  7: { name: 'Sedmička', short: '7' },
  8: { name: 'Osmička', short: '8' },
  9: { name: 'Devítka', short: '9' },
  10: { name: 'Desítka', short: '10' },
  11: { name: 'Kluk', short: 'J' },
  12: { name: 'Dáma', short: 'Q' },
  13: { name: 'Král', short: 'K' },
  14: { name: 'Eso', short: 'A' },
};

// ─────────────────────────── Chyby ───────────────────────────

/** Klíče = `ActionErrorCode` z engine/types.ts (UI volá `t('errors.<code>')`) + `generic`. */
const errors = {
  wrongPhase: 'Teď ne. Všechno má svůj čas – i tohle.',
  invalidSelection: 'Takhle karty vybrat nejde. Zkus to znovu a pořádně.',
  noHandsLeft: 'Došly ti ruce. Zbývá jen modlitba a pivo.',
  noDiscardsLeft: 'Zahazovat už nemůžeš. Popelnice je plná a popeláři jezdí až ve čtvrtek.',
  notEnoughMoney: 'Na to nemáš. A na sekeru ti to tady nenapíšou.',
  slotsFull: 'Plno. Víc se tam nevejde, ani kdyby na to dupal celý lokál.',
  soldOut: 'Vyprodáno. Poslední kus si odnesla paní z vedlejšího vchodu.',
  invalidTarget: 'Na tohle to nezabere – jako házet hrách na zeď. Vyber jiný cíl.',
  cannotSell: 'Tohle neprodáš. Je to přibité jako obraz jelena u babičky.',
  cannotUse: 'Teď to použít nejde. Přečti si příbalový leták.',
  unknownItem: 'Tohle tu nevedeme. Zkus to ve Večerce naproti.',
  cannotSkip: 'Tohle se přeskočit nedá. Šéf na tebe čeká a bez pozdravu tě nepustí.',
  generic: 'Něco se pokazilo. Jako u Vaňků o Vánocích.',
  /** Chunk obrazovky se nenačetl (bez sítě a bez service workeru, nebo po novém nasazení). */
  screenLoad:
    'Tahle obrazovka nedorazila. Asi zůstala stát na zastávce na znamení. Zkontroluj připojení a zkus to znovu.',
};

// ─────────────────────────── Tipy na načítací obrazovce ───────────────────────────

const loadingTips = [
  'Žolíci se vyhodnocují zleva doprava. Jako fronta na úřadě, jen rychleji.',
  'Pořadí žolíků změníš přetažením. Násobiče patří na konec, ať mají co násobit.',
  'Ušetřené koruny nesou úrok. Banka by ti dala míň a ještě by chtěla poplatek.',
  'Nevyužité ruce se na konci kola proplácejí. Lenost se tu konečně vyplácí.',
  'Šéf má vždycky jedno zvláštní pravidlo. Přečti si ho dřív, než ti zkazí večer.',
  'Malou a Velkou útratu můžeš přeskočit za štítek. Šéfa ne – ten si tě najde sám.',
  'Pranostiky zvyšují úroveň kombinací. Babička to věděla odjakživa.',
  'Eso umí být nízké i vysoké. Jako nálada strejdy po třetím pivu.',
  'Postupka kolem dokola neplatí. Tedy pokud ve slotu nemáš Kolotoč na pouti.',
  'Prodaný žolík vrátí polovinu ceny. Zbytek si Večerka nechá na inventuru.',
  'Čipy se sčítají, mult násobí. Matematika ze základky konečně k něčemu je.',
  'Karty mimo kombinaci se nepočítají. Ať se snaží sebevíc.',
  'Každé další přehození nabídky stojí víc. Prodavačka už protáčí oči.',
  'Seed si můžeš zkopírovat a poslat kamarádovi. Ať tu prohru vidí na vlastní oči.',
  'Denní run je pro všechny stejný. Konečně férová soutěž – aspoň do první chyby.',
  'Když nevíš, co zahrát, zahraj Dvojici. Nikdo se ti nebude smát. Nahlas.',
  'Peníze v kapse rostou úrokem, peníze ve Večerce rostou v žolíky. Vyber si.',
  'Zahazování je zadarmo. Teda do chvíle, kdy ti zahození dojdou.',
  'Obrovská čísla se píšou vědecky. Kdyby se někdo ptal: 1,23e16 je fakt hodně.',
  'Než zahraješ Barvu, koukni do balíčku, kolik ti tam zbývá srdcí.',
  'Šéf na osmém patře je zlý. Horší je jen vedoucí na sedmém.',
  'Kdo karbaní, ten ví, že štěstí je jen špatně spočítaná pravděpodobnost.',
];

// ─────────────────────────── Složení ───────────────────────────

export const cs = {
  app,
  common,
  menu,
  newGame,
  settings,
  credits,
  /** Herní obrazovka: levý panel, ruka, výběr útraty, Večerka, obálka, pitva, výhra (src/ui/screens/game). */
  game,
  suits,
  ranks,
  hands,
  errors,
  loadingTips,
  enhancements,
  seals,
  editions,
  score,
  boss,
  joker,
  tag,
  decks,
  stakes,
  jokers,
  consumables,
  vouchers,
  boosters,
  bosses,
  tags,
  challenges,
  achievements,
  meta,
  /** Grafika, názvy karet, vzácnosti, tooltipy a galerie (src/ui/art, src/ui/describe.ts). */
  art,
  /** Texty skriptu `npm run simulate` (výstup simulace a textový režim `--play`). */
  cli,
  /** Pangram s celou českou diakritikou — kontrola fontu (e2e test). */
  typoTest: 'Příliš žluťoučký kůň úpěl ďábelské ódy',
} satisfies TextTree;

export type CsTexts = typeof cs;
export type I18nParams = InterpolationParams;

// ─────────────────────────── Lookup ───────────────────────────

function isList(node: TextNode): node is readonly string[] {
  return Array.isArray(node);
}

function isTree(node: TextNode): node is TextTree {
  return typeof node === 'object' && !Array.isArray(node);
}

/** Najde uzel podle tečkové cesty (`'menu.newGame.label'`), nebo `undefined`. */
function lookup(key: string): TextNode | undefined {
  let node: TextNode = cs;
  for (const part of key.split('.')) {
    if (!isTree(node) || !Object.hasOwn(node, part)) return undefined;
    const child: TextNode | undefined = node[part];
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

const IS_TEST: boolean =
  (typeof process !== 'undefined' && process.env?.['VITEST'] !== undefined) ||
  import.meta.env?.MODE === 'test';

const warnedKeys = new Set<string>();

function warnMissing(key: string, what: string): void {
  if (IS_TEST || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(`[i18n] ${what}: ${key}`);
}

/** Zástupný text pro chybějící klíč — v UI je hned vidět, co chybí. */
export function missingText(key: string): string {
  return `⟦${key}⟧`;
}

/**
 * Přeloží klíč na text. Parametry dosadí `interpolate()` (čísla formátuje česky, umí `|plural:…`)
 * a výsledek projde `typo()` (NBSP za jednopísmennými předložkami, české uvozovky…).
 * Chybějící klíč (nebo klíč, který nevede na řetězec) vrátí `⟦key⟧`.
 *
 * @example t('menu.comingSoon', { phase: 3 }) // 'Už brzy – ve fázi 3' (NBSP před pomlčkou)
 */
export function t(key: string, params?: I18nParams): string {
  const node = lookup(key);
  if (typeof node !== 'string') {
    warnMissing(key, node === undefined ? 'chybí klíč' : 'klíč nevede na text');
    return missingText(key);
  }
  return typo(interpolate(node, params));
}

/** Existuje klíč a vede na text nebo seznam textů? */
export function hasKey(key: string): boolean {
  const node = lookup(key);
  return node !== undefined && (typeof node === 'string' || isList(node));
}

/** Seznam textů (např. `loadingTips`). Chybějící klíč vrátí prázdné pole. */
export function tList(key: string, params?: I18nParams): string[] {
  const node = lookup(key);
  if (node === undefined || !isList(node)) {
    warnMissing(key, node === undefined ? 'chybí klíč' : 'klíč nevede na seznam');
    return [];
  }
  return node.map((s) => typo(interpolate(s, params)));
}
