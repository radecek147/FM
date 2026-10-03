/**
 * Levý panel herní obrazovky (DESIGN 13.2): útrata / šéf a jeho pravidlo, „Dosáhni aspoň“, skóre kola,
 * kombinace s úrovní a živým náhledem čipy × mult, Ruce, Zahození, peníze, Patro, Kolo a tlačítka
 * Info o runu / Nastavení / Menu.
 *
 * Kostra se postaví jednou, `update()` jen přepisuje texty (levné — volá se po každé změně výběru).
 * Presenter si během skórování převezme kombinaci a počítadla (`showScoring`, `setChipsMult`…).
 */
import type { BlindKind, HandType } from '../../../engine';
import { hasKey, t } from '../../../i18n/cs';
import { formatMoney, formatNumber } from '../../../i18n/format';
import { blindArt } from '../../art/art';
import { iconElement } from '../../art/icons';
import { button } from '../../components/button';
import { createContentCard } from '../../components/consumableCard';
import { attachTooltip, contentTooltip } from '../../components/tooltip';
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
  /** Čísla čipů a multu v náhledu kombinace (presenter je při změně nechá povyskočit). */
  chipsEl: HTMLElement;
  multEl: HTMLElement;
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

/**
 * Číslo do políčka panelu: text a jeho délka v `--chars` — CSS podle ní zmenší písmo, aby se velké číslo (nekonečný
 * režim, 12+ číslic) vešlo na jeden řádek a nikdy se nezlomilo uprostřed skupiny číslic (game.css, `cqi`).
 */
export function setNumberText(el: HTMLElement, text: string): void {
  setText(el, text);
  const chars = String(Math.max(1, [...text].length));
  if (el.style.getPropertyValue('--chars') !== chars) el.style.setProperty('--chars', chars);
}

export function createSidebar(ctx: GameCtx, actions: SidebarActions): Sidebar {
  const c = ctx.controller;

  const token = h('div', { class: 'gs-blind__token' });
  const blindNameEl = h('h2', { class: 'gs-blind__name', 'data-testid': 'blind-name' });
  const blindRule = h('p', { class: 'gs-blind__rule', 'data-testid': 'blind-rule' });
  const blindBox = h(
    'section',
    { class: 'gs-blind', 'aria-live': 'polite' },
    token,
    h('div', { class: 'gs-blind__text' }, blindNameEl, blindRule),
  );

  // Aktivní štítky (DESIGN 7: hromadí se a ukazují v levém panelu) — žetony s tooltipem (hover, focus, dlouhý stisk).
  const tagList = h('ul', { class: 'gs-tags__list', role: 'list' });
  const tagsBox = h(
    'section',
    { class: 'gs-tags', 'aria-labelledby': 'gs-tags-title', 'data-testid': 'active-tags', hidden: true },
    h('h2', { class: 'gs-label gs-tags__title', id: 'gs-tags-title' }, t('game.sidebar.tags')),
    tagList,
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
  // Šéf by ruku zakázal (Soused s vrtačkou) — hráč to vidí ještě před zahráním.
  const handWarn = h('p', { class: 'gs-hand__warn', 'data-testid': 'hand-blocked', hidden: true });
  // Laťka šéfa (Pan starosta): skóre, které musí příští ruka překonat, aby se započítala.
  const handBeat = h('p', { class: 'gs-hand__beat', 'data-testid': 'hand-beat', hidden: true });
  const handInfoEl = h(
    'section',
    { class: 'gs-box gs-hand', 'aria-label': t('game.sidebar.hand') },
    h('p', { class: 'gs-hand__head' }, handName, handLevel),
    handBeat,
    handWarn,
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
    tagsBox,
    targetBox,
    scoreBox,
    handInfoEl,
    stats,
    buttons,
  );

  let scoring: { hand: HandType; level: number; chips: number; mult: number } | null = null;
  let tokenKey = '';
  let tagsKey = '';
  let detachToken: (() => void) | null = null;

  const setWarn = (text: string, blocked = true): void => {
    setText(handWarn, text);
    handWarn.hidden = text === '';
    handInfoEl.classList.toggle('is-blocked', text !== '' && blocked);
    handInfoEl.classList.toggle('is-short', text !== '' && !blocked);
  };

  /** „Překonej: X“ (Pan starosta) — v kole, dokud laťka platí; mimo kolo a během skórování nic. */
  const setBeat = (beat: number | null): void => {
    const text = beat === null ? '' : t('game.sidebar.scoreToBeat', { score: beat });
    setText(handBeat, text);
    handBeat.hidden = text === '';
  };

  const updateTags = (): void => {
    const tags = c.state.tags;
    const key = tags.map((x) => `${x.uid}:${x.defId}`).join(',');
    if (key === tagsKey) return;
    tagsKey = key;
    tagsBox.hidden = tags.length === 0;
    tagList.replaceChildren(
      ...tags.map((x) =>
        h(
          'li',
          { class: 'gs-tags__item' },
          createContentCard('tag', x.defId, {
            registry: ctx.registry,
            interactive: true,
            className: 'gs-tag',
          }),
        ),
      ),
    );
  };

  const writeHand = (name: string, level: string, chips: string, mult: string): void => {
    setText(handName, name);
    setText(handLevel, level);
    setText(chipsEl, chips);
    setText(multEl, mult);
  };

  const updateHand = (): void => {
    const s = c.state;
    // Mimo kolo (výběr útraty, Večerka, konec kola…) se náhled kombinace neukazuje — „Vyber karty 0 × 0“ by mátlo.
    // Během skórování zůstává (presenter ho plní), v obálce s dobranou rukou slouží výběru cílů.
    const handPhase = s.phase === 'round' || (s.phase === 'booster' && (s.booster?.hand.length ?? 0) > 0);
    handInfoEl.hidden = !scoring && !handPhase;
    if (scoring) {
      writeHand(
        t(`hands.${scoring.hand}.name`),
        t('game.sidebar.level', { level: scoring.level }),
        formatNumber(scoring.chips),
        formatNumber(scoring.mult),
      );
      handInfoEl.classList.add('is-scoring');
      setWarn('');
      setBeat(null);
      return;
    }
    handInfoEl.classList.remove('is-scoring');
    setBeat(s.phase === 'round' ? c.engine.scoreToBeat() : null);
    const selecting = handPhase && c.selected.length > 0;
    if (!selecting) {
      writeHand(t('game.sidebar.handNone'), '', '0', '0');
      setWarn('');
      return;
    }
    const p = c.preview();
    const reason =
      s.phase === 'round' && p.blockedReason && hasKey(p.blockedReason) ? t(p.blockedReason) : '';
    if (reason) setWarn(t('game.sidebar.handBlocked', { reason }));
    else if (
      s.phase === 'round' &&
      p.scoreToBeat !== undefined &&
      p.estimate !== undefined &&
      p.estimate <= p.scoreToBeat
    ) {
      // Pan starosta: podle odhadu (všechny efekty, náhoda neprozrazená) ruka laťku nepřekoná. Varování nese obě
      // čísla — řádek „Překonej“ se schová, ať panel nepřeteče.
      setWarn(t('game.sidebar.belowBeat', { estimate: p.estimate, score: p.scoreToBeat }), false);
      setBeat(null);
    } else setWarn('');
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
    let beaten = false;
    const victory = s.phase === 'victory';
    if (round && (s.phase === 'round' || s.phase === 'round_end' || s.phase === 'game_over')) {
      kind = round.blind;
      bossId = round.bossId;
      name = blindName(kind, bossId && ctx.registry.bosses[bossId] ? bossId : null);
      if (s.phase === 'round_end') {
        // Útrata je poražená: pravidlo už neplatí — místo něj „Poraženo“ (jinak to vypadá jako další šéf, zvlášť po
        // startu nekonečného režimu, kdy se vyplácí odměna za finálového šéfa).
        beaten = true;
        rule = t(kind === 'boss' ? 'game.sidebar.bossBeaten' : 'game.sidebar.blindBeaten');
      } else if (bossId && ctx.registry.bosses[bossId]) {
        const bossRule = bossTexts(bossId, { registry: ctx.registry }).rule;
        // Velká útrata na Imperialu má pravidlo šéfa navíc (DESIGN kap. 10).
        rule = round.bossDisabled
          ? t('game.sidebar.bossDisabled')
          : kind === 'boss'
            ? bossRule
            : t('game.blinds.extraRule', { rule: bossRule });
      } else if (kind === 'boss') {
        rule = t('game.sidebar.noRule');
      }
    } else {
      name = t(`game.sidebar.phase.${s.phase}`);
      const boss = s.blinds.find((b) => b.kind === 'boss');
      if (boss?.bossId && ctx.registry.bosses[boss.bossId] && !victory)
        rule = t('game.sidebar.nextBoss', { name: blindName('boss', boss.bossId) });
    }
    setText(blindNameEl, name);
    setText(blindRule, rule);
    blindRule.hidden = rule === '';
    blindBox.dataset.blind = victory ? 'victory' : kind;
    blindBox.classList.toggle('is-beaten', beaten);
    // Výhra: pohár místo žetonu útraty (ne ikona dalšího / poraženého šéfa).
    const key = victory ? 'victory' : `${kind}|${bossId ?? ''}`;
    if (key !== tokenKey) {
      tokenKey = key;
      const known = !victory && bossId && ctx.registry.bosses[bossId] ? bossId : null;
      token.replaceChildren(
        victory
          ? iconElement('trophy', { className: 'gs-blind__trophy' })
          : blindArt(kind, known, { registry: ctx.registry }),
      );
      // Žeton šéfa: tooltip s pravidlem a hláškou (hover, dlouhý stisk); jinak jen ozdoba.
      detachToken?.();
      detachToken = known
        ? attachTooltip(token, () => contentTooltip('boss', known, { registry: ctx.registry }))
        : null;
      if (known) token.removeAttribute('aria-hidden');
      else token.setAttribute('aria-hidden', 'true');
      token.setAttribute('role', known ? 'img' : 'presentation');
      if (known) token.setAttribute('aria-label', blindName('boss', known));
      else token.removeAttribute('aria-label');
    }
  };

  const update = (): void => {
    const s = c.state;
    const m = c.engine.modifiers();
    const round = s.round;
    // Mimo kolo jsou kombinace a skóre kola jen informační — CSS je ztlumí.
    el.dataset.phase = s.phase;
    updateBlind();
    updateTags();

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
    setNumberText(targetValue, target === null ? '–' : formatNumber(target));
    setText(
      targetReward,
      reward === null
        ? t('game.sidebar.targetNone')
        : reward > 0
          ? t('game.sidebar.reward', { n: reward })
          : t('game.sidebar.noReward'),
    );
    if (!scoring) setNumberText(roundScoreEl, formatNumber(round?.score ?? 0));
    updateHand();

    setText(handsEl, formatNumber(round ? round.handsLeft : m.hands));
    setText(discardsEl, formatNumber(round ? round.discardsLeft : m.discards));
    setNumberText(moneyEl, formatMoney(s.money));
    moneyEl.classList.toggle('is-negative', s.money < 0);
    setText(
      anteEl,
      // Patro výhry podle pravidel runu (výzva Konec světa: 12).
      s.endless ? formatNumber(s.ante) : t('game.sidebar.anteValue', { ante: s.ante, final: m.finalAnte }),
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
    chipsEl,
    multEl,
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
      setNumberText(roundScoreEl, formatNumber(n));
    },
    setMoney(n) {
      setNumberText(moneyEl, formatMoney(n));
      moneyEl.classList.toggle('is-negative', n < 0);
    },
  };
}
