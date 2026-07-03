/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REST API Routes — /api/market/status, /api/sectors, /api/health
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These replace the Vercel API routes that the frontend uses.
 * Only includes endpoints that the frontend REST calls (not SSE).
 */

import { Router, Request, Response } from 'express'
import { db } from '../lib/db'
import { verifyToken, getTokenFromAuthHeader } from '../lib/auth'
import { cache, CacheKeys, CacheTTL } from '../lib/cache'
import { getUpstoxToken, setUpstoxToken, getTokenInfo } from '../lib/token-provider'

const router = Router()

// ─── Health Check ──────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() })
})

// ─── Market Status ─────────────────────────────────────────────────────

let cachedStatus: { data: any; expiresAt: number } | null = null
const STATUS_CACHE_TTL = 10_000

router.get('/market/status', async (_req: Request, res: Response) => {
  try {
    const now = Date.now()
    if (cachedStatus && cachedStatus.expiresAt > now) {
      return res.json(cachedStatus.data)
    }

    const istNow = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const adjusted = new Date(istNow.getTime() + istOffset + istNow.getTimezoneOffset() * 60000)
    const hours = adjusted.getHours()
    const minutes = adjusted.getMinutes()
    const day = adjusted.getDay()
    const timeInMinutes = hours * 60 + minutes
    const todayStr = adjusted.toISOString().split('T')[0]

    const holiday = await db.marketHoliday.findFirst({ where: { date: new Date(todayStr) } })

    let status: 'OPEN' | 'CLOSED' | 'PRE-OPEN' | 'POST-CLOSE'
    let message: string
    let nextOpen: string | null = null

    if (day === 0 || day === 6) {
      status = 'CLOSED'
      message = day === 0 ? 'Market closed - Sunday' : 'Market closed - Saturday'
      const daysUntilMonday = day === 0 ? 1 : 2
      const nextMonday = new Date(adjusted)
      nextMonday.setDate(adjusted.getDate() + daysUntilMonday)
      nextOpen = `${nextMonday.toISOString().split('T')[0]}T09:15:00+05:30`
    } else if (holiday) {
      if (holiday.isMuhurat && holiday.muhuratStart && holiday.muhuratEnd) {
        const [startH, startM] = holiday.muhuratStart.split(':').map(Number)
        const [endH, endM] = holiday.muhuratEnd.split(':').map(Number)
        const muhuratStartMin = startH * 60 + startM
        const muhuratEndMin = endH * 60 + endM
        if (timeInMinutes >= muhuratStartMin && timeInMinutes <= muhuratEndMin) {
          status = 'OPEN'; message = `Muhurat Trading Session (${holiday.muhuratStart} - ${holiday.muhuratEnd})`
        } else if (timeInMinutes < muhuratStartMin) {
          status = 'PRE-OPEN'; message = `Muhurat Trading opens at ${holiday.muhuratStart} IST - ${holiday.name}`
        } else {
          status = 'CLOSED'; message = `Market closed - ${holiday.name} (Muhurat session ended)`
        }
      } else {
        status = 'CLOSED'; message = `Market closed - ${holiday.name}`
      }
    } else {
      if (timeInMinutes >= 540 && timeInMinutes < 555) {
        status = 'PRE-OPEN'; message = 'Pre-open session (9:00 - 9:15 IST)'
      } else if (timeInMinutes >= 555 && timeInMinutes < 930) {
        status = 'OPEN'; message = 'Market is open (9:15 - 15:30 IST)'
      } else if (timeInMinutes >= 930 && timeInMinutes < 960) {
        status = 'POST-CLOSE'; message = 'Post-close session (15:30 - 16:00 IST)'
      } else if (timeInMinutes < 540) {
        status = 'CLOSED'; message = 'Market opens at 9:00 IST (Pre-open session)'
      } else {
        status = 'CLOSED'; message = 'Market closed for the day'
      }
    }

    const data = { success: true, data: { status, message, istTime: adjusted.toISOString(), nextOpen } }
    cachedStatus = { data, expiresAt: Date.now() + STATUS_CACHE_TTL }
    res.json(data)
  } catch (error) {
    console.error('[API /market/status] Error:', error)
    res.status(500).json({ success: false, error: 'Failed to get market status' })
  }
})

// ─── Sectors ───────────────────────────────────────────────────────────

let cachedSectors: { data: any; expiresAt: number } | null = null
const SECTORS_CACHE_TTL = 300_000

router.get('/sectors', async (_req: Request, res: Response) => {
  try {
    const now = Date.now()
    if (cachedSectors && cachedSectors.expiresAt > now) {
      return res.json(cachedSectors.data)
    }

    const sectors = await db.sector.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })
    const data = { success: true, data: sectors }
    cachedSectors = { data, expiresAt: Date.now() + SECTORS_CACHE_TTL }
    res.json(data)
  } catch (error) {
    console.error('[API /sectors] Error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch sectors' })
  }
})

// ─── Market Holidays ───────────────────────────────────────────────────

router.get('/market/holidays', async (_req: Request, res: Response) => {
  try {
    const holidays = await db.marketHoliday.findMany({ orderBy: { date: 'asc' } })
    res.json({ success: true, data: holidays })
  } catch (error) {
    console.error('[API /market/holidays] Error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch holidays' })
  }
})

// ─── User Balance (auth required) ─────────────────────────────────────

router.get('/user/balance', async (req: Request, res: Response) => {
  try {
    const token = getTokenFromAuthHeader(req.headers.authorization)
    if (!token) return res.status(401).json({ error: 'No token provided' })

    const cached = cache.get<{ userId: string; isActive: boolean }>(CacheKeys.auth(token))
    if (!cached) return res.status(401).json({ error: 'Invalid or expired token' })

    const cachedBalance = cache.get<any>(CacheKeys.userBalance(cached.userId))
    if (cachedBalance) return res.json({ success: true, data: cachedBalance })

    const user = await db.user.findUnique({
      where: { id: cached.userId },
      select: { id: true, virtualBalance: true, marginUsed: true, totalPnl: true, totalTrades: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const data = {
      virtualBalance: user.virtualBalance, marginUsed: user.marginUsed,
      totalPnl: user.totalPnl, totalTrades: user.totalTrades,
    }
    cache.set(CacheKeys.userBalance(cached.userId), data, CacheTTL.USER_BALANCE)
    res.json({ success: true, data })
  } catch (error) {
    console.error('[API /user/balance] Error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch balance' })
  }
})

// ─── Option Expiries ───────────────────────────────────────────────────

import { getExpiryDates } from '../lib/expiries'

const VALID_UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX']

router.get('/options/expiries', (req: Request, res: Response) => {
  const underlying = req.query.underlying?.toString().toUpperCase()
  if (!underlying || !VALID_UNDERLYINGS.includes(underlying)) {
    return res.status(400).json({ error: 'Invalid underlying' })
  }
  const expiries = getExpiryDates(underlying)
  res.json({ success: true, data: expiries })
})

// ─── Debug: Option Chain Test ─────────────────────────────────────────

const INDEX_KEYS: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  SENSEX: 'BSE_INDEX|SENSEX',
}

router.get('/debug/option-chain', async (req: Request, res: Response) => {
  const underlying = (req.query.underlying || 'NIFTY').toString().toUpperCase()
  const instrumentKey = INDEX_KEYS[underlying]
  if (!instrumentKey) {
    return res.status(400).json({ error: `Unknown underlying: ${underlying}` })
  }

  const token = await getUpstoxToken()
  const tokenInfo = await getTokenInfo()

  const result: any = {
    underlying,
    instrumentKey,
    tokenInfo,
    timestamp: new Date().toISOString(),
  }

  if (!token) {
    result.error = 'No Upstox token available (checked env var, DB platform_settings, and manual override). Set a valid token via POST /api/admin/set-token or set UPSTOX_ACCESS_TOKEN env var on Render.'
    return res.json({ success: false, data: result })
  }

  result.hasUpstoxToken = true
  result.tokenPrefix = token.substring(0, 8) + '...'

  // Get next expiry
  const expiries = getExpiryDates(underlying)
  const expiry = expiries[0] || ''
  result.expiry = expiry

  if (!expiry) {
    result.error = 'No expiry dates found'
    return res.json({ success: false, data: result })
  }

  // Test fetch from Upstox
  try {
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`
    const fetchStart = Date.now()
    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const fetchTime = Date.now() - fetchStart

    result.apiStatus = apiRes.status
    result.apiStatusText = apiRes.statusText
    result.fetchTimeMs = fetchTime

    const text = await apiRes.text()
    result.responseLength = text.length
    result.responsePreview = text.substring(0, 500)

    if (!apiRes.ok) {
      result.error = `Upstox API returned ${apiRes.status}`
      return res.status(200).json({ success: false, data: result })
    }

    try {
      const json = JSON.parse(text)
      const chainData = json?.data || []
      result.strikeCount = chainData.length
      result.upstoxStatus = json?.status

      if (chainData.length > 0) {
        result.spotPrice = chainData[0].underlying_spot_price
        result.firstStrike = chainData[0].strike_price
        result.lastStrike = chainData[chainData.length - 1].strike_price
        result.sampleStrike = {
          strike: chainData[0].strike_price,
          ce_ltp: chainData[0]?.call_options?.market_data?.ltp,
          ce_oi: chainData[0]?.call_options?.market_data?.oi,
          ce_bid: chainData[0]?.call_options?.market_data?.bid_price,
          ce_ask: chainData[0]?.call_options?.market_data?.ask_price,
          pe_ltp: chainData[0]?.put_options?.market_data?.ltp,
          pe_oi: chainData[0]?.put_options?.market_data?.oi,
          pe_bid: chainData[0]?.put_options?.market_data?.bid_price,
          pe_ask: chainData[0]?.put_options?.market_data?.ask_price,
        }
        result.success = true
      } else {
        result.error = 'Chain data array is empty'
        result.fullStatus = json?.status
        result.fullResponse = text.substring(0, 1000)
      }
    } catch (parseErr) {
      result.error = 'Failed to parse JSON response'
      result.rawResponse = text.substring(0, 500)
    }
  } catch (err: any) {
    result.error = `Fetch failed: ${err.message}`
  }

  res.json({ success: !result.error, data: result })
})

// ─── Admin: Set Upstox Token ──────────────────────────────────────────
// POST /api/admin/set-token  body: { token: "..." }
// Also stores in DB for persistence across restarts

router.post('/admin/set-token', async (req: Request, res: Response) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ success: false, error: 'Invalid token. Provide a valid Upstox access token string.' })
  }

  try {
    // Set in memory (immediate effect)
    setUpstoxToken(token)

    // Also store in DB for persistence
    await db.platformSettings.upsert({
      where: { key: 'upstox_access_token' },
      update: { value: token },
      create: {
        key: 'upstox_access_token',
        value: token,
        description: 'Upstox API OAuth2 access token (set via admin API)',
      },
    })

    // Store timestamp
    await db.platformSettings.upsert({
      where: { key: 'upstox_token_obtained_at' },
      update: { value: new Date().toISOString() },
      create: {
        key: 'upstox_token_obtained_at',
        value: new Date().toISOString(),
        description: 'Timestamp when Upstox token was last set',
      },
    })

    console.log(`[Admin API] Upstox token set via admin API (prefix: ${token.substring(0, 8)}...)`)
    res.json({ success: true, message: 'Token set successfully', tokenPrefix: token.substring(0, 8) + '...' })
  } catch (err: any) {
    console.error('[Admin API] Failed to set token:', err)
    res.status(500).json({ success: false, error: 'Failed to store token' })
  }
})

// ─── Admin: Get Token Status ──────────────────────────────────────────

router.get('/admin/token-status', async (_req: Request, res: Response) => {
  const info = await getTokenInfo()
  const token = await getUpstoxToken()
  res.json({
    success: true,
    data: {
      ...info,
      hasActiveToken: !!token,
      activeTokenPrefix: token ? token.substring(0, 8) + '...' : null,
    }
  })
})

export default router