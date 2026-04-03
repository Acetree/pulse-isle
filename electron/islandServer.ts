import { WebSocketServer, WebSocket } from 'ws'
import { sessionManager, CliSession } from './sessionManager'
import { focusTerminal, typeInTerminal, submitSelectionInTerminal, isTerminalFocused } from './terminalFocus'

const ISLAND_PORT = 9720
const MAX_PORT_ATTEMPTS = 10
const APPROVAL_NOTIFY_DELAY_MS = 350

let wss: WebSocketServer | null = null
let clients = new Set<WebSocket>()
let activePort = ISLAND_PORT
let lastSync: object | null = null

// sessionId → timer for debounced waitingForApproval notification
const approvalNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>()
const approvalStateStartedAt = new Map<string, number>()

export function getIslandPort(): number {
  return activePort
}

export function startIslandServer(): void {
  tryListen(ISLAND_PORT, 0)
}

function tryListen(port: number, attempt: number): void {
  const server = new WebSocketServer({ port, host: '127.0.0.1' })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      server.close()
      tryListen(port + 1, attempt + 1)
    } else {
      console.error('[IslandServer] Failed:', err)
    }
  })

  server.on('listening', () => {
    wss = server
    activePort = port
    console.log(`[IslandServer] Listening on ws://localhost:${port}`)
    setupConnections()
  })
}

function setupConnections(): void {
  if (!wss) return

  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress || ''
    if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
      ws.close(); return
    }

    clients.add(ws)

    // Send current sessions immediately
    const syncMsg = { type: 'sessions:sync', sessions: sessionManager.getAll() }
    lastSync = syncMsg
    ws.send(JSON.stringify(syncMsg))

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        handleIslandMessage(msg)
      } catch { /* ignore */ }
    })

    ws.on('close', () => {
      clients.delete(ws)
    })
  })

  // Bridge session events to island
  sessionManager.on('session:created', (session: CliSession) => {
    broadcast({ type: 'session:update', sessionId: session.id, ...sessionToUpdate(session) })
    broadcast({ type: 'sessions:sync', sessions: sessionManager.getAll() })
    // Only auto-expand for the first session — if other active sessions already exist,
    // this is likely a sub-agent spawned mid-task and should not pop up the island
    const activeSessions = sessionManager.getAll().filter(s =>
      s.id !== session.id &&
      s.status !== 'ended' && s.status !== 'interrupted'
    )
    if (activeSessions.length === 0 && !isTerminalFocused(session)) {
      broadcast({ type: 'notification', sessionId: session.id, level: 'info', text: 'Session started' })
    }
  })

  sessionManager.on('session:updated', (session: CliSession) => {
    broadcast({ type: 'session:update', sessionId: session.id, ...sessionToUpdate(session) })

    if (session.status === 'waitingForApproval' || session.status === 'question') {
      const startedAt = approvalStateStartedAt.get(session.id) ?? Date.now()
      approvalStateStartedAt.set(session.id, startedAt)

      // Debounce: only notify if the waiting state is still present after a stable delay.
      // This filters out short-lived auto-allow flashes.
      const existing = approvalNotifyTimers.get(session.id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        approvalNotifyTimers.delete(session.id)
        const current = sessionManager.get(session.id)
        const stateAge = approvalStateStartedAt.has(session.id)
          ? Date.now() - (approvalStateStartedAt.get(session.id) ?? Date.now())
          : 0
        if ((current?.status === 'waitingForApproval' || current?.status === 'question') &&
          stateAge >= APPROVAL_NOTIFY_DELAY_MS) {
          // Always expand for approval/question — user needs to interact with the island
          broadcast({
            type: 'notification',
            sessionId: session.id,
            level: 'info',
            text: current.promptText || 'Confirmation needed'
          })
        }
      }, APPROVAL_NOTIFY_DELAY_MS)
      approvalNotifyTimers.set(session.id, timer)
    } else {
      // Status changed away from waiting — cancel pending notification (e.g. Always Allow resolved it)
      const existing = approvalNotifyTimers.get(session.id)
      if (existing) { clearTimeout(existing); approvalNotifyTimers.delete(session.id) }
      approvalStateStartedAt.delete(session.id)
    }
  })

  sessionManager.on('session:todos-complete', ({ id }: { id: string }) => {
    // Only notify when the session has actually ended — not during intermediate phases
    // where all current todos happen to be complete before new ones are added
    const session = sessionManager.get(id)
    if (session?.status === 'ended' && !isTerminalFocused(session)) {
      broadcast({ type: 'notification', sessionId: id, level: 'success', text: 'All tasks completed' })
    }
  })

  sessionManager.on('session:deleted', (sessionId: string) => {
    broadcast({ type: 'session:delete', sessionId })
  })
}

function sessionToUpdate(session: CliSession) {
  return {
    status: session.status,
    title: session.title,
    name: session.name,
    lastMessage: session.lastMessage,
    tool: session.tool,
    cwd: session.cwd,
    currentTool: session.currentTool,
    currentToolInput: session.currentToolInput,
    promptText: session.promptText,
    promptOptions: session.promptOptions,
    todos: session.todos
  }
}

function mapPlanResponse(
  session: CliSession,
  value: string
): { socketValue: string; terminalChoice: string } {
  const options = session.promptOptions ?? []
  const optionIndex = options.findIndex(option => option === value)
  if (optionIndex >= 0) {
    return {
      socketValue: optionIndex === options.length - 1 && /tell claude/i.test(value) ? 'Provide Feedback' : value,
      terminalChoice: String(optionIndex + 1)
    }
  }

  // Backward-compatible fallback for older island UI labels.
  if (value === 'Approve Plan') return { socketValue: value, terminalChoice: '1' }
  if (value === 'Reject') return { socketValue: value, terminalChoice: '' }
  return { socketValue: value, terminalChoice: '' }
}

function handleIslandMessage(msg: any): void {
  switch (msg.type) {
    case 'session:respond': {
      const respondSession = sessionManager.get(msg.sessionId)
      console.log('[IslandServer] session:respond', {
        sessionId: msg.sessionId,
        value: msg.value,
        status: respondSession?.status,
        tool: respondSession?.tool,
        currentTool: respondSession?.currentTool
      })
      if (respondSession?.status === 'question') {
        // AskUserQuestion: focus terminal and type the selected answer
        focusTerminal(respondSession)
        typeInTerminal(msg.value)
        sessionManager.update(msg.sessionId, {
          status: 'processing',
          promptText: undefined,
          promptOptions: undefined,
          currentTool: undefined,
          currentToolInput: undefined
        })
      } else if (
        respondSession?.status === 'waitingForApproval' &&
        respondSession.tool === 'claude' &&
        respondSession.currentTool === 'ExitPlanMode'
      ) {
        const mapped = mapPlanResponse(respondSession, msg.value)
        sessionManager.respond(msg.sessionId, mapped.socketValue)
        if (mapped.terminalChoice) {
          focusTerminal(respondSession)
          submitSelectionInTerminal(mapped.terminalChoice)
        }
      } else if (
        respondSession?.status === 'waitingForApproval' &&
        respondSession.tool === 'claude' &&
        respondSession.currentTool !== 'ExitPlanMode'
      ) {
        // The pending hook-socket response is the real approval path.
        // Terminal key sync is best-effort only.
        sessionManager.respond(msg.sessionId, msg.value)

        // Keep Claude CLI's native approval prompt visually in sync with the island choice.
        const choice =
          msg.value === 'Allow Once' ? '1' :
          msg.value === 'Always Allow' ? '2' :
          msg.value === 'Deny' ? '3' :
          ''
        if (choice) {
          focusTerminal(respondSession)
          submitSelectionInTerminal(choice)
        }
      } else {
        sessionManager.respond(msg.sessionId, msg.value)
      }
      break
    }

    case 'session:focus-terminal': {
      const session = sessionManager.get(msg.sessionId)
      if (session) focusTerminal(session)
      break
    }

    case 'sessions:fetch':
      broadcast({ type: 'sessions:sync', sessions: sessionManager.getAll() })
      break

    case 'session:dismiss':
      // User dismissed a completed/error session card
      sessionManager.delete(msg.sessionId)
      break
  }
}

function broadcast(data: object): void {
  const payload = JSON.stringify(data)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

export function stopIslandServer(): void {
  wss?.close()
  clients.clear()
  for (const t of approvalNotifyTimers.values()) clearTimeout(t)
  approvalNotifyTimers.clear()
  approvalStateStartedAt.clear()
}
