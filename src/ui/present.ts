/**
 * Presenter — přehrává události enginu na herní obrazovce (ARCHITECTURE 4, DESIGN 13.2 a 13.6).
 *
 *   controller.setPresenter(createPresenter(view));
 *
 * Engine po akci vrátí hotový stav i seznam událostí; obrazovka mezitím ještě ukazuje stav *před* akcí.
 * Presenter události přehraje jednu po druhé (zahrané karty na stůl, `ScoreStep` po jednom s bublinami
 * +čipy / +mult / ×mult / Kč, počítadla, rozdání, zahození, peníze, hlášky) a obrazovku průběžně synchronizuje
 * (`view.refresh()`); controller ji po doběhnutí překreslí ještě jednou.
 *
 * Časování jde přes `app.anim` (AnimQueue): rychlost 1×–4×, vypnuté animace i mezerník (přeskočit) — každé
 * čekání pak skončí hned a DOM se jen dorovná. Animuje se výhradně transform/opacity (Web Animations API).
 */
import type { GameEvent, HandType, ScoreResult, ScoreStep } from '../engine';
import { hasKey, t } from '../i18n/cs';
import { formatNumber } from '../i18n/format';
import type { AnimQueue } from './anim/queue';
import { updateCardView } from './components/card';
import { toast, type ToastKind } from './components/toast';
import type { GameController, Presenter } from './controller';
import { h } from './dom';
import type { Particles } from './fx/particles';

export type BubbleTone = 'chips' | 'mult' | 'xmult' | 'money' | 'message' | 'score' | 'bad';

/** Co presenter potřebuje od herní obrazovky. */
export interface PresentView {
  readonly anim: AnimQueue;
  readonly controller: GameController;
  readonly particles: Particles;
  /** Překreslí obrazovku podle aktuálního stavu enginu. */
  refresh(): void;
  /** Hrací karta podle id — nejdřív na stole, pak v ruce. */
  cardEl(id: number): HTMLElement | null;
  jokerEl(uid: number): HTMLElement | null;
  consumableEl(uid: number): HTMLElement | null;
  /** Rámeček kombinace v levém panelu (zdroj kroků `hand` a `boss`). */
  handInfoEl(): HTMLElement | null;
  /** Stůl se zahranými kartami. */
  tableEl(): HTMLElement | null;
  /** Balíček vpravo dole (odtud se rozdává). */
  deckEl(): HTMLElement | null;
  moneyEl(): HTMLElement | null;
  roundScoreEl(): HTMLElement | null;
  /** Vrstva pro bubliny (position: fixed přes obrazovku). */
  fxLayer(): HTMLElement | null;
  /** Kombinace a čipy × mult v levém panelu během skórování; null = zpět na živý náhled. */
  showScoring(s: { hand: HandType; level: number; chips: number; mult: number } | null): void;
  setChipsMult(chips: number, mult: number): void;
  setRoundScore(n: number): void;
  setMoney(n: number): void;
  /** Zatřese stolem (velké skóre), pokud to nastavení dovolí. */
  shake(): void;
  /** Hlášení pro čtečky obrazovky (živá oblast). */
  announce(text: string): void;
}

// ─────────────────────────── Pomocné animace ───────────────────────────

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** `prefers-reduced-motion`: pohybové animace (Web Animations) se vynechají, čekání zůstává podle AnimQueue. */
const reducedMotion: MediaQueryList | null =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * Web Animation (jen transform/opacity) se zohledněním rychlosti, vypnutých animací a přeskočení.
 * Prostředí bez `Element.animate` (testy) = nic.
 */
export async function animate(
  anim: AnimQueue,
  el: Element | null | undefined,
  frames: Keyframe[],
  ms: number,
  opts: { easing?: string; delay?: number } = {},
): Promise<void> {
  if (!el || anim.instant || reducedMotion?.matches || typeof (el as HTMLElement).animate !== 'function')
    return;
  const duration = anim.duration(ms);
  if (duration <= 0) return;
  const delay = anim.duration(opts.delay ?? 0);
  let a: Animation;
  try {
    a = el.animate(frames, { duration, delay, easing: opts.easing ?? EASE_OUT, fill: 'backwards' });
  } catch {
    return;
  }
  await Promise.race([a.finished.then(noop, noop), anim.wait((opts.delay ?? 0) + ms)]);
  // Přeskočení (mezerník): animace doběhne hned do konce.
  if (a.playState === 'running' || a.playState === 'paused') {
    try {
      a.finish();
    } catch {
      a.cancel();
    }
  }
}

function noop(): void {}

/** Krátké „povyskočení“ zdroje efektu. */
function pop(anim: AnimQueue, el: Element | null | undefined, scale = 1.12): Promise<void> {
  return animate(
    anim,
    el,
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: `translateY(-6px) scale(${scale})`, offset: 0.35 },
      { transform: 'translateY(0) scale(1)' },
    ],
    260,
  );
}

/** Počítadlo „tik tik“: číslo v prvku doběhne z `from` na `to`. */
export function tickNumber(
  anim: AnimQueue,
  el: Element | null | undefined,
  from: number,
  to: number,
  ms: number,
  format: (n: number) => string = formatNumber,
): Promise<void> {
  if (!el) return Promise.resolve();
  const duration = anim.duration(ms);
  if (duration <= 0 || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
    el.textContent = format(to);
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number): void => {
      const p = anim.instant ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      el.textContent = format(p >= 1 ? to : Math.floor(from + (to - from) * eased));
      if (p >= 1) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Bublina nad prvkem (+čipy, +mult, hláška…). Bez animací se nevytváří. */
export function bubble(
  view: PresentView,
  target: Element | null | undefined,
  text: string,
  tone: BubbleTone,
  opts: { offset?: number; big?: boolean } = {},
): void {
  const layer = view.fxLayer();
  if (!layer || !target || view.anim.instant || !text) return;
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + (opts.big ? r.height / 2 : 0) - (opts.offset ?? 0));
  const el = h(
    'div',
    {
      class: ['game-bubble', `game-bubble--${tone}`, opts.big ? 'game-bubble--big' : ''],
      style: { transform: `translate(${x}px, ${y}px)` },
    },
    h('span', { class: 'game-bubble__text' }, text),
  );
  layer.appendChild(el);
  const remove = (): void => el.remove();
  el.addEventListener('animationend', remove, { once: true });
  // Pojistka (vypnuté CSS animace, přeskočení): bublina zmizí nejpozději po 2 s.
  window.setTimeout(remove, 2000);
}

/** Text hlášky z i18n klíče, nebo null (neznámý klíč nesmí do konzole sypat varování). */
function messageText(key: string | undefined, params?: Record<string, string | number>): string | null {
  if (!key || !hasKey(key)) return null;
  return t(key, params);
}

function say(message: string, kind: ToastKind = 'info'): void {
  toast(message, { kind, testId: `toast-game-${kind}` });
}

// ─────────────────────────── Skórování ───────────────────────────

/** Délka jednoho kroku skórování (ms při rychlosti 1×) — dlouhé řetězy se zrychlují. */
export function stepDuration(steps: number): number {
  return Math.max(150, Math.min(380, 520 - steps * 15));
}

function stepTarget(view: PresentView, step: ScoreStep): Element | null {
  if (step.source === 'joker' && step.jokerUid !== undefined) return view.jokerEl(step.jokerUid);
  if ((step.source === 'card' || step.source === 'held') && step.cardId !== undefined)
    return view.cardEl(step.cardId);
  return view.handInfoEl();
}

async function presentStep(view: PresentView, step: ScoreStep, per: number, money: { value: number }) {
  const anim = view.anim;
  if (step.source === 'hand') {
    view.setChipsMult(step.chipsAfter, step.multAfter);
    void pop(anim, view.handInfoEl(), 1.05);
    await anim.wait(per);
    return;
  }
  const target = stepTarget(view, step);
  void pop(anim, target);
  let offset = 0;
  const add = (text: string, tone: BubbleTone): void => {
    bubble(view, target, text, tone, { offset });
    offset += 26;
  };
  const msg = messageText(step.message);
  if (msg) add(msg, step.source === 'boss' ? 'bad' : 'message');
  if (step.chips) add(t('game.bubble.chips', { n: step.chips }), 'chips');
  if (step.mult) add(t('game.bubble.mult', { n: step.mult }), 'mult');
  if (step.xmult) add(t('game.bubble.xmult', { n: step.xmult }), 'xmult');
  if (step.money) {
    add(t('game.bubble.money', { n: step.money }), 'money');
    money.value += step.money;
    view.setMoney(money.value);
    if (step.money > 0) view.particles.burstAt(target, 'coin', { count: 5 });
  }
  if (step.xmult) view.particles.burstAt(target, 'spark', { count: 10 });
  view.setChipsMult(step.chipsAfter, step.multAfter);
  await anim.wait(per);
}

/** Zahraná ruka: karty na stůl, kroky skórování, výsledek, přičtení ke skóre kola, úklid stolu. */
async function presentHand(
  view: PresentView,
  result: ScoreResult,
  roundScore: number,
  money: { value: number },
): Promise<void> {
  const anim = view.anim;
  const c = view.controller;
  const table = view.tableEl();
  const els = result.playedIds
    .map((id) => [id, view.cardEl(id)] as const)
    .filter((p): p is readonly [number, HTMLElement] => p[1] !== null);

  // 1) FLIP: změř karty v ruce, přesuň je na stůl, změř znovu a odanimuj rozdíl.
  const before = els.map(([, el]) => el.getBoundingClientRect());
  for (const [id, el] of els) {
    const card = c.engine.card(id);
    if (card) updateCardView(el, card, { selected: false, keyHint: undefined });
    else el.classList.remove('is-selected');
    el.classList.add('is-played');
    el.classList.toggle('is-scoring', result.hand.scoringIds.includes(id));
    el.tabIndex = -1;
    table?.appendChild(el);
  }
  const after = els.map(([, el]) => el.getBoundingClientRect());
  await Promise.all(
    els.map(([, el], i) => {
      const dx = (before[i]?.left ?? 0) - (after[i]?.left ?? 0);
      const dy = (before[i]?.top ?? 0) - (after[i]?.top ?? 0);
      return animate(anim, el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], 340, {
        delay: i * 45,
      });
    }),
  );

  // 2) Kombinace a kroky skórování.
  const level = c.state.handLevels[result.hand.type]?.level ?? 1;
  view.showScoring({ hand: result.hand.type, level, chips: 0, mult: 0 });
  await anim.wait(180);
  const per = stepDuration(result.steps.length);
  for (const step of result.steps) await presentStep(view, step, per, money);

  // 3) Výsledek ruky.
  const target = c.state.round?.target ?? Infinity;
  const handName = t(`hands.${result.hand.type}.name`);
  if (result.blockedReason) {
    const reason = messageText(result.blockedReason) ?? '';
    bubble(view, table, reason, 'bad', { big: true });
    say(t('game.events.blocked', { reason }), 'warning');
  } else {
    bubble(view, table, t('game.bubble.score', { n: result.score }), 'score', { big: true });
    if (result.score >= target) {
      bubble(view, view.handInfoEl(), t('game.events.bigScore'), 'score');
      view.shake();
      view.particles.burstAt(table, 'spark', { count: 28, speed: 560 });
    }
  }
  view.announce(t('game.events.scoredLive', { hand: handName, score: result.score, round: roundScore }));
  await tickNumber(anim, view.roundScoreEl(), roundScore - result.score, roundScore, 650);
  await anim.wait(250);

  // 4) Zničené karty (sklo) se roztříští, ostatní odjedou ze stolu.
  const destroyed = new Set(result.destroyedCardIds);
  await Promise.all(
    els.map(([id, el], i) => {
      if (destroyed.has(id)) {
        view.particles.burstAt(el, 'shard', { count: 14 });
        return animate(
          anim,
          el,
          [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(0.6)' },
          ],
          260,
        );
      }
      return animate(
        anim,
        el,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translate(60px, -40px) rotate(8deg)' },
        ],
        280,
        { easing: 'ease-in', delay: i * 30 },
      );
    }),
  );
  for (const [, el] of els) el.remove();
  view.showScoring(null);
}

/** Zahozené karty odletí z ruky. */
async function presentDiscard(view: PresentView, ids: readonly number[]): Promise<void> {
  const els = ids.map((id) => view.cardEl(id)).filter((el): el is HTMLElement => el !== null);
  await Promise.all(
    els.map((el, i) =>
      animate(
        view.anim,
        el,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translate(160px, 70px) rotate(22deg)' },
        ],
        300,
        { easing: 'ease-in', delay: i * 35 },
      ),
    ),
  );
  for (const el of els) el.remove();
}

/** Nově líznuté karty přiletí z balíčku. */
async function presentDraw(view: PresentView, ids: readonly number[]): Promise<void> {
  view.refresh();
  const deck = view.deckEl()?.getBoundingClientRect();
  const els = ids.map((id) => view.cardEl(id)).filter((el): el is HTMLElement => el !== null);
  if (!deck || els.length === 0) return;
  const rects = els.map((el) => el.getBoundingClientRect());
  await Promise.all(
    els.map((el, i) => {
      const r = rects[i]!;
      const dx = deck.left + deck.width / 2 - (r.left + r.width / 2);
      const dy = deck.top + deck.height / 2 - (r.top + r.height / 2);
      return animate(
        view.anim,
        el,
        [
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(-10deg) scale(0.7)` },
          { opacity: 1, transform: 'none' },
        ],
        380,
        { delay: i * 60 },
      );
    }),
  );
}

/** Karta zničená mimo skórování (efekt, spotřebka). */
async function presentDestroyed(view: PresentView, id: number): Promise<void> {
  const el = view.cardEl(id);
  if (!el) return;
  view.particles.burstAt(el, 'shard', { count: 12 });
  await animate(view.anim, el, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.6)' }], 260);
  el.remove();
}

// ─────────────────────────── Presenter ───────────────────────────

/** Vytvoří presenter pro herní obrazovku. */
export function createPresenter(view: PresentView): Presenter {
  return (events, controller) =>
    view.anim.sequence(async () => {
      const s = controller.state;
      // Peníze před akcí = konečný stav − všechny změny v dávce; krok skórování s penězi je přičte postupně.
      const money = {
        value: events.reduce((m, e) => (e.type === 'moneyChanged' ? m - e.delta : m), s.money),
      };
      for (const e of events) await presentEvent(view, e, money);
    });
}

async function presentEvent(view: PresentView, e: GameEvent, money: { value: number }): Promise<void> {
  const anim = view.anim;
  switch (e.type) {
    case 'blindSelected': {
      const intro = e.bossId ? messageText(`bosses.${e.bossId}.intro`) : null;
      if (intro) say(intro, 'warning');
      return;
    }
    case 'blindSkipped':
      say(
        e.tagId && hasKey(`tags.${e.tagId}.name`)
          ? t('game.events.skippedTag', { tag: t(`tags.${e.tagId}.name`) })
          : t('game.events.skipped'),
      );
      return;
    case 'cardsDrawn':
      return presentDraw(view, e.cardIds);
    case 'handPlayed':
      return presentHand(view, e.result, e.roundScore, money);
    case 'cardsDiscarded':
      return presentDiscard(view, e.cardIds);
    case 'cardDestroyed':
      return presentDestroyed(view, e.cardId);
    case 'handShuffled':
      view.refresh();
      return;
    case 'roundWon': {
      const table = view.tableEl();
      bubble(view, table, t('game.events.roundWon'), 'score', { big: true });
      view.particles.burstAt(table, 'coin', { count: 16 });
      await anim.wait(700);
      return;
    }
    case 'gameOver':
      await anim.wait(500);
      return;
    case 'victory':
      view.refresh();
      view.particles.burst('confetti', window.innerWidth / 2, window.innerHeight * 0.4, { count: 90 });
      await anim.wait(400);
      return;
    case 'moneyChanged': {
      // Peníze ze skórování ukazují kroky (bublina + počítadlo); ostatní změny tady.
      if (e.reason === 'score') return;
      money.value = e.money;
      view.setMoney(e.money);
      const el = view.moneyEl();
      void pop(anim, el, 1.2);
      if (e.delta > 0) view.particles.burstAt(el, 'coin', { count: Math.min(14, 4 + e.delta) });
      return;
    }
    case 'jokerTriggered': {
      const text = messageText(e.message);
      const el = view.jokerEl(e.uid);
      void pop(anim, el);
      if (text) bubble(view, el, text, 'message');
      await anim.wait(text ? 450 : 200);
      return;
    }
    case 'jokerSold':
      view.particles.burstAt(view.jokerEl(e.uid), 'coin', { count: 8 });
      say(t('game.joker.sold', { price: e.price }), 'success');
      return;
    case 'jokerDestroyed': {
      const el = view.jokerEl(e.uid);
      view.particles.burstAt(el, 'shard', { count: 14 });
      await animate(anim, el, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.7) rotate(-6deg)' }], 320);
      return;
    }
    case 'consumableUsed':
      say(t('game.consumable.used', { name: t(`consumables.${e.defId}.name`) }), 'success');
      return;
    case 'handLeveled':
      say(t('game.events.leveled', { hand: t(`hands.${e.hand}.name`), level: e.level }), 'success');
      return;
    case 'handDiscovered':
      say(t('game.events.discovered', { hand: t(`hands.${e.hand}.name`) }), 'success');
      return;
    case 'anteChanged':
      say(t('game.events.ante', { ante: e.ante }));
      return;
    case 'bossDefeated': {
      const text = messageText(`bosses.${e.bossId}.defeat`);
      if (text) say(text, 'success');
      return;
    }
    case 'endlessStarted':
      say(t('game.victory.endlessStarted'), 'warning');
      return;
    case 'message': {
      const text = messageText(e.key, e.params);
      if (text) say(text);
      return;
    }
    default:
      return;
  }
}
