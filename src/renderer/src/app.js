// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Renderer entry: boots the theme and the pan/zoom viewport, opens a domain
// through the main-process task authority (bridge/api.js → preload →
// main/taskService.js), and edits it through a right-click menu. Each edit is a
// named task operation the main process runs over the shared model — mutate,
// re-validate, persist atomically — returning the new record, which the renderer
// adopts and re-renders in place. On first run it seeds the two bundled sample
// domains; the header switcher reopens the last-used domain across restarts.

import { initTheme } from './theme/theme.js'
import { createViewport } from './interaction/viewport.js'
import { mountLayout } from './render/scene.js'
import { renderCards } from './render/shapes.js'
import { buildModel } from '../../shared/model/model.js'
import { clipNodes, wrapCandidates } from '../../shared/model/mutations.js'
import { branchChildrenOf, isPlanClose, branchesIn, indexRecord, mergeErrors, pairScopes, trunksOf, scopeOf, extentOf, reachableFrom } from '../../shared/model/validate.js'
import { gapAt, carryAt } from './interaction/gapZones.js'
import { measureDomain } from './layout/measure.js'
import { computeDomainLayout } from './layout/layout.js'
import { createApi } from './bridge/api.js'
import { nodeIdFromEvent } from './interaction/hittest.js'
import { createDragController } from './interaction/drag.js'
import { centeredStationId, anchorChain, resolveAnchor } from './interaction/bookmarks.js'
import { openContextMenu, closeContextMenu } from './interaction/contextMenu.js'
import { promptText, chooseAction } from './ui/dialog.js'
import { createNoteEditor } from './notes/noteEditor.js'
import { serializeProject } from '../../shared/export/markdown.js'
import homelabFixtureRaw from '../../shared/model/fixtures/homelab.record.json?raw'
import workFixtureRaw from '../../shared/model/fixtures/work.record.json?raw'

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
let currentRecord = null
let currentDomainPath = null
let currentDomainName = null
// Ids of collapsed project nodes: client-local view state, kept apart from the
// record (see docs/northstar.md axiom 9) and loaded per domain.
let collapsedSet = new Set()
// The in-session clipboard: a snapshot of a copied project (its subtree records
// and note contents), taken at copy time so it is independent of later edits and
// survives a domain switch. Renderer-local and non-persistent — it does not
// outlive the app, and never touches the record.
let clipboard = null
// The domain's saved bookmarks (a named view: collapse set, zoom, node-anchored
// camera). Shared with the domain data (northstar axiom 9), loaded per domain.
let bookmarks = []

// The note editor records a task's note filename on its first non-empty save, so
// the note dot appears and the name is persisted in the record.
const noteEditor = createNoteEditor({
  readNote: (dir, file) => api.readNote(dir, file),
  writeNote: (dir, file, text) => api.writeNote(dir, file, text),
  openExternal: (url) => api.openExternal(url),
  onFirstWrite: (nodeId, file) => {
    const t = currentRecord && currentRecord.nodes[nodeId]
    if (t && !t.note) applyOp('setNote', nodeId, file)
  },
  // Surfaced when an external writer changes or removes the note being edited.
  notify: (msg) => { chooseAction({ title: 'Note', message: msg, actions: [{ label: 'OK', value: null }] }) },
})

// The header's label: a node's own title, or for a close the pair it ends, which is the one
// kind with nothing of its own to show.
function noteLabel(node) {
  if (node.kind !== 'terminus') return node.title
  const opened = pairScopes(currentRecord, trunksOf(currentRecord)).closes.get(node.id)
  const of = opened && currentRecord.nodes[opened] ? currentRecord.nodes[opened].title : null
  return of ? 'the close of “' + of + '”' : 'a close'
}

function openNote(nodeId) {
  const t = currentRecord && currentRecord.nodes[nodeId]
  if (t) noteEditor.open(t, currentDomainPath, noteLabel(t))
}

// A failed edit must not be silent — the change is on screen but the authority
// refused it (a broken invariant) or could not write it (a disk error). Surface
// it once (not once per repeat) without tearing down the map.
let editErrorOpen = false
async function reportEditError(msg) {
  if (editErrorOpen) return
  editErrorOpen = true
  await chooseAction({
    title: 'Change not saved',
    message: 'A change could not be applied: ' + msg,
    actions: [{ label: 'OK', value: null }],
  })
  editErrorOpen = false
}

// Record edits persist synchronously through the task authority, so only the
// open note — still autosaved on a debounce — needs a flush before the window
// closes, lest an edit made within its debounce window be lost on quit.
window.addEventListener('beforeunload', () => {
  noteEditor.flush()
})

const viewport = createViewport({
  viewportEl, worldEl, pctEl,
  getBounds: () => currentLayout?.bounds || { w: 0, h: 0 },
})

// Drag-and-drop. Dropping a node onto a card grafts it there as a fork (a task
// moves alone; a project moves its whole subtree); dropping it into the gap
// between two nodes on a line splices it into that gap; a sub-project on empty
// canvas detaches into its own tree; a root on empty canvas reorders the trees by
// where it lands; a task on empty canvas is refused. Hit-testing is geometric
// against the layout, so it needs no DOM probe and works over the empty gaps too.
// See model/mutations.js and docs/interaction_model.md.
createDragController({
  contentEl, viewportEl,
  onProbe: (source, cx, cy) => renderDropHint(resolveDrop(source, cx, cy)),
  onCancel: () => clearDropHint(),
  onDrop: (source, cx, cy) => {
    const intent = resolveDrop(source, cx, cy)
    clearDropHint()
    applyDropIntent(source, intent)
  },
})

// A drag's source is a card or a junction handle; each resolves its own intents.
function resolveDrop(source, cx, cy) {
  return source.type === 'node' ? resolveDropIntent(source.id, cx, cy) : resolveJunctionIntent(source, cx, cy)
}

document.getElementById('fit').addEventListener('click', () => viewport.fit())
document.getElementById('zin').addEventListener('click', () => {
  viewport.zoomAt(1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})
document.getElementById('zout').addEventListener('click', () => {
  viewport.zoomAt(1 / 1.2, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2)
})

// "Show only flagged" read-only view: a client-local toggle (never written to the
// record, per northstar axiom 9). The class on the content element hides everything
// but flagged cards and makes cards non-interactive (which also disables drag, since
// drag.js resolves its source from the pointer's DOM target); the context menu is
// gated separately so no canvas-level edit (e.g. Paste as new tree) is reachable.
let flaggedOnly = false
const flagFilterBtn = document.getElementById('flagfilter')
flagFilterBtn.addEventListener('click', () => {
  flaggedOnly = !flaggedOnly
  contentEl.classList.toggle('flagged-only', flaggedOnly)
  flagFilterBtn.setAttribute('aria-pressed', String(flaggedOnly))
  // Hiding a card takes its box away, so a card revealed by turning the filter off has
  // no silhouette to show until it is measured again. Repainting the cards is enough:
  // it touches no coordinate, so the camera and the layout stand as they are.
  renderCards(contentEl)
})
domainSel.addEventListener('change', () => {
  if (domainSel.value === NEW_DOMAIN) { createDomainFlow(); return }
  openDomain(domainSel.value, domainSel.selectedOptions[0]?.textContent)
})
delDomainBtn.addEventListener('click', () => deleteDomainFlow())

// ---- MCP server status indicator (header) ----
// A dot (teal running, muted off, orange on error) plus a menu to copy the
// endpoint URL and turn the server on or off. The server itself lives in the
// main process; this only reflects and toggles it.
const mcpBtn = document.getElementById('mcp')
const mcpDot = document.getElementById('mcpdot')
let mcpState = null

async function refreshMcp() {
  mcpState = await api.mcpStatus()
  const s = mcpState || {}
  mcpDot.className = 'mcp-dot' + (s.error ? ' err' : s.running ? ' on' : '')
  mcpBtn.title = [
    'MCP server',
    s.running ? 'running at ' + s.url : (s.enabled ? 'starting…' : 'off'),
    s.scope ? 'scope: ' + s.scope : null,
    s.error ? 'error: ' + s.error : null,
  ].filter(Boolean).join(' · ')
}

async function copyMcpUrl(url) {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    await chooseAction({ title: 'MCP endpoint', message: url, actions: [{ label: 'OK', value: null }] })
  }
}

mcpBtn.addEventListener('click', async () => {
  await refreshMcp()
  const s = mcpState || {}
  const items = [{ label: (s.running ? '● ' : '○ ') + (s.url || 'unavailable'), disabled: true }, { separator: true }]
  if (s.url) items.push({ label: 'Copy endpoint URL', onClick: () => copyMcpUrl(s.url) })
  items.push({
    label: s.enabled ? 'Turn off' : 'Turn on',
    onClick: async () => { await api.mcpSetEnabled(!s.enabled); await refreshMcp() },
  })
  const r = mcpBtn.getBoundingClientRect()
  openContextMenu(r.left, r.bottom + 4, items)
})

refreshMcp()
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
    { name: 'HomeLab', record: homelabFixtureRaw },
    { name: 'Work', record: workFixtureRaw },
  ]
  for (const { name, record } of samples) {
    const created = await api.createDomain(name)
    if (created.error) continue
    await api.saveDomainFile(created.path, record)
    if (name === 'HomeLab') {
      await api.writeNote(created.path, 'k_plex.md',
        '# Fix Plex transcoding\n\nHardware transcoding is not kicking in on 4K HEVC.\n\n- [ ] Confirm the GPU is passed through to the container\n- [ ] Check the Plex transcoder logs\n')
    }
  }
}

// Draw a runtime model. On edits, fit is false so the map does not jump under
// the user's pan/zoom; on opening a domain it frames the whole of it.
async function render(record, { fit = true } = {}) {
  const model = buildModel(pruneCollapsed(record, collapsedSet))
  if (!model.plans.length) {
    showEmpty('This domain has no tasks yet. Right-click the canvas to start a tree.')
    return
  }
  const { sizes } = await measureDomain(model)
  currentLayout = computeDomainLayout(model, sizes)
  mountLayout(contentEl, currentLayout, model)
  if (emptyEl) emptyEl.style.display = 'none'
  if (fit) viewport.fit()
}

// Apply one task operation through the main-process authority: it runs the pure
// mutation over the on-disk record, re-validates, and persists atomically, then
// returns the new record, which we adopt and re-render in place. A refused edit
// (a broken invariant) or a failed write comes back as an error we surface.
async function applyOp(op, ...args) {
  const res = await api.runOp(currentDomainPath, op, ...args)
  if (res.error) {
    console.error(`edit rejected (${op}):`, res.error)
    reportEditError(res.error)
    return
  }
  currentRecord = res.record
  await render(currentRecord, { fit: false })
}

async function openDomain(path, name) {
  if (!path) return
  closeContextMenu()
  noteEditor.close()
  // Main parses, migrates (persisting the upgrade once), and validates; the
  // renderer receives the authoritative record and renders it.
  const res = await api.readRecord(path)
  if (res.error) {
    showEmpty('Could not open “' + (name || path) + '”: ' + res.error)
    return
  }
  currentRecord = res.record
  currentDomainPath = path
  currentDomainName = name
  const vs = await api.getViewState(name)
  collapsedSet = new Set(Array.isArray(vs.collapsed) ? vs.collapsed : [])
  const bm = await api.getBookmarks(path)
  bookmarks = parseBookmarks(bm && bm.text)
  await api.setLastDomain(name)
  updateDeleteButton()
  await render(currentRecord, { fit: true })
}

// Bookmarks cross the bridge as text (the renderer owns the JSON shape); a missing
// or unreadable file yields no bookmarks rather than an error the user must clear.
function parseBookmarks(text) {
  if (!text) return []
  try {
    const data = JSON.parse(text)
    return Array.isArray(data.bookmarks) ? data.bookmarks : []
  } catch {
    return []
  }
}

async function persistBookmarks() {
  if (currentDomainPath) await api.setBookmarks(currentDomainPath, JSON.stringify({ bookmarks }, null, 2))
}

// A node is a root iff nothing points at it (no .next, no branch child). Roots
// are project nodes; nothing may be added below them and their kind is fixed.
function isRootId(record, id) {
  for (const t of Object.values(record.nodes)) {
    if (t.next === id) return false
    if (branchChildrenOf(t).some((b) => b.child === id)) return false
  }
  return true
}

// The index a dragged root should take when dropped on empty canvas at clientX:
// the count of the OTHER roots whose on-screen centre lies left of the drop. The
// roots are laid out left to right in the same order reorderRoot canonicalises to,
// so this is a meaningful insertion index.
function rootDropIndex(sourceId, clientX) {
  let index = 0
  for (const id of Object.keys(currentRecord.nodes)) {
    if (id === sourceId || !isRootId(currentRecord, id)) continue
    const el = contentEl.querySelector('[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]')
    if (!el) continue
    const r = el.getBoundingClientRect()
    if ((r.left + r.right) / 2 < clientX) index++
  }
  return index
}

function nodeSel(id) {
  return '[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'
}

// The world-space point under a client coordinate, inverting the viewport's
// translate+scale so a drag can be hit-tested against the (world-space) layout.
function clientToWorld(clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect()
  const { scale, tx, ty } = viewport.getTransform()
  return { wx: (clientX - rect.left - tx) / scale, wy: (clientY - rect.top - ty) / scale }
}

// What a drag over (clientX, clientY) means for `sourceId`, resolved geometrically
// against the current layout. Returns one of {kind:'fork', targetId},
// {kind:'insert', belowId, caret:{x,y}}, {kind:'reorder', index}, {kind:'detach'},
// or {kind:'none'}. A card takes precedence over a gap; a gap over empty canvas.
function resolveDropIntent(sourceId, clientX, clientY) {
  if (!currentRecord || !currentLayout) return { kind: 'none' }
  const src = currentRecord.nodes[sourceId]
  if (!src) return { kind: 'none' }
  // A scope's close is not movable: it is one half of a pair, and it sits where the
  // scope ends. Moving the scope means moving its project node, which carries it.
  if (src.kind === 'terminus') return { kind: 'none' }
  const { wx, wy } = clientToWorld(clientX, clientY)
  // What will travel, which is what may not be dropped onto: a project node carries its
  // scope and no more (validate.js, extentOf). A task travels alone, so its guard is only
  // ever conservative, and it is left as it was.
  const sub = src.kind === 'project' ? extentOf(currentRecord, sourceId) : reachableFrom(currentRecord, sourceId)

  // 1. Over a card -> fork (never the source itself or a node inside its subtree).
  const onCard = currentLayout.stations.find((s) =>
    wx >= s.x - s.cardW / 2 && wx <= s.x + s.cardW / 2 && wy >= s.cardTop && wy <= s.cardTop + s.cardH)
  if (onCard) {
    if (onCard.id === sourceId || sub.has(onCard.id)) return { kind: 'none' }
    // A fork hangs on the edge rising from its target, and two positions have no such
    // edge: a plan's close, and the top of a branch trunk, whose upper neighbour is that
    // branch's own return line rather than a trunk edge. Both are the same rule, that a
    // node with nothing above it on its trunk cannot host a branch.
    if (isPlanClose(currentRecord, onCard.id) || !currentRecord.nodes[onCard.id].next) return { kind: 'none' }
    return { kind: 'fork', targetId: onCard.id }
  }

  // 2. Over a line gap -> insert, the gap read as the ordered run it is: the junctions
  // in it (departures of branches hanging on the node below, arrivals of returns merging
  // there) divide it, and the drop's position among them says which junctions the moved
  // node lands below. Those follow it up as the op's carry, so the record ends looking
  // the way the drop looked. A drop that would change nothing — the node spliced where
  // it already sits, no junction crossed — resolves to nothing, so no caret promises an
  // edit that is not one (geometry in interaction/gapZones.js).
  const gap = gapAt(currentRecord, currentLayout.stations, wx, wy)
  if (gap) {
    const pid = gap.belowId
    if (pid === sourceId) return { kind: 'none' }
    if (src.kind === 'project' && sub.has(pid)) return { kind: 'none' }
    const { branchFeet, mergeFeet, caretY } = carryAt(currentRecord, currentLayout.junctions, gap, wy, sourceId)
    const carries = branchFeet.length || mergeFeet.length
    if (!carries && currentRecord.nodes[pid].next === sourceId) return { kind: 'none' }
    return {
      kind: 'insert', belowId: pid,
      carry: carries ? { branchFeet, mergeFeet } : null,
      caret: { x: gap.x, y: caretY },
    }
  }

  // 3. Empty canvas: a sub-project detaches, a root reorders, a task is refused.
  if (src.kind !== 'project') return { kind: 'none' }
  if (isRootId(currentRecord, sourceId)) return { kind: 'reorder', index: rootDropIndex(sourceId, clientX) }
  return { kind: 'detach' }
}

// A junction dragged along the trunk: the same reorder read from the other side. The
// handle names one branch by its foot; the target is a whole gap, named by the node
// below it; the edit is setBranchPoint for a departure, setMergePoint for an arrival.
// Offered only where the merge rules accept the candidate (the same filter the two menu
// items use), so an illegal target simply shows no hint: the refusals Gary settled — a
// branch point never strictly above its own merge, a merge never strictly below its own
// branch point, neither across a scope boundary — are mergeErrors' own clauses.
function resolveJunctionIntent(source, clientX, clientY) {
  if (!currentRecord || !currentLayout) return { kind: 'none' }
  const branch = branchesIn(currentRecord).find((b) => b.footId === source.footId)
  if (!branch) return { kind: 'none' }
  const { wx, wy } = clientToWorld(clientX, clientY)
  const gap = gapAt(currentRecord, currentLayout.stations, wx, wy)
  if (!gap) return { kind: 'none' }
  const pid = gap.belowId
  const already = source.type === 'fork' ? branch.hostId : branch.mergePoint
  if (pid === already) return { kind: 'none' }
  const candidate = source.type === 'fork' ? { ...branch, hostId: pid } : { ...branch, mergePoint: pid }
  if (mergeErrors(currentRecord, candidate, indexRecord(currentRecord)).length) return { kind: 'none' }
  return {
    kind: source.type === 'fork' ? 'set-branch-point' : 'set-merge-point',
    footId: branch.footId, targetId: pid,
    caret: { x: gap.x, y: (gap.yTop + gap.yBot) / 2 },
  }
}

let dropHint = { caret: null, cardId: null }

function clearDropHint() {
  if (dropHint.caret) { dropHint.caret.remove(); dropHint.caret = null }
  if (dropHint.cardId) {
    const el = contentEl.querySelector(nodeSel(dropHint.cardId))
    if (el) el.classList.remove('drop-target')
    dropHint.cardId = null
  }
}

// Draw the hint for a resolved intent: a ring on the fork target, or a caret across
// the gap (an insertion's sub-gap, or the gap a dragged junction would land in).
// Nothing is drawn for detach/reorder/none.
function renderDropHint(intent) {
  clearDropHint()
  if (!intent) return
  if (intent.kind === 'fork') {
    const el = contentEl.querySelector(nodeSel(intent.targetId))
    if (el) { el.classList.add('drop-target'); dropHint.cardId = intent.targetId }
  } else if (intent.caret) {
    const caret = document.createElement('div')
    caret.className = 'insert-caret'
    caret.style.left = intent.caret.x + 'px'
    caret.style.top = intent.caret.y + 'px'
    contentEl.appendChild(caret)
    dropHint.caret = caret
  }
}

// Apply a resolved drop intent as a task op. The authority re-validates every
// op, so a stale or degenerate drop is rejected there and surfaced, rather than
// corrupting the record.
function applyDropIntent(source, intent) {
  if (!currentRecord || !intent) return
  if (intent.kind === 'set-branch-point') { applyOp('setBranchPoint', intent.footId, intent.targetId); return }
  if (intent.kind === 'set-merge-point') { applyOp('setMergePoint', intent.footId, intent.targetId); return }
  if (source.type !== 'node') return
  const sourceId = source.id
  const node = currentRecord.nodes[sourceId]
  if (!node) return
  if (intent.kind === 'fork') {
    applyOp(node.kind === 'project' ? 'moveSubtree' : 'moveTaskNode', sourceId, intent.targetId)
  } else if (intent.kind === 'insert') {
    if (intent.carry) applyOp('moveIntoLine', sourceId, intent.belowId, intent.carry)
    else applyOp('moveIntoLine', sourceId, intent.belowId)
  } else if (intent.kind === 'reorder') {
    applyOp('reorderRoot', sourceId, intent.index)
  } else if (intent.kind === 'detach') {
    applyOp('detachProject', sourceId)
  }
}

// A view-only copy of the record in which each collapsed project node keeps its own
// close and loses what lies between them: the fold hides the scope's body, and the
// trunk above the close carries on untouched. The pair is then drawn flush, one card
// on the other (layout/geometry.js), so a shut scope reads as a single closed object.
//
// Collapse is client-local (docs/northstar.md axiom 9), so this never touches
// currentRecord or the saved record; a collapsed id that is now a task is ignored.
// The scope's extent comes from scopeOf, which matches brackets rather than following
// `next` to the top of the trunk: that unbounded walk is what used to take the rest of
// the plan, the enclosing plan's own terminus included.
function pruneCollapsed(record, collapsed) {
  const ids = [...collapsed].filter((id) => record.nodes[id] && record.nodes[id].kind === 'project')
  if (!ids.length) return record
  const { pairs } = pairScopes(record, trunksOf(record))
  const scopes = new Map()
  const remove = new Set()
  for (const id of ids) {
    const scope = scopeOf(record, id, pairs)
    if (!scope) continue
    scopes.set(id, scope)
    for (const d of scope.body) remove.add(d)
  }
  const next = structuredClone(record)
  for (const id of ids) {
    if (remove.has(id)) continue // this collapsed node is itself hidden inside another
    const scope = scopes.get(id)
    if (!scope) continue
    next.nodes[id].collapsed = true
    // The edge rising from a project node belongs to its scope, so its own branches are
    // inside the fold; its close is not, and keeps its branches and its successor.
    next.nodes[id].leftBranches = []
    next.nodes[id].rightBranches = []
    next.nodes[id].next = scope.terminusId
  }
  for (const d of remove) delete next.nodes[d]
  return next
}

// Fold or unfold a project node, persist the change to the client-local view
// state, and re-render in place.
function toggleCollapse(nodeId) {
  if (collapsedSet.has(nodeId)) collapsedSet.delete(nodeId)
  else collapsedSet.add(nodeId)
  if (currentDomainName) api.setViewState(currentDomainName, { collapsed: [...collapsedSet] })
  render(currentRecord, { fit: false })
}

// Read the note contents of a node's extent into an { id: content } map, taken by value
// so it is a snapshot independent of later edits. Shared by copy and export, and bounded
// by the scope, so a sub-project's notes stop at its own close.
async function collectSubtreeNotes(nodeId) {
  const notes = {}
  for (const id of extentOf(currentRecord, nodeId)) {
    const rec = currentRecord.nodes[id]
    if (rec.note) {
      const r = await api.readNote(currentDomainPath, rec.note)
      notes[id] = (r && r.content) || ''
    }
  }
  return notes
}

// Snapshot a project's scope (records and note contents) into the in-session
// clipboard. Taken by value at copy time, so it is unaffected by later edits or a
// domain switch; note text is read now rather than referenced by file. A clip is a whole
// plan, opening and close, which is what paste needs and what the extent gives.
async function copyProject(nodeId) {
  clipboard = { rootId: nodeId, nodes: clipNodes(currentRecord, nodeId), notes: await collectSubtreeNotes(nodeId) }
}

// Paste the clipboard into the open domain as a new tree: fresh ids, kept
// statuses, cleared here cursors, fresh note files. The paste op writes the note
// note files and the record together in the main process.
async function pastePlanFlow() {
  if (!clipboard || !currentRecord) return
  await applyOp('pasteAsPlan', clipboard)
}

// Export a project's subtree to a markdown outline the user saves where they
// choose. One-way: the file is a rendered copy, with no path back into the record.
async function exportProjectFlow(nodeId) {
  const notes = await collectSubtreeNotes(nodeId)
  const md = serializeProject(currentRecord, nodeId, notes)
  const base = (currentRecord.nodes[nodeId].title || 'project').trim() || 'project'
  const res = await api.exportMarkdown(base + '.md', md)
  if (res && res.error) {
    await chooseAction({ title: 'Export failed', message: res.error, actions: [{ label: 'OK', value: null }] })
  }
}

// ---- bookmarked views (a named collapse set + zoom + node-anchored camera) ----

// Capture the current live view as a bookmark: its collapse set, its zoom, and
// the node centred in the viewport plus that node's ancestor chain to the root
// (a node-anchored camera, so the bookmark survives layout changes and degrades
// to the nearest surviving ancestor rather than a stale coordinate).
async function addBookmarkFlow() {
  if (!currentLayout || !currentRecord) return
  const name = await promptText({ title: 'Add bookmark', label: 'Name', value: '' })
  if (name === null || !name.trim()) return
  const { scale, tx, ty } = viewport.getTransform()
  const cx = (viewportEl.clientWidth / 2 - tx) / scale
  const cy = (viewportEl.clientHeight / 2 - ty) / scale
  const anchorId = centeredStationId(currentLayout.stations, cx, cy)
  bookmarks.push({
    name: name.trim(),
    collapsed: [...collapsedSet],
    zoom: scale,
    anchor: anchorId ? anchorChain(currentRecord, anchorId) : [],
  })
  await persistBookmarks()
}

// Apply a bookmark to the live view: restore its collapse set (client-local), then
// centre the first node in its anchor chain that still exists and is visible. A
// chain that runs dry (the whole anchored tree was deleted) is a broken bookmark:
// fit the domain and say so. Collapse is resolved lazily here, not on delete.
async function jumpToBookmark(bm) {
  if (!currentRecord) return
  collapsedSet = new Set((bm.collapsed || []).filter((id) => currentRecord.nodes[id] && currentRecord.nodes[id].kind === 'project'))
  if (currentDomainName) api.setViewState(currentDomainName, { collapsed: [...collapsedSet] })
  await render(currentRecord, { fit: false })
  if (!currentLayout) return
  const hit = resolveAnchor(bm.anchor || [], new Set(currentLayout.stations.map((s) => s.id)))
  if (hit) {
    const s = currentLayout.stations.find((st) => st.id === hit)
    viewport.centerOn(s.x, s.cardTop + s.cardH / 2, bm.zoom)
  } else {
    viewport.fit()
    await chooseAction({
      title: 'Bookmark location is gone',
      message: 'The node “' + bm.name + '” centred on no longer exists. Showing the whole domain instead.',
      actions: [{ label: 'OK', value: null }],
    })
  }
}

async function deleteBookmarkFlow(index) {
  const bm = bookmarks[index]
  if (!bm) return
  const confirm = await chooseAction({
    title: 'Delete bookmark',
    message: 'Delete the bookmark “' + bm.name + '”?',
    actions: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'del', kind: 'danger' }],
  })
  if (confirm !== 'del') return
  bookmarks.splice(index, 1)
  await persistBookmarks()
}

// ---- editing flows (each dialog runs after the menu has closed) ----

async function renameTask(nodeId) {
  const title = await promptText({ title: 'Rename task', label: 'Title', value: currentRecord.nodes[nodeId].title })
  if (title === null) return
  applyOp('setTitle', nodeId, title)
}

async function addTaskFlow(dir, nodeId) {
  const title = await promptText({ title: 'Add task ' + dir, label: 'Title', value: '' })
  if (title === null) return
  applyOp(dir === 'above' ? 'addTaskAbove' : 'addTaskBelow', nodeId, title)
}

async function addBranchFlow(dir, nodeId) {
  const title = await promptText({ title: 'Add branch ' + dir, label: 'Title', value: '' })
  if (title === null) return
  applyOp(dir === 'above' ? 'addBranchAbove' : 'addBranchBelow', nodeId, title)
}

// The runs starting at `nodeId` that may be named as a sub-project, as a menu of their last
// node. Wrapping takes two nodes to be named and there is no selection mechanism, so the
// click names the run's base and the submenu names its top, exactly as "Merge a branch here"
// resolves the same problem. The candidates come from wrapCandidates, which asks wrapRun
// itself, so the menu cannot offer a run the authority will refuse.
function wrapRunFlow(fromId, toId) {
  const of = (id) => (currentRecord.nodes[id].kind === 'terminus' ? 'the close' : currentRecord.nodes[id].title)
  const suggestion = fromId === toId ? of(fromId) : of(fromId) + ' to ' + of(toId)
  promptText({ title: 'Wrap as sub-project', label: 'Name', value: suggestion }).then((title) => {
    if (title === null || !title.trim()) return
    applyOp('wrapRun', fromId, toId, title.trim())
  })
}

function wrapCandidateMenu(nodeId) {
  return wrapCandidates(currentRecord, nodeId).map((toId, i) => ({
    label: i === 0
      ? 'Just this one'
      : 'Up to “' + (currentRecord.nodes[toId].kind === 'terminus' ? 'the close' : currentRecord.nodes[toId].title) + '”',
    onClick: () => wrapRunFlow(nodeId, toId),
  }))
}

// Remove a node's note: the file and the record's reference to it, in that order, as
// delete_note does over MCP. The editor is closed first if it is open on that note, since
// what it holds is about to stop existing.
async function deleteNoteFlow(nodeId) {
  const task = currentRecord.nodes[nodeId]
  if (!task || !task.note) return
  const confirm = await chooseAction({
    title: 'Delete note',
    message: 'Delete the note on “' + (task.title || nodeId) + '”? The text is not recoverable.',
    actions: [{ label: 'Cancel', value: null }, { label: 'Delete note', value: 'del', kind: 'danger' }],
  })
  if (confirm !== 'del') return
  noteEditor.closeIfOpen(nodeId)
  const res = await api.deleteNote(currentDomainPath, task.note)
  if (res && res.error) { reportEditError(res.error); return }
  applyOp('setNote', nodeId, null)
}

// The branches that could legally rejoin the trunk at the edge above `nodeId`, as a menu
// of their feet. A branch's return is stored on the branch, so moving one takes two things
// to be named, the branch and the target; there being no selection mechanism, the click
// names the target and the submenu names the branch. This is how a merge fabricated by the
// migration is put right; the other way a return moves is dragging its junction diamond.
function mergeCandidates(nodeId) {
  const ix = indexRecord(currentRecord)
  return branchesIn(currentRecord)
    .filter((b) => b.mergePoint !== nodeId)
    .filter((b) => !mergeErrors(currentRecord, { ...b, mergePoint: nodeId }, ix).length)
    .map((b) => ({
      label: currentRecord.nodes[b.footId].title || b.footId,
      onClick: () => applyOp('setMergePoint', b.footId, nodeId),
    }))
}

// The same shape for the other end of a branch: the ones that could legally hang on the
// edge above `nodeId`, each travelling intact. This is also the surface that reaches a
// SHARED junction: a diamond where several branches meet is no drag handle, since a drag
// must name one branch, and the submenu is what can.
function branchPointCandidates(nodeId) {
  const ix = indexRecord(currentRecord)
  return branchesIn(currentRecord)
    .filter((b) => b.hostId !== nodeId)
    .filter((b) => !mergeErrors(currentRecord, { ...b, hostId: nodeId }, ix).length)
    .map((b) => ({
      label: currentRecord.nodes[b.footId].title || b.footId,
      onClick: () => applyOp('setBranchPoint', b.footId, nodeId),
    }))
}

async function deleteTaskFlow(nodeId) {
  const task = currentRecord.nodes[nodeId]
  const isRoot = isRootId(currentRecord, nodeId)
  const hasDescendants = !!task.next || branchChildrenOf(task).length > 0
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
  applyOp('deleteTask', nodeId, mode)
}

async function addPlanFlow() {
  const name = await promptText({ title: 'New plan', label: 'Plan name', value: '' })
  if (name === null) return
  applyOp('addPlan', name)
}

function openTaskMenu(x, y, nodeId) {
  const task = currentRecord.nodes[nodeId]
  const isProject = task.kind === 'project'
  const isRoot = isRootId(currentRecord, nodeId)
  const items = []

  // A scope's close has little menu of its own: no title to rename, no status, no flag, no
  // kind to change, and it cannot be moved or deleted on its own, since it is one half of a
  // pair. Three things it does have. The edge above it, unless it closes a plan, where there
  // is none. Its note, because every kind of node may carry one and the way to a note is the
  // same on every kind. And the fold, because the pair is one object and a shut scope draws
  // its close ON the project's card, so the close is as likely a target as the project is.
  if (task.kind === 'terminus') {
    if (!isPlanClose(currentRecord, nodeId)) {
      items.push({ label: 'Add task above', onClick: () => addTaskFlow('above', nodeId) })
      items.push({ label: 'Add branch above', onClick: () => addBranchFlow('above', nodeId) })
      const closeMerges = mergeCandidates(nodeId)
      if (closeMerges.length) items.push({ label: 'Merge a branch here', submenu: closeMerges })
      const closeBranchPoints = branchPointCandidates(nodeId)
      if (closeBranchPoints.length) items.push({ label: 'Move branch point here', submenu: closeBranchPoints })
      items.push({ separator: true })
    }
    // The fold is recorded against the project node, so acting from this end resolves the pair
    // first; which end was clicked makes no difference to what happens.
    const opened = pairScopes(currentRecord, trunksOf(currentRecord)).closes.get(nodeId)
    if (opened) {
      items.push(collapsedSet.has(opened)
        ? { label: 'Expand', onClick: () => toggleCollapse(opened) }
        : { label: 'Collapse', onClick: () => toggleCollapse(opened) })
    }
    items.push({ label: 'Edit note…', onClick: () => openNote(nodeId) })
    if (task.note) items.push({ label: 'Delete note…', onClick: () => deleteNoteFlow(nodeId) })
    openContextMenu(x, y, items)
    return
  }

  if (!isProject) {
    const status = (label, value) => ({
      label, checked: task.status === value,
      onClick: () => applyOp('setStatus', nodeId, value),
    })
    items.push({ label: 'Status', submenu: [
      status('To do', 'todo'),
      status('In progress', 'in-progress'),
      status('Completed', 'completed'),
      status('Cancelled', 'cancelled'),
    ] })
    items.push(task.here
      ? { label: 'Clear here', onClick: () => applyOp('clearHere', nodeId) }
      : { label: 'Make here', onClick: () => applyOp('makeHere', nodeId) })
  }
  // A root is always a project node, so its kind cannot be changed.
  if (!isRoot) {
    items.push(isProject
      ? { label: 'Make task', onClick: () => applyOp('convertKind', nodeId) }
      : { label: 'Make sub-project', onClick: () => applyOp('convertKind', nodeId) })
  }
  // Name a run of this trunk as a sub-project, the click naming its base and the submenu
  // its top. Withheld from a plan's base, whose scope is the plan itself and which cannot
  // be the base of a run inside it.
  if (!isRoot) {
    const wraps = wrapCandidateMenu(nodeId)
    if (wraps.length) items.push({ label: 'Wrap as sub-project', submenu: wraps })
  }
  // Collapse/expand folds a project node's subtree (client-local view state).
  if (isProject) {
    items.push(collapsedSet.has(nodeId)
      ? { label: 'Expand', onClick: () => toggleCollapse(nodeId) }
      : { label: 'Collapse', onClick: () => toggleCollapse(nodeId) })
    // Copy the project's subtree for pasting as a new tree, here or in another domain.
    items.push({ label: 'Copy', onClick: () => copyProject(nodeId) })
    // Export the project's subtree to a markdown outline (one-way).
    items.push({ label: 'Export to Markdown…', onClick: () => exportProjectFlow(nodeId) })
  }
  // Reorder within the line: a clean swap with the main-line neighbour that keeps
  // the node's own branches. "Move up" needs a successor (and not a root, whose
  // successor cannot take the base); "move down" needs a non-root main-line
  // predecessor to swap below.
  const succId = task.next
  const predId = Object.keys(currentRecord.nodes).find((pid) => currentRecord.nodes[pid].next === nodeId)
  if (succId && !isRoot) items.push({ label: 'Move up', onClick: () => applyOp('moveUp', nodeId) })
  if (predId && !isRootId(currentRecord, predId)) items.push({ label: 'Move down', onClick: () => applyOp('moveDown', nodeId) })
  items.push({ label: 'Rename…', onClick: () => renameTask(nodeId) })
  items.push({ separator: true })
  // Nothing may be added on the edge rising from a folded project node: that edge is the
  // first edge of the scope it opens, so whatever landed there would land out of sight
  // inside the fold. Expanding the scope offers all three again.
  const foldedOpen = isProject && collapsedSet.has(nodeId)
  if (!foldedOpen) items.push({ label: 'Add task above', onClick: () => addTaskFlow('above', nodeId) })
  // Nothing may be added below a root node (a project's base).
  if (!isRoot) items.push({ label: 'Add task below', onClick: () => addTaskFlow('below', nodeId) })
  if (!foldedOpen) items.push({ label: 'Add branch above', onClick: () => addBranchFlow('above', nodeId) })
  if (!isRoot) items.push({ label: 'Add branch below', onClick: () => addBranchFlow('below', nodeId) })
  // A merge lands a return on the edge above this node, so it is an addition on that
  // same hidden edge and goes with the other two; a moved branch point likewise.
  const merges = foldedOpen ? [] : mergeCandidates(nodeId)
  if (merges.length) items.push({ label: 'Merge a branch here', submenu: merges })
  const branchPoints = foldedOpen ? [] : branchPointCandidates(nodeId)
  if (branchPoints.length) items.push({ label: 'Move branch point here', submenu: branchPoints })
  items.push({ separator: true })
  items.push({ label: 'Edit note…', onClick: () => openNote(nodeId) })
  // Offered only where there is one to delete, so the item's presence says a note exists.
  if (task.note) items.push({ label: 'Delete note…', onClick: () => deleteNoteFlow(nodeId) })
  items.push({ separator: true })
  items.push({ label: 'Delete…', onClick: () => deleteTaskFlow(nodeId) })

  openContextMenu(x, y, items)
}

function openCanvasMenu(x, y) {
  const items = [{ label: 'New plan…', onClick: () => addPlanFlow() }]
  // Paste a previously copied project as a new tree in this domain.
  if (clipboard) items.push({ label: 'Paste as new plan', onClick: () => pastePlanFlow() })
  items.push({ separator: true })
  items.push({ label: 'Add bookmark…', onClick: () => addBookmarkFlow() })
  if (bookmarks.length) {
    items.push({ label: 'Jump to bookmark', submenu: bookmarks.map((bm) => ({ label: bm.name, onClick: () => jumpToBookmark(bm) })) })
    items.push({ label: 'Delete bookmark', submenu: bookmarks.map((bm, i) => ({ label: bm.name, onClick: () => deleteBookmarkFlow(i) })) })
  }
  openContextMenu(x, y, items)
}

viewportEl.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (!currentRecord) return
  if (flaggedOnly) return // read-only view; card gestures are already disabled via CSS
  const nodeId = nodeIdFromEvent(e)
  if (nodeId && currentRecord.nodes[nodeId]) openTaskMenu(e.clientX, e.clientY, nodeId)
  else openCanvasMenu(e.clientX, e.clientY)
})

// Clicking a card's notepad icon opens its note.
viewportEl.addEventListener('click', (e) => {
  if (!currentRecord) return
  if (!e.target.closest('.noteicon')) return
  const nodeId = nodeIdFromEvent(e)
  if (nodeId && currentRecord.nodes[nodeId]) openNote(nodeId)
})

// Double-clicking a card's body toggles its flag (drawn as atomic orbits). The
// status glyph and note icon own their own single-click actions, so a double-click
// on either is left to them and does not toggle the flag.
viewportEl.addEventListener('dblclick', (e) => {
  if (!currentRecord) return
  if (e.target.closest('.gl') || e.target.closest('.noteicon')) return
  const nodeId = nodeIdFromEvent(e)
  const node = nodeId && currentRecord.nodes[nodeId]
  // A scope's close carries no flag, so a double-click on it does nothing rather than
  // asking the authority for something it will refuse.
  if (node && node.kind !== 'terminus') applyOp('toggleFlag', nodeId)
})

// Single-clicking a task's status glyph cycles its status
// (todo -> in-progress -> completed -> cancelled -> todo). A project glyph, which
// carries no status, is ignored.
viewportEl.addEventListener('click', (e) => {
  if (!currentRecord) return
  const gl = e.target.closest('.gl')
  if (!gl || gl.classList.contains('project')) return
  const nodeId = nodeIdFromEvent(e)
  if (nodeId && currentRecord.nodes[nodeId]) applyOp('cycleStatus', nodeId)
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
  const res = await api.createDomain(name)
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
  // No queued record save to cancel: task ops write synchronously through main,
  // so nothing can re-create the trashed domain after this point.
  const res = await api.deleteDomain(path)
  if (res.error) {
    await chooseAction({ title: 'Could not delete domain', message: res.error, actions: [{ label: 'OK', value: null }] })
    return
  }

  const domains = await api.listDomains()
  if (!domains.length) {
    currentDomainPath = null
    currentRecord = null
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
    showEmpty('No domain library found')
    return
  }
  const last = domains.find((d) => d.name === settings.lastDomain) || domains[0]
  populateSwitcher(domains, last.path)
  await openDomain(last.path, last.name)
}

// ---- live updates from another writer (the in-app MCP server) ----
// An agent edited the open domain: re-read and re-render in place, holding the
// camera, zoom, and collapse state (northstar axiom 9 — the view is the client's).
// A burst of edits coalesces into one render per animation frame; no changed-node
// highlight. The renderer applies its OWN edits from their IPC result, and main
// pushes only for external edits, so nothing renders twice.
let liveRefreshQueued = false
let liveRefreshDir = null
function scheduleLiveRefresh(dir) {
  liveRefreshDir = dir
  if (liveRefreshQueued) return
  liveRefreshQueued = true
  requestAnimationFrame(async () => {
    liveRefreshQueued = false
    const d = liveRefreshDir
    liveRefreshDir = null
    if (!d || d !== currentDomainPath) return
    const res = await api.readRecord(d)
    if (res.error) return
    currentRecord = res.record
    await render(currentRecord, { fit: false })
    noteEditor.reconcile(d, currentRecord)
  })
}

// The domain list changed (an agent created or trashed a domain): refresh the
// switcher, and if the open domain is the one that was removed, move to another.
async function refreshDomainList() {
  const domains = await api.listDomains()
  if (currentDomainPath && !domains.some((d) => d.path === currentDomainPath)) {
    noteEditor.close()
    closeContextMenu()
    if (!domains.length) {
      currentDomainPath = null
      currentRecord = null
      await api.setLastDomain(null)
      populateSwitcher([], null)
      updateDeleteButton()
      showEmpty('No domains. Use “New domain…” in the switcher to create one.')
      return
    }
    populateSwitcher(domains, domains[0].path)
    await openDomain(domains[0].path, domains[0].name)
    return
  }
  populateSwitcher(domains, currentDomainPath)
}

api.onDomainChanged((dir) => scheduleLiveRefresh(dir))
api.onDomainsChanged(() => refreshDomainList())

boot()
