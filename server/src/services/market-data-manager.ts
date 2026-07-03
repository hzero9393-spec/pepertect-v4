// ─── Standalone Market Data Manager ─────────────────────────────────────────
// Singleton that fetches real-time market data from multiple sources.
// Adapted from the Next.js version for use in the standalone WebSocket server.
//
// Data source priority (3-tier fallback):
//   Primary:   Yahoo Finance  (free, no auth, real live data)
//   Fallback:  Upstox API     (when token is valid)
//   Final:     Database       (cached data)
//
// Architecture:
//   Yahoo Finance / Upstox API → MarketDataManager (server polling) → WebSocket → Frontend

import { cache, CacheKeys, CacheTTL } from '../lib/cache.js'
import { db } from '../lib/db.js'
import { config } from '../config.js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface MarketUpdate {
  indices: Record<string, {
    last_price: number
    net_change: number
    ohlc: { open: number; high: number; low: number; close: number }
    volume: number | null
  }>
  stocks: Record<string, {
    last_price: number
    net_change: number
    ohlc: { open: number; high: number; low: number; close: number }
    volume: number | null
    oi: number | null
  }>
  timestamp: number
  source?: string
}

export type UpdateHandler = (data: MarketUpdate) => void

// ─── Yahoo Finance Symbol Mapping ─────────────────────────────────────────

const YAHOO_INDEX_SYMBOLS: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFIN',
  SENSEX: '^BSESN',
  MIDCPNIFTY: '^NSMIDCAP',
}

const YAHOO_STOCK_SYMBOLS: Record<string, string> = {
  RELIANCE: 'RELIANCE.NS', TCS: 'TCS.NS', HDFCBANK: 'HDFCBANK.NS',
  INFY: 'INFY.NS', ICICIBANK: 'ICICIBANK.NS', HINDUNILVR: 'HINDUNILVR.NS',
  SBIN: 'SBIN.NS', BHARTIARTL: 'BHARTIARTL.NS', ITC: 'ITC.NS',
  KOTAKBANK: 'KOTAKBANK.NS', LT: 'LT.NS', AXISBANK: 'AXISBANK.NS',
  BAJFINANCE: 'BAJFINANCE.NS', ASIANPAINT: 'ASIANPAINT.NS', MARUTI: 'MARUTI.NS',
  SUNPHARMA: 'SUNPHARMA.NS', TATAMOTORS: 'TATAMOTORS.NS', WIPRO: 'WIPRO.NS',
  HCLTECH: 'HCLTECH.NS', ULTRACEMCO: 'ULTRACEMCO.NS', TITAN: 'TITAN.NS',
  NESTLEIND: 'NESTLEIND.NS', NTPC: 'NTPC.NS', POWERGRID: 'POWERGRID.NS',
  ONGC: 'ONGC.NS', TATASTEEL: 'TATASTEEL.NS', ADANIENT: 'ADANIENT.NS',
  ADANIPORTS: 'ADANIPORTS.NS', JSWSTEEL: 'JSWSTEEL.NS', COALINDIA: 'COALINDIA.NS',
  BPCL: 'BPCL.NS', HINDALCO: 'HINDALCO.NS', GRASIM: 'GRASIM.NS',
  TECHM: 'TECHM.NS', BAJAJFINSV: 'BAJAJFINSV.NS', DRREDDY: 'DRREDDY.NS',
  CIPLA: 'CIPLA.NS', EICHERMOT: 'EICHERMOT.NS', TATACONSUM: 'TATACONSUM.NS',
  HEROMOTOCO: 'HEROMOTOCO.NS', 'M&M': 'M&M.NS', APOLLOHOSP: 'APOLLOHOSP.NS',
  DIVISLAB: 'DIVISLAB.NS', BRITANNIA: 'BRITANNIA.NS', INDUSINDBK: 'INDUSINDBK.NS',
  HDFCLIFE: 'HDFCLIFE.NS', SBILIFE: 'SBILIFE.NS', YESBANK: 'YESBANK.NS',
  PNB: 'PNB.NS', BANKBARODA: 'BANKBARODA.NS', IDFCFIRSTB: 'IDFCFIRSTB.NS',
  SHRIRAMFIN: 'SHRIRAMFIN.NS', CHOLAFIN: 'CHOLAFIN.NS', SUZLON: 'SUZLON.NS',
  ADANIPOWER: 'ADANIPOWER.NS', HAL: 'HAL.NS', DMART: 'DMART.NS',
  TRENT: 'TRENT.NS', VEDL: 'VEDL.NS', SAIL: 'SAIL.NS',
  NMDC: 'NMDC.NS', IDEA: 'IDEA.NS', OIL: 'OIL.NS',
  GAIL: 'GAIL.NS', IOC: 'IOC.NS', PETRONET: 'PETRONET.NS',
}

// ─── Upstox Instrument Mapping (fallback) ─────────────────────────────────

const UPSTOX_INDICES: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  SENSEX: 'BSE_INDEX|SENSEX',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MIDCAP 150',
}

const UPSTOX_STOCKS: Record<string, string> = {
  RELIANCE: 'NSE_EQ|INE002A01018', TCS: 'NSE_EQ|INE467B01029',
  HDFCBANK: 'NSE_EQ|INE040A01034', INFY: 'NSE_EQ|INE009A01021',
  ICICIBANK: 'NSE_EQ|INE090A01021', HINDUNILVR: 'NSE_EQ|INE030A01027',
  SBIN: 'NSE_EQ|INE062A01020', BHARTIARTL: 'NSE_EQ|INE738A01025',
  ITC: 'NSE_EQ|INE154A01025', KOTAKBANK: 'NSE_EQ|INE237A01028',
  LT: 'NSE_EQ|INE018A01030', AXISBANK: 'NSE_EQ|INE238A01034',
  BAJFINANCE: 'NSE_EQ|INE296A01024', ASIANPAINT: 'NSE_EQ|INE021A01026',
  MARUTI: 'NSE_EQ|INE585B01010', SUNPHARMA: 'NSE_EQ|INE044A01036',
  TATAMOTORS: 'NSE_EQ|INE155A01022', WIPRO: 'NSE_EQ|INE075A01022',
  HCLTECH: 'NSE_EQ|INE860A01027', ULTRACEMCO: 'NSE_EQ|INE406A01034',
  TITAN: 'NSE_EQ|INE280A01028', NESTLEIND: 'NSE_EQ|INE239A01042',
  NTPC: 'NSE_EQ|INE733A01031', POWERGRID: 'NSE_EQ|INE752E01010',
  ONGC: 'NSE_EQ|INE213A01029', TATASTEEL: 'NSE_EQ|INE081A01024',
  ADANIENT: 'NSE_EQ|INE423A01024', ADANIPORTS: 'NSE_EQ|INE742A01034',
  JSWSTEEL: 'NSE_EQ|INE019A01033', COALINDIA: 'NSE_EQ|INE522A01034',
  BPCL: 'NSE_EQ|INE029A01011', HINDALCO: 'NSE_EQ|INE038A01020',
  GRASIM: 'NSE_EQ|INE049A01031', TECHM: 'NSE_EQ|INE669C01020',
  BAJAJFINSV: 'NSE_EQ|INE298A01023', DRREDDY: 'NSE_EQ|INE088A01026',
  CIPLA: 'NSE_EQ|INE043A01027', EICHERMOT: 'NSE_EQ|INE066B01021',
  TATACONSUM: 'NSE_EQ|INE123A01022', HEROMOTOCO: 'NSE_EQ|INE158A01026',
  'M&M': 'NSE_EQ|INE101A01026', APOLLOHOSP: 'NSE_EQ|INE437B01018',
  DIVISLAB: 'NSE_EQ|INE363B01018', BRITANNIA: 'NSE_EQ|INE216A01030',
  INDUSINDBK: 'NSE_EQ|INE526A01015', HDFCLIFE: 'NSE_EQ|INE744G01013',
  SBILIFE: 'NSE_EQ|INE123B01016', YESBANK: 'NSE_EQ|INE528G01035',
  PNB: 'NSE_EQ|INE160A01015', BANKBARODA: 'NSE_EQ|INE028A01023',
  IDFCFIRSTB: 'NSE_EQ|INE092W01024', SHRIRAMFIN: 'NSE_EQ|INE745A01023',
  CHOLAFIN: 'NSE_EQ|INE324A01012', SUZLON: 'NSE_EQ|INE040D01025',
  ADANIPOWER: 'NSE_EQ|INE414E01016', HAL: 'NSE_EQ|INE095F01014',
  DMART: 'NSE_EQ|INE407L01015', TRENT: 'NSE_EQ|INE849A01017',
  VEDL: 'NSE_EQ|INE205A01024', SAIL: 'NSE_EQ|INE114A01011',
  NMDC: 'NSE_EQ|INE462B01014', IDEA: 'NSE_EQ|INE324A01026',
  OIL: 'NSE_EQ|INE274J01014', GAIL: 'NSE_EQ|INE129B01018',
  IOC: 'NSE_EQ|INE241A01010', PETRONET: 'NSE_EQ|INE267F01011',
}

// ─── Singleton Class ─────────────────────────────────────────────────────

class MarketDataManager {
  private static instance: MarketDataManager | null = null
  private latestIndices: Record<string, any> = {}
  private latestStocks: Record<string, any> = {}
  private handlers = new Set<UpdateHandler>()
  private initialized = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastPollTime = 0

  // Active data source tracking
  private activeSource: 'yahoo' | 'upstox' | 'database' | 'none' = 'none'
  private yahooAvailable = true
  private upstoxAvailable = false
  private upstoxTokenChecked = false

  // Rate limiting
  private consecutiveYahooErrors = 0
  private consecutiveUpstoxErrors = 0
  private baseInterval = 500 // 500ms polling for near real-time data
  private maxInterval = 5000 // max 5 seconds on errors

  // Yahoo Finance batch tracking
  private yahooIndexBatch: string[] = []
  private yahooStockBatches: string[][] = []

  private constructor() {}

  static getInstance(): MarketDataManager {
    if (!MarketDataManager.instance) {
      MarketDataManager.instance = new MarketDataManager()
    }
    return MarketDataManager.instance
  }

  get indices() { return this.latestIndices }
  get stocks() { return this.latestStocks }
  get source() { return this.activeSource }

  initialize() {
    if (this.initialized) return
    this.initialized = true

    // Prepare Yahoo Finance batches
    this.yahooIndexBatch = Object.entries(YAHOO_INDEX_SYMBOLS).map(
      ([symbol, yahooSymbol]) => `${symbol}::${yahooSymbol}`
    )

    // Split stocks into batches of 20 for Yahoo Finance (larger batches = fewer round trips)
    const stockEntries = Object.entries(YAHOO_STOCK_SYMBOLS).map(
      ([symbol, yahooSymbol]) => `${symbol}::${yahooSymbol}`
    )
    this.yahooStockBatches = []
    for (let i = 0; i < stockEntries.length; i += 20) {
      this.yahooStockBatches.push(stockEntries.slice(i, i + 20))
    }

    // Start polling
    this.startPolling()

    console.log('[MarketDataManager] Initialized - polling every', this.baseInterval, 'ms')
  }

  onUpdate(handler: UpdateHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private notifyHandlers() {
    const data: MarketUpdate = {
      indices: { ...this.latestIndices },
      stocks: { ...this.latestStocks },
      timestamp: Date.now(),
      source: this.activeSource,
    }
    this.handlers.forEach(h => {
      try { h(data) } catch {}
    })
  }

  private getPollInterval(): number {
    const errors = Math.max(this.consecutiveYahooErrors, this.consecutiveUpstoxErrors)
    if (errors === 0) return this.baseInterval
    return Math.min(this.baseInterval * Math.pow(1.5, errors), this.maxInterval)
  }

  private startPolling() {
    if (this.pollTimer) return

    const poll = async () => {
      const now = Date.now()
      const interval = this.getPollInterval()
      // Skip if previous poll is still recent (allow 80% of interval as skew)
      if (now - this.lastPollTime < interval * 0.8) return
      this.lastPollTime = now

      try {
        // Try Yahoo Finance first (free, no auth needed)
        if (this.yahooAvailable) {
          await this.fetchFromYahoo()
          this.consecutiveYahooErrors = 0
          this.activeSource = 'yahoo'
          this.updateCache()
          this.notifyHandlers()
          return
        }
      } catch (err) {
        this.consecutiveYahooErrors++
        if (this.consecutiveYahooErrors >= 5) {
          this.yahooAvailable = false
          console.warn('[MarketDataManager] Yahoo Finance unavailable after 5 errors, trying Upstox')
        }
      }

      // Fallback: Try Upstox
      try {
        if (!this.upstoxTokenChecked) {
          await this.checkUpstoxToken()
        }
        if (this.upstoxAvailable) {
          await this.fetchFromUpstox()
          this.consecutiveUpstoxErrors = 0
          this.activeSource = 'upstox'
          this.updateCache()
          this.notifyHandlers()
          return
        }
      } catch (err) {
        this.consecutiveUpstoxErrors++
        if (this.consecutiveUpstoxErrors >= 3) {
          this.upstoxAvailable = false
        }
      }

      // Final fallback: Database
      if (this.activeSource !== 'database') {
        await this.fetchFromDatabase()
        this.activeSource = 'database'
        this.updateCache()
        this.notifyHandlers()
      }
    }

    // Poll at 500ms base interval
    this.pollTimer = setInterval(poll, this.baseInterval)
    // Immediate first poll
    poll()
  }

  // ─── Yahoo Finance Fetching ────────────────────────────────────────────

  private async fetchFromYahoo() {
    const allResults: Record<string, any> = {}

    // Fetch indices and all stock batches in parallel for maximum speed
    const batchPromises = [
      this.fetchYahooBatch(this.yahooIndexBatch, allResults, true),
      ...this.yahooStockBatches.map(batch =>
        this.fetchYahooBatch(batch, allResults, false)
      ),
    ]
    await Promise.allSettled(batchPromises)

    // Separate into indices and stocks
    const newIndices: Record<string, any> = {}
    const newStocks: Record<string, any> = {}
    const indexSymbols = new Set(Object.keys(YAHOO_INDEX_SYMBOLS))

    for (const [symbol, data] of Object.entries(allResults)) {
      if (indexSymbols.has(symbol)) {
        newIndices[symbol] = data
      } else {
        newStocks[symbol] = data
      }
    }

    if (Object.keys(newIndices).length > 0 || Object.keys(newStocks).length > 0) {
      Object.assign(this.latestIndices, newIndices)
      Object.assign(this.latestStocks, newStocks)
    }
  }

  private async fetchYahooBatch(
    batch: string[],
    results: Record<string, any>,
    isIndex: boolean
  ) {
    // Build Yahoo Finance query URL with multiple symbols
    const yahooSymbols = batch.map(entry => {
      const [, yahooSymbol] = entry.split('::')
      return encodeURIComponent(yahooSymbol)
    })

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(',')}`

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      })

      if (!res.ok) {
        // Try the v8 chart API as fallback (works differently)
        await this.fetchYahooChartBatch(batch, results, isIndex)
        return
      }

      const json: any = await res.json()
      const quotes = json?.quoteResponse?.result || []

      for (const quote of quotes) {
        const symbol = this.getYahooSymbolKey(quote.symbol, batch)
        if (!symbol) continue

        results[symbol] = {
          last_price: quote.regularMarketPrice || 0,
          net_change: quote.regularMarketChange || 0,
          ohlc: {
            open: quote.regularMarketOpen || quote.regularMarketPreviousClose || 0,
            high: quote.regularMarketDayHigh || quote.regularMarketPrice || 0,
            low: quote.regularMarketDayLow || quote.regularMarketPrice || 0,
            close: quote.regularMarketPreviousClose || 0,
          },
          volume: quote.regularMarketVolume || null,
          ...(isIndex ? {} : { oi: null }),
        }
      }
    } catch {
      // Fallback to chart API
      await this.fetchYahooChartBatch(batch, results, isIndex)
    }
  }

  private async fetchYahooChartBatch(
    batch: string[],
    results: Record<string, any>,
    isIndex: boolean
  ) {
    // Use v8 chart API - fetch one at a time (more reliable)
    const promises = batch.map(async (entry) => {
      const [symbol, yahooSymbol] = entry.split('::')
      try {
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`
        const res = await fetch(chartUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(2000),
        })

        if (!res.ok) return

        const json: any = await res.json()
        const meta = json?.chart?.result?.[0]?.meta
        if (!meta) return

        const price = meta.regularMarketPrice || 0
        const prevClose = meta.previousClose || meta.chartPreviousClose || price

        results[symbol] = {
          last_price: price,
          net_change: price - prevClose,
          ohlc: {
            open: meta.regularMarketOpen || prevClose,
            high: meta.regularMarketDayHigh || price,
            low: meta.regularMarketDayLow || price,
            close: prevClose,
          },
          volume: meta.regularMarketVolume || null,
          ...(isIndex ? {} : { oi: null }),
        }
      } catch {
        // Skip this symbol
      }
    })

    await Promise.allSettled(promises)
  }

  private getYahooSymbolKey(yahooSymbol: string, batch: string[]): string | null {
    for (const entry of batch) {
      const [symbol, ySymbol] = entry.split('::')
      if (ySymbol === yahooSymbol) return symbol
    }
    return null
  }

  // ─── Upstox Fetching (Fallback) ────────────────────────────────────────

  private async checkUpstoxToken() {
    this.upstoxTokenChecked = true
    const accessToken = config.upstoxAccessToken
    if (!accessToken) {
      this.upstoxAvailable = false
      return
    }

    // Quick validation check
    try {
      const res = await fetch('https://api.upstox.com/v2/user/profile', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      })
      this.upstoxAvailable = res.ok
    } catch {
      this.upstoxAvailable = false
    }
  }

  private async fetchFromUpstox() {
    const UPSTOX_BASE = 'https://api.upstox.com/v2'
    const accessToken = config.upstoxAccessToken
    if (!accessToken) return

    // Fetch indices and stocks in parallel
    const [idxRes, stkRes] = await Promise.allSettled([
      this.fetchUpstoxQuotes(UPSTOX_BASE, accessToken, Object.values(UPSTOX_INDICES)),
      this.fetchUpstoxQuotes(UPSTOX_BASE, accessToken, Object.values(UPSTOX_STOCKS)),
    ])

    const idxData = idxRes.status === 'fulfilled' ? idxRes.value : {}
    const stkData = stkRes.status === 'fulfilled' ? stkRes.value : {}

    if (Object.keys(idxData).length > 0 || Object.keys(stkData).length > 0) {
      Object.assign(this.latestIndices, idxData)
      Object.assign(this.latestStocks, stkData)
    }
  }

  private async fetchUpstoxQuotes(
    baseUrl: string, token: string, keys: string[]
  ): Promise<Record<string, any>> {
    if (!keys.length) return {}

    const BATCH_SIZE = 25
    const results: Record<string, any> = {}

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE)
      try {
        const encoded = batch.map(k => encodeURIComponent(k)).join(',')
        const res = await fetch(
          `${baseUrl}/market-quote/quotes?instrument_key=${encoded}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(5000),
          }
        )
        if (!res.ok) continue
        const json: any = await res.json()
        if (!json?.data) continue

        for (const [key, q] of Object.entries(json.data)) {
          const quote = q as any
          const pipeKey = key.replace(':', '|')
          let symbol = this.getUpstoxSymbolFromKey(pipeKey) || this.getUpstoxSymbolFromKey(key)
          if (!symbol && quote.symbol) symbol = quote.symbol
          if (!symbol) continue

          results[symbol] = {
            last_price: quote.last_price || 0,
            net_change: quote.net_change || 0,
            ohlc: quote.ohlc || { open: 0, high: 0, low: 0, close: 0 },
            volume: quote.volume || null,
            oi: quote.oi || null,
          }
        }
      } catch {
        // Continue with next batch
      }
    }

    return results
  }

  private getUpstoxSymbolFromKey(instrumentKey: string): string | null {
    for (const [symbol, key] of Object.entries(UPSTOX_INDICES)) {
      if (key === instrumentKey || key.replace('|', ':') === instrumentKey) return symbol
    }
    for (const [symbol, key] of Object.entries(UPSTOX_STOCKS)) {
      if (key === instrumentKey || key.replace('|', ':') === instrumentKey) return symbol
      const segment = key.split('|')[0]
      if (instrumentKey === `${segment}:${symbol}`) return symbol
    }
    return null
  }

  // ─── Database Fallback ─────────────────────────────────────────────────

  private async fetchFromDatabase() {
    try {
      const dbIndices = await db.index.findMany({ where: { isEnabled: true } })
      for (const idx of dbIndices) {
        this.latestIndices[idx.symbol] = {
          last_price: idx.currentPrice,
          net_change: idx.change,
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
        this.latestStocks[stock.symbol] = {
          last_price: stock.currentPrice,
          net_change: stock.change,
          ohlc: {
            open: stock.open || stock.currentPrice,
            high: stock.high || stock.currentPrice,
            low: stock.low || stock.currentPrice,
            close: stock.previousClose || stock.currentPrice,
          },
          volume: stock.volume,
          oi: null,
        }
      }
    } catch {
      // DB not available
    }
  }

  // ─── Cache Update ─────────────────────────────────────────────────────

  private updateCache() {
    const cacheData: MarketUpdate = {
      indices: { ...this.latestIndices },
      stocks: { ...this.latestStocks },
      timestamp: Date.now(),
      source: this.activeSource,
    }
    cache.set(CacheKeys.marketLive(), cacheData, CacheTTL.MARKET_LIVE)
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  destroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.handlers.clear()
    this.initialized = false
  }

  // ─── Force Refresh ────────────────────────────────────────────────────

  forceRefresh() {
    // Reset error counts and re-enable sources
    this.consecutiveYahooErrors = 0
    this.consecutiveUpstoxErrors = 0
    this.yahooAvailable = true
    this.upstoxTokenChecked = false
    this.lastPollTime = 0
  }
}

// ─── Module-level singleton (no HMR globalThis needed in standalone server) ──

let singletonInstance: MarketDataManager | null = null

export function getMarketDataManager(): MarketDataManager {
  if (!singletonInstance) {
    singletonInstance = MarketDataManager.getInstance()
    singletonInstance.initialize()
  }
  return singletonInstance
}