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
- **Task** — id, title, status, timestamps, a markdown **note** (its own file), and
  its outgoing structure: an optional **main-line successor** (the next task up the
  same stack) plus zero or more **branch children** (forked stacks). See Editing for
  how the two are created. Statuses: to do, in progress, completed, cancelled.
  Timestamps: created and completed.
- **Cursor ("here")** — set by hand and clearable; marks where the author is. At most
  one per branch, so a forked tree may show several (one per branch). The station
  takes the leaning-trapezium shape with a sputnik marker and a HERE flag. Set via
  right-click, Make here.

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
label**, plus a double-click shortcut for the note. It is not in the static skin
mock (which cannot re-lay-out a tree); it is recorded here as the first behaviour
to build once the data model and a dynamic layout exist. The menu offers:

- **Set status** — to do, in progress, completed, or cancelled.
- **Make here** — set this task as this branch's cursor (clearing any existing
  "here" on the same branch; other branches keep theirs).
- **Add task above** / **Add task below** — extend this stack in place: the new task
  becomes the **main-line successor** (or predecessor), continuing straight up. This
  is what decides which child is the straight-up main line.
- **Add branch above** / **Add branch below** — fork a new parallel stack off this
  point; the new stack becomes an alternating left/right **branch child**.
- **Edit note** — open this task's markdown note (also on double-click of the
  label); see Notes below.
- **Delete task** — remove this task (subtree behaviour is an open question).

Mapping to the mental model: add-task is a push on the stack (the main line);
add-branch is a fork; delete is a pop or subtree removal. Whether a child is the
main line or a branch is decided by the action that created it, not by ordering.

## Notes (markdown, edited the conception-space way)

Each task has a markdown **note** in its own file, in the forest's directory.
Editing follows the pattern of ParkviewLab's **conception-space** Electron app (the
same convention, not a code dependency): a panel with a **view** that renders the
markdown and an **Edit** toggle that reveals a text editor beside it, reading and
writing the task's `.md` file through the main process. conception-space's stack is
the reference: **CodeMirror 6** for editing (`@codemirror/lang-markdown`,
`@codemirror/theme-one-dark`) and **marked** for rendering (with
`marked-katex-extension` + KaTeX for math). Opened by double-clicking a task label
or via right-click, Edit note.

## Theme

Cool ground, either **light** (azure) or **dark** (navy) — undecided; the toggle
is now labelled Light/Dark. See [`theme_ideas.md`](theme_ideas.md). Skinned over
the subway grammar in [`subway-forest-themed.html`](subway-forest-themed.html).

## Open questions

- **Delete with children.** Deleting a task that has children: remove the whole
  subtree, or splice the children onto the parent?
- **Pop and status.** Is pop purely structural removal at a tip, independent of
  completing or cancelling a task, or are they related?

## Decided

- **Tree identity.** A tree has its own name, distinct from its root task.
- **Timestamps.** Created and completed.
- **Cursor scope.** At most one "here" per branch; a forked tree may show several.
- **Main line at a fork.** The straight-up main line is the stack continuation,
  created by Add task above/below; branches come from Add branch above/below.
- **Notes.** Markdown per task, edited the conception-space way (CodeMirror plus
  marked); double-click the label or right-click, Edit note.
