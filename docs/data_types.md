<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# The data types, field by field

A reference for every named data shape in PensaGrex and every field each one carries,
as of schema 3 (v3.5.0). The design reasoning lives in
[`model_v3_ideas.md`](model_v3_ideas.md), which remains the authority on *why*; this
document says *what is there*. Where the two disagree, the code has drifted and one of
them needs a fix — say so rather than guessing.

The one sentence to hold onto: a **Domain** is a directory, its **DomainRecord** is the
parsed contents of the `domain.json` inside it, and a **DomainModel** is what
`buildModel(record)` derives from a record for reading. The old code called all three
"forest", which is the confusion this vocabulary replaced.

## Ids

Minted by `src/shared/model/ids.js`. An id is a two-character prefix, an
eight-character base36 millisecond timestamp, and a two-character counter that resets
each millisecond: `n_mrtwgppt01`. Twelve characters, fixed width, entirely lowercase,
chronologically sortable by plain string comparison.

| Prefix | Names |
| --- | --- |
| `n_` | a node |
| `d_` | a domain |

Three properties are deliberate. Lowercase, because an id is part of a note's filename
and a case-normalizing filesystem must not conflate two. Fixed width, so ids line up in
a diff. A counter rather than randomness, because one writer per machine makes a
counter collision-free where randomness is merely collision-unlikely; the 1297th id in
one millisecond waits for the next millisecond. Ids are opaque and never parsed, so a
device discriminator can be added to new ids on the day a second writer exists without
touching an old one. Every node kind shares one id namespace, which is why the tool
surface calls the acted-on parameter `node_id` whatever kind a tool takes.

## Domain

One directory in the library: the set of plans kept together (HomeLab, Work). A domain
is not a project, so it keeps its own word.

The library root is `<userData>/domains/` unless `settings.json` points elsewhere. A
domain directory is named `pensagrex_domain_<slug>_<id>` — the app's prefix, a slug of
the title, and the domain's `d_` id; a title yielding no slug (only emoji or
punctuation) omits the slug segment and its underscore, giving
`pensagrex_domain_<id>`, exactly as a note filename does.

**The directory name is derived from the record, never the other way round.** The
record's `id` and `title` are the only authorities; the name exists so a person can
read a directory listing and so directories cannot collide, and by design a drifted
directory name is re-derived from the record (`model_v3_ideas.md` section 11). What
the code does today falls short of that: the name is derived once, at creation and at
the schema-2 migration, and never re-derived afterwards; drift is neither detected nor
healed; and `listDomains` reads a domain's id from the directory name, taking only the
display title from the record. Implementing the re-derivation (and a rename that
triggers it) is [#90](https://github.com/ParkviewLab/pensa-grex/issues/90).

Inside the directory:

| Entry | What it is |
| --- | --- |
| `domain.json` | the DomainRecord (below); plain JSON, camelCase keys |
| `bookmarks.json` | saved views (below); absent until the first bookmark |
| `notes/` | one markdown file per node note (below) |

A deleted domain moves to the OS Trash whole, record, bookmarks and notes together.

### Note files

A note lives at `notes/<nodeId>_<slug>.md`, the slug derived from the node's title at
the moment the note is first written; a title yielding no slug (only punctuation) gives
a bare `<nodeId>.md`, still unique. The record stores the **filename**, not the text
(the node's `note` field below), so the note is portable, greppable markdown on disk
and the record never bloats with prose.

### bookmarks.json

Owned by the renderer; the main process stores and serves it as text. Each bookmark is
a named view — client view state deliberately kept out of the record (northstar
axiom 9), but shareable because it is *named*:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | what the user called the view |
| `collapsed` | string[] | ids of project nodes folded shut in this view |
| `zoom` | number | the viewport scale to restore |
| `anchor` | string[] | a chain of node ids from a centred node toward its root; the camera centres on the first id still present in the restored view — existing, and not hidden inside a collapsed scope — so the bookmark degrades rather than breaks as nodes are deleted or folded away |

Known defect, open: the schema-3 migration wrote bookmarks as `{name, collapsed,
nodes}`. The renderer reads them — they appear in the menus and restore their collapse
set — but their camera cannot be restored: nothing ever reads the migration's `nodes`
field, and `zoom` was dropped, so jumping to a migrated bookmark shows the "Bookmark
location is gone" dialog and fits the whole domain. Newly made bookmarks use the shape
above and restore in full.

## DomainRecord (`record` in code)

The parsed contents of `domain.json`: the serializable shape every mutation takes and
returns, and the one thing `validateRecord` accepts or rejects. Every write path —
GUI, MCP, fallback — is mutate, validate, then atomic write of this object.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | number | `3`. A schema-2 file (`tasks`, `rootOrder`, JSON5) is migrated on first load, never written back. |
| `id` | string | the domain's `d_` id — the identity the directory name is a label for |
| `title` | string | the domain's display name |
| `planOrder` | string[] | ids of plan **base nodes**, ordering the plans left to right. Advisory: the graph decides what *is* a root (a node with no incoming edge); this list only orders them, and a root it omits sorts last by `createdAt`. |
| `nodes` | object | every node in the domain, keyed by id; each value is a node record (below) whose `id` field repeats its key |

Nothing else is stored at the top level. Two derivable things are deliberately *not*
stored, so a stored copy can never disagree with the truth: a node's predecessor
(derived at load) and the project–terminus pairing (derived by bracket matching).

## The three node kinds

Every value in `record.nodes` is one of three kinds, discriminated by `kind`. All
three share the identity and linkage fields; what distinguishes them is what they may
express. Fields marked *created as* show the literal a fresh node gets; older records
may lack an optional field entirely, and readers treat absent as the default.

### Fields common to all kinds

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | the node's `n_` id, equal to its key in `record.nodes` |
| `kind` | `'project' \| 'task' \| 'terminus'` | the discriminator |
| `createdAt` | string | ISO timestamp at minting; also the tiebreak for unordered roots |
| `note` | string \| null | the note's **filename** in the domain's `notes/`, or null. Any kind may carry one; the interface to a note is the same on every kind. |
| `next` | string \| null | the node above this one on its trunk, or null at a trunk's top. This is the *rising* edge: growth is upward, and an edge is always named by the node **below** it. |
| `leftBranches` | string[] | feet of branches leaving this node's rising edge, drawn left of the trunk, **innermost first** — the order is the author's and decides lane order |
| `rightBranches` | string[] | the same, drawn right |
| `mergePoint` | string \| null | only meaningful on the **top node of a branch's trunk** (its tip): the node *below* the edge this branch's return line joins. Everywhere else it must be null/absent, and the validator enforces that. |

A branch is not a stored object of its own. It exists exactly because its first node's
id (its **foot**) sits in some host's side array; its return exists exactly because
its tip carries `mergePoint`. The junctions the map draws are therefore *addresses
into these fields*, which is what makes them draggable: moving a branch point edits
which side array holds the foot, moving a merge point edits the tip's `mergePoint`.

### ProjectNode (`kind: 'project'`)

Opens a scope. Created with:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | string | the project's name, and the name of the plan or sub-project it opens. Kept **unique within the domain** (`uniqueTitle`), because a title is also an address on the read tools. |
| `flagged` | boolean | the "an assistant should look at this" mark |

A project node has **no** `status`, no `here`, and never carries `mergePoint` (it
always has its close above it, so it is never a branch tip). Its pairing with the
terminus that closes it is derived by bracket matching, never stored.

### TaskNode (`kind: 'task'`)

One thing to do. Created with:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | string | the task's name; domain-unique, as above |
| `status` | `'todo' \| 'in-progress' \| 'completed' \| 'cancelled'` | shown, not inferred: completing or cancelling recolours the card and nothing else |
| `completedAt` | string \| null | ISO timestamp set when `status` becomes `completed`, cleared when it leaves |
| `here` | boolean | the per-line cursor. At most one node per line may hold it; it is a mark, not a selection, and confers no insertion point. |
| `flagged` | boolean | as on a project node |

### TerminusNode (`kind: 'terminus'`)

Closes a scope: one per ProjectNode, at the top of the scope's run. It says nothing of
its own — **no title, no status, no flag, no cursor** (the validator refuses a flagged
terminus) — because the paired project node is the scope's handle. The one expressive
field it keeps is `note`, where one records what closing the scope took. A plan's own
close has `next: null` and nothing may ever sit above it; a sub-project's close sits
mid-trunk with a normal `next`. A terminus that is the top of a *branch's* trunk
carries that branch's `mergePoint`, which is how a sub-project constituting a branch's
whole upper run stores the branch's return.

## ProjectPlan

One plan in a domain. Deliberately **not a stored type**: a plan is the structure a
project node opens, not an operand. Its identity is its base ProjectNode's id, its
name is that node's title, and its extent runs from the base to the base's own close.
`planOrder` orders plans; `detachProject` makes a sub-project into one;
`copy_project`'s clip is one in flight. The grammar, from the design record:

```
Plan = ProjectNode , Body , TerminusNode
Body = { TaskNode | Plan }
```

A sub-project is a Plan inside a Body. A **scope** is the span from a ProjectNode to
its TerminusNode; a plan is the outermost scope. A branch's departure and its return
must sit inside exactly the same scopes, which is what keeps any scope collapsible as
one block.

## DomainModel (`model` in code)

What `buildModel(record)` derives for reading: lookups and reverse edges the record
deliberately does not store. Recomputed on every load or edit, never persisted, and
never mutated in place — the record is the truth, the model a view of it. The layout
and renderer consume the model; every mutation consumes the record.

Each node in the model is a shallow copy of its record node **plus**:

| Field | Type | Meaning |
| --- | --- | --- |
| `branches` | `{ child, side }[]` | the two side arrays flattened, left then right, each in stored order — because every consumer wants a node's forks together |
| `predecessorId` | string \| null | the node whose `next` or branch array points here; null on a root |
| `predecessorKind` | `'next' \| 'branch' \| null` | which kind of edge that is |
| `branchSide` | `'left' \| 'right' \| null` | for a branch foot, which side its host holds it on |

And the model object itself:

| Member | Meaning |
| --- | --- |
| `id` / `title` / `schemaVersion` | the record's own three scalars, copied through for convenience — the one part of the model that is a copy rather than a derivation |
| `nodes` | `Map<id, modelNode>` |
| `plans` | `{ id, baseId }[]` — one per root, in `planOrder` order (unlisted roots last, by `createdAt`); a plan's `id` *is* its base node's id |
| `getNode(id)` | the model node, or null |
| `getPlan(id)` / `getPlanIdForNode(id)` | a plan by base id; which plan's tree reaches a node |
| `getMainLineChain(startId)` | the line from a root or branch foot, following `next` to its tip |
| `getBranchChildren(id)` | a node's `branches`, copied |
| `getHereTaskId(startId)` | the task holding "here" on that line, or null |

## Client-local state, kept out of all of the above

Two shapes live beside the library precisely because they are **not** domain data
(northstar axiom 9: view is not data):

- `<userData>/viewstate.json` — per-domain `{ collapsed: string[] }`, the live fold
  state. Disposable: corrupt or missing falls back to empty.
- `<userData>/settings.json` — app settings: `libraryRoot` (where the domains
  directory lives), `lastDomain`, `mcpEnabled` / `mcpPort` / `mcpScope` (the MCP
  server's startup gate: port defaults to 35899, scope to read-write). Never
  clobbered on a failed read, since it holds the pointer to the user's data.

Bookmarks sit between the two worlds: view state by content, but named and therefore
shared with the domain (in `bookmarks.json`, above) rather than kept per client.
