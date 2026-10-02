/**
 * Zvukový engine (src/ui/audio/engine.ts): líný kontext až po gestu, sběrnice master / efekty / hudba,
 * hlasitosti z nastavení (živě, kvadratická křivka, ztlumení), skrytá karta, bezpečná no-op bez Web Audio.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  MUSIC_HEADROOM,
  SFX_HEADROOM,
  defaultContextFactory,
  volumeToGain,
  webAudioSupported,
} from '../../src/ui/audio/engine';
import { MockAudioContext, asContext, levels } from './audio-mock';

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(over: Parameters<typeof levels>[0] = {}, ctxState: AudioContextState = 'running') {
  const lv = levels(over);
  const ctx = new MockAudioContext(ctxState);
  const factory = vi.fn(() => asContext(ctx));
  const engine = new AudioEngine({ levels: () => lv, createContext: factory, canStart: () => true });
  return { lv, ctx, factory, engine };
}

describe('bez Web Audio', () => {
  it('je všechno tichá no-op (Node nemá AudioContext)', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    expect(webAudioSupported()).toBe(false);
    expect(defaultContextFactory()).toBeNull();
    const engine = new AudioEngine({ levels: () => levels(), canStart: () => true });
    expect(engine.unlock()).toBe(false);
    expect(engine.unlock()).toBe(false);
    expect(engine.context).toBeNull();
    expect(engine.sfxOut).toBeNull();
    expect(engine.sfxAudible()).toBe(false);
    expect(engine.musicAudible()).toBe(false);
    expect(() => {
      engine.syncVolumes();
      engine.setHidden(true);
      engine.setHidden(false);
      engine.installGestureUnlock(null);
      engine.installVisibility(null);
      engine.dispose();
    }).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('továrna, která vyhodí, nic neshodí a zkouší se jen jednou', () => {
    const factory = vi.fn((): AudioContext => {
      throw new Error('NotAllowedError');
    });
    const engine = new AudioEngine({ levels: () => levels(), createContext: factory, canStart: () => true });
    expect(engine.unlock()).toBe(false);
    expect(engine.unlock()).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('chybný getter nastavení = ticho, ne výjimka', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine({
      levels: () => {
        throw new Error('profil není');
      },
      createContext: () => asContext(ctx),
      canStart: () => true,
    });
    expect(engine.unlock()).toBe(true);
    expect(engine.sfxAudible()).toBe(false);
    expect(ctx.gains[0]!.gain.last).toBe(0);
  });
});

describe('vytvoření kontextu', () => {
  it('bez gesta (canStart = false) kontext nevznikne', () => {
    const ctx = new MockAudioContext();
    const factory = vi.fn(() => asContext(ctx));
    let allowed = false;
    const engine = new AudioEngine({
      levels: () => levels(),
      createContext: factory,
      canStart: () => allowed,
    });
    expect(engine.unlock()).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    allowed = true;
    expect(engine.unlock()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('gesto (pointerdown / keydown) vytvoří kontext jen jednou', () => {
    const { engine, factory } = setup();
    const target = new EventTarget();
    engine.installGestureUnlock(target);
    expect(engine.context).toBeNull();
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('click'));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.context).not.toBeNull();
    engine.dispose();
    expect(engine.context).toBeNull();
  });

  it('uspaný kontext gesto probudí a ohlásí připravenost', async () => {
    const { engine, ctx } = setup({}, 'suspended');
    const ready = vi.fn();
    engine.onReady(ready);
    const target = new EventTarget();
    engine.installGestureUnlock(target);
    target.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resumeCalls).toBe(1);
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    expect(ready).toHaveBeenCalled();
    // Chyba posluchače nic neshodí.
    engine.onReady(() => {
      throw new Error('hudba spadla');
    });
    expect(() => engine.unlock()).not.toThrow();
  });

  it('postaví graf: efekty a hudba → master → limiter → výstup', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    const [master, sfx, music] = ctx.gains;
    const limiter = ctx.compressors[0]!;
    expect(master!.connections).toEqual([limiter]);
    expect(limiter.connections).toContain(ctx.destination);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(12);
    expect(sfx!.connections).toContain(master);
    expect(music!.connections).toContain(master);
    expect(engine.sfxOut).toBe(sfx as unknown as AudioNode);
    expect(engine.musicOut).toBe(music as unknown as AudioNode);
  });
});

describe('graf bez kompresoru', () => {
  it('starší implementace bez DynamicsCompressor: master rovnou na výstup', () => {
    const ctx = new MockAudioContext();
    (ctx as unknown as { createDynamicsCompressor?: unknown }).createDynamicsCompressor = undefined;
    const engine = new AudioEngine({
      levels: () => levels(),
      createContext: () => asContext(ctx),
      canStart: () => true,
    });
    expect(engine.unlock()).toBe(true);
    expect(ctx.gains[0]!.connections).toContain(ctx.destination);
  });
});

describe('hlasitosti z nastavení', () => {
  it('kvadratická křivka, oříznutí a neplatné hodnoty', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it('výchozí 70 % / 50 % se promítnou hned po vytvoření', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    const [master, sfx, music] = ctx.gains;
    expect(master!.gain.last).toBe(1);
    expect(sfx!.gain.last).toBeCloseTo(0.49 * SFX_HEADROOM);
    expect(music!.gain.last).toBeCloseTo(0.25 * MUSIC_HEADROOM);
    expect(sfx!.gain.events.some((e) => e.type === 'set')).toBe(true);
  });

  it('změna nastavení se promítne živě (plynule) a beze změny se nic nepřidává', () => {
    const { engine, ctx, lv } = setup();
    engine.unlock();
    const sfx = ctx.gains[1]!;
    const before = sfx.gain.events.length;
    engine.syncVolumes();
    expect(sfx.gain.events.length).toBe(before);
    lv.sfxVolume = 0.3;
    engine.syncVolumes();
    const last = sfx.gain.events.at(-1)!;
    expect(last.type).toBe('target');
    expect(last.value).toBeCloseTo(0.09 * SFX_HEADROOM);
    lv.musicVolume = 0;
    engine.syncVolumes();
    expect(ctx.gains[2]!.gain.last).toBe(0);
    expect(engine.musicAudible()).toBe(false);
    expect(engine.sfxAudible()).toBe(true);
  });

  it('ztlumit vše: master na 0, nic není slyšet', () => {
    const { engine, ctx, lv } = setup();
    engine.unlock();
    lv.muted = true;
    engine.syncVolumes();
    expect(ctx.gains[0]!.gain.last).toBe(0);
    expect(engine.sfxAudible()).toBe(false);
    expect(engine.musicAudible()).toBe(false);
    lv.muted = false;
    engine.syncVolumes();
    expect(ctx.gains[0]!.gain.last).toBe(1);
  });
});

describe('skrytá karta', () => {
  it('ztlumí a uspí kontext, po návratu ho probudí', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    engine.setHidden(true);
    expect(engine.isHidden).toBe(true);
    expect(ctx.gains[0]!.gain.last).toBe(0);
    expect(ctx.suspendCalls).toBe(1);
    expect(engine.sfxAudible()).toBe(false);
    engine.setHidden(false);
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[0]!.gain.last).toBe(1);
    expect(engine.sfxAudible()).toBe(true);
  });

  it('visibilitychange z dokumentu', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    doc.visibilityState = 'visible';
    engine.installVisibility(doc as unknown as Document);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(engine.isHidden).toBe(true);
    expect(ctx.state).toBe('suspended');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(engine.isHidden).toBe(false);
    expect(ctx.state).toBe('running');
  });

  it('skrytá karta při startu kontext nevzbudí', () => {
    const { engine, ctx } = setup({}, 'suspended');
    engine.setHidden(true);
    engine.unlock();
    expect(ctx.resumeCalls).toBe(0);
    expect(engine.active).toBe(false);
  });
});
