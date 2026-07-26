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
`d3.tree`, and our heights are solved before it would run, so its depth-by-level is
dead weight.
Porting keeps it dependency-free (the repo tracks REUSE/AGPL licensing) and pure.

## Our variant

The algorithm runs over a **line tree**, not the task tree. A line is a task plus
its `.next` chain, drawn colinear at one x; a line's children are the branch-lines
forking off any of its tasks, partitioned left and right by the branch's `side`.
The trunk line is pinned at lane 0.

Because our cards are a fixed width and every card's height is solved before any
lane is chosen (see "Heights as a constraint, solved in pixels" below), the contour
reduces to a per-side occupancy of integer **lanes** over an interval of real y, and
the shift reduces to pushing a whole subtree out by an integer number of lanes. Two
rules place them.

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
   drawn as an underpass.

2. **Band reservation.** Each branch reserves a contiguous band of lanes wide
   enough for its entire subtree (its own line plus every descendant's lanes on
   both sides). Bands are placed by first-fit against the vertical extents already
   parked on that side: two subtrees that never overlap vertically still share lanes
   (tight packing), but bands that would collide are pushed outward a whole band at
   a time. This rule survives v3 untouched, because cards must still not overlap
   whatever the lines do. Only the unit changed in v3.1: an extent was a range of
   rows and is now an interval of pixels, and it is widened at each end by the reach
   of the line's own laterals, since a departing ramp dips below its first card and
   an arriving one rises above its last.

The packer is a post-order walk: lay out each child subtree, learn its width and
its vertical extent, place it, then bubble the composed width up to the parent. A final
top-down pass turns the per-parent relative lanes into absolute lanes with the
trunk at 0. This is O(n·depth) in the worst case, negligible at task-forest scale;
the classic linear-time thread/shift optimization is a documented future step if it
ever matters.

If cards ever become variable-width, the integer lanes become real contours (the
full van der Ploeg non-layered form); the structure above is unchanged, only the unit
of offset.

## The tip-fork connector

A related defect lived in the connector, not the packing. A fork whose parent is
the tip of its line (no `.next` above it) puts the junction in the gap above the
parent, but the parent's line riser stops at the parent's own anchor, so the
junction floated with nothing joining the parent up to it. The fix, in
`layout.js`, emits a short spine stub whenever the junction falls outside the
parent line's riser span, joining the nearer riser end to the junction. This also
covers the mirror case of a fork below a line's first task.

## Heights as a constraint, solved in pixels

Until v3, row assignment was a depth-first walk: a `.next` successor and a branch
child both sat one row above the node they left, and nothing had to be reconciled,
because a branch cost the trunk nothing. A branch that returns ends that. A branch
of five nodes leaving one edge and rejoining just above it either needs its return
line to fall, which it may not, or needs the trunk to acquire room between the
branch point and the merge point.

So height assignment is a longest-path layering over "strictly above" constraints.
v3.0 layered onto a shared row grid; v3.1 keeps the layering and drops the grid, so
the unknown is a real number of pixels per node rather than an integer row shared
across every lane. Write u(n) for the height of node n's card top above the
drawing's baseline, up positive, so screen y is `baseY - u`. Three constraints, each
a lower bound on one node given another:

- **succession**, A then B = A.next: `u(B) >= u(A) + anchorGap + air(A,B) + cardH(B)`, where `air`
  is measured to the circle's centre, so the air visible above the dot is that less its radius
- **fork**, host A, foot F: `u(F) >= u(A) + anchorGap + departClear + rise + arriveClear + cardH(F)`
- **return**, tip T, merge point M, P = M.next: `u(P) >= u(T) + anchorGap + departClear + rise + arriveClear + cardH(P)`

All three run over the same graph `validateRecord` already proves acyclic (trunk
edges, fork edges, return edges), so one pass in topological order taking the
maximum solves them, and infeasibility is not a failure mode: every defect is a bad
drawing, never an impossible one. No constraint puts a ceiling on anything, so a
tall branch simply stretches its parent trunk, and the space between takes its
height from the branch's own cards. Height is the only cost.

The fork constraint is an equality in practice, a branch's foot having no other
incoming edge, and that is what makes the twelve degrees exact rather than
approximate. The return constraint is a genuine inequality, and its slack is the
branch's **tail**: the trunk drawn above the branch's last card, derived after the
solve as `u(P) - cardH(P) - arriveClear - rise - u(T) - anchorGap`. The constraint
is exactly what guarantees that the tail is at least `departClear`, so the fixed
departure clearance is a floor the tail can only exceed. That is Gary's rule that
the branch's own trunk is what stretches when the trunk it returns to is the taller
side.

`rise` is the same 48.46 for every lateral in the drawing, being `laneStep * tan 12`
for one lane's width, and that constancy is what makes the solve possible at all: a
rise proportional to the lanes a lateral spans would make a height depend on lane
assignment, which depends on vertical extents, which depend on heights.

`air(A,B)` is the 25 pixels between a circle's centre and the card above it,
raised where the edge carries a junction, and derived rather than chosen: a
twelve-degree line climbs `(cardW / 2) * tan 12`, about 20 pixels, while crossing a
card's own half-width. So an edge whose lower node hosts a fork needs
`departClear + 20 + margin`, or the leg would pass behind the card above it and
re-emerge past it. The same reasoning mirrored gives the air on an edge that
receives a return. An edge that does both takes the larger of the two, and at least
`departClear + diamondGap + arriveClear`, or the two diamonds land on one another.

Nothing is aligned across lanes. Two cards in different plans, or one on a trunk and
one on a branch beside it, share a y only by coincidence.

## The twelve-degree lateral, and the underpass

A branch line leaving a fork and a return line rejoining a trunk are the same kind
of line. Each **departs** a fixed clearance above the circle it leaves and
**arrives** a fixed clearance below the bottom edge of the card it joins: two
constants, four uses, so every junction in the drawing sits at the same remove from
its own node.

Between those ends the line is a **ramp, a flat run, and a ramp**: it leaves at
twelve degrees for half a lane, runs flat across whatever span remains, and climbs
the last half lane into its arrival. A one-lane branch is therefore a single
straight twelve-degree diagonal, which is what v2 drew and what half the branches in
the live library are, and every wider branch climbs the same total. Holding the
angle over the whole span was the alternative, and it was rejected on arithmetic: a
branch six lanes out would rise 290 pixels to reach its own foot, and the rise would
no longer be constant.

Where a lateral crosses another line, it passes behind it: the other runs on
unbroken and the lateral is cut, with a cap on each severed end
(`model_v3_ideas.md`, section 10). A lateral yields to a trunk and also to a
**return**, which is the commoner case: the live library has ten
branch-crosses-return pairs against two branch-crosses-trunk. Each cap lies parallel
to the line being passed under, so that it reads as a slice of what runs on, and the
cut is made by clipping the lateral with a strip along that line rather than by
shortening the path, because a stroke can only end square to its own direction and
its round cap adds a bulb of ink half a stroke beyond that, which is what shows past
a cap where two lines meet shallowly.

## What the grid bought, and what replaced it

v3.0 aligned every card to a shared row and put every lateral run in a clearance
band that was empty at every lane at once. That made "no crossing may fall in a
node's space" (`model_v3_ideas.md`, section 7) a property of the construction: a run
in the band could not be inside a card, and there was nothing to check.

Dropping the grid gives that up, and the demotion is worth stating plainly: the rule
is now **checked and repaired** rather than provable. After the solve, every lateral
segment is tested against the rectangle of every node whose x-range it spans. A
conflict is repaired by lifting, never by widening: widening would change nothing
about the rise, which is constant, but would re-open the packing, whereas lifting is
monotone. Which node is lifted follows `pinnedBy`, the record of which constraint
set each height, so a node whose height a lateral pins is repaired by lifting the
host of the branch that pins it, rather than by bending that lateral off twelve
degrees. The pass is bounded by `repairPasses`, and whatever it cannot close rides
out on `layout.conflicts` instead of being drawn in silence. Over the nine live
domains and the two committed fixtures it closes everything, and those eleven
drawings together are slightly shorter than the grid drew them, 10,883 pixels of
height against 11,096.

## Tests

`geometry.test.js` checks the height solve and the lane assignment directly: a tall
branch stretches the trunk above its merge point while everything at or below the
branch point stays put, a bubble stretches the one edge it spans (its card has to sit
between the two trunk nodes, so it cannot be free), a branch's foot sits above the
node it leaves and below that node's successor, lane order follows the stored arrays
read top down, and a nested subtree reserves a band so an inner sub-branch cannot
collide.

`layout.test.js` carries the strongest guards. A `countCrossings` helper decomposes
every track into segments and asserts that no two properly cross without the crossing
being marked as an underpass, run over the Wide tree (the case that first exposed the
packing bug), the HomeLab fixture, and a deep both-sides nest. `linesInNodeSpace`
asserts the repaired invariant of the section above. Beyond those: that every lateral
segment is flat or at exactly tan 12, that the four clearances hold to the pixel
against `layout.metrics`, that the 25-pixel minimum is met everywhere and tight on a
branch-free chain, that no two cards overlap, and that a drawing is deterministic
under a permuted `nodes` key order, entirely inside its reported `bounds`, and
monotone (adding a card to a branch moves nothing at or below its branch point).

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
