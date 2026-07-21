// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Decide how the open note editor should reconcile with an external change to its
// note file (an MCP write to the same domain). Pure, so the decision is tested
// without the editor's CodeMirror/DOM machinery. Outcomes:
//   'close'  - the task was removed; close the editor (with a notice)
//   'none'   - the file matches the editor; nothing to do
//   'warn'   - the file changed but the editor has unsaved edits; keep them, warn
//   'reload' - the file changed and the editor is clean; adopt the new content
// A user's in-progress edit is never discarded silently (that is the 'warn' path).
export function reconcileDecision({ taskExists, diskContent, editorContent, dirty }) {
  if (!taskExists) return 'close'
  if (diskContent === editorContent) return 'none'
  return dirty ? 'warn' : 'reload'
}
