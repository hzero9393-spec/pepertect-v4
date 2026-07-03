/**
 * Strike Detail API — Historical candle data for a specific option strike
 * 
 * Lightweight: 2-min server cache, only fetches on user demand.
 * Uses instrument_key from option chain data (no lookup needed).
 */

import { NextRequest } from 'next/server'
import { getUpstoxHistoricalData } from '@/lib/upstox-api'

export const dynamic = 'force-dynamic'

// ─── Server-side cache (2 min TTL) ──────────────────────────────────────────

const cache = new Map<string, { data: any; fetchedAt: number }>()
const CACHE_TTL = 2 * 60 * 1000

function getCached(key: string) {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data
  if (entry) cache.delete(key)
  return null
}

function setCache(key: string, data: any) {
  cache.set(key, { data, fetchedAt: Date.now() })
  if (cache.size > 50) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now - v.fetchedAt > CACHE_TTL * 2) cache.delete(k)
    }
  }
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function getRangeParams(range: string): { from: string; to: string; resolution: string } {
  const now = new Date()
  const to = now.toISOString().split('T')[0]
  const from = new Date(now)

  switch (range) {
    case '1D':
      return { from: to, to, resolution: '1minute' }
    case '1W':
      from.setDate(from.getDate() - 7)
      return { from: from.toISOString().split('T')[0], to, resolution: '5minute' }
    case '1M':
    default:
      from.setDate(from.getDate() - 30)
      return { from: from.toISOString().split('T')[0], to, resolution: 'day' }
  }
}

// ─── GET Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const instrumentKey = searchParams.get('instrument_key')
  const range = searchParams.get('range') || '1D'

  if (!instrumentKey) {
    return Response.json({ success: false, error: 'Missing instrument_key' }, { status: 400 })
  }

  const cacheKey = `${instrumentKey}::${range}`
  const cached = getCached(cacheKey)
  if (cached) {
    return Response.json({ success: true, data: cached })
  }

  try {
    const { from, to, resolution } = getRangeParams(range)
    const candles = await getUpstoxHistoricalData(instrumentKey, resolution, from, to)

    if (candles.length === 0) {
      return Response.json({ success: true, data: { candles: [], summary: null } })
    }

    const first = candles[0]
    const last = candles[candles.length - 1]
    const change = last.close - first.open
    const changePercent = first.open > 0 ? (change / first.open) * 100 : 0
    const high = Math.max(...candles.map(c => c.high))
    const low = Math.min(...candles.map(c => c.low))

    const result = {
      candles: candles.map(c => ({
        date: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        oi: c.oi || 0,
      })),
      summary: {
        open: first.open,
        high,
        low,
        close: last.close,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        totalVolume: candles.reduce((s, c) => s + (c.volume || 0), 0),
      },
    }

    setCache(cacheKey, result)
    return Response.json({ success: true, data: result })
  } catch (err) {
    console.error('[strike-detail] Error:', err)
    return Response.json({ success: false, error: 'Failed to fetch strike data' }, { status: 500 })
  }
}