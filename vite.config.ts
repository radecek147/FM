/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages servíruje z /<repo>/ — base lze přepsat proměnnou BASE_PATH.
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
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
