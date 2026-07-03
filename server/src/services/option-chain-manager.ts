/**
 * OptionChainManager — Standalone server-side singleton
 *
 * Polls Upstox option chain API every 1s for subscribed indices.
 * Streams updates to connected WebSocket clients via callbacks.
 * Only polls when at least one subscriber exists.
 *
 * Adapted from the Next.js version for use in the standalone WebSocket server.
 *
 * Indices: NIFTY, BANKNIFTY, FINNIFTY, SENSEX
 */

import { config } from '../config.js'
import { getExpiryDates as getCalendarExpiries } from '../lib/upstox-instruments.js'

const UPSTOX_API_V2 = 'https://api.upstox.com/v2'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OCStrike {
  strike_price: number
  expiry: string
  pcr: number
  underlying_spot_price: number
  call_options: {
    instrument_key: string
    market_data: {
      ltp: number
      volume: number
      oi: number
      close_price: number
      bid_price: number
      bid_qty: number
      ask_price: number
      ask_qty: number
      prev_oi: number
    }
    option_greeks: {
      iv: number
      delta: number
      theta: number
      vega: number
      gamma: number
      pop: number
    }
  }
  put_options: {
    instrument_key: string
    market_data: {
      ltp: number
      volume: number
      oi: number
      close_price: number
      bid_price: number
      bid_qty: number
      ask_price: number
      ask_qty: number
      prev_oi: number
    }
    option_greeks: {
      iv: number
      delta: number
      theta: number
      vega: number
      gamma: number
      pop: number
    }
  }
}

export interface OCUpdate {
  underlying: string
  spot: number
  pcr: number
  expiry: string
  strikes: OCStrike[]
  timestamp: number
  totalCallOI: number
  totalPutOI: number
  maxPainStrike: number
}

type OCSubscriber = (update: OCUpdate) => void

// ─── Index Config ───────────────────────────────────────────────────────────

const INDEX_CONFIGS: Record<string, { instrumentKey: string; name: string }> = {
  NIFTY: { instrumentKey: 'NSE_INDEX|Nifty 50', name: 'NIFTY 50' },
  BANKNIFTY: { instrumentKey: 'NSE_INDEX|Nifty Bank', name: 'BANK NIFTY' },
  FINNIFTY: { instrumentKey: 'NSE_INDEX|Nifty Fin Service', name: 'FINNIFTY' },
  SENSEX: { instrumentKey: 'BSE_INDEX|SENSEX', name: 'SENSEX' },
}

// ─── Singleton ──────────────────────────────────────────────────────────────

class OptionChainManager {
  private subscribers = new Map<string, Set<OCSubscriber>>() // key: "NIFTY::2026-07-28"
  private latestData = new Map<string, OCUpdate>()
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>()
  private expiriesCache = new Map<string, string[]>()
  private maxPainCache = new Map<string, { strike: number; spotAtCalc: number }>() // cache max pain per key
  private fetchInProgress = new Set<string>() // deduplicate overlapping fetches

  /** Subscribe to option chain updates for an underlying + expiry */
  subscribe(underlying: string, expiry: string, handler: OCSubscriber): () => void {
    const key = `${underlying}::${expiry}`
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    this.subscribers.get(key)!.add(handler)

    // Send latest data immediately if available
    const cached = this.latestData.get(key)
    if (cached) handler(cached)

    // Start polling if this is the first subscriber
    this.startPolling(underlying, expiry)

    // Return unsubscribe function
    return () => {
      this.subscribers.get(key)?.delete(handler)
      if (this.subscribers.get(key)?.size === 0) {
        this.subscribers.delete(key)
        this.stopPolling(key)
      }
    }
  }

  /** Get expiries for an underlying (uses calendar, no API call needed) */
  async getExpiries(underlying: string): Promise<string[]> {
    const cached = this.expiriesCache.get(underlying)
    if (cached) return cached

    // Use calendar-based expiry lookup (instant, no network call)
    const expiries = await getCalendarExpiries(underlying)
    if (expiries.length > 0) {
      this.expiriesCache.set(underlying, expiries)
    }
    return expiries
  }

  /** Get latest cached data */
  getLatest(underlying: string, expiry: string): OCUpdate | null {
    return this.latestData.get(`${underlying}::${expiry}`) || null
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  private startPolling(underlying: string, expiry: string) {
    const key = `${underlying}::${expiry}`
    if (this.pollTimers.has(key)) return

    // Fetch immediately
    this.fetchAndBroadcast(underlying, expiry)

    // Then every 1000ms for near real-time data
    const timer = setInterval(() => {
      this.fetchAndBroadcast(underlying, expiry)
    }, 1000)

    this.pollTimers.set(key, timer)
  }

  private stopPolling(key: string) {
    const timer = this.pollTimers.get(key)
    if (timer) {
      clearInterval(timer)
      this.pollTimers.delete(key)
    }
  }

  private async fetchAndBroadcast(underlying: string, expiry: string) {
    const cfg = INDEX_CONFIGS[underlying.toUpperCase()]
    if (!cfg) return

    const token = config.upstoxAccessToken
    if (!token) return

    const key = `${underlying}::${expiry}`

    // Deduplicate: skip if previous fetch for this key is still in flight
    if (this.fetchInProgress.has(key)) return
    this.fetchInProgress.add(key)

    try {
      const url = `${UPSTOX_API_V2}/option/chain?instrument_key=${encodeURIComponent(cfg.instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      })

      if (!res.ok) return

      const json = await res.json()
      if (json?.status === 'error') return

      const chainData: OCStrike[] = json?.data || []
      if (chainData.length === 0) return

      const spot = chainData[0].underlying_spot_price || 0
      const totalCallOI = chainData.reduce((s, c) => s + (c.call_options?.market_data?.oi || 0), 0)
      const totalPutOI = chainData.reduce((s, c) => s + (c.put_options?.market_data?.oi || 0), 0)

      // Calculate max pain (strike with max combined buyer loss)
      // Optimization: cache max pain and only recalculate when spot moves > 20 points
      let maxPainStrike = 0
      const cachedMP = this.maxPainCache.get(key)
      const spotDelta = cachedMP ? Math.abs(spot - cachedMP.spotAtCalc) : Infinity
      if (cachedMP && spotDelta <= 20) {
        maxPainStrike = cachedMP.strike
      } else {
        let maxBuyerLoss = 0
        for (const strike of chainData) {
          const sp = strike.strike_price
          let callBuyerLoss = 0
          let putBuyerLoss = 0
          for (const s of chainData) {
            callBuyerLoss += Math.max(0, (s.call_options?.market_data?.close_price || 0) - Math.max(sp - s.strike_price, 0))
            putBuyerLoss += Math.max(0, (s.put_options?.market_data?.close_price || 0) - Math.max(s.strike_price - sp, 0))
          }
          const totalLoss = callBuyerLoss + putBuyerLoss
          if (totalLoss > maxBuyerLoss) {
            maxBuyerLoss = totalLoss
            maxPainStrike = sp
          }
        }
        this.maxPainCache.set(key, { strike: maxPainStrike, spotAtCalc: spot })
      }

      const update: OCUpdate = {
        underlying,
        spot,
        pcr: totalPutOI > 0 ? parseFloat((totalPutOI / totalCallOI).toFixed(2)) : 0,
        expiry,
        strikes: chainData,
        timestamp: Date.now(),
        totalCallOI,
        totalPutOI,
        maxPainStrike,
      }

      this.latestData.set(key, update)

      // Broadcast to subscribers
      const subs = this.subscribers.get(key)
      if (subs) {
        for (const handler of subs) {
          try { handler(update) } catch { /* ignore */ }
        }
      }
    } catch {
      // Silently continue polling
    } finally {
      this.fetchInProgress.delete(key)
    }
  }

  /** Stop all polling (cleanup) */
  destroy() {
    for (const timer of this.pollTimers.values()) clearInterval(timer)
    this.pollTimers.clear()
    this.subscribers.clear()
  }
}

// ─── Module-level singleton (no HMR globalThis needed in standalone server) ──

let singletonInstance: OptionChainManager | null = null

export function getOptionChainManager(): OptionChainManager {
  if (!singletonInstance) {
    singletonInstance = new OptionChainManager()
  }
  return singletonInstance
}