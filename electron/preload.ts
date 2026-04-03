import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('vibeIsland', {
  // Sessions
  getAllSessions: () => ipcRenderer.invoke('sessions:get-all'),
  dismissSession: (sessionId: string) => ipcRenderer.invoke('sessions:dismiss', sessionId),
  onSessionsChanged: (cb: (sessions: any[]) => void) => {
    const handler = (_: any, sessions: any[]) => cb(sessions)
    ipcRenderer.on('sessions:changed', handler)
    return () => ipcRenderer.removeListener('sessions:changed', handler)
  },

  // Island toggle
  islandToggle: (enabled: boolean) => ipcRenderer.invoke('island:toggle', enabled),
  islandGetStatus: () => ipcRenderer.invoke('island:get-status'),
  onIslandStatusChanged: (cb: (running: boolean) => void) => {
    const handler = (_: any, running: boolean) => cb(running)
    ipcRenderer.on('island:status-changed', handler)
    return () => ipcRenderer.removeListener('island:status-changed', handler)
  },

  // Hook install
  hookInstall: () => ipcRenderer.invoke('hooks:install'),
  hookCheck: () => ipcRenderer.invoke('hooks:check'),
  hookUninstall: () => ipcRenderer.invoke('hooks:uninstall'),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url)
})
