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

// The forest file as it currently sits on disk, parsed.
function onDisk(dir) {
  return JSON5.parse(store.loadForest(dir).text)
}

// A domain with one project tree; returns [dir, rootId].
function domainWithTree(name = 'HomeLab', treeName = 'Overview') {
  const { path } = store.createForest(name)
  const res = taskService.runOp(path, 'addTree', [treeName])
  expect(res.error).toBeUndefined()
  return [path, Object.keys(res.record.tasks)[0]]
}

describe('readRecord', () => {
  it('reads a fresh domain as an empty schema-2 record', () => {
    const { path } = store.createForest('HomeLab')
    const res = taskService.readRecord(path)
    expect(res.error).toBeUndefined()
    expect(res.record.schema).toBe(2)
    expect(res.record.tasks).toEqual({})
  })

  it('migrates a schema-1 record and persists the upgrade once', () => {
    const { path } = store.createForest('HomeLab')
    const v1 = {
      schema: 1, domain: 'HomeLab',
      trees: [{ id: 't1', name: 'Overview', rootTaskId: 'a' }],
      tasks: {
        a: { id: 'a', title: 'A', status: 'todo', createdAt: 'x', completedAt: null, note: null, here: false, next: null, branches: [] },
      },
    }
    store.saveForest(path, JSON5.stringify(v1))

    const res = taskService.readRecord(path)
    expect(res.error).toBeUndefined()
    expect(res.record.schema).toBe(2)

    // The upgrade was written back to disk, so it is a schema-2 record now, and a
    // second read finds nothing left to migrate (changed=false, no re-write).
    const disk = onDisk(path)
    expect(disk.schema).toBe(2)
    expect(disk.trees).toBeUndefined()
    expect(disk.rootOrder).toHaveLength(1)
    expect(disk.tasks.a.kind).toBe('task')
  })

  it('reports a JSON5 parse error rather than throwing', () => {
    const { path } = store.createForest('HomeLab')
    store.saveForest(path, '{ this is not valid json5 ')
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
    const { path } = store.createForest('HomeLab')
    const res = taskService.runOp(path, 'addTree', ['Overview'])
    expect(res.error).toBeUndefined()

    const ids = Object.keys(res.record.tasks)
    expect(ids).toHaveLength(1)
    const root = res.record.tasks[ids[0]]
    expect(root.kind).toBe('project')
    expect(root.title).toBe('Overview')

    // Persisted to disk, not just returned in memory.
    const disk = onDisk(path)
    expect(disk.tasks[ids[0]].title).toBe('Overview')
    expect(disk.rootOrder).toContain(ids[0])
  })

  it('chains ops: add a task above the root, then complete it', () => {
    const [dir, rootId] = domainWithTree()
    const added = taskService.runOp(dir, 'addTaskAbove', [rootId, 'First'])
    expect(added.error).toBeUndefined()
    const taskId = Object.keys(added.record.tasks).find((id) => added.record.tasks[id].kind === 'task')
    expect(taskId).toBeTruthy()

    const done = taskService.runOp(dir, 'setStatus', [taskId, 'completed'])
    expect(done.error).toBeUndefined()
    expect(done.record.tasks[taskId].status).toBe('completed')
    expect(done.record.tasks[taskId].completedAt).toBeTruthy()
    expect(onDisk(dir).tasks[taskId].status).toBe('completed')
  })

  it('refuses an op that breaks an invariant and writes nothing', () => {
    const [dir, rootId] = domainWithTree()
    const before = store.loadForest(dir).text
    // A project node has no status: setStatus throws, the op returns the error.
    const res = taskService.runOp(dir, 'setStatus', [rootId, 'completed'])
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/project/)
    expect(store.loadForest(dir).text).toBe(before) // file untouched
  })

  it('rejects an unknown op name and writes nothing', () => {
    const [dir] = domainWithTree()
    const before = store.loadForest(dir).text
    const res = taskService.runOp(dir, 'deleteEverything', [])
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/unknown task op/)
    expect(store.loadForest(dir).text).toBe(before)
  })

  it('writes the pasted note files for pasteAsTree', () => {
    const [dir, rootId] = domainWithTree('HomeLab', 'Src')
    taskService.runOp(dir, 'setNote', [rootId, 'src.md'])
    store.writeNote(dir, 'src.md', '# source note\n')

    const record = taskService.readRecord(dir).record
    const clip = {
      rootId,
      tasks: { [rootId]: structuredClone(record.tasks[rootId]) },
      notes: { [rootId]: '# source note\n' },
    }
    const res = taskService.runOp(dir, 'pasteAsTree', [clip])
    expect(res.error).toBeUndefined()

    // Two trees now: the original plus the paste.
    const roots = Object.values(res.record.tasks).filter((t) => t.kind === 'project')
    expect(roots).toHaveLength(2)

    // The pasted node got a fresh note file (named for its new id), and that file
    // was written to disk with the clip's content.
    const pasted = roots.find((t) => t.id !== rootId)
    expect(pasted.note).toBeTruthy()
    expect(pasted.note).not.toBe('src.md')
    expect(store.readNote(dir, pasted.note).content).toBe('# source note\n')
  })
})
