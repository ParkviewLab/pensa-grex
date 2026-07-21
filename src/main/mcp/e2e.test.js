// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// End-to-end: a real MCP client (the SDK's own Client over its Streamable-HTTP
// transport) connects to the running service on loopback, performs the initialize
// handshake, lists the tools, and calls one, asserting the edit reached disk. This
// is the deterministic, in-process equivalent of registering the endpoint with
// `claude mcp add` and driving it from an agent.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  shell: { trashItem: async () => {} },
}))

const store = await import('../store.js')
const taskService = await import('../taskService.js')
const { createMcpService } = await import('./index.js')

let svc = null
let client = null

beforeEach(() => { h.userData = mkdtempSync(join(tmpdir(), 'pensagrex-e2e-')) })
afterEach(async () => {
  if (client) { try { await client.close() } catch { /* ignore */ } }
  if (svc) await svc.stop()
  rmSync(h.userData, { recursive: true, force: true })
  client = null; svc = null
})

// Start the service on an ephemeral loopback port at the given scope (the store is
// wrapped so only getMcpConfig is overridden; every other call hits the real store
// over the temp library), then connect a real SDK client to it.
async function connect(scope = 'destructive', notify) {
  const wrapped = { ...store, getMcpConfig: () => ({ enabled: true, port: 0, scope }) }
  svc = createMcpService({ taskService, store: wrapped, version: '9.9.9', notify })
  svc.start()
  const t0 = Date.now()
  while (!svc.status().running && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10))
  client = new Client({ name: 'pensagrex-e2e', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(svc.status().url)))
}

describe('MCP end to end (real SDK client over loopback HTTP)', () => {
  it('initializes, lists tools, and a tool call edits the forest on disk', async () => {
    store.createForest('HomeLab')
    store.setLastDomain('HomeLab')
    await connect('destructive')

    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('list_domains')
    expect(names).toContain('create_project')
    expect(names).toContain('delete_task') // destructive tier is on

    const res = await client.callTool({ name: 'create_project', arguments: { name: 'Overview' } })
    const out = JSON.parse(res.content[0].text)
    expect(out.id).toBeTruthy()

    // the write went through the authority to disk
    const dir = store.listDomains()[0].path
    const raw = taskService.readForest(dir).raw
    expect(Object.values(raw.tasks).some((t) => t.title === 'Overview' && t.kind === 'project')).toBe(true)
  })

  it('honours the read-only scope (no write tools are exposed)', async () => {
    store.createForest('HomeLab')
    store.setLastDomain('HomeLab')
    await connect('read-only')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('read_project')
    expect(names).not.toContain('create_project')
    expect(names).not.toContain('delete_domain')
  })

  it('pushes domain-changed after an MCP write (the live-update wrapper)', async () => {
    store.createForest('HomeLab')
    store.setLastDomain('HomeLab')
    const events = []
    await connect('read-write', (channel, data) => events.push([channel, data]))
    await client.callTool({ name: 'create_project', arguments: { name: 'Overview' } })
    expect(events.some(([c]) => c === 'pensagrex:domain-changed')).toBe(true)
  })
})
