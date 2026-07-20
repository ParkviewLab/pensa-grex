// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

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
