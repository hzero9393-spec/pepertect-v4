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

// ISR: cache for 5 seconds. 100 users in same 5s window = only 1 Upstox API call.
// Vercel edge serves cached response to all subsequent requests instantly.
export const dynamic = 'force-dynamic'
export const revalidate = 5

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

    // Check token expiry
    try {
      const payload = JSON.parse(Buffer.from(UPSTOX_TOKEN.split('.')[1], 'base64').toString())
      if (payload.exp * 1000 < Date.now()) {
        return NextResponse.json({ success: false, error: 'UPSTOX_TOKEN_EXPIRED' }, { status: 503 })
      }
    } catch {
      return NextResponse.json({ success: false, error: 'UPSTOX_TOKEN_INVALID' }, { status: 503 })
    }

    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${UPSTOX_TOKEN}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
      // Tell Vercel to cache this upstream response too
      next: { revalidate: 5 },
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

    return NextResponse.json({ success: true, data: update })
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return NextResponse.json({ success: false, error: 'TIMEOUT' }, { status: 504 })
    }
    console.error('[API /options/chain] Error:', err)
    return NextResponse.json({ success: false, error: 'FETCH_ERROR' }, { status: 500 })
  }
}