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
    // Engine nesmí sahat na DOM ani na UI.
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator', 'requestAnimationFrame'],
      'no-restricted-imports': ['error', { patterns: ['**/ui/**', '../ui/*'] }],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
