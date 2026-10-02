import { registry as getRegistry } from '../src/content';
import { jokerTexts } from '../src/ui/describe';
const registry = getRegistry();
const out: string[] = [];
const byR: Record<string, number> = {};
const byTag: Record<string, number> = {};
const iconProp = new Map<string, string[]>();
const files: Record<string, string> = {};
import * as common from '../src/content/jokers/common';
import * as common2 from '../src/content/jokers/common2';
import * as rare from '../src/content/jokers/rare';
import * as rare2 from '../src/content/jokers/rare2';
import * as epic from '../src/content/jokers/epic';
import * as epic2 from '../src/content/jokers/epic2';
import * as legendary from '../src/content/jokers/legendary';
for (const [f, m] of Object.entries({ common, common2, rare, rare2, epic, epic2, legendary })) {
  for (const v of Object.values(m as Record<string, unknown>)) {
    const arr = Array.isArray(v) ? v : [v];
    for (const d of arr) if (d && typeof d === 'object' && 'id' in d && 'hooks' in d) files[(d as { id: string }).id] = f;
  }
}
for (const j of Object.values(registry.jokers)) {
  byR[j.rarity] = (byR[j.rarity] ?? 0) + 1;
  for (const tg of j.tags ?? []) byTag[tg] = (byTag[tg] ?? 0) + 1;
  const k = `${j.art.icon}/${j.art.prop ?? '-'}`;
  iconProp.set(k, [...(iconProp.get(k) ?? []), j.id]);
  const tx = jokerTexts(j);
  const flags = [j.copyable === false ? 'nocopy' : '', j.noEternal ? 'noEt' : '', j.noRental ? 'noRent' : '', j.noPerishable ? 'noPer' : '', j.noShop ? 'noShop' : ''].filter(Boolean).join(',');
  out.push(`== ${files[j.id] ?? '?'} ${j.id} [${j.rarity} ${j.cost}Kč] tags=${(j.tags ?? []).join(',')} ${flags} icon=${k} hooks=${Object.keys(j.hooks).join(',')}`);
  out.push(`  name:   ${tx.name}  (${tx.name.split(/\s+/).length} sl.)`);
  out.push(`  desc:   ${tx.desc}`);
  out.push(`  flavor: ${tx.flavor}`);
}
console.log(out.join('\n'));
console.log('rarity', byR, 'total', Object.keys(registry.jokers).length);
console.log('tags', byTag);
for (const [k, v] of iconProp) if (v.length > 1) console.log('DUP icon/prop', k, v);
const icons = new Map<string, string[]>();
for (const j of Object.values(registry.jokers)) icons.set(j.art.icon, [...(icons.get(j.art.icon) ?? []), j.id]);
for (const [k, v] of icons) if (v.length > 1) console.log('shared icon', k, v);
const names = new Map<string, string[]>();
for (const j of Object.values(registry.jokers)) { const n = jokerTexts(j).name.toLowerCase(); names.set(n, [...(names.get(n) ?? []), j.id]); }
for (const [k, v] of names) if (v.length > 1) console.log('DUP name', k, v);
