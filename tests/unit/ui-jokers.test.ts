// @vitest-environment happy-dom
/**
 * Žolíci v UI (fáze 4): stav kopírování Napodobitele (pomocníci v src/ui/describe.ts, odznaky a aria-label v řadě,
 * tooltip a detail), poznámka u nekopírovatelných žolíků, cena a prodejní cena v tooltipu (Večerka, řada,
 * přibitý „Prodat nejde“), Info o runu se stavem žolíků (počítadla, nálepky, kopírování).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { JokerInstance, RunState } from '../../src/engine';
import { Game, serializeRun } from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { createJokerCard } from '../../src/ui/components/jokerCard';
import { closeAllModals } from '../../src/ui/components/modal';
import { hideTooltip, jokerTooltip, type TooltipContent } from '../../src/ui/components/tooltip';
import { GameController } from '../../src/ui/controller';
import {
  copiedBy,
  copiedByText,
  copyStatusText,
  copyTargetUid,
  isCopyJoker,
  jokerTexts,
} from '../../src/ui/describe';
import { gameScreen } from '../../src/ui/screens/game';
import { memoryStore, STORAGE_KEYS, type KeyValueStore } from '../../src/ui/storage';

const REG = registry();
const SEED = 'UIZOLIK1';

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
  hideTooltip();
});

const deps = () => ({ registry: REG, store });

function open(c: GameController): void {
  app.controller = c;
  app.go('game');
}

function fromState(state: RunState): GameController {
  store.set(STORAGE_KEYS.run, serializeRun(state, '2026-10-01T00:00:00.000Z'));
  const c = GameController.resume(deps());
  if (!c) throw new Error('resume failed');
  return c;
}

function freshState(): RunState {
  return structuredClone(Game.newRun({ deckId: 'pub', stake: 1, seed: SEED }, REG).state) as RunState;
}

/** Žolík s počátečním stavem z definice (Napodobitel `{ target, round }`, Stálý host `{ rounds }`…). */
function joker(uid: number, defId: string, extra: Partial<JokerInstance> = {}): JokerInstance {
  const def = REG.jokers[defId];
  if (!def) throw new Error(`Neznámý žolík ${defId}`);
  return {
    uid,
    defId,
    edition: null,
    state: def.initState?.() ?? {},
    sellBonus: 0,
    stickers: [],
    debuffed: false,
    ...extra,
  };
}

/** Stav v kole, ve kterém si Napodobitel (uid 801) vybral cíl — jediný kopírovatelný žolík je Pivní tácek (802). */
function roundWithImpersonator(): RunState {
  const s = freshState();
  s.jokers = [joker(801, 'impersonator'), joker(802, 'beer_mat'), joker(803, 'flea_trader')];
  const g = Game.fromState(s, REG);
  const res = g.dispatch({ type: 'selectBlind' });
  expect(res.ok).toBe(true);
  return structuredClone(g.state) as RunState;
}

function tooltipText(content: TooltipContent): string {
  return [
    content.title,
    content.subtitle ?? '',
    ...(content.lines ?? []).map((l) => (typeof l === 'string' ? l : (l?.text ?? ''))),
    content.flavor ?? '',
    ...(content.footer ?? []),
  ].join('\n');
}

async function settle(c: GameController): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(c.busy).toBe(false));
  await new Promise((r) => setTimeout(r, 0));
}

const name = (defId: string): string => t(`jokers.${defId}.name`);

// ─────────────────────────── Pomocníci kopírování ───────────────────────────

describe('kopírující žolíci (describe.ts)', () => {
  it('Napodobitel je kopírující žolík, Pivní tácek ne', () => {
    expect(isCopyJoker('impersonator', REG)).toBe(true);
    expect(isCopyJoker('beer_mat', REG)).toBe(false);
    expect(isCopyJoker('neexistuje', REG)).toBe(false);
  });

  it('mimo kolo nekopíruje nikoho a tooltip řekne, že si cíl vybere na začátku kola', () => {
    const s = freshState();
    s.jokers = [joker(801, 'impersonator', { state: { target: 802, round: 0 } }), joker(802, 'beer_mat')];
    expect(s.round).toBeNull();
    expect(copyTargetUid(s, s.jokers[0]!, REG)).toBeNull();
    expect(copyStatusText(s, s.jokers[0]!, REG)).toBe(t('art.copy.idle'));
    expect(copiedByText(s, s.jokers[1]!, REG)).toBeNull();
    expect(copyStatusText(s, s.jokers[1]!, REG)).toBeNull();
  });

  it('v kole kopíruje cíl vybraný enginem (nekopírovatelného Bazarníka přeskočí)', () => {
    const s = roundWithImpersonator();
    const [imp, mat, flea] = s.jokers;
    expect(imp!.state.target).toBe(802);
    expect(copyTargetUid(s, imp!, REG)).toBe(802);
    expect(copyStatusText(s, imp!, REG)).toBe(t('art.copy.active', { name: name('beer_mat') }));
    expect(copiedBy(s, mat!, REG).map((j) => j.uid)).toEqual([801]);
    expect(copiedByText(s, mat!, REG)).toBe(t('art.copy.copiedBy', { names: name('impersonator') }));
    expect(copiedByText(s, flea!, REG)).toBeNull();
  });

  it('cíl, který zmizel, je mimo provoz nebo nejde kopírovat, se nepočítá', () => {
    const s = roundWithImpersonator();
    const imp = s.jokers[0]!;
    s.jokers[1]!.debuffed = true;
    expect(copyTargetUid(s, imp, REG)).toBeNull();
    expect(copyStatusText(s, imp, REG)).toBe(t('art.copy.none'));
    s.jokers[1]!.debuffed = false;
    imp.state.target = 803; // Bazarník má copyable: false
    expect(copyTargetUid(s, imp, REG)).toBeNull();
    imp.state.target = 999;
    expect(copyTargetUid(s, imp, REG)).toBeNull();
    imp.state.target = 802;
    imp.debuffed = true;
    expect(copyTargetUid(s, imp, REG)).toBeNull();
  });

  it('jokerTexts nese příznak kopírovatelnosti', () => {
    expect(jokerTexts('beer_mat', undefined, { registry: REG }).copyable).toBe(true);
    expect(jokerTexts('impersonator', undefined, { registry: REG }).copyable).toBe(false);
    expect(jokerTexts('flea_trader', undefined, { registry: REG }).copyable).toBe(false);
  });
});

// ─────────────────────────── Tooltip ───────────────────────────

describe('tooltip žolíka', () => {
  it('Večerka: název, mechanika s čísly, flavor v „…“, cena i prodejní cena', () => {
    const tip = tooltipText(jokerTooltip(joker(1, 'beer_mat'), { registry: REG, price: 4, sellValue: 2 }));
    const tx = jokerTexts('beer_mat', undefined, { registry: REG });
    expect(tip).toContain(name('beer_mat'));
    expect(tip).toContain(tx.desc);
    expect(tx.desc).toMatch(/\+10\s+čipů/u);
    expect(tx.desc).toMatch(/\+2\s+mult/u);
    const content = jokerTooltip(joker(1, 'beer_mat'), { registry: REG, price: 4, sellValue: 2 });
    expect(content.flavor).toBe(tx.flavor);
    expect(content.footer).toEqual([
      t('art.tooltip.price', { price: 4 }),
      t('art.tooltip.sell', { price: 2 }),
    ]);
  });

  it('nekopírovatelný žolík má poznámku, kopírovatelný ne', () => {
    expect(tooltipText(jokerTooltip(joker(1, 'flea_trader'), { registry: REG }))).toContain(
      t('art.copy.notCopyable'),
    );
    expect(tooltipText(jokerTooltip(joker(1, 'beer_mat'), { registry: REG }))).not.toContain(
      t('art.copy.notCopyable'),
    );
  });

  it('přibitý žolík v řadě: místo prodejní ceny „Prodat nejde“', () => {
    const content = jokerTooltip(joker(1, 'beer_mat', { stickers: ['eternal'] }), {
      registry: REG,
      sellValue: 2,
    });
    expect(content.footer).toEqual([t('art.tooltip.noSell')]);
  });

  it('se stavem runu ukáže, koho Napodobitel kopíruje, a u cíle, kdo ho kopíruje', () => {
    const s = roundWithImpersonator();
    const run = () => s;
    const imp = tooltipText(jokerTooltip(s.jokers[0]!, { registry: REG, run }));
    expect(imp).toContain(t('art.copy.active', { name: name('beer_mat') }));
    expect(imp).toContain(t('art.copy.notCopyable'));
    const mat = tooltipText(jokerTooltip(s.jokers[1]!, { registry: REG, run }));
    expect(mat).toContain(t('art.copy.copiedBy', { names: name('impersonator') }));
  });
});

// ─────────────────────────── Řada žolíků, detail, Info o runu ───────────────────────────

describe('řada žolíků a dialogy', () => {
  it('Napodobitel v kole: odznak se šipkou k cíli, zvýrazněný cíl, aria-label a detail se stavem', async () => {
    const c = fromState(roundWithImpersonator());
    open(c);
    await settle(c);
    const imp = root.querySelector<HTMLElement>('[data-joker-uid="801"]')!;
    const mat = root.querySelector<HTMLElement>('[data-joker-uid="802"]')!;
    const flea = root.querySelector<HTMLElement>('[data-joker-uid="803"]')!;
    expect(imp.classList.contains('is-copying')).toBe(true);
    expect(imp.querySelector('.kcopy--from.kcopy--right')).not.toBeNull();
    expect(imp.getAttribute('aria-label')).toContain(t('art.copy.labelActive', { name: name('beer_mat') }));
    expect(mat.classList.contains('is-copy-target')).toBe(true);
    expect(mat.querySelector('.kcopy--target')).not.toBeNull();
    expect(mat.getAttribute('aria-label')).toContain(
      t('art.copy.labelCopied', { names: name('impersonator') }),
    );
    expect(flea.querySelector('.kcopy')).toBeNull();

    // Přesun Napodobitele za cíl → šipka ukazuje doleva.
    await c.act({ type: 'reorderJokers', uids: [802, 801, 803] });
    await settle(c);
    expect(root.querySelector('[data-joker-uid="801"] .kcopy--from.kcopy--left')).not.toBeNull();

    root.querySelector<HTMLElement>('[data-joker-uid="801"]')!.click();
    const detail = document.querySelector('[data-testid="joker-detail"]')!;
    expect(detail.querySelector('[data-testid="joker-copy-status"]')?.textContent).toBe(
      t('art.copy.active', { name: name('beer_mat') }),
    );
    expect(detail.textContent).toContain(t('art.copy.notCopyable'));
  });

  it('karta mimo řadu (Večerka) nemá odznak kopírování', () => {
    const el = createJokerCard(joker(1, 'impersonator'), { registry: REG, price: 10 });
    expect(el.querySelector('.kcopy')).toBeNull();
    expect(el.classList.contains('is-copying')).toBe(false);
  });

  it('zvětrávající žolík ukazuje zbývající kola, přibitý a zapůjčený nálepku', () => {
    const per = createJokerCard(joker(1, 'beer_mat', { stickers: ['perishable'], perishRounds: 3 }), {
      registry: REG,
    });
    expect(per.querySelector('.ksticker--perishable .ksticker__n')?.textContent).toBe('3');
    expect(per.getAttribute('aria-label')).toContain(t('art.label.perishLeft', { n: 3 }));
    const et = createJokerCard(joker(2, 'beer_mat', { stickers: ['eternal'] }), { registry: REG });
    expect(et.querySelector('.ksticker--eternal')).not.toBeNull();
    const re = createJokerCard(joker(3, 'beer_mat', { stickers: ['rental'] }), { registry: REG });
    expect(re.querySelector('.ksticker--rental')).not.toBeNull();
    expect(re.getAttribute('aria-label')).toContain(t('art.stickers.rental.name'));
  });

  it('Info o runu: žolíci v pořadí s aktuálním stavem, kopírováním a nálepkami', async () => {
    const s = roundWithImpersonator();
    s.jokers.push(
      joker(804, 'regular', { state: { rounds: 3 } }),
      joker(805, 'gravedigger', { stickers: ['perishable'], perishRounds: 2 }),
    );
    const c = fromState(s);
    open(c);
    await settle(c);
    root.querySelector<HTMLButtonElement>('[data-testid="run-info"]')!.click();
    const list = document.querySelector('[data-testid="run-info-jokers"]')!;
    const items = [...list.querySelectorAll('li')];
    expect(items.map((li) => li.dataset.defId)).toEqual([
      'impersonator',
      'beer_mat',
      'flea_trader',
      'regular',
      'gravedigger',
    ]);
    const regular = jokerTexts('regular', c.state.jokers[3] as JokerInstance, { registry: REG });
    const mult = Number(REG.jokers.regular!.params?.mult ?? 1);
    expect(regular.desc).toMatch(new RegExp(`\\+${3 * mult}\\s+mult\\)`, 'u'));
    expect(items[3]!.textContent).toContain(regular.desc);
    expect(items[0]!.textContent).toContain(t('art.copy.active', { name: name('beer_mat') }));
    expect(items[1]!.textContent).toContain(t('art.copy.copiedBy', { names: name('impersonator') }));
    expect(items[4]!.textContent).toContain(t('art.stickers.perishable.left', { n: 2 }));
    expect(list.textContent).toContain(t('game.runInfo.jokersCount', { n: 5, max: 5 }));
    expect(document.body.textContent ?? '').not.toContain('⟦');
  });

  it('Večerka: tooltip zboží ukáže cenu i prodejní cenu spočítanou enginem', async () => {
    const s = freshState();
    s.phase = 'shop';
    s.money = 20;
    s.shop = {
      items: [
        { kind: 'joker', joker: joker(900, 'late_train'), price: 6, sold: false },
        { kind: 'joker', joker: joker(901, 'beer_mat', { stickers: ['rental'] }), price: 2, sold: false },
      ],
      boosters: [],
      vouchers: [],
      rerollCost: 5,
      rerollsThisShop: 0,
      paidRerolls: 0,
      freeRerolls: 0,
    };
    const c = fromState(s);
    open(c);
    await settle(c);
    const show = (slot: number): string => {
      const card = root.querySelector<HTMLElement>(`[data-testid="shop-item-${slot}"] .jcard`)!;
      card.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      return document.querySelector('#karban-tooltip')?.textContent ?? '';
    };
    const late = show(0);
    expect(late).toContain(t('art.tooltip.price', { price: 6 }));
    expect(late).toContain(t('art.tooltip.sell', { price: 3 }));
    hideTooltip();
    // Zapůjčený: koupě za 2 Kč, prodej za 1 Kč (DESIGN 4.6).
    const rental = show(1);
    expect(rental).toContain(t('art.tooltip.price', { price: 2 }));
    expect(rental).toContain(t('art.tooltip.sell', { price: 1 }));
    // Náhled prodejní ceny skutečný run nemění.
    expect(c.state.jokers).toHaveLength(0);
  });
});
