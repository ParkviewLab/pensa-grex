// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { migrateRecord } from './migrate.js'
import { validateRecord, pairScopes, trunksOf } from './validate.js'

function v1() {
  return {
    schema: 1, domain: 'D',
    trees: [
      { id: 't1', name: 'Alpha', rootTaskId: 'a' },
      { id: 't2', name: 'Beta', rootTaskId: 'c' },
    ],
    tasks: {
      a: { id: 'a', title: 'A', status: 'completed', createdAt: 'x', completedAt: 'y', note: null, here: false, next: 'b', branches: [] },
      b: { id: 'b', title: 'B', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: true, next: null, branches: [] },
      c: { id: 'c', title: 'C', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
    },
  }
}

// A schema-2 record: the old envelope (schema/domain/rootOrder/tasks) and the old
// node shape, whose forks are one list of { child, side, at }. Every `at` case the
// 2 -> 3 pass has to place is here: `above`, `below` with a main-line predecessor,
// `below` on a root, and `below` at the foot of a branch. It holds one project node,
// the plan's base, so the pass owes the migrated record exactly one terminus.
function v2() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: {
        id: 'p', title: 'Plan', kind: 'project', createdAt: 'x', note: null, flagged: false, next: 'a',
        branches: [{ child: 'r0', side: 'right', at: 'below' }],
      },
      a: {
        id: 'a', title: 'A', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: true, here: false, next: 'b',
        branches: [{ child: 'l1', side: 'left', at: 'above' }, { child: 'm1', side: 'left', at: 'above' }],
      },
      b: {
        id: 'b', title: 'B', kind: 'task', status: 'in-progress', createdAt: 'x', completedAt: null, note: null, flagged: false, here: true, next: 'c',
        branches: [{ child: 'r1', side: 'right', at: 'below' }],
      },
      c: {
        id: 'c', title: 'C', kind: 'task', status: 'completed', createdAt: 'x', completedAt: 'y', note: 'k_c_old.md', flagged: false, here: false, next: null,
        branches: [],
      },
      l1: {
        id: 'l1', title: 'L1', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null,
        branches: [{ child: 'l2', side: 'left', at: 'below' }],
      },
      l2: { id: 'l2', title: 'L2', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, branches: [] },
      m1: { id: 'm1', title: 'M1', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, branches: [] },
      r0: { id: 'r0', title: 'R0', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, branches: [] },
      r1: { id: 'r1', title: 'R1', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, branches: [] },
    },
  }
}

// The 2 -> 3 pass remints every id, so a migrated node is found by its title.
function byTitle(record, title) {
  const node = Object.values(record.nodes).find((n) => n.title === title)
  if (!node) throw new Error('no migrated node titled "' + title + '"')
  return node
}

// Termini: a minted terminus has no title, so it cannot be found by one. It is found
// through the project node it closes, using the same bracket-matching the record's
// invariants are checked with rather than a second reading of the trunk.
function closeOf(record, projectId) {
  const { pairs } = pairScopes(record, trunksOf(record))
  const terminus = record.nodes[pairs.get(projectId)]
  if (!terminus) throw new Error('no terminus closes project "' + projectId + '"')
  return terminus
}

describe('migrateRecord — schema 1 to the current schema', () => {
  it('prepends a named project root per tree, builds planOrder, and validates', () => {
    // One call carries a schema-1 record the whole way, so the result is a schema-3
    // record: the schema-2 step's rootOrder and tasks are gone with the rest of the
    // old envelope.
    const { record, changed } = migrateRecord(v1())
    expect(changed).toBe(true)
    expect(record.schemaVersion).toBe(3)
    expect(record.schema).toBeUndefined()
    expect(record.trees).toBeUndefined()
    expect(record.tasks).toBeUndefined()
    expect(record.rootOrder).toBeUndefined()
    expect(record.planOrder).toHaveLength(2)

    const a = byTitle(record, 'A')
    expect(a.kind).toBe('task') // existing tasks become tasks, keeping their status
    expect(a.status).toBe('completed')

    const r0 = record.nodes[record.planOrder[0]]
    expect(r0.kind).toBe('project')
    expect(r0.title).toBe('Alpha')
    expect(r0.next).toBe(a.id) // the old root becomes the project's first real node
    expect(r0.status).toBeUndefined()

    const r1 = record.nodes[record.planOrder[1]]
    expect(r1.title).toBe('Beta')
    expect(r1.next).toBe(byTitle(record, 'C').id)

    // Termini: schema 3 closes every scope, so the pass that mints a plan's root node
    // mints its close too — and nothing else: 3 old tasks, 2 roots, 2 closes. Alpha's
    // close sits above B, the top of that trunk; Beta's above C. A plan's close ends
    // the plan, so it has no node and no fork above it.
    expect(Object.keys(record.nodes)).toHaveLength(7)
    const alphaClose = closeOf(record, r0.id)
    expect(alphaClose.kind).toBe('terminus')
    expect(byTitle(record, 'B').next).toBe(alphaClose.id)
    expect(alphaClose.next).toBe(null)
    expect(alphaClose.leftBranches).toEqual([])
    expect(alphaClose.rightBranches).toEqual([])
    const betaClose = closeOf(record, r1.id)
    expect(betaClose.kind).toBe('terminus')
    expect(byTitle(record, 'C').next).toBe(betaClose.id)
    expect(betaClose.next).toBe(null)

    expect(validateRecord(record).ok).toBe(true)
  })

  it('does not mutate its input', () => {
    const input = v1()
    const copy = structuredClone(input)
    migrateRecord(input)
    expect(input).toEqual(copy)
  })

  it('is a no-op on a record already at the current schema', () => {
    // Termini: the minimal current-schema record is now a base and its close, since a
    // project node with nothing closing it is no longer a legal record. The empty plan
    // is what the fixture was and still is.
    const already = {
      schemaVersion: 3, id: 'd_mrtwgppt00', title: 'D', planOrder: ['p'],
      nodes: {
        p: { id: 'p', title: 'P', kind: 'project', createdAt: 'x', note: null, flagged: false, next: 'z', leftBranches: [], rightBranches: [] },
        z: { id: 'z', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] },
      },
    }
    expect(validateRecord(already).ok).toBe(true)
    const { record, changed, notes } = migrateRecord(already)
    expect(changed).toBe(false)
    expect(record).toBe(already)
    expect(notes).toEqual([])
  })
})

describe('migrateRecord — schema 2 to 3', () => {
  it('renames the envelope, remints every id, and validates', () => {
    const { record, changed, idMap } = migrateRecord(v2())
    expect(changed).toBe(true)
    expect(record.schemaVersion).toBe(3)
    expect(record.title).toBe('D') // the old `domain` name is the record's title now
    expect(record.id).toMatch(/^d_[0-9a-z]{10}$/) // a schema-2 file carried no domain id
    expect(record.planOrder).toEqual([byTitle(record, 'Plan').id]) // the old rootOrder, repointed

    // Every id is reminted, and every reference in the record points at a new one.
    for (const [id, node] of Object.entries(record.nodes)) {
      expect(id).toMatch(/^n_[0-9a-z]{10}$/)
      expect(node.id).toBe(id)
    }
    // Termini: the nine schema-2 nodes come across one for one, and the pass adds the
    // one close the record's single scope needs. Only the nine reminted nodes are in
    // idMap; a terminus is new here, so nothing outside the record points at it.
    expect(Object.keys(record.nodes)).toHaveLength(10)
    expect(Object.keys(idMap)).toHaveLength(9)
    expect(idMap.a).toBe(byTitle(record, 'A').id) // old id -> new, for the note files and bookmarks

    // The node's own fields survive the pass unchanged.
    const b = byTitle(record, 'B')
    expect(b.status).toBe('in-progress')
    expect(b.here).toBe(true)
    expect(byTitle(record, 'A').flagged).toBe(true)
    expect(byTitle(record, 'C').completedAt).toBe('y')
    expect(byTitle(record, 'Plan').status).toBeUndefined() // a project node has none

    // The trunk is unchanged: p -> a -> b -> c by .next, with the plan's close above c.
    expect(byTitle(record, 'Plan').next).toBe(byTitle(record, 'A').id)
    expect(byTitle(record, 'A').next).toBe(b.id)
    expect(b.next).toBe(byTitle(record, 'C').id)

    // Termini: C was the top of the trunk and its .next was null. The top is now the
    // terminus closing the plan, which is where "nothing above it" is asserted; a
    // close says nothing of its own, so it has no title, status or flag.
    const close = closeOf(record, byTitle(record, 'Plan').id)
    expect(byTitle(record, 'C').next).toBe(close.id)
    expect(close.next).toBe(null)
    expect(close.leftBranches).toEqual([])
    expect(close.rightBranches).toEqual([])
    expect(close.title).toBeUndefined()
    expect(close.status).toBeUndefined()
    expect(close.flagged).toBeUndefined()

    expect(validateRecord(record).ok).toBe(true)
  })

  it('rewrites each branch list as two ordered side arrays on the node whose rising edge the branch leaves', () => {
    const { record } = migrateRecord(v2())
    const id = (title) => byTitle(record, title).id

    // `at: 'above'` already named the edge rising from its holder, so both of A's
    // left forks stay on A, in the order schema 2 stored them.
    expect(byTitle(record, 'A').leftBranches).toEqual([id('L1'), id('M1')])

    // `at: 'below'` on B named the edge whose upper node is B, which rises from B's
    // main-line predecessor A — so it moves to A, and B keeps no fork of its own.
    expect(byTitle(record, 'A').rightBranches).toEqual([id('R1')])
    expect(byTitle(record, 'B').leftBranches).toEqual([])
    expect(byTitle(record, 'B').rightBranches).toEqual([])

    // A below-fork on a root has no edge beneath it, so the nearest legal edge is
    // the one above and it stays where it was.
    expect(byTitle(record, 'Plan').rightBranches).toEqual([id('R0')])

    // Same at the foot of a branch trunk, whose lower neighbour is its own branch
    // line rather than a trunk edge: the fork stays on L1, on the side it had.
    expect(byTitle(record, 'L1').leftBranches).toEqual([id('L2')])

    // Schema 3: `at` is gone, so nothing about a fork's geometry is stored beyond
    // its side and its position in that side's array. The assertion that a
    // below-fork's junction sat a gap lower than an above-fork's can no longer be
    // made of the record; what replaces it is the rehoming checked above, which is
    // how that gap is now named.
    for (const node of Object.values(record.nodes)) {
      expect(Array.isArray(node.leftBranches)).toBe(true)
      expect(Array.isArray(node.rightBranches)).toBe(true)
      expect(node.branches).toBeUndefined()
    }
  })

  it('reports the note-file rename a reminted id implies', () => {
    const { record, notes } = migrateRecord(v2())
    const c = byTitle(record, 'C')
    expect(c.note).toBe(c.id + '_c.md') // id plus a slug of the title
    expect(notes).toEqual([{ from: 'k_c_old.md', to: c.note }])
  })

  it('does not mutate its input', () => {
    const input = v2()
    const copy = structuredClone(input)
    migrateRecord(input)
    expect(input).toEqual(copy)
  })
})
