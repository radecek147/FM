/**
 * Levý panel herní obrazovky (DESIGN 13.2): útrata / šéf a jeho pravidlo, „Dosáhni aspoň“, skóre kola,
 * kombinace s úrovní a živým náhledem čipy × mult, Ruce, Zahození, peníze, Patro, Kolo a tlačítka
 * Info o runu / Nastavení / Menu.
 *
 * Kostra se postaví jednou, `update()` jen přepisuje texty (levné — volá se po každé změně výběru).
 * Presenter si během skórování převezme kombinaci a počítadla (`showScoring`, `setChipsMult`…).
 */
import type { BlindKind, HandType } from '../../../engine';
import { FINAL_ANTE } from '../../../engine';
import { t } from '../../../i18n/cs';
import { formatMoney, formatNumber } from '../../../i18n/format';
import { blindArt } from '../../art/art';
import { button } from '../../components/button';
import { blindName, bossTexts } from '../../describe';
import { h } from '../../dom';
import { openSettingsModal } from '../settings';
import type { GameCtx } from './shared';
import { roundNumber } from './shared';

export interface Sidebar {
  el: HTMLElement;
  update(): void;
  handInfoEl: HTMLElement;
  moneyEl: HTMLElement;
  roundScoreEl: HTMLElement;
  showScoring(s: { hand: HandType; level: number; chips: number; mult: number } | null): void;
  setChipsMult(chips: number, mult: number): void;
  setRoundScore(n: number): void;
  setMoney(n: number): void;
}

export interface SidebarActions {
  openRunInfo(): void;
  openPause(): void;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function createSidebar(ctx: GameCtx, actions: SidebarActions): Sidebar {
  const c = ctx.controller;

  const token = h('div', { class: 'gs-blind__token', 'aria-hidden': 'true' });
  const blindNameEl = h('h2', { class: 'gs-blind__name', 'data-testid': 'blind-name' });
  const blindRule = h('p', { class: 'gs-blind__rule', 'data-testid': 'blind-rule' });
  const blindBox = h(
    'section',
    { class: 'gs-blind', 'aria-live': 'polite' },
    token,
    h('div', { class: 'gs-blind__text' }, blindNameEl, blindRule),
  );

  const targetValue = h('p', { class: 'gs-target__value', 'data-testid': 'round-target' });
  const targetReward = h('p', { class: 'gs-target__reward' });
  const targetBox = h(
    'section',
    { class: 'gs-box gs-target' },
    h('p', { class: 'gs-label' }, t('game.sidebar.target')),
    targetValue,
    targetReward,
  );

  const roundScoreEl = h('p', { class: 'gs-score__value', 'data-testid': 'round-score' }, '0');
  const scoreBox = h(
    'section',
    { class: 'gs-box gs-score' },
    h('p', { class: 'gs-label' }, t('game.sidebar.roundScore')),
    roundScoreEl,
  );

  const handName = h('span', { class: 'gs-hand__name', 'data-testid': 'hand-name' });
  const handLevel = h('span', { class: 'gs-hand__level', 'data-testid': 'hand-level' });
  const chipsEl = h('span', { class: 'gs-hand__chips', 'data-testid': 'hand-chips' }, '0');
  const multEl = h('span', { class: 'gs-hand__mult', 'data-testid': 'hand-mult' }, '0');
  const handInfoEl = h(
    'section',
    { class: 'gs-box gs-hand', 'aria-label': t('game.sidebar.hand') },
    h('p', { class: 'gs-hand__head' }, handName, handLevel),
    h(
      'p',
      { class: 'gs-hand__calc' },
      h('span', { class: 'visually-hidden' }, t('game.sidebar.chips')),
      chipsEl,
      h('span', { class: 'gs-hand__times', 'aria-hidden': 'true' }, t('game.sidebar.times')),
      h('span', { class: 'visually-hidden' }, t('game.sidebar.mult')),
      multEl,
    ),
  );

  const handsEl = h('dd', { class: 'gs-stat__value gs-stat__value--hands', 'data-testid': 'hands-left' });
  const discardsEl = h('dd', {
    class: 'gs-stat__value gs-stat__value--discards',
    'data-testid': 'discards-left',
  });
  const moneyEl = h('dd', { class: 'gs-stat__value gs-stat__value--money', 'data-testid': 'money' });
  const anteEl = h('dd', { class: 'gs-stat__value', 'data-testid': 'ante' });
  const anteNote = h('span', { class: 'gs-stat__note' });
  const roundEl = h('dd', { class: 'gs-stat__value', 'data-testid': 'round-number' });
  const stat = (label: string, value: HTMLElement, cls = ''): HTMLElement =>
    h('div', { class: ['gs-stat', cls] }, h('dt', { class: 'gs-stat__label' }, label), value);
  const stats = h(
    'dl',
    { class: 'gs-stats' },
    stat(t('game.sidebar.hands'), handsEl),
    stat(t('game.sidebar.discards'), discardsEl),
    stat(t('game.sidebar.money'), moneyEl, 'gs-stat--wide'),
    h(
      'div',
      { class: 'gs-stat' },
      h('dt', { class: 'gs-stat__label' }, t('game.sidebar.ante'), anteNote),
      anteEl,
    ),
    stat(t('game.sidebar.round'), roundEl),
  );

  const buttons = h(
    'div',
    { class: 'gs-buttons' },
    button({
      label: t('game.sidebar.runInfo'),
      variant: 'paper',
      size: 'small',
      testId: 'run-info',
      onClick: () => actions.openRunInfo(),
    }),
    button({
      label: t('game.sidebar.settings'),
      variant: 'paper',
      size: 'small',
      testId: 'game-settings',
      onClick: () => void openSettingsModal(ctx.app),
    }),
    button({
      label: t('game.sidebar.menu'),
      ariaLabel: t('game.sidebar.menuLabel'),
      variant: 'ghost',
      size: 'small',
      testId: 'game-menu',
      onClick: () => actions.openPause(),
    }),
  );

  const el = h(
    'aside',
    { class: 'game-sidebar', 'aria-label': t('game.sidebar.label') },
    blindBox,
    targetBox,
    scoreBox,
    handInfoEl,
    stats,
    buttons,
  );

  let scoring: { hand: HandType; level: number; chips: number; mult: number } | null = null;
  let tokenKey = '';

  const writeHand = (name: string, level: string, chips: string, mult: string): void => {
    setText(handName, name);
    setText(handLevel, level);
    setText(chipsEl, chips);
    setText(multEl, mult);
  };

  const updateHand = (): void => {
    if (scoring) {
      writeHand(
        t(`hands.${scoring.hand}.name`),
        t('game.sidebar.level', { level: scoring.level }),
        formatNumber(scoring.chips),
        formatNumber(scoring.mult),
      );
      handInfoEl.classList.add('is-scoring');
      return;
    }
    handInfoEl.classList.remove('is-scoring');
    const s = c.state;
    const selecting = (s.phase === 'round' || s.phase === 'booster') && c.selected.length > 0;
    if (!selecting) {
      writeHand(t('game.sidebar.handNone'), '', '0', '0');
      return;
    }
    const p = c.preview();
    if (p.hidden) {
      writeHand(t('game.sidebar.handHidden'), '', t('game.sidebar.unknown'), t('game.sidebar.unknown'));
    } else if (!p.hand) {
      writeHand(t('game.sidebar.handNothing'), '', '0', '0');
    } else {
      writeHand(
        t(`hands.${p.hand.type}.name`),
        t('game.sidebar.level', { level: p.level }),
        formatNumber(p.chips),
        formatNumber(p.mult),
      );
    }
  };

  const updateBlind = (): void => {
    const s = c.state;
    const round = s.round;
    const slot = s.blinds[s.blindIndex] ?? null;
    let kind: BlindKind = slot?.kind ?? 'small';
    let bossId: string | null = slot?.bossId ?? null;
    let name: string;
    let rule = '';
    if (round && (s.phase === 'round' || s.phase === 'round_end' || s.phase === 'game_over')) {
      kind = round.blind;
      bossId = round.bossId;
      name = blindName(kind, bossId && ctx.registry.bosses[bossId] ? bossId : null);
      if (bossId && ctx.registry.bosses[bossId]) {
        rule = round.bossDisabled
          ? t('game.sidebar.bossDisabled')
          : bossTexts(bossId, { registry: ctx.registry }).rule;
      } else if (kind === 'boss') {
        rule = t('game.sidebar.noRule');
      }
    } else {
      name = t(`game.sidebar.phase.${s.phase}`);
      const boss = s.blinds.find((b) => b.kind === 'boss');
      if (boss?.bossId && ctx.registry.bosses[boss.bossId] && s.phase !== 'victory')
        rule = t('game.sidebar.nextBoss', { name: blindName('boss', boss.bossId) });
    }
    setText(blindNameEl, name);
    setText(blindRule, rule);
    blindRule.hidden = rule === '';
    blindBox.dataset.blind = kind;
    const key = `${kind}|${bossId ?? ''}`;
    if (key !== tokenKey) {
      tokenKey = key;
      token.replaceChildren(
        blindArt(kind, bossId && ctx.registry.bosses[bossId] ? bossId : null, { registry: ctx.registry }),
      );
    }
  };

  const update = (): void => {
    const s = c.state;
    const m = c.engine.modifiers();
    const round = s.round;
    updateBlind();

    const slot = s.blinds[s.blindIndex] ?? null;
    let target: number | null = null;
    let reward: number | null = null;
    if (round) {
      target = round.target;
      reward = c.engine.blindReward(round.blind, round.bossId);
    } else if (slot && s.phase !== 'victory') {
      target = c.engine.blindTarget(slot.kind, slot.bossId);
      reward = c.engine.blindReward(slot.kind, slot.bossId);
    }
    setText(targetValue, target === null ? '–' : formatNumber(target));
    setText(
      targetReward,
      reward === null
        ? t('game.sidebar.targetNone')
        : reward > 0
          ? t('game.sidebar.reward', { n: reward })
          : t('game.sidebar.noReward'),
    );
    if (!scoring) setText(roundScoreEl, formatNumber(round?.score ?? 0));
    updateHand();

    setText(handsEl, formatNumber(round ? round.handsLeft : m.hands));
    setText(discardsEl, formatNumber(round ? round.discardsLeft : m.discards));
    setText(moneyEl, formatMoney(s.money));
    moneyEl.classList.toggle('is-negative', s.money < 0);
    setText(
      anteEl,
      s.endless ? formatNumber(s.ante) : t('game.sidebar.anteValue', { ante: s.ante, final: FINAL_ANTE }),
    );
    setText(anteNote, s.endless ? t('game.sidebar.endless') : '');
    anteNote.hidden = !s.endless;
    setText(roundEl, formatNumber(roundNumber(s)));
  };

  return {
    el,
    update,
    handInfoEl,
    moneyEl,
    roundScoreEl,
    showScoring(s) {
      scoring = s;
      updateHand();
    },
    setChipsMult(chips, mult) {
      if (scoring) {
        scoring = { ...scoring, chips, mult };
      }
      setText(chipsEl, formatNumber(chips));
      setText(multEl, formatNumber(mult));
    },
    setRoundScore(n) {
      setText(roundScoreEl, formatNumber(n));
    },
    setMoney(n) {
      setText(moneyEl, formatMoney(n));
      moneyEl.classList.toggle('is-negative', n < 0);
    },
  };
}
