// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pure edit operations, one per right-click menu action (see
// docs/model_ideas.md, "Editing"). Each takes the raw forest object (the
// parsed-and-validated JSON5 shape, not the buildForest() runtime model) and
// returns a NEW raw forest object; none mutate their argument, so every edit is
// serializable and can be re-validated with validateForest() before it is
// applied and saved. New task ids come from model/ids.js; timestamps are ISO
// strings stamped at edit time.

import { mintTaskId, mintTreeId } from './ids.js'

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
    status: 'todo',
    createdAt: nowISO(),
    completedAt: null,
    note: null,
    here: false,
    next: null,
    branches: [],
  }
}

// The task whose .next or whose branch points at taskId, or null if taskId is a
// tree root. validateForest guarantees at most one such incoming edge.
function predecessorOf(raw, taskId) {
  for (const [id, task] of Object.entries(raw.tasks)) {
    if (task.next === taskId) return { id, kind: 'next' }
    const bi = (task.branches || []).findIndex((b) => b.child === taskId)
    if (bi !== -1) return { id, kind: 'branch', branchIndex: bi }
  }
  return null
}

// The tree entry a task belongs to (by walking every tree's reachable set).
function treeOf(raw, taskId) {
  for (const tree of raw.trees) {
    const stack = [tree.rootTaskId]
    const seen = new Set()
    while (stack.length) {
      const id = stack.pop()
      if (seen.has(id)) continue
      seen.add(id)
      if (id === taskId) return tree
      const t = raw.tasks[id]
      if (!t) continue
      if (t.next) stack.push(t.next)
      for (const b of t.branches || []) stack.push(b.child)
    }
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
// at a tree root or a branch child (the first task with no main-line
// predecessor) and runs up through .next to the tip.
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
// so the ≤1-here-per-line invariant holds. Harmless when nothing merged.
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
 * Start a new tree in the forest: a fresh root task titled `name`, under a new
 * tree carrying the same name. The one way to begin a stack from nothing (e.g.
 * an empty domain, or after the last tree was deleted).
 */
export function addTree(raw, name) {
  const next = clone(raw)
  const root = newTask(name)
  next.tasks[root.id] = root
  next.trees.push({ id: mintTreeId(), name: String(name && name.length ? name : 'New tree'), rootTaskId: root.id })
  return next
}

/** Set a task's title. */
export function setTitle(raw, taskId, title) {
  const next = clone(raw)
  requireTask(next, taskId).title = String(title)
  return next
}

/** Set a task's status. Completing stamps completedAt; leaving completed clears it. */
export function setStatus(raw, taskId, status) {
  if (!STATUSES.includes(status)) throw new Error('invalid status "' + status + '"')
  const next = clone(raw)
  const task = requireTask(next, taskId)
  task.status = status
  if (status === 'completed') task.completedAt = task.completedAt || nowISO()
  else task.completedAt = null
  return next
}

/** Mark taskId as "here" on its line, clearing any existing "here" on that same line. */
export function makeHere(raw, taskId) {
  const next = clone(raw)
  requireTask(next, taskId)
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
 * successor and inherits taskId's old successor. This is what decides a child
 * is main-line rather than a branch.
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
 * Push a new task onto the stack immediately below taskId (toward the root):
 * the new task takes taskId's place under its predecessor and points up at
 * taskId. Below a tree root, the new task becomes the tree's new root.
 */
export function addTaskBelow(raw, taskId, title) {
  const next = clone(raw)
  requireTask(next, taskId)
  const n = newTask(title)
  n.next = taskId
  const pred = predecessorOf(next, taskId)
  if (!pred) {
    const tree = treeOf(next, taskId)
    if (tree) tree.rootTaskId = n.id
  } else if (pred.kind === 'next') {
    next.tasks[pred.id].next = n.id
  } else {
    next.tasks[pred.id].branches[pred.branchIndex].child = n.id
  }
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

/** Fork a new parallel stack off taskId at the gap below it (alternating side). */
export function addBranchBelow(raw, taskId, title, side) {
  const next = clone(raw)
  const task = requireTask(next, taskId)
  const n = newTask(title)
  task.branches.push({ child: n.id, side: branchSide(task, side), at: 'below' })
  next.tasks[n.id] = n
  return next
}

/**
 * Remove a task. mode 'subtree' (default) removes the task and everything
 * growing from it; mode 'splice' removes only the task and reconnects its
 * main-line successor (or, lacking one, its first fork) into its place, with
 * any remaining forks reattached to that new head. Deleting a tip is identical
 * under either mode. Returns the new forest.
 */
export function deleteTask(raw, taskId, mode = 'subtree') {
  const next = clone(raw)
  requireTask(next, taskId)
  const pred = predecessorOf(next, taskId)

  const detachFromPred = (replacement) => {
    if (!pred) {
      const tree = treeOf(next, taskId)
      if (!tree) return
      if (replacement) tree.rootTaskId = replacement
      else next.trees = next.trees.filter((t) => t !== tree)
    } else if (pred.kind === 'next') {
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
