// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Pointer-driven drag-and-drop for station cards. A left-button press on a card
// that then moves past a small threshold begins a drag; a press that does not is
// left to click / double-click. Panning is unaffected: it only starts on empty
// canvas (viewport.js bails when the press lands on a card). While dragging, a
// floating label follows the cursor; the caller resolves what the cursor is over
// and draws the drop hint.
//
// This module is DOM mechanics only. It reports the gesture in client coordinates
// and leaves every model rule and all hit-testing to the caller: onProbe on each
// move (update the hint), onDrop on release (apply the move), onCancel when a drag
// is abandoned. See docs/interaction_model.md for the rules the caller applies.

const THRESHOLD = 5 // px of pointer travel before a press becomes a drag

function sel(id) {
  return '[data-task-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'
}

export function createDragController({ contentEl, viewportEl, onProbe, onDrop, onCancel }) {
  let state = null // { sourceId, startX, startY, dragging, preview }

  const cardEl = (id) => contentEl.querySelector(sel(id))

  function positionPreview(e) {
    if (state.preview) {
      state.preview.style.left = e.clientX + 'px'
      state.preview.style.top = e.clientY + 'px'
    }
  }

  function beginDrag(e) {
    state.dragging = true
    const src = cardEl(state.sourceId)
    if (src) src.classList.add('drag-src')
    const preview = document.createElement('div')
    preview.className = 'drag-preview'
    preview.textContent = (src && src.querySelector('.lbl') && src.querySelector('.lbl').textContent) || 'node'
    document.body.appendChild(preview)
    state.preview = preview
    viewportEl.classList.add('drag-active')
    positionPreview(e)
  }

  function tearDown() {
    if (state.preview) state.preview.remove()
    const src = cardEl(state.sourceId)
    if (src) src.classList.remove('drag-src')
    viewportEl.classList.remove('drag-active')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancelEvent)
    state = null
  }

  function onMove(e) {
    if (!state) return
    if (!state.dragging) {
      if (Math.abs(e.clientX - state.startX) < THRESHOLD && Math.abs(e.clientY - state.startY) < THRESHOLD) return
      beginDrag(e)
    }
    positionPreview(e)
    onProbe(state.sourceId, e.clientX, e.clientY)
    e.preventDefault()
  }

  function onUp(e) {
    if (!state) return
    const wasDragging = state.dragging
    const sourceId = state.sourceId
    const cx = e.clientX, cy = e.clientY
    tearDown()
    if (wasDragging) onDrop(sourceId, cx, cy)
  }

  function onCancelEvent() {
    if (!state) return
    const wasDragging = state.dragging
    tearDown()
    if (wasDragging) onCancel()
  }

  function onDown(e) {
    if (e.button !== 0) return
    const card = e.target && e.target.closest ? e.target.closest('[data-task-id]') : null
    if (!card) return
    state = { sourceId: card.dataset.taskId, startX: e.clientX, startY: e.clientY, dragging: false, preview: null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancelEvent)
  }

  contentEl.addEventListener('pointerdown', onDown)

  return {
    destroy() {
      contentEl.removeEventListener('pointerdown', onDown)
      if (state) { const d = state.dragging; tearDown(); if (d) onCancel() }
    },
  }
}
