/**
 * Revize všech 101 žolíků (fáze 4 a 7) v kombinaci s enginem (docs/DESIGN.md 4.4, 4.6–4.10; docs/ARCHITECTURE.md
 * 2.5–2.7):
 *
 * - popisky všech žolíků vyrenderované s `params` (čísla jen z `params`, žádné natvrdo v šabloně),
 * - kopírování Napodobitelem u každého žolíka: kopie = druhá instance téhož žolíka, nekopírovatelné si nevybere,
 *   stav originálu se kopií nezdvojí (ani přes dvě kola),
 * - debuff (nic nedá, ani `passive`, edice, odměny a počítadla), edice (efekt platí, i když žolík sám nic nedělá),
 *   prodej (cena podle DESIGN 4.1, `onSell` se všemi žolíky, `passive` po prodeji zmizí),
 * - fuzz: runy přes boty se všemi 101 žolíky — žádná výjimka, žádná neplatná akce bota, stav JSON-bezpečný, uložení
 *   a načtení uprostřed kola dá stejné akce i stav jako run bez načítání.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { cyrb128, rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { createBot, type BotName } from '../../src/engine/sim/index';
import type {
  Action,
  Card,
  EditionId,
  InstanceState,
  JokerInstance,
  RoundRewards,
  ScoreResult,
} from '../../src/engine/types';
import { t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import { jokers as JOKER_TEXTS } from '../../src/i18n/cs/jokers';
import {
  addJokers,
  ART,
  consumable,
  makeGame,
  makeRegistry,
  play,
  setupRound,
  type JokerSpec,
  type SetupOptions,
} from './fixtures/registry';

/** Testovací registr (kombinace, úpravy karet, testovací šéfové, spotřebky…) + všichni skuteční žolíci. */
const reg = makeRegistry({ jokers: JOKERS });
const IDS = JOKERS.map((j) => j.id);
const OTHERS = IDS.filter((id) => id !== 'impersonator');

const def = (id: string): JokerDef => {
  const d = JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`Chybí žolík ${id}`);
  return d;
};

// ─────────────────────────── Scénáře ───────────────────────────

interface Scenario {
  /** Ruka; zahrají se všechny karty (nebo jen `pick`). */
  hand: string;
  /** Indexy karet ruky, které se zahrají (ostatní zůstanou v ruce); výchozí všechny. */
  pick?: number[];
  levels?: SetupOptions['levels'];
  /** Stav žolíka (škálující, ať je co kopírovat). */
  state?: InstanceState;
  /** Příprava po výběru útraty, před nastavením ruky. */
  setup?: (g: Game) => void;
  /** Co efekt žolíka mění (výchozí skóre ruky). */
  measure?: (g: Game, r: ScoreResult, cards: readonly Card[]) => number;
}

/** Defenestrace: peníze ze zahození před rukou (měří se zvlášť — prodej žolíka uprostřed kola peníze taky mění). */
const DISCARD_GAIN = new WeakMap<Game, number>();

/** Ruka, ve které efekt žolíka nastane (u ekonomických libovolná). */
const SCENARIOS: Record<string, Scenario> = {
  beer_mat: { hand: 'KS' },
  hearts_man: { hand: 'KH KS' },
  gravedigger: { hand: 'AS AH' },
  jeweler: { hand: 'AD AH', measure: (g, _r, cards) => g._core.card(cards[0]!.id)!.bonusChips },
  crusader: { hand: 'KC KD 5C 5H' },
  early_bird: { hand: 'KS' },
  night_shift: {
    hand: 'KS',
    // Kolo se šéfem (testovací „wall“ jen zvyšuje cíl).
    setup: (g) => {
      g._core.state.round!.bossId = 'wall';
    },
  },
  meteorologist: { hand: 'KS KH', levels: { pair: 3 } },
  pe_teacher: { hand: 'KS KH 2C' },
  party_for_two: { hand: 'KS KH' },
  gardener: { hand: 'KS' },
  svejk: { hand: '2S', measure: (g) => g.state.round!.discardsLeft },
  piggy_bank: { hand: 'KS' },
  flea_trader: { hand: 'KS' },
  golem: { hand: 'KS KH 2C:stone' },
  late_train: {
    hand: 'KS KH',
    // Bez zpoždění (šance 0) — výsledek nezávisí na tom, kolik hodů RNG žolíků už padlo.
    setup: (g) => g._core.api.addPermanentModifier({ probabilityMult: 0 }),
  },
  head_waiter: { hand: 'KS KH' },
  old_guard: { hand: 'KS KH', levels: { pair: 3 } },
  herbalist: { hand: 'KS KH', state: { mult: 4 } },
  regular: { hand: 'KS KH', state: { rounds: 3 } },
  beer_belly: { hand: 'KS KH', state: { chips: 6 } },
  carousel: { hand: 'QS KH AD 2C 3S' },
  echo: { hand: 'KS KH' },
  lucky_seven: {
    hand: '7S 7H',
    // Výhra jistě (7 ze 7) — výsledek nezávisí na tom, kolik hodů RNG žolíků už padlo.
    setup: (g) => g._core.api.addPermanentModifier({ probabilityMult: 7 }),
  },
  tab: {
    hand: 'KS KH',
    setup: (g) => {
      g._core.state.money = -5;
    },
  },
  snowman: { hand: 'KS KH' },
  mushroom_picker: { hand: 'KS KH', state: { destroyed: 2 } },
  impersonator: { hand: 'KS' },
  innkeeper: { hand: 'KS KH' },
  grandmas_chest: {
    hand: 'KS KH',
    setup: (g) => {
      for (let i = 0; i < 2; i++) g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true });
    },
  },
  // Legendární (DESIGN 4.8).
  forefather: { hand: 'KS KH' },
  libuse: { hand: 'QS QH' },
  blanik_knights: { hand: 'KS KH' },
  bruncvik_sword: { hand: 'KS KH', state: { cuts: 2 } },
  faust: {
    hand: 'KS KH',
    setup: (g) => {
      g._core.state.money = 20;
    },
  },
  krakonos: {
    hand: 'KS KH',
    // Pranostika na Dvojici před rukou: úroveň navíc se projeví ve skóre.
    setup: (g) => {
      const c = g._core.api.createConsumable({ defId: 'pr_pair', ignoreSlots: true })!;
      ok(g.dispatch({ type: 'useConsumable', uid: c.uid }));
    },
  },
  silly_honza: { hand: 'KS KH' },
  astro_clock: { hand: 'KS' },

  // ── běžní fáze 7 (common2) ──
  helpline_aunt: {
    hand: 'KS',
    // Jistá šance; rada se použije až po výběru útraty (Napodobitel už má cíl), měří se počet nových rad.
    setup: (g) => {
      g._core.api.addPermanentModifier({ probabilityMult: 100 });
      const c = g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true })!;
      ok(g.dispatch({ type: 'useConsumable', uid: c.uid }));
    },
    measure: (g) => g.state.consumables.length,
  },
  weekend_cottager: { hand: 'KS' },
  shooting_gallery: { hand: 'KS KH' },
  tobacconist: { hand: 'KS' },
  ticket_inspector: { hand: '9S 9H' },
  doorman: { hand: '2S 2H KD QC', pick: [0, 1] },
  goldsmith: {
    hand: 'KS 2H 3D',
    pick: [0],
    // Vyhrát kolo další rukou a spočítat pozlacené karty.
    measure: (g) => {
      const round = g._core.state.round!;
      round.target = 1;
      ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
      return g.state.deck.filter((c) => c.enhancement === 'gold').length;
    },
  },
  paver: { hand: 'KS KH 2C:stone' },
  postman: { hand: 'KS' },
  grocer: {
    hand: 'KS',
    // Hokynář potřebuje jiného běžného žolíka (testovací `noop` je běžný).
    setup: (g) => {
      g._core.api.createJoker({ defId: 'noop', ignoreSlots: true });
    },
  },
  grill_dad: {
    hand: 'KS',
    setup: (g) => ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] })),
  },
  teacher: { hand: '2S 2H' },
  hejkal: {
    hand: 'KS',
    setup: (g) => g._core.api.addPermanentModifier({ probabilityMult: 100 }),
  },
  tram_driver: {
    hand: 'KS',
    setup: (g) => {
      ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
      ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    },
  },
  punter: { hand: 'KS' },
  pavlac_gossip: { hand: 'KS KH', state: { last: 'pair' } },
  round_for_everyone: { hand: '2H 5H 7H 9H JH' },
  pickled_cheese: { hand: 'KS 2H 3D', pick: [0] },
  thirteenth_salary: { hand: 'KS' },
  temp_worker: { hand: 'KS' },
  fisherman: {
    hand: 'KS',
    // Jistá šance; zahození po výběru útraty (Napodobitel už má cíl), měří se počet nových rad.
    setup: (g) => {
      g._core.api.addPermanentModifier({ probabilityMult: 100 });
      ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    },
    measure: (g) => g.state.consumables.length,
  },
  garbage_man: { hand: 'KS', state: { chips: 6 } },
  jukebox: { hand: 'KS KH' },
  tool_shed: { hand: 'KS' },
  replacement_bus: {
    hand: 'KS',
    setup: (g) => ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] })),
    measure: (g) => g.state.round!.handSizeDelta,
  },
  pig_slaughter: { hand: 'KS' },
  derby_fans: { hand: 'KS KH' },
  pub_quiz: { hand: 'KS KH 5C 5D' },
  scrap_yard: { hand: 'KS', state: { mult: 4 } },

  // ── vzácní fáze 7 (rare2) ──
  office_connection: { hand: 'KS' },
  chronicler: { hand: 'KS KH' },
  chimney_sweep: {
    hand: 'KS KC',
    // Jistota (2 z 2) — výsledek nezávisí na tom, kolik hodů RNG žolíků už padlo.
    setup: (g) => g._core.api.addPermanentModifier({ probabilityMult: 2 }),
  },
  glassblower: { hand: 'KS' },
  notary_public: { hand: 'KS KH', measure: (_g, r) => r.moneyEarned },
  witch: {
    hand: 'KS',
    // Ruka vyhraje kolo šéfa (testovací „wall“ jen zvyšuje cíl) → razítko.
    setup: (g) => {
      const round = g._core.state.round!;
      round.target = 1;
      round.blind = 'boss';
      round.bossId = 'wall';
    },
    measure: (g) => g.state.consumables.length,
  },
  water_goblin: { hand: 'KS KH', state: { mult: 3 } },
  will_o_wisp: {
    hand: 'KS KH',
    // Kolo se šéfem (testovací „wall“ jen zvyšuje cíl).
    setup: (g) => {
      g._core.state.round!.bossId = 'wall';
    },
  },
  noon_witch: {
    hand: 'KS KH',
    // Druhá ruka kola.
    setup: (g) => {
      g._core.state.round!.handsPlayed = 1;
    },
  },
  klekanice: { hand: 'KS KH' },
  parish_priest: { hand: 'KS:bonus KH' },
  seer: {
    hand: 'KS KH',
    // Jediná ruka vyhraje Malou útratu → pranostika.
    setup: (g) => {
      g._core.state.round!.target = 1;
    },
    measure: (g) => g.state.consumables.length,
  },
  court_painter: { hand: 'KS' },
  colorblind_uncle: { hand: '2H 5D 7H 9D JH' },
  trodden_path: { hand: '3S 5H 6D 8C 9S' },
  war_loot: { hand: 'KS', state: { bosses: 2 } },
  anonymous_commenter: { hand: 'KS KH 5C' },
  viral_video: { hand: 'KS' },
  carbon_paper: { hand: 'KS' },
  defenestration: {
    hand: 'KS',
    // Před rukou zahození s figurou; měří se peníze z tohoto zahození (prodej žolíka peníze taky mění).
    setup: (g) => {
      const before = g.state.money;
      const [face] = setupRound(g, 'KS 2C');
      ok(g.dispatch({ type: 'discard', cardIds: [face!.id] }));
      DISCARD_GAIN.set(g, g.state.money - before);
    },
    measure: (g) => DISCARD_GAIN.get(g) ?? 0,
  },
  brno_native: {
    hand: 'KS KH',
    // Násobí jen úplně vlevo: i v sestavách s Napodobitelem ho posunout na začátek řady.
    setup: (g) => {
      const s = g._core.state;
      const i = s.jokers.findIndex((j) => j.defId === 'brno_native');
      if (i > 0) s.jokers.unshift(...s.jokers.splice(i, 1));
      g._core.invalidate();
    },
  },
  social_bubble: { hand: 'KS KH' },

  // ── epičtí fáze 7 (epic2) ──
  beer_sommelier: { hand: 'KS KH' },
  archivist: { hand: 'KS' },
  fair_magician: { hand: 'KS KH' },
  tour_guide: { hand: 'AH 9H 6H 2H' },
  spartakiada: { hand: 'KS KH' },
  voucher_privatization: { hand: 'KS' },
  spa_guest: { hand: 'KS KH', state: { rounds: 2 } },
  brass_band: { hand: 'KS KH' },
  charles_bridge: { hand: 'KS KH KD', pick: [0, 1] },
  d1_motorway: { hand: 'KS KH' },
  // Nad stropem ×2,5 — jinak by lesklá edice (+50 čipů před efektem) zvedla i ×mult Směnárny.
  exchange_office: { hand: 'KS+300 KH' },
  new_years_eve: { hand: 'KS KH', state: { bosses: 2 } },
};

/**
 * Napodobitel potřebuje koho kopírovat — v jeho scénářích stojí vpravo od Pivního tácku (je poslední, takže
 * duhová edice násobí celý mult jako u ostatních žolíků).
 */
const PARTNER = 'beer_mat';

function spec(id: string, extra: Partial<JokerSpec> = {}): JokerSpec {
  const state = SCENARIOS[id]?.state;
  return { id, ...(state ? { state } : {}), ...extra };
}

/** Sestava „žolík v akci“ (Napodobitel s partnerem) a sestava bez něj. */
function lineup(id: string, extra: Partial<JokerSpec> = {}): (string | JokerSpec)[] {
  return id === 'impersonator' ? [PARTNER, spec(id, extra)] : [spec(id, extra)];
}
const without = (id: string): string[] => (id === 'impersonator' ? [PARTNER] : []);

interface Outcome {
  game: Game;
  result: ScoreResult;
  value: number;
}

/**
 * Odehraje scénář žolíka `id` se sestavou `jokers`: výběr Malé útraty (cíl 1e9), příprava, ruka. `before` běží po
 * výběru útraty (debuff, prodej…).
 */
function runScenario(id: string, jokers: (string | JokerSpec)[], before?: (g: Game) => void): Outcome {
  const sc = SCENARIOS[id]!;
  const game = makeGame({ registry: reg, jokers, round: true });
  game._core.state.round!.target = 1e9;
  before?.(game);
  sc.setup?.(game);
  const cards = setupRound(game, sc.hand, sc.levels ? { levels: sc.levels } : {});
  const result = play(game, sc.pick ? sc.pick.map((i) => cards[i]!) : cards).result;
  return { game, result, value: sc.measure ? sc.measure(game, result, cards) : result.score };
}

const instanceOf = (g: Game, id: string): JokerInstance => {
  const j = g.state.jokers.find((x) => x.defId === id);
  if (!j) throw new Error(`Žolík ${id} není ve slotech`);
  return j;
};

const stepsOf = (r: ScoreResult, uid: number) =>
  r.steps.filter((s) => s.source === 'joker' && s.jokerUid === uid);

/** Kroky žolíka v kroku 4 (po zahrání ruky: edice a `onHandPlayed`; kroky skórujících karet mají `cardId`). */
const handStepsOf = (r: ScoreResult, uid: number) => stepsOf(r, uid).filter((s) => s.cardId === undefined);

/** Vyhraje běžící kolo jednou kartou (cíl 1) a vrátí rozpis odměn. */
function winRound(g: Game): RoundRewards {
  const round = g._core.state.round!;
  round.target = 1;
  round.handsLeft = Math.max(round.handsLeft, 1);
  const res = g.dispatch({ type: 'play', cardIds: [round.hand[0]!] });
  if (!res.ok) throw new Error(`play: ${res.error}`);
  expect(g.state.phase).toBe('round_end');
  return structuredClone(g.state.rewards!);
}

function ok(res: ReturnType<Game['dispatch']>): void {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
}

// ─────────────────────────── Popisky ───────────────────────────

describe('žolíci – vyrenderované popisky (params + počáteční stav)', () => {
  /** Popisek, jak ho uvidí hráč u čerstvého žolíka (NBSP → mezera kvůli čitelnosti). */
  function rendered(d: JokerDef): string {
    const g = makeGame({ registry: reg });
    const [inst] = addJokers(g, [d.id]);
    return t(`jokers.${d.id}.desc`, { ...d.params, ...d.describe?.(inst!) }).replaceAll(NBSP, ' ');
  }

  it('všech 101 popisků přesně (čísla odpovídají params a kódu)', () => {
    expect(JOKERS).toHaveLength(101);
    expect(Object.fromEntries(JOKERS.map((d) => [d.id, rendered(d)]))).toEqual({
      beer_mat: '+10 čipů a +2 mult. Jako jediný žolík se smí v nabídce opakovat.',
      hearts_man: 'Každá skórující srdcová karta dá +5 čipů a +2 mult.',
      gravedigger: 'Každá skórující piková karta dá +20 čipů.',
      jeweler: 'Každá skórující kárová karta trvale získá +5 čipů.',
      crusader: '+12 mult, pokud skórují aspoň 2 křížové karty.',
      early_bird: 'První ruka kola dá +8 mult.',
      night_shift: 'V kole se šéfem dá každá ruka +14 mult.',
      meteorologist: '+2 mult za každou úroveň zahrané kombinace nad první.',
      pe_teacher: '+8 čipů za každou zahranou kartu, i za neskórující.',
      party_for_two: '+15 čipů a +3 mult, pokud zahraná ruka obsahuje Dvojici.',
      gardener: 'Na konci kola +2 Kč za každé 3 karty držené v ruce.',
      svejk: 'Po ruce za méně než 10 % cíle kola získáš +1 zahození, nejvýš 2× za kolo (teď ještě 2×).',
      piggy_bank: 'Na konci kola +2 Kč. Po 8. kole se rozbije, dá ještě 8 Kč a zmizí (zbývá 8 kol).',
      flea_trader: 'Na konci kola +3 Kč za každý prázdný slot žolíka.',
      golem: 'Při získání přidá do balíčku 2 kamenné karty; každá skórující kamenná karta dá +20 čipů navíc.',
      helpline_aunt:
        'Po použití babské rady 1 z 2, že vznikne další náhodná babská rada (potřebuje volný slot).',
      weekend_cottager: '+3 mult za každý prázdný slot spotřebky.',
      shooting_gallery: 'Každá skórující desítka nebo figura dá +3 mult.',
      tobacconist: 'Při vstupu do Večerky 1 z 2, že ti dá náhodnou pranostiku (potřebuje volný slot).',
      ticket_inspector: '+50 čipů, pokud mezi zahranými kartami není žádná figura.',
      doorman: 'Každá figura držená v ruce dá +4 mult.',
      goldsmith: 'Na konci kola promění náhodnou kartu bez vylepšení drženou v ruce na zlatou.',
      paver:
        'Každé zahození promění první zahozenou kartu bez vylepšení na kamennou; každá skórující kamenná karta dá +5 mult.',
      postman: 'Za každou otevřenou obálku dostaneš 3 Kč.',
      grocer: '+2 mult za každého jiného běžného žolíka (jiní Hokynáři se nepočítají).',
      grill_dad: '+60 čipů, pokud se v tomto kole zahazovalo právě 1×.',
      teacher:
        '+15 mult, pokud mají všechny skórující karty sudou hodnotu (dvojky, čtyřky, šestky, osmičky a desítky).',
      hejkal: '1 z 3, že zahraná ruka dostane +15 mult.',
      tram_driver: '+15 mult, pokud to není první ruka kola a v kole už se zahazovalo.',
      punter: 'Na konci kola 1 z 3, že vyhraje 7 Kč.',
      pavlac_gossip: '×1,5 mult, pokud je zahraná kombinace stejná jako v minulé ruce.',
      round_for_everyone: '×1,4 mult, pokud zahraješ 5 karet a všechny skórují.',
      pickled_cheese: '+6 čipů za každou kartu drženou v ruce.',
      thirteenth_salary: 'Po porážce šéfa dostaneš v odměnách navíc 8 Kč.',
      temp_worker: 'Na konci kola +2 Kč za každou ruku zahranou v tomto kole.',
      fisherman: 'Po každém zahození 1 z 2, že něco chytí: náhodnou babskou radu (potřebuje volný slot).',
      garbage_man: 'Každá zahozená karta s hodnotou nejvýš 5 mu trvale přidá +1 čip (teď +0 čipů).',
      jukebox: 'Skórující karty s nejvyšší hodnotou skórují ještě 1×.',
      tool_shed: '+1 slot spotřebky.',
      replacement_bus: 'Každé z prvních 2 zahození v kole zvětší do konce kola ruku o 1 kartu.',
      pig_slaughter: 'Na konci kola zničí nejnižší kartu bez vylepšení drženou v ruce a dá za ni 2 Kč.',
      derby_fans: '+8 mult, pokud mezi skórujícími kartami je červená i černá barva.',
      pub_quiz: '+10 čipů za každou různou hodnotu mezi skórujícími kartami.',
      scrap_yard: 'Za každou zničenou hrací kartu trvale +3 mult, nejvýš +21 mult (teď +0 mult).',
      late_train: '×1,5 mult; 1 z 6, že efekt „nabere zpoždění“ a nenastane.',
      head_waiter: '×2 mult, pokud zahraná ruka má nejvýš 3 karty.',
      old_guard: '×1,5 mult, pokud má zahraná kombinace úroveň aspoň 3.',
      herbalist: 'Po každé použité babské radě trvale +2 mult (teď +0 mult).',
      regular: '+1 mult za každé kolo, které od koupě strávil ve slotu (teď +0 mult).',
      beer_belly: 'Po každé zahrané ruce trvale +2 čipy (teď +0 čipů).',
      carousel: 'Postupka smí jít kolem dokola (např. Q-K-A-2-3) a každá Postupka dá +14 mult.',
      echo: 'Poslední skórující karta skóruje ještě 4×.',
      lucky_seven: 'Každá skórující karta: 1 ze 7, že skóruje ještě 7×.',
      tab: 'Můžeš jít do mínusu až −15 Kč; +1 mult za každou korunu, která ti chybí do 15 Kč.',
      office_connection: 'Cíl šéfa je o 20 % nižší a po každém přeskočení útraty přelosuje šéfa patra.',
      chronicler: 'Za každou kombinaci, kterou od jeho koupě zahraješ poprvé, trvale +2 mult (teď +0 mult).',
      chimney_sweep: 'Každá skórující piková, křížová nebo šťastná karta: 1 z 2, že dá +6 mult.',
      glassblower:
        'Při získání přidá do balíčku 1 skleněnou kartu; každou zničenou skleněnou kartu hned vyfoukne do balíčku znovu.',
      notary_public:
        'První ruka Malé a Velké útraty dá ještě před skórováním první skórující kartě bez pečeti zlatou pečeť.',
      witch: 'Po porážce šéfa vytvoří náhodné úřední razítko (potřebuje volný slot).',
      water_goblin: 'Každá zahozená srdcová karta mu trvale přidá +1 mult (teď +0 mult).',
      will_o_wisp: 'V kole se šéfem dá každá ruka ×2 mult.',
      noon_witch: 'Druhá ruka kola dá ×2 mult.',
      klekanice: '×2 mult, pokud ti po zahrání v ruce nezůstala žádná figura.',
      parish_priest: '+5 mult za každou kartu v balíčku, která má vylepšení, pečeť nebo edici.',
      seer: 'Když jediná ruka dosáhne celého cíle Malé útraty, vytvoří pranostiku její kombinace (potřebuje volný slot).',
      court_painter: 'Všechny karty kromě kamenných se počítají jako figury.',
      colorblind_uncle: 'Srdcové a kárové karty se počítají jako jedna barva, pikové a křížové taky.',
      trodden_path: 'Mezi sousedními kartami Postupky smí chybět jedna hodnota.',
      war_loot: 'Na konci kola +2 Kč za každého šéfa poraženého od jeho koupě (teď +0 Kč).',
      anonymous_commenter: 'Každá zahraná karta, která neskóruje, dá +7 mult.',
      viral_video: 'První ruka kola dá +64 čipů, každá další ruka v kole polovinu předchozí.',
      carbon_paper: 'Kopíruje schopnost nejpravějšího běžného nebo vzácného žolíka, kterého jde kopírovat.',
      defenestration: 'Každé zahození, ve kterém je aspoň jedna figura, dá 5 Kč.',
      brno_native: '×1,5 mult, pokud stojí v řadě žolíků úplně vlevo.',
      social_bubble:
        'Když mají všechny skórující karty stejnou barvu nebo stejnou hodnotu, každá dá +15 čipů.',
      snowman: '×2,5 mult; po každém kole −×0,25, při ×1 roztaje a zničí se (teď ×2,5).',
      mushroom_picker: '×1 mult a navíc +×0,25 za každou hrací kartu zničenou od jeho koupě (teď ×1).',
      impersonator:
        'Při získání bez edice dostane duhovou; v každém kole kopíruje tvého nejdražšího běžného nebo vzácného žolíka.',
      innkeeper: '×2,2 mult, dokud se v tomto kole nezahazovalo.',
      grandmas_chest: '×1,3 mult za každou spotřebku, kterou držíš ve slotech.',
      beer_sommelier:
        '×1 mult a navíc +×0,7 za každou různou kombinaci zahranou v tomto kole (včetně této ruky).',
      archivist: 'Při získání bez edice dostane duhovou; kopíruje schopnost žolíka nalevo od sebe.',
      fair_magician: 'Skórují všechny zahrané karty a každá skórující karta dá ×1,15 mult.',
      tour_guide:
        'Postupka i Barva stačí ze čtyř karet a ruka, která obsahuje Postupku nebo Barvu, dá +40 čipů.',
      spartakiada: 'V první ruce kola skóruje každá skórující karta ještě 2×.',
      voucher_privatization:
        'Na konci kola +1 Kč za každých 5 % cíle, o které skóre kola cíl překročilo (nejvýš 8 Kč).',
      spa_guest: 'Za každé kolo, ve kterém se nezahazovalo, trvale +×0,15 mult (teď ×1).',
      brass_band: 'Každá skórující karta skóruje ještě 2× za každou další skórující kartu stejné hodnoty.',
      charles_bridge: '×3 mult, pokud držíš v ruce kartu stejné hodnoty jako některá skórující karta.',
      d1_motorway: '×2 mult; v ruce máš o 1 kartu méně.',
      exchange_office: '×1 mult a navíc +×0,1 za každých 15 čipů, které ruka v tu chvíli má (nejvýš ×2,5).',
      new_years_eve: 'Po každé porážce šéfa trvale +×0,2 mult (teď ×1).',
      forefather:
        'První ruka každého kola ještě před skórováním zvýší úroveň zahrané kombinace o 1 (zatím +0 úrovní).',
      libuse:
        'Každá skórující dáma dá ×1,4 mult; na konci kola promění 1 náhodnou kartu drženou v ruce v dámu.',
      blanik_knights: '×3 mult, dokud skóre kola nedosáhne 50 % cíle.',
      bruncvik_sword:
        'Při prvním zahození v kole zničí nejnižší zahozenou kartu a trvale získá +×0,2 mult (teď ×1).',
      faust: '×1 mult a navíc +×0,06 za každou korunu, kterou máš (nejvýš ×5).',
      krakonos: 'Každá použitá pranostika zvýší úroveň své kombinace o 1 navíc a dá +2 Kč.',
      silly_honza: 'Vysoká karta a Dvojice dávají ×4 mult.',
      astro_clock: '×2 mult v první ruce kola, ×3 ve druhé a ×4 v každé další.',
    });
  });

  it('šablony nemají čísla natvrdo (jen {param}); nepoužité params jsou jen nápověda pro boty', () => {
    // Výjimka: příklad Postupky kolem dokola u Kolotoče (hodnoty karet, ne číslo mechaniky).
    const EXAMPLES: Record<string, string> = { carousel: 'Q-K-A-2-3' };
    const BOT_HINTS = new Set(['suit', 'hand', 'level']);
    const texts = JOKER_TEXTS as Record<string, { desc: string }>;
    for (const d of JOKERS) {
      const template = texts[d.id]!.desc;
      let literal = template.replace(/\{[^}]*\}/g, '');
      const example = EXAMPLES[d.id];
      if (example) literal = literal.replace(example, '');
      expect(literal, d.id).not.toMatch(/\d/);
      const used = new Set([...template.matchAll(/\{(\w+)/g)].map((m) => m[1]!));
      const unused = Object.keys(d.params ?? {}).filter((k) => !used.has(k));
      for (const k of unused) expect(BOT_HINTS.has(k), `${d.id}.params.${k}`).toBe(true);
    }
  });
});

describe('žolíci – ArtSpec', () => {
  it('ikona, rekvizita, paleta i vzor; hlavní ikona i dvojice ikona + rekvizita jsou u každého jiná', () => {
    for (const d of JOKERS) {
      const { icon, prop, bg, fg, accent, pattern } = d.art;
      expect(
        [icon, prop, bg, fg, accent, pattern].every((v) => typeof v === 'string'),
        d.id,
      ).toBe(true);
    }
    expect(new Set(JOKERS.map((d) => d.art.icon)).size).toBe(JOKERS.length);
    expect(new Set(JOKERS.map((d) => `${d.art.icon}+${d.art.prop}`)).size).toBe(JOKERS.length);
  });
});

// ─────────────────────────── Napodobitel ───────────────────────────

describe('Napodobitel kopíruje každého žolíka', () => {
  it.each(OTHERS.map((id) => [id]))('%s', (id) => {
    const d = def(id);
    // Na hvězdy nemá: epické a legendární kopíruje jen obecný kopírující žolík (testovací `copier`, soused vpravo).
    const imitable = d.rarity === 'common' || d.rarity === 'rare';
    const copier = imitable ? 'impersonator' : 'copier';
    const copied = runScenario(id, [copier, spec(id)]);
    const alone = runScenario(id, [spec(id)]);
    const imp = instanceOf(copied.game, copier);
    const target = instanceOf(copied.game, id);
    const impSteps = stepsOf(copied.result, imp.uid);
    if (d.copyable === false) {
      // Nekopírovatelného si nevybere a nic nepřidá.
      if (imitable) expect(imp.state.target).toBeNull();
      expect(copied.value).toBe(alone.value);
      expect(impSteps).toEqual([]);
      return;
    }
    if (imitable) expect(imp.state.target).toBe(target.uid);
    else {
      // Napodobitel epického ani legendárního nevybere.
      const snubbed = runScenario(id, ['impersonator', spec(id)]);
      expect(instanceOf(snubbed.game, 'impersonator').state.target).toBeNull();
      expect(snubbed.value).toBe(alone.value);
    }
    // Kopie se chová jako druhá instance téhož žolíka se stejným stavem…
    const twice = runScenario(id, [spec(id), spec(id)]);
    expect(copied.value).toBe(twice.value);
    expect([copied.result.chips, copied.result.mult]).toEqual([twice.result.chips, twice.result.mult]);
    // …a efekt ve scénáři opravdu nastane.
    expect(copied.value).toBeGreaterThan(alone.value);
    // Kopie stav cíle nezmění: po ruce je stejný jako bez Napodobitele.
    expect(target.state).toEqual(instanceOf(alone.game, id).state);
  });

  it.each(IDS.map((id) => [id]))(
    '%s: stav po dvou kolech je stejný jako bez Napodobitele (kopie ho nezdvojí)',
    (id) => {
      /** Dvě kola: babská rada, zničená karta, slabá ruka, výhra, další kolo a slabá ruka. */
      function twoRounds(jokers: (string | JokerSpec)[]): Game {
        const g = makeGame({ registry: reg, jokers, round: true });
        g._core.state.round!.target = 1e9;
        const rada = g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true })!;
        ok(g.dispatch({ type: 'useConsumable', uid: rada.uid }));
        g._core.api.destroyCard(g.state.deck[0]!.id, 'test');
        play(g, setupRound(g, '2S'));
        play(g, setupRound(g, 'AD AH'));
        winRound(g);
        ok(g.dispatch({ type: 'cashOut' }));
        ok(g.dispatch({ type: 'leaveShop' }));
        ok(g.dispatch({ type: 'selectBlind' }));
        g._core.state.round!.target = 1e9;
        play(g, setupRound(g, '2S'));
        return g;
      }
      const jokers = id === 'impersonator' ? [id, PARTNER] : [id];
      const a = twoRounds(['impersonator', ...jokers]);
      const b = twoRounds(jokers);
      // Napodobitel: cíl porovnat podle druhu žolíka (uid se s žolíkem navíc posunou).
      const stateOf = (g: Game) => {
        const state = g.state.jokers.filter((j) => j.defId === id).at(-1)?.state ?? null;
        if (id !== 'impersonator' || !state) return state;
        return { ...state, target: g.state.jokers.find((j) => j.uid === state.target)?.defId ?? null };
      };
      expect(stateOf(a)).toEqual(stateOf(b));
      expect(JSON.parse(JSON.stringify(a.state.jokers))).toEqual(a.state.jokers);
    },
  );
});

// ─────────────────────────── Archivář ───────────────────────────

describe('Archivář kopíruje souseda vlevo (každého žolíka, i epické a legendární)', () => {
  const NEIGHBOURS = IDS.filter((id) => id !== 'archivist');

  it.each(NEIGHBOURS.map((id) => [id]))('%s', (id) => {
    const d = def(id);
    // `addJokers` nevolá `onAcquire` — Archivář je bez duhového kostýmu, kopie se dá porovnat s druhou instancí.
    const copied = runScenario(id, [spec(id), 'archivist']);
    const alone = runScenario(id, [spec(id)]);
    const arch = instanceOf(copied.game, 'archivist');
    const target = instanceOf(copied.game, id);
    if (d.copyable === false) {
      expect(arch.state.target).toBeNull();
      expect(copied.value).toBe(alone.value);
      expect(stepsOf(copied.result, arch.uid)).toEqual([]);
      return;
    }
    expect(arch.state.target).toBe(target.uid);
    const twice = runScenario(id, [spec(id), spec(id)]);
    expect(copied.value).toBe(twice.value);
    expect([copied.result.chips, copied.result.mult]).toEqual([twice.result.chips, twice.result.mult]);
    expect(copied.value).toBeGreaterThan(alone.value);
    expect(target.state).toEqual(instanceOf(alone.game, id).state);
  });

  it.each(NEIGHBOURS.map((id) => [id]))('%s: stav po dvou kolech je stejný jako bez Archiváře', (id) => {
    function twoRounds(jokers: (string | JokerSpec)[]): Game {
      const g = makeGame({ registry: reg, jokers, round: true });
      g._core.state.round!.target = 1e9;
      const rada = g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true })!;
      ok(g.dispatch({ type: 'useConsumable', uid: rada.uid }));
      g._core.api.destroyCard(g.state.deck[0]!.id, 'test');
      ok(g.dispatch({ type: 'discard', cardIds: setupRound(g, '2H KS 3C').map((c) => c.id) }));
      play(g, setupRound(g, '2S'));
      play(g, setupRound(g, 'AD AH'));
      winRound(g);
      ok(g.dispatch({ type: 'cashOut' }));
      ok(g.dispatch({ type: 'leaveShop' }));
      ok(g.dispatch({ type: 'selectBlind' }));
      g._core.state.round!.target = 1e9;
      play(g, setupRound(g, '2S'));
      return g;
    }
    const jokers = id === 'impersonator' ? [id, PARTNER] : [id];
    const a = twoRounds([...jokers, 'archivist']);
    const b = twoRounds(jokers);
    const stateOf = (g: Game) => {
      const state = g.state.jokers.find((j) => j.defId === id)?.state ?? null;
      if (id !== 'impersonator' || !state) return state;
      return { ...state, target: g.state.jokers.find((j) => j.uid === state.target)?.defId ?? null };
    };
    expect(stateOf(a)).toEqual(stateOf(b));
    expect(JSON.parse(JSON.stringify(a.state.jokers))).toEqual(a.state.jokers);
  });
});

// ─────────────────────────── Debuff ───────────────────────────

describe('debuffnutý žolík nedělá nic', () => {
  it.each(IDS.map((id) => [id]))('%s: ruka, passive i edice', (id) => {
    const debuff = (g: Game) => g._core.api.setJokerDebuffed(instanceOf(g, id).uid, true);
    const off = runScenario(id, lineup(id, { edition: 'foil' }), debuff);
    const base = runScenario(id, without(id));
    expect(off.value).toBe(base.value);
    expect([off.result.chips, off.result.mult]).toEqual([base.result.chips, base.result.mult]);
    expect(stepsOf(off.result, instanceOf(off.game, id).uid)).toEqual([]);
    // `passive` (Kolotoč, Sekera, Kůlna, Dvorní malíř, Dálnice D1…) taky neplatí — žádný modifikátor se nezmění.
    expect(off.game.modifiers()).toEqual(base.game.modifiers());
  });

  it.each(IDS.map((id) => [id]))(
    '%s: celé kolo — žádná odměna, počítadla stojí; debuff skončí s kolem',
    (id) => {
      const g = makeGame({ registry: reg, jokers: lineup(id), round: true });
      const j = instanceOf(g, id);
      const before = structuredClone(j.state);
      g._core.api.setJokerDebuffed(j.uid, true);
      g._core.state.round!.target = 1e9;
      const rada = g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true })!;
      ok(g.dispatch({ type: 'useConsumable', uid: rada.uid }));
      g._core.api.destroyCard(g.state.deck[0]!.id, 'test');
      play(g, setupRound(g, '2S'));
      expect(g.state.round!.discardsLeft).toBe(3);
      const rewards = winRound(g);
      expect(rewards.extra.filter((e) => e.jokerUid === j.uid)).toEqual([]);
      expect(j.state).toEqual(before);
      expect(g.state.jokers).toContain(j);
      expect(j.debuffed).toBe(false);
    },
  );

  it.each(OTHERS.filter((id) => def(id).copyable !== false).map((id) => [id]))(
    '%s: debuffnutý cíl Napodobitel nekopíruje',
    (id) => {
      const r = runScenario(id, ['impersonator', spec(id)], (g) =>
        g._core.api.setJokerDebuffed(instanceOf(g, id).uid, true),
      );
      expect(r.value).toBe(runScenario(id, []).value);
    },
  );
});

// ─────────────────────────── Edice ───────────────────────────

describe('edice žolíka platí vždy (i když žolík sám nic nedělá)', () => {
  const EDITION_IDS: EditionId[] = ['foil', 'holo', 'poly', 'negative'];

  it.each(IDS.map((id) => [id]))('%s', (id) => {
    const plain = runScenario(id, lineup(id));
    const uid = (g: Game) => instanceOf(g, id).uid;
    for (const edition of EDITION_IDS) {
      const r = runScenario(id, lineup(id, { edition }));
      const own = handStepsOf(r.result, uid(r.game));
      const { chips, mult } = r.result;
      switch (edition) {
        case 'foil':
          expect(own[0], edition).toMatchObject({ chips: 50 });
          expect([chips, mult], edition).toEqual([plain.result.chips + 50, plain.result.mult]);
          break;
        case 'holo': {
          expect(own[0], edition).toMatchObject({ mult: 10 });
          // +10 mult před vlastním efektem: ×mult žolíka (např. Sněhulák) násobí i těch +10.
          const xmult = handStepsOf(plain.result, uid(plain.game)).reduce((a, s) => a * (s.xmult ?? 1), 1);
          expect(chips, edition).toBe(plain.result.chips);
          expect(mult, edition).toBeCloseTo((plain.result.mult / xmult + 10) * xmult, 9);
          break;
        }
        case 'poly':
          expect(own.at(-1), edition).toMatchObject({ xmult: 1.5 });
          expect(chips, edition).toBe(plain.result.chips);
          expect(mult, edition).toBeCloseTo(plain.result.mult * 1.5, 9);
          break;
        case 'negative':
          expect(r.game._core.api.jokerSlots(), edition).toBe(plain.game._core.api.jokerSlots() + 1);
          expect(r.value, edition).toBe(plain.value);
          break;
      }
    }
  });
});

// ─────────────────────────── Prodej ───────────────────────────

describe('prodej žolíka', () => {
  /** Prodejní cena podle DESIGN 4.1: polovina ceny dolů (běžný 2 Kč, vzácný 3 Kč, epický 4–5 Kč). */
  const SELL: Record<string, number> = { common: 2, rare: 3 };

  it.each(IDS.map((id) => [id]))(
    '%s: ve Večerce za polovinu ceny, se všemi ostatními žolíky (onSell)',
    (id) => {
      const g = makeGame({ registry: reg, jokers: IDS, round: true });
      winRound(g);
      ok(g.dispatch({ type: 'cashOut' }));
      expect(g.state.phase).toBe('shop');
      const j = instanceOf(g, id);
      const d = def(id);
      const price = g._core.api.sellValue(j);
      expect(price).toBe(SELL[d.rarity] ?? Math.floor(d.cost / 2));
      const money = g.state.money;
      ok(g.dispatch({ type: 'sellJoker', uid: j.uid }));
      expect(g.state.money).toBe(money + price);
      expect(g.state.jokers.some((x) => x.uid === j.uid)).toBe(false);
      expect(JSON.parse(JSON.stringify(g.state))).toEqual(g.state);
    },
  );

  it.each(IDS.map((id) => [id]))('%s: prodaný uprostřed kola už nic nedává (ani passive)', (id) => {
    const sold = runScenario(id, lineup(id), (g) =>
      ok(g.dispatch({ type: 'sellJoker', uid: instanceOf(g, id).uid })),
    );
    const base = runScenario(id, without(id));
    expect(sold.value).toBe(base.value);
    expect(sold.game.modifiers()).toEqual(base.game.modifiers());
  });

  it('prodej Sekery v dluhu: zůstatek zůstane záporný, jen se k němu připočte cena', () => {
    const g = makeGame({ registry: reg, jokers: ['tab'], money: 0 });
    g._core.api.addMoney(-20, 'test');
    expect(g.state.money).toBe(-15);
    ok(g.dispatch({ type: 'sellJoker', uid: instanceOf(g, 'tab').uid }));
    expect(g.state.money).toBe(-12);
    expect(g.modifiers().debtLimit).toBe(0);
  });
});

// ─────────────────────────── Fuzz přes boty ───────────────────────────

/**
 * Testovací obsah (šéfové, spotřebky, obálky, štítky) s lehčími cíli a radou, která zničí kartu (Sběrač hub),
 * + všichni skuteční žolíci.
 */
const fuzzReg: ContentRegistry = makeRegistry({
  jokers: JOKERS,
  decks: [{ id: 'easy', passive: () => ({ targetMult: 0.3 }), art: ART }],
  consumables: [
    consumable('shredder', {
      use: (ctx) => {
        const victim = ctx.api.handCards()[0] ?? ctx.state.deck[0];
        if (victim) ctx.api.destroyCard(victim.id, 'test');
      },
    }),
  ],
});
const contentReg = buildRegistry();

const finished = (g: Game): boolean => g.state.phase === 'game_over' || g.state.phase === 'victory';

/**
 * Rozdělí všechny žolíky kromě Napodobitele (zamíchané podle seedu) do pětic — každý žolík je v některé pětici
 * se skutečným počtem slotů; Napodobitel nahradí prvního v každé druhé pětici (víc kopírujících sestav).
 */
function jokerGroups(seed: string, n: number): string[][] {
  const rng = rngFromState(cyrb128(seed));
  const pool = [...OTHERS];
  rng.shuffle(pool);
  const groups: string[][] = [];
  for (let i = 0; i < pool.length; i += n) groups.push(pool.slice(i, i + n));
  return groups.map((g, i) => (i % 2 === 1 ? [...g, 'impersonator'] : g));
}

interface FuzzRun {
  actions: Action[];
  json: string;
  reloads: number;
  /** Neplatné akce bota (engine akci odmítl) — cíl je 0. */
  invalid: { step: number; type: string; error: string }[];
}

/**
 * Run botem. Žolíci se vloží na začátku (bez kontroly slotů a bez `onAcquire`). `reloadEvery` = uložit a načíst každých
 * N akcí, ale jen uprostřed kola (první akce v kole po N akcích od posledního načtení). Po každé akci: stav žolíků je
 * JSON-bezpečný. Neplatné akce se zaznamenají (test chce žádnou); po 3 za sebou se pokračuje bezpečnou akcí, aby se
 * chyba ukázala ve výpisu a ne jako zamrznutí.
 */
function fuzzRun(
  registry: ContentRegistry,
  deckId: string,
  seed: string,
  bot: BotName,
  jokers: readonly string[],
  reloadEvery = 0,
): FuzzRun {
  let game = Game.newRun({ seed, deckId, stake: 1 }, registry);
  addJokers(game, jokers);
  const decide = createBot(bot);
  const actions: Action[] = [];
  const rejected: FuzzRun['invalid'] = [];
  let invalid = 0;
  let reloads = 0;
  let sinceReload = 0;
  for (let step = 0; step < 1500 && !finished(game); step++) {
    if (reloadEvery > 0 && ++sinceReload >= reloadEvery && game.state.phase === 'round') {
      game = Game.fromState(deserializeRun(JSON.parse(serializeRun(game.state))), registry);
      reloads++;
      sinceReload = 0;
    }
    const action: Action =
      invalid >= 3
        ? game.state.phase === 'round'
          ? { type: 'play', cardIds: game.state.round!.hand.slice(0, 1) }
          : game.state.phase === 'shop'
            ? { type: 'leaveShop' }
            : game.state.phase === 'booster'
              ? { type: 'skipBooster' }
              : game.state.phase === 'round_end'
                ? { type: 'cashOut' }
                : { type: 'selectBlind' }
        : decide.decide(game);
    actions.push(action);
    const res = game.dispatch(action);
    invalid = res.ok ? 0 : invalid + 1;
    if (!res.ok) rejected.push({ step, type: action.type, error: res.error });
    for (const j of game.state.jokers) {
      expect(JSON.parse(JSON.stringify(j)), `${seed} krok ${step}: ${j.defId}`).toEqual(j);
    }
    expect(Number.isFinite(game.state.money), `${seed} krok ${step}`).toBe(true);
  }
  expect(JSON.parse(JSON.stringify(game.state))).toEqual(game.state);
  return { actions, json: JSON.stringify(game.state), reloads, invalid: rejected };
}

describe('fuzz: runy se všemi žolíky přes boty (uložení a načtení uprostřed kola)', () => {
  it.each([
    ['testovací obsah', 'max'],
    ['testovací obsah', 'random'],
    ['testovací obsah', 'econ'],
    ['obsah hry', 'max'],
    ['obsah hry', 'pairs'],
  ] as const)(
    '%s – všech 101 žolíků naráz (%s)',
    (label, bot) => {
      const [registry, deck] = label === 'obsah hry' ? [contentReg, 'pub'] : [fuzzReg, 'easy'];
      const seed = `FUZZ-ALL-${bot}`;
      const reference = fuzzRun(registry, deck, seed, bot, IDS);
      const resumed = fuzzRun(registry, deck, seed, bot, IDS, 4);
      expect(reference.invalid).toEqual([]);
      expect(resumed.reloads).toBeGreaterThan(5);
      expect(resumed.actions).toEqual(reference.actions);
      expect(resumed.json).toBe(reference.json);
    },
    120_000,
  );

  const GROUPS = jokerGroups('FUZZ-GROUPS', 5);
  const BOTS: BotName[] = ['max', 'flush', 'pairs', 'econ'];

  it('pětice pokrývají všech 101 žolíků', () => {
    expect(new Set(GROUPS.flat())).toEqual(new Set(IDS));
  });

  it.each(
    GROUPS.map((jokers, i) => [`FUZZ-SET-${i + 1}`, BOTS[i % BOTS.length]!, jokers.join(', ')] as const),
  )(
    '%s – bot %s, žolíci %s',
    (seed, bot, list) => {
      const jokers = list.split(', ');
      const [registry, deck] =
        Number(seed.split('-').at(-1)) % 2 === 0 ? [contentReg, 'pub'] : [fuzzReg, 'easy'];
      const reference = fuzzRun(registry, deck, seed, bot, jokers);
      const resumed = fuzzRun(registry, deck, seed, bot, jokers, 3);
      expect(reference.invalid).toEqual([]);
      expect(resumed.reloads).toBeGreaterThan(3);
      expect(resumed.actions).toEqual(reference.actions);
      expect(resumed.json).toBe(reference.json);
    },
    120_000,
  );
});
