/**
 * Záložky (WAI-ARIA tabs) pro sbírku a statistiky.
 *
 *   const tabs = createTabs({ label, idPrefix: 'codex', tabs: [{ id: 'jokers', label: 'Žolíci' }], onChange })
 *
 * - role="tablist" s tlačítky role="tab" (roving tabindex), jeden panel role="tabpanel" (obsah staví volající
 *   líně v `onChange` — vykreslí se jen otevřená záložka),
 * - šipky ← / → (i ↑ / ↓), Home a End přepínají a fokusují záložku (automatická aktivace),
 * - cedulka s počtem (např. „Nové“) je aria-hidden; přístupný popisek nese `badgeLabel`.
 */
import { h } from '../dom';

export interface TabDef {
  id: string;
  label: string;
  /** Cedulka vpravo (počet novinek); null/undefined = žádná. */
  badge?: string | null;
  /** Přístupný popisek záložky s cedulkou („Žolíci, 3 nové položky“). */
  badgeLabel?: string;
}

export interface TabsOptions {
  /** Přístupný název seznamu záložek. */
  label: string;
  /** Předpona id prvků (`<prefix>-tab-<id>`, `<prefix>-panel`). */
  idPrefix: string;
  tabs: readonly TabDef[];
  initial?: string;
  /** Záložka se změnila — vykresli obsah do `panel`. Volá se i pro počáteční záložku. */
  onChange: (id: string, panel: HTMLElement, previous: string | null) => void;
}

export interface Tabs {
  /** Kontejner se seznamem záložek a panelem. */
  el: HTMLElement;
  list: HTMLElement;
  panel: HTMLElement;
  readonly current: string;
  /** Přepne záložku (a volitelně na ni dá focus). */
  select(id: string, focus?: boolean): void;
  /** Změní cedulku záložky. */
  setBadge(id: string, badge: string | null, badgeLabel?: string): void;
}

export function createTabs(opts: TabsOptions): Tabs {
  const ids = opts.tabs.map((d) => d.id);
  let current = '';
  const panel = h('div', {
    id: `${opts.idPrefix}-panel`,
    class: 'tabs__panel',
    role: 'tabpanel',
    tabindex: '0',
  });

  const buttons = opts.tabs.map((def) =>
    h(
      'button',
      {
        type: 'button',
        id: `${opts.idPrefix}-tab-${def.id}`,
        class: 'tabs__tab',
        role: 'tab',
        'aria-selected': 'false',
        'aria-controls': panel.id,
        tabindex: '-1',
        'data-testid': `${opts.idPrefix}-tab-${def.id}`,
        'data-tab': def.id,
        onClick: () => select(def.id),
      },
      h('span', { class: 'tabs__label' }, def.label),
      h('span', { class: 'tabs__badge', 'aria-hidden': 'true', hidden: !def.badge }, def.badge ?? ''),
    ),
  );
  const byId = new Map(opts.tabs.map((d, i) => [d.id, buttons[i]!] as const));

  const setBadge = (id: string, badge: string | null, badgeLabel?: string): void => {
    const btn = byId.get(id);
    if (!btn) return;
    const el = btn.querySelector<HTMLElement>('.tabs__badge');
    if (el) {
      el.textContent = badge ?? '';
      el.hidden = !badge;
    }
    if (badge && badgeLabel) btn.setAttribute('aria-label', badgeLabel);
    else btn.removeAttribute('aria-label');
  };
  opts.tabs.forEach((d) => setBadge(d.id, d.badge ?? null, d.badgeLabel));

  const list = h('div', { class: 'tabs__list', role: 'tablist', 'aria-label': opts.label }, buttons);

  function select(id: string, focus = false): void {
    const btn = byId.get(id);
    if (!btn) return;
    const previous = current || null;
    if (id !== current) {
      current = id;
      for (const [tid, b] of byId) {
        const on = tid === id;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle('is-active', on);
      }
      panel.setAttribute('aria-labelledby', btn.id);
      panel.dataset.tab = id;
      opts.onChange(id, panel, previous);
    }
    if (focus) btn.focus();
  }

  list.addEventListener('keydown', (e) => {
    const idx = ids.indexOf(current);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % ids.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = ids[next];
    if (id) select(id, true);
  });

  select(opts.initial && byId.has(opts.initial) ? opts.initial : (ids[0] ?? ''));

  return {
    el: h('div', { class: 'tabs' }, list, panel),
    list,
    panel,
    get current() {
      return current;
    },
    select,
    setBadge,
  };
}
