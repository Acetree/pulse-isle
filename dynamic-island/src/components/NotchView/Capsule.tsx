import { Check, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { CliSession } from '@/types'

interface CapsuleProps {
  connected: boolean
  sessions: CliSession[]
  unseenDoneCount: number
}

export function Capsule({ connected, sessions, unseenDoneCount }: CapsuleProps) {
  const waitingCount = sessions.filter(
    s => s.status === 'waitingForApproval' || s.status === 'question' || s.status === 'waitingForInput'
  ).length
  const runningCount = sessions.filter(
    s => s.status === 'processing' || s.status === 'runningTool' || s.status === 'thinking'
  ).length
  const totalActive = sessions.filter(
    s => s.status !== 'turnDone' && s.status !== 'ended' && s.status !== 'interrupted'
  ).length
  const countLabel = totalActive > 0 ? totalActive : sessions.length
  const hasClaude = sessions.some(s => s.tool === 'claude')
  const hasCodex = sessions.some(s => s.tool === 'codex')
  const hasUnseenDone = unseenDoneCount > 0
  const idle = waitingCount === 0 && runningCount === 0
  const statusGlow = waitingCount > 0
    ? '0 0 14px rgba(245,158,11,0.45)'
    : runningCount > 0
      ? '0 0 16px rgba(96,165,250,0.4)'
      : hasUnseenDone
        ? '0 0 16px rgba(74,222,128,0.5)'
      : connected
        ? '0 0 12px rgba(74,222,128,0.35)'
        : 'none'

  return (
    <>
      {/* Left: waiting indicator or spinner */}
      <div className="flex items-center justify-center w-5 h-5">
        {waitingCount > 0 ? (
          <motion.div
            key="waiting"
            className="w-3 h-3 rounded-full flex items-center justify-center"
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: [1, 1.18, 1], opacity: 1 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ background: '#f59e0b', boxShadow: statusGlow }}
          >
            <span className="text-[7px] font-bold text-black leading-none">{waitingCount}</span>
          </motion.div>
        ) : runningCount > 0 ? (
          <motion.div
            key="running"
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2 }}
            style={{ filter: 'drop-shadow(0 0 8px rgba(96,165,250,0.45))' }}
          >
            <Loader2 size={14} color="#60a5fa" className="animate-spin" />
          </motion.div>
        ) : hasUnseenDone ? (
          <motion.div
            key="done"
            className="w-3 h-3 rounded-full flex items-center justify-center"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: [1, 1.14, 1], opacity: [0.9, 1, 0.9] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
            style={{ background: '#4ade80', boxShadow: statusGlow }}
          >
            <Check size={8} color="#052e12" strokeWidth={3} />
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            className="w-2 h-2 rounded-full"
            animate={idle && connected ? { scale: [1, 1.08, 1], opacity: [0.65, 0.8, 0.65] } : { scale: 1, opacity: 0.5 }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ backgroundColor: connected ? '#666' : '#555', boxShadow: statusGlow }}
          />
        )}
      </div>

      {/* Center: tool indicators */}
      <div className="flex items-center gap-1">
        {hasClaude && (
          <motion.div
            className="w-1.5 h-1.5 rounded-full"
            initial={{ y: 2, opacity: 0 }}
            animate={{ y: [0, -1.5, 0], opacity: 1 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ background: '#ff8a4c', boxShadow: '0 0 8px rgba(255,138,76,0.45)' }}
          />
        )}
        {hasCodex && (
          <motion.div
            className="w-1.5 h-1.5 rounded-full"
            initial={{ y: 2, opacity: 0 }}
            animate={{ y: [0, -1.5, 0], opacity: 1 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.18 }}
            style={{ background: '#60a5fa', boxShadow: '0 0 8px rgba(96,165,250,0.45)' }}
          />
        )}
        {sessions.length === 0 && (
          <motion.div
            className="w-4 h-4 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
            style={{ border: '1.5px solid rgba(255,255,255,0.2)' }} />
        )}
      </div>

      {/* Right: active count */}
      <div className="relative min-w-[12px] text-right">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={countLabel}
            className="text-[12px] font-bold tabular-nums inline-block"
            initial={{ y: 6, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: -6, opacity: 0, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.8 }}
            style={{ color: 'rgba(255,255,255,0.76)', textShadow: '0 0 10px rgba(255,255,255,0.08)' }}
          >
            {countLabel}
          </motion.span>
        </AnimatePresence>
      </div>
    </>
  )
}
