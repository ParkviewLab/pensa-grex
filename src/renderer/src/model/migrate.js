// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Forest schema migration. A parsed forest object may have been written by an
// older version of the app; migrateForest brings it up to the current schema in
// one lossless step so validate.js and buildForest only ever see the current
// shape. Pure: it does not mutate its argument (it clones before changing).
//
// schema 1 -> 2 (Sub-Projects). Introduces the node `kind` ('task' | 'project')
// and the project-node root. Every schema-1 task becomes a `task`; each tree
// gains a NEW `project` root node titled with the tree's name, with the tree's
// old root as its .next — so the tree's name now lives on its root node and the
// old root keeps its status (lossless). The trees[] registry is replaced by
// rootOrder, an ordered list of root-node ids (see docs/model_ideas.md).

import { mintTaskId } from './ids.js'

export const CURRENT_SCHEMA = 2

// Bring raw up to CURRENT_SCHEMA. Returns { raw, changed }: `changed` is true
// iff a migration ran, so the caller can persist the upgraded file once.
export function migrateForest(raw) {
  if (!raw || typeof raw !== 'object') return { raw, changed: false }
  let cur = raw
  let changed = false
  if (cur.schema === 1) {
    cur = migrate1to2(cur)
    changed = true
  }
  return { raw: cur, changed }
}

function migrate1to2(raw) {
  const next = structuredClone(raw)
  next.schema = 2
  for (const task of Object.values(next.tasks || {})) {
    if (!task.kind) task.kind = 'task'
  }
  const rootOrder = []
  for (const tree of next.trees || []) {
    const root = {
      id: mintTaskId(),
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

function nowISO() {
  return new Date().toISOString()
}
