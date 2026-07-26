// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The persistence store: settings plus the on-disk domain library. A library is a
// root directory holding one directory per domain, named for the app, a slug of
// the domain's title, and the domain's id (`pensagrex_domain_work_d_mrtwgppt01`);
// each domain directory holds a domain.json, a bookmarks.json, and a notes/
// directory of per-node *.md files. The renderer never touches the filesystem —
// it calls these through the preload bridge, and every path it supplies is
// re-derived and bounds-checked here (see pathsafe.js) so a malformed domain path
// or note filename cannot read or write outside its domain directory.
//
// The directory's name is a label and the record's id is the identity, so a
// mismatch between them is repaired by regenerating the label, never by trusting
// the path.
//
// A domain's text crosses IPC unparsed: the renderer owns the schema (validate
// with model/validate.js), so this layer stays almost ignorant of structure. The
// one exception is listDomains, which reads each file for its display title,
// because the title no longer lives in the directory name.
//
// Writes are atomic (write a .tmp sibling, fsync, rename) so an interrupted save
// never truncates a good file.

import { app, shell } from 'electron'
import { join, dirname, resolve, basename } from 'node:path'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs'
import {
  isValidDomainTitle, isValidNoteFile, resolveUnder, domainDirName, domainDirId,
} from './pathsafe.js'
import { mintDomainId } from '../shared/model/ids.js'

const DOMAIN_FILE = 'domain.json'
// Notes moved out of the domain directory's top level and into their own
// subdirectory, so a domain directory has three entries whatever its size.
const NOTES_DIR = 'notes'
// Bookmarks are a saved, named view (northstar axiom 9): shared WITH the domain
// data, so they live in the domain directory alongside domain.json (the live,
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
  return readSettingsSafe().libraryRoot || join(app.getPath('userData'), 'domains')
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
  return { libraryRoot: s.libraryRoot || join(app.getPath('userData'), 'domains'), lastDomain: s.lastDomain || null }
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

// The in-app MCP server's configuration, in the same settings.json. Defaults:
// enabled, the fixed loopback port (which does not roam — see docs/mcp_ideas.md),
// and the read-write scope tier (destructive tools off). The scope may be
// overridden per launch by PENSAGREX_MCP_SCOPE, so an operator can widen or
// narrow it without editing settings.
const MCP_DEFAULT_PORT = 35899
const MCP_SCOPES = ['read-only', 'read-write', 'destructive']

export function getMcpConfig() {
  const s = readSettingsSafe()
  const envScope = process.env.PENSAGREX_MCP_SCOPE
  const scope = MCP_SCOPES.includes(envScope) ? envScope
    : MCP_SCOPES.includes(s.mcpScope) ? s.mcpScope
      : 'read-write'
  const port = Number.isInteger(s.mcpPort) && s.mcpPort > 0 ? s.mcpPort : MCP_DEFAULT_PORT
  return { enabled: s.mcpEnabled !== false, port, scope }
}

export function setMcpEnabled(enabled) {
  let s
  try {
    s = readSettings()
  } catch (e) {
    return { error: 'settings.json is unreadable; refusing to overwrite it: ' + e.message }
  }
  s.mcpEnabled = !!enabled
  writeSettings(s)
  return { ok: true, enabled: !!enabled }
}

function viewStatePath() {
  return join(app.getPath('userData'), 'viewstate.json')
}

// Client-local view state (which project nodes are collapsed), keyed by domain
// name. Disposable: a corrupt or missing file falls back to {} (unlike
// settings.json, which we refuse to clobber). See docs/northstar.md axiom 9:
// the view is the client's, kept out of the shared record.
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
// listDomains/createDomain, so anything else is a bug or an attack.
function requireDomainDir(dirPath) {
  const root = resolve(getLibraryRoot())
  const abs = resolve(dirPath)
  if (resolve(dirname(abs)) !== root) throw new Error('domain path is not inside the library root')
  return abs
}

// A domain's display title comes from its record, since the directory holds only
// a slug of it. A file that will not parse still lists (as its slug), because a
// domain the user can see and try to open is better than one that has silently
// vanished from the switcher.
function titleOf(dir, id) {
  try {
    const rec = JSON.parse(readFileSync(join(dir, DOMAIN_FILE), 'utf-8'))
    // `title` is schema 3's; `domain` is what schema 2 called it, kept so a domain
    // that has somehow not been migrated still shows a name rather than a slug.
    const t = rec && (rec.title || rec.domain) //  is what schema 2 called it
    if (typeof t === 'string' && t) return t
  } catch {
    // fall through to the label
  }
  const label = basename(dir).replace(/^pensagrex_domain_/, '').replace('_' + id, '')
  return label || id
}

// Every directory in the library root that this app owns and that holds a record.
// A directory whose name does not carry a domain id is not ours, so a library root
// may hold unrelated folders safely.
export function listDomains() {
  const root = ensureLibraryRoot()
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .map((e) => ({ e, id: e.isDirectory() ? domainDirId(e.name) : null }))
    .filter(({ e, id }) => id && existsSync(join(root, e.name, DOMAIN_FILE)))
    .map(({ e, id }) => ({ id, name: titleOf(join(root, e.name), id), path: join(root, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A new domain: a minted id, a directory labelled with a slug of the title and
// that id, an empty record, and the notes directory it will fill. The title stays
// unique across the library, because it is how a person (and the MCP surface)
// names a domain, and two domains answering to one name is worse than a refusal.
export function createDomain(title) {
  if (!isValidDomainTitle(title)) return { error: 'invalid domain title' }
  const root = ensureLibraryRoot()
  if (listDomains().some((d) => d.name === title)) {
    return { error: `a domain named "${title}" already exists` }
  }
  const id = mintDomainId()
  const dir = resolveUnder(root, domainDirName(title, id))
  if (!dir) return { error: 'invalid domain title' }
  if (existsSync(dir)) return { error: 'a domain directory of that name already exists' }
  mkdirSync(join(dir, NOTES_DIR), { recursive: true })
  const skeleton = { schemaVersion: 3, id, title, planOrder: [], nodes: {} }
  atomicWrite(join(dir, DOMAIN_FILE), JSON.stringify(skeleton, null, 2) + '\n')
  return { id, name: title, path: dir }
}

// Move a whole domain directory (its record, bookmarks, and notes) to the OS
// Trash, so a deletion is recoverable. Path-bounded to an immediate child of the
// library root, and it must actually be a domain (hold a domain.json).
export async function deleteDomain(dirPath) {
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  if (!existsSync(join(dir, DOMAIN_FILE))) return { error: 'not a domain (no domain.json)' }
  try {
    await shell.trashItem(dir)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

export function loadDomainFile(dirPath) {
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    return { text: readFileSync(join(dir, DOMAIN_FILE), 'utf-8') }
  } catch (e) {
    return { error: e.message }
  }
}

export function saveDomainFile(dirPath, text) {
  if (typeof text !== 'string') return { error: 'domain text must be a string' }
  let dir
  try {
    dir = requireDomainDir(dirPath)
  } catch (e) {
    return { error: e.message }
  }
  try {
    atomicWrite(join(dir, DOMAIN_FILE), text)
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

// Notes live in the domain's notes/ subdirectory. The filename is still a bare
// name with no separators (see isValidNoteFile and shared/model/notes.js), so the
// subdirectory is added here and cannot be escaped from the renderer's side.
function requireNotePath(dirPath, file) {
  const dir = requireDomainDir(dirPath)
  if (!isValidNoteFile(file)) throw new Error('invalid note filename')
  const abs = resolveUnder(dir, NOTES_DIR, file)
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
    // createDomain makes notes/, but a domain directory that arrived some other
    // way (a hand copy, a restore from the Trash) may not have it yet.
    mkdirSync(dirname(abs), { recursive: true })
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
// saveDomainFile and writeNote, this deliberately writes OUTSIDE the library root:
// export is a one-way "save a copy anywhere", whose trust boundary is the user's
// explicit choice in the native save dialog (the pensagrex:export-markdown handler in
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
// so this layer stays schema-agnostic (as with the domain text). A missing file
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
