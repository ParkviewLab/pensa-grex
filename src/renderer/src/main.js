// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Renderer entry (M0): the app shell and the Light/Dark theme toggle. The
// pan/zoom/Fit engine and the forest renderer arrive in M1+; the zoom controls
// are present in the header now and wired then.

const root = document.documentElement
const STORE_KEY = 'tfs.ground'

function setGround(g) {
  const ground = g === 'navy' ? 'navy' : 'azure'
  root.dataset.ground = ground
  try { localStorage.setItem(STORE_KEY, ground) } catch { /* storage may be unavailable */ }
  const seg = document.getElementById('mode')
  if (seg) Array.prototype.forEach.call(seg.children, (b) => b.classList.toggle('on', b.dataset.g === ground))
}

const modeBar = document.getElementById('mode')
if (modeBar) {
  modeBar.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (b) setGround(b.dataset.g)
  })
}

let saved = null
try { saved = localStorage.getItem(STORE_KEY) } catch { /* ignore */ }
setGround(saved)

console.log('TaskForkStack renderer shell loaded')
