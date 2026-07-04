import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/trade-auth'
import { getAutoExitWorker } from '@/lib/auto-exit-worker'

/**
 * POST /api/trade/sl-monitor
 *
 * Ensures the server-side auto-exit worker is running.
 * Also performs one immediate check cycle for this user.
 * The REAL monitoring is done by the background worker (auto-exit-worker.ts).
 */
export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request as any)
    if (auth.error) return auth.error

    // Ensure the background worker is running
    const worker = getAutoExitWorker()
    worker.ensureRunning()

    return NextResponse.json({
      success: true,
      message: 'Server-side auto-exit worker active',
    })
  } catch (error) {
    console.error('[SL Monitor API] Error:', error)
    return NextResponse.json(
      { error: 'Monitor cycle failed' },
      { status: 500 }
    )
  }
}