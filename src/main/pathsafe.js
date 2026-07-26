// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Pure path-safety helpers for the persistence layer. No electron, no fs — so
// this module is unit-testable on its own (see pathsafe.test.js). The renderer
// is untrusted input for these purposes: it names a domain and a bare note
// filename, and the main process must never let either escape the library root
// or its domain directory. Everything here is the boundary that enforces that.

import { resolve, sep } from 'node:path'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/

// A domain's title is a display name, no longer a path segment: the directory is
// named from a slug of it plus the domain's id, so the title itself only has to
// be sane to show and to store. Separators are therefore allowed ("AI/ML" is a
// reasonable title) because nothing derives a path from the title directly.
export function isValidDomainTitle(title) {
  return (
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 64 &&
    title === title.trim() &&
    !CONTROL_CHARS.test(title)
  )
}

// The slug in a directory or note filename is decorative: it keeps a library
// listing readable, and the id beside it is what identifies. Lowercase
// alphanumerics with single hyphens between runs, truncated to `max` characters
// and never leaving a trailing hyphen. A title that yields nothing (only emoji,
// only punctuation) slugs to the empty string, and callers omit the segment.
export function slugFor(title, max = 24) {
  if (typeof title !== 'string') return ''
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

const DOMAIN_DIR_PREFIX = 'pensagrex_domain_'
const DOMAIN_ID = /^d_[0-9a-z]{10}$/

// A domain directory is named for what it is, what it holds, and which domain it
// is: `pensagrex_domain_work_d_mrtwgppt01`. The prefix says which app owns it,
// the slug keeps a library listing readable, and the id makes it findable. The
// slug is omitted rather than left empty when a title yields none.
export function domainDirName(title, id) {
  const slug = slugFor(title)
  return DOMAIN_DIR_PREFIX + (slug ? slug + '_' : '') + id
}

// Whether `name` is a directory this app owns, and which domain id it claims.
// Returns null for anything else, so a library root can hold unrelated folders
// without them being read as domains.
export function domainDirId(name) {
  if (typeof name !== 'string' || !name.startsWith(DOMAIN_DIR_PREFIX)) return null
  const rest = name.slice(DOMAIN_DIR_PREFIX.length)
  const at = rest.lastIndexOf('d_')
  if (at === -1) return null
  const id = rest.slice(at)
  return DOMAIN_ID.test(id) ? id : null
}

// A note file is a bare filename ending in .md, living directly in a domain
// directory. No separators (so no traversal), no control characters, and not
// the reserved dot names.
export function isValidNoteFile(file) {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    file.length <= 128 &&
    !file.includes('/') &&
    !file.includes('\\') &&
    !CONTROL_CHARS.test(file) &&
    file !== '.' &&
    file !== '..' &&
    /\.md$/i.test(file)
  )
}

// Resolve `segments` under `root`, returning the absolute path only if it stays
// within root (root itself, or something beneath it). Returns null on any
// escape. The trailing-separator test prevents a sibling like "<root>-evil"
// from passing a naive startsWith(root) check.
export function resolveUnder(root, ...segments) {
  const base = resolve(root)
  const abs = resolve(base, ...segments)
  if (abs === base) return abs
  if (abs.startsWith(base + sep)) return abs
  return null
}
