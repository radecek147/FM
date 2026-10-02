/**
 * Herní obrazovka (CLAUDE.md kap. 4, DESIGN 13.2–13.3): levý panel, nahoře žolíci a spotřebky, uprostřed stůl
 * nebo panel fáze (výběr útraty, konec kola, Večerka, obálka, pitva, výhra), dole ruka s Zahrát / Zahodit
 * a vpravo dole balíček.
 *
 * Stav čte jen přes `controller.state` / `controller.engine` (dotazy), mění ho jen akcemi controlleru.
 * Překreslení je levné: levý panel a karty se aktualizují na místě, panel fáze se postaví znovu, jen když
 * se změní jeho podpis. Animace událostí přehrává presenter (src/ui/present.ts), částice src/ui/fx.
 *
 * Klávesy: 1–8 výběr karty, Enter zahrát (i na zaměřené kartě; ve výběru útraty vybrat, na konci kola
 * vyplatit), X zahodit, S / B třídění, Shift + ← / → posun vybrané karty v ruce, Esc pauza (Pokračovat /
 * Nastavení / Hlavní menu), mezerník přeskočí animaci (řeší App).
 */
import '../../styles/game.css';
import type { BlindKind, HandType, RunPhase } from '../../../engine';
import { t } from '../../../i18n/cs';
import type { App, Screen, ScreenFactory } from '../../app';
import { tableEmblem } from '../../art/table';
import { backButton } from '../../components/button';
import { closeAllModals, isModalOpen } from '../../components/modal';
import { TOAST_ANCHOR_GAP, setToastAnchor } from '../../components/toast';
import { hideTooltip, isTooltipVisible } from '../../components/tooltip';
import type { GameController } from '../../controller';
import { h } from '../../dom';
import { particles, type Particles } from '../../fx/particles';
import { animate, createPresenter, type PresentView } from '../../present';
import { blindSelectKey, renderBlindSelect } from './blindSelect';
import { createBossBanner, type BossBanner } from './bossBanner';
import { boosterKey, renderBooster } from './booster';
import { renderGameOver, renderVictory } from './endScreens';
import { createHandArea, type HandArea } from './handArea';
import { openConsumableDetail, openDeckPreview, openJokerDetail, openPauseMenu, openRunInfo } from './modals';
import { renderRoundEnd, roundEndKey } from './roundEnd';
import type { GameCtx } from './shared';
import { createGameCtx, focusKey, restoreFocus } from './shared';
import { renderShop, shopKey } from './shop';
import { createSidebar, type Sidebar } from './sidebar';
import { createTopRow, type TopRow } from './topRow';

interface PanelDef {
  key(ctx: GameCtx): string;
  render(ctx: GameCtx): HTMLElement;
}

/** Panely fází (mimo kolo, kdy je uprostřed stůl). */
const PANELS: Partial<Record<RunPhase, PanelDef>> = {
  blind_select: { key: blindSelectKey, render: renderBlindSelect },
  round_end: { key: roundEndKey, render: renderRoundEnd },
  shop: { key: shopKey, render: renderShop },
  booster: { key: boosterKey, render: renderBooster },
  game_over: { key: () => 'over', render: renderGameOver },
  victory: { key: () => 'victory', render: renderVictory },
};

/** Index karty z klávesy 1–9 (číslice i numerická klávesnice, nezávisle na rozložení — česká QWERTZ). */
export function digitIndex(e: Pick<KeyboardEvent, 'key' | 'code'>): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '');
  if (m) return Number(m[1]) - 1;
  if (/^[1-9]$/.test(e.key)) return Number(e.key) - 1;
  return null;
}

function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return false;
  return target.closest('button, a[href], input, select, textarea, [role="radio"], [role="button"]') !== null;
}

class GameView implements PresentView {
  readonly el: HTMLElement;
  readonly anim: App['anim'];
  readonly particles: Particles;
  private readonly ctx: GameCtx;
  private readonly sidebar: Sidebar;
  private readonly topRow: TopRow;
  private readonly handArea: HandArea;
  private readonly main: HTMLElement;
  private readonly table: HTMLElement;
  private readonly tableHint: HTMLElement;
  private readonly panelHost: HTMLElement;
  private readonly fx: HTMLElement;
  private readonly live: HTMLElement;
  private readonly bossBanner: BossBanner;
  private panelKey = '';
  private readonly unsubscribe: () => void;

  constructor(
    private readonly app: App,
    readonly controller: GameController,
  ) {
    this.anim = app.anim;
    this.particles = particles(() => this.app.settings.animations);
    this.ctx = createGameCtx(app, controller, () => this.refresh());

    this.sidebar = createSidebar(this.ctx, {
      openRunInfo: () => openRunInfo(this.ctx),
      openPause: () => void openPauseMenu(this.ctx),
    });
    this.topRow = createTopRow(this.ctx, {
      openJoker: (uid) => openJokerDetail(this.ctx, uid),
      openConsumable: (uid) => openConsumableDetail(this.ctx, uid),
    });
    this.handArea = createHandArea(this.ctx, { openDeck: () => openDeckPreview(this.ctx) });

    this.tableHint = h('p', { class: 'game-table__hint' });
    this.table = h('div', {
      class: 'game-table',
      role: 'group',
      'aria-label': t('game.hand.tableLabel'),
      'data-testid': 'table',
      inert: true,
    });
    this.panelHost = h('div', { class: 'game-panel-host' });
    // Potisk na suknu (prošívaný ovál + znak) — jen ozdoba, pod vším ostatním na jevišti.
    const decor = h('div', { class: 'game-stage__decor', 'aria-hidden': 'true' }, tableEmblem());
    this.bossBanner = createBossBanner(controller.registry);
    const stage = h(
      'section',
      { class: 'game-stage' },
      decor,
      this.tableHint,
      this.table,
      this.panelHost,
      this.bossBanner.el,
    );
    this.main = h('div', { class: 'game-main' }, this.topRow.el, stage, this.handArea.el);
    // Hlášky ve sloupci nahoře uprostřed jeviště — ne přes ruku, tlačítka a balíček (toast.ts). Panel fáze
    // (Večerka, obálka, výběr útraty…) má tlačítka v záhlaví: sloupec pak začíná pod panelem, když je tam místo,
    // jinak až pod záhlavím.
    setToastAnchor((needed) => this.toastRect(stage, needed));
    this.fx = h('div', { class: 'game-fx', 'aria-hidden': 'true' });
    this.live = h('p', { class: 'visually-hidden', 'aria-live': 'polite', 'data-testid': 'game-live' });
    this.el = h(
      'main',
      { class: 'game', 'aria-labelledby': 'game-title', 'data-testid': 'game-screen' },
      h('h1', { class: 'visually-hidden', id: 'game-title' }, t('game.label')),
      this.sidebar.el,
      this.main,
      this.fx,
      this.live,
    );

    const presenter = createPresenter(this);
    controller.setPresenter(async (events, c) => {
      this.el.classList.add('is-busy');
      try {
        await presenter(events, c);
      } finally {
        this.el.classList.remove('is-busy');
      }
    });
    this.unsubscribe = controller.subscribe(() => this.refresh());
    this.refresh();
    // Výchozí focus po vložení do stránky (router fokusuje nadpis, který focus nebere).
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      this.panelHost
        .querySelector<HTMLElement>('[data-autofocus]:not(:disabled)')
        ?.focus({ preventScroll: true });
    });
  }

  // ─────────────────────────── Překreslení ───────────────────────────

  refresh(): void {
    const c = this.controller;
    const s = c.state;
    this.el.dataset.phase = s.phase;
    this.el.classList.toggle('is-ended', s.phase === 'game_over' || s.phase === 'victory');
    this.el.classList.toggle('is-boss', s.round?.blind === 'boss' && s.phase === 'round');
    this.sidebar.update();
    this.topRow.update();
    this.handArea.update();
    // Bez ruky dole jen balíček — jeviště dostane celou výšku (styles/game.css, `.is-handless`).
    this.main.classList.toggle('is-handless', this.handArea.el.classList.contains('is-empty'));

    const inRound = s.phase === 'round';
    if (!inRound) this.bossBanner.hide();
    this.table.hidden = !inRound;
    if (!inRound && !c.busy && this.table.childElementCount > 0) this.table.replaceChildren();
    this.tableHint.hidden = !inRound || this.table.childElementCount > 0 || c.selected.length > 0;
    if (inRound)
      this.tableHint.textContent = t('game.hand.tableHint', { max: c.engine.modifiers().maxSelect });

    const panel = PANELS[s.phase];
    const key = panel ? `${s.phase}|${panel.key(this.ctx)}` : s.phase;
    if (key !== this.panelKey) {
      const fk = focusKey();
      const wasInside =
        document.activeElement instanceof Node && this.panelHost.contains(document.activeElement);
      this.panelKey = key;
      if (panel) {
        this.panelHost.replaceChildren(panel.render(this.ctx));
        this.panelHost.hidden = false;
        restoreFocus(this.panelHost, fk, wasInside);
      } else {
        this.panelHost.replaceChildren();
        this.panelHost.hidden = true;
      }
    }
  }

  /**
   * Obdélník pro sloupec hlášek vysoký `needed` px: jeviště; u panelu fáze volné místo pod panelem (Večerka na
   * 1366 × 768 nebo na tabletu — hláška pak nezakryje zboží), a když se tam sloupec nevejde, hned pod záhlavím
   * panelu (tlačítka v záhlaví zůstanou volná). Null = jeviště není vidět.
   */
  private toastRect(stage: HTMLElement, needed: number): DOMRect | null {
    if (!stage.isConnected) return null;
    const r = stage.getBoundingClientRect();
    const panel = this.panelHost.hidden ? null : this.panelHost.firstElementChild;
    if (!panel) return r;
    const header = panel.querySelector<HTMLElement>('.game-panel__header');
    let top = header ? Math.max(r.top, header.getBoundingClientRect().bottom) : r.top;
    const below = panel.getBoundingClientRect().bottom;
    const visibleBottom = Math.min(r.bottom, window.innerHeight || r.bottom);
    if (needed > 0 && visibleBottom - below >= needed + 2 * TOAST_ANCHOR_GAP) top = Math.max(top, below);
    return new DOMRect(r.left, top, r.width, Math.max(0, r.bottom - top));
  }

  // ─────────────────────────── PresentView ───────────────────────────

  cardEl(id: number): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`[data-card-id="${id}"]`) ?? this.handArea.cardEl(id);
  }

  jokerEl(uid: number): HTMLElement | null {
    return this.topRow.jokerEl(uid);
  }

  consumableEl(uid: number): HTMLElement | null {
    return this.topRow.consumableEl(uid);
  }

  handInfoEl(): HTMLElement | null {
    return this.sidebar.handInfoEl;
  }

  tableEl(): HTMLElement | null {
    return this.table;
  }

  deckEl(): HTMLElement | null {
    return this.handArea.deckEl;
  }

  moneyEl(): HTMLElement | null {
    return this.sidebar.moneyEl;
  }

  roundScoreEl(): HTMLElement | null {
    return this.sidebar.roundScoreEl;
  }

  fxLayer(): HTMLElement | null {
    return this.fx;
  }

  showScoring(s: { hand: HandType; level: number; chips: number; mult: number } | null): void {
    this.sidebar.showScoring(s);
    if (s) this.tableHint.hidden = true;
  }

  setChipsMult(chips: number, mult: number): void {
    this.sidebar.setChipsMult(chips, mult);
  }

  setRoundScore(n: number): void {
    this.sidebar.setRoundScore(n);
  }

  setMoney(n: number): void {
    this.sidebar.setMoney(n);
  }

  shake(): void {
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.app.settings.screenShake || reduced) return;
    void animate(
      this.anim,
      this.main,
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-6px, 3px)' },
        { transform: 'translate(5px, -4px)' },
        { transform: 'translate(-3px, 2px)' },
        { transform: 'translate(0, 0)' },
      ],
      360,
      { easing: 'linear' },
    );
  }

  announce(text: string): void {
    this.live.textContent = text;
  }

  showBossIntro(bossId: string, kind: BlindKind): void {
    this.bossBanner.show(bossId, kind, this.controller.state.ante);
  }

  hideBossIntro(): void {
    this.bossBanner.hide();
  }

  // ─────────────────────────── Klávesy ───────────────────────────

  onKey(e: KeyboardEvent): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey || isModalOpen()) return false;
    const c = this.controller;
    if (e.key === 'Escape') {
      if (isTooltipVisible()) {
        hideTooltip();
        return true;
      }
      void openPauseMenu(this.ctx);
      return true;
    }
    if (c.busy) return false;
    const s = c.state;
    const selecting = s.phase === 'round' || (s.phase === 'booster' && (s.booster?.hand.length ?? 0) > 0);
    // Shift + ← / → posune vybranou (nebo zaměřenou) kartu v ruce (DESIGN 13.3).
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      return selecting && this.handArea.moveCard(e.key === 'ArrowLeft' ? -1 : 1);
    }
    const idx = digitIndex(e);
    if (idx !== null) {
      const id = c.handIds()[idx];
      if (!selecting || id === undefined) return false;
      c.toggleSelect(id);
      return true;
    }
    const key = e.key.toLowerCase();
    if (e.key === 'Enter') {
      // Enter na kartě v ruce (zaměřené po kliknutí myší) je v kole taky Zahrát; kartu přepíná klik,
      // mezerník a 1–8. Ostatní ovládací prvky si Enter zpracují samy.
      const onHandCard =
        s.phase === 'round' &&
        e.target instanceof HTMLElement &&
        e.target.classList.contains('pcard') &&
        this.handArea.el.contains(e.target);
      if (isControl(e.target) && !onHandCard) return false;
      if (s.phase === 'round') void this.ctx.play();
      else if (s.phase === 'blind_select') void this.ctx.act({ type: 'selectBlind' });
      else if (s.phase === 'round_end') void this.ctx.act({ type: 'cashOut' });
      else return false;
      return true;
    }
    if (key === 'x' && s.phase === 'round') {
      void this.ctx.discard();
      return true;
    }
    if ((key === 's' || key === 'b') && selecting) {
      void this.ctx.act({ type: 'sortHand', by: key === 's' ? 'rank' : 'suit' });
      return true;
    }
    return false;
  }

  dispose(): void {
    setToastAnchor(null);
    this.bossBanner.hide();
    this.unsubscribe();
    this.controller.setPresenter(async () => undefined);
    this.particles.clear();
    hideTooltip();
  }
}

/** Obrazovka bez rozehrané hry (např. poškozené uložení) — cesta zpět do menu. */
function noGameScreen(app: App): Screen {
  const el = h(
    'main',
    { class: 'screen game-missing', 'aria-labelledby': 'game-missing-title', 'data-testid': 'game-screen' },
    h('h1', { id: 'game-missing-title', class: 'screen-title' }, t('app.title')),
    h('p', null, t('game.noGame')),
    backButton(() => app.go('menu'), t('common.backToMenu')),
  );
  return {
    el,
    onKey(e) {
      if (e.key !== 'Escape') return false;
      app.go('menu');
      return true;
    },
  };
}

export const gameScreen: ScreenFactory = (app) => {
  let controller = app.controller;
  if (!controller || controller.state.phase === 'game_over') {
    // Pokračování z uloženého runu (např. po obnovení stránky přímo na hře) — rovnou připojené k profilu.
    const resumed = app.profiles.resume();
    if (resumed) controller = app.controller = resumed;
  }
  if (!controller) return noGameScreen(app);
  // Události runu sleduje profil (statistiky, odemykání, achievementy) — i u runu založeného mimo profil.
  if (!controller.hasObserver) app.profiles.attach(controller);
  const view = new GameView(app, controller);
  return {
    el: view.el,
    onKey: (e) => view.onKey(e),
    dispose: () => {
      view.dispose();
      closeAllModals();
    },
  };
};
