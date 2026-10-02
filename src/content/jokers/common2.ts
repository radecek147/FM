/**
 * Žolíci — běžní (fáze 7, docs/DESIGN.md 4.9). Texty v src/i18n/cs/jokers/common2.ts. Návod: docs/CONTENT-GUIDE.md.
 *
 * 15 žolíků ze zásobníku nápadů DESIGN 4.9 (Teta z poradny … Sázkař) + 14 vlastních na hospodu, panelák, chataření,
 * pouť, zabijačku, Silvestr, výluku, MHD a sousedy. Čísla mechanik jsou jen v konstantách níže — stejné hodnoty čte
 * hook i popisek (`params`, `describe`). Výklad mechanik a naměřené hodnoty: docs/DECISIONS.md („Běžní žolíci fáze 7“).
 */
import type { JokerCtx, JokerDef } from '../../engine/content-types';
import type { Card, JokerInstance, Modifiers, Rank, Suit } from '../../engine/types';

// ─────────────────────────── Čísla ───────────────────────────

/** Teta z poradny: po použité babské radě „1 z 2“, že vznikne další. */
const AUNT_CHANCE = 1;
const AUNT_ODDS = 2;
/** Chatař: +mult za každý prázdný slot spotřebky. */
const COTTAGER_MULT = 3;
/** Střelec z pouti: +mult za každou skórující desítku nebo figuru. */
const SHOOTER_MULT = 3;
const SHOOTER_RANK: Rank = 10;
/** Trafikant: při vstupu do Večerky „1 z 2“ pranostika. */
const TOBACCONIST_CHANCE = 1;
const TOBACCONIST_ODDS = 2;
/** Revizor: +čipy, když mezi zahranými kartami není figura. */
const INSPECTOR_CHIPS = 50;
/** Vrátný: +mult za každou figuru drženou v ruce. */
const DOORMAN_MULT = 4;
/** Dlaždič: +mult za každou skórující kamennou kartu. */
const PAVER_MULT = 5;
/** Pošťák: Kč za každou otevřenou obálku. */
const POSTMAN_MONEY = 3;
/** Hokynář: +mult za každého běžného žolíka jiného druhu. */
const GROCER_MULT = 2;
/** Táta u grilu: +čipy, když se v kole zahazovalo právě tolikrát. */
const GRILL_CHIPS = 60;
const GRILL_DISCARDS = 1;
/** Učitelka: +mult, když mají všechny skórující karty sudou hodnotu. */
const TEACHER_MULT = 15;
const EVEN_RANKS: readonly Rank[] = [2, 4, 6, 8, 10];
/** Hejkal: „1 z 3“ +mult. */
const HEJKAL_CHANCE = 1;
const HEJKAL_ODDS = 3;
const HEJKAL_MULT = 15;
/** Tramvaják: +mult, když to není první ruka kola a už se zahazovalo. Fáze 10: +15 → +18 (R1 32 %, pod pásmem). */
const TRAM_MULT = 18;
/** Sázkař: na konci kola „1 z 3“ výhra. */
const PUNTER_CHANCE = 1;
const PUNTER_ODDS = 3;
const PUNTER_MONEY = 7;
/** Drbna z pavlače: ×mult za stejnou kombinaci jako v minulé ruce. */
const GOSSIP_XMULT = 1.5;
/** Rundu všem: ×mult, když zahraješ tolik karet a všechny skórují. */
const ROUND_XMULT = 1.4;
const ROUND_CARDS = 5;
/** Nakládaný hermelín: +čipy za každou kartu drženou v ruce. */
const CHEESE_CHIPS = 6;
/** Třináctý plat: Kč navíc v odměnách za poraženého šéfa. */
const SALARY_MONEY = 8;
/** Brigádník: Kč za každou ruku zahranou v kole. */
const TEMP_MONEY = 2;
/** Rybář: po každém zahození („nahození udice“) „1 z 2“, že přinese náhodnou babskou radu. */
const FISHER_CHANCE = 1;
const FISHER_ODDS = 2;
/** Popelář: trvalé čipy za každou zahozenou kartu s hodnotou nejvýš GARBAGE_RANK („odpad“). */
const GARBAGE_CHIPS = 1;
const GARBAGE_RANK: Rank = 5;
/** Hrací automat: kolikrát navíc skórují karty s nejvyšší hodnotou. */
const JUKEBOX_RETRIGGERS = 1;
/** Kůlna: sloty spotřebek navíc. */
const SHED_SLOTS = 1;
/** Náhradní autobus: prvních N zahození v kole zvětší ruku o tolik karet. */
const BUS_DISCARDS = 2;
const BUS_CARDS = 1;
/** Zabijačka: Kč za zničenou kartu na konci kola. */
const SLAUGHTER_MONEY = 2;
/** Městské derby: +mult, když skórují červená i černá barva. */
const DERBY_MULT = 8;
/** Hospodský kvíz: +čipy za každou různou hodnotu mezi skórujícími kartami. */
const QUIZ_CHIPS = 10;
/** Sběrna surovin: trvalý mult za každou zničenou hrací kartu, nejvýš SCRAP_MAX (strop kvůli Zabijačce). */
const SCRAP_MULT = 3;
const SCRAP_MAX = 21;

/** Hlášky žolíků (i18n klíče). */
const MSG_AUNT = 'jokers.helpline_aunt.advice';
const MSG_TOBACCONIST = 'jokers.tobacconist.forecast';
const MSG_POSTMAN = 'jokers.postman.delivered';
const MSG_FISHER = 'jokers.fisherman.catch';
const MSG_PAVER = 'jokers.paver.paved';
const MSG_GOLDSMITH = 'jokers.goldsmith.gilded';
const MSG_SLAUGHTER = 'jokers.pig_slaughter.feast';

/** Id vylepšení (src/content/modifiers.ts). */
const STONE = 'stone';
const GOLD = 'gold';

const RED: readonly Suit[] = ['H', 'D'];
const BLACK: readonly Suit[] = ['S', 'C'];

// ─────────────────────────── Pomocníci ───────────────────────────

/** Číslo ze stavu instance (chybějící nebo poškozená hodnota = výchozí). */
function num(self: JokerInstance, key: string, fallback = 0): number {
  const v = self.state[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Kamenná karta, pokud vylepšení zrovna platí (Bílá hora je vypíná). */
function isStone(card: Card, mods: Readonly<Modifiers>): boolean {
  return card.enhancement === STONE && !mods.disableEnhancements;
}

/**
 * Prázdné sloty spotřebek — stejně jako je počítá engine pro novou spotřebku bez edice (`consumableHasRoom`):
 * sloty z modifikátorů minus držené spotřebky (negativní spotřebka slot navíc přinese jen při svém přidání).
 */
function emptyConsumableSlots(ctx: JokerCtx): number {
  return Math.max(0, ctx.mods.consumableSlots - ctx.state.consumables.length);
}

/** Je volný slot spotřebky (stejně jako `createConsumable` bez edice)? */
function hasConsumableRoom(ctx: JokerCtx): boolean {
  return emptyConsumableSlots(ctx) > 0;
}

/** Karty v ruce kola (zničené mezitím se vynechají). */
function handCards(ctx: JokerCtx): Card[] {
  return (ctx.state.round?.hand ?? [])
    .map((id) => ctx.api.getCard(id))
    .filter((c): c is Card => c !== undefined);
}

/** Popelář, Rybář, Sběrna surovin: přičte `delta` k číselnému stavu (kopie stav nemění). */
function grow(ctx: JokerCtx, key: string, delta: number): void {
  if (ctx.isCopy || delta <= 0) return;
  ctx.self.state[key] = num(ctx.self, key) + delta;
}

// ─────────────────────────── Žolíci ───────────────────────────

export const COMMON2_JOKERS: JokerDef[] = [
  // ── ze zásobníku DESIGN 4.9 ──
  {
    // Nová rada jde do volného slotu (použitá rada svůj slot už uvolnila); bez místa nevznikne nic.
    id: 'helpline_aunt',
    rarity: 'common',
    cost: 5,
    tags: ['consumable'],
    params: { chance: AUNT_CHANCE, odds: AUNT_ODDS },
    hooks: {
      onConsumableUsed: (ctx) => {
        if (ctx.kind !== 'rada' || !hasConsumableRoom(ctx)) return;
        if (!ctx.chance(AUNT_CHANCE, AUNT_ODDS)) return;
        if (ctx.api.createConsumable({ kind: 'rada' })) ctx.api.message(MSG_AUNT);
      },
    },
    art: {
      icon: 'rotary-phone',
      prop: 'flower-pot',
      bg: '#7b3f61',
      fg: '#fde8f1',
      accent: '#f2b5d4',
      pattern: 'dots',
    },
  },
  {
    id: 'weekend_cottager',
    rarity: 'common',
    cost: 4,
    tags: ['mult', 'consumable'],
    params: { mult: COTTAGER_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const empty = emptyConsumableSlots(ctx);
        return empty > 0 ? { mult: empty * COTTAGER_MULT } : null;
      },
    },
    art: {
      icon: 'wood-cabin',
      prop: 'canoe',
      bg: '#40562f',
      fg: '#f1ead2',
      accent: '#d39b5a',
      pattern: 'grid',
    },
  },
  {
    // Figura podle enginu (respektuje „všechny karty jsou figury“); kamenná karta nemá hodnotu.
    id: 'shooting_gallery',
    rarity: 'common',
    cost: 5,
    tags: ['mult', 'rank', 'face'],
    params: { mult: SHOOTER_MULT },
    hooks: {
      onCardScored: (ctx) =>
        ctx.api.cardRank(ctx.card) === SHOOTER_RANK || ctx.api.isFace(ctx.card)
          ? { mult: SHOOTER_MULT }
          : null,
    },
    art: {
      icon: 'trophy',
      prop: 'round-star',
      bg: '#9b2335',
      fg: '#fff1e0',
      accent: '#ffd23f',
      pattern: 'rays',
    },
  },
  {
    // Pranostika jde do volného slotu; bez místa se nehází (RNG se neposune). Tajné kombinace jen po objevení.
    // Efekt je jen ve Večerce, kde kopírující žolík nekopíruje — `copyable: false` (DESIGN 4.4/7).
    id: 'tobacconist',
    rarity: 'common',
    cost: 5,
    tags: ['consumable'],
    params: { chance: TOBACCONIST_CHANCE, odds: TOBACCONIST_ODDS },
    copyable: false,
    hooks: {
      onShopEnter: (ctx) => {
        if (!hasConsumableRoom(ctx) || !ctx.chance(TOBACCONIST_CHANCE, TOBACCONIST_ODDS)) return;
        if (ctx.api.createConsumable({ kind: 'pranostika' })) ctx.api.message(MSG_TOBACCONIST);
      },
    },
    art: {
      icon: 'newspaper',
      prop: 'cigar',
      bg: '#4b3b2b',
      fg: '#f6ecd9',
      accent: '#b98b4e',
      pattern: 'stripes',
    },
  },
  {
    // Kontroluje všechny zahrané karty (i neskórující a debuffnuté); figura podle enginu.
    id: 'ticket_inspector',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'face'],
    params: { chips: INSPECTOR_CHIPS },
    hooks: {
      onHandPlayed: (ctx) => (ctx.played.some((c) => ctx.api.isFace(c)) ? null : { chips: INSPECTOR_CHIPS }),
    },
    art: {
      icon: 'ticket',
      prop: 'magnifying-glass',
      bg: '#2c4a6b',
      fg: '#e8f0fa',
      accent: '#f4d35e',
      pattern: 'checker',
    },
  },
  {
    // Debuffnutá karta v ruce se nevyhodnocuje (engine), opakování karet v ruce efekt zopakuje. Dřív „Hlídač
    // parkoviště“ — téma parkoviště + figury v ruce připomínalo komerční vzor (DECISIONS revize fáze 7).
    id: 'doorman',
    rarity: 'common',
    cost: 5,
    tags: ['mult', 'face'],
    params: { mult: DOORMAN_MULT },
    hooks: {
      onCardHeld: (ctx) => (ctx.api.isFace(ctx.card) ? { mult: DOORMAN_MULT } : null),
    },
    art: {
      icon: 'key',
      prop: 'imperial-crown',
      bg: '#3d405b',
      fg: '#f4f1de',
      accent: '#e07a5f',
      pattern: 'stripes',
    },
  },
  {
    // `onRoundEnd` běží před rozpisem odměn — pozlacená karta vydělá zlatou odměnu hned v tomto kole.
    // Kopie (druhá instance) pozlatí další kartu; stav žolík nemá.
    id: 'goldsmith',
    rarity: 'common',
    cost: 5,
    tags: ['deck', 'economy'],
    hooks: {
      onRoundEnd: (ctx) => {
        const plain = handCards(ctx).filter((c) => !c.enhancement);
        if (plain.length === 0) return;
        ctx.api.modifyCard(ctx.rng.pick(plain).id, { enhancement: GOLD });
        ctx.api.message(MSG_GOLDSMITH);
      },
    },
    art: {
      icon: 'gold-bar',
      prop: 'anvil',
      bg: '#8a6d1d',
      fg: '#fff8dc',
      accent: '#ffe066',
      pattern: 'rays',
    },
  },
  {
    // Při každém zahození promění první (v pořadí výběru) zahozenou kartu bez vylepšení; zahozená karta se do konce kola
    // nevrátí, kamenná je tedy až v dalších kolech. Kopie (druhá instance) promění další kartu téhož zahození.
    // Kamenná karta vždy skóruje (+50 čipů); mult za ni platí, jen když vylepšení zrovna platí (Bílá hora).
    id: 'paver',
    rarity: 'common',
    cost: 5,
    tags: ['deck', 'mult'],
    params: { mult: PAVER_MULT },
    hooks: {
      onDiscard: (ctx) => {
        // Aktuální stav karty (kopie vlevo už mohla první kartu proměnit).
        const victim = ctx.discarded.map((c) => ctx.api.getCard(c.id)).find((c) => c && !c.enhancement);
        if (!victim) return;
        ctx.api.modifyCard(victim.id, { enhancement: STONE });
        ctx.api.message(MSG_PAVER);
      },
      onCardScored: (ctx) => (isStone(ctx.card, ctx.mods) ? { mult: PAVER_MULT } : null),
    },
    art: {
      icon: 'stone-block',
      prop: 'warhammer',
      bg: '#5c5552',
      fg: '#efe9e4',
      accent: '#a3b18a',
      pattern: 'checker',
    },
  },
  {
    // Platí i pro obálky zdarma (štítky). Kopírující žolík ve Večerce nekopíruje — `copyable: false` jako ostatní
    // ekonomičtí žolíci (DESIGN 4.4/7).
    id: 'postman',
    rarity: 'common',
    cost: 4,
    tags: ['economy'],
    params: { money: POSTMAN_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      onBoosterOpened: (ctx) => {
        ctx.api.addMoney(POSTMAN_MONEY, 'joker');
        ctx.api.message(MSG_POSTMAN, { money: POSTMAN_MONEY });
      },
    },
    art: {
      icon: 'present',
      prop: 'dutch-bike',
      bg: '#c8553d',
      fg: '#fff4e6',
      accent: '#2a9d8f',
      pattern: 'zigzag',
    },
  },
  {
    // Počítá běžné žolíky jiného druhu ve slotech (i debuffnuté — pořád tam jsou). Jiní Hokynáři se nepočítají:
    // dva Hokynáři se tak chovají stejně jako Hokynář a jeho kopie (Napodobitel je epický).
    id: 'grocer',
    rarity: 'common',
    cost: 4,
    tags: ['mult'],
    params: { mult: GROCER_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const others = ctx.state.jokers.filter(
          (j) => j.defId !== ctx.def.id && ctx.api.jokerRarity(j.defId) === 'common',
        ).length;
        return others > 0 ? { mult: others * GROCER_MULT } : null;
      },
    },
    art: { icon: 'shop', prop: 'potato', bg: '#6a994e', fg: '#f2f7e8', accent: '#bc4749', pattern: 'grid' },
  },
  {
    // Počítá jen zahození hráčem (`round.discardsUsed`), ne zahození efektem.
    id: 'grill_dad',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'discard'],
    params: { chips: GRILL_CHIPS, discards: GRILL_DISCARDS },
    hooks: {
      onHandPlayed: (ctx) => (ctx.round.discardsUsed === GRILL_DISCARDS ? { chips: GRILL_CHIPS } : null),
    },
    art: {
      icon: 'roast-chicken',
      prop: 'fire',
      bg: '#7f2f1d',
      fg: '#fde9d9',
      accent: '#f4a261',
      pattern: 'waves',
    },
  },
  {
    // Debuffnuté skórující karty se nepočítají (nedávají nic); kamenná karta hodnotu nemá → podmínku nesplní.
    id: 'teacher',
    rarity: 'common',
    cost: 4,
    tags: ['mult', 'rank'],
    params: { mult: TEACHER_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const cards = ctx.scoring.filter((c) => !c.debuffed);
        if (cards.length === 0) return null;
        const allEven = cards.every((c) => {
          const rank = ctx.api.cardRank(c);
          return rank !== null && EVEN_RANKS.includes(rank);
        });
        return allEven ? { mult: TEACHER_MULT } : null;
      },
    },
    art: {
      icon: 'light-bulb',
      prop: 'open-book',
      bg: '#264653',
      fg: '#eef6f4',
      accent: '#e9c46a',
      pattern: 'grid',
    },
  },
  {
    id: 'hejkal',
    rarity: 'common',
    cost: 4,
    tags: ['mult'],
    params: { chance: HEJKAL_CHANCE, odds: HEJKAL_ODDS, mult: HEJKAL_MULT },
    hooks: {
      onHandPlayed: (ctx) => (ctx.chance(HEJKAL_CHANCE, HEJKAL_ODDS) ? { mult: HEJKAL_MULT } : null),
    },
    art: {
      icon: 'pine-tree',
      prop: 'megaphone',
      bg: '#1b4332',
      fg: '#d8f3dc',
      accent: '#95d5b2',
      pattern: 'waves',
    },
  },
  {
    id: 'tram_driver',
    rarity: 'common',
    cost: 4,
    tags: ['mult', 'discard'],
    params: { mult: TRAM_MULT },
    hooks: {
      onHandPlayed: (ctx) => (!ctx.firstHand && ctx.round.discardsUsed > 0 ? { mult: TRAM_MULT } : null),
    },
    art: {
      icon: 'subway-train',
      prop: 'ringing-bell',
      bg: '#b23a48',
      fg: '#fff0f0',
      accent: '#fcb9b2',
      pattern: 'stripes',
    },
  },
  {
    // Rozpis odměn se počítá jednou za kolo a kopírujícím žolíkům se nepočítá (`copyable: false`).
    id: 'punter',
    rarity: 'common',
    cost: 4,
    tags: ['economy'],
    params: { chance: PUNTER_CHANCE, odds: PUNTER_ODDS, money: PUNTER_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) => (ctx.chance(PUNTER_CHANCE, PUNTER_ODDS) ? PUNTER_MONEY : 0),
    },
    art: {
      icon: 'coinflip',
      prop: 'take-my-money',
      bg: '#2d6a4f',
      fg: '#f1faee',
      accent: '#ffb703',
      pattern: 'dots',
    },
  },

  // ── vlastní: hospoda, panelák, chataření, pouť, zabijačka, Silvestr, výluka, MHD, sousedé ──
  {
    // Předchozí ruka = poslední ruka, kterou od koupě viděla (i z minulého kola); zapisuje se po sečtení skóre,
    // takže ruka zakázaná šéfem se nepočítá. Kopie stav nemění, jen ho čte.
    id: 'pavlac_gossip',
    rarity: 'common',
    cost: 5,
    tags: ['xmult', 'hand'],
    params: { xmult: GOSSIP_XMULT },
    initState: () => ({ last: null }),
    hooks: {
      onHandPlayed: (ctx) => (ctx.self.state.last === ctx.hand.type ? { xmult: GOSSIP_XMULT } : null),
      afterHandScored: (ctx) => {
        if (!ctx.isCopy) ctx.self.state.last = ctx.hand.type;
      },
    },
    art: {
      icon: 'window',
      prop: 'eyeball',
      bg: '#6d597a',
      fg: '#f7ede2',
      accent: '#e56b6f',
      pattern: 'checker',
    },
  },
  {
    // Skórovat musí všech pět zahraných karet (s „všechny karty skórují“ stačí zahrát pět).
    id: 'round_for_everyone',
    rarity: 'common',
    cost: 5,
    tags: ['xmult', 'hand'],
    params: { xmult: ROUND_XMULT, cards: ROUND_CARDS },
    hooks: {
      onHandPlayed: (ctx) =>
        ctx.played.length === ROUND_CARDS && ctx.scoring.length === ROUND_CARDS
          ? { xmult: ROUND_XMULT }
          : null,
    },
    art: {
      icon: 'glass-celebration',
      prop: 'beer-bottle',
      bg: '#9c6644',
      fg: '#fdf0d5',
      accent: '#f6bd60',
      pattern: 'dots',
    },
  },
  {
    // Všechny karty, které zůstaly v ruce (i debuffnuté — v ruce pořád jsou).
    id: 'pickled_cheese',
    rarity: 'common',
    cost: 4,
    tags: ['chips'],
    params: { chips: CHEESE_CHIPS },
    hooks: {
      onHandPlayed: (ctx) => (ctx.held.length > 0 ? { chips: ctx.held.length * CHEESE_CHIPS } : null),
    },
    art: {
      icon: 'cheese-wedge',
      prop: 'honey-jar',
      bg: '#e9d8a6',
      fg: '#3d2c1e',
      accent: '#ca6702',
      pattern: 'zigzag',
    },
  },
  {
    // Rozpis odměn vyhraného kola šéfa (i zachráněného). Kopie rozpis nedostávají (`copyable: false`).
    id: 'thirteenth_salary',
    rarity: 'common',
    cost: 5,
    tags: ['economy'],
    params: { money: SALARY_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) => (ctx.state.round?.blind === 'boss' ? SALARY_MONEY : 0),
    },
    art: {
      icon: 'money-stack',
      prop: 'trophy',
      bg: '#22333b',
      fg: '#f1faee',
      accent: '#ffd166',
      pattern: 'rays',
    },
  },
  {
    // Ruce zahrané v tomto kole včetně vítězné (i ruce zakázané šéfem — ruka se spotřebovala).
    id: 'temp_worker',
    rarity: 'common',
    cost: 4,
    tags: ['economy'],
    params: { money: TEMP_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) => (ctx.state.round?.handsPlayed ?? 0) * TEMP_MONEY,
    },
    art: {
      icon: 'wheat',
      prop: 'coins',
      bg: '#a7792f',
      fg: '#fff8e7',
      accent: '#5f8d4e',
      pattern: 'stripes',
    },
  },
  {
    // Jen zahození hráčem (`onDiscard`); bez volného slotu nehází (RNG se neposune). Kopie zkusí štěstí znovu
    // (stav nemá). Dřív „na konci kola 1 z 3 trvale +2 mult“ — náhodná verze Stálého hosta (DECISIONS revize fáze 7).
    id: 'fisherman',
    rarity: 'common',
    cost: 5,
    tags: ['consumable', 'discard'],
    params: { chance: FISHER_CHANCE, odds: FISHER_ODDS },
    hooks: {
      onDiscard: (ctx) => {
        if (!hasConsumableRoom(ctx) || !ctx.chance(FISHER_CHANCE, FISHER_ODDS)) return;
        if (ctx.api.createConsumable({ kind: 'rada' })) ctx.api.message(MSG_FISHER);
      },
    },
    art: {
      icon: 'tropical-fish',
      prop: 'anchor',
      bg: '#355070',
      fg: '#eaf4f4',
      accent: '#eaac8b',
      pattern: 'waves',
    },
  },
  {
    // Jen zahození hráčem (`onDiscard`); zahození efektem hooky nespouští. Kamenná karta hodnotu nemá.
    id: 'garbage_man',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'scaling', 'discard'],
    params: { chips: GARBAGE_CHIPS, rank: GARBAGE_RANK },
    initState: () => ({ chips: 0 }),
    describe: (self) => ({ current: num(self, 'chips') }),
    noPerishable: true,
    hooks: {
      onDiscard: (ctx) => {
        const junk = ctx.discarded.filter((c) => {
          const rank = ctx.api.cardRank(c);
          return rank !== null && rank <= GARBAGE_RANK;
        }).length;
        grow(ctx, 'chips', junk * GARBAGE_CHIPS);
      },
      onHandPlayed: (ctx) => {
        const chips = num(ctx.self, 'chips');
        return chips > 0 ? { chips } : null;
      },
    },
    art: {
      icon: 'broken-bottle',
      prop: 'card-discard',
      bg: '#3a5a40',
      fg: '#e9f5db',
      accent: '#dad7cd',
      pattern: 'grid',
    },
  },
  {
    // Nejvyšší hodnota mezi skórujícími kartami, které hodnotu mají (kamenná ne) a nejsou debuffnuté.
    id: 'jukebox',
    rarity: 'common',
    cost: 5,
    tags: ['retrigger', 'rank'],
    params: { retriggers: JUKEBOX_RETRIGGERS },
    hooks: {
      retriggerScored: (ctx) => {
        const own = ctx.api.cardRank(ctx.card);
        if (own === null) return 0;
        let top = 0;
        for (const c of ctx.scoring) {
          const rank = c.debuffed ? null : ctx.api.cardRank(c);
          if (rank !== null && rank > top) top = rank;
        }
        return own === top ? JUKEBOX_RETRIGGERS : 0;
      },
    },
    art: {
      icon: 'speaker',
      prop: 'two-coins',
      bg: '#5a189a',
      fg: '#f3e8ff',
      accent: '#ff9e00',
      pattern: 'zigzag',
    },
  },
  {
    // Čistě pravidlo (`passive`) — kopírovat nejde (DESIGN 4.4/7). Prodej s plnými sloty spotřebky nechá ve slotech.
    id: 'tool_shed',
    rarity: 'common',
    cost: 4,
    tags: ['utility', 'consumable'],
    params: { slots: SHED_SLOTS },
    copyable: false,
    hooks: {
      passive: () => ({ consumableSlots: SHED_SLOTS }),
    },
    art: {
      icon: 'toolbox',
      prop: 'screwdriver',
      bg: '#6b4226',
      fg: '#f5e6d3',
      accent: '#d9a066',
      pattern: 'checker',
    },
  },
  {
    // `round.discardsUsed` už zahrnuje právě provedené zahození; ruka se dobere hned po hoocích zahození.
    id: 'replacement_bus',
    rarity: 'common',
    cost: 4,
    tags: ['utility', 'discard'],
    params: { max: BUS_DISCARDS, cards: BUS_CARDS },
    hooks: {
      onDiscard: (ctx) => {
        const used = ctx.state.round?.discardsUsed ?? 0;
        if (used >= 1 && used <= BUS_DISCARDS) ctx.api.addRoundHandSize(BUS_CARDS);
      },
    },
    art: {
      icon: 'bus',
      prop: 'traffic-cone',
      bg: '#ee9b00',
      fg: '#2b2118',
      accent: '#005f73',
      pattern: 'stripes',
    },
  },
  {
    // V rozpisu odměn (jednou za kolo, kopie ne): zlaté karty v ruce už vyplatily. Nejnižší podle hodnoty, při shodě
    // ta více vlevo. Žolíci napravo, kteří počítají karty v ruce (Zahrádkář), zničenou kartu už nevidí.
    id: 'pig_slaughter',
    rarity: 'common',
    cost: 5,
    tags: ['deck', 'economy'],
    params: { money: SLAUGHTER_MONEY },
    copyable: false,
    noRental: true,
    hooks: {
      roundEndMoney: (ctx) => {
        let victim: Card | null = null;
        let low = Infinity;
        for (const c of handCards(ctx)) {
          const rank = c.enhancement ? null : ctx.api.cardRank(c);
          if (rank !== null && rank < low) {
            low = rank;
            victim = c;
          }
        }
        if (!victim) return 0;
        ctx.api.destroyCard(victim.id, 'joker');
        ctx.api.message(MSG_SLAUGHTER);
        return SLAUGHTER_MONEY;
      },
    },
    art: {
      icon: 'pig',
      prop: 'sausage',
      bg: '#f4acb7',
      fg: '#4a1c26',
      accent: '#9d0208',
      pattern: 'checker',
    },
  },
  {
    // Divoká karta je červená i černá zároveň (sama stačí); kamenná nemá barvu; debuffnuté se nepočítají.
    id: 'derby_fans',
    rarity: 'common',
    cost: 4,
    tags: ['mult'],
    params: { mult: DERBY_MULT },
    hooks: {
      onHandPlayed: (ctx) => {
        const cards = ctx.scoring.filter((c) => !c.debuffed);
        const has = (suits: readonly Suit[]) => cards.some((c) => suits.some((s) => ctx.api.hasSuit(c, s)));
        return has(RED) && has(BLACK) ? { mult: DERBY_MULT } : null;
      },
    },
    art: {
      icon: 'trumpet',
      prop: 'crossed-swords',
      bg: '#14213d',
      fg: '#e5e5e5',
      accent: '#d62828',
      pattern: 'zigzag',
    },
  },
  {
    id: 'pub_quiz',
    rarity: 'common',
    cost: 4,
    tags: ['chips', 'rank'],
    params: { chips: QUIZ_CHIPS },
    hooks: {
      onHandPlayed: (ctx) => {
        const ranks = new Set<Rank>();
        for (const c of ctx.scoring) {
          const rank = c.debuffed ? null : ctx.api.cardRank(c);
          if (rank !== null) ranks.add(rank);
        }
        return ranks.size > 0 ? { chips: ranks.size * QUIZ_CHIPS } : null;
      },
    },
    art: {
      icon: 'help',
      prop: 'microphone',
      bg: '#3c1642',
      fg: '#f7ebf9',
      accent: '#20a39e',
      pattern: 'dots',
    },
  },
  {
    // Každá zničená hrací karta balíčku (prasklé sklo, rady, Zabijačka, šéfové) od chvíle, kdy je ve slotu. Strop:
    // se Zabijačkou (karta za kolo) by bez něj po 16 kolech dala +48 mult (špička R2 120 % > 2 × 30 %, DESIGN 4.3/3).
    id: 'scrap_yard',
    rarity: 'common',
    cost: 5,
    tags: ['mult', 'scaling', 'deck'],
    params: { mult: SCRAP_MULT, max: SCRAP_MAX },
    initState: () => ({ mult: 0 }),
    describe: (self) => ({ current: num(self, 'mult') }),
    noPerishable: true,
    hooks: {
      onCardDestroyed: (ctx) => grow(ctx, 'mult', Math.min(SCRAP_MULT, SCRAP_MAX - num(ctx.self, 'mult'))),
      onHandPlayed: (ctx) => {
        const mult = num(ctx.self, 'mult');
        return mult > 0 ? { mult } : null;
      },
    },
    art: { icon: 'cog', prop: 'scales', bg: '#495057', fg: '#f8f9fa', accent: '#fd7e14', pattern: 'grid' },
  },
];
