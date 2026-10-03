/**
 * Šéfové — fináloví šéfové F1–F5 (docs/DESIGN.md kap. 8.3): jen v patře 8 a v každém 8. patře nekonečného režimu.
 * Texty v src/i18n/cs/bosses/final.ts, testy v tests/unit/bosses-final.test.ts. Návod: docs/CONTENT-GUIDE.md kap. 4.
 *
 * Čísla pravidel jsou jen v konstantách níže — čte je hook i `params` a text (`rule`) je dosazuje přes `{param}`.
 * Per-kolo stav šéfa žije v `round.flags` (klíče s předponou id šéfa, ARCHITECTURE 2.7), aby přežil uložení a načtení
 * a skončil s kolem.
 */
import type { BossCtx, BossDef } from '../../engine/content-types';

// ─────────────────────────── Čísla ───────────────────────────

/**
 * Fronta na banány: násobek základního cíle patra. Fáze 10: 4,5 → 3,5 — s cíli patra 8 fáze 10 a silnějšími boty
 * letalita 55 % (pásmo 20–40 %, DECISIONS „Fáze 10: balanc…“).
 */
const BANANA_QUEUE_TARGET_MULT = 3.5;
/**
 * Cíle finálových šéfů laděné simulací na letalitu 20–40 % (docs/DESIGN.md 12.1, DECISIONS „Fáze 6: ladění se
 * šéfy“): Pan starosta, Krajský úřad a Velká voda měli s 2× ~16–19 %, Bílá paní ~35–48 %. Fáze 10: Bílá paní 1,5 → 1,25
 * (letalita 54 %).
 */
const MAYOR_TARGET_MULT = 2.5;
const OFFICE_TARGET_MULT = 2.25;
const FLOOD_TARGET_MULT = 2.5;
const WHITE_LADY_TARGET_MULT = 1.25;
/** Velká voda: o kolik karet se po každé zahrané ruce zmenší ruka (do konce kola). */
const FLOOD_HAND_SIZE = 1;
/** Krajský úřad: kolik fungujících žolíků se po každé ruce vypne. */
const OFFICE_JOKERS = 1;

/** Klíče `round.flags`. */
export const MAYOR_FLAG = 'mayor.lastScore';
export const FLOOD_FLAG = 'great_flood.hands';

/** Číslo z `round.flags` (chybí-li, 0). */
function flagNumber(ctx: BossCtx, key: string): number {
  const v = ctx.round.flags[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Bílá paní: všechny karty v ruce lícem dolů a zamíchat (karty dobrané potom přijdou lícem nahoru). */
function hauntHand(ctx: BossCtx): void {
  for (const card of ctx.api.handCards()) ctx.api.setCardFaceDown(card.id, true);
  ctx.api.shuffleHand();
}

// ─────────────────────────── Šéfové ───────────────────────────

export const BOSSES_FINAL: BossDef[] = [
  {
    // F1 — Ruka se započítá, jen když má vyšší skóre než předchozí ruka v tomto kole (první vždy).
    id: 'mayor',
    final: true,
    targetMult: MAYOR_TARGET_MULT,
    color: '#b8860b',
    hooks: {
      // Porovnává se se skutečným skóre předchozí ruky (i když se nezapočítalo) — „lepší než minule“.
      adjustHandScore: (ctx, score) => {
        const hasPrevious = Object.hasOwn(ctx.round.flags, MAYOR_FLAG);
        const previous = flagNumber(ctx, MAYOR_FLAG);
        ctx.round.flags[MAYOR_FLAG] = score;
        return !hasPrevious || score > previous ? score : 0;
      },
      // UI: „Překonej: X“ a varování v náhledu (src/ui/screens/game/sidebar.ts).
      scoreToBeat: (ctx) => (Object.hasOwn(ctx.round.flags, MAYOR_FLAG) ? flagNumber(ctx, MAYOR_FLAG) : null),
    },
    art: {
      icon: 'top-hat',
      prop: 'megaphone',
      bg: '#3a0f14',
      fg: '#f6d77a',
      accent: '#c9a227',
      pattern: 'rays',
    },
  },
  {
    // F2 — Po každé zahrané ruce se náhodný fungující žolík vypne do konce kola.
    id: 'regional_office',
    final: true,
    targetMult: OFFICE_TARGET_MULT,
    color: '#3e5a8a',
    hooks: {
      afterHandPlayed: (ctx) => {
        for (let i = 0; i < OFFICE_JOKERS; i++) {
          const working = ctx.state.jokers.filter((j) => !j.debuffed);
          if (working.length === 0) return;
          ctx.api.setJokerDebuffed(ctx.rng.pick(working).uid, true);
        }
      },
    },
    art: { icon: 'bank', prop: 'stamper', bg: '#1d2433', fg: '#d7e1f2', pattern: 'grid' },
  },
  {
    // F3 — Vyšší cíl (4,5× místo 2×), žádné další pravidlo.
    id: 'banana_queue',
    final: true,
    targetMult: BANANA_QUEUE_TARGET_MULT,
    params: { target: BANANA_QUEUE_TARGET_MULT },
    color: '#c9a227',
    hooks: {},
    art: { icon: 'hourglass', prop: 'shopping-cart', bg: '#3a3220', fg: '#fde68a', pattern: 'stripes' },
  },
  {
    // F4 — Každá zahraná ruka zmenší velikost ruky o 1 (do konce kola).
    // Přes `passive` z počítadla v `round.flags` (ne `addRoundHandSize`): Odvolání tak šéfa vypne i s celým
    // zmenšením a dočasná velikost ruky z jiných efektů zůstane. Ruka nejmíň 1 karta (`clampModifiers`).
    id: 'great_flood',
    final: true,
    targetMult: FLOOD_TARGET_MULT,
    params: { cards: FLOOD_HAND_SIZE },
    color: '#2a6f9e',
    hooks: {
      passive: (ctx) => ({ handSize: -FLOOD_HAND_SIZE * flagNumber(ctx, FLOOD_FLAG) }),
      afterHandPlayed: (ctx) => {
        ctx.round.flags[FLOOD_FLAG] = flagNumber(ctx, FLOOD_FLAG) + 1;
      },
    },
    art: { icon: 'raining', prop: 'canoe', bg: '#0f2a3d', fg: '#a9d8f5', pattern: 'waves' },
  },
  {
    // F5 — Po každé zahrané ruce i zahození se všechny karty v ruce otočí lícem dolů a zamíchají.
    // Platí pro karty, které v ruce zůstaly; nově dobrané přijdou lícem nahoru (hráč si musí pamatovat, co držel).
    id: 'white_lady',
    final: true,
    targetMult: WHITE_LADY_TARGET_MULT,
    color: '#cfd8ea',
    hooks: {
      afterHandPlayed: hauntHand,
      onDiscard: hauntHand,
    },
    art: { icon: 'ghost', prop: 'castle', bg: '#141a26', fg: '#f4f6ff', pattern: 'none' },
  },
];
