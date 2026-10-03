/**
 * Společné typy a pomocníci herní obrazovky: kontext (aplikace, controller, akce s ohlášením chyby),
 * dostupnost nákupu, sloty, číslo kola, kopírování do schránky a návrat focusu po překreslení panelu.
 */
import type { Action, ContentRegistry, EditionId, RunState } from '../../../engine';
import { t } from '../../../i18n/cs';
import type { App } from '../../app';
import { sound } from '../../audio/hooks';
import { toast } from '../../components/toast';
import type { GameController } from '../../controller';
import { h } from '../../dom';

export interface GameCtx {
  readonly app: App;
  readonly controller: GameController;
  readonly registry: ContentRegistry;
  /** Akce přes controller; neplatnou akci oznámí hráči. Během animace nedělá nic. Vrací true při úspěchu. */
  act(action: Action): Promise<boolean>;
  /** Zahraje / zahodí vybrané karty. */
  play(): Promise<boolean>;
  discard(): Promise<boolean>;
  /** Překreslí obrazovku podle stavu. */
  render(): void;
}

/** Vytvoří kontext s akcemi nad controllerem. */
export function createGameCtx(app: App, controller: GameController, render: () => void): GameCtx {
  const report = (res: { ok: boolean; error?: string }): boolean => {
    if (res.ok) return true;
    sound('error');
    if (res.error) toast(t(`errors.${res.error}`), { kind: 'warning', testId: 'toast-action-error' });
    return false;
  };
  return {
    app,
    controller,
    registry: controller.registry,
    render,
    async act(action) {
      if (controller.busy) return false;
      return report(await controller.act(action));
    },
    async play() {
      if (controller.busy || controller.selected.length === 0) return false;
      return report(await controller.play());
    },
    async discard() {
      if (controller.busy || controller.selected.length === 0) return false;
      return report(await controller.discard());
    },
  };
}

/** Má hráč na cenu (včetně dluhového limitu)? */
export function canAfford(ctx: GameCtx, price: number): boolean {
  const s = ctx.controller.state;
  return price <= 0 || s.money - price >= -ctx.controller.engine.modifiers().debtLimit;
}

/** Počet slotů žolíků (vč. negativních edicí ve slotech). */
export function jokerSlots(ctx: GameCtx): number {
  return ctx.controller.engine.modifiers().jokerSlots;
}

export function consumableSlots(ctx: GameCtx): number {
  return ctx.controller.engine.modifiers().consumableSlots;
}

function extraSlots(ctx: GameCtx, edition: EditionId | null): number {
  return edition ? (ctx.registry.editions[edition]?.extraSlots ?? 0) : 0;
}

/** Vejde se žolík s danou edicí (negativní si slot přinese)? */
export function hasJokerRoom(ctx: GameCtx, edition: EditionId | null): boolean {
  return ctx.controller.state.jokers.length < jokerSlots(ctx) + extraSlots(ctx, edition);
}

export function hasConsumableRoom(ctx: GameCtx, edition: EditionId | null): boolean {
  return ctx.controller.state.consumables.length < consumableSlots(ctx) + extraSlots(ctx, edition);
}

/** Číslo kola pro levý panel: rozehrané nebo příští kolo (vyhraná kola + 1), po výhře kola počet vyhraných. */
export function roundNumber(s: Readonly<RunState>): number {
  const won = s.stats.roundsWon;
  if (s.phase === 'round' || s.phase === 'game_over' || s.phase === 'blind_select') return won + 1;
  if (s.phase === 'booster' && s.booster?.returnTo === 'blind_select') return won + 1;
  return Math.max(1, won);
}

/** Řádek statistiky (dl → div > dt + dd). */
export function statRow(label: string, value: string, testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'game-stat' },
    h('dt', { class: 'game-stat__label' }, label),
    h('dd', { class: 'game-stat__value', 'data-testid': testId }, value),
  );
}

/** Zkopíruje text do schránky (Clipboard API, záložně přes skryté textové pole). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Zkusíme záložní cestu níž (nezabezpečený kontext, zakázaná schránka).
  }
  try {
    const area = h('textarea', {
      class: 'visually-hidden',
      readonly: true,
      'aria-hidden': 'true',
      tabindex: '-1',
    });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    // execCommand je zastaralý, ale jako záloha pro starší prohlížeče a http:// stačí.
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Zkopíruje seed a oznámí výsledek. */
export async function copySeed(seed: string): Promise<void> {
  const ok = await copyText(seed);
  toast(ok ? t('game.gameOver.copied') : t('game.gameOver.copyFailed', { seed }), {
    kind: ok ? 'success' : 'warning',
    testId: 'toast-seed',
  });
}

/** Klíč pro návrat focusu po překreslení panelu (tlačítka nesou `data-focus-key`). */
export function focusKey(): string | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? (el.dataset.focusKey ?? null) : null;
}

/**
 * Po překreslení panelu vrátí focus na „stejné“ tlačítko (podle `data-focus-key`), nebo — když focus
 * zůstal viset na odebraném prvku / na <body> — na výchozí tlačítko panelu (`data-autofocus`).
 */
export function restoreFocus(container: HTMLElement, key: string | null, wasInside: boolean): void {
  const active = document.activeElement;
  const lost = !active || active === document.body || !active.isConnected;
  if (!lost && !wasInside) return;
  const byKey = key
    ? container.querySelector<HTMLElement>(`[data-focus-key="${key.replace(/["\\]/g, '')}"]`)
    : null;
  const target =
    (byKey && !(byKey as HTMLButtonElement).disabled ? byKey : null) ??
    container.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)');
  if (target && (lost || wasInside)) target.focus({ preventScroll: true });
}

/**
 * Proč tlačítka slotu nejdou (Koupit, Otevřít, Vzít, Použít…): krátký řádek pod nimi, vidět i bez hoveru (dotyk).
 * Bere jen opravdu neaktivní tlačítka (`disabled`) s důvodem v `title`; bez důvodu null.
 */
export function blockReasonsLine(buttons: readonly HTMLElement[]): HTMLElement | null {
  const reasons = [
    ...new Set(
      buttons
        .filter((b): b is HTMLButtonElement => b instanceof HTMLButtonElement && b.disabled && !!b.title)
        .map((b) => b.title),
    ),
  ];
  return reasons.length > 0
    ? h('p', { class: 'offer-why', 'data-testid': 'offer-why' }, reasons.join(' '))
    : null;
}

/**
 * Karty zboží a možností obálky otevírají detail (dialog), nevybírají se: místo `aria-pressed` (přepínač výběru)
 * dostanou `aria-haspopup="dialog"`.
 */
export function markDetailTriggers(root: HTMLElement, selector: string): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`${selector} button`))) {
    el.removeAttribute('aria-pressed');
    el.setAttribute('aria-haspopup', 'dialog');
  }
}
