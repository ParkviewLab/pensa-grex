// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { assignRows, junctionGaps, buildRowGrid, assignLanes, solveHeights } from './geometry.js'

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

// A metrics object standing in for the layout engine's own, with round numbers so that a
// failure reads as arithmetic rather than as noise. tan12 and rise are the real ones, since
// they are what the twelve degrees means.
const TAN12 = Math.tan((12 * Math.PI) / 180)
const METRICS = {
  baseY: 0, anchorGap: 10, minAir: 20, departClear: 10, arriveClear: 10,
  tan12: TAN12, rampRun: 100, rise: 200 * TAN12, junctionMargin: 4, diamondGap: 12,
}
const sizesOf = (map) => new Map(Object.entries(map).map(([id, [cardW, cardH]]) => [id, { cardW, cardH }]))

describe('solveHeights', () => {
  // Growth is upward and screen y falls as a plan rises, so these helpers read a solve the way
  // the drawing does: a circle sits anchorGap above its own card's top, a card hangs below it.
  const circle = (top) => top - METRICS.anchorGap
  const bottom = (top, h) => top + h

  it('packs a plain chain at the minimum, and only the minimum', () => {
    const model = fakeModel([{ id: 't', rootTaskId: 'a' }], { a: { next: 'b' }, b: { next: 'c' }, c: {} })
    const sizes = sizesOf({ a: [188, 50], b: [188, 90], c: [188, 50] })
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    // The air between a card's bottom edge and the circle beneath it is exactly minAir, and each
    // pair packs by its own two heights rather than by the tallest card on a shared row.
    for (const [lower, upper] of [['a', 'b'], ['b', 'c']]) {
      const air = circle(cardTopY.get(lower)) - bottom(cardTopY.get(upper), sizes.get(upper).cardH)
      expect(air).toBeCloseTo(METRICS.minAir, 9)
    }
  })

  it('places a branch foot so its line leaves the trunk at exactly twelve degrees', () => {
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'f', side: 'left' }] }, b: {}, f: { mergePoint: 'a' } },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], f: [188, 50] })
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    // The line departs departClear above a's circle and arrives arriveClear below f's card
    // bottom; the climb between those two points is the rise, which is what the angle means.
    const departure = circle(cardTopY.get('a')) - METRICS.departClear
    const arrival = bottom(cardTopY.get('f'), 50) + METRICS.arriveClear
    expect(departure - arrival).toBeCloseTo(METRICS.rise, 9)
  })

  it('gives an edge that hosts a fork more air than a plain one, so the line clears the card above', () => {
    const plain = fakeModel([{ id: 't', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const forked = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'f', side: 'left' }] }, b: {}, f: { mergePoint: 'a' } },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], f: [188, 50] })
    const airOf = (model) => {
      const { airBelow } = solveHeights(model, sizes, METRICS)
      return airBelow.get('b')
    }
    // The line climbs (cardW / 2) * tan12 while it crosses b's own half-width, so b's card has to
    // be that much further up or the line would pass behind it and re-emerge past its corner.
    expect(airOf(plain)).toBeCloseTo(METRICS.minAir, 9)
    expect(airOf(forked)).toBeCloseTo(METRICS.departClear + 94 * TAN12 + METRICS.junctionMargin, 9)
  })

  it('stretches the join edge when the branch is the taller side, and leaves no tail', () => {
    // A branch of three cards spanning one trunk edge: the trunk cannot pack that tightly, so the
    // edge above the merge point grows to fit the strand beside it.
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'f1', side: 'left' }] }, b: {},
        f1: { next: 'f2' }, f2: { next: 'f3' }, f3: { mergePoint: 'a' },
      },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], f1: [188, 50], f2: [188, 50], f3: [188, 50] })
    const { cardTopY, tails } = solveHeights(model, sizes, METRICS)

    // Measured from the solve rather than from airBelow: airBelow is what the succession
    // constraint asked of the edge, and the point here is that the return's constraint asked for
    // much more and won.
    const gap = circle(cardTopY.get('a')) - bottom(cardTopY.get('b'), 50)
    expect(gap).toBeGreaterThan(METRICS.minAir * 3) // the edge really did stretch
    // The return still leaves exactly departClear above the tip's circle: the branch is the
    // binding side, so there is no slack to put in a tail.
    expect(tails.get('f1')).toBeCloseTo(METRICS.departClear, 9)
    const departure = circle(cardTopY.get('f3')) - METRICS.departClear
    const arrival = bottom(cardTopY.get('b'), 50) + METRICS.arriveClear
    expect(departure - arrival).toBeCloseTo(METRICS.rise, 9)
  })

  it('grows a tail instead when the trunk run is the taller side', () => {
    // One card spanning four trunk edges: the trunk is already at its minimum and cannot come
    // down, so the branch's spine runs on above its card before the return peels off.
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'f', side: 'left' }] },
        b: { next: 'c' }, c: { next: 'd' }, d: { next: 'e' }, e: {},
        f: { mergePoint: 'd' },
      },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], c: [188, 50], d: [188, 50], e: [188, 50], f: [188, 50] })
    const { cardTopY, tails } = solveHeights(model, sizes, METRICS)

    expect(tails.get('f')).toBeGreaterThan(METRICS.departClear)
    // Whatever the tail's length, the return still climbs at exactly twelve degrees into its
    // arrival, which is the point of deriving the tail rather than solving for it.
    const departure = circle(cardTopY.get('f')) - tails.get('f')
    const arrival = bottom(cardTopY.get('e'), 50) + METRICS.arriveClear
    expect(departure - arrival).toBeCloseTo(METRICS.rise, 9)
  })

  it('stretches a bubble\'s own edge, both junctions on it and the branch between them', () => {
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'f', side: 'left' }] }, b: {}, f: { mergePoint: 'a' } },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], f: [188, 50] })
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    // The smallest branch leaves an edge and returns to it, so that one edge carries the whole
    // lens: the two clearances and the two climbs, plus the branch's own card and the one
    // anchorGap its own circle takes.
    const gap = circle(cardTopY.get('a')) - bottom(cardTopY.get('b'), 50)
    expect(gap).toBeCloseTo(
      2 * (METRICS.departClear + METRICS.rise + METRICS.arriveClear) + 50 + METRICS.anchorGap, 9,
    )
    // And the branch's card really does sit inside that gap.
    expect(cardTopY.get('f')).toBeLessThan(cardTopY.get('a'))
    expect(cardTopY.get('f')).toBeGreaterThan(cardTopY.get('b'))
  })

  it('places a nested branch off its own host, so depth alone does not compound the climb', () => {
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'f', side: 'left' }] }, b: {},
        f: { next: 'g', branches: [{ child: 'h', side: 'left' }] }, g: { mergePoint: 'a' },
        h: { mergePoint: 'f' },
      },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], f: [188, 50], g: [188, 50], h: [188, 50] })
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    const climbOf = (host, foot) =>
      (circle(cardTopY.get(host)) - METRICS.departClear) - (bottom(cardTopY.get(foot), 50) + METRICS.arriveClear)
    expect(climbOf('a', 'f')).toBeCloseTo(METRICS.rise, 9)
    expect(climbOf('f', 'h')).toBeCloseTo(METRICS.rise, 9) // the same climb, one level in
  })
})
