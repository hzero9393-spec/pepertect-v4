'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { wsClient } from '@/lib/ws-client'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'

/**
 * Global SL/Target Monitor — uses WebSocket events instead of polling.
 *
 * Architecture:
 *   Server-side AutoExitWorker (500ms) detects SL/Target → executes exit
 *   → broadcasts WS "exit" event → this component shows popup + refreshes data
 *
 * Zero frontend API calls — all monitoring happens server-side.
 */
export function GlobalSLMonitor() {
  const token = useAuthStore(s => s.token)
  const setUser = useAuthStore(s => s.setUser)
  const bumpTradeSignal = useAppStore(s => s.bumpTradeSignal)
  const { showTradeSuccess } = useTradeSuccess()
  const lastAlertKeyRef = useRef<string>('')

  useEffect(() => {
    if (!token) return

    const handleExit = (data: any) => {
      if (!data) return

      const alertKey = `${data.positionId || ''}:${data.reason || ''}`
      if (lastAlertKeyRef.current === alertKey) return
      lastAlertKeyRef.current = alertKey

      const isSL = data.reason === 'STOP_LOSS'
      const seg = data.segment || 'OPTIONS'
      const dir = data.tradeDirection === 'BUY' ? 'SELL' : 'BUY'
      const label = data.symbol
        ? `${data.symbol} ${isSL ? 'SL' : 'Target'} Hit`
        : `${isSL ? 'SL' : 'Target'} Hit`

      if (data.pnl !== undefined) {
        showTradeSuccess({
          symbol: label,
          type: dir as 'BUY' | 'SELL',
          qty: 0,
          price: data.triggerPrice || data.exitPrice || 0,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
          orderId: '',
          segment: seg as 'EQUITY' | 'FUTURES' | 'OPTIONS',
          totalValue: data.pnl,
        })
      }

      // Refresh user data (balance updated on server)
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(res => res.ok ? res.json() : null)
        .then(meData => { if (meData?.user) setUser(meData.user) })
        .catch(() => {})

      // Notify positions page to refetch
      bumpTradeSignal()

      // Allow same position to trigger again after 10s (e.g. re-entry + new SL)
      setTimeout(() => {
        if (lastAlertKeyRef.current === alertKey) {
          lastAlertKeyRef.current = ''
        }
      }, 10000)
    }

    const unsub = wsClient.on('exit', handleExit)
    return unsub
  }, [token, showTradeSuccess, setUser, bumpTradeSignal])

  return null
}