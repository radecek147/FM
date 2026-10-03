/** Žolíci — vzácnost/skupina: rare. Texty v src/i18n/cs/jokers/rare.ts. Návod: docs/CONTENT-GUIDE.md. */
import type { JokerDef } from '../../engine/content-types';
import type { JokerInstance } from '../../engine/types';

/** Číselný stav žolíka (`self.state[key]`), jinak výchozí hodnota (čerstvá instance, cizí save). */
function stateNum(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ─────────────────────────── #16 Zpožděný rychlík ───────────────────────────

const LATE_TRAIN_XMULT = 1.5;
/** „1 z 6“, že efekt nabere zpoždění (čitatel násobí `probabilityMult`). */
const LATE_TRAIN_CHANCE = 1;
const LATE_TRAIN_ODDS = 6;

const lateTrain: JokerDef = {
  id: 'late_train',
  rarity: 'rare',
  cost: 6,
  tags: ['xmult'],
  params: { xmult: LATE_TRAIN_XMULT, chance: LATE_TRAIN_CHANCE, odds: LATE_TRAIN_ODDS },
  hooks: {
    onHandPlayed: (ctx) =>
      ctx.chance(LATE_TRAIN_CHANCE, LATE_TRAIN_ODDS)
        ? { message: 'jokers.late_train.delay' }
        : { xmult: LATE_TRAIN_XMULT },
  },
  art: {
    icon: 'steam-locomotive',
    bg: '#1f3a2e',
    fg: '#f1e6c8',
    accent: '#d9a441',
    pattern: 'stripes',
    prop: 'hourglass',
  },
};

// ─────────────────────────── #17 Pan vrchní ───────────────────────────

const HEAD_WAITER_XMULT = 2;
const HEAD_WAITER_MAX_CARDS = 3;

const headWaiter: JokerDef = {
  id: 'head_waiter',
  rarity: 'rare',
  cost: 7,
  tags: ['xmult', 'hand'],
  params: { xmult: HEAD_WAITER_XMULT, cards: HEAD_WAITER_MAX_CARDS },
  hooks: {
    // Počítají se všechny zahrané karty, i ty, které neskórují.
    onHandPlayed: (ctx) => (ctx.played.length <= HEAD_WAITER_MAX_CARDS ? { xmult: HEAD_WAITER_XMULT } : null),
  },
  art: {
    icon: 'wallet',
    bg: '#2b2b33',
    fg: '#f5f0e6',
    accent: '#c9a227',
    pattern: 'checker',
    prop: 'mustache',
  },
};

// ─────────────────────────── #18 Stará garda ───────────────────────────

const OLD_GUARD_XMULT = 1.5;
const OLD_GUARD_MIN_LEVEL = 3;

const oldGuard: JokerDef = {
  id: 'old_guard',
  rarity: 'rare',
  cost: 6,
  tags: ['xmult', 'hand'],
  params: { xmult: OLD_GUARD_XMULT, level: OLD_GUARD_MIN_LEVEL },
  hooks: {
    // Úroveň v okamžiku skórování (po případném zvýšení v `beforeScoring`).
    onHandPlayed: (ctx) =>
      ctx.api.handLevel(ctx.hand.type) >= OLD_GUARD_MIN_LEVEL ? { xmult: OLD_GUARD_XMULT } : null,
  },
  art: {
    icon: 'shield',
    bg: '#4a3b2a',
    fg: '#efe2c4',
    accent: '#8c2f2f',
    pattern: 'grid',
    prop: 'crossed-swords',
  },
};

// ─────────────────────────── #19 Kořenářka ───────────────────────────

/**
 * 1.0.1: +2 mult za babskou radu, ale bylinky vadnou — kolo bez použité rady −1 mult (nejméně 0). Fáze 10 měla +1 bez
 * vadnutí (+2 bez vadnutí bylo nad pásmem vzácného). Kalibrace 1.0.1: +2 → +1,5 (R2 95 % nad pásmem vzácného, Δ výher
 * +17 p. b.).
 */
const HERBALIST_MULT = 1.5;
const HERBALIST_WILT = 1;
/** Klíč stavu: použila se v tomto kole babská rada? */
const HERBALIST_FRESH = 'fresh';

const herbalist: JokerDef = {
  id: 'herbalist',
  rarity: 'rare',
  cost: 6,
  unlock: { type: 'useConsumable', kind: 'rada', count: 10 },
  tags: ['mult', 'scaling', 'consumable'],
  params: { mult: HERBALIST_MULT, wilt: HERBALIST_WILT },
  initState: () => ({ mult: 0, [HERBALIST_FRESH]: false }),
  describe: (self) => ({ current: stateNum(self, 'mult') }),
  hooks: {
    onConsumableUsed: (ctx) => {
      if (ctx.isCopy || ctx.kind !== 'rada') return;
      ctx.self.state.mult = stateNum(ctx.self, 'mult') + HERBALIST_MULT;
      ctx.self.state[HERBALIST_FRESH] = true;
    },
    // Konec vyhraného kola: bez použité rady bylinky zvadnou (rada použitá ve Večerce platí pro příští kolo).
    onRoundEnd: (ctx) => {
      if (ctx.isCopy) return;
      if (ctx.self.state[HERBALIST_FRESH] !== true)
        ctx.self.state.mult = Math.max(0, stateNum(ctx.self, 'mult') - HERBALIST_WILT);
      ctx.self.state[HERBALIST_FRESH] = false;
    },
    onHandPlayed: (ctx) => {
      const mult = stateNum(ctx.self, 'mult');
      return mult > 0 ? { mult } : null;
    },
  },
  art: {
    icon: 'linden-leaf',
    bg: '#2f4a2a',
    fg: '#f3f0d0',
    accent: '#a8c66c',
    pattern: 'dots',
    prop: 'garlic',
  },
};

// ─────────────────────────── #20 Stálý host ───────────────────────────

const REGULAR_MULT = 1;

const regular: JokerDef = {
  id: 'regular',
  rarity: 'rare',
  cost: 6,
  tags: ['mult', 'scaling'],
  params: { mult: REGULAR_MULT },
  initState: () => ({ rounds: 0 }),
  describe: (self) => ({ current: stateNum(self, 'rounds') * REGULAR_MULT }),
  // Roste s časem ve slotu — zvětrávající nálepka by šla proti smyslu žolíka (content-types: `noPerishable`).
  noPerishable: true,
  hooks: {
    // `onRoundEnd` běží po každém dokončeném (vyhraném nebo zachráněném) kole.
    onRoundEnd: (ctx) => {
      if (ctx.isCopy) return;
      ctx.self.state.rounds = stateNum(ctx.self, 'rounds') + 1;
    },
    onHandPlayed: (ctx) => {
      const mult = stateNum(ctx.self, 'rounds') * REGULAR_MULT;
      return mult > 0 ? { mult } : null;
    },
  },
  art: {
    icon: 'tavern-sign',
    bg: '#5a3a22',
    fg: '#f6e7c8',
    accent: '#e0b057',
    pattern: 'waves',
    prop: 'beer-stein',
  },
};

// ─────────────────────────── #21 Pivní břicho ───────────────────────────

/** 1.0.1: 2 → 3 (R2 16 % pod pásmem vzácného — čipy s „čipovou“ tabulkou kombinací znamenají míň). */
const BEER_BELLY_CHIPS = 3;

const beerBelly: JokerDef = {
  id: 'beer_belly',
  rarity: 'rare',
  cost: 6,
  tags: ['chips', 'scaling'],
  params: { chips: BEER_BELLY_CHIPS },
  initState: () => ({ chips: 0 }),
  describe: (self) => ({ current: stateNum(self, 'chips') }),
  noPerishable: true,
  hooks: {
    onHandPlayed: (ctx) => {
      const chips = stateNum(ctx.self, 'chips');
      return chips > 0 ? { chips } : null;
    },
    // Po sečtení ruky — první ruka po koupi tedy dá +0 a teprve pak roste.
    afterHandScored: (ctx) => {
      if (ctx.isCopy) return;
      ctx.self.state.chips = stateNum(ctx.self, 'chips') + BEER_BELLY_CHIPS;
    },
  },
  art: {
    icon: 'barrel',
    bg: '#6b4a1f',
    fg: '#fbefd5',
    accent: '#f2c14e',
    pattern: 'rays',
    prop: 'beer-bottle',
  },
};

// ─────────────────────────── #22 Kolotoč na pouti ───────────────────────────

const CAROUSEL_MULT = 14;

const carousel: JokerDef = {
  id: 'carousel',
  rarity: 'rare',
  cost: 6,
  unlock: { type: 'playHand', hand: 'straight', count: 10 },
  tags: ['mult', 'utility', 'hand'],
  // `hand` čtou boti při nákupu (styl „Postupky“), v popisku není.
  params: { mult: CAROUSEL_MULT, hand: 'straight' },
  hooks: {
    passive: () => ({ straightWrap: true }),
    // Postupka = každá zahraná ruka, která Postupku obsahuje (i Postupka v barvě a Královská postupka).
    onHandPlayed: (ctx) => (ctx.hand.contains.includes('straight') ? { mult: CAROUSEL_MULT } : null),
  },
  art: {
    icon: 'anticlockwise-rotation',
    bg: '#7a2a5a',
    fg: '#fde9f3',
    accent: '#f4c542',
    pattern: 'zigzag',
    prop: 'ticket',
  },
};

// ─────────────────────────── #23 Ozvěna z propasti ───────────────────────────

const ECHO_RETRIGGERS = 4;

const echo: JokerDef = {
  id: 'echo',
  rarity: 'rare',
  cost: 7,
  tags: ['retrigger'],
  params: { retriggers: ECHO_RETRIGGERS },
  hooks: {
    // Poslední skórující karta v pořadí zahrání (debuffnutá se přeskočí celá, i bez opakování).
    retriggerScored: (ctx) => (ctx.scoring[ctx.scoring.length - 1]?.id === ctx.card.id ? ECHO_RETRIGGERS : 0),
  },
  art: {
    icon: 'mountains',
    bg: '#25303f',
    fg: '#dfe8f2',
    accent: '#7fa7c9',
    pattern: 'waves',
    prop: 'megaphone',
  },
};

// ─────────────────────────── #24 Šťastná sedmička ───────────────────────────

/** „1 ze 7“ pro každou skórující kartu (čitatel násobí `probabilityMult`), že skóruje ještě 7×. */
const LUCKY_SEVEN_CHANCE = 1;
const LUCKY_SEVEN_ODDS = 7;
const LUCKY_SEVEN_RETRIGGERS = 7;

const luckySeven: JokerDef = {
  id: 'lucky_seven',
  rarity: 'rare',
  cost: 6,
  unlock: { type: 'stat', stat: 'handsPlayed', atLeast: 77 },
  tags: ['retrigger'],
  params: { chance: LUCKY_SEVEN_CHANCE, odds: LUCKY_SEVEN_ODDS, retriggers: LUCKY_SEVEN_RETRIGGERS },
  hooks: {
    // Hod jednou za skórující kartu a ruku (engine volá `retriggerScored` jednou před aktivacemi karty; debuffnutá
    // karta se přeskočí bez hodu). Stream `joker` → stejný seed = stejné výhry, i po uložení a načtení.
    retriggerScored: (ctx) => (ctx.chance(LUCKY_SEVEN_CHANCE, LUCKY_SEVEN_ODDS) ? LUCKY_SEVEN_RETRIGGERS : 0),
  },
  art: {
    icon: 'rolling-dices',
    bg: '#14532d',
    fg: '#ecfccb',
    accent: '#facc15',
    pattern: 'dots',
    prop: 'clover',
  },
};

// ─────────────────────────── #25 Sekera ───────────────────────────

const TAB_DEBT = 15;
/** +mult za každou korunu, která chybí do hranice (při 0 Kč +15 mult, v dluhu −15 Kč +30 mult). */
const TAB_MULT = 1;
const TAB_CAP = 15;

const tab: JokerDef = {
  id: 'tab',
  rarity: 'rare',
  cost: 6,
  unlock: { type: 'roundEndMoney', atMost: 0 },
  tags: ['economy', 'mult'],
  params: { debt: TAB_DEBT, mult: TAB_MULT, cap: TAB_CAP },
  hooks: {
    // Dluhový limit se sčítá s ostatními zdroji (dva žolíci = až −30 Kč).
    passive: () => ({ debtLimit: TAB_DEBT }),
    // Peníze v okamžiku kroku 4 (peníze z karet téže ruky už se připsaly).
    onHandPlayed: (ctx) => {
      const missing = TAB_CAP - ctx.state.money;
      return missing > 0 ? { mult: missing * TAB_MULT } : null;
    },
  },
  art: {
    icon: 'battle-axe',
    bg: '#3d2b1f',
    fg: '#f4e9d8',
    accent: '#b5523b',
    pattern: 'checker',
    prop: 'quill-ink',
  },
};

export const RARE_JOKERS: JokerDef[] = [
  lateTrain,
  headWaiter,
  oldGuard,
  herbalist,
  regular,
  beerBelly,
  carousel,
  echo,
  luckySeven,
  tab,
];
