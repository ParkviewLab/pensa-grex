// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry: boots the theme and the pan/zoom viewport, loads a real
// forest from disk over the persistence bridge (bridge/api.js → preload →
// main/store.js), and — as of M5 — edits it through a right-click menu. Every
// edit runs a pure mutation (model/mutations.js) on the raw forest, is
// re-validated, then re-rendered in place and saved (debounced). On first run
// it seeds the two bundled sample domains; the header switcher reopens the
// last-used domain across restarts.

import JSON5 from 'json5'
import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountLayout } from './render/scene.js'
import { validateForest } from './model/validate.js'
import { buildForest } from './model/forest.js'
import { measureForest } from './layout/measure.js'
import { computeForestLayout } from './layout/layout.js'
import { createApi } from './bridge/api.js'
import { taskIdFromEvent } from './interaction/hittest.js'
import { openContextMenu, closeContextMenu } from './interaction/contextMenu.js'
import { promptText, chooseAction } from './ui/dialog.js'
import { createNoteEditor } from './notes/noteEditor.js'
import * as M from './model/mutations.js'
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
let currentRaw = null
let currentDomainPath = null

// The note editor records a task's note filename on its first non-empty save, so
// the note dot appears and the name is persisted in the forest.
const noteEditor = createNoteEditor({
  readNote: (dir, file) => api.readNote(dir, file),
  writeNote: (dir, file, text) => api.writeNote(dir, file, text),
  openExternal: (url) => api.openExternal(url),
  onFirstWrite: (taskId, file) => {
    const t = currentRaw && currentRaw.tasks[taskId]
    if (t && !t.note) applyEdit(M.setNote(currentRaw, taskId, file))
  },
})

function openNote(taskId) {
  const t = currentRaw && currentRaw.tasks[taskId]
  if (t) noteEditor.open(t, currentDomainPath)
}

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
domainSel.addEventListener('change', () => {
  if (domainSel.value === NEW_DOMAIN) { createDomainFlow(); return }
  openDomain(domainSel.value, domainSel.selectedOptions[0]?.textContent)
})
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

// Draw a runtime forest. On edits, fit is false so the map does not jump under
// the user's pan/zoom; on opening a domain it frames the whole forest.
async function render(forest, { fit = true } = {}) {
  if (!forest.trees.length) {
    showEmpty('This domain has no tasks yet. Right-click the canvas to start a tree.')
    return
  }
  const { sizes, titleSizes } = await measureForest(forest)
  currentLayout = computeForestLayout(forest, sizes, titleSizes)
  mountLayout(contentEl, currentLayout, forest)
  if (emptyEl) emptyEl.style.display = 'none'
  if (fit) viewport.fit()
}

// Apply a pure mutation result: reject it if it breaks an invariant, otherwise
// adopt it, re-render in place, and persist (debounced).
async function applyEdit(nextRaw) {
  const v = validateForest(nextRaw)
  if (!v.ok) {
    console.error('edit rejected — would break an invariant:', v.errors)
    return
  }
  currentRaw = nextRaw
  await render(buildForest(nextRaw), { fit: false })
  api.saveForestDebounced(currentDomainPath, JSON5.stringify(nextRaw, null, 2))
}

async function openDomain(path, name) {
  if (!path) return
  closeContextMenu()
  noteEditor.close()
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
  currentRaw = raw
  currentDomainPath = path
  await api.setLastDomain(name)
  await render(buildForest(raw), { fit: true })
}

// ---- editing flows (each dialog runs after the menu has closed) ----

async function renameTask(taskId) {
  const title = await promptText({ title: 'Rename task', label: 'Title', value: currentRaw.tasks[taskId].title })
  if (title === null) return
  applyEdit(M.setTitle(currentRaw, taskId, title))
}

async function addTaskFlow(dir, taskId) {
  const title = await promptText({ title: 'Add task ' + dir, label: 'Title', value: '' })
  if (title === null) return
  applyEdit(dir === 'above' ? M.addTaskAbove(currentRaw, taskId, title) : M.addTaskBelow(currentRaw, taskId, title))
}

async function addBranchFlow(dir, taskId) {
  const title = await promptText({ title: 'Add branch ' + dir, label: 'Title', value: '' })
  if (title === null) return
  applyEdit(dir === 'above' ? M.addBranchAbove(currentRaw, taskId, title) : M.addBranchBelow(currentRaw, taskId, title))
}

async function deleteTaskFlow(taskId) {
  const task = currentRaw.tasks[taskId]
  const hasDescendants = !!task.next || (task.branches && task.branches.length > 0)
  let mode = 'subtree'
  if (hasDescendants) {
    mode = await chooseAction({
      title: 'Delete “' + task.title + '”',
      message: 'This task has tasks growing from it. Remove the whole subtree, or keep them by splicing the task above onto the one below?',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Splice (keep above)', value: 'splice' },
        { label: 'Remove subtree', value: 'subtree', kind: 'danger' },
      ],
    })
    if (mode === null) return
  }
  applyEdit(M.deleteTask(currentRaw, taskId, mode))
}

async function addTreeFlow() {
  const name = await promptText({ title: 'New tree', label: 'Tree name', value: '' })
  if (name === null) return
  applyEdit(M.addTree(currentRaw, name))
}

function openTaskMenu(x, y, taskId) {
  const task = currentRaw.tasks[taskId]
  const status = (label, value) => ({
    label, checked: task.status === value,
    onClick: () => applyEdit(M.setStatus(currentRaw, taskId, value)),
  })
  openContextMenu(x, y, [
    { label: 'Status', submenu: [
      status('To do', 'todo'),
      status('In progress', 'in-progress'),
      status('Completed', 'completed'),
      status('Cancelled', 'cancelled'),
    ] },
    task.here
      ? { label: 'Clear here', onClick: () => applyEdit(M.clearHere(currentRaw, taskId)) }
      : { label: 'Make here', onClick: () => applyEdit(M.makeHere(currentRaw, taskId)) },
    { label: 'Rename…', onClick: () => renameTask(taskId) },
    { separator: true },
    { label: 'Add task above', onClick: () => addTaskFlow('above', taskId) },
    { label: 'Add task below', onClick: () => addTaskFlow('below', taskId) },
    { label: 'Add branch above', onClick: () => addBranchFlow('above', taskId) },
    { label: 'Add branch below', onClick: () => addBranchFlow('below', taskId) },
    { separator: true },
    { label: 'Edit note…', onClick: () => openNote(taskId) },
    { separator: true },
    { label: 'Delete…', onClick: () => deleteTaskFlow(taskId) },
  ])
}

function openCanvasMenu(x, y) {
  openContextMenu(x, y, [{ label: 'New tree…', onClick: () => addTreeFlow() }])
}

viewportEl.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (!currentRaw) return
  const taskId = taskIdFromEvent(e)
  if (taskId && currentRaw.tasks[taskId]) openTaskMenu(e.clientX, e.clientY, taskId)
  else openCanvasMenu(e.clientX, e.clientY)
})

// Double-clicking a task label opens its note (the same as Edit note).
viewportEl.addEventListener('dblclick', (e) => {
  if (!currentRaw) return
  const taskId = taskIdFromEvent(e)
  if (taskId && currentRaw.tasks[taskId]) openNote(taskId)
})

const NEW_DOMAIN = '__new__'

function populateSwitcher(domains, selectedPath) {
  domainSel.innerHTML = ''
  for (const d of domains) {
    const opt = document.createElement('option')
    opt.value = d.path
    opt.textContent = d.name
    if (d.path === selectedPath) opt.selected = true
    domainSel.appendChild(opt)
  }
  const sep = document.createElement('option')
  sep.disabled = true
  sep.textContent = '──────────'
  domainSel.appendChild(sep)
  const create = document.createElement('option')
  create.value = NEW_DOMAIN
  create.textContent = 'New domain…'
  domainSel.appendChild(create)
  // Never disabled: the New entry must stay reachable even with one domain.
  domainSel.disabled = false
}

// Reset the switcher to the open domain after a New that was cancelled or failed
// (the selection is left on the New entry otherwise).
function restoreSwitcher() {
  if (currentDomainPath) domainSel.value = currentDomainPath
}

async function createDomainFlow() {
  const name = await promptText({ title: 'New domain', label: 'Domain name', value: '' })
  if (name === null) { restoreSwitcher(); return }
  const res = await api.createForest(name)
  if (res.error) {
    await chooseAction({ title: 'Could not create domain', message: res.error, actions: [{ label: 'OK', value: null }] })
    restoreSwitcher()
    return
  }
  const domains = await api.listDomains()
  populateSwitcher(domains, res.path)
  await openDomain(res.path, res.name)
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
