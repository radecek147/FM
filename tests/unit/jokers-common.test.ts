/**
 * Běžní žolíci fáze 4 (docs/DESIGN.md kap. 4.7, č. 1–15): přesná čísla mechanik přes skutečné skórování,
 * hraniční podmínky, stav přes více rukou a kol, kopie (`isCopy`), uložení a načtení, texty a `ArtSpec`.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { buildRegistry } from '../../src/content/index';
import { COMMON_JOKERS } from '../../src/content/jokers/common';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { FALLBACK_JOKER_ID } from '../../src/engine/constants';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { pickJokerDefId } from '../../src/engine/shop/pool';
import type { Card, GameEvent, JokerInstance, RoundRewards, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import {
  addJokers,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  winNextHand,
  type JokerSpec,
  type SetupOptions,
} from './fixtures/registry';

/** Testovací registr (kombinace, úpravy karet, testovací šéfové a žolíci) + skuteční běžní žolíci. */
const reg = makeRegistry({ jokers: COMMON_JOKERS });

function def(id: string): JokerDef {
  const d = COMMON_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`Chybí žolík ${id}`);
  return d;
}

/** Hra v Malé útratě s danými žolíky (bez `onAcquire`) a nedosažitelným cílem (kolo neskončí výhrou). */
function roundGame(jokers: (string | JokerSpec)[] = [], target = 1e9, registry: ContentRegistry = reg): Game {
  const game = makeGame({ registry, jokers, round: true });
  game._core.state.round!.target = target;
  return game;
}

/** Nastaví ruku a zahraje karty na zadaných indexech (bez indexů celou ruku). */
function playHand(game: Game, hand: string, pick?: number[], opts?: SetupOptions): ScoreResult {
  const cards = setupRound(game, hand, opts);
  return play(game, pick ? pick.map((i) => cards[i]!) : cards).result;
}

/** Součet změn, které ve skórování udělal žolík `defId` (kroky se zdrojem `joker`). */
function jokerDelta(result: ScoreResult, defId: string) {
  const steps = result.steps.filter((s) => s.source === 'joker' && s.defId === defId);
  return {
    chips: steps.reduce((a, s) => a + (s.chips ?? 0), 0),
    mult: steps.reduce((a, s) => a + (s.mult ?? 0), 0),
    messages: steps.map((s) => s.message).filter((m): m is string => m !== undefined),
  };
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

/**
 * Dohraje kolo výhrou první kartou v ruce (vybere útratu, je-li třeba), vyplatí odměny a odejde z Večerky.
 * Vrátí rozpis odměn a události vítězné ruky.
 */
function finishRound(game: Game): { rewards: RoundRewards; events: GameEvent[] } {
  if (game.state.phase === 'blind_select') expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  winNextHand(game);
  const { events } = play(game, [game.state.round!.hand[0]!]);
  expect(game.state.phase).toBe('round_end');
  const rewards = structuredClone(game.state.rewards!);
  expect(game.dispatch({ type: 'cashOut' }).ok).toBe(true);
  expect(game.dispatch({ type: 'leaveShop' }).ok).toBe(true);
  return { rewards, events };
}

/** Popisek žolíka s dosazenými `params` a `describe(self)`, NBSP nahrazené mezerou (kvůli čitelnosti testu). */
function descOf(id: string, self?: JokerInstance): string {
  const d = def(id);
  const params = { ...(d.params ?? {}), ...(self && d.describe ? d.describe(self) : {}) };
  return t(`jokers.${id}.desc`, params).replaceAll(NBSP, ' ');
}

// ─────────────────────────── Definice ───────────────────────────

describe('běžní žolíci – definice podle DESIGN 4.7', () => {
  const IDS = [
    'beer_mat',
    'hearts_man',
    'gravedigger',
    'jeweler',
    'crusader',
    'early_bird',
    'night_shift',
    'meteorologist',
    'pe_teacher',
    'party_for_two',
    'gardener',
    'svejk',
    'piggy_bank',
    'flea_trader',
    'golem',
  ];
  const COSTS = [4, 5, 5, 5, 4, 4, 4, 5, 4, 4, 5, 4, 5, 4, 5];

  it('15 žolíků v pořadí tabulky, všichni běžní, ceny podle tabulky, štítky vyplněné', () => {
    expect(COMMON_JOKERS.map((j) => j.id)).toEqual(IDS);
    expect(COMMON_JOKERS.map((j) => j.cost)).toEqual(COSTS);
    for (const j of COMMON_JOKERS) {
      expect(j.rarity, j.id).toBe('common');
      expect(j.tags.length, j.id).toBeGreaterThan(0);
    }
  });

  it('čísla mechanik v params odpovídají tabulce', () => {
    const params = Object.fromEntries(COMMON_JOKERS.map((j) => [j.id, j.params]));
    expect(params).toEqual({
      beer_mat: { chips: 10, mult: 2 },
      hearts_man: { chips: 5, mult: 2, suit: 'H' },
      gravedigger: { chips: 20, suit: 'S' },
      jeweler: { chips: 5, suit: 'D' },
      crusader: { mult: 12, count: 2, suit: 'C' },
      early_bird: { mult: 8 },
      night_shift: { mult: 14 },
      meteorologist: { mult: 2, level: 2 },
      pe_teacher: { chips: 8 },
      party_for_two: { chips: 15, mult: 3, hand: 'pair' },
      gardener: { money: 2, cards: 3 },
      svejk: { pct: 10, discards: 1, max: 2 },
      piggy_bank: { money: 2, rounds: 8, bonus: 8 },
      flea_trader: { money: 3 },
      golem: { cards: 2, chips: 20 },
    });
  });

  it('štítky podle kategorie (boti podle nich nakupují a řadí)', () => {
    const tags = Object.fromEntries(COMMON_JOKERS.map((j) => [j.id, j.tags]));
    expect(tags.beer_mat).toEqual(['chips', 'mult']);
    expect(tags.gravedigger).toContain('suit');
    expect(tags.jeweler).toContain('scaling');
    expect(tags.svejk).toEqual(['utility', 'discard']);
    expect(tags.golem).toContain('deck');
    for (const id of ['gardener', 'piggy_bank', 'flea_trader']) expect(tags[id]).toEqual(['economy']);
    for (const id of ['early_bird', 'night_shift', 'crusader', 'meteorologist'])
      expect(tags[id]).toContain('mult');
  });

  it('nálepky a kopírování: ekonomičtí bez zapůjčení a kopie, Pokladnička bez přibití', () => {
    for (const j of COMMON_JOKERS) {
      const economy = j.tags.includes('economy');
      expect(j.noRental === true, j.id).toBe(economy);
      expect(j.copyable === false, j.id).toBe(economy);
      expect(j.noEternal === true, j.id).toBe(j.id === 'piggy_bank');
    }
  });

  it('ArtSpec: ikona i rekvizita z ICON_NAMES, každý žolík má jinou hlavní ikonu a jinou dvojici ikona + rekvizita', () => {
    for (const j of COMMON_JOKERS) {
      expect(isIconName(j.art.icon), `${j.id}: ${j.art.icon}`).toBe(true);
      expect(j.art.prop && isIconName(j.art.prop), `${j.id}: ${j.art.prop}`).toBe(true);
      expect(j.art.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(j.art.fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(j.art.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(COMMON_JOKERS.map((j) => j.art.icon)).size).toBe(COMMON_JOKERS.length);
    expect(new Set(COMMON_JOKERS.map((j) => j.art.prop)).size).toBe(COMMON_JOKERS.length);
    expect(new Set(COMMON_JOKERS.map((j) => j.art.bg)).size).toBe(COMMON_JOKERS.length);
  });

  it('jsou ve skutečném registru obsahu', () => {
    const full = buildRegistry();
    for (const j of COMMON_JOKERS) expect(full.jokers[j.id]).toBe(j);
  });
});

// ─────────────────────────── Texty ───────────────────────────

describe('běžní žolíci – texty', () => {
  it('každý má název (max. 3 slova), popis a flavor bez uvozovek', () => {
    for (const j of COMMON_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${j.id}.${field}`), `${j.id}.${field}`).toBe(true);
      expect(t(`jokers.${j.id}.name`).split(/\s+/).length, j.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${j.id}.flavor`), j.id).not.toMatch(/["„“‚‘]/);
    }
  });

  it('každý {param} popisku je v params nebo describe(self) a po dosazení nic nezbyde', () => {
    const game = makeGame({ registry: reg });
    for (const j of COMMON_JOKERS) {
      const key = `jokers.${j.id}.desc`;
      const self = newJokerInstance(game._core, j.id);
      const params = { ...(j.params ?? {}), ...(j.describe?.(self) ?? {}) };
      for (const m of t(key).matchAll(/\{(\w+)/g)) expect(params, `${key}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(key, params), key).not.toMatch(/[{}⟦]/);
    }
  });

  it('popisky čtou čísla z params (česky formátované, správné tvary slov)', () => {
    expect(descOf('beer_mat')).toBe('+10 čipů a +2 mult. Jako jediný žolík se smí v nabídce opakovat.');
    expect(descOf('hearts_man')).toBe('Každá skórující srdcová karta dá +5 čipů a +2 mult.');
    expect(descOf('jeweler')).toBe('Každá skórující kárová karta trvale získá +5 čipů.');
    expect(descOf('crusader')).toBe('+12 mult, pokud skórují aspoň 2 křížové karty.');
    expect(descOf('gardener')).toBe('Na konci kola +2 Kč za každé 3 karty držené v ruce.');
    expect(descOf('flea_trader')).toBe('Na konci kola +3 Kč za každý prázdný slot žolíka.');
    expect(descOf('early_bird')).toBe('První ruka kola dá +8 mult.');
    expect(descOf('golem')).toBe(
      'Při získání přidá do balíčku 2 kamenné karty; každá skórující kamenná karta dá +20 čipů navíc.',
    );
  });

  it('hlášky žolíků existují', () => {
    for (const key of ['jokers.jeweler.polished', 'jokers.svejk.report', 'jokers.piggy_bank.broken'])
      expect(hasKey(key), key).toBe(true);
    expect(t('jokers.svejk.report', { discards: 1 }).replaceAll(NBSP, ' ')).toBe(
      'Poslušně hlásím: +1 zahození.',
    );
  });
});

// ─────────────────────────── 1–10: skórování ───────────────────────────

describe('Pivní tácek (beer_mat)', () => {
  it('+10 čipů a +2 mult každé ruce', () => {
    // Vysoká karta: 6 čipů × 1 mult + K (10) → 16 × 1; s táckem 26 × 3.
    const r = playHand(roundGame(['beer_mat']), 'KS');
    expect([r.chips, r.mult, r.score]).toEqual([26, 3, 78]);
    expect(jokerDelta(r, 'beer_mat')).toMatchObject({ chips: 10, mult: 2 });
    const two = playHand(roundGame(['beer_mat', 'beer_mat']), 'KS');
    expect([two.chips, two.mult]).toEqual([36, 5]);
  });

  it('je náhradní žolík vyčerpané nabídky a smí se opakovat i vlastněný', () => {
    expect(FALLBACK_JOKER_ID).toBe('beer_mat');
    const onlyCommons: ContentRegistry = {
      ...makeRegistry(),
      jokers: Object.fromEntries(COMMON_JOKERS.map((j) => [j.id, j])),
    };
    const game = makeGame({ registry: onlyCommons });
    addJokers(
      game,
      COMMON_JOKERS.map((j) => j.id),
    );
    const core = game._core;
    for (let i = 0; i < 5; i++)
      expect(pickJokerDefId(core, core.rng('shop'), { rarity: 'common' })).toBe('beer_mat');
  });
});

describe('Srdcař (hearts_man)', () => {
  it('každá skórující ♥ dá +5 čipů a +2 mult (i divoká), jiné barvy nic', () => {
    // Dvojice 12 × 2 + K + K = 32 × 2; jedno srdce → 37 × 4.
    const r = playHand(roundGame(['hearts_man']), 'KH KS');
    expect([r.chips, r.mult, r.score]).toEqual([37, 4, 148]);
    const wild = playHand(roundGame(['hearts_man']), 'KH KS:wild');
    expect(jokerDelta(wild, 'hearts_man')).toMatchObject({ chips: 10, mult: 4 });
    const none = playHand(roundGame(['hearts_man']), 'KD KS');
    expect([none.chips, none.mult]).toEqual([32, 2]);
  });

  it('neskórující a debuffnutá ♥ nic nedá, opakovaná aktivace dá efekt znovu', () => {
    // KH je mimo Dvojici (kicker).
    expect(jokerDelta(playHand(roundGame(['hearts_man']), 'KS KD 5H'), 'hearts_man').chips).toBe(0);
    expect(jokerDelta(playHand(roundGame(['hearts_man']), 'KH! KS'), 'hearts_man').chips).toBe(0);
    // Červená pečeť: KH skóruje 2× → 12 + 10 + 10 + 10 + 2 × 5 = 52 čipů, 2 + 2 × 2 = 6 mult.
    const r = playHand(roundGame(['hearts_man']), 'KH@red KS');
    expect([r.chips, r.mult, r.score]).toEqual([52, 6, 312]);
  });
});

describe('Hrobník (gravedigger)', () => {
  it('každá skórující ♠ dá +20 čipů', () => {
    // Dvojice es: 12 + 11 + 11 = 34; jedna pika → 54 × 2.
    const r = playHand(roundGame(['gravedigger']), 'AS AH');
    expect([r.chips, r.mult, r.score]).toEqual([54, 2, 108]);
    expect(jokerDelta(playHand(roundGame(['gravedigger']), 'AS AS'), 'gravedigger').chips).toBe(40);
  });

  it('kamenná karta ani karta mimo kombinaci se nepočítá', () => {
    expect(jokerDelta(playHand(roundGame(['gravedigger']), 'AH AD 2S:stone'), 'gravedigger').chips).toBe(0);
    expect(jokerDelta(playHand(roundGame(['gravedigger']), 'AH AD 7S'), 'gravedigger').chips).toBe(0);
  });
});

describe('Klenotník (jeweler)', () => {
  it('skórující ♦ trvale získá +5 čipů; projeví se při příští aktivaci karty', () => {
    const game = roundGame(['jeweler']);
    const [ad, ah] = setupRound(game, 'AD AH');
    const r = play(game, [ad!, ah!]).result;
    // V téže aktivaci se čipy karty už započítaly: 12 + 11 + 11 = 34.
    expect([r.chips, r.mult]).toEqual([34, 2]);
    expect(jokerDelta(r, 'jeweler').messages).toEqual(['jokers.jeweler.polished']);
    expect(game._core.card(ad!.id)!.bonusChips).toBe(5);
    expect(game._core.card(ah!.id)!.bonusChips).toBe(0);
  });

  it('opakovaná aktivace už vidí vyleštěnou kartu (červená pečeť)', () => {
    const game = roundGame(['jeweler']);
    const [ad] = setupRound(game, 'AD@red');
    // Vysoká karta 6 + 11 (1. aktivace) + 16 (2. aktivace, +5 z první) = 33.
    expect(play(game, [ad!]).result.chips).toBe(33);
    expect(game._core.card(ad!.id)!.bonusChips).toBe(10);
  });

  it('bonus vydrží do další ruky i přes uložení a načtení; divoká ano, kamenná ne', () => {
    let game = roundGame(['jeweler']);
    const [ad] = setupRound(game, 'AD');
    expect(play(game, [ad!]).result.chips).toBe(17);
    game = reload(game);
    // Vrátit tutéž kartu z odhazovací hromádky do ruky a zahrát znovu: 6 + 11 + 5.
    const round = game._core.state.round!;
    round.discardPile = round.discardPile.filter((id) => id !== ad!.id);
    round.hand.push(ad!.id);
    expect(play(game, [ad!.id]).result.chips).toBe(22);
    expect(game._core.card(ad!.id)!.bonusChips).toBe(10);

    const g2 = roundGame(['jeweler']);
    const [wild, stone] = setupRound(g2, 'KS:wild 2D:stone');
    play(g2, [wild!, stone!]);
    expect(g2._core.card(wild!.id)!.bonusChips).toBe(5);
    expect(g2._core.card(stone!.id)!.bonusChips).toBe(0);
  });
});

describe('Křižák (crusader)', () => {
  it('+12 mult, když skórují aspoň 2 ♣', () => {
    // Dvě dvojice: 24 + 10 + 10 + 5 + 5 = 54 čipů, 2 + 12 mult.
    const r = playHand(roundGame(['crusader']), 'KC KD 5C 5H');
    expect([r.chips, r.mult, r.score]).toEqual([54, 14, 756]);
    // Divoká karta je i křížová.
    expect(jokerDelta(playHand(roundGame(['crusader']), 'KS:wild KD 5C 5H'), 'crusader').mult).toBe(12);
  });

  it('jedna skórující ♣ nestačí; ♣ mimo kombinaci ani debuffnutá se nepočítá', () => {
    expect(playHand(roundGame(['crusader']), 'KC KD 5S 5H').mult).toBe(2);
    // 5C je kicker k Dvojici králů.
    expect(playHand(roundGame(['crusader']), 'KC KD 5C').mult).toBe(2);
    expect(playHand(roundGame(['crusader']), 'KC KD 5C! 5H').mult).toBe(2);
  });
});

describe('Ranní ptáče (early_bird) a Noční směna (night_shift)', () => {
  it('Ranní ptáče: jen první ruka kola dá +8 mult', () => {
    const game = roundGame(['early_bird']);
    const first = playHand(game, 'KS');
    expect([first.chips, first.mult, first.score]).toEqual([16, 9, 144]);
    const second = playHand(game, 'KS');
    expect([second.chips, second.mult]).toEqual([16, 1]);
  });

  it('Noční směna: v kole se šéfem dá každá ruka +14 mult, v Malé a Velké útratě nic', () => {
    const small = roundGame(['night_shift']);
    expect(small.state.round!.blind).toBe('small');
    const day = playHand(small, 'KS');
    expect(day.mult).toBe(1);
    expect(jokerDelta(day, 'night_shift').mult).toBe(0);

    const night = makeGame({ registry: reg, jokers: ['night_shift'] });
    selectBoss(night, 'wall');
    night._core.state.round!.target = 1e9;
    const first = playHand(night, 'KS');
    expect([first.chips, first.mult, first.score]).toEqual([16, 15, 240]);
    expect(playHand(night, 'KS').mult).toBe(15);
  });

  it('Noční směna: platí i ve Velké útratě se šéfem (Imperial) a u vypnutého šéfa', () => {
    const game = roundGame(['night_shift']);
    game._core.state.round!.bossId = 'wall';
    expect(playHand(game, 'KS').mult).toBe(15);
    const night = makeGame({ registry: reg, jokers: ['night_shift'] });
    selectBoss(night, 'halver');
    night._core.state.round!.target = 1e9;
    night._core.api.disableBoss();
    expect(playHand(night, 'KS').mult).toBe(15);
  });

  it('Ranní ptáče a Noční směna se sčítají v první ruce kola šéfa', () => {
    const game = makeGame({ registry: reg, jokers: ['early_bird', 'night_shift'] });
    selectBoss(game, 'wall');
    game._core.state.round!.target = 1e9;
    expect(playHand(game, 'KS').mult).toBe(1 + 8 + 14);
  });
});

describe('Meteorolog (meteorologist)', () => {
  it('+2 mult za každou úroveň zahrané kombinace nad první', () => {
    // Dvojice úr. 3: 12 + 2 × 14 = 40 čipů, 2 + 2 × 1 = 4 mult; +2 × 2 = 8 mult.
    const r = playHand(roundGame(['meteorologist']), 'KS KH', undefined, { levels: { pair: 3 } });
    expect([r.chips, r.mult, r.score]).toEqual([60, 8, 480]);
    expect(playHand(roundGame(['meteorologist']), 'KS KH', undefined, { levels: { pair: 2 } }).mult).toBe(
      3 + 2,
    );
  });

  it('na úrovni 1 nic nedá (ani prázdný krok)', () => {
    const r = playHand(roundGame(['meteorologist']), 'KS KH', undefined, { levels: { two_pair: 5 } });
    expect(r.mult).toBe(2);
    expect(jokerDelta(r, 'meteorologist').mult).toBe(0);
    expect(r.steps.some((s) => s.defId === 'meteorologist')).toBe(false);
  });
});

describe('Tělocvikář (pe_teacher)', () => {
  it('+8 čipů za každou zahranou kartu, i neskórující', () => {
    // Dvojice králů + 3 neskórující: 12 + 10 + 10 + 5 × 8 = 72.
    const r = playHand(roundGame(['pe_teacher']), 'KS KH 2C 3D 7S');
    expect([r.chips, r.mult, r.score]).toEqual([72, 2, 144]);
    expect(jokerDelta(playHand(roundGame(['pe_teacher']), '2S'), 'pe_teacher').chips).toBe(8);
  });
});

describe('Párty pro dva (party_for_two)', () => {
  it('+15 čipů a +3 mult, pokud ruka obsahuje Dvojici', () => {
    const r = playHand(roundGame(['party_for_two']), 'KS KH');
    expect([r.chips, r.mult, r.score]).toEqual([47, 5, 235]);
  });

  it('Dvojici obsahují i Dvě dvojice, Trojice a Full house; Vysoká karta, Barva a Postupka ne', () => {
    const delta = (hand: string) => jokerDelta(playHand(roundGame(['party_for_two']), hand), 'party_for_two');
    for (const hand of ['KS KH 5C 5D', 'KS KH KD', 'KS KH KD 5C 5D'])
      expect(delta(hand), hand).toMatchObject({ chips: 15, mult: 3 });
    for (const hand of ['KS QH', '2H 5H 7H 9H JH', '5S 6H 7C 8D 9S'])
      expect(delta(hand), hand).toMatchObject({ chips: 0, mult: 0 });
  });
});

// ─────────────────────────── 11–15: ekonomika, pravidla, balíček ───────────────────────────

describe('Zahrádkář Venca (gardener)', () => {
  function rewardWithHeld(hand: string, played: number): number {
    const game = makeGame({ registry: reg, jokers: ['gardener'], round: true });
    const cards = setupRound(game, hand);
    winNextHand(game);
    play(game, cards.slice(0, played));
    expect(game.state.phase).toBe('round_end');
    return jokerReward(game.state.rewards, 'gardener');
  }

  it('na konci kola +2 Kč za každé 3 karty, které zůstaly v ruce', () => {
    const eight = '2S 3S 4S 5S 6S 7S 8S 9S';
    expect(rewardWithHeld(eight, 2)).toBe(4); // 6 v ruce
    expect(rewardWithHeld(eight, 3)).toBe(2); // 5 v ruce
    expect(rewardWithHeld(eight, 5)).toBe(2); // 3 v ruce
    expect(rewardWithHeld('2S 3S 4S 5S 6S 7S 8S', 5)).toBe(0); // 2 v ruce
  });
});

describe('Švejk (svejk)', () => {
  // Vysoká karta 2♠: 6 + 2 = 8 čipů × 1 = 8 bodů.
  const WEAK = '2S';

  it('po ruce za méně než 10 % cíle +1 zahození; přesně 10 % nestačí', () => {
    const exact = roundGame(['svejk'], 80);
    playHand(exact, WEAK);
    expect(exact.state.round!.discardsLeft).toBe(3);

    const game = roundGame(['svejk'], 81);
    const { events } = play(game, setupRound(game, WEAK));
    expect(game.state.round!.discardsLeft).toBe(4);
    expect(events).toContainEqual({ type: 'message', key: 'jokers.svejk.report', params: { discards: 1 } });
  });

  it('nejvýš 2× za kolo, počítadlo je vidět v popisku a nový začátek kola ho vynuluje', () => {
    const game = roundGame(['svejk']);
    const discards = () => game.state.round!.discardsLeft;
    expect(descOf('svejk', joker(game, 'svejk'))).toBe(
      'Po ruce za méně než 10 % cíle kola získáš +1 zahození, nejvýš 2× za kolo (teď ještě 2×).',
    );
    playHand(game, WEAK);
    expect(discards()).toBe(4);
    expect(descOf('svejk', joker(game, 'svejk'))).toContain('(teď ještě 1×)');
    playHand(game, WEAK);
    playHand(game, WEAK);
    expect(discards()).toBe(5);
    expect(joker(game, 'svejk').state.used).toBe(2);

    // Další kolo začíná s plným počtem.
    finishRound(game);
    expect(joker(game, 'svejk').state.used).toBe(0);
    game.dispatch({ type: 'selectBlind' });
    game._core.state.round!.target = 1e9;
    expect(discards()).toBe(3);
    playHand(game, WEAK);
    expect(discards()).toBe(4);
  });

  it('silná ruka nic nedá', () => {
    const game = roundGame(['svejk'], 1000);
    playHand(game, 'AS AH AD AC'); // Čtveřice: (65 + 44) × 6 = 654 ≥ 100
    expect(game.state.round!.discardsLeft).toBe(3);
  });

  it('kopie zdvojí efekt, ale počítadlo originálu nenavyšuje (kopírující vlevo i vpravo)', () => {
    for (const order of [
      ['copier', 'svejk'],
      ['svejk', 'copier_left'],
    ]) {
      const game = roundGame(order);
      const discards: number[] = [];
      for (let i = 0; i < 3; i++) {
        playHand(game, WEAK);
        discards.push(game.state.round!.discardsLeft);
      }
      expect(discards, order.join(',')).toEqual([5, 7, 7]);
      expect(joker(game, 'svejk').state.used).toBe(2);
    }
  });

  it('stav přežije uložení a načtení', () => {
    let game = roundGame(['svejk']);
    playHand(game, WEAK);
    game = reload(game);
    expect(joker(game, 'svejk').state).toEqual({ used: 1, firedAt: 0 });
    playHand(game, WEAK);
    playHand(game, WEAK);
    expect(game.state.round!.discardsLeft).toBe(5);
  });
});

describe('Pokladnička (piggy_bank)', () => {
  it('7 kol po +2 Kč, po 8. kole +10 Kč (2 + 8), rozbije se a zmizí', () => {
    const game = makeGame({ registry: reg, jokers: ['piggy_bank'] });
    const paid: number[] = [];
    for (let i = 1; i <= 7; i++) {
      paid.push(jokerReward(finishRound(game).rewards, 'piggy_bank'));
      expect(joker(game, 'piggy_bank').state.rounds).toBe(i);
    }
    expect(paid).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(descOf('piggy_bank', joker(game, 'piggy_bank'))).toBe(
      'Na konci kola +2 Kč. Po 8. kole se rozbije, dá ještě 8 Kč a zmizí (zbývá 1 kolo).',
    );
    const uid = joker(game, 'piggy_bank').uid;
    const money = game.state.money;
    const { rewards, events } = finishRound(game);
    expect(jokerReward(rewards, 'piggy_bank')).toBe(10);
    expect(game.state.jokers).toEqual([]);
    expect(events).toContainEqual({ type: 'jokerDestroyed', uid, defId: 'piggy_bank', reason: 'broken' });
    expect(events).toContainEqual({ type: 'message', key: 'jokers.piggy_bank.broken' });
    expect(game.state.money - money).toBe(rewards.total);
    // Bez Pokladničky už nic.
    expect(jokerReward(finishRound(game).rewards, 'piggy_bank')).toBe(0);
  });

  it('popisek ukazuje zbývající kola se správným tvarem slova', () => {
    const game = makeGame({ registry: reg, jokers: ['piggy_bank'] });
    const self = joker(game, 'piggy_bank');
    expect(descOf('piggy_bank', self)).toContain('(zbývá 8 kol)');
    self.state.rounds = 6;
    expect(descOf('piggy_bank', self)).toContain('(zbývají 2 kola)');
  });

  it('počítadlo přežije uložení a načtení a rozbije se přesně po 8. kole celkem', () => {
    let game = makeGame({ registry: reg, jokers: ['piggy_bank'] });
    for (let i = 0; i < 3; i++) finishRound(game);
    game = reload(game);
    expect(joker(game, 'piggy_bank').state).toEqual({ rounds: 3 });
    const paid: number[] = [];
    for (let i = 0; i < 5; i++) paid.push(jokerReward(finishRound(game).rewards, 'piggy_bank'));
    expect(paid).toEqual([2, 2, 2, 2, 10]);
    expect(game.state.jokers).toEqual([]);
  });

  it('přibitá (vynucená nálepka) se zničit nedá: bonus dá jen jednou, pak už nic nevyplácí', () => {
    const game = makeGame({ registry: reg, jokers: [{ id: 'piggy_bank', stickers: ['eternal'] }] });
    const paid: number[] = [];
    for (let i = 0; i < 10; i++) paid.push(jokerReward(finishRound(game).rewards, 'piggy_bank'));
    expect(paid).toEqual([2, 2, 2, 2, 2, 2, 2, 10, 0, 0]);
    expect(game.state.jokers.map((j) => j.defId)).toEqual(['piggy_bank']);
    expect(joker(game, 'piggy_bank').state).toEqual({ rounds: 10 });
  });

  it('nejde kopírovat: kopírující žolík počítadlo nenavýší ani nic nevyplatí', () => {
    const game = makeGame({ registry: reg, jokers: ['copier', 'piggy_bank'] });
    const { rewards } = finishRound(game);
    expect(joker(game, 'piggy_bank').state.rounds).toBe(1);
    expect(rewards.extra.filter((e) => e.source.startsWith('joker:'))).toEqual([
      { source: 'joker:piggy_bank', amount: 2, jokerUid: joker(game, 'piggy_bank').uid },
    ]);
  });
});

describe('Bazarník (flea_trader)', () => {
  function reward(jokers: (string | JokerSpec)[]): number {
    const game = makeGame({ registry: reg, jokers });
    return jokerReward(finishRound(game).rewards, 'flea_trader');
  }

  it('na konci kola +3 Kč za každý prázdný slot žolíka', () => {
    expect(reward(['flea_trader'])).toBe(12);
    expect(reward(['flea_trader', 'beer_mat', 'early_bird'])).toBe(6);
    expect(reward(['flea_trader', 'beer_mat', 'early_bird', 'golem', 'svejk'])).toBe(0);
  });

  it('negativní žolík si slot přinese sám', () => {
    expect(reward(['flea_trader', { id: 'noop', edition: 'negative' }])).toBe(12);
  });
});

describe('Golem (golem)', () => {
  function isStoneCard(c: Card): boolean {
    return c.enhancement === 'stone';
  }

  it('při koupi ve Večerce přidá do balíčku 2 kamenné karty', () => {
    const game = makeGame({ registry: reg, round: true });
    winNextHand(game);
    play(game, [game.state.round!.hand[0]!]);
    expect(game.dispatch({ type: 'cashOut' }).ok).toBe(true);
    const core = game._core;
    core.state.money = 50;
    core.state.shop!.items[0] = {
      kind: 'joker',
      joker: newJokerInstance(core, 'golem'),
      price: 5,
      sold: false,
    };
    const before = core.state.deck.length;
    const res = game.dispatch({ type: 'buy', slot: 0 });
    expect(res.ok).toBe(true);
    const added = core.state.deck.slice(before);
    expect(added).toHaveLength(2);
    expect(added.every(isStoneCard)).toBe(true);
    const sources = res.ok ? res.events.filter((e) => e.type === 'cardAdded').map((e) => e.source) : [];
    expect(sources).toEqual(['golem', 'golem']);
  });

  it('kamenné karty přidá i efekt (createJoker), ne žolík vložený bez získání', () => {
    const game = makeGame({ registry: reg });
    const before = game.state.deck.length;
    addJokers(game, ['golem']);
    expect(game.state.deck.length).toBe(before);
    game._core.api.createJoker({ defId: 'golem' });
    expect(game.state.deck.filter(isStoneCard)).toHaveLength(2);
    // Stejný seed → stejné karty (náhoda jen přes RNG streamy).
    const again = makeGame({ registry: reg });
    again._core.api.createJoker({ defId: 'golem' });
    const face = (cards: readonly Card[]) => cards.slice(-2).map((c) => [c.suit, c.rank, c.enhancement]);
    expect(face(again.state.deck)).toEqual(face(game.state.deck));
  });

  it('každá skórující kamenná karta dá +20 čipů navíc (i při opakování)', () => {
    // Dvojice + kamenná: 12 + 10 + 10 + 50 (kamenná) + 20 = 102 čipů × 2.
    const r = playHand(roundGame(['golem']), 'KS KH 2C:stone');
    expect([r.chips, r.mult, r.score]).toEqual([102, 2, 204]);
    expect(jokerDelta(playHand(roundGame(['golem']), 'KS KH 2C:stone@red'), 'golem').chips).toBe(40);
  });

  it('nekamenná, debuffnutá kamenná ani kamenná pod vypnutými vylepšeními nic nedá', () => {
    expect(jokerDelta(playHand(roundGame(['golem']), 'KS KH 2C'), 'golem').chips).toBe(0);
    expect(jokerDelta(playHand(roundGame(['golem']), 'KS KH 2C:stone!'), 'golem').chips).toBe(0);
    // Bílá hora (vypnutá vylepšení) + všechny karty skórují: z kamenné je obyčejná 2♣.
    const game = roundGame(['all_score', 'golem']);
    game._core.api.addPermanentModifier({ disableEnhancements: true });
    const r = playHand(game, 'KS KH 2C:stone');
    expect(r.hand.scoringIds).toHaveLength(3);
    expect(jokerDelta(r, 'golem').chips).toBe(0);
  });
});
