// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// The per-task markdown note editor: a full-window panel with a rendered-
// markdown view and an Edit toggle that reveals a CodeMirror editor beside it,
// live-previewing as one types and autosaving the task's .md file (debounced)
// through the persistence bridge. In edit mode a draggable splitter divides the
// source (left) and preview (right) panes, and a formatting toolbar sits atop
// the source pane. Rendering is marked (+ KaTeX for math); the editor is
// CodeMirror 6, GFM-flavoured, themed to the app's CSS variables (both chrome
// and syntax colours) so it matches whichever ground (azure/navy) is active.

import { basicSetup, EditorView } from 'codemirror'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import { wrapSelection, prefixLines, insertLink } from './mdCommands.js'

marked.use(markedKatex({ throwOnError: false }))

// Persisted per-editor preferences (mirrors theme.js's pensagrex.* keys).
const SPLIT_KEY = 'pensagrex.notesplit' // left pane's share of the content width, as a fraction
const WRAP_KEY = 'pensagrex.notewrap' // 'on' | 'off' (default on)
const DIVIDER_PX = 6
const MIN_PANE_PX = 220

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

// Source-pane syntax colours mapped to the palette CSS variables, so markdown
// tokens track the active ground the same way editorTheme themes the chrome.
// Registered as a primary highlighter, it wins over basicSetup's
// defaultHighlightStyle (which is added with {fallback: true}); tags we do not
// map (e.g. tokens inside fenced code) still fall back to that default. The
// markup punctuation (** # > - 1. `) carries tags.processingInstruction, so the
// single --muted rule dims every marker while its content keeps its own tag.
const pgHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--c-project)', fontWeight: '700' },
  { tag: tags.strong, color: 'var(--ink)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--ink)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--muted)', textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--c-done)' },
  { tag: tags.link, color: 'var(--c-done)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--c-prog)' },
  { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--c-todo)' },
  { tag: tags.labelName, color: 'var(--c-todo)' },
  { tag: tags.contentSeparator, color: 'var(--muted)' },
  { tag: tags.processingInstruction, color: 'var(--muted)' },
])

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
  const toggleBtn = elem('button', 'note-toggle', 'View')
  const closeBtn = elem('button', 'note-close', '✕')
  head.append(title, toggleBtn, closeBtn)

  const content = elem('div', 'note-content')
  const editorPane = elem('div', 'note-editor') // left pane (flex column: toolbar + editor)
  const toolbar = elem('div', 'note-toolbar')
  const cmHost = elem('div', 'note-cm-host') // CodeMirror mounts here
  editorPane.append(toolbar, cmHost)
  const divider = elem('div', 'note-divider') // draggable splitter between the panes
  const body = elem('div', 'note-body') // right pane (rendered preview)
  content.append(editorPane, divider, body)
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
  let splitRatio = 0.5
  let wrapOn = true
  const wrapCompartment = new Compartment()

  const isOpen = () => !backdrop.classList.contains('hidden')

  // Notes are portable files that may be shared or synced (northstar intent 3),
  // so note markdown is untrusted: marked does not sanitize, and this renders
  // into innerHTML, so run the output through DOMPurify to strip scripts,
  // inline event handlers, and javascript: URLs before it reaches the DOM.
  function renderPreview() {
    body.innerHTML = DOMPurify.sanitize(marked.parse(raw || ''))
  }

  function destroyEditor() {
    if (view) { view.destroy(); view = null }
  }

  // Snapshot the target before the await: close() may reset the module state
  // (domainPath/taskId/file/raw) while this write is in flight, so reading them
  // afterward for the onFirstWrite bookkeeping would use the cleared values.
  async function save() {
    if (file === null) return
    const dir = domainPath, f = file, id = taskId, text = raw
    const firstWrite = !recorded && text.trim().length > 0
    const r = await writeNote(dir, f, text)
    if (r && r.error) { console.warn('[note save]', r.error); return }
    if (firstWrite && onFirstWrite) {
      recorded = true
      onFirstWrite(id, f)
    }
  }

  // Force a pending debounced save to happen now (on Done, on close, on quit),
  // so edits made within the debounce window are never dropped.
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      save()
    }
  }

  // --- Formatting toolbar. Commands act on the current selection; buttons fire
  // on mousedown (preventDefault) so the editor keeps its selection and focus
  // rather than blurring on click before the command runs. ---
  function applyWrap(v, open, close) {
    v.dispatch({ ...wrapSelection(v.state, open, close), scrollIntoView: true })
    v.focus()
    return true
  }
  function applyPrefix(v, prefix) {
    v.dispatch({ ...prefixLines(v.state, prefix), scrollIntoView: true })
    v.focus()
    return true
  }
  function applyLink(v) {
    v.dispatch({ ...insertLink(v.state), scrollIntoView: true })
    v.focus()
    return true
  }

  function toolButton(label, tip, run, extra) {
    const b = elem('button', extra ? 'note-tool ' + extra : 'note-tool', label)
    b.type = 'button'
    b.title = tip
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (view) run(view)
    })
    return b
  }

  const wrapBtn = elem('button', 'note-tool note-wrap', 'Wrap')
  wrapBtn.type = 'button'
  wrapBtn.title = 'Toggle line wrapping'
  wrapBtn.addEventListener('mousedown', (e) => { e.preventDefault(); toggleWrap() })

  toolbar.append(
    toolButton('B', 'Bold (⌘B)', (v) => applyWrap(v, '**'), 'tb'),
    toolButton('I', 'Italic (⌘I)', (v) => applyWrap(v, '*'), 'ti'),
    toolButton('S', 'Strikethrough (⌘⇧X)', (v) => applyWrap(v, '~~'), 'ts'),
    toolButton('</>', 'Inline code (⌘E)', (v) => applyWrap(v, '`')),
    toolButton('H', 'Heading', (v) => applyPrefix(v, '# ')),
    toolButton('Link', 'Link (⌘K)', (v) => applyLink(v)),
    toolButton('List', 'Bullet list', (v) => applyPrefix(v, '- ')),
    toolButton('1.', 'Numbered list', (v) => applyPrefix(v, (i) => `${i + 1}. `)),
    toolButton('Quote', 'Blockquote', (v) => applyPrefix(v, '> ')),
    toolButton('Code', 'Code block', (v) => applyWrap(v, '```\n', '\n```')),
    wrapBtn,
  )

  const formatKeymap = keymap.of([
    { key: 'Mod-b', run: (v) => applyWrap(v, '**') },
    { key: 'Mod-i', run: (v) => applyWrap(v, '*') },
    { key: 'Mod-Shift-x', run: (v) => applyWrap(v, '~~') },
    { key: 'Mod-e', run: (v) => applyWrap(v, '`') },
    { key: 'Mod-k', run: (v) => applyLink(v) },
  ])

  function syncWrapBtn() {
    wrapBtn.classList.toggle('on', wrapOn)
    wrapBtn.setAttribute('aria-pressed', String(wrapOn))
  }
  function toggleWrap() {
    if (!view) return
    wrapOn = !wrapOn
    view.dispatch({ effects: wrapCompartment.reconfigure(wrapOn ? EditorView.lineWrapping : []) })
    syncWrapBtn()
    try { localStorage.setItem(WRAP_KEY, wrapOn ? 'on' : 'off') } catch { /* storage may be unavailable */ }
  }

  // --- Draggable splitter between the source and preview panes. The ratio (the
  // left pane's share of the content width) is stored as a fraction so it
  // survives window resizes; pointer capture keeps the drag off the editor. ---
  function applySplit() {
    editorPane.style.flexBasis = `calc((100% - ${DIVIDER_PX}px) * ${splitRatio})`
  }
  function clampRatio(r, usable) {
    const min = Math.min(MIN_PANE_PX / usable, 0.4)
    return Math.min(1 - min, Math.max(min, r))
  }
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId)
    panel.classList.add('resizing')
  })
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return
    const rect = content.getBoundingClientRect()
    const usable = rect.width - DIVIDER_PX
    if (usable <= 0) return
    splitRatio = clampRatio((e.clientX - rect.left - DIVIDER_PX / 2) / usable, usable)
    applySplit()
  })
  function endResize(e) {
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId)
    panel.classList.remove('resizing')
    try { localStorage.setItem(SPLIT_KEY, String(splitRatio)) } catch { /* storage may be unavailable */ }
  }
  divider.addEventListener('pointerup', endResize)
  divider.addEventListener('pointercancel', endResize)
  divider.addEventListener('dblclick', () => {
    splitRatio = 0.5
    applySplit()
    try { localStorage.setItem(SPLIT_KEY, '0.5') } catch { /* storage may be unavailable */ }
  })

  function createEditor() {
    destroyEditor()
    syncWrapBtn()
    view = new EditorView({
      state: EditorState.create({
        doc: raw,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(pgHighlight),
          wrapCompartment.of(wrapOn ? EditorView.lineWrapping : []),
          Prec.high(formatKeymap),
          editorTheme,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            raw = u.state.doc.toString()
            renderPreview()
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => { saveTimer = null; save() }, 500)
          }),
        ],
      }),
      parent: cmHost,
    })
    view.focus()
  }

  function applyMode() {
    panel.classList.toggle('edit', editMode)
    toggleBtn.textContent = editMode ? 'View' : 'Edit'
    renderPreview()
    if (editMode) {
      createEditor()
    } else {
      flush() // leaving edit (View) must not drop edits still inside the debounce window
      destroyEditor()
    }
  }

  toggleBtn.addEventListener('click', () => { editMode = !editMode; applyMode() })
  closeBtn.addEventListener('click', close)
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

    // Restore persisted preferences before building the editor.
    let s = null
    try { s = localStorage.getItem(SPLIT_KEY) } catch { /* storage may be unavailable */ }
    const parsed = parseFloat(s)
    splitRatio = Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.5
    applySplit()
    try { wrapOn = localStorage.getItem(WRAP_KEY) !== 'off' } catch { wrapOn = true }

    editMode = true
    destroyEditor()
    applyMode()
    backdrop.classList.remove('hidden')
  }

  function close() {
    flush() // write any pending edit before we tear the panel down (regardless of view)
    destroyEditor()
    backdrop.classList.add('hidden')
    body.innerHTML = ''
    domainPath = taskId = file = null
    raw = ''
    editMode = false
  }

  return { open, close, flush, isOpen }
}
