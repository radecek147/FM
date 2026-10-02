/**
 * Interaktivní hrací karta (ruka, stůl, náhled balíčku, Večerka).
 *
 *   const el = createCardView(card, { selected, keyHint: '1', onClick: () => controller.toggleSelect(card.id) });
 *   updateCardView(el, card, { selected: true });   // jen přepne stav, SVG překreslí, až když se změní vzhled
 *
 * - interaktivní karta je `<button>` s `aria-pressed` (výběr) a `aria-label` s názvem a úpravami,
 *   neinteraktivní je `<div role="img">`,
 * - `data-card-id`, třídy stavu `is-selected` / `is-debuffed` / `is-face-down`, edice `ed-<id>`,
 *   vylepšení `enh-<id>` (styly v styles/cards.css; výběr = posun nahoru, hover/tilt jen transform),
 * - mezerník na zaměřené kartě přepne výběr; Enter propadne k obrazovce (ve hře = Zahrát, DESIGN 13.3),
 * - tooltip (hover/focus/dlouhý stisk) s detailem karty.
 */
import '../styles/cards.css';
import type { ArtSpec, ContentRegistry } from '../../engine/content-types';
import type { Card, Modifiers } from '../../engine/types';
import { registry as defaultRegistry } from '../../content';
import { cardFaceElement, cardFaceKey } from '../art/cards';
import { cardLabel } from '../describe';
import { h } from '../dom';
import { attachTooltip, cardTooltip } from './tooltip';

export interface CardViewOptions {
  /** Vybraná (posunutá nahoru, `aria-pressed="true"`). */
  selected?: boolean;
  /** Klik / Enter / mezerník / tap. Bez něj je karta neinteraktivní (`role="img"`), pokud `interactive` neurčí jinak. */
  onClick?: (card: Readonly<Card>, event: MouseEvent) => void;
  interactive?: boolean;
  /** Klávesová zkratka zobrazená v rohu (`1`–`8`) a v `aria-keyshortcuts`. */
  keyHint?: string;
  /** Tooltip s detailem (výchozí true). */
  tooltip?: boolean;
  /** Šířka karty v px (jinak CSS proměnná `--card-w` z kontejneru). */
  width?: number;
  /** Rub pro kartu lícem dolů (ArtSpec balíčku). */
  back?: ArtSpec;
  /** Modifikátory runu (pevné čipy, pravděpodobnosti v tooltipu). */
  mods?: Partial<Pick<Modifiers, 'probabilityMult' | 'fixedCardChips'>>;
  /** Proč je karta mimo provoz / lícem dolů (pravidlo šéfa) — řádek v tooltipu, jen u takové karty. */
  reason?: string | null;
  registry?: ContentRegistry;
  className?: string;
}

type CardEl = HTMLElement & { __card?: Readonly<Card>; __opts?: CardViewOptions; __detach?: () => void };

function visualKey(card: Readonly<Card>): string {
  return `${cardFaceKey(card)}|${card.faceDown ? 'down' : 'up'}`;
}

function applyState(el: CardEl, card: Readonly<Card>, opts: CardViewOptions): void {
  const reg = opts.registry ?? defaultRegistry();
  const selected = !!opts.selected;
  el.classList.toggle('is-selected', selected);
  el.classList.toggle('is-debuffed', card.debuffed && !card.faceDown);
  el.classList.toggle('is-face-down', card.faceDown);
  // Edice a vylepšení jako třídy (lícem dolů se neprozradí).
  for (const cls of [...el.classList])
    if (cls.startsWith('ed-') || cls.startsWith('enh-')) el.classList.remove(cls);
  if (!card.faceDown) {
    if (card.edition) el.classList.add(`ed-${card.edition}`);
    if (card.enhancement) el.classList.add(`enh-${card.enhancement}`);
  }
  el.dataset.cardId = String(card.id);
  el.setAttribute('aria-label', cardLabel(card, reg));
  if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  const key = el.querySelector<HTMLElement>('.pcard__key');
  if (opts.keyHint) {
    el.setAttribute('aria-keyshortcuts', opts.keyHint);
    if (key) key.textContent = opts.keyHint;
  } else {
    el.removeAttribute('aria-keyshortcuts');
    if (key) key.textContent = '';
  }
}

function renderArt(el: CardEl, card: Readonly<Card>, opts: CardViewOptions): void {
  const inner = el.querySelector<HTMLElement>('.pcard__inner');
  if (!inner) return;
  const svgEl = cardFaceElement(card, { registry: opts.registry, back: opts.back });
  const old = inner.querySelector('svg');
  if (old) old.replaceWith(svgEl);
  else inner.prepend(svgEl);
  el.dataset.visual = visualKey(card);
}

/**
 * Jemný 3D náklon za ukazatelem (jen transform přes CSS proměnné). Nejvýš jeden zápis za snímek
 * (requestAnimationFrame) a rozměry karty se měří jen při najetí — pohyb myši nevynucuje přepočet layoutu.
 */
function bindTilt(el: HTMLElement): void {
  const inner = el.querySelector<HTMLElement>('.pcard__inner');
  if (!inner) return;
  let rect: DOMRect | null = null;
  let last: { x: number; y: number } | null = null;
  let frame = 0;
  const apply = (): void => {
    frame = 0;
    if (!last) return;
    rect ??= el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = (last.x - rect.left) / rect.width - 0.5;
    const dy = (last.y - rect.top) / rect.height - 0.5;
    inner.style.setProperty('--tilt-x', `${(-dy * 10).toFixed(2)}deg`);
    inner.style.setProperty('--tilt-y', `${(dx * 12).toFixed(2)}deg`);
  };
  // Najetí a klik (výběr kartu povytáhne) = změřit znovu.
  const remeasure = (): void => {
    rect = null;
  };
  el.addEventListener('pointerenter', remeasure);
  el.addEventListener('pointerdown', remeasure);
  const reset = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    rect = null;
    inner.style.removeProperty('--tilt-x');
    inner.style.removeProperty('--tilt-y');
  };
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    // Tažená karta (přesun v ruce) se nenaklání — změřený obdélník by s posunem neseděl.
    if (el.classList.contains('is-dragging')) {
      if (last) reset();
      return;
    }
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  });
  el.addEventListener('pointerleave', reset);
}

/** Vytvoří hrací kartu. */
export function createCardView(card: Readonly<Card>, opts: CardViewOptions = {}): HTMLElement {
  const interactive = opts.interactive ?? opts.onClick !== undefined;
  const el = h(
    interactive ? 'button' : 'div',
    {
      type: interactive ? 'button' : undefined,
      role: interactive ? undefined : 'img',
      class: ['pcard', opts.className],
      style: opts.width ? { '--card-w': `${opts.width}px` } : undefined,
    },
    h('span', { class: 'pcard__inner' }, h('span', { class: 'kshine', 'aria-hidden': 'true' })),
    h('span', { class: 'pcard__key', 'aria-hidden': 'true' }),
  ) as CardEl;
  el.__card = card;
  el.__opts = opts;
  renderArt(el, card, opts);
  applyState(el, card, opts);
  bindTilt(el);

  if (interactive) {
    el.addEventListener('click', (e) => {
      const current = el.__card;
      if (current) el.__opts?.onClick?.(current, e);
    });
    // Mezerník na zaměřené kartě = výběr (nativní aktivace tlačítka). Enter propadne k obrazovce: herní
    // obrazovka z něj v kole udělá Zahrát (DESIGN 13.3), jinde ho tlačítko zpracuje samo. Přeskočení animace
    // mezerníkem řeší App už ve fázi zachytávání, takže ho tohle nezablokuje.
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ') e.stopPropagation();
    });
  }
  if (opts.tooltip !== false) {
    el.__detach = attachTooltip(el, () => {
      const current = el.__card;
      return current
        ? cardTooltip(current, {
            registry: el.__opts?.registry,
            mods: el.__opts?.mods,
            reason: current.debuffed || current.faceDown ? el.__opts?.reason : null,
          })
        : null;
    });
  }
  return el;
}

/**
 * Aktualizuje existující kartu: stav (výběr, debuff, zkratka) vždy, SVG jen při změně vzhledu
 * (hodnota, barva, vylepšení, pečeť, líc/rub). Volby se slučují s původními.
 */
export function updateCardView(
  el: HTMLElement,
  card: Readonly<Card>,
  opts: Partial<CardViewOptions> = {},
): void {
  const cel = el as CardEl;
  const merged: CardViewOptions = { ...(cel.__opts ?? {}), ...opts };
  cel.__card = card;
  cel.__opts = merged;
  const before = cel.dataset.visual;
  if (before !== visualKey(card)) {
    renderArt(cel, card, merged);
    // Karta se otočila (Bílá paní, odkrytí zahrané karty lícem dolů) — krátké „překlopení“ (jen transform).
    if (before !== undefined && before.endsWith('|down') !== card.faceDown) flipCard(cel);
  }
  applyState(cel, card, merged);
}

/** Překlopení karty: CSS animace `pcard-flip` na vnitřku (styles/cards.css; vypnuté animace ji ruší). */
function flipCard(el: HTMLElement): void {
  el.classList.remove('is-flipping');
  // Vynucený reflow jen u otočené karty (pár za tah), aby se animace spustila znovu.
  void el.offsetWidth;
  el.classList.add('is-flipping');
  el.addEventListener('animationend', () => el.classList.remove('is-flipping'), { once: true });
}

/** Odpojí posluchače tooltipu (při ručním odstranění karty; překreslení obrazovky to nepotřebuje). */
export function disposeCardView(el: HTMLElement): void {
  (el as CardEl).__detach?.();
}

/** Karta zobrazená rubem (balíček, dobírací hromádka). */
export function createCardBack(
  opts: { label?: string; back?: ArtSpec; width?: number; className?: string } = {},
): HTMLElement {
  const svgEl = cardFaceElement(
    { suit: 'S', rank: 2, enhancement: null, seal: null, faceDown: true },
    { back: opts.back },
  );
  return h(
    'div',
    {
      class: ['pcard', 'is-face-down', 'pcard--back', opts.className],
      role: opts.label ? 'img' : undefined,
      'aria-label': opts.label,
      'aria-hidden': opts.label ? undefined : 'true',
      style: opts.width ? { '--card-w': `${opts.width}px` } : undefined,
    },
    h('span', { class: 'pcard__inner' }, svgEl),
  );
}
