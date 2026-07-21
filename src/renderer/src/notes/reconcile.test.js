// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { reconcileDecision } from './reconcile.js'

describe('reconcileDecision', () => {
  it('closes when the task was removed, regardless of edits', () => {
    expect(reconcileDecision({ taskExists: false, diskContent: 'x', editorContent: 'y', dirty: true })).toBe('close')
    expect(reconcileDecision({ taskExists: false, diskContent: '', editorContent: '', dirty: false })).toBe('close')
  })

  it('does nothing when the file matches the editor', () => {
    expect(reconcileDecision({ taskExists: true, diskContent: 'same', editorContent: 'same', dirty: false })).toBe('none')
    expect(reconcileDecision({ taskExists: true, diskContent: 'same', editorContent: 'same', dirty: true })).toBe('none')
  })

  it('reloads a changed file when the editor is clean', () => {
    expect(reconcileDecision({ taskExists: true, diskContent: 'new', editorContent: 'old', dirty: false })).toBe('reload')
  })

  it('warns and keeps edits when the editor is dirty', () => {
    expect(reconcileDecision({ taskExists: true, diskContent: 'new', editorContent: 'old', dirty: true })).toBe('warn')
  })
})
