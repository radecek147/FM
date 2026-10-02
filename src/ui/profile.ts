/**
 * ProfileController — profil hráče za běhu aplikace (DESIGN 11, ARCHITECTURE 5.1).
 *
 *  - načte `karban.profile` a nikdy ho neztratí: poškozená data zazálohuje do `karban.profile.backup.<ms>`
 *    (`restoreStoredProfile` v settings.ts), založí nový profil a hráči to oznámí; když zálohu nejde zapsat,
 *    jede s profilem jen v paměti a uložená data nepřepíše,
 *  - drží jedinou instanci profilu (meta funkce ji mutují) a ukládá ji po každé změně,
 *  - zakládá a obnovuje runy (`newRun` s `unlockedPool` podle druhu runu, `resume`, `attach`) a jako pozorovatel
 *    `GameController` předává události meta vrstvě (`applyRunEvents`); prohru uzavře hned (`finishRun`),
 *    výhru po odchodu z výherní obrazovky (`finish`),
 *  - oznámení (`MetaNotice`) ukáže jako toasty „Odemčeno: …“ / „Achievement: …“ — až doběhnou animace akce,
 *  - nastavení čte a zapisuje přes profil (`updateSettings`).
 */
import type { ContentRegistry, GameEvent } from '../engine';
import type { SaveErrorCode } from '../engine/save/save';
import type { CollectionCategory, MetaCtx, MetaNotice, PoolMode, Profile, Settings } from '../engine/meta';
import {
  applyRunEvents,
  createProfile,
  currentMatches,
  finishRun,
  markSeen,
  refreshMeta,
  resumeRun,
  sanitizeSettings,
  startRun,
  unlockedPoolFor,
} from '../engine/meta';
import { t } from '../i18n/cs';
import { toast } from './components/toast';
import type { ControllerDeps, RunObserver } from './controller';
import { GameController } from './controller';
import { noticeText } from './metaText';
import { restoreStoredProfile, saveStoredProfile } from './settings';
import type { KeyValueStore } from './storage';

/** Nejvíc oznámení naráz — zbytek shrne jedno „…a další novinky“. */
export const MAX_NOTICE_TOASTS = 3;

/** Problém s úložištěm profilu (oznámí se hráči). */
export type ProfileProblem =
  | { kind: 'corrupt'; backupKey: string; error?: SaveErrorCode }
  | { kind: 'corruptUnsaved'; error?: SaveErrorCode }
  | { kind: 'saveFailed' };

export interface ProfileControllerOptions {
  /** Hodiny (testy dodají pevný čas). Engine je nečte — čas jde do meta funkcí jako `nowIso`. */
  now?: () => Date;
  /** Oznámení odemčení a achievementů (výchozí: toasty). */
  notify?: (notices: readonly MetaNotice[]) => void;
  /** Problém s úložištěm (výchozí: toast). */
  onProblem?: (problem: ProfileProblem) => void;
}

/** Nový run z nabídky (nová hra, výzva, denní run). */
export interface NewRunRequest {
  deckId: string;
  stake: number;
  seed: string;
  /**
   * Seed zadal hráč (pole seedu, historie, ručně zadaný `DEN-…`): run jde jen do historie, ne do odemykání,
   * statistik ani achievementů (DESIGN 11.6) a hraje se s celým obsahem.
   */
  seeded?: boolean;
  challengeId?: string | null;
  daily?: boolean;
}

/** Druh poolu obsahu pro nový run (DESIGN 11.3, 11.6, 11.7). */
export function poolModeFor(req: Pick<NewRunRequest, 'seeded' | 'challengeId' | 'daily'>): PoolMode {
  if (req.daily) return 'daily';
  if (req.seeded) return 'seeded';
  if (req.challengeId) return 'challenge';
  return 'normal';
}

/** Výchozí oznámení: jeden toast na novinku, nejvýš `MAX_NOTICE_TOASTS` (poslední shrne zbytek). */
export function showMetaNotices(notices: readonly MetaNotice[], registry: ContentRegistry): void {
  if (notices.length === 0) return;
  const overflow = notices.length > MAX_NOTICE_TOASTS;
  const shown = overflow ? notices.slice(0, MAX_NOTICE_TOASTS - 1) : notices;
  for (const n of shown) {
    toast(noticeText(n, registry), {
      kind: 'success',
      testId: n.kind === 'achievement' ? 'toast-achievement' : 'toast-unlock',
      className: `toast--meta toast--${n.kind}`,
    });
  }
  if (overflow) {
    toast(t('meta.notice.more', { n: notices.length - shown.length }), {
      kind: 'success',
      testId: 'toast-meta-more',
      className: 'toast--meta',
    });
  }
}

/** Výchozí hlášení problému s profilem (toast). */
export function showProfileProblem(problem: ProfileProblem): void {
  switch (problem.kind) {
    case 'corrupt':
      toast(t('meta.profile.corrupt'), {
        kind: 'warning',
        title: t('meta.profile.corruptTitle'),
        duration: 12_000,
        testId: 'toast-profile-corrupt',
      });
      break;
    case 'corruptUnsaved':
      toast(t('meta.profile.corruptUnsaved'), { kind: 'error', duration: 0, testId: 'toast-profile-corrupt' });
      break;
    case 'saveFailed':
      toast(t('meta.profile.saveFailed'), { kind: 'warning', testId: 'toast-profile-save' });
      break;
  }
}

export class ProfileController implements RunObserver {
  private current: Profile;
  /** Smí profil přepsat uložená data (false = poškozený profil bez zálohy, hraje se jen v paměti). */
  private writable = true;
  private saveFailedReported = false;
  /** Oznámení akce čekající na doběhnutí animací. */
  private pending: MetaNotice[] = [];
  private readonly now: () => Date;
  private readonly notifyFn: (notices: readonly MetaNotice[]) => void;
  private readonly problemFn: (problem: ProfileProblem) => void;
  /** Výsledek posledního načtení z úložiště. */
  loadStatus: 'loaded' | 'created' | 'legacy' | 'corrupt' = 'created';
  /** Klíč zálohy poškozeného profilu z posledního načtení, nebo null. */
  backupKey: string | null = null;

  constructor(
    private readonly store: KeyValueStore,
    readonly registry: ContentRegistry,
    opts: ProfileControllerOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.notifyFn = opts.notify ?? ((notices) => showMetaNotices(notices, registry));
    this.problemFn = opts.onProblem ?? showProfileProblem;
    this.current = this.load();
  }

  /** Profil (jediná instance; meta funkce ji mutují — po změně zavolej `save`). */
  get profile(): Profile {
    return this.current;
  }

  get settings(): Settings {
    return this.current.settings;
  }

  /** Ukládá se profil do úložiště? (false = poškozený profil bez zálohy) */
  get persistent(): boolean {
    return this.writable;
  }

  /** Kontext meta funkcí: registr, aktuální čas, modifikátory rozehraného runu. */
  metaCtx(controller?: GameController | null): MetaCtx {
    const ctx: MetaCtx = { registry: this.registry, nowIso: this.now().toISOString() };
    if (controller) ctx.mods = () => controller.engine.modifiers();
    return ctx;
  }

  // ─────────────────────────── Úložiště ───────────────────────────

  private load(): Profile {
    const res = restoreStoredProfile(this.store, this.now());
    this.writable = res.writable;
    this.loadStatus = res.status;
    this.backupKey = res.backupKey;
    this.saveFailedReported = false;
    if (res.status === 'corrupt') {
      const error = res.error ? { error: res.error } : {};
      this.problemFn(
        res.backupKey
          ? { kind: 'corrupt', backupKey: res.backupKey, ...error }
          : { kind: 'corruptUnsaved', ...error },
      );
    }
    return res.profile;
  }

  /** Uloží profil. Vrací false, když se uložit nepodařilo (nebo nesmí — poškozený profil bez zálohy). */
  save(): boolean {
    if (!this.writable) return false;
    const ok = saveStoredProfile(this.store, this.current, this.now());
    if (!ok && !this.saveFailedReported) {
      this.saveFailedReported = true;
      this.problemFn({ kind: 'saveFailed' });
    }
    return ok;
  }

  /** Znovu načte profil z úložiště (po importu uložení) a přepočítá odemčení a achievementy. */
  reload(): void {
    this.pending = [];
    this.current = this.load();
    this.refresh();
  }

  /** Čistý profil (po resetu — úložiště už smazal volající) se zachovaným nastavením `settings`, je-li dané. */
  reset(settings?: Settings): void {
    this.pending = [];
    this.current = createProfile(this.now().toISOString(), settings);
    this.writable = true;
    this.saveFailedReported = false;
    this.loadStatus = 'created';
    this.backupKey = null;
    this.save();
  }

  /** Přepočet mimo run (start aplikace, import): odemčení a achievementy jen ze stavu profilu. */
  refresh(): MetaNotice[] {
    const notices = refreshMeta(this.current, this.metaCtx());
    this.save();
    this.notifyFn(notices);
    return notices;
  }

  // ─────────────────────────── Nastavení a sbírka ───────────────────────────

  /** Změní nastavení v profilu a uloží ho. Vrací nové nastavení. */
  updateSettings(patch: Partial<Settings>): Settings {
    this.current.settings = sanitizeSettings({ ...this.current.settings, ...patch });
    this.save();
    return this.current.settings;
  }

  /** Sundá položkám štítek „Nové“ (sbírka). Uloží jen při změně. */
  markSeen(category: CollectionCategory, ids: readonly string[]): void {
    const before = this.current.unseen.length;
    markSeen(this.current, category, ids);
    if (this.current.unseen.length !== before) this.save();
  }

  // ─────────────────────────── Runy ───────────────────────────

  /**
   * Založí nový run (pool obsahu podle druhu runu z profilu), zapíše jeho začátek do profilu (předchozí neuzavřený
   * run se uzavře jako opuštěný) a vrátí controller, jehož události profil sleduje.
   */
  newRun(req: NewRunRequest, deps: Pick<ControllerDeps, 'present'> = {}): GameController {
    const seeded = req.seeded === true;
    const controller = GameController.newRun(
      {
        deckId: req.deckId,
        stake: req.stake,
        seed: req.seed,
        challengeId: req.challengeId ?? null,
        daily: req.daily === true,
        unlockedPool: unlockedPoolFor(this.current, this.registry, poolModeFor(req)),
      },
      { registry: this.registry, store: this.store, observer: this, ...deps },
    );
    const notices = startRun(this.current, controller.state, { ...this.metaCtx(controller), seeded });
    this.save();
    this.notifyFn(notices);
    return controller;
  }

  /** Obnoví rozehraný run z úložiště a připojí ho k profilu, nebo vrátí null. */
  resume(deps: Pick<ControllerDeps, 'present'> = {}): GameController | null {
    const controller = GameController.resume({ registry: this.registry, store: this.store, ...deps });
    if (!controller) return null;
    this.attach(controller);
    return controller;
  }

  /**
   * Připojí controller k profilu: sleduje jeho události, a nepatří-li run k rozehranému runu v profilu (import,
   * ztracený zápis), zaeviduje ho (`resumeRun`). Dohraný run (pitva) se jen připojí.
   */
  attach(controller: GameController): void {
    controller.setObserver(this);
    const state = controller.state;
    if (state.phase === 'game_over' || currentMatches(this.current.current, state)) return;
    const notices = resumeRun(this.current, state, this.metaCtx(controller));
    this.save();
    this.notifyFn(notices);
  }

  /**
   * Konec runu: výhra po odchodu z výherní obrazovky, opuštění. Prohru uzavírá profil sám hned při `gameOver`.
   * Bez rozehraného runu v profilu nedělá nic.
   */
  finish(controller: GameController): void {
    if (!this.current.current) return;
    const notices = finishRun(this.current, controller.state, this.metaCtx(controller));
    this.save();
    this.notifyFn(notices);
  }

  /** RunObserver: události akce (stav enginu je po celé akci). */
  onEvents(events: readonly GameEvent[], controller: GameController): void {
    const ctx = this.metaCtx(controller);
    const state = controller.state;
    const notices = applyRunEvents(this.current, events, state, ctx);
    // Po prohře se run neukládá (pokračovat nejde) — do historie hned, ne až z pitvy.
    if (state.phase === 'game_over' && this.current.current) notices.push(...finishRun(this.current, state, ctx));
    this.save();
    this.pending.push(...notices);
  }

  /** RunObserver: animace akce doběhly — teď je čas na oznámení. */
  onSettled(): void {
    if (this.pending.length === 0) return;
    const notices = this.pending;
    this.pending = [];
    this.notifyFn(notices);
  }
}
