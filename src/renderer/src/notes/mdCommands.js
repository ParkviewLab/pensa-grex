// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Pure markdown-editing command builders for the note editor's toolbar and
// keymap. Each takes an EditorState and returns a transaction spec ({changes,
// selection}) that can be dispatched with view.dispatch(...). Keeping them pure
// (no view, no DOM) lets them be unit-tested in the node environment by
// applying the spec to a state and asserting on the resulting doc/selection.

import { EditorSelection } from '@codemirror/state'

// Wrap each selection range with open/close markers (bold **, italic *,
// strikethrough ~~, inline code `, or a fenced block with newline-bearing
// markers). An empty range leaves the caret between the inserted markers.
export function wrapSelection(state, open, close = open) {
  return state.changeByRange((range) => ({
    changes: [
      { from: range.from, insert: open },
      { from: range.to, insert: close },
    ],
    range: EditorSelection.range(range.anchor + open.length, range.head + open.length),
  }))
}

// Insert a line prefix (heading "# ", bullet "- ", quote "> ", or a per-line
// function such as a numbered list) at the start of every line the selection
// touches. A line shared by two ranges is prefixed once. No selection is
// returned, so CodeMirror maps the existing selection through the inserts.
export function prefixLines(state, prefix) {
  const changes = []
  const seen = new Set()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      changes.push({ from: line.from, insert: typeof prefix === 'function' ? prefix(n - first) : prefix })
    }
  }
  return { changes }
}

// Replace each selection range with a markdown link, keeping the selected text
// as the link text and selecting the literal "url" placeholder for type-over.
export function insertLink(state) {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = `[${text}](url)`
    const urlStart = range.from + 1 + text.length + 2 // past "[" + text + "]("
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    }
  })
}
