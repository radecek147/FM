/**
 * Oznámení meta vrstvy (DESIGN 11.3): toasty „Odemčeno / Achievement“ s ikonou, názvem a popisem a jejich fronta —
 * nejvýš `META_TOASTS_VISIBLE` naráz, další čekají, až předchozí odejde (oznámení nikdy nepřekryje ovládání:
 * toasty jsou mimo ruku a tlačítka a kliknutí jimi propadne, src/ui/components/toast.ts); přebytek nad
 * `MAX_NOTICE_QUEUE` shrne jedno „…a další novinky“. Navíc souhrn novinek runu pro pitvu a výhru.
 */
import type { ContentRegistry } from '../engine';
import type { MetaNotice } from '../engine/meta';
import { hasKey, t } from '../i18n/cs';
import { iconElement } from './art/icons';
import { toast } from './components/toast';
import { h } from './dom';
import { achievementName, deckName, stakeName, unlockSubjectName } from './metaText';

/** Kolik oznámení meta vrstvy visí naráz (zbytek čeká ve frontě). */
export const META_TOASTS_VISIBLE = 2;
/** Nejdelší fronta — co se nevejde, shrne jedno oznámení „…a další novinky“. */
export const MAX_NOTICE_QUEUE = 8;
/** Doba zobrazení oznámení meta vrstvy (ms) — popis achievementu se musí stihnout přečíst. */
export const META_TOAST_DURATION = 5500;

/** Co oznámení ukáže: štítek nad nadpisem, název, popis a ikona (název z `ICON_NAMES`). */
export interface NoticeView {
  kind: MetaNotice['kind'];
  eyebrow: string;
  title: string;
  text: string;
  icon: string;
}

/** Klíč oznámení (stejná novinka se v souhrnu neukáže dvakrát). */
export function noticeKey(n: MetaNotice): string {
  switch (n.kind) {
    case 'unlock':
      return `unlock:${n.category}:${n.id}`;
    case 'stake':
      return `stake:${n.deckId}:${n.stake}`;
    case 'achievement':
      return `achievement:${n.id}`;
  }
}

/** Oznámení bez opakování (pořadí podle prvního výskytu). */
export function uniqueNotices(list: readonly MetaNotice[]): MetaNotice[] {
  const seen = new Set<string>();
  const out: MetaNotice[] = [];
  for (const n of list) {
    const key = noticeKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** Popis achievementu s čísly z `params` (prázdný, když text chybí). */
export function achievementDesc(id: string, registry: ContentRegistry): string {
  const key = `achievements.${id}.desc`;
  return hasKey(key) ? t(key, registry.achievements?.[id]?.params ?? {}) : '';
}

function unlockIcon(n: Extract<MetaNotice, { kind: 'unlock' }>, registry: ContentRegistry): string {
  switch (n.category) {
    case 'decks':
      return registry.decks[n.id]?.art.icon ?? 'card-random';
    case 'jokers':
      return registry.jokers[n.id]?.art.icon ?? 'jester-hat';
    case 'vouchers':
      return registry.vouchers[n.id]?.art.icon ?? 'ticket';
    case 'challenges':
      return registry.challenges[n.id]?.art.icon ?? 'stars-stack';
  }
}

/** Texty a ikona oznámení. */
export function noticeView(n: MetaNotice, registry: ContentRegistry): NoticeView {
  switch (n.kind) {
    case 'achievement':
      return {
        kind: n.kind,
        eyebrow: t('meta.notice.eyebrow.achievement'),
        title: achievementName(n.id),
        text: achievementDesc(n.id, registry),
        icon: registry.achievements?.[n.id]?.icon ?? 'trophy',
      };
    case 'unlock':
      return {
        kind: n.kind,
        eyebrow: t(`meta.notice.eyebrow.${n.category}`),
        title: unlockSubjectName(n.category, n.id),
        text: t(`meta.notice.hint.${n.category}`),
        icon: unlockIcon(n, registry),
      };
    case 'stake': {
      const stake = Object.values(registry.stakes).find((s) => s.level === n.stake);
      return {
        kind: n.kind,
        eyebrow: t('meta.notice.eyebrow.stake'),
        title: stakeName(registry, n.stake),
        text: t('meta.notice.hint.stake', { deck: deckName(n.deckId) }),
        icon: stake?.art.icon ?? 'beer-stein',
      };
    }
  }
}

/** Ikona oznámení na kulatém tácku (dekorativní — text oznámení stačí sám). */
export function noticeIcon(view: Pick<NoticeView, 'kind' | 'icon'>, className = 'meta-icon'): HTMLElement {
  return h(
    'span',
    { class: [className, `${className}--${view.kind}`], 'aria-hidden': 'true' },
    iconElement(view.icon),
  );
}

/** Ukáže jedno oznámení jako toast; `onClose` se zavolá, až odejde. */
export function showNoticeToast(n: MetaNotice, registry: ContentRegistry, onClose?: () => void): void {
  const view = noticeView(n, registry);
  toast(view.text || view.title, {
    kind: 'success',
    title: view.title,
    eyebrow: view.eyebrow,
    media: noticeIcon(view),
    duration: META_TOAST_DURATION,
    testId: n.kind === 'achievement' ? 'toast-achievement' : 'toast-unlock',
    className: `toast--meta toast--meta-${n.kind}`,
    onClose,
  });
}

type ShowFn = (n: MetaNotice, registry: ContentRegistry, onClose: () => void) => void;

/**
 * Fronta oznámení: nejvýš `META_TOASTS_VISIBLE` naráz, další přijde, až některé odejde. Do fronty se vejde
 * `MAX_NOTICE_QUEUE` oznámení, zbytek shrne jedno „…a další novinky“ (počet se sčítá).
 */
export class NoticeQueue {
  private queue: MetaNotice[] = [];
  private overflow = 0;
  private visible = 0;
  /** Zvyšuje se při `clear` — oznámení z dřívějška pak frontu neposouvají. */
  private generation = 0;

  constructor(
    private readonly registry: ContentRegistry,
    private readonly show: ShowFn = showNoticeToast,
  ) {}

  /** Počet čekajících oznámení (bez viditelných). */
  get pending(): number {
    return this.queue.length + this.overflow;
  }

  push(notices: readonly MetaNotice[]): void {
    for (const n of notices) {
      if (this.queue.length >= MAX_NOTICE_QUEUE) this.overflow++;
      else this.queue.push(n);
    }
    this.pump();
  }

  /** Zahodí čekající oznámení (reset profilu, import). Viditelná dojdou sama. */
  clear(): void {
    this.queue = [];
    this.overflow = 0;
    this.visible = 0;
    this.generation++;
  }

  private pump(): void {
    while (this.visible < META_TOASTS_VISIBLE && this.pending > 0) {
      const gen = this.generation;
      let closed = false;
      const onClose = (): void => {
        if (closed || gen !== this.generation) return;
        closed = true;
        this.visible--;
        this.pump();
      };
      this.visible++;
      const next = this.queue.shift();
      if (next) {
        this.show(next, this.registry, onClose);
      } else {
        const n = this.overflow;
        this.overflow = 0;
        toast(t('meta.notice.more', { n }), {
          kind: 'success',
          testId: 'toast-meta-more',
          className: 'toast--meta',
          onClose,
        });
      }
    }
  }
}

// ─────────────────────────── Novinky runu (pitva, výhra) ───────────────────────────

/**
 * Souhrn novinek z dohraného runu: odemčené balíčky, žolíci, kupóny, výzvy, síly piva a achievementy. `counted`
 * = run se počítal do odemykání (seedovaný run a denní run mimo soutěž ne — pak poznámka, i když run dal
 * achievement, který smí i nezapočítaný run: „Semínko zaseto“).
 */
export function runNoveltiesBlock(
  notices: readonly MetaNotice[],
  registry: ContentRegistry,
  counted: boolean,
): HTMLElement {
  const list = uniqueNotices(notices);
  const title = h('h3', { class: 'run-news__title', id: 'run-news-title' }, t('meta.runEnd.title'));
  const note =
    list.length === 0 || !counted
      ? h(
          'p',
          { class: 'run-news__empty', 'data-testid': 'run-news-empty' },
          t(counted ? 'meta.runEnd.empty' : 'meta.runEnd.notCounted'),
        )
      : null;
  if (list.length === 0) {
    return h(
      'section',
      { class: 'run-news', 'aria-labelledby': 'run-news-title', 'data-testid': 'run-news' },
      title,
      note,
    );
  }
  return h(
    'section',
    { class: 'run-news', 'aria-labelledby': 'run-news-title', 'data-testid': 'run-news' },
    title,
    note,
    h(
      'ul',
      { class: 'run-news__list', role: 'list' },
      list.map((n) => {
        const view = noticeView(n, registry);
        return h(
          'li',
          {
            class: ['run-news__item', `is-${n.kind}`],
            title: view.text ? `${view.eyebrow}: ${view.text}` : view.eyebrow,
            'data-testid': `run-news-${n.kind}`,
          },
          noticeIcon(view),
          h(
            'div',
            { class: 'run-news__text' },
            h('p', { class: 'run-news__eyebrow' }, view.eyebrow),
            h('p', { class: 'run-news__name' }, view.title),
            view.text ? h('p', { class: 'run-news__desc' }, view.text) : null,
          ),
        );
      }),
    ),
  );
}
