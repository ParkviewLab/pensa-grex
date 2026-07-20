// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.forest.json5?raw'
import { validateForest } from './validate.js'

// A task node with sensible defaults.
function task(overrides) {
  return {
    id: 'k_x', title: 'X', kind: 'task', status: 'todo',
    createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, branches: [],
    ...overrides,
  }
}

// A project node (a root, or a mid-tree sub-project) with sensible defaults.
function project(overrides) {
  return {
    id: 'p_x', title: 'P', kind: 'project',
    createdAt: '2026-01-01T00:00:00Z',
    note: null, next: null, branches: [],
    ...overrides,
  }
}

describe('validateForest — the HomeLab fixture', () => {
  it('is valid as shipped', () => {
    const raw = JSON5.parse(fixtureRaw)
    const result = validateForest(raw)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('validateForest — invariants', () => {
  it('rejects a reachable cycle (and the extra incoming edge it creates)', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', next: 'a' }), // back-edge to a
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('more than one incoming edge'))).toBe(true)
    expect(errors.some((e) => e.includes('cycle detected'))).toBe(true)
  })

  it('rejects a task with more than one incoming edge', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'c', branches: [{ child: 'b', side: 'left', at: 'above' }] }),
        b: task({ id: 'b', next: 'c' }), // b also points its .next at c
        c: task({ id: 'c' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"c" has more than one incoming edge'))).toBe(true)
  })

  it('rejects a reference to a task that does not exist', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'ghost' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('unknown task "ghost"'))).toBe(true)
  })

  it('rejects a root that is not a project node', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['a'],
      tasks: { a: task({ id: 'a', next: 'b' }), b: task({ id: 'b' }) }, // a has no incoming edge but is a task
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('root node "a" must be a project node'))).toBe(true)
  })

  it('rejects nodes in a detached cycle as unreachable', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a' }),
        c: task({ id: 'c', next: 'd' }), // c and d only reference each other
        d: task({ id: 'd', next: 'c' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('is not reachable from any root'))).toBe(true)
  })

  it('rejects an invalid status', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: { p: project({ id: 'p', next: 'a' }), a: task({ id: 'a', status: 'someday' }) },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('invalid status'))).toBe(true)
  })

  it('rejects completed without completedAt, and completedAt without completed', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', status: 'completed', completedAt: null, next: 'b' }),
        b: task({ id: 'b', status: 'todo', completedAt: '2026-01-02T00:00:00Z' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"a" is completed but has no completedAt'))).toBe(true)
    expect(errors.some((e) => e.includes('"b" has completedAt but is not completed'))).toBe(true)
  })

  it('rejects a project node that carries a status', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: { p: project({ id: 'p', status: 'todo', next: 'a' }), a: task({ id: 'a' }) },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('project node "p" must not have a status'))).toBe(true)
  })

  it('rejects a mid-tree project node that is marked "here"', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'q' }),
        q: project({ id: 'q', here: true }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('project node "q" must not be "here"'))).toBe(true)
  })

  it('rejects more than one "here" on the same branch', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', here: true, next: 'b' }),
        b: task({ id: 'b', here: true }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"here" cursors'))).toBe(true)
  })

  it('allows one "here" per branch, several across a forked tree', () => {
    const raw = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: {
        p: project({ id: 'p', next: 'a' }),
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', here: true, branches: [{ child: 'c', side: 'left', at: 'above' }] }),
        c: task({ id: 'c', here: true }), // a different branch — allowed
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })
})
