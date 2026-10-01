// @vitest-environment happy-dom
/**
 * Grafika a popisky UI: ikony, SVG hrací karty (index, barva, kamenná bez indexu, pipy, figury), obecný renderer
 * ArtSpec, textové popisy všeho obsahu v registru (bez ⟦chybějících klíčů⟧ a nedosazených {parametrů})
 * a komponenty karet a tooltipu.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import type { ArtSpec } from '../../src/engine/content-types';
import type { Card, JokerInstance, Rank, StickerId, Suit } from '../../src/engine/types';
import { HAND_TYPES, RANKS, SUITS } from '../../src/engine/types';
import { t } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import { artMarkup, blindArt, contentArt, RARITY_COLORS, type ArtKind } from '../../src/ui/art/art';
import { cardBackMarkup, cardFaceElement, cardFaceMarkup, SUIT_VARS } from '../../src/ui/art/cards';
import { hasIcon, iconMarkup, iconsLoaded, loadIcons, safeColor } from '../../src/ui/art/icons';
import { createCardView, updateCardView } from '../../src/ui/components/card';
import { createConsumableCard, createContentCard } from '../../src/ui/components/consumableCard';
import { createJokerCard, previewJoker } from '../../src/ui/components/jokerCard';
import { attachTooltip, hideTooltip, richText } from '../../src/ui/components/tooltip';
import {
  blindName,
  boosterTexts,
  bossTexts,
  cardLabel,
  cardName,
  challengeTexts,
  consumableTexts,
  deckTexts,
  editionTexts,
  enhancementTexts,
  handTexts,
  jokerTexts,
  sealTexts,
  stakeTexts,
  stickerText,
  tagTexts,
  voucherTexts,
} from '../../src/ui/describe';

const REG = registry();

function parseSvg(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'image/svg+xml');
}

/** Validní SVG: kořen `<svg>`, žádná chyba parseru, každé `url(#id)` míří na id ve stejném SVG. */
function expectValidSvg(markup: string, label: string): Document {
  const doc = parseSvg(markup);
  expect(doc.querySelector('parsererror')?.textContent ?? null, label).toBeNull();
  expect(doc.documentElement.tagName.toLowerCase(), label).toBe('svg');
  expect(doc.documentElement.getAttribute('viewBox'), label).toMatch(/^0 0 \d+ \d+$/);
  expect(markup, label).not.toContain('%ID%');
  const ids = new Set([...doc.querySelectorAll('[id]')].map((el) => el.getAttribute('id')));
  for (const m of markup.matchAll(/url\(#([^)]+)\)/g))
    expect(ids.has(m[1] ?? ''), `${label}: #${m[1]}`).toBe(true);
  return doc;
}

function card(rank: Rank, suit: Suit, patch: Partial<Card> = {}): Card {
  return {
    id: 1,
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

/** Text bez chybějících klíčů a bez nedosazených parametrů. */
function expectCleanText(text: string | null, label: string): void {
  if (text === null) return;
  expect(text, label).not.toContain('⟦');
  expect(text, label).not.toMatch(/\{[\w.]+(\|[^}]*)?\}/);
  expect(text.trim().length, label).toBeGreaterThan(0);
}

const SPEC: ArtSpec = {
  icon: 'beer-stein',
  bg: '#3b2f2a',
  fg: '#f4e4c1',
  accent: '#c8a24a',
  pattern: 'stripes',
  prop: 'pretzel',
};

// ─────────────────────────── Ikony ───────────────────────────

describe('ikony', () => {
  it('před načtením: vestavěné glyfy fungují, ostatní ikony mají náhradní glyf', () => {
    expect(iconsLoaded()).toBe(false);
    expect(hasIcon('suit-H')).toBe(true);
    expect(hasIcon('beer-stein')).toBe(false);
    expect(iconMarkup('beer-stein')).toContain('data-icon="fallback"');
    expect(iconMarkup('suit-S')).toContain('data-icon="suit-S"');
  });

  it('po načtení (samostatný chunk) vrací skutečnou ikonu s fill="currentColor"', async () => {
    await loadIcons();
    expect(iconsLoaded()).toBe(true);
    expect(hasIcon('beer-stein')).toBe(true);
    const markup = iconMarkup('beer-stein', { x: 10, y: 20, size: 100, color: '#ff0000' });
    expect(markup).toContain('data-icon="beer-stein"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('color="#ff0000"');
    expect(markup).toMatch(/transform="translate\(10 20\) scale\(0\.1953\)"/);
    expect(iconMarkup('neexistujici-ikona')).toContain('data-icon="fallback"');
  });

  it('safeColor propustí jen bezpečné CSS barvy', () => {
    expect(safeColor('#abc', 'x')).toBe('#abc');
    expect(safeColor('rgb(1, 2, 3)', 'x')).toBe('rgb(1, 2, 3)');
    expect(safeColor('red" onload="alert(1)', '#000')).toBe('#000');
    expect(safeColor(undefined, '#000')).toBe('#000');
  });
});

// ─────────────────────────── Hrací karty ───────────────────────────

describe('SVG hrací karty', () => {
  beforeAll(() => loadIcons());

  it('všech 52 karet: validní SVG, správný index a barva', () => {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const label = `${rank}${suit}`;
        const doc = expectValidSvg(cardFaceMarkup(card(rank, suit)), label);
        const root = doc.documentElement;
        expect(root.getAttribute('data-suit'), label).toBe(suit);
        expect(root.getAttribute('data-rank'), label).toBe(String(rank));
        expect(root.getAttribute('style'), label).toContain(SUIT_VARS[suit].cssVar);
        // Index v obou rozích: tahy znaků podle popisku z i18n (10 = dva znaky).
        const corners = doc.querySelectorAll('.pc-corner');
        expect(corners.length, label).toBe(2);
        const strokes = corners[0]?.querySelectorAll('.pc-rank path').length ?? 0;
        expect(strokes, label).toBe([...t(`ranks.${rank}.short`)].length);
        // Symbol barvy je u indexu vždy (barvoslepí).
        expect(corners[0]?.querySelectorAll(':scope > path').length, label).toBe(1);
        if (rank <= 10) expect(doc.querySelectorAll('.pc-pips path').length, label).toBe(rank);
        if (rank >= 11 && rank <= 13) expect(doc.querySelectorAll('.pc-figure').length, label).toBe(2);
        if (rank === 14) expect(doc.querySelector('.pc-ace'), label).not.toBeNull();
      }
    }
  });

  it('kamenná karta nemá index ani barvu', () => {
    const doc = expectValidSvg(cardFaceMarkup(card(12, 'H', { enhancement: 'stone' })), 'stone');
    expect(doc.documentElement.classList.contains('pc-stone')).toBe(true);
    expect(doc.querySelector('.pc-corner')).toBeNull();
    expect(doc.querySelector('.pc-rank')).toBeNull();
    expect(doc.querySelector('.pc-figure')).toBeNull();
    expect(doc.documentElement.getAttribute('style') ?? '').not.toMatch(/--suit-/);
  });

  it('všechna vylepšení a pečetě dávají validní SVG; pečeť má odznak, vylepšení odznak v rohu', () => {
    for (const enh of Object.keys(REG.enhancements)) {
      const doc = expectValidSvg(cardFaceMarkup(card(7, 'S', { enhancement: enh })), enh);
      expect(doc.documentElement.getAttribute('data-enhancement')).toBe(enh);
      if (!REG.enhancements[enh]?.noRankSuit) expect(doc.querySelector('.pc-enh-badge'), enh).not.toBeNull();
    }
    for (const seal of Object.keys(REG.seals)) {
      const doc = expectValidSvg(cardFaceMarkup(card(9, 'D', { seal })), seal);
      expect(doc.querySelector(`.pc-seal[data-seal="${seal}"]`), seal).not.toBeNull();
    }
  });

  it('každá instance má vlastní id ve <defs> (ocelová, figury)', () => {
    const a = cardFaceMarkup(card(12, 'C', { enhancement: 'steel' }));
    const b = cardFaceMarkup(card(12, 'C', { enhancement: 'steel' }));
    const idsA = [...a.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const idsB = [...b.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(idsA.length).toBeGreaterThan(0);
    for (const id of idsA) expect(idsB).not.toContain(id);
  });

  it('rub karty a karta lícem dolů neprozradí líc', () => {
    expectValidSvg(cardBackMarkup(), 'back');
    expectValidSvg(cardBackMarkup(SPEC), 'back-spec');
    const el = cardFaceElement({ ...card(14, 'S'), faceDown: true });
    expect(el.classList.contains('pc-back')).toBe(true);
    expect(el.getAttribute('data-suit')).toBeNull();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    const labelled = cardFaceElement(card(14, 'S'), { label: 'Pikové eso' });
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Pikové eso');
  });
});

// ─────────────────────────── ArtSpec ───────────────────────────

describe('renderer ArtSpec', () => {
  beforeAll(() => loadIcons());

  const KINDS: readonly ArtKind[] = [
    'joker',
    'consumable',
    'voucher',
    'tag',
    'booster',
    'boss',
    'blind',
    'deck',
    'stake',
    'challenge',
    'enhancement',
    'seal',
  ];
  const PATTERNS = ['none', 'stripes', 'dots', 'checker', 'waves', 'rays', 'grid', 'zigzag'] as const;

  it('všechny druhy rámečků × všechny vzory dávají validní SVG s ikonou', () => {
    for (const kind of KINDS) {
      for (const pattern of PATTERNS) {
        const doc = expectValidSvg(artMarkup(kind, { ...SPEC, pattern }), `${kind}/${pattern}`);
        expect(doc.querySelector('[data-icon="beer-stein"]'), `${kind}/${pattern}`).not.toBeNull();
      }
    }
  });

  it('žolík: rámeček podle vzácnosti a drahokamy 1–4', () => {
    for (const [rarity, colors] of Object.entries(RARITY_COLORS)) {
      const markup = artMarkup('joker', SPEC, { rarity: rarity as keyof typeof RARITY_COLORS });
      const doc = expectValidSvg(markup, rarity);
      expect(doc.documentElement.getAttribute('data-rarity')).toBe(rarity);
      expect(markup).toContain(colors.frame);
      expect(markup.match(/l9 10l-9 10l-9-10z/g)?.length, rarity).toBe(colors.gems);
    }
  });

  it('spotřebky, obálky a kupóny mají podle typu jiný tvar', () => {
    const shapes = (['pranostika', 'rada', 'razitko'] as const).map((k) =>
      artMarkup('consumable', SPEC, { consumableKind: k }).replace(/ka\d+/g, ''),
    );
    expect(new Set(shapes).size).toBe(3);
    expect(artMarkup('consumable', SPEC, { consumableKind: 'razitko' })).toContain('<mask');
    const boosters = (['normal', 'jumbo', 'mega'] as const).map((s) =>
      artMarkup('booster', SPEC, { boosterSize: s }).replace(/ka\d+/g, ''),
    );
    expect(new Set(boosters).size).toBe(3);
    expect(artMarkup('voucher', SPEC, { tier: 2 })).not.toBe(artMarkup('voucher', SPEC, { tier: 1 }));
  });

  it('šéf: žeton v barvě BossDef.color; nebezpečné barvy a názvy ikon se escapují', () => {
    expect(artMarkup('boss', SPEC, { color: '#7a2e3a' })).toContain('fill="#7a2e3a"');
    const evil = artMarkup('joker', { icon: '"><script>x</script>', bg: 'red;"><b', fg: '#fff' });
    expectValidSvg(evil, 'evil');
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('red;');
  });

  it('obrázek každé položky obsahu v registru (a žetony útrat)', () => {
    const kinds = [
      ['joker', REG.jokers],
      ['consumable', REG.consumables],
      ['voucher', REG.vouchers],
      ['tag', REG.tags],
      ['booster', REG.boosters],
      ['boss', REG.bosses],
      ['deck', REG.decks],
      ['stake', REG.stakes],
      ['challenge', REG.challenges],
      ['enhancement', REG.enhancements],
      ['seal', REG.seals],
    ] as const;
    for (const [kind, table] of kinds) {
      for (const id of Object.keys(table)) {
        const el = contentArt(kind, id, { label: id });
        expect(el.tagName.toLowerCase(), `${kind}/${id}`).toBe('svg');
        expect(el.getAttribute('aria-label')).toBe(id);
        expectValidSvg(el.outerHTML, `${kind}/${id}`);
      }
    }
    expect(contentArt('joker', 'neexistuje').querySelector('[data-icon="question"]')).not.toBeNull();
    for (const kind of ['small', 'big', 'boss'] as const) {
      expect(blindArt(kind, null).getAttribute('data-kind')).toBe('blind');
    }
  });
});

// ─────────────────────────── Popisy ───────────────────────────

describe('describe(): texty všeho obsahu v registru', () => {
  it('žolíci (vč. dynamických hodnot), spotřebky, kupóny, štítky, obálky, šéfové', () => {
    for (const id of Object.keys(REG.jokers)) {
      const tx = jokerTexts(id);
      for (const [k, v] of Object.entries({
        name: tx.name,
        desc: tx.desc,
        flavor: tx.flavor,
        rarity: tx.rarity,
      }))
        expectCleanText(v, `jokers.${id}.${k}`);
      const inst: JokerInstance = {
        ...previewJoker(id),
        edition: 'foil',
        stickers: ['perishable'],
        perishRounds: 3,
      };
      const withInst = jokerTexts(id, inst);
      expectCleanText(withInst.edition?.desc ?? null, `jokers.${id}.edition`);
      for (const s of withInst.stickers) expectCleanText(s, `jokers.${id}.sticker`);
    }
    for (const id of Object.keys(REG.consumables)) {
      const tx = consumableTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor, tx.kind]) expectCleanText(v, `consumables.${id}`);
    }
    for (const id of Object.keys(REG.vouchers)) {
      const tx = voucherTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor, tx.tierLabel, tx.requires])
        expectCleanText(v, `vouchers.${id}`);
    }
    for (const id of Object.keys(REG.tags)) {
      const tx = tagTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `tags.${id}`);
    }
    for (const id of Object.keys(REG.boosters)) {
      const tx = boosterTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `boosters.${id}`);
    }
    for (const id of Object.keys(REG.bosses)) {
      const tx = bossTexts(id);
      for (const v of [tx.name, tx.rule, tx.intro, tx.defeat, tx.death]) expectCleanText(v, `bosses.${id}`);
      expectCleanText(blindName('boss', id), `bosses.${id}.blindName`);
    }
  });

  it('balíčky, obtížnosti, výzvy, vylepšení, pečetě, edice, kombinace, nálepky', () => {
    for (const id of Object.keys(REG.decks)) {
      const tx = deckTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `decks.${id}`);
    }
    for (const id of Object.keys(REG.stakes)) {
      const tx = stakeTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `stakes.${id}`);
    }
    for (const id of Object.keys(REG.challenges)) {
      const tx = challengeTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor, ...tx.rules]) expectCleanText(v, `challenges.${id}`);
    }
    for (const id of Object.keys(REG.enhancements)) {
      const tx = enhancementTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `enhancements.${id}`);
    }
    for (const id of Object.keys(REG.seals)) {
      const tx = sealTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `seals.${id}`);
    }
    for (const id of Object.keys(REG.editions)) {
      const tx = editionTexts(id);
      for (const v of [tx.name, tx.desc, tx.flavor]) expectCleanText(v, `editions.${id}`);
    }
    for (const type of HAND_TYPES) {
      const tx = handTexts(type);
      expectCleanText(tx.name, type);
      expectCleanText(tx.desc, type);
    }
    for (const s of ['eternal', 'perishable', 'rental'] as StickerId[]) expectCleanText(stickerText(s), s);
    expect(blindName('small')).toBe('Malá útrata');
    expect(blindName('big')).toBe('Velká útrata');
  });

  it('pravděpodobnosti se násobí probabilityMult', () => {
    expect(enhancementTexts('glass').desc).toContain(`1${NBSP}z${NBSP}5`);
    expect(enhancementTexts('glass', { mods: { probabilityMult: 2 } }).desc).toContain(`2${NBSP}z${NBSP}5`);
  });

  it('názvy hracích karet česky a ve správném rodě', () => {
    expect(cardName(card(12, 'H'))).toBe('srdcová dáma');
    expect(cardName(card(14, 'S'))).toBe('pikové eso');
    expect(cardName(card(11, 'C'))).toBe('křížový kluk');
    expect(cardName(card(13, 'D'))).toBe('kárový král');
    expect(cardName(card(10, 'D'))).toBe('kárová desítka');
    expect(cardName(card(2, 'S'))).toBe('piková dvojka');
    expect(cardName(card(7, 'H', { enhancement: 'stone' }))).toBe('kamenná karta');
    expect(cardName(card(7, 'H', { faceDown: true }))).toBe('karta lícem dolů');
    for (const suit of SUITS)
      for (const rank of RANKS) expectCleanText(cardName(card(rank, suit)), `${rank}${suit}`);
  });

  it('přístupný popis karty: úpravy a stav, lícem dolů nic neprozradí', () => {
    expect(cardLabel(card(12, 'H'))).toBe('Srdcová dáma');
    expect(
      cardLabel(card(12, 'H', { enhancement: 'bonus', edition: 'foil', seal: 'red', debuffed: true })),
    ).toBe('Srdcová dáma, Prémiová, Lesklá, Červená pečeť, mimo provoz');
    expect(cardLabel(card(12, 'H', { enhancement: 'stone' }))).toBe('Kamenná karta');
    expect(cardLabel(card(12, 'H', { enhancement: 'gold', faceDown: true }))).toBe('Karta lícem dolů');
  });
});

// ─────────────────────────── Komponenty ───────────────────────────

describe('komponenty karet a tooltip', () => {
  beforeAll(() => loadIcons());

  it('hrací karta: button s data-card-id, aria-pressed, aria-label; update přepne stav', () => {
    let clicks = 0;
    const c = { ...card(12, 'H', { enhancement: 'bonus', edition: 'holo' }), id: 42 };
    const el = createCardView(c, { onClick: () => clicks++, keyHint: '3' });
    document.body.appendChild(el);
    expect(el.tagName).toBe('BUTTON');
    expect(el.dataset.cardId).toBe('42');
    expect(el.getAttribute('aria-pressed')).toBe('false');
    expect(el.getAttribute('aria-label')).toBe('Srdcová dáma, Prémiová, Holografická');
    expect(el.getAttribute('aria-keyshortcuts')).toBe('3');
    expect(el.classList.contains('ed-holo')).toBe(true);
    expect(el.querySelector('svg.pc-face')).not.toBeNull();
    el.click();
    expect(clicks).toBe(1);

    const svgBefore = el.querySelector('svg');
    updateCardView(el, { ...c, debuffed: true }, { selected: true });
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(el.classList.contains('is-selected')).toBe(true);
    expect(el.classList.contains('is-debuffed')).toBe(true);
    expect(el.querySelector('svg')).toBe(svgBefore); // vzhled se nezměnil → bez překreslení

    updateCardView(el, { ...c, faceDown: true });
    expect(el.querySelector('svg.pc-back')).not.toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Karta lícem dolů');
    expect(el.classList.contains('ed-holo')).toBe(false);
    el.remove();
  });

  it('neinteraktivní karta je role="img"', () => {
    const el = createCardView(card(5, 'C'));
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-pressed')).toBeNull();
  });

  it('karty žolíků, spotřebek a obsahu z registru', () => {
    for (const id of Object.keys(REG.jokers)) {
      const j: JokerInstance = { ...previewJoker(id), uid: 7, edition: 'foil', stickers: ['eternal'] };
      const el = createJokerCard(j, { onClick: () => undefined, price: 5 });
      expect(el.dataset.uid).toBe('7');
      expect(el.dataset.defId).toBe(id);
      const label = el.getAttribute('aria-label') ?? '';
      expectCleanText(label, `joker ${id}`);
      expect(label).toContain(t(`jokers.${id}.name`));
      expect(el.querySelector('.price-tag')?.textContent).toBe(`5${NBSP}Kč`);
      expect(el.querySelector('.ksticker--eternal')).not.toBeNull();
    }
    for (const id of Object.keys(REG.consumables)) {
      expectCleanText(createConsumableCard({ defId: id }).getAttribute('aria-label'), `consumable ${id}`);
    }
    for (const id of Object.keys(REG.decks)) {
      const el = createContentCard('deck', id, { onClick: () => undefined });
      expect(el.tagName).toBe('BUTTON');
      expectCleanText(el.getAttribute('aria-label'), `deck ${id}`);
    }
    for (const id of Object.keys(REG.stakes)) {
      expectCleanText(createContentCard('stake', id).getAttribute('aria-label'), `stake ${id}`);
    }
  });

  it('tooltip: hover ukáže role="tooltip" s názvem, flavorem v „…“ a cenou; odchod ho skryje', () => {
    const deckId = Object.keys(REG.decks)[0] ?? 'pub';
    const el = createContentCard('deck', deckId, { price: 3 });
    document.body.appendChild(el);
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    const tip = document.getElementById('karban-tooltip');
    expect(tip).not.toBeNull();
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.classList.contains('is-visible')).toBe(true);
    expect(el.getAttribute('aria-describedby')).toBe('karban-tooltip');
    expect(tip?.textContent).toContain(t(`decks.${deckId}.name`));
    expect(tip?.textContent).toContain('„');
    expect(tip?.textContent).toContain(`3${NBSP}Kč`);
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(tip?.classList.contains('is-visible')).toBe(false);
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    el.remove();
  });

  it('tooltip: dotyk ho na hover neotevře, Escape ho zavře, odpojení uklidí', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const detach = attachTooltip(el, { title: 'X', lines: ['+30 čipů'] });
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    expect(document.getElementById('karban-tooltip')?.classList.contains('is-visible')).toBe(false);
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(document.getElementById('karban-tooltip')?.classList.contains('is-visible')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('karban-tooltip')?.classList.contains('is-visible')).toBe(false);
    detach();
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(document.getElementById('karban-tooltip')?.classList.contains('is-visible')).toBe(false);
    hideTooltip();
    el.remove();
  });

  it('richText zvýrazní čipy, mult, ×mult a peníze', () => {
    const wrap = document.createElement('p');
    wrap.append(
      ...richText(
        t('enhancements.lucky.desc', {
          multChance: 1,
          multOdds: 4,
          mult: 15,
          moneyChance: 1,
          moneyOdds: 12,
          money: 15,
        }),
      ),
    );
    expect(wrap.querySelector('.hl-mult')?.textContent).toBe(`+15${NBSP}mult`);
    expect(wrap.querySelector('.hl-money')?.textContent).toBe(`+15${NBSP}Kč`);
    const chips = document.createElement('p');
    chips.append(
      ...richText(t('editions.foil.desc', { chips: 50 })),
      ...richText(t('editions.poly.desc', { xmult: 1.5 })),
    );
    expect(chips.querySelector('.hl-chips')?.textContent).toBe(`+50${NBSP}čipů`);
    expect(chips.querySelector('.hl-xmult')?.textContent).toBe(`×1,5${NBSP}mult`);
  });
});
