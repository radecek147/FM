/**
 * Karta žolíka (řada žolíků, Večerka, obálka, sbírka) — obecně přes registr, funguje pro libovolného žolíka
 * z `src/content/jokers.ts`.
 *
 *   const el = createJokerCard(joker, { onClick: () => openDetail(joker.uid), sellValue: game.sellValue(joker.uid) });
 *   updateJokerCard(el, joker, { selected: true });
 *
 * - `<button>` (s `onClick`) nebo `<div role="img">`, `data-uid`, `data-def-id`, `aria-label` s názvem,
 *   vzácností, edicí, nálepkami a cenou,
 * - rámeček podle vzácnosti (art.ts), edice třídou `ed-<id>` (třpyt v CSS), nálepky jako odznaky,
 *   zvětralý / dočasně debuffnutý = `is-debuffed`, cenovka (`price`), tooltip s aktuálním popisem,
 *   náklon za myší s odleskem (src/ui/fx/tilt.ts) a kolébání při najetí (CSS).
 */
import '../styles/cards.css';
import type { ContentRegistry } from '../../engine/content-types';
import type { JokerInstance, Modifiers, RunState } from '../../engine/types';
import { registry as defaultRegistry } from '../../content';
import { t } from '../../i18n/cs';
import { formatMoney, formatNumber } from '../../i18n/format';
import { artElement, UNKNOWN_ART } from '../art/art';
import { iconElement } from '../art/icons';
import { previewJokerInstance } from '../describe';
import { h } from '../dom';
import { bindTilt } from '../fx/tilt';
import { attachTooltip, jokerTooltip } from './tooltip';

export interface JokerCardOptions {
  /** Klik / Enter / tap (detail, prodej, výběr v obálce). Bez něj je karta neinteraktivní. */
  onClick?: (joker: Readonly<JokerInstance>, event: MouseEvent) => void;
  interactive?: boolean;
  /** Vybraný (např. v obálce). */
  selected?: boolean;
  /** Dočasný debuff v kole (`round.jokerDebuffs`) navíc k `joker.debuffed`. */
  debuffed?: boolean;
  /** Cena ve Večerce / obálce — zobrazí cenovku a patičku tooltipu. */
  price?: number;
  /** Prodejní cena (patička tooltipu). */
  sellValue?: number;
  /** Ukázat název pod kartou (sbírka, obálka). */
  showName?: boolean;
  /** Tooltip (výchozí true). */
  tooltip?: boolean;
  /** Šířka v px (jinak `--card-w`). */
  width?: number;
  mods?: Partial<Pick<Modifiers, 'probabilityMult'>>;
  registry?: ContentRegistry;
  className?: string;
  /** Stav runu pro tooltip žolíka ve slotech (stav kopírování) — čte se při každém zobrazení. */
  run?: () => Readonly<RunState>;
  /** Kopírující žolík (Napodobitel) právě kopíruje: id cíle a směr k němu v řadě (−1 vlevo, 1 vpravo). */
  copying?: { defId: string; dir: -1 | 1 } | null;
  /** Id žolíků, kteří tohoto žolíka právě kopírují (odznak a zvýraznění v řadě). */
  copiedBy?: readonly string[];
}

type JokerEl = HTMLElement & { __joker?: Readonly<JokerInstance>; __opts?: JokerCardOptions };

const STICKER_ICONS: Readonly<Record<string, string>> = {
  eternal: 'padlock',
  perishable: 'hourglass',
  rental: 'ticket',
};

function jokerLabel(joker: Readonly<JokerInstance>, opts: JokerCardOptions): string {
  const reg = opts.registry ?? defaultRegistry();
  const def = reg.jokers[joker.defId];
  const label = t('art.label.joker', {
    name: t(`jokers.${joker.defId}.name`),
    rarity: t(`art.rarity.${def?.rarity ?? 'common'}`),
  });
  const extras: string[] = [];
  if (joker.edition) extras.push(t(`editions.${joker.edition}.name`));
  for (const s of joker.stickers) {
    extras.push(
      s === 'perishable' && joker.perishRounds !== undefined && joker.perishRounds > 0
        ? t('art.label.perishLeft', { n: joker.perishRounds })
        : t(`art.stickers.${s}.name`),
    );
  }
  if (joker.debuffed || opts.debuffed) extras.push(t('art.card.debuffed'));
  if (opts.copying) extras.push(t('art.copy.labelActive', { name: t(`jokers.${opts.copying.defId}.name`) }));
  if (opts.copiedBy && opts.copiedBy.length > 0) {
    extras.push(
      t('art.copy.labelCopied', { names: opts.copiedBy.map((id) => t(`jokers.${id}.name`)).join(', ') }),
    );
  }
  if (opts.price !== undefined) extras.push(t('art.label.price', { price: opts.price }));
  return extras.length === 0 ? label : t('art.label.withExtras', { label, extras: extras.join(', ') });
}

function renderStickers(joker: Readonly<JokerInstance>): HTMLElement | null {
  if (joker.stickers.length === 0) return null;
  return h(
    'span',
    { class: 'kstickers', 'aria-hidden': 'true' },
    joker.stickers.map((s) =>
      h(
        'span',
        { class: ['ksticker', `ksticker--${s}`] },
        iconElement(STICKER_ICONS[s] ?? 'star'),
        s === 'perishable' && joker.perishRounds !== undefined
          ? h('span', { class: 'ksticker__n' }, formatNumber(Math.max(0, joker.perishRounds)))
          : null,
      ),
    ),
  );
}

/**
 * Odznak kopírování (vlevo nahoře): u kopírujícího žolíka maska a šipka směrem k cíli, u kopírovaného jen maska.
 * Text nese aria-label karty a tooltip, odznak je jen vizuální.
 */
function renderCopyBadge(opts: JokerCardOptions): HTMLElement | null {
  if (opts.copying) {
    return h(
      'span',
      {
        class: ['kcopy', 'kcopy--from', opts.copying.dir < 0 ? 'kcopy--left' : 'kcopy--right'],
        'aria-hidden': 'true',
        'data-testid': 'joker-copying',
      },
      opts.copying.dir < 0 ? iconElement('arrow', { className: 'kcopy__arrow' }) : null,
      iconElement('drama-masks'),
      opts.copying.dir > 0 ? iconElement('arrow', { className: 'kcopy__arrow' }) : null,
    );
  }
  if (opts.copiedBy && opts.copiedBy.length > 0) {
    return h(
      'span',
      { class: ['kcopy', 'kcopy--target'], 'aria-hidden': 'true', 'data-testid': 'joker-copied' },
      iconElement('drama-masks'),
    );
  }
  return null;
}

function render(el: JokerEl, joker: Readonly<JokerInstance>, opts: JokerCardOptions): void {
  const reg = opts.registry ?? defaultRegistry();
  const def = reg.jokers[joker.defId];
  const rarity = def?.rarity ?? 'common';
  const art = artElement('joker', def?.art ?? UNKNOWN_ART, { rarity });
  // Spravuje jen vlastní třídy — cizí (např. stav tažení z obrazovky) nechává být.
  for (const cls of [...el.classList])
    if (cls.startsWith('rarity-') || cls.startsWith('ed-')) el.classList.remove(cls);
  el.classList.add('kcard', 'jcard', `rarity-${rarity}`);
  if (opts.className) el.classList.add(...opts.className.split(/\s+/).filter(Boolean));
  if (joker.edition) el.classList.add(`ed-${joker.edition}`);
  el.classList.toggle('is-selected', !!opts.selected);
  el.classList.toggle('is-debuffed', joker.debuffed || !!opts.debuffed);
  el.classList.toggle('is-copying', !!opts.copying);
  el.classList.toggle('is-copy-target', !!opts.copiedBy && opts.copiedBy.length > 0);
  el.dataset.uid = String(joker.uid);
  el.dataset.defId = joker.defId;
  el.setAttribute('aria-label', jokerLabel(joker, opts));
  if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', opts.selected ? 'true' : 'false');
  const parts = [
    h('span', { class: 'kcard__inner' }, art, h('span', { class: 'kshine', 'aria-hidden': 'true' })),
    renderStickers(joker),
    renderCopyBadge(opts),
    opts.price !== undefined
      ? h('span', { class: 'price-tag', 'aria-hidden': 'true' }, formatMoney(opts.price))
      : null,
    opts.showName
      ? h('span', { class: 'kcard__name', 'aria-hidden': 'true' }, t(`jokers.${joker.defId}.name`))
      : null,
  ];
  el.replaceChildren(...parts.filter((p) => p !== null));
}

/** Vytvoří kartu žolíka. */
export function createJokerCard(joker: Readonly<JokerInstance>, opts: JokerCardOptions = {}): HTMLElement {
  const interactive = opts.interactive ?? opts.onClick !== undefined;
  const el: JokerEl = h(interactive ? 'button' : 'div', {
    type: interactive ? 'button' : undefined,
    role: interactive ? undefined : 'img',
    style: opts.width ? { '--card-w': `${opts.width}px` } : undefined,
  });
  el.__joker = joker;
  el.__opts = opts;
  render(el, joker, opts);
  // Náklon za myší a odlesk (src/ui/fx/tilt.ts); kolébání při najetí řeší CSS (styles/cards.css).
  bindTilt(el, { max: 7 });
  if (interactive) {
    el.addEventListener('click', (e) => {
      if (el.__joker) el.__opts?.onClick?.(el.__joker, e);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    });
  }
  if (opts.tooltip !== false) {
    attachTooltip(el, () => {
      const j = el.__joker;
      const o = el.__opts ?? {};
      return j
        ? jokerTooltip(j, {
            registry: o.registry,
            mods: o.mods,
            price: o.price,
            sellValue: o.sellValue,
            debuffed: o.debuffed,
            run: o.run,
          })
        : null;
    });
  }
  return el;
}

/** Aktualizuje kartu žolíka (stav, edice, nálepky, cena); volby se slučují s původními. */
export function updateJokerCard(
  el: HTMLElement,
  joker: Readonly<JokerInstance>,
  opts: Partial<JokerCardOptions> = {},
): void {
  const jel = el as JokerEl;
  const merged: JokerCardOptions = { ...(jel.__opts ?? {}), ...opts };
  jel.__joker = joker;
  jel.__opts = merged;
  render(jel, joker, merged);
}

/** Instance pro náhled žolíka podle id (sbírka, galerie) — počáteční stav, bez edice a nálepek. */
export function previewJoker(defId: string, registry: ContentRegistry = defaultRegistry()): JokerInstance {
  const def = registry.jokers[defId];
  return def
    ? previewJokerInstance(def)
    : { uid: 0, defId, edition: null, state: {}, sellBonus: 0, stickers: [], debuffed: false };
}
