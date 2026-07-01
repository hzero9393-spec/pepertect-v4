import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/trade-auth'
import { checkUserPositions } from '@/lib/sl-monitor'

/**
 * POST /api/trade/sl-monitor
 *
 * Called by frontend every 1 second when user has active SL/Target positions.
 * Checks all user's positions with SL/Target set, executes exits if triggered.
 */
export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request as any)
    if (auth.error) return auth.error

    const result = await checkUserPositions(auth.userId)

    return NextResponse.json({
      success: true,
      checked: result.checked,
      triggered: result.triggered,
    })
  } catch (error) {
    console.error('[SL Monitor API] Error:', error)
    return NextResponse.json(
      { error: 'Monitor cycle failed' },
      { status: 500 }
    )
  }
}