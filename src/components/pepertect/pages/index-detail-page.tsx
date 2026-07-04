'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeft,
  BarChart3,
  CandlestickChart,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatINR, formatINRWhole, formatNumber, formatPrice, formatPercent } from '@/lib/format'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface IndexDetail {
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  previousClose: number
  volume: number
  week52High: number
  week52Low: number
  lotSize: number
  strikeInterval: number
  isRealData?: boolean
}

interface CandleData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type RangeOption = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y'

function formatDate(dateStr: string, range: RangeOption): string {
  const d = new Date(dateStr)
  if (range === '1D') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1W') return d.toLocaleDateString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1M' || range === '3M') return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

// ─── Chart Tooltip ──────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, range }: { active?: boolean; payload?: Array<{ payload: CandleData }>; label?: string; range: RangeOption }) {
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
        <span className={cn('font-mono text-right font-semibold', isUp ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>
          {formatPrice(d.close)}
        </span>
        {d.volume > 0 && (
          <>
            <span className="text-[#6b7280]">Volume</span>
            <span className="font-mono font-tabular text-right">{formatNumber(d.volume)}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className="bg-white border border-[#e5e7eb] p-4 rounded-xl">
      <p className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase mb-1.5">{label}</p>
      <p className={cn(
        'font-mono font-tabular font-bold text-lg',
        highlight ? 'text-[#00B386]' : danger ? 'text-[#EB5B3C]' : 'text-[#1a1a1a]'
      )}>
        {value}
      </p>
    </div>
  )
}

// ─── Range Bar ──────────────────────────────────────────────────────────────

function RangeBar({ label, low, high, current }: { label: string; low: number; high: number; current: number }) {
  const range = high - low
  const currentPos = range > 0 ? ((current - low) / range) * 100 : 50

  return (
    <div className="bg-white border border-[#e5e7eb] p-4 rounded-xl space-y-3">
      <h4 className="text-sm font-semibold text-[#1a1a1a]">{label}</h4>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs font-mono font-tabular">
          <span className="text-[#EB5B3C] font-semibold">{formatINRWhole(low)}</span>
          <span className="text-[#00B386] font-semibold">{formatINRWhole(high)}</span>
        </div>
        <div className="h-2 rounded-full bg-[#f5f7fa] relative overflow-hidden border border-[#e5e7eb]/50">
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-[#eb5b3c] to-[#00B386] opacity-30"
            style={{ width: '100%' }}
          />
          <div
            className="absolute top-0 h-full w-1.5 bg-[#1a1a1a] rounded-full shadow-sm"
            style={{ left: `${Math.min(98, Math.max(1, currentPos))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function IndexDetailPage() {
  const { selectedIndexSymbol, setCurrentPage, setSelectedIndexSymbol } = useAppStore()
  const symbol = selectedIndexSymbol

  // State
  const [detail, setDetail] = useState<IndexDetail | null>(null)
  const [chartData, setChartData] = useState<CandleData[]>([])
  const [range, setRange] = useState<RangeOption>('1M')
  const [detailLoading, setDetailLoading] = useState(false)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartType, setChartType] = useState<'area' | 'candle'>('area')


  // Fetch index detail
  const fetchDetail = useCallback(async () => {
    if (!symbol) return
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/market/index-detail/${symbol}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success) setDetail(json.data)
      }
    } catch {
      // Keep previous data or null
    } finally {
      setDetailLoading(false)
    }
  }, [symbol])

  // Fetch chart data
  const fetchChart = useCallback(async () => {
    if (!symbol) return
    setChartLoading(true)
    try {
      const res = await fetch(`/api/market/index-chart/${symbol}?range=${range}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success) setChartData(json.data || [])
      }
    } catch {
      // Keep previous data
    } finally {
      setChartLoading(false)
    }
  }, [symbol, range])

  useEffect(() => {
    if (symbol) {
      fetchDetail()
      // Reduced from 2s to 10s — index data is near-real-time via WS
      const interval = setInterval(fetchDetail, 10000)
      return () => clearInterval(interval)
    }
  }, [symbol, fetchDetail])

  useEffect(() => {
    if (symbol) {
      fetchChart()
    }
  }, [symbol, range, fetchChart])


  // Chart data for Recharts
  const chartDataFormatted = useMemo(() => {
    return chartData.map((d) => ({
      ...d,
      dateLabel: formatDate(d.date, range),
      color: d.close >= d.open ? '#00B386' : '#eb5b3c',
    }))
  }, [chartData, range])

  // Chart min/max
  const chartMinMax = useMemo(() => {
    if (chartDataFormatted.length === 0) return { min: 0, max: 0 }
    const prices = chartDataFormatted.flatMap((d) => [d.high, d.low])
    return {
      min: Math.min(...prices) * 0.999,
      max: Math.max(...prices) * 1.001,
    }
  }, [chartDataFormatted])

  const isPositive = detail ? detail.change >= 0 : true
  const gradientId = `gradient-page-${symbol}`

  // No symbol selected
  if (!symbol) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#6b7280] text-sm">No index selected</p>
          <Button
            variant="outline"
            className="mt-4 text-[#00D09C] border-[#00D09C]/30 hover:bg-[#00D09C]/10"
            onClick={() => setCurrentPage('dashboard')}
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* ═══ Header ═════════════════════════════════════════════════════════ */}
      <div className="sticky top-14 md:top-14 z-20 bg-white border-b border-[#e5e7eb]">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Back button + Index info */}
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#f5f5f5] h-9 w-9"
                onClick={() => setCurrentPage('dashboard')}
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="size-5" />
              </Button>
              {detailLoading ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div>
                    <Skeleton className="h-5 w-28 mb-1" />
                    <Skeleton className="h-7 w-40" />
                  </div>
                </div>
              ) : (
                <>
                  <div className={cn(
                    'flex size-10 items-center justify-center rounded-xl shrink-0',
                    isPositive ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'
                  )}>
                    {isPositive ? (
                      <TrendingUp className="size-5 text-[#00B386]" />
                    ) : (
                      <TrendingDown className="size-5 text-[#EB5B3C]" />
                    )}
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-[#1a1a1a]">{detail?.name || symbol}</h1>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xl font-bold font-mono font-tabular text-[#1a1a1a]">
                        {detail ? formatPrice(detail.currentPrice) : '0.00'}
                      </span>
                      <span className={cn(
                        'flex items-center gap-0.5 text-sm font-semibold',
                        isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                      )}>
                        {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                        {detail?.change >= 0 ? '+' : ''}{formatPrice(detail?.change ?? 0)} ({formatPercent(detail?.changePercent ?? 0)})
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>


          </div>
        </div>
      </div>

      {/* ═══ Content ═══════════════════════════════════════════════════════ */}
      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-5">

        {/* ── Chart Section ─────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e5e7eb] rounded-xl p-4 sm:p-6 space-y-4">
          {/* Range Selector + Chart Type */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'] as RangeOption[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
                    range === r
                      ? 'bg-[#00D09C] text-white shadow-sm'
                      : 'text-[#6b7280] hover:bg-[#f5f5f5] hover:text-[#1a1a1a]'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <button
                onClick={() => setChartType('area')}
                className={cn(
                  'p-2 rounded-lg transition-all',
                  chartType === 'area' ? 'bg-[#f5f5f5] text-[#00D09C]' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                )}
                aria-label="Area chart"
              >
                <BarChart3 className="size-4" />
              </button>
              <button
                onClick={() => setChartType('candle')}
                className={cn(
                  'p-2 rounded-lg transition-all',
                  chartType === 'candle' ? 'bg-[#f5f5f5] text-[#00D09C]' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                )}
                aria-label="Candle chart"
              >
                <CandlestickChart className="size-4" />
              </button>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-xl">
            {chartLoading ? (
              <div className="h-[300px] sm:h-[380px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-[#6b7280]">Loading chart data...</span>
                </div>
              </div>
            ) : chartDataFormatted.length > 0 ? (
              <div className="h-[300px] sm:h-[380px]">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'area' ? (
                    <AreaChart data={chartDataFormatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={isPositive ? '#00B386' : '#eb5b3c'} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={isPositive ? '#00B386' : '#eb5b3c'} stopOpacity={0} />
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
                        stroke={isPositive ? '#00B386' : '#eb5b3c'}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                      />
                    </AreaChart>
                  ) : (
                    <BarChart data={chartDataFormatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                      <Bar
                        dataKey="close"
                        shape={(props: Record<string, unknown>) => {
                          const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: CandleData }
                          const isUp = payload.close >= payload.open
                          return (
                            <rect
                              x={x}
                              y={y}
                              width={Math.max(1, width as number)}
                              height={height}
                              fill={isUp ? '#00B386' : '#eb5b3c'}
                              opacity={0.85}
                              rx={1}
                            />
                          )
                        }}
                      />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] sm:h-[380px] flex items-center justify-center text-[#6b7280] text-sm">
                No chart data available
              </div>
            )}
          </div>
        </div>

        {/* ── Statistics Section ────────────────────────────────────────── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[#1a1a1a] px-1">Statistics</h3>

          {/* Key Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Open" value={detail?.open ? formatINR(detail.open) : '--'} />
            <StatCard label="Previous Close" value={detail?.previousClose ? formatINR(detail.previousClose) : '--'} />
            <StatCard label="Day High" value={detail?.high ? formatINR(detail.high) : '--'} highlight />
            <StatCard label="Day Low" value={detail?.low ? formatINR(detail.low) : '--'} danger />
            <StatCard label="52W High" value={detail?.week52High ? formatINR(detail.week52High) : '--'} highlight />
            <StatCard label="52W Low" value={detail?.week52Low ? formatINR(detail.week52Low) : '--'} danger />
            <StatCard label="Volume" value={detail?.volume ? formatNumber(detail.volume) : '--'} />
            <StatCard label="Lot Size" value={detail?.lotSize?.toString() || '--'} />
          </div>

          {/* Day Range Bar */}
          {detail && detail.low > 0 && detail.high > 0 && (
            <RangeBar
              label="Day Range"
              low={detail.low}
              high={detail.high}
              current={detail.currentPrice}
            />
          )}

          {/* 52 Week Range Bar */}
          {detail && detail.week52Low > 0 && detail.week52High > 0 && (
            <RangeBar
              label="52 Week Range"
              low={detail.week52Low}
              high={detail.week52High}
              current={detail.currentPrice}
            />
          )}
        </div>


      </div>
    </div>
  )
}
