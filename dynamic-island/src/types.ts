export type SessionStatus =
  | 'ready'              // initial / after Stop
  | 'turnDone'           // latest streamed turn finished; session remains open
  | 'processing'         // Claude active between tool calls
  | 'thinking'           // extended thinking (reserved)
  | 'runningTool'        // tool executing
  | 'waitingForApproval' // PreToolUse waiting for user
  | 'waitingForInput'    // waiting for user input in terminal
  | 'question'           // AskUserQuestion pending
  | 'compacting'         // context compaction
  | 'compactComplete'    // compaction done
  | 'ended'              // completed successfully
  | 'interrupted'        // ended unexpectedly
  | 'mayNeedAttention'   // reserved

export type CliTool = 'claude' | 'codex'
export type NotchState = 'capsule' | 'cards'
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  activeForm?: string
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
}

// Server → Island
export type ServerMessage =
  | { type: 'sessions:sync'; sessions: CliSession[] }
  | {
      type: 'session:update'
      sessionId: string
      status: SessionStatus
      title?: string
      name?: string
      lastMessage?: string
      tool?: CliTool
      cwd?: string
      currentTool?: string
      currentToolInput?: Record<string, any>
      subAgentCount?: number
      promptText?: string
      promptOptions?: string[]
      todos?: TodoItem[]
    }
  | { type: 'session:delete'; sessionId: string }
  | { type: 'notification'; sessionId: string; level: 'success' | 'error' | 'info'; text: string }
  | { type: 'session:name'; sessionId: string; name: string }

// Island → Server
export type ClientMessage =
  | { type: 'session:respond'; sessionId: string; value: string }
  | { type: 'session:dismiss'; sessionId: string }
  | { type: 'session:focus-terminal'; sessionId: string }
  | { type: 'sessions:fetch' }

export interface IslandAPI {
  onStateChange: (callback: (state: string) => void) => () => void
  notifyMouseEnter: () => void
  notifyMouseLeave: () => void
  setExpandedHeight: (height: number) => void
  onWsMessage: (callback: (data: any) => void) => () => void
  wsSend: (message: any) => void
  onConnectionStatus: (callback: (connected: boolean) => void) => () => void
  requestSync: () => void
}

declare global {
  interface Window { island: IslandAPI }
}
