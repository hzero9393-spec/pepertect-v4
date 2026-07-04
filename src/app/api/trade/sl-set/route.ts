import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest } from '@/lib/trade-auth'

/**
 * POST /api/trade/sl-set
 *
 * Set or update Stop Loss and/or Target on an open position.
 *
 * Body: { positionId, stopLoss?: number, target?: number }
 * - Set stopLoss to null to remove it
 * - Set target to null to remove it
 * - Validates: SL < entry for BUY, SL > entry for SELL
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if (auth.error) return auth.error

    const userId = auth.userId
    const body = await request.json()
    const { positionId, stopLoss, target } = body

    if (!positionId) {
      return NextResponse.json({ error: 'positionId is required' }, { status: 400 })
    }

    // Validate position belongs to user and is open
    const position = await db.position.findFirst({
      where: { id: positionId, userId, isOpen: true },
    })

    if (!position) {
      return NextResponse.json(
        { error: 'Open position not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Validate SL/Target values make sense
    if (stopLoss !== null && stopLoss !== undefined && stopLoss <= 0) {
      return NextResponse.json({ error: 'Stop loss must be greater than 0' }, { status: 400 })
    }
    if (target !== null && target !== undefined && target <= 0) {
      return NextResponse.json({ error: 'Target must be greater than 0' }, { status: 400 })
    }

    // Validate SL/Target relative to entry for BUY positions
    if (position.tradeDirection === 'BUY') {
      if (stopLoss !== null && stopLoss !== undefined && stopLoss >= position.entryPrice) {
        return NextResponse.json(
          { error: `For BUY position, SL must be below entry price (₹${position.entryPrice})` },
          { status: 400 }
        )
      }
      if (target !== null && target !== undefined && target <= position.entryPrice) {
        return NextResponse.json(
          { error: `For BUY position, Target must be above entry price (₹${position.entryPrice})` },
          { status: 400 }
        )
      }
    }
    // Validate for SELL positions
    else {
      if (stopLoss !== null && stopLoss !== undefined && stopLoss <= position.entryPrice) {
        return NextResponse.json(
          { error: `For SELL position, SL must be above entry price (₹${position.entryPrice})` },
          { status: 400 }
        )
      }
      if (target !== null && target !== undefined && target >= position.entryPrice) {
        return NextResponse.json(
          { error: `For SELL position, Target must be below entry price (₹${position.entryPrice})` },
          { status: 400 }
        )
      }
    }

    // Initialize lastCheckedPrice if setting SL/Target for first time
    const updateData: Record<string, unknown> = {
      stopLoss: stopLoss ?? null,
      target: target ?? null,
    }

    if (!position.lastCheckedPrice && (stopLoss || target)) {
      updateData.lastCheckedPrice = position.currentPrice > 0 ? position.currentPrice : null
    }

    const updated = await db.position.update({
      where: { id: positionId },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      message: `SL/Target updated for ${position.symbol}`,
      position: {
        id: updated.id,
        symbol: updated.symbol,
        stopLoss: updated.stopLoss,
        target: updated.target,
        entryPrice: updated.entryPrice,
        currentPrice: updated.currentPrice,
        tradeDirection: updated.tradeDirection,
      },
    })
  } catch (error) {
    console.error('[SL Set API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to set SL/Target' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/trade/sl-set
 *
 * Remove SL and Target from a position.
 *
 * Body: { positionId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if (auth.error) return auth.error

    const userId = auth.userId
    const body = await request.json()
    const { positionId } = body

    if (!positionId) {
      return NextResponse.json({ error: 'positionId is required' }, { status: 400 })
    }

    const position = await db.position.findFirst({
      where: { id: positionId, userId, isOpen: true },
    })

    if (!position) {
      return NextResponse.json(
        { error: 'Open position not found or does not belong to you' },
        { status: 404 }
      )
    }

    await db.position.update({
      where: { id: positionId },
      data: {
        stopLoss: null,
        target: null,
        lastCheckedPrice: null,
        slTriggerLock: null,
      },
    })

    return NextResponse.json({
      success: true,
      message: `SL/Target removed from ${position.symbol}`,
    })
  } catch (error) {
    console.error('[SL Remove API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to remove SL/Target' },
      { status: 500 }
    )
  }
}