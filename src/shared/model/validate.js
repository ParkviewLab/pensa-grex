// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Load-time invariants for a parsed forest object (see docs/model_ideas.md for
// the schema this enforces). Pure and side-effect free: it only reads raw and
// returns { ok, errors }, so a caller decides whether to refuse a bad file or
// surface the errors to the user. A forest older than the current schema must be
// brought up to date with migrate.js first.
//
// Schema 2 (Sub-Projects): every node has a kind ('task' | 'project'); a task
// carries a status and may hold "here", a project node has neither. Roots are
// structural — a node with no incoming edge — and every root must be a project
// node (nothing precedes a project's base).

const VALID_STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

// Every node belongs to exactly one "line": the maximal run reached by following
// .next from a line start. A line starts at a root or at any branch's child (a
// fork begins a new stack). Returns an array of arrays of node ids, one per line.
function collectLines(raw, rootIds) {
  const starts = [...rootIds]
  for (const task of Object.values(raw.tasks || {})) {
    for (const b of task.branches || []) starts.push(b.child)
  }
  const lines = []
  for (const start of starts) {
    const line = []
    let id = start
    const seen = new Set()
    while (id && !seen.has(id)) {
      seen.add(id)
      line.push(id)
      const task = raw.tasks[id]
      id = task ? task.next : null
    }
    lines.push(line)
  }
  return lines
}

// DFS from every root, following .next and .branches[].child, detecting cycles
// (a node revisited while still on the current path) and collecting every
// reachable node id, so unreachable nodes (including detached cycles) can be
// reported too.
function walkReachable(raw, rootIds, errors) {
  const visiting = new Set()
  const visited = new Set()

  function walk(taskId, path) {
    if (visiting.has(taskId)) {
      errors.push('cycle detected: ' + path.concat(taskId).join(' -> '))
      return
    }
    if (visited.has(taskId)) return
    const task = raw.tasks[taskId]
    if (!task) {
      errors.push('missing task "' + taskId + '" referenced from ' + (path[path.length - 1] || '(a root)'))
      return
    }
    visiting.add(taskId)
    if (task.next) walk(task.next, path.concat(taskId))
    for (const b of task.branches || []) walk(b.child, path.concat(taskId))
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const id of rootIds) walk(id, [])
  return visited
}

export function validateForest(raw) {
  const errors = []

  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['forest is not an object'] }
  if (raw.schema !== 2) errors.push('unsupported schema version: ' + raw.schema)
  if (!raw.tasks || typeof raw.tasks !== 'object') errors.push('forest.tasks is missing or not an object')
  if (raw.rootOrder != null && !Array.isArray(raw.rootOrder)) errors.push('forest.rootOrder is not an array')
  if (errors.length) return { ok: false, errors }

  const tasks = raw.tasks
  const taskIds = Object.keys(tasks)

  // Incoming edges: someone's .next XOR someone's branch.child. A node with none
  // is a root; one is normal; more than one is an error (never both next and
  // branch, never two branches).
  const incoming = new Map(taskIds.map((id) => [id, []]))
  for (const [id, task] of Object.entries(tasks)) {
    if (task.next) {
      if (!incoming.has(task.next)) errors.push('task "' + id + '" .next references unknown task "' + task.next + '"')
      else incoming.get(task.next).push('next of ' + id)
    }
    for (const b of task.branches || []) {
      if (!incoming.has(b.child)) errors.push('task "' + id + '" branch references unknown task "' + b.child + '"')
      else incoming.get(b.child).push('branch of ' + id)
    }
  }
  const rootIds = new Set(taskIds.filter((id) => incoming.get(id).length === 0))

  for (const [id, task] of Object.entries(tasks)) {
    if (task.id !== id) errors.push('task key "' + id + '" does not match its own id field "' + task.id + '"')
    if (task.kind !== 'task' && task.kind !== 'project') {
      errors.push('node "' + id + '" has an invalid kind: ' + task.kind)
      continue
    }
    if (task.kind === 'task') {
      if (!VALID_STATUSES.includes(task.status)) errors.push('task "' + id + '" has an invalid status: ' + task.status)
      if (task.status === 'completed' && !task.completedAt) errors.push('task "' + id + '" is completed but has no completedAt')
      if (task.status !== 'completed' && task.completedAt) errors.push('task "' + id + '" has completedAt but is not completed')
    } else {
      if (task.status != null) errors.push('project node "' + id + '" must not have a status')
      if (task.completedAt != null) errors.push('project node "' + id + '" must not have completedAt')
      if (task.here) errors.push('project node "' + id + '" must not be "here"')
    }
  }

  // A root must be a project node; a non-root has exactly one incoming edge.
  for (const id of taskIds) {
    const sources = incoming.get(id)
    if (rootIds.has(id)) {
      if (tasks[id].kind !== 'project') errors.push('root node "' + id + '" must be a project node (a root has no incoming edge)')
    } else if (sources.length > 1) {
      errors.push('task "' + id + '" has more than one incoming edge: ' + sources.join(', '))
    }
  }

  const reachable = walkReachable(raw, rootIds, errors)
  for (const id of taskIds) {
    if (!reachable.has(id) && !errors.some((e) => e.includes('"' + id + '"'))) {
      errors.push('task "' + id + '" is not reachable from any root')
    }
  }

  for (const line of collectLines(raw, rootIds)) {
    const hereCount = line.filter((id) => tasks[id] && tasks[id].here).length
    if (hereCount > 1) errors.push('branch starting at "' + line[0] + '" has ' + hereCount + ' "here" cursors; at most one is allowed')
  }

  return { ok: errors.length === 0, errors }
}
