/**
 * Karta spotřebky (sloty spotřebek, Večerka, obálka) a obecná karta obsahu (kupón, obálka, štítek, šéf,
 * balíček, síla piva, výzva, vylepšení, pečeť) — vše podle registru.
 *
 *   createConsumableCard(c, { onClick: () => openUse(c.uid), sellValue: 2 })
 *   createContentCard('voucher', 'loyalty_card', { price: 10, onClick: buy })
 *
 * Stejné chování jako jokerCard: `<button>`/`<div role="img">`, `aria-label`, `aria-pressed`, edice třídou
 * `ed-<id>`, cenovka, tooltip (hover/focus/dlouhý stisk).
 */
import '../styles/cards.css';
import type { ContentRegistry } from '../../engine/content-types';
import type { ConsumableInstance, Modifiers } from '../../engine/types';
import { registry as defaultRegistry } from '../../content';
import { t } from '../../i18n/cs';
import { formatMoney } from '../../i18n/format';
import { contentArt, isRoundArt, type ContentArtKind } from '../art/art';
import { contentTexts, type ContentKind } from '../describe';
import { h } from '../dom';
import { attachTooltip, consumableTooltip, contentTooltip, type TooltipContent } from './tooltip';

export interface ContentCardOptions {
  onClick?: (event: MouseEvent) => void;
  interactive?: boolean;
  selected?: boolean;
  /** Mimo provoz / nedostupné (zašedlé). */
  disabled?: boolean;
  price?: number;
  sellValue?: number;
  showName?: boolean;
  tooltip?: boolean;
  width?: number;
  mods?: Partial<Pick<Modifiers, 'probabilityMult'>>;
  registry?: ContentRegistry;
  className?: string;
}

type ConsumableLike = Pick<ConsumableInstance, 'defId'> &
  Partial<Pick<ConsumableInstance, 'uid' | 'edition'>>;

interface Built {
  el: HTMLElement;
}

function shell(
  kind: ContentArtKind,
  id: string,
  label: string,
  name: string,
  opts: ContentCardOptions,
  tooltip: () => TooltipContent,
  edition?: string | null,
): Built {
  const interactive = opts.interactive ?? opts.onClick !== undefined;
  const art = contentArt(kind, id, { registry: opts.registry });
  const extras: string[] = [];
  if (edition) extras.push(t(`editions.${edition}.name`));
  if (opts.price !== undefined) extras.push(t('art.label.price', { price: opts.price }));
  const fullLabel =
    extras.length === 0 ? label : t('art.label.withExtras', { label, extras: extras.join(', ') });
  const el: HTMLElement = h(
    interactive ? 'button' : 'div',
    {
      type: interactive ? 'button' : undefined,
      role: interactive ? undefined : 'img',
      class: [
        'kcard',
        `kcard--${kind}`,
        isRoundArt(kind) ? 'kcard--round' : '',
        edition ? `ed-${edition}` : '',
        opts.selected ? 'is-selected' : '',
        opts.disabled ? 'is-debuffed' : '',
        opts.className,
      ],
      'data-kind': kind,
      'data-def-id': id,
      'aria-label': fullLabel,
      'aria-pressed': interactive ? !!opts.selected : undefined,
      'aria-disabled': interactive && opts.disabled ? 'true' : undefined,
      style: opts.width ? { '--card-w': `${opts.width}px` } : undefined,
    },
    h('span', { class: 'kcard__inner' }, art, h('span', { class: 'kshine', 'aria-hidden': 'true' })),
    opts.price !== undefined
      ? h('span', { class: 'price-tag', 'aria-hidden': 'true' }, formatMoney(opts.price))
      : null,
    opts.showName ? h('span', { class: 'kcard__name', 'aria-hidden': 'true' }, name) : null,
  );
  if (interactive) {
    el.addEventListener('click', (e) => opts.onClick?.(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    });
  }
  if (opts.tooltip !== false) attachTooltip(el, tooltip);
  return { el };
}

/** Karta spotřebky (pranostika / babská rada / úřední razítko — rámeček podle typu). */
export function createConsumableCard(c: ConsumableLike, opts: ContentCardOptions = {}): HTMLElement {
  const reg = opts.registry ?? defaultRegistry();
  const def = reg.consumables[c.defId];
  const name = t(`consumables.${c.defId}.name`);
  const label = t('art.label.consumable', {
    name,
    kind: t(`art.consumableKind.${def?.kind ?? 'pranostika'}`),
  });
  const { el } = shell(
    'consumable',
    c.defId,
    label,
    name,
    opts,
    () =>
      consumableTooltip(c, {
        registry: opts.registry,
        mods: opts.mods,
        price: opts.price,
        sellValue: opts.sellValue,
      }),
    c.edition,
  );
  if (c.uid !== undefined) el.dataset.uid = String(c.uid);
  if (def) el.dataset.consumableKind = def.kind;
  return el;
}

/** Obecná karta obsahu podle druhu a id (kupón, obálka, štítek, šéf, balíček, síla piva, výzva…). */
export function createContentCard(
  kind: Exclude<ContentArtKind, 'joker' | 'consumable'>,
  id: string,
  opts: ContentCardOptions = {},
): HTMLElement {
  const describeKind: ContentKind = kind;
  const tx = contentTexts(describeKind, id, { registry: opts.registry, mods: opts.mods });
  const label = t('art.label.content', { name: tx.name, kind: t(`art.kind.${kind}`) });
  return shell(kind, id, label, tx.name, opts, () =>
    contentTooltip(describeKind, id, {
      registry: opts.registry,
      mods: opts.mods,
      price: opts.price,
      sellValue: opts.sellValue,
    }),
  ).el;
}
