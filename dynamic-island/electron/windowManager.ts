import { BrowserWindow, screen, ipcMain } from 'electron'
import { getInternalDisplay } from './notchDetector'

type NotchState = 'capsule' | 'cards'

const NOTCH_WIDTH = 680
const CAPSULE_HEIGHT = 44
const MIN_CARDS_HEIGHT = 180
const DEFAULT_CARDS_HEIGHT = 280
const MAX_CARDS_HEIGHT = 520
const HOVER_POLL_INTERVAL = 60
const HOVER_TRIGGER_WIDTH = 300
const HOVER_TRIGGER_HEIGHT = 35
const COLLAPSE_DELAY = 200
const DWELL_EXPAND_MS = 300    // hover must persist this long before expanding
const AUTO_HIDE_IDLE_MS = 12_000  // collapse after all sessions idle for this long
const INTERACTIVE_WIDTH = 600

export class WindowManager {
  private notchWindow: BrowserWindow | null = null
  private notchState: NotchState = 'capsule'
  private expandedHeight = DEFAULT_CARDS_HEIGHT
  private hoverPollTimer: ReturnType<typeof setInterval> | null = null
  private collapseTimer: ReturnType<typeof setTimeout> | null = null
  private dwellTimer: ReturnType<typeof setTimeout> | null = null
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null
  private mouseInteractive = false

  constructor(private preloadPath: string) {}

  createWindows(): void {
    const display = getInternalDisplay()
    if (!display) return

    const centerX = display.bounds.x + Math.round((display.bounds.width - NOTCH_WIDTH) / 2)

    this.notchWindow = new BrowserWindow({
      width: NOTCH_WIDTH,
      height: CAPSULE_HEIGHT,
      x: centerX,
      y: display.bounds.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      fullscreenable: false,
      roundedCorners: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.notchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.notchWindow.setIgnoreMouseEvents(true, { forward: true })
    this.notchWindow.showInactive()
    this.notchWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    this.updateWindowBounds()

    this.setupIPC()
    this.startHoverPolling()
  }

  private setupIPC(): void {
    ipcMain.on('notch:mouse-enter', () => {
      if (this.collapseTimer) { clearTimeout(this.collapseTimer); this.collapseTimer = null }
      this.setMouseInteractive(true)
    })

    ipcMain.on('notch:mouse-leave', () => {
      if (this.notchState === 'cards') {
        this.setMouseInteractive(false)
        this.collapseTimer = setTimeout(() => this.transitionTo('capsule'), COLLAPSE_DELAY)
      }
    })

    ipcMain.on('notch:set-expanded-height', (_event, height: number) => {
      const nextHeight = Math.max(MIN_CARDS_HEIGHT, Math.min(MAX_CARDS_HEIGHT, Math.ceil(Number(height) || DEFAULT_CARDS_HEIGHT)))
      if (nextHeight === this.expandedHeight) return
      this.expandedHeight = nextHeight
      if (this.notchState === 'cards') this.updateWindowBounds()
    })
  }

  private updateWindowBounds(): void {
    if (!this.notchWindow || this.notchWindow.isDestroyed()) return

    const display = getInternalDisplay()
    if (!display) return

    const width = this.notchState === 'capsule' ? 240 : 600
    const height = this.notchState === 'capsule' ? CAPSULE_HEIGHT : this.expandedHeight
    const x = display.bounds.x + Math.round((display.bounds.width - width) / 2)

    this.notchWindow.setBounds({
      x,
      y: display.bounds.y,
      width,
      height
    })
  }

  private startHoverPolling(): void {
    if (this.hoverPollTimer) return
    this.hoverPollTimer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint()
      const display = getInternalDisplay()
      if (!display) return

      const centerX = display.bounds.x + display.bounds.width / 2
      if (this.notchState === 'capsule') {
        const triggerLeft = centerX - HOVER_TRIGGER_WIDTH / 2
        const triggerRight = centerX + HOVER_TRIGGER_WIDTH / 2
        const triggerBottom = display.bounds.y + HOVER_TRIGGER_HEIGHT

        const inZone = cursor.x >= triggerLeft && cursor.x <= triggerRight &&
                       cursor.y >= display.bounds.y && cursor.y <= triggerBottom

        if (inZone) {
          if (!this.dwellTimer) {
            this.dwellTimer = setTimeout(() => {
              this.dwellTimer = null
              if (this.notchState === 'capsule') this.transitionTo('cards')
            }, DWELL_EXPAND_MS)
          }
        } else {
          if (this.dwellTimer) { clearTimeout(this.dwellTimer); this.dwellTimer = null }
        }
      } else {
        const left = centerX - INTERACTIVE_WIDTH / 2
        const right = centerX + INTERACTIVE_WIDTH / 2
        const bottom = display.bounds.y + this.expandedHeight
        const insideInteractiveBounds =
          cursor.x >= left && cursor.x <= right &&
          cursor.y >= display.bounds.y && cursor.y <= bottom

        this.setMouseInteractive(insideInteractiveBounds)

        if (insideInteractiveBounds) {
          if (this.collapseTimer) { clearTimeout(this.collapseTimer); this.collapseTimer = null }
        } else if (!this.collapseTimer) {
          this.collapseTimer = setTimeout(() => this.transitionTo('capsule'), COLLAPSE_DELAY)
        }
      }
    }, HOVER_POLL_INTERVAL)
  }

  private stopHoverPolling(): void {
    if (this.hoverPollTimer) { clearInterval(this.hoverPollTimer); this.hoverPollTimer = null }
    if (this.dwellTimer) { clearTimeout(this.dwellTimer); this.dwellTimer = null }
  }

  private transitionTo(state: NotchState): void {
    this.notchState = state
    this.updateWindowBounds()
    if (state === 'cards') {
      if (this.autoHideTimer) { clearTimeout(this.autoHideTimer); this.autoHideTimer = null }
      if (this.notchWindow && !this.notchWindow.isDestroyed()) {
        this.setMouseInteractive(false)
      }
      this.safeSend(this.notchWindow, 'notch:state-change', 'cards')
    } else {
      if (this.notchWindow && !this.notchWindow.isDestroyed()) {
        this.setMouseInteractive(false)
      }
      this.safeSend(this.notchWindow, 'notch:state-change', 'capsule')
    }
  }

  private setMouseInteractive(enabled: boolean): void {
    if (!this.notchWindow || this.notchWindow.isDestroyed()) return
    if (this.mouseInteractive === enabled) return

    this.mouseInteractive = enabled
    this.notchWindow.setIgnoreMouseEvents(!enabled, { forward: true })
    this.notchWindow.setFocusable(enabled)
    if (enabled) this.notchWindow.focus()
  }

  // autoCollapseDuration: ms until auto-collapse, 0 = stay open
  expandForNotification(autoCollapseDuration = 5000): void {
    if (this.notchState === 'capsule') {
      this.transitionTo('cards')
      if (autoCollapseDuration > 0) {
        setTimeout(() => {
          if (this.notchState === 'cards') this.transitionTo('capsule')
        }, autoCollapseDuration)
      }
    }
  }

  /** Schedule auto-hide if all sessions are now idle. Call after each sessions:sync / session:update. */
  scheduleAutoHideIfIdle(sessions: Array<{ status: string }>): void {
    const hasActive = sessions.some(s => {
      const st = s.status
      return st === 'processing' || st === 'runningTool' || st === 'thinking' ||
             st === 'waitingForApproval' || st === 'waitingForInput' || st === 'question'
    })
    if (hasActive) {
      if (this.autoHideTimer) { clearTimeout(this.autoHideTimer); this.autoHideTimer = null }
    } else if (!this.autoHideTimer && this.notchState === 'cards') {
      this.autoHideTimer = setTimeout(() => {
        this.autoHideTimer = null
        if (this.notchState === 'cards') this.transitionTo('capsule')
      }, AUTO_HIDE_IDLE_MS)
    }
  }

  private safeSend(win: BrowserWindow | null, channel: string, ...args: any[]): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  broadcastToRenderers(data: any): void {
    this.safeSend(this.notchWindow, 'ws:message', data)
  }

  setConnectionStatus(connected: boolean): void {
    this.safeSend(this.notchWindow, 'ws:connection-status', connected)
  }

  loadPages(notchURL: string): void {
    this.notchWindow?.loadURL(notchURL)
  }

  loadFiles(notchPath: string): void {
    this.notchWindow?.loadFile(notchPath)
  }

  destroy(): void {
    this.stopHoverPolling()
    if (this.collapseTimer) clearTimeout(this.collapseTimer)
    if (this.autoHideTimer) clearTimeout(this.autoHideTimer)
    this.notchWindow?.destroy()
  }
}
