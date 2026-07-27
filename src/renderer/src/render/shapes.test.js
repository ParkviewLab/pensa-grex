// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// What a card's silhouette is painted from, and what happens when there is nothing to
// measure. The suite runs in Vitest's node environment (vitest.config.js), so the few DOM
// operations renderCard performs are stubbed below rather than pulling in jsdom for one
// file: the stub is small because renderCard only ever creates elements, sets attributes,
// and looks its own children up by class.

import { describe, it, expect, beforeEach } from 'vitest'
import { renderCard, buildShape, hullCurveHeight, hullSeamToClose, HULL } from './shapes.js'

// A stand-in element. `sel` matching covers only what renderCard asks for, a bare class or
// a tag.class, and throws on anything else so a future selector cannot pass silently.
function el(tag, classes = []) {
  const node = {
    tag,
    classes: new Set(classes),
    attrs: new Map(),
    children: [],
    style: {},
    textContent: '',
    classList: { contains: (c) => node.classes.has(c) },
    // A real element keeps class and classList in step; renderCard creates its children by
    // passing class as an attribute and then finds them by class, so the stub must too.
    setAttribute: (k, v) => {
      node.attrs.set(k, String(v))
      if (k === 'class') node.classes = new Set(String(v).split(/\s+/).filter(Boolean))
    },
    getAttribute: (k) => (node.attrs.has(k) ? node.attrs.get(k) : null),
    appendChild: (c) => { node.children.push(c); return c },
    insertBefore: (c) => { node.children.unshift(c); return c },
    get firstChild() { return node.children[0] || null },
    querySelector: (sel) => {
      const m = /^([a-z]*)\.([\w-]+)$/.exec(sel)
      if (!m) throw new Error('the stub does not implement the selector ' + sel)
      const [, wantTag, wantClass] = m
      const hit = (n) => (!wantTag || n.tag === wantTag) && n.classes.has(wantClass)
      const walk = (n) => {
        for (const c of n.children) {
          if (hit(c)) return c
          const deep = walk(c)
          if (deep) return deep
        }
        return null
      }
      return walk(node)
    },
  }
  return node
}

function card({ w, h, classes = ['card'] }) {
  const node = el('div', classes)
  node.offsetWidth = w
  node.offsetHeight = h
  node.appendChild(el('span', ['gl', 'todo']))
  return node
}

const bg = (c) => c.querySelector('svg.cardbg')

beforeEach(() => {
  globalThis.document = {
    createElementNS: (_ns, tag) => el(tag),
  }
})

describe('buildShape — the hull\'s curve stops growing with the card', () => {
  // A project node's label is centred, so its first line sits at (h - lines * 18) / 2 from the
  // card's top. An uncapped curve descends at 0.1424 of h, which outruns the text: at one line
  // the text starts at 20 and the curve reaches 11.7, at five lines the text still starts at 16
  // and the curve would reach 19.6. Capping the curve at the project card's own minimum height
  // is what keeps the two apart at every size.
  const topOf = (d) => Number(/^M[\d.]+,([\d.]+)/.exec(d)[1])
  const controlOf = (d) => Number(/Q[\d.]+,([\d.]+)/.exec(d)[1])

  it('draws the same curve at 58 and at any height above it', () => {
    const short = buildShape('hull', 188, 58).outer
    const tall = buildShape('hull', 188, 300).outer
    expect(topOf(tall)).toBe(topOf(short))
    expect(controlOf(tall)).toBe(controlOf(short))
  })

  it('still scales the curve below the cap, where a card cannot carry a full one', () => {
    const tiny = buildShape('hull', 188, 30).outer
    expect(topOf(tiny)).toBeLessThan(topOf(buildShape('hull', 188, 58).outer))
    expect(hullCurveHeight(30)).toBe(30)
    expect(hullCurveHeight(300)).toBe(HULL.capHeight)
  })

  it('makes the seam a folded pair needs a constant, so the metric always governs', () => {
    expect(hullSeamToClose(58, 58)).toBeCloseTo(hullSeamToClose(300, 58), 9)
  })

  it('leaves the other shapes alone, having no curve to cap', () => {
    // Only the hull bows into its own card; a task's rounded rectangle does not, which is why
    // a task card keeps the padding it has.
    const a = buildShape('screen', 188, 58).outer
    const b = buildShape('screen', 188, 300).outer
    expect(a).not.toBe(b) // the box differs, of course
    expect(topOf(a)).toBe(topOf(b)) // but nothing about it grows into the card
  })
})

describe('renderCard — the box a silhouette is painted from', () => {
  it('paints the outer and inner paths from the card\'s measured box', () => {
    const c = card({ w: 188, h: 58 })
    renderCard(c)
    const svg = bg(c)
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('viewBox')).toBe('0 0 188 58')
    expect(svg.querySelector('.outer').getAttribute('d')).toMatch(/^M/)
    expect(svg.querySelector('.inner').getAttribute('d')).toMatch(/^M/)
  })

  it('turns a terminus through half a turn, the project hull mirrored on both axes', () => {
    // Both mirrors, not just the vertical one: the hull's top edge rises from left to right,
    // so a half turn is what puts that rise on the close's bottom edge falling the other way.
    const c = card({ w: 188, h: 58, classes: ['card', 'terminus'] })
    renderCard(c)
    const svg = bg(c)
    expect(svg.querySelector('.outer').getAttribute('transform')).toBe('translate(188 58) scale(-1 -1)')
    expect(svg.querySelector('.inner').getAttribute('transform')).toContain('translate(188 58) scale(-1 -1)')
  })

  it('gives a project node and its close the tinted panel, and a task the card panel', () => {
    // A scope's two ends wear a tint of the project violet rather than the panel colour every
    // task wears, so a pair reads as one material and a folded pair, drawn flush, reads as one
    // closed object. The task's inline fill is cleared rather than left set, since renderCard
    // is called again on the same element whenever a card changes kind.
    for (const classes of [['card', 'project'], ['card', 'terminus']]) {
      const c = card({ w: 188, h: 58, classes })
      renderCard(c)
      expect(bg(c).querySelector('.inner').style.fill).toBe('var(--c-project-tint)')
    }
    const t = card({ w: 188, h: 58 })
    renderCard(t)
    expect(bg(t).querySelector('.inner').style.fill).toBe('')
  })

  it('casts no shadow behind a folded project node', () => {
    // The fold is said by the pair drawn shut, its close flush on its own card; a shadow
    // behind that reads as a third edge, so the decorator layer stays empty unless the node
    // is flagged.
    const c = card({ w: 188, h: 58, classes: ['card', 'project', 'collapsed'] })
    renderCard(c)
    expect(bg(c).querySelector('.deco').children).toHaveLength(0)
    const f = card({ w: 188, h: 58, classes: ['card', 'project', 'collapsed', 'flagged'] })
    renderCard(f)
    expect(bg(f).querySelector('.deco').children.length).toBeGreaterThan(0)
  })

  it('leaves a hidden card\'s silhouette standing rather than baking a zero box into it', () => {
    // "Show only flagged" puts display:none on every unflagged card, and an element with no
    // box reports zero for both dimensions. A repaint while the filter is on must therefore
    // change nothing: painting from 0 by 0 would leave viewBox="0 0 0 0" and a degenerate
    // inner transform on a card that is about to be revealed again.
    const c = card({ w: 188, h: 58 })
    renderCard(c)
    const before = bg(c).getAttribute('viewBox')
    c.offsetWidth = 0
    c.offsetHeight = 0
    renderCard(c)
    expect(bg(c).getAttribute('viewBox')).toBe(before)
    expect(bg(c).querySelector('.outer').getAttribute('d')).toMatch(/^M/)
  })

  it('paints nothing at all for a card that has never had a box', () => {
    const c = card({ w: 0, h: 0 })
    renderCard(c)
    expect(bg(c)).toBeNull()
  })
})
