// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The pure layout engine: the domain model + measured sizes -> pixel positions
// for every station, dot, cursor, track, and junction, plus the overall canvas
// bounds. No DOM — see layout/measure.js for where the sizes this consumes come
// from, and docs/model_ideas.md for the rules this implements (bottom-up growth,
// junctions in the open gap between stations, left/right alternation). A
// project's name lives on its root-node card, so there is no separate tree title.
//
// Every branch rejoins the trunk it left, so there are two kinds of lateral line: a branch
// line leaving a fork junction, and a return line arriving at a merge junction. Both leave
// their own spine climbing at exactly twelve degrees and both are drawn the same way. Where
// one crosses another line it passes behind it, cut by a strip along that line and capped at
// each cut end (docs/model_v3_ideas.md, sections 9 and 10, and docs/tree-layout.md).
//
// There is no row grid: every card's y is solved in pixels, so cards in different lanes do
// not line up and each pair packs by its own two heights.

import { assignLanes, solveHeights } from './geometry.js'

const TAN12 = Math.tan((12 * Math.PI) / 180)

const DEFAULTS = {
  laneStep: 228, // fixed card width (188) + a horizontal gap between lanes
  // ---- how a lateral line is drawn (see docs/tree-layout.md) ----
  // A lateral line leaves its own spine climbing at exactly this angle, ramping for half a lane
  // at each end and running flat between, so a branch one lane out is a single straight climb
  // and every wider one climbs the same total. That is what keeps the climb independent of lane
  // distance, and so keeps heights independent of lane assignment.
  tan12: TAN12,
  rampRun: 114, // half a lane
  rise: 228 * TAN12, // 2 * rampRun * tan12, the climb of every lateral, about 48.5
  // The least a card's bottom edge sits above the CENTRE of the circle beneath it. Measured to the
  // centre rather than the rim because that is the arithmetic the figure was chosen from: the row
  // grid's 40 was a card-top-to-card-top pitch, which this reproduces at 26, so 25 is a shade
  // tighter than v3.0.0 drew. Visible air to the dot's rim is therefore minAir - dotRadius.
  minAir: 25,
  departClear: 12, // how far above a circle a lateral line departs, and a tail's floor
  arriveClear: 12, // how far below a card's bottom edge a lateral line arrives
  junctionMargin: 4, // slack over the corner a twelve-degree line cuts across a card's width
  diamondGap: 12, // least distance between two junction diamonds sharing one edge
  baseY: 0, // the base of every plan, before the final shift to positive bounds
  anchorGap: 14, // how far a circle sits above its own card's top edge
  dotRadius: 6, // half a station dot (style.css .dot{width:11px}), rounded up
  branchYieldsToReturn: true, // a branch line passes behind a return line where the two cross
  repairPasses: 8, // how many times a lateral crossing a card may lift that card before we stop
  treeGap: 90, // horizontal gap between two trees' bounding boxes
  margin: 40, // canvas margin on every side
}

// Where two straight segments properly cross, or null. "Properly" excludes an endpoint touch,
// since two lines that meet at a junction meet there on purpose: a break over such a point would
// deny the join the drawing is making.
function crossingOf(a, b, c, d) {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null // parallel, or collinear along a shared ray
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom
  const inside = (v) => v > 1e-9 && v < 1 - 1e-9
  if (!inside(t) || !inside(u)) return null
  return [a[0] + t * rx, a[1] + t * ry]
}

// One placement pass: every card where the solve puts it, and every lateral line leaving its own
// spine at twelve degrees, ramping half a lane, running flat where the span is wider than one lane,
// and ramping into its arrival.
function placeOnce(model, sizes, o, slack) {
  const { cardTopY, tails, branches, pinnedBy } = solveHeights(model, sizes, o, slack)
  const cardTop = (id) => cardTopY.get(id) || 0
  const cardH = (id) => (sizes.get(id) ? sizes.get(id).cardH : 0)
  const cardW = (id) => (sizes.get(id) ? sizes.get(id).cardW : 0)
  const circleY = (id) => cardTop(id) - o.anchorGap
  const arrivalY = (id) => cardTop(id) + cardH(id) + o.arriveClear
  const tailOf = (footId) => (tails.has(footId) ? tails.get(footId) : o.departClear)

  // What a line reaches, in pixels, for the packer: its cards, the rim of every dot, the tail
  // its return leaves from, and the point where its own incoming lateral arrives beneath its
  // first card. All of it is drawn, so all of it has to be kept clear of another line's lane.
  const branchByFoot = new Map(branches.map((b) => [b.footId, b]))
  const extentOf = (ids, startId) => {
    let min = Infinity
    let max = -Infinity
    for (const id of ids) {
      min = Math.min(min, circleY(id) - o.dotRadius)
      max = Math.max(max, cardTop(id) + cardH(id))
    }
    const tip = ids[ids.length - 1]
    if (branchByFoot.has(startId)) {
      min = Math.min(min, circleY(tip) - tailOf(startId))
      // The arrival ramp comes in from the trunk's side and is still descending as it crosses this
      // line's own card, so the lowest ink is not the arrival point but the ramp at the card's far
      // edge: half a card's width of climb below it, and then the rim of whatever sits beneath.
      max = Math.max(max, arrivalY(startId) + (cardW(startId) / 2) * o.tan12 + o.dotRadius + o.junctionMargin)
    }
    return { min, max }
  }

  const { lineOfTask, lane } = assignLanes(model, extentOf)
  const rawX = new Map()
  for (const id of model.nodes.keys()) rawX.set(id, lane.get(lineOfTask.get(id)) * o.laneStep)

  // ---- per-tree bounding box, then packed left to right ----
  const tasksByTree = new Map(model.trees.map((t) => [t.id, []]))
  for (const id of model.nodes.keys()) tasksByTree.get(model.getTreeIdForTask(id)).push(id)
  const treeOffsetX = new Map()
  let packCursor = 0
  for (const tree of model.trees) {
    let minX = Infinity
    let maxX = -Infinity
    for (const id of tasksByTree.get(tree.id)) {
      minX = Math.min(minX, rawX.get(id) - cardW(id) / 2)
      maxX = Math.max(maxX, rawX.get(id) + cardW(id) / 2)
    }
    treeOffsetX.set(tree.id, packCursor - minX)
    packCursor = maxX + (packCursor - minX) + o.treeGap
  }
  const finalX = (id) => rawX.get(id) + treeOffsetX.get(model.getTreeIdForTask(id))

  // ---- stations, dots, cursors ----
  const stations = []
  let minY = Infinity
  let maxY = -Infinity
  for (const [id, task] of model.nodes) {
    const x = finalX(id)
    stations.push({
      id, x, cardTop: cardTop(id), cardW: cardW(id), cardH: cardH(id), anchorY: circleY(id),
      title: task.title, status: task.status, cursor: !!task.here, note: !!task.note,
    })
    minY = Math.min(minY, circleY(id) - o.dotRadius)
    maxY = Math.max(maxY, cardTop(id) + cardH(id))
  }
  const dots = stations.filter((s) => !s.cursor).map((s) => ({ x: s.x, y: s.anchorY }))
  const cursors = stations.filter((s) => s.cursor).map((s) => ({ x: s.x, y: s.anchorY }))

  // ---- spines ----
  // A line's spine runs from where its own lateral arrives, beneath its first card, up to where
  // its return departs, above its last circle. A plan's trunk has neither, so it runs dot to dot
  // as it always has.
  const linesByStart = new Map()
  for (const id of model.nodes.keys()) {
    const start = lineOfTask.get(id)
    if (!linesByStart.has(start)) linesByStart.set(start, [])
    linesByStart.get(start).push(id)
  }
  const tracks = []
  for (const [start, ids] of linesByStart) {
    const sorted = ids.slice().sort((a, b) => cardTop(b) - cardTop(a)) // base first: y falls as a plan rises
    const foot = sorted[0]
    const tip = sorted[sorted.length - 1]
    const isBranch = branchByFoot.has(start)
    const branch = branchByFoot.get(start)
    const bottom = isBranch ? arrivalY(foot) : circleY(foot)
    const top = isBranch && branch.mergePoint ? circleY(tip) - tailOf(start) : circleY(tip)
    tracks.push({ points: [[finalX(foot), bottom], [finalX(tip), top]], kind: 'riser' })
  }

  // ---- laterals ----
  // A lateral climbs at exactly twelve degrees out of its own spine and into its arrival, ramping
  // half a lane at each end. One lane apart the two ramps meet and it is a single straight climb;
  // wider than that, the middle runs flat. The climb is therefore the same for every lateral,
  // which is what keeps a card's height independent of how far out its lane sits.
  // One diamond per point, not per line meeting it: two branches off one host share a fork, and
  // two branches returning to one edge share a join. The coordinates come from the same
  // expressions in either case, so equality is exact, but the key is rounded against float noise.
  const junctionByKey = new Map()
  function junction(x, y) {
    const key = x.toFixed(3) + ',' + y.toFixed(3)
    if (!junctionByKey.has(key)) junctionByKey.set(key, { x, y })
  }
  function lateral(from, to, kind) {
    const dir = Math.sign(to.x - from.x) || 1
    const dx = Math.abs(to.x - from.x)
    const ramp = Math.min(o.rampRun, dx / 2)
    const climb = ramp * o.tan12
    const pts = [[from.x, from.y]]
    const midY = from.y - climb
    if (dx > 2 * ramp) {
      pts.push([from.x + dir * ramp, midY])
      pts.push([to.x - dir * ramp, midY])
    } else if (dx > 0) {
      pts.push([from.x + dir * ramp, midY])
    }
    pts.push([to.x, to.y])
    tracks.push({ points: pts, kind })
  }

  for (const b of branches) {
    const from = { x: finalX(b.hostId), y: circleY(b.hostId) - o.departClear }
    junction(from.x, from.y)
    lateral(from, { x: finalX(b.footId), y: arrivalY(b.footId) }, 'branch')

    if (!b.tipId || !b.mergePoint) continue
    const merge = model.getNode(b.mergePoint)
    const above = merge && merge.next ? merge.next : null
    if (!above || !model.getNode(above)) continue
    const to = { x: finalX(above), y: arrivalY(above) }
    junction(to.x, to.y)
    lateral({ x: finalX(b.tipId), y: circleY(b.tipId) - tailOf(b.footId) }, to, 'return')
  }

  // ---- underpasses ----
  // A lateral line passes behind a trunk: the trunk runs unbroken and the lateral breaks, so the
  // crossing cannot be mistaken for a junction (docs/model_v3_ideas.md, section 10). Each break is
  // a point rather than an x, since a lateral is not level with itself for long.
  const spines = tracks.filter((t) => t.kind === 'riser').map((t) => ({
    x: t.points[0][0], yMin: Math.min(t.points[0][1], t.points[1][1]), yMax: Math.max(t.points[0][1], t.points[1][1]),
  }))
  const returnSegments = []
  for (const t of tracks) {
    if (t.kind !== 'return') continue
    for (let i = 1; i < t.points.length; i++) returnSegments.push([t.points[i - 1], t.points[i]])
  }
  for (const t of tracks) {
    if (t.kind !== 'branch' && t.kind !== 'return') continue
    const breaks = []
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1]
      const b = t.points[i]
      const [x1, y1] = a
      const [x2, y2] = b
      if (x1 === x2) continue
      for (const s of spines) {
        if ((s.x - x1) * (s.x - x2) >= 0) continue // not strictly between this segment's ends
        const y = y1 + ((s.x - x1) * (y2 - y1)) / (x2 - x1)
        // Strictly through, not merely touching: two returns arriving at one merge junction meet
        // there legitimately, and a break over a line one is joining would deny that join.
        if (y <= s.yMin || y >= s.yMax) continue
        // Each break carries the direction of the line being passed under, because that is what
        // its end caps are drawn along: a cap reads as a slice of the line that runs on, so it
        // has to lie parallel to it. A trunk is always vertical.
        breaks.push({ x: s.x, y, along: [0, 1], over: 'riser' })
      }
      // A branch line also yields to a return line where the two cross. The return is the line by
      // which a strand rejoins its trunk, so it reads as the more structural of the two, and one
      // rule (a branch yields to a return, and both yield to a trunk) is easier to read off a
      // drawing than "whichever is further from its own spine".
      if (t.kind === 'branch' && o.branchYieldsToReturn) {
        for (const [c, d] of returnSegments) {
          const hit = crossingOf(a, b, c, d)
          if (hit) breaks.push({ x: hit[0], y: hit[1], along: [d[0] - c[0], d[1] - c[1]], over: 'return' })
        }
      }
    }
    if (breaks.length) t.breaks = breaks
  }

  // ---- what still crosses a node ----
  // Nothing aligns across lanes any more, so a lateral line can pass over a card in a lane it
  // crosses; the packer's extents keep two lines in ONE lane apart, and this finds what the
  // packer cannot see. Each conflict names the card and how far it would have to rise for the
  // line to clear it: the repair only ever pushes a card up, which is why the loop above this
  // terminates (see docs/tree-layout.md).
  const conflicts = []
  for (const t of tracks) {
    if (t.kind !== 'branch' && t.kind !== 'return') continue
    for (let i = 1; i < t.points.length; i++) {
      const [x1, y1] = t.points[i - 1]
      const [x2, y2] = t.points[i]
      if (x1 === x2) continue
      for (const s of stations) {
        const left = s.x - s.cardW / 2
        const right = s.x + s.cardW / 2
        const lo = Math.max(Math.min(x1, x2), left)
        const hi = Math.min(Math.max(x1, x2), right)
        if (lo > hi) continue
        const yAt = (x) => y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
        const lowest = Math.max(yAt(lo), yAt(hi))
        const highest = Math.min(yAt(lo), yAt(hi))
        const rimY = s.anchorY - o.dotRadius
        const bottomY = s.cardTop + s.cardH
        if (lowest < rimY || highest > bottomY) continue
        // Lift the card until its own bottom edge is clear above the line. Raising it is the only
        // direction available, since every card already sits at the minimum its own line allows.
        //
        // Which node to raise is not always the offending card. A node whose height was fixed by a
        // lateral line cannot be lifted alone without bending that line off twelve degrees, so the
        // thing to lift is the host of the branch that pinned it, which carries the whole lens up
        // together. Walking down that chain always ends, since a host sits below what it pins.
        let target = s.id
        for (let hops = 0; pinnedBy.has(target) && hops < 32; hops++) target = pinnedBy.get(target).hostId
        conflicts.push({ id: s.id, lift: target, kind: t.kind, by: bottomY - highest + o.dotRadius + o.junctionMargin })
      }
    }
  }

  // ---- shift everything so the topmost, leftmost ink lands at the margin ----
  const junctions = [...junctionByKey.values()]
  let minX = Infinity
  let maxX = -Infinity
  for (const s of stations) {
    minX = Math.min(minX, s.x - s.cardW / 2)
    maxX = Math.max(maxX, s.x + s.cardW / 2)
  }
  for (const t of tracks) for (const p of t.points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]) }
  const dx = o.margin - minX
  const dy = o.margin - minY
  for (const s of stations) { s.x += dx; s.cardTop += dy; s.anchorY += dy }
  for (const d of [...dots, ...cursors]) { d.x += dx; d.y += dy }
  for (const j of junctions) { j.x += dx; j.y += dy }
  for (const t of tracks) {
    t.points = t.points.map(([x, y]) => [x + dx, y + dy])
    if (t.breaks) t.breaks = t.breaks.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }))
  }

  const bounds = { w: maxX - minX + 2 * o.margin, h: maxY - minY + 2 * o.margin }
  return { stations, dots, cursors, tracks, junctions, bounds, metrics: o, conflicts }
}

// Place, then lift whatever a lateral line still crosses, then place again.
//
// The repair only ever raises a card, never widens a lane and never lowers anything, which is
// what makes this end: each pass either finds nothing left to lift or lifts a card strictly
// higher than before, and a card cannot rise past the top of its own plan. The cap is there for
// the case the argument misses; whatever is left rides out on `conflicts` rather than being
// swallowed, because a drawing that quietly runs a line through a station is worse than one that
// says it did.
function repairAndPlace(model, sizes, o) {
  const slack = new Map()
  let placed = placeOnce(model, sizes, o, slack)
  for (let pass = 0; pass < o.repairPasses && placed.conflicts.length; pass++) {
    let grew = false
    for (const c of placed.conflicts) {
      const want = (slack.get(c.lift) || 0) + c.by
      if (want > (slack.get(c.lift) || 0)) {
        slack.set(c.lift, want)
        grew = true
      }
    }
    if (!grew) break
    placed = placeOnce(model, sizes, o, slack)
  }
  return placed
}

export function computeDomainLayout(model, sizes, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (model.trees.length === 0) {
    return { stations: [], dots: [], cursors: [], tracks: [], junctions: [], bounds: { w: o.margin * 2, h: o.margin * 2 }, metrics: o, conflicts: [] }
  }
  return repairAndPlace(model, sizes, o)
}
