// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The main process is the single authority over task data. Every edit to a
// domain's record — from the GUI today, and from the in-app MCP server later —
// runs through here: one write path over the on-disk store (store.js), sharing
// the pure model and the runOp/readRecord core (../shared/domainOps.js) with the
// renderer's in-memory fallback. Because store.js reads and writes synchronously and
// atomically, each operation completes without yielding the event loop, so
// concurrent callers serialize with no lock.

import { loadForest, saveForest, writeNote } from './store.js'
import { runOp as runOpCore, readRecord as readRecordCore } from '../shared/domainOps.js'

// The on-disk store, adapted to the synchronous storage-callback shape the core
// expects. Every path is still re-derived and bounds-checked inside store.js.
const storage = {
  loadText: (dir) => loadForest(dir),
  saveText: (dir, text) => saveForest(dir, text),
  writeNote: (dir, file, content) => writeNote(dir, file, content),
}

// Parse + migrate (persisting the upgrade once) + validate a domain's record.
// Returns { record } or { error }.
export function readRecord(dir) {
  return readRecordCore(storage, dir)
}

// Apply one allowlisted task operation and persist it atomically. `args` is the
// argument array after the op name. Returns { record } or { error }; an unknown op
// is rejected.
export function runOp(dir, op, args) {
  return runOpCore(storage, dir, op, Array.isArray(args) ? args : [])
}
