import { useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Capsule } from './Capsule'
import { SessionCard } from './SessionCard'
import { useIslandStore } from '@/hooks/useIslandStore'

const SPRING_EXPAND = { type: 'spring' as const, stiffness: 400, damping: 34, mass: 0.8 }
const SPRING_COLLAPSE = { type: 'spring' as const, stiffness: 480, damping: 40, mass: 0.6 }
const MIN_CARDS_HEIGHT = 120
const MAX_CARDS_HEIGHT = 520

export function NotchView() {
  const { sessions, connected, notchState, unseenDoneCount, respond, dismiss, focusTerminal } = useIslandStore()

  const isCapsule = notchState === 'capsule'

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const hasDragged = useRef(false)
  const dragStartX = useRef(0)
  const scrollStartLeft = useRef(0)
  const DRAG_THRESHOLD = 4
  const [cardsHeight, setCardsHeight] = useState(220)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollRef.current
    if (el && e.deltaY !== 0) el.scrollLeft += e.deltaY
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    isDragging.current = true
    hasDragged.current = false
    dragStartX.current = e.clientX
    scrollStartLeft.current = el.scrollLeft
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const el = scrollRef.current
    if (!el) return
    const dx = e.clientX - dragStartX.current
    if (Math.abs(dx) > DRAG_THRESHOLD) {
      hasDragged.current = true
      el.style.cursor = 'grabbing'
    }
    el.scrollLeft = scrollStartLeft.current - dx
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    const el = scrollRef.current
    if (el) el.style.cursor = 'grab'
    setTimeout(() => { hasDragged.current = false }, 0)
  }, [])

  const handleCardClick = useCallback((sessionId: string) => {
    if (hasDragged.current) return
    focusTerminal(sessionId)
  }, [focusTerminal])

  useEffect(() => {
    const onUp = () => {
      isDragging.current = false
      const el = scrollRef.current
      if (el) el.style.cursor = 'grab'
      setTimeout(() => { hasDragged.current = false }, 0)
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  const activeSessions = sessions.filter(
    s => s.status !== 'turnDone' && s.status !== 'ended' && s.status !== 'interrupted'
  )
  const doneSessions = sessions.filter(
    s => s.status === 'turnDone' || s.status === 'ended' || s.status === 'interrupted'
  )
  const displaySessions = [...activeSessions, ...doneSessions]

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    const updateHeight = () => {
      const nextHeight = Math.max(MIN_CARDS_HEIGHT, Math.min(MAX_CARDS_HEIGHT, Math.ceil(el.scrollHeight)))
      setCardsHeight(prev => (prev === nextHeight ? prev : nextHeight))
      window.island.setExpandedHeight(nextHeight)
    }

    updateHeight()

    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(el)

    return () => observer.disconnect()
  }, [displaySessions.length, connected, isCapsule, sessions])

  return (
    <div className="w-full h-full select-none" style={{ background: 'transparent' }}>
      <motion.div
        className="absolute left-1/2 top-0 -translate-x-1/2"
        onMouseEnter={() => window.island.notifyMouseEnter()}
        onMouseLeave={() => window.island.notifyMouseLeave()}
        initial={false}
        animate={{
          width: isCapsule ? 240 : 600,
          height: isCapsule ? 32 : cardsHeight,
          borderRadius: isCapsule ? '0 0 18px 18px' : '0 0 24px 24px',
        }}
        transition={isCapsule ? SPRING_COLLAPSE : SPRING_EXPAND}
        style={{
          backgroundColor: '#000',
          willChange: 'width, height',
          /*boxShadow: isCapsule
            ? '0 10px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)'
            : '0 18px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)'
        */}}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ backgroundColor: '#000', borderRadius: 'inherit' }}
        >
          <div className="capsule-ambient" aria-hidden="true" />

          {/* Capsule */}
          <motion.div
            className="absolute inset-0 flex items-center justify-between px-3"
            initial={false}
            animate={{ opacity: isCapsule ? 1 : 0 }}
            transition={{ duration: 0.15 }}
            style={{ pointerEvents: isCapsule ? 'auto' : 'none' }}
          >
            <Capsule connected={connected} sessions={sessions} unseenDoneCount={unseenDoneCount} />
          </motion.div>

          {/* Expanded cards */}
          <AnimatePresence>
            {!isCapsule && (
              <motion.div
                ref={contentRef}
                className="w-full flex flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, delay: 0.07 }}
              >
                {/* Header 修改高度*/}
                <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0 h-8">
                  <span className="text-[10px] text-[#666] font-medium">
                    {displaySessions.length === 0
                      ? 'No active sessions'
                      : `${activeSessions.length} active · ${doneSessions.length} recent`}
                  </span>
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: connected ? '#4ade80' : '#555',
                      boxShadow: connected ? '0 0 5px rgba(74,222,128,0.5)' : 'none'
                    }}
                  />
                </div>

                {/* Scrollable cards */}
                <div className="px-3 pb-2">
                  {displaySessions.length === 0 ? (
                    <div className="min-h-[92px] flex items-center justify-center">
                      <span className="text-[11px] text-[#444]">The island awaits</span>
                    </div>
                  ) : (
                    <div
                      ref={scrollRef}
                      className="notch-scroll-container flex items-stretch gap-2 overflow-x-auto overflow-y-visible pb-1"
                      style={{ cursor: 'grab' }}
                      onWheel={handleWheel}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      {displaySessions.map((session, index) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          index={index}
                          onRespond={respond}
                          onDismiss={dismiss}
                          onFocusTerminal={focusTerminal}
                          onCardClick={handleCardClick}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Scroll dots */}
                {displaySessions.length > 2 && (
                  <div className="flex items-center justify-center gap-1 pb-1.5">
                    {displaySessions.map((_, i) => (
                      <div key={i} className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: i < 2 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)' }} />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
