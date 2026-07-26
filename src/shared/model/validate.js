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
const KINDS = ['task', 'project', 'terminus']

// A node's forks, both sides, in one list. Order is left then right; within a
// side it is the author's stored order.
export function branchChildrenOf(node) {
  const left = Array.isArray(node && node.leftBranches) ? node.leftBranches : []
  const right = Array.isArray(node && node.rightBranches) ? node.rightBranches : []
  return [...left.map((child) => ({ child, side: 'left' })), ...right.map((child) => ({ child, side: 'right' }))]
}

// Which TerminusNode closes which ProjectNode, by matching brackets up each trunk.
// A scope is an interval on ONE trunk, so the pairing never leaves the trunk it
// starts on: reading a trunk from the base upward, a project node opens and a
// terminus closes the nearest scope still open. Exported because the operations need
// the same pairing (unwrapping a project, deleting one, finding a scope's extent),
// and two implementations of it would be two chances to disagree.
//
// Returns { pairs, closes, errors }: pairs maps a project id to its terminus id,
// closes is the reverse, and errors names every unbalanced position. A caller that
// has already validated can ignore errors.
export function pairScopes(record, lines) {
  const nodes = (record && record.nodes) || {}
  const pairs = new Map()
  const closes = new Map()
  const errors = []
  for (const line of lines) {
    const open = []
    for (const id of line) {
      const node = nodes[id]
      if (!node) continue
      if (node.kind === 'project') open.push(id)
      else if (node.kind === 'terminus') {
        if (!open.length) {
          errors.push('terminus "' + id + '" closes nothing: no project is open below it on its trunk')
          continue
        }
        const projectId = open.pop()
        pairs.set(projectId, id)
        closes.set(id, projectId)
      }
    }
    for (const id of open) {
      errors.push('project node "' + id + '" is never closed: no terminus above it on its trunk')
    }
  }
  return { pairs, closes, errors }
}

// Whether `id` is the terminus that closes a plan, which is the one node with no
// edge above it: the grammar ends the plan there, so nothing may be inserted,
// attached, or grown above it. A sub-project's close has an edge above it and is
// unrestricted.
export function isPlanClose(record, id) {
  const nodes = (record && record.nodes) || {}
  const node = nodes[id]
  if (!node || node.kind !== 'terminus') return false
  const { closes } = pairScopes(record, trunksOf(record))
  const projectId = closes.get(id)
  if (!projectId) return false
  // The project it closes is a plan's base exactly when nothing points at it.
  for (const n of Object.values(nodes)) {
    if (n.next === projectId) return false
    if ((n.leftBranches || []).includes(projectId)) return false
    if ((n.rightBranches || []).includes(projectId)) return false
  }
  return true
}

// Every node sits on exactly one trunk: the maximal .next run it belongs to. A
// trunk starts wherever nothing arrives by .next, which is a plan's base or a
// branch's first node, and runs up to a node with no successor. Returns an array of
// arrays of node ids, base-to-top, one per trunk.
export function trunksOf(record) {
  const nodes = (record && record.nodes) || {}
  const arrivesByNext = new Set(Object.values(nodes).map((n) => n.next).filter(Boolean))
  const trunks = []
  for (const start of Object.keys(nodes).filter((id) => !arrivesByNext.has(id))) {
    const trunk = []
    let id = start
    const seen = new Set()
    while (id && nodes[id] && !seen.has(id)) {
      seen.add(id)
      trunk.push(id)
      id = nodes[id].next
    }
    trunks.push(trunk)
  }
  return trunks
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
    if (!KINDS.includes(node.kind)) {
      errors.push('node "' + id + '" has an invalid kind: ' + node.kind)
      continue
    }
    if (node.kind === 'task') {
      if (!VALID_STATUSES.includes(node.status)) errors.push('task "' + id + '" has an invalid status: ' + node.status)
      if (node.status === 'completed' && !node.completedAt) errors.push('task "' + id + '" is completed but has no completedAt')
      if (node.status !== 'completed' && node.completedAt) errors.push('task "' + id + '" has completedAt but is not completed')
    } else if (node.kind === 'project') {
      if (node.status != null) errors.push('project node "' + id + '" must not have a status')
      if (node.completedAt != null) errors.push('project node "' + id + '" must not have completedAt')
      if (node.here) errors.push('project node "' + id + '" must not be "here"')
    } else {
      // A terminus is the one node kind that says nothing of its own. It closes a
      // scope, and the only expressive field it keeps is a note, which is where one
      // records what closing the scope took. It carries no title, so it cannot be
      // searched for by name, and no flag, so a flag query cannot sweep it up; its
      // paired ProjectNode is the scope's handle for both.
      if (node.title != null) errors.push('terminus "' + id + '" must not have a title')
      if (node.status != null) errors.push('terminus "' + id + '" must not have a status')
      if (node.completedAt != null) errors.push('terminus "' + id + '" must not have completedAt')
      if (node.here) errors.push('terminus "' + id + '" must not be "here"')
      if (node.flagged) errors.push('terminus "' + id + '" must not be flagged')
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

  const lines = trunksOf(record)

  // Scopes: every project node closes, every terminus closes something, and both
  // happen on one trunk.
  const { pairs, errors: scopeErrors } = pairScopes(record, lines)
  errors.push(...scopeErrors)

  // A terminus arrives by a trunk edge, never as a branch child: a scope that opened
  // on one trunk cannot close at the foot of another.
  for (const id of nodeIds) {
    if (nodes[id].kind !== 'terminus') continue
    if (incoming.get(id).some((s) => s.includes(' branch of '))) {
      errors.push('terminus "' + id + '" is a branch child; a scope closes on the trunk it opened on')
    }
  }

  // A plan's own close is the end of the plan: the grammar puts nothing after it, so
  // it has no edge above it and nothing can be attached there. A sub-project's
  // terminus is unrestricted, since it does have an edge above it.
  for (const rootId of rootIds) {
    const terminusId = pairs.get(rootId)
    if (!terminusId) continue
    const terminus = nodes[terminusId]
    if (terminus.next) {
      errors.push('the plan\'s closing terminus "' + terminusId + '" has a node above it; a plan ends at its close')
    }
    if (branchChildrenOf(terminus).length) {
      errors.push('the plan\'s closing terminus "' + terminusId + '" has a branch; there is no edge above it to hold one')
    }
  }

  for (const line of lines) {
    const hereCount = line.filter((id) => nodes[id] && nodes[id].here).length
    if (hereCount > 1) errors.push('line starting at "' + line[0] + '" has ' + hereCount + ' "here" marks; at most one is allowed')
  }

  return { ok: errors.length === 0, errors }
}
