'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Info,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  Loader2,
  BarChart3,
  ShoppingCart,
  Activity,
  RefreshCw,
  Layers,
  Target,
  Gauge,
  Zap,
  Eye,
  Star,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { useWatchlistStore } from '@/lib/watchlist-store'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'
import { TradeConfirmModal, TradeConfirmData } from '@/components/pepertect/ui/trade-confirm-modal'
import { motion, AnimatePresence } from 'framer-motion'
import { formatINR, formatINRWhole, formatLargeNumber, formatVolume, formatPrice, formatPercent, calculateBrokerage } from '@/lib/format'
import { StockLogo } from '@/components/pepertect/ui/stock-logo'
import { useStockQuote } from '@/hooks/use-market-data'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────

interface StockDetail {
  symbol: string
  name: string
  sector: string
  industry: string
  exchange: string
  isin: string | null
  currentPrice: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  previousClose: number
  close: number
  volume: number
  totalTradedValue: number
  averageTradePrice: number
  week52High: number
  week52Low: number
  upperCircuit: number
  lowerCircuit: number
  marketCap: number
  peRatio: number | null
  eps: number
  dividendYield: number
  pbRatio: number
  roe: number
  bookValue: number
  debtToEquity: number
  faceValue: number
  industryPE: number
  lotSize: number
  isFuturesAvailable: boolean
  isOptionsAvailable: boolean
  isFnoBan: boolean
  strikeInterval: number | null
  deliveryQuantity: number | null
  deliveryPercentage: number | null
  vwap: number | null
  isRealData: boolean
  dataSource: 'upstox' | 'dhan' | 'yahoo' | 'database'
}

interface SimilarStock {
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  sector: string
}

interface CandleData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface FutureContract {
  underlying: string
  expiryDate: string
  lotSize: number
  ltp: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  previousClose: number
  volume: number
  oi: number
  oiChange: number
  basis: number
  basisPercent: number
}

interface OptionChainItem {
  strikePrice: number
  expiryDate: string
  ceLtp: number
  ceChange: number
  ceChangePercent: number
  ceVolume: number
  ceOI: number
  ceOIChange: number
  ceIV: number
  ceDelta: number
  ceGamma: number
  ceTheta: number
  ceVega: number
  peLtp: number
  peChange: number
  peChangePercent: number
  peVolume: number
  peOI: number
  peOIChange: number
  peIV: number
  peDelta: number
  peGamma: number
  peTheta: number
  peVega: number
}

interface FnoData {
  futures: FutureContract[]
  optionChain: OptionChainItem[]
  optionChainSummary: {
    totalCallOI: number
    totalPutOI: number
    pcr: number
    maxPain: number
    ivPercentile: number
    nearestExpiry: string
    availableExpiries: string[]
  }
  isRealData: boolean
  dataSource: 'upstox' | 'dhan' | 'database'
}

type RangeOption = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y'
type OverviewTab = 'overview' | 'fno' | 'technicals' | 'news'

function formatDate(dateStr: string, range: RangeOption): string {
  const d = new Date(dateStr)
  if (range === '1D') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1W') return d.toLocaleDateString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1M' || range === '3M') return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function formatExpiry(dateStr: string): string {
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getDataSourceBadge(dataSource: 'upstox' | 'dhan' | 'yahoo' | 'database') {
  switch (dataSource) {
    case 'upstox':
      return <Badge className="text-[9px] font-bold bg-[#00B386]/10 text-[#00B386] border-[#00B386]/20 border px-1.5 py-0">LIVE</Badge>
    case 'dhan':
      return <Badge className="text-[9px] font-bold bg-[#00B386]/10 text-[#00B386] border-[#00B386]/20 border px-1.5 py-0">LIVE</Badge>
    case 'yahoo':
      return <Badge className="text-[9px] font-bold bg-amber-500/10 text-amber-600 border-amber-500/20 border px-1.5 py-0">DELAYED</Badge>
    case 'database':
      return <Badge className="text-[9px] font-bold bg-gray-500/10 text-gray-500 border-gray-500/20 border px-1.5 py-0">DB</Badge>
  }
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, range }: { active?: boolean; payload?: Array<{ payload: CandleData }>; range: RangeOption }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  const isUp = d.close >= d.open

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg p-3 shadow-xl text-xs">
      <div className="font-semibold text-[#1a1a1a] mb-1.5">{formatDate(d.date, range)}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-[#6b7280]">Open</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.open)}</span>
        <span className="text-[#6b7280]">High</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.high)}</span>
        <span className="text-[#6b7280]">Low</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.low)}</span>
        <span className="text-[#6b7280]">Close</span>
        <span className={`font-mono font-tabular text-right font-semibold ${isUp ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
          {formatPrice(d.close)}
        </span>
        {d.volume > 0 && (
          <>
            <span className="text-[#6b7280]">Volume</span>
            <span className="font-mono font-tabular text-right">{formatVolume(d.volume)}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Range Bar Component (Groww-style) ────────────────────────────────────

function RangeBar({ label, low, high, current, lowLabel, highLabel }: {
  label: string
  low: number
  high: number
  current: number
  lowLabel?: string
  highLabel?: string
}) {
  const range = high - low
  const position = range > 0 ? Math.min(100, Math.max(0, ((current - low) / range) * 100)) : 50

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#6b7280]">{lowLabel || label + ' Low'}</span>
        <span className="text-xs text-[#6b7280]">{highLabel || label + ' High'}</span>
      </div>
      <div className="flex items-center justify-between text-sm font-mono font-tabular font-semibold">
        <span className="text-[#EB5B3C]">{formatPrice(low)}</span>
        <span className="text-[#00B386]">{formatPrice(high)}</span>
      </div>
      <div className="h-2 rounded-full bg-[#f0f2f5] relative overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{
            width: '100%',
            background: 'linear-gradient(to right, #eb5b3c, #00d09c)',
            opacity: 0.25,
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 size-3 bg-[#00d09c] border-2 border-white rounded-full shadow-sm z-10"
          style={{ left: `calc(${position}% - 6px)` }}
        />
      </div>
    </div>
  )
}

// ─── Metric Row Component ─────────────────────────────────────────────────

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#f0f2f5] last:border-b-0">
      <span className="text-sm text-[#6b7280]">{label}</span>
      <span className={`text-sm font-semibold font-mono font-tabular ${
        highlight === 'green' ? 'text-[#00B386]' : highlight === 'red' ? 'text-[#EB5B3C]' : 'text-[#1a1a1a]'
      }`}>{value}</span>
    </div>
  )
}

// ─── Collapsible Section ──────────────────────────────────────────────────

function CollapsibleSection({ title, children, defaultOpen = false }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#f8f9fb] transition-colors"
      >
        <span className="text-sm font-semibold text-[#1a1a1a]">{title}</span>
        {open ? (
          <ChevronUp className="size-4 text-[#6b7280]" />
        ) : (
          <ChevronDown className="size-4 text-[#6b7280]" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export function StockOverviewPage() {
  const { token, user } = useAuthStore()
  const { selectedStockSymbol, setCurrentPage, navigateToStock } = useAppStore()
  const { showTradeSuccess } = useTradeSuccess()

  // WebSocket real-time quote for this stock
  const { quote: wsQuote, status: wsStatus } = useStockQuote(selectedStockSymbol || '')

  // State
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null)
  const [similarStocks, setSimilarStocks] = useState<SimilarStock[]>([])
  const [chartData, setChartData] = useState<CandleData[]>([])
  const [range, setRange] = useState<RangeOption>('1M')
  const [overviewTab, setOverviewTab] = useState<OverviewTab>('overview')
  const [detailLoading, setDetailLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)

  // F&O state
  const [fnoData, setFnoData] = useState<FnoData | null>(null)
  const [fnoLoading, setFnoLoading] = useState(false)
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const optionChainRef = useRef<HTMLDivElement>(null)

  // Watchlist state - use shared store for instant sync
  const { isInWatchlist: isInWatchlistStore, addSymbol, removeSymbol, setSymbols: setWatchlistSymbols, loaded: watchlistLoaded } = useWatchlistStore()
  const isInWatchlist = isInWatchlistStore(selectedStockSymbol || '')
  const [watchlistLoading, setWatchlistLoading] = useState(false)

  // Trade modal state
  const [showTradePanel, setShowTradePanel] = useState(false)
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState('MARKET')
  const [productType, setProductType] = useState('INTRADAY')
  const [quantity, setQuantity] = useState(10)
  const [price, setPrice] = useState('')
  const [placingOrder, setPlacingOrder] = useState(false)
  const [tradeSegment, setTradeSegment] = useState<'EQUITY' | 'FUTURES' | 'OPTIONS'>('EQUITY')
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmData, setConfirmData] = useState<TradeConfirmData | null>(null)

  // ─── Load watchlist into shared store ──────────────────────────
  useEffect(() => {
    if (!token || watchlistLoaded) return
    fetch('/api/trade/watchlist', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setWatchlistSymbols(data.data.map((item: { symbol: string }) => item.symbol))
        }
      })
      .catch(() => { /* silent */ })
  }, [token, watchlistLoaded, setWatchlistSymbols])

  // ─── Toggle watchlist ───────────────────────────────────────────
  const toggleWatchlist = async () => {
    if (!token || !stockDetail) return
    setWatchlistLoading(true)
    try {
      if (isInWatchlist) {
        const res = await fetch('/api/trade/watchlist', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbol: stockDetail.symbol }),
        })
        const data = await res.json()
        if (data.success) {
          removeSymbol(stockDetail.symbol)
          toast.success(data.message || 'Removed from watchlist')
        } else {
          toast.error(data.error || 'Failed to remove')
        }
      } else {
        const res = await fetch('/api/trade/watchlist', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbol: stockDetail.symbol }),
        })
        const data = await res.json()
        if (data.success) {
          addSymbol(stockDetail.symbol)
          toast.success(data.message || 'Added to watchlist')
        } else {
          toast.error(data.error || 'Failed to add')
        }
      }
    } catch {
      toast.error('Network error')
    } finally {
      setWatchlistLoading(false)
    }
  }

  // ─── Fetch stock detail ─────────────────────────────────────────
  const fetchDetail = useCallback(async (isBackgroundRefresh = false) => {
    if (!selectedStockSymbol) return
    if (!isBackgroundRefresh) setDetailLoading(true)
    try {
      const res = await fetch(`/api/stocks/detail/${selectedStockSymbol}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          setStockDetail(json.data)
          setSimilarStocks(json.similarStocks || [])
        }
      }
    } catch {
      // Keep previous data
    } finally {
      if (!isBackgroundRefresh) setDetailLoading(false)
    }
  }, [selectedStockSymbol])

  // ─── Fetch chart data ───────────────────────────────────────────
  const fetchChart = useCallback(async () => {
    if (!selectedStockSymbol) return
    setChartLoading(true)
    try {
      const basePrice = stockDetail?.currentPrice || 1500
      const res = await fetch(`/api/stocks/chart/${selectedStockSymbol}?range=${range}&basePrice=${basePrice}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success) setChartData(json.data || [])
      }
    } catch {
      // Keep previous data
    } finally {
      setChartLoading(false)
    }
  }, [selectedStockSymbol, range, stockDetail?.currentPrice])

  // ─── Fetch F&O data ─────────────────────────────────────────────
  const fetchFnoData = useCallback(async () => {
    if (!selectedStockSymbol) return
    setFnoLoading(true)
    try {
      const res = await fetch(`/api/stocks/fno/${selectedStockSymbol}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) {
          setFnoData(json.data)
          if (json.data.optionChainSummary?.nearestExpiry && !selectedExpiry) {
            setSelectedExpiry(json.data.optionChainSummary.nearestExpiry)
          }
        }
      }
    } catch {
      // Keep previous data
    } finally {
      setFnoLoading(false)
    }
  }, [selectedStockSymbol, selectedExpiry])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  useEffect(() => {
    fetchChart()
  }, [fetchChart])

  // WebSocket: Merge real-time stock price updates
  // This replaces the 2s polling - WebSocket pushes data every 500ms
  useEffect(() => {
    if (!wsQuote || wsQuote.last_price <= 0 || !stockDetail) return

    const previousClose = wsQuote.ohlc.close - wsQuote.net_change
    const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : stockDetail.changePercent

    setStockDetail(prev => {
      if (!prev) return prev
      return {
        ...prev,
        currentPrice: wsQuote.last_price,
        change: wsQuote.net_change,
        changePercent,
        open: wsQuote.ohlc.open || prev.open,
        high: wsQuote.ohlc.high || prev.high,
        low: wsQuote.ohlc.low || prev.low,
        close: wsQuote.ohlc.close || prev.close,
        previousClose,
        volume: wsQuote.volume || prev.volume,
      }
    })
  }, [wsQuote])

  // Fallback: REST polling only when WebSocket is disconnected
  useEffect(() => {
    if (wsStatus === 'connected') return // No need for REST polling when WS is active
    const interval = setInterval(() => fetchDetail(true), 1000) // 1s for near-real-time updates
    return () => clearInterval(interval)
  }, [fetchDetail, wsStatus])

  // Fetch F&O data when F&O tab is active or when stock has F&O
  useEffect(() => {
    if (stockDetail && (stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable)) {
      fetchFnoData()
    }
  }, [stockDetail?.isFuturesAvailable, stockDetail?.isOptionsAvailable, fetchFnoData])

  // Auto-refresh F&O data every 5s when F&O tab is active
  useEffect(() => {
    if (overviewTab !== 'fno') return
    const interval = setInterval(fetchFnoData, 5000)
    return () => clearInterval(interval)
  }, [overviewTab, fetchFnoData])

  // Set price when stock changes
  useEffect(() => {
    if (stockDetail) {
      setPrice(stockDetail.currentPrice.toFixed(2))
    }
  }, [stockDetail?.currentPrice])

  // ─── Derived values ─────────────────────────────────────────────
  const isPositive = stockDetail ? stockDetail.change >= 0 : true
  const gradientId = `stock-gradient-${selectedStockSymbol}`

  const chartDataFormatted = useMemo(() => {
    return chartData.map((d) => ({
      ...d,
      dateLabel: formatDate(d.date, range),
    }))
  }, [chartData, range])

  const chartMinMax = useMemo(() => {
    if (chartDataFormatted.length === 0) return { min: 0, max: 0 }
    const prices = chartDataFormatted.flatMap((d) => [d.high, d.low])
    return {
      min: Math.min(...prices) * 0.999,
      max: Math.max(...prices) * 1.001,
    }
  }, [chartDataFormatted])

  // ─── Option chain quick view ────────────────────────────────────
  const atmStrike = useMemo(() => {
    if (!stockDetail || !fnoData?.optionChain?.length) return 0
    const strikes = fnoData.optionChain.map(o => o.strikePrice)
    return strikes.reduce((prev, curr) =>
      Math.abs(curr - stockDetail.currentPrice) < Math.abs(prev - stockDetail.currentPrice) ? curr : prev
    )
  }, [stockDetail?.currentPrice, fnoData?.optionChain])

  const filteredOptionChain = useMemo(() => {
    if (!fnoData?.optionChain?.length || !atmStrike) return []
    const chain = selectedExpiry
      ? fnoData.optionChain.filter(o => o.expiryDate === selectedExpiry)
      : fnoData.optionChain
    if (!chain.length) return fnoData.optionChain
    const sorted = [...chain].sort((a, b) => a.strikePrice - b.strikePrice)
    const atmIndex = sorted.findIndex(o => o.strikePrice === atmStrike)
    if (atmIndex === -1) return sorted.slice(0, 11)
    const start = Math.max(0, atmIndex - 5)
    const end = Math.min(sorted.length, atmIndex + 6)
    return sorted.slice(start, end)
  }, [fnoData?.optionChain, atmStrike, selectedExpiry])

  // ─── Order calculations ─────────────────────────────────────────
  const estimatedTotal = useMemo(() => {
    const p = orderType === 'MARKET'
      ? (stockDetail?.currentPrice ?? 0)
      : (parseFloat(price) || 0)
    return quantity * p
  }, [quantity, price, orderType, stockDetail?.currentPrice])

  const estimatedBrokerage = useMemo(() => {
    return calculateBrokerage(estimatedTotal)
  }, [estimatedTotal])

  const availableBalance = user?.virtualBalance ?? 0
  const buyingPower = availableBalance * 5 // 5x margin

  // ─── Handle place order ─────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (!token || !stockDetail) return

    if (orderType === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      toast.error('Please enter a valid price for LIMIT orders')
      return
    }

    if (quantity <= 0) {
      toast.error('Quantity must be at least 1')
      return
    }

    // Open confirmation modal
    const direction = orderSide === 'buy' ? 'BUY' : 'SELL'
    const fillPrice = orderType === 'MARKET' ? stockDetail.currentPrice : parseFloat(price)
    setConfirmData({
      symbol: stockDetail.symbol,
      direction: direction as 'BUY' | 'SELL',
      segment: tradeSegment,
      productType,
      orderType,
      quantity,
      price: fillPrice,
      totalValue: estimatedTotal,
      brokerage: estimatedBrokerage,
      availableBalance,
    })
    setConfirmModalOpen(true)
  }

  const executeTrade = async (): Promise<{ success: boolean; message?: string; error?: string; orderId?: string; balance?: number; totalValue?: number; brokerage?: number }> => {
    if (!token || !stockDetail) return { success: false, error: 'No stock selected' }

    const direction = orderSide === 'buy' ? 'BUY' : 'SELL'
    const body: Record<string, unknown> = {
      symbol: stockDetail.symbol,
      direction,
      orderType,
      segment: tradeSegment,
      productType,
      quantity,
    }

    if (orderType === 'LIMIT' && price) {
      body.price = parseFloat(price)
    }

    if (tradeSegment === 'FUTURES') {
      body.lotSize = stockDetail.lotSize
      body.lots = Math.max(1, Math.round(quantity / stockDetail.lotSize))
      // Pass nearest expiry from F&O data if available
      if (fnoData?.optionChainSummary?.nearestExpiry) {
        body.expiryDate = fnoData.optionChainSummary.nearestExpiry
      }
    }

    if (tradeSegment === 'OPTIONS') {
      body.lotSize = stockDetail.lotSize
      body.lots = Math.max(1, Math.round(quantity / stockDetail.lotSize))
      // Options require optionType and strikePrice — use ATM strike + CE as defaults
      if (atmStrike > 0) {
        body.strikePrice = atmStrike
        body.optionType = orderSide === 'buy' ? 'CE' : 'PE'
      }
      if (fnoData?.optionChainSummary?.nearestExpiry) {
        body.expiryDate = fnoData.optionChainSummary.nearestExpiry
      }
    }

    try {
      const res = await fetch('/api/trade/place', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        const fillPrice = orderType === 'MARKET' ? stockDetail.currentPrice : parseFloat(price)
        showTradeSuccess({
          symbol: stockDetail.symbol,
          type: direction as 'BUY' | 'SELL',
          qty: quantity,
          price: fillPrice,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
          orderId: data.order?.id?.slice(-8).toUpperCase() || 'N/A',
          segment: tradeSegment,
          totalValue: data.order?.totalValue,
          brokerage: data.order?.brokerage,
        })
        setShowTradePanel(false)
        return {
          success: true,
          orderId: data.order?.id?.slice(-8).toUpperCase() || 'N/A',
          balance: data.balance,
          totalValue: data.order?.totalValue,
          brokerage: data.order?.brokerage,
        }
      } else {
        return { success: false, error: data.error || 'Failed to place order' }
      }
    } catch {
      return { success: false, error: 'Network error placing order' }
    }
  }

  // ─── After trade confirm success callback ────────────────────────
  const handleTradeConfirmSuccess = useCallback(() => {
    // Redirect to positions page immediately
    setCurrentPage('positions')
  }, [setCurrentPage])


  // ─── Loading state ──────────────────────────────────────────────
  if (detailLoading && !stockDetail) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-10 w-32 bg-[#f0f0f5]" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48 bg-[#f0f0f5]" />
            <Skeleton className="h-6 w-36 bg-[#f0f0f5]" />
          </div>
          <Skeleton className="h-[300px] w-full bg-[#f0f0f5] rounded-xl" />
          <Skeleton className="h-40 w-full bg-[#f0f0f5] rounded-xl" />
          <Skeleton className="h-60 w-full bg-[#f0f0f5] rounded-xl" />
        </div>
      </div>
    )
  }

  if (!stockDetail) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-20">
          <p className="text-[#1a1a1a] font-semibold">Stock not found</p>
          <Button
            className="mt-4 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg"
            onClick={() => setCurrentPage('trading')}
          >
            Back to Stocks
          </Button>
        </div>
      </div>
    )
  }

  // Determine visible tabs
  const showFnoTab = stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable
  const tabs: OverviewTab[] = ['overview', ...(showFnoTab ? ['fno' as OverviewTab] : []), 'technicals', 'news']

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      {/* ═══ Sticky Header ═════════════════════════════════════════════ */}
      <div className="sticky top-14 z-30 bg-white border-b border-[#e5e7eb]">
        <div className="px-4 sm:px-6 lg:px-8 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setCurrentPage('trading')}
                className="size-8 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-[#f5f7fa] text-[#6b7280] hover:text-[#1a1a1a] transition-colors"
              >
                <ArrowLeft className="size-5" />
              </button>
              <StockLogo symbol={stockDetail.symbol} name={stockDetail.name} sector={stockDetail.sector} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-[#1a1a1a] truncate">{stockDetail.name}</h1>
                  <span className="text-[10px] font-bold bg-[#f5f7fa] text-[#6b7280] px-2 py-0.5 rounded-md flex-shrink-0">
                    {stockDetail.exchange}
                  </span>
                  {getDataSourceBadge(stockDetail.dataSource)}
                  {wsStatus === 'connected' && (
                    <span className="flex items-center gap-1 text-[9px] font-bold bg-[#00D09C]/10 text-[#00D09C] px-1.5 py-0.5 rounded-full">
                      <Zap className="size-2.5" />
                      LIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-2xl font-bold font-mono font-tabular text-[#1a1a1a]">
                    {formatPrice(stockDetail.currentPrice)}
                  </span>
                  <span className={`flex items-center gap-0.5 text-sm font-semibold ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {stockDetail.change >= 0 ? '+' : ''}{formatPrice(stockDetail.change)} ({formatPercent(stockDetail.changePercent)})
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Watchlist Toggle */}
              <Button
                variant="outline"
                size="sm"
                className={`gap-1.5 rounded-lg font-semibold ${
                  isInWatchlist
                    ? 'border-[#00D09C]/30 text-[#00D09C] bg-[#00D09C]/5 hover:bg-[#00D09C]/10'
                    : 'border-[#e5e7eb] text-[#6b7280] hover:text-[#00D09C] hover:border-[#00D09C]/30'
                }`}
                onClick={toggleWatchlist}
                disabled={watchlistLoading}
              >
                <Star className={`size-4 ${isInWatchlist ? 'fill-[#00D09C]' : ''}`} />
              </Button>
              {(stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable) && (
                <Badge variant="outline" className="text-[10px] font-bold border-[#00D09C]/30 text-[#00D09C]">
                  F&O
                </Badge>
              )}
              {stockDetail.isFnoBan && (
                <Badge variant="outline" className="text-[10px] font-bold border-[#eb5b3c]/30 text-[#EB5B3C]">
                  F&O BAN
                </Badge>
              )}
              <Button
                className="bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg gap-1.5"
                size="sm"
                onClick={() => { setOrderSide('buy'); setTradeSegment('EQUITY'); setShowTradePanel(true) }}
              >
                <ShoppingCart className="size-4" />
                <span className="hidden sm:inline">Buy</span>
              </Button>
              <Button
                className="bg-[#EB5B3C] hover:bg-[#d44f33] text-white font-semibold rounded-lg gap-1.5"
                size="sm"
                onClick={() => { setOrderSide('sell'); setTradeSegment('EQUITY'); setShowTradePanel(true) }}
              >
                <span className="hidden sm:inline">Sell</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setOverviewTab(tab)}
                className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-all whitespace-nowrap ${
                  overviewTab === tab
                    ? 'text-[#00D09C] border-[#00D09C]'
                    : 'text-[#6b7280] border-transparent hover:text-[#1a1a1a]'
                }`}
              >
                {tab === 'fno' ? 'F&O' : tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Main Content ═════════════════════════════════════════════ */}
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* ═══════════════════════════════════════════════════════════════
              OVERVIEW TAB
          ═══════════════════════════════════════════════════════════════ */}
          {overviewTab === 'overview' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              {/* ─── Chart Card ──────────────────────────────────────── */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  {/* Range Selector */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-1 overflow-x-auto pb-1">
                      <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider mr-2 flex-shrink-0">NSE</span>
                      {(['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'] as RangeOption[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRange(r)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0 ${
                            range === r
                              ? 'bg-[#00D09C] text-white shadow-sm'
                              : 'text-[#6b7280] hover:bg-[#f5f7fa] hover:text-[#1a1a1a]'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="rounded-xl overflow-hidden">
                    {chartLoading ? (
                      <div className="h-[280px] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex gap-1.5">
                            <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="text-xs text-[#6b7280]">Loading chart...</span>
                        </div>
                      </div>
                    ) : chartDataFormatted.length > 0 ? (
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartDataFormatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isPositive ? '#00d09c' : '#eb5b3c'} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={isPositive ? '#00d09c' : '#eb5b3c'} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" />
                            <XAxis
                              dataKey="dateLabel"
                              tick={{ fontSize: 10, fill: '#6b7280' }}
                              axisLine={{ stroke: 'rgba(128,128,128,0.2)' }}
                              tickLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              domain={[chartMinMax.min, chartMinMax.max]}
                              tick={{ fontSize: 10, fill: '#6b7280' }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v: number) => formatINRWhole(v)}
                              width={60}
                            />
                            <Tooltip content={<CustomTooltip range={range} />} />
                            <Area
                              type="monotone"
                              dataKey="close"
                              stroke={isPositive ? '#00d09c' : '#eb5b3c'}
                              strokeWidth={2}
                              fill={`url(#${gradientId})`}
                              dot={false}
                              activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[280px] flex items-center justify-center text-[#6b7280] text-sm">
                        No chart data available
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ─── Performance Section ──────────────────────────────── */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5 space-y-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#1a1a1a]">Performance</h3>
                    <Info className="size-3.5 text-[#6b7280]" />
                  </div>

                  {/* Today's Range */}
                  {stockDetail.low > 0 && stockDetail.high > 0 && (
                    <RangeBar
                      label="Today's"
                      low={stockDetail.low}
                      high={stockDetail.high}
                      current={stockDetail.currentPrice}
                      lowLabel="Today's Low"
                      highLabel="Today's High"
                    />
                  )}

                  {/* 52 Week Range */}
                  {stockDetail.week52Low > 0 && stockDetail.week52High > 0 && (
                    <RangeBar
                      label="52 Week"
                      low={stockDetail.week52Low}
                      high={stockDetail.week52High}
                      current={stockDetail.currentPrice}
                      lowLabel="52 Week Low"
                      highLabel="52 Week High"
                    />
                  )}

                  {/* Key Metrics Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 pt-2">
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Open</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.open > 0 ? formatPrice(stockDetail.open) : '--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Prev Close</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.previousClose > 0 ? formatPrice(stockDetail.previousClose) : '--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Volume</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.volume > 0 ? formatVolume(stockDetail.volume) : '--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">VWAP</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.vwap ? formatPrice(stockDetail.vwap) : '--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Avg Price</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.averageTradePrice > 0 ? formatPrice(stockDetail.averageTradePrice) : '--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Traded Value</p>
                      <p className="text-sm font-bold font-mono font-tabular text-[#1a1a1a] mt-1">
                        {stockDetail.totalTradedValue > 0 ? formatLargeNumber(stockDetail.totalTradedValue) : '--'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ─── Circuit Limits Card ─────────────────────────────── */}
              {(stockDetail.upperCircuit > 0 || stockDetail.lowerCircuit > 0) && (
                <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                  <CardContent className="p-5">
                    <h3 className="text-base font-semibold text-[#1a1a1a] mb-4">Circuit Limits</h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">Upper Circuit</p>
                        <div className="flex items-center gap-2">
                          <div className="size-3 rounded-full bg-[#00d09c]" />
                          <span className="text-lg font-bold font-mono font-tabular text-[#00B386]">
                            {formatPrice(stockDetail.upperCircuit)}
                          </span>
                        </div>
                        {stockDetail.currentPrice > 0 && (
                          <p className="text-xs text-[#6b7280]">
                            {formatPercent((stockDetail.upperCircuit - stockDetail.currentPrice) / stockDetail.currentPrice * 100)} away
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">Lower Circuit</p>
                        <div className="flex items-center gap-2">
                          <div className="size-3 rounded-full bg-[#eb5b3c]" />
                          <span className="text-lg font-bold font-mono font-tabular text-[#EB5B3C]">
                            {formatPrice(stockDetail.lowerCircuit)}
                          </span>
                        </div>
                        {stockDetail.currentPrice > 0 && (
                          <p className="text-xs text-[#6b7280]">
                            {formatPercent((stockDetail.currentPrice - stockDetail.lowerCircuit) / stockDetail.currentPrice * 100)} away
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Visual bar */}
                    <div className="mt-4 relative">
                      {stockDetail.upperCircuit > stockDetail.lowerCircuit && (
                        <>
                          <div className="h-3 rounded-full bg-gradient-to-r from-[#eb5b3c]/20 via-[#f0f2f5] to-[#00d09c]/20" />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 size-3.5 bg-[#1a1a1a] border-2 border-white rounded-full shadow-sm z-10"
                            style={{
                              left: `${((stockDetail.currentPrice - stockDetail.lowerCircuit) / (stockDetail.upperCircuit - stockDetail.lowerCircuit)) * 100}%`,
                              transform: 'translate(-50%, -50%)'
                            }}
                          />
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ─── Fundamentals Section ─────────────────────────────── */}
              <CollapsibleSection title="Fundamentals" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-x-6">
                  <MetricRow label="Mkt Cap" value={formatLargeNumber(stockDetail.marketCap)} />
                  <MetricRow label="ROE" value={stockDetail.roe ? `${stockDetail.roe.toFixed(2)}%` : '--'} highlight={stockDetail.roe > 15 ? 'green' : stockDetail.roe < 10 ? 'red' : undefined} />
                  <MetricRow label="P/E Ratio (TTM)" value={stockDetail.peRatio ? stockDetail.peRatio.toFixed(2) : '--'} />
                  <MetricRow label="EPS (TTM)" value={stockDetail.eps ? formatPrice(stockDetail.eps) : '--'} />
                  <MetricRow label="P/B Ratio" value={stockDetail.pbRatio ? stockDetail.pbRatio.toFixed(2) : '--'} />
                  <MetricRow label="Div Yield" value={stockDetail.dividendYield ? `${(stockDetail.dividendYield * 100).toFixed(2)}%` : '--'} highlight={stockDetail.dividendYield > 0 ? 'green' : undefined} />
                  <MetricRow label="Industry P/E" value={stockDetail.industryPE ? stockDetail.industryPE.toFixed(2) : '--'} />
                  <MetricRow label="Book Value" value={stockDetail.bookValue ? formatPrice(stockDetail.bookValue) : '--'} />
                  <MetricRow label="Debt to Equity" value={stockDetail.debtToEquity ? stockDetail.debtToEquity.toFixed(2) : '--'} highlight={stockDetail.debtToEquity > 1 ? 'red' : stockDetail.debtToEquity > 0 ? 'green' : undefined} />
                  <MetricRow label="Face Value" value={stockDetail.faceValue ? formatINRWhole(stockDetail.faceValue) : '--'} />
                </div>
                <p className="text-xs text-[#6b7280] mt-3 flex items-center gap-1">
                  <Info className="size-3" />
                  Understand Fundamentals
                </p>
              </CollapsibleSection>

              {/* ─── About Section ─────────────────────────────────────── */}
              <CollapsibleSection title={`About ${stockDetail.name}`}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">Sector</span>
                    <span className="text-sm font-semibold text-[#1a1a1a]">{stockDetail.sector || '--'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">Industry</span>
                    <span className="text-sm font-semibold text-[#1a1a1a]">{stockDetail.industry || '--'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">Exchange</span>
                    <span className="text-sm font-semibold text-[#1a1a1a]">{stockDetail.exchange}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">ISIN</span>
                    <span className="text-sm font-mono font-tabular font-semibold text-[#1a1a1a]">{stockDetail.isin || '--'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">Lot Size</span>
                    <span className="text-sm font-semibold text-[#1a1a1a]">{stockDetail.lotSize}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                    <span className="text-sm text-[#6b7280]">F&O Available</span>
                    <span className={`text-sm font-semibold ${stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable ? 'text-[#00B386]' : 'text-[#1a1a1a]'}`}>
                      {stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {stockDetail.strikeInterval && (
                    <div className="flex items-center justify-between py-2 border-b border-[#f0f2f5]">
                      <span className="text-sm text-[#6b7280]">Strike Interval</span>
                      <span className="text-sm font-semibold text-[#1a1a1a]">₹{stockDetail.strikeInterval}</span>
                    </div>
                  )}
                </div>
              </CollapsibleSection>

              {/* ─── Similar Stocks (Horizontal Scroll) ────────────────── */}
              {similarStocks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-[#1a1a1a]">Similar Stocks</h3>
                    <span className="text-xs text-[#6b7280] flex items-center gap-1">
                      <BarChart3 className="size-3" />
                      Market Price
                    </span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                    {similarStocks.map((stock) => {
                      const stockPositive = stock.changePercent >= 0
                      return (
                        <button
                          key={stock.symbol}
                          onClick={() => navigateToStock(stock.symbol)}
                          className="flex-shrink-0 w-[160px] bg-white border border-[#e5e7eb] rounded-xl p-3 hover:border-[#00d09c]/40 hover:shadow-sm transition-all text-left"
                        >
                          <p className="text-sm font-semibold text-[#1a1a1a] truncate">{stock.name}</p>
                          <p className="text-xs text-[#6b7280]">{stock.symbol}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-sm font-bold font-mono font-tabular text-[#1a1a1a]">
                              {formatPrice(stock.currentPrice)}
                            </span>
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                              stockPositive ? 'bg-[#00B386]/10 text-[#00B386]' : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                            }`}>
                              {formatPercent(stock.changePercent)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ─── Bottom Buy/Sell Bar (Mobile) ────────────────────────── */}
              <div className="lg:hidden sticky bottom-16 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white border-t border-[#e5e7eb]">
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-12 bg-[#00D09C] hover:bg-[#00b88a] text-white font-bold rounded-xl text-base gap-2"
                    onClick={() => { setOrderSide('buy'); setTradeSegment('EQUITY'); setShowTradePanel(true) }}
                  >
                    <ShoppingCart className="size-5" />
                    Buy {stockDetail.symbol}
                  </Button>
                  <Button
                    className="flex-1 h-12 bg-[#EB5B3C] hover:bg-[#d44f33] text-white font-bold rounded-xl text-base gap-2"
                    onClick={() => { setOrderSide('sell'); setTradeSegment('EQUITY'); setShowTradePanel(true) }}
                  >
                    Sell {stockDetail.symbol}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              F&O TAB
          ═══════════════════════════════════════════════════════════════ */}
          {overviewTab === 'fno' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              {/* Data Source Banner */}
              {fnoData && !fnoData.isRealData && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <Zap className="size-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Connect Upstox or Dhan API for live F&O data</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      Current F&O data is from database/mock source. Connect your Upstox or Dhan API key for real-time data.
                    </p>
                  </div>
                  {fnoData && getDataSourceBadge(fnoData.dataSource)}
                </div>
              )}
              {fnoData && fnoData.isRealData && (
                <div className="bg-[#00B386]/5 border border-[#00B386]/20 rounded-xl p-4 flex items-start gap-3">
                  <Zap className="size-5 text-[#00B386] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-[#00B386]">Live F&O Data Active</p>
                    <p className="text-xs text-[#00B386]/70 mt-0.5">
                      Real-time option chain data from {fnoData.dataSource === 'upstox' ? 'Upstox' : 'Dhan'} API.
                    </p>
                  </div>
                  {getDataSourceBadge(fnoData.dataSource)}
                </div>
              )}

              {/* ─── F&O Summary Card ────────────────────────────────── */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#1a1a1a] flex items-center gap-2">
                      <Layers className="size-4 text-[#00D09C]" />
                      F&O Summary
                    </h3>
                    <button
                      onClick={fetchFnoData}
                      className="size-8 flex items-center justify-center rounded-lg hover:bg-[#f5f7fa] text-[#6b7280] hover:text-[#1a1a1a] transition-colors"
                    >
                      <RefreshCw className={`size-4 ${fnoLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {fnoLoading && !fnoData ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-6 animate-spin text-[#00D09C]" />
                    </div>
                  ) : fnoData ? (
                    <>
                      {/* Summary Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {/* PCR */}
                        <div className="bg-[#f8f9fb] rounded-xl p-4 text-center">
                          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">PCR</p>
                          <p className={`text-2xl font-bold font-mono font-tabular ${
                            fnoData.optionChainSummary.pcr > 1 ? 'text-[#00B386]' :
                            fnoData.optionChainSummary.pcr < 0.7 ? 'text-[#EB5B3C]' :
                            'text-[#1a1a1a]'
                          }`}>
                            {fnoData.optionChainSummary.pcr > 0 ? fnoData.optionChainSummary.pcr.toFixed(2) : '--'}
                          </p>
                          <p className="text-[10px] text-[#6b7280] mt-0.5">
                            {fnoData.optionChainSummary.pcr > 1 ? 'Bullish' :
                             fnoData.optionChainSummary.pcr < 0.7 ? 'Bearish' : 'Neutral'}
                          </p>
                        </div>

                        {/* Max Pain */}
                        <div className="bg-[#f8f9fb] rounded-xl p-4 text-center">
                          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Max Pain</p>
                          <p className="text-2xl font-bold font-mono font-tabular text-[#1a1a1a]">
                            {fnoData.optionChainSummary.maxPain > 0 ? formatINRWhole(fnoData.optionChainSummary.maxPain) : '--'}
                          </p>
                          <div className="flex items-center justify-center gap-1 mt-0.5">
                            <Target className="size-3 text-[#6b7280]" />
                            <p className="text-[10px] text-[#6b7280]">
                              {stockDetail.currentPrice > 0 && fnoData.optionChainSummary.maxPain > 0
                                ? `${Math.abs(((stockDetail.currentPrice - fnoData.optionChainSummary.maxPain) / fnoData.optionChainSummary.maxPain) * 100).toFixed(1)}% ${stockDetail.currentPrice > fnoData.optionChainSummary.maxPain ? 'above' : 'below'}`
                                : 'Strike level'
                              }
                            </p>
                          </div>
                        </div>

                        {/* IV Percentile */}
                        <div className="bg-[#f8f9fb] rounded-xl p-4 text-center">
                          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">IV Percentile</p>
                          <p className="text-2xl font-bold font-mono font-tabular text-[#1a1a1a]">
                            {fnoData.optionChainSummary.ivPercentile > 0 ? `${fnoData.optionChainSummary.ivPercentile.toFixed(0)}%` : '--'}
                          </p>
                          <div className="flex items-center justify-center gap-1 mt-0.5">
                            <Gauge className="size-3 text-[#6b7280]" />
                            <p className="text-[10px] text-[#6b7280]">
                              {fnoData.optionChainSummary.ivPercentile > 70 ? 'High Vol' :
                               fnoData.optionChainSummary.ivPercentile > 30 ? 'Normal' :
                               fnoData.optionChainSummary.ivPercentile > 0 ? 'Low Vol' : 'Implied Vol'}
                            </p>
                          </div>
                        </div>

                        {/* Nearest Expiry */}
                        <div className="bg-[#f8f9fb] rounded-xl p-4 text-center">
                          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Nearest Expiry</p>
                          <p className="text-lg font-bold font-mono font-tabular text-[#1a1a1a]">
                            {fnoData.optionChainSummary.nearestExpiry
                              ? formatExpiry(fnoData.optionChainSummary.nearestExpiry)
                              : '--'}
                          </p>
                          {fnoData.optionChainSummary.availableExpiries.length > 1 && (
                            <select
                              value={selectedExpiry}
                              onChange={(e) => setSelectedExpiry(e.target.value)}
                              className="mt-1 text-[10px] bg-white border border-[#e5e7eb] rounded-md px-2 py-0.5 text-[#6b7280] font-medium"
                            >
                              {fnoData.optionChainSummary.availableExpiries.map((exp) => (
                                <option key={exp} value={exp}>{formatExpiry(exp)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {/* OI Summary Bar */}
                      <div className="mt-4 flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="size-2.5 rounded-sm bg-[#00d09c]" />
                          <span className="text-[#6b7280]">Total Call OI:</span>
                          <span className="font-mono font-tabular font-semibold text-[#1a1a1a]">
                            {fnoData.optionChainSummary.totalCallOI > 0 ? formatVolume(fnoData.optionChainSummary.totalCallOI) : '--'}
                          </span>
                        </div>
                        <div className="h-3 w-px bg-[#e5e7eb]" />
                        <div className="flex items-center gap-1.5">
                          <div className="size-2.5 rounded-sm bg-[#eb5b3c]" />
                          <span className="text-[#6b7280]">Total Put OI:</span>
                          <span className="font-mono font-tabular font-semibold text-[#1a1a1a]">
                            {fnoData.optionChainSummary.totalPutOI > 0 ? formatVolume(fnoData.optionChainSummary.totalPutOI) : '--'}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-10 text-[#6b7280] text-sm">
                      No F&O data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ─── Futures Contracts Card ──────────────────────────── */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-4 flex items-center gap-2">
                    <BarChart3 className="size-4 text-[#00D09C]" />
                    Futures Contracts
                  </h3>

                  {fnoData?.futures && fnoData.futures.length > 0 ? (
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#e5e7eb]">
                            <th className="px-2 py-2.5 text-left font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Expiry</th>
                            <th className="px-2 py-2.5 text-right font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">LTP</th>
                            <th className="px-2 py-2.5 text-right font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Change</th>
                            <th className="px-2 py-2.5 text-right font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">OI</th>
                            <th className="px-2 py-2.5 text-right font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Volume</th>
                            <th className="px-2 py-2.5 text-right font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Basis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fnoData.futures.map((fut, idx) => {
                            const isUp = fut.change >= 0
                            return (
                              <tr key={idx} className="border-b border-[#f0f2f5] last:border-b-0 hover:bg-[#f8f9fb] transition-colors">
                                <td className="px-2 py-3 text-left">
                                  <span className="font-medium text-[#1a1a1a]">{formatExpiry(fut.expiryDate)}</span>
                                  <span className="text-[10px] text-[#6b7280] ml-1.5">({fut.lotSize} lot)</span>
                                </td>
                                <td className="px-2 py-3 text-right font-mono font-tabular font-semibold text-[#1a1a1a]">
                                  {formatPrice(fut.ltp)}
                                </td>
                                <td className={`px-2 py-3 text-right font-mono font-tabular font-semibold ${isUp ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                                  {fut.change >= 0 ? '+' : ''}{formatPrice(fut.change)}
                                  <span className="ml-1 text-[10px]">({formatPercent(fut.changePercent)})</span>
                                </td>
                                <td className="px-2 py-3 text-right font-mono font-tabular text-[#6b7280]">
                                  {fut.oi > 0 ? formatVolume(fut.oi) : '--'}
                                </td>
                                <td className="px-2 py-3 text-right font-mono font-tabular text-[#6b7280]">
                                  {fut.volume > 0 ? formatVolume(fut.volume) : '--'}
                                </td>
                                <td className="px-2 py-3 text-right font-mono">
                                  <span className={fut.basis >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}>
                                    {formatPrice(fut.basis)}
                                  </span>
                                  <span className="text-[10px] text-[#6b7280] ml-1">({formatPercent(fut.basisPercent)})</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-[#6b7280] text-sm">
                      No futures contracts available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ─── Option Chain Quick View ──────────────────────────── */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#1a1a1a] flex items-center gap-2">
                      <Eye className="size-4 text-[#00D09C]" />
                      Option Chain Quick View
                    </h3>
                    <span className="text-xs text-[#6b7280]">
                      ATM: {formatINRWhole(atmStrike)}
                    </span>
                  </div>

                  {fnoLoading && !fnoData ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-6 animate-spin text-[#00D09C]" />
                    </div>
                  ) : filteredOptionChain.length > 0 ? (
                    <div className="overflow-x-auto -mx-5 px-5" ref={optionChainRef}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#e5e7eb]">
                            <th colSpan={3} className="px-2 py-2.5 text-center font-semibold text-[#00B386] uppercase tracking-wider text-[10px]">CALLS</th>
                            <th className="px-2 py-2.5 text-center font-bold text-[#1a1a1a] bg-[#f5f7fa] border-x border-[#e5e7eb] uppercase tracking-wider text-[10px]">Strike</th>
                            <th colSpan={3} className="px-2 py-2.5 text-center font-semibold text-[#EB5B3C] uppercase tracking-wider text-[10px]">PUTS</th>
                          </tr>
                          <tr className="border-b border-[#e5e7eb] text-[#6b7280]">
                            <th className="px-2 py-2 text-right font-medium text-[10px]">OI</th>
                            <th className="px-2 py-2 text-right font-medium text-[10px]">Chg</th>
                            <th className="px-2 py-2 text-right font-medium text-[10px]">LTP</th>
                            <th className="px-2 py-2 text-center font-bold bg-[#f5f7fa] border-x border-[#e5e7eb] text-[10px]">₹</th>
                            <th className="px-2 py-2 text-left font-medium text-[10px]">LTP</th>
                            <th className="px-2 py-2 text-left font-medium text-[10px]">Chg</th>
                            <th className="px-2 py-2 text-left font-medium text-[10px]">OI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOptionChain.map((opt) => {
                            const isAtm = opt.strikePrice === atmStrike
                            const ceItm = opt.strikePrice < stockDetail.currentPrice
                            const peItm = opt.strikePrice > stockDetail.currentPrice

                            return (
                              <tr
                                key={opt.strikePrice}
                                className={`border-b border-[#f0f2f5] last:border-b-0 ${
                                  isAtm ? 'bg-[#00B386]/8' : 'hover:bg-[#f8f9fb]'
                                }`}
                              >
                                {/* CE Side */}
                                <td className={`px-2 py-2 text-right font-mono font-tabular text-[#6b7280] ${ceItm ? 'bg-[#00B386]/5' : ''}`}>
                                  {opt.ceOI > 0 ? formatVolume(opt.ceOI) : '-'}
                                </td>
                                <td className={`px-2 py-2 text-right font-mono font-tabular ${opt.ceChange >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'} ${ceItm ? 'bg-[#00B386]/5' : ''}`}>
                                  {opt.ceChange !== 0 ? `${opt.ceChange >= 0 ? '+' : ''}${formatPrice(opt.ceChange)}` : '-'}
                                </td>
                                <td className={`px-2 py-2 text-right font-mono font-tabular font-semibold text-[#1a1a1a] ${ceItm ? 'bg-[#00B386]/5' : ''}`}>
                                  {opt.ceLtp > 0 ? formatPrice(opt.ceLtp) : '-'}
                                </td>

                                {/* Strike */}
                                <td className={`px-2 py-2 text-center font-mono font-tabular font-bold bg-[#f5f7fa] border-x border-[#e5e7eb] ${
                                  isAtm ? 'bg-[#00B386]/15 text-[#00B386]' : 'text-[#1a1a1a]'
                                }`}>
                                  {formatINRWhole(opt.strikePrice)}
                                </td>

                                {/* PE Side */}
                                <td className={`px-2 py-2 text-left font-mono font-tabular font-semibold text-[#1a1a1a] ${peItm ? 'bg-[#EB5B3C]/5' : ''}`}>
                                  {opt.peLtp > 0 ? formatPrice(opt.peLtp) : '-'}
                                </td>
                                <td className={`px-2 py-2 text-left font-mono font-tabular ${opt.peChange >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'} ${peItm ? 'bg-[#EB5B3C]/5' : ''}`}>
                                  {opt.peChange !== 0 ? `${opt.peChange >= 0 ? '+' : ''}${formatPrice(opt.peChange)}` : '-'}
                                </td>
                                <td className={`px-2 py-2 text-left font-mono font-tabular text-[#6b7280] ${peItm ? 'bg-[#EB5B3C]/5' : ''}`}>
                                  {opt.peOI > 0 ? formatVolume(opt.peOI) : '-'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-[#6b7280] text-sm">
                      No option chain data available
                    </div>
                  )}

                  </CardContent>
              </Card>

              {/* ─── F&O Quick Trade Button ──────────────────────────── */}
              <div className="flex gap-3">
                <Button
                  className="flex-1 h-12 bg-[#00D09C] hover:bg-[#00b88a] text-white font-bold rounded-xl text-base gap-2"
                  onClick={() => {
                    setOrderSide('buy')
                    setTradeSegment(stockDetail.isFuturesAvailable ? 'FUTURES' : 'OPTIONS')
                    setShowTradePanel(true)
                  }}
                >
                  <ShoppingCart className="size-5" />
                  Buy F&O
                </Button>
                <Button
                  className="flex-1 h-12 bg-[#eb5b3c] hover:bg-[#d44f33] text-white font-bold rounded-xl text-base gap-2"
                  onClick={() => {
                    setOrderSide('sell')
                    setTradeSegment(stockDetail.isFuturesAvailable ? 'FUTURES' : 'OPTIONS')
                    setShowTradePanel(true)
                  }}
                >
                  Sell F&O
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TECHNICALS TAB
          ═══════════════════════════════════════════════════════════════ */}
          {overviewTab === 'technicals' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              {/* Technical Indicators */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-4 flex items-center gap-2">
                    <Activity className="size-4 text-[#00D09C]" />
                    Technical Indicators
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6">
                    <MetricRow label="RSI (14)" value="--" />
                    <MetricRow label="MACD" value="--" />
                    <MetricRow label="SMA 20" value="--" />
                    <MetricRow label="SMA 50" value="--" />
                    <MetricRow label="EMA 20" value="--" />
                    <MetricRow label="EMA 50" value="--" />
                    <MetricRow label="Bollinger Upper" value="--" />
                    <MetricRow label="Bollinger Lower" value="--" />
                  </div>
                  <p className="text-xs text-[#6b7280] mt-4 flex items-center gap-1">
                    <Info className="size-3" />
                    Technical indicators will be available with real market data integration
                  </p>
                </CardContent>
              </Card>

              {/* Support & Resistance */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-4 flex items-center gap-2">
                    <Target className="size-4 text-[#00D09C]" />
                    Support & Resistance
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Resistance 3</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#EB5B3C]">--</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Resistance 2</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#EB5B3C]">--</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Resistance 1</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#EB5B3C]">--</span>
                    </div>
                    <div className="h-px bg-[#e5e7eb]" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#1a1a1a]">Current Price</span>
                      <span className={`text-sm font-mono font-tabular font-bold ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                        {formatPrice(stockDetail.currentPrice)}
                      </span>
                    </div>
                    <div className="h-px bg-[#e5e7eb]" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Support 1</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#00B386]">--</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Support 2</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#00B386]">--</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6b7280]">Support 3</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#00B386]">--</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Signal Summary */}
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-4 flex items-center gap-2">
                    <Gauge className="size-4 text-[#00D09C]" />
                    Signal Summary
                  </h3>
                  <div className="flex items-center justify-center py-6">
                    <div className="text-center">
                      <div className="size-20 rounded-full border-4 border-[#6b7280]/20 flex items-center justify-center mx-auto mb-3">
                        <span className="text-lg font-bold text-[#6b7280]">Neutral</span>
                      </div>
                      <p className="text-sm text-[#6b7280]">
                        No clear signal available
                      </p>
                      <p className="text-xs text-[#6b7280]/60 mt-1">
                        Requires real-time data for accurate signals
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              NEWS TAB
          ═══════════════════════════════════════════════════════════════ */}
          {overviewTab === 'news' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-8 flex flex-col items-center justify-center text-center">
                  <div className="size-14 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
                    <TrendingUp className="size-7 text-[#6b7280]/40" />
                  </div>
                  <p className="text-[#1a1a1a] font-semibold text-sm">No news available</p>
                  <p className="text-[#6b7280] text-xs mt-1">
                    News feed for {stockDetail.name} will appear here
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>

      {/* ═══ Trade Panel Overlay ═════════════════════════════════════════ */}
      <AnimatePresence>
        {showTradePanel && stockDetail && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50"
              onClick={() => setShowTradePanel(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto bg-white rounded-t-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-w-lg mx-auto">
                {/* Drag Handle */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="w-10 h-1 rounded-full bg-[#e5e7eb]" />
                </div>

                <div className="px-6 pb-8 space-y-5">
                  {/* Stock Info */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-[#00D09C]">{stockDetail.symbol}</span>
                        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isPositive ? 'bg-[#00B386]/10 text-[#00B386]' : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                        }`}>
                          {formatPercent(stockDetail.changePercent)}
                        </span>
                        {tradeSegment !== 'EQUITY' && (
                          <Badge className="text-[9px] font-bold bg-[#00B386]/10 text-[#00B386] border-[#00B386]/20 border px-1.5 py-0">
                            {tradeSegment}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-[#6b7280] mt-0.5 truncate max-w-[200px]">{stockDetail.name}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold font-mono font-tabular text-[#1a1a1a]">
                        {formatINR(stockDetail.currentPrice)}
                      </span>
                      <p className={`text-xs font-medium ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                        {isPositive ? '+' : ''}{formatINR(stockDetail.change)} today
                      </p>
                    </div>
                  </div>

                  {/* Segment Selector (if F&O available) */}
                  {(stockDetail.isFuturesAvailable || stockDetail.isOptionsAvailable) && (
                    <div className="flex rounded-xl bg-[#f5f7fa] p-1">
                      {(['EQUITY', 'FUTURES', 'OPTIONS'] as const).map((seg) => (
                        <button
                          key={seg}
                          className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all ${
                            tradeSegment === seg ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                          }`}
                          onClick={() => setTradeSegment(seg)}
                        >
                          {seg}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Buy/Sell Toggle */}
                  <div className="flex rounded-xl bg-[#f5f7fa] p-1">
                    <button
                      className={`flex-1 h-10 rounded-lg text-sm font-bold transition-all ${
                        orderSide === 'buy' ? 'bg-[#00d09c] text-white shadow-sm' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                      }`}
                      onClick={() => setOrderSide('buy')}
                    >
                      Buy
                    </button>
                    <button
                      className={`flex-1 h-10 rounded-lg text-sm font-bold transition-all ${
                        orderSide === 'sell' ? 'bg-[#eb5b3c] text-white shadow-sm' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                      }`}
                      onClick={() => setOrderSide('sell')}
                    >
                      Sell
                    </button>
                  </div>

                  {/* Order Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">Order Type</label>
                    <div className="flex gap-2">
                      {['MARKET', 'LIMIT'].map((type) => (
                        <button
                          key={type}
                          onClick={() => setOrderType(type)}
                          className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all border ${
                            orderType === type
                              ? 'border-[#00d09c] bg-[#00B386]/5 text-[#00B386]'
                              : 'border-[#e5e7eb] text-[#6b7280] hover:border-[#d1d5db]'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Product Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">Product Type</label>
                    <div className="flex gap-2">
                      {['INTRADAY', 'DELIVERY'].map((type) => (
                        <button
                          key={type}
                          onClick={() => setProductType(type)}
                          className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all border ${
                            productType === type
                              ? 'border-[#00d09c] bg-[#00B386]/5 text-[#00B386]'
                              : 'border-[#e5e7eb] text-[#6b7280] hover:border-[#d1d5db]'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">
                      Quantity {tradeSegment !== 'EQUITY' ? `(Lot: ${stockDetail.lotSize})` : ''}
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        className="size-10 rounded-lg border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] hover:bg-[#f5f7fa] active:bg-[#e5e7eb] transition-colors"
                        onClick={() => setQuantity(Math.max(1, quantity - (tradeSegment !== 'EQUITY' ? stockDetail.lotSize : 1)))}
                      >
                        <Minus className="size-4" />
                      </button>
                      <Input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        className="text-center font-mono font-tabular text-lg font-bold bg-white border-[#e5e7eb] h-10"
                      />
                      <button
                        className="size-10 rounded-lg border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] hover:bg-[#f5f7fa] active:bg-[#e5e7eb] transition-colors"
                        onClick={() => setQuantity(quantity + (tradeSegment !== 'EQUITY' ? stockDetail.lotSize : 1))}
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>

                  {/* Limit Price */}
                  {orderType === 'LIMIT' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">Limit Price</label>
                      <Input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="Enter price"
                        className="font-mono font-tabular text-lg font-bold bg-white border-[#e5e7eb] h-10"
                      />
                    </div>
                  )}

                  {/* Order Summary */}
                  <div className="bg-[#f8f9fb] rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Estimated Total</span>
                      <span className="text-sm font-bold font-mono font-tabular text-[#1a1a1a]">{formatINR(estimatedTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Brokerage</span>
                      <span className="text-sm font-mono font-tabular font-semibold text-[#6b7280]">{formatINR(estimatedBrokerage)}</span>
                    </div>
                    <div className="h-px bg-[#e5e7eb]" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Segment</span>
                      <span className="text-xs font-semibold text-[#1a1a1a]">{tradeSegment}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Product</span>
                      <span className="text-xs font-semibold text-[#1a1a1a]">{productType}</span>
                    </div>
                  </div>

                  {/* Account Info */}
                  <div className="bg-[#f0fdf4] rounded-xl p-4 space-y-2 border border-[#00d09c]/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Available Balance</span>
                      <span className="text-sm font-bold font-mono font-tabular text-[#1a1a1a]">{formatINR(availableBalance)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280]">Buying Power</span>
                      <span className="text-sm font-bold font-mono font-tabular text-[#00B386]">{formatINR(buyingPower)}</span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button
                    className={`w-full h-12 font-bold rounded-xl text-base gap-2 ${
                      orderSide === 'buy'
                        ? 'bg-[#00D09C] hover:bg-[#00b88a] text-white'
                        : 'bg-[#eb5b3c] hover:bg-[#d44f33] text-white'
                    }`}
                    onClick={handlePlaceOrder}
                    disabled={placingOrder}
                  >
                    {placingOrder ? (
                      <>
                        <Loader2 className="size-5 animate-spin" />
                        Placing Order...
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="size-5" />
                        {orderSide === 'buy' ? 'Buy' : 'Sell'} {quantity} {stockDetail.symbol}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ═══ Trade Confirmation Modal ═══════════════════════════════════ */}
      <TradeConfirmModal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        tradeData={confirmData}
        onConfirm={executeTrade}
        onSuccess={handleTradeConfirmSuccess}
      />
    </div>
  )
}