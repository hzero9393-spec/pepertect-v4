import { getOptionChainManager } from '@/lib/option-chain-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const VALID_UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const underlying = searchParams.get('underlying')?.toUpperCase()
  const expiry = searchParams.get('expiry')

  if (!underlying || !VALID_UNDERLYINGS.includes(underlying)) {
    return new Response('Invalid underlying', { status: 400 })
  }

  const manager = getOptionChainManager()

  // If no expiry, get the nearest one
  let selectedExpiry = expiry
  if (!selectedExpiry) {
    const expiries = await manager.getExpiries(underlying)
    if (expiries.length === 0) {
      return new Response('No expiries found', { status: 404 })
    }
    selectedExpiry = expiries[0]
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const unsubscribe = manager.subscribe(underlying, selectedExpiry!, (update) => {
        send({ type: 'update', data: update })
      })

      // Keep-alive ping every 20 seconds
      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { /* closed */ }
      }, 20000)

      // Auto-close after 110 seconds (browser reconnects)
      const timeout = setTimeout(() => {
        cleanup()
        controller.close()
      }, 110000)

      const cleanup = () => {
        unsubscribe()
        clearInterval(keepAlive)
        clearTimeout(timeout)
        try { controller.close() } catch { /* already closed */ }
      }

      // Handle client disconnect
      request.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}