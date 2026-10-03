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
 *
 * „Šťáva“ (DESIGN 13.6): částice (src/ui/fx/particles.ts — mince, střepy, plamínky ×mult, obláčky +čipy / +mult,
 * prach, konfety), screen shake (src/ui/fx/shake.ts — od poloviny cíle lehce, od cíle podle převýšení, šéf, sklo)
 * a efekt velkého skóre (ruka ≥ cíl kola: obří bublina, zlatý záblesk, jiskry, záře počítadla). Každý krok
 * nejdřív změří, co potřebuje (obdélník zdroje), a teprve pak zapisuje — žádné vynucené přepočty layoutu ve smyčce.
 */
import type { BlindKind, GameEvent, HandType, ScoreResult, ScoreStep } from '../engine';
import { hasKey, t } from '../i18n/cs';
import { formatNumber } from '../i18n/format';
import type { AnimQueue } from './anim/queue';
import { blindArt } from './art/art';
import { sound, soundForEvent, soundScoreStep } from './audio/hooks';
import { updateCardView } from './components/card';
import { createContentCard } from './components/consumableCard';
import { toast, type ToastKind } from './components/toast';
import { bossTexts, tagTexts } from './describe';
import type { GameController, Presenter } from './controller';
import { h } from './dom';
import type { Particles, RectLike } from './fx/particles';
import { SHAKE, shakeForScore } from './fx/shake';

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
  /** Zatřese hrou s intenzitou 0–1 (src/ui/fx/shake.ts), pokud to nastavení dovolí. */
  shake(intensity?: number): void;
  /** Velké skóre: zlatý záblesk přes obrazovku a záře počítadla skóre kola (síla 0–1; nepovinné — testy). */
  bigScore?(strength: number): void;
  /** Čísla čipů a multu v levém panelu (krátké „povyskočení“ při změně; nepovinné). */
  chipsEl?(): HTMLElement | null;
  multEl?(): HTMLElement | null;
  /** Hlášení pro čtečky obrazovky (živá oblast). */
  announce(text: string): void;
  /** Příchod šéfa: plakát se jménem, pravidlem a hláškou nad stolem (nepovinné — testy bez DOM). */
  showBossIntro?(bossId: string, kind: BlindKind): void;
  /** Schová plakát šéfa (hráč zahrál nebo zahodil). */
  hideBossIntro?(): void;
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

/**
 * Délka počítadla skóre (ms při 1×) podle přírůstku: malé číslo doběhne rychle, miliony déle — ale nikdy přes
 * 1 s, ať hráč nečeká.
 */
export function countDuration(delta: number): number {
  const d = Math.abs(delta);
  if (!Number.isFinite(d) || d < 1) return 0;
  return Math.round(Math.min(1000, 420 + 110 * Math.log10(Math.max(10, d))));
}

/** Plynulé zpomalení na konci (exponenciální ease-out — čísla „dojíždějí“ jako počítadlo benzínu). */
function easeOutExpo(p: number): number {
  return p >= 1 ? 1 : 1 - 2 ** (-10 * p);
}

/**
 * Počítadlo „tik tik“: číslo v prvku doběhne z `from` na `to` (rychlost hry, přeskočení mezerníkem i vypnuté
 * animace respektuje — pak rovnou ukáže cíl). Text se přepisuje jen při změně; během počítání má prvek třídu
 * `is-counting` (CSS ho jemně zvětší).
 */
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
  let shown = '';
  el.classList.add('is-counting');
  return new Promise((resolve) => {
    const step = (now: number): void => {
      const p = anim.instant ? 1 : Math.min(1, (now - start) / duration);
      const text = format(p >= 1 ? to : Math.floor(from + (to - from) * easeOutExpo(p)));
      if (text !== shown) {
        shown = text;
        el.textContent = text;
      }
      if (p >= 1) {
        el.classList.remove('is-counting');
        resolve();
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Nejmenší odstup kotvy bubliny od horního okraje okna (výška bubliny + rezerva, px). */
const BUBBLE_MIN_TOP = 44;

/** Obdélník prvku (jedno čtení layoutu), nebo null pro chybějící / neviditelný prvek. */
function measure(el: Element | null | undefined): RectLike | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0 ? null : r;
}

/**
 * Bublina nad prvkem nebo už změřeným obdélníkem (+čipy, +mult, hláška…). Bez animací se nevytváří.
 * `huge` = obří zlatá bublina velkého skóre.
 */
export function bubble(
  view: PresentView,
  target: Element | RectLike | null | undefined,
  text: string,
  tone: BubbleTone,
  opts: { offset?: number; big?: boolean; huge?: boolean } = {},
): void {
  const layer = view.fxLayer();
  if (!layer || !target || view.anim.instant || !text) return;
  const r = 'getBoundingClientRect' in target ? target.getBoundingClientRect() : target;
  if (r.width === 0 && r.height === 0) return;
  const x = Math.round(r.left + r.width / 2);
  const offset = opts.offset ?? 0;
  let y = Math.round(r.top + (opts.big ? r.height / 2 : 0) - offset);
  // Nad zdrojem není místo (žolíci u horního okraje okna) — bublina se ukáže pod ním, ať ji okraj neořízne.
  if (!opts.big && y < BUBBLE_MIN_TOP) y = Math.round(r.top + r.height + BUBBLE_MIN_TOP - 8 + offset);
  const el = h(
    'div',
    {
      class: [
        'game-bubble',
        `game-bubble--${tone}`,
        opts.big || opts.huge ? 'game-bubble--big' : '',
        opts.huge ? 'game-bubble--huge' : '',
      ],
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
  soundScoreStep(step, anim);
  if (step.source === 'hand') {
    view.setChipsMult(step.chipsAfter, step.multAfter);
    void pop(anim, view.handInfoEl(), 1.05);
    await anim.wait(per);
    return;
  }
  // Šéf přepočítal výsledek (Pan starosta): hláška uprostřed stolu u zahraných karet — nad náhledem kombinace v levém
  // panelu by zakryla číslo Skóre kola.
  const bossStep = step.source === 'boss';
  const target = bossStep ? (view.tableEl() ?? stepTarget(view, step)) : stepTarget(view, step);
  // Nejdřív změřit (zdroj kroku), pak zapisovat — bubliny i částice použijí stejný obdélník.
  const rect = anim.instant ? null : measure(target);
  if (!bossStep) void pop(anim, target);
  let offset = 0;
  const add = (text: string, tone: BubbleTone): void => {
    bubble(view, rect, text, tone, { offset, big: bossStep });
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
    view.particles.coins(rect, step.money > 0 ? 5 : 3, step.money > 0 ? 'up' : 'down');
  }
  if (rect) {
    // ×mult = plamínky (síla podle násobku), +čipy / +mult = obláček v barvě.
    if (step.xmult) view.particles.xmult(rect, Math.min(2, 0.7 + (step.xmult - 1) * 0.6));
    else if (step.mult) view.particles.puff(rect, 'mult');
    if (step.chips) view.particles.puff(rect, 'chips');
  }
  view.setChipsMult(step.chipsAfter, step.multAfter);
  if (step.chips) void pop(anim, view.chipsEl?.(), 1.25);
  if (step.mult || step.xmult) void pop(anim, view.multEl?.(), step.xmult ? 1.4 : 1.25);
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
  view.hideBossIntro?.();
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
    // Velké skóre (DESIGN 13.6): ruka sama dosáhla cíle kola — obří bublina, záblesk, jiskry, silný shake podle
    // převýšení. Od poloviny cíle jen lehké „ťuknutí“.
    const big = result.score >= target;
    const tableRect = anim.instant ? null : measure(table);
    bubble(view, tableRect, t('game.bubble.score', { n: result.score }), 'score', { big: true, huge: big });
    const shake = shakeForScore(result.score, target);
    if (big) {
      sound('bigScore');
      const strength = Math.min(1, 0.45 + 0.35 * Math.log10(result.score / target + 1));
      // „To je rána!“ nad obří bublinou (ne přes počítadlo skóre v levém panelu).
      if (tableRect)
        bubble(
          view,
          {
            left: tableRect.left,
            top: tableRect.top + tableRect.height / 2 - 46,
            width: tableRect.width,
            height: 1,
          },
          t('game.events.bigScore'),
          'score',
        );
      view.bigScore?.(strength);
      view.particles.bigScore(tableRect, strength);
    }
    if (shake > 0) view.shake(shake);
  }
  view.announce(t('game.events.scoredLive', { hand: handName, score: result.score, round: roundScore }));
  await tickNumber(
    anim,
    view.roundScoreEl(),
    roundScore - result.score,
    roundScore,
    countDuration(result.score),
  );
  await anim.wait(250);

  // 4) Zničené karty (sklo) se roztříští, ostatní odjedou ze stolu. Obdélníky zničených karet se změří najednou.
  const destroyed = new Set(result.destroyedCardIds);
  const broken = anim.instant ? [] : els.filter(([id]) => destroyed.has(id)).map(([, el]) => el);
  const brokenRects = broken.map((el) => measure(el));
  if (els.some(([id]) => destroyed.has(id))) sound('glassBreak');
  broken.forEach((el, i) => shatter(view, el, brokenRects[i] ?? null));
  if (broken.some((el) => el.classList.contains('enh-glass'))) view.shake(SHAKE.glass);
  await Promise.all(
    els.map(([id, el], i) => {
      if (destroyed.has(id)) {
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
  view.hideBossIntro?.();
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

/** Rozbitá karta: skleněná se roztříští na střepy, ostatní se rozpadnou v prach. */
function shatter(view: PresentView, el: Element, rect: RectLike | null): void {
  if (el.classList.contains('enh-glass')) view.particles.glass(rect);
  else view.particles.dust(rect);
}

/** Karta zničená mimo skórování (efekt, spotřebka). */
async function presentDestroyed(view: PresentView, id: number): Promise<void> {
  const el = view.cardEl(id);
  if (!el) return;
  shatter(view, el, view.anim.instant ? null : measure(el));
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
      // Štítky použité hned v téže dávce (Drobné v kabátě, obálky) — ohlásí je jejich vlastní hláška.
      const batch: Batch = {
        money,
        tagsTriggered: new Set(events.flatMap((e) => (e.type === 'tagTriggered' ? [e.defId] : []))),
        announced: new Set(),
      };
      for (const e of events) await presentEvent(view, e, batch);
    });
}

/** Kontext jedné dávky událostí (jedna akce hráče). */
interface Batch {
  /** Peníze, jak je ukazuje levý panel během přehrávání. */
  money: { value: number };
  /** Štítky, které se v dávce spotřebovaly (`tagTriggered`). */
  tagsTriggered: ReadonlySet<string>;
  /** Štítky už ohlášené při přeskočení — jejich `tagTriggered` se v dávce neopakuje. */
  announced: Set<string>;
}

async function presentEvent(view: PresentView, e: GameEvent, batch: Batch): Promise<void> {
  const anim = view.anim;
  soundForEvent(e, anim);
  const money = batch.money;
  switch (e.type) {
    case 'blindSelected': {
      // Příchod šéfa (u Velké útraty na Imperialu jeho pravidlo navíc): plakát nad stolem + hlášení čtečce.
      const reg = view.controller.registry;
      if (!e.bossId || !reg.bosses[e.bossId]) return;
      const tx = bossTexts(e.bossId, { registry: reg });
      view.showBossIntro?.(e.bossId, e.blind);
      view.shake(SHAKE.boss);
      view.announce(
        t('game.events.bossArrived', { name: tx.name, rule: tx.rule, intro: tx.intro ?? '' }).trim(),
      );
      await anim.wait(900);
      return;
    }
    case 'blindSkipped': {
      // Hláška se žetonem štítku. Štítek použitý hned (peníze, obálka) se ohlásí tady i s tím, co udělal — jeho
      // `tagTriggered` v téže dávce se pak už neopakuje; jinak štítek čeká v levém panelu.
      const reg = view.controller.registry;
      if (!e.tagId || !reg.tags[e.tagId]) {
        say(t('game.events.skipped'));
        return;
      }
      const tx = tagTexts(e.tagId, { registry: reg });
      const now = batch.tagsTriggered.has(e.tagId);
      if (now) batch.announced.add(e.tagId);
      toast(now ? tx.desc : t('game.events.skippedTag', { tag: tx.name }), {
        kind: now ? 'success' : 'info',
        title: now ? t('game.events.skippedTag', { tag: tx.name }) : undefined,
        media: createContentCard('tag', e.tagId, { registry: reg, tooltip: false }),
        className: 'toast--tag',
        testId: 'toast-game-info',
      });
      return;
    }
    case 'jokerDebuffChanged': {
      // Šéf žolíka vypnul (Exekutor, Krajský úřad, Jednooký hejtman…) nebo ho zase pustil (Výpadek proudu po první
      // ruce). Na konci kola se vypnutí ruší všem naráz — to už se neohlašuje.
      if (!e.debuffed && view.controller.state.phase !== 'round') return;
      const el = view.jokerEl(e.uid);
      void pop(anim, el);
      bubble(
        view,
        el,
        t(e.debuffed ? 'game.bubble.jokerOff' : 'game.bubble.jokerOn'),
        e.debuffed ? 'bad' : 'message',
      );
      await anim.wait(220);
      return;
    }
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
      const table = measure(view.tableEl());
      bubble(view, table, t('game.events.roundWon'), 'score', { big: true });
      view.particles.coins(table, 16);
      await anim.wait(700);
      return;
    }
    case 'gameOver':
      await anim.wait(500);
      return;
    case 'victory':
      view.refresh();
      view.particles.confetti();
      await anim.wait(400);
      return;
    case 'moneyChanged': {
      // Peníze ze skórování ukazují kroky (bublina + počítadlo); ostatní změny tady.
      if (e.reason === 'score') return;
      const el = view.moneyEl();
      // Výplata / prodej = mince vyletí, placení (Večerka, šéf, úrok dluhu) = mince padají. Změřit před zápisem.
      if (e.delta !== 0)
        view.particles.coins(
          el,
          e.delta > 0 ? Math.min(18, 4 + e.delta) : Math.min(8, 2 - e.delta),
          e.delta > 0 ? 'up' : 'down',
        );
      money.value = e.money;
      view.setMoney(e.money);
      void pop(anim, el, 1.2);
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
      view.particles.coins(view.jokerEl(e.uid), 8);
      say(t('game.joker.sold', { price: e.price }), 'success');
      return;
    case 'jokerDestroyed': {
      const el = view.jokerEl(e.uid);
      view.particles.dust(el);
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
      const reg = view.controller.registry;
      if (!reg.bosses[e.bossId]) return;
      const tx = bossTexts(e.bossId, { registry: reg });
      toast(tx.defeat ? t('art.tooltip.flavor', { text: tx.defeat }) : t('game.events.bossDefeated'), {
        kind: 'success',
        title: t('game.events.bossDefeatedTitle', { name: tx.name }),
        media: blindArt('boss', e.bossId, { registry: reg }),
        className: 'toast--boss',
        testId: 'toast-boss-defeat',
      });
      return;
    }
    case 'tagTriggered': {
      // Štítek se právě použil (spotřeboval) — co udělal. Hned po přeskočení ho už ohlásilo `blindSkipped`.
      const reg = view.controller.registry;
      if (!reg.tags[e.defId] || batch.announced.delete(e.defId)) return;
      const tx = tagTexts(e.defId, { registry: reg });
      toast(tx.desc, {
        kind: 'success',
        title: t('game.events.tagTriggered', { name: tx.name }),
        media: createContentCard('tag', e.defId, { registry: reg, tooltip: false }),
        className: 'toast--tag',
        testId: 'toast-tag',
      });
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
