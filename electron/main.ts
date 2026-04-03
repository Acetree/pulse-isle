import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { startIslandServer, stopIslandServer } from './islandServer'
import { startHookSocketServer, stopHookSocketServer } from './hookSocketServer'
import { installHooks, checkHooks, removeHooks } from './hookInjector'
import { spawnIsland, killIsland, isIslandRunning } from './islandManager'
import { sessionManager } from './sessionManager'

// ── Island subprocess early exit ──
if (process.env.VIBE_IS_ISLAND === '1') {
  const islandEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'dynamic-island/out/main/index.js')
    : path.join(__dirname, '../../dynamic-island/out/main/index.js')
  if (fs.existsSync(islandEntry)) {
    require(islandEntry)
  } else {
    console.warn('[main] Island entry not found:', islandEntry)
    app.quit()
  }
} else {

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

const store = new Store<{ islandEnabled?: boolean; hooksEnabled?: boolean }>({
  defaults: {
    islandEnabled: true,
    hooksEnabled: true
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0f0f0f',
    title: 'Pulse Isle'
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  startIslandServer()
  startHookSocketServer()
  createWindow()

  // Keep hooks up to date unless the user explicitly removed them.
  if (store.get('hooksEnabled')) {
    installHooks(app.isPackaged, process.resourcesPath, __dirname).catch(() => {})
  }

  if (store.get('islandEnabled')) {
    spawnIsland()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  killIsland()
  stopIslandServer()
  stopHookSocketServer()
})

// ── IPC: Island toggle ──
ipcMain.handle('island:toggle', (_e, enabled: boolean) => {
  store.set('islandEnabled', enabled)
  if (enabled) { spawnIsland() } else { killIsland() }
})

ipcMain.handle('island:get-status', () => isIslandRunning())

// ── IPC: Sessions ──
ipcMain.handle('sessions:get-all', () => sessionManager.getAll())

ipcMain.handle('sessions:dismiss', (_e, sessionId: string) => {
  sessionManager.delete(sessionId)
})

// Forward session events to renderer
sessionManager.on('session:created', () => {
  mainWindow?.webContents.send('sessions:changed', sessionManager.getAll())
})
sessionManager.on('session:updated', () => {
  mainWindow?.webContents.send('sessions:changed', sessionManager.getAll())
})
sessionManager.on('session:deleted', () => {
  mainWindow?.webContents.send('sessions:changed', sessionManager.getAll())
})

// ── IPC: Hook installation ──
async function handleHooksInstall() {
  store.set('hooksEnabled', true)
  return installHooks(app.isPackaged, process.resourcesPath, __dirname)
}

function handleHooksCheck() {
  return checkHooks()
}

function handleHooksUninstall() {
  store.set('hooksEnabled', false)
  return removeHooks()
}

ipcMain.handle('hooks:install', handleHooksInstall)
ipcMain.handle('hooks:check', handleHooksCheck)
ipcMain.handle('hooks:uninstall', handleHooksUninstall)

// Backward-compatible aliases for older preload / renderer bundles.
ipcMain.handle('wrapper:install', handleHooksInstall)
ipcMain.handle('wrapper:check', handleHooksCheck)
ipcMain.handle('wrapper:uninstall', handleHooksUninstall)

ipcMain.handle('shell:open', (_e, url: string) => {
  shell.openExternal(url)
})

} // end else (main app branch)
