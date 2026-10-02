/**
 * Dialogy herní obrazovky: Info o runu, náhled balíčku, pauza (Esc), detail žolíka (Prodat, posun)
 * a detail spotřebky (Použít s vybranými kartami jako cíli, Prodat). Vše přes `openModal` (focus trap,
 * Esc, návrat focusu) a akce controlleru.
 */
import type { Card, HandType, JokerInstance, RunState, Suit } from '../../../engine';
import { HAND_TYPES, RANKS, SUITS, handValueAtLevel } from '../../../engine';
import { t } from '../../../i18n/cs';
import { formatNumber } from '../../../i18n/format';
import { blindArt } from '../../art/art';
import { button } from '../../components/button';
import { createCardBack, createCardView } from '../../components/card';
import { createConsumableCard } from '../../components/consumableCard';
import { createJokerCard } from '../../components/jokerCard';
import { openModal } from '../../components/modal';
import { hideTooltip, richText } from '../../components/tooltip';
import {
  bossTexts,
  consumableTexts,
  copiedByText,
  copyStatusText,
  deckTexts,
  isRanklessCard,
  jokerTexts,
  stakeTexts,
  tagTexts,
  voucherTexts,
} from '../../describe';
import { h } from '../../dom';
import { openSettingsModal } from '../settings';
import type { GameCtx } from './shared';
import { copySeed } from './shared';

// ─────────────────────────── Info o runu ───────────────────────────

function infoSection(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'run-info__section' }, h('h3', { class: 'run-info__title' }, title), children);
}

function textList(items: string[]): HTMLElement {
  if (items.length === 0) return h('p', { class: 'run-info__none' }, t('game.runInfo.none'));
  return h(
    'ul',
    { class: 'run-info__list', role: 'list' },
    items.map((text) => h('li', null, richText(text))),
  );
}

/**
 * Šéf patra (DESIGN 13.1, Info o runu): žeton, jméno, pravidlo a cíl; v kole šéfa i to, jestli pravidlo platí
 * (Odvolání). Na Imperialu navíc pravidlo Velké útraty.
 */
function bossSummary(ctx: GameCtx): HTMLElement {
  const c = ctx.controller;
  const s = c.state;
  const slot = s.blinds.find((b) => b.kind === 'boss');
  const id = slot?.bossId && ctx.registry.bosses[slot.bossId] ? slot.bossId : null;
  if (!slot || !id) return h('p', { class: 'run-info__none' }, t('game.runInfo.bossNone'));
  const tx = bossTexts(id, { registry: ctx.registry });
  const disabled = s.round?.blind === 'boss' && s.round.bossDisabled;
  const status =
    slot.status === 'defeated'
      ? t('game.runInfo.bossDefeated')
      : disabled
        ? t('game.sidebar.bossDisabled')
        : t('game.runInfo.bossTarget', { target: c.engine.blindTarget('boss', id) });
  const big = s.blinds.find((b) => b.kind === 'big');
  const extra = big?.bossId && ctx.registry.bosses[big.bossId] ? big.bossId : null;
  return h(
    'div',
    { class: 'run-info__boss', 'data-testid': 'run-info-boss' },
    h(
      'div',
      { class: 'run-info__boss-token', 'aria-hidden': 'true' },
      blindArt('boss', id, { registry: ctx.registry }),
    ),
    h(
      'div',
      null,
      h('p', { class: 'run-info__boss-name' }, tx.name),
      h('p', null, tx.rule),
      h('p', { class: 'run-info__muted' }, status),
      extra
        ? h(
            'p',
            { class: 'run-info__muted' },
            t('game.runInfo.bigRule', { rule: bossTexts(extra, { registry: ctx.registry }).rule }),
          )
        : null,
    ),
  );
}

function handsTable(ctx: GameCtx): HTMLElement {
  const s = ctx.controller.state;
  const rows = HAND_TYPES.map((type: HandType) => {
    const def = ctx.registry.handTypes[type];
    const hl = s.handLevels[type] ?? { level: 1, played: 0 };
    const secret = def.secret && !s.discoveredHands.includes(type);
    if (secret) {
      return h(
        'tr',
        { class: 'is-secret', 'aria-label': t('game.runInfo.secretLabel') },
        h('th', { scope: 'row' }, t('game.runInfo.secret')),
        h('td', null, t('game.runInfo.secret')),
        h('td', null, t('game.runInfo.secret')),
        h('td', null, t('game.runInfo.secret')),
      );
    }
    const v = handValueAtLevel(def, hl.level);
    return h(
      'tr',
      { 'data-hand': type },
      h('th', { scope: 'row' }, t(`hands.${type}.name`)),
      h('td', null, formatNumber(hl.level)),
      h(
        'td',
        { class: 'run-info__value' },
        h('span', { class: 'hl-chips' }, formatNumber(v.chips)),
        ' × ',
        h('span', { class: 'hl-mult' }, formatNumber(v.mult)),
      ),
      h('td', null, formatNumber(hl.played)),
    );
  });
  return h(
    'table',
    { class: 'run-info__hands', 'data-testid': 'run-info-hands' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col' }, t('game.runInfo.columns.hand')),
        h('th', { scope: 'col' }, t('game.runInfo.columns.level')),
        h('th', { scope: 'col' }, t('game.runInfo.columns.value')),
        h('th', { scope: 'col' }, t('game.runInfo.columns.played')),
      ),
    ),
    h('tbody', null, rows),
  );
}

/**
 * Žolíci v pořadí vyhodnocení: pozice, název, mechanika s aktuálním stavem (počítadla přes `describe`), stav
 * kopírování, edice, nálepky (zbývající kola) a mimo provoz.
 */
function jokerList(ctx: GameCtx): HTMLElement {
  const c = ctx.controller;
  const s = c.state;
  const opts = { registry: ctx.registry, mods: c.engine.modifiers() };
  const title = t('game.runInfo.jokersCount', { n: s.jokers.length, max: c.engine.modifiers().jokerSlots });
  if (s.jokers.length === 0) {
    return h(
      'div',
      { 'data-testid': 'run-info-jokers' },
      h('p', { class: 'run-info__muted' }, title),
      h('p', { class: 'run-info__none' }, t('game.runInfo.none')),
    );
  }
  const roundDebuffs = s.round?.jokerDebuffs ?? [];
  const item = (j: Readonly<JokerInstance>, i: number): HTMLElement => {
    const tx = jokerTexts(j.defId, j as JokerInstance, opts);
    const extras: string[] = [];
    const copy = copyStatusText(s, j, ctx.registry);
    if (copy) extras.push(copy);
    const by = copiedByText(s, j, ctx.registry);
    if (by) extras.push(by);
    if (tx.edition) extras.push(t('art.tooltip.edition', { name: tx.edition.name, desc: tx.edition.desc }));
    extras.push(...tx.stickers);
    if (j.debuffed || roundDebuffs.includes(j.uid)) extras.push(t('art.tooltip.jokerDebuffed'));
    return h(
      'li',
      { 'data-uid': j.uid, 'data-def-id': j.defId },
      richText(t('game.runInfo.jokerItem', { n: i + 1, name: tx.name, desc: tx.desc })),
      extras.map((line) => h('span', { class: 'run-info__sub' }, richText(line))),
    );
  };
  return h(
    'div',
    { 'data-testid': 'run-info-jokers' },
    h('p', { class: 'run-info__muted' }, title),
    h('ol', { class: 'run-info__list run-info__list--jokers', role: 'list' }, s.jokers.map(item)),
  );
}

function countBy<T>(items: readonly T[], key: (x: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function deckSummary(ctx: GameCtx): HTMLElement {
  const deck = ctx.controller.state.deck;
  const suits = countBy(deck, (c) => (isRanklessCard(c, ctx.registry) ? null : c.suit));
  const line = (ns: string, counts: Map<string, number>): string[] =>
    [...counts].map(([id, n]) => t('game.runInfo.modsLine', { name: t(`${ns}.${id}.name`), n }));
  return h(
    'div',
    { class: 'run-info__deck' },
    h('p', { class: 'run-info__deck-total' }, t('game.runInfo.cards', { n: deck.length })),
    h(
      'p',
      { class: 'run-info__suits' },
      SUITS.map((suit) =>
        h(
          'span',
          { class: ['run-info__suit', `suit-${suit}`] },
          t('game.deck.suitCount', { symbol: t(`suits.${suit}.symbol`), n: suits.get(suit) ?? 0 }),
        ),
      ),
    ),
    textList([
      ...line(
        'enhancements',
        countBy(deck, (c) => c.enhancement),
      ),
      ...line(
        'seals',
        countBy(deck, (c) => c.seal),
      ),
      ...line(
        'editions',
        countBy(deck, (c) => c.edition),
      ),
    ]),
  );
}

export function openRunInfo(ctx: GameCtx): void {
  // Bublina s detailem karty pod dialogem by překážela.
  hideTooltip();
  const c = ctx.controller;
  const s = c.state;
  const opts = { registry: ctx.registry, mods: c.engine.modifiers() };
  const stake = Object.values(ctx.registry.stakes).find((x) => x.level === s.stake);
  const stakeRules = Object.values(ctx.registry.stakes)
    .filter((x) => x.level <= s.stake)
    .sort((a, b) => a.level - b.level)
    .map((x) => {
      const tx = stakeTexts(x, opts);
      return t('game.runInfo.item', { name: tx.name, desc: tx.desc });
    });
  const deck = ctx.registry.decks[s.deckId] ? deckTexts(s.deckId, opts) : null;
  const copy = button({
    label: t('game.gameOver.copySeed'),
    variant: 'paper',
    size: 'small',
    testId: 'run-info-copy-seed',
    onClick: () => void copySeed(s.seed),
  });

  openModal({
    title: t('game.runInfo.title'),
    size: 'large',
    className: 'modal--run-info',
    testId: 'run-info-modal',
    body: h(
      'div',
      { class: 'run-info' },
      infoSection(t('game.runInfo.sections.hands'), handsTable(ctx)),
      h(
        'div',
        { class: 'run-info__columns' },
        infoSection(t('game.runInfo.sections.deck'), deckSummary(ctx)),
        infoSection(t('game.runInfo.sections.jokers'), jokerList(ctx)),
        infoSection(t('game.runInfo.sections.boss', { ante: s.ante }), bossSummary(ctx)),
        infoSection(
          t('game.runInfo.sections.tags'),
          textList(
            s.tags.map((tag) => {
              const tx = tagTexts(tag.defId, opts);
              return t('game.runInfo.item', { name: tx.name, desc: tx.desc });
            }),
          ),
        ),
        infoSection(
          t('game.runInfo.sections.vouchers'),
          textList(
            s.vouchers.map((id) => {
              const tx = voucherTexts(id, opts);
              return t('game.runInfo.item', { name: tx.name, desc: tx.desc });
            }),
          ),
        ),
        infoSection(
          t('game.runInfo.sections.stake'),
          stake
            ? h(
                'p',
                { class: 'run-info__stake' },
                t('game.runInfo.stakeLevel', { name: t(`stakes.${stake.id}.name`), level: stake.level }),
              )
            : null,
          textList(stakeRules),
        ),
        infoSection(
          t('game.runInfo.sections.run'),
          deck ? h('p', null, t('game.runInfo.deckName', { name: deck.name })) : null,
          deck ? h('p', { class: 'run-info__muted' }, deck.desc) : null,
          h(
            'p',
            { class: 'run-info__seed' },
            h('span', { 'data-testid': 'run-info-seed' }, t('game.runInfo.seed', { seed: s.seed })),
            ' ',
            copy,
          ),
        ),
      ),
    ),
    actions: [{ label: t('common.close'), variant: 'primary', autofocus: true, testId: 'run-info-close' }],
  });
}

// ─────────────────────────── Náhled balíčku ───────────────────────────

/**
 * Co náhled balíčku ukáže: zbývající karty (dobírací balíček v kole, jinak celý balíček) a karty venku. Karty lícem
 * dolů mimo dobírací balíček (zakrytá ruka pod Výlukou, Mlhou, Bílou paní; zakryté zahozené) jsou neznámé —
 * náhled je nesmí prozradit hodnotou ani místem v řadě barvy. Když nějaké jsou, ukazuje se jen dobírací balíček
 * a počet zakrytých; jinak i ztlumené karty venku. Čistá funkce (testy).
 */
export function deckPreviewModel(s: Readonly<RunState>): {
  remaining: Set<number>;
  /** Karty v řadách náhledu (zbývající, případně i venku). */
  shown: Card[];
  /** Počet zakrytých karet mimo dobírací balíček. */
  hidden: number;
} {
  const round = s.round;
  const inRound = !!round && (s.phase === 'round' || s.phase === 'round_end');
  const remaining = new Set(inRound ? round.drawPile : s.deck.map((x) => x.id));
  const hidden = s.deck.filter((x) => !remaining.has(x.id) && x.faceDown).length;
  const shown = hidden > 0 ? s.deck.filter((x) => remaining.has(x.id)) : [...s.deck];
  return { remaining, shown, hidden };
}

export function openDeckPreview(ctx: GameCtx): void {
  // Bublina s detailem karty pod dialogem by překážela.
  hideTooltip();
  const c = ctx.controller;
  const s = c.state;
  const { remaining, shown, hidden } = deckPreviewModel(s);
  const left = remaining.size;
  const byRank = (a: Card, b: Card): number => b.rank - a.rank;
  // Zbývající karty líc nahoru: složení balíčku hráč zná, rub by v řadě barvy jen mátl.
  const mini = (card: Card): HTMLElement =>
    createCardView(card.faceDown ? { ...card, faceDown: false } : card, {
      registry: ctx.registry,
      className: remaining.has(card.id) ? 'deck-mini' : 'deck-mini is-out',
    });

  const stones = shown.filter((x) => isRanklessCard(x, ctx.registry));
  const suitRow = (suit: Suit): HTMLElement => {
    const cards = shown.filter((x) => x.suit === suit && !isRanklessCard(x, ctx.registry)).sort(byRank);
    const n = cards.filter((x) => remaining.has(x.id)).length;
    return h(
      'div',
      { class: 'deck-preview__row', 'data-suit': suit },
      h(
        'p',
        { class: ['deck-preview__suit', `suit-${suit}`] },
        t('game.deck.suitCount', { symbol: t(`suits.${suit}.symbol`), n }),
      ),
      h('div', { class: 'deck-preview__cards' }, cards.map(mini)),
    );
  };
  const rankCounts = RANKS.slice()
    .reverse()
    .map((rank) => {
      const n = s.deck.filter(
        (x) => x.rank === rank && remaining.has(x.id) && !isRanklessCard(x, ctx.registry),
      ).length;
      return h('li', null, t('game.deck.rankCount', { rank: t(`ranks.${rank}.short`), n }));
    });
  // Zakryté karty mimo balíček: jen počet a rub (bez hodnoty, barvy i pořadí).
  const hiddenRow =
    hidden > 0
      ? h(
          'div',
          {
            class: 'deck-preview__row deck-preview__row--other deck-preview__row--hidden',
            role: 'group',
            'aria-label': t('game.deck.hiddenLabel', { n: hidden }),
            'data-testid': 'deck-hidden',
          },
          h(
            'p',
            { class: 'deck-preview__suit', 'aria-hidden': 'true' },
            t('game.deck.hidden', { n: hidden }),
          ),
          h(
            'div',
            { class: 'deck-preview__cards', 'aria-hidden': 'true' },
            Array.from({ length: hidden }, () => createCardBack({ className: 'deck-mini' })),
          ),
        )
      : null;

  openModal({
    title: t('game.deck.title'),
    size: 'large',
    className: 'modal--deck',
    testId: 'deck-modal',
    description: t('game.deck.remaining', { left, total: s.deck.length }),
    body: h(
      'div',
      { class: 'deck-preview' },
      SUITS.map(suitRow),
      stones.length > 0
        ? h(
            'div',
            { class: 'deck-preview__row deck-preview__row--other' },
            h('p', { class: 'deck-preview__suit' }, t('game.deck.stone')),
            h('div', { class: 'deck-preview__cards' }, stones.map(mini)),
          )
        : null,
      hiddenRow,
      h('p', { class: 'deck-preview__label' }, t('game.deck.byRank')),
      h('ul', { class: 'deck-preview__ranks', role: 'list' }, rankCounts),
      h(
        'p',
        { class: 'deck-preview__legend', 'data-testid': 'deck-legend' },
        hidden > 0 ? t('game.deck.legendHidden') : t('game.deck.legend'),
      ),
    ),
    actions: [{ label: t('common.close'), variant: 'primary', autofocus: true, testId: 'deck-close' }],
  });
}

// ─────────────────────────── Pauza ───────────────────────────

export async function openPauseMenu(ctx: GameCtx): Promise<void> {
  // Bublina s detailem karty pod dialogem by překážela.
  hideTooltip();
  const m = openModal<'resume' | 'settings' | 'menu'>({
    title: t('game.pause.title'),
    description: t('game.pause.hint'),
    size: 'small',
    className: 'modal--pause',
    testId: 'pause-modal',
    actions: [
      {
        label: t('game.pause.resume'),
        value: 'resume',
        variant: 'primary',
        autofocus: true,
        testId: 'pause-resume',
      },
      { label: t('game.pause.settings'), value: 'settings', variant: 'paper', testId: 'pause-settings' },
      { label: t('game.pause.menu'), value: 'menu', variant: 'ghost', testId: 'pause-menu' },
    ],
  });
  const choice = await m.closed;
  if (choice === 'settings') openSettingsModal(ctx.app);
  else if (choice === 'menu') ctx.app.go('menu');
}

// ─────────────────────────── Detail žolíka ───────────────────────────

export function openJokerDetail(ctx: GameCtx, uid: number): void {
  // Bublina s detailem karty pod dialogem by překážela.
  hideTooltip();
  const c = ctx.controller;
  const find = () => c.state.jokers.find((j) => j.uid === uid);
  const joker = find();
  if (!joker) return;
  const opts = { registry: ctx.registry, mods: c.engine.modifiers() };
  const tx = jokerTexts(joker.defId, joker, opts);
  const position = h('p', { class: 'detail__position', 'data-testid': 'joker-position' });
  const eternal = joker.stickers.includes('eternal');
  const sellValue = c.engine.sellValue(uid);
  const copyLine = copyStatusText(c.state, joker, ctx.registry);
  const copiedLine = copiedByText(c.state, joker, ctx.registry);

  const move = async (delta: number): Promise<void> => {
    const list = c.state.jokers.map((j) => j.uid);
    const i = list.indexOf(uid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await ctx.act({ type: 'reorderJokers', uids: list });
    refresh();
  };
  const left = button({
    label: t('game.joker.moveLeft'),
    variant: 'paper',
    size: 'small',
    testId: 'joker-move-left',
    onClick: () => void move(-1),
  });
  const right = button({
    label: t('game.joker.moveRight'),
    variant: 'paper',
    size: 'small',
    testId: 'joker-move-right',
    onClick: () => void move(1),
  });
  const refresh = (): void => {
    const list = c.state.jokers;
    const i = list.findIndex((j) => j.uid === uid);
    position.textContent = t('game.joker.position', { n: i + 1, max: list.length });
    left.disabled = i <= 0;
    right.disabled = i < 0 || i >= list.length - 1;
  };
  refresh();

  const m = openModal<'sell'>({
    title: tx.name,
    size: 'medium',
    className: 'modal--detail',
    testId: 'joker-detail',
    body: h(
      'div',
      { class: 'detail' },
      h(
        'div',
        { class: 'detail__card' },
        createJokerCard(joker, { registry: ctx.registry, tooltip: false, mods: opts.mods }),
      ),
      h(
        'div',
        { class: 'detail__text' },
        h('p', { class: ['detail__kind', `rarity-${tx.rarityId}`] }, tx.rarity),
        h('p', { class: 'detail__desc' }, richText(tx.desc)),
        tx.edition
          ? h('p', { class: 'detail__line' }, richText(`${tx.edition.name}: ${tx.edition.desc}`))
          : null,
        copyLine ? h('p', { class: 'detail__line', 'data-testid': 'joker-copy-status' }, copyLine) : null,
        tx.stickers.map((line) => h('p', { class: 'detail__line detail__line--muted' }, line)),
        copiedLine ? h('p', { class: 'detail__line detail__line--muted' }, copiedLine) : null,
        tx.copyable ? null : h('p', { class: 'detail__line detail__line--muted' }, t('art.copy.notCopyable')),
        tx.flavor ? h('p', { class: 'detail__flavor' }, t('art.tooltip.flavor', { text: tx.flavor })) : null,
        position,
        h('p', { class: 'detail__hint' }, t('game.joker.orderHint')),
        h('div', { class: 'detail__moves' }, left, right),
      ),
    ),
    actions: [
      { label: t('common.close'), variant: 'ghost', testId: 'joker-close' },
      {
        label: eternal ? t('game.joker.cannotSell') : t('game.joker.sell', { price: sellValue }),
        value: 'sell',
        variant: 'danger',
        testId: 'joker-sell',
        onClick: () => (eternal ? false : undefined),
      },
    ],
  });
  if (eternal) {
    const sell = m.dialog.querySelector<HTMLButtonElement>('[data-testid="joker-sell"]');
    if (sell) sell.disabled = true;
  }
  void m.closed.then(async (choice) => {
    if (choice !== 'sell' || !find()) return;
    await ctx.act({ type: 'sellJoker', uid });
  });
}

// ─────────────────────────── Detail spotřebky ───────────────────────────

export function openConsumableDetail(ctx: GameCtx, uid: number): void {
  // Bublina s detailem karty pod dialogem by překážela.
  hideTooltip();
  const c = ctx.controller;
  const item = c.state.consumables.find((x) => x.uid === uid);
  if (!item) return;
  const opts = { registry: ctx.registry, mods: c.engine.modifiers() };
  const tx = consumableTexts(item.defId, opts);
  const def = ctx.registry.consumables[item.defId];
  const targets = c.selectedInHandOrder();
  const canUse = c.engine.canUseConsumable(uid, targets);
  const range = def?.target;
  const targetHint = range
    ? range.min === range.max
      ? t('game.consumable.targetsExact', { n: range.min })
      : t('game.consumable.targetsRange', { min: range.min, max: range.max })
    : t('game.consumable.noTargets');
  const sellValue = c.engine.sellValue(uid);
  // Ruka, ze které jdou vybrat cíle: kolo, nebo dobraná ruka obálky (ve Večerce a výběru útraty žádná není).
  const st = c.state;
  const hasHand =
    (st.phase === 'round' && !!st.round) || (st.phase === 'booster' && (st.booster?.hand.length ?? 0) > 0);
  const warning = canUse
    ? null
    : range && !hasHand
      ? t('game.consumable.needsHand')
      : t('game.consumable.cannotUse');

  const m = openModal<'use' | 'sell'>({
    title: tx.name,
    size: 'medium',
    className: 'modal--detail',
    testId: 'consumable-detail',
    body: h(
      'div',
      { class: 'detail' },
      h(
        'div',
        { class: 'detail__card' },
        createConsumableCard(item, { registry: ctx.registry, tooltip: false, mods: opts.mods }),
      ),
      h(
        'div',
        { class: 'detail__text' },
        h('p', { class: ['detail__kind', `kind-${tx.kindId}`] }, tx.kind),
        h('p', { class: 'detail__desc' }, richText(tx.desc)),
        tx.flavor ? h('p', { class: 'detail__flavor' }, t('art.tooltip.flavor', { text: tx.flavor })) : null,
        h('p', { class: 'detail__hint' }, targetHint),
        range
          ? h('p', { class: 'detail__hint' }, t('game.consumable.selected', { n: targets.length }))
          : null,
        warning ? h('p', { class: 'detail__warning', 'data-testid': 'consumable-warning' }, warning) : null,
      ),
    ),
    actions: [
      {
        label: t('game.consumable.sell', { price: sellValue }),
        value: 'sell',
        variant: 'danger',
        testId: 'consumable-sell',
      },
      {
        label: t('game.consumable.use'),
        value: 'use',
        variant: 'primary',
        testId: 'consumable-use',
        autofocus: canUse,
        onClick: () => (canUse ? undefined : false),
      },
    ],
  });
  const useBtn = m.dialog.querySelector<HTMLButtonElement>('[data-testid="consumable-use"]');
  if (useBtn) useBtn.disabled = !canUse;
  void m.closed.then(async (choice) => {
    if (choice === 'sell') await ctx.act({ type: 'sellConsumable', uid });
    else if (choice === 'use') {
      if (await ctx.act({ type: 'useConsumable', uid, targetIds: targets })) c.clearSelection();
    }
  });
}
