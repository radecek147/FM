import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Engine nesmí sahat na DOM, UI, obsah ani texty (obsah dostává přes ContentRegistry, texty jsou jen klíče).
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'navigator',
        'requestAnimationFrame',
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['**/ui/**', '../ui/*', '**/content/**', '../content/*', '**/i18n/**', '../i18n/*'] },
      ],
      // Veškerá náhoda musí jít přes seedované RNG streamy (determinismus).
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Použij seedovaný RNG (core.rng / ctx.rng).' },
        { object: 'Date', property: 'now', message: 'Engine musí být deterministický.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
