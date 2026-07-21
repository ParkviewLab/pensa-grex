<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Rust port — moving PensaGrex off Electron

Status: under study. This is an in-flight idea held for exploration, not a
commitment; `in-flight_ideas.md` carries the index entry. Everything below is
weighed against `northstar.md`. Dates and versions are as of July 2026; the
option write-ups draw on a dedicated research pass (sources at the end of each
section).

## Why consider it

- Electron forces JavaScript and bundles Chromium. The author was never content
  with the JS constraint, and the artifacts are large: v2.1.0 shipped installers
  of 104 to 134 MB, and a running Electron app idles at roughly 200 to 400 MB.
- The org is Python-first (FastAPI services) and comfortable with a federated,
  ROS-like split of languages across a wire. Rust marries with Python at least as
  well as C++ does: in-process through PyO3 with maturin building the wheels, and
  at the service seam over HTTP, gRPC, or MCP.
- The direction the author has settled on: PensaGrex should become a 100% Rust
  app.

## What "100% Rust" actually means (the first fork)

The phrase forks into two very different projects, and the choice sets the scope
of everything else.

- Tauri is not 100% Rust. Tauri gives you a Rust backend, but the interface stays
  HTML, CSS, JavaScript, and (here) hand-drawn SVG, running in the operating
  system's webview. Rust is the backend language only.
- A Rust-native GUI toolkit is 100% Rust: no JavaScript, no webview.

Only the second is literally 100% Rust. It is also the larger rewrite, because it
discards the renderer, not only the `src/main` backend.

## What the current architecture means for any port

- The renderer imports nothing from Node or Electron; it sees disk only through
  the `pensagrex` preload bridge (about fifteen methods). Under Tauri it ports
  mostly as-is (the transport at the bridge seam changes from Electron IPC to
  Tauri `invoke`/`listen` or local HTTP); under a Rust-native GUI it is rewritten.
- The shared model in `src/shared/` is roughly 1,100 lines of non-test code, of
  which `mutations.js` alone is 658 (with a 661-line test file). It is imported in
  three places, not one: the main-process authority (`taskService.js`), the
  renderer's no-Electron fallback (`bridge/api.js`), and the renderer's view spine
  (`app.js`, which calls `buildForest` to derive what it lays out). This shared
  reuse is the crux of the whole port.
- `store.js` (file I/O, JSON5, atomic write-to-temp-then-rename, settings,
  library-root bounds-checking) ports to Rust as routine work, with one caveat
  below (JSON5 round-trip fidelity).
- The MCP server ports to Rust via rmcp, the official Rust MCP SDK (Apache-2.0,
  v2.2.0 on 2026-07-08, tracking MCP spec 2025-11-25). It supports the
  Streamable-HTTP server transport through `StreamableHttpService` on an axum
  router, so the loopback endpoint on `127.0.0.1:35899` can be rebuilt faithfully
  and, being in the same process as the authority, calls the mutation functions
  directly rather than across a language boundary.

### The JSON5 round-trip caveat (binds every Rust option, on axiom 6)

Axiom 6 says the forest file is the user's: plain JSON5, portable, hand-editable.
The popular Rust `json5` crate is unmaintained (RUSTSEC-2025-0120). The maintained
alternatives (`serde_json5`, `jsonc-parser`) are serde-based, and serde
reconstructs its output from the data model, so it does not by default preserve
comments or hand-formatting on write. A naive Rust `store` would therefore quietly
strip a user's comments and layout from `forest.json5` on the next save, which is a
direct violation of axiom 6. Any Rust store must use a format-preserving write path
(a concrete-syntax-tree editor rather than a plain serde round-trip) and this must
be verified, not assumed. It is a small, bounded task, but it is a real one.

## The model re-homing decision (the real center of a hybrid)

Moving the authority off Node forces a decision about the model, and it is where a
"hybrid" hides a real tax. Today the model is imported verbatim by both the
authority and the renderer because both are JavaScript, so the sharing is free. If
the authority becomes Rust while the UI stays web (the Tauri option), the sharing
is no longer free, and three shapes present themselves:

1. Port only the mutation half to Rust for the authority, and keep `buildForest`
   (pure layout derivation) in JavaScript in the webview; after each edit Rust
   returns the updated forest and the webview lays it out. One mutation authority,
   but the model is split along the mutate/derive seam.
2. Move everything, derivation included, into Rust and return the webview a fully
   derived scene to paint. Least JavaScript, but it discards `buildForest` and
   kills the in-browser fallback outright.
3. Keep the full JS model for the fallback and also port it to Rust for the
   authority. The worst case: two implementations of the same mutation semantics
   that must stay bit-identical forever.

The elegant single-source model is a casualty of the language boundary whichever
shape is chosen; the only question is how much duplication to accept and whether
the browser fallback survives. In a 100% Rust GUI this decision disappears by
construction: the model is one Rust crate imported by both the authority and the
GUI, single-process, no bridge, no second copy. That is the strongest architectural
argument for going all the way to Rust rather than stopping at a hybrid. Whatever
the target, the ported model must be re-validated against the existing 661-line
mutation test suite, either by porting the tests or by differential-testing the
JavaScript and Rust implementations against the same fixtures until they agree.

---

# The three designs

## Design A — Tauri hybrid: web UI, Rust core

Keep the UI in web technology (the existing hand-drawn SVG renderer, the note
editor, the dialogs) running in the OS webview, and reimplement the store, the
task authority, and the MCP server in Rust as the Tauri backend.

The renderer carries over almost unchanged: it is already Node-free and speaks
through the preload bridge, which in Tauri becomes a thin JavaScript shim over
`invoke` (request/response) and `listen` (pushed updates) backed by
`#[tauri::command]` functions. There is no Node in the webview at all. The Electron
main process re-homes into the Rust core as the single task authority, and the MCP
server becomes an rmcp `StreamableHttpService` on an axum router at
`127.0.0.1:35899`, in-process with that authority, pushing live updates to the
webview through Tauri events exactly as today. Distribution is solid and matches
the no-cloud posture: Tauri 2 signs on macOS with a Developer ID and notarizes via
the App Store Connect API (the apparatus conception-space already runs), signs on
Windows, and ships a first-party updater that verifies artifacts with minisign
(Ed25519) against a static `latest.json` manifest hostable on GitHub Releases, no
dynamic server. Binaries land around 10 MB with idle memory near 40 MB, against
Electron's 80 to 150 MB and 200 to 400 MB.

Costs. This is the design in which the model re-homing tax above is unavoidable and
the single-source model is compromised. Fidelity is the other exposure: Tauri uses
three webview engines (WKWebView on macOS, WebView2 on Windows, WebKitGTK on
Linux), and WebKitGTK is the weak one for CSS, SVG, and font rendering, precisely
the workload the bespoke subway scene with heavy pan and zoom stresses, so intent 2
(faithful, legible reproduction) now depends on real cross-platform visual testing
that Electron's uniform Chromium made unnecessary. The MCP server must enable
Host/Origin allow-listing: rmcp had a loopback DNS-rebinding advisory
(GHSA-89vp-x53w-74fx, fixed in 1.4.0), the same class of Host-header bug we already
fixed once in the Node server, so Rust does not make it disappear. The authority is
reachable by two paths (Tauri IPC for the renderer, loopback HTTP for external MCP
clients) that must enforce validation consistently. And the JSON5 round-trip caveat
applies.

Verdict: viable and mature, and the cleanest form of a Tauri adoption, but not 100%
Rust, and it keeps both the webview-fidelity QA and the model-duplication hazard.
Its best role is an interim step toward Design B, not the destination.

Stack (all MIT or Apache-2.0): Tauri 2.x, rmcp, axum/tower/hyper, a maintained
JSON5 crate with format preservation, the Tauri updater plugin with minisign.

## Design B — 100% Rust GUI (egui or iced): no JavaScript, no webview

For PensaGrex specifically, the larger rewrite may be the more coherent end state
rather than the less. The interface is not HTML layout; it is a bespoke subway-map
vector scene with pan, zoom, and custom node glyphs that are already hand-drawn as
SVG. An immediate-mode Rust GUI like egui is built precisely for custom painting
under a camera transform, so re-expressing the forest as Rust drawing calls is a
natural fit rather than a fight, and it dissolves the webview-fidelity problem
entirely: one renderer you own, no WKWebView-versus-WebView2 variance, no bundled
Chromium. The genuinely web-shaped parts (the markdown note editor, the dialogs,
the domain switcher) become native widgets, which is the tedious part rather than
the hard part. The cost is honest and large: the renderer and interaction layer are
rewritten alongside the model and the store, so it is the widest scope of any option
discussed. But it yields the most unified result, which is what the direction is
after: one language, one rendering path, no JavaScript, no webview.

The model re-homing question disappears here. Because egui and iced are
single-process with no webview, the model has exactly one home, a workspace `core`
crate imported by both the store/MCP authority and the GUI layout code; there is no
bridge, no IPC serialization of task operations, and no risk of divergence. View
state (camera, zoom, collapse; axiom 8) stays in the GUI layer and is never written
to the forest file, which egui's `Scene` state or an iced `Canvas` transform keep
client-side naturally. Nothing ports at the code level (JS to Rust is a rewrite);
the largest single piece of work is not the model but reproducing the Googie skin,
glyphs, gradients, and azure/navy ground faithfully enough to satisfy intent 2.

### egui versus iced

Both are permissively licensed and viable; they differ in ways that matter here.

- egui (with eframe; 0.35.0, 2026-06-25; MIT or Apache-2.0). Immediate mode. Pan
  and zoom come turnkey via `egui::Scene` (added ~0.31). `TextEdit` ships built-in
  undo/redo and IME, and `egui_commonmark` gives a turnkey markdown preview.
  AccessKit accessibility is on by default through eframe. Weaknesses: epaint's
  painter natively supports only simple linear gradients, so the radial glows and
  gradient-filled paths of the Googie skin need hand-built meshes with per-vertex
  colours; `TextEdit` has no viewport culling, so very large notes degrade badly
  (reported near 1 fps at ~1 MB); and text drawn through `Scene`'s layer transform
  can blur at high zoom unless zoom is driven through painter coordinate mapping.
- iced (0.14.0, 2025-12-07; MIT). Elm-like, retained. Its `Canvas` has first-class
  gradient fills and lyon tessellation, so the skin is easier to render faithfully,
  and it redraws geometry per frame so glyphs stay crisp at zoom. Weaknesses: you
  build pan and zoom yourself; the `text_editor` widget is solid but has no
  built-in undo/redo (the app must implement the undo stack); there is no AccessKit
  integration (issue #552, open since 2020); and there is no drop-in markdown
  viewer, so a preview pane is custom work.

The trade is legible: egui is the better fit for the subway-map-plus-notes shape
(pan/zoom, editor undo, accessibility, turnkey markdown all come free), at the cost
of hand-building the gradient work for the skin; iced is the stronger pure vector
painter (gradients and tessellation for the skin), at the cost of building pan/zoom,
undo, accessibility, and the markdown preview yourself. On balance egui is the
recommended toolkit for this app, with the skin's gradients as the one piece of
deliberate extra effort.

### The note editor: not CodeMirror, and why

CodeMirror is itself MIT-licensed, so licensing is not what rules it out; it is a
DOM editor, built on the browser's contenteditable, and only exists where there is
a webview. So Design A keeps CodeMirror, Marked, and KaTeX untouched, and Design B
cannot keep any of them. Nothing in the pure-Rust world matches CodeMirror 6
feature-for-feature, but the need is a markdown notes editor, not a code-authoring
surface. In egui that is `TextEdit` plus `egui_commonmark` for preview (with
`ropey` for the buffer and `syntect` or `tree-sitter` for markdown highlighting if
wanted); in iced it is the cosmic-text-based `text_editor` (the closest thing to
CodeMirror-class editing in the permissive Rust ecosystem, though undo is on you).
Markdown rendering moves from Marked to `pulldown-cmark` (MIT), deliberately chosen
over `comrak` (BSD-2-Clause, outside a strict MIT-or-Apache constraint). Avoid
`helix-core` for the editor: capable but MPL-2.0, outside the MIT-or-Apache line
(though AGPL-compatible).

Math (KaTeX today) is a preview-pane concern, not an editor one, and this reframing
makes it tractable. The editor holds plain LaTeX source, so cosmic-text or `TextEdit`
need no math awareness; math renders only in the rendered pane, exactly like
Obsidian's split view. The pipeline is `pulldown-cmark` plus a small extension that
recognises `$...$` and `$$...$$` (optionally `\(...\)` and `\[...\]`), with each math
run rendered to an SVG or cached texture, debounced (100 to 200 ms) and keyed by
source, size, and colour so identical formulas render once. Contrary to an earlier
reading in this notebook, native Rust math renderers do exist: RaTeX (pure Rust, no
JavaScript or WebView, emits a flat display list for SVG/PNG/canvas), ReX (an older
SVG math-typesetting library), and `pulldown-latex` or `katex-rs` (LaTeX to MathML);
`pulldown-cmark-katex` already wires pulldown-cmark math runs to MathML.

RaTeX validated (July 2026). License: MIT, confirmed by the repo LICENSE, the GitHub
sidebar, and the crates.io metadata; it bundles the KaTeX math fonts under OFL-1.1
(`THIRD_PARTY_NOTICES.txt`), the same license class PensaGrex already vendors and the
same fonts the current app ships, so it satisfies the MIT-or-Apache constraint
cleanly. Coverage: the ">99.5% KaTeX syntax coverage" figure is backed by a real
conformance harness (a golden suite comparing rendered output against KaTeX 0.16.45
by ink-coverage IoU, row by row, over math, mhchem chemistry, and physics, plus a
public support table and live demo), so it is evidence-based rather than marketing;
the caveats are that the corpus is the project's own (self-measured, not independently
audited) and the live table renders via JavaScript so the exact number was not read
directly. Maturity is the residual risk, not coverage or license: pre-1.0 (v0.1.13,
2026-07-07), a multi-crate workspace on crates.io, ~1.4k stars but apparently a single
maintainer, so expect API churn and weigh bus-factor. The remaining validation, when
the port is real, is to run representative note formulas through its harness. So math
is a bounded implementation task in the preview pane, not a lost capability.

Insulating the dependency. The single-maintainer risk is bounded by the MIT license
itself: worst case, fork the version already held, on identical terms, at any later
date, so RaTeX's adoption does not bet on the maintainer's persistence. Two moves,
different costs. Cheap insurance: vendor the sources into our tree (a `cargo vendor`
dir or a mirror) so the build no longer depends on GitHub or crates.io serving the
code (a pinned git-rev alone does not protect against the repo being deleted); this
addresses "no worries about the future of that repo," stays reversible, and keeps the
option to pull upstream fixes. We would vendor only the string-to-display-list-to-SVG
subset (`ratex-types`, `-lexer`, `-parser`, `-layout`, `-render`, `-svg`, and the
font crates), not `-ffi`/`-wasm`/`-pdf`. Expensive independence: hard-fork and
maintain that subset ourselves, which transfers rather than removes the bus-factor,
since we would then own an intricate TeX layout engine, a specialized long-term
liability. Recommendation: vendor for supply-chain safety and track upstream while it
lives; keep a full fork as a contingency executed only on genuine abandonment. Each
vendored file keeps its MIT header; the bundled math fonts keep OFL-1.1, per the
existing font-vendoring pattern. (Discard the tempting HTML-plus-KaTeX
in a WebView route: it reintroduces the webview Design B exists to remove, and belongs
to Design A.)

Costs. A full rewrite, not a migration: the model, its tests, the store and atomic
writes, the task authority, and the MCP server are all re-authored in Rust, and the
bespoke Googie scene is rebuilt against a new drawing API. Packaging is do-it-
yourself: there is no electron-builder that bundles, signs, and notarizes in one
step, so expect to wire `cargo-packager` (bundles) with `apple-codesign`/`rcodesign`
(pure-Rust macOS sign, notarize, staple, runnable from Linux/Windows CI) and Azure
Trusted Signing (Windows). Both toolkits are pre-1.0 and take breaking changes
across minor versions. The JSON5 round-trip caveat applies here too.

Verdict: the recommended end state if 100% Rust is the goal. It is the widest
rewrite but the only design that is actually 100% Rust, removes the webview-fidelity
problem outright, and collapses the model to a single home. egui is the toolkit to
prototype first, with the subway scene as the acceptance test.

Stack (fully MIT or Apache-2.0): egui/eframe/epaint (or iced), wgpu, winit,
AccessKit, pulldown-cmark, egui_commonmark, rmcp, axum; cargo-packager and
apple-codesign at build time.

## Design C — Rust plus Python

A design that keeps Python in the picture, given the org is Python-first and already
ships smalt-mcp. Three shapes are possible: (a) a Rust app embedding Python
in-process via PyO3; (b) a Rust UI with a Python (FastAPI) backend spawned as a
sidecar; (c) the MCP server left in Python while the app core is Rust. The research
is blunt about all three: Python earns a place only across a wire, as a federated
peer service, never inside the app.

The reasons are concrete. Packaging a Python interpreter into a signable,
notarizable desktop app is the dominant cost and it is worse than Electron's, not
better: a frozen Python tree (PyInstaller) crashes under macOS hardened runtime
unless you add entitlements that weaken security and individually sign every bundled
`.so`/`.dylib`, and Tauri has a specific known failure where an app notarizes with
the sidecar removed and fails with it present (tauri #11992). This trades away the
single biggest win of going Rust, one static binary that signs like any other.
Shapes (b) and (c) reintroduce exactly the "two runtimes glued by IPC" arrangement
this notebook already rejects, adding 15 to 40 MB of frozen interpreter and a
visible cold-start spawn. Shape (a) is on PyO3's weaker footing: embedding a Python
interpreter in a Rust binary has no first-class static support (PyO3 issue #416),
dynamic embedding forces shipping libpython plus the standard library, and the GIL
contends with the render thread. And there is a model-duplication trap in shape (c):
a Python MCP server that implements task mutations duplicates the authority in a
second language, which the single-source-of-truth discipline forbids; the only safe
form is a thin proxy in front of what rmcp already provides in-process for free.

There is also a clean licensing reason to keep Python over a wire. AGPL copyleft,
including the section-13 network clause, reaches whatever is combined into one
program. Two separate processes talking over a documented wire (loopback HTTP or
MCP) are separate works, so federating with the org's FastAPI services and smalt-mcp
does not pull those services under AGPL. In-process PyO3 embedding erases that
boundary and links the embedded Python into the AGPL work. The wire is the license
boundary, and it is worth keeping.

Verdict: do not put Python inside PensaGrex. The Rust core is the single authority
in every shape, and Python's right place is the org's existing FastAPI and smalt-mcp
estate, reached over MCP or HTTP, carrying integration rather than any forest
semantics. This is the same picture as ROS federating languages over a wire, and it
is fully compatible with Design B: the app is 100% Rust, and Python stays first-class
for services at the boundary. PyO3 remains available for a future scripting or plugin
surface that calls into the Rust authority (accepting that such embedded Python would
fall under AGPL).

Precedent worth noting: Dora-rs, a Rust-native robotics dataflow framework
(Apache-2.0), is described as a "100% Rust framework" that federates Rust, Python,
C, and C++ nodes over a zero-copy Arrow plus Zenoh wire, positioned against ROS 2 and
reported far faster than ROS 2's Python path. It is the clean instance of "Rust core,
Python as a wire-federated node, no in-process embedding."

---

# Other options considered

Recorded so the option space is explicit; none removes the central cost, which is
reproducing the bespoke subway renderer and rehousing the loopback MCP server.

- Dioxus, desktop/Wry mode (MIT or Apache-2.0; mature, 0.7.x). RSX components in
  Rust, but desktop mode still embeds the OS webview, so it inherits the same
  cross-webview inconsistencies as Tauri and is a full JS-to-Rust rewrite for no
  rendering gain over Tauri. A lateral move.
- Dioxus Native / Blitz plus Vello/WGPU (MIT or Apache-2.0; `stylo_taffy` adds
  file-level MPL-2.0). Webview-free native drawing on a declarative DOM-like model,
  a promising middle path, but alpha (blitz 0.3.0-alpha) and betting the subway map
  on a moving target. Premature for a shipping app; worth watching.
- Flutter plus flutter_rust_bridge (Flutter BSD-3-Clause, bridge MIT; mature).
  Flutter's own canvas suits a bespoke vector scene and a Rust core can hold the
  model and MCP server, but it adds Dart as a third language and rewrites the whole
  UI in Dart. The largest language and culture mismatch for this org.
- Pure local-first web app / installable PWA (permissive; lightest shell). The SVG
  renderer and model port almost verbatim, but it collides with the northstar:
  browser file access is either the File System Access API (Chromium-desktop only)
  or OPFS (a sandboxed virtual store, not user-visible JSON5 and markdown files),
  and a browser tab cannot host the loopback MCP server, so it breaks axiom 6 and
  the live-AI surface. Rejected.
- Trim Electron (MIT; zero rewrite). Harden and prune the current app: context
  isolation, CSP, dependency pruning, asar, v8 snapshots. Real and cheap, but it
  cannot shed bundled Chromium (150 to 200 MB binary, 200 to 400 MB idle), so it is
  optimization, not the redesign the direction calls for. The sensible hold-position
  if the port is deferred.
- gpui, Zed's UI framework. Excluded on licensing despite the Apache-2.0 label: a
  default release build statically links GPL-3.0-or-later object code through its
  dependency chain (gpui to sum_tree to ztracing to zlog), so it fails a permissive
  constraint in practice, and it is not a supported standalone crate (its API tracks
  Zed's main branch). Do not adopt.
- Freya (MIT over BSD-licensed Skia; young). Webview-free native Rust rendering,
  the most fitting emerging permissive option after egui/iced, but 0.4.0
  (2026-07-16) just rewrote its reactive core, so it is a schedule risk for a
  bespoke renderer. Watch, do not bet on yet.
- Slint. Excluded by construction: available only under GPLv3, a
  royalty-free-with-attribution license, or a paid commercial license, never MIT or
  Apache. Mature; the issue is licensing, not maturity.

A note on the permissive constraint and AGPL: because PensaGrex is itself
AGPL-3.0-or-later, GPL contamination from gpui or a GPL Slint would not break the
app's own license compliance. The reason to keep the MIT-or-Apache preference is
that it preserves the freedom to relicense more permissively later and keeps the
dependency tree clean; it is a forward-looking discipline, not a present legal bar.

---

# Sync server (an orthogonal capability)

A recurring idea, distinct from the UI and language choice: an optional,
self-hostable server that syncs a user's forests and notes across devices, modeled
on the Joplin notes server. It could pair with any of the designs above; a Rust
rewrite is merely a natural moment to consider it. The org already ships jonobones,
a Joplin-sync daemon, as prior art.

The northstar tension is the first thing to settle, and it resolves favourably if
the design is disciplined. Axiom 6 says local, no account, no cloud, no lock-in. An
optional, off-by-default, additive sync layer honours that as long as the local
files stay the complete and authoritative source of truth on every device and the
server holds only opaque replicas. Two tempting variants must be rejected because
they invert axiom 6: making a "LAN box the authority" (it forfeits offline use and
the no-cloud property), and storing CRDT causal metadata either inside
`forest.json5` (which destroys its plain, grep-able character) or in a sidecar that
demotes the JSON5 to a derived projection (which inverts "the file is the source of
truth"). On-by-default or required sync would cross the line into "PensaGrex Cloud"
and is out.

Encouragingly, the sync boundary is already implemented in `store.js`:
`bookmarks.json` is deliberately shared with the data, while view state (camera,
zoom, collapse) sits in a `userData` sidecar and is excluded per axiom 8. So "what
to sync versus what to keep local" is a solved question. The on-disk format is
already the sync unit (an id-keyed `forest.json5` per domain, per-task markdown
notes, `bookmarks.json`), the atomic write path and single authority are exactly
what a sync layer needs to serialize its applies, and `validateForest` becomes the
safety gate that any incoming or merged forest must pass before it is written.

Recommended shape. Do not build a bespoke server first. Implement a
backend-agnostic sync-target driver (list/get/put/delete, plus an optional delta
cursor) in a module beside `store.js`, and point it at infrastructure the user
already self-hosts: WebDAV, S3/Nextcloud, git (the most northstar-aligned: a remote
the user owns, versioned, portable, invoked as a subprocess), or Syncthing. Keep a
local sync-state sidecar (last-synced hash per item, per target) out of
`forest.json5`, mirroring Joplin's `sync_items`. Handle conflict the Joplin way:
last-writer-wins with the losing version preserved as a sibling copy and surfaced,
never a silent overwrite. Add an optional end-to-end-encryption layer at the
serialization boundary only for untrusted (VPS) hosting; a LAN box the user owns may
not need it, and E2EE carries a hard failure mode (a lost master key renders a
zero-knowledge remote copy unrecoverable).

The genuinely hard part is not transport but merge. `forest.json5` holds a whole
domain in one file, so any whole-file syncer conflicts on non-overlapping task edits
from different devices (or from a device and the in-app MCP agent). Scalar per-task
fields merge easily, but the structural moves (`move_subtree`, `move_into_line`,
`detach_to_project`) are arbitrary re-parents, and splice-delete reconnects
children, so two devices can create a cycle or orphan a subtree; those collisions
must be detected and routed to a conflict copy (or, someday, CRDT-resolved). Note
also the note/forest coupling: a task's note filename lives inside `forest.json5`
while the note is a separate file, so a conflict copy of the forest must keep the
note references and note files consistent.

If a bespoke delta-sync server is ever built (justified only at a scale a
single-user tool will not reach), it should be a separate program in its own repo,
model-agnostic, never the authority, and FastAPI is the right stack (org convention,
the smalt-mcp precedent). It should be AGPL, like pensa-grex and jonobones; AGPL is
the correct license for networked server software, and section 13 is trivial for a
self-hosted single-user server. Reuse candidates for merge, if the CRDT path is ever
taken, are all MIT: Loro (a movable-tree CRDT, the best structural fit for
tasks-with-moves), Automerge, or Yjs. One dead end to record: Joplin Server the
software is under a noncommercial Personal Use License and is not open source, so it
cannot be forked, shipped, or offered as a service; only the protocol shape and
Joplin's AGPL client/lib driver code are reusable.

This capability is orthogonal enough that it may deserve its own `sync_ideas.md`
notebook if it firms up; for now it lives here.

---

# Comparison

| Design | 100% Rust | Renderer | Model home | MCP server | Webview fidelity risk | Binary / idle | Permissive-clean | Rewrite scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. Tauri hybrid | No | Kept (web) | Split (Rust authority + JS derive), duplication hazard | Rust (rmcp) | Yes (3 engines, WebKitGTK weak) | ~10 MB / ~40 MB | Yes | Backend + model; renderer kept |
| B. 100% Rust GUI (egui) | Yes | Rewritten in Rust | One Rust crate, no duplication | Rust (rmcp) | None (own renderer) | Small native binary | Yes | Widest: renderer + interaction + model + store + MCP |
| C. Rust + Python | Core yes; Python at the wire only | As A or B | One Rust crate; Python holds none | Rust in-process (Python only as a peer) | As A or B | Worse if Python bundled | Yes | As A/B, plus Python packaging pain if embedded (rejected) |
| Trim Electron | No | Kept | Unchanged (JS, single source) | Node (kept) | None (bundled Chromium) | 150-200 MB / 200-400 MB | Yes (MIT) | None |

Sync server is orthogonal to every row and can be added to any of them.

---

# Northstar fit

- Axiom 6 (the file is the source of truth, plain JSON5 and markdown on disk,
  portable) is the reason the port is tractable at all: storage is
  framework-agnostic and survives unchanged. The one place it can be violated
  accidentally is the JSON5 write path (see the round-trip caveat); guard it.
- Axiom 8 (view is not data) is preserved in every design: camera, zoom, and
  collapse stay client state. The existing `store.js` split of `bookmarks.json`
  (shared) versus view state (local) already encodes the rule.
- Intent 2 (structure legible at a glance: the subway map and Googie skin) is the
  fidelity requirement. Design B must reproduce the grammar and skin against a new
  drawing API; Design A must survive WebKitGTK. This is the largest single risk and
  the thing to prototype first.
- Nothing in the northstar mandates Electron. This is purely a substrate choice.

# Costs and open questions

- Scope. Design B rewrites the renderer, interaction, model, store, and MCP server;
  it is the widest path. Design A is narrower but keeps the fidelity QA and the
  duplication hazard.
- Org tooling. There is no handbook Rust-desktop profile. A Rust signing and
  notarization CI profile (cargo-packager plus apple-codesign plus Azure Trusted
  Signing, or Tauri's bundler) replaces the electron-builder pipeline set up across
  the v0.8.x and v2.x releases. This is new org work either way and belongs in the
  handbook once chosen.
- Language fluency. Rust is a maintenance shift for a deliberately-plain-JS app,
  even though it is org-aligned; Python stays first-class for services.
- Migration strategy (open). Staged (a Tauri interim, then the webview swapped for
  egui) de-risks the jump but risks paying the model re-homing cost twice unless
  sequenced deliberately; a big-bang rewrite to Design B is cleaner but riskier.
- Editor and math. The note editor has good permissive Rust answers, and math is a
  preview-pane task, not an editor one: native Rust math renderers exist (RaTeX, ReX,
  `pulldown-latex`/`katex-rs`), so KaTeX narrows from a lost capability to a bounded
  implementation task, with library maturity and licensing to validate.
- The data is safe under every option: JSON5 forests and markdown notes on disk are
  unchanged.

# Precedent: is robotics moving from C++/Python toward Rust/Python?

The analogy the direction rests on holds up, and its precise shape is worth
borrowing. A dedicated research pass on the ROS community (July 2026) finds the move
toward Rust serious and sustained rather than fringe, but framed as "add Rust
alongside C++ and Python," not "rewrite ROS in Rust," and not yet a formally
sanctioned peer status.

Two tracks are visible. On the client-library track, ros2-rust/rclrs has reached
near feature-parity with the C++ and Python clients (publishers, subscriptions,
services, actions, timers, parameters, zero-copy loaned messages; v0.7.0 on
2026-01-18), and its message generator entered the ROS 2 Rolling core generator set
in October 2025 alongside the C, C++, and Python generators; a core ROS 2 author
presented it at FOSDEM 2026 as "the official ROS 2 client library for Rust." Yet
rclrs still disclaims API stability, lives under the community org rather than the
official one, and ROS 2's own documentation continues to list only C++ and Python as
officially maintained, with Rust at "various levels of community support." So Rust is
first-class in practice and momentum, not yet by governance.

On the middleware track, Rust entered the core stack by dependency rather than by
rewrite: Zenoh, which is written in Rust, was selected in the 2023 RMW evaluation as
ROS 2's alternative middleware, and rmw_zenoh reached Tier-1 support in Kilted (May
2025). But the ROS team reached Zenoh deliberately through its C and C++ bindings, so
the Rust sits behind the RMW abstraction rather than being exposed in the core. And
the Rust-native alternative, Dora (dora-rs), is a self-described "100% Rust framework"
that positions itself against ROS 2 on performance (claiming a large speedup over ROS
2's Python path via zero-copy shared memory), but as a separate dataflow framework,
not a ROS rewrite.

The bearing on PensaGrex is direct, and it validates the recommended shape rather
than a maximal one. Robotics' actual trajectory is Rust as a first-class citizen
alongside Python, federated over a wire, plus Rust-native alternatives that keep
Python as a node, rather than a wholesale rewrite of a mature C++ core. That is
exactly Design B combined with Design C's discipline: a 100% Rust app, with Python
kept first-class at the service seam over a wire, Dora-rs being the clean instance of
a Rust core with Python nodes. It does not argue for embedding Python in the app, and
it does not treat "rewrite everything in Rust" as the norm; it treats Rust as the
language one adopts for new first-class surfaces while Python stays over the wire.

Sources: rclrs 0.5.0 and 0.6.0 release announcements (ROS Discourse, 2025); the
FOSDEM 2026 rclrs talk (Esteve Fernandez); the ROS 2 alternative-middleware report
(2023) and rmw_zenoh (ros2 org, Tier-1 in Kilted, 2025); dora-rs.ai.

# Decisions log

- 2026-07-21 — Direction set (author): PensaGrex should become a 100% Rust app.
  Working recommendation from the session discussion and the research pass: the end
  state is a Rust-native GUI (egui preferred over iced for the subway-map-plus-notes
  shape), not Tauri, because PensaGrex is a bespoke-renderer app for which a webview
  buys little and a Rust-native GUI removes the webview-fidelity problem outright.
  Tauri is a possible interim, not the target. Python stays at the service wire, not
  inside the app (Design C's in-app shapes rejected on packaging and licensing
  grounds). The model must be re-homed to a single Rust crate and its correctness
  preserved against the existing test suite; the JSON5 write path must preserve
  comments and formatting to honour axiom 6. A Joplin-style sync server is a
  separate, optional, off-by-default capability that can pair with any design.
  Captured as an in-flight idea for exploration, not yet a plan.
- 2026-07-21 — RaTeX dependency stance (agreed): if Design B proceeds and RaTeX is
  used for in-note math, vendor the typeset-to-SVG subset (`ratex-types`, `-lexer`,
  `-parser`, `-layout`, `-render`, `-svg`, and the font crates) into our tree for
  supply-chain safety, track upstream while it stays active, and reserve a full fork
  for the day upstream is abandoned. The MIT license makes the fork always available,
  so adoption does not bet on the single maintainer. Vendored files keep their MIT
  headers; the bundled math fonts keep OFL-1.1, per the existing font-vendoring
  pattern. A Design B decision; no action until that path is taken.
