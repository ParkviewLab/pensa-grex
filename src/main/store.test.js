// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Integration test for the persistence store against a real temporary directory.
// Only electron's app.getPath is mocked (the store's one electron dependency);
// every filesystem operation runs for real, so this exercises the actual
// create/load/save/note round trips and the path-safety boundary end to end.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'


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
  h.userData = mkdtempSync(join(tmpdir(), 'pensagrex-store-'))
  h.trashed = []
})
afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
})

describe('library root and settings', () => {
  it('defaults the library root under userData', () => {
    expect(store.getLibraryRoot()).toBe(join(h.userData, 'domains'))
  })

  it('repoints the library root and persists it', () => {
    const other = mkdtempSync(join(tmpdir(), 'pensagrex-lib-'))
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
    expect(store.getLibraryRoot()).toBe(join(h.userData, 'domains'))
  })
})

describe('domains', () => {
  it('creates a loadable, valid-shaped domain and lists it', () => {
    const created = store.createDomain('HomeLab')
    expect(created.name).toBe('HomeLab')
    expect(created.id).toMatch(/^d_[0-9a-z]{10}$/)
    expect(basename(created.path)).toBe('pensagrex_domain_homelab_' + created.id)
    const load = store.loadDomainFile(created.path)
    // Written as plain JSON, so the strict parser reads it (northstar axiom 7).
    const parsed = JSON.parse(load.text)
    expect(parsed.schema).toBe(2)
    expect(parsed.id).toBe(created.id)
    expect(parsed.domain).toBe('HomeLab')
    expect(parsed.rootOrder).toEqual([])
    expect(existsSync(join(created.path, 'notes'))).toBe(true)
    expect(store.listDomains()).toEqual([{ id: created.id, name: 'HomeLab', path: created.path }])
  })

  it('takes the listed name from the record, not from the directory label', () => {
    const created = store.createDomain('HomeLab')
    const rec = JSON.parse(store.loadDomainFile(created.path).text)
    rec.domain = 'Renamed In Place'
    store.saveDomainFile(created.path, JSON.stringify(rec, null, 2) + '\n')
    // The directory label still says homelab; the title is the record's.
    expect(basename(created.path)).toContain('homelab')
    expect(store.listDomains()[0].name).toBe('Renamed In Place')
  })

  it('ignores a directory in the library root that is not one of ours', () => {
    const created = store.createDomain('HomeLab')
    mkdirSync(join(h.userData, 'domains', 'some-other-tool'), { recursive: true })
    writeFileSync(join(h.userData, 'domains', 'some-other-tool', 'domain.json'), '{}', 'utf-8')
    expect(store.listDomains().map((d) => d.path)).toEqual([created.path])
  })

  it('lists multiple domains sorted by name', () => {
    store.createDomain('Work')
    store.createDomain('HomeLab')
    expect(store.listDomains().map((d) => d.name)).toEqual(['HomeLab', 'Work'])
  })

  it('round-trips saved domain text verbatim', () => {
    const { path } = store.createDomain('HomeLab')
    const text = '{ "schema": 2, "domain": "HomeLab", "rootOrder": [], "tasks": {} }\n'
    expect(store.saveDomainFile(path, text)).toEqual({ ok: true })
    expect(store.loadDomainFile(path).text).toBe(text)
  })

  it('rejects a duplicate title, and an unusable one', () => {
    store.createDomain('HomeLab')
    // Two domains answering to one name is worse than a refusal: a person and the
    // MCP surface both name a domain by its title.
    expect(store.createDomain('HomeLab').error).toMatch(/already exists/)
    expect(store.createDomain('').error).toBeTruthy()
    expect(store.createDomain(' padded ').error).toBeTruthy()
  })

  it('accepts a title that would have been an illegal directory name', () => {
    // The title is no longer a path segment, so a separator is fine: the slug is.
    const created = store.createDomain('AI/ML')
    expect(created.error).toBeUndefined()
    expect(basename(created.path)).toBe('pensagrex_domain_ai-ml_' + created.id)
    expect(store.listDomains()[0].name).toBe('AI/ML')
  })

  it('deletes a domain by moving it to the Trash', async () => {
    const home = store.createDomain('HomeLab')
    store.createDomain('Work')
    const res = await store.deleteDomain(home.path)
    expect(res).toEqual({ ok: true })
    expect(h.trashed).toContain(home.path) // trashItem was called with the bound-checked path
    expect(store.listDomains().map((d) => d.name)).toEqual(['Work']) // gone from the library
  })

  it('refuses to delete a directory that is not a domain', async () => {
    const res = await store.deleteDomain(join(h.userData, 'forests', 'not-a-domain'))
    expect(res.error).toBeTruthy()
    expect(h.trashed).toEqual([])
  })
})

describe('notes', () => {
  it('round-trips a note and reports a missing note as empty', () => {
    const { path } = store.createDomain('HomeLab')
    expect(store.readNote(path, 'k_plex.md')).toEqual({ content: '' })
    store.writeNote(path, 'k_plex.md', '# hello\n')
    expect(store.readNote(path, 'k_plex.md').content).toBe('# hello\n')
    store.deleteNote(path, 'k_plex.md')
    expect(store.readNote(path, 'k_plex.md')).toEqual({ content: '' })
  })

  it('writes into the domain notes/ directory, not beside the record', () => {
    const { path } = store.createDomain('HomeLab')
    store.writeNote(path, 'n_mrtwgppt03_draft-jd.md', 'x')
    expect(existsSync(join(path, 'notes', 'n_mrtwgppt03_draft-jd.md'))).toBe(true)
    expect(existsSync(join(path, 'n_mrtwgppt03_draft-jd.md'))).toBe(false)
  })

  it('recreates a missing notes/ directory rather than failing the write', () => {
    // A domain directory can arrive without it: a hand copy, a Trash restore.
    const { path } = store.createDomain('HomeLab')
    rmSync(join(path, 'notes'), { recursive: true, force: true })
    expect(store.writeNote(path, 'n_a.md', 'x')).toEqual({ ok: true })
    expect(store.readNote(path, 'n_a.md').content).toBe('x')
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

describe('bookmarks', () => {
  it('round-trips bookmark text in the domain directory and reads a missing file as empty', () => {
    const { path } = store.createDomain('HomeLab')
    expect(store.getBookmarks(path)).toEqual({ text: '' })
    const text = JSON.stringify({ bookmarks: [{ name: 'Overview', collapsed: [], zoom: 1, anchor: ['k_a'] }] })
    expect(store.setBookmarks(path, text)).toEqual({ ok: true })
    expect(store.getBookmarks(path).text).toBe(text)
  })

  it('bounds bookmark paths to the library root', () => {
    expect(store.getBookmarks('/etc').error).toMatch(/library root/)
    expect(store.setBookmarks('/etc', '[]').error).toMatch(/library root/)
  })
})

describe('path safety', () => {
  it('refuses a domain path outside the library root', async () => {
    expect(store.loadDomainFile('/etc').error).toMatch(/library root/)
    expect(store.saveDomainFile('/etc', 'x').error).toMatch(/library root/)
    expect((await store.deleteDomain('/etc')).error).toMatch(/library root/)
    expect(h.trashed).toEqual([]) // never reaches trashItem
  })

  it('refuses a note filename that is not a bare .md name', () => {
    const { path } = store.createDomain('HomeLab')
    expect(store.readNote(path, '../secret.md').error).toMatch(/invalid note/)
    expect(store.writeNote(path, 'a/b.md', 'x').error).toMatch(/invalid note/)
    expect(store.readNote(path, 'notes.txt').error).toMatch(/invalid note/)
  })
})
