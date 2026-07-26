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
  registerTools({ registerTool: (name, _config, cb) => tools.set(name, cb), registerPrompt: () => {} }, { taskService, store }, scope)
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
    expect(s.has('create_plan')).toBe(true)
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
    store.createDomain('HomeLab')
    store.setLastDomain('HomeLab') // so tools default to the open domain
    s = fakeServer('destructive')
  })

  it('list_domains returns the library', async () => {
    expect(data(await s.call('list_domains')).map((d) => d.name)).toEqual(['HomeLab'])
  })

  it('create_plan -> add_task -> set_status, each persisted', async () => {
    const cp = data(await s.call('create_plan', { name: 'Overview' }))
    expect(cp.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.find((p) => p.title === 'Overview' && p.root)).toBeTruthy()

    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'First task' }))
    expect(at.id).toBeTruthy()
    expect(at.outline).toContain('First task')

    const ss = data(await s.call('set_status', { node_id: at.id, status: 'completed' }))
    expect(ss.outline).toContain('[x] First task')

    const rp = data(await s.call('read_project', {}))
    expect(rp.outline).toContain('First task')
    expect(rp.nodes.find((n) => n.id === at.id).status).toBe('completed')
  })

  it('surfaces an invariant error (status on a project) as a tool error', async () => {
    const cp = data(await s.call('create_plan', { name: 'P' }))
    const res = await s.call('set_status', { node_id: cp.id, status: 'completed' })
    expect(res.isError).toBe(true)
    // The refusal now names what does have a status rather than what does not, since
    // two kinds lack one: a project node and a terminus.
    expect(res.content[0].text).toMatch(/only a task has a status/)
  })

  it('set_note writes the note file and read_note reads it back', async () => {
    const cp = data(await s.call('create_plan', { name: 'Noted' }))
    await s.call('set_note', { node_id: cp.id, content: '# hello\n' })
    expect(data(await s.call('read_note', { node_id: cp.id })).content).toBe('# hello\n')
  })

  it('copy_project -> paste_as_plan duplicates the tree', async () => {
    const cp = data(await s.call('create_plan', { name: 'Src' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'A task' }))
    const clip = data(await s.call('copy_project', { node_id: cp.id }))
    // Termini: the subtree under a plan's base now includes the terminus closing it,
    // so the clip carries three nodes, not two. Still asserted as the exact set, and
    // still under the key pasteAsTree reads, `nodes`: the record-wide tasks -> nodes
    // rename reaches the clip snapshot too, so a producer that emits the old key (or
    // one that drops the close) fails here rather than downstream.
    const close = data(await s.call('read_project', {})).nodes.find((n) => n.kind === 'terminus')
    expect(close.id).toBeTruthy()
    expect(Object.keys(clip.nodes || {}).sort()).toEqual([cp.id, at.id, close.id].sort())
    const pasted = data(await s.call('paste_as_plan', { clip }))
    expect(pasted.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.filter((p) => p.root)).toHaveLength(2)
    // Termini: duplicating the tree now means duplicating its brackets, so the pasted
    // copy carries a close of its own, freshly identified rather than the source's.
    const pastedNodes = data(await s.call('read_project', { project_id: pasted.id })).nodes
    const pastedClose = pastedNodes.find((n) => n.kind === 'terminus')
    expect(pastedClose).toBeTruthy()
    expect(pastedClose.id).not.toBe(close.id)
  })

  it('delete_task removes the node', async () => {
    const cp = data(await s.call('create_plan', { name: 'D' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'gone' }))
    const del = data(await s.call('delete_task', { node_id: at.id, mode: 'subtree' }))
    expect(del.deleted).toBe(at.id)
    expect(data(await s.call('read_project', {})).nodes.find((n) => n.id === at.id)).toBeUndefined()
  })

  it('find_flagged returns flagged nodes', async () => {
    const cp = data(await s.call('create_plan', { name: 'F' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'flag me' }))
    await s.call('toggle_flag', { node_id: at.id })
    const ff = data(await s.call('find_flagged', {}))
    expect(ff.flagged.map((n) => n.id)).toContain(at.id)
  })

  // The v3 verbs. A plan is created as a pair, so a fresh one already has an edge between
  // its base and its close, and that edge is what these name.
  it('open_branch creates a branch with a task inside it and a return of its own', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const first = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'Write it' }))
    const br = data(await s.call('open_branch', { edge_id: first.id, title: 'Review it' }))
    const nodes = data(await s.call('read_project', {})).nodes
    const foot = nodes.find((n) => n.title === 'Review it')
    expect(foot).toBeTruthy()
    expect(nodes.find((n) => n.id === first.id).branches.map((b) => b.child)).toEqual([foot.id])
    expect(br.id).toBe(foot.id)
    // Its return rejoins at the very edge it left, which is the smallest legal branch, so
    // the outline says nothing about it: the nesting has already said where it runs.
    expect(br.outline).not.toContain('rejoins')
  })

  it('set_merge_point widens a branch, and the outline then says where it rejoins', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const br = data(await s.call('open_branch', { edge_id: one.id, title: 'Aside' }))
    const moved = data(await s.call('set_merge_point', { branch_id: br.id, merge_point_id: two.id }))
    expect(moved.outline).toContain('rejoins the trunk above "Two"')
  })

  it('set_merge_point refuses a merge below the branch point, and says so', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const br = data(await s.call('open_branch', { edge_id: two.id, title: 'Aside' }))
    const res = await s.call('set_merge_point', { branch_id: br.id, merge_point_id: one.id })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/below its own branch point/)
  })

  it('open_branch refuses a plan\'s closing terminus, which has no edge above it', async () => {
    await s.call('create_plan', { name: 'Ship' })
    const close = data(await s.call('read_project', {})).nodes.find((n) => n.kind === 'terminus')
    const res = await s.call('open_branch', { edge_id: close.id, title: 'Nowhere' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/no edge above it/)
  })

  it('wrap_run names a run as a sub-project, and unwrap_project takes it away again', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const wrapped = data(await s.call('wrap_run', { from_id: one.id, to_id: two.id, title: 'Delivery' }))
    let projects = data(await s.call('list_projects', {})).projects
    expect(projects.find((p) => p.title === 'Delivery' && !p.root)).toBeTruthy()
    // A scope is a pair, so wrapping added a close as well as an opening.
    const termini = data(await s.call('read_project', {})).nodes.filter((n) => n.kind === 'terminus')
    expect(termini).toHaveLength(2)

    await s.call('unwrap_project', { project_id: wrapped.id })
    projects = data(await s.call('list_projects', {})).projects
    expect(projects.find((p) => p.title === 'Delivery')).toBeUndefined()
    expect(data(await s.call('read_project', {})).nodes.filter((n) => n.kind === 'terminus')).toHaveLength(1)
    // Nothing inside the scope moved; only the scope went.
    expect(data(await s.call('read_project', {})).nodes.map((n) => n.title)).toContain('Two')
  })

  it('unwrap_project refuses a plan\'s base, since that is the plan itself', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const res = await s.call('unwrap_project', { project_id: cp.id })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/cannot be unwrapped/)
  })

  it('detach_to_plan makes a sub-project a plan of its own', async () => {
    const cp = data(await s.call('create_plan', { name: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const wrapped = data(await s.call('wrap_run', { from_id: one.id, title: 'Delivery' }))
    await s.call('detach_to_plan', { node_id: wrapped.id })
    const projects = data(await s.call('list_projects', {})).projects
    expect(projects.filter((p) => p.root).map((p) => p.title).sort()).toEqual(['Delivery', 'Ship'])
  })

  it('resolves a domain by name and errors on an unknown one', async () => {
    store.createDomain('Work')
    expect(data(await s.call('list_projects', { domain: 'Work' })).projects).toEqual([])
    expect((await s.call('list_projects', { domain: 'Nope' })).isError).toBe(true)
  })
})

describe('tools notify on changes the op path does not cover', () => {
  // A fresh registerTools with a notify spy (the real taskService, so runOp does
  // not notify here; that wrapper is tested end to end in e2e.test.js).
  function serverWithNotify() {
    const events = []
    const tools = new Map()
    registerTools({ registerTool: (n, _c, cb) => tools.set(n, cb), registerPrompt: () => {} }, { taskService, store, notify: (ch) => events.push(ch) }, 'destructive')
    return { events, call: (n, args = {}) => tools.get(n)(args, {}) }
  }

  it('create_domain notifies domains-changed; an existing-note set_note notifies domain-changed', async () => {
    const s = serverWithNotify()
    await s.call('create_domain', { name: 'Work' })
    expect(s.events).toContain('pensagrex:domains-changed')

    store.setLastDomain('Work')
    const cp = JSON.parse((await s.call('create_plan', { name: 'P' })).content[0].text)
    await s.call('set_note', { node_id: cp.id, content: 'first' }) // records the note (a record change)
    s.events.length = 0
    await s.call('set_note', { node_id: cp.id, content: 'second' }) // note-only change
    expect(s.events).toContain('pensagrex:domain-changed')
  })
})
