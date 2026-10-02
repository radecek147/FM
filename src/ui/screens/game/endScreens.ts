/**
 * Konec runu: **pitva** (příčina — útrata nebo šéf + hláška `bosses.<id>.death`, statistiky, seed ke
 * zkopírování, Nová hra / Menu) a **výhra** (titulky se statistikou runu → Konec / Nekonečný režim).
 * Uložený run maže controller při `game_over` sám; Konec po výhře ho smaže taky (run je dohraný).
 */
import type { RunState } from '../../../engine';
import { hasKey, t } from '../../../i18n/cs';
import { formatMoney, formatNumber } from '../../../i18n/format';
import { blindArt } from '../../art/art';
import { iconElement } from '../../art/icons';
import { button } from '../../components/button';
import { GameController } from '../../controller';
import { blindName, bossTexts } from '../../describe';
import { h } from '../../dom';
import type { GameCtx } from './shared';
import { copySeed, statRow } from './shared';

/** Hláška pitvy podle příčiny: šéf (`bosses.<id>.death`), jinak Malá / Velká útrata. */
export function deathQuote(cause: string): string {
  if (cause === 'small' || cause === 'big') return t(`game.death.${cause}`);
  const key = `bosses.${cause}.death`;
  if (!hasKey(key)) return t('game.death.boss');
  const text = t(key);
  return text.startsWith('„') ? text : t('game.gameOver.quote', { text });
}

/** Statistiky runu (pitva i výhra). */
export function runStats(s: Readonly<RunState>): HTMLElement {
  const st = s.stats;
  const best =
    st.bestHandType !== null
      ? t('game.gameOver.bestHandValue', {
          score: st.bestHandScore,
          hand: t(`hands.${st.bestHandType}.name`),
        })
      : t('game.gameOver.none');
  return h(
    'dl',
    { class: 'game-stats', 'data-testid': 'run-stats' },
    statRow(t('game.gameOver.ante'), formatNumber(s.ante)),
    statRow(t('game.gameOver.rounds'), formatNumber(st.roundsWon)),
    statRow(t('game.gameOver.bestHand'), best, 'best-hand'),
    statRow(t('game.gameOver.handsPlayed'), formatNumber(st.handsPlayed)),
    statRow(t('game.gameOver.discardsUsed'), formatNumber(st.discardsUsed)),
    statRow(t('game.gameOver.cardsPlayed'), formatNumber(st.cardsPlayed)),
    statRow(t('game.gameOver.moneyEarned'), formatMoney(st.moneyEarned)),
    statRow(t('game.gameOver.moneySpent'), formatMoney(st.moneySpent)),
    statRow(t('game.gameOver.jokersBought'), formatNumber(st.jokersBought)),
    statRow(t('game.gameOver.bosses'), formatNumber(st.bossesDefeated)),
  );
}

function seedBlock(seed: string): HTMLElement {
  const copy = button({
    label: t('game.gameOver.copySeed'),
    variant: 'paper',
    size: 'small',
    testId: 'copy-seed',
    onClick: () => void copySeed(seed),
  });
  return h(
    'div',
    { class: 'game-seed' },
    h('span', { class: 'game-seed__label' }, t('game.gameOver.seed')),
    h('code', { class: 'game-seed__value', 'data-testid': 'run-seed' }, seed),
    copy,
  );
}

function runMeta(ctx: GameCtx): HTMLElement {
  const s = ctx.controller.state;
  const stake = Object.values(ctx.registry.stakes).find((x) => x.level === s.stake);
  return h(
    'dl',
    { class: 'game-stats game-stats--meta' },
    statRow(
      t('game.gameOver.deck'),
      hasKey(`decks.${s.deckId}.name`) ? t(`decks.${s.deckId}.name`) : s.deckId,
    ),
    statRow(t('game.gameOver.stake'), stake ? t(`stakes.${stake.id}.name`) : formatNumber(s.stake)),
  );
}

/**
 * Hláška pitvy; když run skončil na šéfovi, s jeho žetonem a pravidlem („Kontrola z finančáku: Každá zahraná
 * ruka stojí 1 Kč.“), ať je jasné, kdo za to může.
 */
function deathBlock(ctx: GameCtx, cause: string): HTMLElement {
  const quote = h(
    'blockquote',
    { class: 'game-over__quote', 'data-testid': 'death-quote' },
    deathQuote(cause),
  );
  if (!ctx.registry.bosses[cause]) return quote;
  const tx = bossTexts(cause, { registry: ctx.registry });
  return h(
    'div',
    { class: 'game-over__culprit', 'data-testid': 'death-boss', 'data-boss-id': cause },
    h(
      'div',
      { class: 'game-over__token', 'aria-hidden': 'true' },
      blindArt('boss', cause, { registry: ctx.registry }),
    ),
    h(
      'div',
      { class: 'game-over__culprit-text' },
      quote,
      h('p', { class: 'game-over__rule' }, t('game.gameOver.bossRule', { name: tx.name, rule: tx.rule })),
    ),
  );
}

export function renderGameOver(ctx: GameCtx): HTMLElement {
  const s = ctx.controller.state;
  const info = s.gameOver;
  const blind = info
    ? blindName(info.blind, info.blind === 'boss' && info.cause in ctx.registry.bosses ? info.cause : null)
    : '';
  return h(
    'section',
    { class: 'game-panel game-over paper', 'aria-labelledby': 'game-over-title', 'data-testid': 'game-over' },
    h(
      'header',
      { class: 'game-panel__header' },
      iconElement('death-skull', { className: 'game-panel__icon' }),
      h('h2', { class: 'game-panel__title', id: 'game-over-title' }, t('game.gameOver.title')),
      info
        ? h('p', { class: 'game-panel__subtitle' }, t('game.gameOver.subtitle', { ante: info.ante, blind }))
        : null,
    ),
    info ? deathBlock(ctx, info.cause) : null,
    info
      ? h(
          'p',
          { class: 'game-over__score' },
          t('game.gameOver.score', { score: info.score, target: info.target }),
        )
      : null,
    h('h3', { class: 'game-over__stats-title' }, t('game.gameOver.stats')),
    runStats(s),
    runMeta(ctx),
    seedBlock(s.seed),
    h(
      'div',
      { class: 'game-panel__actions' },
      button({
        label: t('game.gameOver.newGame'),
        variant: 'primary',
        testId: 'game-over-new',
        autofocus: true,
        onClick: () => {
          ctx.app.controller = null;
          ctx.app.go('newGame');
        },
      }),
      button({
        label: t('game.gameOver.menu'),
        variant: 'paper',
        testId: 'game-over-menu',
        onClick: () => {
          ctx.app.controller = null;
          ctx.app.go('menu');
        },
      }),
    ),
  );
}

export function renderVictory(ctx: GameCtx): HTMLElement {
  const s = ctx.controller.state;
  const stake = Object.values(ctx.registry.stakes).find((x) => x.level === s.stake);
  const deckName = hasKey(`decks.${s.deckId}.name`) ? t(`decks.${s.deckId}.name`) : s.deckId;
  const lines = [
    t('game.victory.starring', { deck: deckName }),
    t('game.victory.stake', { stake: stake ? t(`stakes.${stake.id}.name`) : formatNumber(s.stake) }),
  ];
  return h(
    'section',
    { class: 'game-panel victory paper', 'aria-labelledby': 'victory-title', 'data-testid': 'victory' },
    h(
      'header',
      { class: 'game-panel__header' },
      iconElement('trophy', { className: 'game-panel__icon' }),
      h('h2', { class: 'game-panel__title victory__title', id: 'victory-title' }, t('game.victory.title')),
      h('p', { class: 'game-panel__subtitle' }, t('game.victory.subtitle')),
    ),
    h(
      'div',
      { class: 'victory__credits', 'aria-label': t('game.victory.creditsLabel') },
      lines.map((line, i) => h('p', { class: 'victory__line', style: { '--i': i } }, line)),
      h('div', { class: 'victory__stats', style: { '--i': lines.length } }, runStats(s)),
    ),
    seedBlock(s.seed),
    h(
      'div',
      { class: 'game-panel__actions' },
      button({
        label: t('game.victory.end'),
        title: t('game.victory.endLabel'),
        variant: 'paper',
        testId: 'victory-end',
        onClick: () => {
          // Výhra je v profilu od `victory`; teď run uzavřít (historie) a smazat uložení.
          ctx.app.profiles.finish(ctx.controller);
          GameController.clearSaved(ctx.app.store);
          ctx.app.controller = null;
          ctx.app.go('menu');
        },
      }),
      button({
        label: t('game.victory.endless'),
        title: t('game.victory.endlessHint'),
        variant: 'primary',
        testId: 'victory-endless',
        autofocus: true,
        onClick: () => void ctx.act({ type: 'continueEndless' }),
      }),
    ),
    h('p', { class: 'victory__hint' }, t('game.victory.endlessHint')),
  );
}
