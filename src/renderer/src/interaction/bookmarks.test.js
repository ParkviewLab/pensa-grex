// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import { centeredStationId, anchorChain, resolveAnchor } from './bookmarks.js'

// r(project) -> a -> b ; a forks to f
const raw = {
  schema: 2, domain: 'T', rootOrder: ['r'],
  tasks: {
    r: { id: 'r', title: 'r', kind: 'project', createdAt: 'x', note: null, next: 'a', branches: [] },
    a: { id: 'a', title: 'a', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'b', branches: [{ child: 'f', side: 'left', at: 'above' }] },
    b: { id: 'b', title: 'b', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
    f: { id: 'f', title: 'f', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
  },
}

describe('centeredStationId', () => {
  const stations = [
    { id: 'r', x: 100, cardTop: 300, cardH: 30 },
    { id: 'a', x: 100, cardTop: 200, cardH: 30 },
    { id: 'b', x: 100, cardTop: 100, cardH: 30 },
  ]
  it('returns the station nearest the point, by card centre', () => {
    expect(centeredStationId(stations, 100, 215)).toBe('a') // centre of a is y=215
    expect(centeredStationId(stations, 100, 90)).toBe('b')
  })
  it('returns null when there are no stations', () => {
    expect(centeredStationId([], 0, 0)).toBeNull()
  })
})

describe('anchorChain', () => {
  it('walks a main-line node up to the root', () => {
    expect(anchorChain(raw, 'b')).toEqual(['b', 'a', 'r'])
  })
  it('walks a fork child up through its parent to the root', () => {
    expect(anchorChain(raw, 'f')).toEqual(['f', 'a', 'r'])
  })
  it('a root is its own single-element chain', () => {
    expect(anchorChain(raw, 'r')).toEqual(['r'])
  })
})

describe('resolveAnchor', () => {
  it('returns the anchor itself when it is still present', () => {
    expect(resolveAnchor(['b', 'a', 'r'], new Set(['r', 'a', 'b']))).toBe('b')
  })
  it('falls back to the nearest surviving ancestor when the anchor is gone', () => {
    // b deleted and a hidden by collapse: the root survives
    expect(resolveAnchor(['b', 'a', 'r'], new Set(['r']))).toBe('r')
  })
  it('returns null when nothing in the chain survives (a broken bookmark)', () => {
    expect(resolveAnchor(['b', 'a', 'r'], new Set(['other']))).toBeNull()
    expect(resolveAnchor([], new Set(['r']))).toBeNull()
  })
})
