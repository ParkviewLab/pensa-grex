// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Record schema migration. A parsed record may have been written by an older
// version of the app; migrateRecord brings it up to the current schema in one
// step so validate.js and buildModel only ever see the current shape. Pure: it
// does not mutate its argument (it clones before changing).
//
// schema 1 -> 2 (Sub-Projects). Introduces the node `kind` ('task' | 'project')
// and the project-node root. Every schema-1 task becomes a `task`; each tree
// gains a NEW `project` root node titled with the tree's name, with the tree's
// old root as its .next — so the tree's name now lives on its root node and the
// old root keeps its status (lossless). The trees[] registry is replaced by
// rootOrder, an ordered list of root-node ids (see docs/model_ideas.md).
//
// schema 2 -> 3 (the record shape; see docs/model_v3_ideas.md). Renames the
// envelope and the node map, remints every id, and rewrites each node's branch
// list as two ordered side arrays. It then closes every scope and gives every
// branch a return, the two structural things schema 3 requires and schema 2
// could not say.

import { mintNodeId, mintDomainId } from './ids.js'
import { noteFileName } from './notes.js'
import { branchesIn, indexRecord, mergeErrors } from './validate.js'
// The one thing this module borrows from the edit layer: schema 2 let a fork hang on the top
// of a branch, which schema 3 cannot say, and the repair for it is the same one an edit needs
// when it deletes the node above a branch's host, so there is one implementation of it.
import { rehomeOrphanedBranches } from './mutations.js'

export const CURRENT_SCHEMA = 3

// Bring record up to CURRENT_SCHEMA. Returns { record, changed, notes, idMap }.
// `changed` is true iff a migration ran, so the caller can persist the upgraded
// file once. `notes` lists the note-file renames a 2 -> 3 pass implies, as
// [{ from, to }], and `idMap` maps every old node id to its new one; both are for a
// caller that owns things pointing at the old ids, which means the store (note
// files and the bookmark sidecar). The renderer's in-memory fallback has neither.
export function migrateRecord(record) {
  if (!record || typeof record !== 'object') return { record, changed: false, notes: [], idMap: {} }
  let cur = record
  let changed = false
  let notes = []
  let idMap = {}
  if (cur.schema === 1) {
    cur = migrate1to2(cur)
    changed = true
  }
  if (cur.schema === 2) {
    const res = migrate2to3(cur)
    cur = res.record
    notes = res.notes
    idMap = res.idMap
    changed = true
  }
  return { record: cur, changed, notes, idMap }
}

function migrate1to2(record) {
  const next = structuredClone(record)
  next.schema = 2
  for (const task of Object.values(next.tasks || {})) {
    if (!task.kind) task.kind = 'task'
  }
  const rootOrder = []
  for (const tree of next.trees || []) {
    const root = {
      id: mintNodeId(),
      title: tree.name,
      kind: 'project',
      createdAt: nowISO(),
      note: null,
      next: tree.rootTaskId,
      branches: [],
    }
    next.tasks[root.id] = root
    rootOrder.push(root.id)
  }
  next.rootOrder = rootOrder
  delete next.trees
  return next
}

// Which node each node hangs from in schema 2, and by which kind of edge. A node
// has at most one predecessor (validate.js enforces it), so this is a function.
function predecessors(tasks) {
  const pred = new Map()
  for (const [id, t] of Object.entries(tasks)) {
    if (t.next && tasks[t.next]) pred.set(t.next, { id, via: 'next' })
    for (const b of t.branches || []) {
      if (tasks[b.child]) pred.set(b.child, { id, via: 'branch' })
    }
  }
  return pred
}

// Where a schema-2 branch attaches, said the schema-3 way: on the node whose
// rising edge the branch leaves.
//
// `at: 'above'` on X already names that edge, so it stays on X. `at: 'below'` on X
// names the edge whose upper node is X, which is the edge rising from X's
// predecessor — exact whenever that predecessor is a main-line one.
//
// Two positions have no trunk edge below them: a root, and the foot of a branch
// trunk, whose lower neighbour is its own branch line rather than a trunk edge.
// For both, the nearest legal edge is the one above, and treating them so is not a
// new decision: geometry.js already drew a below-fork on a root in the gap above
// it. Only the branch-foot case moves a junction at all, by one gap, and the
// branch stays on the trunk it was already on.
function attachHost(id, at, pred) {
  if (at !== 'below') return id
  const p = pred.get(id)
  if (!p || p.via !== 'next') return id
  return p.id
}

// Give every scope a close, which is the faithful half of the 2 -> 3 migration.
//
// A schema-2 project node's scope was everything above it on its trunk, so its close
// belongs at that trunk's top; and where two project nodes share a trunk, the one
// opened higher must close lower, so the closes stack above the top in reverse order
// of opening. That asserts nothing schema 2 did not already mean.
//
// Termini are added per trunk, where a trunk is a maximal .next run starting at a
// base or at a branch child. A trunk with no project node on it gets none, since
// there is nothing there to close.
function closeScopes(nodes, mintId, stamp) {
  // A trunk starts wherever nothing arrives by .next: a base, or a branch's first
  // node. Nothing else about the incoming edge matters here.
  const nextTargets = new Set(Object.values(nodes).map((n) => n.next).filter(Boolean))
  const starts = Object.keys(nodes).filter((id) => !nextTargets.has(id))

  for (const start of starts) {
    const trunk = []
    let id = start
    const seen = new Set()
    while (id && nodes[id] && !seen.has(id)) {
      seen.add(id)
      trunk.push(id)
      id = nodes[id].next
    }
    const opens = trunk.filter((nid) => nodes[nid].kind === 'project').length
    if (!opens) continue

    // One close per open, stacked above the trunk's top. Which terminus closes which
    // project is not stored: it is derived by matching brackets up the trunk (see
    // pairScopes in validate.js), so there is no second copy of the pairing to fall
    // out of step with the trunk.
    let top = trunk[trunk.length - 1]
    for (let i = 0; i < opens; i++) {
      const terminus = {
        id: mintId(),
        kind: 'terminus',
        createdAt: stamp,
        note: null,
        next: null,
        mergePoint: null,
        rightBranches: [],
        leftBranches: [],
      }
      nodes[terminus.id] = terminus
      nodes[top].next = terminus.id
      top = terminus.id
    }
  }
}

// Give every branch a return, which is the one thing this migration invents rather than
// translates. A schema-2 branch is precisely work that diverged and never rejoined, so
// there is nothing in the old file to read a merge point off; the choice (record, section
// 13) is to fabricate the weakest claim in the most visible place. Each branch merges at
// the edge level with its own top, so the drawing keeps the geometry it had and gains a
// short return line at the top of the branch, and one drag corrects any claim the author
// disagrees with.
//
// Where that height runs past the close of the scope the branch was opened in, or past the
// top of the trunk it left, the merge is clamped down to the highest legal edge. The floor
// is the branch's own edge, which is legal everywhere, so the search always terminates.
function fabricateMerges(record) {
  for (const branch of branchesIn(record)) {
    const ix = indexRecord(record)
    const host = ix.at.get(branch.hostId)
    if (!host || !branch.tipId) continue
    const trunk = host.trunk
    // The branch's foot sits one row above its host, so its top sits `length` rows above,
    // and the trunk node at that height is this many steps along the trunk.
    const level = Math.min(host.i + branch.trunk.length, trunk.length - 1)
    let chosen = branch.hostId
    for (let i = level; i > host.i; i--) {
      if (!mergeErrors(record, { ...branch, mergePoint: trunk[i] }, ix).length) {
        chosen = trunk[i]
        break
      }
    }
    record.nodes[branch.tipId].mergePoint = chosen
  }
}

function migrate2to3(record) {
  // Schema 2 called the node map `tasks`; this is the last code that reads it.
  const tasks = record.tasks || {}
  const pred = predecessors(tasks)

  // Remint every id, so a schema-3 domain has uniform, sortable ids rather than a
  // mix of the old k_/t_ prefixes and the new ones. Ids are opaque, so the only
  // cost is repointing every reference, and this pass rewrites every node anyway.
  const idMap = new Map(Object.keys(tasks).map((old) => [old, mintNodeId()]))
  const map = (old) => (old && idMap.has(old) ? idMap.get(old) : null)

  const nodes = {}
  const noteRenames = []
  for (const [oldId, t] of Object.entries(tasks)) {
    const id = map(oldId)
    const node = {
      id,
      title: t.title,
      kind: t.kind === 'project' ? 'project' : 'task',
      createdAt: t.createdAt || nowISO(),
      note: null,
      flagged: !!t.flagged,
      next: map(t.next),
      rightBranches: [],
      leftBranches: [],
    }
    if (node.kind === 'task') {
      node.status = t.status || 'todo'
      node.completedAt = t.completedAt || null
      node.here = !!t.here
      // Filled in by fabricateMerges below, for whichever tasks turn out to be the top of
      // a branch; a project node never carries the field, since it is never a top.
      node.mergePoint = null
    }
    if (t.note) {
      node.note = noteFileName(id, t.title)
      noteRenames.push({ from: t.note, to: node.note })
    }
    nodes[id] = node
  }

  // A branch list becomes two ordered arrays on the host node. Order within a side
  // is the order schema 2 stored, which was the order they were created in; from
  // here it is the author's, and it is what decides lane order (record, section 7).
  // A branch pointing at a node that is not there is dropped, which validate.js
  // would have refused anyway.
  for (const [oldId, t] of Object.entries(tasks)) {
    for (const b of t.branches || []) {
      if (!b || !tasks[b.child]) continue
      const host = nodes[map(attachHost(oldId, b.at, pred))]
      if (!host) continue
      host[b.side === 'right' ? 'rightBranches' : 'leftBranches'].push(map(b.child))
    }
  }

  // Last, because both need the finished trunks: every scope gets its close, and then
  // every branch gets its return, the merge rules being stated in terms of the scopes.
  closeScopes(nodes, mintNodeId, nowISO())
  // After closeScopes, because a trunk that gained a terminus has a rising edge at its old
  // top and so needs no move at all; before fabricateMerges, because a fork's merge depends
  // on which node it hangs from.
  rehomeOrphanedBranches({ nodes })
  fabricateMerges({ nodes })

  return {
    record: {
      schemaVersion: 3,
      // A schema-2 file carried no domain id; mint one, and let the store name the
      // directory from what the record says rather than the other way about.
      id: record.id || mintDomainId(),
      title: record.title || record.domain || 'Untitled',
      // Schema 2 called it rootOrder; it is advisory in both, since the graph decides
      // what is a base.
      planOrder: (record.rootOrder || []).map(map).filter(Boolean),
      nodes,
    },
    notes: noteRenames,
    idMap: Object.fromEntries(idMap),
  }
}

function nowISO() {
  return new Date().toISOString()
}
