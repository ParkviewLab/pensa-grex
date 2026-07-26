// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The one-time move from a schema-2 library to a schema-3 one, run at startup
// before the first window opens (src/main/index.js). It reads the old library and
// writes a new one; it never writes into a domain's old files, so the old library
// stays a working fallback for a 2.x build until the user removes it themselves.
//
// What it does per domain: parse forest.json5, migrate the record (which remints
// every node id), create pensagrex_domain_<slug>_<id>/, write domain.json as plain
// JSON, copy each note file across under its new name, and rewrite the bookmark
// sidecar into the device-independent shape with the new ids. What it does to the
// old library: appends one line to a marker file recording, per domain, when it was
// migrated and what it became, so a later cleanup (or a person with a file browser)
// can tell what is safe to delete.
//
// It is deliberately conservative. A domain that fails for any reason is left
// alone, reported, and does not stop the others; a domain already in the marker is
// skipped, so a second launch is a no-op.

import { join, basename } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { app } from 'electron'
import JSON5 from 'json5'
import { migrateRecord } from '../shared/model/migrate.js'
import { validateRecord } from '../shared/model/validate.js'
import { domainDirName, domainDirId } from './pathsafe.js'
import { getLibraryRoot } from './store.js'

const LEGACY_FILE = 'forest.json5'
const DOMAIN_FILE = 'domain.json'
const NOTES_DIR = 'notes'
const BOOKMARKS_FILE = 'bookmarks.json'
// A dot-prefixed name, so it sorts out of the way and no domain scan mistakes it
// for a domain directory.
const MARKER_FILE = '.pensagrex-migrated.json'

function readMarker(root) {
  try {
    const m = JSON.parse(readFileSync(join(root, MARKER_FILE), 'utf-8'))
    return m && typeof m === 'object' && m.domains ? m : { domains: {} }
  } catch {
    return { domains: {} }
  }
}

// Additive, and atomic in the same write-then-rename way as the store: the marker
// is the only thing this pass puts in the old library.
function writeMarker(root, marker) {
  const tmp = join(root, MARKER_FILE + '.tmp')
  writeFileSync(tmp, JSON.stringify(marker, null, 2) + '\n')
  renameSync(tmp, join(root, MARKER_FILE))
}

// Every directory in `root` that holds a schema-2 record. A directory this app
// already owns (its name carries a domain id) is not one: it is a migration target.
function legacyDomainsIn(root) {
  if (!root || !existsSync(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !domainDirId(e.name) && existsSync(join(root, e.name, LEGACY_FILE)))
    .map((e) => join(root, e.name))
}

// A bookmark sidecar, rewritten for schema 3: the collapse set and the camera
// anchor are repointed through the id map, `zoom` is dropped, and the anchor chain
// becomes a one-node set (the anchor itself), which each client frames for itself.
// See docs/model_v3_ideas.md, section 14.
function migrateBookmarks(text, idMap) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && parsed.bookmarks)
  if (!Array.isArray(list)) return null
  const map = (id) => idMap[id] || null
  const out = []
  for (const b of list) {
    if (!b || typeof b.name !== 'string') continue
    const anchor = Array.isArray(b.anchor) ? b.anchor : []
    const nodes = anchor.map(map).filter(Boolean).slice(0, 1)
    out.push({
      name: b.name,
      collapsed: (Array.isArray(b.collapsed) ? b.collapsed : []).map(map).filter(Boolean),
      nodes,
    })
  }
  return { bookmarks: out }
}

function migrateOneDomain(sourceDir, targetRoot) {
  const text = readFileSync(join(sourceDir, LEGACY_FILE), 'utf-8')
  const { record, notes, idMap } = migrateRecord(JSON5.parse(text))
  const v = validateRecord(record)
  if (!v.ok) throw new Error('migrated record failed validation: ' + v.errors.slice(0, 3).join('; '))

  const dirName = domainDirName(record.title, record.id)
  const target = join(targetRoot, dirName)
  if (existsSync(target)) throw new Error('target directory already exists: ' + dirName)
  mkdirSync(join(target, NOTES_DIR), { recursive: true })

  // Notes first, then the record that points at them, so a failure part-way leaves
  // at most orphan note files rather than a record naming a note that is not there.
  let notesCopied = 0
  const notesMissing = []
  for (const { from, to } of notes) {
    const src = join(sourceDir, from)
    if (!existsSync(src)) { notesMissing.push(from); continue }
    writeFileSync(join(target, NOTES_DIR, to), readFileSync(src, 'utf-8'))
    notesCopied += 1
  }

  writeFileSync(join(target, DOMAIN_FILE), JSON.stringify(record, null, 2) + '\n')

  let bookmarks = 0
  const bmPath = join(sourceDir, BOOKMARKS_FILE)
  if (existsSync(bmPath)) {
    const migrated = migrateBookmarks(readFileSync(bmPath, 'utf-8'), idMap)
    if (migrated && migrated.bookmarks.length) {
      writeFileSync(join(target, BOOKMARKS_FILE), JSON.stringify(migrated, null, 2) + '\n')
      bookmarks = migrated.bookmarks.length
    }
  }

  return {
    title: record.title,
    id: record.id,
    dir: dirName,
    nodes: Object.keys(record.nodes).length,
    notesCopied,
    notesMissing,
    bookmarks,
  }
}

// Migrate every schema-2 domain that has not been migrated yet, from the legacy
// default library and from the current library root (a user who repointed the root
// keeps their schema-2 domains there). Returns a summary; the caller logs it.
export function migrateLibraryIfNeeded() {
  const targetRoot = getLibraryRoot()
  const legacyRoot = join(app.getPath('userData'), 'forests')
  const roots = [...new Set([legacyRoot, targetRoot])]

  const migrated = []
  const failed = []
  let skipped = 0

  for (const root of roots) {
    const sources = legacyDomainsIn(root)
    if (!sources.length) continue
    const marker = readMarker(root)
    let wrote = false
    for (const sourceDir of sources) {
      const key = basename(sourceDir)
      if (marker.domains[key]) { skipped += 1; continue }
      try {
        if (!existsSync(targetRoot)) mkdirSync(targetRoot, { recursive: true })
        const result = migrateOneDomain(sourceDir, targetRoot)
        marker.domains[key] = {
          at: new Date().toISOString(),
          id: result.id,
          dir: result.dir,
          nodes: result.nodes,
          notes: result.notesCopied,
        }
        wrote = true
        migrated.push(result)
      } catch (e) {
        failed.push({ dir: key, error: (e && e.message) || String(e) })
      }
    }
    if (wrote) {
      marker.migratedTo = targetRoot
      marker.note = 'Migrated to schema 3 by PensaGrex. These directories are left untouched as a fallback; nothing here is read once a domain appears above.'
      try {
        writeMarker(root, marker)
      } catch (e) {
        failed.push({ dir: basename(root), error: 'could not write the marker: ' + ((e && e.message) || String(e)) })
      }
    }
  }

  return { migrated, failed, skipped }
}
