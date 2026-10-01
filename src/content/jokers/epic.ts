/** Žolíci — vzácnost/skupina: epic. Texty v src/i18n/cs/jokers/epic.ts. Návod: docs/CONTENT-GUIDE.md. */
import type { EffectResult, JokerDef } from '../../engine/content-types';
import type { JokerInstance } from '../../engine/types';
import { COMMON_JOKERS } from './common';
import { LEGENDARY_JOKERS } from './legendary';
import { RARE_JOKERS } from './rare';
import { SPECIAL_JOKERS } from './special';

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
const MUSHROOM_XMULT_PER_CARD = 0.15;

const mushroomXmult = (self: JokerInstance): number =>
  MUSHROOM_BASE + MUSHROOM_XMULT_PER_CARD * stateNum(self, 'destroyed');

const mushroomPicker: JokerDef = {
  id: 'mushroom_picker',
  rarity: 'epic',
  cost: 9,
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

let nonCopyable: ReadonlySet<string> | null = null;

/**
 * Id žolíků obsahu hry s `copyable: false` — Napodobitel si je nevybírá (engine by kopii stejně zahodil a kolo
 * by „propadlo“). Hook k registru přístup nemá, proto statický seznam obsahu (počítá se líně při prvním výběru,
 * kdy už jsou všechny skupiny načtené); žolík mimo obsah hry (testovací registr) se bere jako kopírovatelný
 * a nekopírovatelnost pak pohlídá engine.
 */
function nonCopyableIds(): ReadonlySet<string> {
  nonCopyable ??= new Set(
    [...COMMON_JOKERS, ...RARE_JOKERS, ...EPIC_JOKERS, ...LEGENDARY_JOKERS, ...SPECIAL_JOKERS]
      .filter((d) => d.copyable === false)
      .map((d) => d.id),
  );
  return nonCopyable;
}

/**
 * Napodobitel si cíl vybírá v `copyTarget`, ne ve vlastním `onRoundStart`: engine u kopírujícího žolíka volá
 * všechny hooky **cíle** (`GameCore.resolveCopy`), jeho vlastní `onRoundStart` by se tedy nikdy nezavolal.
 * `copyTarget` se ale volá u každého průchodu žolíků — i v `onBlindSelect`/`onRoundStart` při výběru útraty — takže
 * první volání v novém kole (fáze `blind_select` s už založeným kolem) je přesně začátek kola. Kolo pozná podle
 * `stats.roundsWon` (během výběru útraty je pro každé kolo jiné). Stav: `target` = uid cíle, `round` = kolo výběru.
 * Mimo kolo (Večerka, výběr útraty) nekopíruje nic. Když cíl zmizí, do konce kola nekopíruje nic.
 */
const impersonator: JokerDef = {
  id: 'impersonator',
  rarity: 'epic',
  cost: 10,
  tags: ['copy'],
  // Kopírující žolíci se navzájem nekopírují (DESIGN 4.4.7).
  copyable: false,
  initState: () => ({ target: null, round: -1 }),
  hooks: {
    copyTarget: (ctx) => {
      const s = ctx.state;
      if (!s.round) return null;
      if (!ctx.isCopy && s.phase === 'blind_select' && ctx.self.state.round !== s.stats.roundsWon) {
        // Jiný žolík než on sám a jiní Napodobitelé; nekopírovatelné a zvětralé (trvale debuffnuté) by nic nedali.
        const skip = nonCopyableIds();
        const pool = s.jokers.filter(
          (j) => j.uid !== ctx.self.uid && j.defId !== ctx.def.id && !j.debuffed && !skip.has(j.defId),
        );
        ctx.self.state.target = pool.length > 0 ? ctx.rng.pick(pool).uid : null;
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

const INNKEEPER_XMULT = 2.5;

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
