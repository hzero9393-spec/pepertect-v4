/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Auto-Exit Worker — SERVER-SIDE Background Monitoring Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RUNS ON THE SERVER — NOT the frontend.
 * Singleton on globalThis — starts on first API call, persists across requests.
 *
 * Architecture:
 *   1. Polls DB every 500ms for ALL open positions with SL or Target
 *   2. Gets live prices from cache (populated by MarketDataManager/OptionChainManager)
 *   3. Checks SL/Target conditions with range-based crossing detection
 *   4. Executes auto-exit via atomic DB transaction
 *   5. Notifies subscribers (SSE streams) of exits
 *
 * Fail-Safe:
 *   - Server restart → re-initializes from DB (lastCheckedPrice persists)
 *   - Price jump → range-crossing detection catches it
 *   - Duplicate execution → DB lock (slTriggerLock) + isOpen check
 *   - Stale lock → auto-clears after 10s TTL
 *
 * Logging:
 *   Every event logged: [PRICE_UPDATE], [SL_HIT], [TARGET_HIT], [ORDER_EXECUTED], [ERROR]
 */

import { db } from '@/lib/db'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
import { calculateBrokerage } from '@/lib/trade-auth'
import { Prisma } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

interface MonitoredPosition {
  id: string
  userId: string
  segment: string
  productType: string
  tradeDirection: string
  symbol: string
  optionType: string | null
  strikePrice: number | null
  entryPrice: number
  currentPrice: number
  quantity: number
  totalInvested: number
  marginUsed: number
  stopLoss: number | null
  target: number | null
  lastCheckedPrice: number | null
  slTriggerLock: string | null
  lotSize: number
  lots: number
  instrumentId: string | null
  expiryDate: Date | null
}

export interface ExitEvent {
  positionId: string
  userId: string
  symbol: string
  segment: string
  reason: 'STOP_LOSS' | 'TARGET'
  triggerPrice: number
  pnl: number
  exitPrice: number
  tradeDirection: string
  timestamp: number
}

type ExitSubscriber = (event: ExitEvent) => void

// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG = {
  POLL_INTERVAL_MS: 500,      // Check every 500ms
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 200,
  LOCK_TTL_MS: 10_000,
  IDLE_TIMEOUT_MS: 30_000,    // Stop polling if no SL/Target positions exist
}

// ─── Worker Class ───────────────────────────────────────────────────────────

class AutoExitWorker {
  private static instance: AutoExitWorker | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private subscribers = new Set<ExitSubscriber>()
  private running = false
  private lastActivity = 0
  private cycleCount = 0

  private constructor() {}

  static getInstance(): AutoExitWorker {
    if (!AutoExitWorker.instance) {
      AutoExitWorker.instance = new AutoExitWorker()
    }
    return AutoExitWorker.instance
  }

  /** Subscribe to exit events (for SSE streams) */
  onExit(handler: ExitSubscriber): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Ensure worker is running */
  ensureRunning() {
    if (this.running) {
      this.lastActivity = Date.now()
      return
    }
    this.start()
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastActivity = Date.now()

    console.log('[AutoExit Worker] 🚀 Starting server-side auto-exit engine (500ms interval)')

    // Run first cycle immediately
    this.runCycle()

    // Run every 500ms
    this.timer = setInterval(() => {
      this.runCycle()
    }, CONFIG.POLL_INTERVAL_MS)

    // Check for idle timeout every 30s
    setInterval(() => {
      if (this.running && Date.now() - this.lastActivity > CONFIG.IDLE_TIMEOUT_MS) {
        // Check if there are any positions with SL/Target
        this.checkShouldStop()
      }
    }, 30000)
  }

  private async checkShouldStop() {
    try {
      const count = await db.position.count({
        where: {
          isOpen: true,
          OR: [
            { stopLoss: { gt: 0 } },
            { target: { gt: 0 } },
          ],
        },
      })
      if (count === 0) {
        console.log('[AutoExit Worker] No SL/Target positions — pausing (will resume on next trade)')
        // Don't actually stop — the global SL monitor on frontend keeps calling
        // Just reduce logging noise
      }
    } catch { /* ignore */ }
  }

  private async runCycle() {
    this.cycleCount++
    const cycleNum = this.cycleCount

    try {
      // Fetch all open positions with SL or Target
      const positions = await db.position.findMany({
        where: {
          isOpen: true,
          OR: [
            { stopLoss: { gt: 0 } },
            { target: { gt: 0 } },
          ],
        },
      })

      if (positions.length === 0) return

      // Initialize lastCheckedPrice for new positions (in-memory, no extra DB round-trip)
      const allPositions = positions.map(pos => {
        if (!pos.lastCheckedPrice || pos.lastCheckedPrice === 0) {
          const price = pos.currentPrice > 0 ? pos.currentPrice : null
          if (price) {
            // Fire-and-forget DB update
            db.position.update({
              where: { id: pos.id },
              data: { lastCheckedPrice: price },
            }).catch(() => {})
          }
          return { ...pos, lastCheckedPrice: price }
        }
        return pos
      })

      for (const position of allPositions) {
        await this.checkPosition(position as MonitoredPosition)
      }

      // Log every 60th cycle (~30 seconds)
      if (cycleNum % 60 === 0) {
        console.log(`[AutoExit Worker] ✓ Cycle ${cycleNum}: monitoring ${allPositions.length} positions with SL/Target`)
      }

    } catch (err) {
      console.error(`[AutoExit Worker] [ERROR] Cycle ${cycleNum}:`, err instanceof Error ? err.message : err)
    }
  }

  private async checkPosition(position: MonitoredPosition) {
    // Skip if locked by another process
    if (position.slTriggerLock) {
      const lockTime = parseInt(position.slTriggerLock.split(':')[1] || '0')
      if (Date.now() - lockTime < CONFIG.LOCK_TTL_MS) return
      // Stale lock — clear it
      await db.position.update({
        where: { id: position.id },
        data: { slTriggerLock: null },
      }).catch(() => {})
    }

    // Get current price
    const currentPrice = await this.getCurrentPrice(position)
    if (currentPrice <= 0) return

    // Detect trigger
    const triggerReason = this.detectTrigger(position, currentPrice)
    if (!triggerReason) {
      // No trigger — update lastCheckedPrice
      await db.position.update({
        where: { id: position.id },
        data: { lastCheckedPrice: currentPrice },
      }).catch(() => {})
      return
    }

    // ─── TRIGGER DETECTED ─────────────────────────────────
    console.log(
      `[AutoExit Worker] [${triggerReason === 'STOP_LOSS' ? 'SL_HIT' : 'TARGET_HIT'}] ` +
      `${position.symbol} ${position.optionType || ''} ${position.strikePrice || ''} ` +
      `pos:${position.id} user:${position.userId} ` +
      `prev:${position.lastCheckedPrice} → curr:${currentPrice} ` +
      `SL:${position.stopLoss} TGT:${position.target} dir:${position.tradeDirection}`
    )

    // Acquire lock
    const lockId = `auto:${position.id}:${Date.now()}`
    const lockResult = await db.position.updateMany({
      where: { id: position.id, isOpen: true, slTriggerLock: null },
      data: { slTriggerLock: lockId },
    })

    if (lockResult.count === 0) return // Already locked

    // Execute exit
    const exitResult = await this.executeExit(position, triggerReason, currentPrice)

    if (exitResult.success) {
      console.log(
        `[AutoExit Worker] [ORDER_EXECUTED] ${position.symbol} ` +
        `exit @ ₹${currentPrice} P&L: ₹${exitResult.pnl} reason: ${triggerReason}`
      )

      // Notify subscribers
      const event: ExitEvent = {
        positionId: position.id,
        userId: position.userId,
        symbol: position.symbol,
        segment: position.segment,
        reason: triggerReason,
        triggerPrice: currentPrice,
        pnl: exitResult.pnl,
        exitPrice: currentPrice,
        tradeDirection: position.tradeDirection,
        timestamp: Date.now(),
      }

      this.subscribers.forEach(h => {
        try { h(event) } catch {}
      })
    } else {
      console.error(
        `[AutoExit Worker] [ERROR] Exit failed for ${position.id}: ${exitResult.error}`
      )
    }
  }

  // ─── Price Fetching (uses cache populated by MarketDataManager) ──

  private async getCurrentPrice(position: MonitoredPosition): Promise<number> {
    // Try cache first (fastest — populated by SSE streams)
    if (position.segment === 'EQUITY') {
      const cached = cache.get<{ currentPrice: number }>(CacheKeys.stockPrice(position.symbol))
      if (cached?.currentPrice && cached.currentPrice > 0) return cached.currentPrice

      const stock = await db.stock.findFirst({
        where: { symbol: position.symbol, isActive: true },
        select: { currentPrice: true },
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
        orderBy: { expiryDate: 'asc' },
        select: { ltp: true },
      })
      if (future?.ltp) {
        cache.set(CacheKeys.futurePrice(position.symbol), { ltp: future.ltp }, CacheTTL.FUTURE_PRICE)
        return future.ltp
      }
    } else if (position.segment === 'OPTIONS') {
      const optKey = CacheKeys.optionPrice(position.symbol, position.optionType || 'CE', position.strikePrice || 0)
      const cached = cache.get<{ ltp: number }>(optKey)
      if (cached?.ltp && cached.ltp > 0) return cached.ltp

      const option = await db.option.findFirst({
        where: {
          underlying: position.symbol,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
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

    return position.currentPrice
  }

  // ─── Range-Based Trigger Detection ──

  private detectTrigger(
    position: MonitoredPosition,
    currentPrice: number
  ): 'STOP_LOSS' | 'TARGET' | null {
    const { tradeDirection, stopLoss, target, lastCheckedPrice } = position

    if (!stopLoss && !target) return null
    if (currentPrice <= 0) return null

    const isBuy = tradeDirection === 'BUY'
    const hasLastPrice = lastCheckedPrice !== null && lastCheckedPrice !== undefined && lastCheckedPrice > 0

    // Range-Based Detection (primary — catches price jumps)
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

    // Fallback Safety Check (ensures no missed triggers on first check)
    if (isBuy) {
      if (stopLoss && stopLoss > 0 && currentPrice <= stopLoss) return 'STOP_LOSS'
      if (target && target > 0 && currentPrice >= target) return 'TARGET'
    } else {
      if (stopLoss && stopLoss > 0 && currentPrice >= stopLoss) return 'STOP_LOSS'
      if (target && target > 0 && currentPrice <= target) return 'TARGET'
    }

    return null
  }

  // ─── Execution with Retry ──

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
        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          const freshPos = await tx.position.findFirst({
            where: { id: position.id, isOpen: true },
          })
          if (!freshPos) throw new Error('Position already closed')
          if (freshPos.slTriggerLock && freshPos.slTriggerLock !== position.slTriggerLock) {
            throw new Error('Position locked by another process')
          }

          // Create exit order
          const order = await tx.order.create({
            data: {
              userId: position.userId,
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

          // Create exit trade
          const pnlPercent = position.entryPrice > 0
            ? Math.round((realizedPnl / position.totalInvested) * 10000) / 100
            : 0

          await tx.trade.create({
            data: {
              userId: position.userId,
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

          // Close position
          await tx.position.update({
            where: { id: position.id },
            data: {
              isOpen: false,
              currentPrice,
              currentValue: 0,
              unrealizedPnl: 0,
              realizedPnl: { increment: realizedPnl },
              squaredOffAt: new Date(),
              exitReason: reason,
              slTriggerLock: null,
            }
          })

          // Update user balance
          if (position.tradeDirection === 'BUY') {
            const proceeds = totalValue - brokerage
            await tx.user.update({
              where: { id: position.userId },
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
              where: { id: position.userId },
              data: {
                virtualBalance: { increment: marginReturn },
                totalTrades: { increment: 1 },
                totalPnl: { increment: realizedPnl },
                marginUsed: { decrement: position.marginUsed },
              },
            })
          }

          return { order }
        }, {
          maxWait: 5000,
          timeout: 10000,
        })

        // Invalidate caches
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
          try {
            await db.position.update({
              where: { id: position.id },
              data: { slTriggerLock: null },
            })
          } catch { /* ignore */ }
          return { success: false, error: errMsg }
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running = false
    this.subscribers.clear()
  }
}

// ─── Global Singleton ───────────────────────────────────────────────────────

const GLOBAL_KEY = '__PEPERTECT_AUTO_EXIT_WORKER__' as const

export function getAutoExitWorker(): AutoExitWorker {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    const instance = AutoExitWorker.getInstance()
    ;(globalThis as any)[GLOBAL_KEY] = instance
  }
  return (globalThis as any)[GLOBAL_KEY] as AutoExitWorker
}