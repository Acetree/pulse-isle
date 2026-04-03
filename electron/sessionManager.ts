import { EventEmitter } from 'events'

export type SessionStatus =
  | 'ready'              // initial / after Stop with no pending work
  | 'turnDone'           // latest streamed turn finished; session remains open
  | 'processing'         // Claude active between tool calls
  | 'thinking'           // extended thinking (reserved for future use)
  | 'runningTool'        // tool is executing
  | 'waitingForApproval' // PreToolUse waiting for user decision
  | 'waitingForInput'    // waiting for user input in terminal
  | 'question'           // AskUserQuestion pending
  | 'compacting'         // context window compaction in progress
  | 'compactComplete'    // compaction just completed
  | 'ended'              // session/turn completed successfully
  | 'interrupted'        // session ended unexpectedly
  | 'mayNeedAttention'   // reserved for future use

export type CliTool = 'claude' | 'codex'
export type TerminalApp = 'terminal' | 'vscode' | 'cursor' | 'windsurf' | 'warp' | 'unknown'
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  activeForm?: string   // text shown while in_progress (e.g. "Fixing auth bug...")
  owner?: string
  blockedBy?: string[]
}

export interface CliSession {
  id: string
  tool: CliTool
  title: string
  name?: string
  status: SessionStatus
  lastMessage: string
  cwd: string
  startedAt: number
  pid?: number
  promptText?: string
  promptOptions?: string[]
  currentTool?: string
  currentToolInput?: Record<string, any>
  subAgentCount?: number
  todos?: TodoItem[]
  // Terminal focus metadata (populated from hook script env)
  tty?: string
  terminalEnv?: Record<string, string>
  pidChain?: Array<{ pid: number; comm: string }>
  pidMeta?: {
    currentPid?: number
    parentPid?: number
    shellPid?: number
    shellComm?: string
  }
  trackedPids?: number[]
  terminalApp?: TerminalApp
  // Lifecycle metadata for timeout- and liveness-based cleanup
  lastHookAt?: number
  lastStateChangeAt?: number
  lastLivenessEvidenceAt?: number
  thinkingSince?: number
  hookCount?: number
}

type SessionCreateData = Omit<
  CliSession,
  'startedAt' | 'lastHookAt' | 'lastStateChangeAt' | 'lastLivenessEvidenceAt' | 'thinkingSince' | 'hookCount'
>

class SessionManager extends EventEmitter {
  private sessions = new Map<string, CliSession>()

  getAll(): CliSession[] {
    return Array.from(this.sessions.values())
  }

  get(id: string): CliSession | undefined {
    return this.sessions.get(id)
  }

  create(data: SessionCreateData): CliSession {
    const now = Date.now()
    const session: CliSession = {
      ...data,
      startedAt: now,
      lastStateChangeAt: now,
      lastLivenessEvidenceAt: now
    }
    this.sessions.set(session.id, session)
    this.emit('session:created', session)
    return session
  }

  update(id: string, updates: Partial<CliSession>): CliSession | null {
    const session = this.sessions.get(id)
    if (!session) return null
    const nextStatus = updates.status
    if (nextStatus && nextStatus !== session.status) {
      updates.lastStateChangeAt ??= Date.now()
    }
    if (nextStatus === 'thinking' && session.status !== 'thinking') {
      updates.thinkingSince ??= Date.now()
    } else if (nextStatus && nextStatus !== 'thinking') {
      updates.thinkingSince = undefined
    }
    Object.assign(session, updates)
    this.emit('session:updated', session)
    return session
  }

  markHookActivity(id: string, at = Date.now()): CliSession | null {
    const session = this.sessions.get(id)
    if (!session) return null
    session.lastHookAt = at
    session.lastLivenessEvidenceAt = at
    session.hookCount = (session.hookCount ?? 0) + 1
    this.emit('session:updated', session)
    return session
  }

  delete(id: string): void {
    if (this.sessions.has(id)) {
      this.sessions.delete(id)
      this.emit('session:deleted', id)
    }
  }

  respond(id: string, value: string): void {
    this.emit('session:respond', { id, value })
  }
}

export const sessionManager = new SessionManager()
