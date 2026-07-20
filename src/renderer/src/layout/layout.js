// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pure layout engine: forest model + measured sizes -> pixel positions
// for every station, dot, cursor, track, and junction, plus the overall canvas
// bounds. No DOM — see layout/measure.js for where the sizes this consumes come
// from, and docs/model_ideas.md for the rules this implements (bottom-up growth,
// junctions in the open gap between stations, left/right alternation). A
// project's name lives on its root-node card, so there is no separate tree title.

import { assignRows, buildRowGrid, assignLanes } from './geometry.js'

const DEFAULTS = {
  laneStep: 178, // fixed card width (138) + a horizontal gap between lanes
  rowGap: 40, // vertical clearance between one row's card and the next
  junctionExtra: 30, // extra clearance in a gap that carries a fork junction
  baseY: 0, // row 0's card-top y, before the final shift to positive bounds
  anchorGap: 14, // how far a dot/sputnik sits above its own row's card top
  treeGap: 90, // horizontal gap between two trees' bounding boxes
  margin: 40, // canvas margin on every side
  // Branch connectors angle upward at ONE constant slope: every leg rises this much
  // above horizontal, so all branches off a junction share a single ray and their
  // cards staircase up along it, each lifted by its own leg's rise (docs/tree-layout.md).
  branchTiltTan: Math.tan((12 * Math.PI) / 180), // 12° above horizontal = 78° from the vertical trunk
}

export function computeForestLayout(forest, sizes, opts = {}) {
  const o = { ...DEFAULTS, ...opts }

  if (forest.trees.length === 0) {
    return { stations: [], dots: [], cursors: [], tracks: [], junctions: [], bounds: { w: o.margin * 2, h: o.margin * 2 } }
  }

  const row = assignRows(forest)
  const { cardTopY } = buildRowGrid(forest, row, sizes, o)
  const { lineOfTask, lineRows, lane } = assignLanes(forest, row)
  const anchorYForRow = (r) => cardTopY.get(r) - o.anchorGap

  const rawX = new Map()
  for (const id of forest.tasks.keys()) rawX.set(id, lane.get(lineOfTask.get(id)) * o.laneStep)

  // ---- per-branch upward offset ----
  // Angling a branch up should carry the branch, and everything growing along
  // it, up in y by the leg's rise, so it grows up along the angle instead of
  // dropping back to a flat row. Each fork lifts its branch line by that leg's
  // rise; nested forks accumulate. See docs/tree-layout.md.
  const baseBottom = (id) => cardTopY.get(row.get(id)) + sizes.get(id).cardH

  // The row/junction/rise geometry of one fork, read off the base (un-offset)
  // grid; shared by the offset pass below and the connector emission later, so
  // the elbow's rise and the branch's lift are always the same number.
  function forkGeom(id, task, b) {
    const parentRow = row.get(id)
    let lowerRow, upperRow, upperId
    if (b.at === 'below') {
      if (task.predecessorId == null) { lowerRow = parentRow; upperRow = parentRow + 1; upperId = task.next }
      else { lowerRow = parentRow - 1; upperRow = parentRow; upperId = id }
    } else {
      lowerRow = parentRow; upperRow = parentRow + 1; upperId = task.next
    }
    const lowerTop = cardTopY.get(lowerRow)
    const upperBottom = upperId ? baseBottom(upperId) : anchorYForRow(upperRow)
    const junctionY = (lowerTop + upperBottom) / 2
    const anchorY = anchorYForRow(upperRow)
    // One angle for every leg, regardless of how far out its lane is: all branches
    // off a junction then lie along a single ray and their cards staircase up it.
    // Raising the card in lockstep (see the offset pass) keeps the riser positive,
    // so no cap is needed to stop it inverting.
    const rise = Math.abs(rawX.get(b.child) - rawX.get(id)) * o.branchTiltTan
    return { lowerRow, upperRow, upperId, junctionY, anchorY, rise }
  }

  // Each branch line (a branch child starts a line) records its spawning fork's
  // parent line and leg rise; a line's total offset is its parent's plus its own
  // leg rise, with trunk lines at zero.
  const forkOfLine = new Map()
  for (const [id, task] of forest.tasks) {
    for (const b of task.branches) {
      forkOfLine.set(b.child, { parent: lineOfTask.get(id), rise: forkGeom(id, task, b).rise })
    }
  }
  const off = new Map()
  const offOfLine = (lineId) => {
    if (off.has(lineId)) return off.get(lineId)
    const f = forkOfLine.get(lineId)
    const v = f ? offOfLine(f.parent) + f.rise : 0
    off.set(lineId, v)
    return v
  }
  const offOf = (id) => offOfLine(lineOfTask.get(id))
  const anchorYOf = (id) => anchorYForRow(row.get(id)) - offOf(id)

  function cardBox(id) {
    const { cardW, cardH } = sizes.get(id)
    const top = cardTopY.get(row.get(id)) - offOf(id)
    const x = rawX.get(id)
    return { x, top, cardW, cardH, left: x - cardW / 2, right: x + cardW / 2, bottom: top + cardH }
  }

  // ---- per-tree bounding box (pre-packing space) ----
  const tasksByTree = new Map(forest.trees.map((t) => [t.id, []]))
  for (const id of forest.tasks.keys()) tasksByTree.get(forest.getTreeIdForTask(id)).push(id)

  const treeBBox = new Map()
  for (const tree of forest.trees) {
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
  for (const tree of forest.trees) {
    const bbox = treeBBox.get(tree.id)
    const offset = packCursor - bbox.minX
    treeOffsetX.set(tree.id, offset)
    packCursor = bbox.maxX + offset + o.treeGap
  }
  const finalX = (id) => rawX.get(id) + treeOffsetX.get(forest.getTreeIdForTask(id))

  // ---- stations, dots, cursors ----
  const stations = []
  let minY = Infinity, maxY = -Infinity
  for (const [id, task] of forest.tasks) {
    const box = cardBox(id)
    const x = finalX(id)
    const anchorY = anchorYOf(id)
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
  for (const id of forest.tasks.keys()) {
    const start = lineOfTask.get(id)
    if (!linesByStart.has(start)) linesByStart.set(start, [])
    linesByStart.get(start).push(id)
  }
  const tracks = []
  for (const ids of linesByStart.values()) {
    const sorted = ids.slice().sort((a, b) => row.get(a) - row.get(b))
    const x = finalX(sorted[0])
    const yBottom = anchorYOf(sorted[0])
    const yTop = anchorYOf(sorted[sorted.length - 1])
    tracks.push({ points: [[x, yBottom], [x, yTop]], kind: 'riser' })
  }

  // ---- fork junctions + branch connector tracks ----
  // A junction sits at the midpoint between the specific lower task's card
  // top and the specific upper task's card bottom — real edges of the two
  // actual cards involved, not a row-generic estimate, so it is always in
  // the genuinely empty space buildRowGrid guaranteed exists between them.
  // Two (or more) branches forking from the same attachment point (e.g. a
  // task with several .branches at the same .at) share ONE diamond, keyed
  // by that point, not one per branch.
  const junctionByKey = new Map()
  for (const [id, task] of forest.tasks) {
    for (const b of task.branches) {
      const g = forkGeom(id, task, b)
      const offParent = offOf(id)
      const junctionY = g.junctionY - offParent
      const parentX = finalX(id)
      const branchX = finalX(b.child)
      // The branch card is lifted by this leg's rise on top of the parent line,
      // so it grows up along the angle (offOf(b.child) === offParent + g.rise).
      const branchAnchorY = g.anchorY - offOf(b.child)

      const key = id + ':' + g.lowerRow
      if (!junctionByKey.has(key)) {
        junctionByKey.set(key, { x: parentX, y: junctionY })
        // Connect the parent up (or down) to the junction when the junction
        // falls outside the parent line's riser — a fork off a line tip would
        // otherwise leave the diamond floating, disconnected (docs/tree-layout.md).
        const pr = lineRows.get(lineOfTask.get(id))
        const riserTopY = anchorYForRow(pr.max) - offParent // highest point of the riser (smallest y)
        const riserBottomY = anchorYForRow(pr.min) - offParent // lowest point (largest y)
        if (junctionY < riserTopY) tracks.push({ points: [[parentX, riserTopY], [parentX, junctionY]], kind: 'riser' })
        else if (junctionY > riserBottomY) tracks.push({ points: [[parentX, riserBottomY], [parentX, junctionY]], kind: 'riser' })
      }
      // Tilt the flat leg up ~12° to the elbow, then a vertical riser into the
      // lifted branch card (docs/tree-layout.md). The elbow and the card both rise
      // by g.rise, so the leg keeps its 12° and the riser keeps its length; the
      // diamond stays at [parentX, junctionY].
      const dir = Math.sign(branchAnchorY - junctionY) // -1 for an above-branch, +1 for a below-branch
      const elbowY = junctionY + dir * g.rise
      tracks.push({ points: [[parentX, junctionY], [branchX, elbowY], [branchX, branchAnchorY]], kind: 'branch' })
    }
  }
  const junctions = Array.from(junctionByKey.values())

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
  for (const tr of tracks) tr.points = tr.points.map(([x, y]) => [shiftX(x), shiftY(y)])

  const bounds = { w: maxX - minX + 2 * o.margin, h: maxY - minY + 2 * o.margin }

  return { stations, dots, cursors, tracks, junctions, bounds }
}
