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

// Create the MCP service. `deps` = { taskService, store, version }. Returns
// { start, stop, status, setEnabled }; nothing binds until start() is called.
export function createMcpService({ taskService, store, version }) {
  let httpServer = null
  let boundPort = null
  let lastError = null
  const transports = new Map() // sessionId -> transport (one MCP session each)

  // A fresh McpServer per session, with the tool surface registered at the scope
  // configured at this moment (scope is a startup-time gate; see the notebook).
  function buildServer() {
    const { scope } = store.getMcpConfig()
    const server = new McpServer({ name: 'pensagrex', version })
    registerTools(server, { taskService, store }, scope)
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
