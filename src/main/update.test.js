// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The update check with a stubbed fetch: no network, and every failure path
// exercised, since the failure paths are the point. A check that cannot be made
// must answer 'unknown', never 'current'.

import { describe, it, expect } from 'vitest'
import { checkForUpdate, DOWNLOAD_URL, LATEST_RELEASE_URL } from './update.js'

const ok = (tag) => async () => ({ ok: true, json: async () => ({ tag_name: tag }) })

describe('checkForUpdate', () => {
  it('reports an update when the release is newer, linking the download page', async () => {
    const r = await checkForUpdate({ currentVersion: '3.3.0', fetchImpl: ok('v3.4.0') })
    expect(r).toEqual({ state: 'update', version: '3.4.0', url: DOWNLOAD_URL })
  })

  it('reports current when the release is the running version', async () => {
    const r = await checkForUpdate({ currentVersion: '3.3.0', fetchImpl: ok('v3.3.0') })
    expect(r.state).toBe('current')
    expect(r.version).toBe('3.3.0')
  })

  it('reports current when the running build is ahead of the release', async () => {
    // A dev build: 3.3.1-dev0 follows the 3.3.0 release, so it is not out of date.
    const r = await checkForUpdate({ currentVersion: '3.3.1-dev0', fetchImpl: ok('v3.3.0') })
    expect(r.state).toBe('current')
  })

  it('asks GitHub for the latest release, and identifies itself', async () => {
    let seen = null
    await checkForUpdate({
      currentVersion: '3.3.0',
      fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ tag_name: 'v3.3.0' }) } },
    })
    expect(seen.url).toBe(LATEST_RELEASE_URL)
    expect(seen.opts.headers['User-Agent']).toBe('PensaGrex')
    expect(seen.opts.headers.Accept).toBe('application/vnd.github+json')
  })

  for (const [name, fetchImpl] of [
    ['a network error', async () => { throw new Error('offline') }],
    ['an HTTP error (rate limit, outage)', async () => ({ ok: false, status: 403, json: async () => ({}) })],
    ['a body with no tag', async () => ({ ok: true, json: async () => ({}) })],
    ['a tag in a shape it cannot read', async () => ({ ok: true, json: async () => ({ tag_name: 'latest' }) })],
    ['a body that is not JSON', async () => ({ ok: true, json: async () => { throw new Error('bad json') } })],
  ]) {
    it(`answers unknown on ${name}, never current`, async () => {
      const r = await checkForUpdate({ currentVersion: '3.3.0', fetchImpl })
      expect(r.state).toBe('unknown')
      expect(r.version).toBeNull()
      expect(r.url).toBe(DOWNLOAD_URL)
    })
  }

  it('gives up rather than hanging, and aborts the request it abandoned', async () => {
    let aborted = false
    const hang = (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    })
    const r = await checkForUpdate({ currentVersion: '3.3.0', fetchImpl: hang, timeoutMs: 10 })
    expect(r.state).toBe('unknown')
    expect(aborted).toBe(true)
  })

  it('answers unknown where there is no fetch at all', async () => {
    // null rather than undefined, deliberately: undefined would fall through to the
    // default parameter and reach the real network, which no test here may do.
    const r = await checkForUpdate({ currentVersion: '3.3.0', fetchImpl: null })
    expect(r.state).toBe('unknown')
  })
})
