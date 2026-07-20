// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Small themed modal dialogs, promise-based. Electron disables window.prompt,
// so title entry (Add task / Rename) and the delete choice (subtree vs splice)
// need an in-app equivalent. Both build a backdrop + card from CSS-var colours
// (style.css), resolve on a button, and clean up after themselves. Escape and a
// backdrop click resolve to the cancel value (null).

function mountBackdrop() {
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  const modal = document.createElement('div')
  modal.className = 'modal'
  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)
  return { backdrop, modal }
}

function titleEl(text) {
  const h = document.createElement('div')
  h.className = 'modal-title'
  h.textContent = text
  return h
}

function actionsRow() {
  const row = document.createElement('div')
  row.className = 'modal-actions'
  return row
}

function button(label, kind) {
  const b = document.createElement('button')
  b.className = 'modal-btn' + (kind ? ' ' + kind : '')
  b.textContent = label
  return b
}

// Ask for a line of text. Resolves the string on OK (may be empty), or null on
// Cancel / Escape / backdrop click.
export function promptText({ title = 'Enter text', label = '', value = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const { backdrop, modal } = mountBackdrop()
    modal.appendChild(titleEl(title))

    if (label) {
      const lab = document.createElement('label')
      lab.className = 'modal-label'
      lab.textContent = label
      modal.appendChild(lab)
    }
    const input = document.createElement('input')
    input.className = 'modal-input'
    input.type = 'text'
    input.value = value
    modal.appendChild(input)

    const row = actionsRow()
    const cancel = button('Cancel')
    const ok = button(okLabel, 'primary')
    row.appendChild(cancel)
    row.appendChild(ok)
    modal.appendChild(row)

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true)
      backdrop.remove()
      resolve(result)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null) }
      else if (e.key === 'Enter') { e.preventDefault(); close(input.value) }
    }
    document.addEventListener('keydown', onKey, true)
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null) })
    cancel.addEventListener('click', () => close(null))
    ok.addEventListener('click', () => close(input.value))

    input.focus()
    input.select()
  })
}

// Present a message and a set of choices. actions is [{ label, value, kind }].
// Resolves the chosen value, or null on Escape / backdrop / a Cancel choice.
export function chooseAction({ title = '', message = '', actions = [] } = {}) {
  return new Promise((resolve) => {
    const { backdrop, modal } = mountBackdrop()
    if (title) modal.appendChild(titleEl(title))
    if (message) {
      const p = document.createElement('div')
      p.className = 'modal-message'
      p.textContent = message
      modal.appendChild(p)
    }
    const row = actionsRow()
    const close = (result) => {
      document.removeEventListener('keydown', onKey, true)
      backdrop.remove()
      resolve(result)
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null) } }
    for (const a of actions) {
      const b = button(a.label, a.kind)
      b.addEventListener('click', () => close(a.value))
      row.appendChild(b)
    }
    modal.appendChild(row)
    document.addEventListener('keydown', onKey, true)
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null) })
  })
}
