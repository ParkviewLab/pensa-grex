// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Drives the MCP tool surface against the real task authority (store + taskService
// over a temp library, only electron's app.getPath mocked). A fake McpServer
// captures each tool's callback so the test can invoke it directly and assert the
// task-service/store effect, without the HTTP/MCP transport in the loop.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  shell: { trashItem: async () => {} },
}))

const store = await import('../store.js')
const taskService = await import('../taskService.js')
const { registerTools } = await import('./tools.js')

beforeEach(() => { h.userData = mkdtempSync(join(tmpdir(), 'pensagrex-mcp-')) })
afterEach(() => { rmSync(h.userData, { recursive: true, force: true }) })

function fakeServer(scope) {
  const tools = new Map()
  registerTools({ registerTool: (name, _config, cb) => tools.set(name, cb) }, { taskService, store }, scope)
  return {
    has: (n) => tools.has(n),
    call: async (n, args = {}) => {
      const cb = tools.get(n)
      if (!cb) throw new Error('tool not registered: ' + n)
      return cb(args, {})
    },
  }
}
const data = (res) => JSON.parse(res.content[0].text)

describe('tool registration by scope tier', () => {
  it('read-only registers reads only', () => {
    const s = fakeServer('read-only')
    expect(s.has('list_domains')).toBe(true)
    expect(s.has('read_project')).toBe(true)
    expect(s.has('add_task')).toBe(false)
    expect(s.has('delete_task')).toBe(false)
  })
  it('read-write adds writes but holds destructive back', () => {
    const s = fakeServer('read-write')
    expect(s.has('add_task')).toBe(true)
    expect(s.has('create_project')).toBe(true)
    expect(s.has('delete_task')).toBe(false)
    expect(s.has('delete_domain')).toBe(false)
  })
  it('destructive adds the delete tools', () => {
    const s = fakeServer('destructive')
    expect(s.has('delete_task')).toBe(true)
    expect(s.has('delete_domain')).toBe(true)
  })
})

describe('tools drive the task authority', () => {
  let s
  beforeEach(() => {
    store.createForest('HomeLab')
    store.setLastDomain('HomeLab') // so tools default to the open domain
    s = fakeServer('destructive')
  })

  it('list_domains returns the library', async () => {
    expect(data(await s.call('list_domains')).map((d) => d.name)).toEqual(['HomeLab'])
  })

  it('create_project -> add_task -> set_status, each persisted', async () => {
    const cp = data(await s.call('create_project', { name: 'Overview' }))
    expect(cp.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.find((p) => p.title === 'Overview' && p.root)).toBeTruthy()

    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', mode: 'continue', title: 'First task' }))
    expect(at.id).toBeTruthy()
    expect(at.outline).toContain('First task')

    const ss = data(await s.call('set_status', { node_id: at.id, status: 'completed' }))
    expect(ss.outline).toContain('[x] First task')

    const rp = data(await s.call('read_project', {}))
    expect(rp.outline).toContain('First task')
    expect(rp.nodes.find((n) => n.id === at.id).status).toBe('completed')
  })

  it('surfaces an invariant error (status on a project) as a tool error', async () => {
    const cp = data(await s.call('create_project', { name: 'P' }))
    const res = await s.call('set_status', { node_id: cp.id, status: 'completed' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/project/)
  })

  it('set_note writes the note file and read_note reads it back', async () => {
    const cp = data(await s.call('create_project', { name: 'Noted' }))
    await s.call('set_note', { node_id: cp.id, content: '# hello\n' })
    expect(data(await s.call('read_note', { node_id: cp.id })).content).toBe('# hello\n')
  })

  it('copy_project -> paste_as_tree duplicates the tree', async () => {
    const cp = data(await s.call('create_project', { name: 'Src' }))
    await s.call('add_task', { target_id: cp.id, position: 'above', mode: 'continue', title: 'A task' })
    const clip = data(await s.call('copy_project', { node_id: cp.id }))
    const pasted = data(await s.call('paste_as_tree', { clip }))
    expect(pasted.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.filter((p) => p.root)).toHaveLength(2)
  })

  it('delete_task removes the node', async () => {
    const cp = data(await s.call('create_project', { name: 'D' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', mode: 'continue', title: 'gone' }))
    const del = data(await s.call('delete_task', { node_id: at.id, mode: 'subtree' }))
    expect(del.deleted).toBe(at.id)
    expect(data(await s.call('read_project', {})).nodes.find((n) => n.id === at.id)).toBeUndefined()
  })

  it('find_flagged returns flagged nodes', async () => {
    const cp = data(await s.call('create_project', { name: 'F' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', mode: 'continue', title: 'flag me' }))
    await s.call('toggle_flag', { node_id: at.id })
    const ff = data(await s.call('find_flagged', {}))
    expect(ff.flagged.map((n) => n.id)).toContain(at.id)
  })

  it('resolves a domain by name and errors on an unknown one', async () => {
    store.createForest('Work')
    expect(data(await s.call('list_projects', { domain: 'Work' })).projects).toEqual([])
    expect((await s.call('list_projects', { domain: 'Nope' })).isError).toBe(true)
  })
})

describe('tools notify on non-forest changes', () => {
  // A fresh registerTools with a notify spy (the real taskService, so taskOp does
  // not notify here; that wrapper is tested end to end in e2e.test.js).
  function serverWithNotify() {
    const events = []
    const tools = new Map()
    registerTools({ registerTool: (n, _c, cb) => tools.set(n, cb) }, { taskService, store, notify: (ch) => events.push(ch) }, 'destructive')
    return { events, call: (n, args = {}) => tools.get(n)(args, {}) }
  }

  it('create_domain notifies domains-changed; an existing-note set_note notifies domain-changed', async () => {
    const s = serverWithNotify()
    await s.call('create_domain', { name: 'Work' })
    expect(s.events).toContain('pensagrex:domains-changed')

    store.setLastDomain('Work')
    const cp = JSON.parse((await s.call('create_project', { name: 'P' })).content[0].text)
    await s.call('set_note', { node_id: cp.id, content: 'first' }) // records the note (forest change)
    s.events.length = 0
    await s.call('set_note', { node_id: cp.id, content: 'second' }) // note-only change
    expect(s.events).toContain('pensagrex:domain-changed')
  })
})
