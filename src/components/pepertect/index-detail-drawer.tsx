'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  X,
  BarChart3,
  CandlestickChart,
  Activity,
  Info,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
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

function CustomTooltip({ active, payload, label, range }: { active?: boolean; payload?: Array<{ payload: CandleData }>; label?: string; range: RangeOption }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  const isUp = d.close >= d.open

  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded-lg p-3 shadow-xl border border-[#e5e7eb]/20 text-xs">
      <div className="font-semibold text-[#1a1a1a] mb-1.5">{formatDate(d.date, range)}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-[#6b7280]">Open</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.open)}</span>
        <span className="text-[#6b7280]">High</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.high)}</span>
        <span className="text-[#6b7280]">Low</span>
        <span className="font-mono font-tabular text-right">{formatPrice(d.low)}</span>
        <span className="text-[#6b7280]">Close</span>
        <span className={cn('font-mono font-tabular text-right font-semibold', isUp ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>
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

// ─── Main Component ─────────────────────────────────────────────────────────

interface IndexDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  symbol: string | null
}

export function IndexDetailDrawer({ open, onOpenChange, symbol }: IndexDetailDrawerProps) {
  const { token } = useAuthStore()

  // State
  const [detail, setDetail] = useState<IndexDetail | null>(null)
  const [chartData, setChartData] = useState<CandleData[]>([])
  const [range, setRange] = useState<RangeOption>('1M')
  const [detailLoading, setDetailLoading] = useState(false)
  const [chartLoading, setChartLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chart')
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
    if (open && symbol) {
      fetchDetail()
      setActiveTab('chart')
    }
  }, [open, symbol, fetchDetail])

  useEffect(() => {
    if (open && symbol) {
      fetchChart()
    }
  }, [open, symbol, range, fetchChart])


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
  const gradientId = `gradient-${symbol}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[680px] md:max-w-[780px] lg:max-w-[900px] p-0 gap-0 bg-[#f5f7fa] border-l border-[#e5e7eb]/20 overflow-y-auto [&>button]:hidden"
      >
        {/* Accessibility: Hidden but required by Radix Dialog */}
        <SheetTitle className="sr-only">{detail?.name || symbol || 'Index Detail'}</SheetTitle>
        <SheetDescription className="sr-only">Index detail view with chart, option chain, and statistics</SheetDescription>

        {/* ═══ Header ═════════════════════════════════════════════════════════ */}
        <div className="sticky top-0 z-30 bg-[#f5f7fa]/95 backdrop-blur-md border-b border-[#e5e7eb]/20">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              {detailLoading ? (
                <Skeleton className="h-8 w-40" />
              ) : (
                <>
                  <div className={cn(
                    'flex size-10 items-center justify-center rounded-xl',
                    isPositive ? 'bg-[#00B386]/10' : 'bg-[#EB5B3C]/10'
                  )}>
                    {isPositive ? (
                      <TrendingUp className="size-5 text-[#00B386]" />
                    ) : (
                      <TrendingDown className="size-5 text-[#EB5B3C]" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#1a1a1a]">{detail?.name || symbol}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-2xl font-bold font-mono-data font-tabular text-[#1a1a1a]">
                        {detail ? formatPrice(detail.currentPrice) : '0.00'}
                      </span>
                      <span className={cn(
                        'flex items-center gap-0.5 text-sm font-semibold',
                        isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                      )}>
                        {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                        {change >= 0 ? '+' : ''}{formatPrice(detail?.change ?? 0)} ({formatPercent(detail?.changePercent ?? 0)})
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-[#6b7280] hover:text-[#1a1a1a] shrink-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>

        {/* ═══ Tabs ══════════════════════════════════════════════════════════ */}
        <div className="px-6 pt-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-[#ffffff] rounded-xl p-1 h-auto">
              <TabsTrigger
                value="chart"
                className="rounded-lg px-4 py-2 text-sm font-semibold data-[state=active]:bg-[#00D09C] data-[state=active]:text-white transition-all"
              >
                <BarChart3 className="size-4 mr-1.5" />
                Chart
              </TabsTrigger>
              <TabsTrigger
                value="stats"
                className="rounded-lg px-4 py-2 text-sm font-semibold data-[state=active]:bg-[#00D09C] data-[state=active]:text-white transition-all"
              >
                <Activity className="size-4 mr-1.5" />
                Statistics
              </TabsTrigger>
            </TabsList>

            {/* ═══ Chart Tab ════════════════════════════════════════════════ */}
            <TabsContent value="chart" className="mt-4 space-y-4">
              {/* Range Selector */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {(['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'] as RangeOption[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        range === r
                          ? 'bg-[#00D09C] text-white shadow-sm'
                          : 'text-[#6b7280] hover:bg-[#ffffff] hover:text-[#1a1a1a]'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setChartType('area')}
                    className={cn(
                      'p-2 rounded-lg transition-all',
                      chartType === 'area' ? 'bg-[#f5f7fa] text-[#00D09C]' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                    )}
                  >
                    <BarChart3 className="size-4" />
                  </button>
                  <button
                    onClick={() => setChartType('candle')}
                    className={cn(
                      'p-2 rounded-lg transition-all',
                      chartType === 'candle' ? 'bg-[#f5f7fa] text-[#00D09C]' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                    )}
                  >
                    <CandlestickChart className="size-4" />
                  </button>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-[#f5f7fa] rounded-xl p-4 border border-[#e5e7eb]/10">
                {chartLoading ? (
                  <div className="h-[350px] flex items-center justify-center">
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
                  <div className="h-[350px]">
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
                  <div className="h-[350px] flex items-center justify-center text-[#6b7280] text-sm">
                    No chart data available
                  </div>
                )}
              </div>

              {/* Quick Stats Below Chart */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox label="Open" value={detail?.open ? formatINR(detail.open) : '--'} />
                <StatBox label="High" value={detail?.high ? formatINR(detail.high) : '--'} highlight />
                <StatBox label="Low" value={detail?.low ? formatINR(detail.low) : '--'} danger />
                <StatBox label="Prev Close" value={detail?.previousClose ? formatINR(detail.previousClose) : '--'} />
              </div>
            </TabsContent>


            {/* ═══ Statistics Tab ═══════════════════════════════════════════ */}
            <TabsContent value="stats" className="mt-4 space-y-4">
              {/* Key Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
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
                <div className="bg-[#ffffff] border border-[#e5e7eb] p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-semibold text-[#1a1a1a]">Day Range</h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono font-tabular">
                      <span className="text-[#EB5B3C] font-semibold">{formatINRWhole(detail.low)}</span>
                      <span className="text-[#00B386] font-semibold">{formatINRWhole(detail.high)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#ffffff] relative overflow-hidden">
                      {(() => {
                        const range = detail.high - detail.low
                        const currentPos = range > 0 ? ((detail.currentPrice - detail.low) / range) * 100 : 50
                        return (
                          <>
                            <div
                              className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-[#eb5b3c] to-[#00B386] opacity-30"
                              style={{ width: '100%' }}
                            />
                            <div
                              className="absolute top-0 h-full w-1 bg-white rounded-full"
                              style={{ left: `${Math.min(100, Math.max(0, currentPos))}%` }}
                            />
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* 52 Week Range Bar */}
              {detail && detail.week52Low > 0 && detail.week52High > 0 && (
                <div className="bg-[#ffffff] border border-[#e5e7eb] p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-semibold text-[#1a1a1a]">52 Week Range</h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono font-tabular">
                      <span className="text-[#EB5B3C] font-semibold">{formatINRWhole(detail.week52Low)}</span>
                      <span className="text-[#00B386] font-semibold">{formatINRWhole(detail.week52High)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#ffffff] relative overflow-hidden">
                      {(() => {
                        const range = detail.week52High - detail.week52Low
                        const currentPos = range > 0 ? ((detail.currentPrice - detail.week52Low) / range) * 100 : 50
                        return (
                          <>
                            <div
                              className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-[#eb5b3c] via-[#00B386] to-[#00B386] opacity-30"
                              style={{ width: '100%' }}
                            />
                            <div
                              className="absolute top-0 h-full w-1.5 bg-white rounded-full"
                              style={{ left: `${Math.min(100, Math.max(0, currentPos))}%` }}
                            />
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Performance Metrics */}
              <div className="bg-[#ffffff] border border-[#e5e7eb] p-4 rounded-xl">
                <h4 className="text-sm font-semibold text-[#1a1a1a] mb-3">Performance</h4>
                <div className="space-y-3">
                  {detail && (
                    <>
                      <PerformanceRow label="Today" change={detail.change} changePercent={detail.changePercent} />
                      <PerformanceRow label="From Open" change={detail.currentPrice - detail.open} changePercent={detail.open > 0 ? ((detail.currentPrice - detail.open) / detail.open) * 100 : 0} />
                      <PerformanceRow label="From 52W Low" change={detail.currentPrice - detail.week52Low} changePercent={detail.week52Low > 0 ? ((detail.currentPrice - detail.week52Low) / detail.week52Low) * 100 : 0} />
                      <PerformanceRow label="From 52W High" change={detail.currentPrice - detail.week52High} changePercent={detail.week52High > 0 ? ((detail.currentPrice - detail.week52High) / detail.week52High) * 100 : 0} />
                    </>
                  )}
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-[#ffffff] border border-[#e5e7eb] p-4 rounded-xl">
                <h4 className="text-sm font-semibold text-[#1a1a1a] mb-2 flex items-center gap-2">
                  <Info className="size-4 text-[#00D09C]" />
                  Index Info
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">Exchange</span>
                    <span className="font-semibold text-[#1a1a1a]">NSE</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">Currency</span>
                    <span className="font-semibold text-[#1a1a1a]">INR (₹)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">Strike Interval</span>
                    <span className="font-semibold text-[#1a1a1a]">₹{detail?.strikeInterval || '--'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">Lot Size</span>
                    <span className="font-semibold text-[#1a1a1a]">{detail?.lotSize || '--'}</span>
                  </div>
                  {detail?.isRealData && (
                    <div className="flex justify-between">
                      <span className="text-[#6b7280]">Data Source</span>
                      <Badge className="bg-[#00B386]/10 text-[#00B386] text-[10px] font-semibold px-2 py-0.5 border-0">
                        LIVE
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>


        {/* Bottom Spacing */}
        <div className="h-20" />
      </SheetContent>
    </Sheet>
  )
}


// ─── Sub-Components ─────────────────────────────────────────────────────────

function StatBox({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className="bg-[#f5f7fa] rounded-xl p-3 border border-[#e5e7eb]/10">
      <p className="text-[10px] font-semibold text-[#6b7280] tracking-wider uppercase mb-1">{label}</p>
      <p className={cn(
        'font-mono font-tabular font-semibold text-sm',
        highlight ? 'text-[#00B386]' : danger ? 'text-[#EB5B3C]' : 'text-[#1a1a1a]'
      )}>
        {value}
      </p>
    </div>
  )
}

function StatCard({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] p-4 rounded-xl">
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

function PerformanceRow({ label, change, changePercent }: { label: string; change: number; changePercent: number }) {
  const isPositive = change >= 0
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#6b7280]">{label}</span>
      <div className="flex items-center gap-2">
        <span className={cn(
          'font-mono font-tabular text-sm font-semibold',
          isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
        )}>
          {formatPercent(change)}
        </span>
        <span className={cn(
          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold',
          isPositive
            ? 'bg-[#00B386]/10 text-[#00B386]'
            : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
        )}>
          {formatPercent(changePercent)}
        </span>
      </div>
    </div>
  )
}
