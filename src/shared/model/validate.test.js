// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.record.json?raw'
import { validateRecord, pairScopes, trunksOf } from './validate.js'

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
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', here: true, leftBranches: ['c'], next: 't' }),
        c: task({ id: 'c', here: true }), // a different branch — allowed
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
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'D', planOrder: ['p'],
      nodes: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 't', leftBranches: ['b'] }),
        b: task({ id: 'b', next: 'c' }),
        c: task({ id: 'c' }),
        t: terminus({ id: 't' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    expect(trunksOf(record).map((trunk) => trunk.join('>')).sort()).toEqual(['b>c', 'p>a>t'])
  })
})
