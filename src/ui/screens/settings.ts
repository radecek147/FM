/**
 * Nastavení (docs/DESIGN.md 13.4): hlasitosti, rychlost 1×–4×, animace, screen shake, celá obrazovka,
 * barvoslepý režim, velikost UI 80–140 %, rady Štamgasta, přehled klávesových zkratek, export/import
 * uložení (JSON přes Blob, žádná síť) a reset profilu s dvojím potvrzením.
 *
 * Funguje jako samostatná obrazovka (`settingsScreen`) i jako dialog ze hry (`openSettingsModal(app)`).
 * Změny jdou výhradně přes `app.updateSettings` (uloží a promítne do <html>).
 */
import { version as appVersion } from '../../../package.json';
import type { ContentRegistry } from '../../engine';
import {
  Game,
  SAVE_FORMAT,
  SaveError,
  deserializeProfile,
  deserializeRun,
  serializeProfile,
  serializeRun,
} from '../../engine';
import { t } from '../../i18n/cs';
import type { App, ScreenFactory } from '../app';
import { backButton, button } from '../components/button';
import type { ModalHandle } from '../components/modal';
import { confirmModal, openModal } from '../components/modal';
import { toast } from '../components/toast';
import { h } from '../dom';
import type { Settings } from '../settings';
import { DEFAULT_SETTINGS, PROFILE_BACKUP_PREFIX, sanitizeSettings } from '../settings';
import type { KeyValueStore } from '../storage';
import { STORAGE_KEYS } from '../storage';

// ─────────────────────────── Export / import (bez DOM, testovatelné) ───────────────────────────

export const EXPORT_FORMAT = 'karban-export';
export const EXPORT_VERSION = 1;
/** Prefix všech klíčů hry v úložišti (reset maže všechny). */
const STORAGE_PREFIX = 'karban.';

export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: Settings;
  /** Profil (obálka `karban-save` kind `profile`), nebo null. */
  profile: unknown;
  /** Rozehraný run (obálka `karban-save` kind `run`), nebo null. */
  run: unknown;
  /**
   * Zálohy poškozeného profilu (`karban.profile.backup.<ms>` → surová data), aby se daly vytáhnout i mimo
   * prohlížeč (profil se nikdy nesmí ztratit). Import je ignoruje.
   */
  profileBackups?: Record<string, string>;
}

function parseStored(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Poškozená data neztrácej — exportuj je aspoň jako text.
    return raw;
  }
}

/** Obsah exportu: profil, nastavení, rozehraný run a zálohy poškozeného profilu z úložiště. */
export function buildExport(store: KeyValueStore, settings: Settings, now: Date): ExportPayload {
  const payload: ExportPayload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    settings: { ...settings },
    profile: parseStored(store.get(STORAGE_KEYS.profile)),
    run: parseStored(store.get(STORAGE_KEYS.run)),
  };
  const backups: Record<string, string> = {};
  for (const key of store.keys().sort()) {
    if (!key.startsWith(PROFILE_BACKUP_PREFIX)) continue;
    const raw = store.get(key);
    if (raw !== null) backups[key] = raw;
  }
  if (Object.keys(backups).length > 0) payload.profileBackups = backups;
  return payload;
}

export type ImportErrorCode = SaveError['code'] | 'unknownContent' | 'readFailed';

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = 'ImportError';
  }
}

/** Co import zapíše: `undefined` = nechat beze změny, `null` = smazat. */
export interface ImportPlan {
  settings?: Settings;
  profile?: string | null;
  run?: string | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Ověří uložený profil (obálka, verze, migrace) a vrátí ho serializovaný v aktuální verzi. Neplatný profil import
 * odmítne — jinak by ho po nahrání čekala jen záloha a čistý profil.
 */
function validateProfile(raw: unknown, now: Date): string {
  try {
    return serializeProfile(deserializeProfile(raw), now.toISOString());
  } catch (e) {
    throw new ImportError(e instanceof SaveError ? e.code : 'invalidFormat');
  }
}

/** Ověří uložený run (obálka, migrace, tvar, známý obsah, jde načíst) a vrátí ho serializovaný. */
function validateRun(raw: unknown, registry: ContentRegistry, now: Date): string | null {
  let state;
  try {
    state = deserializeRun(raw);
  } catch (e) {
    throw new ImportError(e instanceof SaveError ? e.code : 'invalidFormat');
  }
  const stakeKnown = Object.values(registry.stakes).some((s) => s.level === state.stake);
  if (!registry.decks[state.deckId] || !stakeKnown) throw new ImportError('unknownContent');
  if (state.phase === 'game_over') return null;
  try {
    Game.fromState(state, registry);
  } catch {
    throw new ImportError('invalidFormat');
  }
  return serializeRun(state, now.toISOString());
}

/**
 * Rozebere importovaný soubor: export Karbanu (`karban-export`), nebo samotné uložení runu (`karban-save`).
 * Při chybě vyhodí `ImportError` s kódem pro `settings.import.errors.<code>`.
 */
export function parseImport(text: string, registry: ContentRegistry, now = new Date()): ImportPlan {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ImportError('invalidJson');
  }
  if (!isRecord(obj)) throw new ImportError('invalidFormat');

  if (obj.format === EXPORT_FORMAT) {
    const v = obj.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new ImportError('invalidFormat');
    if (v > EXPORT_VERSION) throw new ImportError('tooNew');
    let profile: string | null = null;
    if (obj.profile !== null && obj.profile !== undefined) {
      if (isRecord(obj.profile) || typeof obj.profile === 'string') profile = validateProfile(obj.profile, now);
      else throw new ImportError('invalidFormat');
    }
    const run = obj.run === null || obj.run === undefined ? null : validateRun(obj.run, registry, now);
    return {
      settings: sanitizeSettings(isRecord(obj.settings) ? obj.settings : {}),
      profile,
      run,
    };
  }

  if (obj.format === SAVE_FORMAT) {
    if (obj.kind === 'profile') return { profile: validateProfile(obj, now) };
    if (obj.kind !== 'run') throw new ImportError('wrongKind');
    return { run: validateRun(obj, registry, now) };
  }
  throw new ImportError('invalidFormat');
}

/**
 * Zapíše import do úložiště a profil v paměti načte znovu (nastavení z exportu má přednost před nastavením
 * v profilu). Rozehraný controller zahodí (stav se změnil pod ním).
 */
export function applyImport(app: App, plan: ImportPlan): void {
  const write = (key: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    if (value === null) app.store.remove(key);
    else app.store.set(key, value);
  };
  write(STORAGE_KEYS.profile, plan.profile);
  write(STORAGE_KEYS.run, plan.run);
  app.controller = null;
  if (plan.profile !== undefined) app.profiles.reload();
  if (plan.settings) app.updateSettings(plan.settings);
}

/** Smaže všechno, co hra uložila (i zálohy profilu), a začne s čistým profilem a výchozím nastavením. */
export function resetProfile(app: App): void {
  for (const key of app.store.keys()) if (key.startsWith(STORAGE_PREFIX)) app.store.remove(key);
  app.controller = null;
  app.profiles.reset({ ...DEFAULT_SETTINGS });
  app.updateSettings({ ...DEFAULT_SETTINGS });
}

function exportFilename(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return t('settings.export.filename', { date });
}

/** Stáhne export jako soubor JSON (Blob + odkaz s atributem download — žádná síť). */
export function downloadExport(app: App): void {
  if (app.controller && app.controller.state.phase !== 'game_over') app.controller.save();
  app.profiles.save();
  const now = new Date();
  const json = JSON.stringify(buildExport(app.store, app.settings, now), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: exportFilename(now), class: 'visually-hidden' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─────────────────────────── Ovládací prvky ───────────────────────────

interface RangeOptions {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  hint?: string;
}

function rangeControl(o: RangeOptions): HTMLElement {
  const output = h('output', { class: 'setting__value', for: o.id }, o.format(o.value));
  const input = h('input', {
    id: o.id,
    class: 'range',
    type: 'range',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
    'aria-valuetext': o.format(o.value),
    'aria-describedby': o.hint ? `${o.id}-hint` : undefined,
    'data-testid': o.id,
    onInput: () => {
      const v = Number(input.value);
      output.textContent = o.format(v);
      input.setAttribute('aria-valuetext', o.format(v));
      o.onInput(v);
    },
  });
  return h(
    'div',
    { class: 'setting setting--range' },
    h('label', { class: 'setting__label', for: o.id }, o.label),
    h('div', { class: 'setting__control' }, input, output),
    o.hint ? h('p', { id: `${o.id}-hint`, class: 'setting__hint' }, o.hint) : null,
  );
}

interface ToggleOptions {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean, input: HTMLInputElement) => void;
  hint?: string;
  disabled?: boolean;
}

function toggleControl(o: ToggleOptions): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    id: o.id,
    class: 'toggle__input',
    type: 'checkbox',
    role: 'switch',
    checked: o.checked,
    disabled: o.disabled === true,
    'aria-describedby': o.hint ? `${o.id}-hint` : undefined,
    'data-testid': o.id,
    onChange: () => o.onChange(input.checked, input),
  });
  const el = h(
    'div',
    { class: 'setting setting--toggle' },
    h(
      'label',
      { class: 'toggle', for: o.id },
      input,
      h('span', { class: 'toggle__track', 'aria-hidden': 'true' }, h('span', { class: 'toggle__thumb' })),
      h('span', { class: 'setting__label' }, o.label),
    ),
    o.hint ? h('p', { id: `${o.id}-hint`, class: 'setting__hint' }, o.hint) : null,
  );
  return { el, input };
}

function speedControl(app: App): HTMLElement {
  const options = [1, 2, 3, 4].map((speed) =>
    h(
      'label',
      { class: 'segment' },
      h('input', {
        class: 'segment__input',
        type: 'radio',
        name: 'settings-speed',
        value: String(speed),
        checked: app.settings.speed === speed,
        'data-testid': `settings-speed-${speed}`,
        onChange: () => app.updateSettings({ speed }),
      }),
      h('span', { class: 'segment__label' }, t('settings.speedValue', { value: speed })),
    ),
  );
  return h(
    'fieldset',
    { class: 'setting setting--segments' },
    h('legend', { class: 'setting__label' }, t('settings.speed')),
    h('div', { class: 'segments' }, options),
  );
}

function keysTable(): HTMLElement {
  const ids = ['select', 'play', 'discard', 'sort', 'move', 'skip', 'menu', 'focus'];
  return h(
    'table',
    { class: 'keys-table', 'data-testid': 'keys-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col' }, t('settings.keys.key')),
        h('th', { scope: 'col' }, t('settings.keys.action')),
      ),
    ),
    h(
      'tbody',
      null,
      ids.map((id) =>
        h(
          'tr',
          null,
          h('td', null, h('kbd', null, t(`settings.keys.items.${id}.key`))),
          h('td', null, t(`settings.keys.items.${id}.action`)),
        ),
      ),
    ),
  );
}

function section(id: string, title: string, ...children: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'settings__section paper', 'aria-labelledby': id },
    h('h2', { id, class: 'settings__section-title' }, title),
    children,
  );
}

// ─────────────────────────── Panel (obrazovka i dialog) ───────────────────────────

interface PanelOptions {
  /** Po resetu profilu (data jsou pryč). */
  onReset: () => void;
  /** Po úspěšném importu (rozehraný run se mohl změnit). */
  onImport: () => void;
}

interface Panel {
  el: HTMLElement;
  dispose(): void;
}

function fullscreenSupported(): boolean {
  return (
    typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false
  );
}

function settingsPanel(app: App, opts: PanelOptions): Panel {
  const s = app.settings;
  const pct = (v: number): string => t('settings.percent', { value: v });

  // ── Celá obrazovka (Fullscreen API; stav se nesyncuje do nastavení — prohlížeč ho po reloadu stejně zruší) ──
  const fsOk = fullscreenSupported();
  const fullscreen = toggleControl({
    id: 'settings-fullscreen',
    label: t('settings.fullscreen'),
    checked: Boolean(document.fullscreenElement),
    hint: fsOk ? t('settings.fullscreenHint') : t('settings.fullscreenUnsupported'),
    disabled: !fsOk,
    onChange: (on, input) => {
      const fail = (): void => {
        toast(t('settings.fullscreenFailed'), { kind: 'warning' });
        input.checked = Boolean(document.fullscreenElement);
      };
      try {
        if (on && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(fail);
        else if (!on && document.fullscreenElement) document.exitFullscreen().catch(fail);
      } catch {
        fail();
      }
    },
  });
  const syncFullscreen = (): void => {
    fullscreen.input.checked = Boolean(document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', syncFullscreen);

  // ── Import ──
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    'aria-label': t('settings.import.fileLabel'),
    'data-testid': 'settings-import-file',
    onChange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void importFile(file);
    },
  });

  const importFile = async (file: File): Promise<void> => {
    let plan: ImportPlan;
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        throw new ImportError('readFailed');
      }
      plan = parseImport(text, app.registry);
    } catch (e) {
      const code: ImportErrorCode = e instanceof ImportError ? e.code : 'invalidFormat';
      if (!(e instanceof ImportError)) console.error('[import] Neočekávaná chyba', e);
      toast(t(`settings.import.errors.${code}`), { kind: 'error', testId: 'toast-import-error' });
      return;
    }
    const hasData = app.store.get(STORAGE_KEYS.run) !== null || app.store.get(STORAGE_KEYS.profile) !== null;
    if (hasData) {
      const ok = await confirmModal({
        title: t('settings.import.confirmTitle'),
        message: t('settings.import.confirmMessage'),
        confirmLabel: t('settings.import.confirm'),
        danger: true,
        testId: 'import-confirm',
      });
      if (!ok) return;
    }
    applyImport(app, plan);
    toast(t('settings.import.done'), { kind: 'success', testId: 'toast-import-done' });
    opts.onImport();
  };

  // ── Reset (dvojí potvrzení) ──
  const reset = async (): Promise<void> => {
    const first = await confirmModal({
      title: t('settings.reset.confirm1Title'),
      message: t('settings.reset.confirm1Message'),
      confirmLabel: t('settings.reset.confirm1'),
      danger: true,
      testId: 'reset-confirm-1',
    });
    if (!first) return;
    const second = await confirmModal({
      title: t('settings.reset.confirm2Title'),
      message: t('settings.reset.confirm2Message'),
      confirmLabel: t('settings.reset.confirm2'),
      danger: true,
      testId: 'reset-confirm-2',
    });
    if (!second) return;
    resetProfile(app);
    toast(t('settings.reset.done'), { kind: 'success', testId: 'toast-reset-done' });
    opts.onReset();
  };

  const left = h(
    'div',
    { class: 'settings__column' },
    section(
      'settings-sec-sound',
      t('settings.sections.sound'),
      rangeControl({
        id: 'settings-sfx',
        label: t('settings.sfxVolume'),
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.sfxVolume * 100),
        format: pct,
        onInput: (v) => app.updateSettings({ sfxVolume: v / 100 }),
      }),
      rangeControl({
        id: 'settings-music',
        label: t('settings.musicVolume'),
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.musicVolume * 100),
        format: pct,
        onInput: (v) => app.updateSettings({ musicVolume: v / 100 }),
        hint: t('settings.volumeHint'),
      }),
    ),
    section(
      'settings-sec-game',
      t('settings.sections.game'),
      speedControl(app),
      toggleControl({
        id: 'settings-animations',
        label: t('settings.animations'),
        checked: s.animations,
        hint: t('settings.animationsHint'),
        onChange: (on) => app.updateSettings({ animations: on }),
      }).el,
      toggleControl({
        id: 'settings-shake',
        label: t('settings.screenShake'),
        checked: s.screenShake,
        hint: t('settings.screenShakeHint'),
        onChange: (on) => app.updateSettings({ screenShake: on }),
      }).el,
      toggleControl({
        id: 'settings-tutorial',
        label: t('settings.tutorial'),
        checked: s.tutorial,
        hint: t('settings.tutorialHint'),
        onChange: (on) => app.updateSettings({ tutorial: on }),
      }).el,
    ),
    section(
      'settings-sec-display',
      t('settings.sections.display'),
      fullscreen.el,
      toggleControl({
        id: 'settings-colorblind',
        label: t('settings.colorblind'),
        checked: s.colorblind,
        hint: t('settings.colorblindHint'),
        onChange: (on) => app.updateSettings({ colorblind: on }),
      }).el,
      rangeControl({
        id: 'settings-ui-scale',
        label: t('settings.uiScale'),
        min: 80,
        max: 140,
        step: 10,
        value: Math.round(s.uiScale * 100),
        format: pct,
        onInput: (v) => app.updateSettings({ uiScale: v / 100 }),
      }),
    ),
  );

  const right = h(
    'div',
    { class: 'settings__column' },
    section('settings-sec-keys', t('settings.sections.keys'), keysTable()),
    section(
      'settings-sec-save',
      t('settings.sections.save'),
      h(
        'div',
        { class: 'setting setting--action' },
        button({
          label: t('settings.export.label'),
          variant: 'paper',
          testId: 'settings-export',
          describedBy: 'settings-export-hint',
          onClick: () => {
            downloadExport(app);
            toast(t('settings.export.done'), { kind: 'success' });
          },
        }),
        h('p', { id: 'settings-export-hint', class: 'setting__hint' }, t('settings.export.hint')),
      ),
      h(
        'div',
        { class: 'setting setting--action' },
        button({
          label: t('settings.import.label'),
          variant: 'paper',
          testId: 'settings-import',
          describedBy: 'settings-import-hint',
          onClick: () => fileInput.click(),
        }),
        fileInput,
        h('p', { id: 'settings-import-hint', class: 'setting__hint' }, t('settings.import.hint')),
      ),
      h(
        'div',
        { class: 'setting setting--action' },
        button({
          label: t('settings.reset.label'),
          variant: 'danger',
          testId: 'settings-reset',
          describedBy: 'settings-reset-hint',
          onClick: () => void reset(),
        }),
        h('p', { id: 'settings-reset-hint', class: 'setting__hint' }, t('settings.reset.hint')),
      ),
    ),
  );

  return {
    el: h('div', { class: 'settings__panel', 'data-testid': 'settings-panel' }, left, right),
    dispose: () => document.removeEventListener('fullscreenchange', syncFullscreen),
  };
}

// ─────────────────────────── Obrazovka a dialog ───────────────────────────

export const settingsScreen: ScreenFactory = (app) => {
  const panel = settingsPanel(app, {
    // Data se změnila — překresli obrazovku s novými hodnotami.
    onReset: () => app.go('settings'),
    onImport: () => app.go('settings'),
  });
  const el = h(
    'main',
    { class: 'screen settings', 'aria-labelledby': 'settings-title' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'settings-title', class: 'screen-title' }, t('settings.title')),
        h('p', { class: 'screen-subtitle' }, t('settings.subtitle')),
      ),
    ),
    panel.el,
  );
  // Router klávesy z <input> obrazovce nepředává (kvůli psaní) — přepínače a posuvníky ale Esc pustit mají.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target instanceof HTMLInputElement && e.target.type !== 'text') {
      e.preventDefault();
      app.go('menu');
    }
  });
  return {
    el,
    onKey(e) {
      if (e.key === 'Escape') {
        app.go('menu');
        return true;
      }
      return false;
    },
    dispose: () => panel.dispose(),
  };
};

/**
 * Nastavení jako dialog (ze hry). Po resetu nebo importu se dialog zavře a hra přejde do menu
 * (rozehraný run se změnil nebo zmizel). Vrací handle dialogu (`closed` se vyřeší po zavření).
 */
export function openSettingsModal(app: App): ModalHandle<void> {
  let panel: Panel | null = null;
  return openModal<void>({
    title: t('settings.title'),
    size: 'large',
    className: 'modal--settings',
    testId: 'settings-modal',
    // Focus na zavírací křížek — šipky by jinak hned posouvaly první posuvník.
    initialFocus: '.modal__close',
    body: (close) => {
      const leave = (): void => {
        close();
        app.go('menu');
      };
      panel = settingsPanel(app, { onReset: leave, onImport: leave });
      return panel.el;
    },
    onClose: () => panel?.dispose(),
  });
}
