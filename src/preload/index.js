// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garycoding@gmail.com>
import { contextBridge } from 'electron'

// Placeholder bridge — add IPC surface here as the renderer needs it.
contextBridge.exposeInMainWorld('taskforkstack', {})
