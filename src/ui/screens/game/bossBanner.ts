/**
 * Příchod šéfa (DESIGN 8.1, 13.6): plakát nad stolem se žetonem šéfa, jménem, pravidlem a hláškou `intro`.
 *
 * Neblokuje hru (nejde na něj kliknout, ruka pod ním zůstává ovladatelná) a zmizí sám po pár sekundách —
 * čas na přečtení se neřídí rychlostí hry — nebo hned, jak hráč zahraje či zahodí. Bez animací se jen ukáže
 * a schová (CSS `html.no-anim`, prefers-reduced-motion). Čtečkám hlášku oznámí presenter přes živou oblast.
 */
import type { BlindKind, ContentRegistry } from '../../../engine';
import { t } from '../../../i18n/cs';
import { blindArt } from '../../art/art';
import { bossTexts } from '../../describe';
import { h } from '../../dom';

/** Jak dlouho plakát visí (ms, skutečný čas — text se musí dát přečíst i při rychlosti 4×). */
export const BOSS_BANNER_MS = 4200;

export interface BossBanner {
  el: HTMLElement;
  /** Ukáže plakát šéfa (u Velké útraty na Imperialu jako „pravidlo navíc“). */
  show(bossId: string, kind: BlindKind, ante: number): void;
  hide(): void;
}

export function createBossBanner(registry: ContentRegistry): BossBanner {
  const el = h('div', {
    class: 'boss-banner',
    role: 'note',
    'data-testid': 'boss-banner',
    hidden: true,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;

  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (el.hidden) return;
    el.classList.remove('is-shown');
    el.hidden = true;
    el.replaceChildren();
  };

  const show = (bossId: string, kind: BlindKind, ante: number): void => {
    const def = registry.bosses[bossId];
    if (!def) return;
    hide();
    const tx = bossTexts(bossId, { registry });
    el.style.setProperty('--boss-color', def.color);
    el.dataset.bossId = bossId;
    el.replaceChildren(
      h(
        'div',
        { class: 'boss-banner__token', 'aria-hidden': 'true' },
        blindArt('boss', bossId, { registry }),
      ),
      h(
        'div',
        { class: 'boss-banner__text' },
        h(
          'p',
          { class: 'boss-banner__label' },
          kind === 'boss' ? t('game.bossBanner.label', { ante }) : t('game.bossBanner.extraLabel'),
        ),
        h('p', { class: 'boss-banner__name' }, tx.name),
        h('p', { class: 'boss-banner__rule' }, tx.rule),
        tx.intro
          ? h('p', { class: 'boss-banner__intro' }, t('art.tooltip.flavor', { text: tx.intro }))
          : null,
      ),
    );
    el.hidden = false;
    // Další snímek: přechod z výchozího stavu (CSS) do zobrazeného.
    requestAnimationFrame(() => el.classList.add('is-shown'));
    timer = setTimeout(hide, BOSS_BANNER_MS);
  };

  return { el, show, hide };
}
