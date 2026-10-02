/**
 * Statistiky (DESIGN 11.5) v záložkách:
 *  - **Přehled:** runy (odehrané, výhry, prohry, úspěšnost, série, nejrychlejší výhra), rekordy (nejlepší ruka se
 *    seedem ke zkopírování, nejvyšší skóre kola, nejvyšší patro v hlavní hře i nekonečném režimu), oblíbené
 *    (kombinace, žolík ve slotu, kupovaný žolík, nejčastější příčina proher, výzvy, achievementy) a počítadla,
 *  - **Balíčky** a **Síla piva:** odehráno / výhry / úspěšnost (u balíčku i nejsilnější vyhrané pivo),
 *  - **Šéfové:** poražen / ukončil run (nepotkaní jako „???“) a kde runy končí (Malá / Velká útrata / šéf),
 *  - **Historie:** posledních 50 runů (datum, seed s kopírováním, balíček, síla piva, výzva / denní / zadaný seed,
 *    výsledek, patro, nejlepší ruka, žolíci na konci),
 *  - **Denní runy:** série dní, dnešní pokus a oficiální pokusy s textem ke sdílení.
 * Data čte jen z profilu (`app.profile`); seedované runy jsou jen v historii (poznámka v přehledu).
 */
import '../styles/meta.css';
import type { ContentRegistry, UnlockTotalStat } from '../../engine';
import type { HistoryEntry, Profile } from '../../engine/meta';
import {
  HISTORY_LIMIT,
  TOTAL_STAT_KEYS,
  achievementList,
  challengesCompleted,
  dailyStreak,
  isDailyAvailable,
  topEntry,
  winRate,
} from '../../engine/meta';
import { t } from '../../i18n/cs';
import { formatMoney, formatNumber } from '../../i18n/format';
import type { App, ScreenFactory } from '../app';
import { backButton, button } from '../components/button';
import { createTabs } from '../components/tabs';
import { toast } from '../components/toast';
import { h } from '../dom';
import {
  bossName,
  challengeName,
  deckName,
  formatDateKey,
  formatDateTime,
  handName,
  jokerName,
  stakeName,
} from '../metaText';
import { copySeed, copyText } from './game/shared';

export const STATS_TABS = ['overview', 'decks', 'stakes', 'bosses', 'history', 'daily'] as const;
export type StatsTab = (typeof STATS_TABS)[number];

/** Počítadla, která jsou v korunách. */
const MONEY_TOTALS: ReadonlySet<UnlockTotalStat> = new Set(['moneyEarned', 'moneySpent']);

/** Úspěšnost v procentech s jedním desetinným místem („33,3 %“). */
export function rateText(played: number, won: number): string {
  return t('meta.stats.rate', { n: Math.round(winRate(played, won) * 1000) / 10 });
}

function row(label: string, value: string | Node, testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'stat-row' },
    h('dt', { class: 'stat-row__label' }, label),
    h('dd', { class: 'stat-row__value', 'data-testid': testId }, value),
  );
}

function section(id: string, title: string, ...children: (Node | null)[]): HTMLElement {
  return h(
    'section',
    { class: ['stats-section', 'paper', `stats-section--${id}`], 'aria-labelledby': id },
    h('h2', { id, class: 'stats-section__title' }, title),
    children,
  );
}

const none = (): string => t('meta.stats.overview.none');

/** Příčina prohry (`small` / `big` / id šéfa) jako název. */
export function causeName(cause: string, registry: ContentRegistry): string {
  if (cause === 'small' || cause === 'big') return t(`meta.stats.losses.${cause}`);
  return registry.bosses[cause] ? bossName(cause) : cause;
}

// ─────────────────────────── Přehled ───────────────────────────

function overview(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement[] {
  const s = profile.stats;
  const r = s.records;
  const best = s.bestHand;
  const fav = topEntry(s.handTypes);
  const favJoker = topEntry(s.jokerRounds);
  const bought = topEntry(s.jokerBuys);
  const deadly = topEntry(s.losses);
  const achievements = achievementList(registry);
  const earned = achievements.filter((a) => profile.achievements.unlocked[a.id] !== undefined).length;

  const bestHand = best
    ? h(
        'span',
        { class: 'stat-best' },
        t('meta.stats.overview.bestHandValue', {
          score: best.score,
          hand: best.handType ? handName(best.handType) : none(),
        }),
        best.seed
          ? h(
              'span',
              { class: 'stat-best__seed' },
              h('code', { 'data-testid': 'stats-best-seed' }, best.seed),
              button({
                label: t('meta.history.copySeed'),
                ariaLabel: t('meta.stats.overview.copySeed'),
                variant: 'ghost',
                size: 'small',
                testId: 'stats-best-copy',
                onClick: () => void copySeed(best.seed),
              }),
            )
          : null,
      )
    : none();

  return [
    section(
      'stats-runs',
      t('meta.stats.overview.runs'),
      h(
        'dl',
        { class: 'stat-list' },
        row(t('meta.stats.overview.played'), formatNumber(s.runs.played), 'stats-played'),
        row(t('meta.stats.overview.won'), formatNumber(s.runs.won), 'stats-won'),
        row(t('meta.stats.overview.lost'), formatNumber(s.runs.lost)),
        row(t('meta.stats.overview.abandoned'), formatNumber(s.runs.abandoned)),
        row(t('meta.stats.overview.winRate'), rateText(s.runs.played, s.runs.won), 'stats-rate'),
        row(
          t('meta.stats.overview.streak'),
          t('meta.stats.overview.streakValue', { current: s.runs.currentStreak, best: s.runs.bestStreak }),
        ),
        row(
          t('meta.stats.overview.fastestWin'),
          s.fastestWin
            ? t('meta.stats.overview.fastestWinValue', {
                n: s.fastestWin.hands,
                deck: deckName(s.fastestWin.deckId),
              })
            : none(),
        ),
      ),
      h('p', { class: 'stats-note' }, t('meta.stats.seededNote')),
    ),
    section(
      'stats-records',
      t('meta.stats.overview.records'),
      h(
        'dl',
        { class: 'stat-list' },
        row(t('meta.stats.overview.bestHand'), bestHand, 'stats-best-hand'),
        row(
          t('meta.stats.overview.bestRound'),
          r.bestRoundScore > 0 ? formatNumber(r.bestRoundScore) : none(),
        ),
        row(t('meta.stats.overview.highestAnte'), r.highestAnte > 0 ? formatNumber(r.highestAnte) : none()),
        row(
          t('meta.stats.overview.highestEndlessAnte'),
          r.highestEndlessAnte > 0 ? formatNumber(r.highestEndlessAnte) : none(),
        ),
      ),
    ),
    section(
      'stats-favourites',
      t('meta.stats.overview.favourites'),
      h(
        'dl',
        { class: 'stat-list' },
        row(
          t('meta.stats.overview.favouriteHand'),
          fav
            ? t('meta.stats.overview.favouriteHandValue', { hand: handName(fav.id), n: fav.value })
            : none(),
        ),
        row(
          t('meta.stats.overview.favouriteJoker'),
          favJoker
            ? t('meta.stats.overview.favouriteJokerValue', {
                name: jokerName(favJoker.id),
                n: favJoker.value,
              })
            : none(),
        ),
        row(
          t('meta.stats.overview.boughtJoker'),
          bought
            ? t('meta.stats.overview.boughtJokerValue', { name: jokerName(bought.id), n: bought.value })
            : none(),
        ),
        row(
          t('meta.stats.overview.deadliest'),
          deadly
            ? t('meta.stats.overview.deadliestValue', {
                name: causeName(deadly.id, registry),
                n: deadly.value,
              })
            : none(),
        ),
        row(
          t('meta.stats.overview.challenges'),
          t('meta.stats.overview.challengesValue', {
            n: challengesCompleted(profile),
            total: Object.keys(registry.challenges).length,
          }),
        ),
        row(
          t('meta.stats.overview.achievements'),
          t('meta.stats.overview.achievementsValue', { n: earned, total: achievements.length }),
        ),
      ),
    ),
    section(
      'stats-totals',
      t('meta.stats.overview.totals'),
      h(
        'dl',
        { class: 'stat-list stat-list--compact', 'data-testid': 'stats-totals' },
        TOTAL_STAT_KEYS.map((k) =>
          row(
            t(`meta.stats.totals.${k}`),
            MONEY_TOTALS.has(k) ? formatMoney(s.totals[k]) : formatNumber(s.totals[k]),
          ),
        ),
      ),
    ),
  ];
}

// ─────────────────────────── Tabulky ───────────────────────────

function table(caption: string, head: string[], rows: (string | Node)[][], testId: string): HTMLElement {
  return h(
    'div',
    { class: 'stats-table-wrap' },
    h(
      'table',
      { class: 'stats-table', 'data-testid': testId },
      h('caption', { class: 'visually-hidden' }, caption),
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          head.map((label, i) => h('th', { scope: 'col', class: i === 0 ? 'is-name' : 'is-num' }, label)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((cells) =>
          h(
            'tr',
            null,
            cells.map((c, i) =>
              i === 0 ? h('th', { scope: 'row', class: 'is-name' }, c) : h('td', { class: 'is-num' }, c),
            ),
          ),
        ),
      ),
    ),
  );
}

function decksTab(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement[] {
  const s = profile.stats;
  const rows = Object.keys(registry.decks).map((id) => {
    const d = s.byDeck[id];
    return [
      deckName(id),
      formatNumber(d?.played ?? 0),
      formatNumber(d?.won ?? 0),
      rateText(d?.played ?? 0, d?.won ?? 0),
      (d?.bestStake ?? 0) > 0 ? stakeName(registry, d?.bestStake ?? 0) : none(),
    ];
  });
  return [
    section(
      'stats-decks',
      t('meta.stats.tabs.decks'),
      s.runs.played === 0 ? h('p', { class: 'stats-empty' }, t('meta.stats.emptyDecks')) : null,
      table(
        t('meta.stats.tabs.decks'),
        [
          t('meta.stats.table.name'),
          t('meta.stats.table.played'),
          t('meta.stats.table.won'),
          t('meta.stats.table.rate'),
          t('meta.stats.table.bestStake'),
        ],
        rows,
        'stats-decks-table',
      ),
    ),
  ];
}

function stakesTab(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement[] {
  const s = profile.stats;
  const rows = Object.values(registry.stakes)
    .sort((a, b) => a.level - b.level)
    .map((stake) => {
      const w = s.byStake[String(stake.level)];
      return [
        stakeName(registry, stake.level),
        formatNumber(w?.played ?? 0),
        formatNumber(w?.won ?? 0),
        rateText(w?.played ?? 0, w?.won ?? 0),
      ];
    });
  return [
    section(
      'stats-stakes',
      t('meta.stats.tabs.stakes'),
      table(
        t('meta.stats.tabs.stakes'),
        [
          t('meta.stats.table.name'),
          t('meta.stats.table.played'),
          t('meta.stats.table.won'),
          t('meta.stats.table.rate'),
        ],
        rows,
        'stats-stakes-table',
      ),
    ),
  ];
}

function bossesTab(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement[] {
  const s = profile.stats;
  const met = new Set(profile.discovered.bosses);
  const rows = Object.keys(registry.bosses).map((id) => {
    const b = s.bosses[id];
    const known = met.has(id) || (b?.defeated ?? 0) + (b?.lostTo ?? 0) > 0;
    return [
      known ? bossName(id) : t('meta.stats.table.unknownBoss'),
      formatNumber(b?.defeated ?? 0),
      formatNumber(b?.lostTo ?? 0),
    ];
  });
  const losses = Object.entries(s.losses)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    section(
      'stats-losses',
      t('meta.stats.losses.title'),
      losses.length === 0
        ? h('p', { class: 'stats-empty' }, t('meta.stats.losses.none'))
        : h(
            'dl',
            { class: 'stat-list', 'data-testid': 'stats-losses' },
            losses.map(([cause, n]) => row(causeName(cause, registry), t('meta.stats.losses.value', { n }))),
          ),
    ),
    section(
      'stats-bosses',
      t('meta.stats.tabs.bosses'),
      met.size === 0 ? h('p', { class: 'stats-empty' }, t('meta.stats.emptyBosses')) : null,
      table(
        t('meta.stats.tabs.bosses'),
        [t('meta.stats.table.name'), t('meta.stats.table.defeated'), t('meta.stats.table.lostTo')],
        rows,
        'stats-bosses-table',
      ),
    ),
  ];
}

// ─────────────────────────── Historie ───────────────────────────

function modeText(e: HistoryEntry): string {
  if (e.mode === 'challenge' && e.challengeId)
    return t('meta.history.mode.challenge', { name: challengeName(e.challengeId) });
  if (e.mode === 'daily')
    return t(e.official ? 'meta.history.mode.daily' : 'meta.history.mode.dailyUnofficial');
  return t('meta.history.mode.normal');
}

export function historyItem(e: HistoryEntry, registry: ContentRegistry): HTMLElement {
  const best =
    e.bestHandType !== null
      ? t('meta.history.bestHandType', { score: e.bestHand, hand: handName(e.bestHandType) })
      : t('meta.history.bestHand', { score: e.bestHand });
  return h(
    'li',
    {
      class: ['history-item', 'paper', `is-${e.outcome}`],
      'data-testid': `history-${e.no}`,
      'data-outcome': e.outcome,
    },
    h(
      'div',
      { class: 'history-item__head' },
      h('strong', { class: 'history-item__outcome' }, t(`meta.history.outcome.${e.outcome}`)),
      h('span', { class: 'history-item__no' }, t('meta.history.run', { no: e.no })),
      h(
        'time',
        { class: 'history-item__date', datetime: e.finishedAt || e.startedAt },
        formatDateTime(e.finishedAt || e.startedAt),
      ),
    ),
    h(
      'p',
      { class: 'history-item__meta' },
      [deckName(e.deckId), stakeName(registry, e.stake), modeText(e)].join(' · '),
      e.seeded && e.mode !== 'daily'
        ? h('span', { class: 'history-item__tag' }, t('meta.history.seeded'))
        : null,
    ),
    h(
      'p',
      { class: 'history-item__line' },
      [
        t(e.endless ? 'meta.history.anteEndless' : 'meta.history.ante', { ante: e.ante }),
        best,
        t('meta.history.hands', { n: e.handsPlayed }),
      ].join(' · '),
    ),
    e.cause
      ? h(
          'p',
          { class: 'history-item__line' },
          t('meta.history.cause', { name: causeName(e.cause, registry) }),
        )
      : null,
    h(
      'p',
      { class: 'history-item__line history-item__jokers' },
      e.jokers.length > 0
        ? t('meta.history.jokers', { names: e.jokers.map(jokerName).join(', ') })
        : t('meta.history.noJokers'),
    ),
    h(
      'div',
      { class: 'history-item__seed' },
      h('span', { class: 'history-item__seed-label' }, t('meta.history.seed')),
      h('code', { class: 'history-item__seed-value' }, e.seed),
      button({
        label: t('meta.history.copySeed'),
        ariaLabel: t('meta.history.copySeedLabel', { seed: e.seed }),
        variant: 'ghost',
        size: 'small',
        testId: `history-copy-${e.no}`,
        onClick: () => void copySeed(e.seed),
      }),
    ),
  );
}

function historyTab(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement[] {
  const list = profile.history;
  if (list.length === 0)
    return [h('p', { class: 'stats-empty paper', 'data-testid': 'history-empty' }, t('meta.history.empty'))];
  return [
    h(
      'h2',
      { class: 'stats-heading', id: 'stats-history-title' },
      t('meta.history.title', { n: list.length, limit: HISTORY_LIMIT }),
    ),
    h(
      'ol',
      { class: 'history-list', 'aria-labelledby': 'stats-history-title', 'data-testid': 'history-list' },
      list.map((e) => historyItem(e, registry)),
    ),
  ];
}

// ─────────────────────────── Denní runy ───────────────────────────

/** Zkopíruje výsledek denního runu a oznámí, jak to dopadlo. */
export async function copyDailyShare(text: string): Promise<void> {
  const ok = await copyText(text);
  toast(ok ? t('meta.daily.copied') : t('meta.daily.copyFailed', { text }), {
    kind: ok ? 'success' : 'warning',
    testId: 'toast-daily-share',
  });
}

function dailyTab(profile: Readonly<Profile>, registry: ContentRegistry, nowIso: string): HTMLElement[] {
  const keys = Object.keys(profile.daily).sort().reverse();
  const streak = dailyStreak(profile, nowIso);
  const bestAnte = Math.max(0, ...keys.map((k) => profile.daily[k]?.ante ?? 0));
  const summary = section(
    'stats-daily-summary',
    t('meta.daily.title'),
    h(
      'dl',
      { class: 'stat-list' },
      row(
        t('meta.daily.today'),
        t(isDailyAvailable(profile, nowIso) ? 'meta.daily.todayAvailable' : 'meta.daily.todayDone'),
        'stats-daily-today',
      ),
      row(
        t('meta.daily.streak'),
        t('meta.daily.streakValue', { current: streak.current, longest: streak.longest }),
      ),
      row(t('meta.daily.played'), formatNumber(keys.length)),
      row(t('meta.daily.best'), bestAnte > 0 ? formatNumber(bestAnte) : none()),
    ),
  );
  return [summary, dailyHistoryList(profile, registry)];
}

/** Výsledek denního runu ke sdílení („Karban DEN-20261001 · patro 7 · nejlepší ruka 1 234 560“). */
export function dailyShareText(seed: string, ante: number, bestHand: number): string {
  return t('meta.daily.share', { seed, ante, score: bestHand });
}

/** Seznam oficiálních denních pokusů od nejnovějšího (statistiky i obrazovka Denní run). */
export function dailyHistoryList(profile: Readonly<Profile>, registry: ContentRegistry): HTMLElement {
  const keys = Object.keys(profile.daily).sort().reverse();
  if (keys.length === 0)
    return h('p', { class: 'stats-empty paper', 'data-testid': 'daily-empty' }, t('meta.daily.empty'));
  return h(
    'ol',
    { class: 'history-list', 'aria-label': t('meta.daily.title'), 'data-testid': 'daily-list' },
    keys.map((key) => {
      const d = profile.daily[key]!;
      const status = d.status === 'playing' ? 'playing' : (d.outcome ?? 'abandoned');
      const share = dailyShareText(d.seed, d.ante, d.bestHand);
      return h(
        'li',
        { class: ['history-item', 'paper', `is-${status}`], 'data-testid': `daily-${key}` },
        h(
          'div',
          { class: 'history-item__head' },
          h('strong', { class: 'history-item__outcome' }, t(`meta.daily.status.${status}`)),
          h('time', { class: 'history-item__date', datetime: key }, formatDateKey(key)),
        ),
        h(
          'p',
          { class: 'history-item__meta' },
          [deckName(d.deckId), stakeName(registry, d.stake), d.seed].join(' · '),
        ),
        h('p', { class: 'history-item__line' }, t('meta.daily.entry', { ante: d.ante, score: d.bestHand })),
        d.status === 'finished'
          ? h(
              'div',
              { class: 'history-item__seed' },
              h('code', { class: 'history-item__seed-value' }, share),
              button({
                label: t('meta.daily.copyShare'),
                ariaLabel: t('meta.daily.copyShareLabel', { date: formatDateKey(key) }),
                variant: 'ghost',
                size: 'small',
                testId: `daily-copy-${key}`,
                onClick: () => void copyDailyShare(share),
              }),
            )
          : null,
      );
    }),
  );
}

// ─────────────────────────── Obrazovka ───────────────────────────

/** Obsah záložky statistik (čistě z profilu). */
export function statsTabContent(
  tab: StatsTab,
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  nowIso: string = new Date().toISOString(),
): HTMLElement[] {
  switch (tab) {
    case 'overview':
      return overview(profile, registry);
    case 'decks':
      return decksTab(profile, registry);
    case 'stakes':
      return stakesTab(profile, registry);
    case 'bosses':
      return bossesTab(profile, registry);
    case 'history':
      return historyTab(profile, registry);
    case 'daily':
      return dailyTab(profile, registry, nowIso);
  }
}

export const statsScreen: ScreenFactory = (app: App, params) => {
  const initial =
    typeof params?.tab === 'string' && (STATS_TABS as readonly string[]).includes(params.tab)
      ? (params.tab as StatsTab)
      : 'overview';
  const tabs = createTabs({
    label: t('meta.stats.tabsLabel'),
    idPrefix: 'stats',
    tabs: STATS_TABS.map((id) => ({ id, label: t(`meta.stats.tabs.${id}`) })),
    initial,
    onChange: (id, panel) => {
      panel.replaceChildren(
        h(
          'div',
          { class: ['stats-body', `stats-body--${id}`] },
          statsTabContent(id as StatsTab, app.profile, app.registry),
        ),
      );
    },
  });
  const el = h(
    'main',
    { class: 'screen stats', 'aria-labelledby': 'stats-title', 'data-testid': 'stats' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'stats-title', class: 'screen-title' }, t('meta.stats.title')),
        h('p', { class: 'screen-subtitle' }, t('meta.stats.subtitle')),
      ),
    ),
    tabs.el,
  );
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
