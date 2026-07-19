// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pure edit operations, one per right-click menu action (see
// docs/model_ideas.md, "Editing"). Signatures only for M2 — the data model
// and its invariants come first; the bodies are implemented in M5 once the
// context menu exists to call them. Each throws until then, so an accidental
// early call fails loudly rather than silently doing nothing.
//
// Every mutation takes the raw forest object (the parsed-and-validated JSON5
// shape, not the buildForest() runtime model) and returns a new raw forest
// object; none mutate their argument. This keeps them serializable and easy
// to round-trip through validateForest() after each edit.

function notImplemented(name) {
  throw new Error(name + '() is a signature only until M5 (see model/mutations.js)')
}

/** Set a task's status. Completing sets completedAt; leaving completed clears it. */
export function setStatus(_raw, _taskId, _status) {
  notImplemented('setStatus')
}

/** Mark taskId as "here" on its line, clearing any existing "here" on that same line. */
export function makeHere(_raw, _taskId) {
  notImplemented('makeHere')
}

/**
 * Push a new task onto the stack immediately above/below taskId, continuing
 * the main line (this is what decides a child is main-line, not a branch).
 */
export function addTaskAbove(_raw, _taskId, _title) {
  notImplemented('addTaskAbove')
}
export function addTaskBelow(_raw, _taskId, _title) {
  notImplemented('addTaskBelow')
}

/**
 * Fork a new branch off taskId (above/below), alternating side by creation
 * order unless side is given explicitly.
 */
export function addBranchAbove(_raw, _taskId, _title, _side) {
  notImplemented('addBranchAbove')
}
export function addBranchBelow(_raw, _taskId, _title, _side) {
  notImplemented('addBranchBelow')
}

/**
 * Remove a task. Subtree behaviour (remove vs. splice children onto the
 * parent) is an open question — see docs/model_ideas.md — to be settled here.
 */
export function deleteTask(_raw, _taskId) {
  notImplemented('deleteTask')
}
