// @vitest-environment happy-dom
/**
 * UI šéfů a štítků (fáze 6): texty šéfů s parametry, vysvětlení „proč mimo provoz“ v tooltipech karet a žolíků,
 * výběr útraty (pravidlo, oslabený šéf), levý panel (šéf, štítky, zakázaná kombinace), plakát příchodu,
 * velikost ruky (Velká voda), pitva se šéfem, Info o runu a rozpis odměn se štítkem. Animace jsou vypnuté.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { Card, JokerInstance, RunState } from '../../src/engine';
import { Game, serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import { cardTooltip, jokerTooltip, type TooltipLine } from '../../src/ui/components/tooltip';
import { GameController } from '../../src/ui/controller';
import { activeBossId, bossReasonText, bossTexts } from '../../src/ui/describe';
import { gameScreen } from '../../src/ui/screens/game';
import { deathQuote } from '../../src/ui/screens/game/endScreens';
import { rewardSourceLabel } from '../../src/ui/screens/game/roundEnd';
import { itemBadge } from '../../src/ui/screens/game/shop';
import { memoryStore, STORAGE_KEYS, type KeyValueStore } from '../../src/ui/storage';

const REG = registry();

let app: App;
let store: KeyValueStore;
let root: HTMLElement;

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div><canvas id="fx"></canvas>';
  root = document.querySelector<HTMLElement>('#app')!;
  store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = new App(root, store, REG);
  app.register('game', gameScreen);
  app.register('menu', () => ({ el: document.createElement('main') }));
  app.register('newGame', () => ({ el: document.createElement('main') }));
});

beforeEach(() => {
  store.remove(STORAGE_KEYS.run);
});

afterEach(() => {
  closeAllModals();
});

// ─────────────────────────── Pomocníci ───────────────────────────

function newState(seed: string, stake = 1): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake, seed }, REG).state) as RunState;
}

/** Run ve výběru útraty se šéfem na řadě. */
function bossSelect(seed: string, bossId: string, ante = 2, jokers: JokerInstance[] = []): RunState {
  const s = newState(seed);
  s.ante = ante;
  s.blinds[0]!.status = 'defeated';
  s.blinds[1]!.status = 'defeated';
  s.blinds[2]!.status = 'current';
  s.blinds[2]!.bossId = bossId;
  s.blindIndex = 2;
  s.jokers = jokers;
  return s;
}

function bossRound(seed: string, bossId: string, ante = 2, jokers: JokerInstance[] = []): RunState {
  const g = Game.fromState(bossSelect(seed, bossId, ante, jokers), REG);
  expect(g.dispatch({ type: 'selectBlind' }).ok).toBe(true);
  return structuredClone(g.state) as RunState;
}

function joker(uid: number, defId: string): JokerInstance {
  const def = REG.jokers[defId]!;
  return {
    uid,
    defId,
    edition: null,
    state: def.initState?.() ?? {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
  };
}

/** Controller z uloženého stavu (jako Pokračovat) a herní obrazovka nad ním. */
function open(state: RunState): GameController {
  store.set(STORAGE_KEYS.run, serializeRun(state, '2026-10-02T00:00:00.000Z'));
  const c = GameController.resume({ registry: REG, store });
  if (!c) throw new Error('resume failed');
  app.controller = c;
  app.go('game');
  return c;
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
}

const q = (testId: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const text = (testId: string): string => (q(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const lineTexts = (lines: readonly (string | TooltipLine | null | undefined)[] | undefined): string[] =>
  (lines ?? []).flatMap((l) => (l ? [typeof l === 'string' ? l : l.text] : []));

// ─────────────────────────── Texty ───────────────────────────

describe('texty šéfů v UI', () => {
  it('každý šéf má jméno, pravidlo, příchod, porážku a pitvu bez nedosazených {parametrů}', () => {
    for (const id of Object.keys(REG.bosses)) {
      const tx = bossTexts(id, { registry: REG });
      for (const v of [tx.name, tx.rule, tx.intro, tx.defeat, tx.death]) {
        expect(v, id).toBeTruthy();
        expect(v, id).not.toMatch(/[{}⟦]/);
      }
    }
  });

  it('hláška pitvy šéfa v uvozovkách; neznámý šéf a útraty mají obecnou', () => {
    expect(deathQuote('tax_audit')).toBe(t('game.gameOver.quote', { text: t('bosses.tax_audit.death') }));
    expect(norm(deathQuote('tax_audit'))).toContain('Doklady k tomu nemáte, že?');
    expect(deathQuote('small')).toBe(t('game.death.small'));
    expect(deathQuote('neznamy')).toBe(t('game.death.boss'));
  });

  it('rozpis odměn: peníze ze štítku mají jeho název', () => {
    expect(rewardSourceLabel('tag:term_deposit')).toBe(
      t('game.roundEnd.tag', { name: t('tags.term_deposit.name') }),
    );
    expect(rewardSourceLabel('tag:neznamy')).toBe(t('game.roundEnd.other'));
  });

  it('nálepky zboží ze štítků: navíc, sleva, edice bez příplatku', () => {
    const j = joker(1, 'beer_mat');
    const item = { kind: 'joker' as const, joker: j, price: 3, sold: false };
    expect(itemBadge(item)).toBeNull();
    expect(itemBadge({ ...item, extra: true, priceMult: 0.5 })).toBe(
      `${t('game.shop.badgeExtra')} · ${t('game.shop.badgeDiscount', { pct: 50 })}`,
    );
    expect(itemBadge({ ...item, noEditionSurcharge: true })).toBeNull();
    expect(itemBadge({ ...item, joker: { ...j, edition: 'foil' }, noEditionSurcharge: true })).toBe(
      t('game.shop.badgeEdition'),
    );
  });

  it('activeBossId a bossReasonText jen v kole s platným pravidlem', () => {
    const round = bossRound('UIBOSS-REASON', 'inventory');
    expect(activeBossId(round, REG)).toBe('inventory');
    const tx = bossTexts('inventory', { registry: REG });
    expect(bossReasonText(round, REG)).toBe(t('art.tooltip.bossReason', { name: tx.name, rule: tx.rule }));
    round.round!.bossDisabled = true;
    expect(activeBossId(round, REG)).toBeNull();
    expect(bossReasonText(round, REG)).toBeNull();
    expect(bossReasonText(newState('UIBOSS-NONE'), REG)).toBeNull();
  });

  it('tooltip karty mimo provoz / lícem dolů vysvětlí pravidlo šéfa, čipy mimo provoz ztlumí', () => {
    const base: Card = {
      id: 1,
      suit: 'H',
      rank: 12,
      enhancement: null,
      seal: null,
      edition: null,
      bonusChips: 0,
      debuffed: true,
      faceDown: false,
    };
    const reason = 'Šéf X: pravidlo.';
    const debuffed = cardTooltip(base, { registry: REG, reason });
    expect(lineTexts(debuffed.lines)).toEqual(expect.arrayContaining([t('art.card.debuffedHint'), reason]));
    const chips = debuffed.lines?.find((l) => typeof l === 'object' && l?.text.includes('10'));
    expect(chips).toMatchObject({ muted: true });
    const down = cardTooltip({ ...base, debuffed: false, faceDown: true }, { registry: REG, reason });
    expect(lineTexts(down.lines)).toEqual([t('art.card.faceDownHint'), reason]);
    expect(lineTexts(cardTooltip({ ...base, debuffed: false }, { registry: REG }).lines)).not.toContain(
      reason,
    );
  });

  it('tooltip žolíka vypnutého šéfem (Exekutor) říká proč', () => {
    const s = bossRound('UIBOSS-EXEK', 'bailiff', 2, [joker(901, 'beer_mat'), joker(902, 'hearts_man')]);
    const off = s.jokers.find((j) => s.round!.jokerDebuffs.includes(j.uid));
    expect(off).toBeDefined();
    const tx = bossTexts('bailiff', { registry: REG });
    const lines = lineTexts(jokerTooltip(off!, { registry: REG, run: () => s }).lines);
    expect(lines).toContain(t('art.tooltip.jokerDebuffed'));
    expect(lines).toContain(t('art.tooltip.bossReason', { name: tx.name, rule: tx.rule }));
    const on = s.jokers.find((j) => j.uid !== off!.uid)!;
    expect(lineTexts(jokerTooltip(on, { registry: REG, run: () => s }).lines)).not.toContain(
      t('art.tooltip.jokerDebuffed'),
    );
  });
});

// ─────────────────────────── Obrazovky ───────────────────────────

describe('herní obrazovka se šéfy a štítky', () => {
  it('výběr útraty: pravidlo šéfa, oslabený cíl po Šéf má chřipku, štítek v levém panelu', async () => {
    const s = newState('UIBOSS-TAGS');
    s.blinds[0]!.skipTagId = 'boss_flu';
    const c = open(s);
    const bossId = s.blinds[2]!.bossId!;
    expect(norm(q('blind-boss')!.querySelector('.blind-card__rule')!.textContent!)).toBe(
      norm(bossTexts(bossId, { registry: REG }).rule),
    );
    expect(q('active-tags')!.hidden).toBe(true);
    expect(q('blind-boss-target-note')).toBeNull();

    await c.act({ type: 'skipBlind' });
    await settle(c);
    expect(q('active-tags')!.hidden).toBe(false);
    const token = q('active-tags')!.querySelector<HTMLElement>('.kcard')!;
    expect(token.dataset.defId).toBe('boss_flu');
    expect(token.getAttribute('aria-label')).toContain(t('tags.boss_flu.name'));
    expect(text('blind-boss-target-note')).toBe(norm(t('game.blinds.bossWeakened', { pct: 25 })));
    expect(root.textContent).not.toMatch(/[{⟦]/);
  });

  it('Imperial: Velká útrata má ve výběru i v kole pravidlo šéfa navíc', async () => {
    const s = newState('UIBOSS-IMP', 8);
    const extra = s.blinds[1]!.bossId;
    expect(extra).toBeTruthy();
    s.blinds[0]!.status = 'defeated';
    s.blinds[1]!.status = 'current';
    s.blindIndex = 1;
    const c = open(s);
    const rule = bossTexts(extra!, { registry: REG }).rule;
    expect(norm(q('blind-big')!.querySelector('.blind-card__rule')!.textContent!)).toBe(
      norm(t('game.blinds.extraRule', { rule })),
    );
    await c.act({ type: 'selectBlind' });
    await settle(c);
    expect(text('blind-rule')).toBe(norm(t('game.blinds.extraRule', { rule })));
    expect(q('boss-banner')!.hidden).toBe(false);
    expect(text('boss-banner')).toContain(norm(t('game.bossBanner.extraLabel')));
  });

  it('příchod šéfa: plakát se jménem, pravidlem a hláškou; pravidlo v levém panelu; Výluka zakryje karty', async () => {
    const c = open(bossSelect('UIBOSS-VYLUKA', 'track_closure'));
    await c.act({ type: 'selectBlind' });
    await settle(c);
    const tx = bossTexts('track_closure', { registry: REG });
    const banner = q('boss-banner')!;
    expect(banner.hidden).toBe(false);
    expect(norm(banner.textContent!)).toContain(norm(tx.name));
    expect(norm(banner.textContent!)).toContain(norm(tx.rule));
    expect(norm(banner.textContent!)).toContain(norm(tx.intro!));
    expect(text('blind-name')).toBe(norm(tx.name));
    expect(text('blind-rule')).toBe(norm(tx.rule));
    expect(q('game-live')!.textContent).toContain(tx.intro!);
    const down = root.querySelectorAll('[data-testid="hand"] .pcard.is-face-down');
    expect(down.length).toBe(Math.floor(c.state.round!.hand.length / 2));

    // Zahrání plakát schová.
    c.toggleSelect(c.state.round!.hand[0]!);
    await c.play();
    await settle(c);
    expect(banner.hidden).toBe(true);
  });

  it('Soused s vrtačkou: zakázaná kombinace je v náhledu označená', async () => {
    const s = bossRound('UIBOSS-VRTACKA', 'drilling_neighbor');
    s.round!.handTypesPlayed = ['high_card'];
    const c = open(s);
    expect(q('hand-blocked')!.hidden).toBe(true);
    c.toggleSelect(c.state.round!.hand[0]!);
    expect(q('hand-blocked')!.hidden).toBe(false);
    expect(text('hand-blocked')).toBe(
      norm(t('game.sidebar.handBlocked', { reason: t('bosses.drilling_neighbor.blocked') })),
    );
    c.clearSelection();
    expect(q('hand-blocked')!.hidden).toBe(true);
  });

  it('Velká voda: velikost ruky po zahrání klesne a ukáže změnu', async () => {
    const c = open(bossRound('UIBOSS-VODA', 'great_flood', 8));
    const n = c.state.round!.hand.length;
    expect(text('hand-size')).toBe(norm(t('game.hand.handSize', { n })));
    c.toggleSelect(c.state.round!.hand[0]!);
    await c.play();
    await settle(c);
    expect(text('hand-size')).toBe(norm(t('game.hand.handSizeDelta', { n: n - 1, delta: -1 })));
    expect(q('hand-size')!.classList.contains('is-reduced')).toBe(true);
    expect(document.querySelector('[data-testid="toast-hand-size"]')?.textContent).toContain(
      t('bosses.great_flood.name'),
    );
  });

  it('pitva na šéfovi: žeton, hláška death a pravidlo; Info o runu ukáže šéfa patra', async () => {
    const s = bossRound('UIBOSS-PITVA', 'tax_audit');
    const c = open(s);
    q('run-info')!.click();
    const info = document.querySelector<HTMLElement>('[data-testid="run-info-boss"]')!;
    expect(norm(info.textContent!)).toContain(norm(t('bosses.tax_audit.name')));
    expect(norm(info.textContent!)).toContain(norm(t('bosses.tax_audit.rule', { fee: 1 })));
    closeAllModals();

    c.engine._core.state.round!.handsLeft = 1;
    c.toggleSelect(c.state.round!.hand[0]!);
    await c.play();
    await settle(c);
    expect(c.state.phase).toBe('game_over');
    expect(text('death-quote')).toBe(norm(deathQuote('tax_audit')));
    expect(q('death-boss')!.dataset.bossId).toBe('tax_audit');
    expect(text('death-boss')).toContain(norm(t('bosses.tax_audit.rule', { fee: 1 })));
  });
});
