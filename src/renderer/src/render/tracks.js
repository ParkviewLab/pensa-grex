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

// An 'M..L..' polyline path through pts (an array of [x,y] pairs): a spine is a 2-point polyline,
// a lateral line two or three points, a ramp and a flat run and a ramp.
export function trackPath(pts) {
  return pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ',' + y).join(' ')
}

// How an underpass is drawn. Where a lateral line crosses another, the other runs on unbroken and
// the lateral yields: it is cut by a strip lying along the line it passes under, and each cut end
// carries a cap parallel to that line, so the cap reads as a slice of what runs on. A trunk is
// always vertical, so a crossing of one gets vertical caps; a crossing of a return gets caps at the
// return's own twelve degrees.
//
// The air is specified across the line being passed under, which is what the eye judges, rather
// than along the lateral, which is what the geometry works in. The two are equal only at a right
// angle: a branch meets a trunk square but meets a return at twice twelve degrees, or at twelve
// where one of them is running flat, and at that angle three pixels across the line is seven along
// it. One figure therefore governs both the strip's width and the cap's position, since a cap that
// disagreed with its own cut would read as a detached tick.
const TUNE = {
  perpClear: 3, // air between the cut end and the edge of the line being passed under
  breakMax: 12, // how far back along the lateral a cut may sit, so a nearly parallel crossing
  // keeps most of its line; the air is given up rather than the line
  capLength: 9.2, // four times the lateral's own stroke
  stripLength: 30, // how far a cut reaches along the crossed line: enough to span the lateral
}
// Half the stroke of each kind of line a lateral can pass behind (style.css: .track.riser 3,
// .track.return 2.3), since the air is measured from the line's edge and not from its centre.
const CROSSED_HALF = { riser: 1.5, return: 1.15 }

// The one measurement a break has: how far back along the lateral its cut ends sit, and how wide
// the strip that cuts them is. Both come out of the same figure, because the cap is drawn at the
// cut and a cap that disagreed with its own cut by a pixel or two would read as a detached tick.
//
// The wanted figure is air ACROSS the crossed line, since that is what the eye judges, and the
// distance along the lateral is that divided by the sine of the angle between the two. Where they
// meet nearly parallel, that distance is capped and the air is given up instead.
function breakSize(a, b, p, tune) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const [ax, ay] = p.along || [0, 1]
  const alen = Math.hypot(ax, ay) || 1
  // The sine of the angle between the two lines, as the magnitude of the unit cross product.
  const sin = Math.abs(((b[0] - a[0]) / len) * (ay / alen) - ((b[1] - a[1]) / len) * (ax / alen))
  const across = tune.perpClear + (CROSSED_HALF[p.over] || CROSSED_HALF.return)
  const half = sin < 1e-6 ? tune.breakMax : Math.min(tune.breakMax, across / sin)
  return { half, halfW: half * Math.max(sin, 1e-6) } // along the lateral, and across the crossed line
}

// The cut itself, as a hole in what may be drawn: a strip centred on the line being passed under,
// as wide as the air wanted either side of it, and long enough to span the lateral crossing it.
//
// Cutting with a strip rather than shortening the path is what puts the cut PARALLEL to the line
// that runs on. A path can only end square to its own direction, and its round cap ends in a bulb
// of ink a stroke-width across, which is what shows past a cap where the two lines meet shallowly.
export function underpassClip(pts, breaks = [], tuning = {}) {
  const tune = { ...TUNE, ...tuning }
  // An outer rectangle large enough to cover any drawing, then one strip per cut. With the
  // even-odd rule the strips become holes, so the line is drawn everywhere but there.
  let d = 'M-99999,-99999 H99999 V99999 H-99999 Z'
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    for (const p of breaks) {
      if (!onSegment(a, b, p)) continue
      const [ax, ay] = p.along || [0, 1]
      const alen = Math.hypot(ax, ay) || 1
      const ux = ax / alen
      const uy = ay / alen
      const { halfW } = breakSize(a, b, p, tune)
      const halfL = tune.stripLength / 2
      const corners = [
        [p.x + ux * halfL - uy * halfW, p.y + uy * halfL + ux * halfW],
        [p.x + ux * halfL + uy * halfW, p.y + uy * halfL - ux * halfW],
        [p.x - ux * halfL + uy * halfW, p.y - uy * halfL - ux * halfW],
        [p.x - ux * halfL - uy * halfW, p.y - uy * halfL + ux * halfW],
      ]
      d += ' M' + corners.map(([x, y]) => x + ',' + y).join(' L') + ' Z'
    }
  }
  return d
}

function onSegment(a, b, p) {
  return (p.x - a[0]) * (p.x - b[0]) < 0 && (p.y - a[1]) * (p.y - b[1]) <= 0
}
// A point `distance` from `from`, in the direction a to b.
function along(a, b, from, distance) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!len) return from
  return [from[0] + ((b[0] - a[0]) / len) * distance, from[1] + ((b[1] - a[1]) / len) * distance]
}

// The two caps that mark one underpass, so the gap reads as a line passing behind rather than as a
// line that simply stops. Each cap lies PARALLEL to the line being passed under, which the break
// carries as `along`: a cap reads as a slice of the line that runs on, so a crossing of a trunk
// gets vertical caps and a crossing of a return gets caps at the return's own twelve degrees.
export function underpassCaps(pts, breaks = [], tuning = {}) {
  const tune = { ...TUNE, ...tuning }
  const caps = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    for (const p of breaks) {
      if (!onSegment(a, b, p)) continue
      const { half } = breakSize(a, b, p, tune)
      const [ax, ay] = p.along || [0, 1]
      const len = Math.hypot(ax, ay) || 1
      const half1 = [(ax / len) * (tune.capLength / 2), (ay / len) * (tune.capLength / 2)]
      for (const side of [-1, 1]) {
        const [x, y] = along(a, b, [p.x, p.y], half * side)
        caps.push(el('line', {
          class: 'underpass-cap',
          x1: x - half1[0], y1: y - half1[1], x2: x + half1[0], y2: y + half1[1],
        }))
      }
    }
  }
  return caps
}

let clipSeq = 0

// A track. `kind` is 'riser' (the vertical spine between stacked nodes on a line),
// 'branch' (a fork connector) or 'return' (a branch rejoining its trunk); the lateral
// kinds are weighted the same in CSS and the spine slightly heavier, so the main line
// reads first.
//
// A lateral that passes behind another line comes back as a group: its whole path, clipped so that
// a strip along each crossed line is missing, and a cap at each cut end. Clipping rather than
// stopping the path short is what makes the cut parallel to the line that runs on: a stroke can
// only end square to its own direction, and its round cap adds a bulb of ink half a stroke beyond
// that, which is what showed past the caps at a shallow crossing.
export function buildTrack(track) {
  const { points, kind, breaks } = track
  const cls = kind === 'branch' || kind === 'return' ? kind : 'riser'
  if (breaks && breaks.length) {
    const group = el('g', { class: 'track-underpass' })
    const id = 'pensagrex-underpass-' + (clipSeq++)
    const clip = el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' })
    clip.appendChild(el('path', { 'clip-rule': 'evenodd', d: underpassClip(points, breaks) }))
    group.appendChild(clip)
    group.appendChild(el('path', { class: 'track ' + cls, d: trackPath(points), 'clip-path': 'url(#' + id + ')' }))
    for (const cap of underpassCaps(points, breaks)) group.appendChild(cap)
    return group
  }
  return el('path', { class: 'track ' + cls, d: trackPath(points) })
}

// The small diamond marking a junction, centered at (cx,cy). Given a junction record
// (kind, edgeBelowId, footIds) it becomes an interactive object: a group holding the
// diamond and a transparent hit halo, since 8px of ink is no target for a finger or a
// zoomed-out pointer. The halo carries the junction's address for the drag layer, on its
// OWN attributes: data-node-id belongs to cards, and borrowing it here would hand the
// halo to the card paths (menus, clicks, selector lookups) that key on it. A shared
// diamond (several feet at one point) gets no halo: a drag must name one branch, and the
// menu is the surface that can, so the shared case stays menu-only.
//
// The whole SVG layer is hidden in the flagged-only mode, which is what keeps these
// handles out of that read-only view without a rule of their own.
export function buildForkMarker(cx, cy, size = 8, jx = null) {
  const diamond = el('rect', {
    class: 'fork',
    x: cx - size / 2, y: cy - size / 2, width: size, height: size,
    transform: 'rotate(45 ' + cx + ' ' + cy + ')',
  })
  if (!jx || !jx.kind || !Array.isArray(jx.footIds) || jx.footIds.length !== 1) return diamond
  const g = el('g', { class: 'jx jx-' + jx.kind })
  g.appendChild(diamond)
  g.appendChild(el('circle', {
    class: 'jx-hit', cx, cy, r: 13,
    'data-jx-kind': jx.kind, 'data-jx-edge': jx.edgeBelowId, 'data-jx-foot': jx.footIds[0],
  }))
  return g
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
