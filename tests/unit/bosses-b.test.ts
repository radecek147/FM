/**
 * Běžní šéfové #14–25 (docs/DESIGN.md kap. 8.2) přes skutečný engine (Game + selectBoss + setupRound + play):
 * přesná pravidla s čísly, hranice, Odvolání (`disableBoss`), uložení a načtení. Obsah: src/content/bosses/b.ts.
 *
 * Navíc obecná schopnost enginu `BossHooks.isJokerDebuffed` (debuffy žolíků podle pravidla, přepočet po přeřazení,
 * prodeji, Odvolání a na konci kola) a dotaz `EngineApi.cardRank`.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES_B, INFLUENCER_FLAG } from '../../src/content/bosses/b';
import type { ContentRegistry } from '../../src/engine/content-types';
import { MSG } from '../../src/engine/constants';
import { bossFitsAnte, bossHasRule } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import type { GameEvent, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { formatNumber } from '../../src/i18n/format';
import {
  boss,
  type JokerSpec,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  type SetupOptions,
  winNextHand,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Testovací šéf pro obecný hook: žolík nejvíc vlevo je mimo provoz. */
const LEFT_BLIND = boss('left_blind', {
  hooks: { isJokerDebuffed: (_ctx, _joker, index) => index === 0 },
});

function registry(): ContentRegistry {
  return makeRegistry({ bosses: [...BOSSES_B, LEFT_BLIND] });
}

interface BossGameOptions {
  jokers?: (string | JokerSpec)[];
  seed?: string;
  /** Úprava stavu před výběrem útraty šéfa (např. počty zahraných kombinací pro Influencerku). */
  before?: (g: Game) => void;
}

/** Hra v kole daného šéfa (patro 1, Malá a Velká přeskočené). */
function bossGame(id: string, opts: BossGameOptions = {}): Game {
  const g = makeGame({ registry: registry(), jokers: opts.jokers ?? [], seed: opts.seed });
  opts.before?.(g);
  selectBoss(g, id);
  return g;
}

/** Nastaví ruku a zahraje prvních `count` karet; kolo se tím nevyhraje ani neprohraje. */
function hand(g: Game, spec: string, count?: number, opts: SetupOptions = {}): ScoreResult {
  const cards = setupRound(g, spec, opts);
  const round = g._core.state.round!;
  round.target = 1e15;
  round.handsLeft = Math.max(round.handsLeft, 2);
  return play(g, cards.slice(0, count ?? cards.length)).result;
}

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

const baseStep = (r: ScoreResult) => r.steps.find((s) => s.source === 'hand')!;

function reload(g: Game): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.state)) as Game['state'], registry());
}

const debuffedUids = (g: Game) => g.state.jokers.filter((j) => j.debuffed).map((j) => j.uid);

// ─────────────────────────── Data a texty ───────────────────────────

describe('běžní šéfové 14–25 – data (DESIGN 8.2)', () => {
  it('id, od patra a cíl odpovídají tabulce', () => {
    const table: Record<string, [number, number]> = {
      new_decree: [3, 1.1],
      binder_tower: [2, 3],
      regional_derby: [2, 1.75],
      pig_slaughter: [3, 2.5],
      white_mountain: [3, 2],
      normalization: [2, 2],
      one_eyed_hetman: [3, 1.4],
      mother_in_law: [1, 2.25],
      influencer: [2, 2],
      hangover: [1, 2],
      blackout: [1, 2],
      even_days: [1, 2],
    };
    expect(BOSSES_B.map((b) => b.id)).toEqual(Object.keys(table));
    for (const b of BOSSES_B) {
      const [minAnte, target] = table[b.id]!;
      expect(b.minAnte ?? 1, b.id).toBe(minAnte);
      expect(b.targetMult ?? 2, b.id).toBe(target);
      expect(b.final, b.id).toBeUndefined();
      expect(b.reward ?? 5, b.id).toBe(5);
    }
  });

  it('pravidlo má každý šéf kromě Šanonu na šanonu (do Velké útraty na Imperialu se nelosuje)', () => {
    for (const b of BOSSES_B) expect(bossHasRule(b), b.id).toBe(b.id !== 'binder_tower');
  });

  it('běžný šéf platí od svého patra, ve finálním patře ne', () => {
    for (const b of BOSSES_B) {
      expect(bossFitsAnte(b, (b.minAnte ?? 1) - 1), b.id).toBe(false);
      expect(bossFitsAnte(b, b.minAnte ?? 1), b.id).toBe(true);
      expect(bossFitsAnte(b, 8), b.id).toBe(false);
    }
  });

  it('texty: name (max 3 slova), rule, intro, defeat, death; čísla v pravidle sedí s params', () => {
    for (const b of BOSSES_B) {
      for (const field of ['name', 'rule', 'intro', 'defeat', 'death']) {
        expect(hasKey(`bosses.${b.id}.${field}`), `bosses.${b.id}.${field}`).toBe(true);
      }
      expect(t(`bosses.${b.id}.name`).split(/\s+/).length, b.id).toBeLessThanOrEqual(3);
      // Čísla jen přes `{param}`: po dosazení nic nezbyde, každé číslo z params v textu je a změna params text změní.
      const rule = t(`bosses.${b.id}.rule`, b.params);
      expect(rule, b.id).not.toMatch(/[{}]/);
      for (const [k, v] of Object.entries(b.params ?? {})) {
        if (typeof v !== 'number') continue;
        expect(rule, `${b.id}.${k}`).toContain(formatNumber(v));
        expect(t(`bosses.${b.id}.rule`, { ...b.params, [k]: 37 }), `${b.id}.${k}`).toContain('37');
      }
    }
    const rule = (id: string): string => t(`bosses.${id}.rule`, BOSSES_B.find((b) => b.id === id)?.params);
    expect(rule('normalization')).toContain('5\u00a0čipů');
    expect(rule('binder_tower')).toContain('3× základ patra místo 2×');
    expect(rule('hangover')).toContain('o\u00a01\u00a0ruku méně');
    expect(rule('mother_in_law')).toContain('1\u00a0náhodnou kartu');
    expect(rule('pig_slaughter')).toContain('1\u00a0náhodná skórující karta');
    expect(t('bosses.pig_slaughter.rule', { cards: 2 })).toContain('2\u00a0náhodné skórující karty');
  });
});

// ─────────────────────────── 14 Nová vyhláška ───────────────────────────

describe('Nová vyhláška (new_decree)', () => {
  it('kombinace na úrovni 5 se počítá jako na úrovni 1 (i v náhledu)', () => {
    const g = bossGame('new_decree');
    const cards = setupRound(g, 'KH KS', { levels: { pair: 5 } });
    const preview = g.preview(cards.map((c) => c.id));
    expect(preview).toMatchObject({ chips: 12, mult: 2 });
    const r = hand(g, 'KH KS', undefined, { levels: { pair: 5 } });
    expect(baseStep(r)).toMatchObject({ chips: 12, mult: 2 });
    expect(r.score).toBe((12 + 10 + 10) * 2);
  });

  it('Odvolání: úrovně zase platí', () => {
    const g = bossGame('new_decree');
    g._core.api.disableBoss();
    const r = hand(g, 'KH KS', undefined, { levels: { pair: 5 } });
    expect(baseStep(r)).toMatchObject({ chips: 12 + 4 * 14, mult: 2 + 4 });
  });
});

// ─────────────────────────── 15 Šanon na šanonu ───────────────────────────

describe('Šanon na šanonu (binder_tower)', () => {
  it('cíl je 3× základ patra (běžný šéf 2×), odměna 5 Kč', () => {
    const g = bossGame('binder_tower');
    const small = g.blindTarget('small');
    expect(g.state.round!.target).toBe(3 * small);
    expect(g.blindTarget('boss', 'binder_tower')).toBe(1.5 * g.blindTarget('boss', 'hangover'));
    expect(g.blindReward('boss', 'binder_tower')).toBe(5);
  });
});

// ─────────────────────────── 16 Krajské derby ───────────────────────────

describe('Krajské derby (regional_derby)', () => {
  it('červená i černá karta v ruce: poloviční základní čipy i mult (nahoru), i v náhledu', () => {
    const g = bossGame('regional_derby');
    const cards = setupRound(g, 'KH KS');
    expect(g.preview(cards.map((c) => c.id))).toMatchObject({ chips: 6, mult: 1 });
    const r = hand(g, 'KH KS');
    expect(baseStep(r)).toMatchObject({ chips: 6, mult: 1 });
    expect(r.score).toBe(6 + 20);
  });

  it('zaokrouhluje nahoru: Dvojice úrovně 2 (26 čipů, 3 mult) → 13 a 2', () => {
    const r = hand(bossGame('regional_derby'), 'KH KS', undefined, { levels: { pair: 2 } });
    expect(baseStep(r)).toMatchObject({ chips: 13, mult: 2 });
  });

  it('počítá se celá zahraná ruka, i neskórující karta (Vysoká karta 1 mult → 1)', () => {
    const r = hand(bossGame('regional_derby'), 'AH 2S');
    expect(r.hand.type).toBe('high_card');
    expect(baseStep(r)).toMatchObject({ chips: 3, mult: 1 });
  });

  it('jen jedna strana: plný základ', () => {
    const g = bossGame('regional_derby');
    expect(baseStep(hand(g, 'KH KD'))).toMatchObject({ chips: 12, mult: 2 });
    expect(baseStep(hand(g, 'KS KC 2S'))).toMatchObject({ chips: 12, mult: 2 });
  });

  it('divoká ani kamenná karta stranu nevolí', () => {
    const g = bossGame('regional_derby');
    expect(baseStep(hand(g, 'KH KS:wild'))).toMatchObject({ chips: 12, mult: 2 });
    expect(baseStep(hand(g, 'KH KD 5S:stone'))).toMatchObject({ chips: 12, mult: 2 });
    expect(baseStep(hand(g, 'KH KD:wild 5S'))).toMatchObject({ chips: 6, mult: 1 });
  });
});

// ─────────────────────────── 17 Zabijačka ───────────────────────────

describe('Zabijačka (pig_slaughter)', () => {
  it('po ruce se zničí právě 1 náhodná skórující karta, neskórující přežije', () => {
    const g = bossGame('pig_slaughter');
    const cards = setupRound(g, 'KH KS 2C');
    g._core.state.round!.target = 1e15;
    const deckBefore = g.state.deck.length;
    const { events } = play(g, cards);
    const destroyed = events.filter((e) => e.type === 'cardDestroyed');
    expect(destroyed).toHaveLength(1);
    const victim = destroyed[0]!.type === 'cardDestroyed' ? destroyed[0]!.cardId : -1;
    expect([cards[0]!.id, cards[1]!.id]).toContain(victim);
    expect(destroyed[0]).toMatchObject({ reason: 'boss' });
    expect(g.state.deck.length).toBe(deckBefore - 1);
    expect(g.card(victim)).toBeUndefined();
    expect(g.card(cards[2]!.id)).toBeDefined();
    expect(g.state.round!.discardPile).not.toContain(victim);
    expect(g.state.round!.discardPile).toContain(cards[2]!.id);
  });

  it('skóre ruky se nemění a výběr oběti je deterministický (stejný seed = stejná karta)', () => {
    const victims = [1, 2].map(() => {
      const g = bossGame('pig_slaughter', { seed: 'ZABIJACKA' });
      const cards = setupRound(g, 'KH KS QH QS');
      g._core.state.round!.target = 1e15;
      const { result, events } = play(g, cards);
      expect(result.score).toBe((24 + 40) * 2);
      const e = events.find((x) => x.type === 'cardDestroyed');
      return cards.findIndex((c) => e?.type === 'cardDestroyed' && c.id === e.cardId);
    });
    expect(victims[0]).toBeGreaterThanOrEqual(0);
    expect(victims[0]).toBe(victims[1]);
  });

  it('Odvolání: nic se neničí', () => {
    const g = bossGame('pig_slaughter');
    g._core.api.disableBoss();
    const deckBefore = g.state.deck.length;
    hand(g, 'KH KS');
    expect(g.state.deck.length).toBe(deckBefore + 2);
  });
});

// ─────────────────────────── 18 Bílá hora ───────────────────────────

describe('Bílá hora (white_mountain)', () => {
  it('vylepšení nefungují: multiplikační nedá mult, skleněná nenásobí ani nepraskne', () => {
    const g = bossGame('white_mountain');
    expect(g.modifiers().disableEnhancements).toBe(true);
    expect(hand(g, 'KH:mult KS').score).toBe((12 + 20) * 2);
    const cards = setupRound(g, 'KH:glass KS:glass');
    g._core.state.round!.target = 1e15;
    expect(play(g, cards).result.score).toBe((12 + 20) * 2);
    for (const c of cards) expect(g.card(c.id)).toBeDefined();
  });

  it('divoká karta nepatří do všech barev, kamenná má zase hodnotu', () => {
    const g = bossGame('white_mountain');
    expect(hand(g, 'AH KH 9H 5H 2S:wild').hand.type).toBe('high_card');
    expect(hand(g, 'KH KS:stone').hand.type).toBe('pair');
  });

  it('Odvolání: vylepšení zase fungují', () => {
    const g = bossGame('white_mountain');
    g._core.api.disableBoss();
    const mult = Number(registry().enhancements.mult!.params!.mult);
    expect(hand(g, 'KH:mult KS').score).toBe((12 + 20) * (2 + mult));
  });
});

// ─────────────────────────── 19 Normalizace ───────────────────────────

describe('Normalizace (normalization)', () => {
  it('každá skórující karta dává právě 5 čipů (i eso a bonusové čipy karty)', () => {
    const g = bossGame('normalization');
    expect(hand(g, 'KH KS').score).toBe((12 + 5 + 5) * 2);
    expect(hand(g, 'AS+20 AH').score).toBe((12 + 5 + 5) * 2);
  });

  it('vylepšení a edice fungují', () => {
    const g = bossGame('normalization');
    const bonus = Number(registry().enhancements.bonus!.params!.chips);
    expect(hand(g, 'KH:bonus KS').score).toBe((12 + 5 + bonus + 5) * 2);
    expect(hand(g, 'KH~foil KS').score).toBe((12 + 5 + 50 + 5) * 2);
  });
});

// ─────────────────────────── 20 Jednooký hejtman ───────────────────────────

describe('Jednooký hejtman (one_eyed_hetman)', () => {
  const FIVE = ['coaster', 'plus_mult', 'times_mult', 'card_chips', 'noop'];

  it('5 žolíků: pravá polovina (pozice 4 a 5) mimo provoz, prostřední funguje', () => {
    const g = bossGame('one_eyed_hetman', { jokers: FIVE });
    expect(g.state.jokers.map((j) => j.debuffed)).toEqual([false, false, false, true, true]);
    // Pivní tácek +10/+2, +4 mult, ×2; čipy karet (card_chips) nefungují.
    const r = hand(g, 'KH KS');
    expect(r.score).toBe((12 + 20 + 10) * (2 + 2 + 4) * 2);
  });

  it('sudý počet: polovina vpravo; jediný žolík funguje', () => {
    expect(
      bossGame('one_eyed_hetman', { jokers: ['noop', 'noop', 'noop', 'noop'] }).state.jokers.map(
        (j) => j.debuffed,
      ),
    ).toEqual([false, false, true, true]);
    expect(bossGame('one_eyed_hetman', { jokers: ['noop'] }).state.jokers[0]!.debuffed).toBe(false);
  });

  it('platí i po přeřazení: mimo provoz je vždy to, co stojí vpravo', () => {
    const g = bossGame('one_eyed_hetman', { jokers: FIVE });
    const [a, b, c, d, e] = g.state.jokers.map((j) => j.uid) as [number, number, number, number, number];
    ok(g.dispatch({ type: 'reorderJokers', uids: [e, d, a, b, c] }));
    expect(debuffedUids(g)).toEqual([b, c]);
    expect(g.state.round!.ruleJokerDebuffs?.slice().sort()).toEqual([b, c].sort());
    // ×2 (times_mult) teď vpravo nefunguje.
    expect(hand(g, 'KH KS').score).toBe((12 + 20 + 10 + 2 * 3) * (2 + 2));
  });

  it('prodej žolíka během kola: polovina se přepočítá', () => {
    const g = bossGame('one_eyed_hetman', { jokers: ['noop', 'plus_mult', 'times_mult', 'coaster'] });
    const [a, , c, d] = g.state.jokers.map((j) => j.uid);
    expect(debuffedUids(g)).toEqual([c, d]);
    ok(g.dispatch({ type: 'sellJoker', uid: a! }));
    expect(debuffedUids(g)).toEqual([d]);
  });

  it('Odvolání a konec kola vrátí žolíky do provozu; ve Večerce pravidlo neplatí', () => {
    const g = bossGame('one_eyed_hetman', { jokers: FIVE });
    g._core.api.disableBoss();
    expect(debuffedUids(g)).toEqual([]);
    ok(g.dispatch({ type: 'reorderJokers', uids: g.state.jokers.map((j) => j.uid).reverse() }));
    expect(debuffedUids(g)).toEqual([]);

    const g2 = bossGame('one_eyed_hetman', { jokers: FIVE });
    winNextHand(g2);
    ok(g2.dispatch({ type: 'play', cardIds: [g2.state.round!.hand[0]!] }));
    expect(debuffedUids(g2)).toEqual([]);
    ok(g2.dispatch({ type: 'cashOut' }));
    ok(g2.dispatch({ type: 'reorderJokers', uids: g2.state.jokers.map((j) => j.uid).reverse() }));
    expect(g2.state.phase).toBe('shop');
    expect(debuffedUids(g2)).toEqual([]);
  });

  it('uložení a načtení: pravidlo pokračuje', () => {
    const g = reload(bossGame('one_eyed_hetman', { jokers: FIVE }));
    const uids = g.state.jokers.map((j) => j.uid);
    expect(debuffedUids(g)).toEqual(uids.slice(3));
    ok(g.dispatch({ type: 'reorderJokers', uids: [...uids].reverse() }));
    expect(debuffedUids(g).sort()).toEqual(uids.slice(0, 2).sort());
  });
});

// ─────────────────────────── 21 Tchyně na návštěvě ───────────────────────────

describe('Tchyně na návštěvě (mother_in_law)', () => {
  it('zahození vezme navíc 1 náhodnou kartu z ruky; spotřebuje se 1 zahození a ruka se dobere', () => {
    const g = bossGame('mother_in_law');
    const cards = setupRound(g, 'KH KS 2C 3D 4H 5S 6C 7D');
    const round = g._core.state.round!;
    const discardsBefore = round.discardsLeft;
    const events = ok(g.dispatch({ type: 'discard', cardIds: [cards[2]!.id] }));
    expect(round.discardsLeft).toBe(discardsBefore - 1);
    expect(round.discardPile).toHaveLength(2);
    expect(round.discardPile[0]).toBe(cards[2]!.id);
    const extra = round.discardPile[1]!;
    expect(cards.map((c) => c.id)).toContain(extra);
    expect(extra).not.toBe(cards[2]!.id);
    expect(events.some((e) => e.type === 'cardsDiscarded' && e.forced === true)).toBe(true);
    expect(round.hand).toHaveLength(8);
    expect(round.hand).not.toContain(extra);
  });

  it('nucené zahození nespouští pečetě ani žolíky na zahození', () => {
    const g = bossGame('mother_in_law', { jokers: ['discard_cash'] });
    const cards = setupRound(g, 'KH 2C@purple 3D@purple 4H@purple');
    const money = g.state.money;
    ok(g.dispatch({ type: 'discard', cardIds: [cards[0]!.id] }));
    expect(g.state.round!.discardPile).toHaveLength(2);
    expect(g.state.consumables).toHaveLength(0);
    expect(g.state.money).toBe(money + 1);
  });

  it('zahození celé ruky: tchyně nemá co vzít', () => {
    const g = bossGame('mother_in_law');
    const cards = setupRound(g, 'KH KS 2C 3D 4H');
    ok(g.dispatch({ type: 'discard', cardIds: cards.map((c) => c.id) }));
    expect(g.state.round!.discardPile).toHaveLength(5);
    expect(g.state.round!.hand).toHaveLength(8);
  });
});

// ─────────────────────────── 22 Influencerka Nikča ───────────────────────────

describe('Influencerka Nikča (influencer)', () => {
  const counts =
    (c: Partial<Record<'pair' | 'flush' | 'three', number>>) =>
    (g: Game): void => {
      for (const [type, n] of Object.entries(c)) g._core.state.handLevels[type as 'pair'].played = n;
    };

  it('nejčastěji hraná kombinace má poloviční základ, ostatní ne', () => {
    const g = bossGame('influencer', { before: counts({ pair: 3, flush: 2 }) });
    expect(g.state.round!.flags[INFLUENCER_FLAG]).toBe('pair');
    expect(baseStep(hand(g, 'KH KS'))).toMatchObject({ chips: 6, mult: 1 });
    expect(baseStep(hand(g, 'KH QH 9H 5H 2H'))).toMatchObject({ chips: 40, mult: 4 });
  });

  it('při shodě počtů ta silnější kombinace', () => {
    const g = bossGame('influencer', { before: counts({ pair: 2, flush: 2, three: 1 }) });
    expect(g.state.round!.flags[INFLUENCER_FLAG]).toBe('flush');
    expect(baseStep(hand(g, 'KH QH 9H 5H 2H'))).toMatchObject({ chips: 20, mult: 2 });
  });

  it('kombinace se vybere na začátku kola a během kola se nemění (i po uložení a načtení)', () => {
    let g = bossGame('influencer', { before: counts({ pair: 3, flush: 2 }) });
    for (let i = 0; i < 2; i++) hand(g, 'KH QH 9H 5H 2H');
    g = reload(g);
    expect(g.state.handLevels.flush.played).toBe(4);
    expect(g.state.round!.flags[INFLUENCER_FLAG]).toBe('pair');
    expect(baseStep(hand(g, 'KH KS'))).toMatchObject({ chips: 6, mult: 1 });
  });

  it('bez zahraných kombinací nic nepůlí', () => {
    const g = bossGame('influencer');
    expect(g.state.round!.flags[INFLUENCER_FLAG]).toBeUndefined();
    expect(baseStep(hand(g, 'KH KS'))).toMatchObject({ chips: 12, mult: 2 });
  });
});

// ─────────────────────────── 23 Kocovina ───────────────────────────

describe('Kocovina (hangover)', () => {
  it('o 1 ruku méně; Odvolání ji vrátí', () => {
    const g = bossGame('hangover');
    expect(g.modifiers().hands).toBe(3);
    expect(g.state.round!.handsLeft).toBe(3);
    expect(g.state.round!.discardsLeft).toBe(3);
    g._core.api.disableBoss();
    expect(g.state.round!.handsLeft).toBe(4);
  });
});

// ─────────────────────────── 24 Výpadek proudu ───────────────────────────

describe('Výpadek proudu (blackout)', () => {
  it('žolíci nefungují v první ruce ani při zahazování před ní; od druhé ruky ano', () => {
    const g = bossGame('blackout', { jokers: ['plus_mult', 'discard_cash'] });
    expect(g.state.jokers.every((j) => j.debuffed)).toBe(true);
    const money = g.state.money;
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(money);
    const first = hand(g, 'KH KS');
    expect(first.steps.some((s) => s.source === 'joker')).toBe(false);
    expect(first.score).toBe((12 + 20) * 2);
    expect(g.state.jokers.some((j) => j.debuffed)).toBe(false);
    expect(g.state.round!.ruleJokerDebuffs).toEqual([]);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(money + 1);
    expect(hand(g, 'KH KS').score).toBe((12 + 20) * (2 + 4));
  });

  it('pasivní velikost ruky se vrátí hned po první ruce (ruka se dobere do plna)', () => {
    const g = bossGame('blackout', { jokers: ['big_hand'] });
    expect(g.state.round!.hand).toHaveLength(8);
    winNextHand(g);
    g._core.state.round!.target = 1e15;
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.modifiers().handSize).toBe(10);
    expect(g.state.round!.hand).toHaveLength(10);
  });
});

// ─────────────────────────── 25 Sudé dny ───────────────────────────

describe('Sudé dny (even_days)', () => {
  it('A, 3, 5, 7, 9 mimo provoz; 2–10 sudé, figury a kamenné karty ne', () => {
    const g = bossGame('even_days');
    const cards = setupRound(g, 'AH 3S 5D 7C 9H 2S 4D 6C 8H 10S JD QC KH 3D:stone');
    expect(cards.filter((c) => c.debuffed).map((c) => c.rank)).toEqual([14, 3, 5, 7, 9]);
  });

  it('lichá Dvojice skóruje jen základ', () => {
    const r = hand(bossGame('even_days'), '3H 3D');
    expect(r.hand.type).toBe('pair');
    expect(r.steps.filter((s) => s.message === MSG.debuffed)).toHaveLength(2);
    expect(r.score).toBe(12 * 2);
  });

  it('platí i pro dobírané karty a Odvolání debuff zruší', () => {
    const g = bossGame('even_days');
    const odd = g.state.round!.hand.map((id) => g.card(id)!).filter((c) => [14, 3, 5, 7, 9].includes(c.rank));
    for (const c of odd) expect(c.debuffed).toBe(true);
    g._core.api.disableBoss();
    for (const c of odd) expect(g.card(c.id)!.debuffed).toBe(false);
  });
});

// ─────────────────────────── Engine: isJokerDebuffed, cardRank ───────────────────────────

describe('engine: BossHooks.isJokerDebuffed', () => {
  it('na začátku kola, po přeřazení a Odvolání; eviduje se v ruleJokerDebuffs', () => {
    const g = bossGame('left_blind', { jokers: ['noop', 'plus_mult'] });
    const [a, b] = g.state.jokers.map((j) => j.uid) as [number, number];
    expect(debuffedUids(g)).toEqual([a]);
    expect(g.state.round!.ruleJokerDebuffs).toEqual([a]);
    expect(g.state.round!.jokerDebuffs).toEqual([a]);
    const events = ok(g.dispatch({ type: 'reorderJokers', uids: [b, a] }));
    expect(debuffedUids(g)).toEqual([b]);
    expect(events.filter((e) => e.type === 'jokerDebuffChanged')).toHaveLength(2);
    g._core.api.disableBoss();
    expect(debuffedUids(g)).toEqual([]);
    expect(g.state.round!.ruleJokerDebuffs).toEqual([]);
  });

  it('cizí dočasný debuff si pravidlo nepřivlastní ani nezruší', () => {
    const g = bossGame('left_blind', { jokers: ['noop', 'plus_mult'] });
    const [a, b] = g.state.jokers.map((j) => j.uid) as [number, number];
    g._core.api.setJokerDebuffed(b, true);
    ok(g.dispatch({ type: 'reorderJokers', uids: [b, a] }));
    expect(g.state.round!.ruleJokerDebuffs).toEqual([]);
    ok(g.dispatch({ type: 'reorderJokers', uids: [a, b] }));
    expect(debuffedUids(g).sort()).toEqual([a, b].sort());
  });

  it('zvětralý žolík zůstane mimo provoz, i když ho pravidlo pustí', () => {
    const g = bossGame('left_blind', {
      jokers: [{ id: 'noop', stickers: ['perishable'] }, 'plus_mult'],
    });
    const [a, b] = g.state.jokers.map((j) => j.uid) as [number, number];
    g._core.state.jokers[0]!.perishRounds = 0;
    ok(g.dispatch({ type: 'reorderJokers', uids: [b, a] }));
    expect(debuffedUids(g).sort()).toEqual([a, b].sort());
  });

  it('nový žolík během kola se přepočítá po akci', () => {
    const g = bossGame('left_blind', { jokers: [] });
    const j = g._core.api.createJoker({ defId: 'noop' })!;
    expect(j.debuffed).toBe(false);
    ok(g.dispatch({ type: 'sortHand', by: 'rank' }));
    expect(g.state.jokers[0]!.debuffed).toBe(true);
  });
});

describe('engine: EngineApi.cardRank', () => {
  it('kamenná karta hodnotu nemá; při vypnutých vylepšeních (Bílá hora) ano', () => {
    const g = bossGame('hangover');
    const [stone, king] = setupRound(g, '3D:stone KH');
    expect(g._core.api.cardRank(stone!)).toBeNull();
    expect(g._core.api.cardRank(king!)).toBe(13);
    const w = bossGame('white_mountain');
    const [stone2] = setupRound(w, '3D:stone');
    expect(w._core.api.cardRank(stone2!)).toBe(3);
  });
});
