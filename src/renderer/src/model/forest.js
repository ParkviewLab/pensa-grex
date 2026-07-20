// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The runtime forest model: takes a parsed (and, by convention, already
// validated — see validate.js) forest object and builds task/tree lookups
// plus the predecessor pointers the schema deliberately doesn't store (see
// docs/model_ideas.md: "the predecessor is not stored — it is derived at
// load, so the two can never disagree").
//
// Trees are not stored either (schema 2): a tree is the subtree rooted at a
// node with no incoming edge, and that root node's id IS the tree's identity.
// rootOrder (a list of root ids) only orders the trees left to right and is
// advisory — the graph, not the list, decides what is a root.

// Build the runtime model. Does not mutate raw; task/tree records are
// shallow-copied so callers can attach the derived fields below without
// touching the parsed source.
export function buildForest(raw) {
  const tasks = new Map(Object.entries(raw.tasks).map(([id, t]) => [id, { ...t, branches: (t.branches || []).map((b) => ({ ...b })) }]))

  for (const task of tasks.values()) {
    task.predecessorId = null
    task.predecessorKind = null // 'next' | 'branch'
    task.branchSide = null
    task.branchAt = null
  }
  for (const [id, task] of tasks) {
    if (task.next && tasks.has(task.next)) {
      const child = tasks.get(task.next)
      child.predecessorId = id
      child.predecessorKind = 'next'
    }
    for (const b of task.branches) {
      if (!tasks.has(b.child)) continue
      const child = tasks.get(b.child)
      child.predecessorId = id
      child.predecessorKind = 'branch'
      child.branchSide = b.side
      child.branchAt = b.at
    }
  }

  // Roots are structural: a node with no incoming edge. Order them by rootOrder
  // (advisory); any root not listed there sorts last by createdAt, so the file's
  // ordering is honoured without the graph depending on it.
  const rootIds = []
  for (const [id, task] of tasks) if (task.predecessorId === null) rootIds.push(id)
  const order = Array.isArray(raw.rootOrder) ? raw.rootOrder : []
  const rank = new Map(order.map((id, i) => [id, i]))
  rootIds.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity
    const rb = rank.has(b) ? rank.get(b) : Infinity
    if (ra !== rb) return ra - rb
    const ca = tasks.get(a).createdAt || ''
    const cb = tasks.get(b).createdAt || ''
    if (ca !== cb) return ca < cb ? -1 : 1
    return a < b ? -1 : 1
  })
  // A tree is identified by its root node's id; there is no separate tree id or
  // stored tree name (the name is the root node's title).
  const trees = rootIds.map((id) => ({ id, rootTaskId: id }))

  // Which tree a task belongs to: the tree whose root reaches it via .next or
  // .branches (a fork stays within its tree; trees never share tasks).
  const treeIdByTask = new Map()
  for (const rootId of rootIds) {
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()
      if (treeIdByTask.has(id)) continue
      treeIdByTask.set(id, rootId)
      const task = tasks.get(id)
      if (!task) continue
      if (task.next) stack.push(task.next)
      for (const b of task.branches) stack.push(b.child)
    }
  }

  function getTask(id) {
    return tasks.get(id) || null
  }

  function getTree(id) {
    return trees.find((t) => t.id === id) || null
  }

  function getTreeIdForTask(id) {
    return treeIdByTask.get(id) || null
  }

  // The main-line chain starting at startId (a root or a branch child),
  // following .next until a tip. This is a "line" / "stack" in the push/pop
  // sense — see docs/model_ideas.md.
  function getMainLineChain(startId) {
    const chain = []
    const seen = new Set()
    let id = startId
    while (id && tasks.has(id) && !seen.has(id)) {
      seen.add(id)
      chain.push(id)
      id = tasks.get(id).next
    }
    return chain
  }

  function getBranchChildren(id) {
    const task = tasks.get(id)
    return task ? task.branches.map((b) => ({ ...b })) : []
  }

  // The task carrying "here" on the line starting at startId, or null if the
  // branch has none (a line may have zero or one — see validate.js). Project
  // nodes never carry "here", so they are simply skipped.
  function getHereTaskId(startId) {
    for (const id of getMainLineChain(startId)) {
      if (tasks.get(id).here) return id
    }
    return null
  }

  return {
    domain: raw.domain,
    schema: raw.schema,
    trees,
    tasks,
    getTask,
    getTree,
    getTreeIdForTask,
    getMainLineChain,
    getBranchChildren,
    getHereTaskId,
  }
}
