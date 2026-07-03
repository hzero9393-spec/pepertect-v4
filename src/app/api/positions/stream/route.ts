/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Positions Stream — SSE endpoint for real-time position price + P&L
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pushes live price updates + P&L for all open positions every 500ms.
 * Also listens for auto-exit events and pushes them immediately.
 */

import { authenticateRequest } from '@/lib/trade-auth'
import { db } from '@/lib/db'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
import { getAutoExitWorker, type ExitEvent } from '@/lib/auto-exit-worker'
import { getMarketDataManager } from '@/lib/market-data-manager'
import { getOptionChainManager } from '@/lib/option-chain-manager'

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

// Track which underlying+expiry combos we've ensured OC polling for (per SSE connection)
const ensuredOcPolling = new Set<string>()

// Store unsub functions for cleanup when SSE disconnects
const ocUnsubs: (() => void)[] = []

async function getLivePrice(
  segment: string,
  symbol: string,
  optionType: string | null,
  strikePrice: number | null,
  expiryDate: Date | null,
): Promise<number> {
  if (segment === 'EQUITY') {
    const manager = getMarketDataManager()
    const stock = manager.stocks[symbol.toUpperCase()]
    if (stock?.last_price && stock.last_price > 0) return stock.last_price

    const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(symbol))
    if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice
  } else if (segment === 'OPTIONS' && optionType && strikePrice) {
    const ocManager = getOptionChainManager()
    const upperSymbol = symbol.toUpperCase()

    // ─── Normalize expiry from DB Date to YYYY-MM-DD string ───────
    const expiryStr = expiryDate ? new Date(expiryDate).toISOString().split('T')[0] : null

    // ─── Ensure OC is polling for the position's specific expiry ──
    // Key fix: subscribe per unique underlying+expiry combo, not just per underlying.
    // This ensures that if a position is on next-week's expiry, we poll THAT expiry.
    if (expiryStr) {
      const pollKey = `${upperSymbol}::${expiryStr}`
      if (!ensuredOcPolling.has(pollKey)) {
        ensuredOcPolling.add(pollKey)
        try {
          const unsub = ocManager.subscribe(upperSymbol, expiryStr, () => {})
          ocUnsubs.push(unsub)
        } catch { /* ignore */ }
      }
    } else {
      // No expiry stored — fall back to nearest expiry for this underlying
      const fallbackKey = `${upperSymbol}::`
      if (!ensuredOcPolling.has(fallbackKey)) {
        ensuredOcPolling.add(fallbackKey)
        try {
          const expiries = await ocManager.getExpiries(upperSymbol)
          if (expiries.length > 0) {
            const unsub = ocManager.subscribe(upperSymbol, expiries[0], () => {})
            ocUnsubs.push(unsub)
          }
        } catch { /* ignore */ }
      }
    }

    // ─── Look up from OC manager's latestData ──────────────────────
    const expiryMap = (ocManager as any).latestData as Map<string, any> | undefined
    if (expiryMap && expiryMap.size > 0) {
      // Try ALL expiries for this underlying — match by underlying + strike + optionType
      for (const [key, data] of expiryMap) {
        if (data.underlying !== upperSymbol || !data.strikes) continue

        // If we have an expiryStr, prefer exact match; also try other expiries as fallback
        if (expiryStr && data.expiry !== expiryStr) continue

        const strike = data.strikes.find((s: any) => s.strike_price === strikePrice)
        if (strike) {
          const optData = optionType === 'CE'
            ? strike.call_options?.market_data
            : strike.put_options?.market_data
          if (optData?.ltp && optData.ltp > 0) return optData.ltp
        }
      }

      // Fallback: try any expiry for this underlying if exact expiry didn't match
      if (expiryStr) {
        for (const [key, data] of expiryMap) {
          if (data.underlying !== upperSymbol || !data.strikes || data.expiry === expiryStr) continue
          const strike = data.strikes.find((s: any) => s.strike_price === strikePrice)
          if (strike) {
            const optData = optionType === 'CE'
              ? strike.call_options?.market_data
              : strike.put_options?.market_data
            if (optData?.ltp && optData.ltp > 0) return optData.ltp
          }
        }
      }
    }

    // ─── Fallback to cache ─────────────────────────────────────────
    const optKey = CacheKeys.optionPrice(symbol, optionType, strikePrice)
    const cached = cache.get<{ ltp: number }>(optKey)
    if (cached?.ltp && cached.ltp > 0) return cached.ltp
  } else if (segment === 'FUTURES') {
    const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(symbol))
    if (cached?.ltp && cached.ltp > 0) return cached.ltp
  }

  return 0
}

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

  const unsubscribe = worker.onExit((event: ExitEvent) => {
    if (event.userId === userId) {
      exitEvents.set(event.positionId, event)
    }
  })

  let running = true

  const pollPositions = async () => {
    if (!running) return

    try {
      const positions = await db.position.findMany({
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

      const updates: PositionUpdate[] = []

      for (const pos of positions) {
        const livePrice = await getLivePrice(pos.segment, pos.symbol, pos.optionType, pos.strikePrice, pos.expiryDate)
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
      setTimeout(pollPositions, 500)
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
    // Clean up OC polling subscriptions we created
    while (ocUnsubs.length > 0) {
      const unsub = ocUnsubs.pop()
      if (unsub) unsub()
    }
    ensuredOcPolling.clear()
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