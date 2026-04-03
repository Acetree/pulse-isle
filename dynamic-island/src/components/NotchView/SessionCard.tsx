import { motion } from 'motion/react'
import { Check, X, Loader2, AlertCircle, Minus, Shield, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import type { CliSession, SessionStatus, TodoItem } from '@/types'

interface SessionCardProps {
  session: CliSession
  index: number
  onRespond: (sessionId: string, value: string) => void
  onDismiss: (sessionId: string) => void
  onFocusTerminal: (sessionId: string) => void
  onCardClick: (sessionId: string) => void
}

// ── Status helpers ──────────────────────────────────────────────────────────

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'ready':              return 'Ready'
    case 'turnDone':           return 'Turn done'
    case 'processing':         return 'Processing'
    case 'thinking':           return 'Thinking'
    case 'runningTool':        return 'Running tool'
    case 'waitingForApproval': return 'Needs approval'
    case 'waitingForInput':    return 'Waiting for input'
    case 'question':           return 'Waiting for answer'
    case 'compacting':         return 'Compacting context...'
    case 'compactComplete':    return 'Conversation compacted'
    case 'ended':              return 'Completed'
    case 'interrupted':        return 'Interrupted'
    case 'mayNeedAttention':   return 'May need attention'
  }
}

function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'ready':              return '#555'
    case 'turnDone':           return '#4ade80'
    case 'processing':         return '#60a5fa'
    case 'thinking':           return '#a78bfa'
    case 'runningTool':        return '#60a5fa'
    case 'waitingForApproval': return '#f59e0b'
    case 'waitingForInput':    return '#f59e0b'
    case 'question':           return '#fb923c'
    case 'compacting':         return '#666'
    case 'compactComplete':    return '#666'
    case 'ended':              return '#4ade80'
    case 'interrupted':        return '#f87171'
    case 'mayNeedAttention':   return '#fb923c'
  }
}

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/^\/Users\/[^/]+/, '~').split('/')
  return parts.slice(-2).join('/')
}

// ── Tool-specific content views ─────────────────────────────────────────────

function BashView({ command }: { command: string }) {
  const lines = command.trim().split('\n')
  const preview = lines.slice(0, 3).join('\n')
  const extra = lines.length - 3
  return (
    <div className="rounded-md px-2 py-1.5 font-mono"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <pre className="text-[9px] text-white/70 leading-[1.5] whitespace-pre-wrap break-all m-0"
        style={{ maxHeight: 48, overflow: 'hidden', overflowWrap: 'anywhere' }}>
        <span style={{ color: '#4ade80' }}>$ </span>{preview}
      </pre>
      {extra > 0 && (
        <span className="text-[8px] text-white/30">+{extra} line{extra > 1 ? 's' : ''}</span>
      )}
    </div>
  )
}

function EditView({ filePath, oldStr, newStr }: { filePath: string; oldStr?: string; newStr?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[9px] text-white/40 font-mono truncate">{filePath}</div>
      {oldStr && (
        <div className="rounded px-1.5 py-1 font-mono text-[9px] leading-tight"
          style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171',
                   maxHeight: 28, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
          − {oldStr.trim().slice(0, 80)}
        </div>
      )}
      {newStr && (
        <div className="rounded px-1.5 py-1 font-mono text-[9px] leading-tight"
          style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                   maxHeight: 28, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
          + {newStr.trim().slice(0, 80)}
        </div>
      )}
    </div>
  )
}

function ReadView({ filePath }: { filePath: string }) {
  return (
    <div className="text-[9px] text-white/40 font-mono truncate flex items-center gap-1">
      <span style={{ color: '#60a5fa' }}>📄</span> {filePath}
    </div>
  )
}

function ToolBodyView({ toolName, toolInput }: { toolName: string; toolInput?: Record<string, any> }) {
  if (!toolInput) return <span className="text-[9px] text-white/40">{toolName}</span>

  if (toolName === 'Bash') return <BashView command={toolInput.command ?? ''} />
  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    return <EditView filePath={toolInput.file_path ?? ''}
                     oldStr={toolInput.old_string} newStr={toolInput.new_string} />
  }
  if (toolName === 'Read') return <ReadView filePath={toolInput.file_path ?? ''} />
  if (toolName === 'Write') return <span className="text-[9px] text-white/40">Writing {toolInput.file_path ?? '...'}</span>
  if (toolName === 'Glob') return <span className="text-[9px] text-white/40">Finding files...</span>
  if (toolName === 'Grep') return <span className="text-[9px] text-white/40">Searching...</span>
  if (toolName === 'WebFetch') return <span className="text-[9px] text-white/40">Fetching {(toolInput.url ?? '').slice(0, 40)}...</span>
  if (toolName?.startsWith('Task')) return <span className="text-[9px] text-white/40">Tasking...</span>

  return <span className="text-[9px] text-white/40">Working...</span>
}

// ── Permission approval view ────────────────────────────────────────────────

function ApprovalView({
  session,
  onRespond
}: {
  session: CliSession
  onRespond: (id: string, v: string) => void
}) {
  const tool = session.currentTool ?? ''
  const input = session.currentToolInput
  const isPlanApproval = tool === 'ExitPlanMode'

  if (isPlanApproval) {
    const options = session.promptOptions?.length
      ? session.promptOptions
      : ['Yes, auto-accept edits', 'Yes, manually approve edits', 'Tell Claude what to change']
    return (
      <div className="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
        {session.promptText && (
          <div className="text-[9px] leading-relaxed rounded-lg px-2 py-1.5"
            style={{ background: 'rgba(245,158,11,0.08)', color: 'rgba(255,255,255,0.6)',
                     border: '1px solid rgba(245,158,11,0.15)', maxHeight: 60, overflow: 'hidden' }}>
            {session.promptText}
          </div>
        )}
        <div className="flex flex-col gap-1.5 mt-auto">
          {options.map((option, index) => {
            const isFeedback = /tell claude/i.test(option)
            const isPrimary = index === 0
            return (
              <button
                key={option}
                onClick={() => onRespond(session.id, option)}
                className="w-full text-[10px] font-medium px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-125 text-left"
                style={{
                  background: isFeedback
                    ? 'rgba(255,255,255,0.05)'
                    : isPrimary
                    ? 'rgba(74,222,128,0.12)'
                    : 'rgba(255,255,255,0.07)',
                  color: isFeedback
                    ? '#ddd'
                    : isPrimary
                    ? '#4ade80'
                    : '#f5f5f5',
                  border: isFeedback
                    ? '1px solid rgba(255,255,255,0.12)'
                    : isPrimary
                    ? '1px solid rgba(74,222,128,0.2)'
                    : '1px solid rgba(255,255,255,0.14)'
                }}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
      {/* Tool description */}
      <div className="flex flex-col gap-1.5 min-h-0 overflow-hidden">
        {input && <ToolBodyView toolName={tool} toolInput={input} />}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1 mt-auto shrink-0">
        <div className="flex gap-1.5">
          <button
            onClick={() => onRespond(session.id, 'Deny')}
            className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-125"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(session.id, 'Allow Once')}
            className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-125"
            style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
          >
            Allow Once
          </button>
        </div>
        <button
          onClick={() => onRespond(session.id, 'Always Allow')}
          className="w-full text-[10px] font-medium px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-125 text-left"
          style={{ background: 'rgba(255,255,255,0.05)', color: '#888', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Always Allow {tool} this session
        </button>
      </div>
    </div>
  )
}

// ── Todo list ───────────────────────────────────────────────────────────────

const MAX_ACTIVE = 5
const MAX_COMPLETED_SHOWN = 2

function TodoList({ todos }: { todos: TodoItem[] }) {
  const [showAllCompleted, setShowAllCompleted] = useState(false)

  const active    = todos.filter(t => t.status !== 'completed')
  const completed = todos.filter(t => t.status === 'completed')

  const visibleActive    = active.slice(0, MAX_ACTIVE)
  const visibleCompleted = showAllCompleted ? completed : completed.slice(0, MAX_COMPLETED_SHOWN)
  const hiddenCompleted  = completed.length - MAX_COMPLETED_SHOWN

  const doneCount       = completed.length
  const inProgressCount = todos.filter(t => t.status === 'in_progress').length
  const openCount       = todos.filter(t => t.status === 'pending').length
  const currentTodo = todos.find(t => t.status === 'in_progress') ?? active[0] ?? completed[completed.length - 1]

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {/* Summary line */}
      <div className="flex flex-col gap-1">
        <div className="text-[8px] uppercase tracking-[0.18em] text-white/25">
          Task Progress
        </div>
        <div className="text-[10px] text-white/70 leading-tight truncate">
          {currentTodo
            ? (currentTodo.status === 'in_progress' && currentTodo.activeForm
                ? currentTodo.activeForm
                : currentTodo.content)
            : 'Waiting for next task'}
        </div>
        <div className="text-[8px] text-white/25">
          {doneCount > 0 && `${doneCount} done`}
          {doneCount > 0 && inProgressCount > 0 && ' · '}
          {inProgressCount > 0 && `${inProgressCount} active`}
          {(doneCount > 0 || inProgressCount > 0) && openCount > 0 && ' · '}
          {openCount > 0 && `${openCount} open`}
        </div>
      </div>

      {/* Active tasks */}
      <div
        className="flex-1 min-h-0 rounded-[12px] px-2.5 py-2 overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex flex-col gap-[3px] h-full min-h-0">
          {visibleActive.map(todo => (
            <div key={todo.id} className="flex items-start gap-1.5">
              <span className="shrink-0 mt-px" style={{ width: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {todo.status === 'in_progress'
                  ? <Loader2 size={8} color="#60a5fa" className="animate-spin" />
                  : <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>○</span>}
              </span>
              <span className="text-[9px] leading-tight truncate"
                style={{ color: todo.status === 'in_progress' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)' }}>
                {todo.status === 'in_progress' && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
              {todo.blockedBy && todo.blockedBy.length > 0 && (
                <span className="text-[8px] shrink-0" style={{ color: '#f59e0b' }}>blocked</span>
              )}
            </div>
          ))}
          {active.length > MAX_ACTIVE && (
            <span className="text-[8px] text-white/20 pl-[14px]">+{active.length - MAX_ACTIVE} more</span>
          )}

          {/* Completed tasks */}
          {visibleCompleted.map(todo => (
            <div key={todo.id} className="flex items-start gap-1.5">
              <span className="shrink-0 mt-px text-[9px]" style={{ color: '#4ade80', width: 10, textAlign: 'center' }}>✓</span>
              <span className="text-[9px] leading-tight truncate"
                style={{ color: 'rgba(255,255,255,0.2)', textDecoration: 'line-through' }}>
                {todo.content}
              </span>
            </div>
          ))}

          {/* Collapsed completed */}
          {!showAllCompleted && hiddenCompleted > 0 && (
            <button
              onClick={() => setShowAllCompleted(true)}
              className="text-[8px] text-white/20 hover:text-white/40 pl-[14px] text-left transition-colors cursor-pointer"
              style={{ background: 'none', border: 'none', padding: '0 0 0 14px' }}
            >
              … +{hiddenCompleted} completed
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MessagePanel({ message, isDone }: { message: string; isDone: boolean }) {
  return (
    <div
      className="mt-1 rounded-[12px] px-2.5 py-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="text-[8px] uppercase tracking-[0.18em] text-white/25 mb-1">
        Activity
      </div>
      <div
        className="text-[9px] leading-[1.45] whitespace-pre-wrap break-all"
        style={{
          color: isDone ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)',
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere'
        } as any}
      >
        {message}
      </div>
    </div>
  )
}

// ── Main card ───────────────────────────────────────────────────────────────

export function SessionCard({ session, index, onRespond, onDismiss, onFocusTerminal, onCardClick }: SessionCardProps) {
  const { status } = session
  const [hovered, setHovered] = useState(false)
  const isApproval  = status === 'waitingForApproval'
  const isTurnDone  = status === 'turnDone'
  const isEnded     = status === 'ended'
  const isError     = status === 'interrupted'
  const isDone      = isTurnDone || isEnded || isError
  const showDismiss = isDone
  const isActive    = status === 'processing' || status === 'runningTool' || status === 'thinking'
  const isWaiting   = isApproval || status === 'question' || status === 'waitingForInput'

  const hasQuestionOptions = status === 'question' && (session.promptOptions?.length ?? 0) > 0
  const cardWidth = (isApproval || hasQuestionOptions) ? '320px' : '220px'

  const cardBg = isApproval
    ? 'linear-gradient(160deg, #2d1f00 0%, #1a1200 100%)'
    : isTurnDone
    ? 'linear-gradient(160deg, #123718 0%, #08160b 100%)'
    : isEnded
    ? 'linear-gradient(160deg, #0b2210 0%, #061108 100%)'
    : isError
    ? 'linear-gradient(160deg, #2a0d0d 0%, #140707 100%)'
    : 'rgba(255,255,255,0.05)'

  const cardBorder = isApproval
    ? '1px solid rgba(245,158,11,0.3)'
    : isTurnDone
    ? '1px solid rgba(74,222,128,0.3)'
    : isEnded
    ? '1px solid rgba(74,222,128,0.18)'
    : isError
    ? '1px solid rgba(248,113,113,0.2)'
    : '1px solid rgba(255,255,255,0.08)'

  const color = statusColor(status)

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className="flex-shrink-0 relative rounded-[16px] flex flex-col gap-1.5 overflow-hidden"
      style={{
        background: cardBg,
        border: cardBorder,
        boxShadow: isTurnDone
          ? '0 0 0 1px rgba(74,222,128,0.06), inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 24px rgba(74,222,128,0.08)'
          : isEnded
          ? '0 0 0 1px rgba(74,222,128,0.03), inset 0 1px 0 rgba(255,255,255,0.02)'
          : undefined,
        padding: '10px 11px 9px',
        width: cardWidth,
        minHeight: isApproval || hasQuestionOptions ? 252 : 172,
        transition: 'width 0.3s ease',
        cursor: 'pointer'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onCardClick(session.id)
      }}
    >
      {showDismiss && (
        <button
          onClick={() => onDismiss(session.id)}
          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center transition-opacity cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.1)', opacity: hovered ? 0.7 : 0 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = hovered ? '0.7' : '0')}
          title="Dismiss card"
        >
          <X size={9} color="#aaa" />
        </button>
      )}

      {/* Header: tool badge + status */}
      <div className={`flex items-center gap-1.5 ${showDismiss ? 'pr-5' : ''}`}>
        <span className="text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide shrink-0"
          style={{
            background: session.tool === 'claude' ? 'rgba(255,138,76,0.2)' : 'rgba(96,165,250,0.2)',
            color:      session.tool === 'claude' ? '#ff8a4c'              : '#60a5fa'
          }}>
          {session.tool}
        </span>

        {/* Status icon */}
        {(isTurnDone || isEnded) && <Check size={11} color="#4ade80" strokeWidth={2.5} className="shrink-0" />}
        {isError   && <AlertCircle size={11} color="#f87171" className="shrink-0" />}
        {isApproval&& <Shield size={11} color="#f59e0b" className="shrink-0" />}
        {isActive  && <Loader2 size={11} color="#60a5fa" className="animate-spin shrink-0" />}
        {status === 'ready' && <Minus size={11} color="#444" className="shrink-0" />}

        <span className="text-[9px] font-medium shrink-0" style={{ color }}>
          {statusLabel(status)}
        </span>

        {/* Focus terminal button */}
        <button
          onClick={(e) => { e.stopPropagation(); onFocusTerminal(session.id) }}
          className="ml-auto opacity-20 hover:opacity-70 transition-opacity cursor-pointer shrink-0"
          title="Focus terminal"
          style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}
        >
          <ExternalLink size={9} color="#aaa" />
        </button>
      </div>

      {/* Session title */}
      <div className="text-[12px] font-semibold text-white leading-tight"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: isEnded ? 'rgba(255,255,255,0.86)' : isTurnDone ? '#ffffff' : undefined
        } as any}>
        {session.name || session.title}
      </div>

      {/* CWD */}
      <div className="text-[9px] font-mono text-white/25 truncate">{shortCwd(session.cwd)}</div>

      {/* Body — varies by status */}
      {isApproval ? (
        <div
          className="mt-1 rounded-[12px] px-2.5 py-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <ApprovalView session={session} onRespond={onRespond} />
        </div>
      ) : status === 'runningTool' && session.currentTool ? (
        <div
          className="mt-1 rounded-[12px] px-2.5 py-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[8px] uppercase tracking-[0.18em] text-white/25 mb-1">
            Current Tool
          </div>
          <div className="text-[9px] text-white/35 mb-1 flex items-center gap-1">
            <Loader2 size={9} color="#60a5fa" className="animate-spin" />
            <span style={{ color: '#60a5fa' }}>{session.currentTool}</span>
          </div>
          <ToolBodyView toolName={session.currentTool} toolInput={session.currentToolInput} />
        </div>
      ) : status === 'question' ? (
        <div
          className="mt-1 flex flex-col gap-1.5 rounded-[12px] px-2.5 py-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {session.promptText && (
            <div className="text-[10px] rounded-lg px-2 py-1.5 leading-relaxed shrink-0"
              style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c',
                       borderLeft: '2px solid #fb923c' }}>
              {session.promptText}
            </div>
          )}
          {session.promptOptions && session.promptOptions.length > 0 ? (
            <div className="flex flex-col gap-1 pr-1">
              {session.promptOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); onRespond(session.id, opt) }}
                  className="text-left text-[10px] font-medium px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-125"
                  style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[9px] text-white/30">→ Answer in terminal</span>
          )}
        </div>
      ) : status === 'waitingForInput' ? (
        <div
          className="mt-1 rounded-[12px] px-2.5 py-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[8px] uppercase tracking-[0.18em] text-white/25 mb-1">
            Waiting
          </div>
          <span className="text-[10px] text-[#fbbf24]">→ Waiting for input in terminal</span>
        </div>
      ) : isWaiting && session.promptText ? (
        <div
          className="mt-1 rounded-[12px] px-2.5 py-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[8px] uppercase tracking-[0.18em] text-white/25 mb-1">
            Waiting
          </div>
          <div className="text-[10px] rounded-lg px-2 py-1.5 leading-relaxed"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
                     borderLeft: '2px solid #f59e0b', maxHeight: 60, overflow: 'hidden' }}>
            {session.promptText}
          </div>
        </div>
      ) : session.todos && session.todos.length > 0 ? (
        <div className="mt-1">
          <TodoList todos={session.todos} />
        </div>
      ) : session.lastMessage ? (
        <MessagePanel message={session.lastMessage} isDone={isDone} />
      ) : null}

      {/* Sub-agent count */}
      {(session.subAgentCount ?? 0) > 0 && (
        <div className="text-[9px] text-white/30 mt-auto">
          Running {session.subAgentCount} agent{session.subAgentCount! > 1 ? 's' : ''}
        </div>
      )}
    </motion.div>
  )
}
