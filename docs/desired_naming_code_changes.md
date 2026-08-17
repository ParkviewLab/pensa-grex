<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

> Under construction: this document is a work in progress and may still change.

# Code changes required by desired_naming_post_v3.5.0.md

This file is Claude's working derivation, maintained by Claude and refined in step
with the specification. `desired_naming_post_v3.5.0.md` is the authority; the code
of v3.5.0 is neither its source nor its judge. When this file and the specification
disagree, this file is wrong. When the code and the specification disagree, the code
is wrong. Code citations below are testimony about semantics already ruled on, or
mines of cases the specification must decide; never counter-arguments.

Status: tracking the specification as of 2026-07-29 (two-point gap anatomy ruled;
several review findings still awaiting rulings, listed at the end). These notes feed
the v3.6.0 plan once both documents are stable.

## 0. Method (ruled by Gary, 2026-07-29)

The order of work is fixed: **first redefine the DomainRecord, then redefine the
DomainModel, and only after both decide what code changes.** Both definitions are
based on the specification, not on the current code. The organizing act is a
partition: every entity the specification defines is classified as **stored**
(authored and irreducible: nodes with intrinsic kind, their order, the branch
attachments, notes, statuses, identity) or **derived** (defined structurally by the
specification and computed by the model: gaps, the two latent junction points per
gap, scopes via the pairing rule, extents, dependencies). Test: if the model can
derive it from the record, the record must not store it — a stored copy can lie.
The record definition trails the specification's completion, since several fields
await open rulings (side, order, domain identity, and the rest of section 8).

**Standing principle (Gary, 2026-07-29): any time we find ourselves needing to
write complex drag & drop code, or complex UI code of any kind, we stop and
consider whether the DomainModel should be modified first.** Complexity at the UI
layer is treated as a signal of a missing or under-specified structure in the
model, not as a problem to be solved in place. This applies during the v3.6.0
work and after it, permanently.

## 1. On-disk record (schema 3 → 4, one bump carries everything)

- `kind: 'project'` → the start node's kind; `kind: 'terminus'` → the end node's
  kind. New enum values to be fixed when the spec's spelling is final (likely
  `'start'` / `'end'`).
- `mergePoint` → `returnPoint`, with a **re-pointing, not just a rename**: the spec
  identifies a return point by the ID of the node that *follows* it, whilst
  `mergePoint` holds the node below the arrival gap. Migration: for every branch
  tip, `returnPoint = next(mergePoint)` on the parent line. Deterministic; the
  parent line's order is already in the record.
- `hostId` (the branch point's node) is **unchanged**: the spec identifies a branch
  point by the ID of the node that precedes it, which is exactly today's host.
- Status enum `cancelled` → `canceled` (issue #96) rides the same bump.
- `planOrder` → rename in the "plan is retired" sweep (likely `projectOrder`);
  value semantics unchanged (the domain's ordered outermost projects, pending the
  spec's ruling on finding 7).
- The two junction points per gap are **latent, derived, and not stored**. The
  record keeps only attachments: side arrays on the preceding node (branch-point
  use) and `returnPoint` per branch tip (return-point use). No new fields.

## 2. Model semantics (src/shared/model)

- **Legality simplifies.** Old rule: `merge.i >= host.i` with equality as the
  bubble's special case. New rule: the return point's identifying node must
  *strictly follow* the branch point's identifying node (`return.i > host.i`,
  where `return.i = old merge.i + 1`). Same set of legal states; the equality
  carve-out disappears. `mergeErrors` and its refusal wordings rewritten in the
  new vocabulary.
- **Pairing and kinds are already right.** `pairScopes` (nearest-open bracket
  matching per line) and intrinsic stored `kind` are exactly what the spec now
  states (End node pairing rule; Node kind bullets). Keep; rename only.
- **Fixed gap order is a new invariant**: within a gap, all branch-point
  attachments precede all return-point attachments. The old model could not
  express the inverse, so no data migration issue; the validator should state the
  invariant explicitly rather than inherit it from addressing coincidence.
- The bubble needs no special handling anywhere: it is a branch whose
  `returnPoint` names the node just above its `hostId`'s gap; legal under the
  general strict-follow rule.
- Vocabulary sweep in identifiers and comments: trunk → project line / main line;
  branch → branch line; fork → branch point; merge → return point; plan →
  project; foot → (awaiting the spec's word for a branch line's identity/first
  node); terminus/project-node → end node/start node. Mechanical but wide:
  validate.js, mutations.js, model.js, domainOps.js and every test.

## 3. Mutations

- `setMergePoint` → `setReturnPoint`; its argument becomes the return point's
  identifying node (the first dependent). `setBranchPoint` keeps its argument
  meaning (the preceding node). Their twin structure survives.
- `moveIntoLine`'s carry vocabulary ({branchFeet, mergeFeet}) renames; carry
  re-addressing logic is unchanged in substance.
- The clamps and silent repairs (`relocateReturns`' topmost-wins sweep, the
  moveUp/moveDown junction clamp) are candidates for removal once illegal states
  are unrepresentable; each removal needs a spec sentence that decides what the
  operation does instead (refuse loudly is the standing pattern).
- Empty-space drop for a start node = today's detach (outermost-making); already
  a mutation (`detachProject`); only naming and the drag path change.

## 4. Renderer: layout and drawing

- **Anchors.** A gap's branch point sits a fixed offset from the node that
  precedes it; its return point a fixed offset from the node that follows it.
  Today's fork-low/merge-high placement already does this; the layout solver
  makes it a rule rather than a habit.
- **The middle edge is the elastic element.** It always exists; length zero when
  the two points coincide; it opens when both points are in use or when layout
  slack must be absorbed. All gap slack lands there. A branch line's slack lands
  in its tip edge (last node to end cap). Connectors are drawn angled-flat-angled:
  the two angles are fixed (the twelve-degree lateral) and the flat segment is
  the elastic one, stretching sideways to reach the branch line, so sideways
  distance costs width, not height (Gary's correction, 2026-07-29; the earlier
  fixed-connector claim here was wrong). Principle: fixed angles and anchor
  distances; every stretch lands in a designated segment (middle edge, tip edge,
  connector flat). Supersedes ad-hoc slack placement; tree-layout.md to carry
  the numbers.
- **One diamond per role per gap** (at most two per gap) replaces the earlier
  one-diamond-per-gap intent. Coincident unused points draw nothing; coincident
  with one role in use draw that role's diamond; both in use draw two.
- Junction identity in layout.js ({kind, edgeBelowId, footIds}) becomes typed by
  species with the new identifying node per species; CSS classes and data-jx-*
  attributes rename (fork → branch-point, merge → return-point).

## 5. Drag and drop

- **Typed targets replace band geometry.** Dragging a node: targets are edges of
  nonzero length (the zero-length middle edge is no target), plus empty space for
  a start node (detach to outermost). Dragging a return point (the returning end
  of its connector): targets are return points. Dragging a branch point (the
  branching end): targets are branch points.
- gapZones.js's band arithmetic is superseded by target enumeration against the
  derived two-point anatomy; the carry rules become consequences of which edge of
  the gap received the node (before the branch point / middle / after the return
  point), with the three meanings: the branch depends on the drop; parallel;
  the drop depends on the branch.
- **Expected simplification, held as a check on the redesign (Gary, 2026-07-29):**
  drag & drop's complexity is the cost of reconstructing structure from pixels.
  With junction points as model objects, drop resolution = enumerate typed
  targets from the model + one legality filter + one mutation per target kind.
  gapZones.js is deleted, not ported; menu and drag candidate filters collapse
  into one shared enumeration. If any band arithmetic survives recognizably,
  the DomainModel has not absorbed the spec — fix the model, not the drag code.
- What travels with a dragged node is the extent (a start node carries its whole
  project); the spec has not yet named this unit (finding 9); the code keeps
  `extentOf` until it does.
- **Proposed, pending findings 4 and 5 (side, order):** branch reorder and
  side-switch complete the connector-end grammar. Grab = the beginning cap (the
  unclaimed end of the branch connector); targets = sibling beginning caps at
  the same branch point (take that sibling's place, outward shift) + empty space
  beside either side of the parent line (outermost place on that side). Side
  change = dropping on the other side's targets; own position = no-op. One
  mutation (side + index; sibling of rehostBranch). End cap deliberately
  unassigned: the authored order lives at the branch point, and an n-way join's
  return point gathers branches from several branch points, so no single
  sequence exists there. Cross-branch-point lane order stays layout's
  computation; authorial control there would be new stored state, not a drag.

## 6. MCP tools and prompts

- `set_merge_point` → `set_return_point`, argument re-pointed to the first
  dependent node (breaking; no aliases, per the v3.3.0 precedent).
- Read/write tool vocabulary sweep: project/terminus nouns → start node/end node
  framing; `create_plan`/`paste_as_plan` lose "plan"; `is_root` /
  `root_project_id` recast under outermost/sub-project framing (awaiting the
  spec's Domain rulings, findings 7 and 8).
- Tool descriptions and the server's model prose rewritten from the spec, not
  from the old code comments.

## 7. Documentation to regenerate after the code moves

- data_types.md (a v3.6.0 edition derived from the spec), interaction_model.md
  (typed drags), mcp_ideas.md (renamed nouns), tree-layout.md (anchors and
  stretch edges).

## 8. Awaiting spec rulings (mappings to be added when ruled)

- Finding 3: parent-project-line uniqueness (every node/junction on exactly one
  maximal line) — will license the code's one-trunk invariant in spec terms.
- Finding 4: branch side (left/right) — side arrays' spec name.
- Finding 5: branch order at a shared point (innermost-first, lanes).
- Finding 7: domain order (planOrder's spec status).
- Finding 8: the domain's own title and ID.
- Finding 9: the extent/subtree unit's name (what deletion, copy, move carry).
- Finding 10: line genus vs branch-line caps; minimum contents.
- Finding 12: which entities bear IDs (end-node ID asymmetry).
- Finding 13: start/end pairs on branch lines (the model permits; spec silent).
- Finding 14: branch-of-branch ownership; cap junction points barred from
  branch/return roles (the model refuses; spec reads as permitting).
- The caps' species name ("cap" is proposed and passes the admission test:
  rule-bearing via identification and the connector joints); the branch-line
  identity noun (today's "foot").
- **Ruled out (Gary, 2026-07-29): "gap" does not join the vocabulary.** The
  admission test for a spec term: a rule must constrain, or an operation must
  touch, the named thing as a unit (scope passes: legality quantifies over
  scopes, collapse/expand operates on one; gap fails: drops land on edges and
  points, no rule holds of the region that is not a rule about its parts).
  Binding is done by adjacency instead: "between every pair of consecutive
  nodes" quantifies the anatomy; "the return point that follows a branch point"
  is unique. "Gap" may persist as implementation shorthand (a struct in the
  DomainModel, these notes) but never in the specification's vocabulary.
