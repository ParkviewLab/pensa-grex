// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { assignRows, junctionGaps, buildRowGrid, assignLanes } from './geometry.js'

// A minimal stand-in for the buildModel() runtime model (model/model.js),
// exposing only what geometry.js actually reads: .trees, .nodes and .getNode(id).
// A model node's .branches is [{ child, side }] — the record's two per-side
// arrays already flattened in left-then-right order — with no `at`: a branch
// array names the edge rising from the node that holds it. `mergePoint` rides on the TOP
// of a branch's own trunk and names the node below the edge its return line joins.
//
// Returns: a real record carries a mergePoint on every branch tip, since validateRecord
// refuses a branch that never rejoins. geometry.js reads the field without requiring it,
// so a fixture below that omits it is isolating what a fork on its own asks of the rows;
// every fixture about a return states one.
function fakeModel(trees, nodeDefs) {
  const nodes = new Map(Object.entries(nodeDefs).map(([id, n]) => [
    id, { id, next: n.next || null, branches: n.branches || [], mergePoint: n.mergePoint || null, predecessorId: n.predecessorId ?? null },
  ]))
  return { trees, nodes, getNode: (id) => nodes.get(id) || null }
}

describe('assignRows', () => {
  it('puts every root at row 0 and increments by 1 down a main line', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b' }, b: { next: 'c' }, c: {} },
    )
    const row = assignRows(model)
    expect(row.get('a')).toBe(0)
    expect(row.get('b')).toBe(1)
    expect(row.get('c')).toBe(2)
  })

  // Returns: the constraint is that a branch's foot sits one row above the node it
  // leaves, and standing level with that node's .next is what the constraint gives while
  // nothing has stretched the edge between the two. A branch returning to that same edge
  // pushes the .next up instead, which is the bubble tested further down.
  it('starts a branch level with its parent\'s .next', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left' }] }, b: {}, x: {} },
    )
    const row = assignRows(model)
    expect(row.get('a')).toBe(0)
    expect(row.get('b')).toBe(1)
    expect(row.get('x')).toBe(1) // level with b, not with a
  })

  // Schema 3: this test used to assert the distinct geometry of a fork attached at
  // the gap BELOW its node (at:'below'), which put the child level with that node
  // itself, one gap lower than its .next. The shape can no longer say it — the
  // migration moves such a fork onto the node beneath, where it means the same
  // thing — so the assertion is replaced by the nearest true one about the new
  // shape: an array names the edge RISING from its holder, so the child is at the
  // holder's row + 1 even in the case where at:'below' had its bite, a holder with
  // no .next of its own to be level with.
  it('starts a branch one row above its holder even when the holder has no .next', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [] }, b: { branches: [{ child: 'x', side: 'left' }] }, x: {} },
    )
    const row = assignRows(model)
    expect(row.get('b')).toBe(1)
    expect(row.get('x')).toBe(2) // one gap above b, the edge b's array names
  })

  it('stretches the trunk above a merge point to make room for a taller branch', () => {
    // The branch leaves a's edge and its return lands on the edge rising from b, so c,
    // the node above that edge, has to clear the branch's tip. Three branch cards want
    // three rows and the edge from b to c had one, so c rises by two rather than the
    // return line falling to reach it.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
        b: { next: 'c' }, c: {},
        x1: { next: 'x2' }, x2: { next: 'x3' }, x3: { mergePoint: 'b' },
      },
    )
    const bare = assignRows(fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b' }, b: { next: 'c' }, c: {} },
    ))
    const row = assignRows(model)
    expect(row.get('x1')).toBe(1)
    expect(row.get('x2')).toBe(2)
    expect(row.get('x3')).toBe(3)
    expect(row.get('c')).toBe(4) // one row above the tip, not one above b
    expect(bare.get('c')).toBe(2) // where the same trunk sits with nothing spanning it
    // Everything at or below the branch point stays where it was, so the stretch is
    // confined to the span and the plan below it does not shift as a branch grows.
    expect(row.get('a')).toBe(bare.get('a'))
    expect(row.get('b')).toBe(bare.get('b'))
  })

  it('gives a bubble exactly the rows its own cards need', () => {
    // A bubble leaves an edge and returns to that same edge (docs/model_v3_ideas.md,
    // section 6), so its card has to sit somewhere along that edge: b rises to make room
    // for it and c follows b. Nothing is added for the two junctions themselves, since
    // the branch's card between them puts them in different gaps.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x', side: 'left' }] },
        b: { next: 'c' }, c: {}, x: { mergePoint: 'a' },
      },
    )
    const row = assignRows(model)
    expect(row.get('a')).toBe(0) // the branch point itself does not move
    expect(row.get('x')).toBe(1)
    expect(row.get('b')).toBe(2) // the edge from a to b now spans two rows, holding x
    expect(row.get('c')).toBe(3)
  })

  it('adds no rows for a bubble the trunk already has room for', () => {
    // Rows are a longest path and not a running total, so a bubble on an edge that
    // another branch has already stretched is free. y spans the same edge as the
    // three-card bubble beside it, and no node moves for it.
    const defs = {
      b: { next: 'c' }, c: {},
      x1: { next: 'x2' }, x2: { next: 'x3' }, x3: { mergePoint: 'a' },
    }
    const tallOnly = assignRows(fakeModel([{ id: 't1', rootTaskId: 'a' }], {
      ...defs,
      a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
    }))
    const withBoth = assignRows(fakeModel([{ id: 't1', rootTaskId: 'a' }], {
      ...defs,
      a: { next: 'b', branches: [{ child: 'x1', side: 'left' }, { child: 'y', side: 'right' }] },
      y: { mergePoint: 'a' },
    }))
    expect(tallOnly.get('b')).toBe(4) // three branch cards, so the edge spans four rows
    for (const id of ['a', 'b', 'c', 'x1', 'x2', 'x3']) {
      expect(withBoth.get(id)).toBe(tallOnly.get(id))
    }
    expect(withBoth.get('y')).toBe(1) // the room for it was there already
  })
})

describe('junctionGaps', () => {
  it('reports the lower row of the gap a fork attaches to', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left' }] }, b: {}, x: {} },
    )
    const row = assignRows(model)
    expect(junctionGaps(model, row)).toEqual(new Set([0]))
  })

  it('reports one gap per forking node, always that node\'s own row', () => {
    // Every fork leaves the gap above the node holding it, so two forks held at
    // different rows carry two junctions; a node with none carries no junction. A return
    // contributes a gap of its own, which the next test covers.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x', side: 'left' }] },
        b: { next: 'c', branches: [{ child: 'y', side: 'right' }] },
        c: {}, x: {}, y: {},
      },
    )
    const row = assignRows(model)
    expect(junctionGaps(model, row)).toEqual(new Set([0, 1]))
  })

  it('reports the gap below the node above a merge point', () => {
    // A return joins the edge rising from its merge point and arrives below the node at
    // the top of that edge, so the gap wanting clearance is that node's row less one.
    // The fork leaves gap 0, and the branch has stretched the trunk enough to put c at
    // row 4, so the return lands in gap 3.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
        b: { next: 'c' }, c: {},
        x1: { next: 'x2' }, x2: { next: 'x3' }, x3: { mergePoint: 'b' },
      },
    )
    const row = assignRows(model)
    expect(row.get('c')).toBe(4)
    expect(junctionGaps(model, row)).toEqual(new Set([0, 3]))

    // A bubble's two junctions share one trunk edge but not one gap: the fork sits in
    // the gap above the node it leaves, the return in the gap below the node above that
    // same edge, and the branch's own card holds the two apart.
    const bubble = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x', side: 'left' }] },
        b: { next: 'c' }, c: {}, x: { mergePoint: 'a' },
      },
    )
    expect(junctionGaps(bubble, assignRows(bubble))).toEqual(new Set([0, 1]))
  })
})

describe('buildRowGrid', () => {
  it('spaces rows by the tallest card at the upper row, plus the gap', () => {
    const model = fakeModel([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const row = assignRows(model)
    const sizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 90 }]])
    const { cardTopY } = buildRowGrid(model, row, sizes, { rowGap: 20, junctionExtra: 30, baseY: 1000 })
    expect(cardTopY.get(0)).toBe(1000)
    expect(cardTopY.get(1)).toBe(1000 - (90 + 20)) // b's own height drives the pitch up to it
  })

  it('widens a gap that carries a fork junction', () => {
    const withFork = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left' }] }, b: {}, x: {} },
    )
    const withoutFork = fakeModel([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const sizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 50 }], ['x', { cardW: 138, cardH: 50 }]])
    const opts = { rowGap: 20, junctionExtra: 30, baseY: 0 }

    const forkGrid = buildRowGrid(withFork, assignRows(withFork), sizes, opts)
    const plainGrid = buildRowGrid(withoutFork, assignRows(withoutFork), sizes, opts)
    const forkPitch = forkGrid.cardTopY.get(0) - forkGrid.cardTopY.get(1)
    const plainPitch = plainGrid.cardTopY.get(0) - plainGrid.cardTopY.get(1)
    expect(forkPitch).toBe(plainPitch + 30)
  })

  it('a taller card at a row opens that row\'s pitch, never overlapping the row below', () => {
    const model = fakeModel([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const row = assignRows(model)
    const tallSizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 300 }]])
    const { cardTopY } = buildRowGrid(model, row, tallSizes, { rowGap: 20, junctionExtra: 30, baseY: 0 })
    const bBottom = cardTopY.get(1) + 300
    expect(bBottom).toBeLessThanOrEqual(cardTopY.get(0) - 20)
  })

  it('reports the tallest card at each row, which is what a lateral run is anchored to', () => {
    // The branch's foot shares row 1 with b, the trunk's own next, and is the taller of
    // the two. A return hanging under b alone would run at a height where x's card still
    // sits, so tallestByRow is reported for the run to use rather than one card's height.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x', side: 'left' }] },
        b: { next: 'c' }, c: {}, x: { mergePoint: 'b' },
      },
    )
    const row = assignRows(model)
    const sizes = new Map([
      ['a', { cardW: 138, cardH: 50 }],
      ['b', { cardW: 138, cardH: 90 }],
      ['c', { cardW: 138, cardH: 50 }],
      ['x', { cardW: 138, cardH: 140 }],
    ])
    const { tallestByRow, cardTopY } = buildRowGrid(model, row, sizes, { rowGap: 20, junctionExtra: 30, baseY: 0 })
    expect(row.get('b')).toBe(1)
    expect(row.get('x')).toBe(1)
    expect(tallestByRow.get(0)).toBe(50)
    expect(tallestByRow.get(1)).toBe(140) // x's card, not b's 90
    expect(tallestByRow.get(2)).toBe(50)
    // Both gaps carry a junction, the fork in gap 0 and the return in gap 1, so each
    // pitch is that row's tallest card plus the row gap plus a junction's clearance.
    expect(cardTopY.get(1)).toBe(0 - (140 + 20 + 30))
    expect(cardTopY.get(2)).toBe(cardTopY.get(1) - (50 + 20 + 30))
  })
})

describe('assignLanes', () => {
  it('puts every tree\'s trunk at lane 0', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }, { id: 't2', rootTaskId: 'p' }],
      { a: {}, p: {} },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('a'))).toBe(0)
    expect(lane.get(lineOfTask.get('p'))).toBe(0)
  })

  // Returns: this test pinned an alternation fallback, left then right by branch index,
  // and that rule is gone. Lane order is the author's now, read out of the stored arrays,
  // so there is no index for a side to alternate on; a branch reaching geometry without
  // one is simply drawn on the left. A model from buildModel() always carries a side,
  // since a fork lives in one of the two per-side arrays, so what is pinned here is
  // geometry's own reading of a branch that arrives without one.
  it('reads a branch that arrives without a side as a left branch', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1' }, { child: 'x2' }, { child: 'x3' }] },
        x1: {}, x2: {}, x3: {},
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1) // 1st: innermost, a holds it first
    expect(lane.get(lineOfTask.get('x2'))).toBe(-2) // 2nd: outward on the same side
    expect(lane.get(lineOfTask.get('x3'))).toBe(-3) // 3rd: outward again
  })

  it('honours an explicit side', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { branches: [{ child: 'x1', side: 'right' }] }, x1: {} },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(1)
  })

  it('reuses a lane for two branches whose rows never overlap', () => {
    // a forks x1 (a single-task branch, occupying only row 1); c (further up
    // the trunk) forks x2 (also a single-task branch, at row 3) — x1 and x2
    // never coexist in the same row, so they should share lane -1.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
        b: { next: 'c', branches: [] },
        c: { branches: [{ child: 'x2', side: 'left' }] },
        x1: {}, x2: {},
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1)
    expect(lane.get(lineOfTask.get('x2'))).toBe(-1)
  })

  it('does not reuse a lane for two branches whose rows do overlap', () => {
    // Both x1 and x2 fork off the same task a, so both start at row 1 and
    // would collide if given the same lane.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1', side: 'left' }, { child: 'x2', side: 'left' }] },
        x1: { next: 'x1b' }, x1b: {},
        x2: {},
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('x1'))).not.toBe(lane.get(lineOfTask.get('x2')))
  })

  it('orders a side by the stored arrays, the line read from the top down', () => {
    // The trunk runs a, b, c, d. c holds two left branches, p and then q, and a holds
    // one, r, which is three cards tall so that its rows overlap theirs and the packer
    // cannot fold them onto one lane. p and q are bubbles on c's edge and r returns to
    // that same edge from further down, which is what lifts d to row 4.
    //
    // Reading the line from the top down reaches c before a, and each array innermost
    // first, so the lanes run p, q, r outward. The author decides that order by where a
    // branch hangs and where in its node's array it sits, and by nothing else.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'r', side: 'left' }] },
        b: { next: 'c' },
        c: { next: 'd', branches: [{ child: 'p', side: 'left' }, { child: 'q', side: 'left' }] },
        d: {},
        p: { mergePoint: 'c' }, q: { mergePoint: 'c' },
        r: { next: 'r2' }, r2: { next: 'r3' }, r3: { mergePoint: 'c' },
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    const l = (id) => lane.get(lineOfTask.get(id))
    expect(row.get('d')).toBe(4)
    expect(l('p')).toBe(-1) // c is the higher branch point, and p is first in its array
    expect(l('q')).toBe(-2)
    expect(l('r')).toBe(-3) // a is read last, so its branch takes the outermost lane
    expect(l('r3')).toBe(l('r')) // r3 rides r's own line
  })
})

describe('assignLanes — lane order and band reservation', () => {
  // The Wide tree: trunk alpha->bravo->charlie->delta; charlie forks left=one,
  // right=two; delta forks left=apple, right=banana; two continues up to wonder.
  // Every fork rises from its holder, so charlie's children sit at row 3 and
  // delta's at row 4. Two's line spans rows 3-4 and overlaps banana's row 4, so the two
  // of them cannot share a lane and one is inner.
  function wide() {
    return fakeModel(
      [{ id: 't1', rootTaskId: 'alpha' }],
      {
        alpha: { next: 'bravo' },
        bravo: { next: 'charlie' },
        charlie: { next: 'delta', branches: [{ child: 'one', side: 'left' }, { child: 'two', side: 'right' }] },
        delta: { branches: [{ child: 'apple', side: 'left' }, { child: 'banana', side: 'right' }] },
        one: {}, two: { next: 'wonder' }, wonder: {}, apple: {}, banana: {},
      },
    )
  }

  // Returns: the rule was that the branch attaching higher sits inner, so that no
  // connector crossed another. Order no longer has to keep the drawing planar, since a
  // lateral line may cross a trunk and hops it (docs/model_v3_ideas.md, section 7); it is
  // the author's, read from the stored arrays. The outcome here is the one the old rule
  // gave, because a branch point higher up a line is reached earlier by that reading, and
  // what has gone is the reason rather than the lane.
  it('places delta\'s branch inner, since the line is read from the top down', () => {
    const model = wide()
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    const l = (id) => lane.get(lineOfTask.get(id))
    // right side: banana (off delta, the higher of the two branch points, so read first)
    // inner, two (off charlie, read after it) outer
    expect(l('banana')).toBeGreaterThan(0)
    expect(l('two')).toBeGreaterThan(0)
    expect(l('banana')).toBeLessThan(l('two'))
    // left side: one and apple never share a row, so they still pack onto one lane
    expect(l('one')).toBe(l('apple'))
    expect(l('one')).toBeLessThan(0)
    // wonder rides two's line
    expect(l('wonder')).toBe(l('two'))
  })

  it('reserves a band for a nested subtree so an inner sub-branch cannot collide', () => {
    // b (right branch of the trunk) has its own right sub-branch s; b's line
    // spans rows 1-3 so it overlaps a sibling c at row 2. b's band must be wide
    // enough for s, and c must sit outside the whole band.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'a2', branches: [{ child: 'b', side: 'right' }] },
        a2: { branches: [{ child: 'c', side: 'right' }] },
        b: { next: 'b2', branches: [{ child: 's', side: 'right' }] },
        b2: { next: 'b3' }, b3: {}, s: {}, c: {},
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    const l = (id) => lane.get(lineOfTask.get(id))
    // All three are right-side branches.
    expect(l('b')).toBeGreaterThan(0)
    expect(l('s')).toBeGreaterThan(0)
    expect(l('c')).toBeGreaterThan(0)
    // b's subtree spreads b and s onto distinct lanes (a reserved band, not one lane).
    expect(l('s')).not.toBe(l('b'))
    // c and s both sit at row 2 on the right; without the reserved band they would
    // collide on the same lane — they must not.
    expect(l('c')).not.toBe(l('s'))
    expect(l('c')).not.toBe(l('b'))
  })
})
