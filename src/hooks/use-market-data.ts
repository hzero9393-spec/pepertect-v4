'use client'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ZERO-POLLING Market Data Layer — Production Architecture
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   Render WS Server (1 fetch) → WebSocket push → ALL users
 *   Fallback: 10s REST polling ONLY when WS disconnected
 *
 * What this replaces:
 *   ❌ 500ms /api/market/live polling (index-ticker)
 *   ❌ 5s /api/stocks/gainers polling
 *   ❌ 5s /api/stocks/losers polling
 *   ❌ 5s /api/market/breadth polling
 *   ❌ 5s /api/market/status polling
 *   ❌ 5s /api/sectors polling (direct to Render)
 *   ❌ 5s /api/options/chain REST polling
 *   ❌ 30s /api/trade/positions REST polling
 *
 * ALL data now arrives via WebSocket:
 *   ✅ market:update → indices + stocks (500ms from server)
 *   ✅ market:derived → gainers + losers + breadth + sectors + marketStatus
 *   ✅ options:update → option chain (5s from server)
 *   ✅ positions → user positions (10s from server)
 *   ✅ exit → SL/Target hit notifications
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { wsClient, type WSStatus } from '@/lib/ws-client'
import { useAuthStore } from '@/lib/auth-store'

// Render server direct URL — bypass Vercel entirely for fallback
const RENDER_WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'wss://pepertect-api.onrender.com'
const RENDER_REST_BASE = RENDER_WS_BASE.replace('wss://', 'https://').replace('ws://', 'http://')

// ─── Types ────────────────────────────────────────────────────────────

export interface WsStockQuote {
  symbol: string
  last_price: number
  net_change: number
  ohlc: { open: number; high: number; low: number; close: number }
  volume: number | null
  oi: number | null
}

export interface WsIndexQuote {
  symbol: string
  last_price: number
  net_change: number
  ohlc: { open: number; high: number; low: number; close: number }
  volume: number | null
}

export interface WsOptionChainStrike {
  strikePrice: number
  ce: {
    ltp: number; change: number; volume: number; oi: number; oiChange: number
    iv: number; delta: number; bidPrice: number; askPrice: number
  } | null
  pe: {
    ltp: number; change: number; volume: number; oi: number; oiChange: number
    iv: number; delta: number; bidPrice: number; askPrice: number
  } | null
}

export interface WsOptionChainUpdate {
  underlying: string
  expiry: string
  spot: number
  pcr: number
  maxPain: number
  chain: WsOptionChainStrike[]
  expiries: string[]
  nearestExpiry: string
  isRealData: boolean
  dataSource: string
  timestamp: number
}

export interface DerivedMarketData {
  gainers: Array<{
    symbol: string; name: string; currentPrice: number
    change: number; changePercent: number; volume: number | null
  }>
  losers: Array<{
    symbol: string; name: string; currentPrice: number
    change: number; changePercent: number; volume: number | null
  }>
  breadth: { advances: number; declines: number; unchanged: number }
  marketStatus: {
    status: string; message: string; istTime: string; nextOpen: string | null
  } | null
  sectors: Array<{
    id: string; name: string; indexSymbol?: string
    todayChange: number; topStockSymbol?: string; topStockChange?: number
    isActive: boolean
  }>
  timestamp: number
}

export interface WsPositionUpdate {
  positionId: string
  symbol: string
  segment: string
  optionType: string | null
  strikePrice: number | null
  expiryDate: string | null
  currentPrice: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  tradeDirection: string
  isOpen: boolean
  exitEvent?: {
    reason: string; exitPrice: number; pnl: number; timestamp: number
  }
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

// ─── Handler Types ─────────────────────────────────────────────────────

type StockUpdateHandler = (data: Record<string, WsStockQuote>) => void
type IndexUpdateHandler = (data: Record<string, WsIndexQuote>) => void
type DerivedHandler = (data: DerivedMarketData) => void
type OptionChainHandler = (data: WsOptionChainUpdate) => void
type PositionHandler = (data: WsPositionUpdate[]) => void
type ExitHandler = (data: any) => void
type StatusHandler = (status: ConnectionStatus) => void

// ─── Market Data Manager (Singleton) ──────────────────────────────────
// Zero-polling: ALL data via WebSocket. 10s REST fallback only on disconnect.

class MarketDataManager {
  private static instance: MarketDataManager | null = null

  // Subscribers
  private stockHandlers = new Set<StockUpdateHandler>()
  private indexHandlers = new Set<IndexUpdateHandler>()
  private derivedHandlers = new Set<DerivedHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private optionChainHandlers = new Map<string, Set<OptionChainHandler>>()
  private positionHandlers = new Set<PositionHandler>()
  private exitHandlers = new Set<ExitHandler>()

  // WebSocket cleanup
  private wsCleanupFns: (() => void)[] = []
  private _status: ConnectionStatus = 'disconnected'
  private connected = false

  // REST fallback — ONLY when WS disconnected
  private restFallbackTimer: ReturnType<typeof setInterval> | null = null
  private fetchInProgress = false
  private consecutiveErrors = 0

  // Latest data cache
  private latestStocks: Record<string, WsStockQuote> = {}
  private latestIndices: Record<string, WsIndexQuote> = {}
  private latestDerived: DerivedMarketData | null = null
  private latestPositions: WsPositionUpdate[] = []

  // Market status from WS
  private _marketClosed: boolean = true

  // Positions subscription flag
  private positionsSubscribed = false

  constructor() {}

  static getInstance(): MarketDataManager {
    if (!MarketDataManager.instance) {
      MarketDataManager.instance = new MarketDataManager()
    }
    return MarketDataManager.instance
  }

  get status(): ConnectionStatus { return this._status }
  get stocks(): Record<string, WsStockQuote> { return this.latestStocks }
  get indices(): Record<string, WsIndexQuote> { return this.latestIndices }
  get derived(): DerivedMarketData | null { return this.latestDerived }
  get marketClosed(): boolean { return this._marketClosed }

  // ─── WebSocket Connection ──────────────────────────────────────

  connect() {
    if (this.wsCleanupFns.length > 0) return

    const token = useAuthStore.getState().token
    if (token) wsClient.connect(token)

    const alreadyConnected = wsClient.isConnected()
    this._status = alreadyConnected ? 'connected' : 'connecting'
    this.connected = alreadyConnected
    this.notifyStatusHandlers()

    // ── WS status changes ──
    const unsubStatus = wsClient.onStatusChange((wsStatus: WSStatus) => {
      if (wsStatus === 'connected') {
        this._status = 'connected'
        this.connected = true
        this.consecutiveErrors = 0
        this.notifyStatusHandlers()
        this.stopRestFallback()
        // Subscribe to all channels
        wsClient.subscribe('market')
        if (this.positionsSubscribed) wsClient.subscribe('positions')
      } else if (wsStatus === 'disconnected' || wsStatus === 'error') {
        this._status = 'disconnected'
        this.connected = false
        this.notifyStatusHandlers()
        this.startRestFallback()
      }
    })
    this.wsCleanupFns.push(unsubStatus)

    // ── market:initial (cached data on subscribe) ──
    const unsubInitial = wsClient.on('market:initial', (data) => {
      this.handleDataUpdate(data)
    })
    this.wsCleanupFns.push(unsubInitial)

    // ── market:update (streaming indices + stocks) ──
    const unsubUpdate = wsClient.on('market:update', (data) => {
      this.handleDataUpdate(data)
    })
    this.wsCleanupFns.push(unsubUpdate)

    // ── market:derived (gainers, losers, breadth, sectors, status) ──
    const unsubDerived = wsClient.on('market:derived', (data) => {
      this.handleDerivedUpdate(data)
    })
    this.wsCleanupFns.push(unsubDerived)

    // ── options:update (option chain) ──
    const unsubOptions = wsClient.on('options:update', (data) => {
      this.handleOptionChainUpdate(data)
    })
    this.wsCleanupFns.push(unsubOptions)

    // ── positions (user position updates) ──
    const unsubPositions = wsClient.on('positions', (data) => {
      this.latestPositions = data || []
      this.positionHandlers.forEach(h => { try { h(this.latestPositions) } catch {} })
    })
    this.wsCleanupFns.push(unsubPositions)

    // ── exit (SL/Target hit) ──
    const unsubExit = wsClient.on('exit', (data) => {
      this.exitHandlers.forEach(h => { try { h(data) } catch {} })
    })
    this.wsCleanupFns.push(unsubExit)

    // If WS already connected, subscribe immediately
    if (alreadyConnected) {
      this.stopRestFallback()
      wsClient.subscribe('market')
      if (this.positionsSubscribed) wsClient.subscribe('positions')
    }
  }

  disconnect() {
    for (const fn of this.wsCleanupFns) fn()
    this.wsCleanupFns = []
    wsClient.unsubscribe('market')
    wsClient.unsubscribe('positions')
    this.stopRestFallback()
    this._status = 'disconnected'
    this.connected = false
    this.notifyStatusHandlers()
  }

  // ─── Subscribe to Positions ────────────────────────────────────

  subscribePositions() {
    if (this.positionsSubscribed) return
    this.positionsSubscribed = true
    if (this.connected) {
      wsClient.subscribe('positions')
    }
  }

  unsubscribePositions() {
    this.positionsSubscribed = false
    wsClient.unsubscribe('positions')
    this.latestPositions = []
  }

  // ─── Option Chain via WS ───────────────────────────────────────

  subscribeOptionChain(underlying: string, expiry?: string) {
    // Send subscribe message to server — server handles polling
    wsClient.subscribe('options', { underlying, expiry })

    // Return cached data if available
    const cached = this.latestOptionChain.get(expiry ? `${underlying}::${expiry}` : underlying)
    return cached
  }

  private latestOptionChain = new Map<string, WsOptionChainUpdate>()

  unsubscribeOptionChain(_underlying: string, _expiry?: string) {
    wsClient.unsubscribe('options')
  }

  // ─── Data Handlers ─────────────────────────────────────────────

  private handleDataUpdate(data: any) {
    // Indices
    if (data.indices && typeof data.indices === 'object') {
      const indices: Record<string, WsIndexQuote> = {}
      for (const [symbol, raw] of Object.entries(data.indices)) {
        const d = raw as any
        indices[symbol] = {
          symbol,
          last_price: d.last_price ?? 0,
          net_change: d.net_change ?? 0,
          ohlc: d.ohlc ?? { open: 0, high: 0, low: 0, close: 0 },
          volume: d.volume ?? null,
        }
      }
      Object.assign(this.latestIndices, indices)
      this.indexHandlers.forEach(h => { try { h(indices) } catch {} })
    }

    // Stocks
    if (data.stocks && typeof data.stocks === 'object') {
      const stocks: Record<string, WsStockQuote> = {}
      for (const [symbol, raw] of Object.entries(data.stocks)) {
        const d = raw as any
        stocks[symbol] = {
          symbol,
          last_price: d.last_price ?? 0,
          net_change: d.net_change ?? 0,
          ohlc: d.ohlc ?? { open: 0, high: 0, low: 0, close: 0 },
          volume: d.volume ?? null,
          oi: d.oi ?? null,
        }
      }
      Object.assign(this.latestStocks, stocks)
      this.stockHandlers.forEach(h => { try { h(stocks) } catch {} })
    }
  }

  private handleDerivedUpdate(data: any) {
    if (!data) return
    const derived: DerivedMarketData = {
      gainers: data.gainers || [],
      losers: data.losers || [],
      breadth: data.breadth || { advances: 0, declines: 0, unchanged: 0 },
      marketStatus: data.marketStatus || null,
      sectors: data.sectors || [],
      timestamp: data.timestamp || Date.now(),
    }
    this.latestDerived = derived

    // Update market closed flag
    if (derived.marketStatus) {
      this._marketClosed = derived.marketStatus.status !== 'OPEN' && derived.marketStatus.status !== 'PRE-OPEN'
    }

    this.derivedHandlers.forEach(h => { try { h(derived) } catch {} })
  }

  private handleOptionChainUpdate(data: any) {
    if (!data) return
    const chain: WsOptionChainStrike[] = (data.strikes || []).map((s: any) => {
      const ce = s.call_options?.market_data
      const ceGreeks = s.call_options?.option_greeks
      const pe = s.put_options?.market_data
      const peGreeks = s.put_options?.option_greeks
      return {
        strikePrice: s.strike_price ?? 0,
        ce: ce ? {
          ltp: ce.ltp ?? 0, change: (ce.ltp ?? 0) - (ce.close_price ?? 0),
          volume: ce.volume ?? 0, oi: ce.oi ?? 0,
          oiChange: (ce.oi ?? 0) - (ce.prev_oi ?? 0),
          iv: ceGreeks?.iv ?? 0, delta: ceGreeks?.delta ?? 0,
          bidPrice: ce.bid_price ?? 0, askPrice: ce.ask_price ?? 0,
        } : null,
        pe: pe ? {
          ltp: pe.ltp ?? 0, change: (pe.ltp ?? 0) - (pe.close_price ?? 0),
          volume: pe.volume ?? 0, oi: pe.oi ?? 0,
          oiChange: (pe.oi ?? 0) - (pe.prev_oi ?? 0),
          iv: peGreeks?.iv ?? 0, delta: peGreeks?.delta ?? 0,
          bidPrice: pe.bid_price ?? 0, askPrice: pe.ask_price ?? 0,
        } : null,
      }
    })

    const update: WsOptionChainUpdate = {
      underlying: data.underlying || '',
      expiry: data.expiry || '',
      spot: data.spot ?? 0,
      pcr: data.pcr ?? 0,
      maxPain: data.maxPainStrike ?? 0,
      chain,
      expiries: [], // Server sends these separately if needed
      nearestExpiry: data.expiry || '',
      isRealData: true,
      dataSource: 'websocket',
      timestamp: data.timestamp || Date.now(),
    }

    const key = `${update.underlying}::${update.expiry}`
    this.latestOptionChain.set(key, update)

    const handlers = this.optionChainHandlers.get(update.underlying)
    if (handlers) handlers.forEach(h => { try { h(update) } catch {} })
  }

  // ─── REST Fallback (10s, directly to Render — ZERO Vercel calls) ──

  private startRestFallback() {
    if (this.restFallbackTimer) return
    console.log('[MarketData] WS disconnected — starting 10s REST fallback to Render')
    void this.fetchFallback()
    this.restFallbackTimer = setInterval(() => void this.fetchFallback(), 10000)
  }

  private stopRestFallback() {
    if (this.restFallbackTimer) {
      clearInterval(this.restFallbackTimer)
      this.restFallbackTimer = null
    }
  }

  private async fetchFallback() {
    if (this.fetchInProgress || this.connected) return
    this.fetchInProgress = true
    try {
      // Hit Render server directly — NOT /api/market/live (which goes to Vercel)
      const token = useAuthStore.getState().token
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      // Fetch cached market data from Render's in-memory cache
      const res = await fetch(`${RENDER_REST_BASE}/api/market/status`, {
        headers,
        cache: 'no-store',
      })
      if (res.ok) {
        const json = await res.json()
        // We can get market status at minimum, even if live data isn't available via REST
        if (json.data) {
          // Update market status from fallback
          if (json.data.status && this.latestDerived) {
            this.latestDerived = {
              ...this.latestDerived,
              marketStatus: json.data,
            }
            this.derivedHandlers.forEach(h => { try { h(this.latestDerived!) } catch {} })
          }
        }
      }
      this.consecutiveErrors = 0
    } catch {
      this.consecutiveErrors++
      if (this.consecutiveErrors >= 5) {
        this._status = 'disconnected'
        this.notifyStatusHandlers()
      }
    } finally {
      this.fetchInProgress = false
    }
  }

  // ─── Subscriber Management ────────────────────────────────────────

  onStockUpdate(handler: StockUpdateHandler) {
    this.stockHandlers.add(handler)
    if (Object.keys(this.latestStocks).length > 0) handler(this.latestStocks)
    return () => this.stockHandlers.delete(handler)
  }

  onIndexUpdate(handler: IndexUpdateHandler) {
    this.indexHandlers.add(handler)
    if (Object.keys(this.latestIndices).length > 0) handler(this.latestIndices)
    return () => this.indexHandlers.delete(handler)
  }

  onDerivedUpdate(handler: DerivedHandler) {
    this.derivedHandlers.add(handler)
    if (this.latestDerived) handler(this.latestDerived)
    return () => this.derivedHandlers.delete(handler)
  }

  onStatusChange(handler: StatusHandler) {
    this.statusHandlers.add(handler)
    handler(this._status)
    return () => this.statusHandlers.delete(handler)
  }

  onOptionChainUpdate(underlying: string, handler: OptionChainHandler) {
    if (!this.optionChainHandlers.has(underlying)) {
      this.optionChainHandlers.set(underlying, new Set())
    }
    this.optionChainHandlers.get(underlying)!.add(handler)
    // Send cached data immediately
    for (const [, data] of this.latestOptionChain) {
      if (data.underlying === underlying) handler(data)
    }
    return () => {
      const handlers = this.optionChainHandlers.get(underlying)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) this.optionChainHandlers.delete(underlying)
      }
    }
  }

  onPositionUpdate(handler: PositionHandler) {
    this.positionHandlers.add(handler)
    if (this.latestPositions.length > 0) handler(this.latestPositions)
    return () => this.positionHandlers.delete(handler)
  }

  onExit(handler: ExitHandler) {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }

  private notifyStatusHandlers() {
    this.statusHandlers.forEach(h => { try { h(this._status) } catch {} })
  }
}

// ─── React Hooks ──────────────────────────────────────────────────────

/** Real-time stock quotes via WebSocket (zero polling) */
export function useStockData() {
  const [stocks, setStocks] = useState<Record<string, WsStockQuote>>({})
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [marketClosed, setMarketClosed] = useState(true)
  const prevRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    const u1 = m.onStockUpdate((data) => {
      if (m.marketClosed) return
      let changed = false
      const prices: Record<string, number> = {}
      for (const [s, q] of Object.entries(data)) {
        prices[s] = q.last_price
        if (prevRef.current[s] !== q.last_price) changed = true
      }
      if (!changed && Object.keys(prevRef.current).length !== Object.keys(prices).length) changed = true
      if (changed) { prevRef.current = prices; setStocks(data) }
    })
    const u2 = m.onStatusChange((s) => { setStatus(s); setMarketClosed(m.marketClosed) })
    return () => { u1(); u2() }
  }, [])

  return { stocks, status, marketClosed }
}

/** Real-time index quotes via WebSocket (zero polling) */
export function useIndexData() {
  const [indices, setIndices] = useState<Record<string, WsIndexQuote>>({})
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [marketClosed, setMarketClosed] = useState(true)
  const prevRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    const u1 = m.onIndexUpdate((data) => {
      if (m.marketClosed) return
      let changed = false
      const prices: Record<string, number> = {}
      for (const [s, q] of Object.entries(data)) {
        prices[s] = q.last_price
        if (prevRef.current[s] !== q.last_price) changed = true
      }
      if (!changed && Object.keys(prevRef.current).length !== Object.keys(prices).length) changed = true
      if (changed) { prevRef.current = prices; setIndices(data) }
    })
    const u2 = m.onStatusChange((s) => { setStatus(s); setMarketClosed(m.marketClosed) })
    return () => { u1(); u2() }
  }, [])

  return { indices, status, marketClosed }
}

/** Real-time derived data (gainers, losers, breadth, sectors, market status) via WebSocket */
export function useDerivedData() {
  const [derived, setDerived] = useState<DerivedMarketData | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    const u1 = m.onDerivedUpdate(setDerived)
    const u2 = m.onStatusChange(setStatus)
    return () => { u1(); u2() }
  }, [])

  return { derived, status }
}

/** Single stock quote via WebSocket */
export function useStockQuote(symbol: string) {
  const [quote, setQuote] = useState<WsStockQuote | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    const u1 = m.onStockUpdate((data) => {
      const q = data[symbol]
      if (q) setQuote(q)
    })
    const u2 = m.onStatusChange(setStatus)
    return () => { u1(); u2() }
  }, [symbol])

  return { quote, status }
}

/** Real-time positions via WebSocket (zero polling) */
export function usePositions() {
  const [positions, setPositions] = useState<WsPositionUpdate[]>([])

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    m.subscribePositions()
    const u = m.onPositionUpdate(setPositions)
    return () => { u(); m.unsubscribePositions() }
  }, [])

  return positions
}

/** Connection status only */
export function useMarketDataStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    const m = MarketDataManager.getInstance()
    m.connect()
    const u = m.onStatusChange(setStatus)
    return () => u()
  }, [])

  return status
}

// Backward compat export
export { MarketDataManager as MarketDataSocket }