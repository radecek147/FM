/**
 * Startovní balíčky (docs/DESIGN.md kap. 9) — všech 12 v pořadí tabulky (= pořadí v menu).
 * Texty v src/i18n/cs/decks.ts (`decks.<id>.name|desc|flavor`, `{param}` = hodnoty z `params`; hlášky
 * Kalendářového `decks.almanac.made|full`). Návod: docs/CONTENT-GUIDE.md.
 */
import type { BaseCtx, CardSpec, DeckDef, JokerRarity, Rng } from '../engine/content-types';
import { standardDeckSpecs } from '../engine/cards/cards';
import type { HandType, Rank } from '../engine/types';
import { HAND_TYPES, RANKS, SUITS } from '../engine/types';
import { SEALS } from './modifiers';
import { RADY } from './rady';

/** Štamgastův: sloty žolíků navíc a startovní peníze. */
export const REGULARS_JOKER_SLOTS = 1;
export const REGULARS_STARTING_MONEY = 0;
/** Turistický: Postupka i Barva ze 4 karet, cíle ×1,2. */
export const TOURIST_CARDS = 4;
export const TOURIST_TARGET_MULT = 1.2;
/**
 * Mariášový: hodnoty 7–A; cíle ×1,2. Bez cílů navíc bot s 32 kartami vyhrával 60 % proti 34 % Hospodského (v malém
 * balíčku chodí Barva i Postupka skoro samy); s ×1,2 ~40 % (DECISIONS 2026-10-02 „Balanc po fázi 7“).
 */
export const MARIAS_LOWEST_RANK: Rank = 7;
export const MARIAS_TARGET_MULT = 1.2;
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
/**
 * Úřednický: startovní kupóny (Trhací kalendář, Kamarád za pultem). Dřív Žlutá cenovka (sleva 20 %) + Trhací
 * kalendář — bot s nimi vyhrával 66,5 % proti 34 % Hospodského (sleva od prvního nákupu je nejsilnější ekonomika);
 * s Kamarádem za pultem 34,5 %, v rozmezí ostatních balíčků (DECISIONS 2026-10-02 „Balanc po fázi 7“).
 */
export const CLERK_VOUCHERS: readonly string[] = ['tear_calendar', 'counter_buddy'];
/** Babiččin: +1 slot spotřebky, start se 2 různými náhodnými babskými radami. */
export const GRANDMAS_CONSUMABLE_SLOTS = 1;
export const GRANDMAS_RADY = 2;
/** Vetešnický: start s 1 náhodným vzácným žolíkem; Večerka má o 1 kartový slot méně. */
export const JUNK_SHOP_RARITY: JokerRarity = 'rare';
export const JUNK_SHOP_SHOP_SLOTS = -1;
/** Kalendářový: po porážce šéfa pranostika nejčastěji hrané kombinace, bez místa peníze; −1 zahození. */
export const ALMANAC_FULL_MONEY = 2;
export const ALMANAC_DISCARDS = -1;
/** Kalendářový bez jediné zahrané ruky (šéf poražený bez skórování) — pranostika Vysoké karty. */
const ALMANAC_FALLBACK_HAND: HandType = 'high_card';
const MSG_ALMANAC_MADE = 'decks.almanac.made';
const MSG_ALMANAC_FULL = 'decks.almanac.full';

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

/**
 * Babiččin: vytvoří `GRANDMAS_RADY` **různých** babských rad (vážený los podle `ConsumableDef.weight` jako v obchodě,
 * bez `noShop`). Pořadí kandidátů podle id — los nezávisí na pořadí v souboru s radami.
 */
function grandmasAdvice(ctx: BaseCtx): void {
  const pool = RADY.filter((d) => !d.noShop && (d.weight ?? 1) > 0).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (let i = 0; i < GRANDMAS_RADY && pool.length > 0; i++) {
    const def = ctx.rng.weighted(pool.map((d) => ({ item: d, weight: d.weight ?? 1 })));
    pool.splice(pool.indexOf(def), 1);
    ctx.api.createConsumable({ defId: def.id });
  }
}

/**
 * Kalendářový: nejčastěji hraná kombinace runu (`handLevels.played`); při shodě silnější (stejné pravidlo jako
 * babská rada Rosnička), bez zahrané ruky Vysoká karta. Tajná kombinace sem přijde, jen když ji hráč zahrál.
 */
export function almanacHand(ctx: BaseCtx): HandType {
  let best = ALMANAC_FALLBACK_HAND;
  let bestCount = 0;
  // HAND_TYPES jde od nejslabší po nejsilnější, takže `>=` při shodě vybere silnější.
  for (const hand of HAND_TYPES) {
    const played = ctx.state.handLevels[hand]?.played ?? 0;
    if (played > 0 && played >= bestCount) {
      best = hand;
      bestCount = played;
    }
  }
  return best;
}

/** Kalendářový po porážce šéfa: pranostika nejčastěji hrané kombinace, bez volného slotu `ALMANAC_FULL_MONEY` Kč. */
function almanacBossDefeated(ctx: BaseCtx): void {
  if (ctx.api.createConsumable({ forHand: almanacHand(ctx) })) {
    ctx.api.message(MSG_ALMANAC_MADE);
  } else {
    ctx.api.addMoney(ALMANAC_FULL_MONEY, 'deck');
    ctx.api.message(MSG_ALMANAC_FULL, { money: ALMANAC_FULL_MONEY });
  }
}

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
    id: 'clerk',
    startingVouchers: [...CLERK_VOUCHERS],
    art: { icon: 'papers', bg: '#334155', fg: '#f1f5f9', accent: '#c0392b', pattern: 'grid' },
    unlock: { type: 'custom', id: 'vouchersBought5' },
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
    passive: () => ({ targetMult: MARIAS_TARGET_MULT }),
    params: { cards: ranksFrom(MARIAS_LOWEST_RANK).length, target: MARIAS_TARGET_MULT },
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
  {
    id: 'grandmas',
    passive: () => ({ consumableSlots: GRANDMAS_CONSUMABLE_SLOTS }),
    onRunStart: grandmasAdvice,
    params: { slots: GRANDMAS_CONSUMABLE_SLOTS, rady: GRANDMAS_RADY },
    art: { icon: 'spectacles', bg: '#6b3a4a', fg: '#fdf2f8', accent: '#f9a8d4', pattern: 'dots' },
    unlock: { type: 'custom', id: 'radyUsed30' },
  },
  {
    id: 'junk_shop',
    passive: () => ({ shopCardSlots: JUNK_SHOP_SHOP_SLOTS }),
    onRunStart: (ctx) => {
      ctx.api.createJoker({ rarity: JUNK_SHOP_RARITY });
    },
    params: { slots: -JUNK_SHOP_SHOP_SLOTS },
    art: { icon: 'old-lantern', bg: '#4a3b2a', fg: '#fef3c7', accent: '#a3a3a3', pattern: 'checker' },
    unlock: { type: 'custom', id: 'jokersSold25' },
  },
  {
    id: 'almanac',
    passive: () => ({ discards: ALMANAC_DISCARDS }),
    onBossDefeated: almanacBossDefeated,
    params: { money: ALMANAC_FULL_MONEY, discards: -ALMANAC_DISCARDS },
    art: { icon: 'calendar', bg: '#1f4e5f', fg: '#ecfeff', accent: '#facc15', pattern: 'rays' },
    unlock: { type: 'custom', id: 'handLevel6' },
  },
];
