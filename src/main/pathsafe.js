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

// A domain is one directory directly under the library root, so its name must
// be a single, safe path segment: no separators, no traversal, no control
// characters, no leading/trailing whitespace, and a sane length.
export function isValidDomainName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 64 &&
    name === name.trim() &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !CONTROL_CHARS.test(name)
  )
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
