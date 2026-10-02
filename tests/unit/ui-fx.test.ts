// @vitest-environment happy-dom
/**
 * „Šťáva“ (fáze 9, DESIGN 13.6): bazén částic (recyklace bez alokací, zastavení smyčky, vypnuté animace,
 * skrytá karta), screen shake (vypíná ho nastavení, vypnuté animace, reduced motion i přeskočení), přechody
 * obrazovek (bez animací se nehrají), náklon karet, počítadlo skóre a zkrácení animací při reduced motion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import { formatNumber } from '../../src/i18n/format';
import { AnimQueue } from '../../src/ui/anim/queue';
import { App } from '../../src/ui/app';
import {
  REDUCED_MOTION_FACTOR,
  prefersReducedMotion,
  resetMotionQuery,
  scaledDuration,
  shakeAllowed,
} from '../../src/ui/fx/motion';
import { MAX_PARTICLES, Particles, particles, resetParticles } from '../../src/ui/fx/particles';
import { SHAKE, Shaker, shakeForScore } from '../../src/ui/fx/shake';
import { bindTilt } from '../../src/ui/fx/tilt';
import { SCREEN_TRANSITION_MS, screenTransition } from '../../src/ui/fx/transitions';
import { countDuration, tickNumber } from '../../src/ui/present';
import { memoryStore, STORAGE_KEYS } from '../../src/ui/storage';

// ─────────────────────────── Pomocníci ───────────────────────────

/** Kontext 2D, který jen počítá volání (happy-dom žádné plátno nekreslí). */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (name: string) => (): void => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    setTransform: count('setTransform'),
    clearRect: count('clearRect'),
    beginPath: count('beginPath'),
    ellipse: count('ellipse'),
    arc: count('arc'),
    fill: count('fill'),
    stroke: count('stroke'),
    fillRect: count('fillRect'),
    moveTo: count('moveTo'),
    lineTo: count('lineTo'),
    closePath: count('closePath'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function fakeCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** Ruční rAF: snímky se spouštějí jen voláním `flush`. */
function manualRaf(): {
  raf: (cb: FrameRequestCallback) => number;
  caf: (id: number) => void;
  pending: () => number;
  flush: (now: number) => void;
} {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    raf: (cb) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    caf: (id) => void queue.delete(id),
    pending: () => queue.size,
    flush: (now) => {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(now);
    },
  };
}

/** Podvrhne `prefers-reduced-motion`. */
function mockReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  resetMotionQuery();
}

const RECT = { left: 100, top: 100, width: 80, height: 112 };

afterEach(() => {
  vi.unstubAllGlobals();
  resetMotionQuery();
  resetParticles();
  document.documentElement.classList.remove('no-anim');
});

// ─────────────────────────── Částice ───────────────────────────

describe('částice — bazén', () => {
  it('recykluje pevný bazén: nad kapacitu nepřibývá, typovaná pole zůstávají stejná', () => {
    const { ctx } = fakeContext();
    const r = manualRaf();
    const p = new Particles(fakeCanvas(ctx), () => true, { raf: r.raf, caf: r.caf, speed: () => 1 });
    const arrays = p as unknown as { px: Float32Array; life: Float32Array; kind: Uint8Array };
    const px = arrays.px;
    const life = arrays.life;
    expect(p.capacity).toBe(MAX_PARTICLES);

    p.burst('spark', 10, 10, { count: 100 });
    expect(p.count).toBe(100);
    expect(p.running).toBe(true);
    expect(r.pending()).toBe(1);

    // Víc než kapacita naráz: přepisuje se dokola, počet nepřeroste bazén.
    p.burst('confetti', 50, 50, { count: MAX_PARTICLES * 2 });
    p.burstRect(RECT, 'shard', { count: 300 });
    expect(p.count).toBe(MAX_PARTICLES);
    expect(arrays.px).toBe(px);
    expect(arrays.life).toBe(life);
    // Smyčka snímků běží jen jedna.
    expect(r.pending()).toBe(1);

    // Všechno vyprší → smyčka se při dalším snímku sama zastaví a plátno smaže.
    expect(p.advance(10)).toBe(0);
    r.flush(100);
    expect(p.running).toBe(false);
    expect(r.pending()).toBe(0);

    // Znovu použitelný — stejná pole, nová smyčka.
    p.coins(RECT, 6);
    expect(p.count).toBe(6);
    expect(arrays.px).toBe(px);
    expect(p.running).toBe(true);
    p.dispose();
  });

  it('snímek posune částice a smyčka běží, dokud nějaká žije', () => {
    const { ctx, calls } = fakeContext();
    const r = manualRaf();
    const p = new Particles(fakeCanvas(ctx), () => true, { raf: r.raf, caf: r.caf, speed: () => 1 });
    p.burst('coin', 200, 200, { count: 4 });
    r.flush(performance.now() + 16);
    expect(p.count).toBe(4);
    expect(r.pending()).toBe(1);
    expect(calls.ellipse).toBeGreaterThanOrEqual(4);
    p.dispose();
    expect(p.count).toBe(0);
  });

  it('všechny efekty se vykreslí (mince, sklo, ×mult, obláčky, prach, velké skóre, konfety)', () => {
    const { ctx, calls } = fakeContext();
    const r = manualRaf();
    const p = new Particles(fakeCanvas(ctx), () => true, { raf: r.raf, caf: r.caf, speed: () => 2 });
    p.coins(RECT, 5);
    p.coins(RECT, 3, 'down');
    p.glass(RECT);
    p.xmult(RECT, 1.5);
    p.puff(RECT, 'chips');
    p.puff(RECT, 'mult');
    p.dust(RECT);
    p.bigScore(RECT, 1);
    p.confetti();
    p.celebrate(RECT);
    expect(p.count).toBeGreaterThan(200);
    expect(p.count).toBeLessThanOrEqual(MAX_PARTICLES);
    p.advance(0.016);
    expect(calls.fillRect).toBeGreaterThan(0);
    expect(calls.arc).toBeGreaterThan(0);
    expect(calls.lineTo).toBeGreaterThan(0);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.globalAlpha).toBe(1);
    p.dispose();
  });

  it('vypnuté animace: nic se nevytvoří a smyčka se nespustí; vypnutí za letu částice smaže', () => {
    const { ctx } = fakeContext();
    const r = manualRaf();
    let on = false;
    const p = new Particles(fakeCanvas(ctx), () => on, { raf: r.raf, caf: r.caf });
    p.burst('spark', 0, 0);
    p.glass(RECT);
    p.confetti();
    expect(p.count).toBe(0);
    expect(r.pending()).toBe(0);

    on = true;
    p.xmult(RECT);
    expect(p.count).toBeGreaterThan(0);
    on = false;
    r.flush(performance.now() + 16);
    expect(p.count).toBe(0);
    expect(p.running).toBe(false);
    p.dispose();
  });

  it('prvek bez rozměrů a chybějící kontext 2D = tichý no-op', () => {
    const { ctx } = fakeContext();
    const r = manualRaf();
    const p = new Particles(fakeCanvas(ctx), () => true, { raf: r.raf, caf: r.caf });
    p.burstAt(document.createElement('div'), 'coin');
    p.glass({ left: 0, top: 0, width: 0, height: 0 });
    p.coins(null);
    expect(p.count).toBe(0);

    const none = new Particles(null, () => true, { raf: r.raf, caf: r.caf });
    none.confetti();
    expect(none.count).toBe(0);
    expect(none.ready).toBe(false);
  });

  it('skrytá karta prohlížeče částice zahodí a smyčku zastaví', () => {
    const { ctx } = fakeContext();
    const r = manualRaf();
    const p = new Particles(fakeCanvas(ctx), () => true, { raf: r.raf, caf: r.caf });
    p.burst('confetti', 10, 10, { count: 20 });
    expect(p.count).toBe(20);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(p.count).toBe(0);
    expect(p.running).toBe(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    p.dispose();
  });

  it('sdílený systém bez argumentu bere stav dokumentu; reduced motion ho vypne', () => {
    document.body.innerHTML = '<canvas id="fx"></canvas>';
    const shared = particles();
    expect(particles()).toBe(shared);
    // happy-dom nemá kontext 2D → ready false, ale nic nespadne.
    expect(() => shared.confetti()).not.toThrow();
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

// ─────────────────────────── Screen shake ───────────────────────────

describe('screen shake', () => {
  const ON = { animations: true, speed: 1, screenShake: true };

  function shaker(
    prefs: () => { animations: boolean; speed: number; screenShake: boolean; instant?: boolean },
  ) {
    const el = document.createElement('div');
    const r = manualRaf();
    return { el, r, s: new Shaker(() => el, prefs, { raf: r.raf, caf: r.caf }) };
  }

  it('zatřese obalem (jen transform) a sám doběhne', () => {
    const { el, r, s } = shaker(() => ON);
    expect(s.shake(0.6)).toBe(true);
    expect(s.active).toBe(true);
    expect(r.pending()).toBe(1);
    expect(s.step(0.016)).toBe(true);
    expect(el.style.transform).toMatch(/^translate3d\(.+\) rotate\(.+deg\)$/);
    // Doznívání: plné trauma vyprchá do ~1 s při 1×.
    for (let i = 0; i < 100 && s.step(0.016); i++);
    expect(s.active).toBe(false);
    expect(el.style.transform).toBe('');
  });

  it('otřesy se sčítají se stropem 1', () => {
    const { s } = shaker(() => ON);
    s.shake(0.7);
    s.shake(0.7);
    expect(s.level).toBe(1);
    s.stop();
  });

  it('vypnutý v nastavení, s vypnutými animacemi i s prefers-reduced-motion nic neudělá', () => {
    for (const prefs of [
      { ...ON, screenShake: false },
      { ...ON, animations: false },
    ]) {
      const { el, r, s } = shaker(() => prefs);
      expect(s.shake(1)).toBe(false);
      expect(r.pending()).toBe(0);
      expect(el.style.transform).toBe('');
    }
    mockReducedMotion(true);
    expect(shakeAllowed(ON)).toBe(false);
    const { el, s } = shaker(() => ON);
    expect(s.shake(1)).toBe(false);
    expect(el.style.transform).toBe('');
  });

  it('přeskočení animace (mezerník) shake hned zastaví a vrátí obal na místo', () => {
    let instant = false;
    const { el, s } = shaker(() => ({ ...ON, instant }));
    s.shake(1);
    s.step(0.016);
    expect(el.style.transform).not.toBe('');
    instant = true;
    expect(s.step(0.016)).toBe(false);
    expect(el.style.transform).toBe('');
    expect(s.shake(1)).toBe(false);
  });

  it('vyšší rychlost hry zkrátí doznívání', () => {
    const steps = (speed: number): number => {
      const { s } = shaker(() => ({ ...ON, speed }));
      s.shake(1);
      let n = 0;
      while (s.step(0.016)) n++;
      return n;
    };
    expect(steps(4)).toBeLessThan(steps(1));
  });

  it('síla podle skóre: pod polovinou cíle nic, od poloviny lehce, od cíle podle převýšení', () => {
    expect(shakeForScore(100, 300)).toBe(0);
    expect(shakeForScore(150, 300)).toBe(SHAKE.half);
    expect(shakeForScore(299, 300)).toBe(SHAKE.half);
    expect(shakeForScore(300, 300)).toBeCloseTo(0.55);
    expect(shakeForScore(3000, 300)).toBeGreaterThan(shakeForScore(600, 300));
    expect(shakeForScore(1e12, 300)).toBe(1);
    expect(shakeForScore(100, 0)).toBe(0);
    expect(shakeForScore(100, Infinity)).toBe(0);
  });
});

// ─────────────────────────── Přechody obrazovek ───────────────────────────

describe('přechody obrazovek', () => {
  it('bez animací, bez předchozí obrazovky a s reduced motion se nehrají', () => {
    expect(screenTransition('menu', 'settings', { animations: false, speed: 1 })).toBeNull();
    expect(screenTransition('menu', null, { animations: true, speed: 1 })).toBeNull();
    expect(screenTransition('menu', 'menu', { animations: true, speed: 1 })).toBeNull();
    mockReducedMotion(true);
    expect(screenTransition('menu', 'settings', { animations: true, speed: 1 })).toBeNull();
  });

  it('délka ÷ rychlost; hra jen prolnutím, do menu zleva, z menu zprava', () => {
    const fwd = screenTransition('collection', 'menu', { animations: true, speed: 1 })!;
    expect(fwd.duration).toBe(SCREEN_TRANSITION_MS);
    expect(String(fwd.keyframes[0]!.transform)).toContain('18px');
    const back = screenTransition('menu', 'collection', { animations: true, speed: 4 })!;
    expect(back.duration).toBe(SCREEN_TRANSITION_MS / 4);
    expect(String(back.keyframes[0]!.transform)).toContain('-18px');
    const game = screenTransition('game', 'newGame', { animations: true, speed: 2 })!;
    expect(game.keyframes.every((k) => k.transform === undefined)).toBe(true);
    expect(game.keyframes[0]!.opacity).toBe(0);
    // Jen opacity a transform.
    for (const spec of [fwd, back, game])
      for (const k of spec.keyframes)
        expect(Object.keys(k).every((p) => p === 'opacity' || p === 'transform')).toBe(true);
  });

  function makeApp(settings: Record<string, unknown>): { app: App; animate: ReturnType<typeof vi.fn> } {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app')!;
    const app = new App(root, memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify(settings) }), registry());
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    const screen = (label: string) => () => {
      const el = document.createElement('main');
      const h1 = document.createElement('h1');
      h1.tabIndex = -1;
      h1.textContent = label;
      el.append(h1);
      el.animate = animate as unknown as HTMLElement['animate'];
      return { el };
    };
    app.register('menu', screen('menu'));
    app.register('settings', screen('settings'));
    app.register('game', screen('game'));
    return { app, animate };
  }

  it('vypnuté animace: App.go přechod nepřehraje, obrazovka i focus jsou na místě hned', () => {
    const { app, animate } = makeApp({ animations: false });
    app.go('menu');
    app.go('settings');
    app.go('menu');
    expect(animate).not.toHaveBeenCalled();
    expect(app.root.dataset.screen).toBe('menu');
    expect(document.activeElement?.textContent).toBe('menu');
  });

  it('zapnuté animace: App.go přehraje krátký přechod (jen při změně obrazovky) a focus zůstane', () => {
    const { app, animate } = makeApp({ animations: true, speed: 2 });
    app.go('menu');
    expect(animate).not.toHaveBeenCalled();
    app.go('settings');
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames[0]!.opacity).toBe(0);
    expect(opts.duration).toBe(SCREEN_TRANSITION_MS / 2);
    expect(app.root.dataset.screen).toBe('settings');
    expect(document.activeElement?.textContent).toBe('settings');
    app.go('game');
    expect(animate).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────── Délky, počítadlo, náklon ───────────────────────────

describe('délky animací a reduced motion', () => {
  it('rychlost dělí, vypnuté animace = 0, reduced motion zkrátí', () => {
    expect(scaledDuration(200, { animations: true, speed: 2 })).toBe(100);
    expect(scaledDuration(200, { animations: false, speed: 1 })).toBe(0);
    mockReducedMotion(true);
    expect(scaledDuration(200, { animations: true, speed: 1 })).toBe(200 * REDUCED_MOTION_FACTOR);
  });

  it('fronta animací zkrátí čekání při reduced motion', () => {
    const normal = new AnimQueue(() => ({ speed: 1, enabled: true }));
    const reduced = new AnimQueue(() => ({ speed: 1, enabled: true, reducedMotion: true }));
    expect(normal.duration(400)).toBe(400);
    expect(reduced.duration(400)).toBe(400 * REDUCED_MOTION_FACTOR);
    expect(new AnimQueue(() => ({ speed: 4, enabled: false })).duration(400)).toBe(0);
  });
});

describe('počítadlo skóre', () => {
  beforeEach(() => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      now += 50;
      queueMicrotask(() => cb(now));
      return 1;
    });
  });

  it('doběhne na cíl, během počítání má třídu is-counting', async () => {
    const anim = new AnimQueue(() => ({ speed: 1, enabled: true }));
    const el = document.createElement('p');
    const done = anim.sequence(() => tickNumber(anim, el, 0, 5000, 300));
    expect(el.classList.contains('is-counting')).toBe(true);
    await done;
    expect(el.textContent).toBe(formatNumber(5000));
    expect(el.classList.contains('is-counting')).toBe(false);
  });

  it('délka roste s přírůstkem, ale nikdy přes 1 s', () => {
    expect(countDuration(0)).toBe(0);
    expect(countDuration(50)).toBeLessThan(countDuration(50_000));
    expect(countDuration(1e15)).toBe(1000);
    expect(countDuration(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('náklon karty', () => {
  function card(): { el: HTMLElement; inner: HTMLElement } {
    const el = document.createElement('button');
    const inner = document.createElement('span');
    inner.className = 'pcard__inner';
    el.append(inner);
    el.getBoundingClientRect = () => new DOMRect(0, 0, 100, 140);
    document.body.append(el);
    return { el, inner };
  }

  const pointer = (type: string, x: number, y: number, pointerType = 'mouse'): Event => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    return e;
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('myš kartu nakloní a pohne odleskem, odchod ji vrátí', () => {
    const { el, inner } = card();
    bindTilt(el);
    el.dispatchEvent(pointer('pointerenter', 100, 0));
    el.dispatchEvent(pointer('pointermove', 100, 0));
    expect(inner.style.getPropertyValue('--tilt-y')).toBe('6.00deg');
    expect(inner.style.getPropertyValue('--tilt-x')).not.toBe('');
    expect(inner.style.getPropertyValue('--glare-x')).toBe('25.0%');
    expect(inner.classList.contains('is-tilted')).toBe(true);
    el.dispatchEvent(pointer('pointerleave', 200, 0));
    expect(inner.style.getPropertyValue('--tilt-y')).toBe('');
    expect(inner.classList.contains('is-tilted')).toBe(false);
  });

  it('dotyk ani vypnuté animace kartu nenakloní', () => {
    const { el, inner } = card();
    bindTilt(el);
    el.dispatchEvent(pointer('pointerenter', 10, 10, 'touch'));
    el.dispatchEvent(pointer('pointermove', 10, 10, 'touch'));
    expect(inner.style.getPropertyValue('--tilt-y')).toBe('');
    document.documentElement.classList.add('no-anim');
    el.dispatchEvent(pointer('pointerenter', 10, 10));
    el.dispatchEvent(pointer('pointermove', 10, 10));
    expect(inner.style.getPropertyValue('--tilt-y')).toBe('');
  });
});
