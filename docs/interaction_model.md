<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Interaction model: drag-and-drop moves and bookmark cameras

This documents two interaction algorithms whose rules are worth stating outside
the code: how a drag-and-drop rearranges the forest, and how a bookmark restores a
camera without storing a coordinate. It follows the standing convention of writing
up an adopted rule so the reasoning is not buried. The implementations are the pure
moves in [`src/renderer/src/model/mutations.js`](../src/renderer/src/model/mutations.js),
the gesture in [`src/renderer/src/interaction/drag.js`](../src/renderer/src/interaction/drag.js),
and the bookmark helpers in
[`src/renderer/src/interaction/bookmarks.js`](../src/renderer/src/interaction/bookmarks.js);
each points back here.

## Drag-and-drop: two drop rules, and reordering

There are two drop rules. Dropping a node onto a **card** grafts it there as a
fresh fork of the target (a new branch, alternating side). Dropping a node into the
**gap** between two nodes on a line splices it into that gap. Both are always valid
and both keep the "nothing before the root" rule (northstar axiom 2): a fork can be
added to any node and never sits below it, and a gap only ever sits *above* a node,
so neither can put anything below a root.

The dragged node's kind and the drop location pick one of these pure moves:

- **moveTaskNode** — a task dropped onto a card moves *alone*. Its children are
  spliced onto its predecessor in its old slot (the same reconnection
  `deleteTask`'s splice mode performs), then the childless node is grafted onto the
  target. Moving one card never drags its subtree along.
- **moveSubtree** — a project node dropped onto a card moves its *whole* subtree.
  Its incoming edge is cut and the subtree re-attached intact. Refused when the
  target is inside the moved subtree (which would detach a fragment and form a
  cycle) or is the node itself.
- **moveIntoLine** — a node dropped into a line gap splices in just above the gap's
  lower node. A task travels alone (its children splice onto its old predecessor);
  a project node carries its whole subtree, whose main-line tip then continues onto
  the gap's old upper node. Refused inserting a subtree into its own line (a cycle)
  or above itself. Because a mid-line node contains everything above it, inserting a
  sub-project into a line makes it contain that line's continuation — the same
  containment collapse already reflects.
- **detachToTree** — a sub-project dropped on empty canvas becomes its own tree:
  its incoming edge is cut and its id appended to `rootOrder`. Only a project node
  can be a root, so a task dropped on empty canvas is refused (it cannot become a
  root).
- **reorderRoot** — a root dropped on empty canvas is reordered among the trees by
  where it lands, left to right. `rootOrder` is canonicalised to the full current
  root set first (it is advisory and may omit some), so the target index is
  meaningful.

The right-click menu offers the same reordering without a drag: **moveUp /
moveDown** swap a node with its main-line neighbour, keeping each node's own
branches (a clean positional swap, distinct from `moveIntoLine`'s splice). "Move
up" needs a successor and a non-root node; "move down" needs a non-root main-line
predecessor to swap below.

Every move returns a new raw forest and is re-validated before it is applied; a
move that merges two lines has its cursors repaired by `normalizeHeres` (the
tip-most "here" on a merged line survives). "here" flags travel with the nodes they
sit on.

The gesture layer adds only mechanics: a left-button press on a card that then
moves past a small threshold begins a drag (a press that does not is left to
click / double-click), with a floating label. Hit-testing is geometric against the
layout rather than `elementFromPoint`, so the empty gaps are targetable too; the
caller draws a ring on a fork target or an insertion caret across a gap. Panning is
untouched because it is the empty-canvas gesture, so `viewport.js` skips a press
that lands on a card.

## Card gestures: clicks, not drags

Beyond the drag above, a card answers direct clicks on its parts, each part owning a
distinct sub-region so the gestures never collide:

- **status glyph**, single-click — cycles the task's status (todo → in-progress →
  completed → cancelled → todo), the click-free counterpart of the right-click
  Status submenu (`cycleStatus` in `mutations.js`).
- **notepad icon** (bottom-right, shown when the node has a note), single-click —
  opens the note editor.
- **card body**, double-click — toggles the node's **flag**, drawn as the atomic
  orbits (`toggleFlag`). The status glyph and note icon are excluded, so a
  double-click on either runs its own single-click action twice rather than flagging.

The flag is persisted in the forest file — a shared annotation, not client view
state (contrast the collapse set and camera, which stay in the client's own
sidecar; northstar axiom 8) — so a selection made by flagging survives a reload and
can be read by another tool. See `docs/node-visual-system.md` for how the orbits
render.

## Bookmark cameras: anchor to a node, not a coordinate

A bookmark is a named saved view: a collapse set, a zoom, and a camera. The camera
stores **no absolute pan**. It stores the id of the node centred in the viewport at
save time, plus that node's **ancestor chain to the root** (`anchorChain` walks the
one incoming edge up to the root). A stored coordinate would rot the moment the
layout shifted; a node anchor moves with its node.

Restoring is lazy, at jump time, and degrades in a fixed order. First the saved
collapse set is applied to the live view and the forest re-rendered, so the visible
stations are known. Then `resolveAnchor` centres the **first id in the chain that
is still present** (rendered, i.e. neither deleted nor hidden by the just-applied
collapse), at the saved zoom. So:

- the anchor still there → centre the anchor;
- the anchor deleted → centre its nearest surviving ancestor;
- the anchor hidden inside a collapsed project → centre a visible ancestor (the
  collapsed project node itself is in the chain and visible);
- the whole anchored tree gone → the chain runs dry, which is a **broken
  bookmark**: fit the domain and say so.

Deleting a node never eagerly rewrites bookmarks; the fallback is computed only
when a bookmark is used.

This split is the concrete form of northstar axiom 8. A bookmark is a *saved*
view, shared with the domain data in a `bookmarks.json` sibling of the forest
file. A client's *live* view — what it currently has collapsed, where its camera
rests — is its own state, kept in a per-client userData sidecar and never written
into the forest.
