/**
 * Lehký DOM helper bez frameworku.
 *
 *   h('button', { class: 'btn', onClick: () => go(), 'aria-label': t('menu.newGame.label') }, t('…'))
 *
 * Props:
 *  - `class` / `className`: řetězec, pole nebo `{ třída: boolean }`,
 *  - `style`: objekt (`{ color: 'red', '--accent': '#fc0' }` — camelCase i CSS proměnné),
 *  - `on<Event>`: posluchač (`onClick`, `onPointerDown` → `pointerdown`),
 *  - `data-*`, `aria-*` a ostatní atributy: `true` → prázdný atribut, `false`/`null`/`undefined` → vynechat,
 *  - `value`, `checked`, `selected`: nastaví se jako vlastnost elementu,
 *  - `ref`: callback, dostane vytvořený element.
 * Děti: řetězec | číslo | Node | null | undefined | false | true | pole (libovolně vnořené).
 *
 * Texty nikdy nevkládej přes innerHTML — `h()` je vkládá jako textové uzly (bez XSS).
 */

export type Child = string | number | Node | null | undefined | boolean | readonly Child[];

export type ClassValue = string | readonly (string | false | null | undefined)[] | Record<string, boolean>;

export type StyleValue = Record<string, string | number | null | undefined>;

type EventHandlers = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: (event: HTMLElementEventMap[K]) => void;
};

export type Props = EventHandlers & {
  class?: ClassValue;
  className?: ClassValue;
  style?: StyleValue | string;
  ref?: (el: Element) => void;
  [attr: string]: unknown;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTY_KEYS = new Set(['value', 'checked', 'selected']);

function classString(value: ClassValue): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  return Object.entries(value)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(' ');
}

function toKebab(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function applyStyle(el: HTMLElement | SVGElement, style: StyleValue | string): void {
  if (typeof style === 'string') {
    el.setAttribute('style', style);
    return;
  }
  for (const [name, value] of Object.entries(style)) {
    if (value === null || value === undefined) continue;
    el.style.setProperty(toKebab(name), String(value));
  }
}

function applyProps(el: HTMLElement | SVGElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class' || key === 'className') {
      const cls = classString(value as ClassValue);
      if (cls) el.setAttribute('class', cls);
    } else if (key === 'style') {
      applyStyle(el, value as StyleValue | string);
    } else if (key === 'ref') {
      if (typeof value === 'function') (value as (el: Element) => void)(el);
    } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (PROPERTY_KEYS.has(key) && key in el) {
      Reflect.set(el, key, value);
    } else if (value === false) {
      // Booleovský atribut vypnutý — ARIA ale potřebuje explicitní "false".
      if (key.startsWith('aria-')) el.setAttribute(key, 'false');
    } else if (value === true) {
      el.setAttribute(key, key.startsWith('aria-') ? 'true' : '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/** Připojí děti (rekurzivně zploští pole, přeskočí null/undefined/boolean). */
export function appendChildren(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || typeof child === 'boolean') continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Vytvoří HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** Vytvoří SVG element (ve správném jmenném prostoru). */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** Nahradí obsah kořene novým obsahem. */
export function mount(root: Element, ...children: Child[]): void {
  root.replaceChildren();
  appendChildren(root, children);
}

/** `querySelector`, který místo `null` vyhodí srozumitelnou chybu. */
export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Element nenalezen: ${selector}`);
  return el;
}
