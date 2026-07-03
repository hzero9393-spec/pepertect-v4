/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Positions Stream — SSE endpoint for real-time position price + P&L
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pushes live price updates + P&L for all open positions every 500ms.
 * Also listens for auto-exit events and pushes them immediately.
 *
 * For OPTIONS: Directly fetches from Upstox API (no OC manager dependency)
 * because on Vercel serverless, each API route runs on a separate instance
 * and the OC manager singleton's data is not shared across instances.
 */

import { authenticateRequest } from '@/lib/trade-auth'
import { db } from '@/lib/db'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
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

// ─── Upstox Config ───────────────────────────────────────────────────────────

const UPSTOX_API_V2 = 'https://api.upstox.com/v2'

const INDEX_INSTRUMENT_KEYS: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  SENSEX: 'BSE_INDEX|SENSEX',
}

// ─── Direct Option Chain Cache (per instance) ───────────────────────────────
// On Vercel serverless, each SSE connection gets its own instance.
// We cache the option chain response per underlying+expiry to avoid
// hammering the Upstox API every 500ms.

interface OC_CACHE_ENTRY {
  strikes: Array<{
    strike_price: number
    call_options: { market_data: { ltp: number } } | null
    put_options: { market_data: { ltp: number } } | null
  }>
  fetchedAt: number
}

const ocDirectCache = new Map<string, OC_CACHE_ENTRY>()
const OC_FETCH_INTERVAL = 2000 // Fetch at most once every 2 seconds per key
let ocFetchInProgress = new Set<string>() // Deduplicate concurrent fetches

/**
 * Fetch option chain directly from Upstox API and cache the result.
 * Returns the cached/fresh strikes array or null on failure.
 */
async function fetchOptionChainDirect(
  underlying: string,
  expiry: string,
): Promise<OC_CACHE_ENTRY['strikes'] | null> {
  const cacheKey = `${underlying}::${expiry}`
  const now = Date.now()

  // Return cached if fresh enough
  const cached = ocDirectCache.get(cacheKey)
  if (cached && now - cached.fetchedAt < OC_FETCH_INTERVAL) {
    return cached.strikes
  }

  // Deduplicate: skip if fetch already in flight for this key
  if (ocFetchInProgress.has(cacheKey)) {
    return cached?.strikes ?? null
  }

  const instrumentKey = INDEX_INSTRUMENT_KEYS[underlying.toUpperCase()]
  if (!instrumentKey) return null

  const token = process.env.UPSTOX_ACCESS_TOKEN
  if (!token) return null

  ocFetchInProgress.add(cacheKey)

  try {
    const url = `${UPSTOX_API_V2}/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) return cached?.strikes ?? null

    const json = await res.json()
    if (json?.status === 'error') return cached?.strikes ?? null

    const chainData: any[] = json?.data || []
    if (chainData.length === 0) return cached?.strikes ?? null

    // Extract only the fields we need (smaller cache footprint)
    const strikes = chainData.map((s: any) => ({
      strike_price: s.strike_price,
      call_options: s.call_options
        ? { market_data: { ltp: s.call_options.market_data?.ltp || 0 } }
        : null,
      put_options: s.put_options
        ? { market_data: { ltp: s.put_options.market_data?.ltp || 0 } }
        : null,
    }))

    const entry: OC_CACHE_ENTRY = { strikes, fetchedAt: now }
    ocDirectCache.set(cacheKey, entry)

    return strikes
  } catch {
    // On failure, return stale cache if available
    return cached?.strikes ?? null
  } finally {
    ocFetchInProgress.delete(cacheKey)
  }
}

// ─── Nearest Expiry Lookup (calendar-based, instant) ────────────────────────

const EXPIRY_CACHE = new Map<string, string[]>()

async function getNearestExpiry(underlying: string): Promise<string | null> {
  let expiries = EXPIRY_CACHE.get(underlying)
  if (!expiries) {
    try {
      const { getExpiryDates } = await import('@/lib/upstox-instruments')
      expiries = await getExpiryDates(underlying)
      if (expiries.length > 0) EXPIRY_CACHE.set(underlying, expiries)
    } catch {
      return null
    }
  }
  return expiries?.[0] ?? null
}

// ─── Live Price Resolution ──────────────────────────────────────────────────

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
    const upperSymbol = symbol.toUpperCase()

    // ─── Determine expiry to fetch ────────────────────────────────
    // 1. Use the position's stored expiryDate
    // 2. If missing, fall back to the nearest calendar expiry
    let expiryStr: string | null = null

    if (expiryDate) {
      // Convert DB DateTime to YYYY-MM-DD safely (avoid timezone issues)
      const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate)
      // Use UTC components to avoid IST→UTC shift changing the date
      expiryStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }

    if (!expiryStr) {
      expiryStr = await getNearestExpiry(upperSymbol)
    }

    if (!expiryStr) {
      // Can't determine expiry — fall through to cache
    } else {
      // ─── Direct Upstox API fetch with cache ─────────────────────
      const strikes = await fetchOptionChainDirect(upperSymbol, expiryStr)
      if (strikes && strikes.length > 0) {
        const strike = strikes.find((s) => s.strike_price === strikePrice)
        if (strike) {
          const optData = optionType === 'CE'
            ? strike.call_options?.market_data
            : strike.put_options?.market_data
          if (optData?.ltp && optData.ltp > 0) {
            // Also update the in-memory cache for other consumers
            cache.set(CacheKeys.optionPrice(upperSymbol, optionType, strikePrice), { ltp: optData.ltp }, CacheTTL.OPTION_PRICE)
            return optData.ltp
          }
        }
      }
    }
  } else if (segment === 'FUTURES') {
    const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(symbol))
    if (cached?.ltp && cached.ltp > 0) return cached.ltp
  }

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
    ocDirectCache.clear()
    ocFetchInProgress.clear()
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