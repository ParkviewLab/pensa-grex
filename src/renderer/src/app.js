// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry (M1): boots the theme, the pan/zoom viewport, and mounts the
// sample forest scene so the ported render modules can be checked against the
// design mock. The real model/layout/persistence pipeline arrives in M2-M4.

import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountScene } from './render/scene.js'
import { SAMPLE_BOUNDS } from './render/sample-fixture.js'

initTheme(document.getElementById('mode'))

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
