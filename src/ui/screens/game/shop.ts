/**
 * Večerka (DESIGN 13.1, 2.5): kartové sloty (žolík / spotřebka / hrací karta), obálky, kupón, Přehodit s cenou
 * a Pokračovat (`leaveShop`). Prodej žolíků a spotřebek jde z horní řady. Prázdný stav „Večerka zavřená –
 * inventura“. Nákup obecně přes akce enginu (`buy`, `buyAndUse`, `buyBooster`, `buyVoucher`, `reroll`) —
 * obsah registru se může libovolně rozšiřovat.
 */
import type { RunState, ShopItem } from '../../../engine';
import { Game } from '../../../engine';
import { t } from '../../../i18n/cs';
import { button } from '../../components/button';
import { createCardView } from '../../components/card';
import { createConsumableCard, createContentCard } from '../../components/consumableCard';
import { createJokerCard } from '../../components/jokerCard';
import { boosterTexts, capitalize, cardName, voucherTexts } from '../../describe';
import { h } from '../../dom';
import { formatMoney } from '../../../i18n/format';
import type { GameCtx } from './shared';
import { canAfford, hasConsumableRoom, hasJokerRoom } from './shared';

export function shopKey(ctx: GameCtx): string {
  const s = ctx.controller.state;
  const m = ctx.controller.engine.modifiers();
  return `${s.money}|${JSON.stringify(s.shop)}|${s.jokers.length}|${s.consumables.length}|${m.jokerSlots}|${
    m.consumableSlots
  }|${m.debtLimit}`;
}

function itemName(ctx: GameCtx, item: ShopItem): string {
  if (item.kind === 'joker') return t(`jokers.${item.joker.defId}.name`);
  if (item.kind === 'consumable') return t(`consumables.${item.consumable.defId}.name`);
  return capitalize(cardName(item.card, ctx.registry));
}

/**
 * Prodejní ceny zboží po koupi (tooltip „Cena · Prodej za“), podle slotu. Počítá je engine (`Game.sellValue`) nad
 * kopií stavu, do které se zboží „přidá“ — vzorec prodejní ceny (edice, zapůjčený, `sellBonus`) tak zůstává na
 * jednom místě a skutečný run se nemění. Hrací karty se neprodávají (bez ceny).
 */
function prospectiveSellValues(ctx: GameCtx): Map<number, number> {
  const out = new Map<number, number>();
  const s = ctx.controller.state;
  const items = s.shop?.items ?? [];
  if (!items.some((i) => !i.sold && i.kind !== 'card')) return out;
  try {
    const copy = structuredClone(s) as RunState;
    const slots: [number, number][] = [];
    items.forEach((item, slot) => {
      if (item.sold) return;
      if (item.kind === 'joker') {
        copy.jokers.push(structuredClone(item.joker));
        slots.push([slot, item.joker.uid]);
      } else if (item.kind === 'consumable') {
        copy.consumables.push(structuredClone(item.consumable));
        slots.push([slot, item.consumable.uid]);
      }
    });
    const game = Game.fromState(copy, ctx.registry);
    for (const [slot, uid] of slots) out.set(slot, game.sellValue(uid));
  } catch {
    // Bez prodejní ceny v tooltipu se dá nakupovat dál.
  }
  return out;
}

function itemVisual(ctx: GameCtx, item: ShopItem, sellValue: number | undefined): HTMLElement {
  const mods = ctx.controller.engine.modifiers();
  if (item.kind === 'joker')
    return createJokerCard(item.joker, { price: item.price, sellValue, registry: ctx.registry, mods });
  if (item.kind === 'consumable')
    return createConsumableCard(item.consumable, {
      price: item.price,
      sellValue,
      registry: ctx.registry,
      mods,
    });
  return h(
    'div',
    { class: 'shop-slot__playing' },
    createCardView(item.card, { registry: ctx.registry, mods }),
    h('span', { class: 'price-tag', 'aria-hidden': 'true' }, formatMoney(item.price)),
  );
}

/**
 * Nálepka zboží ze štítku: žolík navíc (Doporučení od známého, Protekce), sleva (`priceMult`) a edice bez příplatku
 * (Vyleštěné příbory, Fotonegativ). Jinak null.
 */
export function itemBadge(item: ShopItem): string | null {
  const parts: string[] = [];
  if (item.extra) parts.push(t('game.shop.badgeExtra'));
  if (item.priceMult !== undefined && item.priceMult < 1)
    parts.push(t('game.shop.badgeDiscount', { pct: Math.round((1 - item.priceMult) * 100) }));
  if (item.kind === 'joker' && item.noEditionSurcharge && item.joker.edition)
    parts.push(t('game.shop.badgeEdition'));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function soldSlot(testId: string): HTMLElement {
  return h(
    'li',
    { class: 'shop-slot is-sold', 'data-testid': testId },
    h('div', { class: 'shop-slot__sold' }, h('span', { class: 'shop-slot__stamp' }, t('game.shop.sold'))),
  );
}

/** Tlačítko nákupu s důvodem, proč nejde (nápověda `title`). */
function buyButton(opts: {
  label: string;
  disabledReason: string | null;
  testId: string;
  focusKey: string;
  variant?: 'primary' | 'paper';
  /** Id názvu zboží — čtečka k „Koupit za 4 Kč“ přečte, co se kupuje (aria-describedby). */
  describedBy?: string;
  onClick: () => void;
}): HTMLButtonElement {
  const b = button({
    label: opts.label,
    variant: opts.variant ?? 'primary',
    size: 'small',
    testId: opts.testId,
    disabled: opts.disabledReason !== null,
    title: opts.disabledReason ?? undefined,
    describedBy: opts.describedBy,
    onClick: opts.onClick,
  });
  b.dataset.focusKey = opts.focusKey;
  return b;
}

export function renderShop(ctx: GameCtx): HTMLElement {
  const c = ctx.controller;
  const s = c.state;
  const shop = s.shop;

  const sellValues = prospectiveSellValues(ctx);
  const items = (shop?.items ?? []).map((item, slot) => {
    const testId = `shop-item-${slot}`;
    if (item.sold) return soldSlot(testId);
    const afford = canAfford(ctx, item.price);
    const room =
      item.kind === 'joker'
        ? hasJokerRoom(ctx, item.joker.edition)
        : item.kind === 'consumable'
          ? hasConsumableRoom(ctx, item.consumable.edition)
          : true;
    const reason = !afford ? t('game.shop.cantAfford') : !room ? t('game.shop.noRoom') : null;
    const actions: HTMLElement[] = [
      buyButton({
        label: t('game.shop.buy', { price: item.price }),
        disabledReason: reason,
        testId: `shop-buy-${slot}`,
        focusKey: `buy-${slot}`,
        describedBy: `${testId}-name`,
        onClick: () => void ctx.act({ type: 'buy', slot }),
      }),
    ];
    // „Koupit a použít“ jen u spotřebek bez cílů (ve Večerce není ruka, ze které by šly vybrat).
    if (item.kind === 'consumable' && !ctx.registry.consumables[item.consumable.defId]?.target) {
      actions.push(
        buyButton({
          label: t('game.shop.buyAndUse'),
          disabledReason: afford ? null : t('game.shop.cantAfford'),
          testId: `shop-use-${slot}`,
          focusKey: `use-${slot}`,
          describedBy: `${testId}-name`,
          variant: 'paper',
          onClick: () => void ctx.act({ type: 'buyAndUse', slot }),
        }),
      );
    }
    const badge = itemBadge(item);
    return h(
      'li',
      { class: ['shop-slot', `shop-slot--${item.kind}`, badge ? 'has-badge' : ''], 'data-testid': testId },
      badge
        ? h(
            'p',
            {
              class: 'shop-slot__badge',
              title: t('game.shop.badgeTitle', { text: badge }),
              'data-testid': `${testId}-badge`,
            },
            badge,
          )
        : null,
      h('div', { class: 'shop-slot__card' }, itemVisual(ctx, item, sellValues.get(slot))),
      h('p', { class: 'shop-slot__name', id: `${testId}-name` }, itemName(ctx, item)),
      h('div', { class: 'shop-slot__actions' }, actions),
    );
  });

  const boosters = (shop?.boosters ?? []).map((b, slot) => {
    const testId = `shop-booster-${slot}`;
    if (b.sold) return soldSlot(testId);
    const name = boosterTexts(b.boosterId, { registry: ctx.registry }).name;
    return h(
      'li',
      { class: 'shop-slot shop-slot--booster', 'data-testid': testId },
      h(
        'div',
        { class: 'shop-slot__card' },
        createContentCard('booster', b.boosterId, { price: b.price, registry: ctx.registry }),
      ),
      h('p', { class: 'shop-slot__name', id: `${testId}-name` }, name),
      h(
        'div',
        { class: 'shop-slot__actions' },
        buyButton({
          label: t('game.shop.open', { price: b.price }),
          disabledReason: canAfford(ctx, b.price) ? null : t('game.shop.cantAfford'),
          testId: `shop-open-${slot}`,
          focusKey: `open-${slot}`,
          describedBy: `${testId}-name`,
          onClick: () => void ctx.act({ type: 'buyBooster', slot }),
        }),
      ),
    );
  });

  const vouchers = (shop?.vouchers ?? []).map((v, slot) => {
    const testId = `shop-voucher-${slot}`;
    if (v.sold) return soldSlot(testId);
    const name = voucherTexts(v.voucherId, { registry: ctx.registry }).name;
    return h(
      'li',
      { class: ['shop-slot', 'shop-slot--voucher', v.extra ? 'has-badge' : ''], 'data-testid': testId },
      // Kupón navíc z Úředního poukazu platí jen v této Večerce.
      v.extra
        ? h(
            'p',
            {
              class: 'shop-slot__badge',
              title: t('game.shop.badgeTitle', { text: t('game.shop.badgeExtra') }),
              'data-testid': `${testId}-badge`,
            },
            t('game.shop.badgeExtra'),
          )
        : null,
      h(
        'div',
        { class: 'shop-slot__card' },
        createContentCard('voucher', v.voucherId, { price: v.price, registry: ctx.registry }),
      ),
      h('p', { class: 'shop-slot__name', id: `${testId}-name` }, name),
      h(
        'div',
        { class: 'shop-slot__actions' },
        buyButton({
          label: t('game.shop.redeem', { price: v.price }),
          disabledReason: canAfford(ctx, v.price) ? null : t('game.shop.cantAfford'),
          testId: `shop-redeem-${slot}`,
          focusKey: `redeem-${slot}`,
          describedBy: `${testId}-name`,
          onClick: () => void ctx.act({ type: 'buyVoucher', slot }),
        }),
      ),
    );
  });

  const anyLeft =
    (shop?.items ?? []).some((i) => !i.sold) ||
    (shop?.boosters ?? []).some((b) => !b.sold) ||
    (shop?.vouchers ?? []).some((v) => !v.sold);

  const section = (title: string, list: HTMLElement[], cls: string): HTMLElement | null =>
    list.length === 0
      ? null
      : h(
          'section',
          // --slots: šířka sekce v jedné řadě podle počtu slotů (zboží 2, obálky 2, kupón 1…).
          { class: ['shop-section', cls], style: { '--slots': list.length } },
          h('h3', { class: 'shop-section__title' }, title),
          h('ul', { class: 'shop-section__slots', role: 'list' }, list),
        );

  const rerollCost = shop?.freeRerolls ? 0 : (shop?.rerollCost ?? 0);
  const reroll = buyButton({
    label: rerollCost === 0 ? t('game.shop.rerollFree') : t('game.shop.reroll', { price: rerollCost }),
    disabledReason: canAfford(ctx, rerollCost) ? null : t('game.shop.cantAfford'),
    testId: 'shop-reroll',
    focusKey: 'reroll',
    variant: 'paper',
    onClick: () => void ctx.act({ type: 'reroll' }),
  });
  reroll.setAttribute('aria-describedby', 'shop-reroll-desc');
  const leave = button({
    label: t('game.shop.continue'),
    title: t('game.shop.continueLabel'),
    variant: 'primary',
    testId: 'shop-continue',
    autofocus: true,
    onClick: () => void ctx.act({ type: 'leaveShop' }),
  });
  leave.dataset.focusKey = 'continue';

  return h(
    'section',
    { class: 'game-panel shop', 'aria-labelledby': 'shop-title', 'data-testid': 'shop' },
    h(
      'header',
      { class: 'game-panel__header shop__header' },
      h(
        'div',
        { class: 'shop__sign' },
        h('h2', { class: 'game-panel__title shop__title', id: 'shop-title' }, t('game.shop.title')),
        h('p', { class: 'game-panel__subtitle' }, t('game.shop.subtitle')),
      ),
      h(
        'div',
        { class: 'shop__bar' },
        reroll,
        h('span', { class: 'visually-hidden', id: 'shop-reroll-desc' }, t('game.shop.rerollLabel')),
        leave,
      ),
    ),
    anyLeft
      ? null
      : h(
          'div',
          { class: 'shop-empty paper', 'data-testid': 'shop-empty' },
          h('p', { class: 'shop-empty__title' }, t('game.shop.empty')),
          h('p', { class: 'shop-empty__hint' }, t('game.shop.emptyHint')),
        ),
    anyLeft
      ? h(
          'div',
          { class: 'shop__shelves' },
          section(t('game.shop.items'), items, 'shop-section--items'),
          section(t('game.shop.boosters'), boosters, 'shop-section--boosters'),
          section(t('game.shop.vouchers'), vouchers, 'shop-section--vouchers'),
        )
      : null,
  );
}
