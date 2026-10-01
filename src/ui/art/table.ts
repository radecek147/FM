/**
 * Ozdoba herního stolu: „potisk“ na suknu uprostřed jeviště (prošívaný ovál dělá CSS, tady je znak se čtyřmi
 * barvami karet). Čistě dekorativní — `aria-hidden`, bez textu, barvu a průhlednost řídí CSS (`currentColor`).
 */
import { svg } from '../dom';
import { SUIT_PATH_D } from './icons';

/** Znak stolu: dvojitý kruh a čtyři barvy (♠ nahoře, ♥ vpravo, ♣ dole, ♦ vlevo) kolem kroužku. */
export function tableEmblem(): SVGSVGElement {
  const suit = (d: string, cx: number, cy: number): SVGGElement =>
    svg(
      'g',
      { transform: `translate(${cx - 26} ${cy - 26}) scale(${52 / 512})` },
      svg('path', { d, fill: 'currentColor' }),
    );
  return svg(
    'svg',
    {
      class: 'table-emblem',
      viewBox: '0 0 240 240',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    svg('circle', { cx: 120, cy: 120, r: 112, fill: 'none', stroke: 'currentColor', 'stroke-width': 4 }),
    svg('circle', {
      cx: 120,
      cy: 120,
      r: 102,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-dasharray': '6 6',
    }),
    suit(SUIT_PATH_D.S, 120, 54),
    suit(SUIT_PATH_D.H, 186, 120),
    suit(SUIT_PATH_D.C, 120, 186),
    suit(SUIT_PATH_D.D, 54, 120),
    svg('circle', { cx: 120, cy: 120, r: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 5 }),
  );
}
