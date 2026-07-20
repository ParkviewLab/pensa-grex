// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from '../model/fixtures/homelab.forest.json5?raw'
import { buildForest } from '../model/forest.js'
import { computeForestLayout } from './layout.js'
import { validateForest } from '../model/validate.js'
import * as M from '../model/mutations.js'

// Synthetic, deterministic sizes standing in for layout/measure.js's real DOM
// measurement — layout.js is pure and must not need a DOM to be exercised.
function syntheticSizes(forest) {
  const sizes = new Map()
  for (const [id, task] of forest.tasks) {
    const lines = task.here ? 3 : task.title.length > 18 ? 2 : 2
    sizes.set(id, { cardW: 138, cardH: task.here ? 68 : 30 + lines * 12 })
  }
  return { sizes }
}

function loadFixtureLayout() {
  const raw = JSON5.parse(fixtureRaw)
  const forest = buildForest(raw)
  const { sizes } = syntheticSizes(forest)
  return { forest, layout: computeForestLayout(forest, sizes) }
}

function rectOf(station) {
  return { left: station.x - station.cardW / 2, right: station.x + station.cardW / 2, top: station.cardTop, bottom: station.cardTop + station.cardH }
}
function overlaps(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
}

describe('computeForestLayout — the HomeLab fixture', () => {
  it('places every station with finite, positive coordinates inside finite bounds', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.stations).toHaveLength(18) // 15 tasks + 3 project-node roots
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
    expect(Number.isFinite(layout.bounds.h)).toBe(true)
    for (const s of layout.stations) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.cardTop)).toBe(true)
      expect(s.x).toBeGreaterThan(0)
      expect(s.cardTop).toBeGreaterThan(0)
    }
  })

  it('never overlaps two station cards, anywhere in the forest', () => {
    const { layout } = loadFixtureLayout()
    const rects = layout.stations.map(rectOf)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })

  it('grows upward: a task deeper down its stack sits below (larger cardTop than) its successor', () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    expect(byId.get('k_nas').cardTop).toBeGreaterThan(byId.get('k_migrate').cardTop)
    expect(byId.get('k_migrate').cardTop).toBeGreaterThan(byId.get('k_backups').cardTop)
    expect(byId.get('k_backups').cardTop).toBeGreaterThan(byId.get('k_restore').cardTop)
  })

  it('puts exactly one cursor (sputnik) per tree, matching each tree\'s "here" task', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.cursors).toHaveLength(3)
    const cursorIds = layout.stations.filter((s) => s.cursor).map((s) => s.id).sort()
    expect(cursorIds).toEqual(['k_firewall', 'k_migrate', 'k_zigbee'])
  })

  it('draws one junction per fork, three total', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.junctions).toHaveLength(3) // k_migrate (2 branches, 1 junction), k_vlan-equivalent k_zigbee, and k_zigbee has 1
  })

  it('places each junction strictly between the two real cards it connects', () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    // k_migrate forks; its junction must sit below k_backups's card (the
    // main-line successor, "upper") and above k_migrate's own card ("lower").
    const migrate = byId.get('k_migrate'), backups = byId.get('k_backups')
    // find the junction at k_migrate's x (there's exactly one fork at that x)
    const j = layout.junctions.find((jn) => Math.abs(jn.x - migrate.x) < 1)
    expect(j).toBeDefined()
    expect(j.y).toBeLessThan(migrate.cardTop) // above (smaller y than) the lower card's top
    expect(j.y).toBeGreaterThan(backups.cardTop + backups.cardH) // below (larger y than) the upper card's bottom
  })

  it('packs the three projects left to right without overlap', () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    // each project's root sits at a distinct x, left to right in rootOrder
    const xs = ['p_media', 'p_net', 'p_auto'].map((id) => byId.get(id).x)
    expect(new Set(xs).size).toBe(3)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
  })

  it('an oversized cursor card still collides with nothing', () => {
    const raw = JSON5.parse(fixtureRaw)
    const forest = buildForest(raw)
    const { sizes } = syntheticSizes(forest)
    sizes.set('k_migrate', { cardW: 138, cardH: 400 }) // a wildly tall "here" trapezium
    const layout = computeForestLayout(forest, sizes)
    const rects = layout.stations.map(rectOf)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })
})

describe('computeForestLayout — edge cases', () => {
  it('returns finite empty-forest bounds rather than NaN', () => {
    const emptyForest = { trees: [], tasks: new Map(), getTreeIdForTask: () => null }
    const layout = computeForestLayout(emptyForest, new Map())
    expect(layout.stations).toEqual([])
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
    expect(Number.isFinite(layout.bounds.h)).toBe(true)
  })

  it('lays out a single-task tree (root only) without error', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'Solo', rootTaskId: 'a' }],
      tasks: { a: { id: 'a', title: 'Alone', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null, note: null, here: false, next: null, branches: [] } },
    }
    const forest = buildForest(raw)
    const sizes = new Map([['a', { cardW: 138, cardH: 49 }]])
    const layout = computeForestLayout(forest, sizes)
    expect(layout.stations).toHaveLength(1)
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
  })

  // Regression: a fork "below" a bare root (no .next) once produced NaN junction
  // and branch-track coordinates. assignRows now rises such a child to row 1.
  it('lays out a below-branch on a bare root with finite coordinates', () => {
    const raw = {
      schema: 1, domain: 'D',
      trees: [{ id: 't1', name: 'Solo', rootTaskId: 'r' }],
      tasks: {
        r: { id: 'r', title: 'Root', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [{ child: 'b', side: 'left', at: 'below' }] },
        b: { id: 'b', title: 'Below', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
      },
    }
    const forest = buildForest(raw)
    const sizes = new Map([['r', { cardW: 138, cardH: 49 }], ['b', { cardW: 138, cardH: 49 }]])
    const layout = computeForestLayout(forest, sizes)
    for (const j of layout.junctions) {
      expect(Number.isFinite(j.x)).toBe(true)
      expect(Number.isFinite(j.y)).toBe(true)
    }
    for (const t of layout.tracks) {
      for (const [x, y] of t.points) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
      }
    }
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
    expect(Number.isFinite(layout.bounds.h)).toBe(true)
  })
})

// --- non-crossing branches and tip-fork connectivity -------------------------

function mkTask(id, over = {}) {
  return {
    id, title: id, status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, here: false, next: null, branches: [], ...over,
  }
}

function layoutOf(raw) {
  const forest = buildForest(raw)
  const { sizes } = syntheticSizes(forest)
  return computeForestLayout(forest, sizes)
}

// All track segments (risers, L-connectors, and the new tip-fork stubs).
function segments(layout) {
  const segs = []
  for (const t of layout.tracks) {
    for (let i = 1; i < t.points.length; i++) segs.push([t.points[i - 1], t.points[i]])
  }
  return segs
}

// A near-zero determinant means c is on line ab (collinear / a T-junction where
// one segment's endpoint lands on the other). Threshold before Math.sign so
// floating-point non-associativity (~1 ULP) does not read an exact touch as a
// sign change; real crossings are orders of magnitude clear of the epsilon.
const orient = (a, b, c) => {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  return Math.abs(v) < 1e-6 ? 0 : Math.sign(v)
}
// A "proper" crossing: the segments intersect at a point interior to both.
// Shared endpoints (junctions, anchors) and collinear touches yield a zero
// orientation and are not counted — those are legitimate joins, not crossings.
function properlyCross(s1, s2) {
  const [a, b] = s1, [c, d] = s2
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
}
function countCrossings(layout) {
  const segs = segments(layout)
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (properlyCross(segs[i], segs[j])) n++
    }
  }
  return n
}

describe('computeForestLayout — non-crossing branches', () => {
  // The Wide tree: trunk Alpha->Bravo->Charlie->Delta; Charlie forks below to
  // One (left) and Two (right); Delta forks below to Apple (left) and Banana
  // (right); Two continues up to Wonder. Adding Wonder used to push Banana into
  // a lane whose connector crossed Two's line.
  const wide = {
    schema: 1, domain: 'W', trees: [{ id: 't', name: 'Wide', rootTaskId: 'alpha' }],
    tasks: {
      alpha: mkTask('alpha', { next: 'bravo' }),
      bravo: mkTask('bravo', { next: 'charlie' }),
      charlie: mkTask('charlie', { next: 'delta', branches: [{ child: 'one', side: 'left', at: 'below' }, { child: 'two', side: 'right', at: 'below' }] }),
      delta: mkTask('delta', { branches: [{ child: 'apple', side: 'left', at: 'below' }, { child: 'banana', side: 'right', at: 'below' }] }),
      one: mkTask('one'), two: mkTask('two', { next: 'wonder' }), wonder: mkTask('wonder'),
      apple: mkTask('apple'), banana: mkTask('banana'),
    },
  }

  it('draws the Wide tree with no branch crossing', () => {
    expect(countCrossings(layoutOf(wide))).toBe(0)
  })

  it('draws the HomeLab fixture with no branch crossing', () => {
    expect(countCrossings(loadFixtureLayout().layout)).toBe(0)
  })

  it('draws a deep both-sides nest with no crossing', () => {
    // a spine with nested sub-branches on both sides at overlapping rows
    const deep = {
      schema: 1, domain: 'D', trees: [{ id: 't', name: 'Deep', rootTaskId: 'r' }],
      tasks: {
        r: mkTask('r', { next: 'r2', branches: [{ child: 'L', side: 'left', at: 'above' }, { child: 'R', side: 'right', at: 'above' }] }),
        r2: mkTask('r2', { branches: [{ child: 'L2', side: 'left', at: 'above' }, { child: 'R2', side: 'right', at: 'above' }] }),
        L: mkTask('L', { next: 'La', branches: [{ child: 'Lb', side: 'left', at: 'above' }] }), La: mkTask('La'), Lb: mkTask('Lb'),
        R: mkTask('R', { next: 'Ra', branches: [{ child: 'Rb', side: 'right', at: 'above' }] }), Ra: mkTask('Ra'), Rb: mkTask('Rb'),
        L2: mkTask('L2'), R2: mkTask('R2'),
      },
    }
    expect(countCrossings(layoutOf(deep))).toBe(0)
  })
})

// Drag-and-drop rearranges the forest through the pure move mutations; the layout
// must stay drawable (valid, no overlaps, no branch crossings) after each. These
// exercise the four moves against the real HomeLab fixture.
describe('computeForestLayout — after drag-and-drop moves', () => {
  const fresh = () => JSON5.parse(fixtureRaw)
  function drawable(raw) {
    expect(validateForest(raw)).toEqual({ ok: true, errors: [] })
    const forest = buildForest(raw)
    const layout = computeForestLayout(forest, syntheticSizes(forest).sizes)
    expect(countCrossings(layout)).toBe(0)
    const rects = layout.stations.map(rectOf)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
    }
  }

  it('stays drawable after moving a task node onto a sibling', () => {
    drawable(M.moveTaskNode(fresh(), 'k_restore', 'k_nas'))
  })

  it('stays drawable after grafting a whole tree as a sub-project', () => {
    drawable(M.moveSubtree(fresh(), 'p_net', 'k_nas'))
  })

  it('stays drawable after detaching a converted sub-project into its own tree', () => {
    drawable(M.detachToTree(M.convertKind(fresh(), 'k_migrate'), 'k_migrate'))
  })

  it('stays drawable after reordering a root', () => {
    drawable(M.reorderRoot(fresh(), 'p_auto', 0))
  })
})

describe('computeForestLayout — tip-fork connector', () => {
  // The Move tree: Alpha (root) -> Beta (the tip of the main line), and Beta
  // forks left to Gamma above it. Beta must be connected up to the fork junction.
  const move = {
    schema: 1, domain: 'M', trees: [{ id: 't', name: 'Move', rootTaskId: 'alpha' }],
    tasks: {
      alpha: mkTask('alpha', { next: 'beta' }),
      beta: mkTask('beta', { branches: [{ child: 'gamma', side: 'left', at: 'above' }] }),
      gamma: mkTask('gamma'),
    },
  }

  it('connects the tip parent up to its floating fork junction', () => {
    const layout = layoutOf(move)
    expect(layout.junctions).toHaveLength(1)
    const j = layout.junctions[0]
    const beta = layout.stations.find((s) => s.id === 'beta')
    // a vertical stub at the parent's x runs from Beta's anchor up to the junction y
    const stub = layout.tracks.find((t) =>
      t.points.length === 2 &&
      Math.abs(t.points[0][0] - beta.x) < 0.5 && Math.abs(t.points[1][0] - beta.x) < 0.5 &&
      (Math.abs(t.points[0][1] - beta.anchorY) < 0.5 || Math.abs(t.points[1][1] - beta.anchorY) < 0.5) &&
      (Math.abs(t.points[0][1] - j.y) < 0.5 || Math.abs(t.points[1][1] - j.y) < 0.5),
    )
    expect(stub).toBeTruthy()
    // and it is not a degenerate zero-length segment
    expect(Math.abs(stub.points[0][1] - stub.points[1][1])).toBeGreaterThan(0)
  })
})

describe('computeForestLayout — angled branch connectors', () => {
  // a is the trunk root (a -> b); a forks right to c, one row above. The branch
  // connector's flat leg tilts up to c's lane, then a short vertical riser into c,
  // while the junction diamond stays put at [a.x, junctionY].
  const tilt = {
    schema: 1, domain: 'T', trees: [{ id: 't', name: 'Tilt', rootTaskId: 'a' }],
    tasks: {
      a: mkTask('a', { next: 'b', branches: [{ child: 'c', side: 'right', at: 'above' }] }),
      b: mkTask('b'),
      c: mkTask('c'),
    },
  }

  it('lifts the elbow to angle the leg up (<=12 deg), keeping the diamond and a vertical riser', () => {
    const layout = layoutOf(tilt)
    const j = layout.junctions[0]
    const a = layout.stations.find((s) => s.id === 'a')
    const c = layout.stations.find((s) => s.id === 'c')
    const conn = layout.tracks.find((t) => t.points.length === 3) // the branch connector
    expect(conn).toBeTruthy()
    const [p0, p1, p2] = conn.points
    // starts at the diamond, ends at the branch anchor
    expect(Math.abs(p0[0] - a.x)).toBeLessThan(0.5)
    expect(Math.abs(p0[1] - j.y)).toBeLessThan(0.5)
    expect(Math.abs(p2[0] - c.x)).toBeLessThan(0.5)
    expect(Math.abs(p2[1] - c.anchorY)).toBeLessThan(0.5)
    // the elbow is at c's lane, lifted off junctionY toward the (higher) anchor,
    // but not past it — so a vertical riser remains
    expect(Math.abs(p1[0] - c.x)).toBeLessThan(0.5)
    expect(p2[1]).toBeLessThan(p0[1]) // above-branch: anchor is higher (smaller y)
    expect(p1[1]).toBeLessThan(p0[1]) // elbow lifted up from the junction
    expect(p1[1]).toBeGreaterThan(p2[1]) // but short of the anchor (riser preserved)
    // the flat leg is tilted and no steeper than 12 deg
    const run = Math.abs(p1[0] - p0[0])
    const rise = Math.abs(p1[1] - p0[1])
    expect(run).toBeGreaterThan(0)
    expect(rise).toBeGreaterThan(0)
    expect(rise / run).toBeLessThanOrEqual(Math.tan((12 * Math.PI) / 180) + 1e-6)
    // the last leg is a vertical riser, and the diamond did not move
    expect(Math.abs(p1[0] - p2[0])).toBeLessThan(0.5)
    expect(Math.abs(j.x - a.x)).toBeLessThan(0.5)
    expect(countCrossings(layout)).toBe(0)
  })

  it('gives every branch off one junction the same slope, however far out its lane', () => {
    // a forks right to three branches at increasing lanes; sharing one junction,
    // their legs must all leave it at the same angle (a single ray), not flatten
    // as the lane gets further out.
    const fan = {
      schema: 1, domain: 'F', trees: [{ id: 't', name: 'Fan', rootTaskId: 'a' }],
      tasks: {
        a: mkTask('a', { next: 'b', branches: [
          { child: 'c', side: 'right', at: 'above' },
          { child: 'd', side: 'right', at: 'above' },
          { child: 'e', side: 'right', at: 'above' },
        ] }),
        b: mkTask('b'), c: mkTask('c'), d: mkTask('d'), e: mkTask('e'),
      },
    }
    const layout = layoutOf(fan)
    const conns = layout.tracks.filter((t) => t.points.length === 3) // the three branch connectors
    expect(conns).toHaveLength(3)
    const tan12 = Math.tan((12 * Math.PI) / 180)
    const runs = conns.map((t) => Math.abs(t.points[1][0] - t.points[0][0]))
    for (const [p0, p1] of conns.map((t) => t.points)) {
      const slope = Math.abs(p1[1] - p0[1]) / Math.abs(p1[0] - p0[0])
      expect(slope).toBeCloseTo(tan12, 6)
    }
    // the lanes really are at increasing distances (so the slope test has teeth)
    expect(Math.max(...runs)).toBeGreaterThan(Math.min(...runs) + 1)
    expect(countCrossings(layout)).toBe(0)
  })
})
