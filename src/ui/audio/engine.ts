/**
 * Zvukový engine (DESIGN 13.4 a 13.6): jeden líně vytvořený `AudioContext` a tři sběrnice
 *
 *   zdroje SFX → sfxBus ─┐
 *   hudba      → musicBus ┴→ master → limiter → destination
 *
 * - Kontext vzniká (a obnovuje se) až po gestu hráče (`unlock` z posluchačů `installGestureUnlock`) — politika
 *   autoplay prohlížečů; dřív by Chrome do konzole hlásil varování. Kde gesto ještě neproběhlo
 *   (`navigator.userActivation.hasBeenActive`), se nic nevytváří.
 * - Hlasitosti jdou z nastavení (`levels()`), `syncVolumes` je promítne plynule do zesílení sběrnic (živě při
 *   posunu posuvníku). Křivka je kvadratická — 50 % na posuvníku zní jako polovina, ne jako skoro plno.
 * - Skrytá karta prohlížeče (`visibilitychange`) zvuk ztlumí a kontext uspí; po návratu ho probudí.
 * - Bez Web Audio (testy, starý prohlížeč) je všechno tichá no-op: nic nevyhazuje a nic nepíše do konzole.
 */

/** Hlasitosti z nastavení hráče (0–1) a „ztlumit vše“. */
export interface AudioLevels {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

/** Vytvoří kontext, nebo vrátí null (Web Audio chybí / prohlížeč ho odmítl). Testy podstrčí mock. */
export type ContextFactory = () => AudioContext | null;

/** Hudba je proti efektům o kus tišší (podklad, ne hlavní role). */
export const MUSIC_HEADROOM = 0.45;
/** Efekty celkově (aby 100 % neřvalo přes reproduktory notebooku). */
export const SFX_HEADROOM = 0.9;
/** Časová konstanta plynulé změny zesílení (s) — posuvník nevrže. */
const GAIN_SMOOTHING = 0.03;

type CtxCtor = new (options?: AudioContextOptions) => AudioContext;

function contextCtor(): CtxCtor | null {
  const g = globalThis as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Umí prostředí Web Audio? */
export function webAudioSupported(): boolean {
  return contextCtor() !== null;
}

/** Výchozí továrna: `AudioContext` (nebo `webkitAudioContext`), chyba = null. */
export const defaultContextFactory: ContextFactory = () => {
  const Ctor = contextCtor();
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
};

/** Smí se kontext vytvořit? Jen po gestu hráče (User Activation API); bez API to rozhodne posluchač gesta. */
export function hasUserActivation(): boolean {
  const nav = (globalThis as { navigator?: { userActivation?: { hasBeenActive?: boolean } } }).navigator;
  const ua = nav?.userActivation;
  return ua ? ua.hasBeenActive === true : true;
}

/** Hlasitost posuvníku 0–1 → zesílení (kvadratická křivka, oříznutá). */
export function volumeToGain(v: number): number {
  const x = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return x * x;
}

export interface AudioEngineOptions {
  /** Aktuální hlasitosti (čte se při každé synchronizaci — nastavení se může změnit kdykoli). */
  levels: () => AudioLevels;
  createContext?: ContextFactory;
  /** Smí se teď kontext vytvořit (gesto proběhlo)? Výchozí `hasUserActivation`. */
  canStart?: () => boolean;
}

/** Události, které prohlížeč počítá za gesto hráče (aktivace pro autoplay). */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'touchend'] as const;

function noop(): void {}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private hidden = false;
  /** Kontext nejde vytvořit (není Web Audio) — dál to nezkoušet. */
  private failed = false;
  /** Poslední promítnuté zesílení (master, sfx, music) — beze změny se automatizace nepřidává. */
  private applied: [number, number, number] = [-1, -1, -1];
  private readyListeners = new Set<() => void>();
  private disposers: (() => void)[] = [];

  constructor(private readonly opts: AudioEngineOptions) {}

  /** Kontext, pokud už vznikl (jinak null — zvuk se zatím nehraje). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Vstup sběrnice efektů (null = zvuk není k dispozici). */
  get sfxOut(): AudioNode | null {
    return this.sfx;
  }

  /** Vstup sběrnice hudby. */
  get musicOut(): AudioNode | null {
    return this.music;
  }

  /** Je karta skrytá (zvuk uspaný)? */
  get isHidden(): boolean {
    return this.hidden;
  }

  /** Aktuální hlasitosti z nastavení (bezpečně, i když getter selže). */
  levels(): AudioLevels {
    try {
      const l = this.opts.levels();
      return { sfxVolume: l.sfxVolume, musicVolume: l.musicVolume, muted: l.muted === true };
    } catch {
      return { sfxVolume: 0, musicVolume: 0, muted: true };
    }
  }

  /** Kontext běží nebo se rozbíhá a karta je vidět — má smysl plánovat zvuky. */
  get active(): boolean {
    const c = this.ctx;
    return c !== null && !this.hidden && c.state !== 'closed';
  }

  /** Mají se hrát efekty? (kontext je, není ztlumeno, hlasitost > 0) */
  sfxAudible(): boolean {
    const l = this.levels();
    return this.active && !l.muted && l.sfxVolume > 0;
  }

  /** Má hrát hudba? */
  musicAudible(): boolean {
    const l = this.levels();
    return this.active && !l.muted && l.musicVolume > 0;
  }

  /**
   * Vytvoří kontext (poprvé) nebo ho probudí. Volá se z gesta hráče. Vrací true, když kontext existuje.
   * Nikdy nevyhazuje.
   */
  unlock(): boolean {
    if (this.failed) return false;
    if (!this.ctx) {
      if (!this.allowedToStart()) return false;
      const factory = this.opts.createContext ?? defaultContextFactory;
      let ctx: AudioContext | null = null;
      try {
        ctx = factory();
      } catch {
        ctx = null;
      }
      if (!ctx) {
        this.failed = true;
        return false;
      }
      try {
        this.build(ctx);
      } catch {
        this.failed = true;
        this.ctx = null;
        try {
          void ctx.close?.().catch(noop);
        } catch {
          // Zavření rozbitého kontextu nevyšlo — necháme ho garbage collectoru.
        }
        return false;
      }
    }
    this.resume();
    return true;
  }

  /** Posluchače gest na `target` (document): první gesto vytvoří kontext, další ho případně probudí. */
  installGestureUnlock(target: EventTarget | null = typeof document === 'undefined' ? null : document): void {
    if (!target || !webAudioSupportedOr(this.opts.createContext)) return;
    const onGesture = (): void => {
      if (this.ctx && this.ctx.state === 'running') return;
      this.unlock();
    };
    for (const type of GESTURE_EVENTS)
      target.addEventListener(type, onGesture, { capture: true, passive: true });
    this.disposers.push(() => {
      for (const type of GESTURE_EVENTS) target.removeEventListener(type, onGesture, { capture: true });
    });
  }

  /** Skrytá karta → ztlumit a uspat; viditelná → probudit (`visibilitychange`). */
  installVisibility(doc: Document | null = typeof document === 'undefined' ? null : document): void {
    if (!doc) return;
    const onChange = (): void => this.setHidden(doc.visibilityState === 'hidden');
    doc.addEventListener('visibilitychange', onChange);
    this.disposers.push(() => doc.removeEventListener('visibilitychange', onChange));
    if (doc.visibilityState === 'hidden') this.hidden = true;
  }

  /** Karta schovaná / zase vidět. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.syncVolumes();
    const c = this.ctx;
    if (!c) return;
    if (hidden) {
      try {
        if (c.state === 'running') void c.suspend().catch(noop);
      } catch {
        // Uspání selhalo — stačí ztlumení.
      }
    } else {
      this.resume();
    }
  }

  /** Zavolá `fn`, kdykoli se kontext rozběhne (po prvním gestu, po návratu na kartu). Vrací odhlášení. */
  onReady(fn: () => void): () => void {
    this.readyListeners.add(fn);
    return () => this.readyListeners.delete(fn);
  }

  /**
   * Promítne hlasitosti z nastavení do zesílení sběrnic. `immediate` = bez dojezdu (start). Volá se při změně
   * nastavení a levně i před každým zvukem (beze změny nic nedělá).
   */
  syncVolumes(immediate = false): void {
    const c = this.ctx;
    if (!c || !this.master || !this.sfx || !this.music) return;
    const l = this.levels();
    const target: [number, number, number] = [
      l.muted || this.hidden ? 0 : 1,
      volumeToGain(l.sfxVolume) * SFX_HEADROOM,
      volumeToGain(l.musicVolume) * MUSIC_HEADROOM,
    ];
    const nodes = [this.master, this.sfx, this.music];
    for (let i = 0; i < 3; i++) {
      const value = target[i]!;
      if (!immediate && Math.abs(this.applied[i]! - value) < 1e-6) continue;
      this.applied[i] = value;
      setGain(nodes[i]!.gain, value, c.currentTime, immediate);
    }
  }

  /** Odpojí posluchače a zavře kontext (testy, HMR). */
  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.readyListeners.clear();
    const c = this.ctx;
    this.ctx = this.master = this.sfx = this.music = null;
    if (c) {
      try {
        void c.close?.().catch(noop);
      } catch {
        // Kontext už je zavřený.
      }
    }
  }

  private allowedToStart(): boolean {
    try {
      return (this.opts.canStart ?? hasUserActivation)();
    } catch {
      return false;
    }
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    sfx.connect(master);
    music.connect(master);
    // Pojistka proti přebuzení při 100 % hudby i efektů naráz: limiter nad −3 dB (běžně do zvuku nesahá).
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }
    this.ctx = ctx;
    this.master = master;
    this.sfx = sfx;
    this.music = music;
    this.applied = [-1, -1, -1];
    this.syncVolumes(true);
    try {
      ctx.addEventListener?.('statechange', () => {
        if (ctx.state === 'running' && !this.hidden) this.emitReady();
      });
    } catch {
      // Starší implementace bez addEventListener — připravenost ohlásí `resume`.
    }
  }

  private resume(): void {
    const c = this.ctx;
    if (!c || this.hidden) return;
    this.syncVolumes();
    if (c.state === 'running') {
      this.emitReady();
      return;
    }
    if (c.state === 'closed') return;
    try {
      void c
        .resume()
        .then(() => {
          if (c.state === 'running' && !this.hidden) this.emitReady();
        })
        .catch(noop);
    } catch {
      // Prohlížeč probuzení odmítl — zkusí se při dalším gestu.
    }
  }

  private emitReady(): void {
    for (const fn of [...this.readyListeners]) {
      try {
        fn();
      } catch {
        // Chyba posluchače (hudba) nesmí shodit zvuk ani hru.
      }
    }
  }
}

function webAudioSupportedOr(factory: ContextFactory | undefined): boolean {
  return factory !== undefined || webAudioSupported();
}

/** Plynulá (nebo okamžitá) změna AudioParam bez lupnutí. */
export function setGain(param: AudioParam, value: number, now: number, immediate = false): void {
  try {
    param.cancelScheduledValues(now);
    if (immediate) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, GAIN_SMOOTHING);
  } catch {
    try {
      param.value = value;
    } catch {
      // Parametr nejde nastavit — zvuk zůstane, jak byl.
    }
  }
}
