<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# Model and interaction notes

Accumulated design decisions, captured so they are written down rather than
held in a chat log. A notebook that feeds the eventual `docs/northstar.md` and
the data model, not a spec. Where something is settled it says so; open
questions are marked.

## The name, and the mental model

TaskForkStack is Task plus Fork plus Stack. A branch is a **stack**: tasks are
**pushed** onto its tip and **popped** off it, and the tree grows by pushing at
tips. A **fork** creates parallel stacks that diverge from a point on an
existing stack. This is the author's stated reasoning for the word "stack," and
it is decisive for the data model: the primary edit operations are push and pop
at a tip, and fork at a point.

## Entities (draft)

- **Forest** — the set of trees for one **domain** (e.g. HomeLab, Work). Persisted
  as one JSON5 file per domain, in a directory that also holds the per-task note
  files. Switching domains switches forests.
- **Tree** — a strict tree of tasks (forks split, branches never rejoin). Root at
  the base; growth rises. **A tree carries its own name** (decided), distinct from
  its root task, shown beneath the root station.
- **Task** — id, title, status, ordered children, an optional markdown note (its
  own file), and timestamps. Statuses: to do, in progress, completed, cancelled.
  Timestamps: created and completed (per an earlier decision).
- **Cursor** — "here," set by hand and clearable; marks where the author is. Shown
  as a sputnik marker plus a HERE flag, and the station takes the leaning-trapezium
  shape. Set via the task's right-click menu (see Editing below).

## Settled interaction and layout rules (subway direction)

- Vertical, **bottom-up**: roots at the base, tips on top.
- The forest is trees **side by side**; pan, zoom, and a one-button **Fit** that
  frames the whole forest.
- A branch joins the trunk at a **junction between tasks**, not at a task station.
- Added branches **alternate**: first to the left, second to the right, third to
  the left, and so on, while the main line runs straight up.
- Task labels sit **centered below** each station.
- Each **tree name** sits beneath its root station.
- **Station shape by role:** every station is a rounded "screen"; the current
  ("here") station on a branch is a leaning "marquee" trapezium.
- **Outline colour follows status** (to do, in progress, completed, cancelled),
  in the atomic palette; the "here" station's outline is the orange accent. The
  small status glyph inside the label carries the same colour.
- The sputnik "here" marker is drawn in the ink colour: dark on the light ground,
  white on the dark ground.

## Editing (right-click on a task) — app behaviour to build

The app's primary editing surface is a **right-click (context) menu on a task's
label**. It is not in the static skin mock (which cannot re-lay-out a tree); it is
recorded here as the first behaviour to build once the data model and a dynamic
layout exist. The menu offers:

- **Set status** — to do, in progress, completed, or cancelled.
- **Make here** — set this task as the branch cursor (clearing it elsewhere on
  that branch).
- **Add task above** / **Add task below** — push a new task onto this stack, before
  or after this one.
- **Add branch above** / **Add branch below** — fork a new parallel stack off this
  point (a new child that becomes an alternating left/right branch).
- **Delete task** — remove this task (structural; behaviour for a task with
  children is an open question).

These map onto the mental model: add-above/below are pushes on the stack;
add-branch is a fork; delete is a pop or a subtree removal.

## Theme

Cool ground, either **light** (azure) or **dark** (navy) — undecided; the toggle
is now labelled Light/Dark. See [`theme_ideas.md`](theme_ideas.md). Skinned over
the subway grammar in [`subway-forest-themed.html`](subway-forest-themed.html).

## Open questions

- **Cursor scope.** "Here" is set per task via right-click and cleared elsewhere on
  that branch, so it is at most one per branch. Whether a forked tree may show
  several (one per branch) or only one for the whole tree is unconfirmed.
- **Which child is the main line.** The alternation rule needs a rule for which
  child continues straight up versus which are the added left/right branches,
  most likely child creation order.
- **Delete with children.** Deleting a task that has children: remove the whole
  subtree, or splice the children onto the parent?
- **Pop and status.** Is pop purely structural removal at a tip, independent of
  completing or cancelling a task, or are they related?

## Decided

- **Tree identity.** A tree has its own name, distinct from its root task.
- **Timestamps.** Created and completed.
