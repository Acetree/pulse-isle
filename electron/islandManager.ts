import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { getIslandPort } from './islandServer'

let islandProcess: ChildProcess | null = null

function broadcastStatus(running: boolean): void {
  BrowserWindow.getAllWindows().forEach(win => {
    try {
      if (!win.isDestroyed()) win.webContents.send('island:status-changed', running)
    } catch { /* window disposed */ }
  })
}

export function spawnIsland(): void {
  if (islandProcess) return

  const islandMain = app.isPackaged
    ? path.join(process.resourcesPath, 'dynamic-island/out/main/index.js')
    : path.join(__dirname, '../../dynamic-island/out/main/index.js')

  if (!fs.existsSync(islandMain)) {
    console.warn('[islandManager] Island entry not found:', islandMain)
    broadcastStatus(false)
    return
  }

  islandProcess = spawn(process.execPath, [islandMain], {
    stdio: 'ignore',
    detached: false,
    env: {
      ...process.env,
      VIBE_IS_ISLAND: '1',
      ANTHROPIC_API_KEY: undefined,
      ELECTRON_RENDERER_URL: undefined,
      ISLAND_WS_PORT: String(getIslandPort())
    } as NodeJS.ProcessEnv
  })

  islandProcess.on('exit', () => {
    islandProcess = null
    broadcastStatus(false)
  })

  islandProcess.on('error', (err) => {
    console.error('[islandManager] spawn error:', err)
    islandProcess = null
    broadcastStatus(false)
  })

  broadcastStatus(true)
}

export function killIsland(): void {
  if (!islandProcess) return
  const proc = islandProcess
  proc.kill('SIGTERM')
  const t = setTimeout(() => {
    try { if (proc.pid && !proc.killed) process.kill(proc.pid, 'SIGKILL') } catch { /* already dead */ }
  }, 2000)
  proc.on('exit', () => clearTimeout(t))
}

export function isIslandRunning(): boolean {
  return islandProcess !== null
}
