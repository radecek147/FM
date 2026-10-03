/**
 * Štítky za přeskočení útraty (docs/DESIGN.md kap. 7): 20 štítků. Texty v src/i18n/cs/tags.ts
 * (`tags.<id>.name|desc|flavor`). Návod: docs/CONTENT-GUIDE.md kap. 7.
 *
 * Každý hook vrací true, když se štítek tím spotřeboval. Kdy se co děje:
 *  - „hned“ = `onAdded` (peníze, obálka zdarma přes `api.openBooster` — engine ji otevře hned po přeskočení),
 *  - „příští Večerka“ = `onShopEnter` první Večerky po získání (nabídka je už vygenerovaná, štítek ji upraví přes
 *    `api.addShopJoker` / `setShopJokerEdition` / `addShopVoucher` / `addFreeRerolls`),
 *  - „příští kolo“ = `onRoundStart` prvního kola po získání,
 *  - „po šéfovi / v kole šéfa“ = podle `ctx.state.round.blind`.
 * Štítky se hromadí (i stejné) — každý působí sám za sebe. Čísla jsou jen v konstantách níže; mechanika i popisek
 * (`params`) čtou stejné hodnoty. Náhoda jen přes `ctx.rng` (stream `tag`).
 *
 * 1.0.1 (docs/DECISIONS.md 2026-10-03): sedm štítků s vlastní mechanikou místo převzaté — Pouťová tombola
 * (legendární žolík), Půjčka od tchána, Sběr papíru, Brigáda na chmelu (výplata za další kola), Dožínky, Stěhování
 * a Houbaření; peněžní štítky dávají zhruba dvojnásobek (Drobné v kabátě 12 Kč).
 */
import type { TagCtx, TagDef } from '../engine/content-types';
import type { Card, EditionId, HandType, RunState } from '../engine/types';
import { HAND_TYPES } from '../engine/types';
import { boosterId } from './boosters';

// ─────────────────────────── Čísla (DESIGN 7) ───────────────────────────

/** 1 Drobné v kabátě: Kč hned (1.0.1: 6 → 12 — přeskočení se má vyplatit). */
const COAT_CHANGE_MONEY = 12;
/** 2 Pouťová tombola: od patra, Kč útěchy, když legendární žolík nejde vytvořit (plné sloty, prázdný pool). */
const RAFFLE_MIN_ANTE = 4;
const RAFFLE_MONEY = 12;
/** 3 Půjčka od tchána: Kč hned a kolik se strhne z odměny po porážce šéfa tohoto patra. */
const LOAN_MONEY = 20;
const LOAN_REPAY = 15;
/** 4 Sběr papíru: kolik karet s nejnižší hodnotou (bez vylepšení, pečeti a edice) zničí, Kč za každou. */
const PAPER_CARDS = 3;
const PAPER_MONEY = 3;
/** 5 Otevřené dveře: přehození zdarma v příští Večerce. */
const OPEN_DOORS_REROLLS = 3;
/** 7 Dožínky: úrovně navíc a kolikrát se kombinace v runu musela hrát. */
const HARVEST_LEVELS = 1;
const HARVEST_PLAYS = 3;
/** 9 Stěhování: od patra; slot žolíka navíc, slot spotřebky méně (do konce runu). */
const MOVING_MIN_ANTE = 2;
const MOVING_JOKER_SLOTS = 1;
const MOVING_CONSUMABLE_SLOTS = 1;
/** 10 Houbaření: kolik kopií náhodné karty z balíčku přidá. */
const MUSHROOM_COPIES = 2;
/** 12 Brigáda na chmelu: Kč v rozpisu odměn za každé z příštích vyhraných kol (2 kola — po přeskočení Malé do konce patra). */
const HOP_MONEY = 6;
const HOP_ROUNDS = 2;
/** 11 Vyleštěné příbory: šance edicí v % (součet 100). */
const CUTLERY_EDITIONS: readonly { edition: EditionId; pct: number }[] = [
  { edition: 'foil', pct: 55 },
  { edition: 'holo', pct: 30 },
  { edition: 'poly', pct: 15 },
];
/** 13 Doporučení od známého: násobek ceny vzácného žolíka (poloviční cena). */
const REFERRAL_PRICE_MULT = 0.5;
/** 15 Leták ve schránce: kupónů navíc. */
const FLYER_VOUCHERS = 1;
/** 16 Šéf má chřipku: o kolik % je cíl šéfa nižší. */
const BOSS_FLU_PCT = 25;
/** 17 Rozložené noviny: karty v ruce a zahození navíc v příštím kole. */
const NEWSPAPER_HAND_SIZE = 2;
const NEWSPAPER_DISCARDS = 1;
/** 18 Předpověď počasí: úrovně navíc; kombinace, když se v runu ještě nic nehrálo. */
const FORECAST_LEVELS = 2;
const FORECAST_DEFAULT_HAND: HandType = 'high_card';
/** 19 Lékařské potvrzení: kolik % cíle stačí k záchraně kola. */
const SICK_NOTE_PCT = 50;
/** 20 Bazar u silnice: Kč místo žolíka, když není volný slot (1.0.1: 4 → 8). */
const BAZAAR_MONEY = 8;

// ─────────────────────────── Pomocníci ───────────────────────────

/** Obálka zdarma, otevře se hned (DESIGN 7: „hned“). */
function freeBooster(id: string): TagDef['hooks'] {
  return {
    onAdded: (ctx) => {
      ctx.api.openBooster(id);
      return true;
    },
  };
}

/**
 * Nejčastěji hraná kombinace v runu (`handLevels[*].played`); při shodě silnější (pozdější v `HAND_TYPES`), bez
 * zahraných rukou `FORECAST_DEFAULT_HAND` (DESIGN 7, Předpověď počasí — stejné pravidlo jako Influencerka Nikča).
 */
export function forecastHand(state: Readonly<RunState>): HandType {
  let best: HandType = FORECAST_DEFAULT_HAND;
  let bestCount = 0;
  for (const type of HAND_TYPES) {
    const count = state.handLevels[type]?.played ?? 0;
    if (count > 0 && count >= bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/** Náhodná edice Vyleštěných příborů podle vah (stream `tag`). */
function cutleryEdition(ctx: TagCtx): EditionId {
  return ctx.rng.weighted(CUTLERY_EDITIONS.map((e) => ({ item: e.edition, weight: e.pct })));
}

/**
 * „Příští žolík ve Večerce“ dostane edici bez příplatku: první neprodaný žolík bez edice v nabídce; když tam žádný
 * není, přibude žolík navíc s touto edicí (štítek nepropadne naprázdno — docs/DECISIONS.md).
 */
function editionForNextShopJoker(ctx: TagCtx, edition: EditionId): void {
  if (!ctx.api.setShopJokerEdition(edition, { noSurcharge: true }))
    ctx.api.addShopJoker({ edition, noEditionSurcharge: true });
}

/** Lékařské potvrzení: platí až od začátku příštího kola (štítek získaný uprostřed kola čeká na další). */
const ARMED = 'armed';
/** Brigáda na chmelu: kolik vyhraných kol s výplatou zbývá. */
const LEFT = 'left';

/** Hlášky štítků (i18n klíče). */
const MSG_RAFFLE = 'tags.fair_raffle.won';

/**
 * Sběr papíru: karty balíčku bez vylepšení, pečeti a edice, od nejnižší hodnoty (při shodě nižší id) — nejvýš
 * `PAPER_CARDS`.
 */
function scrapCards(state: Readonly<RunState>): Card[] {
  return state.deck
    .filter((c) => c.enhancement === null && c.seal === null && c.edition === null)
    .sort((x, y) => x.rank - y.rank || x.id - y.id)
    .slice(0, PAPER_CARDS);
}

/** Číslo ze stavu štítku (chybí-li, `fallback`). */
function tagNum(ctx: TagCtx, key: string, fallback: number): number {
  const v = ctx.self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ─────────────────────────── Štítky ───────────────────────────

export const TAGS: TagDef[] = [
  {
    // 1 — +12 Kč, hned.
    id: 'coat_change',
    params: { money: COAT_CHANGE_MONEY },
    hooks: {
      onAdded: (ctx) => {
        ctx.api.addMoney(COAT_CHANGE_MONEY, 'tag');
        return true;
      },
    },
    art: { icon: 'wallet', prop: 'coins', bg: '#3a2a14', fg: '#f7e7c3', accent: '#e0b84f', pattern: 'waves' },
  },
  {
    // 2 — Pouťová tombola (od patra 4): legendární žolík do volného slotu, jinak 12 Kč útěchy. Hlavní zdroj
    // legendárních žolíků vedle razítka Výjimka z vyhlášky (DECISIONS 1.0.1: legendárka zhruba v každém 3.–4. runu).
    id: 'fair_raffle',
    minAnte: RAFFLE_MIN_ANTE,
    params: { money: RAFFLE_MONEY },
    hooks: {
      onAdded: (ctx) => {
        const won =
          ctx.api.availableJokers({ rarity: 'legendary' }).length > 0 &&
          ctx.api.createJoker({ rarity: 'legendary' }) !== null;
        if (won) ctx.api.message(MSG_RAFFLE);
        else ctx.api.addMoney(RAFFLE_MONEY, 'tag');
        return true;
      },
    },
    art: {
      icon: 'ticket',
      prop: 'crown',
      bg: '#5b1f3a',
      fg: '#ffe8f2',
      accent: '#f9c74f',
      pattern: 'rays',
    },
  },
  {
    // 3 — Půjčka od tchána: +20 Kč hned; po porážce šéfa tohoto patra −15 Kč v rozpisu odměn (jen do dluhového
    // limitu — co nejde strhnout, tchán odpustí), pak se spotřebuje.
    id: 'in_law_loan',
    params: { money: LOAN_MONEY, repay: LOAN_REPAY },
    hooks: {
      onAdded: (ctx) => {
        ctx.api.addMoney(LOAN_MONEY, 'tag');
        return false;
      },
      roundEndMoney: (ctx) => (ctx.state.round?.blind === 'boss' ? -LOAN_REPAY : 0),
      onRoundEnd: (ctx) => ctx.state.round?.blind === 'boss',
    },
    art: {
      icon: 'receive-money',
      prop: 'mustache',
      bg: '#2b2f45',
      fg: '#eef0ff',
      accent: '#9fb4ff',
      pattern: 'stripes',
    },
  },
  {
    // 4 — Sběr papíru: zničí z balíčku 3 karty s nejnižší hodnotou bez vylepšení, pečeti a edice, za každou 3 Kč.
    id: 'paper_drive',
    params: { cards: PAPER_CARDS, money: PAPER_MONEY },
    hooks: {
      onAdded: (ctx) => {
        const cards = scrapCards(ctx.state);
        for (const c of cards) ctx.api.destroyCard(c.id, 'tag');
        if (cards.length > 0) ctx.api.addMoney(PAPER_MONEY * cards.length, 'tag');
        return true;
      },
    },
    art: {
      icon: 'scroll-unfurled',
      prop: 'wheelbarrow',
      bg: '#3b3a2a',
      fg: '#f5f1dc',
      accent: '#c5b358',
      pattern: 'grid',
    },
  },
  {
    // 5 — V příští Večerce 3 přehození zdarma.
    id: 'open_doors',
    params: { rerolls: OPEN_DOORS_REROLLS },
    hooks: {
      onShopEnter: (ctx) => {
        ctx.api.addFreeRerolls(OPEN_DOORS_REROLLS);
        return true;
      },
    },
    art: {
      icon: 'exit-door',
      prop: 'cycle',
      bg: '#4a2f1c',
      fg: '#fdebd3',
      accent: '#f59e0b',
      pattern: 'rays',
    },
  },
  {
    // 6 — Zdarma Tlustá obálka žolíků.
    id: 'uncle_envelope',
    hooks: freeBooster(boosterId('joker', 'jumbo')),
    art: {
      icon: 'present',
      prop: 'card-joker',
      bg: '#3b1f5c',
      fg: '#f5ecff',
      accent: '#facc15',
      pattern: 'dots',
    },
  },
  {
    // 7 — Dožínky: +1 úroveň každé kombinaci zahrané v runu aspoň 3×; když žádná, nejhranější (bez zahraných rukou
    // Vysoká karta — stejně jako Předpověď počasí).
    id: 'harvest_festival',
    params: { levels: HARVEST_LEVELS, plays: HARVEST_PLAYS },
    hooks: {
      onAdded: (ctx) => {
        const ripe = HAND_TYPES.filter((h) => (ctx.state.handLevels[h]?.played ?? 0) >= HARVEST_PLAYS);
        for (const h of ripe.length > 0 ? ripe : [forecastHand(ctx.state)])
          ctx.api.levelUpHand(h, HARVEST_LEVELS);
        return true;
      },
    },
    art: {
      icon: 'wheat',
      prop: 'beer-stein',
      bg: '#5a4a1a',
      fg: '#fff6d5',
      accent: '#e9c46a',
      pattern: 'zigzag',
    },
  },
  {
    // 8 — Zdarma Tlustá obálka babských rad.
    id: 'grandma_parcel',
    hooks: freeBooster(boosterId('rada', 'jumbo')),
    art: {
      icon: 'cake-slice',
      prop: 'scroll-unfurled',
      bg: '#36502c',
      fg: '#f3f9e6',
      accent: '#fcd34d',
      pattern: 'checker',
    },
  },
  {
    // 9 — Stěhování (od patra 2): +1 slot žolíka a −1 slot spotřebky do konce runu (spotřebky nad limit zůstanou).
    id: 'moving_day',
    minAnte: MOVING_MIN_ANTE,
    params: { joker: MOVING_JOKER_SLOTS, consumable: MOVING_CONSUMABLE_SLOTS },
    hooks: {
      onAdded: (ctx) => {
        ctx.api.addPermanentModifier({
          jokerSlots: MOVING_JOKER_SLOTS,
          consumableSlots: -MOVING_CONSUMABLE_SLOTS,
        });
        return true;
      },
    },
    art: {
      icon: 'house',
      prop: 'old-wagon',
      bg: '#3d2b1f',
      fg: '#f8ead8',
      accent: '#d4a373',
      pattern: 'stripes',
    },
  },
  {
    // 10 — Houbaření: 2 kopie náhodné karty z balíčku (stream `tag`), i s vylepšením, pečetí a edicí.
    id: 'mushroom_hunt',
    params: { copies: MUSHROOM_COPIES },
    hooks: {
      onAdded: (ctx) => {
        const deck = [...ctx.state.deck].sort((x, y) => x.id - y.id);
        if (deck.length === 0) return true;
        const found = ctx.rng.pick(deck);
        for (let i = 0; i < MUSHROOM_COPIES; i++) ctx.api.copyCard(found.id);
        return true;
      },
    },
    art: {
      icon: 'mushroom',
      prop: 'pine-tree',
      bg: '#2d3b22',
      fg: '#f1f7e0',
      accent: '#d97706',
      pattern: 'dots',
    },
  },
  {
    // 11 — Příští žolík ve Večerce dostane náhodnou edici (55/30/15 %) bez příplatku.
    id: 'polished_cutlery',
    params: Object.fromEntries(CUTLERY_EDITIONS.map((e) => [e.edition, e.pct])),
    hooks: {
      onShopEnter: (ctx) => {
        editionForNextShopJoker(ctx, cutleryEdition(ctx));
        return true;
      },
    },
    art: {
      icon: 'sparkles',
      prop: 'wine-glass',
      bg: '#2c3440',
      fg: '#f1f5f9',
      accent: '#c0c7d1',
      pattern: 'rays',
    },
  },
  {
    // 12 — Brigáda na chmelu (1.0.1 nová mechanika): další 2 vyhraná kola +6 Kč v rozpisu odměn, pak se spotřebuje.
    id: 'hop_picking',
    params: { money: HOP_MONEY, rounds: HOP_ROUNDS },
    hooks: {
      onAdded: (ctx) => {
        ctx.self.state[LEFT] = HOP_ROUNDS;
        return false;
      },
      roundEndMoney: (ctx) => (tagNum(ctx, LEFT, HOP_ROUNDS) > 0 ? HOP_MONEY : 0),
      onRoundEnd: (ctx) => {
        const left = tagNum(ctx, LEFT, HOP_ROUNDS) - 1;
        ctx.self.state[LEFT] = left;
        return left <= 0;
      },
    },
    art: {
      icon: 'linden-leaf',
      prop: 'beer-stein',
      bg: '#2f4a1f',
      fg: '#eef8d8',
      accent: '#c5e86c',
      pattern: 'zigzag',
    },
  },
  {
    // 13 — V příští Večerce navíc slot se vzácným žolíkem za poloviční cenu (o 50 % levněji).
    id: 'referral',
    params: { pct: Math.round((1 - REFERRAL_PRICE_MULT) * 100) },
    hooks: {
      onShopEnter: (ctx) => {
        ctx.api.addShopJoker({ rarity: 'rare', priceMult: REFERRAL_PRICE_MULT });
        return true;
      },
    },
    art: { icon: 'thumb-up', prop: 'hand', bg: '#1e3a5f', fg: '#e0f2fe', accent: '#38bdf8', pattern: 'dots' },
  },
  {
    // 14 — V příští Večerce navíc slot s epickým žolíkem za plnou cenu (od patra 3).
    id: 'connections',
    minAnte: 3,
    hooks: {
      onShopEnter: (ctx) => {
        ctx.api.addShopJoker({ rarity: 'epic' });
        return true;
      },
    },
    art: {
      icon: 'top-hat',
      prop: 'key',
      bg: '#2a1a3a',
      fg: '#f3e8ff',
      accent: '#d8b4fe',
      pattern: 'stripes',
    },
  },
  {
    // 15 — V příští Večerce navíc 1 kupón.
    id: 'mailbox_flyer',
    params: { vouchers: FLYER_VOUCHERS },
    hooks: {
      onShopEnter: (ctx) => {
        for (let i = 0; i < FLYER_VOUCHERS; i++) ctx.api.addShopVoucher();
        return true;
      },
    },
    art: {
      icon: 'papers',
      prop: 'ticket',
      bg: '#3b2f12',
      fg: '#ffe9a8',
      accent: '#facc15',
      pattern: 'zigzag',
    },
  },
  {
    // 16 — Cíl šéfa tohoto patra −25 % (platí i v náhledu výběru útrat), spotřebuje se v kole šéfa.
    id: 'boss_flu',
    params: { pct: BOSS_FLU_PCT },
    hooks: {
      passive: () => ({ bossTargetMult: 1 - BOSS_FLU_PCT / 100 }),
      // Cíl kola už je spočítaný (před `onRoundStart`), štítek se teď smí odebrat.
      onRoundStart: (ctx) => ctx.state.round?.blind === 'boss',
    },
    art: {
      icon: 'king',
      prop: 'snowflake-1',
      bg: '#1d3b4a',
      fg: '#e0f7ff',
      accent: '#7dd3fc',
      pattern: 'dots',
    },
  },
  {
    // 17 — V příštím kole +2 karty v ruce a +1 zahození.
    id: 'spread_newspaper',
    params: { handSize: NEWSPAPER_HAND_SIZE, discards: NEWSPAPER_DISCARDS },
    hooks: {
      onRoundStart: (ctx) => {
        ctx.api.addRoundHandSize(NEWSPAPER_HAND_SIZE);
        ctx.api.addDiscards(NEWSPAPER_DISCARDS);
        return true;
      },
    },
    art: {
      icon: 'newspaper',
      prop: 'card-draw',
      bg: '#33302a',
      fg: '#f5f1e6',
      accent: '#d6c7a1',
      pattern: 'grid',
    },
  },
  {
    // 18 — +2 úrovně nejčastěji hrané kombinace v runu, hned.
    id: 'forecast',
    params: { levels: FORECAST_LEVELS },
    hooks: {
      onAdded: (ctx) => {
        ctx.api.levelUpHand(forecastHand(ctx.state), FORECAST_LEVELS);
        return true;
      },
    },
    art: {
      icon: 'sun',
      prop: 'fluffy-cloud',
      bg: '#1e40af',
      fg: '#fef9c3',
      accent: '#fde047',
      pattern: 'rays',
    },
  },
  {
    // 19 — V příštím kole: pod cílem, ale aspoň 50 % → kolo vyhrané bez odměny za útratu (od patra 2).
    id: 'sick_note',
    minAnte: 2,
    params: { pct: SICK_NOTE_PCT },
    hooks: {
      onRoundStart: (ctx) => {
        ctx.self.state[ARMED] = true;
        return false;
      },
      onRoundLost: (ctx) => ctx.self.state[ARMED] === true && ctx.score * 100 >= ctx.target * SICK_NOTE_PCT,
      // Kolo vyhrané bez potvrzení — „příští kolo“ uplynulo, štítek propadá.
      onRoundEnd: (ctx) => ctx.self.state[ARMED] === true,
    },
    art: {
      icon: 'contract',
      prop: 'quill-ink',
      bg: '#e8eef2',
      fg: '#1f2937',
      accent: '#dc2626',
      pattern: 'none',
    },
  },
  {
    // 20 — Náhodný běžný žolík; bez volného slotu +4 Kč.
    id: 'roadside_bazaar',
    params: { money: BAZAAR_MONEY },
    hooks: {
      onAdded: (ctx) => {
        if (!ctx.api.createJoker({ rarity: 'common' })) ctx.api.addMoney(BAZAAR_MONEY, 'tag');
        return true;
      },
    },
    art: {
      icon: 'old-wagon',
      prop: 'card-joker',
      bg: '#4a3423',
      fg: '#fbe9d0',
      accent: '#d97706',
      pattern: 'checker',
    },
  },
];
