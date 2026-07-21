// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Unit tests for the pure markdown command builders. Each builder returns a
// transaction spec; we apply it to a fresh state and assert on the resulting
// document text and selection. No DOM is needed, so these run in the default
// node environment alongside the model tests.

import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { wrapSelection, prefixLines, insertLink } from './mdCommands.js'

function apply(doc, selection, build) {
  // allowMultipleSelections mirrors the real editor (basicSetup enables it);
  // without it EditorState.create collapses a multi-range selection to one.
  const state = EditorState.create({ doc, selection, extensions: EditorState.allowMultipleSelections.of(true) })
  const next = state.update(build(state)).state
  return { doc: next.doc.toString(), sel: next.selection.main }
}

describe('wrapSelection', () => {
  it('wraps a selection and keeps the text selected', () => {
    const { doc, sel } = apply('hello world', EditorSelection.single(0, 5), (s) => wrapSelection(s, '**'))
    expect(doc).toBe('**hello** world')
    expect([sel.from, sel.to]).toEqual([2, 7])
  })
  it('inserts empty markers with the caret between them', () => {
    const { doc, sel } = apply('', EditorSelection.single(0), (s) => wrapSelection(s, '**'))
    expect(doc).toBe('****')
    expect(sel.empty).toBe(true)
    expect(sel.from).toBe(2)
  })
  it('supports distinct open/close markers (fenced code block)', () => {
    const { doc } = apply('x', EditorSelection.single(0, 1), (s) => wrapSelection(s, '```\n', '\n```'))
    expect(doc).toBe('```\nx\n```')
  })
  it('wraps every range of a multi-cursor selection', () => {
    const sel = EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)], 0)
    const { doc } = apply('a b', sel, (s) => wrapSelection(s, '*'))
    expect(doc).toBe('*a* *b*')
  })
})

describe('prefixLines', () => {
  it('prefixes every line the selection spans', () => {
    const { doc } = apply('one\ntwo\nthree', EditorSelection.single(0, 11), (s) => prefixLines(s, '- '))
    expect(doc).toBe('- one\n- two\n- three')
  })
  it('numbers lines with a per-line function', () => {
    const { doc } = apply('a\nb\nc', EditorSelection.single(0, 5), (s) => prefixLines(s, (i) => `${i + 1}. `))
    expect(doc).toBe('1. a\n2. b\n3. c')
  })
  it('prefixes a line shared by two ranges only once', () => {
    const sel = EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)], 0)
    const { doc } = apply('abc', sel, (s) => prefixLines(s, '> '))
    expect(doc).toBe('> abc')
  })
})

describe('insertLink', () => {
  it('wraps the selection as link text and selects the url placeholder', () => {
    const { doc, sel } = apply('site', EditorSelection.single(0, 4), (s) => insertLink(s))
    expect(doc).toBe('[site](url)')
    expect(doc.slice(sel.from, sel.to)).toBe('url')
  })
  it('inserts an empty link at the caret', () => {
    const { doc, sel } = apply('', EditorSelection.single(0), (s) => insertLink(s))
    expect(doc).toBe('[](url)')
    expect(doc.slice(sel.from, sel.to)).toBe('url')
  })
})
