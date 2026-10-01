/**
 * npm run deploy  (= npm run build && tsx scripts/deploy.ts)
 *
 * Lokální pomocník: ověří výsledek buildu a vypíše, jak hra jde na GitHub Pages. Samotné nasazení
 * neprovádí — to dělá GitHub Actions (.github/workflows/deploy.yml) po pushi do main nebo tagu v*.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'dist/index.html');

/** Jméno repozitáře z `git remote get-url origin`, jinak název složky projektu. */
function repoName(): string {
  const res = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  const url = res.status === 0 ? res.stdout.trim() : '';
  const match = /[/:]([^/:]+?)(?:\.git)?\/?$/.exec(url);
  return match?.[1] ?? path.basename(ROOT);
}

if (!existsSync(INDEX)) {
  console.error('Chybí dist/index.html — build neproběhl nebo selhal. Spusť „npm run build“.');
  process.exit(1);
}

const html = readFileSync(INDEX, 'utf8');
const usedBase = /<script[^>]+src="([^"]*?)assets\//.exec(html)?.[1] ?? '(nezjištěno)';
const recommended = `/${repoName()}/`;

console.log(`Build je v pořádku: ${path.relative(ROOT, INDEX)} (base v buildu: ${usedBase}).`);
console.log('');
console.log('Nasazení na GitHub Pages běží přes GitHub Actions (.github/workflows/deploy.yml):');
console.log('  - automaticky po pushi do větve main nebo tagu v* (např. git tag v1.0.0 && git push --tags),');
console.log('  - ručně: záložka Actions → „Deploy to GitHub Pages“ → Run workflow.');
console.log('  Jednorázově: Settings → Pages → Source = „GitHub Actions“.');
console.log('');
console.log(`Doporučené BASE_PATH pro tento repozitář: ${recommended}`);
console.log(`  Lokální náhled jako na Pages: BASE_PATH=${recommended} npm run build && npm run preview`);
console.log('  Bez BASE_PATH je base „./“ (relativní cesty, funguje z libovolné podsložky serveru).');
