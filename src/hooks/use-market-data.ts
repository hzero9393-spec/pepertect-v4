'use client'

// ─── Real-Time Market Data Hook ────────────────────────────────────────
// Uses WebSocket (Render server) for real-time push
// Falls back to REST polling when WS is unavailable
//
// Architecture:
//   Yahoo Finance → Render WS Server → WebSocket → Frontend
//   Fallback: REST polling → /api/market/live → Frontend

import { useEffect, useRef, useState, useCallback } from 'react'
import { wsClient, type WSStatus } from '@/lib/ws-client'
import { useAuthStore } from '@/lib/auth-store'

// ─── Types ────────────────────────────────────────────────────────────

export interface WsStockQuote {
  symbol: string
  last_price: number
  net_change: number
  ohlc: {
    open: number
    high: number
    low: number
    close: number
  }
  volume: number | null
  oi: number | null
}

export interface WsIndexQuote {
  symbol: string
  last_price: number
  net_change: number
  ohlc: {
    open: number
    high: number
    low: number
    close: number
  }
  volume: number | null
}

export interface WsOptionChainStrike {
  strikePrice: number
  ce: {
    ltp: number
    change: number
    volume: number
    oi: number
    oiChange: number
    iv: number
    delta: number
    bidPrice: number
    askPrice: number
  } | null
  pe: {
    ltp: number
    change: number
    volume: number
    oi: number
    oiChange: number
    iv: number
    delta: number
    bidPrice: number
    askPrice: number
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

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

// ─── SSE Market Data Manager (Singleton) ──────────────────────────────
// Single SSE connection feeds all subscribers

type StockUpdateHandler = (data: Record<string, WsStockQuote>) => void
type IndexUpdateHandler = (data: Record<string, WsIndexQuote>) => void
type OptionChainHandler = (data: WsOptionChainUpdate) => void
type StatusHandler = (status: ConnectionStatus) => void

class MarketDataManager {
  private static instance: MarketDataManager | null = null

  // Subscribers
  private stockHandlers = new Set<StockUpdateHandler>()
  private indexHandlers = new Set<IndexUpdateHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private optionChainHandlers = new Map<string, Set<OptionChainHandler>>()

  // WebSocket connection (managed by wsClient singleton)
  private wsCleanupFns: (() => void)[] = []
  private _status: ConnectionStatus = 'disconnected'

  // REST fallback
  private restPollTimer: ReturnType<typeof setInterval> | null = null
  private optionChainTimers = new Map<string, ReturnType<typeof setInterval>>()

  // Market status
  private _marketClosed: boolean = false
  private marketStatusTimer: ReturnType<typeof setInterval> | null = null

  // Latest data cache
  private latestStocks: Record<string, WsStockQuote> = {}
  private latestIndices: Record<string, WsIndexQuote> = {}
  private latestOptionChain = new Map<string, WsOptionChainUpdate>()

  // Active option chain subscriptions
  private subscribedOptionChains = new Map<string, { underlying: string; expiry?: string }>()

  // Error tracking
  private consecutiveErrors = 0
  private pollCount = 0

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
  get marketClosed(): boolean { return this._marketClosed }

  // ─── WebSocket Connection ──────────────────────────────────────

  connect() {
    if (this.wsCleanupFns.length > 0) return // Already connected

    // Ensure WS is connected with auth token
    const token = useAuthStore.getState().token
    if (token) wsClient.connect(token)

    this._status = 'connecting'
    this.notifyStatusHandlers()

    // Listen for WS status changes
    const unsubStatus = wsClient.onStatusChange((wsStatus: WSStatus) => {
      if (wsStatus === 'connected') {
        this._status = 'connected'
        this.consecutiveErrors = 0
        this.notifyStatusHandlers()
        this.stopRestPolling()
        // Subscribe to market channel
        wsClient.subscribe('market')
      } else if (wsStatus === 'disconnected' || wsStatus === 'error') {
        this._status = 'disconnected'
        this.notifyStatusHandlers()
        this.startRestPolling()
      }
    })
    this.wsCleanupFns.push(unsubStatus)

    // Listen for market:initial (first cached data)
    const unsubInitial = wsClient.on('market:initial', (data) => {
      console.log('[MarketWS] Received initial data')
      this.handleDataUpdate(data)
    })
    this.wsCleanupFns.push(unsubInitial)

    // Listen for market:update (streaming updates)
    const unsubUpdate = wsClient.on('market:update', (data) => {
      this.handleDataUpdate(data)
    })
    this.wsCleanupFns.push(unsubUpdate)

    // Also start market status check
    this.checkMarketStatus()
    if (this.marketStatusTimer) clearInterval(this.marketStatusTimer)
    this.marketStatusTimer = setInterval(() => {
      void this.checkMarketStatus()
    }, 120000)
  }

  disconnect() {
    // Cleanup WS handlers
    for (const fn of this.wsCleanupFns) fn()
    this.wsCleanupFns = []
    // Unsubscribe from WS market channel
    wsClient.unsubscribe('market')

    this.stopRestPolling()
    if (this.marketStatusTimer) {
      clearInterval(this.marketStatusTimer)
      this.marketStatusTimer = null
    }
    for (const timer of this.optionChainTimers.values()) {
      clearInterval(timer)
    }
    this.optionChainTimers.clear()
    this._status = 'disconnected'
    this._marketClosed = false
    this.notifyStatusHandlers()
  }

  // ─── Data Handling ────────────────────────────────────────────

  private handleDataUpdate(data: any) {
    // Handle indices
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
      // Merge with existing data
      Object.assign(this.latestIndices, indices)
      this.indexHandlers.forEach(h => { try { h(indices) } catch {} })
    }

    // Handle stocks
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
      // Merge with existing data
      Object.assign(this.latestStocks, stocks)
      this.stockHandlers.forEach(h => { try { h(stocks) } catch {} })
    }
  }

  // Reconnect is handled by wsClient singleton — no need for local reconnect logic

  // ─── REST Polling Fallback ────────────────────────────────────────

  private fetchInProgress = false

  private startRestPolling() {
    if (this.restPollTimer) return

    console.log('[MarketSSE] Starting REST polling fallback')
    void this.fetchMarketLive()

    const interval = this._marketClosed ? 30000 : 1000 // 1s polling when market open
    this.restPollTimer = setInterval(() => {
      void this.fetchMarketLive()
    }, interval)
  }

  private stopRestPolling() {
    if (this.restPollTimer) {
      clearInterval(this.restPollTimer)
      this.restPollTimer = null
    }
  }

  private async fetchMarketLive() {
    // Deduplicate: only one fetch at a time
    if (this.fetchInProgress) return
    this.fetchInProgress = true

    try {
      const res = await fetch('/api/market/live', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = await res.json()
      if (!json.success || !json.data) throw new Error('Invalid response')

      const { indices: rawIndices, stocks: rawStocks } = json.data

      // Transform indices
      const newIndices: Record<string, WsIndexQuote> = {}
      if (rawIndices && typeof rawIndices === 'object') {
        for (const [symbol, data] of Object.entries(rawIndices)) {
          const d = data as any
          newIndices[symbol] = {
            symbol,
            last_price: d.last_price ?? 0,
            net_change: d.net_change ?? 0,
            ohlc: d.ohlc ?? { open: 0, high: 0, low: 0, close: 0 },
            volume: d.volume ?? null,
          }
        }
      }

      // Transform stocks
      const newStocks: Record<string, WsStockQuote> = {}
      if (rawStocks && typeof rawStocks === 'object') {
        for (const [symbol, data] of Object.entries(rawStocks)) {
          const d = data as any
          newStocks[symbol] = {
            symbol,
            last_price: d.last_price ?? 0,
            net_change: d.net_change ?? 0,
            ohlc: d.ohlc ?? { open: 0, high: 0, low: 0, close: 0 },
            volume: d.volume ?? null,
            oi: d.oi ?? null,
          }
        }
      }

      this.latestIndices = newIndices
      this.latestStocks = newStocks
      this.consecutiveErrors = 0

      if (this._status !== 'connected') {
        this._status = 'connected'
        this.notifyStatusHandlers()
      }

      this.indexHandlers.forEach(h => { try { h(newIndices) } catch {} })
      this.stockHandlers.forEach(h => { try { h(newStocks) } catch {} })

    } catch (err) {
      this.consecutiveErrors++
      if (this.consecutiveErrors >= 5 && this._status !== 'disconnected') {
        this._status = 'disconnected'
        this.notifyStatusHandlers()
      }
    } finally {
      this.fetchInProgress = false
    }
  }

  // ─── Market Status Check ────────────────────────────────────────

  private async checkMarketStatus() {
    try {
      const res = await fetch('https://pepertect-api.onrender.com/api/market/status', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (res.ok) {
        const json = await res.json()
        const status = json.data?.status
        this._marketClosed = status !== 'OPEN' && status !== 'PRE-OPEN'

        // Adjust REST polling interval based on market status
        if (this.restPollTimer && this._status !== 'connected') {
          this.stopRestPolling()
          this.startRestPolling()
        }
      }
    } catch {
      this._marketClosed = true
    }
  }

  // ─── Option Chain Polling ─────────────────────────────────────────

  subscribeOptionChain(underlying: string, expiry?: string) {
    const key = expiry ? `${underlying}::${expiry}` : underlying
    if (this.subscribedOptionChains.has(key)) return

    this.subscribedOptionChains.set(key, { underlying, expiry })
    void this.fetchOptionChain(underlying, expiry)

    const timer = setInterval(() => {
      void this.fetchOptionChain(underlying, expiry)
    }, 3000)
    this.optionChainTimers.set(key, timer)

    const cached = this.latestOptionChain.get(key)
    if (cached) {
      const handlers = this.optionChainHandlers.get(underlying)
      if (handlers) handlers.forEach(h => { try { h(cached) } catch {} })
    }
  }

  unsubscribeOptionChain(underlying: string, expiry?: string) {
    const key = expiry ? `${underlying}::${expiry}` : underlying
    this.subscribedOptionChains.delete(key)
    this.latestOptionChain.delete(key)

    const timer = this.optionChainTimers.get(key)
    if (timer) {
      clearInterval(timer)
      this.optionChainTimers.delete(key)
    }
  }

  private async fetchOptionChain(underlying: string, expiry?: string) {
    try {
      let url = `/api/options/chain/${encodeURIComponent(underlying)}`
      if (expiry) url += `?expiry=${encodeURIComponent(expiry)}`

      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = await res.json()
      if (!json.success || !json.data) throw new Error('Invalid response')

      const data = json.data
      const chain: WsOptionChainStrike[] = (data.chain || []).map((item: Record<string, unknown>) => {
        const ce = item.ce as Record<string, unknown> | null
        const pe = item.pe as Record<string, unknown> | null
        return {
          strikePrice: (item.strikePrice as number) ?? 0,
          ce: ce ? {
            ltp: (ce.ltp as number) ?? 0, change: (ce.change as number) ?? 0,
            volume: (ce.volume as number) ?? 0, oi: (ce.oi as number) ?? 0,
            oiChange: (ce.oiChange as number) ?? 0, iv: (ce.iv as number) ?? 0,
            delta: (ce.delta as number) ?? 0, bidPrice: (ce.bidPrice as number) ?? 0,
            askPrice: (ce.askPrice as number) ?? 0,
          } : null,
          pe: pe ? {
            ltp: (pe.ltp as number) ?? 0, change: (pe.change as number) ?? 0,
            volume: (pe.volume as number) ?? 0, oi: (pe.oi as number) ?? 0,
            oiChange: (pe.oiChange as number) ?? 0, iv: (pe.iv as number) ?? 0,
            delta: (pe.delta as number) ?? 0, bidPrice: (pe.bidPrice as number) ?? 0,
            askPrice: (pe.askPrice as number) ?? 0,
          } : null,
        }
      })

      const update: WsOptionChainUpdate = {
        underlying, expiry: expiry ?? data.nearestExpiry ?? '',
        spot: (data.spot as number) ?? 0, pcr: (data.pcr as number) ?? 0,
        maxPain: (data.maxPain as number) ?? 0, chain,
        expiries: (data.expiries as string[]) ?? [],
        nearestExpiry: (data.nearestExpiry as string) ?? '',
        isRealData: (data.isRealData as boolean) ?? false,
        dataSource: (data.dataSource as string) ?? 'unknown',
        timestamp: Date.now(),
      }

      const key = expiry ? `${underlying}::${expiry}` : underlying
      this.latestOptionChain.set(key, update)

      const handlers = this.optionChainHandlers.get(underlying)
      if (handlers) handlers.forEach(h => { try { h(update) } catch {} })
    } catch {}
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
    return () => {
      const handlers = this.optionChainHandlers.get(underlying)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) this.optionChainHandlers.delete(underlying)
      }
    }
  }

  requestRefresh() {
    void this.fetchMarketLive()
  }

  private notifyStatusHandlers() {
    this.statusHandlers.forEach(h => { try { h(this._status) } catch {} })
  }
}

// ─── React Hooks ──────────────────────────────────────────────────────

/**
 * Hook to get real-time stock quotes via SSE + REST fallback
 */
export function useStockData() {
  const [stocks, setStocks] = useState<Record<string, WsStockQuote>>({})
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [marketClosed, setMarketClosed] = useState(false)
  const prevPricesRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const manager = MarketDataManager.getInstance()
    manager.connect()

    const unsubStocks = manager.onStockUpdate((data) => {
      if (manager.marketClosed) return
      let hasChanges = false
      const newPrices: Record<string, number> = {}
      for (const [symbol, quote] of Object.entries(data)) {
        newPrices[symbol] = quote.last_price
        if (prevPricesRef.current[symbol] !== quote.last_price) hasChanges = true
      }
      if (!hasChanges && Object.keys(prevPricesRef.current).length !== Object.keys(newPrices).length) {
        hasChanges = true
      }
      if (hasChanges) {
        prevPricesRef.current = newPrices
        setStocks(data)
      }
    })

    const unsubStatus = manager.onStatusChange((s) => {
      setStatus(s)
      setMarketClosed(manager.marketClosed)
    })

    return () => { unsubStocks(); unsubStatus() }
  }, [])

  return { stocks, status, marketClosed }
}

/**
 * Hook to get real-time index quotes via SSE + REST fallback
 */
export function useIndexData() {
  const [indices, setIndices] = useState<Record<string, WsIndexQuote>>({})
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [marketClosed, setMarketClosed] = useState(false)
  const prevPricesRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const manager = MarketDataManager.getInstance()
    manager.connect()

    const unsubIndices = manager.onIndexUpdate((data) => {
      if (manager.marketClosed) return
      let hasChanges = false
      const newPrices: Record<string, number> = {}
      for (const [symbol, quote] of Object.entries(data)) {
        newPrices[symbol] = quote.last_price
        if (prevPricesRef.current[symbol] !== quote.last_price) hasChanges = true
      }
      if (!hasChanges && Object.keys(prevPricesRef.current).length !== Object.keys(newPrices).length) {
        hasChanges = true
      }
      if (hasChanges) {
        prevPricesRef.current = newPrices
        setIndices(data)
      }
    })

    const unsubStatus = manager.onStatusChange((s) => {
      setStatus(s)
      setMarketClosed(manager.marketClosed)
    })

    return () => { unsubIndices(); unsubStatus() }
  }, [])

  return { indices, status, marketClosed }
}

/**
 * Hook to get a single stock's real-time quote
 */
export function useStockQuote(symbol: string) {
  const [quote, setQuote] = useState<WsStockQuote | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    const manager = MarketDataManager.getInstance()
    manager.connect()

    const unsubStocks = manager.onStockUpdate((data) => {
      const stockQuote = data[symbol]
      if (stockQuote) setQuote(stockQuote)
    })

    const unsubStatus = manager.onStatusChange((s) => setStatus(s))

    return () => { unsubStocks(); unsubStatus() }
  }, [symbol])

  return { quote, status }
}


/**
 * Hook to get connection status only
 */
export function useMarketDataStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    const manager = MarketDataManager.getInstance()
    manager.connect()

    const unsubStatus = manager.onStatusChange((s) => setStatus(s))
    return () => { unsubStatus() }
  }, [])

  return status
}

// Export the singleton for backward compat
export { MarketDataManager as MarketDataSocket }
