// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.forest.json5?raw'
import { validateForest } from './validate.js'

function task(overrides) {
  return {
    id: 'k_x', title: 'X', status: 'todo',
    createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, branches: [],
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
  it('rejects a cycle and flags the root that receives the back-edge', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: {
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b', next: 'a' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('incoming edge'))).toBe(true)
    expect(errors.some((e) => e.includes('cycle detected'))).toBe(true)
  })

  it('rejects a task with more than one incoming edge', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: {
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
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: { a: task({ id: 'a', next: 'ghost' }) },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('unknown task "ghost"'))).toBe(true)
  })

  it('rejects a declared root that has an incoming edge', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [
        { id: 't1', name: 'T1', rootTaskId: 'a' },
        { id: 't2', name: 'T2', rootTaskId: 'b' }, // b is also a's next — not a real root
      ],
      tasks: {
        a: task({ id: 'a', next: 'b' }),
        b: task({ id: 'b' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('root task "b" has an incoming edge'))).toBe(true)
  })

  it('rejects a task unreachable from any tree root', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: {
        a: task({ id: 'a' }),
        orphan: task({ id: 'orphan' }), // no incoming edge, not a root
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"orphan" is unreachable'))).toBe(true)
  })

  it('rejects an invalid status', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: { a: task({ id: 'a', status: 'someday' }) },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('invalid status'))).toBe(true)
  })

  it('rejects completed without completedAt, and completedAt without completed', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [
        { id: 't1', name: 'T1', rootTaskId: 'a' },
        { id: 't2', name: 'T2', rootTaskId: 'b' },
      ],
      tasks: {
        a: task({ id: 'a', status: 'completed', completedAt: null }),
        b: task({ id: 'b', status: 'todo', completedAt: '2026-01-02T00:00:00Z' }),
      },
    }
    const { ok, errors } = validateForest(raw)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('"a" is completed but has no completedAt'))).toBe(true)
    expect(errors.some((e) => e.includes('"b" has completedAt but is not completed'))).toBe(true)
  })

  it('rejects more than one "here" on the same branch', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: {
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
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'T', rootTaskId: 'a' }],
      tasks: {
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
