// @vitest-environment happy-dom
/**
 * Zapojení zvuku (src/ui/audio/hooks.ts): no-op bez instalace, „tik“ za krok skórování s výškou podle multu
 * a škrcením podle rychlosti, zvuky událostí, hlasitosti živě z nastavení, nálada hudby podle obrazovky, šéf =
 * tempo, výběr karet, klik na tlačítko bez zdvojení, klávesa M. Mock AudioContext, žádný skutečný zvuk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, RunState, ScoreStep } from '../../src/engine';
import { DEFAULT_SETTINGS } from '../../src/engine';
import type { Settings } from '../../src/engine/meta';
import type { AnimTiming, AudioHost } from '../../src/ui/audio/hooks';
import {
  audioService,
  installAudio,
  isBossRound,
  isMuteKey,
  moodForScreen,
  sound,
  soundForEvent,
  soundScoreStep,
  tickGap,
  tickPitch,
} from '../../src/ui/audio/hooks';
import { clearToasts } from '../../src/ui/components/toast';
import type { GameController } from '../../src/ui/controller';
import { MockAudioContext, asContext } from './audio-mock';

const LIVE: AnimTiming = { instant: false, duration: (ms) => ms };
const INSTANT: AnimTiming = { instant: true, duration: () => 0 };

afterEach(() => {
  audioService()?.dispose();
  clearToasts();
  vi.restoreAllMocks();
});

interface FakeController {
  selected: number[];
  busy: boolean;
  state: Partial<RunState>;
  subs: Set<() => void>;
  evs: Set<(e: readonly GameEvent[]) => void>;
  subscribe(fn: () => void): () => void;
  onEvents(fn: (e: readonly GameEvent[]) => void): () => void;
  notify(): void;
}

function fakeController(): FakeController {
  const c: FakeController = {
    selected: [],
    busy: false,
    state: { phase: 'blind_select', round: null } as Partial<RunState>,
    subs: new Set(),
    evs: new Set(),
    subscribe(fn) {
      c.subs.add(fn);
      return () => c.subs.delete(fn);
    },
    onEvents(fn) {
      c.evs.add(fn);
      return () => c.evs.delete(fn);
    },
    notify() {
      for (const fn of [...c.subs]) fn();
    },
  };
  return c;
}

function fakeHost(over: Partial<Settings> = {}) {
  const screenFns = new Set<(id: string) => void>();
  const settingsFns = new Set<(s: Settings) => void>();
  const host = {
    settings: { ...DEFAULT_SETTINGS, ...over } as Settings,
    controller: null as GameController | null,
    updateSettings(patch: Partial<Settings>) {
      host.settings = { ...host.settings, ...patch };
      for (const fn of settingsFns) fn(host.settings);
    },
    onScreenChange(fn: (id: string) => void) {
      screenFns.add(fn);
      return () => screenFns.delete(fn);
    },
    onSettingsChange(fn: (s: Settings) => void) {
      settingsFns.add(fn);
      return () => settingsFns.delete(fn);
    },
    go(id: string) {
      for (const fn of screenFns) fn(id);
    },
  };
  return host;
}

function setup(over: Partial<Settings> = {}, doc: Document | null = null) {
  const host = fakeHost(over);
  const ctx = new MockAudioContext();
  const deferred: (() => void)[] = [];
  const svc = installAudio(host as unknown as AudioHost, {
    createContext: () => asContext(ctx),
    canStart: () => true,
    doc,
    music: { setTimer: () => 1, clearTimer: () => undefined },
    defer: (fn) => deferred.push(fn),
  });
  svc.engine.unlock();
  const flush = (): void => {
    for (const fn of deferred.splice(0)) fn();
  };
  return { host, ctx, svc, flush };
}

function step(over: Partial<ScoreStep>): ScoreStep {
  return { source: 'card', chipsAfter: 10, multAfter: 1, ...over };
}

describe('pomocné funkce', () => {
  it('výška „tiku“ stoupá s multem po pentatonice a má strop', () => {
    expect(tickPitch(1)).toBe(0);
    expect(tickPitch(0)).toBe(0);
    expect(tickPitch(Number.NaN)).toBe(0);
    let prev = -1;
    for (const m of [1, 2, 3, 4, 8, 16, 64, 128, 1e6, 1e300]) {
      const p = tickPitch(m);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(tickPitch(1e300)).toBe(24);
    expect([0, 2, 4, 7, 9]).toContain(tickPitch(4) % 12);
  });

  it('při vyšší rychlosti hry méně tiků (delší rozestup)', () => {
    expect(tickGap(1)).toBe(25);
    expect(tickGap(4)).toBe(100);
    expect(tickGap(9)).toBe(100);
    expect(tickGap(Number.NaN)).toBe(25);
  });

  it('nálada podle obrazovky, šéf v kole, klávesa M', () => {
    expect(moodForScreen('game')).toBe('game');
    expect(moodForScreen('menu')).toBe('menu');
    expect(moodForScreen('settings')).toBe('menu');
    expect(isBossRound({ phase: 'round', round: { blind: 'boss' } } as unknown as RunState)).toBe(true);
    expect(isBossRound({ phase: 'round', round: { blind: 'small' } } as unknown as RunState)).toBe(false);
    expect(isBossRound({ phase: 'shop', round: { blind: 'boss' } } as unknown as RunState)).toBe(false);
    const k = { key: 'm', code: 'KeyM', ctrlKey: false, altKey: false, metaKey: false };
    expect(isMuteKey(k)).toBe(true);
    expect(isMuteKey({ ...k, ctrlKey: true })).toBe(false);
    expect(isMuteKey({ ...k, key: 'x', code: 'KeyX' })).toBe(false);
  });
});

describe('bez nainstalovaného zvuku', () => {
  it('všechno je no-op', () => {
    expect(audioService()).toBeNull();
    expect(() => {
      sound('click');
      soundScoreStep(step({ chips: 5 }), LIVE);
      soundForEvent({ type: 'victory', ante: 8 }, LIVE);
    }).not.toThrow();
  });

  it('instalace bez Web Audio a bez dokumentu nic neshodí', () => {
    const host = fakeHost();
    const svc = installAudio(host as unknown as AudioHost, { doc: null, canStart: () => true });
    expect(svc.engine.unlock()).toBe(false);
    expect(() => {
      sound('bigScore');
      soundForEvent({ type: 'gameOver', info: {} as never }, LIVE);
      host.updateSettings({ sfxVolume: 0.2 });
      host.go('game');
      host.go('menu');
    }).not.toThrow();
    expect(svc.sfx.playCount).toBe(0);
  });
});

describe('skórování a události', () => {
  it('krok skórování: tik s výškou podle multu, při přeskočení ticho', () => {
    const { svc, ctx } = setup();
    soundScoreStep(step({ chips: 5, multAfter: 16 }), LIVE);
    expect(svc.sfx.playCount).toBe(1);
    // C5 + 14 půltónů (mult 16).
    expect(ctx.oscillators[0]!.frequency.events[0]!.value).toBeCloseTo(523.25 * 2 ** (14 / 12), 0);
    soundScoreStep(step({ xmult: 2, multAfter: 32 }), LIVE);
    soundScoreStep(step({ money: 3 }), LIVE);
    expect(svc.sfx.playCount).toBe(3);
    soundScoreStep(step({ chips: 5 }), INSTANT);
    expect(svc.sfx.playCount).toBe(3);
  });

  it('peníze: výdělek = mince, útrata = pokladna, ze skórování a prodeje nic navíc', () => {
    const { svc } = setup();
    const play = vi.spyOn(svc.sfx, 'play');
    soundForEvent({ type: 'moneyChanged', delta: 5, money: 9, reason: 'roundReward' }, LIVE);
    soundForEvent({ type: 'moneyChanged', delta: -4, money: 5, reason: 'purchase' }, LIVE);
    soundForEvent({ type: 'moneyChanged', delta: 2, money: 7, reason: 'score' }, LIVE);
    soundForEvent({ type: 'moneyChanged', delta: 3, money: 10, reason: 'sell' }, LIVE);
    expect(play.mock.calls.map((c) => c[0])).toEqual(['coin', 'pay']);
  });

  it('události mají své zvuky; rozdání = cvrnknutí za každou kartu', () => {
    const { svc } = setup();
    const play = vi.spyOn(svc.sfx, 'play');
    const ev = (e: GameEvent, anim = LIVE): void => soundForEvent(e, anim);
    ev({ type: 'cardsDrawn', cardIds: [1, 2, 3, 4, 5] });
    expect(play.mock.calls.filter((c) => c[0] === 'deal').length).toBe(5);
    play.mockClear();
    ev({ type: 'cardsDrawn', cardIds: [1, 2, 3, 4, 5] }, INSTANT);
    expect(play.mock.calls.length).toBe(1);
    play.mockClear();
    ev({ type: 'blindSelected', blind: 'boss', bossId: 'finance_check', target: 100 });
    ev({ type: 'blindSelected', blind: 'small', bossId: null, target: 100 });
    ev({ type: 'cardsDiscarded', cardIds: [1] });
    ev({ type: 'handPlayed', result: {} as never, roundScore: 1 });
    ev({ type: 'roundWon', ante: 1, blind: 'small', score: 1, target: 1 });
    ev({ type: 'jokerSold', uid: 1, defId: 'x', price: 2 });
    ev({ type: 'boosterOpened', boosterId: 'b' });
    ev({ type: 'voucherRedeemed', voucherId: 'v' });
    ev({ type: 'cardDestroyed', cardId: 1, reason: 'score' });
    ev({ type: 'cardDestroyed', cardId: 1, reason: 'rada' });
    expect(play.mock.calls.map((c) => c[0])).toEqual([
      'bossArrive',
      'discard',
      'playHand',
      'roundWin',
      'sell',
      'boosterOpen',
      'voucherBuy',
      'glassBreak',
    ]);
  });

  it('výhra a prohra: znělka v hudbě, smyčka ztichne; nekonečný režim ji vrátí', () => {
    const { svc, host } = setup();
    host.go('game');
    expect(svc.music.playing).toBe(true);
    soundForEvent({ type: 'victory', ante: 8 }, LIVE);
    expect(svc.music.isSilenced).toBe(true);
    expect(svc.music.playing).toBe(false);
    soundForEvent({ type: 'endlessStarted' }, LIVE);
    expect(svc.music.playing).toBe(true);
    soundForEvent({ type: 'gameOver', info: {} as never }, LIVE);
    expect(svc.music.isSilenced).toBe(true);
    host.go('menu');
    expect(svc.music.playing).toBe(true);
    expect(svc.music.currentMood).toBe('menu');
  });
});

describe('nastavení a obrazovky', () => {
  it('hlasitosti živě: změna nastavení přenastaví sběrnice, hudba na 0 % se zastaví', () => {
    const { host, ctx, svc } = setup();
    host.go('menu');
    expect(svc.music.playing).toBe(true);
    host.updateSettings({ sfxVolume: 0.2 });
    expect(ctx.gains[1]!.gain.last).toBeCloseTo(0.04 * 0.9);
    host.updateSettings({ musicVolume: 0 });
    expect(svc.music.playing).toBe(false);
    host.updateSettings({ musicVolume: 0.8 });
    expect(svc.music.playing).toBe(true);
    host.updateSettings({ muted: true });
    expect(svc.music.playing).toBe(false);
    expect(ctx.gains[0]!.gain.last).toBe(0);
    expect(svc.sfx.play('click')).toBe(false);
  });

  it('obrazovka hry = polka a připojený controller (výběr karet, šéf = tempo)', () => {
    const { host, svc } = setup();
    const c = fakeController();
    host.controller = c as unknown as GameController;
    host.go('game');
    expect(svc.music.currentMood).toBe('game');
    const play = vi.spyOn(svc.sfx, 'play');
    c.selected = [5];
    c.notify();
    c.selected = [5, 7];
    c.notify();
    c.selected = [7];
    c.notify();
    expect(play.mock.calls.map((x) => x[0])).toEqual(['cardSelect', 'cardSelect', 'cardDeselect']);
    // Výška výběru stoupá s počtem vybraných.
    expect(play.mock.calls[1]![1]!.pitch).toBeGreaterThan(play.mock.calls[0]![1]!.pitch!);
    // Po akci (zahrání) se výběr vyprázdní bez zvuku zrušení výběru.
    play.mockClear();
    for (const fn of c.evs) fn([]);
    c.selected = [];
    c.notify();
    expect(play).not.toHaveBeenCalled();
    // Šéf v kole: tempo se nastaví (projeví se na hranici taktu).
    const setBoss = vi.spyOn(svc.music, 'setBoss');
    c.state = { phase: 'round', round: { blind: 'boss' } } as unknown as RunState;
    c.notify();
    expect(setBoss).toHaveBeenLastCalledWith(true);
    host.go('menu');
    expect(setBoss).toHaveBeenLastCalledWith(false);
    // Odpojený controller už zvuky nespouští.
    play.mockClear();
    c.selected = [1];
    c.notify();
    expect(play).not.toHaveBeenCalled();
  });
});

describe('dokument: klik a klávesa M', () => {
  it('klik na tlačítko zazní, když akce nezazněla sama; karty v ruce a data-sfx="none" ne', () => {
    const { svc, flush } = setup({}, document);
    const play = vi.spyOn(svc.sfx, 'play');
    const btn = document.createElement('button');
    const silent = document.createElement('button');
    silent.dataset.sfx = 'none';
    const card = document.createElement('button');
    card.className = 'pcard';
    const buy = document.createElement('button');
    buy.addEventListener('click', () => sound('pay'));
    document.body.append(btn, silent, card, buy);
    btn.click();
    flush();
    expect(play.mock.calls.map((c) => c[0])).toEqual(['click']);
    play.mockClear();
    silent.click();
    card.click();
    flush();
    expect(play).not.toHaveBeenCalled();
    // Koupě má vlastní zvuk — klik se nezdvojí.
    buy.click();
    flush();
    expect(play.mock.calls.map((c) => c[0])).toEqual(['pay']);
    document.body.replaceChildren();
  });

  it('M ztlumí a zase pustí zvuk (ne při psaní do pole)', () => {
    const { host, svc } = setup({}, document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    expect(host.settings.muted).toBe(true);
    expect(document.querySelector('[data-testid="toast-mute"]')).not.toBeNull();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    expect(host.settings.muted).toBe(true);
    expect(svc.toggleMute()).toBe(false);
    expect(host.settings.muted).toBe(false);
    document.body.replaceChildren();
  });
});
