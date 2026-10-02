/**
 * Babské rady (docs/DESIGN.md kap. 5.3; 22 kusů, cena 4 Kč) — mění hrací karty nebo dávají drobný užitek.
 * Texty v src/i18n/cs/rady.ts (`consumables.<id>.name|desc|flavor`, `{param}` = hodnoty z `params`).
 * Návod: docs/CONTENT-GUIDE.md.
 *
 * Cíle (`ctx.targets`) jsou karty vybrané v ruce — v kole, nebo v ruce dobrané při otevření obálky — seřazené
 * zleva doprava podle pozice v ruce (engine je řadí sám), takže `targets[0]` je „levá“ karta z DESIGN 5.1.
 * Čísla mechanik jsou jen v konstantách níže; popisky je čtou přes `params`. U vylepšení se do `params`
 * přebírají i čísla samotného vylepšení ze `src/content/modifiers.ts`, aby popisek nelhal po změně balancu.
 */
import type { ArtSpec, ConsumableCtx, ConsumableDef } from '../engine/content-types';
import type { HandType, Rank } from '../engine/types';
import { HAND_TYPES } from '../engine/types';
import { EDITIONS, ENHANCEMENTS } from './modifiers';

// ─────────────────────────── Čísla ───────────────────────────

/** Cena babské rady ve Večerce (DESIGN 2.5.2). */
export const RADA_COST = 4;

/** Kolik karet smí která rada s vylepšením zasáhnout (DESIGN 5.3, sloupec „Cíl“). */
const CHAMOMILE_CARDS = 3;
const CHILI_CARDS = 2;
const GLASS_CABINET_CARDS = 1;
const CAST_IRON_POT_CARDS = 1;
const CABBAGE_STONE_CARDS = 2;
const DUCAT_CARDS = 1;
const FOUR_LEAF_CARDS = 2;
const FERN_BLOOM_CARDS = 2;
const GRANDPAS_WALLET_CARDS = 3;

/** Babiččina barva: kolik karet se vybírá (první určuje barvu ostatním). */
const DYE_MIN = 2;
const DYE_MAX = 4;
/** Zrcátko v předsíni a Kopřivový odvar: přesně dvě karty (levá a pravá). */
const PAIR_CARDS = 2;
/** Kynuté těsto: až kolik karet a o kolik hodnot nahoru (eso je strop). */
const DOUGH_CARDS = 3;
const DOUGH_RANKS = 1;
const ACE: Rank = 14;
/** Generální úklid: až kolik karet zničí a kolik Kč dá za každou. */
const CLEANING_CARDS = 3;
const CLEANING_MONEY = 1;
/** Pod slamníkem: procento peněz (dolů) a strop výdělku. */
const MATTRESS_PCT = 50;
const MATTRESS_MAX = 12;
/** Rosnička: kolik náhodných pranostik přidá k pranostice nejčastější kombinace. */
const FROG_RANDOM = 1;
/** Rosnička bez zahraných rukou (shodně se štítkem Předpověď počasí, DESIGN kap. 7). */
const FROG_FALLBACK_HAND: HandType = 'high_card';
/** Zaklepat na dřevo: „1 z 3“ na edici žolíka, jinak útěcha v Kč. */
const KNOCK_CHANCE = 1;
const KNOCK_ODDS = 3;
const KNOCK_MONEY = 2;
const KNOCK_EDITIONS: readonly string[] = ['foil', 'holo'];
/** Studený obklad: zahození navíc v tomto kole. */
const COMPRESS_DISCARDS = 2;
/** Česnek na krk: až kolik karet vrátí do provozu. */
const GARLIC_CARDS = 3;

/** Id rady, kterou Babiččin recept nikdy nezopakuje (sám sebe). */
const RECIPE_ID = 'grandmas_recipe';
/** Druhy spotřebek, které Babiččin recept umí zopakovat (razítka ne). */
const RECIPE_KINDS: readonly string[] = ['rada', 'pranostika'];

// ─────────────────────────── Pomocníci ───────────────────────────

/** Čísla vylepšení (`EnhancementDef.params`) — jediný zdroj i pro popisky rad. */
function enhancementParams(id: string): Record<string, number | string> {
  const def = ENHANCEMENTS.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown enhancement ${id}`);
  return { ...(def.params ?? {}) };
}

/**
 * Kolik spotřebek se ještě vejde, když rada uvolní svůj vlastní slot (DESIGN 5.1). Rada použitá ze slotu si odnese
 * i slot, který přinesla (negativní edice) — ten se do volného místa nepočítá.
 */
function freeConsumableSlots(ctx: ConsumableCtx): number {
  const others = ctx.state.consumables.filter((c) => c.uid !== ctx.self.uid).length;
  const inSlots = ctx.state.consumables.some((c) => c.uid === ctx.self.uid);
  const ownSlots =
    inSlots && ctx.self.edition ? (EDITIONS.find((e) => e.id === ctx.self.edition)?.extraSlots ?? 0) : 0;
  return ctx.mods.consumableSlots - ownSlots - others;
}

/** Právě běží kolo (rady „jen v kole“). */
function inRound(ctx: ConsumableCtx): boolean {
  return ctx.state.phase === 'round' && ctx.state.round !== null;
}

/** Nejčastěji hraná kombinace v runu; při shodě silnější, bez zahraných rukou Vysoká karta. */
export function mostPlayedHand(ctx: ConsumableCtx): HandType {
  let best = FROG_FALLBACK_HAND;
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

/** Spotřebka, kterou by teď zopakoval Babiččin recept (poslední použitá rada/pranostika), nebo null. */
export function recipeTarget(ctx: ConsumableCtx): string | null {
  const last = ctx.state.lastConsumable;
  if (!last || last === RECIPE_ID) return null;
  const kind = ctx.api.consumableKind(last);
  return kind && RECIPE_KINDS.includes(kind) ? last : null;
}

/** Žolík nejvíc vlevo, kterého jde proměnit Kouzelným kotlíkem (ne legendární, ne přibitý), nebo null. */
function cauldronJoker(ctx: ConsumableCtx): { uid: number; candidates: string[] } | null {
  const j = ctx.state.jokers[0];
  if (!j || j.stickers.includes('eternal')) return null;
  const rarity = ctx.api.jokerRarity(j.defId);
  if (!rarity || rarity === 'legendary') return null;
  const candidates = ctx.api.availableJokers({ rarity }).filter((id) => id !== j.defId);
  return candidates.length > 0 ? { uid: j.uid, candidates } : null;
}

/** Babská rada, která vybraným kartám dá vylepšení (DESIGN 2.7, sloupec „Zdroj“). */
function enhancer(id: string, enhancement: string, cards: number, art: ArtSpec): ConsumableDef {
  return {
    id,
    kind: 'rada',
    cost: RADA_COST,
    target: { min: 1, max: cards },
    params: { ...enhancementParams(enhancement), cards },
    use: (ctx) => {
      for (const card of ctx.targets) ctx.api.modifyCard(card.id, { enhancement });
    },
    art,
  };
}

// ─────────────────────────── Rady ───────────────────────────

export const RADY: ConsumableDef[] = [
  // ── vylepšení (9) ──
  enhancer('chamomile', 'bonus', CHAMOMILE_CARDS, {
    icon: 'flower-pot',
    bg: '#3f4d2c',
    fg: '#f6efc6',
    accent: '#e9d77a',
    pattern: 'dots',
    prop: 'two-coins',
  }),
  enhancer('chili', 'mult', CHILI_CARDS, {
    icon: 'fire',
    bg: '#7a1f1f',
    fg: '#ffe4d6',
    accent: '#f97316',
    pattern: 'rays',
  }),
  enhancer('glass_cabinet', 'glass', GLASS_CABINET_CARDS, {
    icon: 'wine-glass',
    bg: '#2c5560',
    fg: '#e6f7fb',
    accent: '#9fd8e6',
    pattern: 'grid',
  }),
  enhancer('cast_iron_pot', 'steel', CAST_IRON_POT_CARDS, {
    icon: 'chef-toque',
    bg: '#3a3f47',
    fg: '#eef0f3',
    accent: '#9aa3ad',
    pattern: 'checker',
    prop: 'anvil',
  }),
  enhancer('cabbage_stone', 'stone', CABBAGE_STONE_CARDS, {
    icon: 'cabbage',
    bg: '#46523a',
    fg: '#eef5e1',
    accent: '#a8a29e',
    pattern: 'none',
    prop: 'stone-block',
  }),
  enhancer('ducat', 'gold', DUCAT_CARDS, {
    icon: 'crown-coin',
    bg: '#5c4310',
    fg: '#fff3c4',
    accent: '#eab308',
    pattern: 'stripes',
  }),
  enhancer('four_leaf', 'lucky', FOUR_LEAF_CARDS, {
    icon: 'clover',
    bg: '#1f5130',
    fg: '#e7ffe9',
    accent: '#86efac',
    pattern: 'waves',
  }),
  enhancer('fern_bloom', 'wild', FERN_BLOOM_CARDS, {
    icon: 'linden-leaf',
    bg: '#22352b',
    fg: '#e9fff1',
    accent: '#c084fc',
    pattern: 'zigzag',
    prop: 'sparkles',
  }),
  enhancer('grandpas_wallet', 'worn', GRANDPAS_WALLET_CARDS, {
    icon: 'wallet',
    bg: '#4a3423',
    fg: '#f8ead8',
    accent: '#c08a5a',
    pattern: 'waves',
    prop: 'hand',
  }),

  // ── barva a hodnota (3) ──
  {
    id: 'grandmas_dye',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: DYE_MIN, max: DYE_MAX },
    params: { min: DYE_MIN, max: DYE_MAX },
    // Bez platného cíle (všechny už mají barvu levé karty) je Použít neaktivní (DESIGN 5.3).
    canUse: (ctx) => ctx.targets.some((c) => c.suit !== ctx.targets[0]?.suit),
    use: (ctx) => {
      const [first, ...rest] = ctx.targets;
      if (!first) return;
      for (const card of rest) ctx.api.modifyCard(card.id, { suit: first.suit });
    },
    art: {
      icon: 'hearts',
      bg: '#5b2340',
      fg: '#ffe6f1',
      accent: '#f472b6',
      pattern: 'stripes',
      prop: 'spades',
    },
  },
  {
    id: 'hall_mirror',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: PAIR_CARDS, max: PAIR_CARDS },
    params: { cards: PAIR_CARDS },
    // Stejná hodnota by nic nezměnila.
    canUse: (ctx) => ctx.targets[0]?.rank !== ctx.targets[1]?.rank,
    use: (ctx) => {
      const [left, right] = ctx.targets;
      if (left && right) ctx.api.modifyCard(left.id, { rank: right.rank });
    },
    art: { icon: 'window', bg: '#2f3b52', fg: '#e8eefc', accent: '#a5b4fc', pattern: 'grid' },
  },
  {
    id: 'risen_dough',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: 1, max: DOUGH_CARDS },
    params: { cards: DOUGH_CARDS, ranks: DOUGH_RANKS },
    // Samá esa (strop) by nic nezměnila.
    canUse: (ctx) => ctx.targets.some((c) => c.rank < ACE),
    use: (ctx) => {
      for (const card of ctx.targets) {
        const rank = Math.min(ACE, card.rank + DOUGH_RANKS) as Rank;
        if (rank !== card.rank) ctx.api.modifyCard(card.id, { rank });
      }
    },
    art: { icon: 'bread', bg: '#6b4a24', fg: '#fff3dc', accent: '#f5c16c', pattern: 'dots' },
  },

  // ── ničení a kopie (3) ──
  {
    id: 'spring_cleaning',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: 1, max: CLEANING_CARDS },
    params: { cards: CLEANING_CARDS, money: CLEANING_MONEY },
    use: (ctx) => {
      for (const card of ctx.targets) ctx.api.destroyCard(card.id, 'rada');
      ctx.api.addMoney(ctx.targets.length * CLEANING_MONEY, 'rada');
    },
    art: { icon: 'wheelbarrow', bg: '#3b4250', fg: '#eef2f8', accent: '#fbbf24', pattern: 'stripes' },
  },
  {
    id: 'apple_tree',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: 1, max: 1 },
    use: (ctx) => {
      const src = ctx.targets[0];
      if (!src) return;
      // Kopie nese vylepšení, pečeť i bonusové čipy, edici ne.
      ctx.api.addCard(
        {
          suit: src.suit,
          rank: src.rank,
          enhancement: src.enhancement,
          seal: src.seal,
          edition: null,
          bonusChips: src.bonusChips,
        },
        { toHand: true, source: 'rada' },
      );
    },
    art: { icon: 'shiny-apple', bg: '#4c1d1d', fg: '#ffecec', accent: '#84cc16', pattern: 'dots' },
  },
  {
    id: 'nettle_tea',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: PAIR_CARDS, max: PAIR_CARDS },
    params: { cards: PAIR_CARDS },
    use: (ctx) => {
      const [left, right] = ctx.targets;
      if (!left || !right) return;
      // Čipy levé karty (hodnota + bonusové) se spočítají před zničením.
      const chips = ctx.api.cardChips(left);
      ctx.api.destroyCard(left.id, 'rada');
      ctx.api.modifyCard(right.id, { bonusChips: right.bonusChips + chips });
    },
    art: {
      icon: 'honey-jar',
      bg: '#2e4a2a',
      fg: '#effbe5',
      accent: '#65a30d',
      pattern: 'zigzag',
      prop: 'linden-leaf',
    },
  },

  // ── peníze a tvorba spotřebek (3) ──
  {
    id: 'under_mattress',
    kind: 'rada',
    cost: RADA_COST,
    params: { pct: MATTRESS_PCT, max: MATTRESS_MAX },
    use: (ctx) => {
      const money = ctx.state.money;
      if (money <= 0) return;
      ctx.api.addMoney(Math.min(MATTRESS_MAX, Math.floor((money * MATTRESS_PCT) / 100)), 'rada');
    },
    art: { icon: 'money-stack', bg: '#36442f', fg: '#f1f8e6', accent: '#d9c27a', pattern: 'checker' },
  },
  {
    id: 'tree_frog',
    kind: 'rada',
    cost: RADA_COST,
    params: { random: FROG_RANDOM },
    canUse: (ctx) => freeConsumableSlots(ctx) > 0,
    use: (ctx) => {
      ctx.api.createConsumable({ forHand: mostPlayedHand(ctx) });
      for (let i = 0; i < FROG_RANDOM; i++) ctx.api.createConsumable({ kind: 'pranostika' });
    },
    art: { icon: 'frog', bg: '#1e4d3a', fg: '#e3fff2', accent: '#facc15', pattern: 'waves', prop: 'sun' },
  },
  {
    id: 'grandmas_recipe',
    kind: 'rada',
    cost: RADA_COST,
    canUse: (ctx) => recipeTarget(ctx) !== null && freeConsumableSlots(ctx) > 0,
    use: (ctx) => {
      const defId = recipeTarget(ctx);
      if (defId) ctx.api.createConsumable({ defId });
    },
    art: {
      icon: 'open-book',
      bg: '#4a2f3a',
      fg: '#fdeff4',
      accent: '#f9a8d4',
      pattern: 'stripes',
      prop: 'quill-ink',
    },
  },

  // ── žolíci (2) ──
  {
    id: 'knock_on_wood',
    kind: 'rada',
    cost: RADA_COST,
    params: { chance: KNOCK_CHANCE, odds: KNOCK_ODDS, money: KNOCK_MONEY },
    canUse: (ctx) => ctx.state.jokers.some((j) => j.edition === null),
    use: (ctx) => {
      const plain = ctx.state.jokers.filter((j) => j.edition === null);
      if (plain.length > 0 && ctx.chance(KNOCK_CHANCE, KNOCK_ODDS)) {
        const joker = ctx.rng.pick(plain);
        ctx.api.setJokerEdition(joker.uid, ctx.rng.pick(KNOCK_EDITIONS));
      } else {
        ctx.api.addMoney(KNOCK_MONEY, 'rada');
      }
    },
    art: {
      icon: 'fist',
      bg: '#5a3d24',
      fg: '#fbefdf',
      accent: '#d9a66b',
      pattern: 'stripes',
      prop: 'sparkles',
    },
  },
  {
    id: 'cauldron',
    kind: 'rada',
    cost: RADA_COST,
    canUse: (ctx) => cauldronJoker(ctx) !== null,
    use: (ctx) => {
      const target = cauldronJoker(ctx);
      if (target) ctx.api.transformJoker(target.uid, ctx.rng.pick(target.candidates));
    },
    art: {
      icon: 'witch-face',
      bg: '#1f3a2e',
      fg: '#e6fff4',
      accent: '#4ade80',
      pattern: 'dots',
      prop: 'fire',
    },
  },

  // ── kolo (2) ──
  {
    id: 'cold_compress',
    kind: 'rada',
    cost: RADA_COST,
    params: { discards: COMPRESS_DISCARDS },
    canUse: inRound,
    use: (ctx) => ctx.api.addDiscards(COMPRESS_DISCARDS),
    art: { icon: 'snowflake-1', bg: '#1e3a5f', fg: '#e6f2ff', accent: '#7dd3fc', pattern: 'grid' },
  },
  {
    id: 'garlic',
    kind: 'rada',
    cost: RADA_COST,
    target: { min: 1, max: GARLIC_CARDS },
    params: { cards: GARLIC_CARDS },
    canUse: inRound,
    use: (ctx) => {
      for (const card of ctx.targets) ctx.api.cleanseCard(card.id);
    },
    art: {
      icon: 'garlic',
      bg: '#3d3a4a',
      fg: '#fbf8ef',
      accent: '#e9e3c8',
      pattern: 'checker',
      prop: 'vampire-dracula',
    },
  },
];
