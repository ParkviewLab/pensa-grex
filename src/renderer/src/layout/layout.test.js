// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from '../../../shared/model/fixtures/homelab.record.json?raw'
import { buildModel } from '../../../shared/model/model.js'
import { computeDomainLayout } from './layout.js'
import { validateRecord } from '../../../shared/model/validate.js'
import * as M from '../../../shared/model/mutations.js'

// Synthetic, deterministic sizes standing in for layout/measure.js's real DOM
// measurement — layout.js is pure and must not need a DOM to be exercised.
function syntheticSizes(model) {
  const sizes = new Map()
  for (const [id, node] of model.nodes) {
    // A terminus carries no title, so there is no text to wrap: it renders as a
    // short bar (style.css .card.terminus{width:64px;height:10px}).
    if (node.kind === 'terminus') {
      sizes.set(id, { cardW: 64, cardH: 10 })
      continue
    }
    const lines = node.here ? 3 : node.title.length > 18 ? 2 : 2
    sizes.set(id, { cardW: 188, cardH: node.here ? 68 : 30 + lines * 12 })
  }
  return { sizes }
}

function loadFixtureLayout() {
  const record = JSON5.parse(fixtureRaw)
  const model = buildModel(record)
  const { sizes } = syntheticSizes(model)
  return { model, layout: computeDomainLayout(model, sizes) }
}

function rectOf(station) {
  return { left: station.x - station.cardW / 2, right: station.x + station.cardW / 2, top: station.cardTop, bottom: station.cardTop + station.cardH }
}
function overlaps(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
}

describe('computeDomainLayout — the HomeLab fixture', () => {
  it('places every station with finite, positive coordinates inside finite bounds', () => {
    const { layout } = loadFixtureLayout()
    // Termini: was 18 (15 tasks + 3 project-node roots). Every project node is now
    // closed by a terminus, and a terminus is a station like any other, so the three
    // plans' closes are drawn too.
    expect(layout.stations).toHaveLength(21) // 15 tasks + 3 project-node roots + their 3 termini
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
    expect(Number.isFinite(layout.bounds.h)).toBe(true)
    for (const s of layout.stations) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.cardTop)).toBe(true)
      expect(s.x).toBeGreaterThan(0)
      expect(s.cardTop).toBeGreaterThan(0)
    }
  })

  it('never overlaps two station cards, anywhere in the model', () => {
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
    // and the plan's closing terminus tops the trunk, above the last task on it
    expect(byId.get('k_restore').cardTop).toBeGreaterThan(byId.get('t_media').cardTop)
  })

  it('puts exactly one cursor (sputnik) per tree, matching each tree\'s "here" task', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.cursors).toHaveLength(3)
    const cursorIds = layout.stations.filter((s) => s.cursor).map((s) => s.id).sort()
    expect(cursorIds).toEqual(['k_firewall', 'k_migrate', 'k_zigbee'])
  })

  it('draws one junction per fork, three total', () => {
    const { layout } = loadFixtureLayout()
    // Three forking nodes: k_migrate (2 branches sharing 1 junction), k_vlan (1),
    // k_zigbee (1).
    expect(layout.junctions).toHaveLength(3)
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
    // each project's root sits at a distinct x, left to right in planOrder
    const xs = ['p_media', 'p_net', 'p_auto'].map((id) => byId.get(id).x)
    expect(new Set(xs).size).toBe(3)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
  })

  it('an oversized cursor card still collides with nothing', () => {
    const record = JSON5.parse(fixtureRaw)
    const model = buildModel(record)
    const { sizes } = syntheticSizes(model)
    sizes.set('k_migrate', { cardW: 138, cardH: 400 }) // a wildly tall "here" trapezium
    const layout = computeDomainLayout(model, sizes)
    const rects = layout.stations.map(rectOf)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })
})

describe('computeDomainLayout — edge cases', () => {
  it('returns finite empty-model bounds rather than NaN', () => {
    const emptyModel = { trees: [], nodes: new Map(), getTreeIdForTask: () => null }
    const layout = computeDomainLayout(emptyModel, new Map())
    expect(layout.stations).toEqual([])
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
    expect(Number.isFinite(layout.bounds.h)).toBe(true)
  })

  // Schema 3: a root has no incoming edge and must be a project node, so the
  // smallest tree there is is one project root on its own.
  //
  // Termini: that root must now be closed by a terminus above it on its trunk, so
  // the smallest tree is a base and its close — the empty plan every plan begins
  // as — and it draws TWO stations, not one. The case is the same one (a tree with
  // no task in it at all); only its floor has risen by one node.
  it('lays out an empty plan (base and its close) without error', () => {
    const record = {
      schemaVersion: 3, id: 'd_solo000000', title: 'D', planOrder: ['a'],
      nodes: {
        a: { id: 'a', title: 'Solo', kind: 'project', createdAt: '2026-01-01T00:00:00Z', note: null, flagged: false, next: 'z', leftBranches: [], rightBranches: [] },
        z: { id: 'z', kind: 'terminus', createdAt: '2026-01-01T00:00:00Z', note: null, next: null, leftBranches: [], rightBranches: [] },
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const sizes = new Map([['a', { cardW: 138, cardH: 49 }], ['z', { cardW: 64, cardH: 10 }]])
    const layout = computeDomainLayout(model, sizes)
    expect(layout.stations).toHaveLength(2)
    expect(Number.isFinite(layout.bounds.w)).toBe(true)
  })

  // Regression: a fork whose upper node is absent — the parent is a bare tip, so
  // the junction has no card above it — once produced NaN junction and branch-track
  // coordinates. assignRows now rises such a child to the next row.
  //
  // Schema 3: this case was written as a fork "below" the root. A root has no
  // trunk edge below it, so geometry.js already drew that fork in the gap ABOVE
  // it — the only gap a branch array can name now — and the migration leaves such
  // a fork on the root.
  //
  // Termini: the fork was on a BARE root (.next null). A project node must now be
  // closed by a terminus above it on its trunk, so no root is ever bare and the
  // scenario cannot be spelled there. It survives one row up, on the branch line:
  // b is a tip (nothing above it but its own fork to c), which is exactly the
  // absent-upper-node gap the regression is about.
  it('lays out a fork on a bare tip with finite coordinates', () => {
    const record = {
      schemaVersion: 3, id: 'd_solo000000', title: 'D', planOrder: ['r'],
      nodes: {
        r: { id: 'r', title: 'Root', kind: 'project', createdAt: 'x', note: null, flagged: false, next: 'z', leftBranches: ['b'], rightBranches: [] },
        z: { id: 'z', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] },
        b: { id: 'b', title: 'Branch', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, leftBranches: ['c'], rightBranches: [] },
        c: { id: 'c', title: 'Twig', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, leftBranches: [], rightBranches: [] },
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const sizes = new Map([
      ['r', { cardW: 138, cardH: 49 }], ['z', { cardW: 64, cardH: 10 }],
      ['b', { cardW: 138, cardH: 49 }], ['c', { cardW: 138, cardH: 49 }],
    ])
    const layout = computeDomainLayout(model, sizes)
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
    id, title: id, kind: 'task', status: 'todo', createdAt: '2026-01-01T00:00:00Z', completedAt: null,
    note: null, flagged: false, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
  }
}
// A tree's root: a project node, which carries no status, completedAt or here,
// and whose title is the tree's name.
function mkProject(id, over = {}) {
  return {
    id, title: id, kind: 'project', createdAt: '2026-01-01T00:00:00Z',
    note: null, flagged: false, next: null, leftBranches: [], rightBranches: [], ...over,
  }
}
// A scope's close, which says nothing of its own: no title, no status, no flag, no
// "here". Every project node below needs one, or validateRecord refuses the record.
function mkTerminus(id, over = {}) {
  return {
    id, kind: 'terminus', createdAt: '2026-01-01T00:00:00Z',
    note: null, next: null, leftBranches: [], rightBranches: [], ...over,
  }
}

function layoutOf(record) {
  // Termini: these fixtures are now hand-balanced (every project node closed by a
  // terminus above it on its trunk), so validate them here — an unbalanced fixture
  // would otherwise be laid out happily and prove nothing about a legal domain.
  expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
  const model = buildModel(record)
  const { sizes } = syntheticSizes(model)
  return computeDomainLayout(model, sizes)
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

describe('computeDomainLayout — non-crossing branches', () => {
  // The Wide tree: trunk Alpha->Bravo->Charlie->Delta; Bravo forks to One (left)
  // and Two (right), which therefore start level with Charlie; Charlie forks to
  // Apple (left) and Banana (right), level with Delta; Two continues up to Wonder.
  // Adding Wonder used to push Banana into a lane whose connector crossed Two's
  // line.
  //
  // Schema 3: these were Charlie's and Delta's at:'below' forks. A below-fork on X
  // names the edge whose upper node is X, i.e. the one rising from X's main-line
  // predecessor, so the migration moves each fork one node down the trunk. The
  // drawing is the same one: the same junction gap, the same rows for the children.
  //
  // Termini: alpha, the plan's base, is closed by omega above Delta, the top of its
  // trunk — the same trunk, one card longer.
  const wide = {
    schemaVersion: 3, id: 'd_wide000000', title: 'W', planOrder: ['alpha'],
    nodes: {
      alpha: mkProject('alpha', { next: 'bravo' }),
      bravo: mkTask('bravo', { next: 'charlie', leftBranches: ['one'], rightBranches: ['two'] }),
      charlie: mkTask('charlie', { next: 'delta', leftBranches: ['apple'], rightBranches: ['banana'] }),
      delta: mkTask('delta', { next: 'omega' }),
      omega: mkTerminus('omega'),
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
    // (Termini: r is closed by rEnd above r2, the top of the spine)
    const deep = {
      schemaVersion: 3, id: 'd_deep000000', title: 'D', planOrder: ['r'],
      nodes: {
        r: mkProject('r', { next: 'r2', leftBranches: ['L'], rightBranches: ['R'] }),
        r2: mkTask('r2', { next: 'rEnd', leftBranches: ['L2'], rightBranches: ['R2'] }),
        rEnd: mkTerminus('rEnd'),
        L: mkTask('L', { next: 'La', leftBranches: ['Lb'] }), La: mkTask('La'), Lb: mkTask('Lb'),
        R: mkTask('R', { next: 'Ra', rightBranches: ['Rb'] }), Ra: mkTask('Ra'), Rb: mkTask('Rb'),
        L2: mkTask('L2'), R2: mkTask('R2'),
      },
    }
    expect(countCrossings(layoutOf(deep))).toBe(0)
  })
})

// Drag-and-drop rearranges the model through the pure move mutations; the layout
// must stay drawable (valid, no overlaps, no branch crossings) after each. These
// exercise the four moves against the real HomeLab fixture.
describe('computeDomainLayout — after drag-and-drop moves', () => {
  const fresh = () => JSON5.parse(fixtureRaw)
  function drawable(record) {
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const layout = computeDomainLayout(model, syntheticSizes(model).sizes)
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

  // Termini: the subject was k_migrate, a node on the media plan's own trunk.
  // Converting it now opens a scope closed above it on that trunk, and the plan's
  // own close sits above that again, so cutting k_migrate's incoming edge carries
  // the plan's close away with it and leaves p_media unclosed — detachToTree does
  // not refuse it, but the result is not a legal record and there is nothing for
  // this test to draw. A sub-project that CAN be detached is one whose trunk is a
  // branch line, since its close tops that line: k_wifi (a branch of k_vlan, with
  // k_roam above it) converts to a project closed above k_roam, and detaching the
  // branch takes the whole scope, close and all. Same operation, same assertions.
  it('stays drawable after detaching a converted sub-project into its own tree', () => {
    drawable(M.detachToTree(M.convertKind(fresh(), 'k_wifi'), 'k_wifi'))
  })

  it('stays drawable after reordering a root', () => {
    drawable(M.reorderRoot(fresh(), 'p_auto', 0))
  })
})

describe('computeDomainLayout — tip-fork connector', () => {
  // The Move tree: Beta is the tip of its line, and Beta forks left to Gamma, one
  // row above it. Beta must be connected up to the fork junction.
  //
  // Termini: Beta was Alpha's main-line successor and the tip of the plan's trunk.
  // A plan's trunk now ends at its close, and that close may hold no branch, so the
  // tip of a plan's trunk can never fork; a tip that can is a BRANCH line's.
  // Beta therefore hangs off Alpha as a branch instead, which leaves the geometry
  // this test is about untouched (a fork off a line tip, its junction floating
  // above the line's riser) and costs one extra junction, Alpha's own fork.
  const move = {
    schemaVersion: 3, id: 'd_move000000', title: 'M', planOrder: ['alpha'],
    nodes: {
      alpha: mkProject('alpha', { next: 'omega', rightBranches: ['beta'] }),
      omega: mkTerminus('omega'),
      beta: mkTask('beta', { leftBranches: ['gamma'] }),
      gamma: mkTask('gamma'),
    },
  }

  it('connects the tip parent up to its floating fork junction', () => {
    const layout = layoutOf(move)
    expect(layout.junctions).toHaveLength(2) // Alpha's fork to Beta, and Beta's own to Gamma
    const beta = layout.stations.find((s) => s.id === 'beta')
    const j = layout.junctions.find((jn) => Math.abs(jn.x - beta.x) < 0.5) // Beta's, the floating one
    expect(j).toBeDefined()
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

describe('computeDomainLayout — angled branch connectors', () => {
  // a is the trunk root (a -> b); a forks right to c, one row above. The branch
  // connector's flat leg tilts up to c's lane, then a short vertical riser into c,
  // while the junction diamond stays put at [a.x, junctionY].
  // (Termini: a is closed by z above b, the top of its trunk.)
  const tilt = {
    schemaVersion: 3, id: 'd_tilt000000', title: 'T', planOrder: ['a'],
    nodes: {
      a: mkProject('a', { next: 'b', rightBranches: ['c'] }),
      b: mkTask('b', { next: 'z' }),
      z: mkTerminus('z'),
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
    expect(p2[1]).toBeLessThan(p0[1]) // a fork always rises: the anchor is higher (smaller y)
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
    // (Termini: a is closed by z above b, the top of its trunk.)
    const fan = {
      schemaVersion: 3, id: 'd_fan0000000', title: 'F', planOrder: ['a'],
      nodes: {
        a: mkProject('a', { next: 'b', rightBranches: ['c', 'd', 'e'] }),
        b: mkTask('b', { next: 'z' }), z: mkTerminus('z'),
        c: mkTask('c'), d: mkTask('d'), e: mkTask('e'),
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
