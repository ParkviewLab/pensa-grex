// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The one request PensaGrex makes to the internet, and it is made only when a
// person opens About: ask GitHub which release is the latest, and say whether the
// copy they are running is it. Nothing is sent but the request itself, nothing is
// downloaded, and nothing is installed; the answer is a sentence and, at most, a
// link to the download page, which opens in their own browser.
//
// Every failure is the same answer, 'unknown', and the window says so quietly:
// offline, GitHub down, the unauthenticated rate limit reached, a tag in a shape
// this cannot read. A version check is not worth an error dialog, and a check that
// cannot be made must never read as "you are up to date".

import { compareVersions, stripTag } from '../shared/version.js'

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/ParkviewLab/pensa-grex/releases/latest'
export const DOWNLOAD_URL = 'https://parkviewlab.github.io/pensa-grex/'

/**
 * Ask GitHub for the latest release and compare it with `currentVersion`.
 * Returns { state: 'current' | 'update' | 'unknown', version, url }, where
 * `version` is the latest tag without its leading `v` (null when unknown).
 *
 * `fetchImpl` and `timeoutMs` are injected so this is testable without a network.
 */
export async function checkForUpdate({ currentVersion, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const unknown = { state: 'unknown', version: null, url: DOWNLOAD_URL }
  if (typeof fetchImpl !== 'function') return unknown

  // A dialog must not hang on a stalled connection: abort, and let the catch below
  // treat it as any other failure.
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PensaGrex' },
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res || !res.ok) return unknown
    const body = await res.json()
    const version = stripTag(body && body.tag_name)
    // compareVersions, not isNewer: a tag it cannot read answers null, and null is
    // not "no". Asking a boolean here would turn an unreadable tag into "you are up
    // to date", which is a claim this has no grounds to make.
    const cmp = compareVersions(version, currentVersion)
    if (cmp === null) return unknown
    // Always the download page, never the release's own GitHub page: it is the
    // surface that names an installer per platform, which is what someone told
    // there is a new version actually wants.
    return { state: cmp === 1 ? 'update' : 'current', version, url: DOWNLOAD_URL }
  } catch {
    return unknown
  } finally {
    if (timer) clearTimeout(timer)
  }
}
