import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onStateChange: (callback: (state: string) => void) => {
    const handler = (_e: any, state: string) => callback(state)
    ipcRenderer.on('notch:state-change', handler)
    return () => ipcRenderer.removeListener('notch:state-change', handler)
  },
  notifyMouseEnter: () => ipcRenderer.send('notch:mouse-enter'),
  notifyMouseLeave: () => ipcRenderer.send('notch:mouse-leave'),
  setExpandedHeight: (height: number) => ipcRenderer.send('notch:set-expanded-height', height),
  onWsMessage: (callback: (data: any) => void) => {
    const handler = (_e: any, data: any) => callback(data)
    ipcRenderer.on('ws:message', handler)
    return () => ipcRenderer.removeListener('ws:message', handler)
  },
  wsSend: (message: any) => ipcRenderer.send('ws:send', message),
  onConnectionStatus: (callback: (connected: boolean) => void) => {
    const handler = (_e: any, connected: boolean) => callback(connected)
    ipcRenderer.on('ws:connection-status', handler)
    return () => ipcRenderer.removeListener('ws:connection-status', handler)
  },
  requestSync: () => ipcRenderer.send('island:renderer-ready')
}

contextBridge.exposeInMainWorld('island', api)
