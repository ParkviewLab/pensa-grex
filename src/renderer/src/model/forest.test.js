// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

import { describe, it, expect, beforeAll } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.forest.json5?raw'
import { validateForest } from './validate.js'
import { buildForest } from './forest.js'

describe('buildForest — the HomeLab fixture', () => {
  let raw, forest

  beforeAll(() => {
    raw = JSON5.parse(fixtureRaw)
    expect(validateForest(raw).ok).toBe(true) // the model is only meant to be built from a valid forest
    forest = buildForest(raw)
  })

  it('carries the domain and all three projects, named by their root nodes, in rootOrder', () => {
    expect(forest.domain).toBe('HomeLab')
    expect(forest.trees.map((t) => forest.getTask(t.rootTaskId).title)).toEqual(['Media server', 'Home network', 'Home automation'])
    expect(forest.trees.map((t) => t.id)).toEqual(['p_media', 'p_net', 'p_auto'])
  })

  it('derives each task\'s predecessor without it being stored on the task', () => {
    expect(raw.tasks.k_migrate.predecessorId).toBeUndefined() // not in the source
    expect(forest.getTask('k_migrate').predecessorId).toBe('k_nas')
    expect(forest.getTask('k_migrate').predecessorKind).toBe('next')

    expect(forest.getTask('k_plex').predecessorId).toBe('k_migrate')
    expect(forest.getTask('k_plex').predecessorKind).toBe('branch')
    expect(forest.getTask('k_plex').branchSide).toBe('left')
    expect(forest.getTask('k_plex').branchAt).toBe('above')

    expect(forest.getTask('k_nas').predecessorId).toBe('p_media') // grows above the project root
    expect(forest.getTask('p_media').predecessorId).toBeNull() // the root
  })

  it('assigns every node to the tree its root reaches, forks included', () => {
    expect(forest.getTreeIdForTask('p_media')).toBe('p_media')
    expect(forest.getTreeIdForTask('k_nas')).toBe('p_media')
    expect(forest.getTreeIdForTask('k_plex')).toBe('p_media') // a branch task, same tree as its root
    expect(forest.getTreeIdForTask('k_btrfs')).toBe('p_media')
    expect(forest.getTreeIdForTask('k_wifi')).toBe('p_net')
    expect(forest.getTreeIdForTask('k_energy')).toBe('p_auto')
  })

  it('walks the main-line chain via .next, stopping at a tip', () => {
    expect(forest.getMainLineChain('p_media')).toEqual(['p_media', 'k_nas', 'k_migrate', 'k_backups', 'k_restore'])
    expect(forest.getMainLineChain('k_nas')).toEqual(['k_nas', 'k_migrate', 'k_backups', 'k_restore'])
    expect(forest.getMainLineChain('k_wifi')).toEqual(['k_wifi', 'k_roam'])
    expect(forest.getMainLineChain('k_plex')).toEqual(['k_plex']) // a single-task branch tip
  })

  it('lists a fork point\'s branch children with side and gap', () => {
    const branches = forest.getBranchChildren('k_migrate')
    expect(branches).toEqual([
      { child: 'k_plex', side: 'left', at: 'above' },
      { child: 'k_btrfs', side: 'right', at: 'above' },
    ])
    expect(forest.getBranchChildren('k_restore')).toEqual([]) // a tip with no forks
  })

  it('finds the "here" task on each project\'s trunk line, skipping the project root', () => {
    expect(forest.getHereTaskId('p_media')).toBe('k_migrate')
    expect(forest.getHereTaskId('p_net')).toBe('k_firewall')
    expect(forest.getHereTaskId('p_auto')).toBe('k_zigbee')
    expect(forest.getHereTaskId('k_plex')).toBeNull() // this branch has no cursor
  })

  it('getTask/getTree return null for an unknown id rather than throwing', () => {
    expect(forest.getTask('nope')).toBeNull()
    expect(forest.getTree('nope')).toBeNull()
  })
})
