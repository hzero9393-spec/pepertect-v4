import { Router, Response } from 'express'
import { db } from '../lib/db.js'
import { authenticate, type AuthRequest } from '../lib/auth-middleware.js'
import { cache, CacheKeys, CacheTTL } from '../lib/cache.js'
import { calculateBrokerage, checkMarketStatus, validateOrderQuantity, getMarginPercent } from '../lib/trade-utils.js'
import { getAutoExitWorker } from '../services/auto-exit-worker.js'
import { getOptionChainManager } from '../services/option-chain-manager.js'
import { logger } from '../lib/logger.js'
import { Prisma } from '@prisma/client'

// ─── Helper: Build SL / Target update payload ────────────────────────────────

function slTargetData(direction: string, entryPrice: number, sl?: number | null, tgt?: number | null) {
  const data: Record<string, unknown> = {}
  if (sl && sl > 0) {
    if (direction === 'BUY' && sl < entryPrice) data.stopLoss = sl
    else if (direction === 'SELL' && sl > entryPrice) data.stopLoss = sl
  }
  if (tgt && tgt > 0) {
    if (direction === 'BUY' && tgt > entryPrice) data.target = tgt
    else if (direction === 'SELL' && tgt < entryPrice) data.target = tgt
  }
  if (data.stopLoss || data.target) {
    data.lastCheckedPrice = entryPrice
  }
  return data
}

// ─── Helper: Price resolution (cache → OC manager → DB) for a single position ─

async function resolveCurrentPrice(pos: {
  segment: string
  symbol: string
  optionType: string | null
  strikePrice: number | null
  expiryDate: Date | null
}): Promise<number> {
  // EQUITY → cache → DB
  if (pos.segment === 'EQUITY') {
    const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(pos.symbol))
    if (cached?.currentPrice && cached.currentPrice > 0) {
      cache.set(CacheKeys.stockPrice(pos.symbol), cached, CacheTTL.STOCK_PRICE)
      return cached.currentPrice
    }
    const stock = await db.stock.findFirst({
      where: { symbol: pos.symbol, isActive: true },
      select: { currentPrice: true, name: true },
    })
    if (stock?.currentPrice) {
      cache.set(CacheKeys.stockPrice(pos.symbol), stock, CacheTTL.STOCK_PRICE)
      return stock.currentPrice
    }
  }

  // FUTURES → cache → DB
  if (pos.segment === 'FUTURES') {
    const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(pos.symbol))
    if (cached?.ltp && cached.ltp > 0) {
      cache.set(CacheKeys.futurePrice(pos.symbol), cached, CacheTTL.FUTURE_PRICE)
      return cached.ltp
    }
    const future = await db.future.findFirst({
      where: { underlying: pos.symbol, isActive: true },
      orderBy: { expiryDate: 'asc' },
      select: { ltp: true },
    })
    if (future?.ltp) {
      cache.set(CacheKeys.futurePrice(pos.symbol), { ltp: future.ltp }, CacheTTL.FUTURE_PRICE)
      return future.ltp
    }
  }

  // OPTIONS → cache → OC manager → DB
  if (pos.segment === 'OPTIONS') {
    const optKey = CacheKeys.optionPrice(pos.symbol, pos.optionType || 'CE', pos.strikePrice || 0)
    const cached = cache.get<{ ltp: number }>(optKey)
    if (cached?.ltp && cached.ltp > 0) {
      cache.set(optKey, cached, CacheTTL.OPTION_PRICE)
      return cached.ltp
    }

    // Try option chain manager (real-time data)
    try {
      const ocManager = getOptionChainManager()
      const expiryStr = pos.expiryDate ? new Date(pos.expiryDate).toISOString().split('T')[0] : null
      const upperSymbol = pos.symbol.toUpperCase()

      // Try exact expiry match first, then any expiry
      const expiriesToTry = expiryStr
        ? [expiryStr, '*']
        : ['*']

      // We need to iterate over latestData - access via type assertion
      const latestData = (ocManager as unknown as { latestData: Map<string, unknown> }).latestData
      if (latestData && latestData.size > 0) {
        for (const expiryToTry of expiriesToTry) {
          for (const [key, data] of latestData) {
            const ocData = data as {
              underlying: string
              expiry: string
              strikes: Array<{
                strike_price: number
                call_options?: { market_data?: { ltp: number } }
                put_options?: { market_data?: { ltp: number } }
              }>
            }
            if (!ocData.underlying || !ocData.strikes) continue
            if (ocData.underlying.toUpperCase() !== upperSymbol) continue
            if (expiryToTry !== '*' && ocData.expiry !== expiryToTry) continue

            const strike = ocData.strikes.find(s => s.strike_price === pos.strikePrice)
            if (strike) {
              const optMarketData = pos.optionType === 'PE'
                ? strike.put_options?.market_data
                : strike.call_options?.market_data
              if (optMarketData?.ltp && optMarketData.ltp > 0) {
                cache.set(optKey, { ltp: optMarketData.ltp }, CacheTTL.OPTION_PRICE)
                return optMarketData.ltp
              }
            }
          }
        }
      }
    } catch { /* ignore OC manager errors */ }

    // Fallback to DB
    const option = await db.option.findFirst({
      where: {
        underlying: pos.symbol,
        optionType: pos.optionType ?? undefined,
        strikePrice: pos.strikePrice ?? undefined,
        ...(pos.expiryDate ? { expiryDate: new Date(pos.expiryDate) } : {}),
        isActive: true,
      },
      orderBy: { expiryDate: 'asc' },
      select: { ltp: true },
    })
    if (option?.ltp) {
      cache.set(optKey, { ltp: option.ltp }, CacheTTL.OPTION_PRICE)
      return option.ltp
    }
  }

  return 0
}

// ─── Helper: Batch price resolution for multiple positions ────────────────────

async function batchResolvePrices(positions: Array<{
  segment: string
  symbol: string
  optionType: string | null
  strikePrice: number | null
  expiryDate: Date | null
  isOpen: boolean
}>): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>()

  // Separate by segment
  const equitySymbols = new Set<string>()
  const futureSymbols = new Set<string>()
  const optionKeys = new Set<string>()

  for (const pos of positions) {
    if (!pos.isOpen) continue // closed positions keep their exit price
    if (pos.segment === 'EQUITY') equitySymbols.add(pos.symbol)
    else if (pos.segment === 'FUTURES') futureSymbols.add(pos.symbol)
    else if (pos.segment === 'OPTIONS') {
      optionKeys.add(`${pos.symbol}:${pos.optionType}:${pos.strikePrice}:${pos.expiryDate ? new Date(pos.expiryDate).toISOString().split('T')[0] : ''}`)
    }
  }

  // Parallel DB queries
  const [stocks, futures, options] = await Promise.all([
    equitySymbols.size > 0
      ? db.stock.findMany({
          where: { symbol: { in: Array.from(equitySymbols) }, isActive: true },
          select: { symbol: true, currentPrice: true, name: true },
        })
      : Promise.resolve([]),
    futureSymbols.size > 0
      ? db.future.findMany({
          where: { underlying: { in: Array.from(futureSymbols) }, isActive: true },
          orderBy: { expiryDate: 'asc' },
          select: { underlying: true, ltp: true },
        })
      : Promise.resolve([]),
    optionKeys.size > 0
      ? (() => {
          const whereClauses: Prisma.OptionWhereInput[] = []
          for (const key of optionKeys) {
            const [underlying, optionType, strikeStr, expiryStr] = key.split(':')
            whereClauses.push({
              underlying,
              optionType: optionType || undefined,
              strikePrice: strikeStr ? parseFloat(strikeStr) : undefined,
              ...(expiryStr ? { expiryDate: new Date(expiryStr) } : {}),
              isActive: true,
            })
          }
          return db.option.findMany({
            where: { OR: whereClauses },
            orderBy: { expiryDate: 'asc' },
            select: { underlying: true, optionType: true, strikePrice: true, ltp: true },
          })
        })()
      : Promise.resolve([]),
  ])

  // Build lookup maps
  const stockMap = new Map(stocks.map(s => [s.symbol, s.currentPrice]))
  const futureMap = new Map(futures.map(f => [f.underlying, f.ltp]))
  const optionMap = new Map(options.map(o => [`${o.underlying}:${o.optionType}:${o.strikePrice}`, o.ltp]))

  // Resolve prices for each position
  for (const pos of positions) {
    if (!pos.isOpen) continue

    let price = 0

    if (pos.segment === 'EQUITY') {
      // Try cache first
      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(pos.symbol))
      price = cached?.currentPrice && cached.currentPrice > 0 ? cached.currentPrice : (stockMap.get(pos.symbol) || 0)
      if (price > 0) cache.set(CacheKeys.stockPrice(pos.symbol), { currentPrice: price }, CacheTTL.STOCK_PRICE)
    } else if (pos.segment === 'FUTURES') {
      const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(pos.symbol))
      price = cached?.ltp && cached.ltp > 0 ? cached.ltp : (futureMap.get(pos.symbol) || 0)
      if (price > 0) cache.set(CacheKeys.futurePrice(pos.symbol), { ltp: price }, CacheTTL.FUTURE_PRICE)
    } else if (pos.segment === 'OPTIONS') {
      const optKey = CacheKeys.optionPrice(pos.symbol, pos.optionType || 'CE', pos.strikePrice || 0)
      const cached = cache.get<{ ltp: number }>(optKey)
      price = cached?.ltp && cached.ltp > 0 ? cached.ltp : (optionMap.get(`${pos.symbol}:${pos.optionType}:${pos.strikePrice}`) || 0)
      if (price > 0) cache.set(optKey, { ltp: price }, CacheTTL.OPTION_PRICE)
    }

    priceMap.set(pos.segment + ':' + pos.symbol + ':' + pos.optionType + ':' + pos.strikePrice, price)
  }

  return priceMap
}

// ─── Helper: Get position map key ────────────────────────────────────────────

function posKey(pos: { segment: string; symbol: string; optionType: string | null; strikePrice: number | null }): string {
  return `${pos.segment}:${pos.symbol}:${pos.optionType}:${pos.strikePrice}`
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const tradeRoutes = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/positions — All positions (open + closed) with live prices
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/positions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Fetch all positions ordered by isOpen desc, createdAt desc
    const positions = await db.position.findMany({
      where: { userId },
      orderBy: [{ isOpen: 'desc' }, { createdAt: 'desc' }],
    })

    if (positions.length === 0) {
      return res.json({ success: true, data: [], count: 0 })
    }

    // Batch resolve prices for open positions
    const priceMap = await batchResolvePrices(positions)

    // Enrich positions
    const enriched = positions.map(pos => {
      const currentPrice = pos.isOpen
        ? (priceMap.get(posKey(pos)) || pos.currentPrice)
        : pos.currentPrice

      let unrealizedPnl = 0
      if (pos.isOpen && currentPrice > 0) {
        if (pos.tradeDirection === 'BUY') {
          unrealizedPnl = Math.round((currentPrice - pos.entryPrice) * pos.quantity * 100) / 100
        } else {
          unrealizedPnl = Math.round((pos.entryPrice - currentPrice) * pos.quantity * 100) / 100
        }
      }

      return {
        ...pos,
        currentPrice: pos.isOpen ? currentPrice : pos.currentPrice,
        currentValue: pos.isOpen ? Math.round(currentPrice * pos.quantity * 100) / 100 : pos.currentValue,
        unrealizedPnl,
      }
    })

    return res.json({ success: true, data: enriched, count: enriched.length })
  } catch (error) {
    logger.error('[GET /positions]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch positions' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/portfolio — Portfolio summary with segment breakdown
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/portfolio', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Parallel: user data + open positions + realized P&L aggregate
    const [user, openPositions, realizedAggregate] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          virtualBalance: true,
          marginUsed: true,
          totalPnl: true,
          totalTrades: true,
        },
      }),
      db.position.findMany({
        where: { userId, isOpen: true },
      }),
      db.position.aggregate({
        where: { userId, isOpen: false, realizedPnl: { not: 0 } },
        _sum: { realizedPnl: true },
      }),
    ])

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const totalRealizedPnl = Math.round((realizedAggregate._sum.realizedPnl || 0) * 100) / 100

    // Fast path: no open positions
    if (openPositions.length === 0) {
      return res.json({
        success: true,
        data: {
          virtualBalance: Math.round(user.virtualBalance * 100) / 100,
          marginUsed: 0,
          availableMargin: Math.round(user.virtualBalance * 100) / 100,
          totalInvested: 0,
          totalCurrentValue: 0,
          totalUnrealizedPnl: 0,
          totalRealizedPnl,
          totalPortfolioValue: Math.round((user.virtualBalance + totalRealizedPnl) * 100) / 100,
          totalPnl: Math.round(totalRealizedPnl * 100) / 100,
          totalReturn: 0,
          totalTrades: user.totalTrades,
          initialCapital: 100000,
          openPositionsCount: 0,
          segments: {
            equity: { count: 0, invested: 0, current: 0, pnl: 0 },
            futures: { count: 0, invested: 0, current: 0, pnl: 0 },
            options: { count: 0, invested: 0, current: 0, pnl: 0 },
          },
          positions: [],
        },
      })
    }

    // Batch price resolution
    const priceMap = await batchResolvePrices(openPositions)

    let totalInvested = 0
    let totalCurrentValue = 0
    let totalUnrealizedPnl = 0
    const segments = {
      equity: { count: 0, invested: 0, current: 0, pnl: 0 },
      futures: { count: 0, invested: 0, current: 0, pnl: 0 },
      options: { count: 0, invested: 0, current: 0, pnl: 0 },
    }

    const enrichedPositions = openPositions.map(pos => {
      const currentPrice = priceMap.get(posKey(pos)) || pos.currentPrice
      const currentValue = Math.round(currentPrice * pos.quantity * 100) / 100
      let unrealizedPnl = 0
      if (currentPrice > 0) {
        if (pos.tradeDirection === 'BUY') {
          unrealizedPnl = Math.round((currentPrice - pos.entryPrice) * pos.quantity * 100) / 100
        } else {
          unrealizedPnl = Math.round((pos.entryPrice - currentPrice) * pos.quantity * 100) / 100
        }
      }

      totalInvested += pos.totalInvested
      totalCurrentValue += currentValue
      totalUnrealizedPnl += unrealizedPnl

      // Segment grouping
      const seg = pos.segment.toLowerCase() as 'equity' | 'futures' | 'options'
      if (segments[seg]) {
        segments[seg].count++
        segments[seg].invested += pos.totalInvested
        segments[seg].current += currentValue
        segments[seg].pnl += unrealizedPnl
      }

      return {
        ...pos,
        currentPrice,
        currentValue,
        unrealizedPnl,
      }
    })

    // Round segment values
    for (const seg of Object.values(segments) as Array<{ invested: number; current: number; pnl: number }>) {
      seg.invested = Math.round(seg.invested * 100) / 100
      seg.current = Math.round(seg.current * 100) / 100
      seg.pnl = Math.round(seg.pnl * 100) / 100
    }

    totalInvested = Math.round(totalInvested * 100) / 100
    totalCurrentValue = Math.round(totalCurrentValue * 100) / 100
    totalUnrealizedPnl = Math.round(totalUnrealizedPnl * 100) / 100

    const totalPnl = Math.round((totalUnrealizedPnl + totalRealizedPnl) * 100) / 100
    const totalPortfolioValue = Math.round((user.virtualBalance + totalUnrealizedPnl + user.marginUsed) * 100) / 100
    const availableMargin = Math.round((user.virtualBalance - user.marginUsed) * 100) / 100
    const totalReturn = totalInvested > 0
      ? Math.round((totalUnrealizedPnl / totalInvested) * 10000) / 100
      : 0

    return res.json({
      success: true,
      data: {
        virtualBalance: Math.round(user.virtualBalance * 100) / 100,
        marginUsed: Math.round(user.marginUsed * 100) / 100,
        availableMargin,
        totalInvested,
        totalCurrentValue,
        totalUnrealizedPnl,
        totalRealizedPnl,
        totalPortfolioValue,
        totalPnl,
        totalReturn,
        totalTrades: user.totalTrades,
        initialCapital: 100000,
        openPositionsCount: openPositions.length,
        segments,
        positions: enrichedPositions,
      },
    })
  } catch (error) {
    logger.error('[GET /portfolio]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch portfolio' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/trade/place — Place a new order
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.post('/place', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Validate required fields
    const { symbol, direction, orderType, segment, productType, quantity, stopLoss, target } = req.body

    if (!symbol || !direction || !orderType || !segment || !productType || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: symbol, direction, orderType, segment, productType, quantity',
      })
    }

    // Validate direction
    if (!['BUY', 'SELL'].includes(direction)) {
      return res.status(400).json({ success: false, error: 'Invalid direction. Must be BUY or SELL' })
    }

    // Validate order type
    if (!['MARKET', 'LIMIT', 'SL', 'SL_M'].includes(orderType)) {
      return res.status(400).json({ success: false, error: 'Invalid orderType. Must be MARKET, LIMIT, SL, or SL_M' })
    }

    // Validate segment
    if (!['EQUITY', 'FUTURES', 'OPTIONS'].includes(segment)) {
      return res.status(400).json({ success: false, error: 'Invalid segment. Must be EQUITY, FUTURES, or OPTIONS' })
    }

    // Validate product type
    if (!['INTRADAY', 'DELIVERY', 'CARRY_FORWARD'].includes(productType)) {
      return res.status(400).json({ success: false, error: 'Invalid productType. Must be INTRADAY, DELIVERY, or CARRY_FORWARD' })
    }

    // Validate quantity
    const qtyError = validateOrderQuantity(quantity)
    if (qtyError) {
      return res.status(400).json({ success: false, error: qtyError })
    }

    // Check market status (allow if OPEN or fail-open)
    const marketStatus = await checkMarketStatus()
    if (!marketStatus.isOpen && marketStatus.status !== 'OPEN') {
      return res.status(400).json({ success: false, error: marketStatus.message })
    }

    // Resolve instrument details based on segment
    let entryPrice = 0
    let lotSize = 1
    let instrumentId: string | null = null
    let instrumentName = symbol
    let marginRequired = 0
    let expiryDate: Date | null = null
    let optionType: string | null = null
    let strikePrice: number | null = null

    if (segment === 'EQUITY') {
      const stock = await db.stock.findFirst({
        where: { symbol: symbol.toUpperCase(), isActive: true },
        select: { currentPrice: true, name: true, lotSize: true, id: true },
      })
      if (!stock || stock.currentPrice <= 0) {
        return res.status(400).json({ success: false, error: `Stock ${symbol} not found or price unavailable` })
      }
      entryPrice = stock.currentPrice
      lotSize = stock.lotSize || 1
      instrumentId = stock.id
      instrumentName = stock.name
    } else if (segment === 'FUTURES') {
      const future = await db.future.findFirst({
        where: { underlying: symbol.toUpperCase(), isActive: true },
        orderBy: { expiryDate: 'asc' },
        select: { ltp: true, lotSize: true, id: true, expiryDate: true, marginPercent: true },
      })
      if (!future || future.ltp <= 0) {
        return res.status(400).json({ success: false, error: `Future contract for ${symbol} not found or price unavailable` })
      }
      entryPrice = future.ltp
      lotSize = future.lotSize
      instrumentId = future.id
      expiryDate = future.expiryDate
      marginRequired = Math.round(entryPrice * quantity * (future.marginPercent / 100) * 100) / 100
    } else if (segment === 'OPTIONS') {
      const { optionType: optType, strikePrice: sp, expiryDate: expDate } = req.body
      if (!optType || !['CE', 'PE'].includes(optType) || !sp) {
        return res.status(400).json({ success: false, error: 'Options require optionType (CE/PE) and strikePrice' })
      }
      optionType = optType
      strikePrice = parseFloat(sp)

      const optionWhere: Prisma.OptionWhereInput = {
        underlying: symbol.toUpperCase(),
        optionType: optionType ?? undefined,
        strikePrice,
        isActive: true,
      }
      if (expDate) {
        optionWhere.expiryDate = new Date(expDate)
      }

      const option = await db.option.findFirst({
        where: optionWhere,
        orderBy: { expiryDate: 'asc' },
        select: { ltp: true, id: true, expiryDate: true, underlying: true },
      })
      if (!option || option.ltp <= 0) {
        return res.status(400).json({ success: false, error: `Option ${symbol} ${optType} ${sp} not found or price unavailable` })
      }
      entryPrice = option.ltp
      instrumentId = option.id
      expiryDate = option.expiryDate

      // Get lotSize from Index table for index options, or default to 1
      const indexLotSize = await db.index.findFirst({
        where: { symbol: option.underlying },
        select: { lotSize: true },
      })
      lotSize = indexLotSize?.lotSize || 1
      marginRequired = Math.round(entryPrice * quantity * (getMarginPercent('OPTIONS') / 100) * 100) / 100
    }

    if (entryPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid entry price' })
    }

    // Calculate total value, brokerage, and check balance
    const totalValue = Math.round(quantity * entryPrice * 100) / 100
    const brokerage = calculateBrokerage(totalValue)

    // For SELL in FUTURES/OPTIONS, check margin; for BUY, check full value
    let amountToDeduct: number
    if (direction === 'BUY') {
      amountToDeduct = totalValue + brokerage
    } else {
      amountToDeduct = marginRequired > 0 ? marginRequired + brokerage : totalValue + brokerage
    }

    // Execute in transaction
    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock user row for balance update
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { virtualBalance: true, marginUsed: true },
      })
      if (!user) throw new Error('User not found')

      const availableBalance = direction === 'BUY'
        ? user.virtualBalance - user.marginUsed
        : user.virtualBalance - user.marginUsed

      if (availableBalance < amountToDeduct) {
        throw new Error(`Insufficient balance. Available: ₹${Math.round(availableBalance * 100) / 100}, Required: ₹${amountToDeduct}`)
      }

      // Create order
      const order = await tx.order.create({
        data: {
          userId,
          orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
          tradeDirection: direction as 'BUY' | 'SELL',
          segment,
          productType,
          symbol: symbol.toUpperCase(),
          instrumentId,
          optionType,
          strikePrice,
          expiryDate,
          lotSize,
          lots: Math.floor(quantity / lotSize) || 1,
          quantity,
          price: entryPrice,
          fillPrice: entryPrice,
          totalValue,
          brokerage,
          marginRequired,
          stopLoss: stopLoss || null,
          target: target || null,
          status: 'FILLED',
          filledAt: new Date(),
        },
      })

      // Create trade
      const trade = await tx.trade.create({
        data: {
          userId,
          orderId: order.id,
          segment,
          productType,
          tradeDirection: direction as 'BUY' | 'SELL',
          symbol: symbol.toUpperCase(),
          instrumentId,
          optionType,
          strikePrice,
          quantity,
          fillPrice: entryPrice,
          totalValue,
          brokerage,
          expiryDate,
        },
      })

      // Create position with SL/Target
      const slData = slTargetData(direction, entryPrice, stopLoss, target)
      const position = await tx.position.create({
        data: {
          userId,
          segment,
          productType,
          tradeDirection: direction as 'BUY' | 'SELL',
          symbol: symbol.toUpperCase(),
          instrumentId,
          optionType,
          strikePrice,
          expiryDate,
          lotSize,
          lots: Math.floor(quantity / lotSize) || 1,
          quantity,
          entryPrice,
          currentPrice: entryPrice,
          totalInvested: totalValue,
          currentValue: totalValue,
          marginUsed: direction === 'SELL' ? marginRequired : totalValue,
          ...slData,
        },
      })

      // Update user balance
      let updatedUser
      if (direction === 'BUY') {
        updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            virtualBalance: { decrement: totalValue + brokerage },
            marginUsed: { increment: totalValue },
            totalTrades: { increment: 1 },
          },
          select: { virtualBalance: true, marginUsed: true, totalPnl: true, totalTrades: true },
        })
      } else {
        updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            virtualBalance: { decrement: marginRequired > 0 ? marginRequired + brokerage : totalValue + brokerage },
            marginUsed: { increment: marginRequired > 0 ? marginRequired : totalValue },
            totalTrades: { increment: 1 },
          },
          select: { virtualBalance: true, marginUsed: true, totalPnl: true, totalTrades: true },
        })
      }

      return { order, trade, position, balance: updatedUser }
    }, {
      maxWait: 5000,
      timeout: 10000,
    })

    // Start AutoExitWorker if SL or Target was set
    if (stopLoss || target) {
      getAutoExitWorker().ensureRunning()
    }

    // Invalidate user balance cache
    cache.delete(CacheKeys.userBalance(userId))

    return res.status(201).json({
      success: true,
      message: `Order placed successfully — ${direction} ${quantity} x ${symbol.toUpperCase()}`,
      order: result.order,
      trade: result.trade,
      position: result.position,
      balance: {
        virtualBalance: Math.round(result.balance.virtualBalance * 100) / 100,
        marginUsed: Math.round(result.balance.marginUsed * 100) / 100,
        totalPnl: Math.round(result.balance.totalPnl * 100) / 100,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to place order'
    logger.error('[POST /place]', error)
    if (message.includes('Insufficient balance')) {
      return res.status(400).json({ success: false, error: message })
    }
    return res.status(500).json({ success: false, error: message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/trade/square-off — Close an open position
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.post('/square-off', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { positionId } = req.body

    if (!positionId) {
      return res.status(400).json({ success: false, error: 'positionId is required' })
    }

    // Find the open position
    const position = await db.position.findFirst({
      where: { id: positionId, userId, isOpen: true },
    })

    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found or already closed' })
    }

    // Resolve current price (cache → OC manager → DB)
    let exitPrice = await resolveCurrentPrice(position)
    if (exitPrice <= 0) {
      exitPrice = position.currentPrice
    }
    if (exitPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Unable to determine current price for square-off' })
    }

    const closeDirection: 'BUY' | 'SELL' = position.tradeDirection === 'BUY' ? 'SELL' : 'BUY'
    const totalValue = Math.round(position.quantity * exitPrice * 100) / 100
    const brokerage = calculateBrokerage(totalValue)

    // Calculate P&L
    let realizedPnl: number
    if (position.tradeDirection === 'BUY') {
      realizedPnl = Math.round(((exitPrice - position.entryPrice) * position.quantity - brokerage) * 100) / 100
    } else {
      realizedPnl = Math.round(((position.entryPrice - exitPrice) * position.quantity - brokerage) * 100) / 100
    }

    // Execute in transaction
    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Re-check position is still open (prevent double square-off)
      const freshPos = await tx.position.findFirst({
        where: { id: positionId, isOpen: true },
      })
      if (!freshPos) throw new Error('Position already closed')

      // Create exit order
      const order = await tx.order.create({
        data: {
          userId,
          orderType: 'MARKET',
          tradeDirection: closeDirection,
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
          price: exitPrice,
          fillPrice: exitPrice,
          totalValue,
          brokerage,
          marginRequired: position.marginUsed,
          status: 'FILLED',
          filledAt: new Date(),
        },
      })

      // Create exit trade
      const pnlPercent = position.entryPrice > 0
        ? Math.round((realizedPnl / position.totalInvested) * 10000) / 100
        : 0

      const trade = await tx.trade.create({
        data: {
          userId,
          orderId: order.id,
          segment: position.segment,
          productType: position.productType,
          tradeDirection: closeDirection,
          symbol: position.symbol,
          instrumentId: position.instrumentId,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
          quantity: position.quantity,
          fillPrice: exitPrice,
          totalValue,
          brokerage,
          pnl: realizedPnl,
          pnlPercent,
          expiryDate: position.expiryDate,
          squaredOffAt: new Date(),
        },
      })

      // Close position
      const closedPosition = await tx.position.update({
        where: { id: positionId },
        data: {
          isOpen: false,
          currentPrice: exitPrice,
          currentValue: 0,
          unrealizedPnl: 0,
          realizedPnl: { increment: realizedPnl },
          squaredOffAt: new Date(),
          exitReason: 'MANUAL',
          slTriggerLock: null,
        },
      })

      // Update user balance
      if (position.tradeDirection === 'BUY') {
        // Release full margin + add proceeds
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
        // SELL position: return margin + P&L
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

      // Get updated balance
      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { virtualBalance: true, marginUsed: true, totalPnl: true },
      })

      return { order, trade, closedPosition, balance: updatedUser }
    }, {
      maxWait: 5000,
      timeout: 10000,
    })

    // Invalidate cache
    cache.delete(CacheKeys.userBalance(userId))

    return res.json({
      success: true,
      message: `Position squared off — ${position.symbol} ${position.tradeDirection} @ ₹${exitPrice}`,
      order: result.order,
      trade: result.trade,
      closedPosition: result.closedPosition,
      balance: {
        virtualBalance: Math.round(result.balance!.virtualBalance * 100) / 100,
        marginUsed: Math.round(result.balance!.marginUsed * 100) / 100,
        totalPnl: Math.round(result.balance!.totalPnl * 100) / 100,
      },
      totalPnl: realizedPnl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to square off position'
    logger.error('[POST /square-off]', error)
    if (message.includes('already closed')) {
      return res.status(400).json({ success: false, error: message })
    }
    return res.status(500).json({ success: false, error: message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/orders — Paginated orders
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/orders', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { status, limit = '20', offset = '0' } = req.query

    const take = Math.min(parseInt(limit as string, 10) || 20, 100)
    const skip = parseInt(offset as string, 10) || 0

    const where: Prisma.OrderWhereInput = { userId }
    if (status && typeof status === 'string' && status !== '') {
      where.status = status
    }

    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        take,
        skip,
      }),
      db.order.count({ where }),
    ])

    return res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        limit: take,
        offset: skip,
        hasMore: skip + take < total,
      },
    })
  } catch (error) {
    logger.error('[GET /orders]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch orders' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/trades — Paginated trades
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/trades', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { limit = '20', offset = '0' } = req.query

    const take = Math.min(parseInt(limit as string, 10) || 20, 100)
    const skip = parseInt(offset as string, 10) || 0

    const [trades, total] = await Promise.all([
      db.trade.findMany({
        where: { userId },
        orderBy: { executedAt: 'desc' },
        take,
        skip,
      }),
      db.trade.count({ where: { userId } }),
    ])

    return res.json({
      success: true,
      data: trades,
      pagination: {
        total,
        limit: take,
        offset: skip,
        hasMore: skip + take < total,
      },
    })
  } catch (error) {
    logger.error('[GET /trades]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch trades' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/trade/sl-set — Set / update stop-loss and/or target
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.post('/sl-set', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { positionId, stopLoss, target } = req.body

    if (!positionId) {
      return res.status(400).json({ success: false, error: 'positionId is required' })
    }

    if (stopLoss === undefined && target === undefined) {
      return res.status(400).json({ success: false, error: 'At least one of stopLoss or target is required' })
    }

    // Find the position
    const position = await db.position.findFirst({
      where: { id: positionId, userId, isOpen: true },
    })

    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found or already closed' })
    }

    // Build update data using slTargetData helper
    const updateData = slTargetData(position.tradeDirection, position.entryPrice, stopLoss, target)

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid SL/Target values for the position direction and entry price',
      })
    }

    // Set lastCheckedPrice to current live price if available
    const currentPrice = await resolveCurrentPrice(position)
    if (currentPrice > 0) {
      updateData.lastCheckedPrice = currentPrice
    }

    // Update position
    const updated = await db.position.update({
      where: { id: positionId },
      data: updateData,
    })

    // Start AutoExitWorker to monitor
    getAutoExitWorker().ensureRunning()

    return res.json({
      success: true,
      message: 'Stop-loss / target updated successfully',
      data: updated,
    })
  } catch (error) {
    logger.error('[POST /sl-set]', error)
    return res.status(500).json({ success: false, error: 'Failed to set stop-loss / target' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/watchlist — User's watchlist
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/watchlist', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Return empty array for now — watchlist feature pending implementation
    return res.json({ success: true, data: [] })
  } catch (error) {
    logger.error('[GET /watchlist]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch watchlist' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/stocks — Stock list for trading page picker
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/stocks', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { search, limit = '50', offset = '0' } = req.query

    const take = Math.min(parseInt(limit as string, 10) || 50, 200)
    const skip = parseInt(offset as string, 10) || 0

    const where: Prisma.StockWhereInput = { isActive: true }
    if (search && typeof search === 'string' && search.trim()) {
      where.OR = [
        { symbol: { contains: search.trim().toUpperCase(), mode: 'insensitive' } },
        { name: { contains: search.trim(), mode: 'insensitive' } },
      ]
    }

    const [stocks, total] = await Promise.all([
      db.stock.findMany({
        where,
        select: {
          symbol: true,
          name: true,
          currentPrice: true,
          change: true,
          changePercent: true,
          sector: true,
          lotSize: true,
          isFuturesAvailable: true,
          isOptionsAvailable: true,
        },
        orderBy: { symbol: 'asc' },
        take,
        skip,
      }),
      db.stock.count({ where }),
    ])

    return res.json({
      success: true,
      data: stocks,
      pagination: {
        total,
        limit: take,
        offset: skip,
        hasMore: skip + take < total,
      },
    })
  } catch (error) {
    logger.error('[GET /stocks]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch stocks' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade/sl-monitor — AutoExitWorker monitoring status
// ═══════════════════════════════════════════════════════════════════════════════

tradeRoutes.get('/sl-monitor', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Count positions with SL or Target for this user
    const monitoredCount = await db.position.count({
      where: {
        userId,
        isOpen: true,
        OR: [
          { stopLoss: { gt: 0 } },
          { target: { gt: 0 } },
        ],
      },
    })

    return res.json({
      success: true,
      data: {
        isRunning: true,
        monitoredPositions: monitoredCount,
      },
    })
  } catch (error) {
    logger.error('[GET /sl-monitor]', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch SL monitor status' })
  }
})