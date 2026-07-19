<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# Tree layout: the non-crossing branch placement

This documents the algorithm that places branches horizontally in the subway map,
its lineage in the literature, and the variant we implement. It exists because of
a standing convention: when we adopt a known algorithm or a variant of one, we
write it up here so the reasoning is not buried in the code. The implementation
lives in [`src/renderer/src/layout/geometry.js`](../src/renderer/src/layout/geometry.js)
(`assignLanes`) with the connector detail in
[`src/renderer/src/layout/layout.js`](../src/renderer/src/layout/layout.js); both
point back to this file.

## The problem

A forest is drawn bottom-up: each tree is a vertical spine (the trunk line), and
branches fork off it to the left and right, each branch itself a vertical line that
can fork again. The one hard requirement is that branch connectors must never
cross; when a branch grows and would collide with another, the layout grows
outward (more lanes) and upward, never over another branch.

The first implementation assigned each line an integer lane by greedy first-fit,
reusing a lane whenever two lines' row-ranges did not vertically overlap, with no
awareness of the branch tree. That is correct for keeping cards from overlapping,
but blind to connector crossings: growing one branch into a row occupied by a
sibling pushed the sibling outward, and the sibling's horizontal connector then
swept straight across the grown branch's lane.

## The established solution

This is the well-studied "tidy tree" drawing problem, and its aesthetic
guarantees, edges do not cross, subtrees are drawn identically wherever they sit,
and horizontal distance is minimal, are exactly the invariant we need.

- Knuth (1971) and Wetherell and Shannon (1979) established the postorder,
  parent-centering approach.
- Reingold and Tilford (1981) added the decisive rule that a subtree is drawn the
  same wherever it appears, which is what forbids crossings and interleaving.
- Walker (1990) generalized it to trees of unbounded degree (our forks are n-ary).
- Buchheim, Jünger, and Leipert (2002) corrected Walker to genuine linear time.
- van der Ploeg (2014) extended it to non-layered trees, where nodes vary in size
  and children sit at a fixed distance rather than snapping to shared rows.

The reusable mechanism is the **contour**: each subtree carries the extreme
coordinates it occupies at each level (its left and right outlines). To place a
sibling next to an already-placed one, you compare the right contour of what is
placed against the left contour of the newcomer and shift the newcomer out by
exactly the overlap, no more. Threads (skip-links along the contour) make each
comparison cost O(depth) rather than O(n), and shifts are deferred and applied in
one pass to keep the whole thing linear.

We port the mechanism, not a package. `d3-hierarchy`'s `d3.tree` implements
Buchheim, but it is single-direction and layered: children spread on one side, one
depth-band below the parent, all bands the same width. Our layout is two-sided
around a vertical spine, branches attach at arbitrary rows along it, and a `.next`
successor is colinear with its parent rather than offset. None of that maps onto
`d3.tree`, and our rows are already assigned, so its depth-by-level is dead weight.
Porting keeps it dependency-free (the repo tracks REUSE/AGPL licensing) and pure.

## Our variant

The algorithm runs over a **line tree**, not the task tree. A line is a task plus
its `.next` chain, drawn colinear at one x; a line's children are the branch-lines
forking off any of its tasks, partitioned left and right by the branch's `side`.
The trunk line is pinned at lane 0.

Because our cards are a fixed width and rows are pre-assigned, the contour reduces
to a per-side, per-row occupancy of integer **lanes**, and the shift reduces to
pushing a whole subtree out by an integer number of lanes. Two rules make it
planar.

1. **Ordering.** On each side, order siblings inner to outer by the row at which
   they attach to the spine, highest first. A branch attaching higher on the spine
   hugs the spine; a lower-attaching branch reaches around it on the outside.
   Because a branch line only grows upward from its fork, an outer branch's
   horizontal connector leaves the spine below where any inner band begins, so it
   cannot cross an inner band. The attach row is simply the branch child's own row,
   which is always the junction's upper row, so no extra traversal is needed.

2. **Band reservation.** Each branch reserves a contiguous band of lanes wide
   enough for its entire subtree (its own line plus every descendant's lanes on
   both sides). Bands are placed by first-fit against the row-ranges already parked
   on that side: two subtrees whose rows never overlap still share lanes (tight
   packing), but bands that would collide are pushed outward a whole band at a time.

The packer is a post-order walk: lay out each child subtree, learn its width and
row-span, place it, then bubble the composed width up to the parent. A final
top-down pass turns the per-parent relative lanes into absolute lanes with the
trunk at 0. This is O(n·depth) in the worst case, negligible at task-forest scale;
the classic linear-time thread/shift optimization is a documented future step if it
ever matters.

If cards ever become variable-width, the integer lanes become real per-row
contours (the full van der Ploeg non-layered form); the structure above is
unchanged, only the unit of offset.

## The tip-fork connector

A related defect lived in the connector, not the packing. A fork whose parent is
the tip of its line (no `.next` above it) puts the junction in the gap above the
parent, but the parent's line riser stops at the parent's own anchor, so the
junction floated with nothing joining the parent up to it. The fix, in
`layout.js`, emits a short spine stub whenever the junction falls outside the
parent line's riser span, joining the nearer riser end to the junction. This also
covers the mirror case of a fork below a line's first task.

## Angled connectors

By default a branch connector is an L: a horizontal leg from the trunk out to the
branch lane, then a vertical riser into the branch card. Trees, and the subway map
that inspired this one, angle their branches upward instead, so the flat leg is
tilted up at a constant 12° above horizontal (78° from the vertical trunk) over the
*same* horizontal delta, then a vertical riser. The angle is the same for every
branch, however far out its lane, so all the branches off one junction lie along a
single ray and their cards staircase up it.

Crucially the branch card, and everything growing along it, is *lifted* in y by the
leg's rise, so it grows up along the angle rather than dropping back to a flat row;
a branch off a branch accumulates its own leg's rise on top of its parent's. This
moves cards, so it is a layout change, not a render-only one: a per-line vertical
offset (a line's parent offset plus its own leg rise) threads through the card
positions, risers, junctions, and bounds. The fork diamond stays at
`[parentX, junctionY]`, and lanes and rows are unchanged, so the packer's horizontal
guarantees carry over.

Because the card rises in lockstep with its elbow, the vertical riser keeps its
length and can never invert, so no rise cap is needed and the angle stays a single
constant; the only `DEFAULTS` knob is the angle itself (`branchTiltTan`). The legs
off one junction are collinear (they share the ray) and the per-lane risers sit at
distinct x, so nothing crosses; the `countCrossings` guard treats a near-zero
orientation as collinear, so the T-junctions where a riser meets the ray are read as
touches rather than crossings.

## Tests

`geometry.test.js` checks the lane assignment directly (the higher-attaching
same-side branch lands inner; a nested subtree reserves a band so an inner
sub-branch cannot collide). `layout.test.js` carries the strongest guard: a
`countCrossings` helper that decomposes every track into segments and asserts no
two properly cross, run over the Wide tree (the case that first exposed the bug),
the HomeLab fixture, and a deep both-sides nest; plus a tip-fork test that a stub
connects the tip parent up to its junction, an angled-connector test that the elbow
lifts off the junction (at 12°) while the diamond and the vertical riser are
preserved, and a fan test that three branches off one junction all leave it at the
same slope however far out their lanes are.

## References

- E. Reingold and J. Tilford, "Tidier Drawings of Trees," IEEE TSE, 1981.
  <https://reingold.co/tidier-drawings.pdf>
- C. Buchheim, M. Jünger, S. Leipert, "Improving Walker's Algorithm to Run in
  Linear Time," Graph Drawing 2002.
  <https://link.springer.com/chapter/10.1007/3-540-36151-0_32>
- A. J. van der Ploeg, "Drawing non-layered tidy trees in linear time," Software:
  Practice and Experience, 2014. <https://onlinelibrary.wiley.com/doi/10.1002/spe.2213>
- Handbook of Graph Drawing, "Tree Drawing Algorithms" (A. Rusu).
  <https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/trees.pdf>
