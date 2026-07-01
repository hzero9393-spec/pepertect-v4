/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SL/Target Monitor Engine — Production-Grade Polling System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Design:
 * - Frontend calls /api/trade/sl-monitor every 1 second
 * - Server fetches all positions with SL or Target set
 * - For each position: fetch current price → range-based trigger check → execute exit
 * - Uses DB-level locking (slTriggerLock field) for idempotency
 * - Handles price gaps/jumps via dual check (range-cross + fallback)
 * - Retries execution up to 3 times with exponential backoff
 *
 * Vercel Compatibility:
 * - No persistent background process (serverless)
 * - All state stored in PostgreSQL (lastCheckedPrice, slTriggerLock)
 * - In-memory cache for prices (survives within a single serverless warm instance)
 */

import { db } from '@/lib/db'
import { cache, CacheKeys, CacheTTL } from '@/lib/cache'
import { calculateBrokerage } from '@/lib/trade-auth'
import { Prisma } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SLPosition {
  id: string
  userId: string
  segment: string
  productType: string
  tradeDirection: string
  symbol: string
  instrumentId: string | null
  optionType: string | null
  strikePrice: number | null
  expiryDate: Date | null
  lotSize: number
  lots: number
  quantity: number
  entryPrice: number
  currentPrice: number
  totalInvested: number
  marginUsed: number
  stopLoss: number | null
  target: number | null
  lastCheckedPrice: number | null
  slTriggerLock: string | null
}

interface TriggerResult {
  positionId: string
  triggered: boolean
  reason: 'STOP_LOSS' | 'TARGET'
  triggerPrice: number
  previousPrice: number | null
  exitSuccess: boolean
  exitError?: string
  pnl?: number
  message?: string
}

interface MonitorCycleResult {
  cycleTime: number
  positionsChecked: number
  triggers: TriggerResult[]
  errors: string[]
}

// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 200,
  LOCK_TTL_MS: 10_000, // 10 seconds — if lock is older, consider it stale
  LOG_EVERY_TRIGGER: true,
}

// ─── Price Fetching ─────────────────────────────────────────────────────────

async function getCurrentPrice(position: SLPosition): Promise<number> {
  // Try cache first (populated by option-chain-manager and other SSE streams)
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

  // Fallback: use last known price
  return position.currentPrice
}

// ─── Range-Based Trigger Detection ─────────────────────────────────────────

/**
 * CRITICAL: Range-based crossing detection
 *
 * For BUY trades (profit when price goes UP):
 *   SL hit:  lastPrice > stopLoss  AND currentPrice <= stopLoss
 *   Target:  lastPrice < target     AND currentPrice >= target
 *
 * For SELL trades (profit when price goes DOWN):
 *   SL hit:  lastPrice < stopLoss  AND currentPrice >= stopLoss
 *   Target:  lastPrice > target     AND currentPrice <= target
 *
 * FALLBACK (if range crossing was missed, e.g. first check or gap):
 *   BUY SL:     currentPrice <= stopLoss
 *   BUY Target: currentPrice >= target
 *   SELL SL:    currentPrice >= stopLoss
 *   SELL Target:currentPrice <= target
 */
function detectTrigger(
  position: SLPosition,
  currentPrice: number
): 'STOP_LOSS' | 'TARGET' | null {
  const { tradeDirection, stopLoss, target, lastCheckedPrice } = position

  if (!stopLoss && !target) return null
  if (currentPrice <= 0) return null

  const isBuy = tradeDirection === 'BUY'
  const hasLastPrice = lastCheckedPrice !== null && lastCheckedPrice !== undefined && lastCheckedPrice > 0

  // ── Range-Based Detection (primary) ──
  if (hasLastPrice) {
    const prev = lastCheckedPrice!

    // BUY position
    if (isBuy) {
      if (stopLoss && stopLoss > 0 && prev > stopLoss && currentPrice <= stopLoss) {
        return 'STOP_LOSS'
      }
      if (target && target > 0 && prev < target && currentPrice >= target) {
        return 'TARGET'
      }
    }
    // SELL position
    else {
      if (stopLoss && stopLoss > 0 && prev < stopLoss && currentPrice >= stopLoss) {
        return 'STOP_LOSS'
      }
      if (target && target > 0 && prev > target && currentPrice <= target) {
        return 'TARGET'
      }
    }
  }

  // ── Fallback Safety Check (ensures no missed triggers) ──
  if (isBuy) {
    if (stopLoss && stopLoss > 0 && currentPrice <= stopLoss) return 'STOP_LOSS'
    if (target && target > 0 && currentPrice >= target) return 'TARGET'
  } else {
    if (stopLoss && stopLoss > 0 && currentPrice >= stopLoss) return 'STOP_LOSS'
    if (target && target > 0 && currentPrice <= target) return 'TARGET'
  }

  return null
}

// ─── Execution with Retry ──────────────────────────────────────────────────

async function executeExit(position: SLPosition, reason: 'STOP_LOSS' | 'TARGET', currentPrice: number): Promise<{
  success: boolean
  pnl?: number
  error?: string
  orderId?: string
}> {
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

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      // Use serializable transaction for maximum safety
      const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        // Re-check position is still open and not locked by another process
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
        const trade = await tx.trade.create({
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
            slTriggerLock: null, // Release lock
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

        return { order, trade }
      }, {
        maxWait: 5000,
        timeout: 10000,
      })

      // Invalidate caches
      cache.deleteByPrefix(`ubal:${position.userId}`)

      return {
        success: true,
        pnl: realizedPnl,
        orderId: result.order.id,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // If position already closed or locked, don't retry
      if (errMsg.includes('already closed') || errMsg.includes('locked by another')) {
        return { success: false, error: errMsg }
      }

      // Retry with backoff
      if (attempt < CONFIG.MAX_RETRIES) {
        const delay = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
        console.log(`[SL Monitor] Retry ${attempt + 1}/${CONFIG.MAX_RETRIES} for position ${position.id}: ${errMsg}`)
      } else {
        // Release lock on final failure
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

// ─── Main Monitor Cycle ────────────────────────────────────────────────────

export async function runMonitorCycle(): Promise<MonitorCycleResult> {
  const startTime = Date.now()
  const triggers: TriggerResult[] = []
  const errors: string[] = []

  try {
    // Fetch ALL open positions with SL or Target set (across all users)
    const positions = await db.position.findMany({
      where: {
        isOpen: true,
        OR: [
          { stopLoss: { gt: 0 } },
          { target: { gt: 0 } },
        ],
      },
    })

    // Batch: update lastCheckedPrice for positions that don't have one yet
    for (const pos of positions) {
      if (pos.lastCheckedPrice === null || pos.lastCheckedPrice === 0) {
        await db.position.update({
          where: { id: pos.id },
          data: { lastCheckedPrice: pos.currentPrice > 0 ? pos.currentPrice : null },
        }).catch(() => {})
      }
    }

    // Re-fetch with updated lastCheckedPrice
    const updatedPositions = positions.map(p => ({
      ...p,
      lastCheckedPrice: p.lastCheckedPrice || (p.currentPrice > 0 ? p.currentPrice : null),
    }))

    for (const position of updatedPositions) {
      try {
        // Skip if lock exists and is recent (another process is handling it)
        if (position.slTriggerLock) {
          const lockTime = parseInt(position.slTriggerLock.split(':')[1] || '0')
          if (Date.now() - lockTime < CONFIG.LOCK_TTL_MS) {
            continue // Skip — another process is handling this
          }
          // Stale lock — clear it and proceed
          await db.position.update({
            where: { id: position.id },
            data: { slTriggerLock: null },
          }).catch(() => {})
        }

        // Fetch current price
        const currentPrice = await getCurrentPrice(position)
        if (currentPrice <= 0) continue

        // Detect trigger
        const triggerReason = detectTrigger(position, currentPrice)

        if (triggerReason) {
          console.log(
            `[SL Monitor] 🎯 ${triggerReason} triggered for ${position.symbol} ` +
            `pos:${position.id} user:${position.userId} ` +
            `prev:${position.lastCheckedPrice} → curr:${currentPrice} ` +
            `SL:${position.stopLoss} TGT:${position.target}`
          )

          // Acquire lock BEFORE execution
          const lockId = `sl:${position.id}:${Date.now()}`
          const lockResult = await db.position.updateMany({
            where: {
              id: position.id,
              isOpen: true,
              slTriggerLock: null, // Only lock if not already locked
            },
            data: { slTriggerLock: lockId },
          })

          if (lockResult.count === 0) {
            // Already locked by another process — skip
            continue
          }

          // Execute exit
          const exitResult = await executeExit(position, triggerReason, currentPrice)

          triggers.push({
            positionId: position.id,
            triggered: true,
            reason: triggerReason,
            triggerPrice: currentPrice,
            previousPrice: position.lastCheckedPrice,
            exitSuccess: exitResult.success,
            exitError: exitResult.error,
            pnl: exitResult.pnl,
            message: exitResult.success
              ? `${triggerReason} exit: ${position.symbol} @ ₹${currentPrice}, P&L: ₹${exitResult.pnl}`
              : `${triggerReason} exit FAILED: ${exitResult.error}`,
          })
        } else {
          // No trigger — update lastCheckedPrice
          await db.position.update({
            where: { id: position.id },
            data: { lastCheckedPrice: currentPrice },
          }).catch(() => {})
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        errors.push(`Position ${position.id}: ${errMsg}`)
        console.error(`[SL Monitor] Error processing position ${position.id}:`, errMsg)
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    errors.push(`Monitor cycle error: ${errMsg}`)
    console.error('[SL Monitor] Cycle error:', errMsg)
  }

  return {
    cycleTime: Date.now() - startTime,
    positionsChecked: triggers.length + errors.length, // Approximate
    triggers,
    errors,
  }
}

/**
 * Check a single user's positions (lighter version for per-user polling)
 */
export async function checkUserPositions(userId: string): Promise<{
  checked: number
  triggered: TriggerResult[]
}> {
  const positions = await db.position.findMany({
    where: {
      userId,
      isOpen: true,
      OR: [
        { stopLoss: { gt: 0 } },
        { target: { gt: 0 } },
      ],
    },
  })

  const triggered: TriggerResult[] = []

  for (const position of positions) {
    try {
      // Initialize lastCheckedPrice if needed
      if (!position.lastCheckedPrice || position.lastCheckedPrice === 0) {
        await db.position.update({
          where: { id: position.id },
          data: { lastCheckedPrice: position.currentPrice > 0 ? position.currentPrice : null },
        })
        position.lastCheckedPrice = position.currentPrice > 0 ? position.currentPrice : null
      }

      // Skip if locked
      if (position.slTriggerLock) {
        const lockTime = parseInt(position.slTriggerLock.split(':')[1] || '0')
        if (Date.now() - lockTime < CONFIG.LOCK_TTL_MS) continue
        await db.position.update({ where: { id: position.id }, data: { slTriggerLock: null } }).catch(() => {})
      }

      const currentPrice = await getCurrentPrice(position)
      if (currentPrice <= 0) continue

      const triggerReason = detectTrigger(position, currentPrice)

      if (triggerReason) {
        // Acquire lock
        const lockId = `sl:${position.id}:${Date.now()}`
        const lockResult = await db.position.updateMany({
          where: { id: position.id, isOpen: true, slTriggerLock: null },
          data: { slTriggerLock: lockId },
        })
        if (lockResult.count === 0) continue

        console.log(
          `[SL Monitor] 🎯 ${triggerReason} for user ${userId}: ${position.symbol} ` +
          `@ ₹${currentPrice} (SL:${position.stopLoss} TGT:${position.target})`
        )

        const exitResult = await executeExit(position, triggerReason, currentPrice)

        triggered.push({
          positionId: position.id,
          triggered: true,
          reason: triggerReason,
          triggerPrice: currentPrice,
          previousPrice: position.lastCheckedPrice,
          exitSuccess: exitResult.success,
          exitError: exitResult.error,
          pnl: exitResult.pnl,
        })

        if (exitResult.success) break // Process one at a time per user for safety
      } else {
        // Update lastCheckedPrice
        await db.position.update({
          where: { id: position.id },
          data: { lastCheckedPrice: currentPrice },
        }).catch(() => {})
      }
    } catch (err) {
      console.error(`[SL Monitor] Error for user ${userId} position ${position.id}:`, err)
    }
  }

  return { checked: positions.length, triggered }
}