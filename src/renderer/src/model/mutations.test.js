// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import { validateForest } from './validate.js'
import {
  setTitle, setNote, setStatus, makeHere, clearHere, addTree, convertKind,
  addTaskAbove, addTaskBelow, addBranchAbove, addBranchBelow, deleteTask,
} from './mutations.js'

// A small valid forest: project root r -> m1(here) -> m2, with a fork b1 -> b2 off m1.
function base() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, branches: [], ...over,
  })
  const p = (id, over = {}) => ({
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, next: null, branches: [], ...over,
  })
  return {
    schema: 2,
    domain: 'T',
    rootOrder: ['r'],
    tasks: {
      r: p('r', { next: 'm1' }),
      m1: t('m1', { here: true, next: 'm2', branches: [{ child: 'b1', side: 'left', at: 'above' }] }),
      m2: t('m2'),
      b1: t('b1', { next: 'b2' }),
      b2: t('b2'),
    },
  }
}

const valid = (raw) => expect(validateForest(raw)).toEqual({ ok: true, errors: [] })
const ids = (raw) => Object.keys(raw.tasks).sort()
const newId = (before, after) => ids(after).find((id) => !before.tasks[id])

describe('setTitle / setStatus', () => {
  it('renames without touching anything else', () => {
    const out = setTitle(base(), 'm2', 'Renamed')
    expect(out.tasks.m2.title).toBe('Renamed')
    valid(out)
  })

  it('records and clears a note filename', () => {
    const withNote = setNote(base(), 'm2', 'm2.md')
    expect(withNote.tasks.m2.note).toBe('m2.md')
    valid(withNote)
    const cleared = setNote(withNote, 'm2', null)
    expect(cleared.tasks.m2.note).toBeNull()
    valid(cleared)
  })

  it('stamps completedAt on completion and clears it on leaving completed', () => {
    const done = setStatus(base(), 'm2', 'completed')
    expect(done.tasks.m2.status).toBe('completed')
    expect(done.tasks.m2.completedAt).toBeTruthy()
    valid(done)
    const undone = setStatus(done, 'm2', 'in-progress')
    expect(undone.tasks.m2.completedAt).toBeNull()
    valid(undone)
  })

  it('rejects an invalid status and never mutates the input', () => {
    const input = base()
    expect(() => setStatus(input, 'm2', 'bogus')).toThrow()
    expect(input.tasks.m2.status).toBe('todo')
  })

  it('refuses to set a status on a project node', () => {
    expect(() => setStatus(base(), 'r', 'todo')).toThrow()
  })
})

describe('convertKind', () => {
  it('turns a task into a project node, discarding status and cursor', () => {
    const out = convertKind(base(), 'm1') // m1 is a task, and is "here"
    expect(out.tasks.m1.kind).toBe('project')
    expect(out.tasks.m1.status).toBeUndefined()
    expect(out.tasks.m1.here).toBeUndefined()
    expect(out.tasks.m1.next).toBe('m2') // keeps its edges and children
    valid(out)
  })

  it('turns a project node back into a task, resetting to todo (lossy round-trip)', () => {
    const toProject = convertKind(base(), 'm2')
    const back = convertKind(toProject, 'm2')
    expect(back.tasks.m2.kind).toBe('task')
    expect(back.tasks.m2.status).toBe('todo')
    valid(back)
  })

  it('refuses to change the kind of a root node', () => {
    expect(() => convertKind(base(), 'r')).toThrow()
  })
})

describe('makeHere / clearHere', () => {
  it('moves the cursor within a line, clearing the previous one', () => {
    const out = makeHere(base(), 'm2')
    expect(out.tasks.m1.here).toBe(false)
    expect(out.tasks.m2.here).toBe(true)
    valid(out)
  })

  it('allows a second cursor on a different line (fork)', () => {
    const out = makeHere(base(), 'b2')
    expect(out.tasks.m1.here).toBe(true) // main-line cursor untouched
    expect(out.tasks.b2.here).toBe(true)
    valid(out)
  })

  it('clears a line cursor', () => {
    const out = clearHere(base(), 'm1')
    expect(out.tasks.m1.here).toBe(false)
    valid(out)
  })

  it('refuses to set "here" on a project node', () => {
    expect(() => makeHere(base(), 'r')).toThrow()
  })
})

describe('addTree', () => {
  it('starts a new project with its own project-node root, and works from an empty forest', () => {
    const empty = { schema: 2, domain: 'T', rootOrder: [], tasks: {} }
    const out = addTree(empty, 'Fresh')
    expect(out.rootOrder).toHaveLength(1)
    const rootId = out.rootOrder[0]
    expect(out.tasks[rootId].title).toBe('Fresh')
    expect(out.tasks[rootId].kind).toBe('project')
    valid(out)
  })
})

describe('addTask', () => {
  it('above inserts a successor and inherits the old one', () => {
    const before = base()
    const out = addTaskAbove(before, 'm1', 'N')
    const n = newId(before, out)
    expect(out.tasks.m1.next).toBe(n)
    expect(out.tasks[n].next).toBe('m2')
    valid(out)
  })

  it('below inserts under the predecessor', () => {
    const before = base()
    const out = addTaskBelow(before, 'm1', 'N')
    const n = newId(before, out)
    expect(out.tasks.r.next).toBe(n)
    expect(out.tasks[n].next).toBe('m1')
    valid(out)
  })

  it('refuses to add a task below a root node', () => {
    expect(() => addTaskBelow(base(), 'r', 'N')).toThrow()
  })

  it('below a branch child stays on that branch', () => {
    const before = base()
    const out = addTaskBelow(before, 'b1', 'N')
    const n = newId(before, out)
    expect(out.tasks.m1.branches[0].child).toBe(n)
    expect(out.tasks[n].next).toBe('b1')
    valid(out)
  })
})

describe('addBranch', () => {
  it('adds a fork and alternates side by creation order', () => {
    const before = base()
    const one = addBranchAbove(before, 'm2', 'A') // m2 has no branch yet -> left
    const nA = newId(before, one)
    expect(one.tasks.m2.branches[0]).toMatchObject({ child: nA, side: 'left', at: 'above' })
    valid(one)

    const two = addBranchAbove(one, 'm2', 'B') // second -> right
    expect(two.tasks.m2.branches[1].side).toBe('right')
    valid(two)
  })

  it('honours an explicit side and supports at:below', () => {
    const before = base()
    const out = addBranchBelow(before, 'm2', 'A', 'right')
    expect(out.tasks.m2.branches[0]).toMatchObject({ side: 'right', at: 'below' })
    valid(out)
  })

  it('refuses to add a branch below a root node', () => {
    expect(() => addBranchBelow(base(), 'r', 'A')).toThrow()
  })
})

describe('deleteTask — subtree', () => {
  it('removes the task and everything growing from it', () => {
    const out = deleteTask(base(), 'm1', 'subtree')
    expect(ids(out)).toEqual(['r']) // m1, m2, b1, b2 all gone
    expect(out.tasks.r.next).toBeNull()
    valid(out)
  })

  it('removes just a fork subtree, leaving the trunk', () => {
    const out = deleteTask(base(), 'b1', 'subtree')
    expect(ids(out)).toEqual(['m1', 'm2', 'r'])
    expect(out.tasks.m1.branches).toEqual([])
    valid(out)
  })

  it('removes the whole project when its root is deleted', () => {
    const out = deleteTask(base(), 'r', 'subtree')
    expect(out.rootOrder).toEqual([])
    expect(ids(out)).toEqual([])
    valid(out)
  })
})

describe('deleteTask — tip is the same under either mode', () => {
  it('pops a tip', () => {
    for (const mode of ['subtree', 'splice']) {
      const out = deleteTask(base(), 'm2', mode)
      expect(out.tasks.m1.next).toBeNull()
      expect(out.tasks.m2).toBeUndefined()
      valid(out)
    }
  })
})

describe('deleteTask — splice', () => {
  it('reconnects the successor and reattaches forks to it', () => {
    const out = deleteTask(base(), 'm1', 'splice')
    expect(out.tasks.m1).toBeUndefined()
    expect(out.tasks.r.next).toBe('m2') // successor took m1's slot
    expect(out.tasks.m2.branches).toEqual([{ child: 'b1', side: 'left', at: 'above' }])
    valid(out)
  })

  it('reconnects a branch child on its own branch', () => {
    const out = deleteTask(base(), 'b1', 'splice')
    expect(out.tasks.b1).toBeUndefined()
    expect(out.tasks.m1.branches[0].child).toBe('b2')
    valid(out)
  })

  it('deleting a root removes the whole project, even in splice mode', () => {
    const out = deleteTask(base(), 'r', 'splice')
    expect(ids(out)).toEqual([])
    expect(out.rootOrder).toEqual([])
    valid(out)
  })

  it('promotes the first fork when the spliced task has no successor', () => {
    // give m2 (a tip) a fork, then splice m2: the fork is promoted onto the main line
    const withFork = addBranchAbove(base(), 'm2', 'F')
    const f = newId(base(), withFork)
    const out = deleteTask(withFork, 'm2', 'splice')
    expect(out.tasks.m2).toBeUndefined()
    expect(out.tasks.m1.next).toBe(f) // fork promoted to succeed m1
    valid(out)
  })

  it('keeps only the tip-most cursor when a splice merges two cursored lines', () => {
    // p(project) -> r(here) -> t ; t forks to b0(here). Splice t: b0 is promoted onto
    // r's line, which would carry two cursors — the tip-most (b0) survives.
    const raw = {
      schema: 2, domain: 'T', rootOrder: ['p'],
      tasks: {
        p: { id: 'p', title: 'p', kind: 'project', createdAt: 'x', note: null, next: 'r', branches: [] },
        r: { id: 'r', title: 'r', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: true, next: 't', branches: [] },
        t: { id: 't', title: 't', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [{ child: 'b0', side: 'left', at: 'above' }] },
        b0: { id: 'b0', title: 'b0', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: true, next: null, branches: [] },
      },
    }
    valid(raw)
    const out = deleteTask(raw, 't', 'splice')
    expect(out.tasks.r.next).toBe('b0')
    expect(out.tasks.r.here).toBe(false) // cleared
    expect(out.tasks.b0.here).toBe(true) // kept (tip-most)
    valid(out)
  })
})
