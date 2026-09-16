<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# PensaGrex — northstar

The canonical statement of what this project is for. Design decisions and feature proposals are weighed against it. Where it and the code disagree, this document is the authority, and the code is the thing to fix.

## What it is

PensaGrex keeps track of what you are doing: a live, evolving set of project plans, gathered one domain at a time (HomeLab, Work, and so on). A plan opens at a project node and closes at a terminus, and everything in it happens between the two. You insert a task where it belongs on the line, wrap a run of tasks to name it as a sub-project, and open a branch where part of the work runs alongside the rest; a branch always rejoins the line it left. A cursor you set by hand ("here") marks where you are on each branch.

## Why it exists

Most task tools are flat lists or nested checklists. Neither matches how a piece of work actually grows: you are somewhere specific, tasks queue up ahead of you, and every so often part of the work runs in parallel for a while and then comes back together. PensaGrex is built so that the tool's structure is that structure, and so that you can see it at a glance.

## Three intents

These are complementary facets of one purpose, not a ranking. The trade-offs below say which one gives way when two of them cannot both be satisfied.

### 1. The structure is the mental model

Projects, Tasks, Branches. A project opens a plan and closes it, so a plan is a bounded run of work rather than an open-ended pile; a task is one thing to do, sitting on the line between the two; a branch leaves that line where part of the work runs in parallel and returns to it where that work is absorbed. The data model stores exactly this and nothing that contradicts it: each node has one main-line successor and zero or more branches, each branch names the edge it rejoins, and the action that creates a node (insert a task, wrap a run as a project, open a branch) is what decides the structure it takes. Ordering never decides structure. The result is a block structure that grows from the base upward: every plan and every sub-project is one run with one way in and one way out, and every branch comes back.

### 2. Structure is legible at a glance

A domain is drawn as a subway map: stations are nodes, tracks are the trunks they sit on, and a junction in the gap between two stations is where a branch leaves or where one returns. Before reading a single label you can see the shape of the work: where you are (the leaning marquee and its cursor), what is done, in progress, or cancelled (the outline colour), where a line branches, and where it comes back. The visual channel carries the structure; text only names it. The atomic-age skin is in service of this and not the reverse.

### 3. It is yours, and it is local

A domain is plain files on your own disk: one JSON file, in a directory beside its per-node markdown notes. No account, no cloud, no lock-in. The files are grep-able, diff-able, and editable in any other tool; a note is just markdown. The app owns the formatting of the domain file, never your ability to read, move, or keep your own data.

## Trade-offs

- Legibility against faithful structure. The drawing must not distort the model to look tidy. Where a layout choice and the data disagree, the data wins and the layout accommodates it.
- Local files against richer capability. Plain JSON and markdown are the floor. Search, indexing and anything like lancedb are built over those files, not by replacing them with a store you do not own.
- Theme against clarity. The Googie theme is part of the design and not an afterthought, but a decorative element that does not clarify the structure is removed.

## What it is not

PensaGrex is not project management software. It does not track resources, level them, cost a plan, or work out when the project will finish, and it has no assignees, no reports, and nothing to roll up to a portfolio. Issue trackers keep a team's queue of tickets, and scheduling tools fit resources to a calendar; neither is what this is for. PensaGrex lays out the steps of one piece of work, shows their shape, and lets you move through them as the work changes, with you and your agents doing the work as it goes. A plan here is something to steer by, not something to report against.

## Axioms

1. The creating action decides structure, not order: inserting a task continues the line at that edge; opening a branch starts a parallel line off it.
2. Single entry, single exit, bottom-up: a plan opens at its base ProjectNode and closes at its TerminusNode, a sub-project likewise, and growth rises between them. One way in at the bottom, one way out at the top, at every level.
3. Every fork returns: a branch opens a parallel trunk off an edge and rejoins the trunk it left, before the close of the scope in which it was opened. No branch reaches out of its scope, so any scope can be read, and collapsed, as a single block. Work that diverges and never reconverges is a separate plan, not a branch.
4. One cursor per branch, set by hand and clearable; a branching plan may show several, one per branch.
5. Status is shown, not inferred: completing or cancelling a task leaves it on the map, recoloured; only delete removes it.
6. Structure lives in the visual channel: if the reader must read to see the shape of the work, the drawing has failed.
7. The file is the source of truth, and it is the user's: plain JSON and markdown on disk, portable and legible without the app.
8. Decoration that does not clarify is cut.
9. View is not data: what a client has collapsed, where its camera rests, and its zoom are that client's own state, kept out of the domain file; a named, saved view may be shared with the data, but a client's live view is never written into it.

---
<sub>© 2026 Gary Frattarola · Licensed under [CC-BY-4.0](../LICENSES/CC-BY-4.0.txt)</sub>
