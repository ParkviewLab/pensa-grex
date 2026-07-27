// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { assignLanes, solveHeights } from './geometry.js'
import { hullSeamToClose } from '../render/shapes.js'

// A minimal stand-in for the buildModel() runtime model (model/model.js),
// exposing only what geometry.js actually reads: .trees, .nodes and .getNode(id).
// A model node's .branches is [{ child, side }] — the record's two per-side
// arrays already flattened in left-then-right order — with no `at`: a branch
// array names the edge rising from the node that holds it. `mergePoint` rides on the TOP
// of a branch's own trunk and names the node below the edge its return line joins.
//
// Returns: a real record carries a mergePoint on every branch tip, since validateRecord
// refuses a branch that never rejoins. geometry.js reads the field without requiring it,
// so a fixture below that omits it is isolating what a fork on its own asks of the solve;
// every fixture about a return states one.
function fakeModel(trees, nodeDefs) {
  const nodes = new Map(Object.entries(nodeDefs).map(([id, n]) => [
    id, {
      id, next: n.next || null, branches: n.branches || [], mergePoint: n.mergePoint || null,
      predecessorId: n.predecessorId ?? null,
      // A folded scope is the one case the solve reads a kind and the renderer's view-only
      // `collapsed` mark for, so a fixture states them only where they matter.
      kind: n.kind || 'task', collapsed: !!n.collapsed,
    },
  ]))
  return { trees, nodes, getNode: (id) => nodes.get(id) || null }
}

// The packer asks one thing of the vertical, whether two lines' extents overlap, so a fixture here
// states a span in pixels per task and this helper takes the union over the tasks of one line,
// which is the shape layout.js builds out of the solve's cardTopY. Spans are screen y with growth
// upward, so a larger span sits lower down the plan; the packer compares intervals and reads no
// direction into them.
const extentsFrom = (spans) => (ids) => ({
  min: Math.min(...ids.map((i) => spans[i][0])),
  max: Math.max(...ids.map((i) => spans[i][1])),
})

describe('assignLanes', () => {
  it('puts every tree\'s trunk at lane 0', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }, { id: 't2', rootTaskId: 'p' }],
      { a: {}, p: {} },
    )
    // Two trunks and nothing hanging off either, so no extent can decide anything here: a trunk is
    // lane 0 by definition, and what keeps two trees apart is layout.js offsetting each tree's box
    // rather than a lane.
    const { lane, lineOfTask } = assignLanes(model, extentsFrom({ a: [0, 50], p: [0, 50] }))
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
    // Pixels: all three leave the same node, so the solve would put them level and their extents
    // are given as one span. Sharing it is what forces three distinct lanes, and distinct lanes
    // are what make the side and the order readable at all.
    const spans = { a: [400, 450], x1: [300, 350], x2: [300, 350], x3: [300, 350] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1) // 1st: innermost, a holds it first
    expect(lane.get(lineOfTask.get('x2'))).toBe(-2) // 2nd: outward on the same side
    expect(lane.get(lineOfTask.get('x3'))).toBe(-3) // 3rd: outward again
  })

  it('honours an explicit side', () => {
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { branches: [{ child: 'x1', side: 'right' }] }, x1: {} },
    )
    const spans = { a: [400, 450], x1: [300, 350] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    expect(lane.get(lineOfTask.get('x1'))).toBe(1)
  })

  it('reuses a lane for two branches whose extents never overlap', () => {
    // a forks x1, low down the trunk; c, further up, forks x2. Neither reaches the other, so
    // there is no height at which both are drawn and they should share lane -1.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
        b: { next: 'c', branches: [] },
        c: { branches: [{ child: 'x2', side: 'left' }] },
        x1: {}, x2: {},
      },
    )
    // Pixels: the separation the row grid derived from the two branch points is stated here as two
    // disjoint spans, since that is the whole of what the packer consults.
    const spans = { a: [400, 450], b: [250, 300], c: [100, 150], x1: [380, 430], x2: [80, 130] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1)
    expect(lane.get(lineOfTask.get('x2'))).toBe(-1)
  })

  it('does not reuse a lane for two branches whose extents do overlap', () => {
    // Both x1 and x2 fork off the same task a, so both are drawn beside the same stretch of
    // trunk and would collide if given the same lane.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1', side: 'left' }, { child: 'x2', side: 'left' }] },
        x1: { next: 'x1b' }, x1b: {},
        x2: {},
      },
    )
    // x1's line runs on above its foot, so it spans [30, 350] against x2's single card at
    // [300, 350]: the two overlap, which is the collision the packer has to avoid.
    const spans = { a: [400, 450], x1: [300, 350], x1b: [30, 80], x2: [300, 350] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    expect(lane.get(lineOfTask.get('x1'))).not.toBe(lane.get(lineOfTask.get('x2')))
  })

  it('orders a side by the stored arrays, the line read from the top down', () => {
    // The trunk runs a, b, c, d. c holds two left branches, p and then q, and a holds
    // one, r, which is three cards tall so that its extent overlaps theirs and the packer
    // cannot fold them onto one lane. p and q are bubbles on c's edge and r returns to
    // that same edge from further down, stretching the trunk as it goes.
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
    // Pixels: how far r's return lifts d was assignRows' claim, and the solve carries it now,
    // where the solveHeights block holds it against a bare trunk. All the packer needs of it is
    // that r's line reaches up alongside p and q, which the spans state outright: r's [180, 430]
    // runs into their [150, 200].
    const spans = {
      a: [400, 450], b: [300, 350], c: [200, 250], d: [100, 150],
      p: [150, 200], q: [150, 200],
      r: [380, 430], r2: [280, 330], r3: [180, 230],
    }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    const l = (id) => lane.get(lineOfTask.get(id))
    expect(l('p')).toBe(-1) // c is the higher branch point, and p is first in its array
    expect(l('q')).toBe(-2)
    expect(l('r')).toBe(-3) // a is read last, so its branch takes the outermost lane
    expect(l('r3')).toBe(l('r')) // r3 rides r's own line
  })
})

describe('assignLanes — lane order and band reservation', () => {
  // The Wide tree: trunk alpha->bravo->charlie->delta; charlie forks left=one,
  // right=two; delta forks left=apple, right=banana; two continues up to wonder.
  // Every fork rises from its holder, so charlie's children are drawn beside the top of
  // charlie's own edge and delta's beside delta. Two's line runs on up to wonder, past where
  // banana sits, so the two of them cannot share a lane and one is inner.
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
    // Pixels: each fork's card sits beside the edge rising from its holder, so one and two are
    // given the span above charlie and apple and banana the span above delta. Wonder carries two's
    // line up into banana's span, which is the one overlap the packer has to open a lane for.
    const spans = {
      alpha: [400, 450], bravo: [300, 350], charlie: [200, 250], delta: [100, 150],
      one: [150, 200], two: [150, 200], wonder: [50, 100],
      apple: [50, 100], banana: [50, 100],
    }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    const l = (id) => lane.get(lineOfTask.get(id))
    // right side: banana (off delta, the higher of the two branch points, so read first)
    // inner, two (off charlie, read after it) outer
    expect(l('banana')).toBeGreaterThan(0)
    expect(l('two')).toBeGreaterThan(0)
    expect(l('banana')).toBeLessThan(l('two'))
    // left side: one and apple are never drawn at the same height, so they pack onto one lane
    expect(l('one')).toBe(l('apple'))
    expect(l('one')).toBeLessThan(0)
    // wonder rides two's line
    expect(l('wonder')).toBe(l('two'))
  })

  it('reserves a band for a nested subtree so an inner sub-branch cannot collide', () => {
    // b (right branch of the trunk) has its own right sub-branch s; b's line is three cards
    // tall, so it overlaps a sibling c drawn halfway up it. b's band must be wide
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
    // Pixels: c is given the very span s has, since the collision the reserved band prevents is
    // between those two, and b's line is given a span running the length of both.
    const spans = {
      a: [400, 450], a2: [300, 350],
      b: [380, 430], b2: [280, 330], b3: [180, 230],
      s: [280, 330], c: [280, 330],
    }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    const l = (id) => lane.get(lineOfTask.get(id))
    // All three are right-side branches.
    expect(l('b')).toBeGreaterThan(0)
    expect(l('s')).toBeGreaterThan(0)
    expect(l('c')).toBeGreaterThan(0)
    // b's subtree spreads b and s onto distinct lanes (a reserved band, not one lane).
    expect(l('s')).not.toBe(l('b'))
    // c and s are drawn at the same height on the right; without the reserved band they would
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
  baseY: 0, anchorGap: 10, minAir: 20, departClear: 10, arriveClear: 10, dotRadius: 6,
  tan12: TAN12, rampRun: 100, rise: 200 * TAN12, junctionMargin: 4, diamondGap: 12,
  foldSeam: 22,
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

    // Pixels: the row grid opened every plan at row 0, which the solve spells as the base itself.
    // Nothing constrains a root from below, so it keeps the height the topological order starts at.
    expect(cardTopY.get('a')).toBe(METRICS.baseY)
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

  it('places a branch foot off a holder with no successor of its own', () => {
    // Pixels: a branch array names the edge rising from the node holding it, and that edge is
    // there whether or not the node has a .next. The row grid stated this as a row above the
    // holder; the solve states it as the one lateral, since b is the top of the trunk and nothing
    // else hangs on the edge the branch leaves.
    const model = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      { a: { next: 'b' }, b: { branches: [{ child: 'x', side: 'left' }] }, x: {} },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], x: [188, 50] })
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    expect(cardTopY.get('x')).toBeLessThan(cardTopY.get('b')) // above the node it leaves
    const departure = circle(cardTopY.get('b')) - METRICS.departClear
    const arrival = bottom(cardTopY.get('x'), 50) + METRICS.arriveClear
    expect(departure - arrival).toBeCloseTo(METRICS.rise, 9)
  })

  it('gives an edge that carries a junction more air than a plain one, so the line clears the card', () => {
    const plain = fakeModel([{ id: 't', rootTaskId: 'a' }], { a: { next: 'b' }, b: { next: 'c' }, c: {} })
    // The branch leaves a and merges at b, so the edge from a to b hosts a fork and nothing else,
    // and the edge from b to c receives that fork's return and nothing else. One edge for each case.
    const forked = fakeModel(
      [{ id: 't', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'f', side: 'left' }] }, b: { next: 'c' }, c: {}, f: { mergePoint: 'b' } },
    )
    const sizes = sizesOf({ a: [188, 50], b: [188, 50], c: [188, 50], f: [188, 50] })
    const airOf = (model, id) => solveHeights(model, sizes, METRICS).airBelow.get(id)

    expect(airOf(plain, 'b')).toBeCloseTo(METRICS.minAir, 9)
    // A fork's line climbs (cardW / 2) * tan12 while it crosses b's own half-width, so b's card has
    // to be that much further up or the line would pass behind it and re-emerge past its corner.
    expect(airOf(forked, 'b')).toBeCloseTo(METRICS.departClear + 94 * TAN12 + METRICS.junctionMargin, 9)
    // A return's line descends by the same amount as it leaves, and what it meets down there is
    // the rim of b's circle rather than a card edge, so that clearance carries the dot's radius too.
    expect(airOf(forked, 'c')).toBeCloseTo(METRICS.arriveClear + 94 * TAN12 + METRICS.dotRadius + METRICS.junctionMargin, 9)
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

  it('stretches the trunk above a merge point, and moves nothing at or below the branch point', () => {
    // The branch leaves a's edge and its return lands on the edge rising from b, so c, the node
    // above that edge, has to clear the branch's tip rather than the return line dropping to reach
    // it. Below the fork the solve is the bare trunk's own, which is what keeps a plan from
    // shifting under its author as a branch grows above it.
    //
    // Pixels: the row grid counted the stretch, four rows where the bare trunk had two, and a
    // pixel solve has no such number to state. What survives is the comparison itself, that the
    // span above the merge point opens whilst z and a hold their ground.
    const trunk = { z: { next: 'a' }, b: { next: 'c' }, c: {} }
    const bare = fakeModel([{ id: 't', rootTaskId: 'z' }], { ...trunk, a: { next: 'b' } })
    const model = fakeModel([{ id: 't', rootTaskId: 'z' }], {
      ...trunk,
      a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
      x1: { next: 'x2' }, x2: { next: 'x3' }, x3: { mergePoint: 'b' },
    })
    const sizes = sizesOf({
      z: [188, 50], a: [188, 50], b: [188, 50], c: [188, 50],
      x1: [188, 50], x2: [188, 50], x3: [188, 50],
    })
    const bareY = solveHeights(bare, sizes, METRICS).cardTopY
    const { cardTopY } = solveHeights(model, sizes, METRICS)

    expect(cardTopY.get('c')).toBeLessThan(bareY.get('c')) // risen to clear the branch's tip
    expect(cardTopY.get('z')).toBe(bareY.get('z'))
    expect(cardTopY.get('a')).toBe(bareY.get('a'))
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

  it('adds nothing for a bubble the edge already has room for, a height being a longest path', () => {
    // y is a bubble on a's edge, beside a branch of three cards on that same edge. Every
    // constraint is a lower bound and the solve takes the greatest rather than the sum, so the
    // taller strand settles the edge on its own and the bubble is free: no node moves for y, and
    // y's foot stands level with the tall branch's, each of them one lateral off a.
    const defs = {
      b: { next: 'c' }, c: {},
      x1: { next: 'x2' }, x2: { next: 'x3' }, x3: { mergePoint: 'a' },
    }
    const sizes = sizesOf({
      a: [188, 50], b: [188, 50], c: [188, 50],
      x1: [188, 50], x2: [188, 50], x3: [188, 50], y: [188, 50],
    })
    const solve = (nodeDefs) => solveHeights(fakeModel([{ id: 't', rootTaskId: 'a' }], nodeDefs), sizes, METRICS).cardTopY
    const tallOnly = solve({ ...defs, a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] } })
    const withBoth = solve({
      ...defs,
      a: { next: 'b', branches: [{ child: 'x1', side: 'left' }, { child: 'y', side: 'right' }] },
      y: { mergePoint: 'a' },
    })

    for (const id of ['a', 'b', 'c', 'x1', 'x2', 'x3']) {
      expect(withBoth.get(id)).toBe(tallOnly.get(id))
    }
    expect(withBoth.get('y')).toBeCloseTo(withBoth.get('x1'), 9) // the room for it was there already
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

describe('solveHeights — a folded scope, drawn shut', () => {
  // What the renderer hands the solve for a folded scope: the body is gone from the view and
  // the project node's successor is its own close (app.js pruneCollapsed). The pair is then
  // drawn with the two cards touching, so the project hull and the close's half turn cross
  // into a lens and a shut scope reads as one closed object.
  const folded = () => fakeModel([{ id: 't1', rootTaskId: 'P' }], {
    P: { kind: 'project', collapsed: true, next: 'T' },
    T: { kind: 'terminus', next: 'a' },
    a: {},
  })
  const SIZES = sizesOf({ P: [188, 58], T: [188, 40], a: [188, 50] })
  // What the seam needs at these two heights is 3 + 0.1424 * 98, about 16.9, so the metric's 22
  // is what governs here; the taller-card case below is the other way round.
  const seam = Math.max(METRICS.foldSeam, hullSeamToClose(58, 40))

  it('sits the close on its project card, the two overlapping by the seam', () => {
    const { cardTopY, airBelow } = solveHeights(folded(), SIZES, METRICS)
    expect(cardTopY.get('P')).toBe(METRICS.baseY)
    expect(seam).toBe(METRICS.foldSeam)
    // No anchorGap and no air: the close's own bottom sits `seam` BELOW the project's own top,
    // which is what shuts the seam where the two silhouettes cross.
    expect(cardTopY.get('T') + 40).toBe(cardTopY.get('P') + seam)
    // The air it reports is negative by the anchorGap and the seam together, because the
    // project's circle sits inside the close's card and is covered by it. Stated so a reader of
    // a layout can tell a deliberate overlap from a defect.
    expect(airBelow.get('T')).toBe(-(METRICS.anchorGap + seam))
  })

  it('takes more than the metric where a taller project card needs it', () => {
    // The hull's edges bow away from the seam in proportion to their own card's height, so a
    // tall project card would reopen a lens at a fixed overlap. 90 by 40 needs 21.5... and 22
    // still covers it; 120 by 58 does not, so the pair takes what it needs.
    const tall = sizesOf({ P: [188, 120], T: [188, 58], a: [188, 50] })
    const need = hullSeamToClose(120, 58)
    expect(need).toBeGreaterThan(METRICS.foldSeam)
    const { cardTopY } = solveHeights(folded(), tall, METRICS)
    expect(cardTopY.get('T') + 58).toBeCloseTo(cardTopY.get('P') + need, 9)
  })

  it('leaves the trunk above the fold at the ordinary minimum', () => {
    const { cardTopY } = solveHeights(folded(), SIZES, METRICS)
    expect(cardTopY.get('a')).toBe(cardTopY.get('T') - (METRICS.anchorGap + METRICS.minAir + 50))
  })

  it('gives an unfolded pair the ordinary minimum, the fold being the only exception', () => {
    const open = fakeModel([{ id: 't1', rootTaskId: 'P' }], {
      P: { kind: 'project', next: 'T' },
      T: { kind: 'terminus', next: 'a' },
      a: {},
    })
    const { cardTopY, airBelow } = solveHeights(open, SIZES, METRICS)
    expect(cardTopY.get('T')).toBe(cardTopY.get('P') - (METRICS.anchorGap + METRICS.minAir + 40))
    expect(airBelow.get('T')).toBe(METRICS.minAir)
  })

  it('does not read the mark on a task, nor on a project whose successor is not its close', () => {
    // `collapsed` on anything but a project node closed by the very next node means nothing:
    // the flush case exists for a pair drawn shut, and nothing else may lose its air.
    const odd = fakeModel([{ id: 't1', rootTaskId: 'P' }], {
      P: { kind: 'project', collapsed: true, next: 'b' },
      b: { kind: 'task', collapsed: true, next: 'T' },
      T: { kind: 'terminus' },
    })
    const { airBelow } = solveHeights(odd, sizesOf({ P: [188, 58], b: [188, 50], T: [188, 40] }), METRICS)
    expect(airBelow.get('b')).toBe(METRICS.minAir)
    expect(airBelow.get('T')).toBe(METRICS.minAir)
  })
})

describe('assignLanes — extents in pixels', () => {
  // The packer only ever asks whether two lines' extents overlap, so an extent is an interval and
  // nothing besides. These two tests state one model twice, changing only where the extents fall,
  // and so pin the packer either side of the boundary between overlap and none.
  const twoBranches = () => fakeModel(
    [{ id: 't', rootTaskId: 'a' }],
    {
      a: { next: 'b', branches: [{ child: 'f', side: 'left' }] },
      b: { next: 'c' }, c: { next: 'd' }, d: { branches: [{ child: 'g', side: 'left' }] },
      f: { mergePoint: 'a' }, g: { mergePoint: 'd' },
    },
  )

  it('shares a lane between two lines whose pixel extents do not overlap', () => {
    const model = twoBranches()
    // f sits low, g sits high, and neither reaches the other: one lane serves both.
    const spans = { a: [0, 300], b: [0, 300], c: [0, 300], d: [0, 300], f: [200, 300], g: [0, 100] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    expect(lane.get(lineOfTask.get('f'))).toBe(-1)
    expect(lane.get(lineOfTask.get('g'))).toBe(-1)
  })

  it('pushes the second line outward when their pixel extents do overlap', () => {
    const model = twoBranches()
    const spans = { a: [0, 300], b: [0, 300], c: [0, 300], d: [0, 300], f: [100, 250], g: [90, 240] }
    const { lane, lineOfTask } = assignLanes(model, extentsFrom(spans))
    const lanes = [lane.get(lineOfTask.get('f')), lane.get(lineOfTask.get('g'))].sort((x, y) => y - x)
    expect(lanes).toEqual([-1, -2])
  })
})
