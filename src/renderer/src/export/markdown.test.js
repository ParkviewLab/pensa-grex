// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect } from 'vitest'
import { validateForest } from '../model/validate.js'
import { serializeProject } from './markdown.js'

// A project exercising every shape rule: project-root nesting, a flat main-line
// run of tasks, a fork nesting one level in, a sub-project nesting its own
// subtree, the three checkbox renderings, a struck cancelled task, and a note
// inlined as indented body text.
//   Proj -> Task one(todo, note) -> Task two(done) -> Sub(project) -> Sub task(cancelled)
//   Task one forks to Branch one(todo)
function forest() {
  const t = (id, title, over = {}) => ({
    id, title, kind: 'task', status: 'todo', createdAt: 'x', completedAt: null,
    note: null, here: false, next: null, branches: [], ...over,
  })
  const p = (id, title, over = {}) => ({
    id, title, kind: 'project', createdAt: 'x', note: null, next: null, branches: [], ...over,
  })
  return {
    schema: 2, domain: 'T', rootOrder: ['P'],
    tasks: {
      P:  p('P', 'Proj', { next: 'M1' }),
      M1: t('M1', 'Task one', { note: 'M1.md', next: 'M2', branches: [{ child: 'B1', side: 'left', at: 'above' }] }),
      M2: t('M2', 'Task two', { status: 'completed', completedAt: 'x', next: 'SP' }),
      SP: p('SP', 'Sub', { next: 'S1' }),
      S1: t('S1', 'Sub task', { status: 'cancelled' }),
      B1: t('B1', 'Branch one'),
    },
  }
}

describe('serializeProject', () => {
  it('is a valid forest to begin with', () => {
    expect(validateForest(forest())).toEqual({ ok: true, errors: [] })
  })

  it('renders the agreed nested outline', () => {
    const md = serializeProject(forest(), 'P', { M1: 'hello\nworld' })
    expect(md).toBe(
      '- Proj\n' +
      '  - [ ] Task one\n' +
      '\n' +
      '    hello\n' +
      '    world\n' +
      '    - [ ] Branch one\n' +
      '  - [x] Task two\n' +
      '  - Sub\n' +
      '    - [ ] ~~Sub task~~\n'
    )
  })

  it('keeps a plain main-line run of tasks flat under the project root', () => {
    const raw = {
      schema: 2, domain: 'T', rootOrder: ['P'],
      tasks: {
        P: { id: 'P', title: 'P', kind: 'project', createdAt: 'x', note: null, next: 'a', branches: [] },
        a: { id: 'a', title: 'a', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'b', branches: [] },
        b: { id: 'b', title: 'b', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'c', branches: [] },
        c: { id: 'c', title: 'c', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
      },
    }
    // a, b, c are siblings at one indent under the project, not a staircase.
    expect(serializeProject(raw, 'P')).toBe('- P\n  - [ ] a\n  - [ ] b\n  - [ ] c\n')
  })

  it('omits the note block for an empty or whitespace-only note', () => {
    const md = serializeProject(forest(), 'P', { M1: '   \n  ' })
    expect(md).not.toContain('\n\n') // no blank-line-led note paragraph
  })

  it('exports only the chosen sub-project when invoked on an interior project node', () => {
    const md = serializeProject(forest(), 'SP')
    expect(md).toBe('- Sub\n  - [ ] ~~Sub task~~\n')
  })
})
