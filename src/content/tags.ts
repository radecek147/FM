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
 */
import type { TagCtx, TagDef } from '../engine/content-types';
import type { EditionId, HandType, RunState } from '../engine/types';
import { HAND_TYPES } from '../engine/types';
import { boosterId } from './boosters';

// ─────────────────────────── Čísla (DESIGN 7) ───────────────────────────

/** 1 Drobné v kabátě: Kč hned. */
const COAT_CHANGE_MONEY = 6;
/** 2 Termínovaný vklad: Kč v rozpisu odměn po porážce šéfa. */
const TERM_DEPOSIT_MONEY = 15;
/** 3 Zálohy: Kč za každou přeskočenou útratu v runu (včetně této). */
const ADVANCE_PAYMENT_PER_SKIP = 3;
/** 4 Brigáda na chmelu: Kč za každých N zahraných rukou v runu, nejvýš strop. */
const HOP_MONEY = 1;
const HOP_HANDS = 2;
const HOP_CAP = 15;
/** 5 Otevřené dveře: přehození zdarma v příští Večerce. */
const OPEN_DOORS_REROLLS = 3;
/** 11 Vyleštěné příbory: šance edicí v % (součet 100). */
const CUTLERY_EDITIONS: readonly { edition: EditionId; pct: number }[] = [
  { edition: 'foil', pct: 55 },
  { edition: 'holo', pct: 30 },
  { edition: 'poly', pct: 15 },
];
/** 13 Doporučení od známého: násobek ceny vzácného žolíka (poloviční cena). */
const REFERRAL_PRICE_MULT = 0.5;
/** 15 Úřední poukaz: kupónů navíc. */
const VOUCHER_SLIP_COUNT = 1;
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
/** 20 Bazar u silnice: Kč místo žolíka, když není volný slot. */
const BAZAAR_MONEY = 4;

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

// ─────────────────────────── Štítky ───────────────────────────

export const TAGS: TagDef[] = [
  {
    // 1 — +6 Kč, hned.
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
    // 2 — Po porážce šéfa tohoto patra +15 Kč (v rozpisu odměn), pak se spotřebuje.
    id: 'term_deposit',
    params: { money: TERM_DEPOSIT_MONEY },
    hooks: {
      roundEndMoney: (ctx) => (ctx.state.round?.blind === 'boss' ? TERM_DEPOSIT_MONEY : 0),
      onRoundEnd: (ctx) => ctx.state.round?.blind === 'boss',
    },
    art: {
      icon: 'piggy-bank',
      prop: 'hourglass',
      bg: '#203a2c',
      fg: '#e6f5e9',
      accent: '#f2c14e',
      pattern: 'grid',
    },
  },
  {
    // 3 — +3 Kč za každou přeskočenou útratu v runu (přeskočení se započítá dřív, než štítek přijde).
    id: 'advance_payment',
    params: { money: ADVANCE_PAYMENT_PER_SKIP },
    hooks: {
      onAdded: (ctx) => {
        ctx.api.addMoney(ADVANCE_PAYMENT_PER_SKIP * ctx.state.stats.blindsSkipped, 'tag');
        return true;
      },
    },
    art: {
      icon: 'receive-money',
      prop: 'contract',
      bg: '#2b2f45',
      fg: '#eef0ff',
      accent: '#9fb4ff',
      pattern: 'stripes',
    },
  },
  {
    // 4 — +1 Kč za každé 2 zahrané ruce v runu, nejvýš +15 Kč.
    id: 'hop_picking',
    params: { money: HOP_MONEY, hands: HOP_HANDS, cap: HOP_CAP },
    hooks: {
      onAdded: (ctx) => {
        const pay = Math.min(HOP_CAP, Math.floor(ctx.state.stats.handsPlayed / HOP_HANDS) * HOP_MONEY);
        ctx.api.addMoney(pay, 'tag');
        return true;
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
    // 7 — Zdarma Tlustá obálka pranostik.
    id: 'kiosk_calendar',
    hooks: freeBooster(boosterId('pranostika', 'jumbo')),
    art: { icon: 'calendar', prop: 'fire', bg: '#1f3f66', fg: '#e8f2ff', accent: '#ef4444', pattern: 'grid' },
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
    // 9 — Zdarma normální Obálka razítek (od patra 2).
    id: 'official_letter',
    minAnte: 2,
    hooks: freeBooster(boosterId('razitko', 'normal')),
    art: {
      icon: 'post-stamp',
      prop: 'stamper',
      bg: '#5a1f2b',
      fg: '#ffe8ec',
      accent: '#fb7185',
      pattern: 'stripes',
    },
  },
  {
    // 10 — Zdarma Tlustá obálka hracích karet.
    id: 'cottage_marias',
    hooks: freeBooster(boosterId('card', 'jumbo')),
    art: {
      icon: 'wood-cabin',
      prop: 'poker-hand',
      bg: '#14532d',
      fg: '#ecfdf5',
      accent: '#fde68a',
      pattern: 'waves',
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
    // 12 — Příští žolík ve Večerce bude negativní, bez příplatku (od patra 2).
    id: 'photo_negative',
    minAnte: 2,
    hooks: {
      onShopEnter: (ctx) => {
        editionForNextShopJoker(ctx, 'negative');
        return true;
      },
    },
    art: {
      icon: 'ghost',
      prop: 'eyeball',
      bg: '#101418',
      fg: '#e5e7eb',
      accent: '#a78bfa',
      pattern: 'checker',
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
    id: 'voucher_slip',
    params: { vouchers: VOUCHER_SLIP_COUNT },
    hooks: {
      onShopEnter: (ctx) => {
        for (let i = 0; i < VOUCHER_SLIP_COUNT; i++) ctx.api.addShopVoucher();
        return true;
      },
    },
    art: {
      icon: 'ticket',
      prop: 'scroll-unfurled',
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
