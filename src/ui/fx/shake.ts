/**
 * Screen shake (DESIGN 13.6): „trauma“ model — každé zatřesení přidá trauma (0–1), to plynule vyprchává a výchylka
 * roste s jeho druhou mocninou (malé otřesy jsou jemné, velké výrazné). Zapisuje se jen `transform` jednoho obalu
 * (herní obrazovka: `.game-main` — žolíci, stůl a ruka; levý panel s čísly stojí, ať jdou číst), nic se neměří.
 *
 *   const shaker = new Shaker(() => mainEl, () => ({ ...app.settings, instant: app.anim.instant }));
 *   shaker.shake(shakeForScore(score, target));   // velké skóre
 *   shaker.shake(SHAKE.boss);                     // příchod šéfa
 *
 * Vypíná ho nastavení „screen shake“, vypnuté animace i `prefers-reduced-motion` (`shakeAllowed`); přeskočení
 * animace (mezerník) ho hned zastaví. Rychlost hry 1×–4× zkracuje dobu doznívání.
 */
import { clampSpeed, shakeAllowed, type MotionSettings } from './motion';

export interface ShakePrefs extends MotionSettings {
  /** Fronta animací přeskakuje (mezerník) — shake skončí hned. */
  instant?: boolean;
}

/** Intenzity zatřesení podle události (0–1). */
export const SHAKE = {
  /** Skóre ruky aspoň polovina cíle kola (lehké „ťuknutí“). */
  half: 0.3,
  /** Příchod šéfa. */
  boss: 0.22,
  /** Prasklá skleněná karta. */
  glass: 0.26,
} as const;

/** Největší výchylka při plném traumatu (px) a natočení (stupně). */
const MAX_OFFSET = 14;
const MAX_ROTATE = 0.8;
/** Kolik traumatu vyprchá za sekundu při rychlosti 1×. */
const DECAY = 1.5;

/**
 * Intenzita zatřesení po zahrané ruce: pod polovinou cíle nic, od poloviny lehce (`SHAKE.half`), od cíle
 * („velké skóre“, DESIGN 13.6) 0,55 a víc podle toho, kolikrát ruka cíl překonala (strop 1).
 */
export function shakeForScore(score: number, target: number): number {
  if (!(score > 0) || !(target > 0) || !Number.isFinite(target)) return 0;
  const ratio = score / target;
  if (ratio < 0.5) return 0;
  if (ratio < 1) return SHAKE.half;
  return Math.min(1, 0.55 + 0.3 * Math.log10(ratio));
}

type RafFn = (cb: FrameRequestCallback) => number;

export class Shaker {
  private trauma = 0;
  private frame = 0;
  private last = 0;
  private time = 0;
  private applied = false;
  private readonly raf: RafFn;
  private readonly caf: (id: number) => void;

  constructor(
    private readonly target: () => HTMLElement | null,
    private readonly prefs: () => ShakePrefs,
    opts: { raf?: RafFn; caf?: (id: number) => void } = {},
  ) {
    this.raf =
      opts.raf ?? ((cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0));
    this.caf =
      opts.caf ??
      ((id) => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
      });
  }

  /** Třese se právě? */
  get active(): boolean {
    return this.trauma > 0;
  }

  /** Aktuální trauma (0–1; testy). */
  get level(): number {
    return this.trauma;
  }

  /**
   * Zatřese obrazovkou s intenzitou 0–1 (sčítá se s doznívajícím otřesem, strop 1). Vrací false, když shake
   * nastavení nebo `prefers-reduced-motion` nedovolí (nebo není co třást).
   */
  shake(intensity: number): boolean {
    const p = this.prefs();
    if (!(intensity > 0) || !shakeAllowed(p) || p.instant || !this.target()) return false;
    this.trauma = Math.min(1, this.trauma + intensity);
    if (!this.frame) {
      this.last = typeof performance !== 'undefined' ? performance.now() : 0;
      this.frame = this.raf(this.tick) || -1;
    }
    return true;
  }

  /** Okamžitě zastaví a vrátí obal na místo. */
  stop(): void {
    this.trauma = 0;
    if (this.frame > 0) this.caf(this.frame);
    this.frame = 0;
    this.reset();
  }

  /** Jeden krok (smyčka rAF; testy volají přímo). Vrací, jestli se ještě třese. */
  step(dt: number): boolean {
    const p = this.prefs();
    const el = this.target();
    if (!el || p.instant || !shakeAllowed(p)) {
      this.stop();
      return false;
    }
    this.trauma = Math.max(0, this.trauma - DECAY * clampSpeed(p.speed) * dt);
    if (this.trauma <= 0) {
      this.stop();
      return false;
    }
    this.time += dt;
    const a = this.trauma * this.trauma;
    // Hladký pseudo-šum ze součtu sinusovek (bez náhody — deterministické, bez alokací).
    const t = this.time;
    const nx = Math.sin(t * 47.3) * 0.6 + Math.sin(t * 83.1 + 1.7) * 0.4;
    const ny = Math.sin(t * 53.9 + 0.6) * 0.6 + Math.sin(t * 71.7 + 2.9) * 0.4;
    const nr = Math.sin(t * 39.1 + 4.2);
    el.style.transform = `translate3d(${(nx * MAX_OFFSET * a).toFixed(2)}px, ${(ny * MAX_OFFSET * a).toFixed(2)}px, 0) rotate(${(nr * MAX_ROTATE * a).toFixed(3)}deg)`;
    this.applied = true;
    return true;
  }

  private reset(): void {
    if (!this.applied) return;
    this.applied = false;
    this.target()?.style.removeProperty('transform');
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.step(dt)) this.frame = this.raf(this.tick) || -1;
  };
}
