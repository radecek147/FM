/**
 * Startovní balíčky (docs/DESIGN.md kap. 9). Zatím jen ty, které stačí vyjádřit modifikátory, startovními penězi
 * a vlastním složením karet; balíčky se startovními kupóny, spotřebkami a žolíky (Úřednický, Babiččin, Vetešnický,
 * Kalendářový) přijdou ve fázi 7 spolu s obsahem, na kterém stojí.
 * Texty v src/i18n/cs/decks.ts (`decks.<id>.name|desc|flavor`, `{param}` = hodnoty z `params`).
 * Návod: docs/CONTENT-GUIDE.md.
 */
import type { CardSpec, DeckDef, Rng } from '../engine/content-types';
import { standardDeckSpecs } from '../engine/cards/cards';
import type { Rank } from '../engine/types';
import { RANKS, SUITS } from '../engine/types';
import { SEALS } from './modifiers';

/** Štamgastův: sloty žolíků navíc a startovní peníze. */
export const REGULARS_JOKER_SLOTS = 1;
export const REGULARS_STARTING_MONEY = 0;
/** Turistický: Postupka i Barva ze 4 karet, cíle ×1,2. */
export const TOURIST_CARDS = 4;
export const TOURIST_TARGET_MULT = 1.2;
/** Mariášový: hodnoty 7–A. */
export const MARIAS_LOWEST_RANK: Rank = 7;
/** Obrázkový: J, Q, K, A, každá karta 2×; −1 karta v ruce; cíle ×1,5. */
export const COURT_LOWEST_RANK: Rank = 11;
export const COURT_COPIES = 2;
export const COURT_HAND_SIZE = -1;
export const COURT_TARGET_MULT = 1.5;
/** Notářský: šance na náhodnou pečeť u každé karty; −1 slot spotřebky. */
export const NOTARY_SEAL_CHANCE = 0.25;
export const NOTARY_CONSUMABLE_SLOTS = -1;
/** Zbohatlík: odměny za útraty a úrok ×2, nevyužitá ruka +1 Kč navíc, −2 ruce. */
export const RICH_REWARD_MULT = 2;
export const RICH_UNUSED_HAND_BONUS = 1;
export const RICH_HANDS = -2;
/** Dlužník: start −10 Kč, dluh až do −20 Kč, úrok ×2 (jen z kladného zůstatku — to hlídá engine). */
export const DEBTOR_STARTING_MONEY = -10;
export const DEBTOR_DEBT_LIMIT = 20;
export const DEBTOR_INTEREST_MULT = 2;

/** Karty všech čtyř barev od hodnoty `lowest` po eso, každá `copies`×. */
function ranksFrom(lowest: Rank, copies = 1): CardSpec[] {
  const out: CardSpec[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (rank >= lowest) for (let i = 0; i < copies; i++) out.push({ suit, rank });
  return out;
}

/** Id pečetí v pevném pořadí (losování nesmí záviset na pořadí v registru). */
const SEAL_IDS = SEALS.map((s) => s.id).sort();

/** Notářský: standardních 52 karet, každá s šancí `NOTARY_SEAL_CHANCE` na náhodnou pečeť (druhy rovnoměrně). */
function notaryDeck(rng: Rng): CardSpec[] {
  return standardDeckSpecs().map((spec) =>
    rng.next() < NOTARY_SEAL_CHANCE ? { ...spec, seal: rng.pick(SEAL_IDS) } : spec,
  );
}

const pct = (p: number): number => Math.round(p * 100);

export const DECKS: DeckDef[] = [
  {
    id: 'pub',
    params: { cards: 52 },
    art: { icon: 'tavern-sign', bg: '#5b3a1e', fg: '#f6e7c8', accent: '#c8963e', pattern: 'checker' },
  },
  {
    id: 'regulars',
    startingMoney: REGULARS_STARTING_MONEY,
    passive: () => ({ jokerSlots: REGULARS_JOKER_SLOTS }),
    params: { slots: REGULARS_JOKER_SLOTS, money: REGULARS_STARTING_MONEY },
    art: { icon: 'mustache', bg: '#3b2f2f', fg: '#f3e9dc', accent: '#b07d4f', pattern: 'stripes' },
  },
  {
    id: 'tourist',
    passive: () => ({ fourCardStraightFlush: true, targetMult: TOURIST_TARGET_MULT }),
    params: { cards: TOURIST_CARDS, target: TOURIST_TARGET_MULT },
    art: { icon: 'mountains', bg: '#2f6b4f', fg: '#eafaf1', accent: '#d64545', pattern: 'zigzag' },
    unlock: { type: 'playHand', hand: 'straight', count: 25 },
  },
  {
    id: 'marias',
    buildDeck: () => ranksFrom(MARIAS_LOWEST_RANK),
    params: { cards: ranksFrom(MARIAS_LOWEST_RANK).length },
    art: { icon: 'card-random', bg: '#14532d', fg: '#ecfdf5', accent: '#facc15', pattern: 'grid' },
    unlock: { type: 'playHand', hand: 'four' },
  },
  {
    id: 'court',
    buildDeck: () => ranksFrom(COURT_LOWEST_RANK, COURT_COPIES),
    passive: () => ({ handSize: COURT_HAND_SIZE, targetMult: COURT_TARGET_MULT }),
    params: {
      cards: ranksFrom(COURT_LOWEST_RANK, COURT_COPIES).length,
      copies: COURT_COPIES,
      hand: -COURT_HAND_SIZE,
      target: COURT_TARGET_MULT,
    },
    art: { icon: 'king', bg: '#4c1d95', fg: '#f5f3ff', accent: '#fbbf24', pattern: 'rays' },
    unlock: { type: 'winRun', deck: 'marias' },
  },
  {
    id: 'notary',
    buildDeck: notaryDeck,
    passive: () => ({ consumableSlots: NOTARY_CONSUMABLE_SLOTS }),
    params: { chance: pct(NOTARY_SEAL_CHANCE), slots: -NOTARY_CONSUMABLE_SLOTS },
    art: { icon: 'stamper', bg: '#1e3a5f', fg: '#e8f0fb', accent: '#c0392b', pattern: 'dots' },
    unlock: { type: 'custom', id: 'sealedCardsInRun' },
  },
  {
    id: 'nouveau_riche',
    passive: () => ({
      blindRewardMult: RICH_REWARD_MULT,
      interestMult: RICH_REWARD_MULT,
      moneyPerUnusedHand: RICH_UNUSED_HAND_BONUS,
      hands: RICH_HANDS,
    }),
    params: { reward: RICH_REWARD_MULT, hand: RICH_UNUSED_HAND_BONUS, hands: -RICH_HANDS },
    art: { icon: 'money-stack', bg: '#14532d', fg: '#f0fdf4', accent: '#eab308', pattern: 'stripes' },
    unlock: { type: 'haveMoney', atLeast: 50 },
  },
  {
    id: 'debtor',
    startingMoney: DEBTOR_STARTING_MONEY,
    passive: () => ({ debtLimit: DEBTOR_DEBT_LIMIT, interestMult: DEBTOR_INTEREST_MULT }),
    params: { money: DEBTOR_STARTING_MONEY, debt: DEBTOR_DEBT_LIMIT, interest: DEBTOR_INTEREST_MULT },
    art: { icon: 'battle-axe', bg: '#3f1d1d', fg: '#fde8e8', accent: '#9ca3af', pattern: 'waves' },
    unlock: { type: 'custom', id: 'roundEndInDebt' },
  },
];
