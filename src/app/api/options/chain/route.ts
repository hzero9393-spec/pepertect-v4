import { NextResponse } from 'next/server'

// Upstox access token — server-side only, not exposed to client
const UPSTOX_TOKEN = process.env.UPSTOX_ACCESS_TOKEN ||
  'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI1VUM2OTgiLCJqdGkiOiI2YTQzNGFiNDk4ODZkYTU5NmFkMTI1NDIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgyNzk0OTMyLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTQzOTI4MDB9.EWI1yDJCUS_fgXe9TkNEamg8hK0ku9yGIyS2zE6ZLH0'

const INSTRUMENT_KEYS: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  SENSEX: 'BSE_INDEX|SENSEX',
}

// ──────────────────────────────────────────────────────────────────────
// In-memory cache — survives across invocations within the same serverless
// instance warm period. For 100 users polling every 5s, only ~1 Upstox
// call per 5s per index+expiry combination instead of 100 separate calls.
// ──────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5000 // 5 seconds — same as client poll interval
const cache = new Map<string, { data: any; timestamp: number }>()

function getCached(key: string): any | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: any) {
  // Evict stale entries first (keep cache clean)
  const now = Date.now()
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL_MS * 2) cache.delete(k)
  }
  cache.set(key, { data, timestamp: now })
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const underlying = searchParams.get('underlying')?.toUpperCase()
    const expiry = searchParams.get('expiry')

    if (!underlying || !expiry) {
      return NextResponse.json({ success: false, error: 'Missing underlying or expiry' }, { status: 400 })
    }

    const instrumentKey = INSTRUMENT_KEYS[underlying]
    if (!instrumentKey) {
      return NextResponse.json({ success: false, error: `Unknown underlying: ${underlying}` }, { status: 400 })
    }

    // ─── Cache check — serve from memory if fresh ──────────────────
    const cacheKey = `${underlying}:${expiry}`
    const cached = getCached(cacheKey)
    if (cached) {
      // Return cached data with a flag so client knows it's cached
      return NextResponse.json({ success: true, data: cached, cached: true })
    }

    // ─── Check token expiry ────────────────────────────────────────
    try {
      const payload = JSON.parse(Buffer.from(UPSTOX_TOKEN.split('.')[1], 'base64').toString())
      if (payload.exp * 1000 < Date.now()) {
        return NextResponse.json({ success: false, error: 'UPSTOX_TOKEN_EXPIRED' }, { status: 503 })
      }
    } catch {
      return NextResponse.json({ success: false, error: 'UPSTOX_TOKEN_INVALID' }, { status: 503 })
    }

    // ─── Fetch from Upstox (only when cache miss) ──────────────────
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${UPSTOX_TOKEN}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[API /options/chain] Upstox ${res.status}: ${body.substring(0, 200)}`)
      return NextResponse.json({ success: false, error: `Upstox API error: ${res.status}` }, { status: 502 })
    }

    const json = await res.json()

    if (json?.status === 'error') {
      return NextResponse.json({ success: false, error: 'Upstox returned error', detail: json }, { status: 502 })
    }

    const chainData = json?.data || []

    if (chainData.length === 0) {
      return NextResponse.json({ success: false, error: 'NO_DATA', expiry, underlying })
    }

    const spot = chainData[0].underlying_spot_price || 0
    const totalCallOI = chainData.reduce((s: number, c: any) => s + (c.call_options?.market_data?.oi || 0), 0)
    const totalPutOI = chainData.reduce((s: number, c: any) => s + (c.put_options?.market_data?.oi || 0), 0)

    // Max pain calculation
    let maxPainStrike = 0
    let maxBuyerLoss = 0
    for (const strike of chainData) {
      const sp = strike.strike_price
      let callBL = 0, putBL = 0
      for (const s of chainData) {
        callBL += Math.max(0, (s.call_options?.market_data?.close_price || 0) - Math.max(sp - s.strike_price, 0))
        putBL += Math.max(0, (s.put_options?.market_data?.close_price || 0) - Math.max(s.strike_price - sp, 0))
      }
      if (callBL + putBL > maxBuyerLoss) {
        maxBuyerLoss = callBL + putBL
        maxPainStrike = sp
      }
    }

    const update = {
      underlying: underlying.toUpperCase(),
      spot,
      pcr: totalPutOI > 0 ? parseFloat((totalPutOI / totalCallOI).toFixed(2)) : 0,
      expiry,
      strikes: chainData,
      timestamp: Date.now(),
      totalCallOI,
      totalPutOI,
      maxPainStrike,
    }

    // ─── Store in cache before returning ───────────────────────────
    setCache(cacheKey, update)

    return NextResponse.json({ success: true, data: update, cached: false })
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return NextResponse.json({ success: false, error: 'TIMEOUT' }, { status: 504 })
    }
    console.error('[API /options/chain] Error:', err)
    return NextResponse.json({ success: false, error: 'FETCH_ERROR' }, { status: 500 })
  }
}