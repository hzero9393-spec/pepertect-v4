import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest, calculateBrokerage, checkMarketStatus, validateOrderQuantity } from '@/lib/trade-auth'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
import { Prisma } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    // ─── Step 1: Authenticate ──────────────────────────────────────
    const auth = await authenticateRequest(request)
    if (auth.error) return auth.error

    const userId = auth.userId
    const body = await request.json()
    const { symbol, direction, orderType, segment, productType, quantity, price } = body

    // ─── Step 2: Input Validation ──────────────────────────────────
    if (!symbol || !direction || !orderType || !segment || !productType || !quantity) {
      return NextResponse.json({ error: 'Missing required fields. Please provide: symbol, direction, orderType, segment, productType, quantity' }, { status: 400 })
    }
    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json({ error: 'Direction must be BUY or SELL' }, { status: 400 })
    }
    if (!['MARKET', 'LIMIT', 'SL', 'SL_M'].includes(orderType)) {
      return NextResponse.json({ error: 'Invalid orderType. Must be: MARKET, LIMIT, SL, or SL_M' }, { status: 400 })
    }
    if (!['EQUITY', 'FUTURES', 'OPTIONS'].includes(segment)) {
      return NextResponse.json({ error: 'Invalid segment. Must be: EQUITY, FUTURES, or OPTIONS' }, { status: 400 })
    }
    if (!['INTRADAY', 'DELIVERY', 'CARRY_FORWARD'].includes(productType)) {
      return NextResponse.json({ error: 'Invalid productType. Must be: INTRADAY, DELIVERY, or CARRY_FORWARD' }, { status: 400 })
    }

    // Quantity validation
    const qtyError = validateOrderQuantity(quantity, segment)
    if (qtyError) {
      return NextResponse.json({ error: qtyError }, { status: 400 })
    }

    // ─── Step 3: Market Status Check ───────────────────────────────
    const enforceMarketHours = process.env.ENFORCE_MARKET_HOURS === 'true'
    if (enforceMarketHours) {
      const marketStatus = await checkMarketStatus()
      if (!marketStatus.isOpen) {
        return NextResponse.json({
          error: `Market is currently ${marketStatus.status}. ${marketStatus.message}`,
          marketStatus: marketStatus.status,
        }, { status: 403 })
      }
    }

    // ─── Step 4: Get user ──────────────────────────────────────────
    let user = await db.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!user.isActive) return NextResponse.json({ error: 'Account is deactivated. Contact support.' }, { status: 403 })

    // ─── Step 4b: Sync marginUsed from actual open short positions ──
    // Prevents stale marginUsed from blocking trades incorrectly
    const realMarginResult = await db.position.aggregate({
      where: { userId, isOpen: true, tradeDirection: 'SELL' },
      _sum: { marginUsed: true },
    })
    const realMarginUsed = realMarginResult._sum.marginUsed || 0
    if (realMarginUsed !== (user.marginUsed || 0)) {
      user = await db.user.update({
        where: { id: userId },
        data: { marginUsed: realMarginUsed },
      })
    }

    // ═══════════════════════════════════════════════════════════════
    // EQUITY Segment
    // ═══════════════════════════════════════════════════════════════
    if (segment === 'EQUITY') {
      // Try cache first, then DB
      let stock = cache.get<{ currentPrice: number; symbol: string; isActive: boolean } & Record<string, unknown>>(
        CacheKeys.stockPrice(symbol)
      ) as (typeof cache extends Map<string, infer V> ? V : never) | null

      if (!stock) {
        stock = await db.stock.findFirst({
          where: { symbol, isActive: true }
        })
        if (stock) {
          cache.set(CacheKeys.stockPrice(stock.symbol), stock, CacheTTL.STOCK_PRICE)
        }
      }

      if (!stock) return NextResponse.json({ error: `Stock not found: ${symbol}` }, { status: 404 })

      const fillPrice = orderType === 'MARKET' ? stock.currentPrice : (price || stock.currentPrice)
      const totalValue = Math.round(quantity * fillPrice * 100) / 100
      const brokerage = calculateBrokerage(totalValue)

      // ─── BUY EQUITY ──────────────────────────────────────────
      if (direction === 'BUY') {
        const requiredAmount = totalValue + brokerage
        const availableBalance = user.virtualBalance - (user.marginUsed || 0)
        if (availableBalance < requiredAmount) {
          return NextResponse.json({
            error: `Insufficient balance. Required: ₹${requiredAmount.toLocaleString('en-IN')}, Available: ₹${availableBalance.toLocaleString('en-IN')}`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { decrement: requiredAmount },
              totalTrades: { increment: 1 },
              totalPnl: { decrement: brokerage },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'BUY',
              segment: 'EQUITY',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol: stock!.symbol,
              quantity,
              price: price || stock!.currentPrice,
              fillPrice,
              totalValue,
              brokerage,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id,
              orderId: order.id,
              segment: 'EQUITY',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY',
              symbol: stock!.symbol,
              quantity,
              fillPrice,
              totalValue,
              brokerage,
            }
          })

          const existingPosition = await tx.position.findFirst({
            where: {
              userId: user.id, symbol: stock!.symbol, segment: 'EQUITY',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY', isOpen: true,
            }
          })

          if (existingPosition) {
            const newQty = existingPosition.quantity + quantity
            const newInvested = existingPosition.totalInvested + totalValue
            const newEntry = newInvested / newQty
            const newCurrent = newQty * stock!.currentPrice
            await tx.position.update({
              where: { id: existingPosition.id },
              data: {
                quantity: newQty,
                entryPrice: Math.round(newEntry * 100) / 100,
                totalInvested: newInvested,
                currentValue: newCurrent,
                currentPrice: stock!.currentPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
              }
            })
          } else {
            const currentValue = quantity * stock!.currentPrice
            await tx.position.create({
              data: {
                userId: user.id, segment: 'EQUITY',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'BUY', symbol: stock!.symbol, quantity,
                entryPrice: fillPrice, currentPrice: stock!.currentPrice,
                totalInvested: totalValue, currentValue,
                unrealizedPnl: Math.round((currentValue - totalValue) * 100) / 100,
                isOpen: true,
              }
            })
          }

          return { order, trade, updatedUser }
        })

        // Invalidate caches
        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `BUY ${quantity} ${stock.symbol} @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
        }, { status: 201 })
      }

      // ─── SELL EQUITY ─────────────────────────────────────────
      if (direction === 'SELL') {
        const position = await db.position.findFirst({
          where: {
            userId: user.id, symbol: stock.symbol, segment: 'EQUITY',
            productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
            isOpen: true, tradeDirection: 'BUY',
          }
        })

        if (!position) {
          return NextResponse.json({
            error: `No open position for ${stock.symbol}. You can only sell stocks you own.`
          }, { status: 400 })
        }

        if (position.quantity < quantity) {
          return NextResponse.json({
            error: `Insufficient quantity. You hold ${position.quantity} shares, trying to sell ${quantity}.`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const proceeds = totalValue - brokerage
          const realizedPnl = Math.round(((fillPrice - position.entryPrice) * quantity - brokerage) * 100) / 100

          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { increment: proceeds },
              totalTrades: { increment: 1 },
              totalPnl: { increment: realizedPnl },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'SELL',
              segment: 'EQUITY',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol: stock!.symbol,
              quantity,
              price: price || stock!.currentPrice,
              fillPrice,
              totalValue,
              brokerage,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id, orderId: order.id, segment: 'EQUITY',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'SELL', symbol: stock!.symbol, quantity,
              fillPrice, totalValue, brokerage, pnl: realizedPnl,
              pnlPercent: position.entryPrice > 0 ? Math.round((realizedPnl / (position.entryPrice * quantity)) * 10000) / 100 : 0,
            }
          })

          const remainingQty = position.quantity - quantity
          if (remainingQty === 0) {
            await tx.position.update({
              where: { id: position.id },
              data: {
                isOpen: false, realizedPnl: { increment: realizedPnl },
                squaredOffAt: new Date(), currentValue: 0, unrealizedPnl: 0,
              }
            })
          } else {
            const newInvested = position.totalInvested - (position.entryPrice * quantity)
            const newCurrent = remainingQty * stock!.currentPrice
            await tx.position.update({
              where: { id: position.id },
              data: {
                quantity: remainingQty, totalInvested: newInvested,
                currentValue: newCurrent, currentPrice: stock!.currentPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
                realizedPnl: { increment: realizedPnl },
              }
            })
          }

          return { order, trade, realizedPnl, updatedUser }
        })

        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `SELL ${quantity} ${stock.symbol} @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          realizedPnl: result.realizedPnl,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
        }, { status: 201 })
      }

      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
    } // end EQUITY

    // ═══════════════════════════════════════════════════════════════
    // FUTURES Segment
    // ═══════════════════════════════════════════════════════════════
    if (segment === 'FUTURES') {
      const lots = body.lots || 1
      const expiryDate = body.expiryDate ? new Date(body.expiryDate) : undefined

      // Try cache first
      let future = cache.get<{ ltp: number; id: string; lotSize: number; marginPercent: number; expiryDate: Date } & Record<string, unknown>>(
        CacheKeys.futurePrice(symbol)
      ) as (typeof cache extends Map<string, infer V> ? V : never) | null

      if (!future) {
        const futureWhere: Record<string, unknown> = {
          underlying: symbol,
          isActive: true,
        }
        if (expiryDate) futureWhere.expiryDate = expiryDate

        future = await db.future.findFirst({
          where: futureWhere,
          orderBy: { expiryDate: 'asc' },
        }) as (Record<string, unknown> & { ltp: number; id: string; lotSize: number; marginPercent: number; expiryDate: Date }) | null

        if (future) {
          cache.set(CacheKeys.futurePrice(symbol), future, CacheTTL.FUTURE_PRICE)
        }
      }

      const indexData = await db.index.findFirst({
        where: { symbol },
      })

      const lotSize = indexData?.lotSize || (future as Record<string, unknown>)?.lotSize as number || 50
      const fillPrice = future ? (future as Record<string, unknown>).ltp as number : (price || 0)
      const totalQty = lots * lotSize
      const totalValue = Math.round(totalQty * fillPrice * 100) / 100
      const brokerage = calculateBrokerage(totalValue)
      const marginPercent = (future as Record<string, unknown>)?.marginPercent as number || 12
      const marginRequired = Math.round(totalValue * marginPercent / 100 * 100) / 100

      if (!future) {
        return NextResponse.json({ error: `Futures contract not found for ${symbol}` }, { status: 404 })
      }

      // ─── BUY FUTURES ──────────────────────────────────────
      if (direction === 'BUY') {
        const availableBalance = user.virtualBalance - (user.marginUsed || 0)
        if (availableBalance < marginRequired) {
          return NextResponse.json({
            error: `Insufficient margin. Required: ₹${marginRequired.toLocaleString('en-IN')}, Available: ₹${availableBalance.toLocaleString('en-IN')}`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { decrement: marginRequired },
              marginUsed: { increment: marginRequired },
              totalTrades: { increment: 1 },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'BUY',
              segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol,
              instrumentId: (future as Record<string, unknown>).id as string,
              quantity: totalQty,
              lotSize,
              lots,
              price: price || fillPrice,
              fillPrice,
              totalValue,
              brokerage,
              marginRequired,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id,
              orderId: order.id,
              segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY',
              symbol,
              instrumentId: (future as Record<string, unknown>).id as string,
              quantity: totalQty,
              fillPrice,
              totalValue,
              brokerage,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
            }
          })

          const existingPosition = await tx.position.findFirst({
            where: {
              userId: user.id, symbol, segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY', isOpen: true,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
            }
          })

          if (existingPosition) {
            const newQty = existingPosition.quantity + totalQty
            const newInvested = existingPosition.totalInvested + totalValue
            const newEntry = newInvested / newQty
            const newCurrent = newQty * fillPrice
            const newMargin = existingPosition.marginUsed + marginRequired
            await tx.position.update({
              where: { id: existingPosition.id },
              data: {
                quantity: newQty,
                lots: existingPosition.lots + lots,
                entryPrice: Math.round(newEntry * 100) / 100,
                totalInvested: newInvested,
                currentValue: newCurrent,
                currentPrice: fillPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
                marginUsed: newMargin,
              }
            })
          } else {
            const currentValue = totalQty * fillPrice
            await tx.position.create({
              data: {
                userId: user.id, segment: 'FUTURES',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'BUY', symbol, quantity: totalQty,
                lotSize, lots,
                entryPrice: fillPrice, currentPrice: fillPrice,
                totalInvested: totalValue, currentValue,
                unrealizedPnl: Math.round((currentValue - totalValue) * 100) / 100,
                marginUsed: marginRequired,
                instrumentId: (future as Record<string, unknown>).id as string,
                expiryDate: (future as Record<string, unknown>).expiryDate as Date,
                isOpen: true,
              }
            })
          }

          return { order, trade, updatedUser }
        })

        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `BUY ${lots} lots (${totalQty} qty) ${symbol} FUT @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
          marginRequired,
        }, { status: 201 })
      }

      // ─── SELL FUTURES ─────────────────────────────────────
      if (direction === 'SELL') {
        const availableBalance = user.virtualBalance - (user.marginUsed || 0)
        if (availableBalance < marginRequired) {
          return NextResponse.json({
            error: `Insufficient margin for short position. Required: ₹${marginRequired.toLocaleString('en-IN')}, Available: ₹${availableBalance.toLocaleString('en-IN')}`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { decrement: marginRequired },
              marginUsed: { increment: marginRequired },
              totalTrades: { increment: 1 },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'SELL',
              segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol,
              instrumentId: (future as Record<string, unknown>).id as string,
              quantity: totalQty,
              lotSize,
              lots,
              price: price || fillPrice,
              fillPrice,
              totalValue,
              brokerage,
              marginRequired,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id,
              orderId: order.id,
              segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'SELL',
              symbol,
              instrumentId: (future as Record<string, unknown>).id as string,
              quantity: totalQty,
              fillPrice,
              totalValue,
              brokerage,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
            }
          })

          const existingPosition = await tx.position.findFirst({
            where: {
              userId: user.id, symbol, segment: 'FUTURES',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'SELL', isOpen: true,
              expiryDate: (future as Record<string, unknown>).expiryDate as Date,
            }
          })

          if (existingPosition) {
            const newQty = existingPosition.quantity + totalQty
            const newInvested = existingPosition.totalInvested + totalValue
            const newEntry = newInvested / newQty
            const newCurrent = newQty * fillPrice
            const newMargin = existingPosition.marginUsed + marginRequired
            await tx.position.update({
              where: { id: existingPosition.id },
              data: {
                quantity: newQty,
                lots: existingPosition.lots + lots,
                entryPrice: Math.round(newEntry * 100) / 100,
                totalInvested: newInvested,
                currentValue: newCurrent,
                currentPrice: fillPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
                marginUsed: newMargin,
              }
            })
          } else {
            const currentValue = totalQty * fillPrice
            await tx.position.create({
              data: {
                userId: user.id, segment: 'FUTURES',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'SELL', symbol, quantity: totalQty,
                lotSize, lots,
                entryPrice: fillPrice, currentPrice: fillPrice,
                totalInvested: totalValue, currentValue,
                unrealizedPnl: Math.round((currentValue - totalValue) * 100) / 100,
                marginUsed: marginRequired,
                instrumentId: (future as Record<string, unknown>).id as string,
                expiryDate: (future as Record<string, unknown>).expiryDate as Date,
                isOpen: true,
              }
            })
          }

          return { order, trade, updatedUser }
        })

        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `SELL ${lots} lots (${totalQty} qty) ${symbol} FUT @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
          marginRequired,
        }, { status: 201 })
      }

      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
    } // end FUTURES

    // ═══════════════════════════════════════════════════════════════
    // OPTIONS Segment
    // ═══════════════════════════════════════════════════════════════
    if (segment === 'OPTIONS') {
      const lots = body.lots || 1
      const optionType = body.optionType
      const strikePrice = body.strikePrice
      const requestExpiry = body.expiryDate ? new Date(body.expiryDate) : null
      const requestLtp = body.ltp || null // LTP from live option chain

      if (!optionType || !['CE', 'PE'].includes(optionType)) {
        return NextResponse.json({ error: 'optionType is required and must be CE or PE' }, { status: 400 })
      }
      if (!strikePrice || strikePrice <= 0) {
        return NextResponse.json({ error: 'strikePrice is required and must be positive' }, { status: 400 })
      }

      // Try cache first, then DB lookup
      let option = cache.get<{ ltp: number; id: string; expiryDate: Date } & Record<string, unknown>>(
        CacheKeys.optionPrice(symbol, optionType, strikePrice)
      ) as (Record<string, unknown> & { ltp: number; id: string; expiryDate: Date }) | null

      if (!option) {
        option = await db.option.findFirst({
          where: {
            underlying: symbol,
            optionType: optionType as 'CE' | 'PE',
            strikePrice,
            isActive: true,
            ...(requestExpiry ? { expiryDate: requestExpiry } : {}),
          },
          orderBy: { expiryDate: 'asc' },
        }) as (Record<string, unknown> & { ltp: number; id: string; expiryDate: Date }) | null

        if (option) {
          cache.set(CacheKeys.optionPrice(symbol, optionType, strikePrice), option, CacheTTL.OPTION_PRICE)
        }
      }

      // For index options from live option chain, use request data if DB lookup fails
      const isLiveOption = !option && requestLtp && requestExpiry
      if (isLiveOption) {
        option = {
          id: `live-${symbol}-${strikePrice}-${optionType}-${body.expiryDate}`,
          ltp: requestLtp,
          expiryDate: requestExpiry,
        } as unknown as typeof option
      }

      if (!option) {
        return NextResponse.json({
          error: `Option not found: ${symbol} ${strikePrice} ${optionType}. Provide ltp and expiryDate for live options.`
        }, { status: 404 })
      }

      const indexData = await db.index.findFirst({
        where: { symbol },
      })
      const lotSize = body.lotSize || indexData?.lotSize || 50

      const fillPrice = orderType === 'MARKET' ? option.ltp : (price || option.ltp)
      const totalQty = lots * lotSize
      const totalValue = Math.round(totalQty * fillPrice * 100) / 100
      const brokerage = calculateBrokerage(totalValue)

      // ─── BUY OPTIONS ──────────────────────────────────────
      if (direction === 'BUY') {
        const requiredAmount = totalValue + brokerage
        // Available balance = virtualBalance - marginUsed (margin blocked in short positions)
        const availableBalance = user.virtualBalance - (user.marginUsed || 0)
        if (availableBalance < requiredAmount) {
          return NextResponse.json({
            error: `Insufficient balance. Required: ₹${requiredAmount.toLocaleString('en-IN')}, Available: ₹${availableBalance.toLocaleString('en-IN')} (Balance: ₹${user.virtualBalance.toLocaleString('en-IN')} - Margin: ₹${(user.marginUsed || 0).toLocaleString('en-IN')})`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { decrement: requiredAmount },
              totalTrades: { increment: 1 },
              totalPnl: { decrement: brokerage },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'BUY',
              segment: 'OPTIONS',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol,
              instrumentId: option!.id,
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              expiryDate: option!.expiryDate,
              quantity: totalQty,
              lotSize,
              lots,
              price: price || fillPrice,
              fillPrice,
              totalValue,
              brokerage,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id,
              orderId: order.id,
              segment: 'OPTIONS',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY',
              symbol,
              instrumentId: option!.id,
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              expiryDate: option!.expiryDate,
              quantity: totalQty,
              fillPrice,
              totalValue,
              brokerage,
            }
          })

          const existingPosition = await tx.position.findFirst({
            where: {
              userId: user.id, symbol, segment: 'OPTIONS',
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'BUY', isOpen: true,
              expiryDate: option!.expiryDate,
            }
          })

          let positionId: string

          if (existingPosition) {
            const newQty = existingPosition.quantity + totalQty
            const newInvested = existingPosition.totalInvested + totalValue
            const newEntry = newInvested / newQty
            const newCurrent = newQty * fillPrice
            await tx.position.update({
              where: { id: existingPosition.id },
              data: {
                quantity: newQty,
                lots: existingPosition.lots + lots,
                entryPrice: Math.round(newEntry * 100) / 100,
                totalInvested: newInvested,
                currentValue: newCurrent,
                currentPrice: fillPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
              }
            })
            positionId = existingPosition.id
          } else {
            const currentValue = totalQty * fillPrice
            const pos = await tx.position.create({
              data: {
                userId: user.id, segment: 'OPTIONS',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'BUY', symbol, quantity: totalQty,
                optionType: optionType as 'CE' | 'PE',
                strikePrice,
                lotSize, lots,
                entryPrice: fillPrice, currentPrice: fillPrice,
                totalInvested: totalValue, currentValue,
                unrealizedPnl: Math.round((currentValue - totalValue) * 100) / 100,
                instrumentId: option!.id,
                expiryDate: option!.expiryDate,
                isOpen: true,
              }
            })
            positionId = pos.id
          }

          return { order, trade, updatedUser, positionId }
        })

        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `BUY ${lots} lots (${totalQty} qty) ${symbol} ${strikePrice} ${optionType} @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
          positionId: result.positionId, // For setting SL/Target after trade
        }, { status: 201 })
      }

      // ─── SELL OPTIONS ─────────────────────────────────────
      if (direction === 'SELL') {
        const existingBuyPosition = await db.position.findFirst({
          where: {
            userId: user.id, symbol, segment: 'OPTIONS',
            optionType: optionType as 'CE' | 'PE',
            strikePrice,
            tradeDirection: 'BUY', isOpen: true,
            expiryDate: option.expiryDate,
          }
        })

        // ─── SELL to close existing BUY position ───────────
        if (existingBuyPosition) {
          if (existingBuyPosition.quantity < totalQty) {
            return NextResponse.json({
              error: `Insufficient quantity. You hold ${existingBuyPosition.quantity} qty, trying to sell ${totalQty} qty.`
            }, { status: 400 })
          }

          const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const proceeds = totalValue - brokerage
            const realizedPnl = Math.round(((fillPrice - existingBuyPosition.entryPrice) * totalQty - brokerage) * 100) / 100

            const updatedUser = await tx.user.update({
              where: { id: user.id },
              data: {
                virtualBalance: { increment: proceeds },
                totalTrades: { increment: 1 },
                totalPnl: { increment: realizedPnl },
              }
            })

            const order = await tx.order.create({
              data: {
                userId: user.id,
                orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
                tradeDirection: 'SELL',
                segment: 'OPTIONS',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                symbol,
                instrumentId: option!.id,
                optionType: optionType as 'CE' | 'PE',
                strikePrice,
                expiryDate: option!.expiryDate,
                quantity: totalQty,
                lotSize,
                lots,
                price: price || fillPrice,
                fillPrice,
                totalValue,
                brokerage,
                status: 'FILLED',
                filledAt: new Date(),
              }
            })

            const trade = await tx.trade.create({
              data: {
                userId: user.id, orderId: order.id, segment: 'OPTIONS',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'SELL', symbol,
                instrumentId: option!.id,
                optionType: optionType as 'CE' | 'PE',
                strikePrice,
                expiryDate: option!.expiryDate,
                quantity: totalQty,
                fillPrice, totalValue, brokerage, pnl: realizedPnl,
                pnlPercent: existingBuyPosition.entryPrice > 0
                  ? Math.round((realizedPnl / (existingBuyPosition.entryPrice * totalQty)) * 10000) / 100
                  : 0,
              }
            })

            const remainingQty = existingBuyPosition.quantity - totalQty
            if (remainingQty === 0) {
              await tx.position.update({
                where: { id: existingBuyPosition.id },
                data: {
                  isOpen: false, realizedPnl: { increment: realizedPnl },
                  squaredOffAt: new Date(), currentValue: 0, unrealizedPnl: 0,
                }
              })
            } else {
              const newInvested = existingBuyPosition.totalInvested - (existingBuyPosition.entryPrice * totalQty)
              const newCurrent = remainingQty * fillPrice
              await tx.position.update({
                where: { id: existingBuyPosition.id },
                data: {
                  quantity: remainingQty,
                  lots: existingBuyPosition.lots - lots,
                  totalInvested: newInvested,
                  currentValue: newCurrent,
                  currentPrice: fillPrice,
                  unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
                  realizedPnl: { increment: realizedPnl },
                }
              })
            }

            return { order, trade, realizedPnl, updatedUser }
          })

          cache.deleteByPrefix(`ubal:${userId}`)
          if (auth.token) cache.delete(CacheKeys.auth(auth.token))

          return NextResponse.json({
            success: true,
            message: `SELL ${lots} lots (${totalQty} qty) ${symbol} ${strikePrice} ${optionType} @ ₹${fillPrice}`,
            order: result.order,
            trade: result.trade,
            realizedPnl: result.realizedPnl,
            balance: result.updatedUser.virtualBalance,
            totalPnl: result.updatedUser.totalPnl,
          }, { status: 201 })
        }

        // ─── SELL to open short position (no existing BUY) ──
        const marginPercent = 150
        const marginRequired = Math.round(totalValue * marginPercent / 100 * 100) / 100

        // Available balance = virtualBalance - marginUsed (margin blocked in other short positions)
        const availableBalance = user.virtualBalance - (user.marginUsed || 0)
        if (availableBalance < marginRequired) {
          return NextResponse.json({
            error: `Insufficient margin for short option. Required: ₹${marginRequired.toLocaleString('en-IN')}, Available: ₹${availableBalance.toLocaleString('en-IN')} (Balance: ₹${user.virtualBalance.toLocaleString('en-IN')} - Margin: ₹${(user.marginUsed || 0).toLocaleString('en-IN')})`
          }, { status: 400 })
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const netDebit = marginRequired - totalValue + brokerage
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              virtualBalance: { decrement: netDebit },
              marginUsed: { increment: marginRequired },
              totalTrades: { increment: 1 },
              totalPnl: { decrement: brokerage },
            }
          })

          const order = await tx.order.create({
            data: {
              userId: user.id,
              orderType: orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
              tradeDirection: 'SELL',
              segment: 'OPTIONS',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              symbol,
              instrumentId: option!.id,
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              expiryDate: option!.expiryDate,
              quantity: totalQty,
              lotSize,
              lots,
              price: price || fillPrice,
              fillPrice,
              totalValue,
              brokerage,
              marginRequired,
              status: 'FILLED',
              filledAt: new Date(),
            }
          })

          const trade = await tx.trade.create({
            data: {
              userId: user.id,
              orderId: order.id,
              segment: 'OPTIONS',
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'SELL',
              symbol,
              instrumentId: option!.id,
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              expiryDate: option!.expiryDate,
              quantity: totalQty,
              fillPrice,
              totalValue,
              brokerage,
            }
          })

          const existingSellPosition = await tx.position.findFirst({
            where: {
              userId: user.id, symbol, segment: 'OPTIONS',
              optionType: optionType as 'CE' | 'PE',
              strikePrice,
              productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
              tradeDirection: 'SELL', isOpen: true,
              expiryDate: option!.expiryDate,
            }
          })

          if (existingSellPosition) {
            const newQty = existingSellPosition.quantity + totalQty
            const newInvested = existingSellPosition.totalInvested + totalValue
            const newEntry = newInvested / newQty
            const newCurrent = newQty * fillPrice
            const newMargin = existingSellPosition.marginUsed + marginRequired
            await tx.position.update({
              where: { id: existingSellPosition.id },
              data: {
                quantity: newQty,
                lots: existingSellPosition.lots + lots,
                entryPrice: Math.round(newEntry * 100) / 100,
                totalInvested: newInvested,
                currentValue: newCurrent,
                currentPrice: fillPrice,
                unrealizedPnl: Math.round((newCurrent - newInvested) * 100) / 100,
                marginUsed: newMargin,
              }
            })
          } else {
            const currentValue = totalQty * fillPrice
            await tx.position.create({
              data: {
                userId: user.id, segment: 'OPTIONS',
                productType: productType as 'INTRADAY' | 'DELIVERY' | 'CARRY_FORWARD',
                tradeDirection: 'SELL', symbol, quantity: totalQty,
                optionType: optionType as 'CE' | 'PE',
                strikePrice,
                lotSize, lots,
                entryPrice: fillPrice, currentPrice: fillPrice,
                totalInvested: totalValue, currentValue,
                unrealizedPnl: Math.round((currentValue - totalValue) * 100) / 100,
                marginUsed: marginRequired,
                instrumentId: option!.id,
                expiryDate: option!.expiryDate,
                isOpen: true,
              }
            })
          }

          return { order, trade, updatedUser }
        })

        cache.deleteByPrefix(`ubal:${userId}`)
        if (auth.token) cache.delete(CacheKeys.auth(auth.token))

        return NextResponse.json({
          success: true,
          message: `SELL (SHORT) ${lots} lots (${totalQty} qty) ${symbol} ${strikePrice} ${optionType} @ ₹${fillPrice}`,
          order: result.order,
          trade: result.trade,
          balance: result.updatedUser.virtualBalance,
          totalPnl: result.updatedUser.totalPnl,
          marginRequired,
        }, { status: 201 })
      }

      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
    } // end OPTIONS

    return NextResponse.json({ error: `Unsupported segment: ${segment}` }, { status: 400 })
  } catch (error) {
    console.error('[POST /api/trade/place] FULL ERROR:', JSON.stringify(error, null, 2))

    let errorMessage = 'Failed to place order. Please try again.'
    let statusCode = 500

    if (error instanceof Error) {
      const msg = error.message

      // Prisma specific errors
      if (msg.includes('Unique constraint') || msg.includes('unique constraint')) {
        errorMessage = 'Duplicate order detected. Please try again.'
        statusCode = 409
      } else if (msg.includes('Foreign key constraint') || msg.includes('foreign key')) {
        errorMessage = 'Invalid reference: related record not found. Please refresh and try again.'
        statusCode = 400
      } else if (msg.includes('Record not found') || msg.includes('does not exist')) {
        errorMessage = 'Record not found. The stock or user data may have changed. Please refresh.'
        statusCode = 404
      } else if (msg.includes('Transaction failed') || msg.includes('transaction')) {
        errorMessage = 'Transaction failed due to concurrent modification. Please try again.'
        statusCode = 409
      } else if (msg.includes('Interactive transactions are not supported') || msg.includes('interactive transaction')) {
        errorMessage = 'Database transaction not supported. Please contact support.'
        statusCode = 500
      } else if (msg.includes('no such table') || msg.includes('no such column')) {
        errorMessage = 'Database schema out of sync. Please contact support to run migration.'
        statusCode = 500
      } else if (msg.includes('SQLITE_CONSTRAINT')) {
        errorMessage = `Database constraint error: ${msg.slice(0, 100)}`
        statusCode = 400
      } else if (msg.includes('LibsqlError') || msg.includes('HRANA') || msg.includes('SERVER_ERROR')) {
        errorMessage = `Database connection error. Please try again in a moment.`
        statusCode = 503
      } else if (msg.includes('Insufficient') || msg.includes('insufficient')) {
        errorMessage = msg
        statusCode = 400
      } else {
        // Show the actual error message so we can debug - truncate for safety
        errorMessage = `Order failed: ${msg.slice(0, 200)}`
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode })
  }
}
