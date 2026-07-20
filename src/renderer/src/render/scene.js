// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Mounts a computed layout (layout/layout.js) into a content element: the
// SVG track/marker layer plus the HTML station/title markers, then paints
// each card's silhouette. Replaces M1's mountScene, which drew a hardcoded
// sample forest — every coordinate here comes from the layout engine.

import { renderCards } from './shapes.js'
import { ensureDefs, buildTrack, buildForkMarker, buildCursorMark } from './tracks.js'
import { buildStationBox } from './card.js'

const SVGNS = 'http://www.w3.org/2000/svg'

function buildDot(x, y) {
  const dot = document.createElement('div')
  dot.className = 'dot'
  dot.style.left = x + 'px'
  dot.style.top = y + 'px'
  return dot
}

// forest is the runtime model (model/forest.js) the layout was computed
// from — mountLayout reads each station's task record from it for the
// card's actual content (title, status, note).
export function mountLayout(contentEl, layout, forest) {
  contentEl.innerHTML = ''
  contentEl.style.width = layout.bounds.w + 'px'
  contentEl.style.height = layout.bounds.h + 'px'

  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('width', layout.bounds.w)
  svg.setAttribute('height', layout.bounds.h)
  svg.setAttribute('viewBox', '0 0 ' + layout.bounds.w + ' ' + layout.bounds.h)
  svg.setAttribute('style', 'position:absolute;top:0;left:0;z-index:0;')
  ensureDefs(svg)

  for (const t of layout.tracks) svg.appendChild(buildTrack(t.points, t.kind))
  for (const j of layout.junctions) svg.appendChild(buildForkMarker(j.x, j.y))
  for (const c of layout.cursors) svg.appendChild(buildCursorMark(c.x, c.y))
  contentEl.appendChild(svg)

  for (const d of layout.dots) contentEl.appendChild(buildDot(d.x, d.y))
  for (const s of layout.stations) {
    const task = forest.getTask(s.id)
    contentEl.appendChild(buildStationBox(task, s.x, s.cardTop, { isCursor: s.cursor }))
  }

  // cards must be in the DOM (and thus have a measurable size) before their
  // silhouettes can be painted
  renderCards(contentEl)
}
