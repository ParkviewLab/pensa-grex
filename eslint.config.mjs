// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['out/', 'dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'scripts/**', 'electron.vite.config.js', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The shared model + task-authority core run in BOTH the main process and the
    // renderer, so they may use only globals present in both (e.g. structuredClone).
    files: ['src/shared/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]
