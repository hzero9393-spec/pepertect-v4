/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Positions Service — Replaces /api/positions/stream SSE endpoint
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each authenticated client has their own position poller.
 * Gets live prices from MarketDataService (EQUITY) or cache (FUTURES/OPTIONS).
 * OPTIONS prices come from OptionChainService data.
 */

import { db } from '../lib/db'
import { cache, CacheKeys, CacheTTL } from '../lib/cache'
import type { ClientConnection } from '../ws/wsManager'
import type { MarketDataService } from './marketData'
import type { OptionChainService } from './optionChain'

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

interface ExitEvent {
  positionId: string
  userId: string
  symbol: string
  segment: string
  reason: string
  exitPrice: number
  pnl: number
  tradeDirection: string
  timestamp: number
}

export class PositionsService {
  // Map: userId → Set<ClientConnection> (user can have multiple tabs)
  private userClients = new Map<string, Set<ClientConnection>>()
  // Map: userId → poll timer
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>()
  // Map: userId → cached positions
  private cachedPositions = new Map<string, any[]>()
  // Map: userId → positionsDirty flag
  private positionsDirty = new Map<string, boolean>()
  // Map: userId → exit events queue
  private exitEvents = new Map<string, Map<string, ExitEvent>>()

  private marketService: MarketDataService | null = null
  private optionChainService: OptionChainService | null = null

  /** Set references to other services (called by wsManager) */
  setServices(market: MarketDataService, options: OptionChainService) {
    this.marketService = market
    this.optionChainService = options
  }

  addClient(client: ClientConnection) {
    if (!client.userId) return

    if (!this.userClients.has(client.userId)) {
      this.userClients.set(client.userId, new Set())
    }
    this.userClients.get(client.userId)!.add(client)
    this.positionsDirty.set(client.userId, true)

    // Start polling for this user if first client
    if (this.userClients.get(client.userId)!.size === 1) {
      this.startPolling(client.userId)
    }
  }

  removeClient(client: ClientConnection) {
    if (!client.userId) return

    const clients = this.userClients.get(client.userId)
    if (clients) {
      clients.delete(client)
      if (clients.size === 0) {
        this.userClients.delete(client.userId)
        this.stopPolling(client.userId)
        this.cachedPositions.delete(client.userId)
        this.positionsDirty.delete(client.userId)
        this.exitEvents.delete(client.userId)
      }
    }
  }

  /** Called by AutoExitService when a position is auto-exited */
  pushExitEvent(event: ExitEvent) {
    const exitMap = this.exitEvents.get(event.userId) || new Map()
    exitMap.set(event.positionId, event)
    this.exitEvents.set(event.userId, exitMap)
    this.positionsDirty.set(event.userId, true)

    // Immediately send exit event to user's clients
    const clients = this.userClients.get(event.userId)
    if (clients) {
      const msg = JSON.stringify({
        type: 'exit',
        data: {
          positionId: event.positionId,
          symbol: event.symbol,
          segment: event.segment,
          reason: event.reason,
          exitPrice: event.exitPrice,
          pnl: event.pnl,
          tradeDirection: event.tradeDirection,
          timestamp: event.timestamp,
        }
      })
      for (const client of clients) {
        if (client.ws.readyState === 1) {
          try { client.ws.send(msg) } catch {}
        }
      }
    }
  }

  private async startPolling(userId: string) {
    this.positionsDirty.set(userId, true)
    this.pollPositions(userId) // immediate
    const timer = setInterval(() => this.pollPositions(userId), 30000) // 30s — event-driven, not real-time
    this.pollTimers.set(userId, timer)
  }

  private stopPolling(userId: string) {
    const timer = this.pollTimers.get(userId)
    if (timer) { clearInterval(timer); this.pollTimers.delete(userId) }
  }

  private async getLivePrice(segment: string, symbol: string): Promise<number> {
    if (segment === 'EQUITY' && this.marketService) {
      const stock = this.marketService.stocks[symbol.toUpperCase()]
      if (stock?.last_price && stock.last_price > 0) return stock.last_price

      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(symbol))
      if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice
    } else if (segment === 'FUTURES') {
      const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(symbol))
      if (cached?.ltp && cached.ltp > 0) return cached.ltp
    }
    // OPTIONS: return 0 — client uses option chain data
    return 0
  }

  private async pollPositions(userId: string) {
    const clients = this.userClients.get(userId)
    if (!clients || clients.size === 0) return

    try {
      const dirty = this.positionsDirty.get(userId) || false
      let positions = this.cachedPositions.get(userId)

      if (dirty || !positions) {
        positions = await db.position.findMany({
          where: { userId, isOpen: true },
          select: {
            id: true, symbol: true, segment: true, optionType: true,
            strikePrice: true, expiryDate: true, tradeDirection: true,
            entryPrice: true, quantity: true, totalInvested: true, currentPrice: true,
          },
        })
        this.cachedPositions.set(userId, positions)
        this.positionsDirty.set(userId, false)
      }

      const updates: PositionUpdate[] = []
      const exitMap = this.exitEvents.get(userId) || new Map()

      for (const pos of positions) {
        const livePrice = await this.getLivePrice(pos.segment, pos.symbol)
        const price = livePrice > 0 ? livePrice : pos.currentPrice

        let unrealizedPnl: number
        if (pos.tradeDirection === 'BUY') {
          unrealizedPnl = (price - pos.entryPrice) * pos.quantity
        } else {
          unrealizedPnl = (pos.entryPrice - price) * pos.quantity
        }
        unrealizedPnl = Math.round(unrealizedPnl * 100) / 100

        const unrealizedPnlPercent = pos.totalInvested > 0
          ? Math.round((unrealizedPnl / pos.totalInvested) * 10000) / 100
          : 0

        const update: PositionUpdate = {
          positionId: pos.id, symbol: pos.symbol, segment: pos.segment,
          optionType: pos.optionType, strikePrice: pos.strikePrice,
          expiryDate: pos.expiryDate ? pos.expiryDate.toISOString() : null,
          currentPrice: price, unrealizedPnl, unrealizedPnlPercent,
          tradeDirection: pos.tradeDirection, isOpen: true,
        }

        const exitEvent = exitMap.get(pos.id)
        if (exitEvent) {
          update.exitEvent = {
            reason: exitEvent.reason, exitPrice: exitEvent.exitPrice,
            pnl: exitEvent.pnl, timestamp: exitEvent.timestamp,
          }
          exitMap.delete(pos.id)
        }

        updates.push(update)
      }

      if (updates.length > 0) {
        const msg = JSON.stringify({ type: 'positions', data: updates })
        for (const client of clients) {
          if (client.ws.readyState === 1) {
            try { client.ws.send(msg) } catch {}
          }
        }
      }
    } catch {
      // next cycle
    }
  }

  stop() {
    for (const timer of this.pollTimers.values()) clearInterval(timer)
    this.pollTimers.clear()
    this.userClients.clear()
    this.cachedPositions.clear()
  }
}