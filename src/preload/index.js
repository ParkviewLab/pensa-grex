// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
import { contextBridge, ipcRenderer } from 'electron'

// The renderer's whole view of disk. Every method forwards to a main-process
// ipcMain.handle (src/main/index.js), which re-derives and bounds-checks the
// paths against the library root (src/main/store.js). Forest content crosses as
// raw JSON5 text; the renderer parses and validates it.
contextBridge.exposeInMainWorld('pensagrex', {
  getSettings:       ()                  => ipcRenderer.invoke('pensagrex:get-settings'),
  setLastDomain:     (name)              => ipcRenderer.invoke('pensagrex:set-last-domain', name),
  getLibraryRoot:    ()                  => ipcRenderer.invoke('pensagrex:get-library-root'),
  chooseLibraryRoot: ()                  => ipcRenderer.invoke('pensagrex:choose-library-root'),
  listDomains:       ()                  => ipcRenderer.invoke('pensagrex:list-domains'),
  createForest:      (name)              => ipcRenderer.invoke('pensagrex:create-forest', name),
  deleteForest:      (dir)               => ipcRenderer.invoke('pensagrex:delete-forest', dir),
  loadForest:        (dir)               => ipcRenderer.invoke('pensagrex:load-forest', dir),
  saveForest:        (dir, text)         => ipcRenderer.invoke('pensagrex:save-forest', dir, text),
  readNote:          (dir, file)         => ipcRenderer.invoke('pensagrex:read-note', dir, file),
  writeNote:         (dir, file, text)   => ipcRenderer.invoke('pensagrex:write-note', dir, file, text),
  deleteNote:        (dir, file)         => ipcRenderer.invoke('pensagrex:delete-note', dir, file),
  openExternal:      (url)               => ipcRenderer.invoke('pensagrex:open-external', url),
  getViewState:      (domain)            => ipcRenderer.invoke('pensagrex:get-view-state', domain),
  setViewState:      (domain, state)     => ipcRenderer.invoke('pensagrex:set-view-state', domain, state),
  exportMarkdown:    (defaultName, text) => ipcRenderer.invoke('pensagrex:export-markdown', defaultName, text),
  getBookmarks:      (dir)               => ipcRenderer.invoke('pensagrex:get-bookmarks', dir),
  setBookmarks:      (dir, text)         => ipcRenderer.invoke('pensagrex:set-bookmarks', dir, text),
})
