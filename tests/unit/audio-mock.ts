/**
 * Falešný `AudioContext` pro testy zvuku (src/ui/audio): žádný skutečný zvuk, jen záznam vytvořených uzlů,
 * zapojení a automatizace parametrů. `advance(s)` posune hodiny a zavolá `onended` dohraným zdrojům.
 */
export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  value: number;
  time: number;
}

export class MockParam {
  events: ParamEvent[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('exponentialRamp na nulu');
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, _tc: number): this {
    this.events.push({ type: 'target', value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: 0, time });
    return this;
  }
  /** Poslední cílová hodnota (set / target). */
  get last(): number | undefined {
    const e = [...this.events].reverse().find((x) => x.type === 'set' || x.type === 'target');
    return e?.value;
  }
}

export class MockNode {
  connections: (MockNode | MockParam)[] = [];
  disconnected = false;
  constructor(readonly kind: string) {}
  connect<T extends MockNode | MockParam>(dest: T): T {
    this.connections.push(dest);
    return dest;
  }
  disconnect(): void {
    this.connections = [];
    this.disconnected = true;
  }
}

export class MockGain extends MockNode {
  gain = new MockParam(1);
  constructor() {
    super('gain');
  }
}

export class MockSource extends MockNode {
  started: number | undefined;
  stopped: number | undefined;
  ended = false;
  onended: (() => void) | null = null;
  start(t = 0): void {
    this.started = t;
  }
  stop(t = 0): void {
    this.stopped = t;
  }
}

export class MockOscillator extends MockSource {
  type: OscillatorType = 'sine';
  frequency = new MockParam(440);
  detune = new MockParam(0);
  constructor() {
    super('oscillator');
  }
}

export class MockBufferSource extends MockSource {
  buffer: MockBuffer | null = null;
  loop = false;
  playbackRate = new MockParam(1);
  detune = new MockParam(0);
  constructor() {
    super('bufferSource');
  }
}

export class MockFilter extends MockNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new MockParam(350);
  Q = new MockParam(1);
  gain = new MockParam(0);
  constructor() {
    super('filter');
  }
}

export class MockCompressor extends MockNode {
  threshold = new MockParam(-24);
  knee = new MockParam(30);
  ratio = new MockParam(12);
  attack = new MockParam(0.003);
  release = new MockParam(0.25);
  constructor() {
    super('compressor');
  }
}

export class MockBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(_ch: number): Float32Array {
    return this.data;
  }
}

export class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new MockNode('destination');
  gains: MockGain[] = [];
  oscillators: MockOscillator[] = [];
  bufferSources: MockBufferSource[] = [];
  filters: MockFilter[] = [];
  buffers: MockBuffer[] = [];
  compressors: MockCompressor[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  constructor(initialState: AudioContextState = 'running') {
    this.state = initialState;
  }

  createGain(): MockGain {
    const g = new MockGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): MockOscillator {
    const o = new MockOscillator();
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): MockBufferSource {
    const s = new MockBufferSource();
    this.bufferSources.push(s);
    return s;
  }
  createBiquadFilter(): MockFilter {
    const f = new MockFilter();
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): MockCompressor {
    const c = new MockCompressor();
    this.compressors.push(c);
    return c;
  }
  createBuffer(channels: number, length: number, rate: number): MockBuffer {
    const b = new MockBuffer(channels, length, rate);
    this.buffers.push(b);
    return b;
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.setState('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }
  addEventListener(type: string, fn: () => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Všechny zdroje (oscilátory i šum), ne LFO zvlášť. */
  get sources(): MockSource[] {
    return [...this.oscillators, ...this.bufferSources];
  }

  /** Posune hodiny a ukončí dohrané zdroje (`onended`). */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const s of this.sources) {
      if (!s.ended && s.stopped !== undefined && s.stopped <= this.currentTime) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  private setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    for (const fn of this.listeners.get('statechange') ?? []) fn();
  }
}

/** Mock jako `AudioContext` (pro továrny enginu). */
export function asContext(ctx: MockAudioContext): AudioContext {
  return ctx as unknown as AudioContext;
}

/** Hlasitosti pro engine (měnitelné v testu). */
export function levels(over: Partial<{ sfxVolume: number; musicVolume: number; muted: boolean }> = {}): {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
} {
  return { sfxVolume: 0.7, musicVolume: 0.5, muted: false, ...over };
}
