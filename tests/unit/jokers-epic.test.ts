/**
 * Epičtí žolíci #26–30 (docs/DESIGN.md kap. 4.7): přesná čísla mechaniky přes skutečné skórování (Game + setupRound +
 * play), hraniční podmínky, stav přes více kol, kopie (`isCopy`) a uložení/načtení. Obsah: src/content/jokers/epic.ts.
 */
import { describe, expect, it } from 'vitest';
import { JOKERS } from '../../src/content/jokers';
import { EPIC_JOKERS } from '../../src/content/jokers/epic';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import type { GameEvent, JokerInstance, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import {
  addJokers,
  boss,
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  setupRound,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Registr: testovací obsah + epičtí žolíci, jediný bezzubý šéf (kola bez vedlejších účinků). */
function registry(): ContentRegistry {
  const reg = makeRegistry({ jokers: EPIC_JOKERS });
  reg.bosses = { calm: boss('calm'), final_boss: boss('final_boss', { final: true }) };
  return reg;
}

function game(jokers: (string | JokerSpec)[] = [], seed?: string): Game {
  return makeGame({ registry: registry(), jokers, ...(seed ? { seed } : {}) });
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Nastaví ruku na `spec` a zahraje prvních `count` karet; kolo se tím nevyhraje ani neprohraje. */
function hand(g: Game, spec: string, count?: number, opts: SetupOptions = {}): ScoreResult {
  const cards = setupRound(g, spec, opts);
  const round = g._core.state.round!;
  round.target = 1e15;
  round.handsLeft = 10;
  return play(g, cards.slice(0, count ?? cards.length)).result;
}

/** Vyhraje běžící (případně právě vybrané) kolo jednou kartou (cíl 1). */
function winRound(g: Game): GameEvent[] {
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
  const round = g._core.state.round!;
  round.target = 1;
  return ok(g.dispatch({ type: 'play', cardIds: [round.hand[0]!] }));
}

/** Po výhře kola: vyplatit a odejít z Večerky (→ výběr útraty). */
function toBlindSelect(g: Game): void {
  ok(g.dispatch({ type: 'cashOut' }));
  ok(g.dispatch({ type: 'leaveShop' }));
}

function nextRound(g: Game): GameEvent[] {
  toBlindSelect(g);
  return ok(g.dispatch({ type: 'selectBlind' }));
}

function reload(g: Game): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)), registry());
}

const jokerSteps = (r: ScoreResult, defId: string) =>
  r.steps.filter((s) => s.source === 'joker' && s.defId === defId);

const def = (id: string): JokerDef => {
  const d = EPIC_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`neznámý žolík ${id}`);
  return d;
};

function descOf(id: string, self?: JokerInstance): string {
  const d = def(id);
  const inst = self ?? newJokerInstance(game()._core, id);
  return t(`jokers.${id}.desc`, { ...d.params, ...d.describe?.(inst) }).replace(/\u00a0/g, ' ');
}

const uidOf = (g: Game, defId: string): number => g.state.jokers.find((j) => j.defId === defId)!.uid;

// Dvojice králů na úrovni 1 = (12 + 10 + 10) čipů × 2 mult = 64 bodů.

// ─────────────────────────── Obsah a texty ───────────────────────────

describe('epičtí žolíci — definice a texty', () => {
  it('id, cena a vzácnost podle DESIGN 4.7', () => {
    expect(EPIC_JOKERS.map((j) => [j.id, j.cost, j.rarity])).toEqual([
      ['snowman', 8, 'epic'],
      ['mushroom_picker', 9, 'epic'],
      ['impersonator', 10, 'epic'],
      ['innkeeper', 8, 'epic'],
      ['grandmas_chest', 8, 'epic'],
    ]);
  });

  it('každý má název (nejvýš 3 slova), popis, flavor a štítky; {param} v popisku se celé dosadí', () => {
    for (const d of EPIC_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${d.id}.${field}`), d.id).toBe(true);
      expect(t(`jokers.${d.id}.name`).split(/\s+/).length, d.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${d.id}.flavor`), d.id).not.toMatch(/^[„"]/);
      expect(d.tags.length, d.id).toBeGreaterThan(0);
      expect(descOf(d.id), d.id).not.toMatch(/[{}]/);
    }
  });

  it('popisky čtou čísla z params a stav z describe', () => {
    expect(descOf('snowman')).toBe('×2,5 mult; po každém kole −×0,25, při ×1 roztaje a zničí se (teď ×2,5).');
    expect(descOf('mushroom_picker')).toBe(
      '×1 mult a navíc +×0,25 za každou hrací kartu zničenou od jeho koupě (teď ×1).',
    );
    expect(descOf('impersonator')).toBe(
      'Při získání bez edice dostane duhovou; v každém kole kopíruje tvého nejdražšího běžného nebo vzácného žolíka.',
    );
    expect(descOf('innkeeper')).toBe('×2,2 mult, dokud se v tomto kole nezahazovalo.');
    expect(descOf('grandmas_chest')).toBe('×1,3 mult za každou spotřebku, kterou držíš ve slotech.');
    const inst = (id: string, state: JokerInstance['state']) => ({
      ...newJokerInstance(game()._core, id),
      state,
    });
    expect(descOf('snowman', inst('snowman', { xmult: 1.75 }))).toContain('(teď ×1,75)');
    expect(descOf('mushroom_picker', inst('mushroom_picker', { destroyed: 3 }))).toContain('(teď ×1,75)');
    expect(hasKey('jokers.snowman.melted')).toBe(true);
  });

  it('nálepky a kopírování: Sněhulák nikdy přibitý, Napodobitel nejde kopírovat', () => {
    expect(def('snowman').noEternal).toBe(true);
    expect(def('impersonator').copyable).toBe(false);
    expect(EPIC_JOKERS.filter((j) => j.copyable === false).map((j) => j.id)).toEqual(['impersonator']);
  });
});

// ─────────────────────────── #26 Sněhulák ───────────────────────────

describe('Sněhulák (snowman)', () => {
  it('×2,5 a po každém kole −×0,25; po 6. kole (×1) roztaje a zničí se', () => {
    const g = game(['snowman']);
    const expected = [2.5, 2.25, 2, 1.75, 1.5, 1.25];
    let lastEvents: GameEvent[] = [];
    expected.forEach((x, i) => {
      if (i > 0) nextRound(g);
      const r = hand(g, 'KS KH');
      expect(jokerSteps(r, 'snowman'), `kolo ${i + 1}`).toMatchObject([{ xmult: x }]);
      expect(r.score, `kolo ${i + 1}`).toBe(Math.floor(32 * 2 * x));
      lastEvents = winRound(g);
      if (i < expected.length - 1) expect(g.state.jokers[0]!.state.xmult).toBe(x - 0.25);
    });
    expect(g.state.jokers).toEqual([]);
    expect(lastEvents).toContainEqual(expect.objectContaining({ type: 'jokerDestroyed', reason: 'melted' }));
    expect(lastEvents).toContainEqual({ type: 'message', key: 'jokers.snowman.melted' });
  });

  it('kopie nemění stav ani nezničí originál', () => {
    const g = game(['copier', { id: 'snowman', state: { xmult: 1.25 } }]);
    // kopie i originál: 32 × 2 × 1,25 × 1,25 = 100
    expect(hand(g, 'KS KH').score).toBe(100);
    winRound(g);
    expect(g.state.jokers.map((j) => j.defId)).toEqual(['copier']);
    const g2 = game(['copier', 'snowman']);
    winRound(g2);
    expect(g2.state.jokers[1]!.state.xmult).toBe(2.25);
  });

  it('přibitý (vynucená nálepka) se zničit nedá: zůstane na ×1 a nic nedělá', () => {
    const g = game([{ id: 'snowman', stickers: ['eternal'], state: { xmult: 1.25 } }]);
    const events = winRound(g);
    expect(g.state.jokers[0]!.state.xmult).toBe(1);
    expect(events.some((e) => e.type === 'message')).toBe(false);
    nextRound(g);
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'snowman')).toEqual([]);
  });

  it('stav přežije uložení a načtení', () => {
    let g = game(['snowman']);
    winRound(g);
    nextRound(g);
    winRound(g);
    g = reload(g);
    expect(g.state.jokers[0]!.state.xmult).toBe(2);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(128);
  });
});

// ─────────────────────────── #27 Sběrač hub ───────────────────────────

describe('Sběrač hub (mushroom_picker)', () => {
  it('bez zničených karet ×1 (nic nedělá)', () => {
    const r = hand(game(['mushroom_picker']), 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'mushroom_picker')).toEqual([]);
  });

  it('+×0,25 za každou zničenou hrací kartu: 2 karty → 32 × 2 × 1,5 = 96', () => {
    const g = game(['mushroom_picker']);
    const [a, b] = g.state.deck;
    g._core.api.destroyCard(a!.id, 'test');
    g._core.api.destroyCard(b!.id, 'test');
    expect(g.state.jokers[0]!.state.destroyed).toBe(2);
    const r = hand(g, 'KS KH');
    expect(jokerSteps(r, 'mushroom_picker')).toMatchObject([{ xmult: 1 + 0.25 * 2 }]);
    expect(r.score).toBe(96);
  });

  it('počítá i prasklé sklo ve skórování (od příští ruky)', () => {
    const g = game(['mushroom_picker']);
    g._core.api.addPermanentModifier({ probabilityMult: 5 }); // sklo praskne jistě (1 z 5 → 5 z 5)
    // Dvojice pětek se skleněnou: (12 + 5 + 5) × 2 × 2 = 88; Sběrač je ještě na ×1
    expect(hand(g, '5H:glass 5S').score).toBe(88);
    expect(g.state.jokers[0]!.state.destroyed).toBe(1);
    expect(hand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.25));
  });

  it('karty zničené před koupí se nepočítají; kopie nepočítá dvakrát; uložení a načtení', () => {
    let g = game(['copier']);
    g._core.api.destroyCard(g.state.deck[0]!.id, 'test');
    addJokers(g, ['mushroom_picker']);
    expect(g.state.jokers[1]!.state.destroyed).toBe(0);
    g._core.api.destroyCard(g.state.deck[0]!.id, 'test');
    expect(g.state.jokers[1]!.state.destroyed).toBe(1);
    g = reload(g);
    // kopie i originál ×1,25: 32 × 2 × 1,25 × 1,25 = 100
    expect(hand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.25 * 1.25));
  });
});

// ─────────────────────────── #28 Napodobitel ───────────────────────────

describe('Napodobitel (impersonator)', () => {
  it('na začátku kola si vybere jiného žolíka a kopíruje ho: +4 (kopie) +4 → 32 × 10 = 320', () => {
    const g = game(['impersonator', 'plus_mult']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'plus_mult'));
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(320);
    // Krok kopie patří Napodobiteli (vlastník slotu), krok originálu žolíkovi +4.
    expect(jokerSteps(r, 'impersonator')).toMatchObject([{ mult: 4 }]);
    expect(jokerSteps(r, 'plus_mult')).toMatchObject([{ mult: 4 }]);
  });

  it('sám (nebo jen s jinými Napodobiteli) nemá koho kopírovat', () => {
    const g = game(['impersonator']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBeNull();
    expect(hand(g, 'KS KH').score).toBe(64);
    const g2 = game(['impersonator', 'impersonator']);
    ok(g2.dispatch({ type: 'selectBlind' }));
    expect(g2.state.jokers.map((j) => j.state.target)).toEqual([null, null]);
  });

  it('vybere nejdražšího (podle prodejní ceny), při shodě toho nejvíc vlevo; během kola cíl nemění', () => {
    // Samé běžné (prodej 2 Kč) → nejlevější.
    const g = game(['impersonator', 'plus_mult', 'times_mult', 'coaster']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'plus_mult'));
    expect(g.state.jokers[0]!.state.round).toBe(g.state.stats.roundsWon);
    // Edice zvedá prodejní cenu: holografický ×2 (prodej (4 + 2) / 2 = 3 Kč) má přednost.
    const g2 = game(['impersonator', 'plus_mult', { id: 'times_mult', edition: 'holo' }]);
    ok(g2.dispatch({ type: 'selectBlind' }));
    expect(g2.state.jokers[0]!.state.target).toBe(uidOf(g2, 'times_mult'));
    // Kopie ×2 (pozice Napodobitele) → +4 → holografický +10 a ×2: 32 × ((2 × 2 + 4 + 10) × 2) = 1152
    expect(hand(g2, 'KS KH').score).toBe(1152);
    expect(hand(g2, 'KS KH').score).toBe(1152);
    expect(g2.state.jokers[0]!.state.target).toBe(uidOf(g2, 'times_mult'));
    // Vzácný (prodej 3 Kč) před běžnými.
    const g3 = game(['impersonator', 'plus_mult', 'rare_one', 'coaster']);
    ok(g3.dispatch({ type: 'selectBlind' }));
    expect(g3.state.jokers[0]!.state.target).toBe(uidOf(g3, 'rare_one'));
  });

  it('na hvězdy nemá: epické a legendární žolíky nekopíruje', () => {
    const g = game(['impersonator', 'epic_one', 'legend', 'plus_mult']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'plus_mult'));
    const g2 = game(['impersonator', 'snowman']);
    ok(g2.dispatch({ type: 'selectBlind' }));
    expect(g2.state.jokers[0]!.state.target).toBeNull();
    // jen originál ×2,5: 32 × 2 × 2,5 = 160
    expect(hand(g2, 'KS KH').score).toBe(160);
  });

  it('cíl se volí v každém kole znovu (po koupi dražšího žolíka kopíruje jeho)', () => {
    const g = game(['impersonator', 'plus_mult']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'plus_mult'));
    addJokers(g, ['rare_one']);
    // V tomto kole beze změny…
    expect(g._core.resolveCopy(g.state.jokers[0]!, 0)?.target.defId).toBe('plus_mult');
    winRound(g);
    nextRound(g);
    // …od dalšího kola vzácný.
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'rare_one'));
  });

  it('při získání bez edice dostane duhovou (×1,5 platí i bez cíle); jinou edici si nechá', () => {
    const g = game();
    const j = g._core.api.createJoker({ defId: 'impersonator' })!;
    expect(j.edition).toBe('poly');
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(j.state.target).toBeNull();
    // Dvojice K × 1,5 (duhová edice vlastníka slotu): 32 × 3 = 96
    expect(hand(g, 'KS KH').score).toBe(96);
    const foil = game()._core.api.createJoker({ defId: 'impersonator', edition: 'foil' })!;
    expect(foil.edition).toBe('foil');
  });

  it('když cíl během kola zmizí, do konce kola nekopíruje nic', () => {
    const g = game(['impersonator', 'plus_mult']);
    ok(g.dispatch({ type: 'selectBlind' }));
    g._core.api.destroyJoker(uidOf(g, 'plus_mult'), 'test');
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(r.steps.filter((s) => s.source === 'joker')).toEqual([]);
  });

  it('kopíruje jen v kole (i v rozpisu na konci kola), ve Večerce ne', () => {
    const g = game(['impersonator', 'plus_mult']);
    winRound(g);
    const imp = () => g.state.jokers[0]!;
    expect(g.state.phase).toBe('round_end');
    expect(g._core.resolveCopy(imp(), 0)?.target.defId).toBe('plus_mult');
    ok(g.dispatch({ type: 'cashOut' }));
    expect(g.state.phase).toBe('shop');
    expect(g._core.resolveCopy(imp(), 0)).toBeNull();
  });

  it('žolík získaný během kola začne kopírovat až od dalšího kola', () => {
    const g = game(['plus_mult']);
    ok(g.dispatch({ type: 'selectBlind' }));
    addJokers(g, ['impersonator']);
    expect(hand(g, 'KS KH').score).toBe(32 * 6);
    winRound(g);
    nextRound(g);
    expect(g.state.jokers[1]!.state.target).toBe(uidOf(g, 'plus_mult'));
    expect(hand(g, 'KS KH').score).toBe(32 * 10);
  });

  it('nekopírovatelné žolíky obsahu hry si nevybírá', () => {
    const reg = registry();
    for (const d of JOKERS) reg.jokers[d.id] = d;
    const others = JOKERS.filter((d) => d.copyable === false && d.id !== 'impersonator').map((d) => d.id);
    const g = makeGame({ registry: reg, jokers: ['impersonator', ...others, 'plus_mult'] });
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBe(uidOf(g, 'plus_mult'));
  });

  it('nekopírovatelné (i mimo obsah hry — ptá se registru) ani zvětralé (debuffnuté) žolíky nevybírá', () => {
    const g = game(['impersonator', 'uncopyable']);
    ok(g.dispatch({ type: 'selectBlind' }));
    expect(g.state.jokers[0]!.state.target).toBeNull();
    expect(hand(g, 'KS KH').score).toBe(32 * 9); // jen originál +7
    const g2 = game(['impersonator', { id: 'plus_mult', debuffed: true }, 'coaster']);
    ok(g2.dispatch({ type: 'selectBlind' }));
    expect(g2.state.jokers[0]!.state.target).toBe(uidOf(g2, 'coaster'));
  });

  it('kopie nemění stav cíle; jiný kopírující žolík Napodobitele nekopíruje', () => {
    const g = game(['impersonator', 'counter']);
    ok(g.dispatch({ type: 'selectBlind' }));
    hand(g, 'KS KH');
    hand(g, 'KS KH');
    expect(g.state.jokers[1]!.state.hands).toBe(2);
    // counter (stav 2) a jeho kopie: 32 × (2 + 2 + 2) = 192
    expect(hand(g, 'KS KH').score).toBe(192);

    // Holografický +4 je dražší než testovací `copier` (ten si v obsahu hry `copyable: false` nese sám).
    const g2 = game(['copier', 'impersonator', { id: 'plus_mult', edition: 'holo' }]);
    ok(g2.dispatch({ type: 'selectBlind' }));
    expect(g2._core.resolveCopy(g2.state.jokers[0]!, 0)).toBeNull();
    // +4 (kopie) + holografická +10 + 4: 32 × 20 = 640
    expect(hand(g2, 'KS KH').score).toBe(640);
  });

  it('cíl přežije uložení a načtení (v kole i před výběrem útraty)', () => {
    const g = game(['impersonator', 'plus_mult', 'times_mult'], 'NAPODOB2');
    ok(g.dispatch({ type: 'selectBlind' }));
    const target = g.state.jokers[0]!.state.target;
    const g2 = reload(g);
    expect(g2.state.jokers[0]!.state.target).toBe(target);
    expect(hand(g2, 'KS KH').score).toBe(hand(g, 'KS KH').score);
    // Před výběrem útraty: načtená hra vybere stejný cíl.
    winRound(g);
    toBlindSelect(g);
    const g3 = reload(g);
    ok(g.dispatch({ type: 'selectBlind' }));
    ok(g3.dispatch({ type: 'selectBlind' }));
    expect(g3.state.jokers[0]!.state.target).toBe(g.state.jokers[0]!.state.target);
  });
});

// ─────────────────────────── #29 Hostinský ───────────────────────────

describe('Hostinský (innkeeper)', () => {
  it('×2,2 mult, dokud se v kole nezahazovalo; po zahození nic; nové kolo zase ×2,2', () => {
    const g = game(['innkeeper']);
    // Dvojice králů: 32 čipů × 2 mult × 2,2 = 140,8 → 140.
    expect(hand(g, 'KS KH').score).toBe(140);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    const r = hand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'innkeeper')).toEqual([]);
    winRound(g);
    nextRound(g);
    expect(hand(g, 'KS KH').score).toBe(140);
  });

  it('zahození efektem (ne hráčem) se nepočítá', () => {
    const g = game(['innkeeper']);
    const cards = setupRound(g, 'KS KH 2C');
    g._core.api.discardFromHand(cards[2]!.id);
    expect(hand(g, 'KS KH').score).toBe(140);
  });
});

// ─────────────────────────── #30 Babiččina truhla ───────────────────────────

describe('Babiččina truhla (grandmas_chest)', () => {
  function withConsumables(n: number): Game {
    const g = game(['grandmas_chest']);
    for (let i = 0; i < n; i++) g._core.api.createConsumable({ defId: 'rada_a', ignoreSlots: true });
    return g;
  }

  it('bez spotřebek nic', () => {
    const r = hand(withConsumables(0), 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'grandmas_chest')).toEqual([]);
  });

  it('×1,3 za každou spotřebku — násobí se: 1 → ×1,3, 2 → ×1,69, 3 → ×2,197', () => {
    expect(hand(withConsumables(1), 'KS KH').score).toBe(Math.floor(32 * 2 * 1.3)); // 83
    const r2 = hand(withConsumables(2), 'KS KH');
    expect(jokerSteps(r2, 'grandmas_chest')).toMatchObject([{ xmult: 1.3 }, { xmult: 1.3 }]);
    expect(r2.score).toBe(Math.floor(32 * 2 * 1.3 * 1.3)); // 108
    expect(hand(withConsumables(3), 'KS KH').score).toBe(Math.floor(32 * 2 * 1.3 * 1.3 * 1.3)); // 140
  });

  it('použitá spotřebka už se nepočítá', () => {
    const g = withConsumables(2);
    ok(g.dispatch({ type: 'useConsumable', uid: g.state.consumables[0]!.uid }));
    expect(hand(g, 'KS KH').score).toBe(83);
  });
});

// ─────────────────────────── Společné ───────────────────────────

describe('epičtí žolíci v celém runu', () => {
  it('stav všech je JSON-bezpečný a hra po načtení pokračuje stejně', () => {
    const a = game([], 'EPICTI01');
    addJokers(
      a,
      EPIC_JOKERS.map((j) => j.id),
    );
    a._core.api.createConsumable({ defId: 'rada_a' });
    const b = reload(a);
    for (const g of [a, b]) ok(g.dispatch({ type: 'selectBlind' }));
    for (let i = 0; i < 4; i++) expect(hand(b, 'KS KH').score).toBe(hand(a, 'KS KH').score);
    winRound(a);
    winRound(b);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
    expect(JSON.stringify(b.state.jokers)).toBe(JSON.stringify(a.state.jokers));
  });
});
