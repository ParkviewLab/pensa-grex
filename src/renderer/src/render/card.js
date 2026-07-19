// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Builds a station's DOM: the .card content (used both for off-screen
// measurement in layout/measure.js and for the final positioned render in
// scene.js) and the positioned .stbox wrapper. Generalizes M1's
// buildStationCard (which took a render-only fixture station) to a real
// task record from the forest model (model/forest.js).

const STATUS_GLYPH = { todo: 'todo', 'in-progress': 'prog', completed: 'done', cancelled: 'cancel' }
const STATUS_TAG = { todo: 'to do', 'in-progress': 'in progress', completed: 'done', cancelled: 'cancelled' }

export function statusGlyphClass(status) {
  return STATUS_GLYPH[status] || 'todo'
}

export function statusTagText(status) {
  return STATUS_TAG[status] || status
}

// An unpositioned .card element for task. isCursor comes from the caller
// (the layout knows which line's "here" this is) rather than task.here
// directly, so a card can be measured/rendered consistently either way.
export function buildCard(task, { isCursor } = {}) {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.taskId = task.id
  if (isCursor) card.classList.add('cursor')
  if (task.status === 'cancelled') card.classList.add('cancel')
  if (task.note) card.classList.add('note')

  if (isCursor) {
    const here = document.createElement('span')
    here.className = 'here'
    here.textContent = '▲ HERE'
    card.appendChild(here)
  }

  const hd = document.createElement('div')
  hd.className = 'hd'
  const gl = document.createElement('span')
  gl.className = 'gl ' + statusGlyphClass(task.status)
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  lbl.textContent = task.title
  hd.appendChild(gl)
  hd.appendChild(lbl)
  card.appendChild(hd)

  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = statusTagText(task.status)
  card.appendChild(tag)

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
