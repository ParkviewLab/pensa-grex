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
    loadForest:        (dir) => bridge.loadForest(dir),
    saveForest:        (dir, text) => bridge.saveForest(dir, text),
    readNote:          (dir, file) => bridge.readNote(dir, file),
    writeNote:         (dir, file, text) => bridge.writeNote(dir, file, text),
    deleteNote:        (dir, file) => bridge.deleteNote(dir, file),
  }
}

function makeFallback() {
  const forests = new Map([
    ['/virtual/HomeLab', homelabRaw],
    ['/virtual/Work', workRaw],
  ])
  const notes = new Map()
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
      forests.set(path, `{ schema: 1, domain: ${JSON.stringify(name)}, trees: [], tasks: {} }\n`)
      return { name, path }
    },
    loadForest:        async (dir) => (forests.has(dir) ? { text: forests.get(dir) } : { error: 'not found' }),
    saveForest:        async (dir, text) => { forests.set(dir, text); return { ok: true } },
    readNote:          async (dir, file) => ({ content: notes.get(dir + '/' + file) || '' }),
    writeNote:         async (dir, file, text) => { notes.set(dir + '/' + file, text); return { ok: true } },
    deleteNote:        async (dir, file) => { notes.delete(dir + '/' + file); return { ok: true } },
  }
}

export function createApi() {
  const raw = window.taskforkstack
  const base = raw && Object.keys(raw).length ? wrapRealBridge(raw) : makeFallback()

  const timers = new Map()
  base.saveForestDebounced = (dir, text, ms = 500) => {
    clearTimeout(timers.get(dir))
    timers.set(dir, setTimeout(() => { base.saveForest(dir, text) }, ms))
  }
  return base
}
