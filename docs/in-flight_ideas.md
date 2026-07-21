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
- [`mcp_ideas.md`](mcp_ideas.md) — the in-app MCP server design: the Electron
  main process as the single task authority, a Node in-process Streamable-HTTP
  server on loopback (fixed port 35899), and the settled binding, security, and
  access decisions. The full task-level tool surface, across read-only,
  read-write, and destructive scope tiers, is settled.
- [`rust_port_ideas.md`](rust_port_ideas.md) — moving PensaGrex off Electron
  toward a 100% Rust app: what "100% Rust" means (a Rust-native GUI such as egui
  or iced, not Tauri), the model re-homing decision that any port turns on, how
  the current architecture ports, the northstar and licensing fit, and the costs.
  See entry 7 below.

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

# 7. Under study: a Rust port (off Electron) — [`rust_port_ideas.md`](rust_port_ideas.md)

The author has settled on a direction: PensaGrex should become a 100% Rust app,
off Electron and its bundled Chromium and its forced JavaScript. The deeper
notebook is [`rust_port_ideas.md`](rust_port_ideas.md), which now works through
three designs, a survey of other options, and an orthogonal sync-server idea. In
brief:

- Design A (Tauri hybrid): web UI kept, store/authority/MCP rewritten in Rust.
  Viable and the cleanest Tauri form, but not 100% Rust, and it keeps both the
  multi-webview fidelity QA (WebKitGTK is the weak engine) and a model-duplication
  hazard. Best as an interim.
- Design B (100% Rust GUI, egui or iced): no JavaScript, no webview. The widest
  rewrite but the only literally-100%-Rust path; it removes the webview problem and
  collapses the model to one Rust crate. egui is the recommended toolkit for the
  subway-map-plus-notes shape; the note editor is not CodeMirror (that needs a
  webview) but `TextEdit` + `egui_commonmark`; math is a preview-pane task with real
  native Rust renderers (RaTeX, ReX, pulldown-latex), not a lost capability. The
  recommended end state.
- Design C (Rust + Python): keep Python only across a wire, as a federated peer
  service (FastAPI, smalt-mcp). Every in-app shape (PyO3 embed, sidecar, Python MCP
  server) forfeits the one-static-binary win and, for embedding, pulls the Python
  under AGPL; rejected inside the app. The Rust core stays the single authority.
- Any hybrid turns on re-homing the model (`src/shared/`, ~1,100 lines; the
  correctness of the port to be preserved against the existing test suite); the
  JSON5 write path must preserve comments/formatting to honour axiom 6.
- Other options recorded (Dioxus, Dioxus Native/Blitz, Flutter+Rust, a PWA, trim
  Electron, Freya, and gpui/slint noted as excluded on licensing). The data is
  untouched throughout (axiom 6).
- A Joplin-style sync server is captured as a separate, optional, off-by-default
  capability (reuse WebDAV/S3/git/Syncthing; conflict-copy, not CRDT-in-the-file),
  which may graduate to its own `sync_ideas.md` if it firms up.

This is a question under study, not a plan or a commitment.
