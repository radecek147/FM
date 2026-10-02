/**
 * Postavička Štamgasta pro tutoriál (DESIGN 13.5): vlastní SVG — tácek, hlava s bekovkou a knírem z ikony
 * `mustache`, v ruce půllitr z ikony `beer-stein` (game-icons.net, CC BY 3.0, ASSETS.md). Dekorativní.
 */
import { iconMarkup } from './icons';

/** SVG markup Štamgasta (viewBox 0 0 64 64). */
export function stamgastMarkup(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="stamgast" aria-hidden="true" focusable="false">',
    // Tácek pod pivo
    '<circle cx="32" cy="32" r="31" fill="#2c7a55" stroke="#f4ecd8" stroke-width="2"/>',
    '<circle cx="32" cy="32" r="25" fill="none" stroke="#f4ecd8" stroke-opacity="0.35" stroke-dasharray="3 3"/>',
    // Ramena a košile
    '<path d="M12 60c2-11 10-16 20-16s18 5 20 16z" fill="#c8372d"/>',
    '<path d="M27 44l5 7 5-7z" fill="#f4ecd8"/>',
    // Hlava
    '<ellipse cx="32" cy="29" rx="12" ry="13" fill="#f1c9a0"/>',
    '<ellipse cx="20" cy="30" rx="2.5" ry="3.5" fill="#e8b48a"/>',
    '<ellipse cx="44" cy="30" rx="2.5" ry="3.5" fill="#e8b48a"/>',
    // Bekovka
    '<path d="M18 23c0-8 7-12 14-12s15 4 15 11c-3-1-8-2-15-2s-11 1-14 3z" fill="#4b4337"/>',
    '<path d="M17 24c4-2 9-3 15-3s12 1 17 3c0 2-1 3-2 3-4-1-9-2-15-2s-10 1-14 2c-1 0-1-2-1-3z" fill="#3a2412"/>',
    // Oči a červený nos
    '<circle cx="27" cy="29" r="1.6" fill="#1e1b16"/>',
    '<circle cx="37" cy="29" r="1.6" fill="#1e1b16"/>',
    '<ellipse cx="32" cy="33" rx="2.6" ry="2.2" fill="#d9746a"/>',
    // Knír (ikona)
    iconMarkup('mustache', { x: 22, y: 30, size: 20, color: '#5b3a21' }),
    // Půllitr (ikona)
    iconMarkup('beer-stein', { x: 40, y: 38, size: 20, color: '#e8a92a' }),
    '</svg>',
  ].join('');
}

/** Element Štamgasta (dekorativní). */
export function stamgastElement(className = 'stamgast-avatar'): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = className;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = stamgastMarkup();
  return wrap;
}
