// @vitest-environment happy-dom
/**
 * Revize fáze 8 (docs/DECISIONS.md „Revize a uzavření fáze 8“): opravy nalezené při kontrole meta vrstvy.
 *  - profil se nikdy neztratí: poškozená / cizí / novější data → záloha s přesným obsahem; reset ani import profil
 *    nepřepíšou, když zálohu nejde zapsat; export bez profilu profil nesmaže; zálohy v jedné ms se nepřepíšou,
 *  - denní run jen jednou oficiálně: pokračování cizího denního runu bez rozehraného záznamu je mimo soutěž, import
 *    staršího profilu odehraný den nevrátí,
 *  - sbírka a achievementy nejdou „farmit“ opakovaným zakládáním runu: startovní výbava (Velký třesk, Vetešnický)
 *    se objeví až po první vyhrané útratě; seedovaný run dál nedá nic kromě „Semínko zaseto“,
 *  - texty: první výhra, patro výhry na výherní obrazovce.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import type { MetaCtx, Profile, RunState } from '../../src/engine';
import {
  DISCOVERY_CATEGORIES,
  Game,
  applyRunEvent,
  createProfile,
  dailyRunSetup,
  deserializeProfile,
  finishRun,
  isDailyAvailable,
  isJokerUnlocked,
  mergeDailyRecords,
  resumeRun,
  serializeProfile,
  serializeRun,
  startRun,
  unlockTextFor,
  unlockedPoolFor,
} from '../../src/engine';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { clearToasts } from '../../src/ui/components/toast';
import { unlockSpecText } from '../../src/ui/metaText';
import { COLLECTION_TABS, collectionEntries } from '../../src/ui/screens/collection';
import {
  ProfileBackupError,
  applyImport,
  backupStoredProfile,
  parseImport,
  resetProfile,
} from '../../src/ui/screens/settings';
import { PROFILE_BACKUP_PREFIX, restoreStoredProfile, writeProfileBackup } from '../../src/ui/settings';
import type { KeyValueStore } from '../../src/ui/storage';
import { STORAGE_KEYS, memoryStore } from '../../src/ui/storage';

const REG = registry();
const NOW = new Date('2026-10-02T10:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const ctx = (nowIso = NOW_ISO): MetaCtx => ({ registry: REG, nowIso });

/** Úložiště, které odmítá zápis záloh profilu (plné úložiště). */
function noBackupStore(initial: Record<string, string> = {}): KeyValueStore {
  const inner = memoryStore(initial);
  return { ...inner, set: (k, v) => (k.startsWith(PROFILE_BACKUP_PREFIX) ? false : inner.set(k, v)) };
}

function makeApp(store: KeyValueStore): App {
  const root = document.getElementById('app')!;
  return new App(root, store, REG, { now: () => NOW, notify: () => undefined, onProblem: () => undefined });
}

function storedProfile(store: KeyValueStore): Profile {
  return deserializeProfile(store.get(STORAGE_KEYS.profile));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  clearToasts();
});

// ─────────────────────────── Profil se nikdy neztratí ───────────────────────────

describe('profil se nikdy neztratí', () => {
  const garbage: Record<string, string> = {
    'neplatný JSON': '{"format":"karban-save",',
    'cizí JSON': JSON.stringify({ hello: 'world' }),
    'jiný druh uložení': JSON.stringify({
      format: 'karban-save',
      kind: 'run',
      version: 1,
      savedAt: NOW_ISO,
      data: {},
    }),
    'novější verze': JSON.stringify({
      format: 'karban-save',
      kind: 'profile',
      version: 99,
      savedAt: NOW_ISO,
      data: {},
    }),
    'verze 0 bez migrace': JSON.stringify({
      format: 'karban-save',
      kind: 'profile',
      version: 0,
      savedAt: NOW_ISO,
      data: {},
    }),
  };

  for (const [name, raw] of Object.entries(garbage)) {
    it(`${name}: přesná data jdou do zálohy, hra jede s novým profilem`, () => {
      const store = memoryStore({ [STORAGE_KEYS.profile]: raw });
      const res = restoreStoredProfile(store, NOW);
      expect(res.status).toBe('corrupt');
      expect(res.writable).toBe(true);
      expect(res.backupKey).toBe(`${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`);
      expect(store.get(res.backupKey!)).toBe(raw);
      expect(storedProfile(store).stats.runs.played).toBe(0);
    });
  }

  it('platná obálka bez klíčů (prázdná data) se načte a doplní, nezálohuje se', () => {
    const raw = JSON.stringify({
      format: 'karban-save',
      kind: 'profile',
      version: 1,
      savedAt: NOW_ISO,
      data: {},
    });
    const store = memoryStore({ [STORAGE_KEYS.profile]: raw });
    const res = restoreStoredProfile(store, NOW);
    expect(res.status).toBe('loaded');
    expect(store.keys().filter((k) => k.startsWith(PROFILE_BACKUP_PREFIX))).toEqual([]);
    expect(res.profile.unlocks).toEqual({ decks: [], stakes: {}, jokers: [], vouchers: [], challenges: [] });
  });

  it('záloha poškozeného profilu nepřepíše jinou zálohu ze stejné milisekundy', () => {
    const older = `${PROFILE_BACKUP_PREFIX}${NOW.getTime()}`;
    const store = memoryStore({ [older]: 'starší záloha', [STORAGE_KEYS.profile]: 'rozbité' });
    const res = restoreStoredProfile(store, NOW);
    expect(store.get(older)).toBe('starší záloha');
    expect(res.backupKey).toBe(`${PROFILE_BACKUP_PREFIX}${NOW.getTime() + 1}`);
    expect(store.get(res.backupKey!)).toBe('rozbité');
    // stejný obsah pod stejným klíčem se nezdvojí
    expect(writeProfileBackup(store, 'rozbité', new Date(NOW.getTime() + 1))).toBe(res.backupKey);
  });

  it('reset: když zálohu nejde zapsat, nesmaže profil ani rozehranou hru', () => {
    const store = noBackupStore();
    const app = makeApp(store);
    app.profile.stats.runs.played = 7;
    app.profiles.save();
    const run = serializeRun(Game.newRun({ deckId: 'pub', stake: 1, seed: 'RESETNIC' }, REG).state, NOW_ISO);
    store.set(STORAGE_KEYS.run, run);
    expect(() => resetProfile(app, NOW)).toThrow(ProfileBackupError);
    expect(storedProfile(store).stats.runs.played).toBe(7);
    expect(app.profile.stats.runs.played).toBe(7);
    expect(store.get(STORAGE_KEYS.run)).toBe(run);
  });

  it('import: když zálohu nejde zapsat, nezapíše nic', () => {
    const store = noBackupStore();
    const app = makeApp(store);
    app.profile.stats.runs.played = 4;
    app.profiles.save();
    const other = createProfile(NOW_ISO);
    other.stats.runs.played = 99;
    const plan = parseImport(serializeProfile(other, NOW_ISO), REG, NOW);
    expect(() => backupStoredProfile(app, NOW)).toThrow(ProfileBackupError);
    expect(() => applyImport(app, plan, NOW)).toThrow(ProfileBackupError);
    expect(storedProfile(store).stats.runs.played).toBe(4);
  });

  it('export bez profilu stávající profil nesmaže a chybějící nastavení nepřebije nastavení profilu', () => {
    const store = memoryStore();
    const app = makeApp(store);
    app.profile.stats.runs.played = 3;
    app.updateSettings({ speed: 3 });
    const plan = parseImport(
      JSON.stringify({ format: 'karban-export', version: 1, exportedAt: NOW_ISO, profile: null, run: null }),
      REG,
      NOW,
    );
    expect(plan.profile).toBeUndefined();
    expect(plan.settings).toBeUndefined();
    applyImport(app, plan, NOW);
    expect(storedProfile(store).stats.runs.played).toBe(3);
    expect(app.settings.speed).toBe(3);
  });
});

// ─────────────────────────── Denní run jen jednou oficiálně ───────────────────────────

describe('denní run: jeden oficiální pokus', () => {
  const setup = dailyRunSetup(NOW_ISO, REG);
  const dailyGame = (): Game =>
    Game.newRun(
      { seed: setup.seed, deckId: setup.deckId, stake: setup.stake, daily: true, unlockedPool: undefined },
      REG,
    );

  it('pokračování cizího denního runu bez rozehraného záznamu dne je mimo soutěž', () => {
    const p = createProfile(NOW_ISO);
    resumeRun(p, dailyGame().state, ctx());
    expect(p.current).toMatchObject({ mode: 'daily', official: false, counted: false });
    expect(p.daily).toEqual({});
    expect(isDailyAvailable(p, NOW_ISO)).toBe(true);
  });

  it('pokus mimo soutěž se po „ztrátě“ záznamu v profilu nestane oficiálním', () => {
    const p = createProfile(NOW_ISO);
    const first = dailyGame();
    startRun(p, first.state, ctx());
    expect(p.current!.official).toBe(true);
    finishRun(p, first.state, ctx());
    expect(p.daily[setup.dateKey]!.status).toBe('finished');
    const replay = dailyGame();
    startRun(p, replay.state, ctx());
    expect(p.current).toMatchObject({ official: false, counted: false });
    p.current = null; // import / ztracený zápis
    resumeRun(p, replay.state, ctx());
    expect(p.current).toMatchObject({ official: false, counted: false });
  });

  it('mergeDailyRecords doplní chybějící dny a existující nemění', () => {
    const a = createProfile(NOW_ISO);
    const b = createProfile(NOW_ISO);
    const rec = {
      seed: setup.seed,
      deckId: setup.deckId,
      stake: setup.stake,
      status: 'finished' as const,
      outcome: 'lost' as const,
      ante: 3,
      bestHand: 120,
      startedAt: NOW_ISO,
      finishedAt: NOW_ISO,
    };
    b.daily[setup.dateKey] = rec;
    b.daily['20260930'] = { ...rec, seed: 'DEN-20260930', ante: 5 };
    a.daily['20260930'] = { ...rec, seed: 'DEN-20260930', ante: 7 };
    expect(mergeDailyRecords(a, b)).toBe(1);
    expect(a.daily[setup.dateKey]).toEqual(rec);
    expect(a.daily['20260930']!.ante).toBe(7);
  });

  it('import staršího profilu nevrátí dnešní oficiální pokus', () => {
    const store = memoryStore();
    const app = makeApp(store);
    const older = serializeProfile(createProfile(NOW_ISO), NOW_ISO);
    // dnešní oficiální pokus odehraný v současném profilu
    const g = dailyGame();
    startRun(app.profile, g.state, ctx());
    finishRun(app.profile, g.state, ctx());
    app.profiles.save();
    expect(isDailyAvailable(app.profile, NOW_ISO)).toBe(false);
    applyImport(app, parseImport(older, REG, NOW), NOW);
    expect(isDailyAvailable(app.profile, NOW_ISO)).toBe(false);
    expect(storedProfile(store).daily[setup.dateKey]).toMatchObject({ status: 'finished' });
  });
});

// ─────────────────────────── Farmení sbírky opakovaným startem ───────────────────────────

describe('startovní výbava se objeví až po první vyhrané útratě', () => {
  const legendaries = (run: Readonly<RunState>): string[] =>
    run.jokers.map((j) => j.defId).filter((id) => REG.jokers[id]?.rarity === 'legendary');

  it('Velký třesk: založení výzvy legendy neobjeví ani nedá „Vyjeli z hory“; po vyhrané útratě ano', () => {
    const p = createProfile(NOW_ISO);
    const game = Game.newRun(
      {
        seed: 'TRESKTRE',
        deckId: 'pub',
        stake: 1,
        challengeId: 'big_bang',
        unlockedPool: unlockedPoolFor(p, REG, 'challenge'),
      },
      REG,
    );
    const legends = legendaries(game.state);
    expect(legends).toHaveLength(2);
    startRun(p, game.state, ctx());
    for (const id of legends) expect(p.discovered.jokers).not.toContain(id);
    expect(p.achievements.unlocked.out_of_the_mountain).toBeUndefined();
    // opuštění a nový start téhož → pořád nic
    startRun(
      p,
      Game.newRun({ seed: 'TRESKDVA', deckId: 'pub', stake: 1, challengeId: 'big_bang' }, REG).state,
      ctx(),
    );
    expect(p.discovered.jokers.filter((id) => REG.jokers[id]?.rarity === 'legendary')).toEqual([]);
    // první vyhraná útrata původního runu
    startRun(p, game.state, ctx());
    const won = structuredClone(game.state);
    won.stats.roundsWon = 1;
    applyRunEvent(p, { type: 'roundWon', ante: 1, blind: 'small', score: 900, target: 900 }, won, ctx());
    for (const id of legends) expect(p.discovered.jokers).toContain(id);
    expect(p.achievements.unlocked.out_of_the_mountain).toBe(NOW_ISO);
  });

  it('Vetešnický balíček: startovní vzácný žolík se do sbírky zapíše až po vyhrané útratě', () => {
    const p = createProfile(NOW_ISO);
    const game = Game.newRun(
      { seed: 'VETESNIK', deckId: 'junk_shop', stake: 1, unlockedPool: unlockedPoolFor(p, REG, 'normal') },
      REG,
    );
    const start = game.state.jokers.map((j) => j.defId);
    expect(start).toHaveLength(1);
    startRun(p, game.state, ctx());
    expect(p.discovered.jokers).toEqual([]);
    expect(p.discovered.decks).toContain('junk_shop');
    const won = structuredClone(game.state);
    won.stats.roundsWon = 1;
    applyRunEvent(p, { type: 'roundWon', ante: 1, blind: 'small', score: 300, target: 300 }, won, ctx());
    expect(p.discovered.jokers).toEqual(start);
  });

  it('žolík získaný během runu se objeví hned (i před první výhrou)', () => {
    const p = createProfile(NOW_ISO);
    const game = Game.newRun({ seed: 'PRIDANYZ', deckId: 'pub', stake: 1 }, REG);
    startRun(p, game.state, ctx());
    const run = structuredClone(game.state);
    run.jokers.push({
      uid: run.nextUid,
      defId: 'herbalist',
      edition: null,
      state: {},
      sellBonus: 0,
      stickers: [],
      debuffed: false,
    });
    applyRunEvent(p, { type: 'jokerAdded', uid: run.nextUid, defId: 'herbalist' }, run, ctx());
    expect(p.discovered.jokers).toContain('herbalist');
  });

  it('starší profil bez `startUid` (0) objevuje jako dřív', () => {
    const p = createProfile(NOW_ISO);
    const game = Game.newRun({ seed: 'STARYPRO', deckId: 'junk_shop', stake: 1 }, REG);
    startRun(p, game.state, ctx());
    p.current!.counters.startUid = 0;
    applyRunEvent(p, { type: 'blindSelected', blind: 'small', bossId: null, target: 300 }, game.state, ctx());
    expect(p.discovered.jokers).toEqual(game.state.jokers.map((j) => j.defId));
    // normalizace doplní 0
    const raw = JSON.parse(serializeProfile(p, NOW_ISO)) as {
      data: { current: { counters: Record<string, unknown> } };
    };
    delete raw.data.current.counters.startUid;
    expect(deserializeProfile(JSON.stringify(raw)).current!.counters.startUid).toBe(0);
  });
});

// ─────────────────────────── Počty a sbírka ───────────────────────────

describe('počty obsahu fáze 8 a pokrytí sbírky', () => {
  it('20 výzev, aspoň 60 achievementů (78), 70 žolíků odemčených od začátku', () => {
    expect(Object.keys(REG.challenges)).toHaveLength(20);
    expect(Object.keys(REG.achievements ?? {}).length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(REG.achievements ?? {})).toHaveLength(78);
    const fresh = createProfile(NOW_ISO);
    const open = Object.keys(REG.jokers).filter((id) => isJokerUnlocked(fresh, REG, id));
    expect(open).toHaveLength(70);
  });

  it('každá kategorie objevů a „Nových“ má záložku ve sbírce (štítek „Nové“ jde vždy sundat)', () => {
    const p = createProfile(NOW_ISO);
    const covered = new Set(
      COLLECTION_TABS.flatMap((tab) => collectionEntries(tab, p, REG, NOW_ISO).map((e) => e.category)),
    );
    for (const c of [...DISCOVERY_CATEGORIES, 'stakes', 'challenges', 'achievements'])
      expect(covered, c).toContain(c);
    // obálky: objevená obálka má název a cenu, „Nové“ zmizí po zobrazení záložky
    const booster = Object.keys(REG.boosters)[0]!;
    p.discovered.boosters.push(booster);
    p.unseen.push(`boosters:${booster}`);
    const entry = collectionEntries('boosters', p, REG, NOW_ISO).find((e) => e.id === booster)!;
    expect(entry).toMatchObject({ state: 'discovered', isNew: true });
    expect(entry.name).not.toBe(t('meta.collection.unknownName'));
    expect(entry.detail().facts[0]!.label).toBe(t('meta.collection.detail.price'));
  });
});

// ─────────────────────────── Texty ───────────────────────────

describe('texty revize', () => {
  it('výzvy první várky: „Vyhraj svůj první run.“, další várky s počtem', () => {
    expect(unlockSpecText(unlockTextFor(REG, 'challenges', 'greenhouse'))).toBe(
      t('meta.unlock.cond.winsTotalFirst'),
    );
    expect(unlockSpecText(unlockTextFor(REG, 'challenges', 'minimalist'))).toBe(
      t('meta.unlock.cond.winsTotal', { count: 3 }),
    );
  });

  it('výherní obrazovka říká patro výhry (Konec světa = 12)', () => {
    expect(t('game.victory.subtitle', { ante: 12 })).toContain('12.');
    expect(t('game.victory.subtitle', { ante: 8 })).not.toContain('{');
  });
});
