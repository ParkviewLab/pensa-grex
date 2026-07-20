// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Station silhouette geometry, ported from the design mock
// (docs/subway-forest-themed.html on doc-design-studies). A station's outline
// is the gap between two filled paths: an outer silhouette and an inner one
// inset per side (top/right/bottom/left), so the outline can carry a different
// weight on each edge. Two shapes: "screen" (a rounded rectangle, the default
// station) and "trapezium" (a leaning marquee quadrilateral with no parallel
// sides, used for the current "here" station on a branch).

const SVGNS = 'http://www.w3.org/2000/svg'

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

// Inset a polygon pts inward by a per-edge thickness th (th[i] is the inset
// for the edge from pts[i] to pts[i+1]), by intersecting offset edge lines.
export function insetPoly(pts, th) {
  const n = pts.length
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1] }
  cx /= n; cy /= n
  const lines = []
  for (let i = 0; i < n; i++) {
    const A = pts[i], B = pts[(i + 1) % n]
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1
    let nx = -dy / len, ny = dx / len
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny }
    lines.push({ px: A[0] + nx * th[i], py: A[1] + ny * th[i], dx, dy })
  }
  const out = []
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i]
    const D = L1.dx * -L2.dy - -L2.dx * L1.dy
    if (Math.abs(D) < 1e-6) { out.push([L2.px, L2.py]); continue }
    const rx = L2.px - L1.px, ry = L2.py - L1.py
    const tt = (rx * -L2.dy - -L2.dx * ry) / D
    out.push([L1.px + L1.dx * tt, L1.py + L1.dy * tt])
  }
  return out
}

// sides = {t,r,b,l} outline thickness in px for each edge. Returns
// { outer, inner } SVG path strings for the given shape at size w x h.
export function buildShape(shape, w, h, sides) {
  const m = 1.5
  const t = Math.max(0, Math.min(sides.t, h / 2 - 4))
  const b = Math.max(0, Math.min(sides.b, h / 2 - 4))
  const l = Math.max(0, Math.min(sides.l, w / 2 - 4))
  const r = Math.max(0, Math.min(sides.r, w / 2 - 4))
  const mn = Math.min(t, b, l, r)

  if (shape === 'trapezium') {
    // Marquee lean: both sides slant the same way (rightward), with a slight
    // taper so no two sides are parallel. Corners map to top/right/bottom/left.
    const P = [[m + w * 0.10, m], [w - m, m + h * 0.05], [w - m - w * 0.08, h - m], [m, h - m - h * 0.10]]
    const rcO = Math.min(7, h * 0.16, w * 0.06)
    const rcI = Math.max(2.5, rcO - mn)
    return { outer: roundPoly(P, rcO), inner: roundPoly(insetPoly(P, [t, r, b, l]), rcI) }
  }

  const R = Math.min(14, (h - 2 * m) / 2, (w - 2 * m) / 2)
  const Ri = Math.max(3, R - mn)
  return { outer: rr(m, m, w - m, h - m, R), inner: rr(m + l, m + t, w - m - r, h - m - b, Ri) }
}

// Per-side outline weight by role: the current ("here") station runs a touch
// heavier than a plain screen; both are thin top/bottom, heavier on the
// sides, with the right edge a little heavier than the left.
export function sidesForRole(isCursor) {
  return isCursor ? { t: 4, r: 9, b: 4, l: 8 } : { t: 3.5, r: 8, b: 3.5, l: 7 }
}

// Build or update a card element's .cardbg silhouette (outer + inner filled
// paths) from its current size and status/cursor classes. The outline colour
// tracks the task's status; the current ("here") node is the orange accent.
export function renderCard(cardEl) {
  const isCursor = cardEl.classList.contains('cursor')
  const shape = isCursor ? 'trapezium' : 'screen'
  const sides = sidesForRole(isCursor)
  const w = cardEl.offsetWidth, h = cardEl.offsetHeight

  let svg = cardEl.querySelector('svg.cardbg')
  if (!svg) {
    svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', 'cardbg')
    svg.setAttribute('preserveAspectRatio', 'none')
    const outer = document.createElementNS(SVGNS, 'path')
    outer.setAttribute('class', 'outer')
    const inner = document.createElementNS(SVGNS, 'path')
    inner.setAttribute('class', 'inner')
    svg.appendChild(outer)
    svg.appendChild(inner)
    cardEl.insertBefore(svg, cardEl.firstChild)
  }

  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
  const d = buildShape(shape, w, h, sides)
  svg.querySelector('.outer').setAttribute('d', d.outer)
  svg.querySelector('.inner').setAttribute('d', d.inner)

  // A project node wears the reserved project colour; a task wears its status
  // colour (recovered from the status-glyph class). The current ("here") card
  // takes no dedicated cursor colour — its here-ness is the trapezium shape, the
  // heavier outline, and the sputnik mark instead.
  let status = 'todo'
  if (cardEl.classList.contains('project')) {
    status = 'project'
  } else {
    const glyph = cardEl.querySelector('.gl')
    for (const name of ['done', 'prog', 'todo', 'cancel']) {
      if (glyph && glyph.classList.contains(name)) { status = name; break }
    }
  }
  svg.querySelector('.outer').style.fill = 'var(--c-' + status + ')'
}

// Render every .card element under root (defaults to the whole document).
export function renderCards(root = document) {
  root.querySelectorAll('.card').forEach(renderCard)
}
