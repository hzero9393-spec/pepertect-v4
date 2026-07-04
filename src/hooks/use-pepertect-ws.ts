'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { wsClient, type WSStatus } from '@/lib/ws-client'

// ─── Types ────────────────────────────────────────────────────────────────

interface UsePepertectWS {
  status: WSStatus
  subscribe: (channel: string, params?: any) => void
  unsubscribe: (channel: string) => void
  send: (msg: any) => void
  reconnect: () => void
  /** Listen to a specific message type. Returns cleanup function. */
  on: (type: string, handler: (data: any) => void) => () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function usePepertectWS(): UsePepertectWS {
  const token = useAuthStore(s => s.token)
  const [status, setStatus] = useState<WSStatus>(wsClient.getStatus())
  const cleanupRef = useRef<(() => void)[]>([])

  // Sync status from singleton
  useEffect(() => {
    const cleanup = wsClient.onStatusChange(setStatus)
    return cleanup
  }, [])

  // Connect / disconnect based on token
  useEffect(() => {
    if (token) {
      wsClient.connect(token)
    } else {
      wsClient.disconnect()
    }
    // Cleanup all on-message handlers on unmount
    return () => {
      for (const fn of cleanupRef.current) fn()
      cleanupRef.current = []
    }
  }, [token])

  const on = useCallback((type: string, handler: (data: any) => void) => {
    const cleanup = wsClient.on(type, handler)
    cleanupRef.current.push(cleanup)
    return cleanup
  }, [])

  const subscribe = useCallback((channel: string, params?: any) => {
    wsClient.subscribe(channel, params)
  }, [])

  const unsubscribe = useCallback((channel: string) => {
    wsClient.unsubscribe(channel)
  }, [])

  const send = useCallback((msg: any) => {
    wsClient.send(msg)
  }, [])

  const reconnect = useCallback(() => {
    if (token) {
      wsClient.disconnect()
      setTimeout(() => wsClient.connect(token), 500)
    }
  }, [token])

  return { status, subscribe, unsubscribe, send, reconnect, on }
}

// ─── Channel Constants ─────────────────────────────────────────────────────

export const WS_CHANNELS = {
  MARKET: 'market',
  POSITIONS: 'positions',
  OPTIONS: 'options',
} as const