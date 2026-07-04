'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Landmark,
  IndianRupee,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Briefcase,
  Loader2,
  PieChart as PieChartIcon,
  Calendar as CalendarIcon,
} from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { formatINR, formatINRWhole, formatPercent, formatPrice } from '@/lib/format'
import { DateFilter, DateFilterPreset, DateRange, getDateRange, isDateInRange } from '@/components/pepertect/date-filter'
import { useStockData } from '@/hooks/use-market-data'

// ─── Types ───────────────────────────────────────────────────────

interface PositionData {
  id: string
  segment: string
  productType: string
  tradeDirection: string
  symbol: string
  optionType?: string | null
  strikePrice?: number | null
  expiryDate?: string | null
  quantity: number
  entryPrice: number
  currentPrice: number
  totalInvested: number
  currentValue: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  marginUsed: number
  isOpen: boolean
  createdAt: string
}

interface PortfolioData {
  virtualBalance: number
  marginUsed: number
  availableMargin: number
  totalInvested: number
  totalCurrentValue: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
  totalPortfolioValue: number
  totalPnl: number
  totalReturn: number
  totalTrades: number
  initialCapital: number
  openPositionsCount: number
  positions?: PositionData[]
  segments?: {
    equity: { count: number; invested: number; currentValue: number; unrealizedPnl: number; positions?: PositionData[] }
    futures: { count: number; invested: number; currentValue: number; unrealizedPnl: number; marginUsed: number; positions?: PositionData[] }
    options: { count: number; invested: number; currentValue: number; unrealizedPnl: number; marginUsed: number; positions?: PositionData[] }
  }
}

// ─── Component ───────────────────────────────────────────────────

export default function PortfolioPage() {
  const { token } = useAuthStore()
  const { setCurrentPage, dateFilterPreset, dateFilterRange, setDateFilter } = useAppStore()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [positions, setPositions] = useState<PositionData[]>([])
  const [loading, setLoading] = useState(true)
  const [squaringOff, setSquaringOff] = useState<string | null>(null)

  // ─── Real-Time Market Data (1s polling) ────────────────────────
  const { stocks: wsStockQuotes, status: wsStatus } = useStockData()

  // ─── Live prices map (separate from positions for stable rendering) ──
  const livePricesRef = useRef<Record<string, number>>({})
  const [livePrices, setLivePrices] = useState<Record<string, number>>({})

  // Update live prices only when they actually change
  useEffect(() => {
    if (wsStatus !== 'connected') return

    const updates: Record<string, number> = {}
    let hasChanges = false

    for (const pos of positions) {
      if (pos.segment === 'EQUITY') {
        const quote = wsStockQuotes[pos.symbol]
        if (quote && quote.last_price > 0) {
          const newPrice = quote.last_price
          if (livePricesRef.current[pos.symbol] !== newPrice) {
            updates[pos.symbol] = newPrice
            hasChanges = true
          }
        }
      }
    }

    if (hasChanges) {
      livePricesRef.current = { ...livePricesRef.current, ...updates }
      setLivePrices(prev => ({ ...prev, ...updates }))
    }
  }, [wsStockQuotes, wsStatus, positions])

  // ─── Single API call that returns BOTH portfolio + positions ──
  const fetchPortfolio = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/trade/portfolio', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        const data = json.data as PortfolioData
        setPortfolio(data)
        // Extract positions from portfolio response (no separate API call needed!)
        if (data.positions && data.positions.length > 0) {
          setPositions(data.positions)
        } else if (data.segments) {
          // Fallback: extract from segments
          const allPositions = [
            ...(data.segments.equity.positions || []),
            ...(data.segments.futures.positions || []),
            ...(data.segments.options.positions || []),
          ]
          setPositions(allPositions)
        } else {
          setPositions([])
        }
      }
    } catch {
      // silent
    }
  }, [token])

  const loadData = useCallback(async () => {
    setLoading(true)
    await fetchPortfolio()
    setLoading(false)
  }, [fetchPortfolio])

  useEffect(() => {
    loadData()
    // Auto-refresh every 30s (prices are updated in real-time via useStockData)
    const interval = setInterval(fetchPortfolio, 30000)
    return () => clearInterval(interval)
  }, [loadData, fetchPortfolio])

  const handleSquareOff = async (positionId: string, symbol: string) => {
    if (!token) return
    setSquaringOff(positionId)
    try {
      const res = await fetch('/api/trade/square-off', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ positionId }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(`Squared off ${symbol}`)
        // Optimistic update: remove the position from local state immediately
        setPositions(prev => prev.filter(p => p.id !== positionId))
        // Then refresh from server
        fetchPortfolio()
      } else {
        toast.error(data.error || 'Failed to square off')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSquaringOff(null)
    }
  }

  // ─── Date Filter Logic ─────────────────────────────────
  const activeDateRange = useMemo(() => getDateRange(dateFilterPreset, dateFilterRange), [dateFilterPreset, dateFilterRange])

  const handleDateFilterChange = useCallback((preset: DateFilterPreset, range?: DateRange) => {
    setDateFilter(preset, range)
  }, [setDateFilter])

  // ─── Merge Real-Time Prices into Positions ─────────────────────
  const enrichedPositions = useMemo(() => {
    return positions.map(pos => {
      // For EQUITY positions, use live prices (1s updates)
      if (pos.segment === 'EQUITY') {
        const livePrice = livePrices[pos.symbol]
        if (livePrice && livePrice > 0) {
          let unrealizedPnl: number
          if (pos.tradeDirection === 'BUY') {
            unrealizedPnl = (livePrice - pos.entryPrice) * pos.quantity
          } else {
            unrealizedPnl = (pos.entryPrice - livePrice) * pos.quantity
          }
          const currentValue = pos.quantity * livePrice
          return {
            ...pos,
            currentPrice: livePrice,
            currentValue,
            unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
            unrealizedPnlPercent: pos.totalInvested > 0
              ? Math.round((unrealizedPnl / pos.totalInvested) * 10000) / 100
              : 0,
          }
        }
      }
      return pos
    })
  }, [positions, livePrices])

  const filteredPositions = useMemo(() =>
    enrichedPositions.filter(p => isDateInRange(p.createdAt, activeDateRange)),
    [enrichedPositions, activeDateRange]
  )

  // ─── Computed from filtered positions ──────────────────────
  const filteredInvestedAmount = useMemo(() =>
    filteredPositions.reduce((s, p) => s + p.totalInvested, 0),
    [filteredPositions]
  )

  const filteredCurrentValue = useMemo(() =>
    filteredPositions.reduce((s, p) => s + p.currentValue, 0),
    [filteredPositions]
  )

  const filteredUnrealizedPnl = useMemo(() =>
    filteredPositions.reduce((s, p) => s + p.unrealizedPnl, 0),
    [filteredPositions]
  )

  // Realized P&L comes from the API (closed positions aren't in the positions table)
  const realizedPnl = portfolio?.totalRealizedPnl ?? 0

  // Total P&L = unrealized from filtered + realized from API
  const totalPnl = useMemo(() =>
    filteredUnrealizedPnl + realizedPnl,
    [filteredUnrealizedPnl, realizedPnl]
  )

  // Total portfolio value = balance + filtered current value of positions
  const totalValue = useMemo(() =>
    (portfolio?.virtualBalance ?? 0) + filteredCurrentValue,
    [portfolio?.virtualBalance, filteredCurrentValue]
  )

  const investedAmount = filteredInvestedAmount
  const currentvalue = filteredCurrentValue
  const unrealizedPnl = filteredUnrealizedPnl

  const totalReturn = useMemo(() => {
    const initialCapital = portfolio?.initialCapital ?? 100000
    if (initialCapital === 0) return 0
    return ((totalPnl / initialCapital) * 100)
  }, [totalPnl, portfolio?.initialCapital])

  // Allocation data from filtered positions
  const allocationData = useMemo(() => {
    if (!portfolio) return []
    return [
      { name: 'Positions', value: filteredCurrentValue, color: '#00D09C' },
      { name: 'Cash', value: portfolio.virtualBalance, color: '#c7d2fe' },
    ].filter(d => d.value > 0)
  }, [portfolio, filteredCurrentValue])

  const allocationTotal = useMemo(() =>
    allocationData.reduce((s, d) => s + d.value, 0),
    [allocationData]
  )

  // Segment breakdown computed from filtered positions
  const segmentBreakdown = useMemo(() => {
    const equityPositions = filteredPositions.filter(p => p.segment === 'EQUITY' || p.segment === 'CASH')
    const futuresPositions = filteredPositions.filter(p => p.segment === 'FUTURES')
    const optionsPositions = filteredPositions.filter(p => p.segment === 'OPTIONS')

    return [
      {
        name: 'Equity',
        count: equityPositions.length,
        value: equityPositions.reduce((s, p) => s + p.currentValue, 0),
        pnl: equityPositions.reduce((s, p) => s + p.unrealizedPnl, 0),
        invested: equityPositions.reduce((s, p) => s + p.totalInvested, 0),
        icon: TrendingUp,
        color: '#00D09C',
      },
      {
        name: 'Futures',
        count: futuresPositions.length,
        value: futuresPositions.reduce((s, p) => s + p.currentValue, 0),
        pnl: futuresPositions.reduce((s, p) => s + p.unrealizedPnl, 0),
        invested: futuresPositions.reduce((s, p) => s + p.totalInvested, 0),
        icon: Landmark,
        color: '#00d09c',
      },
      {
        name: 'Options',
        count: optionsPositions.length,
        value: optionsPositions.reduce((s, p) => s + p.currentValue, 0),
        pnl: optionsPositions.reduce((s, p) => s + p.unrealizedPnl, 0),
        invested: optionsPositions.reduce((s, p) => s + p.totalInvested, 0),
        icon: IndianRupee,
        color: '#eb5b3c',
      },
    ].filter(s => s.count > 0 || s.invested > 0)
  }, [filteredPositions])

  return (
    <div className="min-h-screen bg-[#f5f7fa] px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* ── Page Header ───────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">
              Portfolio
            </h1>
            {wsStatus === 'connected' && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-[#00B386] bg-[#00B386]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                <span className="size-1.5 rounded-full bg-[#00B386] animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#6b7280]">
            Track your holdings, returns, and allocation in real-time.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <DateFilter
            value={dateFilterPreset}
            onChange={handleDateFilterChange}
            customRange={dateFilterRange}
          />
          <Button
            className="gap-1.5 rounded-lg bg-[#00D09C] text-white font-semibold shadow-md hover:bg-[#00b88a] active:scale-[0.98]"
            onClick={() => setCurrentPage('trading')}
          >
            <TrendingUp className="size-4" />
            New Trade
          </Button>
        </div>
      </div>

      {/* ── Date Filter Info ────────────────────────────────────── */}
      {dateFilterPreset !== 'all' && (filteredPositions.length > 0 || positions.length > 0) && (
        <div className="flex items-center gap-2 text-xs text-[#6b7280] bg-[#f8f9fb] px-3 py-2 rounded-lg border border-[#e5e7eb]/50">
          <CalendarIcon className="size-3.5 text-[#00D09C]" />
          Showing {filteredPositions.length} of {positions.length} positions for{' '}
          <span className="font-semibold text-[#1a1a1a]">
            {dateFilterPreset === 'custom' && dateFilterRange
              ? `${new Date(dateFilterRange.from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(dateFilterRange.to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
              : dateFilterPreset.charAt(0).toUpperCase() + dateFilterPreset.slice(1)}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
            <CardContent className="p-6">
              <Skeleton className="h-4 w-32 mb-3 bg-[#f0f0f5]" />
              <Skeleton className="h-10 w-48 mb-4 bg-[#f0f0f5]" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16 w-full rounded-lg bg-[#f0f0f5]" />
                <Skeleton className="h-16 w-full rounded-lg bg-[#f0f0f5]" />
                <Skeleton className="h-16 w-full rounded-lg bg-[#f0f0f5]" />
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-5">
                  <Skeleton className="h-4 w-24 mb-3 bg-[#f0f0f5]" />
                  <Skeleton className="h-8 w-36 mb-2 bg-[#f0f0f5]" />
                  <Skeleton className="h-4 w-28 bg-[#f0f0f5]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* ── Total Portfolio Value Card ─────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase">
                    Total Portfolio Value
                  </p>
                  <div className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold ${
                    totalPnl >= 0
                      ? 'bg-[#00B386]/10 text-[#00B386]'
                      : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                  }`}>
                    {totalPnl >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {totalPnl >= 0 ? '+' : '-'}{formatINR(Math.abs(totalPnl))}
                    <span className="ml-0.5">({formatPercent(totalReturn)})</span>
                  </div>
                </div>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl sm:text-4xl font-bold font-mono-data font-tabular text-[#1a1a1a]">
                    {formatINRWhole(totalValue)}
                  </span>
                  <span className="text-lg text-[#6b7280]">
                    .{Math.abs(totalValue % 1).toFixed(2).substring(2)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#f8f9fb] rounded-xl p-4 border border-[#e5e7eb]/50">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="size-7 rounded-lg bg-[#00D09C]/10 flex items-center justify-center">
                        <Wallet className="size-3.5 text-[#00D09C]" />
                      </div>
                      <span className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Available Balance</span>
                    </div>
                    <span className="text-lg font-bold font-mono-data font-tabular text-[#1a1a1a]">
                      {formatINR(portfolio?.virtualBalance ?? 100000)}
                    </span>
                  </div>
                  <div className="bg-[#f8f9fb] rounded-xl p-4 border border-[#e5e7eb]/50">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="size-7 rounded-lg bg-[#6b7280]/10 flex items-center justify-center">
                        <IndianRupee className="size-3.5 text-[#6b7280]" />
                      </div>
                      <span className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Invested</span>
                    </div>
                    <span className="text-lg font-bold font-mono-data font-tabular text-[#1a1a1a]">
                      {formatINR(investedAmount)}
                    </span>
                  </div>
                  <div className="bg-[#f8f9fb] rounded-xl p-4 border border-[#e5e7eb]/50">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="size-7 rounded-lg bg-[#00B386]/10 flex items-center justify-center">
                        <Landmark className="size-3.5 text-[#00B386]" />
                      </div>
                      <span className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Current Value</span>
                    </div>
                    <span className="text-lg font-bold font-mono-data font-tabular text-[#1a1a1a]">
                      {formatINR(currentvalue)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Summary Cards Row ─────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className={`bg-white border border-[#e5e7eb] rounded-xl shadow-sm border-l-4 ${totalPnl >= 0 ? 'border-l-[#00d09c]' : 'border-l-[#eb5b3c]'}`}>
                <CardContent className="p-5">
                  <div className="mb-2 flex items-start justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">Total P&amp;L</p>
                    <div className={`size-7 rounded-lg flex items-center justify-center ${totalPnl >= 0 ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'}`}>
                      {totalPnl >= 0 ? <TrendingUp className="size-3.5 text-[#00B386]" /> : <TrendingDown className="size-3.5 text-[#EB5B3C]" />}
                    </div>
                  </div>
                  <h3 className={`font-mono-data font-tabular text-2xl font-bold ${totalPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {totalPnl >= 0 ? '+' : '-'}{formatINR(Math.abs(totalPnl))}
                  </h3>
                  <div className={`mt-2 flex items-center gap-1 text-xs font-semibold ${totalPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {totalPnl >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {formatPercent(totalReturn)} returns
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className={`bg-white border border-[#e5e7eb] rounded-xl shadow-sm border-l-4 ${unrealizedPnl >= 0 ? 'border-l-[#00d09c]' : 'border-l-[#eb5b3c]'}`}>
                <CardContent className="p-5">
                  <div className="mb-2 flex items-start justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">Unrealized P&amp;L</p>
                    <div className={`size-7 rounded-lg flex items-center justify-center ${unrealizedPnl >= 0 ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'}`}>
                      {unrealizedPnl >= 0 ? <TrendingUp className="size-3.5 text-[#00B386]" /> : <TrendingDown className="size-3.5 text-[#EB5B3C]" />}
                    </div>
                  </div>
                  <h3 className={`font-mono-data font-tabular text-2xl font-bold ${unrealizedPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {unrealizedPnl >= 0 ? '+' : '-'}{formatINR(Math.abs(unrealizedPnl))}
                  </h3>
                  <div className={`mt-2 flex items-center gap-1 text-xs font-semibold ${unrealizedPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {unrealizedPnl >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {formatPercent(investedAmount > 0 ? (unrealizedPnl / investedAmount) * 100 : 0)} ROI
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className={`bg-white border border-[#e5e7eb] rounded-xl shadow-sm border-l-4 ${realizedPnl >= 0 ? 'border-l-[#00d09c]' : 'border-l-[#eb5b3c]'}`}>
                <CardContent className="p-5">
                  <div className="mb-2 flex items-start justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">Realized P&amp;L</p>
                    <div className={`size-7 rounded-lg flex items-center justify-center ${realizedPnl >= 0 ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'}`}>
                      <Wallet className={`size-3.5 ${realizedPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`} />
                    </div>
                  </div>
                  <h3 className={`font-mono-data font-tabular text-2xl font-bold ${realizedPnl >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                    {realizedPnl >= 0 ? '+' : '-'}{formatINR(Math.abs(realizedPnl))}
                  </h3>
                  <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#6b7280]">
                    From closed positions
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm border-l-4 border-l-[#00D09C]">
                <CardContent className="p-5">
                  <div className="mb-2 flex items-start justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">Open Positions</p>
                    <div className="size-7 rounded-lg bg-[#00D09C]/10 flex items-center justify-center">
                      <Briefcase className="size-3.5 text-[#00D09C]" />
                    </div>
                  </div>
                  <h3 className="font-mono-data font-tabular text-2xl font-bold text-[#1a1a1a]">
                    {filteredPositions.length}
                  </h3>
                  <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#00D09C]">
                    {positions.length} total positions
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* ── Holdings Table ────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
                <h4 className="text-lg font-semibold text-[#1a1a1a]">Holdings</h4>
                <Badge variant="secondary" className="bg-[#00D09C]/10 text-[#00D09C] border-0 text-xs font-semibold">
                  {filteredPositions.length} Active
                </Badge>
              </div>

              {filteredPositions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="size-14 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
                    <Briefcase className="size-7 text-[#6b7280]/40" />
                  </div>
                  <p className="text-[#1a1a1a] font-semibold text-sm">Your portfolio is empty</p>
                  <p className="text-[#6b7280] text-xs mt-1">Start trading to see your holdings here</p>
                  <Button
                    size="sm"
                    className="mt-4 gap-1.5 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg"
                    onClick={() => setCurrentPage('trading')}
                  >
                    <TrendingUp className="size-3.5" />
                    Start Trading
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-[#e5e7eb]">
                        <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Symbol</TableHead>
                        <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Direction</TableHead>
                        <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Segment</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Qty</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Avg Price</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">LTP</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">P&amp;L</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Current Value</TableHead>
                        <TableHead className="text-center text-xs font-semibold text-[#6b7280] tracking-wider uppercase bg-[#f8f9fb]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-[#e5e7eb]">
                      {filteredPositions.map((pos) => {
                        const isLong = pos.tradeDirection === 'BUY'
                        const pnlValue = pos.unrealizedPnl
                        const pnlPercent = pos.unrealizedPnlPercent
                        const isPositive = pnlValue >= 0

                        return (
                          <TableRow key={pos.id} className="hover:bg-[#f8f9fb] transition-colors">
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-[#00D09C]">{pos.symbol}</span>
                                {pos.segment === 'OPTIONS' && pos.strikePrice && (
                                  <span className="text-[10px] uppercase text-[#6b7280]">
                                    {pos.strikePrice} {pos.optionType}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={`text-[10px] font-semibold border-0 gap-0.5 ${
                                isLong ? 'bg-[#00B386]/10 text-[#00B386]' : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                              }`}>
                                {isLong ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                                {isLong ? 'Long' : 'Short'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-[#6b7280]">{pos.segment}</TableCell>
                            <TableCell className="text-right font-mono-data font-tabular text-sm text-[#1a1a1a]">{pos.quantity}</TableCell>
                            <TableCell className="text-right font-mono-data font-tabular text-sm text-[#6b7280]">{formatINR(pos.entryPrice)}</TableCell>
                            <TableCell className="text-right font-mono-data font-tabular text-sm text-[#1a1a1a]">{formatINR(pos.currentPrice)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end">
                                <span className={`font-mono-data font-tabular text-sm font-semibold ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                                  {isPositive ? '+' : '-'}{formatINR(Math.abs(pnlValue))}
                                </span>
                                <span className={`text-[10px] font-semibold ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                                  {formatPercent(pnlPercent)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono-data font-tabular text-sm font-medium text-[#1a1a1a]">
                              {formatINR(pos.currentValue)}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-lg border border-[#eb5b3c]/30 bg-[#EB5B3C]/5 px-3 py-1.5 text-[11px] font-semibold text-[#EB5B3C] transition-all hover:bg-[#eb5b3c] hover:text-white hover:border-[#eb5b3c] active:scale-95"
                                disabled={squaringOff === pos.id}
                                onClick={() => handleSquareOff(pos.id, pos.symbol)}
                              >
                                {squaringOff === pos.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  'Square Off'
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </motion.div>

          {/* ── Segment Breakdown Cards ──────────────────────────── */}
          {segmentBreakdown.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold text-[#1a1a1a]">Segment Breakdown</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {segmentBreakdown.map((segment) => {
                  const Icon = segment.icon
                  const isProfit = segment.pnl >= 0
                  const pnlPercent = segment.invested > 0
                    ? (segment.pnl / segment.invested) * 100
                    : 0
                  return (
                    <Card key={segment.name} className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm hover:shadow-md hover:border-[#00D09C]/20 transition-all duration-300">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2.5">
                            <div className="size-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${segment.color}12` }}>
                              <Icon className="size-4" style={{ color: segment.color }} />
                            </div>
                            <div>
                              <span className="text-sm font-semibold text-[#1a1a1a]">{segment.name}</span>
                              <span className="ml-1.5 text-[10px] text-[#6b7280]">
                                {segment.count} pos{segment.count !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] font-semibold border-0 ${
                            isProfit ? 'bg-[#00B386]/10 text-[#00B386]' : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                          }`}>
                            {formatPercent(pnlPercent)}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#6b7280]">Current Value</span>
                            <span className="font-mono-data font-tabular text-sm font-semibold text-[#1a1a1a]">{formatINRWhole(segment.value)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#6b7280]">Invested</span>
                            <span className="font-mono-data font-tabular text-sm text-[#6b7280]">{formatINRWhole(segment.invested)}</span>
                          </div>
                          <div className="h-px bg-[#e5e7eb]" />
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#6b7280]">P&amp;L</span>
                            <span className={`font-mono-data font-tabular text-sm font-semibold ${isProfit ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
                              {isProfit ? '+' : '-'}{formatINR(Math.abs(segment.pnl))}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ── Bottom Section: Allocation + Account Details ──── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              className="lg:col-span-2"
            >
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm h-full">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <PieChartIcon className="size-5 text-[#00D09C]" />
                    <h4 className="text-lg font-semibold text-[#1a1a1a]">Asset Allocation</h4>
                  </div>
                  {allocationData.length > 0 && allocationTotal > 0 ? (
                    <div className="flex flex-col items-center gap-8 sm:flex-row">
                      <div className="relative h-48 w-48 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={allocationData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={3} dataKey="value" stroke="none">
                              {allocationData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: number) => formatINR(value)}
                              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '10px', fontSize: '12px', color: '#1a1a1a', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                              itemStyle={{ color: '#1a1a1a' }}
                              labelStyle={{ color: '#6b7280' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl font-bold leading-none text-[#1a1a1a]">
                            {investedAmount > 0 && totalValue > 0 ? Math.round((investedAmount / totalValue) * 100) : 0}%
                          </span>
                          <span className="text-[10px] uppercase text-[#6b7280]">Invested</span>
                        </div>
                      </div>
                      <div className="flex w-full flex-col gap-4">
                        {allocationData.map((item) => {
                          const percent = ((item.value / allocationTotal) * 100).toFixed(1)
                          return (
                            <div key={item.name} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="size-3 rounded-full" style={{ backgroundColor: item.color }} />
                                <span className="text-xs font-semibold text-[#1a1a1a]">{item.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-data font-tabular text-sm text-[#1a1a1a]">{formatINRWhole(item.value)}</span>
                                <Badge variant="outline" className="border-[#e5e7eb] text-[10px] text-[#6b7280]">{percent}%</Badge>
                              </div>
                            </div>
                          )
                        })}
                        <div className="mt-2">
                          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#f0f0f5]">
                            {allocationData.map((item) => {
                              const width = (item.value / allocationTotal) * 100
                              return <div key={item.name} className="h-full transition-all duration-700" style={{ width: `${width}%`, backgroundColor: item.color }} />
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="size-14 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
                        <PieChartIcon className="size-7 text-[#6b7280]/40" />
                      </div>
                      <p className="text-sm text-[#6b7280]">No allocation data yet</p>
                      <p className="text-xs text-[#6b7280]/60 mt-1">Start trading to see your portfolio allocation</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm h-full border-l-4 border-l-[#00D09C]">
                <CardContent className="p-6">
                  <h4 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-[#6b7280]">Account Details</h4>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#6b7280]">Available Balance</span>
                      <span className="font-mono-data font-tabular text-sm font-semibold text-[#1a1a1a]">{formatINR(portfolio?.virtualBalance ?? 100000)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#6b7280]">Margin Used</span>
                      <span className="font-mono-data font-tabular text-sm font-semibold text-[#1a1a1a]">{formatINR(portfolio?.marginUsed ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#6b7280]">Available Margin</span>
                      <span className="font-mono-data font-tabular text-sm font-semibold text-[#1a1a1a]">{formatINR(portfolio?.availableMargin ?? 100000)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#6b7280]">Total Trades</span>
                      <span className="font-mono-data font-tabular text-sm font-semibold text-[#1a1a1a]">{portfolio?.totalTrades ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </>
      )}
    </div>
  )
}
