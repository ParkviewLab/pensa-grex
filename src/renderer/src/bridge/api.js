// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// A thin renderer-side wrapper over window.pensagrex (the preload bridge). Its
// one job beyond forwarding is an in-memory fallback so the built renderer still
// runs without the Electron main process — for instance served over a plain HTTP
// server during visual checks. The fallback runs the SAME task authority the
// main process does (the shared runTaskOp/readForest over its own Map), so an
// edit behaves identically with or without Electron; it is just not persistent
// (nothing reaches disk). api.persistent tells the caller which it got.

import { runTaskOp, readForest as readForestCore } from '../../../shared/taskOps.js'
import homelabRaw from '../../../shared/model/fixtures/homelab.forest.json5?raw'
import workRaw from '../../../shared/model/fixtures/work.forest.json5?raw'

function wrapRealBridge(bridge) {
  return {
    persistent: true,
    getSettings:       () => bridge.getSettings(),
    setLastDomain:     (name) => bridge.setLastDomain(name),
    getLibraryRoot:    () => bridge.getLibraryRoot(),
    chooseLibraryRoot: () => bridge.chooseLibraryRoot(),
    listDomains:       () => bridge.listDomains(),
    createForest:      (name) => bridge.createForest(name),
    deleteForest:      (dir) => bridge.deleteForest(dir),
    loadForest:        (dir) => bridge.loadForest(dir),
    saveForest:        (dir, text) => bridge.saveForest(dir, text),
    readForest:        (dir) => bridge.readForest(dir),
    taskOp:            (dir, op, ...args) => bridge.taskOp(dir, op, ...args),
    mcpStatus:         () => bridge.mcpStatus(),
    mcpSetEnabled:     (enabled) => bridge.mcpSetEnabled(enabled),
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
  const forests = new Map([
    ['/virtual/HomeLab', homelabRaw],
    ['/virtual/Work', workRaw],
  ])
  const notes = new Map()
  const viewState = new Map()
  const bookmarks = new Map()
  let lastDomain = null
  const domains = () =>
    [...forests.keys()].map((path) => ({ name: path.split('/').pop(), path })).sort((a, b) => a.name.localeCompare(b.name))
  // The same task authority the main process runs, over the in-memory Maps, so a
  // no-Electron edit behaves exactly like the real one (mutate, validate, then
  // persist to the Map). Text-based, matching the store's opaque-text contract.
  const storage = {
    loadText: (dir) => (forests.has(dir) ? { text: forests.get(dir) } : { error: 'not found' }),
    saveText: (dir, text) => { forests.set(dir, text); return { ok: true } },
    writeNote: (dir, file, content) => { notes.set(dir + '/' + file, content); return { ok: true } },
  }
  return {
    persistent: false,
    getSettings:       async () => ({ libraryRoot: '/virtual', lastDomain }),
    setLastDomain:     async (name) => { lastDomain = name; return { ok: true } },
    getLibraryRoot:    async () => '/virtual',
    chooseLibraryRoot: async () => ({ canceled: true }),
    listDomains:       async () => domains(),
    createForest:      async (name) => {
      const path = '/virtual/' + name
      if (forests.has(path)) return { error: 'exists' }
      forests.set(path, `{ schema: 2, domain: ${JSON.stringify(name)}, rootOrder: [], tasks: {} }\n`)
      return { name, path }
    },
    deleteForest:      async (dir) => {
      forests.delete(dir)
      for (const key of [...notes.keys()]) if (key.startsWith(dir + '/')) notes.delete(key)
      return { ok: true }
    },
    loadForest:        async (dir) => (forests.has(dir) ? { text: forests.get(dir) } : { error: 'not found' }),
    saveForest:        async (dir, text) => { forests.set(dir, text); return { ok: true } },
    readForest:        async (dir) => readForestCore(storage, dir),
    taskOp:            async (dir, op, ...args) => runTaskOp(storage, dir, op, args),
    // The MCP server lives in the Electron main process; the no-Electron fallback
    // reports it as unavailable rather than pretending to host it.
    mcpStatus:         async () => ({ enabled: false, running: false, url: null, port: null, scope: null, error: 'the MCP server runs only in the desktop app' }),
    mcpSetEnabled:     async () => ({ enabled: false, running: false, url: null, port: null, scope: null, error: 'the MCP server runs only in the desktop app' }),
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
  const raw = window.pensagrex
  // No debounced forest save any more: every edit is a task op that main writes
  // synchronously and atomically (or the fallback writes to its Map), so there is
  // nothing to batch, flush, or cancel. Notes keep their own autosave elsewhere.
  return raw && Object.keys(raw).length ? wrapRealBridge(raw) : makeFallback()
}
