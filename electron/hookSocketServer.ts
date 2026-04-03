import { createServer, Server, Socket } from 'net'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { sessionManager, TodoItem, type CliSession, type TerminalApp } from './sessionManager'

// sessionId → current todo list (mutated by Task tool calls)
const sessionTodos = new Map<string, Map<string, TodoItem>>()

// sessionId → idle fallback timer (fires if no hook event for IDLE_FALLBACK_MS)
const idleFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>()
const IDLE_FALLBACK_MS = 30_000
const SESSION_SWEEP_MS = 10_000
const THINKING_SOFT_TIMEOUT_MS = 90_000
const THINKING_HARD_TIMEOUT_MS = 180_000
let sessionSweepTimer: ReturnType<typeof setInterval> | null = null

interface LivenessAssessment {
  hasRecentHook: boolean
  hasTtyProcess: boolean
  hasMeaningfulTtyProcess: boolean
  hasTrackedPid: boolean
  hasTerminalApp: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

function logApproval(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.log(`[Approval] ${message}`, details)
  } else {
    console.log(`[Approval] ${message}`)
  }
}

function isToolCompletionMessage(message?: string): boolean {
  if (!message) return false
  return / completed$/.test(message)
}

function isLiveStatus(status: string): boolean {
  return status === 'processing' ||
    status === 'thinking' ||
    status === 'runningTool' ||
    status === 'waitingForApproval' ||
    status === 'waitingForInput' ||
    status === 'question'
}

function ttyHasProcesses(tty?: string): boolean {
  if (!tty) return true
  const ttyName = path.basename(tty)
  if (!ttyName) return true
  try {
    const result = spawnSync('ps', ['-t', ttyName, '-o', 'pid='], {
      encoding: 'utf8',
      timeout: 2000
    })
    if (result.status !== 0) return true
    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .length > 0
  } catch {
    return true
  }
}

function listTtyProcesses(tty?: string): Array<{ pid: number; comm: string }> {
  if (!tty) return []
  const ttyName = path.basename(tty)
  if (!ttyName) return []
  try {
    const result = spawnSync('ps', ['-t', ttyName, '-o', 'pid=,comm='], {
      encoding: 'utf8',
      timeout: 2000
    })
    if (result.status !== 0) return []
    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [pidText, ...rest] = line.split(/\s+/)
        return { pid: Number.parseInt(pidText, 10), comm: rest.join(' ') }
      })
      .filter(proc => Number.isInteger(proc.pid) && proc.pid > 1 && proc.comm)
  } catch {
    return []
  }
}

function isShellLikeProcess(comm = ''): boolean {
  const c = comm.toLowerCase()
  return c === 'zsh' ||
    c === 'bash' ||
    c === 'sh' ||
    c === 'fish' ||
    c === 'login' ||
    c === 'tmux' ||
    c === 'screen' ||
    c === 'script'
}

function hasMeaningfulTtyProcess(tty?: string): boolean {
  const processes = listTtyProcesses(tty)
  if (processes.length === 0) return false
  return processes.some(proc => !isShellLikeProcess(proc.comm))
}

function trackedPidsExist(pids: number[] = []): boolean {
  const candidates = Array.from(new Set(pids.filter(pid => Number.isInteger(pid) && pid > 1)))
  if (candidates.length === 0) return false
  try {
    const result = spawnSync('ps', ['-p', candidates.join(','), '-o', 'pid='], {
      encoding: 'utf8',
      timeout: 2000
    })
    if (result.status !== 0) return false
    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .length > 0
  } catch {
    return false
  }
}

function terminalAppExists(app: TerminalApp | undefined): boolean {
  if (!app || app === 'unknown') return false
  const target =
    app === 'terminal' ? 'Terminal' :
    app === 'vscode' ? 'Visual Studio Code' :
    app === 'cursor' ? 'Cursor' :
    app === 'windsurf' ? 'Windsurf' :
    app === 'warp' ? 'Warp' :
    ''
  if (!target) return false
  try {
    const result = spawnSync('osascript', ['-e', `tell application "System Events" to count (application processes whose name is "${target}")`], {
      encoding: 'utf8',
      timeout: 2000
    })
    return result.status === 0 && Number.parseInt(result.stdout.trim(), 10) > 0
  } catch {
    return false
  }
}

function detectTerminalApp(
  env: Record<string, string> = {},
  pidChain: Array<{ pid: number; comm: string }> = []
): TerminalApp {
  if (env.WARP_IS_LOCAL_SHELL_SESSION || env.WARP_SESSION_ID) return 'warp'
  if (env.CURSOR_TRACE_ID) return 'cursor'
  if (env.WINDSURF_EXTENSION || env.WINDSURF_EXTENSION_VERSION) return 'windsurf'
  if (env.TERM_PROGRAM === 'vscode') {
    for (const { comm } of pidChain) {
      const c = comm.toLowerCase()
      if (c === 'cursor') return 'cursor'
      if (c.includes('windsurf')) return 'windsurf'
    }
    return 'vscode'
  }
  if (env.TERM_PROGRAM === 'Apple_Terminal' || env.__CFBundleIdentifier === 'com.apple.Terminal') {
    return 'terminal'
  }

  for (const { comm } of pidChain) {
    const c = comm.toLowerCase()
    if (c.includes('warp')) return 'warp'
    if (c === 'cursor') return 'cursor'
    if (c.includes('windsurf')) return 'windsurf'
    if (c === 'code' || c === 'code helper' || c === 'code - insiders') return 'vscode'
    if (c === 'terminal') return 'terminal'
  }

  return 'unknown'
}

function trackedPidsFromChain(pidChain: Array<{ pid: number; comm: string }> = []): number[] {
  return Array.from(new Set(pidChain.map(entry => entry.pid).filter(pid => Number.isInteger(pid) && pid > 1)))
}

function trackedPidsFromMeta(pidMeta?: {
  current_pid?: number
  parent_pid?: number
  shell_pid?: number
}): number[] {
  if (!pidMeta) return []
  return Array.from(new Set(
    [pidMeta.current_pid, pidMeta.parent_pid, pidMeta.shell_pid]
      .filter(pid => Number.isInteger(pid) && (pid as number) > 1) as number[]
  ))
}

function assessSessionLiveness(session: CliSession): LivenessAssessment {
  const now = Date.now()
  const hasRecentHook = !!session.lastHookAt && now - session.lastHookAt < IDLE_FALLBACK_MS * 2
  const hasTtyProcess = ttyHasProcesses(session.tty)
  const hasMeaningfulTtyProcessValue = hasMeaningfulTtyProcess(session.tty)
  const hasTrackedPid = trackedPidsExist(session.trackedPids)
  const hasTerminalApp = terminalAppExists(session.terminalApp)

  if (hasRecentHook) {
    return {
      hasRecentHook,
      hasTtyProcess,
      hasMeaningfulTtyProcess: hasMeaningfulTtyProcessValue,
      hasTrackedPid,
      hasTerminalApp,
      confidence: 'high',
      reason: 'Recent hook activity'
    }
  }

  if (hasMeaningfulTtyProcessValue || (hasTrackedPid && hasTerminalApp)) {
    return {
      hasRecentHook,
      hasTtyProcess,
      hasMeaningfulTtyProcess: hasMeaningfulTtyProcessValue,
      hasTrackedPid,
      hasTerminalApp,
      confidence: 'medium',
      reason: hasMeaningfulTtyProcessValue
        ? 'TTY still has non-shell processes'
        : 'Tracked process still exists'
    }
  }

  return {
    hasRecentHook,
    hasTtyProcess,
    hasMeaningfulTtyProcess: hasMeaningfulTtyProcessValue,
    hasTrackedPid,
    hasTerminalApp,
    confidence: 'low',
    reason: hasTtyProcess
      ? 'Only shell remains on terminal'
      : 'No recent hook activity and weak terminal evidence'
  }
}

function interruptSession(session: CliSession, reason: string): void {
  cancelIdleFallback(session.id)
  cancelPending(session.id)
  sessionAutoAllowTools.delete(session.id)
  sessionTodos.delete(session.id)
  sessionManager.update(session.id, {
    status: 'interrupted',
    currentTool: undefined,
    currentToolInput: undefined,
    promptText: undefined,
    promptOptions: undefined,
    lastMessage: reason
  })
}

function sweepAbandonedSessions(): void {
  const now = Date.now()
  for (const session of sessionManager.getAll()) {
    if (!isLiveStatus(session.status)) continue

    const liveness = assessSessionLiveness(session)
    const hookAge = session.lastHookAt ? now - session.lastHookAt : Number.POSITIVE_INFINITY
    const noTerminalEvidence = !liveness.hasTtyProcess && !liveness.hasTrackedPid && !liveness.hasTerminalApp

    if (session.status === 'thinking') {
      if (hookAge >= THINKING_HARD_TIMEOUT_MS) {
        interruptSession(session, 'No hook activity for 180s')
        continue
      }
      if (hookAge >= THINKING_SOFT_TIMEOUT_MS && liveness.confidence === 'low') {
        interruptSession(session, 'No recent hook activity and weak terminal evidence')
        continue
      }
      continue
    }

    if (noTerminalEvidence && !liveness.hasRecentHook) {
      interruptSession(session, 'Terminal session closed')
      continue
    }

    if ((session.status === 'waitingForApproval' || session.status === 'question' || session.status === 'waitingForInput') &&
      !liveness.hasRecentHook &&
      !liveness.hasTerminalApp &&
      liveness.confidence === 'low') {
      interruptSession(session, 'Prompt abandoned after terminal closed')
    }
  }
}

export const SOCKET_PATH = '/tmp/pulse-isle.sock'

let server: Server | null = null

interface PendingApproval {
  socket: Socket
  timer: ReturnType<typeof setTimeout>
  toolName: string
}

// sessionId → pending PreToolUse socket waiting for user decision
const pendingApprovals = new Map<string, PendingApproval>()

// sessionId → set of tool names to auto-allow for this session ("Always" button)
const sessionAutoAllowTools = new Map<string, Set<string>>()

function scheduleIdleFallback(sessionId: string): void {
  cancelIdleFallback(sessionId)
  const t = setTimeout(() => {
    idleFallbackTimers.delete(sessionId)
    const session = sessionManager.get(sessionId)
    if (session && session.status === 'processing') {
      if (session.tool === 'claude') {
        sessionManager.update(sessionId, {
          status: 'thinking',
          lastMessage: !session.lastMessage || isToolCompletionMessage(session.lastMessage)
            ? 'Thinking...'
            : session.lastMessage
        })
        scheduleIdleFallback(sessionId)
        return
      }
      sessionManager.update(sessionId, {
        status: 'turnDone',
        lastMessage: session.lastMessage || 'Turn completed'
      })
    }
  }, IDLE_FALLBACK_MS)
  idleFallbackTimers.set(sessionId, t)
}

function cancelIdleFallback(sessionId: string): void {
  const t = idleFallbackTimers.get(sessionId)
  if (t) { clearTimeout(t); idleFallbackTimers.delete(sessionId) }
}

export function startHookSocketServer(): void {
  try { fs.unlinkSync(SOCKET_PATH) } catch { /* ok if not exists */ }

  server = createServer((socket) => {
    let buf = ''

    socket.on('data', (chunk) => { buf += chunk.toString() })

    // `end` fires when hook script calls shutdown(SHUT_WR) — done writing
    socket.on('end', () => {
      if (!buf.trim()) { socket.destroy(); return }
      try {
        handlePayload(JSON.parse(buf), socket)
      } catch {
        socket.end()
      }
    })

    socket.on('error', () => socket.destroy())
  })

  server.listen(SOCKET_PATH, () => {
    try { fs.chmodSync(SOCKET_PATH, 0o600) } catch { /* ok */ }
    console.log('[HookSocketServer] Listening on', SOCKET_PATH)
  })

  server.on('error', (err) => console.error('[HookSocketServer]', err))

  if (!sessionSweepTimer) {
    sessionSweepTimer = setInterval(sweepAbandonedSessions, SESSION_SWEEP_MS)
  }

  // Wire session:respond (from island UI clicks) to resolve pending approvals
  sessionManager.on('session:respond', ({ id, value }: { id: string; value: string }) => {
    resolveApproval(id, value)
  })
}

function handlePayload(payload: any, socket: Socket): void {
  const { session_id, hook_event_name, cwd = '', tool_name, tool_input } = payload
  if (!session_id) { respond(socket, {}); return }

  const source: 'claude' | 'codex' = payload._source === 'codex' ? 'codex' : 'claude'
  ensureSession(session_id, source, cwd, payload._tty, payload._env, payload._pid_chain, payload._pid_meta)
  sessionManager.markHookActivity(session_id)

  switch (hook_event_name) {
    case 'SessionStart':
      clearStalePendingApproval(session_id)
      sessionManager.update(session_id, { status: 'ready' })
      respond(socket, {})
      break

    case 'UserPromptSubmit': {
      clearStalePendingApproval(session_id)
      const prompt: unknown = payload.prompt ?? payload.message ?? ''
      const name = typeof prompt === 'string' && prompt.trim()
        ? prompt.trim().slice(0, 80)
        : undefined
      sessionManager.update(session_id, {
        status: 'processing',
        currentTool: undefined,
        currentToolInput: undefined,
        lastMessage: '',
        ...(name ? { name } : {})
      })
      scheduleIdleFallback(session_id)
      respond(socket, {})
      break
    }

    case 'PreToolUse': {
      cancelIdleFallback(session_id)
      const isQuestion = tool_name === 'AskUserQuestion'
      const isPlanApproval = tool_name === 'ExitPlanMode'
      const isImplicitTool = tool_name === 'Agent'

      if (isQuestion) {
        sessionManager.update(session_id, {
          status: 'question',
          currentTool: tool_name,
          currentToolInput: tool_input,
          promptText: tool_input?.question,
          promptOptions: Array.isArray(tool_input?.options) && tool_input.options.length > 0
            ? tool_input.options
            : undefined,
          lastMessage: `Q: ${(tool_input?.question || '').slice(0, 60)}`
        })
        respond(socket, {})
        break
      }

      if (isPlanApproval) {
        const promptOptions = Array.isArray(tool_input?.options) && tool_input.options.length > 0
          ? tool_input.options
          : ['Yes, auto-accept edits', 'Yes, manually approve edits', 'Tell Claude what to change']
        // ExitPlanMode: hold socket open, show approval UI for the plan
        cancelPending(session_id)
        sessionManager.update(session_id, {
          status: 'waitingForApproval',
          currentTool: 'ExitPlanMode',
          currentToolInput: tool_input,
          promptText: tool_input?.plan_summary ?? 'Plan ready for review',
          promptOptions,
          lastMessage: 'Plan needs approval'
        })
        const planTimer = setTimeout(() => {
          if (pendingApprovals.has(session_id)) {
            pendingApprovals.delete(session_id)
            sessionManager.update(session_id, { status: 'processing', promptText: undefined, promptOptions: undefined })
            respond(socket, {})
          }
        }, 60_000)
        pendingApprovals.set(session_id, { socket, timer: planTimer, toolName: 'ExitPlanMode' })
        logApproval('Registered plan approval', { sessionId: session_id })
        break
      }

      if (isImplicitTool) {
        sessionManager.update(session_id, {
          status: 'runningTool',
          currentTool: tool_name,
          currentToolInput: tool_input,
          promptText: undefined,
          promptOptions: undefined,
          lastMessage: `${tool_name} starting`
        })
        respond(socket, {})
        break
      }

      // Codex already has its own permission model outside the island UI.
      // Mirroring tool approvals here creates duplicate/stale prompts, so we
      // surface the tool as running instead of blocking on a second approval.
      if (source === 'codex') {
        sessionManager.update(session_id, {
          status: 'runningTool',
          currentTool: tool_name,
          currentToolInput: tool_input,
          promptText: undefined,
          promptOptions: undefined,
          lastMessage: `${tool_name} starting`
        })
        respond(socket, {})
        break
      }

      // Check if this tool was "Always Allow"-ed for this session
      if (sessionAutoAllowTools.get(session_id)?.has(tool_name)) {
        sessionManager.update(session_id, {
          status: 'runningTool',
          currentTool: tool_name,
          currentToolInput: tool_input,
          promptText: undefined,
          promptOptions: undefined
        })
        respond(socket, { hookSpecificOutput: { decision: { behavior: 'allow', reason: 'Auto-allowed' } } }, 'autoAllowCached')
        break
      }

      // Show approval UI — hold socket open
      cancelPending(session_id)
      sessionManager.update(session_id, {
        status: 'waitingForApproval',
        currentTool: tool_name,
        currentToolInput: tool_input,
        promptText: toolDescription(tool_name, tool_input),
        promptOptions: ['Deny', 'Allow Once', 'Always Allow'],
        lastMessage: `Approve: ${tool_name}`
      })

      const timer = setTimeout(() => {
        if (pendingApprovals.has(session_id)) {
          pendingApprovals.delete(session_id)
          sessionManager.update(session_id, {
            status: 'runningTool',
            promptText: undefined,
            promptOptions: undefined
          })
          respond(socket, {
            hookSpecificOutput: { decision: { behavior: 'allow', reason: 'Auto-allowed (timeout)' } }
          }, 'autoAllowTimeout')
        }
      }, 60_000)

      pendingApprovals.set(session_id, { socket, timer, toolName: tool_name })
      logApproval('Registered tool approval', { sessionId: session_id, toolName: tool_name })
      // Keep socket open — respond() called in resolveApproval
      break
    }

    case 'PostToolUse': {
      clearStalePendingApproval(session_id)
      const updates: any = {
        status: 'processing',
        currentTool: undefined,
        currentToolInput: undefined,
        promptText: undefined,
        promptOptions: undefined,
        lastMessage: `${tool_name} completed`
      }
      // Extract task list from TaskCreate / TaskUpdate / TaskList results
      if (tool_name?.startsWith('Task') && payload.tool_response?.output) {
        const todos = parseTaskToolResponse(session_id, tool_name, tool_input, payload.tool_response.output)
        if (todos) {
          updates.todos = todos
          if (todos.length > 0 && todos.every(t => t.status === 'completed')) {
            sessionManager.emit('session:todos-complete', { id: session_id })
          }
        }
      }
      sessionManager.update(session_id, updates)
      scheduleIdleFallback(session_id)
      respond(socket, {})
      break
    }

    case 'Stop':
    case 'SubagentStop': {
      clearStalePendingApproval(session_id)
      cancelIdleFallback(session_id)
      // Clean up always-allow rules and todos when session ends
      if (hook_event_name === 'Stop') {
        sessionAutoAllowTools.delete(session_id)
        sessionTodos.delete(session_id)
      }
      sessionManager.update(session_id, {
        status: 'ended',
        currentTool: undefined,
        currentToolInput: undefined,
        promptText: undefined,
        promptOptions: undefined,
        lastMessage: payload.stop_reason || 'Turn completed'
      })
      const endedSession = sessionManager.get(session_id)
      if (endedSession?.todos?.length && endedSession.todos.every(t => t.status === 'completed')) {
        sessionManager.emit('session:todos-complete', { id: session_id })
      }
      respond(socket, {})
      break
    }

    default:
      respond(socket, {})
  }
}

function toolDescription(toolName: string, toolInput: any): string {
  if (!toolInput) return toolName
  if (toolName === 'Bash') return toolInput.command?.slice(0, 120) ?? toolName
  if (toolName === 'Edit' || toolName === 'Write') return toolInput.file_path ?? toolName
  if (toolName === 'Read') return toolInput.file_path ?? toolName
  return JSON.stringify(toolInput).slice(0, 100)
}

/**
 * Parse TaskCreate / TaskUpdate / TaskList tool responses to maintain the
 * session-level todo list. Returns the updated TodoItem[] or null if unchanged.
 */
function parseTaskToolResponse(
  sessionId: string,
  toolName: string,
  toolInput: any,
  toolResponse: any
): TodoItem[] | null {
  if (!sessionTodos.has(sessionId)) sessionTodos.set(sessionId, new Map())
  const map = sessionTodos.get(sessionId)!

  // TaskList returns the full current list — use it as the source of truth
  if (toolName === 'TaskList') {
    const items: any[] = extractTaskArray(toolResponse)
    map.clear()
    for (const item of items) applyTaskItem(map, item)
    return Array.from(map.values())
  }

  // TaskCreate — a new task was created; the response contains the created task
  if (toolName === 'TaskCreate') {
    const item = extractSingleTask(toolResponse) ?? toolInput
    if (item?.id) { applyTaskItem(map, item); return Array.from(map.values()) }
  }

  // TaskUpdate — existing task was mutated
  if (toolName === 'TaskUpdate') {
    const taskId = toolInput?.taskId
    if (taskId && map.has(taskId)) {
      const existing = map.get(taskId)!
      const updated = extractSingleTask(toolResponse)
      if (updated) {
        map.set(taskId, { ...existing, ...toTodoItem(updated) })
      } else {
        // Patch from input fields (status, subject, etc.)
        if (toolInput.status) existing.status = mapStatus(toolInput.status)
        if (toolInput.subject) existing.content = toolInput.subject
        if (toolInput.activeForm) existing.activeForm = toolInput.activeForm
      }
      return Array.from(map.values())
    }
  }

  return null
}

function applyTaskItem(map: Map<string, TodoItem>, raw: any): void {
  const item = toTodoItem(raw)
  if (item.id) map.set(item.id, item)
}

function toTodoItem(raw: any): TodoItem {
  return {
    id: String(raw.id ?? raw.taskId ?? ''),
    content: raw.subject ?? raw.content ?? '',
    status: mapStatus(raw.status),
    priority: (raw.priority as any) ?? 'medium',
    activeForm: raw.activeForm,
    owner: raw.owner,
    blockedBy: raw.blockedBy ?? raw.addBlockedBy
  }
}

function mapStatus(s: string): 'pending' | 'in_progress' | 'completed' {
  if (s === 'in_progress') return 'in_progress'
  if (s === 'completed') return 'completed'
  return 'pending'
}

function extractTaskArray(response: any): any[] {
  if (Array.isArray(response)) return response
  // Response is often a string like "[{...}, ...]" or wrapped in an object
  if (typeof response === 'string') {
    try { return JSON.parse(response) } catch { /* fall through */ }
    // Try to find a JSON array within the string
    const m = response.match(/\[[\s\S]*\]/)
    if (m) { try { return JSON.parse(m[0]) } catch { /* ignore */ } }
  }
  if (response && typeof response === 'object') {
    if (Array.isArray(response.tasks)) return response.tasks
    if (Array.isArray(response.items)) return response.items
  }
  return []
}

function extractSingleTask(response: any): any | null {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    if (response.id || response.taskId) return response
  }
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response)
      if (parsed?.id || parsed?.taskId) return parsed
    } catch { /* ignore */ }
  }
  return null
}

function ensureSession(
  id: string,
  tool: 'claude' | 'codex',
  cwd: string,
  tty?: string,
  terminalEnv?: Record<string, string>,
  pidChain?: Array<{ pid: number; comm: string }>,
  pidMeta?: {
    current_pid?: number
    parent_pid?: number
    shell_pid?: number
    shell_comm?: string
  }
): void {
  const trackedPids = Array.from(new Set([
    ...trackedPidsFromChain(pidChain),
    ...trackedPidsFromMeta(pidMeta)
  ]))
  const terminalApp = detectTerminalApp(terminalEnv, pidChain)
  const existing = sessionManager.get(id)
  if (existing) {
    // Backfill terminal metadata if not yet captured
    const updates: Partial<CliSession> = {}
    if (!existing.tty && tty) updates.tty = tty
    if (!existing.terminalEnv && terminalEnv) updates.terminalEnv = terminalEnv
    if (!existing.pidChain && pidChain) updates.pidChain = pidChain
    if (!existing.pidMeta && pidMeta) {
      updates.pidMeta = {
        currentPid: pidMeta.current_pid,
        parentPid: pidMeta.parent_pid,
        shellPid: pidMeta.shell_pid,
        shellComm: pidMeta.shell_comm
      }
    }
    if ((!existing.trackedPids || existing.trackedPids.length === 0) && trackedPids.length > 0) {
      updates.trackedPids = trackedPids
    }
    if ((!existing.terminalApp || existing.terminalApp === 'unknown') && terminalApp !== 'unknown') {
      updates.terminalApp = terminalApp
    }
    if (Object.keys(updates).length > 0) {
      sessionManager.update(id, updates)
    }
    return
  }
  sessionManager.create({
    id,
    tool,
    title: cwd ? path.basename(cwd) : 'Session',
    status: 'ready',
    lastMessage: '',
    cwd,
    tty,
    terminalEnv,
    pidChain,
    pidMeta: pidMeta ? {
      currentPid: pidMeta.current_pid,
      parentPid: pidMeta.parent_pid,
      shellPid: pidMeta.shell_pid,
      shellComm: pidMeta.shell_comm
    } : undefined,
    trackedPids,
    terminalApp
  })
}

function respond(socket: Socket, data: object, context?: string): void {
  try {
    if (context) {
      console.log('[HookSocketServer] respond:start', { context, data })
    }
    socket.write(JSON.stringify(data))
    socket.end()
    if (context) {
      console.log('[HookSocketServer] respond:done', { context })
    }
  } catch { socket.destroy() }
}

function cancelPending(sessionId: string): void {
  const pending = pendingApprovals.get(sessionId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingApprovals.delete(sessionId)
  logApproval('Canceled pending approval', { sessionId, toolName: pending.toolName })
}

function clearStalePendingApproval(sessionId: string): void {
  const pending = pendingApprovals.get(sessionId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingApprovals.delete(sessionId)
  logApproval('Cleared stale pending approval', { sessionId, toolName: pending.toolName })
  respond(pending.socket, {}, 'clearStalePendingApproval')
}

function resolveApproval(sessionId: string, value: string): void {
  const pending = pendingApprovals.get(sessionId)
  if (!pending) {
    logApproval('Respond ignored because no pending approval exists', { sessionId, value })
    return
  }
  clearTimeout(pending.timer)
  pendingApprovals.delete(sessionId)

  const deny = value === 'Deny' || value === 'Reject'

  if (value === 'Always Allow') {
    if (!sessionAutoAllowTools.has(sessionId)) sessionAutoAllowTools.set(sessionId, new Set())
    sessionAutoAllowTools.get(sessionId)!.add(pending.toolName)
  }

  logApproval('Resolving approval', {
    sessionId,
    value,
    toolName: pending.toolName,
    deny
  })

  sessionManager.update(sessionId, {
    status: deny ? 'processing' : 'runningTool',
    promptText: undefined,
    promptOptions: undefined
  })

  respond(pending.socket, {
    hookSpecificOutput: {
      decision: {
        behavior: deny ? 'reject' : 'allow',
        reason: deny ? 'Rejected by user' : 'Approved by user'
      }
    }
  }, 'resolveApproval')
}

export function stopHookSocketServer(): void {
  // Auto-allow all pending so Claude Code / Codex don't hang on app quit
  for (const [, { socket, timer }] of pendingApprovals) {
    clearTimeout(timer)
    respond(socket, {
      hookSpecificOutput: { decision: { behavior: 'allow', reason: 'App shutting down' } }
    }, 'stopHookSocketServer')
  }
  pendingApprovals.clear()
  sessionAutoAllowTools.clear()
  sessionTodos.clear()
  for (const t of idleFallbackTimers.values()) clearTimeout(t)
  idleFallbackTimers.clear()
  if (sessionSweepTimer) {
    clearInterval(sessionSweepTimer)
    sessionSweepTimer = null
  }
  server?.close()
  try { fs.unlinkSync(SOCKET_PATH) } catch { /* ok */ }
}
