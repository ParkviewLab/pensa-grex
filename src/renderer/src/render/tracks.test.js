// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The junction marker as an object: which junctions get a drag halo and which stay bare
// ink. The suite runs in the node environment, so document.createElementNS is stubbed the
// way shapes.test.js stubs its DOM: tracks' el() only creates elements, sets attributes
// and appends children.

import { describe, it, expect, beforeEach } from 'vitest'

function fakeNode(tag) {
  const node = {
    tag, attrs: new Map(), children: [],
    setAttribute: (k, v) => node.attrs.set(k, String(v)),
    getAttribute: (k) => (node.attrs.has(k) ? node.attrs.get(k) : null),
    appendChild: (c) => { node.children.push(c); return c },
  }
  return node
}

beforeEach(() => {
  globalThis.document = { createElementNS: (_ns, tag) => fakeNode(tag) }
})

const { buildForkMarker } = await import('./tracks.js')

describe('buildForkMarker', () => {
  const jx = (footIds, kind = 'fork') => ({ x: 10, y: 20, kind, edgeBelowId: 'h1', footIds })

  it('a junction standing for one branch is a handle: diamond plus an addressed halo', () => {
    const g = buildForkMarker(10, 20, 8, jx(['f1'], 'merge'))
    expect(g.tag).toBe('g')
    expect(g.getAttribute('class')).toBe('jx jx-merge')
    const [diamond, halo] = g.children
    expect(diamond.getAttribute('class')).toBe('fork')
    expect(halo.getAttribute('class')).toBe('jx-hit')
    expect(halo.getAttribute('data-jx-kind')).toBe('merge')
    expect(halo.getAttribute('data-jx-edge')).toBe('h1')
    expect(halo.getAttribute('data-jx-foot')).toBe('f1')
  })

  it('a shared diamond gets no halo: a drag must name one branch, and it cannot', () => {
    const shared = buildForkMarker(10, 20, 8, jx(['f1', 'g1']))
    expect(shared.tag).toBe('rect')
    expect(shared.getAttribute('class')).toBe('fork')
    expect(shared.getAttribute('data-jx-foot')).toBeNull()
  })

  it('no junction record at all draws the bare diamond, as the pre-identity caller did', () => {
    const bare = buildForkMarker(10, 20)
    expect(bare.tag).toBe('rect')
    expect(bare.getAttribute('class')).toBe('fork')
  })
})
