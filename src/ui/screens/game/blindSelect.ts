/**
 * Výběr útraty (DESIGN 13.1): tři karty Malá / Velká / Šéf s cílem a odměnou (stejná čísla jako kolo —
 * `engine.blindTarget` / `engine.blindReward`), u Malé a Velké štítek za přeskočení s popisem a Přeskočit,
 * u šéfa jeho pravidlo (žeton s tooltipem včetně hlášky příchodu), na Imperialu i u Velké útraty. Šéfové a štítky
 * v registru nemusí být — prázdné id se ošetří.
 */
import type { BlindSlot } from '../../../engine';
import { t } from '../../../i18n/cs';
import { formatNumber } from '../../../i18n/format';
import { blindArt } from '../../art/art';
import { button } from '../../components/button';
import { createContentCard } from '../../components/consumableCard';
import { attachTooltip, contentTooltip } from '../../components/tooltip';
import { blindName, bossTexts, tagTexts } from '../../describe';
import { h } from '../../dom';
import type { GameCtx } from './shared';

/** Podpis stavu, při jehož změně se panel překreslí. */
export function blindSelectKey(ctx: GameCtx): string {
  const s = ctx.controller.state;
  return `${s.ante}|${s.blindIndex}|${JSON.stringify(s.blinds)}|${String(s.flags.bossRerolls ?? '')}|${s.money}`;
}

function bossRule(ctx: GameCtx, slot: BlindSlot): string | null {
  const id = slot.bossId;
  if (!id || !ctx.registry.bosses[id]) return slot.kind === 'boss' ? t('game.blinds.bossNoRule') : null;
  const rule = bossTexts(id, { registry: ctx.registry }).rule;
  return slot.kind === 'boss' ? rule : t('game.blinds.extraRule', { rule });
}

function tagBlock(ctx: GameCtx, slot: BlindSlot): HTMLElement | null {
  if (slot.kind === 'boss') return null;
  const id = slot.skipTagId;
  if (!id || !ctx.registry.tags[id]) {
    return h(
      'div',
      { class: 'blind-card__tag blind-card__tag--none' },
      h('p', null, t('game.blinds.skipNoTag')),
    );
  }
  const tx = tagTexts(id, { registry: ctx.registry });
  return h(
    'div',
    { class: 'blind-card__tag' },
    createContentCard('tag', id, { registry: ctx.registry, className: 'blind-card__tag-art' }),
    h(
      'div',
      { class: 'blind-card__tag-text' },
      h('p', { class: 'blind-card__tag-name' }, t('game.blinds.skipTag', { tag: tx.name })),
      h('p', { class: 'blind-card__tag-desc' }, tx.desc),
    ),
  );
}

export function renderBlindSelect(ctx: GameCtx): HTMLElement {
  const c = ctx.controller;
  const s = c.state;
  const rerolls = typeof s.flags.bossRerolls === 'number' ? s.flags.bossRerolls : 0;
  const canRerollBoss = rerolls > 0 || s.flags.bossRerollUnlimited === true;

  const cards = s.blinds.map((slot, i) => {
    const known = slot.bossId && ctx.registry.bosses[slot.bossId] ? slot.bossId : null;
    const name = blindName(slot.kind, slot.kind === 'boss' ? known : null);
    const target = c.engine.blindTarget(slot.kind, slot.bossId);
    const reward = c.engine.blindReward(slot.kind, slot.bossId);
    const current = i === s.blindIndex && slot.status === 'current';
    const rule = bossRule(ctx, slot);
    const titleId = `blind-card-${slot.kind}`;
    const rewardText = reward > 0 ? t('game.blinds.rewardValue', { n: reward }) : t('game.blinds.noReward');
    // Cíl šéfa upravený štítkem (Šéf má chřipku: −25 %) — ať je jasné, proč je cíl nižší.
    const bossMult =
      slot.kind === 'boss' && slot.status !== 'defeated' ? c.engine.modifiers().bossTargetMult : 1;
    const targetNote =
      bossMult !== 1
        ? h(
            'p',
            { class: 'blind-card__note', 'data-testid': 'blind-boss-target-note' },
            t(bossMult < 1 ? 'game.blinds.bossWeakened' : 'game.blinds.bossStrengthened', {
              pct: Math.round(Math.abs(1 - bossMult) * 100),
            }),
          )
        : null;
    const actions: HTMLElement[] = [];
    if (current) {
      actions.push(
        button({
          label: t('game.blinds.select'),
          ariaLabel: t('game.blinds.selectLabel', { name }),
          variant: 'primary',
          testId: `blind-select-${slot.kind}`,
          className: 'blind-card__select',
          autofocus: true,
          onClick: () => void ctx.act({ type: 'selectBlind' }),
        }),
      );
      if (slot.kind !== 'boss') {
        actions.push(
          button({
            label: t('game.blinds.skip'),
            variant: 'ghost',
            size: 'small',
            testId: `blind-skip-${slot.kind}`,
            className: 'blind-card__skip',
            onClick: () => void ctx.act({ type: 'skipBlind' }),
          }),
        );
      }
    }
    if (slot.kind === 'boss' && canRerollBoss && (slot.status === 'current' || slot.status === 'upcoming')) {
      actions.push(
        button({
          label: t('game.blinds.rerollBoss'),
          variant: 'paper',
          size: 'small',
          testId: 'blind-reroll-boss',
          onClick: () => void ctx.act({ type: 'rerollBoss' }),
        }),
      );
    }
    for (const b of actions) b.dataset.focusKey = `blind-${b.dataset.testid ?? ''}`;
    const token = h(
      'div',
      { class: 'blind-card__token', 'aria-hidden': 'true' },
      blindArt(slot.kind, known, { registry: ctx.registry }),
    );
    // Žeton šéfa: tooltip s pravidlem a hláškou příchodu (hover, dlouhý stisk) — text je i na kartě.
    if (known) attachTooltip(token, () => contentTooltip('boss', known, { registry: ctx.registry }));
    return h(
      'article',
      {
        class: ['blind-card', `blind-card--${slot.kind}`, `is-${slot.status}`],
        'aria-labelledby': titleId,
        'data-testid': `blind-${slot.kind}`,
        'data-status': slot.status,
      },
      h('p', { class: 'blind-card__status' }, t(`game.blinds.status.${slot.status}`)),
      token,
      h('h3', { class: 'blind-card__name', id: titleId }, name),
      rule ? h('p', { class: 'blind-card__rule' }, rule) : null,
      h(
        'dl',
        { class: 'blind-card__facts' },
        h(
          'div',
          { class: 'blind-card__fact' },
          h('dt', null, t('game.blinds.target')),
          h('dd', { class: 'blind-card__target' }, formatNumber(target)),
        ),
        h(
          'div',
          { class: 'blind-card__fact' },
          h('dt', null, t('game.blinds.reward')),
          h('dd', { class: 'blind-card__reward' }, rewardText),
        ),
      ),
      targetNote,
      tagBlock(ctx, slot),
      actions.length > 0 ? h('div', { class: 'blind-card__actions' }, actions) : null,
    );
  });

  return h(
    'section',
    {
      class: 'game-panel blind-select',
      'aria-labelledby': 'blind-select-title',
      'data-testid': 'blind-select',
    },
    h(
      'header',
      { class: 'game-panel__header' },
      h('h2', { class: 'game-panel__title', id: 'blind-select-title' }, t('game.blinds.title')),
      h('p', { class: 'game-panel__subtitle' }, t('game.blinds.subtitle')),
    ),
    h('div', { class: 'blind-select__cards' }, cards),
  );
}
