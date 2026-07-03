'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Flame,
  BarChart3,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CandlestickChart,
  Clock,
  Calendar,
  Circle,
  Minus,
  RefreshCw,
  Zap,
  WifiOff,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { formatPrice, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { useIndexData, useStockData, useMarketDataStatus, type WsIndexQuote, type WsStockQuote } from '@/hooks/use-market-data'

// ─── Types ──────────────────────────────────────────────────────────────────

interface IndexData {
  id: string
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  isEnabled: boolean
  isRealData?: boolean
  dataSource?: string
}

interface StockData {
  id: string
  symbol: string
  name: string
  sector: string
  currentPrice: number
  change: number
  changePercent: number
  volume?: number
  marketCap?: number
  isFuturesAvailable: boolean
  isOptionsAvailable: boolean
}

interface MarketStatusData {
  status: 'OPEN' | 'CLOSED' | 'PRE-OPEN' | 'POST-CLOSE'
  message: string
  istTime: string
  nextOpen: string | null
}

interface MarketBreadthData {
  id: string
  date: string
  advances: number
  declines: number
  unchanged: number
  week52Highs?: number
  week52Lows?: number
}

interface HolidayData {
  id: string
  name: string
  date: string
  isMuhurat: boolean
  muhuratStart: string | null
  muhuratEnd: string | null
}

interface SectorData {
  id: string
  name: string
  indexSymbol?: string
  todayChange: number
  topStockSymbol?: string
  topStockChange?: number
  isActive: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TARGET_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX']

// ─── Breadth Bar Component ──────────────────────────────────────────────────

function BreadthBar({ breadth }: { breadth: MarketBreadthData }) {
  const total = breadth.advances + breadth.declines + breadth.unchanged
  const advPct = total > 0 ? (breadth.advances / total) * 100 : 0
  const unchPct = total > 0 ? (breadth.unchanged / total) * 100 : 0
  const decPct = total > 0 ? (breadth.declines / total) * 100 : 0
  return (
    <div className="mb-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#f5f7fa]">
        {total > 0 && (
          <>
            <div className="bg-[#00B386] transition-all duration-500" style={{ width: `${advPct}%` }} />
            <div className="bg-[#6b7280] transition-all duration-500" style={{ width: `${unchPct}%` }} />
            <div className="bg-[#EB5B3C] transition-all duration-500" style={{ width: `${decPct}%` }} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Stock Row Component ────────────────────────────────────────────────────

function StockRow({ stock, onClick }: { stock: StockData; onClick: () => void }) {
  const isPositive = stock.changePercent >= 0
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-3 px-3 hover:bg-[#f5f7fa] rounded-lg cursor-pointer transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={cn(
          'size-9 rounded-lg flex items-center justify-center shrink-0',
          isPositive ? 'bg-[#00B386]/8' : 'bg-[#EB5B3C]/8'
        )}>
          <span className={cn('text-[10px] font-bold', isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>
            {stock.symbol.substring(0, 2)}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-[#1a1a1a] truncate">{stock.symbol}</span>
            {stock.isFuturesAvailable && stock.isOptionsAvailable && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 font-bold border-[#00D09C]/30 text-[#00D09C] bg-[#00D09C]/5">
                F&O
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-[#6b7280] truncate">{stock.name}</p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3 flex items-center gap-2">
        <div>
          <div className="text-sm font-bold font-mono text-[#1a1a1a]">
            ₹{formatPrice(stock.currentPrice)}
          </div>
          <div className={cn('flex items-center justify-end gap-1 text-xs font-semibold',
            isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
          )}>
            {isPositive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            <span>{stock.change >= 0 ? '+' : ''}{formatPrice(stock.change)}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
              isPositive ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'
            )}>
              {formatPercent(stock.changePercent)}
            </span>
          </div>
        </div>
        <ChevronRight className="size-4 text-[#d1d5db] group-hover:text-[#6b7280] shrink-0 transition-colors" />
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function DashboardPage() {
  const { navigateToStock, navigateToIndex } = useAppStore()

  // Data states
  const [indices, setIndices] = useState<IndexData[]>([])
  const [apiGainers, setApiGainers] = useState<StockData[]>([])
  const [apiLosers, setApiLosers] = useState<StockData[]>([])

  // Loading states
  const [indicesLoading, setIndicesLoading] = useState(true)
  const [gainersLoading, setGainersLoading] = useState(true)
  const [losersLoading, setLosersLoading] = useState(true)

  // Market status, breadth, holidays, sectors
  const [marketStatus, setMarketStatus] = useState<MarketStatusData | null>(null)
  const [marketBreadth, setMarketBreadth] = useState<MarketBreadthData | null>(null)
  const [holidays, setHolidays] = useState<HolidayData[]>([])
  const [sectors, setSectors] = useState<SectorData[]>([])
  const [marketStatusLoading, setMarketStatusLoading] = useState(true)
  const [breadthLoading, setBreadthLoading] = useState(true)
  const [holidaysLoading, setHolidaysLoading] = useState(true)
  const [sectorsLoading, setSectorsLoading] = useState(true)
  const [holidaysOpen, setHolidaysOpen] = useState(false)

  // WebSocket real-time data
  const { indices: wsIndices, status: wsIndexStatus } = useIndexData()
  const { stocks: wsStocks, status: wsStockStatus } = useStockData()
  const wsConnectionStatus = useMarketDataStatus()
  const isWsConnected = wsConnectionStatus === 'connected'

  // Refresh state
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Fetch Indices ───────────────────────────────────────────
  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch('/api/indices')
      if (res.ok) {
        const json = await res.json()
        if (json.data?.length > 0) setIndices(json.data)
      }
    } catch { /* silent */ }
    finally { setIndicesLoading(false) }
  }, [])

  // ─── Fetch Gainers ───────────────────────────────────────────
  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/gainers')
      if (res.ok) {
        const json = await res.json()
        if (json.data?.length > 0) setApiGainers(json.data)
      }
    } catch { /* silent */ }
    finally { setGainersLoading(false) }
  }, [])

  // ─── Fetch Losers ────────────────────────────────────────────
  const fetchLosers = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/losers')
      if (res.ok) {
        const json = await res.json()
        if (json.data?.length > 0) setApiLosers(json.data)
      }
    } catch { /* silent */ }
    finally { setLosersLoading(false) }
  }, [])

  // ─── Fetch Market Status ─────────────────────────────────────
  const fetchMarketStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/market/status')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) setMarketStatus(json.data)
      }
    } catch { /* silent */ }
    finally { setMarketStatusLoading(false) }
  }, [])

  // ─── Fetch Market Breadth ─────────────────────────────────────
  const fetchMarketBreadth = useCallback(async () => {
    try {
      const res = await fetch('/api/market/breadth')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) setMarketBreadth(json.data)
      }
    } catch { /* silent */ }
    finally { setBreadthLoading(false) }
  }, [])

  // ─── Fetch Holidays ───────────────────────────────────────────
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch('/api/market/holidays')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data?.length > 0) setHolidays(json.data)
      }
    } catch { /* silent */ }
    finally { setHolidaysLoading(false) }
  }, [])

  // ─── Fetch Sectors ────────────────────────────────────────────
  const fetchSectors = useCallback(async () => {
    try {
      const res = await fetch('https://pepertect-api.onrender.com/api/sectors')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data?.length > 0) setSectors(json.data)
      }
    } catch { /* silent */ }
    finally { setSectorsLoading(false) }
  }, [])

  // ─── Refresh all data ─────────────────────────────────────────
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true)
    await Promise.allSettled([
      fetchIndices(),
      fetchGainers(),
      fetchLosers(),
      fetchMarketStatus(),
      fetchMarketBreadth(),
      fetchSectors(),
    ])
    setLastRefreshed(new Date())
    setIsRefreshing(false)
  }, [fetchIndices, fetchGainers, fetchLosers, fetchMarketStatus, fetchMarketBreadth, fetchSectors])

  // ─── Merge WebSocket index data with REST data ────────────────────
  const mergedIndices = useMemo(() => {
    if (isWsConnected && Object.keys(wsIndices).length > 0) {
      // WS data is primary — overlay on REST data
      return indices.map(idx => {
        const wsQuote = wsIndices[idx.symbol]
        if (wsQuote) {
          const previousClose = wsQuote.ohlc.close - wsQuote.net_change
          const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : 0
          return {
            ...idx,
            currentPrice: wsQuote.last_price,
            change: wsQuote.net_change,
            changePercent,
            isRealData: true,
            dataSource: 'upstox',
          }
        }
        return idx
      })
    }
    return indices
  }, [indices, wsIndices, isWsConnected])

  // ─── Fast real-time index data via SSE (primary) ─────────────
  // SSE via useIndexData() handles real-time index updates.
  // No need for separate /api/market/live polling — SSE pushes updates at 500ms.
  useEffect(() => {
    fetchIndices()
  }, [fetchIndices])

  // ─── Load all data ───────────────────────────────────────────
  useEffect(() => {
    fetchIndices()
    fetchGainers()
    fetchLosers()
    fetchMarketStatus()
    fetchMarketBreadth()
    fetchHolidays()
    fetchSectors()
    setLastRefreshed(new Date())

    // ─── Smart polling based on SSE connection ──────────────────
    // SSE connected: skip indices (real-time via SSE) & market status (fetched elsewhere),
    //   poll gainers/losers/breadth every 30s (they don't change every second),
    //   poll sectors every 5min (rarely change).
    // SSE disconnected: poll all every 5s as fallback.
    if (isWsConnected) {
      // One-time fetch for sectors (they rarely change)
      fetchSectors()
      // Gainers/losers/breadth/status — slower poll when SSE is live
      const slowPoll = setInterval(() => {
        fetchGainers()
        fetchLosers()
        fetchMarketBreadth()
        fetchMarketStatus()
        setLastRefreshed(new Date())
      }, 30000)
      // Sectors re-fetch every 5min
      const sectorPoll = setInterval(() => {
        fetchSectors()
      }, 300000)
      return () => {
        clearInterval(slowPoll)
        clearInterval(sectorPoll)
      }
    } else {
      // No SSE — poll all every 5s
      refreshTimerRef.current = setInterval(() => {
        fetchIndices()
        fetchGainers()
        fetchLosers()
        fetchMarketStatus()
        fetchMarketBreadth()
        fetchSectors()
        setLastRefreshed(new Date())
      }, 5000)
      return () => {
        if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      }
    }
  }, [fetchIndices, fetchGainers, fetchLosers, fetchMarketStatus, fetchMarketBreadth, fetchHolidays, fetchSectors, isWsConnected])

  // ─── Listen for index detail events from ticker ────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.symbol) navigateToIndex(detail.symbol)
    }
    window.addEventListener('openIndexDetail', handler)
    return () => window.removeEventListener('openIndexDetail', handler)
  }, [navigateToIndex])

  // ─── Get sorted indices matching our target list (WS-enhanced) ──
  const displayIndices = TARGET_INDICES.map(symbol =>
    mergedIndices.find(idx => idx.symbol === symbol)
  ).filter(Boolean) as IndexData[]

  // ─── Index Card Component ──────────────────────────────────
  function IndexCard({ index }: { index: IndexData }) {
    const isPositive = index.changePercent >= 0

    return (
      <Card
        onClick={() => navigateToIndex(index.symbol)}
        className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm hover:shadow-lg hover:border-[#00D09C]/40 transition-all duration-200 cursor-pointer group overflow-hidden"
      >
        <CardContent className="p-4">
          {/* Index Name Row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#666] tracking-wider uppercase">
                {index.name || index.symbol}
              </span>
            </div>
            {isPositive ? (
              <TrendingUp className="size-4 text-[#00B386] opacity-60 group-hover:opacity-100 transition-opacity" />
            ) : (
              <TrendingDown className="size-4 text-[#EB5B3C] opacity-60 group-hover:opacity-100 transition-opacity" />
            )}
          </div>

          {/* Price */}
          <div className="text-[28px] font-bold font-mono text-[#1a1a1a] leading-tight mb-1">
            ₹{formatPrice(index.currentPrice)}
          </div>

          {/* Change Row */}
          <div className={cn('flex items-center gap-1.5 text-xs font-semibold mb-3',
            isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
          )}>
            {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            <span>{index.change >= 0 ? '+' : ''}{formatPrice(index.change)}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold',
              isPositive ? 'bg-[#00B386]/10 text-[#00B386]' : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
            )}>
              {formatPercent(index.changePercent)}
            </span>
          </div>

          {/* View Details Footer */}
          <div className="flex items-center justify-end pt-2 border-t border-[#f0f0f0]">
            <span className="text-[10px] font-semibold text-[#00D09C] flex items-center gap-1 group-hover:gap-2 transition-all">
              View Details <ChevronRight className="size-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── Index Card Skeleton ──────────────────────────────────
  function IndexCardSkeleton() {
    return (
      <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-3 w-24 bg-[#f5f7fa]" />
            <Skeleton className="size-4 rounded bg-[#f5f7fa]" />
          </div>
          <Skeleton className="h-8 w-32 mb-1.5 bg-[#f5f7fa]" />
          <Skeleton className="h-4 w-28 mb-3 bg-[#f5f7fa]" />
          <div className="flex items-center justify-end pt-2 border-t border-[#f0f0f0]">
            <Skeleton className="h-3 w-20 bg-[#f5f7fa]" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa]">

      {/* ═══ MAIN CONTENT (No Tab Bar) ═════════════════════════════════════════ */}
      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-5">

        {/* ── Market Status Banner ────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {marketStatus ? (
              <div className={cn(
                'flex items-center justify-between px-4 py-2.5 rounded-xl border',
                marketStatus.status === 'OPEN'
                  ? 'bg-[#00B386]/5 border-[#00B386]/20'
                  : marketStatus.status === 'PRE-OPEN'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-white border-[#e5e7eb]'
              )}>
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    <Circle
                      className={cn('size-2.5 fill-current',
                        marketStatus.status === 'OPEN' ? 'text-[#00B386]' :
                        marketStatus.status === 'PRE-OPEN' ? 'text-amber-500' : 'text-[#6b7280]'
                      )}
                    />
                    {marketStatus.status === 'OPEN' && (
                      <span className="absolute inset-0 rounded-full animate-ping bg-[#00B386]/40" />
                    )}
                  </div>
                  <span className={cn('text-xs font-bold tracking-wider',
                    marketStatus.status === 'OPEN' ? 'text-[#00B386]' :
                    marketStatus.status === 'PRE-OPEN' ? 'text-amber-600' : 'text-[#6b7280]'
                  )}>
                    {marketStatus.status === 'POST-CLOSE' ? 'POST-CLOSE' : marketStatus.status}
                  </span>
                  <span className="text-[11px] text-[#6b7280]">·</span>
                  <span className="text-[11px] text-[#6b7280]">{marketStatus.message}</span>
                </div>
                <div className="flex items-center gap-2">
                  {marketStatus.nextOpen && (
                    <span className="text-[10px] text-[#6b7280] hidden sm:inline">
                      Opens: {new Date(marketStatus.nextOpen).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-[11px] text-[#6b7280]">
                    <Clock className="size-3" />
                    <span className="font-mono">{marketStatus.istTime}</span>
                    <span className="text-[9px] font-medium">IST</span>
                  </div>
                </div>
              </div>
            ) : marketStatusLoading ? (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-[#e5e7eb] bg-white">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-2.5 rounded-full bg-[#e5e7eb]" />
                  <Skeleton className="h-3 w-16 bg-[#e5e7eb]" />
                  <Skeleton className="h-3 w-24 bg-[#e5e7eb]" />
                </div>
                <Skeleton className="h-3 w-20 bg-[#e5e7eb]" />
              </div>
            ) : null}
          </div>
          {/* Manual Refresh */}
          <button
            onClick={refreshAll}
            disabled={isRefreshing}
            className="ml-3 size-8 rounded-lg border border-[#e5e7eb] bg-white flex items-center justify-center hover:bg-[#f5f7fa] transition-colors disabled:opacity-50 shadow-sm"
            title="Refresh data"
          >
            <RefreshCw className={cn('size-3.5 text-[#6b7280]', isRefreshing && 'animate-spin')} />
          </button>
        </div>

        {/* ── 4 Index Cards ────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#1a1a1a] flex items-center gap-2">
              <CandlestickChart className="size-4 text-[#00D09C]" />
              Index Overview
            </h2>
            <span className="text-[10px] text-[#9ca3af]">
              Last refreshed: {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {indicesLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <IndexCardSkeleton key={i} />
              ))
            ) : displayIndices.length > 0 ? (
              displayIndices.map((index, i) => (
                <motion.div
                  key={index.symbol}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                >
                  <IndexCard index={index} />
                </motion.div>
              ))
            ) : (
              <div className="col-span-full">
                <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                  <CardContent className="p-8 text-center">
                    <BarChart3 className="size-8 text-[#d1d5db] mx-auto mb-2" />
                    <p className="text-sm text-[#6b7280]">Index data unavailable</p>
                    <p className="text-xs text-[#9ca3af] mt-1">Please check your connection and try again</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* ── Market Breadth + Sectors Row ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Market Breadth Card */}
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="size-6 rounded-lg bg-[#00D09C]/10 flex items-center justify-center">
                  <Activity className="size-3 text-[#00D09C]" />
                </div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">Market Breadth</h3>
              </div>
              {breadthLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full bg-[#f5f7fa]" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-16 bg-[#f5f7fa]" />
                    <Skeleton className="h-4 w-16 bg-[#f5f7fa]" />
                    <Skeleton className="h-4 w-16 bg-[#f5f7fa]" />
                  </div>
                </div>
              ) : marketBreadth ? (
                <>
                  <BreadthBar breadth={marketBreadth} />
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <ArrowUpRight className="size-3 text-[#00B386]" />
                      <span className="text-xs font-bold text-[#00B386] font-mono">{marketBreadth.advances}</span>
                      <span className="text-[10px] text-[#6b7280]">Adv</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Minus className="size-3 text-[#6b7280]" />
                      <span className="text-xs font-bold text-[#6b7280] font-mono">{marketBreadth.unchanged}</span>
                      <span className="text-[10px] text-[#6b7280]">Unch</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ArrowDownRight className="size-3 text-[#EB5B3C]" />
                      <span className="text-xs font-bold text-[#EB5B3C] font-mono">{marketBreadth.declines}</span>
                      <span className="text-[10px] text-[#6b7280]">Dec</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#f0f0f0]">
                    <div className="text-center">
                      <p className="text-[9px] font-bold text-[#9ca3af] tracking-wider uppercase">52W Highs</p>
                      <p className="text-xs font-bold font-mono text-[#00B386]">{marketBreadth.week52Highs ?? '-'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] font-bold text-[#9ca3af] tracking-wider uppercase">52W Lows</p>
                      <p className="text-xs font-bold font-mono text-[#EB5B3C]">{marketBreadth.week52Lows ?? '-'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] font-bold text-[#9ca3af] tracking-wider uppercase">Total</p>
                      <p className="text-xs font-bold font-mono text-[#1a1a1a]">{marketBreadth.advances + marketBreadth.declines + marketBreadth.unchanged}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-[#6b7280]">Breadth data unavailable</p>
              )}
            </CardContent>
          </Card>

          {/* Sectors Performance Card */}
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="size-6 rounded-lg bg-[#00D09C]/10 flex items-center justify-center">
                  <BarChart3 className="size-3 text-[#00D09C]" />
                </div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">Sector Performance</h3>
              </div>
              {sectorsLoading ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-20 rounded-full bg-[#f5f7fa]" />
                  ))}
                </div>
              ) : sectors.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {sectors.map((sector) => {
                    const isPositive = sector.todayChange >= 0
                    return (
                      <div
                        key={sector.id}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                          isPositive
                            ? 'bg-[#00B386]/5 border-[#00B386]/20 text-[#00B386]'
                            : 'bg-[#EB5B3C]/5 border-[#EB5B3C]/20 text-[#EB5B3C]'
                        )}
                      >
                        {isPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        <span>{sector.name}</span>
                        <span className="font-mono">
                          {formatPercent(sector.todayChange)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#6b7280]">Sector data unavailable</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Top Gainers & Losers Row ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Gainers */}
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-lg bg-[#00B386]/10 flex items-center justify-center">
                    <Flame className="size-3.5 text-[#00B386]" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">Top Gainers</h3>
                </div>
                <span className="text-[11px] text-[#9ca3af] font-medium">{apiGainers.length} stocks</span>
              </div>
              {gainersLoading ? (
                <div className="px-5 pb-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <Skeleton className="h-4 w-20 bg-[#f5f7fa]" />
                      <Skeleton className="h-4 w-16 bg-[#f5f7fa]" />
                    </div>
                  ))}
                </div>
              ) : apiGainers.length > 0 ? (
                <div className="px-2 pb-2 divide-y divide-[#f0f0f0] max-h-96 overflow-y-auto">
                  {apiGainers.map((stock) => (
                    <StockRow key={stock.id} stock={stock} onClick={() => navigateToStock(stock.symbol)} />
                  ))}
                </div>
              ) : (
                <div className="px-5 pb-4 text-center">
                  <p className="text-xs text-[#6b7280]">Gainers data unavailable</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Losers */}
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-lg bg-[#EB5B3C]/10 flex items-center justify-center">
                    <TrendingDown className="size-3.5 text-[#EB5B3C]" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">Top Losers</h3>
                </div>
                <span className="text-[11px] text-[#9ca3af] font-medium">{apiLosers.length} stocks</span>
              </div>
              {losersLoading ? (
                <div className="px-5 pb-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <Skeleton className="h-4 w-20 bg-[#f5f7fa]" />
                      <Skeleton className="h-4 w-16 bg-[#f5f7fa]" />
                    </div>
                  ))}
                </div>
              ) : apiLosers.length > 0 ? (
                <div className="px-2 pb-2 divide-y divide-[#f0f0f0] max-h-96 overflow-y-auto">
                  {apiLosers.map((stock) => (
                    <StockRow key={stock.id} stock={stock} onClick={() => navigateToStock(stock.symbol)} />
                  ))}
                </div>
              ) : (
                <div className="px-5 pb-4 text-center">
                  <p className="text-xs text-[#6b7280]">Losers data unavailable</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Upcoming Holidays ─────────────────────────────────────────── */}
        {!holidaysLoading && holidays.length > 0 && (
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-0">
              <button
                onClick={() => setHolidaysOpen(!holidaysOpen)}
                className="flex items-center justify-between w-full px-5 py-3.5 text-left hover:bg-[#f5f7fa]/50 transition-colors rounded-t-xl"
              >
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Calendar className="size-3.5 text-amber-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">Upcoming Holidays</h3>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-bold border-amber-200 text-amber-600 bg-amber-50">
                    {holidays.length}
                  </Badge>
                </div>
                {holidaysOpen ? (
                  <ChevronUp className="size-4 text-[#6b7280]" />
                ) : (
                  <ChevronDown className="size-4 text-[#6b7280]" />
                )}
              </button>
              <AnimatePresence>
                {holidaysOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-3 divide-y divide-[#f0f0f0]">
                      {holidays.slice(0, 5).map((holiday) => {
                        const holidayDate = new Date(holiday.date)
                        const dayName = holidayDate.toLocaleDateString('en-IN', { weekday: 'short' })
                        const dateStr = holidayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                        return (
                          <div key={holiday.id} className="flex items-center justify-between py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="size-8 rounded-lg bg-[#f5f7fa] flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-[#6b7280]">{dayName}</span>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-[#1a1a1a]">{holiday.name}</p>
                                <p className="text-[10px] text-[#6b7280]">{dateStr}</p>
                              </div>
                            </div>
                            {holiday.isMuhurat && (
                              <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4 font-bold border-[#00D09C]/30 text-[#00D09C] bg-[#00D09C]/5">
                                Muhurat
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
