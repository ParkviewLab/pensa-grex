// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { mintNodeId, mintDomainId } from './ids.js'

describe('ids', () => {
  it('is a prefix, an eight-character stamp, and a two-character counter', () => {
    expect(mintNodeId()).toMatch(/^n_[0-9a-z]{8}[0-9a-z]{2}$/)
    expect(mintDomainId()).toMatch(/^d_[0-9a-z]{8}[0-9a-z]{2}$/)
    expect(mintNodeId()).toHaveLength(12)
  })

  it('is entirely lowercase, so an id is safe in a filename on a case-normalizing disk', () => {
    for (let i = 0; i < 50; i++) {
      const id = mintNodeId()
      expect(id).toBe(id.toLowerCase())
    }
  })

  it('never mints the same id twice, even in a burst inside one millisecond', () => {
    const ids = new Set()
    for (let i = 0; i < 2000; i++) ids.add(mintNodeId())
    expect(ids.size).toBe(2000)
  })

  it('sorts chronologically by plain string comparison', async () => {
    const first = mintNodeId()
    await new Promise((r) => setTimeout(r, 2))
    const second = mintNodeId()
    expect(first < second).toBe(true)
    // Fixed width is what makes that true of the raw strings rather than only of
    // their parsed values.
    expect(first.length).toBe(second.length)
  })

  it('keeps node and domain ids apart, and the kind out of the node id', () => {
    // A node's kind is a field, so a conversion between kinds must not imply a
    // new identity; there is one node prefix for all three kinds.
    const ids = [mintNodeId(), mintNodeId(), mintDomainId()]
    expect(ids.filter((id) => id.startsWith('n_'))).toHaveLength(2)
    expect(ids.filter((id) => id.startsWith('d_'))).toHaveLength(1)
  })

  it('counts within one millisecond and rolls into the next', () => {
    // 2000 ids cannot fit in one millisecond's 1296 counter slots, so at least
    // two distinct stamps must appear, and every counter value must be in range.
    const ids = Array.from({ length: 2000 }, () => mintNodeId())
    const stamps = new Set(ids.map((id) => id.slice(2, 10)))
    expect(stamps.size).toBeGreaterThan(1)
    for (const id of ids) expect(parseInt(id.slice(10), 36)).toBeLessThan(1296)
  })
})
