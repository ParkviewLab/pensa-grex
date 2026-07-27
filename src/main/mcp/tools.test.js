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
    for (const t of ['read_domain', 'read_project', 'read_task']) expect(s.has(t)).toBe(true)
    expect(s.has('add_task')).toBe(false)
    expect(s.has('delete_node')).toBe(false)
  })
  it('names the writes for the kind they take', () => {
    const s = fakeServer('read-write')
    expect(s.has('move_task')).toBe(true)
    expect(s.has('move_project')).toBe(true)
    // The old names, which said node and subtree where the model says task and project.
    expect(s.has('move_node')).toBe(false)
    expect(s.has('move_subtree')).toBe(false)
  })
  it('read-write adds writes but holds destructive back', () => {
    const s = fakeServer('read-write')
    expect(s.has('add_task')).toBe(true)
    expect(s.has('create_plan')).toBe(true)
    expect(s.has('delete_node')).toBe(false)
    expect(s.has('delete_domain')).toBe(false)
  })
  it('destructive adds the delete tools', () => {
    const s = fakeServer('destructive')
    expect(s.has('delete_node')).toBe(true)
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
    expect(data(await s.call('list_domains')).domains.map((d) => d.name)).toEqual(['HomeLab'])
  })

  it('create_plan -> add_task -> set_status, each persisted', async () => {
    const cp = data(await s.call('create_plan', { title: 'Overview' }))
    expect(cp.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.find((p) => p.title === 'Overview' && p.is_root)).toBeTruthy()

    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'First task' }))
    expect(at.id).toBeTruthy()
    expect(at.outline).toContain('First task')

    const ss = data(await s.call('set_status', { node_id: at.id, status: 'completed' }))
    expect(ss.outline).toContain('[x] First task')

    const rp = data(await s.call('read_domain', {}))
    expect(rp.outline).toContain('First task')
    expect(rp.nodes.find((n) => n.id === at.id).status).toBe('completed')
  })

  it('surfaces an invariant error (status on a project) as a tool error', async () => {
    const cp = data(await s.call('create_plan', { title: 'P' }))
    const res = await s.call('set_status', { node_id: cp.id, status: 'completed' })
    expect(res.isError).toBe(true)
    // The refusal now names what does have a status rather than what does not, since
    // two kinds lack one: a project node and a terminus.
    expect(res.content[0].text).toMatch(/only a task has a status/)
  })

  it('set_note writes the note file and read_note reads it back', async () => {
    const cp = data(await s.call('create_plan', { title: 'Noted' }))
    await s.call('set_note', { node_id: cp.id, content: '# hello\n' })
    expect(data(await s.call('read_note', { node_id: cp.id })).content).toBe('# hello\n')
  })

  it('names the file and the text differently wherever either is returned', async () => {
    // One name per thing: note_file is what the note is called on disk, content is what it says.
    // They were both called "note" in different tools, so a client could hold a filename and a
    // markdown document under one key and reconcile neither.
    const cp = data(await s.call('create_plan', { title: 'Noted' }))
    const first = data(await s.call('set_note', { node_id: cp.id, content: '# hello\n' }))
    expect(first.note_file).toMatch(/\.md$/) // reported on the write that created it, too
    const again = data(await s.call('set_note', { node_id: cp.id, content: '# hello again\n' }))
    expect(again.note_file).toBe(first.note_file) // and on every write after

    const read = data(await s.call('read_note', { node_id: cp.id }))
    expect(read.note_file).toBe(first.note_file)
    expect(read.content).toBe('# hello again\n')

    const task = data(await s.call('read_task', { task: data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'T' })).id }))
    expect(task.has_note).toBe(false)
    expect(task.note_file).toBeNull()

    const withText = data(await s.call('read_domain', { include_notes: true })).nodes.find((n) => n.id === cp.id)
    expect(withText.has_note).toBe(true)
    expect(withText.note_file).toBe(first.note_file)
    expect(withText.content).toBe('# hello again\n')
  })

  it('copy_project -> paste_as_plan duplicates the tree', async () => {
    const cp = data(await s.call('create_plan', { title: 'Src' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'A task' }))
    const clip = data(await s.call('copy_project', { project: cp.id }))
    // Termini: the subtree under a plan's base now includes the terminus closing it,
    // so the clip carries three nodes, not two. Still asserted as the exact set, and
    // still under the key pasteAsTree reads, `nodes`: the record-wide tasks -> nodes
    // rename reaches the clip snapshot too, so a producer that emits the old key (or
    // one that drops the close) fails here rather than downstream.
    const close = data(await s.call('read_domain', {})).nodes.find((n) => n.kind === 'terminus')
    expect(close.id).toBeTruthy()
    expect(Object.keys(clip.nodes || {}).sort()).toEqual([cp.id, at.id, close.id].sort())
    const pasted = data(await s.call('paste_as_plan', { clip }))
    expect(pasted.id).toBeTruthy()
    const lp = data(await s.call('list_projects', {}))
    expect(lp.projects.filter((p) => p.is_root)).toHaveLength(2)
    // Termini: duplicating the tree now means duplicating its brackets, so the pasted
    // copy carries a close of its own, freshly identified rather than the source's.
    const pastedNodes = data(await s.call('read_project', { project: pasted.id })).nodes
    const pastedClose = pastedNodes.find((n) => n.kind === 'terminus')
    expect(pastedClose).toBeTruthy()
    expect(pastedClose.id).not.toBe(close.id)
  })

  it('reads and clips a sub-project as far as its own close, and no further', async () => {
    // A plan whose trunk reads P -> Inner -> [Sub] -> Later -> close, with Sub wrapped
    // around Inner. Following `next` from Sub reaches Later and the plan's close as well;
    // both tools take the extent instead, so a client asking about Sub is told about Sub.
    const cp = data(await s.call('create_plan', { title: 'Src' }))
    const later = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'Later' }))
    const inner = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'Inner' }))
    await s.call('wrap_run', { from_id: inner.id, title: 'Sub' })
    const all = data(await s.call('read_domain', {})).nodes
    const sub = all.find((n) => n.title === 'Sub')
    expect(sub).toBeTruthy()

    const scoped = data(await s.call('read_project', { project: sub.id }))
    expect(scoped.nodes.map((n) => n.title || n.kind).sort()).toEqual(['Inner', 'Sub', 'terminus'])
    expect(scoped.outline).toContain('Inner')
    expect(scoped.outline).not.toContain('Later')

    const clip = data(await s.call('copy_project', { project: sub.id }))
    expect(Object.keys(clip.nodes)).toHaveLength(3) // the pair and what is between them
    expect(Object.values(clip.nodes).some((n) => n.id === later.id)).toBe(false)
    // and the clip is a whole plan, so it pastes as one
    const pasteRes = await s.call('paste_as_plan', { clip })
    if (pasteRes.isError) throw new Error('paste refused: ' + pasteRes.content[0].text)
    const pasted = data(pasteRes)
    expect(data(await s.call('read_project', { project: pasted.id })).outline).toContain('Inner')
  })

  // A plan whose trunk reads Src -> Inner -> [Sub] -> Later -> close, Sub wrapped around
  // Inner: a sub-project with work above its close, plus a task inside it and one outside.
  async function nested() {
    const plan = data(await s.call('create_plan', { title: 'Src' }))
    const later = data(await s.call('add_task', { target_id: plan.id, position: 'above', title: 'Later' }))
    const inner = data(await s.call('add_task', { target_id: plan.id, position: 'above', title: 'Inner' }))
    await s.call('wrap_run', { from_id: inner.id, title: 'Sub' })
    const all = data(await s.call('read_domain', {})).nodes
    return {
      plan: plan.id,
      later: later.id,
      inner: inner.id,
      sub: all.find((n) => n.title === 'Sub').id,
      close: all.find((n) => n.kind === 'terminus' && n.next).id, // Sub's close, which has Later above it
    }
  }

  it('reads one task, with the project and the plan it sits in', async () => {
    const { inner, later, sub, plan } = await nested()
    const t = data(await s.call('read_task', { task: inner }))
    expect(t.title).toBe('Inner')
    expect(t.kind).toBe('task')
    expect(t.status).toBe('todo')
    // The two fields that make a read_plan tool unnecessary: one task id reaches its scope
    // and its plan in one further call.
    expect(t.enclosing_project_id).toBe(sub)
    expect(t.root_project_id).toBe(plan)
    // Later sits outside Sub, above its close, so its scope is the plan itself.
    const out = data(await s.call('read_task', { task: later }))
    expect(out.enclosing_project_id).toBe(plan)
    expect(out.root_project_id).toBe(plan)
  })

  it('reads a project with the scope it sits in, and a plan base with none', async () => {
    const { sub, plan } = await nested()
    const p = data(await s.call('read_project', { project: sub }))
    expect(p.id).toBe(sub) // the same key every other tool uses for what it acted on
    expect(p.enclosing_project_id).toBe(plan)
    expect(p.root_project_id).toBe(plan)
    const base = data(await s.call('read_project', { project: plan }))
    expect(base.enclosing_project_id).toBeNull() // a plan's base sits in no scope
    expect(base.root_project_id).toBe(plan)
  })

  it('takes a title as readily as an id, titles being domain-unique', async () => {
    const { inner, sub } = await nested()
    expect(data(await s.call('read_task', { task: 'Inner' })).id).toBe(inner)
    expect(data(await s.call('read_project', { project: 'Sub' })).id).toBe(sub)
    const miss = await s.call('read_task', { task: 'Nowhere' })
    expect(miss.isError).toBe(true)
    expect(miss.content[0].text).toMatch(/nothing in this domain has the id or title "Nowhere"/)
  })

  it('refuses the wrong kind and names the tool that reads it', async () => {
    const { inner, sub, close } = await nested()
    const asProject = await s.call('read_project', { project: inner })
    expect(asProject.isError).toBe(true)
    expect(asProject.content[0].text).toMatch(/is a task; use read_task/)

    const asTask = await s.call('read_task', { task: sub })
    expect(asTask.isError).toBe(true)
    expect(asTask.content[0].text).toMatch(/is a project; use read_project/)

    // A close is one half of a pair, so both reads send the caller to the project it closes.
    for (const call of [s.call('read_task', { task: close }), s.call('read_project', { project: close })]) {
      const res = await call
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toMatch(new RegExp(`one half of a pair.*read_project\\("${sub}"\\)`))
    }

    // And a clip is a plan, so only a project may be clipped. Its refusal is its own: neither
    // read tool clips, so pointing at one would send the caller nowhere useful.
    const clip = await s.call('copy_project', { project: inner })
    expect(clip.isError).toBe(true)
    expect(clip.content[0].text).toMatch(/only a project can be clipped/)
    expect(clip.content[0].text).not.toMatch(/use read_task/) // it names the project to clip, not a tool that cannot
  })

  it('refuses to splice a plan\'s base, where the mode would be ignored and the plan would go', async () => {
    // Nothing precedes a base, so there is no predecessor to reconnect its successor to and the
    // operation falls through to deleting the whole plan. That is the right answer to "delete
    // this plan" and the wrong one to "unwrap this plan", which is what splice asks for, and
    // there is no undo anywhere in the app.
    const cp = data(await s.call('create_plan', { title: 'Whole' }))
    await s.call('add_task', { target_id: cp.id, position: 'above', title: 'Inside' })
    const res = await s.call('delete_node', { node_id: cp.id, mode: 'splice' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/cannot be spliced/)
    expect(res.content[0].text).toMatch(/unwrap_project/)
    // and nothing was touched
    expect(data(await s.call('read_domain', {})).nodes.map((n) => n.title)).toContain('Inside')
  })

  it('reports the title a write ended with, which is not always the one asked for', async () => {
    // Titles are unique within a domain, so the second "P" becomes "P-1"; since a title also
    // addresses a node on the reads, a silent rename is a silently changed address.
    const first = data(await s.call('create_plan', { title: 'P' }))
    const second = data(await s.call('create_plan', { title: 'P' }))
    expect(first.title).toBe('P')
    expect(second.title).toBe('P-1')
    expect(data(await s.call('read_project', { project: 'P-1' })).id).toBe(second.id)
    // and a rename reports it too
    const renamed = data(await s.call('set_title', { node_id: second.id, title: 'P' }))
    expect(renamed.title).toBe('P-1')
  })

  it('delete_node removes the node', async () => {
    const cp = data(await s.call('create_plan', { title: 'D' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'gone' }))
    const del = data(await s.call('delete_node', { node_id: at.id, mode: 'subtree' }))
    expect(del.id).toBe(at.id)
    expect(del.deleted).toBe(true)
    expect(data(await s.call('read_domain', {})).nodes.find((n) => n.id === at.id)).toBeUndefined()
  })

  it('find_flagged returns flagged nodes', async () => {
    const cp = data(await s.call('create_plan', { title: 'F' }))
    const at = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'flag me' }))
    await s.call('toggle_flag', { node_id: at.id })
    const ff = data(await s.call('find_flagged', {}))
    expect(ff.flagged.map((n) => n.id)).toContain(at.id)
  })

  // The v3 verbs. A plan is created as a pair, so a fresh one already has an edge between
  // its base and its close, and that edge is what these name.
  it('open_branch creates a branch with a task inside it and a return of its own', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const first = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'Write it' }))
    const br = data(await s.call('open_branch', { position: 'above', node_id: first.id, title: 'Review it' }))
    const nodes = data(await s.call('read_domain', {})).nodes
    const foot = nodes.find((n) => n.title === 'Review it')
    expect(foot).toBeTruthy()
    expect(nodes.find((n) => n.id === first.id).branches.map((b) => b.child)).toEqual([foot.id])
    expect(br.id).toBe(foot.id)
    // Its return rejoins at the very edge it left, which is the smallest legal branch, so
    // the outline says nothing about it: the nesting has already said where it runs.
    expect(br.outline).not.toContain('rejoins')
  })

  it('set_merge_point widens a branch, and the outline then says where it rejoins', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const br = data(await s.call('open_branch', { position: 'above', node_id: one.id, title: 'Aside' }))
    const moved = data(await s.call('set_merge_point', { branch_id: br.id, merge_point_id: two.id }))
    expect(moved.outline).toContain('rejoins the trunk above "Two"')
  })

  it('set_merge_point refuses a merge below the branch point, and says so', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const br = data(await s.call('open_branch', { position: 'above', node_id: two.id, title: 'Aside' }))
    const res = await s.call('set_merge_point', { branch_id: br.id, merge_point_id: one.id })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/below its own branch point/)
  })

  it('opens a branch below a node as well as above it, as the app does', async () => {
    // The app has offered "Add branch below" throughout and the tool could only say "above",
    // so an agent had to name the predecessor to mean the same thing. position now matches
    // add_task's exactly, including the one refusal.
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const below = data(await s.call('open_branch', { node_id: one.id, position: 'below', title: 'Before it' }))
    expect(below.id).toBeTruthy()
    expect(data(await s.call('read_task', { task: below.id })).title).toBe('Before it')

    const refused = await s.call('open_branch', { node_id: cp.id, position: 'below', title: 'Nowhere' })
    expect(refused.isError).toBe(true) // nothing precedes a plan's base
  })

  it('open_branch refuses a plan\'s closing terminus, which has no edge above it', async () => {
    await s.call('create_plan', { title: 'Ship' })
    const close = data(await s.call('read_domain', {})).nodes.find((n) => n.kind === 'terminus')
    const res = await s.call('open_branch', { position: 'above', node_id: close.id, title: 'Nowhere' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/no edge above it/)
  })

  it('wrap_run names a run as a sub-project, and unwrap_project takes it away again', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const two = data(await s.call('add_task', { target_id: one.id, position: 'above', title: 'Two' }))
    const wrapped = data(await s.call('wrap_run', { from_id: one.id, to_id: two.id, title: 'Delivery' }))
    let projects = data(await s.call('list_projects', {})).projects
    expect(projects.find((p) => p.title === 'Delivery' && !p.is_root)).toBeTruthy()
    // A scope is a pair, so wrapping added a close as well as an opening.
    const termini = data(await s.call('read_domain', {})).nodes.filter((n) => n.kind === 'terminus')
    expect(termini).toHaveLength(2)

    await s.call('unwrap_project', { node_id: wrapped.id })
    projects = data(await s.call('list_projects', {})).projects
    expect(projects.find((p) => p.title === 'Delivery')).toBeUndefined()
    expect(data(await s.call('read_domain', {})).nodes.filter((n) => n.kind === 'terminus')).toHaveLength(1)
    // Nothing inside the scope moved; only the scope went.
    expect(data(await s.call('read_domain', {})).nodes.map((n) => n.title)).toContain('Two')
  })

  it('unwrap_project refuses a plan\'s base, since that is the plan itself', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const res = await s.call('unwrap_project', { node_id: cp.id })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/cannot be unwrapped/)
  })

  it('detach_project makes a sub-project a plan of its own', async () => {
    const cp = data(await s.call('create_plan', { title: 'Ship' }))
    const one = data(await s.call('add_task', { target_id: cp.id, position: 'above', title: 'One' }))
    const wrapped = data(await s.call('wrap_run', { from_id: one.id, title: 'Delivery' }))
    await s.call('detach_project', { node_id: wrapped.id })
    const projects = data(await s.call('list_projects', {})).projects
    expect(projects.filter((p) => p.is_root).map((p) => p.title).sort()).toEqual(['Delivery', 'Ship'])
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
    const cp = JSON.parse((await s.call('create_plan', { title: 'P' })).content[0].text)
    await s.call('set_note', { node_id: cp.id, content: 'first' }) // records the note (a record change)
    s.events.length = 0
    await s.call('set_note', { node_id: cp.id, content: 'second' }) // note-only change
    expect(s.events).toContain('pensagrex:domain-changed')
  })
})
