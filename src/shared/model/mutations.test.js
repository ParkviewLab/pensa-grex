// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { validateRecord, pairScopes, trunksOf } from './validate.js'
import {
  setTitle, uniqueTitle, setNote, toggleFlag, setStatus, cycleStatus, makeHere, clearHere, addTree, convertKind,
  addTaskAbove, addTaskBelow, addBranchAbove, addBranchBelow, openBranch, setMergePoint, deleteTask, pasteAsTree,
  moveTaskNode, moveSubtree, detachToTree, reorderRoot, moveIntoLine, moveUp, moveDown,
  wrapRun, unwrapProject, clipNodes, wrapCandidates,
} from './mutations.js'

// A small valid record: project root r -> m1(here) -> m2 -> z, with a fork b1 -> b2
// off m1.
//
// Termini: z is the terminus that closes r, and every project node must have one
// above it on its own trunk, so the plan's trunk now ends at z rather than at m2.
// Since r is a root, z is the PLAN's close: nothing may sit above it (its .next is
// null and it holds no branch).
//
// Returns: every branch rejoins the trunk it left, so the fork carries a merge point,
// stored on b2, the top of its own trunk, because that is the end the return line
// leaves from. It names m1, the branch's own edge, which is the smallest legal branch
// and what opening a branch creates. m2 is the highest legal alternative, since z closes
// the plan and no edge rises from it; the tests that want a span wider than one edge
// ask for it with setMergePoint.
function base() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
  })
  const p = (id, over = {}) => ({
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  // Termini: a close says nothing of its own — no title, no status, no flag, no
  // "here" — and keeps only a note, so the builder offers only what the node has.
  const terminus = (id, over = {}) => ({
    id, kind: 'terminus', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  return {
    schemaVersion: 3,
    id: 'd_test000000',
    title: 'T',
    planOrder: ['r'],
    nodes: {
      r: p('r', { next: 'm1' }),
      m1: t('m1', { here: true, next: 'm2', leftBranches: ['b1'] }),
      m2: t('m2', { next: 'z' }),
      z: terminus('z'),
      b1: t('b1', { next: 'b2' }),
      b2: t('b2', { mergePoint: 'm1' }),
    },
  }
}

const valid = (record) => expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
const ids = (record) => Object.keys(record.nodes).sort()
const newId = (before, after) => ids(after).find((id) => !before.nodes[id])
const created = (before, after) => ids(after).filter((id) => !before.nodes[id])

// A record node's forks live in two ordered arrays of child ids (each naming the
// edge that RISES from the node holding it), so this reads them back as the flat
// left-then-right list of { child, side } the assertions below speak in terms of.
const forks = (node) => [
  ...(node.leftBranches || []).map((child) => ({ child, side: 'left' })),
  ...(node.rightBranches || []).map((child) => ({ child, side: 'right' })),
]

describe('setTitle / setStatus', () => {
  it('renames without touching anything else', () => {
    const out = setTitle(base(), 'm2', 'Renamed')
    expect(out.nodes.m2.title).toBe('Renamed')
    valid(out)
  })

  it('records and clears a note filename', () => {
    const withNote = setNote(base(), 'm2', 'm2.md')
    expect(withNote.nodes.m2.note).toBe('m2.md')
    valid(withNote)
    const cleared = setNote(withNote, 'm2', null)
    expect(cleared.nodes.m2.note).toBeNull()
    valid(cleared)
  })

  it('stamps completedAt on completion and clears it on leaving completed', () => {
    const done = setStatus(base(), 'm2', 'completed')
    expect(done.nodes.m2.status).toBe('completed')
    expect(done.nodes.m2.completedAt).toBeTruthy()
    valid(done)
    const undone = setStatus(done, 'm2', 'in-progress')
    expect(undone.nodes.m2.completedAt).toBeNull()
    valid(undone)
  })

  it('rejects an invalid status and never mutates the input', () => {
    const input = base()
    expect(() => setStatus(input, 'm2', 'bogus')).toThrow()
    expect(input.nodes.m2.status).toBe('todo')
  })

  it('refuses to set a status on a project node', () => {
    expect(() => setStatus(base(), 'r', 'todo')).toThrow()
    // Termini: only a task has a status, and a close is not a task.
    expect(() => setStatus(base(), 'z', 'todo')).toThrow()
  })

  it('refuses to title a terminus', () => {
    // Termini: a close carries no title, so it cannot be searched for by name; its
    // paired project node is the scope's handle.
    expect(() => setTitle(base(), 'z', 'Named')).toThrow()
  })

  it('records a note on a terminus, the one thing a close says', () => {
    // Termini: a note is a terminus's only expressive field — what closing the
    // scope took — so setNote must reach it like any other node.
    const out = setNote(base(), 'z', 'z.md')
    expect(out.nodes.z.note).toBe('z.md')
    valid(out)
  })
})

describe('cycleStatus', () => {
  it('advances one step and wraps cancelled -> todo', () => {
    let record = base() // m2 is a todo task
    record = cycleStatus(record, 'm2'); expect(record.nodes.m2.status).toBe('in-progress')
    record = cycleStatus(record, 'm2'); expect(record.nodes.m2.status).toBe('completed')
    expect(record.nodes.m2.completedAt).not.toBeNull() // completion stamps
    record = cycleStatus(record, 'm2'); expect(record.nodes.m2.status).toBe('cancelled')
    expect(record.nodes.m2.completedAt).toBeNull() // leaving completed clears
    record = cycleStatus(record, 'm2'); expect(record.nodes.m2.status).toBe('todo') // wraps
    valid(record)
  })

  it('refuses to cycle a project node', () => {
    expect(() => cycleStatus(base(), 'r')).toThrow()
    // Termini: nor a close, which has no status to cycle.
    expect(() => cycleStatus(base(), 'z')).toThrow()
  })
})

describe('uniqueTitle — unique node titles within a domain', () => {
  it('leaves a free title unchanged', () => {
    expect(uniqueTitle(base(), 'Fresh', null)).toBe('Fresh')
  })

  it('appends -1 on a bare collision and increments from there', () => {
    // base() titles equal ids: r, m1, m2, b1, b2 (the terminus z has no title).
    expect(uniqueTitle(base(), 'b1', null)).toBe('b1-1')
    const f = setTitle(base(), 'm2', 'b1') // m2 -> 'b1-1'
    expect(f.nodes.m2.title).toBe('b1-1')
    expect(uniqueTitle(f, 'b1', null)).toBe('b1-2') // 'b1' and 'b1-1' both taken
  })

  it('renumbers from the base, stripping an existing -N rather than stacking', () => {
    const f = setTitle(base(), 'm2', 'b1') // 'b1' taken -> 'b1-1'
    const out = setTitle(f, 'b2', 'b1-1') // 'b1-1' taken; base 'b1' -> 'b1-2'
    expect(out.nodes.b2.title).toBe('b1-2')
    valid(out)
  })

  it('does not count the renamed node itself as a collision', () => {
    const out = setTitle(base(), 'm2', 'm2') // renaming m2 to its own title
    expect(out.nodes.m2.title).toBe('m2')
  })
})

describe('toggleFlag', () => {
  it('toggles a node between flagged and not (defaulting from unset)', () => {
    const on = toggleFlag(base(), 'm2')
    expect(on.nodes.m2.flagged).toBe(true)
    const off = toggleFlag(on, 'm2')
    expect(off.nodes.m2.flagged).toBe(false)
    valid(on); valid(off)
  })

  it('flags a project node too, but refuses a terminus', () => {
    // Termini: "any node is flaggable" no longer holds. A project node still is,
    // exactly as a task is; a close is not, since a flag query must not sweep one
    // up — its paired project node is the scope's handle.
    const out = toggleFlag(base(), 'r')
    expect(out.nodes.r.flagged).toBe(true)
    valid(out)
    expect(() => toggleFlag(base(), 'z')).toThrow()
  })

  it('survives a kind conversion in both directions', () => {
    const flagged = toggleFlag(base(), 'm2') // task, flagged
    const asProject = convertKind(flagged, 'm2')
    expect(asProject.nodes.m2.flagged).toBe(true)
    const backToTask = convertKind(asProject, 'm2')
    expect(backToTask.nodes.m2.flagged).toBe(true)
    valid(asProject); valid(backToTask)
  })
})

describe('convertKind', () => {
  it('turns a task into a project node, discarding status and cursor', () => {
    const before = base()
    const out = convertKind(before, 'm1') // m1 is a task, and is "here"
    expect(out.nodes.m1.kind).toBe('project')
    expect(out.nodes.m1.status).toBeUndefined()
    expect(out.nodes.m1.here).toBeUndefined()
    expect(out.nodes.m1.next).toBe('m2') // keeps its edges and children
    // Termini: a project has a scope, so the conversion opens one and mints a close
    // for it. The new scope gets the extent schema 2 always meant — everything
    // above m1 on its trunk, here m2 — and since closes stack in reverse order of
    // opening, the trunk reads r, m1(project), m2, z (now closing m1), then the
    // fresh close on top for the plan itself. Which physical terminus closes which
    // scope is read back through pairScopes, since a close carries no identity of
    // its own beyond its note.
    const close = newId(before, out)
    expect(out.nodes[close].kind).toBe('terminus')
    const { pairs } = pairScopes(out, trunksOf(out))
    expect(pairs.get('m1')).toBe('z') // the new scope covers m2, and no more
    expect(pairs.get('r')).toBe(close)
    expect(out.nodes.z.next).toBe(close)
    expect(out.nodes[close].next).toBeNull() // the plan still ends at its close
    valid(out)
  })

  it('turns a project node back into a task, resetting to todo (lossy round-trip)', () => {
    const toProject = convertKind(base(), 'm2')
    const back = convertKind(toProject, 'm2')
    expect(back.nodes.m2.kind).toBe('task')
    expect(back.nodes.m2.status).toBe('todo')
    // Termini: giving up the project gives up its close, so the round-trip returns
    // to a record of the same size with the plan closed exactly once. It counts
    // nodes and re-derives the pairing rather than naming ids, because the pair is
    // anonymous: the terminus that survives is whichever one the bracket-matching
    // left holding the plan's scope.
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(base().nodes).length)
    const { pairs } = pairScopes(back, trunksOf(back))
    expect(pairs.size).toBe(1)
    expect(back.nodes[pairs.get('r')].kind).toBe('terminus')
    expect(back.nodes.m2.next).toBe(pairs.get('r')) // the close still tops the trunk
    valid(back)
  })

  it('refuses to change the kind of a root node', () => {
    expect(() => convertKind(base(), 'r')).toThrow()
  })

  it('refuses to change the kind of a terminus', () => {
    // Termini: a close is one half of a pair, not an independent node; the way to
    // be rid of it is to unwrap its project.
    expect(() => convertKind(base(), 'z')).toThrow()
  })

  it('refuses a conversion whose new scope would straddle a branch span', () => {
    // A node becoming a project takes the trunk above it as its scope, so a scope
    // around m2 would open between the fork's branch point and its merge point and
    // close above it. The return would then land inside a scope the branch was opened
    // outside, which is what collapsing that scope could not survive, and the refusal
    // names the two legal merges rather than moving a return unasked.
    const wide = setMergePoint(base(), 'b1', 'm2')
    expect(() => convertKind(wide, 'm2'))
      .toThrow(/this node cannot become a sub-project: .*merge below where "m2" opens, or above where it closes/)
    // The same conversion one node lower is legal, since that scope contains the span
    // rather than cutting into it.
    valid(convertKind(wide, 'm1'))
  })
})

describe('makeHere / clearHere', () => {
  it('moves the cursor within a line, clearing the previous one', () => {
    const out = makeHere(base(), 'm2')
    expect(out.nodes.m1.here).toBe(false)
    expect(out.nodes.m2.here).toBe(true)
    valid(out)
  })

  it('allows a second cursor on a different line (fork)', () => {
    const out = makeHere(base(), 'b2')
    expect(out.nodes.m1.here).toBe(true) // main-line cursor untouched
    expect(out.nodes.b2.here).toBe(true)
    valid(out)
  })

  it('clears a line cursor', () => {
    const out = clearHere(base(), 'm1')
    expect(out.nodes.m1.here).toBe(false)
    valid(out)
  })

  it('refuses to set "here" on a project node', () => {
    expect(() => makeHere(base(), 'r')).toThrow()
    // Termini: nor on a close — only a task can hold the cursor.
    expect(() => makeHere(base(), 'z')).toThrow()
  })
})

describe('addTree', () => {
  it('starts a new project with its own project-node root, and works from an empty record', () => {
    const empty = { schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: [], nodes: {} }
    const out = addTree(empty, 'Fresh')
    expect(out.planOrder).toHaveLength(1)
    const rootId = out.planOrder[0]
    expect(out.nodes[rootId].title).toBe('Fresh')
    expect(out.nodes[rootId].kind).toBe('project')
    // Termini: a plan is bounded, so beginning one mints TWO nodes — the base and
    // the close directly above it. That empty plan is a legal resting state.
    expect(Object.keys(out.nodes)).toHaveLength(2)
    const closeId = out.nodes[rootId].next
    expect(out.nodes[closeId].kind).toBe('terminus')
    expect(out.nodes[closeId].next).toBeNull()
    valid(out)
  })

  it('makes a colliding tree name unique', () => {
    const out = addTree(base(), 'm2') // base() already has a node titled 'm2'
    const rootId = out.planOrder[out.planOrder.length - 1]
    expect(out.nodes[rootId].title).toBe('m2-1')
    valid(out)
  })
})

describe('addTask', () => {
  it('above inserts a successor and inherits the old one', () => {
    const before = base()
    const out = addTaskAbove(before, 'm1', 'N')
    const n = newId(before, out)
    expect(out.nodes.m1.next).toBe(n)
    expect(out.nodes[n].next).toBe('m2')
    valid(out)
  })

  it('below inserts under the predecessor', () => {
    const before = base()
    const out = addTaskBelow(before, 'm1', 'N')
    const n = newId(before, out)
    expect(out.nodes.r.next).toBe(n)
    expect(out.nodes[n].next).toBe('m1')
    valid(out)
  })

  it('refuses to add a task below a root node', () => {
    expect(() => addTaskBelow(base(), 'r', 'N')).toThrow()
  })

  it('above the top task inserts into the edge below the plan\'s close', () => {
    // Termini: the highest edge inside a plan is the one rising from its top task
    // into its close, so a task added there lands under z, not above it.
    const before = base()
    const out = addTaskAbove(before, 'm2', 'N')
    const n = newId(before, out)
    expect(out.nodes.m2.next).toBe(n)
    expect(out.nodes[n].next).toBe('z')
    valid(out)
  })

  it('refuses to add a task above a plan\'s closing terminus', () => {
    // Termini: a plan ends at its close, so there is no edge above it to insert into.
    expect(() => addTaskAbove(base(), 'z', 'N')).toThrow()
  })

  it('below a branch child stays on that branch', () => {
    const before = base()
    const out = addTaskBelow(before, 'b1', 'N')
    const n = newId(before, out)
    expect(out.nodes.m1.leftBranches[0]).toBe(n) // the fork now starts at the new task
    expect(out.nodes[n].next).toBe('b1')
    valid(out)
  })

  it('makes a colliding created title unique', () => {
    const before = base() // titles r, m1, m2, b1, b2
    const out = addTaskAbove(before, 'm1', 'b1')
    const n = newId(before, out)
    expect(out.nodes[n].title).toBe('b1-1')
    valid(out)
  })

  it('uniquifies even the default placeholder, so two unnamed tasks differ', () => {
    const before = base()
    const one = addTaskAbove(before, 'm1') // no title -> 'New task'
    const nOne = newId(before, one)
    expect(one.nodes[nOne].title).toBe('New task')
    const two = addTaskAbove(one, 'm1') // -> 'New task-1'
    const nTwo = newId(one, two)
    expect(two.nodes[nTwo].title).toBe('New task-1')
    valid(two)
  })
})

describe('addBranch', () => {
  it('adds a fork and alternates side by creation order', () => {
    const before = base()
    const one = addBranchAbove(before, 'm2', 'A') // m2 has no branch yet -> left
    const nA = newId(before, one)
    // Schema 3: there is no `at` to assert any more — an array names the edge
    // that rises from its holder, so a fork above m2 is simply an entry in one of
    // m2's own arrays, and which array it is *is* the side.
    expect(one.nodes.m2.leftBranches).toEqual([nA])
    expect(one.nodes.m2.rightBranches).toEqual([])
    valid(one)

    const two = addBranchAbove(one, 'm2', 'B') // second -> right
    const nB = newId(one, two)
    expect(two.nodes.m2.rightBranches).toEqual([nB])
    valid(two)
  })

  it('honours an explicit side, and a fork below a node lands on its predecessor', () => {
    // Schema 3: a below-fork has no separate storage. The gap below m2 is the
    // edge that rises from m2's main-line predecessor (m1), so the fork is held
    // there — the old assertion's `at: 'below'` becomes "on m1, not on m2".
    const before = base()
    const out = addBranchBelow(before, 'm2', 'A', 'right')
    const n = newId(before, out)
    expect(out.nodes.m1.rightBranches).toEqual([n]) // explicit side honoured
    expect(forks(out.nodes.m2)).toEqual([]) // nothing stored on m2 itself
    valid(out)
  })

  it('refuses to add a branch below a root node', () => {
    expect(() => addBranchBelow(base(), 'r', 'A')).toThrow()
  })

  it('refuses to add a branch below the first node of a branch', () => {
    // Schema 3: b1 has no main-line predecessor, so the gap below it is not an
    // edge any array can name; the mutation refuses rather than inventing one.
    expect(() => addBranchBelow(base(), 'b1', 'A')).toThrow()
  })

  it('makes a colliding branch title unique', () => {
    const before = base()
    const out = addBranchAbove(before, 'm2', 'b1') // 'b1' already exists
    const n = newId(before, out)
    expect(out.nodes[n].title).toBe('b1-1')
    valid(out)
  })
})

describe('openBranch', () => {
  it('creates the attachment, one task inside it, and its return line', () => {
    const before = base()
    const out = openBranch(before, 'm2', 'A')
    const n = newId(before, out)
    expect(out.nodes.m2.leftBranches).toEqual([n]) // the attachment names the edge above m2
    expect(out.nodes[n].kind).toBe('task') // never empty: a branch carries no title, so an empty one asserts nothing
    expect(out.nodes[n].mergePoint).toBe('m2') // the return, on the edge the branch left
    valid(out)
  })

  it('defaults to the smallest legal branch, a bubble on its own edge', () => {
    // A bubble says that this strand runs alongside that one gap and nothing else. It
    // is a diamond rather than a loop, since branch and trunk both flow into the node
    // above the shared edge, and it is what keeps the topmost forkable edge forkable.
    const out = openBranch(base(), 'm2', 'A')
    const n = newId(base(), out)
    expect(out.nodes[n].mergePoint).toBe('m2')
    expect(out.nodes.m2.next).toBe('z') // the edge the branch leaves and rejoins
    valid(out)
  })

  it('lands a new branch innermost, nearest the spine', () => {
    // A side array is ordered innermost first, and that order is the author's. A new
    // branch goes to the front because its span is a single edge, which nests inside
    // every span containing that edge and so costs no crossings there.
    const one = openBranch(base(), 'm2', 'A', 'left')
    const first = newId(base(), one)
    const two = openBranch(one, 'm2', 'B', 'left')
    const second = newId(one, two)
    expect(two.nodes.m2.leftBranches).toEqual([second, first])
    valid(two)
  })

  it('refuses a plan\'s closing terminus, which has no edge above it to leave', () => {
    expect(() => openBranch(base(), 'z', 'A')).toThrow(/no edge above it/)
  })

  it('refuses the top of a branch trunk, whose only line above is its own return', () => {
    // One rule of availability: a node hosts a branch, or receives a merge, exactly
    // when a trunk edge rises from it. A tip's return line is not a trunk edge, so a
    // branch opened there would have nowhere legal to rejoin.
    expect(() => openBranch(base(), 'b2', 'A')).toThrow(/nothing rises from "b2"/)
  })

  it('is what the menu\'s "add branch above" and "add branch below" both do', () => {
    // Above names the edge rising from the node clicked; below names the one rising
    // from its main-line predecessor. Each opens a bubble on the edge it named.
    const above = addBranchAbove(base(), 'm2', 'A')
    expect(above.nodes[newId(base(), above)].mergePoint).toBe('m2')
    const below = addBranchBelow(base(), 'm2', 'A', 'right')
    expect(below.nodes[newId(base(), below)].mergePoint).toBe('m1')
    valid(above); valid(below)
  })
})

describe('setMergePoint', () => {
  it('moves the return line to a higher edge on the trunk the branch left', () => {
    const out = setMergePoint(base(), 'b1', 'm2')
    expect(out.nodes.b2.mergePoint).toBe('m2') // stored on the tip, where the return leaves
    expect(out.nodes.b1.mergePoint).toBeUndefined() // the foot holds none; the return leaves the top
    valid(out)
  })

  it('refuses an edge that does not exist, and a target below the branch point', () => {
    // z closes the plan, so no edge rises from it for a return to join; r sits below
    // the branch point, so a return landing there would flow back down into the trunk
    // the branch had just left.
    expect(() => setMergePoint(base(), 'b1', 'z')).toThrow(/no edge above it/)
    expect(() => setMergePoint(base(), 'b1', 'r')).toThrow(/loop rather than a return/)
  })

  it('refuses a straddle, naming both legal alternatives', () => {
    // nested() runs r -> a -> SP -> s1 -> zs -> zr, and the branch is opened on the
    // edge above a, outside SP. Rejoining at s1 would put the return inside a scope the
    // branch was opened outside, and a return has nowhere to land once that scope is
    // collapsed, so the move is refused rather than drawn.
    const withBranch = openBranch(nested(), 'a', 'B')
    const foot = newId(nested(), withBranch)
    expect(() => setMergePoint(withBranch, foot, 's1'))
      .toThrow(/merge below where "SP" opens, or above where it closes/)
    // The alternative it names is real: the edge above zs is outside SP, so the span
    // contains the whole sub-project instead of cutting into it.
    const out = setMergePoint(withBranch, foot, 'zs')
    expect(out.nodes[foot].mergePoint).toBe('zs')
    valid(out)
  })

  it('refuses a node that is not the foot of a branch', () => {
    // A branch is named by its foot, the entry a side array holds. b2 is its tip, which
    // is where the merge point is stored but not what names the branch, and m2 is on
    // the trunk the branch left.
    expect(() => setMergePoint(base(), 'b2', 'm2')).toThrow(/not the foot of a branch/)
    expect(() => setMergePoint(base(), 'm2', 'm2')).toThrow(/not the foot of a branch/)
  })
})

// Every structural edit ends by putting each return line back on the top of its own
// branch, since that is where it is stored and an edit can move the top. A span the
// author chose therefore survives the edits around it, and is only shortened where the
// edge it named has gone.
describe('returns: where a structural edit leaves a merge point', () => {
  // A span wider than base()'s bubble, so a relocation has something to show: the fork
  // off m1 rejoins at the edge above m2, the highest legal merge on that trunk.
  const wide = () => setMergePoint(base(), 'b1', 'm2')

  it('carries the return up to the new tip when a task is inserted above it', () => {
    const before = wide()
    const out = addTaskAbove(before, 'b2', 'N')
    const n = newId(before, out)
    expect(out.nodes[n].mergePoint).toBe('m2') // the claim travels as the branch grows
    expect(out.nodes.b2.mergePoint).toBeNull() // and only the tip holds one
    valid(out)
  })

  it('carries the return to the new close when a whole branch is wrapped', () => {
    const before = wide()
    const out = wrapRun(before, 'b1', 'b2', 'Phase')
    const closeId = created(before, out).find((id) => out.nodes[id].kind === 'terminus')
    expect(out.nodes[closeId].mergePoint).toBe('m2') // the close is the branch's top now
    expect(out.nodes.b2.mergePoint).toBeNull()
    valid(out)
  })

  it('keeps the branch\'s claim when its tip is deleted', () => {
    // The stored value dies with b2, so it is recovered from the record as it was
    // rather than snapped back to a bubble: deleting a node the author never named is
    // no reason to shorten the span they chose.
    const out = deleteTask(wide(), 'b2', 'subtree')
    expect(out.nodes.b1.mergePoint).toBe('m2')
    valid(out)
  })

  it('clamps a branch to its own edge when the node its return named is deleted', () => {
    // Clamping is the only answer available where the named edge has gone with m2, and
    // the smallest legal branch is the one every branch begins as.
    const out = deleteTask(wide(), 'm2', 'subtree')
    expect(out.nodes.b2.mergePoint).toBe('m1') // the branch's own edge, a bubble
    expect(out.nodes.m1.next).toBe('z') // the plan's close was spared and re-stacked
    valid(out)
  })

  it('gives the return up when a branch is detached into a plan of its own', () => {
    // A plan left no trunk, so it has nothing to rejoin. b1 is made a project node
    // first, since only a project node can be a root, and that puts a close at the top
    // of the branch and the return on that close.
    const asProject = convertKind(base(), 'b1')
    const closeId = newId(base(), asProject)
    expect(asProject.nodes[closeId].mergePoint).toBe('m1') // carried up to the new top
    const out = detachToTree(asProject, 'b1')
    expect(out.nodes[closeId].mergePoint).toBeNull()
    expect(out.planOrder).toContain('b1')
    expect(forks(out.nodes.m1)).toEqual([]) // m1 no longer holds the branch
    valid(out)
  })

  it('gives a grafted subtree the smallest legal branch, its own edge', () => {
    // A subtree arriving from elsewhere has never had a return. Grafting a whole plan
    // onto a trunk task makes it a branch, and it rejoins the edge it now leaves.
    const two = base()
    two.nodes.p2 = { id: 'p2', title: 'p2', kind: 'project', createdAt: 'x', note: null, next: 'q2', leftBranches: [], rightBranches: [] }
    two.nodes.q2 = { id: 'q2', title: 'q2', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'z2', leftBranches: [], rightBranches: [] }
    two.nodes.z2 = { id: 'z2', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] }
    two.planOrder = ['r', 'p2']
    valid(two)
    const out = moveSubtree(two, 'p2', 'm2')
    expect(out.nodes.z2.mergePoint).toBe('m2') // a bubble on the edge above m2
    expect(out.planOrder).toEqual(['r']) // p2 is a branch now, not a plan
    valid(out)
  })
})

// Termini: a nested scope on one trunk, the shape the grammar makes of
// "P1, a, P2, b, T2, T1" — r(project) -> a -> SP(project) -> s1 -> zs(closes SP)
// -> zr(closes r). Closes stack in reverse order of opening.
function nested() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
  })
  const p = (id, over = {}) => ({
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  const terminus = (id, over = {}) => ({
    id, kind: 'terminus', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  return {
    schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['r'],
    nodes: {
      r: p('r', { next: 'a' }),
      a: t('a', { next: 'SP' }),
      SP: p('SP', { next: 's1' }),
      s1: t('s1', { next: 'zs' }),
      zs: terminus('zs', { next: 'zr' }),
      zr: terminus('zr'),
    },
  }
}

describe('deleteTask — subtree', () => {
  it('removes the task and everything growing from it', () => {
    const out = deleteTask(base(), 'm1', 'subtree')
    // Termini: m1, m2, b1 and b2 all go, but the plan's close is above m1 and its
    // project (the root r) survives, so the close is spared and re-stacked on r —
    // the plan is emptied, not left unclosed.
    expect(ids(out)).toEqual(['r', 'z'])
    expect(out.nodes.r.next).toBe('z')
    for (const id of ['m1', 'm2', 'b1', 'b2']) expect(out.nodes[id]).toBeUndefined()
    valid(out)
  })

  it('spares a doomed terminus with its note intact', () => {
    // Termini: a spared close is MOVED, not re-minted, because it carries a note —
    // the record of what closing the scope took.
    const withNote = setNote(base(), 'z', 'z.md')
    const out = deleteTask(withNote, 'm1', 'subtree')
    expect(out.nodes.z.note).toBe('z.md')
    expect(out.nodes.r.next).toBe('z')
    valid(out)
  })

  it('re-stacks several spared closes in trunk order, innermost first', () => {
    // Termini: deleting s1 dooms both closes above it, and both scopes survive, so
    // both are spared and re-stacked above s1's predecessor in trunk order: SP's
    // close still closes before the plan's.
    const out = deleteTask(nested(), 's1', 'subtree')
    expect(out.nodes.s1).toBeUndefined()
    expect(out.nodes.SP.next).toBe('zs')
    expect(out.nodes.zs.next).toBe('zr')
    expect(out.nodes.zr.next).toBeNull()
    valid(out)
  })

  it('drops the close of a scope that dies with the deleted subtree', () => {
    // Termini: SP goes with the deleted node, so its close has nothing to close and
    // goes too; only the plan's own close is spared.
    const out = deleteTask(nested(), 'a', 'subtree')
    expect(ids(out)).toEqual(['r', 'zr'])
    expect(out.nodes.r.next).toBe('zr')
    valid(out)
  })

  it('removes just a fork subtree, leaving the trunk', () => {
    const out = deleteTask(base(), 'b1', 'subtree')
    expect(ids(out)).toEqual(['m1', 'm2', 'r', 'z'])
    expect(forks(out.nodes.m1)).toEqual([])
    valid(out)
  })

  it('removes the whole project when its root is deleted', () => {
    const out = deleteTask(base(), 'r', 'subtree')
    expect(out.planOrder).toEqual([])
    expect(ids(out)).toEqual([])
    valid(out)
  })
})

describe('deleteTask — tip is the same under either mode', () => {
  it('pops a tip', () => {
    for (const mode of ['subtree', 'splice']) {
      const fork = deleteTask(base(), 'b2', mode)
      expect(fork.nodes.b1.next).toBeNull()
      expect(fork.nodes.b2).toBeUndefined()
      valid(fork)
      // Termini: m2 is the top TASK but no longer the top of its trunk — the plan's
      // close sits above it. Subtree mode spares that close and splice mode
      // reconnects it, so the two modes still agree.
      const out = deleteTask(base(), 'm2', mode)
      expect(out.nodes.m1.next).toBe('z')
      expect(out.nodes.m2).toBeUndefined()
      valid(out)
    }
  })
})

describe('deleteTask — splice', () => {
  it('reconnects the successor and reattaches forks to it', () => {
    const out = deleteTask(base(), 'm1', 'splice')
    expect(out.nodes.m1).toBeUndefined()
    expect(out.nodes.r.next).toBe('m2') // successor took m1's slot
    expect(forks(out.nodes.m2)).toEqual([{ child: 'b1', side: 'left' }])
    valid(out)
  })

  it('reconnects a branch child on its own branch', () => {
    const out = deleteTask(base(), 'b1', 'splice')
    expect(out.nodes.b1).toBeUndefined()
    expect(out.nodes.m1.leftBranches[0]).toBe('b2')
    valid(out)
  })

  it('deleting a root removes the whole project, even in splice mode', () => {
    const out = deleteTask(base(), 'r', 'splice')
    expect(ids(out)).toEqual([])
    expect(out.planOrder).toEqual([])
    valid(out)
  })

  it('promotes the first fork when the spliced task has no successor', () => {
    // Termini: no task on a plan's trunk lacks a successor any more (its close is
    // always above it), so the successorless node is the fork tip b2: give b2 a
    // fork, then splice b2 and the fork is promoted onto b1's line.
    //
    // Returns: that fork can no longer be put there by any mutation. A successorless
    // node is either a branch's tip or a plan's close, and neither has a trunk edge
    // above it to hold a fork, so openBranch and every graft refuse it and no valid
    // record contains the shape. The path survives in deleteTask, so the shape is
    // staged by hand instead, invalid as it is, and the splice is shown to leave a
    // legal return behind it: the promoted fork becomes the branch's tip, and the
    // return it inherited, naming the departed b2, is clamped to the branch's own edge.
    const withFork = base()
    withFork.nodes.b2.leftBranches = ['F']
    withFork.nodes.F = {
      id: 'F', title: 'F', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null,
      note: null, here: false, next: null, mergePoint: 'b2', leftBranches: [], rightBranches: [],
    }
    const out = deleteTask(withFork, 'b2', 'splice')
    expect(out.nodes.b2).toBeUndefined()
    expect(out.nodes.b1.next).toBe('F') // fork promoted to succeed b1
    expect(out.nodes.F.mergePoint).toBe('m1') // clamped: the edge it named went with b2
    valid(out)
  })

})

describe('wrapRun / unwrapProject', () => {
  it('names a run of a trunk as a project, bracketing it', () => {
    // Termini: the run m1..m2 gets a project node below m1 and a close above m2,
    // and that close continues onto what was above the run (the plan's own close).
    const before = base()
    const out = wrapRun(before, 'm1', 'm2', 'Phase')
    const [openId, closeId] = [
      created(before, out).find((id) => out.nodes[id].kind === 'project'),
      created(before, out).find((id) => out.nodes[id].kind === 'terminus'),
    ]
    expect(out.nodes[openId].title).toBe('Phase')
    expect(out.nodes.r.next).toBe(openId)
    expect(out.nodes[openId].next).toBe('m1')
    expect(out.nodes.m2.next).toBe(closeId)
    expect(out.nodes[closeId].next).toBe('z')
    expect(forks(out.nodes.m1)).toEqual([{ child: 'b1', side: 'left' }]) // nothing inside moved
    valid(out)
  })

  it('wraps one node when no end is given', () => {
    const before = base()
    const out = wrapRun(before, 'm2', undefined, 'Just m2')
    const openId = created(before, out).find((id) => out.nodes[id].kind === 'project')
    const closeId = created(before, out).find((id) => out.nodes[id].kind === 'terminus')
    expect(out.nodes.m1.next).toBe(openId)
    expect(out.nodes[openId].next).toBe('m2')
    expect(out.nodes.m2.next).toBe(closeId)
    expect(out.nodes[closeId].next).toBe('z')
    valid(out)
  })

  it('refuses a run whose scope would straddle a branch span', () => {
    // The fork off m1 rejoins above m2, so naming m2 alone as a project would open a
    // scope inside that span and close it inside too, leaving the return to land in a
    // scope the branch was opened outside. Wrapping the whole span instead is legal,
    // and the span survives it untouched.
    const wide = setMergePoint(base(), 'b1', 'm2')
    expect(() => wrapRun(wide, 'm2', undefined, 'Just m2'))
      .toThrow(/this run cannot be named as a project: .*merge below where "Just m2" opens, or above where it closes/)
    const out = wrapRun(wide, 'm1', 'm2', 'Phase')
    expect(out.nodes.b2.mergePoint).toBe('m2')
    valid(out)
  })

  it('refuses a run that straddles a scope, reads downward, or leaves one trunk', () => {
    expect(() => wrapRun(base(), 'm2', 'z', 'Straddle')).toThrow() // z closes the plan, opened below the run
    expect(() => wrapRun(base(), 'm2', 'm1', 'Backwards')).toThrow()
    expect(() => wrapRun(base(), 'm1', 'b2', 'Two trunks')).toThrow()
  })

  it('removes a project node and its paired close, leaving the inside on the trunk', () => {
    const out = unwrapProject(withSub(), 'SP')
    expect(out.nodes.SP).toBeUndefined()
    expect(out.nodes.zs).toBeUndefined() // the close goes with its project
    expect(out.nodes.f1.next).toBe('s1') // what was inside stays on the trunk
    expect(out.nodes.s1.next).toBeNull()
    valid(out)
  })

  it('refuses a plan\'s base and a node that is not a project', () => {
    expect(() => unwrapProject(withSub(), 'r')).toThrow() // unwrapping a plan is deleting it
    expect(() => unwrapProject(withSub(), 's1')).toThrow()
  })
})

describe('wrapCandidates — the runs a menu may offer', () => {
  it('offers each node up the trunk, itself first', () => {
    // base(): r -> m1 -> m2 -> z. From m1 the legal runs are m1 alone and m1 to m2; the
    // plan's close cannot end a run, since its opening (r) would be left outside.
    expect(wrapCandidates(base(), 'm1')).toEqual(['m1', 'm2'])
    expect(wrapCandidates(base(), 'm2')).toEqual(['m2'])
  })

  it('offers a whole sub-project but never half of one', () => {
    // r -> Sub -> m1 -> zSub -> m2 -> z. From Sub the runs are the pair alone and the pair
    // plus m2; a run ending at m1 or at zSub would cut the scope in half.
    const wrapped = wrapRun(base(), 'm1', 'm1', 'Sub')
    const subId = ids(wrapped).find((id) => wrapped.nodes[id].title === 'Sub')
    const closeId = pairScopes(wrapped, trunksOf(wrapped)).pairs.get(subId)
    expect(wrapCandidates(wrapped, subId)).toEqual([closeId, 'm2'])
    // and from inside the scope, the run stops below the close that ends it
    expect(wrapCandidates(wrapped, 'm1')).toEqual(['m1'])
  })

  it('offers nothing that wrapRun would then refuse', () => {
    // The property the menu rests on, asserted directly against the operation.
    const wrapped = wrapRun(base(), 'm1', 'm1', 'Sub')
    for (const from of ids(wrapped)) {
      for (const to of wrapCandidates(wrapped, from)) {
        expect(() => wrapRun(wrapped, from, to, 'X')).not.toThrow()
      }
    }
  })

  it('is empty for a node that is not there', () => {
    expect(wrapCandidates(base(), 'nope')).toEqual([])
  })
})

describe('pasteAsTree', () => {
  // A clip mirroring base()'s shape, with one completed task and one carrying a
  // note, so the paste can be checked to keep statuses, clear cursors, and carry
  // notes by content: r(project) -> m1(here) -> m2(completed) -> z(r's close);
  // fork b1 -> b2(note).
  //
  // Returns: the fork's merge point rides in the clip like any other field, and it
  // holds an id, so the paste has to remap it along with .next and the branch arrays.
  const clip = () => ({
    rootId: 'r',
    nodes: {
      r:  { id: 'r',  title: 'Proj', kind: 'project', createdAt: 'old', note: null, next: 'm1', leftBranches: [], rightBranches: [] },
      m1: { id: 'm1', title: 'm1', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: null, here: true, next: 'm2', leftBranches: ['b1'], rightBranches: [] },
      m2: { id: 'm2', title: 'm2', kind: 'task', status: 'completed', createdAt: 'old', completedAt: '2026-02-02T00:00:00Z', note: null, here: false, next: 'z', leftBranches: [], rightBranches: [] },
      z:  { id: 'z',  kind: 'terminus', createdAt: 'old', note: null, next: null, leftBranches: [], rightBranches: [] },
      b1: { id: 'b1', title: 'b1', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: null, here: false, next: 'b2', leftBranches: [], rightBranches: [] },
      b2: { id: 'b2', title: 'b2', kind: 'task', status: 'todo', createdAt: 'old', completedAt: null, note: 'b2.md', here: false, next: null, mergePoint: 'm1', leftBranches: [], rightBranches: [] },
    },
    notes: { b2: '# b2 note\n' },
  })
  const empty = () => ({ schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: [], nodes: {} })

  it('refuses a clip that is not a plan, saying so where the clip is named', () => {
    // A clip pastes as a plan, and a plan is bounded by a project and its close, so a clip
    // rooted at a task cannot become one. Refused here rather than by validateRecord at the
    // end, which would complain about a node the caller never mentioned.
    const c = clip()
    c.rootId = 'm1'
    expect(() => pasteAsTree(empty(), c)).toThrow(/its root must be a project/)
    expect(() => pasteAsTree(empty(), { rootId: 'nope', nodes: {} })).toThrow(/rootId present in its own nodes/)
  })
  const byTitle = (record) => Object.fromEntries(Object.values(record.nodes).map((t) => [t.title, t]))

  it('pastes a copied project as a fresh, valid tree with regenerated ids', () => {
    const { next } = pasteAsTree(empty(), clip())
    // Termini: the clip carries the close that bounds it, so a copied plan is six
    // nodes, not five, and pastes back as a closed (valid) plan.
    expect(Object.keys(next.nodes)).toHaveLength(6)
    // Every id is new (none of the clip's literal ids survive) and the mapped
    // root is appended to planOrder as a project node.
    expect(['r', 'm1', 'm2', 'z', 'b1', 'b2'].some((id) => next.nodes[id])).toBe(false)
    expect(next.planOrder).toHaveLength(1)
    expect(next.nodes[next.planOrder[0]].kind).toBe('project')
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
    expect(t.m1.leftBranches[0]).toBe(t.b1.id)
    expect(t.b1.next).toBe(t.b2.id)
    // Termini: the close has no title to look it up by, so it is read off the edge
    // that should now point at its new id.
    expect(next.nodes[t.m2.next].kind).toBe('terminus')
    expect(next.nodes[t.m2.next].next).toBeNull()
    // Returns: the return line is an edge too, and it is remapped with the rest, so
    // the pasted fork still rejoins the pasted trunk rather than the copied one.
    expect(t.b2.mergePoint).toBe(t.m1.id)
  })

  it('carries a note by content into a fresh file named for the new id and title', () => {
    const { next, notes } = pasteAsTree(empty(), clip())
    const t = byTitle(next)
    // The id resolves and the slug is decorative (see model/notes.js).
    expect(t.b2.note).toBe(t.b2.id + '_b2.md')
    expect(notes).toEqual([{ file: t.b2.id + '_b2.md', content: '# b2 note\n' }])
  })

  it('does not mutate the clip, so the same copy can be pasted again disjointly', () => {
    const c = clip()
    const first = pasteAsTree(empty(), c)
    expect(c.nodes.m1.here).toBe(true) // clip untouched
    const second = pasteAsTree(first.next, c) // paste again into the result
    expect(second.next.planOrder).toHaveLength(2)
    expect(Object.keys(second.next.nodes)).toHaveLength(12) // two disjoint trees, closes and all
    expect(second.next.planOrder[0]).not.toBe(second.next.planOrder[1])
    valid(second.next)
  })

  it('suffixes pasted titles that collide with names already in the domain', () => {
    // Paste the clip into a record that already holds its titles (base(): r, m1,
    // m2, b1, b2), with the root renamed to 'Proj' so the clip root collides too.
    const dest = setTitle(base(), 'r', 'Proj')
    const { next } = pasteAsTree(dest, clip())
    const titles = Object.values(next.nodes).map((t) => t.title)
    expect(titles.filter((t) => t === 'Proj')).toHaveLength(1) // original kept
    expect(titles).toContain('Proj-1') // pasted root suffixed
    expect(titles).toContain('m1-1')
    expect(titles).toContain('b2-1')
    valid(next)
  })
})

describe('moveTaskNode', () => {
  it('grafts a single task onto the target, its slot taken by what was above it', () => {
    // Termini: m2's successor is the plan's close, so splicing m2 out of the trunk
    // drops that close onto m2's old slot rather than leaving m1 a tip.
    const out = moveTaskNode(base(), 'm2', 'b1') // m2 is the top task; b1 is on the fork
    expect(out.nodes.m1.next).toBe('z')
    expect(forks(out.nodes.b1).map((b) => b.child)).toContain('m2')
    expect(out.nodes.m2.next).toBeNull()
    valid(out)
  })

  it('moves only the node, splicing its children onto its predecessor', () => {
    const out = moveTaskNode(base(), 'm1', 'm2') // m1 has next m2 and fork b1
    expect(out.nodes.r.next).toBe('m2') // m2 took m1's slot under the root
    expect(forks(out.nodes.m2).map((b) => b.child).sort()).toEqual(['b1', 'm1'].sort()) // b1 spliced on, m1 grafted
    expect(out.nodes.m1.next).toBeNull()
    expect(forks(out.nodes.m1)).toEqual([])
    valid(out)
  })

  it('carries the "here" cursor with the moved node', () => {
    // Returns: the target was b2, the fork's tip, and a graft there is now refused,
    // since the only line above a tip is its own return and a fork landing there would
    // have nowhere legal to rejoin. b1 puts the same cursor question to a node that
    // does have a trunk edge above it.
    const out = moveTaskNode(base(), 'm1', 'b1') // m1 is "here"
    expect(out.nodes.m1.here).toBe(true)
    expect(forks(out.nodes.b1).map((b) => b.child)).toContain('m1')
    valid(out)
  })

  it('refuses a graft onto the top of a branch trunk', () => {
    // The same rule that refuses opening a branch there: no trunk edge rises from a
    // tip, so there is no edge to hold the fork this would create.
    expect(() => moveTaskNode(base(), 'm2', 'b2')).toThrow(/nothing rises from "b2"/)
  })

  it('refuses a project node, a terminus, and a drop onto itself', () => {
    expect(() => moveTaskNode(base(), 'r', 'm2')).toThrow() // r is a project
    // Termini: a close is not a task and does not travel on its own; it moves only
    // as part of its scope.
    expect(() => moveTaskNode(base(), 'z', 'm2')).toThrow()
    expect(() => moveTaskNode(base(), 'm2', 'm2')).toThrow()
  })
})

// A record with an interior sub-project on a fork: r -> a -> zr(the plan's close),
// and a forks left to f1 -> SP(project) -> s1 -> zs(SP's close).
//
// Termini: the sub-project sits on a branch rather than on the plan's own trunk
// because a scope is an interval on ONE trunk. Anything cut out of the plan's trunk
// at SP would carry the plan's close away with it (it is above SP on that trunk),
// leaving both plans unbalanced; a branch-borne scope is closed within its own
// trunk, so it can be grafted, detached, or spliced whole.
//
// Returns: the branch rejoins at a, the node it left, and its merge point is stored on
// zs, the top of the branch's own trunk, which is a terminus here because the branch
// ends in the sub-project's close. Nothing higher is legal on that trunk: zr closes the
// plan, so no edge rises from it.
function withSub() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
  })
  const p = (id, over = {}) => ({
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  const terminus = (id, over = {}) => ({
    id, kind: 'terminus', createdAt: '2026-01-01T00:00:00Z', note: null, next: null,
    leftBranches: [], rightBranches: [], ...over,
  })
  return {
    schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['r'],
    nodes: {
      r: p('r', { next: 'a' }),
      a: t('a', { next: 'zr', leftBranches: ['f1'] }),
      zr: terminus('zr'),
      f1: t('f1', { next: 'SP' }),
      SP: p('SP', { next: 's1' }),
      s1: t('s1', { next: 'zs' }),
      zs: terminus('zs', { mergePoint: 'a' }),
    },
  }
}

describe('moveSubtree', () => {
  it('grafts a whole subtree onto the target, intact', () => {
    const out = moveSubtree(withSub(), 'SP', 'a') // move the SP sub-project onto the trunk task a
    expect(out.nodes.f1.next).toBeNull() // SP left f1's line
    expect(forks(out.nodes.a).map((b) => b.child)).toContain('SP')
    expect(out.nodes.SP.next).toBe('s1') // subtree intact
    expect(out.nodes.s1.next).toBe('zs') // Termini: its close travelled with it
    valid(out)
  })

  it('drops a whole tree from planOrder when grafted as a sub-project', () => {
    // two trees; graft the second root's tree onto a node in the first
    const two = withSub()
    two.nodes.p2 = { id: 'p2', title: 'p2', kind: 'project', createdAt: '2026-01-02T00:00:00Z', note: null, next: 'q2', leftBranches: [], rightBranches: [] }
    two.nodes.q2 = { id: 'q2', title: 'q2', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'z2', leftBranches: [], rightBranches: [] }
    two.nodes.z2 = { id: 'z2', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] }
    two.planOrder = ['r', 'p2']
    valid(two)
    const out = moveSubtree(two, 'p2', 'a')
    expect(out.planOrder).toEqual(['r']) // p2 is no longer a root
    expect(forks(out.nodes.a).map((b) => b.child)).toContain('p2')
    expect(out.nodes.p2.next).toBe('q2')
    valid(out)
  })

  it('refuses grafting a subtree onto its own descendant, or onto itself', () => {
    expect(() => moveSubtree(withSub(), 'SP', 's1')).toThrow() // s1 is inside SP
    expect(() => moveSubtree(withSub(), 'SP', 'SP')).toThrow()
  })

  it('refuses a task, which travels alone and has its own verb', () => {
    // The two moves are named for the two kinds, and each names the other: a project takes
    // the plan it opens, a task takes nothing. Refusing here rather than in the tool layer
    // means the tool surface and the app get the same answer.
    expect(() => moveSubtree(withSub(), 's1', 'f1')).toThrow(/use moveTaskNode for a task/)
  })
})

describe('detachToTree', () => {
  it('turns a sub-project into its own root, carrying its subtree', () => {
    const out = detachToTree(withSub(), 'SP')
    expect(out.nodes.f1.next).toBeNull() // SP cut from f1's line
    expect(out.planOrder).toContain('SP')
    expect(out.nodes.SP.next).toBe('s1') // subtree intact
    // Termini: the scope's close came with it and is now the new plan's own close,
    // which is why nothing may sit above it.
    expect(out.nodes.s1.next).toBe('zs')
    expect(out.nodes.zs.next).toBeNull()
    valid(out)
  })

  it('refuses a task node and a node that is already a root', () => {
    expect(() => detachToTree(withSub(), 's1')).toThrow() // s1 is a task
    expect(() => detachToTree(withSub(), 'r')).toThrow() // r is already a root
  })

  // Termini: a scope travels as a pair, so a sub-project with work above it takes its own
  // close and leaves the rest of the trunk joined across the gap. Getting this wrong is not
  // subtle: the old trunk keeps the detached scope's close and loses its own, and neither
  // side is a legal plan afterwards. withSub()'s close happens to be at the top of its
  // trunk, so only a scope with something above it puts the question.
  it('takes its own close with it and rejoins the trunk it left', () => {
    const wrapped = wrapRun(base(), 'm1', 'm1', 'Sub')
    const subId = ids(wrapped).find((id) => wrapped.nodes[id].title === 'Sub')
    const closeId = pairScopes(wrapped, trunksOf(wrapped)).pairs.get(subId)
    valid(wrapped)
    expect(wrapped.nodes.r.next).toBe(subId)
    expect(wrapped.nodes[closeId].next).toBe('m2')

    const out = detachToTree(wrapped, subId)
    expect(out.planOrder).toContain(subId)
    expect(out.nodes.r.next).toBe('m2') // the old trunk is joined across the gap
    expect(out.nodes[closeId].next).toBeNull() // the detached plan ends at its own close
    expect(out.nodes[subId].next).toBe('m1') // and keeps what was inside it
    valid(out)
  })
})

describe('scope-bounded operations — a sub-project with work above its close', () => {
  // r -> Sub -> m1 -> zSub -> m2 -> z up the trunk, with b1 -> b2 hanging off m1 inside the
  // scope. This is the shape base() and withSub() both lack, and the only one that puts the
  // question: an unbounded walk from Sub takes m2 and the plan's own close with it, so the
  // scope arrives somewhere else holding the enclosing plan's close and neither side is
  // left a legal plan. Every operation here is bounded by extentOf instead.
  function wrapped() {
    const record = wrapRun(base(), 'm1', 'm1', 'Sub')
    const subId = ids(record).find((id) => record.nodes[id].title === 'Sub')
    const closeId = pairScopes(record, trunksOf(record)).pairs.get(subId)
    return { record, subId, closeId }
  }

  it('starts from a plan whose sub-project has work above it', () => {
    const { record, subId, closeId } = wrapped()
    expect(record.nodes.r.next).toBe(subId)
    expect(record.nodes[closeId].next).toBe('m2')
    expect(record.nodes.m2.next).toBe('z')
    valid(record)
  })

  it('drops a scope into a line and leaves what came after it', () => {
    const { record, subId, closeId } = wrapped()
    const out = moveIntoLine(record, subId, 'm2')
    expect(out.nodes.r.next).toBe('m2') // the trunk it left is joined across the gap
    expect(out.nodes.m2.next).toBe(subId) // the scope lands in the gap above m2
    expect(out.nodes[subId].next).toBe('m1') // with its body
    expect(out.nodes[closeId].next).toBe('z') // and its close carries the line on
    valid(out)
  })

  it('grafts a scope onto a card and leaves what came after it', () => {
    const { record, subId, closeId } = wrapped()
    const out = moveSubtree(record, subId, 'm2')
    expect(out.nodes.r.next).toBe('m2')
    expect(out.nodes.m2.next).toBe('z') // m2 kept its own place on the trunk
    expect(forks(out.nodes.m2).map((b) => b.child)).toContain(subId)
    expect(out.nodes[closeId].next).toBeNull() // the branch ends at the scope's close
    valid(out)
  })

  it('allows a drop that the unbounded reading called a descendant', () => {
    // m2 is above the scope's close, so it is reachable from Sub by following next, and the
    // old guard refused the drop as one onto Sub's own descendant. It is not in the scope,
    // and dropping a scope there is exactly what a author moving work about wants.
    const { record, subId } = wrapped()
    expect(() => moveIntoLine(record, subId, 'm2')).not.toThrow()
    expect(() => moveSubtree(record, subId, 'm2')).not.toThrow()
  })

  it('deletes a scope whole and keeps the trunk above it', () => {
    const { record, subId } = wrapped()
    const out = deleteTask(record, subId, 'subtree')
    expect(ids(out)).toEqual(['m2', 'r', 'z']) // m1, b1, b2 and the scope's close went
    expect(out.nodes.r.next).toBe('m2')
    valid(out)
  })

  it('deletes a task up to the close of the scope it sits in, and no further', () => {
    // m1 sits inside Sub, so removing what grows from it stops below Sub's close: m2 comes
    // after the scope ends and is no business of m1's.
    const { record, subId, closeId } = wrapped()
    const out = deleteTask(record, 'm1', 'subtree')
    expect(ids(out)).toEqual([closeId, 'm2', 'r', subId, 'z'].sort())
    expect(out.nodes[subId].next).toBe(closeId) // the scope is emptied, not unclosed
    expect(out.nodes[closeId].next).toBe('m2')
    valid(out)
  })

  it('refuses to delete a close on its own', () => {
    // A close has no life of its own to end, and its extent is the scope it closes, so a
    // delete would take the whole scope. The refusal names the two things that were asked
    // for: removing the scope, or unwrapping it to keep what is inside.
    const { record, closeId } = wrapped()
    expect(() => deleteTask(record, closeId, 'subtree')).toThrow(/close cannot be deleted on its own/)
    expect(() => deleteTask(record, closeId, 'splice')).toThrow(/close cannot be deleted on its own/)
  })

  it('clips the scope as a plan that stands alone, and pastes it as one', () => {
    // A clip is a plan, so no edge may leave it. The scope's close points at m2, which is
    // not in the clip; carrying that edge into a paste would wire the pasted copy into the
    // record it was taken from, and the paste would be refused as two incoming edges on m2.
    const { record, subId, closeId } = wrapped()
    const nodes = clipNodes(record, subId)
    expect(Object.keys(nodes).sort()).toEqual([subId, 'b1', 'b2', 'm1', closeId].sort())
    expect(nodes[closeId].next).toBeNull()

    const { next: out } = pasteAsTree(record, { rootId: subId, nodes, notes: {} })
    expect(out.planOrder).toHaveLength(2) // the plan it came from, and the pasted copy
    valid(out)
  })

  it('leaves a branch that hung on the close behind, re-homed onto the edge it held', () => {
    // The edge rising from a close belongs to whatever encloses the pair, not to the scope
    // the pair delimits, so a branch there stays with the trunk and takes the predecessor's
    // edge, which is the same position once the pair has gone. Its return goes with it, and
    // is clamped to its new edge because the node it named left.
    const { record, subId, closeId } = wrapped()
    const withSide = addBranchAbove(record, closeId, 'Side', 'right')
    const sideId = newId(record, withSide)
    valid(withSide)

    const out = detachToTree(withSide, subId)
    expect(out.nodes[sideId]).toBeDefined()
    expect(forks(out.nodes.r).map((b) => b.child)).toContain(sideId)
    expect(forks(out.nodes[closeId])).toEqual([])
    expect(out.nodes[sideId].mergePoint).toBe('r')
    valid(out)
  })
})

describe('reorderRoot', () => {
  // three roots, only some listed in planOrder (the rest are advisory-appended).
  // Termini: each root is a plan, so each is bracketed by its own close.
  function threeRoots() {
    const p = (id, createdAt) => ({ id, title: id, kind: 'project', createdAt, note: null, next: 'z' + id, leftBranches: [], rightBranches: [] })
    const terminus = (id) => ({ id: 'z' + id, kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] })
    return {
      schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['A', 'B', 'C'],
      nodes: {
        A: p('A', '2026-01-01T00:00:00Z'), zA: terminus('A'),
        B: p('B', '2026-01-02T00:00:00Z'), zB: terminus('B'),
        C: p('C', '2026-01-03T00:00:00Z'), zC: terminus('C'),
      },
    }
  }

  it('moves a root to a new index and clamps out-of-range indices', () => {
    valid(threeRoots())
    expect(reorderRoot(threeRoots(), 'C', 0).planOrder).toEqual(['C', 'A', 'B'])
    expect(reorderRoot(threeRoots(), 'A', 99).planOrder).toEqual(['B', 'C', 'A'])
  })

  it('canonicalises an incomplete planOrder to the full root set first', () => {
    const record = threeRoots()
    record.planOrder = ['B'] // A and C are roots too, but unlisted (ordered by createdAt: A before C)
    expect(reorderRoot(record, 'C', 0).planOrder).toEqual(['C', 'B', 'A'])
  })

  it('refuses a non-root node', () => {
    expect(() => reorderRoot(withSub(), 'a', 0)).toThrow()
  })
})

// A straight branchless line: project root r -> a -> b -> c -> d -> z(r's close).
function line4() {
  const t = (id, over = {}) => ({
    id, title: id, kind: 'task', status: 'todo', createdAt: 'x', completedAt: null,
    note: null, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
  })
  return {
    schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['r'],
    nodes: {
      r: { id: 'r', title: 'r', kind: 'project', createdAt: 'x', note: null, next: 'a', leftBranches: [], rightBranches: [] },
      a: t('a', { next: 'b' }), b: t('b', { next: 'c' }), c: t('c', { next: 'd' }), d: t('d', { next: 'z' }),
      z: { id: 'z', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] },
    },
  }
}
// The trunk above the root, in order. Termini: it ends at the plan's close, so
// every ordering below reads '...z' — a reordering that displaced the close would
// show up here.
const chain = (record) => { const out = []; let id = record.nodes.r.next; while (id) { out.push(id); id = record.nodes[id].next }; return out }

describe('moveIntoLine', () => {
  it('reorders a task into a gap higher on its line', () => {
    const out = moveIntoLine(line4(), 'b', 'c') // insert b between c and d
    expect(chain(out)).toEqual(['a', 'c', 'b', 'd', 'z'])
    valid(out)
  })

  it('reorders a task into a gap lower on its line', () => {
    const out = moveIntoLine(line4(), 'd', 'a') // insert d between a and b
    expect(chain(out)).toEqual(['a', 'd', 'b', 'c', 'z'])
    valid(out)
  })

  it('moving a task alone leaves its own branches behind on the line', () => {
    const out = moveIntoLine(base(), 'm1', 'm2') // m1 has fork b1; insert m1 above m2
    expect(out.nodes.r.next).toBe('m2') // m1 spliced out; its branch b1 stayed with the line
    expect(forks(out.nodes.m2).map((x) => x.child)).toContain('b1')
    expect(out.nodes.m2.next).toBe('m1') // m1 reinserted above m2
    expect(out.nodes.m1.next).toBe('z') // and below the plan's close
    expect(forks(out.nodes.m1)).toEqual([]) // travelled alone
    valid(out)
  })

  it('splices a whole sub-project into a line, its tip continuing the line', () => {
    const out = moveIntoLine(withSub(), 'SP', 'a') // SP(project)->s1->zs spliced above a
    expect(out.nodes.f1.next).toBeNull() // SP left f1's line
    expect(out.nodes.a.next).toBe('SP')
    expect(out.nodes.SP.next).toBe('s1') // subtree intact
    // Termini: the subtree's main-line tip is now its close, and that is what
    // continues onto what used to be above a — the plan's own close.
    expect(out.nodes.zs.next).toBe('zr')
    valid(out)
  })

  it('refuses inserting a subtree into its own line, or above itself', () => {
    expect(() => moveIntoLine(withSub(), 'SP', 's1')).toThrow()
    expect(() => moveIntoLine(line4(), 'b', 'b')).toThrow()
  })

  it('keeps only the tip-most cursor when a move merges two cursored lines', () => {
    // Returns: this began as a deleteTask 'splice', whose promoted fork merged two
    // lines, and that staging is no longer a record validateRecord will accept.
    // Promotion needs a successorless node holding a fork, and the only successorless
    // nodes are a branch's tip and a plan's close, neither of which has a trunk edge
    // above it for a fork to hang from. A move merges two lines just as that splice
    // did: b2 carries its cursor off the fork onto m1's line, which already has one,
    // and the tip-most survives.
    const record = base()
    record.nodes.b2.here = true // a second cursor, legal while b2 is on its own line
    valid(record)
    const out = moveIntoLine(record, 'b2', 'm1')
    expect(out.nodes.m1.next).toBe('b2')
    expect(out.nodes.m1.here).toBe(false) // cleared
    expect(out.nodes.b2.here).toBe(true) // kept (tip-most)
    valid(out)
  })
})

describe('moveUp / moveDown', () => {
  it('moves a task one step toward the tip', () => {
    expect(chain(moveUp(line4(), 'b'))).toEqual(['a', 'c', 'b', 'd', 'z'])
  })

  it('moves a task one step toward the root', () => {
    expect(chain(moveDown(line4(), 'c'))).toEqual(['a', 'c', 'b', 'd', 'z'])
  })

  it('keeps the swapped node\'s branches and cursor', () => {
    const out = moveUp(base(), 'm1') // m1 is "here" and forks to b1; swap with m2
    expect(out.nodes.r.next).toBe('m2')
    expect(out.nodes.m2.next).toBe('m1')
    expect(forks(out.nodes.m1).map((x) => x.child)).toContain('b1') // branch preserved
    expect(out.nodes.m1.here).toBe(true) // cursor preserved
    valid(out)
  })

  it('refuses moving the top of a trunk up, a root up, or below the root', () => {
    // Termini: the top of the trunk is the plan's close, and it is what has nothing
    // above it to swap with (m2, the top task, has the close above it).
    expect(() => moveUp(base(), 'z')).toThrow()
    expect(() => moveUp(base(), 'r')).toThrow() // r is the root
    expect(() => moveDown(base(), 'm1')).toThrow() // m1 sits right above the root
    expect(() => moveDown(base(), 'b1')).toThrow() // b1 is a branch line's start
  })
})
