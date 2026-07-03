import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest, calculateBrokerage } from '@/lib/trade-auth'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
import { Prisma } from '@prisma/client'
// Direct Upstox API fetch for options (reliable on serverless)

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if (auth.error) return auth.error

    const userId = auth.userId
    const body = await request.json()
    const { positionId } = body

    if (!positionId) {
      return NextResponse.json(
        { error: 'positionId is required' },
        { status: 400 }
      )
    }

    // ─── Find the position ──────────────────────────────────────
    const position = await db.position.findFirst({
      where: { id: positionId, userId, isOpen: true },
    })

    if (!position) {
      return NextResponse.json(
        { error: 'Open position not found or does not belong to you' },
        { status: 404 }
      )
    }

    // ─── Get current price (try cache first, then DB) ───────────
    let currentPrice = position.currentPrice

    if (position.segment === 'EQUITY') {
      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(position.symbol))
      if (cached) {
        currentPrice = cached.currentPrice
      } else {
        const stock = await db.stock.findFirst({
          where: { symbol: position.symbol, isActive: true },
          select: { currentPrice: true, symbol: true },
        })
        if (stock) {
          currentPrice = stock.currentPrice
          cache.set(CacheKeys.stockPrice(stock.symbol), { currentPrice: stock.currentPrice }, CacheTTL.STOCK_PRICE)
        }
      }
    } else if (position.segment === 'FUTURES') {
      const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(position.symbol))
      if (cached) {
        currentPrice = cached.ltp
      } else {
        const future = await db.future.findFirst({
          where: { underlying: position.symbol, isActive: true },
          orderBy: { expiryDate: 'asc' },
          select: { ltp: true, underlying: true },
        })
        if (future) {
          currentPrice = future.ltp
          cache.set(CacheKeys.futurePrice(future.underlying), { ltp: future.ltp }, CacheTTL.FUTURE_PRICE)
        }
      }
    } else if (position.segment === 'OPTIONS') {
      const optCacheKey = CacheKeys.optionPrice(position.symbol, position.optionType || 'CE', position.strikePrice || 0)
      const cached = cache.get<{ ltp: number }>(optCacheKey)
      if (cached) {
        currentPrice = cached.ltp
      } else {
        // Direct Upstox API fetch (reliable on serverless, no singleton dependency)
        try {
          const INSTRUMENT_KEYS: Record<string, string> = {
            NIFTY: 'NSE_INDEX|Nifty 50',
            BANKNIFTY: 'NSE_INDEX|Nifty Bank',
            FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
            SENSEX: 'BSE_INDEX|SENSEX',
          }
          const upperSymbol = position.symbol.toUpperCase()
          const instrumentKey = INSTRUMENT_KEYS[upperSymbol]
          const token = process.env.UPSTOX_ACCESS_TOKEN

          if (instrumentKey && token && position.expiryDate) {
            const d = position.expiryDate instanceof Date ? position.expiryDate : new Date(position.expiryDate)
            const expiryStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

            const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiryStr)}`
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
              cache: 'no-store',
              signal: AbortSignal.timeout(5000),
            })
            if (res.ok) {
              const json = await res.json()
              const chainData: any[] = json?.data || []
              const strike = chainData.find((s: any) => s.strike_price === position.strikePrice)
              if (strike) {
                const optData = position.optionType === 'CE'
                  ? strike.call_options?.market_data
                  : strike.put_options?.market_data
                if (optData?.ltp && optData.ltp > 0) {
                  currentPrice = optData.ltp
                  cache.set(optCacheKey, { ltp: currentPrice }, CacheTTL.OPTION_PRICE)
                }
              }
            }
          }
        } catch { /* ignore, fall through to DB */ }

        // Fallback to DB with expiryDate filter
        if (currentPrice <= 0) {
          const option = await db.option.findFirst({
            where: {
              underlying: position.symbol,
              optionType: position.optionType,
              strikePrice: position.strikePrice,
              ...(position.expiryDate ? { expiryDate: position.expiryDate } : {}),
              isActive: true,
            },
            orderBy: { expiryDate: 'asc' },
            select: { ltp: true },
          })
          if (option) {
            currentPrice = option.ltp
            cache.set(optCacheKey, { ltp: currentPrice }, CacheTTL.OPTION_PRICE)
          }
        }
      }
    }

    // ─── Calculate P&L ──────────────────────────────────────────
    const closeDirection = position.tradeDirection === 'BUY' ? 'SELL' : 'BUY'
    const totalValue = Math.round(position.quantity * currentPrice * 100) / 100
    const brokerage = calculateBrokerage(totalValue)

    let realizedPnl: number
    if (position.tradeDirection === 'BUY') {
      realizedPnl = (currentPrice - position.entryPrice) * position.quantity - brokerage
    } else {
      realizedPnl = (position.entryPrice - currentPrice) * position.quantity - brokerage
    }
    realizedPnl = Math.round(realizedPnl * 100) / 100

    const pnlPercent = position.entryPrice > 0
      ? Math.round((realizedPnl / position.totalInvested) * 10000) / 100
      : 0

    // ─── Execute square-off in transaction ──────────────────────
    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.create({
        data: {
          userId,
          orderType: 'MARKET',
          tradeDirection: closeDirection as 'BUY' | 'SELL',
          segment: position.segment,
          productType: position.productType,
          symbol: position.symbol,
          instrumentId: position.instrumentId,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
          expiryDate: position.expiryDate,
          lotSize: position.lotSize,
          lots: position.lots,
          quantity: position.quantity,
          price: currentPrice,
          fillPrice: currentPrice,
          totalValue,
          brokerage,
          marginRequired: position.marginUsed,
          status: 'FILLED',
          filledAt: new Date(),
        }
      })

      const trade = await tx.trade.create({
        data: {
          userId,
          orderId: order.id,
          segment: position.segment,
          productType: position.productType,
          tradeDirection: closeDirection as 'BUY' | 'SELL',
          symbol: position.symbol,
          instrumentId: position.instrumentId,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
          quantity: position.quantity,
          fillPrice: currentPrice,
          totalValue,
          brokerage,
          pnl: realizedPnl,
          pnlPercent,
          expiryDate: position.expiryDate,
          squaredOffAt: new Date(),
        }
      })

      await tx.position.update({
        where: { id: position.id },
        data: {
          isOpen: false,
          currentPrice,
          currentValue: 0,
          unrealizedPnl: 0,
          realizedPnl: { increment: realizedPnl },
          squaredOffAt: new Date(),
        }
      })

      // Update user balance
      if (position.tradeDirection === 'BUY') {
        const proceeds = totalValue - brokerage
        await tx.user.update({
          where: { id: userId },
          data: {
            virtualBalance: { increment: proceeds },
            totalTrades: { increment: 1 },
            totalPnl: { increment: realizedPnl },
            marginUsed: { decrement: position.marginUsed },
          },
        })
      } else {
        const marginReturn = position.marginUsed + realizedPnl
        await tx.user.update({
          where: { id: userId },
          data: {
            virtualBalance: { increment: marginReturn },
            totalTrades: { increment: 1 },
            totalPnl: { increment: realizedPnl },
            marginUsed: { decrement: position.marginUsed },
          },
        })
      }

      // Get updated user balance
      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { virtualBalance: true, totalPnl: true, totalTrades: true },
      })

      return { order, trade, updatedUser }
    })

    // ─── Invalidate relevant caches ─────────────────────────────
    cache.deleteByPrefix(`ubal:${userId}`)
    if (auth.token) cache.delete(CacheKeys.auth(auth.token))

    return NextResponse.json({
      success: true,
      message: `Position squared off: ${position.quantity} ${position.symbol} @ ₹${currentPrice}`,
      order: result.order,
      trade: result.trade,
      closedPosition: {
        id: position.id,
        symbol: position.symbol,
        segment: position.segment,
        tradeDirection: position.tradeDirection,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        realizedPnl,
        pnlPercent,
        brokerage,
      },
      balance: result.updatedUser?.virtualBalance,
      totalPnl: result.updatedUser?.totalPnl,
    })
  } catch (error) {
    console.error('[POST /api/trade/square-off] FULL ERROR:', JSON.stringify(error, null, 2))
    let errorMessage = 'Failed to square off position'
    if (error instanceof Error) {
      errorMessage = `Square-off failed: ${error.message.slice(0, 200)}`
    }
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
