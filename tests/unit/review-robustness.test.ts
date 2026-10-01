/**
 * Adversariální revize enginu (fáze 1) — robustnost a determinismus. Každý `describe` dokládá jeden nalezený
 * problém; testy před opravou selhaly (viz docs/DECISIONS.md, záznam „Revize robustnosti enginu“).
 */
import { describe, expect, it } from 'vitest';
import type { Modifiers, RunState } from '../../src/engine/types';
import { cyrb128, rngFromState } from '../../src/engine/rng/rng';
import { Game } from '../../src/engine/run/game';
import { pickConsumableDefId } from '../../src/engine/shop/pool';
import { generateShopBoosters } from '../../src/engine/shop/shop';
import {
  boss,
  booster,
  consumable,
  joker,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  winNextHand,
} from './fixtures/registry';

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Cesty k číslům, která JSON nepřežijí (NaN, ±nekonečno) — uložený stav by se po načtení změnil. */
function nonJsonNumbers(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path}=${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => nonJsonNumbers(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) nonJsonNumbers(v, `${path}.${k}`, out);
  }
  return out;
}

/**
 * Spustí `fn` tak, jako by běžel v prohlížeči s českým prostředím: `localeCompare` bez locale pak řadí podle
 * češtiny („ch“ až za „h“). Engine nesmí na prostředí záviset — stejný seed musí dát stejný run všude.
 */
function withCzechCollation<T>(fn: () => T): T {
  const proto = String.prototype as { localeCompare: (that: string, ...rest: unknown[]) => number };
  const original = proto.localeCompare;
  proto.localeCompare = function (this: string, that: string) {
    return original.call(this, that, 'cs');
  };
  try {
    return fn();
  } finally {
    proto.localeCompare = original;
  }
}

describe('determinismus nezávislý na locale prostředí', () => {
  it('čeština v Node opravdu řadí „ch“ za „h“ (předpoklad testu)', () => {
    expect('chata'.localeCompare('hrnek', 'en')).toBeLessThan(0);
    expect('chata'.localeCompare('hrnek', 'cs')).toBeGreaterThan(0);
  });

  it('losování spotřebek a obálek dá v českém prostředí stejný výsledek jako jinde', () => {
    const reg = makeRegistry({
      consumables: [consumable('chata'), consumable('hrnek')],
      boosters: [booster('chalupa_pack'), booster('hospoda_pack')],
    });
    const run = () => {
      const game = makeGame({ registry: reg, seed: 'LOCALE01' });
      const core = game._core;
      const rng = rngFromState(cyrb128('locale'));
      const picks = Array.from({ length: 40 }, () => pickConsumableDefId(core, rng, 'rada'));
      const boosters = Array.from({ length: 10 }, () => generateShopBoosters(core).map((b) => b.boosterId));
      return { picks, boosters, rng: core.state.rng };
    };
    const plain = run();
    expect(withCzechCollation(run)).toEqual(plain);
  });
});

describe('cache modifikátorů', () => {
  it('změna objektu z mods() / api.modifiers() neprosákne do pravidel', () => {
    const game = makeGame({ round: true });
    const core = game._core;
    const m = core.api.modifiers() as Modifiers;
    try {
      m.hands = 99;
      m.handSize = 20;
    } catch {
      // Zmrazený objekt hodí TypeError — i to je v pořádku, hlavně že se pravidla nezmění.
    }
    expect(game.modifiers().hands).toBe(4);
    expect(core.mods().handSize).toBe(8);
  });

  it('šéf změní stav, na kterém závisí jeho passive — dobírání hned použije novou velikost ruky', () => {
    // „Za každou zahozenou ♥ o kartu menší ruka“: hasSuit načte modifikátory dřív, než hook změní flags.
    const shrinker = boss('shrinker', {
      hooks: {
        passive: (ctx) => ({ handSize: -num(ctx.round.flags.shrink) }),
        onDiscard: (ctx) => {
          for (const c of ctx.discarded)
            if (ctx.api.hasSuit(c, 'H')) ctx.round.flags.shrink = num(ctx.round.flags.shrink) + 1;
        },
      },
    });
    const game = makeGame({ registry: makeRegistry({ bosses: [shrinker] }) });
    selectBoss(game, 'shrinker');
    const cards = setupRound(game, '2H 3H 4S 5S 6S 7S 8S 9S');
    const res = game.dispatch({ type: 'discard', cardIds: [cards[0]!.id, cards[1]!.id] });
    expect(res.ok).toBe(true);
    expect(game.modifiers().handSize).toBe(6);
    expect(game.state.round!.hand).toHaveLength(6);
  });

  it('změna stavu žolíka v hooku platí pro další žolíky ve stejném průchodu', () => {
    const seen: number[] = [];
    const grower = joker('grower', {
      initState: () => ({ extra: 0 }),
      hooks: {
        passive: (ctx) => ({ handSize: num(ctx.self.state.extra) }),
        onBlindSelect: (ctx) => {
          void ctx.mods.handSize;
          ctx.self.state.extra = 2;
        },
      },
    });
    const reader = joker('reader', { hooks: { onBlindSelect: (ctx) => void seen.push(ctx.mods.handSize) } });
    const game = makeGame({
      registry: makeRegistry({ jokers: [grower, reader] }),
      jokers: ['grower', 'reader'],
    });
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    expect(seen).toEqual([10]);
  });
});

describe('pozice žolíků, když se řada mění během průchodu', () => {
  const kamikaze = joker('kamikaze', {
    hooks: { onHandPlayed: (ctx) => void ctx.api.destroyJoker(ctx.self.uid, 'test') },
  });

  it('kopírující žolík kopíruje skutečného souseda, i když se žolík vlevo od něj právě zničil', () => {
    const reg = makeRegistry({ jokers: [kamikaze] });
    const score = (ids: string[]) => {
      const game = makeGame({ registry: reg, jokers: ids, round: true });
      return play(game, setupRound(game, 'KS')).result;
    };
    const ref = score(['copier', 'plus_mult', 'times_mult']);
    const withKamikaze = score(['kamikaze', 'copier', 'plus_mult', 'times_mult']);
    expect(withKamikaze.mult).toBe(ref.mult);
    expect(withKamikaze.score).toBe(ref.score);
  });

  it('hook (eachJoker) dostane aktuální pozici žolíka v `ctx.index`', () => {
    const positions: [number, number][] = [];
    const where = joker('where', {
      hooks: {
        onRoundStart: (ctx) =>
          void positions.push([ctx.index, ctx.state.jokers.findIndex((j) => j.uid === ctx.self.uid)]),
      },
    });
    const boom = joker('boom', { hooks: { onRoundStart: (ctx) => ctx.api.destroyJoker(ctx.self.uid, 'x') } });
    makeGame({ registry: makeRegistry({ jokers: [where, boom] }), jokers: ['boom', 'where'], round: true });
    expect(positions).toEqual([[0, 0]]);
  });
});

describe('výjimka z obsahu uprostřed akce', () => {
  it('nenechá stav napůl změněný (rollback jako u neplatné akce) a výjimku propustí dál', () => {
    const broken = joker('broken', {
      hooks: {
        onRoundStart: () => {
          throw new Error('chyba v obsahu');
        },
      },
    });
    const game = makeGame({ registry: makeRegistry({ jokers: [broken] }), jokers: ['broken'] });
    const before = JSON.stringify(game.state);
    expect(() => game.dispatch({ type: 'selectBlind' })).toThrow('chyba v obsahu');
    expect(JSON.stringify(game.state)).toBe(before);
    // Další akce nedostane události z neúspěšné akce.
    game._core.state.jokers = [];
    const res = game.dispatch({ type: 'selectBlind' });
    expect(res.ok && res.events.filter((e) => e.type === 'blindSelected')).toHaveLength(1);
  });
});

describe('neplatná čísla z obsahu nerozbijí uložitelný stav', () => {
  it('příkazy API ignorují NaN a nekonečno', () => {
    const game = makeGame({ round: true });
    const api = game._core.api;
    api.addHands(Infinity);
    api.addDiscards(Infinity);
    api.addRoundHandSize(Infinity);
    api.changeAnte(Infinity);
    api.levelUpHand('pair', Infinity);
    api.levelUpAll(-Infinity);
    api.addPermanentModifier({ hands: Infinity, handSize: NaN, targetMult: Infinity });
    expect(nonJsonNumbers(game.state)).toEqual([]);
    expect(nonJsonNumbers(game.modifiers())).toEqual([]);
    const r = game.state.round!;
    expect([r.handsLeft, r.discardsLeft, game.state.ante, game.state.handLevels.pair.level]).toEqual([
      4, 3, 1, 1,
    ]);
  });

  it('úroveň kombinace zůstává celé číslo', () => {
    const game = makeGame();
    game._core.api.levelUpHand('pair', 1.5);
    expect(game.state.handLevels.pair.level).toBe(2);
  });

  it('peníze nepřetečou do nekonečna', () => {
    const game = makeGame();
    game._core.api.addMoney(Number.MAX_VALUE, 'test');
    game._core.api.addMoney(Number.MAX_VALUE, 'test');
    expect(nonJsonNumbers(game.state)).toEqual([]);
    expect(game.state.money).toBe(Number.MAX_VALUE);
  });

  it('passive s NaN / nekonečnem nezkazí modifikátory ani stav kola', () => {
    const bad = joker('bad', {
      hooks: {
        passive: () => ({ hands: NaN, discards: Infinity, handSize: -Infinity, probabilityMult: NaN }),
      },
    });
    const game = makeGame({ registry: makeRegistry({ jokers: [bad] }), jokers: ['bad'], round: true });
    expect(game.modifiers()).toMatchObject({ hands: 4, discards: 3, handSize: 8, probabilityMult: 1 });
    expect(game.state.round!.hand).toHaveLength(8);
    expect(nonJsonNumbers(game.state)).toEqual([]);
  });

  it('NaN / nekonečno z roundEndMoney neotráví rozpis odměn', () => {
    const reg = makeRegistry({
      jokers: [
        joker('nan_cash', { hooks: { roundEndMoney: () => NaN } }),
        joker('inf_cash', { hooks: { roundEndMoney: () => Infinity } }),
      ],
    });
    const game = makeGame({ registry: reg, jokers: ['nan_cash', 'inf_cash', 'round_cash'], round: true });
    winNextHand(game);
    play(game, setupRound(game, 'KS'));
    expect(game.state.phase).toBe('round_end');
    expect(nonJsonNumbers(game.state)).toEqual([]);
    const jokerMoney = game.state.rewards!.extra.filter((e) => e.source.startsWith('joker:'));
    expect(jokerMoney.map((e) => e.amount)).toEqual([2]);
  });

  it('šéf vrátí z modifyBase NaN — základ zůstane původní', () => {
    const broken = boss('broken_base', { hooks: { modifyBase: () => ({ chips: NaN, mult: NaN }) } });
    const game = makeGame({ registry: makeRegistry({ bosses: [broken] }) });
    selectBoss(game, 'broken_base');
    const cards = setupRound(game, 'KS');
    const { baseChips, baseMult } = game.registry.handTypes.high_card;
    expect(game.preview([cards[0]!.id])).toMatchObject({ chips: baseChips, mult: baseMult });
    const { result } = play(game, cards);
    expect(nonJsonNumbers(result)).toEqual([]);
    expect(result.score).toBe((baseChips + 10) * baseMult);
  });
});

describe('prázdný balíček a prázdná ruka', () => {
  it('kolo bez jediné karty skončí prohrou z nedostatku karet místo zaseknutí', () => {
    const game = makeGame();
    game._core.state.deck = [];
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    expect(game.state.phase).toBe('game_over');
  });

  it('spotřebka, která zničí poslední karty v ruce (dobírací balíček prázdný), ukončí kolo', () => {
    const shredder = consumable('shredder', {
      target: { min: 1, max: 5 },
      use: (ctx) => {
        for (const c of ctx.targets) ctx.api.destroyCard(c.id, 'test');
      },
    });
    const game = makeGame({ registry: makeRegistry({ consumables: [shredder] }), round: true });
    const core = game._core;
    const cards = setupRound(game, 'KS QS');
    core.state.round!.drawPile = [];
    core.state.consumables.push({ uid: core.uid(), defId: 'shredder', edition: null });
    const uid = core.state.consumables[0]!.uid;
    const res = game.dispatch({ type: 'useConsumable', uid, targetIds: cards.map((c) => c.id) });
    expect(res.ok).toBe(true);
    expect(game.state.phase).toBe('game_over');
  });

  it('spotřebka, která zničí celou ruku (v balíčku karty jsou), ruku dobere — kolo neuvázne bez karet', () => {
    const shredder = consumable('shredder', {
      target: { min: 1, max: 5 },
      use: (ctx) => {
        for (const c of ctx.targets) ctx.api.destroyCard(c.id, 'test');
      },
    });
    const game = makeGame({ registry: makeRegistry({ consumables: [shredder] }), round: true });
    const core = game._core;
    const cards = setupRound(game, 'KS QS');
    expect(core.state.round!.drawPile.length).toBeGreaterThan(0);
    core.state.consumables.push({ uid: core.uid(), defId: 'shredder', edition: null });
    const uid = core.state.consumables[0]!.uid;
    expect(game.dispatch({ type: 'useConsumable', uid, targetIds: cards.map((c) => c.id) }).ok).toBe(true);
    expect(game.state.phase).toBe('round');
    expect(game.state.round!.hand).toHaveLength(8);
  });

  it('karta zničená během skórování nezůstane v hromádkách kola jako neexistující id', () => {
    const eater = joker('eater', {
      hooks: { onCardScored: (ctx) => void ctx.api.destroyCard(ctx.card.id, 'test') },
    });
    const game = makeGame({ registry: makeRegistry({ jokers: [eater] }), jokers: ['eater'], round: true });
    play(game, setupRound(game, 'KS KH'));
    const r = game.state.round!;
    const ids = new Set(game.state.deck.map((c) => c.id));
    const missing = [...r.hand, ...r.drawPile, ...r.discardPile, ...r.playedPile].filter(
      (id) => !ids.has(id),
    );
    expect(missing).toEqual([]);
  });
});

describe('neznámý obsah a okrajové výsledky hooků', () => {
  it('žolík s neznámým id (obsah odebraný od uložení) hru neshodí — chová se jako prázdný', () => {
    const game = makeGame({ jokers: ['plus_mult'], round: true });
    const core = game._core;
    core.state.jokers.unshift({
      uid: core.uid(),
      defId: 'ghost',
      edition: null,
      state: {},
      sellBonus: 0,
      stickers: [],
      debuffed: false,
    });
    winNextHand(game);
    const { result } = play(game, setupRound(game, 'KS'));
    expect(result.mult).toBe(5);
    expect(game.state.phase).toBe('round_end');
  });

  it('hook vrátí pole s prázdnými položkami (JS obsah) — ty se přeskočí', () => {
    const sparse = joker('sparse', {
      hooks: { onHandPlayed: () => [null, { mult: 2 }, undefined] as unknown as { mult: number }[] },
    });
    const game = makeGame({ registry: makeRegistry({ jokers: [sparse] }), jokers: ['sparse'], round: true });
    const { result } = play(game, setupRound(game, 'KS'));
    expect(result.mult).toBe(3);
  });

  it('nekonečná rekurze hooků (onCardAdded přidá kartu) engine nezacyklí', () => {
    const breeder = joker('breeder', {
      hooks: { onCardAdded: (ctx) => void ctx.api.addCard({ suit: 'S', rank: 2 }) },
    });
    const game = makeGame({ registry: makeRegistry({ jokers: [breeder] }), jokers: ['breeder'] });
    const before = game.state.deck.length;
    expect(() => game._core.api.addCard({ suit: 'H', rank: 3 })).not.toThrow();
    const added = game.state.deck.length - before;
    expect(added).toBeGreaterThan(1);
    expect(added).toBeLessThanOrEqual(10);
  });
});

describe('sdílené objekty', () => {
  it('stav runu nesdílí `unlockedPool` s volajícím (profil)', () => {
    const pool = { jokers: ['plus_mult'], vouchers: null, boosters: null };
    const game = Game.newRun({ seed: 'POOL', deckId: 'test', stake: 1, unlockedPool: pool }, makeRegistry());
    pool.jokers.push('times_mult');
    expect(game.state.unlockedPool.jokers).toEqual(['plus_mult']);
  });

  it('initState vracející pořád stejný objekt nespojí stav dvou instancí', () => {
    const shared = { hands: 0 };
    const leaky = joker('leaky', {
      initState: () => shared,
      hooks: { afterHandScored: (ctx) => void (ctx.self.state.hands = num(ctx.self.state.hands) + 1) },
    });
    const game = makeGame({
      registry: makeRegistry({ jokers: [leaky] }),
      jokers: ['leaky', 'leaky'],
      round: true,
    });
    play(game, setupRound(game, 'KS'));
    expect(game.state.jokers.map((j) => j.state.hands)).toEqual([1, 1]);
    expect(shared.hands).toBe(0);
  });
});

describe('dotazy (náhled, modifikátory, canUse) nemění stav', () => {
  it('náhled ruky nespotřebuje náhodu šéfa (modifyBase s ctx.chance)', () => {
    const gambler = boss('gambler', {
      hooks: {
        modifyBase: (ctx, base) => (ctx.chance(1, 2) ? { chips: base.chips, mult: base.mult * 2 } : base),
      },
    });
    const game = makeGame({ registry: makeRegistry({ bosses: [gambler] }) });
    selectBoss(game, 'gambler');
    const before = JSON.stringify(game.state);
    const ids = game.state.round!.hand.slice(0, 2);
    for (let i = 0; i < 5; i++) game.preview(ids);
    expect(JSON.stringify(game.state)).toBe(before);
  });

  it('passive s ctx.chance neposouvá RNG při čtení modifikátorů', () => {
    const flaky = joker('flaky', { hooks: { passive: (ctx) => ({ handSize: ctx.chance(1, 2) ? 1 : 0 }) } });
    const game = makeGame({ registry: makeRegistry({ jokers: [flaky] }), jokers: ['flaky'], round: true });
    const before = JSON.stringify(game.state);
    for (let i = 0; i < 5; i++) {
      game._core.invalidate();
      game.modifiers();
    }
    expect(JSON.stringify(game.state)).toBe(before);
  });

  it('canUseConsumable nespotřebuje náhodu', () => {
    const coin = consumable('coin', { canUse: (ctx) => ctx.chance(1, 2) });
    const game = makeGame({ registry: makeRegistry({ consumables: [coin] }), round: true });
    const core = game._core;
    core.state.consumables.push({ uid: core.uid(), defId: 'coin', edition: null });
    const before = JSON.stringify(game.state);
    for (let i = 0; i < 5; i++) game.canUseConsumable(core.state.consumables[0]!.uid);
    expect(JSON.stringify(game.state)).toBe(before);
  });
});

describe('vstupy Game.newRun', () => {
  it('seed jen z mezer se odmítne, nečíselná obtížnost spadne na 1', () => {
    expect(() => Game.newRun({ seed: '   ', deckId: 'test', stake: 1 }, makeRegistry())).toThrow();
    const game = Game.newRun({ seed: 'STAKE', deckId: 'test', stake: NaN }, makeRegistry());
    expect(game.state.stake).toBe(1);
  });
});

describe('starší uložení s chybějícím nebo odebraným obsahem', () => {
  it('přeskočení útraty se štítkem, který registr nezná, nespadne', () => {
    const game = makeGame();
    game._core.state.blinds[0]!.skipTagId = 'ghost_tag';
    const res = game.dispatch({ type: 'skipBlind' });
    expect(res.ok).toBe(true);
    expect(game.state.blindIndex).toBe(1);
  });

  it('chybějící záznam úrovně kombinace (nová kombinace od uložení) se při zahrání doplní', () => {
    const game = makeGame({ round: true });
    delete (game._core.state.handLevels as Partial<RunState['handLevels']>).high_card;
    const { result } = play(game, setupRound(game, 'KS'));
    expect(result.hand.type).toBe('high_card');
    expect(game.state.handLevels.high_card).toEqual({ level: 1, played: 1 });
  });
});

describe('události nesdílí objekty se stavem', () => {
  it('posluchač, který si upraví rozpis odměn nebo info o prohře, nezmění stav runu', () => {
    const game = makeGame({ jokers: ['round_cash'], round: true });
    game.bus.on('roundRewards', (e) => {
      e.extra.push({ source: 'ui', amount: 1000 });
      e.extra.sort((a, b) => a.amount - b.amount);
      if (e.extra[0]) e.extra[0].amount = -1;
    });
    winNextHand(game);
    play(game, setupRound(game, 'KS'));
    expect(game.state.rewards!.extra).toEqual([
      { source: 'joker:round_cash', amount: 2, jokerUid: expect.any(Number) },
    ]);

    const lost = makeGame({ round: true });
    lost.bus.on('gameOver', (e) => {
      e.info.score = 1e9;
    });
    lost._core.state.round!.handsLeft = 1;
    play(lost, setupRound(lost, 'KS'));
    expect(lost.state.phase).toBe('game_over');
    expect(lost.state.gameOver!.score).toBeLessThan(1e9);
  });
});
