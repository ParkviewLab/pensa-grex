// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The MCP tool surface (docs/mcp_ideas.md). Every tool is a thin call into the
// main-process task authority (taskService) or the store, so an agent edits the
// live app exactly as a person does, through the one write path that validates
// before it persists. Tools are registered in three scope tiers: read-only
// always; read-write unless the scope is read-only; destructive only when the
// scope is 'destructive'. A node is addressed by id, a domain by name or path
// (defaulting to the open/last domain); every write returns the affected id and
// the re-rendered outline, and a write that would break an invariant returns the
// mutation's descriptive error.

import { z } from 'zod'
import { serializeProject } from '../../shared/export/markdown.js'
import { noteFileName } from '../../shared/model/notes.js'
import { branchChildrenOf } from '../../shared/model/validate.js'

const STATUSES = ['todo', 'in-progress', 'completed', 'cancelled']

// ---- result formatting -----------------------------------------------------

function json(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] }
}
function fail(msg) {
  return { content: [{ type: 'text', text: 'Error: ' + msg }], isError: true }
}
// Wrap a tool body so a thrown error (resolve/read failure, unexpected bug)
// becomes a clean tool error instead of crashing the server.
function guard(fn) {
  return async (args, extra) => {
    try {
      return await fn(args, extra)
    } catch (e) {
      return fail((e && e.message) || String(e))
    }
  }
}

// ---- record helpers (read the authoritative record, then reason over it) ----

function resolveDir(store, domainArg) {
  const domains = store.listDomains()
  if (domainArg) {
    const hit = domains.find((d) => d.path === domainArg || d.name === domainArg)
    if (!hit) throw new Error(`no domain named or at "${domainArg}"`)
    return hit.path
  }
  const last = store.getSettings().lastDomain
  const def = domains.find((d) => d.name === last) || (domains.length === 1 ? domains[0] : null)
  if (!def) throw new Error('no domain given and no single default; pass a domain name or path')
  return def.path
}

function readRecordOrThrow(taskService, dir) {
  const res = taskService.readRecord(dir)
  if (res.error) throw new Error(res.error)
  return res.record
}

function incomingSet(record) {
  const inc = new Set()
  for (const t of Object.values(record.nodes)) {
    if (t.next) inc.add(t.next)
    for (const b of branchChildrenOf(t)) inc.add(b.child)
  }
  return inc
}
function rootIds(record) {
  const inc = incomingSet(record)
  return Object.keys(record.nodes).filter((id) => !inc.has(id))
}
function predecessorOf(record, id) {
  for (const [pid, t] of Object.entries(record.nodes)) {
    if (t.next === id) return pid
    for (const b of branchChildrenOf(t)) if (b.child === id) return pid
  }
  return null
}
function rootOf(record, id) {
  let cur = id
  for (let guard = 0; guard < 100000; guard++) {
    const p = predecessorOf(record, cur)
    if (!p) return cur
    cur = p
  }
  return cur
}
function subtreeIds(record, start) {
  const ids = new Set()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()
    if (ids.has(id)) continue
    ids.add(id)
    const t = record.nodes[id]
    if (!t) continue
    if (t.next) stack.push(t.next)
    for (const b of branchChildrenOf(t)) stack.push(b.child)
  }
  return ids
}
function structuredNode(record, id) {
  const t = record.nodes[id]
  const base = {
    id, title: t.title, kind: t.kind, flagged: !!t.flagged,
    hasNote: !!t.note, next: t.next || null,
    branches: branchChildrenOf(t),
  }
  if (t.kind === 'task') { base.status = t.status; base.here = !!t.here }
  return base
}
function projectOutline(record, rootId) {
  return serializeProject(record, rootId)
}
function domainOutline(record) {
  return rootIds(record).map((r) => serializeProject(record, r)).join('\n')
}

// ---- write helpers ---------------------------------------------------------

// Apply a mutating op, then report the affected id and the re-rendered outline.
// The affected id is the newly created node when the op made one (the new root
// for creates/paste, otherwise the new inline node), else the node acted upon.
function runWrite(taskService, dir, op, args, primaryId) {
  const before = taskService.readRecord(dir)
  if (before.error) return fail(before.error)
  const beforeKeys = new Set(Object.keys(before.record.nodes))
  const res = taskService.runOp(dir, op, args)
  if (res.error) return fail(res.error)
  const after = res.record
  const newIds = Object.keys(after.nodes).filter((id) => !beforeKeys.has(id))
  let affected = primaryId ?? null
  if (newIds.length) {
    const inc = incomingSet(after)
    affected = newIds.find((id) => !inc.has(id)) ?? newIds[0]
  }
  const outline = affected && after.nodes[affected] ? projectOutline(after, rootOf(after, affected)) : domainOutline(after)
  return json({ id: affected, outline })
}

// ---- registration ----------------------------------------------------------

const SCOPES = { 'read-only': 0, 'read-write': 1, destructive: 2 }

// Register the tool surface on `server`, gated by `scope`. `deps` is
// { taskService, store }.
export function registerTools(server, deps, scope) {
  const level = SCOPES[scope] ?? SCOPES['read-write']
  const { taskService, store } = deps
  const notify = typeof deps.notify === 'function' ? deps.notify : () => {}
  const dirOf = (a) => resolveDir(store, a.domain)
  const record = (dir) => readRecordOrThrow(taskService, dir)

  // A prompt (a client "workflow") baking in the re-read-first discipline for the
  // common "work the flagged tasks" case; exposed in every scope tier.
  server.registerPrompt('work_flagged', {
    title: 'Work the flagged tasks',
    description: 'Plan and work the tasks flagged for an assistant, re-reading current state before each step.',
    argsSchema: { domain: z.string().optional() },
  }, (a) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: 'Work the flagged tasks in ' + (a && a.domain ? '"' + a.domain + '"' : 'the open domain') + '. '
          + 'The domain is live and can change under you, so: '
          + '(1) call find_flagged NOW to get the current flagged tasks, never trusting an earlier read; '
          + '(2) for each, read_note for what is asked and read_project for context; '
          + '(3) do the work, then set_status / set_note, re-reading (find_flagged / read_project) immediately before each write to confirm the target still exists and is still the one you mean; '
          + '(4) set a task to completed when it is done.',
      },
    }],
  }))

  // ------- read-only -------
  server.registerTool('list_domains', {
    description: 'List every domain in the library, as name and path. A domain holds any number of project plans.',
    inputSchema: {},
  }, guard(async () => json(store.listDomains())))

  server.registerTool('list_projects', {
    description: 'List the project nodes in a domain (id, title, kind, and whether it is a plan\'s own base rather than a sub-project), for resolving a named project to an id. Node titles are domain-unique; a terminus has none, so a plan is named by its base.',
    inputSchema: { domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir); const inc = incomingSet(r)
    const projects = Object.values(r.nodes).filter((t) => t.kind === 'project')
      .map((t) => ({ id: t.id, title: t.title, kind: t.kind, root: !inc.has(t.id) }))
    return json({ domain: dir, projects })
  }))

  server.registerTool('find_flagged', {
    description: 'List the flagged nodes in a domain (the flag marks tasks selected for an assistant to work on). Results reflect this instant only; the flag set changes as the user works, so re-read rather than reusing an earlier result.',
    inputSchema: { domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir)
    const flagged = Object.values(r.nodes).filter((t) => t.flagged).map((t) => structuredNode(r, t.id))
    return json({ domain: dir, flagged })
  }))

  server.registerTool('read_project', {
    description: 'Read a project as a markdown outline plus a structured node array. With no project_id, renders every top-level project in the domain; with a project_id, scopes to that project or sub-project subtree. include_notes inlines note contents.',
    inputSchema: {
      domain: z.string().optional(),
      project_id: z.string().optional(),
      include_notes: z.boolean().optional(),
    },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir)
    const roots = a.project_id ? [a.project_id] : rootIds(r).filter((id) => r.nodes[id].kind === 'project')
    for (const id of roots) if (!r.nodes[id]) throw new Error(`no node "${id}" in this domain`)
    const ids = a.project_id ? [...subtreeIds(r, a.project_id)] : Object.keys(r.nodes)
    const notes = {}
    if (a.include_notes) {
      for (const id of ids) {
        const n = r.nodes[id] && r.nodes[id].note
        if (n) { const rn = store.readNote(dir, n); notes[id] = (rn && rn.content) || '' }
      }
    }
    const outline = roots.map((id) => serializeProject(r, id, notes)).join('\n')
    const nodes = ids.map((id) => {
      const s = structuredNode(r, id)
      if (a.include_notes && notes[id] != null) s.note = notes[id]
      return s
    })
    return json({ domain: dir, outline, nodes })
  }))

  server.registerTool('read_note', {
    description: "Read a node's markdown note. Empty if the node has no note.",
    inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir); const t = r.nodes[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    const content = t.note ? ((store.readNote(dir, t.note) || {}).content || '') : ''
    return json({ id: a.node_id, note: t.note || null, content })
  }))

  server.registerTool('copy_project', {
    description: 'Snapshot a project subtree (records and note contents) into a clip for paste_as_plan.',
    inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir)
    if (!r.nodes[a.node_id]) throw new Error(`no node "${a.node_id}" in this domain`)
    const ids = subtreeIds(r, a.node_id)
    // The clip mirrors the record, so its node map is `nodes` too.
    const nodes = {}; const notes = {}
    for (const id of ids) {
      nodes[id] = structuredClone(r.nodes[id])
      const note = r.nodes[id].note
      if (note) { const rn = store.readNote(dir, note); notes[id] = (rn && rn.content) || '' }
    }
    return json({ rootId: a.node_id, nodes, notes })
  }))

  if (level < SCOPES['read-write']) return

  // ------- read-write -------
  server.registerTool('create_domain', {
    description: 'Create a new empty domain.',
    inputSchema: { name: z.string() },
  }, guard(async (a) => {
    const res = store.createDomain(a.name)
    if (res.error) return fail(res.error)
    notify('pensagrex:domains-changed', {})
    return json(res)
  }))

  server.registerTool('create_plan', {
    description: 'Create a new project plan in a domain: a base project node carrying the name, and the terminus that closes it. An empty plan is a legal resting state, and this is how every plan begins; tasks are then inserted into the edge between the two.',
    inputSchema: { name: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'addTree', [a.name], null)))

  server.registerTool('add_task', {
    description: 'Insert a task into an edge of a trunk. position "above" takes the edge rising from target_id; "below" takes the edge beneath it, which is refused where there is none (below a plan\'s base, or below the first node of a branch). An insertion always names its edge. To start a parallel strand instead, use open_branch.',
    inputSchema: {
      target_id: z.string(),
      position: z.enum(['above', 'below']),
      title: z.string(),
      domain: z.string().optional(),
    },
  }, guard(async (a) => {
    const op = a.position === 'above' ? 'addTaskAbove' : 'addTaskBelow'
    return runWrite(taskService, dirOf(a), op, [a.target_id, a.title], a.target_id)
  }))

  server.registerTool('open_branch', {
    description: 'Open a branch on the edge rising from a node: one move creating the attachment, a first task inside it, and its return line. The return rejoins at that same edge by default, which is the smallest legal branch and says that this strand runs alongside that one gap; set_merge_point moves it afterwards. Refused where the node has no edge above it, which is a plan\'s closing terminus or the top of a branch.',
    inputSchema: {
      edge_id: z.string(),
      title: z.string(),
      side: z.enum(['left', 'right']).optional(),
      domain: z.string().optional(),
    },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'openBranch', [a.edge_id, a.title, a.side], a.edge_id)))

  server.registerTool('set_merge_point', {
    description: 'Move where a branch rejoins the trunk it left. branch_id is the branch\'s first node, the one at the bottom of it; merge_point_id names the node BELOW the edge the return joins. A legal merge is on that trunk, at or above the node the branch left, and inside exactly the scopes the branch\'s own edge is inside; a refusal says which rule failed and what would be legal instead.',
    inputSchema: { branch_id: z.string(), merge_point_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'setMergePoint', [a.branch_id, a.merge_point_id], a.branch_id)))

  server.registerTool('wrap_run', {
    description: 'Name a run of one trunk as a sub-project: a project node goes in below the run\'s first node and a terminus above its last, so the run becomes a scope. to_id defaults to from_id, which wraps a single node. Refused where the run would straddle an existing scope or a branch\'s span, since a scope has to be collapsible as one block.',
    inputSchema: { from_id: z.string(), to_id: z.string().optional(), title: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'wrapRun', [a.from_id, a.to_id || a.from_id, a.title], a.from_id)))

  server.registerTool('unwrap_project', {
    description: 'Undo a wrap: remove a sub-project node and the terminus that closes it, leaving what was inside on the trunk. Refused on a plan\'s base, since removing a plan\'s own scope is deleting the plan.',
    inputSchema: { project_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'unwrapProject', [a.project_id], a.project_id)))

  const write1 = (name, op, description) => server.registerTool(name, {
    description, inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), op, [a.node_id], a.node_id)))

  server.registerTool('set_title', {
    description: "Set a node's title (kept unique within the domain).",
    inputSchema: { node_id: z.string(), title: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'setTitle', [a.node_id, a.title], a.node_id)))

  server.registerTool('set_status', {
    description: "Set a task's status. Re-read (read_project / list_projects) to confirm the target id before calling; the domain may have changed since your last read.",
    inputSchema: { node_id: z.string(), status: z.enum(STATUSES), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'setStatus', [a.node_id, a.status], a.node_id)))

  write1('cycle_status', 'cycleStatus', "Advance a task's status one step (todo -> in-progress -> completed -> cancelled -> todo).")
  write1('make_here', 'makeHere', 'Set this task as its branch cursor ("here"), clearing any other "here" on the same branch.')
  write1('clear_here', 'clearHere', 'Clear this task\'s "here" cursor.')
  write1('toggle_flag', 'toggleFlag', "Toggle a node's flag.")
  write1('convert_kind', 'convertKind', 'Convert a node between task and sub-project, which opens or closes a scope with it (not allowed on a plan\'s base, or on a terminus). Refused where the new scope would straddle a branch\'s span.')
  write1('move_up', 'moveUp', 'Swap a node up one place within its line.')
  write1('move_down', 'moveDown', 'Swap a node down one place within its line.')
  write1('detach_to_plan', 'detachToTree', 'Detach a sub-project into a plan of its own. Where it was a branch, it gives up its return, a plan having none.')

  server.registerTool('set_note', {
    description: "Set a node's markdown note contents (writes the note file and records it on the node).",
    inputSchema: { node_id: z.string(), content: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir); const t = r.nodes[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    const file = t.note || noteFileName(a.node_id, t.title)
    const w = store.writeNote(dir, file, a.content)
    if (w && w.error) return fail(w.error)
    if (!t.note) return runWrite(taskService, dir, 'setNote', [a.node_id, file], a.node_id)
    // The record is unchanged (the note filename was already recorded), so the
    // runOp wrapper did not fire; push the note change for the live view/editor.
    notify('pensagrex:domain-changed', { dir })
    return json({ id: a.node_id, note: file, outline: projectOutline(r, rootOf(r, a.node_id)) })
  }))

  server.registerTool('delete_note', {
    description: "Delete a node's note file and clear it from the node.",
    inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = record(dir); const t = r.nodes[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    if (t.note) store.deleteNote(dir, t.note)
    return runWrite(taskService, dir, 'setNote', [a.node_id, null], a.node_id)
  }))

  server.registerTool('paste_as_plan', {
    description: 'Paste a clip (from copy_project) into a domain as a fresh independent plan.',
    inputSchema: {
      clip: z.object({ rootId: z.string(), nodes: z.record(z.string(), z.any()), notes: z.record(z.string(), z.string()).optional() }),
      domain: z.string().optional(),
    },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'pasteAsTree', [a.clip], null)))

  const write2 = (name, op, keys, description) => server.registerTool(name, {
    description,
    inputSchema: { [keys[0]]: z.string(), [keys[1]]: keys[1] === 'index' ? z.number().int() : z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), op, [a[keys[0]], a[keys[1]]], a[keys[0]])))

  write2('move_node', 'moveTaskNode', ['node_id', 'target_id'], 'Move a task to hang as a new branch off the edge above a target node, leaving its own children behind. The new branch rejoins at that same edge; use set_merge_point to move the return. Refused where the target has no edge above it.')
  write2('move_subtree', 'moveSubtree', ['root_id', 'target_id'], 'Move a sub-project (its whole subtree) to hang as a new branch off the edge above a target node, with the same defaults and the same refusal as move_node.')
  write2('move_into_line', 'moveIntoLine', ['moved_id', 'below_id'], 'Splice a node into the gap above below_id on its line.')
  write2('reorder_plan', 'reorderRoot', ['root_id', 'index'], 'Move a plan to a new left-to-right index among the domain\'s plans.')

  if (level < SCOPES.destructive) return

  // ------- destructive -------
  server.registerTool('delete_task', {
    description: 'Delete a node. mode subtree removes it and everything growing from it, sparing the terminus of any scope that survives; mode splice removes only it and reconnects its successor. Deleting a branch\'s last task takes the branch and its return with it. Re-read (read_project) to confirm the target id before calling; the domain may have changed since your last read.',
    inputSchema: { node_id: z.string(), mode: z.enum(['subtree', 'splice']).optional(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a)
    const res = taskService.runOp(dir, 'deleteTask', [a.node_id, a.mode || 'subtree'])
    if (res.error) return fail(res.error)
    return json({ deleted: a.node_id, outline: domainOutline(res.record) })
  }))

  server.registerTool('delete_domain', {
    description: 'Move a whole domain (its plans and notes) to the Trash. Re-read (list_domains) to confirm the target before calling.',
    inputSchema: { name_or_path: z.string() },
  }, guard(async (a) => {
    let dir
    try { dir = resolveDir(store, a.name_or_path) } catch (e) { return fail(e.message) }
    const res = await store.deleteDomain(dir)
    if (res.error) return fail(res.error)
    notify('pensagrex:domains-changed', {})
    notify('pensagrex:domain-changed', { dir }) // in case the deleted domain is the open one
    return json({ deleted: a.name_or_path })
  }))
}
