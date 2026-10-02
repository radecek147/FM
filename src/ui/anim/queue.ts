/**
 * Fronta animací: sekvenční přehrávání kroků s respektem k rychlosti hry (1×–4×), vypnutým animacím
 * (nastavení), `prefers-reduced-motion` (délky zkrácené na polovinu) a přeskočení mezerníkem.
 *
 *   await anim.wait(300);                 // 300 ms / rychlost (0 při přeskočení)
 *   await anim.run(async () => { … });     // spustí krok, pokud fronta neběží přeskočeně
 *   anim.skip();                           // dokončí zbytek aktuální sekvence okamžitě
 */
import { REDUCED_MOTION_FACTOR } from '../fx/motion';

export interface AnimSettings {
  /** 1–4 */
  speed: number;
  enabled: boolean;
  /** `prefers-reduced-motion`: délky se zkrátí na `REDUCED_MOTION_FACTOR` (src/ui/fx/motion.ts). */
  reducedMotion?: boolean;
}

export class AnimQueue {
  private skipping = false;
  private running = 0;

  constructor(private readonly settings: () => AnimSettings) {}

  /** Běží právě nějaká sekvence? (UI během ní blokuje vstup kromě přeskočení.) */
  get busy(): boolean {
    return this.running > 0;
  }

  /** Probíhá přeskakování (kroky se mají aplikovat bez čekání)? */
  get instant(): boolean {
    const s = this.settings();
    return this.skipping || !s.enabled;
  }

  /** Přepočte délku podle rychlosti (a zkrácení při reduced motion); při přeskočení nebo vypnutých animacích 0. */
  duration(ms: number): number {
    if (this.instant) return 0;
    const s = this.settings();
    const speed = Math.min(4, Math.max(1, s.speed || 1));
    return Math.round((ms * (s.reducedMotion ? REDUCED_MOTION_FACTOR : 1)) / speed);
  }

  wait(ms: number): Promise<void> {
    const d = this.duration(ms);
    if (d <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = (): void => {
        if (this.skipping || performance.now() - started >= d) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Obalí sekvenci animací; po jejím konci se zruší přeskakování. */
  async sequence<T>(fn: () => Promise<T>): Promise<T> {
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.running === 0) this.skipping = false;
    }
  }

  skip(): void {
    if (this.running > 0) this.skipping = true;
  }
}
