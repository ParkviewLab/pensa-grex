// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Integration test for the persistence store against a real temporary directory.
// Only electron's app.getPath is mocked (the store's one electron dependency);
// every filesystem operation runs for real, so this exercises the actual
// create/load/save/note round trips and the path-safety boundary end to end.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSON5 from 'json5'

// shell.trashItem is mocked (no real Trash in a headless test): it records the
// call and, via h.rm, actually removes the source so listDomains reflects it.
const h = vi.hoisted(() => ({ userData: '', trashed: [] }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  shell: { trashItem: async (p) => { h.trashed.push(p); if (h.rm) h.rm(p) } },
}))
h.rm = (p) => rmSync(p, { recursive: true, force: true })

const store = await import('./store.js')

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'tfs-store-'))
  h.trashed = []
})
afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
})

describe('library root and settings', () => {
  it('defaults the library root under userData', () => {
    expect(store.getLibraryRoot()).toBe(join(h.userData, 'forests'))
  })

  it('repoints the library root and persists it', () => {
    const other = mkdtempSync(join(tmpdir(), 'tfs-lib-'))
    store.setLibraryRoot(other)
    expect(store.getLibraryRoot()).toBe(other)
    expect(store.getSettings().libraryRoot).toBe(other)
    rmSync(other, { recursive: true, force: true })
  })

  it('persists the last-opened domain', () => {
    store.setLastDomain('Work')
    expect(store.getSettings().lastDomain).toBe('Work')
  })

  it('refuses to overwrite a corrupt settings.json, preserving the library root', () => {
    const p = join(h.userData, 'settings.json')
    writeFileSync(p, '{ this is not valid json', 'utf-8')
    const res = store.setLastDomain('HomeLab')
    expect(res.error).toMatch(/unreadable/)
    expect(readFileSync(p, 'utf-8')).toBe('{ this is not valid json') // untouched
    // read-only accessors tolerate the corruption by falling back to the default
    expect(store.getLibraryRoot()).toBe(join(h.userData, 'forests'))
  })
})

describe('domains', () => {
  it('creates a loadable, valid-shaped forest and lists it', () => {
    const created = store.createForest('HomeLab')
    expect(created.name).toBe('HomeLab')
    const load = store.loadForest(created.path)
    const parsed = JSON5.parse(load.text)
    expect(parsed.schema).toBe(2)
    expect(parsed.domain).toBe('HomeLab')
    expect(parsed.rootOrder).toEqual([])
    expect(store.listDomains()).toEqual([{ name: 'HomeLab', path: created.path }])
  })

  it('lists multiple domains sorted by name', () => {
    store.createForest('Work')
    store.createForest('HomeLab')
    expect(store.listDomains().map((d) => d.name)).toEqual(['HomeLab', 'Work'])
  })

  it('round-trips a saved forest', () => {
    const { path } = store.createForest('HomeLab')
    const text = '{ schema: 2, domain: "HomeLab", rootOrder: [], tasks: {} }\n'
    expect(store.saveForest(path, text)).toEqual({ ok: true })
    expect(store.loadForest(path).text).toBe(text)
  })

  it('rejects a duplicate or invalid domain name', () => {
    store.createForest('HomeLab')
    expect(store.createForest('HomeLab').error).toMatch(/already exists/)
    expect(store.createForest('../evil').error).toBeTruthy()
    expect(store.createForest('a/b').error).toBeTruthy()
  })

  it('deletes a domain by moving it to the Trash', async () => {
    const home = store.createForest('HomeLab')
    store.createForest('Work')
    const res = await store.deleteForest(home.path)
    expect(res).toEqual({ ok: true })
    expect(h.trashed).toContain(home.path) // trashItem was called with the bound-checked path
    expect(store.listDomains().map((d) => d.name)).toEqual(['Work']) // gone from the library
  })

  it('refuses to delete a directory that is not a domain', async () => {
    const res = await store.deleteForest(join(h.userData, 'forests', 'not-a-domain'))
    expect(res.error).toBeTruthy()
    expect(h.trashed).toEqual([])
  })
})

describe('notes', () => {
  it('round-trips a note and reports a missing note as empty', () => {
    const { path } = store.createForest('HomeLab')
    expect(store.readNote(path, 'k_plex.md')).toEqual({ content: '' })
    store.writeNote(path, 'k_plex.md', '# hello\n')
    expect(store.readNote(path, 'k_plex.md').content).toBe('# hello\n')
    store.deleteNote(path, 'k_plex.md')
    expect(store.readNote(path, 'k_plex.md')).toEqual({ content: '' })
  })
})

describe('view state', () => {
  it('round-trips collapsed ids per domain and reports an unknown domain as empty', () => {
    expect(store.getViewState('HomeLab')).toEqual({ collapsed: [] })
    store.setViewState('HomeLab', { collapsed: ['k_a', 'k_b'] })
    expect(store.getViewState('HomeLab').collapsed).toEqual(['k_a', 'k_b'])
    store.setViewState('Work', { collapsed: ['k_c'] })
    expect(store.getViewState('HomeLab').collapsed).toEqual(['k_a', 'k_b']) // kept, keyed per domain
    expect(store.getViewState('Work').collapsed).toEqual(['k_c'])
  })

  it('tolerates a corrupt view-state file by reading empty (view state is disposable)', () => {
    writeFileSync(join(h.userData, 'viewstate.json'), '{ not json', 'utf-8')
    expect(store.getViewState('HomeLab')).toEqual({ collapsed: [] })
  })
})

describe('path safety', () => {
  it('refuses a domain path outside the library root', async () => {
    expect(store.loadForest('/etc').error).toMatch(/library root/)
    expect(store.saveForest('/etc', 'x').error).toMatch(/library root/)
    expect((await store.deleteForest('/etc')).error).toMatch(/library root/)
    expect(h.trashed).toEqual([]) // never reaches trashItem
  })

  it('refuses a note filename that is not a bare .md name', () => {
    const { path } = store.createForest('HomeLab')
    expect(store.readNote(path, '../secret.md').error).toMatch(/invalid note/)
    expect(store.writeNote(path, 'a/b.md', 'x').error).toMatch(/invalid note/)
    expect(store.readNote(path, 'notes.txt').error).toMatch(/invalid note/)
  })
})
