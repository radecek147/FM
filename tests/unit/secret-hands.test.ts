/**
 * Tajné kombinace end-to-end se skutečným obsahem hry (docs/DESIGN.md kap. 2.2.4): detekce (i s divokými kartami),
 * relace „obsahuje“, objev v runu (`RunState.discoveredHands`, událost `handDiscovered`), pranostiky tajných
 * kombinací ve Večerce, obálkách a náhodném vytváření až po objevu, úrovně jen přes „všechny kombinace“,
 * uložení a načtení. UI („???“ v Info o runu) testuje tests/unit/ui-game.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import type { GameEvent, HandType, RunState } from '../../src/engine/types';
import { HAND_TYPES } from '../../src/engine/types';
import { play, selectBoss, setupRound, winNextHand } from './fixtures/registry';

const reg = buildRegistry();
const SECRET: readonly HandType[] = ['five', 'flush_house', 'flush_five'];

/** Pranostika dané kombinace ve skutečném obsahu. */
function pranostikaFor(hand: HandType): string {
  const def = Object.values(reg.consumables).find((d) => d.kind === 'pranostika' && d.hand === hand);
  if (!def) throw new Error(`no pranostika for ${hand}`);
  return def.id;
}
const SECRET_PRANOSTIKY = SECRET.map(pranostikaFor);

function newGame(seed: string, deckId = 'pub'): Game {
  return Game.newRun({ seed, deckId, stake: 1 }, reg);
}

/** Zahraje ruku `hand` (zápis jako v fixtures) v kole s nedosažitelným cílem a vrátí výsledek a události. */
function playHand(g: Game, hand: string) {
  const cards = setupRound(g, hand);
  g._core.state.round!.target = 1e12;
  return play(g, cards);
}

/** Vyhraje aktuální útratu jednou kartou a přejde do Večerky. */
function toShop(g: Game): void {
  if (g.state.phase === 'blind_select') g.dispatch({ type: 'selectBlind' });
  winNextHand(g);
  g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
  g.dispatch({ type: 'cashOut' });
  expect(g.state.phase).toBe('shop');
}

/** Id spotřebek, které Večerka nabídla během `rerolls` přehození (peníze dodá test). */
function shopConsumables(g: Game, rerolls: number): string[] {
  const seen: string[] = [];
  const collect = () => {
    for (const it of g.state.shop!.items) if (it.kind === 'consumable') seen.push(it.consumable.defId);
  };
  collect();
  for (let i = 0; i < rerolls; i++) {
    g._core.state.money = 1000;
    const res = g.dispatch({ type: 'reroll' });
    if (!res.ok) throw new Error(`reroll: ${res.error}`);
    collect();
  }
  return seen;
}

/** Id pranostik nabídnutých ve `count` otevřených mega obálkách pranostik. */
function boosterPranostiky(g: Game, count: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < count; i++) {
    g.startBooster('pranostika_mega', 'blind_select');
    for (const o of g.state.booster!.options) if (o.kind === 'consumable') seen.push(o.consumable.defId);
    const res = g.dispatch({ type: 'skipBooster' });
    if (!res.ok) throw new Error(`skipBooster: ${res.error}`);
  }
  return seen;
}

describe('tajné kombinace – obsah a detekce', () => {
  it('tajné jsou právě Pětice, Barevný full house a Barevná pětice a každá má svou pranostiku', () => {
    expect(HAND_TYPES.filter((h) => reg.handTypes[h].secret)).toEqual(SECRET);
    expect(SECRET_PRANOSTIKY).toEqual(['candlemas', 'catherine_ice', 'lucy_night']);
  });

  it.each([
    ['five', 'KS KH KD KC KS', ['five', 'four', 'three', 'pair']],
    ['five', 'KS KH:wild KD:wild KC KS', null],
    ['five', 'KS KH KD KC KD:wild', ['five', 'four', 'three', 'pair']],
    ['flush_house', 'KH KH KH 5H 5H', ['flush_house', 'full_house', 'flush', 'three', 'two_pair', 'pair']],
    ['flush_house', 'KH KS:wild KH 5H 5C:wild', null],
    ['flush_five', 'AH AH AH AH AH', ['flush_five', 'five', 'flush', 'four', 'three', 'pair']],
    ['flush_five', 'AH AS:wild AH AC:wild AH', null],
  ] as const)('%s: %s', (type, hand, contains) => {
    const g = newGame('SECRETDETECT');
    const { result } = playHand(g, hand);
    expect(result.hand.type).toBe(type);
    expect(result.hand.scoringIds).toHaveLength(5);
    if (contains) expect([...result.hand.contains].sort()).toEqual([...contains].sort());
  });

  it('divoká karta s jinou hodnotou Pětici nedělá (mění jen barvu)', () => {
    const g = newGame('SECRETWILD');
    expect(playHand(g, 'KS KH KD KC 9D:wild').result.hand.type).toBe('four');
  });
});

describe('tajné kombinace – objev v runu', () => {
  it('první zahrání zapíše objev a vyvolá handDiscovered jednou; běžná kombinace se zapíše bez události', () => {
    const g = newGame('SECRETFIND');
    expect(g.state.discoveredHands).toEqual([]);
    const pair = playHand(g, 'QS QH');
    expect(g.state.discoveredHands).toEqual(['pair']);
    expect(pair.events.some((e) => e.type === 'handDiscovered')).toBe(false);

    const first = playHand(g, 'KS KH KD KC KS');
    expect(first.events.filter((e) => e.type === 'handDiscovered')).toEqual([
      { type: 'handDiscovered', hand: 'five' },
    ]);
    expect(g.state.discoveredHands).toEqual(['pair', 'five']);
    const again = playHand(g, '7S 7H 7D 7C 7S');
    expect(again.events.some((e) => e.type === 'handDiscovered')).toBe(false);
    expect(g.state.discoveredHands).toEqual(['pair', 'five']);
    expect(g.state.handLevels.five.played).toBe(2);
    // Pětice obsahuje Čtveřici, ale objevená je jen vyhodnocená kombinace.
    expect(g.state.discoveredHands).not.toContain('four');
  });

  it('objev přežije uložení a načtení (a s ním i nabídka pranostiky)', () => {
    const g = newGame('SECRETSAVE');
    playHand(g, 'AH AH AH AH AH');
    const loaded = Game.fromState(deserializeRun(serializeRun(g.state as RunState)), reg);
    expect(loaded.state.discoveredHands).toEqual(['flush_five']);
    const made = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = loaded._core.api.createConsumable({ kind: 'pranostika', ignoreSlots: true });
      if (c) made.add(c.defId);
    }
    expect(made.has('lucy_night')).toBe(true);
    expect(made.has('candlemas')).toBe(false);
    expect(made.has('catherine_ice')).toBe(false);
  });

  it('nový run začíná bez objevů (objev v runu se nepřenáší)', () => {
    const g = newGame('SECRETNEW');
    playHand(g, 'KS KH KD KC KS');
    expect(newGame('SECRETNEW').state.discoveredHands).toEqual([]);
  });
});

describe('tajné kombinace – pranostiky až po objevu', () => {
  it('Večerka: bez objevu žádná tajná pranostika, po zahrání Pětice jen Na Hromnice', () => {
    // Úřednický balíček má Trhací kalendář — pranostik je v nabídce víc.
    const hidden = newGame('SECRETSHOP', 'clerk');
    toShop(hidden);
    const before = shopConsumables(hidden, 150);
    const pranostiky = before.filter((id) => reg.consumables[id]!.kind === 'pranostika');
    expect(pranostiky.length).toBeGreaterThan(40);
    expect(pranostiky.filter((id) => SECRET_PRANOSTIKY.includes(id))).toEqual([]);

    const found = newGame('SECRETSHOP', 'clerk');
    found.dispatch({ type: 'selectBlind' });
    const cards = setupRound(found, 'KS KH KD KC KS');
    winNextHand(found);
    const { events } = play(found, cards);
    expect(events).toContainEqual({ type: 'handDiscovered', hand: 'five' });
    found.dispatch({ type: 'cashOut' });
    const after = shopConsumables(found, 150);
    expect(after).toContain('candlemas');
    expect(after).not.toContain('catherine_ice');
    expect(after).not.toContain('lucy_night');
  });

  it('obálky pranostik: tajné až po objevu', () => {
    const g = newGame('SECRETPACK');
    expect(boosterPranostiky(g, 40).filter((id) => SECRET_PRANOSTIKY.includes(id))).toEqual([]);
    g._core.state.discoveredHands.push('flush_house');
    const after = boosterPranostiky(g, 40);
    expect(after).toContain('catherine_ice');
    expect(after).not.toContain('candlemas');
    expect(after).not.toContain('lucy_night');
  });

  it('náhodné vytvoření (babské rady, pečetě, žolíci) losuje tajné až po objevu', () => {
    const g = newGame('SECRETMAKE');
    const draw = () =>
      Array.from(
        { length: 300 },
        () => g._core.api.createConsumable({ kind: 'pranostika', ignoreSlots: true })!.defId,
      );
    expect(draw().filter((id) => SECRET_PRANOSTIKY.includes(id))).toEqual([]);
    for (const h of SECRET) g._core.state.discoveredHands.push(h);
    expect(new Set(draw())).toEqual(
      new Set(
        Object.values(reg.consumables)
          .filter((d) => d.kind === 'pranostika')
          .map((d) => d.id),
      ),
    );
  });

  it('Kalendářový: po porážce šéfa pranostika tajné kombinace, když ji hráč hraje nejčastěji', () => {
    const g = newGame('SECRETALMANAC', 'almanac');
    playHand(g, 'KS KH KD KC KS');
    playHand(g, '7S 7H 7D 7C 7S');
    // Malou útratu (zbývají ruce) dohrajeme jednou kartou, pak šéf bez pravidla.
    expect(g.state.phase).toBe('round');
    g._core.state.round!.target = 1;
    g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
    g.dispatch({ type: 'cashOut' });
    g.dispatch({ type: 'leaveShop' });
    selectBoss(g, 'binder_tower');
    const cards = setupRound(g, 'KS');
    winNextHand(g);
    const events: GameEvent[] = play(g, cards).events;
    expect(events.some((e) => e.type === 'bossDefeated')).toBe(true);
    expect(g.state.consumables.map((c) => c.defId)).toEqual(['candlemas']);
  });
});

describe('tajné kombinace – úrovně', () => {
  it('běžná pranostika tajnou kombinaci nezvýší; Úřední hodiny („všechny kombinace“) ano, i bez objevu', () => {
    const g = newGame('SECRETLEVEL');
    const before = Object.fromEntries(SECRET.map((h) => [h, g.state.handLevels[h].level]));
    g._core.api.levelUpHand('four', 1);
    for (const h of SECRET) expect(g.state.handLevels[h].level).toBe(before[h]);
    const c = g._core.api.createConsumable({ defId: 'office_hours' })!;
    const res = g.dispatch({ type: 'useConsumable', uid: c.uid, targetIds: [] });
    expect(res.ok).toBe(true);
    for (const h of SECRET) expect(g.state.handLevels[h].level).toBe(before[h]! + 2);
    expect(g.state.discoveredHands).toEqual([]);
  });
});
