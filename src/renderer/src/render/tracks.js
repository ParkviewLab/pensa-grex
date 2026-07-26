// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The subway-map SVG layer: the sputnik (branch-cursor) and starburst
// (atmosphere) marker symbols, track polylines, and fork-junction diamonds.
// Ported from the design mock (docs/subway-forest-themed.html). The sputnik is
// the Atomic Starburst "here" mark; see docs/node-visual-system.md.

const SVGNS = 'http://www.w3.org/2000/svg'

function el(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

// Idempotently ensure svgEl has the <defs> with the #sputnik and #starburst
// symbol groups. Safe to call more than once; a second call is a no-op.
export function ensureDefs(svgEl) {
  if (svgEl.querySelector('defs#pensagrex-defs')) return
  const defs = el('defs', { id: 'pensagrex-defs' })

  // The "here" mark: an atomic starburst — solid rays of irregular length at
  // irregular angles, each tipped with a ball, around a solid centre (Googie,
  // asymmetric). The ray lines inherit their stroke from .cursor-mark; the balls
  // set their own fill and no stroke (see style.css).
  const sputnik = el('g', { id: 'sputnik' })
  const rays = [[-6, 1.0], [30, 0.66], [63, 1.12], [99, 0.58], [138, 0.9], [177, 1.2], [210, 0.68], [246, 1.02], [285, 0.82], [318, 1.08]]
  const base = 15
  for (const [deg, f] of rays) {
    const rad = (deg * Math.PI) / 180, len = base * f
    const tx = +(len * Math.cos(rad)).toFixed(1), ty = +(len * Math.sin(rad)).toFixed(1)
    sputnik.appendChild(el('line', { x1: 0, y1: 0, x2: tx, y2: ty, 'stroke-width': 1.4, 'stroke-linecap': 'round' }))
    sputnik.appendChild(el('circle', { class: 'ball', cx: tx, cy: ty, r: 2.2, stroke: 'none' }))
  }
  sputnik.appendChild(el('circle', { class: 'core', cx: 0, cy: 0, r: 2.8, stroke: 'none' }))
  defs.appendChild(sputnik)

  const starburst = el('g', { id: 'starburst' })
  starburst.appendChild(el('line', { x1: 0, y1: -26, x2: 0, y2: 26 }))
  starburst.appendChild(el('line', { x1: -26, y1: 0, x2: 26, y2: 0 }))
  starburst.appendChild(el('line', { x1: -18, y1: -18, x2: 18, y2: 18 }))
  starburst.appendChild(el('line', { x1: 18, y1: -18, x2: -18, y2: 18 }))
  for (const deg of [22.5, 67.5, 112.5, 157.5]) {
    starburst.appendChild(el('line', { x1: 0, y1: -14, x2: 0, y2: 14, transform: 'rotate(' + deg + ')' }))
  }
  defs.appendChild(starburst)

  svgEl.appendChild(defs)
}

// An 'M..L..' polyline path through pts (an array of [x,y] pairs) — a straight riser is a
// 2-point polyline, a branch or return elbow a 3-point one — with a small hump wherever
// the line hops another.
//
// A crossing must not be mistakable for a junction: a junction is marked in the gap
// between two stations, so a lateral line passing unmarked through that same band would
// still read as two lines meeting, and the drawing would assert a join that does not
// exist. The remedy is the line hop, standard in subway and circuit drawing alike, and
// the convention is that the lateral line hops while the trunk runs unbroken
// (docs/model_v3_ideas.md, section 10). `hops` holds the x positions to hop at, which the
// layout engine computes; each becomes a quadratic arc, whose control point puts the hump
// on the upward side without any arc-flag reasoning.
// `r` must match hopRadius in layout/layout.js, which is what the layout engine reserves
// clearance from: the hump peaks r above the run, so a wider arc here would poke out of the
// band that was kept clear for it.
export function trackPath(pts, hops = [], r = 6) {
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    if (i === 0) {
      d += 'M' + x + ',' + y
      continue
    }
    const [px, py] = pts[i - 1]
    const here = py === y && px !== x
      ? hops.filter((hx) => (hx - px) * (hx - x) < 0).sort((a, b) => (x > px ? a - b : b - a))
      : []
    for (const hx of here) {
      const dir = x > px ? 1 : -1
      d += ' L' + (hx - dir * r) + ',' + y + ' Q' + hx + ',' + (y - 2 * r) + ' ' + (hx + dir * r) + ',' + y
    }
    d += ' L' + x + ',' + y
  }
  return d
}

// How an underpass is drawn, and the successor to the hop above. The lateral line stops this far
// short of the trunk it passes behind, measured along its own direction, which leaves a few pixels
// of clear air either side of a trunk's own 3-pixel stroke; and each severed end is capped with a
// stroke four times the lateral's own width long (2.3, so 9.2), standing parallel to the trunk,
// which is always vertical. The cap's own width is thinner, and comes from CSS.
const BREAK_HALF = 6.5
const CAP_LENGTH = 9.2

function onSegment(a, b, p) {
  return (p[0] - a[0]) * (p[0] - b[0]) < 0 && (p[1] - a[1]) * (p[1] - b[1]) <= 0
}
function along(a, b, from, distance) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!len) return from
  return [from[0] + ((b[0] - a[0]) / len) * distance, from[1] + ((b[1] - a[1]) / len) * distance]
}

// The same polyline, but yielding where it passes behind a trunk: it stops short on one side and
// resumes past the other, so the trunk runs unbroken through the gap and the crossing reads as an
// underpass rather than as a junction (docs/model_v3_ideas.md, section 10). `breaks` holds points
// rather than x positions, because a lateral line at twelve degrees is not level with itself.
export function underpassPath(pts, breaks = [], half = BREAK_HALF) {
  let d = 'M' + pts[0][0] + ',' + pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const here = breaks
      .filter((p) => onSegment(a, b, p))
      .sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]))
    for (const p of here) {
      const before = along(a, b, p, -half)
      const after = along(a, b, p, half)
      d += ' L' + before[0] + ',' + before[1] + ' M' + after[0] + ',' + after[1]
    }
    d += ' L' + b[0] + ',' + b[1]
  }
  return d
}

// The two caps that mark one underpass, so the gap reads as a line passing behind rather than as a
// line that simply stops.
export function underpassCaps(pts, breaks = [], half = BREAK_HALF) {
  const caps = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    for (const p of breaks) {
      if (!onSegment(a, b, p)) continue
      for (const side of [-1, 1]) {
        const [x, y] = along(a, b, p, half * side)
        caps.push(el('line', { class: 'underpass-cap', x1: x, y1: y - CAP_LENGTH / 2, x2: x, y2: y + CAP_LENGTH / 2 }))
      }
    }
  }
  return caps
}

// A track. `kind` is 'riser' (the vertical spine between stacked nodes on a line),
// 'branch' (a fork connector) or 'return' (a branch rejoining its trunk); the lateral
// kinds are weighted the same in CSS and the spine slightly heavier, so the main line
// reads first. A lateral that passes behind a trunk comes back as a group, the broken path
// with a cap at each severed end.
export function buildTrack(track) {
  const { points, kind, hops, breaks } = track
  const cls = kind === 'branch' || kind === 'return' ? kind : 'riser'
  if (breaks && breaks.length) {
    const group = el('g', { class: 'track-underpass' })
    group.appendChild(el('path', { class: 'track ' + cls, d: underpassPath(points, breaks) }))
    for (const cap of underpassCaps(points, breaks)) group.appendChild(cap)
    return group
  }
  return el('path', { class: 'track ' + cls, d: trackPath(points, hops) })
}

// The small diamond marking a fork junction, centered at (cx,cy).
export function buildForkMarker(cx, cy, size = 8) {
  return el('rect', {
    class: 'fork',
    x: cx - size / 2, y: cy - size / 2, width: size, height: size,
    transform: 'rotate(45 ' + cx + ' ' + cy + ')',
  })
}

// The "here" mark. Its colour comes from .cursor-mark (var(--ink): near-black on the
// azure ground, near-white on navy), and it is scaled up 15% from the #sputnik def.
export function buildCursorMark(x, y) {
  return el('use', { href: '#sputnik', class: 'cursor-mark', transform: 'translate(' + x + ',' + y + ') scale(1.15)' })
}

export function buildBurst(x, y, scale, variant) {
  const cls = variant ? 'burst ' + variant : 'burst'
  return el('use', { href: '#starburst', class: cls, transform: 'translate(' + x + ',' + y + ') scale(' + scale + ')' })
}
