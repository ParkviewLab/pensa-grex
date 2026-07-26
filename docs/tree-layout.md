<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
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

## The tree base and its name

A tree's base is its **root node**, a project node with no incoming edge; the trunk
line rises from it. The layout keys each tree on that root node's id (there is no
separate tree record, and `rootOrder` only carries left-to-right ordering). The
project's name is the root card's own label, so the former floating tree-title
(the `.ttl` element that once sat below each tree) is gone: the name is drawn as a
station, not as chrome beside one. None of this touches the branch-placement
algorithm below; it only changes what sits at row zero and where the name lives.

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
pushing a whole subtree out by an integer number of lanes. Two rules place them.

1. **Ordering.** On each side, siblings run inner to outer in the author's own
   order: a node's branch array is stored innermost first, and across a line the
   higher branch point is the inner one, so the sequence is the line read from the
   top down, each node's array in its stored order.

   Until v3 this rule read differently: order by attach row, highest first, which
   *guaranteed* planarity, because a branch never returned and so its span was
   unbounded above, and two unbounded spans on one side always nest. v3's merges
   bound every span, spans may now overlap without nesting, and the tool cannot
   forbid that without forbidding shapes that are plainly sayable (see
   `model_v3_ideas.md`, section 7). So lateral order became the author's, the cost
   of an ordering is crossings rather than an impossible drawing, and a crossing is
   drawn as a hop.

2. **Band reservation.** Each branch reserves a contiguous band of lanes wide
   enough for its entire subtree (its own line plus every descendant's lanes on
   both sides). Bands are placed by first-fit against the row-ranges already parked
   on that side: two subtrees whose rows never overlap still share lanes (tight
   packing), but bands that would collide are pushed outward a whole band at a time.
   This rule survives v3 untouched, because cards must still not overlap whatever
   the lines do.

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

## Rows as a constraint, not a walk

Until v3, row assignment was a depth-first walk: a `.next` successor and a branch
child both sat one row above the node they left, and nothing had to be reconciled,
because a branch cost the trunk nothing. A branch that returns ends that. A branch
of five nodes leaving one edge and rejoining two rows higher either needs its
return line to fall three rows, or needs the trunk to acquire room between the
branch point and the merge point.

So `assignRows` is now a longest-path layering over three "strictly above"
constraints: a trunk's own order, a branch's foot above the node it leaves, and the
node above a join edge above the branch tip whose return lands there. The merge
rules forbid a merge below its own branch point, so the constraint graph is acyclic
and the computation cannot fail; and a constraint puts no ceiling on an edge, so a
tall branch simply stretches its parent trunk, with the rows between taking their
height from the branch's own cards. Height is the only cost.

## Lateral runs, and the hop

A branch line leaving a fork and a return line rejoining a trunk are the same kind
of line, and both are drawn as a horizontal run in the **clearance band** of a gap
plus a vertical riser. The band in the gap between rows r and r+1 runs from just
above row r's dots to just below the bottom of the *tallest* card at row r+1;
because `buildRowGrid` gives one y per row for every lane, that band is empty at
every lane at once, so a run placed in it crosses trunk lines and nothing else. The
band is anchored to the row rather than to one card's height, or a run leaving a
short card would sit where a taller card in the same row still is.

A fork junction sits a fixed inset below the band's lower edge, just above the node
below its edge; a merge junction sits the same inset above the band's upper edge,
just below the node above its edge. On a bubble, where both junctions share one
edge, that pair of conventions is what keeps them apart. A gap carrying junctions
therefore has a floor under its clearance: room for one junction clear of the node
at each end, and room for a hop to arc between them.

Where a run does cross a vertical, the run hops it, as a small quadratic hump, and
the vertical carries on unbroken (`model_v3_ideas.md`, section 10). That is always
well defined: a run only ever reaches past lines nearer the spine than its own
lane, so the outer line hops.

This retires the 12° tilt and the per-line lift that v2 used, and the reason is the
crossing guarantee rather than taste. The lift moved a branch's cards off the shared
row grid, by its leg's rise and by its parent's before that, so cards were no longer
aligned across lanes and no band was empty at every lane; without that, "no crossing
may fall in a node's space" could not be shown to hold. A tilt that stayed inside
the band would have had to flatten for a distant lane anyway, which is exactly the
single-ray property the tilt existed for.

## Tests

`geometry.test.js` checks row layering and lane assignment directly: a tall branch
stretches the trunk above its merge point while the nodes below stay put, a bubble
stretches the one edge it spans by its own height (its card has to sit between the
two trunk nodes, so it cannot be free), lane order follows the stored arrays read
top down, and a nested
subtree reserves a band so an inner sub-branch cannot collide. `layout.test.js`
carries the strongest guards: a `countCrossings` helper that decomposes every track
into segments and asserts no two properly cross without a hop, run over the Wide
tree (the case that first exposed the packing bug), the HomeLab fixture, and a deep
both-sides nest; the geometric invariant that no lateral run falls within a node's
space, run over both fixtures; and a tip-fork test that a stub connects a tip parent
up to its junction.

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
