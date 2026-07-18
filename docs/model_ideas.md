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
  the base; growth rises.
- **Task** — id, title, status, ordered children, an optional markdown note (its
  own file), and timestamps. Statuses: to do, in progress, completed, cancelled.
  Timestamps: created and completed (per an earlier decision).
- **Cursor** — per branch, set by hand, and clearable; marks where the author is.
  Shown as a sputnik marker plus a HERE flag.

## Settled interaction and layout rules (subway direction)

- Vertical, **bottom-up**: roots at the base, tips on top.
- The forest is trees **side by side**; pan, zoom, and a one-button **Fit** that
  frames the whole forest.
- A branch joins the trunk at a **junction between tasks**, not at a task station.
- Added branches **alternate**: first to the left, second to the right, third to
  the left, and so on, while the main line runs straight up.
- Task labels sit **centered below** each station.
- Status is shown in the atomic palette; the cursor is a sputnik plus HERE.

## Theme

Cool ground, either light azure or very dark navy (undecided); see
[`theme_ideas.md`](theme_ideas.md). Skinned over the subway grammar in
[`subway-forest-themed.html`](subway-forest-themed.html).

## Open questions

- **Tree identity.** Does a tree carry a name distinct from its root task, or is
  the root task the tree's identity? The mock gives each tree a title.
- **Cursor scope.** One cursor per tree, or one per branch (a forked tree has
  several branches, each a candidate)? The author described it as per branch and
  clearable; the number allowed per tree is unconfirmed.
- **Which child is the main line.** The alternation rule needs a rule for which
  child continues straight up versus which are the added left/right branches,
  most likely child creation order.
- **Pop and status.** Is pop purely structural removal at a tip, independent of
  completing or cancelling a task, or are they related?
