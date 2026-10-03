/**
 * Adversariální revize pravidel runu (fáze 2) vůči CLAUDE.md kap. 3 a docs/DESIGN.md kap. 1, 2.4, 2.5, 2.9, 10.
 * Každý test dokazuje jeden nález revize (před opravou selhal); oprava je popsaná v docs/DECISIONS.md.
 */
import { describe, expect, it } from 'vitest';
import { PlaySession, renderState } from '../../scripts/simulate';
import { buildRegistry } from '../../src/content/index';
import { STAKES } from '../../src/content/stakes';
import type { ContentRegistry, StakeDef } from '../../src/engine/content-types';
import { BLIND_REWARDS, FINAL_ANTE } from '../../src/engine/constants';
import { newJokerInstance } from '../../src/engine/effects/api';
import { Game } from '../../src/engine/run/game';
import { jokerPrice } from '../../src/engine/shop/prices';
import type { ActionResult, BlindKind } from '../../src/engine/types';
import { t } from '../../src/i18n/cs';
import { formatMoney } from '../../src/i18n/format';
import { ART, makeGame, makeRegistry, winNextHand } from './fixtures/registry';

const reg = buildRegistry();

function ok(res: ActionResult): void {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
}

/** Vyhraje běžící kolo jednou kartou (cíl 1). */
function winRound(game: Game): void {
  winNextHand(game);
  ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
}

/** Řádek útraty na výběru útrat v textovém režimu (bez stavu a štítku). */
function blindLine(game: Game, kind: BlindKind, reward: number): string {
  const b = game.state.blinds.find((x) => x.kind === kind)!;
  return `  ${t('cli.play.blindSelect.line', {
    blind: t(`cli.blind.${kind}`),
    target: game.blindTarget(kind, b.bossId),
    reward,
    extra: '',
  })}`;
}

// ─────────────────────────── Odměna za útratu na výběru útrat ───────────────────────────

describe('odměna za útratu: výběr útrat ukazuje to, co se vyplatí (DESIGN 2.4.2)', () => {
  it('Zbohatlík (blindRewardMult ×2): textový režim ukazuje 6/8/10 Kč a výplata Malé je opravdu 6 Kč', () => {
    const game = Game.newRun({ seed: 'RICHVIEW', deckId: 'nouveau_riche', stake: 1 }, reg);
    expect(game.blindReward('small')).toBe(BLIND_REWARDS.small * 2);
    expect(game.blindReward('big')).toBe(BLIND_REWARDS.big * 2);
    expect(game.blindReward('boss')).toBe(BLIND_REWARDS.boss * 2);
    const lines = renderState(game);
    expect(lines.some((l) => l.startsWith(blindLine(game, 'small', 6)))).toBe(true);
    expect(lines.some((l) => l.startsWith(blindLine(game, 'big', 8)))).toBe(true);
    expect(lines.some((l) => l.startsWith(blindLine(game, 'boss', 10)))).toBe(true);
    ok(game.dispatch({ type: 'selectBlind' }));
    winRound(game);
    expect(game.state.rewards!.blindReward).toBe(6);
  });

  it('obtížnost bez odměny za Malou: výběr útrat ukazuje 0 Kč; vlastní odměna šéfa se násobí taky', () => {
    const stingy: StakeDef = { id: 'stingy', level: 2, noSmallBlindReward: true, art: ART };
    const registry = makeRegistry({ stakes: [stingy] });
    registry.bosses = { rich: { id: 'rich', color: '#000', reward: 7, hooks: {}, art: ART } };
    const game = makeGame({ registry, stake: 2 });
    expect(game.state.blinds[2]!.bossId).toBe('rich');
    expect(game.blindReward('small')).toBe(0);
    expect(game.blindReward('boss', 'rich')).toBe(7);
    const lines = renderState(game);
    expect(lines.some((l) => l.startsWith(blindLine(game, 'small', 0)))).toBe(true);
    expect(lines.some((l) => l.startsWith(blindLine(game, 'boss', 7)))).toBe(true);
  });
});

// ─────────────────────────── Prázdná Večerka ───────────────────────────

describe('Večerka: prázdný stav po vykoupení všeho (DESIGN 2.5.1)', () => {
  it('když je všechno koupené, textový režim ukáže „Večerka zavřená – inventura“', () => {
    const game = makeGame({ round: true });
    winRound(game);
    ok(game.dispatch({ type: 'cashOut' }));
    game._core.state.money = 1000;
    const shop = game.state.shop!;
    expect(shop.items.length + shop.boosters.length).toBeGreaterThan(0);
    expect(renderState(game)).not.toContain(t('cli.play.shop.empty'));
    for (let i = 0; i < shop.items.length; i++) ok(game.dispatch({ type: 'buy', slot: i }));
    for (let i = 0; i < shop.boosters.length; i++) {
      ok(game.dispatch({ type: 'buyBooster', slot: i }));
      ok(game.dispatch({ type: 'skipBooster' }));
    }
    for (let i = 0; i < shop.vouchers.length; i++) ok(game.dispatch({ type: 'buyVoucher', slot: i }));
    expect(game.state.phase).toBe('shop');
    const lines = renderState(game);
    expect(lines).toContain(t('cli.play.shop.empty'));
    // Přehodit jde dál — přehození nabídku karet doplní.
    expect(lines).toContain(t('cli.play.shop.reroll', { cost: game.state.shop!.rerollCost }));
  });
});

// ─────────────────────────── Doppelbock: cena zapůjčeného žolíka ───────────────────────────

describe('Doppelbock: popisek ceny zapůjčeného žolíka sedí s cenou ve Večerce (DESIGN 4.6, 10)', () => {
  it('na Doppelbocku stojí zapůjčený žolík tolik, kolik říká popisek (i od 2. patra — Jedenáctka zdražuje jen přehození)', () => {
    const registry: ContentRegistry = {
      ...makeRegistry(),
      stakes: Object.fromEntries(STAKES.map((s) => [s.id, s])),
    };
    const doppelbock = STAKES.find((s) => s.id === 'doppelbock')!;
    const jedenactka = STAKES.find((s) => s.id === 'jedenactka')!;
    for (const level of [7, 8]) {
      const game = makeGame({ registry, stake: level });
      const rental = newJokerInstance(game._core, 'epic_one', null, ['rental']);
      const price = jokerPrice(game._core, rental);
      expect(price).toBe(doppelbock.params!.price);
      expect(t('stakes.doppelbock.desc', doppelbock.params)).toContain(`akontace ${formatMoney(price)}`);
      game._core.state.ante = Number(jedenactka.params!.fromAnte);
      game._core.invalidate();
      expect(jokerPrice(game._core, rental)).toBe(price);
    }
  });

  it('obtížnosti mají `params` přímo v `StakeDef` (registr je nese bez přetypování)', () => {
    const special = reg.stakes.special!;
    const params: Record<string, number | string> | undefined = special.params;
    expect(params).toEqual({ perishable: 40, rounds: 6 });
  });
});

// ─────────────────────────── Textový režim: pitva, výhra, nekonečný režim ───────────────────────────

describe('textový režim: pitva, výhra a nekonečný režim', () => {
  it('pitva má hlášku podle příčiny (CLAUDE.md kap. 3, DESIGN 1.2 a příloha C)', () => {
    for (const [kind, skips] of [
      ['small', 0],
      ['big', 1],
    ] as const) {
      const game = Game.newRun({ seed: 'DEATHTXT', deckId: 'pub', stake: 1 }, reg);
      for (let i = 0; i < skips; i++) ok(game.dispatch({ type: 'skipBlind' }));
      ok(game.dispatch({ type: 'selectBlind' }));
      game._core.state.round!.handsLeft = 1;
      game._core.state.round!.target = 1e9;
      ok(game.dispatch({ type: 'play', cardIds: [game.state.round!.hand[0]!] }));
      expect(game.state.phase).toBe('game_over');
      expect(renderState(game)).toContain(t(`cli.play.gameOver.death.${kind}`));
    }
  });

  it('výhra ukáže statistiku runu (CLAUDE.md kap. 3: „výhra (titulky, statistika runu)“)', () => {
    const game = Game.newRun({ seed: 'WINSTATS', deckId: 'pub', stake: 1 }, reg);
    game._core.state.ante = FINAL_ANTE;
    for (let i = 0; i < 3; i++) {
      ok(game.dispatch({ type: 'selectBlind' }));
      winRound(game);
      if (game.state.phase === 'round_end') {
        ok(game.dispatch({ type: 'cashOut' }));
        ok(game.dispatch({ type: 'leaveShop' }));
      }
    }
    expect(game.state.phase).toBe('victory');
    const s = game.state.stats;
    expect(renderState(game)).toContain(
      t('cli.play.gameOver.stats', {
        rounds: s.roundsWon,
        best: s.bestHandScore,
        hand: t(`hands.${s.bestHandType}.name`),
      }),
    );
  });

  it('štítky za přeskočení jsou vidět (hromadí se, DESIGN 7) — na výběru útrat i v kole', () => {
    const game = makeGame();
    // `lazy_tag` se nikdy nespotřebuje (onBlindSelect vrací false) — zůstane ve frontě i během kola.
    const tagId = 'lazy_tag';
    game._core.state.blinds[0]!.skipTagId = tagId;
    ok(game.dispatch({ type: 'skipBlind' }));
    expect(game.state.tags.map((x) => x.defId)).toEqual([tagId]);
    const line = (g: Game) =>
      renderState(g).find((l) => l.startsWith(t('cli.play.owned.tags', { list: '' })));
    expect(line(game)).toContain(tagId);
    ok(game.dispatch({ type: 'selectBlind' }));
    expect(line(game)).toContain(tagId);
  });

  it('v nekonečném režimu záhlaví neukazuje „Patro 9/8“', () => {
    const game = Game.newRun({ seed: 'ENDLESSTXT', deckId: 'pub', stake: 1 }, reg);
    game._core.state.ante = FINAL_ANTE;
    for (let i = 0; i < 3; i++) {
      ok(game.dispatch({ type: 'selectBlind' }));
      winRound(game);
      if (game.state.phase === 'round_end') {
        ok(game.dispatch({ type: 'cashOut' }));
        ok(game.dispatch({ type: 'leaveShop' }));
      }
    }
    const session = new PlaySession(game);
    session.input('d'); // nekonečný režim
    const out = session.input('d'); // výplata → patro 9
    expect(game.state.ante).toBe(FINAL_ANTE + 1);
    const text = out.join('\n');
    expect(text).not.toContain(`${FINAL_ANTE + 1}/${FINAL_ANTE}`);
    expect(text).toContain(
      t('cli.play.headerEndless', { ante: FINAL_ANTE + 1, what: t('cli.play.shop.title') }),
    );
  });
});
