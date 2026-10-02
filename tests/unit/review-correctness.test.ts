/**
 * Adversariální revize enginu (fáze 1) — správnost vůči specifikaci (CLAUDE.md kap. 3, docs/ARCHITECTURE.md 2.5–2.7,
 * docs/DESIGN.md kap. 2–3 a příloha B). Každý test dokládá jeden nález revize; před opravou padal.
 */
import { describe, expect, it } from 'vitest';
import { ENHANCEMENTS } from '../../src/content/modifiers';
import { MSG } from '../../src/engine/constants';
import { createCard } from '../../src/engine/cards/cards';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { exactHandTypes } from '../../src/engine/hands/detect';
import { boss, joker, makeGame, makeRegistry, play, selectBoss, setupRound } from './fixtures/registry';

// ─────────────────────────── Dočasné debuffy karet z `round.flags` (příloha B) ───────────────────────────

/**
 * Šéf ve stylu Černé kočky (DESIGN 8.2 #7): po zahrané ruce / zahození „prokleje“ karty v ruce. Prokletí ukládá do
 * `round.flags.cursed` a `isCardDebuffed` ho čte — přesně podle přílohy B DESIGN („uloženo v round.flags,
 * isCardDebuffed je čte“).
 */
const cursedIds = (flags: Record<string, unknown>): number[] =>
  Array.isArray(flags.cursed) ? (flags.cursed as number[]) : [];

const curseReg = () =>
  makeRegistry({
    bosses: [
      boss('cat', {
        hooks: {
          // Prokleje všechny karty, které zůstaly v ruce.
          afterHandPlayed: (ctx) => {
            ctx.round.flags.cursed = [...cursedIds(ctx.round.flags), ...ctx.held.map((c) => c.id)];
          },
          isCardDebuffed: (ctx, card) => cursedIds(ctx.round.flags).includes(card.id),
        },
      }),
      boss('discard_cat', {
        hooks: {
          // Zahození prokleje první kartu, která v ruce zůstala.
          onDiscard: (ctx) => {
            const left = ctx.round.hand.filter((id) => !ctx.discarded.some((c) => c.id === id));
            ctx.round.flags.cursed = [...cursedIds(ctx.round.flags), left[0]!];
          },
          isCardDebuffed: (ctx, card) => cursedIds(ctx.round.flags).includes(card.id),
        },
      }),
      boss('suit_oracle', {
        hooks: {
          // Na začátku kola „vyvěští“ barvu (♥) do flags — debuffnuté jsou karty té barvy.
          onRoundStart: (ctx) => {
            ctx.round.flags.suit = 'H';
          },
          isCardDebuffed: (ctx, card) => ctx.round.flags.suit === card.suit,
        },
      }),
      boss('late_shift', {
        // Pravidlo závislé na průběhu kola, bez afterHandPlayed: po první ruce jsou piky debuffnuté.
        hooks: { isCardDebuffed: (ctx, card) => ctx.round.handsPlayed > 0 && card.suit === 'S' },
      }),
    ],
  });

describe('dočasné debuffy karet z round.flags (DESIGN příloha B, Černá kočka)', () => {
  it('karty, které šéf po ruce prokleje, jsou debuffnuté už v ruce a v další ruce nic nedají', () => {
    const game = makeGame({ registry: curseReg() });
    selectBoss(game, 'cat');
    const [a, k, steel] = setupRound(game, 'AS KH QS:steel');
    play(game, [a!]);
    // K♥ a ocelová Q♠ zůstaly v ruce → prokleté.
    expect(game.card(k!.id)!.debuffed).toBe(true);
    expect(game.card(steel!.id)!.debuffed).toBe(true);
    const { result } = play(game, [k!]);
    expect(result.steps.find((s) => s.cardId === k!.id)).toMatchObject({ message: MSG.debuffed });
    // Prokletá K nedá čipy, prokletá ocelová v ruce ×1,5 také ne.
    expect(result.steps.some((s) => s.cardId === steel!.id)).toBe(false);
    expect(result.score).toBe(6 * 1);
  });

  it('prokletí při zahození (onDiscard) platí hned pro karty v ruce', () => {
    const game = makeGame({ registry: curseReg() });
    selectBoss(game, 'discard_cat');
    const [x, a] = setupRound(game, '2C AS');
    expect(game.dispatch({ type: 'discard', cardIds: [x!.id] }).ok).toBe(true);
    expect(game.card(a!.id)!.debuffed).toBe(true);
  });

  it('pravidlo závislé na průběhu kola se přepočítá po každé ruce (i bez afterHandPlayed)', () => {
    const game = makeGame({ registry: curseReg() });
    selectBoss(game, 'late_shift');
    const [a, spade] = setupRound(game, 'AH KS');
    expect(game.card(spade!.id)!.debuffed).toBe(false);
    play(game, [a!]);
    expect(game.card(spade!.id)!.debuffed).toBe(true);
  });

  it('pravidlo vylosované v onRoundStart platí pro celý balíček, nejen pro líznuté karty', () => {
    const game = makeGame({ registry: curseReg() });
    selectBoss(game, 'suit_oracle');
    const round = game.state.round!;
    const hearts = game.state.deck.filter((c) => c.suit === 'H');
    expect(hearts.length).toBeGreaterThan(0);
    // Debuff odpovídá pravidlu u všech karet — v ruce i v dobíracím balíčku (UI ukazuje zbylé karty balíčku).
    for (const c of game.state.deck) expect(c.debuffed, `${c.rank}${c.suit}`).toBe(c.suit === 'H');
    expect(round.hand.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────── Pozice žolíka po zničení jiného žolíka ───────────────────────────

describe('JokerCtx.index je aktuální pozice i po zničení žolíka během průchodu (ARCHITECTURE 2.7)', () => {
  /** Žolík, který se při zahrání ruky / skórování karty sám zničí (jako Sněhulák, když roztaje). */
  const reg = makeRegistry({
    jokers: [
      joker('melter', {
        hooks: { onHandPlayed: (ctx) => void ctx.api.destroyJoker(ctx.self.uid, 'melted') },
      }),
      joker('card_melter', {
        hooks: { onCardScored: (ctx) => void ctx.api.destroyJoker(ctx.self.uid, 'melted') },
      }),
    ],
  });

  it('krok 4: kopírující „souseda vlevo“ za zničeným žolíkem kopíruje skutečného souseda', () => {
    const game = makeGame({ registry: reg, jokers: ['plus_mult', 'melter', 'copier_left'], round: true });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['plus_mult', 'copier_left']);
    // Vysoká karta 6 + 11 čipů; mult 1 + 4 (plus_mult) + 4 (kopie plus_mult).
    expect(result.score).toBe(17 * 9);
  });

  it('eachJoker (onCardScored): kopírující za zničeným žolíkem kopíruje skutečného souseda', () => {
    const game = makeGame({
      registry: reg,
      jokers: ['card_chips', 'card_melter', 'copier_left'],
      round: true,
    });
    const [a] = setupRound(game, 'AS');
    const { result } = play(game, [a!]);
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['card_chips', 'copier_left']);
    // 6 + 11 + 3 (card_chips) + 3 (kopie card_chips) = 23 čipů × 1.
    expect(result.score).toBe(23);
  });
});

// ─────────────────────────── destroyCard jen u skórující karty ───────────────────────────

describe('EffectResult.destroyCard platí jen pro efekty skórující karty (content-types.ts)', () => {
  const reg = makeRegistry({
    jokers: [
      joker('held_breaker', { hooks: { onCardHeld: () => ({ mult: 1, destroyCard: true }) } }),
      joker('scored_breaker', { hooks: { onCardScored: () => ({ destroyCard: true }) } }),
    ],
  });

  it('onCardHeld s destroyCard kartu v ruce nezničí (efekt multu ale platí)', () => {
    const game = makeGame({ registry: reg, jokers: ['held_breaker'], round: true });
    const [a, q] = setupRound(game, 'AS QH');
    const { result } = play(game, [a!]);
    expect(result.destroyedCardIds).toEqual([]);
    expect(game.card(q!.id)).toBeDefined();
    expect(result.score).toBe(17 * 2);
  });

  it('onCardScored s destroyCard skórující kartu po ruce zničí (beze změny)', () => {
    const game = makeGame({ registry: reg, jokers: ['scored_breaker'], round: true });
    const [a] = setupRound(game, 'AS QH');
    const { result } = play(game, [a!]);
    expect(result.destroyedCardIds).toEqual([a!.id]);
    expect(game.card(a!.id)).toBeUndefined();
  });
});

// ─────────────────────────── exactHandTypes a kamenné karty ───────────────────────────

describe('exactHandTypes: kamenná karta nepatří do žádné kombinace (DESIGN 2.2.2)', () => {
  const opts = {
    mods: BASE_MODIFIERS,
    enhancements: Object.fromEntries(ENHANCEMENTS.map((e) => [e.id, e])),
  };

  it('Dvojice s kamennou kartou „stejné hodnoty“ není Dvojice', () => {
    const k = createCard(1, { suit: 'H', rank: 13 });
    const stoneK = createCard(2, { suit: 'S', rank: 13, enhancement: 'stone' });
    expect(exactHandTypes([k, createCard(3, { suit: 'D', rank: 13 })], opts)).toEqual(['pair']);
    expect(exactHandTypes([k, stoneK], opts)).toEqual([]);
    expect(exactHandTypes([stoneK], opts)).toEqual([]);
  });

  it('bez platných vylepšení (Bílá hora) má kamenná karta hodnotu', () => {
    const k = createCard(1, { suit: 'H', rank: 13 });
    const stoneK = createCard(2, { suit: 'S', rank: 13, enhancement: 'stone' });
    expect(exactHandTypes([k, stoneK], { mods: BASE_MODIFIERS, enhancements: {} })).toEqual(['pair']);
  });
});
