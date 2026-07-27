<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# The node visual system: Googie shapes and atomic decorators

This documents the card silhouettes and their decorators: the geometry, the
per-edge variable outline weight that reads as Googie, and the policy that maps a
node's kind and state to a shape. It exists because the drawing carries the
structure (northstar axiom 6), so the shape grammar is design, not decoration, and
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
  `--c-cancel`), where done is the violet;
- task marked "here" → **marquee** (in the status colour) + the **Atomic Starburst**
  (in the ink colour, `var(--ink)`);
- project node → **hull**, in the reserved project colour `--c-project` (the teal:
  `#1f8f8a` on the azure ground, `#37c2ba` on navy);
- terminus node (the close of a scope, schema 3) → the same **hull** in the same violet,
  turned through half a turn: mirrored about both of the card's axes, so the pair reads as
  one shape and its reflection, and the inversion says which end of the scope this is. It
  carries no label, so the hull is empty;
- any **flagged** node → the **orbits**, in the node's own colour (its status colour
  for a task, the project violet for a project);
- a project node and its terminus → the panel is `--c-project-tint`, a tint of the
  scope teal (`#cbe6e4` on azure, `#356e69` on navy), in place of the `--panel` colour
  every task wears, so a scope's two ends read as one material;
- a **collapsed** project node → nothing additional. Its close is placed on its card
  instead (see below), which is what says the scope is shut; the card takes a little more
  padding at the top so its label clears the close's ink.

A project node shows no status glyph and no tag and can never be the cursor, so the
violet and the hull shape read unambiguously as "this is a project, not a task." The
orbits are no longer tied to project-ness: they mark the flagged state, toggled by
double-clicking a node (see `docs/interaction_model.md`).

## The hull's curve, and room for a label

The hull bows into its own card at top and bottom where a task's rounded rectangle does
not, and until 3.2.1 that bow was scaled by the card's height: the top edge dipped by
0.1424 of h. A project node's label is centred, so its first line sits at
`(h - lines * 18) / 2` from the top, and the curve descended faster than the text did. At
one line the card is held at its 58-pixel minimum and the text starts at 20, clear of a dip
of 11.7; at two lines the text starts at 11 and the dip is 11.7, so they touch; at five
lines the text still started at 11 while the dip had reached 19.6, and the first line was
half swallowed.

Two things fix it, and both are needed. The curve is scaled by `Math.min(h, capHeight)`
with `capHeight` the project card's own 58, so the dip stops at 8.3 pixels on the outer
path and about 13.8 on the panel's edge whatever the card's height. And `.card.project`
takes 16 pixels of vertical padding rather than the 11 a task takes, which, the label being
centred, does not move the text within a card of a given height but makes the card taller,
so the label lands 16 from the top and 16 from the bottom at every line count above one.

A pleasant consequence: with the curve capped, the overlap a folded pair needs to shut its
seam is a constant 19.5 at every card size, so the `foldSeam` metric of 22 always governs.

## A folded scope, drawn shut

Collapsing a project hides what lies between it and its own terminus and leaves the
trunk above the close untouched (`app.js` `pruneCollapsed`, over `scopeOf` in
`shared/model/validate.js`). The pair that remains is drawn with the two cards
touching, the close's bottom edge on the project's top edge, with no gap and no air
between them; `geometry.js` treats that one edge as the exception to the minimum.

The two silhouettes then cross. The hull's top edge rises from left to right, and the
close is that same hull turned through half a turn, so its bottom edge rises the other
way; two arcs bowing oppositely meet twice and enclose a lens. That seam is what makes
a folded pair read as one closed object rather than as two cards that happen to be
adjacent, and it is why the close is turned through half a turn rather than merely
mirrored top to bottom.

Since the fold is drawn as one object, the edge rising from a folded project node is
inside it, and nothing may be added there: the context menu withholds "Add task above",
"Add branch above", and the merge submenu until the scope is expanded.

## The decorators

Decorators are independent and compose; each is drawn behind the card so it can
overflow the card box. Two are in use; the third, the shadow, is retired.

- **orbits** — three heavy, off-axis elliptical rings centred on the card, each
  carrying one solid electron set back from apogee. Off-axis and irregular on
  purpose: rings at 0/90/180 would read as a tidy modern diagram, not atomic-age.
  Worn by any flagged node, in the node's own colour.
- **shadow** — retired. It was a filled echo of the silhouette, offset up and left at
  low opacity, drawn when a project was collapsed so a fold read as a stack of hidden
  cards. A folded scope now says so with its own two ends instead, and a shadow behind
  that reads as a third edge.
- **Atomic Starburst** (the "here" mark, `#sputnik` in `tracks.js`) — solid rays
  of irregular length at irregular angles, each tipped with a ball, around a solid
  centre. It marks the branch cursor beside the marquee. Its colour is `.cursor-mark`'s
  `var(--ink)` (near-white on navy, near-black on azure), and it is drawn 15% larger
  than the def. (The older four-plus spoke `#starburst` remains in the defs but is not
  the cursor mark.)

## The two hues, and which meaning each carries

The map gives meaning to two colours: **teal marks the structure of a plan**, a project
node and its close, and **violet marks a task that is done**. Reserving one hue for one
meaning is what lets the eye read a card's kind from colour alone, before any label.

They were the other way round until 3.2.1. Completed tasks are numerous and small while
scopes are few and large, a folded pair being the largest single object in a drawing, so
the palette was giving the loud colour to the count and the quiet one to the mass.

`style.css` therefore names each hue twice: once by hue (`--accent-teal`,
`--accent-violet`) and once by role (`--c-project`, `--c-done`, which are defined in terms
of the first pair). The role names are what the map uses, so exchanging the roles is one
line per ground. The hue names exist for the handful of surfaces outside the map that want
a particular colour rather than a particular meaning: the MCP status dot, a link inside a
note, and the note editor's syntax colours. Those do not move when the roles do.

The scope colour also has a panel tint, `--c-project-tint`, which every project node and
close wears in place of `--panel`. See
[`src/renderer/src/style.css`](../src/renderer/src/style.css) for the two-ground token
definitions.

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
