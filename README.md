<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# PensaGrex

A Googie-themed desktop app that keeps track of what you are doing as a live set of
project plans, gathered one domain at a time (HomeLab, Work, and so on). A plan opens
at a project node and closes at a terminus, and everything in it happens between the
two: you insert a task where it belongs on the line, wrap a run of tasks to name it as
a sub-project, and open a branch where part of the work runs alongside the rest. A
branch always rejoins the line it left. A cursor you set by hand ("here") marks where
you are on each branch.

A domain is drawn as a subway map: stations are nodes, tracks are the lines between
them, and a junction is where a branch leaves or returns. Outline colour follows
status; every node carries a markdown note.

The project's intent and its axioms are in [`docs/northstar.md`](docs/northstar.md);
read it first. A domain is plain files on disk: one JSON file in a directory of its
own, beside its per-node markdown notes.

## Download

Get the latest macOS, Windows, and Linux builds from the
**[download page](https://parkviewlab.github.io/pensa-grex/)**, or straight from
[GitHub Releases](https://github.com/ParkviewLab/pensa-grex/releases).

## Run from source

```bash
npm ci
npm run dev          # electron-vite dev server with HMR
npm run build        # bundle to out/
npm start            # preview the built app
npm test             # vitest unit tests
npm run build:dist   # platform installers (.dmg / NSIS / AppImage + .deb) in dist/
```

## License

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![REUSE compliant](https://img.shields.io/badge/REUSE-compliant-green.svg)](https://reuse.software)

PensaGrex is **dual-licensed**: the code is free software under **AGPL-3.0-or-later** by default,
with a **commercial license** available as an alternative (for closed-source use without the AGPL's
obligations). Documentation is **CC-BY-4.0**.

**See [LICENSING.md](LICENSING.md)** for the full picture and the commercial-license contact. Canonical
per-license texts live in [`LICENSES/`](LICENSES/) ([REUSE](https://reuse.software)-compliant).

---
<sub>© 2026 Gary Frattarola</sub>
