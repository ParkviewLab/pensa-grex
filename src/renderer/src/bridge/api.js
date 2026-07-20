// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// A thin renderer-side wrapper over window.taskforkstack (the preload bridge).
// Two jobs beyond forwarding: it adds a per-domain debounced save so a burst of
// edits collapses into one write (the same 500 ms cadence conception-space uses
// for note autosave), and it provides an in-memory fallback so the built
// renderer still runs without the Electron main process — for instance served
// over a plain HTTP server during visual checks. The fallback is not persistent
// (nothing reaches disk); api.persistent tells the caller which it got.

import homelabRaw from '../model/fixtures/homelab.forest.json5?raw'
import workRaw from '../model/fixtures/work.forest.json5?raw'

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
    readNote:          (dir, file) => bridge.readNote(dir, file),
    writeNote:         (dir, file, text) => bridge.writeNote(dir, file, text),
    deleteNote:        (dir, file) => bridge.deleteNote(dir, file),
    openExternal:      (url) => bridge.openExternal(url),
    getViewState:      (domain) => bridge.getViewState(domain),
    setViewState:      (domain, state) => bridge.setViewState(domain, state),
  }
}

function makeFallback() {
  const forests = new Map([
    ['/virtual/HomeLab', homelabRaw],
    ['/virtual/Work', workRaw],
  ])
  const notes = new Map()
  const viewState = new Map()
  let lastDomain = null
  const domains = () =>
    [...forests.keys()].map((path) => ({ name: path.split('/').pop(), path })).sort((a, b) => a.name.localeCompare(b.name))
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
    readNote:          async (dir, file) => ({ content: notes.get(dir + '/' + file) || '' }),
    writeNote:         async (dir, file, text) => { notes.set(dir + '/' + file, text); return { ok: true } },
    deleteNote:        async (dir, file) => { notes.delete(dir + '/' + file); return { ok: true } },
    openExternal:      async (url) => { window.open(url, '_blank', 'noopener') },
    getViewState:      async (domain) => viewState.get(domain) || { collapsed: [] },
    setViewState:      async (domain, state) => { viewState.set(domain, { collapsed: (state && state.collapsed) || [] }); return { ok: true } },
  }
}

export function createApi() {
  const raw = window.taskforkstack
  const base = raw && Object.keys(raw).length ? wrapRealBridge(raw) : makeFallback()

  // Set by the caller to be told when a debounced forest save fails, so a lost
  // write is never silent (the on-screen edit would otherwise not reach disk).
  base.onSaveError = null

  const timers = new Map() // dir -> timeout id
  const pending = new Map() // dir -> latest text awaiting a write

  async function writeNow(dir) {
    const text = pending.get(dir)
    pending.delete(dir)
    timers.delete(dir)
    if (text === undefined) return
    try {
      const r = await base.saveForest(dir, text)
      if (r && r.error) throw new Error(r.error)
    } catch (e) {
      const msg = (e && e.message) || String(e)
      console.error('forest save failed:', msg)
      if (base.onSaveError) base.onSaveError(msg)
    }
  }

  base.saveForestDebounced = (dir, text, ms = 500) => {
    pending.set(dir, text)
    clearTimeout(timers.get(dir))
    timers.set(dir, setTimeout(() => writeNow(dir), ms))
  }

  // Drop a domain's queued debounced save without writing it — call before
  // deleting that domain, so a pending write cannot re-create the trashed forest.
  base.cancelPendingSave = (dir) => {
    clearTimeout(timers.get(dir))
    timers.delete(dir)
    pending.delete(dir)
  }

  // Force every pending debounced write to happen now — call before the window
  // closes so an edit made within the debounce window is not lost on quit.
  base.flushSaves = () => {
    for (const dir of [...timers.keys()]) {
      clearTimeout(timers.get(dir))
      writeNow(dir)
    }
  }
  return base
}
