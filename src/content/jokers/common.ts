/**
 * Žolíci — vzácnost/skupina: common (docs/DESIGN.md kap. 4.7, č. 1–15). Texty v src/i18n/cs/jokers/common.ts.
 * Návod: docs/CONTENT-GUIDE.md.
 *
 * Čísla mechanik jsou jen v konstantách níže — stejné hodnoty čte hook i popisek (`params`, `describe`).
 * Nečíselné `params` (`suit`, `hand`) jsou nápověda pro boty simulace (src/engine/sim/bots.ts), popisky je nečtou.
 */
import type { JokerCtx, JokerDef } from '../../engine/content-types';
import type { Card, JokerInstance, Modifiers, Suit } from '../../engine/types';
import { RANKS, SUITS } from '../../engine/types';

// ─────────────────────────── Čísla ───────────────────────────

/** Pivní tácek: +čipy a +mult každé ruce. */
const BEER_MAT_CHIPS = 10;
const BEER_MAT_MULT = 2;
/** Srdcař: za každou skórující ♥. */
const HEARTS_MAN_SUIT: Suit = 'H';
const HEARTS_MAN_CHIPS = 5;
const HEARTS_MAN_MULT = 2;
/** Hrobník: za každou skórující ♠. */
const GRAVEDIGGER_SUIT: Suit = 'S';
const GRAVEDIGGER_CHIPS = 20;
/**
 * Klenotník: trvalé čipy pro každou skórující ♦. 1.0.1: 5 → 10 — s „čipovou“ tabulkou kombinací (ruce ~100 čipů v patrech
 * 1–3, ~350 v 6–8) bylo +5 pod pásmem běžného (R1 5 %, R2 7 %; DECISIONS „Kalibrace 1.0.1“).
 */
const JEWELER_SUIT: Suit = 'D';
const JEWELER_CHIPS = 10;
/** Křižák: +mult, když skóruje aspoň tolik ♣. */
const CRUSADER_SUIT: Suit = 'C';
const CRUSADER_MULT = 12;
const CRUSADER_CLUBS = 2;
/** Ranní ptáče: první ruka kola. 1.0.1: 8 → 7 (R1 107 % nad pásmem běžného — kola dřív trvala ~1,5 ruky). */
const EARLY_BIRD_MULT = 7;
/** Noční směna: každá ruka v kole se šéfem (den = Malá a Velká útrata, noc = šéf). */
const NIGHT_SHIFT_MULT = 14;
/** Meteorolog: +mult za každou úroveň zahrané kombinace nad první (první placená úroveň je 2). */
const METEOROLOGIST_MULT = 2;
const METEOROLOGIST_FROM_LEVEL = 2;
/** Tělocvikář: +čipy za každou zahranou kartu. */
const PE_TEACHER_CHIPS = 8;
/** Párty pro dva: ruka obsahující Dvojici. */
const PARTY_CHIPS = 15;
const PARTY_MULT = 3;
/** Zahrádkář Venca: Kč za každých N karet držených v ruce na konci kola. */
const GARDENER_MONEY = 2;
const GARDENER_CARDS = 3;
/** Švejk: slabá ruka = méně než PCT % cíle kola; +zahození, nejvýš MAX× za kolo. */
const SVEJK_PCT = 10;
const SVEJK_DISCARDS = 1;
const SVEJK_MAX = 2;
/** Pokladnička: Kč na konci kola; po ROUNDS kolech se rozbije a dá BONUS navíc. */
const PIGGY_MONEY = 2;
const PIGGY_ROUNDS = 8;
const PIGGY_BONUS = 8;
/** Bazarník: Kč za každý prázdný slot žolíka. */
const FLEA_MONEY = 3;
/** Golem: kamenné karty při získání a čipy navíc za každou skórující kamennou kartu. */
const GOLEM_CARDS = 2;
const GOLEM_CHIPS = 20;

/** Hlášky žolíků (i18n klíče). */
const MSG_JEWELER = 'jokers.jeweler.polished';
const MSG_SVEJK = 'jokers.svejk.report';
const MSG_PIGGY = 'jokers.piggy_bank.broken';

/** Id kamenného vylepšení (src/content/modifiers.ts). */
const STONE = 'stone';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Číslo ze stavu instance (chybějící nebo poškozená hodnota = výchozí). */
function num(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Je skórující karta dané barvy? (divoká patří do všech, kamenná do žádné — rozhoduje engine) */
function suitScorer(suit: Suit) {
  return (ctx: JokerCtx & { readonly card: Card }): boolean => ctx.api.hasSuit(ctx.card, suit);
}

/** Kamenná karta, pokud vylepšení zrovna platí (Bílá hora je vypíná). */
function isStone(card: Card, mods: Readonly<Modifiers>): boolean {
  return card.enhancement === STONE && !mods.disableEnhancements;
}

/** Pokladnička: kolik kol zbývá do rozbití. */
function piggyLeft(self: JokerInstance): number {
  return Math.max(0, PIGGY_ROUNDS - num(self, 'rounds'));
}

/** Švejk: kolikrát ještě v tomto kole může přidat zahození. */
function svejkLeft(self: JokerInstance): number {
  return Math.max(0, SVEJK_MAX - num(self, 'used'));
}

const isHeart = suitScorer(HEARTS_MAN_SUIT);
const isSpade = suitScorer(GRAVEDIGGER_SUIT);
const isDiamond = suitScorer(JEWELER_SUIT);

// ─────────────────────────── Žolíci ───────────────────────────

export const COMMON_JOKERS: JokerDef[] = [
  {
    // 1 — jediný žolík, který se smí v nabídce opakovat (FALLBACK_JOKER_ID v engine/constants.ts).
    id: 'beer_mat',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'mult'],
    params: { chips: BEER_MAT_CHIPS, mult: BEER_MAT_MULT },
    hooks: {
      onHandPlayed: () => ({ chips: BEER_MAT_CHIPS, mult: BEER_MAT_MULT }),
    },
    art: {
      icon: 'beer-stein',
      prop: 'quill-ink',
      bg: '#6b3f1d',
      fg: '#f7e6c4',
      accent: '#e0a63a',
      pattern: 'dots',
    },
  },
  {
    // 2
    id: 'hearts_man',
    rarity: 'common',
    cost: 5,
    tags: ['chips', 'mult', 'suit'],
    params: { chips: HEARTS_MAN_CHIPS, mult: HEARTS_MAN_MULT, suit: HEARTS_MAN_SUIT },
    hooks: {
      onCardScored: (ctx) => (isHeart(ctx) ? { chips: HEARTS_MAN_CHIPS, mult: HEARTS_MAN_MULT } : null),
    },
    art: {
      icon: 'hearts',
      prop: 'wallet',
      bg: '#8e1b2c',
      fg: '#ffe4e6',
      accent: '#f4a7b4',
      pattern: 'waves',
    },
  },
  {
    // 3
    id: 'gravedigger',
    rarity: 'common',
    cost: 5,
    tags: ['chips', 'suit'],
    params: { chips: GRAVEDIGGER_CHIPS, suit: GRAVEDIGGER_SUIT },
    hooks: {
      onCardScored: (ctx) => (isSpade(ctx) ? { chips: GRAVEDIGGER_CHIPS } : null),
    },
    art: {
      icon: 'spades',
      prop: 'death-skull',
      bg: '#1f2421',
      fg: '#d9e0d6',
      accent: '#8a9a6b',
      pattern: 'stripes',
    },
  },
  {
    // 4 — bonus se zapíše do karty hned, takže platí už při jejím případném opakování v téže ruce.
    id: 'jeweler',
    rarity: 'common',
    cost: 5,
    tags: ['chips', 'scaling', 'suit', 'deck'],
    params: { chips: JEWELER_CHIPS, suit: JEWELER_SUIT },
    hooks: {
      onCardScored: (ctx) => {
        if (!isDiamond(ctx)) return null;
        ctx.api.modifyCard(ctx.card.id, { bonusChips: ctx.card.bonusChips + JEWELER_CHIPS });
        return { message: MSG_JEWELER };
      },
    },
    art: {
      icon: 'diamonds',
      prop: 'magnifying-glass',
      bg: '#0f4c5c',
      fg: '#e0fbfc',
      accent: '#ffd166',
      pattern: 'rays',
    },
  },
  {
    // 5 — debuffnutá ♣ „nedává nic“, takže se do počtu nepočítá.
    id: 'crusader',
    rarity: 'common',
    cost: 4,
    tags: ['mult', 'suit'],
    params: { mult: CRUSADER_MULT, count: CRUSADER_CLUBS, suit: CRUSADER_SUIT },
    hooks: {
      onHandPlayed: (ctx) => {
        const clubs = ctx.scoring.filter((c) => !c.debuffed && ctx.api.hasSuit(c, CRUSADER_SUIT)).length;
        return clubs >= CRUSADER_CLUBS ? { mult: CRUSADER_MULT } : null;
      },
    },
    art: {
      icon: 'broadsword',
      prop: 'clubs',
      bg: '#2d3a4a',
      fg: '#f1f5f9',
      accent: '#c0392b',
      pattern: 'checker',
    },
  },
  {
    // 6
    id: 'early_bird',
    rarity: 'common',
    cost: 4,
    tags: ['mult'],
    params: { mult: EARLY_BIRD_MULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.firstHand ? { mult: EARLY_BIRD_MULT } : null),
    },
    art: { icon: 'rooster', prop: 'sun', bg: '#f4a259', fg: '#3d2c1e', accent: '#fff3b0', pattern: 'rays' },
  },
  {
    // 7 — „kolo šéfa“ = kolo s šéfem (`round.bossId`), tedy i Velká útrata se šéfem na Imperialu; vypnutý šéf
    // (Odvolání) na tom nic nemění.
    id: 'night_shift',
    rarity: 'common',
    cost: 4,
    tags: ['mult'],
    params: { mult: NIGHT_SHIFT_MULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.round.bossId !== null ? { mult: NIGHT_SHIFT_MULT } : null),
    },
    art: {
      icon: 'moon',
      prop: 'alarm-clock',
      bg: '#151a3b',
      fg: '#e8e6ff',
      accent: '#f5d76e',
      pattern: 'dots',
    },
  },
  {
    // 8 — `level` (první úroveň, od které něco dává) čtou boti při nákupu; v popisku se nepoužívá.
    id: 'meteorologist',
    rarity: 'common',
    cost: 5,
    tags: ['mult', 'hand'],
    params: { mult: METEOROLOGIST_MULT, level: METEOROLOGIST_FROM_LEVEL },
    hooks: {
      onHandPlayed: (ctx) => {
        const above = ctx.api.handLevel(ctx.hand.type) - METEOROLOGIST_FROM_LEVEL + 1;
        return above > 0 ? { mult: above * METEOROLOGIST_MULT } : null;
      },
    },
    art: {
      icon: 'raining',
      prop: 'umbrella',
      bg: '#3a6ea5',
      fg: '#f0f7ff',
      accent: '#ffd23f',
      pattern: 'waves',
    },
  },
  {
    // 9
    id: 'pe_teacher',
    rarity: 'common',
    cost: 4,
    tags: ['chips'],
    params: { chips: PE_TEACHER_CHIPS },
    hooks: {
      onHandPlayed: (ctx) => ({ chips: ctx.played.length * PE_TEACHER_CHIPS }),
    },
    art: {
      icon: 'stopwatch',
      prop: 'megaphone',
      bg: '#1d3557',
      fg: '#f1faee',
      accent: '#e63946',
      pattern: 'stripes',
    },
  },
  {
    // 10 — `hand` (id kombinace) čtou boti při nákupu; v popisku se nepoužívá.
    id: 'party_for_two',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'mult', 'hand'],
    params: { chips: PARTY_CHIPS, mult: PARTY_MULT, hand: 'pair' },
    hooks: {
      onHandPlayed: (ctx) =>
        ctx.hand.contains.includes('pair') ? { chips: PARTY_CHIPS, mult: PARTY_MULT } : null,
    },
    art: {
      icon: 'wine-glass',
      prop: 'musical-notes',
      bg: '#5b2a86',
      fg: '#f8e9ff',
      accent: '#ff8fab',
      pattern: 'zigzag',
    },
  },
  {
    // 11 — rozpis odměn engine kopírujícím žolíkům nepočítá, kopie by nedala nic.
    id: 'gardener',
    rarity: 'common',
    cost: 5,
    tags: ['economy'],
    params: { money: GARDENER_MONEY, cards: GARDENER_CARDS },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) =>
        Math.floor((ctx.state.round?.hand.length ?? 0) / GARDENER_CARDS) * GARDENER_MONEY,
    },
    art: {
      icon: 'watering-can',
      prop: 'cabbage',
      bg: '#3f6b2a',
      fg: '#f2f7d9',
      accent: '#c27c4a',
      pattern: 'grid',
    },
  },
  {
    // 12 — počítadlo `used` je per kolo (nuluje se na začátku i na konci kola), `firedAt` = index ruky, ve které
    // naposledy přidal zahození (podle něj kopie pozná, že originál v této ruce zahození dal).
    id: 'svejk',
    rarity: 'common',
    cost: 4,
    tags: ['utility', 'discard'],
    params: { pct: SVEJK_PCT, discards: SVEJK_DISCARDS, max: SVEJK_MAX },
    initState: () => ({ used: 0, firedAt: -1 }),
    describe: (self) => ({ left: svejkLeft(self) }),
    hooks: {
      onRoundStart: (ctx) => {
        if (ctx.isCopy) return;
        ctx.self.state.used = 0;
        ctx.self.state.firedAt = -1;
      },
      afterHandScored: (ctx) => {
        // Slabá ruka: skóre < PCT % cíle (bez desetinných čísel: skóre × 100 < cíl × PCT).
        if (ctx.score * 100 >= ctx.round.target * SVEJK_PCT) return;
        const handIndex = ctx.round.handsPlayed;
        const used = num(ctx.self, 'used');
        if (ctx.isCopy) {
          // Kopie stav nemění: přidá zahození, když ho v této ruce dá (nebo ještě dá) i originál.
          if (used >= SVEJK_MAX && num(ctx.self, 'firedAt', -1) !== handIndex) return;
        } else {
          if (used >= SVEJK_MAX) return;
          ctx.self.state.used = used + 1;
          ctx.self.state.firedAt = handIndex;
        }
        ctx.api.addDiscards(SVEJK_DISCARDS);
        ctx.api.message(MSG_SVEJK, { discards: SVEJK_DISCARDS });
      },
      onRoundEnd: (ctx) => {
        if (ctx.isCopy) return;
        ctx.self.state.used = 0;
        ctx.self.state.firedAt = -1;
      },
    },
    art: {
      icon: 'smoking-pipe',
      prop: 'card-discard',
      bg: '#5a6b3a',
      fg: '#f3efd9',
      accent: '#c2a14d',
      pattern: 'stripes',
    },
  },
  {
    // 13 — `onRoundEnd` počítá dokončená kola (běží před rozpisem odměn), `roundEndMoney` vyplácí; po posledním
    // kole vyplatí i bonus a rovnou se zničí (v rozpisu je „Pokladnička +10 Kč“, pak zmizí). Rozbitá pokladnička,
    // kterou zničit nejde (vynucená nálepka přibitý — výzva, `createJoker`), už nic nevyplácí.
    id: 'piggy_bank',
    rarity: 'common',
    cost: 5,
    tags: ['economy'],
    params: { money: PIGGY_MONEY, rounds: PIGGY_ROUNDS, bonus: PIGGY_BONUS },
    copyable: false,
    noEternal: true,
    noRental: true,
    initState: () => ({ rounds: 0 }),
    describe: (self) => ({ left: piggyLeft(self) }),
    hooks: {
      onRoundEnd: (ctx) => {
        if (ctx.isCopy) return;
        ctx.self.state.rounds = num(ctx.self, 'rounds') + 1;
      },
      roundEndMoney: (ctx) => {
        const rounds = num(ctx.self, 'rounds');
        if (rounds < PIGGY_ROUNDS) return PIGGY_MONEY;
        if (rounds > PIGGY_ROUNDS) return 0;
        if (!ctx.isCopy) {
          ctx.api.message(MSG_PIGGY);
          ctx.api.destroyJoker(ctx.self.uid, 'broken');
        }
        return PIGGY_MONEY + PIGGY_BONUS;
      },
    },
    art: {
      icon: 'piggy-bank',
      prop: 'claw-hammer',
      bg: '#e78fa0',
      fg: '#3b1f2b',
      accent: '#ffd166',
      pattern: 'zigzag',
    },
  },
  {
    // 14 — negativní edice si slot přinese sama (`api.jokerSlots()` ji započítá), takže prázdný slot nezabere.
    id: 'flea_trader',
    rarity: 'common',
    cost: 4,
    tags: ['economy'],
    params: { money: FLEA_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) => Math.max(0, ctx.api.jokerSlots() - ctx.state.jokers.length) * FLEA_MONEY,
    },
    art: {
      icon: 'wheelbarrow',
      prop: 'coins-pile',
      bg: '#7b5e3b',
      fg: '#fff4e0',
      accent: '#9ac1a3',
      pattern: 'grid',
    },
  },
  {
    // 15 — kamenné karty mají náhodnou hodnotu a barvu (stream `joker`); projeví se, jen když vylepšení neplatí.
    id: 'golem',
    rarity: 'common',
    cost: 5,
    tags: ['chips', 'deck'],
    params: { cards: GOLEM_CARDS, chips: GOLEM_CHIPS },
    hooks: {
      onAcquire: (ctx) => {
        for (let i = 0; i < GOLEM_CARDS; i++) {
          const suit = ctx.rng.pick(SUITS);
          const rank = ctx.rng.pick(RANKS);
          ctx.api.addCard({ suit, rank, enhancement: STONE }, { source: 'golem' });
        }
      },
      onCardScored: (ctx) => (isStone(ctx.card, ctx.mods) ? { chips: GOLEM_CHIPS } : null),
    },
    art: {
      icon: 'golem-head',
      prop: 'stone-block',
      bg: '#4a4038',
      fg: '#eadfc8',
      accent: '#c9a227',
      pattern: 'checker',
    },
  },
];
