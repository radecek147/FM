/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, runnerImport, type Plugin } from 'vite';

// GitHub Pages servíruje z /<repo>/ — base lze přepsat proměnnou BASE_PATH.
const base = process.env.BASE_PATH ?? './';

const I18N_ENTRY = fileURLToPath(new URL('./src/i18n/cs.ts', import.meta.url));
/** Část API `src/i18n/cs.ts`, kterou plugin potřebuje (bez importu — config nemá záviset na zdrojácích hry). */
interface I18nApi {
  t(key: string): string;
  hasKey(key: string): boolean;
}

/** Zástupný symbol textu v index.html: `{{t:app.documentTitle}}`. */
const HTML_TEXT_PLACEHOLDER = /\{\{t:([\w.]+)\}\}/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Dosadí texty z `src/i18n/cs.ts` do statického `index.html` (titulek, meta popis, `<noscript>`),
 * aby ani HTML nemělo texty natvrdo. Neznámý klíč shodí build i dev server.
 * Modul textů se načítá přes `runnerImport` (stejná transformace jako aplikace), ne importem do configu.
 */
function i18nHtml(): Plugin {
  return {
    name: 'karban-i18n-html',
    async transformIndexHtml(html) {
      const { module: i18n } = await runnerImport<I18nApi>(I18N_ENTRY);
      return html.replace(HTML_TEXT_PLACEHOLDER, (_match, key: string) => {
        if (!i18n.hasKey(key)) throw new Error(`index.html: neznámý i18n klíč „${key}“ (src/i18n/cs.ts)`);
        return escapeHtml(i18n.t(key));
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [i18nHtml()],
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
