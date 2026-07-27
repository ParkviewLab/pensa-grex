// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { validateRecord } from '../model/validate.js'
import { serializeProject } from './markdown.js'

const t = (id, title, over = {}) => ({
  id, title, kind: 'task', status: 'todo', createdAt: 'x', completedAt: null,
  note: null, here: false, next: null, leftBranches: [], rightBranches: [], ...over,
})
const p = (id, title, over = {}) => ({
  id, title, kind: 'project', createdAt: 'x', note: null, next: null,
  leftBranches: [], rightBranches: [], ...over,
})
// A scope's close. It carries no title, no status, no completedAt, no "here" and no
// flag: it says nothing of its own, and a note is the only expressive field it keeps.
const c = (id, over = {}) => ({
  id, kind: 'terminus', createdAt: 'x', note: null, next: null,
  leftBranches: [], rightBranches: [], ...over,
})

// A project exercising every shape rule: project-root nesting, a flat main-line
// run of tasks, a fork nesting one level in, a sub-project nesting its own
// subtree, the three checkbox renderings, a struck cancelled task, and a note
// inlined as indented body text. The two closes are the grammar's and not decoration:
// every project node is closed by exactly one terminus above it on its trunk, so the
// sub-project's close stacks below the plan's own, and the plan's close ends the trunk.
//   Proj -> Task one(todo, note) -> Task two(done) -> Sub(project) -> Sub task(cancelled)
//        -> close of Sub -> close of Proj
//   Task one forks left to Branch one(todo)
function record() {
  return {
    schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['P'],
    nodes: {
      P:  p('P', 'Proj', { next: 'M1' }),
      M1: t('M1', 'Task one', { note: 'M1.md', next: 'M2', leftBranches: ['B1'] }),
      M2: t('M2', 'Task two', { status: 'completed', completedAt: 'x', next: 'SP' }),
      SP: p('SP', 'Sub', { next: 'S1' }),
      S1: t('S1', 'Sub task', { status: 'cancelled', next: 'TS' }),
      TS: c('TS', { next: 'TP' }),
      TP: c('TP'),
      // Returns: the fork rejoins the trunk it left, at the edge above M2, and a merge
      // point is stored on the top of the branch (here its only node).
      B1: t('B1', 'Branch one', { mergePoint: 'M2' }),
    },
  }
}

describe('serializeProject', () => {
  it('is a valid record to begin with', () => {
    expect(validateRecord(record())).toEqual({ ok: true, errors: [] })
  })

  it('renders the agreed nested outline', () => {
    const md = serializeProject(record(), 'P', { M1: 'hello\nworld' })
    // Termini: unchanged, and that is the point. The two closes are in the record but
    // contribute no line, so bracketing the scopes leaves the outline exactly as it was.
    //
    // Returns: the branch rejoins above Task two rather than at the edge it left, which is
    // the one thing the nesting cannot show, so it is written as an italic continuation
    // line at the end of the branch. A branch rejoining at its own edge adds nothing here.
    expect(md).toBe(
      '- Proj\n' +
      '  - [ ] Task one\n' +
      '\n' +
      '    hello\n' +
      '    world\n' +
      '    - [ ] Branch one\n' +
      '\n' +
      '      *rejoins the trunk above "Task two"*\n' +
      '  - [x] Task two\n' +
      '  - Sub\n' +
      '    - [ ] ~~Sub task~~\n'
    )
  })

  it('keeps a plain main-line run of tasks flat under the project root', () => {
    const record = {
      schemaVersion: 3, id: 'd_test000000', title: 'T', planOrder: ['P'],
      nodes: {
        P: { id: 'P', title: 'P', kind: 'project', createdAt: 'x', note: null, next: 'a', leftBranches: [], rightBranches: [] },
        a: { id: 'a', title: 'a', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'b', leftBranches: [], rightBranches: [] },
        b: { id: 'b', title: 'b', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'c', leftBranches: [], rightBranches: [] },
        c: { id: 'c', title: 'c', kind: 'task', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: 'T', leftBranches: [], rightBranches: [] },
        // Termini: the run has to close, or this is not a legal plan at all, which the
        // assertion below now checks so that the flat-run claim is made about one.
        T: c('T'),
      },
    }
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    // a, b, c are siblings at one indent under the project, not a staircase.
    expect(serializeProject(record, 'P')).toBe('- P\n  - [ ] a\n  - [ ] b\n  - [ ] c\n')
  })

  it('omits the note block for an empty or whitespace-only note', () => {
    const md = serializeProject(record(), 'P', { M1: '   \n  ' })
    // Returns: "contains no blank line" no longer states this, since the branch's rejoin
    // line is itself a blank-line-led paragraph. So the whole output is asserted instead,
    // which says the same thing more strongly: nothing at all stands where the note would.
    expect(md).toBe(
      '- Proj\n' +
      '  - [ ] Task one\n' +
      '    - [ ] Branch one\n' +
      '\n' +
      '      *rejoins the trunk above "Task two"*\n' +
      '  - [x] Task two\n' +
      '  - Sub\n' +
      '    - [ ] ~~Sub task~~\n'
    )
  })

  // Returns: a branch that rejoins at the very edge it left is the default and the
  // commonest case, and the nesting already places it, so writing a line for it would be
  // noise. Where the merge point is a scope's close, which carries no title, the line names
  // the project that close belongs to instead.
  it('writes nothing for a branch that rejoins at its own edge', () => {
    const r = record()
    r.nodes.B1.mergePoint = 'M1' // the edge it left
    expect(validateRecord(r)).toEqual({ ok: true, errors: [] })
    expect(serializeProject(r, 'P')).not.toContain('rejoins')
  })

  it('names the project a close belongs to when the merge point is that close', () => {
    const r = record()
    r.nodes.B1.mergePoint = 'TS' // the terminus closing Sub
    expect(validateRecord(r)).toEqual({ ok: true, errors: [] })
    expect(serializeProject(r, 'P')).toContain('*rejoins the trunk above the close of "Sub"*')
  })

  it('exports only the chosen sub-project when invoked on an interior project node', () => {
    // Termini: the walk starts at Sub and is bounded by Sub's own close, so the plan's
    // close above it is outside the outline altogether, note and all.
    const md = serializeProject(record(), 'SP')
    expect(md).toBe('- Sub\n  - [ ] ~~Sub task~~\n')
    expect(serializeProject(record(), 'SP', { TP: 'plan closed' })).toBe(md)
  })

  it('stops at a sub-project\'s close, leaving the work that comes after it', () => {
    // The shape the fixture above lacks: a scope with work above its close. Following
    // `next` from Sub reaches Task three and the plan's own close, neither of which is in
    // the project asked for; the extent stops at Sub's close and so does the outline.
    const r = record()
    r.nodes.TS.next = 'M3'
    r.nodes.M3 = t('M3', 'Task three', { next: 'TP' })
    expect(validateRecord(r)).toEqual({ ok: true, errors: [] })
    expect(serializeProject(r, 'SP')).toBe('- Sub\n  - [ ] ~~Sub task~~\n')
    // and the whole plan still reads as one outline, Task three included
    expect(serializeProject(r, 'P')).toContain('Task three')
  })

  // Termini: a close is not an item and gets no bullet, having no title to put on a
  // line. Its note is content, though, and is the record of what closing the scope
  // took, so it is inlined as an indented paragraph reading as a closing remark. Two
  // closes carrying notes therefore add two paragraphs and no bullet at all.
  it('gives a scope close no bullet, and inlines its note as a closing remark', () => {
    const md = serializeProject(record(), 'P', { TS: 'sub closed', TP: 'plan closed' })
    // Returns: the branch's rejoin line is a continuation paragraph as well, and it sits
    // where the branch ends rather than where a scope closes, so the two do not compete.
    expect(md).toBe(
      '- Proj\n' +
      '  - [ ] Task one\n' +
      '    - [ ] Branch one\n' +
      '\n' +
      '      *rejoins the trunk above "Task two"*\n' +
      '  - [x] Task two\n' +
      '  - Sub\n' +
      '    - [ ] ~~Sub task~~\n' +
      '\n' +
      '      sub closed\n' +
      '\n' +
      '      plan closed\n'
    )
    const bullets = (s) => s.split('\n').filter((line) => line.trimStart().startsWith('- '))
    expect(bullets(md)).toEqual(bullets(serializeProject(record(), 'P')))
  })
})
