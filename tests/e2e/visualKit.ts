/**
 * Společná výbava vizuálních kontrol (visual.spec.ts, visual-meta.spec.ts): rozlišení, hlídání konzole, metriky
 * pro ruční kontrolu snímků (horizontální přetečení, prvky mimo okno, uříznuté texty, malé dotykové cíle na dotyku
 * a nízký kontrast textu na jednobarevném pozadí) a snímek s metrikami do `report.jsonl`.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';

export interface Viewport {
  name: string;
  width: number;
  height: number;
  touch?: boolean;
}

export const VIEWPORTS: Viewport[] = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: 'tablet-820x1180', width: 820, height: 1180, touch: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true },
];

/** Chyby a varování konzole (vizuální kontrola je jen sbírá, test je ověří na konci). */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

export interface ShotMetrics {
  scrollWidth: number;
  innerWidth: number;
  scrollHeight: number;
  innerHeight: number;
  hScroll: boolean;
  clipped: string[];
  outside: string[];
  small: string[];
  lowContrast: string[];
}

/** Metriky pro ruční kontrolu (přetečení, uříznutý text, malé dotykové cíle, kontrast). */
export async function metrics(page: Page, touch: boolean): Promise<ShotMetrics> {
  return page.evaluate((isTouch) => {
    const doc = document.documentElement;
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const cls = (el.getAttribute('class') ?? '').split(' ')[0];
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''} „${text}“`;
    };
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement) || !visible(el)) continue;
      if (!el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      const hides = (v: string) => v === 'hidden' || v === 'clip';
      if (el.classList.contains('visually-hidden')) continue;
      const overX = el.scrollWidth > el.clientWidth + 1 && hides(cs.overflowX);
      const overY = el.scrollHeight > el.clientHeight + 1 && hides(cs.overflowY);
      if ((overX || overY) && el.clientWidth > 0)
        clipped.push(`${label(el)} ${overX ? 'X' : ''}${overY ? 'Y' : ''}`);
    }
    // Prvky vyčnívající z okna (vodorovně) — jen „nejvyšší“ vyčnívající prvek.
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('#app *, .toast-region *, .tutorial-layer *'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) {
        const pr = el.parentElement?.getBoundingClientRect();
        if (pr && (pr.right > innerWidth + 1 || pr.left < -1)) continue;
        outside.push(label(el));
      }
    }
    const small: string[] = [];
    if (isTouch) {
      const sel =
        'button, [role="button"], [role="radio"], [role="tab"], a[href], input, select, .pcard, .kcard';
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (!visible(el)) continue;
        if (el instanceof HTMLInputElement && el.type === 'file') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44)
          small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    // Kontrast textu: jen kde je pozadí jednobarevné (gradienty a textury se kontrolují okem na snímku).
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const parts = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: [number, number, number, number]): number => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const lowContrast: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement) || !visible(el)) continue;
      if (el.classList.contains('visually-hidden') || el.closest('[aria-hidden="true"]')) continue;
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      );
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      let bg: [number, number, number, number] | null = null;
      let unknown = false;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const c = parse(acs.backgroundColor);
        if (c && c[3] > 0.9) {
          bg = c;
          break;
        }
        if (acs.backgroundImage !== 'none' || (c && c[3] > 0.05)) {
          unknown = true;
          break;
        }
      }
      if (unknown || !bg) continue;
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      if (ratio < (large ? 3 : 4.5)) lowContrast.push(`${label(el)} ${ratio.toFixed(2)}`);
    }
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth,
      scrollHeight: doc.scrollHeight,
      innerHeight,
      hScroll: doc.scrollWidth > innerWidth + 1,
      clipped: clipped.slice(0, 30),
      outside: outside.slice(0, 30),
      small: small.slice(0, 40),
      lowContrast: lowContrast.slice(0, 30),
    };
  }, touch);
}

export interface ShotOptions {
  fullPage?: boolean;
  keepHover?: boolean;
  /** Bez metrik (celostránkový snímek — Chromium po něm zapomene emulaci dotyku). */
  noMetrics?: boolean;
}

/** Snímek do `<out>/<rozlišení>/<name>.png` + metriky do `<out>/report.jsonl`. */
export async function takeShot(
  page: Page,
  out: string,
  vp: Viewport,
  name: string,
  opts: ShotOptions = {},
): Promise<void> {
  // Kurzor po posledním kliknutí by nad kartou/žolíkem nechal otevřený tooltip (na dotyku by tam nebyl).
  if (!opts.keepHover) {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => document.fonts.ready);
  const dir = `${out}/${vp.name}`;
  mkdirSync(dir, { recursive: true });
  if (!opts.noMetrics && !opts.fullPage) {
    const m = await metrics(page, Boolean(vp.touch));
    appendFileSync(`${out}/report.jsonl`, `${JSON.stringify({ viewport: vp.name, shot: name, ...m })}\n`);
  }
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage ?? false });
}
