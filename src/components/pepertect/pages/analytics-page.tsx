'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Landmark,
  TrendingUp,
  CalendarDays,
  Star,
  AlertTriangle,
  Download,
  Maximize2,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { formatINR, formatPnL, formatLargeNumber } from '@/lib/format'

const portfolioData = [
  { date: 'Jan', value: 980000, change: 0 },
  { date: 'Feb', value: 1020000, change: 40000 },
  { date: 'Mar', value: 995000, change: -25000 },
  { date: 'Apr', value: 1050000, change: 55000 },
  { date: 'May', value: 1085000, change: 35000 },
  { date: 'Jun', value: 1070000, change: -15000 },
  { date: 'Jul', value: 1120000, change: 50000 },
  { date: 'Aug', value: 1150000, change: 30000 },
  { date: 'Sep', value: 1130000, change: -20000 },
  { date: 'Oct', value: 1195000, change: 65000 },
  { date: 'Nov', value: 1210000, change: 15000 },
  { date: 'Dec', value: 1245670, change: 35670 },
]

const timeRanges = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const

const metrics = [
  {
    label: 'Total P&L',
    value: '+₹2,45,670.00',
    badge: '+12%',
    badgeVariant: 'secondary' as const,
    icon: Landmark,
    positive: true,
  },
  {
    label: 'Percentage Gain',
    value: '+24.8%',
    badge: null,
    badgeVariant: 'secondary' as const,
    icon: TrendingUp,
    positive: true,
  },
  {
    label: 'Annualized Return',
    value: '18.4% p.a.',
    badge: null,
    badgeVariant: 'secondary' as const,
    icon: CalendarDays,
    positive: true,
  },
  {
    label: 'Best Day (Oct 12)',
    value: '+₹45,200',
    badge: null,
    badgeVariant: 'secondary' as const,
    icon: Star,
    positive: true,
  },
  {
    label: 'Max Drawdown',
    value: '-4.2%',
    badge: null,
    badgeVariant: 'destructive' as const,
    icon: AlertTriangle,
    positive: false,
  },
]

const adjustments = [
  {
    instrument: 'RELIANCE',
    name: 'Reliance Industries',
    type: 'Buy' as const,
    quantity: 50,
    price: '₹2,945.50',
    change: '+₹450.00',
    positive: true,
  },
  {
    instrument: 'TCS',
    name: 'Tata Consultancy',
    type: 'Sell' as const,
    quantity: 20,
    price: '₹3,812.30',
    change: '-₹120.30',
    positive: false,
  },
  {
    instrument: 'HDFCBANK',
    name: 'HDFC Bank',
    type: 'Buy' as const,
    quantity: 30,
    price: '₹1,645.20',
    change: '+₹1,240.00',
    positive: true,
  },
  {
    instrument: 'INFY',
    name: 'Infosys',
    type: 'Buy' as const,
    quantity: 25,
    price: '₹1,523.90',
    change: '+₹890.00',
    positive: true,
  },
  {
    instrument: 'ITC',
    name: 'ITC Limited',
    type: 'Sell' as const,
    quantity: 15,
    price: '₹456.25',
    change: '-₹230.50',
    positive: false,
  },
]

const allocationData = [
  { name: 'Technology', value: 60, color: '#f59e0b' },
  { name: 'Energy', value: 25, color: '#10b981' },
  { name: 'Finance', value: 15, color: '#ef4444' },
]

const areaChartConfig: ChartConfig = {
  value: { label: 'Portfolio Value', color: '#f59e0b' },
  change: { label: 'Change', color: '#10b981' },
}

const pieChartConfig: ChartConfig = {
  Technology: { label: 'Technology', color: '#f59e0b' },
  Energy: { label: 'Energy', color: '#10b981' },
  Finance: { label: 'Finance', color: '#ef4444' },
}

function CustomAreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  const change = portfolioData.find((d) => d.date === label)?.change ?? 0
  return (
    <div className="bg-[#111827] border border-[#1f2937] rounded-lg px-4 py-3 shadow-xl">
      <p className="text-gray-400 text-xs font-medium">{label}</p>
      <p className="font-mono text-white text-lg font-semibold">
        {formatINR(value ?? 0)}
      </p>
      <p className={`font-mono text-xs font-medium ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPnL(change)}
      </p>
    </div>
  )
}

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState<(typeof timeRanges)[number]>('1D')

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Performance History
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Track your portfolio performance and analytics over time
            </p>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] inline-flex items-center gap-1 rounded-full p-1">
            {timeRanges.map((range) => (
              <button
                key={range}
                onClick={() => setActiveRange(range)}
                className={`tab-transition rounded-full px-3 py-1.5 text-xs font-semibold ${
                  activeRange === range
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-gray-400 hover:bg-[#1a2332]'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </header>

        {/* Hero Chart */}
        <Card className="bg-[#111827] border border-[#1f2937] overflow-hidden rounded-2xl shadow-lg">
          <CardHeader className="flex flex-row items-start justify-between pb-0">
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-400">Portfolio Value</p>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-3xl font-bold text-white sm:text-4xl">
                  ₹12,45,670.00
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                  <ArrowUpRight className="size-3" />
                  +2.4%
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8 rounded-lg text-gray-400 hover:bg-[#1a2332]">
                <Download className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8 rounded-lg text-gray-400 hover:bg-[#1a2332]">
                <Maximize2 className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <ChartContainer config={areaChartConfig} className="mt-2 h-[320px] w-full sm:h-[380px]">
              <AreaChart data={portfolioData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" opacity={0.4} vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v: number) => formatLargeNumber(v)} width={55} />
                <RechartsTooltip content={<CustomAreaTooltip />} cursor={{ stroke: '#f59e0b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2.5} fill="url(#portfolioGradient)" dot={false} activeDot={{ r: 5, fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 2 }} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Key Performance Metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            const isNegative = !metric.positive
            return (
              <Card key={metric.label} className="bg-[#111827] border border-[#1f2937] group rounded-2xl shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <div className={`flex size-8 items-center justify-center rounded-lg ${isNegative ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-500'}`}>
                      <Icon className="size-4" />
                    </div>
                    {metric.badge && (
                      <Badge variant={metric.badgeVariant} className="text-[10px]">{metric.badge}</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-xs font-medium text-gray-400">{metric.label}</p>
                  <p className={`font-mono mt-1 text-lg font-bold ${isNegative ? 'text-red-400' : 'text-white'}`}>
                    {metric.value}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Two-Column: Table + Donut */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-md lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-white">Recent Portfolio Adjustments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1f2937] hover:bg-transparent">
                      <TableHead className="text-gray-400">Instrument</TableHead>
                      <TableHead className="text-gray-400">Type</TableHead>
                      <TableHead className="text-right text-gray-400">Quantity</TableHead>
                      <TableHead className="text-right text-gray-400">Exec. Price</TableHead>
                      <TableHead className="text-right text-gray-400">Net Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustments.map((adj) => (
                      <TableRow key={adj.instrument} className="border-[#1f2937] transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 font-mono text-xs font-bold text-amber-500">
                              {adj.instrument.slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white">{adj.instrument}</p>
                              <p className="text-[11px] text-gray-400">{adj.name}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 text-[11px] font-semibold ${adj.type === 'Buy' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
                            {adj.type === 'Buy' ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                            {adj.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-white">{adj.quantity}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-white">{adj.price}</TableCell>
                        <TableCell className={`text-right font-mono text-sm font-semibold ${adj.positive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {adj.change}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-white">Asset Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={pieChartConfig} className="mx-auto h-[220px] w-full">
                <PieChart>
                  <Pie data={allocationData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" strokeWidth={0}>
                    {allocationData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [`${value}%`, name]}
                    contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '8px', fontSize: '12px', color: '#f9fafb' }}
                  />
                </PieChart>
              </ChartContainer>

              <div className="relative -mt-[140px] flex flex-col items-center pb-[60px]">
                <span className="font-mono text-2xl font-bold text-white">3</span>
                <span className="text-[11px] font-medium text-gray-400">Sectors</span>
                <span className="mt-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Balanced</span>
              </div>

              <div className="mt-4 space-y-2">
                {allocationData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-gray-400">{item.name}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-white">{item.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Promo Banner */}
        <div className="relative overflow-hidden rounded-2xl shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-amber-500/90 to-emerald-500" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+PC9zdmc+')] opacity-60" />

          <div className="relative flex flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between sm:px-8 sm:py-6">
            <div className="flex items-center gap-4 text-center sm:text-left">
              <div className="flex size-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <Zap className="size-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white sm:text-xl">Optimize Your Strategy</h3>
                <p className="mt-0.5 text-sm text-white/80">Get AI-powered insights and advanced analytics with StockVerse Premium</p>
              </div>
            </div>
            <Button className="spring-interaction rounded-full bg-white px-6 font-semibold text-amber-500 shadow-md hover:bg-white/90">
              Upgrade Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
