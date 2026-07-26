<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Model v3 — the names, the merge, and the invariants it brings with it

The canonical record of one design conversation. `model_v3_ideas.html` is its presentation and carries the
drawn figures; when the two drift, this file wins and the page is regenerated from it.

Nothing here is implemented in code; the running app is schema 2, in which forks never rejoin. The northstar
amendment this design requires is set out in section 2, and it landed on 2026-07-26, so axiom numbers in this
document are the amended ones: single entry and single exit is axiom 2, every fork returns is axiom 3, and what
were axioms 3 through 8 are now 4 through 9. Section 2 keeps the pre-amendment numbers where it quotes what
changed. All of it is scheduled as v3.0.0.

## 1 The vocabulary

One word in the current code carries three jobs, and that is the friction this started from. A domain is a
forest, its file is `forest.json5`, the parsed contents of that file are called `raw`, and the object
`buildForest()` returns is also called a forest. Those three are now the file, the record, and the model, and
the container they belong to is a domain rather than a forest. Renaming them is the smaller half of what
follows; the larger half is that a branch now comes back.

| Name | What it denotes |
| --- | --- |
| Domain | One directory: the set of plans kept together. Not a project, so it keeps its own word rather than joining the ProjectXXXX family. |
| DomainRecord | The parsed contents of `domain.json`: the serializable shape every mutation takes and returns. Called `record` in code. |
| DomainModel | What `buildModel()` derives from a record: lookups, reverse edges, roots. Called `model` in code; recomputed, never stored. |
| ProjectPlan | One plan in a domain. Opens at a base ProjectNode, closes at a TerminusNode. |
| trunk | A straight vertical line of nodes joined by edges. A plan has one; every branch has its own. |
| edge | The gap between two consecutive nodes on a trunk. Lateral lines attach inside it, against the nodes bounding it. |
| branch line | The line leaving a trunk edge to start a parallel trunk. |
| return line | The line carrying a branch's trunk back into the trunk it left. |
| merge | The junction where a return line rejoins. New in v3. |
| scope | The span from a ProjectNode to its TerminusNode. A plan is the outermost scope. |

### Three node kinds

A TaskNode carries a status and may hold the cursor. A ProjectNode opens a scope and carries neither. A
TerminusNode closes one: no title, no status, no flag, no cursor, and not movable. It does carry a note, the
one expressive field it keeps, and the natural thing to write there is what closing the scope required, though
the interface does not offer one for now (decided at implementation; the field stays, so it can be offered later
without a migration). Every
ProjectNode has exactly one TerminusNode, so a plan with three sub-projects has four project nodes and four
terminus nodes in total, counting its own base and close.

Two positions are distinguished only by where they sit. A plan's base ProjectNode has nothing below it, and its
root TerminusNode has nothing above it: no edge, so nothing can be added there. A sub-project's terminus does
have an edge above it, and tasks can be added above it in the ordinary way.

## 2 What the merge changes

In schema 2 a fork opens a parallel stack and that stack simply ends. In v3 every branch returns to the trunk
it left. That is not a naming change; it changes the class of graph from a strict tree to a single-entry,
single-exit block structure, and it contradicted the northstar in three places: inside intent 1, as axiom 2,
and in `model_ideas.md`'s definition of a tree. The axiom is the one that
matters, because it underwrites the single-incoming-edge rule in `validateRecord`, the tree-membership walk in
`buildModel`, and the cycle check; if it merely lost a clause, nothing would tell a later reader which of
those survive.

Was: *2. A strict tree, bottom-up: forks split and never rejoin; the root is the base, and growth rises.*

Becomes two axioms, because those are two independent claims and an axiom carrying two can be half-obeyed
without anyone noticing:

> 2. Single entry, single exit, bottom-up: a plan opens at its base ProjectNode and closes at its
> TerminusNode, a sub-project likewise, and growth rises between them. One way in at the bottom, one way out at
> the top, at every level.
>
> 3. Every fork returns: a branch opens a parallel trunk off an edge and rejoins the trunk it left, before the
> close of the scope in which it was opened. No branch reaches out of its scope, so any scope can be read, and
> collapsed, as a single block. Work that diverges and never reconverges is a separate plan, not a branch.

The final sentence is the only part with a user-visible cost. A permanent divergence is a real thing, two
efforts that happened to start from one point and went their own ways, and under these axioms it can no longer
be drawn inside one plan. The operation that resolves it already exists as `detachToTree`, which acquires a
second and better-defined purpose: the way out when work genuinely does not rejoin. So add-branch and detach
become a pair of choices at the moment of divergence, where today add-branch alone covers both cases.

Intent 1 changes with it, and so does the file axiom, numbered 6 then and 7 now. The triad Task, Fork, Stack
becomes Projects, Tasks, Branches, and the stack verbs go: with a terminus closing every trunk there is no free
tip, so nothing is pushed and every addition is an insertion at an edge. The status axiom had already
half-retired them, since completing a task leaves it on the map recoloured and only delete removes it, so
nothing has popped for some time. The file axiom names JSON5, and the file becomes plain JSON; what that costs
is comments and trailing commas, so the ownership claim in intent 3 survives intact, JSON being still plain
text, grep-able, diff-able, and readable in any editor.

## 3 Where a lateral line attaches

Edges are not objects in the file; there is nothing to point at. So both kinds of lateral attachment name their
edge by a neighbouring node, and they must choose the same neighbour or every mutation has to remember which
way each field reads. Branches already name the node below their edge, so `mergePoint` does too: it holds the
id of the node below the edge into which the return line joins.

Which node carries the field is a separate question, and the answer is the top of the branch's own trunk,
because that is the end the return leaves from: it is an outgoing edge, as `next` is, and putting it there lets
a merge be read off the node the line departs. A ProjectNode therefore never carries one, since it always has
its own close above it and so is never a trunk's top. What that costs is a relocation whenever an edit puts a
new node on top of a branch, which one pass repairs for every branch at once rather than each operation
remembering to.

Stated once, that gives a single rule of availability: a node can host a branch, or receive a merge, exactly
when a trunk edge rises from it. Two positions have no such edge, and both are unavailable for the same reason
rather than by separate decree. A root TerminusNode has nothing above it. The top node of a branch trunk has
its own return line above it, which is not a trunk edge.

The typed-edge rule belongs to the node above the join edge: exactly one trunk predecessor, zero or more return
predecessors. If `mergePoint` holds X, it is X's successor that acquires the extra incoming edge, so the sense
of "everything must arrive before this proceeds" attaches to whatever sits above the join, which is the
terminus only when the merge lands immediately below it. Two branches may share a merge point, which gives an
n-way join at no cost in the schema.

Where a junction is drawn is a separate convention from which node names it, and both are worth stating plainly
so that nobody later tries to make them agree. A branch point is drawn just above the node below its edge, and
a merge point just below the node above its edge, at every edge, whether or not it has been stretched. The node
meant here is the dot together with its label shape, so the clearance is measured from the edge of the card
rather than from an abstract point. A merge is therefore stored against the node below its edge and drawn
against the node above it, which is not an inconsistency but two uniform conventions serving different ends:
storage so that every mutation reads the trunk one way, drawing so that a fork always reads as leaving the node
it follows and a join always reads as arriving at the node it precedes. The caveat comes from a settled rule in
`model_ideas.md`, that a junction sits in the gap between two stations and not at a station: the clearance has
to stay visible, or the drawing will claim the branch attaches to the card.

## 4 Where a branch may rejoin

Three clauses, and each rules out a distinct failure.

1. `mergePoint` is on the trunk the branch left. Its own trunk, or another, would not be a return at all.
2. It is at or above the branch's own node. Below it is a genuine cycle: the trunk flows up from the join to
   the branch point, and the return flows back down into it. Equal is the smallest legal branch, treated in
   section 6.
3. It is strictly below the terminus closing the innermost scope open at the branch point. A branch cannot
   escape its scope.

The third clause needs the scope found by matching brackets, not by descending to the nearest ProjectNode, and
the difference is not academic: the naive answer can make a legal branch look unsatisfiable. On a trunk running
P, a, P2, b, T2, c, T from the base upward, a branch leaving above c has the plan's own scope as its bound, but
the nearest ProjectNode below c is P2, whose terminus T2 sits below the branch point; taking P2 would make the
constraint impossible to satisfy. So the walk descends the trunk, skipping the ProjectNode paired with every
TerminusNode it passes, and at the foot of a branch trunk it hops to the parent trunk at that branch's point.
The plan's base ProjectNode always terminates the search, so every position has exactly one innermost enclosing
scope.

Two consequences fall out rather than needing rules. A root TerminusNode can never be a `mergePoint`, because
it is either the bound itself, which clause 3 excludes, or above the bound, which clause 3 also excludes. And
naming a non-enclosing TerminusNode is perfectly legal: a branch opened below a sub-project may merge at the
edge above that sub-project's close, which is the shape of parallel work running alongside a whole
sub-project.

## 5 Spans

Everything from here on is about spans. A branch has one, from its branch point to its merge point. A scope has
one too, from its ProjectNode to its TerminusNode. Both are intervals on one trunk, which is what lets a single
geometric idea govern both.

## 6 The smallest branch

Clause 2 allows `mergePoint` to name the branch's own node, so a branch leaves an edge and returns to that same
edge. Without it, the topmost forkable position on every trunk would be unforkable: on a trunk running P, a, T
there is no node strictly between a and T, so a fork off a would have nowhere legal to land, and the user would
have to add a task purely to make room. That is the tool imposing its bookkeeping on the work.

A bubble says something true and otherwise unsayable: this strand runs alongside that gap and nothing else. It
introduces no cycle, since the branch tip and the trunk both flow into the node above the shared edge, which is
a diamond; only a merge strictly below the branch point makes a loop. A bubble is also the case in which both
junctions sit on one edge, and the placement rule is what keeps them apart: the branch point against the node
below, the merge point against the node above.

## 7 Crossings, and what they cost

Decided in discussion, reversing an earlier decision taken in the same conversation: branch lines and return
lines may cross trunk lines. Nesting is therefore not required between two branch spans, partial overlap is
drawable, and lateral order stops being derivable and becomes the author's, carried in the order of the branch
arrays.

The reversal is the right way round, for two reasons. Nesting does not merely inconvenience the author in
awkward cases; it forbids shapes that are plainly sayable. Three spans that pairwise overlap without nesting
cannot be laid out even using both sides of the trunk, since two sides cannot two-colour a triangle of
conflicts, so the tool would have to tell the author that the work they are describing has no drawing at all.
And the northstar's tension section says that when a layout choice and the data disagree, the data wins and the
layout accommodates it; the nesting invariant was that sentence inverted, with the model constrained to keep
the picture planar.

A crossing arises only where a lateral line reaches past a trunk nearer the spine than its own lane, which
makes the crossing relation a strict order and therefore acyclic: the outer line hops the inner trunk, never
the reverse.

Order is stored per node, so one thing has to be settled that the arrays do not say: how two branches leaving
different nodes of one trunk compare. The rule is that the higher branch point is the inner one, so a side's
lane order is the trunk read from the top down, each node's array in its stored order. That keeps the old
default where it was harmless, since a branch leaving higher is the one whose span is likelier to nest inside a
lower one's, and it leaves the author's per-node order meaning exactly what it says.

The consequence is worth stating plainly, because it bounds what "the author's order" buys: reordering is
available within one node's array, and between nodes the branch point decides, since that is all the arrays can
express. Making a lower branch inner than a higher one would need a rank stored per branch, and nothing so far
has asked for it.

What the superseded rule was is worth recording, because it shows the layout engine loses less than one might
expect. `assignLanes` has two rules. The first, ordering by attach height so that a branch attaching higher
sits inner, was the unbounded-span special case of ordering by containment: a branch today never returns, so
its span is unbounded above, and two unbounded spans on one side always nest. That rule is replaced by the
author's stored order. The second, reserving a contiguous band per branch wide enough for its whole subtree and
packing bands first-fit against the row ranges already placed, survives untouched, because cards must still not
overlap whatever the lines do.

The price falls on the reader, and it is quadratic: k spans that pairwise overlap on one side produce crossings
on the order of k squared. There is no invariant to lean on any more, only judgement, so the useful thing the
tool can do is report what an ordering costs in crossings and let the author reorder to reduce it.

One geometric rule replaces the structural invariant: no crossing may fall in a node's space, meaning between
the top of a node's dot and the bottom of its label shape.

## 8 The one nesting rule that stays

Clause 3 stops a branch from leaving its scope. Nothing stops a branch from entering one, and a branch opened
below a sub-project that merges inside it straddles the scope boundary:

```
      T                          T
      |                          |
      c                          c
      |                          |
     [T2]  <- scope closes      [T2] <---------.  legal: the branch span
      |                          |             |  contains the whole scope
      b            .--> merge    b             |
      |            |  (illegal)  |             |
     [P2]  <- scope opens       [P2]           |
      |            |             |             |
      a -----------'             a ------------'
      |                          |
      P                          P
```

The missing clause is the mirror of clause 3: no scope may open between a branch point and its merge point
unless it also closes before the merge point. Equivalently, a branch span and a scope span are always nested or
disjoint, never partially overlapping; two branch spans, since section 7, may overlap as freely as the author
likes.

This rule survives the decision in section 7 because it was never about crossings; a branch line runs beside a
scope without touching it. It is about the promise axiom 3 makes, that a scope can be collapsed as a
single block, and a return line landing inside a collapsed scope has nowhere to land. The two nesting rules had
two different justifications, and only this one turns on something a hop cannot repair. It also holds on both
sides of the trunk, since collapsibility has nothing to do with which half-plane a branch occupies.

It follows that one reshaping still has to be refused rather than drawn. Extending a branch's merge point past
a same-side neighbour is legal and merely costs a hop, so the question of what to do about that dissolves.
Extending it across the close of a scope the branch was opened outside does not: it breaks collapse. The honest
handling is to refuse the move and name the two legal alternatives in the same breath, either merging below
where that scope opens or above where it closes.

## 9 What the layout engine would owe

Today a branch costs the trunk nothing vertically. `buildRowGrid` sets each row's pitch from the tallest
measured card in that row plus a fixed gap, plus a fixed extra where a fork junction sits below it, and
`assignRows` is a plain depth-first walk: a branch occupies its own rows in its own lane while the trunk
carries on up the same grid, and no two paths ever have to be reconciled.

A merge ends that. A branch trunk of five nodes that leaves one edge and returns two rows higher either needs
its return line to fall three rows, or needs the trunk to acquire room between the branch point and the merge
point. Row assignment stops being a walk and becomes a constraint: a vertical band reserved on the parent for
each branch spanning it, sized to that branch's height. The algorithmic shape is not new, since `assignLanes`
already reserves a contiguous band of lanes wide enough for each branch's whole subtree and packs bands
first-fit against the row ranges already placed; it is the same idea turned through ninety degrees. The pitch
between the two trunk nodes grows to the branch's height, and the junctions sit where they always sit, against
the nodes bounding the gap, so the required length of a stretched edge is a plain sum: clearance, the branch's
height, clearance.

Two further pieces, and the shared row grid makes both cheap. Row assignment becomes a longest-path
computation: give every node an integer row subject to the "strictly above" constraints, which are a trunk's own
order, a branch's foot above its branch point, and the parent node above a merge point above that branch's tip.
Because the merge clauses forbid a merge below its own branch point, that constraint graph is acyclic, so the
computation cannot fail; and edge lengths have no upper bound, so any clearance the drawing needs can be
created. Infeasibility is not a risk here. Height is the only cost.

Crossing avoidance then comes almost for free, which is the answer to whether the engine can always keep a
crossing out of a node's space. `buildRowGrid` gives one y per row for every lane, so cards are aligned across
trunks, and between two adjacent rows there is a clearance band free on every trunk at once; a lateral run
placed in that band crosses trunk lines and nothing else, wherever it goes. Three details keep the guarantee. A
run must be anchored to the row's band rather than to its own card's height, since a merge hanging under a
short card would otherwise run at a height where a taller card in the same row still sits. Two runs wanting the
same band on the same side of a trunk would lie on top of each other, which reads worse than a crossing, so
they need separate bands, and that means one more row. And the band must be at least as tall as a hop, which
puts a floor under `rowGap`.

## 10 The hop, and the height it costs

A crossing must not be mistakable for a junction. A junction is marked in the gap between two stations, so a
lateral line passing unmarked through that same band would still read as lines meeting, and the drawing would
assert a join that does not exist. The remedy is the line hop, a small arc where the crossing line jumps the
trunk, standard in subway and circuit drawing alike and cheap in SVG. The convention worth fixing now is which
line hops: always the lateral one, so that a trunk runs unbroken from base to close and the eye can follow a
spine without checking whether it has been interrupted. That is always well defined, since a lateral line
crosses only trunks nearer the spine than its own lane; the outer line hops and the inner trunk carries on.

The second cost of crossings is height. Corridors and merge constraints each add rows, so a plan carrying much
parallel work is read zoomed out, where a 138-pixel card's title is illegible. That cost is real and is
accepted; the remedy for it is deferred, and the two notes below record the thinking rather than commit to
anything.

*Deferred.* Magnifying a node's label shape on hover, to whatever size makes its name readable, divides the
labour the way axiom 6 asks: the shape carries the structure at any zoom, and a name is read on demand rather
than shrunk past legibility. One constraint would keep it safe, and it is worth writing down now because it is
easy to violate later: the magnification must be a paint-time transform and never a layout input, since a hover
that changed a card's measured height would send `buildRowGrid` reflowing the plan under the pointer. Three
limits go with it. Magnification is a probe rather than a survey, and a reader zoomed out usually wants to know
what three parallel strands are, which hover answers one at a time. It is mouse-only, so selection would have
to magnify identically for anyone driving from the keyboard. And at low zoom the magnified card is large
relative to the drawing, so it occludes exactly the structure being scanned.

*Deferred.* The complementary idea, for the same future investigation: draw labels at a constant screen size and
hide the ones that collide, in a fixed priority order, the cursor's node first, then flagged nodes, then project
nodes and their terminuses. That is what map renderers do, it keeps a legible subset of names at every zoom, and
it composes with magnification rather than competing with it, the subset giving the survey and the hover giving
the probe.

## 11 The grammar

Two productions describe every legal plan.

```
Plan = ProjectNode , Body , TerminusNode ;
Body = { TaskNode | Plan } ;        (* may be empty *)
```

That pair settles more than its size suggests. A sub-project is a Plan inside a Body, so a plan and a
sub-project are one production and their closes are one node kind distinguished only by position, which answers
the question of a terminus that is not terminal. A branch's trunk is also a Body, so a project inside a branch
needs no rule of its own; it follows. And a Body may be empty, which is what an empty plan is: a ProjectNode
directly beneath its TerminusNode with a single edge between them.

Branches are deliberately not productions. Since section 7 their spans need not nest, and a structure that is
not laminar cannot be generated by nested productions. A branch is an attachment on a node of some Body,
carrying a side and two edge references, its branch point and its merge point, checked against the grammar
rather than generated by it. So the grammar describes the trunk-and-scope skeleton, which is exactly the part
that stays laminar, and section 8's rule is what keeps branch spans consistent with it.

## 12 Operations, and what empty means

Three verbs replace push and pop. A task is inserted at an edge; a run of a body is wrapped to name it as a
project, which is to say given a ProjectNode below it and a TerminusNode above it; and a branch is opened at an
edge. Axiom 1 survives with its operations renamed, since the creating action still decides the structure and
ordering still decides nothing. An insertion always names its edge and has no default: every edit is a
right-click on a node, and that click is what names the edge, so a bare insertion with an edge to be guessed does
not arise.

Opening a branch is one move that creates three things at once: the attachment, a first task inside it, and the
return line. Its merge point defaults to its own edge, the smallest legal branch, and its position in the
authored order defaults to innermost, which costs no crossings because a single-edge span nests inside every
span containing that edge. Both are the author's to change afterwards. Deleting a branch takes its return with
it.

Empty is a legal resting state for a project and not for a branch, and the asymmetry has a reason rather than
being a convenience. A project carries a title, so an empty one still asserts something, and an empty one is
how a project begins; deleting the last task inside a project therefore leaves the pair standing, and removing
the project is a separate, explicit unwrap. A branch carries no title of its own, so an empty branch asserts
nothing and is only noise on the trunk; deleting its last task removes the branch and its return line. That is
also why opening a branch creates it with a task already inside rather than empty.

## 13 Migrating a schema-2 domain

The closes are faithful. Each tree root becomes a plan whose TerminusNode goes above the top of its trunk, and
each mid-trunk project node closes at the top of its trunk as well, so nested scopes stack their closes in
reverse order of opening. That asserts only what schema 2 already meant, since a project node's scope there is
everything above it.

The merges cannot be faithful. A schema-2 branch is precisely work that diverged and never rejoined, which the
new axiom 3 calls a separate plan, so a migration must either split every branch out into its own plan or
fabricate a join. The decision is to fabricate the weakest one in the most visible place: each branch merges at
the edge level with its current top, clamped to the highest legal edge where a branch runs past its enclosing
terminus. Today's geometry survives almost exactly, each branch gains a short return line at its top, and one
drag corrects any claim the author disagrees with.

The rest is mechanical, and all of it happens in one pass. `tasks` becomes `nodes`; every id is reminted as
`n_` plus timestamp and counter, with a map from old id to new so that notes and bookmarks can be repointed,
which is worth the churn because the pass is already rewriting every record and renaming every note file. Note
files move into `notes/` and gain their slug. Bookmarks are rewritten in the device-independent shape: `zoom` is
discarded, and the first surviving id of the old anchor chain becomes the bookmark's node set, so a migrated
bookmark still lands where it did, framed to that one node rather than at a remembered scale. The domain
directory is renamed to `pensagrex_domain_<slug>_<id>`, and the library root moves from `forests/` to
`domains/`. The pass reads `forests/` and writes `domains/`, never mutating the old tree.

## 14 The file, as the decisions leave it

```
<library root>/                                 <- .../pensa-grex/domains/
  pensagrex_domain_work_mrtwgppt01/
    domain.json
    bookmarks.json
    notes/
      n_mrtwgppt03_draft-jd.md
```

The directory's name is a label: the prefix says what it is and which app owns it, the slug keeps a library
listing readable, and the id makes it findable. Nothing resolves a domain by its path, so a mismatch between
the label and the record is repaired by regenerating the label.

```json
{
  "schemaVersion": 3,
  "id": "d_mrtwgppt01",
  "title": "Work",
  "planOrder": ["n_mrtwgppt02"],
  "nodes": {
    "n_mrtwgppt02": {
      "id": "n_mrtwgppt02",
      "title": "Hiring",
      "kind": "project",
      "createdAt": "2026-07-26T09:14:02.118Z",
      "note": null,
      "flagged": false,
      "next": "n_mrtwgppt03",
      "rightBranches": [],
      "leftBranches": []
    },
    "n_mrtwgppt03": {
      "id": "n_mrtwgppt03",
      "title": "Draft JD",
      "kind": "task",
      "status": "todo",
      "createdAt": "2026-07-26T09:14:02.118Z",
      "completedAt": null,
      "note": "n_mrtwgppt03_draft-jd.md",
      "here": false,
      "flagged": false,
      "next": "n_mrtwgppt04",
      "mergePoint": null,
      "rightBranches": ["n_mrtwgppt05"],
      "leftBranches": []
    },
    "n_mrtwgppt04": {
      "id": "n_mrtwgppt04",
      "kind": "terminus",
      "createdAt": "2026-07-26T09:14:02.118Z",
      "note": null,
      "next": null,
      "mergePoint": null,
      "rightBranches": [],
      "leftBranches": []
    }
  }
}
```

An id is a prefix, a base36 millisecond timestamp of eight characters, and a two-character counter that resets
each millisecond, so `n_mrtwgppt01` is twelve characters, fixed width, entirely lowercase, and sorts
chronologically by plain string comparison; a domain's is the same body behind `d_`. All lowercase is what makes
an id safe as a filename on a case-normalizing filesystem, and the counter rather than randomness is what makes
a two-hundred-node paste collide-free. There is no device discriminator, because there is one writer per
machine; ids are opaque and never parsed, so one can be added to newly minted ids on the day a sync server
exists without touching a single old id.

`planOrder` orders the plans left to right and is advisory, since the graph decides what is a base. `status`,
`completedAt`, and `here` belong to tasks alone; `completedAt` is set exactly when the status is completed.
`note` holds a filename inside `notes/`, whose slug is the first twelve characters of the title, sanitized to
lowercase alphanumerics and hyphens and dropped altogether when a title yields nothing; the slug is decorative
and refreshed best-effort on a retitle, and the field is what resolves. The branch arrays are ordered innermost
first, and that order is the author's.

A TerminusNode keeps `next`, the branch arrays, and `mergePoint`, because a sub-project's close has an edge
above it and can therefore host a branch, receive a merge, and even be a branch trunk's own tip, which is the
node that holds the field (section 3). It keeps
`note` as well: a scope's close is exactly where one would record what finishing it took. What it does not carry
is a title, a status, a cursor, or a flag, so it cannot be searched for by name or swept up by a flag query; a
note on a terminus is found by walking to the scope that owns it.

Bookmarks stay in a sidecar beside the domain file, and every field in one is device-independent, so a bookmark
travels with the data as axiom 9 permits a named view to do:

```json
{
  "bookmarks": [
    { "name": "Hiring, in flight",
      "collapsed": ["n_mrtwgppt02"],
      "nodes": ["n_mrtwgppt03", "n_mrtwgppt05", "n_mrtwgppt04"] }
  ]
}
```

No pan, no scale, no anchor chain: `nodes` is every node drawn wholly inside the viewport when the bookmark was
saved, and any client computes its own framing from where those nodes sit now, under a maximum scale and a
minimum padding. Deleted ids are filtered out and the survivors framed, so a bookmark degrades rather than
breaking, and only an empty set is broken.

## 15 Where this stands

All of it is settled unless listed as open below, and the whole of it is scheduled as v3.0.0.

### Structure

- Every branch returns to the trunk it left. Axiom 2 was replaced by the two axioms in section 2 on 2026-07-26,
  and the three doc sites were amended with it.
- Three node kinds, a TerminusNode for every ProjectNode, and a plan bounded by a base ProjectNode and its
  TerminusNode. Two productions, `Plan` and `Body`, generate the skeleton; a sub-project is a Plan inside a
  Body, a branch's trunk is a Body, and a Body may be empty.
- A merge may land above any node, subject to the three clauses in section 4; the enclosing scope is found by
  matching brackets, and the root-terminus prohibition follows from containment rather than standing as its own
  rule. A branch may merge at its own edge, which keeps the top of every trunk forkable.
- `mergePoint` names the node below the join edge, the convention the branch arrays use.
- Nesting between a branch span and a scope span is kept, on both sides, because collapsing a scope is what it
  protects. Nesting between two branch spans is not required.
- A TerminusNode may carry a note, and only a note, and the interface does not offer even that for now. It has
  no title, status, cursor, or flag, so the paired ProjectNode is the scope's handle for a flag query. It is
  drawn as the ProjectNode's own hull turned upside down: the same shape says the two are one pair, and the
  inversion says which end this is.
- Empty is a resting state for a project and not for a branch: deleting a project's last task leaves the pair
  standing, deleting a branch's last task removes the branch and its return, and opening a branch creates it
  with one task inside.

### Drawing

- Branch and return lines may cross trunk lines. A crossing is drawn as a line hop in which the lateral line
  hops and the trunk runs unbroken; no crossing may fall in a node's space, so lateral runs go in the clearance
  band between rows.
- Lateral order is the author's and is stored, innermost first, with a new branch landing innermost by default
  because a single-edge span costs no crossings there. Which side a branch hangs on stays stored.
- A branch point is drawn just above the node below its edge and a merge point just below the node above its
  edge, unconditionally, measured from the label shape rather than from a bare dot.
- Row assignment becomes a longest-path layering, which cannot fail because the merge clauses keep the
  constraint graph acyclic. The height that crossings and corridors add is accepted as a cost.
- The 12-degree branch tilt and the per-line lift that carried a branch's cards up along it are retired, since
  the lift moved cards off the shared row grid and it is that grid which makes a clearance band empty at every
  lane at once. Cards are aligned to their row and a lateral line is a horizontal run in the band plus a
  vertical riser, which is what makes "no crossing in a node's space" hold rather than merely be hoped for.
  A tilt confined to the band would have had to flatten for a distant lane, losing the single ray it existed
  for. See `tree-layout.md`.

### Vocabulary and file

- The container is a Domain, in code and in speech; ProjectSuite is dropped, since the container is not a
  project. `tasks` becomes `nodes`, and the triad of intent 1 becomes Projects, Tasks, Branches.
- The stored form is a DomainRecord and the derived form a DomainModel, called `record` and `model` in code;
  `buildModel`, `validateRecord`, and `migrateRecord` replace the forest-named trio.
- Plain JSON, not JSON5, with camelCase keys throughout and `title` as the label on every kind that has one,
  the domain included.
- Ids are `n_` or `d_` plus an eight-character base36 millisecond timestamp plus a two-character counter that
  resets each millisecond: twelve characters, lowercase, fixed width, chronologically sortable, with no device
  discriminator until a second writer exists.
- `<library root>/pensagrex_domain_<slug>_<id>/` holding `domain.json`, `bookmarks.json`, and `notes/`. The
  record's id is the identity and the path is a label, repaired rather than trusted. The library root moves from
  `forests/` to `domains/`.
- A note file is named for its node id plus a twelve-character slug of the title, sanitized and decorative,
  refreshed best-effort on a retitle.
- A bookmark is `{name, collapsed[], nodes[]}` in the sidecar, with no zoom and no anchor chain; the client
  frames the surviving nodes under a maximum scale and a minimum padding.
- Migration fabricates one thing only: each schema-2 branch merges at the edge level with its current top,
  clamped to the highest legal edge, which preserves today's geometry and is corrected by a drag. The closes are
  faithful, and the pass writes `domains/` while leaving `forests/` untouched.

### Open

- Reading a tall plan: hover magnification, constant-screen-size labels with collisions culled, or both.
  Deferred by decision to its own investigation; see section 10.

- Whether the app reports how many crossings an ordering costs, now that the order is the author's to change.

- Whether two unrelated lateral runs wanting one band on one side of a trunk are given a band each, at the cost
  of a row, as section 9 says they should be. Left open on evidence: across the nine live domains every
  overlapping pair of runs, all 137, is a pair leaving the same junction, where the shared segment says
  something true, and no unrelated pair occurs at all.
