'use client'

import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useAppStore, type PageId } from '@/lib/store'

// Pages in swipe order (same as mobile nav bar)
const SWIPE_PAGES: PageId[] = ['dashboard', 'trading', 'watchlist', 'positions', 'orders']

const SWIPE_THRESHOLD = 45        // min px to commit navigation
const VELOCITY_THRESHOLD = 0.3    // px/ms — fast flick
const SNAP_MS = 220               // ms for snap-back or commit animation
const COMMIT_MS = 200             // ms for the final slide-off

function getSwipeIndex(page: PageId): number {
  return SWIPE_PAGES.indexOf(page)
}

export function MobileSwipeNavigator({ children }: { children: ReactNode }) {
  const { currentPage, setCurrentPage } = useAppStore()
  const wrapperRef = useRef<HTMLDivElement>(null)    // outer touch catcher
  const panelRef = useRef<HTMLDivElement>(null)      // inner sliding panel

  // Touch tracking — all refs, zero React state during drag
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const decided = useRef(false)   // have we decided horizontal vs vertical?
  const swiping = useRef(false)   // confirmed horizontal swipe
  const locked = useRef(false)    // animation in progress
  const rafId = useRef(0)
  const lastX = useRef(0)

  const currentIndex = getSwipeIndex(currentPage)
  const isSwipeable = currentIndex >= 0

  // ── Direct DOM helpers (no React re-render) ───────────────

  const setTransform = useCallback((x: number, opacity = 1) => {
    const el = panelRef.current
    if (!el) return
    el.style.transform = `translate3d(${x}px, 0, 0)`
    el.style.opacity = String(opacity)
  }, [])

  const clearTransform = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    el.style.transform = ''
    el.style.opacity = ''
    el.style.transition = ''
  }, [])

  const addTransition = useCallback((ms: number) => {
    const el = panelRef.current
    if (!el) return
    el.style.transition = `transform ${ms}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${ms}ms ease`
  }, [])

  // ── Touch Start ─────────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isSwipeable || locked.current) return
    const t = e.touches[0]
    startX.current = t.clientX
    startY.current = t.clientY
    startTime.current = Date.now()
    lastX.current = t.clientX
    decided.current = false
    swiping.current = false
  }, [isSwipeable])

  // ── Touch Move — direct DOM only, 60fps ───────────────────

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwipeable || locked.current) return

    const t = e.touches[0]
    const dx = t.clientX - startX.current
    const dy = Math.abs(t.clientY - startY.current)

    // Decision phase: determine horizontal vs vertical intent
    if (!decided.current) {
      if (Math.abs(dx) > 6 || dy > 6) {
        decided.current = true
        if (dy >= Math.abs(dx)) {
          return // let vertical scroll happen naturally
        }
        // Confirmed horizontal — prevent scroll
        swiping.current = true
      } else {
        return
      }
    }

    if (!swiping.current) return

    // Prevent browser scroll during horizontal swipe
    e.preventDefault()

    // Content follows finger direction
    let offset = dx
    const atStart = currentIndex === 0 && dx < 0   // can't go before first
    const atEnd = currentIndex === SWIPE_PAGES.length - 1 && dx > 0  // can't go past last

    if (atStart || atEnd) {
      offset = dx * 0.15
    }

    // Subtle opacity + scale for depth
    const progress = Math.min(Math.abs(offset) / 300, 1)
    const opacity = 1 - progress * 0.3

    // Use rAF to batch DOM writes (one write per frame)
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      setTransform(offset, opacity)
    })

    lastX.current = t.clientX
  }, [isSwipeable, currentIndex, setTransform])

  // ── Touch End ──────────────────────────────────────────────

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isSwipeable || locked.current) {
      if (swiping.current) {
        // Animation was locked, snap back
        cancelAnimationFrame(rafId.current)
        addTransition(SNAP_MS)
        setTransform(0, 1)
      }
      return
    }

    cancelAnimationFrame(rafId.current)

    const dx = e.changedTouches[0].clientX - startX.current
    const elapsed = Date.now() - startTime.current
    const velocity = Math.abs(dx) / elapsed

    if (!swiping.current) return

    const shouldNavigate =
      (Math.abs(dx) > SWIPE_THRESHOLD) || (velocity > VELOCITY_THRESHOLD)

    if (!shouldNavigate) {
      // ── Snap back ──
      addTransition(SNAP_MS)
      setTransform(0, 1)
      const onEnd = () => {
        clearTransform()
        panelRef.current?.removeEventListener('transitionend', onEnd)
        swiping.current = false
      }
      panelRef.current?.addEventListener('transitionend', onEnd, { once: true })
      return
    }

    // ── Commit navigation ──
    locked.current = true

    // finger right (dx>0) → content right → next page
    // finger left  (dx<0) → content left → previous page
    const goNext = dx > 0 && currentIndex < SWIPE_PAGES.length - 1
    const goPrev = dx < 0 && currentIndex > 0

    if (!goNext && !goPrev) {
      // At edge — snap back
      addTransition(SNAP_MS)
      setTransform(0, 1)
      const onEnd = () => {
        clearTransform()
        locked.current = false
        swiping.current = false
      }
      panelRef.current?.addEventListener('transitionend', onEnd, { once: true })
      return
    }

    // goNext → slide content RIGHT (positive), goPrev → slide content LEFT (negative)
    const slideDir = goNext ? 1 : -1
    const targetIndex = goNext ? currentIndex + 1 : currentIndex - 1
    const screenW = window.innerWidth

    // Slide current content off-screen
    addTransition(COMMIT_MS)
    setTransform(slideDir * screenW, 0.3)

    const onSlideOff = () => {
      panelRef.current?.removeEventListener('transitionend', onSlideOff)

      // Switch page (React re-renders new content at transform origin)
      setCurrentPage(SWIPE_PAGES[targetIndex])

      // Instantly reset — new page appears at center, no animation
      // Use rAF to ensure React has committed the new render
      requestAnimationFrame(() => {
        clearTransform()
        locked.current = false
        swiping.current = false
      })
    }

    panelRef.current?.addEventListener('transitionend', onSlideOff, { once: true })
  }, [isSwipeable, currentIndex, setCurrentPage, setTransform, clearTransform, addTransition])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current)
  }, [])

  // Non-swipeable pages: pass through
  if (!isSwipeable) return <>{children}</>

  return (
    <div
      ref={wrapperRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="md:hidden"
      style={{ touchAction: 'pan-y', overflow: 'hidden' }}
    >
      <div
        ref={panelRef}
        style={{
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  )
}