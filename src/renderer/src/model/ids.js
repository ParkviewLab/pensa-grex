// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Stable id minting. Ids are opaque and never reused: a base36 timestamp plus
// a per-process counter (so two ids minted in the same millisecond still
// differ), prefixed by kind so a bare id string is self-describing in logs
// and file diffs.

let counter = 0

function mint(prefix) {
  counter += 1
  return prefix + Date.now().toString(36) + counter.toString(36)
}

export function mintTaskId() {
  return mint('k_')
}

export function mintTreeId() {
  return mint('t_')
}
