// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

import { describe, it, expect, beforeAll } from 'vitest'
import JSON5 from 'json5'
import fixtureRaw from './fixtures/homelab.record.json?raw'
import { validateRecord } from './validate.js'
import { buildModel } from './model.js'

describe('buildModel — the HomeLab fixture', () => {
  let record, model

  beforeAll(() => {
    record = JSON5.parse(fixtureRaw)
    expect(validateRecord(record).ok).toBe(true) // the model is only meant to be built from a valid record
    model = buildModel(record)
  })

  it('carries the domain and all three projects, named by their root nodes, in planOrder', () => {
    expect(model.title).toBe('HomeLab') // the domain's name; the domain also has an id of its own now
    expect(model.id).toBe('d_homelab000')
    expect(model.plans.map((t) => model.getNode(t.baseId).title)).toEqual(['Media server', 'Home network', 'Home automation'])
    expect(model.plans.map((t) => t.id)).toEqual(['p_media', 'p_net', 'p_auto'])
  })

  it('derives each task\'s predecessor without it being stored on the task', () => {
    expect(record.nodes.k_migrate.predecessorId).toBeUndefined() // not in the source
    expect(model.getNode('k_migrate').predecessorId).toBe('k_nas')
    expect(model.getNode('k_migrate').predecessorKind).toBe('next')

    expect(model.getNode('k_plex').predecessorId).toBe('k_migrate')
    expect(model.getNode('k_plex').predecessorKind).toBe('branch')
    expect(model.getNode('k_plex').branchSide).toBe('left')
    // Schema 3: a fork has no "above or below" left to derive — a branch array names
    // the edge that rises from the node holding it, and that is the only edge it can
    // name. What branchAt === 'above' used to assert is now said by k_plex sitting in
    // k_migrate's leftBranches array, so that is asserted in its place.
    expect(model.getNode('k_plex').branchAt).toBeUndefined()
    expect(record.nodes.k_migrate.leftBranches).toEqual(['k_plex'])

    expect(model.getNode('k_nas').predecessorId).toBe('p_media') // grows above the project root
    expect(model.getNode('p_media').predecessorId).toBeNull() // the root
    // Termini: a terminus is a node like any other here — its predecessor is derived
    // from the .next that points at it and is not stored on it either.
    expect(record.nodes.t_media.predecessorId).toBeUndefined()
    expect(model.getNode('t_media').predecessorId).toBe('k_restore')
    expect(model.getNode('t_media').predecessorKind).toBe('next')
  })

  it('assigns every node to the tree its root reaches, forks included', () => {
    expect(model.getPlanIdForNode('p_media')).toBe('p_media')
    expect(model.getPlanIdForNode('k_nas')).toBe('p_media')
    expect(model.getPlanIdForNode('k_plex')).toBe('p_media') // a branch task, same tree as its root
    expect(model.getPlanIdForNode('k_btrfs')).toBe('p_media')
    expect(model.getPlanIdForNode('k_wifi')).toBe('p_net')
    expect(model.getPlanIdForNode('k_energy')).toBe('p_auto')
    expect(model.getPlanIdForNode('t_net')).toBe('p_net') // Termini: a close belongs to the tree it closes
  })

  it('walks the main-line chain via .next, stopping at a tip', () => {
    // Termini: a plan's trunk no longer stops at its last task — it runs up to the
    // terminus closing the base project node, which is the tip of that trunk. The
    // chain is still every node reachable by .next from the start, and the walk still
    // stops where .next is null; the fixture's plan trunks simply end one node higher.
    expect(model.getMainLineChain('p_media')).toEqual(['p_media', 'k_nas', 'k_migrate', 'k_backups', 'k_restore', 't_media'])
    expect(model.getMainLineChain('k_nas')).toEqual(['k_nas', 'k_migrate', 'k_backups', 'k_restore', 't_media'])
    expect(model.getNode('t_media').kind).toBe('terminus') // the tip above is the plan's close, not a task
    expect(model.getMainLineChain('k_wifi')).toEqual(['k_wifi', 'k_roam']) // a branch line still ends at a task tip
    expect(model.getMainLineChain('k_plex')).toEqual(['k_plex']) // a single-task branch tip
  })

  it('lists a fork point\'s branch children with their side, in left-then-right order', () => {
    const branches = model.getBranchChildren('k_migrate')
    // Schema 3: there is no per-fork junction gap to report any more (a fork's gap is
    // always its holder's own row), so a fork carries a side and nothing else; the
    // exact-array match below also holds the flattening order, left array then right.
    expect(branches).toEqual([
      { child: 'k_plex', side: 'left' },
      { child: 'k_btrfs', side: 'right' },
    ])
    expect(model.getBranchChildren('k_restore')).toEqual([]) // a tip with no forks
  })

  it('finds the "here" task on each project\'s trunk line, skipping the project root', () => {
    expect(model.getHereTaskId('p_media')).toBe('k_migrate')
    expect(model.getHereTaskId('p_net')).toBe('k_firewall')
    expect(model.getHereTaskId('p_auto')).toBe('k_zigbee')
    expect(model.getHereTaskId('k_plex')).toBeNull() // this branch has no cursor
  })

  it('getNode/getPlan return null for an unknown id rather than throwing', () => {
    expect(model.getNode('nope')).toBeNull()
    expect(model.getPlan('nope')).toBeNull()
  })
})
