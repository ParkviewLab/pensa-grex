// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { softHyphenate } from './hyphenate.js'

const SHY = '­' // soft hyphen

describe('softHyphenate', () => {
  it('inserts soft hyphens into a long word without losing any letters', () => {
    const out = softHyphenate('Supercalifragilisticexpialidocious')
    expect(out).toContain(SHY)
    expect(out.split(SHY).join('')).toBe('Supercalifragilisticexpialidocious')
    expect(out.split(SHY).every((seg) => seg.length > 0)).toBe(true) // no empty segments
  })

  it('leaves a short word unchanged', () => {
    expect(softHyphenate('Size')).toBe('Size')
  })

  it('hyphenates each word of a multi-word title, keeping the spaces', () => {
    const out = softHyphenate('Weigh Disproportionateness')
    expect(out.startsWith('Weigh ')).toBe(true) // short first word untouched, space kept
    expect(out).toContain(SHY) // the long second word gains break points
    expect(out.split(SHY).join('')).toBe('Weigh Disproportionateness')
  })

  it('tolerates empty and falsy input', () => {
    expect(softHyphenate('')).toBe('')
    expect(softHyphenate(null)).toBe(null)
  })
})
