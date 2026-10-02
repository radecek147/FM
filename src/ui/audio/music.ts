/**
 * Procedurální chiptune (DESIGN 13.6): dvě vlastní smyčky a dvě znělky, všechno složené kódem — žádná převzatá
 * melodie. Harmonie jsou obecné lidové kadence (T–D–T, valčík), melodii skládá malý seedovaný generátor
 * (`composeSong`) z akordových a sousedních tónů; se stejným seedem vyjde pokaždé stejně.
 *
 * - **menu** — klidný hospodský valčík (3/4, G dur, ~100 BPM): basa na „raz“, akord na „dva, tři“, měkký trojúhelník
 *   s vibratem.
 * - **game** — polka „um-ca“ (2/4, F dur, ~128 BPM): basa střídá základ a kvintu, akordy na „ca“, buben a virbl.
 *   U šéfa tempo +15 % (`setBoss`), přepne se na hranici taktu.
 * - **znělky** — výhra (fanfára s vířením) a prohra (sestup do moll); smyčka pak mlčí až do další změny nálady.
 *
 * Plánování podle hodin Web Audio („lookahead scheduler“): časovač každých ~25 ms naplánuje noty, které začínají
 * v příštích ~150 ms, přesně na `currentTime` kontextu — takže hudba nedrhne, ani když hlavní vlákno chvíli
 * nestíhá. Hudba hraje jen tehdy, když je hlasitost hudby > 0 a zvuk není ztlumený (`sync`).
 */
import type { AudioEngine } from './engine';
import type { Voice } from './sfx';
import { midiToHz, synthVoice } from './sfx';

export type MusicMood = 'menu' | 'game';
export type StingerKind = 'victory' | 'gameOver';
export type Instrument = 'lead' | 'bass' | 'chord' | 'kick' | 'snare' | 'hat' | 'crash';

/** Nota v mřížce kroků (krok = 1 / `stepsPerBeat` doby). */
export interface NoteEvent {
  step: number;
  /** Délka v krocích. */
  len: number;
  inst: Instrument;
  /** MIDI výška (u bicích se ignoruje). */
  midi: number;
  /** Síla 0–1. */
  vel: number;
}

export interface Song {
  id: MusicMood | StingerKind;
  bpm: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  bars: number;
  notes: readonly NoteEvent[];
}

/** O kolik se zrychlí hra u šéfa (DESIGN 13.6). */
export const BOSS_TEMPO = 1.15;
/** Jak daleko dopředu se plánuje (s). */
export const LOOKAHEAD = 0.15;
/** Jak často běží plánovač (ms). */
export const SCHEDULER_INTERVAL = 25;

export function stepsPerBar(song: Song): number {
  return song.stepsPerBeat * song.beatsPerBar;
}

export function totalSteps(song: Song): number {
  return stepsPerBar(song) * song.bars;
}

/** Délka kroku v sekundách při daném násobku tempa. */
export function stepSeconds(song: Song, tempo = 1): number {
  return 60 / (song.bpm * tempo) / song.stepsPerBeat;
}

// ─────────────────────────── Skladatel ───────────────────────────

/** Durová stupnice v půltónech. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** MIDI tón stupně stupnice (0 = tónika `root`, 7 = o oktávu výš, záporné = níž). */
export function degreeToMidi(root: number, degree: number): number {
  const oct = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return root + oct * 12 + MAJOR[idx]!;
}

/** Akord: stupeň základu (0–6) a septima. */
interface Chord {
  root: number;
  seventh?: boolean;
}

/** Stupně akordových tónů (tercie nad základem). */
function chordDegrees(c: Chord): number[] {
  const d = [c.root, c.root + 2, c.root + 4];
  if (c.seventh) d.push(c.root + 6);
  return d;
}

function isChordTone(c: Chord, degree: number): boolean {
  const m = ((degree % 7) + 7) % 7;
  return chordDegrees(c).some((d) => ((d % 7) + 7) % 7 === m);
}

/** Malý seedovaný generátor (mulberry32) — skladba vyjde pokaždé stejně. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rhythm = readonly (readonly [start: number, len: number])[];

interface MelodyStyle {
  rhythms: readonly Rhythm[];
  cadence: Rhythm;
  /** Rozsah melodie ve stupních (vůči tónice tóniny). */
  low: number;
  high: number;
  stepsPerBeat: number;
}

/**
 * Melodie jedné fráze nad akordy: na dobách akordový tón blízko předchozího, mezi nimi krok nebo skok o tercii
 * k dalšímu cíli. Poslední takt fráze (`cadence`) skončí na tónice.
 */
function composeMelody(
  rnd: () => number,
  chords: readonly Chord[],
  style: MelodyStyle,
  root: number,
  startDegree: number,
  barOffset: number,
  spb: number,
  endOnTonic: boolean,
): { notes: NoteEvent[]; last: number } {
  const notes: NoteEvent[] = [];
  let cur = startDegree;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length]!;
  chords.forEach((chord, bar) => {
    const lastBar = bar === chords.length - 1;
    const rhythm = lastBar ? style.cadence : pick(style.rhythms);
    rhythm.forEach(([start, len], j) => {
      const strong = start % style.stepsPerBeat === 0;
      let next: number;
      if (lastBar && j === 0 && endOnTonic) {
        // Závěr fráze: tónika nejblíž aktuální výšce.
        next = Math.round(cur / 7) * 7;
      } else if (strong) {
        // Akordový tón v okolí ±4 stupňů, mírně preferuj pohyb (ne opakování).
        const options: number[] = [];
        for (let d = cur - 4; d <= cur + 4; d++)
          if (d >= style.low && d <= style.high && isChordTone(chord, d)) options.push(d);
        const moving = options.filter((d) => d !== cur);
        next = options.length === 0 ? cur : pick(moving.length > 0 && rnd() < 0.8 ? moving : options);
      } else {
        const step = pick([-2, -1, -1, 1, 1, 2]);
        next = cur + step;
      }
      next = Math.min(style.high, Math.max(style.low, next));
      cur = next;
      notes.push({
        step: (barOffset + bar) * spb + start,
        len,
        inst: 'lead',
        midi: degreeToMidi(root, next),
        vel: strong ? 0.95 : 0.75,
      });
    });
  });
  return { notes, last: cur };
}

interface SongPlan {
  id: MusicMood;
  bpm: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  /** Tónika (MIDI) melodie; basa o dvě oktávy níž, akordy o oktávu níž. */
  root: number;
  phrases: { A: readonly Chord[]; B: readonly Chord[] };
  style: MelodyStyle;
  /** Doprovod jednoho taktu nad akordem. */
  accompany(chord: Chord, barStep: number, barIndex: number, out: NoteEvent[]): void;
  seed: number;
}

const I: Chord = { root: 0 };
const IV: Chord = { root: 3 };
const V7: Chord = { root: 4, seventh: true };
const VI: Chord = { root: 5 };
const II: Chord = { root: 1 };

/** Polka do hry: F dur, 2/4, šestnáctiny. */
const GAME_PLAN: SongPlan = {
  id: 'game',
  bpm: 128,
  stepsPerBeat: 4,
  beatsPerBar: 2,
  root: 65, // F4
  phrases: {
    A: [I, I, V7, V7, V7, V7, I, I],
    B: [IV, IV, I, I, V7, V7, I, V7],
  },
  style: {
    stepsPerBeat: 4,
    low: -2,
    high: 9,
    rhythms: [
      [
        [0, 2],
        [2, 2],
        [4, 2],
        [6, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 2],
        [4, 4],
      ],
      [
        [0, 3],
        [3, 1],
        [4, 2],
        [6, 2],
      ],
      [
        [0, 2],
        [2, 1],
        [3, 1],
        [4, 4],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 2],
        [6, 2],
      ],
      [
        [0, 4],
        [4, 2],
        [6, 2],
      ],
    ],
    cadence: [
      [0, 4],
      [6, 2],
    ],
  },
  accompany(chord, barStep, barIndex, out) {
    const bassRoot = degreeToMidi(65 - 24, chord.root);
    // „Um“: základ na raz, kvinta (pod základem) na dvě; „ca“: akord na osminové době.
    out.push({ step: barStep, len: 2, inst: 'bass', midi: bassRoot, vel: 0.95 });
    out.push({ step: barStep + 4, len: 2, inst: 'bass', midi: bassRoot - 5, vel: 0.8 });
    const chordNotes = chordDegrees(chord)
      .slice(0, 3)
      .map((d) => degreeToMidi(65 - 12, d));
    for (const s of [2, 6])
      for (const midi of chordNotes) out.push({ step: barStep + s, len: 1, inst: 'chord', midi, vel: 0.7 });
    out.push({ step: barStep, len: 1, inst: 'kick', midi: 0, vel: 1 });
    out.push({ step: barStep + 4, len: 1, inst: 'kick', midi: 0, vel: 0.85 });
    out.push({ step: barStep + 2, len: 1, inst: 'snare', midi: 0, vel: 0.5 });
    out.push({ step: barStep + 6, len: 1, inst: 'snare', midi: 0, vel: 0.55 });
    for (const s of [1, 3, 5, 7]) out.push({ step: barStep + s, len: 1, inst: 'hat', midi: 0, vel: 0.5 });
    // Každý 8. takt víření do další fráze.
    if (barIndex % 8 === 7)
      for (const s of [5, 6, 7])
        out.push({ step: barStep + s, len: 1, inst: 'snare', midi: 0, vel: 0.4 + s * 0.06 });
  },
  seed: 0x4b415242, // „KARB“
};

/** Valčík do menu: G dur, 3/4, osminy. */
const MENU_PLAN: SongPlan = {
  id: 'menu',
  bpm: 100,
  stepsPerBeat: 2,
  beatsPerBar: 3,
  root: 67, // G4
  phrases: {
    A: [I, IV, V7, I, VI, IV, V7, I],
    B: [IV, I, V7, I, IV, I, II, V7],
  },
  style: {
    stepsPerBeat: 2,
    low: -3,
    high: 8,
    rhythms: [
      [
        [0, 4],
        [4, 2],
      ],
      [
        [0, 2],
        [2, 2],
        [4, 2],
      ],
      [
        [0, 3],
        [3, 1],
        [4, 2],
      ],
      [
        [0, 2],
        [2, 1],
        [3, 1],
        [4, 2],
      ],
      [[0, 6]],
    ],
    cadence: [[0, 6]],
  },
  accompany(chord, barStep, _barIndex, out) {
    out.push({ step: barStep, len: 2, inst: 'bass', midi: degreeToMidi(67 - 24, chord.root), vel: 0.85 });
    const chordNotes = chordDegrees(chord)
      .slice(0, 3)
      .map((d) => degreeToMidi(67 - 12, d));
    for (const s of [2, 4]) {
      for (const midi of chordNotes) out.push({ step: barStep + s, len: 2, inst: 'chord', midi, vel: 0.55 });
      out.push({ step: barStep + s, len: 1, inst: 'hat', midi: 0, vel: 0.25 });
    }
  },
  seed: 0x53544d47, // „STMG“ (Štamgast)
};

/** Složí smyčku podle plánu: forma A A′ B A (A′ = A s novým koncem). */
function composeFromPlan(plan: SongPlan): Song {
  const rnd = seededRandom(plan.seed);
  const spb = plan.stepsPerBeat * plan.beatsPerBar;
  const { A, B } = plan.phrases;
  const notes: NoteEvent[] = [];
  // Fráze A (8 taktů) jednou, pak varianta konce, B a návrat A.
  const a = composeMelody(rnd, A, plan.style, plan.root, 4, 0, spb, true);
  const aTailStart = 4;
  const aTail = composeMelody(rnd, A.slice(aTailStart), plan.style, plan.root, 4, 8 + aTailStart, spb, true);
  const b = composeMelody(rnd, B, plan.style, plan.root, a.last, 16, spb, false);
  const shift = (list: NoteEvent[], bars: number): NoteEvent[] =>
    list.map((n) => ({ ...n, step: n.step + bars * spb }));
  notes.push(...a.notes);
  notes.push(...shift(a.notes, 8).filter((n) => n.step < (8 + aTailStart) * spb), ...aTail.notes);
  notes.push(...b.notes);
  notes.push(...shift(a.notes, 24));
  const form = [...A, ...A, ...B, ...A];
  form.forEach((chord, bar) => plan.accompany(chord, bar * spb, bar, notes));
  notes.sort((x, y) => x.step - y.step);
  return {
    id: plan.id,
    bpm: plan.bpm,
    stepsPerBeat: plan.stepsPerBeat,
    beatsPerBar: plan.beatsPerBar,
    bars: form.length,
    notes,
  };
}

const songCache = new Map<MusicMood, Song>();

/** Smyčka pro náladu (složená jednou, pak z mezipaměti). */
export function composeSong(mood: MusicMood): Song {
  let song = songCache.get(mood);
  if (!song) {
    song = composeFromPlan(mood === 'game' ? GAME_PLAN : MENU_PLAN);
    songCache.set(mood, song);
  }
  return song;
}

function n(step: number, len: number, inst: Instrument, midi: number, vel = 0.9): NoteEvent {
  return { step, len, inst, midi, vel };
}

/** Znělky (hrají jednou). */
export function stingerSong(kind: StingerKind): Song {
  if (kind === 'victory') {
    // F dur: rozběh nahoru, vířivý virbl, dlouhý akord s činelem.
    const lead = [72, 77, 81, 84, 81, 84, 86].map((m, i) =>
      n([0, 2, 4, 6, 8, 11, 12][i]!, i === 4 ? 3 : 2, 'lead', m),
    );
    return {
      id: 'victory',
      bpm: 150,
      stepsPerBeat: 4,
      beatsPerBar: 4,
      bars: 2,
      notes: [
        ...lead,
        n(16, 14, 'lead', 89, 1),
        ...[65, 69, 72].map((m) => n(16, 14, 'chord', m, 0.8)),
        n(0, 4, 'bass', 41),
        n(4, 4, 'bass', 48),
        n(8, 4, 'bass', 46),
        n(12, 4, 'bass', 48),
        n(16, 14, 'bass', 41, 1),
        n(0, 1, 'kick', 0, 1),
        n(8, 1, 'kick', 0, 0.9),
        ...[12, 13, 14, 15].map((s) => n(s, 1, 'snare', 0, 0.4 + (s - 12) * 0.15)),
        n(16, 1, 'kick', 0, 1),
        n(16, 1, 'crash', 0, 1),
      ],
    };
  }
  // Prohra: f moll, pomalu dolů a konec na dominantě (nedořečeno).
  return {
    id: 'gameOver',
    bpm: 84,
    stepsPerBeat: 2,
    beatsPerBar: 4,
    bars: 2,
    notes: [
      n(0, 2, 'lead', 72, 0.85),
      n(2, 2, 'lead', 70, 0.8),
      n(4, 2, 'lead', 68, 0.8),
      n(6, 2, 'lead', 67, 0.8),
      n(8, 8, 'lead', 65, 0.9),
      ...[65, 68, 72].map((m) => n(0, 4, 'chord', m - 12, 0.6)),
      ...[61, 65, 68].map((m) => n(4, 4, 'chord', m - 12, 0.6)),
      ...[60, 64, 67].map((m) => n(8, 8, 'chord', m - 12, 0.6)),
      n(0, 4, 'bass', 41, 0.9),
      n(4, 4, 'bass', 37, 0.9),
      n(8, 8, 'bass', 36, 0.9),
      n(8, 1, 'kick', 0, 0.7),
    ],
  };
}

// ─────────────────────────── Nástroje ───────────────────────────

/** Hlas syntezátoru pro notu (`dur` = délka noty v s). */
export function instrumentVoice(
  song: Song['id'],
  inst: Instrument,
  midi: number,
  dur: number,
  vel: number,
): Voice {
  const soft = song === 'menu';
  const v = Math.max(0, Math.min(1, vel));
  switch (inst) {
    case 'lead':
      return soft
        ? {
            wave: 'triangle',
            freq: midiToHz(midi),
            attack: 0.02,
            sustain: Math.max(0.02, dur * 0.7),
            decay: 0.22,
            volume: 0.3 * v,
            vibrato: dur > 0.4 ? { rate: 5, depth: 9 } : undefined,
          }
        : {
            wave: 'square',
            freq: midiToHz(midi),
            attack: 0.004,
            sustain: Math.max(0.02, dur * 0.6),
            decay: 0.09,
            volume: 0.13 * v,
            filter: { freq: 3200 },
            vibrato: dur > 0.35 ? { rate: 6, depth: 10 } : undefined,
          };
    case 'bass':
      return {
        wave: 'triangle',
        freq: midiToHz(midi),
        attack: 0.004,
        sustain: Math.max(0.02, dur * (soft ? 0.8 : 0.55)),
        decay: soft ? 0.2 : 0.06,
        volume: 0.34 * v,
      };
    case 'chord':
      return soft
        ? {
            wave: 'triangle',
            freq: midiToHz(midi),
            attack: 0.012,
            sustain: Math.max(0.02, dur * 0.5),
            decay: 0.18,
            volume: 0.07 * v,
          }
        : {
            wave: 'square',
            freq: midiToHz(midi),
            attack: 0.003,
            sustain: Math.min(0.05, dur * 0.5),
            decay: 0.06,
            volume: 0.045 * v,
            filter: { freq: 2200 },
          };
    case 'kick':
      return {
        wave: 'sine',
        freq: 140,
        slideTo: 42,
        slideTime: 0.09,
        attack: 0.001,
        sustain: 0.02,
        decay: 0.13,
        volume: 0.38 * v,
      };
    case 'snare':
      return {
        wave: 'noise',
        freq: 4000,
        attack: 0.001,
        sustain: 0.01,
        decay: 0.09,
        volume: 0.2 * v,
        filter: { kind: 'bandpass', freq: 1900, q: 0.8 },
      };
    case 'hat':
      return {
        wave: 'noise',
        freq: 9000,
        attack: 0.001,
        sustain: 0.004,
        decay: soft ? 0.05 : 0.03,
        volume: (soft ? 0.05 : 0.07) * v,
        filter: { kind: 'highpass', freq: 7000 },
      };
    case 'crash':
      return {
        wave: 'noise',
        freq: 10000,
        attack: 0.002,
        sustain: 0.05,
        decay: 1.1,
        volume: 0.13 * v,
        filter: { kind: 'highpass', freq: 5000 },
      };
  }
}

// ─────────────────────────── Přehrávač ───────────────────────────

/** Co přehrávač potřebuje od enginu. */
export type MusicOutput = Pick<AudioEngine, 'context' | 'musicOut' | 'musicAudible' | 'syncVolumes'>;

export interface MusicPlayerOptions {
  lookahead?: number;
  interval?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

function indexByStep(song: Song): NoteEvent[][] {
  const out: NoteEvent[][] = Array.from({ length: totalSteps(song) }, () => []);
  for (const note of song.notes) out[note.step % out.length]?.push(note);
  return out;
}

export class MusicPlayer {
  private mood: MusicMood | null = null;
  private boss = false;
  private song: Song | null = null;
  private pending: Song | null = null;
  private byStep: NoteEvent[][] = [];
  private step = 0;
  private nextTime = 0;
  private tempo = 1;
  private timer: unknown = null;
  /** Po znělce smyčka mlčí až do další změny nálady (`setMood`) nebo `resume`. */
  private silenced = false;
  private scheduled = 0;
  private readonly lookahead: number;
  private readonly interval: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(
    private readonly out: MusicOutput,
    opts: MusicPlayerOptions = {},
  ) {
    this.lookahead = opts.lookahead ?? LOOKAHEAD;
    this.interval = opts.interval ?? SCHEDULER_INTERVAL;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** Hraje smyčka (běží plánovač)? */
  get playing(): boolean {
    return this.timer !== null;
  }

  get currentMood(): MusicMood | null {
    return this.mood;
  }

  /** Právě hraná smyčka (po přepnutí na hranici taktu). */
  get currentSong(): Song | null {
    return this.song;
  }

  /** Použitý násobek tempa (1, u šéfa `BOSS_TEMPO` — od nejbližší hranice taktu). */
  get currentTempo(): number {
    return this.tempo;
  }

  /** Další krok smyčky a čas jeho začátku (testy). */
  get position(): { step: number; time: number } {
    return { step: this.step, time: this.nextTime };
  }

  /** Počet naplánovaných not (testy). */
  get scheduledNotes(): number {
    return this.scheduled;
  }

  get isSilenced(): boolean {
    return this.silenced;
  }

  /** Nálada podle obrazovky (null = ticho). Změna se projeví na hranici taktu. */
  setMood(mood: MusicMood | null): void {
    const resumed = this.silenced;
    this.silenced = false;
    if (mood === this.mood && !resumed) {
      this.sync();
      return;
    }
    this.mood = mood;
    if (mood === null) {
      this.stop();
      return;
    }
    const song = composeSong(mood);
    if (this.playing && this.song && !resumed) {
      // Přepne se na hranici taktu; návrat k právě hrané smyčce čekající přepnutí zruší.
      this.pending = song !== this.song ? song : null;
    } else {
      this.load(song);
    }
    this.sync();
  }

  /** Šéf v kole: tempo +15 % od další hranice taktu (jen ve hře). */
  setBoss(boss: boolean): void {
    this.boss = boss;
  }

  /** Pokračovat po znělce (nekonečný režim). */
  resume(): void {
    if (!this.silenced) return;
    this.silenced = false;
    if (this.mood) this.load(composeSong(this.mood));
    this.sync();
  }

  /** Spustí / zastaví plánovač podle hlasitosti a ztlumení (volá se po změně nastavení a po startu kontextu). */
  sync(): void {
    const should = this.mood !== null && !this.silenced && safe(() => this.out.musicAudible(), false);
    if (should && !this.playing) this.start();
    else if (!should && this.playing) this.stop();
  }

  /**
   * Znělka výhry / prohry: smyčka utichne a zahraje se krátká fráze. Vrací true, když se znělka naplánovala.
   */
  stinger(kind: StingerKind): boolean {
    this.silenced = true;
    this.pending = null;
    this.stop();
    const ctx = this.out.context;
    const dest = this.out.musicOut;
    if (!ctx || !dest || !safe(() => this.out.musicAudible(), false)) return false;
    try {
      const song = stingerSong(kind);
      const t0 = ctx.currentTime + 0.08;
      const sec = stepSeconds(song);
      for (const note of song.notes) this.playNote(ctx, dest, song, note, t0 + note.step * sec, sec);
      return true;
    } catch {
      return false;
    }
  }

  /** Jeden průchod plánovače (časovač ho volá každých `interval` ms; testy ručně). */
  pump(): void {
    const ctx = this.out.context;
    const dest = this.out.musicOut;
    const song = this.song;
    if (!ctx || !dest || !song) return;
    try {
      this.out.syncVolumes();
      const now = ctx.currentTime;
      // Časovač se opozdil (přetížené vlákno) — zmeškané noty přeskoč, ať se nevysypou naráz.
      if (this.nextTime < now - 0.1) this.nextTime = now + 0.02;
      let guard = 0;
      while (this.nextTime < now + this.lookahead && guard++ < 256) {
        const current = this.song!;
        if (this.step % stepsPerBar(current) === 0) this.barBoundary();
        const active = this.song!;
        const sec = stepSeconds(active, this.tempo);
        for (const note of this.byStep[this.step] ?? [])
          this.playNote(ctx, dest, active, note, this.nextTime, sec);
        this.nextTime += sec;
        this.step = (this.step + 1) % totalSteps(active);
      }
    } catch {
      // Chyba plánování nesmí shodit hru — hudba prostě vynechá.
    }
  }

  /** Zastaví plánovač (už naplánované noty dozní). */
  stop(): void {
    if (this.timer !== null) {
      try {
        this.clearTimer(this.timer);
      } catch {
        // Časovač už neběží.
      }
    }
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.mood = null;
  }

  private load(song: Song): void {
    this.song = song;
    this.pending = null;
    this.byStep = indexByStep(song);
    this.step = 0;
  }

  private start(): void {
    const ctx = this.out.context;
    if (!ctx || !this.song) return;
    this.nextTime = ctx.currentTime + 0.06;
    this.tempo = this.targetTempo();
    const loop = (): void => {
      this.pump();
      if (this.timer !== null) this.timer = this.setTimer(loop, this.interval);
    };
    this.timer = this.setTimer(loop, 0);
  }

  private targetTempo(): number {
    return this.boss && this.mood === 'game' ? BOSS_TEMPO : 1;
  }

  private barBoundary(): void {
    if (this.pending) this.load(this.pending);
    this.tempo = this.targetTempo();
  }

  private playNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    song: Song,
    note: NoteEvent,
    when: number,
    stepSec: number,
  ): void {
    synthVoice(ctx, dest, instrumentVoice(song.id, note.inst, note.midi, note.len * stepSec, note.vel), when);
    this.scheduled++;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
