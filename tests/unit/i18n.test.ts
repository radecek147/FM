import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cs, hasKey, missingText, t, tList } from '../../src/i18n/cs';
import { NBSP } from '../../src/i18n/format';
import { HAND_TYPES, RANKS, SUITS } from '../../src/engine/types';
import type { ActionErrorCode } from '../../src/engine/types';

/** Ručně vypsané kódy z `ActionErrorCode` (src/engine/types.ts). `satisfies` hlídá překlepy. */
const ERROR_CODES = [
  'wrongPhase',
  'invalidSelection',
  'noHandsLeft',
  'noDiscardsLeft',
  'notEnoughMoney',
  'slotsFull',
  'soldOut',
  'invalidTarget',
  'cannotSell',
  'cannotUse',
  'unknownItem',
  'cannotSkip',
] as const satisfies readonly ActionErrorCode[];

// Kontrola úplnosti v době kompilace: když v ActionErrorCode přibude kód, tady to spadne.
type MissingCodes = Exclude<ActionErrorCode, (typeof ERROR_CODES)[number]>;
const _allCodesListed: MissingCodes extends never ? true : false = true;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('t()', () => {
  it('najde text podle tečkové cesty', () => {
    expect(t('app.title')).toBe('Karban');
    expect(t('menu.newGame.label')).toBe('Nová hra');
    expect(t('ranks.12.name')).toBe('Dáma');
    expect(t('ranks.11.short')).toBe('J');
    expect(t('suits.H.symbol')).toBe('♥');
    expect(t('typoTest')).toBe('Příliš žluťoučký kůň úpěl ďábelské ódy');
  });

  it('aplikuje typografii (NBSP za jednopísmennou předložkou a před pomlčkou)', () => {
    expect(t('app.subtitle')).toBe('Hospodský roguelike se žolíky');
    expect(t('app.documentTitle')).toBe(`Karban${NBSP}– hospodský roguelike se žolíky`);
  });

  it('chybějící klíč vrátí ⟦key⟧ a v testech nevaruje', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('neexistuje.vubec')).toBe('⟦neexistuje.vubec⟧');
    expect(t('app.title.navic')).toBe('⟦app.title.navic⟧');
    expect(t('menu')).toBe('⟦menu⟧'); // větev, ne text
    expect(t('loadingTips')).toBe('⟦loadingTips⟧'); // seznam, ne text
    expect(t('app.toString')).toBe('⟦app.toString⟧'); // žádné klíče z prototypu
    expect(t('')).toBe('⟦⟧');
    expect(missingText('x.y')).toBe('⟦x.y⟧');
    expect(warn).not.toHaveBeenCalled();
  });

  it('interpoluje parametry včetně plural', () => {
    expect(t('menu.comingSoon', { phase: 3 })).toBe(`Už brzy${NBSP}– ve fázi 3`);
    expect(t('app.version', { version: '1.2.3' })).toBe('verze 1.2.3');
  });

  it('hasKey', () => {
    expect(hasKey('app.title')).toBe(true);
    expect(hasKey('loadingTips')).toBe(true);
    expect(hasKey('menu')).toBe(false);
    expect(hasKey('app.nic')).toBe(false);
    expect(hasKey('constructor')).toBe(false);
  });

  it('tList vrátí seznam (s typografií), chybějící klíč prázdné pole', () => {
    const tips = tList('loadingTips');
    expect(tips.length).toBeGreaterThanOrEqual(15);
    expect(tips.length).toBe(cs.loadingTips.length);
    expect(tList('app.title')).toEqual([]);
    expect(tList('nic.takoveho')).toEqual([]);
  });
});

describe('obsah cs', () => {
  it('všechny ActionErrorCode mají text + obecná chyba', () => {
    expect(_allCodesListed).toBe(true);
    for (const code of ERROR_CODES) {
      expect(hasKey(`errors.${code}`), code).toBe(true);
      expect(t(`errors.${code}`).length, code).toBeGreaterThan(10);
    }
    expect(cs.errors.generic).toBe('Něco se pokazilo. Jako u Vaňků o Vánocích.');
    expect(t('errors.generic')).toBe(`Něco se pokazilo. Jako u${NBSP}Vaňků o${NBSP}Vánocích.`);
  });

  it('všechny kombinace mají název a popis', () => {
    expect(HAND_TYPES).toHaveLength(13);
    for (const hand of HAND_TYPES) {
      expect(hasKey(`hands.${hand}.name`), hand).toBe(true);
      expect(hasKey(`hands.${hand}.desc`), hand).toBe(true);
    }
    expect(t('hands.full_house.name')).toBe('Full house');
    expect(t('hands.straight_flush.name')).toBe(`Postupka v${NBSP}barvě`);
    expect(t('hands.flush_five.name')).toBe('Barevná pětice');
  });

  it('všechny hodnoty a barvy mají texty', () => {
    for (const rank of RANKS) {
      expect(hasKey(`ranks.${rank}.name`), String(rank)).toBe(true);
      expect(hasKey(`ranks.${rank}.short`), String(rank)).toBe(true);
    }
    expect(RANKS.map((r) => t(`ranks.${r}.short`)).slice(-4)).toEqual(['J', 'Q', 'K', 'A']);
    for (const suit of SUITS) {
      expect(hasKey(`suits.${suit}.name`), suit).toBe(true);
      expect(hasKey(`suits.${suit}.symbol`), suit).toBe(true);
    }
    expect(SUITS.map((s) => t(`suits.${s}.symbol`)).join('')).toBe('♠♥♦♣');
  });

  it('hlavní menu má všechny položky', () => {
    for (const item of [
      'newGame',
      'continue',
      'challenges',
      'daily',
      'collection',
      'stats',
      'settings',
      'credits',
    ]) {
      expect(hasKey(`menu.${item}.label`), item).toBe(true);
      expect(hasKey(`menu.${item}.hint`), item).toBe(true);
    }
  });

  it('texty nemají rovné uvozovky, tři tečky, dlouhou pomlčku ani nevokalizované „s ž…“', () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        expect(node, path).not.toMatch(/"|\.\.\.|—/);
        // Předložky s/z/k/v před stejnou nebo podobnou hláskou se vokalizují: „se žolíky“, „ze stolu“.
        expect(node, path).not.toMatch(/(?<![\p{L}])[sz][ \u00a0][szšž]/iu);
        expect(node, path).toBe(node.trim());
      } else if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${path}[${i}]`));
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(cs, '');
  });

  it('index.html nemá texty natvrdo a všechny jeho klíče {{t:…}} existují', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/\{\{t:([\w.]+)\}\}/g)].map((m) => m[1] ?? '');
    expect(keys).toEqual(
      expect.arrayContaining(['app.documentTitle', 'app.metaDescription', 'app.noscript']),
    );
    for (const key of keys) expect(hasKey(key), key).toBe(true);
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(withoutComments.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('{{t:app.documentTitle}}');
    expect(withoutComments.match(/<noscript>([^<]*)<\/noscript>/)?.[1]).toBe('{{t:app.noscript}}');
  });
});
