/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Market Derived Data Service — Gainers, Losers, Breadth, Status, Sectors
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Listens to MarketDataService updates via callback and computes:
 *  - Top 5 gainers / bottom 5 losers by changePercent
 *  - Market breadth (advances / declines / unchanged)
 *  - Live market status (from IST time + holiday DB)
 *  - Sector data (from DB, 5 min cache)
 *
 * Broadcasts `market:derived` to all `market` channel subscribers.
 */

import { db } from '../lib/db'
import type { MarketDataService } from './marketData'

// ─── Types ────────────────────────────────────────────────────────────────

export interface GainerLoserEntry {
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  volume: number | null
}

export interface MarketBreadth {
  advances: number
  declines: number
  unchanged: number
}

export interface MarketStatus {
  status: 'OPEN' | 'CLOSED' | 'PRE-OPEN' | 'POST-CLOSE'
  message: string
  istTime: string
  nextOpen: string | null
}

export interface DerivedData {
  gainers: GainerLoserEntry[]
  losers: GainerLoserEntry[]
  breadth: MarketBreadth
  marketStatus: MarketStatus
  sectors: any[]
  timestamp: number
}

// ─── Broadcast callback signature ─────────────────────────────────────────

export type BroadcastFn = (channel: string, data: object) => void

// ─── Service ──────────────────────────────────────────────────────────────

export class MarketDerivedService {
  private marketService: MarketDataService
  private broadcast: BroadcastFn
  private stockNames = new Map<string, string>()
  private cachedData: DerivedData | null = null

  // Sector cache
  private cachedSectors: { data: any[]; expiresAt: number } | null = null
  private readonly SECTORS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  // Holiday cache (avoid hitting DB on every poll)
  private cachedHolidays: { data: Map<string, any>; expiresAt: number } | null = null
  private readonly HOLIDAY_CACHE_TTL = 60 * 60 * 1000 // 1 hour

  constructor(marketService: MarketDataService, broadcast: BroadcastFn) {
    this.marketService = marketService
    this.broadcast = broadcast
  }

  /** Start the derived service: load names, register callback */
  async start() {
    await this.loadStockNames()
    this.marketService.onUpdate(() => {
      this.onMarketUpdate().catch((err) => {
        console.error('[MarketDerived] Error computing derived data:', err)
      })
    })
    console.log('[MarketDerived] Started — listening to market updates')
  }

  /** Stop the derived service */
  stop() {
    // No timers to clean up — lifecycle is tied to marketService callbacks
    this.cachedData = null
    this.cachedSectors = null
    this.cachedHolidays = null
    console.log('[MarketDerived] Stopped')
  }

  /** Returns the last computed derived data (for immediate send to new subscribers) */
  getLatestData(): DerivedData | null {
    return this.cachedData
  }

  // ─── Internal ─────────────────────────────────────────────────────

  /** One-time load of symbol → name mapping from DB */
  private async loadStockNames() {
    try {
      const stocks = await db.stock.findMany({
        where: { isActive: true },
        select: { symbol: true, name: true },
      })
      for (const s of stocks) {
        this.stockNames.set(s.symbol, s.name)
      }
      console.log(`[MarketDerived] Loaded ${this.stockNames.size} stock names`)
    } catch (err) {
      console.error('[MarketDerived] Failed to load stock names:', err)
    }
  }

  /** Called by MarketDataService after every successful poll */
  private async onMarketUpdate() {
    // Skip if no one is subscribed to market channel
    if (this.marketService.clientCount === 0) return

    const stocks = this.marketService.stocks
    const stockEntries = Object.entries(stocks)

    if (stockEntries.length === 0) return

    // ── Compute changePercent for each stock ──
    const enriched: GainerLoserEntry[] = []
    for (const [symbol, data] of stockEntries) {
      const lastPrice = data.last_price ?? 0
      const prevClose = data.ohlc?.close ?? 0
      const change = data.net_change ?? (lastPrice - prevClose)
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0

      enriched.push({
        symbol,
        name: this.stockNames.get(symbol) ?? symbol,
        currentPrice: lastPrice,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: data.volume ?? null,
      })
    }

    // ── Sort by changePercent descending ──
    enriched.sort((a, b) => b.changePercent - a.changePercent)

    // ── Top 5 gainers ──
    const gainers = enriched.slice(0, 5)

    // ── Bottom 5 losers (from the end) ──
    const losers = enriched.length > 5
      ? enriched.slice(-5).reverse()
      : enriched.filter(e => e.changePercent < 0).slice(0, 5)

    // ── Market breadth ──
    let advances = 0
    let declines = 0
    let unchanged = 0
    for (const e of enriched) {
      if (e.changePercent > 0) advances++
      else if (e.changePercent < 0) declines++
      else unchanged++
    }

    // ── Market status + sectors (fetched in parallel, both cached) ──
    const [marketStatus, sectors] = await Promise.all([
      this.computeMarketStatus(),
      this.fetchSectors(),
    ])

    // ── Build and cache derived data ──
    this.cachedData = {
      gainers,
      losers,
      breadth: { advances, declines, unchanged },
      marketStatus,
      sectors,
      timestamp: Date.now(),
    }

    // ── Broadcast to market channel subscribers ──
    this.broadcast('market', { type: 'market:derived', data: this.cachedData })
  }

  // ─── Market Status (same logic as routes.ts) ─────────────────────

  private getISTNow(): Date {
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    return new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60000)
  }

  private async fetchHolidays(): Promise<Map<string, any>> {
    const now = Date.now()
    if (this.cachedHolidays && this.cachedHolidays.expiresAt > now) {
      return this.cachedHolidays.data
    }

    try {
      const holidays = await db.marketHoliday.findMany()
      const map = new Map<string, any>()
      for (const h of holidays) {
        // Key by date string YYYY-MM-DD
        const dateStr = h.date.toISOString().split('T')[0]
        map.set(dateStr, h)
      }
      this.cachedHolidays = { data: map, expiresAt: now + this.HOLIDAY_CACHE_TTL }
      return map
    } catch {
      return new Map()
    }
  }

  private async computeMarketStatus(): Promise<MarketStatus> {
    const adjusted = this.getISTNow()
    const hours = adjusted.getHours()
    const minutes = adjusted.getMinutes()
    const day = adjusted.getDay()
    const timeInMinutes = hours * 60 + minutes
    const todayStr = adjusted.toISOString().split('T')[0]

    const holidays = await this.fetchHolidays()
    const holiday = holidays.get(todayStr) ?? null

    let status: MarketStatus['status']
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
          status = 'OPEN'
          message = `Muhurat Trading Session (${holiday.muhuratStart} - ${holiday.muhuratEnd})`
        } else if (timeInMinutes < muhuratStartMin) {
          status = 'PRE-OPEN'
          message = `Muhurat Trading opens at ${holiday.muhuratStart} IST - ${holiday.name}`
        } else {
          status = 'CLOSED'
          message = `Market closed - ${holiday.name} (Muhurat session ended)`
        }
      } else {
        status = 'CLOSED'
        message = `Market closed - ${holiday.name}`
      }
    } else {
      if (timeInMinutes >= 540 && timeInMinutes < 555) {
        status = 'PRE-OPEN'
        message = 'Pre-open session (9:00 - 9:15 IST)'
      } else if (timeInMinutes >= 555 && timeInMinutes < 930) {
        status = 'OPEN'
        message = 'Market is open (9:15 - 15:30 IST)'
      } else if (timeInMinutes >= 930 && timeInMinutes < 960) {
        status = 'POST-CLOSE'
        message = 'Post-close session (15:30 - 16:00 IST)'
      } else if (timeInMinutes < 540) {
        status = 'CLOSED'
        message = 'Market opens at 9:00 IST (Pre-open session)'
      } else {
        status = 'CLOSED'
        message = 'Market closed for the day'
      }
    }

    return {
      status,
      message,
      istTime: adjusted.toISOString(),
      nextOpen,
    }
  }

  // ─── Sectors (cached 5 min) ──────────────────────────────────────

  private async fetchSectors(): Promise<any[]> {
    const now = Date.now()
    if (this.cachedSectors && this.cachedSectors.expiresAt > now) {
      return this.cachedSectors.data
    }

    try {
      const sectors = await db.sector.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      })
      this.cachedSectors = { data: sectors, expiresAt: now + this.SECTORS_CACHE_TTL }
      return sectors
    } catch (err) {
      console.error('[MarketDerived] Failed to fetch sectors:', err)
      return this.cachedSectors?.data ?? []
    }
  }
}