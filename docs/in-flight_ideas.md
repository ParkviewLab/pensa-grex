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
  write path must honour axiom 7, which model v3 narrows from JSON5 to plain JSON,
  so what has to survive a round trip is the file's shape rather than comments.
- Other options recorded (Dioxus, Dioxus Native/Blitz, Flutter+Rust, a PWA, trim
  Electron, Freya, and gpui/slint noted as excluded on licensing). The data is
  untouched throughout (axiom 7).
- A Joplin-style sync server is captured as a separate, optional, off-by-default
  capability (reuse WebDAV/S3/git/Syncthing; conflict-copy, not CRDT-in-the-file),
  which may graduate to its own `sync_ideas.md` if it firms up.

This is a question under study, not a plan or a commitment.

# 8. Under consideration: dragging a branch, to move it and to reorder it

A branch is drawn in one of two half-planes and at one of several lanes within it, and
neither is the author's to set today. `branchSide` (`mutations.js`) alternates, left for the
first branch off a node and right for the second; the lane comes from the order of the ids in
`leftBranches` and `rightBranches`, which the author never touches directly. The MCP
`open_branch` tool takes an explicit `side`, so an agent can express something a person
cannot, which is the one asymmetry left between the two surfaces after v3.3.0.

The obvious remedy, a side option on "Add branch above" and "Add branch below", is the wrong
one: it doubles two menu items and still says nothing about lane order, which is what decides
whether two branches cross. The right one is to let the author drag a branch, across the
trunk to the other half-plane and along it to reorder within the side, since the map is what
one is reasoning about and a drag is how one says "put that over there".

Questions it opens, none answered here. What the drag target is, given that a branch is a
line and a run of cards rather than one object. Whether a reorder that costs a crossing is
drawn as one or refused. Whether the return line follows the branch or is re-solved. And
whether the same gesture should move a branch to a different host edge, which is a different
verb again (`move_task` and `move_project` already do that by grafting).

Gary's direction, 2026-07-27: a future PR, after v3.3.0.


# 9. Under consideration: MCP resources, and more MCP prompts

Gary's two questions, 2026-07-27: should the read tools become MCP *resources*, and should the
server offer more *prompts*? The answers point opposite ways, for the same underlying reason.

**Resources: recommended against, both as a conversion and as an addition for now.** In the
protocol a tool is model-controlled and a resource is application-controlled: the client, or the
user, decides when a resource is fetched, and in practice it is fetched once and pinned into the
conversation as an attachment. That is precisely the stale-read hazard this surface is built
against, and nothing in a transcript distinguishes an attachment fetched a minute ago from one
fetched an hour ago. Two lesser reasons compound it. A resource is addressed by a URI template
and nothing else, so `include_notes` becomes a query string parsed by hand, there is no schema
and no enum, and an error is a JSON-RPC code rather than the prose refusal that names the
sibling tool, which is the property v3.3.0 was largely about. And support is uneven across
clients where tools are universal, so a conversion would break tool-only clients for no gain.

If resources ever earn a place here it is notes and nothing else: a note is genuinely a document
with a filename and a URI, and it is the one read where a stale copy costs little, being prose
the user wrote for the agent rather than structure the agent must not act on stale. Even that
buys a second surface to keep in step with the first. The nearer relative worth remembering is
the resource *link*, which a tool result may return in place of inlined text; that would stop
`read_project(include_notes)` dumping every note into the context, though `read_note` already
covers the need for a client that will make the second call.

**Prompts: recommended for, sparingly.** The argument is an asymmetry in cost. A new tool taxes
every conversation, the whole tool list being model context and the surface already carrying
about thirty; a new prompt taxes none, being fetched by the client for the user's own menu and
costing nothing unless invoked. A prompt is also the only place here that can state an ORDER;
tool descriptions state rules and refusals state constraints, but neither can say "do this, then
that".

On that test one addition clearly earns its place: **decomposing a project.** Insert the tasks,
then wrap runs as sub-projects, then open branches, because `wrap_run` is refused where a run
would straddle a branch's span, so branching first can make the intended wrap illegal. An agent
discovers that as a refusal after doing the work in the wrong order; a prompt can say it in
advance. A read-only "review this plan" prompt (what carries no note, what is still todo under a
completed scope) is a weaker second candidate. Stop there.

**Open, deferred from the v3.3.0 repair by decision: prompts are not scope-gated.**
`registerPrompt` sits above the read-write gate (`tools.js`), so the read-only tier offers
`work_flagged` whilst withholding the `set_note` and `set_status` it names. Instructions are
rightly ungated; a prompt naming write tools is not. The fix is three lines and one assertion in
`e2e.test.js`, and it belongs with whatever prompt work happens next rather than in a release
already cut for other reasons.

What is already done, so it is not proposed again: the `work_flagged` repair itself, and the two
guards that hold a prompt to the tool surface (`tools.test.js`, and the reasoning in
`mcp_ideas.md`). These are questions under study, not a plan.
