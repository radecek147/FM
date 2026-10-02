/**
 * Denní run (DESIGN 11.7): dnešní seed `DEN-YYYYMMDD` (UTC), balíček a síla piva ze seedu, stav oficiálního pokusu
 * (čeká / rozehraný / odehraný — další pokusy jsou „mimo soutěž“), výsledek ke sdílení se zkopírováním do schránky,
 * série dní a historie oficiálních pokusů. Run se zakládá přes profil s `daily: true` — jestli je oficiální,
 * rozhodne meta vrstva (první run dne s dnešním seedem); pool obsahu je celý bez ohledu na odemčení.
 */
import '../styles/meta.css';
import type { DailySetup } from '../../engine/meta';
import { dailyRunSetup, dailyStreak } from '../../engine/meta';
import { t } from '../../i18n/cs';
import { formatNumber } from '../../i18n/format';
import type { App, ScreenFactory } from '../app';
import { artElement } from '../art/art';
import { backButton, button, focusWhenMounted } from '../components/button';
import { h } from '../dom';
import { deckName, formatDateKey, stakeName } from '../metaText';
import { runInProgress, startRunFlow } from '../runStart';
import { continueRun } from './menu';
import { copyDailyShare, dailyHistoryList, dailyShareText } from './stats';

/** Stav dnešního oficiálního pokusu. */
export type DailyState = 'available' | 'playing' | 'lost' | 'finished';

export interface DailyStatus {
  setup: DailySetup;
  state: DailyState;
  /** Rozehraný run je dnešní denní run (oficiální i mimo soutěž) — jde v něm pokračovat. */
  playingToday: boolean;
}

/** Stav dnešního denního runu podle profilu a rozehrané hry. */
export function dailyStatus(app: App, nowIso: string = app.profiles.metaCtx().nowIso): DailyStatus {
  const setup = dailyRunSetup(nowIso, app.registry);
  const rec = app.profile.daily[setup.dateKey];
  const cur = app.profile.current;
  const playingToday = !!cur && cur.daily && cur.seed === setup.seed && runInProgress(app);
  let state: DailyState = 'available';
  if (rec?.status === 'finished') state = 'finished';
  else if (rec?.status === 'playing') state = playingToday && cur?.official ? 'playing' : 'lost';
  return { setup, state, playingToday };
}

/** Hodiny a minuty do dalšího denního runu (půlnoc UTC). */
export function timeToNextDaily(nowIso: string): { h: number; m: number } {
  const now = new Date(nowIso);
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

function row(label: string, value: string | Node, testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'stat-row' },
    h('dt', { class: 'stat-row__label' }, label),
    h('dd', { class: 'stat-row__value', 'data-testid': testId }, value),
  );
}

/** Výsledek ke sdílení s tlačítkem Kopírovat. */
export function shareBlock(text: string, testId: string): HTMLElement {
  return h(
    'div',
    { class: 'daily-share' },
    h('p', { class: 'daily-share__label' }, t('meta.dailyRun.share')),
    h('code', { class: 'daily-share__text', 'data-testid': `${testId}-text` }, text),
    button({
      label: t('meta.daily.copyShare'),
      variant: 'paper',
      size: 'small',
      testId,
      onClick: () => void copyDailyShare(text),
    }),
  );
}

export const dailyScreen: ScreenFactory = (app) => {
  const reg = app.registry;
  const nowIso = app.profiles.metaCtx().nowIso;
  const { setup, state, playingToday } = dailyStatus(app, nowIso);
  const rec = app.profile.daily[setup.dateKey];
  const deck = reg.decks[setup.deckId];
  const stake = Object.values(reg.stakes).find((s) => s.level === setup.stake);

  const start = (): void => {
    void startRunFlow(
      app,
      { deckId: setup.deckId, stake: setup.stake, seed: setup.seed, daily: true },
      'meta.dailyRun.failed',
    );
  };

  let statusText: string;
  if (state === 'finished' && rec) {
    const result = t('meta.dailyRun.result', { ante: rec.ante, score: rec.bestHand });
    statusText = t('meta.dailyRun.state.finished', {
      result: rec.outcome ? `${t(`meta.dailyRun.outcome.${rec.outcome}`)}, ${result}` : result,
    });
  } else {
    statusText = t(`meta.dailyRun.state.${state}`);
  }

  const actions: HTMLElement[] = [];
  if (playingToday) {
    actions.push(
      button({
        label: t('meta.dailyRun.continue'),
        variant: 'primary',
        size: 'large',
        testId: 'daily-continue',
        onClick: () => void continueRun(app),
      }),
    );
  }
  if (state === 'available') {
    actions.push(
      button({
        label: t('meta.dailyRun.play'),
        variant: playingToday ? 'paper' : 'primary',
        size: 'large',
        testId: 'daily-play',
        onClick: start,
      }),
    );
  } else if (state !== 'playing') {
    actions.push(
      button({
        label: t('meta.dailyRun.replay'),
        variant: 'paper',
        testId: 'daily-replay',
        describedBy: 'daily-replay-hint',
        onClick: start,
      }),
    );
  }

  const next = timeToNextDaily(nowIso);
  const today = h(
    'section',
    {
      class: [
        'daily-today',
        'paper',
        `is-${state}`,
        state === 'finished' && rec?.outcome ? `is-outcome-${rec.outcome}` : '',
      ],
      'aria-labelledby': 'daily-today-title',
      'data-testid': 'daily-today',
      'data-state': state,
    },
    deck
      ? h(
          'div',
          {
            class: ['daily-today__art', 'art-tile', `art-tile--${deck.art.pattern ?? 'none'}`],
            'aria-hidden': 'true',
          },
          artElement('deck', deck.art),
        )
      : null,
    h(
      'div',
      { class: 'daily-today__body' },
      h('h2', { class: 'stats-section__title', id: 'daily-today-title' }, t('meta.dailyRun.today')),
      h(
        'dl',
        { class: 'stat-list' },
        row(t('meta.dailyRun.date'), formatDateKey(setup.dateKey), 'daily-date'),
        row(t('meta.dailyRun.seed'), h('code', { class: 'daily-today__seed' }, setup.seed), 'daily-seed'),
        row(t('meta.dailyRun.deck'), deckName(setup.deckId), 'daily-deck'),
        row(t('meta.dailyRun.stake'), stakeName(reg, setup.stake), 'daily-stake'),
      ),
      h(
        'p',
        { class: 'daily-today__status', 'data-testid': 'daily-status' },
        h('span', { class: 'visually-hidden' }, `${t('meta.dailyRun.status')}: `),
        statusText,
      ),
      deck ? h('p', { class: 'daily-today__desc' }, t(`decks.${deck.id}.desc`, deck.params)) : null,
      stake && stake.level > 1
        ? h('p', { class: 'daily-today__desc' }, t(`stakes.${stake.id}.desc`, stake.params))
        : null,
      state === 'finished' && rec
        ? shareBlock(dailyShareText(rec.seed, rec.ante, rec.bestHand), 'daily-share')
        : null,
      h('div', { class: 'daily-today__actions' }, actions),
      state !== 'available' && state !== 'playing'
        ? h('p', { id: 'daily-replay-hint', class: 'setting__hint' }, t('meta.dailyRun.replayHint'))
        : null,
      h('p', { class: 'stats-note' }, t('meta.dailyRun.rules')),
      h('p', { class: 'stats-note', 'data-testid': 'daily-next' }, t('meta.dailyRun.next', next)),
    ),
  );

  const keys = Object.keys(app.profile.daily);
  const streak = dailyStreak(app.profile, nowIso);
  const bestAnte = Math.max(0, ...keys.map((k) => app.profile.daily[k]?.ante ?? 0));
  const streakBox = h(
    'section',
    { class: 'stats-section paper', 'aria-labelledby': 'daily-streak-title' },
    h('h2', { class: 'stats-section__title', id: 'daily-streak-title' }, t('meta.dailyRun.streakTitle')),
    h(
      'dl',
      { class: 'stat-list' },
      row(
        t('meta.daily.streak'),
        t('meta.daily.streakValue', { current: streak.current, longest: streak.longest }),
        'daily-streak',
      ),
      row(t('meta.daily.played'), formatNumber(keys.length)),
      row(t('meta.daily.best'), bestAnte > 0 ? formatNumber(bestAnte) : t('meta.stats.overview.none')),
    ),
  );

  const el = h(
    'main',
    { class: 'screen daily', 'aria-labelledby': 'daily-title', 'data-testid': 'daily' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'daily-title', class: 'screen-title' }, t('meta.dailyRun.title')),
        h('p', { class: 'screen-subtitle' }, t('meta.dailyRun.subtitle')),
      ),
    ),
    h(
      'div',
      { class: 'daily__layout' },
      today,
      streakBox,
      h(
        'section',
        { class: 'daily__history', 'aria-labelledby': 'daily-history-title' },
        h('h2', { class: 'stats-heading', id: 'daily-history-title' }, t('meta.dailyRun.historyTitle')),
        dailyHistoryList(app.profile, reg),
      ),
    ),
  );

  const first = actions[0];
  if (first) focusWhenMounted(first);

  return {
    el,
    onKey(e) {
      if (e.key === 'Escape') {
        app.go('menu');
        return true;
      }
      return false;
    },
  };
};
