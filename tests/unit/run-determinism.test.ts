/**
 * Determinismus celého runu (CLAUDE.md kap. 2 a 8, ARCHITECTURE 2.2): testovací bot (`fixtures/bot.ts`) hraje první
 * platné akce od prvního patra až do konce runu. Stejný seed ⇒ stejné akce, události i stav (JSON) na konci; jiný
 * seed ⇒ jiný run; uložení a načtení uprostřed (i po každé akci) ⇒ stejný konec.
 */
import { describe, expect, it } from 'vitest';
import type { ContentRegistry } from '../../src/engine/content-types';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { runBot } from './fixtures/bot';
import { ART, makeGame, makeRegistry } from './fixtures/registry';

/** Testovací obsah + balíček se sníženými cíli (run projde několik pater, Večerky a šéfy). */
function registry(targetMult: number): ContentRegistry {
  return makeRegistry({ decks: [{ id: 'easy', passive: () => ({ targetMult }), art: ART }] });
}

function fullRun(seed: string, targetMult = 0.2) {
  const reg = registry(targetMult);
  const run = runBot(makeGame({ registry: reg, deckId: 'easy', seed, jokers: ['late_train'] }));
  return { ...run, json: JSON.stringify(run.game.state), reg };
}

describe('celý run botem', () => {
  it('stejný seed ⇒ stejné akce, události i stav na konci', () => {
    const a = fullRun('DETERM01');
    const b = fullRun('DETERM01');
    expect(a.game.state.phase).toBe('game_over');
    // Run je netriviální: několik pater, Večerky, obálky, prodej.
    expect(a.game.state.ante).toBeGreaterThanOrEqual(3);
    const kinds = new Set(a.actions.map((x) => x.type));
    for (const k of ['selectBlind', 'play', 'discard', 'cashOut', 'buy', 'leaveShop', 'skipBlind'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(b.actions).toEqual(a.actions);
    expect(b.events).toEqual(a.events);
    expect(b.json).toBe(a.json);
  });

  it('jiný seed ⇒ jiný run', () => {
    const a = fullRun('DETERM01');
    const b = fullRun('DETERM02');
    expect(b.json).not.toBe(a.json);
    expect(b.game.state.seed).not.toBe(a.game.state.seed);
    expect(b.events).not.toEqual(a.events);
  });

  it('uložit a načíst uprostřed runu ⇒ stejný konec', () => {
    const reference = fullRun('DETERM03');
    const half = Math.floor(reference.steps / 2);
    const reg = reference.reg;
    const run = runBot(
      makeGame({ registry: reg, deckId: 'easy', seed: 'DETERM03', jokers: ['late_train'] }),
      {
        between: (game, step) =>
          step === half ? Game.fromState(deserializeRun(serializeRun(game.state)), reg) : game,
      },
    );
    expect(run.actions).toEqual(reference.actions);
    expect(run.events).toEqual(reference.events);
    expect(JSON.stringify(run.game.state)).toBe(reference.json);
  });

  it('uložit a načíst po každé akci ⇒ stejný konec', () => {
    const reference = fullRun('DETERM04');
    const reg = reference.reg;
    const run = runBot(
      makeGame({ registry: reg, deckId: 'easy', seed: 'DETERM04', jokers: ['late_train'] }),
      {
        between: (game) => Game.fromState(deserializeRun(serializeRun(game.state)), reg),
      },
    );
    expect(run.actions).toEqual(reference.actions);
    expect(JSON.stringify(run.game.state)).toBe(reference.json);
  });

  it('dotazy UI mezi akcemi (náhled, modifikátory, canUse, sellValue) run nezmění', () => {
    const reference = fullRun('DETERM05');
    const reg = reference.reg;
    const run = runBot(
      makeGame({ registry: reg, deckId: 'easy', seed: 'DETERM05', jokers: ['late_train'] }),
      {
        between: (game) => {
          const s = game.state;
          game.modifiers();
          if (s.round) game.preview(s.round.hand.slice(0, 5));
          for (const c of s.consumables) game.canUseConsumable(c.uid, s.round?.hand.slice(0, 1) ?? []);
          for (const j of s.jokers) game.sellValue(j.uid);
          return game;
        },
      },
    );
    expect(JSON.stringify(run.game.state)).toBe(reference.json);
  });

  it('výhra v patře 8 → nekonečný režim → konec; deterministicky', () => {
    const a = fullRun('ENDLESS1', 1e-4);
    const b = fullRun('ENDLESS1', 1e-4);
    expect(a.actions.some((x) => x.type === 'continueEndless')).toBe(true);
    expect(a.events.filter((e) => e.type === 'victory')).toHaveLength(1);
    expect(a.events.some((e) => e.type === 'endlessStarted')).toBe(true);
    expect(a.game.state.endless).toBe(true);
    expect(a.game.state.ante).toBeGreaterThan(8);
    expect(a.game.state.phase).toBe('game_over');
    expect(b.json).toBe(a.json);
  });
});
