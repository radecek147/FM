/**
 * Zvukové efekty (DESIGN 13.6): vlastní syntezátor ve stylu jsfxr nad Web Audio a banka pojmenovaných zvuků.
 * Žádné nahrávky — každý zvuk je pár řádků parametrů.
 *
 * Hlas (`Voice`) = zdroj (square / triangle / sawtooth / sine / šum) → volitelný filtr (dolní propust, horní,
 * pásmová; i s posunem) → obálka (náběh / výdrž / doznění) → sběrnice efektů. Navíc posun frekvence (slide),
 * skok výšky (arpeggio „change“ z jsfxr) a vibrato (LFO na `detune`). Zvuk (`SoundDef`) = jeden nebo víc hlasů
 * s posunem v čase; `play(name, { pitch })` ho transponuje o půltóny.
 *
 * Opakované zvuky se škrtí (`gap` v ms — „tik“ při skórování nejvýš každých ~25 ms) a současně hraje nejvýš
 * `MAX_VOICES` hlasů, ať dlouhý řetěz skórování nezahltí reproduktory ani procesor.
 */
import type { AudioEngine } from './engine';

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise';
export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

export interface Voice {
  wave: Wave;
  /** Počáteční frekvence (Hz). U šumu „barva“: rychlost přehrávání = freq / `NOISE_REF`. */
  freq: number;
  /** Cílová frekvence posunu (exponenciálně). */
  slideTo?: number;
  /** Délka posunu v s (výchozí = celý hlas). */
  slideTime?: number;
  /** Skok výšky: po `at` s se frekvence vynásobí `ratio` (arpeggio). */
  jump?: { at: number; ratio: number };
  /** Náběh, výdrž a doznění obálky (s). */
  attack: number;
  sustain: number;
  decay: number;
  /** Špičková hlasitost hlasu 0–1. */
  volume: number;
  /** Vibrato: rychlost (Hz) a hloubka (centy). */
  vibrato?: { rate: number; depth: number };
  /** Filtr: druh (výchozí dolní propust), frekvence, cílová frekvence posunu, rezonance. */
  filter?: { kind?: FilterKind; freq: number; to?: number; q?: number };
  /** Posun začátku hlasu (s). */
  delay?: number;
}

export interface SoundDef {
  voices: readonly Voice[];
  /** Nejkratší rozestup dvou přehrání (ms) — škrcení opakování. */
  gap?: number;
  /** Nedůležitý zvuk se při plném počtu hlasů zahodí jako první. */
  minor?: boolean;
}

/** Referenční frekvence šumu (rychlost přehrávání 1). */
export const NOISE_REF = 4000;
/** Nejvíc současně znějících hlasů. */
export const MAX_VOICES = 40;
/** Výchozí škrcení opakování (ms). */
export const DEFAULT_GAP = 30;
/** Nejtišší úroveň obálky (exponenciální rampa nesmí na nulu). */
const SILENCE = 0.0001;

/** Půltón → poměr frekvencí. */
export function semitones(n: number): number {
  return 2 ** (n / 12);
}

/** MIDI číslo → Hz (A4 = 69 = 440 Hz). */
export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Délka hlasu (s) včetně posunu začátku. */
export function voiceLength(v: Voice): number {
  return (v.delay ?? 0) + v.attack + v.sustain + v.decay;
}

/** Délka celého zvuku (s). */
export function soundLength(def: SoundDef): number {
  return def.voices.reduce((m, v) => Math.max(m, voiceLength(v)), 0);
}

// ─────────────────────────── Šum ───────────────────────────

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Sdílený buffer bílého šumu (1 s, deterministický LCG — žádné Math.random). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (buf) return buf;
  const length = Math.max(1, Math.floor(ctx.sampleRate || 44100));
  buf = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
  const data = buf.getChannelData(0);
  let x = 0x2f6b1d3;
  for (let i = 0; i < data.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    data[i] = (x / 0xffffffff) * 2 - 1;
  }
  noiseBuffers.set(ctx, buf);
  return buf;
}

// ─────────────────────────── Syntéza jednoho hlasu ───────────────────────────

/** Co syntéza hlasu vytvořila (testy a úklid). */
export interface VoiceNodes {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  lfo: OscillatorNode | null;
  start: number;
  end: number;
}

export interface SynthOptions {
  /** Poměr frekvencí (transpozice), výchozí 1. */
  pitch?: number;
  /** Násobek hlasitosti, výchozí 1. */
  volume?: number;
  /** Po doznění (odpojení uzlů proběhlo). */
  onEnded?: () => void;
}

/**
 * Naplánuje jeden hlas na čas `when` (s, čas kontextu) do `dest`. Vrací vytvořené uzly. Uzly se po doznění samy
 * odpojí (`onended`).
 */
export function synthVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  v: Voice,
  when: number,
  o: SynthOptions = {},
): VoiceNodes {
  const ratio = o.pitch ?? 1;
  const t0 = when + (v.delay ?? 0);
  const tPeak = t0 + Math.max(0.001, v.attack);
  const tHold = tPeak + Math.max(0, v.sustain);
  const end = tHold + Math.max(0.005, v.decay);
  const peak = Math.max(SILENCE * 2, Math.min(1, v.volume * (o.volume ?? 1)));

  let source: AudioScheduledSourceNode;
  let freqParam: AudioParam;
  let detune: AudioParam | null = null;
  let scale = 1;
  if (v.wave === 'noise') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    freqParam = src.playbackRate;
    scale = 1 / NOISE_REF;
    source = src;
  } else {
    const osc = ctx.createOscillator();
    osc.type = v.wave;
    freqParam = osc.frequency;
    detune = osc.detune ?? null;
    source = osc;
  }

  // Výška: počátek, posun (exponenciálně), skok.
  const f0 = clampFreq(v.freq * ratio, v.wave) * scale;
  freqParam.setValueAtTime(f0, t0);
  if (v.slideTo !== undefined) {
    const f1 = clampFreq(v.slideTo * ratio, v.wave) * scale;
    const tSlide = t0 + Math.max(0.005, v.slideTime ?? end - t0);
    freqParam.exponentialRampToValueAtTime(f1, Math.min(end, tSlide));
  }
  if (v.jump) {
    const tj = t0 + v.jump.at;
    if (tj < end) {
      const base = v.slideTo !== undefined ? v.slideTo : v.freq;
      freqParam.setValueAtTime(clampFreq(base * ratio * v.jump.ratio, v.wave) * scale, tj);
    }
  }

  // Vibrato: LFO → zesílení (centy) → detune.
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  if (v.vibrato && detune) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(v.vibrato.rate, t0);
    lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(v.vibrato.depth, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(detune);
  }

  // Filtr.
  let filter: BiquadFilterNode | null = null;
  if (v.filter) {
    filter = ctx.createBiquadFilter();
    filter.type = v.filter.kind ?? 'lowpass';
    const ff0 = clampFilter(v.filter.freq * (v.wave === 'noise' ? ratio : 1));
    filter.frequency.setValueAtTime(ff0, t0);
    if (v.filter.to !== undefined)
      filter.frequency.exponentialRampToValueAtTime(clampFilter(v.filter.to), end);
    if (v.filter.q !== undefined) filter.Q.setValueAtTime(v.filter.q, t0);
  }

  // Obálka.
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, tPeak);
  gain.gain.setValueAtTime(peak, tHold);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  gain.gain.setValueAtTime(0, end + 0.001);

  if (filter) {
    source.connect(filter);
    filter.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(dest);

  source.start(t0);
  source.stop(end + 0.02);
  if (lfo) {
    lfo.start(t0);
    lfo.stop(end + 0.02);
  }
  source.onended = () => {
    for (const n of [source, filter, gain, lfo, lfoGain]) {
      try {
        n?.disconnect();
      } catch {
        // Už odpojeno.
      }
    }
    o.onEnded?.();
  };
  return { source, gain, filter, lfo, start: t0, end };
}

function clampFreq(f: number, wave: Wave): number {
  const max = wave === 'noise' ? NOISE_REF * 4 : 20000;
  return Math.min(max, Math.max(wave === 'noise' ? NOISE_REF * 0.05 : 20, f));
}

function clampFilter(f: number): number {
  return Math.min(20000, Math.max(30, f));
}

// ─────────────────────────── Banka zvuků ───────────────────────────

/** Tóny, ze kterých se banka skládá (C dur — ladí s hudbou v F a C). */
const N = {
  G3: midiToHz(55),
  C4: midiToHz(60),
  E4: midiToHz(64),
  F4: midiToHz(65),
  G4: midiToHz(67),
  A4: midiToHz(69),
  C5: midiToHz(72),
  D5: midiToHz(74),
  E5: midiToHz(76),
  F5: midiToHz(77),
  G5: midiToHz(79),
  A5: midiToHz(81),
  B5: midiToHz(83),
  C6: midiToHz(84),
  E6: midiToHz(88),
  G6: midiToHz(91),
  C7: midiToHz(96),
};

/** Krátké „cvrnknutí“ šumu (karta o kartu). */
function flick(delay = 0, volume = 0.22, freq = 2600): Voice {
  return {
    wave: 'noise',
    freq: 5200,
    slideTo: 2600,
    attack: 0.002,
    sustain: 0.008,
    decay: 0.035,
    volume,
    filter: { kind: 'bandpass', freq, q: 1.4 },
    delay,
  };
}

/** Tón arpeggia (pro fanfárky a znělky). */
function tone(freq: number, delay: number, o: Partial<Voice> = {}): Voice {
  return {
    wave: 'square',
    freq,
    attack: 0.004,
    sustain: 0.05,
    decay: 0.14,
    volume: 0.16,
    filter: { freq: 3600 },
    delay,
    ...o,
  };
}

export const SOUNDS = {
  /** Tlačítko. */
  click: {
    gap: 40,
    minor: true,
    voices: [
      {
        wave: 'square',
        freq: 1250,
        slideTo: 900,
        attack: 0.001,
        sustain: 0.006,
        decay: 0.028,
        volume: 0.11,
        filter: { freq: 3800 },
      },
    ],
  },
  /** Výběr karty (výška roste s počtem vybraných — `pitch`). */
  cardSelect: {
    gap: 25,
    voices: [
      {
        wave: 'triangle',
        freq: N.E5,
        slideTo: N.A5,
        slideTime: 0.04,
        attack: 0.002,
        sustain: 0.025,
        decay: 0.07,
        volume: 0.3,
      },
      flick(0, 0.08, 3200),
    ],
  },
  /** Zrušení výběru. */
  cardDeselect: {
    gap: 25,
    voices: [
      {
        wave: 'triangle',
        freq: N.A5,
        slideTo: N.D5,
        slideTime: 0.05,
        attack: 0.002,
        sustain: 0.02,
        decay: 0.07,
        volume: 0.24,
      },
    ],
  },
  /** Jedna rozdaná karta (hraje se postupně za každou líznutou). */
  deal: { gap: 20, minor: true, voices: [flick(0, 0.2)] },
  /** Zamíchání / přehození (vějíř karet). */
  shuffle: {
    gap: 120,
    voices: [0, 0.03, 0.055, 0.085, 0.11, 0.14, 0.165, 0.2].map((d, i) =>
      flick(d, 0.12 + (i % 3) * 0.03, 2200 + (i % 4) * 400),
    ),
  },
  /** Zahrané karty letí na stůl. */
  playHand: {
    gap: 80,
    voices: [
      {
        wave: 'noise',
        freq: 2400,
        slideTo: 6000,
        attack: 0.03,
        sustain: 0.02,
        decay: 0.12,
        volume: 0.16,
        filter: { kind: 'bandpass', freq: 900, to: 3200, q: 0.9 },
      },
    ],
  },
  /** „Tik“ za krok skórování (čipy) — výšku určuje průběžný mult (`pitch`). */
  scoreTick: {
    gap: 25,
    minor: true,
    voices: [
      {
        wave: 'square',
        freq: N.C5,
        attack: 0.001,
        sustain: 0.012,
        decay: 0.05,
        volume: 0.15,
        filter: { freq: 3200 },
      },
    ],
  },
  /** Krok +mult — jasnější, s oktávou navrch. */
  multTick: {
    gap: 25,
    voices: [
      { wave: 'triangle', freq: N.C5, attack: 0.002, sustain: 0.02, decay: 0.09, volume: 0.28 },
      {
        wave: 'square',
        freq: N.C6,
        attack: 0.002,
        sustain: 0.01,
        decay: 0.06,
        volume: 0.06,
        filter: { freq: 4200 },
      },
    ],
  },
  /** Krok ×mult — rychlé arpeggio nahoru s otevírajícím se filtrem. */
  xmultTick: {
    gap: 40,
    voices: [
      {
        wave: 'sawtooth',
        freq: N.C5,
        jump: { at: 0.05, ratio: semitones(7) },
        attack: 0.003,
        sustain: 0.09,
        decay: 0.12,
        volume: 0.13,
        filter: { freq: 1200, to: 5200, q: 3 },
      },
      {
        wave: 'square',
        freq: N.C6,
        delay: 0.1,
        attack: 0.002,
        sustain: 0.02,
        decay: 0.1,
        volume: 0.07,
        filter: { freq: 5000 },
      },
    ],
  },
  /** Velké skóre (≥ cíl jednou rukou): akord se rozjede nahoru a zazvoní. */
  bigScore: {
    gap: 400,
    voices: [
      tone(N.C5, 0, { wave: 'triangle', volume: 0.26, sustain: 0.3, decay: 0.4 }),
      tone(N.E5, 0.06, { volume: 0.12, sustain: 0.26, decay: 0.38 }),
      tone(N.G5, 0.12, { volume: 0.12, sustain: 0.22, decay: 0.36 }),
      tone(N.C6, 0.18, { volume: 0.13, sustain: 0.2, decay: 0.5, vibrato: { rate: 6, depth: 14 } }),
      {
        wave: 'noise',
        freq: 9000,
        attack: 0.01,
        sustain: 0.05,
        decay: 0.5,
        volume: 0.07,
        filter: { kind: 'highpass', freq: 6000 },
        delay: 0.18,
      },
    ],
  },
  /** Peníze přibyly (mince). */
  coin: {
    gap: 60,
    voices: [
      tone(N.C6, 0, { sustain: 0.04, decay: 0.03, volume: 0.12 }),
      tone(N.G6, 0.055, { sustain: 0.03, decay: 0.22, volume: 0.12 }),
    ],
  },
  /** Zaplacení (pokladna: cvak a dva tóny dolů). */
  pay: {
    gap: 80,
    voices: [
      { ...flick(0, 0.18, 1800), decay: 0.05 },
      tone(N.A5, 0.02, { wave: 'triangle', volume: 0.26, sustain: 0.03, decay: 0.06 }),
      tone(N.E5, 0.09, { wave: 'triangle', volume: 0.24, sustain: 0.03, decay: 0.16 }),
    ],
  },
  /** Prodej žolíka / spotřebky. */
  sell: {
    gap: 120,
    voices: [
      tone(N.E5, 0, { wave: 'triangle', volume: 0.24, sustain: 0.02, decay: 0.05 }),
      tone(N.G5, 0.05, { wave: 'triangle', volume: 0.24, sustain: 0.02, decay: 0.05 }),
      tone(N.C6, 0.1, { sustain: 0.03, decay: 0.2, volume: 0.11 }),
    ],
  },
  /** Zahození: šustnutí a tlumené žuchnutí. */
  discard: {
    gap: 90,
    voices: [
      {
        wave: 'noise',
        freq: 6000,
        slideTo: 1500,
        attack: 0.01,
        sustain: 0.03,
        decay: 0.14,
        volume: 0.2,
        filter: { freq: 4200, to: 700 },
      },
      {
        wave: 'triangle',
        freq: 220,
        slideTo: 90,
        attack: 0.003,
        sustain: 0.02,
        decay: 0.1,
        volume: 0.22,
        delay: 0.05,
      },
    ],
  },
  /** Příchod šéfa: hluboký klesající tritón s vibratem a úder. */
  bossArrive: {
    gap: 800,
    voices: [
      {
        wave: 'sawtooth',
        freq: 110,
        slideTo: 73.4,
        attack: 0.04,
        sustain: 0.35,
        decay: 0.45,
        volume: 0.2,
        vibrato: { rate: 5.5, depth: 25 },
        filter: { freq: 900, to: 300, q: 2 },
      },
      {
        wave: 'sawtooth',
        freq: 155.6,
        slideTo: 103.8,
        attack: 0.04,
        sustain: 0.35,
        decay: 0.45,
        volume: 0.13,
        vibrato: { rate: 5.5, depth: 25 },
        filter: { freq: 900, to: 300, q: 2 },
      },
      {
        wave: 'sine',
        freq: 150,
        slideTo: 40,
        attack: 0.002,
        sustain: 0.04,
        decay: 0.3,
        volume: 0.4,
      },
      {
        wave: 'noise',
        freq: 1500,
        attack: 0.002,
        sustain: 0.02,
        decay: 0.25,
        volume: 0.14,
        filter: { freq: 900 },
      },
    ],
  },
  /** Výhra kola: veselé arpeggio. */
  roundWin: {
    gap: 500,
    voices: [
      tone(N.C5, 0, { volume: 0.14 }),
      tone(N.E5, 0.075, { volume: 0.14 }),
      tone(N.G5, 0.15, { volume: 0.14 }),
      tone(N.C6, 0.225, { volume: 0.15, sustain: 0.15, decay: 0.35 }),
      tone(N.C5, 0.225, { wave: 'triangle', volume: 0.24, sustain: 0.15, decay: 0.35 }),
    ],
  },
  /** Výhra runu (krátká zvonkohra; fanfáru hraje hudba). */
  victory: {
    gap: 1500,
    voices: [N.C6, N.E6, N.G6, N.C7, N.G6, N.C7].map((f, i) =>
      tone(f, i * 0.09, {
        wave: 'triangle',
        volume: 0.22,
        sustain: 0.04,
        decay: i === 5 ? 0.7 : 0.18,
        vibrato: i === 5 ? { rate: 7, depth: 12 } : undefined,
      }),
    ),
  },
  /** Prohra: tři kroky dolů a smutné zakolísání. */
  gameOver: {
    gap: 1500,
    voices: [
      tone(N.G4, 0, { wave: 'sawtooth', volume: 0.14, sustain: 0.16, decay: 0.06, filter: { freq: 1400 } }),
      tone(midiToHz(66), 0.26, {
        wave: 'sawtooth',
        volume: 0.14,
        sustain: 0.16,
        decay: 0.06,
        filter: { freq: 1300 },
      }),
      tone(N.F4, 0.52, {
        wave: 'sawtooth',
        volume: 0.14,
        sustain: 0.16,
        decay: 0.06,
        filter: { freq: 1200 },
      }),
      tone(N.E4, 0.78, {
        wave: 'sawtooth',
        volume: 0.15,
        sustain: 0.36,
        decay: 0.3,
        vibrato: { rate: 5, depth: 35 },
        filter: { freq: 1100, to: 500 },
      }),
    ],
  },
  /** Odemčení obsahu. */
  unlock: {
    gap: 300,
    voices: [N.G5, N.C6, N.E6, N.G6].map((f, i) =>
      tone(f, i * 0.06, {
        wave: 'triangle',
        volume: 0.2,
        sustain: 0.03,
        decay: i === 3 ? 0.45 : 0.12,
      }),
    ),
  },
  /** Achievement: zvonek s třpytem. */
  achievement: {
    gap: 300,
    voices: [
      ...[N.E5, N.A5, N.C6, N.E6].map((f, i) =>
        tone(f, i * 0.07, { wave: 'triangle', volume: 0.22, sustain: 0.03, decay: i === 3 ? 0.6 : 0.14 }),
      ),
      tone(N.A5, 0.21, { volume: 0.06, sustain: 0.1, decay: 0.5, vibrato: { rate: 6, depth: 10 } }),
    ],
  },
  /** Chyba / neplatná akce: dva tlumené bzuky. */
  error: {
    gap: 250,
    voices: [0, 0.11].map((delay) => ({
      wave: 'square' as const,
      freq: 196,
      slideTo: 174.6,
      attack: 0.003,
      sustain: 0.05,
      decay: 0.04,
      volume: 0.12,
      filter: { freq: 1100 },
      delay,
    })),
  },
  /** Otevření obálky: trhnutí papíru a stoupající tón. */
  boosterOpen: {
    gap: 300,
    voices: [
      {
        wave: 'noise',
        freq: 3000,
        slideTo: 8000,
        attack: 0.005,
        sustain: 0.12,
        decay: 0.08,
        volume: 0.18,
        filter: { kind: 'bandpass', freq: 800, to: 3800, q: 1.6 },
      },
      {
        wave: 'triangle',
        freq: N.C5,
        slideTo: N.C6,
        attack: 0.02,
        sustain: 0.12,
        decay: 0.15,
        volume: 0.2,
        delay: 0.08,
      },
    ],
  },
  /** Kupón: úřední razítko (žuchnutí) a cinknutí. */
  voucherBuy: {
    gap: 300,
    voices: [
      {
        wave: 'triangle',
        freq: 170,
        slideTo: 60,
        attack: 0.002,
        sustain: 0.02,
        decay: 0.12,
        volume: 0.4,
      },
      { ...flick(0, 0.2, 1200), decay: 0.06 },
      tone(N.G6, 0.12, { wave: 'triangle', volume: 0.2, sustain: 0.02, decay: 0.35 }),
      tone(N.C7, 0.12, { wave: 'sine', volume: 0.08, sustain: 0.02, decay: 0.3 }),
    ],
  },
  /** Prasklé sklo: tříšť šumu a cinkání střepů. */
  glassBreak: {
    gap: 90,
    voices: [
      {
        wave: 'noise',
        freq: 12000,
        attack: 0.001,
        sustain: 0.02,
        decay: 0.18,
        volume: 0.22,
        filter: { kind: 'highpass', freq: 3500 },
      },
      ...[3520, 4186, 2794, 4699].map((f, i) => ({
        wave: 'triangle' as const,
        freq: f,
        attack: 0.001,
        sustain: 0.005,
        decay: 0.09 + i * 0.03,
        volume: 0.1,
        delay: 0.02 + i * 0.035,
      })),
    ],
  },
  /** Vylepšení kombinace (pranostika) — stoupající kvarty. */
  levelUp: {
    gap: 200,
    voices: [N.C5, N.F5, N.B5 / semitones(1), N.E6 / semitones(1)].map((f, i) =>
      tone(f, i * 0.055, { wave: 'square', volume: 0.1, sustain: 0.02, decay: i === 3 ? 0.3 : 0.08 }),
    ),
  },
  /** Použitá spotřebka / štítek. */
  use: {
    gap: 150,
    voices: [
      {
        wave: 'sine',
        freq: N.G5,
        slideTo: N.G6,
        attack: 0.01,
        sustain: 0.06,
        decay: 0.18,
        volume: 0.22,
        vibrato: { rate: 9, depth: 20 },
      },
      flick(0.02, 0.08, 5000),
    ],
  },
  /** Drobné „puf“ (žolík zareagoval, štítek, výběr z obálky). */
  pop: {
    gap: 50,
    minor: true,
    voices: [
      {
        wave: 'sine',
        freq: 440,
        slideTo: 880,
        slideTime: 0.03,
        attack: 0.002,
        sustain: 0.01,
        decay: 0.06,
        volume: 0.24,
      },
    ],
  },
} as const satisfies Record<string, SoundDef>;

export type SoundName = keyof typeof SOUNDS;

export function isSoundName(name: string): name is SoundName {
  return Object.prototype.hasOwnProperty.call(SOUNDS, name);
}

// ─────────────────────────── Přehrávač ───────────────────────────

export interface PlayOptions {
  /** Transpozice v půltónech. */
  pitch?: number;
  /** Násobek hlasitosti (0–2). */
  volume?: number;
  /** Posun začátku (s) od teď. */
  delay?: number;
  /** Vlastní škrcení (ms) místo výchozího zvuku. */
  gap?: number;
}

/** Co přehrávač potřebuje od enginu (testy podstrčí jednodušší objekt). */
export type SfxOutput = Pick<AudioEngine, 'context' | 'sfxOut' | 'sfxAudible' | 'syncVolumes'>;

export interface SfxPlayerOptions {
  /** Hodiny pro škrcení (ms), výchozí `performance.now`. */
  now?: () => number;
  bank?: Readonly<Record<string, SoundDef>>;
}

export class SfxPlayer {
  private readonly last = new Map<string, number>();
  private active = 0;
  private played = 0;
  private readonly now: () => number;
  private readonly bank: Readonly<Record<string, SoundDef>>;

  constructor(
    private readonly out: SfxOutput,
    opts: SfxPlayerOptions = {},
  ) {
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.bank = opts.bank ?? SOUNDS;
  }

  /** Počet skutečně přehraných zvuků (hooky podle něj poznají, že akce už zazněla). */
  get playCount(): number {
    return this.played;
  }

  /** Právě znějící hlasy. */
  get activeVoices(): number {
    return this.active;
  }

  /**
   * Přehraje zvuk z banky. Vrací true, když se opravdu naplánoval (ne: ztlumeno, bez kontextu, škrceno, plno).
   * Nikdy nevyhazuje.
   */
  play(name: SoundName | string, o: PlayOptions = {}): boolean {
    const def = this.bank[name];
    if (!def) return false;
    try {
      if (!this.out.sfxAudible()) return false;
      const ctx = this.out.context;
      const dest = this.out.sfxOut;
      if (!ctx || !dest) return false;
      const now = this.now();
      const gap = o.gap ?? def.gap ?? DEFAULT_GAP;
      const prev = this.last.get(name);
      if (prev !== undefined && now - prev < gap) return false;
      const voices = def.voices.length;
      if (this.active + voices > MAX_VOICES && (def.minor || this.active >= MAX_VOICES * 1.5)) return false;
      this.last.set(name, now);
      this.out.syncVolumes();
      const when = ctx.currentTime + 0.005 + Math.max(0, o.delay ?? 0);
      const pitch = semitones(o.pitch ?? 0);
      const volume = Math.min(2, Math.max(0, o.volume ?? 1));
      for (const v of def.voices) {
        this.active++;
        synthVoice(ctx, dest, v, when, {
          pitch,
          volume,
          onEnded: () => {
            this.active = Math.max(0, this.active - 1);
          },
        });
      }
      this.played++;
      return true;
    } catch {
      return false;
    }
  }

  /** Zapomene škrcení (testy, nový run). */
  reset(): void {
    this.last.clear();
  }
}
