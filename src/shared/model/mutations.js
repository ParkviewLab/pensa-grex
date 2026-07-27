// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The pure edit operations, one per right-click menu action (see
// docs/model_ideas.md, "Editing"). Each takes the record (the
// parsed-and-validated JSON5 shape, not the buildModel() runtime model) and
// returns a NEW record; none mutate their argument, so every edit is
// serializable and can be re-validated with validateRecord() before it is
// applied and saved. New node ids come from model/ids.js; timestamps are ISO
// strings stamped at edit time.
//
// Three node kinds. A `task` carries a status and can hold the "here" mark; a
// `project` node opens a scope and carries neither; a `terminus` closes one and says
// nothing of its own beyond a note. Every plan's base is a project node with no
// incoming edge, so nothing can be added below it, and every plan ends at the
// terminus closing that base, so nothing can be added above it either (northstar
// axiom 2). Every project node closes, and the pairing is derived by matching
// brackets up the trunk rather than stored (see validate.js).
//
// Every branch rejoins the trunk it left (axiom 3), so every edit here has to leave each
// branch with a legal merge point. Two endings do that: normalizeReturns for an ordinary
// edit, which carries a return up to whatever is now the top of its branch and clamps one
// whose target has gone; and requireLegalReturns for the two edits that create a scope,
// which refuse rather than move a return the author did not ask to move.

import { mintNodeId } from './ids.js'
import { noteFileName } from './notes.js'
import { pairScopes, trunksOf, isPlanClose, branchesIn, indexRecord, mergeErrors, extentOf } from './validate.js'

const STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

function clone(record) {
  return structuredClone(record)
}

function nowISO() {
  return new Date().toISOString()
}

// A node's forks live in two ordered arrays, one per side, and each array names
// the edge that RISES from the node holding it. These four helpers are the only
// places that know that, so everything below can go on speaking of a node's
// branches without caring which array a fork sits in.
const SIDE_KEY = { left: 'leftBranches', right: 'rightBranches' }

function sideArray(node, side) {
  const key = SIDE_KEY[side] || SIDE_KEY.left
  if (!Array.isArray(node[key])) node[key] = []
  return node[key]
}

// Left then right, each in its stored order, with the index a caller needs to
// splice or repoint the entry it found.
function branchesOf(node) {
  return [
    ...(node.leftBranches || []).map((child, index) => ({ child, side: 'left', index })),
    ...(node.rightBranches || []).map((child, index) => ({ child, side: 'right', index })),
  ]
}

function branchCount(node) {
  return (node.leftBranches || []).length + (node.rightBranches || []).length
}

// A side array is ordered innermost first, nearest the spine, and that order is the
// author's: it is what decides lane order in the drawing. A new branch lands innermost,
// because its span is a single edge, which nests inside every span containing that edge
// and so costs no crossings there. Forks rehomed by a splice keep the order they had and
// join at the outer end, their spans being whatever they already were.
function addBranch(node, childId, side, where = 'innermost') {
  const arr = sideArray(node, side)
  if (where === 'outermost') arr.push(childId)
  else arr.unshift(childId)
}

// Move a branch's foot from one host's side array to another's, keeping its side. The one
// primitive that changes which edge a branch hangs on, and membership is by id, never by
// index, so a caller holding a stale position cannot move the wrong branch.
function rehostBranch(record, footId, side, fromId, toId, where = 'innermost') {
  const key = SIDE_KEY[side] || SIDE_KEY.left
  const from = record.nodes[fromId]
  if (Array.isArray(from[key])) from[key] = from[key].filter((id) => id !== footId)
  addBranch(record.nodes[toId], footId, side, where)
}

// A scope's close. It says nothing of its own: no title, no status, no flag, no
// "here". The one expressive field it keeps is a note, which is where one records
// what closing the scope took.
function newTerminus() {
  return {
    id: mintNodeId(),
    kind: 'terminus',
    createdAt: nowISO(),
    note: null,
    next: null,
    mergePoint: null,
    rightBranches: [],
    leftBranches: [],
  }
}

// Which terminus closes which project, derived by matching brackets up each trunk
// (see validate.js). Recomputed per call rather than cached, for the same reason the
// predecessor is not stored: two copies are two chances to disagree.
function scopes(record) {
  return pairScopes(record, trunksOf(record))
}

function newTask(title) {
  return {
    id: mintNodeId(),
    title: typeof title === 'string' && title.length ? title : 'New task',
    kind: 'task',
    status: 'todo',
    createdAt: nowISO(),
    completedAt: null,
    note: null,
    here: false,
    flagged: false,
    next: null,
    mergePoint: null,
    rightBranches: [],
    leftBranches: [],
  }
}

function newProjectNode(title) {
  return {
    id: mintNodeId(),
    title: typeof title === 'string' && title.length ? title : 'New project',
    kind: 'project',
    createdAt: nowISO(),
    note: null,
    flagged: false,
    next: null,
    rightBranches: [],
    leftBranches: [],
  }
}

// The node whose .next or whose branch points at nodeId, or null if nodeId is a
// root. validateRecord guarantees at most one such incoming edge.
function predecessorOf(record, nodeId) {
  for (const [id, node] of Object.entries(record.nodes)) {
    if (node.next === nodeId) return { id, kind: 'next' }
    const b = branchesOf(node).find((x) => x.child === nodeId)
    if (b) return { id, kind: 'branch', side: b.side, index: b.index }
  }
  return null
}

// The ids on nodeId's line: the maximal .next chain it sits on. The line starts
// at a root or a branch child (the first node with no main-line predecessor) and
// runs up through .next to the tip.
function lineIds(record, nodeId) {
  let start = nodeId
  for (;;) {
    const pred = predecessorOf(record, start)
    if (pred && pred.kind === 'next') start = pred.id
    else break
  }
  const ids = []
  let id = start
  const seen = new Set()
  while (id && record.nodes[id] && !seen.has(id)) {
    seen.add(id)
    ids.push(id)
    id = record.nodes[id].next
  }
  return ids
}

// After a splice can merge two lines, a line may carry more than one "here".
// Keep the one nearest the tip (the most-advanced cursor) and clear the rest,
// so the <=1-here-per-line invariant holds. Harmless when nothing merged.
function normalizeHeres(record) {
  const seenLineStart = new Set()
  for (const id of Object.keys(record.nodes)) {
    const line = lineIds(record, id)
    const startKey = line[0]
    if (seenLineStart.has(startKey)) continue
    seenLineStart.add(startKey)
    const heres = line.filter((tid) => record.nodes[tid].here)
    if (heres.length > 1) {
      const keep = heres[heres.length - 1]
      for (const tid of heres) if (tid !== keep) record.nodes[tid].here = false
    }
  }
  return record
}

/**
 * Re-home any branch left hanging on a node with no edge above it. A branch hangs on the
 * edge rising from its node, and the top of a trunk has no such edge: what sits above the
 * top of a branch trunk is that branch's own return line, and above a plan's close there is
 * nothing at all. Deleting the node above a branch's host leaves exactly that, and so does
 * a schema-2 file, which let a fork attach anywhere.
 *
 * The branch moves one node down its host's trunk, which moves its junction by one gap;
 * where its host is the foot of a single-node branch, that is the branch's own branch point,
 * so it becomes a sibling of that branch rather than a child of it. Iterated, since the node
 * it moves onto may itself be the top of its trunk.
 *
 * It joins the receiving node's side array at the outer end, which is the right end for this
 * case rather than the innermost default: a fork that hung on a branch was drawn outside that
 * branch, and appending is what keeps it there.
 *
 * The one function here that mutates in place, because it is a repair rather than an edit:
 * it is called at the end of an edit that has already cloned, and by the migration on a
 * record it has just built.
 */
export function rehomeOrphanedBranches(record) {
  for (let pass = 0; pass < 8; pass++) {
    const ix = indexRecord(record)
    let moved = 0
    for (const branch of branchesIn(record)) {
      const host = record.nodes[branch.hostId]
      if (!host || host.next) continue
      const pred = ix.pred.get(branch.hostId)
      if (!pred || !record.nodes[pred.id]) continue
      rehostBranch(record, branch.footId, branch.side, branch.hostId, pred.id, 'outermost')
      moved++
    }
    if (!moved) return record
  }
  return record
}

// Put every return line back on the top of its own branch. A merge point is stored on the
// tip of its branch trunk, because that is where the return leaves, so an edit that puts a
// new node on top has to carry it up; rather than have every mutation remember to, the
// invariant is repaired here in one pass. The topmost merge point still stored anywhere on
// a branch trunk moves to that trunk's tip, so a branch's claim travels with it as it
// grows; a value the edit destroyed along with its node is recovered from `before`, the
// record as it was; and a branch that has never had one, having been grafted in from
// elsewhere, gets the smallest legal branch, its own edge. A trunk that is no longer a
// branch, one detached into a plan of its own, gives its return up.
function relocateReturns(next, before) {
  const wasOn = new Map()
  for (const b of branchesIn(before || {})) if (b.mergePoint) wasOn.set(b.footId, b.mergePoint)

  const branches = branchesIn(next)
  for (const b of branches) {
    if (!b.tipId) continue
    let stored = null
    for (const id of b.trunk) {
      const v = next.nodes[id].mergePoint
      if (v) {
        stored = v
        next.nodes[id].mergePoint = null
      }
    }
    const tip = next.nodes[b.tipId]
    // A project node always has its own close above it, so it is never a trunk's top; if
    // one is here, the record is malformed and validateRecord will say so.
    if (tip.kind === 'project') continue
    tip.mergePoint = stored || wasOn.get(b.footId) || b.hostId
  }

  const tipIds = new Set(branches.map((b) => b.tipId))
  for (const node of Object.values(next.nodes)) {
    // A project node carries no merge point at all, not even an empty one, since it can
    // never be a trunk's top; every other kind carries the field and leaves it null.
    if (node.kind === 'project') delete node.mergePoint
    else if (node.mergePoint && !tipIds.has(node.id)) node.mergePoint = null
  }
  return next
}

// Every complaint the merge rules have about a record, in one list.
function returnErrors(next) {
  const ix = indexRecord(next)
  const errors = []
  for (const b of branchesIn(next)) errors.push(...mergeErrors(next, b, ix))
  return errors
}

// The ordinary ending for a structural edit: relocate every return, then clamp any that
// the edit made impossible — its target deleted, say — down to the smallest legal branch.
// Clamping is the only answer available where the node a return named has gone.
function normalizeReturns(next, before) {
  rehomeOrphanedBranches(next)
  relocateReturns(next, before)
  const ix = indexRecord(next)
  for (const b of branchesIn(next)) {
    if (!b.tipId || !b.mergePoint) continue
    if (mergeErrors(next, b, ix).length) next.nodes[b.tipId].mergePoint = b.hostId
  }
  return next
}

// The ending for an edit that creates a scope. Naming a run as a project, or making a node
// into one, can leave a branch that departs inside the new scope and rejoins outside it, or
// the reverse; that breaks the promise that a scope collapses as a single block, and the
// honest handling is to refuse the edit and name what would be legal rather than to move
// the author's return somewhere it never asked to be.
function requireLegalReturns(next, before, refusal) {
  relocateReturns(next, before)
  const errs = returnErrors(next)
  if (errs.length) throw new Error(refusal + ': ' + errs[0])
  return next
}

// A close is one half of a pair and sits where its scope ends, so it does not move on its own:
// moving it alone would quietly resize the scope, taking in a node that was outside it or
// letting go of one that was inside, and the record would still be bracket-matched, so nothing
// downstream would object. The scope moves by its project node, which carries its close. The
// grafting moves refuse a close by kind already; this is the same rule for the three that
// reorder a trunk in place.
function requireMovable(node) {
  if (node.kind === 'terminus') {
    throw new Error('a close cannot be moved on its own: it is one half of a pair and sits where its scope ends; move the project it closes, which carries it')
  }
  return node
}

function requireNode(record, nodeId) {
  if (!record.nodes[nodeId]) throw new Error('unknown task "' + nodeId + '"')
  return record.nodes[nodeId]
}

// A branch hangs on the edge rising from a node, and two positions have no such edge: a
// plan's close, and the top of a branch trunk, whose upper neighbour is that branch's own
// return line rather than a trunk edge. Both are one rule, and it is the same rule that
// forbids naming either as a merge point (docs/model_v3_ideas.md, section 3).
function requireRisingEdge(record, nodeId) {
  if (!record.nodes[nodeId].next) {
    throw new Error('nothing rises from "' + nodeId + '": it is the top of its trunk, so there is no edge there to hold a branch')
  }
}

/**
 * Start a new plan in the domain: a base project node titled `name` and the
 * terminus that closes it, appended to planOrder. The one way to begin a plan from
 * nothing (an empty domain, or after the last plan was deleted). The base carries
 * the plan's name; tasks are inserted into the edge between the two.
 *
 * An empty plan is a legal resting state, and this is how every plan begins: a
 * project carries a title, so an empty one still asserts something.
 */
export function addPlan(record, name) {
  const next = clone(record)
  const root = newProjectNode(name)
  const close = newTerminus()
  root.next = close.id
  addNode(next, root)
  next.nodes[close.id] = close
  if (!Array.isArray(next.planOrder)) next.planOrder = []
  next.planOrder.push(root.id)
  return next
}

// Return `desired` if no other node in the domain already uses it, else the lowest
// free `base-N`, so titles stay unique across the domain. The base is `desired`
// with any trailing `-<digits>` stripped, so re-editing "Foo-1" into a name that is
// already taken yields "Foo-2", not "Foo-1-1" (a bare "Foo" collision starts at
// "Foo-1"). `excludeId` is the node being renamed, whose own current title must not
// count as a collision. A deliberate consequence of stripping: a genuine numeric
// tail ("Rev-2020") is renumbered from its base on collision (see docs/model_ideas.md).
export function uniqueTitle(record, desired, excludeId) {
  const want = String(desired)
  const taken = new Set()
  for (const [id, t] of Object.entries(record.nodes || {})) {
    if (id !== excludeId && t && typeof t.title === 'string') taken.add(t.title)
  }
  if (!taken.has(want)) return want
  const baseName = want.replace(/-\d+$/, '')
  for (let n = 1; ; n++) {
    const candidate = baseName + '-' + n
    if (!taken.has(candidate)) return candidate
  }
}

// Place a freshly-created node into the record with a domain-unique title (uniqueTitle),
// so a name typed at creation is suffixed just as setTitle and pasteAsPlan already do.
// Used by every add* mutation; the node is not yet in the record, so excludeId is null.
function addNode(record, node) {
  node.title = uniqueTitle(record, node.title, null)
  record.nodes[node.id] = node
  return node
}

/** Set a node's title, kept unique within the domain (see uniqueTitle). */
export function setTitle(record, nodeId, title) {
  const next = clone(record)
  const node = requireNode(next, nodeId)
  if (node.kind === 'terminus') throw new Error('a terminus has no title')
  node.title = uniqueTitle(next, title, nodeId)
  return next
}

/** Record (or clear, with null) a node's note filename, which drives the note dot. */
export function setNote(record, nodeId, filename) {
  const next = clone(record)
  requireNode(next, nodeId).note = filename || null
  return next
}

/** Set a task's status. Completing stamps completedAt; leaving completed clears it. */
export function setStatus(record, nodeId, status) {
  if (!STATUSES.includes(status)) throw new Error('invalid status "' + status + '"')
  const next = clone(record)
  const node = requireNode(next, nodeId)
  if (node.kind !== 'task') throw new Error('only a task has a status')
  node.status = status
  if (status === 'completed') node.completedAt = node.completedAt || nowISO()
  else node.completedAt = null
  return next
}

/**
 * Advance a task's status one step along STATUSES, wrapping cancelled -> todo. The
 * click-free counterpart of the right-click Status submenu; an unknown current
 * status starts the cycle at todo.
 */
export function cycleStatus(record, nodeId) {
  const node = requireNode(record, nodeId)
  if (node.kind !== 'task') throw new Error('only a task has a status')
  const i = STATUSES.indexOf(node.status)
  return setStatus(record, nodeId, STATUSES[(i + 1) % STATUSES.length])
}

/**
 * Toggle a node between task and project (a "sub-project"). Task -> project
 * DISCARDS status/completedAt and clears the "here" mark (a project has none), so a
 * round-trip resets a task to 'todo'. A root is always a project node, so its kind
 * cannot be changed.
 *
 * A project has a scope, so the conversion has to open or close one. Becoming a
 * project acquires a terminus at the top of the node's own trunk, which is the
 * extent schema 2 always meant by a project node (everything above it); becoming a
 * task gives up that terminus, and its note with it, since there is no longer a
 * close to record anything about. A terminus itself cannot be converted either way:
 * it is not an independent node but one half of a pair, and the way to be rid of it
 * is to unwrap its project.
 */
export function convertKind(record, nodeId) {
  const next = clone(record)
  const node = requireNode(next, nodeId)
  if (node.kind === 'terminus') throw new Error('a terminus cannot change kind; unwrap its project instead')
  if (!predecessorOf(next, nodeId)) throw new Error('cannot change the kind of a root node')
  if (node.kind === 'project') {
    const terminusId = scopes(next).pairs.get(nodeId)
    node.kind = 'task'
    node.status = 'todo'
    node.completedAt = null
    node.here = false
    node.mergePoint = null
    if (terminusId) spliceOutNode(next, terminusId)
  } else {
    node.kind = 'project'
    delete node.status
    delete node.completedAt
    delete node.here
    insertCloseForScopeOpenedAt(next, nodeId)
    return requireLegalReturns(next, record, 'this node cannot become a sub-project')
  }
  return normalizeReturns(next, record)
}

// Put a close for the scope that has just opened at `openId`, at the extent schema 2
// meant by a project node: everything above it on its trunk.
//
// "The top of the trunk" is not quite the place, because the closes of the scopes
// this one sits inside are already stacked up there, and this close has to go below
// them: an inner scope closes before its container does. So walk up and stop at the
// first close belonging to a scope opened BELOW us; a close belonging to a scope
// opened above us is inside ours and stays below it.
function insertCloseForScopeOpenedAt(next, openId) {
  const trunk = lineIds(next, openId)
  const at = trunk.indexOf(openId)
  const { closes } = scopes(next)
  const close = newTerminus()

  let beforeId = null
  for (let i = at + 1; i < trunk.length; i++) {
    const id = trunk[i]
    if (next.nodes[id].kind !== 'terminus') continue
    const opened = closes.get(id)
    if (opened && trunk.indexOf(opened) < at) { beforeId = id; break }
  }

  if (beforeId) {
    const pred = predecessorOf(next, beforeId)
    close.next = beforeId
    // A close always arrives by a trunk edge, so its predecessor is a main-line one.
    next.nodes[pred.id].next = close.id
  } else {
    const top = trunk[trunk.length - 1]
    next.nodes[top].next = close.id
  }
  next.nodes[close.id] = close
  return close
}

/**
 * Name a run of a trunk as a project: a project node goes in below the run's first
 * node and a terminus above its last, so the run becomes a scope. `toId` defaults to
 * `fromId`, which wraps one node.
 *
 * Refused unless the run is a contiguous piece of one trunk, read base-to-top, and
 * unless the scopes inside it balance: wrapping half of a sub-project would leave
 * one of its ends outside the new scope, which is the straddle the grammar forbids.
 */
export function wrapRun(record, fromId, toId, title) {
  const next = clone(record)
  requireNode(next, fromId)
  const endId = toId || fromId
  requireNode(next, endId)

  const trunk = lineIds(next, fromId)
  const from = trunk.indexOf(fromId)
  const to = trunk.indexOf(endId)
  if (from === -1 || to === -1) throw new Error('a run must lie on one trunk')
  if (to < from) throw new Error('a run reads from the base upward: its first node must be below its last')

  const run = trunk.slice(from, to + 1)
  const { closes } = scopes(next)
  const inside = new Set(run)
  for (const id of run) {
    const node = next.nodes[id]
    if (node.kind === 'terminus' && !inside.has(closes.get(id))) {
      throw new Error('a run cannot end inside a sub-project: its close is in the run but its opening is not')
    }
    if (node.kind === 'project' && !inside.has(scopes(next).pairs.get(id))) {
      throw new Error('a run cannot begin inside a sub-project: its opening is in the run but its close is not')
    }
  }

  const open = newProjectNode(title)
  const close = newTerminus()
  const pred = predecessorOf(next, fromId)

  open.next = fromId
  next.nodes[endId].next = close.id
  close.next = trunk[to + 1] || null
  addNode(next, open)
  next.nodes[close.id] = close

  if (!pred) {
    // The run starts at a plan's base, so the new project becomes the plan's base
    // and takes its place in planOrder.
    next.planOrder = (next.planOrder || []).map((id) => (id === fromId ? open.id : id))
  } else if (pred.kind === 'next') {
    next.nodes[pred.id].next = open.id
  } else {
    sideArray(next.nodes[pred.id], pred.side)[pred.index] = open.id
  }
  return requireLegalReturns(next, record, 'this run cannot be named as a project')
}

/**
 * The runs beginning at `fromId` that wrapRun would accept, as the id of each run's last
 * node, base to top. The first is always `fromId` itself, which wraps one node.
 *
 * Computed by asking wrapRun, on a throwaway record per candidate, rather than by a second
 * reading of its rules. That costs a clone per node up the trunk, which is nothing at these
 * sizes, and buys the property that matters for a menu: it can never offer a run the
 * operation would then refuse. wrapRun is pure, so the record is untouched.
 */
export function wrapCandidates(record, fromId) {
  const trunk = lineIds(record, fromId)
  const from = trunk.indexOf(fromId)
  if (from === -1) return []
  const out = []
  for (let i = from; i < trunk.length; i++) {
    try {
      wrapRun(record, fromId, trunk[i], 'Probe')
      out.push(trunk[i])
    } catch {
      // Not a legal run: it straddles a scope, or a branch opened inside it rejoins outside.
    }
  }
  return out
}

/**
 * Undo a wrap: remove a project node and the terminus that closes it, leaving what
 * was inside on the trunk. The scope goes; nothing inside it moves.
 *
 * Refused on a plan's base, since a plan is bounded by its base and close and a root
 * must be a project node: removing a plan's own scope is deleting the plan.
 */
export function unwrapProject(record, projectId) {
  const next = clone(record)
  const node = requireNode(next, projectId)
  if (node.kind !== 'project') throw new Error('only a project node can be unwrapped')
  if (!predecessorOf(next, projectId)) throw new Error('a plan\'s base cannot be unwrapped; delete the plan instead')
  const terminusId = scopes(next).pairs.get(projectId)
  spliceOutNode(next, projectId)
  if (terminusId) spliceOutNode(next, terminusId)
  return normalizeReturns(next, record)
}

// Take one node off its trunk, joining its predecessor to its successor. The node
// must have no branches of its own (a project node's and a terminus's forks stay
// where they are, so unwrap and convert check nothing: both of those nodes may carry
// branches, and those branches move to whatever now holds the edge).
function spliceOutNode(next, id) {
  const node = next.nodes[id]
  const pred = predecessorOf(next, id)
  const succ = node.next || null
  if (!pred) {
    next.planOrder = (next.planOrder || []).map((rid) => (rid === id ? succ : rid)).filter(Boolean)
  } else if (pred.kind === 'next') {
    next.nodes[pred.id].next = succ
  } else if (succ) {
    sideArray(next.nodes[pred.id], pred.side)[pred.index] = succ
  } else {
    sideArray(next.nodes[pred.id], pred.side).splice(pred.index, 1)
  }
  // Its own forks belong to the edge it held, which is now the predecessor's.
  const host = pred && pred.kind === 'next' ? next.nodes[pred.id] : (succ ? next.nodes[succ] : null)
  if (host) {
    for (const b of branchesOf(node)) addBranch(host, b.child, b.side, 'outermost')
  }
  delete next.nodes[id]
}

/**
 * Toggle a node's "flagged" mark, drawn as the atomic orbits. A persisted, shared
 * annotation (it rides in the domain file, not the client's view state), used to
 * select nodes, e.g. for an assistant to examine next. Any node may be flagged.
 */
export function toggleFlag(record, nodeId) {
  const next = clone(record)
  const node = requireNode(next, nodeId)
  // A terminus carries no flag, so a flag query cannot sweep one up; its paired
  // project node is the scope's handle.
  if (node.kind === 'terminus') throw new Error('a terminus cannot be flagged; flag its project instead')
  node.flagged = !node.flagged
  return next
}

/** Mark nodeId as "here" on its line, clearing any existing "here" on that same line. */
export function makeHere(record, nodeId) {
  const next = clone(record)
  const node = requireNode(next, nodeId)
  if (node.kind !== 'task') throw new Error('only a task can hold the "here" mark')
  for (const id of lineIds(next, nodeId)) next.nodes[id].here = false
  next.nodes[nodeId].here = true
  return next
}

/** Clear the "here" cursor on nodeId's line (if any). */
export function clearHere(record, nodeId) {
  const next = clone(record)
  requireNode(next, nodeId)
  for (const id of lineIds(next, nodeId)) next.nodes[id].here = false
  return next
}

/**
 * Insert a task into the edge rising from `edgeId`: the new task becomes that
 * node's main-line successor and inherits its old one. This is the one way a task
 * is created, and it always names its edge — there is no default, because every
 * edit begins with a right-click on a node, and that click is what names it.
 *
 * Refused on a plan's closing terminus, which has no edge above it (the grammar
 * ends the plan there).
 */
export function insertTask(record, edgeId, title) {
  const next = clone(record)
  const at = requireNode(next, edgeId)
  if (isPlanClose(next, edgeId)) throw new Error('nothing can be inserted above a plan\'s closing terminus')
  const n = newTask(title)
  n.next = at.next
  at.next = n.id
  addNode(next, n)
  return normalizeReturns(next, record)
}

/**
 * The edge above nodeId, as the right-click menu's "add task above" means it.
 * Kept as its own name because that is what the menu says.
 */
export function addTaskAbove(record, nodeId, title) {
  return insertTask(record, nodeId, title)
}

/**
 * Push a new task onto the stack immediately below nodeId (toward the root): the
 * new task takes nodeId's place under its predecessor and points up at nodeId.
 * Refused below a root node — nothing precedes a project's base.
 */
export function addTaskBelow(record, nodeId, title) {
  const next = clone(record)
  requireNode(next, nodeId)
  const pred = predecessorOf(next, nodeId)
  if (!pred) throw new Error('cannot add a task below a root node')
  // The edge below nodeId rises from its main-line predecessor, so on that trunk
  // this is an insertion like any other. Below a branch's first node the edge is the
  // branch line itself, which holds nothing, so the new task takes its place as the
  // branch's first node instead.
  if (pred.kind === 'next') return insertTask(next, pred.id, title)
  const n = newTask(title)
  n.next = nodeId
  sideArray(next.nodes[pred.id], pred.side)[pred.index] = n.id
  addNode(next, n)
  return normalizeReturns(next, record)
}

// The alternating side for the next branch off a task: 1st left, 2nd right,
// 3rd left, ... unless an explicit side is given.
function branchSide(task, side) {
  if (side === 'left' || side === 'right') return side
  return branchCount(task) % 2 === 0 ? 'left' : 'right'
}

/**
 * Open a branch on the edge rising from `edgeId`: one move that creates three things,
 * the attachment, a first task inside it, and its return line. A branch is never created
 * empty, because it carries no title of its own and an empty one would assert nothing.
 *
 * Its merge point defaults to `edgeId` itself, the smallest legal branch, which says
 * that this strand runs alongside that one gap and nothing else; its lane defaults to
 * innermost, which costs no crossings for a span of one edge. Both are the author's to
 * change afterwards, the first with setMergePoint.
 *
 * Refused on a plan's closing terminus, which has no edge above it to leave.
 */
export function openBranch(record, edgeId, title, side) {
  const next = clone(record)
  const host = requireNode(next, edgeId)
  if (isPlanClose(next, edgeId)) throw new Error('a plan\'s closing terminus has no edge above it to open a branch on')
  requireRisingEdge(next, edgeId)
  const n = newTask(title)
  n.mergePoint = edgeId
  addBranch(host, n.id, branchSide(host, side))
  addNode(next, n)
  return next
}

/**
 * The branch on the edge above nodeId, as the right-click menu's "add branch above"
 * means it. Kept as its own name because that is what the menu says.
 */
export function addBranchAbove(record, nodeId, title, side) {
  return openBranch(record, nodeId, title, side)
}

/**
 * The branch on the edge below nodeId. A branch hangs from the node whose rising edge it
 * leaves, so the gap below nodeId belongs to nodeId's predecessor, and that is the edge
 * this opens. Refused where there is no such edge: below a root, since nothing precedes a
 * plan's base, and below the foot of a branch, whose lower neighbour is its own branch
 * line rather than a trunk edge.
 */
export function addBranchBelow(record, nodeId, title, side) {
  requireNode(record, nodeId)
  const pred = predecessorOf(record, nodeId)
  if (!pred) throw new Error('cannot add a branch below a root node')
  if (pred.kind !== 'next') throw new Error('cannot add a branch below the first node of a branch')
  return openBranch(record, pred.id, title, side)
}

/**
 * Move a branch's return line to the edge rising from `mergePointId`. The branch is named
 * by its foot, the node at the bottom of it; the merge point is stored on its tip, where
 * the return leaves.
 *
 * Refused when the target breaks one of the merge rules, and the refusal says what would
 * be legal instead: a merge sits on the trunk the branch left, at or above the branch's
 * own node, and inside exactly the scopes the branch's own edge is inside.
 */
export function setMergePoint(record, footId, mergePointId) {
  const next = clone(record)
  requireNode(next, footId)
  requireNode(next, mergePointId)
  const branch = branchesIn(next).find((b) => b.footId === footId)
  if (!branch) throw new Error('node "' + footId + '" is not the foot of a branch')
  const errors = mergeErrors(next, { ...branch, mergePoint: mergePointId }, indexRecord(next))
  if (errors.length) throw new Error(errors[0])
  next.nodes[branch.tipId].mergePoint = mergePointId
  return next
}

/**
 * Move a branch's attachment to the edge rising from `branchPointId`, the branch itself
 * travelling intact: its contents, its side, and its merge point all stay as they are.
 * The sibling of setMergePoint, moving the other end of the same object.
 *
 * Refused where the move would break a merge rule: the attachment stays on the trunk the
 * return joins, at or below the merge point (meeting it is the smallest legal branch, the
 * bubble), and inside exactly the scopes the return is inside. The rules are checked by
 * mergeErrors, whose words blame the merge end, so the refusal is prefixed with which end
 * actually moved. Moving a branch to the host it already hangs on is a no-op, returned
 * unchanged rather than re-run, since re-adding the foot would silently reorder its lane.
 */
export function setBranchPoint(record, footId, branchPointId) {
  const next = clone(record)
  requireNode(next, footId)
  requireNode(next, branchPointId)
  const branch = branchesIn(next).find((b) => b.footId === footId)
  if (!branch) throw new Error('node "' + footId + '" is not the foot of a branch')
  if (branchPointId === branch.hostId) return next
  const errors = mergeErrors(next, { ...branch, hostId: branchPointId }, indexRecord(next))
  if (errors.length) throw new Error('cannot move the branch point: ' + errors[0])
  rehostBranch(next, footId, branch.side, branch.hostId, branchPointId)
  return next
}

/**
 * Remove a node. Deleting a root removes the whole plan (a root has no
 * meaningful splice, since its replacement would be a task and a root must be a
 * project node). For a non-root: mode 'subtree' (default) removes the node's extent, which
 * is what grows from it within the scope it sits in, and joins the trunk across the gap;
 * mode 'splice' removes only the node and reconnects
 * its main-line successor (or, lacking one, its first fork) into its place, with
 * any remaining forks reattached to that new head. Returns the new record.
 *
 * A sub-project therefore dies as a scope, from its project node to its own close, and the
 * work that came after that close survives. An extent is bracket-matched, so no surviving
 * project is left unclosed and no close is left closing nothing.
 */
export function deleteTask(record, nodeId, mode = 'subtree') {
  const next = clone(record)
  const node = requireNode(next, nodeId)
  // A close is one half of a pair and has no life of its own to end. Its extent is the
  // scope it closes, so deleting it would quietly delete the whole scope, which is not
  // what was asked; the two things that were are named instead.
  if (node.kind === 'terminus') {
    throw new Error('a close cannot be deleted on its own: delete the project node to remove the scope, or unwrap it to keep what is inside')
  }
  const pred = predecessorOf(next, nodeId)

  if (!pred || mode !== 'splice') {
    const { ids } = liftExtent(next, nodeId)
    for (const id of ids) delete next.nodes[id]
    return normalizeReturns(next, record)
  }

  // splice. Only the node goes; its successor, or lacking one its first fork, takes its
  // slot under its predecessor, with any remaining forks reattached to that new head.
  const task = next.nodes[nodeId]
  const succ = task.next
  let head = null
  let leftover = branchesOf(task)
  if (succ) {
    head = succ
  } else if (leftover.length) {
    head = leftover[0].child
    leftover = leftover.slice(1)
  } else {
    leftover = []
  }
  if (head) {
    for (const b of leftover) addBranch(next.nodes[head], b.child, b.side, 'outermost')
  }
  if (pred.kind === 'next') {
    next.nodes[pred.id].next = head
  } else if (head) {
    sideArray(next.nodes[pred.id], pred.side)[pred.index] = head
  } else {
    sideArray(next.nodes[pred.id], pred.side).splice(pred.index, 1)
  }
  delete next.nodes[nodeId]
  return normalizeHeres(normalizeReturns(next, record))
}

/**
 * The node map for a clip of `rootId`: its extent, copied by value, with every edge that
 * leaves the clip cleared, so the clip stands alone as a plan of its own. A sub-project's
 * close points at the work above it on the trunk, which is no part of the clip, and
 * carrying that edge into a paste would wire the pasted copy into the record it came from.
 *
 * The pure half of copy: note contents are the caller's business, since only the caller can
 * read them (the renderer over IPC, the main process from disk).
 */
export function clipNodes(record, rootId) {
  const ids = extentOf(record, rootId)
  const nodes = {}
  for (const id of ids) {
    const node = structuredClone(record.nodes[id])
    if (node.next && !ids.has(node.next)) node.next = null
    if (node.mergePoint && !ids.has(node.mergePoint)) node.mergePoint = null
    for (const key of ['leftBranches', 'rightBranches']) {
      if (Array.isArray(node[key])) node[key] = node[key].filter((child) => ids.has(child))
    }
    nodes[id] = node
  }
  return nodes
}

/**
 * Paste a copied project into `record` as a fresh, independent tree. Every id in the
 * clip is regenerated (so a paste never collides with the source and the same
 * clip may be pasted repeatedly), each node is stamped with a new createdAt, and
 * any "here" cursor is cleared — a pasted tree opens with no cursor. Notes travel
 * by content, not by file: a node that carried a note is given a fresh note file
 * named for its new id, and that file's text is returned in `notes` for the
 * caller to write into the destination domain. The clip's (mapped) root id is
 * appended to planOrder, so the pasted tree lands to the right of the rest.
 *
 * `clip` is { rootId, tasks: { oldId: record }, notes: { oldId: content } }, the
 * snapshot bridge/api.js gathers at copy time. Returns { next, notes } where
 * notes is [{ file, content }]. Pure: neither `record` nor `clip` is mutated.
 */
export function pasteAsPlan(record, clip) {
  const next = clone(record)
  // A clip pastes as a plan of its own, and a plan is bounded by a project and its close, so
  // a clip rooted anywhere else cannot become one. Said here, where the clip is named, rather
  // than left to validateRecord to say at the end about a node the caller never mentioned.
  const clipRoot = clip && clip.nodes && clip.rootId ? clip.nodes[clip.rootId] : null
  if (!clipRoot) throw new Error('a clip must name a rootId present in its own nodes')
  if (clipRoot.kind !== 'project') throw new Error('a clip pastes as a plan, so its root must be a project; clip the project that contains this node instead')
  if (!Array.isArray(next.planOrder)) next.planOrder = []
  const idMap = new Map()
  for (const oldId of Object.keys(clip.nodes)) idMap.set(oldId, mintNodeId())
  const map = (id) => idMap.get(id) || id
  const stamp = nowISO()
  const notes = []
  for (const [oldId, rec] of Object.entries(clip.nodes)) {
    const newId = idMap.get(oldId)
    const node = structuredClone(rec)
    node.id = newId
    node.createdAt = stamp
    // Every edge is remapped or dropped, never carried over as it stands: an id the clip
    // does not contain names a node in whatever record the clip was taken from, and
    // pointing the paste at it would splice the two together. clipNodes already leaves no
    // such edge, but a clip can arrive from an MCP client, so the authority checks too.
    if (node.next) node.next = idMap.get(node.next) || null
    // A return inside the clip travels with it; one naming a node outside the clip has
    // nothing to point at, and relocateReturns gives that branch its own edge instead.
    if (node.mergePoint) node.mergePoint = idMap.get(node.mergePoint) || null
    node.leftBranches = (node.leftBranches || []).filter((id) => idMap.has(id)).map(map)
    node.rightBranches = (node.rightBranches || []).filter((id) => idMap.has(id)).map(map)
    if ('here' in node) node.here = false
    if (node.note) {
      node.note = noteFileName(newId, node.title)
      notes.push({ file: node.note, content: (clip.notes && clip.notes[oldId]) || '' })
    }
    // Keep pasted titles unique in the destination: check against the domain's
    // existing nodes and the pasted nodes already placed (uniqueTitle walks next.nodes).
    if (typeof node.title === 'string') node.title = uniqueTitle(next, node.title, null)
    next.nodes[newId] = node
  }
  next.planOrder.push(map(clip.rootId))
  return { next: normalizeReturns(next, record), notes }
}

// ---- drag-and-drop moves ----
//
// Two drop rules. Dropping a node onto a CARD grafts it there as a fresh fork (a
// new branch of the target). Dropping a node into the GAP between two nodes on a
// line splices it into that gap (moveIntoLine). Neither can put anything below a
// root, so the "nothing before the root" rule holds at every drop target. The
// menu's "move up / move down" are the keyboard-free counterpart: a clean swap of
// a node with its main-line neighbour that keeps its branches (moveUp/moveDown),
// distinct from moveIntoLine, where a task travels alone. See
// docs/interaction_model.md for the rules and moves.

/**
 * Take a node's extent off its trunk, whole: the run travels together, the trunk it leaves
 * is joined across the gap, and the record is left with the run detached and ready to be
 * re-attached elsewhere or deleted.
 *
 * The extent is bounded by the scope the node sits in (validate.js, extentOf), which is
 * what makes this more than cutting one edge. A sub-project travels as a pair, from its
 * project node to its own close, and what sat above that close stays behind; without the
 * bound the run would take the rest of the trunk with it, the enclosing plan's close
 * included, so neither side would be left a legal plan.
 *
 * A branch hanging on a node in the run but not itself in it stays behind too, re-homed
 * onto whatever now holds that edge, exactly as spliceOutNode does. In practice that is the
 * close of a lifted scope, whose rising edge belongs to what encloses the pair rather than
 * to the scope the pair delimits.
 *
 * Returns { ids, topId, above }: the extent, the node at the top of its trunk run, and the
 * node that took the run's place on the old trunk (null where nothing was above it).
 */
function liftExtent(next, id) {
  const ids = extentOf(next, id)
  let topId = id
  while (next.nodes[topId].next && ids.has(next.nodes[topId].next)) topId = next.nodes[topId].next
  const above = next.nodes[topId].next || null
  next.nodes[topId].next = null

  const pred = predecessorOf(next, id)
  if (!pred) {
    next.planOrder = (next.planOrder || []).filter((rid) => rid !== id)
  } else if (pred.kind === 'next') {
    next.nodes[pred.id].next = above
  } else if (above) {
    sideArray(next.nodes[pred.id], pred.side)[pred.index] = above
  } else {
    sideArray(next.nodes[pred.id], pred.side).splice(pred.index, 1)
  }

  // The edge a departing node held is now the predecessor's, or the successor's where the
  // run was a branch's foot. Lacking both, the branch stays put and rehomeOrphanedBranches
  // has the last word; a valid record cannot get here, since a branch on the top of a trunk
  // is already an error.
  const host = pred && pred.kind === 'next' ? next.nodes[pred.id] : (above ? next.nodes[above] : null)
  if (host) {
    for (const nodeId of ids) {
      const node = next.nodes[nodeId]
      const leaving = branchesOf(node).filter((b) => !ids.has(b.child))
      if (!leaving.length) continue
      for (const side of ['left', 'right']) {
        const key = SIDE_KEY[side]
        node[key] = node[key].filter((child) => ids.has(child))
      }
      for (const b of leaving) addBranch(host, b.child, b.side, 'outermost')
    }
  }
  return { ids, topId, above }
}

// Graft `id` as a fresh fork off `targetId` (alternating side). Refused where the target
// has no edge above it, since a branch has nowhere to hang there.
function graftBranch(next, targetId, id) {
  requireRisingEdge(next, targetId)
  const target = next.nodes[targetId]
  addBranch(target, id, branchSide(target))
}

// Splice a single task out of its line, leaving it detached and childless: its
// successor (or, lacking one, its first fork) takes its slot under its
// predecessor, with any remaining forks reattached to that new head — exactly the
// reconnection deleteTask's 'splice' mode performs. The node keeps its identity;
// only its edges are cleared, ready to be re-attached elsewhere.
function spliceOutTask(next, id) {
  const task = next.nodes[id]
  const pred = predecessorOf(next, id)
  if (!pred) throw new Error('a task node always has a predecessor')
  const succ = task.next
  let head = null
  let leftover = branchesOf(task)
  if (succ) {
    head = succ
  } else if (leftover.length) {
    head = leftover[0].child
    leftover = leftover.slice(1)
  } else {
    leftover = []
  }
  if (head) for (const b of leftover) addBranch(next.nodes[head], b.child, b.side, 'outermost')
  if (pred.kind === 'next') next.nodes[pred.id].next = head
  else if (head) sideArray(next.nodes[pred.id], pred.side)[pred.index] = head
  else sideArray(next.nodes[pred.id], pred.side).splice(pred.index, 1)
  task.next = null
  task.leftBranches = []
  task.rightBranches = []
  // A stored merge point belongs to the trunk this node is leaving, not to the node:
  // it says where THAT branch's return joins, and it is stored here only because this
  // node happened to be the branch's tip. Carried along, it is a live address in the
  // wrong place — landed on another branch's trunk, relocateReturns' topmost-wins sweep
  // would read it as that branch's return and silently rewrite it. The branch left
  // behind keeps its merge through normalizeReturns' wasOn map, which remembers it by
  // the branch's own foot.
  task.mergePoint = null
}

/**
 * Move a single task node onto a target, as a new fork of the target. The moved
 * task leaves its children behind: they are spliced onto its predecessor in its
 * place (exactly as deleteTask's 'splice' mode does), so only the one node
 * travels. Its "here" cursor travels with it; a splice that merges two lines is
 * repaired by normalizeHeres. Refuses a project node (use moveSubtree) and a drop
 * onto itself.
 */
export function moveTaskNode(record, id, targetId) {
  const next = clone(record)
  const node = requireNode(next, id)
  requireNode(next, targetId)
  if (id === targetId) throw new Error('cannot move a node onto itself')
  if (node.kind !== 'task') throw new Error('this move takes a node, which travels alone; a project travels with the plan it opens, and has its own move')
  spliceOutTask(next, id) // the node travels alone; its children stay on the line
  graftBranch(next, targetId, id)
  return normalizeHeres(normalizeReturns(next, record))
}

/**
 * Move a whole subtree (the node `rootId` and its extent) onto a target, as a new fork of
 * the target — graft/nest. The extent is lifted intact, so every "here" inside it travels,
 * and the trunk it left is joined across the gap. A sub-project therefore moves as a scope,
 * from its project node to its own close, and the work that came after that close stays
 * where it was. Refuses a drop onto itself or onto one of its own descendants (which would
 * detach a fragment and form a cycle).
 */
export function moveSubtree(record, rootId, targetId) {
  const next = clone(record)
  const node = requireNode(next, rootId)
  requireNode(next, targetId)
  if (node.kind !== 'project') throw new Error('this move takes a project and the plan it opens; a task travels alone, and has its own move')
  if (rootId === targetId) throw new Error('cannot move a node onto itself')
  if (extentOf(next, rootId).has(targetId)) throw new Error('cannot graft a subtree onto its own descendant')
  liftExtent(next, rootId)
  graftBranch(next, targetId, rootId)
  return normalizeHeres(normalizeReturns(next, record))
}

/**
 * Detach a sub-project into a plan of its own: it and its close leave the trunk they were
 * on, and what sat above that close stays behind. Only a project node can be a plan's base;
 * refuses a task node and one that is already a base.
 *
 * A scope travels as a pair, which is what makes this more than cutting one edge. The
 * detached plan runs from the project node to the terminus closing it, and the trunk it
 * leaves is rejoined across the gap, so neither side is left holding the other's close.
 * This is the way out when work genuinely does not rejoin, which axiom 3 calls a separate
 * plan rather than a branch.
 */
export function detachProject(record, id) {
  const next = clone(record)
  const node = requireNode(next, id)
  if (node.kind !== 'project') throw new Error('only a project node can become a root')
  if (!predecessorOf(next, id)) throw new Error('node is already a root')

  // Whatever was above the close takes the detached scope's place on the old trunk.
  liftExtent(next, id)

  if (!Array.isArray(next.planOrder)) next.planOrder = []
  next.planOrder.push(id)
  return normalizeReturns(next, record)
}

/**
 * Move a root to position `index` in the left-to-right tree order. planOrder is
 * advisory and may omit some roots (buildModel appends the unlisted by
 * createdAt); this canonicalises it to the full current root order first, then
 * places `rootId` at the clamped index, so the index is meaningful. Refuses a
 * non-root node.
 */
export function reorderRoot(record, rootId, index) {
  const next = clone(record)
  requireNode(next, rootId)
  if (predecessorOf(next, rootId)) throw new Error('only a plan\'s base can be reordered; this node sits inside a plan')
  const isRoot = (id) => !predecessorOf(next, id)
  const listed = (next.planOrder || []).filter((id) => next.nodes[id] && isRoot(id))
  const unlisted = Object.keys(next.nodes)
    .filter((id) => isRoot(id) && !listed.includes(id))
    .sort((a, b) => String(next.nodes[a].createdAt).localeCompare(String(next.nodes[b].createdAt)))
  const order = [...listed, ...unlisted]
  order.splice(order.indexOf(rootId), 1)
  order.splice(Math.max(0, Math.min(index, order.length)), 0, rootId)
  next.planOrder = order
  return next
}

/**
 * Splice a node into the gap on a line just above `belowId` (between belowId and
 * its current successor). A task travels alone (its children splice onto its old
 * predecessor); a project node carries its scope, from its own project node to its own
 * close, and that close then continues onto belowId's old successor, whilst the work that
 * stood above it stays on the trunk it came from. Detaching first, then reading belowId's
 * successor, keeps the rewiring correct even when belowId was the moved node's own
 * neighbour (in which case the result is a no-op). Refuses inserting a subtree into
 * its own line (a cycle) or above itself. "here" cursors travel; a merged line is
 * repaired by normalizeHeres.
 *
 * `carry`, optional, is { branchFeet, mergeFeet }: the junctions in that gap the caller
 * placed the node below, named by their branches' feet, which follow the node up. Absent,
 * every junction keeps its address on belowId, which is exactly the old behaviour.
 */
export function moveIntoLine(record, movedId, belowId, carry) {
  const next = clone(record)
  const moved = requireNode(next, movedId)
  requireMovable(moved)
  requireNode(next, belowId)
  if (movedId === belowId) throw new Error('cannot insert a node above itself')
  const isProject = moved.kind === 'project'
  if (isProject && extentOf(next, movedId).has(belowId)) throw new Error('cannot insert a subtree into its own line')
  // Resolved before the splice, so a refusal names what the caller was looking at.
  const carried = resolveCarry(next, movedId, belowId, carry)

  let topId
  if (isProject) {
    topId = liftExtent(next, movedId).topId // the scope leaves whole; its line continues from its close
  } else {
    spliceOutTask(next, movedId) // one task; its children stay behind
    topId = movedId
  }
  const below = next.nodes[belowId]
  const oldNext = below.next
  below.next = movedId
  next.nodes[topId].next = oldNext

  // The gap above belowId can hold junctions: departures of branches hanging on belowId,
  // arrivals of returns merging at belowId. The carry names the ones the drop placed the
  // node BELOW; they are re-addressed to the top of what was spliced in (the node itself,
  // or a moved project's own close), so the record ends as the drop looked. Every carried
  // address is then re-checked against the merge rules and the whole edit refused on any
  // failure: this mutation is on the open op allowlist, so it cannot assume its caller
  // sends only sane carries, and a bad one must never be "handled" by the silent clamp
  // in normalizeReturns.
  if (carried.branchFeet.length || carried.mergeFeet.length) {
    for (const c of carried.branchFeet) rehostBranch(next, c.footId, c.side, belowId, topId, 'outermost')
    for (const c of carried.mergeFeet) {
      // Re-found after the splice; its trunk cannot contain the moved node (resolveCarry
      // refused that), so the branch itself is unchanged and only its address moves.
      const b = branchesIn(next).find((x) => x.footId === c.footId)
      next.nodes[b.tipId].mergePoint = topId
    }
    const ix = indexRecord(next)
    const feet = new Set([...carried.branchFeet, ...carried.mergeFeet].map((c) => c.footId))
    for (const b of branchesIn(next)) {
      if (!feet.has(b.footId)) continue
      const errs = mergeErrors(next, b, ix)
      if (errs.length) throw new Error('cannot carry the junction: ' + errs[0])
    }
  }
  return normalizeHeres(normalizeReturns(next, record))
}

// Validate a moveIntoLine carry against the record as the caller saw it. Each entry names
// a branch by its foot; a branch junction must actually hang on belowId, a merge junction
// must actually merge at belowId, and no carried branch may contain the node being moved,
// whose splice-out would leave the entry naming a branch that no longer looks like that.
function resolveCarry(record, movedId, belowId, carry) {
  const out = { branchFeet: [], mergeFeet: [] }
  if (!carry) return out
  const all = branchesIn(record)
  const check = (footId, want) => {
    const b = all.find((x) => x.footId === footId)
    if (!b || (want === 'branch' ? b.hostId !== belowId : b.mergePoint !== belowId)) {
      throw new Error('"' + footId + '" is not the foot of a branch ' + (want === 'branch' ? 'hanging on' : 'merging at') + ' "' + belowId + '"')
    }
    if (b.trunk.includes(movedId)) {
      throw new Error('cannot carry a junction of the branch the moved node is on; drop the node first, then move the junction')
    }
    return b
  }
  for (const footId of carry.branchFeet || []) out.branchFeet.push({ footId, side: check(footId, 'branch').side })
  for (const footId of carry.mergeFeet || []) { check(footId, 'merge'); out.mergeFeet.push({ footId }) }
  return out
}

// Swap aId with its main-line successor, keeping each node's own branches: the two
// exchange positions on the line. aId's predecessor (main line or branch) is
// repointed at the successor, which then points back at aId.
function swapWithSuccessor(next, aId) {
  const a = next.nodes[aId]
  const bId = a.next
  const b = next.nodes[bId]
  const pred = predecessorOf(next, aId)
  if (pred) {
    if (pred.kind === 'next') next.nodes[pred.id].next = bId
    else sideArray(next.nodes[pred.id], pred.side)[pred.index] = bId
  }
  a.next = b.next
  b.next = aId
}

/**
 * Move a node one step toward the tip: swap it with its main-line successor,
 * preserving both nodes' branches. Refuses a node with no successor, and a root
 * (whose successor becoming the base would leave a non-project root).
 */
export function moveUp(record, id) {
  const next = clone(record)
  const node = requireNode(next, id)
  requireMovable(node)
  if (!node.next) throw new Error('nothing above to swap with')
  if (!predecessorOf(next, id)) throw new Error('cannot move a root up')
  swapWithSuccessor(next, id)
  return normalizeHeres(normalizeReturns(next, record))
}

/**
 * Move a node one step toward the root: swap it with its main-line predecessor.
 * Equivalent to moving that predecessor up. Refuses a node with no main-line
 * predecessor (a line start), and a swap that would drop the node below a root.
 */
export function moveDown(record, id) {
  const next = clone(record)
  requireMovable(requireNode(next, id))
  const pred = predecessorOf(next, id)
  if (!pred || pred.kind !== 'next') throw new Error('no main-line predecessor to swap with')
  if (!predecessorOf(next, pred.id)) throw new Error('cannot move below the root')
  swapWithSuccessor(next, pred.id)
  return normalizeHeres(normalizeReturns(next, record))
}
