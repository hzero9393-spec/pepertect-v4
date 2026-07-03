import { Router, Request, Response } from 'express'
import { db } from '../lib/db.js'
import { cache, CacheKeys, CacheTTL } from '../lib/cache.js'
import { getMarketDataManager } from '../services/market-data-manager.js'
import { logger } from '../lib/logger.js'

export const marketRoutes = Router()

// ─── Simple in-memory caches for hot endpoints ──────────────────────

let statusCache: { data: any; expiresAt: number } | null = null
const STATUS_TTL = 10_000 // 10 seconds

let sectorsCache: { data: any; expiresAt: number } | null = null
const SECTORS_TTL = 5 * 60_000 // 5 minutes

// ─── Helpers ────────────────────────────────────────────────────────

type MarketStatus = 'OPEN' | 'CLOSED' | 'PRE-OPEN' | 'POST-CLOSE'

/**
 * Returns the current IST date (YYYY-MM-DD) and time (HH:MM:SS) strings.
 */
function getISTNow(): { dateStr: string; timeStr: string; hours: number; minutes: number; dayOfWeek: number } {
  const now = new Date()
  // IST = UTC + 5:30
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const istMs = utcMs + 5.5 * 60 * 60_000
  const ist = new Date(istMs)

  const pad = (n: number) => String(n).padStart(2, '0')
  const year = ist.getUTCFullYear()
  const month = pad(ist.getUTCMonth() + 1)
  const day = pad(ist.getUTCDate())
  const hours = ist.getUTCHours()
  const minutes = ist.getUTCMinutes()
  const seconds = ist.getUTCSeconds()

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    hours,
    minutes,
    dayOfWeek: ist.getUTCDay(), // 0 = Sunday
  }
}

/**
 * Determine market status from IST time.
 * Regular session: 09:15 – 15:30 IST
 * Pre-open: 09:00 – 09:15 IST
 * Post-close: after 15:30 IST on a trading day
 */
function getMarketStatusFromTime(
  hours: number,
  minutes: number,
  dayOfWeek: number
): { status: MarketStatus; message: string } {
  // Weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { status: 'CLOSED', message: 'Market is closed (Weekend)' }
  }

  const totalMinutes = hours * 60 + minutes

  if (totalMinutes < 9 * 60) {
    // Before 09:00
    return { status: 'CLOSED', message: 'Market has not yet opened for the day' }
  } else if (totalMinutes < 9 * 60 + 15) {
    // 09:00 – 09:15
    return { status: 'PRE-OPEN', message: 'Market is in pre-open session' }
  } else if (totalMinutes <= 15 * 60 + 30) {
    // 09:15 – 15:30
    return { status: 'OPEN', message: 'Market is open' }
  } else {
    // After 15:30
    return { status: 'POST-CLOSE', message: 'Market is closed for the day' }
  }
}

/**
 * Calculate when the market next opens.
 */
function getNextOpen(dayOfWeek: number, dateStr: string): string {
  // If it's a weekday before 09:15, market opens today at 09:15
  // If weekend or after close, find next weekday
  const ist = getISTNow()
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  let istMs = utcMs + 5.5 * 60 * 60_000

  // If currently before 09:15 on a weekday, next open is today
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    const totalMinutes = ist.hours * 60 + ist.minutes
    if (totalMinutes < 9 * 60 + 15) {
      return `${dateStr} 09:15 IST`
    }
  }

  // Otherwise find next Monday
  const istDate = new Date(istMs)
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 2 : 8 - dayOfWeek
  istDate.setUTCDate(istDate.getUTCDate() + daysUntilMonday)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())} 09:15 IST`
}

// ─── GET /api/market/status ─────────────────────────────────────────
// Public, 10s in-memory cache

marketRoutes.get('/api/market/status', async (_req: Request, res: Response) => {
  try {
    // Check in-memory cache
    if (statusCache && Date.now() < statusCache.expiresAt) {
      return res.json(statusCache.data)
    }

    const ist = getISTNow()
    const { status, message } = getMarketStatusFromTime(ist.hours, ist.minutes, ist.dayOfWeek)

    // Check DB for holidays
    const todayStart = new Date(`${ist.dateStr}T00:00:00+05:30`)
    const todayEnd = new Date(`${ist.dateStr}T23:59:59+05:30`)

    const holiday = await db.marketHoliday.findFirst({
      where: {
        date: { gte: todayStart, lte: todayEnd },
      },
    })

    let finalStatus: MarketStatus = status
    let finalMessage = message
    let nextOpen: string | undefined

    if (holiday) {
      // Check if it's a Muhurat trading session
      if (holiday.isMuhurat && holiday.muhuratStart && holiday.muhuratEnd) {
        const [startH, startM] = holiday.muhuratStart.split(':').map(Number)
        const [endH, endM] = holiday.muhuratEnd.split(':').map(Number)
        const totalMinutes = ist.hours * 60 + ist.minutes
        const muhuratStartMin = startH * 60 + startM
        const muhuratEndMin = endH * 60 + endM

        if (totalMinutes >= muhuratStartMin && totalMinutes <= muhuratEndMin) {
          finalStatus = 'OPEN'
          finalMessage = `Muhurat Trading Session – ${holiday.name}`
        } else if (totalMinutes < muhuratStartMin) {
          finalStatus = 'PRE-OPEN'
          finalMessage = `Muhurat Trading at ${holiday.muhuratStart} IST – ${holiday.name}`
        } else {
          finalStatus = 'CLOSED'
          finalMessage = `Muhurat Trading session ended – ${holiday.name}`
        }
      } else {
        // Regular holiday
        finalStatus = 'CLOSED'
        finalMessage = `Market closed – ${holiday.name}`
      }
    }

    if (finalStatus !== 'OPEN') {
      nextOpen = getNextOpen(ist.dayOfWeek, ist.dateStr)
    }

    const response = {
      success: true,
      data: {
        status: finalStatus,
        message: finalMessage,
        istTime: ist.timeStr,
        istDate: ist.dateStr,
        ...(nextOpen ? { nextOpen } : {}),
      },
    }

    // Cache for 10s
    statusCache = { data: response, expiresAt: Date.now() + STATUS_TTL }

    return res.json(response)
  } catch (error) {
    logger.error('Error fetching market status:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch market status' })
  }
})

// ─── GET /api/market/live ───────────────────────────────────────────
// Public – 3-tier fallback: manager → cache → DB

marketRoutes.get('/api/market/live', async (_req: Request, res: Response) => {
  try {
    let indices: Record<string, any> = {}
    let stocks: Record<string, any> = {}
    let source = 'none'
    let timestamp = Date.now()

    // Primary: MarketDataManager
    try {
      const manager = getMarketDataManager()
      if (Object.keys(manager.indices).length > 0 || Object.keys(manager.stocks).length > 0) {
        indices = manager.indices
        stocks = manager.stocks
        source = manager.source
        timestamp = Date.now()
      }
    } catch {
      // Manager not available
    }

    // Fallback 1: in-memory cache
    if (source === 'none') {
      try {
        const cached = cache.get<any>(CacheKeys.marketLive())
        if (cached && (Object.keys(cached.indices).length > 0 || Object.keys(cached.stocks).length > 0)) {
          indices = cached.indices
          stocks = cached.stocks
          source = 'cache'
          timestamp = cached.timestamp
        }
      } catch {
        // Cache miss
      }
    }

    // Fallback 2: Database
    if (source === 'none') {
      try {
        const dbIndices = await db.index.findMany({ where: { isEnabled: true } })
        for (const idx of dbIndices) {
          indices[idx.symbol] = {
            last_price: idx.currentPrice,
            net_change: idx.change,
            changePercent: idx.changePercent,
            ohlc: {
              open: idx.open || idx.currentPrice,
              high: idx.high || idx.currentPrice,
              low: idx.low || idx.currentPrice,
              close: idx.previousClose || idx.currentPrice,
            },
            volume: idx.volume,
          }
        }

        const dbStocks = await db.stock.findMany({
          where: { isActive: true },
          take: 100,
          orderBy: { marketCap: 'desc' },
        })
        for (const stock of dbStocks) {
          stocks[stock.symbol] = {
            last_price: stock.currentPrice,
            net_change: stock.change,
            changePercent: stock.changePercent,
            name: stock.name,
            ohlc: {
              open: stock.open || stock.currentPrice,
              high: stock.high || stock.currentPrice,
              low: stock.low || stock.currentPrice,
              close: stock.previousClose || stock.currentPrice,
            },
            volume: stock.volume,
          }
        }

        if (Object.keys(indices).length > 0 || Object.keys(stocks).length > 0) {
          source = 'database'
        }
      } catch {
        // DB not available
      }
    }

    const age = Date.now() - timestamp
    let freshness: string
    if (age < 2000) freshness = 'real-time'
    else if (age < 30_000) freshness = 'recent'
    else if (age < 300_000) freshness = 'stale'
    else freshness = 'outdated'

    return res.json({
      success: true,
      data: { indices, stocks, timestamp, source },
      freshness,
    })
  } catch (error) {
    logger.error('Error fetching market live data:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch live market data' })
  }
})

// ─── GET /api/market/holidays ───────────────────────────────────────
// Public

marketRoutes.get('/api/market/holidays', async (_req: Request, res: Response) => {
  try {
    const currentYear = new Date().getFullYear()
    const yearStart = new Date(`${currentYear}-01-01T00:00:00+05:30`)
    const yearEnd = new Date(`${currentYear}-12-31T23:59:59+05:30`)

    const holidays = await db.marketHoliday.findMany({
      where: {
        date: { gte: yearStart, lte: yearEnd },
      },
      orderBy: { date: 'asc' },
    })

    return res.json({
      success: true,
      data: holidays.map((h) => ({
        id: h.id,
        name: h.name,
        date: h.date.toISOString(),
        isMuhurat: h.isMuhurat,
        muhuratStart: h.muhuratStart,
        muhuratEnd: h.muhuratEnd,
      })),
      year: currentYear,
    })
  } catch (error) {
    logger.error('Error fetching market holidays:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch holidays' })
  }
})

// ─── GET /api/market/breadth ────────────────────────────────────────
// Public

marketRoutes.get('/api/market/breadth', async (_req: Request, res: Response) => {
  try {
    const activeStocks = await db.stock.findMany({
      where: { isActive: true },
      select: { changePercent: true },
    })

    let advancing = 0
    let declining = 0
    let unchanged = 0

    for (const stock of activeStocks) {
      if (stock.changePercent > 0) advancing++
      else if (stock.changePercent < 0) declining++
      else unchanged++
    }

    const total = activeStocks.length
    const advDecRatio = declining > 0 ? Number((advancing / declining).toFixed(2)) : advancing > 0 ? 999 : 0

    return res.json({
      success: true,
      data: { advancing, declining, unchanged, total, advDecRatio },
    })
  } catch (error) {
    logger.error('Error fetching market breadth:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch market breadth' })
  }
})

// ─── GET /api/sectors ───────────────────────────────────────────────
// Public, 5min in-memory cache

marketRoutes.get('/api/sectors', async (_req: Request, res: Response) => {
  try {
    // Check in-memory cache
    if (sectorsCache && Date.now() < sectorsCache.expiresAt) {
      return res.json(sectorsCache.data)
    }

    const sectors = await db.sector.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })

    const response = {
      success: true,
      data: sectors.map((s) => ({
        id: s.id,
        name: s.name,
        indexSymbol: s.indexSymbol,
        todayChange: s.todayChange,
        topStockSymbol: s.topStockSymbol,
        topStockChange: s.topStockChange,
      })),
    }

    // Cache for 5 minutes
    sectorsCache = { data: response, expiresAt: Date.now() + SECTORS_TTL }

    return res.json(response)
  } catch (error) {
    logger.error('Error fetching sectors:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch sectors' })
  }
})

// ─── GET /api/indices ───────────────────────────────────────────────
// Public

marketRoutes.get('/api/indices', async (_req: Request, res: Response) => {
  try {
    const indices = await db.index.findMany({
      where: { isEnabled: true },
      orderBy: { symbol: 'asc' },
    })

    return res.json({
      success: true,
      data: indices.map((idx) => ({
        id: idx.id,
        symbol: idx.symbol,
        name: idx.name,
        lotSize: idx.lotSize,
        expiryDay: idx.expiryDay,
        strikeInterval: idx.strikeInterval,
        currentPrice: idx.currentPrice,
        open: idx.open,
        high: idx.high,
        low: idx.low,
        previousClose: idx.previousClose,
        change: idx.change,
        changePercent: idx.changePercent,
        volume: idx.volume,
        lastUpdated: idx.lastUpdated,
      })),
    })
  } catch (error) {
    logger.error('Error fetching indices:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch indices' })
  }
})

// ─── GET /api/stocks/gainers ────────────────────────────────────────
// Public

marketRoutes.get('/api/stocks/gainers', async (_req: Request, res: Response) => {
  try {
    const stocks = await db.stock.findMany({
      where: {
        isActive: true,
        changePercent: { gt: 0 },
      },
      orderBy: { changePercent: 'desc' },
      take: 10,
    })

    return res.json({
      success: true,
      data: stocks.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        currentPrice: s.currentPrice,
        change: s.change,
        changePercent: s.changePercent,
        volume: s.volume,
      })),
    })
  } catch (error) {
    logger.error('Error fetching top gainers:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch top gainers' })
  }
})

// ─── GET /api/stocks/losers ─────────────────────────────────────────
// Public

marketRoutes.get('/api/stocks/losers', async (_req: Request, res: Response) => {
  try {
    const stocks = await db.stock.findMany({
      where: {
        isActive: true,
        changePercent: { lt: 0 },
      },
      orderBy: { changePercent: 'asc' },
      take: 10,
    })

    return res.json({
      success: true,
      data: stocks.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        currentPrice: s.currentPrice,
        change: s.change,
        changePercent: s.changePercent,
        volume: s.volume,
      })),
    })
  } catch (error) {
    logger.error('Error fetching top losers:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch top losers' })
  }
})

// ─── GET /api/stocks ────────────────────────────────────────────────
// Public – supports ?search=, ?limit=, ?offset=

marketRoutes.get('/api/stocks', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string | undefined)?.trim().toUpperCase()
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200)
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)

    const where: any = { isActive: true }
    if (search) {
      where.OR = [
        { symbol: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [stocks, count] = await Promise.all([
      db.stock.findMany({
        where,
        orderBy: { marketCap: 'desc' },
        take: limit,
        skip: offset,
        select: {
          symbol: true,
          name: true,
          sector: true,
          currentPrice: true,
          change: true,
          changePercent: true,
          volume: true,
          marketCap: true,
        },
      }),
      db.stock.count({ where }),
    ])

    return res.json({
      success: true,
      data: stocks,
      count,
    })
  } catch (error) {
    logger.error('Error fetching stocks:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch stocks' })
  }
})

// ─── GET /api/stocks/detail/:symbol ─────────────────────────────────
// Public

marketRoutes.get('/api/stocks/detail/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase()

    const stock = await db.stock.findUnique({
      where: { symbol },
    })

    if (!stock || !stock.isActive) {
      return res.status(404).json({
        success: false,
        error: `Stock '${symbol}' not found`,
      })
    }

    return res.json({
      success: true,
      data: {
        id: stock.id,
        symbol: stock.symbol,
        name: stock.name,
        isin: stock.isin,
        sector: stock.sector,
        industry: stock.industry,
        exchange: stock.exchange,
        faceValue: stock.faceValue,
        marketCap: stock.marketCap,
        peRatio: stock.peRatio,
        dividendYield: stock.dividendYield,
        lotSize: stock.lotSize,
        isFuturesAvailable: stock.isFuturesAvailable,
        isOptionsAvailable: stock.isOptionsAvailable,
        strikeInterval: stock.strikeInterval,
        circuitLimit: stock.circuitLimit,
        currentPrice: stock.currentPrice,
        open: stock.open,
        high: stock.high,
        low: stock.low,
        previousClose: stock.previousClose,
        change: stock.change,
        changePercent: stock.changePercent,
        volume: stock.volume,
        week52High: stock.week52High,
        week52Low: stock.week52Low,
        isFnoBan: stock.isFnoBan,
        banStartDate: stock.banStartDate,
        banEndDate: stock.banEndDate,
        lastUpdated: stock.lastUpdated,
      },
    })
  } catch (error) {
    logger.error(`Error fetching stock detail for ${req.params.symbol}:`, error)
    return res.status(500).json({ success: false, error: 'Failed to fetch stock detail' })
  }
})

// ─── GET /api/market/index-detail/:symbol ───────────────────────────
// Public

marketRoutes.get('/api/market/index-detail/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase()

    const index = await db.index.findUnique({
      where: { symbol },
    })

    if (!index || !index.isEnabled) {
      return res.status(404).json({
        success: false,
        error: `Index '${symbol}' not found`,
      })
    }

    // Get top gainers and losers from stocks
    const [topGainers, topLosers, sectorPerformance] = await Promise.all([
      db.stock.findMany({
        where: { isActive: true, changePercent: { gt: 0 } },
        orderBy: { changePercent: 'desc' },
        take: 5,
        select: { symbol: true, name: true, currentPrice: true, changePercent: true },
      }),
      db.stock.findMany({
        where: { isActive: true, changePercent: { lt: 0 } },
        orderBy: { changePercent: 'asc' },
        take: 5,
        select: { symbol: true, name: true, currentPrice: true, changePercent: true },
      }),
      db.sector.findMany({
        where: { isActive: true },
        orderBy: { todayChange: 'desc' },
        select: {
          name: true,
          todayChange: true,
          topStockSymbol: true,
          topStockChange: true,
        },
      }),
    ])

    return res.json({
      success: true,
      data: {
        index: {
          symbol: index.symbol,
          name: index.name,
          lotSize: index.lotSize,
          expiryDay: index.expiryDay,
          strikeInterval: index.strikeInterval,
          currentPrice: index.currentPrice,
          open: index.open,
          high: index.high,
          low: index.low,
          previousClose: index.previousClose,
          change: index.change,
          changePercent: index.changePercent,
          volume: index.volume,
          lastUpdated: index.lastUpdated,
        },
        topGainers,
        topLosers,
        sectorPerformance,
      },
    })
  } catch (error) {
    logger.error(`Error fetching index detail for ${req.params.symbol}:`, error)
    return res.status(500).json({ success: false, error: 'Failed to fetch index detail' })
  }
})

// ─── GET /api/market/index-chart/:symbol ────────────────────────────
// Public – chart data comes from frontend lightweight-charts

marketRoutes.get('/api/market/index-chart/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase()

    // Verify the index exists
    const index = await db.index.findUnique({
      where: { symbol },
      select: { symbol: true, isEnabled: true },
    })

    if (!index || !index.isEnabled) {
      return res.status(404).json({
        success: false,
        error: `Index '${symbol}' not found`,
      })
    }

    return res.json({
      success: true,
      data: {
        symbol,
        chartData: [],
      },
    })
  } catch (error) {
    logger.error(`Error fetching index chart for ${req.params.symbol}:`, error)
    return res.status(500).json({ success: false, error: 'Failed to fetch index chart data' })
  }
})