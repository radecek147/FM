/**
 * Zapojení zvuku do aplikace (DESIGN 13.6). `installAudio(app)` v src/main.ts vytvoří engine, efekty a hudbu
 * a připojí je:
 *
 * - **gesto hráče** → vznikne / probudí se `AudioContext` (autoplay politika — nikdy dřív),
 * - **nastavení** (`app.onSettingsChange`) → hlasitosti živě, hudba se zastaví na 0 % / při ztlumení,
 * - **obrazovky** (`app.onScreenChange`) → nálada hudby: hra = polka, jinde valčík; připojí controller runu,
 * - **controller** → výběr / zrušení výběru karty (rozdíl `selected`), šéf v kole = tempo +15 %,
 * - **tlačítka** → delegovaný „klik“ na dokumentu; když akce tlačítka zazní sama (koupě = pokladna, Zahrát =
 *   karty na stůl), klik se vynechá (žádné zdvojení). `data-sfx="none"` klik vypne,
 * - **klávesa M** → ztlumit / pustit všechno (všude kromě psaní do textového pole).
 *
 * Presenter (src/ui/present.ts) volá `soundForEvent` na začátku přehrání každé události a `soundScoreStep` za
 * každý krok skórování — zvuk tak sedí na animaci. Bez nainstalovaného zvuku (testy, `#gallery`) jsou všechny
 * funkce no-op.
 */
import type { GameEvent, RunState, ScoreStep } from '../../engine';
import { t } from '../../i18n/cs';
import type { App, ScreenId } from '../app';
import { toast } from '../components/toast';
import type { GameController } from '../controller';
import type { ContextFactory } from './engine';
import { AudioEngine } from './engine';
import type { MusicMood, MusicPlayerOptions } from './music';
import { MusicPlayer } from './music';
import type { PlayOptions, SoundName } from './sfx';
import { SfxPlayer } from './sfx';

/** Co zvuk potřebuje od aplikace (testy podstrčí jednodušší objekt). */
export type AudioHost = Pick<App, 'settings' | 'updateSettings' | 'onScreenChange' | 'onSettingsChange'> & {
  readonly controller: GameController | null;
};

/** Část AnimQueue, podle které se ladí zvuky presenteru (přeskočení, rychlost). */
export interface AnimTiming {
  readonly instant: boolean;
  duration(ms: number): number;
}

export interface AudioService {
  readonly engine: AudioEngine;
  readonly sfx: SfxPlayer;
  readonly music: MusicPlayer;
  /** Ztlumí / pustí všechno (klávesa M, přepínač v nastavení) a ohlásí to. Vrací nový stav (true = ticho). */
  toggleMute(): boolean;
  dispose(): void;
}

export interface InstallAudioOptions {
  createContext?: ContextFactory;
  canStart?: () => boolean;
  /** Dokument pro posluchače (gesta, viditelnost, kliky, M) — null = žádné posluchače (testy v Node). */
  doc?: Document | null;
  music?: MusicPlayerOptions;
  /** Odložení „kliku“ za akci tlačítka (výchozí setTimeout 0). */
  defer?: (fn: () => void) => void;
}

let service: AudioService | null = null;

/** Nainstalovaný zvuk, nebo null. */
export function audioService(): AudioService | null {
  return service;
}

/** Přehraje zvuk z banky — bezpečná no-op, když zvuk není nainstalovaný nebo je ztlumený. */
export function sound(name: SoundName, opts?: PlayOptions): void {
  service?.sfx.play(name, opts);
}

/** Nálada hudby pro obrazovku. */
export function moodForScreen(id: ScreenId | string): MusicMood {
  return id === 'game' ? 'game' : 'menu';
}

/** Je rozehrané kolo se šéfem? (hudba zrychlí) */
export function isBossRound(s: Readonly<RunState>): boolean {
  return s.phase === 'round' && s.round?.blind === 'boss';
}

// ─────────────────────────── Skórování ───────────────────────────

/** Pentatonika — „tik tik tik“ stoupá a pořád ladí. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** Nejvyšší stupeň (2 oktávy nad základem). */
const MAX_TICK_INDEX = 10;

/**
 * Výška „tiku“ (půltóny) podle průběžného multu: o stupeň pentatoniky za každých ~2/3 zdvojnásobení, strop dvě
 * oktávy. Mult 1 = základ, 2 = +2, 4 = +7, 16 = +14, 128+ = +24.
 */
export function tickPitch(mult: number): number {
  const m = Number.isFinite(mult) ? Math.max(1, mult) : 1;
  const idx = Math.max(0, Math.min(MAX_TICK_INDEX, Math.floor(Math.log2(m) * 1.5)));
  return Math.floor(idx / PENTATONIC.length) * 12 + PENTATONIC[idx % PENTATONIC.length]!;
}

/** Nejkratší rozestup „tiků“ (ms) — s rychlostí hry roste, takže při 4× je jich méně. */
export function tickGap(speed: number): number {
  const s = Number.isFinite(speed) ? Math.min(4, Math.max(1, speed)) : 1;
  return 25 * s;
}

/** Zvuk jednoho kroku skórování (presenter, `presentStep`). Při přeskočení / bez animací mlčí. */
export function soundScoreStep(step: ScoreStep, anim: AnimTiming): void {
  const s = service;
  if (!s || anim.instant) return;
  const pitch = tickPitch(step.multAfter);
  const gap = tickGap(currentSpeed());
  if (step.xmult) s.sfx.play('xmultTick', { pitch: Math.min(12, pitch) });
  else if (step.mult) s.sfx.play('multTick', { pitch, gap });
  else if (step.chips || step.source === 'hand') s.sfx.play('scoreTick', { pitch, gap });
  if (step.money) s.sfx.play(step.money > 0 ? 'coin' : 'pay');
  if (!step.chips && !step.mult && !step.xmult && !step.money && step.message && step.source !== 'hand')
    s.sfx.play(step.source === 'boss' ? 'error' : 'pop', { pitch: step.source === 'boss' ? 0 : 7 });
}

let speedSource: (() => number) | null = null;

function currentSpeed(): number {
  try {
    return speedSource?.() ?? 1;
  } catch {
    return 1;
  }
}

// ─────────────────────────── Události ───────────────────────────

/** Nejvíc „cvrnknutí“ při rozdání (zbytek by zněl jako déšť). */
const MAX_DEAL_FLICKS = 8;

/**
 * Zvuk události enginu — presenter ho volá na začátku přehrání události, takže sedí na animaci. Při přeskočení
 * (mezerník) nebo vypnutých animacích hrají jen důležité zvuky (peníze, výhra, prohra, šéf…).
 */
export function soundForEvent(e: GameEvent, anim: AnimTiming): void {
  const s = service;
  if (!s) return;
  const play = (name: SoundName, o?: PlayOptions): void => {
    s.sfx.play(name, o);
  };
  const quiet = anim.instant;
  switch (e.type) {
    case 'blindSelected':
      if (e.bossId) play('bossArrive');
      return;
    case 'blindSkipped':
    case 'boosterPicked':
      play('pop');
      return;
    case 'bossRerolled':
    case 'handShuffled':
    case 'shopRerolled':
      play('shuffle');
      return;
    case 'cardsDrawn': {
      const count = Math.min(MAX_DEAL_FLICKS, e.cardIds.length);
      if (count === 0) return;
      if (quiet) {
        play('deal');
        return;
      }
      // Stejný rozestup jako přílet karet z balíčku (presentDraw: 60 ms na kartu).
      for (let i = 0; i < count; i++) play('deal', { delay: anim.duration(i * 60) / 1000, gap: 0 });
      return;
    }
    case 'handPlayed':
      play('playHand');
      return;
    case 'cardsDiscarded':
      play('discard');
      return;
    case 'cardDestroyed':
      // Sklo rozbité skórováním zazní v presentHand přesně se střepy; tady jen zničení efektem.
      if (e.reason !== 'score') play('glassBreak');
      return;
    case 'jokerDestroyed':
      play('glassBreak', { pitch: -5 });
      return;
    case 'roundWon':
      play('roundWin');
      return;
    case 'moneyChanged':
      // Peníze ze skórování ozvučí krok, prodej má vlastní zvuk.
      if (e.reason === 'score' || e.reason === 'sell' || e.delta === 0) return;
      play(e.delta > 0 ? 'coin' : 'pay');
      return;
    case 'jokerSold':
    case 'consumableSold':
      play('sell');
      return;
    case 'jokerTriggered':
      if (!quiet) play('pop', { pitch: 5 });
      return;
    case 'boosterOpened':
      play('boosterOpen');
      return;
    case 'voucherRedeemed':
      play('voucherBuy');
      return;
    case 'consumableUsed':
    case 'tagTriggered':
      play('use');
      return;
    case 'handLeveled':
      play('levelUp', { pitch: Math.min(7, Math.max(0, e.level - 2)) });
      return;
    case 'handDiscovered':
      play('achievement');
      return;
    case 'gameOver':
      play('gameOver');
      s.music.stinger('gameOver');
      return;
    case 'victory':
      play('victory');
      s.music.stinger('victory');
      return;
    case 'endlessStarted':
      s.music.resume();
      return;
    default:
      return;
  }
}

// ─────────────────────────── Instalace ───────────────────────────

/** Prvky, na které se hraje „klik“ (karty v ruce mají vlastní zvuk výběru, posuvník zkušební tón). */
const CLICKABLE =
  'button, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], a[href], summary, input[type="checkbox"], input[type="radio"]';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
}

/** Klávesa M (i na české klávesnici; ne se zkratkami prohlížeče). */
export function isMuteKey(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'metaKey'>,
): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return e.code === 'KeyM' || e.key === 'm' || e.key === 'M';
}

/**
 * Nainstaluje zvuk do aplikace (jednou; další volání předchozí instalaci nahradí). Vrací službu (testy).
 */
export function installAudio(app: AudioHost, opts: InstallAudioOptions = {}): AudioService {
  service?.dispose();
  const doc = opts.doc !== undefined ? opts.doc : typeof document === 'undefined' ? null : document;
  const engine = new AudioEngine({
    levels: () => app.settings,
    createContext: opts.createContext,
    canStart: opts.canStart,
  });
  const sfx = new SfxPlayer(engine);
  const music = new MusicPlayer(engine, opts.music);
  const defer = opts.defer ?? ((fn: () => void) => void setTimeout(fn, 0));
  const disposers: (() => void)[] = [];
  speedSource = () => app.settings.speed;

  engine.onReady(() => music.sync());
  engine.installGestureUnlock(doc);
  engine.installVisibility(doc);

  disposers.push(
    app.onSettingsChange(() => {
      engine.syncVolumes();
      music.sync();
    }),
  );

  // Controller runu: výběr karet a šéf v kole.
  let detachController: () => void = () => undefined;
  const attach = (c: GameController | null): void => {
    detachController();
    detachController = () => undefined;
    if (!c) {
      music.setBoss(false);
      return;
    }
    let prev = [...c.selected];
    // Po akci (zahrání, zahození, nákup…) se výběr mění kvůli akci, ne kliknutím — bez zvuku výběru.
    let afterAction = false;
    const offEvents = c.onEvents(() => {
      afterAction = true;
    });
    const offNotify = c.subscribe(() => {
      const now = c.selected;
      if (!afterAction && !c.busy) {
        const added = now.filter((id) => !prev.includes(id)).length;
        const removed = prev.filter((id) => !now.includes(id)).length;
        // Výška výběru stoupá s počtem vybraných karet (1. karta = základ, 5. = o kvintu výš).
        if (added === 1 && removed === 0)
          sfx.play('cardSelect', { pitch: [0, 2, 4, 5, 7, 9][now.length - 1] ?? 9 });
        else if (removed === 1 && added === 0) sfx.play('cardDeselect');
      }
      afterAction = false;
      prev = [...now];
      music.setBoss(isBossRound(c.state));
    });
    music.setBoss(isBossRound(c.state));
    detachController = () => {
      offEvents();
      offNotify();
    };
  };
  disposers.push(() => detachController());

  disposers.push(
    app.onScreenChange((id) => {
      music.setMood(moodForScreen(id));
      attach(id === 'game' ? app.controller : null);
    }),
  );

  const toggleMute = (): boolean => {
    const muted = !app.settings.muted;
    app.updateSettings({ muted });
    toast(t(muted ? 'settings.muteOn' : 'settings.muteOff'), { kind: 'info', testId: 'toast-mute' });
    if (!muted) sfx.play('click');
    return muted;
  };

  if (doc) {
    // Klik na tlačítko: zachytávací fáze si zapamatuje počet zvuků před akcí; když akce sama nezazní, ozve se klik.
    const onClick = (e: Event): void => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest(CLICKABLE);
      if (!el || el.closest('[data-sfx="none"]') || el.classList.contains('pcard')) return;
      const before = sfx.playCount;
      defer(() => {
        if (sfx.playCount === before) sfx.play('click');
      });
    };
    doc.addEventListener('click', onClick, true);
    disposers.push(() => doc.removeEventListener('click', onClick, true));

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !isMuteKey(e) || isTextEntry(e.target)) return;
      e.preventDefault();
      toggleMute();
    };
    doc.addEventListener('keydown', onKey);
    disposers.push(() => doc.removeEventListener('keydown', onKey));
  }

  const svc: AudioService = {
    engine,
    sfx,
    music,
    toggleMute,
    dispose() {
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {
          // Úklid nesmí shodit zbytek.
        }
      }
      music.dispose();
      engine.dispose();
      if (service === svc) {
        service = null;
        speedSource = null;
      }
    },
  };
  service = svc;
  return svc;
}
