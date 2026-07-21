// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Smoke test for the MCP service lifecycle: it binds a real loopback HTTP server
// on an ephemeral port, serves /health, and stops cleanly. The full MCP protocol
// handshake is exercised end to end against a real client in the PR verification;
// here we assert the server plumbing and the enabled/disabled gate.

import { describe, it, expect, afterEach } from 'vitest'
import { createMcpService } from './index.js'

function stubStore(cfg) {
  return {
    getMcpConfig: () => ({ enabled: true, port: 0, scope: 'read-only', ...cfg }),
    setMcpEnabled: (enabled) => ({ ok: true, enabled }),
    listDomains: () => [],
    getSettings: () => ({ lastDomain: null }),
  }
}
const taskServiceStub = { readForest: () => ({ error: 'n/a' }), taskOp: () => ({ error: 'n/a' }) }

let svc
afterEach(async () => { if (svc) await svc.stop(); svc = null })

async function waitRunning(s, ms = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (s.status().running) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('server did not start in time')
}

describe('MCP service lifecycle', () => {
  it('starts on loopback, serves /health, and stops', async () => {
    svc = createMcpService({ taskService: taskServiceStub, store: stubStore(), version: '9.9.9' })
    svc.start()
    await waitRunning(svc)

    const st = svc.status()
    expect(st.running).toBe(true)
    expect(st.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

    const res = await fetch(`http://127.0.0.1:${st.port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, name: 'pensagrex', version: '9.9.9' })

    await svc.stop()
    expect(svc.status().running).toBe(false)
  })

  it('does not bind when disabled', () => {
    svc = createMcpService({ taskService: taskServiceStub, store: stubStore({ enabled: false }), version: '1' })
    const st = svc.start()
    expect(st.running).toBe(false)
    expect(st.enabled).toBe(false)
  })
})
