import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const SIM_IMPL = ['**/simulation/*', '**/commands/*', '**/navigation/*', '**/session/*'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'tests/e2e', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // Pure simulation core must never depend on rendering / UI / DOM state.
  {
    files: ['src/domain/**', 'src/levels/**', 'src/navigation/**', 'src/commands/**', 'src/simulation/**', 'src/session/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['three', 'three/*', 'postprocessing', 'n8ao'], message: 'Simulation core must not import Three.js (Tech §1).' },
          { group: ['react', 'react-dom', 'react/*', 'zustand', 'zustand/*'], message: 'Simulation core must not import React/Zustand (Tech §1).' },
          { group: ['**/scene/**', '**/presentation/**', '**/audio/**', '**/ui/**', '**/state/**'], message: 'Simulation core must not depend on presentation layers.' },
        ],
      }],
    },
  },
  // Presentation layers only read domain types + events (Tech §12.6, D21-04).
  {
    files: ['src/scene/**', 'src/presentation/**', 'src/audio/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: SIM_IMPL, message: 'Presentation must not import simulation/command implementations (D21-04). Read snapshots/events instead.' }],
      }],
    },
  },
);
