/**
 * Horní řada: žolíci (x/sloty) a spotřebky (x/sloty) — DESIGN 13.2.
 *
 * - Žolíci: klik = detail s Prodat a posunem, tažení myší i prstem = změna pořadí (`reorderJokers`).
 *   Tažení je čistě přes transform; po puštění se uzly přeskládají hned (bez probliknutí) a pošle se akce.
 * - Spotřebky: klik = detail s Použít (vybrané karty v ruce jako cíle) a Prodat.
 * - Klíčované překreslování: prvek žolíka se překreslí jen při změně vzhledu nebo ceny.
 * Funguje obecně pro libovolný obsah z registru (žolíky doplňuje jiný workflow).
 */
import type { ConsumableInstance, JokerInstance } from '../../../engine';
import { t } from '../../../i18n/cs';
import { createConsumableCard } from '../../components/consumableCard';
import { createJokerCard, updateJokerCard } from '../../components/jokerCard';
import { hideTooltip } from '../../components/tooltip';
import { h } from '../../dom';
import type { GameCtx } from './shared';
import { consumableSlots, jokerSlots } from './shared';

export interface TopRow {
  el: HTMLElement;
  update(): void;
  jokerEl(uid: number): HTMLElement | null;
  consumableEl(uid: number): HTMLElement | null;
}

export interface TopRowActions {
  openJoker(uid: number): void;
  openConsumable(uid: number): void;
}

interface Item {
  li: HTMLElement;
  card: HTMLElement;
  sig: string;
}

/** Posun (px), od kterého je stisk tažením (myš / dotyk). */
const DRAG_THRESHOLD_MOUSE = 6;
const DRAG_THRESHOLD_TOUCH = 10;

export function createTopRow(ctx: GameCtx, actions: TopRowActions): TopRow {
  const c = ctx.controller;

  const jokerCount = h('span', { class: 'gt-count', 'data-testid': 'joker-count' });
  const jokerList = h('ul', {
    class: 'gt-row gt-row--jokers',
    role: 'list',
    'aria-describedby': 'gt-drag-hint',
    'data-testid': 'joker-row',
  });
  const jokerEmpty = h('p', { class: 'gt-empty' }, t('game.rows.jokersEmpty'));
  const consCount = h('span', { class: 'gt-count', 'data-testid': 'consumable-count' });
  const consList = h('ul', {
    class: 'gt-row gt-row--consumables',
    role: 'list',
    'data-testid': 'consumable-row',
  });
  const consEmpty = h('p', { class: 'gt-empty' }, t('game.rows.consumablesEmpty'));

  const jokerGroup = h(
    'section',
    { class: 'gt-group gt-group--jokers', 'aria-labelledby': 'gt-jokers-title' },
    h('h2', { class: 'gt-title', id: 'gt-jokers-title' }, t('game.rows.jokers'), ' ', jokerCount),
    jokerList,
    jokerEmpty,
    h('p', { class: 'visually-hidden', id: 'gt-drag-hint' }, t('game.rows.dragHint')),
  );
  const consGroup = h(
    'section',
    { class: 'gt-group gt-group--consumables', 'aria-labelledby': 'gt-cons-title' },
    h('h2', { class: 'gt-title', id: 'gt-cons-title' }, t('game.rows.consumables'), ' ', consCount),
    consList,
    consEmpty,
  );
  const el = h('section', { class: 'game-top' }, jokerGroup, consGroup);

  const jokers = new Map<number, Item>();
  const consumables = new Map<number, Item>();

  // ─────────────── Žolíci ───────────────

  const jokerSig = (j: Readonly<JokerInstance>, debuffed: boolean, sell: number): string =>
    `${j.defId}|${j.edition ?? ''}|${j.debuffed ? 1 : 0}|${debuffed ? 1 : 0}|${j.stickers.join(',')}|${
      j.perishRounds ?? ''
    }|${sell}`;

  const updateJokers = (): void => {
    const s = c.state;
    const roundDebuffs = s.round?.jokerDebuffs ?? [];
    const seen = new Set<number>();
    const order: HTMLElement[] = [];
    for (const j of s.jokers) {
      seen.add(j.uid);
      const debuffed = roundDebuffs.includes(j.uid);
      const sell = c.engine.sellValue(j.uid);
      const sig = jokerSig(j, debuffed, sell);
      let item = jokers.get(j.uid);
      if (!item) {
        const card = createJokerCard(j, {
          registry: ctx.registry,
          debuffed,
          sellValue: sell,
          mods: c.engine.modifiers(),
          onClick: (joker) => {
            if (suppressClick) return;
            actions.openJoker(joker.uid);
          },
        });
        card.dataset.jokerUid = String(j.uid);
        const li = h('li', { class: 'gt-item', 'data-uid': j.uid }, card);
        item = { li, card, sig };
        jokers.set(j.uid, item);
      } else if (item.sig !== sig) {
        updateJokerCard(item.card, j, { debuffed, sellValue: sell, mods: c.engine.modifiers() });
        item.card.dataset.jokerUid = String(j.uid);
        item.sig = sig;
      }
      order.push(item.li);
    }
    for (const [uid, item] of jokers) {
      if (!seen.has(uid)) {
        item.li.remove();
        jokers.delete(uid);
      }
    }
    syncOrder(jokerList, order);
    jokerCount.textContent = t('game.rows.count', { n: s.jokers.length, max: jokerSlots(ctx) });
    jokerList.setAttribute(
      'aria-label',
      t('game.rows.jokersLabel', { n: s.jokers.length, max: jokerSlots(ctx) }),
    );
    jokerEmpty.hidden = s.jokers.length > 0;
  };

  // ─────────────── Spotřebky ───────────────

  const consSig = (x: Readonly<ConsumableInstance>, sell: number): string =>
    `${x.defId}|${x.edition ?? ''}|${sell}`;

  const updateConsumables = (): void => {
    const s = c.state;
    const seen = new Set<number>();
    const order: HTMLElement[] = [];
    for (const x of s.consumables) {
      seen.add(x.uid);
      const sell = c.engine.sellValue(x.uid);
      const sig = consSig(x, sell);
      let item = consumables.get(x.uid);
      if (!item || item.sig !== sig) {
        const card = createConsumableCard(x, {
          registry: ctx.registry,
          sellValue: sell,
          mods: c.engine.modifiers(),
          onClick: () => actions.openConsumable(x.uid),
        });
        card.dataset.consumableUid = String(x.uid);
        if (item) {
          item.card.replaceWith(card);
          item.card = card;
          item.sig = sig;
        } else {
          item = { li: h('li', { class: 'gt-item' }, card), card, sig };
          consumables.set(x.uid, item);
        }
      }
      order.push(item.li);
    }
    for (const [uid, item] of consumables) {
      if (!seen.has(uid)) {
        item.li.remove();
        consumables.delete(uid);
      }
    }
    syncOrder(consList, order);
    consCount.textContent = t('game.rows.count', { n: s.consumables.length, max: consumableSlots(ctx) });
    consList.setAttribute(
      'aria-label',
      t('game.rows.consumablesLabel', { n: s.consumables.length, max: consumableSlots(ctx) }),
    );
    consEmpty.hidden = s.consumables.length > 0;
  };

  // ─────────────── Tažení žolíků (myš i dotyk) ───────────────

  let suppressClick = false;
  let drag: {
    pointerId: number;
    li: HTMLElement;
    startX: number;
    startY: number;
    started: boolean;
    touch: boolean;
    items: HTMLElement[];
    centers: number[];
    from: number;
    to: number;
    shift: number;
  } | null = null;

  const resetTransforms = (): void => {
    if (!drag) return;
    for (const li of drag.items) {
      li.style.transform = '';
      li.classList.remove('is-dragging', 'is-shifting');
    }
    jokerList.classList.remove('is-sorting');
  };

  jokerList.addEventListener('pointerdown', (e) => {
    if (drag || c.busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const li = (e.target as Element).closest<HTMLElement>('.gt-item');
    if (!li || !jokerList.contains(li)) return;
    drag = {
      pointerId: e.pointerId,
      li,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      touch: e.pointerType === 'touch',
      items: [],
      centers: [],
      from: 0,
      to: 0,
      shift: 0,
    };
  });

  jokerList.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.started) {
      const dist = Math.hypot(dx, e.clientY - drag.startY);
      if (dist < (drag.touch ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE)) return;
      if (c.state.jokers.length < 2 || c.busy) {
        drag = null;
        return;
      }
      // Začátek tažení: změřit jednou (žádné čtení layoutu během pohybu).
      drag.started = true;
      drag.items = [...jokerList.querySelectorAll<HTMLElement>(':scope > .gt-item')];
      const rects = drag.items.map((li) => li.getBoundingClientRect());
      drag.centers = rects.map((r) => r.left + r.width / 2);
      drag.from = drag.items.indexOf(drag.li);
      drag.to = drag.from;
      const second = rects[1];
      const first = rects[0];
      drag.shift = second && first ? second.left - first.left : (rects[drag.from]?.width ?? 0);
      drag.li.classList.add('is-dragging');
      jokerList.classList.add('is-sorting');
      try {
        drag.li.setPointerCapture(e.pointerId);
      } catch {
        // Některé prohlížeče capture odmítnou — tažení funguje i bez něj, dokud je ukazatel nad řadou.
      }
      hideTooltip();
    }
    e.preventDefault();
    drag.li.style.transform = `translateX(${dx}px)`;
    const center = (drag.centers[drag.from] ?? 0) + dx;
    let to = 0;
    drag.centers.forEach((cx, i) => {
      if (i !== drag!.from && cx < center) to++;
    });
    if (to !== drag.to) {
      drag.to = to;
      drag.items.forEach((li, i) => {
        if (i === drag!.from) return;
        let offset = 0;
        if (drag!.from < to && i > drag!.from && i <= to) offset = -drag!.shift;
        else if (drag!.from > to && i < drag!.from && i >= to) offset = drag!.shift;
        li.classList.add('is-shifting');
        li.style.transform = offset ? `translateX(${offset}px)` : '';
      });
    }
  });

  const endDrag = (e: PointerEvent, cancelled: boolean): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    if (!d.started) {
      drag = null;
      return;
    }
    resetTransforms();
    drag = null;
    // Klik, který po tažení následuje, nesmí otevřít detail.
    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 0);
    if (cancelled || d.to === d.from) return;
    const ordered = [...d.items];
    const [moved] = ordered.splice(d.from, 1);
    if (!moved) return;
    ordered.splice(d.to, 0, moved);
    // Přeskládat hned (žádné probliknutí do starého pořadí), pak akce enginu.
    syncOrder(jokerList, ordered);
    const uids = ordered.map((li) => Number(li.dataset.uid));
    void ctx.act({ type: 'reorderJokers', uids });
  };
  jokerList.addEventListener('pointerup', (e) => endDrag(e, false));
  jokerList.addEventListener('pointercancel', (e) => endDrag(e, true));
  jokerList.addEventListener('lostpointercapture', (e) => {
    if (drag?.started && e.pointerId === drag.pointerId) endDrag(e, false);
  });
  // Zachycení kliku po tažení (fáze capture — dřív než klik karty).
  jokerList.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  return {
    el,
    update() {
      if (drag?.started) return;
      updateJokers();
      updateConsumables();
    },
    jokerEl: (uid) => jokers.get(uid)?.card ?? null,
    consumableEl: (uid) => consumables.get(uid)?.card ?? null,
  };
}

/** Seřadí děti kontejneru podle pole (přesouvá jen to, co je jinde). */
export function syncOrder(container: HTMLElement, order: readonly HTMLElement[]): void {
  order.forEach((node, i) => {
    if (container.children[i] !== node) container.insertBefore(node, container.children[i] ?? null);
  });
}
