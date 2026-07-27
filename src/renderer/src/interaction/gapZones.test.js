// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The drop geometry as data: which gap a point falls in, and how a drop splits a gap's
// junctions into carried and kept. The record here is the smallest one with both kinds
// of junction in one gap and a plan close to refuse: r(project) -> a -> b -> z, with a
// branch f1 -> f2 hanging on a and rejoining above a (a bubble spans the a..b gap).

import { describe, it, expect } from 'vitest'
import { gapAt, carryAt, TIP_GAP } from './gapZones.js'

const record = {
  schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['r'],
  nodes: {
    r: { id: 'r', title: 'R', kind: 'project', next: 'a', leftBranches: [], rightBranches: [] },
    a: { id: 'a', title: 'A', kind: 'task', status: 'todo', next: 'b', leftBranches: ['f1'], rightBranches: ['g1'] },
    b: { id: 'b', title: 'B', kind: 'task', status: 'todo', next: 'z', leftBranches: [], rightBranches: [] },
    z: { id: 'z', kind: 'terminus', next: null, leftBranches: [], rightBranches: [] },
    f1: { id: 'f1', title: 'F1', kind: 'task', status: 'todo', next: 'f2', leftBranches: [], rightBranches: [] },
    f2: { id: 'f2', title: 'F2', kind: 'task', status: 'todo', next: null, mergePoint: 'a', leftBranches: [], rightBranches: [] },
    g1: { id: 'g1', title: 'G1', kind: 'task', status: 'todo', next: null, mergePoint: 'a', leftBranches: [], rightBranches: [] },
  },
}

// Trunk stations, bottom-up r, a, b, z at x=0; the branch's own lane plays no part here.
// y falls upward: each card is 40 tall, gaps 60, so the gap above a runs y 200..140.
const station = (id, cardTop) => ({ id, x: 0, cardTop, cardW: 188, cardH: 40, anchorY: cardTop - 14 })
const stations = [station('r', 300), station('a', 200), station('b', 100), station('z', 0)]
// The bubble's two junctions in the a..b gap: the fork low (above a's circle), the
// merge high (below b's card bottom), as the layout places them.
const junctions = [
  { x: 0, y: 178, kind: 'fork', edgeBelowId: 'a', footIds: ['f1'] },
  { x: 0, y: 152, kind: 'merge', edgeBelowId: 'a', footIds: ['f1'] },
]

describe('gapAt', () => {
  it('finds the gap above the node below the point', () => {
    const g = gapAt(record, stations, 0, 170)
    expect(g.belowId).toBe('a')
    expect(g.yTop).toBe(140) // b's card bottom
    expect(g.yBot).toBe(200) // a's card top
  })

  it('gives a line tip an open band, but not a plan close', () => {
    // z is the plan's close: nothing may sit above it, so no band. The branch tip f2
    // is not in `stations` here, which is the point: the guard is the close, not the tip.
    expect(gapAt(record, stations, 0, -10)).toBeNull()
    const withTip = [...stations, station('f2', -200)]
    const g = gapAt(record, withTip, 0, -200 - TIP_GAP / 2)
    expect(g && g.belowId).toBe('f2')
  })

  it('a successor with no station is a fold, not a tip: no band above it', () => {
    // The layout is drawn from a pruned copy, so a collapsed project's next has no card.
    // Without the guard, `a` would read as a line tip and open a 44px band whose drop
    // splices the card invisibly inside the fold. Modelled here by leaving b (and z)
    // out of the stations, exactly what the collapsed layout hands over.
    const folded = stations.filter((s) => s.id !== 'b' && s.id !== 'z')
    expect(gapAt(record, folded, 0, 200 - TIP_GAP / 2)).toBeNull()
  })

  it('misses sideways', () => {
    expect(gapAt(record, stations, 200, 170)).toBeNull()
  })
})

describe('carryAt', () => {
  const gap = { belowId: 'a', x: 0, yTop: 140, yBot: 200 }

  it('a drop above both junctions carries nothing: the card sits outside the span', () => {
    const c = carryAt(record, junctions, gap, 145, 'x')
    expect(c.branchFeet).toEqual([])
    expect(c.mergeFeet).toEqual([])
    expect(c.caretY).toBe((140 + 152) / 2) // centred in the highest sub-gap
  })

  it('a drop between fork and merge carries the merge alone: the card enters the span', () => {
    const c = carryAt(record, junctions, gap, 165, 'x')
    expect(c.branchFeet).toEqual([])
    expect(c.mergeFeet).toEqual(['f1'])
    expect(c.caretY).toBe((152 + 178) / 2)
  })

  it('a drop below both carries the whole bubble up onto the card', () => {
    // The card lands under the departure diamond, so both junctions sit above it and
    // both follow it: the bubble moves onto the card's own rising edge.
    const c = carryAt(record, junctions, gap, 190, 'x')
    expect(c.branchFeet).toEqual(['f1'])
    expect(c.mergeFeet).toEqual(['f1'])
    expect(c.caretY).toBe((178 + 200) / 2)
  })

  it('leaves out the feet of the branch the source itself is on, junctions still bounding', () => {
    // Dragging f2, the branch's own tip, and dropping BELOW both diamonds, where they
    // would otherwise carry: the feet must not be offered, since the splice-out changes
    // what that branch looks like mid-edit and the mutation refuses. The diamonds are
    // still ink, so they still bound the sub-gap and the caret sits under the fork,
    // not across the whole gap.
    const c = carryAt(record, junctions, gap, 190, 'f2')
    expect(c.branchFeet).toEqual([])
    expect(c.mergeFeet).toEqual([])
    expect(c.caretY).toBe((178 + 200) / 2)
  })

  it('a shared diamond fans out to every foot, and drops only the source\'s own', () => {
    // Both branches' junctions coincide (the layout keys junctions by point), so one
    // diamond carries two feet. Dragging a card from f1's branch must still offer g1's
    // half: excluding the whole junction would leave the record quietly diverging from
    // what the drop showed.
    const shared = [
      { x: 0, y: 178, kind: 'fork', edgeBelowId: 'a', footIds: ['f1', 'g1'] },
      { x: 0, y: 152, kind: 'merge', edgeBelowId: 'a', footIds: ['f1', 'g1'] },
    ]
    const foreign = carryAt(record, shared, gap, 190, 'x')
    expect(foreign.branchFeet).toEqual(['f1', 'g1'])
    expect(foreign.mergeFeet).toEqual(['f1', 'g1'])
    const fromF = carryAt(record, shared, gap, 190, 'f2')
    expect(fromF.branchFeet).toEqual(['g1'])
    expect(fromF.mergeFeet).toEqual(['g1'])
    expect(fromF.caretY).toBe((178 + 200) / 2) // the diamond still bounds the sub-gap
  })
})
