// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { migrateRecord } from './migrate.js'
import { validateRecord } from './validate.js'

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

describe('migrateRecord — schema 1 to 2', () => {
  it('prepends a named project root per tree, builds rootOrder, and validates', () => {
    const { record, changed } = migrateRecord(v1())
    expect(changed).toBe(true)
    expect(record.schema).toBe(2)
    expect(record.trees).toBeUndefined()
    expect(record.rootOrder).toHaveLength(2)

    expect(record.tasks.a.kind).toBe('task') // existing tasks become tasks, keeping their status
    expect(record.tasks.a.status).toBe('completed')

    const r0 = record.tasks[record.rootOrder[0]]
    expect(r0.kind).toBe('project')
    expect(r0.title).toBe('Alpha')
    expect(r0.next).toBe('a') // the old root becomes the project's first real node
    expect(r0.status).toBeUndefined()

    const r1 = record.tasks[record.rootOrder[1]]
    expect(r1.title).toBe('Beta')
    expect(r1.next).toBe('c')

    expect(validateRecord(record).ok).toBe(true)
  })

  it('does not mutate its input', () => {
    const input = v1()
    const copy = structuredClone(input)
    migrateRecord(input)
    expect(input).toEqual(copy)
  })

  it('is a no-op on a schema 2 record', () => {
    const already = {
      schema: 2, domain: 'D', rootOrder: ['p'],
      tasks: { p: { id: 'p', title: 'P', kind: 'project', createdAt: 'x', note: null, next: null, branches: [] } },
    }
    const { record, changed } = migrateRecord(already)
    expect(changed).toBe(false)
    expect(record).toBe(already)
  })
})
