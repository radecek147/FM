/**
 * Vývojářská galerie grafiky (`#gallery`): všech 52 karet v klasických i čtyřbarevných barvách, všechna
 * vylepšení, pečetě a edice, stavy karet (vybraná, mimo provoz, lícem dolů, ruby balíčků), velikosti a ukázky
 * `ArtSpec` všech druhů obsahu (žolíci z registru, jinak ukázkové obrázky). Každá položka má tooltip.
 *
 * Export `galleryScreen: ScreenFactory` — router ho registruje pod id `gallery` (src/main.ts).
 */
import '../styles/cards.css';
import type { ArtSpec, ContentRegistry, JokerRarity } from '../../engine/content-types';
import type { BlindKind, Card, ConsumableKind, Rank } from '../../engine/types';
import { RANKS, SUITS } from '../../engine/types';
import { t } from '../../i18n/cs';
import type { ScreenFactory } from '../app';
import { artElement, BLIND_ART, blindArt, RARITY_COLORS, type ArtKind, type ArtOptions } from '../art/art';
import { iconsLoaded, loadIcons } from '../art/icons';
import { createCardBack, createCardView, updateCardView } from '../components/card';
import { backButton } from '../components/button';
import { createConsumableCard, createContentCard } from '../components/consumableCard';
import { createJokerCard, previewJoker } from '../components/jokerCard';
import { attachTooltip, type TooltipContent } from '../components/tooltip';
import { blindName, cardLabel, contentTexts } from '../describe';
import type { Child } from '../dom';
import { h } from '../dom';

/** Ukázkové obrázky (pokrývají všechny vzory pozadí), když registr daný druh obsahu ještě nemá. */
const SAMPLE_ART: readonly ArtSpec[] = [
  {
    icon: 'beer-stein',
    bg: '#3b2f2a',
    fg: '#f4e4c1',
    accent: '#c8a24a',
    pattern: 'stripes',
    prop: 'pretzel',
  },
  { icon: 'drill', bg: '#2d1b20', fg: '#f0d7a1', pattern: 'checker' },
  { icon: 'raining', bg: '#24425e', fg: '#e8f1ff', pattern: 'waves', prop: 'umbrella' },
  { icon: 'flower-pot', bg: '#33402a', fg: '#f6efc6', pattern: 'dots' },
  { icon: 'stamper', bg: '#4a1b1f', fg: '#ffe1dc', accent: '#f0a39a', pattern: 'rays' },
  { icon: 'steam-locomotive', bg: '#1d2430', fg: '#dfe6f0', pattern: 'grid', prop: 'stopwatch' },
  { icon: 'card-joker', bg: '#5b2a86', fg: '#f5f3ff', pattern: 'zigzag' },
  { icon: 'golem-head', bg: '#57534e', fg: '#e7e5e4', pattern: 'none', prop: 'stone-block' },
];

const sample = (i: number): ArtSpec => SAMPLE_ART[i % SAMPLE_ART.length] as ArtSpec;

const CONSUMABLE_KINDS: readonly ConsumableKind[] = ['pranostika', 'rada', 'razitko'];
const BOOSTER_SIZES = ['normal', 'jumbo', 'mega'] as const;

function card(rank: Rank, suit: Card['suit'], patch: Partial<Card> = {}, id = 0): Card {
  return {
    id,
    suit,
    rank,
    enhancement: null,
    seal: null,
    edition: null,
    bonusChips: 0,
    debuffed: false,
    faceDown: false,
    ...patch,
  };
}

function item(caption: string, ...children: Child[]): HTMLElement {
  return h('figure', { class: 'gallery__item' }, children, h('figcaption', null, caption));
}

function section(id: string, title: string, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: 'gallery__section', 'aria-labelledby': `gallery-${id}` },
    h('h2', { id: `gallery-${id}` }, title),
    children,
  );
}

/** Karta obsahu z registru s popiskem (názvem) pod ní. */
function namedContent(kind: Parameters<typeof createContentCard>[0], id: string): HTMLElement {
  return item(contentTexts(kind, id).name, createContentCard(kind, id));
}

/** Ukázkový obrázek (není v registru) s tooltipem. */
function sampleTile(kind: ArtKind, spec: ArtSpec, n: number, opts: ArtOptions = {}): HTMLElement {
  const name = t('art.gallery.sample', { n });
  const kindLabel = t(`art.kind.${kind === 'blind' ? 'blind' : kind}`);
  const round = kind === 'tag' || kind === 'boss' || kind === 'blind' || kind === 'stake';
  const el = h(
    'div',
    {
      class: [
        'kcard',
        `kcard--${kind}`,
        round ? 'kcard--round' : '',
        opts.rarity ? `rarity-${opts.rarity}` : '',
      ],
      tabindex: '0',
      role: 'img',
      'aria-label': t('art.label.content', { name, kind: kindLabel }),
    },
    h('span', { class: 'kcard__inner' }, artElement(kind, spec, opts)),
  );
  const content: TooltipContent = {
    title: name,
    subtitle: opts.rarity ? `${t(`art.rarity.${opts.rarity}`)} · ${kindLabel}` : kindLabel,
    tone: opts.rarity ? `rarity-${opts.rarity}` : `kind-${kind}`,
    lines: [t('art.gallery.sampleDesc', { kind: kindLabel })],
  };
  attachTooltip(el, content);
  return el;
}

function grid(children: Child[], tight = false): HTMLElement {
  return h('div', { class: ['gallery__grid', tight ? 'gallery__grid--tight' : ''] }, children);
}

/** Interaktivní karta, která se klikem vybírá (ukázka výběru, aria-pressed). */
function toggleCard(c: Card): HTMLElement {
  let selected = false;
  const el = createCardView(c, {
    onClick: () => {
      selected = !selected;
      updateCardView(el, c, { selected });
    },
  });
  return el;
}

function deckOfCards(): HTMLElement[] {
  let id = 1;
  return SUITS.map((suit) =>
    h(
      'div',
      { class: 'gallery__row' },
      RANKS.map((rank) => toggleCard(card(rank, suit, {}, id++))),
    ),
  );
}

function buildSections(reg: ContentRegistry): HTMLElement[] {
  const out: HTMLElement[] = [];
  const enhancementRanks: readonly Rank[] = [12, 7, 14, 10, 13, 3, 11, 9, 5];

  out.push(
    section(
      'classic',
      t('art.gallery.sections.classic'),
      h('div', { class: 'classic-suits' }, grid(deckOfCards(), true)),
    ),
  );
  out.push(
    section(
      'colorblind',
      t('art.gallery.sections.colorblind'),
      h('div', { class: 'colorblind' }, grid(deckOfCards(), true)),
    ),
  );

  out.push(
    section(
      'enhancements',
      t('art.gallery.sections.enhancements'),
      grid(
        Object.keys(reg.enhancements).map((id, i) => {
          const c = card(enhancementRanks[i % enhancementRanks.length] as Rank, SUITS[i % 4] ?? 'H', {
            enhancement: id,
          });
          return item(t(`enhancements.${id}.name`), createCardView(c));
        }),
      ),
    ),
  );

  out.push(
    section(
      'seals',
      t('art.gallery.sections.seals'),
      grid(
        Object.keys(reg.seals).map((id, i) =>
          item(t(`seals.${id}.name`), createCardView(card(8, SUITS[i % 4] ?? 'D', { seal: id }))),
        ),
      ),
    ),
  );

  const firstJoker = Object.keys(reg.jokers)[0];
  out.push(
    section(
      'editions',
      t('art.gallery.sections.editions'),
      grid(
        Object.keys(reg.editions).flatMap((id) => [
          item(t(`editions.${id}.name`), createCardView(card(13, 'S', { edition: id }))),
          item(
            t(`editions.${id}.name`),
            firstJoker
              ? createJokerCard({ ...previewJoker(firstJoker, reg), edition: id })
              : h(
                  'span',
                  { class: ['kcard', 'kcard--joker', `ed-${id}`] },
                  h(
                    'span',
                    { class: 'kcard__inner' },
                    artElement('joker', sample(0), { rarity: 'rare' }),
                    h('span', { class: 'kshine', 'aria-hidden': 'true' }),
                  ),
                ),
          ),
        ]),
      ),
    ),
  );

  const combo = card(12, 'H', { enhancement: 'gold', seal: 'red', edition: 'holo' });
  out.push(
    section(
      'states',
      t('art.gallery.sections.states'),
      grid([
        item(t('art.gallery.states.normal'), createCardView(card(14, 'S'))),
        item(
          t('art.gallery.states.selected'),
          createCardView(card(14, 'H'), { selected: true, onClick: () => undefined, keyHint: '2' }),
        ),
        item(t('art.gallery.states.debuffed'), createCardView(card(11, 'D', { debuffed: true }))),
        item(t('art.gallery.states.faceDown'), createCardView(card(5, 'C', { faceDown: true }))),
        item(cardLabel(combo), createCardView(combo)),
        item(t('art.gallery.states.back'), createCardBack({ label: t('art.cardName.back') })),
        ...Object.keys(reg.decks).map((id) => item(t(`decks.${id}.name`), createContentCard('deck', id))),
      ]),
    ),
  );

  out.push(
    section(
      'sizes',
      t('art.gallery.sections.sizes'),
      grid(
        [70, 90, 110, 160].map((w) =>
          item(
            `${w} px`,
            createCardView(card(10, 'D', {}, w), { width: w }),
            createCardView(card(13, 'C', {}, w + 1), { width: w }),
          ),
        ),
      ),
    ),
  );

  // Žolíci: z registru, jinak ukázky; rámečky všech vzácností vždy.
  const jokerIds = Object.keys(reg.jokers);
  out.push(
    section(
      'jokers',
      t('art.gallery.sections.jokers'),
      jokerIds.length > 0
        ? grid(
            jokerIds.map((id) =>
              item(
                t(`jokers.${id}.name`),
                createJokerCard(previewJoker(id, reg), { onClick: () => undefined }),
              ),
            ),
          )
        : [
            h('p', { class: 'gallery__note' }, t('art.gallery.empty')),
            grid(SAMPLE_ART.map((s, i) => sampleTile('joker', s, i + 1, { rarity: 'common' }))),
          ],
    ),
  );
  out.push(
    section(
      'rarities',
      t('art.gallery.sections.rarities'),
      grid(
        (Object.keys(RARITY_COLORS) as JokerRarity[]).map((rarity, i) =>
          item(t(`art.rarity.${rarity}`), sampleTile('joker', sample(i), i + 1, { rarity })),
        ),
      ),
    ),
  );

  const consumableIds = Object.keys(reg.consumables);
  out.push(
    section(
      'consumables',
      t('art.gallery.sections.consumables'),
      grid([
        ...consumableIds.map((id) => item(t(`consumables.${id}.name`), createConsumableCard({ defId: id }))),
        ...CONSUMABLE_KINDS.map((kind, i) =>
          item(
            t(`art.consumableKind.${kind}`),
            sampleTile('consumable', sample(i + 2), i + 1, { consumableKind: kind }),
          ),
        ),
      ]),
    ),
  );

  out.push(
    section(
      'vouchers',
      t('art.gallery.sections.vouchers'),
      grid([
        ...Object.keys(reg.vouchers).map((id) => namedContent('voucher', id)),
        item(t('art.voucher.tier1'), sampleTile('voucher', sample(3), 1, { tier: 1 })),
        item(t('art.voucher.tier2'), sampleTile('voucher', sample(4), 2, { tier: 2 })),
      ]),
    ),
  );

  out.push(
    section(
      'tags',
      t('art.gallery.sections.tags'),
      grid([
        ...Object.keys(reg.tags).map((id) => namedContent('tag', id)),
        ...[1, 3, 5].map((i, n) => sampleTile('tag', sample(i), n + 1)),
      ]),
    ),
  );

  out.push(
    section(
      'boosters',
      t('art.gallery.sections.boosters'),
      grid([
        ...Object.keys(reg.boosters).map((id) => namedContent('booster', id)),
        ...BOOSTER_SIZES.map((size, i) =>
          item(
            t(`art.booster.size.${size}`),
            sampleTile('booster', sample(6 - i), i + 1, { boosterSize: size }),
          ),
        ),
      ]),
    ),
  );

  const blindKinds: readonly BlindKind[] = ['small', 'big', 'boss'];
  out.push(
    section(
      'bosses',
      t('art.gallery.sections.bosses'),
      grid([
        ...blindKinds.map((kind) => {
          const el = h(
            'div',
            {
              class: ['kcard', 'kcard--round', 'kcard--blind'],
              tabindex: '0',
              role: 'img',
              'aria-label': blindName(kind),
            },
            h('span', { class: 'kcard__inner' }, blindArt(kind, null)),
          );
          attachTooltip(el, { title: blindName(kind), subtitle: t('art.kind.blind'), lines: [] });
          return item(blindName(kind), el);
        }),
        ...Object.keys(reg.bosses).map((id) => namedContent('boss', id)),
        ...(Object.keys(reg.bosses).length === 0
          ? [1, 2].map((n) => sampleTile('boss', sample(n), n, { color: n === 1 ? '#7a2e3a' : '#2f6b4f' }))
          : []),
        item(
          t('art.kind.blind'),
          sampleTile('blind', BLIND_ART.small.spec, 1, { color: BLIND_ART.small.color }),
        ),
      ]),
    ),
  );

  out.push(
    section(
      'decks',
      t('art.gallery.sections.decks'),
      grid(Object.keys(reg.decks).map((id) => namedContent('deck', id))),
    ),
  );

  out.push(
    section(
      'stakes',
      t('art.gallery.sections.stakes'),
      grid(Object.keys(reg.stakes).map((id) => namedContent('stake', id))),
    ),
  );

  const challengeIds = Object.keys(reg.challenges);
  out.push(
    section(
      'challenges',
      t('art.gallery.sections.challenges'),
      grid(
        challengeIds.length > 0
          ? challengeIds.map((id) => namedContent('challenge', id))
          : [sampleTile('challenge', sample(5), 1)],
      ),
    ),
  );

  // Vylepšení a pečetě jako dlaždice (sbírka, tooltipy).
  out.push(
    section(
      'tiles',
      `${t('art.kind.enhancement')} · ${t('art.kind.seal')}`,
      grid(
        [
          ...Object.keys(reg.enhancements).map((id) => createContentCard('enhancement', id, { width: 56 })),
          ...Object.keys(reg.seals).map((id) => createContentCard('seal', id, { width: 56 })),
        ],
        true,
      ),
    ),
  );
  return out;
}

export const galleryScreen: ScreenFactory = (app) => {
  const body = h('div', { class: 'gallery__body' });
  const el = h(
    'main',
    { class: 'screen gallery', 'aria-labelledby': 'gallery-title', 'data-testid': 'gallery' },
    h(
      'header',
      { class: 'screen-header' },
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'gallery-title', class: 'screen-title' }, t('art.gallery.title')),
        h('p', { class: 'screen-subtitle' }, t('art.gallery.intro')),
      ),
      backButton(() => {
        history.replaceState(null, '', location.pathname + location.search);
        app.go('menu');
      }, t('art.gallery.back')),
    ),
    body,
  );

  let disposed = false;
  const render = (): void => {
    if (!disposed) body.replaceChildren(...buildSections(app.registry));
  };
  if (iconsLoaded()) {
    render();
  } else {
    body.replaceChildren(h('p', { class: 'gallery__note', role: 'status' }, t('art.gallery.loading')));
    void loadIcons().then(render);
  }

  return {
    el,
    onKey(e: KeyboardEvent): boolean {
      if (e.key === 'Escape') {
        history.replaceState(null, '', location.pathname + location.search);
        app.go('menu');
        return true;
      }
      return false;
    },
    dispose(): void {
      disposed = true;
    },
  };
};
