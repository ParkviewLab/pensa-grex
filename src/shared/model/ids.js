// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Stable id minting. An id is a two-character prefix, a base36 millisecond
// timestamp of exactly eight characters, and a two-character counter that resets
// each millisecond: `n_mrtwgppt01`, twelve characters, fixed width, entirely
// lowercase, and chronologically sortable by plain string comparison.
//
// Three properties are deliberate. All lowercase, because an id is also part of
// a note's filename and a case-normalizing filesystem must not be able to
// conflate two of them. Fixed width, because a column of ids in a diff should
// line up. And a counter rather than randomness, because randomness only reduces
// the chance of a collision while a counter removes it: there is one writer per
// machine, so pasting two hundred nodes inside one millisecond is exactly the
// case a counter handles and a short random suffix does not.
//
// There is no device discriminator. Ids are opaque and never parsed, so one can
// be added to newly minted ids on the day a second writer exists without
// touching a single old id.

const EPOCH_CHARS = 8
const COUNTER_CHARS = 2
const COUNTER_LIMIT = 36 ** COUNTER_CHARS // 1296 ids per millisecond

let lastMs = 0
let counter = 0

// The base36 timestamp is eight characters from 2004 until 2059 (36**8 ms).
// Before and after that it would be shorter or longer, which would break the
// fixed width, so pad the short case and let the long case be a loud failure
// rather than a silently mis-sorted id.
function stamp(ms) {
  const s = ms.toString(36)
  if (s.length > EPOCH_CHARS) throw new Error('id timestamp no longer fits in ' + EPOCH_CHARS + ' base36 characters')
  return s.padStart(EPOCH_CHARS, '0')
}

// A monotonic (millisecond, counter) pair. On the 1296th id inside one
// millisecond the only correct move is to wait for the next one: the alternative
// is a wider counter, and this loop cannot run longer than a millisecond.
function tick() {
  let ms = Date.now()
  if (ms === lastMs) {
    counter += 1
    if (counter >= COUNTER_LIMIT) {
      while (ms === lastMs) ms = Date.now()
      lastMs = ms
      counter = 0
    }
  } else {
    // A clock that steps backwards (NTP, a manual change) must not re-issue ids
    // that already exist, so hold the last millisecond and keep counting.
    if (ms < lastMs) {
      counter += 1
      if (counter >= COUNTER_LIMIT) {
        while (Date.now() <= lastMs) { /* wait out the skew */ }
        lastMs = Date.now()
        counter = 0
      }
      return { ms: lastMs, n: counter }
    }
    lastMs = ms
    counter = 0
  }
  return { ms: lastMs, n: counter }
}

function mint(prefix) {
  const { ms, n } = tick()
  return prefix + stamp(ms) + n.toString(36).padStart(COUNTER_CHARS, '0')
}

// A node of any kind: task, project, or (from schema 3) terminus. The kind is a
// field, not part of the id, so converting a node between kinds leaves its
// identity alone.
export function mintNodeId() {
  return mint('n_')
}

// A domain. Its id is the domain's identity; the directory it sits in is a
// label, repaired from the record rather than trusted.
export function mintDomainId() {
  return mint('d_')
}
