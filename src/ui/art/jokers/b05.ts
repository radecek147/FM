/**
 * Obrázky žolíků — dávka 05 (docs/DECISIONS.md 2026-10-08 „Obrázky žolíků s detaily podle názvu“):
 *  - garbage_man — Popelář: portrét `fig-garbage_man` (FIGURES['garbage_man'])
 *  - jukebox — Hudební automat: scéna `jukebox` (SCENES['jukebox'])
 *  - tool_shed — Kůlna: scéna `kulna` (SCENES['kulna'])
 *  - replacement_bus — Náhradní autobus: scéna `nahradniBus` (SCENES['nahradniBus'])
 *  - pig_slaughter — Řezník z rohu: portrét `fig-pig_slaughter` (FIGURES['pig_slaughter'])
 *  - derby_fans — Červená a černá: portrét `fig-derby_fans` (FIGURES['derby_fans'])
 *  - pub_quiz — Hospodský kvíz: portrét `fig-pub_quiz` (FIGURES['pub_quiz'])
 *  - scrap_yard — Sběrna surovin: nová scéna `j-scrap_yard` (SCENES['j-scrap_yard'])
 *  - fair_photographer — Fotograf z pouti: portrét `fig-fair_photographer` (FIGURES['fair_photographer'])
 *
 * `FIGURES`: úpravy portrétů (klíč = id žolíka; sloučí se přes základní popis ve figures.ts, pole se nahrazují celá).
 * `SCENES`: nové nebo přepsané scény (klíč = název scény z `art.scene`; přepíše i portrét `fig-<id>`).
 * Kreslicí nástroje: src/ui/art/sceneKit.ts (tahy a cesty), src/ui/art/figureKit.ts (`figure` a díly postav).
 * Vlastní dílo (Karban, 2026).
 */
import type { FigureSpec } from '../figureKit';
import type { SceneOp } from '../sceneKit';
import { c, rect } from '../sceneKit';

// ─────────────────────────── Pomocné tvary ───────────────────────────

const SKIN = '#f2b48e';
const INK = '#2f3542';
const CREAM = '#f4ede0';
const RED = '#d7442c';
const YELLOW = '#f2c24a';
const NAVY = '#3b4f78';

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * Posune, zvětší a otočí (stupně, po směru hodinových ručiček) cestu zapsanou jen absolutními příkazy
 * M/L/C/Q/Z v místních souřadnicích kolem 0,0.
 */
function place(d: string, x: number, y: number, s = 1, deg = 0): string {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let out = '';
  let pend: number | null = null;
  for (const tok of d.match(/[MLCQZ]|-?\d*\.?\d+/g) ?? []) {
    if (/^[MLCQZ]$/.test(tok)) {
      out += tok;
      continue;
    }
    const v = Number(tok);
    if (pend === null) {
      pend = v;
      continue;
    }
    const px = pend * s;
    const py = v * s;
    out += `${r1(x + px * cos - py * sin)},${r1(y + px * sin + py * cos)} `;
    pend = null;
  }
  return out.trim();
}

/** Obdélník otočený kolem středu (cx, cy). */
const box = (cx: number, cy: number, w: number, h: number, deg = 0): string =>
  place(`M${-w / 2},${-h / 2} L${w / 2},${-h / 2} L${w / 2},${h / 2} L${-w / 2},${h / 2} Z`, cx, cy, 1, deg);

/** Barvy hracích karet (výška ~20 při s = 1, střed 0,0). */
const PIP = {
  heart:
    'M0,9 C-6,4 -10,0 -10,-4 C-10,-8 -7,-10 -4.5,-10 C-2,-10 -0.5,-8.5 0,-6.5 C0.5,-8.5 2,-10 4.5,-10 C7,-10 10,-8 10,-4 C10,0 6,4 0,9 Z',
  diamond: 'M0,-10 L7,0 L0,10 L-7,0 Z',
  spade:
    'M0,-10 C-3,-5.5 -10,-2.5 -10,2.5 C-10,6 -7,7.5 -4.5,7.5 C-2.5,7.5 -1,6.5 -0.5,5.5 L-2,10 L2,10 L0.5,5.5 C1,6.5 2.5,7.5 4.5,7.5 C7,7.5 10,6 10,2.5 C10,-2.5 3,-5.5 0,-10 Z',
} as const;

const pip = (suit: keyof typeof PIP, x: number, y: number, s = 1, deg = 0): string =>
  place(PIP[suit], x, y, s, deg);

/** Hrací karta (líc) otočená kolem středu se znakem barvy uprostřed. */
function playingCard(
  cx: number,
  cy: number,
  w: number,
  deg: number,
  suit: keyof typeof PIP | 'club',
  line = 1.3,
): SceneOp[] {
  const h = w * 1.4;
  const s = w / 34;
  const color = suit === 'heart' || suit === 'diamond' ? RED : INK;
  const sym = suit === 'club' ? clubAt(cx, cy, s * 1.4, deg) : pip(suit, cx, cy, s * 1.3, deg);
  return [
    ['f', CREAM, box(cx, cy, w, h, deg), line],
    ['f', color, sym, 0],
  ];
}

/** Křížek (♣) jako jedna cesta (tři kruhy a stopka), otočený kolem středu — kreslit bez obrysu. */
function clubAt(x: number, y: number, s: number, deg: number): string {
  const p = (px: number, py: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)];
  };
  const [ax, ay] = p(0, -4 * s);
  const [bx, by] = p(-4.5 * s, 2 * s);
  const [dx, dy] = p(4.5 * s, 2 * s);
  return [
    c(ax, ay, 4 * s),
    c(bx, by, 4 * s),
    c(dx, dy, 4 * s),
    place('M-1,2 L-2.5,9 L2.5,9 L1,2 Z', x, y, s, deg),
  ].join(' ');
}

/** Ruka svírající předmět (stejná jako u rekvizit figureKit), barva = kůže nebo rukavice. */
function hand(x: number, y: number, deg = 0, color = SKIN): SceneOp[] {
  return [
    ['f', color, c(x, y, 11, 9), 1.8],
    ['l', place('M-9,-3 L9,-3 M-9,3 L9,3', x, y, 1, deg), 1.1],
  ];
}

// ─────────────────────────── Popelář ───────────────────────────

/** Okna paneláku: mřížka, vybraná rozsvícená (šest ráno, půlka domu už vstává). */
function panelakWindows(): SceneOp[] {
  const dark: string[] = [];
  const lit: string[] = [];
  const litSet = new Set(['0,1', '1,4', '2,0', '2,6', '3,3', '1,2', '3,6']);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const x = 22 + col * 27;
      const y = 92 + row * 28;
      if (row === 0 && col >= 6) continue;
      const r = rect(x, y, 17, 13);
      if (litSet.has(`${row},${col}`)) lit.push(r);
      else dark.push(r);
    }
  }
  return [
    ['f', '#22365c', dark.join(' '), 1],
    ['f', '#f2cf4a', lit.join(' '), 1],
  ];
}

// Popelář: oranžová reflexní vesta, za ním zadek popelářského vozu s majákem, vpředu zelená popelnice
// přetékající nízkými kartami; v okně paneláku vzbuzený soused v noční čepici hrozí pěstí (čtvrtek, šest ráno).
const GARBAGE_MAN: Partial<FigureSpec> = {
  bg: '#f6e3a1',
  motif: 'none',
  body: NAVY,
  collar: 'plain',
  hair: 'short',
  hairColor: '#2f2a26',
  beard: 'mustache',
  beardColor: '#2f2a26',
  hat: 'cap',
  hatColor: '#ef8a2e',
  hatAccent: CREAM,
  mood: 'grin',
  backdrop: [
    // Svítání nad sídlištěm.
    ['f', '#f3c7c0', 'M16,58 H234 V84 H16 Z', 0],
    ['f', '#f2cf4a', 'M120,84 A22,22 0 0,1 164,84 Z', 1.2],
    // Panelák s okny a spárami panelů.
    ['f', '#d9d2c2', 'M16,84 H234 V210 H16 Z', 1.6],
    ['l', 'M16,112 H234 M16,140 H234 M16,168 H234 M16,196 H234 M70,84 V210 M178,84 V210', 0.6],
    ...panelakWindows(),
    // Vzbuzený soused v noční čepici hrozí pěstí z okna.
    ['f', '#f2cf4a', rect(184, 88, 42, 26), 1.4],
    ['f', SKIN, c(200, 104, 7), 1.2],
    ['f', CREAM, 'M192,101 L208,99 L218,86 Z', 1.2],
    ['f', RED, c(219, 86, 2.6), 0.8],
    ['l', 'M196,109 l7,-1 M195,101 l3,2 M205,100 l-3,2', 0.9],
    ['i', 'fist', 208, 96, 18, SKIN],
    // Zadek popelářského vozu: maják, korba, násypka s kartami, výstražné pruhy, světla a stupátko.
    ['f', '#ef8a2e', 'M48,112 C48,102 64,102 64,112 Z', 1.4],
    ['l', 'M42,104 l-6,-4 M70,104 l6,-4 M56,98 l0,-6', 1.2],
    ['f', '#f2cf4a', 'M16,226 L16,124 C16,116 22,112 30,112 L90,112 L96,118 L96,226 Z', 2],
    ['l', 'M30,134 H82 M30,142 H82', 1.4],
    ['f', RED, rect(22, 122, 10, 7) + ' ' + rect(78, 122, 10, 7), 1.2],
    ['f', '#3e3a3a', 'M24,206 L24,174 C24,166 30,162 38,162 L84,162 C90,162 92,166 92,172 L92,206 Z', 1.6],
    ['f', CREAM, box(44, 184, 14, 19, -18) + ' ' + box(66, 180, 14, 19, 14), 1],
    ['f', RED, pip('heart', 44, 184, 0.55, -18), 0],
    ['f', INK, pip('spade', 66, 180, 0.55, 14), 0],
    ['f', INK, 'M16,212 H96 V224 H16 Z', 1.4],
    [
      'f',
      '#f2cf4a',
      'M22,212 L30,212 L24,224 L16,224 Z M42,212 L50,212 L44,224 L36,224 Z M62,212 L70,212 L64,224 L56,224 Z M82,212 L90,212 L84,224 L76,224 Z',
      0,
    ],
    ['f', '#9a958a', 'M18,228 H94 V234 H18 Z', 1.4],
    // Chodník.
    ['f', '#c9bfae', 'M16,234 H234 V284 H16 Z', 1.4],
  ],
  outfit: [
    // Oranžová reflexní vesta se stříbrnými pruhy.
    [
      'f',
      '#ef8a2e',
      'M70,284 L74,236 C80,222 90,214 100,212 L112,212 L125,236 L138,212 L150,212 C160,214 170,222 176,236 L180,284 Z',
      1.8,
    ],
    ['s', CREAM, 'M78,242 L172,242', 5],
    ['s', CREAM, 'M76,256 L174,256', 5],
  ],
  extra: [
    // Víko popelnice odklopené dozadu.
    ['f', '#2f6b3a', 'M160,200 L226,200 L232,150 L168,150 Z', 1.8],
    // Nízké karty vykukující z popelnice.
    ...playingCard(176, 190, 22, -22, 'club'),
    ...playingCard(197, 184, 22, 4, 'diamond'),
    ...playingCard(217, 192, 22, 24, 'spade'),
    // Zelená popelnice s kolečkem.
    ['f', '#5d9a3e', 'M158,206 L230,206 L224,284 L164,284 Z', 2],
    ['f', '#2f6b3a', 'M154,198 H234 V208 H154 Z', 1.8],
    ['l', 'M176,214 L178,284 M194,214 L194,284 M212,214 L210,284', 1.1],
    // Kožená pracovní rukavice: prsty přehnuté přes okraj popelnice.
    ['f', '#c99a62', 'M157,200 C156,190 163,185 171,186 C179,187 184,192 183,200 Z', 1.6],
    [
      'f',
      '#c99a62',
      [158, 164.5, 171, 177.5]
        .map((x) => `M${x},198 L${x},208 Q${x + 2.75},213 ${x + 5.5},208 L${x + 5.5},198 Z`)
        .join(' '),
      1.3,
    ],
    ['l', 'M162,192 C166,190 172,190 176,192', 0.9],
  ],
};

// ─────────────────────────── Hudební automat ───────────────────────────

/** Bublinky v bočních sloupcích automatu (jedna cesta). */
function bubbles(): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const y = 146 + i * 17;
    out.push(c(71, y + (i % 2) * 5, 2.6), c(179, y + ((i + 1) % 2) * 5, 2.6));
  }
  return out.join(' ');
}

// Hudební automat v hospodě po půlnoci: zářící skříň s neonovými oblouky, deska s pikovým esem na štítku
// (nejvyšší karta hraje znovu), všechny tituly stejné, ruka hází další pětikorunu; vlevo usnulý štamgast,
// hodiny ukazují tři ráno.
const JUKEBOX: readonly SceneOp[] = [
  ['f', '#22365c', rect(16, 16, 218, 268), 0],
  ['l', 'M40,16 V196 M88,16 V60 M162,16 V60 M210,16 V196', 0.6],
  // Záře automatu.
  ['f', '#6b4a9e', c(125, 150, 104, 112), 0],
  ['f', '#cbb8e3', c(125, 146, 84, 96), 0],
  // Obložení a podlaha.
  ['f', '#8c5632', 'M16,196 H234 V238 H16 Z', 1.6],
  ['l', 'M16,206 H234', 1],
  ['f', '#5a3418', 'M16,238 H234 V284 H16 Z', 1.6],
  ['l', 'M16,252 H234 M60,238 L52,284 M190,238 L198,284', 0.8],
  // Noty, které se točí pořád dokola.
  ['i', 'musical-notes', 22, 82, 30, '#f2cf4a'],
  ['i', 'musical-notes', 194, 104, 26, '#f2cf4a'],
  // Hodiny: tři ráno.
  ['f', CREAM, c(210, 64, 15), 1.8],
  ['l', 'M210,64 L210,54 M210,64 L218,64 M210,51 v2 M223,64 h-2 M210,77 v-2 M197,64 h2', 1.4],
  // Skříň automatu.
  ['f', '#8c5632', 'M62,252 L62,130 C62,64 188,64 188,130 L188,252 Z', 2.4],
  ['f', '#c99a62', 'M76,252 L76,132 C76,82 174,82 174,132 L174,252 Z', 1.6],
  ['f', '#ef8a2e', 'M65,246 L65,140 L73,136 L73,246 Z M185,246 L185,140 L177,136 L177,246 Z', 1.2],
  ['f', '#fffaf0', bubbles(), 0.8],
  ['f', '#e9b030', 'M109,74 A16,16 0 0,1 141,74 Z', 1.4],
  ['l', 'M125,74 L125,62 M125,74 L116,66 M125,74 L134,66', 1],
  // Neonové oblouky.
  ['s', '#d7442c', 'M82,212 L82,134 C82,90 168,90 168,134 L168,212', 7],
  ['s', '#f2cf4a', 'M92,212 L92,136 C92,102 158,102 158,136 L158,212', 5],
  ['s', '#5d9a3e', 'M100,212 L100,138 C100,112 150,112 150,138 L150,212', 3.5],
  // Okno s gramofonovou deskou a přenoskou.
  ['f', '#bcd6e6', 'M106,170 L106,142 C106,120 144,120 144,142 L144,170 Z', 1.6],
  ['f', INK, c(125, 158, 16, 7), 0],
  ['f', '#d7442c', c(125, 158, 6, 3), 0],
  ['l', 'M140,134 L140,146 L130,156', 1.6],
  // Seznam písniček (všechny stejné) a tlačítka.
  ['f', CREAM, rect(104, 174, 42, 22), 1.4],
  ['l', 'M108,180 h14 M128,180 h14 M108,186 h14 M128,186 h14 M108,192 h14 M128,192 h14', 0.9],
  ['f', '#d7442c', c(110, 204, 3.6) + ' ' + c(140, 204, 3.6), 1],
  ['f', '#f2cf4a', c(120, 204, 3.6), 1],
  ['f', '#2f5fa8', c(130, 204, 3.6), 1],
  // Reproduktor s mřížkou.
  ['f', '#5b5850', 'M92,252 L92,224 C92,214 158,214 158,224 L158,252 Z', 1.6],
  ['l', 'M104,218 V252 M116,215 V252 M125,214 V252 M134,215 V252 M146,218 V252', 1.2],
  // Štítek desky s pikem — nejvyšší karta hraje znovu.
  ['f', INK, pip('spade', 125, 158, 0.28), 0],
  // Ruka v rukávu z pravého okraje strká do štěrbiny další pětikorunu.
  ['f', INK, rect(179, 165, 4, 15), 0],
  ['f', '#2f5fa8', 'M210,174 L234,168 L234,194 L210,191 Z', 1.6],
  ['f', CREAM, 'M207,175 L213,173.5 L213,191.5 L207,191 Z', 1.2],
  ['f', '#e9b030', c(189, 172, 8.5), 1.4],
  ['l', 'M192,167 h-5 l-1,4 c4,-1 7,1 6,4 c-1,3 -5,3 -7,1', 1.1],
  ...hand(203, 182),
  // Usnulý štamgast u stolu: hlava na rukou, čepice, půllitr.
  ['f', '#c99a62', 'M16,214 H58 V220 H16 Z', 1.4],
  ['f', '#2f5fa8', 'M14,214 C14,202 30,198 44,204 L48,214 Z', 1.4],
  ['f', SKIN, c(30, 200, 9, 8), 1.4],
  ['f', '#5d9a3e', 'M20,196 C22,186 36,184 42,192 C36,192 28,194 20,196 Z', 1.4],
  ['l', 'M28,202 l5,1', 1],
  ['f', '#f2cf4a', 'M46,214 L46,198 L56,198 L56,214 Z', 1.3],
  ['f', CREAM, 'M45,198 C45,192 57,192 57,198 Z', 1],
  ['l', 'M30,180 l5,0 l-5,5 l5,0 M38,170 l4,0 l-4,4 l4,0', 1.1],
];

// ─────────────────────────── Kůlna ───────────────────────────

/** Vlny plechové střechy: příčné žebrování obou svahů (vnitřní hrana → vnější). */
function roofRibs(): string {
  const out: string[] = [];
  for (let i = 1; i < 11; i++) {
    const t = i / 11;
    out.push(`M${r1(28 + 97 * t)},${r1(128 - 60 * t)} L${r1(18 + 107 * t)},${r1(120 - 66 * t)}`);
    out.push(`M${r1(222 - 97 * t)},${r1(128 - 60 * t)} L${r1(232 - 107 * t)},${r1(120 - 66 * t)}`);
  }
  return out.join(' ');
}

// Kůlna u chaty: otevřené dveře, uvnitř nacpáno — police se zavařeninami (spotřebky!), pila, hrábě, kolo od
// bicyklu, sáňky v létě; venku kolečko, konev, slunečnice, podkova nad dveřmi a odemčený visací zámek.
const KULNA: readonly SceneOp[] = [
  ['f', '#bcd6e6', rect(16, 16, 218, 268), 0],
  [
    'f',
    '#fffaf0',
    'M150,44 C148,34 160,30 168,35 C172,26 190,26 192,36 C202,34 206,46 198,50 L156,51 C148,51 146,47 150,44 Z',
    1.2,
  ],
  ['f', '#5d9a3e', 'M16,226 C80,220 170,224 234,220 L234,284 L16,284 Z', 1.4],
  // Stěny z prken (i štít) a střecha z vlnitého plechu.
  ['f', '#c99a62', 'M36,234 L36,112 L125,64 L214,112 L214,234 Z', 2.2],
  ['l', 'M58,100 V234 M192,100 V234 M170,88 V136 M80,88 V136 M103,76 V136 M147,76 V136', 1],
  ['f', '#9a958a', 'M18,120 L125,54 L232,120 L222,128 L125,68 L28,128 Z', 2.2],
  ['l', roofRibs(), 0.8],
  // Podkova nad dveřmi.
  ['s', '#9a958a', 'M117,118 C117,132 133,132 133,118', 4],
  // Otevřené dveře a nacpaný vnitřek.
  ['f', '#5a3418', 'M84,234 L84,136 L166,136 L166,234 Z', 1.8],
  ['f', '#8c5632', 'M88,166 H162 V171 H88 Z', 1.2],
  // Zavařeniny na polici.
  ['f', '#5d9a3e', rect(92, 148, 14, 18), 1.2],
  ['f', '#d7442c', rect(110, 150, 13, 16), 1.2],
  ['f', '#ef8a2e', rect(127, 147, 13, 19), 1.2],
  ['f', CREAM, rect(91, 145, 16, 4) + ' ' + rect(109, 147, 15, 4) + ' ' + rect(126, 144, 15, 4), 1],
  ['l', 'M95,156 h8 M95,160 h8 M113,158 h7', 0.8],
  // Pila na stěně.
  ['f', '#d9d2c2', 'M92,178 L128,178 L128,186 L96,190 Z', 1.2],
  ['l', 'M96,190 l2,-3 l2,3 l2,-3 l2,3 l2,-3 l2,3 l2,-3 l2,3 l2,-3 l2,3 l2,-3 l2,3 l2,-3 l2,3', 0.7],
  ['f', '#d7442c', 'M128,176 L138,176 L138,188 L128,188 Z', 1.2],
  // Kolo od bicyklu a zapomenutý zahradní trpaslík.
  ['s', '#d9d2c2', c(108, 212, 15), 3],
  ['l', 'M108,197 V227 M93,212 H123 M97,201 L119,223 M119,201 L97,223', 0.8],
  ['f', '#2f5fa8', 'M128,234 C128,220 132,214 141,214 C150,214 154,220 154,234 Z', 1.3],
  ['f', SKIN, c(141, 210, 6), 1.2],
  ['f', '#fffaf0', 'M134,211 C134,224 148,224 148,211 C145,215 137,215 134,211 Z', 1.1],
  ['f', '#d7442c', 'M133,207 L141,186 L149,207 Z', 1.3],
  // Hrábě opřené vpravo.
  ['l', 'M160,234 L158,142', 2],
  ['l', 'M150,142 L166,142 M151,142 v-6 M155,142 v-6 M159,142 v-6 M163,142 v-6', 1.4],
  // Otevřené dveře s visacím zámkem.
  ['f', '#8c5632', 'M84,136 L56,144 L56,236 L84,234 Z', 1.8],
  ['l', 'M66,142 L66,236 M76,139 L76,235 M58,170 L82,166 M58,206 L82,204', 0.8],
  ['i', 'padlock-open', 60, 176, 18, '#e9b030'],
  // Okénko s kostkovanou záclonkou.
  ['f', '#bcd6e6', rect(178, 142, 28, 26), 1.6],
  [
    'f',
    '#d7442c',
    'M178,142 L192,142 C190,152 184,158 178,160 Z M206,142 L192,142 C194,152 200,158 206,160 Z',
    1,
  ],
  ['l', 'M178,155 H206', 1],
  // Venku: slunečnice, konev a kolečko.
  ['l', 'M38,234 L38,176', 1.6],
  ['i', 'sunflower', 20, 150, 36, '#f2cf4a'],
  ['i', 'watering-can', 24, 214, 34, '#2f8077'],
  ['i', 'wheelbarrow', 160, 190, 66, '#2f5fa8'],
];

// ─────────────────────────── Náhradní autobus ───────────────────────────

/** Hlavy cestujících namačkaných v oknech: [x, y, barva pokrývky hlavy nebo '' = vlasy]. */
const BUS_HEADS: readonly (readonly [number, number, string])[] = [
  [74, 152, '#d7442c'],
  [86, 148, '#5a3418'],
  [96, 154, '#2f6b3a'],
  [108, 150, '#5b5850'],
  [120, 147, '#e88a9a'],
  [130, 153, '#8c5632'],
];

// Náhradní autobus za vlak (NAD): starý autobus nacpaný celou vesnicí, z okna kouká koza, na střeše kufr,
// koš zelí a kolo; za ním trať zavřená výlukovou zábranou a stojící motoráček, na silnici kužel.
const NAHRADNI_BUS: readonly SceneOp[] = [
  ['f', '#bcd6e6', rect(16, 16, 218, 268), 0],
  [
    'f',
    '#fffaf0',
    'M118,40 C116,30 128,26 136,31 C140,22 158,22 160,32 C170,30 174,42 166,46 L124,47 C116,47 114,43 118,40 Z',
    1.2,
  ],
  // Násep s tratí, výluková zábrana a motoráček, který dál nejede.
  ['f', '#c6dcae', 'M16,110 C60,92 190,92 234,108 L234,130 L16,130 Z', 1.4],
  ['l', 'M16,96 C60,86 190,86 234,94 M20,90 v8 M40,87 v8 M60,85 v8 M80,84 v8', 1.2],
  ['f', '#d7442c', 'M22,92 L22,70 C22,64 26,62 32,62 L74,62 L82,72 L82,90 Z', 1.6],
  [
    'f',
    '#bcd6e6',
    rect(30, 68, 12, 10) + ' ' + rect(48, 68, 12, 10) + ' ' + 'M66,68 L76,68 L80,78 L66,78 Z',
    1,
  ],
  ['f', '#f2cf4a', 'M80,82 L84,82 L84,86 L80,86 Z', 0.8],
  ['f', '#fffaf0', 'M178,76 L226,70 L227,78 L179,84 Z', 1.4],
  [
    'f',
    '#d7442c',
    'M186,75 L194,74 L195,82 L187,83 Z M202,73 L210,72 L211,80 L203,81 Z M218,71 L226,70 L227,78 L219,79 Z',
    0,
  ],
  ['l', 'M184,84 L184,96 M220,80 L220,94', 1.6],
  // Silnice.
  ['f', '#9a958a', 'M16,232 H234 V284 H16 Z', 1.4],
  ['l', 'M24,258 h22 M88,258 h22 M162,258 h22', 2],
  // Náklad na střeše: kufr, koš zelí, kolo.
  ['l', 'M36,110 L36,104 L172,104 L172,110 M70,104 V110 M104,104 V110 M138,104 V110', 1.4],
  ['f', '#8c5632', rect(42, 86, 30, 18), 1.6],
  ['l', 'M50,86 C50,80 64,80 64,86 M42,95 H72', 1.2],
  ['f', '#c99a62', 'M80,104 L84,90 L112,90 L116,104 Z', 1.6],
  ['f', '#5d9a3e', c(90, 88, 7) + ' ' + c(104, 87, 7), 1.2],
  ['l', 'M86,96 L110,96 M88,100 H108', 0.8],
  ['s', INK, c(130, 94, 9), 1.6],
  ['s', INK, c(160, 94, 9), 1.6],
  ['l', 'M130,94 L142,82 L160,94 L146,94 L138,84 M142,82 L146,78 M136,84 h8', 1.4],
  // Karoserie: krémová nahoře, červená dole.
  ['f', '#f6e3a1', 'M22,232 L22,124 C22,114 30,110 40,110 L206,110 C218,110 226,118 228,130 L230,232 Z', 2.4],
  ['f', '#d7442c', 'M22,174 H229 L230,232 H22 Z', 0],
  ['l', 'M22,174 H229 M22,182 H229', 1.4],
  // Okna nacpaná lidmi.
  ['f', '#bcd6e6', rect(30, 124, 32, 42) + ' ' + rect(68, 124, 32, 42) + ' ' + rect(106, 124, 32, 42), 1.4],
  ['f', SKIN, BUS_HEADS.map(([x, y]) => c(x, y, 7)).join(' '), 1.1],
  ...BUS_HEADS.filter(([, , h]) => h).map(([x, y, h]): SceneOp => [
    'f',
    h,
    `M${x - 7},${y - 2} C${x - 7},${y - 11} ${x + 7},${y - 11} ${x + 7},${y - 2} Z`,
    1,
  ]),
  ['f', SKIN, c(78, 162, 7) + ' ' + c(102, 163, 7) + ' ' + c(124, 162, 7), 1.1],
  [
    'f',
    'dark',
    [
      ...BUS_HEADS.map(([x, y]) => [x, y + 1] as const),
      [78, 163],
      [102, 164],
      [124, 163],
      [158, 153],
      [196, 149],
    ]
      .map(([x, y]) => `${c(x - 2.4, y, 1.1)} ${c(x + 2.4, y, 1.1)}`)
      .join(' '),
    0,
  ],
  // Koza vystrkující hlavu z okna.
  [
    'f',
    '#fffaf0',
    'M34,166 C30,152 34,140 44,138 C54,136 60,146 58,158 C56,166 50,170 46,174 C40,176 36,172 34,166 Z',
    1.6,
  ],
  [
    'f',
    '#9a958a',
    'M38,140 C34,130 38,122 46,120 C42,128 42,134 44,138 Z M50,138 C52,128 58,124 64,126 C58,130 56,134 54,140 Z',
    1.2,
  ],
  ['f', '#fffaf0', 'M34,146 L22,140 L32,152 Z M58,146 L66,138 L60,152 Z', 1.2],
  ['f', '#fffaf0', 'M42,172 L44,184 L48,172 Z', 1],
  ['f', INK, c(42, 152, 1.8) + ' ' + c(52, 152, 1.8), 0],
  ['l', 'M44,164 C46,166 50,166 52,163', 1],
  // Dveře na harmoniku a čelo s řidičem.
  ['f', '#bcd6e6', rect(146, 124, 24, 100), 1.6],
  ['l', 'M158,124 V224 M146,174 H170', 1.4],
  ['f', SKIN, c(158, 152, 6), 1],
  ['f', '#bcd6e6', 'M178,124 L212,124 C220,124 224,130 225,138 L227,166 L178,166 Z', 1.6],
  ['f', SKIN, c(196, 148, 7), 1.2],
  ['f', NAVY, 'M188,146 C188,136 204,136 204,146 Z', 1.2],
  ['l', 'M186,166 L192,156 L208,156', 1.6],
  // Cedulka linky: přeškrtnutý vláček — jede se místo vlaku (bez písmen).
  ['f', '#ef8a2e', rect(178, 102, 46, 21), 1.4],
  ['f', CREAM, rect(182, 105, 38, 15), 1],
  ['f', INK, 'M187,117 L187,110 C187,108.5 188,107.5 189.5,107.5 L208,107.5 L215,113 L215,117 Z', 0],
  [
    'f',
    CREAM,
    rect(190.5, 109.3, 4, 3.2) + ' ' + rect(197, 109.3, 4, 3.2) + ' ' + rect(203.5, 109.3, 4, 3.2),
    0,
  ],
  ['l', 'M185,118.5 H217', 0.9],
  ['s', RED, 'M184,120 L218,105', 2.6],
  // Světlo, nárazník, kola.
  ['f', '#f2cf4a', c(222, 196, 5), 1.2],
  ['f', '#9a958a', 'M200,226 H232 V234 H200 Z', 1.2],
  ['f', 'dark', c(60, 234, 16) + ' ' + c(190, 234, 16), 0],
  ['f', '#d9d2c2', c(60, 234, 6) + ' ' + c(190, 234, 6), 1],
  // Kužel na silnici.
  ['f', '#ef8a2e', 'M118,256 L126,228 L132,228 L140,256 Z', 1.4],
  ['f', '#fffaf0', 'M122,243 L136,243 L137,248 L121,248 Z', 0],
  ['f', '#ef8a2e', rect(114, 254, 30, 5), 1.2],
];

// ─────────────────────────── Řezník z rohu ───────────────────────────

/** Pruhovaná řeznická zástěra: pruhy se rozevírají podle tvaru zástěry (náprsenka → sukně). */
function stripedApron(): SceneOp[] {
  const edge = (f: number, y: number): number =>
    y === 214 ? 104 + f * 42 : y === 240 ? 98 + f * 54 : 88 + f * 74;
  const stripes: string[] = [];
  for (let i = 0; i < 7; i += 2) {
    const f0 = (i + 0.5) / 7.5;
    const f1 = (i + 1.5) / 7.5;
    stripes.push(
      `M${r1(edge(f0, 214))},214 L${r1(edge(f1, 214))},214 L${r1(edge(f1, 240))},240 L${r1(edge(f1, 284))},284 ` +
        `L${r1(edge(f0, 284))},284 L${r1(edge(f0, 240))},240 Z`,
    );
  }
  return [
    ['f', '#fffaf0', 'M104,214 L146,214 L152,240 L162,284 L88,284 L98,240 Z', 1.8],
    ['f', '#d7442c', stripes.join(' '), 0],
    ['l', 'M104,214 L146,214 L152,240 L162,284 M88,284 L98,240 L104,214 M98,240 L152,240', 1.4],
  ];
}

/** Elipsa otočená o `deg` stupňů. */
function ell(cx: number, cy: number, rx: number, ry: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  const dx = rx * Math.cos(a);
  const dy = rx * Math.sin(a);
  return (
    `M${r1(cx - dx)},${r1(cy - dy)} A${rx},${ry} ${deg} 1,0 ${r1(cx + dx)},${r1(cy + dy)} ` +
    `A${rx},${ry} ${deg} 1,0 ${r1(cx - dx)},${r1(cy - dy)} Z`
  );
}

/** Věnec klobás (článků) na tyči: protáhlé články po oblouku, natočené po směru věnce. */
function sausageLinks(x0: number, x1: number, y: number, sag: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const slope = (sag * 4 * (1 - 2 * t)) / (x1 - x0);
    const deg = (Math.atan(slope) * 180) / Math.PI;
    out.push(ell(x0 + (x1 - x0) * t, y + sag * 4 * t * (1 - t), (x1 - x0) / n / 2 + 1, 5, deg));
  }
  return out.join(' ');
}

// Řezník z rohu: bílý plášť, pruhovaná zástěra a papírová lodička, za ním kachlíky, tyč s uzeninami (šunka,
// věnec jitrnic, salám), na zdi plakát prasete s vyznačenými díly a sekáček; v ruce klika mlýnku na maso,
// do kterého právě padá nízká karta — a ven leze jitrnice.
const PIG_SLAUGHTER: Partial<FigureSpec> = {
  bg: '#fffaf0',
  motif: 'none',
  body: '#fffaf0',
  collar: 'shirt',
  hair: 'short',
  hairColor: '#3b2a1a',
  hat: undefined,
  beard: 'walrus',
  beardColor: '#3b2a1a',
  mood: 'grin',
  redNose: true,
  prop: undefined,
  backdrop: [
    // Kachlíky a modrý pruh.
    [
      'l',
      'M16,40 H234 M16,64 H234 M16,88 H234 M16,112 H234 M16,136 H234 M16,160 H234 M16,184 H234 M16,208 H234',
      0.5,
    ],
    [
      'l',
      'M40,16 V284 M64,16 V284 M88,16 V284 M112,16 V284 M136,16 V284 M160,16 V284 M184,16 V284 M208,16 V284',
      0.5,
    ],
    ['f', '#6fa0c8', 'M16,172 H234 V184 H16 Z', 1],
    // Tyč s háky a uzeninami.
    ['l', 'M16,54 H234', 2.4],
    ['l', 'M40,54 v8 M125,54 v6 M207,54 v8', 1.4],
    ['i', 'ham-shank', 20, 60, 44, '#e88a9a'],
    ['l', 'M70,60 L74,54 M180,60 L176,54', 1.2],
    ['f', '#b8302a', sausageLinks(70, 180, 60, 24, 7), 1.3],
    [
      'f',
      '#8c5632',
      'M200,64 C198,80 198,110 202,124 C206,130 212,128 214,122 C216,104 214,80 212,64 Z',
      1.6,
    ],
    [
      'f',
      '#fffaf0',
      c(205, 80, 1.6) + ' ' + c(209, 94, 1.6) + ' ' + c(204, 106, 1.6) + ' ' + c(208, 116, 1.4),
      0,
    ],
    ['l', 'M200,66 h12 M200,74 h12', 1],
    // Plakát s prasetem a čárkovanými díly.
    ['f', '#f6e3a1', rect(20, 104, 66, 52), 1.6],
    ['i', 'pig', 26, 106, 54, '#e88a9a'],
    ['l', 'M42,118 L44,150 M56,114 L56,152 M68,116 L66,150', 1],
    // Sekáček na magnetické liště.
    ['l', 'M20,192 H70', 2.2],
    ['f', '#d9d2c2', 'M26,194 L58,194 L58,214 C46,218 34,218 26,214 Z', 1.6],
    ['f', '#fffaf0', c(52, 200, 2.4), 1],
    ['f', '#8c5632', 'M58,200 L72,200 L72,208 L58,208 Z', 1.4],
  ],
  outfit: stripedApron(),
  extra: [
    // Papírová lodička.
    ['f', '#fffaf0', 'M96,134 L100,118 C112,108 138,108 150,118 L154,134 C140,128 110,128 96,134 Z', 2],
    ['l', 'M125,112 L125,130', 1.1],
    // Špalek a mlýnek na maso: do násypky padá nízká karta, ven leze jitrnice.
    ['f', '#c99a62', 'M150,240 H234 V284 H150 Z', 1.8],
    ['l', 'M150,250 H234', 1],
    ...playingCard(186, 172, 24, 14, 'heart'),
    ['f', '#9a958a', 'M168,204 L156,182 L208,182 L196,204 Z', 1.8],
    ['f', '#9a958a', 'M160,204 H210 C216,204 218,210 218,216 C218,222 216,228 210,228 H160 Z', 1.8],
    ['f', '#9a958a', 'M178,228 L174,240 L196,240 L192,228 Z', 1.6],
    ['l', 'M156,182 H208 M196,204 V228 M202,204 V228', 1.1],
    [
      's',
      '#b8302a',
      'M160,216 C150,216 147,226 151,234 C155,242 166,246 180,246 C194,246 204,244 214,247',
      9,
    ],
    ['l', 'M150,225 l5,1 M156,240 l3,4 M180,242 v8 M200,241 v8', 1],
    // Klika mlýnku a ruka na ní.
    ['l', 'M216,216 H222 V194', 3],
    ['f', '#8c5632', 'M218,180 H226 V196 H218 Z', 1.4],
    ...hand(222, 188, 90),
  ],
};

// ─────────────────────────── Červená a černá ───────────────────────────

/** Praporky na šňůře: střídavě červené se srdcem a černé s pikem. */
function suitBunting(x0: number, x1: number, y: number, sag: number, n: number): SceneOp[] {
  const red: string[] = [];
  const black: string[] = [];
  const hearts: string[] = [];
  const spades: string[] = [];
  const at = (t: number): number => y + sag * 4 * t * (1 - t);
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.1) / n;
    const t1 = (i + 0.9) / n;
    const xa = x0 + (x1 - x0) * t0;
    const xb = x0 + (x1 - x0) * t1;
    const xm = (xa + xb) / 2;
    const ym = (at(t0) + at(t1)) / 2;
    const tri = `M${r1(xa)},${r1(at(t0))} L${r1(xb)},${r1(at(t1))} L${r1(xm)},${r1(ym + 22)} Z`;
    if (i % 2 === 0) {
      red.push(tri);
      hearts.push(pip('heart', xm, ym + 7, 0.5));
    } else {
      black.push(tri);
      spades.push(pip('spade', xm, ym + 7, 0.5));
    }
  }
  const line = `M${x0},${y} Q${(x0 + x1) / 2},${y + sag * 2} ${x1},${y}`;
  return [
    ['l', line, 1.2],
    ['f', '#d7442c', red.join(' '), 1.2],
    ['f', '#1a1714', black.join(' '), 1.2],
    ['f', 'paper', hearts.join(' ') + ' ' + spades.join(' '), 0],
  ];
}

/** Šev sešitý klikatým stehem: svislá linka x od y0 do y1 a cik-cak kolem ní. */
function stitchedSeam(x: number, y0: number, y1: number, w = 4, step = 6): SceneOp[] {
  let zig = `M${x - w},${y0}`;
  for (let y = y0 + step, i = 1; y <= y1; y += step, i++) zig += ` L${x + (i % 2 ? w : -w)},${y}`;
  return [
    ['l', `M${x},${y0} L${x},${y1}`, 1.4],
    ['l', zig, 0.9],
  ];
}

/**
 * Tisk posouvá barvu proti obrysu (soutisk 2,2 doprava a 1,6 dolů), takže pravá polovina by začínala až kus za švem.
 * Proužek barvy bez obrysu, předem posunutý doleva, ji dotáhne až ke švu na x. Papír pod ním zakryje šev nakreslený
 * předtím, proto se šev (a okraje, které proužek protne) kreslí znovu až po něm.
 */
const seamFill = (x: number, y0: number, y1: number, color: string): SceneOp => [
  'f',
  color,
  `M${x - 1.1},${y0} H${x + 2.2} V${y1} H${x - 1.1} Z`,
  0,
];

/** Dres hráče v televizi (tričko s rukávy): střed cx, ramena y; `side` = jen levá / pravá polovina. */
function tvShirt(cx: number, y: number, side?: 'left' | 'right'): string {
  const half = (k: number): string =>
    `M${cx},${y} L${cx + 3 * k},${y} L${cx + 7 * k},${y + 3} L${cx + 5 * k},${y + 7} L${cx + 4 * k},${y + 6} ` +
    `L${cx + 4 * k},${y + 13} L${cx},${y + 13} Z`;
  if (side) return half(side === 'left' ? -1 : 1);
  return (
    `M${cx - 7},${y + 3} L${cx - 3},${y} L${cx + 3},${y} L${cx + 7},${y + 3} L${cx + 5},${y + 7} L${cx + 4},${y + 6} ` +
    `L${cx + 4},${y + 13} L${cx - 4},${y + 13} L${cx - 4},${y + 6} L${cx - 5},${y + 7} Z`
  );
}

/** Půlená vlaječka na tvář (bílá u žerdi vlevo, červená vlající doprava), levý horní roh x, y, 11 × 8. */
function cheekFlag(x: number, y: number): SceneOp[] {
  const fly = (dx: number, dy: number, cut = 0): string => {
    const b = y + 8 - cut + dy;
    return (
      `M${r1(x + 5.5 + dx)},${r1(y + dy)} C${r1(x + 7.3 + dx)},${r1(y - 1 + dy)} ${r1(x + 9.2 + dx)},${r1(y + 1 + dy)} ` +
      `${r1(x + 11 + dx)},${r1(y + dy)} L${r1(x + 11 + dx)},${r1(b)} C${r1(x + 9.2 + dx)},${r1(b + 1)} ` +
      `${r1(x + 7.3 + dx)},${r1(b - 1)} ${r1(x + 5.5 + dx)},${r1(b)} Z`
    );
  };
  return [
    ['f', 'paper', `M${x},${y} H${x + 5.5} V${y + 8} H${x} Z`, 0],
    // Červená předem posunutá doleva a o soutisk kratší, ať po tisku sedí v obrysu až k dolnímu lemu.
    ['f', RED, fly(-2.2, 0, 1.6), 0],
    ['l', `M${x},${y} H${x + 5.5} V${y + 8} H${x} Z ${fly(0, 0)}`, 1.2],
  ];
}

/** Šála omotaná kolem krku (stejný tvar jako `neckScarf` ve figureKit.ts). */
const SCARF_WRAP = 'M101,195 C110,206 140,206 149,195 L151,210 C140,223 110,223 99,210 Z';

// Červená a černá: sešívaný fanoušek — dres z bílé a červené poloviny sešitých klikatým stehem, rukávy obráceně
// (červený na bílé půlce, bílý na červené), sešívaná šála kolem krku, sešívaný kulich a na tvářích půlené
// vlaječky; bílá vždy vlevo. Hospoda pod praporky se srdci a piky, na zdi sešívaná vlajka s třásněmi, v televizi
// derby sešívaného hráče proti černému. Na pultu pípa a pokladna s tržbou, v ruce půllitr. Bez hvězdy, znaku,
// jména klubu i nápisů (docs/DECISIONS.md 2026-10-16).
const DERBY_FANS: Partial<FigureSpec> = {
  bg: '#c99a62',
  motif: 'none',
  body: CREAM,
  body2: RED,
  collar: 'jersey',
  accent: '#b8302a',
  neckScarf: undefined,
  hair: 'short',
  hairColor: '#2f2a26',
  hat: undefined,
  mood: 'grin',
  noBlush: true,
  prop: undefined,
  backdrop: [
    // Tmavé obložení hospody (ať se od něj červená půlka dresu odliší) s lištou a spárami mimo půllitr.
    ['f', '#5e3b24', 'M16,150 H234 V284 H16 Z', 1.4],
    ['l', 'M16,158 H234 M50,158 V284 M226,158 V284', 0.9],
    ...suitBunting(18, 234, 54, 8, 8),
    // Sešívaná vlajka s třásněmi na tyčce s hlavicemi, zavěšená šňůrkou na hřebíku.
    ['l', 'M28,96 L56,87 L84,96', 1.1],
    ['f', 'dark', c(56, 87, 1.8), 0],
    ['f', CREAM, 'M29,98 H56 V140 H29 Z', 1.8],
    ['f', RED, 'M56,98 H83 V140 H56 Z', 1.8],
    seamFill(56, 98, 140, RED),
    ['l', 'M29,98 H83 M29,140 H83', 1.8],
    ...stitchedSeam(56, 100, 138, 3, 5),
    [
      'l',
      'M32,142 v4 M36,142 v4 M40,142 v4 M44,142 v4 M48,142 v4 M52,142 v4 M56,142 v4 M60,142 v4 M64,142 v4 M68,142 v4 M72,142 v4 M76,142 v4 M80,142 v4',
      1,
    ],
    ['l', 'M27,97 H85', 1.8],
    ['f', 'dark', `${c(26, 97, 2.4)} ${c(86, 97, 2.4)}`, 0],
    // Televize na poličce s přenosem derby: sešívaný hráč proti černému.
    ['f', '#8c5632', 'M162,124 H216 V129 H162 Z', 1.2],
    ['l', 'M169,129 V136 L177,129 M209,129 V136 L201,129', 1.1],
    ['f', '#5b5850', rect(164, 88, 50, 36), 1.8],
    ['f', '#5d9a3e', rect(169, 93, 40, 26), 1.2],
    ['l', 'M189,93 V119 M169,106 H173 M207,106 H209', 0.9],
    ['f', SKIN, `${c(180, 96.5, 2.8)} ${c(199, 97.5, 2.8)}`, 0.9],
    ['f', 'paper', tvShirt(180, 100), 0],
    ['f', RED, place(tvShirt(180, 98.4, 'right'), -2.2, 0), 0],
    ['l', `${tvShirt(180, 100)} M180,100 L180,113`, 0.9],
    ['f', 'dark', tvShirt(199, 101), 0],
    ['f', 'paper', c(189, 115, 2.2), 0.8],
    // Výčepní pult: pípa a pokladna s tržbou.
    ['f', '#c99a62', 'M16,196 H92 V206 H16 Z', 1.4],
    ['f', '#d9d2c2', 'M24,196 L24,172 L38,172 L38,196 Z', 1.3],
    ['f', '#d9d2c2', 'M38,176 H46 V186 H42 V180 H38 Z', 1.1],
    ['f', 'dark', 'M28,172 L29.5,158 L34.5,158 L36,172 Z', 0],
    ['f', 'dark', c(32, 157, 3.6), 0],
    ['f', '#e9b030', 'M50,196 L52,170 L88,168 L90,196 Z', 1.6],
    ['f', 'paper', 'M56,168 L84,166 L84,158 L56,160 Z', 1.2],
    ['f', '#5d9a3e', 'M60,166 L70,150 L80,156 L74,166 Z', 1.1],
    [
      'f',
      'paper',
      `${rect(57, 176, 7, 4)} ${rect(67, 176, 7, 4)} ${rect(77, 176, 7, 4)} ${rect(57, 184, 7, 4)} ${rect(67, 184, 7, 4)} ${rect(77, 184, 7, 4)}`,
      0,
    ],
  ],
  outfit: [
    // Červená pravá půlka dotažená až ke švu, límec a šev znovu navrch.
    seamFill(125, 212, 284, RED),
    ['f', '#b8302a', 'M102,210 C108,232 142,232 148,210 L140,210 C136,222 114,222 110,210 Z', 1.6],
    ['l', 'M125,226 L125,284', 1.6],
    ...stitchedSeam(125, 232, 280, 4, 6),
    // Rukávy obráceně: červený na bílé půlce, bílý na červené.
    ['f', RED, 'M44,284 C47.2,248.8 61.9,227.7 83,216.5 C75,234 68,258 66,284 Z', 2.4],
    // Bílý rukáv přesně přes stínování základní postavy (žádné tečky rastru nezůstanou na červené).
    ['f', CREAM, 'M206,284 C202,240 180,218 150,210 C168,228 176,252 178,284 Z', 2.4],
  ],
  extra: [
    // Šála jen omotaná kolem krku (bez visícího konce, ať jsou poloviny dresu čisté), taky sešívaná.
    ['f', CREAM, SCARF_WRAP, 1.8],
    [
      'f',
      RED,
      'M125,203.3 C134.8,203.3 144.5,200.5 149,195 L151,210 C145.5,216.5 135.3,219.8 125,219.8 Z',
      1.8,
    ],
    seamFill(125, 203.3, 219.8, RED),
    ['l', SCARF_WRAP, 1.8],
    ...stitchedSeam(125, 205, 218, 2.5, 4),
    // Půllitr držený za ucho.
    ['i', 'beer-stein', 160, 190, 62, '#f2cf4a'],
    ...hand(168, 222),
    // Na lícních kostech vlaječky (ruměnec vypnutý `noBlush`, červené tváře by splývaly s červenou půlkou).
    ...cheekFlag(103, 159),
    ...cheekFlag(136, 159),
    // Sešívaný kulich: bílá a červená polovina, lem v týchž barvách, jeden šev od bambule po lem.
    ['f', CREAM, 'M96,131 C94,105 108,93 125,93 L125,131 Z', 2.2],
    ['f', RED, 'M125,93 C142,93 156,105 154,131 L125,131 Z', 2.2],
    seamFill(125, 95, 121, RED),
    ['f', CREAM, 'M93,121 H125 V135 H93 Z', 1.8],
    ['f', RED, 'M125,121 H157 V135 H125 Z', 1.8],
    seamFill(125, 121, 133.4, RED),
    ['l', 'M93,121 H157 M93,135 H157', 1.8],
    ['l', 'M105,123 v10 M115,123 v10 M135,123 v10 M145,123 v10', 1.1],
    ...stitchedSeam(125, 96, 133, 3, 5),
    ['f', '#fffaf0', c(125, 89, 7), 1.6],
  ],
};

// ─────────────────────────── Hospodský kvíz ───────────────────────────

/** Sud piva s obručemi a rozetou ceny (barva rozety = pořadí). */
function prizeBarrel(x: number, y: number, rosette: string): SceneOp[] {
  const w = 34;
  const h = 42;
  return [
    [
      'f',
      '#c99a62',
      `M${x + 4},${y} H${x + w - 4} C${x + w + 2},${y + h * 0.3} ${x + w + 2},${y + h * 0.7} ${x + w - 4},${y + h} H${x + 4} C${x - 2},${y + h * 0.7} ${x - 2},${y + h * 0.3} ${x + 4},${y} Z`,
      1.6,
    ],
    [
      'l',
      `M${x + 1},${y + 9} H${x + w - 1} M${x + 1},${y + h - 9} H${x + w - 1} M${x + 12},${y} V${y + h} M${x + 22},${y} V${y + h}`,
      1,
    ],
    [
      'f',
      rosette,
      `M${x + 12},${y + 24} L${x + 9},${y + 38} L${x + 14},${y + 35} L${x + 17},${y + 39} L${x + 17},${y + 26} Z`,
      1,
    ],
    [
      'f',
      rosette,
      `M${x + 22},${y + 24} L${x + 25},${y + 38} L${x + 20},${y + 35} L${x + 17},${y + 39} L${x + 17},${y + 26} Z`,
      1,
    ],
    ['f', rosette, c(x + w / 2, y + 21, 8), 1.3],
    ['f', '#fffaf0', c(x + w / 2, y + 21, 3.5), 0.8],
  ];
}

// Hospodský kvíz: kvízmistr s motýlkem a mikrofonem, nad ním hospodská lampa, vlevo tabule s otazníkem a
// čárkami týmů, vpravo na polici obě ceny — sud piva se zlatou rozetou a sud piva se stříbrnou.
const PUB_QUIZ: Partial<FigureSpec> = {
  bg: '#f6e3a1',
  motif: 'none',
  backdrop: [
    // Obložení.
    ['f', '#8c5632', 'M16,190 H234 V284 H16 Z', 1.4],
    ['l', 'M16,198 H234', 1],
    // Tabule s otazníkem a čárkami týmů.
    ['f', '#8c5632', rect(18, 58, 76, 92), 1.8],
    ['f', '#2f6b3a', rect(24, 64, 64, 80), 1.2],
    ['s', '#fffaf0', 'M38,84 C38,72 58,70 58,82 C58,92 48,92 48,102', 3.4],
    ['f', '#fffaf0', c(48, 112, 2.6), 0],
    [
      's',
      '#fffaf0',
      'M30,126 v10 M34,126 v10 M38,126 v10 M42,126 v10 M28,134 l16,-6 M52,126 v10 M56,126 v10 M60,126 v10 M70,126 v10 M74,126 v10 M78,126 v10',
      1.2,
    ],
    ['s', '#fffaf0', 'M66,80 h14 M66,90 h10 M66,100 h14', 1.2],
    // Lampa nad stolem a její světlo.
    ['f', '#fffaf0', 'M110,58 L76,190 L174,190 L140,58 Z', 0],
    ['l', 'M125,16 V40', 1.4],
    ['f', '#2f6b3a', 'M106,56 C108,44 116,40 125,40 C134,40 142,44 144,56 Z', 1.8],
    ['f', '#f2cf4a', c(125, 58, 5, 3), 1],
    // Police s cenami: dva stejné sudy piva.
    ['f', '#8c5632', 'M156,168 H234 V174 H156 Z', 1.4],
    ['l', 'M164,174 L170,182 M226,174 L220,182', 1.4],
    ...prizeBarrel(158, 126, '#e9b030'),
    ...prizeBarrel(194, 126, '#d9d2c2'),
    // Půllitr na pultu.
    ['f', '#f2cf4a', 'M24,190 L24,170 L38,170 L38,190 Z', 1.3],
    ['f', '#fffaf0', 'M23,170 C23,163 39,163 39,170 Z', 1],
  ],
};

// ─────────────────────────── Sběrna surovin ───────────────────────────

/** Natržená hrací karta (zubatý okraj dole). */
function tornCard(cx: number, cy: number, deg: number, suit: keyof typeof PIP | 'club'): SceneOp[] {
  const d = place('M-9,-12 L9,-12 L9,6 L6,9 L3,5 L0,10 L-3,6 L-6,10 L-9,7 Z', cx, cy, 1, deg);
  const sym = suit === 'club' ? clubAt(cx, cy - 2, 0.5, deg) : pip(suit, cx, cy - 2, 0.42, deg);
  return [
    ['f', CREAM, d, 1.1],
    ['f', suit === 'heart' || suit === 'diamond' ? RED : INK, sym, 0],
  ];
}

// Sběrna surovin: na decimálce se váží balík hracích karet převázaný provázkem, za ní hromada šrotu
// (vana, ozubené kolo, kolo od bicyklu a natržené karty) a modrá plechová bouda s okénkem výkupu a cedulí
// papír–sklo–železo; v dálce komín, na zemi závaží a žákovská knížka s hvězdičkou za pochvalu.
const SCRAP_YARD: readonly SceneOp[] = [
  ['f', '#bcd6e6', rect(16, 16, 218, 268), 0],
  // Komín továrny v dálce.
  ['f', '#9a958a', 'M128,100 L132,50 L140,50 L144,100 Z', 1.4],
  [
    'f',
    '#fffaf0',
    'M140,44 C134,36 144,28 154,34 C162,26 176,32 172,42 C180,44 178,54 168,52 C160,58 146,54 140,44 Z',
    1.2,
  ],
  // Plechová bouda s cedulí papír–sklo–železo a okénkem výkupu.
  ['f', '#6fa0c8', 'M150,212 L150,70 L234,58 L234,212 Z', 2],
  ['l', 'M160,69 V212 M170,67 V212 M180,66 V212 M190,64 V212 M200,63 V212 M210,62 V212 M220,60 V212', 0.6],
  ['f', '#5b5850', 'M144,72 L234,52 L234,62 L148,80 Z', 1.6],
  ['f', '#fffaf0', rect(158, 84, 70, 24), 1.4],
  ['i', 'newspaper', 162, 87, 18, '#9a958a'],
  ['i', 'wine-bottle', 184, 87, 18, '#5d9a3e'],
  ['i', 'cog', 206, 87, 18, '#5b5850'],
  ['f', '#5a3418', rect(164, 118, 54, 36), 1.6],
  ['f', SKIN, c(191, 140, 8), 1.2],
  ['f', '#2f5fa8', 'M182,137 C182,128 200,128 200,137 Z', 1.1],
  ['l', 'M199,144 l10,2', 1.4],
  ['f', '#c99a62', 'M160,154 H222 V160 H160 Z', 1.4],
  // Dvůr.
  ['f', '#c99a62', 'M16,206 H234 V284 H16 Z', 1.4],
  // Hromada šrotu: vana, ozubené kolo, kolo od bicyklu a natržené karty.
  ['f', '#5b5850', 'M16,214 L16,96 C32,80 54,70 74,78 C96,70 120,84 134,108 C146,132 150,176 152,214 Z', 2],
  ['i', 'bathtub', 18, 70, 58, '#fffaf0'],
  ['i', 'cog', 86, 80, 38, '#9a958a'],
  ['s', '#d9d2c2', c(40, 150, 17), 3],
  ['l', 'M40,133 V167 M23,150 H57 M28,138 L52,162 M52,138 L28,162', 0.8],
  ...tornCard(76, 108, -20, 'spade'),
  ...tornCard(80, 146, -8, 'heart'),
  ...tornCard(118, 133, 24, 'diamond'),
  ...tornCard(30, 192, -12, 'club'),
  // Decimálka: stojan, vahadlo s posuvným závažím, plošina.
  ['f', '#2f6b3a', rect(156, 112, 12, 106), 1.6],
  ['f', '#2f6b3a', 'M118,108 H190 V117 H118 Z', 1.6],
  ['l', 'M126,108 v4 M134,108 v4 M152,108 v4 M174,108 v4 M182,108 v4', 0.9],
  ['f', '#e9b030', rect(138, 102, 11, 21), 1.4],
  ['f', CREAM, c(162, 112.5, 2.6), 1],
  ['f', '#2f6b3a', 'M36,226 H176 V256 H36 Z', 2],
  ['f', '#9a958a', 'M32,216 H180 V227 H32 Z', 1.8],
  // Balík hracích karet: vrstvy hran zepředu i z boku, převázaný režným provázkem s uzlem.
  ['f', CREAM, 'M56,216 V178 H136 V216 Z', 1.8],
  ['l', 'M56,183 H136 M56,188 H136 M56,193 H136 M56,198 H136 M56,203 H136 M56,208 H136 M56,212 H136', 0.6],
  ['f', '#d9d2c2', 'M136,216 V178 L150,166 V204 Z', 1.6],
  [
    'l',
    'M136,183 L150,171 M136,188 L150,176 M136,193 L150,181 M136,198 L150,186 M136,203 L150,191 M136,208 L150,196',
    0.6,
  ],
  ['f', CREAM, 'M56,178 L70,166 H150 L136,178 Z', 1.6],
  ['f', INK, pip('spade', 78, 171, 0.34), 0],
  // Srdcová karta zastrčená za provázkem jako cedulka.
  ...playingCard(126, 160, 22, 12, 'heart', 1.5),
  ['s', '#8c5632', 'M96,178 V216 M96,178 L110,166 M60.7,174 H140.7 V212', 2.4],
  ['f', '#8c5632', c(100.7, 174, 3), 1],
  ['s', '#8c5632', 'M99,176 C97,181 93,184 88,185 M102.5,176 C104,181 107,184 112,186', 1.6],
  // Závaží a žákovská knížka s hvězdičkou za pochvalu.
  ['f', '#5b5850', rect(212, 236, 20, 12) + ' ' + rect(215, 227, 14, 9), 1.4],
  ['f', '#5b5850', c(222, 224, 2.6), 1],
  ['f', '#2f5fa8', 'M188,258 L192,242 L216,244 L212,260 Z', 1.4],
  ['l', 'M191,246 L214,248', 0.8],
  [
    'f',
    '#f2cf4a',
    place(
      'M0,-5 L1.5,-1.5 L5,-1.5 L2.2,1 L3.2,4.6 L0,2.5 L-3.2,4.6 L-2.2,1 L-5,-1.5 L-1.5,-1.5 Z',
      202,
      252.5,
      1.1,
      4,
    ),
    0.8,
  ],
];

// ─────────────────────────── Fotograf z pouti ───────────────────────────

/** Pouťová markýza: červenobílé pruhy se zoubkovaným okrajem a šňůra žárovek. */
function fairAwning(): SceneOp[] {
  const stripes: string[] = [];
  for (let x = 16; x < 234; x += 36) stripes.push(rect(x, 16, 18, 30));
  let edge = 'M16,46';
  for (let x = 16; x < 234; x += 18) edge += ` Q${x + 9},60 ${x + 18},46`;
  edge += ' L234,16 L16,16 Z';
  const bulbs: string[] = [];
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    bulbs.push(c(16 + 218 * t, 70 + 16 * t * (1 - t), 3.4));
  }
  return [
    ['f', CREAM, edge, 1.8],
    ['f', RED, stripes.join(' '), 0],
    ['l', edge, 1.8],
    ['l', 'M16,68 Q125,78 234,68', 1],
    ['f', YELLOW, bulbs.join(' '), 1],
  ];
}

/** Hvězdicový záblesk (n cípů). */
function burst(cx: number, cy: number, r0: number, r1v: number, n: number): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? r1v : r0;
    d += `${i === 0 ? 'M' : 'L'}${r1(cx + Math.cos(a) * r)},${r1(cy + Math.sin(a) * r)} `;
  }
  return d + 'Z';
}

// Fotograf z pouti: v baretu a vestě pod pouťovou markýzou se žárovkami; vlevo malovaná stěna s králem
// a dírou na obličej (fotka s králem za dvacku), vpravo dřevěný fotoaparát na stativu s černým plátnem
// a nad ním bleskový prášek, který právě vzplál.
const FAIR_PHOTOGRAPHER: Partial<FigureSpec> = {
  bg: '#cbb8e3',
  motif: 'none',
  // Krátké vlasy: kudrny pod baretem vypadaly jako sluchátka.
  hair: 'short',
  hatColor: '#8e3b6e',
  prop: undefined,
  backdrop: [
    ...fairAwning(),
    // Malovaná stěna s králem a dírou na obličej.
    ['l', 'M30,212 L36,236 M80,212 L74,236', 2],
    ['f', '#6fa0c8', rect(20, 92, 70, 122), 1.8],
    ['f', '#d7442c', 'M26,214 C28,182 40,170 55,168 C70,170 82,182 84,214 Z', 1.6],
    ['f', '#fffaf0', 'M36,176 C44,188 66,188 74,176 L68,168 C62,174 48,174 42,168 Z', 1.3],
    ['f', INK, c(46, 176, 1.3) + ' ' + c(55, 180, 1.3) + ' ' + c(64, 176, 1.3), 0],
    ['l', 'M55,186 V214', 1],
    ['f', '#e9b030', c(55, 196, 2.4) + ' ' + c(55, 206, 2.4), 0.8],
    ['f', '#3e3a3a', c(55, 148, 12, 15), 1.8],
    ['f', '#e9b030', 'M41,132 L41,112 L48,122 L55,106 L62,122 L69,112 L69,132 Z', 1.6],
    ['f', '#d7442c', c(55, 124, 2.6), 0.8],
    ['f', '#5d9a3e', c(46, 127, 2) + ' ' + c(64, 127, 2), 0.8],
    // Žezlo namalované vedle.
    ['l', 'M80,206 L80,150', 2],
    ['f', '#e9b030', c(80, 146, 5), 1.3],
  ],
  extra: [
    // Stativ a dřevěný fotoaparát s mosazným objektivem a černým plátnem.
    ['s', '#8c5632', 'M194,204 L174,266 M194,204 L194,266 M194,204 L214,266', 4],
    ['f', '#1a1714', 'M204,160 C212,152 228,154 232,164 L232,214 L214,208 C216,192 212,176 204,168 Z', 0],
    ['f', '#c99a62', rect(166, 160, 50, 44), 1.8],
    ['l', 'M166,168 H216 M208,160 V204', 1],
    ['f', '#e9b030', c(186, 184, 13), 1.6],
    ['f', '#22365c', c(186, 184, 7), 1.2],
    ['f', '#fffaf0', c(183, 181, 2), 0],
    // Ruka s bleskovým práškem a záblesk.
    ['f', '#fffaf0', burst(205, 92, 9, 22, 8), 1.4],
    ['f', YELLOW, burst(205, 92, 5, 13, 8), 1],
    ['l', 'M205,106 V138', 2.6],
    ['f', '#9a958a', rect(188, 102, 34, 6), 1.4],
    ...hand(205, 138, 90),
  ],
};

export const FIGURES: Readonly<Record<string, Partial<FigureSpec>>> = {
  garbage_man: GARBAGE_MAN,
  pig_slaughter: PIG_SLAUGHTER,
  derby_fans: DERBY_FANS,
  pub_quiz: PUB_QUIZ,
  fair_photographer: FAIR_PHOTOGRAPHER,
};

export const SCENES: Readonly<Record<string, readonly SceneOp[]>> = {
  jukebox: JUKEBOX,
  kulna: KULNA,
  nahradniBus: NAHRADNI_BUS,
  'j-scrap_yard': SCRAP_YARD,
};
