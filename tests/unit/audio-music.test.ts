/**
 * Procedurální hudba (src/ui/audio/music.ts): seedovaný skladatel (valčík v menu, polka ve hře, znělky),
 * plánovač podle hodin Web Audio (noty dopředu jen v okně lookahead), přepnutí nálady a tempa šéfa na hranici
 * taktu, hudba jen při hlasitosti > 0, bezpečná no-op bez kontextu.
 */
import { describe, expect, it } from 'vitest';
import type { MusicOutput, Song } from '../../src/ui/audio/music';
import {
  BOSS_TEMPO,
  LOOKAHEAD,
  MusicPlayer,
  composeSong,
  degreeToMidi,
  instrumentVoice,
  seededRandom,
  stepSeconds,
  stepsPerBar,
  stingerSong,
  totalSteps,
} from '../../src/ui/audio/music';
import { MockAudioContext, MockNode, asContext } from './audio-mock';

function rig(audible = { value: true }) {
  const ctx = new MockAudioContext();
  const bus = new MockNode('music');
  const output: MusicOutput = {
    context: asContext(ctx),
    musicOut: bus as unknown as AudioNode,
    musicAudible: () => audible.value,
    syncVolumes: () => undefined,
  };
  const timers: (() => void)[] = [];
  const player = new MusicPlayer(output, {
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { ctx, bus, player, audible, timers };
}

/** Simuluje časovač plánovače: hodiny po 25 ms a průchod po každém posunu. */
function run(ctx: MockAudioContext, player: MusicPlayer, seconds: number): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.advance(Math.min(0.025, end - ctx.currentTime));
    player.pump();
  }
}

/** Začátky všech naplánovaných zdrojů (bez LFO vibrata — to začíná se svou notou). */
function starts(ctx: MockAudioContext): number[] {
  return ctx.sources.map((s) => s.started ?? NaN);
}

describe('skladatel', () => {
  it('stupně stupnice → MIDI (dur)', () => {
    expect(degreeToMidi(60, 0)).toBe(60);
    expect(degreeToMidi(60, 2)).toBe(64);
    expect(degreeToMidi(60, 7)).toBe(72);
    expect(degreeToMidi(60, -1)).toBe(59);
    expect(degreeToMidi(60, -3)).toBe(55);
  });

  it('seedovaný generátor je deterministický', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = Array.from({ length: 8 }, () => a());
    expect(xs).toEqual(Array.from({ length: 8 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it('menu = klidný valčík 3/4, hra = rychlejší polka 2/4 s bicími', () => {
    const menu = composeSong('menu');
    const game = composeSong('game');
    expect(menu.beatsPerBar).toBe(3);
    expect(game.beatsPerBar).toBe(2);
    expect(menu.bpm).toBeLessThan(game.bpm);
    const insts = (s: Song) => new Set(s.notes.map((n) => n.inst));
    expect(insts(game)).toEqual(new Set(['lead', 'bass', 'chord', 'kick', 'snare', 'hat']));
    expect(insts(menu).has('kick')).toBe(false);
    // Smyčka trvá rozumně dlouho (ne pár taktů dokola).
    for (const s of [menu, game]) expect(totalSteps(s) * stepSeconds(s)).toBeGreaterThan(25);
  });

  it('je pokaždé stejná a všechny noty leží v mřížce a v rozsahu', () => {
    expect(composeSong('game')).toBe(composeSong('game'));
    for (const s of [
      composeSong('menu'),
      composeSong('game'),
      stingerSong('victory'),
      stingerSong('gameOver'),
    ]) {
      const total = totalSteps(s);
      for (const n of s.notes) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(total);
        expect(n.len).toBeGreaterThan(0);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        if (n.inst === 'lead') {
          expect(n.midi).toBeGreaterThanOrEqual(55);
          expect(n.midi).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it('melodie fráze A končí na tónice a basa hraje na první dobu každého taktu', () => {
    const game = composeSong('game');
    const spb = stepsPerBar(game);
    const lead8 = game.notes.filter((n) => n.inst === 'lead' && Math.floor(n.step / spb) === 7);
    expect(lead8[0]!.midi % 12).toBe(65 % 12); // F
    for (let bar = 0; bar < game.bars; bar++)
      expect(game.notes.some((n) => n.inst === 'bass' && n.step === bar * spb)).toBe(true);
  });

  it('nástroje dávají platné hlasy (měkčí v menu)', () => {
    const lead = instrumentVoice('game', 'lead', 72, 0.5, 1);
    const soft = instrumentVoice('menu', 'lead', 72, 0.5, 1);
    expect(lead.wave).toBe('square');
    expect(soft.wave).toBe('triangle');
    expect(lead.vibrato).toBeDefined();
    for (const inst of ['lead', 'bass', 'chord', 'kick', 'snare', 'hat', 'crash'] as const) {
      const v = instrumentVoice('game', inst, 60, 0.2, 0.8);
      expect(v.volume).toBeGreaterThan(0);
      expect(v.volume).toBeLessThanOrEqual(0.5);
      expect(v.freq).toBeGreaterThan(0);
    }
  });
});

describe('plánovač', () => {
  it('plánuje noty jen dopředu v okně lookahead, navazuje bez mezer', () => {
    const { ctx, player } = rig();
    player.setMood('game');
    expect(player.playing).toBe(true);
    player.pump();
    const first = starts(ctx);
    expect(first.length).toBeGreaterThan(0);
    for (const t of first) {
      expect(t).toBeGreaterThanOrEqual(ctx.currentTime);
      expect(t).toBeLessThan(ctx.currentTime + LOOKAHEAD + 0.07);
    }
    const scheduled = player.scheduledNotes;
    // Bez posunu hodin další průchod nic nepřidá.
    player.pump();
    expect(player.scheduledNotes).toBe(scheduled);
    // Posun o 1 s → další noty, pořád jen do okna.
    run(ctx, player, 1);
    expect(player.scheduledNotes).toBeGreaterThan(scheduled);
    for (const t of starts(ctx)) expect(t).toBeLessThan(ctx.currentTime + LOOKAHEAD + 0.07);
    // Pozice odpovídá uplynulému času: ~1,2 s / délka kroku.
    const sec = stepSeconds(composeSong('game'));
    expect(player.position.step).toBeGreaterThanOrEqual(Math.floor(1.1 / sec));
    expect(player.position.time).toBeGreaterThan(ctx.currentTime);
  });

  it('opožděný časovač zmeškané noty přeskočí (žádná dávka naráz)', () => {
    const { ctx, player } = rig();
    player.setMood('game');
    player.pump();
    const before = player.scheduledNotes;
    ctx.advance(30);
    player.pump();
    const sec = stepSeconds(composeSong('game'));
    // Nanejvýš okno lookahead navíc, ne 30 s hudby.
    const stepsInWindow = Math.ceil((LOOKAHEAD + 0.1) / sec) + 1;
    expect(player.scheduledNotes - before).toBeLessThan(stepsInWindow * 12);
  });

  it('šéf: tempo +15 % až od další hranice taktu', () => {
    const { ctx, player } = rig();
    const song = composeSong('game');
    const spb = stepsPerBar(song);
    player.setMood('game');
    player.pump();
    expect(player.currentTempo).toBe(1);
    // Dojeď doprostřed taktu.
    // Dojeď na začátek taktu + 1 krok (do hranice zbývá spb − 1 kroků).
    while (player.position.step % spb !== 1) run(ctx, player, 0.025);
    player.setBoss(true);
    run(ctx, player, stepSeconds(song) * 2);
    expect(player.position.step % spb).toBeGreaterThan(1);
    expect(player.currentTempo).toBe(1);
    // Přes hranici taktu.
    run(ctx, player, stepSeconds(song) * (spb + 1));
    expect(player.currentTempo).toBe(BOSS_TEMPO);
    // Délka kroku se zkrátila: rozestup dvou po sobě jdoucích kroků s basou/bicími.
    const before = player.position;
    run(ctx, player, 0.5);
    const after = player.position;
    const steps = (after.step - before.step + totalSteps(song)) % totalSteps(song);
    expect((after.time - before.time) / steps).toBeCloseTo(stepSeconds(song, BOSS_TEMPO), 5);
    player.setBoss(false);
    run(ctx, player, stepSeconds(song, BOSS_TEMPO) * (spb + 1));
    expect(player.currentTempo).toBe(1);
  });

  it('v menu šéf tempo nemění', () => {
    const { ctx, player } = rig();
    player.setMood('menu');
    player.setBoss(true);
    run(ctx, player, 5);
    expect(player.currentTempo).toBe(1);
  });

  it('nálada se přepne na hranici taktu', () => {
    const { ctx, player } = rig();
    const game = composeSong('game');
    player.setMood('game');
    player.pump();
    run(ctx, player, stepSeconds(game) * 3);
    player.setMood('menu');
    expect(player.currentMood).toBe('menu');
    expect(player.currentSong?.id).toBe('game');
    run(ctx, player, stepSeconds(game) * (stepsPerBar(game) + 1));
    expect(player.currentSong?.id).toBe('menu');
  });

  it('rychlý návrat k původní náladě čekající přepnutí zruší', () => {
    const { ctx, player } = rig();
    const game = composeSong('game');
    player.setMood('game');
    player.pump();
    player.setMood('menu');
    player.setMood('game');
    run(ctx, player, stepSeconds(game) * (stepsPerBar(game) * 2));
    expect(player.currentSong?.id).toBe('game');
  });

  it('hlasitost 0 / ztlumeno: plánovač neběží; po zesílení se rozjede', () => {
    const audible = { value: false };
    const { player, ctx } = rig(audible);
    player.setMood('game');
    expect(player.playing).toBe(false);
    player.pump(); // písnička je nahraná, ale časovač neběží — `pump` je jen ruční průchod
    audible.value = true;
    player.sync();
    expect(player.playing).toBe(true);
    audible.value = false;
    player.sync();
    expect(player.playing).toBe(false);
    player.setMood(null);
    audible.value = true;
    player.sync();
    expect(player.playing).toBe(false);
    expect(ctx.state).toBe('running');
  });

  it('znělka: smyčka ztichne, znělka se naplánuje, nová nálada smyčku vrátí', () => {
    const { ctx, player } = rig();
    player.setMood('game');
    player.pump();
    const before = ctx.sources.length;
    expect(player.stinger('victory')).toBe(true);
    expect(player.playing).toBe(false);
    expect(player.isSilenced).toBe(true);
    expect(ctx.sources.length).toBeGreaterThan(before + 10);
    // Ani sync smyčku nepustí, dokud se nezmění nálada.
    player.sync();
    expect(player.playing).toBe(false);
    player.setMood('game');
    expect(player.playing).toBe(true);
    expect(player.isSilenced).toBe(false);
    expect(player.stinger('gameOver')).toBe(true);
    player.resume();
    expect(player.playing).toBe(true);
    expect(player.position.step).toBe(0);
  });

  it('bez kontextu je všechno no-op', () => {
    const player = new MusicPlayer({
      context: null,
      musicOut: null,
      musicAudible: () => false,
      syncVolumes: () => undefined,
    });
    expect(() => {
      player.setMood('game');
      player.setBoss(true);
      player.pump();
      player.sync();
      player.resume();
      player.dispose();
    }).not.toThrow();
    expect(player.stinger('victory')).toBe(false);
    expect(player.playing).toBe(false);
  });

  it('skutečný časovač: start naplánuje první průchod a stop ho zruší', async () => {
    const ctx = new MockAudioContext();
    const player = new MusicPlayer(
      {
        context: asContext(ctx),
        musicOut: new MockNode('m') as unknown as AudioNode,
        musicAudible: () => true,
        syncVolumes: () => undefined,
      },
      { interval: 5 },
    );
    player.setMood('menu');
    await new Promise((r) => setTimeout(r, 20));
    expect(player.scheduledNotes).toBeGreaterThan(0);
    player.stop();
    const n = player.scheduledNotes;
    ctx.advance(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(player.scheduledNotes).toBe(n);
  });
});
