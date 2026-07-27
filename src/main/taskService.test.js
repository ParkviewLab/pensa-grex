// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Integration test for the main-process task service against a real temporary
// library. Only electron's app.getPath is mocked (store.js's one electron
// dependency); the shared model, validation, and JSON5 round-trips all run for
// real, so this exercises the whole load -> mutate -> validate -> atomic-write
// authority path end to end, exactly as the renderer and (later) the MCP server
// will drive it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSON5 from 'json5'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  shell: { trashItem: async () => {} },
}))

const store = await import('./store.js')
const taskService = await import('./taskService.js')

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'pensagrex-task-'))
})
afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
})

// The domain file as it currently sits on disk, parsed. Read with the tolerant
// parser, because a test may plant a file an older version would have written;
// what this version WRITES is checked to be plain JSON separately, below.
function onDisk(dir) {
  return JSON5.parse(store.loadDomainFile(dir).text)
}

// A domain with one project tree; returns [dir, rootId]. addPlan now writes two
// nodes (the base and the terminus closing it), so the base is taken from
// planOrder rather than from the node map's first key.
function domainWithPlan(name = 'HomeLab', planName = 'Overview') {
  const { path } = store.createDomain(name)
  const res = taskService.runOp(path, 'addPlan', [planName])
  expect(res.error).toBeUndefined()
  return [path, res.record.planOrder[0]]
}

describe('readRecord', () => {
  it('reads a fresh domain as an empty schema-3 record', () => {
    const { path } = store.createDomain('HomeLab')
    const res = taskService.readRecord(path)
    expect(res.error).toBeUndefined()
    expect(res.record.schemaVersion).toBe(3)
    expect(res.record.nodes).toEqual({})
  })

  it('persists every write as plain JSON, parseable without the tolerant reader', () => {
    // Axiom 7 now names plain JSON, so the strict parser is the test: a file with
    // unquoted keys or a trailing comma would throw here.
    const [dir, rootId] = domainWithPlan()
    taskService.runOp(dir, 'addTaskAbove', [rootId, 'First'])
    const text = store.loadDomainFile(dir).text
    expect(() => JSON.parse(text)).not.toThrow()
    expect(text.endsWith('\n')).toBe(true)
    expect(Object.values(JSON.parse(text).nodes).some((t) => t.title === 'First')).toBe(true)
  })

  it('migrates a schema-1 record and persists the upgrade once', () => {
    const { path } = store.createDomain('HomeLab')
    const v1 = {
      schema: 1, domain: 'HomeLab',
      trees: [{ id: 't1', name: 'Overview', rootTaskId: 'a' }], // schema 1's own field name
      tasks: {
        a: { id: 'a', title: 'A', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
      },
    }
    store.saveDomainFile(path, JSON5.stringify(v1))

    const res = taskService.readRecord(path)
    expect(res.error).toBeUndefined()
    expect(res.record.schemaVersion).toBe(3)

    // The upgrade was written back to disk, so it is a schema-3 record now, and a
    // second read finds nothing left to migrate (changed=false, no re-write).
    const disk = onDisk(path)
    expect(disk.schemaVersion).toBe(3)
    expect(disk.trees).toBeUndefined()
    expect(disk.planOrder).toHaveLength(1)
    // Schema 3: the 2 -> 3 pass remints every node id, so the migrated task is
    // found by its title rather than by its schema-1 id 'a'.
    const migrated = Object.values(disk.nodes).find((n) => n.title === 'A')
    expect(migrated.kind).toBe('task')
    // Termini: the migration closes the scope the schema-1 tree always meant, so the
    // upgraded file holds one terminus, above the migrated task, ending the plan.
    const termini = Object.values(disk.nodes).filter((n) => n.kind === 'terminus')
    expect(termini).toHaveLength(1)
    expect(migrated.next).toBe(termini[0].id)
    expect(termini[0].next).toBeNull()
    expect(termini[0].title).toBeUndefined()
    // "Once": the second read writes nothing, so the file (reminted ids included)
    // is byte-for-byte what the first read left.
    const text = store.loadDomainFile(path).text
    expect(taskService.readRecord(path).error).toBeUndefined()
    expect(store.loadDomainFile(path).text).toBe(text)
  })

  it('reports a JSON5 parse error rather than throwing', () => {
    const { path } = store.createDomain('HomeLab')
    store.saveDomainFile(path, '{ this is not valid json5 ')
    const res = taskService.readRecord(path)
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/JSON5/)
  })

  it('reports a store error for a path outside the library root', () => {
    const res = taskService.readRecord('/etc')
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/library root/)
  })
})

describe('runOp', () => {
  it('applies a mutation, persists it, and returns the new record', () => {
    const { path } = store.createDomain('HomeLab')
    const res = taskService.runOp(path, 'addPlan', ['Overview'])
    expect(res.error).toBeUndefined()

    // Termini: a fresh plan is now TWO nodes, the base and the terminus that closes
    // it, so the old "exactly one node" assertion becomes "exactly these two". The
    // pairing is asserted, not just the count: the base's .next is the close, the
    // close says nothing of its own, and a plan ends there (next null, no branches).
    const ids = Object.keys(res.record.nodes)
    expect(ids).toHaveLength(2)
    const rootId = res.record.planOrder[0]
    const root = res.record.nodes[rootId]
    expect(root.kind).toBe('project')
    expect(root.title).toBe('Overview')

    const close = res.record.nodes[root.next]
    expect(close.kind).toBe('terminus')
    expect(close.title).toBeUndefined()
    expect(close.next).toBeNull()
    expect(close.leftBranches).toEqual([])
    expect(close.rightBranches).toEqual([])

    // Persisted to disk, not just returned in memory.
    const disk = onDisk(path)
    expect(disk.nodes[rootId].title).toBe('Overview')
    expect(disk.nodes[rootId].next).toBe(close.id)
    expect(disk.nodes[close.id].kind).toBe('terminus')
    expect(disk.planOrder).toContain(rootId)
  })

  it('chains ops: add a task above the root, then complete it', () => {
    const [dir, rootId] = domainWithPlan()
    const added = taskService.runOp(dir, 'addTaskAbove', [rootId, 'First'])
    expect(added.error).toBeUndefined()
    const taskId = Object.keys(added.record.nodes).find((id) => added.record.nodes[id].kind === 'task')
    expect(taskId).toBeTruthy()

    const done = taskService.runOp(dir, 'setStatus', [taskId, 'completed'])
    expect(done.error).toBeUndefined()
    expect(done.record.nodes[taskId].status).toBe('completed')
    expect(done.record.nodes[taskId].completedAt).toBeTruthy()
    expect(onDisk(dir).nodes[taskId].status).toBe('completed')
  })

  it('refuses an op that breaks an invariant and writes nothing', () => {
    const [dir, rootId] = domainWithPlan()
    const before = store.loadDomainFile(dir).text
    // A project node has no status: setStatus throws, the op returns the error. The
    // guard now names the rule from the task's side ('only a task has a status'), so
    // the match is on that wording rather than on the word "project".
    const res = taskService.runOp(dir, 'setStatus', [rootId, 'completed'])
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/only a task has a status/)
    expect(store.loadDomainFile(dir).text).toBe(before) // file untouched

    // Termini: a terminus has no status either, and the refusal is the same — the
    // plan's close is reachable through the same one write path.
    const closeId = taskService.readRecord(dir).record.nodes[rootId].next
    const onClose = taskService.runOp(dir, 'setStatus', [closeId, 'completed'])
    expect(onClose.record).toBeUndefined()
    expect(onClose.error).toMatch(/only a task has a status/)
    expect(store.loadDomainFile(dir).text).toBe(before)
  })

  it('rejects an unknown op name and writes nothing', () => {
    const [dir] = domainWithPlan()
    const before = store.loadDomainFile(dir).text
    const res = taskService.runOp(dir, 'deleteEverything', [])
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/unknown task op/)
    expect(store.loadDomainFile(dir).text).toBe(before)
  })

  it('writes the pasted note files for pasteAsPlan', () => {
    const [dir, rootId] = domainWithPlan('HomeLab', 'Src')
    taskService.runOp(dir, 'setNote', [rootId, 'src.md'])
    store.writeNote(dir, 'src.md', '# source note\n')

    const record = taskService.readRecord(dir).record
    // Termini: a clip is a whole subtree (see copyProject in app.js), and a plan's
    // subtree now includes the terminus closing it, so the fixture carries both
    // nodes. A clip of the base alone would paste a base whose .next still named the
    // ORIGINAL close, which validation refuses (two incoming edges) — so the clip is
    // widened rather than the assertion loosened.
    const closeId = record.nodes[rootId].next
    const clip = {
      rootId,
      nodes: {
        [rootId]: structuredClone(record.nodes[rootId]),
        [closeId]: structuredClone(record.nodes[closeId]),
      },
      notes: { [rootId]: '# source note\n' },
    }
    const res = taskService.runOp(dir, 'pasteAsPlan', [clip])
    expect(res.error).toBeUndefined()

    // Two trees now: the original plus the paste.
    const roots = Object.values(res.record.nodes).filter((t) => t.kind === 'project')
    expect(roots).toHaveLength(2)

    // The pasted node got a fresh note file (named for its new id), and that file
    // was written to disk with the clip's content.
    const pasted = roots.find((t) => t.id !== rootId)
    expect(pasted.note).toBeTruthy()
    expect(pasted.note).not.toBe('src.md')
    expect(store.readNote(dir, pasted.note).content).toBe('# source note\n')

    // Termini: the paste is an independent plan, so it is closed by its own fresh
    // terminus rather than sharing the source's.
    expect(pasted.next).not.toBe(closeId)
    expect(res.record.nodes[pasted.next].kind).toBe('terminus')
  })
})
