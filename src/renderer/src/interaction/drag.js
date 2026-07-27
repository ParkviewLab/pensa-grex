// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Pointer-driven drag-and-drop for station cards and junction handles. A
// left-button press on either that then moves past a small threshold begins a
// drag; a press that does not is left to click / double-click. Panning is
// unaffected: it only starts on empty canvas (viewport.js bails when the press
// lands on a card or a handle). While dragging, a floating label follows the
// cursor; the caller resolves what the cursor is over and draws the drop hint.
//
// This module is DOM mechanics only. It reports the gesture in client coordinates
// and leaves every model rule and all hit-testing to the caller: onProbe on each
// move (update the hint), onDrop on release (apply the move), onCancel when a drag
// is abandoned. The source handed to onProbe/onDrop is a descriptor,
// { type: 'node', id } for a card or { type: 'fork'|'merge', footId } for a
// junction handle, the branch named by its foot. See docs/interaction_model.md
// for the rules the caller applies.

const THRESHOLD = 5 // px of pointer travel before a press becomes a drag

function sel(id) {
  return '[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'
}

export function createDragController({ contentEl, viewportEl, onProbe, onDrop, onCancel }) {
  let state = null // { source, startX, startY, dragging, preview }

  // The drag-src styling belongs to a card; a junction drag has no card to fade.
  const cardEl = () => (state && state.source.type === 'node' ? contentEl.querySelector(sel(state.source.id)) : null)

  function positionPreview(e) {
    if (state.preview) {
      state.preview.style.left = e.clientX + 'px'
      state.preview.style.top = e.clientY + 'px'
    }
  }

  function beginDrag(e) {
    state.dragging = true
    const src = cardEl()
    if (src) src.classList.add('drag-src')
    const preview = document.createElement('div')
    preview.className = 'drag-preview'
    preview.textContent = state.source.type === 'node'
      ? (src && src.querySelector('.lbl') && src.querySelector('.lbl').textContent) || 'node'
      : (state.source.type === 'fork' ? 'branch point' : 'merge point')
    document.body.appendChild(preview)
    state.preview = preview
    viewportEl.classList.add('drag-active')
    positionPreview(e)
  }

  function tearDown() {
    if (state.preview) state.preview.remove()
    const src = cardEl()
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
    onProbe(state.source, e.clientX, e.clientY)
    e.preventDefault()
  }

  function onUp(e) {
    if (!state) return
    const wasDragging = state.dragging
    const source = state.source
    const cx = e.clientX, cy = e.clientY
    tearDown()
    if (wasDragging) onDrop(source, cx, cy)
  }

  function onCancelEvent() {
    if (!state) return
    const wasDragging = state.dragging
    tearDown()
    if (wasDragging) onCancel()
  }

  function onDown(e) {
    if (e.button !== 0) return
    if (!e.target || !e.target.closest) return
    const card = e.target.closest('[data-node-id]')
    const jx = card ? null : e.target.closest('[data-jx-foot]')
    if (!card && !jx) return
    const source = card
      ? { type: 'node', id: card.dataset.nodeId }
      : { type: jx.dataset.jxKind, footId: jx.dataset.jxFoot }
    state = { source, startX: e.clientX, startY: e.clientY, dragging: false, preview: null }
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
