// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The geometry of dropping into a gap, as pure data so it can be tested as data.
//
// A gap is the band above a trunk node: from that node's card top up to the bottom of
// the card above it, or a fixed open band above a line's tip. The gap above a node can
// hold junctions — departures of branches hanging on it, arrivals of returns merging at
// it — and a drop's position among them says which junctions the dropped node landed
// BELOW. Those are the ones a moveIntoLine carry re-addresses, so the record ends
// looking the way the drop looked. y grows downward: a junction is above the drop
// exactly when its y is smaller.

import { isPlanClose, branchesIn } from '../../../shared/model/validate.js'

export const CARET_HALF = 78 // a touch wider than the card, for a comfortable target
export const TIP_GAP = 44 // the open band above a line's tip

/**
 * The gap band containing (wx, wy), or null. `stations` is layout.stations; the record
 * supplies each node's `next`. The open band above a plan's close is excluded: nothing
 * may sit above one, so a caret there would promise what no drop can do. The band above
 * a branch tip stays, that drop being the branch's legal new top.
 */
export function gapAt(record, stations, wx, wy) {
  const byId = new Map(stations.map((s) => [s.id, s]))
  for (const [pid, p] of Object.entries(record.nodes)) {
    const ps = byId.get(pid)
    if (!ps || Math.abs(wx - ps.x) > CARET_HALF) continue
    if (!p.next && isPlanClose(record, pid)) continue
    const q = p.next ? byId.get(p.next) : null
    // A successor in the record with no station is a folded body: the layout is drawn
    // from a pruned copy, so a collapsed project's next has no card. That is not a tip,
    // and a band here would drop the card invisibly inside the fold, an edit the menu
    // withholds on a folded node for the same reason.
    if (p.next && !q) continue
    const yBot = ps.cardTop
    const yTop = q ? q.cardTop + q.cardH : ps.cardTop - TIP_GAP
    if (wy >= yTop && wy <= yBot) return { belowId: pid, x: ps.x, yTop, yBot }
  }
  return null
}

/**
 * Split a drop at wy against the junctions of the gap above belowId: the junctions above
 * the drop become the carry, and the caret centres in the sub-gap between neighbours.
 *
 * A foot whose branch contains the source is left out of the carry, foot by foot: the
 * source's splice-out changes what that branch looks like mid-edit, so the mutation
 * refuses it and the gesture must not offer it. The junction itself still bounds the
 * sub-gap either way — it is visible ink, whatever the drop may do about it — and a
 * shared diamond keeps carrying its other, foreign feet.
 */
export function carryAt(record, junctions, gap, wy, sourceId) {
  const trunkOfFoot = new Map(branchesIn(record).map((b) => [b.footId, b.trunk]))
  const own = (footId) => {
    const trunk = trunkOfFoot.get(footId)
    return !trunk || trunk.includes(sourceId)
  }
  const jxs = (junctions || []).filter((j) => j.edgeBelowId === gap.belowId)
  const out = { branchFeet: [], mergeFeet: [] }
  let subTop = gap.yTop
  let subBot = gap.yBot
  for (const j of jxs) {
    if (j.y < wy) {
      // Above the drop: carried, and the nearest one bounds the sub-gap from above.
      for (const f of j.footIds) if (!own(f)) (j.kind === 'fork' ? out.branchFeet : out.mergeFeet).push(f)
      subTop = Math.max(subTop, j.y)
    } else {
      subBot = Math.min(subBot, j.y)
    }
  }
  return { ...out, caretY: (subTop + subBot) / 2 }
}
