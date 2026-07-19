<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# TaskForkStack

A Googie-themed desktop app that keeps track of what you are doing as a forest of
task trees, one forest per domain (HomeLab, Work, and so on). You push a task onto
the tip of a stack, pop it when done, and fork a parallel stack when work
diverges; a cursor you set by hand ("here") marks where you are on each branch.
The forest is drawn as a subway map: stations are tasks, tracks are stacks, and a
junction between stations is a fork. Outline colour follows status; each task
carries a markdown note.

The project's intent and its axioms are in [`docs/northstar.md`](docs/northstar.md);
read it first. A forest is plain files on disk: one JSON5 file per domain, beside
its per-task markdown notes.

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

TaskForkStack is **dual-licensed**: the code is free software under **AGPL-3.0-or-later** by default,
with a **commercial license** available as an alternative (for closed-source use without the AGPL's
obligations). Documentation is **CC-BY-4.0**.

**See [LICENSING.md](LICENSING.md)** for the full picture and the commercial-license contact. Canonical
per-license texts live in [`LICENSES/`](LICENSES/) ([REUSE](https://reuse.software)-compliant).

---
<sub>© 2026 Gary Frattarola</sub>
