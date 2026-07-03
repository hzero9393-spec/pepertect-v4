'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  X,
  BarChart3,
  Activity,
  Zap,
  Target,
  Shield,
  Gauge,
  Waves,
  Crosshair,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice, formatINRWhole, formatPercent, formatNumber } from '@/lib/format'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StrikeOverviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Strike identity
  underlying: string
  strike: number
  optionType: 'CE' | 'PE'
  expiry: string
  instrumentKey: string
  // Live data from OC (already available, no API call)
  ltp: number
  greeks: {
    iv: number
    delta: number
    theta: number
    vega: number
    gamma: number
    pop: number
  } | null
  marketData: {
    volume: number
    oi: number
    prev_oi: number
    close_price: number
    bid_price: number
    ask_price: number
    bid_qty: number
    ask_qty: number
  } | null
  spot: number
  // Trade handler
  onTrade?: () => void
}

interface CandleData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  oi: number
}

interface ChartSummary {
  open: number
  high: number
  low: number
  close: number
  change: number
  changePercent: number
  totalVolume: number
}

type RangeOption = '1D' | '1W' | '1M'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatChartDate(dateStr: string, range: RangeOption): string {
  const d = new Date(dateStr)
  if (range === '1D') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1W') return d.toLocaleDateString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

function formatExpiry(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Chart Tooltip ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, range }: { active?: boolean; payload?: Array<{ payload: CandleData }>; label?: string; range: RangeOption }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const isUp = d.close >= d.open
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-xl text-xs">
      <div className="font-semibold text-gray-900 mb-1.5">{formatChartDate(d.date, range)}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-gray-500">O</span>
        <span className="font-mono text-right tabular-nums">{formatPrice(d.open)}</span>
        <span className="text-gray-500">H</span>
        <span className="font-mono text-right tabular-nums">{formatPrice(d.high)}</span>
        <span className="text-gray-500">L</span>
        <span className="font-mono text-right tabular-nums">{formatPrice(d.low)}</span>
        <span className="text-gray-500">C</span>
        <span className={cn('font-mono text-right font-semibold tabular-nums', isUp ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>
          {formatPrice(d.close)}
        </span>
        {d.volume > 0 && (
          <>
            <span className="text-gray-500">Vol</span>
            <span className="font-mono text-right tabular-nums">{formatNumber(d.volume)}</span>
          </>
        )}
        {d.oi > 0 && (
          <>
            <span className="text-gray-500">OI</span>
            <span className="font-mono text-right tabular-nums">{formatNumber(d.oi)}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Greeks Card ────────────────────────────────────────────────────────────

function GreeksCard({ greeks }: { greeks: NonNullable<StrikeOverviewProps['greeks']> }) {
  const items = [
    { label: 'Delta', value: greeks.delta.toFixed(3), icon: Target, color: '#3B82F6', desc: greeks.delta > 0 ? 'Intrinsic direction' : 'Inverse direction' },
    { label: 'Theta', value: greeks.theta.toFixed(2), icon: Clock, color: '#F59E0B', desc: 'Daily time decay' },
    { label: 'Vega', value: greeks.vega.toFixed(2), icon: Waves, color: '#8B5CF6', desc: 'IV sensitivity' },
    { label: 'Gamma', value: greeks.gamma.toFixed(4), icon: Gauge, color: '#EC4899', desc: 'Delta acceleration' },
    { label: 'IV', value: (greeks.iv * 100).toFixed(1) + '%', icon: Zap, color: '#F97316', desc: 'Implied volatility' },
    { label: 'POP', value: (greeks.pop * 100).toFixed(1) + '%', icon: Crosshair, color: '#06B6D4', desc: 'Probability of profit' },
  ]

  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map(item => (
        <div
          key={item.label}
          className="bg-white rounded-xl p-3 border border-gray-100 hover:shadow-sm transition-shadow"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <div
              className="size-6 rounded-lg flex items-center justify-center"
              style={{ background: `${item.color}10` }}
            >
              <item.icon className="size-3.5" style={{ color: item.color }} />
            </div>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{item.label}</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-gray-900">{item.value}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{item.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function StrikeOverviewDrawer({
  open,
  onOpenChange,
  underlying,
  strike,
  optionType,
  expiry,
  instrumentKey,
  ltp,
  greeks,
  marketData,
  spot,
  onTrade,
}: StrikeOverviewProps) {
  const [range, setRange] = useState<RangeOption>('1D')
  const [chartData, setChartData] = useState<CandleData[]>([])
  const [summary, setSummary] = useState<ChartSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chart')

  // Derived
  const isCall = optionType === 'CE'
  const isITM = isCall ? spot > strike : spot < strike
  const oiChange = marketData ? marketData.oi - marketData.prev_oi : 0
  const dayChange = marketData ? ltp - marketData.close_price : 0
  const dayChangePercent = marketData?.close_price ? (dayChange / marketData.close_price) * 100 : 0

  // Fetch chart data
  useEffect(() => {
    if (!open || !instrumentKey) return
    setLoading(true)
    fetch(`/api/options/strike-detail?instrument_key=${encodeURIComponent(instrumentKey)}&range=${range}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          setChartData(json.data.candles || [])
          setSummary(json.data.summary || null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, instrumentKey, range])

  // Reset on open
  useEffect(() => {
    if (open) {
      setRange('1D')
      setActiveTab('chart')
    }
  }, [open])

  // Chart formatting
  const chartFormatted = useMemo(() =>
    chartData.map(d => ({
      ...d,
      dateLabel: formatChartDate(d.date, range),
    })),
    [chartData, range]
  )

  const chartMinMax = useMemo(() => {
    if (!chartFormatted.length) return { min: 0, max: 0 }
    const prices = chartFormatted.flatMap(d => [d.high, d.low])
    return { min: Math.min(...prices) * 0.998, max: Math.max(...prices) * 1.002 }
  }, [chartFormatted])

  const isPositive = (summary?.change ?? dayChange) >= 0
  const gradientId = `strike-${instrumentKey}`

  const displayChange = summary?.change ?? dayChange
  const displayChangePercent = summary?.changePercent ?? dayChangePercent

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[680px] md:max-w-[780px] p-0 gap-0 bg-[#f5f7fa] border-l border-gray-200/50 overflow-y-auto [&>button]:hidden"
      >
        <SheetTitle className="sr-only">{underlying} {strike} {optionType} Overview</SheetTitle>
        <SheetDescription className="sr-only">Strike price overview with chart, Greeks, and OI data</SheetDescription>

        {/* ═══ Sticky Header ═══════════════════════════════════════════════ */}
        <div className="sticky top-0 z-30 bg-[#f5f7fa]/95 backdrop-blur-md border-b border-gray-200/50">
          <div className="flex items-start justify-between px-6 py-4">
            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-gray-900 truncate">
                  {underlying} {formatExpiry(expiry)} {strike} {optionType}
                </h2>
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                  isITM ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                )}>
                  {isITM ? 'ITM' : 'OTM'}
                </span>
              </div>

              {/* Price + Change */}
              <div className="flex items-baseline gap-2.5">
                <span className="text-[28px] font-bold font-mono tabular-nums text-gray-900 leading-none">
                  {formatPrice(ltp)}
                </span>
                <span className={cn(
                  'flex items-center gap-0.5 text-sm font-semibold',
                  isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                )}>
                  {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                  {displayChange >= 0 ? '+' : ''}{formatPrice(displayChange)} ({formatPercent(displayChangePercent)})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-4">
              {onTrade && (
                <Button
                  size="sm"
                  className="bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-xl px-4 h-9 text-sm"
                  onClick={onTrade}
                >
                  Trade
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-gray-900 h-9 w-9"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ Quick Stats Bar ══════════════════════════════════════════════ */}
        <div className="px-6 py-3 border-b border-gray-200/30 bg-white/50">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Spot</div>
              <div className="text-sm font-bold font-mono tabular-nums text-gray-900 mt-0.5">{formatPrice(spot)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Volume</div>
              <div className="text-sm font-bold font-mono tabular-nums text-gray-900 mt-0.5">
                {marketData ? formatNumber(marketData.volume) : '-'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">OI</div>
              <div className="text-sm font-bold font-mono tabular-nums text-gray-900 mt-0.5">
                {marketData ? formatNumber(marketData.oi) : '-'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">OI Chg</div>
              <div className={cn('text-sm font-bold font-mono tabular-nums mt-0.5', oiChange >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>
                {marketData ? (oiChange >= 0 ? '+' : '') + formatNumber(oiChange) : '-'}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Tabs ══════════════════════════════════════════════════════════ */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-1 bg-white rounded-xl p-1 mb-4">
            <button
              onClick={() => setActiveTab('chart')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all',
                activeTab === 'chart' ? 'bg-[#00D09C] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
              )}
            >
              <BarChart3 className="size-4" />
              Chart
            </button>
            <button
              onClick={() => setActiveTab('greeks')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all',
                activeTab === 'greeks' ? 'bg-[#00D09C] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
              )}
            >
              <Activity className="size-4" />
              Greeks
            </button>
            <button
              onClick={() => setActiveTab('oi')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all',
                activeTab === 'oi' ? 'bg-[#00D09C] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
              )}
            >
              <Shield className="size-4" />
              OI & Volume
            </button>
          </div>

          {/* ═══ Chart Tab ════════════════════════════════════════════════ */}
          {activeTab === 'chart' && (
            <div className="space-y-4 pb-6">
              {/* Range Selector */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {(['1D', '1W', '1M'] as RangeOption[]).map(r => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        range === r
                          ? 'bg-[#00D09C] text-white shadow-sm'
                          : 'text-gray-500 hover:bg-white hover:text-gray-900'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {summary && (
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>O: <b className="text-gray-900 font-mono tabular-nums">{formatPrice(summary.open)}</b></span>
                    <span>H: <b className="text-gray-900 font-mono tabular-nums">{formatPrice(summary.high)}</b></span>
                    <span>L: <b className="text-gray-900 font-mono tabular-nums">{formatPrice(summary.low)}</b></span>
                    <span>C: <b className={cn('font-mono tabular-nums', isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]')}>{formatPrice(summary.close)}</b></span>
                  </div>
                )}
              </div>

              {/* Chart Area */}
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                {loading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex gap-1.5">
                        <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="size-2 rounded-full bg-[#00D09C] animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-xs text-gray-400">Loading chart...</span>
                    </div>
                  </div>
                ) : chartFormatted.length > 0 ? (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartFormatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={isPositive ? '#00B386' : '#eb5b3c'} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={isPositive ? '#00B386' : '#eb5b3c'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.08)" />
                        <XAxis
                          dataKey="dateLabel"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          axisLine={{ stroke: 'rgba(128,128,128,0.15)' }}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={[chartMinMax.min, chartMinMax.max]}
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v: number) => formatINRWhole(v)}
                          width={50}
                        />
                        <Tooltip content={<ChartTooltip range={range} />} />
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
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="text-center">
                      <BarChart3 className="size-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No chart data available</p>
                      <p className="text-xs text-gray-300 mt-1">Data may not be available for this range</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Volume bars (1D only) */}
              {range === '1D' && chartFormatted.length > 0 && (
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Volume</div>
                  <div className="h-[80px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartFormatted} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                        <Bar
                          dataKey="volume"
                          fill="#CBD5E1"
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={false}
                        />
                        <XAxis dataKey="dateLabel" hide />
                        <YAxis hide />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            return (
                              <div className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-lg text-xs">
                                <span className="text-gray-500">Vol: </span>
                                <span className="font-mono font-semibold">{formatNumber(payload[0].value as number)}</span>
                              </div>
                            )
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ Greeks Tab ════════════════════════════════════════════════ */}
          {activeTab === 'greeks' && (
            <div className="space-y-4 pb-6">
              {greeks ? (
                <GreeksCard greeks={greeks} />
              ) : (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Activity className="size-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Greeks not available</p>
                    <p className="text-xs text-gray-300 mt-1">Market may be closed</p>
                  </div>
                </div>
              )}

              {/* Bid/Ask Spread */}
              {marketData && (
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Bid / Ask Spread</div>
                  <div className="flex items-center justify-between">
                    <div className="text-center flex-1">
                      <div className="text-[10px] text-gray-400 mb-1">Bid</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-[#EB5B3C]">{formatPrice(marketData.bid_price)}</div>
                      <div className="text-[10px] text-gray-400">Qty: {formatNumber(marketData.bid_qty)}</div>
                    </div>
                    <div className="px-4">
                      <div className="text-[10px] text-gray-300 font-mono tabular-nums">
                        {formatPrice(marketData.ask_price - marketData.bid_price)}
                      </div>
                      <div className="text-[9px] text-gray-300 text-center">Spread</div>
                    </div>
                    <div className="text-center flex-1">
                      <div className="text-[10px] text-gray-400 mb-1">Ask</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-[#00B386]">{formatPrice(marketData.ask_price)}</div>
                      <div className="text-[10px] text-gray-400">Qty: {formatNumber(marketData.ask_qty)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ OI & Volume Tab ══════════════════════════════════════════ */}
          {activeTab === 'oi' && (
            <div className="space-y-3 pb-6">
              {marketData ? (
                <>
                  {/* OI Card */}
                  <div className="bg-white rounded-xl p-4 border border-gray-100">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Open Interest</div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-[10px] text-gray-400">Current OI</div>
                        <div className="text-base font-bold font-mono tabular-nums text-gray-900 mt-0.5">
                          {formatNumber(marketData.oi)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">Previous OI</div>
                        <div className="text-base font-bold font-mono tabular-nums text-gray-900 mt-0.5">
                          {formatNumber(marketData.prev_oi)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400">OI Change</div>
                        <div className={cn(
                          'text-base font-bold font-mono tabular-nums mt-0.5',
                          oiChange >= 0 ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                        )}>
                          {oiChange >= 0 ? '+' : ''}{formatNumber(oiChange)}
                          <span className="text-[10px] font-normal ml-1">
                            ({marketData.prev_oi > 0 ? ((oiChange / marketData.prev_oi) * 100).toFixed(1) : '0'}%)
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* OI Change Bar */}
                    <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', oiChange >= 0 ? 'bg-[#00B386]' : 'bg-[#EB5B3C]')}
                        style={{ width: `${Math.min(100, marketData.prev_oi > 0 ? Math.abs((oiChange / marketData.prev_oi) * 100) : 0)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                      <span>{oiChange >= 0 ? 'Long Buildup / Short Covering' : 'Short Buildup / Long Unwinding'}</span>
                      <span>{dayChange >= 0 ? 'Price ↑' : 'Price ↓'}</span>
                    </div>
                  </div>

                  {/* Volume Card */}
                  <div className="bg-white rounded-xl p-4 border border-gray-100">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Volume</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-gray-900">
                      {formatNumber(marketData.volume)}
                    </div>
                    {summary?.totalVolume && summary.totalVolume > 0 && (
                      <div className="mt-1 text-[10px] text-gray-400">
                        Total ({range}): {formatNumber(summary.totalVolume)}
                      </div>
                    )}
                  </div>

                  {/* Sentiment */}
                  <div className="bg-white rounded-xl p-4 border border-gray-100">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">OI-Price Sentiment</div>
                    <div className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold',
                      oiChange >= 0 && dayChange >= 0 ? 'bg-green-50 text-[#00B386]' :
                      oiChange < 0 && dayChange < 0 ? 'bg-red-50 text-[#EB5B3C]' :
                      'bg-yellow-50 text-yellow-600'
                    )}>
                      {oiChange >= 0 && dayChange >= 0 && <><TrendingUp className="size-4" /> Long Buildup — Bullish</>}
                      {oiChange < 0 && dayChange < 0 && <><TrendingDown className="size-4" /> Long Unwinding — Bearish</>}
                      {oiChange >= 0 && dayChange < 0 && <><Activity className="size-4" /> Short Covering — Mildly Bullish</>}
                      {oiChange < 0 && dayChange >= 0 && <><Activity className="size-4" /> Short Buildup — Mildly Bearish</>}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Shield className="size-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">OI data not available</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}