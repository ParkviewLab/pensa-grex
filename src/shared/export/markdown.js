// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// One-way export of a project subtree to a nested Markdown outline (the
// Sub-Projects plan, "Export to Markdown"). Pure and synchronous: note contents
// are read by the caller and passed in, so this is a straight fold over the
// record and is unit-tested without any I/O.
//
// Shape rules:
//   - A project node is a plain bullet and NESTS its whole subtree one level in.
//   - A fork (branch) opens a nested sub-list one level in from the node it forks
//     from.
//   - A plain main-line run of tasks (a .next chain of task nodes) stays FLAT: the
//     successors are siblings, not progressively indented.
//   - A task is a checkbox item: [x] completed, [ ] to-do/in-progress; a cancelled
//     task is struck through. A project node carries no checkbox.
//   - A node's note is inlined beneath it as indented body text (a continuation
//     paragraph of the item), never a block quote.
//   - The full subtree is emitted regardless of collapse (the caller passes the
//     unpruned record).

import { branchChildrenOf } from '../model/validate.js'

const INDENT = '  ' // two spaces per nesting level

function bulletFor(node) {
  if (node.kind === 'project') return '- ' + node.title
  const title = node.status === 'cancelled' ? '~~' + node.title + '~~' : node.title
  const box = node.status === 'completed' ? '[x]' : '[ ]'
  return '- ' + box + ' ' + title
}

// Serialize the subtree rooted at rootId. `notes` maps a node id to its note
// text (absent or empty means no note). Returns the markdown string.
export function serializeProject(record, rootId, notes = {}) {
  const out = []
  const seen = new Set()

  // A node's note, as an indented paragraph beneath its bullet.
  function emitNote(id, depth) {
    const note = notes[id]
    if (typeof note !== 'string' || !note.trim().length) return
    out.push('') // a blank line so the note starts a new paragraph inside the item
    const notePad = INDENT.repeat(depth + 1)
    for (const line of note.replace(/\n+$/, '').split('\n')) {
      out.push(line.length ? notePad + line : '')
    }
  }

  // Emit `id` and its subtree. `depth` is this node's indent level. A task's
  // main-line successor stays at `depth` (a flat run); a project's successor and
  // every fork nest at `depth + 1`.
  function emit(id, depth) {
    const node = record.nodes[id]
    if (!node || seen.has(id)) return
    seen.add(id)

    // A scope's close gets no bullet of its own: the outline's indentation already
    // shows where the scope ends, and a terminus has no title to put on a line. Its
    // note is content, though, so that is emitted at the scope's own level, reading
    // as a closing remark on the project it closes. A close never nests what follows.
    if (node.kind === 'terminus') {
      emitNote(id, depth)
      for (const b of branchChildrenOf(node)) emit(b.child, depth + 1)
      if (node.next) emit(node.next, depth)
      return
    }

    out.push(INDENT.repeat(depth) + bulletFor(node))

    emitNote(id, depth)

    // Forks are emitted before the main-line successor: a nested sub-list placed
    // after a shallower successor line would attach to the wrong parent.
    for (const b of branchChildrenOf(node)) emit(b.child, depth + 1)
    if (node.next) emit(node.next, node.kind === 'project' ? depth + 1 : depth)
  }

  if (record.nodes[rootId]) emit(rootId, 0)
  return out.join('\n') + '\n'
}
