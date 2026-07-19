// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Standalone from electron.vite.config.js (which configures three separate
// main/preload/renderer builds, not a single tree Vitest can target). Model
// modules are pure JS with no DOM dependency, so the default 'node'
// environment is enough — no jsdom needed here.
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
  },
})
