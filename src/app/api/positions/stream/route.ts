/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Positions Stream — SSE endpoint for real-time position price + P&L
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pushes live price updates + P&L for open positions.
 * Also listens for auto-exit events and pushes them immediately.
 *
 * For EQUITY: Resolves live price from MarketDataManager (stock quotes).
 * For OPTIONS: Returns DB price — client fetches real-time LTP directly
 *   from /api/options/stream (option chain SSE) to avoid duplicate API calls.
 * For FUTURES: Resolves from in-memory cache.
 */

import { authenticateRequest } from '@/lib/trade-auth'
import { db } from '@/lib/db'
import { cache, CacheKeys } from '@/lib/cache'
import { getAutoExitWorker, type ExitEvent } from '@/lib/auto-exit-worker'
import { getMarketDataManager } from '@/lib/market-data-manager'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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

// ─── Live Price Resolution ──────────────────────────────────────────────────
// Only resolves EQUITY (from market data) and FUTURES (from cache).
// OPTIONS prices are handled client-side via option chain SSE.

async function getLivePrice(
  segment: string,
  symbol: string,
): Promise<number> {
  if (segment === 'EQUITY') {
    const manager = getMarketDataManager()
    const stock = manager.stocks[symbol.toUpperCase()]
    if (stock?.last_price && stock.last_price > 0) return stock.last_price

    const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(symbol))
    if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice
  } else if (segment === 'FUTURES') {
    const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(symbol))
    if (cached?.ltp && cached.ltp > 0) return cached.ltp
  }
  // OPTIONS: return 0 — client uses option chain SSE for real-time LTP
  return 0
}

// ─── SSE Handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const auth = await authenticateRequest(request as any)
  if (auth.error) return auth.error

  const userId = auth.userId
  const encoder = new TextEncoder()

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const send = async (data: object) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch { /* closed */ }
  }

  // Track exit events for this user
  const exitEvents = new Map<string, ExitEvent>()

  // Start auto-exit worker
  const worker = getAutoExitWorker()
  worker.ensureRunning()

  // ─── In-memory position cache (avoids DB query every cycle) ─────
  let cachedPositions: Awaited<ReturnType<typeof db.position.findMany>> | null = null
  let positionsDirty = true // force first DB fetch

  const unsubscribe = worker.onExit((event: ExitEvent) => {
    if (event.userId === userId) {
      exitEvents.set(event.positionId, event)
      positionsDirty = true // positions changed — force DB refresh
    }
  })

  let running = true

  const pollPositions = async () => {
    if (!running) return

    try {
      // Only hit DB if dirty (exit event) or every 10s refresh
      if (positionsDirty || !cachedPositions) {
        cachedPositions = await db.position.findMany({
          where: { userId, isOpen: true },
          select: {
            id: true,
            symbol: true,
            segment: true,
            optionType: true,
            strikePrice: true,
            expiryDate: true,
            tradeDirection: true,
            entryPrice: true,
            quantity: true,
            totalInvested: true,
            currentPrice: true,
          },
        })
        positionsDirty = false
      }

      const positions = cachedPositions

      const updates: PositionUpdate[] = []

      for (const pos of positions) {
        // For OPTIONS, client handles live price via OC SSE — send DB price
        // For EQUITY/FUTURES, resolve live price server-side
        const livePrice = await getLivePrice(pos.segment, pos.symbol)
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
          positionId: pos.id,
          symbol: pos.symbol,
          segment: pos.segment,
          optionType: pos.optionType,
          strikePrice: pos.strikePrice,
          expiryDate: pos.expiryDate ? pos.expiryDate.toISOString() : null,
          currentPrice: price,
          unrealizedPnl,
          unrealizedPnlPercent,
          tradeDirection: pos.tradeDirection,
          isOpen: true,
        }

        const exitEvent = exitEvents.get(pos.id)
        if (exitEvent) {
          update.exitEvent = {
            reason: exitEvent.reason,
            exitPrice: exitEvent.exitPrice,
            pnl: exitEvent.pnl,
            timestamp: exitEvent.timestamp,
          }
          exitEvents.delete(pos.id)
        }

        updates.push(update)
      }

      if (updates.length > 0) {
        await send({ type: 'positions', data: updates })
      }

      // Send exit events for positions no longer in query
      for (const [posId, event] of exitEvents) {
        await send({
          type: 'exit',
          data: {
            positionId: posId,
            symbol: event.symbol,
            segment: event.segment,
            reason: event.reason,
            exitPrice: event.exitPrice,
            pnl: event.pnl,
            tradeDirection: event.tradeDirection,
            timestamp: event.timestamp,
          }
        })
        exitEvents.delete(posId)
      }
    } catch { /* next cycle */ }

    if (running) {
      setTimeout(pollPositions, 10000) // 10s — live prices come from OC/WS SSE, not DB
    }
  }

  pollPositions()

  const keepAlive = setInterval(() => {
    try { writer.write(encoder.encode(': keepalive\n\n')) } catch {}
  }, 15000)

  const cleanup = () => {
    running = false
    unsubscribe()
    clearInterval(keepAlive)
    try { writer.close() } catch {}
  }

  request.signal.addEventListener('abort', cleanup)
  setTimeout(cleanup, 115000)

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}