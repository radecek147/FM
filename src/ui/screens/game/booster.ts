/**
 * Výběr z obálky (DESIGN 13.1, 2.9): N možností, „Vyber {n}“, Přeskočit. Žolík jde do slotu, hrací karta
 * do balíčku, spotřebka se buď hned použije (cíle = vybrané karty v dobrané ruce dole), nebo se nechá
 * do slotu (`keep`). Obecně přes registr — druh obálky ani obsah nejsou natvrdo.
 */
import type { BoosterOption } from '../../../engine';
import { t } from '../../../i18n/cs';
import { button } from '../../components/button';
import { createCardView } from '../../components/card';
import { createConsumableCard } from '../../components/consumableCard';
import { createJokerCard } from '../../components/jokerCard';
import { boosterTexts, capitalize, cardName } from '../../describe';
import { h } from '../../dom';
import type { GameCtx } from './shared';
import { hasConsumableRoom, hasJokerRoom } from './shared';

export function boosterKey(ctx: GameCtx): string {
  const c = ctx.controller;
  const s = c.state;
  return `${JSON.stringify(s.booster)}|${c.selected.join(',')}|${s.jokers.length}|${s.consumables.length}`;
}

function optionName(ctx: GameCtx, opt: BoosterOption): string {
  if (opt.kind === 'joker') return t(`jokers.${opt.joker.defId}.name`);
  if (opt.kind === 'consumable') return t(`consumables.${opt.consumable.defId}.name`);
  return capitalize(cardName(opt.card, ctx.registry));
}

function optionVisual(ctx: GameCtx, opt: BoosterOption): HTMLElement {
  const mods = ctx.controller.engine.modifiers();
  if (opt.kind === 'joker') return createJokerCard(opt.joker, { registry: ctx.registry, mods });
  if (opt.kind === 'consumable')
    return createConsumableCard(opt.consumable, { registry: ctx.registry, mods });
  return createCardView(opt.card, { registry: ctx.registry, mods });
}

function actionButton(
  label: string,
  testId: string,
  disabledReason: string | null,
  onClick: () => void,
  variant: 'primary' | 'paper' = 'primary',
): HTMLButtonElement {
  const b = button({
    label,
    variant,
    size: 'small',
    testId,
    disabled: disabledReason !== null,
    title: disabledReason ?? undefined,
    onClick,
  });
  b.dataset.focusKey = testId;
  return b;
}

export function renderBooster(ctx: GameCtx): HTMLElement {
  const c = ctx.controller;
  const s = c.state;
  const b = s.booster;
  // Obálka, kterou registr nezná (obsah odebraný od uložení), dostane obecný název.
  const name =
    b && ctx.registry.boosters[b.boosterId]
      ? boosterTexts(b.boosterId, { registry: ctx.registry }).name
      : t('art.kind.booster');
  const targets = c.selectedInHandOrder();

  const options = (b?.options ?? []).map((opt, index) => {
    const actions: HTMLButtonElement[] = [];
    if (opt.kind === 'joker') {
      actions.push(
        actionButton(
          t('game.booster.take'),
          `booster-take-${index}`,
          hasJokerRoom(ctx, opt.joker.edition) ? null : t('game.booster.noRoom'),
          () => void ctx.act({ type: 'pickBooster', index }),
        ),
      );
    } else if (opt.kind === 'card') {
      actions.push(
        actionButton(
          t('game.booster.addCard'),
          `booster-take-${index}`,
          null,
          () => void ctx.act({ type: 'pickBooster', index }),
        ),
      );
    } else {
      const def = ctx.registry.consumables[opt.consumable.defId];
      const range = def?.target;
      const targetsOk = range
        ? targets.length >= range.min && targets.length <= range.max
        : targets.length === 0;
      const hint = range
        ? range.min === range.max
          ? t('game.consumable.targetsExact', { n: range.min })
          : t('game.consumable.targetsRange', { min: range.min, max: range.max })
        : t('game.consumable.noTargets');
      actions.push(
        actionButton(
          t('game.booster.use'),
          `booster-use-${index}`,
          targetsOk ? null : hint,
          () =>
            void (async () => {
              if (await ctx.act({ type: 'pickBooster', index, targetIds: targets })) c.clearSelection();
            })(),
        ),
        actionButton(
          t('game.booster.keep'),
          `booster-keep-${index}`,
          hasConsumableRoom(ctx, opt.consumable.edition) ? null : t('game.booster.noRoom'),
          () => void ctx.act({ type: 'pickBooster', index, keep: true }),
          'paper',
        ),
      );
    }
    return h(
      'li',
      { class: ['booster-option', `booster-option--${opt.kind}`], 'data-testid': `booster-option-${index}` },
      h('div', { class: 'booster-option__card' }, optionVisual(ctx, opt)),
      h('p', { class: 'booster-option__name' }, optionName(ctx, opt)),
      h('div', { class: 'booster-option__actions' }, actions),
    );
  });

  const skip = button({
    label: t('game.booster.skip'),
    title: t('game.booster.skipLabel'),
    variant: 'ghost',
    testId: 'booster-skip',
    autofocus: true,
    onClick: () => void ctx.act({ type: 'skipBooster' }),
  });
  skip.dataset.focusKey = 'booster-skip';

  return h(
    'section',
    { class: 'game-panel booster', 'aria-labelledby': 'booster-title', 'data-testid': 'booster' },
    h(
      'header',
      { class: 'game-panel__header' },
      h('h2', { class: 'game-panel__title', id: 'booster-title' }, name),
      h(
        'p',
        { class: 'game-panel__subtitle booster__picks', 'data-testid': 'booster-picks' },
        t('game.booster.pick', { n: b?.picksLeft ?? 0 }),
      ),
    ),
    h('ul', { class: 'booster__options', role: 'list' }, options),
    h('div', { class: 'game-panel__actions' }, skip),
  );
}
