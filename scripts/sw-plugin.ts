/**
 * Vite plugin `karban-sw`: při buildu přeloží ručně psaný service worker (src/sw/sw.ts) do `sw.js` vedle
 * index.html a doplní mu seznam souborů k uložení (precache) a verzi cache svázanou s buildem.
 * Viz docs/ARCHITECTURE.md „Service worker“; registrace v src/ui/serviceWorker.ts.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformWithOxc, type Plugin } from 'vite';

/** Název výstupního souboru (shodný se `SW_FILE` v src/ui/serviceWorker.ts). */
export const SW_FILE = 'sw.js';
const SW_ENTRY = fileURLToPath(new URL('../src/sw/sw.ts', import.meta.url));

/**
 * Seznam souborů pro precache: všechno z buildu kromě source map a workeru samotného; index.html se ukládá pod
 * adresou adresáře (`./`), protože na ni hra naviguje. Cesty jsou relativní k rozsahu workeru (base).
 */
export function precacheList(fileNames: readonly string[]): string[] {
  const list = fileNames
    .filter((f) => !f.endsWith('.map') && f !== SW_FILE)
    .map((f) => (f === 'index.html' ? './' : f))
    .sort();
  if (!list.includes('./')) throw new Error('karban-sw: v buildu chybí index.html');
  return list;
}

/** Verze cache = otisk obsahu všech souborů buildu (stejný build → stejná verze, jakákoli změna → nová). */
export function buildVersion(
  files: ReadonlyArray<readonly [name: string, content: string | Uint8Array]>,
): string {
  const hash = createHash('sha256');
  for (const [name, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(name).update('\0').update(content).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** Zdroj `sw.js`: přeložený src/sw/sw.ts s doplněnou verzí a seznamem souborů (klasický skript, bez `export`). */
export async function buildServiceWorker(version: string, precache: readonly string[]): Promise<string> {
  const source = await readFile(SW_ENTRY, 'utf8');
  const { code } = await transformWithOxc(source, SW_ENTRY, { lang: 'ts' });
  const body = code.replace(/^export\s*\{\s*\};?\s*$/m, '').trimEnd();
  if (/^\s*(import|export)\s/m.test(body)) throw new Error('karban-sw: src/sw/sw.ts nesmí nic importovat');
  return [
    '// Service worker Karbanu — vygenerováno při buildu (scripts/sw-plugin.ts ze src/sw/sw.ts), neupravuj.',
    `const __SW_VERSION__ = ${JSON.stringify(version)};`,
    `const __SW_PRECACHE__ = ${JSON.stringify(precache)};`,
    body,
    '',
  ].join('\n');
}

export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'karban-sw',
    apply: 'build',
    // Až po vložení index.html do bundlu (vite:build-html ho vydá ve stejném háčku).
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const outputs = Object.values(bundle).filter((o) => !o.fileName.endsWith('.map'));
      const precache = precacheList(outputs.map((o) => o.fileName));
      const version = buildVersion(
        outputs.map((o) => [o.fileName, o.type === 'chunk' ? o.code : o.source] as const),
      );
      this.emitFile({
        type: 'asset',
        fileName: SW_FILE,
        source: await buildServiceWorker(version, precache),
      });
    },
  };
}
