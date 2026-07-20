// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
import { contextBridge, ipcRenderer } from 'electron'

// The renderer's whole view of disk. Every method forwards to a main-process
// ipcMain.handle (src/main/index.js), which re-derives and bounds-checks the
// paths against the library root (src/main/store.js). Forest content crosses as
// raw JSON5 text; the renderer parses and validates it.
contextBridge.exposeInMainWorld('taskforkstack', {
  getSettings:       ()                  => ipcRenderer.invoke('tfs:get-settings'),
  setLastDomain:     (name)              => ipcRenderer.invoke('tfs:set-last-domain', name),
  getLibraryRoot:    ()                  => ipcRenderer.invoke('tfs:get-library-root'),
  chooseLibraryRoot: ()                  => ipcRenderer.invoke('tfs:choose-library-root'),
  listDomains:       ()                  => ipcRenderer.invoke('tfs:list-domains'),
  createForest:      (name)              => ipcRenderer.invoke('tfs:create-forest', name),
  deleteForest:      (dir)               => ipcRenderer.invoke('tfs:delete-forest', dir),
  loadForest:        (dir)               => ipcRenderer.invoke('tfs:load-forest', dir),
  saveForest:        (dir, text)         => ipcRenderer.invoke('tfs:save-forest', dir, text),
  readNote:          (dir, file)         => ipcRenderer.invoke('tfs:read-note', dir, file),
  writeNote:         (dir, file, text)   => ipcRenderer.invoke('tfs:write-note', dir, file, text),
  deleteNote:        (dir, file)         => ipcRenderer.invoke('tfs:delete-note', dir, file),
  openExternal:      (url)               => ipcRenderer.invoke('tfs:open-external', url),
  getViewState:      (domain)            => ipcRenderer.invoke('tfs:get-view-state', domain),
  setViewState:      (domain, state)     => ipcRenderer.invoke('tfs:set-view-state', domain, state),
  exportMarkdown:    (defaultName, text) => ipcRenderer.invoke('tfs:export-markdown', defaultName, text),
})
