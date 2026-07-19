// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>

// The per-task markdown note editor, following ParkviewLab conception-space's
// pattern (the convention, not a code dependency): a right-docked panel with a
// rendered-markdown view and an Edit toggle that reveals a CodeMirror editor
// beside it, live-previewing as one types and autosaving the task's .md file
// (debounced) through the persistence bridge. Rendering is marked (+ KaTeX for
// math); the editor is CodeMirror 6. The editor is themed to the app's CSS
// variables so it matches whichever ground (azure/navy) is active, rather than
// pulling a fixed dark theme.

import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import 'katex/dist/katex.min.css'

marked.use(markedKatex({ throwOnError: false }))

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--line) 12%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'var(--cursor)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':
    { backgroundColor: 'color-mix(in srgb, var(--cursor) 24%, transparent)' },
})

function elem(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text != null) el.textContent = text
  return el
}

// readNote/writeNote/openExternal come from bridge/api.js; onFirstWrite(taskId,
// filename) lets the caller record the note filename on a task once its note
// first gains content (so the .card.note dot appears and the name is persisted).
export function createNoteEditor({ readNote, writeNote, openExternal, onFirstWrite }) {
  const backdrop = elem('div', 'note-backdrop hidden')
  const panel = elem('div', 'note-panel')
  const head = elem('div', 'note-head')
  const title = elem('div', 'note-title')
  const toggleBtn = elem('button', 'note-toggle', 'Edit')
  const closeBtn = elem('button', 'note-close', '✕')
  head.append(title, toggleBtn, closeBtn)
  const content = elem('div', 'note-content')
  const editorPane = elem('div', 'note-editor')
  const body = elem('div', 'note-body')
  content.append(editorPane, body)
  panel.append(head, content)
  backdrop.append(panel)
  document.body.append(backdrop)

  let domainPath = null
  let taskId = null
  let file = null
  let raw = ''
  let editMode = false
  let recorded = false // whether this task's note filename is already on the task
  let view = null
  let saveTimer = null

  const isOpen = () => !backdrop.classList.contains('hidden')

  function renderPreview() {
    body.innerHTML = marked.parse(raw || '')
  }

  function destroyEditor() {
    if (view) { view.destroy(); view = null }
  }

  async function save() {
    if (file === null) return
    const r = await writeNote(domainPath, file, raw)
    if (r && r.error) { console.warn('[note save]', r.error); return }
    if (!recorded && raw.trim().length && onFirstWrite) {
      recorded = true
      onFirstWrite(taskId, file)
    }
  }

  function createEditor() {
    destroyEditor()
    view = new EditorView({
      state: EditorState.create({
        doc: raw,
        extensions: [
          basicSetup,
          markdown(),
          editorTheme,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            raw = u.state.doc.toString()
            renderPreview()
            clearTimeout(saveTimer)
            saveTimer = setTimeout(save, 500)
          }),
        ],
      }),
      parent: editorPane,
    })
    view.focus()
  }

  function applyMode() {
    panel.classList.toggle('edit', editMode)
    toggleBtn.textContent = editMode ? 'Done' : 'Edit'
    renderPreview()
    if (editMode) createEditor()
    else destroyEditor()
  }

  toggleBtn.addEventListener('click', () => { editMode = !editMode; applyMode() })
  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close() })
  document.addEventListener('keydown', (e) => {
    if (isOpen() && e.key === 'Escape' && !e.target.closest('.cm-editor')) close()
  })

  // Links in the rendered note open in the system browser, never in-app.
  body.addEventListener('click', (e) => {
    const a = e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    const href = a.getAttribute('href')
    if (href && !href.startsWith('#')) {
      e.preventDefault()
      if (openExternal) openExternal(href)
      else window.open(href, '_blank', 'noopener')
    }
  })

  async function open(task, dir) {
    taskId = task.id
    domainPath = dir
    file = task.note || task.id + '.md'
    recorded = !!task.note
    title.textContent = task.title
    const res = await readNote(domainPath, file)
    raw = res && typeof res.content === 'string' ? res.content : ''
    editMode = false
    destroyEditor()
    applyMode()
    backdrop.classList.remove('hidden')
  }

  function close() {
    clearTimeout(saveTimer)
    if (view) save() // flush any pending edit
    destroyEditor()
    backdrop.classList.add('hidden')
    body.innerHTML = ''
    domainPath = taskId = file = null
    raw = ''
    editMode = false
  }

  return { open, close, isOpen }
}
