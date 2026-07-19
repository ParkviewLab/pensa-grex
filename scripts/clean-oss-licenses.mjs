// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
//
// clean-oss-licenses.mjs — normalise the license-checker map into the compact
// array the in-app "Open Source Licenses" viewer reads.
//
// Runs after `license-checker-rseidelsohn --production --json` writes the raw map
// to legal/oss-licenses.json. The raw map (a) lists TaskForkStack itself (the
// AGPL root, not a third-party dep) and (b) embeds absolute local build paths
// (/Users/…, /home/runner/…) that must not ship. This rewrites it to a sorted
// array of { name, version, license, repository } — third-party packages only.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'legal', 'oss-licenses.json')

const cleanRepo = (r) =>
  r ? r.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '') : null

const raw = JSON.parse(await readFile(file, 'utf-8'))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
const selfKey = `${pkg.name}@${pkg.version}`

const list = Object.entries(raw)
  .filter(([key]) => key !== selfKey) // drop the app itself
  .map(([key, v]) => {
    const at = key.lastIndexOf('@') // name may itself start with '@' (scoped)
    return {
      name: key.slice(0, at),
      version: key.slice(at + 1),
      license: v.licenses,
      repository: cleanRepo(v.repository),
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

await writeFile(file, JSON.stringify(list, null, 2) + '\n')
console.log(`oss-licenses.json: ${list.length} third-party packages`)
