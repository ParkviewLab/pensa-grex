// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The pure layout engine: the domain model + measured sizes -> pixel positions
// for every station, dot, cursor, track, and junction, plus the overall canvas
// bounds. No DOM — see layout/measure.js for where the sizes this consumes come
// from, and docs/model_ideas.md for the rules this implements (bottom-up growth,
// junctions in the open gap between stations, left/right alternation). A
// project's name lives on its root-node card, so there is no separate tree title.
//
// Every branch rejoins the trunk it left, so there are two kinds of lateral line: a
// branch line leaving a fork junction, and a return line arriving at a merge junction.
// Both are drawn the same way, and the shared row grid is what makes that safe: one y per
// row for every lane means the space between two rows is empty at every lane at once, so a
// lateral run placed in that band crosses trunk lines and nothing else. Where it does
// cross one, the lateral line hops and the trunk runs unbroken (docs/model_v3_ideas.md,
// sections 9 and 10).

import { assignRows, buildRowGrid, assignLanes } from './geometry.js'

const DEFAULTS = {
  laneStep: 228, // fixed card width (188) + a horizontal gap between lanes
  rowGap: 40, // vertical clearance between one row's card and the next
  junctionExtra: 30, // extra clearance in a gap that carries a junction
  baseY: 0, // row 0's card-top y, before the final shift to positive bounds
  anchorGap: 14, // how far a dot/sputnik sits above its own row's card top
  dotRadius: 6, // half a station dot (style.css .dot{width:11px}), rounded up
  junctionInset: 16, // how far a junction sits clear of the node bounding its edge
  // Half the width of the little arc a lateral line hops with, which is also how far the
  // arc rises above the run. It has to match trackPath's radius in render/tracks.js, since
  // this is the number the clearance is reserved from and that is the number drawn.
  hopRadius: 6,
  treeGap: 90, // horizontal gap between two trees' bounding boxes
  margin: 40, // canvas margin on every side
}

export function computeDomainLayout(model, sizes, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  // A node's space runs from the top of its dot to the bottom of its card, and no crossing
  // may fall in it (docs/model_v3_ideas.md, section 7), so the band a lateral run uses
  // starts above the dots rather than at the card tops.
  const nodeClear = o.anchorGap + o.dotRadius
  // A gap carrying junctions has to hold one clear of the node at each end and still leave
  // a hop room to arc between them. That is a floor under the clearance such a gap gets,
  // not a free choice; a gap carrying none never has a lateral run in it, since a run's
  // height comes from its own junction.
  o.junctionExtra = Math.max(o.junctionExtra, 2 * o.junctionInset + 2 * o.hopRadius + nodeClear - o.rowGap)

  if (model.trees.length === 0) {
    return { stations: [], dots: [], cursors: [], tracks: [], junctions: [], bounds: { w: o.margin * 2, h: o.margin * 2 }, metrics: o }
  }

  const row = assignRows(model)
  const { cardTopY, tallestByRow } = buildRowGrid(model, row, sizes, o)
  const { lineOfTask, lane } = assignLanes(model, row)
  const anchorYForRow = (r) => cardTopY.get(r) - o.anchorGap

  const rawX = new Map()
  for (const id of model.nodes.keys()) rawX.set(id, lane.get(lineOfTask.get(id)) * o.laneStep)

  // ---- the clearance band in a gap ----
  // Growth is upward, so y decreases as the row index rises: the band in the gap
  // (r, r+1) runs from just above the dots of row r to just below the bottom of the
  // TALLEST card at row r+1. Anchored to the row, not to one card's own height, or a
  // lateral run leaving a short card would sit where a taller card in the same row still
  // is. Every lane is empty across that band, which is what buildRowGrid buys.
  const bandLowY = (r) => cardTopY.get(r) - nodeClear // the larger y: above row r's dots
  const bandHighY = (r) => cardTopY.get(r + 1) + (tallestByRow.get(r + 1) || 0)
  const inBand = (r, y) => {
    if (!cardTopY.has(r + 1)) return Math.min(y, bandLowY(r) - o.hopRadius)
    const high = bandHighY(r) + o.hopRadius
    const low = bandLowY(r) - o.hopRadius
    return Math.max(high, Math.min(low, y))
  }
  // A branch point is drawn just above the node below its edge, a merge point just below
  // the node above its edge, at every edge whether or not it has been stretched. Two
  // uniform conventions, so a fork always reads as leaving the node it follows and a join
  // as arriving at the node it precedes; on a bubble, where both junctions share one edge,
  // it is what keeps them apart.
  const forkJunctionY = (r) => inBand(r, bandLowY(r) - o.junctionInset)
  const mergeJunctionY = (r) => inBand(r, bandHighY(r) + o.junctionInset)

  function cardBox(id) {
    const { cardW, cardH } = sizes.get(id)
    const top = cardTopY.get(row.get(id))
    const x = rawX.get(id)
    return { x, top, cardW, cardH, left: x - cardW / 2, right: x + cardW / 2, bottom: top + cardH }
  }

  // ---- per-tree bounding box (pre-packing space) ----
  const tasksByTree = new Map(model.trees.map((t) => [t.id, []]))
  for (const id of model.nodes.keys()) tasksByTree.get(model.getTreeIdForTask(id)).push(id)

  const treeBBox = new Map()
  for (const tree of model.trees) {
    let minX = Infinity, maxX = -Infinity, maxBottom = -Infinity
    for (const id of tasksByTree.get(tree.id)) {
      const box = cardBox(id)
      minX = Math.min(minX, box.left)
      maxX = Math.max(maxX, box.right)
      maxBottom = Math.max(maxBottom, box.bottom)
    }
    treeBBox.set(tree.id, { minX, maxX, maxBottom })
  }

  // ---- pack trees left to right by bounding box ----
  const treeOffsetX = new Map()
  let packCursor = 0
  for (const tree of model.trees) {
    const bbox = treeBBox.get(tree.id)
    const offset = packCursor - bbox.minX
    treeOffsetX.set(tree.id, offset)
    packCursor = bbox.maxX + offset + o.treeGap
  }
  const finalX = (id) => rawX.get(id) + treeOffsetX.get(model.getTreeIdForTask(id))

  // ---- stations, dots, cursors ----
  const stations = []
  let minY = Infinity, maxY = -Infinity
  for (const [id, task] of model.nodes) {
    const box = cardBox(id)
    const x = finalX(id)
    const anchorY = anchorYForRow(row.get(id))
    stations.push({
      id, x, cardTop: box.top, cardW: box.cardW, cardH: box.cardH, anchorY,
      title: task.title, status: task.status, cursor: !!task.here, note: !!task.note,
    })
    minY = Math.min(minY, anchorY)
    maxY = Math.max(maxY, box.bottom)
  }
  const dots = stations.filter((s) => !s.cursor).map((s) => ({ x: s.x, y: s.anchorY }))
  const cursors = stations.filter((s) => s.cursor).map((s) => ({ x: s.x, y: s.anchorY }))

  // ---- tracks: one straight riser per line, anchor to anchor ----
  const linesByStart = new Map()
  for (const id of model.nodes.keys()) {
    const start = lineOfTask.get(id)
    if (!linesByStart.has(start)) linesByStart.set(start, [])
    linesByStart.get(start).push(id)
  }
  // The rows a line's own cards occupy, which is where its riser is drawn. Not the range
  // assignLanes packs against: that one also covers the reach of the line's return, which
  // matters for lanes and not for a riser.
  const lineCardRows = new Map()
  for (const [start, ids] of linesByStart) {
    const rows = ids.map((id) => row.get(id))
    lineCardRows.set(start, { min: Math.min(...rows), max: Math.max(...rows) })
  }
  const tracks = []
  for (const ids of linesByStart.values()) {
    const sorted = ids.slice().sort((a, b) => row.get(a) - row.get(b))
    const x = finalX(sorted[0])
    const yBottom = anchorYForRow(row.get(sorted[0]))
    const yTop = anchorYForRow(row.get(sorted[sorted.length - 1]))
    tracks.push({ points: [[x, yBottom], [x, yTop]], kind: 'riser' })
  }

  // ---- fork junctions and branch lines ----
  // Two or more branches leaving one node share ONE diamond, keyed by that node rather
  // than one per branch. Each branch line then runs laterally in the gap's band to its own
  // lane and rises into its first card.
  //
  // Branches off one diamond therefore share the near part of their run, the shorter being
  // a prefix of the longer, which is truthful: they do leave one junction, and v2 said the
  // same thing with one tilted ray. What the record asks for and this does not do is give
  // two UNRELATED runs wanting the same band on the same side a band each, at the cost of a
  // row. Measured over the nine live domains, every overlapping pair of runs (137 of them)
  // is a pair sharing a junction, and no unrelated pair arises at all, so that case is left
  // open rather than built on speculation.
  const junctionByKey = new Map()
  for (const [id, task] of model.nodes) {
    if (!task.branches.length) continue
    const gap = row.get(id)
    const junctionY = forkJunctionY(gap)
    const parentX = finalX(id)
    if (!junctionByKey.has(id)) {
      junctionByKey.set(id, { x: parentX, y: junctionY })
      // Connect the parent up (or down) to the junction where the junction falls outside
      // the parent line's own riser — a fork off a line's tip would otherwise leave the
      // diamond floating, disconnected (docs/tree-layout.md).
      const pr = lineCardRows.get(lineOfTask.get(id))
      const riserTopY = anchorYForRow(pr.max)
      const riserBottomY = anchorYForRow(pr.min)
      if (junctionY < riserTopY) tracks.push({ points: [[parentX, riserTopY], [parentX, junctionY]], kind: 'riser' })
      else if (junctionY > riserBottomY) tracks.push({ points: [[parentX, riserBottomY], [parentX, junctionY]], kind: 'riser' })
    }
    for (const b of task.branches) {
      const branchX = finalX(b.child)
      tracks.push({
        points: [[parentX, junctionY], [branchX, junctionY], [branchX, anchorYForRow(row.get(b.child))]],
        kind: 'branch',
      })
    }
  }

  // ---- merge junctions and return lines ----
  // A return leaves the top of its branch, rises into the band below the node above its
  // merge point, and runs laterally in to the trunk. Two branches naming the same merge
  // point share one diamond, which is an n-way join at no cost in the schema.
  for (const [id, node] of model.nodes) {
    if (!node.mergePoint) continue
    const merge = model.getNode(node.mergePoint)
    if (!merge || !merge.next || !model.getNode(merge.next)) continue
    const gap = row.get(merge.next) - 1
    const junctionY = mergeJunctionY(gap)
    const trunkX = finalX(node.mergePoint)
    const tipX = finalX(id)
    const key = 'merge:' + node.mergePoint
    if (!junctionByKey.has(key)) junctionByKey.set(key, { x: trunkX, y: junctionY })
    tracks.push({
      points: [[tipX, anchorYForRow(row.get(id))], [tipX, junctionY], [trunkX, junctionY]],
      kind: 'return',
    })
  }
  const junctions = Array.from(junctionByKey.values())

  // ---- line hops ----
  // A crossing must not be mistakable for a junction, so where a lateral run crosses a
  // vertical the lateral one hops. That is always well defined: a lateral run only ever
  // reaches past lines nearer the spine than its own lane, so the outer line hops and the
  // inner one carries on unbroken. Every vertical any track draws counts, since a branch's
  // riser and a return's are as much a line to follow as a trunk is.
  const verticals = []
  for (const tr of tracks) {
    for (let i = 1; i < tr.points.length; i++) {
      const [x1, y1] = tr.points[i - 1]
      const [x2, y2] = tr.points[i]
      if (x1 === x2 && y1 !== y2) verticals.push({ x: x1, yMin: Math.min(y1, y2), yMax: Math.max(y1, y2) })
    }
  }
  for (const tr of tracks) {
    const hops = new Set()
    for (let i = 1; i < tr.points.length; i++) {
      const [x1, y1] = tr.points[i - 1]
      const [x2, y2] = tr.points[i]
      if (y1 !== y2 || x1 === x2) continue
      for (const v of verticals) {
        if ((v.x - x1) * (v.x - x2) >= 0) continue // not strictly between the run's ends
        // The vertical has to pass THROUGH this height, not merely end at it: two returns
        // arriving at one merge junction meet there legitimately, and a hump over a line one
        // is joining would deny the join it is drawing.
        if (y1 <= v.yMin || y1 >= v.yMax) continue
        hops.add(v.x)
      }
    }
    if (hops.size) tr.hops = [...hops]
  }

  // ---- shift everything so the smallest x/y lands at (margin, margin) ----
  let minX = Infinity, maxX = -Infinity
  for (const s of stations) { minX = Math.min(minX, s.x - s.cardW / 2); maxX = Math.max(maxX, s.x + s.cardW / 2) }
  const dx = o.margin - minX
  const dy = o.margin - minY
  const shiftX = (x) => x + dx
  const shiftY = (y) => y + dy

  for (const s of stations) { s.x = shiftX(s.x); s.cardTop = shiftY(s.cardTop); s.anchorY = shiftY(s.anchorY) }
  for (const d of dots) { d.x = shiftX(d.x); d.y = shiftY(d.y) }
  for (const c of cursors) { c.x = shiftX(c.x); c.y = shiftY(c.y) }
  for (const j of junctions) { j.x = shiftX(j.x); j.y = shiftY(j.y) }
  for (const tr of tracks) {
    tr.points = tr.points.map(([x, y]) => [shiftX(x), shiftY(y)])
    if (tr.hops) tr.hops = tr.hops.map(shiftX)
  }

  const bounds = { w: maxX - minX + 2 * o.margin, h: maxY - minY + 2 * o.margin }

  // The resolved constants ride along with the drawing, so that a consumer (a test, a
  // measurement, a future overlay) reads the numbers the engine actually used rather than
  // restating them and drifting from them.
  return { stations, dots, cursors, tracks, junctions, bounds, metrics: o }
}
