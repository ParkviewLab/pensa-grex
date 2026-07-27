// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect } from 'vitest'
import { compareVersions, isNewer, stripTag } from './version.js'

describe('stripTag', () => {
  it('drops a leading v, and tolerates whitespace and nonsense', () => {
    expect(stripTag('v3.3.0')).toBe('3.3.0')
    expect(stripTag(' V3.3.0 ')).toBe('3.3.0')
    expect(stripTag('3.3.0')).toBe('3.3.0')
    expect(stripTag(null)).toBe('')
    expect(stripTag(undefined)).toBe('')
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('3.3.0', '3.3.0')).toBe(0)
    expect(compareVersions('4.0.0', '3.9.9')).toBe(1)
    expect(compareVersions('3.4.0', '3.3.9')).toBe(1)
    expect(compareVersions('3.3.1', '3.3.0')).toBe(1)
    expect(compareVersions('3.3.0', '3.3.1')).toBe(-1)
  })

  it('compares numerically, not as text', () => {
    // The trap a string comparison falls into, and the reason this exists at all.
    expect(compareVersions('3.10.0', '3.9.0')).toBe(1)
    expect(compareVersions('10.0.0', '9.0.0')).toBe(1)
  })

  it('sorts a dev cycle below the release it names and above the one before it', () => {
    // The placeholder this repo opens after every release, and the whole reason a
    // running dev build must not be told to download the release it came after.
    expect(compareVersions('3.3.1-dev0', '3.3.1')).toBe(-1)
    expect(compareVersions('3.3.1-dev0', '3.3.0')).toBe(1)
    expect(compareVersions('3.3.1-dev1', '3.3.1-dev0')).toBe(1)
    expect(compareVersions('1.0.0-dev', '1.0.0-dev.1')).toBe(-1)
  })

  it('answers null, not zero, for anything it cannot read', () => {
    // Distinct from "equal", since the caller must not report "up to date" on a
    // tag it failed to understand.
    for (const bad of ['', 'latest', '3.3', 'v', null, undefined, {}, '3.3.0.1.2.x']) {
      expect(compareVersions(bad, '3.3.0')).toBeNull()
      expect(compareVersions('3.3.0', bad)).toBeNull()
    }
  })
})

describe('isNewer', () => {
  it('is true only for a strictly greater version', () => {
    expect(isNewer('v3.4.0', '3.3.0')).toBe(true)
    expect(isNewer('v3.3.0', '3.3.0')).toBe(false)
    expect(isNewer('v3.2.9', '3.3.0')).toBe(false)
  })

  it('is false for an unreadable version, so a bad tag never nags', () => {
    expect(isNewer('latest', '3.3.0')).toBe(false)
    expect(isNewer(null, '3.3.0')).toBe(false)
    expect(isNewer('v9.9.9', 'not-a-version')).toBe(false)
  })
})
