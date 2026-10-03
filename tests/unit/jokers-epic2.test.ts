/**
 * Epičtí žolíci fáze 7 (docs/DESIGN.md 4.9, src/content/jokers/epic2.ts): přesná čísla mechanik přes skutečné
 * skórování (Game + setupRound + play), hraniční podmínky, peníze v rozpisu odměn, stav přes víc rukou a kol, kopie
 * (`isCopy`), uložení a načtení, texty, `ArtSpec` a fuzz přes boty s obsahem hry.
 */
import { describe, expect, it } from 'vitest';
import { isIconName } from '../../src/assets/icons/index';
import { buildRegistry } from '../../src/content/index';
import { JOKERS } from '../../src/content/jokers';
import { EPIC_JOKERS } from '../../src/content/jokers/epic';
import { EPIC2_JOKERS } from '../../src/content/jokers/epic2';
import type { ContentRegistry, JokerDef } from '../../src/engine/content-types';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { createBot } from '../../src/engine/sim/index';
import type { Action, GameEvent, JokerInstance, RoundRewards, ScoreResult } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import {
  boss,
  makeGame,
  makeRegistry,
  play,
  selectBoss,
  setupRound,
  type JokerSpec,
  type SetupOptions,
} from './fixtures/registry';

// ─────────────────────────── Pomocníci ───────────────────────────

/**
 * Testovací registr (kombinace, úpravy karet, testovací žolíci a spotřebky) + epičtí žolíci fáze 7 a 4; jediný
 * bezzubý šéf (kola šéfa bez vedlejších účinků na skóre).
 */
const reg: ContentRegistry = makeRegistry({ jokers: [...EPIC_JOKERS, ...EPIC2_JOKERS] });
reg.bosses = { calm: boss('calm'), final_boss: boss('final_boss', { final: true }) };

function def(id: string): JokerDef {
  const d = EPIC2_JOKERS.find((j) => j.id === id);
  if (!d) throw new Error(`Chybí žolík ${id}`);
  return d;
}

function game(jokers: (string | JokerSpec)[] = []): Game {
  return makeGame({ registry: reg, jokers });
}

/** Hra v Malé útratě s danými žolíky (bez `onAcquire`) a nedosažitelným cílem (kolo neskončí výhrou). */
function roundGame(jokers: (string | JokerSpec)[] = []): Game {
  const g = makeGame({ registry: reg, jokers, round: true });
  g._core.state.round!.target = 1e12;
  g._core.state.round!.handsLeft = 10;
  return g;
}

/** Nastaví ruku a zahraje karty na zadaných indexech (bez indexů celou ruku). Kolo se nevyhraje. */
function playHand(g: Game, hand: string, pick?: number[], opts?: SetupOptions): ScoreResult {
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
  const cards = setupRound(g, hand, opts);
  const round = g._core.state.round!;
  round.target = 1e12;
  round.handsLeft = Math.max(round.handsLeft, 2);
  return play(g, pick ? pick.map((i) => cards[i]!) : cards).result;
}

/** Kroky žolíka `defId` ve skórování (vlastník slotu). */
const jokerSteps = (r: ScoreResult, defId: string) =>
  r.steps.filter((s) => s.source === 'joker' && s.defId === defId);

function ok(res: ReturnType<Game['dispatch']>): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Uloží a načte run (JSON jako v localStorage) a pokračuje s obnovenou hrou. */
function reload(g: Game): Game {
  return Game.fromState(deserializeRun(JSON.parse(serializeRun(g.state))), g.registry);
}

function joker(g: Game, id: string): JokerInstance {
  const j = g.state.jokers.find((x) => x.defId === id);
  if (!j) throw new Error(`Žolík ${id} není ve slotech`);
  return j;
}

/** Odměny za kolo od žolíka `defId` (0, když v rozpisu není). */
function jokerReward(rewards: RoundRewards | null | undefined, defId: string): number {
  return (rewards?.extra ?? [])
    .filter((e) => e.source === `joker:${defId}`)
    .reduce((a, e) => a + e.amount, 0);
}

/** Vyhraje běžící (případně právě vybrané) kolo jednou kartou (cíl 1); zahazování se nepoužije. */
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

/** Vyhraje kolo bezzubého šéfa z výběru útraty. */
function winBoss(g: Game): GameEvent[] {
  selectBoss(g, 'calm');
  return winRound(g);
}

/** Popisek žolíka s dosazenými `params` a `describe(self)`, NBSP nahrazené mezerou. */
function descOf(id: string, self?: JokerInstance): string {
  const d = def(id);
  const inst = self ?? newJokerInstance(game()._core, id);
  return t(`jokers.${id}.desc`, { ...(d.params ?? {}), ...(d.describe?.(inst) ?? {}) }).replaceAll(NBSP, ' ');
}

// Základy kombinací na úrovni 1 (DESIGN 2.2.1): Vysoká karta 6 × 1, Dvojice 12 × 2, Dvě dvojice 24 × 2, Trojice
// 28 × 3, Postupka 35 × 4, Barva 40 × 4, Full house 45 × 5, Postupka v barvě 90 × 9, Pětice 110 × 11.
// Čipy karet: 2–10 = číslo, J/Q/K = 10, A = 11, kamenná 0 (+50 vylepšením). Dvojice králů = 32 × 2 = 64.

// ─────────────────────────── Definice ───────────────────────────

const IDS = [
  'beer_sommelier',
  'archivist',
  'fair_magician',
  'tour_guide',
  'spartakiada',
  'voucher_privatization',
  'spa_guest',
  'brass_band',
  'charles_bridge',
  'd1_motorway',
  'exchange_office',
  'new_years_eve',
];

describe('epičtí žolíci fáze 7 – definice', () => {
  it('12 žolíků (4 ze zásobníku DESIGN 4.9 + 8 vlastních), všichni epičtí za 8–10 Kč, štítky vyplněné', () => {
    expect(EPIC2_JOKERS.map((j) => j.id)).toEqual(IDS);
    for (const j of EPIC2_JOKERS) {
      expect(j.rarity, j.id).toBe('epic');
      expect([8, 9, 10], j.id).toContain(j.cost);
      expect(j.tags.length, j.id).toBeGreaterThan(0);
      expect(j.id, j.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(EPIC2_JOKERS.map((j) => j.cost)).toEqual([9, 10, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8]);
  });

  it('id jsou unikátní mezi všemi žolíky a žolíci jsou ve skutečném registru obsahu', () => {
    const ids = JOKERS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    const full = buildRegistry();
    for (const j of EPIC2_JOKERS) expect(full.jokers[j.id]).toBe(j);
  });

  it('čísla mechanik v params', () => {
    expect(Object.fromEntries(EPIC2_JOKERS.map((j) => [j.id, j.params ?? {}]))).toEqual({
      beer_sommelier: { base: 1, xmult: 0.7 },
      archivist: {},
      fair_magician: { xmult: 1.15, chance: 1, odds: 5 },
      tour_guide: { chips: 40, tip: 1, cards: 4, hand: 'flush' },
      spartakiada: { retriggers: 2 },
      voucher_privatization: { money: 1, pct: 5, max: 8 },
      spa_guest: { xmult: 0.13 },
      brass_band: { retriggers: 2, hand: 'pair' },
      charles_bridge: { xmult: 3 },
      d1_motorway: { xmult: 2, cards: 1 },
      exchange_office: { base: 1, xmult: 0.1, chips: 15, max: 2.1 },
      new_years_eve: { xmult: 0.2 },
    });
  });

  it('nálepky a kopírování podle DESIGN 4.4: kopírující a ekonomika z rozpisu nejdou kopírovat', () => {
    const flagged = (pred: (j: JokerDef) => boolean) => EPIC2_JOKERS.filter(pred).map((j) => j.id);
    expect(flagged((j) => j.copyable === false)).toEqual(['archivist', 'voucher_privatization']);
    expect(flagged((j) => j.noRental === true)).toEqual(['voucher_privatization']);
    // Rostou časem ve slotu (jako Stálý host) — zvětrávání by šlo proti smyslu.
    expect(flagged((j) => j.noPerishable === true)).toEqual(['spa_guest', 'new_years_eve']);
    expect(flagged((j) => j.noEternal === true)).toEqual([]);
    expect(flagged((j) => j.noShop === true)).toEqual([]);
    expect(flagged((j) => j.initState !== undefined)).toEqual([
      'archivist',
      'fair_magician',
      'spa_guest',
      'new_years_eve',
    ]);
    expect(flagged((j) => j.tags.includes('copy'))).toEqual(['archivist']);
  });

  it('ArtSpec: ikony z ICON_NAMES, hlavní ikona i dvojice ikona + rekvizita unikátní mezi všemi žolíky', () => {
    for (const j of EPIC2_JOKERS) {
      const { icon, prop, bg, fg, accent, pattern } = j.art;
      expect(isIconName(icon), `${j.id}: ${icon}`).toBe(true);
      expect(prop !== undefined && isIconName(prop), `${j.id}: ${prop}`).toBe(true);
      for (const c of [bg, fg, accent]) expect(c, j.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(pattern, j.id).toBeDefined();
    }
    const mains = JOKERS.map((j) => j.art.icon);
    expect(new Set(mains).size).toBe(mains.length);
    const pairs = JOKERS.map((j) => `${j.art.icon}+${j.art.prop}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const bgs = [...EPIC_JOKERS, ...EPIC2_JOKERS].map((j) => j.art.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });
});

// ─────────────────────────── Texty ───────────────────────────

describe('epičtí žolíci fáze 7 – texty', () => {
  it('každý má název (max. 3 slova), popis a flavor bez uvozovek', () => {
    for (const j of EPIC2_JOKERS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`jokers.${j.id}.${field}`), `${j.id}.${field}`).toBe(true);
      expect(t(`jokers.${j.id}.name`).split(/\s+/).length, j.id).toBeLessThanOrEqual(3);
      expect(t(`jokers.${j.id}.flavor`), j.id).not.toMatch(/["„“‚‘]/);
    }
  });

  it('každý {param} popisku je v params nebo describe(self) a po dosazení nic nezbyde', () => {
    const g = game();
    for (const j of EPIC2_JOKERS) {
      const key = `jokers.${j.id}.desc`;
      const self = newJokerInstance(g._core, j.id);
      const params = { ...(j.params ?? {}), ...(j.describe?.(self) ?? {}) };
      for (const m of t(key).matchAll(/\{(\w+)/g)) expect(params, `${key}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(key, params), key).not.toMatch(/[{}⟦]/);
    }
  });

  it('všech 12 popisků přesně (čísla z params, česky formátovaná, správné tvary slov)', () => {
    expect(Object.fromEntries(IDS.map((id) => [id, descOf(id)]))).toEqual({
      beer_sommelier:
        '×1 mult a navíc +×0,7 za každou různou kombinaci zahranou v tomto kole (včetně této ruky).',
      archivist: 'Při získání bez edice dostane duhovou; kopíruje schopnost žolíka nalevo od sebe.',
      fair_magician: 'Skórují všechny zahrané karty a každá skórující karta dá ×1,15 mult; 1 z 5, že po ruce jedna zahraná karta zmizí v klobouku (zničí se).',
      tour_guide:
        'Postupka i Barva stačí ze čtyř karet a ruka, která obsahuje Postupku nebo Barvu, dá +40 čipů; když má jen 4 karty, chce průvodce spropitné 1 Kč.',
      spartakiada: 'V první ruce kola skóruje každá skórující karta ještě 2×.',
      voucher_privatization:
        'Na konci kola +1 Kč za každých 5 % cíle, o které skóre kola cíl překročilo (nejvýš 8 Kč).',
      spa_guest: 'Za každé kolo, ve kterém se nezahazovalo, trvale +×0,13 mult (teď ×1).',
      brass_band: 'Každá skórující karta skóruje ještě 2× za každou další skórující kartu stejné hodnoty.',
      charles_bridge: '×3 mult, pokud držíš v ruce kartu stejné hodnoty jako některá skórující karta.',
      d1_motorway: '×2 mult; v ruce máš o 1 kartu méně.',
      exchange_office: '×1 mult a navíc +×0,1 za každých 15 čipů, které ruka v tu chvíli má (nejvýš ×2,1).',
      new_years_eve: 'Po každé porážce šéfa trvale +×0,2 mult (teď ×1).',
    });
  });

  it('popisky se stavem ukazují aktuální ×mult', () => {
    const inst = (id: string, state: JokerInstance['state']) => ({
      ...newJokerInstance(game()._core, id),
      state,
    });
    expect(descOf('spa_guest', inst('spa_guest', { rounds: 3 }))).toContain('(teď ×1,39)');
    expect(descOf('new_years_eve', inst('new_years_eve', { bosses: 4 }))).toContain('(teď ×1,8)');
    // Poškozený stav (cizí save) = výchozí hodnota.
    expect(descOf('spa_guest', inst('spa_guest', { rounds: 'x' }))).toContain('(teď ×1)');
  });
});

// ─────────────────────────── Pivní sommelier ───────────────────────────

describe('Pivní sommelier (beer_sommelier)', () => {
  it('×1,7 za první kombinaci kola, ×2,4 za dvě různé, ×3,1 za tři; opakovaná kombinace nic nepřidá', () => {
    const g = roundGame(['beer_sommelier']);
    const r1 = playHand(g, 'KS KH');
    expect(jokerSteps(r1, 'beer_sommelier')).toMatchObject([{ xmult: 1.7 }]);
    expect(r1.score).toBe(Math.floor(32 * 2 * 1.7)); // 108
    const r2 = playHand(g, 'AS');
    expect(jokerSteps(r2, 'beer_sommelier')).toMatchObject([{ xmult: 2.4 }]);
    expect(r2.score).toBe(Math.floor(17 * 2.4)); // 40
    const r3 = playHand(g, 'QS QH');
    expect(jokerSteps(r3, 'beer_sommelier')).toMatchObject([{ xmult: 2.4 }]);
    const r4 = playHand(g, '7S 7H 7D');
    expect(jokerSteps(r4, 'beer_sommelier')).toMatchObject([{ xmult: 3.1 }]);
    expect(r4.score).toBe(Math.floor(49 * 3 * 3.1)); // 455
  });

  it('nové kolo začíná znovu od ×1,7', () => {
    const g = roundGame(['beer_sommelier']);
    playHand(g, 'KS KH');
    playHand(g, 'AS');
    winRound(g);
    toBlindSelect(g);
    const r = playHand(g, 'AS');
    expect(jokerSteps(r, 'beer_sommelier')).toMatchObject([{ xmult: 1.7 }]);
  });
});

// ─────────────────────────── Archivář ───────────────────────────

describe('Archivář (archivist)', () => {
  it('kopíruje souseda vlevo: Pivní tácek zdvojí (+10 čipů a +2 mult navíc) a zapíše cíl do state.target', () => {
    const g = roundGame(['coaster', 'archivist']);
    const r = playHand(g, 'KS');
    // Vysoká karta 16 × 1 → tácek 26 × 3 → kopie 36 × 5
    expect(r.score).toBe(180);
    expect(jokerSteps(r, 'archivist')).toMatchObject([{ chips: 10 }, { mult: 2 }]);
    expect(joker(g, 'archivist').state.target).toBe(joker(g, 'coaster').uid);
  });

  it('nejvíc vlevo nekopíruje nic; po přeřazení platí nový soused', () => {
    const g = roundGame(['coaster', 'archivist']);
    playHand(g, 'KS');
    ok(g.dispatch({ type: 'reorderJokers', uids: [joker(g, 'archivist').uid, joker(g, 'coaster').uid] }));
    const r = playHand(g, 'KS');
    expect(r.score).toBe(78);
    expect(jokerSteps(r, 'archivist')).toEqual([]);
    expect(joker(g, 'archivist').state.target).toBeNull();
  });

  it('kopíruje i epické žolíky (na rozdíl od Napodobitele a Kopíráku)', () => {
    const g = roundGame([{ id: 'spa_guest', state: { rounds: 2 } }, 'archivist']);
    // 32 × 2 × 1,26 × 1,26
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.26 * 1.26)); // 101
  });

  it('nekopírovatelného souseda (ani jiného Archiváře) nekopíruje a cíl nezapíše', () => {
    const g = roundGame(['uncopyable', 'archivist']);
    expect(playHand(g, 'KS').score).toBe(16 * 8);
    expect(joker(g, 'archivist').state.target).toBeNull();
    const g2 = roundGame(['coaster', 'archivist', 'archivist']);
    expect(playHand(g2, 'KS').score).toBe(180);
    expect(g2.state.jokers[2]!.state.target).toBeNull();
    // Ekonomika z rozpisu (Kupónová privatizace) jde mimo kopírování.
    const g3 = roundGame(['voucher_privatization', 'archivist']);
    playHand(g3, 'KS');
    expect(joker(g3, 'archivist').state.target).toBeNull();
  });

  it('při získání bez edice dostane duhovou (×1,5 platí i bez cíle); vlastní edici si nechá', () => {
    const g = roundGame();
    const a = g._core.api.createJoker({ defId: 'archivist' })!;
    expect(a.edition).toBe('poly');
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.5)); // 96
    const b = g._core.api.createJoker({ defId: 'archivist', edition: 'foil' })!;
    expect(b.edition).toBe('foil');
  });

  it('kopie počítadlo cíle nezdvojí (Silvestr nalevo po porážce šéfa jen +1)', () => {
    const g = game(['new_years_eve', 'archivist']);
    winBoss(g);
    expect(joker(g, 'new_years_eve').state.bosses).toBe(1);
    toBlindSelect(g);
    // ×1,2 originál a ×1,2 kopie
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.2 * 1.2)); // 92
  });

  it('stav přežije uložení a načtení', () => {
    let g = roundGame(['coaster', 'archivist']);
    playHand(g, 'KS');
    g = reload(g);
    expect(joker(g, 'archivist').state.target).toBe(joker(g, 'coaster').uid);
    expect(playHand(g, 'KS').score).toBe(180);
  });
});

// ─────────────────────────── Kouzelník z pouti ───────────────────────────

describe('Kouzelník z pouti (fair_magician)', () => {
  it('skórují všechny zahrané karty (i kopy) a každá dá ×1,15', () => {
    const g = roundGame(['fair_magician']);
    const r = playHand(g, 'KS KH 5C 3D 2S');
    expect(r.hand.type).toBe('pair');
    expect(r.hand.scoringIds).toHaveLength(5);
    let mult = 2;
    for (let i = 0; i < 5; i++) mult *= 1.15;
    // čipy 12 + 10 + 10 + 5 + 3 + 2 = 42
    expect(r.chips).toBe(42);
    expect(r.score).toBe(Math.floor(42 * mult)); // 168
    expect(jokerSteps(r, 'fair_magician')).toHaveLength(5);
    // Bez něj skóruje jen dvojice.
    expect(playHand(roundGame(), 'KS KH 5C 3D 2S').score).toBe(64);
  });

  it('opakovaná aktivace (červená pečeť) dá ×1,15 znovu, debuffnutá karta nic', () => {
    const g = roundGame(['fair_magician']);
    expect(playHand(g, 'KS@red KH').score).toBe(Math.floor(42 * 2 * 1.15 * 1.15 * 1.15)); // 127
    expect(playHand(g, 'KS KH!').score).toBe(Math.floor(22 * 2 * 1.15)); // 50
  });

  it('kopie dá ×1,15 za kartu znovu', () => {
    const g = roundGame(['copier', 'fair_magician']);
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.15 * 1.15 * 1.15 * 1.15)); // 111
  });

  it('trik: 1 z 5 (s probabilityMult 5 jistě), že jedna zahraná karta po ruce zmizí; skóruje ještě celá', () => {
    const g = roundGame(['fair_magician']);
    g._core.api.addPermanentModifier({ probabilityMult: 5 });
    const cards = setupRound(g, 'KS KH 5C');
    const r = play(g, cards).result;
    expect(r.score).toBe(Math.floor(37 * 2 * 1.15 ** 3));
    expect(r.destroyedCardIds).toHaveLength(1);
    expect(cards.map((c) => c.id)).toContain(r.destroyedCardIds[0]);
    expect(g.card(r.destroyedCardIds[0]!)).toBeUndefined();
    expect(r.steps.some((s) => s.message === 'jokers.fair_magician.vanished')).toBe(true);
    expect(joker(g, 'fair_magician').state.vanish).toBeNull();
    // s nulovou šancí nezmizí nic, ani s kopií
    const safe = roundGame(['copier', 'fair_magician']);
    safe._core.api.addPermanentModifier({ probabilityMult: 0 });
    expect(playHand(safe, 'KS KH 5C').destroyedCardIds).toEqual([]);
  });
});

// ─────────────────────────── Turistický průvodce ───────────────────────────

describe('Turistický průvodce (tour_guide)', () => {
  it('Barva ze 4 karet + 40 čipů; bez něj jen Vysoká karta', () => {
    const r = playHand(roundGame(['tour_guide']), 'AH 9H 6H 2H KS', [0, 1, 2, 3]);
    expect(r.hand.type).toBe('flush');
    // 40 + 11 + 9 + 6 + 2 = 68, +40 → 108 × 4
    expect(r.score).toBe(432);
    expect(jokerSteps(r, 'tour_guide')).toMatchObject([{ chips: 40 }]);
    expect(playHand(roundGame(), 'AH 9H 6H 2H KS', [0, 1, 2, 3]).score).toBe(17);
  });

  it('Postupka ze 4 karet, Postupka v barvě ze 4 karet i Barva z 5 karet dají čipy navíc', () => {
    const g = roundGame(['tour_guide']);
    const straight = playHand(g, '5S 6H 7D 8C');
    expect(straight.hand.type).toBe('straight');
    expect(straight.score).toBe((35 + 26 + 40) * 4);
    const sf = playHand(g, '5H 6H 7H 8H');
    expect(sf.hand.type).toBe('straight_flush');
    expect(sf.score).toBe((90 + 26 + 40) * 9);
    const five = playHand(g, 'AH 9H 6H 2H 3H');
    expect(five.hand.scoringIds).toHaveLength(5);
    expect(five.score).toBe((40 + 31 + 40) * 4);
  });

  it('ruka bez Postupky a Barvy nic nedostane', () => {
    const r = playHand(roundGame(['tour_guide']), 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'tour_guide')).toEqual([]);
  });

  it('spropitné: za ruku ze 4 karet s Barvou nebo Postupkou −1 Kč, z 5 karet a bez Barvy nic; kopie nic', () => {
    const g = roundGame(['copier', 'tour_guide']);
    g._core.state.money = 10;
    const cards = setupRound(g, 'AH 9H 6H 2H');
    const { events } = play(g, cards);
    expect(events).toContainEqual({ type: 'message', key: 'jokers.tour_guide.tip' });
    expect(g.state.money).toBe(9);
    playHand(g, 'AH 9H 6H 2H 3H');
    expect(g.state.money).toBe(9);
    playHand(g, 'KS KH 5C 5D');
    expect(g.state.money).toBe(9);
  });
});

// ─────────────────────────── Spartakiáda ───────────────────────────

describe('Spartakiáda (spartakiada)', () => {
  it('v první ruce kola skóruje každá skórující karta ještě 2×, v další ruce nic', () => {
    const g = roundGame(['spartakiada']);
    expect(playHand(g, 'KS KH').score).toBe((12 + 6 * 10) * 2); // 144
    expect(playHand(g, 'KS KH').score).toBe(64);
  });

  it('kamenná karta se opakuje taky, debuffnutá ne', () => {
    expect(playHand(roundGame(['spartakiada']), 'KS KH 2C:stone').score).toBe((12 + 60 + 3 * 50) * 2); // 444
    expect(playHand(roundGame(['spartakiada']), 'KS KH!').score).toBe((12 + 3 * 10) * 2); // 84
  });

  it('nové kolo začíná znovu první rukou; s Dechovkou se opakování sčítají', () => {
    const g = game(['spartakiada']);
    winRound(g);
    toBlindSelect(g);
    expect(playHand(g, 'KS KH').score).toBe(144);
    // 2 (Dechovka) + 2 (Spartakiáda) → 5 aktivací každého krále
    expect(playHand(roundGame(['brass_band', 'spartakiada']), 'KS KH').score).toBe((12 + 10 * 10) * 2);
  });
});

// ─────────────────────────── Kupónová privatizace ───────────────────────────

describe('Kupónová privatizace (voucher_privatization)', () => {
  /** Vyhraje Malou útratu Dvojicí králů (64 bodů) proti cíli `target` a vrátí rozpis odměn. */
  function payout(target: number, jokers: (string | JokerSpec)[] = ['voucher_privatization']): RoundRewards {
    const g = makeGame({ registry: reg, jokers, round: true });
    const cards = setupRound(g, 'KS KH');
    g._core.state.round!.target = target;
    play(g, cards);
    expect(g.state.phase).toBe('round_end');
    return structuredClone(g.state.rewards!);
  }

  it('+1 Kč za každých celých 5 % cíle navíc, nejvýš 8 Kč', () => {
    // přebytek 14 z cíle 50 = 28 % → 5 kroků
    expect(jokerReward(payout(50), 'voucher_privatization')).toBe(5);
    // 64 ≥ 60 × 1,05 = 63 → 1 krok; 64 < 61 × 1,05 = 64,05 → nic
    expect(jokerReward(payout(60), 'voucher_privatization')).toBe(1);
    expect(jokerReward(payout(61), 'voucher_privatization')).toBe(0);
    expect(jokerReward(payout(64), 'voucher_privatization')).toBe(0);
    // 24 z 40 = 60 % → 12 kroků, strop 8
    expect(jokerReward(payout(40), 'voucher_privatization')).toBe(8);
  });

  it('kolo zachráněné pod cílem nedá nic', () => {
    const g = makeGame({ registry: reg, jokers: ['lifeline', 'voucher_privatization'], round: true });
    const cards = setupRound(g, 'KS KH');
    const round = g._core.state.round!;
    round.target = 200;
    round.handsLeft = 1;
    play(g, cards);
    expect(g.state.phase).toBe('round_end');
    expect(jokerReward(g.state.rewards, 'voucher_privatization')).toBe(0);
  });

  it('kopie v rozpisu nic nedostane (nejde kopírovat)', () => {
    const rewards = payout(50, ['copier', 'voucher_privatization']);
    expect(rewards.extra.filter((e) => e.source === 'joker:voucher_privatization')).toHaveLength(1);
    expect(jokerReward(rewards, 'copier')).toBe(0);
  });
});

// ─────────────────────────── Lázeňský host ───────────────────────────

describe('Lázeňský host (spa_guest)', () => {
  it('na začátku nic; po kole bez zahazování trvale +×0,13', () => {
    const g = roundGame(['spa_guest']);
    const r = playHand(g, 'KS KH');
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'spa_guest')).toEqual([]);
    winRound(g);
    expect(joker(g, 'spa_guest').state.rounds).toBe(1);
    toBlindSelect(g);
    const r2 = playHand(g, 'KS KH');
    expect(jokerSteps(r2, 'spa_guest')).toMatchObject([{ xmult: 1.13 }]);
    expect(r2.score).toBe(Math.floor(32 * 2 * 1.13)); // 72
  });

  it('kolo se zahozením se nepočítá', () => {
    const g = roundGame(['spa_guest']);
    const round = g._core.state.round!;
    ok(g.dispatch({ type: 'discard', cardIds: [round.hand[0]!] }));
    winRound(g);
    expect(joker(g, 'spa_guest').state.rounds).toBe(0);
  });

  it('kopie stav nezdvojí, ale násobí znovu', () => {
    const g = game(['copier', 'spa_guest']);
    winRound(g);
    expect(joker(g, 'spa_guest').state.rounds).toBe(1);
    const g2 = roundGame(['copier', { id: 'spa_guest', state: { rounds: 2 } }]);
    expect(playHand(g2, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.26 * 1.26)); // 101
  });

  it('stav přežije uložení a načtení', () => {
    let g = game(['spa_guest']);
    winRound(g);
    toBlindSelect(g);
    winRound(g);
    g = reload(g);
    expect(joker(g, 'spa_guest').state.rounds).toBe(2);
    toBlindSelect(g);
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.26)); // 80
  });
});

// ─────────────────────────── Dechovka ───────────────────────────

describe('Dechovka (brass_band)', () => {
  it('Dvojice: každá karta ještě 2×; Trojice 4×; Dvě dvojice 2×; Full house 4× a 2×; Vysoká karta nic', () => {
    const g = roundGame(['brass_band']);
    expect(playHand(g, 'KS KH').score).toBe((12 + 6 * 10) * 2); // 144
    expect(playHand(g, 'KS KH KD').score).toBe((28 + 15 * 10) * 3); // 534
    expect(playHand(g, 'KS KH 5C 5D').score).toBe((24 + 3 * 30) * 2); // 228
    expect(playHand(g, 'KS KH KD 5C 5D').score).toBe((45 + 15 * 10 + 6 * 5) * 5); // 1125
    expect(playHand(g, 'KS').score).toBe(16);
  });

  it('kamenná karta se neopakuje ani nepočítá; debuffnutá karta se nepočítá', () => {
    const g = roundGame(['brass_band']);
    // dvojice 6 aktivací + kamenná jednou (0 + 50 čipů)
    expect(playHand(g, 'KS KH 2C:stone').score).toBe((12 + 60 + 50) * 2); // 244
    // KD debuffnutá: KS a KH mají jen po 1 další → 2× navíc
    expect(playHand(g, 'KS KH KD!').score).toBe((28 + 6 * 10) * 3); // 264
  });

  it('Pětice s červenou pečetí je přesně na stropu 10 aktivací, víc opakování se nevejde', () => {
    const g = roundGame(['brass_band']);
    // 4 karty × 9 aktivací + červená 1 + 8 + 1 = 10 → 46 × 10 čipů
    const r = playHand(g, 'KS KH KD KC KS@red');
    expect(r.hand.type).toBe('five');
    expect(r.score).toBe((110 + 460) * 11);
    // + figury ještě 1× (testovací face_echo): 4 × 10 a červená 11 → 10
    const g2 = roundGame(['brass_band', 'face_echo']);
    expect(playHand(g2, 'KS KH KD KC KS@red').score).toBe((110 + 500) * 11);
  });
});

// ─────────────────────────── Karlův most ───────────────────────────

describe('Karlův most (charles_bridge)', () => {
  it('×3, pokud v ruce zůstala karta stejné hodnoty jako skórující; jinak nic', () => {
    expect(playHand(roundGame(['charles_bridge']), 'KS KH 5C 5D KD', [0, 1]).score).toBe(32 * 2 * 3);
    const r = playHand(roundGame(['charles_bridge']), 'KS KH 5C 5D 7H', [0, 1]);
    expect(r.score).toBe(64);
    expect(jokerSteps(r, 'charles_bridge')).toEqual([]);
  });

  it('jednou za ruku, i při víc shodách', () => {
    const r = playHand(roundGame(['charles_bridge']), 'KS KH KD KC', [0, 1]);
    expect(jokerSteps(r, 'charles_bridge')).toMatchObject([{ xmult: 3 }]);
  });

  it('karta v ruce platí i debuffnutá, kamenná ne; debuffnutá skórující karta se nepočítá', () => {
    expect(playHand(roundGame(['charles_bridge']), 'KS KH KD!', [0, 1]).score).toBe(192);
    expect(playHand(roundGame(['charles_bridge']), 'KS KH KD:stone', [0, 1]).score).toBe(64);
    // Dvě dvojice, králové debuffnutí: v ruce král → nic, pětka → ×3
    expect(playHand(roundGame(['charles_bridge']), 'KS! KH! 5C 5D KD', [0, 1, 2, 3]).score).toBe(34 * 2);
    expect(playHand(roundGame(['charles_bridge']), 'KS! KH! 5C 5D 5H', [0, 1, 2, 3]).score).toBe(34 * 2 * 3);
  });
});

// ─────────────────────────── Dálnice D1 ───────────────────────────

describe('Dálnice D1 (d1_motorway)', () => {
  it('×2 mult a ruka o kartu menší', () => {
    const base = game().modifiers().handSize;
    const g = roundGame(['d1_motorway']);
    expect(g.modifiers().handSize).toBe(base - 1);
    expect(playHand(g, 'KS KH').score).toBe(128);
  });

  it('kopie dá ×2 znovu, ruku nezmenší podruhé', () => {
    const base = game().modifiers().handSize;
    const g = roundGame(['copier', 'd1_motorway']);
    expect(g.modifiers().handSize).toBe(base - 1);
    expect(playHand(g, 'KS KH').score).toBe(256);
  });

  it('po prodeji se ruka vrátí', () => {
    const g = game(['d1_motorway']);
    const base = game().modifiers().handSize;
    ok(g.dispatch({ type: 'sellJoker', uid: joker(g, 'd1_motorway').uid }));
    expect(g.modifiers().handSize).toBe(base);
  });
});

// ─────────────────────────── Směnárna ───────────────────────────

describe('Směnárna (exchange_office)', () => {
  it('+×0,1 za každých celých 15 čipů v okamžiku kroku 4', () => {
    const r = playHand(roundGame(['exchange_office']), 'KS KH');
    expect(jokerSteps(r, 'exchange_office')).toMatchObject([{ xmult: 1.2 }]);
    expect(r.score).toBe(Math.floor(32 * 2 * 1.2)); // 76
    expect(playHand(roundGame(['exchange_office']), 'KS+13 KH').score).toBe(Math.floor(45 * 2 * 1.3));
    expect(playHand(roundGame(['exchange_office']), 'KS+12 KH').score).toBe(Math.floor(44 * 2 * 1.2));
  });

  it('počítá i čipy od žolíků nalevo; strop ×2,1; pod 15 čipů nic', () => {
    expect(playHand(roundGame(['coaster', 'exchange_office']), 'KS KH').score).toBe(Math.floor(42 * 4 * 1.2));
    const capped = playHand(roundGame(['exchange_office']), 'KS+300 KH');
    expect(jokerSteps(capped, 'exchange_office')).toMatchObject([{ xmult: 2.1 }]);
    expect(capped.score).toBe(Math.floor(332 * 2 * 2.1));
    const low = playHand(roundGame(['exchange_office']), '2S');
    expect(low.score).toBe(8);
    expect(jokerSteps(low, 'exchange_office')).toEqual([]);
  });
});

// ─────────────────────────── Silvestr ───────────────────────────

describe('Silvestr (new_years_eve)', () => {
  it('na začátku nic; Malá útrata se nepočítá, porážka šéfa trvale +×0,2', () => {
    const g = game(['new_years_eve']);
    const r = playHand(g, 'KS KH');
    expect(jokerSteps(r, 'new_years_eve')).toEqual([]);
    winRound(g);
    expect(joker(g, 'new_years_eve').state.bosses).toBe(0);
    toBlindSelect(g);
    winBoss(g);
    expect(joker(g, 'new_years_eve').state.bosses).toBe(1);
    toBlindSelect(g);
    const r2 = playHand(g, 'KS KH');
    expect(jokerSteps(r2, 'new_years_eve')).toMatchObject([{ xmult: 1.2 }]);
    expect(r2.score).toBe(Math.floor(32 * 2 * 1.2)); // 76
  });

  it('stav přežije uložení a načtení', () => {
    let g = game(['new_years_eve']);
    winBoss(g);
    toBlindSelect(g);
    winBoss(g);
    g = reload(g);
    expect(joker(g, 'new_years_eve').state.bosses).toBe(2);
    toBlindSelect(g);
    expect(playHand(g, 'KS KH').score).toBe(Math.floor(32 * 2 * 1.4)); // 89
  });
});

// ─────────────────────────── Fuzz ───────────────────────────

describe('fuzz: obsah hry se všemi 12 žolíky přes boty', () => {
  const content = buildRegistry();

  function run(seed: string, bot: 'max' | 'pairs', reloadEvery: number): { actions: Action[]; json: string } {
    let g = Game.newRun({ seed, deckId: 'pub', stake: 1 }, content);
    const core = g._core;
    for (const id of IDS) core.state.jokers.push(newJokerInstance(core, id));
    core.invalidate();
    const decide = createBot(bot);
    const actions: Action[] = [];
    let invalid = 0;
    let since = 0;
    for (let step = 0; step < 1200; step++) {
      if (g.state.phase === 'game_over' || g.state.phase === 'victory') break;
      if (reloadEvery > 0 && ++since >= reloadEvery && g.state.phase === 'round') {
        g = reload(g);
        since = 0;
      }
      const s = g.state;
      const action: Action =
        invalid >= 3
          ? s.phase === 'round'
            ? { type: 'play', cardIds: s.round!.hand.slice(0, 1) }
            : s.phase === 'shop'
              ? { type: 'leaveShop' }
              : s.phase === 'booster'
                ? { type: 'skipBooster' }
                : s.phase === 'round_end'
                  ? { type: 'cashOut' }
                  : { type: 'selectBlind' }
          : decide.decide(g);
      actions.push(action);
      const res = g.dispatch(action);
      invalid = res.ok ? 0 : invalid + 1;
      for (const j of g.state.jokers) expect(JSON.parse(JSON.stringify(j)), `${seed} ${step}`).toEqual(j);
      expect(Number.isFinite(g.state.money), `${seed} ${step}`).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(g.state))).toEqual(g.state);
    return { actions, json: JSON.stringify(g.state) };
  }

  it.each([
    ['E2-FUZZ-A', 'max'],
    ['E2-FUZZ-B', 'pairs'],
  ] as const)(
    '%s (%s): bez výjimky, stav JSON-bezpečný, načtení uprostřed kola nic nezmění',
    (seed, bot) => {
      const plain = run(seed, bot, 0);
      const reloaded = run(seed, bot, 17);
      expect(reloaded.actions).toEqual(plain.actions);
      expect(reloaded.json).toBe(plain.json);
    },
    60_000,
  );
});
