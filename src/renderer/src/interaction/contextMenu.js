// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The right-click menu. openContextMenu(x, y, items) renders a floating menu at
// the pointer and returns nothing; it closes itself on an action, an outside
// click, Escape, scroll, or another right-click. items are a flat list of:
//   { separator: true }
//   { label, onClick, checked?, disabled? }
//   { label, submenu: [ ...items ] }
// Effects live in the caller (app.js); this module only presents and dispatches.

let openEl = null
let teardown = null

export function closeContextMenu() {
  if (teardown) teardown()
}

function buildMenu(items, onPick) {
  const menu = document.createElement('div')
  menu.className = 'menu'
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div')
      sep.className = 'menu-sep'
      menu.appendChild(sep)
      continue
    }
    const el = document.createElement('div')
    el.className = 'menu-item'
    if (item.disabled) el.classList.add('disabled')
    if (item.submenu) el.classList.add('has-sub')

    const check = document.createElement('span')
    check.className = 'menu-check'
    check.textContent = item.checked ? '✓' : ''
    el.appendChild(check)

    const label = document.createElement('span')
    label.className = 'menu-label'
    label.textContent = item.label
    el.appendChild(label)

    if (item.submenu) {
      const arrow = document.createElement('span')
      arrow.className = 'menu-arrow'
      arrow.textContent = '›'
      el.appendChild(arrow)
      const sub = buildMenu(item.submenu, onPick)
      sub.classList.add('submenu')
      el.appendChild(sub)
    } else if (!item.disabled) {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onPick()
        item.onClick()
      })
    }
    menu.appendChild(el)
  }
  return menu
}

export function openContextMenu(x, y, items) {
  closeContextMenu()

  const menu = buildMenu(items, () => closeContextMenu())
  menu.style.visibility = 'hidden'
  document.body.appendChild(menu)

  // Keep the menu on-screen: shift it back inside the viewport if the pointer
  // is near the right or bottom edge.
  const rect = menu.getBoundingClientRect()
  const px = x + rect.width > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : x
  const py = y + rect.height > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : y
  menu.style.left = px + 'px'
  menu.style.top = py + 'px'
  menu.style.visibility = 'visible'
  openEl = menu

  const onDown = (e) => { if (!menu.contains(e.target)) closeContextMenu() }
  const onKey = (e) => { if (e.key === 'Escape') closeContextMenu() }
  const onCtx = (e) => { if (!menu.contains(e.target)) closeContextMenu() }
  // capture-phase so a click anywhere dismisses before it does anything else
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('scroll', closeContextMenu, true)
  window.addEventListener('resize', closeContextMenu, true)
  document.addEventListener('contextmenu', onCtx, true)

  teardown = () => {
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('scroll', closeContextMenu, true)
    window.removeEventListener('resize', closeContextMenu, true)
    document.removeEventListener('contextmenu', onCtx, true)
    if (openEl) openEl.remove()
    openEl = null
    teardown = null
  }
}
