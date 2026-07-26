// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { noteFileName, noteSlug } from './notes.js'

describe('note filenames', () => {
  it('is the node id plus a short slug of the title', () => {
    expect(noteFileName('n_mrtwgppt03', 'Draft JD')).toBe('n_mrtwgppt03_draft-jd.md')
  })

  it('truncates the slug to twelve characters and never ends it in a hyphen', () => {
    expect(noteSlug('Migrate the media library')).toBe('migrate-the')
    expect(noteSlug('Migrate the media library')).toHaveLength(11)
    expect(noteSlug('abcdefghijkl mnop')).toBe('abcdefghijkl')
  })

  it('collapses punctuation and case into single hyphens', () => {
    expect(noteSlug('Set up  the NAS!!')).toBe('set-up-the-n')
    expect(noteSlug('AI/ML review')).toBe('ai-ml-review')
  })

  it('falls back to a bare id when a title yields no slug', () => {
    expect(noteFileName('n_mrtwgppt03', '???')).toBe('n_mrtwgppt03.md')
    expect(noteFileName('n_mrtwgppt03', '🚀')).toBe('n_mrtwgppt03.md')
    expect(noteFileName('n_mrtwgppt03', null)).toBe('n_mrtwgppt03.md')
  })

  it('is a bare filename, so it cannot escape the notes directory', () => {
    const name = noteFileName('n_mrtwgppt03', '../../etc/passwd')
    expect(name).not.toContain('/')
    expect(name).not.toContain('..')
    expect(name.endsWith('.md')).toBe(true)
  })
})
