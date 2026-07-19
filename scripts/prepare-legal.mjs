// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
//
// prepare-legal.mjs — assemble the packaged legal/ notice bundle.
//
// Recreates legal/ and copies in the project's own license texts plus Electron's
// own Chromium/Node third-party notices. electron-builder DELETES
// LICENSES.chromium.html from the macOS .app (and only leaves it next-to-binary
// on Win/Linux), so we ship our own copy for one stable, cross-platform path.
// The npm-dependency notices (THIRD-PARTY-NOTICES.txt) and the structured list
// (oss-licenses.json) are produced by the `legal:notices` / `legal:list` npm
// scripts; this file only does fs copies so it stays dependency-free.
//
// legal/ is gitignored — it is a build artifact, regenerated before packaging.

import { rm, mkdir, copyFile, cp } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const legal = join(root, 'legal')
const electronDist = join(root, 'node_modules', 'electron', 'dist')

await rm(legal, { recursive: true, force: true })
await mkdir(legal, { recursive: true })

// Project license texts.
await copyFile(join(root, 'LICENSE'), join(legal, 'LICENSE.txt'))
await copyFile(join(root, 'LICENSING.md'), join(legal, 'LICENSING.md'))
await cp(join(root, 'LICENSES'), join(legal, 'LICENSES'), { recursive: true })

// Electron's bundled Chromium/Node notices (electron-builder drops LICENSES.chromium.html from
// the mac .app, so we ship our own copy). These come from node_modules/electron/dist, populated
// by electron's postinstall. A Node 24.16+/26.1+ regression can make extract-zip settle early and
// leave dist partially written (electron/electron#51619, nodejs/node#63487) — pinned out via the
// `yauzl` override in package.json. We still assert both notice files are present and the Chromium
// notices are non-trivial, so a partial extraction fails the build loudly here instead of silently
// shipping empty notices.
const chromiumNotices = join(electronDist, 'LICENSES.chromium.html')
const electronLicense = join(electronDist, 'LICENSE')
if (!existsSync(chromiumNotices) || statSync(chromiumNotices).size < 1_000_000 || !existsSync(electronLicense)) {
  console.error(
    'electron dist is incomplete: its license notices are missing or truncated. The prebuilt did ' +
      'not extract fully — re-run `npm ci`, and verify the `yauzl` override in package.json ' +
      '(electron/electron#51619, nodejs/node#63487).',
  )
  process.exit(1)
}
await copyFile(chromiumNotices, join(legal, 'LICENSES.chromium.html'))
await copyFile(electronLicense, join(legal, 'LICENSE.electron.txt'))

console.log('legal/ prepared (project licenses + Electron Chromium/Node notices)')
