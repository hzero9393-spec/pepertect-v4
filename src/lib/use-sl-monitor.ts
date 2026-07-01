'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/lib/auth-store'
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
}

interface SLMonitorResult {
  success: boolean
  checked: number
  triggered: SLTrigger[]
}

/**
 * Hook that polls /api/trade/sl-monitor every 1 second
 * when the user has positions with SL/Target set.
 *
 * On trigger: shows trade success popup and refreshes user data.
 */
export function useSLMonitor() {
  const token = useAuthStore(s => s.token)
  const setUser = useAuthStore(s => s.setUser)
  const userData = useAuthStore(s => s.user)
  const { showTradeSuccess } = useTradeSuccess()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTriggerRef = useRef<string>('') // Prevent duplicate UI alerts

  const runCheck = useCallback(async () => {
    if (!token) return

    try {
      const res = await fetch('/api/trade/sl-monitor', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) return

      const data: SLMonitorResult = await res.json()

      if (data.triggered?.length > 0) {
        for (const trigger of data.triggered) {
          // Prevent duplicate alerts for same position
          const alertKey = `${trigger.positionId}:${trigger.reason}`
          if (lastTriggerRef.current === alertKey) continue
          lastTriggerRef.current = alertKey

          if (trigger.exitSuccess && trigger.pnl !== undefined) {
            showTradeSuccess({
              symbol: `${trigger.reason === 'STOP_LOSS' ? '⛔ SL' : '🎯 Target'} Hit`,
              type: trigger.reason === 'STOP_LOSS' ? 'SELL' : 'SELL',
              qty: 0,
              price: trigger.triggerPrice,
              time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
              orderId: '',
              segment: 'OPTIONS',
              totalValue: trigger.pnl,
            })
          }

          // Refresh user data after SL/Target exit
          try {
            const meRes = await fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (meRes.ok) {
              const meData = await meRes.json()
              if (meData.user) setUser(meData.user)
            }
          } catch { /* ignore */ }

          // Reset alert key after 5 seconds
          setTimeout(() => {
            if (lastTriggerRef.current === alertKey) {
              lastTriggerRef.current = ''
            }
          }, 5000)
        }
      }
    } catch {
      // Silent fail — monitoring is best-effort
    }
  }, [token, showTradeSuccess, setUser])

  useEffect(() => {
    if (!token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Poll every 1 second
    intervalRef.current = setInterval(runCheck, 1000)

    // Run immediately on mount
    runCheck()

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [token, runCheck])
}