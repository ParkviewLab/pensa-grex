// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The in-app MCP server (docs/mcp_ideas.md). While the app runs, the main
// process hosts an MCP endpoint on loopback, so a local agent reads and writes
// tasks through the very same taskService the GUI uses. One authority, one write
// path. Built on the official MCP SDK's Streamable-HTTP transport over Node's
// built-in http server (no Express), at a single /mcp path.
//
// Binding and hardening: 127.0.0.1 only, a fixed port that does not roam (a
// conflict fails visibly rather than moving), and DNS-rebinding protection (Host
// and Origin validated against a localhost allowlist) so a malicious web page
// cannot post to the port. No auth on the loopback endpoint for v1; a per-install
// token is a later addition (see the notebook).

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools } from './tools.js'

const HOST = '127.0.0.1'

// Guidance handed to every client at connect time (the MCP initialize
// `instructions`). PensaGrex is a live store the user and other agents can change
// at any moment, so a client must re-read current state before acting rather than
// trusting an earlier read (see docs/mcp_ideas.md).
const INSTRUCTIONS = [
  'PensaGrex is a LIVE task store: its user, and other agents, can change it at any moment.',
  'Never rely on an earlier read. Treat anything you read (domains, projects, flagged nodes,',
  'statuses, notes) as possibly stale the instant after you read it. Before you act, and always',
  'immediately before a write, re-read the current state with the relevant tool (find_flagged,',
  'list_projects, read_project, read_note) and resolve any description such as "the flagged one",',
  '"the current task", or "the one we discussed" against that fresh read, not against memory.',
  'Every write returns the affected id and the re-rendered outline; treat that returned state as',
  'your new ground truth. Nodes are addressed by id; titles and positions can change under you.',
].join(' ')

// Create the MCP service. `deps` = { taskService, store, version, notify }.
// `notify(channel, data)` (optional) lets the caller push a change to the open
// window after an agent edit, so the live view can update (see docs/mcp_ideas.md);
// it fires only for edits made HERE (the MCP path), never for the GUI's own edits,
// so the window never renders its own echo twice. Returns { start, stop, status,
// setEnabled }; nothing binds until start() is called.
export function createMcpService({ taskService, store, version, notify }) {
  let httpServer = null
  let boundPort = null
  let lastError = null
  const transports = new Map() // sessionId -> transport (one MCP session each)
  const emit = typeof notify === 'function' ? notify : () => {}

  // taskService, wrapped so a successful write pushes a domain-changed event for
  // the live view. Reads pass through untouched.
  const notifyingTaskService = {
    readForest: (dir) => taskService.readForest(dir),
    taskOp: (dir, op, args) => {
      const res = taskService.taskOp(dir, op, args)
      if (!res.error) emit('pensagrex:domain-changed', { dir })
      return res
    },
  }

  // A fresh McpServer per session, with the tool surface registered at the scope
  // configured at this moment (scope is a startup-time gate; see the notebook).
  function buildServer() {
    const { scope } = store.getMcpConfig()
    const server = new McpServer({ name: 'pensagrex', version }, { instructions: INSTRUCTIONS })
    registerTools(server, { taskService: notifyingTaskService, store, notify: emit }, scope)
    return server
  }

  function hardening(port) {
    return {
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
      allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    }
  }

  async function handleMcp(req, res) {
    const sid = req.headers['mcp-session-id']
    let transport = sid ? transports.get(sid) : null
    if (!transport) {
      if (req.method !== 'POST') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No session; POST an initialize request first.' } }))
        return
      }
      // A new session: create the transport (it mints the session id on
      // initialize) and its own McpServer, then connect them. The port is the
      // one we actually bound, so the Host/Origin allowlist matches.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        ...hardening(boundPort),
        onsessioninitialized: (id) => transports.set(id, transport),
      })
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
      await buildServer().connect(transport)
    }
    await transport.handleRequest(req, res)
  }

  function onRequest(req, res) {
    let url
    try { url = new URL(req.url, `http://${req.headers.host || HOST}`) } catch { res.writeHead(400); res.end(); return }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name: 'pensagrex', version }))
      return
    }
    if (url.pathname !== '/mcp') { res.writeHead(404); res.end(); return }
    handleMcp(req, res).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: (e && e.message) || String(e) } }))
      }
    })
  }

  // Start the endpoint if enabled. A port conflict is recorded and surfaced (no
  // roaming to another port, which would silently invalidate a registered URL).
  function start() {
    if (httpServer) return status()
    const cfg = store.getMcpConfig()
    if (!cfg.enabled) { lastError = null; return status() }
    lastError = null
    boundPort = cfg.port
    const srv = http.createServer(onRequest)
    // The allowlist (Host/Origin) must key off the port we actually bound, which
    // differs from cfg.port when it is 0 (an OS-assigned ephemeral port, used in
    // tests). Requests only arrive after 'listening', so this is set in time.
    srv.on('listening', () => { boundPort = srv.address().port })
    srv.on('error', (e) => {
      lastError = e.code === 'EADDRINUSE'
        ? `port ${cfg.port} is already in use; choose another (mcpPort in settings.json) and restart`
        : ((e && e.message) || String(e))
      if (httpServer === srv) httpServer = null
    })
    httpServer = srv
    srv.listen(cfg.port, HOST)
    return status()
  }

  async function stop() {
    for (const t of transports.values()) { try { await t.close() } catch { /* ignore */ } }
    transports.clear()
    if (httpServer) {
      const srv = httpServer
      httpServer = null
      await new Promise((resolve) => srv.close(() => resolve()))
    }
    return status()
  }

  async function setEnabled(enabled) {
    const res = store.setMcpEnabled(enabled)
    if (res.error) return { error: res.error }
    return enabled ? start() : stop()
  }

  function running() { return !!httpServer && httpServer.listening }
  function status() {
    const cfg = store.getMcpConfig()
    const addr = running() ? httpServer.address() : null
    const port = addr ? addr.port : cfg.port
    return {
      enabled: cfg.enabled,
      running: running(),
      url: `http://${HOST}:${port}/mcp`,
      port,
      scope: cfg.scope,
      error: lastError,
    }
  }

  return { start, stop, status, setEnabled }
}
