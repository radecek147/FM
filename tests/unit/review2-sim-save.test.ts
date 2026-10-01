/**
 * Adversariální revize 2 (fáze 2): simulace, ukládání a determinismus.
 *
 * - Bot nesmí mít stav mimo `RunState`: rozhodnutí je čistá funkce stavu hry (stejný stav ⇒ stejná akce bez ohledu
 *   na instanci bota a historii volání). Dřív si bot držel paměť (RNG, poslední skóre, počítadla Večerky) svázanou
 *   s instancí `Game` → dva prokládané runy jednou instancí nebo uložení a načtení uprostřed simulace vedly k jinému
 *   výsledku.
 * - Dotazy bota (náhled, kopie hry) skutečnou hru nemění: jeho akce přehrané bez bota dají stejný stav.
 * - Náhodné akce (fuzz): neplatná akce nemění stav a na bus nedoručí nic, platná doručí přesně `res.events`;
 *   hra načtená z uložení před akcí dá stejný výsledek i stav.
 * - `scripts/simulate.ts`: `--json -` a `--json=soubor`; JSON výstup nezávisí na tom, kam se zapisuje.
 */
import { describe, expect, it } from 'vitest';
import { parseCli, reportJson, runSimulation } from '../../scripts/simulate';
import { buildRegistry } from '../../src/content/index';
import type { ContentRegistry, Rng } from '../../src/engine/content-types';
import { cyrb128, rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { BOT_NAMES, createBot, simulateRun, type Bot, type BotName } from '../../src/engine/sim/index';
import type { Action, GameEvent } from '../../src/engine/types';
import { ART, makeGame, makeRegistry } from './fixtures/registry';

const contentReg = buildRegistry();
/** Testovací obsah (žolíci, šéfové, štítky, obálky, spotřebky) s nižšími cíli, aby runy došly do pozdějších pater. */
const fixtureReg = makeRegistry({ decks: [{ id: 'easy', passive: () => ({ targetMult: 0.3 }), art: ART }] });

const REGISTRIES: readonly (readonly [string, ContentRegistry, string])[] = [
  ['obsah hry', contentReg, 'pub'],
  ['testovací obsah', fixtureReg, 'easy'],
];

const finished = (g: Game): boolean => g.state.phase === 'game_over' || g.state.phase === 'victory';

interface PlayedRun {
  actions: Action[];
  json: string;
}

/**
 * Odehraje run botem (jako `simulateRun`, bez pojistky neplatných akcí). `between` smí hru vyměnit (uložení
 * a načtení), `check` dostane hru a akci před jejím provedením.
 */
function playRun(
  registry: ContentRegistry,
  deckId: string,
  seed: string,
  bot: Bot,
  opts: { between?: (game: Game, step: number) => Game; check?: (game: Game, action: Action) => void } = {},
): PlayedRun {
  let game = Game.newRun({ seed, deckId, stake: 1 }, registry);
  const actions: Action[] = [];
  for (let step = 0; step < 4000 && !finished(game); step++) {
    if (opts.between) game = opts.between(game, step);
    const action = bot.decide(game);
    opts.check?.(game, action);
    actions.push(action);
    game.dispatch(action);
  }
  return { actions, json: JSON.stringify(game.state) };
}

const reload = (registry: ContentRegistry) => (game: Game) =>
  Game.fromState(deserializeRun(serializeRun(game.state)), registry);

// ─────────────────────────── Boti bez stavu mimo RunState ───────────────────────────

describe('boti: rozhodnutí je čistá funkce stavu hry', () => {
  for (const [label, registry, deckId] of REGISTRIES) {
    it.each(BOT_NAMES.map((n) => [n]))(
      `${label} – %s: nová instance i opakované volání dají v každém kroku stejnou akci`,
      (name) => {
        const bot = createBot(name as BotName);
        let steps = 0;
        playRun(registry, deckId, `PURE-${name}`, bot, {
          check: (game, action) => {
            steps++;
            expect(createBot(name as BotName).decide(game), `krok ${steps}`).toEqual(action);
            expect(bot.decide(game), `krok ${steps} (znovu)`).toEqual(action);
          },
        });
        expect(steps).toBeGreaterThan(5);
      },
      60_000,
    );
  }

  it.each(BOT_NAMES.map((n) => [n]))(
    'testovací obsah – %s: uložit a načíst každých 5 akcí ⇒ stejné akce i stav na konci',
    (name) => {
      const reference = playRun(fixtureReg, 'easy', `RELOAD-${name}`, createBot(name as BotName));
      const resumed = playRun(fixtureReg, 'easy', `RELOAD-${name}`, createBot(name as BotName), {
        between: (game, step) => (step > 0 && step % 5 === 0 ? reload(fixtureReg)(game) : game),
      });
      expect(resumed.actions).toEqual(reference.actions);
      expect(resumed.json).toBe(reference.json);
    },
    60_000,
  );

  it('obsah hry – max: uložení a načtení po každé akci simulaci nezmění', () => {
    const reference = playRun(contentReg, 'pub', 'RELOAD-ALL', createBot('max'));
    const resumed = playRun(contentReg, 'pub', 'RELOAD-ALL', createBot('max'), {
      between: reload(contentReg),
    });
    expect(resumed.actions).toEqual(reference.actions);
    expect(resumed.json).toBe(reference.json);
  }, 60_000);

  it.each(BOT_NAMES.map((n) => [n]))(
    'jedna instance bota pro dva prokládané runy = stejné výsledky jako každý run zvlášť (%s)',
    (name) => {
      const separate = ['MIX-A', 'MIX-B'].map(
        (seed) => playRun(fixtureReg, 'easy', seed, createBot(name as BotName)).json,
      );
      const bot = createBot(name as BotName);
      const games = ['MIX-A', 'MIX-B'].map((seed) =>
        Game.newRun({ seed, deckId: 'easy', stake: 1 }, fixtureReg),
      );
      for (let step = 0; step < 8000 && !games.every(finished); step++) {
        const game = games[step % 2]!;
        if (!finished(game)) game.dispatch(bot.decide(game));
      }
      expect(games.map((g) => JSON.stringify(g.state))).toEqual(separate);
    },
    60_000,
  );

  it('simulateRun se sdílenou instancí bota nezávisí na předchozích runech', () => {
    const opts = { seed: 'SHARED-1', deckId: 'easy', stake: 1 };
    const fresh = simulateRun(fixtureReg, { ...opts, bot: createBot('max') });
    const shared = createBot('max');
    simulateRun(fixtureReg, { ...opts, seed: 'SHARED-2', bot: shared });
    expect(simulateRun(fixtureReg, { ...opts, bot: shared })).toEqual(fresh);
  }, 60_000);

  it('dotazy bota skutečnou hru nemění: jeho akce přehrané bez bota dají stejný stav', () => {
    for (const name of ['max', 'flush', 'random'] as const) {
      const run = playRun(fixtureReg, 'easy', `REPLAY-${name}`, createBot(name));
      const game = Game.newRun({ seed: `REPLAY-${name}`, deckId: 'easy', stake: 1 }, fixtureReg);
      for (const action of run.actions) game.dispatch(action);
      expect(JSON.stringify(game.state), name).toBe(run.json);
    }
  }, 60_000);

  it('přeskočení útraty: rozhodne síla buildu ze stavu (žolíci), ne paměť bota', () => {
    // Plné cíle (balíček `test`): přeskočit chce průměrná nejlepší ruka × 4 ruce ≥ 3× cíl Velké útraty (3 × 380).
    const registry = makeRegistry();
    const strong = makeGame({ registry, jokers: ['times_mult', 'times_mult', 'times_mult'] });
    const weak = makeGame({ registry });
    for (const game of [strong, weak]) {
      const s = game._core.state;
      s.blinds[0]!.skipTagId = 'cash_tag';
      s.stats.handsPlayed = 10;
      s.stats.bestHandScore = 2000;
    }
    const before = JSON.stringify(strong.state);
    expect(createBot('max').decide(strong)).toEqual({ type: 'skipBlind' });
    expect(createBot('max').decide(weak)).toEqual({ type: 'selectBlind' });
    // Odhad síly hraje na kopii hry — skutečný stav se nezmění.
    expect(JSON.stringify(strong.state)).toBe(before);
    // Šetřílek nepřeskakuje nikdy; na začátku runu (méně než 4 zahrané ruce) nepřeskočí nikdo.
    expect(createBot('econ').decide(strong)).toEqual({ type: 'selectBlind' });
    strong._core.state.stats.handsPlayed = 3;
    expect(createBot('max').decide(strong)).toEqual({ type: 'selectBlind' });
    // Ani nejlepší ruka runu na 3× cíl nestačí ⇒ silný build se neodhaduje a bot hraje.
    strong._core.state.stats.handsPlayed = 10;
    strong._core.state.stats.bestHandScore = 100;
    expect(createBot('max').decide(strong)).toEqual({ type: 'selectBlind' });
  });
});

// ─────────────────────────── Náhodné akce: bus, neplatné akce, uložení ───────────────────────────

const ACTION_TYPES: readonly Action['type'][] = [
  'selectBlind',
  'skipBlind',
  'rerollBoss',
  'play',
  'discard',
  'reorderHand',
  'sortHand',
  'cashOut',
  'buy',
  'buyAndUse',
  'buyBooster',
  'buyVoucher',
  'reroll',
  'leaveShop',
  'pickBooster',
  'skipBooster',
  'sellJoker',
  'sellConsumable',
  'useConsumable',
  'reorderJokers',
  'continueEndless',
];

/** Náhodná (často neplatná) akce: neexistující sloty, cizí id, duplicity, prázdné výběry. */
function randomAction(game: Game, r: Rng): Action {
  const s = game.state;
  const type = r.pick(ACTION_TYPES);
  const pool = s.round?.hand ?? s.booster?.hand ?? [];
  const ids = (): number[] =>
    r.shuffle([...pool, ...(r.next() < 0.2 ? [9999, -1, pool[0] ?? 0] : [])]).slice(0, r.int(0, 6));
  const uids = [...s.jokers.map((j) => j.uid), ...s.consumables.map((c) => c.uid)];
  const uid = (): number => (uids.length > 0 && r.next() < 0.8 ? r.pick(uids) : r.int(0, 300));
  switch (type) {
    case 'play':
    case 'discard':
    case 'reorderHand':
      return { type, cardIds: ids() };
    case 'sortHand':
      return { type, by: r.next() < 0.5 ? 'rank' : 'suit' };
    case 'buy':
    case 'buyBooster':
    case 'buyVoucher':
      return { type, slot: r.int(-1, 4) };
    case 'buyAndUse':
      return { type, slot: r.int(-1, 4), targetIds: ids() };
    case 'pickBooster':
      return { type, index: r.int(-1, 4), targetIds: ids(), keep: r.next() < 0.3 };
    case 'sellJoker':
    case 'sellConsumable':
      return { type, uid: uid() };
    case 'useConsumable':
      return { type, uid: uid(), targetIds: ids() };
    case 'reorderJokers':
      return { type, uids: r.shuffle(s.jokers.map((j) => j.uid)).slice(0, r.next() < 0.8 ? 99 : 1) };
    default:
      return { type } as Action;
  }
}

describe('náhodné akce: neplatná akce nic nedoručí, uložení před akcí dá stejný výsledek', () => {
  for (const [label, registry, deckId] of REGISTRIES) {
    it(
      label,
      () => {
        let valid = 0;
        let invalid = 0;
        for (let run = 1; run <= 6; run++) {
          const r = rngFromState(cyrb128(`FUZZ:${label}:${run}`));
          const game = Game.newRun({ seed: `FUZZ${run}`, deckId, stake: 1 + (run % 8) }, registry);
          const bot = createBot('max');
          const delivered: GameEvent[] = [];
          game.bus.onAny((e) => delivered.push(e));
          for (let step = 0; step < 300 && game.state.phase !== 'game_over'; step++) {
            if (game.state.phase === 'victory') game.dispatch({ type: 'continueEndless' });
            // Polovina akcí od bota (aby run postupoval fázemi), polovina náhodných.
            const action = r.next() < 0.5 ? randomAction(game, r) : bot.decide(game);
            const before = JSON.stringify(game.state);
            const loaded = Game.fromState(deserializeRun(serializeRun(game.state)), registry);
            delivered.length = 0;
            const res = game.dispatch(action);
            const ctx = `${label} run ${run} krok ${step}: ${JSON.stringify(action)}`;
            expect(loaded.dispatch(action), ctx).toEqual(res);
            expect(JSON.stringify(loaded.state), ctx).toBe(JSON.stringify(game.state));
            if (res.ok) {
              valid++;
              expect(delivered, ctx).toEqual(res.events);
            } else {
              invalid++;
              expect(JSON.stringify(game.state), ctx).toBe(before);
              expect(delivered, ctx).toEqual([]);
            }
          }
        }
        expect(valid).toBeGreaterThan(60);
        expect(invalid).toBeGreaterThan(60);
      },
      60_000,
    );
  }
});

// ─────────────────────────── scripts/simulate: --json ───────────────────────────

describe('scripts/simulate: --json', () => {
  const base = ['--runs', '2', '--bot', 'random'];

  it('„--json -“ = stdout, „--json=soubor“ = soubor', () => {
    const dash = parseCli([...base, '--json', '-'], contentReg);
    expect(dash.mode === 'sim' && dash.sim.json).toBe('-');
    const eq = parseCli([...base, '--json=out.json'], contentReg);
    expect(eq.mode === 'sim' && eq.sim.json).toBe('out.json');
    const bare = parseCli([...base, '--json'], contentReg);
    expect(bare.mode === 'sim' && bare.sim.json).toBe('-');
  });

  it('JSON výstup nezávisí na tom, kam se zapisuje', () => {
    const toFile = parseCli([...base, '--json', 'a.json'], contentReg);
    const toStdout = parseCli([...base, '--json'], contentReg);
    if (toFile.mode !== 'sim' || toStdout.mode !== 'sim') throw new Error('mode');
    const a = reportJson(runSimulation(toFile.sim, contentReg));
    const b = reportJson(runSimulation(toStdout.sim, contentReg));
    expect(a).toBe(b);
    expect(a).not.toContain('a.json');
  });
});
