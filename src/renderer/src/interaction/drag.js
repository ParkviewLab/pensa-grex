// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Pointer-driven drag-and-drop for station cards. A left-button press on a card
// that then moves past a small threshold begins a drag; a press that does not is
// left to click / double-click. Panning is unaffected: it only starts on empty
// canvas (viewport.js bails when the press lands on a card). While dragging, a
// floating label follows the cursor and a valid drop target is highlighted. On
// release the gesture is reported to onDrop(sourceId, targetId, clientX) — a card
// under the cursor, or null for empty canvas — and the caller owns the mutation.
//
// This module is DOM mechanics only; the model rules (which move a drop means,
// what is a valid target) live with the caller via the canDrop predicate.

const THRESHOLD = 5 // px of pointer travel before a press becomes a drag

function sel(id) {
  return '[data-task-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'
}

export function createDragController({ contentEl, viewportEl, canDrop, onDrop }) {
  let state = null // { sourceId, startX, startY, dragging, preview, targetEl }

  const cardEl = (id) => contentEl.querySelector(sel(id))

  function cardIdFromPoint(x, y) {
    const el = document.elementFromPoint(x, y)
    const card = el && el.closest ? el.closest('[data-task-id]') : null
    return card ? card.dataset.taskId : null
  }

  function clearTarget() {
    if (state && state.targetEl) {
      state.targetEl.classList.remove('drop-target')
      state.targetEl = null
    }
  }

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

  function onMove(e) {
    if (!state) return
    if (!state.dragging) {
      if (Math.abs(e.clientX - state.startX) < THRESHOLD && Math.abs(e.clientY - state.startY) < THRESHOLD) return
      beginDrag(e)
    }
    positionPreview(e)
    // The preview has pointer-events:none, so elementFromPoint reports the card beneath.
    const targetId = cardIdFromPoint(e.clientX, e.clientY)
    const valid = targetId && targetId !== state.sourceId && canDrop(state.sourceId, targetId)
    const currentId = state.targetEl ? state.targetEl.dataset.taskId : null
    if (currentId !== (valid ? targetId : null)) {
      clearTarget()
      if (valid) {
        const el = cardEl(targetId)
        if (el) { el.classList.add('drop-target'); state.targetEl = el }
      }
    }
    e.preventDefault()
  }

  function onUp(e) {
    if (!state) return
    const wasDragging = state.dragging
    const sourceId = state.sourceId
    const targetId = wasDragging ? cardIdFromPoint(e.clientX, e.clientY) : null
    const clientX = e.clientX
    cleanup()
    if (wasDragging) onDrop(sourceId, targetId, clientX)
  }

  function cleanup() {
    if (!state) return
    clearTarget()
    if (state.preview) state.preview.remove()
    const src = cardEl(state.sourceId)
    if (src) src.classList.remove('drag-src')
    viewportEl.classList.remove('drag-active')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', cleanup)
    state = null
  }

  function onDown(e) {
    if (e.button !== 0) return
    const card = e.target && e.target.closest ? e.target.closest('[data-task-id]') : null
    if (!card) return
    state = { sourceId: card.dataset.taskId, startX: e.clientX, startY: e.clientY, dragging: false, preview: null, targetEl: null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
  }

  contentEl.addEventListener('pointerdown', onDown)

  return {
    destroy() {
      contentEl.removeEventListener('pointerdown', onDown)
      cleanup()
    },
  }
}
