// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import { assignRows, junctionGaps, buildRowGrid, assignLanes } from './geometry.js'

// A minimal stand-in for the buildForest() runtime model (model/forest.js),
// exposing only what geometry.js actually reads: .trees and .getTask(id).
function fakeForest(trees, taskDefs) {
  const tasks = new Map(Object.entries(taskDefs).map(([id, t]) => [
    id, { id, next: t.next || null, branches: t.branches || [], predecessorId: t.predecessorId ?? null },
  ]))
  return { trees, tasks, getTask: (id) => tasks.get(id) || null }
}

describe('assignRows', () => {
  it('puts every root at row 0 and increments by 1 down a main line', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b' }, b: { next: 'c' }, c: {} },
    )
    const row = assignRows(forest)
    expect(row.get('a')).toBe(0)
    expect(row.get('b')).toBe(1)
    expect(row.get('c')).toBe(2)
  })

  it('starts a branch level with its parent\'s .next for at:"above"', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left', at: 'above' }] }, b: {}, x: {} },
    )
    const row = assignRows(forest)
    expect(row.get('a')).toBe(0)
    expect(row.get('b')).toBe(1)
    expect(row.get('x')).toBe(1) // level with b, not with a
  })

  it('starts a branch level with its own parent for at:"below"', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [] }, b: { branches: [{ child: 'x', side: 'left', at: 'below' }] }, x: {} },
    )
    const row = assignRows(forest)
    expect(row.get('b')).toBe(1)
    expect(row.get('x')).toBe(1) // level with b itself, one gap lower than b.next would be
  })
})

describe('junctionGaps', () => {
  it('reports the lower row of the gap a fork attaches to', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left', at: 'above' }] }, b: {}, x: {} },
    )
    const row = assignRows(forest)
    expect(junctionGaps(forest, row)).toEqual(new Set([0]))
  })
})

describe('buildRowGrid', () => {
  it('spaces rows by the tallest card at the upper row, plus the gap', () => {
    const forest = fakeForest([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const row = assignRows(forest)
    const sizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 90 }]])
    const { cardTopY } = buildRowGrid(forest, row, sizes, { rowGap: 20, junctionExtra: 30, baseY: 1000 })
    expect(cardTopY.get(0)).toBe(1000)
    expect(cardTopY.get(1)).toBe(1000 - (90 + 20)) // b's own height drives the pitch up to it
  })

  it('widens a gap that carries a fork junction', () => {
    const withFork = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { next: 'b', branches: [{ child: 'x', side: 'left', at: 'above' }] }, b: {}, x: {} },
    )
    const withoutFork = fakeForest([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const sizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 50 }], ['x', { cardW: 138, cardH: 50 }]])
    const opts = { rowGap: 20, junctionExtra: 30, baseY: 0 }

    const forkGrid = buildRowGrid(withFork, assignRows(withFork), sizes, opts)
    const plainGrid = buildRowGrid(withoutFork, assignRows(withoutFork), sizes, opts)
    const forkPitch = forkGrid.cardTopY.get(0) - forkGrid.cardTopY.get(1)
    const plainPitch = plainGrid.cardTopY.get(0) - plainGrid.cardTopY.get(1)
    expect(forkPitch).toBe(plainPitch + 30)
  })

  it('a taller card at a row opens that row\'s pitch, never overlapping the row below', () => {
    const forest = fakeForest([{ id: 't1', rootTaskId: 'a' }], { a: { next: 'b' }, b: {} })
    const row = assignRows(forest)
    const tallSizes = new Map([['a', { cardW: 138, cardH: 50 }], ['b', { cardW: 138, cardH: 300 }]])
    const { cardTopY } = buildRowGrid(forest, row, tallSizes, { rowGap: 20, junctionExtra: 30, baseY: 0 })
    const bBottom = cardTopY.get(1) + 300
    expect(bBottom).toBeLessThanOrEqual(cardTopY.get(0) - 20)
  })
})

describe('assignLanes', () => {
  it('puts every tree\'s trunk at lane 0', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }, { id: 't2', rootTaskId: 'p' }],
      { a: {}, p: {} },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    expect(lane.get(lineOfTask.get('a'))).toBe(0)
    expect(lane.get(lineOfTask.get('p'))).toBe(0)
  })

  it('alternates left (negative) then right (positive) by branch order when side is unset', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1' }, { child: 'x2' }, { child: 'x3' }] },
        x1: {}, x2: {}, x3: {},
      },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1) // 1st: left
    expect(lane.get(lineOfTask.get('x2'))).toBe(1) // 2nd: right
    expect(lane.get(lineOfTask.get('x3'))).toBe(-2) // 3rd: left, next free left slot
  })

  it('honours an explicit side over the alternation fallback', () => {
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      { a: { branches: [{ child: 'x1', side: 'right' }] }, x1: {} },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(1)
  })

  it('reuses a lane for two branches whose rows never overlap', () => {
    // a forks x1 (a single-task branch, occupying only row 1); b (further up
    // the trunk) forks x2 (also a single-task branch, at row 3) — x1 and x2
    // never coexist in the same row, so they should share lane -1.
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'b', branches: [{ child: 'x1', side: 'left' }] },
        b: { next: 'c', branches: [] },
        c: { branches: [{ child: 'x2', side: 'left' }] },
        x1: {}, x2: {},
      },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    expect(lane.get(lineOfTask.get('x1'))).toBe(-1)
    expect(lane.get(lineOfTask.get('x2'))).toBe(-1)
  })

  it('does not reuse a lane for two branches whose rows do overlap', () => {
    // Both x1 and x2 fork off the same task a, so both start at row 1 and
    // would collide if given the same lane.
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { branches: [{ child: 'x1', side: 'left' }, { child: 'x2', side: 'left' }] },
        x1: { next: 'x1b' }, x1b: {},
        x2: {},
      },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    expect(lane.get(lineOfTask.get('x1'))).not.toBe(lane.get(lineOfTask.get('x2')))
  })
})

describe('assignLanes — non-crossing ordering', () => {
  // The Wide tree: trunk alpha->bravo->charlie->delta; charlie forks left=one,
  // right=two; delta forks left=apple, right=banana; two continues up to wonder.
  // Two's line now spans rows 2-3 and overlaps banana's row 3. The branch that
  // attaches HIGHER (banana, off delta/row3) must sit INNER; the lower-attaching
  // two (off charlie/row2) is pushed outer, so delta's connector to banana no
  // longer crosses two's lane.
  function wide() {
    return fakeForest(
      [{ id: 't1', rootTaskId: 'alpha' }],
      {
        alpha: { next: 'bravo' },
        bravo: { next: 'charlie' },
        charlie: { next: 'delta', branches: [{ child: 'one', side: 'left', at: 'below' }, { child: 'two', side: 'right', at: 'below' }] },
        delta: { branches: [{ child: 'apple', side: 'left', at: 'below' }, { child: 'banana', side: 'right', at: 'below' }] },
        one: {}, two: { next: 'wonder' }, wonder: {}, apple: {}, banana: {},
      },
    )
  }

  it('places the higher-attaching same-side branch inner', () => {
    const forest = wide()
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
    const l = (id) => lane.get(lineOfTask.get(id))
    // right side: banana (attaches at delta/row3) inner, two (charlie/row2) outer
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
    // spans rows 2-4 so it overlaps a sibling c at row 3. b's band must be wide
    // enough for s, and c must sit outside the whole band.
    const forest = fakeForest(
      [{ id: 't1', rootTaskId: 'a' }],
      {
        a: { next: 'a2', branches: [{ child: 'b', side: 'right', at: 'above' }] },
        a2: { branches: [{ child: 'c', side: 'right', at: 'above' }] },
        b: { next: 'b2', branches: [{ child: 's', side: 'right', at: 'above' }] },
        b2: { next: 'b3' }, b3: {}, s: {}, c: {},
      },
    )
    const row = assignRows(forest)
    const { lane, lineOfTask } = assignLanes(forest, row)
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
