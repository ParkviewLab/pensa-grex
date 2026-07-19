// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// Map a DOM event to the task it occurred on. Every station card carries a
// data-task-id (render/card.js), so the nearest ancestor with that attribute
// is the task under the pointer; null means the event was on empty canvas.
export function taskIdFromEvent(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-task-id]') : null
  return el ? el.dataset.taskId : null
}
