/**
 * Žolíci — vzácnost/skupina: legendary (docs/DESIGN.md kap. 4.8). Texty v src/i18n/cs/jokers/legendary.ts.
 * Návod: docs/CONTENT-GUIDE.md.
 *
 * Postavy a symboly z českých pověstí. V obchodě ani v obálkách nejsou (`noShop`) — objevují se jen z razítka
 * „Výjimka z vyhlášky“ (`createJoker({ rarity: 'legendary' })`). Cena 16 Kč, prodej 8 Kč (DESIGN 4.1).
 * Čísla mechanik jsou jen v konstantách níže — stejné hodnoty čte hook i popisek (`params`, `describe`).
 */
import type { JokerDef } from '../../engine/content-types';
import type { Card, HandType, JokerInstance, Rank } from '../../engine/types';

const LEGENDARY_COST = 16;

/** Číselný stav žolíka (`self.state[key]`), jinak výchozí hodnota (čerstvá instance, cizí save). */
function stateNum(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Součet „×základ + přírůstek × n“ zaokrouhlený na setiny (0,05 ani 0,2 nejsou v binárním zápisu přesné). */
const cents = (x: number): number => Math.round(x * 100) / 100;

// ─────────────────────────── Praotec Čech ───────────────────────────

const FOREFATHER_LEVELS = 1;

/**
 * Úroveň se zvýší v `beforeScoring`, takže platí už pro tuto ruku. „První ruka“ = `ctx.firstHand` (v kole se ještě
 * nehrálo); ruka zakázaná šéfem `beforeScoring` nespustí a další ruka už první není. Kopie zvýší úroveň znovu
 * (chová se jako druhá instance), jen nepočítá do stavu (`levels` = úrovně, které rozdal originál — pro popisek).
 */
const forefather: JokerDef = {
  id: 'forefather',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['hand', 'scaling'],
  params: { levels: FOREFATHER_LEVELS },
  initState: () => ({ levels: 0 }),
  describe: (self) => ({ current: stateNum(self, 'levels') }),
  hooks: {
    beforeScoring: (ctx) => {
      if (!ctx.firstHand) return null;
      ctx.api.levelUpHand(ctx.hand.type, FOREFATHER_LEVELS);
      if (!ctx.isCopy) ctx.self.state.levels = stateNum(ctx.self, 'levels') + FOREFATHER_LEVELS;
      // Hláška jako událost (ne krok skórování): změna úrovně se ukáže už v základu kombinace.
      ctx.api.message('jokers.forefather.settled');
      return null;
    },
  },
  art: {
    icon: 'beard',
    prop: 'house',
    bg: '#4a3a24',
    fg: '#f6ead0',
    accent: '#7fae5a',
    pattern: 'stripes',
  },
};

// ─────────────────────────── Kněžna Libuše ───────────────────────────

const LIBUSE_RANK: Rank = 12;
const LIBUSE_XMULT = 1.4;
/** Kolik karet držených v ruce promění na konci kola v dámu. */
const LIBUSE_CARDS = 1;

/**
 * Dáma = hodnota 12 podle pravidel (`api.cardRank`: kamenná karta hodnotu nemá; divoká ano). Na konci kola
 * (`onRoundEnd`, ruka po vítězné ruce ještě leží) promění náhodnou drženou kartu s hodnotou, která není dáma
 * (stream `joker`). Kopie promění další kartu — chová se jako druhá instance.
 */
const libuse: JokerDef = {
  id: 'libuse',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult', 'face', 'rank', 'deck'],
  params: { xmult: LIBUSE_XMULT, cards: LIBUSE_CARDS },
  hooks: {
    onCardScored: (ctx) => (ctx.api.cardRank(ctx.card) === LIBUSE_RANK ? { xmult: LIBUSE_XMULT } : null),
    onRoundEnd: (ctx) => {
      const pool = (ctx.state.round?.hand ?? [])
        .map((id) => ctx.api.getCard(id))
        .filter((c): c is Card => c !== undefined && (ctx.api.cardRank(c) ?? LIBUSE_RANK) !== LIBUSE_RANK);
      let changed = 0;
      for (let i = 0; i < LIBUSE_CARDS && pool.length > 0; i++) {
        const [card] = pool.splice(ctx.rng.int(0, pool.length - 1), 1);
        ctx.api.modifyCard(card!.id, { rank: LIBUSE_RANK });
        changed++;
      }
      if (changed > 0) ctx.api.message('jokers.libuse.prophecy');
    },
  },
  art: {
    icon: 'crystal-ball',
    prop: 'crown',
    bg: '#3b1f4a',
    fg: '#f7e9ff',
    accent: '#e8b4f8',
    pattern: 'rays',
  },
};

// ─────────────────────────── Blaničtí rytíři ───────────────────────────

const BLANIK_XMULT = 3;
/** Vyjedou, dokud skóre kola (před touto rukou) nedosáhne tolika procent cíle. */
const BLANIK_PCT = 50;

const blanikKnights: JokerDef = {
  id: 'blanik_knights',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult'],
  params: { xmult: BLANIK_XMULT, pct: BLANIK_PCT },
  hooks: {
    // Bez desetinných čísel: skóre × 100 < cíl × PCT (přesně polovina už nestačí).
    onHandPlayed: (ctx) =>
      ctx.round.score * 100 < ctx.round.target * BLANIK_PCT ? { xmult: BLANIK_XMULT } : null,
  },
  art: {
    icon: 'crossed-swords',
    prop: 'mountains',
    bg: '#2b3326',
    fg: '#e9efdc',
    accent: '#b8862b',
    pattern: 'checker',
  },
};

// ─────────────────────────── Bruncvíkův meč ───────────────────────────

const BRUNCVIK_BASE = 1;
const BRUNCVIK_XMULT = 0.2;

const bruncvikXmult = (self: JokerInstance): number =>
  cents(BRUNCVIK_BASE + BRUNCVIK_XMULT * stateNum(self, 'cuts'));

/**
 * „Nejnižší“ = nejnižší hodnota podle pravidel (`api.cardRank`); karta bez hodnoty (kamenná) se nepočítá, při shodě
 * první v pořadí zahození. Kopie v `onDiscard` nic nedělá (kartu zničí a meč nabrousí jen originál), ×mult ale
 * kopíruje.
 */
const bruncvikSword: JokerDef = {
  id: 'bruncvik_sword',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult', 'scaling', 'discard', 'deck'],
  params: { xmult: BRUNCVIK_XMULT },
  initState: () => ({ cuts: 0 }),
  describe: (self) => ({ current: bruncvikXmult(self) }),
  hooks: {
    onDiscard: (ctx) => {
      if (ctx.isCopy || !ctx.firstDiscard) return null;
      let victim: Card | null = null;
      let lowest = Infinity;
      for (const card of ctx.discarded) {
        const rank = ctx.api.cardRank(card);
        if (rank !== null && rank < lowest) {
          lowest = rank;
          victim = card;
        }
      }
      if (!victim) return null;
      ctx.api.destroyCard(victim.id, 'bruncvik_sword');
      ctx.self.state.cuts = stateNum(ctx.self, 'cuts') + 1;
      return { message: 'jokers.bruncvik_sword.cut' };
    },
    onHandPlayed: (ctx) => {
      const xmult = bruncvikXmult(ctx.self);
      return xmult > BRUNCVIK_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'crown',
    prop: 'broadsword',
    bg: '#6b1d1d',
    fg: '#fde8c8',
    accent: '#f2c14e',
    pattern: 'zigzag',
  },
};

// ─────────────────────────── Doktor Faust ───────────────────────────

const FAUST_BASE = 1;
const FAUST_XMULT = 0.06;
const FAUST_MAX = 5;

/** ×mult podle peněz v okamžiku skórování (dluh = nic navíc), nejvýš ×5. */
const faustXmult = (money: number): number =>
  Math.min(FAUST_MAX, cents(FAUST_BASE + FAUST_XMULT * Math.max(0, money)));

const faust: JokerDef = {
  id: 'faust',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult'],
  params: { base: FAUST_BASE, xmult: FAUST_XMULT, max: FAUST_MAX },
  hooks: {
    onHandPlayed: (ctx) => {
      const xmult = faustXmult(ctx.state.money);
      return xmult > FAUST_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'contract',
    prop: 'devil-mask',
    bg: '#1f1a2e',
    fg: '#f4e4c1',
    accent: '#d9482b',
    pattern: 'dots',
  },
};

// ─────────────────────────── Krakonoš ───────────────────────────

const KRAKONOS_LEVELS = 1;
const KRAKONOS_MONEY = 2;

/**
 * Jen pranostiky (`kind === 'pranostika'`); kombinaci zná registr (`api.consumableHand`). Kopie (Napodobitel v kole)
 * přidá úroveň a peníze znovu — chová se jako druhá instance. Peníze jdou mimo rozpis odměn (hned při použití).
 */
const krakonos: JokerDef = {
  id: 'krakonos',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['consumable', 'hand', 'economy'],
  params: { levels: KRAKONOS_LEVELS, money: KRAKONOS_MONEY },
  hooks: {
    onConsumableUsed: (ctx) => {
      if (ctx.kind !== 'pranostika') return;
      const hand = ctx.api.consumableHand(ctx.defId);
      if (hand) ctx.api.levelUpHand(hand, KRAKONOS_LEVELS);
      ctx.api.addMoney(KRAKONOS_MONEY, 'joker');
      ctx.api.message('jokers.krakonos.weather');
    },
  },
  art: {
    icon: 'lightning-storm',
    prop: 'pine-tree',
    bg: '#1d3b34',
    fg: '#e3f4ec',
    accent: '#9fd3c7',
    pattern: 'waves',
  },
};

// ─────────────────────────── Hloupý Honza ───────────────────────────

const HONZA_XMULT = 4;
/** Kombinace, za které Honza násobí (přesně tyto, ne „obsahuje“). */
const HONZA_HANDS: readonly HandType[] = ['high_card', 'pair'];

const sillyHonza: JokerDef = {
  id: 'silly_honza',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult', 'hand'],
  // `hand` čtou boti (styl „Dvojice“), v popisku není.
  params: { xmult: HONZA_XMULT, hand: 'pair' },
  hooks: {
    onHandPlayed: (ctx) => (HONZA_HANDS.includes(ctx.hand.type) ? { xmult: HONZA_XMULT } : null),
  },
  art: {
    icon: 'farmer',
    prop: 'bread',
    bg: '#7a4b1e',
    fg: '#fff1d6',
    accent: '#f2a541',
    pattern: 'grid',
  },
};

// ─────────────────────────── Orloj ───────────────────────────

const CLOCK_FIRST = 2;
const CLOCK_SECOND = 3;
const CLOCK_LATER = 4;

/**
 * Pořadí ruky v kole = `round.handsPlayed` před touto rukou (0 = první). Ruka zakázaná šéfem se do pořadí počítá
 * (spotřebuje se jako každá jiná).
 */
const astroClock: JokerDef = {
  id: 'astro_clock',
  rarity: 'legendary',
  cost: LEGENDARY_COST,
  noShop: true,
  tags: ['xmult'],
  params: { first: CLOCK_FIRST, second: CLOCK_SECOND, later: CLOCK_LATER },
  hooks: {
    onHandPlayed: (ctx) => {
      const n = ctx.round.handsPlayed;
      return { xmult: n === 0 ? CLOCK_FIRST : n === 1 ? CLOCK_SECOND : CLOCK_LATER };
    },
  },
  art: {
    icon: 'hourglass',
    prop: 'death-skull',
    bg: '#14213d',
    fg: '#fdf0d5',
    accent: '#d4a017',
    pattern: 'rays',
  },
};

export const LEGENDARY_JOKERS: JokerDef[] = [
  forefather,
  libuse,
  blanikKnights,
  bruncvikSword,
  faust,
  krakonos,
  sillyHonza,
  astroClock,
];
