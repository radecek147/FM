/**
 * Obtížnosti „Síla piva“ (src/content/stakes.ts) podle docs/DESIGN.md kap. 10: každá úroveň přidává právě své
 * ztížení a obtížnost N obsahuje všechna ztížení úrovní ≤ N (kumulaci řeší engine).
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { STAKES } from '../../src/content/stakes';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { bossHasRule } from '../../src/engine/run/bosses';
import { Game } from '../../src/engine/run/game';
import { stakeStickerChance } from '../../src/engine/shop/shop';
import type { Modifiers } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { formatNumber, typo } from '../../src/i18n/format';
import { makeRegistry, winNextHand } from './fixtures/registry';

const reg = buildRegistry();

function newGame(stake: number, registry = reg): Game {
  return Game.newRun({ seed: 'STAKETEST', deckId: 'pub', stake }, registry);
}

/** Hra dané obtížnosti přepnutá do patra `ante` (ztížení Jedenáctky a Ležáku platí až od 2. / 3. patra). */
function gameAtAnte(stake: number, ante: number): Game {
  const g = newGame(stake);
  g._core.state.ante = ante;
  g._core.invalidate();
  return g;
}

/** Modifikátory, ve kterých se obtížnost liší od výchozích (BASE_MODIFIERS); výchozí patro 3 = všechna ztížení. */
function modsDiff(stake: number, ante = 3): Partial<Modifiers> {
  const m = gameAtAnte(stake, ante).modifiers();
  const out: Partial<Modifiers> = {};
  for (const key of Object.keys(BASE_MODIFIERS) as (keyof Modifiers)[]) {
    if (m[key] !== BASE_MODIFIERS[key]) (out as Record<string, unknown>)[key] = m[key];
  }
  return out;
}

/** Cíl Malé útraty v patře 8 (podle křivky cílů obtížnosti). */
function finalSmallTarget(stake: number): number {
  const g = newGame(stake);
  g._core.state.ante = 8;
  return g.blindTarget('small');
}

/** Vyhraje Malou útratu jedinou rukou (volitelně v patře `ante`) a vrátí rozpis odměn. */
function winSmallBlind(stake: number, ante = 1) {
  const g = ante === 1 ? newGame(stake) : gameAtAnte(stake, ante);
  g.dispatch({ type: 'selectBlind' });
  winNextHand(g);
  const res = g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
  expect(res.ok).toBe(true);
  return { game: g, rewards: g.state.rewards! };
}

describe('obtížnosti – seznam (DESIGN kap. 10)', () => {
  it('8 úrovní v pořadí Desítka … Imperial s anglickými id podle DESIGN', () => {
    expect(STAKES.map((s) => [s.level, s.id])).toEqual([
      [1, 'desitka'],
      [2, 'jedenactka'],
      [3, 'dvanactka'],
      [4, 'special'],
      [5, 'lezak'],
      [6, 'bock'],
      [7, 'doppelbock'],
      [8, 'imperial'],
    ]);
    expect(Object.keys(reg.stakes)).toHaveLength(8);
  });

  it('každá úroveň má název, popis a flavor; čísla v popisku jdou z params', () => {
    const flavors: Record<string, string> = {
      desitka: 'Na rozehřátí. Zatím se nikdo nezranil.',
      jedenactka: 'Pivo zdražilo. Zase.',
      dvanactka: 'Klasika. Cíle rostou rychleji než útrata.',
      special: 'Speciál se pije pomalu. Žolíci zvětrají rychle.',
      lezak: 'Dýško? To se dneska nenosí.',
      bock: 'Tmavé, silné a cíle až do stropu.',
      doppelbock: 'Co je přibité, neprodáš. Co je půjčené, platíš.',
      imperial: 'Šéf sedí u každého stolu.',
    };
    for (const s of STAKES) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`stakes.${s.id}.${field}`), `${s.id}.${field}`).toBe(true);
      expect(t(`stakes.${s.id}.name`).split(/\s+/).length).toBeLessThanOrEqual(3);
      const raw = t(`stakes.${s.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(s.params ?? {}, `${s.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`stakes.${s.id}.desc`, s.params ?? {})).not.toMatch(/[{}⟦]/);
      expect(t(`stakes.${s.id}.flavor`)).toBe(typo(flavors[s.id]!));
    }
    expect(t('stakes.jedenactka.desc', STAKES[1]!.params)).toContain(typo('od 2. patra'));
    expect(t('stakes.jedenactka.desc', STAKES[1]!.params)).toContain(typo('přehození ve Večerce o 1 Kč víc'));
    expect(t('stakes.lezak.desc', STAKES[4]!.params)).toContain(typo('od 3. patra'));
    expect(t('stakes.special.desc', STAKES[3]!.params)).toContain('40 %');
    expect(t('stakes.special.desc', STAKES[3]!.params)).toContain('6 kolech');
    expect(t('stakes.dvanactka.desc', STAKES[2]!.params)).toContain(formatNumber(110_000));
    expect(t('stakes.imperial.desc', STAKES[7]!.params)).toContain(typo('cíle šéfů jsou o 10 % vyšší'));
  });
});

describe('obtížnosti – každá úroveň přidává právě své ztížení', () => {
  it('1 Desítka: základní pravidla, křivka cílů 1', () => {
    expect(modsDiff(1)).toEqual({});
    expect(newGame(1).targetCurve()).toBe(1);
    expect(finalSmallTarget(1)).toBe(95_000);
    const g = newGame(1);
    expect([g.blindTarget('small'), g.blindTarget('big'), g.blindTarget('boss')]).toEqual([250, 380, 500]);
    expect(stakeStickerChance(g._core)).toEqual({});
  });

  it('2 Jedenáctka: od 2. patra přehození o 1 Kč dráž, jinak beze změny (ceny zboží i prodej stejné)', () => {
    expect(modsDiff(2)).toEqual({ rerollBaseCost: BASE_MODIFIERS.rerollBaseCost + 1 });
    expect(modsDiff(2, 2)).toEqual({ rerollBaseCost: BASE_MODIFIERS.rerollBaseCost + 1 });
    expect(modsDiff(2, 1)).toEqual({});
    expect(newGame(2).targetCurve()).toBe(1);
    // Patro 1: Večerka za běžné ceny.
    const { game } = winSmallBlind(2);
    expect(game.dispatch({ type: 'cashOut' }).ok).toBe(true);
    expect(game.state.shop!.rerollCost).toBe(BASE_MODIFIERS.rerollBaseCost);
    // Večerka po šéfovi 1. patra už patří 2. patru (patro se zvedne při výplatě) → příplatek.
    const boss = newGame(2);
    boss._core.state.blindIndex = 2;
    boss._core.state.blinds[0]!.status = 'defeated';
    boss._core.state.blinds[1]!.status = 'defeated';
    boss._core.state.blinds[2]!.status = 'current';
    boss.dispatch({ type: 'selectBlind' });
    expect(boss.state.round!.blind).toBe('boss');
    boss._core.api.disableBoss();
    winNextHand(boss);
    expect(boss.dispatch({ type: 'play', cardIds: [boss.state.round!.hand[0]!] }).ok).toBe(true);
    expect(boss.dispatch({ type: 'cashOut' }).ok).toBe(true);
    expect(boss.state.ante).toBe(2);
    expect(boss.state.shop!.rerollCost).toBe(BASE_MODIFIERS.rerollBaseCost + 1);
    // Zboží za běžné ceny i od 2. patra (příplatek je jen na přehození).
    expect(boss.modifiers().shopPriceAdd).toBe(0);
    const { game: cheap } = winSmallBlind(1);
    cheap.dispatch({ type: 'cashOut' });
    expect(cheap.state.shop!.rerollCost).toBe(BASE_MODIFIERS.rerollBaseCost);
  });

  it('3 Dvanáctka: křivka cílů 2', () => {
    expect(modsDiff(3)).toEqual({ rerollBaseCost: BASE_MODIFIERS.rerollBaseCost + 1 });
    expect(newGame(3).targetCurve()).toBe(2);
    expect(finalSmallTarget(3)).toBe(110_000);
    expect(finalSmallTarget(2)).toBe(95_000);
  });

  it('4 Speciál: 40 % žolíků zvětrávajících', () => {
    expect(stakeStickerChance(newGame(3)._core)).toEqual({});
    expect(stakeStickerChance(newGame(4)._core)).toEqual({ perishable: 0.4 });
    expect(modsDiff(4)).toEqual(modsDiff(3));
    expect(newGame(4).targetCurve()).toBe(2);
  });

  it('5 Ležák: od 3. patra nevyužité ruce nedávají peníze', () => {
    expect(modsDiff(5)).toEqual({ rerollBaseCost: BASE_MODIFIERS.rerollBaseCost + 1, moneyPerUnusedHand: 0 });
    expect(modsDiff(5, 2)).toEqual({ rerollBaseCost: BASE_MODIFIERS.rerollBaseCost + 1 });
    expect(modsDiff(5, 1)).toEqual({});
    // Patra 1–2: dýško ještě je.
    expect(winSmallBlind(5).rewards.unusedHands).toBe(BASE_MODIFIERS.hands - 1);
    expect(winSmallBlind(4, 3).rewards.unusedHands).toBe(BASE_MODIFIERS.hands - 1);
    const { rewards } = winSmallBlind(5, 3);
    expect(rewards.unusedHands).toBe(0);
    expect(rewards.blindReward).toBe(3);
  });

  it('6 Bock: křivka cílů 3', () => {
    expect(newGame(5).targetCurve()).toBe(2);
    expect(newGame(6).targetCurve()).toBe(3);
    expect(finalSmallTarget(6)).toBe(115_000);
    expect(modsDiff(6)).toEqual(modsDiff(5));
  });

  it('7 Doppelbock: 25 % přibitých a 25 % zapůjčených žolíků (zvětrávání ze Speciálu zůstává)', () => {
    expect(stakeStickerChance(newGame(6)._core)).toEqual({ perishable: 0.4 });
    expect(stakeStickerChance(newGame(7)._core)).toEqual({ perishable: 0.4, eternal: 0.25, rental: 0.25 });
    expect(modsDiff(7)).toEqual(modsDiff(6));
  });

  it('8 Imperial: Velká útrata má pravidlo jiného běžného šéfa s pravidlem (cíl a odměna zůstávají), šéf ×1,1', () => {
    const withBosses = { ...makeRegistry(), stakes: reg.stakes, decks: reg.decks };
    for (const seed of ['IMP1', 'IMP2', 'IMP3', 'IMP4']) {
      const g7 = Game.newRun({ seed, deckId: 'pub', stake: 7 }, withBosses);
      expect(g7.state.blinds[1]!.bossId).toBeNull();
      const g8 = Game.newRun({ seed, deckId: 'pub', stake: 8 }, withBosses);
      const big = g8.state.blinds[1]!;
      const boss = g8.state.blinds[2]!;
      expect(big.bossId).not.toBeNull();
      expect(big.bossId).not.toBe(boss.bossId);
      const def = withBosses.bosses[big.bossId!]!;
      expect(def.final).not.toBe(true);
      expect(bossHasRule(def)).toBe(true);
      expect(g8.blindTarget('big')).toBe(g7.blindTarget('big'));
      expect(g8.blindTarget('small')).toBe(g7.blindTarget('small'));
      // Cíl šéfa: 500 × 1,1 = 550 (patro 1, výchozí násobek šéfa 2×).
      expect([g7.blindTarget('boss'), g8.blindTarget('boss')]).toEqual([500, 550]);
    }
    expect(modsDiff(8)).toEqual({ ...modsDiff(7), bossTargetMult: 1.1 });
  });
});

describe('obtížnosti – kumulace', () => {
  it('Imperial obsahuje všechna ztížení nižších úrovní', () => {
    const g = gameAtAnte(8, 3);
    expect(g.targetCurve()).toBe(3);
    expect(g.modifiers().rerollBaseCost).toBe(BASE_MODIFIERS.rerollBaseCost + 1);
    expect(g.modifiers().moneyPerUnusedHand).toBe(0);
    expect(stakeStickerChance(g._core)).toEqual({ perishable: 0.4, eternal: 0.25, rental: 0.25 });
    expect(Object.values(reg.stakes).some((s) => s.level <= 8 && s.bigBlindBoss)).toBe(true);
  });

  it('křivka cílů nikdy neklesá a každé ztížení platí od své úrovně výš', () => {
    let prevCurve = 0;
    for (let stake = 1; stake <= 8; stake++) {
      const g = gameAtAnte(stake, 3);
      expect(g.targetCurve()).toBeGreaterThanOrEqual(prevCurve);
      prevCurve = g.targetCurve();
      expect(g.modifiers().rerollBaseCost).toBe(BASE_MODIFIERS.rerollBaseCost + (stake >= 2 ? 1 : 0));
      expect(g.modifiers().moneyPerUnusedHand).toBe(stake >= 5 ? 0 : 1);
      expect(stakeStickerChance(g._core).perishable ?? 0).toBe(stake >= 4 ? 0.4 : 0);
      expect(stakeStickerChance(g._core).eternal ?? 0).toBe(stake >= 7 ? 0.25 : 0);
    }
  });

  it('žádná úroveň nebere odměnu za Malou útratu (to v 1.0 nedělá žádná síla piva)', () => {
    expect(STAKES.some((s) => s.noSmallBlindReward)).toBe(false);
    expect(winSmallBlind(8).rewards.blindReward).toBe(3);
  });
});
