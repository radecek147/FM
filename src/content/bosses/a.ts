/** Šéfové — běžní šéfové 1–13 (docs/DESIGN.md kap. 8). Texty v src/i18n/cs/bosses/a.ts. */
import type { BossCtx, BossDef } from '../../engine/content-types';
import type { Card, JokerInstance, ModifierDelta, RoundState, Suit } from '../../engine/types';
import { SUITS } from '../../engine/types';

// ─────────────────────────── Čísla pravidel (shodná s texty) ───────────────────────────

/**
 * Kontrola z finančáku: daň v Kč za každou zahranou kartu (1.0.1: dřív 1 Kč za ruku — to nic nestálo; teď pětikaretní
 * ruka stojí 5 Kč a vyplatí se hrát méně karet).
 */
const TAX_AUDIT_FEE = 1;
/** Kontrola z finančáku: běžný cíl — pravidlo už bolí samo (1.0: 2,25× při 1 Kč za ruku). */
const TAX_AUDIT_TARGET = 2;
/** Výluka na trati: lícem dolů přijde každá N-tá líznutá karta kola (text: „každá druhá“). */
const TRACK_CLOSURE_EVERY = 2;
/**
 * Výluka na trati: nižší cíl (balanc simulací — s polovinou ruky zakrytou byla 2× ~26% letalita proti ~8 % u běžného
 * šéfa; docs/DECISIONS.md „Fáze 6: ladění se šéfy“).
 */
const TRACK_CLOSURE_TARGET = 1;
/** Polední pauza: počet rukou a nižší cíl (1 ruka; 1,25× měla ~27% letalitu — balanc simulací). */
const LUNCH_BREAK_HANDS = 1;
const LUNCH_BREAK_TARGET = 0.65;
/** Černá kočka: kolik karet v ruce po každé zahrané ruce vyřadí z provozu. */
const BLACK_CAT_CARDS = 2;
/** Mlha nad Labem: hodnoty, které se lížou lícem dolů. */
const ELBE_FOG_MIN = 2;
const ELBE_FOG_MAX = 5;
/** Parkovné: cena zahození v Kč za každé patro (v patře 4 stojí zahození 4 Kč; 1.0: vždy 1 Kč). */
const PARKING_FEE = 1;
/** Parkovné: běžný cíl — poplatek roste s patrem (1.0: 2,25× při 1 Kč). */
const PARKING_TARGET = 2;
/** Kapsář v tramvaji: mírné pravidlo, proto vyšší cíl (2× měl ~2% letalitu — balanc simulací). */
const PICKPOCKET_TARGET = 2.25;
/** Exekutor: nižší cíl (bez nejcennějšího žolíka byla 2× ~1,5× smrtelnější než průměrný šéf). */
const BAILIFF_TARGET = 1.75;
/**
 * Garsonka 1+kk: menší ruka (1.0.1: jen jedno omezení — dřív −1 karta a navíc nejvýš 4 vybrané karty, což vyřadilo
 * Postupky i Barvy a pro barvaře měla šéfka letalitu 37,5 %).
 */
const STUDIO_HAND_SIZE = 2;
/** Garsonka 1+kk: nižší cíl (menší ruka ztěžuje skládání; kalibruje simulace). */
const STUDIO_TARGET = 1.6;
/** Sucho v obci: zahození na nulu, ruka navíc. */
const DROUGHT_DISCARDS = 0;
const DROUGHT_HANDS = 1;

/** Hlášky šéfů (i18n klíče). */
const MSG_DRILLING_BLOCKED = 'bosses.drilling_neighbor.blocked';
const msgGrannyOmen = (suit: Suit): string => `bosses.superstitious_granny.omen.${suit}`;

/** Klíče stavu kola (`RoundState.flags`) — s předponou id šéfa, aby se nepletly se žolíky. */
const FLAG_TRACK_DRAWN = 'track_closure.drawn';
const FLAG_LUNCH_CUT = 'lunch_break.cut';
const FLAG_GRANNY_SUIT = 'superstitious_granny.suit';
const FLAG_CAT_CARDS = 'black_cat.cards';
const FLAG_DROUGHT_CUT = 'village_drought.cut';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Číslo ze stavu kola (chybějící nebo poškozená hodnota = 0). */
function flagNum(round: Readonly<RoundState>, key: string): number {
  const v = round.flags[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Seznam id karet ze stavu kola (chybějící nebo poškozený = prázdný). */
function flagIds(round: Readonly<RoundState>, key: string): number[] {
  const v = round.flags[key];
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
}

/** Barva ze stavu kola, nebo null. */
function flagSuit(round: Readonly<RoundState>, key: string): Suit | null {
  const v = round.flags[key];
  return typeof v === 'string' && (SUITS as readonly string[]).includes(v) ? (v as Suit) : null;
}

/**
 * Strop modifikátoru do konce kola („jen 1 ruka“, „0 zahození“). Na začátku kola spočítá, o kolik
 * je hodnota (bez vlastního stropu) nad stropem, a uloží to do `round.flags`; `passive` šéfa pak přesně tolik ubere.
 * Díky tomu strop platí i s kupóny, balíčkem a žolíky, které hodnotu zvyšují, a Odvolání (`disableBoss`) vrátí
 * rozdíl jako u každého `passive`. Efekty, které ruce nebo zahození přidají až během kola, platí navíc.
 */
function capAtRoundStart(
  ctx: BossCtx,
  key: 'hands' | 'discards',
  flag: string,
  cap: number,
): void {
  const uncapped = ctx.api.modifiers()[key] + flagNum(ctx.round, flag);
  ctx.round.flags[flag] = Math.max(0, uncapped - cap);
}

/** Delta stropu z `capAtRoundStart` (prázdná, dokud kolo nezačalo). */
function capDelta(ctx: BossCtx, key: 'hands' | 'discards', flag: string): ModifierDelta {
  const cut = flagNum(ctx.round, flag);
  const delta: ModifierDelta = {};
  if (cut > 0) delta[key] = -cut;
  return delta;
}

/** Karta s nejvyšší hodnotou (eso nejvýš; kamenná hodnotu nemá); při shodě ta nejvíc vlevo. */
function highestCard(ctx: BossCtx, cards: readonly Card[]): Card | null {
  let best: Card | null = null;
  let bestRank = 0;
  for (const c of cards) {
    const rank = ctx.api.cardRank(c);
    if (rank !== null && rank > bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/** Fungující žolík s nejvyšší prodejní cenou; při shodě ten nejvíc vlevo. */
function mostValuableJoker(ctx: BossCtx): JokerInstance | null {
  let best: JokerInstance | null = null;
  let bestValue = -Infinity;
  for (const j of ctx.state.jokers) {
    if (j.debuffed) continue;
    const value = ctx.api.sellValue(j);
    if (value > bestValue) {
      best = j;
      bestValue = value;
    }
  }
  return best;
}

// ─────────────────────────── Šéfové ───────────────────────────

export const BOSSES_A: BossDef[] = [
  {
    // 1 — Kontrola z finančáku: každá zahraná karta stojí 1 Kč (srážka do dluhového limitu).
    id: 'tax_audit',
    minAnte: 1,
    targetMult: TAX_AUDIT_TARGET,
    color: '#2f4a6d',
    params: { fee: TAX_AUDIT_FEE },
    hooks: {
      afterHandPlayed: (ctx) => ctx.api.addMoney(-TAX_AUDIT_FEE * ctx.played.length, 'boss'),
    },
    art: {
      icon: 'magnifying-glass',
      prop: 'papers',
      bg: '#1f3047',
      fg: '#e8eef6',
      accent: '#c9a227',
      pattern: 'grid',
    },
  },
  {
    // 2 — Výluka na trati: každá druhá karta líznutá v tomto kole (počítáno přes všechna dobrání) lícem dolů.
    id: 'track_closure',
    minAnte: 2,
    targetMult: TRACK_CLOSURE_TARGET,
    color: '#b5651d',
    hooks: {
      onDraw: (ctx) => {
        let drawn = flagNum(ctx.round, FLAG_TRACK_DRAWN);
        for (const card of ctx.drawn) {
          drawn++;
          if (drawn % TRACK_CLOSURE_EVERY === 0) ctx.api.setCardFaceDown(card.id, true);
        }
        ctx.round.flags[FLAG_TRACK_DRAWN] = drawn;
      },
    },
    art: {
      icon: 'steam-locomotive',
      prop: 'traffic-cone',
      bg: '#4a2a12',
      fg: '#fbe3c8',
      accent: '#f28c28',
      pattern: 'stripes',
    },
  },
  {
    // 3 — Inventura: figury (`api.isFace`, tedy i při `allFaces`) jsou mimo provoz.
    id: 'inventory',
    minAnte: 1,
    color: '#6b5b3e',
    hooks: {
      isCardDebuffed: (ctx, card) => ctx.api.isFace(card),
    },
    art: {
      icon: 'shop',
      prop: 'king',
      bg: '#3d3424',
      fg: '#f3ead6',
      accent: '#d4b06a',
      pattern: 'checker',
    },
  },
  {
    // 4 — Soused s vrtačkou: kombinace už zahraná v tomto kole neskóruje (ruka se spotřebuje).
    id: 'drilling_neighbor',
    minAnte: 1,
    color: '#7a7d80',
    hooks: {
      validateHand: (ctx) =>
        ctx.round.handTypesPlayed.includes(ctx.hand.type) ? MSG_DRILLING_BLOCKED : null,
    },
    art: {
      icon: 'drill',
      prop: 'house',
      bg: '#3a3d40',
      fg: '#eef0f2',
      accent: '#e5c22e',
      pattern: 'zigzag',
    },
  },
  {
    // 5 — Polední pauza: v kole jen 1 ruka (strop přes `passive`), zato nižší cíl.
    id: 'lunch_break',
    minAnte: 2,
    targetMult: LUNCH_BREAK_TARGET,
    color: '#c08a2b',
    params: { hands: LUNCH_BREAK_HANDS },
    hooks: {
      passive: (ctx) => capDelta(ctx, 'hands', FLAG_LUNCH_CUT),
      onRoundStart: (ctx) => capAtRoundStart(ctx, 'hands', FLAG_LUNCH_CUT, LUNCH_BREAK_HANDS),
    },
    art: {
      icon: 'alarm-clock',
      prop: 'dumpling',
      bg: '#5a3d10',
      fg: '#fff3d6',
      accent: '#f5c04a',
      pattern: 'dots',
    },
  },
  {
    // 6 — Pověrčivá babka: na začátku kola vylosuje barvu (stream `boss`); karty té barvy jsou mimo provoz.
    id: 'superstitious_granny',
    minAnte: 1,
    color: '#6a3d7a',
    hooks: {
      onRoundStart: (ctx) => {
        const suit = ctx.rng.pick(SUITS);
        ctx.round.flags[FLAG_GRANNY_SUIT] = suit;
        ctx.api.message(msgGrannyOmen(suit));
      },
      isCardDebuffed: (ctx, card) => {
        const suit = flagSuit(ctx.round, FLAG_GRANNY_SUIT);
        return suit !== null && ctx.api.hasSuit(card, suit);
      },
    },
    art: {
      icon: 'crystal-ball',
      prop: 'candle-light',
      bg: '#33193d',
      fg: '#f1e2f7',
      accent: '#b98ad0',
      pattern: 'rays',
    },
  },
  {
    // 7 — Černá kočka: po každé zahrané ruce 2 náhodné karty, které zůstaly v ruce, do konce kola mimo provoz.
    id: 'black_cat',
    minAnte: 2,
    color: '#26262e',
    params: { cards: BLACK_CAT_CARDS },
    hooks: {
      afterHandPlayed: (ctx) => {
        const cursed = flagIds(ctx.round, FLAG_CAT_CARDS);
        const cleansed = ctx.round.cleansedCards ?? [];
        const pool = ctx.held.map((c) => c.id).filter((id) => !cursed.includes(id) && !cleansed.includes(id));
        const picked = ctx.rng.shuffle(pool).slice(0, BLACK_CAT_CARDS);
        ctx.round.flags[FLAG_CAT_CARDS] = [...cursed, ...picked];
      },
      isCardDebuffed: (ctx, card) => flagIds(ctx.round, FLAG_CAT_CARDS).includes(card.id),
    },
    art: {
      icon: 'cat',
      prop: 'footprint',
      bg: '#121216',
      fg: '#e9e6f2',
      accent: '#e3c341',
      pattern: 'none',
    },
  },
  {
    // 8 — Mlha nad Labem: karty s hodnotou 2–5 se lížou lícem dolů (kamenná hodnotu nemá).
    id: 'elbe_fog',
    minAnte: 2,
    color: '#8a9aa6',
    params: { min: ELBE_FOG_MIN, max: ELBE_FOG_MAX },
    hooks: {
      isDrawnFaceDown: (ctx, card) => {
        const rank = ctx.api.cardRank(card);
        return rank !== null && rank >= ELBE_FOG_MIN && rank <= ELBE_FOG_MAX;
      },
    },
    art: {
      icon: 'fluffy-cloud',
      prop: 'canoe',
      bg: '#4b5963',
      fg: '#f2f6f8',
      accent: '#b9c8d2',
      pattern: 'waves',
    },
  },
  {
    // 9 — Parkovné: každé zahození stojí 1 Kč × číslo patra (srážka do dluhového limitu).
    id: 'parking_fee',
    minAnte: 1,
    targetMult: PARKING_TARGET,
    color: '#1d5fa8',
    params: { fee: PARKING_FEE },
    hooks: {
      onDiscard: (ctx) => ctx.api.addMoney(-PARKING_FEE * Math.max(1, ctx.state.ante), 'boss'),
    },
    art: {
      icon: 'city-car',
      prop: 'ticket',
      bg: '#123a66',
      fg: '#e6f0fb',
      accent: '#5fa8f0',
      pattern: 'grid',
    },
  },
  {
    // 10 — Garsonka 1+kk: −2 karty v ruce (vybrat jde dál až 5 karet).
    id: 'studio_flat',
    minAnte: 2,
    targetMult: STUDIO_TARGET,
    color: '#9c6b4e',
    params: { handSize: STUDIO_HAND_SIZE },
    hooks: {
      passive: () => ({ handSize: -STUDIO_HAND_SIZE }),
    },
    art: {
      icon: 'window',
      prop: 'bathtub',
      bg: '#4f3526',
      fg: '#f8ebe2',
      accent: '#d99a6c',
      pattern: 'checker',
    },
  },
  {
    // 11 — Sucho v obci: 0 zahození (strop přes `passive`), ale +1 ruka.
    id: 'village_drought',
    minAnte: 2,
    color: '#c9a03d',
    params: { discards: DROUGHT_DISCARDS, hands: DROUGHT_HANDS },
    hooks: {
      passive: (ctx) => ({ hands: DROUGHT_HANDS, ...capDelta(ctx, 'discards', FLAG_DROUGHT_CUT) }),
      onRoundStart: (ctx) => capAtRoundStart(ctx, 'discards', FLAG_DROUGHT_CUT, DROUGHT_DISCARDS),
    },
    art: {
      icon: 'sun',
      prop: 'watering-can',
      bg: '#6b4a10',
      fg: '#fff6dc',
      accent: '#f7d154',
      pattern: 'rays',
    },
  },
  {
    // 12 — Kapsář v tramvaji: po každé zahrané ruce zahodí z ruky kartu s nejvyšší hodnotou (bez zahození, bez hooků).
    id: 'pickpocket',
    minAnte: 2,
    targetMult: PICKPOCKET_TARGET,
    color: '#a33b3b',
    hooks: {
      afterHandPlayed: (ctx) => {
        const card = highestCard(ctx, ctx.held);
        if (card) ctx.api.discardFromHand(card.id);
      },
    },
    art: {
      icon: 'hand',
      prop: 'wallet',
      bg: '#4d1a1a',
      fg: '#fbe6e6',
      accent: '#e07a5f',
      pattern: 'stripes',
    },
  },
  {
    // 13 — Exekutor: na začátku kola vyřadí z provozu fungujícího žolíka s nejvyšší prodejní cenou (do konce kola).
    id: 'bailiff',
    minAnte: 2,
    targetMult: BAILIFF_TARGET,
    color: '#4a4a4a',
    hooks: {
      onRoundStart: (ctx) => {
        const joker = mostValuableJoker(ctx);
        if (joker) ctx.api.setJokerDebuffed(joker.uid, true);
      },
    },
    art: {
      icon: 'gavel',
      prop: 'locked-chest',
      bg: '#262626',
      fg: '#f0f0f0',
      accent: '#c0392b',
      pattern: 'none',
    },
  },
];
