<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# TaskForkStack — northstar

The canonical statement of what this project is for. Design decisions and
feature proposals are weighed against it. Where it and the code disagree, this
document is the authority, and the code is the thing to fix.

## What it is

TaskForkStack keeps track of what you are doing: a live, evolving forest of task
trees, one forest per domain (HomeLab, Work, and so on). You push a task onto the
tip of a stack, pop it when it is done, and fork a parallel stack when the work
diverges. A cursor you set by hand ("here") marks where you are on each branch.

## Why it exists

Most task tools are flat lists or nested checklists. Neither matches how a piece
of work actually grows: you are somewhere specific, tasks stack up ahead of you,
and every so often the work forks. TaskForkStack is built so that the tool's
structure is that structure, and so that you can see it at a glance.

## Three intents

These are complementary facets of one purpose, not a ranking; the tensions
between them (below) are where the design is decided.

### 1. The structure is the mental model

Task, Fork, Stack. A branch is a stack: tasks are pushed onto its tip and popped
off it; a fork opens a parallel stack from a point on an existing one. The data
model stores exactly this and nothing that contradicts it: each task has one
main-line successor and zero or more forks, and the action that creates a task
(add-task versus add-branch) is what decides whether it continues the line or
forks a new one. Ordering never decides structure. The result is a strict tree
that grows from the base upward; forks split and never rejoin.

### 2. Structure is legible at a glance

The forest is drawn as a subway map: stations are tasks, tracks are stacks, and a
junction in the gap between two stations is a fork. Before reading a single label
you can see the shape of the work: where you are (the leaning marquee and its
cursor), what is done, in progress, or cancelled (the outline colour), and where
a line forks. The visual channel carries the structure; text only names it. The
atomic-age skin is in service of this and not the reverse.

### 3. It is yours, and it is local

A forest is plain files on your own disk: one JSON5 file per domain, in a
directory beside its per-task markdown notes. No account, no cloud, no lock-in.
The files are grep-able, diff-able, and editable in any other tool; a note is
just markdown. The app owns the formatting of the forest file, never your ability
to read, move, or keep your own data.

## Tensions (these are design-revealing)

- Legibility against faithful structure. The picture must not distort the model
  to look tidy; when a layout choice and the data disagree, the data wins and the
  layout accommodates it.
- Local files against richer capability. Plain JSON5 and markdown are the floor;
  later richness (search, indexing, a possible lancedb) is added over the files,
  not by replacing them with something you do not own.
- Skin against clarity. The Googie theme is a genuine pleasure, but any
  decoration that does not clarify the structure is decoration to remove.

## Axioms

1. The creating action decides structure, not order: add-task continues the main
   line; add-branch forks.
2. A strict tree, bottom-up: forks split and never rejoin; the root is the base,
   and growth rises.
3. One cursor per branch, set by hand and clearable; a forked tree may show
   several, one per branch.
4. Status is shown, not inferred: completing or cancelling a task leaves it on the
   map, recoloured; only delete removes it.
5. Structure lives in the visual channel: if the reader must read to see the
   shape of the work, the drawing has failed.
6. The file is the source of truth, and it is the user's: plain JSON5 and markdown
   on disk, portable and legible without the app.
7. Decoration that does not clarify is cut.
