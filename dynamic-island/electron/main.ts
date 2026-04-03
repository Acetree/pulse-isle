import { app, ipcMain } from 'electron'
import { join } from 'path'
import { hasHardwareNotch } from './notchDetector'
import { WindowManager } from './windowManager'
import { WsClient } from './wsClient'

let windowManager: WindowManager | null = null
let wsClient: WsClient | null = null
let lastSessionsSync: any = null

app.dock?.hide()

process.on('SIGTERM', () => app.quit())

app.whenReady().then(() => {
  const notchSupported = hasHardwareNotch()
  if (!notchSupported) {
    console.warn('[Island] No hardware notch detected, continuing anyway.')
  }

  const preloadPath = join(__dirname, '../preload/index.js')

  windowManager = new WindowManager(preloadPath)
  windowManager.createWindows()

  if (process.env.ELECTRON_RENDERER_URL) {
    windowManager.loadPages(`${process.env.ELECTRON_RENDERER_URL}/resources/notch.html`)
  } else {
    windowManager.loadFiles(join(__dirname, '../renderer/resources/notch.html'))
  }

  wsClient = new WsClient()

  wsClient.on('connected', () => {
    windowManager?.setConnectionStatus(true)
    // Always fetch fresh state on (re)connect so renderers stay in sync
    wsClient?.send({ type: 'sessions:fetch' })
  })
  wsClient.on('disconnected', () => windowManager?.setConnectionStatus(false))

  wsClient.on('message', (data: any) => {
    if (data.type === 'sessions:sync') {
      lastSessionsSync = data
      windowManager?.scheduleAutoHideIfIdle(data.sessions ?? [])
    }
    if (data.type === 'session:update' && lastSessionsSync) {
      // Patch the cached sessions and re-evaluate idle state
      const patched = (lastSessionsSync.sessions ?? []).map((s: any) =>
        s.id === data.sessionId ? { ...s, status: data.status } : s
      )
      windowManager?.scheduleAutoHideIfIdle(patched)
    }
    windowManager?.broadcastToRenderers(data)
    if (data.type === 'notification') {
      // waiting: expand and stay open (0 = no auto-collapse)
      // completed: expand and auto-collapse in 3s
      // error: expand and auto-collapse in 5s
      const duration = data.level === 'info' ? 0 : data.level === 'success' ? 3000 : 5000
      windowManager?.expandForNotification(duration)
    }
  })

  ipcMain.on('ws:send', (_e, message) => wsClient?.send(message))

  ipcMain.on('island:renderer-ready', () => {
    // Always request fresh state from the server; fall back to cache only when disconnected
    if (wsClient?.connected) {
      wsClient.send({ type: 'sessions:fetch' })
    } else if (lastSessionsSync) {
      windowManager?.broadcastToRenderers(lastSessionsSync)
    }
  })

  wsClient.connect()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  wsClient?.close()
  windowManager?.destroy()
})
