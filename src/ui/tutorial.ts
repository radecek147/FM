/**
 * Tutoriál „Štamgast“ (DESIGN 13.5): při prvních runech radí Štamgast bublinami navázanými na skutečný stav
 * a události hry — výběr karet a živý náhled, Zahrát a pořadí skórování, Zahodit, cíl a ruce, konec kola a úrok,
 * Večerka a koupě žolíka, pořadí žolíků, šéf a jeho pravidlo, přeskočení útraty.
 *
 *  - Bublina **neblokuje hru**: není modální, nebere focus, je mimo #app (vrstva pod dialogy a nad jevištěm),
 *    kliknout jde jen na ni samotnou; během animací a mimo herní obrazovku zmizí.
 *  - Krok se dokončí tlačítkem „Rozumím“ nebo sám příslušnou akcí (výběr karty, zahraná ruka, zahození, výplata,
 *    koupě žolíka, přeskočení útraty, poražený šéf). „Přeskočit tutoriál“ ho vypne celý (`skipTutorial`).
 *  - Stav je v profilu (`Profile.tutorial`, rady `Settings.tutorial`); dokončení všech kroků přepočítá meta vrstvu
 *    (`profiles.refresh`) → achievement „Štamgastův žák“.
 *  - V e2e testech se vypne parametrem `?tutorial=off` (src/main.ts ho pak vůbec nenainstaluje) nebo profilem.
 */
import './styles/tutorial.css';
import type { GameEvent, RunState } from '../engine';
import type { Profile, TutorialStepId } from '../engine/meta';
import { TUTORIAL_STEPS, markTutorialStep, skipTutorial, tutorialActive } from '../engine/meta';
import { t } from '../i18n/cs';
import type { App } from './app';
import { stamgastElement, stamgastMarkup } from './art/stamgast';
import { button } from './components/button';
import { toast } from './components/toast';
import type { GameController } from './controller';
import { h } from './dom';

/** Stav hry, který tutoriál potřebuje k výběru kroku (čistá data — testy). */
export interface TutorialView {
  /** Počet vybraných karet v ruce. */
  selected: number;
  /** Jde aktuální útratu přeskočit (`Modifiers.noSkip` ne)? */
  canSkip: boolean;
}

/**
 * Krok, který se má teď ukázat (nebo null). Čistá funkce: aktivní tutoriál, krok ještě neviděný a stav hry, ve
 * kterém dává smysl. Šéf a přeskočení přijdou, až nastanou; přeskočení až po prvním vyhraném kole (nejdřív se hraje).
 */
export function pendingTutorialStep(
  profile: Readonly<Profile>,
  s: Readonly<RunState>,
  view: TutorialView,
): TutorialStepId | null {
  if (!tutorialActive(profile)) return null;
  const seen = (id: TutorialStepId): boolean => profile.tutorial.seen.includes(id);
  const pending = (id: TutorialStepId): boolean => !seen(id);
  // Pořadí žolíků až v kole (bublina pod řadou žolíků nad prázdným stolem nic nezakryje).
  const jokerOrder = s.jokers.length > 0 && pending('jokerOrder');
  switch (s.phase) {
    case 'round': {
      const r = s.round;
      if (!r) return null;
      if (r.blind === 'boss' && pending('boss')) return 'boss';
      if (pending('select')) return view.selected === 0 ? 'select' : null;
      if (pending('play')) return view.selected > 0 ? 'play' : null;
      if (pending('discard') && r.discardsLeft > 0) return 'discard';
      if (pending('goal')) return 'goal';
      return jokerOrder ? 'jokerOrder' : null;
    }
    case 'round_end':
      return pending('roundEnd') ? 'roundEnd' : null;
    case 'shop':
      return pending('shop') ? 'shop' : null;
    case 'blind_select': {
      const slot = s.blinds[s.blindIndex];
      if (!slot) return null;
      if (slot.kind === 'boss' && pending('boss')) return 'boss';
      if (slot.kind !== 'boss' && view.canSkip && pending('skip') && seen('roundEnd')) return 'skip';
      return null;
    }
    default:
      return null;
  }
}

/** Kroky, které události akce dokončí samy (hráč to právě udělal). */
export function stepsDoneByEvents(events: readonly GameEvent[]): TutorialStepId[] {
  const out = new Set<TutorialStepId>();
  for (const e of events) {
    if (e.type === 'handPlayed') out.add('select').add('play');
    else if (e.type === 'cardsDiscarded') out.add('discard');
    else if (e.type === 'roundWon') out.add('goal');
    else if (e.type === 'cashedOut') out.add('roundEnd');
    else if (e.type === 'itemBought' && e.kind === 'joker') out.add('shop');
    else if (e.type === 'blindSkipped') out.add('skip');
    else if (e.type === 'bossDefeated') out.add('boss');
  }
  return [...out];
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Obdélník v souřadnicích okna. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface StepTarget {
  /** Selektory cíle bubliny v pořadí (první viditelný vyhraje) — cíl se zvýrazní rámečkem. */
  selectors: string[];
  /** Pořadí stran u cíle, kam bublinu zkusit dát. */
  placements: Placement[];
  /**
   * Další místa, kam bublinu dát, když by u cíle zakryla ovládání (Zahrát → nad ruku, ne přes karty; pořadí žolíků
   * ve Večerce → pod regály): selektor a strany.
   */
  fallbacks?: { selector: string; placements: Placement[] }[];
}

const HAND = '[data-testid="hand"]';

/** Kam bublina kroku ukazuje (podle fáze — šéf v kole ukazuje na levý panel, ve výběru útraty na kartu šéfa). */
function stepTarget(step: TutorialStepId, phase: RunState['phase']): StepTarget {
  switch (step) {
    case 'select':
      return { selectors: [HAND], placements: ['top', 'right'] };
    case 'play':
      return {
        selectors: ['[data-testid="play"]'],
        placements: ['top', 'right', 'left'],
        fallbacks: [{ selector: HAND, placements: ['top'] }],
      };
    case 'discard':
      return {
        selectors: ['[data-testid="discard"]'],
        placements: ['top', 'left', 'right'],
        fallbacks: [{ selector: HAND, placements: ['top'] }],
      };
    case 'goal':
      return { selectors: ['.gs-target', '[data-testid="round-target"]'], placements: ['right', 'bottom'] };
    case 'roundEnd':
      return {
        selectors: ['[data-testid="round-end"] .round-end__lines', '[data-testid="round-end"]'],
        placements: ['right', 'left', 'top', 'bottom'],
      };
    case 'shop':
      return {
        selectors: ['[data-testid="shop"] .shop-section--items', '[data-testid="shop"] .shop__shelves'],
        placements: ['bottom', 'right', 'left', 'top'],
      };
    case 'jokerOrder':
      return {
        selectors: ['[data-testid="joker-row"]'],
        placements: ['bottom'],
        fallbacks: [{ selector: HAND, placements: ['top'] }],
      };
    case 'boss':
      return phase === 'blind_select'
        ? { selectors: ['[data-testid="blind-boss"]'], placements: ['left', 'bottom', 'top', 'right'] }
        : { selectors: ['.gs-blind', '[data-testid="blind-rule"]'], placements: ['right', 'bottom'] };
    case 'skip':
      return {
        selectors: ['[data-testid="blind-skip-small"]', '[data-testid="blind-skip-big"]'],
        placements: ['bottom', 'top', 'right', 'left'],
      };
  }
}

/** Odstup bubliny od cíle a od okraje okna (px). */
const GAP = 14;
const MARGIN = 8;
/** Ovládací prvky, které bublina nemá zakrývat (karty v ruce, tlačítka, žolíci…). */
const OBSTACLES =
  '#app button, #app [role="button"], #app [role="radio"], #app .pcard, #app input, #app .kcard';

function firstVisible(selectors: readonly string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface BubblePlacement {
  x: number;
  y: number;
  /** Strana, na které je šipka (null = bez šipky). */
  side: Placement | null;
  /** Poloha šipky podél hrany bubliny (px). */
  arrow: number;
}

/**
 * Umístění bubliny `w × h`: kandidáti u cíle (strany v pořadí, zarovnání na střed / kraje) a u záložních míst;
 * vyhraje ten, který celý leží v okně a nejmíň zakrývá ovládací prvky (`obstacles`) a cíl — při shodě dřívější.
 * Šipka míří na střed cíle, když na něj z dané strany dosáhne. Nic se nevejde → pravý dolní roh okna bez šipky.
 * Čistá funkce (testy).
 */
export function placeBubble(
  target: Box | null,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  order: readonly Placement[],
  opts: {
    obstacles?: readonly Box[];
    fallbacks?: readonly { box: Box; placements: readonly Placement[] }[];
  } = {},
): BubblePlacement {
  const { w, h: bh } = size;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const corner: BubblePlacement = {
    x: Math.max(MARGIN, viewport.w - w - MARGIN),
    y: Math.max(MARGIN, viewport.h - bh - MARGIN),
    side: null,
    arrow: 0,
  };
  if (!target) return corner;
  const cx = (target.left + target.right) / 2;
  const cy = (target.top + target.bottom) / 2;
  const anchors = [{ box: target, placements: order }, ...(opts.fallbacks ?? [])];
  let best: { p: BubblePlacement; score: number } | null = null;
  let rank = 0;
  for (const anchor of anchors) {
    const a = anchor.box;
    for (const side of anchor.placements) {
      const xs: number[] = [];
      const ys: number[] = [];
      if (side === 'top' || side === 'bottom') {
        ys.push(
          side === 'top' ? Math.min(a.top, target.top) - bh - GAP : Math.max(a.bottom, target.bottom) + GAP,
        );
        xs.push(clamp(cx - w / 2, MARGIN, viewport.w - w - MARGIN), a.left, a.right - w);
      } else {
        xs.push(
          side === 'left' ? Math.min(a.left, target.left) - w - GAP : Math.max(a.right, target.right) + GAP,
        );
        ys.push(clamp(cy - bh / 2, MARGIN, viewport.h - bh - MARGIN), a.top, a.bottom - bh);
      }
      for (const y of ys) {
        for (const x of xs) {
          rank++;
          if (x < MARGIN || y < MARGIN || x + w > viewport.w - MARGIN || y + bh > viewport.h - MARGIN)
            continue;
          const box: Box = { left: x, top: y, right: x + w, bottom: y + bh };
          let score = rank * 0.01 + overlap(box, target) * 4;
          for (const o of opts.obstacles ?? []) score += overlap(box, o);
          if (best && score >= best.score) continue;
          // Šipka jen tehdy, když střed cíle leží v rozsahu hrany bubliny.
          const vertical = side === 'top' || side === 'bottom';
          const along = vertical ? cx - x : cy - y;
          const reach = vertical ? w : bh;
          const p: BubblePlacement =
            along >= 18 && along <= reach - 18
              ? { x, y, side, arrow: along }
              : { x, y, side: null, arrow: 0 };
          best = { p, score };
        }
      }
    }
  }
  return best?.p ?? corner;
}

/** Parametry textu kroku ze stavu hry. */
function stepParams(step: TutorialStepId, c: GameController): Record<string, number> {
  const s = c.state;
  const mods = c.engine.modifiers();
  switch (step) {
    case 'select':
      return { max: mods.maxSelect };
    case 'discard':
      return { n: s.round?.discardsLeft ?? 0 };
    case 'goal':
      return { target: s.round?.target ?? 0, hands: s.round?.handsLeft ?? 0 };
    case 'roundEnd':
      return { cap: mods.interestCap };
    default:
      return {};
  }
}

export class TutorialController {
  private controller: GameController | null = null;
  private unsubs: (() => void)[] = [];
  private step: TutorialStepId | null = null;
  /** Naposledy ukázaná rada (ohlášení a příchod jen při změně). */
  private lastShown: TutorialStepId | null = null;
  private readonly layer: HTMLElement;
  private readonly bubble: HTMLElement;
  /** Štamgast v bublině — překreslí se při připojení ke hře (tutoriál vzniká dřív, než dorazí ikony). */
  private readonly avatar = stamgastElement('tutorial__avatar');
  private readonly metaEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly live: HTMLElement;
  /** Zvýraznění cíle rady (rámeček, jen ozdoba). */
  private readonly ring: HTMLElement;
  private raf = 0;

  constructor(private readonly app: App) {
    this.metaEl = h('p', { class: 'tutorial__meta' });
    this.titleEl = h('p', { class: 'tutorial__title', id: 'tutorial-title' });
    this.textEl = h('p', { class: 'tutorial__text', id: 'tutorial-text' });
    const next = button({
      label: t('meta.tutorial.next'),
      ariaLabel: t('meta.tutorial.nextLabel'),
      variant: 'primary',
      size: 'small',
      testId: 'tutorial-next',
      onClick: () => this.acknowledge(),
    });
    const skip = button({
      label: t('meta.tutorial.skipAll'),
      variant: 'ghost',
      size: 'small',
      testId: 'tutorial-skip',
      onClick: () => this.skipAll(),
    });
    this.bubble = h(
      'div',
      {
        class: 'tutorial',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': 'tutorial-title',
        'aria-describedby': 'tutorial-text',
        'data-testid': 'tutorial',
        hidden: true,
      },
      h('span', { class: 'tutorial__arrow', 'aria-hidden': 'true' }),
      this.avatar,
      h(
        'div',
        { class: 'tutorial__body' },
        this.metaEl,
        this.titleEl,
        this.textEl,
        h('div', { class: 'tutorial__actions' }, next, skip),
      ),
    );
    this.live = h('p', { class: 'visually-hidden', 'aria-live': 'polite', 'data-testid': 'tutorial-live' });
    this.ring = h('div', { class: 'tutorial-ring', 'aria-hidden': 'true', hidden: true });
    this.layer = h(
      'div',
      { class: 'tutorial-layer', 'data-testid': 'tutorial-layer' },
      this.ring,
      this.bubble,
      this.live,
    );
    document.body.appendChild(this.layer);

    const reposition = (): void => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.position();
      });
    };
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    app.onScreenChange((id) => {
      this.detach();
      if (id === 'game' && app.controller) this.attach(app.controller);
      else this.hide();
    });
  }

  /** Zobrazený krok (null = žádná bublina). */
  get currentStep(): TutorialStepId | null {
    return this.step;
  }

  /** Přepočítá bublinu (po změně nastavení, restartu tutoriálu). */
  refresh(): void {
    this.update();
  }

  private attach(c: GameController): void {
    this.avatar.innerHTML = stamgastMarkup();
    this.controller = c;
    this.lastShown = null;
    this.unsubs.push(
      c.subscribe(() => this.update()),
      c.onEvents((events) => this.onEvents(events)),
    );
    this.update();
  }

  private detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.controller = null;
  }

  private get profile(): Profile {
    return this.app.profile;
  }

  /** Označí kroky hotové; po posledním přepočítá meta vrstvu (achievement). Uloží profil. */
  private mark(steps: readonly TutorialStepId[]): void {
    if (!tutorialActive(this.profile)) return;
    let changed = false;
    let completed = false;
    for (const step of steps) {
      if (this.profile.tutorial.seen.includes(step)) continue;
      changed = true;
      if (markTutorialStep(this.profile, step)) completed = true;
    }
    if (!changed) return;
    if (completed) this.app.profiles.refresh();
    else this.app.profiles.save();
  }

  private onEvents(events: readonly GameEvent[]): void {
    // Během animací akce bublina zmizí; po nich ji vrátí `update` (controller.notify).
    this.hide();
    this.mark(stepsDoneByEvents(events));
  }

  private acknowledge(): void {
    if (this.step) this.mark([this.step]);
    this.update();
    // Focus z odebraného tlačítka zpět do hry (ne na <body>).
    if (this.bubble.hidden && this.bubble.contains(document.activeElement))
      document.querySelector<HTMLElement>('#app [data-autofocus]:not(:disabled), #app h1')?.focus();
  }

  private skipAll(): void {
    skipTutorial(this.profile);
    this.app.profiles.save();
    this.hide();
    document.querySelector<HTMLElement>('#app [data-autofocus]:not(:disabled), #app h1')?.focus();
    toast(t('meta.tutorial.skipped'), { kind: 'info', testId: 'toast-tutorial-skipped' });
  }

  private update(): void {
    const c = this.controller;
    if (!c || c.busy || this.app.screenId !== 'game') {
      this.hide();
      return;
    }
    const s = c.state;
    // Hráč vybral kartu dřív, než si radu přečetl — výběr umí.
    if (s.phase === 'round' && c.selected.length > 0 && !this.profile.tutorial.seen.includes('select'))
      this.mark(['select']);
    const step = pendingTutorialStep(this.profile, s, {
      selected: c.selected.length,
      canSkip: !c.engine.modifiers().noSkip,
    });
    if (!step) {
      this.hide();
      return;
    }
    if (step !== this.step || this.bubble.hidden) this.show(step, c);
    else this.position();
  }

  private show(step: TutorialStepId, c: GameController): void {
    // Stejná rada po animaci akce se znovu neohlašuje ani nepřijíždí (čtečka by ji opakovala po každém tahu).
    const fresh = step !== this.lastShown;
    this.lastShown = step;
    this.step = step;
    const title = t(`meta.tutorial.steps.${step}.title`);
    const text = t(`meta.tutorial.steps.${step}.text`, stepParams(step, c));
    this.metaEl.textContent = `${t('meta.tutorial.name')} · ${t('meta.tutorial.step', {
      n: TUTORIAL_STEPS.indexOf(step) + 1,
      total: TUTORIAL_STEPS.length,
    })}`;
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    this.bubble.dataset.step = step;
    this.bubble.hidden = false;
    this.position();
    if (fresh) {
      this.live.textContent = `${t('meta.tutorial.label', { title })}. ${text}`;
      this.bubble.classList.remove('is-entering');
      if (!document.documentElement.classList.contains('no-anim')) {
        void this.bubble.offsetWidth;
        this.bubble.classList.add('is-entering');
      }
    }
  }

  /** Umístí bublinu (jedno měření layoutu; volá se při změně kroku, překreslení, scrollu a změně okna). */
  private position(): void {
    const c = this.controller;
    if (!c || !this.step || this.bubble.hidden) return;
    const target = stepTarget(this.step, c.state.phase);
    const el = firstVisible(target.selectors);
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const size = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const inView = (r: DOMRect): boolean =>
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    const obstacles = [...document.querySelectorAll<HTMLElement>(OBSTACLES)]
      .map((o) => o.getBoundingClientRect())
      .filter(inView);
    const fallbacks = (target.fallbacks ?? []).flatMap((f) => {
      const box = firstVisible([f.selector])?.getBoundingClientRect();
      return box && inView(box) ? [{ box, placements: f.placements }] : [];
    });
    const rect = el?.getBoundingClientRect() ?? null;
    const p = placeBubble(rect, size, { w: vw, h: vh }, target.placements, { obstacles, fallbacks });
    this.bubble.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    this.bubble.dataset.side = p.side ?? 'none';
    this.bubble.style.setProperty('--arrow', `${Math.round(p.arrow)}px`);
    // Rámeček kolem cíle (bublina nemusí stát hned u něj).
    if (rect && inView(rect)) {
      this.ring.hidden = false;
      this.ring.style.transform = `translate(${Math.round(rect.left - 4)}px, ${Math.round(rect.top - 4)}px)`;
      this.ring.style.width = `${Math.round(rect.width + 8)}px`;
      this.ring.style.height = `${Math.round(rect.height + 8)}px`;
    } else {
      this.ring.hidden = true;
    }
  }

  private hide(): void {
    this.ring.hidden = true;
    if (this.bubble.hidden) return;
    this.bubble.hidden = true;
    this.step = null;
  }
}

/** Nainstaluje tutoriál do aplikace (src/main.ts; s `?tutorial=off` se neinstaluje vůbec). */
export function installTutorial(app: App): TutorialController {
  const tutorial = new TutorialController(app);
  app.tutorial = tutorial;
  return tutorial;
}
