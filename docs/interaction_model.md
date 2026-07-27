<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Interaction model: drag-and-drop moves and bookmark cameras

This documents two interaction algorithms whose rules are worth stating outside
the code: how a drag-and-drop rearranges the forest, and how a bookmark restores a
camera without storing a coordinate. It follows the standing convention of writing
up an adopted rule so the reasoning is not buried. The implementations are the pure
moves in [`src/shared/model/mutations.js`](../src/shared/model/mutations.js),
the gesture in [`src/renderer/src/interaction/drag.js`](../src/renderer/src/interaction/drag.js),
and the bookmark helpers in
[`src/renderer/src/interaction/bookmarks.js`](../src/renderer/src/interaction/bookmarks.js);
each points back here.

Both algorithms are described as they run today, on schema 2. Model v3 changes the
second of them outright and the first only in its vocabulary; the record of that
design is [`model_v3_ideas.md`](model_v3_ideas.md), and what it replaces is marked
where it stands rather than rewritten ahead of the code.

## Drag-and-drop: two drop rules, and reordering

There are two drop rules. Dropping a node onto a **card** grafts it there as a
fresh fork of the target (a new branch, alternating side). Dropping a node into the
**gap** between two nodes on a line splices it into that gap. Both are always valid
and both keep the "nothing before the root" rule (northstar axiom 2): a fork can be
added to any node and never sits below it, and a gap only ever sits *above* a node,
so neither can put anything below a root.

*Model v3 adds one thing to a graft.* Every branch rejoins the trunk it left, so a
fork made by a drop is given the smallest legal return, rejoining at the very edge it
leaves; the author moves it afterwards with "Merge a branch here" on the node below
the edge it should join, which lists the branches that could legally land there.

*Model v3 also bounds what a move takes with it.* An operation on a node acts on that
node's **extent**, which is bounded by the scope it belongs to: a project node's extent
is the plan it opens, pair included, and any other node's is the run above it stopping
below the close of the scope it sits in. The unbounded reading, following `next` to the
top of the trunk, takes the work that comes after a sub-project ends and, higher up, the
enclosing plan's own close. The same bound governs delete, copy and export.

The dragged node's kind and the drop location pick one of these pure moves:

- **moveTaskNode** — a task dropped onto a card moves *alone*. Its children are
  spliced onto its predecessor in its old slot (the same reconnection
  `deleteTask`'s splice mode performs), then the childless node is grafted onto the
  target. Moving one card never drags its subtree along.
- **moveSubtree** — a project node dropped onto a card moves its *scope*: the pair,
  from its own project node to its own close, and everything between them. The scope
  is lifted whole and the trunk it left is joined across the gap, so the work that
  came after the scope ended stays where it was. Refused when the target is inside
  the moved scope (which would detach a fragment and form a cycle) or is the node
  itself.
- **moveIntoLine** — a node dropped into a line gap splices in just above the gap's
  lower node. A task travels alone (its children splice onto its old predecessor);
  a project node carries its scope, and that scope's close then continues onto the
  gap's old upper node. Refused inserting a scope into its own line (a cycle) or
  above itself.
- **detachToTree** — a sub-project dropped on empty canvas becomes its own plan:
  the pair leaves the trunk it was on, the trunk is joined across the gap, and the
  project node's id is appended to `planOrder`. Only a project node can be a root, so
  a task dropped on empty canvas is refused (it cannot become a root).
- **reorderRoot** — a root dropped on empty canvas is reordered among the trees by
  where it lands, left to right. `rootOrder` is canonicalised to the full current
  root set first (it is advisory and may omit some), so the target index is
  meaningful.

The right-click menu offers the same reordering without a drag: **moveUp /
moveDown** swap a node with its main-line neighbour, keeping each node's own
branches (a clean positional swap, distinct from `moveIntoLine`'s splice). "Move
up" needs a successor and a non-root node; "move down" needs a non-root main-line
predecessor to swap below.

*A close is the one node these will not take as their operand*, since moving it alone would
quietly resize its scope, taking in a node that was outside it or letting go of one that was
inside; the record would still be bracket-matched, so nothing downstream would object. The scope
moves by its project node, which carries its close. **Moving a node PAST a close is a different
thing and is allowed**: swapping a node with the close above it is how one says that node is no
longer part of the sub-project, and the map shows the result at once. So a scope's membership
changes by moving the member, never by moving the boundary.

### Two verbs that need a second node named

Two menu items act on a pair of nodes, and there is no selection mechanism: every edit
begins with a right-click, and that click names one node. Both solve it the same way, with
the click naming one end and a submenu the other.

- **Merge a branch here** names the target with the click and the branch with the submenu,
  which lists the branches whose return could legally land on the edge above the clicked
  node. It is how a merge fabricated by the migration is put right, and the only way a
  return moves.
- **Wrap as sub-project** names the run's base with the click and its top with the submenu
  ("Just this one", then each node further up the trunk), then asks for a name and calls
  `wrapRun`. The candidates come from `wrapCandidates`, which asks `wrapRun` itself on a
  throwaway record rather than reimplementing its rules, so the menu cannot offer a run
  that would then be refused: a run may not straddle a scope, nor contain a branch that
  rejoins outside it. Withheld on a plan's base, whose scope is the plan.

**Delete note** sits beside "Edit note" and appears only where there is a note to delete,
so the item's presence answers the question its absence would raise. It closes the editor
first if that note is open (discarding any pending autosave, which would otherwise write
the file back as it goes), then deletes the file and clears the record's reference, in that
order, which is what `delete_note` does over MCP.

Every move returns a new record and is re-validated before it is applied; a
move that merges two lines has its cursors repaired by `normalizeHeres` (the
tip-most "here" on a merged line survives). "here" flags travel with the nodes they
sit on.

*Model v3 adds a constraint and a purpose here.* A branch will carry a merge point,
so a move that changes where a branch sits has to keep that merge legal, and one
reshaping has to be refused outright rather than drawn: extending a merge across
the close of a scope the branch was opened outside, which would leave a return line
landing inside a collapsed block. `detachToTree` acquires the second purpose that
the new axiom 3 gives it, as the way to say that work diverged and will not rejoin,
which a branch may no longer say.

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
sidecar; northstar axiom 9) — so a selection made by flagging survives a reload and
can be read by another tool. See `docs/node-visual-system.md` for how the orbits
render.

A toolbar toggle, "Flagged," switches the view to show only flagged nodes and locks
editing — a read-only review of the selection. The toggle is live client view state
(like the collapse set and camera), never written to the forest.

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

This split is the concrete form of northstar axiom 9. A bookmark is a *saved*
view, shared with the domain data in a `bookmarks.json` sibling of the forest
file. A client's *live* view — what it currently has collapsed, where its camera
rests — is its own state, kept in a per-client userData sidecar and never written
into the forest.

*Superseded by model v3.* The camera stops being anchored to anything. A bookmark
stores the id of every node drawn wholly inside the viewport when it was saved, and
each client computes its own framing from where those nodes sit now, under a
maximum scale and a minimum padding. The zoom and the ancestor chain both go, which
is what makes every field in a bookmark device-independent and so fit to travel
with the data. Degradation stays graceful for the same reason it did before:
deleted ids are filtered out and the survivors framed, and only an empty set is a
broken bookmark. See `model_v3_ideas.md`, section 14.
