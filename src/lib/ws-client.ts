/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WebSocket Client Singleton — Production-grade real-time market data
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * State machine:
 *   disconnected → connecting       (on connect())
 *   connecting   → authenticating   (on ws open, token sent)
 *   authenticating → connected      (on auth:success)
 *   authenticating → reconnecting   (on auth:error or close)
 *   connected    → reconnecting     (on unexpected close)
 *   reconnecting → connecting       (after backoff delay)
 *   reconnecting → dead             (after MAX_RECONNECT_ATTEMPTS)
 *   dead         → connecting       (on manual reconnect() call)
 *   any          → disconnected     (on manual disconnect())
 *
 * Server protocol (DO NOT CHANGE):
 *   Client → Server:  { type: "subscribe", channel: "market" | "positions" | "options", params?: { underlying, expiry } }
 *   Client → Server:  { type: "unsubscribe", channel: "market" | "positions" | "options" }
 *   Client → Server:  { type: "set_upstox_token", token: "..." }
 *   Server → Client:  { type: "auth:success", userId: "..." }
 *   Server → Client:  { type: "error", message: "..." }
 *   Server → Client:  { type: "market:initial", data: { indices, stocks, timestamp } }
 *   Server → Client:  { type: "market:update", data: { indices, stocks, timestamp, source } }
 *   Server → Client:  { type: "market:derived", data: { gainers, losers, breadth, marketStatus, sectors, timestamp } }
 *   Server → Client:  { type: "options:update", data: { underlying, spot, pcr, expiry, strikes, ... } }
 *   Server → Client:  { type: "positions", data: [...] }
 *   Server → Client:  { type: "exit", data: { positionId, symbol, reason, exitPrice, pnl, ... } }
 *   Server → Client:  { type: "upstox_token_set", success: true }
 */

// ─── Public Types ─────────────────────────────────────────────────────────

export type WSStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'dead'

export interface ServerMessage {
  type: string
  data?: any
  message?: string
  userId?: string
  success?: boolean
}

export type MsgHandler = (data: any) => void
export type StatusHandler = (status: WSStatus) => void

// ─── Constants ────────────────────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 50
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://pepertect-api.onrender.com'

// ─── Helpers ──────────────────────────────────────────────────────────────

function computeBackoffDelay(attempt: number): number {
  const delay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1)
  return Math.min(delay, MAX_RECONNECT_DELAY_MS)
}

// ─── WebSocketClient ──────────────────────────────────────────────────────

class WebSocketClient {
  // ── Internal state ────────────────────────────────────────────────────
  private ws: WebSocket | null = null
  private token: string | null = null
  private status: WSStatus = 'disconnected'

  // Reconnection
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  // Auth gate
  private authResolved = false

  // Subscriptions
  private subscribedChannels = new Map<string, any>() // channel → params (or undefined)

  // Pending subscribe/unsubscribe messages queued before auth or while disconnected
  private pendingSubscribeQueue: object[] = []

  // One-shot messages queued while ws is not OPEN (NOT re-sent on reconnect)
  private pendingOneShotQueue: object[] = []

  // Handlers
  private handlers = new Map<string, Set<MsgHandler>>()
  private statusHandlers = new Set<StatusHandler>()

  // Intentional disconnect flag — prevents auto-reconnect
  private intentionalDisconnect = false

  // ─── Connection ───────────────────────────────────────────────────────

  /**
   * Open a WebSocket connection. If already connected with the same token,
   * this is a no-op.
   */
  connect(token: string) {
    if (this.token === token && this.ws?.readyState === WebSocket.OPEN) return

    this.token = token
    this.intentionalDisconnect = false

    // If we're in 'dead' or 'disconnected', allow a fresh connection attempt
    this.disconnect() // clean up any existing connection without setting intentional

    this.intentionalDisconnect = false
    this.reconnectAttempts = 0
    this.transitionTo('connecting')
    this.createConnection()
  }

  /**
   * Manually trigger a reconnect. Only useful from 'dead' state.
   * Resets the reconnect attempt counter.
   */
  reconnect() {
    if (this.status === 'dead' && this.token) {
      this.intentionalDisconnect = false
      this.reconnectAttempts = 0
      this.transitionTo('connecting')
      this.createConnection()
    }
  }

  /**
   * Disconnect and do NOT auto-reconnect.
   */
  disconnect() {
    this.intentionalDisconnect = true
    this.clearReconnectTimer()

    if (this.ws) {
      this.ws.onclose = null // prevent onclose handler from firing
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }

    this.authResolved = false
    this.reconnectAttempts = 0
    this.transitionTo('disconnected')
  }

  // ─── Private: Connection Lifecycle ────────────────────────────────────

  private createConnection() {
    if (!this.token) return

    try {
      const url = `${WS_URL}/ws?token=${encodeURIComponent(this.token)}`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.authResolved = false
        this.transitionTo('authenticating')
        // Auth is already in the URL query param: /ws?token=...
        // Server will send auth:success or auth:error
        // No need to send any message here — just wait for auth response
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch {
          // Ignore malformed messages
        }
      }

      this.ws.onclose = (event) => {
        console.warn(`[WS] Closed: code=${event.code} reason="${event.reason}"`)
        this.ws = null
        this.handleUnexpectedClose(event)
      }

      this.ws.onerror = () => {
        // onclose always follows onerror, so we let onclose handle reconnection
      }
    } catch {
      this.handleUnexpectedClose({ code: 0, reason: 'WebSocket constructor failed' })
    }
  }

  private handleUnexpectedClose(_event: { code: number; reason: string }) {
    if (this.intentionalDisconnect) return

    // Determine next state based on current state
    if (this.status === 'authenticating' || this.status === 'connected') {
      this.scheduleReconnect()
    } else if (this.status === 'connecting') {
      // Connection never succeeded — go to reconnecting
      this.scheduleReconnect()
    }
    // If already 'reconnecting' or 'dead', the scheduleReconnect is already
    // in progress (or we've given up).
  }

  // ─── Private: Reconnection with Exponential Backoff ───────────────────

  private scheduleReconnect() {
    this.clearReconnectTimer()

    this.reconnectAttempts++

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WS] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded. Giving up.`)
      this.transitionTo('dead')
      return
    }

    const delay = computeBackoffDelay(this.reconnectAttempts)
    console.log(`[WS] Reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`)

    this.transitionTo('reconnecting')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.transitionTo('connecting')
      this.createConnection()
    }, delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ─── Private: State Machine ───────────────────────────────────────────

  private transitionTo(newStatus: WSStatus) {
    if (this.status === newStatus) return

    const prev = this.status
    this.status = newStatus

    // Side-effects on entry into certain states
    if (newStatus === 'connected') {
      this.reconnectAttempts = 0 // reset backoff on successful connection
    }

    // Notify listeners
    for (const handler of this.statusHandlers) {
      try {
        handler(newStatus)
      } catch (err) {
        console.error(`[WS] Status handler error:`, err)
      }
    }
  }

  // ─── Private: Message Handling ────────────────────────────────────────

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      // ── Auth success ───────────────────────────────────────────────
      case 'auth:success': {
        console.log(`[WS] Authenticated as ${msg.userId}`)
        this.authResolved = true

        // Auto re-subscribe to all remembered channels
        this.resubscribeAll()

        // Flush any pending subscribe/unsubscribe messages (may include new
        // subscribes queued during reconnect, or unsubscribes that remove
        // channels from the remembered set)
        this.flushPendingSubscribeQueue()

        // Flush one-shot messages queued while disconnected
        this.flushOneShotQueue()

        this.transitionTo('connected')
        break
      }

      // ── Auth failure (treated as error, then reconnect) ───────────
      case 'error': {
        console.warn(`[WS] Server error: ${msg.message}`)

        // If error happens during auth, treat as auth failure
        if (this.status === 'authenticating') {
          // Will be handled by onclose which fires after server closes
        }

        // Dispatch to error handlers if registered
        const errorHandlers = this.handlers.get('error')
        if (errorHandlers) {
          for (const handler of errorHandlers) {
            try { handler({ message: msg.message }) } catch (err) {
              console.error(`[WS] Error handler error:`, err)
            }
          }
        }
        break
      }

      // ── Acknowledgement (no action needed) ────────────────────────
      case 'upstox_token_set':
        break

      // ── All other messages → route to registered handlers ────────
      default: {
        const typeHandlers = this.handlers.get(msg.type)
        if (typeHandlers) {
          for (const handler of typeHandlers) {
            try { handler(msg.data) } catch (err) {
              console.error(`[WS] Handler error for "${msg.type}":`, err)
            }
          }
        }
        break
      }
    }
  }

  // ─── Subscribe / Unsubscribe ──────────────────────────────────────────

  subscribe(channel: string, params?: any) {
    // Always remember the subscription
    this.subscribedChannels.set(channel, params)

    const msg = { type: 'subscribe' as const, channel, ...(params ? { params } : {}) }

    if (this.status === 'connected' && this.authResolved && this.ws?.readyState === WebSocket.OPEN) {
      this.sendNow(msg)
    } else {
      // Queue for when we're ready
      this.pendingSubscribeQueue.push(msg)
    }
  }

  unsubscribe(channel: string) {
    // Remove from remembered subscriptions
    this.subscribedChannels.delete(channel)

    const msg = { type: 'unsubscribe' as const, channel }

    if (this.status === 'connected' && this.authResolved && this.ws?.readyState === WebSocket.OPEN) {
      this.sendNow(msg)
    } else {
      // Queue for when we're ready
      this.pendingSubscribeQueue.push(msg)
    }
  }

  /** Re-send subscribe for all remembered channels. Called on reconnect after auth. */
  private resubscribeAll() {
    for (const [channel, params] of this.subscribedChannels) {
      const msg = { type: 'subscribe' as const, channel, ...(params ? { params } : {}) }
      this.sendNow(msg)
    }
  }

  /**
   * Flush queued subscribe/unsubscribe messages. Called after auth:success.
   * Deduplicates: only sends a subscribe if the channel is still in
   * subscribedChannels, and only sends an unsubscribe if it was removed.
   */
  private flushPendingSubscribeQueue() {
    const queue = this.pendingSubscribeQueue
    this.pendingSubscribeQueue = []
    for (const msg of queue) {
      const type = (msg as any).type
      const channel = (msg as any).channel

      if (type === 'subscribe') {
        // Only send if still wanted (not unsubscribed in the meantime)
        if (this.subscribedChannels.has(channel)) {
          this.sendNow(msg)
        }
      } else if (type === 'unsubscribe') {
        // Only send if we're actually subscribed (resubscribeAll may have
        // already sent a subscribe for this channel on this connection)
        if (!this.subscribedChannels.has(channel)) {
          this.sendNow(msg)
        }
      } else {
        this.sendNow(msg)
      }
    }
  }

  // ─── Public Send ──────────────────────────────────────────────────────

  /**
   * Send an arbitrary message. If ws is not OPEN, the message is queued
   * and sent as soon as the connection opens. Non-subscription messages
   * are one-shot — they are NOT re-sent on reconnect.
   */
  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendNow(msg)
    } else {
      this.pendingOneShotQueue.push(msg)
    }
  }

  // ─── Private: Low-level Send ─────────────────────────────────────────

  private sendNow(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      // Connection isn't open — shouldn't happen in normal flow,
      // but queue as a one-shot message as a fallback
      this.pendingOneShotQueue.push(msg)
    }
  }

  /** Flush one-shot messages when ws opens. */
  private flushOneShotQueue() {
    const queue = this.pendingOneShotQueue
    this.pendingOneShotQueue = []
    for (const msg of queue) {
      this.sendNow(msg)
    }
  }

  // ─── Event Registration ───────────────────────────────────────────────

  /** Register a handler for a specific server message type. Returns cleanup fn. */
  on(type: string, handler: MsgHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /** Register a status change handler. Returns cleanup fn. */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  // ─── Status Accessors ─────────────────────────────────────────────────

  getStatus(): WSStatus {
    return this.status
  }

  isConnected(): boolean {
    return this.status === 'connected'
  }

  getToken(): string | null {
    return this.token
  }

  /** Get the current number of reconnect attempts (useful for UI feedback). */
  getReconnectAttempt(): number {
    return this.reconnectAttempts
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────

export const wsClient = new WebSocketClient()