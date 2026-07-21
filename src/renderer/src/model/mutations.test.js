// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { validateForest } from './validate.js'
import {
  setTitle, uniqueTitle, setNote, toggleFlag, setStatus, cycleStatus, makeHere, clearHere, addTree, convertKind,
  addTaskAbove, addTaskBelow, addBranchAbove, addBranchBelow, deleteTask, pasteAsTree,
  moveTaskNode, moveSubtree, detachToTree, reorderRoot, moveIntoLine, moveUp, moveDown,
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

describe('cycleStatus', () => {
  it('advances one step and wraps cancelled -> todo', () => {
    let raw = base() // m2 is a todo task
    raw = cycleStatus(raw, 'm2'); expect(raw.tasks.m2.status).toBe('in-progress')
    raw = cycleStatus(raw, 'm2'); expect(raw.tasks.m2.status).toBe('completed')
    expect(raw.tasks.m2.completedAt).not.toBeNull() // completion stamps
    raw = cycleStatus(raw, 'm2'); expect(raw.tasks.m2.status).toBe('cancelled')
    expect(raw.tasks.m2.completedAt).toBeNull() // leaving completed clears
    raw = cycleStatus(raw, 'm2'); expect(raw.tasks.m2.status).toBe('todo') // wraps
    valid(raw)
  })

  it('refuses to cycle a project node', () => {
    expect(() => cycleStatus(base(), 'r')).toThrow()
  })
})

describe('uniqueTitle — unique node titles within a domain', () => {
  it('leaves a free title unchanged', () => {
    expect(uniqueTitle(base(), 'Fresh', null)).toBe('Fresh')
  })

  it('appends -1 on a bare collision and increments from there', () => {
    // base() titles equal ids: r, m1, m2, b1, b2.
    expect(uniqueTitle(base(), 'b1', null)).toBe('b1-1')
    const f = setTitle(base(), 'm2', 'b1') // m2 -> 'b1-1'
    expect(f.tasks.m2.title).toBe('b1-1')
    expect(uniqueTitle(f, 'b1', null)).toBe('b1-2') // 'b1' and 'b1-1' both taken
  })

  it('renumbers from the base, stripping an existing -N rather than stacking', () => {
    const f = setTitle(base(), 'm2', 'b1') // 'b1' taken -> 'b1-1'
    const out = setTitle(f, 'b2', 'b1-1') // 'b1-1' taken; base 'b1' -> 'b1-2'
    expect(out.tasks.b2.title).toBe('b1-2')
    valid(out)
  })

  it('does not count the renamed node itself as a collision', () => {
    const out = setTitle(base(), 'm2', 'm2') // renaming m2 to its own title
    expect(out.tasks.m2.title).toBe('m2')
  })
})

describe('toggleFlag', () => {
  it('toggles a node between flagged and not (defaulting from unset)', () => {
    const on = toggleFlag(base(), 'm2')
    expect(on.tasks.m2.flagged).toBe(true)
    const off = toggleFlag(on, 'm2')
    expect(off.tasks.m2.flagged).toBe(false)
    valid(on); valid(off)
  })

  it('flags a project node too — any node is flaggable', () => {
    const out = toggleFlag(base(), 'r')
    expect(out.tasks.r.flagged).toBe(true)
    valid(out)
  })

  it('survives a kind conversion in both directions', () => {
    const flagged = toggleFlag(base(), 'm2') // task, flagged
    const asProject = convertKind(flagged, 'm2')
    expect(asProject.tasks.m2.flagged).toBe(true)
    const backToTask = convertKind(asProject, 'm2')
    expect(backToTask.tasks.m2.flagged).toBe(true)
    valid(asProject); valid(backToTask)
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

describe('pasteAsTree', () => {
  // A clip mirroring base()'s shape, with one completed task and one carrying a
  // note, so the paste can be checked to keep statuses, clear cursors, and carry
  // notes by content: r(project) -> m1(here) -> m2(completed); fork b1 -> b2(note).
  const clip = () => ({
    rootId: 'r',
    tasks: {
      r:  { id: 'r',  title: 'Proj', kind: 'project', createdAt: 'old', note: null, next: 'm1', branches: [] },
      m1: { id: 'm1', title: 'm1', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: null, here: true, next: 'm2', branches: [{ child: 'b1', side: 'left', at: 'above' }] },
      m2: { id: 'm2', title: 'm2', kind: 'task', status: 'completed', createdAt: 'old', completedAt: '2026-02-02T00:00:00Z', note: null, here: false, next: null, branches: [] },
      b1: { id: 'b1', title: 'b1', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: null, here: false, next: 'b2', branches: [] },
      b2: { id: 'b2', title: 'b2', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: 'b2.md', here: false, next: null, branches: [] },
    },
    notes: { b2: '# b2 note\n' },
  })
  const empty = () => ({ schema: 2, domain: 'T', rootOrder: [], tasks: {} })
  const byTitle = (raw) => Object.fromEntries(Object.values(raw.tasks).map((t) => [t.title, t]))

  it('pastes a copied project as a fresh, valid tree with regenerated ids', () => {
    const { next } = pasteAsTree(empty(), clip())
    expect(Object.keys(next.tasks)).toHaveLength(5)
    // Every id is new (none of the clip's literal ids survive) and the mapped
    // root is appended to rootOrder as a project node.
    expect(['r', 'm1', 'm2', 'b1', 'b2'].some((id) => next.tasks[id])).toBe(false)
    expect(next.rootOrder).toHaveLength(1)
    expect(next.tasks[next.rootOrder[0]].kind).toBe('project')
    valid(next)
  })

  it('keeps statuses, clears here cursors, and stamps a fresh createdAt', () => {
    const { next } = pasteAsTree(empty(), clip())
    const t = byTitle(next)
    expect(t.m2.status).toBe('completed')
    expect(t.m2.completedAt).toBe('2026-02-02T00:00:00Z') // completion travels
    expect(t.m1.here).toBe(false) // cursor cleared on paste
    expect(t.m1.createdAt).not.toBe('old') // re-stamped
  })

  it('rewires edges through the id map', () => {
    const { next } = pasteAsTree(empty(), clip())
    const t = byTitle(next)
    expect(t.Proj.next).toBe(t.m1.id)
    expect(t.m1.next).toBe(t.m2.id)
    expect(t.m1.branches[0].child).toBe(t.b1.id)
    expect(t.b1.next).toBe(t.b2.id)
  })

  it('carries a note by content into a fresh file named for the new id', () => {
    const { next, notes } = pasteAsTree(empty(), clip())
    const t = byTitle(next)
    expect(t.b2.note).toBe(t.b2.id + '.md')
    expect(notes).toEqual([{ file: t.b2.id + '.md', content: '# b2 note\n' }])
  })

  it('does not mutate the clip, so the same copy can be pasted again disjointly', () => {
    const c = clip()
    const first = pasteAsTree(empty(), c)
    expect(c.tasks.m1.here).toBe(true) // clip untouched
    const second = pasteAsTree(first.next, c) // paste again into the result
    expect(second.next.rootOrder).toHaveLength(2)
    expect(Object.keys(second.next.tasks)).toHaveLength(10) // two disjoint trees
    expect(second.next.rootOrder[0]).not.toBe(second.next.rootOrder[1])
    valid(second.next)
  })

  it('suffixes pasted titles that collide with names already in the domain', () => {
    // Paste the clip into a forest that already holds its titles (base(): r, m1,
    // m2, b1, b2), with the root renamed to 'Proj' so the clip root collides too.
    const dest = setTitle(base(), 'r', 'Proj')
    const { next } = pasteAsTree(dest, clip())
    const titles = Object.values(next.tasks).map((t) => t.title)
    expect(titles.filter((t) => t === 'Proj')).toHaveLength(1) // original kept
    expect(titles).toContain('Proj-1') // pasted root suffixed
    expect(titles).toContain('m1-1')
    expect(titles).toContain('b2-1')
    valid(next)
  })
})

describe('moveTaskNode', () => {
  it('grafts a leaf task onto the target and leaves its old slot a tip', () => {
    const out = moveTaskNode(base(), 'm2', 'b1') // m2 is a tip; b1 is on the fork
    expect(out.tasks.m1.next).toBeNull() // m2 left m1 a tip
    expect(out.tasks.b1.branches.map((b) => b.child)).toContain('m2')
    expect(out.tasks.m2.next).toBeNull()
    valid(out)
  })

  it('moves only the node, splicing its children onto its predecessor', () => {
    const out = moveTaskNode(base(), 'm1', 'm2') // m1 has next m2 and fork b1
    expect(out.tasks.r.next).toBe('m2') // m2 took m1's slot under the root
    expect(out.tasks.m2.branches.map((b) => b.child).sort()).toEqual(['b1', 'm1'].sort()) // b1 spliced on, m1 grafted
    expect(out.tasks.m1.next).toBeNull()
    expect(out.tasks.m1.branches).toEqual([])
    valid(out)
  })

  it('carries the "here" cursor with the moved node', () => {
    const out = moveTaskNode(base(), 'm1', 'b2') // m1 is "here"
    expect(out.tasks.m1.here).toBe(true)
    expect(out.tasks.b2.branches.map((b) => b.child)).toContain('m1')
    valid(out)
  })

  it('refuses a project node and a drop onto itself', () => {
    expect(() => moveTaskNode(base(), 'r', 'm2')).toThrow() // r is a project
    expect(() => moveTaskNode(base(), 'm2', 'm2')).toThrow()
  })
})

// A forest with an interior sub-project: r -> a -> SP(project) -> s1 ; a forks to f1.
function withSub() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, branches: [], ...over,
  })
  const p = (id, over = {}) => ({
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, next: null, branches: [], ...over,
  })
  return {
    schema: 2, domain: 'T', rootOrder: ['r'],
    tasks: {
      r: p('r', { next: 'a' }),
      a: t('a', { next: 'SP', branches: [{ child: 'f1', side: 'left', at: 'above' }] }),
      SP: p('SP', { next: 's1' }),
      s1: t('s1'),
      f1: t('f1'),
    },
  }
}

describe('moveSubtree', () => {
  it('grafts a whole subtree onto the target, intact', () => {
    const out = moveSubtree(withSub(), 'SP', 'f1') // move the SP sub-project onto the fork tip
    expect(out.tasks.a.next).toBeNull() // SP left a's main line
    expect(out.tasks.f1.branches.map((b) => b.child)).toContain('SP')
    expect(out.tasks.SP.next).toBe('s1') // subtree intact
    valid(out)
  })

  it('drops a whole tree from rootOrder when grafted as a sub-project', () => {
    // two trees; graft the second root's tree onto a node in the first
    const two = withSub()
    two.tasks.p2 = { id: 'p2', title: 'p2', kind: 'project', createdAt: '2026-01-02T00:00:00Z', note: null, next: 'q2', branches: [] }
    two.tasks.q2 = { id: 'q2', title: 'q2', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] }
    two.rootOrder = ['r', 'p2']
    const out = moveSubtree(two, 'p2', 'a')
    expect(out.rootOrder).toEqual(['r']) // p2 is no longer a root
    expect(out.tasks.a.branches.map((b) => b.child)).toContain('p2')
    expect(out.tasks.p2.next).toBe('q2')
    valid(out)
  })

  it('refuses grafting a subtree onto its own descendant, or onto itself', () => {
    expect(() => moveSubtree(withSub(), 'SP', 's1')).toThrow() // s1 is inside SP
    expect(() => moveSubtree(withSub(), 'SP', 'SP')).toThrow()
  })
})

describe('detachToTree', () => {
  it('turns a sub-project into its own root, carrying its subtree', () => {
    const out = detachToTree(withSub(), 'SP')
    expect(out.tasks.a.next).toBeNull() // SP cut from a's main line
    expect(out.rootOrder).toContain('SP')
    expect(out.tasks.SP.next).toBe('s1') // subtree intact
    valid(out)
  })

  it('refuses a task node and a node that is already a root', () => {
    expect(() => detachToTree(withSub(), 's1')).toThrow() // s1 is a task
    expect(() => detachToTree(withSub(), 'r')).toThrow() // r is already a root
  })
})

describe('reorderRoot', () => {
  // three roots, only some listed in rootOrder (the rest are advisory-appended).
  function threeRoots() {
    const p = (id, createdAt) => ({ id, title: id, kind: 'project', createdAt, note: null, next: null, branches: [] })
    return {
      schema: 2, domain: 'T', rootOrder: ['A', 'B', 'C'],
      tasks: { A: p('A', '2026-01-01T00:00:00Z'), B: p('B', '2026-01-02T00:00:00Z'), C: p('C', '2026-01-03T00:00:00Z') },
    }
  }

  it('moves a root to a new index and clamps out-of-range indices', () => {
    expect(reorderRoot(threeRoots(), 'C', 0).rootOrder).toEqual(['C', 'A', 'B'])
    expect(reorderRoot(threeRoots(), 'A', 99).rootOrder).toEqual(['B', 'C', 'A'])
  })

  it('canonicalises an incomplete rootOrder to the full root set first', () => {
    const raw = threeRoots()
    raw.rootOrder = ['B'] // A and C are roots too, but unlisted (ordered by createdAt: A before C)
    expect(reorderRoot(raw, 'C', 0).rootOrder).toEqual(['C', 'B', 'A'])
  })

  it('refuses a non-root node', () => {
    expect(() => reorderRoot(withSub(), 'a', 0)).toThrow()
  })
})

// A straight branchless line: project root r -> a -> b -> c -> d.
function line4() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: 'x', completedAt: null,
    note: null, here: false, next: null, branches: [], ...over,
  })
  return {
    schema: 2, domain: 'T', rootOrder: ['r'],
    tasks: {
      r: { id: 'r', title: 'r', kind: 'project', createdAt: 'x', note: null, next: 'a', branches: [] },
      a: t('a', { next: 'b' }), b: t('b', { next: 'c' }), c: t('c', { next: 'd' }), d: t('d'),
    },
  }
}
const chain = (raw) => { const out = []; let id = raw.tasks.r.next; while (id) { out.push(id); id = raw.tasks[id].next }; return out }

describe('moveIntoLine', () => {
  it('reorders a task into a gap higher on its line', () => {
    const out = moveIntoLine(line4(), 'b', 'c') // insert b between c and d
    expect(chain(out)).toEqual(['a', 'c', 'b', 'd'])
    valid(out)
  })

  it('reorders a task into a gap lower on its line', () => {
    const out = moveIntoLine(line4(), 'd', 'a') // insert d between a and b
    expect(chain(out)).toEqual(['a', 'd', 'b', 'c'])
    valid(out)
  })

  it('moving a task alone leaves its own branches behind on the line', () => {
    const out = moveIntoLine(base(), 'm1', 'm2') // m1 has fork b1; insert m1 above m2 (tip)
    expect(out.tasks.r.next).toBe('m2') // m1 spliced out; its branch b1 stayed with the line
    expect(out.tasks.m2.branches.map((x) => x.child)).toContain('b1')
    expect(out.tasks.m2.next).toBe('m1') // m1 reinserted above m2
    expect(out.tasks.m1.branches).toEqual([]) // travelled alone
    valid(out)
  })

  it('splices a whole sub-project into a line, its tip continuing the line', () => {
    const out = moveIntoLine(withSub(), 'SP', 'f1') // SP(project)->s1 grafted above the fork tip f1
    expect(out.tasks.a.next).toBeNull() // SP left a's main line
    expect(out.tasks.f1.next).toBe('SP')
    expect(out.tasks.SP.next).toBe('s1') // subtree intact, tip continues (f1 had no successor)
    valid(out)
  })

  it('refuses inserting a subtree into its own line, or above itself', () => {
    expect(() => moveIntoLine(withSub(), 'SP', 's1')).toThrow()
    expect(() => moveIntoLine(line4(), 'b', 'b')).toThrow()
  })
})

describe('moveUp / moveDown', () => {
  it('moves a task one step toward the tip', () => {
    expect(chain(moveUp(line4(), 'b'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves a task one step toward the root', () => {
    expect(chain(moveDown(line4(), 'c'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('keeps the swapped node\'s branches and cursor', () => {
    const out = moveUp(base(), 'm1') // m1 is "here" and forks to b1; swap with m2
    expect(out.tasks.r.next).toBe('m2')
    expect(out.tasks.m2.next).toBe('m1')
    expect(out.tasks.m1.branches.map((x) => x.child)).toContain('b1') // branch preserved
    expect(out.tasks.m1.here).toBe(true) // cursor preserved
    valid(out)
  })

  it('refuses moving the tip up, a root up, or below the root', () => {
    expect(() => moveUp(base(), 'm2')).toThrow() // m2 is the tip
    expect(() => moveUp(base(), 'r')).toThrow() // r is the root
    expect(() => moveDown(base(), 'm1')).toThrow() // m1 sits right above the root
    expect(() => moveDown(base(), 'b1')).toThrow() // b1 is a branch line's start
  })
})
