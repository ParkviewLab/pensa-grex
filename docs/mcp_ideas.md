<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# MCP server (in-app)

Design notebook for making PensaGrex itself an MCP server, so that agents on the
same computer can read and write tasks while the app is running. This is a
question under exploration, not a commitment; it is captured here so the design
survives across sessions. As of this writing the architecture and the binding
are settled; the tool surface an agent receives is still open, and no
implementation plan has been written.

## Goal

An agent (for instance Claude Code) should be able to read a domain's projects
and act on them the way a person does: see the tasks set up next, add or
complete tasks, set a cursor, and so on. The motivating case is "look in there
and see the tasks I set up for you to do next," made easy for an agent rather
than for a person only. Read and write from the start, not read-only, because
every write already passes the validation gate, so a write is no more dangerous
to data integrity than a read; the residual risk is only semantic, which is the
agent's responsibility with any tool.

## Architecture

The app is the server. While it is open, the Electron main process hosts an MCP
endpoint on localhost, and an agent talks to the live app; every edit is the
app's own edit.

The foundation, which is worth making on its own merits, is to make the main
process the single authority over tasks. Today the writer is the renderer: it
parses `forest.json5`, applies the mutations, validates, and hands opaque text
to main, which only writes bytes (see the `pensagrex:load-forest` /
`pensagrex:save-forest` IPC in `src/main/index.js`). The inversion moves the
pure model, mutations, and validation (in `src/renderer/src/model/`, already
free of DOM and Electron) to a location both the main and renderer builds
import, and gives main a task service that exposes task-level operations (render
a project as an outline, add a task, set a status, and so on) over the store's
atomic reads and writes. The GUI then calls that service over IPC in place of
the coarse load and save, the renderer reduced to a view, and the MCP server
calls the very same service in the same process. One authority over the data,
one write path.

The server is a small module in main. It uses the official MCP TypeScript SDK
and its Streamable-HTTP server transport, hosted on Node's built-in `http`
server (no Express) at a single `/mcp` path; the transport takes the Node
request and response objects. It constructs one `McpServer`, registers the tools
(each a call into the task service), and that is the whole of it. Because
`electron.vite.config.js` externalizes main's dependencies through
`externalizeDepsPlugin`, the SDK must be a production dependency so
electron-builder bundles it into the shipped `node_modules`.

Runtime is Node, reusing the existing model, not a Python port; the reason is a
single source of truth for the task-graph invariants (one incoming edge per
task, no cycles, at most one cursor per line, the splice-versus-subtree delete
reconnection), which are intricate and were still moving as the schema evolved.
A Python server would match the ParkviewLab org convention (`smalt-mcp` and the
others, the handbook's `mcp-server-conventions.md`) but would be a second copy
of those invariants that drifts. The org's scope model, the `--transport` shape,
`/health`, and REUSE are patterns a Node server can still wear.

## Binding and lifecycle

- Bind to loopback only, `127.0.0.1`, never `0.0.0.0`. The endpoint is reachable
  by local clients and by nothing on the network.
- Fixed default port `35899`, settable in `settings.json` (which the app keeps
  in userData). It sits below the macOS and Windows ephemeral ranges (both begin
  at 49152); it falls inside Linux's default ephemeral range (32768 to 60999),
  where a transient outbound socket could hold it at the moment the app starts,
  a low-probability case the fail-visible behavior covers.
- The port does not roam. A user registers the URL once with `claude mcp add`,
  so it must be stable across restarts; trying a port and falling back to the
  next free one would silently invalidate the registration. If the configured
  port is in use, the server does not start and says so plainly in the UI,
  leaving the user to choose another port and register it once.
- A single-instance lock (`app.requestSingleInstanceLock`), so only one process
  runs and therefore only one binds the port; a second launch focuses the
  existing window and exits. Good practice regardless of MCP.
- Starts when the app is ready, stops on quit; reachable at
  `http://127.0.0.1:35899/mcp` while running.
- Enabled by default, with a status indicator in the app that shows the URL,
  copies it, and can switch the server off.

## Security posture

No authentication on the loopback endpoint for v1, because Claude Code and the
other clients accept a bare localhost endpoint and a required token is friction
at exactly the moment it should just work. The guardrails instead are:

- loopback-only binding, so only local processes can reach it;
- the single-instance lock;
- DNS-rebinding protection on the transport (Host and Origin validation against
  an allowed list of localhost hosts), which closes the one avenue by which a
  malicious web page open in the browser could post to `127.0.0.1` on the port;
- permission scope tiers (read-write by default, with domain or subtree deletion
  held behind a destructive tier), borrowed from the org's servers;
- the validation gate every write already passes.

A per-install bearer token, generated once, kept in settings, shown in the UI,
and passed by the client as a header, is an easy later addition for defense in
depth and composes with all of the above.

## Access model, storage, concurrency

- Agents have access only while the app is running; this is accepted, and it
  keeps v1 simple, since with the app as the sole writer there is no
  file-watching or reconciliation to build.
- Storage stays plain JSON5 and markdown, not a database. The one genuine
  database advantage is concurrent-writer safety, and the single-writer topology
  gives that without the costs (native-module ABI friction, migrations, and the
  hazard of a live SQLite file corrupting under Dropbox or iCloud, which would
  forfeit the clean local-sync property); a database would not hold the
  graph invariants in any case.
- Because every task operation runs in the one main event loop as a read,
  validate, then atomic write, concurrent agent clients and the GUI's own edits
  serialize naturally, with no external lock; and because the authority is
  in-process, it can push a change event to the renderer after any mutation,
  whoever made it, so the open window reflects an agent's edits at once.

## Sequencing

1. Authority inversion is its own PR and the first PR, tested thoroughly: move
   the model to a shared location, add the main-process task service, re-point
   the renderer's IPC onto it, and reduce the renderer to a caller. No MCP code
   yet; this stands on its own merits and de-risks everything after it.
2. The MCP server on top: the SDK, the Streamable-HTTP endpoint, the binding and
   lifecycle, the status indicator, and the tools.

## Deferred

- stdio transport (a server the client spawns per session); HTTP is chosen
  because the user controls when the app is up, and stdio cannot attach to an
  already-running process.
- A Joplin-style LAN server mode. The better model than Joplin's two-database
  replication is a single authoritative store on a LAN box with the app as a
  remote client reading and writing through it, which falls out once task
  operations are one interface in main (local mode wires a file-backed adapter,
  server mode a remote-client adapter, and the server co-hosts the MCP
  endpoint). It assumes the server is reachable in shared mode and needs push or
  poll for live cross-client updates. Two questions were left open: whether
  offline use away from the server is needed, and whether live updates or
  refresh-on-demand suffices to begin with.
- True offline-on-many-devices, the replication model, a larger separate
  project not to be built on speculation.
- The per-install auth token.

## Client compatibility (verified July 2026)

- Claude Code, and the Claude Code embedded in the "Claude for Mac" desktop app,
  connect to a local HTTP MCP server registered once with
  `claude mcp add --transport http`, need no auth on a bare localhost endpoint,
  and automatically reconnect with exponential backoff when the app comes up,
  showing pending in `/mcp` and offering a manual retry after the backoff window
  is exhausted. This is the ideal client for the "connect whenever it is up"
  goal.
- opencode connects to a remote HTTP MCP server via an `opencode.json` entry
  (`{"type":"remote","url":...}`), no auth needed on loopback, but it does not
  auto-reconnect a server that was down; it must be started with the app already
  up, or the server manually reconnected or opencode restarted (known
  limitation, open feature requests).
- Hermes (Nous Research) is an MCP host supporting stdio and HTTP, configured in
  `~/.hermes/config.yaml` or via `hermes mcp add`, no auth needed on loopback;
  auto-reconnect is not documented, but a manual `/reload-mcp` command re-reads
  and reconnects.
- The Claude Desktop chat app (distinct from Claude Code) does not support
  localhost HTTP MCP; it is stdio-only locally, with its HTTP connectors aimed
  at remote HTTPS. Reaching this endpoint from it would need a stdio bridge, a
  separate future item.

## Open

- The tool surface an agent receives: exactly which tools, how the reads render
  a project as a legible outline, how the writes map onto the mutations, and how
  the scope tiers gate them. To be designed next.
- An optional discovery file (the current endpoint written to userData) so
  tooling can find the URL without the user copying it.
- A designed HTML companion for this notebook, per the dual-track documentation
  convention, if and when the design is promoted from notebook to a settled
  design document.

## Decisions log

- Runtime: Node, in-process in main, reusing the shared model. (settled)
- Transport: Streamable HTTP over Node `http`, single `/mcp` path. (settled)
- Storage: plain JSON5 and markdown files, not a database. (settled)
- Access: read-write with scope tiers; agents only while the app runs. (settled)
- Bind: loopback `127.0.0.1`, fixed port `35899` in `settings.json`, no roaming,
  fail-visible on conflict. (settled)
- Enablement: on by default, with a UI status indicator and an off control.
  (settled)
- Auth: none on the loopback endpoint for v1; token deferred. (settled)
- Hardening: single-instance lock and DNS-rebinding protection, both included.
  (settled)
- Sequencing: authority inversion is the first PR, tested thoroughly, before any
  MCP code. (settled)
- Tool surface. (open)
