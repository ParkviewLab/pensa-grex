// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { mintTaskId, mintTreeId } from './ids.js'

describe('ids', () => {
  it('prefixes task and tree ids so a bare id is self-describing', () => {
    expect(mintTaskId().startsWith('k_')).toBe(true)
    expect(mintTreeId().startsWith('t_')).toBe(true)
  })

  it('never mints the same id twice, even in the same millisecond', () => {
    const ids = new Set()
    for (let i = 0; i < 500; i++) ids.add(mintTaskId())
    expect(ids.size).toBe(500)
  })
})
