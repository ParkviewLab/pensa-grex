// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from '../model/fixtures/homelab.forest.json5?raw'
import { buildForest } from '../model/forest.js'
import { computeForestLayout } from './layout.js'

// Synthetic, deterministic sizes standing in for layout/measure.js's real DOM
// measurement — layout.js is pure and must not need a DOM to be exercised.
function syntheticSizes(forest) {
  const sizes = new Map()
  for (const [id, task] of forest.tasks) {
    const lines = task.here ? 3 : task.title.length > 18 ? 2 : 2
    sizes.set(id, { cardW: 138, cardH: task.here ? 68 : 30 + lines * 12 })
  }
  const titleSizes = new Map()
  for (const tree of forest.trees) {
    titleSizes.set(tree.id, { titleW: Math.max(60, tree.name.length * 7), titleH: 14 })
  }
  return { sizes, titleSizes }
}

function loadFixtureLayout(overrideTitleW) {
  const raw = JSON5.parse(fixtureRaw)
  const forest = buildForest(raw)
  const { sizes, titleSizes } = syntheticSizes(forest)
  if (overrideTitleW != null) {
    const t = titleSizes.get('t_media')
    titleSizes.set('t_media', { ...t, titleW: overrideTitleW })
  }
  return { forest, layout: computeForestLayout(forest, sizes, titleSizes) }
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
    expect(layout.stations).toHaveLength(15)
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

  it('keeps every tree title centered under its own root, not colliding with a sibling tree', () => {
    const { layout } = loadFixtureLayout()
    const byId = new Map(layout.stations.map((s) => [s.id, s]))
    for (const title of layout.titles) {
      const rootId = { 't_media': 'k_nas', 't_net': 'k_rack', 't_auto': 'k_hassio' }[title.treeId]
      expect(title.x).toBe(byId.get(rootId).x)
    }
    const titleXs = layout.titles.map((t) => t.x)
    expect(new Set(titleXs).size).toBe(3) // three distinct tree positions
  })

  it('widening a tree\'s title pushes the next tree over, with no new overlap', () => {
    const { layout: normal } = loadFixtureLayout()
    const { layout: widened } = loadFixtureLayout(2000) // an absurdly long "Media server" title
    const normalNextTreeX = normal.stations.find((s) => s.id === 'k_rack').x
    const widenedNextTreeX = widened.stations.find((s) => s.id === 'k_rack').x
    expect(widenedNextTreeX).toBeGreaterThan(normalNextTreeX)

    const rects = widened.stations.map(rectOf)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })

  it('an oversized cursor card still collides with nothing', () => {
    const raw = JSON5.parse(fixtureRaw)
    const forest = buildForest(raw)
    const { sizes, titleSizes } = syntheticSizes(forest)
    sizes.set('k_migrate', { cardW: 138, cardH: 400 }) // a wildly tall "here" trapezium
    const layout = computeForestLayout(forest, sizes, titleSizes)
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
    const layout = computeForestLayout(emptyForest, new Map(), new Map())
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
    const titleSizes = new Map([['t1', { titleW: 60, titleH: 14 }]])
    const layout = computeForestLayout(forest, sizes, titleSizes)
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
    const titleSizes = new Map([['t1', { titleW: 60, titleH: 14 }]])
    const layout = computeForestLayout(forest, sizes, titleSizes)
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
