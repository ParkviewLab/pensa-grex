// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Station silhouette geometry and decorators. A station's outline is the gap
// between two filled paths: an outer silhouette and an inner one, the inner a
// scaled copy of the outer inset by a DIFFERENT amount per edge, so the outline
// runs thin along one edge and thick along another (the Googie variable-weight
// look). Four shapes — screen (a task), marquee (a task marked "here"), hull (a
// project node), keystone (kept, currently unassigned) — plus composable
// decorators drawn behind the card: `orbits`, the atomic rings a flagged node wears.
// A `shadow` decorator lived here too, an echo behind a collapsed project; a folded
// scope now draws its close flush on its project card instead, which says the same
// thing without a second silhouette.
//
// See docs/node-visual-system.md for the shape grammar, the variable-weight
// outline model, and the kind/state -> shape assignment policy.

const SVGNS = 'http://www.w3.org/2000/svg'

function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}
function svgEl(tag, attrs) {
  return setAttrs(document.createElementNS(SVGNS, tag), attrs)
}

// A rounded rectangle path from (x0,y0) to (x1,y1) with corner radius r.
export function rr(x0, y0, x1, y1, r) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2))
  return 'M' + (x0 + r) + ',' + y0 + 'L' + (x1 - r) + ',' + y0 + 'Q' + x1 + ',' + y0 + ' ' + x1 + ',' + (y0 + r) +
    'L' + x1 + ',' + (y1 - r) + 'Q' + x1 + ',' + y1 + ' ' + (x1 - r) + ',' + y1 +
    'L' + (x0 + r) + ',' + y1 + 'Q' + x0 + ',' + y1 + ' ' + x0 + ',' + (y1 - r) +
    'L' + x0 + ',' + (y0 + r) + 'Q' + x0 + ',' + y0 + ' ' + (x0 + r) + ',' + y0 + 'Z'
}

// A closed path through pts (an array of [x,y]) with each corner rounded to
// radius rc (clamped to half the shorter adjacent edge).
export function roundPoly(pts, rc) {
  const n = pts.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const cur = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n]
    const v1x = prev[0] - cur[0], v1y = prev[1] - cur[1], l1 = Math.hypot(v1x, v1y) || 1
    const v2x = next[0] - cur[0], v2y = next[1] - cur[1], l2 = Math.hypot(v2x, v2y) || 1
    const r = Math.min(rc, l1 / 2, l2 / 2)
    const ax = cur[0] + (v1x / l1) * r, ay = cur[1] + (v1y / l1) * r
    const bx = cur[0] + (v2x / l2) * r, by = cur[1] + (v2y / l2) * r
    d += (i ? 'L' : 'M') + ax.toFixed(2) + ',' + ay.toFixed(2) + 'Q' + cur[0].toFixed(2) + ',' + cur[1].toFixed(2) + ' ' + bx.toFixed(2) + ',' + by.toFixed(2)
  }
  return d + 'Z'
}

// Per-edge outline thickness (px) by shape: thin one edge, thick another, sides
// asymmetric — the Googie tell. The inner path is the outer scaled to leave
// these borders on each side.
const BORDERS = {
  screen: { t: 3.5, r: 8, b: 3.5, l: 7 },
  marquee: { t: 6, r: 8, b: 4, l: 5 },
  hull: { t: 4, r: 5, b: 8, l: 8 },
  keystone: { t: 3, r: 5, b: 9, l: 7 },
}

// Every silhouette is inset this far inside its own card box, and the hull's top edge is a
// quadratic from `start` of the card's height at the left corner, through a control point at
// `control`, to the top edge itself at the right corner. A folded pair's seam depends on both
// figures, so they are named here rather than restated wherever the seam is computed.
export const HULL = { margin: 1.5, top: { start: 0.10, control: 0.22 } }

// How far below its card's top the hull's top edge reaches at its lowest, as a fraction of the
// card's height. A quadratic from a, through control b, to 0 has its extreme at
// t = (a - b) / (a - 2b), which for 0.10 and 0.22 is about 0.353, where the edge is about
// 0.142h down. Computed rather than written out, so it cannot drift from the path above.
export const HULL_DIP = (() => {
  const { start: a, control: b } = HULL.top
  const t = (a - b) / (a - 2 * b)
  return (1 - t) ** 2 * a + 2 * t * (1 - t) * b
})()

// How far a folded scope's two cards must overlap for the seam between them to close: each
// silhouette is inset by the margin, and each of the two edges that meet there bows away from
// the seam by up to HULL_DIP of its own card's height. Less than this and a lens of the ground
// shows through the middle; the layout takes the greater of this and its own `foldSeam`.
export function hullSeamToClose(hProject, hClose) {
  return 2 * HULL.margin + HULL_DIP * (hProject + hClose)
}

// The outer silhouette path for a shape at size w x h (margin m off the edges).
function outerPath(shape, w, h) {
  const m = HULL.margin
  const x0 = m, x1 = w - m, y0 = m, y1 = h - m
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2

  if (shape === 'keystone') {
    const P = [
      [x0 + 0.05 * w, y0 + 0.12 * h],
      [x1, y0],
      [x1 - 0.12 * w, y1],
      [x0 + 0.20 * w, y1 - 0.06 * h],
    ]
    return roundPoly(P, Math.min(11, h * 0.22))
  }
  if (shape === 'marquee') {
    // Concave cushion: four corners at the box corners, each edge bowed inward.
    return `M${x0},${y0} Q${cx},${(y0 + 0.14 * h).toFixed(1)} ${x1},${y0}` +
      ` Q${(x1 - 0.05 * w).toFixed(1)},${cy} ${x1},${y1}` +
      ` Q${cx},${(y1 - 0.14 * h).toFixed(1)} ${x0},${y1}` +
      ` Q${(x0 + 0.05 * w).toFixed(1)},${cy} ${x0},${y0} Z`
  }
  if (shape === 'hull') {
    // Wide, slightly concave top; sides taper inward; convex bottom.
    const inset = 0.13 * w
    return `M${x0},${(y0 + HULL.top.start * h).toFixed(1)} Q${cx},${(y0 + HULL.top.control * h).toFixed(1)} ${x1},${y0}` +
      ` L${(x1 - inset).toFixed(1)},${(y1 - 0.05 * h).toFixed(1)}` +
      ` Q${cx},${y1} ${(x0 + inset).toFixed(1)},${(y1 - 0.05 * h).toFixed(1)} Z`
  }
  // screen
  const R = Math.min(14, (h - 2 * m) / 2, (w - 2 * m) / 2)
  return rr(x0, y0, x1, y1, R)
}

// Returns { outer, innerT }: the outer silhouette path, and the transform that
// turns the SAME path into the inner (panel) shape, inset per edge by BORDERS.
export function buildShape(shape, w, h) {
  const outer = outerPath(shape, w, h)
  const bd = BORDERS[shape] || BORDERS.screen
  const l = Math.min(bd.l, w / 2 - 4), r = Math.min(bd.r, w / 2 - 4)
  const t = Math.min(bd.t, h / 2 - 4), b = Math.min(bd.b, h / 2 - 4)
  const sx = (w - l - r) / w, sy = (h - t - b) / h
  return { outer, innerT: `translate(${l.toFixed(2)} ${t.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})` }
}

// The atomic orbits behind a flagged node: three off-axis elliptical rings centred
// on the card, each carrying one solid electron set back from apogee. The rings are
// heavy (stroke 2.4) so they read clearly from behind the card.
function drawOrbits(group, cx, cy, colour) {
  const O = [[72, 12, -30, -38], [66, 13, 40, 215], [68, 11, 103, -38]]
  for (const [rx, ry, ang, t] of O) {
    group.appendChild(svgEl('ellipse', {
      cx, cy, rx, ry, fill: 'none', stroke: colour, 'stroke-width': 2.4,
      'stroke-opacity': 0.7, transform: `rotate(${ang} ${cx} ${cy})`,
    }))
    const rad = (ang * Math.PI) / 180, tr = (t * Math.PI) / 180
    const lx = rx * Math.cos(tr), ly = ry * Math.sin(tr)
    const dx = cx + lx * Math.cos(rad) - ly * Math.sin(rad)
    const dy = cy + lx * Math.sin(rad) + ly * Math.cos(rad)
    group.appendChild(svgEl('circle', { cx: dx.toFixed(1), cy: dy.toFixed(1), r: 4, fill: colour }))
  }
}

// Build or update a card's .cardbg silhouette (a decorator group, then the outer
// and inner filled paths) from its size and its kind/here classes. A project
// node draws the hull in the reserved project colour; a
// task marked "here" draws the marquee; every other task draws the screen. The
// colour tracks the node's status (a task) or is the project colour.
export function renderCard(cardEl) {
  const isTerminus = cardEl.classList.contains('terminus')
  // A scope's close wears the project hull, turned through half a turn: the same shape says
  // it belongs to the same pair, and the inversion says which end of it this is. It
  // carries no title, so the hull is empty.
  const isProject = cardEl.classList.contains('project') || isTerminus
  const isCursor = cardEl.classList.contains('cursor')
  const flagged = cardEl.classList.contains('flagged')
  const shape = isProject ? 'hull' : isCursor ? 'marquee' : 'screen'
  const w = cardEl.offsetWidth, h = cardEl.offsetHeight
  // A card the layout has not shown cannot be measured: "show only flagged" puts
  // display:none on every unflagged card (style.css), and an element with no box reports
  // zero for both. Painting a silhouette from that would bake viewBox="0 0 0 0" and a
  // degenerate inner transform into a card that is about to be revealed again, so leave
  // whatever it already has and wait to be called once it has a box. renderCards on the
  // filter's own toggle is what calls again.
  if (w === 0 || h === 0) return

  let svg = cardEl.querySelector('svg.cardbg')
  if (!svg) {
    svg = svgEl('svg', { class: 'cardbg', preserveAspectRatio: 'none' })
    svg.appendChild(svgEl('g', { class: 'deco' }))
    svg.appendChild(svgEl('path', { class: 'outer' }))
    svg.appendChild(svgEl('path', { class: 'inner' }))
    cardEl.insertBefore(svg, cardEl.firstChild)
  }

  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
  const { outer, innerT } = buildShape(shape, w, h)
  const outerEl = svg.querySelector('.outer'), innerEl = svg.querySelector('.inner')
  // The close is the same path turned through half a turn: mirrored about both of the
  // card's axes, so the two halves of a pair are visibly one shape and its reflection
  // rather than two drawings that have to be kept in step. The hull's top edge rises from
  // left to right, which is why the horizontal mirror shows: a half turn puts that rise on
  // the close's bottom edge, falling from left to right.
  const flip = isTerminus ? `translate(${w} ${h}) scale(-1 -1) ` : ''
  outerEl.setAttribute('d', outer)
  outerEl.setAttribute('transform', flip.trim())
  innerEl.setAttribute('d', outer)
  innerEl.setAttribute('transform', flip + innerT)

  let colour = 'todo'
  if (isProject) {
    colour = 'project'
  } else {
    const glyph = cardEl.querySelector('.gl')
    for (const name of ['done', 'prog', 'todo', 'cancel']) {
      if (glyph && glyph.classList.contains(name)) { colour = name; break }
    }
  }
  outerEl.style.fill = 'var(--c-' + colour + ')'
  // A project node and its close carry a tinted panel rather than the card panel every
  // task wears, so a scope's two ends read as one material at a glance and a folded pair,
  // drawn flush, reads as a single closed object. Cleared explicitly, since renderCard is
  // called again on the same element whenever a card changes kind.
  innerEl.style.fill = isProject ? 'var(--c-project-tint)' : ''

  // Decorators, behind the card: a flagged node wears the atomic orbits in its own colour
  // (the status colour for a task, the project colour for a project). A folded project no
  // longer casts a shadow; the pair drawn shut, its close flush on its own card, is what
  // says a scope is folded, and a shadow behind that reads as a third edge.
  const deco = svg.querySelector('.deco')
  deco.textContent = ''
  if (flagged) drawOrbits(deco, w / 2, h / 2, 'var(--c-' + colour + ')')
}

// Render every .card element under root (defaults to the whole document).
export function renderCards(root = document) {
  root.querySelectorAll('.card').forEach(renderCard)
}
