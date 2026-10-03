/**
 * Šéfové — běžní šéfové 14–25 (docs/DESIGN.md kap. 8.2). Texty v src/i18n/cs/bosses/b.ts, testy
 * v tests/unit/bosses-b.test.ts. Návod: docs/CONTENT-GUIDE.md kap. 4.
 *
 * Čísla pravidel jsou jen v konstantách níže — čte je hook i `params` a text (`rule`) je dosazuje přes `{param}`.
 * Per-kolo stav šéfa žije v `round.flags` (klíče s předponou id šéfa, ARCHITECTURE 2.7), aby přežil uložení
 * a načtení.
 */
import type { BossCtx, BossDef, ScoringInfo } from '../../engine/content-types';
import type { Card, HandType } from '../../engine/types';
import { HAND_TYPES } from '../../engine/types';

// ─────────────────────────── Čísla ───────────────────────────

/** Běžný násobek cíle šéfa (DESIGN 8.1) — pro text Šanonu na šanonu. */
const NORMAL_TARGET_MULT = 2;
/**
 * Nová vyhláška: úrovně všech kombinací se v kole počítají jen z této části (zaokrouhleno nahoru, nejméně 1) — 1.0.1:
 * dřív se úrovně vynulovaly úplně (letalita ~22 % i při nižším cíli, pozdní build přišel o všechno).
 */
const DECREE_LEVEL_DIVISOR = 2;
/** Nová vyhláška: nižší cíl (polovina úrovní pořád bolí; kalibrace 1.0.1: s 1,5× průměrná letalita). */
const DECREE_TARGET_MULT = 1.5;
/** Šanon na šanonu: násobek základního cíle patra (kalibrace 1.0.1: 3× měl ~1,5× průměrné letality → 2,4×). */
const BINDER_TARGET_MULT = 2.4;
/** Zabijačka: kolik náhodných skórujících karet se po ruce zničí. */
const SLAUGHTER_CARDS = 1;
/** Zabijačka: pravidlo bolí až v dalších kolech, proto vyšší cíl (2× měl ~4% letalitu — balanc simulací). */
const SLAUGHTER_TARGET_MULT = 2.5;
/** Krajské derby: nižší cíl (poloviční základ smíšených rukou měl s 2× ~1,8× průměrnou letalitu — balanc). */
const DERBY_TARGET_MULT = 1.75;
/** Normalizace: čipy každé skórující karty. */
const NORMALIZATION_CHIPS = 5;
/** Jednooký hejtman: nižší cíl (s polovinou žolíků byla 2× ~26% letalita — balanc simulací, DECISIONS). */
const HETMAN_TARGET_MULT = 1.6;
/** Tchyně na návštěvě: kolik náhodných karet z ruky zahodí každé zahození navíc. */
const MOTHER_IN_LAW_CARDS = 1;
/** Tchyně na návštěvě: mírné pravidlo, proto vyšší cíl (2× měl ~3% letalitu — balanc simulací). */
const MOTHER_IN_LAW_TARGET_MULT = 2.25;
/** Kocovina: ruce méně. */
const HANGOVER_HANDS = 1;
/**
 * Cíle šéfů s pravidlem, které bolí míň nebo víc než průměr (kalibrace 1.0.1, letalita normovaná podle patra):
 * Bílá hora, Normalizace, Výpadek proudu a Sudé dny s 2× ~0,55–0,8× průměru, Influencerka ~1,5×.
 */
const WHITE_MOUNTAIN_TARGET_MULT = 2.45;
const NORMALIZATION_TARGET_MULT = 2.2;
const INFLUENCER_TARGET_MULT = 1.75;
const BLACKOUT_TARGET_MULT = 2.1;
const EVEN_DAYS_TARGET_MULT = 2.1;
/** Sudé dny: liché hodnoty (eso je 14, ale počítá se jako 1 = liché). */
const ODD_RANKS: readonly number[] = [14, 3, 5, 7, 9];

/** Klíč `round.flags`: kombinace, kterou si Influencerka vybrala na začátku kola. */
export const INFLUENCER_FLAG = 'influencer.hand';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Úroveň kombinace podle Nové vyhlášky: dělená `DECREE_LEVEL_DIVISOR`, zaokrouhlená nahoru, nejméně 1. */
export function decreeLevel(level: number): number {
  return Math.max(1, Math.ceil(level / DECREE_LEVEL_DIVISOR));
}

/** Poloviční základ zaokrouhlený nahoru (DESIGN 8.2: „Poloviční hodnoty se zaokrouhlují nahoru.“). */
function halfBase(base: { chips: number; mult: number }): { chips: number; mult: number } {
  return { chips: Math.ceil(base.chips / 2), mult: Math.ceil(base.mult / 2) };
}

/**
 * Krajské derby: je karta červená, černá, nebo „nefandí“? Divoká karta patří do všech barev (fandí oběma) a kamenná
 * do žádné — ani jedna stranu nevolí.
 */
function derbySide(ctx: BossCtx, card: Card): 'red' | 'black' | null {
  const red = ctx.api.hasSuit(card, 'H') || ctx.api.hasSuit(card, 'D');
  const black = ctx.api.hasSuit(card, 'S') || ctx.api.hasSuit(card, 'C');
  if (red === black) return null;
  return red ? 'red' : 'black';
}

/** Hraje se v ruce červená i černá karta? */
function isMixedHand(ctx: BossCtx & ScoringInfo): boolean {
  let red = false;
  let black = false;
  for (const card of ctx.played) {
    const side = derbySide(ctx, card);
    if (side === 'red') red = true;
    else if (side === 'black') black = true;
  }
  return red && black;
}

/**
 * Nejčastěji hraná kombinace v runu (`handLevels[*].played`); při shodě ta silnější (pozdější v `HAND_TYPES`).
 * Když se v runu ještě nic nehrálo, null.
 */
export function mostPlayedHand(ctx: BossCtx): HandType | null {
  let best: HandType | null = null;
  let bestCount = 0;
  for (const type of HAND_TYPES) {
    const count = ctx.state.handLevels[type]?.played ?? 0;
    if (count > 0 && count >= bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

// ─────────────────────────── Šéfové ───────────────────────────

export const BOSSES_B: BossDef[] = [
  {
    // 14 — Všechny kombinace se v tomto kole počítají na polovině úrovně (nahoru, nejméně 1).
    id: 'new_decree',
    minAnte: 3,
    targetMult: DECREE_TARGET_MULT,
    params: { divisor: DECREE_LEVEL_DIVISOR },
    color: '#5b6b8c',
    hooks: {
      modifyBase: (ctx) =>
        ctx.api.handBase(ctx.hand.type, decreeLevel(ctx.state.handLevels[ctx.hand.type]?.level ?? 1)),
    },
    art: { icon: 'scroll-unfurled', prop: 'gavel', bg: '#2b2f3a', fg: '#e8e2c9', pattern: 'grid' },
  },
  {
    // 15 — Vyšší cíl (3× místo 2×), žádné další pravidlo.
    id: 'binder_tower',
    minAnte: 2,
    targetMult: BINDER_TARGET_MULT,
    params: { target: BINDER_TARGET_MULT, normal: NORMAL_TARGET_MULT },
    color: '#8a6a3a',
    hooks: {},
    art: { icon: 'papers', prop: 'stamper', bg: '#3a2f22', fg: '#f2e3c2', pattern: 'stripes' },
  },
  {
    // 16 — Ruka s červenými i černými kartami má poloviční základní čipy i mult.
    id: 'regional_derby',
    minAnte: 2,
    targetMult: DERBY_TARGET_MULT,
    color: '#b03a48',
    hooks: {
      modifyBase: (ctx, base) => (isMixedHand(ctx) ? halfBase(base) : base),
    },
    art: {
      icon: 'crossed-swords',
      prop: 'megaphone',
      bg: '#1f2a44',
      fg: '#f5d6d6',
      accent: '#c0392b',
      pattern: 'checker',
    },
  },
  {
    // 17 — Po každé zahrané ruce se zničí 1 náhodná skórující karta.
    id: 'pig_slaughter',
    minAnte: 3,
    targetMult: SLAUGHTER_TARGET_MULT,
    params: { cards: SLAUGHTER_CARDS },
    color: '#a33b3b',
    hooks: {
      afterHandPlayed: (ctx) => {
        // Karty zničené už během skórování (efekt žolíka) se nepočítají.
        const pool = ctx.scoring.filter((c) => ctx.api.getCard(c.id) !== undefined);
        for (let i = 0; i < SLAUGHTER_CARDS && pool.length > 0; i++) {
          const victim = ctx.rng.pick(pool);
          pool.splice(pool.indexOf(victim), 1);
          ctx.api.destroyCard(victim.id, 'boss');
        }
      },
    },
    art: { icon: 'pig', prop: 'sausage', bg: '#4a1f22', fg: '#f7c6c0', pattern: 'dots' },
  },
  {
    // 18 — Vylepšení hracích karet v tomto kole nefungují.
    id: 'white_mountain',
    minAnte: 3,
    targetMult: WHITE_MOUNTAIN_TARGET_MULT,
    color: '#9aa3b5',
    hooks: {
      passive: () => ({ disableEnhancements: true }),
    },
    art: { icon: 'mountains', prop: 'broadsword', bg: '#2e3440', fg: '#f0f0f0', pattern: 'rays' },
  },
  {
    // 19 — Každá skórující karta dává právě 5 čipů (vylepšení a edice fungují).
    id: 'normalization',
    minAnte: 2,
    targetMult: NORMALIZATION_TARGET_MULT,
    params: { chips: NORMALIZATION_CHIPS },
    color: '#7d7d7d',
    hooks: {
      passive: () => ({ fixedCardChips: NORMALIZATION_CHIPS }),
    },
    art: { icon: 'factory', prop: 'post-stamp', bg: '#3b3b3b', fg: '#c9c9c9', pattern: 'grid' },
  },
  {
    // 20 — Žolíci v pravé polovině řady nefungují (při lichém počtu prostřední funguje); platí i po přeřazení.
    id: 'one_eyed_hetman',
    minAnte: 3,
    targetMult: HETMAN_TARGET_MULT,
    color: '#8b6f2e',
    hooks: {
      isJokerDebuffed: (ctx, _joker, index) => index >= Math.ceil(ctx.state.jokers.length / 2),
    },
    art: { icon: 'eyepatch', prop: 'flail', bg: '#2d2a1f', fg: '#e6d3a3', pattern: 'zigzag' },
  },
  {
    // 21 — Každé zahození ti navíc zahodí 1 náhodnou kartu z ruky (dobírá se normálně).
    id: 'mother_in_law',
    minAnte: 1,
    targetMult: MOTHER_IN_LAW_TARGET_MULT,
    params: { cards: MOTHER_IN_LAW_CARDS },
    color: '#9c5b8a',
    hooks: {
      onDiscard: (ctx) => {
        // Zahazované karty už v ruce nejsou (engine je vyřadí před hooky) — bere se jen ze zbytku ruky.
        for (let i = 0; i < MOTHER_IN_LAW_CARDS; i++) {
          const hand = ctx.api.handCards();
          if (hand.length === 0) return;
          ctx.api.discardFromHand(ctx.rng.pick(hand).id);
        }
      },
    },
    art: { icon: 'cake-slice', prop: 'magnifying-glass', bg: '#3d2b3d', fg: '#f3d9e8', pattern: 'dots' },
  },
  {
    // 22 — Nejčastěji hraná kombinace runu má v tomto kole poloviční základní čipy i mult.
    id: 'influencer',
    minAnte: 2,
    targetMult: INFLUENCER_TARGET_MULT,
    color: '#d0508f',
    hooks: {
      // Kombinace se vybere jednou na začátku kola (během kola se nemění, i když se počty srovnají).
      onRoundStart: (ctx) => {
        const hand = mostPlayedHand(ctx);
        if (hand) ctx.round.flags[INFLUENCER_FLAG] = hand;
      },
      modifyBase: (ctx, base) => (ctx.round.flags[INFLUENCER_FLAG] === ctx.hand.type ? halfBase(base) : base),
    },
    art: {
      icon: 'smartphone',
      prop: 'thumb-down',
      bg: '#2a1f3d',
      fg: '#ffd1f0',
      accent: '#ff5fa2',
      pattern: 'rays',
    },
  },
  {
    // 23 — −1 ruka.
    id: 'hangover',
    minAnte: 1,
    params: { hands: HANGOVER_HANDS },
    color: '#6f8f4f',
    hooks: {
      passive: () => ({ hands: -HANGOVER_HANDS }),
    },
    art: { icon: 'broken-bottle', prop: 'glass-shot', bg: '#2f3b2a', fg: '#d8e8c8', pattern: 'waves' },
  },
  {
    // 24 — Žolíci nefungují v první ruce kola (ani při zahazování před ní).
    id: 'blackout',
    minAnte: 1,
    targetMult: BLACKOUT_TARGET_MULT,
    color: '#3b3f4a',
    hooks: {
      isJokerDebuffed: (ctx) => ctx.round.handsPlayed === 0,
    },
    art: { icon: 'light-bulb', prop: 'candle-light', bg: '#111318', fg: '#f3e27a', pattern: 'none' },
  },
  {
    // 25 — Liché karty (A, 3, 5, 7, 9) jsou mimo provoz; figury ani kamenné karty liché nejsou.
    id: 'even_days',
    minAnte: 1,
    targetMult: EVEN_DAYS_TARGET_MULT,
    color: '#4f7a96',
    hooks: {
      isCardDebuffed: (ctx, card) => {
        const rank = ctx.api.cardRank(card);
        return rank !== null && ODD_RANKS.includes(rank);
      },
    },
    art: { icon: 'calendar', prop: 'city-car', bg: '#26313b', fg: '#cfe3f0', pattern: 'stripes' },
  },
];
