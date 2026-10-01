/**
 * Částice na jediném `<canvas id="fx">` přes celou obrazovku (ARCHITECTURE 4, DESIGN 13.6): mince, jiskry,
 * střepy skla a konfety.
 *
 *   const fx = particles(() => app.settings.animations);
 *   fx.burstAt(moneyEl, 'coin', { count: 12 });
 *
 * Výkon: pevný bazén částic v typovaných polích (žádné alokace ve smyčce), smyčka `requestAnimationFrame`
 * běží jen, dokud nějaká částice žije, velikost plátna se přepočítá jen po změně okna. Bez animací
 * (nastavení, `prefers-reduced-motion`) se nic nekreslí. Kontext 2D chybí (testy) = tichý no-op.
 */

export type ParticleKind = 'coin' | 'spark' | 'shard' | 'confetti';

export interface BurstOptions {
  /** Počet částic (výchozí podle druhu). */
  count?: number;
  /** Počáteční rychlost v px/s (výchozí podle druhu). */
  speed?: number;
  /** Vyletí převážně nahoru (mince, konfety). */
  up?: boolean;
}

const MAX_PARTICLES = 480;
const KIND_IDS: Readonly<Record<ParticleKind, number>> = { coin: 0, spark: 1, shard: 2, confetti: 3 };
const DEFAULT_COUNT: Readonly<Record<ParticleKind, number>> = {
  coin: 10,
  spark: 14,
  shard: 12,
  confetti: 60,
};
const DEFAULT_SPEED: Readonly<Record<ParticleKind, number>> = {
  coin: 380,
  spark: 420,
  shard: 300,
  confetti: 620,
};
/** Gravitace podle druhu (px/s²). */
const GRAVITY = [1300, 260, 1100, 520];
/** Odpor vzduchu za sekundu (násobek rychlosti). */
const DRAG = [0.35, 2.2, 0.6, 1.1];
/** Životnost v sekundách (základ + náhodná část). */
const TTL_BASE = [0.9, 0.45, 0.7, 1.6];
const TTL_RAND = [0.4, 0.35, 0.3, 0.9];

/** Palety (konstantní řetězce — kreslení nic nealokuje). */
const COIN_FILL = '#f0c94a';
const COIN_EDGE = '#a8780f';
const SPARK_COLORS = ['#fff3c4', '#ffd75e', '#ff9c3a', '#ffffff'];
const SHARD_COLORS = ['#d9f1ff', '#9fd4f5', '#ffffff', '#bfe3fa'];
const CONFETTI_COLORS = ['#e8a92a', '#c8372d', '#3b7fd8', '#2c7a55', '#f4ecd8', '#7b3fb5'];

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
  private count = 0;
  private frame = 0;
  private last = 0;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private sizeDirty = true;
  private readonly onResize = (): void => {
    this.sizeDirty = true;
  };

  constructor(
    private readonly canvas: HTMLCanvasElement | null,
    private enabled: () => boolean,
  ) {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
    if (ctx && typeof window !== 'undefined')
      window.addEventListener('resize', this.onResize, { passive: true });
  }

  /** Vymění podmínku zapnutí (nová obrazovka / nastavení). */
  setEnabled(enabled: () => boolean): void {
    this.enabled = enabled;
  }

  /** Žije teď nějaká částice? */
  get active(): boolean {
    return this.count > 0;
  }

  /** Výbuch částic v bodě (souřadnice okna, CSS px). */
  burst(kind: ParticleKind, x: number, y: number, opts: BurstOptions = {}): void {
    if (!this.ctx || !this.enabled()) return;
    const k = KIND_IDS[kind];
    const n = Math.min(opts.count ?? DEFAULT_COUNT[kind], MAX_PARTICLES);
    const speed = opts.speed ?? DEFAULT_SPEED[kind];
    const up = opts.up ?? (kind === 'coin' || kind === 'confetti');
    for (let i = 0; i < n; i++) {
      // Plný bazén: přepíše se nejstarší částice (index 0 se posune na konec).
      const idx = this.count < MAX_PARTICLES ? this.count++ : i % MAX_PARTICLES;
      const angle = up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.9 : Math.random() * Math.PI * 2;
      const v = speed * (0.45 + Math.random() * 0.75);
      this.px[idx] = x + (Math.random() - 0.5) * 12;
      this.py[idx] = y + (Math.random() - 0.5) * 12;
      this.vx[idx] = Math.cos(angle) * v;
      this.vy[idx] = Math.sin(angle) * v;
      this.ttl[idx] = TTL_BASE[k]! + Math.random() * TTL_RAND[k]!;
      this.life[idx] = this.ttl[idx]!;
      this.size[idx] =
        kind === 'coin'
          ? 6 + Math.random() * 3
          : kind === 'spark'
            ? 2 + Math.random() * 3
            : 4 + Math.random() * 5;
      this.rot[idx] = Math.random() * Math.PI * 2;
      this.spin[idx] = (Math.random() - 0.5) * 16;
      this.kind[idx] = k;
      this.color[idx] = Math.floor(Math.random() * 6);
    }
    this.start();
  }

  /** Výbuch ve středu prvku (nebo nad ním). */
  burstAt(el: Element | null | undefined, kind: ParticleKind, opts: BurstOptions = {}): void {
    if (!el || !this.ctx || !this.enabled()) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    this.burst(kind, r.left + r.width / 2, r.top + r.height / 2, opts);
  }

  /** Okamžitě smaže všechny částice. */
  clear(): void {
    this.count = 0;
    this.stop();
  }

  dispose(): void {
    this.clear();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onResize);
  }

  private start(): void {
    if (this.frame || !this.ctx) return;
    this.resizeIfNeeded();
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    }
  }

  private resizeIfNeeded(): void {
    const canvas = this.canvas;
    if (!canvas || !this.sizeDirty) return;
    this.sizeDirty = false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
  }

  private readonly tick = (now: number): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.enabled()) {
      this.clear();
      return;
    }
    this.resizeIfNeeded();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw(ctx);
    if (this.count > 0) this.frame = requestAnimationFrame(this.tick);
    else this.stop();
  };

  private update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      const life = this.life[i]! - dt;
      if (life <= 0 || this.py[i]! > this.height + 40) {
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
      i++;
    }
  }

  /** Odebere částici přesunem poslední na její místo (pořadí nevadí). */
  private remove(i: number): void {
    const last = --this.count;
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
    ctx.clearRect(0, 0, this.width * dpr, this.height * dpr);
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i]!;
      const y = this.py[i]!;
      const s = this.size[i]!;
      const rot = this.rot[i]!;
      const k = this.kind[i]!;
      const c = this.color[i]!;
      ctx.globalAlpha = Math.min(1, (this.life[i]! / this.ttl[i]!) * 1.6);
      if (k === 0) {
        // Mince: elipsa „otáčející se“ kolem svislé osy.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.ellipse(x, y, Math.abs(Math.cos(rot)) * s + 0.6, s, 0, 0, Math.PI * 2);
        ctx.fillStyle = COIN_FILL;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COIN_EDGE;
        ctx.stroke();
      } else if (k === 1) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = SPARK_COLORS[c % SPARK_COLORS.length]!;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      } else {
        const cos = Math.cos(rot) * dpr;
        const sin = Math.sin(rot) * dpr;
        ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
        if (k === 2) {
          ctx.fillStyle = SHARD_COLORS[c % SHARD_COLORS.length]!;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.7, s * 0.6);
          ctx.lineTo(-s * 0.6, s * 0.4);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = CONFETTI_COLORS[c % CONFETTI_COLORS.length]!;
          ctx.fillRect(-s / 2, -s / 4, s, s / 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

let shared: Particles | null = null;

/**
 * Sdílený systém částic nad `<canvas id="fx">` z index.html (vytvoří se při prvním použití).
 * `enabled` se ptá při každém výbuchu i snímku (vypnuté animace okamžitě zastaví kreslení).
 */
export function particles(enabled: () => boolean): Particles {
  // MediaQueryList jednou — dotaz se čte v každém snímku a nesmí alokovat.
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const check = (): boolean => enabled() && !(mq?.matches ?? false);
  if (shared) {
    shared.setEnabled(check);
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
