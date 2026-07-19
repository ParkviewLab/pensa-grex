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

import { app } from 'electron'
import { join, dirname, resolve } from 'node:path'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync,
} from 'node:fs'
import { isValidDomainName, isValidNoteFile, resolveUnder } from './pathsafe.js'

const FOREST_FILE = 'forest.json5'

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(next) {
  atomicWrite(settingsPath(), JSON.stringify(next, null, 2) + '\n')
}

function atomicWrite(absPath, text) {
  const tmp = absPath + '.tmp'
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, absPath)
}

// The default library lives under the app's userData directory; a user can
// repoint it to any folder via setLibraryRoot (chooseLibraryRoot in the UI).
export function getLibraryRoot() {
  return readSettings().libraryRoot || join(app.getPath('userData'), 'forests')
}

export function setLibraryRoot(root) {
  const s = readSettings()
  s.libraryRoot = root
  writeSettings(s)
  return { ok: true, root }
}

export function getSettings() {
  return { libraryRoot: getLibraryRoot(), lastDomain: readSettings().lastDomain || null }
}

export function setLastDomain(name) {
  const s = readSettings()
  s.lastDomain = name
  writeSettings(s)
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
  const skeleton = `{\n  schema: 1,\n  domain: ${JSON.stringify(name)},\n  trees: [],\n  tasks: {},\n}\n`
  atomicWrite(join(dir, FOREST_FILE), skeleton)
  return { name, path: dir }
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
