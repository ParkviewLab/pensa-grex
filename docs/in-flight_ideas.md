<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# In-flight ideas

Scratchpad for ideas under consideration. Each entry is a question, not a
commitment — see the handbook's `documentation.md`.

## Design studies (open in a browser)

- [`subway-forest-themed.html`](subway-forest-themed.html) — the current working
  prototype: the subway grammar with the atomic-age skin on a cool ground, a
  ground toggle (azure / navy), branches joining at junctions between tasks,
  left/right alternation, and labels centered below stations.
- [`subway-forest.html`](subway-forest.html) — the first subway prototype
  (black-and-white, labels to the right, forks at stations). Superseded by the
  themed version above for layout; kept as the plain-grammar reference.
- [`model_ideas.md`](model_ideas.md) — accumulated model and interaction
  decisions (the push/pop meaning of "stack", entities, the settled layout
  rules, open questions). Feeds the data model and a future northstar.
- [`tree-grammars.html`](tree-grammars.html) — the original ten black-and-white
  layout grammars for the task tree (five horizontal, five vertical), one shared
  skin, the same sample forest in each. Subway (grammar 3) was chosen.
- [`theme_ideas.md`](theme_ideas.md) — the Googie / atomic-age / mid-century
  visual direction, held for the theming stage (skin comes after the grammar
  and data model).

# 1. Project intent (`docs/northstar.md`)

The repo was bootstrapped from the ParkviewLab handbook conventions before
the app's actual purpose was written down. `docs/northstar.md` is optional
but valuable once the intent is clear — worth writing as soon as
TaskForkStack's shape settles.

# 2. Done (M4): in-app license-notices viewer

The handbook's `electron-tooling.md` legal bundle is now wired: `scripts/`
carries `prepare-legal.mjs` and `clean-oss-licenses.mjs`, `package.json` has the
`legal:*` scripts (folded into `build:dist`), `electron-builder.yml` ships
`legal/` as `extraResources`, and `src/main/index.js` has a `Help → Open Source
Licenses` window reading `legal/oss-licenses.json`. The `LICENSE_HIGHLIGHTS`
list currently names Electron and JSON5; extend it as M6 adds CodeMirror,
Marked, and KaTeX.

# 3. Deferred: code signing

`electron-builder.yml` ships unsigned (macOS Gatekeeper / Windows SmartScreen
will warn on first launch). Signing needs a Developer ID cert + notarization
credentials (mac) and a code-signing cert (win) wired into
`.github/workflows/release-electron.yml` as repo secrets — worth doing before
a first public release, not before.

# 4. `ANTHROPIC_API_KEY` repo secret

The changelog job's Highlights paragraph needs `ANTHROPIC_API_KEY`. Unlike a
ParkviewLab-org repo, this one doesn't inherit an org-level secret — it needs
its own repo secret (`gh secret set ANTHROPIC_API_KEY`). The script degrades
gracefully without it (placeholder text, release still ships), so this isn't
blocking, just worth doing before the first real release.

# 5. Deferred: decorative background starbursts

The theme mock scattered a few faint starburst symbols across the canvas for
atmosphere (`render/tracks.js` still exports `buildBurst` for this). The
layout engine (M3) computes real, data-driven bounds, so hand-picked mock
coordinates no longer make sense; dropped for now rather than faked. Worth
revisiting once there's a reason to scatter them procedurally (e.g. seeded by
forest bounds) as part of a real theming pass.

# 6. `vitest` critical advisory (dev-only, UI server)

`npm audit` flags a critical advisory in `vitest` ("arbitrary file read/execute
when the Vitest UI server is listening"): [GHSA scored critical, fix requires
`vitest@4.1.10`]. The fix is a major bump that would need `vite` 6+/7+/8+,
which conflicts with `electron-vite@^2.3.0`'s peer requirement on `vite@^5` —
a separate toolchain upgrade, not a data-model concern. The exploit needs the
optional `vitest --ui` dev server running; this repo never adds a `--ui`
script or invokes one (only `vitest run`, in `npm test` and CI), so the
practical exposure is nil in normal use. Revisit when `electron-vite` and
`vite` are ready to move together, or if the `--ui` server is ever wanted.
