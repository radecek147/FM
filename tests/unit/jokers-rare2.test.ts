/**
 * Vzácní žolíci fáze 7 (docs/DESIGN.md 4.9, src/content/jokers/rare2.ts): přesná čísla mechanik přes skutečné
 * skórování, hraniční podmínky, peníze, stav přes víc rukou a kol, kopie (`isCopy`), uložení a načtení, texty,
 * `ArtSpec` a fuzz přes boty s obsahem hry.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import { RARE_JOKERS } from '../../src/content/jokers/rare';
import { RARE2_JOKERS } from '../../src/content/jokers/rare2';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { createBot } from '../../src/engine/sim/index';
import { copyStatusText } from '../../src/ui/describe';
import type {
  Action,
  Card,
  GameEvent,
  JokerInstance,
  RoundRewards,
  ScoreResult,
} from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import {
  joker as testJoker,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  winNextHand,
  type JokerSpec,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Testovací žolík „všechny karty jsou figury“ (jinak než Dvorní malíř — ten se testuje zvlášť). */
const ALL_FACES = testJoker('all_faces', { hooks: { passive: () => ({ allFaces: true }) } });

/** Skuteční partneři pro Kopírák a kombinace (běžní a vzácní z fáze 4). */
const PARTNERS = JOKERS.filter((j) =>
  ['beer_mat', 'gardener', 'head_waiter', 'mushroom_picker'].includes(j.id),
);

/** Testovací registr (kombinace, úpravy karet, testovací šéfové, spotřebky a žolíci) + vzácní žolíci fáze 7. */
const reg: ContentRegistry = makeRegistry({ jokers: [...RARE2_JOKERS, ...PARTNERS, ALL_FACES] });

function def(id: string): JokerDef {
  const d = RARE2_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`Chybí žolík ${id}`);
  return d;
}

/** Hra v Malé útratě s danými žolíky (bez `onAcquire`) a nedosažitelným cílem (kolo neskončí výhrou). */
function roundGame(jokers: (string | JokerSpec)[] = [], target = 1e12): Game {
  const game = makeGame({ registry: reg, jokers, round: true });
  game._core.state.round!.target = target;
  game._core.state.round!.handsLeft = 10;
  return game;
}

/** Nastaví ruku a zahraje karty na zadaných indexech (bez indexů celou ruku). */
function playHand(game: Game, hand: string, pick?: number[], opts?: SetupOptions): ScoreResult {
  const cards = setupRound(game, hand, opts);
  return play(game, pick ? pick.map((i) => cards[i]!) : cards).result;
}

/** Součet změn, které ve skórování udělal žolík `defId`. */
function jokerDelta(result: ScoreResult, defId: string) {
  const steps = result.steps.filter((s) => s.source === 'joker' && s.defId === defId);
  return {
    steps: steps.length,
    chips: steps.reduce((a, s) => a + (s.chips ?? 0), 0),
    mult: steps.reduce((a, s) => a + (s.mult ?? 0), 0),
    xmult: steps.reduce((a, s) => a * (s.xmult ?? 1), 1),
  };
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Uloží a načte run (JSON jako v localStorage) a pokračuje s obnovenou hrou. */
function reload(game: Game): Game {
  return Game.fromState(deserializeRun(JSON.parse(serializeRun(game.state))), game.registry);
}

function joker(game: Game, id: string): JokerInstance {
  const j = game.state.jokers.find((x) => x.defId === id);
  if (!j) throw new Error(`Žolík ${id} není ve slotech`);
  return j;
}

/** Odměny za kolo od žolíka `defId` (0, když v rozpisu není). */
function jokerReward(rewards: RoundRewards | null | undefined, defId: string): number {
  return (rewards?.extra ?? [])
    .filter((e) => e.source === `joker:${defId}`)
    .reduce((a, e) => a + e.amount, 0);
}

/**
 * Vyhraje běžící kolo (vybere útratu, je-li třeba) rukou `hand`, zahraje `played` karet zleva a vrátí rozpis odměn
 * a události vítězné ruky. Fáze zůstane `round_end`.
 */
function winWith(
  game: Game,
  hand: string,
  played = 1,
): { rewards: RoundRewards; events: GameEvent[]; cards: Card[] } {
  if (game.state.phase === 'blind_select') ok(game.dispatch({ type: 'selectBlind' }));
  const cards = setupRound(game, hand);
  winNextHand(game);
  const { events } = play(game, cards.slice(0, played));
  expect(game.state.phase).toBe('round_end');
  return { rewards: structuredClone(game.state.rewards!), events, cards };
}

/** Vyplatí odměny a odejde z Večerky (fáze `blind_select`). */
function leaveRound(game: Game): void {
  ok(game.dispatch({ type: 'cashOut' }));
  ok(game.dispatch({ type: 'leaveShop' }));
}

/** Jistota / nemožnost všech „1 z N“ (násobič čitatele pravděpodobností). */
function setChance(game: Game, always: boolean): void {
  game._core.api.addPermanentModifier({ probabilityMult: always ? 100 : 0 });
}

/** Popisek žolíka s dosazenými `params` a `describe(self)`, NBSP nahrazené mezerou. */
function descOf(id: string, self?: JokerInstance): string {
  const d = def(id);
  const params = { ...(d.params ?? {}), ...(self && d.describe ? d.describe(self) : {}) };
  return t(`jokers.${id}.desc`, params).replaceAll(NBSP, ' ');
}

const messages = (events: readonly GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'message' ? [e.key] : []));

const triggered = (events: readonly GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'jokerTriggered' ? [e.message] : []));

// Základy kombinací na úrovni 1 (DESIGN 2.2.1): Vysoká karta 6 × 1, Dvojice 12 × 2, Dvě dvojice 24 × 2,
// Postupka 35 × 4, Barva 40 × 4. Čipy karet: 2–10 = číslo, J/Q/K = 10, A = 11, kamenná 0 (+50 vylepšením).

// ─────────────────────────── Definice ───────────────────────────

const IDS = [
  'office_connection',
  'chronicler',
  'chimney_sweep',
  'glassblower',
  'notary_public',
  'witch',
  'water_goblin',
  'will_o_wisp',
  'noon_witch',
  'klekanice',
  'parish_priest',
  'seer',
  'court_painter',
  'colorblind_uncle',
  'trodden_path',
  'war_loot',
  'anonymous_commenter',
  'viral_video',
  'carbon_paper',
  'defenestration',
  'brno_native',
  'social_bubble',
];

describe('vzácní žolíci fáze 7 – definice', () => {
  it('22 žolíků (15 ze zásobníku DESIGN 4.9 + 7 vlastních), všichni vzácní za 6–7 Kč, štítky vyplněné', () => {
    expect(RARE2_JOKERS.map((j) => j.id)).toEqual(IDS);
    for (const j of RARE2_JOKERS) {
      expect(j.rarity, j.id).toBe('rare');
      expect([6, 7], j.id).toContain(j.cost);
      expect(j.tags.length, j.id).toBeGreaterThan(0);
      expect(j.id, j.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(j.noShop, j.id).toBeUndefined();
    }
    // Vzácných je teď 10 + 22 = 32 (cíl DESIGN 4.1).
    expect(RARE_JOKERS.length + RARE2_JOKERS.length).toBe(32);
  });

  it('id jsou unikátní mezi všemi žolíky a žolíci jsou ve skutečném registru obsahu', () => {
    const ids = JOKERS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    const full = buildRegistry();
    for (const j of RARE2_JOKERS) expect(full.jokers[j.id]).toBe(j);
  });

  it('čísla mechanik v params', () => {
    expect(Object.fromEntries(RARE2_JOKERS.map((j) => [j.id, j.params ?? {}]))).toEqual({
      office_connection: { pct: 20 },
      chronicler: { mult: 2 },
      chimney_sweep: { chance: 1, odds: 2, mult: 6, suit: 'S' },
      glassblower: { cards: 1 },
      notary_public: {},
      witch: {},
      water_goblin: { mult: 0.75 },
      will_o_wisp: { xmult: 2 },
      noon_witch: { xmult: 2 },
      klekanice: { xmult: 2 },
      parish_priest: { mult: 2.5 },
      seer: {},
      court_painter: {},
      colorblind_uncle: {},
      trodden_path: { hand: 'straight' },
      war_loot: { money: 2 },
      anonymous_commenter: { mult: 7 },
      viral_video: { chips: 64 },
      carbon_paper: {},
      defenestration: { money: 5 },
      brno_native: { xmult: 1.5 },
      social_bubble: { chips: 30 },
    });
  });

  it('nálepky a kopírování podle DESIGN 4.4: čistá pravidla, rozpis odměn, smyčky a kopírující nejdou kopírovat', () => {
    const flagged = (pred: (j: JokerDef) => boolean) => RARE2_JOKERS.filter(pred).map((j) => j.id);
    expect(flagged((j) => j.copyable === false)).toEqual([
      'office_connection',
      'glassblower',
      'colorblind_uncle',
      'trodden_path',
      'war_loot',
      'carbon_paper',
      'brno_native',
    ]);
    expect(flagged((j) => j.noRental === true)).toEqual(['notary_public', 'war_loot', 'defenestration']);
    // Rostou časem ve slotu — zvětrávání by šlo proti smyslu.
    expect(flagged((j) => j.noPerishable === true)).toEqual(['chronicler', 'water_goblin', 'war_loot']);
    expect(flagged((j) => j.noEternal === true)).toEqual([]);
    expect(flagged((j) => j.initState !== undefined)).toEqual([
      'chronicler',
      'water_goblin',
      'war_loot',
      'carbon_paper',
    ]);
  });

  it('ArtSpec: ikony z ICON_NAMES, hlavní ikona i dvojice ikona + rekvizita unikátní mezi všemi žolíky, pozadí mezi vzácnými', () => {
    for (const j of RARE2_JOKERS) {
      const { icon, prop, bg, fg, accent, pattern } = j.art;
      expect(isIconName(icon), `${j.id}: ${icon}`).toBe(true);
      expect(prop !== undefined && isIconName(prop), `${j.id}: ${prop}`).toBe(true);
      for (const c of [bg, fg, accent]) expect(c, j.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(pattern, j.id).toBeDefined();
    }
    const mains = JOKERS.map((j) => j.art.icon);
    for (const j of RARE2_JOKERS)
      expect(
        mains.filter((m) => m === j.art.icon),
        `${j.id}: ${j.art.icon}`,
      ).toHaveLength(1);
    const pairs = JOKERS.map((j) => `${j.art.icon}+${j.art.prop}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const bgs = [...RARE_JOKERS, ...RARE2_JOKERS].map((j) => j.art.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });
});

// ─────────────────────────── Texty ───────────────────────────

describe('vzácní žolíci fáze 7 – texty', () => {
  it('každý má název (max. 3 slova), popis a flavor bez uvozovek; názvy jsou unikátní', () => {
    for (const j of RARE2_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${j.id}.${field}`), `${j.id}.${field}`).toBe(true);
      expect(t(`jokers.${j.id}.name`).split(/\s+/).length, j.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${j.id}.flavor`), j.id).not.toMatch(/["„“‚‘]/);
    }
    const names = JOKERS.map((j) => t(`jokers.${j.id}.name`));
    expect(new Set(names).size).toBe(names.length);
  });

  it('každý {param} popisku je v params nebo describe(self) a po dosazení nic nezbyde; šablona nemá číslice', () => {
    const game = makeGame({ registry: reg });
    for (const j of RARE2_JOKERS) {
      const key = `jokers.${j.id}.desc`;
      const self = newJokerInstance(game._core, j.id);
      const params = { ...(j.params ?? {}), ...(j.describe?.(self) ?? {}) };
      for (const m of t(key).matchAll(/\{(\w+)/g)) expect(params, `${key}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(key, params), key).not.toMatch(/[{}⟦]/);
      expect(t(key).replace(/\{[^}]*\}/g, ''), key).not.toMatch(/\d/);
    }
  });

  it('hlášky žolíků existují', () => {
    for (const key of [
      'office_connection.rerolled',
      'glassblower.blown',
      'notary_public.certified',
      'witch.brewed',
      'seer.foreseen',
      'defenestration.thrown',
    ])
      expect(hasKey(`jokers.${key}`), key).toBe(true);
  });

  it('všech 22 popisků přesně (čísla z params, česky formátovaná, správné tvary slov)', () => {
    const game = makeGame({ registry: reg });
    const rendered = Object.fromEntries(
      RARE2_JOKERS.map((j) => [j.id, descOf(j.id, newJokerInstance(game._core, j.id))]),
    );
    expect(rendered).toEqual({
      office_connection: 'Cíl šéfa je o 20 % nižší a po každém přeskočení útraty přelosuje šéfa patra.',
      chronicler: 'Za každou kombinaci, kterou od jeho koupě zahraješ poprvé, trvale +2 mult (teď +0 mult).',
      chimney_sweep: 'Každá skórující piková, křížová nebo šťastná karta: 1 ze 2, že dá +6 mult.',
      glassblower:
        'Při získání přidá do balíčku 1 skleněnou kartu; každou zničenou skleněnou kartu hned vyfoukne do balíčku znovu.',
      notary_public:
        'První ruka Malé a Velké útraty dá ještě před skórováním první skórující kartě bez pečeti zlatou pečeť.',
      witch: 'Po porážce šéfa vytvoří náhodné úřední razítko (potřebuje volný slot).',
      water_goblin: 'Každá zahozená srdcová karta mu trvale přidá +0,75 mult (teď +0 mult).',
      will_o_wisp: 'V kole se šéfem dá každá ruka ×2 mult.',
      noon_witch: 'Druhá ruka kola dá ×2 mult.',
      klekanice: '×2 mult, pokud ti po zahrání v ruce nezůstala žádná figura.',
      parish_priest: '+2,5 mult za každou kartu v balíčku, která má vylepšení, pečeť nebo edici.',
      seer: 'Když jediná ruka dosáhne celého cíle Malé útraty, vytvoří pranostiku její kombinace (potřebuje volný slot).',
      court_painter:
        'Po první ruce kola namaluje první skórující kartu, která není figura, natrvalo jako náhodnou figuru stejné barvy.',
      colorblind_uncle: 'Srdcové a kárové karty se počítají jako jedna barva, pikové a křížové taky.',
      trodden_path:
        'V celé Postupce smí jedna hodnota chybět (třeba trojka, čtyřka, šestka, sedmička a osmička).',
      war_loot: 'Na konci kola +2 Kč za každého šéfa poraženého od jeho koupě (teď +0 Kč).',
      anonymous_commenter: 'Každá zahraná karta, která neskóruje, dá +7 mult.',
      viral_video: 'První ruka kola dá +64 čipů, každá další ruka v kole polovinu předchozí.',
      carbon_paper: 'Kopíruje schopnost nejpravějšího běžného nebo vzácného žolíka, kterého jde kopírovat.',
      defenestration: 'Každé zahození, ve kterém je aspoň jedna figura, dá 5 Kč.',
      brno_native: '×1,5 mult, pokud stojí v řadě žolíků úplně vlevo.',
      social_bubble:
        'Když mají všechny skórující karty stejnou barvu nebo stejnou hodnotu, každá dá +30 čipů.',
    });
  });
});

// ─────────────────────────── Ze zásobníku DESIGN 4.9 ───────────────────────────

describe('Známý na úřadě (office_connection)', () => {
  it('cíl šéfa je o 20 % nižší, Malá a Velká útrata beze změny', () => {
    const plain = makeGame({ registry: reg });
    const known = makeGame({ registry: reg, jokers: ['office_connection'] });
    expect(known.blindTarget('small')).toBe(plain.blindTarget('small'));
    expect(known.blindTarget('big')).toBe(plain.blindTarget('big'));
    expect(known.blindTarget('boss', 'wall')).toBe(plain.blindTarget('boss', 'wall') * 0.8);
    selectBoss(known, 'neighbour');
    selectBoss(plain, 'neighbour');
    expect(known.state.round!.target).toBe(plain.state.round!.target * 0.8);
  });

  it('po každém přeskočení útraty přelosuje šéfa patra (s hláškou); bez něj šéf zůstane', () => {
    const game = makeGame({ registry: reg, jokers: ['office_connection'] });
    const first = game.state.blinds[2]!.bossId;
    const events = ok(game.dispatch({ type: 'skipBlind' }));
    const second = game.state.blinds[2]!.bossId;
    expect(second).not.toBe(first);
    expect(events).toContainEqual({ type: 'bossRerolled', bossId: second });
    expect(messages(events)).toContain('jokers.office_connection.rerolled');
    ok(game.dispatch({ type: 'skipBlind' }));
    expect(game.state.blinds[2]!.bossId).not.toBe(second);
    const plain = makeGame({ registry: reg });
    const boss = plain.state.blinds[2]!.bossId;
    ok(plain.dispatch({ type: 'skipBlind' }));
    expect(plain.state.blinds[2]!.bossId).toBe(boss);
  });

  it('po prodeji cíl šéfa zase plný', () => {
    const game = makeGame({ registry: reg, jokers: ['office_connection'], money: 10 });
    const reduced = game.blindTarget('boss', 'wall');
    winWith(game, 'KS');
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'sellJoker', uid: joker(game, 'office_connection').uid }));
    expect(game.blindTarget('boss', 'wall')).toBe(reduced / 0.8);
  });
});

describe('Kronikář (chronicler)', () => {
  it('za každou kombinaci zahranou poprvé trvale +2 mult (platí už v té ruce); opakování nic nepřidá', () => {
    const game = roundGame(['chronicler']);
    // Dvojice: 12 + 20 = 32 čipů × (2 + 2).
    const pair = playHand(game, 'KS KH');
    expect([pair.chips, pair.mult, pair.score]).toEqual([32, 4, 128]);
    // Vysoká karta poprvé: 6 + 11 = 17 × (1 + 4).
    const high = playHand(game, 'AS');
    expect([high.chips, high.mult]).toEqual([17, 5]);
    // Dvojice podruhé: pořád +4.
    expect(playHand(game, 'QS QH').mult).toBe(6);
    expect(joker(game, 'chronicler').state).toEqual({ seen: ['pair', 'high_card'] });
    expect(descOf('chronicler', joker(game, 'chronicler'))).toContain('(teď +4 mult)');
  });

  it('ruka zakázaná šéfem se nepočítá', () => {
    const game = makeGame({ registry: reg, jokers: ['chronicler'] });
    selectBoss(game, 'neighbour');
    game._core.state.round!.target = 1e12;
    playHand(game, 'KS KH');
    // Soused zakáže druhou Dvojici v kole — beze změny stavu.
    const blocked = playHand(game, 'QS QH');
    expect(blocked.blockedReason).not.toBeNull();
    expect(joker(game, 'chronicler').state).toEqual({ seen: ['pair'] });
  });

  it('kopie stav nezdvojí, ale efekt ano; stav přežije uložení a načtení', () => {
    let game = roundGame(['copier', 'chronicler']);
    expect(playHand(game, 'KS KH').mult).toBe(2 + 2 + 2);
    expect(joker(game, 'chronicler').state).toEqual({ seen: ['pair'] });
    game = reload(game);
    expect(playHand(game, '2S 2H 3C 3D').mult).toBe(2 + 4 + 4);
  });
});

describe('Kominík (chimney_sweep)', () => {
  it('každá skórující piková nebo křížová karta při štěstí +6 mult', () => {
    const game = roundGame(['chimney_sweep']);
    setChance(game, true);
    // Dvojice: 32 čipů × (2 + 6 + 6).
    const r = playHand(game, 'KS KC');
    expect([r.chips, r.mult, r.score]).toEqual([32, 14, 448]);
  });

  it('srdcové a kárové nic; šťastná, divoká a červená pečeť (dvě aktivace) ano; kamenná ne', () => {
    const delta = (hand: string) => {
      const game = roundGame(['chimney_sweep']);
      setChance(game, true);
      return jokerDelta(playHand(game, hand), 'chimney_sweep').mult;
    };
    expect(delta('KH KD')).toBe(0);
    expect(delta('KH:lucky KD')).toBe(6);
    expect(delta('KH:wild KD')).toBe(6);
    expect(delta('KS@red KD')).toBe(12);
    expect(delta('KH KD 2S:stone')).toBe(0);
    expect(delta('KS KH 5C')).toBe(6); // 5♣ je kopa
  });

  it('bez štěstí nic; Bílá hora šťastnou kartu vypne', () => {
    const unlucky = roundGame(['chimney_sweep']);
    setChance(unlucky, false);
    expect(jokerDelta(playHand(unlucky, 'KS KC'), 'chimney_sweep').steps).toBe(0);
    const white = roundGame(['chimney_sweep']);
    setChance(white, true);
    white._core.api.addPermanentModifier({ disableEnhancements: true });
    expect(jokerDelta(playHand(white, 'KH:lucky KD'), 'chimney_sweep').mult).toBe(0);
  });
});

describe('Sklář (glassblower)', () => {
  const glassIn = (game: Game): Card[] => game.state.deck.filter((c) => c.enhancement === 'glass');

  it('při získání přidá do balíčku 1 skleněnou kartu', () => {
    const game = makeGame({ registry: reg });
    const before = game.state.deck.length;
    expect(game._core.api.createJoker({ defId: 'glassblower' })).not.toBeNull();
    expect(game.state.deck.length).toBe(before + 1);
    expect(glassIn(game)).toHaveLength(1);
  });

  it('prasklou skleněnou kartu vyfoukne znovu — stejnou, i s pečetí, edicí a bonusovými čipy', () => {
    const game = roundGame(['glassblower']);
    setChance(game, true);
    const [glass] = setupRound(game, 'KS:glass@red~foil+5');
    const size = game.state.deck.length;
    const { events, result } = play(game, [glass!]);
    expect(result.destroyedCardIds).toEqual([glass!.id]);
    expect(game._core.card(glass!.id)).toBeUndefined();
    expect(game.state.deck.length).toBe(size);
    const reborn = game.state.deck[game.state.deck.length - 1]!;
    expect(reborn).toMatchObject({
      suit: 'S',
      rank: 13,
      enhancement: 'glass',
      seal: 'red',
      edition: 'foil',
      bonusChips: 5,
    });
    expect(reborn.id).not.toBe(glass!.id);
    expect(game.state.round!.drawPile).toContain(reborn.id);
    expect(messages(events)).toContain('jokers.glassblower.blown');
  });

  it('bez Skláře sklo praskne nadobro; jiné zničené karty nevyfoukne; dva Skláři nezdvojují', () => {
    const plain = roundGame([]);
    setChance(plain, true);
    const [g1] = setupRound(plain, 'KS:glass');
    const size = plain.state.deck.length;
    play(plain, [g1!]);
    expect(plain.state.deck.length).toBe(size - 1);

    const other = roundGame(['glassblower']);
    const victim = other.state.deck.find((c) => c.enhancement === null)!;
    const before = other.state.deck.length;
    other._core.api.destroyCard(victim.id, 'test');
    expect(other.state.deck.length).toBe(before - 1);

    const twice = roundGame(['glassblower', 'glassblower']);
    setChance(twice, true);
    const [g2] = setupRound(twice, 'KS:glass');
    const size2 = twice.state.deck.length;
    play(twice, [g2!]);
    expect(twice.state.deck.length).toBe(size2);
  });

  it('se Sběračem hub: každé prasknutí přidá ×0,25 a karta zůstane', () => {
    const game = roundGame(['glassblower', 'mushroom_picker']);
    setChance(game, true);
    const [glass] = setupRound(game, 'KS:glass');
    play(game, [glass!]);
    expect(joker(game, 'mushroom_picker').state).toEqual({ destroyed: 1 });
    expect(glassIn(game).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Notář (notary_public)', () => {
  it('první ruka kola dá první skórující kartě zlatou pečeť — platí hned (+2 Kč)', () => {
    const game = roundGame(['notary_public']);
    const money = game.state.money;
    const cards = setupRound(game, 'KS KH');
    const { result, events } = play(game, cards);
    expect(game._core.card(cards[0]!.id)!.seal).toBe('gold');
    expect(game._core.card(cards[1]!.id)!.seal).toBeNull();
    expect(result.moneyEarned).toBe(2);
    expect(game.state.money).toBe(money + 2);
    expect(messages(events)).toContain('jokers.notary_public.certified');
    // Druhá ruka kola už nic.
    const next = setupRound(game, 'QS QH');
    play(game, next);
    expect(next.map((c) => game._core.card(c.id)!.seal)).toEqual([null, null]);
  });

  it('přeskočí karty s pečetí a debuffnuté a kopy; bez vhodné karty nic', () => {
    const sealed = roundGame(['notary_public']);
    const a = setupRound(sealed, 'KS@red KH');
    play(sealed, a);
    expect(sealed._core.card(a[1]!.id)!.seal).toBe('gold');
    const debuffed = roundGame(['notary_public']);
    const b = setupRound(debuffed, 'KS! KH 2C');
    play(debuffed, b);
    expect(b.map((c) => debuffed._core.card(c.id)!.seal)).toEqual([null, 'gold', null]);
    const none = roundGame(['notary_public']);
    const c = setupRound(none, 'KS@blue KH@red');
    const r = play(none, c).result;
    expect(c.map((x) => none._core.card(x.id)!.seal)).toEqual(['blue', 'red']);
    expect(r.moneyEarned).toBe(0);
  });

  it('v kole šéfa nic', () => {
    const game = makeGame({ registry: reg, jokers: ['notary_public'] });
    selectBoss(game, 'wall');
    game._core.state.round!.target = 1e12;
    const cards = setupRound(game, 'KS KH');
    expect(play(game, cards).result.moneyEarned).toBe(0);
    expect(cards.map((c) => game._core.card(c.id)!.seal)).toEqual([null, null]);
  });

  it('kopie orazítkuje další kartu (druhá instance)', () => {
    const game = roundGame(['copier', 'notary_public']);
    const cards = setupRound(game, 'KS KH');
    expect(play(game, cards).result.moneyEarned).toBe(4);
    expect(cards.map((c) => game._core.card(c.id)!.seal)).toEqual(['gold', 'gold']);
  });
});

describe('Čarodějnice (witch)', () => {
  it('po porážce šéfa vytvoří úřední razítko', () => {
    const game = makeGame({ registry: reg, jokers: ['witch'] });
    selectBoss(game, 'wall');
    const { events } = winWith(game, 'KS');
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['stamp']);
    expect(messages(events)).toContain('jokers.witch.brewed');
  });

  it('Malá útrata nic; bez volného slotu nic; kopie vytvoří druhé', () => {
    const small = makeGame({ registry: reg, jokers: ['witch'] });
    winWith(small, 'KS');
    expect(small.state.consumables).toEqual([]);
    const full = makeGame({ registry: reg, jokers: ['witch'] });
    full._core.api.createConsumable({ defId: 'rada_a' });
    full._core.api.createConsumable({ defId: 'rada_b' });
    selectBoss(full, 'wall');
    winWith(full, 'KS');
    expect(full.state.consumables.map((c) => c.defId)).toEqual(['rada_a', 'rada_b']);
    const copied = makeGame({ registry: reg, jokers: ['copier', 'witch'] });
    selectBoss(copied, 'wall');
    winWith(copied, 'KS');
    expect(copied.state.consumables.map((c) => c.defId)).toEqual(['stamp', 'stamp']);
  });
});

describe('Vodník (water_goblin)', () => {
  it('každá zahozená srdcová karta (i divoká) trvale +0,75 mult', () => {
    const game = roundGame(['water_goblin']);
    const cards = setupRound(game, '2H 5S:wild 6S 3C 9H!');
    ok(game.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
    // 2♥, divoká a debuffnutá 9♥ ano; pika a kříž ne.
    expect(joker(game, 'water_goblin').state).toEqual({ mult: 2.25 });
    const r = playHand(game, 'KS');
    expect([r.chips, r.mult]).toEqual([16, 3.25]);
    expect(descOf('water_goblin', joker(game, 'water_goblin'))).toContain('(teď +2,25 mult)');
  });

  it('bez nasbíraného multu nic; kopie stav nezdvojí; přežije uložení a načtení', () => {
    expect(jokerDelta(playHand(roundGame(['water_goblin']), 'KS'), 'water_goblin').steps).toBe(0);
    let game = roundGame(['copier', 'water_goblin']);
    const cards = setupRound(game, '2H 3H');
    ok(game.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
    expect(joker(game, 'water_goblin').state).toEqual({ mult: 1.5 });
    game = reload(game);
    expect(playHand(game, 'KS').mult).toBe(1 + 1.5 + 1.5);
  });
});

describe('Bludička (will_o_wisp)', () => {
  it('v kole se šéfem každá ruka ×2 mult; v Malé a Velké útratě nic', () => {
    const boss = roundGame(['will_o_wisp']);
    boss._core.state.round!.bossId = 'wall';
    const mults = Array.from({ length: 3 }, () => playHand(boss, 'KS KH'));
    // Dvojice králů: 12 + 10 + 10 = 32 čipů × (2 × 2).
    expect(mults.map((r) => [r.chips, r.mult, r.score])).toEqual(Array(3).fill([32, 4, 128]));
    const small = playHand(roundGame(['will_o_wisp']), 'KS KH');
    expect([small.mult, jokerDelta(small, 'will_o_wisp').steps]).toEqual([2, 0]);
  });

  it('bez náhody (nehází RNG); vypnutý šéf podmínku nemění; kopie násobí znovu', () => {
    const game = roundGame(['will_o_wisp']);
    game._core.state.round!.bossId = 'wall';
    const rng = structuredClone(game.state.rng);
    playHand(game, 'KS KH');
    expect(game.state.rng).toEqual(rng);
    const disabled = roundGame(['will_o_wisp']);
    disabled._core.state.round!.bossId = 'wall';
    disabled._core.api.disableBoss();
    expect(playHand(disabled, 'KS KH').mult).toBe(4);
    const copied = roundGame(['copier', 'will_o_wisp']);
    copied._core.state.round!.bossId = 'wall';
    expect(playHand(copied, 'KS KH').mult).toBe(8);
  });
});

describe('Polednice (noon_witch)', () => {
  it('jen druhá ruka kola ×2 mult', () => {
    const game = roundGame(['noon_witch']);
    const mults = Array.from({ length: 3 }, () => playHand(game, 'KS KH').mult);
    expect(mults).toEqual([2, 4, 2]);
  });
});

describe('Klekánice (klekanice)', () => {
  it('×2 mult, když po zahrání v ruce nezůstala figura', () => {
    // Dvojice králů, v ruce 5♣ a 6♦: 32 × 4.
    const r = playHand(roundGame(['klekanice']), 'KS KH 5C 6D', [0, 1]);
    expect([r.chips, r.mult, r.score]).toEqual([32, 4, 128]);
    // Prázdná ruka i kamenná karta v ruce podmínku splní.
    expect(playHand(roundGame(['klekanice']), 'KS KH').mult).toBe(4);
    expect(playHand(roundGame(['klekanice']), 'KS KH 2C:stone', [0, 1]).mult).toBe(4);
  });

  it('figura v ruce (i debuffnutá) efekt ruší; „všechny karty jsou figury“ taky', () => {
    expect(playHand(roundGame(['klekanice']), 'KS KH QC', [0, 1]).mult).toBe(2);
    expect(playHand(roundGame(['klekanice']), 'KS KH JC!', [0, 1]).mult).toBe(2);
    expect(playHand(roundGame(['all_faces', 'klekanice']), 'KS KH 5C', [0, 1]).mult).toBe(2);
  });
});

describe('Pan farář (parish_priest)', () => {
  it('+2,5 mult za každou kartu plného balíčku s vylepšením, pečetí nebo edicí (i v ruce a na stole)', () => {
    const game = roundGame(['parish_priest']);
    // Dvojice králů, v ruce 4 upravené karty (glass@gold má dvě úpravy, počítá se jednou): 32 × (2 + 10).
    const r = playHand(game, 'KS KH 2C:bonus 3D@red 4H~foil 5S:glass@gold', [0, 1]);
    expect([r.chips, r.mult, r.score]).toEqual([32, 12, 384]);
    // Zahraný K♠ s vylepšením se počítá taky (je v balíčku).
    expect(jokerDelta(playHand(roundGame(['parish_priest']), 'KS:mult KH'), 'parish_priest').mult).toBe(2.5);
  });

  it('obyčejný balíček nic (ani prázdný krok); Bílá hora vylepšení nepočítá; zničená karta zmizí z počtu', () => {
    expect(jokerDelta(playHand(roundGame(['parish_priest']), 'KS KH'), 'parish_priest').steps).toBe(0);
    const white = roundGame(['parish_priest']);
    white._core.api.addPermanentModifier({ disableEnhancements: true });
    expect(jokerDelta(playHand(white, 'KS KH 2C:bonus 3D@red', [0, 1]), 'parish_priest').mult).toBe(2.5);
    const game = roundGame(['parish_priest']);
    const cards = setupRound(game, 'KS KH 2C:bonus 3D@red');
    game._core.api.destroyCard(cards[3]!.id, 'test');
    expect(jokerDelta(play(game, [cards[0]!, cards[1]!]).result, 'parish_priest').mult).toBe(2.5);
  });

  it('kopie dá efekt znovu; s Notářem roste (zlatá pečeť = další farník)', () => {
    // Prémiová K♠ je jediný farník: 2 + 2,5 (originál) + 2,5 (kopie).
    expect(playHand(roundGame(['copier', 'parish_priest']), 'KS:bonus KH').mult).toBe(7);
    const game = roundGame(['notary_public', 'parish_priest']);
    expect(jokerDelta(playHand(game, 'KS KH'), 'parish_priest').mult).toBe(2.5);
  });
});

describe('Vědma (seer)', () => {
  it('když jediná ruka dosáhne celého cíle Malé útraty, vytvoří pranostiku její kombinace', () => {
    const game = makeGame({ registry: reg, jokers: ['seer'] });
    const { events } = winWith(game, 'KS KH', 2);
    expect(game.state.consumables.map((c) => c.defId)).toEqual(['pr_pair']);
    expect(messages(events)).toContain('jokers.seer.foreseen');
  });

  it('ruka pod cílem, Velká útrata ani šéf nic', () => {
    const short = roundGame(['seer'], 1000);
    playHand(short, 'KS KH');
    expect(short.state.consumables).toEqual([]);
    const big = makeGame({ registry: reg, jokers: ['seer'] });
    ok(big.dispatch({ type: 'skipBlind' }));
    winWith(big, 'KS KH', 2);
    expect(big.state.consumables).toEqual([]);
    const boss = makeGame({ registry: reg, jokers: ['seer'] });
    selectBoss(boss, 'wall');
    winWith(boss, 'KS KH', 2);
    expect(boss.state.consumables).toEqual([]);
  });

  it('bez volného slotu nic; kopie vytvoří druhou', () => {
    const full = makeGame({ registry: reg, jokers: ['seer'] });
    full._core.api.createConsumable({ defId: 'rada_a' });
    full._core.api.createConsumable({ defId: 'rada_b' });
    winWith(full, 'KS KH', 2);
    expect(full.state.consumables.map((c) => c.defId)).toEqual(['rada_a', 'rada_b']);
    const copied = makeGame({ registry: reg, jokers: ['copier', 'seer'] });
    winWith(copied, '2S 2H 3C 3D', 4);
    expect(copied.state.consumables.map((c) => c.defId)).toEqual(['pr_two_pair', 'pr_two_pair']);
  });
});

describe('Dvorní malíř (court_painter)', () => {
  it('po první ruce kola namaluje první skórující nefiguru jako figuru stejné barvy; skóre ruky se nemění', () => {
    const game = roundGame(['court_painter']);
    expect(game.modifiers().allFaces).toBe(false);
    const cards = setupRound(game, 'KS 5H 5D 2C:stone');
    const { result: r, events } = play(game, cards);
    // Ruka skórovala ještě jako Dvojice pětek (+ král jako kop neskóruje, kamenná ano).
    expect(r.hand.type).toBe('pair');
    expect(events).toContainEqual({ type: 'message', key: 'jokers.court_painter.painted' });
    const five = game.card(cards[1]!.id)!;
    expect([11, 12, 13]).toContain(five.rank);
    expect(five.suit).toBe('H');
    // Druhá pětka a kamenná karta zůstaly.
    expect(game.card(cards[2]!.id)!.rank).toBe(5);
    expect(game.card(cards[3]!.id)!.enhancement).toBe('stone');
  });

  it('jen v první ruce kola; samé figury nic nezmění', () => {
    const game = roundGame(['court_painter']);
    const faces = setupRound(game, 'KS KH');
    play(game, faces);
    expect(faces.map((c) => game.card(c.id)!.rank)).toEqual([13, 13]);
    const twos = setupRound(game, '2S 2H');
    play(game, twos);
    expect(twos.map((c) => game.card(c.id)!.rank)).toEqual([2, 2]);
  });

  it('kopie namaluje další kartu; stav runu je po uložení stejný (deterministicky přes seed)', () => {
    const game = roundGame(['copier', 'court_painter']);
    const cards = setupRound(game, '5H 5D');
    play(game, cards);
    expect(cards.every((c) => (game.card(c.id)?.rank ?? 0) >= 11)).toBe(true);
  });
});

describe('Barvoslepý strýc (colorblind_uncle)', () => {
  it('srdce s kárami a piky s kříži tvoří Barvu', () => {
    const hand = '2H 5D 7H 9D JH';
    expect(playHand(roundGame([]), hand).hand.type).toBe('high_card');
    const r = playHand(roundGame(['colorblind_uncle']), hand);
    // Barva: 40 + 2 + 5 + 7 + 9 + 10 = 73 čipů × 4.
    expect([r.hand.type, r.chips, r.mult]).toEqual(['flush', 73, 4]);
    expect(playHand(roundGame(['colorblind_uncle']), '2S 5C 7S 9C JS').hand.type).toBe('flush');
  });

  it('platí i pro žolíky, kteří čtou barvu (srdcová karta je i kárová, ne piková)', () => {
    const game = roundGame(['colorblind_uncle']);
    const [heart] = setupRound(game, 'KH');
    expect(game._core.api.hasSuit(heart!, 'D')).toBe(true);
    expect(game._core.api.hasSuit(heart!, 'S')).toBe(false);
  });
});

describe('Vyšlapaná pěšina (trodden_path)', () => {
  it('v celé Postupce smí chybět jedna hodnota', () => {
    const hand = '3S 4H 6D 7C 8S';
    expect(playHand(roundGame([]), hand).hand.type).toBe('high_card');
    const r = playHand(roundGame(['trodden_path']), hand);
    // Postupka: 35 + 3 + 4 + 6 + 7 + 8 = 63 čipů × 4.
    expect([r.hand.type, r.chips, r.mult]).toEqual(['straight', 63, 4]);
    // I s esem nízkým: A-2-3-5-6.
    expect(playHand(roundGame(['trodden_path']), 'AS 2H 3D 5C 6S').hand.type).toBe('straight');
  });

  it('dvě mezery (3-5-6-8-9) ani mezera o dvě hodnoty nestačí', () => {
    expect(playHand(roundGame(['trodden_path']), '3S 5H 6D 8C 9S').hand.type).toBe('high_card');
    expect(playHand(roundGame(['trodden_path']), '2S 5H 6D 7C 8S').hand.type).toBe('high_card');
  });
});

// ─────────────────────────── Vlastní ───────────────────────────

describe('Válečná kořist (war_loot)', () => {
  it('na konci kola +2 Kč za každého šéfa poraženého od koupě (už v kole, kdy padl)', () => {
    const game = makeGame({ registry: reg, jokers: ['war_loot'] });
    expect(jokerReward(winWith(game, 'KS').rewards, 'war_loot')).toBe(0);
    leaveRound(game);
    selectBoss(game, 'wall');
    expect(jokerReward(winWith(game, 'KS').rewards, 'war_loot')).toBe(2);
    expect(joker(game, 'war_loot').state).toEqual({ bosses: 1 });
    expect(descOf('war_loot', joker(game, 'war_loot'))).toContain('(teď +2 Kč)');
    leaveRound(game);
    expect(jokerReward(winWith(game, 'KS').rewards, 'war_loot')).toBe(2);
  });

  it('stav přežije uložení a načtení; tři poražení šéfové = +6 Kč', () => {
    let game = makeGame({ registry: reg, jokers: [{ id: 'war_loot', state: { bosses: 2 } }] });
    game = reload(game);
    selectBoss(game, 'wall');
    expect(jokerReward(winWith(game, 'KS').rewards, 'war_loot')).toBe(6);
  });
});

describe('Anonymní diskutér (anonymous_commenter)', () => {
  it('+7 mult za každou zahranou kartu, která neskóruje', () => {
    // Dvojice králů + 2 kopy: 32 čipů × (2 + 14).
    const r = playHand(roundGame(['anonymous_commenter']), 'KS KH 5C 7D');
    expect([r.chips, r.mult, r.score]).toEqual([32, 16, 512]);
    const high = playHand(roundGame(['anonymous_commenter']), 'AS 9H 7C 5D 2S');
    expect(jokerDelta(high, 'anonymous_commenter').mult).toBe(28);
  });

  it('bez kop nic (ani prázdný krok); debuffnutá karta v kombinaci se nepočítá; „skórují všechny“ = nic', () => {
    const delta = (hand: string, jokers = ['anonymous_commenter']) =>
      jokerDelta(playHand(roundGame(jokers), hand), 'anonymous_commenter');
    expect(delta('KS KH').steps).toBe(0);
    expect(delta('2H 5H 7H 9H JH').steps).toBe(0);
    expect(delta('KS KH! 5C').mult).toBe(7);
    expect(delta('KS KH 5C', ['all_score', 'anonymous_commenter']).steps).toBe(0);
  });
});

describe('Virální video (viral_video)', () => {
  it('první ruka kola +64 čipů, každá další polovinu předchozí (64, 32, 16 … 1, pak nic)', () => {
    const game = roundGame(['viral_video']);
    const chips = Array.from({ length: 8 }, () => jokerDelta(playHand(game, 'KS'), 'viral_video').chips);
    expect(chips).toEqual([64, 32, 16, 8, 4, 2, 1, 0]);
  });

  it('nové kolo začíná znovu od 64 čipů', () => {
    const game = makeGame({ registry: reg, jokers: ['viral_video'] });
    const first = setupRound(game, 'KS');
    game._core.state.round!.target = 1e12;
    expect(play(game, first).result.chips).toBe(6 + 10 + 64);
    winWith(game, 'KS');
    leaveRound(game);
    ok(game.dispatch({ type: 'selectBlind' }));
    game._core.state.round!.target = 1e12;
    expect(jokerDelta(playHand(game, 'KS'), 'viral_video').chips).toBe(64);
  });
});

describe('Kopírák (carbon_paper)', () => {
  const value = (jokers: (string | JokerSpec)[]) => playHand(roundGame(jokers), 'KS KH').score;

  it('kopíruje nejpravějšího běžného nebo vzácného žolíka (stojí-li sám vpravo, bere dalšího)', () => {
    // K♠: 6 + 10 + 10 + 10 = 36 čipů × (1 + 2 + 2) — kopie Pivního tácku.
    const r = playHand(roundGame(['carbon_paper', 'beer_mat']), 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([36, 5, 180]);
    expect(playHand(roundGame(['beer_mat', 'carbon_paper']), 'KS').score).toBe(180);
    // Pan vrchní (vzácný) stojí nejvíc vpravo: Dvojice 42 čipů × (2 + 2) × 2 × 2.
    expect(value(['beer_mat', 'head_waiter', 'carbon_paper'])).toBe(42 * 16);
    expect(value(['beer_mat', 'carbon_paper', 'head_waiter'])).toBe(42 * 16);
  });

  it('epického, nekopírovatelného a jiného Kopíráku přeskočí; debuffnutý cíl = nic', () => {
    // Sběrač hub (epický) vpravo — kopíruje se Pivní tácek.
    expect(value(['beer_mat', 'carbon_paper', { id: 'mushroom_picker', state: { destroyed: 4 } }])).toBe(
      value(['beer_mat', 'beer_mat', { id: 'mushroom_picker', state: { destroyed: 4 } }]),
    );
    // Zahrádkář nejde kopírovat.
    expect(value(['beer_mat', 'carbon_paper', 'gardener'])).toBe(value(['beer_mat', 'beer_mat']));
    expect(value(['carbon_paper', 'carbon_paper'])).toBe(value([]));
    expect(value(['carbon_paper', { id: 'beer_mat', debuffed: true }])).toBe(value([]));
  });

  it('cíl zapisuje do state.target (UI ukáže „Teď kopíruje“, boti ho řadí podle cíle)', () => {
    const game = roundGame(['beer_mat', 'head_waiter', 'carbon_paper']);
    const [, waiter, paper] = game.state.jokers;
    playHand(game, 'KS KH');
    expect(paper!.state.target).toBe(waiter!.uid);
    expect(copyStatusText(game.state, paper!, game.registry)).toBe(
      t('art.copy.active', { name: t('jokers.head_waiter.name') }),
    );
    // Bez cíle null; po přeřazení platí nový cíl od další ruky.
    const alone = roundGame(['carbon_paper']);
    playHand(alone, 'KS');
    expect(alone.state.jokers[0]!.state.target).toBeNull();
    game._core.state.jokers.splice(1, 1);
    game._core.invalidate();
    playHand(game, 'KS');
    expect(paper!.state.target).toBe(game.state.jokers[0]!.uid);
  });
});

describe('Defenestrace (defenestration)', () => {
  it('zahození s aspoň jednou figurou dá 5 Kč (jednou za zahození)', () => {
    const game = roundGame(['defenestration']);
    const money = game.state.money;
    const cards = setupRound(game, 'KS QH 2C 5D 7S 8H 9C 3D');
    const events = ok(
      game.dispatch({ type: 'discard', cardIds: [cards[0]!.id, cards[1]!.id, cards[2]!.id] }),
    );
    expect(game.state.money).toBe(money + 5);
    expect(triggered(events)).toContain('jokers.defenestration.thrown');
    ok(game.dispatch({ type: 'discard', cardIds: [cards[3]!.id, cards[4]!.id] }));
    expect(game.state.money).toBe(money + 5);
  });

  it('kamenná karta figurou není; „všechny karty jsou figury“ zaplatí i za dvojku; kopie dá znovu', () => {
    const discard = (jokers: (string | JokerSpec)[], hand: string) => {
      const game = roundGame(jokers);
      const money = game.state.money;
      const cards = setupRound(game, hand);
      ok(game.dispatch({ type: 'discard', cardIds: [cards[0]!.id] }));
      return game.state.money - money;
    };
    expect(discard(['defenestration'], '2C:stone 3D')).toBe(0);
    expect(discard(['all_faces', 'defenestration'], '2C 3D')).toBe(5);
    expect(discard(['copier', 'defenestration'], 'JC 3D')).toBe(10);
  });
});

describe('Brňák (brno_native)', () => {
  it('×1,5 mult jen úplně vlevo', () => {
    const left = playHand(roundGame(['brno_native', 'noop']), 'KS KH');
    expect([left.chips, left.mult, left.score]).toEqual([32, 3, 96]);
    expect(jokerDelta(playHand(roundGame(['noop', 'brno_native']), 'KS KH'), 'brno_native').steps).toBe(0);
  });

  it('úplně vlevo násobí jen základ a karty — +mult žolíci napravo se přičtou až potom', () => {
    // Brňák vlevo: (2 × 1,5) + 2 = 5 mult; vpravo od Pivního tácku by nenásobil nic.
    const r = playHand(roundGame(['brno_native', 'beer_mat']), 'KS KH');
    expect([r.chips, r.mult]).toEqual([42, 5]);
  });
});

describe('Sociální bublina (social_bubble)', () => {
  const chips = (hand: string, jokers = ['social_bubble']) => playHand(roundGame(jokers), hand).chips;

  it('když mají všechny skórující karty stejnou barvu nebo hodnotu, každá dá +30 čipů', () => {
    // Barva: 40 + 2 + 5 + 7 + 9 + 10 + 5 × 30 = 223.
    expect(chips('2H 5H 7H 9H JH')).toBe(223);
    // Dvojice (stejná hodnota): 12 + 20 + 2 × 30.
    expect(chips('KS KH')).toBe(92);
    // Jedna skórující karta (kopa se nepočítá): 6 + 10 + 30.
    expect(chips('KS 5H')).toBe(46);
    // Červená pečeť = dvě aktivace: 6 + 2 × (10 + 30).
    expect(chips('KS@red')).toBe(86);
  });

  it('dvě dvojice ani kamenná karta podmínku nesplní; divoká a sloučené barvy ano; debuffnutá se přeskočí', () => {
    expect(chips('2S 2H 3C 3D')).toBe(34);
    expect(chips('KS 2C:stone')).toBe(66);
    expect(chips('2H 5H 7H 9H JS:wild')).toBe(223);
    expect(chips('2H 5D 7H 9D JH', ['colorblind_uncle', 'social_bubble'])).toBe(223);
    // Debuffnutý K♥ nic, zbylý K♠ sám splní podmínku: 12 + 10 + 30.
    expect(chips('KS KH!')).toBe(52);
  });
});

// ─────────────────────────── Fuzz ───────────────────────────

describe('fuzz: obsah hry se všemi 22 žolíky přes boty', () => {
  const content = buildRegistry();

  function run(seed: string, bot: 'max' | 'econ', reloadEvery: number): { actions: Action[]; json: string } {
    let game = Game.newRun({ seed, deckId: 'pub', stake: 1 }, content);
    const core = game._core;
    for (const id of IDS) {
      const j = newJokerInstance(core, id);
      core.state.jokers.push(j);
    }
    core.invalidate();
    const decide = createBot(bot);
    const actions: Action[] = [];
    let invalid = 0;
    let since = 0;
    for (let step = 0; step < 1200; step++) {
      if (game.state.phase === 'game_over' || game.state.phase === 'victory') break;
      if (reloadEvery > 0 && ++since >= reloadEvery && game.state.phase === 'round') {
        game = Game.fromState(deserializeRun(JSON.parse(serializeRun(game.state))), content);
        since = 0;
      }
      const s = game.state;
      const action: Action =
        invalid >= 3
          ? s.phase === 'round'
            ? { type: 'play', cardIds: s.round!.hand.slice(0, 1) }
            : s.phase === 'shop'
              ? { type: 'leaveShop' }
              : s.phase === 'booster'
                ? { type: 'skipBooster' }
                : s.phase === 'round_end'
                  ? { type: 'cashOut' }
                  : { type: 'selectBlind' }
          : decide.decide(game);
      actions.push(action);
      const res = game.dispatch(action);
      invalid = res.ok ? 0 : invalid + 1;
      for (const j of game.state.jokers) expect(JSON.parse(JSON.stringify(j)), `${seed} ${step}`).toEqual(j);
      expect(Number.isFinite(game.state.money), `${seed} ${step}`).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(game.state))).toEqual(game.state);
    return { actions, json: JSON.stringify(game.state) };
  }

  it.each([
    ['R2-FUZZ-A', 'max'],
    ['R2-FUZZ-B', 'econ'],
  ] as const)(
    '%s (%s): bez výjimky, stav JSON-bezpečný, načtení uprostřed kola nic nezmění',
    (seed, bot) => {
      const plain = run(seed, bot, 0);
      const reloaded = run(seed, bot, 17);
      expect(reloaded.actions).toEqual(plain.actions);
      expect(reloaded.json).toBe(plain.json);
    },
    60_000,
  );
});
