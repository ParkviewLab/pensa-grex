// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pure edit operations, one per right-click menu action (see
// docs/model_ideas.md, "Editing"). Each takes the raw forest object (the
// parsed-and-validated JSON5 shape, not the buildForest() runtime model) and
// returns a NEW raw forest object; none mutate their argument, so every edit is
// serializable and can be re-validated with validateForest() before it is
// applied and saved. New node ids come from model/ids.js; timestamps are ISO
// strings stamped at edit time.
//
// Two node kinds (schema 2): a `task` carries a status and can hold the "here"
// cursor; a `project` node has neither and roots a project (its subtree). Every
// tree's root is a project node, and a root has no incoming edge, so nothing can
// be added below it (see docs/northstar.md, axiom 2).

import { mintTaskId } from './ids.js'

const STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

function clone(raw) {
  return structuredClone(raw)
}

function nowISO() {
  return new Date().toISOString()
}

function newTask(title) {
  return {
    id: mintTaskId(),
    title: typeof title === 'string' && title.length ? title : 'New task',
    kind: 'task',
    status: 'todo',
    createdAt: nowISO(),
    completedAt: null,
    note: null,
    here: false,
    next: null,
    branches: [],
  }
}

function newProjectNode(title) {
  return {
    id: mintTaskId(),
    title: typeof title === 'string' && title.length ? title : 'New project',
    kind: 'project',
    createdAt: nowISO(),
    note: null,
    next: null,
    branches: [],
  }
}

// The task whose .next or whose branch points at taskId, or null if taskId is a
// root. validateForest guarantees at most one such incoming edge.
function predecessorOf(raw, taskId) {
  for (const [id, task] of Object.entries(raw.tasks)) {
    if (task.next === taskId) return { id, kind: 'next' }
    const bi = (task.branches || []).findIndex((b) => b.child === taskId)
    if (bi !== -1) return { id, kind: 'branch', branchIndex: bi }
  }
  return null
}

// Every id reachable from startId (inclusive), following .next and branches —
// i.e. the subtree rooted at startId.
function subtreeIds(raw, startId) {
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

// The ids on taskId's line: the maximal .next chain it sits on. The line starts
// at a root or a branch child (the first node with no main-line predecessor) and
// runs up through .next to the tip.
function lineIds(raw, taskId) {
  let start = taskId
  for (;;) {
    const pred = predecessorOf(raw, start)
    if (pred && pred.kind === 'next') start = pred.id
    else break
  }
  const ids = []
  let id = start
  const seen = new Set()
  while (id && raw.tasks[id] && !seen.has(id)) {
    seen.add(id)
    ids.push(id)
    id = raw.tasks[id].next
  }
  return ids
}

// After a splice can merge two lines, a line may carry more than one "here".
// Keep the one nearest the tip (the most-advanced cursor) and clear the rest,
// so the <=1-here-per-line invariant holds. Harmless when nothing merged.
function normalizeHeres(raw) {
  const seenLineStart = new Set()
  for (const id of Object.keys(raw.tasks)) {
    const line = lineIds(raw, id)
    const startKey = line[0]
    if (seenLineStart.has(startKey)) continue
    seenLineStart.add(startKey)
    const heres = line.filter((tid) => raw.tasks[tid].here)
    if (heres.length > 1) {
      const keep = heres[heres.length - 1]
      for (const tid of heres) if (tid !== keep) raw.tasks[tid].here = false
    }
  }
  return raw
}

function requireTask(raw, taskId) {
  if (!raw.tasks[taskId]) throw new Error('unknown task "' + taskId + '"')
  return raw.tasks[taskId]
}

/**
 * Start a new project in the forest: a fresh project-node root titled `name`,
 * appended to rootOrder. The one way to begin a tree from nothing (an empty
 * domain, or after the last tree was deleted). The root carries the project's
 * name; tasks are grown above it.
 */
export function addTree(raw, name) {
  const next = clone(raw)
  const root = newProjectNode(name)
  next.tasks[root.id] = root
  if (!Array.isArray(next.rootOrder)) next.rootOrder = []
  next.rootOrder.push(root.id)
  return next
}

/** Set a node's title. */
export function setTitle(raw, taskId, title) {
  const next = clone(raw)
  requireTask(next, taskId).title = String(title)
  return next
}

/** Record (or clear, with null) a node's note filename, which drives the note dot. */
export function setNote(raw, taskId, filename) {
  const next = clone(raw)
  requireTask(next, taskId).note = filename || null
  return next
}

/** Set a task's status. Completing stamps completedAt; leaving completed clears it. */
export function setStatus(raw, taskId, status) {
  if (!STATUSES.includes(status)) throw new Error('invalid status "' + status + '"')
  const next = clone(raw)
  const task = requireTask(next, taskId)
  if (task.kind === 'project') throw new Error('a project node has no status')
  task.status = status
  if (status === 'completed') task.completedAt = task.completedAt || nowISO()
  else task.completedAt = null
  return next
}

/**
 * Toggle a node between task and project (a "sub-project"). Task -> project
 * DISCARDS status/completedAt and clears the cursor (a project has none); a
 * round-trip therefore resets a task to 'todo'. A root is always a project node,
 * so its kind cannot be changed.
 */
export function convertKind(raw, taskId) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  if (!predecessorOf(next, taskId)) throw new Error('cannot change the kind of a root node')
  if (task.kind === 'project') {
    task.kind = 'task'
    task.status = 'todo'
    task.completedAt = null
    task.here = false
  } else {
    task.kind = 'project'
    delete task.status
    delete task.completedAt
    delete task.here
  }
  return next
}

/** Mark taskId as "here" on its line, clearing any existing "here" on that same line. */
export function makeHere(raw, taskId) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  if (task.kind === 'project') throw new Error('cannot set "here" on a project node')
  for (const id of lineIds(next, taskId)) next.tasks[id].here = false
  next.tasks[taskId].here = true
  return next
}

/** Clear the "here" cursor on taskId's line (if any). */
export function clearHere(raw, taskId) {
  const next = clone(raw)
  requireTask(next, taskId)
  for (const id of lineIds(next, taskId)) next.tasks[id].here = false
  return next
}

/**
 * Push a new task onto the stack immediately above taskId (further from the
 * root), continuing the main line: the new task becomes taskId's main-line
 * successor and inherits taskId's old successor.
 */
export function addTaskAbove(raw, taskId, title) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  const n = newTask(title)
  n.next = task.next
  task.next = n.id
  next.tasks[n.id] = n
  return next
}

/**
 * Push a new task onto the stack immediately below taskId (toward the root): the
 * new task takes taskId's place under its predecessor and points up at taskId.
 * Refused below a root node — nothing precedes a project's base.
 */
export function addTaskBelow(raw, taskId, title) {
  const next = clone(raw)
  requireTask(next, taskId)
  const pred = predecessorOf(next, taskId)
  if (!pred) throw new Error('cannot add a task below a root node')
  const n = newTask(title)
  n.next = taskId
  if (pred.kind === 'next') next.tasks[pred.id].next = n.id
  else next.tasks[pred.id].branches[pred.branchIndex].child = n.id
  next.tasks[n.id] = n
  return next
}

// The alternating side for the next branch off a task: 1st left, 2nd right,
// 3rd left, ... unless an explicit side is given.
function branchSide(task, side) {
  if (side === 'left' || side === 'right') return side
  return task.branches.length % 2 === 0 ? 'left' : 'right'
}

/** Fork a new parallel stack off taskId at the gap above it (alternating side). */
export function addBranchAbove(raw, taskId, title, side) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  const n = newTask(title)
  task.branches.push({ child: n.id, side: branchSide(task, side), at: 'above' })
  next.tasks[n.id] = n
  return next
}

/**
 * Fork a new parallel stack off taskId at the gap below it (alternating side).
 * Refused below a root node — a root has no gap below it.
 */
export function addBranchBelow(raw, taskId, title, side) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  if (!predecessorOf(next, taskId)) throw new Error('cannot add a branch below a root node')
  const n = newTask(title)
  task.branches.push({ child: n.id, side: branchSide(task, side), at: 'below' })
  next.tasks[n.id] = n
  return next
}

/**
 * Remove a node. Deleting a root removes the whole project (a root has no
 * meaningful splice, since its replacement would be a task and a root must be a
 * project node). For a non-root: mode 'subtree' (default) removes the node and
 * everything growing from it; mode 'splice' removes only the node and reconnects
 * its main-line successor (or, lacking one, its first fork) into its place, with
 * any remaining forks reattached to that new head. Returns the new forest.
 */
export function deleteTask(raw, taskId, mode = 'subtree') {
  const next = clone(raw)
  requireTask(next, taskId)
  const pred = predecessorOf(next, taskId)

  if (!pred) {
    const doomed = subtreeIds(next, taskId)
    next.rootOrder = (next.rootOrder || []).filter((id) => id !== taskId)
    for (const id of doomed) delete next.tasks[id]
    return next
  }

  const detachFromPred = (replacement) => {
    if (pred.kind === 'next') {
      next.tasks[pred.id].next = replacement
    } else if (replacement) {
      next.tasks[pred.id].branches[pred.branchIndex].child = replacement
    } else {
      next.tasks[pred.id].branches.splice(pred.branchIndex, 1)
    }
  }

  if (mode === 'splice') {
    const task = next.tasks[taskId]
    const succ = task.next
    let head = null
    let leftover = task.branches
    if (succ) {
      head = succ
    } else if (task.branches.length) {
      head = task.branches[0].child
      leftover = task.branches.slice(1)
    } else {
      leftover = []
    }
    if (head) {
      for (const b of leftover) {
        next.tasks[head].branches.push({ child: b.child, side: b.side, at: b.at })
      }
    }
    detachFromPred(head)
    delete next.tasks[taskId]
    return normalizeHeres(next)
  }

  // subtree
  const doomed = subtreeIds(next, taskId)
  detachFromPred(null)
  for (const id of doomed) delete next.tasks[id]
  return next
}
