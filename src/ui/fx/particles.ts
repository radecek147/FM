/**
 * Částice na jediném `<canvas id="fx">` přes celou obrazovku (ARCHITECTURE 4, DESIGN 13.6).
 *
 *   const fx = particles(() => app.settings.animations);
 *   fx.coins(moneyEl, 8);              // vydělané peníze (mince letí nahoru), fx.coins(el, 4, 'down') = zaplaceno
 *   fx.glass(cardRect);                // prasklá skleněná karta: střepy po celé ploše karty
 *   fx.xmult(jokerEl);                 // ×mult: plamínky, jiskry a rudý kruh
 *   fx.puff(jokerEl, 'chips');         // +čipy / +mult: obláček modrých / červených pixelů
 *   fx.dust(cardEl);                   // zničená karta: prach
 *   fx.bigScore(tableEl, 0.8);         // velké skóre: zlaté jiskry a kruhy
 *   fx.confetti();                     // výhra: dvě konfetová děla
 *   fx.celebrate(toastEl);             // achievement: hrst konfet
 *
 * Cíl je prvek (změří se jeho obdélník — jedno čtení layoutu), nebo už změřený obdélník (`RectLike`), aby
 * volající mohl změřit všechno najednou a teprve pak zapisovat (žádný layout thrashing).
 *
 * Výkon: pevný bazén částic v typovaných polích (žádné alokace ve smyčce snímku, plný bazén přepisuje dokola),
 * smyčka `requestAnimationFrame` běží jen, dokud nějaká částice žije, a sama se zastaví. Plátno se přepočítá
 * (včetně `devicePixelRatio`, max. 2) jen po změně okna. Skrytá karta prohlížeče = částice se zahodí. Bez animací
 * (nastavení, `prefers-reduced-motion`) se nic nevytváří ani nekreslí. Rychlost hry zrychlí fyziku (√ škálování,
 * ať částice při 4× nezmizí dřív, než je hráč uvidí). Kontext 2D chybí (testy) = tichý no-op.
 */
import { clampSpeed, documentMotionOff, documentSpeed, prefersReducedMotion } from './motion';

export type ParticleKind =
  'coin' | 'spark' | 'shard' | 'confetti' | 'chips' | 'mult' | 'fire' | 'dust' | 'ring';

/** Obdélník v souřadnicích okna (CSS px) — výsledek `getBoundingClientRect()`. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type FxTarget = Element | RectLike | null | undefined;

export interface BurstOptions {
  /** Počet částic (výchozí podle druhu). */
  count?: number;
  /** Počáteční rychlost v px/s (výchozí podle druhu). */
  speed?: number;
  /** Směr: vzhůru (kužel), dolů (padající mince) nebo všemi směry (od středu plochy). */
  direction?: 'up' | 'down' | 'out';
  /** Vlastní směr v radiánech (0 = vpravo, −π/2 = nahoru) — přebije `direction`. */
  angle?: number;
  /** Šířka kužele v radiánech (výchozí 1,9). */
  cone?: number;
  /** Barva kruhu (`ring`) a jiskry: 0 zlatá, 1 rudá, 2 modrá, 3 bílá. */
  tone?: number;
  /** Násobek velikosti částic. */
  scale?: number;
}

/** Kapacita bazénu (viz ui-fx test „bazén se recykluje“). */
export const MAX_PARTICLES = 640;

const KIND_IDS: Readonly<Record<ParticleKind, number>> = {
  coin: 0,
  spark: 1,
  shard: 2,
  confetti: 3,
  chips: 4,
  mult: 5,
  fire: 6,
  dust: 7,
  ring: 8,
};
const K_COIN = 0;
const K_SPARK = 1;
const K_SHARD = 2;
const K_CONFETTI = 3;
const K_CHIPS = 4;
const K_MULT = 5;
const K_FIRE = 6;
const K_DUST = 7;
const K_RING = 8;

//                         coin  spark shard conf  chips mult  fire  dust  ring
const DEFAULT_COUNT = [10, 14, 12, 60, 8, 8, 18, 14, 1];
const DEFAULT_SPEED = [380, 420, 300, 620, 220, 220, 260, 110, 0];
/** Gravitace (px/s²); záporná = stoupá (plamen, obláček). */
const GRAVITY = [1300, 260, 1100, 520, -60, -60, -420, -30, 0];
/** Odpor vzduchu za sekundu (násobek rychlosti). */
const DRAG = [0.35, 2.2, 0.6, 1.1, 3.2, 3.2, 1.8, 2.6, 0];
/** Životnost v sekundách (základ + náhodná část). */
const TTL_BASE = [0.9, 0.45, 0.7, 1.6, 0.45, 0.45, 0.5, 0.7, 0.5];
const TTL_RAND = [0.4, 0.35, 0.3, 0.9, 0.25, 0.25, 0.35, 0.5, 0.1];
/** Velikost v px (základ + náhodná část) a růst za sekundu (prach, kruh). */
const SIZE_BASE = [6, 2, 4, 6, 3, 3, 5, 5, 8];
const SIZE_RAND = [3, 3, 5, 4, 3, 3, 6, 6, 4];
const GROW = [0, 0, 0, 0, 0, 0, 0, 14, 150];
/** Rotace za sekundu (±). */
const SPIN = [16, 0, 16, 12, 0, 0, 0, 2, 0];
/** Výchozí směr: 0 nahoru, 1 všemi směry. */
const DIR_OUT = [0, 1, 1, 0, 1, 1, 0, 1, 1];

/** Palety (konstantní řetězce — kreslení nic nealokuje). */
const COIN_FILL = '#f0c94a';
const COIN_EDGE = '#a8780f';
const COIN_SHINE = '#fff3c4';
const SPARK_COLORS = ['#fff3c4', '#ffd75e', '#ff9c3a', '#ffffff', '#ffe08a', '#ffb347'];
const SHARD_COLORS = ['#d9f1ff', '#9fd4f5', '#ffffff', '#bfe3fa', '#e8f7ff', '#8cc8ee'];
const CONFETTI_COLORS = ['#e8a92a', '#c8372d', '#3b7fd8', '#2c7a55', '#f4ecd8', '#7b3fb5'];
const CHIPS_COLORS = ['#3b7fd8', '#6fa6ee', '#a9cdfb', '#2a62b0', '#ffffff', '#5b93e3'];
const MULT_COLORS = ['#d9452f', '#f07a5f', '#ffb09c', '#a8301f', '#ffffff', '#e85c43'];
const DUST_COLORS = ['#cbbd9c', '#a8987a', '#e3d6b6', '#8f8269', '#d8ccb0', '#b5a688'];
const RING_COLORS = ['#ffd75e', '#ff6a4a', '#7fb6ff', '#ffffff'];
/** Plamen podle zbývajícího života (od nejžhavějšího). */
const FIRE_HOT = '#fffbe0';
const FIRE_YELLOW = '#ffd75e';
const FIRE_ORANGE = '#ff8a2a';
const FIRE_RED = '#d9452f';

const TAU = Math.PI * 2;

type RafFn = (cb: FrameRequestCallback) => number;

export interface ParticlesOptions {
  /** Rychlost hry 1–4 (výchozí z CSS proměnné `--speed`). */
  speed?: () => number;
  /** Podvržený `requestAnimationFrame` / `cancelAnimationFrame` (testy). */
  raf?: RafFn;
  caf?: (id: number) => void;
}

function rectOf(target: FxTarget): RectLike | null {
  if (!target) return null;
  const r = 'getBoundingClientRect' in target ? target.getBoundingClientRect() : target;
  return r.width === 0 && r.height === 0 ? null : r;
}

export class Particles {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly ttl = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly rot = new Float32Array(MAX_PARTICLES);
  private readonly spin = new Float32Array(MAX_PARTICLES);
  private readonly kind = new Uint8Array(MAX_PARTICLES);
  private readonly color = new Uint8Array(MAX_PARTICLES);
  private live = 0;
  /** Kam zapisovat, když je bazén plný (přepisuje se dokola). */
  private cursor = 0;
  private frame = 0;
  private last = 0;
  private timeScale = 1;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private sizeDirty = true;
  private readonly raf: RafFn;
  private readonly caf: (id: number) => void;
  private readonly speed: () => number;
  private readonly onResize = (): void => {
    this.sizeDirty = true;
  };
  private readonly onVisibility = (): void => {
    // Skrytá karta: rAF stejně neběží — částice by po návratu doletěly „z minulosti“. Zahodit.
    if (typeof document !== 'undefined' && document.hidden) this.clear();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement | null,
    private enabled: () => boolean,
    opts: ParticlesOptions = {},
  ) {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
    this.speed = opts.speed ?? (() => documentSpeed());
    this.raf =
      opts.raf ?? ((cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0));
    this.caf =
      opts.caf ??
      ((id) => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
      });
    if (ctx && typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** Vymění podmínku zapnutí (nová obrazovka / nastavení). */
  setEnabled(enabled: () => boolean): void {
    this.enabled = enabled;
  }

  /** Žije teď nějaká částice? */
  get active(): boolean {
    return this.live > 0;
  }

  /** Počet živých částic. */
  get count(): number {
    return this.live;
  }

  /** Kapacita bazénu. */
  get capacity(): number {
    return MAX_PARTICLES;
  }

  /** Běží smyčka snímků? */
  get running(): boolean {
    return this.frame !== 0;
  }

  /** Lze teď kreslit (kontext existuje a animace jsou zapnuté)? */
  get ready(): boolean {
    return this.ctx !== null && this.enabled();
  }

  // ─────────────────────────── Výbuchy ───────────────────────────

  /** Výbuch částic v bodě (souřadnice okna, CSS px). */
  burst(kind: ParticleKind, x: number, y: number, opts: BurstOptions = {}): void {
    this.emit(KIND_IDS[kind], x, y, 0, 0, opts);
  }

  /** Výbuch ve středu prvku / obdélníku. */
  burstAt(target: FxTarget, kind: ParticleKind, opts: BurstOptions = {}): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (r) this.emit(KIND_IDS[kind], r.left + r.width / 2, r.top + r.height / 2, 0, 0, opts);
  }

  /** Částice rozeseté po celé ploše prvku / obdélníku (střepy karty, prach). */
  burstRect(target: FxTarget, kind: ParticleKind, opts: BurstOptions = {}): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (r) this.emit(KIND_IDS[kind], r.left, r.top, r.width, r.height, opts);
  }

  // ─────────────────────────── Pojmenované efekty ───────────────────────────

  /** Mince: vydělané peníze letí nahoru, zaplacené (`down`) padají. */
  coins(target: FxTarget, count = 8, direction: 'up' | 'down' = 'up'): void {
    if (!this.ready) return;
    const n = Math.max(1, Math.min(28, Math.round(count)));
    if (direction === 'down') this.burstAt(target, 'coin', { count: n, direction: 'down', speed: 160 });
    else this.burstAt(target, 'coin', { count: n });
  }

  /** Prasklá skleněná karta: střepy po celé ploše, bílé jiskry a záblesk kruhu. */
  glass(target: FxTarget): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (!r) return;
    this.emit(K_SHARD, r.left, r.top, r.width, r.height, { count: 18 });
    this.emit(K_SPARK, r.left, r.top, r.width, r.height, { count: 10, tone: 3, speed: 300 });
    this.emit(K_RING, r.left + r.width / 2, r.top + r.height / 2, 0, 0, { tone: 3, scale: 0.8 });
  }

  /** ×mult: plamínky stoupají ze zdroje, jiskry a rudý kruh. */
  xmult(target: FxTarget, strength = 1): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const s = Math.max(0.5, Math.min(2, strength));
    this.emit(K_FIRE, r.left + r.width * 0.15, cy, r.width * 0.7, r.height * 0.4, {
      count: Math.round(22 * s),
    });
    this.emit(K_SPARK, cx, cy, 0, 0, { count: Math.round(10 * s), speed: 460 });
    this.emit(K_RING, cx, cy, 0, 0, { tone: 1, scale: s });
  }

  /** +čipy / +mult: obláček modrých / červených pixelů. */
  puff(target: FxTarget, tone: 'chips' | 'mult', count = 7): void {
    if (!this.ready) return;
    this.burstAt(target, tone, { count });
  }

  /** Zničená karta / žolík: prach po ploše. */
  dust(target: FxTarget): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (r) this.emit(K_DUST, r.left, r.top, r.width, r.height, { count: 16 });
  }

  /** Velké skóre: zlaté jiskry, dva kruhy a mince; `strength` 0–1. */
  bigScore(target: FxTarget, strength = 0.6): void {
    if (!this.ready) return;
    const r = rectOf(target);
    if (!r) return;
    const s = Math.max(0, Math.min(1, strength));
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.emit(K_SPARK, cx, cy, 0, 0, { count: Math.round(26 + 34 * s), speed: 520 + 260 * s });
    this.emit(K_RING, cx, cy, 0, 0, { tone: 0, scale: 1.4 + s });
    this.emit(K_RING, cx, cy, 0, 0, { tone: 3, scale: 0.9 + s * 0.6 });
    if (s >= 0.5) this.emit(K_CONFETTI, cx, cy, 0, 0, { count: Math.round(24 * s), speed: 520 });
  }

  /** Výhra: dvě konfetová děla zdola a déšť shora. */
  confetti(): void {
    if (!this.ready || typeof window === 'undefined') return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.emit(K_CONFETTI, w * 0.04, h * 0.98, 0, 0, { count: 70, angle: -1.05, cone: 0.55, speed: 1150 });
    this.emit(K_CONFETTI, w * 0.96, h * 0.98, 0, 0, { count: 70, angle: -2.09, cone: 0.55, speed: 1150 });
    this.emit(K_CONFETTI, 0, -10, w, 0, { count: 60, direction: 'down', speed: 120 });
  }

  /** Achievement: hrst konfet z oznámení. */
  celebrate(target: FxTarget): void {
    if (!this.ready) return;
    this.burstAt(target, 'confetti', { count: 34, speed: 520 });
  }

  // ─────────────────────────── Správa ───────────────────────────

  /** Okamžitě smaže všechny částice. */
  clear(): void {
    this.live = 0;
    this.cursor = 0;
    this.stop();
  }

  dispose(): void {
    this.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  /**
   * Posune simulaci o `dt` sekund a vykreslí snímek (smyčka rAF; testy volají přímo). Vrací počet živých částic.
   */
  advance(dt: number): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    this.update(dt * this.timeScale);
    this.draw(ctx);
    return this.live;
  }

  // ─────────────────────────── Vnitřek ───────────────────────────

  /** Vytvoří částice druhu `k` v bodě (w = h = 0) nebo rozeseté po obdélníku. */
  private emit(k: number, x: number, y: number, w: number, h: number, opts: BurstOptions): void {
    if (!this.ready) return;
    const n = Math.max(0, Math.min(opts.count ?? DEFAULT_COUNT[k]!, MAX_PARTICLES));
    const speed = opts.speed ?? DEFAULT_SPEED[k]!;
    const scale = opts.scale ?? 1;
    const dir = opts.direction ?? (DIR_OUT[k] ? 'out' : 'up');
    const cone = opts.cone ?? 1.9;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const area = w > 0 || h > 0;
    for (let i = 0; i < n; i++) {
      let idx: number;
      if (this.live < MAX_PARTICLES) idx = this.live++;
      else {
        idx = this.cursor;
        this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      }
      const sx = area ? x + Math.random() * w : x + (Math.random() - 0.5) * 12;
      const sy = area ? y + Math.random() * h : y + (Math.random() - 0.5) * 12;
      let angle: number;
      if (opts.angle !== undefined) angle = opts.angle + (Math.random() - 0.5) * cone;
      else if (dir === 'up') angle = -Math.PI / 2 + (Math.random() - 0.5) * cone;
      else if (dir === 'down') angle = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      else if (area) angle = Math.atan2(sy - cy, sx - cx) + (Math.random() - 0.5) * 0.9;
      else angle = Math.random() * TAU;
      const v = speed * (0.45 + Math.random() * 0.75);
      this.px[idx] = sx;
      this.py[idx] = sy;
      this.vx[idx] = Math.cos(angle) * v;
      this.vy[idx] = Math.sin(angle) * v;
      const ttl = TTL_BASE[k]! + Math.random() * TTL_RAND[k]!;
      this.ttl[idx] = ttl;
      this.life[idx] = ttl;
      this.size[idx] = (SIZE_BASE[k]! + Math.random() * SIZE_RAND[k]!) * scale;
      this.rot[idx] = Math.random() * TAU;
      this.spin[idx] = (Math.random() - 0.5) * SPIN[k]!;
      this.kind[idx] = k;
      this.color[idx] = k === K_RING || opts.tone !== undefined ? (opts.tone ?? 0) : (Math.random() * 6) | 0;
    }
    this.start();
  }

  private start(): void {
    if (this.frame || !this.ctx || this.live === 0) return;
    this.resizeIfNeeded();
    // Rychlost hry: fyzika se zrychlí o √ rychlosti (4× → 2×), ať efekty nepřečnívají zrychlené skórování.
    this.timeScale = Math.sqrt(clampSpeed(this.speed()));
    this.last = typeof performance !== 'undefined' ? performance.now() : 0;
    this.frame = this.raf(this.tick) || -1;
  }

  private stop(): void {
    if (this.frame > 0) this.caf(this.frame);
    this.frame = 0;
    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    }
  }

  private resizeIfNeeded(): void {
    const canvas = this.canvas;
    if (typeof window === 'undefined') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!canvas || (!this.sizeDirty && dpr === this.dpr)) return;
    this.sizeDirty = false;
    this.dpr = dpr;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    canvas.width = Math.round(this.width * dpr);
    canvas.height = Math.round(this.height * dpr);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (!this.ctx) return;
    if (!this.enabled()) {
      this.clear();
      return;
    }
    this.resizeIfNeeded();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.advance(dt) > 0) this.frame = this.raf(this.tick) || -1;
    else this.stop();
  };

  private update(dt: number): void {
    let i = 0;
    const floor = this.height + 60;
    while (i < this.live) {
      const life = this.life[i]! - dt;
      if (life <= 0 || this.py[i]! > floor) {
        this.remove(i);
        continue;
      }
      const k = this.kind[i]!;
      const drag = 1 - Math.min(1, DRAG[k]! * dt);
      this.life[i] = life;
      this.vx[i] = this.vx[i]! * drag;
      this.vy[i] = this.vy[i]! * drag + GRAVITY[k]! * dt;
      this.px[i] = this.px[i]! + this.vx[i]! * dt;
      this.py[i] = this.py[i]! + this.vy[i]! * dt;
      this.rot[i] = this.rot[i]! + this.spin[i]! * dt;
      const grow = GROW[k]!;
      if (grow !== 0) this.size[i] = this.size[i]! + grow * dt;
      i++;
    }
    if (this.cursor >= this.live) this.cursor = 0;
  }

  /** Odebere částici přesunem poslední na její místo (pořadí nevadí). */
  private remove(i: number): void {
    const last = --this.live;
    if (i === last) return;
    this.px[i] = this.px[last]!;
    this.py[i] = this.py[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.life[i] = this.life[last]!;
    this.ttl[i] = this.ttl[last]!;
    this.size[i] = this.size[last]!;
    this.rot[i] = this.rot[last]!;
    this.spin[i] = this.spin[last]!;
    this.kind[i] = this.kind[last]!;
    this.color[i] = this.color[last]!;
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.width * dpr, this.height * dpr);
    let additive = false;
    for (let i = 0; i < this.live; i++) {
      const x = this.px[i]!;
      const y = this.py[i]!;
      const s = this.size[i]!;
      const rot = this.rot[i]!;
      const k = this.kind[i]!;
      const c = this.color[i]!;
      const f = this.life[i]! / this.ttl[i]!;
      // Jiskry a plamen svítí (sčítání barev), ostatní se kreslí normálně; přepíná se jen při změně.
      const glow = k === K_SPARK || k === K_FIRE;
      if (glow !== additive) {
        additive = glow;
        ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
      }
      ctx.globalAlpha = Math.min(1, f * 1.6);
      switch (k) {
        case K_COIN: {
          // Mince: elipsa „otáčející se“ kolem svislé osy + odlesk.
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const rx = Math.abs(Math.cos(rot)) * s + 0.6;
          ctx.beginPath();
          ctx.ellipse(x, y, rx, s, 0, 0, TAU);
          ctx.fillStyle = COIN_FILL;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = COIN_EDGE;
          ctx.stroke();
          ctx.fillStyle = COIN_SHINE;
          ctx.fillRect(x - rx * 0.35, y - s * 0.55, Math.max(1, rx * 0.3), s * 0.5);
          break;
        }
        case K_SPARK:
        case K_CHIPS:
        case K_MULT: {
          // Pixelové čtverečky (ladí s pixelovým písmem), zmenšují se s životem.
          const palette =
            k === K_SPARK
              ? c === 3
                ? SHARD_COLORS
                : SPARK_COLORS
              : k === K_CHIPS
                ? CHIPS_COLORS
                : MULT_COLORS;
          const q = s * (0.35 + 0.65 * f);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = palette[(i + c) % palette.length]!;
          ctx.fillRect(x - q / 2, y - q / 2, q, q);
          break;
        }
        case K_FIRE: {
          const q = s * (0.45 + 0.55 * f);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = f > 0.72 ? FIRE_HOT : f > 0.48 ? FIRE_YELLOW : f > 0.24 ? FIRE_ORANGE : FIRE_RED;
          ctx.fillRect(x - q / 2, y - q / 2, q, q);
          break;
        }
        case K_DUST: {
          ctx.globalAlpha = f * 0.55;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = DUST_COLORS[c % DUST_COLORS.length]!;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, TAU);
          ctx.fill();
          break;
        }
        case K_RING: {
          ctx.globalAlpha = f * 0.9;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = RING_COLORS[c % RING_COLORS.length]!;
          ctx.lineWidth = 1.5 + 4.5 * f;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, TAU);
          ctx.stroke();
          break;
        }
        case K_SHARD: {
          const cos = Math.cos(rot) * dpr;
          const sin = Math.sin(rot) * dpr;
          ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
          ctx.fillStyle = SHARD_COLORS[c % SHARD_COLORS.length]!;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.7, s * 0.6);
          ctx.lineTo(-s * 0.6, s * 0.4);
          ctx.closePath();
          ctx.fill();
          break;
        }
        default: {
          // Konfety: obdélníček, který se „překlápí“ (zploštění podle rotace) — třepotání.
          const cos = Math.cos(rot) * dpr;
          const sin = Math.sin(rot) * dpr;
          const flip = Math.cos(rot * 1.7 + c);
          ctx.setTransform(cos, sin, -sin * flip, cos * flip, x * dpr, y * dpr);
          ctx.fillStyle = CONFETTI_COLORS[c % CONFETTI_COLORS.length]!;
          ctx.fillRect(-s / 2, -s / 4, s, s / 2);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

let shared: Particles | null = null;

/**
 * Sdílený systém částic nad `<canvas id="fx">` z index.html (vytvoří se při prvním použití).
 * `enabled` se ptá při každém výbuchu i snímku (vypnuté animace okamžitě zastaví kreslení); bez něj platí stav
 * dokumentu (`html.no-anim` z nastavení). `prefers-reduced-motion` částice vždy vypne.
 */
export function particles(enabled?: () => boolean): Particles {
  const check = enabled
    ? (): boolean => enabled() && !prefersReducedMotion()
    : (): boolean => !documentMotionOff();
  if (shared) {
    if (enabled) shared.setEnabled(check);
    return shared;
  }
  const canvas = typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('#fx');
  shared = new Particles(canvas, check);
  return shared;
}

/** Zahodí sdílený systém částic (testy). */
export function resetParticles(): void {
  shared?.dispose();
  shared = null;
}
