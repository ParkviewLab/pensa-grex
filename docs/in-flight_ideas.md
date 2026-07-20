<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
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

# 1. Done (M7, draft): project intent (`docs/northstar.md`)

`docs/northstar.md` now exists: three complementary intents (the structure is
the mental model; structure is legible at a glance; it is yours and local),
their tensions, and seven derived axioms. It is a first draft synthesised from
the settled design in `model_ideas.md`; it is the author's statement to refine,
not final. A designed HTML companion (per the dual-track documentation
convention) is proposed but not yet built.

# 2. Done (M4): in-app license-notices viewer

The handbook's `electron-tooling.md` legal bundle is now wired: `scripts/`
carries `prepare-legal.mjs` and `clean-oss-licenses.mjs`, `package.json` has the
`legal:*` scripts (folded into `build:dist`), `electron-builder.yml` ships
`legal/` as `extraResources`, and `src/main/index.js` has a `Help → Open Source
Licenses` window reading `legal/oss-licenses.json`. The `LICENSE_HIGHLIGHTS`
list names Electron, JSON5, CodeMirror, Marked, and KaTeX (extended in M6).

# 2a. Deferred: application icon

`build:dist` reports "default Electron icon is used". A custom icon (an
atomic-age mark fitting the theme) belongs under `build/` as
`icon.icns` / `icon.ico` / `icon.png` for electron-builder to pick up.
Cosmetic; worth doing before a public release.

# 3. macOS code signing (wired; Windows deferred)

The release job signs macOS (Developer ID Application) and notarizes via an App
Store Connect API key, mirroring conception-space; it reads five repo secrets:
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`. These are not org-level, so they must be present on this repo
(or promoted to org secrets) for the signed build to succeed. Windows still ships
unsigned (SmartScreen may warn on first launch); a Windows code-signing cert
remains deferred.

# 4. `ANTHROPIC_API_KEY` (resolved)

The changelog job's Highlights paragraph needs `ANTHROPIC_API_KEY`. Now that this
repo lives in the ParkviewLab org it inherits the org-level secret (the v1.0.0
changelog Highlights confirmed it), so no repo secret is needed. The script still
degrades gracefully to placeholder text if the key is ever absent.

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
