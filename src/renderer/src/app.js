// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry: boots the theme and the pan/zoom viewport, then loads a real
// forest from disk over the persistence bridge (bridge/api.js → preload →
// main/store.js). On first run — an empty library — it seeds the two bundled
// sample domains so there is something to show and something already persisted.
// The domain switcher in the header lists every domain and reopens the last one
// used across restarts. The pipeline downstream of parsing is unchanged from
// M3: parse → validate → build → measure → layout → render.

import JSON5 from 'json5'
import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountLayout } from './render/scene.js'
import { validateForest } from './model/validate.js'
import { buildForest } from './model/forest.js'
import { measureForest } from './layout/measure.js'
import { computeForestLayout } from './layout/layout.js'
import { createApi } from './bridge/api.js'
import homelabFixtureRaw from './model/fixtures/homelab.forest.json5?raw'
import workFixtureRaw from './model/fixtures/work.forest.json5?raw'

initTheme(document.getElementById('mode'))

const viewportEl = document.getElementById('viewport')
const worldEl = document.getElementById('world')
const contentEl = document.getElementById('content')
const emptyEl = document.getElementById('empty')
const pctEl = document.getElementById('pct')
const domainSel = document.getElementById('domain')

const api = createApi()
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
domainSel.addEventListener('change', () => openDomain(domainSel.value, domainSel.selectedOptions[0]?.textContent))
window.addEventListener('resize', () => viewport.fit())

function showEmpty(message) {
  contentEl.innerHTML = ''
  currentLayout = null
  if (emptyEl) {
    emptyEl.textContent = message
    emptyEl.style.display = ''
  }
}

// Seed the two bundled sample domains into a fresh, empty library so the app
// opens onto real, persisted data on first run. Best-effort: a create that
// collides (a domain already there) is skipped, not fatal.
async function seedSamples() {
  const samples = [
    { name: 'HomeLab', raw: homelabFixtureRaw },
    { name: 'Work', raw: workFixtureRaw },
  ]
  for (const { name, raw } of samples) {
    const created = await api.createForest(name)
    if (created.error) continue
    await api.saveForest(created.path, raw)
    if (name === 'HomeLab') {
      await api.writeNote(created.path, 'k_plex.md',
        '# Fix Plex transcoding\n\nHardware transcoding is not kicking in on 4K HEVC.\n\n- [ ] Confirm the GPU is passed through to the container\n- [ ] Check the Plex transcoder logs\n')
    }
  }
}

async function render(forest) {
  if (!forest.trees.length) {
    showEmpty('This domain has no tasks yet')
    return
  }
  const { sizes, titleSizes } = await measureForest(forest)
  currentLayout = computeForestLayout(forest, sizes, titleSizes)
  mountLayout(contentEl, currentLayout, forest)
  if (emptyEl) emptyEl.style.display = 'none'
  viewport.fit()
}

async function openDomain(path, name) {
  if (!path) return
  const res = await api.loadForest(path)
  if (res.error) {
    showEmpty('Could not open “' + (name || path) + '”: ' + res.error)
    return
  }
  let raw
  try {
    raw = JSON5.parse(res.text)
  } catch (e) {
    showEmpty('“' + (name || path) + '” is not valid JSON5: ' + e.message)
    return
  }
  const validation = validateForest(raw)
  if (!validation.ok) {
    console.error('Forest failed validation:', validation.errors)
    showEmpty('“' + (name || path) + '” failed validation (see console)')
    return
  }
  await api.setLastDomain(name)
  await render(buildForest(raw))
  console.log('Opened', name, '—', currentLayout ? currentLayout.junctions.length + ' junctions' : 'empty')
}

function populateSwitcher(domains, selectedPath) {
  domainSel.innerHTML = ''
  for (const d of domains) {
    const opt = document.createElement('option')
    opt.value = d.path
    opt.textContent = d.name
    if (d.path === selectedPath) opt.selected = true
    domainSel.appendChild(opt)
  }
  domainSel.disabled = domains.length <= 1
}

async function boot() {
  const settings = await api.getSettings()
  let domains = await api.listDomains()
  if (!domains.length) {
    await seedSamples()
    domains = await api.listDomains()
  }
  if (!domains.length) {
    showEmpty('No forest library found')
    return
  }
  const last = domains.find((d) => d.name === settings.lastDomain) || domains[0]
  populateSwitcher(domains, last.path)
  await openDomain(last.path, last.name)
}

boot()
