// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

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
  if (svgEl.querySelector('defs#tfs-defs')) return
  const defs = el('defs', { id: 'tfs-defs' })

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

// An 'M..L..' polyline path through pts (an array of [x,y] pairs) — a
// straight riser is a 2-point polyline, a branch elbow a 3-point one.
export function trackPath(pts) {
  return pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ',' + y).join(' ')
}

export function buildTrack(pts) {
  return el('path', { class: 'track', d: trackPath(pts) })
}

// The small diamond marking a fork junction, centered at (cx,cy).
export function buildForkMarker(cx, cy, size = 8) {
  return el('rect', {
    class: 'fork',
    x: cx - size / 2, y: cy - size / 2, width: size, height: size,
    transform: 'rotate(45 ' + cx + ' ' + cy + ')',
  })
}

export function buildCursorMark(x, y) {
  return el('use', { href: '#sputnik', class: 'cursor-mark', transform: 'translate(' + x + ',' + y + ')' })
}

export function buildBurst(x, y, scale, variant) {
  const cls = variant ? 'burst ' + variant : 'burst'
  return el('use', { href: '#starburst', class: cls, transform: 'translate(' + x + ',' + y + ') scale(' + scale + ')' })
}
