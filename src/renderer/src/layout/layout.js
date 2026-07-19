// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pure layout engine: forest model + measured sizes -> pixel positions
// for every station, dot, cursor, track, junction, and tree title, plus the
// overall canvas bounds. No DOM — see layout/measure.js for where the sizes
// this consumes come from, and docs/model_ideas.md for the rules this
// implements (bottom-up growth, junctions in the open gap between stations,
// left/right alternation, a tree's name below its root).

import { assignRows, buildRowGrid, assignLanes } from './geometry.js'

const DEFAULTS = {
  laneStep: 178, // fixed card width (138) + a horizontal gap between lanes
  rowGap: 40, // vertical clearance between one row's card and the next
  junctionExtra: 30, // extra clearance in a gap that carries a fork junction
  baseY: 0, // row 0's card-top y, before the final shift to positive bounds
  anchorGap: 14, // how far a dot/sputnik sits above its own row's card top
  titleGap: 20, // gap between a root card's bottom and its tree title
  treeGap: 90, // horizontal gap between two trees' bounding boxes
  margin: 40, // canvas margin on every side
}

export function computeForestLayout(forest, sizes, titleSizes, opts = {}) {
  const o = { ...DEFAULTS, ...opts }

  if (forest.trees.length === 0) {
    return { stations: [], dots: [], cursors: [], tracks: [], junctions: [], titles: [], bounds: { w: o.margin * 2, h: o.margin * 2 } }
  }

  const row = assignRows(forest)
  const { cardTopY } = buildRowGrid(forest, row, sizes, o)
  const { lineOfTask, lineRows, lane } = assignLanes(forest, row)
  const anchorYForRow = (r) => cardTopY.get(r) - o.anchorGap

  const rawX = new Map()
  for (const id of forest.tasks.keys()) rawX.set(id, lane.get(lineOfTask.get(id)) * o.laneStep)

  function cardBox(id) {
    const { cardW, cardH } = sizes.get(id)
    const top = cardTopY.get(row.get(id))
    const x = rawX.get(id)
    return { x, top, cardW, cardH, left: x - cardW / 2, right: x + cardW / 2, bottom: top + cardH }
  }

  // ---- per-tree bounding box (pre-packing space), title footprint included ----
  const tasksByTree = new Map(forest.trees.map((t) => [t.id, []]))
  for (const id of forest.tasks.keys()) tasksByTree.get(forest.getTreeIdForTask(id)).push(id)

  const treeBBox = new Map()
  const treeTitleY = new Map()
  for (const tree of forest.trees) {
    let minX = Infinity, maxX = -Infinity, maxBottom = -Infinity
    for (const id of tasksByTree.get(tree.id)) {
      const box = cardBox(id)
      minX = Math.min(minX, box.left)
      maxX = Math.max(maxX, box.right)
      maxBottom = Math.max(maxBottom, box.bottom)
    }
    const rootBox = cardBox(tree.rootTaskId)
    const titleY = rootBox.bottom + o.titleGap
    const { titleW = 0, titleH = 0 } = titleSizes.get(tree.id) || {}
    minX = Math.min(minX, rootBox.x - titleW / 2)
    maxX = Math.max(maxX, rootBox.x + titleW / 2)
    maxBottom = Math.max(maxBottom, titleY + titleH)
    treeTitleY.set(tree.id, titleY)
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
  for (const id of forest.tasks.keys()) {
    const start = lineOfTask.get(id)
    if (!linesByStart.has(start)) linesByStart.set(start, [])
    linesByStart.get(start).push(id)
  }
  const tracks = []
  for (const ids of linesByStart.values()) {
    const sorted = ids.slice().sort((a, b) => row.get(a) - row.get(b))
    const x = finalX(sorted[0])
    const yBottom = anchorYForRow(row.get(sorted[0]))
    const yTop = anchorYForRow(row.get(sorted[sorted.length - 1]))
    tracks.push({ points: [[x, yBottom], [x, yTop]] })
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
      const parentRow = row.get(id)
      let lowerRow, upperRow, upperId
      if (b.at === 'below') {
        if (task.predecessorId == null) {
          // A root has no predecessor to fork "below" — fall back to
          // attaching above rather than producing a degenerate gap.
          lowerRow = parentRow; upperRow = parentRow + 1; upperId = task.next
        } else {
          lowerRow = parentRow - 1; upperRow = parentRow; upperId = id
        }
      } else {
        lowerRow = parentRow; upperRow = parentRow + 1; upperId = task.next
      }
      const lowerTop = cardTopY.get(lowerRow)
      const upperBottom = upperId ? cardBox(upperId).bottom : anchorYForRow(upperRow)
      const junctionY = (lowerTop + upperBottom) / 2
      const parentX = finalX(id)
      const branchX = finalX(b.child)
      const branchAnchorY = anchorYForRow(upperRow)

      const key = id + ':' + lowerRow
      if (!junctionByKey.has(key)) {
        junctionByKey.set(key, { x: parentX, y: junctionY })
        // Connect the parent up (or down) to the junction when the junction
        // falls outside the parent line's riser — a fork off a line tip would
        // otherwise leave the diamond floating, disconnected (docs/tree-layout.md).
        const pr = lineRows.get(lineOfTask.get(id))
        const riserTopY = anchorYForRow(pr.max) // highest point of the riser (smallest y)
        const riserBottomY = anchorYForRow(pr.min) // lowest point (largest y)
        if (junctionY < riserTopY) tracks.push({ points: [[parentX, riserTopY], [parentX, junctionY]] })
        else if (junctionY > riserBottomY) tracks.push({ points: [[parentX, riserBottomY], [parentX, junctionY]] })
      }
      tracks.push({ points: [[parentX, junctionY], [branchX, junctionY], [branchX, branchAnchorY]] })
    }
  }
  const junctions = Array.from(junctionByKey.values())

  // ---- tree titles ----
  const titles = forest.trees.map((tree) => ({
    treeId: tree.id, text: tree.name, x: finalX(tree.rootTaskId), y: treeTitleY.get(tree.id),
  }))
  for (const t of titles) maxY = Math.max(maxY, t.y + (titleSizes.get(t.treeId)?.titleH || 0))

  // ---- shift everything so the smallest x/y lands at (margin, margin) ----
  let minX = Infinity, maxX = -Infinity
  for (const s of stations) { minX = Math.min(minX, s.x - s.cardW / 2); maxX = Math.max(maxX, s.x + s.cardW / 2) }
  for (const t of titles) {
    const w = titleSizes.get(t.treeId)?.titleW || 0
    minX = Math.min(minX, t.x - w / 2); maxX = Math.max(maxX, t.x + w / 2)
  }
  const dx = o.margin - minX
  const dy = o.margin - minY
  const shiftX = (x) => x + dx
  const shiftY = (y) => y + dy

  for (const s of stations) { s.x = shiftX(s.x); s.cardTop = shiftY(s.cardTop); s.anchorY = shiftY(s.anchorY) }
  for (const d of dots) { d.x = shiftX(d.x); d.y = shiftY(d.y) }
  for (const c of cursors) { c.x = shiftX(c.x); c.y = shiftY(c.y) }
  for (const j of junctions) { j.x = shiftX(j.x); j.y = shiftY(j.y) }
  for (const tr of tracks) tr.points = tr.points.map(([x, y]) => [shiftX(x), shiftY(y)])
  for (const t of titles) { t.x = shiftX(t.x); t.y = shiftY(t.y) }

  const bounds = { w: maxX - minX + 2 * o.margin, h: maxY - minY + 2 * o.margin }

  return { stations, dots, cursors, tracks, junctions, titles, bounds }
}
