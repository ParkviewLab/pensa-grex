// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.record.json?raw'
import { validateRecord, pairScopes, trunksOf, indexRecord, enclosingScopeOpen, scopeOf, extentOf, reachableFrom } from './validate.js'

// A task node with sensible defaults.
function task(overrides) {
  return {
    id: 'k_x', title: 'X', kind: 'task', status: 'todo',
    createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, leftBranches: [], rightBranches: [],
    ...overrides,
  }
}

// A project node (a root, or a mid-tree sub-project) with sensible defaults.
function project(overrides) {
  return {
    id: 'p_x', title: 'P', kind: 'project',
    createdAt: '2026-01-01T00:00:00Z',
    note: null, next: null, leftBranches: [], rightBranches: [],
    ...overrides,
  }
}

// The node that closes a scope. It holds no title, no status, no completedAt, no
// "here" and no flag, so the builder omits those fields rather than defaulting
// them: a terminus carrying any of them is a validation error.
function terminus(overrides) {
  return {
    id: 't_x', kind: 'terminus',
    createdAt: '2026-01-01T00:00:00Z',
    note: null, next: null, leftBranches: [], rightBranches: [],
    ...overrides,
  }
}

// Termini: every project node must now be closed by exactly one terminus above it on
// its trunk, so each fixture below closes its base. Where the defect under test
// makes the top of the base's trunk unusable (a cycle, a duplicate incoming edge, a
// dangling .next), the base is closed immediately, which is a legal empty plan, and
// the fragment under test hangs off the base's one edge; that keeps every record
// wrong in exactly the one way its test names. No assertion changed meaning.

// Returns: every branch now rejoins the trunk it left, so each branch in a record that
// is meant to be valid carries a mergePoint on its tip. In the two fixtures where a
// branch already existed for another reason, the only landing available is the branch's
// own edge, because the node above the branch point is the plan's close and nothing may
// join above that; both therefore merge as bubbles. Again no assertion changed meaning.

describe('validateRecord — the HomeLab fixture', () => {
  it('is valid as shipped', () => {
    const record = JSON5.parse(fixtureRaw)
    const result = validateRecord(record)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('validateRecord — invariants', () => {
  it('rejects a reachable cycle (and the extra incoming edge it creates)', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't', leftBranches: ['a'] }),
        t: terminus({ id: 't' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', next: 'a' }), // back-edge to a
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('more than one incoming edge'))).toBe(true)
    expect(errors.some((e) => e.includes('cycle detected'))).toBe(true)
  })

  it('rejects a task with more than one incoming edge', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't', leftBranches: ['a'] }),
        t: terminus({ id: 't' }),
        a: task({ id: 'a', next: 'c', leftBranches: ['b'] }),
        b: task({ id: 'b', next: 'c' }), // b also points its .next at c
        c: task({ id: 'c' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"c" has more than one incoming edge'))).toBe(true)
  })

  it('rejects a reference to a node that does not exist', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't', leftBranches: ['a'] }),
        t: terminus({ id: 't' }),
        a: task({ id: 'a', next: 'ghost' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('unknown node "ghost"'))).toBe(true)
  })

  it('rejects a root that is not a project node', () => {
    // No project node here, so nothing is left open: the record's one fault is that
    // its root is a task.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['a'],
      nodes: { a: task({ id: 'a', next: 'b' }), b: task({ id: 'b' }) }, // a has no incoming edge but is a task
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('root node "a" must be a project node'))).toBe(true)
  })

  it('rejects nodes in a detached cycle as unreachable', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 't' }),
        t: terminus({ id: 't' }),
        c: task({ id: 'c', next: 'd' }), // c and d only reference each other
        d: task({ id: 'd', next: 'c' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('is not reachable from any root'))).toBe(true)
  })

  it('rejects an invalid status', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', status: 'someday', next: 't' }),
        t: terminus({ id: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('invalid status'))).toBe(true)
  })

  it('rejects completed without completedAt, and completedAt without completed', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', status: 'completed', completedAt: null, next: 'b' }),
        b: task({ id: 'b', status: 'todo', completedAt: '2026-01-02T00:00:00Z', next: 't' }),
        t: terminus({ id: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"a" is completed but has no completedAt'))).toBe(true)
    expect(errors.some((e) => e.includes('"b" has completedAt but is not completed'))).toBe(true)
  })

  it('rejects a project node that carries a status', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', status: 'todo', next: 'a' }),
        a: task({ id: 'a', next: 't' }),
        t: terminus({ id: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('project node "p" must not have a status'))).toBe(true)
  })

  it('rejects a mid-tree project node that is marked "here"', () => {
    // Two scopes on one trunk, so the closes stack in reverse order of opening: q's
    // close first, then the plan's.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'q' }),
        q: project({ id: 'q', here: true, next: 't_q' }),
        t_q: terminus({ id: 't_q', next: 't_p' }),
        t_p: terminus({ id: 't_p' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('project node "q" must not be "here"'))).toBe(true)
  })

  it('rejects more than one "here" on the same branch', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', here: true, next: 'b' }),
        b: task({ id: 'b', here: true, next: 't' }),
        t: terminus({ id: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"here" marks'))).toBe(true)
  })

  it('allows one "here" per branch, several across a forked tree', () => {
    // Returns: the fork off b can only bubble back onto the edge it left, since the
    // one node above b is the plan's close and nothing may join above that.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', here: true, leftBranches: ['c'], next: 't' }),
        c: task({ id: 'c', here: true, mergePoint: 'b' }), // a different branch, so allowed
        t: terminus({ id: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })
})

describe('validateRecord — scopes and their closes', () => {
  it('accepts an empty plan: a base directly under its close', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: { p: project({ id: 'p', next: 't' }), t: terminus({ id: 't' }) },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  })

  it('rejects a project node with no terminus above it on its trunk', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: { p: project({ id: 'p', next: 'a' }), a: task({ id: 'a' }) },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('project node "p" is never closed'))).toBe(true)
  })

  it('rejects a terminus with no project open below it on its trunk', () => {
    // The plan itself is closed by t; u sits at the top of a branch trunk, where
    // nothing is open.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't', leftBranches: ['a'] }),
        t: terminus({ id: 't' }),
        a: task({ id: 'a', next: 'u' }),
        u: terminus({ id: 'u' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('terminus "u" closes nothing'))).toBe(true)
  })

  it('rejects a terminus that carries a title, a status, a flag or the cursor', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't' }),
        t: terminus({
          id: 't', title: 'Shipped', status: 'todo',
          completedAt: '2026-01-02T00:00:00Z', here: true, flagged: true,
        }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('terminus "t" must not have a title'))).toBe(true)
    expect(errors.some((e) => e.includes('terminus "t" must not have a status'))).toBe(true)
    expect(errors.some((e) => e.includes('terminus "t" must not have completedAt'))).toBe(true)
    expect(errors.some((e) => e.includes('terminus "t" must not be "here"'))).toBe(true)
    expect(errors.some((e) => e.includes('terminus "t" must not be flagged'))).toBe(true)
  })

  it('rejects a terminus that arrives as a branch child', () => {
    // A scope that opened on one trunk cannot close at the foot of another. Such a
    // terminus also opens a trunk of its own with nothing below it, so the record is
    // faulted twice over; the branch-child edge is the fault under test.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't', leftBranches: ['u'] }),
        t: terminus({ id: 't' }),
        u: terminus({ id: 'u' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('terminus "u" is a branch child'))).toBe(true)
  })

  it("rejects a node above a plan's closing terminus, and a branch hanging off it", () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 't' }),
        t: terminus({ id: 't', next: 'a', leftBranches: ['b'] }),
        a: task({ id: 'a' }),
        b: task({ id: 'b' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"t" has a node above it'))).toBe(true)
    expect(errors.some((e) => e.includes('"t" has a branch'))).toBe(true)
  })

  it("allows a task above a sub-project's terminus, which does have an edge above it", () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'q' }),
        q: project({ id: 'q', next: 't_q' }),
        t_q: terminus({ id: 't_q', next: 'a' }),
        a: task({ id: 'a', next: 't_p' }),
        t_p: terminus({ id: 't_p' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  })

  it('pairs closes in reverse order of opening, up the trunk', () => {
    // P1, a, P2, b, T2, T1: the scope opened higher closes lower.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p1'],
      nodes: {
        p1: project({ id: 'p1', next: 'a' }),
        a: task({ id: 'a', next: 'p2' }),
        p2: project({ id: 'p2', next: 'b' }),
        b: task({ id: 'b', next: 't2' }),
        t2: terminus({ id: 't2', next: 't1' }),
        t1: terminus({ id: 't1' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const { pairs, closes, errors } = pairScopes(record, trunksOf(record))
    expect(errors).toEqual([])
    expect(Object.fromEntries(pairs)).toEqual({ p1: 't1', p2: 't2' })
    expect(Object.fromEntries(closes)).toEqual({ t1: 'p1', t2: 'p2' })
  })

  it('splits a branch onto its own trunk, base to top', () => {
    // Returns: the merge point sits on c, the top of the branch trunk, because that is
    // the end the return line leaves from; a bubble back onto a's own edge is the only
    // landing this trunk offers, the node above a being the plan's close.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 't', leftBranches: ['b'] }),
        b: task({ id: 'b', next: 'c' }),
        c: task({ id: 'c', mergePoint: 'a' }),
        t: terminus({ id: 't' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    expect(trunksOf(record).map((trunk) => trunk.join('>')).sort()).toEqual(['b>c', 'p>a>t'])
  })
})

describe('validateRecord — branches and their returns', () => {
  // The trunk from the diagram in section 8: a branch opened below a sub-project, on a
  // trunk running p, a, q, b, t_q, c, t_p from the base upward. Where the return lands
  // is the parameter, since it is the only thing the records below disagree about.
  function straddle(mergePoint) {
    return {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'q', leftBranches: ['x'] }),
        q: project({ id: 'q', title: 'Sub', next: 'b' }),
        b: task({ id: 'b', next: 't_q' }),
        t_q: terminus({ id: 't_q', next: 'c' }),
        c: task({ id: 'c', next: 't_p' }),
        t_p: terminus({ id: 't_p' }),
        x: task({ id: 'x', mergePoint }),
      },
    }
  }

  it('rejects a branch with no merge point', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b', leftBranches: ['x'] }),
        b: task({ id: 'b', next: 't' }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x' }), // the tip of the branch, carrying no return
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('the branch at "x" has no merge point'))).toBe(true)
  })

  it('rejects a merge point on a trunk the branch never left', () => {
    // x hangs off a and names y, which is the whole of another branch's trunk. The
    // second branch is a legal bubble, so the record's one fault is x's return.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b', leftBranches: ['x'] }),
        b: task({ id: 'b', next: 't', leftBranches: ['y'] }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', mergePoint: 'y' }),
        y: task({ id: 'y', mergePoint: 'b' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('the branch at "x" merges at "y", which is not on the trunk it left'))).toBe(true)
  })

  it('rejects a merge below the branch point, which is a loop and not a return', () => {
    // The trunk flows up from the join to the branch point and the return flows back
    // down into it, so this record is faulted twice over, as a loop and as a cycle; the
    // downward merge is the fault under test, and the cycle is the subject of the last
    // test in this block.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', next: 't', leftBranches: ['x'] }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', mergePoint: 'a' }), // a sits below x's own branch point
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('merges below its own branch point'))).toBe(true)
  })

  it("rejects a merge at the plan's close, which has no edge above it", () => {
    // A node can receive a merge exactly when a trunk edge rises from it, and a plan's
    // close has nothing above it, so it is the one position on a trunk that no return
    // can name.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 't', leftBranches: ['x'] }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', mergePoint: 't' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('merges above "t", which has no edge above it'))).toBe(true)
  })

  it('accepts a bubble, the smallest legal branch', () => {
    // On a trunk running p, a, t there is no node strictly between a and its close, so
    // a fork off a can only return to the edge it left. Without the bubble the topmost
    // forkable position on every trunk would be unforkable.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 't', leftBranches: ['x'] }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', mergePoint: 'a' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  })

  it('accepts two branches sharing one merge point, which is an n-way join', () => {
    // Returns arrive at the node above the join edge, and they are not counted among
    // its incoming edges, so t takes one trunk predecessor and two returns without
    // tripping the one-incoming-edge rule.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b', leftBranches: ['x'] }),
        b: task({ id: 'b', next: 'c', rightBranches: ['y'] }),
        c: task({ id: 'c', next: 't' }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', mergePoint: 'c' }),
        y: task({ id: 'y', mergePoint: 'c' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  })

  it('rejects a branch that escapes the scope it was opened in', () => {
    // x forks off a, which is inside "Sub", and names b, which sits above the close of
    // "Sub". Collapsing that scope would leave the return line with nowhere to land.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'q' }),
        q: project({ id: 'q', title: 'Sub', next: 'a' }),
        a: task({ id: 'a', next: 't_q', leftBranches: ['x'] }),
        t_q: terminus({ id: 't_q', next: 'b' }),
        b: task({ id: 'b', next: 't_p' }),
        t_p: terminus({ id: 't_p' }),
        x: task({ id: 'x', mergePoint: 'b' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('merges past the close of "Sub", the scope it was opened in'))).toBe(true)
  })

  it('rejects a branch that merges inside a scope it was opened outside', () => {
    // The mirror of the clause above, and the same collapse it protects. The refusal has
    // to name the two legal alternatives in the same breath, or the author is told only
    // that the shape is wrong.
    const { ok, errors } = validateRecord(straddle('b'))
    expect(ok).toBe(false)
    const message = errors.find((e) => e.includes('a scope it was opened outside'))
    expect(message).toBeDefined()
    expect(message).toContain('merges inside "Sub"')
    expect(message).toContain('merge below where "Sub" opens')
    expect(message).toContain('above where it closes')
  })

  it('accepts both of the alternatives the refusal names', () => {
    // Below where "Sub" opens is a bubble on a's own edge; above where it closes is the
    // span that contains the whole scope, which is the legal half of section 8's diagram.
    expect(validateRecord(straddle('a'))).toEqual({ ok: true, errors: [] })
    expect(validateRecord(straddle('t_q'))).toEqual({ ok: true, errors: [] })
  })

  it('rejects a merge point on a node that is not a branch tip', () => {
    // A return leaves a branch at its top, so a merge stored on the foot of a two-node
    // branch is wrong twice over: the foot may not carry one, and the tip that should
    // is left without.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b', leftBranches: ['x'] }),
        b: task({ id: 'b', next: 't' }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', next: 'y', mergePoint: 'a' }),
        y: task({ id: 'y' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('node "x" holds a merge point but is not the top of a branch trunk'))).toBe(true)
    expect(errors.some((e) => e.includes('the branch at "x" has no merge point'))).toBe(true)
  })

  it('reports a cycle reached through a return edge', () => {
    // A return is an edge like any other, so the cycle walk follows it from the tip to
    // whatever sits above the merge point. A legal return makes a diamond; one that
    // reaches downward makes the loop this catches, which is why the record is faulted
    // both as a cycle and as a merge below the branch point.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', next: 'c' }),
        c: task({ id: 'c', next: 't', leftBranches: ['x'] }),
        t: terminus({ id: 't' }),
        x: task({ id: 'x', next: 'y' }),
        y: task({ id: 'y', mergePoint: 'a' }),
      },
    }
    const { ok, errors } = validateRecord(record)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('cycle detected') && e.includes('y -> b'))).toBe(true)
  })
})

describe('enclosingScopeOpen — the bound a branch may not reach past', () => {
  it('matches brackets down the trunk rather than taking the nearest project node', () => {
    // The trunk from section 4: p, a, p2, b, t2, c, t_p from the base upward. The
    // nearest project node below c is p2, whose close t2 sits below c, so taking it
    // would ask a branch off c to merge above c and below t2 at once, which nothing
    // satisfies. Matching brackets skips the pair that closed below us and answers with
    // the plan's own scope.
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'p2' }),
        p2: project({ id: 'p2', title: 'Sub', next: 'b' }),
        b: task({ id: 'b', next: 't2' }),
        t2: terminus({ id: 't2', next: 'c' }),
        c: task({ id: 'c', next: 't_p', leftBranches: ['x'] }),
        t_p: terminus({ id: 't_p' }),
        x: task({ id: 'x', mergePoint: 'c' }),
      },
    }
    const ix = indexRecord(record)
    expect(enclosingScopeOpen(record, 'c', ix)).toBe('p')
    expect(enclosingScopeOpen(record, 'b', ix)).toBe('p2')
    // At the foot of a branch trunk the walk hops to the parent trunk at that branch's
    // own node, so a node on the branch answers with the scope its branch point sits in.
    expect(enclosingScopeOpen(record, 'x', ix)).toBe('p')
    // And the branch the bound permits is accepted: a bubble on c's own edge.
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  })
})

describe('reachableFrom and scopeOf — what belongs to a scope', () => {
  // A plan with a sub-project in the middle of its trunk, a branch inside that scope, a
  // branch on the scope's own opening edge, a branch on its close, and a task above it:
  //
  //   P  a  P2  b  T2  c  T          (base to top, up the trunk)
  //          |   |   |
  //          x   y   z               (x on P2's own edge, y inside, z on the close)
  const record = () => ({
    schema: 3, id: 'd_1', title: 'D', planOrder: ['P'],
    nodes: {
      P: project({ id: 'P', next: 'a' }),
      a: task({ id: 'a', next: 'P2' }),
      P2: project({ id: 'P2', next: 'b', rightBranches: ['x1'] }),
      b: task({ id: 'b', next: 'T2', rightBranches: ['y1'] }),
      T2: terminus({ id: 'T2', next: 'c', rightBranches: ['z1'] }),
      c: task({ id: 'c', next: 'T' }),
      T: terminus({ id: 'T' }),
      x1: task({ id: 'x1', next: 'x2' }),
      x2: task({ id: 'x2', mergePoint: 'P2' }),
      y1: task({ id: 'y1', mergePoint: 'b' }),
      z1: task({ id: 'z1', mergePoint: 'T2' }),
    },
  })

  it('stops at the close, so the trunk above a scope is not part of it', () => {
    const { body, terminusId } = scopeOf(record(), 'P2')
    expect(terminusId).toBe('T2')
    // Inside: the run between the pair, the branch on the opening edge, the branch off b.
    expect([...body].sort()).toEqual(['b', 'x1', 'x2', 'y1'])
    // Outside: the close itself, the branch hanging off the close, and everything above.
    for (const id of ['P2', 'T2', 'z1', 'c', 'T', 'a', 'P']) expect(body.has(id)).toBe(false)
  })

  it('gives a plan\'s own base everything but its close', () => {
    const { body, terminusId } = scopeOf(record(), 'P')
    expect(terminusId).toBe('T')
    expect(body.has('P2')).toBe(true)
    expect(body.has('T2')).toBe(true) // a nested pair is wholly inside the outer scope
    expect(body.has('c')).toBe(true)
    expect(body.has('z1')).toBe(true) // and so is the branch off the nested close
    expect(body.has('T')).toBe(false)
    expect(body.has('P')).toBe(false)
  })

  it('returns nothing for a node that opens no scope', () => {
    expect(scopeOf(record(), 'b')).toBeNull()
    expect(scopeOf(record(), 'T2')).toBeNull()
    expect(scopeOf(record(), 'nope')).toBeNull()
  })

  it('takes the close bracket matching gives it, which on an unbalanced trunk is the outer one', () => {
    // With T2 gone the trunk reads P a P2 b c T: P2 opened last, so the one remaining close
    // is its, and P is the scope left unclosed. scopeOf does not guess or invent a close, it
    // reports the pairing, so a caller folding P2 hides b and c and stops below T.
    const r = record()
    delete r.nodes.T2
    r.nodes.b.next = 'c'
    delete r.nodes.z1
    const { body, terminusId } = scopeOf(r, 'P2')
    expect(terminusId).toBe('T')
    expect(body.has('b')).toBe(true)
    expect(body.has('c')).toBe(true)
    expect(body.has('T')).toBe(false)
  })

  it('falls back to the top of the trunk when nothing closes the scope at all', () => {
    // No terminus anywhere above P2: there is no scope to stay inside, so the unbounded
    // reading is the only one left, and the caller sees terminusId null and can say so.
    const r = record()
    delete r.nodes.T2
    delete r.nodes.T
    delete r.nodes.z1
    r.nodes.b.next = 'c'
    r.nodes.c.next = null
    const { body, terminusId } = scopeOf(r, 'P2')
    expect(terminusId).toBeNull()
    expect(body.has('b')).toBe(true)
    expect(body.has('c')).toBe(true)
  })

  it('reads a branch as bounded by itself, which is why a branch subtree needs no bracket', () => {
    // reachableFrom follows next and the branch arrays with no notion of a scope; from a
    // branch's foot that is exactly the branch, since a branch's tip has no successor.
    expect([...reachableFrom(record(), 'x1')].sort()).toEqual(['x1', 'x2'])
    // From a node on a plan's trunk it runs to the top, which is the reading the fold had
    // to stop using.
    expect(reachableFrom(record(), 'P2').has('T')).toBe(true)
  })
})

describe('extentOf — what an operation on a node takes with it', () => {
  // The same plan as above: P a P2 b T2 c T up the trunk, with x on P2's own edge, y
  // inside the scope, and z on the close, which is outside it.
  const record = () => ({
    schema: 3, id: 'd_1', title: 'D', planOrder: ['P'],
    nodes: {
      P: project({ id: 'P', next: 'a' }),
      a: task({ id: 'a', next: 'P2' }),
      P2: project({ id: 'P2', next: 'b', rightBranches: ['x1'] }),
      b: task({ id: 'b', next: 'T2', rightBranches: ['y1'] }),
      T2: terminus({ id: 'T2', next: 'c', rightBranches: ['z1'] }),
      c: task({ id: 'c', next: 'T' }),
      T: terminus({ id: 'T' }),
      x1: task({ id: 'x1', next: 'x2' }),
      x2: task({ id: 'x2', mergePoint: 'P2' }),
      y1: task({ id: 'y1', mergePoint: 'b' }),
      z1: task({ id: 'z1', mergePoint: 'T2' }),
    },
  })

  it('gives a project node its own pair and body, and stops there', () => {
    // What the drag, the delete, the copy and the export all move on: the scope, close
    // included, and not the work that comes after the scope ends.
    expect([...extentOf(record(), 'P2')].sort()).toEqual(['P2', 'T2', 'b', 'x1', 'x2', 'y1'])
    for (const id of ['c', 'T', 'z1', 'a', 'P']) expect(extentOf(record(), 'P2').has(id)).toBe(false)
  })

  it('gives a task the run above it, stopping below the close of the scope it sits in', () => {
    // b is inside P2, so its extent ends below T2; the nodes above that close belong to
    // the enclosing plan, not to b.
    expect([...extentOf(record(), 'b')].sort()).toEqual(['b', 'y1'])
    // a sits in P's scope, so its extent takes the nested pair whole and stops below T.
    expect([...extentOf(record(), 'a')].sort()).toEqual(['P2', 'T2', 'a', 'b', 'c', 'x1', 'x2', 'y1', 'z1'])
  })

  it('runs to the tip where no close encloses it, which is what a branch already is', () => {
    expect([...extentOf(record(), 'x1')].sort()).toEqual(['x1', 'x2'])
  })

  it('answers for a terminus with the scope it closes, a pair having no half', () => {
    expect([...extentOf(record(), 'T2')].sort()).toEqual([...extentOf(record(), 'P2')].sort())
  })

  it('is bracket-matched, so it can be lifted out or deleted whole', () => {
    for (const id of Object.keys(record())) {
      const r = record()
      const depth = [...extentOf(r, id)].reduce((d, x) => d + (r.nodes[x].kind === 'project' ? 1 : r.nodes[x].kind === 'terminus' ? -1 : 0), 0)
      expect(depth).toBe(0)
    }
  })

  it('is empty for a node that is not there', () => {
    expect([...extentOf(record(), 'nope')]).toEqual([])
  })
})
