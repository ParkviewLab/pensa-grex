<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
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

## Drag-and-drop: one rule, four moves

Dropping a node onto a card **grafts it there as a fresh fork of the target** — a
new branch off the target, on the alternating side. This single rule is chosen for
two properties. It is always valid: a branch can be added to any node, so no drop
is ever illegal for structural reasons. And it can never place anything *below* the
target, so the "nothing before the root" rule (northstar axiom 2) holds at every
drop target, including a drop onto a tree's root, which simply gains a branch while
its base stays a base. Finer main-line insertion (drop above, below, or between)
is deliberately out of scope; it would need per-card drop zones and is a later
step.

The dragged node's kind and the drop location pick one of four pure moves:

- **moveTaskNode** — a task dropped onto a card moves *alone*. Its children are
  spliced onto its predecessor in its old slot (the same reconnection
  `deleteTask`'s splice mode performs), then the childless node is grafted onto the
  target. Moving one card never drags its subtree along.
- **moveSubtree** — a project node dropped onto a card moves its *whole* subtree.
  Its incoming edge is cut and the subtree re-attached intact. Refused when the
  target is inside the moved subtree (which would detach a fragment and form a
  cycle) or is the node itself.
- **detachToTree** — a sub-project dropped on empty canvas becomes its own tree:
  its incoming edge is cut and its id appended to `rootOrder`. Only a project node
  can be a root, so a task dropped on empty canvas is refused (it cannot become a
  root).
- **reorderRoot** — a root dropped on empty canvas is reordered among the trees by
  where it lands, left to right. `rootOrder` is canonicalised to the full current
  root set first (it is advisory and may omit some), so the target index is
  meaningful.

Every move returns a new raw forest and is re-validated before it is applied; a
move that merges two lines has its cursors repaired by `normalizeHeres` (the
tip-most "here" on a merged line survives). "here" flags travel with the nodes they
sit on.

The gesture layer adds only mechanics: a left-button press on a card that then
moves past a small threshold begins a drag (a press that does not is left to
click / double-click), with a floating label and a highlighted drop target;
panning is untouched because it is the empty-canvas gesture, so `viewport.js` skips
a press that lands on a card.

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
