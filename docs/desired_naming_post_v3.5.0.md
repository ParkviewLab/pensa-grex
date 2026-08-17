<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

> Under construction: this document is a work in progress and may still change.

# PensaGrex Structural model

A PensaGrex project consists of nodes, edges, connectors, and points.

* **Nodes** are the building blocks of a project.
* **Edges** are the paths that connect nodes and points.
* **Connectors** are the paths that connect a branch line to its parent project line.
* **Points** are locations at which paths branch and return.

# How This Document Speaks
* Definitions and facts are stated in the plain indicative.
* A rule, that is, a sentence that excludes an otherwise-constructible configuration, carries "must" or "may".
* A fact that follows from the stated rules opens with "Consequently".
* An aside that wards off a misreading is plain, and may use a contraction.
* Emphasis words such as "always" and "never" add weight, not meaning, and aren't used.

# PensaGrex Design Vocabulary

## Node
* A node is a building block of a PensaGrex project.
* Every node is one of three kinds: a task node, a start node, or an end node.
* A node's kind is a property of the node itself. It isn't derived from the node's position.
* Every node may have an attached explanatory note.

## Task node
* A task node is something that is to be done, in progress, completed, or canceled.
* Task nodes must be within a project, that is to say, between a start node and an end node.

## Start node
* A start node opens a project's scope.

## End node
* An end node closes a project's scope.
* Every start node must be paired with exactly one end node.
* An end node pairs with the nearest preceding start node whose scope is not yet closed, and it is that project's scope which it closes.
* Consequently, two projects on the same project line are either disjoint or nested, one wholly within the other's scope. Their scopes cannot partially overlap.

## Project
* A project is a start node, an end node, and everything in between them.
* A project's title and ID are those of its start node; a project has neither of its own.
* A project may contain multiple projects.
* A sub-project is a project contained within another project.
* An outermost project is a project contained by no other project.
* For an outermost project, neither a node nor a junction point may precede its start node, and neither a node nor a junction point may follow its end node.

## Project scope
* A project's scope is everything strictly between its start node and its end node (including the edges and the junction points).

## Domain
* A domain may contain multiple separate projects.

## Project line
* A project line is a sequence of nodes separated by junction points.
* There are two types of project lines: main lines and branch lines.
* Every project has a main line and may have multiple branch lines.

## Main line
* The main line of a project is its primary sequence of nodes.
* A main line is capped by a start node and an end node.

## Branch line
* A branch line is a sequence of nodes that runs parallel to its parent project line.
* It branches away from its parent project line at a branch point and returns to it at a return point.
* A branch line is capped at both ends by junction points.
* A branch line's branch point and its return point must both connect to the same project line, they must both be within exactly the same project scopes, and the return point may not precede the branch point.

## Branch connector
* A branch connector joins a branch point to a branch line's first junction point.
* No nodes exist on this path.

## Return connector
* A return connector joins a branch line's last junction point to a return point.
* No nodes exist on this path.

## Branch point
* A branch point is the point on a project line from which a branch connector originates.

## Return point
* A return point is the point on a project line where a return connector reconnects.

## Junction point
* A junction point exists between every pair of consecutive nodes.
* A junction point exists at the very beginning and at the very end of every branch line.
* A junction point may serve as a branch point, a return point, both, or neither.
* A junction point may serve as the branch point of several branch lines at once, and as the return point of several branch lines at once.
* A junction point is identified by the ID of the node that precedes it.
* A junction point at the very beginning of a branch line, which no node precedes, is identified by the ID of the node that follows it. An operation may do so by saying "before" that node.

## Edge
* An edge is the connecting path between a junction point and a node.

# What the Geometry Means
- A branch line is dependent upon everything in its parent project line that is before that branch line's branch point.
- Everything in a project line that comes after a branch line's return point is dependent upon that branch line.
- Junction points are drop targets when dragging branch points and return points.
- Edges are drop targets when dragging nodes.
- Connectors are not drop targets.

-------------------------
# Proposed Changes
---

1\. The Junction point section, genus, kinds, anatomy, caps, and identification:

```markdown
## Junction point
* A junction point is a point of a project line that is not a node.
* There are three kinds of junction points: branch points, return points, and the caps of branch lines.
* Between every pair of consecutive nodes there are exactly two junction points: a branch point followed by a return point.
* A cap exists at the very beginning of every branch line (its beginning cap) and at the very end (its end cap).
* Every junction point is identified by the ID of an adjacent node: a branch point or an end cap by the node that precedes it; a return point or a beginning cap by the node that follows it.
* An operation may name a junction point identified by its following node by saying "before" that node.
```

Deleted thereby, as before: the old existence bullet, the roles bullet with "both, or neither", the multiplicity conjunction, and the old identification pair with its exception.

2\. The Branch point and Return point sections:

```markdown
## Branch point
* A branch point is the earlier of the two junction points between a pair of consecutive nodes.
* Branch connectors originate at branch points.
* A branch point may serve several branch lines at once, or none.

## Return point
* A return point is the later of the two junction points between a pair of consecutive nodes.
* Return connectors reconnect at return points.
* A return point may serve several branch lines at once, or none.
```

3\. The Edge section, carrying the widened definition, the middle edge's name, the count, and the coincidence aside:

```markdown
## Edge
* An edge is a connecting path of a project line: between a node and a junction point, or between a branch point and the return point that immediately follows it (a middle edge).
* Between every pair of consecutive nodes there are exactly three edges: from the earlier node to the branch point, the middle edge, and from the return point to the later node.
* Most often a middle edge has a length of zero and its two junction points coincide; a zero-length edge isn't a drop target, since it offers no place to drop.
```

4\. The Branch line section: the legality rule stands unchanged; the caps bullet takes the new term; the smallest-branch aside remains recommended:

```markdown
* A branch line is capped by a beginning cap and an end cap.
* The smallest branch line leaves and returns between the same pair of consecutive nodes: its branch point and its return point are the two junction points between that pair.
```

5\. The two connector sections, term swap only: "a branch line's first junction point" becomes "a branch line's beginning cap"; "a branch line's last junction point" becomes "a branch line's end cap".

6\. What the Geometry Means, the typed drop bullets:

```markdown
- When dragging a node, edges are the drop targets; for a start node, empty space is also a drop target, and dropping there makes its project an outermost project.
- When dragging a branch point, by the branching end of its connector, branch points are the drop targets.
- When dragging a return point, by the returning end of its connector, return points are the drop targets.
- Connectors are not drop targets.
```

7\. The optional three-meanings bullet for the same section, still yours to include or not:

```markdown
- Consequently, where a branch line leaves and returns between the same pair of consecutive nodes, that pair offers three drops for a node: before the branch point, work the branch line depends upon; on the middle edge, work parallel to the branch line; after the return point, work that depends upon the branch line.
```

8\. How the Geometry Is Drawn, the sibling section:

```markdown
# How the Geometry Is Drawn
- The drawing's fixed elements are its angles and its anchor distances; every stretch lands in a designated segment.

- A junction point is drawn a fixed distance from its identifying node.

- A connector is drawn as an angled segment, a flat segment, and an angled segment. Its angles are fixed; its flat segment stretches sideways to reach its branch line, so sideways distance costs width, not height.

- When layout must move two consecutive nodes farther apart, the middle edge between them absorbs the slack.

- When layout must lengthen a branch line, its tip edge, the one between its last node and its end cap, absorbs the slack.

- A branch point and the return point that immediately follows it draw apart when both are in use, or when their middle edge has absorbed slack; otherwise they coincide.

- Measurements live in tree-layout.md.
```

The identification dividend survives the reproposal intact: because every junction point has exactly one identifying node, the anchor rule in the drawing section is a single sentence. And one small observation in favor of your challenge, now visible in the result: the reproposed set is shorter than the original by the whole of the former Gap section, and no sentence became harder to read for its absence.

---
Than apply these changes:

Before the text, one gatekeeping note: "chain" itself now passes your admission test, unlike "gap" and "sibling" before it, because an operation touches it as a unit: the root drag moves a chain whole, and the dependency and legality rules quantify through it. So it may enter the vocabulary honestly. The writeup below also quietly delivers rulings on findings 4 and 5, since side and order are constitutive of chains; and it deliberately does not touch the return side (the end cap stays a cap, returns stay shared, the n-way join survives), which I flag at the end. All of it is proposal, in your registers, for you to rework.

1\. The Branch connector section, rewritten; the chain lives here, since it is made of connectors:

```markdown
## Branch connector
* A branch connector joins a branch line's branch point to the branch point just inside it: the branch point of another branch line, or a branch point on the parent project line.
* No nodes exist on this path.
* The branch connectors on one side of a project line's branch point form a chain: the innermost branch line's connector reaches the project line's branch point, and each further branch line's connector reaches the branch point of the branch line just inside it.
* A project line's branch point has a left side and a right side; each side anchors at most one chain.
* The order of the branch lines in a chain is the author's.
```

2\. The Branch point section; the definition must now cover both positions the kind occupies:

```markdown
## Branch point
* A branch point is a junction point at which branch connectors anchor.
* The earlier of the two junction points between a pair of consecutive nodes is a branch point.
* Every branch line begins with its own branch point.
```

3\. The Junction point section's kinds and identification bullets, adjusted; the beginning cap is gone, absorbed into branch points, and the identification principle survives with its cases re-sorted:

```markdown
* There are three kinds of junction points: branch points, return points, and the end caps of branch lines.
* Every junction point is identified by the ID of an adjacent node: a branch point between two consecutive nodes, or an end cap, by the node that precedes it; a return point, or a branch line's own branch point, by the node that follows it.
```

The old multiplicity bullet ("may serve as the branch point of several branch lines at once...") must go with this change: under chains a project-line branch point anchors one connector per side, and several branch lines reach it only by chaining. Its return-point half survives wherever you restate it, since returns still share.

4\. The Branch line section: the caps bullet and the legality rule, recast at the chain:

```markdown
* A branch line begins at its branch point and ends at its end cap.
* A branch line's return point must connect to the same project line as the project-line branch point its chain reaches, must be within exactly the same project scopes as that branch point, and may not precede it.
```

5\. What the Geometry Means: the dependency bullet revised for chains, with its consequence, and the drag behaviors:

```markdown
- A branch line is dependent upon everything in its parent project line that is before the project-line branch point its chain reaches.
- Consequently, branch lines sharing a chain are not dependent upon one another.
- When dragging a branch line's branch point, that branch line alone moves. The drop targets are branch connectors and the two sides of any project line's branch point: a connector yields the position it covers; a side yields the innermost position of that side.
- A project line's branch point offers a drop zone on each side of its center. On an occupied side, the innermost connector lies where the zone is and carries the same meaning.
- When dragging a project line's in-use branch point, every branch line chained there moves with it. A root carrying one chain may land on either empty side of another project-line branch point, and that side is the destination; a root carrying two chains must land where both sides are empty, and the chains keep their sides.
- When a branch line's branch point moves and its return point would become illegal, the return point moves to the nearest legal return point. The return point between the branch point's own pair of consecutive nodes is legal without exception, so the move is total.
```

6\. How the Geometry Is Drawn gains one line:

```markdown
- A chain is drawn stepped: each branch connector runs angled, flat, angled from its branch point to the point just inside it.
```

Three deferrals to make deliberately rather than by silence, perhaps as asides or as entries in your open list. The end cap is not re-typed and the return side does not chain; symmetry begs for it, but a return point may gather branch lines from different chains (the n-way join), so a return-side chain would make an arrival order structural that today is derived, and that deserves its own decision. The relative lanes of branch lines from different roots remain layout's computation. And the auto-move's "nearest legal" is stated as the rule with the bubble position as its guaranteed floor; if you ever prefer the simpler "moves to the branch point's own pair" over "nearest legal", that is a one-word change with slightly blunter behavior.

One last cross-reference for when you apply this: the anatomy bullets from the earlier reproposal ("the earlier of the two junction points between a pair of consecutive nodes") now appear inside the Branch point section rather than as that section's whole definition, so the two proposals compose without conflict; and the smallest-branch aside survives unchanged, since a bubble is simply a one-line chain whose return sits between the same pair of nodes.
