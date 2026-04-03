import { useState, useEffect, useCallback } from 'react'
import { Activity, Power, Settings, Terminal, Download, Check, AlertCircle } from 'lucide-react'

declare global {
  interface Window {
    vibeIsland: {
      getAllSessions: () => Promise<any[]>
      dismissSession: (id: string) => Promise<void>
      onSessionsChanged: (cb: (sessions: any[]) => void) => () => void
      islandToggle: (enabled: boolean) => Promise<void>
      islandGetStatus: () => Promise<boolean>
      onIslandStatusChanged: (cb: (running: boolean) => void) => () => void
      hookInstall: () => Promise<{ hookScriptPath: string; claudeInjected: boolean; codexInjected: boolean; codexFlagEnabled: boolean }>
      hookCheck: () => Promise<{ installed: boolean; claudeHooked: boolean; codexHooked: boolean }>
      hookUninstall: () => Promise<{ claudeRemoved: boolean; codexRemoved: boolean }>
      openExternal: (url: string) => Promise<void>
    }
  }
}

type SessionStatus =
  | 'ready'
  | 'turnDone'
  | 'processing'
  | 'thinking'
  | 'runningTool'
  | 'waitingForApproval'
  | 'waitingForInput'
  | 'question'
  | 'compacting'
  | 'compactComplete'
  | 'ended'
  | 'interrupted'
  | 'mayNeedAttention'

interface CliSession {
  id: string
  tool: 'claude' | 'codex'
  title: string
  status: SessionStatus
  lastMessage: string
  cwd: string
  startedAt: number
  pid?: number
  promptText?: string
  promptOptions?: string[]
  isInteractiveMenu?: boolean
}

function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'ready': return '#555'
    case 'turnDone': return '#4ade80'
    case 'processing': return '#60a5fa'
    case 'thinking': return '#a78bfa'
    case 'runningTool': return '#60a5fa'
    case 'waitingForApproval': return '#f59e0b'
    case 'waitingForInput': return '#f59e0b'
    case 'question': return '#fb923c'
    case 'compacting': return '#666'
    case 'compactComplete': return '#666'
    case 'ended': return '#4ade80'
    case 'interrupted': return '#f87171'
    case 'mayNeedAttention': return '#fb923c'
  }
}

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'ready': return 'Ready'
    case 'turnDone': return 'Turn Done'
    case 'processing': return 'Processing'
    case 'thinking': return 'Thinking'
    case 'runningTool': return 'Running Tool'
    case 'waitingForApproval': return 'Needs Approval'
    case 'waitingForInput': return 'Needs Input'
    case 'question': return 'Waiting for Answer'
    case 'compacting': return 'Compacting'
    case 'compactComplete': return 'Compacted'
    case 'ended': return 'Completed'
    case 'interrupted': return 'Interrupted'
    case 'mayNeedAttention': return 'Needs Attention'
  }
}

function isWaitingStatus(status: SessionStatus): boolean {
  return status === 'waitingForApproval' || status === 'waitingForInput' || status === 'question'
}

function isDoneStatus(status: SessionStatus): boolean {
  return status === 'turnDone' || status === 'ended' || status === 'interrupted'
}

function isActiveStatus(status: SessionStatus): boolean {
  return !isDoneStatus(status)
}

function shortPath(p: string): string {
  return p.replace(new RegExp('^' + (window as any).__home || '/Users/'), '~/')
}

function timeSince(ts: number): string {
  const d = Date.now() - ts
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

function SessionCard({ session, onDismiss }: { session: CliSession; onDismiss: (id: string) => void }) {
  const isIdle = session.status === 'ready'
  const isActive = session.status === 'processing' || session.status === 'runningTool' || session.status === 'thinking'
  const isWaiting = isWaitingStatus(session.status)
  const isDone = isDoneStatus(session.status)
  const isTurnDone = session.status === 'turnDone'
  const isCompleted = session.status === 'ended'

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{
        background: isWaiting
          ? 'rgba(245, 158, 11, 0.08)'
          : isTurnDone
          ? 'rgba(74, 222, 128, 0.09)'
          : isCompleted
          ? 'rgba(74, 222, 128, 0.05)'
          : isDone
          ? 'rgba(248, 113, 113, 0.06)'
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isWaiting
          ? 'rgba(245,158,11,0.25)'
          : isTurnDone
          ? 'rgba(74,222,128,0.28)'
          : isCompleted
          ? 'rgba(74,222,128,0.16)'
          : isDone
          ? 'rgba(248,113,113,0.2)'
          : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Tool badge */}
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide"
            style={{
              background: session.tool === 'claude' ? 'rgba(255,138,76,0.15)' : 'rgba(96,165,250,0.15)',
              color: session.tool === 'claude' ? '#ff8a4c' : '#60a5fa'
            }}
          >
            {session.tool}
          </span>

          {/* Status dot */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: statusColor(session.status),
                boxShadow: isActive ? `0 0 5px ${statusColor(session.status)}80` : 'none',
                animation: isActive ? 'pulse 2s infinite' : 'none'
              }}
            />
            <span className="text-[11px]" style={{ color: statusColor(session.status) }}>
              {statusLabel(session.status)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30">{timeSince(session.startedAt)}</span>
          {isDone && (
            <button
              onClick={() => onDismiss(session.id)}
              className="text-[10px] text-white/30 hover:text-white/60 transition-colors cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-[13px] font-medium text-white/90 truncate">{session.title}</div>

      {/* CWD */}
      <div className="text-[11px] text-white/30 font-mono truncate">{shortPath(session.cwd)}</div>

      {/* Last message */}
      {session.lastMessage && (
        <div
          className="text-[11px] text-white/50 truncate"
          style={{ maxWidth: '100%' }}
        >
          {session.lastMessage}
        </div>
      )}

      {/* Prompt indicator */}
      {isWaiting && session.promptText && (
        <div
          className="text-[11px] px-2 py-1.5 rounded-lg"
          style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', borderLeft: '2px solid #f59e0b' }}
        >
          {session.promptText}
        </div>
      )}
    </div>
  )
}

export function App() {
  const [sessions, setSessions] = useState<CliSession[]>([])
  const [islandRunning, setIslandRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [hooksInstalled, setHooksInstalled] = useState(false)
  const [hookStatus, setHookStatus] = useState({ claudeHooked: false, codexHooked: false })
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
  const [installSuccess, setInstallSuccess] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  useEffect(() => {
    const api = window.vibeIsland
    if (!api) return // Not in Electron context

    // Load initial state
    api.getAllSessions().then(setSessions)
    api.islandGetStatus().then(setIslandRunning)
    api.hookCheck().then(({ installed, claudeHooked, codexHooked }) => {
      setHooksInstalled(installed)
      setHookStatus({ claudeHooked, codexHooked })
    })

    // Subscribe to changes
    const cleanSessions = api.onSessionsChanged(setSessions)
    const cleanIsland = api.onIslandStatusChanged(setIslandRunning)

    return () => { cleanSessions(); cleanIsland() }
  }, [])

  const handleIslandToggle = async () => {
    const next = !islandRunning
    setIslandRunning(next)
    await window.vibeIsland.islandToggle(next)
  }

  const handleInstall = useCallback(async () => {
    setInstalling(true)
    setInstallError('')
    setInstallSuccess(false)
    try {
      const { claudeInjected, codexInjected } = await window.vibeIsland.hookInstall()
      setHooksInstalled(claudeInjected || codexInjected)
      setHookStatus({ claudeHooked: claudeInjected, codexHooked: codexInjected })
      setInstallSuccess(true)
    } catch (e: any) {
      setInstallError(e.message || 'Installation failed')
    } finally {
      setInstalling(false)
    }
  }, [])

  const handleUninstall = useCallback(async () => {
    setUninstalling(true)
    try {
      await window.vibeIsland.hookUninstall()
      setHooksInstalled(false)
      setHookStatus({ claudeHooked: false, codexHooked: false })
      setInstallSuccess(false)
    } catch { /* ignore */ }
    finally { setUninstalling(false) }
  }, [])

  const activeSessions = sessions.filter(s => isActiveStatus(s.status))
  const doneSessions = sessions.filter(s => isDoneStatus(s.status))

  return (
    <div className="h-full flex flex-col" style={{ background: '#0f0f0f' }}>
      {/* Title bar drag region */}
      <div className="h-11 flex items-center px-4 gap-3 shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
        <div style={{ width: 56 }} />
        <div className="flex items-center gap-2 flex-1">
          <Activity size={14} color="#60a5fa" />
          <span className="text-[13px] font-semibold text-white/80">Pulse Isle</span>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Island status */}
          <button
            onClick={handleIslandToggle}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
            style={{
              background: islandRunning ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${islandRunning ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`,
              color: islandRunning ? '#4ade80' : '#666'
            }}
            title={islandRunning ? 'Click to disable Dynamic Island' : 'Click to enable Dynamic Island'}
          >
            <Power size={11} />
            <span className="text-[11px] font-medium">{islandRunning ? 'Island On' : 'Island Off'}</span>
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/5"
            style={{ color: showSettings ? '#60a5fa' : '#666' }}
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mx-4 mb-3 rounded-xl p-4 flex flex-col gap-3 shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <Terminal size={13} color="#60a5fa" />
            <span className="text-[13px] font-semibold text-white/80">Hook Setup</span>
          </div>

          <p className="text-[11px] text-white/40 leading-relaxed">
            Inject hooks into <code className="text-[#ff8a4c]">claude</code> and{' '}
            <code className="text-[#60a5fa]">codex</code> so Pulse Isle can track sessions and intercept tool calls.
            Hooks are auto-installed on launch unless you remove them. No PATH changes needed.
          </p>

          {hooksInstalled ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  {hookStatus.claudeHooked && (
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: '#4ade80' }}>
                      <Check size={12} />
                      <span>Claude Code hooks active</span>
                    </div>
                  )}
                  {hookStatus.codexHooked && (
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: '#4ade80' }}>
                      <Check size={12} />
                      <span>Codex hooks active</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleUninstall}
                  disabled={uninstalling}
                  className="px-2 py-1 rounded text-[10px] cursor-pointer transition-all disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
                >
                  {uninstalling ? 'Removing...' : 'Remove Hooks'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleInstall}
                disabled={installing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-all disabled:opacity-50"
                style={{ background: '#2563eb', color: '#fff' }}
              >
                {installing ? (
                  <><span className="animate-spin">⟳</span> Installing...</>
                ) : (
                  <><Download size={12} /> Install or Repair Hooks</>
                )}
              </button>
              {installError && (
                <div className="flex items-start gap-1.5 text-[11px]" style={{ color: '#f87171' }}>
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  <span>{installError}</span>
                </div>
              )}
              {installSuccess && (
                <div className="flex flex-col gap-1 text-[11px]" style={{ color: '#4ade80' }}>
                  {hookStatus.claudeHooked && <span>✓ Claude Code hooks injected</span>}
                  {hookStatus.codexHooked && <span>✓ Codex hooks injected</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Session content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {sessions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <Terminal size={32} color="#333" />
            <div>
              <p className="text-[13px] text-white/30 font-medium">No active sessions</p>
              <p className="text-[11px] text-white/20 mt-1">
                Run <code className="text-white/40">claude</code> or <code className="text-white/40">codex</code> in your terminal
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Active sessions */}
            {activeSessions.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-white/25 uppercase tracking-widest font-medium">Active</span>
                  <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <span className="text-[10px] text-white/25">{activeSessions.length}</span>
                </div>
                {activeSessions.map(s => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onDismiss={id => window.vibeIsland.dismissSession(id)}
                  />
                ))}
              </>
            )}

            {/* Done sessions */}
            {doneSessions.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-white/25 uppercase tracking-widest font-medium">Recent</span>
                  <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <span className="text-[10px] text-white/25">{doneSessions.length}</span>
                </div>
                {doneSessions.map(s => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onDismiss={id => window.vibeIsland.dismissSession(id)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
