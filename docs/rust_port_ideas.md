<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Rust port — moving PensaGrex off Electron

Status: under study. This is an in-flight idea held for exploration, not a
commitment; `in-flight_ideas.md` carries the index entry. Everything below is
weighed against `northstar.md`.

## Why consider it

- Electron forces JavaScript and bundles Chromium. The author was never content
  with the JS constraint, and the artifacts are large: v2.1.0 shipped installers
  of 104 to 134 MB.
- The org is Python-first (FastAPI services) and comfortable with a federated,
  ROS-like split of languages across a wire. Rust marries with Python at least as
  well as C++ does: in-process through PyO3 with maturin building the wheels, and
  at the service seam over HTTP, gRPC, or MCP. Much of the modern Python substrate
  is already Rust underneath by this path (pydantic-core, polars, ruff, uv).
- The direction the author has settled on: PensaGrex should become a 100% Rust
  app.

## What "100% Rust" actually means (the first fork)

The phrase forks into two very different projects, and the choice sets the scope
of everything else.

- Tauri is not 100% Rust. Tauri gives you a Rust backend, but the interface stays
  HTML, CSS, JavaScript, and (here) hand-drawn SVG, running in the operating
  system's webview. Rust is the backend language only.
- A Rust-native GUI toolkit is 100% Rust: no JavaScript, no webview. Candidates:
  egui (immediate mode), iced (Elm-like, pure Rust), slint (declarative, with its
  own markup), gpui (Zed's, GPU-accelerated), freya (Dioxus/RSX over Skia).

Only the second is literally 100% Rust. It is also the larger rewrite, because it
discards the renderer, not only the `src/main` backend.

## What the current architecture means for a port

- The renderer imports nothing from Node or Electron; it sees disk only through
  the `pensagrex` preload bridge (about fifteen methods). Under Tauri it ports
  mostly as-is (the transport at the bridge seam changes from Electron IPC to
  Tauri `invoke` or local HTTP); under a Rust-native GUI it is rewritten.
- The shared model in `src/shared/` is roughly 1,100 lines of non-test code, of
  which `mutations.js` alone is 658 (with a 661-line test file). It is imported in
  three places, not one: the main-process authority (`taskService.js`), the
  renderer's no-Electron fallback (`bridge/api.js`), and the renderer's view spine
  (`app.js`, which calls `buildForest` to derive what it lays out). This shared
  reuse is the crux of the whole port.
- `store.js` (file I/O, JSON5, atomic write-to-temp-then-rename, settings, the
  library-root bounds-checking) ports to Rust as routine work.
- The MCP server ports to Rust via rmcp, the official Rust MCP SDK. Confirmed by
  web search (July 2026): rmcp supports the Streamable-HTTP server transport
  through its `transport-streamable-http-server` feature, integrating with axum,
  so the loopback endpoint on `127.0.0.1:35899` can be rebuilt faithfully. The
  org already ships a Python MCP server (smalt-mcp), so the tool-surface and
  scope-tier logic is well-trodden regardless of the target language.

## The model re-homing decision (the real center)

Moving the authority off Node forces a decision about the model. The renderer
still needs to parse and derive a forest in order to lay it out; today it does so
with the JavaScript `buildForest` and `validate`. If the backend becomes Rust but
the boundary stays as it is ("forest content crosses as raw JSON5 text; the
renderer parses and validates it"), then the forest semantics, the fork rules,
the migrations, and the validation invariants live in Rust for the authority and
in JavaScript for the renderer: two implementations of the app's core that must
agree bit-for-bit. That is the exact drift hazard the org's single-source-of-truth
discipline exists to prevent, and `mutations.js` is the worst candidate to keep
twice.

The clean resolution is to re-home the model to the backend: have the backend run
the forest build and validation and return the frontend an already-derived
structure, so the model has one authoritative home and the frontend keeps only
layout and render. In a 100% Rust app (a Rust-native GUI) this is moot by
construction: the model is Rust and the GUI is Rust, one home. It only becomes a
live decision if a staged migration keeps a web UI for a while (a Tauri interim);
in that case decide it early. Either way, correctness must be preserved through
the port: `mutations.js` should be ported against its existing test suite, either
by porting the tests to Rust or by differential-testing the JavaScript and Rust
implementations against the same fixtures until they agree.

## Options, ranked

1. Rust-native GUI (egui or iced). 100% Rust, no webview, the widest rewrite
   (renderer, interaction, model, store, and MCP), and the most unified result.
   The recommended end state if 100% Rust is the goal, for the reasons in the next
   section.
2. Tauri with a full Rust backend and the model re-homed. The cleanest form of a
   Tauri adoption, but not 100% Rust (the web UI remains), and it keeps the
   multi-webview fidelity QA below. Useful mainly as an interim step toward
   option 1.
3. Rejected: a Node or Python sidecar under Tauri. Two runtimes glued by IPC or
   HTTP, architecturally muddier than the Electron app it would replace, and it
   forfeits the size and memory reduction that motivate leaving Electron.

## Why a Rust-native GUI fits PensaGrex specifically

The interface is not HTML layout; it is a bespoke subway-map vector scene with
pan, zoom, and custom node glyphs already hand-drawn as SVG. An immediate-mode
Rust GUI such as egui is built precisely for custom painting under a camera
transform, so re-expressing the forest as Rust drawing calls is a natural fit
rather than a fight. It also dissolves the webview-fidelity problem entirely: one
renderer you own, no WKWebView-versus-WebView2 variance, no bundled Chromium. The
genuinely web-shaped parts (the markdown note editor, the dialogs, the domain
switcher) become native widgets, which is the tedious part rather than the hard
part. Markdown rendering has a mature Rust path (pulldown-cmark); the vendored
display and UI fonts (Boogaloo, League Spartan) load as ttf/otf into the toolkit.

## Northstar fit

- Axiom 6 (the file is the source of truth, plain JSON5 and markdown on disk,
  portable and legible without the app) is untouched: the storage layer is
  framework-agnostic and survives any port unchanged. This is the strongest reason
  the port is even tractable.
- Axiom 8 (view is not data) is preserved: camera, zoom, and collapse stay client
  state, kept out of the forest file, exactly as now.
- Intent 2 (structure legible at a glance: the subway map, the atomic-age skin) is
  the fidelity requirement. A renderer rewrite must reproduce the subway grammar
  and the Googie skin faithfully; this is the largest single risk of a Rust-native
  GUI and the thing to prototype first.
- Nothing in the northstar mandates Electron. This is purely a substrate choice.

## Licensing (org REUSE / AGPL discipline)

- egui and iced are permissively licensed (MIT or Apache-2.0) and compose cleanly
  with AGPL-3.0-or-later.
- slint is dual GPL-or-commercial and carries its own `.slint` markup; weigh both
  against the REUSE discipline before adopting.
- Confirm rmcp's license (Apache-2.0 or MIT expected) and record it in the REUSE
  bookkeeping.
- The Cargo dependency tree would replace the npm tree in the legal bundle. The
  in-app "Open Source Licenses" viewer would source from a Rust licensing tool
  (cargo-about or cargo-deny) instead of the current Node license tooling.

## Python at the boundary

Going 100% Rust for the app does not remove Python; it moves it to the boundary.
A Rust PensaGrex federates with the org's FastAPI world over MCP or HTTP exactly
as any service would, and PyO3 makes embedding Python (scripting, user plugins)
clean if that is ever wanted. A 100% Rust app and a Python-first service estate
are two halves of one federated design, not a tension.

## Costs, risks, open questions

- Scope. Option 1 rewrites the renderer, the interaction layer, the model, the
  store, and the MCP server. It is the widest of any path discussed.
- Org tooling. There is no handbook Rust-desktop profile. Packaging, code signing,
  and notarization for a cargo or Tauri app would replace the electron-builder
  signing and notarization set up across the v0.8.x and v2.x releases. macOS
  notarization, Windows signing, and deb/AppImage packaging all exist for Rust
  apps, but a parallel CI profile has to be built.
- Language fluency. The app is deliberately plain JS today; Rust is a maintenance
  shift for the project even if it is org-aligned.
- Migration strategy. Staged (a Tauri interim, then the backend to Rust, then swap
  the webview for egui) de-risks the jump but risks paying the model re-homing
  cost twice unless sequenced deliberately; a big-bang rewrite is cleaner but
  riskier. This is an open question.
- The data is safe either way: JSON5 forests and markdown notes on disk are
  unchanged by the port.

## Precedent (research in progress)

Whether the ROS community is itself moving from a C++/Python foundation toward
Rust/Python is being researched separately; the findings will be folded in here as
motivation and precedent. The threads under investigation: ros2-rust/rclrs and r2r
(Rust client libraries for ROS 2), Zenoh and rmw_zenoh (Rust entering the ROS 2
middleware layer), and Dora-rs (a Rust-native dataflow framework positioned
against ROS).

## Decisions log

- 2026-07-21 — Direction set (author): PensaGrex should become a 100% Rust app.
  Working recommendation from the session discussion: the end state is a
  Rust-native GUI (egui or iced), not Tauri, because PensaGrex is a
  bespoke-renderer app for which a webview buys little, and a Rust-native GUI
  removes the webview-fidelity problem outright. The model must be re-homed to the
  backend so it is not duplicated across languages, and its correctness preserved
  against the existing model test suite. Tauri remains a possible interim step,
  not the target. Captured as an in-flight idea for exploration, not yet a plan.
