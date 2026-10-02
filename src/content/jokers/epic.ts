/** Žolíci — vzácnost/skupina: epic. Texty v src/i18n/cs/jokers/epic.ts. Návod: docs/CONTENT-GUIDE.md. */
import type { EffectResult, JokerDef, JokerRarity } from '../../engine/content-types';
import type { JokerInstance } from '../../engine/types';

/** Číselný stav žolíka (`self.state[key]`), jinak výchozí hodnota (čerstvá instance, cizí save). */
function stateNum(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ─────────────────────────── #26 Sněhulák ───────────────────────────

const SNOWMAN_XMULT = 2.5;
const SNOWMAN_DECAY = 0.25;
/** Při tomto ×mult (a níž) roztaje. */
const SNOWMAN_MELT_AT = 1;

const snowmanXmult = (self: JokerInstance): number => stateNum(self, 'xmult', SNOWMAN_XMULT);

const snowman: JokerDef = {
  id: 'snowman',
  rarity: 'epic',
  cost: 8,
  unlock: { type: 'stat', stat: 'firstHandRoundWins', atLeast: 1 },
  tags: ['xmult'],
  params: { xmult: SNOWMAN_XMULT, decay: SNOWMAN_DECAY, min: SNOWMAN_MELT_AT },
  initState: () => ({ xmult: SNOWMAN_XMULT }),
  describe: (self) => ({ current: snowmanXmult(self) }),
  // Sám se ničí (DESIGN 4.4.12).
  noEternal: true,
  hooks: {
    onHandPlayed: (ctx) => {
      const xmult = snowmanXmult(ctx.self);
      return xmult > SNOWMAN_MELT_AT ? { xmult } : null;
    },
    onRoundEnd: (ctx) => {
      // Kopie nesmí měnit stav ani zničit originál (`self.uid` je i v kopii uid cíle).
      if (ctx.isCopy) return;
      // 0,25 je v binárním zápisu přesné — 2,5 → 1 za 6 kol bez zaokrouhlovací chyby.
      const next = Math.max(SNOWMAN_MELT_AT, snowmanXmult(ctx.self) - SNOWMAN_DECAY);
      ctx.self.state.xmult = next;
      if (next > SNOWMAN_MELT_AT) return;
      ctx.api.destroyJoker(ctx.self.uid, 'melted');
      // Hláška jen tehdy, když opravdu zmizel (přibitý se zničit nedá — pak jen přestane násobit).
      if (!ctx.state.jokers.some((j) => j.uid === ctx.self.uid)) ctx.api.message('jokers.snowman.melted');
    },
  },
  art: {
    icon: 'snowman',
    bg: '#dbeafe',
    fg: '#1e3a5f',
    accent: '#f97316',
    pattern: 'dots',
    prop: 'snowflake-1',
  },
};

// ─────────────────────────── #27 Sběrač hub ───────────────────────────

const MUSHROOM_BASE = 1;
const MUSHROOM_XMULT_PER_CARD = 0.25;

const mushroomXmult = (self: JokerInstance): number =>
  MUSHROOM_BASE + MUSHROOM_XMULT_PER_CARD * stateNum(self, 'destroyed');

const mushroomPicker: JokerDef = {
  id: 'mushroom_picker',
  rarity: 'epic',
  cost: 9,
  unlock: { type: 'stat', stat: 'cardsDestroyed', atLeast: 20 },
  tags: ['xmult', 'scaling', 'deck'],
  params: { base: MUSHROOM_BASE, xmult: MUSHROOM_XMULT_PER_CARD },
  initState: () => ({ destroyed: 0 }),
  describe: (self) => ({ current: mushroomXmult(self) }),
  hooks: {
    // Každá zničená hrací karta balíčku (prasklé sklo, spotřebky, šéfové…) od chvíle, kdy je ve slotu.
    onCardDestroyed: (ctx) => {
      if (ctx.isCopy) return;
      ctx.self.state.destroyed = stateNum(ctx.self, 'destroyed') + 1;
    },
    onHandPlayed: (ctx) => {
      const xmult = mushroomXmult(ctx.self);
      return xmult > MUSHROOM_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'mushroom',
    bg: '#3f2a1d',
    fg: '#f7e8d0',
    accent: '#c0392b',
    pattern: 'dots',
    prop: 'pine-tree',
  },
};

// ─────────────────────────── #28 Napodobitel ───────────────────────────

/** Kostým: edice, kterou Napodobitel dostane při získání, pokud žádnou nemá (duhová = ×1,5 mult). */
const IMPERSONATOR_EDITION = 'poly';
/** Koho smí kopírovat — na hvězdy (epické a legendární žolíky) nemá. */
const IMPERSONATOR_RARITIES: readonly JokerRarity[] = ['common', 'rare'];

/**
 * Napodobitel si cíl vybírá v `copyTarget`, ne ve vlastním `onRoundStart`: engine u kopírujícího žolíka volá
 * všechny hooky **cíle** (`GameCore.resolveCopy`), jeho vlastní `onRoundStart` by se tedy nikdy nezavolal.
 * `copyTarget` se ale volá u každého průchodu žolíků — i v `onBlindSelect`/`onRoundStart` při výběru útraty — takže
 * první volání v novém kole (fáze `blind_select` s už založeným kolem) je přesně začátek kola. Kolo pozná podle
 * `stats.roundsWon` (během výběru útraty je pro každé kolo jiné). Stav: `target` = uid cíle, `round` = kolo výběru.
 *
 * Cíl = běžný nebo vzácný žolík s nejvyšší prodejní cenou (`api.sellValue`: cena, edice, prodejní bonus; zapůjčený
 * 1 Kč), při shodě ten nejvíc vlevo. Vynechá nekopírovatelné (`api.jokerCopyable` — i jiné Napodobitele) a žolíky
 * mimo provoz (debuffnuté na začátku kola). Mimo kolo (Večerka, výběr útraty) nekopíruje nic; když cíl zmizí, do konce
 * kola nekopíruje nic. Duhová edice z `onAcquire` platí v kroku 4 vždy, i bez cíle (edice patří vlastníkovi slotu).
 */
const impersonator: JokerDef = {
  id: 'impersonator',
  rarity: 'epic',
  cost: 10,
  unlock: { type: 'stat', stat: 'maxJokers', atLeast: 5 },
  tags: ['copy'],
  // Kopírující žolíci se navzájem nekopírují (DESIGN 4.4.7).
  copyable: false,
  initState: () => ({ target: null, round: -1 }),
  hooks: {
    // Vlastní hook kopírujícího žolíka (`onAcquire` se volá jen jemu, ne přes kopii).
    onAcquire: (ctx) => {
      if (ctx.self.edition === null) ctx.api.setJokerEdition(ctx.self.uid, IMPERSONATOR_EDITION);
    },
    copyTarget: (ctx) => {
      const s = ctx.state;
      if (!s.round) return null;
      if (!ctx.isCopy && s.phase === 'blind_select' && ctx.self.state.round !== s.stats.roundsWon) {
        let best: JokerInstance | null = null;
        let bestValue = -Infinity;
        for (const j of s.jokers) {
          if (j.uid === ctx.self.uid || j.debuffed || !ctx.api.jokerCopyable(j.defId)) continue;
          const rarity = ctx.api.jokerRarity(j.defId);
          if (!rarity || !IMPERSONATOR_RARITIES.includes(rarity)) continue;
          const value = ctx.api.sellValue(j);
          if (value > bestValue) {
            best = j;
            bestValue = value;
          }
        }
        ctx.self.state.target = best?.uid ?? null;
        ctx.self.state.round = s.stats.roundsWon;
      }
      const uid = ctx.self.state.target;
      return typeof uid === 'number' && s.jokers.some((j) => j.uid === uid) ? uid : null;
    },
  },
  art: {
    icon: 'drama-masks',
    bg: '#312e81',
    fg: '#eef2ff',
    accent: '#f59e0b',
    pattern: 'checker',
    prop: 'card-random',
  },
};

// ─────────────────────────── #29 Hostinský ───────────────────────────

const INNKEEPER_XMULT = 2.2;

const innkeeper: JokerDef = {
  id: 'innkeeper',
  rarity: 'epic',
  cost: 8,
  tags: ['xmult', 'discard'],
  params: { xmult: INNKEEPER_XMULT },
  hooks: {
    // Počítá jen zahození hráčem (`round.discardsUsed`); zahození efektem (`discardFromHand`) se nepočítá.
    onHandPlayed: (ctx) => (ctx.round.discardsUsed === 0 ? { xmult: INNKEEPER_XMULT } : null),
  },
  art: {
    icon: 'tap',
    bg: '#5b2c06',
    fg: '#fff3dc',
    accent: '#fbbf24',
    pattern: 'stripes',
    prop: 'beer-horn',
  },
};

// ─────────────────────────── #30 Babiččina truhla ───────────────────────────

/** ×1,3 za každou spotřebku — násobí se postupně (2 spotřebky = ×1,3 × 1,3 = ×1,69). */
const CHEST_XMULT = 1.3;

const grandmasChest: JokerDef = {
  id: 'grandmas_chest',
  rarity: 'epic',
  cost: 8,
  tags: ['xmult', 'consumable'],
  params: { xmult: CHEST_XMULT },
  hooks: {
    // Jeden krok ×1,3 za každou spotřebku ve slotech (UI je přehraje jako „tik tik“).
    onHandPlayed: (ctx) => ctx.state.consumables.map((): EffectResult => ({ xmult: CHEST_XMULT })),
  },
  art: {
    icon: 'locked-chest',
    bg: '#4a2e1a',
    fg: '#f8ead2',
    accent: '#b7791f',
    pattern: 'grid',
    prop: 'honey-jar',
  },
};

export const EPIC_JOKERS: JokerDef[] = [snowman, mushroomPicker, impersonator, innkeeper, grandmasChest];
