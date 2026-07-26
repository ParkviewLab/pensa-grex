// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { migrateRecord } from './migrate.js'
import { validateRecord, pairScopes, trunksOf, branchesIn } from './validate.js'

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

// Returns: the records below each pose one question about what the pass does structurally,
// so each is shaped to its question and nothing else, and the schema-2 node shape is
// written once here rather than in every one of them. A schema-2 task carries its own
// status fields; a project node carries none.
function v2Task(id, title, rest = {}) {
  return { id, title, kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, branches: [], ...rest }
}

function v2Project(id, title, rest = {}) {
  return { id, title, kind: 'project', createdAt: 'x', note: null, flagged: false, next: null, branches: [], ...rest }
}

// A plain trunk and a two-node fork, with room above it on both counts, so the height the
// pass picks can be read with no clamp anywhere near it: the trunk is Plan, A, B, C, D, and
// the fork off A carries X1 and X2, whose top therefore sits level with C.
function v2Level() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: v2Project('p', 'Plan', { next: 'a' }),
      a: v2Task('a', 'A', { next: 'b', branches: [{ child: 'x1', side: 'right', at: 'above' }] }),
      b: v2Task('b', 'B', { next: 'c' }),
      c: v2Task('c', 'C', { next: 'd' }),
      d: v2Task('d', 'D'),
      x1: v2Task('x1', 'X1', { next: 'x2' }),
      x2: v2Task('x2', 'X2'),
    },
  }
}

// A fork hung on the top of a branch, which schema 2 allowed and schema 3 cannot say: the
// trunk is Plan, A, B, C, the fork off A carries X1 and X2, and Y1 hangs on X2, the top of
// that branch. X1 sits below X2 on the same trunk, so the move has somewhere to go.
function v2Nested() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: v2Project('p', 'Plan', { next: 'a' }),
      a: v2Task('a', 'A', { next: 'b', branches: [{ child: 'x1', side: 'right', at: 'above' }] }),
      b: v2Task('b', 'B', { next: 'c' }),
      c: v2Task('c', 'C'),
      x1: v2Task('x1', 'X1', { next: 'x2' }),
      x2: v2Task('x2', 'X2', { branches: [{ child: 'y1', side: 'right', at: 'above' }] }),
      y1: v2Task('y1', 'Y1'),
    },
  }
}

// A branch taller than what is left of the trunk above its branch point: the trunk is
// Plan, A, B, and the fork off A carries three nodes, so the row its top wants is off the
// end of the trunk.
function v2Tall() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: v2Project('p', 'Plan', { next: 'a' }),
      a: v2Task('a', 'A', { next: 'b', branches: [{ child: 'x1', side: 'right', at: 'above' }] }),
      b: v2Task('b', 'B'),
      x1: v2Task('x1', 'X1', { next: 'x2' }),
      x2: v2Task('x2', 'X2', { next: 'x3' }),
      x3: v2Task('x3', 'X3'),
    },
  }
}

// A branch opened inside a sub-project's scope: the trunk is Plan, A, Sub, B, C, and the
// fork off B carries two nodes, so the row its top wants is the row the close of Sub takes
// once the pass adds it. A schema-2 scope is everything above its project node, so both
// closes land above C, Sub's below the plan's.
function v2Scoped() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: v2Project('p', 'Plan', { next: 'a' }),
      a: v2Task('a', 'A', { next: 's' }),
      s: v2Project('s', 'Sub', { next: 'b' }),
      b: v2Task('b', 'B', { next: 'c', branches: [{ child: 'x1', side: 'right', at: 'above' }] }),
      c: v2Task('c', 'C'),
      x1: v2Task('x1', 'X1', { next: 'x2' }),
      x2: v2Task('x2', 'X2'),
    },
  }
}

// A branch leaving the topmost forkable position: the trunk is Plan and A, so once the
// plan's close is added there is no node strictly above A at all. This is the shape
// section 6 of the record argues the bubble for.
function v2Bubble() {
  return {
    schema: 2, domain: 'D', rootOrder: ['p'],
    tasks: {
      p: v2Project('p', 'Plan', { next: 'a' }),
      a: v2Task('a', 'A', { branches: [{ child: 'x1', side: 'right', at: 'above' }] }),
      x1: v2Task('x1', 'X1'),
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
    //
    // Returns: L2 is on this array too, behind them. It hung on L1, which is the whole of
    // its own branch and therefore has a return line above it rather than a trunk edge, so
    // the nearest edge schema 3 can express is the one L1 itself leaves, which is A's. A
    // re-homed fork is appended, so the two forks schema 2 stored on A keep their order at
    // the front and the author's order is disturbed only by the arrival.
    expect(byTitle(record, 'A').leftBranches).toEqual([id('L1'), id('M1'), id('L2')])

    // `at: 'below'` on B named the edge whose upper node is B, which rises from B's
    // main-line predecessor A — so it moves to A, and B keeps no fork of its own.
    expect(byTitle(record, 'A').rightBranches).toEqual([id('R1')])
    expect(byTitle(record, 'B').leftBranches).toEqual([])
    expect(byTitle(record, 'B').rightBranches).toEqual([])

    // A below-fork on a root has no edge beneath it, so the nearest legal edge is
    // the one above and it stays where it was.
    expect(byTitle(record, 'Plan').rightBranches).toEqual([id('R0')])

    // Returns: the below-fork at the foot of a branch trunk does not stay there any more.
    // Its holder L1 is that branch's top as well as its foot, so the fork would name a
    // return line rather than an edge, and it goes down to A keeping the side it had. What
    // this array can still say is that L1 ends up holding nothing at all.
    expect(byTitle(record, 'L1').leftBranches).toEqual([])
    expect(byTitle(record, 'L1').rightBranches).toEqual([])

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

  // Returns: schema 2 let a fork hang anywhere, the top of a branch included, and schema 3
  // has no edge there to hang it from: what rises from a branch's top is that branch's own
  // return line. So the pass moves those forks to the nearest position it can express,
  // before it invents any merge; the three tests below are the two places one lands and the
  // case that only looks like it needs moving.
  it('moves a fork hung on the top of a branch one node down that branch', () => {
    const { record } = migrateRecord(v2Nested())
    const x1 = byTitle(record, 'X1')
    const y1 = byTitle(record, 'Y1')

    // Y1 hung on X2, the top of the branch X1 leads, so it comes down to X1: the same move
    // the below-fork translation makes, one gap lower on the same trunk and the same side.
    expect(byTitle(record, 'X2').rightBranches).toEqual([])
    expect(x1.rightBranches).toEqual([y1.id])

    // Both branches then have somewhere legal to return to, which is the point of moving it
    // before the merges are fabricated rather than after.
    expect(byTitle(record, 'X2').mergePoint).toBe(byTitle(record, 'C').id)
    expect(y1.mergePoint).toBe(x1.id)
    expect(validateRecord(record).ok).toBe(true)
  })

  it('moves a fork hung on a one-node branch onto that branch\'s own branch point', () => {
    const { record } = migrateRecord(v2())
    const l1 = byTitle(record, 'L1')
    const l2 = byTitle(record, 'L2')

    // L1 is one node, so it is the foot and the top of its branch at once and there is no
    // node below it on its own trunk to come down to. What is below its foot is the edge the
    // branch itself leaves, A's, so L2 lands there and becomes L1's sibling rather than its
    // child. The two are then drawn side by side off one edge, which is as close to the old
    // picture as schema 3 can come.
    expect(l1.leftBranches).toEqual([])
    expect(byTitle(record, 'A').leftBranches).toEqual([l1.id, byTitle(record, 'M1').id, l2.id])

    // And it merges as any other fork off A does, one row up.
    expect(l2.mergePoint).toBe(byTitle(record, 'B').id)
    expect(l1.mergePoint).toBe(byTitle(record, 'B').id)
    expect(validateRecord(record).ok).toBe(true)
  })

  it('leaves a fork on a trunk top that gained a terminus where it was', () => {
    const { record } = migrateRecord(v2Bubble())

    // A held a fork and had nothing above it in schema 2, but every scope is closed before
    // anything is moved, so by then the plan's close rises from A and the fork names a real
    // trunk edge. Nothing moves, and the order of the two passes is what decides it.
    expect(byTitle(record, 'A').rightBranches).toEqual([byTitle(record, 'X1').id])
    expect(validateRecord(record).ok).toBe(true)
  })

  // Returns: schema 2 could not say where a branch rejoins, because in schema 2 no branch
  // did. The pass therefore invents a merge for every branch rather than translating one,
  // and these five tests are the invention: that it happens at all, the height it picks,
  // the two things that clamp that height, and the floor it clamps to.
  it('gives every branch a return, stored on the top of the branch', () => {
    const { record } = migrateRecord(v2())
    const branches = branchesIn(record)
    expect(branches).toHaveLength(5) // R0 and R1, L1 and M1, and L2 once it has moved to A

    for (const branch of branches) {
      // A return leaves the branch at its top, so that is the end it is stored on. Reading
      // it anywhere else would be reading a copy of it.
      expect(branch.mergePoint).toBeTruthy()
      expect(record.nodes[branch.tipId].mergePoint).toBe(branch.mergePoint)
      expect(record.nodes[branch.mergePoint]).toBeDefined()
    }

    // A project node always has its own close above it, so it is never a trunk's top and
    // never carries the field at all.
    expect(byTitle(record, 'Plan').mergePoint).toBeUndefined()

    expect(validateRecord(record).ok).toBe(true)
  })

  it('merges each branch at the edge level with its own top', () => {
    const { record } = migrateRecord(v2())

    // R1 is one node, and a branch's foot sits one row above its branch point, so R1's top
    // is level with B and the return joins the edge rising from B. R0 leaves the plan's
    // base, the first edge on the trunk, so its one node is level with A.
    expect(byTitle(record, 'R1').mergePoint).toBe(byTitle(record, 'B').id)
    expect(byTitle(record, 'R0').mergePoint).toBe(byTitle(record, 'A').id)

    // A taller branch, on a trunk with room above it, shows that the height is the branch's
    // own and not a constant: X1 and X2 put the top two rows above the branch point A, level
    // with C, and the trunk carries on above C, so nothing clamped the choice. That is the
    // whole of the claim the pass makes; the drawing keeps the geometry schema 2 gave it and
    // gains a short return line at the top of the branch.
    const level = migrateRecord(v2Level()).record
    expect(byTitle(level, 'X2').mergePoint).toBe(byTitle(level, 'C').id)
    expect(byTitle(level, 'C').next).toBe(byTitle(level, 'D').id)
    expect(byTitle(level, 'X1').mergePoint).toBeNull() // not the top, so it holds nothing
    expect(validateRecord(level).ok).toBe(true)
  })

  it('clamps the merge down where that level runs past the top of the trunk', () => {
    const { record } = migrateRecord(v2Tall())
    const close = closeOf(record, byTitle(record, 'Plan').id)

    // The fork off A is three nodes tall and A has one node above it, so the row its top
    // wants is past the end of the trunk. The highest edge the trunk has is the one rising
    // from B into the plan's close, and that is where the return lands.
    expect(byTitle(record, 'X3').mergePoint).toBe(byTitle(record, 'B').id)
    expect(byTitle(record, 'B').next).toBe(close.id)

    // Nothing higher was available to clamp to: a plan ends at its close, so no edge rises
    // from it and no return can join there.
    expect(close.next).toBe(null)

    expect(validateRecord(record).ok).toBe(true)
  })

  it('clamps the merge down where that level would cross the close of the enclosing scope', () => {
    const { record } = migrateRecord(v2Scoped())
    const subClose = closeOf(record, byTitle(record, 'Sub').id)

    // The fork off B is two nodes tall, so the row its top wants is the row the close of
    // Sub takes. B was opened inside Sub, and a branch cannot reach out of the scope it was
    // opened in, so the return lands one edge lower, on the last edge that scope owns: the
    // one rising from C into the close.
    expect(byTitle(record, 'X2').mergePoint).toBe(byTitle(record, 'C').id)
    expect(byTitle(record, 'C').next).toBe(subClose.id)

    // The scope is the only bar here, which is what makes this case distinct from the one
    // above: Sub's close does have an edge above it, rising into the plan's own close, so
    // the height was refused for reaching out of a scope and not for having nowhere to land.
    expect(subClose.next).toBe(closeOf(record, byTitle(record, 'Plan').id).id)

    expect(validateRecord(record).ok).toBe(true)
  })

  it('gives a branch whose only legal merge is its own edge that bubble', () => {
    const { record } = migrateRecord(v2Bubble())

    // On a trunk of Plan, A and the plan's close there is no node strictly above A, so the
    // only edge the branch can return to is the one it left. A bubble is legal wherever a
    // trunk edge rises at all, which is what gives the clamp a floor to reach.
    expect(byTitle(record, 'X1').mergePoint).toBe(byTitle(record, 'A').id)
    expect(validateRecord(record).ok).toBe(true)

    // Returns: the same floor takes a branch hanging off another branch, at the position
    // re-homing leaves it in. Y1 sits on X1, and the one node above X1 on that branch's own
    // trunk is X2, its top, whose rising line is a return rather than a trunk edge. So no
    // higher edge is offered and Y1 bubbles, one branch trunk out from the plan's.
    const { record: nested } = migrateRecord(v2Nested())
    expect(byTitle(nested, 'Y1').mergePoint).toBe(byTitle(nested, 'X1').id)
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
