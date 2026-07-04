'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'

interface SLTrigger {
  positionId: string
  triggered: boolean
  reason: 'STOP_LOSS' | 'TARGET'
  triggerPrice: number
  previousPrice: number | null
  exitSuccess: boolean
  exitError?: string
  pnl?: number
  message?: string
  symbol?: string
  segment?: string
  tradeDirection?: string
}

/**
 * Global SL/Target Monitor — runs on EVERY page via app-shell.
 * Polls /api/trade/sl-monitor every 1 second when user is authenticated.
 * Shows popup on trigger and refreshes user data + positions.
 */
export function GlobalSLMonitor() {
  const token = useAuthStore(s => s.token)
  const setUser = useAuthStore(s => s.setUser)
  const bumpTradeSignal = useAppStore(s => s.bumpTradeSignal)
  const { showTradeSuccess } = useTradeSuccess()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTriggerRef = useRef<string>('')

  const runCheck = useCallback(async () => {
    if (!token) return

    try {
      const res = await fetch('/api/trade/sl-monitor', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) return

      const data = await res.json()
      const triggered: SLTrigger[] = data.triggered || []

      if (triggered.length > 0) {
        for (const trigger of triggered) {
          const alertKey = `${trigger.positionId}:${trigger.reason}`
          if (lastTriggerRef.current === alertKey) continue
          lastTriggerRef.current = alertKey

          if (trigger.exitSuccess && trigger.pnl !== undefined) {
            const isSL = trigger.reason === 'STOP_LOSS'
            const seg = trigger.segment || 'OPTIONS'
            const dir = trigger.tradeDirection === 'BUY' ? 'SELL' : 'BUY'
            const label = trigger.symbol
              ? `${trigger.symbol} ${isSL ? 'SL' : 'Target'} Hit`
              : `${isSL ? 'SL' : 'Target'} Hit`

            showTradeSuccess({
              symbol: label,
              type: dir as 'BUY' | 'SELL',
              qty: 0,
              price: trigger.triggerPrice,
              time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
              orderId: '',
              segment: seg as 'EQUITY' | 'FUTURES' | 'OPTIONS',
              totalValue: trigger.pnl,
            })
          }

          // Refresh user data
          try {
            const meRes = await fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (meRes.ok) {
              const meData = await meRes.json()
              if (meData.user) setUser(meData.user)
            }
          } catch { /* ignore */ }

          // Notify positions page to refetch
          bumpTradeSignal()

          setTimeout(() => {
            if (lastTriggerRef.current === alertKey) {
              lastTriggerRef.current = ''
            }
          }, 5000)
        }
      }
    } catch {
      // Silent — monitoring is best-effort
    }
  }, [token, showTradeSuccess, setUser, bumpTradeSignal])

  useEffect(() => {
    if (!token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Server-side AutoExitWorker runs at 500ms — frontend only needs to
  // poll for trigger notifications. 30s is plenty responsive.
  intervalRef.current = setInterval(runCheck, 30000)
    runCheck()

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [token, runCheck])

  return null // Invisible component
}