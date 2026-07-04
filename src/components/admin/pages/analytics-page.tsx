'use client'

import { useState, useEffect } from 'react'
import {
  TrendingUp, Target, Activity, Trophy, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
  adminApi, formatINR,
  mockWinRate, mockTradeFreq, mockTopStocks, mockPeakHours,
  mockConversionFunnel, mockRevenueTrend, mockUserGrowth
} from '@/components/admin/shared'

/* ─── Color Palette ──────────────────────────────────────────────────────────── */
const C = {
  primary: '#00D09C',
  secondary: '#3B82F6',
  warning: '#F59E0B',
  purple: '#8B5CF6',
  loss: '#eb5b3c',
}

/* ─── KPI Card Definitions ───────────────────────────────────────────────────── */
const kpiDefs = [
  { label: 'Avg P&L per User', value: '₹12,450', sub: '+8.2% vs last month', icon: TrendingUp, color: C.primary, pct: '+8.2%', up: true },
  { label: 'Best Performing Stock', value: 'RELIANCE', sub: '+18.4% avg return', icon: Trophy, color: C.warning, pct: '+18.4%', up: true },
  { label: 'Platform Win Rate', value: '62.3%', sub: '+2.1% vs last month', icon: Target, color: C.secondary, pct: '+2.1%', up: true },
  { label: 'Trades Today', value: '485', sub: '+18% vs yesterday', icon: Activity, color: C.purple, pct: '+18%', up: true },
] as const

/* ─── Derived Data ───────────────────────────────────────────────────────────── */
const topStockRanked = mockTopStocks.map((s, i) => ({
  ...s,
  label: `#${i + 1}  ${s.symbol}`,
}))

const pieData = [
  { name: 'PREMIUM', value: 234, color: C.warning },
  { name: 'FREE', value: 1076, color: C.secondary },
]

const revenueAnalytics = mockRevenueTrend.map((r, i) => ({
  month: r.month,
  revenue: r.revenue,
  users: mockUserGrowth[i]?.count ?? 0,
}))

const funnelColors = [C.primary, C.secondary, C.purple, C.warning, C.loss]
const funnelMax = mockConversionFunnel[0].value

/* ─── Custom Tooltip ─────────────────────────────────────────────────────────── */
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="text-[#6b7280] mb-0.5">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} className="font-mono font-semibold" style={{ color: e.color }}>
          {e.name}: {e.value.toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

function RevenueTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="text-[#6b7280] mb-0.5">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} className="font-mono font-semibold" style={{ color: e.color }}>
          {e.name}: {e.name === 'Revenue' ? formatINR(e.value) : e.value.toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

/* ─── Pie Custom Label ───────────────────────────────────────────────────────── */
const RAD = Math.PI / 180
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RAD)
  const y = cy + r * Math.sin(-midAngle * RAD)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

/* ─── Legend Formatter ───────────────────────────────────────────────────────── */
const legendFormatter = (value: string) => (
  <span className="text-xs text-[#374151]">{value}</span>
)

/* ═══════════════════════════════════════════════════════════════════════════════ */
function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [_analytics, setAnalytics] = useState<any>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi('/analytics')
        const data = await res.json()
        setAnalytics(data)
      } catch {
        setAnalytics({ source: 'mock' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
      </div>
    )
  }

  /* ── Render ── */
  return (
    <div className="space-y-6">
      {/* ════════════════════════ 4 KPI STAT CARDS ════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiDefs.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label} className="bg-white border-[#e5e7eb] rounded-xl hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div
                    className="flex size-9 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${kpi.up ? 'text-[#00a87d]' : 'text-[#eb5b3c]'}`}>
                    {kpi.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                    {kpi.pct}
                  </div>
                </div>
                <p className="mt-3 text-xs font-medium text-[#6b7280]">{kpi.label}</p>
                <p className="font-mono text-lg font-bold text-[#1a1a1a] mt-0.5">{kpi.value}</p>
                {kpi.sub && <p className="text-[11px] text-[#9ca3af] mt-0.5">{kpi.sub}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ════════════════════════ WIN RATE + TRADE FREQUENCY ════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Win Rate Distribution (Horizontal BarChart) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Win Rate Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mockWinRate} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="wrGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.7} />
                    <stop offset="100%" stopColor={C.primary} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="range"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="users" name="Users" fill="url(#wrGrad)" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Trade Frequency (BarChart) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Trade Frequency</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mockTradeFreq} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="tfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.secondary} stopOpacity={1} />
                    <stop offset="100%" stopColor={C.secondary} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="users" name="Users" fill="url(#tfGrad)" radius={[4, 4, 0, 0]} barSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ════════════════════════ TOP TRADED STOCKS + PEAK HOURS ════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Top Traded Stocks (Horizontal BarChart with Rank) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Top Traded Stocks</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topStockRanked} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="tsGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={C.warning} stopOpacity={0.65} />
                    <stop offset="100%" stopColor={C.warning} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="trades" name="Trades" fill="url(#tsGrad)" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Peak Trading Hours (AreaChart) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Peak Trading Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={mockPeakHours} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="phGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.purple} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.purple} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="trades" name="Trades" stroke={C.purple} strokeWidth={2.5} fill="url(#phGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ════════════════════════ CONVERSION FUNNEL ════════════════════════ */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Conversion Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-w-3xl mx-auto">
            {mockConversionFunnel.map((item, i) => {
              const prev = i > 0 ? mockConversionFunnel[i - 1].value : item.value
              const dropOff = i > 0 ? (((prev - item.value) / prev) * 100).toFixed(1) : null
              const pct = ((item.value / funnelMax) * 100).toFixed(1)
              return (
                <div key={item.stage} className="flex items-center gap-4">
                  <span className="text-xs font-medium text-[#6b7280] w-32 shrink-0">{item.stage}</span>
                  <div className="flex-1 h-9 rounded-lg bg-[#f5f5f5] overflow-hidden relative">
                    <div
                      className="h-full rounded-lg flex items-center justify-end pr-3 transition-all duration-700"
                      style={{
                        width: `${Math.max(6, parseFloat(pct))}%`,
                        backgroundColor: funnelColors[i],
                      }}
                    >
                      <span className="text-[11px] font-mono font-bold text-white">{item.value.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold text-[#1a1a1a] w-14 text-right">{pct}%</span>
                  {dropOff !== null && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold border-[#eb5b3c]/30 bg-[#eb5b3c]/10 text-[#d44a2d] w-16 justify-center"
                    >
                      -{dropOff}%
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ════════════════════════ USER SEGMENTS + REVENUE ANALYTICS ════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── User Segments (PieChart) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">User Segments</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={65}
                  outerRadius={105}
                  paddingAngle={4}
                  dataKey="value"
                  label={PieLabel}
                  labelLine={false}
                >
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val: number, name: string) => [val.toLocaleString('en-IN'), name]}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  formatter={legendFormatter}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Revenue Analytics (Dual Axis: Bars = Users, Line = Revenue) ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Revenue Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={revenueAnalytics} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="raBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.secondary} stopOpacity={0.85} />
                    <stop offset="100%" stopColor={C.secondary} stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<RevenueTip />} />
                <Legend
                  verticalAlign="top"
                  iconType="circle"
                  iconSize={8}
                  formatter={legendFormatter}
                />
                <Bar yAxisId="left" dataKey="users" name="Users" fill="url(#raBarGrad)" radius={[3, 3, 0, 0]} barSize={22} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke={C.warning}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: C.warning, strokeWidth: 2, stroke: '#fff' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default AnalyticsPage