import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest } from '@/lib/trade-auth'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if (auth.error) return auth.error

    const userId = auth.userId

    // ─── Fetch ALL positions (open + closed) in ONE query ────────
    const positions = await db.position.findMany({
      where: { userId },
      orderBy: [
        { isOpen: 'desc' },  // Open positions first
        { createdAt: 'desc' },
      ],
    })

    if (positions.length === 0) {
      return NextResponse.json({ success: true, data: [], count: 0 })
    }

    // ─── Batch: Collect all unique symbols for price lookup ─────
    const equitySymbols = new Set<string>()
    const futureSymbols = new Set<string>()
    const optionKeys: { underlying: string; optionType: string; strikePrice: number; expiryDate?: Date | null }[] = []

    for (const pos of positions) {
      if (pos.segment === 'EQUITY') {
        equitySymbols.add(pos.symbol.toUpperCase())
      } else if (pos.segment === 'FUTURES') {
        futureSymbols.add(pos.symbol.toUpperCase())
      } else if (pos.segment === 'OPTIONS' && pos.optionType && pos.strikePrice) {
        optionKeys.push({
          underlying: pos.symbol.toUpperCase(),
          optionType: pos.optionType,
          strikePrice: pos.strikePrice,
          expiryDate: pos.expiryDate,
        })
      }
    }

    // ─── Batch price lookups: 3 parallel queries instead of N ───
    const [stockPrices, futurePrices, optionPrices] = await Promise.all([
      // All equity prices in ONE query
      equitySymbols.size > 0
        ? db.stock.findMany({
            where: {
              symbol: { in: Array.from(equitySymbols) },
              isActive: true,
            },
            select: { symbol: true, currentPrice: true, change: true, changePercent: true, name: true },
          })
        : Promise.resolve([]),
      // All future prices in ONE query
      futureSymbols.size > 0
        ? db.future.findMany({
            where: {
              underlying: { in: Array.from(futureSymbols) },
              isActive: true,
            },
            orderBy: { expiryDate: 'asc' },
            select: { underlying: true, ltp: true, change: true, changePercent: true },
          })
        : Promise.resolve([]),
      // All option prices in ONE query (filter by expiryDate for precise match)
      optionKeys.length > 0
        ? db.option.findMany({
            where: {
              OR: optionKeys.map(ok => ({
                underlying: ok.underlying,
                optionType: ok.optionType,
                strikePrice: ok.strikePrice,
                ...(ok.expiryDate ? { expiryDate: ok.expiryDate } : {}),
                isActive: true,
              })),
            },
            orderBy: { expiryDate: 'asc' },
            select: { underlying: true, optionType: true, strikePrice: true, expiryDate: true, ltp: true, change: true, changePercent: true },
          })
        : Promise.resolve([]),
    ])

    // ─── Build lookup maps for O(1) price access ───────────────
    const stockPriceMap = new Map(
      stockPrices.map(s => [s.symbol.toUpperCase(), s])
    )
    const futurePriceMap = new Map(
      futurePrices.map(f => [f.underlying.toUpperCase(), f])
    )
    // For options, key = "UNDERLYING:TYPE:STRIKE" (expiry-aware dedup handled by query)
    const optionPriceMap = new Map(
      optionPrices.map(o => [`${o.underlying.toUpperCase()}:${o.optionType}:${o.strikePrice}`, o])
    )

    // ─── Enrich positions with prices (no DB writes!) ───────────
    const enrichedPositions = positions.map(position => {
      let currentPrice = position.currentPrice

      // Only update live price for OPEN positions
      // Closed positions should keep their exit price (squaredOffAt price)
      if (position.isOpen) {
        if (position.segment === 'EQUITY') {
          const stockData = stockPriceMap.get(position.symbol.toUpperCase())
          if (stockData) currentPrice = stockData.currentPrice
        } else if (position.segment === 'FUTURES') {
          const futureData = futurePriceMap.get(position.symbol.toUpperCase())
          if (futureData) currentPrice = futureData.ltp
        } else if (position.segment === 'OPTIONS' && position.optionType && position.strikePrice) {
          const optKey = `${position.symbol.toUpperCase()}:${position.optionType}:${position.strikePrice}`
          const optionData = optionPriceMap.get(optKey)
          if (optionData) currentPrice = optionData.ltp
        }
      }

      // Calculate unrealized P&L based on direction (only for open positions)
      let unrealizedPnl: number
      if (!position.isOpen) {
        unrealizedPnl = 0 // Closed positions have realizedPnl
      } else if (position.tradeDirection === 'BUY') {
        unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity
      } else {
        unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity
      }

      const currentValue = position.isOpen ? position.quantity * currentPrice : 0

      return {
        ...position,
        currentPrice,
        currentValue,
        exitPrice: !position.isOpen ? currentPrice : null,
        closedAt: position.squaredOffAt, // Map squaredOffAt to closedAt for frontend
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        unrealizedPnlPercent: position.entryPrice > 0 && position.isOpen
          ? Math.round((unrealizedPnl / position.totalInvested) * 10000) / 100
          : 0,
      }
    })

    // ─── Cache prices for other API calls (standardized shape) ──
    for (const s of stockPrices) {
      cache.set(CacheKeys.stockPrice(s.symbol), { currentPrice: s.currentPrice }, CacheTTL.STOCK_PRICE)
    }
    for (const f of futurePrices) {
      cache.set(CacheKeys.futurePrice(f.underlying), { ltp: f.ltp }, CacheTTL.FUTURE_PRICE)
    }

    return NextResponse.json({
      success: true,
      data: enrichedPositions,
      count: enrichedPositions.length,
    })
  } catch (error) {
    console.error('[GET /api/trade/positions] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 }
    )
  }
}
