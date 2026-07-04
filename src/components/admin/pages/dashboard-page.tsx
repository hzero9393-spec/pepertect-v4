'use client'

import { useState, useEffect } from 'react'
import {
  Users, Crown, UserCheck, Activity, TrendingUp, IndianRupee, ArrowUpDown,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  type DashboardData,
  adminApi, formatINR, formatTimeAgo,
  mockUserGrowth, mockDailyTrades, mockRevenueTrend,
  generateMockTrades
} from '@/components/admin/shared'

/* ─── Color Palette ──────────────────────────────────────────────────────────── */
const C = {
  primary: '#00D09C',
  secondary: '#3B82F6',
  warning: '#F59E0B',
  purple: '#8B5CF6',
  loss: '#eb5b3c',
}

/* ─── KPI Configuration ──────────────────────────────────────────────────────── */
const kpiDefs = [
  { key: 'totalUsers', label: 'Total Users', icon: Users, color: C.primary, trend: 12.5, up: true, spark: [280, 340, 390, 480, 560, 730, 856, 960, 1050, 1130, 1248, 1310] },
  { key: 'activeUsers', label: 'Active Users', icon: Activity, color: C.secondary, trend: 8.3, up: true, spark: [480, 540, 600, 650, 710, 760, 790, 810, 830, 840, 848, 856] },
  { key: 'paidUsers', label: 'Paid Users', icon: Crown, color: C.warning, trend: 15.2, up: true, spark: [120, 135, 148, 162, 175, 188, 198, 208, 215, 222, 228, 234] },
  { key: 'freeUsers', label: 'Free Users', icon: UserCheck, color: C.purple, trend: 11.1, up: true, spark: [680, 740, 800, 860, 910, 960, 1000, 1020, 1040, 1055, 1068, 1076] },
  { key: 'conversionRate', label: 'Conversion Rate', icon: TrendingUp, color: C.primary, trend: 3.4, up: true, spark: [11.2, 12.0, 12.8, 13.5, 14.6, 15.2, 15.8, 16.3, 16.8, 17.2, 17.6, 17.9] },
  { key: 'totalRevenue', label: 'Revenue', icon: IndianRupee, color: C.warning, trend: 22.1, up: true, spark: [28, 35, 42, 48, 52, 58, 62, 68, 74, 78, 82, 88] },
  { key: 'totalTrades', label: 'Total Trades', icon: ArrowUpDown, color: C.secondary, trend: 18.7, up: true, spark: [2100, 2600, 3100, 3500, 3900, 4300, 4600, 4900, 5100, 5250, 5380, 5432] },
] as const

/* ─── Sparkline Component ────────────────────────────────────────────────────── */
function Sparkline({ data, color }: { data: readonly number[]; color: string }) {
  const points = data.slice(-7).map((v, i) => ({ v, i }))
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* ─── Custom Tooltips ────────────────────────────────────────────────────────── */
function CountTooltip({ active, payload, label }: any) {
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

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="text-[#6b7280] mb-0.5">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} className="font-mono font-semibold" style={{ color: e.color }}>
          Revenue: {formatINR(e.value)}
        </p>
      ))}
    </div>
  )
}

/* ─── Avatar Color Utility ───────────────────────────────────────────────────── */
function avatarColor(name: string) {
  const palette = [C.primary, C.secondary, C.warning, C.purple, C.loss, '#06B6D4', '#EC4899', '#14B8A6']
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

/* ─── Main Component ─────────────────────────────────────────────────────────── */
function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi('/dashboard')
        const d = await res.json()
        setData(d)
      } catch {
        try {
          setData({
            totalUsers: 1310,
            activeUsers: 856,
            paidUsers: 234,
            freeUsers: 1076,
            conversionRate: 17.9,
            totalRevenue: 88200,
            totalTrades: 5432,
            userGrowth: mockUserGrowth,
            recentTrades: generateMockTrades(120).slice(0, 10),
            recentActivity: [
              { user: 'Arjun Mehta', action: 'Bought', symbol: 'NIFTY 23500 CE', time: '2m ago' },
              { user: 'Priya Sharma', action: 'Sold', symbol: 'RELIANCE', time: '5m ago' },
              { user: 'Rahul Verma', action: 'Bought', symbol: 'BANKNIFTY 50000 PE', time: '8m ago' },
              { user: 'Sneha Patel', action: 'Subscribed', symbol: 'Premium Plan', time: '12m ago' },
              { user: 'Vikram Singh', action: 'Sold', symbol: 'TCS', time: '15m ago' },
              { user: 'Ananya Iyer', action: 'Bought', symbol: 'HDFCBANK', time: '22m ago' },
              { user: 'Kavita Reddy', action: 'Sold', symbol: 'INFY', time: '28m ago' },
            ],
          })
        } catch {
          setData({
            totalUsers: 0, activeUsers: 0, paidUsers: 0, freeUsers: 0,
            conversionRate: 0, totalRevenue: 0, totalTrades: 0,
            userGrowth: [], recentTrades: [], recentActivity: [],
          })
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  /* ── Loading Skeleton ── */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[300px] rounded-xl" />
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Skeleton className="h-[420px] rounded-xl lg:col-span-3" />
          <Skeleton className="h-[420px] rounded-xl lg:col-span-2" />
        </div>
      </div>
    )
  }

  if (!data) return null

  const growthData = data.userGrowth?.length ? data.userGrowth : mockUserGrowth

  const values: Record<string, number> = {
    totalUsers: data.totalUsers,
    activeUsers: data.activeUsers,
    paidUsers: data.paidUsers,
    freeUsers: data.freeUsers,
    conversionRate: data.conversionRate,
    totalRevenue: data.totalRevenue,
    totalTrades: data.totalTrades,
  }

  const getValue = (key: string): string => {
    const v = values[key] ?? 0
    if (key === 'conversionRate') return `${v}%`
    if (key === 'totalRevenue') return formatINR(v)
    return v.toLocaleString('en-IN')
  }

  /* ── Render ── */
  return (
    <div className="space-y-6">
      {/* ════════════════════════ 7 KPI STAT CARDS ════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {kpiDefs.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.key} className="bg-white border-[#e5e7eb] rounded-xl hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                {/* Icon + Trend */}
                <div className="flex items-start justify-between">
                  <div
                    className="flex size-9 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${kpi.up ? 'text-[#00a87d]' : 'text-[#eb5b3c]'}`}>
                    {kpi.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                    {kpi.trend}%
                  </div>
                </div>
                {/* Label + Value */}
                <p className="mt-3 text-xs font-medium text-[#6b7280]">{kpi.label}</p>
                <p className="font-mono text-lg font-bold text-[#1a1a1a] mt-0.5">{getValue(kpi.key)}</p>
                {/* Sparkline */}
                <div className="mt-2 -mx-1">
                  <Sparkline data={kpi.spark} color={kpi.color} />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ════════════════════════ CHARTS ROW 1 ════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── User Growth AreaChart ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">User Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={growthData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ugGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CountTooltip />} />
                <Area type="monotone" dataKey="count" name="Users" stroke={C.primary} strokeWidth={2.5} fill="url(#ugGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Revenue Trend BarChart ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={mockRevenueTrend} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.secondary} stopOpacity={1} />
                    <stop offset="100%" stopColor={C.secondary} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" name="Revenue" fill="url(#revGrad)" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ════════════════════════ DAILY TRADING VOLUME ════════════════════════ */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Daily Trading Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={mockDailyTrades} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CountTooltip />} />
              <Line
                type="monotone"
                dataKey="trades"
                name="Trades"
                stroke={C.purple}
                strokeWidth={2.5}
                dot={{ r: 5, fill: C.purple, strokeWidth: 2.5, stroke: '#fff' }}
                activeDot={{ r: 7, fill: C.purple, stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ════════════════════════ RECENT TRADES + LIVE ACTIVITY ════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Recent Trades Table ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#e5e7eb] hover:bg-transparent">
                    <TableHead className="text-[#6b7280] text-xs">User</TableHead>
                    <TableHead className="text-[#6b7280] text-xs">Symbol</TableHead>
                    <TableHead className="text-[#6b7280] text-xs">Direction</TableHead>
                    <TableHead className="text-right text-[#6b7280] text-xs">P&L</TableHead>
                    <TableHead className="text-right text-[#6b7280] text-xs">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.recentTrades || []).map((t, i) => (
                    <TableRow key={t.id || i} className="border-[#f0f2f5] hover:bg-[#f7f8fc]">
                      <TableCell className="font-medium text-[#1a1a1a] text-xs">{t.userName}</TableCell>
                      <TableCell className="font-mono text-xs text-[#1a1a1a]">{t.symbol}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold ${
                            t.direction === 'BUY'
                              ? 'border-[#00d09c]/30 bg-[#00d09c]/10 text-[#00a87d]'
                              : 'border-[#eb5b3c]/30 bg-[#eb5b3c]/10 text-[#d44a2d]'
                          }`}
                        >
                          {t.direction}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${
                          (t.pnl ?? 0) >= 0 ? 'text-[#00a87d]' : 'text-[#d44a2d]'
                        }`}
                      >
                        {t.pnl !== undefined ? formatINR(t.pnl) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-[#9ca3af]">
                        {formatTimeAgo(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ── Live Activity Feed ── */}
        <Card className="bg-white border-[#e5e7eb] rounded-xl lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Live Activity</CardTitle>
              <span className="flex items-center gap-1.5 text-[11px] text-[#00D09C] font-medium">
                <span className="size-1.5 rounded-full bg-[#00D09C] animate-pulse" />
                Live
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {(data.recentActivity || [
                { user: 'Arjun Mehta', action: 'Bought', symbol: 'NIFTY 23500 CE', time: '2m ago' },
                { user: 'Priya Sharma', action: 'Sold', symbol: 'RELIANCE', time: '5m ago' },
                { user: 'Rahul Verma', action: 'Bought', symbol: 'BANKNIFTY 50000 PE', time: '8m ago' },
                { user: 'Sneha Patel', action: 'Subscribed', symbol: 'Premium Plan', time: '12m ago' },
                { user: 'Vikram Singh', action: 'Sold', symbol: 'TCS', time: '15m ago' },
                { user: 'Ananya Iyer', action: 'Bought', symbol: 'HDFCBANK', time: '22m ago' },
                { user: 'Kavita Reddy', action: 'Sold', symbol: 'INFY', time: '28m ago' },
              ]).map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-[#f5f5f5] last:border-b-0">
                  <div
                    className="flex size-8 items-center justify-center rounded-full text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: avatarColor(item.user) }}
                  >
                    {initials(item.user)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#1a1a1a] leading-snug">
                      <span className="font-semibold">{item.user}</span>{' '}
                      <span className="text-[#6b7280]">{item.action}</span>
                    </p>
                    <p className="text-[11px] font-mono text-[#6b7280] truncate mt-0.5">{item.symbol}</p>
                  </div>
                  <span className="text-[11px] text-[#9ca3af] shrink-0 mt-0.5">{item.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DashboardPage