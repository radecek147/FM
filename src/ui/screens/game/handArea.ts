/**
 * Dolní část herní obrazovky: ruka (výběr klikem / dotykem / klávesami 1–8, vybraná karta povyskočí),
 * Zahrát / Zahodit, třídění podle hodnoty a barvy a vpravo dole balíček „zbývá/celkem“ (klik = náhled).
 *
 * Ruka se překresluje klíčovaně (prvek karty podle id); když se změní jen pořadí (třídění), karty se
 * přesunou animací FLIP (transform). V obálce s babskou radou / razítkem slouží ruka k výběru cílů.
 */
import { t } from '../../../i18n/cs';
import { formatNumber } from '../../../i18n/format';
import { button } from '../../components/button';
import { createCardBack, createCardView, updateCardView } from '../../components/card';
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
}

export interface HandAreaActions {
  openDeck(): void;
}

/** Klávesové zkratky karet: 1–9 podle pozice. */
const MAX_KEY_HINT = 9;

export function createHandArea(ctx: GameCtx, actions: HandAreaActions): HandArea {
  const c = ctx.controller;

  const handRow = h('div', { class: 'gb-hand', role: 'group', 'data-testid': 'hand' });
  const selectedEl = h('p', { class: 'gb-selected', 'aria-live': 'polite', 'data-testid': 'selected-count' });
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
    h('div', { class: 'gb-mid' }, sortGroup, selectedEl),
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

  const handWrap = h('div', { class: 'gb-hand-wrap' }, handRow, hint, controls);
  const el = h('section', { class: 'game-bottom' }, handWrap, deckEl);

  const cards = new Map<number, HTMLElement>();
  let lastOrder = '';

  const updateHand = (): void => {
    const ids = c.handIds();
    const selected = new Set(c.selected);
    const mods = c.engine.modifiers();
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
          registry: ctx.registry,
          onClick: (cd) => c.toggleSelect(cd.id),
        });
        cards.set(id, elCard);
        created.add(elCard);
      } else {
        updateCardView(elCard, card, { selected: selected.has(id), keyHint, mods });
      }
      order.push(elCard);
    });
    for (const [id, elCard] of cards) {
      if (!seen.has(id)) {
        if (handRow.contains(elCard)) elCard.remove();
        cards.delete(id);
      }
    }
    // Jen změna pořadí (třídění) → FLIP; nové karty animuje presenter (rozdání z balíčku).
    const orderKey = ids.join(',');
    const reorder = orderKey !== lastOrder && created.size === 0 && lastOrder !== '';
    const before = reorder ? new Map(order.map((n) => [n, n.getBoundingClientRect()])) : null;
    syncOrder(handRow, order);
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
        void animate(
          ctx.app.anim,
          n,
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          260,
        );
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
    if (showHand) updateHand();
    else if (cards.size > 0) {
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
  };
}
