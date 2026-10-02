/**
 * Běžní žolíci fáze 7 (docs/DESIGN.md 4.9, src/content/jokers/common2.ts): přesná čísla mechanik přes skutečné
 * skórování, hraniční podmínky, peníze v rozpisu odměn, stav přes víc rukou a kol, kopie (`isCopy`), uložení a načtení,
 * texty, `ArtSpec` a fuzz přes boty s obsahem hry.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import { COMMON_JOKERS } from '../../src/content/jokers/common';
import { COMMON2_JOKERS } from '../../src/content/jokers/common2';
import { EPIC_JOKERS } from '../../src/content/jokers/epic';
import { RARE_JOKERS } from '../../src/content/jokers/rare';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { createBot } from '../../src/engine/sim/index';
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

/** Testovací žolík „všechny karty jsou figury“ (jako Dvorní malíř). */
const ALL_FACES = testJoker('all_faces', { hooks: { passive: () => ({ allFaces: true }) } });

/** Testovací registr (kombinace, úpravy karet, testovací šéfové, spotřebky a žolíci) + běžní žolíci fáze 7. */
const reg: ContentRegistry = makeRegistry({ jokers: [...COMMON2_JOKERS, ALL_FACES] });

function def(id: string): JokerDef {
  const d = COMMON2_JOKERS.find((j) => j.id === id);
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

/** Zlaté karty v ruce v rozpisu odměn. */
const heldReward = (rewards: RoundRewards | null | undefined): number =>
  (rewards?.extra ?? []).filter((e) => e.source === 'held').reduce((a, e) => a + e.amount, 0);

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

/** Dohraje kolo výhrou jednou kartou, vyplatí a odejde z Večerky. Vrátí rozpis odměn a události výplaty. */
function finishRound(game: Game): { rewards: RoundRewards; shopEvents: GameEvent[] } {
  if (game.state.phase === 'blind_select') ok(game.dispatch({ type: 'selectBlind' }));
  winNextHand(game);
  play(game, [game.state.round!.hand[0]!]);
  expect(game.state.phase).toBe('round_end');
  const rewards = structuredClone(game.state.rewards!);
  const shopEvents = ok(game.dispatch({ type: 'cashOut' }));
  ok(game.dispatch({ type: 'leaveShop' }));
  return { rewards, shopEvents };
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

// Základy kombinací na úrovni 1 (DESIGN 2.2.1): Vysoká karta 6 × 1, Dvojice 12 × 2, Dvě dvojice 24 × 2,
// Postupka 35 × 4, Barva 40 × 4. Čipy karet: 2–10 = číslo, J/Q/K = 10, A = 11, kamenná 0 (+50 vylepšením).

// ─────────────────────────── Definice ───────────────────────────

const IDS = [
  'helpline_aunt',
  'weekend_cottager',
  'shooting_gallery',
  'tobacconist',
  'ticket_inspector',
  'doorman',
  'goldsmith',
  'paver',
  'postman',
  'grocer',
  'grill_dad',
  'teacher',
  'hejkal',
  'tram_driver',
  'punter',
  'pavlac_gossip',
  'round_for_everyone',
  'pickled_cheese',
  'thirteenth_salary',
  'temp_worker',
  'fisherman',
  'garbage_man',
  'jukebox',
  'tool_shed',
  'replacement_bus',
  'pig_slaughter',
  'derby_fans',
  'pub_quiz',
  'scrap_yard',
];

describe('běžní žolíci fáze 7 – definice', () => {
  it('29 žolíků (15 ze zásobníku DESIGN 4.9 + 14 vlastních), všichni běžní za 4–5 Kč, štítky vyplněné', () => {
    expect(COMMON2_JOKERS.map((j) => j.id)).toEqual(IDS);
    for (const j of COMMON2_JOKERS) {
      expect(j.rarity, j.id).toBe('common');
      expect([4, 5], j.id).toContain(j.cost);
      expect(j.tags.length, j.id).toBeGreaterThan(0);
      expect(j.id, j.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('id jsou unikátní mezi všemi žolíky a žolíci jsou ve skutečném registru obsahu', () => {
    const ids = JOKERS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    const full = buildRegistry();
    for (const j of COMMON2_JOKERS) expect(full.jokers[j.id]).toBe(j);
  });

  it('čísla mechanik v params', () => {
    expect(Object.fromEntries(COMMON2_JOKERS.map((j) => [j.id, j.params ?? {}]))).toEqual({
      helpline_aunt: { chance: 1, odds: 2 },
      weekend_cottager: { mult: 3 },
      shooting_gallery: { mult: 3 },
      tobacconist: { chance: 1, odds: 2 },
      ticket_inspector: { chips: 50 },
      doorman: { mult: 4 },
      goldsmith: {},
      paver: { mult: 5 },
      postman: { money: 3 },
      grocer: { mult: 2 },
      grill_dad: { chips: 60, discards: 1 },
      teacher: { mult: 15 },
      hejkal: { chance: 1, odds: 3, mult: 15 },
      tram_driver: { mult: 15 },
      punter: { chance: 1, odds: 3, money: 7 },
      pavlac_gossip: { xmult: 1.5 },
      round_for_everyone: { xmult: 1.4, cards: 5 },
      pickled_cheese: { chips: 6 },
      thirteenth_salary: { money: 8 },
      temp_worker: { money: 2 },
      fisherman: { chance: 1, odds: 2 },
      garbage_man: { chips: 1, rank: 5 },
      jukebox: { retriggers: 1 },
      tool_shed: { slots: 1 },
      replacement_bus: { max: 2, cards: 1 },
      pig_slaughter: { money: 2 },
      derby_fans: { mult: 8 },
      pub_quiz: { chips: 10 },
      scrap_yard: { mult: 3, max: 21 },
    });
  });

  it('nálepky a kopírování podle DESIGN 4.4: efekt jen ve Večerce, ekonomika z rozpisu a čisté pravidlo nejdou kopírovat', () => {
    const flagged = (pred: (j: JokerDef) => boolean) => COMMON2_JOKERS.filter(pred).map((j) => j.id);
    expect(flagged((j) => j.copyable === false)).toEqual([
      'tobacconist',
      'postman',
      'punter',
      'thirteenth_salary',
      'temp_worker',
      'tool_shed',
      'pig_slaughter',
    ]);
    expect(flagged((j) => j.noRental === true)).toEqual([
      'postman',
      'punter',
      'thirteenth_salary',
      'temp_worker',
      'pig_slaughter',
    ]);
    // Rostou časem ve slotu (jako Stálý host) — zvětrávání by šlo proti smyslu.
    expect(flagged((j) => j.noPerishable === true)).toEqual(['garbage_man', 'scrap_yard']);
    expect(flagged((j) => j.noEternal === true)).toEqual([]);
    // Stav mají jen škálující žolíci a Drbna.
    expect(flagged((j) => j.initState !== undefined)).toEqual(['pavlac_gossip', 'garbage_man', 'scrap_yard']);
  });

  it('ArtSpec: ikony z ICON_NAMES, hlavní ikona jiná než u ostatních běžných a fáze 4, dvojice ikona + rekvizita unikátní mezi všemi žolíky', () => {
    for (const j of COMMON2_JOKERS) {
      const { icon, prop, bg, fg, accent, pattern } = j.art;
      expect(isIconName(icon), `${j.id}: ${icon}`).toBe(true);
      expect(prop !== undefined && isIconName(prop), `${j.id}: ${prop}`).toBe(true);
      for (const c of [bg, fg, accent]) expect(c, j.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(pattern, j.id).toBeDefined();
    }
    const phase4 = [...COMMON_JOKERS, ...RARE_JOKERS, ...EPIC_JOKERS];
    const mains = [...phase4, ...COMMON2_JOKERS].map((j) => j.art.icon);
    expect(new Set(mains).size).toBe(mains.length);
    const pairs = JOKERS.map((j) => `${j.art.icon}+${j.art.prop}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const bgs = [...COMMON_JOKERS, ...COMMON2_JOKERS].map((j) => j.art.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });
});

// ─────────────────────────── Texty ───────────────────────────

describe('běžní žolíci fáze 7 – texty', () => {
  it('každý má název (max. 3 slova), popis a flavor bez uvozovek', () => {
    for (const j of COMMON2_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${j.id}.${field}`), `${j.id}.${field}`).toBe(true);
      expect(t(`jokers.${j.id}.name`).split(/\s+/).length, j.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${j.id}.flavor`), j.id).not.toMatch(/["„“‚‘]/);
    }
  });

  it('každý {param} popisku je v params nebo describe(self) a po dosazení nic nezbyde', () => {
    const game = makeGame({ registry: reg });
    for (const j of COMMON2_JOKERS) {
      const key = `jokers.${j.id}.desc`;
      const self = newJokerInstance(game._core, j.id);
      const params = { ...(j.params ?? {}), ...(j.describe?.(self) ?? {}) };
      for (const m of t(key).matchAll(/\{(\w+)/g)) expect(params, `${key}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(key, params), key).not.toMatch(/[{}⟦]/);
    }
  });

  it('všech 29 popisků přesně (čísla z params, česky formátovaná, správné tvary slov)', () => {
    const game = makeGame({ registry: reg });
    const rendered = Object.fromEntries(
      COMMON2_JOKERS.map((j) => [j.id, descOf(j.id, newJokerInstance(game._core, j.id))]),
    );
    expect(rendered).toEqual({
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
    });
  });

  it('šablony popisků nemají čísla natvrdo (jen {param})', () => {
    for (const j of COMMON2_JOKERS) {
      const template = t(`jokers.${j.id}.desc`).replace(/\{[^}]*\}/g, '');
      expect(template, j.id).not.toMatch(/\d/);
    }
  });

  it('hlášky žolíků existují a dynamický popisek skloňuje', () => {
    for (const key of [
      'jokers.helpline_aunt.advice',
      'jokers.tobacconist.forecast',
      'jokers.goldsmith.gilded',
      'jokers.paver.paved',
      'jokers.postman.delivered',
      'jokers.fisherman.catch',
      'jokers.pig_slaughter.feast',
    ])
      expect(hasKey(key), key).toBe(true);
    expect(t('jokers.postman.delivered', { money: 3 }).replaceAll(NBSP, ' ')).toBe('Doručeno: +3 Kč.');
    const game = makeGame({ registry: reg, jokers: ['garbage_man'] });
    const self = joker(game, 'garbage_man');
    self.state.chips = 1;
    expect(descOf('garbage_man', self)).toContain('(teď +1 čip)');
    self.state.chips = 3;
    expect(descOf('garbage_man', self)).toContain('(teď +3 čipy)');
  });
});

// ─────────────────────────── Ze zásobníku DESIGN 4.9 ───────────────────────────

describe('Teta z poradny (helpline_aunt)', () => {
  function useRada(game: Game, defId = 'rada_a'): GameEvent[] {
    const c = game._core.api.createConsumable({ defId, ignoreSlots: true })!;
    return ok(game.dispatch({ type: 'useConsumable', uid: c.uid }));
  }

  it('po babské radě 1 z 2 vznikne nová babská rada do uvolněného slotu', () => {
    const game = roundGame(['helpline_aunt']);
    setChance(game, true);
    const events = useRada(game);
    expect(game.state.consumables).toHaveLength(1);
    expect(game._core.api.consumableKind(game.state.consumables[0]!.defId)).toBe('rada');
    expect(messages(events)).toContain('jokers.helpline_aunt.advice');
  });

  it('bez štěstí nic; pranostika ani razítko radu nevytvoří', () => {
    const unlucky = roundGame(['helpline_aunt']);
    setChance(unlucky, false);
    useRada(unlucky);
    expect(unlucky.state.consumables).toEqual([]);
    const other = roundGame(['helpline_aunt']);
    setChance(other, true);
    useRada(other, 'pr_pair');
    useRada(other, 'stamp');
    expect(other.state.consumables).toEqual([]);
  });

  it('bez volného slotu nevznikne nic; kopie zkusí štěstí znovu (dvě rady)', () => {
    const full = roundGame(['helpline_aunt']);
    setChance(full, true);
    for (let i = 0; i < 3; i++) full._core.api.createConsumable({ defId: 'rada_b', ignoreSlots: true });
    useRada(full, 'rada_b');
    // Po použití zbyly 3 rady na 2 slotech — nová se nevejde.
    expect(full.state.consumables).toHaveLength(3);
    const copied = roundGame(['copier', 'helpline_aunt']);
    setChance(copied, true);
    useRada(copied);
    expect(copied.state.consumables).toHaveLength(2);
  });
});

describe('Chatař (weekend_cottager)', () => {
  it('+3 mult za každý prázdný slot spotřebky', () => {
    // Vysoká karta: 6 + 10 = 16 čipů; 2 prázdné sloty → 1 + 6 mult.
    const r = playHand(roundGame(['weekend_cottager']), 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([16, 7, 112]);
    const one = roundGame(['weekend_cottager']);
    one._core.api.createConsumable({ defId: 'rada_a' });
    expect(playHand(one, 'KS').mult).toBe(4);
  });

  it('plné sloty nic nedají (ani prázdný krok); slot navíc (Kůlna) +3 mult', () => {
    const full = roundGame(['weekend_cottager']);
    full._core.api.createConsumable({ defId: 'rada_a' });
    full._core.api.createConsumable({ defId: 'rada_b' });
    const r = playHand(full, 'KS');
    expect(r.mult).toBe(1);
    expect(jokerDelta(r, 'weekend_cottager').steps).toBe(0);
    expect(playHand(roundGame(['tool_shed', 'weekend_cottager']), 'KS').mult).toBe(1 + 9);
  });
});

describe('Střelec z pouti (shooting_gallery)', () => {
  it('každá skórující desítka nebo figura +3 mult', () => {
    // Dvojice desítek: 12 + 10 + 10 = 32 čipů, 2 + 3 + 3 = 8 mult.
    const r = playHand(roundGame(['shooting_gallery']), '10S 10H');
    expect([r.chips, r.mult, r.score]).toEqual([32, 8, 256]);
    expect(
      jokerDelta(playHand(roundGame(['shooting_gallery']), 'JS JH QD QC'), 'shooting_gallery').mult,
    ).toBe(12);
  });

  it('eso, nižší karty, kamenná, debuffnutá ani neskórující figura nic; „všechny figury“ ano', () => {
    const delta = (hand: string, jokers = ['shooting_gallery']) =>
      jokerDelta(playHand(roundGame(jokers), hand), 'shooting_gallery').mult;
    expect(delta('AS AH')).toBe(0);
    expect(delta('9S 9H')).toBe(0);
    expect(delta('9S 9H 2C:stone')).toBe(0);
    expect(delta('KS! KH')).toBe(3);
    expect(delta('9S 9H KD')).toBe(0); // K je kopa
    expect(delta('9S 9H', ['all_faces', 'shooting_gallery'])).toBe(6);
  });
});

describe('Trafikant (tobacconist)', () => {
  it('při vstupu do Večerky 1 z 2 přidá náhodnou pranostiku (tajné kombinace jen po objevení)', () => {
    for (let i = 0; i < 6; i++) {
      const game = makeGame({ registry: reg, jokers: ['tobacconist'], seed: `TOBACCO-${i}` });
      setChance(game, true);
      winWith(game, 'KS');
      const events = ok(game.dispatch({ type: 'cashOut' }));
      expect(game.state.phase).toBe('shop');
      expect(game.state.consumables).toHaveLength(1);
      const id = game.state.consumables[0]!.defId;
      expect(game._core.api.consumableKind(id)).toBe('pranostika');
      expect(['pr_five', 'pr_flush_house', 'pr_flush_five']).not.toContain(id);
      expect(messages(events)).toContain('jokers.tobacconist.forecast');
    }
  });

  it('bez štěstí ani s plnými sloty nic', () => {
    const unlucky = makeGame({ registry: reg, jokers: ['tobacconist'] });
    setChance(unlucky, false);
    winWith(unlucky, 'KS');
    ok(unlucky.dispatch({ type: 'cashOut' }));
    expect(unlucky.state.consumables).toEqual([]);
    const full = makeGame({ registry: reg, jokers: ['tobacconist'] });
    setChance(full, true);
    full._core.api.createConsumable({ defId: 'rada_a' });
    full._core.api.createConsumable({ defId: 'rada_b' });
    winWith(full, 'KS');
    ok(full.dispatch({ type: 'cashOut' }));
    expect(full.state.consumables.map((c) => c.defId)).toEqual(['rada_a', 'rada_b']);
  });
});

describe('Revizor (ticket_inspector)', () => {
  it('+50 čipů bez figury mezi zahranými kartami', () => {
    // Dvojice devítek: 12 + 9 + 9 = 30 → 80 čipů × 2.
    const r = playHand(roundGame(['ticket_inspector']), '9S 9H');
    expect([r.chips, r.mult, r.score]).toEqual([80, 2, 160]);
    // Eso není figura, kamenná karta taky ne.
    expect(
      jokerDelta(playHand(roundGame(['ticket_inspector']), 'AS AH 2C:stone'), 'ticket_inspector').chips,
    ).toBe(50);
  });

  it('figura kdekoli mezi zahranými (i neskórující kopa) bonus ruší; „všechny figury“ taky', () => {
    expect(jokerDelta(playHand(roundGame(['ticket_inspector']), '9S 9H KD'), 'ticket_inspector').chips).toBe(
      0,
    );
    expect(jokerDelta(playHand(roundGame(['ticket_inspector']), 'QS'), 'ticket_inspector').chips).toBe(0);
    expect(
      jokerDelta(playHand(roundGame(['all_faces', 'ticket_inspector']), '9S 9H'), 'ticket_inspector').chips,
    ).toBe(0);
  });
});

describe('Vrátný (doorman)', () => {
  it('každá figura držená v ruce +4 mult', () => {
    // Dvojice dvojek 12 + 2 + 2 = 16 čipů; v ruce K a Q → 2 + 8 mult.
    const r = playHand(roundGame(['doorman']), '2S 2H KD QC 5S', [0, 1]);
    expect([r.chips, r.mult, r.score]).toEqual([16, 10, 160]);
  });

  it('debuffnutá figura v ruce nic; červená pečeť ji zopakuje; zahraná figura se nepočítá', () => {
    expect(playHand(roundGame(['doorman']), '2S 2H KD! QC', [0, 1]).mult).toBe(2 + 4);
    expect(playHand(roundGame(['doorman']), '2S 2H KD@red QC', [0, 1]).mult).toBe(2 + 12);
    expect(playHand(roundGame(['doorman']), 'KS KH 5C', [0, 1]).mult).toBe(2);
  });
});

describe('Zlatník (goldsmith)', () => {
  it('na konci kola pozlatí náhodnou kartu bez vylepšení v ruce — zlatá vydělá už v tomto kole', () => {
    const game = makeGame({ registry: reg, jokers: ['goldsmith'] });
    const { rewards, events, cards } = winWith(game, 'KS 2H 3D 4C');
    const held = cards.slice(1).map((c) => game._core.card(c.id)!);
    expect(held.filter((c) => c.enhancement === 'gold')).toHaveLength(1);
    expect(heldReward(rewards)).toBe(3);
    expect(messages(events)).toContain('jokers.goldsmith.gilded');
    // Stejný seed → stejná karta (náhoda jen přes RNG streamy).
    const again = makeGame({ registry: reg, jokers: ['goldsmith'] });
    const second = winWith(again, 'KS 2H 3D 4C');
    expect(second.cards.map((c) => again._core.card(c.id)!.enhancement)).toEqual(
      cards.map((c) => game._core.card(c.id)!.enhancement),
    );
  });

  it('karty s vylepšením nechá být (bez obyčejné karty nic); kopie pozlatí další kartu', () => {
    const game = makeGame({ registry: reg, jokers: ['goldsmith'] });
    const { rewards, cards } = winWith(game, 'KS 2H:bonus 3D:steel');
    expect(cards.map((c) => game._core.card(c.id)!.enhancement)).toEqual([null, 'bonus', 'steel']);
    expect(heldReward(rewards)).toBe(0);
    const copied = makeGame({ registry: reg, jokers: ['copier', 'goldsmith'] });
    const two = winWith(copied, 'KS 2H 3D 4C');
    expect(two.cards.filter((c) => copied._core.card(c.id)!.enhancement === 'gold')).toHaveLength(2);
    expect(heldReward(two.rewards)).toBe(6);
  });
});

describe('Dlaždič (paver)', () => {
  it('každé zahození promění první zahozenou kartu bez vylepšení na kamennou', () => {
    const game = roundGame(['paver']);
    const [, h2, d3, c4, s5] = setupRound(game, 'KS 2H 3D 4C 5S');
    const events = ok(game.dispatch({ type: 'discard', cardIds: [h2!.id, d3!.id] }));
    expect(game._core.card(h2!.id)!.enhancement).toBe('stone');
    expect(game._core.card(d3!.id)!.enhancement).toBeNull();
    expect(messages(events)).toContain('jokers.paver.paved');
    ok(game.dispatch({ type: 'discard', cardIds: [s5!.id, c4!.id] }));
    expect(game._core.card(s5!.id)!.enhancement).toBe('stone');
    expect(game._core.card(c4!.id)!.enhancement).toBeNull();
  });

  it('karta s vylepšením se přeskočí; kopie promění další kartu téhož zahození', () => {
    const game = roundGame(['paver']);
    const [h2, d3] = setupRound(game, '2H:bonus 3D 4C');
    ok(game.dispatch({ type: 'discard', cardIds: [h2!.id, d3!.id] }));
    expect([game._core.card(h2!.id)!.enhancement, game._core.card(d3!.id)!.enhancement]).toEqual([
      'bonus',
      'stone',
    ]);
    const copied = roundGame(['copier', 'paver']);
    const [a, b, c] = setupRound(copied, '2H 3D 4C');
    ok(copied.dispatch({ type: 'discard', cardIds: [a!.id, b!.id, c!.id] }));
    expect([a, b, c].map((x) => copied._core.card(x!.id)!.enhancement)).toEqual(['stone', 'stone', null]);
  });

  it('každá skórující kamenná karta +5 mult (i opakovaná); pod vypnutými vylepšeními nic', () => {
    // Dvojice + kamenná: 12 + 10 + 10 + 50 = 82 čipů, 2 + 5 mult.
    const r = playHand(roundGame(['paver']), 'KS KH 2C:stone');
    expect([r.chips, r.mult, r.score]).toEqual([82, 7, 574]);
    expect(jokerDelta(playHand(roundGame(['paver']), 'KS KH 2C:stone@red'), 'paver').mult).toBe(10);
    const off = roundGame(['all_score', 'paver']);
    off._core.api.addPermanentModifier({ disableEnhancements: true });
    expect(jokerDelta(playHand(off, 'KS KH 2C:stone'), 'paver').mult).toBe(0);
  });
});

describe('Pošťák (postman)', () => {
  it('za každou otevřenou obálku 3 Kč (koupenou i zdarma)', () => {
    const game = makeGame({ registry: reg, jokers: ['postman'] });
    winWith(game, 'KS');
    ok(game.dispatch({ type: 'cashOut' }));
    game._core.state.money = 20;
    const booster = game.state.shop!.boosters[0]!;
    const price = booster.price;
    const events = ok(game.dispatch({ type: 'buyBooster', slot: 0 }));
    expect(game.state.phase).toBe('booster');
    expect(game.state.money).toBe(20 - price + 3);
    expect(events).toContainEqual({ type: 'message', key: 'jokers.postman.delivered', params: { money: 3 } });
    ok(game.dispatch({ type: 'skipBooster' }));
    // Obálka zdarma (štítek): otevře se hned po další akci (přeřazení žolíků nic nestojí).
    const before = game.state.money;
    game._core.api.openBooster('rada_pack');
    ok(game.dispatch({ type: 'reorderJokers', uids: game.state.jokers.map((j) => j.uid) }));
    expect(game.state.phase).toBe('booster');
    expect(game.state.money).toBe(before + 3);
  });

  it('nejde kopírovat: kopírující žolík ve Večerce nic nepřidá', () => {
    expect(def('postman').copyable).toBe(false);
    const game = makeGame({ registry: reg, jokers: ['copier', 'postman'] });
    winWith(game, 'KS');
    ok(game.dispatch({ type: 'cashOut' }));
    game._core.state.money = 20;
    const price = game.state.shop!.boosters[0]!.price;
    ok(game.dispatch({ type: 'buyBooster', slot: 0 }));
    expect(game.state.money).toBe(20 - price + 3);
  });
});

describe('Hokynář (grocer)', () => {
  it('+2 mult za každého jiného běžného žolíka (vzácné ani sebe nepočítá)', () => {
    // Testovací `noop` je běžný, `rare_one` vzácný. Vysoká karta 16 × (1 + 4).
    const r = playHand(roundGame(['grocer', 'noop', 'noop', 'rare_one']), 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([16, 5, 80]);
    expect(jokerDelta(playHand(roundGame(['grocer']), 'KS'), 'grocer').steps).toBe(0);
    // Debuffnutý běžný žolík pořád sedí ve slotu.
    expect(playHand(roundGame(['grocer', { id: 'noop', debuffed: true }]), 'KS').mult).toBe(3);
  });

  it('jiní Hokynáři se nepočítají: dva Hokynáři = Hokynář a jeho kopie', () => {
    expect(playHand(roundGame(['grocer', 'grocer']), 'KS').mult).toBe(1);
    expect(playHand(roundGame(['grocer', 'grocer', 'noop']), 'KS').mult).toBe(1 + 2 + 2);
    // Testovací kopírující žolík je sám běžný: Hokynář i jeho kopie vidí `copier` a `noop`.
    expect(playHand(roundGame(['copier', 'grocer', 'noop']), 'KS').mult).toBe(1 + 4 + 4);
  });
});

describe('Táta u grilu (grill_dad)', () => {
  function afterDiscards(n: number): ScoreResult {
    const game = roundGame(['grill_dad']);
    for (let i = 0; i < n; i++) {
      const id = game.state.round!.hand[0]!;
      ok(game.dispatch({ type: 'discard', cardIds: [id] }));
    }
    return playHand(game, 'KS');
  }

  it('+60 čipů, když se v kole zahazovalo právě 1×', () => {
    const r = afterDiscards(1);
    expect([r.chips, r.mult, r.score]).toEqual([76, 1, 76]);
  });

  it('bez zahození nebo po dvou zahozeních nic', () => {
    expect(afterDiscards(0).chips).toBe(16);
    expect(afterDiscards(2).chips).toBe(16);
  });
});

describe('Učitelka (teacher)', () => {
  it('+15 mult, když mají všechny skórující karty sudou hodnotu', () => {
    // Dvojice dvojek: 16 čipů, 2 + 15 mult.
    const r = playHand(roundGame(['teacher']), '2S 2H');
    expect([r.chips, r.mult, r.score]).toEqual([16, 17, 272]);
    expect(jokerDelta(playHand(roundGame(['teacher']), '10S 10H 4C 4D'), 'teacher').mult).toBe(15);
    // Lichá kopa neskóruje, takže nevadí.
    expect(jokerDelta(playHand(roundGame(['teacher']), '8S 8H 7C'), 'teacher').mult).toBe(15);
  });

  it('lichá, figura, eso ani kamenná podmínku nesplní; debuffnutá skórující karta se nepočítá', () => {
    const delta = (hand: string) => jokerDelta(playHand(roundGame(['teacher']), hand), 'teacher').mult;
    expect(delta('3S 3H')).toBe(0);
    expect(delta('QS QH')).toBe(0);
    expect(delta('AS AH')).toBe(0);
    expect(delta('2S 2H 9C:stone')).toBe(0);
    expect(delta('2S 2H 3C! 3D!')).toBe(15);
  });
});

describe('Hejkal (hejkal)', () => {
  it('1 z 3: +15 mult', () => {
    const lucky = roundGame(['hejkal']);
    setChance(lucky, true);
    const r = playHand(lucky, 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([16, 16, 256]);
    const unlucky = roundGame(['hejkal']);
    setChance(unlucky, false);
    expect(jokerDelta(playHand(unlucky, 'KS'), 'hejkal').steps).toBe(0);
  });

  it('se základní šancí jednou ano, jindy ne — a stejný seed dá stejný průběh', () => {
    const series = (seed: string) => {
      const game = makeGame({ registry: reg, jokers: ['hejkal'], seed, round: true });
      game._core.state.round!.target = 1e12;
      game._core.state.round!.handsLeft = 30;
      return Array.from({ length: 30 }, () => playHand(game, 'KS').mult);
    };
    const a = series('HEJ');
    expect(new Set(a)).toEqual(new Set([1, 16]));
    expect(series('HEJ')).toEqual(a);
  });
});

describe('Tramvaják (tram_driver)', () => {
  it('+15 mult, když to není první ruka kola a už se zahazovalo', () => {
    const game = roundGame(['tram_driver']);
    ok(game.dispatch({ type: 'discard', cardIds: [game.state.round!.hand[0]!] }));
    expect(jokerDelta(playHand(game, 'KS'), 'tram_driver').steps).toBe(0); // první ruka
    const r = playHand(game, 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([16, 16, 256]);
  });

  it('bez zahození nic ani ve druhé ruce', () => {
    const game = roundGame(['tram_driver']);
    playHand(game, 'KS');
    expect(playHand(game, 'KS').mult).toBe(1);
  });
});

describe('Sázkař (punter)', () => {
  it('na konci kola 1 z 3: +7 Kč v rozpisu odměn', () => {
    const lucky = makeGame({ registry: reg, jokers: ['punter'] });
    setChance(lucky, true);
    expect(jokerReward(winWith(lucky, 'KS').rewards, 'punter')).toBe(7);
    const unlucky = makeGame({ registry: reg, jokers: ['punter'] });
    setChance(unlucky, false);
    expect(jokerReward(winWith(unlucky, 'KS').rewards, 'punter')).toBe(0);
  });

  it('se základní šancí přes víc kol jednou vyhraje a jindy ne', () => {
    const game = makeGame({ registry: reg, jokers: ['punter'], seed: 'PUNTER' });
    const paid = Array.from({ length: 12 }, () => jokerReward(finishRound(game).rewards, 'punter'));
    expect(new Set(paid)).toEqual(new Set([0, 7]));
  });
});

// ─────────────────────────── Vlastní ───────────────────────────

describe('Drbna z pavlače (pavlac_gossip)', () => {
  it('×1,5 mult, když je kombinace stejná jako v minulé ruce', () => {
    const game = roundGame(['pavlac_gossip']);
    expect(jokerDelta(playHand(game, 'KS KH'), 'pavlac_gossip').steps).toBe(0);
    const r = playHand(game, 'KS KH');
    expect([r.chips, r.mult, r.score]).toEqual([32, 3, 96]);
    expect(jokerDelta(playHand(game, 'KS KH 5C 5D'), 'pavlac_gossip').steps).toBe(0);
    expect(joker(game, 'pavlac_gossip').state.last).toBe('two_pair');
  });

  it('pamatuje si i ruku z minulého kola a přežije uložení a načtení', () => {
    let game = makeGame({ registry: reg, jokers: ['pavlac_gossip'] });
    finishRound(game); // vítězná ruka = Vysoká karta
    ok(game.dispatch({ type: 'selectBlind' }));
    game._core.state.round!.target = 1e12;
    game = reload(game);
    expect(joker(game, 'pavlac_gossip').state).toEqual({ last: 'high_card' });
    expect(playHand(game, 'KS').mult).toBe(1.5);
  });

  it('kopie čte stav, ale nezapisuje: stejný efekt jako druhá instance', () => {
    const game = roundGame(['copier', 'pavlac_gossip']);
    playHand(game, 'KS KH');
    expect(playHand(game, 'KS KH').mult).toBeCloseTo(2 * 1.5 * 1.5, 9);
    expect(joker(game, 'pavlac_gossip').state.last).toBe('pair');
  });
});

describe('Rundu všem (round_for_everyone)', () => {
  it('×1,4 mult, když zahraješ 5 karet a všechny skórují', () => {
    // Barva: 40 + 2 + 5 + 7 + 9 + 10 = 73 čipů × 4 × 1,4.
    const r = playHand(roundGame(['round_for_everyone']), '2H 5H 7H 9H JH');
    expect(r.chips).toBe(73);
    expect(r.mult).toBeCloseTo(5.6, 9);
    expect(r.score).toBe(Math.floor(73 * 4 * 1.4));
    expect(
      jokerDelta(playHand(roundGame(['round_for_everyone']), 'KS KH KD 5C 5D'), 'round_for_everyone').xmult,
    ).toBe(1.4);
  });

  it('kopa (neskórující karta) nebo méně než 5 karet nic; „všechny karty skórují“ ano', () => {
    const x = (hand: string, jokers = ['round_for_everyone']) =>
      jokerDelta(playHand(roundGame(jokers), hand), 'round_for_everyone').xmult;
    expect(x('KS KH 5C 5D 9S')).toBe(1);
    expect(x('KS KH 5C 5D')).toBe(1);
    expect(x('KS KH 5C 5D 9S', ['all_score', 'round_for_everyone'])).toBe(1.4);
  });
});

describe('Nakládaný hermelín (pickled_cheese)', () => {
  it('+6 čipů za každou kartu drženou v ruce', () => {
    // Vysoká karta 16 čipů + 7 karet v ruce × 6.
    const r = playHand(roundGame(['pickled_cheese']), 'KS 2H 3D 4C 5S 6S 7S 8S', [0]);
    expect([r.chips, r.mult, r.score]).toEqual([58, 1, 58]);
    // Debuffnutá karta v ruce pořád je v ruce.
    expect(jokerDelta(playHand(roundGame(['pickled_cheese']), 'KS 2H!', [0]), 'pickled_cheese').chips).toBe(
      6,
    );
  });

  it('prázdná ruka po zahrání nic', () => {
    expect(jokerDelta(playHand(roundGame(['pickled_cheese']), 'KS KH'), 'pickled_cheese').steps).toBe(0);
  });
});

describe('Třináctý plat (thirteenth_salary)', () => {
  it('po porážce šéfa +8 Kč v rozpisu odměn; v Malé útratě nic', () => {
    const small = makeGame({ registry: reg, jokers: ['thirteenth_salary'] });
    expect(jokerReward(winWith(small, 'KS').rewards, 'thirteenth_salary')).toBe(0);
    const bossGame = makeGame({ registry: reg, jokers: ['thirteenth_salary'] });
    selectBoss(bossGame, 'wall');
    const { rewards } = winWith(bossGame, 'KS');
    expect(jokerReward(rewards, 'thirteenth_salary')).toBe(8);
  });
});

describe('Brigádník (temp_worker)', () => {
  it('na konci kola +2 Kč za každou zahranou ruku (i vítěznou)', () => {
    const game = makeGame({ registry: reg, jokers: ['temp_worker'], round: true });
    game._core.state.round!.target = 1e12;
    playHand(game, 'KS');
    playHand(game, 'KS');
    expect(jokerReward(winWith(game, 'KS').rewards, 'temp_worker')).toBe(6);
    const quick = makeGame({ registry: reg, jokers: ['temp_worker'] });
    expect(jokerReward(winWith(quick, 'KS').rewards, 'temp_worker')).toBe(2);
  });
});

describe('Rybář (fisherman)', () => {
  /** Zahodí první kartu ruky a vrátí události zahození. */
  const discardOne = (game: Game): GameEvent[] =>
    ok(game.dispatch({ type: 'discard', cardIds: [game.state.round!.hand[0]!] }));

  it('po každém zahození 1 z 2 přinese náhodnou babskou radu do volného slotu', () => {
    const game = roundGame(['fisherman']);
    setChance(game, true);
    const events = discardOne(game);
    expect(game.state.consumables).toHaveLength(1);
    expect(game._core.api.consumableKind(game.state.consumables[0]!.defId)).toBe('rada');
    expect(messages(events)).toContain('jokers.fisherman.catch');
    // Druhé zahození zaplní i druhý slot, třetí už nic (sloty plné).
    discardOne(game);
    discardOne(game);
    expect(game.state.consumables).toHaveLength(2);
  });

  it('bez štěstí nic; s plnými sloty nehází (RNG se neposune); zahrání ruky nic nedělá', () => {
    const unlucky = roundGame(['fisherman']);
    setChance(unlucky, false);
    discardOne(unlucky);
    expect(unlucky.state.consumables).toEqual([]);
    const full = roundGame(['fisherman']);
    setChance(full, true);
    full._core.api.createConsumable({ defId: 'rada_a' });
    full._core.api.createConsumable({ defId: 'rada_b' });
    const rng = structuredClone(full.state.rng);
    discardOne(full);
    expect(full.state.consumables.map((c) => c.defId)).toEqual(['rada_a', 'rada_b']);
    expect(full.state.rng).toEqual(rng);
    const played = roundGame(['fisherman']);
    setChance(played, true);
    const r = playHand(played, 'KS');
    expect([r.score, jokerDelta(r, 'fisherman').steps, played.state.consumables.length]).toEqual([16, 0, 0]);
  });

  it('kopie zkusí štěstí znovu (dvě rady); hody jdou přes RNG a přežijí uložení a načtení', () => {
    const copied = roundGame(['copier', 'fisherman']);
    setChance(copied, true);
    discardOne(copied);
    expect(copied.state.consumables).toHaveLength(2);
    // Stejný seed = stejné úlovky, i když se mezi zahozeními hra uloží a načte.
    const series = (reloadEach: boolean): string[] => {
      let game = roundGame(['fisherman']);
      const caught: string[] = [];
      for (let i = 0; i < 3; i++) {
        if (reloadEach) game = reload(game);
        discardOne(game);
        caught.push(game.state.consumables.map((c) => c.defId).join('+'));
        game._core.state.consumables = [];
      }
      return caught;
    };
    expect(series(true)).toEqual(series(false));
  });
});

describe('Popelář (garbage_man)', () => {
  it('každá zahozená karta s hodnotou nejvýš 5 trvale +1 čip', () => {
    const game = roundGame(['garbage_man']);
    const cards = setupRound(game, '2S 5H 6D 3C:stone AS');
    ok(game.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
    // 2 a 5 ano; 6, kamenná (bez hodnoty) a eso ne.
    expect(joker(game, 'garbage_man').state).toEqual({ chips: 2 });
    const r = playHand(game, 'KS');
    expect([r.chips, r.mult]).toEqual([18, 1]);
  });

  it('bez nasbíraných čipů nic; kopie stav nezdvojí; přežije uložení a načtení', () => {
    expect(jokerDelta(playHand(roundGame(['garbage_man']), 'KS'), 'garbage_man').steps).toBe(0);
    let game = roundGame(['copier', 'garbage_man']);
    const cards = setupRound(game, '2S 3H 4D');
    ok(game.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
    expect(joker(game, 'garbage_man').state).toEqual({ chips: 3 });
    game = reload(game);
    expect(playHand(game, 'KS').chips).toBe(16 + 3 + 3);
  });
});

describe('Hrací automat (jukebox)', () => {
  it('skórující karty s nejvyšší hodnotou skórují ještě 1×', () => {
    // Dvojice králů: 12 + 2 × (10 + 10).
    const r = playHand(roundGame(['jukebox']), 'KS KH');
    expect([r.chips, r.mult, r.score]).toEqual([52, 2, 104]);
    // Barva: jen kluk (73 + 10).
    expect(playHand(roundGame(['jukebox']), '2H 5H 7H 9H JH').chips).toBe(83);
    // Dvě dvojice: králové ano, pětky ne (54 + 20).
    expect(playHand(roundGame(['jukebox']), 'KS KH 5C 5D').chips).toBe(74);
  });

  it('kamenná karta ani debuffnutá karta se nepočítá', () => {
    // 12 + 10 + 10 + 50 (kamenná) + 20 (opakovaní králové).
    expect(playHand(roundGame(['jukebox']), 'KS KH 2C:stone').chips).toBe(102);
    // Debuffnuté eso nedá nic, nejvyšší je druhé eso: 12 + 0 + 11 + 11.
    expect(playHand(roundGame(['jukebox']), 'AS! AH').chips).toBe(34);
  });
});

describe('Kůlna (tool_shed)', () => {
  it('+1 slot spotřebky, po prodeji zmizí (držené spotřebky zůstanou)', () => {
    const game = makeGame({ registry: reg, jokers: ['tool_shed'] });
    expect(game.modifiers().consumableSlots).toBe(3);
    for (let i = 0; i < 3; i++) expect(game._core.api.createConsumable({ defId: 'rada_a' })).not.toBeNull();
    expect(game._core.api.createConsumable({ defId: 'rada_a' })).toBeNull();
    winWith(game, 'KS');
    ok(game.dispatch({ type: 'cashOut' }));
    ok(game.dispatch({ type: 'sellJoker', uid: joker(game, 'tool_shed').uid }));
    expect(game.modifiers().consumableSlots).toBe(2);
    expect(game.state.consumables).toHaveLength(3);
    expect(game._core.api.createConsumable({ defId: 'rada_a' })).toBeNull();
    expect(JSON.parse(JSON.stringify(game.state))).toEqual(game.state);
  });
});

describe('Náhradní autobus (replacement_bus)', () => {
  const discardOne = (game: Game) =>
    ok(game.dispatch({ type: 'discard', cardIds: [game.state.round!.hand[0]!] }));

  it('první 2 zahození v kole zvětší ruku o 1 kartu (do konce kola)', () => {
    const game = roundGame(['replacement_bus']);
    game._core.state.round!.discardsLeft = 5;
    expect(game.state.round!.hand).toHaveLength(8);
    const sizes = Array.from({ length: 3 }, () => {
      discardOne(game);
      return game.state.round!.hand.length;
    });
    expect(sizes).toEqual([9, 10, 10]);
    expect(game.state.round!.handSizeDelta).toBe(2);
    // Další kolo začíná s normální rukou.
    finishRound(game);
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(game.state.round!.hand).toHaveLength(8);
  });

  it('kopie přidá kartu navíc', () => {
    const game = roundGame(['copier', 'replacement_bus']);
    discardOne(game);
    expect(game.state.round!.hand).toHaveLength(10);
  });
});

describe('Zabijačka (pig_slaughter)', () => {
  it('na konci kola zničí nejnižší kartu bez vylepšení v ruce a dá 2 Kč', () => {
    const game = makeGame({ registry: reg, jokers: ['pig_slaughter'] });
    const deckBefore = game.state.deck.length;
    const { rewards, events, cards } = winWith(game, 'KS 2H:gold 4C 3D 3S');
    // 2♥ je zlatá (vylepšení) → zůstane a vydělá; ze dvou trojek padne ta víc vlevo.
    expect(jokerReward(rewards, 'pig_slaughter')).toBe(2);
    expect(heldReward(rewards)).toBe(3);
    expect(game._core.card(cards[3]!.id)).toBeUndefined();
    expect(game._core.card(cards[4]!.id)).toBeDefined();
    expect(game.state.deck.length).toBe(deckBefore + cards.length - 1);
    expect(events).toContainEqual({ type: 'cardDestroyed', cardId: cards[3]!.id, reason: 'joker' });
    expect(messages(events)).toContain('jokers.pig_slaughter.feast');
  });

  it('bez obyčejné karty v ruce nic nezničí ani nedá; Sběrna surovin zničenou kartu započítá', () => {
    const game = makeGame({ registry: reg, jokers: ['pig_slaughter'] });
    const { rewards } = winWith(game, 'KS 2H:bonus 3C:stone');
    expect(jokerReward(rewards, 'pig_slaughter')).toBe(0);
    const combo = makeGame({ registry: reg, jokers: ['pig_slaughter', 'scrap_yard'] });
    winWith(combo, 'KS 4C');
    expect(joker(combo, 'scrap_yard').state).toEqual({ mult: 3 });
  });
});

describe('Městské derby (derby_fans)', () => {
  it('+8 mult, když skóruje červená i černá barva', () => {
    const r = playHand(roundGame(['derby_fans']), 'KS KH');
    expect([r.chips, r.mult, r.score]).toEqual([32, 10, 320]);
    // Divoká karta je obě barvy zároveň.
    expect(jokerDelta(playHand(roundGame(['derby_fans']), 'KS:wild KC'), 'derby_fans').mult).toBe(8);
  });

  it('jedna barva, kamenná karta, kopa ani debuffnutá karta nestačí', () => {
    const delta = (hand: string) => jokerDelta(playHand(roundGame(['derby_fans']), hand), 'derby_fans').mult;
    expect(delta('KS KC')).toBe(0);
    expect(delta('KS KC 2H:stone')).toBe(0);
    expect(delta('KS KC 5H')).toBe(0);
    expect(delta('KS KH!')).toBe(0);
  });
});

describe('Hospodský kvíz (pub_quiz)', () => {
  it('+10 čipů za každou různou hodnotu mezi skórujícími kartami', () => {
    // Dvě dvojice: 54 + 2 × 10.
    const r = playHand(roundGame(['pub_quiz']), 'KS KH 5C 5D');
    expect([r.chips, r.mult, r.score]).toEqual([74, 2, 148]);
    // Postupka: 35 + 35 + 5 × 10.
    expect(playHand(roundGame(['pub_quiz']), '5S 6H 7C 8D 9S').chips).toBe(120);
  });

  it('kamenná, debuffnutá ani neskórující karta se nepočítá', () => {
    const delta = (hand: string) => jokerDelta(playHand(roundGame(['pub_quiz']), hand), 'pub_quiz').chips;
    expect(delta('KS KH 2C:stone')).toBe(10);
    expect(delta('KS KH 9C')).toBe(10);
    expect(delta('KS KH 5C! 5D')).toBe(20);
  });
});

describe('Sběrna surovin (scrap_yard)', () => {
  it('za každou zničenou hrací kartu trvale +3 mult', () => {
    let game = roundGame(['scrap_yard']);
    expect(jokerDelta(playHand(game, 'KS'), 'scrap_yard').steps).toBe(0);
    for (const c of game.state.deck.slice(0, 2)) game._core.api.destroyCard(c.id, 'test');
    expect(joker(game, 'scrap_yard').state).toEqual({ mult: 6 });
    expect(descOf('scrap_yard', joker(game, 'scrap_yard'))).toContain('(teď +6 mult)');
    game = reload(game);
    const r = playHand(game, 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([16, 7, 112]);
  });

  it('strop +21 mult (7 karet), dál neroste', () => {
    const game = roundGame(['scrap_yard']);
    for (const c of game.state.deck.slice(0, 9)) game._core.api.destroyCard(c.id, 'test');
    expect(joker(game, 'scrap_yard').state).toEqual({ mult: 21 });
    expect(playHand(game, 'KS').mult).toBe(22);
  });

  it('kopie stav nezdvojí, ale efekt ano', () => {
    const game = roundGame(['copier', 'scrap_yard']);
    game._core.api.destroyCard(game.state.deck[0]!.id, 'test');
    expect(joker(game, 'scrap_yard').state).toEqual({ mult: 3 });
    expect(playHand(game, 'KS').mult).toBe(1 + 3 + 3);
  });
});

// ─────────────────────────── Fuzz ───────────────────────────

describe('fuzz: obsah hry se všemi 29 žolíky přes boty', () => {
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
    ['C2-FUZZ-A', 'max'],
    ['C2-FUZZ-B', 'econ'],
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

// Kontrola, že pomocník `messages` nevrací klíče bez událostí (sanity).
describe('pomocníci testu', () => {
  it('messages vybere jen hlášky', () => {
    expect(messages([{ type: 'message', key: 'a' }, { type: 'shopEntered' }])).toEqual(['a']);
  });
});
