<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Contributing

> The authoritative, org-wide version of these conventions is the
> [ParkviewLab handbook](https://github.com/ParkviewLab/handbook).

TaskForkStack follows the ParkviewLab conventions, adapted for a repo outside
the ParkviewLab org (no org-inherited secrets, no org-level PyPI/npm trusted
publishers). The essentials:

## Branch & PR flow

- Branch off **`develop`** into an ephemeral worktree named with a prefix:
  `feature-`, `bug-`/`fix-`, `doc-`, `test-`, `ops-`, `ci-`, `build-`, `release-`
  (hyphen, not slash). See the handbook's `branching.md`.
- Open a PR into **`develop`**. The repo is **squash-only**, so the merge button
  can only squash; **merging is the maintainer's action.**
- Releases are cut from **`main`** via the CLI (`git merge --no-ff develop`, then
  `git bump` + `git release`) — not a PR. See the handbook's `releases.md`.

## Commit / PR-title convention (this is what the changelog reads)

Because PRs are squash-merged, **the PR title becomes the commit subject**, and
the changelog is generated from it (via [git-cliff](https://git-cliff.org/) +
`cliff.toml`). Prefix every PR title with a [Conventional
Commit](https://www.conventionalcommits.org/) type:

| Prefix | CHANGELOG section | Notes |
|---|---|---|
| `feat:` | Features | user-visible |
| `fix:` | Bug fixes | user-visible |
| `perf:` | Performance | user-visible |
| `refactor:` | Refactor | |
| `docs:` | Docs | |
| `test:` | Tests | |
| `chore:` / `ci:` / `build:` / `style:` | _(dropped)_ | stays in git history, not surfaced |

A PR title without a recognised prefix is **silently dropped** from the
changelog. So: prefix it.

## Local checks before opening a PR

Run the same checks CI requires, so the PR is green on arrival:

```bash
npm ci
npm run lint
npm run build            # electron-vite build — a fast smoke-test
uvx --from "reuse[charset-normalizer]" reuse lint
```

TaskForkStack is plain JavaScript today (no TypeScript or test suite yet), so
CI runs ESLint + the electron-vite build. A PR **can't be merged until the
required checks pass** (the build check, REUSE, and the version guard — see the
handbook's `ci.md`).

## Versioning

The version lives in **`package.json` only** (read at runtime — the app's About
box shows `pkg.version`); never hard-code it elsewhere, and never type it on a
`git tag` line — use `git bump` / `git release` from
[`dev-tools`](https://github.com/ParkviewLab/dev-tools). See `releases.md`.

## Licensing

TaskForkStack is **dual-licensed**: code is **AGPL-3.0-or-later** (a
commercial license is available — see [`../LICENSING.md`](../LICENSING.md)), docs
are **CC-BY-4.0**. Every new file needs an SPDX header or a `REUSE.toml` entry,
or `reuse lint` breaks: code/config/CI → `AGPL-3.0-or-later`, docs → `CC-BY-4.0`.

## Documenting adopted algorithms

When we implement a known algorithm or a variant of one, write it up in a
markdown document in this `docs/` directory: the problem, the algorithm and its
lineage with citations, and how our variant differs. Add a code comment at the
implementation pointing to that document, so the reasoning is not buried in the
code. The first example is [`tree-layout.md`](tree-layout.md) (the non-crossing
branch layout).

## AI contributors

Read [`northstar.md`](northstar.md) first, if it exists, and follow the
behavioural contract in the handbook's `ai-collaboration.md` (notably:
merging/tagging/releasing need an explicit, per-action go-ahead).
