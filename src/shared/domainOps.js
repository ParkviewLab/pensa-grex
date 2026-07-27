// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The single task-authority core, shared by the Electron main process
// (src/main/taskService.js, over the real on-disk store) and the renderer's
// in-memory fallback (src/renderer/src/bridge/api.js, over a Map). It owns the
// one write path: load a domain's file text, parse it, bring it to the current
// schema, apply one pure mutation, re-validate, and persist. A write that would
// break an invariant returns { error } and touches no storage.
//
// Everything here is SYNCHRONOUS by design. The main-process store reads and
// writes synchronously and atomically, so a per-operation run that never yields
// the event loop between load and save is concurrency-safe by construction: the
// GUI and (later) an MCP client serialize naturally on the one event loop, with
// no cache and no lock. `storage` supplies the I/O as synchronous callbacks:
//   loadText(dir)               -> { text }  | { error }
//   saveText(dir, text)         -> { ok }    | { error }
//   writeNote(dir, file, text)  -> { ok }    | { error }

// Reads with JSON5 and writes plain JSON: the tolerant parser still accepts a file
// an earlier version wrote (unquoted keys, a trailing comma) and the sample
// fixtures, while every write from here on is plain JSON, per northstar axiom 7.
import JSON5 from 'json5'
import { validateRecord } from './model/validate.js'
import { migrateRecord } from './model/migrate.js'
import * as M from './model/mutations.js'

// The task operations a client may invoke by name, each a pure mutation with the
// signature (record, ...args) -> nextRecord. `pasteAsPlan` is handled separately
// because it also writes note files; helpers such as `uniqueTitle` are
// deliberately not exposed.
const DOMAIN_OPS = new Set([
  'addPlan', 'insertTask', 'addTaskAbove', 'addTaskBelow', 'addBranchAbove', 'addBranchBelow',
  'openBranch', 'setMergePoint', 'setBranchPoint', 'wrapRun', 'unwrapProject',
  'setTitle', 'setNote', 'setStatus', 'cycleStatus', 'convertKind', 'toggleFlag',
  'makeHere', 'clearHere', 'deleteTask',
  'moveTaskNode', 'moveSubtree', 'detachProject', 'reorderRoot', 'moveIntoLine',
  'moveUp', 'moveDown',
])

// Whether `op` is a task operation this core will run (the allowlist the IPC
// dispatch and the fallback both gate on).
export function isDomainOp(op) {
  return op === 'pasteAsPlan' || DOMAIN_OPS.has(op)
}

// Parse a domain's file text, migrate it to the current schema, and validate
// it, persisting the upgrade exactly once (only when migration changed
// something) — the load path the renderer's openDomain used to run inline.
// Returns { record } or { error }.
export function readRecord(storage, dir) {
  const loaded = storage.loadText(dir)
  if (loaded.error) return { error: loaded.error }
  let record
  try {
    record = JSON5.parse(loaded.text)
  } catch (e) {
    return { error: 'domain file will not parse: ' + e.message }
  }
  const migrated = migrateRecord(record)
  record = migrated.record
  const v = validateRecord(record)
  if (!v.ok) return { error: 'record failed validation: ' + v.errors.join('; ') }
  if (migrated.changed) {
    const w = storage.saveText(dir, JSON.stringify(record, null, 2) + '\n')
    if (w.error) return { error: w.error }
  }
  return { record }
}

// Apply one task operation to a domain's record and persist it. The whole
// sequence is synchronous, so concurrent callers serialize on the event loop
// with no lock. `args` is the argument array after the op name. Returns
// { record: nextRecord } or { error }; an unknown op is rejected without a write.
export function runOp(storage, dir, op, args) {
  const loaded = storage.loadText(dir)
  if (loaded.error) return { error: loaded.error }
  let record
  try {
    record = JSON5.parse(loaded.text)
  } catch (e) {
    return { error: 'domain file will not parse: ' + e.message }
  }
  record = migrateRecord(record).record

  let next
  let noteWrites = []
  if (op === 'pasteAsPlan') {
    const res = M.pasteAsPlan(record, args[0])
    next = res.next
    noteWrites = res.notes || []
  } else if (DOMAIN_OPS.has(op)) {
    try {
      next = M[op](record, ...args)
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }
  } else {
    return { error: 'unknown task op: ' + op }
  }

  const v = validateRecord(next)
  if (!v.ok) return { error: v.errors.join('; ') }

  // Write the pasted note files before the record that references them, so a
  // failure leaves at most orphan note files, never a record pointing at a note
  // that was never written. On the common no-note path this loop is empty.
  for (const n of noteWrites) {
    const w = storage.writeNote(dir, n.file, n.content)
    if (w && w.error) return { error: w.error }
  }
  const saved = storage.saveText(dir, JSON.stringify(next, null, 2) + '\n')
  if (saved.error) return { error: saved.error }
  return { record: next }
}
