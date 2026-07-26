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

// ---- the pixel solve ----
//
// Every branch in the model, as the vertical solve needs to see one: the node it hangs from,
// its first node, the top of its own trunk, and the node below the edge its return joins.
// validate.js has the same walk over a record; a model holds its nodes in a Map and flattens
// the two side arrays into one `branches` list, so the walk is spelled again here rather than
// shared through a shape neither side has.
export function branchesOfModel(model) {
  const list = []
  for (const [hostId, host] of model.nodes) {
    for (const b of host.branches) {
      const trunk = []
      const seen = new Set()
      let id = b.child
      while (id && model.getNode(id) && !seen.has(id)) {
        seen.add(id)
        trunk.push(id)
        id = model.getNode(id).next
      }
      const tipId = trunk.length ? trunk[trunk.length - 1] : null
      list.push({ hostId, footId: b.child, side: b.side, trunk, tipId, mergePoint: tipId ? model.getNode(tipId).mergePoint || null : null })
    }
  }
  return list
}

// How much clear air an edge needs between the lower node's circle and the upper node's card
// bottom. A plain edge needs the minimum and nothing more; an edge carrying a junction needs
// enough that the twelve-degree line does not disappear behind the card at the far end of the
// gap, because a lateral climbs `cardW/2 * tan12` while it crosses a card's own half-width and
// the cards are painted over the tracks. An edge that both hosts a fork and receives a merge
// needs its two diamonds kept apart as well: no constraint in the solve relates them, since
// one is bounded through the branch and the other is not.
function airOnEdge(m, { hostsFork, receivesMerge, upperW, lowerW }) {
  let air = m.minAir
  // A fork's line leaves at the lower node's x and climbs, so the card it could hide behind is
  // the upper one, directly above the junction it left.
  if (hostsFork) air = Math.max(air, m.departClear + (upperW / 2) * m.tan12 + m.junctionMargin)
  // A return arrives below the upper node's card and descends as it goes outward, so the card it
  // could hide behind is the lower one.
  if (receivesMerge) air = Math.max(air, m.arriveClear + (lowerW / 2) * m.tan12 + m.junctionMargin)
  if (hostsFork && receivesMerge) air = Math.max(air, m.departClear + m.diamondGap + m.arriveClear)
  return air
}

/**
 * Where every card sits, in pixels, with no row grid and nothing rounded.
 *
 * Three constraints, each a lower bound on one node given another, so the whole thing is a
 * longest path over the graph validateRecord already proves acyclic (a trunk's own order, a
 * branch's foot above the node it leaves, and the node above a join edge above the branch tip
 * returning there). Infeasibility is therefore not a failure mode: every defect is a bad
 * drawing rather than an impossible one.
 *
 *   succession, A then B = A.next   u(B) >= u(A) + anchorGap + air(A,B) + cardH(B)
 *   fork, host A, foot F            u(F) >= u(A) + anchorGap + departClear + rise + arriveClear + cardH(F)
 *   return, tip T, merge M, P=M.next  u(P) >= u(T) + anchorGap + departClear + rise + arriveClear + cardH(P)
 *
 * The fork constraint is an equality in practice, which is what makes the twelve degrees exact:
 * a branch's foot is the first node of its own line, so nothing else can push it. The return's
 * is a genuine inequality, since P also has its trunk predecessor to clear, and the slack is
 * the tail: the spine a branch grows above its last card before its return peels off. That the
 * constraint's own weight is the tail's floor is what guarantees the tail never dips below
 * departClear.
 *
 * `rise` is the same for every lateral, because a lateral ramps for half a lane at each end
 * whatever its span, so height does not depend on lane assignment and the two can be computed
 * one after the other rather than together.
 *
 * Returns cardTopY (screen y, growth upward so values fall as a plan rises, the base at
 * metrics.baseY), tails keyed by a branch's foot, and the air each trunk edge was given.
 */
export function solveHeights(model, sizes, metrics) {
  const m = metrics
  const cardH = (id) => (sizes.get(id) ? sizes.get(id).cardH : 0)
  const cardW = (id) => (sizes.get(id) ? sizes.get(id).cardW : 0)
  const branches = branchesOfModel(model)

  const hostsFork = new Set(branches.map((b) => b.hostId))
  const receivesMerge = new Set(branches.map((b) => b.mergePoint).filter(Boolean))
  const airBelow = new Map() // the upper node of an edge -> the air that edge was given

  const above = new Map() // id -> [{ to, weight }]
  const indegree = new Map()
  for (const id of model.nodes.keys()) {
    above.set(id, [])
    indegree.set(id, 0)
  }
  const constrain = (lowerId, upperId, weight) => {
    if (!above.has(lowerId) || !indegree.has(upperId)) return
    above.get(lowerId).push({ to: upperId, weight })
    indegree.set(upperId, indegree.get(upperId) + 1)
  }

  for (const [id, node] of model.nodes) {
    if (node.next && model.getNode(node.next)) {
      const air = airOnEdge(m, {
        hostsFork: hostsFork.has(id),
        receivesMerge: receivesMerge.has(id),
        upperW: cardW(node.next),
        lowerW: cardW(id),
      })
      airBelow.set(node.next, air)
      constrain(id, node.next, m.anchorGap + air + cardH(node.next))
    }
  }
  const lateral = m.anchorGap + m.departClear + m.rise + m.arriveClear
  for (const b of branches) {
    constrain(b.hostId, b.footId, lateral + cardH(b.footId))
    if (!b.tipId || !b.mergePoint) continue
    const merge = model.getNode(b.mergePoint)
    if (!merge || !merge.next || !model.getNode(merge.next)) continue
    constrain(b.tipId, merge.next, lateral + cardH(merge.next))
  }

  const u = new Map()
  const queue = []
  for (const id of model.nodes.keys()) {
    if (indegree.get(id) === 0) {
      u.set(id, 0)
      queue.push(id)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]
    for (const edge of above.get(id)) {
      u.set(edge.to, Math.max(u.has(edge.to) ? u.get(edge.to) : 0, u.get(id) + edge.weight))
      indegree.set(edge.to, indegree.get(edge.to) - 1)
      if (indegree.get(edge.to) === 0) queue.push(edge.to)
    }
  }
  // A cycle leaves its members unplaced. validateRecord refuses one, so this is reached only by
  // a record that got past it; put them at the base rather than let the drawing vanish.
  for (const id of model.nodes.keys()) if (!u.has(id)) u.set(id, 0)

  // The tail is what is left over once the return has climbed: derived rather than solved, and
  // at least departClear by the constraint above.
  const tails = new Map()
  for (const b of branches) {
    if (!b.tipId || !b.mergePoint) continue
    const merge = model.getNode(b.mergePoint)
    const p = merge && merge.next ? merge.next : null
    if (!p || !u.has(p)) continue
    tails.set(b.footId, u.get(p) - cardH(p) - m.arriveClear - m.rise - u.get(b.tipId) - m.anchorGap)
  }

  const cardTopY = new Map()
  for (const [id, height] of u) cardTopY.set(id, m.baseY - height)
  return { cardTopY, tails, airBelow, branches }
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
// of lanes wide enough for its whole subtree, packed by first-fit against the extents
// already placed on that side, because cards must still not overlap whatever the lines do.
//
// `extentOf(ids, startId)` says how far a line reaches, and is the one thing the packer needs
// to know about the vertical. The row grid answers in row indices; the pixel solve answers in
// pixels, and includes a line's tail and the point its own incoming line arrives at, because
// those are drawn too and two lines sharing a lane must not overlap in either. Either way the
// packer only ever asks whether two extents overlap, so it does not care which it is given.
export function assignLanes(model, row, extentOf) {
  const extent = extentOf || ((ids) => {
    const rows = ids.map((i) => row.get(i))
    return { min: Math.min(...rows), max: Math.max(...rows) }
  })
  const lineOfTask = new Map() // taskId -> the line's own start-task id
  const lineRows = new Map() // lineId -> {min,max} of the line's own extent
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
    const own = extent(ids, startId)
    // A branch's return line climbs from its tip toward the node above its merge point, so the
    // lane it occupies reaches that far even though its cards do not. A branch whose merge was
    // stretched well above its own top could otherwise be given a lane another branch's cards
    // hold up there, and its return would run through them. In rows that reach is the row below
    // the node above the merge point; a pixel extent carries it already, in the tail.
    let reach = -Infinity
    if (!extentOf) {
      const tip = model.getNode(ids[ids.length - 1])
      const mergeNode = tip && tip.mergePoint ? model.getNode(tip.mergePoint) : null
      const above = mergeNode ? mergeNode.next : null
      if (above && row.has(above)) reach = row.get(above) - 1
    }
    lineRows.set(startId, { min: own.min, max: Math.max(own.max, reach) })
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
