/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Position Streamer — Real-time Position Updates via WebSocket
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces the old SSE /api/positions/stream endpoint.
 *
 * Architecture:
 *   WebSocket Client subscribes to "positions" channel
 *     → PositionStreamer.addUser(userId)
 *     → Starts polling for that user
 *     → On each poll: fetch positions from DB, resolve live prices, send via WS
 *     → On exit event from AutoExitWorker: queue and send with next poll
 *
 * Price Resolution (from cache, same logic as SSE version):
 *   EQUITY  → cache.stockPrice(symbol) → fallback MarketDataManager.stocks[symbol]
 *   FUTURES → cache.futurePrice(symbol)
 *   OPTIONS → 0 (client uses option chain data directly from oc:NIFTY::expiry channel)
 */

import { db } from '../lib/db.js'
import { cache, CacheKeys } from '../lib/cache.js'
import type { PepertectWebSocketServer } from '../ws/WebSocketServer.js'
import { getAutoExitWorker, type ExitEvent } from './auto-exit-worker.js'
import { getMarketDataManager } from './market-data-manager.js'
import { logger } from '../lib/logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PositionUpdate {
  positionId: string
  symbol: string
  segment: string
  optionType: string | null
  strikePrice: number | null
  expiryDate: string | null
  currentPrice: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  tradeDirection: string
  isOpen: boolean
  exitEvent?: {
    reason: string
    exitPrice: number
    pnl: number
    timestamp: number
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000 // 10 seconds per user

// ─── Singleton Class ───────────────────────────────────────────────────────

class PositionStreamer {
  private static instance: PositionStreamer | null = null

  private wsServer: PepertectWebSocketServer
  private userPollTimers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private userExitUnsubs: Map<string, () => void> = new Map()
  private exitEventQueues: Map<string, ExitEvent[]> = new Map()
  private globalExitUnsub: (() => void) | null = null

  private constructor(wsServer: PepertectWebSocketServer) {
    this.wsServer = wsServer
    this.subscribeToGlobalExitEvents()
  }

  static getInstance(wsServer: PepertectWebSocketServer): PositionStreamer {
    if (!PositionStreamer.instance) {
      PositionStreamer.instance = new PositionStreamer(wsServer)
    }
    return PositionStreamer.instance
  }

  // ─── User Subscription ─────────────────────────────────────────────────

  addUser(userId: string): void {
    if (this.userPollTimers.has(userId)) {
      logger.debug(`[PositionStreamer] User ${userId} already subscribed, skipping`)
      return
    }

    logger.info(`[PositionStreamer] User ${userId} subscribed to positions stream`)

    // Run first poll immediately
    this.pollUser(userId)

    // Start polling at configured interval
    const timer = setInterval(() => {
      this.pollUser(userId)
    }, POLL_INTERVAL_MS)

    this.userPollTimers.set(userId, timer)

    // Ensure exit event queue exists for this user
    if (!this.exitEventQueues.has(userId)) {
      this.exitEventQueues.set(userId, [])
    }

    // Set up per-user exit event subscriber
    const unsub = getAutoExitWorker().onExit((event: ExitEvent) => {
      if (event.userId === userId) {
        this.queueExitEvent(userId, event)
      }
    })
    this.userExitUnsubs.set(userId, unsub)
  }

  removeUser(userId: string): void {
    // Clear poll timer
    const timer = this.userPollTimers.get(userId)
    if (timer) {
      clearInterval(timer)
      this.userPollTimers.delete(userId)
    }

    // Unsubscribe from exit events
    const unsub = this.userExitUnsubs.get(userId)
    if (unsub) {
      unsub()
      this.userExitUnsubs.delete(userId)
    }

    // Clear exit event queue
    this.exitEventQueues.delete(userId)

    logger.info(`[PositionStreamer] User ${userId} unsubscribed from positions stream`)
  }

  // ─── Global Exit Event Subscription ────────────────────────────────────
  // Listens to ALL exit events and routes to the correct user's queue.
  // This is a catch-all — per-user subscribers also exist for immediate routing.

  private subscribeToGlobalExitEvents(): void {
    this.globalExitUnsub = getAutoExitWorker().onExit((event: ExitEvent) => {
      // Only queue if user is tracked (has an active subscription)
      if (this.userPollTimers.has(event.userId)) {
        this.queueExitEvent(event.userId, event)
      }
    })
  }

  private queueExitEvent(userId: string, event: ExitEvent): void {
    const queue = this.exitEventQueues.get(userId)
    if (queue) {
      queue.push(event)
    }
  }

  // ─── Poll Logic ────────────────────────────────────────────────────────

  private async pollUser(userId: string): Promise<void> {
    try {
      // 1. Fetch user's open positions from DB
      const positions = await db.position.findMany({
        where: { userId, isOpen: true },
        orderBy: { createdAt: 'desc' },
      })

      // 2. Resolve live prices and build update payloads
      const updates: PositionUpdate[] = positions.map(pos => {
        const currentPrice = this.resolveLivePrice(
          pos.segment,
          pos.symbol,
          pos.optionType,
          pos.strikePrice,
        )

        const unrealizedPnl = this.calculateUnrealizedPnl(
          pos.tradeDirection as string,
          pos.entryPrice,
          currentPrice,
          pos.quantity,
        )

        const unrealizedPnlPercent = pos.totalInvested > 0
          ? Math.round((unrealizedPnl / pos.totalInvested) * 10000) / 100
          : 0

        return {
          positionId: pos.id,
          symbol: pos.symbol,
          segment: pos.segment,
          optionType: pos.optionType,
          strikePrice: pos.strikePrice,
          expiryDate: pos.expiryDate ? new Date(pos.expiryDate).toISOString() : null,
          currentPrice,
          unrealizedPnl,
          unrealizedPnlPercent,
          tradeDirection: pos.tradeDirection,
          isOpen: true,
        } satisfies PositionUpdate
      })

      // 3. Send positions:update message
      this.wsServer.sendToUser(userId, {
        type: 'positions:update',
        data: { positions: updates },
      })

      // 4. Check and send queued exit events
      this.flushExitEvents(userId, updates)

    } catch (err) {
      logger.error(
        `[PositionStreamer] Error polling positions for user ${userId}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  // ─── Exit Event Flushing ───────────────────────────────────────────────

  private flushExitEvents(userId: string, currentUpdates: PositionUpdate[]): void {
    const queue = this.exitEventQueues.get(userId)
    if (!queue || queue.length === 0) return

    // Drain the queue
    const events = queue.splice(0)

    for (const event of events) {
      // Build exit payload — attach to the matching position if it's still in the update list
      const matchingPosition = currentUpdates.find(u => u.positionId === event.positionId)

      this.wsServer.sendToUser(userId, {
        type: 'positions:exit',
        data: {
          positionId: event.positionId,
          symbol: event.symbol,
          segment: event.segment,
          reason: event.reason,
          exitPrice: event.exitPrice,
          pnl: event.pnl,
          tradeDirection: event.tradeDirection,
          timestamp: event.timestamp,
          // Include position context if available
          ...(matchingPosition ? {
            optionType: matchingPosition.optionType,
            strikePrice: matchingPosition.strikePrice,
            expiryDate: matchingPosition.expiryDate,
          } : {}),
        },
      })

      logger.info(
        `[PositionStreamer] Exit event sent to user ${userId}: ` +
        `${event.symbol} ${event.reason} @ ₹${event.exitPrice} P&L: ₹${event.pnl}`,
      )
    }
  }

  // ─── Price Resolution (from cache) ─────────────────────────────────────

  private resolveLivePrice(
    segment: string,
    symbol: string,
    _optionType: string | null,
    _strikePrice: number | null,
  ): number {
    if (segment === 'EQUITY') {
      // Check cache first
      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(symbol))
      if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice

      // Fallback to MarketDataManager's in-memory stocks
      const stock = getMarketDataManager().stocks[symbol]
      if (stock?.last_price && stock.last_price > 0) return stock.last_price

      return 0
    }

    if (segment === 'FUTURES') {
      const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(symbol))
      if (cached?.ltp && cached.ltp > 0) return cached.ltp

      return 0
    }

    if (segment === 'OPTIONS') {
      // Options prices come from the option chain data stream (oc:NIFTY::expiry channel)
      // Client resolves option prices directly from that channel's data
      return 0
    }

    return 0
  }

  // ─── P&L Calculation ──────────────────────────────────────────────────

  private calculateUnrealizedPnl(
    tradeDirection: string,
    entryPrice: number,
    currentPrice: number,
    quantity: number,
  ): number {
    if (currentPrice <= 0 || entryPrice <= 0) return 0

    if (tradeDirection === 'BUY') {
      return Math.round((currentPrice - entryPrice) * quantity * 100) / 100
    } else {
      return Math.round((entryPrice - currentPrice) * quantity * 100) / 100
    }
  }

  // ─── Teardown ──────────────────────────────────────────────────────────

  destroy(): void {
    // Clear all per-user poll timers
    for (const [userId, timer] of this.userPollTimers) {
      clearInterval(timer)
      logger.debug(`[PositionStreamer] Cleared poll timer for user ${userId}`)
    }
    this.userPollTimers.clear()

    // Unsubscribe all per-user exit listeners
    for (const [userId, unsub] of this.userExitUnsubs) {
      unsub()
      logger.debug(`[PositionStreamer] Unsubscribed exit events for user ${userId}`)
    }
    this.userExitUnsubs.clear()

    // Unsubscribe global exit listener
    if (this.globalExitUnsub) {
      this.globalExitUnsub()
      this.globalExitUnsub = null
    }

    // Clear all queues
    this.exitEventQueues.clear()

    // Reset singleton
    PositionStreamer.instance = null

    logger.info('[PositionStreamer] Destroyed')
  }
}

// ─── Singleton Factory ─────────────────────────────────────────────────────

let singletonInstance: PositionStreamer | null = null

export function getPositionStreamer(wsServer: PepertectWebSocketServer): PositionStreamer {
  if (!singletonInstance) {
    singletonInstance = PositionStreamer.getInstance(wsServer)
  }
  return singletonInstance
}