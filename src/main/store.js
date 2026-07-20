// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The persistence store: settings plus the on-disk forest library. A library
// is a root directory holding one sub-directory per domain; each domain
// directory holds a forest.json5 and its per-task *.md note files. The renderer
// never touches the filesystem — it calls these through the preload bridge, and
// every path it supplies is re-derived and bounds-checked here (see pathsafe.js)
// so a malformed domain path or note filename cannot read or write outside its
// domain directory.
//
// Forest text crosses IPC as raw JSON5 text, unparsed: the renderer owns the
// schema (parse with json5, validate with model/validate.js), so this layer
// stays deliberately ignorant of forest structure and needs no json5 itself.
// Writes are atomic (write a .tmp sibling, then rename) so an interrupted save
// never truncates a good file.

import { app, shell } from 'electron'
import { join, dirname, resolve } from 'node:path'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs'
import { isValidDomainName, isValidNoteFile, resolveUnder } from './pathsafe.js'

const FOREST_FILE = 'forest.json5'
// Bookmarks are a saved, named view (northstar axiom 8): shared WITH the domain
// data, so they live in the domain directory alongside forest.json5 (the live,
// client-local collapse view stays in the userData sidecar, kept out of here).
const BOOKMARKS_FILE = 'bookmarks.json'

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

// Read settings, distinguishing "not there yet" (ENOENT → {}) from "present but
// unreadable" (corrupt JSON, EACCES, a sync conflict), which throws. A blind
// catch-all here would let a corrupt file read as {} and the next write clobber
// it, silently erasing the user's libraryRoot — see readSettingsSafe/setters.
function readSettings() {
  let text
  try {
    text = readFileSync(settingsPath(), 'utf-8')
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
  return JSON.parse(text)
}

// For read-only defaults: tolerate a corrupt settings file by falling back to
// empty WITHOUT writing anything, so the bad file is preserved for recovery.
function readSettingsSafe() {
  try {
    return readSettings()
  } catch {
    return {}
  }
}

function writeSettings(next) {
  atomicWrite(settingsPath(), JSON.stringify(next, null, 2) + '\n')
}

// Atomic and durable: write the temp file, fsync it, rename over the target,
// then fsync the directory so the rename survives a crash/power loss. Without
// the fsyncs a crash just after rename can leave a zero-length file — the very
// truncation this is meant to prevent.
function atomicWrite(absPath, text) {
  const tmp = absPath + '.tmp'
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, absPath)
  try {
    const dir = openSync(dirname(absPath), 'r')
    try { fsyncSync(dir) } finally { closeSync(dir) }
  } catch {
    // Directory fsync is best-effort (not supported on every platform).
  }
}

// The default library lives under the app's userData directory; a user can
// repoint it to any folder via setLibraryRoot (chooseLibraryRoot in the UI).
export function getLibraryRoot() {
  return readSettingsSafe().libraryRoot || join(app.getPath('userData'), 'forests')
}

export function setLibraryRoot(root) {
  let s
  try {
    s = readSettings()
  } catch (e) {
    return { error: 'settings.json is unreadable; refusing to overwrite it: ' + e.message }
  }
  s.libraryRoot = root
  writeSettings(s)
  return { ok: true, root }
}

export function getSettings() {
  const s = readSettingsSafe()
  return { libraryRoot: s.libraryRoot || join(app.getPath('userData'), 'forests'), lastDomain: s.lastDomain || null }
}

export function setLastDomain(name) {
  let s
  try {
    s = readSettings()
  } catch (e) {
    // Refuse rather than clobber a present-but-unreadable file, which would
    // silently erase the user's libraryRoot pointer.
    return { error: 'settings.json is unreadable; refusing to overwrite it: ' + e.message }
  }
  s.lastDomain = name
  writeSettings(s)
  return { ok: true }
}

function viewStatePath() {
  return join(app.getPath('userData'), 'viewstate.json')
}

// Client-local view state (which project nodes are collapsed), keyed by domain
// name. Disposable: a corrupt or missing file falls back to {} (unlike
// settings.json, which we refuse to clobber). See docs/northstar.md axiom 8:
// the view is the client's, kept out of the shared forest data.
function readViewStateFile() {
  try {
    return JSON.parse(readFileSync(viewStatePath(), 'utf-8'))
  } catch {
    return {}
  }
}

export function getViewState(domain) {
  const s = readViewStateFile()[domain]
  return { collapsed: Array.isArray(s && s.collapsed) ? s.collapsed : [] }
}

export function setViewState(domain, state) {
  const all = readViewStateFile()
  all[domain] = { collapsed: Array.isArray(state && state.collapsed) ? state.collapsed : [] }
  atomicWrite(viewStatePath(), JSON.stringify(all, null, 2) + '\n')
  return { ok: true }
}

function ensureLibraryRoot() {
  const root = getLibraryRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

// A domain directory must be an immediate child of the current library root.
// Throws otherwise — the renderer only ever passes back paths it got from
// listDomains/createForest, so anything else is a bug or an attack.
function requireDomainDir(dirPath) {
  const root = resolve(getLibraryRoot())
  const abs = resolve(dirPath)
  if (resolve(dirname(abs)) !== root) throw new Error('domain path is not inside the library root')
  return abs
}

export function listDomains() {
  const root = ensureLibraryRoot()
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, FOREST_FILE)))
    .map((e) => ({ name: e.name, path: join(root, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createForest(name) {
  if (!isValidDomainName(name)) return { error: 'invalid domain name' }
  const root = ensureLibraryRoot()
  const dir = resolveUnder(root, name)
  if (!dir) return { error: 'invalid domain name' }
  if (existsSync(dir)) return { error: `a domain named "${name}" already exists` }
  mkdirSync(dir, { recursive: true })
  const skeleton = `{\n  schema: 2,\n  domain: ${JSON.stringify(name)},\n  rootOrder: [],\n  tasks: {},\n}\n`
  atomicWrite(join(dir, FOREST_FILE), skeleton)
  return { name, path: dir }
}

// Move a whole domain directory (its forest.json5 and all note files) to the OS
// Trash, so a deletion is recoverable. Path-bounded to an immediate child of the
// library root, and it must actually be a domain (hold a forest.json5).
export async function deleteForest(dirPath) {
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  if (!existsSync(join(dir, FOREST_FILE))) return { error: 'not a domain (no forest.json5)' }
  try {
    await shell.trashItem(dir)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

export function loadForest(dirPath) {
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    return { text: readFileSync(join(dir, FOREST_FILE), 'utf-8') }
  } catch (e) {
    return { error: e.message }
  }
}

export function saveForest(dirPath, text) {
  if (typeof text !== 'string') return { error: 'forest text must be a string' }
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    atomicWrite(join(dir, FOREST_FILE), text)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

function requireNotePath(dirPath, file) {
  const dir = requireDomainDir(dirPath)
  if (!isValidNoteFile(file)) throw new Error('invalid note filename')
  const abs = resolveUnder(dir, file)
  if (!abs) throw new Error('invalid note filename')
  return abs
}

export function readNote(dirPath, file) {
  let abs
  try {
    abs = requireNotePath(dirPath, file)
  } catch (e) {
    return { error: e.message }
  }
  try {
    return { content: readFileSync(abs, 'utf-8') }
  } catch (e) {
    if (e.code === 'ENOENT') return { content: '' } // a note not yet written reads as empty
    return { error: e.message }
  }
}

export function writeNote(dirPath, file, text) {
  if (typeof text !== 'string') return { error: 'note text must be a string' }
  let abs
  try {
    abs = requireNotePath(dirPath, file)
  } catch (e) {
    return { error: e.message }
  }
  try {
    atomicWrite(abs, text)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

export function deleteNote(dirPath, file) {
  let abs
  try {
    abs = requireNotePath(dirPath, file)
  } catch (e) {
    return { error: e.message }
  }
  try {
    rmSync(abs, { force: true })
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

// Write an exported markdown file to a user-chosen absolute path. Unlike
// saveForest and writeNote, this deliberately writes OUTSIDE the library root:
// export is a one-way "save a copy anywhere", whose trust boundary is the user's
// explicit choice in the native save dialog (the tfs:export-markdown handler in
// index.js), not the library bound. Still atomic, so an interrupted write never
// truncates an existing file at the target.
export function writeExport(absPath, text) {
  if (typeof absPath !== 'string' || !absPath) return { error: 'no export path' }
  if (typeof text !== 'string') return { error: 'export text must be a string' }
  try {
    atomicWrite(absPath, text)
    return { ok: true, path: absPath }
  } catch (e) {
    return { error: e.message }
  }
}

// The domain's saved bookmarks, as raw text — the renderer owns the JSON shape,
// so this layer stays schema-agnostic (as with forest text). A missing file
// reads as empty; the renderer treats empty as "no bookmarks yet". Bounded to the
// domain directory, atomic on write.
export function getBookmarks(dirPath) {
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    return { text: readFileSync(join(dir, BOOKMARKS_FILE), 'utf-8') }
  } catch (e) {
    if (e.code === 'ENOENT') return { text: '' }
    return { error: e.message }
  }
}

export function setBookmarks(dirPath, text) {
  if (typeof text !== 'string') return { error: 'bookmarks text must be a string' }
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    atomicWrite(join(dir, BOOKMARKS_FILE), text)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}
