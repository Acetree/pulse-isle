import { useState, useEffect, useCallback, useRef } from 'react'
import type { CliSession, NotchState, ServerMessage } from '@/types'

interface IslandState {
  sessions: CliSession[]
  connected: boolean
  notchState: NotchState
  unseenDoneSessionIds: string[]
}

const AUTO_DISMISS_DELAY = 5000

function isDoneStatus(status: CliSession['status']): boolean {
  return status === 'turnDone' || status === 'ended' || status === 'interrupted'
}

export function useIslandStore() {
  const [state, setState] = useState<IslandState>({
    sessions: [],
    connected: false,
    notchState: 'capsule',
    unseenDoneSessionIds: []
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const autoDismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const cancelDismiss = useCallback((sessionId: string) => {
    const timer = autoDismissTimers.current.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      autoDismissTimers.current.delete(sessionId)
    }
  }, [])

  const scheduleDismiss = useCallback((sessionId: string) => {
    if (autoDismissTimers.current.has(sessionId)) return
    const timer = setTimeout(() => {
      autoDismissTimers.current.delete(sessionId)
      window.island.wsSend({ type: 'session:dismiss', sessionId })
      setState(s => ({ ...s, sessions: s.sessions.filter(ses => ses.id !== sessionId) }))
    }, AUTO_DISMISS_DELAY)
    autoDismissTimers.current.set(sessionId, timer)
  }, [])

  useEffect(() => {
    const handleWsMessage = (data: ServerMessage) => {
      switch (data.type) {
        case 'sessions:sync':
          for (const [sessionId] of autoDismissTimers.current) {
            const session = data.sessions.find(ses => ses.id === sessionId)
            if (!session || (session.status !== 'ended' && session.status !== 'interrupted')) {
              cancelDismiss(sessionId)
            }
          }
          setState(s => {
            const unseenDoneSessionIds = s.notchState === 'cards'
              ? []
              : Array.from(new Set([
                  ...s.unseenDoneSessionIds,
                  ...data.sessions.filter(ses => isDoneStatus(ses.status)).map(ses => ses.id)
                ])).filter(id => data.sessions.some(ses => ses.id === id && isDoneStatus(ses.status)))
            return { ...s, sessions: data.sessions, unseenDoneSessionIds }
          })
          // Schedule dismiss for any already-done sessions in the sync
          for (const ses of data.sessions) {
            if (ses.status === 'ended' || ses.status === 'interrupted') {
              scheduleDismiss(ses.id)
            } else {
              cancelDismiss(ses.id)
            }
          }
          break

        case 'session:update': {
          const { sessionId, ...updates } = data
          setState(s => {
            const exists = s.sessions.find(ses => ses.id === sessionId)
            const nextStatus = updates.status ?? exists?.status
            const unseenDoneSessionIds = s.notchState === 'cards'
              ? s.unseenDoneSessionIds.filter(id => id !== sessionId)
              : nextStatus && isDoneStatus(nextStatus)
              ? Array.from(new Set([...s.unseenDoneSessionIds, sessionId]))
              : s.unseenDoneSessionIds.filter(id => id !== sessionId)
            if (exists) {
              return {
                ...s,
                unseenDoneSessionIds,
                sessions: s.sessions.map(ses =>
                  ses.id === sessionId ? { ...ses, ...updates } : ses
                )
              }
            }
            // New session arrived via update (create it)
            return {
              ...s,
              unseenDoneSessionIds,
              sessions: [...s.sessions, {
                id: sessionId,
                tool: updates.tool || 'claude',
                title: updates.title || sessionId,
                status: updates.status,
                lastMessage: updates.lastMessage || '',
                cwd: updates.cwd || '',
                startedAt: Date.now(),
                currentTool: updates.currentTool,
                currentToolInput: updates.currentToolInput,
                promptText: updates.promptText,
                promptOptions: updates.promptOptions,
                todos: updates.todos
              }]
            }
          })
          if (updates.status === 'ended' || updates.status === 'interrupted') {
            scheduleDismiss(sessionId)
          } else if (updates.status) {
            cancelDismiss(sessionId)
          }
          break
        }

        case 'session:name':
          setState(s => ({
            ...s,
            sessions: s.sessions.map(ses =>
              ses.id === data.sessionId ? { ...ses, name: data.name } : ses
            )
          }))
          break

        case 'session:delete':
          cancelDismiss(data.sessionId)
          setState(s => ({
            ...s,
            sessions: s.sessions.filter(ses => ses.id !== data.sessionId),
            unseenDoneSessionIds: s.unseenDoneSessionIds.filter(id => id !== data.sessionId)
          }))
          break

        case 'notification':
          // Notification handled by windowManager (auto-expand), no state needed here
          break
      }
    }

    const cleanupWs = window.island.onWsMessage(handleWsMessage)
    const cleanupConn = window.island.onConnectionStatus(connected => setState(s => ({ ...s, connected })))
    const cleanupState = window.island.onStateChange(notchState => setState(s => ({
      ...s,
      notchState: notchState as NotchState,
      unseenDoneSessionIds: notchState === 'cards' ? [] : s.unseenDoneSessionIds
    })))

    window.island.requestSync()

    return () => {
      cleanupWs(); cleanupConn(); cleanupState()
      for (const timer of autoDismissTimers.current.values()) clearTimeout(timer)
      autoDismissTimers.current.clear()
    }
  }, [cancelDismiss, scheduleDismiss])

  const respond = useCallback((sessionId: string, value: string) => {
    window.island.wsSend({ type: 'session:respond', sessionId, value })
  }, [])

  const dismiss = useCallback((sessionId: string) => {
    cancelDismiss(sessionId)
    window.island.wsSend({ type: 'session:dismiss', sessionId })
    setState(s => ({ ...s, sessions: s.sessions.filter(ses => ses.id !== sessionId) }))
  }, [cancelDismiss])

  const focusTerminal = useCallback((sessionId: string) => {
    window.island.wsSend({ type: 'session:focus-terminal', sessionId })
  }, [])

  return { ...state, unseenDoneCount: state.unseenDoneSessionIds.length, respond, dismiss, focusTerminal }
}
