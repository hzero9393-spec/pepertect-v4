'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/lib/auth-store'

// ─── Types ────────────────────────────────────────────────────────────────

interface ServerMessage {
  type: string
  data?: any
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface UsePepertectWS {
  status: ConnectionStatus
  lastMessage: ServerMessage | null
  subscribe: (channels: string[]) => void
  unsubscribe: (channels: string[]) => void
  send: (msg: any) => void
  reconnect: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function usePepertectWS(): UsePepertectWS {
  const token = useAuthStore(s => s.token)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null)
  const subscribedRef = useRef<Set<string>>(new Set())

  // In production: wss://pepertect-server.onrender.com
  // In development: ws://localhost:4000
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000'

  const connect = useCallback(() => {
    if (!token || wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')

    try {
      const ws = new WebSocket(`${WS_URL}/ws?token=${token}`)

      ws.onopen = () => {
        setStatus('connected')
        console.log('[WS] Connected to Pepertect server')

        // Re-subscribe to previous channels after reconnect
        if (subscribedRef.current.size > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            channels: [...subscribedRef.current],
          }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data)
          setLastMessage(msg)
        } catch {}
      }

      ws.onclose = () => {
        setStatus('disconnected')
        wsRef.current = null
        // Auto-reconnect after 3s if we still have a token
        if (token) {
          reconnectTimer.current = setTimeout(() => connect(), 3000)
        }
      }

      ws.onerror = () => {
        setStatus('error')
      }

      wsRef.current = ws
    } catch {
      setStatus('error')
      reconnectTimer.current = setTimeout(() => connect(), 5000)
    }
  }, [token, WS_URL])

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current)
    if (wsRef.current) {
      wsRef.current.onclose = null // prevent auto-reconnect on intentional close
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  const subscribe = useCallback((channels: string[]) => {
    for (const ch of channels) subscribedRef.current.add(ch)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channels }))
    }
  }, [])

  const unsubscribe = useCallback((channels: string[]) => {
    for (const ch of channels) subscribedRef.current.delete(ch)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', channels }))
    }
  }, [])

  const send = useCallback((msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const reconnect = useCallback(() => {
    disconnect()
    setTimeout(() => connect(), 500)
  }, [connect, disconnect])

  // Connect on mount if token exists, disconnect on unmount
  useEffect(() => {
    if (token) connect()
    return () => disconnect()
  }, [token, connect, disconnect])

  return { status, lastMessage, subscribe, unsubscribe, send, reconnect }
}

// ─── Channel Constants ─────────────────────────────────────────────────────

export const WS_CHANNELS = {
  MARKET: 'market',
  POSITIONS: 'positions',
  /** e.g. 'oc:NIFTY::2026-07-07' */
  optionChain: (underlying: string, expiry: string) => `oc:${underlying}::${expiry}`,
} as const