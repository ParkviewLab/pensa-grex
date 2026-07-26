// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Load-time invariants for a parsed record (see docs/model_v3_ideas.md for the
// schema this enforces). Pure and side-effect free: it only reads the record and
// returns { ok, errors }, so a caller decides whether to refuse a bad file or
// surface the errors to the user. A record older than the current schema must be
// brought up to date with migrate.js first.
//
// Schema 3: every node has a kind ('task' | 'project' | 'terminus'); a task carries
// a status and may hold "here", a project node has neither, and a terminus says
// nothing of its own beyond a note. A node's forks are two ordered arrays of child
// ids, `leftBranches` and `rightBranches`, both naming the edge that RISES from the
// node holding them, so there is no separate "above or below" to store. Roots are
// structural — a node with no incoming edge — and every root must be a project node.
//
// Every branch rejoins the trunk it left (northstar axiom 3), and `mergePoint` is
// where it rejoins: the id of the node below the edge its return line joins. It is
// stored on the top of the branch's own trunk, because that is the end the return
// leaves from.

const VALID_STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']
const KINDS = ['task', 'project', 'terminus']
const SIDE_KEY = { left: 'leftBranches', right: 'rightBranches' }

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

// ---- branches and their returns ----

// Every branch in the record, as the merge rules and the drawing read one:
//
//   hostId      the node whose rising edge it leaves, which is its branch point
//   footId      its first node, the id the host's side array holds
//   side, index where it sits in that array, which is ordered innermost first
//   trunk       its own nodes, base to top
//   tipId       the top of that trunk, where its return line leaves
//   mergePoint  the node below the edge that return joins, stored on the tip
//
// The merge point is stored on the tip because that is the end the return leaves from:
// it is an outgoing edge, as `next` is. A project node therefore never carries one,
// since it always has its own close above it and so is never a trunk's top.
export function branchesIn(record) {
  const nodes = (record && record.nodes) || {}
  const list = []
  for (const [hostId, host] of Object.entries(nodes)) {
    for (const side of ['left', 'right']) {
      const arr = Array.isArray(host[SIDE_KEY[side]]) ? host[SIDE_KEY[side]] : []
      for (let index = 0; index < arr.length; index++) {
        const footId = arr[index]
        const trunk = []
        const seen = new Set()
        let id = footId
        while (id && nodes[id] && !seen.has(id)) {
          seen.add(id)
          trunk.push(id)
          id = nodes[id].next
        }
        const tipId = trunk.length ? trunk[trunk.length - 1] : null
        list.push({
          hostId, footId, side, index, trunk, tipId,
          mergePoint: tipId ? nodes[tipId].mergePoint || null : null,
        })
      }
    }
  }
  return list
}

// One pass for everything the merge rules ask repeatedly: which trunk a node is on and
// where in it, what each node hangs from, and which terminus closes which project. Every
// branch asks the same questions, so the answers are built once and passed around.
export function indexRecord(record) {
  const nodes = (record && record.nodes) || {}
  const trunks = trunksOf(record)
  const at = new Map()
  for (const trunk of trunks) {
    for (let i = 0; i < trunk.length; i++) at.set(trunk[i], { trunk, i })
  }
  const pred = new Map()
  for (const [id, node] of Object.entries(nodes)) {
    if (node.next) pred.set(node.next, { id, via: 'next' })
    for (const b of branchChildrenOf(node)) pred.set(b.child, { id, via: 'branch' })
  }
  const { pairs, closes, errors } = pairScopes(record, trunks)
  return { nodes, trunks, at, pred, pairs, closes, errors }
}

// The innermost scope still open at the edge rising from `nodeId`, which is the bound
// clause 3 of the merge rules imposes. Found by matching brackets downward rather than
// by descending to the nearest project node, and the difference is not academic: on a
// trunk running P, a, P2, b, T2, c, T, the nearest project node below c is P2, whose
// close sits below c, so taking it would make a legal branch look unsatisfiable. Every
// terminus passed on the way down closed a scope that also opened below us, so the
// project node pairing with it is skipped; the first unpaired project node is the answer.
// At the foot of a branch trunk the walk hops to the parent trunk at that branch's own
// node, since that is the edge the branch hangs from. A plan's base always ends the
// walk, so every position has exactly one enclosing scope.
export function enclosingScopeOpen(record, nodeId, ix) {
  const { nodes, pred } = ix
  let id = nodeId
  let pending = 0
  const seen = new Set()
  while (id && nodes[id] && !seen.has(id)) {
    seen.add(id)
    const node = nodes[id]
    if (node.kind === 'terminus') pending++
    else if (node.kind === 'project') {
      if (pending === 0) return id
      pending--
    }
    const p = pred.get(id)
    id = p ? p.id : null
  }
  return null
}

// Whether one branch's return is legal, and what is wrong with it if not. Returns an
// array of messages; empty means legal.
//
// Three clauses (docs/model_v3_ideas.md, section 4), and the third widens into the one
// nesting rule that section 8 keeps. A scope [P .. T] owns the edges rising from P up to
// the one rising from the node below T: exactly the edges that vanish when the scope is
// collapsed. So clause 3 and its mirror are one biconditional — for every scope on the
// trunk, the branch's own edge is inside it exactly when its join edge is. Both inside is
// a branch that returns within its scope; both outside is a branch whose span contains
// that whole scope, or misses it entirely. One of each is a branch escaping the scope it
// was opened in, or entering one it was opened outside, and either would leave a return
// line with nowhere to land when that scope is collapsed.
export function mergeErrors(record, branch, ix) {
  const { nodes, at, pairs } = ix
  const errors = []
  const label = 'the branch at "' + branch.footId + '"'
  const m = branch.mergePoint

  if (!branch.tipId) return ['a branch array names "' + branch.footId + '", which is not a node']
  // A branch hangs on the edge rising from its node, and the top of a trunk has no such
  // edge: what sits above the top of a branch trunk is that branch's own return line, and
  // above a plan's close there is nothing at all.
  if (nodes[branch.hostId] && !nodes[branch.hostId].next) {
    return [label + ' hangs on "' + branch.hostId + '", which is the top of its trunk and so has no edge to hold it']
  }
  if (!m) return [label + ' has no merge point; every branch rejoins the trunk it left']
  if (!nodes[m]) return [label + ' merges at unknown node "' + m + '"']

  const host = at.get(branch.hostId)
  const merge = at.get(m)
  if (!host || !merge || host.trunk !== merge.trunk) {
    return [label + ' merges at "' + m + '", which is not on the trunk it left']
  }
  if (merge.i < host.i) {
    return [label + ' merges below its own branch point, which is a loop rather than a return']
  }
  if (!nodes[m].next) {
    return [label + ' merges above "' + m + '", which has no edge above it']
  }

  const trunk = host.trunk
  const scopeName = (openId) => '"' + (nodes[openId].title || openId) + '"'

  // Clause 3, against the innermost scope open at the branch point, which is the bound the
  // author actually has to work within. Any wider scope containing the branch point
  // contains this one, so a merge outside a wider one is outside this one too, and naming
  // the tightest is both correct and the more useful thing to say.
  const enclosingId = enclosingScopeOpen(record, branch.hostId, ix)
  const enclosingClose = enclosingId ? at.get(pairs.get(enclosingId)) : null
  if (enclosingClose && enclosingClose.trunk === trunk && merge.i >= enclosingClose.i) {
    errors.push(label + ' merges past the close of ' + scopeName(enclosingId) + ', the scope it was opened in; a branch cannot reach out of its scope')
  }

  // The mirror of clause 3, which is section 8's one nesting rule: a branch may not merge
  // inside a scope it was opened outside, since a return landing inside a scope would have
  // nowhere to land once that scope were collapsed.
  for (const [openId, closeId] of pairs) {
    const open = at.get(openId)
    const close = at.get(closeId)
    if (!open || !close || open.trunk !== trunk) continue
    const inside = (i) => i >= open.i && i <= close.i - 1
    if (inside(host.i) || !inside(merge.i)) continue
    errors.push(label + ' merges inside ' + scopeName(openId) + ', a scope it was opened outside; merge below where ' + scopeName(openId) + ' opens, or above where it closes')
  }
  return errors
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
    // A return line is an edge too: it leaves this node and arrives at whatever sits
    // above its merge point, so the cycle check has to follow it. A legal return makes a
    // diamond rather than a loop, since the merge clauses forbid merging below the branch
    // point; a return that reaches downward is the cycle this catches.
    if (node.mergePoint && record.nodes[node.mergePoint] && record.nodes[node.mergePoint].next) {
      walk(record.nodes[node.mergePoint].next, path.concat(nodeId))
    }
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
    if (node.mergePoint != null && typeof node.mergePoint !== 'string') {
      errors.push('node "' + id + '" has a mergePoint that is not a node id')
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

  const ix = indexRecord(record)
  const lines = ix.trunks

  // Scopes: every project node closes, every terminus closes something, and both
  // happen on one trunk.
  const pairs = ix.pairs
  errors.push(...ix.errors)

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

  // Returns: every branch has one, only a branch's top holds one, and each one obeys the
  // merge rules. The typed-edge rule belongs to the node above a join edge — exactly one
  // trunk predecessor, and then zero or more return predecessors, which is what carries
  // the sense that everything must arrive before that node proceeds. A return is
  // therefore not counted among the incoming edges above, and two branches may share a
  // merge point, which gives an n-way join at no cost in the schema.
  const branches = branchesIn(record)
  const tipIds = new Set(branches.map((b) => b.tipId).filter(Boolean))
  for (const [id, node] of Object.entries(nodes)) {
    if (node.mergePoint && !tipIds.has(id)) {
      errors.push('node "' + id + '" holds a merge point but is not the top of a branch trunk; a return line leaves a branch at its top')
    }
  }
  for (const branch of branches) errors.push(...mergeErrors(record, branch, ix))

  for (const line of lines) {
    const hereCount = line.filter((id) => nodes[id] && nodes[id].here).length
    if (hereCount > 1) errors.push('line starting at "' + line[0] + '" has ' + hereCount + ' "here" marks; at most one is allowed')
  }

  return { ok: errors.length === 0, errors }
}
