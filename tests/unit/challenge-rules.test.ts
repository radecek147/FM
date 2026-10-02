/**
 * Obecná pravidla výzev v enginu (docs/DECISIONS.md „Výzvy: pravidla v enginu“, docs/ARCHITECTURE.md): nové
 * `Modifiers` (`noJokers`, `noSkip`, `autoSkip`, `noReroll`, `flatShopPrice`, `flatSellPrice`, `handCost`,
 * `discardCost`, `glassBreakOdds`, `finalAnte`) a pole/hooky `ChallengeDef` (`stake`, `startingHandLevels`,
 * `startingRandomJokers`, `maxScoringHand`, `jokerSticker`, `banned*`, `consumableCost`, `passive`, `onAnteStart`,
 * `isCardDebuffed`, `isJokerDebuffed`). Testuje se na malém testovacím registru — konkrétní výzvy hlídá
 * tests/unit/challenges.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ChallengeDef, ContentRegistry } from '../../src/engine/content-types';
import { FINAL_ANTE, MSG } from '../../src/engine/constants';
import { isFinalAnte } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import { generateShop } from '../../src/engine/shop/shop';
import type { ActionResult, GameEvent } from '../../src/engine/types';
import {
  ART,
  addJokers,
  booster,
  consumable,
  joker,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  tag,
  winNextHand,
} from './fixtures/registry';

function ok(res: ActionResult): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

function challenge(id: string, extra: Partial<ChallengeDef> = {}): ChallengeDef {
  return { id, deckId: 'test', art: ART, ...extra };
}

/** Registr s jedinou výzvou `c` (a volitelně dalším obsahem). */
function regWith(c: ChallengeDef, more: Parameters<typeof makeRegistry>[0] = {}): ContentRegistry {
  return makeRegistry({ ...more, challenges: [c] });
}

function gameWith(c: ChallengeDef, more: Parameters<typeof makeRegistry>[0] = {}, seed?: string): Game {
  return makeGame({ registry: regWith(c, more), challengeId: c.id, ...(seed ? { seed } : {}) });
}

/** Otevře Večerku přímo (fáze shop, čerstvá nabídka). */
function openShop(game: Game, money = 100): void {
  const core = game._core;
  core.state.money = money;
  core.state.phase = 'shop';
  core.state.shop = generateShop(core);
}

/** Vyhraje běžící kolo a vyplatí odměnu (→ Večerka). */
function winAndCashOut(game: Game): void {
  winNextHand(game);
  ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
  ok(game.dispatch({ type: 'cashOut' }));
}

// ─────────────────────────── Start runu ───────────────────────────

describe('výzva: start runu', () => {
  it('určuje balíček i sílu piva (výchozí Desítka), `NewRunOptions` je přebít nemůže', () => {
    const reg = makeRegistry({
      decks: [{ id: 'other', startingMoney: 9, art: ART }],
      stakes: [
        { id: 'tenner', level: 1, art: ART },
        { id: 'eleven', level: 2, art: ART },
      ],
      challenges: [challenge('plain', { deckId: 'other' }), challenge('hard', { stake: 2 })],
    });
    const g = makeGame({ registry: reg, challengeId: 'plain', deckId: 'test', stake: 2 });
    expect([g.state.deckId, g.state.stake, g.state.money]).toEqual(['other', 1, 9]);
    const h = makeGame({ registry: reg, challengeId: 'hard', stake: 1 });
    expect(h.state.stake).toBe(2);
    // Bez výzvy platí volba hráče.
    expect(makeGame({ registry: reg, stake: 2 }).state.stake).toBe(2);
  });

  it('startovní úrovně kombinací (celé číslo ≥ 1) bez událostí', () => {
    const g = gameWith(challenge('levels', { startingHandLevels: { pair: 6, flush: 2.7, three: -3 } }));
    expect(g.state.handLevels.pair.level).toBe(6);
    expect(g.state.handLevels.flush.level).toBe(2);
    expect(g.state.handLevels.three.level).toBe(1);
    expect(g.state.handLevels.high_card.level).toBe(1);
  });

  it('náhodní startovní žolíci: z celého registru (i neodemčení), bez opakování, se zadanými nálepkami, deterministicky', () => {
    const c = challenge('bang', {
      startingRandomJokers: [{ rarity: 'rare', count: 2, stickers: ['eternal'] }],
    });
    const reg = regWith(c, {
      jokers: [
        joker('rare_two', { rarity: 'rare' }),
        joker('rare_three', { rarity: 'rare' }),
        joker('rare_fragile', { rarity: 'rare', noEternal: true }),
      ],
    });
    const run = (seed: string) =>
      makeGame({ registry: reg, challengeId: 'bang', seed }).state.jokers.map((j) => [j.defId, j.stickers]);
    const a = run('SEED-A');
    expect(a).toHaveLength(2);
    expect(new Set(a.map(([id]) => id)).size).toBe(2);
    for (const [id, stickers] of a) {
      expect(['rare_one', 'rare_two', 'rare_three']).toContain(id);
      expect(stickers).toEqual(['eternal']);
    }
    expect(run('SEED-A')).toEqual(a);
    // Odemčení (`unlockedPool`) startovní žolíky výzvy neomezuje.
    const pooled = Game.newRun(
      {
        seed: 'TESTSEED',
        deckId: 'test',
        stake: 1,
        challengeId: 'bang',
        unlockedPool: { jokers: [], vouchers: null, boosters: null },
      },
      reg,
    );
    expect(pooled.state.jokers).toHaveLength(2);
    // Legendární (`noShop`) jdou vyžádat výslovně.
    const leg = gameWith(challenge('leg', { startingRandomJokers: [{ rarity: 'legendary', count: 3 }] }));
    expect(leg.state.jokers.map((j) => j.defId)).toEqual(['legend']);
  });
});

// ─────────────────────────── Žolíci ───────────────────────────

describe('Modifiers.noJokers', () => {
  const c = challenge('dry', { extraModifiers: { noJokers: true } });

  it('Večerka ani obálky žolíky nenabízí, Žolíková obálka se neprodává ani neotevře', () => {
    const g = gameWith(c);
    for (let i = 0; i < 20; i++) {
      openShop(g);
      expect(g.state.shop!.items.some((it) => it.kind === 'joker')).toBe(false);
      expect(g.state.shop!.boosters.some((b) => b.boosterId === 'joker_pack')).toBe(false);
    }
    expect(g._core.api.openBooster('joker_pack')).toBe(false);
    expect(g._core.api.openBooster('rada_pack')).toBe(true);
  });

  it('`createJoker` (i s `defId`) ani `addShopJoker` nic nevytvoří, `availableJokers` je prázdné', () => {
    const g = gameWith(c);
    expect(g._core.api.createJoker()).toBeNull();
    expect(g._core.api.createJoker({ defId: 'noop', ignoreSlots: true })).toBeNull();
    expect(g._core.api.availableJokers()).toEqual([]);
    openShop(g);
    expect(g._core.api.addShopJoker()).toBe(false);
    expect(g.state.jokers).toEqual([]);
  });
});

describe('ChallengeDef.jokerSticker', () => {
  const reg = makeRegistry({
    jokers: [joker('no_rent', { noRental: true })],
    challenges: [challenge('rent', { jokerSticker: 'rental' })],
  });

  it('každý žolík z Večerky, obálky i efektu má vynucenou nálepku; kdo ji nesmí mít, neobjeví se', () => {
    const g = makeGame({ registry: reg, challengeId: 'rent' });
    for (let i = 0; i < 20; i++) {
      openShop(g);
      for (const it of g.state.shop!.items) {
        if (it.kind !== 'joker') continue;
        expect(it.joker.stickers).toEqual(['rental']);
        expect(it.joker.defId).not.toBe('no_rent');
      }
    }
    g.startBooster('joker_pack', 'blind_select');
    for (const o of g.state.booster!.options)
      if (o.kind === 'joker') expect(o.joker.stickers).toEqual(['rental']);
    ok(g.dispatch({ type: 'skipBooster' }));
    expect(g._core.api.availableJokers()).not.toContain('no_rent');
    const made = g._core.api.createJoker({ defId: 'noop', stickers: ['eternal'] });
    expect(made?.stickers).toEqual(['rental']);
  });
});

// ─────────────────────────── Útraty ───────────────────────────

describe('Modifiers.noSkip a autoSkip', () => {
  it('noSkip: přeskočení se odmítne a útraty nemají štítky', () => {
    const g = gameWith(challenge('exp', { extraModifiers: { noSkip: true } }));
    expect(g.state.blinds.map((b) => b.skipTagId)).toEqual([null, null, null]);
    expect(g.dispatch({ type: 'skipBlind' })).toEqual({ ok: false, error: 'cannotSkip' });
  });

  it('autoSkip: Malá i Velká se přeskočí samy se štítky, i po porážce šéfa; obálka ze štítku přeruší řadu', () => {
    const reg = regWith(challenge('boss_only', { extraModifiers: { autoSkip: true } }), {
      tags: [
        tag('cash_tag', {
          onAdded: (ctx) => {
            ctx.api.addMoney(5, 'tag');
            return true;
          },
        }),
      ],
    });
    // Jen štítek s penězi — obálky neruší.
    const onlyCash = { ...reg, tags: { cash_tag: reg.tags.cash_tag! } };
    const g = makeGame({ registry: onlyCash, challengeId: 'boss_only' });
    expect(g.state.blindIndex).toBe(2);
    expect(g.state.blinds.map((b) => b.status)).toEqual(['skipped', 'skipped', 'current']);
    expect(g.state.stats.blindsSkipped).toBe(2);
    expect(g.state.money).toBe(5 + 10);
    ok(g.dispatch({ type: 'selectBlind' }));
    winAndCashOut(g);
    ok(g.dispatch({ type: 'leaveShop' }));
    expect([g.state.ante, g.state.blindIndex, g.state.stats.blindsSkipped]).toEqual([2, 2, 4]);

    // Štítek s obálkou: po přeskočení Malé se otevře obálka, po jejím zavření se přeskočí Velká.
    const withPack = {
      ...reg,
      tags: {
        pack: tag('pack', {
          onAdded: (ctx) => {
            ctx.api.openBooster('rada_pack');
            return true;
          },
        }),
      },
    };
    const p = makeGame({ registry: withPack, challengeId: 'boss_only' });
    expect([p.state.phase, p.state.blindIndex]).toEqual(['booster', 1]);
    ok(p.dispatch({ type: 'skipBooster' }));
    expect([p.state.phase, p.state.blindIndex]).toEqual(['booster', 2]);
    ok(p.dispatch({ type: 'skipBooster' }));
    expect([p.state.phase, p.state.blindIndex]).toEqual(['blind_select', 2]);
  });
});

// ─────────────────────────── Večerka ───────────────────────────

describe('Modifiers.noReroll, flatShopPrice, flatSellPrice; ChallengeDef.consumableCost', () => {
  it('noReroll: přehození se odmítne, i bezplatné', () => {
    const g = gameWith(challenge('exp', { extraModifiers: { noReroll: true } }));
    openShop(g);
    g._core.state.shop!.freeRerolls = 2;
    expect(g.dispatch({ type: 'reroll' })).toEqual({ ok: false, error: 'cannotUse' });
  });

  it('pevná cena všeho ve Večerce (vč. přehození, bez slev), zdarma zůstává zdarma; pevná prodejní cena', () => {
    const c = challenge('flat', {
      extraModifiers: { flatShopPrice: 5, flatSellPrice: 2, shopDiscountPct: 50 },
      startingConsumables: ['stamp'],
    });
    const g = gameWith(c, { vouchers: [{ id: 'v1', tier: 1, cost: 10, art: ART }] });
    addJokers(g, [{ id: 'epic_one' }, { id: 'noop', stickers: ['rental'] }]);
    openShop(g);
    const shop = g.state.shop!;
    for (const it of shop.items) expect(it.price).toBe(5);
    for (const b of shop.boosters) expect(b.price).toBe(5);
    expect(shop.vouchers.map((v) => [v.voucherId, v.price])).toEqual([['v1', 5]]);
    expect(shop.rerollCost).toBe(5);
    ok(g.dispatch({ type: 'reroll' }));
    expect(g.state.shop!.rerollCost).toBe(5);
    for (const j of g.state.jokers) expect(g.sellValue(j.uid)).toBe(2);
    expect(g.sellValue(g.state.consumables[0]!.uid)).toBe(2);
    g._core.state.shop!.items[0]!.free = true;
    ok(g.dispatch({ type: 'reorderJokers', uids: g.state.jokers.map((j) => j.uid) }));
    expect(g.state.shop!.items[0]!.price).toBe(0);
  });

  it('pevná cena spotřebek podle druhu (pranostika 1 Kč); prodej = polovina, nejmíň 1 Kč', () => {
    const g = gameWith(challenge('cheap', { consumableCost: { pranostika: 1 } }));
    const core = g._core;
    core.api.createConsumable({ defId: 'pr_pair' });
    core.api.createConsumable({ defId: 'rada_a' });
    const [pr, rada] = g.state.consumables;
    expect(g.sellValue(pr!.uid)).toBe(1);
    expect(g.sellValue(rada!.uid)).toBe(2);
    for (let i = 0; i < 30; i++) {
      openShop(g);
      for (const it of g.state.shop!.items) {
        if (it.kind === 'consumable' && it.consumableKind === 'pranostika') expect(it.price).toBe(1);
        if (it.kind === 'consumable' && it.consumableKind === 'rada') expect(it.price).toBe(4);
      }
    }
  });
});

describe('ChallengeDef.banned* (obálky, spotřebky, štítky)', () => {
  it('vyřazený druh spotřebky: ve Večerce, v obálkách ani z efektů; obálka toho druhu se neprodá ani neotevře', () => {
    const g = gameWith(challenge('quarry', { bannedConsumableKinds: ['rada'] }), {
      jokers: [],
    });
    for (let i = 0; i < 30; i++) {
      openShop(g);
      for (const it of g.state.shop!.items)
        if (it.kind === 'consumable') expect(it.consumableKind).not.toBe('rada');
      expect(g.state.shop!.boosters.some((b) => b.boosterId === 'rada_pack')).toBe(false);
    }
    expect(g._core.api.createConsumable({ kind: 'rada' })).toBeNull();
    expect(g._core.api.createConsumable({ defId: 'rada_a' })).toBeNull();
    expect(g._core.api.openBooster('rada_pack')).toBe(false);
    expect(g._core.api.createConsumable({ defId: 'stamp' })?.defId).toBe('stamp');
  });

  it('zakázaná spotřebka a zakázaný druh obálky', () => {
    const g = gameWith(challenge('ban', { bannedConsumables: ['rada_a'], bannedBoosterKinds: ['joker'] }));
    expect(g._core.api.createConsumable({ defId: 'rada_a' })).toBeNull();
    for (let i = 0; i < 20; i++)
      expect(g._core.api.createConsumable({ kind: 'rada', ignoreSlots: true })?.defId).toBe('rada_b');
    expect(g._core.api.openBooster('joker_pack')).toBe(false);
    for (let i = 0; i < 10; i++) {
      openShop(g);
      expect(g.state.shop!.boosters.every((b) => b.boosterId === 'rada_pack')).toBe(true);
    }
  });

  it('zakázané štítky se za přeskočení nenabízejí', () => {
    const g = gameWith(challenge('tags', { bannedTags: ['cash_tag', 'sick_note', 'lazy_tag'] }));
    for (let ante = 1; ante <= 6; ante++) {
      const [small, big] = g.state.blinds;
      expect([small!.skipTagId, big!.skipTagId]).toEqual(['extra_hand', 'extra_hand']);
      selectBoss(g, 'wall');
      winAndCashOut(g);
      ok(g.dispatch({ type: 'leaveShop' }));
    }
  });
});

// ─────────────────────────── Kolo ───────────────────────────

describe('Modifiers.handCost a discardCost', () => {
  const c = challenge('fees', {
    startingMoney: 3,
    extraModifiers: { handCost: 1, discardCost: 1, debtLimit: 2 },
  });

  it('každá ruka i zahození stojí; srážka jen do dluhového limitu, hrát jde dál', () => {
    const g = gameWith(c);
    const cards = setupRound(g, '2S 3S 4D 5D 7C 9H JH KC');
    ok(g.dispatch({ type: 'discard', cardIds: [cards[0]!.id] }));
    expect(g.state.money).toBe(2);
    play(g, [cards[1]!]);
    expect(g.state.money).toBe(1);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    play(g, [g.state.round!.hand[0]!]);
    expect(g.state.money).toBe(-1);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(-2);
    play(g, [g.state.round!.hand[0]!]);
    expect(g.state.money).toBe(-2);
  });
});

describe('ChallengeDef.maxScoringHand', () => {
  const c = challenge('svejk', { maxScoringHand: 'pair' });

  it('silnější kombinace se spotřebuje a dá 0 bodů (i v náhledu), Dvojice a Vysoká karta skórují', () => {
    const g = gameWith(c);
    const cards = setupRound(g, '9S 9H 5D 5C 2S KH QD 7C');
    const twoPair = cards.slice(0, 4);
    expect(g.preview(twoPair.map((x) => x.id)).blockedReason).toBe(MSG.challengeHandTooStrong);
    expect(g.preview([cards[0]!.id, cards[1]!.id]).blockedReason).toBeUndefined();
    const { result } = play(g, twoPair);
    expect([result.hand.type, result.score, result.blockedReason]).toEqual([
      'two_pair',
      0,
      MSG.challengeHandTooStrong,
    ]);
    expect(result.steps[0]).toMatchObject({
      source: 'challenge',
      defId: 'svejk',
      message: MSG.challengeHandTooStrong,
    });
    expect(g.state.round!.handsLeft).toBe(3);
    const pair = setupRound(g, 'AS AH');
    expect(play(g, pair).result.score).toBeGreaterThan(0);
  });
});

describe('ChallengeDef.isCardDebuffed a isJokerDebuffed', () => {
  it('pravidlo karet platí ve všech útratách a vypnutí šéfa ho neruší', () => {
    const c = challenge('season', {
      isCardDebuffed: (ctx, card) => ctx.state.ante === 1 && card.suit === 'H',
    });
    const g = gameWith(c);
    const cards = setupRound(g, '5H 5S');
    expect(g.state.round!.blind).toBe('small');
    expect(cards.map((x) => x.debuffed)).toEqual([true, false]);
    const drawn = g.state.round!.drawPile.map((id) => g.card(id)!);
    expect(drawn.filter((x) => x.suit === 'H').every((x) => x.debuffed)).toBe(true);
    g._core.api.disableBoss();
    expect(g.card(cards[0]!.id)!.debuffed).toBe(true);
    // Patro 2: pravidlo neplatí.
    winAndCashOut(g);
    ok(g.dispatch({ type: 'leaveShop' }));
    g._core.api.changeAnte(1);
    const next = setupRound(g, '5H');
    expect(next[0]!.debuffed).toBe(false);
  });

  it('pravidlo žolíků (první ruka kola) platí i po vypnutí šéfa a po přeřazení', () => {
    const c = challenge('candle', { isJokerDebuffed: (ctx) => ctx.round.handsPlayed === 0 });
    const g = gameWith(c);
    addJokers(g, ['plus_mult', 'coaster']);
    const cards = setupRound(g, '2S 3S 4D 5D 7C 9H JH KC');
    ok(g.dispatch({ type: 'reorderJokers', uids: g.state.jokers.map((j) => j.uid).reverse() }));
    expect(g.state.jokers.every((j) => j.debuffed)).toBe(true);
    selectBossDisable(g);
    expect(g.state.jokers.every((j) => j.debuffed)).toBe(true);
    const first = play(g, [cards[0]!]).result;
    expect(first.steps.some((s) => s.source === 'joker')).toBe(false);
    expect(g.state.jokers.every((j) => !j.debuffed)).toBe(true);
    const second = play(g, [g.state.round!.hand[0]!]).result;
    expect(new Set(second.steps.filter((s) => s.source === 'joker').map((s) => s.defId))).toEqual(
      new Set(['plus_mult', 'coaster']),
    );
  });
});

/** Vypne šéfa (i když žádný není) a pošle akci, aby se pravidla přepočítala. */
function selectBossDisable(g: Game): void {
  g._core.api.disableBoss();
  g._core.clearJokerDebuffs();
  ok(g.dispatch({ type: 'reorderJokers', uids: g.state.jokers.map((j) => j.uid) }));
}

// ─────────────────────────── Patra ───────────────────────────

describe('ChallengeDef.onAnteStart a passive', () => {
  it('onAnteStart běží na startu (patro 1, po onRunStart) a po každé porážce šéfa, ne při posunu patra efektem', () => {
    const log: string[] = [];
    const c = challenge('memory', {
      onRunStart: () => void log.push('start'),
      onAnteStart: (ctx) => void log.push(`ante${ctx.ante}`),
    });
    const g = gameWith(c);
    expect(log).toEqual(['start', 'ante1']);
    selectBoss(g, 'wall');
    winAndCashOut(g);
    expect(log).toEqual(['start', 'ante1', 'ante2']);
    g._core.api.changeAnte(1);
    expect(log).toEqual(['start', 'ante1', 'ante2']);
  });

  it('passive výzvy se skládá do modifikátorů', () => {
    const g = gameWith(challenge('pass', { passive: (ctx) => ({ hands: ctx.state.ante }) }));
    expect(g.modifiers().hands).toBe(5);
    g._core.api.changeAnte(2);
    g._core.invalidate();
    expect(g.modifiers().hands).toBe(7);
  });
});

describe('Modifiers.finalAnte', () => {
  it('finálový šéf v patře 8 i v patře výhry; výhra až po šéfovi patra výhry', () => {
    expect(isFinalAnte(12, 12)).toBe(true);
    expect(isFinalAnte(8, 12)).toBe(true);
    expect([9, 10, 11, 13].some((a) => isFinalAnte(a, 12))).toBe(false);
    expect(isFinalAnte(16, 12)).toBe(true);
    const g = gameWith(challenge('long', { extraModifiers: { finalAnte: 4 } }));
    expect(g.modifiers().finalAnte).toBe(FINAL_ANTE + 4);
    g._core.api.changeAnte(7);
    expect(g.state.blinds[2]!.bossId).toBe('final_boss');
    selectBoss(g, 'final_boss');
    winNextHand(g);
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.phase).toBe('round_end');
    ok(g.dispatch({ type: 'cashOut' }));
    ok(g.dispatch({ type: 'leaveShop' }));
    expect(g.state.blinds[2]!.bossId).not.toBe('final_boss');
    g._core.api.changeAnte(12 - g.state.ante);
    expect(g.state.blinds[2]!.bossId).toBe('final_boss');
    selectBoss(g, 'final_boss');
    winNextHand(g);
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.phase).toBe('victory');
  });
});

describe('Modifiers.glassBreakOdds', () => {
  it('skleněná karta praská 1 z `glassBreakOdds` (0 = výchozí 1 z 5) a popisek ukáže stejné číslo', () => {
    const reg = makeRegistry();
    const glass = reg.enhancements.glass!;
    const odds = (override: number): number => {
      let seen = 0;
      glass.afterScored!({
        mods: { glassBreakOdds: override },
        chance: (_n: number, d: number) => {
          seen = d;
          return false;
        },
      } as never);
      return seen;
    };
    expect(odds(0)).toBe(5);
    expect(odds(3)).toBe(3);
    expect(glass.describe!({ glassBreakOdds: 2 })).toEqual({ odds: 2 });
    expect(glass.describe!({})).toEqual({ odds: 5 });
  });
});

describe('výzva bez zvláštních pravidel', () => {
  it('hraje se podle běžných pravidel (Večerka nabízí zboží)', () => {
    const g = gameWith(challenge('empty'), {
      consumables: [consumable('extra_rada')],
      boosters: [booster('b2')],
    });
    openShop(g);
    expect(g.state.shop!.items.length).toBeGreaterThan(0);
  });
});
