// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The DOM half of the model → measure → layout → render pipeline: mounts a
// real (off-screen) card for every task and a real title for every tree,
// reads their laid-out pixel sizes, then removes them. layout/layout.js
// consumes the resulting sizes as plain data and never touches the DOM
// itself — see docs — so this is the only place actual text wrapping and
// font metrics matter. Card width is fixed by style.css, but height varies
// with title length and the cursor/HERE chip; the whole point of measuring
// for real (rather than estimating) is that this can never disagree with
// what actually renders.

import { buildCard } from '../render/card.js'

function offscreenContainer() {
  const el = document.createElement('div')
  el.style.position = 'absolute'
  el.style.left = '-99999px'
  el.style.top = '0'
  el.style.visibility = 'hidden'
  el.style.pointerEvents = 'none'
  document.body.appendChild(el)
  return el
}

// Resolves once fonts are ready (or immediately if the environment has no
// document.fonts, e.g. under a DOM-less test runner) — measuring before
// then reads wrong metrics on first paint.
async function fontsReady() {
  if (document.fonts && document.fonts.ready) {
    try {
      // We measure the tree titles (League Spartan 800) and task labels (Boogaloo
      // 400) for real, so explicitly load those bundled faces before measuring —
      // document.fonts.ready alone can resolve before they are requested, which
      // would measure fallback metrics on first paint and reflow when they swap in.
      if (document.fonts.load) {
        await Promise.all([
          document.fonts.load('400 12px "League Spartan"'),
          document.fonts.load('800 12px "League Spartan"'),
          document.fonts.load('400 12px "Boogaloo"'),
        ])
      }
      await document.fonts.ready
    } catch { /* proceed with best-effort metrics */ }
  }
}

// Returns { sizes: Map<taskId,{cardW,cardH}>, titleSizes: Map<treeId,{titleW,titleH}> }.
// A task's own .here flag (already validated to at most one per line by
// model/validate.js) decides whether it measures as a cursor card — the
// wider/taller trapezium with its HERE chip.
export async function measureForest(forest) {
  await fontsReady()
  const container = offscreenContainer()

  const cardEls = new Map()
  for (const [id, task] of forest.tasks) {
    const card = buildCard(task, { isCursor: task.here })
    container.appendChild(card)
    cardEls.set(id, card)
  }

  const titleEls = new Map()
  for (const tree of forest.trees) {
    const ttl = document.createElement('div')
    ttl.className = 'ttl'
    ttl.style.position = 'static' // .ttl is normally position:absolute; measure it in flow instead
    ttl.textContent = tree.name
    container.appendChild(ttl)
    titleEls.set(tree.id, ttl)
  }

  const sizes = new Map()
  for (const [id, card] of cardEls) {
    sizes.set(id, { cardW: card.offsetWidth, cardH: card.offsetHeight })
  }
  const titleSizes = new Map()
  for (const [treeId, ttl] of titleEls) {
    titleSizes.set(treeId, { titleW: ttl.offsetWidth, titleH: ttl.offsetHeight })
  }

  container.remove()
  return { sizes, titleSizes }
}
