/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Option Chain Service — Replaces /api/options/stream SSE endpoint
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Polls Upstox option chain API for subscribed underlying+expiry pairs.
 * Single polling instance per underlying+expiry, shared across clients.
 * Provides latestData for AutoExitService to read option prices.
 */

import type { ClientConnection } from '../ws/wsManager'
import { getExpiryDates } from '../lib/expiries'
import { getUpstoxToken } from '../lib/token-provider'

// ─── Types ────────────────────────────────────────────────────────────────

export interface OCStrike {
  strike_price: number
  expiry: string
  pcr: number
  underlying_spot_price: number
  call_options: {
    instrument_key: string
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: {
      iv: number; delta: number; theta: number; vega: number; gamma: number; pop: number
    }
  }
  put_options: {
    instrument_key: string
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: {
      iv: number; delta: number; theta: number; vega: number; gamma: number; pop: number
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

// ─── Index Config ─────────────────────────────────────────────────────────

const INDEX_CONFIGS: Record<string, { instrumentKey: string }> = {
  NIFTY: { instrumentKey: 'NSE_INDEX|Nifty 50' },
  BANKNIFTY: { instrumentKey: 'NSE_INDEX|Nifty Bank' },
  FINNIFTY: { instrumentKey: 'NSE_INDEX|Nifty Fin Service' },
  SENSEX: { instrumentKey: 'BSE_INDEX|SENSEX' },
}

// ─── Service ──────────────────────────────────────────────────────────────

interface SubscriptionKey {
  underlying: string
  expiry: string
}

export class OptionChainService {
  // Key: "NIFTY::2026-07-28" → Set of clients
  private subscriptions = new Map<string, Set<ClientConnection>>()
  // Key: "NIFTY::2026-07-28" → latest data
  private latestData = new Map<string, OCUpdate>()
  // Key: "NIFTY::2026-07-28" → poll timer
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>()
  // Dedup fetches
  private fetchInProgress = new Set<string>()
  // Max pain cache
  private maxPainCache = new Map<string, { strike: number; spotAtCalc: number }>()

  /** Get latest option chain data (used by AutoExitService) */
  getLatestData(underlying: string, expiry?: string): OCUpdate | null {
    if (expiry) return this.latestData.get(`${underlying}::${expiry}`) || null
    // Return any available data for this underlying
    for (const [key, data] of this.latestData) {
      if (key.startsWith(underlying.toUpperCase() + '::')) return data
    }
    return null
  }

  /** Get option LTP from latest data (used by AutoExitService) */
  getOptionLTP(symbol: string, optionType: string, strikePrice: number): number {
    const upper = symbol.toUpperCase()
    for (const [, data] of this.latestData) {
      if (data.underlying === upper && data.strikes) {
        const strike = data.strikes.find(s => s.strike_price === strikePrice)
        if (strike) {
          const optData = optionType === 'CE' ? strike.call_options?.market_data : strike.put_options?.market_data
          if (optData?.ltp && optData.ltp > 0) return optData.ltp
        }
      }
    }
    return 0
  }

  /** Get expiries for an underlying */
  getExpiries(underlying: string): string[] {
    return getExpiryDates(underlying)
  }

  addClient(client: ClientConnection, underlying: string, expiry: string) {
    const key = `${underlying.toUpperCase()}::${expiry}`
    console.log(`[OC Service] addClient: ${key}, existing subs: ${this.subscriptions.get(key)?.size || 0}`)

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }
    this.subscriptions.get(key)!.add(client)

    // Send latest data immediately
    const cached = this.latestData.get(key)
    if (cached) {
      try {
        client.ws.send(JSON.stringify({ type: 'options:update', data: cached }))
        console.log(`[OC Service] Sent cached data for ${key}, strikes: ${cached.strikes.length}, spot: ${cached.spot}`)
      } catch (err) {
        console.error(`[OC Service] Failed to send cached data:`, err)
      }
    } else {
      console.log(`[OC Service] No cached data for ${key}, starting fresh poll`)
    }

    // Start polling if first subscriber
    if (this.subscriptions.get(key)!.size === 1) {
      this.startPolling(underlying, expiry)
    }
  }

  removeClient(client: ClientConnection) {
    for (const [key, clients] of this.subscriptions) {
      clients.delete(client)
      if (clients.size === 0) {
        this.subscriptions.delete(key)
        this.stopPolling(key)
      }
    }
  }

  private startPolling(underlying: string, expiry: string) {
    const key = `${underlying.toUpperCase()}::${expiry}`
    if (this.pollTimers.has(key)) return

    // Immediate fetch
    this.fetchAndBroadcast(underlying, expiry)

    // Then every 1000ms
    const timer = setInterval(() => this.fetchAndBroadcast(underlying, expiry), 5000)
    this.pollTimers.set(key, timer)
  }

  private stopPolling(key: string) {
    const timer = this.pollTimers.get(key)
    if (timer) { clearInterval(timer); this.pollTimers.delete(key) }
  }

  private fetchErrorLogged = new Map<string, number>() // key → timestamp of last logged error

  private async fetchAndBroadcast(underlying: string, expiry: string) {
    const config = INDEX_CONFIGS[underlying.toUpperCase()]
    if (!config) {
      console.error(`[OC Service] No config for underlying: ${underlying}`)
      return
    }

    const token = await getUpstoxToken()
    if (!token) {
      const key = `${underlying.toUpperCase()}::${expiry}`
      const now = Date.now()
      if (!this.fetchErrorLogged.get(key) || now - this.fetchErrorLogged.get(key)! > 30000) {
        console.error(`[OC Service] No Upstox token available (checked env + DB + manual). Option chain cannot fetch.`)
        this.fetchErrorLogged.set(key, now)
      }
      return
    }

    const key = `${underlying.toUpperCase()}::${expiry}`

    if (this.fetchInProgress.has(key)) return
    this.fetchInProgress.add(key)

    try {
      const url = `${'https://api.upstox.com/v2'}/option/chain?instrument_key=${encodeURIComponent(config.instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        const now = Date.now()
        if (!this.fetchErrorLogged.get(key) || now - this.fetchErrorLogged.get(key)! > 30000) {
          const body = await res.text().catch(() => 'unreadable')
          console.error(`[OC Service] Upstox API ${res.status} for ${key}: ${body.substring(0, 200)}`)
          this.fetchErrorLogged.set(key, now)
        }
        return
      }
      const json: any = await res.json()
      if (json?.status === 'error') {
        const now = Date.now()
        if (!this.fetchErrorLogged.get(key) || now - this.fetchErrorLogged.get(key)! > 30000) {
          console.error(`[OC Service] Upstox error response for ${key}:`, JSON.stringify(json).substring(0, 200))
          this.fetchErrorLogged.set(key, now)
        }
        return
      }
      this.fetchErrorLogged.delete(key) // clear error log on success

      const chainData: OCStrike[] = json?.data || []
      if (chainData.length === 0) {
        const now = Date.now()
        if (!this.fetchErrorLogged.get(key) || now - this.fetchErrorLogged.get(key)! > 30000) {
          console.warn(`[OC Service] Empty chain data for ${key}. Full response:`, JSON.stringify(json).substring(0, 300))
          this.fetchErrorLogged.set(key, now)
        }
        return
      }

      const spot = chainData[0].underlying_spot_price || 0
      const totalCallOI = chainData.reduce((s, c) => s + (c.call_options?.market_data?.oi || 0), 0)
      const totalPutOI = chainData.reduce((s, c) => s + (c.put_options?.market_data?.oi || 0), 0)

      // Max pain calculation
      let maxPainStrike = 0
      const cachedMP = this.maxPainCache.get(key)
      const spotDelta = cachedMP ? Math.abs(spot - cachedMP.spotAtCalc) : Infinity
      if (cachedMP && spotDelta <= 20) {
        maxPainStrike = cachedMP.strike
      } else {
        let maxBuyerLoss = 0
        for (const strike of chainData) {
          const sp = strike.strike_price
          let callBuyerLoss = 0, putBuyerLoss = 0
          for (const s of chainData) {
            callBuyerLoss += Math.max(0, (s.call_options?.market_data?.close_price || 0) - Math.max(sp - s.strike_price, 0))
            putBuyerLoss += Math.max(0, (s.put_options?.market_data?.close_price || 0) - Math.max(s.strike_price - sp, 0))
          }
          if (callBuyerLoss + putBuyerLoss > maxBuyerLoss) {
            maxBuyerLoss = callBuyerLoss + putBuyerLoss
            maxPainStrike = sp
          }
        }
        this.maxPainCache.set(key, { strike: maxPainStrike, spotAtCalc: spot })
      }

      const update: OCUpdate = {
        underlying: underlying.toUpperCase(), spot,
        pcr: totalPutOI > 0 ? parseFloat((totalPutOI / totalCallOI).toFixed(2)) : 0,
        expiry, strikes: chainData, timestamp: Date.now(),
        totalCallOI, totalPutOI, maxPainStrike,
      }

      this.latestData.set(key, update)

      // Broadcast to subscribers
      const subs = this.subscriptions.get(key)
      if (subs && subs.size > 0) {
        const msg = JSON.stringify({ type: 'options:update', data: update })
        for (const client of subs) {
          if (client.ws.readyState === 1) {
            try { client.ws.send(msg) } catch {}
          }
        }
      }
    } catch (err) {
      const now = Date.now()
      if (!this.fetchErrorLogged.get(key) || now - this.fetchErrorLogged.get(key)! > 30000) {
        console.error(`[OC Service] Fetch error for ${key}:`, err)
        this.fetchErrorLogged.set(key, now)
      }
    } finally {
      this.fetchInProgress.delete(key)
    }
  }

  stop() {
    for (const timer of this.pollTimers.values()) clearInterval(timer)
    this.pollTimers.clear()
    this.subscriptions.clear()
    this.latestData.clear()
  }
}