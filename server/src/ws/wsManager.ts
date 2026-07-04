/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WebSocket Manager — Production-grade real-time market data hub
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   - Central Subscription Manager: Map<channel, Set<ClientConnection>>
 *     Keys: "market", "positions", "oc:NIFTY::2026-07-07"
 *   - Optimized Broadcast Engine: JSON.stringify ONCE per broadcast
 *   - Single MarketDataService instance (always running, keeps cache warm)
 *   - MarketDerivedService piggybacks on market data (throttled to 3 s)
 *   - PositionsService: per-user, event-driven with dirty flag
 *   - OptionChainService: per underlying+expiry, one shared poll
 *   - AutoExitService: always-on 500 ms engine when SL/Target positions exist
 *
 * Protocol (unchanged):
 *   Client → Server:  { type: "auth",                  token: "jwt..." }
 *   Client → Server:  { type: "subscribe",              channel: "market" | "positions" | "options", ...params }
 *   Client → Server:  { type: "unsubscribe",            channel: "market" | "positions" | "options" }
 *   Client → Server:  { type: "set_upstox_token",       token: "..." }
 *   Server → Client:  { type: "market:update" | "market:initial", data: {...} }
 *   Server → Client:  { type: "positions",  data: [...] }
 *   Server → Client:  { type: "exit",      data: {...} }
 *   Server → Client:  { type: "options:update", data: {...} }
 *   Server → Client:  { type: "market:derived", data: { gainers, losers, breadth, marketStatus, sectors } }
 *   Server → Client:  { type: "auth:success" }
 *   Server → Client:  { type: "upstox_token_set", success: true }
 *   Server → Client:  { type: "error", message: "..." }
 */

import WebSocket from 'ws'
import { verifyToken, getTokenFromAuthHeader } from '../lib/auth'
import { cache, CacheKeys, CacheTTL } from '../lib/cache'
import { db } from '../lib/db'
import { MarketDataService } from '../services/marketData'
import { MarketDerivedService } from '../services/marketDerived'
import { PositionsService } from '../services/positions'
import { OptionChainService } from '../services/optionChain'
import { AutoExitService } from '../services/autoExit'
import { setUpstoxToken, getUpstoxToken } from '../lib/token-provider'

// ─── Client Connection Interface ────────────────────────────────────────

export interface ClientConnection {
  ws: WebSocket
  userId: string | null
  isAuthenticated: boolean
  /** Subscription-map keys this client is subscribed to (e.g. "market", "positions", "oc:NIFTY::2026-07-07") */
  subscriptions: Set<string>
  lastPing: number
  /** Channel key → params (e.g. "oc:NIFTY::2026-07-07" → { underlying, expiry }) */
  params: Map<string, any>
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Build the canonical option-chain subscription key. */
function ocKey(underlying: string, expiry: string): string {
  return `oc:${underlying.toUpperCase()}::${expiry}`
}

/** Parse an option-chain subscription key back into its parts, or null. */
function parseOCKey(key: string): { underlying: string; expiry: string } | null {
  const m = key.match(/^oc:([^:]+)::(.+)$/)
  return m ? { underlying: m[1], expiry: m[2] } : null
}

// ─── WebSocket Manager ──────────────────────────────────────────────────

export class WebSocketManager {
  private wss: WebSocket.Server

  // ── Central Subscription Manager ─────────────────────────────────
  // Keys: "market", "positions", "oc:NIFTY::2026-07-07"
  private subscriptions = new Map<string, Set<ClientConnection>>()

  // ── Client Registry (ws → client) ───────────────────────────────
  private clients = new Map<WebSocket, ClientConnection>()

  // ── Per-user Connection Counter ─────────────────────────────────
  // When count drops to 0 the user has no live WS connections.
  private userConnectionCount = new Map<string, number>()

  // ── Services (public so index.ts can wire setMarketService etc.) ─
  readonly marketService: MarketDataService
  readonly positionsService: PositionsService
  readonly optionChainService: OptionChainService
  readonly autoExitService: AutoExitService
  private marketDerivedService: MarketDerivedService

  // ── Derived-data Throttle ───────────────────────────────────────
  private lastDerivedBroadcast = 0
  private readonly DERIVED_THROTTLE_MS = 3000

  // ── Timers ──────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private statsLogTimer: ReturnType<typeof setInterval> | null = null

  // ──────────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────────

  constructor(wss: WebSocket.Server) {
    this.wss = wss

    // ── Instantiate services ─────────────────────────────────────
    this.marketService = new MarketDataService()
    this.positionsService = new PositionsService()
    this.optionChainService = new OptionChainService()
    this.autoExitService = new AutoExitService(this.positionsService, this.optionChainService)

    // ── MarketDerivedService with a throttled broadcast wrapper ──
    this.marketDerivedService = new MarketDerivedService(
      this.marketService,
      (channel: string, data: object) => {
        // Only throttle market:derived (the only thing MarketDerivedService sends)
        if (channel === 'market') {
          const now = Date.now()
          if (now - this.lastDerivedBroadcast < this.DERIVED_THROTTLE_MS) return
          this.lastDerivedBroadcast = now
        }
        this.broadcast(channel, data)
      },
    )

    // ── Keep MarketDataService onUpdate callbacks alive ──────────
    // MarketDataService only fires onUpdate callbacks when its internal
    // client set is non-empty.  We insert a single "sentinel" client
    // whose ws.readyState is never OPEN so it never receives data,
    // but ensures callbacks fire on every poll tick.
    const sentinel: ClientConnection = {
      ws: { readyState: 0, send: () => {} } as unknown as WebSocket,
      userId: null,
      isAuthenticated: false,
      subscriptions: new Set(),
      lastPing: 0,
      params: new Map(),
    }
    this.marketService.addClient(sentinel)

    // ── Override clientCount for MarketDerivedService ────────────
    // MarketDerivedService checks clientCount to decide whether to
    // compute.  Make it read from our central subscription map.
    Object.defineProperty(this.marketService, 'clientCount', {
      get: () => this.getChannelSubscriberCount('market'),
      configurable: true,
    })

    // ── Reduce market poll interval to 1 s (from 500 ms) ───────
    ;(this.marketService as any).baseInterval = 1000

    // ── Register wsManager's own market data broadcast callback ─
    // Every successful market poll flows through here.  We broadcast
    // once to all "market" subscribers via the central engine.
    this.marketService.onUpdate((stocks, indices) => {
      this.broadcast('market', {
        type: 'market:update',
        data: {
          indices: { ...indices },
          stocks: { ...stocks },
          timestamp: Date.now(),
          source: this.marketService.source,
        },
      })
    })

    // ── Wire everything up ──────────────────────────────────────
    this.setupConnectionHandler()
    this.setupHeartbeat()
    this.startServices()

    console.log('[WS Manager] Initialized — central subscription manager active')
  }

  // ──────────────────────────────────────────────────────────────────
  // Connection Handler
  // ──────────────────────────────────────────────────────────────────

  private setupConnectionHandler(): void {
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

      // ── Try immediate auth via query param or Authorization header ──
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const token =
        url.searchParams.get('token') ||
        getTokenFromAuthHeader(req.headers.authorization)

      if (token) {
        this.authenticateClient(client, token)
      } else {
        // Wait 10 s for an auth message, then disconnect
        const authTimeout = setTimeout(() => {
          if (!client.isAuthenticated) {
            this.send(ws, {
              type: 'error',
              message:
                'Authentication timeout. Provide token via query param or auth message.',
            })
            ws.close(4001, 'Auth timeout')
          }
        }, 10_000)
        ws.on('close', () => clearTimeout(authTimeout))
      }

      // ── Inbound messages ──
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          this.handleMessage(client, msg)
        } catch {
          this.send(ws, { type: 'error', message: 'Invalid JSON' })
        }
      })

      // ── Disconnect ──
      ws.on('close', () => this.handleDisconnect(ws))

      // ── WebSocket pong (heartbeat response) ──
      ws.on('pong', () => {
        client.lastPing = Date.now()
      })

      console.log(
        `[WS Manager] Client connected. Total: ${this.clients.size}`,
      )
    })
  }

  // ──────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────

  private async authenticateClient(
    client: ClientConnection,
    token: string,
  ): Promise<void> {
    // 1. Check in-memory auth cache
    const cached = cache.get<{ userId: string; isActive: boolean }>(
      CacheKeys.auth(token),
    )
    if (cached && cached.isActive) {
      client.userId = cached.userId
      client.isAuthenticated = true
      this.incrementUserConnectionCount(cached.userId)
      this.send(client.ws, { type: 'auth:success', userId: cached.userId })
      return
    }

    // 2. Verify JWT
    const payload = verifyToken(token)
    if (!payload) {
      this.send(client.ws, {
        type: 'error',
        message: 'Invalid or expired token',
      })
      return
    }

    // 3. Validate session in DB
    try {
      const session = await db.session.findUnique({ where: { token } })
      if (!session || session.expiresAt < new Date()) {
        cache.delete(CacheKeys.auth(token))
        this.send(client.ws, {
          type: 'error',
          message: 'Session expired. Please login again.',
        })
        return
      }

      const user = await db.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, isActive: true },
      })

      if (!user || !user.isActive) {
        cache.delete(CacheKeys.auth(token))
        this.send(client.ws, {
          type: 'error',
          message: 'User not found or deactivated',
        })
        return
      }

      // 4. Cache the auth result
      cache.set(
        CacheKeys.auth(token),
        { userId: payload.userId, isActive: true },
        CacheTTL.AUTH,
      )
      client.userId = payload.userId
      client.isAuthenticated = true
      this.incrementUserConnectionCount(payload.userId)
      this.send(client.ws, {
        type: 'auth:success',
        userId: payload.userId,
      })
    } catch (err) {
      console.error('[WS Manager] Auth error:', err)
      this.send(client.ws, { type: 'error', message: 'Authentication failed' })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Message Router
  // ──────────────────────────────────────────────────────────────────

  private handleMessage(client: ClientConnection, msg: any): void {
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
        this.handleSetUpstoxToken(client, msg.token)
        break

      default:
        this.send(client.ws, { type: 'error', message: `Unknown message type: ${msg.type}` })
        break
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Subscribe
  // ──────────────────────────────────────────────────────────────────

  private handleSubscribe(
    client: ClientConnection,
    channel: string,
    params?: any,
  ): void {
    if (!channel) return

    switch (channel) {
      case 'market':
        this.subscribeToMarket(client)
        break
      case 'positions':
        this.subscribeToPositions(client)
        break
      case 'options':
        if (params?.underlying && params?.expiry) {
          this.subscribeToOptionChain(
            client,
            params.underlying,
            params.expiry,
          )
        } else {
          this.send(client.ws, {
            type: 'error',
            message: 'options channel requires underlying and expiry params',
          })
        }
        break
      default:
        this.send(client.ws, {
          type: 'error',
          message: `Unknown channel: ${channel}`,
        })
    }
  }

  /** Subscribe a client to real-time market data. */
  private subscribeToMarket(client: ClientConnection): void {
    this.addToSubscription('market', client)
    console.log(`[WS Manager] User ${client.userId} subscribed to market`)

    // Send initial cached market data (same as market:initial)
    const cached = cache.get<any>(CacheKeys.marketLive())
    if (cached) {
      this.send(client.ws, { type: 'market:initial', data: cached })
    }

    // Send latest derived data immediately if available
    const derived = this.marketDerivedService.getLatestData()
    if (derived) {
      this.send(client.ws, { type: 'market:derived', data: derived })
    }
  }

  /** Subscribe a client to their own position updates. */
  private subscribeToPositions(client: ClientConnection): void {
    this.addToSubscription('positions', client)
    console.log(`[WS Manager] User ${client.userId} subscribed to positions`)

    // PositionsService manages per-user polling internally
    this.positionsService.addClient(client)
    this.autoExitService.ensureRunning()
  }

  /** Subscribe a client to a specific option-chain underlying+expiry. */
  private subscribeToOptionChain(
    client: ClientConnection,
    underlying: string,
    expiry: string,
  ): void {
    const key = ocKey(underlying, expiry)

    this.addToSubscription(key, client)
    client.params.set(key, { underlying, expiry })

    console.log(`[WS Manager] User ${client.userId} subscribed to ${key}`)

    // OptionChainService manages per-key polling internally
    this.optionChainService.addClient(client, underlying, expiry)

    // Async check for token availability — notify client if missing
    getUpstoxToken().then((token) => {
      if (!token) {
        this.send(client.ws, {
          type: 'options:error',
          message: 'UPSTOX_TOKEN_MISSING',
        })
      }
    })
  }

  // ──────────────────────────────────────────────────────────────────
  // Unsubscribe
  // ──────────────────────────────────────────────────────────────────

  private handleUnsubscribe(
    client: ClientConnection,
    channel: string,
  ): void {
    if (!channel) return

    switch (channel) {
      case 'market':
        this.unsubscribeFromMarket(client)
        break
      case 'positions':
        this.unsubscribeFromPositions(client)
        break
      case 'options':
        this.unsubscribeFromAllOptionChains(client)
        break
    }
  }

  private unsubscribeFromMarket(client: ClientConnection): void {
    this.removeFromSubscription('market', client)
    console.log(`[WS Manager] User ${client.userId} unsubscribed from market`)
  }

  private unsubscribeFromPositions(client: ClientConnection): void {
    this.removeFromSubscription('positions', client)
    this.positionsService.removeClient(client)
    console.log(
      `[WS Manager] User ${client.userId} unsubscribed from positions`,
    )
  }

  /** Remove the client from ALL option-chain subscriptions. */
  private unsubscribeFromAllOptionChains(client: ClientConnection): void {
    const ocKeys = [...client.subscriptions].filter((k) => k.startsWith('oc:'))
    for (const key of ocKeys) {
      this.removeFromSubscription(key, client)
      client.params.delete(key)
    }
    this.optionChainService.removeClient(client)
    console.log(
      `[WS Manager] User ${client.userId} unsubscribed from all option chains`,
    )
  }

  // ──────────────────────────────────────────────────────────────────
  // Disconnect
  // ──────────────────────────────────────────────────────────────────

  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws)
    if (!client) return

    const userId = client.userId

    // 1. Notify services so they can stop per-user / per-key polling
    //    These methods are idempotent — safe even if client never subscribed.
    this.positionsService.removeClient(client)
    this.optionChainService.removeClient(client)

    // 2. Remove from central subscription map (snapshot to avoid
    //    concurrent-modification while iterating)
    const subsSnapshot = [...client.subscriptions]
    for (const channel of subsSnapshot) {
      const subs = this.subscriptions.get(channel)
      if (subs) {
        subs.delete(client)
        if (subs.size === 0) {
          this.subscriptions.delete(channel)
        }
      }
    }
    client.subscriptions.clear()
    client.params.clear()

    // 3. Remove from client registry
    this.clients.delete(ws)

    // 4. Decrement per-user connection counter
    if (userId) {
      this.decrementUserConnectionCount(userId)
    }

    console.log(
      `[WS Manager] Client disconnected. Total: ${this.clients.size}`,
    )
  }

  // ──────────────────────────────────────────────────────────────────
  // Central Subscription Map — Helpers
  // ──────────────────────────────────────────────────────────────────

  /** Add a client to a channel in the subscription map. */
  private addToSubscription(
    channel: string,
    client: ClientConnection,
  ): void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set())
    }
    this.subscriptions.get(channel)!.add(client)
    client.subscriptions.add(channel)
  }

  /** Remove a client from a channel in the subscription map. */
  private removeFromSubscription(
    channel: string,
    client: ClientConnection,
  ): void {
    const subs = this.subscriptions.get(channel)
    if (subs) {
      subs.delete(client)
      if (subs.size === 0) {
        this.subscriptions.delete(channel)
      }
    }
    client.subscriptions.delete(channel)
  }

  /** Get the number of subscribers for a channel. */
  getChannelSubscriberCount(channel: string): number {
    return this.subscriptions.get(channel)?.size ?? 0
  }

  // ──────────────────────────────────────────────────────────────────
  // Per-user Connection Counter
  // ──────────────────────────────────────────────────────────────────

  private incrementUserConnectionCount(userId: string): void {
    const count = (this.userConnectionCount.get(userId) ?? 0) + 1
    this.userConnectionCount.set(userId, count)
  }

  private decrementUserConnectionCount(userId: string): void {
    const count = (this.userConnectionCount.get(userId) ?? 1) - 1
    if (count <= 0) {
      this.userConnectionCount.delete(userId)
      // When a user has zero connections, it is safe to clear any
      // per-user caches.  PositionsService already handles this
      // internally when its last client for a user is removed.
    } else {
      this.userConnectionCount.set(userId, count)
    }
  }

  /** Check whether a user still has at least one active WebSocket connection. */
  hasUserConnections(userId: string): boolean {
    return (this.userConnectionCount.get(userId) ?? 0) > 0
  }

  // ──────────────────────────────────────────────────────────────────
  // set_upstox_token Handler
  // ──────────────────────────────────────────────────────────────────

  private handleSetUpstoxToken(
    client: ClientConnection,
    token: string | undefined,
  ): void {
    if (!client.isAuthenticated) {
      this.send(client.ws, { type: 'error', message: 'Authenticate first' })
      return
    }
    if (!token || typeof token !== 'string' || token.length <= 10) {
      this.send(client.ws, {
        type: 'error',
        message: 'Invalid token format',
      })
      return
    }

    // 1. Set token in token-provider (immediate effect on next getUpstoxToken call)
    setUpstoxToken(token)

    // 2. Persist to DB (fire-and-forget)
    db.platformSettings
      .upsert({
        where: { key: 'upstox_access_token' },
        update: { value: token },
        create: {
          key: 'upstox_access_token',
          value: token,
          description: 'Upstox token pushed via WebSocket',
        },
      })
      .then(() => {
        db.platformSettings
          .upsert({
            where: { key: 'upstox_token_obtained_at' },
            update: { value: new Date().toISOString() },
            create: {
              key: 'upstox_token_obtained_at',
              value: new Date().toISOString(),
              description: 'Token timestamp',
            },
          })
          .catch(() => {})
      })
      .catch(() => {})

    this.send(client.ws, { type: 'upstox_token_set', success: true })
    console.log(
      `[WS Manager] Upstox token set by user ${client.userId} (prefix: ${token.substring(0, 8)}...)`,
    )

    // 3. Immediately re-fetch option chain data for all active OC subscriptions
    this.triggerOCRefresh()
  }

  /** Trigger an immediate option-chain fetch for every active OC subscription. */
  private triggerOCRefresh(): void {
    for (const [key] of this.subscriptions) {
      const parsed = parseOCKey(key)
      if (!parsed) continue
      try {
        ;(this.optionChainService as any).fetchAndBroadcast(
          parsed.underlying,
          parsed.expiry,
        )
      } catch (err) {
        console.error(
          `[WS Manager] Failed to trigger OC refresh for ${key}:`,
          err,
        )
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Optimized Broadcast Engine
  // ──────────────────────────────────────────────────────────────────

  /**
   * Broadcast a message to all subscribers of a channel.
   *
   * JSON.stringify is called exactly ONCE — the resulting string is
   * reused for every client, eliminating per-client serialization cost.
   */
  broadcast(channel: string, data: object): void {
    const subscribers = this.subscriptions.get(channel)
    if (!subscribers || subscribers.size === 0) return

    const serialized = JSON.stringify(data)
    for (const client of subscribers) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(serialized)
        } catch {
          // Client may have disconnected between the readyState check
          // and the actual send.  The heartbeat loop will clean up.
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Point-to-Point Send
  // ──────────────────────────────────────────────────────────────────

  /** Send a message to a specific WebSocket (no serialization optimization — single recipient). */
  send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  /**
   * Send to ALL authenticated WebSocket connections belonging to a user.
   * Serializes once per call (a user typically has 1–3 tabs).
   */
  sendToUser(userId: string, data: object): void {
    const serialized = JSON.stringify(data)
    for (const [, client] of this.clients) {
      if (
        client.userId === userId &&
        client.isAuthenticated &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        try {
          client.ws.send(serialized)
        } catch {
          // ignore — heartbeat handles cleanup
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Heartbeat & Stats Logging
  // ──────────────────────────────────────────────────────────────────

  private setupHeartbeat(): void {
    // Ping every 25 s; disconnect clients that haven't responded in 60 s
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [ws, client] of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue

        // Stale connection — no pong received for 60 s
        if (now - client.lastPing > 60_000) {
          console.log(
            `[WS Manager] Disconnecting stale client ${client.userId || 'unauth'}`,
          )
          ws.terminate()
          continue
        }

        // Send WebSocket-level ping frame
        try {
          ws.ping()
        } catch {
          ws.terminate()
        }
      }
    }, 25_000)

    // Log connection counts every 60 s for ops visibility
    this.statsLogTimer = setInterval(() => {
      const total = this.clients.size
      const authed = [...this.clients.values()].filter(
        (c) => c.isAuthenticated,
      ).length

      const channelSummary: string[] = []
      for (const [ch, subs] of this.subscriptions) {
        channelSummary.push(`${ch}:${subs.size}`)
      }

      console.log(
        `[WS Manager] Heartbeat — connections: ${total} (authed: ${authed}), ` +
          `channels: [${channelSummary.join(', ')}]`,
      )
    }, 60_000)
  }

  // ──────────────────────────────────────────────────────────────────
  // Service Lifecycle
  // ──────────────────────────────────────────────────────────────────

  private startServices(): void {
    // Market data ALWAYS runs, even with 0 subscribers.
    // This keeps the in-memory cache warm and ensures the first
    // subscriber gets immediate data.
    this.marketService.start()

    // Derived data piggybacks on market data (no separate polling).
    // It registers its own onUpdate callback with MarketDataService
    // inside start().
    this.marketDerivedService.start().catch((err) => {
      console.error(
        '[WS Manager] Failed to start derived service:',
        err,
      )
    })

    console.log(
      '[WS Manager] Services started — market poll: 1 s, derived throttle: 3 s',
    )
  }

  // ──────────────────────────────────────────────────────────────────
  // Positions Dirty Flag (public API for trade endpoints)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Mark a user's positions as dirty, causing the next poll cycle to
   * re-fetch from DB instead of using cached data.
   *
   * Call this from trade-execution REST endpoints after a position is
   * created, modified, or closed so the WS client sees the change
   * immediately rather than waiting for the next safety poll.
   */
  markPositionsDirty(userId: string): void {
    const dirty = (this.positionsService as any)
      .positionsDirty as Map<string, boolean> | undefined
    if (dirty) {
      dirty.set(userId, true)
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Stats
  // ──────────────────────────────────────────────────────────────────

  /**
   * Basic stats — compatible with the existing /api/ws-stats endpoint.
   * Aggregates per-channel subscriber counts.
   */
  getStats(): {
    totalConnections: number
    authenticatedConnections: number
    channelStats: Record<string, number>
  } {
    const channelStats: Record<string, number> = {}

    for (const [ch, subs] of this.subscriptions) {
      if (ch.startsWith('oc:')) {
        // Aggregate all OC subscriptions under "options"
        channelStats['options'] =
          (channelStats['options'] ?? 0) + subs.size
      } else {
        channelStats[ch] = subs.size
      }
    }

    return {
      totalConnections: this.clients.size,
      authenticatedConnections: [...this.clients.values()].filter(
        (c) => c.isAuthenticated,
      ).length,
      channelStats,
    }
  }

  /**
   * Detailed subscription-map snapshot.
   * Returns the full map including individual OC keys and per-user counts.
   */
  getSubscriptionStats(): {
    totalClients: number
    authenticatedClients: number
    userConnectionCounts: Record<string, number>
    subscriptions: Record<string, { count: number; users: string[] }>
  } {
    const subscriptions: Record<
      string,
      { count: number; users: string[] }
    > = {}

    for (const [channel, subs] of this.subscriptions) {
      const userIds = new Set<string>()
      for (const client of subs) {
        if (client.userId) userIds.add(client.userId)
      }
      subscriptions[channel] = {
        count: subs.size,
        users: [...userIds],
      }
    }

    return {
      totalClients: this.clients.size,
      authenticatedClients: [...this.clients.values()].filter(
        (c) => c.isAuthenticated,
      ).length,
      userConnectionCounts: Object.fromEntries(this.userConnectionCount),
      subscriptions,
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Shutdown
  // ──────────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    // 1. Clear timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.statsLogTimer) {
      clearInterval(this.statsLogTimer)
      this.statsLogTimer = null
    }

    // 2. Close all client WebSocket connections gracefully
    for (const [ws] of this.clients) {
      try {
        ws.close(1001, 'Server shutting down')
      } catch {
        // already closed
      }
    }
    this.clients.clear()

    // 3. Stop services
    this.marketService.stop()
    this.marketDerivedService.stop()
    this.positionsService.stop()
    this.optionChainService.stop()
    this.autoExitService.stop()

    // 4. Clear all internal maps
    this.subscriptions.clear()
    this.userConnectionCount.clear()

    console.log('[WS Manager] Shutdown complete')
  }
}