/**
 * Tooltip (bublina s detailem) na hover, focus a dlouhý stisk (dotyk):
 * název, typ/vzácnost, mechanika (čísla zvýrazněná barvou čipů/multu/peněz), flavor v „…“, cena.
 *
 * Jediný sdílený element `#karban-tooltip` (`role="tooltip"`), cíl dostane `aria-describedby`.
 * Pozice a zobrazení se animují jen přes transform/opacity. Dlouhý stisk na dotyku tooltip ukáže a potlačí
 * následný klik (výběr karty), takže si hráč může obsah prohlédnout bez akce.
 */
import '../styles/cards.css';
import type { Card, ConsumableInstance, JokerInstance, Modifiers, RunState } from '../../engine/types';
import type { ContentRegistry } from '../../engine/content-types';
import { cardChips } from '../../engine';
import { registry as defaultRegistry } from '../../content';
import { t } from '../../i18n/cs';
import { CURRENCY } from '../../i18n/format';
import {
  bossReasonText,
  bossTexts,
  capitalize,
  cardName,
  consumableTexts,
  copiedByText,
  copyStatusText,
  contentTexts,
  editionTexts,
  enhancementTexts,
  isRanklessCard,
  jokerTexts,
  previewJokerInstance,
  sealTexts,
  voucherTexts,
  type ContentKind,
  type DescribeOptions,
} from '../describe';
import { h } from '../dom';

export interface TooltipLine {
  text: string;
  /** Tlumený řádek (stav, poznámka). */
  muted?: boolean;
}

export interface TooltipContent {
  title: string;
  /** Typ / vzácnost („Vzácný žolík“, „Babská rada“). */
  subtitle?: string | null;
  /** CSS modifikátor barvy podtitulku (`rarity-rare`, `kind-razitko`…). */
  tone?: string;
  lines?: readonly (string | TooltipLine | null | undefined)[];
  flavor?: string | null;
  footer?: readonly string[];
}

export type TooltipSource = TooltipContent | (() => TooltipContent | null);

const TOOLTIP_ID = 'karban-tooltip';
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
const MARGIN = 8;
const GAP = 10;

let tipEl: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let watchFrame = 0;
let globalsBound = false;

function ensureTip(): HTMLElement {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = h('div', { id: TOOLTIP_ID, class: 'ktip', role: 'tooltip', 'aria-hidden': 'true' });
  document.body.appendChild(tipEl);
  if (!globalsBound) {
    globalsBound = true;
    window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
    window.addEventListener('resize', hideTooltip, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && anchor) hideTooltip();
    });
    // Dotyk mimo kotvu tooltip zavře.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (anchor && !anchor.contains(e.target as Node)) hideTooltip();
      },
      { capture: true, passive: true },
    );
  }
  return tipEl;
}

// ─────────────────────────── Zvýraznění čísel ───────────────────────────

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let highlightRe: RegExp | null = null;
function highlighter(): RegExp {
  if (highlightRe) return highlightRe;
  const words = (key: string): string =>
    t(key)
      .split(',')
      .map((w) => escapeRe(w.trim()))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .join('|');
  const num = '[+−-]?\\d[\\d\\u00a0]*(?:,\\d+)?';
  const sp = '[\\u00a0 ]';
  highlightRe = new RegExp(
    `(${num}${sp}(?:${words('art.highlight.chips')}))(?![\\p{L}])|` +
      `(×\\d+(?:,\\d+)?(?:${sp}(?:${words('art.highlight.mult')}))?)|` +
      `(${num}${sp}(?:${words('art.highlight.mult')}))(?![\\p{L}])|` +
      `(${num}${sp}${escapeRe(CURRENCY)})`,
    'gu',
  );
  return highlightRe;
}

/**
 * Text s barevně zvýrazněnými čísly: `+30 čipů` (čipy), `+4 mult` (mult), `×1,5 mult` (násobič), `5 Kč` (peníze).
 * Vrací uzly (text vkládá jako textové uzly, bez innerHTML).
 */
export function richText(text: string): Node[] {
  const re = highlighter();
  re.lastIndex = 0;
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(document.createTextNode(text.slice(last, idx)));
    const cls = m[1] ? 'hl-chips' : m[2] ? 'hl-xmult' : m[3] ? 'hl-mult' : 'hl-money';
    out.push(h('span', { class: cls }, m[0]));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

// ─────────────────────────── Vykreslení a pozice ───────────────────────────

function render(content: TooltipContent): HTMLParagraphElement[] {
  const lines = (content.lines ?? [])
    .filter((l): l is string | TooltipLine => !!l)
    .map((l) => (typeof l === 'string' ? { text: l } : l));
  return [
    h('p', { class: 'ktip__title' }, content.title),
    content.subtitle ? h('p', { class: ['ktip__subtitle', content.tone ?? ''] }, content.subtitle) : null,
    ...lines.map((l) =>
      h('p', { class: { ktip__line: true, 'ktip__line--muted': !!l.muted } }, richText(l.text)),
    ),
    content.flavor
      ? h('p', { class: 'ktip__flavor' }, t('art.tooltip.flavor', { text: content.flavor }))
      : null,
    content.footer && content.footer.length > 0
      ? h('p', { class: 'ktip__footer' }, content.footer.join(' · '))
      : null,
  ].filter((n) => n !== null);
}

function position(tip: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const w = tip.offsetWidth;
  const ht = tip.offsetHeight;
  let x = rect.left + rect.width / 2 - w / 2;
  x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  let y = rect.top - ht - GAP;
  let below = false;
  if (y < MARGIN) {
    y = rect.bottom + GAP;
    below = true;
    if (y + ht > vh - MARGIN) y = Math.max(MARGIN, vh - ht - MARGIN);
  }
  tip.classList.toggle('ktip--below', below);
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function watchAnchor(): void {
  cancelAnimationFrame(watchFrame);
  let last = '';
  const tick = (): void => {
    if (!anchor || !tipEl) return;
    // Kotva zmizela z DOM (překreslení po kliku) → tooltip pryč.
    if (!anchor.isConnected) {
      hideTooltip();
      return;
    }
    // Kotva se posunula (výběr karty = posun nahoru, přeskládání ruky) → tooltip za ní.
    const r = anchor.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`;
    if (key !== last) {
      if (last !== '') position(tipEl, anchor);
      last = key;
    }
    watchFrame = requestAnimationFrame(tick);
  };
  watchFrame = requestAnimationFrame(tick);
}

/** Ukáže tooltip u prvku. */
export function showTooltip(target: HTMLElement, content: TooltipContent): void {
  const tip = ensureTip();
  if (anchor && anchor !== target) anchor.removeAttribute('aria-describedby');
  anchor = target;
  tip.replaceChildren(...render(content));
  tip.setAttribute('aria-hidden', 'false');
  tip.classList.add('is-visible');
  target.setAttribute('aria-describedby', TOOLTIP_ID);
  position(tip, target);
  watchAnchor();
}

/** Skryje tooltip. */
export function hideTooltip(): void {
  cancelAnimationFrame(watchFrame);
  if (anchor) anchor.removeAttribute('aria-describedby');
  anchor = null;
  if (!tipEl) return;
  tipEl.classList.remove('is-visible');
  tipEl.setAttribute('aria-hidden', 'true');
}

/** Je tooltip právě zobrazený (u daného prvku)? */
export function isTooltipVisible(target?: HTMLElement): boolean {
  return anchor !== null && (target === undefined || anchor === target);
}

/**
 * Připojí tooltip k prvku: hover (myš/pero), focus (klávesnice), dlouhý stisk (dotyk). Obsah může být funkce —
 * zavolá se při každém zobrazení (aktuální stav). Vrací funkci, která tooltip odpojí.
 */
export function attachTooltip(el: HTMLElement, source: TooltipSource): () => void {
  let pressTimer = 0;
  let pressStart: { x: number; y: number } | null = null;
  let suppressClick = false;

  const resolveContent = (): TooltipContent | null => (typeof source === 'function' ? source() : source);
  const open = (): void => {
    const content = resolveContent();
    if (content) showTooltip(el, content);
  };
  const close = (): void => {
    if (anchor === el) hideTooltip();
  };
  const cancelPress = (): void => {
    window.clearTimeout(pressTimer);
    pressStart = null;
  };

  const onEnter = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') open();
  };
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') close();
  };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    pressStart = { x: e.clientX, y: e.clientY };
    window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      pressStart = null;
      suppressClick = true;
      open();
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent): void => {
    if (!pressStart) return;
    if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_TOLERANCE) cancelPress();
  };
  const onClickCapture = (e: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onContextMenu = (e: Event): void => {
    // Dlouhý stisk na Androidu otevírá kontextové menu — u tooltipu ho nechceme.
    if (suppressClick || pressStart) e.preventDefault();
  };
  const onFocus = (): void => {
    // Focus z klávesnice (Tab) tooltip ukáže; focus po kliku myší ne (to obstará hover).
    let keyboard = true;
    try {
      keyboard = el.matches(':focus-visible');
    } catch {
      keyboard = true;
    }
    if (keyboard) open();
  };

  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', cancelPress);
  el.addEventListener('pointercancel', cancelPress);
  el.addEventListener('click', onClickCapture, true);
  el.addEventListener('contextmenu', onContextMenu);
  el.addEventListener('focus', onFocus);
  el.addEventListener('blur', close);

  return () => {
    cancelPress();
    close();
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', cancelPress);
    el.removeEventListener('pointercancel', cancelPress);
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('contextmenu', onContextMenu);
    el.removeEventListener('focus', onFocus);
    el.removeEventListener('blur', close);
  };
}

// ─────────────────────────── Obsah tooltipů ───────────────────────────

export interface TooltipOptions extends DescribeOptions {
  /** Cena ve Večerce (patička „Cena 5 Kč“). */
  price?: number;
  /** Prodejní cena (patička „Prodej za 3 Kč“). */
  sellValue?: number;
  /** Modifikátory runu (pevné čipy karet, pravděpodobnosti). */
  mods?: Partial<Pick<Modifiers, 'probabilityMult' | 'fixedCardChips'>>;
}

function priceFooter(opts?: TooltipOptions): string[] {
  const out: string[] = [];
  if (opts?.price !== undefined) out.push(t('art.tooltip.price', { price: opts.price }));
  if (opts?.sellValue !== undefined) out.push(t('art.tooltip.sell', { price: opts.sellValue }));
  return out;
}

const labeled = (name: string, desc: string): string => t('art.tooltip.edition', { name, desc });

/**
 * Tooltip hrací karty: název, čipy, vylepšení, edice, pečeť, stav. `reason` vysvětlí, proč je karta mimo provoz
 * nebo lícem dolů (pravidlo šéfa — `bossReasonText`).
 */
export function cardTooltip(
  card: Readonly<Card>,
  opts?: TooltipOptions & { registry?: ContentRegistry; reason?: string | null },
): TooltipContent {
  const r = opts?.registry ?? defaultRegistry();
  const title = capitalize(cardName(card, r));
  const reason: TooltipLine[] = opts?.reason ? [{ text: opts.reason, muted: true }] : [];
  if (card.faceDown) {
    return {
      title,
      subtitle: t('art.kind.card'),
      lines: [{ text: t('art.card.faceDownHint'), muted: true }, ...reason],
    };
  }
  const fixed = opts?.mods?.fixedCardChips ?? 0;
  const chips = cardChips(card, r.enhancements, { fixedCardChips: fixed });
  const lines: (string | TooltipLine)[] = [];
  // Mimo provoz čipy nedává — číslo zůstane vidět, ale ztlumené.
  if (chips > 0)
    lines.push(
      card.debuffed ? { text: t('art.card.chips', { chips }), muted: true } : t('art.card.chips', { chips }),
    );
  if (card.enhancement) {
    const e = enhancementTexts(card.enhancement, opts);
    lines.push(labeled(e.name, e.desc));
  }
  if (card.edition) {
    const e = editionTexts(card.edition, opts);
    lines.push(labeled(e.name, e.desc));
  }
  if (card.seal) {
    const s = sealTexts(card.seal, opts);
    lines.push(labeled(s.name, s.desc));
  }
  if (isRanklessCard(card, r) && !card.enhancement)
    lines.push({ text: t('art.card.stoneHint'), muted: true });
  if (card.debuffed) lines.push({ text: t('art.card.debuffedHint'), muted: true }, ...reason);
  return { title, subtitle: t('art.kind.card'), lines, footer: priceFooter(opts) };
}

export interface JokerTooltipOptions extends TooltipOptions {
  /** Dočasný debuff v kole (`round.jokerDebuffs`). */
  debuffed?: boolean;
  /**
   * Stav runu pro žolíka ve slotech (kopírování: koho Napodobitel kopíruje, kdo kopíruje tohoto žolíka).
   * Funkce, ať tooltip čte aktuální stav při každém zobrazení.
   */
  run?: () => Readonly<RunState>;
}

/**
 * Tooltip žolíka: název, vzácnost, mechanika (aktuální čísla), stav kopírování, edice, nálepky, poznámka
 * o nekopírovatelnosti, flavor, cena a prodejní cena (přibitý „Prodat nejde“).
 */
export function jokerTooltip(joker: Readonly<JokerInstance>, opts?: JokerTooltipOptions): TooltipContent {
  const r = opts?.registry ?? defaultRegistry();
  const tx = jokerTexts(joker.defId, joker as JokerInstance, opts);
  const lines: (string | TooltipLine)[] = [tx.desc];
  const run = opts?.run?.();
  if (run) {
    const copy = copyStatusText(run, joker, r);
    if (copy) lines.push(copy);
  }
  if (tx.edition) lines.push(labeled(tx.edition.name, tx.edition.desc));
  for (const s of tx.stickers) lines.push({ text: s, muted: true });
  if (joker.debuffed || opts?.debuffed) {
    lines.push({ text: t('art.tooltip.jokerDebuffed'), muted: true });
    // Vypnutý pravidlem šéfa (Exekutor, Jednooký hejtman, Krajský úřad, Výpadek proudu) — proč.
    const why = run?.round?.jokerDebuffs.includes(joker.uid) ? bossReasonText(run, r) : null;
    if (why) lines.push({ text: why, muted: true });
  }
  const by = run ? copiedByText(run, joker, r) : null;
  if (by) lines.push({ text: by, muted: true });
  if (!tx.copyable) lines.push({ text: t('art.copy.notCopyable'), muted: true });
  const footer = priceFooter(opts);
  if (opts?.sellValue !== undefined && joker.stickers.includes('eternal')) {
    footer[footer.length - 1] = t('art.tooltip.noSell');
  }
  return {
    title: tx.name,
    subtitle: `${tx.rarity} · ${t('art.kind.joker')}`,
    tone: `rarity-${tx.rarityId}`,
    lines,
    flavor: tx.flavor,
    footer,
  };
}

/** Tooltip spotřebky: název, typ, mechanika, edice, flavor, cena. */
export function consumableTooltip(
  c: Pick<ConsumableInstance, 'defId'> & Partial<Pick<ConsumableInstance, 'edition'>>,
  opts?: TooltipOptions,
): TooltipContent {
  const tx = consumableTexts(c.defId, opts);
  const lines: string[] = [tx.desc];
  if (c.edition) {
    const e = editionTexts(c.edition, opts);
    lines.push(labeled(e.name, e.desc));
  }
  return {
    title: tx.name,
    subtitle: tx.kind,
    tone: `kind-${tx.kindId}`,
    lines,
    flavor: tx.flavor,
    footer: priceFooter(opts),
  };
}

/** Obecný tooltip obsahu podle druhu a id (kupón, štítek, obálka, šéf, balíček, síla piva, výzva…). */
export function contentTooltip(kind: ContentKind, id: string, opts?: TooltipOptions): TooltipContent {
  if (kind === 'joker') return jokerTooltip(jokerPreview(id, opts?.registry), opts);
  if (kind === 'consumable') return consumableTooltip({ defId: id }, opts);
  const tx = contentTexts(kind, id, opts);
  const lines: (string | TooltipLine)[] = [tx.desc];
  let subtitle = t(`art.kind.${kind}`);
  if (kind === 'voucher') {
    const v = voucherTexts(id, opts);
    subtitle = v.tierLabel;
    if (v.requires) lines.push({ text: v.requires, muted: true });
  }
  return {
    title: tx.name,
    subtitle,
    tone: `kind-${kind}`,
    lines,
    flavor: kind === 'boss' ? bossTexts(id, opts).intro : tx.flavor,
    footer: priceFooter(opts),
  };
}

function jokerPreview(defId: string, r?: ContentRegistry): JokerInstance {
  const def = (r ?? defaultRegistry()).jokers[defId];
  return def
    ? previewJokerInstance(def)
    : { uid: 0, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}
