import { WebSocketServer as WSServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { URL } from 'url'
import { verifyToken, type JwtPayload } from '../lib/auth.js'
import { logger } from '../lib/logger.js'
import { type ConnectedClient, type ClientMessage, type ServerMessage } from './types.js'

export type ChannelEvent = {
  action: 'subscribe' | 'unsubscribe'
  channel: string
  userId: string
  clientId: string
}

export class PepertectWebSocketServer {
  private wss: WSServer
  private clients: Map<string, ConnectedClient> = new Map()  // clientId → client
  private userClients: Map<string, Set<string>> = new Map()  // userId → Set of clientIds
  private channelSubscribers: Map<string, Set<string>> = new Map()  // channel → Set of clientIds
  private heartbeatInterval: ReturnType<typeof setInterval>
  private nextClientId = 0
  private channelListeners: ((event: ChannelEvent) => void)[] = []

  constructor(wss: WSServer) {
    this.wss = wss
    this.setupConnectionHandler()
    this.heartbeatInterval = setInterval(() => this.heartbeat(), 30_000)
  }

  /** Register a callback for channel subscribe/unsubscribe events */
  onChannelChange(listener: (event: ChannelEvent) => void): () => void {
    this.channelListeners.push(listener)
    return () => {
      this.channelListeners = this.channelListeners.filter(l => l !== listener)
    }
  }

  /** Get the set of active channel names */
  getActiveChannels(): string[] {
    return [...this.channelSubscribers.keys()].filter(ch => (this.channelSubscribers.get(ch)?.size ?? 0) > 0)
  }

  // ─── Client ID Generation ────────────────────────────────────────────

  private generateClientId(): string {
    return `client_${++this.nextClientId}_${Date.now()}`
  }

  // ─── Connection Lifecycle ────────────────────────────────────────────

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = this.generateClientId()

      // Extract token from URL query params: /ws?token=xxx
      let token: string | null = null
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        token = url.searchParams.get('token')
      } catch {
        // Malformed URL — token stays null, auth will fail below
      }

      // Build client record (unauthenticated until token verified)
      const client: ConnectedClient = {
        id: clientId,
        ws,
        userId: '',
        userEmail: '',
        userRole: '',
        channels: new Set(),
        isAuthenticated: false,
        lastPing: Date.now(),
        isConnected: true,
      }

      this.clients.set(clientId, client)

      // ── Authenticate ──────────────────────────────────────────────────
      if (token) {
        const payload = verifyToken(token)
        if (payload) {
          client.isAuthenticated = true
          client.userId = payload.userId
          client.userEmail = payload.email
          client.userRole = payload.role

          // Register in user→clients map (supports multiple tabs/devices)
          if (!this.userClients.has(payload.userId)) {
            this.userClients.set(payload.userId, new Set())
          }
          this.userClients.get(payload.userId)!.add(clientId)

          this.send(client, { type: 'auth:success', data: { userId: payload.userId } })
          logger.info(`[WS] Client ${clientId} authenticated: ${payload.email}`)
        } else {
          this.send(client, { type: 'auth:error', data: { message: 'Invalid or expired token' } })
          logger.warn(`[WS] Client ${clientId} auth failed: invalid token`)
        }
      } else {
        this.send(client, { type: 'auth:error', data: { message: 'No token provided' } })
        logger.warn(`[WS] Client ${clientId} connected without token`)
      }

      // ── Inbound message handler ──────────────────────────────────────
      ws.on('message', (raw: Buffer) => {
        try {
          const msg: ClientMessage = JSON.parse(raw.toString())
          this.handleMessage(client, msg)
        } catch (err) {
          logger.error(`[WS] Parse error from ${clientId}:`, err)
        }
      })

      // ── Close handler ────────────────────────────────────────────────
      ws.on('close', () => {
        this.removeClient(clientId)
      })

      // ── Error handler ────────────────────────────────────────────────
      ws.on('error', (err) => {
        logger.error(`[WS] Error from ${clientId}:`, err.message)
        this.removeClient(clientId)
      })
    })
  }

  // ─── Message Routing ─────────────────────────────────────────────────

  private handleMessage(client: ConnectedClient, msg: ClientMessage) {
    switch (msg.type) {
      case 'ping':
        client.lastPing = Date.now()
        this.send(client, { type: 'pong' })
        break

      case 'subscribe':
        if (!client.isAuthenticated) return
        for (const channel of msg.channels) {
          client.channels.add(channel)
          if (!this.channelSubscribers.has(channel)) {
            this.channelSubscribers.set(channel, new Set())
          }
          this.channelSubscribers.get(channel)!.add(client.id)
          // Notify channel listeners
          for (const listener of this.channelListeners) {
            try { listener({ action: 'subscribe', channel, userId: client.userId, clientId: client.id }) } catch {}
          }
        }
        this.send(client, { type: 'subscribed', data: { channels: msg.channels } })
        logger.debug(`[WS] ${client.id} subscribed to: ${msg.channels.join(', ')}`)
        break

      case 'unsubscribe':
        for (const channel of msg.channels) {
          client.channels.delete(channel)
          this.channelSubscribers.get(channel)?.delete(client.id)
          // Notify channel listeners
          for (const listener of this.channelListeners) {
            try { listener({ action: 'unsubscribe', channel, userId: client.userId, clientId: client.id }) } catch {}
          }
        }
        this.send(client, { type: 'unsubscribed', data: { channels: msg.channels } })
        break
    }
  }

  // ─── Heartbeat / Keepalive ───────────────────────────────────────────

  private heartbeat() {
    const now = Date.now()
    for (const [id, client] of this.clients) {
      if (!client.isConnected) continue

      // Terminate stale connections (no activity for 90 s)
      if (now - client.lastPing > 90_000) {
        logger.info(`[WS] Heartbeat timeout: ${id}`)
        client.ws.terminate()
        this.removeClient(id)
      } else {
        // Send WebSocket-level ping frame to probe liveness
        try {
          client.ws.ping()
        } catch {
          this.removeClient(id)
        }
      }
    }
  }

  // ─── Client Removal ──────────────────────────────────────────────────

  private removeClient(clientId: string) {
    const client = this.clients.get(clientId)
    if (!client) return

    client.isConnected = false

    // Remove from user→clients index
    if (client.userId) {
      const userSet = this.userClients.get(client.userId)
      if (userSet) {
        userSet.delete(clientId)
        if (userSet.size === 0) {
          this.userClients.delete(client.userId)
        }
      }
    }

    // Remove from all channel subscriber sets and notify listeners
    for (const channel of client.channels) {
      this.channelSubscribers.get(channel)?.delete(clientId)
      // Notify channel listeners about cleanup
      const subs = this.channelSubscribers.get(channel)?.size ?? 0
      if (subs === 0 && client.userId) {
        for (const listener of this.channelListeners) {
          try { listener({ action: 'unsubscribe', channel, userId: client.userId, clientId }) } catch {}
        }
      }
    }

    this.clients.delete(clientId)
    try { client.ws.close() } catch { /* already closed */ }
    logger.info(`[WS] Client disconnected: ${clientId} (${this.clients.size} active)`)
  }

  // ─── Public API: Send to specific client ─────────────────────────────

  send(client: ConnectedClient, msg: ServerMessage) {
    if (!client.isConnected) return
    try {
      client.ws.send(JSON.stringify(msg))
    } catch {
      this.removeClient(client.id)
    }
  }

  // ─── Public API: Broadcast to a channel ──────────────────────────────

  broadcast(channel: string, msg: ServerMessage) {
    const subscribers = this.channelSubscribers.get(channel)
    if (!subscribers || subscribers.size === 0) return

    const data = JSON.stringify(msg)
    for (const clientId of subscribers) {
      const client = this.clients.get(clientId)
      if (client?.isConnected) {
        try { client.ws.send(data) } catch { this.removeClient(clientId) }
      }
    }
  }

  // ─── Public API: Send to all connections of a specific user ──────────

  sendToUser(userId: string, msg: ServerMessage) {
    const clientIds = this.userClients.get(userId)
    if (!clientIds) return

    const data = JSON.stringify(msg)
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (client?.isConnected) {
        try { client.ws.send(data) } catch { this.removeClient(clientId) }
      }
    }
  }

  // ─── Public API: Broadcast to every authenticated client ─────────────

  broadcastAll(msg: ServerMessage) {
    const data = JSON.stringify(msg)
    for (const [id, client] of this.clients) {
      if (client.isAuthenticated && client.isConnected) {
        try { client.ws.send(data) } catch { this.removeClient(id) }
      }
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  getStats() {
    return {
      totalClients: this.clients.size,
      authenticatedClients: [...this.clients.values()].filter(c => c.isAuthenticated).length,
      channels: Object.fromEntries(
        [...this.channelSubscribers.entries()].map(([ch, subs]) => [ch, subs.size]),
      ),
    }
  }

  // ─── Teardown ────────────────────────────────────────────────────────

  destroy() {
    clearInterval(this.heartbeatInterval)
    for (const [id] of this.clients) {
      this.removeClient(id)
    }
    this.wss.close()
  }
}