/**
 * Žolíci — vzácní (fáze 7, docs/DESIGN.md 4.9). Texty v src/i18n/cs/jokers/rare2.ts. Návod: docs/CONTENT-GUIDE.md.
 *
 * 15 žolíků ze zásobníku nápadů DESIGN 4.9 (Známý na úřadě … Vyšlapaná pěšina) + 7 vlastních na úřady, historii,
 * internet a Hradec vs. Brno. Čísla mechanik jsou jen v konstantách níže — stejné hodnoty čte hook i popisek
 * (`params`, `describe`). Nečíselné `params` (`suit`, `hand`) jsou nápověda pro boty simulace, popisky je nečtou.
 * Výklad mechanik a naměřené hodnoty: docs/DECISIONS.md („Vzácní žolíci fáze 7“).
 */
import type { JokerCtx, JokerDef } from '../../engine/content-types';
import type { Card, JokerInstance, Modifiers, Rank, Suit } from '../../engine/types';
import { RANKS, SUITS } from '../../engine/types';

// ─────────────────────────── Čísla ───────────────────────────

/** Známý na úřadě: o kolik procent je cíl šéfa nižší. */
const CONNECTION_PCT = 20;
/** Kronikář: trvalý mult za každou kombinaci zahranou od koupě poprvé. */
const CHRONICLER_MULT = 2;
/** Kominík: „1 z 2“ za každou skórující pikovou, křížovou nebo šťastnou kartu. */
const SWEEP_CHANCE = 1;
const SWEEP_ODDS = 2;
const SWEEP_MULT = 6;
const SWEEP_SUITS: readonly Suit[] = ['S', 'C'];
/** Sklář: kolik skleněných karet přidá do balíčku při získání. */
const GLASSBLOWER_CARDS = 1;
/** Vodník: trvalý mult za každou zahozenou srdcovou kartu. 1.0.1: 1 → 0,75 (R2 71 % nad pásmem vzácného, Δ výher +23 p. b.). */
const WATER_GOBLIN_MULT = 0.75;
const WATER_GOBLIN_SUIT: Suit = 'H';
/** Bludička: ×mult v kole se šéfem („svítí jen v noci“, rodina s Noční směnou). */
const WISP_XMULT = 2;
/** Polednice: ×mult ve druhé ruce kola (index 1 = jedna ruka už se hrála). */
const NOON_XMULT = 2;
const NOON_HAND_INDEX = 1;
/** Klekánice: ×mult, když v ruce nezůstala žádná figura. */
const KLEKANICE_XMULT = 2;
/**
 * Pan farář: +mult za každou kartu plného balíčku s vylepšením, pečetí nebo edicí („farníka“). Fáze 10: +5 → +2,5 —
 * boti upravují víc karet; s +5 špička R2 228 %, s +3 142 % (> 2× horní hranice vzácného), s +2 R2 19 % (pod
 * pásmem); +2,5 ≈ R2 24–27 %, špička ~115 %.
 */
const PRIEST_MULT = 2.5;
/** Válečná kořist: Kč na konci kola za každého šéfa poraženého od koupě. */
const LOOT_MONEY = 2;
/** Anonymní diskutér: +mult za každou zahranou kartu, která neskóruje. */
const COMMENTER_MULT = 7;
/** Virální video: čipy první ruky kola; každá další ruka kola polovinu předchozí (dolů). */
const VIRAL_CHIPS = 64;
/** Defenestrace: Kč za zahození, ve kterém je aspoň jedna figura. */
const DEFENESTRATION_MONEY = 5;
/** Brňák: ×mult, když stojí v řadě žolíků úplně vlevo. */
const BRNO_XMULT = 1.5;
/**
 * Sociální bublina: +čipy za každou skórující kartu, když mají všechny skórující stejnou barvu nebo hodnotu. 1.0.1: 15 → 30
 * (R1 32 %, R2 11 % — pod pásmem vzácného s „čipovou“ tabulkou kombinací).
 */
const BUBBLE_CHIPS = 30;

/** Hlášky žolíků (i18n klíče). */
const MSG_CONNECTION = 'jokers.office_connection.rerolled';
const MSG_GLASS = 'jokers.glassblower.blown';
const MSG_NOTARY = 'jokers.notary_public.certified';
const MSG_WITCH = 'jokers.witch.brewed';
const MSG_SEER = 'jokers.seer.foreseen';
const MSG_DEFENESTRATION = 'jokers.defenestration.thrown';
const MSG_PORTRAIT = 'jokers.court_painter.painted';

/** Dvorní malíř: hodnoty figur, které maluje (kluk, dáma, král). */
const PORTRAIT_RANKS: readonly Rank[] = [11, 12, 13];

/** Id vylepšení a pečetí (src/content/modifiers.ts). */
const GLASS = 'glass';
const LUCKY = 'lucky';
const GOLD_SEAL = 'gold';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Číslo ze stavu instance (chybějící nebo poškozená hodnota = výchozí). */
function num(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Kronikář: kombinace zahrané od koupě (poškozený stav = žádné). */
function seenHands(self: JokerInstance): string[] {
  const v = self.state.seen;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Má karta vylepšení, které zrovna platí (Bílá hora vylepšení vypíná)? */
function hasEnhancement(card: Card, mods: Readonly<Modifiers>, id?: string): boolean {
  if (card.enhancement === null || mods.disableEnhancements) return false;
  return id === undefined || card.enhancement === id;
}

/** Sociální bublina: mají všechny nedebuffnuté skórující karty stejnou barvu nebo stejnou hodnotu? */
function inBubble(ctx: JokerCtx & { readonly scoring: readonly Card[] }): boolean {
  const cards = ctx.scoring.filter((c) => !c.debuffed);
  if (cards.length === 0) return false;
  const rank = ctx.api.cardRank(cards[0]!);
  if (rank !== null && cards.every((c) => ctx.api.cardRank(c) === rank)) return true;
  return SUITS.some((s) => cards.every((c) => ctx.api.hasSuit(c, s)));
}

/** Přičte `delta` k číselnému stavu (kopie stav nemění). */
function grow(ctx: JokerCtx, key: string, delta: number): void {
  if (ctx.isCopy || delta <= 0) return;
  ctx.self.state[key] = num(ctx.self, key) + delta;
}

// ─────────────────────────── Žolíci ───────────────────────────

export const RARE2_JOKERS: JokerDef[] = [
  // ── ze zásobníku DESIGN 4.9 ──
  {
    // Cíl šéfa se počítá z modifikátorů při výběru útraty (`bossTargetMult` se násobí). Přelosování jde přes
    // `api.rerollBoss` (jen dokud kolo šéfa nezačalo) — po přeskočení Malé i Velké útraty tedy vždy projde.
    // `passive` i efekt mimo kolo kopie nepřenese — `copyable: false` (DESIGN 4.4/7).
    id: 'office_connection',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'beatBoss', boss: 'tax_audit' },
    tags: ['utility'],
    params: { pct: CONNECTION_PCT },
    copyable: false,
    hooks: {
      passive: () => ({ bossTargetMult: 1 - CONNECTION_PCT / 100 }),
      onSkipBlind: (ctx) => {
        if (ctx.api.rerollBoss() !== null) ctx.api.message(MSG_CONNECTION);
      },
    },
    art: {
      icon: 'stamper',
      prop: 'key',
      bg: '#3b4a5c',
      fg: '#eef2f7',
      accent: '#d4a72c',
      pattern: 'grid',
    },
  },
  {
    // Kombinace se zapíše v `beforeScoring` (ruka zakázaná šéfem se nepočítá), takže platí už pro tuto ruku.
    // Kopie stav nemění, jen ho čte. Strop je přirozený: 13 kombinací (s tajnými).
    id: 'chronicler',
    rarity: 'rare',
    cost: 7,
    tags: ['mult', 'scaling', 'hand'],
    params: { mult: CHRONICLER_MULT },
    initState: () => ({ seen: [] }),
    describe: (self) => ({ current: seenHands(self).length * CHRONICLER_MULT }),
    noPerishable: true,
    hooks: {
      beforeScoring: (ctx) => {
        if (ctx.isCopy) return;
        const seen = seenHands(ctx.self);
        if (!seen.includes(ctx.hand.type)) ctx.self.state.seen = [...seen, ctx.hand.type];
      },
      onHandPlayed: (ctx) => {
        const mult = seenHands(ctx.self).length * CHRONICLER_MULT;
        return mult > 0 ? { mult } : null;
      },
    },
    art: {
      icon: 'open-book',
      prop: 'quill-ink',
      bg: '#4b3621',
      fg: '#f6ead2',
      accent: '#c8a24a',
      pattern: 'stripes',
    },
  },
  {
    // Divoká karta je piková i křížová; kamenná nemá barvu. Šťastná jen tehdy, když vylepšení platí. Hod jen za kartu,
    // která podmínku splní (stream `joker`), při každé aktivaci (červená pečeť = dvě šance).
    id: 'chimney_sweep',
    rarity: 'rare',
    cost: 6,
    tags: ['mult', 'suit'],
    params: { chance: SWEEP_CHANCE, odds: SWEEP_ODDS, mult: SWEEP_MULT, suit: 'S' },
    hooks: {
      onCardScored: (ctx) => {
        const c = ctx.card;
        const lucky = hasEnhancement(c, ctx.mods, LUCKY);
        if (!lucky && !SWEEP_SUITS.some((s) => ctx.api.hasSuit(c, s))) return null;
        return ctx.chance(SWEEP_CHANCE, SWEEP_ODDS) ? { mult: SWEEP_MULT } : null;
      },
    },
    art: {
      icon: 'top-hat',
      prop: 'clover',
      bg: '#1c1c22',
      fg: '#f2f2f2',
      accent: '#e8c547',
      pattern: 'dots',
    },
  },
  {
    // Skleněné karty z `onAcquire` mají náhodnou hodnotu a barvu (stream `joker`). „Vyfouknout znovu“ = do balíčku
    // (v kole na náhodné místo dobíracího balíčku) přibude stejná karta (hodnota, barva, pečeť, edice, bonusové čipy).
    // Jen první Sklář v řadě a ne kopie: dva by každou prasklou kartu zdvojily (smyčka) — `copyable: false`.
    id: 'glassblower',
    rarity: 'rare',
    cost: 7,
    unlock: { type: 'stat', stat: 'glassBroken', atLeast: 5 },
    tags: ['deck', 'xmult'],
    params: { cards: GLASSBLOWER_CARDS },
    copyable: false,
    hooks: {
      onAcquire: (ctx) => {
        for (let i = 0; i < GLASSBLOWER_CARDS; i++) {
          const suit = ctx.rng.pick(SUITS);
          const rank = ctx.rng.pick(RANKS);
          ctx.api.addCard({ suit, rank, enhancement: GLASS }, { source: 'glassblower' });
        }
      },
      onCardDestroyed: (ctx) => {
        if (ctx.isCopy || ctx.card.enhancement !== GLASS) return;
        const first = ctx.state.jokers.find((j) => j.defId === ctx.def.id && !j.debuffed);
        if (first?.uid !== ctx.self.uid) return;
        const c = ctx.card;
        ctx.api.addCard(
          {
            suit: c.suit,
            rank: c.rank,
            enhancement: GLASS,
            seal: c.seal,
            edition: c.edition,
            bonusChips: c.bonusChips,
          },
          { source: 'glassblower' },
        );
        ctx.api.message(MSG_GLASS);
      },
    },
    art: {
      icon: 'wine-bottle',
      prop: 'fire',
      bg: '#1f5f6b',
      fg: '#e6fbff',
      accent: '#ff9f43',
      pattern: 'waves',
    },
  },
  {
    // Před skórováním první ruky kola Malé nebo Velké útraty (v kole šéfa ne — i na Imperialu, kde má Velká útrata
    // pravidlo šéfa, je to pořád Velká): první skórující karta (pořadí zahrání), která není debuffnutá a nemá pečeť.
    // Zlatá pečeť platí hned (pečeť se čte až v kroku 2). Kopie orazítkuje další kartu — chová se jako druhá instance.
    id: 'notary_public',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'stat', stat: 'maxSealedCards', atLeast: 3 },
    tags: ['economy', 'deck'],
    noRental: true,
    hooks: {
      beforeScoring: (ctx) => {
        if (!ctx.firstHand || ctx.round.blind === 'boss') return null;
        const card = ctx.scoring.find((c) => !c.debuffed && c.seal === null);
        if (!card) return null;
        ctx.api.modifyCard(card.id, { seal: GOLD_SEAL });
        // Hláška jako událost, ne krok skórování (krok bez čipů v kroku 1 by se pletl s edicí).
        ctx.api.message(MSG_NOTARY);
        return null;
      },
    },
    art: {
      icon: 'scroll-unfurled',
      prop: 'coins',
      bg: '#2e2a4f',
      fg: '#f3efff',
      accent: '#e2b93b',
      pattern: 'checker',
    },
  },
  {
    // `onBossDefeated` běží při výhře kola šéfa (před rozpisem odměn). Bez volného slotu nevznikne nic. Výjimka
    // z vyhlášky má v losování razítek váhu 0,25 jako jinde.
    id: 'witch',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'useConsumable', kind: 'razitko', count: 5 },
    tags: ['consumable'],
    hooks: {
      onBossDefeated: (ctx) => {
        if (ctx.api.createConsumable({ kind: 'razitko' })) ctx.api.message(MSG_WITCH);
      },
    },
    art: {
      icon: 'witch-face',
      prop: 'stamper',
      bg: '#2d1e3e',
      fg: '#efe3ff',
      accent: '#7bd389',
      pattern: 'zigzag',
    },
  },
  {
    // Jen zahození hráčem (`onDiscard`); divoká karta je i srdcová. Debuff zahozené karty nevadí (stejně jako
    // u Popeláře). Kopie stav nemění, jen ho čte.
    id: 'water_goblin',
    rarity: 'rare',
    cost: 6,
    tags: ['mult', 'scaling', 'discard'],
    params: { mult: WATER_GOBLIN_MULT },
    initState: () => ({ mult: 0 }),
    describe: (self) => ({ current: num(self, 'mult') }),
    noPerishable: true,
    hooks: {
      onDiscard: (ctx) => {
        const hearts = ctx.discarded.filter((c) => ctx.api.hasSuit(c, WATER_GOBLIN_SUIT)).length;
        grow(ctx, 'mult', hearts * WATER_GOBLIN_MULT);
      },
      onHandPlayed: (ctx) => {
        const mult = num(ctx.self, 'mult');
        return mult > 0 ? { mult } : null;
      },
    },
    art: {
      icon: 'frog',
      prop: 'hearts',
      bg: '#1d4d3a',
      fg: '#e2f7ea',
      accent: '#7ec8e3',
      pattern: 'waves',
    },
  },
  {
    // Kolo se šéfem = `round.bossId !== null` jako u Noční směny (i Velká útrata se šéfem na Imperialu; vypnutý šéf
    // na tom nic nemění). Dřív „1 z 3 ×2“ — duplikát Zpožděného rychlíku (náhodný ×mult za ruku), DECISIONS revize fáze 7.
    id: 'will_o_wisp',
    rarity: 'rare',
    cost: 6,
    tags: ['xmult'],
    params: { xmult: WISP_XMULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.round.bossId !== null ? { xmult: WISP_XMULT } : null),
    },
    art: {
      icon: 'lantern',
      prop: 'sparkles',
      bg: '#16261f',
      fg: '#e9ffe0',
      accent: '#b6f36b',
      pattern: 'dots',
    },
  },
  {
    // Pořadí ruky = `round.handsPlayed` před touto rukou (ruka zakázaná šéfem se počítá — spotřebovala se).
    id: 'noon_witch',
    rarity: 'rare',
    cost: 6,
    tags: ['xmult'],
    params: { xmult: NOON_XMULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.round.handsPlayed === NOON_HAND_INDEX ? { xmult: NOON_XMULT } : null),
    },
    art: {
      icon: 'sun',
      prop: 'scythe',
      bg: '#b5651d',
      fg: '#fff6e0',
      accent: '#ffe066',
      pattern: 'rays',
    },
  },
  {
    // Všechny karty, které po zahrání zůstaly v ruce (i debuffnuté — v ruce pořád jsou); figura podle enginu
    // (respektuje „všechny karty jsou figury“, kamenná figura není). Prázdná ruka podmínku splní.
    id: 'klekanice',
    rarity: 'rare',
    cost: 6,
    tags: ['xmult', 'face'],
    params: { xmult: KLEKANICE_XMULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.held.some((c) => ctx.api.isFace(c)) ? null : { xmult: KLEKANICE_XMULT }),
    },
    art: {
      icon: 'ringing-bell',
      prop: 'ghost',
      bg: '#232a4a',
      fg: '#e8ecff',
      accent: '#9aa8ff',
      pattern: 'stripes',
    },
  },
  {
    // Plný balíček = všechny karty runu (`state.deck`), i ty v ruce, na stole a v odhazovací hromádce. Vylepšení se
    // počítá, jen když platí (Bílá hora ho vypíná); pečeť a edice vždy. Karta se počítá jednou, ať má úprav kolik chce.
    id: 'parish_priest',
    rarity: 'rare',
    cost: 6,
    tags: ['mult', 'deck'],
    params: { mult: PRIEST_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const flock = ctx.state.deck.filter(
          (c) => hasEnhancement(c, ctx.mods) || c.seal !== null || c.edition !== null,
        ).length;
        return flock > 0 ? { mult: flock * PRIEST_MULT } : null;
      },
    },
    art: {
      icon: 'church',
      prop: 'candle-light',
      bg: '#3a3a3a',
      fg: '#fafafa',
      accent: '#f4d06f',
      pattern: 'grid',
    },
  },
  {
    // „Jediná ruka“ = skóre této ruky samo dosáhne celého cíle Malé útraty (nejvýš jednou za patro). Pranostika jde
    // do volného slotu; bez místa (nebo bez pranostiky na tuto kombinaci) nevznikne nic.
    id: 'seer',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'useConsumable', kind: 'pranostika', count: 10 },
    tags: ['consumable', 'hand'],
    hooks: {
      afterHandScored: (ctx) => {
        if (ctx.round.blind !== 'small' || ctx.score < ctx.round.target) return;
        if (ctx.api.createConsumable({ forHand: ctx.hand.type })) ctx.api.message(MSG_SEER);
      },
    },
    art: {
      icon: 'eyeball',
      prop: 'crystal-ball',
      bg: '#3d1f47',
      fg: '#fbeaff',
      accent: '#ff8ad8',
      pattern: 'rays',
    },
  },
  {
    // 1.0.1 (dřív „všechny karty jsou figury“): po první ruce kola namaluje první skórující kartu, která není figura
    // a má hodnotu (kamenná ne), jako náhodnou figuru stejné barvy — trvale (stream `joker`). Kopie namaluje další.
    id: 'court_painter',
    rarity: 'rare',
    cost: 6,
    tags: ['utility', 'face', 'deck'],
    hooks: {
      afterHandScored: (ctx) => {
        if (!ctx.firstHand) return;
        const card = ctx.scoring.find(
          (c) => !c.debuffed && ctx.api.cardRank(c) !== null && !ctx.api.isFace(c),
        );
        if (!card) return;
        ctx.api.modifyCard(card.id, { rank: ctx.rng.pick(PORTRAIT_RANKS) });
        ctx.api.message(MSG_PORTRAIT);
      },
    },
    art: {
      icon: 'king',
      prop: 'window',
      bg: '#5c2a3a',
      fg: '#ffeef2',
      accent: '#e6b85c',
      pattern: 'checker',
    },
  },
  {
    // Čisté pravidlo (`passive`) — kopírovat nejde. Platí pro detekci Barvy i pro žolíky, kteří čtou barvu karty
    // (`api.hasSuit`).
    id: 'colorblind_uncle',
    rarity: 'rare',
    cost: 6,
    tags: ['utility', 'suit'],
    copyable: false,
    hooks: {
      passive: () => ({ mergedSuits: true }),
    },
    art: {
      icon: 'spectacles',
      prop: 'diamonds',
      bg: '#6b5b3e',
      fg: '#fff7e6',
      accent: '#c94f4f',
      pattern: 'zigzag',
    },
  },
  {
    // Čisté pravidlo (`passive`) — kopírovat nejde. 1.0.1: v celé Postupce smí chybět jen jedna hodnota (dřív mezi
    // každými dvěma kartami). `hand` čtou boti (styl „Postupky“), v popisku není.
    id: 'trodden_path',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'stat', stat: 'blindsSkipped', atLeast: 10 },
    tags: ['utility', 'hand'],
    params: { hand: 'straight' },
    copyable: false,
    hooks: {
      passive: () => ({ straightGaps: true }),
    },
    art: {
      icon: 'footprint',
      prop: 'sunflower',
      bg: '#55702f',
      fg: '#f4f9e4',
      accent: '#e9c46a',
      pattern: 'stripes',
    },
  },

  // ── vlastní: úřady, historie, internet a memy, Hradec vs. Brno ──
  {
    // Počítá šéfy poražené od koupě (`onBossDefeated` běží před rozpisem odměn, takže šéf vydělá už v kole, kdy
    // padl). Rozpis odměn engine kopírujícím žolíkům nepočítá — `copyable: false`.
    id: 'war_loot',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'beatBoss', count: 10 },
    tags: ['economy', 'scaling'],
    params: { money: LOOT_MONEY },
    initState: () => ({ bosses: 0 }),
    describe: (self) => ({ current: num(self, 'bosses') * LOOT_MONEY }),
    copyable: false,
    noRental: true,
    noPerishable: true,
    hooks: {
      onBossDefeated: (ctx) => grow(ctx, 'bosses', 1),
      roundEndMoney: (ctx) => num(ctx.self, 'bosses') * LOOT_MONEY,
    },
    art: {
      icon: 'flail',
      prop: 'old-wagon',
      bg: '#5a4a2f',
      fg: '#f7efdc',
      accent: '#b23a3a',
      pattern: 'checker',
    },
  },
  {
    // „Neskóruje“ = zahraná karta mimo kombinaci (kopa); debuffnutá karta v kombinaci se nepočítá. S pravidlem
    // „skórují všechny zahrané karty“ nedá nic.
    id: 'anonymous_commenter',
    rarity: 'rare',
    cost: 6,
    tags: ['mult'],
    params: { mult: COMMENTER_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const scoring = new Set(ctx.scoring.map((c) => c.id));
        const kickers = ctx.played.filter((c) => !scoring.has(c.id)).length;
        return kickers > 0 ? { mult: kickers * COMMENTER_MULT } : null;
      },
    },
    art: {
      icon: 'laptop',
      prop: 'thumb-down',
      bg: '#24303f',
      fg: '#e9f1fb',
      accent: '#ff6b6b',
      pattern: 'grid',
    },
  },
  {
    // Pořadí ruky = `round.handsPlayed` před touto rukou: 64, 32, 16, 8, 4, 2, 1, pak nic.
    id: 'viral_video',
    rarity: 'rare',
    cost: 6,
    tags: ['chips'],
    params: { chips: VIRAL_CHIPS },
    hooks: {
      onHandPlayed: (ctx) => {
        const chips = Math.floor(VIRAL_CHIPS / 2 ** ctx.round.handsPlayed);
        return chips > 0 ? { chips } : null;
      },
    },
    art: {
      icon: 'smartphone',
      prop: 'play-button',
      bg: '#7a1f5c',
      fg: '#ffe9f6',
      accent: '#ffd23f',
      pattern: 'rays',
    },
  },
  {
    // Cíl = nejpravější běžný nebo vzácný žolík (kromě sebe), který jde kopírovat (`api.jokerCopyable` — nekopírovatelné
    // a kopírující se přeskočí). Epické a legendární ne (na hvězdy nemá, jako Napodobitel). Debuffnutého cíle engine
    // nekopíruje (kopie pak nedá nic, další se nehledá). Sám `copyable: false` (DESIGN 4.4/7). Cíl zapisuje do
    // `state.target` (konvence UI a botů jako u Napodobitele a Archiváře — bez ní tooltip hlásil „nemá koho kopírovat“).
    id: 'carbon_paper',
    rarity: 'rare',
    cost: 7,
    unlock: { type: 'stat', stat: 'jokersBought', atLeast: 15 },
    tags: ['copy'],
    copyable: false,
    initState: () => ({ target: null }),
    hooks: {
      copyTarget: (ctx) => {
        let uid: number | null = null;
        for (let i = ctx.state.jokers.length - 1; i >= 0 && uid === null; i--) {
          const j = ctx.state.jokers[i]!;
          if (j.uid === ctx.self.uid || !ctx.api.jokerCopyable(j.defId)) continue;
          const rarity = ctx.api.jokerRarity(j.defId);
          if (rarity === 'common' || rarity === 'rare') uid = j.uid;
        }
        if (!ctx.isCopy && ctx.self.state.target !== uid) ctx.self.state.target = uid;
        return uid;
      },
    },
    art: {
      icon: 'save',
      prop: 'papers',
      bg: '#1e3a6e',
      fg: '#e6efff',
      accent: '#8fb3ff',
      pattern: 'stripes',
    },
  },
  {
    // Figura podle enginu (respektuje „všechny karty jsou figury“); debuff zahozené karty nevadí. Jednou za zahození,
    // ať je figur kolik chce. Peníze hned (mimo rozpis odměn); kopie dá peníze znovu (druhá instance).
    id: 'defenestration',
    rarity: 'rare',
    cost: 6,
    unlock: { type: 'stat', stat: 'cardsDiscarded', atLeast: 150 },
    tags: ['economy', 'discard', 'face'],
    params: { money: DEFENESTRATION_MONEY },
    noRental: true,
    hooks: {
      onDiscard: (ctx) =>
        ctx.discarded.some((c) => ctx.api.isFace(c))
          ? { money: DEFENESTRATION_MONEY, message: MSG_DEFENESTRATION }
          : null,
    },
    art: {
      icon: 'exit-door',
      prop: 'king',
      bg: '#4a3f6b',
      fg: '#f1edff',
      accent: '#d98e48',
      pattern: 'grid',
    },
  },
  {
    // Pozice = `ctx.index`. Kopie by násobila jen na pozici kopírujícího žolíka — úplně vlevo může stát jen jeden
    // z nich, takže by nepřidala nic: `copyable: false` (Napodobitel ho nevybere).
    id: 'brno_native',
    rarity: 'rare',
    cost: 6,
    tags: ['xmult'],
    params: { xmult: BRNO_XMULT },
    copyable: false,
    hooks: {
      onHandPlayed: (ctx) => (ctx.index === 0 ? { xmult: BRNO_XMULT } : null),
    },
    art: {
      icon: 'dragon-head',
      prop: 'trophy',
      bg: '#8c1c2b',
      fg: '#fff0f0',
      accent: '#3d7ab8',
      pattern: 'zigzag',
    },
  },
  {
    // Stejná barva = existuje barva, kterou mají všechny nedebuffnuté skórující karty (divoká patří do všech, kamenná
    // do žádné, „sloučené barvy“ platí); stejná hodnota = všechny mají tutéž hodnotu podle pravidel (`api.cardRank`;
    // kamenná žádnou). Jedna skórující karta podmínku splní vždy. Čipy dá každá nedebuffnutá skórující karta při každé
    // aktivaci (červená pečeť = dvakrát).
    id: 'social_bubble',
    rarity: 'rare',
    cost: 6,
    tags: ['chips', 'suit', 'rank'],
    params: { chips: BUBBLE_CHIPS },
    hooks: {
      onCardScored: (ctx) => (inBubble(ctx) ? { chips: BUBBLE_CHIPS } : null),
    },
    art: {
      icon: 'thumb-up',
      prop: 'fluffy-cloud',
      bg: '#2b5f8a',
      fg: '#eaf6ff',
      accent: '#ffcf56',
      pattern: 'dots',
    },
  },
];
