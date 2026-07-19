// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry: boots the theme, the pan/zoom viewport, and mounts the
// sample forest scene so the ported render modules can be checked against the
// design mock (M1). The real forest model now loads and validates in this
// same renderer environment (M2) — bundling json5 and the fixture with no
// IPC yet — though the scene it still draws is the M1 sample; the layout
// engine that will draw the real model arrives in M3.

import JSON5 from 'json5'
import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountScene } from './render/scene.js'
import { SAMPLE_BOUNDS } from './render/sample-fixture.js'
import { validateForest } from './model/validate.js'
import { buildForest } from './model/forest.js'
import homelabFixtureRaw from './model/fixtures/homelab.forest.json5?raw'

initTheme(document.getElementById('mode'))

const fixtureRawForest = JSON5.parse(homelabFixtureRaw)
const fixtureValidation = validateForest(fixtureRawForest)
if (!fixtureValidation.ok) {
  console.error('HomeLab fixture failed validation:', fixtureValidation.errors)
} else {
  const fixtureForest = buildForest(fixtureRawForest)
  console.log(
    'Forest model loaded and validated in-renderer:',
    fixtureForest.domain, '—', fixtureForest.trees.length, 'trees,', fixtureForest.tasks.size, 'tasks',
  )
}

const viewportEl = document.getElementById('viewport')
const worldEl = document.getElementById('world')
const contentEl = document.getElementById('content')
const emptyEl = document.getElementById('empty')
const pctEl = document.getElementById('pct')

mountScene(contentEl)
if (emptyEl) emptyEl.remove()

const viewport = createViewport({
  viewportEl, worldEl, pctEl,
  getBounds: () => SAMPLE_BOUNDS,
})

document.getElementById('fit').addEventListener('click', () => viewport.fit())
document.getElementById('zin').addEventListener('click', () => {
  viewport.zoomAt(1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})
document.getElementById('zout').addEventListener('click', () => {
  viewport.zoomAt(1 / 1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})

window.addEventListener('resize', viewport.fit)
viewport.fit()

console.log('TaskForkStack renderer loaded (M1: ported skin, sample scene)')
