// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The pan/zoom/fit engine, ported from the design mock
// (docs/subway-forest-themed.html). A viewport (fixed, clipped) shows a world
// (panned/scaled via a CSS transform). getBounds() supplies the current
// content size in world px, so fit() can frame it — the mock hardcoded this
// as CW/CH; here it is a callback so a later computed layout (M3) can supply
// its bounds without recreating the viewport.

export function createViewport({ viewportEl, worldEl, pctEl, getBounds, minScale = 0.2, maxScale = 3 }) {
  let scale = 1, tx = 0, ty = 0

  function clamp(v) {
    return Math.max(minScale, Math.min(maxScale, v))
  }

  function apply() {
    worldEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'
    if (pctEl) pctEl.textContent = Math.round(scale * 100) + '%'
  }

  function fit() {
    const bounds = getBounds()
    const vw = viewportEl.clientWidth, vh = viewportEl.clientHeight
    if (!bounds || !bounds.w || !bounds.h || !vw || !vh) return
    scale = clamp(Math.min(vw / bounds.w, vh / bounds.h) * 0.94)
    tx = (vw - bounds.w * scale) / 2
    ty = (vh - bounds.h * scale) / 2
    apply()
  }

  function zoomAt(factor, cx, cy) {
    const ns = clamp(scale * factor)
    const wx = (cx - tx) / scale, wy = (cy - ty) / scale
    scale = ns
    tx = cx - wx * ns
    ty = cy - wy * ns
    apply()
  }

  let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0

  function onWheel(e) {
    e.preventDefault()
    const r = viewportEl.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top)
  }
  function onPointerDown(e) {
    dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty
    viewportEl.classList.add('dragging')
    viewportEl.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!dragging) return
    tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); apply()
  }
  function endDrag() {
    dragging = false
    viewportEl.classList.remove('dragging')
  }

  viewportEl.addEventListener('wheel', onWheel, { passive: false })
  viewportEl.addEventListener('pointerdown', onPointerDown)
  viewportEl.addEventListener('pointermove', onPointerMove)
  viewportEl.addEventListener('pointerup', endDrag)
  viewportEl.addEventListener('pointercancel', endDrag)

  function destroy() {
    viewportEl.removeEventListener('wheel', onWheel)
    viewportEl.removeEventListener('pointerdown', onPointerDown)
    viewportEl.removeEventListener('pointermove', onPointerMove)
    viewportEl.removeEventListener('pointerup', endDrag)
    viewportEl.removeEventListener('pointercancel', endDrag)
  }

  return { fit, zoomAt, apply, clamp, getScale: () => scale, destroy }
}
