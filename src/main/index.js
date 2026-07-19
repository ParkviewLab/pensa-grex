// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import pkg from '../../package.json'

const isDev = !app.isPackaged
const GITHUB_URL = 'https://github.com/garycoding/TaskForkStack'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#d3e6ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

let _aboutWin = null
function openAboutWindow() {
  if (_aboutWin && !_aboutWin.isDestroyed()) { _aboutWin.focus(); return }
  const html = `<!doctype html>
<meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#111116;color:#e9e9ec;-webkit-user-select:none;cursor:default}
  .wrap{height:100%;box-sizing:border-box;padding:30px 34px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center}
  h1{margin:0;font-size:21px;font-weight:600;letter-spacing:.2px}
  .ver{margin:3px 0 18px;font-size:12px;color:#9494a0}
  .copy{margin:20px 0 12px;font-size:11px;color:#85859090}
  a{color:#4fc3f7;text-decoration:none;font-size:12px}
  a:hover{text-decoration:underline}
</style>
<div class="wrap">
  <h1>TaskForkStack</h1>
  <div class="ver">Version ${pkg.version}</div>
  <div class="copy">© 2026 Gary Frattarola — AGPL-3.0-or-later, or commercial</div>
  <a href="${GITHUB_URL}" target="_blank" rel="noopener">Source code on GitHub</a>
</div>`
  _aboutWin = new BrowserWindow({
    width: 420, height: 280,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#111116',
    title: 'About TaskForkStack',
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  _aboutWin.setMenuBarVisibility(false)
  _aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  _aboutWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  _aboutWin.webContents.on('will-navigate', (e, url) => { e.preventDefault(); shell.openExternal(url) })
  _aboutWin.on('closed', () => { _aboutWin = null })
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => openAboutWindow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(process.platform !== 'darwin'
          ? [{ label: `About ${app.name}`, click: () => openAboutWindow() }, { type: 'separator' }]
          : []),
        { label: 'Source Code on GitHub', click: () => shell.openExternal(GITHUB_URL) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  const win = createWindow()
  buildMenu()

  // Safety net: keep the window from navigating away from the app; open any
  // external URL that slips through in the system browser instead.
  win.webContents.on('will-navigate', (e, url) => {
    const appUrl = isDev
      ? process.env['ELECTRON_RENDERER_URL']
      : `file://${join(__dirname, '../renderer/index.html')}`
    if (appUrl && !url.startsWith(appUrl)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
