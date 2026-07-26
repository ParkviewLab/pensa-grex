// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Integration test for the one-time schema-2 to schema-3 library move, against a
// real temporary directory: a hand-built old library goes in, and what comes out
// is checked node by node, note by note, and bookmark by bookmark. Only electron's
// app.getPath is mocked, so every filesystem operation runs for real.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  shell: { trashItem: async () => {} },
}))

const { migrateLibraryIfNeeded } = await import('./migrateLibrary.js')
const store = await import('./store.js')
const { validateRecord, pairScopes, trunksOf } = await import('../shared/model/validate.js')
const { buildModel } = await import('../shared/model/model.js')

// The nodes of a migrated record that carry a title, by that title. Termini have no
// title, so they are not here; the helpers below reach them by kind.
const titled = (record) =>
  Object.fromEntries(Object.values(record.nodes).filter((n) => n.kind !== 'terminus').map((n) => [n.title, n]))
const terminiOf = (record) => Object.values(record.nodes).filter((n) => n.kind === 'terminus')

// A schema-2 domain as the 2.x app wrote it: JSON5 text with unquoted keys, notes
// beside the record, and a bookmark with a zoom and an anchor chain.
function oldDomain(name, { withNote = true, withBookmark = true, broken = false } = {}) {
  const dir = join(h.userData, 'forests', name)
  mkdirSync(dir, { recursive: true })
  const text = broken ? '{ this is not json at all ' : `{
  schema: 2,
  domain: ${JSON.stringify(name)},
  rootOrder: ["p_root"],
  tasks: {
    p_root: {
      id: "p_root", title: "A project", kind: "project",
      createdAt: "2026-06-01T08:00:00Z", note: null, next: "k_one", branches: [],
    },
    k_one: {
      id: "k_one", title: "First task", kind: "task", status: "in-progress",
      createdAt: "2026-06-01T09:00:00Z", completedAt: null,
      note: ${withNote ? '"k_one.md"' : 'null'}, here: true, next: "k_two",
      branches: [{ child: "k_side", side: "left", at: "above" }],
    },
    k_two: {
      id: "k_two", title: "Second task", kind: "task", status: "todo",
      createdAt: "2026-06-02T09:00:00Z", completedAt: null,
      note: null, here: false, next: null,
      branches: [{ child: "k_under", side: "right", at: "below" }],
    },
    k_side: {
      id: "k_side", title: "Sidelong", kind: "task", status: "todo",
      createdAt: "2026-06-03T09:00:00Z", completedAt: null,
      note: null, here: false, next: null, branches: [],
    },
    k_under: {
      id: "k_under", title: "Underneath", kind: "task", status: "completed",
      createdAt: "2026-06-04T09:00:00Z", completedAt: "2026-06-05T09:00:00Z",
      note: null, here: false, next: null, branches: [],
    },
  },
}
`
  writeFileSync(join(dir, 'forest.json5'), text)
  if (withNote && !broken) writeFileSync(join(dir, 'k_one.md'), '# First task\n\nnotes here\n')
  if (withBookmark && !broken) {
    writeFileSync(join(dir, 'bookmarks.json'), JSON.stringify({
      bookmarks: [{ name: 'Overview', collapsed: ['p_root'], zoom: 1.4, anchor: ['k_one', 'p_root'] }],
    }, null, 2))
  }
  return dir
}

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'pensagrex-migrate-'))
})
afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
})

const newRoot = () => join(h.userData, 'domains')
const oldRoot = () => join(h.userData, 'forests')

describe('the schema-2 to schema-3 library move', () => {
  it('does nothing when there is no old library', () => {
    expect(migrateLibraryIfNeeded()).toEqual({ migrated: [], failed: [], skipped: 0 })
  })

  it('migrates a domain into a labelled directory whose record validates', () => {
    oldDomain('HomeLab')
    const res = migrateLibraryIfNeeded()
    expect(res.failed).toEqual([])
    expect(res.migrated).toHaveLength(1)

    const [d] = res.migrated
    expect(d.title).toBe('HomeLab')
    expect(d.id).toMatch(/^d_[0-9a-z]{10}$/)
    expect(d.dir).toBe('pensagrex_domain_homelab_' + d.id)
    // Termini: the old domain's five nodes, plus the one close schema 3 requires for
    // its single project node. The count is six because the migration adds that close,
    // not because anything of the old domain was dropped.
    expect(d.nodes).toBe(6)

    const target = join(newRoot(), d.dir)
    const record = JSON.parse(readFileSync(join(target, 'domain.json'), 'utf-8'))
    expect(record.schemaVersion).toBe(3)
    expect(record.title).toBe('HomeLab')
    expect(record.id).toBe(d.id)
    expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
    expect(Object.keys(record.nodes)).toHaveLength(6)
    expect(Object.keys(titled(record)).sort()).toEqual(
      ['A project', 'First task', 'Second task', 'Sidelong', 'Underneath'],
    )
    // Termini: one close, and it says nothing of its own — no title, no flag, and, as
    // the plan's own close, no edge above it to carry anything.
    const termini = terminiOf(record)
    expect(termini).toHaveLength(1)
    expect(termini[0].title).toBeUndefined()
    expect(termini[0].flagged).toBeUndefined()
    expect(termini[0].next).toBe(null)
    expect(termini[0].leftBranches).toEqual([])
    expect(termini[0].rightBranches).toEqual([])
    // Every id is reminted, so none of the old ones survive.
    for (const id of Object.keys(record.nodes)) expect(id).toMatch(/^n_[0-9a-z]{10}$/)
  })

  it('preserves the shape: the line, the statuses, the cursor, and both forks', () => {
    oldDomain('HomeLab')
    const [d] = migrateLibraryIfNeeded().migrated
    const record = JSON.parse(readFileSync(join(newRoot(), d.dir, 'domain.json'), 'utf-8'))
    const byTitle = titled(record)

    expect(byTitle['A project'].kind).toBe('project')
    expect(byTitle['A project'].next).toBe(byTitle['First task'].id)
    expect(byTitle['First task'].next).toBe(byTitle['Second task'].id)
    expect(byTitle['First task'].here).toBe(true)
    expect(byTitle['First task'].status).toBe('in-progress')
    expect(byTitle.Underneath.status).toBe('completed')
    expect(byTitle.Underneath.completedAt).toBe('2026-06-05T09:00:00Z')

    // The at:'above' fork stays on its own node, on the side it was on.
    expect(byTitle['First task'].leftBranches).toEqual([byTitle.Sidelong.id])
    // The at:'below' fork on "Second task" moves to its main-line predecessor,
    // which is the node whose rising edge is the gap below it.
    expect(byTitle['First task'].rightBranches).toEqual([byTitle.Underneath.id])
    expect(byTitle['Second task'].rightBranches).toEqual([])

    // Termini: the close lands where schema 2 already meant the project's scope to
    // end — at the top of the trunk it opened on, above "Second task" — and the
    // pairing derived from the trunk names it as the close of "A project". The two
    // branch trunks hold no project node, so neither gains a close.
    const [terminus] = terminiOf(record)
    expect(byTitle['Second task'].next).toBe(terminus.id)
    expect(pairScopes(record, trunksOf(record)).pairs.get(byTitle['A project'].id)).toBe(terminus.id)
    expect(byTitle.Sidelong.next).toBe(null)
    expect(byTitle.Underneath.next).toBe(null)

    // And the model still builds one tree over every node: the old five and the close.
    const model = buildModel(record)
    expect(model.trees).toHaveLength(1)
    expect(model.nodes.size).toBe(6)
  })

  it('copies each note into notes/ under its new id-and-slug name', () => {
    oldDomain('HomeLab')
    const [d] = migrateLibraryIfNeeded().migrated
    expect(d.notesCopied).toBe(1)
    expect(d.notesMissing).toEqual([])

    const target = join(newRoot(), d.dir)
    const record = JSON.parse(readFileSync(join(target, 'domain.json'), 'utf-8'))
    const noted = Object.values(record.nodes).find((n) => n.note)
    expect(noted.title).toBe('First task')
    expect(noted.note).toBe(noted.id + '_first-task.md')
    expect(readFileSync(join(target, 'notes', noted.note), 'utf-8')).toBe('# First task\n\nnotes here\n')
  })

  it('reports a note the old domain names but does not have, and migrates anyway', () => {
    const dir = oldDomain('HomeLab')
    rmSync(join(dir, 'k_one.md'))
    const [d] = migrateLibraryIfNeeded().migrated
    expect(d.notesCopied).toBe(0)
    expect(d.notesMissing).toEqual(['k_one.md'])
    expect(existsSync(join(newRoot(), d.dir, 'domain.json'))).toBe(true)
  })

  it('rewrites bookmarks device-independently, with the new ids and no zoom', () => {
    oldDomain('HomeLab')
    const [d] = migrateLibraryIfNeeded().migrated
    expect(d.bookmarks).toBe(1)

    const target = join(newRoot(), d.dir)
    const record = JSON.parse(readFileSync(join(target, 'domain.json'), 'utf-8'))
    const byTitle = Object.fromEntries(Object.values(record.nodes).map((n) => [n.title, n]))
    const bm = JSON.parse(readFileSync(join(target, 'bookmarks.json'), 'utf-8')).bookmarks[0]

    expect(bm.name).toBe('Overview')
    expect(bm.collapsed).toEqual([byTitle['A project'].id])
    expect(bm.nodes).toEqual([byTitle['First task'].id]) // the old anchor, remapped
    expect('zoom' in bm).toBe(false)
    expect('anchor' in bm).toBe(false)
  })

  it('leaves the old library untouched apart from an additive marker', () => {
    const dir = oldDomain('HomeLab')
    const before = readFileSync(join(dir, 'forest.json5'), 'utf-8')
    const [d] = migrateLibraryIfNeeded().migrated

    expect(readFileSync(join(dir, 'forest.json5'), 'utf-8')).toBe(before)
    expect(existsSync(join(dir, 'k_one.md'))).toBe(true)
    expect(existsSync(join(dir, 'bookmarks.json'))).toBe(true)

    const marker = JSON.parse(readFileSync(join(oldRoot(), '.pensagrex-migrated.json'), 'utf-8'))
    expect(marker.migratedTo).toBe(newRoot())
    expect(marker.domains.HomeLab.id).toBe(d.id)
    expect(marker.domains.HomeLab.dir).toBe(d.dir)
    // Termini: six, the migrated node count, which now includes the project's close.
    expect(marker.domains.HomeLab.nodes).toBe(6)
    expect(typeof marker.domains.HomeLab.at).toBe('string')
  })

  it('is a no-op on the second run, so every launch after the first costs nothing', () => {
    oldDomain('HomeLab')
    expect(migrateLibraryIfNeeded().migrated).toHaveLength(1)
    const second = migrateLibraryIfNeeded()
    expect(second.migrated).toEqual([])
    expect(second.skipped).toBe(1)
    expect(readdirSync(newRoot())).toHaveLength(1) // not migrated twice
  })

  it('migrates every domain it can and reports the one it cannot', () => {
    oldDomain('HomeLab')
    oldDomain('Work')
    oldDomain('Wrecked', { broken: true })
    const res = migrateLibraryIfNeeded()
    expect(res.migrated.map((d) => d.title).sort()).toEqual(['HomeLab', 'Work'])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].dir).toBe('Wrecked')
    // The broken domain's own files are left exactly as they were.
    expect(readFileSync(join(oldRoot(), 'Wrecked', 'forest.json5'), 'utf-8')).toBe('{ this is not json at all ')
  })

  it('lists the migrated domains through the store, by their titles', () => {
    oldDomain('HomeLab')
    oldDomain('Work')
    migrateLibraryIfNeeded()
    expect(store.listDomains().map((d) => d.name)).toEqual(['HomeLab', 'Work'])
  })

  it('also migrates schema-2 domains sitting in a repointed library root', () => {
    // A user who chose their own library folder has their old domains there, not
    // under userData/forests, and that folder is also the new root.
    const custom = mkdtempSync(join(tmpdir(), 'pensagrex-custom-'))
    try {
      store.setLibraryRoot(custom)
      const dir = join(custom, 'Elsewhere')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'forest.json5'), '{ schema: 2, domain: "Elsewhere", rootOrder: ["p"], tasks: { p: { id: "p", title: "P", kind: "project", createdAt: "x", note: null, next: null, branches: [] } } }\n')

      const res = migrateLibraryIfNeeded()
      expect(res.failed).toEqual([])
      expect(res.migrated.map((d) => d.title)).toEqual(['Elsewhere'])
      expect(store.listDomains().map((d) => d.name)).toEqual(['Elsewhere'])

      // Termini: a lone project node migrates to the smallest legal plan — the base
      // and its close, with nothing between them.
      const record = JSON.parse(readFileSync(join(custom, res.migrated[0].dir, 'domain.json'), 'utf-8'))
      expect(validateRecord(record)).toEqual({ ok: true, errors: [] })
      const base = titled(record).P
      const [close] = terminiOf(record)
      expect(base.next).toBe(close.id)
      expect(close.next).toBe(null)
      // The old directory is still there, beside the new one.
      expect(existsSync(join(dir, 'forest.json5'))).toBe(true)
    } finally {
      rmSync(custom, { recursive: true, force: true })
    }
  })
})
