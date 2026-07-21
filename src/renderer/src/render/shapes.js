// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Station silhouette geometry and decorators. A station's outline is the gap
// between two filled paths: an outer silhouette and an inner one, the inner a
// scaled copy of the outer inset by a DIFFERENT amount per edge, so the outline
// runs thin along one edge and thick along another (the Googie variable-weight
// look). Four shapes — screen (a task), marquee (a task marked "here"), hull (a
// project node), keystone (kept, currently unassigned) — plus composable
// decorators drawn behind the card: `orbits` (the atomic rings of a project) and
// `shadow` (a filled echo, used when a project is collapsed; see PR C).
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

// The outer silhouette path for a shape at size w x h (margin m off the edges).
function outerPath(shape, w, h) {
  const m = 1.5
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
    return `M${x0},${(y0 + 0.10 * h).toFixed(1)} Q${cx},${(y0 + 0.22 * h).toFixed(1)} ${x1},${y0}` +
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
  const isProject = cardEl.classList.contains('project')
  const isCursor = cardEl.classList.contains('cursor')
  const collapsed = cardEl.classList.contains('collapsed')
  const flagged = cardEl.classList.contains('flagged')
  const shape = isProject ? 'hull' : isCursor ? 'marquee' : 'screen'
  const w = cardEl.offsetWidth, h = cardEl.offsetHeight

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
  outerEl.setAttribute('d', outer)
  innerEl.setAttribute('d', outer)
  innerEl.setAttribute('transform', innerT)

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

  // Decorators, behind the card. A collapsed project casts a filled shadow; a
  // flagged node wears the atomic orbits in its own colour (the status colour for a
  // task, the project colour for a project).
  const deco = svg.querySelector('.deco')
  deco.textContent = ''
  if (collapsed) {
    deco.appendChild(svgEl('path', { d: outer, transform: 'translate(9 -9)', fill: 'var(--c-project)', 'fill-opacity': 0.45 }))
  }
  if (flagged) drawOrbits(deco, w / 2, h / 2, 'var(--c-' + colour + ')')
}

// Render every .card element under root (defaults to the whole document).
export function renderCards(root = document) {
  root.querySelectorAll('.card').forEach(renderCard)
}
