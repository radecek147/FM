/**
 * Nová hra: výběr balíčku (odemčené z profilu, zamčené jako silueta s podmínkou a průběhem), síly piva
 * (odemčené pro zvolený balíček, DESIGN 10) a seedu (`parseSeedInput`: chyby hned pod polem; zadaný seed =
 * seedovaný run mimo odemykání a statistiky, `DEN-RRRRMMDD` = denní run mimo soutěž s balíčkem a silou ze seedu).
 * Prázdné pole = náhodný seed (kryptograficky, `randomSeed`). Start přes `app.profiles.newRun` (pool obsahu
 * podle druhu runu, zápis do profilu) a přechod na hru.
 *
 * Ovládání klávesnicí: Tab mezi skupinami, šipky / Home / End uvnitř skupiny (radiogroup s roving tabindexem,
 * zamčené položky přeskakuje), Enter v poli seedu nebo na tlačítku spustí hru, Esc vrátí do menu.
 */
import type { ArtSpec, DeckDef, StakeDef } from '../../engine';
import type { SeedParseResult } from '../../engine/meta';
import {
  dailySetupFromSeed,
  isDeckUnlocked,
  isStakeUnlocked,
  maxStakeFor,
  parseSeedInput,
} from '../../engine/meta';
import { t } from '../../i18n/cs';
import type { App, ScreenFactory } from '../app';
import { artElement } from '../art/art';
import { iconElement, safeColor } from '../art/icons';
import { backButton, button, focusWhenMounted } from '../components/button';
import { confirmModal } from '../components/modal';
import { toast } from '../components/toast';
import { GameController } from '../controller';
import { h } from '../dom';
import { deckName, formatDateKey, stakeName, unlockConditionText, unlockInfo } from '../metaText';
import { randomSeed, seedErrorText } from '../seed';

/** Poslední volba balíčku a síly piva (pohodlí hráče; ztráta nevadí). */
const LAST_CHOICE_KEY = 'karban.newGame';
/** Delší než seed (8) i denní seed (12) — mezery se při zadání ignorují. */
const SEED_MAX_LENGTH = 24;

interface Choice {
  deckId: string;
  stake: number;
}

function loadChoice(app: App, decks: readonly DeckDef[]): Choice {
  const reg = app.registry;
  const first = decks.find((d) => isDeckUnlocked(app.profile, reg, d.id)) ?? decks[0];
  const fallback: Choice = { deckId: first?.id ?? 'pub', stake: 1 };
  const raw = app.store.get(LAST_CHOICE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<Choice>;
    const deckId =
      typeof parsed.deckId === 'string' && isDeckUnlocked(app.profile, reg, parsed.deckId)
        ? parsed.deckId
        : fallback.deckId;
    const stake =
      typeof parsed.stake === 'number' && isStakeUnlocked(app.profile, reg, deckId, parsed.stake)
        ? parsed.stake
        : 1;
    return { deckId, stake };
  } catch {
    return fallback;
  }
}

/** Seed z pole: bez mezer, velkými písmeny (jako `parseSeedInput`); prázdné = náhodný. */
export function normalizeSeed(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase().slice(0, SEED_MAX_LENGTH);
}

/** Co pole seedu znamená pro nový run. */
export type SeedChoice =
  | { kind: 'random' }
  | { kind: 'generated'; seed: string }
  | { kind: 'custom'; seed: string }
  | { kind: 'daily'; seed: string; dateKey: string }
  | { kind: 'error'; error: Exclude<SeedParseResult, { ok: true }>['error'] };

/**
 * Výklad pole seedu: prázdné = náhodný; beze změny vylosovaný „Náhodný“ = jako náhodný (nepočítá se jako zadaný);
 * jinak `parseSeedInput` (vlastní seed, denní seed, nebo chyba).
 */
export function interpretSeed(raw: string, generated: string | null): SeedChoice {
  const res = parseSeedInput(raw);
  if (!res.ok) return res.error === 'empty' ? { kind: 'random' } : { kind: 'error', error: res.error };
  if (res.kind === 'daily') return { kind: 'daily', seed: res.seed, dateKey: res.dateKey };
  if (generated !== null && res.seed === generated) return { kind: 'generated', seed: res.seed };
  return { kind: 'custom', seed: res.seed };
}

/** Balíček na suknu: rub karty v barvách balíčku (src/ui/art) na pozadí se vzorem balíčku — dekorativní. */
function deckStage(spec: ArtSpec, locked: boolean): HTMLElement {
  return h(
    'div',
    {
      class: ['deck-option__art', 'art-tile', `art-tile--${spec.pattern ?? 'none'}`],
      style: { '--art-accent': safeColor(spec.accent ?? spec.fg, '#e8a92a') },
      'aria-hidden': 'true',
    },
    artElement('deck', spec),
    locked ? iconElement('padlock', { className: 'deck-option__lock' }) : null,
  );
}

/**
 * Radiogroup s roving tabindexem: šipky/Home/End mění výběr (zamčené položky přeskočí), Tab opouští skupinu.
 * `items` jsou elementy s role="radio" v pořadí zobrazení.
 */
function wireRadioGroup(
  group: HTMLElement,
  items: HTMLElement[],
  onSelect: (index: number) => void,
  enabled: (index: number) => boolean,
): void {
  group.addEventListener('keydown', (e) => {
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx < 0) return;
    const open = items.map((_, i) => i).filter(enabled);
    if (open.length === 0) return;
    const pos = Math.max(0, open.indexOf(idx));
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = open[(pos + 1) % open.length] ?? -1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = open[(pos - 1 + open.length) % open.length] ?? -1;
    else if (e.key === 'Home') next = open[0] ?? -1;
    else if (e.key === 'End') next = open[open.length - 1] ?? -1;
    else if (e.key === ' ' || e.key === 'Enter') {
      // Mezerník/Enter na položce ji vybere (Enter nespouští hru, ať to nejde omylem).
      e.preventDefault();
      e.stopPropagation();
      if (enabled(idx)) onSelect(idx);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(next);
    items[next]?.focus();
  });
}

function setChecked(items: HTMLElement[], index: number): void {
  items.forEach((el, i) => {
    el.setAttribute('aria-checked', String(i === index));
    el.tabIndex = i === index ? 0 : -1;
    el.classList.toggle('is-selected', i === index);
  });
}

export const newGameScreen: ScreenFactory = (app) => {
  const reg = app.registry;
  const profile = app.profile;
  const decks = Object.values(reg.decks);
  const stakes = Object.values(reg.stakes).sort((a, b) => a.level - b.level);
  const choice = loadChoice(app, decks);
  const deckOpen = (deck: DeckDef): boolean => isDeckUnlocked(profile, reg, deck.id);
  const unlockedDecks = decks.filter(deckOpen).length;

  // ── Balíček ──
  const deckItems = decks.map((deck) => {
    const open = deckOpen(deck);
    const best = profile.stats.byDeck[deck.id]?.bestStake ?? 0;
    const info = open ? null : unlockInfo(profile, reg, 'decks', deck.id);
    const name = deckName(deck.id);
    return h(
      'div',
      {
        class: ['deck-option', open ? '' : 'is-locked'],
        role: 'radio',
        'aria-checked': 'false',
        'aria-disabled': open ? undefined : 'true',
        'aria-label': open ? undefined : t('newGame.deck.lockedLabel', { name }),
        'aria-labelledby': open ? `deck-name-${deck.id}` : undefined,
        'aria-describedby': `deck-desc-${deck.id}`,
        tabindex: '-1',
        'data-testid': `deck-${deck.id}`,
        'data-deck': deck.id,
        'data-locked': open ? undefined : 'true',
        onClick: () => {
          if (open) selectDeck(decks.indexOf(deck));
        },
      },
      deckStage(deck.art, !open),
      best > 0
        ? h(
            'span',
            {
              class: 'deck-option__coaster',
              title: t('newGame.deck.coasterLabel', { stake: stakeName(reg, best) }),
              'data-testid': `deck-coaster-${deck.id}`,
            },
            h('span', { 'aria-hidden': 'true' }, t('newGame.deck.coaster', { level: best })),
            h(
              'span',
              { class: 'visually-hidden' },
              t('newGame.deck.coasterLabel', { stake: stakeName(reg, best) }),
            ),
          )
        : null,
      h(
        'div',
        { class: 'deck-option__text' },
        h('h3', { id: `deck-name-${deck.id}`, class: 'deck-option__name' }, name),
        open
          ? h(
              'p',
              { id: `deck-desc-${deck.id}`, class: 'deck-option__desc' },
              t(`decks.${deck.id}.desc`, deck.params),
            )
          : h(
              'p',
              {
                id: `deck-desc-${deck.id}`,
                class: 'deck-option__condition',
                'data-testid': `deck-condition-${deck.id}`,
              },
              h('strong', { class: 'deck-option__locked' }, t('newGame.deck.locked')),
              ' ',
              t('newGame.deck.condition', { text: info?.text ?? '' }),
              info?.progressText ? ` ${t('newGame.deck.progress', { progress: info.progressText })}` : '',
            ),
        open ? h('p', { class: 'deck-option__flavor' }, t(`decks.${deck.id}.flavor`)) : null,
      ),
    );
  });
  const deckGroup = h(
    'div',
    { class: 'deck-grid', role: 'radiogroup', 'aria-labelledby': 'newgame-deck-title' },
    deckItems,
  );

  // ── Síla piva ──
  const stakeItems = stakes.map((stake) =>
    h(
      'div',
      {
        class: 'stake-option',
        role: 'radio',
        'aria-checked': 'false',
        tabindex: '-1',
        'data-testid': `stake-${stake.level}`,
        'data-stake': stake.level,
        onClick: () => {
          if (stakeOpen(stake)) selectStake(stakes.indexOf(stake));
        },
      },
      h(
        'span',
        { class: 'stake-option__coaster', 'aria-hidden': 'true' },
        t('newGame.stake.coaster', { level: stake.level }),
      ),
      h('span', { class: 'stake-option__name', 'aria-hidden': 'true' }, t(`stakes.${stake.id}.name`)),
    ),
  );
  const stakeGroup = h(
    'div',
    { class: 'stake-row', role: 'radiogroup', 'aria-labelledby': 'newgame-stake-title' },
    stakeItems,
  );
  const stakeOpen = (stake: StakeDef): boolean => isStakeUnlocked(profile, reg, choice.deckId, stake.level);

  const stakeHeading = h('h3', { class: 'stake-detail__name' });
  const stakeFlavor = h('p', { class: 'stake-detail__flavor' });
  const stakeArt = h('div', { class: 'stake-detail__art' });
  const stakeRules = h('ol', { class: 'stake-detail__rules', 'data-testid': 'stake-rules' });
  const stakeLockNote = h('p', { class: 'stake-detail__lock', 'data-testid': 'stake-lock-note' });
  const stakeDetail = h(
    'div',
    { class: 'stake-detail paper', 'aria-live': 'polite' },
    stakeArt,
    h(
      'div',
      { class: 'stake-detail__text' },
      stakeHeading,
      stakeFlavor,
      h('p', { class: 'stake-detail__rules-title' }, t('newGame.stake.rules')),
      stakeRules,
      stakeLockNote,
    ),
  );

  /** Zamčené síly piva pro zvolený balíček (podle profilu) + poznámka, co odemkne další. */
  const refreshStakeLocks = (): void => {
    const max = maxStakeFor(profile, reg, choice.deckId);
    stakes.forEach((stake, i) => {
      const el = stakeItems[i];
      if (!el) return;
      const open = stake.level <= max;
      const name = t(`stakes.${stake.id}.name`);
      el.classList.toggle('is-locked', !open);
      if (open) el.removeAttribute('aria-disabled');
      else el.setAttribute('aria-disabled', 'true');
      el.dataset.locked = open ? '' : 'true';
      el.setAttribute(
        'aria-label',
        open
          ? t('newGame.stake.optionLabel', { name, level: stake.level })
          : t('newGame.stake.lockedLabel', { name, level: stake.level }),
      );
    });
    const next = stakes.find((s) => s.level === max + 1);
    stakeLockNote.textContent = next
      ? t('newGame.stake.lockedHint', {
          deck: deckName(choice.deckId),
          condition: unlockConditionText({ type: 'winRun', deck: choice.deckId, stake: max }, reg),
        })
      : '';
    stakeLockNote.hidden = !next;
  };

  const selectStake = (index: number): void => {
    const stake = stakes[index];
    if (!stake || !stakeOpen(stake)) return;
    choice.stake = stake.level;
    setChecked(stakeItems, index);
    stakeHeading.textContent = t('newGame.stake.heading', {
      name: t(`stakes.${stake.id}.name`),
      level: stake.level,
    });
    stakeFlavor.textContent = t(`stakes.${stake.id}.flavor`);
    stakeArt.replaceChildren(artElement('stake', stake.art));
    // Ztížení se sčítají: úroveň N platí spolu se všemi nižšími.
    stakeRules.replaceChildren(
      ...stakes
        .filter((s) => s.level <= stake.level)
        .map((s) =>
          h(
            'li',
            { class: { 'stake-detail__rule': true, 'is-new': s.level === stake.level } },
            h('strong', { class: 'stake-detail__rule-name' }, t(`stakes.${s.id}.name`)),
            h('span', { class: 'stake-detail__rule-desc' }, t(`stakes.${s.id}.desc`, s.params)),
            s.level === stake.level && s.level > 1
              ? h('span', { class: 'stake-detail__new' }, t('newGame.stake.newRule'))
              : null,
          ),
        ),
    );
  };
  wireRadioGroup(stakeGroup, stakeItems, selectStake, (i) => {
    const s = stakes[i];
    return !!s && stakeOpen(s);
  });

  const selectDeck = (index: number): void => {
    const deck = decks[index];
    if (!deck || !deckOpen(deck)) return;
    choice.deckId = deck.id;
    setChecked(deckItems, index);
    refreshStakeLocks();
    // Síla piva nad odemčenou úrovní nového balíčku → nejvyšší odemčená.
    const max = maxStakeFor(profile, reg, deck.id);
    if (choice.stake > max) choice.stake = max;
    selectStake(
      Math.max(
        0,
        stakes.findIndex((s) => s.level === choice.stake),
      ),
    );
  };
  wireRadioGroup(deckGroup, deckItems, selectDeck, (i) => {
    const d = decks[i];
    return !!d && deckOpen(d);
  });

  // ── Seed ──
  /** Naposledy vylosovaný seed („Náhodný“) — beze změny se nepočítá jako zadaný hráčem. */
  let generated: string | null = null;
  const seedInput = h('input', {
    id: 'newgame-seed',
    class: 'seed-field__input',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    maxlength: String(SEED_MAX_LENGTH),
    placeholder: t('newGame.seed.placeholder'),
    'aria-describedby': 'newgame-seed-hint newgame-seed-status',
    'aria-invalid': 'false',
    'data-testid': 'seed-input',
    onInput: () => updateSeedStatus(),
  });
  const seedStatus = h('p', {
    id: 'newgame-seed-status',
    class: 'seed-field__status',
    'aria-live': 'polite',
    'data-testid': 'seed-status',
  });
  const randomBtn = button({
    label: t('newGame.seed.random'),
    ariaLabel: t('newGame.seed.randomLabel'),
    variant: 'ghost',
    testId: 'seed-random',
    onClick: () => {
      generated = randomSeed();
      seedInput.value = generated;
      updateSeedStatus();
      seedInput.focus();
    },
  });

  /** Stav pole seedu: chyba, poznámka o seedovaném / denním runu, nebo nic. */
  const updateSeedStatus = (): SeedChoice => {
    const sc = interpretSeed(seedInput.value, generated);
    seedStatus.className = 'seed-field__status';
    seedInput.setAttribute('aria-invalid', String(sc.kind === 'error'));
    if (sc.kind === 'error') {
      seedStatus.classList.add('is-error');
      seedStatus.dataset.state = 'error';
      seedStatus.textContent = seedErrorText(sc.error) ?? '';
    } else if (sc.kind === 'custom') {
      seedStatus.classList.add('is-note');
      seedStatus.dataset.state = 'seeded';
      seedStatus.textContent = t('newGame.seed.seededNote');
    } else if (sc.kind === 'daily') {
      const setup = dailySetupFromSeed(sc.seed, reg);
      seedStatus.classList.add('is-note');
      seedStatus.dataset.state = 'daily';
      seedStatus.textContent = t('newGame.seed.dailyNote', {
        date: formatDateKey(sc.dateKey),
        deck: deckName(setup.deckId),
        stake: stakeName(reg, setup.stake),
      });
    } else {
      seedStatus.dataset.state = 'none';
      seedStatus.textContent = '';
    }
    seedStatus.hidden = seedStatus.textContent === '';
    return sc;
  };

  const start = async (): Promise<void> => {
    const sc = updateSeedStatus();
    if (sc.kind === 'error') {
      seedInput.focus();
      return;
    }
    if (
      GameController.hasSavedRun(app.store) ||
      (app.controller && app.controller.state.phase !== 'game_over')
    ) {
      const ok = await confirmModal({
        title: t('newGame.overwrite.title'),
        message: t('newGame.overwrite.message'),
        confirmLabel: t('newGame.overwrite.confirm'),
        danger: true,
        testId: 'overwrite-confirm',
      });
      if (!ok) return;
    }
    try {
      let c: GameController;
      if (sc.kind === 'daily') {
        // Ručně zadaný denní seed: balíček a síla piva ze seedu, celý obsah, mimo soutěž.
        const setup = dailySetupFromSeed(sc.seed, reg);
        c = app.profiles.newRun({
          deckId: setup.deckId,
          stake: setup.stake,
          seed: sc.seed,
          daily: true,
          seeded: true,
        });
      } else {
        const seed = sc.kind === 'random' ? randomSeed() : sc.seed;
        c = app.profiles.newRun({
          deckId: choice.deckId,
          stake: choice.stake,
          seed,
          seeded: sc.kind === 'custom',
        });
        app.store.set(LAST_CHOICE_KEY, JSON.stringify({ deckId: choice.deckId, stake: choice.stake }));
      }
      app.controller = c;
      app.go('game');
    } catch (err) {
      console.error('[newGame] Nepodařilo se založit run', err);
      toast(t('newGame.failed'), { kind: 'error' });
    }
  };

  const form = h(
    'form',
    {
      class: 'newgame__form',
      novalidate: true,
      onSubmit: (e: SubmitEvent) => {
        e.preventDefault();
        void start();
      },
    },
    h(
      'section',
      { class: 'newgame__section', 'aria-labelledby': 'newgame-deck-title' },
      h(
        'h2',
        { id: 'newgame-deck-title', class: 'section-title' },
        t('newGame.deck.title'),
        h(
          'span',
          { class: 'section-title__meta', 'data-testid': 'deck-unlocked-count' },
          unlockedDecks === decks.length
            ? t('newGame.deck.count', { n: decks.length })
            : t('newGame.deck.unlockedCount', { n: unlockedDecks, total: decks.length }),
        ),
      ),
      deckGroup,
    ),
    h(
      'section',
      { class: 'newgame__section', 'aria-labelledby': 'newgame-stake-title' },
      h('h2', { id: 'newgame-stake-title', class: 'section-title' }, t('newGame.stake.title')),
      stakeGroup,
      stakeDetail,
    ),
    h(
      'section',
      { class: 'newgame__section newgame__section--seed', 'aria-labelledby': 'newgame-seed-title' },
      h(
        'h2',
        { id: 'newgame-seed-title', class: 'section-title' },
        h('label', { for: 'newgame-seed' }, t('newGame.seed.title')),
      ),
      h('div', { class: 'seed-field' }, seedInput, randomBtn),
      h('p', { id: 'newgame-seed-hint', class: 'field-hint' }, t('newGame.seed.hint')),
      seedStatus,
    ),
    h(
      'div',
      { class: 'newgame__actions' },
      button({
        label: t('newGame.start'),
        type: 'submit',
        variant: 'primary',
        size: 'large',
        testId: 'newgame-start',
      }),
    ),
  );

  const el = h(
    'main',
    { class: 'screen newgame', 'aria-labelledby': 'newgame-title' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'newgame-title', class: 'screen-title' }, t('newGame.title')),
        h('p', { class: 'screen-subtitle' }, t('newGame.subtitle')),
      ),
    ),
    form,
  );

  selectDeck(
    Math.max(
      0,
      decks.findIndex((d) => d.id === choice.deckId),
    ),
  );
  updateSeedStatus();
  // Focus na vybraný balíček (klávesnicí se hned dá vybírat šipkami).
  const selectedDeck = deckItems.find((d) => d.tabIndex === 0);
  if (selectedDeck) focusWhenMounted(selectedDeck);

  return {
    el,
    onKey(e) {
      if (e.key === 'Escape') {
        app.go('menu');
        return true;
      }
      return false;
    },
  };
};
