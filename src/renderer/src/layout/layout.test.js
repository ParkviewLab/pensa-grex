// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from '../../../shared/model/fixtures/homelab.record.json?raw'
import workRaw from '../../../shared/model/fixtures/work.record.json?raw'
import { buildModel } from '../../../shared/model/model.js'
import { computeDomainLayout } from './layout.js'
import { validateRecord, branchesIn } from '../../../shared/model/validate.js'
import { trackPath } from '../render/tracks.js'
import * as M from '../../../shared/model/mutations.js'

// Synthetic, deterministic sizes standing in for layout/measure.js's real DOM
// measurement — layout.js is pure and must not need a DOM to be exercised.
function syntheticSizes(model) {
  const sizes = new Map()
  for (const [id, node] of model.nodes) {
    // A terminus carries no title, so there is no text to wrap, but it is drawn as the
    // project hull turned upside down and so takes the project card's width and its minimum
    // height (style.css: .card{width:188px}, .card.terminus{min-height:58px}). It was a short
    // bar before stage 5 and this fixture still said so, which hid every clearance question a
    // full-width close asks.
    if (node.kind === 'terminus') {
      sizes.set(id, { cardW: 188, cardH: 58 })
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

// --- the row grid, the clearance bands, and the lateral lines in them ----------

// A node's space, which no lateral line may enter: from the top of its dot down to the bottom
// of its label shape, across the card's own width (docs/model_v3_ideas.md, section 7). A
// rectangle rather than a pair of heights, because a lateral line need not be horizontal: a
// height comparison alone would say a diagonal enters every node at that height, in every lane.
//
// The dot's radius comes from the drawing itself (`layout.metrics`) rather than being restated
// here, so a test can never be measuring against a number the engine has stopped using.
function nodeRect(station, metrics) {
  return {
    left: station.x - station.cardW / 2,
    right: station.x + station.cardW / 2,
    top: station.anchorY - metrics.dotRadius,
    bottom: station.cardTop + station.cardH,
  }
}

// The rows the drawing reveals, base first. Every station on one row shares that row's card
// top and anchor, so the distinct card tops ARE the rows, and the tallest card on a row is
// what the band below it has to clear.
function rowsOf(layout) {
  const byTop = new Map()
  for (const s of layout.stations) {
    const row = byTop.get(s.cardTop) || { cardTop: s.cardTop, anchorY: s.anchorY, tallest: 0 }
    row.tallest = Math.max(row.tallest, s.cardH)
    byTop.set(s.cardTop, row)
  }
  return [...byTop.values()].sort((a, b) => b.cardTop - a.cardTop) // growth is upward, so y falls as the row rises
}

// The clearance band in every gap between two adjacent rows: from just above the lower row's
// dots up to the bottom of the tallest card on the upper row. Anchored to the row rather than
// to one card, because a run leaving a short card still has to clear a tall one beside it.
// Growth is upward, so `low` is the larger y of the two edges, as it is in layout.js.
function bandsOf(layout) {
  const rows = rowsOf(layout)
  const bands = []
  for (let i = 0; i + 1 < rows.length; i++) {
    bands.push({ low: rows[i].anchorY - layout.metrics.dotRadius, high: rows[i + 1].cardTop + rows[i + 1].tallest })
  }
  return bands
}

// Every horizontal run a lateral line draws: the flat leg of a branch line on its way out to
// its own lane, and of a return line on its way in to its trunk.
function lateralRuns(layout) {
  const runs = []
  for (const t of layout.tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const [x1, y1] = t.points[i - 1]
      const [x2, y2] = t.points[i]
      if (y1 === y2 && x1 !== x2) runs.push({ kind: t.kind, y: y1, from: x1, to: x2, hops: t.hops || [] })
    }
  }
  return runs
}

// Every vertical a track draws, which is what a lateral run may have to hop. A single-node
// line's riser is a zero-length segment and is no line to follow, so it is left out, as
// layout.js leaves it out of its own hop scan.
function verticalsOf(layout) {
  const verticals = []
  for (const t of layout.tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const [x1, y1] = t.points[i - 1]
      const [x2, y2] = t.points[i]
      if (x1 === x2 && y1 !== y2) verticals.push({ x: x1, yMin: Math.min(y1, y2), yMax: Math.max(y1, y2) })
    }
  }
  return verticals
}

// Every segment of a lateral line that is not vertical: the flat leg of a branch or a return
// today, a twelve-degree climb once the engine draws one. The vertical riser into a card is
// excluded because a spine is meant to pass behind its own label.
function lateralSegments(layout) {
  const segs = []
  for (const t of layout.tracks) {
    if (t.kind !== 'branch' && t.kind !== 'return') continue
    for (let i = 1; i < t.points.length; i++) {
      const [x1, y1] = t.points[i - 1]
      const [x2, y2] = t.points[i]
      if (x1 !== x2) segs.push({ kind: t.kind, x1, y1, x2, y2, hops: t.hops || [] })
    }
  }
  return segs
}

// Whether a segment meets a rectangle: the segment clipped to the rectangle's x-range, then its
// y compared at the two clipped ends. Sound for any straight segment, which is what lets the
// same sweep serve a flat run and a diagonal.
function segmentMeetsRect(seg, rect) {
  const lo = Math.max(Math.min(seg.x1, seg.x2), rect.left)
  const hi = Math.min(Math.max(seg.x1, seg.x2), rect.right)
  if (lo > hi) return false
  const yAt = (x) => (seg.x1 === seg.x2 ? seg.y1 : seg.y1 + ((x - seg.x1) * (seg.y2 - seg.y1)) / (seg.x2 - seg.x1))
  const [a, b] = [yAt(lo), yAt(hi)]
  return Math.max(a, b) >= rect.top && Math.min(a, b) <= rect.bottom
}

// Which lateral lines walk into a node's space, named rather than counted so that a failure says
// which line, where, and whose station it has walked into.
function linesInNodeSpace(layout, label) {
  const found = []
  for (const seg of lateralSegments(layout)) {
    for (const s of layout.stations) {
      if (segmentMeetsRect(seg, nodeRect(s, layout.metrics))) {
        found.push(label + ': a ' + seg.kind + ' line from (' + seg.x1 + ',' + seg.y1 + ') to (' + seg.x2 + ',' + seg.y2 + ') meets ' + s.id + "'s space")
      }
    }
  }
  return found
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

  it('draws one junction per fork and one per join, six in all', () => {
    const { layout } = loadFixtureLayout()
    // Three forking nodes: k_migrate (2 branches sharing 1 junction), k_vlan (1),
    // k_zigbee (1).
    //
    // Returns: was 3, the forks alone. Every branch now rejoins the trunk it left and each
    // join is marked as well, so the fixture's four branches add three more diamonds:
    // k_plex and k_btrfs both merge at k_backups and share one, which is the n-way join the
    // schema gets for nothing, while k_roam's and k_energy's are their own.
    expect(layout.junctions).toHaveLength(6)
  })

  it('places each junction strictly between the two real cards it connects', () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    // k_migrate forks; its junction must sit below k_backups's card (the
    // main-line successor, "upper") and above k_migrate's own card ("lower").
    const migrate = byId.get('k_migrate'), backups = byId.get('k_backups')
    // Returns: k_migrate's x carries two diamonds now, since k_plex and k_btrfs return to
    // the same trunk, so the fork is the lower of the pair rather than the only one there. A
    // fork is drawn against the node below its edge and a join against the node above, which
    // is what keeps the two apart and puts the fork underneath.
    const atMigrateX = layout.junctions.filter((jn) => Math.abs(jn.x - migrate.x) < 1)
    expect(atMigrateX).toHaveLength(2)
    const j = atMigrateX.reduce((lower, jn) => (jn.y > lower.y ? jn : lower))
    expect(j).toBeDefined()
    expect(j.y).toBeLessThan(migrate.cardTop) // above (smaller y than) the lower card's top
    expect(j.y).toBeGreaterThan(backups.cardTop + backups.cardH) // below (larger y than) the upper card's bottom
  })

  it("draws one return line per branch, from the branch's tip in to its trunk", () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    // branchesIn is the same reading of the record the merge rules validate against, so the
    // count here cannot drift from what the fixture actually spells.
    const branches = branchesIn(JSON5.parse(fixtureRaw))
    expect(branches).toHaveLength(4) // k_plex, k_btrfs, k_wifi's line, k_energy
    const returns = layout.tracks.filter((t) => t.kind === 'return')
    expect(returns).toHaveLength(branches.length)
    const matched = new Set()
    for (const branch of branches) {
      const tip = byId.get(branch.tipId)
      const trunk = byId.get(branch.mergePoint)
      // A return leaves the top of the branch's own trunk, because that is the end the line
      // departs from, and it arrives at the x of the trunk it left.
      const line = returns.find((t) => Math.abs(t.points[0][0] - tip.x) < 0.5 && Math.abs(t.points[0][1] - tip.anchorY) < 0.5)
      expect(line).toBeDefined()
      const arrival = line.points[line.points.length - 1]
      expect(Math.abs(arrival[0] - trunk.x)).toBeLessThan(0.5)
      expect(arrival[1]).toBeLessThan(tip.anchorY) // and it arrives above the tip it left
      matched.add(line)
    }
    expect(matched.size).toBe(branches.length) // each branch has its own line, not one matched twice
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
  //
  // Returns: b was still a bare tip. A branch must now rejoin the trunk it left, and the only
  // edges on b's trunk are the ones rising from its own nodes, so a fork off a tip with
  // nothing above it leaves its branch nowhere to land and validateRecord refuses the record.
  // Giving b a successor is what makes the twig legal, and it also retires the gap the
  // regression was about: a fork's gap always has a card above it now, since the node its own
  // branch returns to sits there. The sweep for NaN in every junction and every track point,
  // which is what the case was written to catch, is unchanged.
  it('lays out a fork on a branch line with finite coordinates', () => {
    const record = {
      schemaVersion: 3, id: 'd_solo000000', title: 'D', planOrder: ['r'],
      nodes: {
        r: { id: 'r', title: 'Root', kind: 'project', createdAt: 'x', note: null, flagged: false, next: 'z', leftBranches: ['b'], rightBranches: [] },
        z: { id: 'z', kind: 'terminus', createdAt: 'x', note: null, next: null, leftBranches: [], rightBranches: [] },
        b: { id: 'b', title: 'Branch', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: 'b2', leftBranches: ['c'], rightBranches: [] },
        b2: { id: 'b2', title: 'Above', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, mergePoint: 'r', leftBranches: [], rightBranches: [] },
        c: { id: 'c', title: 'Twig', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, flagged: false, here: false, next: null, mergePoint: 'b', leftBranches: [], rightBranches: [] },
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const sizes = new Map([
      ['r', { cardW: 138, cardH: 49 }], ['z', { cardW: 64, cardH: 10 }],
      ['b', { cardW: 138, cardH: 49 }], ['b2', { cardW: 138, cardH: 49 }], ['c', { cardW: 138, cardH: 49 }],
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

// --- non-crossing branches, bubbles, and the bands, runs and hops ------------

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

// All track segments: the risers, and both legs of every branch line and return line.
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

// Returns: crossings are no longer forbidden. A branch span is bounded now, two spans on one
// side may overlap without nesting, and where a crossing does arise the drawing hops it
// (docs/model_v3_ideas.md, section 7). A count of zero here is therefore a property of these
// particular arrangements, none of which needs a crossing, rather than an invariant the engine
// still guarantees; what replaced the invariant is the node-space rule, swept over both
// fixtures at the foot of this file.
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
  //
  // Returns: each branch now names where it rejoins, on the tip of its own trunk. One and
  // Apple return to the edge above Charlie, Two (at its tip, Wonder) and Banana to the edge
  // above Delta, so every span stays inside the plan's own scope. The lanes are the ones the
  // test was written about; what the returns add is height, Delta rising a row to make room
  // for the joins that land beneath it.
  const wide = {
    schemaVersion: 3, id: 'd_wide000000', title: 'W', planOrder: ['alpha'],
    nodes: {
      alpha: mkProject('alpha', { next: 'bravo' }),
      bravo: mkTask('bravo', { next: 'charlie', leftBranches: ['one'], rightBranches: ['two'] }),
      charlie: mkTask('charlie', { next: 'delta', leftBranches: ['apple'], rightBranches: ['banana'] }),
      delta: mkTask('delta', { next: 'omega' }),
      omega: mkTerminus('omega'),
      one: mkTask('one', { mergePoint: 'charlie' }),
      two: mkTask('two', { next: 'wonder' }), wonder: mkTask('wonder', { mergePoint: 'delta' }),
      apple: mkTask('apple', { mergePoint: 'charlie' }), banana: mkTask('banana', { mergePoint: 'delta' }),
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
    //
    // Returns: L and R rejoin the spine at the edge above r2, which is the only spine edge
    // above them with a node to receive the join, since rEnd tops the plan. L2 and R2 leave
    // that same edge and return to it, and the twigs Lb and Rb do likewise on their own
    // branch lines: four bubbles, the smallest legal branch there is.
    const deep = {
      schemaVersion: 3, id: 'd_deep000000', title: 'D', planOrder: ['r'],
      nodes: {
        r: mkProject('r', { next: 'r2', leftBranches: ['L'], rightBranches: ['R'] }),
        r2: mkTask('r2', { next: 'rEnd', leftBranches: ['L2'], rightBranches: ['R2'] }),
        rEnd: mkTerminus('rEnd'),
        L: mkTask('L', { next: 'La', leftBranches: ['Lb'] }), La: mkTask('La', { mergePoint: 'r2' }), Lb: mkTask('Lb', { mergePoint: 'L' }),
        R: mkTask('R', { next: 'Ra', rightBranches: ['Rb'] }), Ra: mkTask('Ra', { mergePoint: 'r2' }), Rb: mkTask('Rb', { mergePoint: 'R' }),
        L2: mkTask('L2', { mergePoint: 'r2' }), R2: mkTask('R2', { mergePoint: 'r2' }),
      },
    }
    expect(countCrossings(layoutOf(deep))).toBe(0)
  })
})

// Drag-and-drop rearranges the model through the pure move mutations; the layout
// must stay drawable (valid, no overlaps, no branch crossings, and no lateral run in a
// node's space) after each. These exercise the four moves against the real HomeLab fixture.
describe('computeDomainLayout — after drag-and-drop moves', () => {
  const fresh = () => JSON5.parse(fixtureRaw)
  function drawable(record) {
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const layout = computeDomainLayout(model, syntheticSizes(model).sizes)
    expect(countCrossings(layout)).toBe(0)
    // A move relocates whole branches, and with them the returns they now carry, so the rule
    // that survived the loss of the nesting invariant has to hold after each one too.
    expect(linesInNodeSpace(layout, 'after the move')).toEqual([])
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

describe('computeDomainLayout — the bubble, and junctions anchored to a line', () => {
  // The Move tree: Beta is the tip of its line, and Beta forks left to Gamma, one
  // row above it. Beta must be connected up to the fork junction.
  //
  // Termini: Beta was Alpha's main-line successor and the tip of the plan's trunk.
  // A plan's trunk now ends at its close, and that close may hold no branch, so the
  // tip of a plan's trunk can never fork; a tip that can is a BRANCH line's.
  // Beta therefore hangs off Alpha as a branch instead, which leaves the geometry
  // this test is about untouched (a fork off a line tip, its junction floating
  // above the line's riser) and costs one extra junction, Alpha's own fork.
  //
  // Returns: Beta forked while it was the tip of its line, and Gamma had no edge above Beta to
  // rejoin, so the record is refused. Beta therefore carries the plan's close above it and
  // Gamma leaves the edge between them and returns to that same edge, which makes the Move
  // tree a bubble, the smallest branch there is. That retires the scenario the test was named
  // for rather than moving it again: a fork's host always has an edge rising from it now,
  // because its branch has to return to one, so a fork junction always falls inside its host
  // line's own riser and the stub layout.js draws for the floating case is unreachable from a
  // legal record. What the stub existed for is the property below, that no junction floats
  // free of a line, and that is now asserted for every junction, fork and join alike.
  const bubble = {
    schemaVersion: 3, id: 'd_move000000', title: 'M', planOrder: ['alpha'],
    nodes: {
      alpha: mkProject('alpha', { next: 'beta' }),
      beta: mkTask('beta', { next: 'omega', leftBranches: ['gamma'] }),
      omega: mkTerminus('omega'),
      gamma: mkTask('gamma', { mergePoint: 'beta' }),
    },
  }

  it('leaves no junction floating: a vertical track runs through every one', () => {
    const layout = layoutOf(bubble)
    expect(layout.junctions).toHaveLength(2) // Beta's fork to Gamma, and Gamma's join above Beta
    const beta = layout.stations.find((s) => s.id === 'beta')
    for (const j of layout.junctions) {
      expect(Math.abs(j.x - beta.x)).toBeLessThan(0.5) // both are marked on the trunk, at Beta's x
      const carrier = verticalsOf(layout).find((v) => Math.abs(v.x - j.x) < 0.5 && j.y >= v.yMin && j.y <= v.yMax)
      expect(carrier).toBeDefined()
      expect(carrier.yMax - carrier.yMin).toBeGreaterThan(0) // and no degenerate zero-length segment counts
    }
  })

  it('leaves no junction floating in the HomeLab fixture either', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.junctions).toHaveLength(6)
    for (const j of layout.junctions) {
      const carrier = verticalsOf(layout).find((v) => Math.abs(v.x - j.x) < 0.5 && j.y >= v.yMin && j.y <= v.yMax)
      expect(carrier).toBeDefined()
    }
  })

  it("puts a bubble's two junctions on the one edge, the fork below the merge", () => {
    // Gamma leaves the edge rising from Beta and returns to that same edge, so both junctions
    // are marked on it. The two placement conventions are what keep them apart: a fork is
    // drawn just above the node below its edge, a merge just below the node above it
    // (docs/model_v3_ideas.md, sections 3 and 6).
    const layout = layoutOf(bubble)
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    const beta = byId.get('beta'), omega = byId.get('omega'), gamma = byId.get('gamma')
    const [fork, merge] = [...layout.junctions].sort((p, q) => q.y - p.y)
    expect(fork.y).toBeGreaterThan(merge.y) // the fork is the lower of the two
    // and both sit on the one edge Beta -> Omega, clear of the node bounding each end
    expect(fork.y).toBeLessThan(beta.anchorY - layout.metrics.dotRadius)
    expect(merge.y).toBeGreaterThan(omega.cardTop + omega.cardH)
    // the bubble itself runs alongside that edge, in its own lane between the two junctions
    expect(gamma.x).not.toBe(beta.x)
    expect(gamma.anchorY).toBeLessThan(fork.y)
    expect(gamma.cardTop + gamma.cardH).toBeGreaterThan(merge.y)
  })
})

describe('computeDomainLayout — the band, and the flat run in it', () => {
  // The Span tree: a is the plan's base (a -> b -> z), a forks right to c, and c rejoins at
  // the edge above b, so the branch leaves the gap above a and returns in the next gap up.
  // (Termini: a is closed by z above b, the top of its trunk.)
  //
  // Returns: this was the tilt fixture, and the tilt is gone. Cards are aligned to the shared
  // row grid and a lateral line is horizontal: the branch line leaves its fork junction, runs
  // flat along the band in the gap above a, and rises into c; the return line rises out of c
  // into the band below z and runs flat in to the trunk. What used to be tested of the leg,
  // that it tilted up no more than 12 degrees and left a riser behind, is tested here as
  // flatness and the same riser.
  const span = {
    schemaVersion: 3, id: 'd_span000000', title: 'S', planOrder: ['a'],
    nodes: {
      a: mkProject('a', { next: 'b', rightBranches: ['c'] }),
      b: mkTask('b', { next: 'z' }),
      z: mkTerminus('z'),
      c: mkTask('c', { mergePoint: 'b' }),
    },
  }

  it('runs a branch line flat from its junction out to its own lane, then rises into the card', () => {
    const layout = layoutOf(span)
    const a = layout.stations.find((s) => s.id === 'a')
    const c = layout.stations.find((s) => s.id === 'c')
    const branch = layout.tracks.find((t) => t.kind === 'branch')
    expect(branch).toBeTruthy()
    const [p0, p1, p2] = branch.points
    // it starts at the diamond, which sits on the trunk at a's x, and ends at c's own anchor
    const fork = layout.junctions.find((j) => Math.abs(j.y - p0[1]) < 0.5)
    expect(fork).toBeDefined()
    expect(Math.abs(fork.x - a.x)).toBeLessThan(0.5)
    expect(Math.abs(p0[0] - a.x)).toBeLessThan(0.5)
    expect(Math.abs(p2[0] - c.x)).toBeLessThan(0.5)
    expect(Math.abs(p2[1] - c.anchorY)).toBeLessThan(0.5)
    // the run is flat, at the junction's own height, and reaches exactly c's lane
    expect(p1[1]).toBe(p0[1])
    expect(Math.abs(p1[0] - p0[0])).toBeGreaterThan(0)
    expect(Math.abs(p1[0] - c.x)).toBeLessThan(0.5)
    // and the last leg is the vertical riser into the card
    expect(Math.abs(p1[0] - p2[0])).toBeLessThan(0.5)
    expect(p2[1]).toBeLessThan(p1[1]) // a fork rises: the anchor is higher (smaller y)
    expect(countCrossings(layout)).toBe(0)
  })

  it("rises out of the branch's tip into the band, then runs flat in to the trunk", () => {
    const layout = layoutOf(span)
    const b = layout.stations.find((s) => s.id === 'b')
    const c = layout.stations.find((s) => s.id === 'c')
    const line = layout.tracks.find((t) => t.kind === 'return')
    expect(line).toBeTruthy()
    const [p0, p1, p2] = line.points
    // it leaves the tip's anchor and climbs its own lane, which is the mirror of the fork
    expect(Math.abs(p0[0] - c.x)).toBeLessThan(0.5)
    expect(Math.abs(p0[1] - c.anchorY)).toBeLessThan(0.5)
    expect(Math.abs(p1[0] - c.x)).toBeLessThan(0.5)
    expect(p1[1]).toBeLessThan(p0[1])
    // then runs flat in to the trunk it left, at the height it climbed to
    expect(p2[1]).toBe(p1[1])
    expect(Math.abs(p2[0] - b.x)).toBeLessThan(0.5)
    // the join is marked where the run arrives
    const merge = layout.junctions.find((j) => Math.abs(j.y - p2[1]) < 0.5)
    expect(merge).toBeDefined()
    expect(Math.abs(merge.x - b.x)).toBeLessThan(0.5)
  })

  it('gives every branch off one junction the same run height, however far out its lane', () => {
    // a forks right to three branches at increasing lanes. Sharing one junction, their runs
    // must all leave it at its own height rather than tilting up toward their cards, and all
    // three name the same merge point, so their returns arrive at a single diamond, which is
    // the n-way join the schema gets for nothing.
    // (Termini: a is closed by z above b, the top of its trunk.)
    const fan = {
      schemaVersion: 3, id: 'd_fan0000000', title: 'F', planOrder: ['a'],
      nodes: {
        a: mkProject('a', { next: 'b', rightBranches: ['c', 'd', 'e'] }),
        b: mkTask('b', { next: 'z' }), z: mkTerminus('z'),
        c: mkTask('c', { mergePoint: 'b' }), d: mkTask('d', { mergePoint: 'b' }), e: mkTask('e', { mergePoint: 'b' }),
      },
    }
    const layout = layoutOf(fan)
    expect(layout.junctions).toHaveLength(2) // one fork below, one join above, for all three branches
    const fork = layout.junctions.reduce((lower, j) => (j.y > lower.y ? j : lower))
    const runs = lateralRuns(layout).filter((r) => r.kind === 'branch')
    expect(runs).toHaveLength(3)
    for (const run of runs) {
      expect(run.y).toBe(fork.y) // flat, and at the junction's height, however far the lane
      expect(Math.abs(run.from - fork.x)).toBeLessThan(0.5)
    }
    // the lanes really are at increasing distances (so the flatness has teeth)
    const lengths = runs.map((r) => Math.abs(r.to - r.from))
    expect(Math.max(...lengths)).toBeGreaterThan(Math.min(...lengths) + 1)
  })

  it("keeps every lateral run inside its gap's clearance band", () => {
    const { layout } = loadFixtureLayout()
    const bands = bandsOf(layout)
    for (const run of lateralRuns(layout)) {
      const band = bands.find((b) => run.y >= b.high && run.y <= b.low)
      expect(band).toBeDefined() // every run lies in the band of some gap, not merely between rows
    }
    // and the band is the row's, not one card's: k_migrate's two branch lines clear the bottom
    // of the TALLEST card a row up, which in this fixture is k_firewall's, in another plan
    // altogether and 14 pixels lower than k_backups's own.
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    const migrate = byId.get('k_migrate'), backups = byId.get('k_backups'), firewall = byId.get('k_firewall')
    expect(firewall.cardTop).toBe(backups.cardTop) // the same row
    expect(firewall.cardH).toBeGreaterThan(backups.cardH)
    const runs = lateralRuns(layout).filter((r) => r.kind === 'branch' && Math.abs(r.from - migrate.x) < 0.5)
    expect(runs).toHaveLength(2)
    for (const run of runs) {
      expect(run.y).toBeGreaterThan(firewall.cardTop + firewall.cardH)
      expect(run.y).toBeLessThan(migrate.anchorY - layout.metrics.dotRadius)
    }
  })
})

describe('computeDomainLayout — the hop where a run crosses a line', () => {
  // The Cross tree: the trunk runs p, a, b, c, d, t. a forks right to x1 -> x2, whose return
  // joins the edge above c; b forks right to y1, whose return joins the edge above d, one edge
  // higher. b is the higher branch point, so y1 takes the inner lane and x1's band the outer
  // one, and y1's return therefore climbs its lane straight across the band x2's return runs
  // in along. That is the crossing section 7 now permits instead of forbidding: the outer
  // lateral hops it, and the inner line carries on unbroken.
  const cross = {
    schemaVersion: 3, id: 'd_cross00000', title: 'X', planOrder: ['p'],
    nodes: {
      p: mkProject('p', { next: 'a' }),
      a: mkTask('a', { next: 'b', rightBranches: ['x1'] }),
      b: mkTask('b', { next: 'c', rightBranches: ['y1'] }),
      c: mkTask('c', { next: 'd' }),
      d: mkTask('d', { next: 't' }),
      t: mkTerminus('t'),
      x1: mkTask('x1', { next: 'x2' }), x2: mkTask('x2', { mergePoint: 'c' }),
      y1: mkTask('y1', { mergePoint: 'd' }),
    },
  }

  it("hops the line a run crosses, at that line's x", () => {
    const layout = layoutOf(cross)
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    const hopped = layout.tracks.filter((t) => t.hops)
    expect(hopped).toHaveLength(1)
    // The outer lateral is the one that hops, and it hops at the x of the line it crosses,
    // which carries on unbroken. Here that line is the inner branch's own return, as much a
    // line to follow as a trunk is.
    expect(hopped[0].kind).toBe('return')
    expect(hopped[0].hops).toEqual([byId.get('y1').x])
    // the hop marks a crossing that is really there rather than standing in for one avoided
    expect(countCrossings(layout)).toBe(1)
  })

  it('leaves a run that crosses nothing unhopped', () => {
    const layout = layoutOf(cross)
    const runs = lateralRuns(layout)
    expect(runs).toHaveLength(4) // two branch lines out, two returns in
    const plain = runs.filter((r) => r.hops.length === 0)
    expect(plain).toHaveLength(3)
    for (const run of plain) {
      // nothing to hop: no vertical lies strictly between the run's ends at the run's height,
      // which is the condition layout.js decides a hop by
      const crossed = verticalsOf(layout).filter((v) =>
        (v.x - run.from) * (v.x - run.to) < 0 && run.y >= v.yMin && run.y <= v.yMax)
      expect(crossed).toEqual([])
    }
  })
})

describe('trackPath — the hump it draws for a hop', () => {
  it('draws a hop as a quadratic hump on the upward side', () => {
    // The run goes left to right at y=100 and hops a line at x=100 with radius 5: it stops 5
    // short, arcs over, and resumes 5 past. Growth is upward, so the control point's smaller y
    // is what puts the hump above the run rather than below it.
    expect(trackPath([[0, 100], [200, 100]], [100], 5)).toBe('M0,100 L95,100 Q100,90 105,100 L200,100')
    // a run going the other way hops in the order it meets them, or the path would double back
    expect(trackPath([[200, 100], [0, 100]], [50, 150], 5))
      .toBe('M200,100 L155,100 Q150,90 145,100 L55,100 Q50,90 45,100 L0,100')
  })

  it('leaves a plain polyline alone', () => {
    expect(trackPath([[0, 100], [0, 40], [200, 40]])).toBe('M0,100 L0,40 L200,40')
    // and a hop is drawn only where the line actually crosses one: an x outside the run, or a
    // vertical leg, adds nothing
    expect(trackPath([[0, 100], [200, 100]], [300], 5)).toBe('M0,100 L200,100')
    expect(trackPath([[0, 100], [0, 40]], [0], 5)).toBe('M0,100 L0,40')
  })
})

describe("computeDomainLayout — no lateral run in a node's space", () => {
  // The one geometric rule that replaced the nesting invariant: a crossing may happen, but
  // never between the top of a node's dot and the bottom of its label shape, or the drawing
  // would read as a line running through a station (docs/model_v3_ideas.md, section 7). The
  // shared row grid is what buys it, since one y per row for every lane leaves the band between
  // two rows empty at every lane at once, so this sweeps both fixtures whole rather than
  // checking a chosen pair.
  it('keeps every lateral run clear of every node, over both fixtures', () => {
    const offenders = []
    for (const [name, raw] of [['HomeLab', fixtureRaw], ['Work', workRaw]]) {
      const record = JSON5.parse(raw)
      expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
      const model = buildModel(record)
      const layout = computeDomainLayout(model, syntheticSizes(model).sizes)
      expect(lateralSegments(layout).length).toBeGreaterThan(0) // the sweep has something to sweep
      offenders.push(...linesInNodeSpace(layout, name))
    }
    expect(offenders).toEqual([])
  })
})

// Three properties that hold whatever the engine draws, asserted here so that a rewrite of the
// vertical half has something to be measured against. None of them names a coordinate.
describe('computeDomainLayout — properties of any drawing', () => {
  it('reports the constants it drew with, and honours an override of one', () => {
    const { layout } = loadFixtureLayout()
    expect(layout.metrics.dotRadius).toBeGreaterThan(0)
    expect(layout.metrics.anchorGap).toBeGreaterThan(0)

    // A test that reads layout.metrics is only trustworthy if metrics is what the drawing was
    // made with, so move one and watch the drawing move with it.
    const record = JSON5.parse(fixtureRaw)
    const model = buildModel(record)
    const { sizes } = syntheticSizes(model)
    const wide = computeDomainLayout(model, sizes, { anchorGap: 40 })
    expect(wide.metrics.anchorGap).toBe(40)
    const base = computeDomainLayout(model, sizes)
    const id = base.stations[0].id
    const gapOf = (l) => {
      const s = l.stations.find((st) => st.id === id)
      return s.cardTop - s.anchorY
    }
    expect(gapOf(base)).toBe(base.metrics.anchorGap)
    expect(gapOf(wide)).toBe(40)
  })

  it('draws the same domain identically whatever order its nodes are written in', () => {
    // Object key order reaches the drawing through Map iteration, which drives lane packing and
    // any later repair sweep, so a record's spelling must not change its picture.
    const record = JSON5.parse(fixtureRaw)
    const reversed = { ...record, nodes: Object.fromEntries(Object.entries(record.nodes).reverse()) }
    expect(validateRecord(reversed)).toEqual({ ok: true, errors: [] })

    const one = layoutOf(record)
    const other = layoutOf(reversed)
    const key = (l) => JSON.stringify({
      stations: [...l.stations].sort((a, b) => (a.id < b.id ? -1 : 1)).map((s) => [s.id, s.x, s.cardTop]),
      tracks: [...l.tracks].map((t) => [t.kind, t.points]).sort(),
      junctions: [...l.junctions].map((j) => [j.x, j.y]).sort(),
      bounds: l.bounds,
    })
    expect(key(other)).toBe(key(one))
  })

  it('keeps every mark it draws inside the bounds it reports', () => {
    const { layout } = loadFixtureLayout()
    const inside = (x, y) => x >= 0 && y >= 0 && x <= layout.bounds.w && y <= layout.bounds.h
    const outside = []
    for (const t of layout.tracks) {
      for (const [x, y] of t.points) if (!inside(x, y)) outside.push('a ' + t.kind + ' point at ' + x + ',' + y)
    }
    for (const j of layout.junctions) if (!inside(j.x, j.y)) outside.push('a junction at ' + j.x + ',' + j.y)
    for (const d of [...layout.dots, ...layout.cursors]) if (!inside(d.x, d.y)) outside.push('a dot at ' + d.x + ',' + d.y)
    for (const s of layout.stations) {
      if (!inside(s.x - s.cardW / 2, s.cardTop) || !inside(s.x + s.cardW / 2, s.cardTop + s.cardH)) {
        outside.push('the card of ' + s.id)
      }
    }
    expect(outside).toEqual([])
  })

  it('grows a plan upward when a branch gains a card, and moves nothing below the branch point', () => {
    // The property a reader relies on: adding to a strand does not disturb the work beneath it.
    // Positions are compared relative to the plan's base, since the whole drawing is shifted to
    // sit inside its margin and adding a card moves that shift.
    const base = {
      schemaVersion: 3, id: 'd_x', title: 'T', planOrder: ['p'],
      nodes: {
        p: mkProject('p', { next: 'a' }),
        a: mkTask('a', { next: 'b', leftBranches: ['f1'] }),
        b: mkTask('b', { next: 't' }),
        t: mkTerminus('t'),
        f1: mkTask('f1', { mergePoint: 'a' }),
      },
    }
    const grown = structuredClone(base)
    grown.nodes.f1.next = 'f2'
    grown.nodes.f2 = mkTask('f2', { mergePoint: 'a' })
    grown.nodes.f1.mergePoint = null

    const before = layoutOf(base)
    const after = layoutOf(grown)
    const relative = (l) => {
      const origin = l.stations.find((s) => s.id === 'p').cardTop
      return new Map(l.stations.map((s) => [s.id, origin - s.cardTop]))
    }
    const [was, now] = [relative(before), relative(after)]
    expect(now.get('a')).toBe(was.get('a')) // the branch point itself does not move
    expect(now.get('f1')).toBe(was.get('f1')) // nor does the branch's own foot
    for (const id of ['b', 't']) expect(now.get(id)).toBeGreaterThanOrEqual(was.get(id))
    expect(after.bounds.h).toBeGreaterThan(before.bounds.h)
  })
})

// The pixel engine, which places every card by the solve rather than by a shared row grid and
// draws every lateral line at twelve degrees. Asserted as invariants rather than as coordinates:
// none of these tests names a position, so they will still mean what they say after the row grid
// goes and this becomes the only engine.
describe('computeDomainLayout — the pixel engine', () => {
  const pixels = (raw) => {
    const record = JSON5.parse(raw)
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    return { model, layout: computeDomainLayout(model, syntheticSizes(model).sizes, { engine: 'pixels' }) }
  }
  const FIXTURES = [['HomeLab', fixtureRaw], ['Work', workRaw]]

  it('draws every lateral line flat or at exactly twelve degrees', () => {
    for (const [name, raw] of FIXTURES) {
      const { layout } = pixels(raw)
      const segs = lateralSegments(layout)
      expect(segs.length).toBeGreaterThan(0)
      for (const s of segs) {
        const slope = Math.abs((s.y2 - s.y1) / (s.x2 - s.x1))
        const twelve = Math.abs(slope - layout.metrics.tan12) < 1e-9
        expect(slope < 1e-9 || twelve).toBe(true) // name the domain if this ever fails
        if (!twelve && slope >= 1e-9) throw new Error(name + ': a lateral at slope ' + slope)
      }
    }
  })

  it('leaves each junction the fixed clearance from the node it belongs to', () => {
    const { model, layout } = pixels(fixtureRaw)
    const { departClear, arriveClear } = layout.metrics
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    let forks = 0
    let returns = 0
    for (const b of branchesIn(JSON5.parse(fixtureRaw))) {
      const host = byId.get(b.hostId)
      const foot = byId.get(b.footId)
      // A branch line departs the fixed distance above its host's circle and arrives the fixed
      // distance below its own first card, and the climb between the two is the rise.
      const fork = layout.tracks.find((t) => t.kind === 'branch'
        && Math.abs(t.points[0][0] - host.x) < 0.5 && Math.abs(t.points[0][1] - (host.anchorY - departClear)) < 1e-9)
      expect(fork).toBeTruthy()
      const arrival = fork.points[fork.points.length - 1]
      expect(arrival[1]).toBeCloseTo(foot.cardTop + foot.cardH + arriveClear, 9)
      expect(fork.points[0][1] - arrival[1]).toBeCloseTo(layout.metrics.rise, 9)
      forks++

      const merge = model.getNode(b.mergePoint)
      const above = byId.get(merge.next)
      const ret = layout.tracks.find((t) => t.kind === 'return'
        && Math.abs(t.points[t.points.length - 1][0] - above.x) < 0.5)
      expect(ret).toBeTruthy()
      // A return departs at least the fixed distance above the tip's circle, the slack being its
      // tail, and arrives the fixed distance below the card above its merge point.
      const tip = byId.get(b.tipId)
      expect(tip.anchorY - ret.points[0][1]).toBeGreaterThanOrEqual(departClear - 1e-9)
      expect(ret.points[ret.points.length - 1][1]).toBeCloseTo(above.cardTop + above.cardH + arriveClear, 9)
      expect(ret.points[0][1] - ret.points[ret.points.length - 1][1]).toBeCloseTo(layout.metrics.rise, 9)
      returns++
    }
    expect(forks).toBeGreaterThan(0)
    expect(returns).toBe(forks) // every branch rejoins
  })

  it('holds the minimum air on every trunk edge, and gives no more where none is needed', () => {
    const { model, layout } = pixels(fixtureRaw)
    const { minAir, dotRadius } = layout.metrics
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    for (const [id, node] of model.nodes) {
      if (!node.next || !byId.has(node.next)) continue
      const lower = byId.get(id)
      const upper = byId.get(node.next)
      const air = lower.anchorY - (upper.cardTop + upper.cardH)
      expect(air).toBeGreaterThanOrEqual(minAir - 1e-9)
      expect(air - dotRadius).toBeGreaterThan(0) // and clear of the dot itself
    }

    // On a plan with nothing spanning it, the minimum is what every edge gets: "never given up"
    // needs the tight half or a solver that inflated everything would pass.
    const chain = {
      schemaVersion: 3, id: 'd_x', title: 'T', planOrder: ['p'],
      nodes: {
        p: mkProject('p', { next: 'a' }), a: mkTask('a', { next: 'b' }),
        b: mkTask('b', { next: 't' }), t: mkTerminus('t'),
      },
    }
    expect(validateRecord(chain)).toEqual({ ok: true, errors: [] })
    const flat = computeDomainLayout(buildModel(chain), syntheticSizes(buildModel(chain)).sizes, { engine: 'pixels' })
    const seq = ['p', 'a', 'b', 't'].map((id) => flat.stations.find((s) => s.id === id))
    for (let i = 0; i + 1 < seq.length; i++) {
      expect(seq[i].anchorY - (seq[i + 1].cardTop + seq[i + 1].cardH)).toBeCloseTo(minAir, 9)
    }
  })

  it('keeps every card clear of every other, and every lateral line out of a node\'s space', () => {
    const offenders = []
    for (const [name, raw] of FIXTURES) {
      const { layout } = pixels(raw)
      offenders.push(...linesInNodeSpace(layout, name))
      for (let i = 0; i < layout.stations.length; i++) {
        for (let j = i + 1; j < layout.stations.length; j++) {
          if (overlaps(rectOf(layout.stations[i]), rectOf(layout.stations[j]))) {
            offenders.push(name + ': ' + layout.stations[i].id + ' overlaps ' + layout.stations[j].id)
          }
        }
      }
      expect(layout.conflicts).toEqual([]) // the repair pass left nothing behind
    }
    expect(offenders).toEqual([])
  })

  it('breaks a lateral where it passes behind a trunk, and only there', () => {
    // A branch whose return has to reach across a lane its sibling occupies: the crossing is real,
    // so the return breaks at it, and the trunk it crosses runs unbroken through the gap.
    const record = {
      schemaVersion: 3, id: 'd_x', title: 'T', planOrder: ['p'],
      nodes: {
        p: mkProject('p', { next: 'a' }),
        a: mkTask('a', { next: 'b', leftBranches: ['f1', 'g1'] }),
        b: mkTask('b', { next: 'c' }), c: mkTask('c', { next: 't' }), t: mkTerminus('t'),
        f1: mkTask('f1', { next: 'f2' }), f2: mkTask('f2', { mergePoint: 'b' }),
        g1: mkTask('g1', { mergePoint: 'a' }),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    const model = buildModel(record)
    const layout = computeDomainLayout(model, syntheticSizes(model).sizes, { engine: 'pixels' })
    const broken = layout.tracks.filter((t) => t.breaks && t.breaks.length)
    const spineXs = new Set(layout.tracks.filter((t) => t.kind === 'riser').map((t) => t.points[0][0]))
    for (const t of broken) {
      for (const [x] of t.breaks) expect(spineXs.has(x)).toBe(true) // a break is always on a spine
    }
    // And no lateral is broken where it crosses nothing: the count of breaks matches the count of
    // genuine crossings, computed independently here.
    let crossings = 0
    for (const t of layout.tracks) {
      if (t.kind === 'riser') continue
      for (let i = 1; i < t.points.length; i++) {
        const [x1, y1] = t.points[i - 1]
        const [x2, y2] = t.points[i]
        if (x1 === x2) continue
        for (const s of layout.tracks.filter((r) => r.kind === 'riser')) {
          const sx = s.points[0][0]
          if ((sx - x1) * (sx - x2) >= 0) continue
          const y = y1 + ((sx - x1) * (y2 - y1)) / (x2 - x1)
          const lo = Math.min(s.points[0][1], s.points[1][1])
          const hi = Math.max(s.points[0][1], s.points[1][1])
          if (y > lo && y < hi) crossings++
        }
      }
    }
    expect(broken.reduce((n, t) => n + t.breaks.length, 0)).toBe(crossings)
  })
})
