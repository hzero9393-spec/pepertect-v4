/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WebSocket Client Singleton — Single shared WS connection for the app
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Server protocol (Render):
 *   Client → Server:  { type: "subscribe", channel: "market" | "positions" | "options", params?: {...} }
 *   Client → Server:  { type: "unsubscribe", channel: "market" | "positions" | "options" }
 *   Client → Server:  { type: "pong" }
 *   Server → Client:  { type: "auth:success", userId }
 *   Server → Client:  { type: "market:initial", data: { indices, stocks, timestamp } }
 *   Server → Client:  { type: "market:update",  data: { indices, stocks, timestamp, source } }
 *   Server → Client:  { type: "positions",      data: [...] }
 *   Server → Client:  { type: "exit",           data: { positionId, symbol, ... } }
 *   Server → Client:  { type: "options:update", data: { strikes, spot, ... } }
 *   Server → Client:  { type: "error",         message: "..." }
 */

type MsgHandler = (data: any) => void
type StatusHandler = (status: WSStatus) => void

export type WSStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ServerMessage {
  type: string
  data?: any
  message?: string
  userId?: string
}

class WebSocketClient {
  private ws: WebSocket | null = null
  private token: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private status: WSStatus = 'disconnected'
  private subscribedChannels = new Set<string>()  // track what we've subscribed to
  private channelParams = new Map<string, any>()   // options channel needs params

  // Message handlers keyed by message type (e.g. "market:update", "positions", "exit")
  private handlers = new Map<string, Set<MsgHandler>>()
  // Status change handlers
  private statusHandlers = new Set<StatusHandler>()

  private static WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://pepertect-api.onrender.com'

  // ─── Connection ─────────────────────────────────────────────────────

  connect(token: string) {
    if (this.token === token && this.ws?.readyState === WebSocket.OPEN) return

    this.token = token
    this.disconnect() // clean up existing

    this.setStatus('connecting')

    try {
      const url = `${WebSocketClient.WS_URL}/ws?token=${encodeURIComponent(token)}`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.setStatus('connected')
        console.log('[WS Client] Connected')

        // Re-subscribe to all channels after reconnect
        for (const channel of this.subscribedChannels) {
          const params = this.channelParams.get(channel)
          this.sendRaw({ type: 'subscribe', channel, params })
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch {}
      }

      this.ws.onclose = (event) => {
        console.log(`[WS Client] Closed: ${event.code} ${event.reason}`)
        this.ws = null
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }

      this.ws.onerror = () => {
        this.setStatus('error')
      }
    } catch {
      this.setStatus('error')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (!this.token) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      console.log('[WS Client] Reconnecting...')
      this.connect(this.token!)
    }, 3000)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null // prevent auto-reconnect
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  // ─── Subscribe / Unsubscribe ────────────────────────────────────────

  subscribe(channel: string, params?: any) {
    this.subscribedChannels.add(channel)
    if (params) this.channelParams.set(channel, params)
    this.sendRaw({ type: 'subscribe', channel, params })
  }

  unsubscribe(channel: string) {
    this.subscribedChannels.delete(channel)
    this.channelParams.delete(channel)
    this.sendRaw({ type: 'unsubscribe', channel })
  }

  // ─── Message Handling ───────────────────────────────────────────────

  private handleMessage(msg: ServerMessage) {
    // Handle auth response
    if (msg.type === 'auth:success') {
      console.log(`[WS Client] Authenticated as ${msg.userId}`)
      return
    }

    // Handle server ping (WS protocol level, no action needed)
    if (msg.type === 'ping') return

    // Handle error
    if (msg.type === 'error') {
      console.warn(`[WS Client] Error: ${msg.message}`)
      return
    }

    // Route to type-specific handlers
    const handlers = this.handlers.get(msg.type)
    if (handlers) {
      for (const handler of handlers) {
        try { handler(msg.data) } catch (err) {
          console.error(`[WS Client] Handler error for ${msg.type}:`, err)
        }
      }
    }
  }

  /** Register a handler for a specific message type. Returns cleanup function. */
  on(type: string, handler: MsgHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /** Register a status change handler. Returns cleanup function. */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => { this.statusHandlers.delete(handler) }
  }

  // ─── Status ─────────────────────────────────────────────────────────

  getStatus(): WSStatus { return this.status }
  isConnected(): boolean { return this.status === 'connected' }
  getToken(): string | null { return this.token }

  private setStatus(status: WSStatus) {
    if (this.status === status) return
    this.status = status
    for (const handler of this.statusHandlers) {
      try { handler(status) } catch {}
    }
  }

  // ─── Raw Send ───────────────────────────────────────────────────────

  send(msg: object) {
    this.sendRaw(msg)
  }

  private sendRaw(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────

export const wsClient = new WebSocketClient()