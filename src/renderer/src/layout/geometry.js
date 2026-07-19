// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Pure geometry helpers for the layout engine: row assignment, the vertical
// row grid, and horizontal lane packing. No DOM; every input is plain data
// (a forest model — see model/forest.js — plus measured sizes).
//
// Card width is fixed (every station is the same width; see style.css
// .card{width:138px}), so horizontal placement doesn't need general
// variable-width contour packing — an integer "lane" per line (0 = trunk,
// negative = left, positive = right) at a fixed per-lane x-step is enough,
// and two lines that never occupy the same row can safely share a lane for
// tight packing. If stations ever become variable-width this would need to
// become real contour packing; until then this is the simpler, equally
// correct approach.

// Row 0 is every tree's root; a main-line successor (.next) is +1. A branch
// child starts at its parent's row +1 for at:'above' (level with the
// parent's own .next — a fork's branches and its main-line continuation
// begin at the same height) or at the parent's own row for at:'below'
// (level with the parent itself, one gap lower).
export function assignRows(forest) {
  const row = new Map()
  for (const tree of forest.trees) {
    const stack = [[tree.rootTaskId, 0]]
    while (stack.length) {
      const [id, r] = stack.pop()
      if (row.has(id)) continue
      row.set(id, r)
      const task = forest.getTask(id)
      if (!task) continue
      if (task.next) stack.push([task.next, r + 1])
      for (const b of task.branches) {
        stack.push([b.child, b.at === 'below' ? r : r + 1])
      }
    }
  }
  return row
}

// The lower row index of every gap (r, r+1) that carries at least one fork
// junction — used to widen that gap's pitch so the diamond has room.
export function junctionGaps(forest, row) {
  const gaps = new Set()
  for (const [id, task] of forest.tasks) {
    for (const b of task.branches) {
      const r = row.get(id)
      gaps.add(b.at === 'below' ? r - 1 : r)
    }
  }
  return gaps
}

// The vertical grid: cardTopY(r) for every occupied row, spaced by however
// tall the tallest card at row r+1 actually is (measured), plus a fixed gap,
// plus extra clearance where a junction sits. Growth is upward, so y
// decreases as r increases; row 0 sits at baseY.
export function buildRowGrid(forest, row, sizes, { rowGap, junctionExtra, baseY }) {
  const tasksByRow = new Map()
  for (const [id, r] of row) {
    if (!tasksByRow.has(r)) tasksByRow.set(r, [])
    tasksByRow.get(r).push(id)
  }
  const maxRow = tasksByRow.size ? Math.max(...tasksByRow.keys()) : 0
  const gapsWithJunction = junctionGaps(forest, row)

  const cardTopY = new Map([[0, baseY]])
  for (let r = 1; r <= maxRow; r++) {
    const ids = tasksByRow.get(r) || []
    const tallest = ids.length ? Math.max(...ids.map((id) => sizes.get(id).cardH)) : 0
    const pitch = tallest + rowGap + (gapsWithJunction.has(r - 1) ? junctionExtra : 0)
    cardTopY.set(r, cardTopY.get(r - 1) - pitch)
  }
  return { cardTopY, tasksByRow, maxRow }
}

function rangesOverlap(a, b) {
  return a.min <= b.max && b.min <= a.max
}

// Every task belongs to exactly one "line" (docs/model_ideas.md): the chain
// reached by .next from a tree root or a branch child. Assigns each line an
// integer lane, per tree (trunk = lane 0), packing lines whose row-ranges
// never overlap onto the same lane on the same side.
export function assignLanes(forest, row) {
  const lineOfTask = new Map() // taskId -> the line's own start-task id
  const lineRows = new Map() // lineId -> {min,max}
  const treeOfLine = new Map() // lineId -> the tree root's task id
  const lane = new Map() // lineId -> integer lane, relative to its tree's trunk
  const laneOccupancy = new Map() // treeRootId -> Map<lane, [{min,max}, ...]>

  function walkLine(startId) {
    const ids = []
    let id = startId
    while (id) {
      ids.push(id)
      lineOfTask.set(id, startId)
      const task = forest.getTask(id)
      id = task ? task.next : null
    }
    lineRows.set(startId, { min: Math.min(...ids.map((i) => row.get(i))), max: Math.max(...ids.map((i) => row.get(i))) })
    return ids
  }

  function placeLane(treeRootId, lineId, side) {
    const occ = laneOccupancy.get(treeRootId)
    const rows = lineRows.get(lineId)
    const step = side === 'left' ? -1 : 1
    const maxLanes = forest.tasks.size + 1 // a generous, always-sufficient bound
    for (let i = 1, candidate = step; i <= maxLanes; i++, candidate += step) {
      const existing = occ.get(candidate) || []
      if (!existing.some((r) => rangesOverlap(r, rows))) {
        occ.set(candidate, existing.concat([rows]))
        lane.set(lineId, candidate)
        return
      }
    }
    throw new Error('assignLanes: could not place line "' + lineId + '" — this should be unreachable')
  }

  function discover(startId, treeRootId) {
    const ids = walkLine(startId)
    treeOfLine.set(startId, treeRootId)
    ids.forEach((id) => {
      const task = forest.getTask(id)
      task.branches.forEach((b, idx) => {
        const side = b.side === 'left' || b.side === 'right' ? b.side : (idx % 2 === 0 ? 'left' : 'right')
        walkLine(b.child) // populate lineRows for the child before placing its lane
        placeLane(treeRootId, b.child, side)
        discover(b.child, treeRootId)
      })
    })
  }

  for (const tree of forest.trees) {
    lane.set(tree.rootTaskId, 0)
    walkLine(tree.rootTaskId)
    treeOfLine.set(tree.rootTaskId, tree.rootTaskId)
    laneOccupancy.set(tree.rootTaskId, new Map([[0, [lineRows.get(tree.rootTaskId)]]]))
    discover(tree.rootTaskId, tree.rootTaskId)
  }

  return { lineOfTask, lineRows, lane, treeOfLine }
}
