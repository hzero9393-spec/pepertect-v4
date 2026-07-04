// ─── Market Data SSE Stream ────────────────────────────────────────────────
// Server-Sent Events endpoint that pushes real-time market data to clients
// Uses the global MarketDataManager for live data updates
// Falls back to cached data from /api/market/live when manager is unavailable

import { getMarketDataManager, type MarketUpdate } from '@/lib/market-data-manager'
import { cache, CacheKeys } from '@/lib/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Allow long-lived connections

export async function GET(request: Request) {
  const encoder = new TextEncoder()

  // Create a TransformStream for SSE
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // Send SSE event
  const sendEvent = async (event: string, data: any) => {
    try {
      await writer.write(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch {
      // Writer closed
    }
  }

  // Send initial cached data immediately
  const cached = cache.get<MarketUpdate>(CacheKeys.marketLive())
  if (cached) {
    await sendEvent('initial', cached)
  }

  // Subscribe to live updates from the Market Data Manager
  const manager = getMarketDataManager()
  const unsubscribe = manager.onUpdate(async (data: MarketUpdate) => {
    await sendEvent('update', data)
  })

  // Also send periodic keep-alive pings
  const pingInterval = setInterval(async () => {
    await sendEvent('ping', { timestamp: Date.now() })
  }, 25000)

  // Handle client disconnect
  const cleanup = () => {
    unsubscribe()
    clearInterval(pingInterval)
    try { writer.close() } catch {}
  }

  // Abort on client disconnect
  request.signal.addEventListener('abort', cleanup)

  // Auto-close after 110 seconds (browser SSE typically reconnects)
  setTimeout(cleanup, 110000)

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
