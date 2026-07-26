// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Pure geometry helpers for the layout engine: row assignment, the vertical
// row grid, and horizontal lane packing. No DOM; every input is plain data
// (a domain model — see model/model.js — plus measured sizes).
//
// Horizontal placement (assignLanes) is a subtree-aware band packer: each branch
// reserves a contiguous band of lanes wide enough for its whole subtree, packed
// first-fit against the row ranges already placed on that side, so two subtrees whose
// rows never overlap share lanes while bands that would collide grow outward. Card
// width is fixed (style.css .card{width:138px}), so lanes are integers at a fixed
// per-lane x-step rather than real per-row contours. The algorithm, its lineage
// (Reingold-Tilford / Walker / Buchheim / van der Ploeg) and this variant are
// written up in docs/tree-layout.md.

// Row 0 is every plan's base, and every other node sits one row above whatever it has
// to clear. Three constraints say what that means: a trunk's own order (a .next is one
// row above), a branch's foot one row above the node it leaves, and the node above a
// join edge one row above the branch tip whose return lands there. Rows are then the
// longest path in that constraint graph, which is the tightest assignment satisfying
// all three at once.
//
// Two things make that safe. The merge rules forbid a merge below its own branch point,
// so the graph is acyclic and the computation cannot fail; and a constraint puts no
// maximum on an edge's length, so a branch taller than the gap it spans simply stretches
// its parent trunk between the branch point and the merge point. Height is the only cost
// (docs/model_v3_ideas.md, section 9).
//
// Before merges this was a plain depth-first walk, because a branch owed the trunk
// nothing: it grew in its own lane while the trunk carried on up the same grid, and no
// two paths ever had to be reconciled. A return is what ends that.
export function assignRows(model) {
  const above = new Map() // id -> the ids that must sit at least one row above it
  const indegree = new Map()
  for (const id of model.nodes.keys()) {
    above.set(id, [])
    indegree.set(id, 0)
  }
  const constrain = (lowerId, upperId) => {
    if (!above.has(lowerId) || !indegree.has(upperId)) return
    above.get(lowerId).push(upperId)
    indegree.set(upperId, indegree.get(upperId) + 1)
  }
  for (const [id, node] of model.nodes) {
    if (node.next) constrain(id, node.next)
    for (const b of node.branches) constrain(id, b.child)
    // A return arrives at whatever sits above its merge point, so that node cannot be
    // drawn level with, or below, the branch tip the return leaves.
    if (node.mergePoint) {
      const merge = model.getNode(node.mergePoint)
      if (merge && merge.next) constrain(id, merge.next)
    }
  }

  const row = new Map()
  const queue = []
  for (const id of model.nodes.keys()) {
    if (indegree.get(id) === 0) {
      row.set(id, 0)
      queue.push(id)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]
    for (const upper of above.get(id)) {
      row.set(upper, Math.max(row.has(upper) ? row.get(upper) : 0, row.get(id) + 1))
      indegree.set(upper, indegree.get(upper) - 1)
      if (indegree.get(upper) === 0) queue.push(upper)
    }
  }
  // A cycle leaves its members unplaced. validateRecord refuses one, so this is reached
  // only by a record that got past it; put them on row 0 rather than let the whole
  // drawing vanish.
  for (const id of model.nodes.keys()) if (!row.has(id)) row.set(id, 0)
  return row
}

// The lower row index of every gap (r, r+1) that carries a junction, so buildRowGrid can
// widen that gap. A fork leaves the gap above the node holding it, so that gap is the
// node's own row; a return joins the gap below the node above its merge point.
export function junctionGaps(model, row) {
  const gaps = new Set()
  for (const [id, node] of model.nodes) {
    if (node.branches.length) gaps.add(row.get(id))
    if (node.mergePoint) {
      const merge = model.getNode(node.mergePoint)
      if (merge && merge.next && row.has(merge.next)) gaps.add(row.get(merge.next) - 1)
    }
  }
  return gaps
}

// The vertical grid: cardTopY(r) for every occupied row, spaced by however tall the
// tallest card at row r+1 actually is (measured), plus a fixed gap, plus extra clearance
// where a junction sits. Growth is upward, so y decreases as r increases; row 0 sits at
// baseY.
//
// One y per row for every lane is what makes a lateral line safe to draw: cards are
// aligned across trunks, so the space between the tallest card of row r+1 and the tops of
// row r's cards is empty at every lane at once. tallestByRow is returned for that reason
// — a lateral run has to be anchored to the row rather than to one card's own height, or a
// return hanging under a short card would run at a height where a taller card in the same
// row still sits.
export function buildRowGrid(model, row, sizes, { rowGap, junctionExtra, baseY }) {
  const tasksByRow = new Map()
  for (const [id, r] of row) {
    if (!tasksByRow.has(r)) tasksByRow.set(r, [])
    tasksByRow.get(r).push(id)
  }
  const maxRow = tasksByRow.size ? Math.max(...tasksByRow.keys()) : 0
  const gapsWithJunction = junctionGaps(model, row)

  const tallestByRow = new Map()
  for (const [r, ids] of tasksByRow) {
    tallestByRow.set(r, ids.length ? Math.max(...ids.map((id) => sizes.get(id).cardH)) : 0)
  }

  const cardTopY = new Map([[0, baseY]])
  for (let r = 1; r <= maxRow; r++) {
    const tallest = tallestByRow.get(r) || 0
    const pitch = tallest + rowGap + (gapsWithJunction.has(r - 1) ? junctionExtra : 0)
    cardTopY.set(r, cardTopY.get(r - 1) - pitch)
  }
  return { cardTopY, tasksByRow, tallestByRow, maxRow }
}

function rangesOverlap(a, b) {
  return a.min <= b.max && b.min <= a.max
}

// Every task belongs to exactly one "line" (docs/model_ideas.md): the chain
// reached by .next from a plan's base or from a branch's foot, drawn colinear at one x.
// assignLanes assigns each line an integer lane (0 = trunk, negative = left,
// positive = right). See docs/tree-layout.md for the full algorithm.
//
// Lane order within a side is the author's. A node's branch array is ordered innermost
// first, and across a line the higher branch point is the inner one, so the sequence runs
// from the top of the line downward, each node's array in its stored order. The old rule,
// ordering by attach height alone, was the special case that held while a branch's span
// was unbounded above: two unbounded spans on one side always nest. A bounded span may
// overlap a sibling's freely (docs/model_v3_ideas.md, section 7), so the cost of an
// ordering is now crossings rather than an impossible drawing, and a crossing is drawn as
// a hop.
//
// What survives untouched is the band reservation: each branch reserves a contiguous band
// of lanes wide enough for its whole subtree, packed by first-fit against the row ranges
// already placed on that side, because cards must still not overlap whatever the lines do.
export function assignLanes(model, row) {
  const lineOfTask = new Map() // taskId -> the line's own start-task id
  const lineRows = new Map() // lineId -> {min,max} of the line's own rows
  const treeOfLine = new Map() // lineId -> the tree root's task id
  const lane = new Map() // lineId -> absolute integer lane
  const childrenOf = new Map() // lineId -> [{ child, side }], innermost first
  const relLane = new Map() // lineId -> lane relative to its parent spine
  const maxLanes = model.nodes.size + 2 // a generous, always-sufficient bound

  function walkLine(startId) {
    const ids = []
    let id = startId
    while (id) {
      ids.push(id)
      lineOfTask.set(id, startId)
      const task = model.getNode(id)
      id = task ? task.next : null
    }
    const rows = ids.map((i) => row.get(i))
    // A branch's return line climbs from its tip into the band below the node above its merge
    // point, so the lane it occupies reaches that far even though its cards do not. The
    // packer reasons in rows, so the range it packs against has to include that reach, or a
    // branch whose merge was stretched well above its own top could be given a lane another
    // branch's cards hold at those rows, and its return would run through them.
    const tip = model.getNode(ids[ids.length - 1])
    const mergeNode = tip && tip.mergePoint ? model.getNode(tip.mergePoint) : null
    const above = mergeNode ? mergeNode.next : null
    const reach = above && row.has(above) ? row.get(above) - 1 : -Infinity
    lineRows.set(startId, { min: Math.min(...rows), max: Math.max(Math.max(...rows), reach) })
    return ids
  }

  // Build the line-tree: a line's children are the branches forking off any of its
  // nodes, in lane order — the line read from the top down, each node's array in its
  // stored order.
  function collectChildren(startId) {
    const ids = walkLine(startId)
    const kids = []
    for (const id of [...ids].reverse()) {
      for (const b of model.getNode(id).branches) {
        kids.push({ child: b.child, side: b.side === 'right' ? 'right' : 'left' })
        collectChildren(b.child)
      }
    }
    childrenOf.set(startId, kids)
  }

  // Post-order: place each child subtree relative to this spine, then return
  // this subtree's { leftWidth, rightWidth, rows } for the parent to pack.
  function layout(startId) {
    const kids = childrenOf.get(startId)
    const ext = new Map()
    for (const k of kids) ext.set(k.child, layout(k.child))

    function placeSide(side) {
      // inner -> outer in the order collectChildren found them, which is the author's.
      const list = kids.filter((k) => k.side === side)
      const occ = new Map() // lane magnitude -> [rows, ...]
      let outer = 0
      for (const k of list) {
        const { leftWidth: L, rightWidth: R, rows } = ext.get(k.child)
        const width = L + 1 + R
        let e = 1
        for (; e <= maxLanes; e++) {
          let free = true
          for (let m = e; m < e + width; m++) {
            const at = occ.get(m)
            if (at && at.some((r) => rangesOverlap(r, rows))) { free = false; break }
          }
          if (free) break
        }
        if (e > maxLanes) throw new Error('assignLanes: could not place a branch band — unreachable')
        for (let m = e; m < e + width; m++) {
          if (!occ.has(m)) occ.set(m, [])
          occ.get(m).push(rows)
        }
        // The band spans magnitudes [e, e+width-1]; the child's spine sits at the
        // magnitude that puts its inner (trunk-facing) descendants at e.
        relLane.set(k.child, side === 'left' ? -(e + R) : e + L)
        outer = Math.max(outer, e + width - 1)
      }
      return outer
    }

    const leftWidth = placeSide('left')
    const rightWidth = placeSide('right')

    let { min, max } = lineRows.get(startId)
    for (const k of kids) {
      const r = ext.get(k.child).rows
      min = Math.min(min, r.min)
      max = Math.max(max, r.max)
    }
    return { leftWidth, rightWidth, rows: { min, max } }
  }

  // Top-down: accumulate relative lanes into absolute lanes (trunk = 0).
  function assignAbsolute(startId, base, treeRoot) {
    lane.set(startId, base)
    treeOfLine.set(startId, treeRoot)
    for (const k of childrenOf.get(startId)) {
      assignAbsolute(k.child, base + relLane.get(k.child), treeRoot)
    }
  }

  for (const tree of model.trees) {
    collectChildren(tree.rootTaskId)
    layout(tree.rootTaskId)
    assignAbsolute(tree.rootTaskId, 0, tree.rootTaskId)
  }

  return { lineOfTask, lineRows, lane, treeOfLine }
}
