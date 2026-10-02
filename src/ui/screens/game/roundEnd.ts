/**
 * Konec kola (DESIGN 13.1, 2.4.2): rozpis odměn po řádcích (útrata, nevyužité ruce a zahození, úrok, bonusy
 * a poplatky) s postupnou animací (CSS, rychlost podle `--speed`) → **Vyplatit** (`cashOut`).
 */
import type { RoundRewards } from '../../../engine';
import { hasKey, t } from '../../../i18n/cs';
import { button } from '../../components/button';
import { h } from '../../dom';
import type { GameCtx } from './shared';

export function roundEndKey(ctx: GameCtx): string {
  const s = ctx.controller.state;
  return `${s.ante}|${s.blindIndex}|${s.stats.roundsWon}|${JSON.stringify(s.rewards)}`;
}

/** Název položky „bonusy a poplatky“ podle zdroje (`held`, `joker:<id>`, `deck:<id>`, `tag:<id>`, `rental:<id>`…). */
export function rewardSourceLabel(source: string): string {
  const [kind = '', id = ''] = source.split(':');
  const jokerName = (): string => (hasKey(`jokers.${id}.name`) ? t(`jokers.${id}.name`) : id);
  switch (kind) {
    case 'held':
      return t('game.roundEnd.held');
    case 'joker':
      return jokerName();
    case 'deck':
      return hasKey(`decks.${id}.name`) ? t(`decks.${id}.name`) : t('game.roundEnd.other');
    case 'rental':
      return t('game.roundEnd.rental', { name: jokerName() });
    case 'rentalReturned':
      return t('game.roundEnd.rentalReturned', { name: jokerName() });
    case 'tag':
      return hasKey(`tags.${id}.name`)
        ? t('game.roundEnd.tag', { name: t(`tags.${id}.name`) })
        : t('game.roundEnd.other');
    default:
      return t('game.roundEnd.other');
  }
}

/** Řádky rozpisu: [popisek, částka]; nulové položky kromě odměny za útratu vynechá. */
export function rewardLines(r: RoundRewards, handsLeft: number, discardsLeft: number): [string, number][] {
  const lines: [string, number][] = [[t('game.roundEnd.blind'), r.blindReward]];
  if (r.unusedHands) lines.push([t('game.roundEnd.hands', { n: handsLeft }), r.unusedHands]);
  if (r.unusedDiscards) lines.push([t('game.roundEnd.discards', { n: discardsLeft }), r.unusedDiscards]);
  if (r.interest) lines.push([t('game.roundEnd.interest'), r.interest]);
  for (const e of r.extra) lines.push([rewardSourceLabel(e.source), e.amount]);
  return lines;
}

export function renderRoundEnd(ctx: GameCtx): HTMLElement {
  const s = ctx.controller.state;
  const r = s.rewards;
  const round = s.round;
  const lines = r ? rewardLines(r, round?.handsLeft ?? 0, round?.discardsLeft ?? 0) : [];
  const total = r?.total ?? 0;
  const amount = (n: number): string => t('game.roundEnd.amount', { n });
  return h(
    'section',
    { class: 'game-panel round-end paper', 'aria-labelledby': 'round-end-title', 'data-testid': 'round-end' },
    h(
      'header',
      { class: 'game-panel__header' },
      h('h2', { class: 'game-panel__title', id: 'round-end-title' }, t('game.roundEnd.title')),
      round
        ? h(
            'p',
            { class: 'game-panel__subtitle' },
            t('game.roundEnd.score', { score: round.score, target: round.target }),
          )
        : null,
    ),
    h(
      'ul',
      { class: 'round-end__lines', role: 'list' },
      lines.map(([label, n], i) =>
        h(
          'li',
          { class: ['round-end__line', n < 0 ? 'is-negative' : ''], style: { '--i': i } },
          h('span', { class: 'round-end__label' }, label),
          h('span', { class: 'round-end__dots', 'aria-hidden': 'true' }),
          h('span', { class: 'round-end__amount' }, amount(n)),
        ),
      ),
      h(
        'li',
        { class: 'round-end__line round-end__line--total', style: { '--i': lines.length } },
        h('span', { class: 'round-end__label' }, t('game.roundEnd.total')),
        h('span', { class: 'round-end__dots', 'aria-hidden': 'true' }),
        h('span', { class: 'round-end__amount', 'data-testid': 'reward-total' }, amount(total)),
      ),
    ),
    h(
      'div',
      { class: 'game-panel__actions', style: { '--i': lines.length + 1 } },
      button({
        label: t('game.roundEnd.cashOut', { n: total }),
        title: t('game.roundEnd.cashOutLabel'),
        variant: 'primary',
        size: 'large',
        testId: 'cash-out',
        autofocus: true,
        onClick: () => void ctx.act({ type: 'cashOut' }),
      }),
    ),
  );
}
