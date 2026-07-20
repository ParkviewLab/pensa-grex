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
import { migrateForest } from './model/migrate.js'
import { buildForest } from './model/forest.js'
import { measureForest } from './layout/measure.js'
import { computeForestLayout } from './layout/layout.js'
import { createApi } from './bridge/api.js'
import { taskIdFromEvent } from './interaction/hittest.js'
import { openContextMenu, closeContextMenu } from './interaction/contextMenu.js'
import { promptText, chooseAction } from './ui/dialog.js'
import { createNoteEditor } from './notes/noteEditor.js'
import * as M from './model/mutations.js'
import { serializeProject } from './export/markdown.js'
import homelabFixtureRaw from './model/fixtures/homelab.forest.json5?raw'
import workFixtureRaw from './model/fixtures/work.forest.json5?raw'

initTheme(document.getElementById('mode'))

const viewportEl = document.getElementById('viewport')
const worldEl = document.getElementById('world')
const contentEl = document.getElementById('content')
const emptyEl = document.getElementById('empty')
const pctEl = document.getElementById('pct')
const domainSel = document.getElementById('domain')
const delDomainBtn = document.getElementById('deldomain')

const api = createApi()
let currentLayout = null
let currentRaw = null
let currentDomainPath = null
let currentDomainName = null
// Ids of collapsed project nodes: client-local view state, kept apart from the
// forest data (see docs/northstar.md axiom 8) and loaded per domain.
let collapsedSet = new Set()
// The in-session clipboard: a snapshot of a copied project (its subtree records
// and note contents), taken at copy time so it is independent of later edits and
// survives a domain switch. Renderer-local and non-persistent — it does not
// outlive the app, and never touches the forest data.
let clipboard = null

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

// A failed forest save must not be silent — the edit is on screen but not on
// disk. Surface it once (not once per retry) without tearing down the map.
let saveErrorOpen = false
api.onSaveError = async (msg) => {
  if (saveErrorOpen) return
  saveErrorOpen = true
  await chooseAction({
    title: 'Save failed',
    message: 'A change could not be saved to disk: ' + msg,
    actions: [{ label: 'OK', value: null }],
  })
  saveErrorOpen = false
}

// Flush pending debounced writes (forest and the open note) before the window
// closes, so an edit made within the debounce window is not lost on quit.
window.addEventListener('beforeunload', () => {
  api.flushSaves()
  noteEditor.flush()
})

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
delDomainBtn.addEventListener('click', () => deleteDomainFlow())
window.addEventListener('resize', () => viewport.fit())

// The delete button acts on the open domain, so it is disabled when none is open.
function updateDeleteButton() {
  delDomainBtn.disabled = !currentDomainPath
}
updateDeleteButton()

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
async function render(raw, { fit = true } = {}) {
  const forest = buildForest(pruneCollapsed(raw, collapsedSet))
  if (!forest.trees.length) {
    showEmpty('This domain has no tasks yet. Right-click the canvas to start a tree.')
    return
  }
  const { sizes } = await measureForest(forest)
  currentLayout = computeForestLayout(forest, sizes)
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
  await render(nextRaw, { fit: false })
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
  // Bring an older forest up to the current schema before validating; persist the
  // upgrade once, so migration happens on first open rather than on every load.
  const migrated = migrateForest(raw)
  raw = migrated.raw
  const validation = validateForest(raw)
  if (!validation.ok) {
    console.error('Forest failed validation:', validation.errors)
    showEmpty('“' + (name || path) + '” failed validation (see console)')
    return
  }
  currentRaw = raw
  currentDomainPath = path
  currentDomainName = name
  if (migrated.changed) await api.saveForest(path, JSON5.stringify(raw, null, 2))
  const vs = await api.getViewState(name)
  collapsedSet = new Set(Array.isArray(vs.collapsed) ? vs.collapsed : [])
  await api.setLastDomain(name)
  updateDeleteButton()
  await render(raw, { fit: true })
}

// A node is a root iff nothing points at it (no .next, no branch child). Roots
// are project nodes; nothing may be added below them and their kind is fixed.
function isRootId(raw, id) {
  for (const t of Object.values(raw.tasks)) {
    if (t.next === id) return false
    if ((t.branches || []).some((b) => b.child === id)) return false
  }
  return true
}

// Every id reachable from startId in raw (inclusive), following .next and branches.
function subtreeIdsOf(raw, startId) {
  const ids = new Set()
  const stack = [startId]
  while (stack.length) {
    const id = stack.pop()
    if (ids.has(id)) continue
    ids.add(id)
    const t = raw.tasks[id]
    if (!t) continue
    if (t.next) stack.push(t.next)
    for (const b of t.branches || []) stack.push(b.child)
  }
  return ids
}

// A view-only copy of raw with each collapsed project node kept as a leaf: its
// subtree removed and the node marked so the render draws it folded (its shadow).
// Collapse is client-local (docs/northstar.md axiom 8), so this never touches
// currentRaw or the saved forest; a collapsed id that is now a task is ignored.
function pruneCollapsed(raw, collapsed) {
  const ids = [...collapsed].filter((id) => raw.tasks[id] && raw.tasks[id].kind === 'project')
  if (!ids.length) return raw
  const remove = new Set()
  for (const id of ids) for (const d of subtreeIdsOf(raw, id)) if (d !== id) remove.add(d)
  const next = structuredClone(raw)
  for (const id of ids) {
    if (remove.has(id)) continue // this collapsed node is itself hidden inside another
    next.tasks[id].collapsed = true
    next.tasks[id].next = null
    next.tasks[id].branches = []
  }
  for (const d of remove) delete next.tasks[d]
  return next
}

// Fold or unfold a project node, persist the change to the client-local view
// state, and re-render in place.
function toggleCollapse(taskId) {
  if (collapsedSet.has(taskId)) collapsedSet.delete(taskId)
  else collapsedSet.add(taskId)
  if (currentDomainName) api.setViewState(currentDomainName, { collapsed: [...collapsedSet] })
  render(currentRaw, { fit: false })
}

// Read the note contents of a subtree into an { id: content } map, taken by value
// so it is a snapshot independent of later edits. Shared by copy and export.
async function collectSubtreeNotes(taskId) {
  const notes = {}
  for (const id of subtreeIdsOf(currentRaw, taskId)) {
    const rec = currentRaw.tasks[id]
    if (rec.note) {
      const r = await api.readNote(currentDomainPath, rec.note)
      notes[id] = (r && r.content) || ''
    }
  }
  return notes
}

// Snapshot a project's subtree (records and note contents) into the in-session
// clipboard. Taken by value at copy time, so it is unaffected by later edits or a
// domain switch; note text is read now rather than referenced by file.
async function copyProject(taskId) {
  const tasks = {}
  for (const id of subtreeIdsOf(currentRaw, taskId)) tasks[id] = structuredClone(currentRaw.tasks[id])
  clipboard = { rootId: taskId, tasks, notes: await collectSubtreeNotes(taskId) }
}

// Paste the clipboard into the open domain as a new tree: fresh ids, kept
// statuses, cleared here cursors, fresh note files. Notes are written first so
// the note dots resolve to real files once the pasted forest is rendered.
async function pasteTreeFlow() {
  if (!clipboard || !currentRaw) return
  const { next, notes } = M.pasteAsTree(currentRaw, clipboard)
  for (const n of notes) await api.writeNote(currentDomainPath, n.file, n.content)
  applyEdit(next)
}

// Export a project's subtree to a markdown outline the user saves where they
// choose. One-way: the file is a rendered copy, with no path back into the forest.
async function exportProjectFlow(taskId) {
  const notes = await collectSubtreeNotes(taskId)
  const md = serializeProject(currentRaw, taskId, notes)
  const base = (currentRaw.tasks[taskId].title || 'project').trim() || 'project'
  const res = await api.exportMarkdown(base + '.md', md)
  if (res && res.error) {
    await chooseAction({ title: 'Export failed', message: res.error, actions: [{ label: 'OK', value: null }] })
  }
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
  const isRoot = isRootId(currentRaw, taskId)
  const hasDescendants = !!task.next || (task.branches && task.branches.length > 0)
  let mode = 'subtree'
  if (isRoot && hasDescendants) {
    // Deleting a project's root deletes the whole project — a root has no splice.
    const confirm = await chooseAction({
      title: 'Delete “' + task.title + '”',
      message: 'Delete this whole project and everything in it?',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Delete project', value: 'subtree', kind: 'danger' },
      ],
    })
    if (confirm === null) return
  } else if (hasDescendants) {
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
  const isProject = task.kind === 'project'
  const isRoot = isRootId(currentRaw, taskId)
  const items = []

  if (!isProject) {
    const status = (label, value) => ({
      label, checked: task.status === value,
      onClick: () => applyEdit(M.setStatus(currentRaw, taskId, value)),
    })
    items.push({ label: 'Status', submenu: [
      status('To do', 'todo'),
      status('In progress', 'in-progress'),
      status('Completed', 'completed'),
      status('Cancelled', 'cancelled'),
    ] })
    items.push(task.here
      ? { label: 'Clear here', onClick: () => applyEdit(M.clearHere(currentRaw, taskId)) }
      : { label: 'Make here', onClick: () => applyEdit(M.makeHere(currentRaw, taskId)) })
  }
  // A root is always a project node, so its kind cannot be changed.
  if (!isRoot) {
    items.push(isProject
      ? { label: 'Make task', onClick: () => applyEdit(M.convertKind(currentRaw, taskId)) }
      : { label: 'Make sub-project', onClick: () => applyEdit(M.convertKind(currentRaw, taskId)) })
  }
  // Collapse/expand folds a project node's subtree (client-local view state).
  if (isProject) {
    items.push(collapsedSet.has(taskId)
      ? { label: 'Expand', onClick: () => toggleCollapse(taskId) }
      : { label: 'Collapse', onClick: () => toggleCollapse(taskId) })
    // Copy the project's subtree for pasting as a new tree, here or in another domain.
    items.push({ label: 'Copy', onClick: () => copyProject(taskId) })
    // Export the project's subtree to a markdown outline (one-way).
    items.push({ label: 'Export to Markdown…', onClick: () => exportProjectFlow(taskId) })
  }
  items.push({ label: 'Rename…', onClick: () => renameTask(taskId) })
  items.push({ separator: true })
  items.push({ label: 'Add task above', onClick: () => addTaskFlow('above', taskId) })
  // Nothing may be added below a root node (a project's base).
  if (!isRoot) items.push({ label: 'Add task below', onClick: () => addTaskFlow('below', taskId) })
  items.push({ label: 'Add branch above', onClick: () => addBranchFlow('above', taskId) })
  if (!isRoot) items.push({ label: 'Add branch below', onClick: () => addBranchFlow('below', taskId) })
  items.push({ separator: true })
  items.push({ label: 'Edit note…', onClick: () => openNote(taskId) })
  items.push({ separator: true })
  items.push({ label: 'Delete…', onClick: () => deleteTaskFlow(taskId) })

  openContextMenu(x, y, items)
}

function openCanvasMenu(x, y) {
  const items = [{ label: 'New tree…', onClick: () => addTreeFlow() }]
  // Paste a previously copied project as a new tree in this domain.
  if (clipboard) items.push({ label: 'Paste as new tree', onClick: () => pasteTreeFlow() })
  openContextMenu(x, y, items)
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

async function deleteDomainFlow() {
  if (!currentDomainPath) return
  const path = currentDomainPath
  const name = domainSel.selectedOptions[0]?.textContent || 'this domain'
  const choice = await chooseAction({
    title: 'Delete “' + name + '”',
    message: 'Move “' + name + '” and all its notes to the Trash? You can restore them from the Trash.',
    actions: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'delete', kind: 'danger' }],
  })
  if (choice !== 'delete') return

  noteEditor.close()
  closeContextMenu()
  api.cancelPendingSave(path) // a queued save must not re-create the trashed forest
  const res = await api.deleteForest(path)
  if (res.error) {
    await chooseAction({ title: 'Could not delete domain', message: res.error, actions: [{ label: 'OK', value: null }] })
    return
  }

  const domains = await api.listDomains()
  if (!domains.length) {
    currentDomainPath = null
    currentRaw = null
    await api.setLastDomain(null)
    populateSwitcher([], null)
    updateDeleteButton()
    showEmpty('No domains. Use “New domain…” in the switcher to create one.')
    return
  }
  const next = domains[0]
  populateSwitcher(domains, next.path)
  await openDomain(next.path, next.name)
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
