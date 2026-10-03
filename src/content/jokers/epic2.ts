/**
 * Žolíci — epičtí (fáze 7, docs/DESIGN.md 4.9). Texty v src/i18n/cs/jokers/epic2.ts. Návod: docs/CONTENT-GUIDE.md.
 *
 * Ze zásobníku DESIGN 4.9: Pivní sommelier, Archivář, Kouzelník z pouti, Turistický průvodce. Vlastní (velké české
 * reálie): Spartakiáda, Kupónová privatizace, Lázeňský host, Dechovka, Karlův most, Dálnice D1, Směnárna, Silvestr.
 * Čísla mechanik jsou jen v konstantách níže — stejné hodnoty čte hook i popisek (`params`, `describe`). Nečíselné
 * `params.hand` je jen nápověda pro boty simulace (src/engine/sim/bots.ts), popisky ho nečtou. Výklad mechanik
 * a naměřené hodnoty (`scripts/joker-value.ts`): docs/DECISIONS.md, „Epičtí žolíci fáze 7“.
 */
import type { JokerDef } from '../../engine/content-types';
import type { JokerInstance, Rank } from '../../engine/types';

/** Číselný stav žolíka (`self.state[key]`), jinak výchozí hodnota (čerstvá instance, cizí save). */
function stateNum(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Součet „×základ + přírůstek × n“ zaokrouhlený na setiny (0,1 ani 0,15 nejsou v binárním zápisu přesné). */
const cents = (x: number): number => Math.round(x * 100) / 100;

// ─────────────────────────── Pivní sommelier ───────────────────────────

const SOMMELIER_BASE = 1;
const SOMMELIER_XMULT = 0.7;

/**
 * Různé kombinace v tomto kole včetně právě hrané. `round.handTypesPlayed` je při skórování ještě bez této ruky
 * (run loop ji připíše až po skórování) a obsahuje i ruce zakázané šéfem — i ty se „ochutnaly“.
 */
const beerSommelier: JokerDef = {
  id: 'beer_sommelier',
  rarity: 'epic',
  cost: 9,
  unlock: { type: 'custom', id: 'distinctHands8' },
  tags: ['xmult', 'hand'],
  params: { base: SOMMELIER_BASE, xmult: SOMMELIER_XMULT },
  hooks: {
    onHandPlayed: (ctx) => {
      const tasted = new Set([...ctx.round.handTypesPlayed, ctx.hand.type]).size;
      return { xmult: cents(SOMMELIER_BASE + SOMMELIER_XMULT * tasted) };
    },
  },
  art: {
    icon: 'beer-bottle',
    prop: 'stars-stack',
    bg: '#5a3410',
    fg: '#fdf1d8',
    accent: '#e8b04a',
    pattern: 'dots',
  },
};

// ─────────────────────────── Archivář ───────────────────────────

/** Kostým (jako Napodobitel): edice, kterou Archivář dostane při získání, pokud žádnou nemá. */
const ARCHIVIST_COSTUME = 'poly';

/**
 * Kopíruje souseda vlevo (pozice − 1) — kdykoli, nejen v kole (i `onSell`, `onConsumableUsed` ve Večerce), a jakékoli
 * vzácnosti (na rozdíl od Napodobitele a Kopíráku). Nejvíc vlevo nekopíruje nic. Nekopírovatelného souseda
 * (Napodobitel, jiný kopírující, ekonomika z rozpisu) si nevybere; souseda mimo provoz vyřadí engine
 * (`GameCore.resolveCopy`), stejně jako UI.
 *
 * Cíl zapisuje do `state.target` (konvence UI a botů — src/ui/describe.ts `copyTargetUid`, src/engine/sim/bots.ts
 * `slotOrderKey`); jen originál (kopie stav nemění). Cíl se počítá z pozice při každém průchodu žolíků, takže po
 * přeřazení platí od příští akce.
 *
 * Kostým: samotná kopie souseda dá v sestavách botů jen ≈ +20 % (`scripts/joker-value.ts`, DECISIONS fáze 7) — pod
 * pásmem epického. Duhová edice z `onAcquire` (×1,5 po efektu kopie; edice Archiváře obalí kopírovaný efekt, DESIGN
 * 3.1 krok 4, a platí i bez cíle) ho dorovná; lesklá a holografická vycházejí nad pásmem.
 */
const archivist: JokerDef = {
  id: 'archivist',
  rarity: 'epic',
  cost: 10,
  unlock: { type: 'discover', category: 'jokers', count: 30 },
  tags: ['copy'],
  // Kopírující žolíci se navzájem nekopírují (DESIGN 4.4.7).
  copyable: false,
  initState: () => ({ target: null }),
  hooks: {
    // Vlastní hook kopírujícího žolíka (`onAcquire` se volá jen jemu, ne přes kopii).
    onAcquire: (ctx) => {
      if (ctx.self.edition === null) ctx.api.setJokerEdition(ctx.self.uid, ARCHIVIST_COSTUME);
    },
    copyTarget: (ctx) => {
      const left = ctx.state.jokers[ctx.index - 1];
      const uid = left && ctx.api.jokerCopyable(left.defId) ? left.uid : null;
      if (!ctx.isCopy && ctx.self.state.target !== uid) ctx.self.state.target = uid;
      return uid;
    },
  },
  art: {
    icon: 'papers',
    prop: 'spectacles',
    bg: '#3d3a33',
    fg: '#f2ecdc',
    accent: '#a3885c',
    pattern: 'grid',
  },
};

// ─────────────────────────── Kouzelník z pouti ───────────────────────────

const MAGICIAN_XMULT = 1.15;
/** 1.0.1: trik se občas „povede“ — 1 z 5 za ruku, že náhodná zahraná karta zmizí v klobouku (zničí se po ruce). */
const MAGICIAN_VANISH_CHANCE = 1;
const MAGICIAN_VANISH_ODDS = 5;
/** Klíč stavu: id karty, která v této ruce zmizí (nebo null). */
const MAGICIAN_VANISH = 'vanish';
const MSG_MAGICIAN_VANISH = 'jokers.fair_magician.vanished';

/**
 * `allCardsScore`: skórují i karty mimo kombinaci (kopy). ×1,15 za každou **aktivaci** skórující karty (opakování
 * červenou pečetí nebo žolíkem dá ×1,15 znovu, ale jen do stropu ×mult z opakování); debuffnutá karta se přeskočí
 * celá. Před skórováním hod 1 z 5 (stream `joker`): vybraná zahraná karta ještě skóruje a po ruce se zničí. Kopie dá
 * jen ×1,15 za kartu (`passive` se nekopíruje, karty nemizí dvakrát).
 */
const fairMagician: JokerDef = {
  id: 'fair_magician',
  rarity: 'epic',
  cost: 9,
  tags: ['xmult', 'utility'],
  params: { xmult: MAGICIAN_XMULT, chance: MAGICIAN_VANISH_CHANCE, odds: MAGICIAN_VANISH_ODDS },
  initState: () => ({ [MAGICIAN_VANISH]: null }),
  hooks: {
    passive: () => ({ allCardsScore: true }),
    beforeScoring: (ctx) => {
      if (ctx.isCopy) return;
      const victim =
        ctx.played.length > 0 && ctx.chance(MAGICIAN_VANISH_CHANCE, MAGICIAN_VANISH_ODDS)
          ? ctx.rng.pick(ctx.played).id
          : null;
      ctx.self.state[MAGICIAN_VANISH] = victim;
    },
    onCardScored: (ctx) =>
      !ctx.isCopy && !ctx.isRetrigger && ctx.self.state[MAGICIAN_VANISH] === ctx.card.id
        ? { xmult: MAGICIAN_XMULT, destroyCard: true, message: MSG_MAGICIAN_VANISH }
        : { xmult: MAGICIAN_XMULT },
    afterHandScored: (ctx) => {
      if (!ctx.isCopy) ctx.self.state[MAGICIAN_VANISH] = null;
    },
  },
  art: {
    icon: 'magic-hat',
    prop: 'rabbit',
    bg: '#2a1846',
    fg: '#f5ecff',
    accent: '#e94f9a',
    pattern: 'rays',
  },
};

// ─────────────────────────── Turistický průvodce ───────────────────────────

const GUIDE_CHIPS = 40;
/** 1.0.1: spropitné průvodci za každou zahranou ruku ze 4 karet, která obsahuje Postupku nebo Barvu. */
const GUIDE_TIP = 1;
const GUIDE_TIP_CARDS = 4;
const MSG_GUIDE_TIP = 'jokers.tour_guide.tip';

/**
 * `fourCardStraightFlush` (Postupka i Barva ze 4 karet; 5 karet má přednost). „Obsahuje“ = `hand.contains`, tedy
 * i Postupka v barvě, Královská postupka, Barevný full house a Barevná pětice. Kopie dá jen čipy (`passive` se
 * nekopíruje). Čipy, ne ×mult: samotné pravidlo ze 4 karet dává v okně R1 ≈ +50 % a ×mult navrch by špičku R2
 * vyhnal nad 2× horní hranici (DECISIONS fáze 7).
 */
const tourGuide: JokerDef = {
  id: 'tour_guide',
  rarity: 'epic',
  cost: 8,
  unlock: { type: 'winRun', deck: 'tourist' },
  tags: ['chips', 'utility', 'hand'],
  // `hand` čtou boti (honí Barvu), v popisku není.
  params: { chips: GUIDE_CHIPS, tip: GUIDE_TIP, cards: GUIDE_TIP_CARDS, hand: 'flush' },
  hooks: {
    passive: () => ({ fourCardStraightFlush: true }),
    onHandPlayed: (ctx) =>
      ctx.hand.contains.includes('straight') || ctx.hand.contains.includes('flush')
        ? { chips: GUIDE_CHIPS }
        : null,
    afterHandScored: (ctx) => {
      if (ctx.isCopy || ctx.played.length !== GUIDE_TIP_CARDS) return;
      if (!ctx.hand.contains.includes('straight') && !ctx.hand.contains.includes('flush')) return;
      ctx.api.addMoney(-GUIDE_TIP, 'joker');
      ctx.api.message(MSG_GUIDE_TIP);
    },
  },
  art: {
    icon: 'umbrella',
    prop: 'footprint',
    bg: '#2f5d3a',
    fg: '#f4f7e8',
    accent: '#e63946',
    pattern: 'stripes',
  },
};

// ─────────────────────────── Spartakiáda ───────────────────────────

const SPARTAKIADA_RETRIGGERS = 2;

/**
 * První ruka kola = `ctx.firstHand` (v kole se ještě nehrálo; ruka zakázaná šéfem se spotřebuje a další už první
 * není). Každá skórující karta (i kamenná) skóruje ještě 2×; debuffnutá se přeskočí celá. Strop
 * `MAX_ACTIVATIONS_PER_CARD` platí.
 */
const spartakiada: JokerDef = {
  id: 'spartakiada',
  rarity: 'epic',
  cost: 9,
  unlock: { type: 'stat', stat: 'cardsPlayed', atLeast: 500 },
  tags: ['retrigger'],
  params: { retriggers: SPARTAKIADA_RETRIGGERS },
  hooks: {
    retriggerScored: (ctx) => (ctx.firstHand ? SPARTAKIADA_RETRIGGERS : 0),
  },
  art: {
    icon: 'cycle',
    prop: 'megaphone',
    bg: '#8b1e3f',
    fg: '#fff5e1',
    accent: '#ffd23f',
    pattern: 'checker',
  },
};

// ─────────────────────────── Kupónová privatizace ───────────────────────────

const PRIVATIZATION_MONEY = 1;
const PRIVATIZATION_PCT = 5;
const PRIVATIZATION_MAX = 8;

/**
 * Rozpis odměn: celé kroky po 5 % cíle, o které skóre kola cíl překročilo (skóre 1,27× cíle = 5 kroků = 5 Kč),
 * nejvýš 8 Kč (od 1,4× cíle). Bez desetinných čísel v podmínce: kroky = ⌊přebytek × 100 / (cíl × 5)⌋. Kolo
 * zachráněné pod cílem nedá nic. Engine kopírujícím žolíkům rozpis nepočítá, proto `copyable: false` (DESIGN 4.4.7).
 */
const voucherPrivatization: JokerDef = {
  id: 'voucher_privatization',
  rarity: 'epic',
  cost: 8,
  unlock: { type: 'stat', stat: 'vouchersBought', atLeast: 10 },
  tags: ['economy'],
  params: { money: PRIVATIZATION_MONEY, pct: PRIVATIZATION_PCT, max: PRIVATIZATION_MAX },
  copyable: false,
  noRental: true,
  hooks: {
    roundEndMoney: (ctx) => {
      const round = ctx.state.round;
      if (!round || !(round.target > 0)) return 0;
      const over = round.score - round.target;
      if (!(over > 0)) return 0;
      const steps = Math.floor((over * 100) / (round.target * PRIVATIZATION_PCT));
      return Math.min(PRIVATIZATION_MAX, Math.max(0, steps) * PRIVATIZATION_MONEY);
    },
  },
  art: {
    icon: 'factory',
    prop: 'post-stamp',
    bg: '#4b4f58',
    fg: '#f1f3f5',
    accent: '#f2c94c',
    pattern: 'zigzag',
  },
};

// ─────────────────────────── Lázeňský host ───────────────────────────

const SPA_BASE = 1;
/** Fáze 10: 0,15 → 0,13 (R2 127 % nad pásmem epického, DECISIONS „Fáze 10: balanc…“); 1.0.1: 0,13 → 0,12 (R2 115 %). */
const SPA_XMULT = 0.12;

const spaXmult = (self: JokerInstance): number => cents(SPA_BASE + SPA_XMULT * stateNum(self, 'rounds'));

/**
 * Kolo bez zahazování = `round.discardsUsed === 0` na konci kola (jen zahození hráčem; zahození efektem se nepočítá,
 * jako u Hostinského). Počítá dokončená kola (i zachráněná), přeskočené útraty ne. Kopie stav nemění, jen násobí.
 */
const spaGuest: JokerDef = {
  id: 'spa_guest',
  rarity: 'epic',
  cost: 9,
  tags: ['xmult', 'scaling', 'discard'],
  params: { xmult: SPA_XMULT },
  initState: () => ({ rounds: 0 }),
  describe: (self) => ({ current: spaXmult(self) }),
  // Roste časem ve slotu — zvětrávání by šlo proti smyslu (jako Stálý host).
  noPerishable: true,
  hooks: {
    onRoundEnd: (ctx) => {
      if (ctx.isCopy || (ctx.state.round?.discardsUsed ?? 1) !== 0) return;
      ctx.self.state.rounds = stateNum(ctx.self, 'rounds') + 1;
    },
    onHandPlayed: (ctx) => {
      const xmult = spaXmult(ctx.self);
      return xmult > SPA_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'bathtub',
    prop: 'top-hat',
    bg: '#e6f2ef',
    fg: '#24433d',
    accent: '#c9a227',
    pattern: 'waves',
  },
};

// ─────────────────────────── Dechovka ───────────────────────────

/** Kolikrát navíc skóruje karta za každou další skórující kartu stejné hodnoty. */
const BAND_RETRIGGERS = 2;

/**
 * Opakování = 2 × počet **dalších** skórujících karet se stejnou hodnotou (`api.cardRank`): v Dvojici každá karta
 * 2×, v Trojici 4×, v Čtveřici 6×, v Pětici 8×; ve Full housu trojice 4× a dvojice 2×. Kamenná karta hodnotu nemá
 * (neopakuje se ani nepočítá), debuffnutá karta „nedává nic“ (nepočítá se). Strop `MAX_ACTIVATIONS_PER_CARD` (10
 * aktivací karty) platí — Pětice s červenou pečetí (1 + 8 + 1) je přesně na něm, víc opakování se nevejde.
 */
const brassBand: JokerDef = {
  id: 'brass_band',
  rarity: 'epic',
  cost: 8,
  tags: ['retrigger', 'rank'],
  // `hand` čtou boti (styl „Dvojice“), v popisku není.
  params: { retriggers: BAND_RETRIGGERS, hand: 'pair' },
  hooks: {
    retriggerScored: (ctx) => {
      const rank = ctx.api.cardRank(ctx.card);
      if (rank === null) return 0;
      const others = ctx.scoring.filter(
        (c) => c.id !== ctx.card.id && !c.debuffed && ctx.api.cardRank(c) === rank,
      ).length;
      return others * BAND_RETRIGGERS;
    },
  },
  art: {
    icon: 'drum',
    prop: 'musical-notes',
    bg: '#7a1f1f',
    fg: '#fff1d6',
    accent: '#f2b134',
    pattern: 'stripes',
  },
};

// ─────────────────────────── Karlův most ───────────────────────────

const BRIDGE_XMULT = 3;

/**
 * Hodnoty podle pravidel (`api.cardRank`; kamenná žádnou nemá). Skórující debuffnutá karta se nepočítá („nedává
 * nic“), karta v ruce ano — debuffnutá i lícem dolů v ruce pořád je. Jednou za ruku, ne za každou shodu.
 */
const charlesBridge: JokerDef = {
  id: 'charles_bridge',
  rarity: 'epic',
  cost: 9,
  tags: ['xmult', 'rank'],
  params: { xmult: BRIDGE_XMULT },
  hooks: {
    onHandPlayed: (ctx) => {
      const ranks = new Set<Rank>();
      for (const c of ctx.scoring) {
        const r = c.debuffed ? null : ctx.api.cardRank(c);
        if (r !== null) ranks.add(r);
      }
      const bridged = ctx.held.some((c) => {
        const r = ctx.api.cardRank(c);
        return r !== null && ranks.has(r);
      });
      return bridged ? { xmult: BRIDGE_XMULT } : null;
    },
  },
  art: {
    icon: 'old-lantern',
    prop: 'crown',
    bg: '#2b2a3a',
    fg: '#f3e9d2',
    accent: '#d4af37',
    pattern: 'grid',
  },
};

// ─────────────────────────── Dálnice D1 ───────────────────────────

const D1_XMULT = 2;
const D1_HAND_SIZE = 1;

/**
 * −1 karta v ruce jako `passive` (platí od nejbližšího dobrání; prodejem se vrátí). Kopie dá jen ×2 — `passive` se
 * nekopíruje (jako u Kolotoče).
 */
const d1Motorway: JokerDef = {
  id: 'd1_motorway',
  rarity: 'epic',
  cost: 8,
  tags: ['xmult', 'utility'],
  params: { xmult: D1_XMULT, cards: D1_HAND_SIZE },
  hooks: {
    passive: () => ({ handSize: -D1_HAND_SIZE }),
    onHandPlayed: () => ({ xmult: D1_XMULT }),
  },
  art: {
    icon: 'traffic-cone',
    prop: 'flat-tire',
    bg: '#3a3f44',
    fg: '#fff4e0',
    accent: '#ff8c1a',
    pattern: 'stripes',
  },
};

// ─────────────────────────── Směnárna ───────────────────────────

const EXCHANGE_BASE = 1;
const EXCHANGE_XMULT = 0.1;
const EXCHANGE_CHIPS = 15;
/**
 * Fáze 10: strop 2,5 → 2,1 — s dvojnásobnými přírůstky úrovní mají ruce víc čipů a strop platil skoro vždy (R2 122 %).
 * 1.0.1: 2,1 → 1,9 — „čipová“ tabulka kombinací dává ještě víc čipů (R2 118 %).
 */
const EXCHANGE_MAX = 1.9;

/**
 * Čipy v okamžiku kroku 4 na pozici Směnárny (`ctx.chips`: základ, karty, žolíci nalevo a vlastní lesklá edice — edice
 * „před“ platí před vlastním efektem, DESIGN 3.1). Celé kroky po 15 čipech, nejvýš ×2,5 (od 225 čipů), aby čipový
 * build nebyl „auto-win“. Bez kroku nic.
 */
const exchangeOffice: JokerDef = {
  id: 'exchange_office',
  rarity: 'epic',
  cost: 9,
  unlock: { type: 'stat', stat: 'moneyEarned', atLeast: 500 },
  tags: ['xmult'],
  params: { base: EXCHANGE_BASE, xmult: EXCHANGE_XMULT, chips: EXCHANGE_CHIPS, max: EXCHANGE_MAX },
  hooks: {
    onHandPlayed: (ctx) => {
      const steps = Math.floor(Math.max(0, ctx.chips) / EXCHANGE_CHIPS);
      const xmult = Math.min(EXCHANGE_MAX, cents(EXCHANGE_BASE + EXCHANGE_XMULT * steps));
      return xmult > EXCHANGE_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'banknote',
    prop: 'scales',
    bg: '#1e4d2b',
    fg: '#eefbea',
    accent: '#f4d35e',
    pattern: 'grid',
  },
};

// ─────────────────────────── Silvestr ───────────────────────────

const NYE_BASE = 1;
/** 1.0.1: 0,2 → 0,18 (R2 117 % nad pásmem epického; fáze 10 už těsně na hranici). */
const NYE_XMULT = 0.18;

const nyeXmult = (self: JokerInstance): number => cents(NYE_BASE + NYE_XMULT * stateNum(self, 'bosses'));

/** Počítá šéfy poražené od chvíle, kdy je ve slotu (`onBossDefeated`); kopie stav nemění, jen násobí. */
const newYearsEve: JokerDef = {
  id: 'new_years_eve',
  rarity: 'epic',
  cost: 8,
  unlock: { type: 'winRun' },
  tags: ['xmult', 'scaling'],
  params: { xmult: NYE_XMULT },
  initState: () => ({ bosses: 0 }),
  describe: (self) => ({ current: nyeXmult(self) }),
  noPerishable: true,
  hooks: {
    onBossDefeated: (ctx) => {
      if (ctx.isCopy) return;
      ctx.self.state.bosses = stateNum(ctx.self, 'bosses') + 1;
    },
    onHandPlayed: (ctx) => {
      const xmult = nyeXmult(ctx.self);
      return xmult > NYE_BASE ? { xmult } : null;
    },
  },
  art: {
    icon: 'firework-rocket',
    prop: 'alarm-clock',
    bg: '#14143a',
    fg: '#fdf6e3',
    accent: '#ff5d8f',
    pattern: 'rays',
  },
};

export const EPIC2_JOKERS: JokerDef[] = [
  beerSommelier,
  archivist,
  fairMagician,
  tourGuide,
  spartakiada,
  voucherPrivatization,
  spaGuest,
  brassBand,
  charlesBridge,
  d1Motorway,
  exchangeOffice,
  newYearsEve,
];
