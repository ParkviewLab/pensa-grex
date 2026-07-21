<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# The node visual system: Googie shapes and atomic decorators

This documents the card silhouettes and their decorators: the geometry, the
per-edge variable outline weight that reads as Googie, and the policy that maps a
node's kind and state to a shape. It exists because the drawing carries the
structure (northstar axiom 5), so the shape grammar is design, not decoration, and
is written down rather than left in the code. The implementation is
[`src/renderer/src/render/shapes.js`](../src/renderer/src/render/shapes.js) (the
silhouettes and the `orbits` / `shadow` decorators) and
[`src/renderer/src/render/tracks.js`](../src/renderer/src/render/tracks.js) (the
Atomic Starburst, the "here" mark); both point back here.

## Outline as a gap between two fills

A card has no stroked border. Its outline is the visible gap between two filled
paths: an **outer** silhouette in the node's colour, and an **inner** silhouette
in the panel colour laid over it. The inner is the *same* path as the outer,
transformed by a translate-and-scale that insets it by a **different amount on
each edge**. Where the inset is small the colour band is thin; where it is large
the band is thick. That per-edge asymmetry, a thin top over a heavy bottom, one
side steeper than the other, is the Googie tell; a uniform stroke would read as
flat and modern instead.

The insets live in `BORDERS`, one four-tuple (top, right, bottom, left) per shape.
`buildShape(shape, w, h)` returns the outer path plus the `innerT` transform;
`renderCard` fills the outer in the node's colour and the inner in the panel
colour. Because the inner is a scaled copy, the outline follows any silhouette,
straight-edged or bezier, without a second hand-drawn path.

## The four shapes

- **screen** — a plain task. A rounded rectangle; the quiet default.
- **marquee** — a task carrying the "here" cursor. A concave cushion: four corners
  at the box, each edge bowed inward. It leans and reads as the active card, and
  keeps the Atomic Starburst beside it.
- **hull** — a project node (a sub-project or a tree's root). A wide, slightly
  concave top over inward-tapering sides and a convex bottom; it looks like a base
  something grows from, which is what a project root is.
- **keystone** — a rounded, asymmetric quadrilateral. Kept in the registry but
  currently unassigned, held for a future node state.

## Assignment (policy, changeable)

The mapping is policy, set in `renderCard`, not a property of the shapes:

- task → **screen**, coloured by status (`--c-todo` / `--c-prog` / `--c-done` /
  `--c-cancel`);
- task marked "here" → **marquee** + the **Atomic Starburst**, keeping the status
  colour;
- project node → **hull** + **orbits**, in the reserved project colour
  `--c-project` (a violet: `#7d54a6` on the azure ground, `#bd93e6` on navy);
- a **collapsed** project node additionally casts a **shadow**.

A project node shows no status glyph and no tag and can never be the cursor, so the
violet and the orbits read unambiguously as "this is a project, not a task."

## The three decorators

Decorators are independent and compose; each is drawn behind the card so it can
overflow the card box.

- **orbits** — three thin, off-axis elliptical rings centred on the card, each
  carrying one solid electron set back from apogee. Off-axis and irregular on
  purpose: rings at 0/90/180 would read as a tidy modern diagram, not atomic-age.
  Worn by every project node.
- **shadow** — a filled echo of the silhouette, offset down and right at low
  opacity, drawn when a project is collapsed so a folded project reads as a stack
  of hidden cards.
- **Atomic Starburst** (the "here" mark, `#sputnik` in `tracks.js`) — solid rays
  of irregular length at irregular angles, each tipped with a ball, around a solid
  centre. It marks the branch cursor beside the marquee, and takes the here-node's
  own status colour (set per-instance in `scene.js` via `buildCursorMark`, with
  `.cursor-mark`'s `var(--ink)` as the fallback), so the mark matches its card. (The
  older four-plus spoke `#starburst` remains in the defs but is not the cursor mark.)

## Reserved colour

`--c-project` is reserved for project nodes and used nowhere else, in both grounds
(azure and navy). Reserving one hue for one meaning is what lets the eye read
"project" from colour alone, before any label. See
[`src/renderer/src/style.css`](../src/renderer/src/style.css) for the two-ground
token definitions.

## Label hyphenation

Cards are a fixed 188px wide. A multi-word label wraps at its spaces, but a long
single word (a coined term, an identifier) has nowhere to break and would run past
the card edge. So the drawn label is passed through soft-hyphenation
([`src/renderer/src/text/hyphenate.js`](../src/renderer/src/text/hyphenate.js)):
the Liang/TeX hyphenation algorithm (the `hypher` engine, BSD-3-Clause) run over
the standard American-English patterns
([`text/hyphen-en-us.js`](../src/renderer/src/text/hyphen-en-us.js), the
`hyph-en-us` patterns under Gerard Kuiken's all-permissive notice) inserts soft
hyphens (U+00AD) at syllable boundaries. Those are invisible until a word must
wrap, at which point one shows as a real hyphen, so "Supercalifragilistic­…" breaks
at syllables inside the card instead of overflowing.

This is chosen over the browser's own `hyphens: auto`, which Chromium supports
unevenly across operating systems; the pattern computation is offline and
deterministic on every platform. Only the drawn label is hyphenated, so the forest
data keeps its clean titles, and because both measurement and render build the card
through the same `buildCard`, the measured size always matches what is drawn. An
`overflow-wrap: break-word` on the label is the last resort, for a token with no
syllable break at all (a hash, a URL), so nothing can overflow even then. The lane
pitch (`laneStep` in `layout.js`) tracks the card width, so widening the card is a
paired change with the lane spacing.
