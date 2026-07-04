/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Auto-Exit Service — Replaces AutoExitWorker singleton
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Polls DB every 500ms for ALL open positions with SL or Target.
 * Gets live prices from MarketDataService (stocks) and OptionChainService (options).
 * Executes auto-exit via atomic DB transaction.
 * Notifies PositionsService of exits (which forwards to WebSocket clients).
 */

import { db } from '../lib/db'
import { cache, CacheKeys, CacheTTL } from '../lib/cache'
import { calculateBrokerage } from '../lib/brokerage'
import type { PositionsService } from './positions'
import type { OptionChainService } from './optionChain'
import type { MarketDataService } from './marketData'

interface MonitoredPosition {
  id: string; userId: string; segment: string; productType: string
  tradeDirection: string; symbol: string; optionType: string | null
  strikePrice: number | null; entryPrice: number; currentPrice: number
  quantity: number; totalInvested: number; marginUsed: number
  stopLoss: number | null; target: number | null; lastCheckedPrice: number | null
  slTriggerLock: string | null; lotSize: number; lots: number
  instrumentId: string | null; expiryDate: Date | null
}

const CONFIG = {
  POLL_INTERVAL_MS: 500,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 200,
  LOCK_TTL_MS: 10_000,
  IDLE_TIMEOUT_MS: 30_000,
}

export class AutoExitService {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastActivity = 0
  private cycleCount = 0
  private positionsService: PositionsService
  private optionChainService: OptionChainService
  private marketService: MarketDataService | null = null

  constructor(positionsService: PositionsService, optionChainService: OptionChainService) {
    this.positionsService = positionsService
    this.optionChainService = optionChainService
  }

  /** Set market service reference (for EQUITY price resolution) */
  setMarketService(market: MarketDataService) {
    this.marketService = market
  }

  ensureRunning() {
    if (this.running) { this.lastActivity = Date.now(); return }
    this.start()
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastActivity = Date.now()

    console.log('[AutoExit] Starting server-side auto-exit engine (500ms interval)')

    // Set service references in positions service
    if (this.marketService) {
      this.positionsService.setServices(this.marketService, this.optionChainService)
    }

    this.runCycle()
    this.timer = setInterval(() => this.runCycle(), CONFIG.POLL_INTERVAL_MS)

    // Idle check
    setInterval(() => {
      if (this.running && Date.now() - this.lastActivity > CONFIG.IDLE_TIMEOUT_MS) {
        this.checkShouldStop()
      }
    }, 30000)
  }

  private async checkShouldStop() {
    try {
      const count = await db.position.count({
        where: { isOpen: true, OR: [{ stopLoss: { gt: 0 } }, { target: { gt: 0 } }] },
      })
      if (count === 0) {
        console.log('[AutoExit] No SL/Target positions — pausing')
      }
    } catch {}
  }

  private async runCycle() {
    this.cycleCount++
    const cycleNum = this.cycleCount

    try {
      const positions = await db.position.findMany({
        where: { isOpen: true, OR: [{ stopLoss: { gt: 0 } }, { target: { gt: 0 } }] },
      })
      if (positions.length === 0) return

      const allPositions = positions.map(pos => {
        if (!pos.lastCheckedPrice || pos.lastCheckedPrice === 0) {
          const price = pos.currentPrice > 0 ? pos.currentPrice : null
          if (price) {
            db.position.update({ where: { id: pos.id }, data: { lastCheckedPrice: price } }).catch(() => {})
          }
          return { ...pos, lastCheckedPrice: price }
        }
        return pos
      })

      for (const position of allPositions) {
        await this.checkPosition(position as MonitoredPosition)
      }

      if (cycleNum % 60 === 0) {
        console.log(`[AutoExit] Cycle ${cycleNum}: monitoring ${allPositions.length} positions`)
      }
    } catch (err) {
      console.error(`[AutoExit] [ERROR] Cycle ${cycleNum}:`, err instanceof Error ? err.message : err)
    }
  }

  private async checkPosition(position: MonitoredPosition) {
    // Skip if locked
    if (position.slTriggerLock) {
      const lockTime = parseInt(position.slTriggerLock.split(':')[1] || '0')
      if (Date.now() - lockTime < CONFIG.LOCK_TTL_MS) return
      await db.position.update({ where: { id: position.id }, data: { slTriggerLock: null } }).catch(() => {})
    }

    const currentPrice = await this.getCurrentPrice(position)
    if (currentPrice <= 0) return

    const triggerReason = this.detectTrigger(position, currentPrice)
    if (!triggerReason) {
      await db.position.update({ where: { id: position.id }, data: { lastCheckedPrice: currentPrice } }).catch(() => {})
      return
    }

    console.log(
      `[AutoExit] [${triggerReason === 'STOP_LOSS' ? 'SL_HIT' : 'TARGET_HIT'}] ` +
      `${position.symbol} ${position.optionType || ''} ${position.strikePrice || ''} ` +
      `pos:${position.id} user:${position.userId} ` +
      `prev:${position.lastCheckedPrice} -> curr:${currentPrice} ` +
      `SL:${position.stopLoss} TGT:${position.target} dir:${position.tradeDirection}`
    )

    const lockId = `auto:${position.id}:${Date.now()}`
    const lockResult = await db.position.updateMany({
      where: { id: position.id, isOpen: true, slTriggerLock: null },
      data: { slTriggerLock: lockId },
    })
    if (lockResult.count === 0) return

    const exitResult = await this.executeExit(position, triggerReason, currentPrice)

    if (exitResult.success) {
      console.log(`[AutoExit] [EXECUTED] ${position.symbol} exit @ ${currentPrice} P&L: ${exitResult.pnl} reason: ${triggerReason}`)

      this.positionsService.pushExitEvent({
        positionId: position.id, userId: position.userId, symbol: position.symbol,
        segment: position.segment, reason: triggerReason, exitPrice: currentPrice,
        pnl: exitResult.pnl ?? 0, tradeDirection: position.tradeDirection, timestamp: Date.now(),
      })
    }
  }

  private async getCurrentPrice(position: MonitoredPosition): Promise<number> {
    if (position.segment === 'EQUITY') {
      // Try MarketDataService first
      if (this.marketService) {
        const stock = this.marketService.stocks[position.symbol.toUpperCase()]
        if (stock?.last_price && stock.last_price > 0) return stock.last_price
      }
      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(position.symbol))
      if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice

      const stock = await db.stock.findFirst({
        where: { symbol: position.symbol, isActive: true }, select: { currentPrice: true },
      })
      if (stock?.currentPrice) {
        cache.set(CacheKeys.stockPrice(position.symbol), { currentPrice: stock.currentPrice }, CacheTTL.STOCK_PRICE)
        return stock.currentPrice
      }
    } else if (position.segment === 'FUTURES') {
      const cached = cache.get<{ ltp: number }>(CacheKeys.futurePrice(position.symbol))
      if (cached?.ltp && cached.ltp > 0) return cached.ltp

      const future = await db.future.findFirst({
        where: { underlying: position.symbol, isActive: true },
        orderBy: { expiryDate: 'asc' }, select: { ltp: true },
      })
      if (future?.ltp) {
        cache.set(CacheKeys.futurePrice(position.symbol), { ltp: future.ltp }, CacheTTL.FUTURE_PRICE)
        return future.ltp
      }
    } else if (position.segment === 'OPTIONS') {
      // Try OptionChainService first (real-time)
      const ltp = this.optionChainService.getOptionLTP(position.symbol, position.optionType || 'CE', position.strikePrice || 0)
      if (ltp > 0) return ltp

      const optKey = CacheKeys.optionPrice(position.symbol, position.optionType || 'CE', position.strikePrice || 0)
      const cached = cache.get<{ ltp: number }>(optKey)
      if (cached?.ltp && cached.ltp > 0) return cached.ltp

      const option = await db.option.findFirst({
        where: {
          underlying: position.symbol, optionType: position.optionType ?? undefined,
          strikePrice: position.strikePrice ?? undefined,
          ...(position.expiryDate ? { expiryDate: position.expiryDate } : {}),
          isActive: true,
        },
        orderBy: { expiryDate: 'asc' }, select: { ltp: true },
      })
      if (option?.ltp) {
        cache.set(optKey, { ltp: option.ltp }, CacheTTL.OPTION_PRICE)
        return option.ltp
      }
    }

    return position.currentPrice
  }

  private detectTrigger(position: MonitoredPosition, currentPrice: number): 'STOP_LOSS' | 'TARGET' | null {
    const { tradeDirection, stopLoss, target, lastCheckedPrice } = position
    if (!stopLoss && !target) return null
    if (currentPrice <= 0) return null

    const isBuy = tradeDirection === 'BUY'
    const hasLastPrice = lastCheckedPrice !== null && lastCheckedPrice !== undefined && lastCheckedPrice > 0

    if (hasLastPrice) {
      const prev = lastCheckedPrice!
      if (isBuy) {
        if (stopLoss && stopLoss > 0 && prev > stopLoss && currentPrice <= stopLoss) return 'STOP_LOSS'
        if (target && target > 0 && prev < target && currentPrice >= target) return 'TARGET'
      } else {
        if (stopLoss && stopLoss > 0 && prev < stopLoss && currentPrice >= stopLoss) return 'STOP_LOSS'
        if (target && target > 0 && prev > target && currentPrice <= target) return 'TARGET'
      }
    }

    if (isBuy) {
      if (stopLoss && stopLoss > 0 && currentPrice <= stopLoss) return 'STOP_LOSS'
      if (target && target > 0 && currentPrice >= target) return 'TARGET'
    } else {
      if (stopLoss && stopLoss > 0 && currentPrice >= stopLoss) return 'STOP_LOSS'
      if (target && target > 0 && currentPrice <= target) return 'TARGET'
    }

    return null
  }

  private async executeExit(
    position: MonitoredPosition,
    reason: 'STOP_LOSS' | 'TARGET',
    currentPrice: number
  ): Promise<{ success: boolean; pnl?: number; error?: string }> {
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

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        const result = await db.$transaction(async (tx: any) => {
          const freshPos = await tx.position.findFirst({ where: { id: position.id, isOpen: true } })
          if (!freshPos) throw new Error('Position already closed')
          if (freshPos.slTriggerLock && freshPos.slTriggerLock !== position.slTriggerLock) {
            throw new Error('Position locked by another process')
          }

          const order = await tx.order.create({
            data: {
              userId: position.userId, orderType: 'MARKET',
              tradeDirection: closeDirection, segment: position.segment,
              productType: position.productType, symbol: position.symbol,
              instrumentId: position.instrumentId, optionType: position.optionType,
              strikePrice: position.strikePrice, expiryDate: position.expiryDate,
              lotSize: position.lotSize, lots: position.lots,
              quantity: position.quantity, price: currentPrice, fillPrice: currentPrice,
              totalValue, brokerage, marginRequired: position.marginUsed,
              status: 'FILLED', filledAt: new Date(),
            }
          })

          const pnlPercent = position.entryPrice > 0
            ? Math.round((realizedPnl / position.totalInvested) * 10000) / 100
            : 0

          await tx.trade.create({
            data: {
              userId: position.userId, orderId: order.id, segment: position.segment,
              productType: position.productType, tradeDirection: closeDirection,
              symbol: position.symbol, instrumentId: position.instrumentId,
              optionType: position.optionType, strikePrice: position.strikePrice,
              quantity: position.quantity, fillPrice: currentPrice,
              totalValue, brokerage, pnl: realizedPnl, pnlPercent,
              expiryDate: position.expiryDate, squaredOffAt: new Date(),
            }
          })

          await tx.position.update({
            where: { id: position.id },
            data: {
              isOpen: false, currentPrice, currentValue: 0, unrealizedPnl: 0,
              realizedPnl: { increment: realizedPnl }, squaredOffAt: new Date(),
              exitReason: reason, slTriggerLock: null,
            }
          })

          if (position.tradeDirection === 'BUY') {
            const proceeds = totalValue - brokerage
            await tx.user.update({
              where: { id: position.userId },
              data: {
                virtualBalance: { increment: proceeds }, totalTrades: { increment: 1 },
                totalPnl: { increment: realizedPnl }, marginUsed: { decrement: position.marginUsed },
              },
            })
          } else {
            const marginReturn = position.marginUsed + realizedPnl
            await tx.user.update({
              where: { id: position.userId },
              data: {
                virtualBalance: { increment: marginReturn }, totalTrades: { increment: 1 },
                totalPnl: { increment: realizedPnl }, marginUsed: { decrement: position.marginUsed },
              },
            })
          }

          return { order }
        }, { maxWait: 5000, timeout: 10000 })

        cache.deleteByPrefix(`ubal:${position.userId}`)
        return { success: true, pnl: realizedPnl }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.includes('already closed') || errMsg.includes('locked by another')) {
          return { success: false, error: errMsg }
        }
        if (attempt < CONFIG.MAX_RETRIES) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)))
        } else {
          try { await db.position.update({ where: { id: position.id }, data: { slTriggerLock: null } }) } catch {}
          return { success: false, error: errMsg }
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' }
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.running = false
  }
}