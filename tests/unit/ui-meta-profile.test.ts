// @vitest-environment happy-dom
/**
 * Profilová vrstva UI (src/ui/profile.ts, src/ui/metaText.ts, napojení v App, Nastavení a controlleru):
 * načtení a záloha poškozeného profilu, migrace `karban.settings`, ukládání po každé změně, nový run s poolem
 * obsahu podle druhu runu, sledování událostí runu (statistiky, prohra hned do historie), výhra po „Konec“,
 * obnovení runu, oznámení (toasty po doběhnutí animací ve frontě, src/ui/metaNotices.ts), export / import / reset profilu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/content';
import type { MetaNotice, RunState } from '../../src/engine';
import {
  DEFAULT_SETTINGS,
  Game,
  createProfile,
  deserializeProfile,
  serializeProfile,
  serializeRun,
  unlockedPoolFor,
} from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { clearToasts } from '../../src/ui/components/toast';
import { GameController } from '../../src/ui/controller';
import { noticeText, unlockInfo } from '../../src/ui/metaText';
import type { ProfileProblem } from '../../src/ui/profile';
import { META_TOASTS_VISIBLE } from '../../src/ui/metaNotices';
import { ProfileController, noticeQueue, poolModeFor, showMetaNotices } from '../../src/ui/profile';
import {
  ImportError,
  applyImport,
  buildExport,
  parseImport,
  resetProfile,
} from '../../src/ui/screens/settings';
import { PROFILE_BACKUP_PREFIX } from '../../src/ui/settings';
import type { KeyValueStore } from '../../src/ui/storage';
import { STORAGE_KEYS, memoryStore } from '../../src/ui/storage';

const REG = registry();
const NOW = new Date('2026-10-02T10:00:00.000Z');
const clock = (): Date => NOW;

function controller(
  store: KeyValueStore,
  opts: { notify?: (n: readonly MetaNotice[]) => void; onProblem?: (p: ProfileProblem) => void } = {},
): ProfileController {
  return new ProfileController(store, REG, { now: clock, notify: opts.notify ?? (() => undefined), ...opts });
}

function stored(store: KeyValueStore) {
  return deserializeProfile(store.get(STORAGE_KEYS.profile));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  clearToasts();
});

describe('ProfileController — úložiště', () => {
  it('bez dat založí profil a uloží ho; staré karban.settings zmigruje a smaže', () => {
    const store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ speed: 3, colorblind: true }) });
    const pc = controller(store);
    expect(pc.loadStatus).toBe('legacy');
    expect(pc.settings).toEqual({ ...DEFAULT_SETTINGS, speed: 3, colorblind: true });
    expect(store.get(STORAGE_KEYS.settings)).toBeNull();
    expect(stored(store).settings.speed).toBe(3);
  });

  it('poškozený profil zazálohuje do karban.profile.backup.<ms>, založí nový a ohlásí to', () => {
    const problems: ProfileProblem[] = [];
    const store = memoryStore({ [STORAGE_KEYS.profile]: '{rozbité' });
    const pc = controller(store, { onProblem: (p) => problems.push(p) });
    expect(pc.loadStatus).toBe('corrupt');
    const key = `${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`;
    expect(pc.backupKey).toBe(key);
    expect(store.get(key)).toBe('{rozbité');
    expect(problems).toEqual([{ kind: 'corrupt', backupKey: key, error: 'invalidJson' }]);
    expect(() => stored(store)).not.toThrow();
    expect(pc.persistent).toBe(true);
  });

  it('když zálohu nejde zapsat, poškozená data nepřepíše ani nastavením', () => {
    const problems: ProfileProblem[] = [];
    const inner = memoryStore({ [STORAGE_KEYS.profile]: '{rozbité' });
    const store: KeyValueStore = {
      ...inner,
      set: (k, v) => (k.startsWith(PROFILE_BACKUP_PREFIX) ? false : inner.set(k, v)),
    };
    const pc = controller(store, { onProblem: (p) => problems.push(p) });
    expect(problems[0]?.kind).toBe('corruptUnsaved');
    expect(pc.persistent).toBe(false);
    pc.updateSettings({ speed: 2 });
    expect(pc.settings.speed).toBe(2);
    expect(pc.save()).toBe(false);
    expect(store.get(STORAGE_KEYS.profile)).toBe('{rozbité');
  });

  it('selhání zápisu ohlásí jednou', () => {
    const problems: ProfileProblem[] = [];
    const inner = memoryStore();
    let allow = true;
    const store: KeyValueStore = { ...inner, set: (k, v) => (allow ? inner.set(k, v) : false) };
    const pc = controller(store, { onProblem: (p) => problems.push(p) });
    allow = false;
    expect(pc.save()).toBe(false);
    pc.updateSettings({ speed: 4 });
    expect(problems).toEqual([{ kind: 'saveFailed' }]);
  });

  it('updateSettings a markSeen ukládají profil', () => {
    const store = memoryStore();
    const pc = controller(store);
    pc.updateSettings({ uiScale: 1.2, speed: 9 });
    expect(stored(store).settings).toMatchObject({ uiScale: 1.2, speed: 4 });
    pc.profile.unseen.push('jokers:golem', 'decks:clerk');
    pc.save();
    pc.markSeen('jokers', ['golem']);
    expect(stored(store).unseen).toEqual(['decks:clerk']);
  });

  it('reset a reload', () => {
    const store = memoryStore();
    const pc = controller(store);
    pc.profile.stats.runs.won = 3;
    pc.save();
    pc.reset({ ...DEFAULT_SETTINGS, colorblind: true });
    expect(pc.profile.stats.runs.won).toBe(0);
    expect(stored(store).settings.colorblind).toBe(true);
    const other = createProfile(NOW.toISOString());
    other.stats.runs.played = 7;
    store.set(STORAGE_KEYS.profile, serializeProfile(other, NOW.toISOString()));
    pc.reload();
    expect(pc.profile.stats.runs.played).toBe(7);
  });
});

describe('ProfileController — runy', () => {
  it('poolModeFor: denní > seedovaný > výzva > hlavní hra', () => {
    expect(poolModeFor({})).toBe('normal');
    expect(poolModeFor({ challengeId: 'greenhouse' })).toBe('challenge');
    expect(poolModeFor({ seeded: true, challengeId: 'greenhouse' })).toBe('seeded');
    expect(poolModeFor({ daily: true, seeded: true })).toBe('daily');
  });

  it('nový run: pool z profilu, začátek v profilu; seedovaný run má celý obsah a nepočítá se', () => {
    const store = memoryStore();
    const pc = controller(store);
    const c = pc.newRun({ deckId: 'pub', stake: 1, seed: 'NORMALRN' });
    expect(c.state.unlockedPool).toEqual(unlockedPoolFor(pc.profile, REG, 'normal'));
    expect(c.state.unlockedPool.jokers).not.toBeNull();
    expect(pc.profile.current).toMatchObject({
      seed: 'NORMALRN',
      counted: true,
      seeded: false,
      mode: 'normal',
    });
    expect(stored(store).current?.seed).toBe('NORMALRN');
    expect(c.hasObserver).toBe(true);

    const s = pc.newRun({ deckId: 'pub', stake: 1, seed: 'SEMINKOA', seeded: true });
    expect(s.state.unlockedPool).toEqual({ jokers: null, vouchers: null, boosters: null });
    expect(pc.profile.current).toMatchObject({ seed: 'SEMINKOA', counted: false, seeded: true });
    // Předchozí neuzavřený run je v historii jako opuštěný.
    expect(pc.profile.history[0]).toMatchObject({ seed: 'NORMALRN', outcome: 'abandoned' });
  });

  it('události akce jdou do statistik a oznámení až po doběhnutí animací', async () => {
    const store = memoryStore();
    const order: string[] = [];
    const pc = controller(store, {
      notify: (n) => {
        if (n.length > 0) order.push(`notify:${n.map((x) => x.kind).join(',')}`);
      },
    });
    const c = pc.newRun({ deckId: 'pub', stake: 1, seed: 'UDALOSTI' });
    c.setPresenter(async () => {
      order.push('present');
    });
    // Splněná podmínka Úřednického balíčku (5 kupónů) se projeví při první události.
    pc.profile.stats.totals.vouchersBought = 5;
    await c.act({ type: 'selectBlind' });
    expect(order[0]).toBe('present');
    expect(order[1]).toContain('notify:unlock');
    expect(pc.profile.unlocks.decks).toContain('clerk');
    await c.act({ type: 'play', cardIds: c.state.round!.hand.slice(0, 1) });
    expect(pc.profile.stats.totals.handsPlayed).toBe(1);
    expect(stored(store).stats.totals.handsPlayed).toBe(1);
  });

  it('prohra jde do historie hned (bez pitvy), výhra po finish', async () => {
    const store = memoryStore();
    const pc = controller(store);
    const c = pc.newRun({ deckId: 'pub', stake: 1, seed: 'PROHRAAA' });
    await c.act({ type: 'selectBlind' });
    for (let i = 0; i < 6 && c.state.phase === 'round'; i++) {
      await c.act({ type: 'play', cardIds: c.state.round!.hand.slice(0, 1) });
    }
    expect(c.state.phase).toBe('game_over');
    expect(pc.profile.current).toBeNull();
    expect(pc.profile.history[0]).toMatchObject({ seed: 'PROHRAAA', outcome: 'lost', cause: 'small' });
    expect(pc.profile.stats.runs).toMatchObject({ played: 1, lost: 1 });
    expect(stored(store).history).toHaveLength(1);
    // Připojení dohraného runu nic nezaeviduje.
    pc.attach(c);
    expect(pc.profile.current).toBeNull();
  });

  it('výhra: zapsaná při victory, finish zapíše historii a odemkne další sílu piva', async () => {
    const store = memoryStore();
    const pc = controller(store);
    const c = pc.newRun({ deckId: 'pub', stake: 1, seed: 'VYHRAPUB' });
    // Run těsně před výhrou (šéf 8. patra, chybí bod): stav z enginu podstrčený přes uložení.
    const g = Game.fromState(structuredClone(c.state) as RunState, REG);
    const prep = structuredClone(g.state) as RunState;
    prep.ante = 8;
    prep.blindIndex = 2;
    prep.blinds.forEach((b, i) => (b.status = i < 2 ? 'defeated' : 'current'));
    const boss = Game.fromState(prep, REG);
    boss.dispatch({ type: 'selectBlind' });
    const state = structuredClone(boss.state) as RunState;
    state.round!.score = state.round!.target - 1;
    const winning = state
      .round!.hand.map((id) => [id])
      .find((ids) => {
        const trial = Game.fromState(structuredClone(state) as RunState, REG);
        trial.dispatch({ type: 'play', cardIds: ids });
        return trial.state.phase === 'victory';
      });
    expect(winning).toBeDefined();
    store.set(STORAGE_KEYS.run, serializeRun(state, NOW.toISOString()));
    const resumed = pc.resume()!;
    // Profil k uloženému runu patří (stejný seed, balíček…) — nic nového nezaeviduje.
    expect(pc.profile.current?.seed).toBe('VYHRAPUB');
    expect(pc.profile.current?.no).toBe(1);
    await resumed.act({ type: 'play', cardIds: winning! });
    expect(resumed.state.phase).toBe('victory');
    expect(pc.profile.stats.runs.won).toBe(1);
    expect(pc.profile.unlocks.stakes.pub).toBe(2);
    expect(pc.profile.current?.outcome).toBe('won');
    pc.finish(resumed);
    expect(pc.profile.current).toBeNull();
    expect(pc.profile.history[0]).toMatchObject({ seed: 'VYHRAPUB', outcome: 'won' });
    pc.finish(resumed);
    expect(pc.profile.history).toHaveLength(1);
  });

  it('obnovení cizího runu (import) ho zaeviduje; attach je idempotentní', () => {
    const store = memoryStore();
    const g = Game.newRun({ deckId: 'regulars', stake: 1, seed: 'CIZIRUNA' }, REG);
    store.set(STORAGE_KEYS.run, serializeRun(g.state, NOW.toISOString()));
    const pc = controller(store);
    const c = pc.resume()!;
    expect(pc.profile.current).toMatchObject({ seed: 'CIZIRUNA', deckId: 'regulars', counted: true });
    const no = pc.profile.current!.no;
    pc.attach(c);
    expect(pc.profile.current!.no).toBe(no);
  });
});

describe('oznámení', () => {
  it('noticeText: odemčení, síla piva, achievement (bez chybějících textů)', () => {
    const notices: MetaNotice[] = [
      { kind: 'unlock', category: 'decks', id: 'clerk' },
      { kind: 'unlock', category: 'jokers', id: Object.keys(REG.jokers)[0]! },
      { kind: 'unlock', category: 'vouchers', id: Object.keys(REG.vouchers)[0]! },
      { kind: 'unlock', category: 'challenges', id: Object.keys(REG.challenges)[0]! },
      { kind: 'stake', deckId: 'pub', stake: 2 },
      { kind: 'achievement', id: 'neznamy_achievement' },
    ];
    const texts = notices.map((n) => noticeText(n, REG));
    for (const text of texts) expect(text).not.toContain('⟦');
    expect(texts[0]).toContain(t('decks.clerk.name'));
    expect(texts[4]).toContain(t('stakes.jedenactka.name'));
    expect(texts[4]).toContain(t('decks.pub.name'));
    expect(texts[5]).toContain('neznamy_achievement');
  });

  it('showMetaNotices: fronta — nejvýš dva toasty naráz, další přijde, až předchozí odejde', () => {
    const ids = Object.keys(REG.challenges).slice(0, 3);
    const notices: MetaNotice[] = ids.map((id) => ({ kind: 'unlock', category: 'challenges', id }));
    showMetaNotices(notices, REG);
    const region = document.querySelector('.toast-region') ?? document.body;
    const shown = (): HTMLElement[] => [
      ...region.querySelectorAll<HTMLElement>('[data-testid="toast-unlock"]:not(.toast--leaving)'),
    ];
    expect(shown()).toHaveLength(META_TOASTS_VISIBLE);
    expect(noticeQueue(REG).pending).toBe(1);
    // Ikona, štítek, název a popis.
    const first = shown()[0]!;
    expect(first.querySelector('.toast__media svg')).not.toBeNull();
    expect(first.querySelector('.toast__eyebrow')?.textContent).toBe(t('meta.notice.eyebrow.challenges'));
    expect(first.querySelector('.toast__title')?.textContent).toBe(t(`challenges.${ids[0]!}.name`));
    first.querySelector<HTMLButtonElement>('.toast__close')!.click();
    expect(noticeQueue(REG).pending).toBe(0);
    expect(region.textContent).toContain(t(`challenges.${ids[2]!}.name`));
    noticeQueue(REG).clear();
  });

  it('unlockInfo: podmínka balíčku s průběhem, odemčený od začátku = null', () => {
    const p = createProfile(NOW.toISOString());
    expect(unlockInfo(p, REG, 'decks', 'pub')).toBeNull();
    const clerk = unlockInfo(p, REG, 'decks', 'clerk');
    expect(clerk?.met).toBe(false);
    expect(clerk?.text).not.toContain('⟦');
    p.stats.totals.vouchersBought = 2;
    expect(unlockInfo(p, REG, 'decks', 'clerk')).toMatchObject({ progress: 2, target: 5 });
  });
});

describe('App a Nastavení nad profilem', () => {
  function app(store: KeyValueStore): App {
    return new App(document.querySelector<HTMLElement>('#app')!, store, REG, {
      now: clock,
      notify: () => undefined,
      onProblem: () => undefined,
    });
  }

  it('app.settings čte profil, updateSettings ho ukládá a promítá do stránky', () => {
    const store = memoryStore();
    const a = app(store);
    expect(a.settings).toEqual(DEFAULT_SETTINGS);
    expect(a.profile).toBe(a.profiles.profile);
    a.updateSettings({ colorblind: true });
    expect(document.documentElement.classList.contains('colorblind')).toBe(true);
    expect(stored(store).settings.colorblind).toBe(true);
    a.updateSettings({ colorblind: false });
  });

  it('export obsahuje profil i zálohy poškozeného profilu; import profil ověří a načte', () => {
    const store = memoryStore({ [`${PROFILE_BACKUP_PREFIX}123`]: '{stará data' });
    const a = app(store);
    a.profile.stats.runs.won = 4;
    a.profiles.save();
    const exported = buildExport(store, a.settings, NOW);
    expect(exported.profileBackups).toEqual({ [`${PROFILE_BACKUP_PREFIX}123`]: '{stará data' });
    expect((exported.profile as { kind: string }).kind).toBe('profile');

    // Neplatný profil v exportu → import odmítnut.
    expect(() => parseImport(JSON.stringify({ ...exported, profile: { format: 'nic' } }), REG, NOW)).toThrow(
      ImportError,
    );
    // Samotná obálka profilu jde nahrát taky.
    const plain = parseImport(serializeProfile(a.profile, NOW.toISOString()), REG, NOW);
    expect(plain.profile).toBeTypeOf('string');

    // Import: profil z exportu, nastavení z exportu má přednost.
    a.profile.stats.runs.won = 0;
    a.profiles.save();
    const plan = parseImport(
      JSON.stringify({ ...exported, settings: { ...exported.settings, speed: 3 } }),
      REG,
      NOW,
    );
    applyImport(a, plan, NOW);
    expect(a.profile.stats.runs.won).toBe(4);
    expect(a.settings.speed).toBe(3);
    expect(stored(store).settings.speed).toBe(3);
    // Přepsaný profil (0 výher) skončil v záloze.
    const backup = store.get(`${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`);
    expect(deserializeProfile(backup).stats.runs.won).toBe(0);
  });

  it('reset profilu: čistý profil, výchozí nastavení, starý profil v záloze (staré zálohy zůstanou)', () => {
    const store = memoryStore({ [`${PROFILE_BACKUP_PREFIX}1`]: 'x', [STORAGE_KEYS.run]: 'run' });
    const a = app(store);
    a.profile.stats.runs.played = 9;
    a.updateSettings({ speed: 2 });
    const backupKey = resetProfile(a, NOW);
    expect(a.profile.stats.runs.played).toBe(0);
    expect(a.settings).toEqual(DEFAULT_SETTINGS);
    expect(stored(store).stats.runs.played).toBe(0);
    expect(store.get(STORAGE_KEYS.run)).toBeNull();
    // Profil se nikdy neztratí: záloha s profilem před resetem, starší záloha zůstala.
    expect(backupKey).toBe(`${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`);
    expect(deserializeProfile(store.get(backupKey!)).stats.runs.played).toBe(9);
    expect(store.get(`${PROFILE_BACKUP_PREFIX}1`)).toBe('x');
  });

  it('chyba pozorovatele nezastaví hru', async () => {
    const store = memoryStore();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c = GameController.newRun(
      { deckId: 'pub', stake: 1, seed: 'POZOROVA' },
      {
        registry: REG,
        store,
        observer: {
          onEvents: () => {
            throw new Error('meta selhala');
          },
        },
      },
    );
    const res = await c.act({ type: 'selectBlind' });
    expect(res.ok).toBe(true);
    expect(c.state.phase).toBe('round');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
