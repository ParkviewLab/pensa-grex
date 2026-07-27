// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Comparing two versions as this project writes them: X.Y.Z for a release, and
// X.Y.Z-devN for the open dev cycle, which names the release it is working toward
// and therefore sorts BELOW it (3.3.1-dev0 < 3.3.1). That is semver's own rule for
// a pre-release, and it is what makes a dev build correctly read as newer than the
// release it follows (3.3.1-dev0 > 3.3.0) and older than the one it anticipates.
//
// Kept deliberately small: it answers "is this tag newer than what is running",
// which is the only question the About window asks. Anything it cannot parse is
// answered "no", so a malformed tag never tells a user to go and download nothing.

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

/** Strip a leading `v` from a git tag: `v3.3.0` -> `3.3.0`. */
export function stripTag(tag) {
  return typeof tag === 'string' ? tag.trim().replace(/^[vV]/, '') : ''
}

function parse(v) {
  const m = RELEASE.exec(stripTag(v))
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null }
}

// Semver's pre-release ordering: identifiers compared left to right, numeric ones
// numerically and below alphanumeric ones, and a shorter run of equal identifiers
// sorting first (1.0.0-dev < 1.0.0-dev.1).
function comparePre(a, b) {
  const A = a.split('.'), B = b.split('.')
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] === undefined) return -1
    if (B[i] === undefined) return 1
    const na = /^\d+$/.test(A[i]), nb = /^\d+$/.test(B[i])
    if (na && nb) { const d = Number(A[i]) - Number(B[i]); if (d) return d < 0 ? -1 : 1; continue }
    if (na !== nb) return na ? -1 : 1
    if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1
  }
  return 0
}

/**
 * Compare two versions, returning -1, 0 or 1, or null where either cannot be
 * parsed (which is a different answer from "equal", and callers must not conflate
 * the two).
 */
export function compareVersions(a, b) {
  const x = parse(a), y = parse(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1
  if (x.pre && !y.pre) return -1
  if (!x.pre && y.pre) return 1
  if (!x.pre && !y.pre) return 0
  const c = comparePre(x.pre, y.pre)
  return c === 0 ? 0 : (c < 0 ? -1 : 1)
}

/** Is `candidate` a strictly newer version than `current`? Unparseable is not newer. */
export function isNewer(candidate, current) {
  return compareVersions(candidate, current) === 1
}
