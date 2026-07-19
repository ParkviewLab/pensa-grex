// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Pure geometry helpers for the layout engine: row assignment, the vertical
// row grid, and horizontal lane packing. No DOM; every input is plain data
// (a forest model — see model/forest.js — plus measured sizes).
//
// Horizontal placement (assignLanes) is a subtree-aware tidy-tree contour
// packer that guarantees branch connectors never cross. Card width is fixed
// (style.css .card{width:138px}), so lanes are integers at a fixed per-lane
// x-step rather than real per-row contours; the integer band is the
// fixed-width specialization of the algorithm. The algorithm, its lineage
// (Reingold-Tilford / Walker / Buchheim / van der Ploeg) and this variant are
// written up in docs/tree-layout.md.

// Row 0 is every tree's root; a main-line successor (.next) is +1. A branch
// child starts at its parent's row +1 for at:'above' (level with the
// parent's own .next — a fork's branches and its main-line continuation
// begin at the same height) or at the parent's own row for at:'below'
// (level with the parent itself, one gap lower).
// A tree root sits at the base (row 0) with no gap below it, so a fork "below" a
// root has nowhere to go; it is treated as a fork above instead — the child
// rises to the parent's row +1, matching the below-on-root fallback in
// layout.js. Without this the child would be pinned at the root's own row while
// the connector aimed a row higher, producing a dangling track or, when the
// root has no successor, NaN coordinates.
function rootSet(forest) {
  return new Set(forest.trees.map((t) => t.rootTaskId))
}

function childRow(id, r, b, roots) {
  if (b.at !== 'below') return r + 1 // above: level with the parent's own .next
  return roots.has(id) ? r + 1 : r // below-on-root rises; below elsewhere is level with the parent
}

export function assignRows(forest) {
  const roots = rootSet(forest)
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
        stack.push([b.child, childRow(id, r, b, roots)])
      }
    }
  }
  return row
}

// The lower row index of every gap (r, r+1) that carries at least one fork
// junction — used to widen that gap's pitch so the diamond has room. A
// below-on-root fork uses the gap above the root (r), like an above fork.
export function junctionGaps(forest, row) {
  const roots = rootSet(forest)
  const gaps = new Set()
  for (const [id, task] of forest.tasks) {
    for (const b of task.branches) {
      const r = row.get(id)
      const below = b.at === 'below' && !roots.has(id)
      gaps.add(below ? r - 1 : r)
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
// reached by .next from a tree root or a branch child, drawn colinear at one x.
// assignLanes assigns each line an integer lane (0 = trunk, negative = left,
// positive = right) with a subtree-aware tidy-tree contour packer, so branch
// connectors never cross. See docs/tree-layout.md for the full algorithm.
//
// Two rules make it planar. (1) On each side, a branch that attaches HIGHER on
// its spine sits inner (nearer the spine) and a lower-attaching branch reaches
// around it outer: an outer branch's horizontal connector then leaves the spine
// below where any inner band begins, so it cannot cross one. (2) Each branch
// reserves a contiguous BAND of lanes wide enough for its whole subtree, packed
// by first-fit against the row-ranges already placed on that side, so two
// subtrees whose rows never overlap still share lanes (tight packing) but bands
// that would collide grow outward.
export function assignLanes(forest, row) {
  const lineOfTask = new Map() // taskId -> the line's own start-task id
  const lineRows = new Map() // lineId -> {min,max} of the line's own rows
  const treeOfLine = new Map() // lineId -> the tree root's task id
  const lane = new Map() // lineId -> absolute integer lane
  const childrenOf = new Map() // lineId -> [{ child, side, attach }]
  const relLane = new Map() // lineId -> lane relative to its parent spine
  const maxLanes = forest.tasks.size + 2 // a generous, always-sufficient bound

  function walkLine(startId) {
    const ids = []
    let id = startId
    while (id) {
      ids.push(id)
      lineOfTask.set(id, startId)
      const task = forest.getTask(id)
      id = task ? task.next : null
    }
    const rows = ids.map((i) => row.get(i))
    lineRows.set(startId, { min: Math.min(...rows), max: Math.max(...rows) })
    return ids
  }

  // Build the line-tree: a line's children are the branches forking off any of
  // its tasks. `side` is explicit or alternates by branch index (unchanged);
  // `attach` is the branch child's own row, which equals the junction's upper row.
  function collectChildren(startId) {
    const ids = walkLine(startId)
    const kids = []
    for (const id of ids) {
      forest.getTask(id).branches.forEach((b, idx) => {
        const side = b.side === 'left' || b.side === 'right' ? b.side : (idx % 2 === 0 ? 'left' : 'right')
        kids.push({ child: b.child, side, attach: row.get(b.child) })
        collectChildren(b.child)
      })
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
      // inner -> outer: higher attach first; a stable sort keeps declaration
      // order for equal-attach ties.
      const list = kids.filter((k) => k.side === side).sort((a, b) => b.attach - a.attach)
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

  for (const tree of forest.trees) {
    collectChildren(tree.rootTaskId)
    layout(tree.rootTaskId)
    assignAbsolute(tree.rootTaskId, 0, tree.rootTaskId)
  }

  return { lineOfTask, lineRows, lane, treeOfLine }
}
