// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The Light/Dark ground toggle. Switching ground only flips a data attribute
// — every fill in the skin is a CSS variable, so no re-layout or re-measure
// is needed (see docs/model_ideas.md).

const STORE_KEY = 'tfs.ground'

export function initTheme(segEl) {
  const root = document.documentElement

  function setGround(g) {
    const ground = g === 'navy' ? 'navy' : 'azure'
    root.dataset.ground = ground
    try { localStorage.setItem(STORE_KEY, ground) } catch { /* storage may be unavailable */ }
    if (segEl) Array.prototype.forEach.call(segEl.children, (b) => b.classList.toggle('on', b.dataset.g === ground))
  }

  if (segEl) {
    segEl.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (b) setGround(b.dataset.g)
    })
  }

  let saved = null
  try { saved = localStorage.getItem(STORE_KEY) } catch { /* ignore */ }
  setGround(saved)

  return { setGround }
}
