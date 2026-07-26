// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { assignRows, junctionGaps, buildRowGrid, assignLanes } from './geometry.js'

// A minimal stand-in for the buildModel() runtime model (model/model.js),
// exposing only what geometry.js actually reads: .trees, .nodes and .getNode(id).
// A model node's .branches is [{ child, side }] — the record's two per-side
// arrays already flattened in left-then-right order — with no `at`: a branch
// array names the edge rising from the node that holds it.
function fakeModel(trees, nodeDefs) {
  const nodes = new Map(Object.entries(nodeDefs).map(([id, n]) => [
    id, { id, next: n.next || null, branches: n.branches || [], predecessorId: n.predecessorId ?? null },
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
    // different rows carry two junctions; a node with none carries no junction.
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

  it('alternates left (negative) then right (positive) by branch order when side is unset', () => {
    // A model from buildModel() always carries a side, since a fork lives in one
    // of the two per-side arrays; this pins geometry's own fallback for a branch
    // that reaches it without one.
    const model = fakeModel(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1' }, { child: 'x2' }, { child: 'x3' }] },
        x1: {}, x2: {}, x3: {},
      },
    )
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1) // 1st: left
    expect(lane.get(lineOfTask.get('x2'))).toBe(1) // 2nd: right
    expect(lane.get(lineOfTask.get('x3'))).toBe(-2) // 3rd: left, next free left slot
  })

  it('honours an explicit side over the alternation fallback', () => {
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
})

describe('assignLanes — non-crossing ordering', () => {
  // The Wide tree: trunk alpha->bravo->charlie->delta; charlie forks left=one,
  // right=two; delta forks left=apple, right=banana; two continues up to wonder.
  // Every fork rises from its holder, so charlie's children sit at row 3 and
  // delta's at row 4. Two's line spans rows 3-4 and overlaps banana's row 4. The
  // branch that attaches HIGHER (banana, at row 4 off delta) must sit INNER; the
  // lower-attaching two (row 3, off charlie) is pushed outer, so delta's
  // connector to banana no longer crosses two's lane.
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

  it('places the higher-attaching same-side branch inner', () => {
    const model = wide()
    const row = assignRows(model)
    const { lane, lineOfTask } = assignLanes(model, row)
    const l = (id) => lane.get(lineOfTask.get(id))
    // right side: banana (attaches at row 4, off delta) inner, two (row 3, off
    // charlie) outer
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
