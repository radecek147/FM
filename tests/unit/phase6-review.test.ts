/**
 * Revize fáze 6 (šéfové a štítky) — kombinace se skutečným enginem (Game + dispatch) a celým obsahem hry:
 *
 *  - každý šéf × uložení a načtení uprostřed kola: dvojče, které se po každé akci uloží a načte, má stejný stav
 *    i stejné události jako hra bez ukládání (stav šéfa žije jen v `RunState`),
 *  - každý šéf × Odvolání (razítko `appeal`) uprostřed kola: stopy pravidla zmizí (debuffy, karty lícem dolů, vypnutí
 *    žolíci, `passive`) a zbytek kola proběhne stejně jako ve hře, kde šéf vůbec není,
 *  - každý šéf × kopírující žolíci (Archivář, Kopírák, Napodobitel jsou v sestavě obou bodů výše) a přesná pravidla
 *    „kopie žolíka mimo provoz nedá nic“ u šéfů, kteří vypínají žolíky,
 *  - nekonečný režim: v patře 16 se losuje finálový šéf a jeho pravidlo platí,
 *  - každý štítek × uložení a načtení (od přeskočení po spotřebování),
 *  - fuzz přes boty se všemi šéfy a štítky (šéf vnucený do každého patra, štítky na každé útratě, náhodné přeskakování
 *    a Odvolání): žádná výjimka, JSON-bezpečný stav, 0 neplatných akcí, uložení a načtení po každé akci beze změny.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { addConsumableInstance, newConsumableInstance } from '../../src/engine/effects/api';
import { bossHasRule, isFinalAnte } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import { anteBase, niceRound } from '../../src/engine/run/targets';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { BOT_NAMES, createBot } from '../../src/engine/sim/index';
import type { Action, ActionResult, GameEvent, RunState } from '../../src/engine/types';
import { addJokers, makeGame, play, selectBoss, setupRound, type JokerSpec } from './fixtures/registry';

// ─────────────────────────── Registr a pomocníci ───────────────────────────

const reg = buildRegistry();
const BOSS_IDS = Object.keys(reg.bosses).sort();
const TAG_IDS = Object.keys(reg.tags).sort();
const FINAL_IDS = BOSS_IDS.filter((id) => reg.bosses[id]!.final);

/**
 * Sestava do kola šéfa: plochý žolík, Archivář (kopíruje souseda vlevo), Kopírák (nejpravější běžný/vzácný),
 * Napodobitel (nejcennější běžný/vzácný) a srdcový žolík — kopírování × každé pravidlo šéfa.
 */
const SQUAD = ['beer_mat', 'archivist', 'carbon_paper', 'impersonator', 'hearts_man'];

/** Uloží a načte hru přes skutečný formát uložení (JSON obálka + migrace + kontrola tvaru). */
function reload(g: Game): Game {
  return Game.fromState(deserializeRun(serializeRun(g.state as RunState)), reg);
}

const snap = (g: Game): string => JSON.stringify(g.state);

function ok(res: ActionResult, what: string): GameEvent[] {
  if (!res.ok) throw new Error(`${what}: ${res.error}`);
  return res.events;
}

/** Hodnoty, které JSON nepřežije beze změny: undefined, NaN, ±Infinity, funkce, Map/Set/třídy. */
function jsonProblems(x: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 5) return out;
  if (x === undefined) out.push(`${path} = undefined`);
  else if (typeof x === 'number' && !Number.isFinite(x)) out.push(`${path} = ${x}`);
  else if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint')
    out.push(`${path}: ${typeof x}`);
  else if (Array.isArray(x)) x.forEach((v, i) => jsonProblems(v, `${path}[${i}]`, out));
  else if (x !== null && typeof x === 'object') {
    const proto = Object.getPrototypeOf(x) as object | null;
    if (proto !== Object.prototype && proto !== null) out.push(`${path}: ${proto.constructor.name}`);
    for (const [k, v] of Object.entries(x)) jsonProblems(v, `${path}.${k}`, out);
  }
  return out;
}

/** Hra v kole daného šéfa (patro 1, balíček Hospodský, sestava `SQUAD`). */
function bossGame(id: string, seed: string, jokers: readonly (string | JokerSpec)[] = SQUAD): Game {
  const g = makeGame({ registry: reg, deckId: 'pub', seed, money: 20 });
  addJokers(g, jokers);
  selectBoss(g, id);
  return g;
}

/** Přidá do slotu razítko Odvolání (bez kontroly slotů) a vrátí jeho uid. */
function giveAppeal(g: Game): number {
  const core = g._core;
  const c = newConsumableInstance(core, 'appeal');
  addConsumableInstance(core, c, true);
  return c.uid;
}

/**
 * Jedna akce kola, po které pravidlo zanechá stopy: zahození (Parkovné, Tchyně, Bílá paní…) a zahrání ruky
 * (Černá kočka, Velká voda, Krajský úřad, Pan starosta, Kapsář…), pokud kolo potom pokračuje.
 */
function leaveTraces(g: Game): void {
  const round = g._core.state.round!;
  const target = round.target;
  round.target = 1e15;
  if (round.discardsLeft > 0) ok(g.dispatch({ type: 'discard', cardIds: round.hand.slice(0, 2) }), 'discard');
  if (g.state.round!.handsLeft >= 2)
    ok(g.dispatch({ type: 'play', cardIds: round.hand.slice(0, 2) }), 'play');
  g._core.state.round!.target = target;
}

/** Šéf bez pravidla (jen vyšší cíl) — dvojče „bez šéfa“, které jinak běží jako kolo šéfa (porážka šéfa atd.). */
const NO_RULE_BOSS = 'binder_tower';

/** Stav bez stop šéfa (id šéfa kola, příznak Odvolání, jeho klíče v `round.flags`, příčina prohry). */
function withoutBoss(state: Readonly<RunState>): RunState {
  const s = JSON.parse(JSON.stringify(state)) as RunState;
  if (s.round) {
    s.round.bossId = NO_RULE_BOSS;
    s.round.bossDisabled = false;
    s.round.flags = {};
  }
  if (s.gameOver) s.gameOver.cause = NO_RULE_BOSS;
  return s;
}

/** Události beze stop šéfa (id šéfa, hláška Odvolání). */
function eventsWithoutBoss(events: readonly GameEvent[]): unknown {
  return events
    .filter((e) => e.type !== 'message')
    .map((e) => {
      if (e.type === 'gameOver') return { ...e, info: { ...e.info, cause: NO_RULE_BOSS } };
      if (e.type === 'bossDefeated') return { ...e, bossId: NO_RULE_BOSS };
      return e;
    });
}

// ─────────────────────────── Šéf × uložení a načtení ───────────────────────────

describe('každý šéf × uložení a načtení uprostřed kola (dvojče se ukládá po každé akci)', () => {
  it.each(BOSS_IDS.map((id) => [id]))(
    '%s',
    (id) => {
      for (const botName of ['max', 'flush'] as const) {
        const a = bossGame(id, `P6-SAVE-${id}-${botName}`);
        let b = reload(a);
        const bot = createBot(botName);
        let steps = 0;
        for (; steps < 80 && a.state.phase === 'round'; steps++) {
          const action = bot.decide(a);
          const ea = ok(a.dispatch(action), `${botName} ${id} A ${JSON.stringify(action)}`);
          const eb = ok(b.dispatch(action), `${botName} ${id} B ${JSON.stringify(action)}`);
          expect(JSON.stringify(eb), `${id} události po načtení`).toBe(JSON.stringify(ea));
          b = reload(b);
          expect(snap(b), `${id} stav po načtení, krok ${steps}`).toBe(snap(a));
        }
        expect(steps, id).toBeGreaterThan(0);
        expect(a.state.phase, `${botName} ${id}`).not.toBe('round');
      }
    },
    60_000,
  );
});

// ─────────────────────────── Šéf × Odvolání ───────────────────────────

describe('každý šéf × Odvolání uprostřed kola', () => {
  const ruled = BOSS_IDS.filter((id) => bossHasRule(reg.bosses[id]!));

  it('Odvolání má smysl u všech šéfů kromě těch, kteří jen zvyšují cíl', () => {
    expect(BOSS_IDS.filter((id) => !ruled.includes(id))).toEqual(['binder_tower']);
  });

  it.each(ruled.map((id) => [id]))(
    '%s: stopy pravidla zmizí a zbytek kola je stejný jako bez šéfa',
    (id) => {
      const g = bossGame(id, `P6-APPEAL-${id}`);
      leaveTraces(g);
      expect(g.state.phase, id).toBe('round');
      const core = g._core;
      core.state.money = 10;
      const target = g.state.round!.target;
      const uid = giveAppeal(g);
      expect(g.canUseConsumable(uid), id).toBe(true);
      ok(g.dispatch({ type: 'useConsumable', uid }), `${id} Odvolání`);

      const s = g.state;
      expect(s.round!.bossDisabled, id).toBe(true);
      expect(s.money, id).toBe(5);
      expect(s.round!.target, `${id}: cíl zůstává`).toBe(target);
      expect(s.round!.handsLeft, `${id}: kolo nesmí uváznout bez ruky`).toBeGreaterThanOrEqual(1);
      expect(
        s.deck.filter((c) => c.debuffed).map((c) => c.id),
        `${id}: karty mimo provoz`,
      ).toEqual([]);
      expect(
        s.round!.hand.filter((cid) => g.card(cid)!.faceDown),
        `${id}: karty lícem dolů`,
      ).toEqual([]);
      expect(
        s.jokers.filter((j) => j.debuffed).map((j) => j.defId),
        `${id}: žolíci mimo provoz`,
      ).toEqual([]);
      expect(s.round!.ruleJokerDebuffs ?? [], id).toEqual([]);
      expect(g.canUseConsumable(giveAppeal(g)), `${id}: podruhé už ne`).toBe(false);
      core.state.consumables = core.state.consumables.filter((c) => c.defId !== 'appeal');

      // Dvojče ve stejném stavu, jen bez šéfa: modifikátory i zbytek kola (stejné akce) musí vyjít stejně.
      const twin = Game.fromState(withoutBoss(s), reg);
      expect(twin.modifiers(), `${id}: passive šéfa`).toEqual(g.modifiers());
      const bot = createBot('max');
      for (let step = 0; step < 80 && g.state.phase === 'round'; step++) {
        const action: Action = bot.decide(g);
        const eg = ok(g.dispatch(action), `${id} ${JSON.stringify(action)}`);
        const et = ok(twin.dispatch(action), `${id} dvojče ${JSON.stringify(action)}`);
        expect(JSON.stringify(eventsWithoutBoss(eg)), `${id}: události, krok ${step}`).toBe(
          JSON.stringify(eventsWithoutBoss(et)),
        );
        expect(JSON.stringify(withoutBoss(g.state)), `${id}: stav, krok ${step}`).toBe(
          JSON.stringify(withoutBoss(twin.state)),
        );
      }
      expect(g.state.phase, id).not.toBe('round');
    },
    30_000,
  );
});

// ─────────────────────────── Šéf × kopírující žolík ───────────────────────────

describe('kopírující žolík × šéfové, kteří vypínají žolíky: kopie žolíka mimo provoz nedá nic', () => {
  /** Dvojice králů (14 + 10 + 10 = 34 čipů, 2 mult); Pivní tácek +10 čipů a +2 mult, jeho kopie znovu. */
  const BASE = { chips: 34, mult: 2 };
  const ONE = { chips: 44, mult: 4 };
  const TWO = { chips: 54, mult: 6 };

  /** Skutečné skóre Dvojice králů — zahraje se na kopii hry (uložení a načtení), ať se stav kola nezmění. */
  function pairPreview(g: Game): { chips: number; mult: number } {
    const copy = reload(g);
    const cards = setupRound(copy, 'KC KD 2S 3S 7S');
    copy._core.state.round!.target = 1e15;
    const { result } = play(copy, [cards[0]!.id, cards[1]!.id]);
    return { chips: result.chips, mult: result.mult };
  }

  function appeal(g: Game): void {
    g._core.state.money = 10;
    ok(g.dispatch({ type: 'useConsumable', uid: giveAppeal(g) }), 'Odvolání');
  }

  it('bez šéfa: Archivář vpravo od Pivního tácku ho zkopíruje (+20 čipů, +4 mult)', () => {
    const g = makeGame({ registry: reg, deckId: 'pub', jokers: ['beer_mat', 'archivist'], round: true });
    expect(pairPreview(g)).toEqual(TWO);
  });

  it('Exekutor zabaví Pivní tácek: nedá nic ani jeho kopie; po Odvolání zase oba', () => {
    const g = makeGame({ registry: reg, deckId: 'pub', money: 20 });
    const [mat] = addJokers(g, ['beer_mat', 'archivist']);
    mat!.sellBonus = 20;
    selectBoss(g, 'bailiff');
    expect(g.state.jokers.map((j) => j.debuffed)).toEqual([true, false]);
    expect(pairPreview(g)).toEqual(BASE);
    appeal(g);
    expect(pairPreview(g)).toEqual(TWO);
  });

  it('Jednooký hejtman: kopie platí jen na fungující pozici a pravidlo sleduje pořadí po přeřazení', () => {
    const g = bossGame('one_eyed_hetman', 'P6-HETMAN', [
      'beer_mat',
      'archivist',
      'hearts_man',
      'gravedigger',
    ]);
    const uid = (defId: string): number => g.state.jokers.find((j) => j.defId === defId)!.uid;
    const order = (ids: string[]): void => {
      ok(g.dispatch({ type: 'reorderJokers', uids: ids.map(uid) }), 'reorder');
    };
    expect(pairPreview(g)).toEqual(TWO);
    // Tácek i Archivář vpravo: oba mimo provoz.
    order(['hearts_man', 'gravedigger', 'beer_mat', 'archivist']);
    expect(pairPreview(g)).toEqual(BASE);
    // Tácek vlevo funguje, Archivář vpravo ne.
    order(['gravedigger', 'beer_mat', 'archivist', 'hearts_man']);
    expect(pairPreview(g)).toEqual(ONE);
    // Archivář vlevo funguje, ale kopíruje souseda vlevo (Hrobníka), Tácek vpravo je mimo provoz.
    order(['gravedigger', 'archivist', 'beer_mat', 'hearts_man']);
    expect(pairPreview(g)).toEqual(BASE);
    order(['beer_mat', 'archivist', 'hearts_man', 'gravedigger']);
    expect(pairPreview(g)).toEqual(TWO);
    // Uložení a načtení pravidlo zachová.
    expect(pairPreview(reload(g))).toEqual(TWO);
  });

  it('Výpadek proudu: v první ruce nic (ani kopie), od druhé ruky oba; Napodobitel si cíl vybral i potmě', () => {
    const g = bossGame('blackout', 'P6-BLACKOUT', ['beer_mat', 'archivist', 'impersonator']);
    expect(pairPreview(g)).toEqual(BASE);
    const imp = g.state.jokers.find((j) => j.defId === 'impersonator')!;
    expect(imp.state.target, 'cíl Napodobitele').toBe(g.state.jokers[0]!.uid);
    g._core.state.round!.target = 1e15;
    const cards = setupRound(g, 'AC 2D 4D 6D 8S');
    ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }), 'první ruka');
    // Tácek + Archivář + Napodobitel (kopie Tácku) = 3× +10 čipů a +2 mult.
    expect(pairPreview(g)).toEqual({ chips: 64, mult: 8 });
  });

  it('Krajský úřad: po ruce vypne jednoho žolíka; kopie vypnutého cíle nedá nic', () => {
    for (const seed of ['P6-OFFICE-1', 'P6-OFFICE-2', 'P6-OFFICE-3', 'P6-OFFICE-4']) {
      const g = bossGame('regional_office', seed, ['beer_mat', 'archivist']);
      expect(pairPreview(g)).toEqual(TWO);
      g._core.state.round!.target = 1e15;
      const cards = setupRound(g, 'AC 2D 4D 6D 8S');
      ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }), 'ruka');
      const [mat, arch] = g.state.jokers;
      expect([mat!.debuffed, arch!.debuffed].filter(Boolean), seed).toHaveLength(1);
      expect(pairPreview(g), seed).toEqual(mat!.debuffed ? BASE : ONE);
    }
  });
});

// ─────────────────────────── Karty lícem dolů × třídění ───────────────────────────

describe('třídění ruky neprozradí karty lícem dolů (Výluka, Mlha, Bílá paní)', () => {
  it('odkryté karty se seřadí, zakryté zůstanou vpravo v dosavadním pořadí (podle hodnoty i barvy)', () => {
    const g = bossGame('white_lady', 'P6-SORT', []);
    const cards = setupRound(g, '2C^ 9H AS^ 5D KD^ 7S');
    const ids = cards.map((c) => c.id);
    const [two, nine, ace, five, king, seven] = ids;
    ok(g.dispatch({ type: 'sortHand', by: 'rank' }), 'sort rank');
    expect(g.state.round!.hand).toEqual([nine, seven, five, two, ace, king]);
    ok(g.dispatch({ type: 'sortHand', by: 'suit' }), 'sort suit');
    // Odkryté v pořadí barev ♠ ♥ ♣ ♦ (7♠, 9♥, 5♦), zakryté beze změny.
    expect(g.state.round!.hand).toEqual([seven, nine, five, two, ace, king]);
  });

  it('Bílá paní: po zahození zamíchaná zakrytá ruka zůstane po třídění zamíchaná', () => {
    const g = bossGame('white_lady', 'P6-SORT-LADY', []);
    const round = g._core.state.round!;
    ok(g.dispatch({ type: 'discard', cardIds: round.hand.slice(0, 1) }), 'discard');
    const hidden = round.hand.filter((id) => g.card(id)!.faceDown);
    expect(hidden.length).toBeGreaterThan(0);
    ok(g.dispatch({ type: 'sortHand', by: 'rank' }), 'sort');
    expect(g.state.round!.hand.filter((id) => g.card(id)!.faceDown)).toEqual(hidden);
    expect(g.state.round!.hand.slice(-hidden.length)).toEqual(hidden);
  });
});

// ─────────────────────────── Nekonečný režim ───────────────────────────

describe('nekonečný režim: finálový šéf v patře 16', () => {
  it('po šéfovi patra 15 se v patře 16 losuje finálový šéf; patra 9–15 běžní', () => {
    for (const seed of ['P6-END-1', 'P6-END-2', 'P6-END-3', 'P6-END-4', 'P6-END-5']) {
      const g = makeGame({ registry: reg, deckId: 'pub', seed });
      const s = g._core.state;
      s.endless = true;
      s.ante = 15;
      selectBoss(g, 'tax_audit');
      g._core.state.round!.target = 1;
      const cards = setupRound(g, 'AC 2D 4D 6D 8S');
      ok(g.dispatch({ type: 'play', cardIds: [cards[0]!.id] }), 'ruka');
      expect(g.state.phase, seed).toBe('round_end');
      ok(g.dispatch({ type: 'cashOut' }), 'cashOut');
      expect(g.state.ante).toBe(16);
      const bossId = g.state.blinds[2]!.bossId!;
      expect(FINAL_IDS, `${seed}: ${bossId}`).toContain(bossId);
    }
    for (const ante of [9, 12, 15, 17, 23]) expect(isFinalAnte(ante), String(ante)).toBe(false);
    for (const ante of [8, 16, 24]) expect(isFinalAnte(ante), String(ante)).toBe(true);
  });

  it.each(FINAL_IDS.map((id) => [id]))(
    '%s v patře 16: cíl podle násobku, pravidlo platí, bot kolo dohraje, uložení a načtení beze změny',
    (id) => {
      const g = makeGame({ registry: reg, deckId: 'pub', seed: `P6-END16-${id}`, money: 20 });
      addJokers(g, SQUAD);
      g._core.state.endless = true;
      g._core.state.ante = 16;
      selectBoss(g, id);
      const def = reg.bosses[id]!;
      expect(g.state.round!.target, id).toBe(
        niceRound(anteBase(16, g.targetCurve()) * (def.targetMult ?? 2)),
      );
      expect(g.state.round!.target, `${id}: exponenciální cíl`).toBeGreaterThan(1e6);
      // Kolo proběhne celé (všechny ruce), ať se pravidlo projeví po každé z nich.
      g._core.state.round!.target = 1e15;
      let b = reload(g);
      const bot = createBot('max');
      const seen = new Set<string>();
      for (let step = 0; step < 80 && g.state.phase === 'round'; step++) {
        const action = bot.decide(g);
        const before = g.state.jokers.filter((j) => j.debuffed).length;
        const events = ok(g.dispatch(action), `${id} ${JSON.stringify(action)}`);
        ok(b.dispatch(action), `${id} B`);
        b = reload(b);
        expect(snap(b), id).toBe(snap(g));
        if (action.type !== 'play' || g.state.phase !== 'round') continue;
        const r = g.state.round!;
        if (id === 'great_flood') {
          seen.add('flood');
          expect(g.modifiers().handSize, id).toBe(Math.max(1, 8 - r.handsPlayed));
        }
        if (id === 'regional_office') {
          seen.add('office');
          expect(g.state.jokers.filter((j) => j.debuffed).length, id).toBe(Math.min(5, before + 1));
        }
        if (id === 'white_lady') {
          seen.add('lady');
          const drawn = new Set(events.flatMap((e) => (e.type === 'cardsDrawn' ? e.cardIds : [])));
          for (const cid of r.hand) expect(g.card(cid)!.faceDown, id).toBe(!drawn.has(cid));
        }
        if (id === 'mayor') {
          seen.add('mayor');
          expect(typeof r.flags['mayor.lastScore'], id).toBe('number');
        }
        if (id === 'banana_queue') {
          const played = events.find((e) => e.type === 'handPlayed');
          if (played?.type === 'handPlayed' && r.handsPlayed > 1 && played.result.score > 0) {
            seen.add('banana');
            expect(played.result.steps.at(-1), id).toMatchObject({ source: 'boss', defId: 'banana_queue' });
          }
        }
      }
      expect(g.state.phase, id).not.toBe('round');
      expect(seen.size, `${id}: pravidlo se projevilo`).toBe(1);
    },
    30_000,
  );
});

// ─────────────────────────── Štítek × uložení a načtení ───────────────────────────

describe('každý štítek × uložení a načtení (od přeskočení po spotřebování)', () => {
  it.each(TAG_IDS.map((id) => [id]))(
    '%s',
    (id) => {
      const a = makeGame({ registry: reg, deckId: 'pub', seed: `P6-TAG-${id}`, money: 10 });
      addJokers(a, ['beer_mat', 'hearts_man']);
      // Patro 3: všechny štítky už jsou v poolu (minAnte ≤ 3); štítek na Malé útratě.
      a._core.state.ante = 3;
      a._core.state.blinds[0]!.skipTagId = id;
      let b = reload(a);
      const bot = createBot('max');
      let skipped = false;
      let gained = false;
      let consumed = false;
      for (let step = 0; step < 400; step++) {
        const s = a.state;
        if (s.phase === 'game_over' || (s.ante > 3 && s.phase === 'blind_select')) break;
        // Kolo vyhraje první zahraná ruka — jde o štítek, ne o šéfa.
        if (s.phase === 'round' && s.round!.target > 1) {
          a._core.state.round!.target = 1;
          b._core.state.round!.target = 1;
        }
        const action: Action = !skipped ? { type: 'skipBlind' } : bot.decide(a);
        skipped = true;
        const ea = ok(a.dispatch(action), `${id} A ${JSON.stringify(action)}`);
        const eb = ok(b.dispatch(action), `${id} B ${JSON.stringify(action)}`);
        expect(JSON.stringify(eb), `${id} události`).toBe(JSON.stringify(ea));
        for (const e of ea) {
          if (e.type === 'tagAdded' && e.defId === id) gained = true;
          if (e.type === 'tagTriggered' && e.defId === id) consumed = true;
        }
        b = reload(b);
        expect(snap(b), `${id} stav po načtení, krok ${step}`).toBe(snap(a));
        expect(jsonProblems(a.state), id).toEqual([]);
      }
      expect(gained, `${id} získán`).toBe(true);
      // Do konce patra se každý štítek spotřebuje (hned, příští Večerka / kolo, kolo šéfa, po šéfovi).
      expect(consumed, `${id} spotřebován`).toBe(true);
      expect(
        a.state.tags.map((t) => t.defId),
        id,
      ).not.toContain(id);
      expect(a.state.phase, id).not.toBe('game_over');
    },
    30_000,
  );
});

// ─────────────────────────── Fuzz přes boty ───────────────────────────

/** Deterministický „hod“ pro fuzz (FNV-1a). */
function roll(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 100;
}

interface FuzzResult {
  actions: number;
  invalid: string[];
  maxAnte: number;
  tags: Set<string>;
  appeals: number;
}

/**
 * Run s vnuceným šéfem v každém patře a štítky ze všech 20 na každé útratě; bot hraje, fuzz občas přeskočí útratu
 * a uprostřed kola šéfa použije Odvolání. Hra B se po každé akci uloží a načte a musí zůstat shodná s hrou A.
 * Cíle kol jsou snížené (÷ `ease`), aby run došel daleko (nekonečný režim, finální šéfové v běžných patrech).
 */
function fuzzRun(
  bossId: string,
  botName: (typeof BOT_NAMES)[number],
  seed: string,
  stake: number,
): FuzzResult {
  const bot = createBot(botName);
  const a = Game.newRun({ seed, deckId: 'pub', stake }, reg);
  let b = Game.newRun({ seed, deckId: 'pub', stake }, reg);
  const out: FuzzResult = { actions: 0, invalid: [], maxAnte: 1, tags: new Set(), appeals: 0 };
  let cursor = roll(seed) % TAG_IDS.length;
  const both = (fn: (g: Game) => void): void => {
    fn(a);
    fn(b);
  };
  for (let i = 0; i < 700; i++) {
    const s = a.state;
    if (s.phase === 'game_over' || s.ante > 17) break;
    if (s.phase === 'blind_select') {
      const tag = TAG_IDS[cursor++ % TAG_IDS.length]!;
      both((g) => {
        const st = g._core.state;
        if (st.blinds[2]!.status === 'upcoming') st.blinds[2]!.bossId = bossId;
        const cur = st.blinds[st.blindIndex]!;
        if (cur.kind !== 'boss') cur.skipTagId = tag;
      });
    }
    if (s.phase === 'round' && s.round && s.round.flags['fuzz.eased'] !== true) {
      const ease = s.ante <= 8 ? 6 : 1e15;
      both((g) => {
        const r = g._core.state.round!;
        r.target = Math.max(1, Math.ceil(r.target / ease));
        r.flags['fuzz.eased'] = true;
      });
    }
    let action: Action = bot.decide(a);
    const r = roll(`${seed}:${i}`);
    if (s.phase === 'blind_select' && s.blinds[s.blindIndex]?.kind !== 'boss' && r < 30)
      action = { type: 'skipBlind' };
    if (s.phase === 'round' && s.round?.bossId && !s.round.bossDisabled && r < 6) {
      both((g) => {
        g._core.state.money = Math.max(g._core.state.money, 10);
        giveAppeal(g);
      });
      action = { type: 'useConsumable', uid: a.state.consumables[a.state.consumables.length - 1]!.uid };
      out.appeals++;
    }
    const ra = a.dispatch(action);
    const rb = b.dispatch(action);
    out.actions++;
    if (!ra.ok) out.invalid.push(`${i} ${s.phase} ${JSON.stringify(action)} → ${ra.error}`);
    expect(rb.ok, `${seed} ${i}: B`).toBe(ra.ok);
    if (ra.ok) {
      for (const e of ra.events) if (e.type === 'blindSkipped' && e.tagId) out.tags.add(e.tagId);
    }
    const problems = jsonProblems(a.state);
    if (problems.length > 0) throw new Error(`${seed} ${i}: stav není JSON-bezpečný: ${problems.join(', ')}`);
    b = reload(b);
    if (snap(b) !== snap(a))
      throw new Error(`${seed} ${i}: stav po uložení a načtení se liší (${action.type})`);
    out.maxAnte = Math.max(out.maxAnte, a.state.ante);
  }
  return out;
}

describe('fuzz: boti se všemi šéfy a štítky', () => {
  const bots = BOT_NAMES.filter((n) => n !== 'nojoker');
  const tagsSeen = new Set<string>();
  let appeals = 0;

  it.each(BOSS_IDS.map((id, i) => [id, bots[i % bots.length]!] as const))(
    '%s (%s): žádná výjimka, 0 neplatných akcí, JSON-bezpečný stav, uložení a načtení beze změny',
    (id, botName) => {
      for (const stake of [1, 8]) {
        const res = fuzzRun(id, botName, `P6-FUZZ-${id}-${stake}`, stake);
        expect(res.invalid, `${id} ${botName} ${stake}`).toEqual([]);
        expect(res.actions, id).toBeGreaterThan(botName === 'random' ? 3 : 20);
        res.tags.forEach((t) => tagsSeen.add(t));
        appeals += res.appeals;
      }
    },
    60_000,
  );

  it('fuzz prošel všechny štítky a použil Odvolání', () => {
    expect([...tagsSeen].sort()).toEqual(TAG_IDS);
    expect(appeals).toBeGreaterThan(10);
  });
});
