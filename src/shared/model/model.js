// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The runtime domain model: takes a parsed (and, by convention, already
// validated — see validate.js) record and builds node/tree lookups plus the
// predecessor pointers the schema deliberately doesn't store (see
// docs/model_ideas.md: "the predecessor is not stored — it is derived at load, so
// the two can never disagree").
//
// Trees are not stored either: a tree is the subtree rooted at a node with no
// incoming edge, and that root node's id IS the tree's identity. planOrder (a list
// of root ids) only orders the plans left to right and is advisory — the graph,
// not the list, decides what is a root.
//
// Each node's two branch arrays are flattened here into one `branches` list of
// { child, side }, in left-then-right order, because every consumer wants the
// forks of a node together and none of them wants to know which array a fork came
// out of. There is no longer an "above or below": a branch array names the edge
// rising from the node holding it, and that is the only edge it can name.

import { branchChildrenOf } from './validate.js'

// Build the runtime model. Does not mutate record; node records are
// shallow-copied so callers can attach the derived fields below without touching
// the parsed source.
export function buildModel(record) {
  const nodes = new Map(Object.entries(record.nodes).map(([id, n]) => [id, { ...n, branches: branchChildrenOf(n) }]))

  for (const node of nodes.values()) {
    node.predecessorId = null
    node.predecessorKind = null // 'next' | 'branch'
    node.branchSide = null
  }
  for (const [id, node] of nodes) {
    if (node.next && nodes.has(node.next)) {
      const child = nodes.get(node.next)
      child.predecessorId = id
      child.predecessorKind = 'next'
    }
    for (const b of node.branches) {
      if (!nodes.has(b.child)) continue
      const child = nodes.get(b.child)
      child.predecessorId = id
      child.predecessorKind = 'branch'
      child.branchSide = b.side
    }
  }

  // Roots are structural: a node with no incoming edge. Order them by planOrder
  // (advisory); any root not listed there sorts last by createdAt, so the file's
  // ordering is honoured without the graph depending on it.
  const rootIds = []
  for (const [id, node] of nodes) if (node.predecessorId === null) rootIds.push(id)
  const order = Array.isArray(record.planOrder) ? record.planOrder : []
  const rank = new Map(order.map((id, i) => [id, i]))
  rootIds.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity
    const rb = rank.has(b) ? rank.get(b) : Infinity
    if (ra !== rb) return ra - rb
    const ca = nodes.get(a).createdAt || ''
    const cb = nodes.get(b).createdAt || ''
    if (ca !== cb) return ca < cb ? -1 : 1
    return a < b ? -1 : 1
  })
  // A tree is identified by its root node's id; there is no separate tree id or
  // stored tree name (the name is the root node's title).
  const plans = rootIds.map((id) => ({ id, baseId: id }))

  // Which tree a node belongs to: the tree whose root reaches it by .next or by a
  // branch (a fork stays within its tree; plans never share nodes).
  const planIdByNode = new Map()
  for (const rootId of rootIds) {
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()
      if (planIdByNode.has(id)) continue
      planIdByNode.set(id, rootId)
      const node = nodes.get(id)
      if (!node) continue
      if (node.next) stack.push(node.next)
      for (const b of node.branches) stack.push(b.child)
    }
  }

  function getNode(id) {
    return nodes.get(id) || null
  }

  function getPlan(id) {
    return plans.find((t) => t.id === id) || null
  }

  function getPlanIdForNode(id) {
    return planIdByNode.get(id) || null
  }

  // The main-line chain starting at startId (a root or a branch child), following
  // .next until a tip. This is a "line" — see docs/model_ideas.md.
  function getMainLineChain(startId) {
    const chain = []
    const seen = new Set()
    let id = startId
    while (id && nodes.has(id) && !seen.has(id)) {
      seen.add(id)
      chain.push(id)
      id = nodes.get(id).next
    }
    return chain
  }

  function getBranchChildren(id) {
    const node = nodes.get(id)
    return node ? node.branches.map((b) => ({ ...b })) : []
  }

  // The task carrying "here" on the line starting at startId, or null if the
  // branch has none (a line may have zero or one — see validate.js). Project
  // nodes never carry "here", so they are simply skipped.
  function getHereTaskId(startId) {
    for (const id of getMainLineChain(startId)) {
      if (nodes.get(id).here) return id
    }
    return null
  }

  return {
    id: record.id,
    title: record.title,
    schemaVersion: record.schemaVersion,
    plans,
    nodes,
    getNode,
    getPlan,
    getPlanIdForNode,
    getMainLineChain,
    getBranchChildren,
    getHereTaskId,
  }
}
