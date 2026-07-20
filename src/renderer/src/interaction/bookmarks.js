// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Pure helpers for node-anchored bookmark cameras (see the Sub-Projects plan,
// "Bookmarked views"). A bookmark stores no absolute pan; it stores the id of the
// node centred at save time plus that node's ancestor chain to the root. At jump
// time the first id in the chain that still exists and is visible is centred, so
// the camera degrades gracefully when the anchor was deleted or hidden by
// collapse (it falls back to the nearest surviving ancestor); only a wholly
// deleted tree leaves the bookmark broken. These functions are DOM-free and
// unit-tested; app.js reads the live layout and drives the viewport with them.
// See docs/interaction_model.md for the camera-anchor resolution.

// The id of the station nearest a world-space point (the viewport centre), by
// squared distance to each card's centre. Null if there are no stations.
export function centeredStationId(stations, cx, cy) {
  let best = null
  let bestD = Infinity
  for (const s of stations) {
    const dx = s.x - cx
    const dy = s.cardTop + s.cardH / 2 - cy
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = s.id }
  }
  return best
}

// The chain from a node up to its root: [id, predecessor, ..., root]. Follows the
// one incoming edge (a valid forest gives each node at most one), stopping at a
// root (no predecessor). A self-contained predecessor walk, so this stays pure.
export function anchorChain(raw, id) {
  const chain = []
  const seen = new Set()
  let cur = id
  while (cur && raw.tasks[cur] && !seen.has(cur)) {
    seen.add(cur)
    chain.push(cur)
    cur = predecessorId(raw, cur)
  }
  return chain
}

function predecessorId(raw, id) {
  for (const [pid, t] of Object.entries(raw.tasks)) {
    if (t.next === id) return pid
    if ((t.branches || []).some((b) => b.child === id)) return pid
  }
  return null
}

// The first id in the anchor chain that is currently present (rendered, i.e. not
// deleted and not hidden by collapse), or null if none survive (a broken camera).
export function resolveAnchor(chain, presentIds) {
  const present = presentIds instanceof Set ? presentIds : new Set(presentIds)
  return (chain || []).find((id) => present.has(id)) || null
}
