/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WebSocket Manager — Connection handling, rooms, authentication
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Protocol:
 *   Client → Server:  { type: "auth", token: "jwt..." }
 *   Client → Server:  { type: "subscribe", channel: "market" | "positions" | "options", ...params }
 *   Client → Server:  { type: "unsubscribe", channel: "market" | "positions" | "options" }
 *   Server → Client:  { type: "market:update" | "market:initial", data: {...} }
 *   Server → Client:  { type: "positions", data: [...] }
 *   Server → Client:  { type: "exit", data: {...} }
 *   Server → Client:  { type: "options:update", data: {...} }
 *   Server → Client:  { type: "ping" }
 *   Server → Client:  { type: "error", message: "..." }
 *   Server → Client:  { type: "auth:success" }
 *   Server → Client:  { type: "upstox_token_set", success: true }
 *   Client → Server:  { type: "set_upstox_token", token: "..." }  (push Upstox token)
 */

import WebSocket from 'ws'
import { verifyToken, getTokenFromAuthHeader } from '../lib/auth'
import { cache, CacheKeys, CacheTTL } from '../lib/cache'
import { db } from '../lib/db'
import { MarketDataService } from '../services/marketData'
import { PositionsService } from '../services/positions'
import { OptionChainService } from '../services/optionChain'
import { AutoExitService } from '../services/autoExit'
import { setUpstoxToken } from '../lib/token-provider'

export interface ClientConnection {
  ws: WebSocket
  userId: string | null
  isAuthenticated: boolean
  subscriptions: Set<string>
  lastPing: number
  params: Map<string, any> // channel → params (e.g. options: { underlying, expiry })
}

export class WebSocketManager {
  private wss: WebSocket.Server
  private clients = new Map<WebSocket, ClientConnection>()
  private marketService: MarketDataService
  private positionsService: PositionsService
  private optionChainService: OptionChainService
  private autoExitService: AutoExitService

  constructor(wss: WebSocket.Server) {
    this.wss = wss
    this.marketService = new MarketDataService()
    this.positionsService = new PositionsService()
    this.optionChainService = new OptionChainService()
    this.autoExitService = new AutoExitService(this.positionsService, this.optionChainService)

    this.setupConnectionHandler()
    this.setupHeartbeat()
    this.startServices()

    console.log('[WS Manager] Initialized')
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const client: ClientConnection = {
        ws,
        userId: null,
        isAuthenticated: false,
        subscriptions: new Set(),
        lastPing: Date.now(),
        params: new Map(),
      }
      this.clients.set(ws, client)

      // Check for token in query string or wait for auth message
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const token = url.searchParams.get('token') || getTokenFromAuthHeader(req.headers.authorization)

      if (token) {
        this.authenticateClient(client, token)
      } else {
        // Wait 10s for auth message, then disconnect
        const authTimeout = setTimeout(() => {
          if (!client.isAuthenticated) {
            this.send(ws, { type: 'error', message: 'Authentication timeout. Provide token via query param or auth message.' })
            ws.close(4001, 'Auth timeout')
          }
        }, 10000)
        ws.on('close', () => clearTimeout(authTimeout))
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          this.handleMessage(client, msg)
        } catch {
          this.send(ws, { type: 'error', message: 'Invalid JSON' })
        }
      })

      ws.on('close', () => {
        this.handleDisconnect(ws)
      })

      ws.on('pong', () => {
        client.lastPing = Date.now()
      })

      console.log(`[WS Manager] Client connected. Total: ${this.clients.size}`)
    })
  }

  private async authenticateClient(client: ClientConnection, token: string) {
    // Check cache first
    const cached = cache.get<{ userId: string; isActive: boolean }>(CacheKeys.auth(token))
    if (cached && cached.isActive) {
      client.userId = cached.userId
      client.isAuthenticated = true
      this.send(client.ws, { type: 'auth:success', userId: cached.userId })
      return
    }

    // Verify JWT
    const payload = verifyToken(token)
    if (!payload) {
      this.send(client.ws, { type: 'error', message: 'Invalid or expired token' })
      return
    }

    // Check session in DB
    try {
      const session = await db.session.findUnique({ where: { token } })
      if (!session || session.expiresAt < new Date()) {
        cache.delete(CacheKeys.auth(token))
        this.send(client.ws, { type: 'error', message: 'Session expired. Please login again.' })
        return
      }

      const user = await db.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, isActive: true },
      })

      if (!user || !user.isActive) {
        cache.delete(CacheKeys.auth(token))
        this.send(client.ws, { type: 'error', message: 'User not found or deactivated' })
        return
      }

      cache.set(CacheKeys.auth(token), { userId: payload.userId, isActive: true }, CacheTTL.AUTH)
      client.userId = payload.userId
      client.isAuthenticated = true
      this.send(client.ws, { type: 'auth:success', userId: payload.userId })
    } catch (err) {
      console.error('[WS Manager] Auth error:', err)
      this.send(client.ws, { type: 'error', message: 'Authentication failed' })
    }
  }

  private handleMessage(client: ClientConnection, msg: any) {
    switch (msg.type) {
      case 'auth':
        if (msg.token) this.authenticateClient(client, msg.token)
        break

      case 'subscribe':
        if (!client.isAuthenticated) {
          this.send(client.ws, { type: 'error', message: 'Authenticate first' })
          return
        }
        this.handleSubscribe(client, msg.channel, msg.params)
        break

      case 'unsubscribe':
        this.handleUnsubscribe(client, msg.channel)
        break

      case 'pong':
        client.lastPing = Date.now()
        break

      case 'set_upstox_token':
        // Allow authenticated users to push Upstox token from frontend
        if (!client.isAuthenticated) {
          this.send(client.ws, { type: 'error', message: 'Authenticate first' })
          return
        }
        if (msg.token && typeof msg.token === 'string' && msg.token.length > 10) {
          setUpstoxToken(msg.token)
          // Also persist to DB
          db.platformSettings.upsert({
            where: { key: 'upstox_access_token' },
            update: { value: msg.token },
            create: { key: 'upstox_access_token', value: msg.token, description: 'Upstox token pushed via WebSocket' },
          }).then(() => {
            db.platformSettings.upsert({
              where: { key: 'upstox_token_obtained_at' },
              update: { value: new Date().toISOString() },
              create: { key: 'upstox_token_obtained_at', value: new Date().toISOString(), description: 'Token timestamp' },
            }).catch(() => {})
          }).catch(() => {})
          this.send(client.ws, { type: 'upstox_token_set', success: true })
          console.log(`[WS Manager] Upstox token set by user ${client.userId} via WS (prefix: ${msg.token.substring(0, 8)}...)`)
        } else {
          this.send(client.ws, { type: 'error', message: 'Invalid token format' })
        }
        break
    }
  }

  private handleSubscribe(client: ClientConnection, channel: string, params?: any) {
    if (!channel) return

    client.subscriptions.add(channel)
    if (params) client.params.set(channel, params)

    console.log(`[WS Manager] User ${client.userId} subscribed to ${channel}`)

    // Start relevant services and attach client as listener
    switch (channel) {
      case 'market':
        this.marketService.addClient(client)
        break

      case 'positions':
        this.positionsService.addClient(client)
        this.autoExitService.ensureRunning()
        break

      case 'options':
        if (params?.underlying && params?.expiry) {
          this.optionChainService.addClient(client, params.underlying, params.expiry)
          // Async check for token availability — notify client if missing
          import('../lib/token-provider').then(({ getUpstoxToken }) =>
            getUpstoxToken().then(token => {
              if (!token) this.send(client.ws, { type: 'options:error', message: 'UPSTOX_TOKEN_MISSING' })
            })
          )
        }
        break
    }
  }

  private handleUnsubscribe(client: ClientConnection, channel: string) {
    client.subscriptions.delete(channel)
    client.params.delete(channel)

    switch (channel) {
      case 'market':
        this.marketService.removeClient(client)
        break
      case 'positions':
        this.positionsService.removeClient(client)
        break
      case 'options':
        this.optionChainService.removeClient(client)
        break
    }
  }

  private handleDisconnect(ws: WebSocket) {
    const client = this.clients.get(ws)
    if (!client) return

    // Unsubscribe from all channels
    for (const channel of client.subscriptions) {
      this.handleUnsubscribe(client, channel)
    }

    this.clients.delete(ws)
    console.log(`[WS Manager] Client disconnected. Total: ${this.clients.size}`)
  }

  private setupHeartbeat() {
    // Ping clients every 25 seconds, disconnect stale after 60s
    setInterval(() => {
      const now = Date.now()
      for (const [ws, client] of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue

        // Check if stale
        if (now - client.lastPing > 60000) {
          console.log(`[WS Manager] Disconnecting stale client ${client.userId}`)
          ws.terminate()
          continue
        }

        // Send ping
        try {
          ws.ping()
        } catch {
          ws.terminate()
        }
      }
    }, 25000)
  }

  private startServices() {
    // Market data always runs (shared across all clients)
    this.marketService.start()
    console.log('[WS Manager] All services started')
  }

  send(ws: WebSocket, data: object) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  /** Broadcast to all authenticated clients subscribed to a channel */
  broadcast(channel: string, data: object) {
    for (const [ws, client] of this.clients) {
      if (client.isAuthenticated && client.subscriptions.has(channel)) {
        this.send(ws, data)
      }
    }
  }

  /** Send to a specific user */
  sendToUser(userId: string, data: object) {
    for (const [ws, client] of this.clients) {
      if (client.userId === userId && client.isAuthenticated) {
        this.send(ws, data)
      }
    }
  }

  getStats() {
    return {
      totalConnections: this.clients.size,
      authenticatedConnections: [...this.clients.values()].filter(c => c.isAuthenticated).length,
      channelStats: {
        market: [...this.clients.values()].filter(c => c.subscriptions.has('market')).length,
        positions: [...this.clients.values()].filter(c => c.subscriptions.has('positions')).length,
        options: [...this.clients.values()].filter(c => c.subscriptions.has('options')).length,
      },
    }
  }

  async shutdown() {
    // Close all connections
    for (const [ws] of this.clients) {
      try { ws.close(1001, 'Server shutting down') } catch {}
    }
    this.clients.clear()

    // Stop services
    this.marketService.stop()
    this.positionsService.stop()
    this.optionChainService.stop()
    this.autoExitService.stop()

    console.log('[WS Manager] Shutdown complete')
  }
}