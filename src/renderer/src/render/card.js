// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Builds a station's DOM: the .card content (used both for off-screen
// measurement in layout/measure.js and for the final positioned render in
// scene.js) and the positioned .stbox wrapper, from a real node record (see
// model/forest.js). A task node shows a status glyph and tag and can be the
// "here" cursor; a project node ("sub-project") shows neither — it wears the
// reserved project colour (see render/shapes.js) and carries the project's name.

import { softHyphenate } from '../text/hyphenate.js'

const STATUS_GLYPH = { todo: 'todo', 'in-progress': 'prog', completed: 'done', cancelled: 'cancel' }
const STATUS_TAG = { todo: 'to do', 'in-progress': 'in progress', completed: 'done', cancelled: 'cancelled' }

export function statusGlyphClass(status) {
  return STATUS_GLYPH[status] || 'todo'
}

export function statusTagText(status) {
  return STATUS_TAG[status] || status
}

const SVGNS = 'http://www.w3.org/2000/svg'

// A small 1950s memo-pad glyph shown in a card's bottom-right corner when the node
// has a note; clicking it opens the note editor (wired as a delegated handler in
// app.js). Built as SVG so it inherits the theme colours from CSS (.noteicon in
// style.css): a spiral-bound pad with a few ruled lines.
function noteIconEl() {
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('class', 'noteicon')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    svg.appendChild(n)
  }
  add('rect', { class: 'np-body', x: 3, y: 3, width: 10, height: 11, rx: 1.5 })
  add('line', { class: 'np-ring', x1: 6, y1: 1.5, x2: 6, y2: 4.5 })
  add('line', { class: 'np-ring', x1: 10, y1: 1.5, x2: 10, y2: 4.5 })
  add('line', { class: 'np-rule', x1: 5.5, y1: 7.5, x2: 10.5, y2: 7.5 })
  add('line', { class: 'np-rule', x1: 5.5, y1: 10, x2: 10.5, y2: 10 })
  add('line', { class: 'np-rule', x1: 5.5, y1: 12.5, x2: 8.5, y2: 12.5 })
  return svg
}

// An unpositioned .card element for a node. isCursor comes from the caller (the
// layout knows which line's "here" this is) rather than task.here directly, so a
// card can be measured/rendered consistently either way. A project node is never
// a cursor.
export function buildCard(task, { isCursor } = {}) {
  const isProject = task.kind === 'project'
  const cursor = isCursor && !isProject

  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.taskId = task.id
  if (isProject) card.classList.add('project')
  if (task.collapsed) card.classList.add('collapsed')
  if (cursor) card.classList.add('cursor')
  if (!isProject && task.status === 'cancelled') card.classList.add('cancel')
  if (task.note) card.classList.add('note')
  if (task.flagged) card.classList.add('flagged')

  if (cursor) {
    const here = document.createElement('span')
    here.className = 'here'
    here.textContent = '▲ HERE'
    // The HERE pill takes the task's own status colour, not a dedicated cursor
    // colour, so it never collides with the in-progress colour (see shapes.js).
    here.style.background = 'var(--c-' + statusGlyphClass(task.status) + ')'
    card.appendChild(here)
  }

  const hd = document.createElement('div')
  hd.className = 'hd'
  const gl = document.createElement('span')
  gl.className = isProject ? 'gl project' : 'gl ' + statusGlyphClass(task.status)
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  // Soft-hyphenate the drawn label so a long word breaks at a syllable inside the
  // card instead of overflowing; the data keeps its clean title.
  lbl.textContent = softHyphenate(task.title)
  hd.appendChild(gl)
  hd.appendChild(lbl)
  card.appendChild(hd)

  if (!isProject) {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = statusTagText(task.status)
    card.appendChild(tag)
  }

  // A memo-pad glyph in the bottom-right corner marks a note and opens it on click.
  if (task.note) card.appendChild(noteIconEl())

  return card
}

// The positioned .stbox wrapper around a card, at the station's anchor x and
// the card's top-edge y (see layout/layout.js for how these are computed).
export function buildStationBox(task, x, cardTopY, opts) {
  const stbox = document.createElement('div')
  stbox.className = 'stbox'
  stbox.style.left = x + 'px'
  stbox.style.top = cardTopY + 'px'
  stbox.appendChild(buildCard(task, opts))
  return stbox
}
