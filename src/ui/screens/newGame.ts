/**
 * Nová hra: výběr balíčku (registry().decks), síly piva 1–8 (registry().stakes, popis kumulativních ztížení)
 * a seedu (prázdné = náhodný přes `generateSeed(Math.random)`). Start založí `GameController` a přejde na hru.
 *
 * Ovládání klávesnicí: Tab mezi skupinami, šipky / Home / End uvnitř skupiny (radiogroup s roving tabindexem),
 * Enter v poli seedu nebo na tlačítku spustí hru, Esc vrátí do menu.
 * Odemykání balíčků a sil piva přijde s profilem ve fázi 8 — do té doby je dostupné všechno.
 */
import type { ArtSpec, DeckDef, StakeDef } from '../../engine';
import { generateSeed } from '../../engine';
import { t } from '../../i18n/cs';
import type { App, ScreenFactory } from '../app';
import { artElement } from '../art/art';
import { safeColor } from '../art/icons';
import { backButton, button, focusWhenMounted } from '../components/button';
import { confirmModal } from '../components/modal';
import { toast } from '../components/toast';
import { GameController } from '../controller';
import { h } from '../dom';

/** Poslední volba balíčku a síly piva (pohodlí hráče; ztráta nevadí). */
const LAST_CHOICE_KEY = 'karban.newGame';
const SEED_MAX_LENGTH = 24;

interface Choice {
  deckId: string;
  stake: number;
}

function loadChoice(app: App, decks: readonly DeckDef[], stakes: readonly StakeDef[]): Choice {
  const fallback: Choice = { deckId: decks[0]?.id ?? 'pub', stake: stakes[0]?.level ?? 1 };
  const raw = app.store.get(LAST_CHOICE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<Choice>;
    return {
      deckId: decks.some((d) => d.id === parsed.deckId) ? (parsed.deckId as string) : fallback.deckId,
      stake: stakes.some((s) => s.level === parsed.stake) ? (parsed.stake as number) : fallback.stake,
    };
  } catch {
    return fallback;
  }
}

/** Seed z pole: bez okrajových mezer, velkými písmeny (stejně jako engine); prázdné = náhodný. */
export function normalizeSeed(raw: string): string {
  return raw.trim().toUpperCase().slice(0, SEED_MAX_LENGTH);
}

/** Balíček na suknu: rub karty v barvách balíčku (src/ui/art) na pozadí se vzorem balíčku — dekorativní. */
function deckStage(spec: ArtSpec): HTMLElement {
  return h(
    'div',
    {
      class: ['deck-option__art', 'art-tile', `art-tile--${spec.pattern ?? 'none'}`],
      style: { '--art-accent': safeColor(spec.accent ?? spec.fg, '#e8a92a') },
      'aria-hidden': 'true',
    },
    artElement('deck', spec),
  );
}

/**
 * Radiogroup s roving tabindexem: šipky/Home/End mění výběr, Tab opouští skupinu.
 * `items` jsou elementy s role="radio" v pořadí zobrazení.
 */
function wireRadioGroup(group: HTMLElement, items: HTMLElement[], onSelect: (index: number) => void): void {
  group.addEventListener('keydown', (e) => {
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      // Mezerník/Enter na položce ji vybere (Enter nespouští hru, ať to nejde omylem).
      e.preventDefault();
      e.stopPropagation();
      onSelect(idx);
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
  const decks = Object.values(reg.decks);
  const stakes = Object.values(reg.stakes).sort((a, b) => a.level - b.level);
  const choice = loadChoice(app, decks, stakes);

  // ── Balíček ──
  const deckItems = decks.map((deck) =>
    h(
      'div',
      {
        class: 'deck-option',
        role: 'radio',
        'aria-checked': 'false',
        'aria-labelledby': `deck-name-${deck.id}`,
        'aria-describedby': `deck-desc-${deck.id}`,
        tabindex: '-1',
        'data-testid': `deck-${deck.id}`,
        'data-deck': deck.id,
        onClick: () => selectDeck(decks.indexOf(deck)),
      },
      deckStage(deck.art),
      h(
        'div',
        { class: 'deck-option__text' },
        h('h3', { id: `deck-name-${deck.id}`, class: 'deck-option__name' }, t(`decks.${deck.id}.name`)),
        h(
          'p',
          { id: `deck-desc-${deck.id}`, class: 'deck-option__desc' },
          t(`decks.${deck.id}.desc`, deck.params),
        ),
        h('p', { class: 'deck-option__flavor' }, t(`decks.${deck.id}.flavor`)),
      ),
    ),
  );
  const deckGroup = h(
    'div',
    { class: 'deck-grid', role: 'radiogroup', 'aria-labelledby': 'newgame-deck-title' },
    deckItems,
  );
  const selectDeck = (index: number): void => {
    const deck = decks[index];
    if (!deck) return;
    choice.deckId = deck.id;
    setChecked(deckItems, index);
  };
  wireRadioGroup(deckGroup, deckItems, selectDeck);

  // ── Síla piva ──
  const stakeItems = stakes.map((stake) =>
    h(
      'div',
      {
        class: 'stake-option',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': t('newGame.stake.optionLabel', {
          name: t(`stakes.${stake.id}.name`),
          level: stake.level,
        }),
        tabindex: '-1',
        'data-testid': `stake-${stake.level}`,
        'data-stake': stake.level,
        onClick: () => selectStake(stakes.indexOf(stake)),
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

  const stakeName = h('h3', { class: 'stake-detail__name' });
  const stakeFlavor = h('p', { class: 'stake-detail__flavor' });
  const stakeArt = h('div', { class: 'stake-detail__art' });
  const stakeRules = h('ol', { class: 'stake-detail__rules', 'data-testid': 'stake-rules' });
  const stakeDetail = h(
    'div',
    { class: 'stake-detail paper', 'aria-live': 'polite' },
    stakeArt,
    h(
      'div',
      { class: 'stake-detail__text' },
      stakeName,
      stakeFlavor,
      h('p', { class: 'stake-detail__rules-title' }, t('newGame.stake.rules')),
      stakeRules,
    ),
  );

  const selectStake = (index: number): void => {
    const stake = stakes[index];
    if (!stake) return;
    choice.stake = stake.level;
    setChecked(stakeItems, index);
    stakeName.textContent = t('newGame.stake.heading', {
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
  wireRadioGroup(stakeGroup, stakeItems, selectStake);

  // ── Seed ──
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
    'aria-describedby': 'newgame-seed-hint',
    'data-testid': 'seed-input',
  });
  const randomBtn = button({
    label: t('newGame.seed.random'),
    ariaLabel: t('newGame.seed.randomLabel'),
    variant: 'ghost',
    testId: 'seed-random',
    onClick: () => {
      seedInput.value = generateSeed(Math.random);
      seedInput.focus();
    },
  });

  const start = async (): Promise<void> => {
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
    const seed = normalizeSeed(seedInput.value) || generateSeed(Math.random);
    try {
      const c = GameController.newRun(
        { deckId: choice.deckId, stake: choice.stake, seed },
        { registry: app.registry, store: app.store },
      );
      app.store.set(LAST_CHOICE_KEY, JSON.stringify({ deckId: choice.deckId, stake: choice.stake }));
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
        h('span', { class: 'section-title__meta' }, t('newGame.deck.count', { n: decks.length })),
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
  selectStake(
    Math.max(
      0,
      stakes.findIndex((s) => s.level === choice.stake),
    ),
  );
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
