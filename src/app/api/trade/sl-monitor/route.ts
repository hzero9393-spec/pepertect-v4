import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/trade-auth'
import { getAutoExitWorker } from '@/lib/auto-exit-worker'

/**
 * POST /api/trade/sl-monitor
 *
 * Lightweight: just ensures the server-side auto-exit worker is running.
 * No per-user DB queries — the worker handles ALL users internally.
 * Frontend no longer polls this; it listens to WS "exit" events instead.
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
      { error: 'Monitor check failed' },
      { status: 500 }
    )
  }
}