/**
 * Dolní část herní obrazovky: ruka (výběr klikem / dotykem / klávesami 1–8, vybraná karta povyskočí),
 * Zahrát / Zahodit, třídění podle hodnoty a barvy a vpravo dole balíček „zbývá/celkem“ (klik = náhled).
 *
 * Ruka se překresluje klíčovaně (prvek karty podle id); když se změní jen pořadí (třídění), karty se
 * přesunou animací FLIP (transform). V obálce s babskou radou / razítkem slouží ruka k výběru cílů.
 *
 * Přesun karet (`reorderHand`, v kole i v ruce obálky): tažení myší i prstem (`attachDragSort` — krátký klik /
 * tap dál vybírá, tah přesouvá) a klávesnicí Shift + ← / → (`moveCard`, DESIGN 13.3). Pořadí je herně důležité
 * (babské rady pracují s „levou“ kartou, karty skórují zleva doprava).
 */
import { t } from '../../../i18n/cs';
import { formatNumber } from '../../../i18n/format';
import { button } from '../../components/button';
import { createCardBack, createCardView, updateCardView } from '../../components/card';
import { attachDragSort } from '../../components/dragSort';
import { toast } from '../../components/toast';
import { hideTooltip } from '../../components/tooltip';
import { activeBossId, blindName, bossReasonText, cardLabel } from '../../describe';
import { h } from '../../dom';
import { animate } from '../../present';
import type { GameCtx } from './shared';
import { syncOrder } from './topRow';

export interface HandArea {
  el: HTMLElement;
  deckEl: HTMLElement;
  update(): void;
  /** Prvek karty v ruce. */
  cardEl(id: number): HTMLElement | null;
  /**
   * Posune kartu v ruce o jedno místo (Shift + ← / →): zaměřenou vybranou kartu, jinak naposledy vybranou, jinak
   * zaměřenou. Vrací false, když není co posouvat (klávesa pak propadne dál).
   */
  moveCard(dir: -1 | 1): boolean;
  /** Přesune focus na ruku (skupinu karet) — když byl na jiném ovládacím prvku mimo ruku. */
  focusHand(): void;
}

export interface HandAreaActions {
  openDeck(): void;
}

/** Klávesové zkratky karet: 1–9 podle pozice. */
const MAX_KEY_HINT = 9;

/**
 * Kterou kartu posune Shift + šipka: zaměřená karta, pokud je vybraná; jinak naposledy vybraná; jinak zaměřená
 * (klávesnice: Tab na kartu). Null = není co posouvat. Čistá funkce (testy).
 */
export function pickMoveTarget(
  hand: readonly number[],
  selected: readonly number[],
  focused: number | null,
): number | null {
  const inHand = (id: number | null | undefined): id is number => id != null && hand.includes(id);
  if (inHand(focused) && selected.includes(focused)) return focused;
  for (let i = selected.length - 1; i >= 0; i--) if (inHand(selected[i])) return selected[i]!;
  return inHand(focused) ? focused : null;
}

export function createHandArea(ctx: GameCtx, actions: HandAreaActions): HandArea {
  const c = ctx.controller;

  const handRow = h('div', {
    class: 'gb-hand',
    role: 'group',
    'aria-describedby': 'gb-hand-reorder',
    'data-testid': 'hand',
    // Cíl focusu při výběru klávesami 1–9 (`focusHand`), mimo pořadí Tab.
    tabindex: '-1',
  });
  // Nápověda k přesunu (čtečky) a hlášení nové pozice karty po přesunu.
  const reorderHint = h('p', { class: 'visually-hidden', id: 'gb-hand-reorder' }, t('game.hand.reorderHint'));
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite', 'data-testid': 'hand-live' });
  const selectedEl = h('p', { class: 'gb-selected', 'aria-live': 'polite', 'data-testid': 'selected-count' });
  // Velikost ruky v kole (Garsonka, Rozložené noviny, Velká voda ji mění) — se změnou proti začátku kola.
  const handSizeEl = h('p', { class: 'gb-handsize', 'data-testid': 'hand-size' });
  const hint = h('p', { class: 'gb-hint' });

  const playBtn = button({
    label: t('game.hand.play'),
    ariaLabel: t('game.hand.playLabel'),
    variant: 'primary',
    testId: 'play',
    className: 'gb-play',
    onClick: () => void ctx.play(),
  });
  playBtn.setAttribute('aria-keyshortcuts', 'Enter');
  const discardBtn = button({
    label: t('game.hand.discard'),
    ariaLabel: t('game.hand.discardLabel'),
    variant: 'danger',
    testId: 'discard',
    className: 'gb-discard',
    onClick: () => void ctx.discard(),
  });
  discardBtn.setAttribute('aria-keyshortcuts', 'X');
  const sortRank = button({
    label: t('game.hand.sortRank'),
    ariaLabel: t('game.hand.sortRankLabel'),
    variant: 'paper',
    size: 'small',
    testId: 'sort-rank',
    onClick: () => void ctx.act({ type: 'sortHand', by: 'rank' }),
  });
  sortRank.setAttribute('aria-keyshortcuts', 'S');
  const sortSuit = button({
    label: t('game.hand.sortSuit'),
    ariaLabel: t('game.hand.sortSuitLabel'),
    variant: 'paper',
    size: 'small',
    testId: 'sort-suit',
    onClick: () => void ctx.act({ type: 'sortHand', by: 'suit' }),
  });
  sortSuit.setAttribute('aria-keyshortcuts', 'B');

  const sortGroup = h(
    'div',
    { class: 'gb-sort', role: 'group', 'aria-labelledby': 'gb-sort-label' },
    h('span', { class: 'gb-sort__label', id: 'gb-sort-label' }, t('game.hand.sort')),
    sortRank,
    sortSuit,
  );
  const controls = h(
    'div',
    { class: 'gb-controls' },
    playBtn,
    h('div', { class: 'gb-mid' }, sortGroup, h('div', { class: 'gb-counts' }, selectedEl, handSizeEl)),
    discardBtn,
  );

  const deckCount = h('span', { class: 'gb-deck__count', 'data-testid': 'deck-count' });
  const deckEl = h(
    'button',
    {
      type: 'button',
      class: 'gb-deck',
      'data-testid': 'deck',
      onClick: () => actions.openDeck(),
    },
    createCardBack({ className: 'gb-deck__card' }),
    deckCount,
  );

  const handWrap = h('div', { class: 'gb-hand-wrap' }, handRow, hint, controls, reorderHint, live);
  const el = h('section', { class: 'game-bottom' }, handWrap, deckEl);

  const cards = new Map<number, HTMLElement>();
  let lastOrder = '';

  const announcePosition = (id: number, ids: readonly number[]): void => {
    const card = c.engine.card(id);
    if (!card) return;
    live.textContent = t('game.hand.moved', {
      name: cardLabel(card, ctx.registry),
      n: ids.indexOf(id) + 1,
      max: ids.length,
    });
  };

  /** Ruka, ve které jde přesouvat: kolo, nebo dobraná ruka obálky. */
  const canReorder = (): boolean => {
    const s = c.state;
    return !c.busy && (s.phase === 'round' || (s.phase === 'booster' && (s.booster?.hand.length ?? 0) > 0));
  };

  const sorter = attachDragSort(handRow, {
    item: (target) => {
      const card = target.closest<HTMLElement>('.pcard');
      return card && card.parentElement === handRow ? card : null;
    },
    canStart: () => canReorder() && c.handIds().length > 1,
    onStart: () => hideTooltip(),
    // Puštěná karta dosedne na nové místo (jen `translate` — povytažení vybrané karty zůstává).
    settle: (el, dx) =>
      void animate(ctx.app.anim, el, [{ translate: `${dx}px 0` }, { translate: '0 0' }], 160),
    onDrop: (ordered, moved) => {
      const cardIds = ordered.map((el) => Number(el.dataset.cardId));
      // DOM už má nové pořadí — překreslení po akci ho nesmí brát jako změnu k animaci. Když engine akci
      // odmítne, další překreslení vrátí karty (s animací) do pořadí enginu.
      lastOrder = cardIds.join(',');
      const id = Number(moved.dataset.cardId);
      void ctx.act({ type: 'reorderHand', cardIds }).then((ok) => {
        if (ok) announcePosition(id, cardIds);
      });
    },
  });

  const moveCard = (dir: -1 | 1): boolean => {
    if (!canReorder()) return false;
    const ids = [...c.handIds()];
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && active.parentElement === handRow && active.dataset.cardId
        ? Number(active.dataset.cardId)
        : null;
    const id = pickMoveTarget(ids, c.selected, focused);
    if (id === null) return false;
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) {
      live.textContent = t('game.hand.moveEdge');
      return true;
    }
    ids[i] = ids[j]!;
    ids[j] = id;
    void ctx.act({ type: 'reorderHand', cardIds: ids }).then((ok) => {
      if (ok) announcePosition(id, ids);
    });
    return true;
  };
  /** Velikost ruky: identita kola, velikost na jeho začátku a naposledy ukázaná. */
  const size = { round: '', start: 0, last: 0 };

  /**
   * Velikost ruky v kole. Během animace se nemění (engine už má stav po akci) — změna se ukáže až po ní,
   * s povyskočením a hláškou (u šéfa s jeho jménem: „Velká voda: ruka se zmenšila na 7 karet.“).
   */
  const updateHandSize = (): void => {
    const s = c.state;
    const round = s.round;
    if (s.phase !== 'round' || !round) {
      handSizeEl.hidden = true;
      size.round = '';
      return;
    }
    handSizeEl.hidden = false;
    if (c.busy && size.round !== '') return;
    const n = c.engine.modifiers().handSize;
    const key = `${s.ante}|${s.blindIndex}|${round.blind}|${s.stats.roundsWon}`;
    if (key !== size.round) {
      size.round = key;
      size.start = n;
      size.last = n;
    } else if (n !== size.last) {
      const boss = activeBossId(s, ctx.registry);
      const key = `game.hand.${n < size.last ? 'handSizeDown' : 'handSizeUp'}${boss ? 'Boss' : ''}`;
      toast(t(key, { n, name: boss ? blindName('boss', boss) : '' }), {
        kind: n < size.last ? 'warning' : 'info',
        testId: 'toast-hand-size',
      });
      void animate(
        ctx.app.anim,
        handSizeEl,
        [{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.4 }, { transform: 'scale(1)' }],
        420,
      );
      size.last = n;
    }
    const delta = n - size.start;
    handSizeEl.textContent =
      delta === 0 ? t('game.hand.handSize', { n }) : t('game.hand.handSizeDelta', { n, delta });
    handSizeEl.title = t('game.hand.handSizeLabel', { n });
    handSizeEl.classList.toggle('is-reduced', delta < 0);
    handSizeEl.classList.toggle('is-raised', delta > 0);
  };

  const updateHand = (): void => {
    const ids = c.handIds();
    const selected = new Set(c.selected);
    const mods = c.engine.modifiers();
    // Proč je karta mimo provoz / lícem dolů (pravidlo šéfa) — do tooltipu.
    const reason = bossReasonText(c.state, ctx.registry);
    const seen = new Set<number>();
    const order: HTMLElement[] = [];
    const created = new Set<HTMLElement>();
    ids.forEach((id, i) => {
      const card = c.engine.card(id);
      if (!card) return;
      seen.add(id);
      const keyHint = i < MAX_KEY_HINT ? String(i + 1) : undefined;
      let elCard = cards.get(id);
      if (!elCard || !handRow.contains(elCard)) {
        elCard = createCardView(card, {
          selected: selected.has(id),
          keyHint,
          mods,
          reason,
          registry: ctx.registry,
          onClick: (cd) => c.toggleSelect(cd.id),
        });
        cards.set(id, elCard);
        created.add(elCard);
      } else {
        updateCardView(elCard, card, { selected: selected.has(id), keyHint, mods, reason });
      }
      order.push(elCard);
    });
    for (const [id, elCard] of cards) {
      if (!seen.has(id)) {
        if (handRow.contains(elCard)) elCard.remove();
        cards.delete(id);
      }
    }
    // Jen změna pořadí (třídění, přesun klávesnicí) → FLIP; nové karty animuje presenter (rozdání z balíčku).
    const orderKey = ids.join(',');
    const reorder = orderKey !== lastOrder && created.size === 0 && lastOrder !== '';
    const before = reorder ? new Map(order.map((n) => [n, n.getBoundingClientRect()])) : null;
    // Přesunutý uzel (insertBefore) v prohlížeči ztratí focus — vrátit ho kartě, která ho měla.
    const active = document.activeElement;
    const focusedCard = active instanceof HTMLElement && active.parentElement === handRow ? active : null;
    syncOrder(handRow, order);
    if (focusedCard?.isConnected && document.activeElement !== focusedCard)
      focusedCard.focus({ preventScroll: true });
    lastOrder = orderKey;
    if (before) {
      // Nejdřív všechna měření, pak animace (žádné střídání čtení a zápisu layoutu).
      const moves = order.map((n) => {
        const a = before.get(n);
        const b = n.getBoundingClientRect();
        return { n, dx: a ? a.left - b.left : 0, dy: a ? a.top - b.top : 0 };
      });
      for (const { n, dx, dy } of moves) {
        if (dx === 0 && dy === 0) continue;
        // `translate`, ne `transform`: vybraná karta zůstane během přesunu povytažená.
        void animate(ctx.app.anim, n, [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], 260);
      }
    }
    handRow.style.setProperty('--hand-n', String(Math.max(1, ids.length)));
    handRow.setAttribute('aria-label', t('game.hand.label', { n: ids.length }));
  };

  const update = (): void => {
    const s = c.state;
    const inRound = s.phase === 'round' && !!s.round;
    const inBooster = s.phase === 'booster' && (s.booster?.hand.length ?? 0) > 0;
    const showHand = inRound || inBooster;
    handWrap.hidden = !showHand;
    el.classList.toggle('is-empty', !showHand);
    // Během tažení se ruka nepřekresluje (pořadí drží tažení, po puštění přijde akce).
    if (showHand) {
      if (!sorter.dragging) updateHand();
    } else if (cards.size > 0) {
      for (const n of cards.values()) n.remove();
      cards.clear();
      lastOrder = '';
    }

    const m = c.engine.modifiers();
    const round = s.round;
    const nSel = c.selected.length;
    controls.hidden = !inRound;
    hint.hidden = !inBooster;
    hint.textContent = inBooster ? t('game.hand.boosterHint') : '';
    selectedEl.textContent = t('game.hand.selected', { n: nSel, max: m.maxSelect });
    updateHandSize();
    playBtn.disabled = !inRound || nSel === 0 || (round?.handsLeft ?? 0) <= 0;
    discardBtn.disabled = !inRound || nSel === 0 || (round?.discardsLeft ?? 0) <= 0;
    sortRank.disabled = !showHand;
    sortSuit.disabled = !showHand;

    const total = s.deck.length;
    const left = round && (s.phase === 'round' || s.phase === 'round_end') ? round.drawPile.length : total;
    deckCount.textContent = t('game.deck.count', { left, total });
    deckEl.setAttribute('aria-label', t('game.deck.label', { left, total }));
    deckEl.dataset.left = formatNumber(left);
  };

  return {
    el,
    deckEl,
    update,
    cardEl(id) {
      const n = cards.get(id);
      return n && handRow.contains(n) ? n : null;
    },
    moveCard,
    focusHand() {
      handRow.focus({ preventScroll: true });
    },
  };
}
