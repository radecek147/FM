/**
 * Syntezátor a banka zvuků (src/ui/audio/sfx.ts): jeden hlas = zdroj → filtr → obálka, posun a skok výšky,
 * vibrato, šum; přehrávač škrtí opakování a hlídá počet hlasů. Mock AudioContext — žádný skutečný zvuk.
 */
import { describe, expect, it } from 'vitest';
import type { SoundDef, Voice } from '../../src/ui/audio/sfx';
import {
  MAX_VOICES,
  NOISE_REF,
  SOUNDS,
  SfxPlayer,
  isSoundName,
  midiToHz,
  noiseBuffer,
  semitones,
  soundLength,
  synthVoice,
} from '../../src/ui/audio/sfx';
import type { MockFilter, MockGain, MockParam } from './audio-mock';
import { MockAudioContext, MockNode, asContext } from './audio-mock';

const BEEP: Voice = {
  wave: 'square',
  freq: 440,
  slideTo: 880,
  attack: 0.01,
  sustain: 0.05,
  decay: 0.1,
  volume: 0.5,
};

function out(ctx: MockAudioContext, audible = () => true) {
  const dest = new MockNode('bus');
  return {
    dest,
    output: {
      context: asContext(ctx),
      sfxOut: dest as unknown as AudioNode,
      sfxAudible: audible,
      syncVolumes: () => undefined,
    },
  };
}

describe('pomocné převody', () => {
  it('půltóny a MIDI', () => {
    expect(semitones(12)).toBeCloseTo(2);
    expect(semitones(-12)).toBeCloseTo(0.5);
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });
});

describe('synthVoice', () => {
  it('oscilátor s posunem výšky a obálkou náběh / výdrž / doznění', () => {
    const ctx = new MockAudioContext();
    const dest = new MockNode('bus');
    const nodes = synthVoice(asContext(ctx), dest as unknown as AudioNode, BEEP, 1);
    const osc = ctx.oscillators[0]!;
    expect(osc.type).toBe('square');
    expect(osc.frequency.events[0]).toEqual({ type: 'set', value: 440, time: 1 });
    expect(osc.frequency.events[1]).toMatchObject({ type: 'exp', value: 880 });
    expect(nodes.start).toBe(1);
    expect(nodes.end).toBeCloseTo(1.16);
    const env = (nodes.gain as unknown as MockGain).gain.events;
    expect(env[0]).toEqual({ type: 'set', value: 0, time: 1 });
    expect(env[1]!.type).toBe('linear');
    expect(env[1]!.value).toBeCloseTo(0.5);
    expect(env[1]!.time).toBeCloseTo(1.01);
    expect(env[2]!.type).toBe('set');
    expect(env[2]!.time).toBeCloseTo(1.06);
    expect(env[3]!.type).toBe('exp');
    expect(env[3]!.time).toBeCloseTo(1.16);
    expect(osc.started).toBe(1);
    expect(osc.stopped).toBeGreaterThan(nodes.end);
    // Zapojení: oscilátor → obálka → sběrnice.
    expect(osc.connections).toContain(nodes.gain);
    expect((nodes.gain as unknown as MockGain).connections).toContain(dest);
  });

  it('transpozice a hlasitost z voleb', () => {
    const ctx = new MockAudioContext();
    const nodes = synthVoice(asContext(ctx), new MockNode('bus') as unknown as AudioNode, BEEP, 0, {
      pitch: semitones(12),
      volume: 0.5,
    });
    expect(ctx.oscillators[0]!.frequency.events[0]!.value).toBeCloseTo(880);
    expect((nodes.gain as unknown as MockGain).gain.events[1]!.value).toBeCloseTo(0.25);
  });

  it('šum: smyčka bufferu, barva přes rychlost přehrávání, filtr s posunem', () => {
    const ctx = new MockAudioContext();
    synthVoice(
      asContext(ctx),
      new MockNode('bus') as unknown as AudioNode,
      {
        wave: 'noise',
        freq: NOISE_REF / 2,
        attack: 0.001,
        sustain: 0,
        decay: 0.05,
        volume: 0.3,
        filter: { kind: 'bandpass', freq: 1000, to: 3000, q: 2 },
      },
      0,
    );
    const src = ctx.bufferSources[0]!;
    expect(src.loop).toBe(true);
    expect(src.buffer).not.toBeNull();
    expect(src.playbackRate.events[0]!.value).toBeCloseTo(0.5);
    const f = ctx.filters[0] as MockFilter;
    expect(f.type).toBe('bandpass');
    expect(f.frequency.events[0]!.value).toBe(1000);
    expect(f.frequency.events[1]).toMatchObject({ type: 'exp', value: 3000 });
    expect(f.Q.events[0]!.value).toBe(2);
    expect(src.connections).toContain(f);
  });

  it('vibrato: LFO → zesílení → detune', () => {
    const ctx = new MockAudioContext();
    synthVoice(
      asContext(ctx),
      new MockNode('bus') as unknown as AudioNode,
      { ...BEEP, vibrato: { rate: 6, depth: 20 } },
      0,
    );
    const [osc, lfo] = ctx.oscillators;
    expect(lfo!.type).toBe('sine');
    expect(lfo!.frequency.events[0]!.value).toBe(6);
    const lfoGain = lfo!.connections[0] as MockGain;
    expect(lfoGain.gain.events[0]!.value).toBe(20);
    expect(lfoGain.connections).toContain(osc!.detune as MockParam);
  });

  it('skok výšky (arpeggio) po zadané době', () => {
    const ctx = new MockAudioContext();
    synthVoice(
      asContext(ctx),
      new MockNode('bus') as unknown as AudioNode,
      {
        wave: 'triangle',
        freq: 400,
        jump: { at: 0.05, ratio: 1.5 },
        attack: 0.01,
        sustain: 0.1,
        decay: 0.1,
        volume: 1,
      },
      0,
    );
    const ev = ctx.oscillators[0]!.frequency.events;
    expect(ev[1]).toMatchObject({ type: 'set', time: 0.05 });
    expect(ev[1]!.value).toBeCloseTo(600);
  });

  it('po doznění se uzly odpojí', () => {
    const ctx = new MockAudioContext();
    let ended = 0;
    const nodes = synthVoice(
      asContext(ctx),
      new MockNode('bus') as unknown as AudioNode,
      { ...BEEP, filter: { freq: 2000 } },
      0,
      { onEnded: () => ended++ },
    );
    ctx.advance(1);
    expect(ended).toBe(1);
    expect((nodes.gain as unknown as MockGain).disconnected).toBe(true);
    expect(ctx.filters[0]!.disconnected).toBe(true);
  });

  it('buffer šumu je jeden na kontext a deterministický', () => {
    const a = new MockAudioContext();
    const b = new MockAudioContext();
    const ba = noiseBuffer(asContext(a));
    expect(noiseBuffer(asContext(a))).toBe(ba);
    const bb = noiseBuffer(asContext(b));
    const da = ba.getChannelData(0);
    const db = bb.getChannelData(0);
    expect(Array.from(da.slice(0, 32))).toEqual(Array.from(db.slice(0, 32)));
    expect(Math.max(...da)).toBeLessThanOrEqual(1);
    expect(Math.min(...da)).toBeGreaterThanOrEqual(-1);
    expect(new Set(da.slice(0, 100)).size).toBeGreaterThan(90);
  });
});

describe('banka zvuků', () => {
  const REQUIRED = [
    'click',
    'cardSelect',
    'cardDeselect',
    'shuffle',
    'deal',
    'scoreTick',
    'multTick',
    'xmultTick',
    'bigScore',
    'coin',
    'pay',
    'sell',
    'discard',
    'bossArrive',
    'roundWin',
    'victory',
    'gameOver',
    'unlock',
    'achievement',
    'error',
    'boosterOpen',
    'voucherBuy',
    'glassBreak',
  ];

  it('obsahuje všechny zvuky ze zadání (DESIGN 13.6)', () => {
    for (const name of REQUIRED) expect(isSoundName(name), name).toBe(true);
    expect(isSoundName('nic')).toBe(false);
    expect(isSoundName('toString')).toBe(false);
  });

  it.each(Object.keys(SOUNDS))('%s: platné hlasy, krátký, ne moc hlasitý', (name) => {
    const def = SOUNDS[name as keyof typeof SOUNDS] as SoundDef;
    expect(def.voices.length).toBeGreaterThan(0);
    const len = soundLength(def);
    expect(len).toBeGreaterThan(0);
    // Krátké a nevtíravé: „tiky“ a klik do 0,1 s, nic delšího než 1,5 s.
    if (['click', 'scoreTick', 'deal'].includes(name)) expect(len).toBeLessThan(0.1);
    expect(len).toBeLessThan(1.5);
    for (const v of def.voices) {
      expect(v.volume).toBeGreaterThan(0);
      expect(v.volume).toBeLessThanOrEqual(0.5);
      expect(Number.isFinite(v.freq) && v.freq > 0).toBe(true);
      if (v.slideTo !== undefined) expect(v.slideTo).toBeGreaterThan(0);
      expect(v.attack).toBeGreaterThan(0);
      expect(v.decay).toBeGreaterThan(0);
    }
    // Syntéza projde bez výjimky a vytvoří zdroj + obálku pro každý hlas.
    const ctx = new MockAudioContext();
    const { output } = out(ctx);
    const player = new SfxPlayer(output, { now: () => 0 });
    expect(player.play(name)).toBe(true);
    expect(ctx.sources.length).toBeGreaterThanOrEqual(def.voices.length);
    for (const s of ctx.sources) expect(s.started).toBeGreaterThanOrEqual(0);
  });
});

describe('SfxPlayer', () => {
  it('bez kontextu, ztlumený nebo neznámý zvuk = nic', () => {
    const ctx = new MockAudioContext();
    const silent = new SfxPlayer({
      context: null,
      sfxOut: null,
      sfxAudible: () => false,
      syncVolumes: () => {},
    });
    expect(silent.play('click')).toBe(false);
    const muted = new SfxPlayer(out(ctx, () => false).output);
    expect(muted.play('click')).toBe(false);
    const ok = new SfxPlayer(out(ctx).output);
    expect(ok.play('neexistuje')).toBe(false);
    expect(ctx.sources.length).toBe(0);
    const broken = new SfxPlayer({
      context: null,
      sfxOut: null,
      sfxAudible: () => {
        throw new Error('x');
      },
      syncVolumes: () => {},
    });
    expect(broken.play('click')).toBe(false);
  });

  it('„tik“ se škrtí (~25 ms), vlastní rozestup jde přepsat', () => {
    const ctx = new MockAudioContext();
    let now = 1000;
    const player = new SfxPlayer(out(ctx).output, { now: () => now });
    expect(player.play('scoreTick')).toBe(true);
    now += 10;
    expect(player.play('scoreTick')).toBe(false);
    // Jiný zvuk se neškrtí společně.
    expect(player.play('multTick')).toBe(true);
    now += 20;
    expect(player.play('scoreTick')).toBe(true);
    now += 30;
    expect(player.play('scoreTick', { gap: 100 })).toBe(false);
    now += 80;
    expect(player.play('scoreTick', { gap: 100 })).toBe(true);
    expect(player.playCount).toBe(4);
    player.reset();
    expect(player.play('scoreTick')).toBe(true);
  });

  it('výška a posun začátku z voleb', () => {
    const ctx = new MockAudioContext();
    ctx.currentTime = 2;
    const player = new SfxPlayer(out(ctx).output, { now: () => 0 });
    player.play('scoreTick', { pitch: 12, delay: 0.5 });
    const osc = ctx.oscillators[0]!;
    expect(osc.frequency.events[0]!.value).toBeCloseTo(midiToHz(84));
    expect(osc.started).toBeGreaterThanOrEqual(2.5);
  });

  it('hlídá počet hlasů: nedůležité zvuky se při plném počtu zahodí, hlasy se po doznění uvolní', () => {
    const ctx = new MockAudioContext();
    const player = new SfxPlayer(out(ctx).output, { now: () => 0 });
    let played = 0;
    for (let i = 0; i < MAX_VOICES + 10; i++) if (player.play('deal', { gap: 0 })) played++;
    expect(played).toBe(MAX_VOICES);
    expect(player.activeVoices).toBe(MAX_VOICES);
    expect(player.play('deal', { gap: 0 })).toBe(false);
    // Důležitý zvuk projde i přes plno (do 1,5× limitu).
    expect(player.play('bigScore')).toBe(true);
    ctx.advance(5);
    expect(player.activeVoices).toBe(0);
    expect(player.play('deal', { gap: 0 })).toBe(true);
  });
});
