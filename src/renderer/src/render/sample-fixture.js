// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// M1 fixture: the mock's own 3-tree HomeLab sample, transcribed to data so
// scene.js can prove the ported render modules reproduce it. This is a
// render-oriented fixture (positions, not task ids/edges) — a stand-in for
// the real forest model and layout engine that arrive in M2/M3, at which
// point this file is replaced by their output.

export const SAMPLE_BOUNDS = { w: 1320, h: 505 }

export const SAMPLE_BURSTS = [
  { x: 150, y: 120, scale: 2.6 },
  { x: 1120, y: 380, scale: 3.1, variant: 'b' },
  { x: 520, y: 400, scale: 1.7, variant: 'b' },
]

export const SAMPLE_TREES = [
  {
    title: 'Media server', titleX: 280, titleY: 483,
    dots: [[280, 400], [280, 160], [280, 40], [110, 160], [450, 160]],
    tracks: [
      [[280, 400], [280, 40]],
      [[280, 244], [110, 244], [110, 160]],
      [[280, 244], [450, 244], [450, 160]],
    ],
    forks: [[280, 244]],
    cursors: [[280, 280]],
    stations: [
      { x: 280, top: 415, title: 'Set up NAS', status: 'done' },
      { x: 280, top: 295, title: 'Migrate media library', status: 'prog', cursor: true },
      { x: 280, top: 175, title: 'Automate backups', status: 'prog' },
      { x: 280, top: 55, title: 'Test restore', status: 'todo' },
      { x: 110, top: 175, title: 'Fix Plex transcoding', status: 'todo', note: true },
      { x: 450, top: 175, title: 'Try Btrfs snapshots', status: 'cancel' },
    ],
  },
  {
    title: 'Home network', titleX: 820, titleY: 483,
    dots: [[820, 400], [820, 280], [650, 160], [650, 40]],
    tracks: [
      [[820, 400], [820, 160]],
      [[820, 244], [650, 244], [650, 40]],
    ],
    forks: [[820, 244]],
    cursors: [[820, 160]],
    stations: [
      { x: 820, top: 415, title: 'Rack + patch panel', status: 'done' },
      { x: 820, top: 295, title: 'VLAN segmentation', status: 'done' },
      { x: 820, top: 175, title: 'Firewall rules', status: 'prog', cursor: true },
      { x: 650, top: 175, title: 'Wi-Fi 7 APs', status: 'todo' },
      { x: 650, top: 55, title: 'Roaming test', status: 'todo' },
    ],
  },
  {
    title: 'Home automation', titleX: 1170, titleY: 483,
    dots: [[1170, 400], [1170, 160], [1000, 160]],
    tracks: [
      [[1170, 400], [1170, 160]],
      [[1170, 244], [1000, 244], [1000, 160]],
    ],
    forks: [[1170, 244]],
    cursors: [[1170, 280]],
    stations: [
      { x: 1170, top: 415, title: 'Install Home Assistant', status: 'done' },
      { x: 1170, top: 295, title: 'Zigbee hub', status: 'prog', cursor: true },
      { x: 1170, top: 175, title: 'Door / window sensors', status: 'todo' },
      { x: 1000, top: 175, title: 'Energy monitoring', status: 'todo' },
    ],
  },
]

export const STATUS_TAG = { done: 'done', prog: 'in progress', todo: 'to do', cancel: 'cancelled' }
