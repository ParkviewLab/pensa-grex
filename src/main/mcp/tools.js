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

// ---- forest helpers (read the authoritative forest, then reason over it) ----

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

function readRaw(taskService, dir) {
  const res = taskService.readForest(dir)
  if (res.error) throw new Error(res.error)
  return res.raw
}

function incomingSet(raw) {
  const inc = new Set()
  for (const t of Object.values(raw.tasks)) {
    if (t.next) inc.add(t.next)
    for (const b of t.branches || []) inc.add(b.child)
  }
  return inc
}
function rootIds(raw) {
  const inc = incomingSet(raw)
  return Object.keys(raw.tasks).filter((id) => !inc.has(id))
}
function predecessorOf(raw, id) {
  for (const [pid, t] of Object.entries(raw.tasks)) {
    if (t.next === id) return pid
    for (const b of t.branches || []) if (b.child === id) return pid
  }
  return null
}
function rootOf(raw, id) {
  let cur = id
  for (let guard = 0; guard < 100000; guard++) {
    const p = predecessorOf(raw, cur)
    if (!p) return cur
    cur = p
  }
  return cur
}
function subtreeIds(raw, start) {
  const ids = new Set()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()
    if (ids.has(id)) continue
    ids.add(id)
    const t = raw.tasks[id]
    if (!t) continue
    if (t.next) stack.push(t.next)
    for (const b of t.branches || []) stack.push(b.child)
  }
  return ids
}
function structuredNode(raw, id) {
  const t = raw.tasks[id]
  const base = {
    id, title: t.title, kind: t.kind, flagged: !!t.flagged,
    hasNote: !!t.note, next: t.next || null,
    branches: (t.branches || []).map((b) => ({ child: b.child, side: b.side, at: b.at })),
  }
  if (t.kind === 'task') { base.status = t.status; base.here = !!t.here }
  return base
}
function projectOutline(raw, rootId) {
  return serializeProject(raw, rootId)
}
function domainOutline(raw) {
  return rootIds(raw).map((r) => serializeProject(raw, r)).join('\n')
}

// ---- write helpers ---------------------------------------------------------

// Apply a mutating op, then report the affected id and the re-rendered outline.
// The affected id is the newly created node when the op made one (the new root
// for creates/paste, otherwise the new inline node), else the node acted upon.
function runWrite(taskService, dir, op, args, primaryId) {
  const before = taskService.readForest(dir)
  if (before.error) return fail(before.error)
  const beforeKeys = new Set(Object.keys(before.raw.tasks))
  const res = taskService.taskOp(dir, op, args)
  if (res.error) return fail(res.error)
  const after = res.raw
  const newIds = Object.keys(after.tasks).filter((id) => !beforeKeys.has(id))
  let affected = primaryId ?? null
  if (newIds.length) {
    const inc = incomingSet(after)
    affected = newIds.find((id) => !inc.has(id)) ?? newIds[0]
  }
  const outline = affected && after.tasks[affected] ? projectOutline(after, rootOf(after, affected)) : domainOutline(after)
  return json({ id: affected, outline })
}

// ---- registration ----------------------------------------------------------

const SCOPES = { 'read-only': 0, 'read-write': 1, destructive: 2 }

// Register the tool surface on `server`, gated by `scope`. `deps` is
// { taskService, store }.
export function registerTools(server, deps, scope) {
  const level = SCOPES[scope] ?? SCOPES['read-write']
  const { taskService, store } = deps
  const dirOf = (a) => resolveDir(store, a.domain)
  const raw = (dir) => readRaw(taskService, dir)

  // ------- read-only -------
  server.registerTool('list_domains', {
    description: 'List every task domain (forest) in the library, as name and path.',
    inputSchema: {},
  }, guard(async () => json(store.listDomains())))

  server.registerTool('list_projects', {
    description: 'List the project nodes in a domain (id, title, kind, whether it is a top-level root), for resolving a named project to an id. Node titles are domain-unique.',
    inputSchema: { domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = raw(dir); const inc = incomingSet(r)
    const projects = Object.values(r.tasks).filter((t) => t.kind === 'project')
      .map((t) => ({ id: t.id, title: t.title, kind: t.kind, root: !inc.has(t.id) }))
    return json({ domain: dir, projects })
  }))

  server.registerTool('find_flagged', {
    description: 'List the flagged nodes in a domain (the flag marks tasks selected for an assistant to work on).',
    inputSchema: { domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = raw(dir)
    const flagged = Object.values(r.tasks).filter((t) => t.flagged).map((t) => structuredNode(r, t.id))
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
    const dir = dirOf(a); const r = raw(dir)
    const roots = a.project_id ? [a.project_id] : rootIds(r).filter((id) => r.tasks[id].kind === 'project')
    for (const id of roots) if (!r.tasks[id]) throw new Error(`no node "${id}" in this domain`)
    const ids = a.project_id ? [...subtreeIds(r, a.project_id)] : Object.keys(r.tasks)
    const notes = {}
    if (a.include_notes) {
      for (const id of ids) {
        const n = r.tasks[id] && r.tasks[id].note
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
    const dir = dirOf(a); const r = raw(dir); const t = r.tasks[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    const content = t.note ? ((store.readNote(dir, t.note) || {}).content || '') : ''
    return json({ id: a.node_id, note: t.note || null, content })
  }))

  server.registerTool('copy_project', {
    description: 'Snapshot a project subtree (records and note contents) into a clip for paste_as_tree.',
    inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = raw(dir)
    if (!r.tasks[a.node_id]) throw new Error(`no node "${a.node_id}" in this domain`)
    const ids = subtreeIds(r, a.node_id)
    const tasks = {}; const notes = {}
    for (const id of ids) {
      tasks[id] = structuredClone(r.tasks[id])
      const note = r.tasks[id].note
      if (note) { const rn = store.readNote(dir, note); notes[id] = (rn && rn.content) || '' }
    }
    return json({ rootId: a.node_id, tasks, notes })
  }))

  if (level < SCOPES['read-write']) return

  // ------- read-write -------
  server.registerTool('create_domain', {
    description: 'Create a new empty domain (forest).',
    inputSchema: { name: z.string() },
  }, guard(async (a) => {
    const res = store.createForest(a.name)
    return res.error ? fail(res.error) : json(res)
  }))

  server.registerTool('create_project', {
    description: 'Create a new project tree in a domain.',
    inputSchema: { name: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'addTree', [a.name], null)))

  server.registerTool('add_task', {
    description: 'Add a task relative to a node. position above|below; mode continue (extend the main line) or branch (fork a parallel stack); side left|right for a branch.',
    inputSchema: {
      target_id: z.string(),
      position: z.enum(['above', 'below']),
      mode: z.enum(['continue', 'branch']),
      title: z.string(),
      side: z.enum(['left', 'right']).optional(),
      domain: z.string().optional(),
    },
  }, guard(async (a) => {
    const op = a.mode === 'branch'
      ? (a.position === 'above' ? 'addBranchAbove' : 'addBranchBelow')
      : (a.position === 'above' ? 'addTaskAbove' : 'addTaskBelow')
    const args = a.mode === 'branch' ? [a.target_id, a.title, a.side] : [a.target_id, a.title]
    return runWrite(taskService, dirOf(a), op, args, a.target_id)
  }))

  const write1 = (name, op, description) => server.registerTool(name, {
    description, inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), op, [a.node_id], a.node_id)))

  server.registerTool('set_title', {
    description: "Set a node's title (kept unique within the domain).",
    inputSchema: { node_id: z.string(), title: z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'setTitle', [a.node_id, a.title], a.node_id)))

  server.registerTool('set_status', {
    description: "Set a task's status.",
    inputSchema: { node_id: z.string(), status: z.enum(STATUSES), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'setStatus', [a.node_id, a.status], a.node_id)))

  write1('cycle_status', 'cycleStatus', "Advance a task's status one step (todo -> in-progress -> completed -> cancelled -> todo).")
  write1('make_here', 'makeHere', 'Set this task as its branch cursor ("here"), clearing any other "here" on the same branch.')
  write1('clear_here', 'clearHere', 'Clear this task\'s "here" cursor.')
  write1('toggle_flag', 'toggleFlag', "Toggle a node's flag.")
  write1('convert_kind', 'convertKind', 'Convert a node between task and sub-project (not allowed on a root).')
  write1('move_up', 'moveUp', 'Swap a node up one place within its line.')
  write1('move_down', 'moveDown', 'Swap a node down one place within its line.')
  write1('detach_to_project', 'detachToTree', 'Detach a sub-project into its own top-level tree.')

  server.registerTool('set_note', {
    description: "Set a node's markdown note contents (writes the note file and records it on the node).",
    inputSchema: { node_id: z.string(), content: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = raw(dir); const t = r.tasks[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    const file = t.note || a.node_id + '.md'
    const w = store.writeNote(dir, file, a.content)
    if (w && w.error) return fail(w.error)
    if (!t.note) return runWrite(taskService, dir, 'setNote', [a.node_id, file], a.node_id)
    return json({ id: a.node_id, note: file, outline: projectOutline(r, rootOf(r, a.node_id)) })
  }))

  server.registerTool('delete_note', {
    description: "Delete a node's note file and clear it from the node.",
    inputSchema: { node_id: z.string(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a); const r = raw(dir); const t = r.tasks[a.node_id]
    if (!t) throw new Error(`no node "${a.node_id}" in this domain`)
    if (t.note) store.deleteNote(dir, t.note)
    return runWrite(taskService, dir, 'setNote', [a.node_id, null], a.node_id)
  }))

  server.registerTool('paste_as_tree', {
    description: 'Paste a clip (from copy_project) into a domain as a fresh independent tree.',
    inputSchema: {
      clip: z.object({ rootId: z.string(), tasks: z.record(z.string(), z.any()), notes: z.record(z.string(), z.string()).optional() }),
      domain: z.string().optional(),
    },
  }, guard(async (a) => runWrite(taskService, dirOf(a), 'pasteAsTree', [a.clip], null)))

  const write2 = (name, op, keys, description) => server.registerTool(name, {
    description,
    inputSchema: { [keys[0]]: z.string(), [keys[1]]: keys[1] === 'index' ? z.number().int() : z.string(), domain: z.string().optional() },
  }, guard(async (a) => runWrite(taskService, dirOf(a), op, [a[keys[0]], a[keys[1]]], a[keys[0]])))

  write2('move_node', 'moveTaskNode', ['node_id', 'target_id'], 'Move a task to fork off a target node.')
  write2('move_subtree', 'moveSubtree', ['root_id', 'target_id'], 'Move a sub-project (its whole subtree) to fork off a target node.')
  write2('move_into_line', 'moveIntoLine', ['moved_id', 'below_id'], 'Splice a node into the gap above below_id on its line.')
  write2('reorder_project', 'reorderRoot', ['root_id', 'index'], 'Move a top-level tree to a new left-to-right index.')

  if (level < SCOPES.destructive) return

  // ------- destructive -------
  server.registerTool('delete_task', {
    description: 'Delete a node. mode subtree removes it and everything growing from it; mode splice removes only it and reconnects its successor.',
    inputSchema: { node_id: z.string(), mode: z.enum(['subtree', 'splice']).optional(), domain: z.string().optional() },
  }, guard(async (a) => {
    const dir = dirOf(a)
    const res = taskService.taskOp(dir, 'deleteTask', [a.node_id, a.mode || 'subtree'])
    if (res.error) return fail(res.error)
    return json({ deleted: a.node_id, outline: domainOutline(res.raw) })
  }))

  server.registerTool('delete_domain', {
    description: 'Move a whole domain (its forest and notes) to the Trash.',
    inputSchema: { name_or_path: z.string() },
  }, guard(async (a) => {
    let dir
    try { dir = resolveDir(store, a.name_or_path) } catch (e) { return fail(e.message) }
    const res = await store.deleteForest(dir)
    return res.error ? fail(res.error) : json({ deleted: a.name_or_path })
  }))
}
