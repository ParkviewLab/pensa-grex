// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Load-time invariants for a parsed forest object (see docs/model_ideas.md for
// the schema this enforces). Pure and side-effect free: it only reads raw and
// returns { ok, errors }, so a caller decides whether to refuse a bad file or
// surface the errors to the user.

const VALID_STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

// Every task belongs to exactly one "line": the maximal run of tasks reached
// by following .next from a line start. A line starts at a tree root or at
// any branch's child (a fork begins a new stack). Returns an array of arrays
// of task ids, one per line.
function collectLines(raw) {
  const starts = []
  for (const tree of raw.trees || []) starts.push(tree.rootTaskId)
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

// DFS from every tree root, following .next and .branches[].child, detecting
// cycles (a node revisited while still on the current path) and collecting
// every reachable task id, so unreachable tasks can be reported too.
function walkReachable(raw, errors) {
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
      errors.push('missing task "' + taskId + '" referenced from ' + (path[path.length - 1] || '(a tree root)'))
      return
    }
    visiting.add(taskId)
    if (task.next) walk(task.next, path.concat(taskId))
    for (const b of task.branches || []) walk(b.child, path.concat(taskId))
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const tree of raw.trees || []) walk(tree.rootTaskId, [])
  return visited
}

export function validateForest(raw) {
  const errors = []

  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['forest is not an object'] }
  if (raw.schema !== 1) errors.push('unsupported schema version: ' + raw.schema)
  if (!raw.tasks || typeof raw.tasks !== 'object') errors.push('forest.tasks is missing or not an object')
  if (!Array.isArray(raw.trees)) errors.push('forest.trees is missing or not an array')
  if (errors.length) return { ok: false, errors }

  const tasks = raw.tasks
  const taskIds = Object.keys(tasks)

  for (const [id, task] of Object.entries(tasks)) {
    if (task.id !== id) errors.push('task key "' + id + '" does not match its own id field "' + task.id + '"')
    if (!VALID_STATUSES.includes(task.status)) errors.push('task "' + id + '" has an invalid status: ' + task.status)
    if (task.status === 'completed' && !task.completedAt) errors.push('task "' + id + '" is completed but has no completedAt')
    if (task.status !== 'completed' && task.completedAt) errors.push('task "' + id + '" has completedAt but is not completed')
  }

  // Every tree's root must exist and have no incoming edge.
  const rootIds = new Set()
  for (const tree of raw.trees) {
    if (!tree.id || !tree.name || !tree.rootTaskId) { errors.push('tree is missing id, name, or rootTaskId: ' + JSON.stringify(tree)); continue }
    if (!tasks[tree.rootTaskId]) errors.push('tree "' + tree.id + '" root task "' + tree.rootTaskId + '" does not exist')
    rootIds.add(tree.rootTaskId)
  }

  // Every non-root task has exactly one incoming edge: someone's .next XOR
  // someone's branch.child — never both, never neither.
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
  for (const id of taskIds) {
    const sources = incoming.get(id)
    if (rootIds.has(id)) {
      if (sources.length) errors.push('root task "' + id + '" has an incoming edge (' + sources.join(', ') + '); a root must have none')
    } else if (sources.length === 0) {
      errors.push('task "' + id + '" is unreachable: no tree root and no incoming edge')
    } else if (sources.length > 1) {
      errors.push('task "' + id + '" has more than one incoming edge: ' + sources.join(', '))
    }
  }

  const reachable = walkReachable(raw, errors)
  for (const id of taskIds) {
    if (!reachable.has(id) && !errors.some((e) => e.includes('"' + id + '"'))) {
      errors.push('task "' + id + '" is not reachable from any tree root')
    }
  }

  for (const line of collectLines(raw)) {
    const hereCount = line.filter((id) => tasks[id] && tasks[id].here).length
    if (hereCount > 1) errors.push('branch starting at "' + line[0] + '" has ' + hereCount + ' "here" cursors; at most one is allowed')
  }

  return { ok: errors.length === 0, errors }
}
