// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Load-time invariants for a parsed record (see docs/model_v3_ideas.md for the
// schema this enforces). Pure and side-effect free: it only reads the record and
// returns { ok, errors }, so a caller decides whether to refuse a bad file or
// surface the errors to the user. A record older than the current schema must be
// brought up to date with migrate.js first.
//
// Schema 3, as far as this stage takes it: every node has a kind ('task' |
// 'project'); a task carries a status and may hold "here", a project node has
// neither. A node's forks are two ordered arrays of child ids, `leftBranches` and
// `rightBranches`, both naming the edge that RISES from the node holding them, so
// there is no separate "above or below" to store. Roots are structural — a node
// with no incoming edge — and every root must be a project node.
//
// The terminus kind, the grammar it brings, and merges are not here yet; they
// arrive with stages 5 and 6.

const VALID_STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

// A node's forks, both sides, in one list. Order is left then right; within a
// side it is the author's stored order.
export function branchChildrenOf(node) {
  const left = Array.isArray(node && node.leftBranches) ? node.leftBranches : []
  const right = Array.isArray(node && node.rightBranches) ? node.rightBranches : []
  return [...left.map((child) => ({ child, side: 'left' })), ...right.map((child) => ({ child, side: 'right' }))]
}

// Every node belongs to exactly one "line": the maximal run reached by following
// .next from a line start. A line starts at a root or at any branch's child (a
// fork begins a new line). Returns an array of arrays of node ids, one per line.
function collectLines(record, rootIds) {
  const starts = [...rootIds]
  for (const node of Object.values(record.nodes || {})) {
    for (const b of branchChildrenOf(node)) starts.push(b.child)
  }
  const lines = []
  for (const start of starts) {
    const line = []
    let id = start
    const seen = new Set()
    while (id && !seen.has(id)) {
      seen.add(id)
      line.push(id)
      const node = record.nodes[id]
      id = node ? node.next : null
    }
    lines.push(line)
  }
  return lines
}

// DFS from every root, following .next and both branch arrays, detecting cycles
// (a node revisited while still on the current path) and collecting every
// reachable node id, so unreachable nodes (including detached cycles) can be
// reported too.
function walkReachable(record, rootIds, errors) {
  const visiting = new Set()
  const visited = new Set()

  function walk(nodeId, path) {
    if (visiting.has(nodeId)) {
      errors.push('cycle detected: ' + path.concat(nodeId).join(' -> '))
      return
    }
    if (visited.has(nodeId)) return
    const node = record.nodes[nodeId]
    if (!node) {
      errors.push('missing node "' + nodeId + '" referenced from ' + (path[path.length - 1] || '(a root)'))
      return
    }
    visiting.add(nodeId)
    if (node.next) walk(node.next, path.concat(nodeId))
    for (const b of branchChildrenOf(node)) walk(b.child, path.concat(nodeId))
    visiting.delete(nodeId)
    visited.add(nodeId)
  }

  for (const id of rootIds) walk(id, [])
  return visited
}

export function validateRecord(record) {
  const errors = []

  if (!record || typeof record !== 'object') return { ok: false, errors: ['record is not an object'] }
  if (record.schemaVersion !== 3) errors.push('unsupported schema version: ' + record.schemaVersion)
  if (!record.nodes || typeof record.nodes !== 'object') errors.push('record.nodes is missing or not an object')
  if (record.planOrder != null && !Array.isArray(record.planOrder)) errors.push('record.planOrder is not an array')
  if (record.title != null && typeof record.title !== 'string') errors.push('record.title is not a string')
  if (errors.length) return { ok: false, errors }

  const nodes = record.nodes
  const nodeIds = Object.keys(nodes)

  for (const [id, node] of Object.entries(nodes)) {
    for (const key of ['leftBranches', 'rightBranches']) {
      if (node[key] != null && !Array.isArray(node[key])) {
        errors.push('node "' + id + '" has a ' + key + ' that is not an array')
      }
    }
  }
  if (errors.length) return { ok: false, errors }

  // Incoming edges: someone's .next XOR someone's branch child. A node with none
  // is a root; one is normal; more than one is an error (never both next and
  // branch, never two branches, never the same child on both sides).
  const incoming = new Map(nodeIds.map((id) => [id, []]))
  for (const [id, node] of Object.entries(nodes)) {
    if (node.next) {
      if (!incoming.has(node.next)) errors.push('node "' + id + '" .next references unknown node "' + node.next + '"')
      else incoming.get(node.next).push('next of ' + id)
    }
    for (const b of branchChildrenOf(node)) {
      if (!incoming.has(b.child)) errors.push('node "' + id + '" branch references unknown node "' + b.child + '"')
      else incoming.get(b.child).push(b.side + ' branch of ' + id)
    }
  }
  const rootIds = new Set(nodeIds.filter((id) => incoming.get(id).length === 0))

  for (const [id, node] of Object.entries(nodes)) {
    if (node.id !== id) errors.push('node key "' + id + '" does not match its own id field "' + node.id + '"')
    if (node.kind !== 'task' && node.kind !== 'project') {
      errors.push('node "' + id + '" has an invalid kind: ' + node.kind)
      continue
    }
    if (node.kind === 'task') {
      if (!VALID_STATUSES.includes(node.status)) errors.push('task "' + id + '" has an invalid status: ' + node.status)
      if (node.status === 'completed' && !node.completedAt) errors.push('task "' + id + '" is completed but has no completedAt')
      if (node.status !== 'completed' && node.completedAt) errors.push('task "' + id + '" has completedAt but is not completed')
    } else {
      if (node.status != null) errors.push('project node "' + id + '" must not have a status')
      if (node.completedAt != null) errors.push('project node "' + id + '" must not have completedAt')
      if (node.here) errors.push('project node "' + id + '" must not be "here"')
    }
  }

  // A root must be a project node; a non-root has exactly one incoming edge.
  for (const id of nodeIds) {
    const sources = incoming.get(id)
    if (rootIds.has(id)) {
      if (nodes[id].kind !== 'project') errors.push('root node "' + id + '" must be a project node (a root has no incoming edge)')
    } else if (sources.length > 1) {
      errors.push('node "' + id + '" has more than one incoming edge: ' + sources.join(', '))
    }
  }

  const reachable = walkReachable(record, rootIds, errors)
  for (const id of nodeIds) {
    if (!reachable.has(id) && !errors.some((e) => e.includes('"' + id + '"'))) {
      errors.push('node "' + id + '" is not reachable from any root')
    }
  }

  for (const line of collectLines(record, rootIds)) {
    const hereCount = line.filter((id) => nodes[id] && nodes[id].here).length
    if (hereCount > 1) errors.push('line starting at "' + line[0] + '" has ' + hereCount + ' "here" cursors; at most one is allowed')
  }

  return { ok: errors.length === 0, errors }
}
