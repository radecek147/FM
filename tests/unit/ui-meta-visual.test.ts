// @vitest-environment happy-dom
/**
 * Doplňky z vizuální kontroly fáze 8: nadpisy kategorií achievementů ve sbírce (skupiny bez nadpisu vypadaly jako
 * chyba rozvržení), zámek / otazník přes siluetu v detailu sbírky a zámek přes siluetu zamčené výzvy.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '../../src/content';
import { t } from '../../src/i18n/cs';
import { App } from '../../src/ui/app';
import { closeAllModals } from '../../src/ui/components/modal';
import { clearToasts } from '../../src/ui/components/toast';
import { challengesScreen } from '../../src/ui/screens/challenges';
import { collectionScreen } from '../../src/ui/screens/collection';
import { menuScreen } from '../../src/ui/screens/menu';
import { STORAGE_KEYS, memoryStore } from '../../src/ui/storage';

const REG = registry();
const NOW = new Date('2026-10-02T10:00:00.000Z');

let app: App;
let root: HTMLElement;

function q<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`nenalezeno: ${sel}`);
  return el;
}

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector<HTMLElement>('#app')!;
});

beforeEach(() => {
  const store = memoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ animations: false }) });
  app = new App(root, store, REG, { now: () => NOW, notify: () => undefined, onProblem: () => undefined });
  app.register('menu', menuScreen);
  app.register('collection', collectionScreen);
  app.register('challenges', challengesScreen);
  app.register('game', () => ({ el: document.createElement('main') }));
});

afterEach(() => {
  closeAllModals();
  clearToasts();
});

describe('sbírka', () => {
  it('achievementy mají nadpis každé kategorie (v pořadí obsahu)', () => {
    app.go('collection', { tab: 'achievements' });
    const expected = [...new Set(Object.values(REG.achievements ?? {}).map((a) => a.category))].map((c) =>
      t(`meta.collection.achievementCategories.${c}`),
    );
    const titles = [...document.querySelectorAll('.codex-group__title')].map((el) => el.textContent);
    expect(expected.length).toBeGreaterThan(1);
    expect(titles).toEqual(expected);
    // Skupina nese přístupný název kategorie.
    expect(document.querySelectorAll('section.codex-group[aria-label]')).toHaveLength(expected.length);
  });

  it('ostatní záložky bez skupin nadpisy nemají', () => {
    app.go('collection', { tab: 'jokers' });
    expect(document.querySelectorAll('.codex-group__title')).toHaveLength(0);
  });

  it('detail siluety: zámek u neodemčené, otazník u neobjevené, nic u objevené položky', () => {
    const ids = Object.keys(REG.jokers);
    const locked = ids.find((id) => REG.jokers[id]?.unlock)!;
    const plain = ids.filter((id) => !REG.jokers[id]?.unlock && REG.jokers[id]?.rarity !== 'legendary');
    const [known, unknown] = plain;
    app.profile.discovered.jokers = [known!];
    app.go('collection', { tab: 'jokers' });

    const mark = (): Element | null =>
      q('[data-testid="codex-detail-body"]').querySelector('.codex-detail__mark');
    q(`[data-testid="codex-item-${known}"]`).click();
    expect(mark()).toBeNull();
    closeAllModals();

    q(`[data-testid="codex-item-${unknown}"]`).click();
    expect(mark()).not.toBeNull();
    expect(mark()?.closest('[aria-hidden="true"]')).not.toBeNull();
    closeAllModals();

    expect(q(`[data-testid="codex-item-${locked}"]`).dataset.state).toBe('locked');
    q(`[data-testid="codex-item-${locked}"]`).click();
    expect(mark()).not.toBeNull();
  });
});

describe('výzvy', () => {
  it('zamčená výzva má zámek přes siluetu karty, odemčená ne', () => {
    app.profile.stats.runs.won = 1;
    app.profile.stats.runs.played = 1;
    app.profiles.refresh();
    app.go('challenges');
    q('[data-testid="challenge-dry_february"]').click();
    expect(q('[data-testid="challenge-detail"]').dataset.status).toBe('locked');
    const lock = document.querySelector('.challenge-detail__art .challenge-detail__lock');
    expect(lock).not.toBeNull();
    expect(lock?.closest('[aria-hidden="true"]')).not.toBeNull();

    q('[data-testid="challenge-greenhouse"]').click();
    expect(q('[data-testid="challenge-detail"]').dataset.status).not.toBe('locked');
    expect(document.querySelector('.challenge-detail__lock')).toBeNull();
  });
});
