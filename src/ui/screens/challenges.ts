/**
 * Výzvy (DESIGN 11.1): seznam 20 výzev po várkách (odemykají se po 1 / 3 / 6 / 10 výhrách) a detail vybrané
 * výzvy. Zamčená výzva ukáže název a podmínku s průběhem, odemčená pravidla, balíček, sílu piva, cíl, start
 * a vlastní statistiku (pokusy, dokončení, nejvyšší patro), dokončená navíc odznak. Start přes profil
 * (`NewRunRequest.challengeId`, balíček a síla piva z definice — engine je u výzvy stejně přebije).
 *
 * Ovládání: šipky nahoru / dolů (Home / End) mezi výzvami v seznamu, Enter / mezerník výzvu vybere, Esc zpět
 * do menu. Výběr výzvy sundá štítek „Nové“.
 */
import '../styles/meta.css';
import type { ChallengeDef } from '../../engine';
import { FINAL_ANTE } from '../../engine';
import { isChallengeUnlocked } from '../../engine/meta';
import { t } from '../../i18n/cs';
import { formatNumber } from '../../i18n/format';
import type { App, ScreenFactory } from '../app';
import { iconElement } from '../art/icons';
import { backButton, button, focusWhenMounted } from '../components/button';
import { createContentCard } from '../components/consumableCard';
import { challengeTexts } from '../describe';
import { h } from '../dom';
import { deckName, stakeName, unlockInfo } from '../metaText';
import { startRunFlow, runInProgress } from '../runStart';
import { randomSeed } from '../seed';
import { continueRun } from './menu';

/** Kolik výzev je v jedné várce (odemykají se spolu, DESIGN 11.1). */
export const CHALLENGE_GROUP_SIZE = 5;

/** Stav výzvy v seznamu. */
export type ChallengeStatus = 'locked' | 'open' | 'tried' | 'completed' | 'playing';

/** Patro, jehož šéf výzvu dokončí (Konec světa 12, jinak 8). */
export function challengeFinalAnte(def: ChallengeDef): number {
  return FINAL_ANTE + (def.extraModifiers?.finalAnte ?? 0);
}

/** Rozehraný run je tahle výzva (v profilu a jde v něm pokračovat)? */
function isPlaying(app: App, id: string): boolean {
  return app.profile.current?.challengeId === id && runInProgress(app);
}

export function challengeStatus(app: App, def: ChallengeDef): ChallengeStatus {
  if (!isChallengeUnlocked(app.profile, app.registry, def.id)) return 'locked';
  if (isPlaying(app, def.id)) return 'playing';
  const cs = app.profile.stats.challenges[def.id];
  if ((cs?.completed ?? 0) > 0) return 'completed';
  return (cs?.attempts ?? 0) > 0 ? 'tried' : 'open';
}

function statusIcon(status: ChallengeStatus): string | null {
  switch (status) {
    case 'locked':
      return 'padlock';
    case 'completed':
      return 'trophy';
    case 'playing':
      return 'hourglass';
    default:
      return null;
  }
}

function factRow(label: string, value: string | Node, testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'stat-row' },
    h('dt', { class: 'stat-row__label' }, label),
    h('dd', { class: 'stat-row__value', 'data-testid': testId }, value),
  );
}

/** Detail výzvy (pravý sloupec). */
function challengeDetail(app: App, def: ChallengeDef, onStart: () => void): HTMLElement {
  const reg = app.registry;
  const status = challengeStatus(app, def);
  const tx = challengeTexts(def.id, { registry: reg });
  const cs = app.profile.stats.challenges[def.id];
  const locked = status === 'locked';
  const art = createContentCard('challenge', def.id, {
    registry: reg,
    tooltip: false,
    className: locked ? 'is-silhouette' : undefined,
  });
  const head = h(
    'header',
    { class: 'challenge-detail__head' },
    h(
      'div',
      { class: 'challenge-detail__art', 'aria-hidden': 'true' },
      art,
      // Zamčená výzva: zámek přes siluetu karty (jako zamčený balíček v Nové hře).
      locked ? iconElement('padlock', { className: 'challenge-detail__lock' }) : null,
    ),
    h(
      'div',
      { class: 'challenge-detail__titles' },
      h('h2', { class: 'challenge-detail__name', id: 'challenge-detail-title' }, tx.name),
      status === 'completed'
        ? h(
            'p',
            { class: 'challenge-detail__badge', 'data-testid': 'challenge-completed-badge' },
            iconElement('trophy'),
            t('meta.challenges.detail.badge'),
          )
        : null,
      locked ? null : h('p', { class: 'challenge-detail__desc' }, tx.desc),
      !locked && tx.flavor
        ? h(
            'p',
            { class: 'challenge-detail__flavor' },
            t('meta.collection.detail.flavor', { text: tx.flavor }),
          )
        : null,
    ),
  );

  if (locked) {
    const info = unlockInfo(app.profile, reg, 'challenges', def.id);
    return h(
      'article',
      {
        class: 'challenge-detail paper is-locked',
        'aria-labelledby': 'challenge-detail-title',
        'data-testid': 'challenge-detail',
        'data-challenge': def.id,
        'data-status': status,
      },
      head,
      h('p', { class: 'challenge-detail__note' }, t('meta.challenges.detail.lockedNote')),
      h('h3', { class: 'challenge-detail__heading' }, t('meta.challenges.detail.condition')),
      h(
        'p',
        { class: 'challenge-detail__condition', 'data-testid': 'challenge-condition' },
        info?.text ?? '',
      ),
      info?.progressText
        ? h(
            'p',
            { class: 'challenge-detail__progress' },
            t('meta.challenges.detail.progress', { progress: info.progressText }),
          )
        : null,
    );
  }

  const facts = h(
    'dl',
    { class: 'stat-list challenge-detail__facts' },
    factRow(t('meta.challenges.detail.deck'), deckName(def.deckId), 'challenge-deck'),
    factRow(t('meta.challenges.detail.stake'), stakeName(reg, def.stake ?? 1), 'challenge-stake'),
    factRow(
      t('meta.challenges.detail.goal'),
      t('meta.challenges.detail.goalValue', { ante: challengeFinalAnte(def) }),
    ),
  );
  const rules = h(
    'ul',
    { class: 'challenge-detail__rules', 'data-testid': 'challenge-rules' },
    tx.rules.map((r) => h('li', null, r)),
  );
  const stats =
    cs && cs.attempts > 0
      ? h(
          'dl',
          { class: 'stat-list', 'data-testid': 'challenge-stats' },
          factRow(t('meta.challenges.detail.attempts'), formatNumber(cs.attempts)),
          factRow(
            t('meta.challenges.detail.completedTimes'),
            t('meta.challenges.detail.completedValue', { n: cs.completed }),
          ),
          factRow(t('meta.challenges.detail.bestAnte'), formatNumber(cs.bestAnte)),
        )
      : h('p', { class: 'stats-empty', 'data-testid': 'challenge-stats' }, t('meta.challenges.detail.never'));

  const actions: HTMLElement[] = [];
  if (status === 'playing') {
    actions.push(
      button({
        label: t('meta.challenges.continue'),
        variant: 'primary',
        testId: 'challenge-continue',
        onClick: () => void continueRun(app),
      }),
    );
  }
  actions.push(
    button({
      label: t('meta.challenges.start'),
      ariaLabel: t('meta.challenges.startLabel', { name: tx.name }),
      variant: status === 'playing' ? 'paper' : 'primary',
      size: 'large',
      testId: 'challenge-start',
      onClick: onStart,
    }),
  );

  return h(
    'article',
    {
      class: ['challenge-detail', 'paper', `is-${status}`],
      'aria-labelledby': 'challenge-detail-title',
      'data-testid': 'challenge-detail',
      'data-challenge': def.id,
      'data-status': status,
    },
    head,
    facts,
    h('h3', { class: 'challenge-detail__heading' }, t('meta.challenges.detail.rules')),
    rules,
    h('h3', { class: 'challenge-detail__heading' }, t('meta.challenges.detail.stats')),
    stats,
    h('div', { class: 'challenge-detail__actions' }, actions),
    h('p', { class: 'challenge-detail__hint' }, t('meta.challenges.note')),
  );
}

export const challengesScreen: ScreenFactory = (app, params) => {
  const reg = app.registry;
  const defs = Object.values(reg.challenges);
  const statuses = new Map(defs.map((d) => [d.id, challengeStatus(app, d)] as const));
  const unlocked = defs.filter((d) => statuses.get(d.id) !== 'locked').length;
  const completed = defs.filter((d) => (app.profile.stats.challenges[d.id]?.completed ?? 0) > 0).length;
  const wins = app.profile.stats.runs.won;

  // Výchozí výběr: parametr, rozehraná výzva, první odemčená nedokončená, jinak první.
  const requested = typeof params?.challengeId === 'string' ? params.challengeId : null;
  let selected =
    defs.find((d) => d.id === requested) ??
    defs.find((d) => statuses.get(d.id) === 'playing') ??
    defs.find((d) => {
      const s = statuses.get(d.id);
      return s === 'open' || s === 'tried';
    }) ??
    defs[0];

  const detailHost = h('div', {
    class: 'challenges__detail',
    role: 'region',
    'aria-label': t('meta.challenges.detail.label'),
    'aria-live': 'polite',
  });

  const start = (def: ChallengeDef): void => {
    void startRunFlow(
      app,
      { deckId: def.deckId, stake: def.stake ?? 1, seed: randomSeed(), challengeId: def.id },
      'meta.challenges.failed',
    );
  };

  const items: HTMLButtonElement[] = [];
  const select = (def: ChallengeDef, opts: { focus?: boolean; scroll?: boolean } = {}): void => {
    selected = def;
    items.forEach((btn) => {
      const on = btn.dataset.challenge === def.id;
      btn.setAttribute('aria-current', on ? 'true' : 'false');
      btn.classList.toggle('is-selected', on);
      btn.tabIndex = on ? 0 : -1;
      if (on && opts.focus) btn.focus();
    });
    detailHost.replaceChildren(challengeDetail(app, def, () => start(def)));
    // Štítek „Nové“ zmizí, jakmile hráč výzvu uvidí.
    if (app.profile.unseen.includes(`challenges:${def.id}`)) {
      app.profiles.markSeen('challenges', [def.id]);
      items
        .find((b) => b.dataset.challenge === def.id)
        ?.querySelector('.challenge-item__new')
        ?.remove();
    }
    // Na úzké obrazovce je detail pod seznamem — dojeď k němu.
    if (opts.scroll && typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches)
      detailHost.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  const groups: HTMLElement[] = [];
  for (let g = 0; g * CHALLENGE_GROUP_SIZE < defs.length; g++) {
    const slice = defs.slice(g * CHALLENGE_GROUP_SIZE, (g + 1) * CHALLENGE_GROUP_SIZE);
    const cond = slice[0]?.unlock;
    const need = cond?.type === 'winsTotal' ? cond.count : 0;
    const groupId = `challenge-group-${g + 1}`;
    const list = slice.map((def, i) => {
      const n = g * CHALLENGE_GROUP_SIZE + i + 1;
      const status = statuses.get(def.id) ?? 'locked';
      const name = challengeTexts(def.id, { registry: reg }).name;
      const isNew = app.profile.unseen.includes(`challenges:${def.id}`);
      const icon = statusIcon(status);
      const btn = h(
        'button',
        {
          type: 'button',
          class: ['challenge-item', `is-${status}`],
          'aria-current': 'false',
          'aria-label': t('meta.challenges.itemLabel', {
            n,
            name,
            status: t(`meta.challenges.status.${status}`),
          }),
          tabindex: '-1',
          'data-testid': `challenge-${def.id}`,
          'data-challenge': def.id,
          'data-status': status,
          onClick: () => select(def, { scroll: true }),
        },
        h('span', { class: 'challenge-item__no', 'aria-hidden': 'true' }, String(n)),
        h('span', { class: 'challenge-item__name', 'aria-hidden': 'true' }, name),
        isNew
          ? h('span', { class: 'challenge-item__new', 'aria-hidden': 'true' }, t('meta.challenges.newBadge'))
          : null,
        h(
          'span',
          { class: 'challenge-item__status', 'aria-hidden': 'true' },
          icon ? iconElement(icon) : null,
          t(`meta.challenges.status.${status}`),
        ),
      );
      items.push(btn);
      return h('li', null, btn);
    });
    groups.push(
      h(
        'section',
        { class: 'challenges__group', 'aria-labelledby': groupId },
        h(
          'h2',
          { class: 'challenges__group-title', id: groupId },
          t('meta.challenges.group', { n: g + 1, wins: need }),
        ),
        h(
          'ol',
          { class: 'challenges__items', role: 'list', start: String(g * CHALLENGE_GROUP_SIZE + 1) },
          list,
        ),
      ),
    );
  }

  const listEl = h(
    'nav',
    {
      class: 'challenges__list',
      'aria-label': t('meta.challenges.listLabel'),
      'data-testid': 'challenge-list',
    },
    groups,
  );
  // Šipky mezi výzvami (roving tabindex — Tab ze seznamu odejde rovnou na detail).
  listEl.addEventListener('keydown', (e) => {
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(items.length - 1, idx + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const def = defs.find((d) => d.id === items[next]?.dataset.challenge);
    if (def) select(def, { focus: true });
  });

  const nextTier = defs
    .map((d) => (d.unlock?.type === 'winsTotal' ? d.unlock.count : 0))
    .filter((need) => need > wins)
    .sort((a, b) => a - b)[0];
  const summary = h(
    'section',
    { class: 'challenges__summary paper', 'aria-label': t('meta.challenges.summaryLabel') },
    h(
      'dl',
      { class: 'stat-list stat-list--compact' },
      factRow(
        t('meta.challenges.completed'),
        t('meta.challenges.countValue', { n: completed, total: defs.length }),
        'challenges-completed',
      ),
      factRow(
        t('meta.challenges.unlocked'),
        t('meta.challenges.countValue', { n: unlocked, total: defs.length }),
        'challenges-unlocked',
      ),
      factRow(t('meta.challenges.wins'), formatNumber(wins)),
    ),
    h(
      'p',
      { class: 'challenges__next', 'data-testid': 'challenges-next' },
      nextTier !== undefined
        ? t('meta.challenges.next', { wins: nextTier, have: wins })
        : t('meta.challenges.allUnlocked'),
    ),
  );

  const el = h(
    'main',
    { class: 'screen challenges', 'aria-labelledby': 'challenges-title', 'data-testid': 'challenges' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'challenges-title', class: 'screen-title' }, t('meta.challenges.title')),
        h('p', { class: 'screen-subtitle' }, t('meta.challenges.subtitle')),
      ),
    ),
    summary,
    h('div', { class: 'challenges__layout' }, listEl, detailHost),
  );

  if (selected) {
    select(selected);
    const current = items.find((b) => b.dataset.challenge === selected?.id);
    if (current) focusWhenMounted(current);
  }

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
