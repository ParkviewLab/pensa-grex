// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry: boots the theme and the pan/zoom viewport, then runs the
// full model -> measure -> layout -> render pipeline against the HomeLab
// fixture (no IPC/persistence yet — that's M4). Every coordinate on screen
// now comes from layout/layout.js; nothing is hardcoded.

import JSON5 from 'json5'
import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountLayout } from './render/scene.js'
import { validateForest } from './model/validate.js'
import { buildForest } from './model/forest.js'
import { measureForest } from './layout/measure.js'
import { computeForestLayout } from './layout/layout.js'
import homelabFixtureRaw from './model/fixtures/homelab.forest.json5?raw'

initTheme(document.getElementById('mode'))

const viewportEl = document.getElementById('viewport')
const worldEl = document.getElementById('world')
const contentEl = document.getElementById('content')
const emptyEl = document.getElementById('empty')
const pctEl = document.getElementById('pct')

let currentLayout = null
const viewport = createViewport({
  viewportEl, worldEl, pctEl,
  getBounds: () => currentLayout?.bounds || { w: 0, h: 0 },
})

document.getElementById('fit').addEventListener('click', () => viewport.fit())
document.getElementById('zin').addEventListener('click', () => {
  viewport.zoomAt(1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})
document.getElementById('zout').addEventListener('click', () => {
  viewport.zoomAt(1 / 1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})
window.addEventListener('resize', () => viewport.fit())

async function boot() {
  const raw = JSON5.parse(homelabFixtureRaw)
  const validation = validateForest(raw)
  if (!validation.ok) {
    console.error('HomeLab fixture failed validation:', validation.errors)
    return
  }
  const forest = buildForest(raw)

  const { sizes, titleSizes } = await measureForest(forest)
  currentLayout = computeForestLayout(forest, sizes, titleSizes)

  mountLayout(contentEl, currentLayout, forest)
  if (emptyEl) emptyEl.remove()
  viewport.fit()

  console.log(
    'Forest laid out:', forest.domain, '—', forest.trees.length, 'trees,', forest.tasks.size, 'tasks,',
    currentLayout.junctions.length, 'junctions, canvas', Math.round(currentLayout.bounds.w) + 'x' + Math.round(currentLayout.bounds.h),
  )
}

boot()
