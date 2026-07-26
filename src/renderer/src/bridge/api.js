// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// A thin renderer-side wrapper over window.pensagrex (the preload bridge). Its
// one job beyond forwarding is an in-memory fallback so the built renderer still
// runs without the Electron main process — for instance served over a plain HTTP
// server during visual checks. The fallback runs the SAME task authority the
// main process does (the shared runOp/readRecord over its own Map), so an
// edit behaves identically with or without Electron; it is just not persistent
// (nothing reaches disk). api.persistent tells the caller which it got.

import { runOp as runOpCore, readRecord as readRecordCore } from '../../../shared/domainOps.js'
import { mintDomainId } from '../../../shared/model/ids.js'
import homelabRaw from '../../../shared/model/fixtures/homelab.record.json?raw'
import workRaw from '../../../shared/model/fixtures/work.record.json?raw'

function wrapRealBridge(bridge) {
  return {
    persistent: true,
    getSettings:       () => bridge.getSettings(),
    setLastDomain:     (name) => bridge.setLastDomain(name),
    getLibraryRoot:    () => bridge.getLibraryRoot(),
    chooseLibraryRoot: () => bridge.chooseLibraryRoot(),
    listDomains:       () => bridge.listDomains(),
    createDomain:      (name) => bridge.createDomain(name),
    deleteDomain:      (dir) => bridge.deleteDomain(dir),
    loadDomainFile:    (dir) => bridge.loadDomainFile(dir),
    saveDomainFile:    (dir, text) => bridge.saveDomainFile(dir, text),
    readRecord:        (dir) => bridge.readRecord(dir),
    runOp:             (dir, op, ...args) => bridge.runOp(dir, op, ...args),
    mcpStatus:         () => bridge.mcpStatus(),
    mcpSetEnabled:     (enabled) => bridge.mcpSetEnabled(enabled),
    onDomainChanged:   (cb) => bridge.onDomainChanged(cb),
    onDomainsChanged:  (cb) => bridge.onDomainsChanged(cb),
    readNote:          (dir, file) => bridge.readNote(dir, file),
    writeNote:         (dir, file, text) => bridge.writeNote(dir, file, text),
    deleteNote:        (dir, file) => bridge.deleteNote(dir, file),
    openExternal:      (url) => bridge.openExternal(url),
    getViewState:      (domain) => bridge.getViewState(domain),
    setViewState:      (domain, state) => bridge.setViewState(domain, state),
    exportMarkdown:    (defaultName, text) => bridge.exportMarkdown(defaultName, text),
    getBookmarks:      (dir) => bridge.getBookmarks(dir),
    setBookmarks:      (dir, text) => bridge.setBookmarks(dir, text),
  }
}

function makeFallback() {
  const files = new Map([
    ['/virtual/HomeLab', homelabRaw],
    ['/virtual/Work', workRaw],
  ])
  // The store gives every domain an id and takes its title from the record; the
  // fallback has no directory labels to imitate, so it keeps the same shape with
  // a virtual path standing in for the directory.
  const ids = new Map([['/virtual/HomeLab', 'd_0000000001'], ['/virtual/Work', 'd_0000000002']])
  const notes = new Map()
  const viewState = new Map()
  const bookmarks = new Map()
  let lastDomain = null
  const domains = () =>
    [...files.keys()]
      .map((path) => ({ id: ids.get(path) || null, name: path.split('/').pop(), path }))
      .sort((a, b) => a.name.localeCompare(b.name))
  // The same task authority the main process runs, over the in-memory Maps, so a
  // no-Electron edit behaves exactly like the real one (mutate, validate, then
  // persist to the Map). Text-based, matching the store's opaque-text contract.
  const storage = {
    loadText: (dir) => (files.has(dir) ? { text: files.get(dir) } : { error: 'not found' }),
    saveText: (dir, text) => { files.set(dir, text); return { ok: true } },
    writeNote: (dir, file, content) => { notes.set(dir + '/' + file, content); return { ok: true } },
  }
  return {
    persistent: false,
    getSettings:       async () => ({ libraryRoot: '/virtual', lastDomain }),
    setLastDomain:     async (name) => { lastDomain = name; return { ok: true } },
    getLibraryRoot:    async () => '/virtual',
    chooseLibraryRoot: async () => ({ canceled: true }),
    listDomains:       async () => domains(),
    createDomain:      async (name) => {
      const path = '/virtual/' + name
      if (files.has(path)) return { error: 'exists' }
      const id = mintDomainId()
      ids.set(path, id)
      files.set(path, JSON.stringify({ schema: 2, id, domain: name, planOrder: [], tasks: {} }, null, 2) + '\n')
      return { id, name, path }
    },
    deleteDomain:      async (dir) => {
      files.delete(dir)
      ids.delete(dir)
      for (const key of [...notes.keys()]) if (key.startsWith(dir + '/')) notes.delete(key)
      return { ok: true }
    },
    loadDomainFile:    async (dir) => (files.has(dir) ? { text: files.get(dir) } : { error: 'not found' }),
    saveDomainFile:    async (dir, text) => { files.set(dir, text); return { ok: true } },
    readRecord:        async (dir) => readRecordCore(storage, dir),
    runOp:             async (dir, op, ...args) => runOpCore(storage, dir, op, args),
    // The MCP server lives in the Electron main process; the no-Electron fallback
    // reports it as unavailable rather than pretending to host it.
    mcpStatus:         async () => ({ enabled: false, running: false, url: null, port: null, scope: null, error: 'the MCP server runs only in the desktop app' }),
    mcpSetEnabled:     async () => ({ enabled: false, running: false, url: null, port: null, scope: null, error: 'the MCP server runs only in the desktop app' }),
    // No external writer without Electron: nothing to subscribe to.
    onDomainChanged:   () => () => {},
    onDomainsChanged:  () => () => {},
    readNote:          async (dir, file) => ({ content: notes.get(dir + '/' + file) || '' }),
    writeNote:         async (dir, file, text) => { notes.set(dir + '/' + file, text); return { ok: true } },
    deleteNote:        async (dir, file) => { notes.delete(dir + '/' + file); return { ok: true } },
    openExternal:      async (url) => { window.open(url, '_blank', 'noopener') },
    getViewState:      async (domain) => viewState.get(domain) || { collapsed: [] },
    setViewState:      async (domain, state) => { viewState.set(domain, { collapsed: (state && state.collapsed) || [] }); return { ok: true } },
    // No native dialog without Electron: save via a browser download, the honest
    // no-app equivalent of writing the file to a place the user chose.
    exportMarkdown:    async (defaultName, text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
      const a = document.createElement('a')
      a.href = url
      a.download = (typeof defaultName === 'string' && defaultName) ? defaultName : 'project.md'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      return { ok: true, path: a.download }
    },
    getBookmarks:      async (dir) => ({ text: bookmarks.get(dir) || '' }),
    setBookmarks:      async (dir, text) => { bookmarks.set(dir, text); return { ok: true } },
  }
}

export function createApi() {
  const injected = window.pensagrex
  // No debounced record save any more: every edit is a task op that main writes
  // synchronously and atomically (or the fallback writes to its Map), so there is
  // nothing to batch, flush, or cancel. Notes keep their own autosave elsewhere.
  return injected && Object.keys(injected).length ? wrapRealBridge(injected) : makeFallback()
}
