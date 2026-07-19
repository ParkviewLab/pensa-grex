// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Mounts a forest scene into a content element: the SVG track/marker layer
// plus the HTML station/title markers, then paints each card's silhouette.
// M1 renders the sample-fixture data; M3 replaces the fixture with the
// layout engine's output (see docs/model_ideas.md for the shape/status/
// cursor rules this reproduces).

import { renderCards } from './shapes.js'
import { ensureDefs, buildTrack, buildForkMarker, buildCursorMark, buildBurst } from './tracks.js'
import { SAMPLE_BOUNDS, SAMPLE_BURSTS, SAMPLE_TREES, STATUS_TAG } from './sample-fixture.js'

const SVGNS = 'http://www.w3.org/2000/svg'

function buildStationCard(station) {
  const stbox = document.createElement('div')
  stbox.className = 'stbox'
  stbox.style.left = station.x + 'px'
  stbox.style.top = station.top + 'px'

  const card = document.createElement('div')
  card.className = 'card'
  if (station.cursor) card.classList.add('cursor')
  if (station.status === 'cancel') card.classList.add('cancel')
  if (station.note) card.classList.add('note')

  if (station.cursor) {
    const here = document.createElement('span')
    here.className = 'here'
    here.textContent = '▲ HERE'
    card.appendChild(here)
  }

  const hd = document.createElement('div')
  hd.className = 'hd'
  const gl = document.createElement('span')
  gl.className = 'gl ' + station.status
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  lbl.textContent = station.title
  hd.appendChild(gl)
  hd.appendChild(lbl)
  card.appendChild(hd)

  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = STATUS_TAG[station.status] || station.status
  card.appendChild(tag)

  stbox.appendChild(card)
  return stbox
}

function buildDot(x, y) {
  const dot = document.createElement('div')
  dot.className = 'dot'
  dot.style.left = x + 'px'
  dot.style.top = y + 'px'
  return dot
}

function buildTitle(tree) {
  const ttl = document.createElement('div')
  ttl.className = 'ttl'
  ttl.style.left = tree.titleX + 'px'
  ttl.style.top = tree.titleY + 'px'
  ttl.textContent = tree.title
  return ttl
}

export function mountScene(contentEl, { bounds = SAMPLE_BOUNDS, bursts = SAMPLE_BURSTS, trees = SAMPLE_TREES } = {}) {
  contentEl.innerHTML = ''
  contentEl.style.width = bounds.w + 'px'
  contentEl.style.height = bounds.h + 'px'

  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('width', bounds.w)
  svg.setAttribute('height', bounds.h)
  svg.setAttribute('viewBox', '0 0 ' + bounds.w + ' ' + bounds.h)
  svg.setAttribute('style', 'position:absolute;top:0;left:0;z-index:0;')
  ensureDefs(svg)

  for (const b of bursts) svg.appendChild(buildBurst(b.x, b.y, b.scale, b.variant))

  for (const tree of trees) {
    for (const pts of tree.tracks) svg.appendChild(buildTrack(pts))
    for (const [cx, cy] of tree.forks) svg.appendChild(buildForkMarker(cx, cy))
    for (const [cx, cy] of tree.cursors) svg.appendChild(buildCursorMark(cx, cy))
  }
  contentEl.appendChild(svg)

  for (const tree of trees) {
    for (const [x, y] of tree.dots) contentEl.appendChild(buildDot(x, y))
    for (const station of tree.stations) contentEl.appendChild(buildStationCard(station))
    contentEl.appendChild(buildTitle(tree))
  }

  // cards must be in the DOM (and thus have a measurable size) before their
  // silhouettes can be painted
  renderCards(contentEl)
}
