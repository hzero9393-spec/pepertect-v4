'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ClipboardList,
  IndianRupee,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { formatINR, formatPnL, formatLargeNumber } from '@/lib/format'
import { DateFilter, DateFilterPreset, DateRange, getDateRange, isDateInRange } from '@/components/pepertect/date-filter'

// ─── Types ───────────────────────────────────────────────────────

interface OrderData {
  id: string
  symbol: string
  orderType: string
  tradeDirection: string
  segment: string
  productType: string
  quantity: number
  price: number
  fillPrice: number | null
  totalValue: number
  brokerage: number
  status: string
  optionType?: string | null
  strikePrice?: number | null
  rejectReason: string | null
  placedAt: string
  filledAt: string | null
  cancelledAt: string | null
  createdAt: string
}

interface TradeData {
  id: string
  symbol: string
  tradeDirection: string
  segment: string
  productType: string
  quantity: number
  fillPrice: number
  totalValue: number
  brokerage: number
  pnl: number | null
  pnlPercent: number | null
  optionType?: string | null
  strikePrice?: number | null
  executedAt: string
  order?: {
    status: string
  }
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function formatShortDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ', ' + formatTime(isoDate)
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    PENDING: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20',
    PARTIALLY_FILLED: 'bg-[#00D09C]/10 text-[#00D09C] border-[#00D09C]/20',
    FILLED: 'bg-[#00B386]/10 text-[#00B386] border-[#00B386]/20',
    CANCELLED: 'bg-[#EB5B3C]/10 text-[#EB5B3C] border-[#eb5b3c]/20',
    REJECTED: 'bg-[#EB5B3C]/10 text-[#EB5B3C] border-[#eb5b3c]/20',
    EXPIRED: 'bg-[#6b7280]/10 text-[#6b7280] border-[#6b7280]/20',
  }
  return (
    <Badge variant="outline" className={`text-[10px] font-bold ${variants[status] || 'bg-[#6b7280]/10 text-[#6b7280] border-[#6b7280]/20'}`}>
      {status.replace('_', ' ')}
    </Badge>
  )
}

// ─── Component ───────────────────────────────────────────────────

export function OrdersPage() {
  const { token } = useAuthStore()
  const { setCurrentPage, dateFilterPreset, dateFilterRange, setDateFilter } = useAppStore()
  const [orders, setOrders] = useState<OrderData[]>([])
  const [trades, setTrades] = useState<TradeData[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTrades, setLoadingTrades] = useState(true)
  const [activeTab, setActiveTab] = useState('open')

  // ─── Fetch Orders ────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!token) { setLoadingOrders(false); return }
    try {
      const res = await fetch('/api/trade/orders', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setOrders(json.data || [])
      }
    } catch {
      // silent
    } finally {
      setLoadingOrders(false)
    }
  }, [token])

  // ─── Fetch Trades ────────────────────────────────────────
  const fetchTrades = useCallback(async () => {
    if (!token) { setLoadingTrades(false); return }
    try {
      const res = await fetch('/api/trade/trades?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setTrades(json.data || [])
      }
    } catch {
      // silent
    } finally {
      setLoadingTrades(false)
    }
  }, [token])

  useEffect(() => {
    fetchOrders()
    fetchTrades()
  }, [fetchOrders, fetchTrades])

  // ─── Date Filter Logic ─────────────────────────────────
  const activeDateRange = useMemo(() => getDateRange(dateFilterPreset, dateFilterRange), [dateFilterPreset, dateFilterRange])

  const handleDateFilterChange = useCallback((preset: DateFilterPreset, range?: DateRange) => {
    setDateFilter(preset, range)
  }, [setDateFilter])

  const filteredOrders = useMemo(() =>
    orders.filter(o => isDateInRange(o.placedAt, activeDateRange)),
    [orders, activeDateRange]
  )

  const filteredTrades = useMemo(() =>
    trades.filter(t => isDateInRange(t.executedAt, activeDateRange)),
    [trades, activeDateRange]
  )

  // ─── Split orders into open (non-filled/active) and trade history ──
  const openOrders = filteredOrders.filter(o =>
    o.status === 'PENDING' || o.status === 'PARTIALLY_FILLED'
  )

  // Stats
  const filledCount = filteredOrders.filter(o => o.status === 'FILLED').length
  const totalVolume = filteredTrades.reduce((s, t) => s + t.totalValue, 0)

  // ─── Open Orders Table ───────────────────────────────────
  const OpenOrdersTable = () => {
    if (openOrders.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="size-16 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
            <FileText className="size-7 text-[#6b7280]/40" />
          </div>
          <p className="text-[#1a1a1a] font-semibold text-sm">No orders yet</p>
          <p className="text-[#6b7280] text-xs mt-1.5">
            Your pending orders will appear here
          </p>
          <Button
            size="sm"
            className="mt-5 gap-1.5 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg"
            onClick={() => setCurrentPage('trading')}
          >
            <TrendingUp className="size-3.5" />
            Place Order
          </Button>
        </div>
      )
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-[#e5e7eb]">
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Symbol</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Type</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb] text-right">Price</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb] text-right">Qty</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Status</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-[#e5e7eb]">
            {openOrders.map((order) => {
              const isBuy = order.tradeDirection === 'BUY'
              return (
                <TableRow
                  key={order.id}
                  className="hover:bg-[#f8f9fb] transition-colors"
                >
                  <TableCell className="py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-sm text-[#1a1a1a]">{order.symbol}</span>
                      {order.optionType && order.strikePrice && (
                        <span className="text-[10px] text-[#6b7280]">
                          {order.strikePrice} {order.optionType}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-4">
                    <span
                      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        isBuy
                          ? 'bg-[#00B386]/10 text-[#00B386]'
                          : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                      }`}
                    >
                      {isBuy ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                      {order.tradeDirection}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono-data font-tabular text-sm text-right text-[#1a1a1a] py-4">
                    {formatINR(order.price)}
                  </TableCell>
                  <TableCell className="font-mono-data font-tabular text-sm text-right text-[#1a1a1a] py-4">
                    {order.quantity}
                  </TableCell>
                  <TableCell className="py-4">
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="py-4">
                    <div className="flex items-center gap-1 text-xs text-[#6b7280]">
                      <Clock className="size-3" />
                      {formatShortDateTime(order.placedAt)}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  // ─── Trade History Table ─────────────────────────────────
  const TradeHistoryTable = () => {
    if (filteredTrades.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="size-16 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
            <FileText className="size-7 text-[#6b7280]/40" />
          </div>
          <p className="text-[#1a1a1a] font-semibold text-sm">No trade history</p>
          <p className="text-[#6b7280] text-xs mt-1.5">
            {trades.length === 0 ? 'Your executed trades will appear here' : 'No trades match the selected date filter'}
          </p>
        </div>
      )
    }

    return (
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-[#e5e7eb]">
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Symbol</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Type</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb] text-right">Fill Price</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb] text-right">Qty</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb] text-right">P&amp;L</TableHead>
              <TableHead className="text-xs font-semibold text-[#6b7280] tracking-wider uppercase py-3 bg-[#f8f9fb]">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-[#e5e7eb]">
            {filteredTrades.map((trade) => {
              const isPositive = (trade.pnl ?? 0) >= 0
              return (
                <TableRow key={trade.id} className="hover:bg-[#f8f9fb] transition-colors">
                  <TableCell className="py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-sm text-[#1a1a1a]">{trade.symbol}</span>
                      {trade.optionType && trade.strikePrice && (
                        <span className="text-[10px] text-[#6b7280]">
                          {trade.strikePrice} {trade.optionType}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-4">
                    <span
                      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        trade.tradeDirection === 'BUY'
                          ? 'bg-[#00B386]/10 text-[#00B386]'
                          : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                      }`}
                    >
                      {trade.tradeDirection === 'BUY' ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                      {trade.tradeDirection}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono-data font-tabular text-sm text-right text-[#1a1a1a] py-4">
                    {formatINR(trade.fillPrice)}
                  </TableCell>
                  <TableCell className="font-mono-data font-tabular text-sm text-right text-[#1a1a1a] py-4">
                    {trade.quantity}
                  </TableCell>
                  <TableCell className="py-4 text-right">
                    {trade.pnl !== null ? (
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold font-tabular ${
                        isPositive
                          ? 'bg-[#00B386]/10 text-[#00B386]'
                          : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                      }`}>
                        {formatPnL(trade.pnl!)}
                      </span>
                    ) : (
                      <span className="text-xs text-[#6b7280]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4">
                    <div className="flex items-center gap-1 text-xs text-[#6b7280]">
                      <Clock className="size-3" />
                      {formatShortDateTime(trade.executedAt)}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa] px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Orders
          </h1>
          <p className="text-[#6b7280] mt-1 text-sm">
            View your open orders and complete trade execution history.
          </p>
        </div>
        <DateFilter
          value={dateFilterPreset}
          onChange={handleDateFilterChange}
          customRange={dateFilterRange}
        />
      </motion.div>

      {/* ── Date Filter Info ──────────────────────────────────────── */}
      {dateFilterPreset !== 'all' && (filteredOrders.length > 0 || filteredTrades.length > 0) && (
        <div className="flex items-center gap-2 text-xs text-[#6b7280] bg-[#f8f9fb] px-3 py-2 rounded-lg border border-[#e5e7eb]/50">
          <Clock className="size-3.5 text-[#00D09C]" />
          Showing {filteredOrders.length} orders & {filteredTrades.length} trades for{' '}
          <span className="font-semibold text-[#1a1a1a]">
            {dateFilterPreset === 'custom' && dateFilterRange
              ? `${new Date(dateFilterRange.from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(dateFilterRange.to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
              : dateFilterPreset.charAt(0).toUpperCase() + dateFilterPreset.slice(1)}
          </span>
        </div>
      )}

      {/* ── Stats Grid ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {[
          { label: 'Total Orders', value: String(filteredOrders.length), icon: ClipboardList, borderColor: 'border-l-[#00D09C]', iconBg: 'bg-[#00D09C]/10', iconColor: 'text-[#00D09C]' },
          { label: 'Filled', value: String(filledCount), icon: CheckCircle2, borderColor: 'border-l-[#00B386]', iconBg: 'bg-[#00B386]/10', iconColor: 'text-[#00B386]' },
          { label: 'Cancelled', value: String(filteredOrders.filter(o => o.status === 'CANCELLED' || o.status === 'REJECTED').length), icon: XCircle, borderColor: 'border-l-[#eb5b3c]', iconBg: 'bg-[#EB5B3C]/10', iconColor: 'text-[#EB5B3C]' },
          { label: 'Total Volume', value: formatLargeNumber(totalVolume), icon: IndianRupee, borderColor: 'border-l-[#00D09C]', iconBg: 'bg-[#00D09C]/10', iconColor: 'text-[#00D09C]' },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className={`bg-white border border-[#e5e7eb] border-l-4 ${stat.borderColor} rounded-xl shadow-sm`}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">
                    {stat.label}
                  </p>
                  <div className={`size-7 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                    <Icon className={`size-3.5 ${stat.iconColor}`} />
                  </div>
                </div>
                <p className="text-lg font-bold font-tabular text-[#1a1a1a]">
                  {stat.value}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </motion.div>

      {/* ── Orders Table with Tabs ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex items-center justify-between mb-5">
                <TabsList className="bg-[#f5f7fa] border border-[#e5e7eb] p-1 rounded-lg">
                  <TabsTrigger
                    value="open"
                    className="text-xs font-semibold px-4 py-1.5 rounded-md data-[state=active]:bg-[#00D09C] data-[state=active]:text-white data-[state=active]:shadow-sm text-[#6b7280] transition-all"
                  >
                    Open Orders
                    <span className="ml-1.5 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">{filteredOrders.filter(o => o.status === 'PENDING' || o.status === 'PARTIALLY_FILLED').length}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="history"
                    className="text-xs font-semibold px-4 py-1.5 rounded-md data-[state=active]:bg-[#00D09C] data-[state=active]:text-white data-[state=active]:shadow-sm text-[#6b7280] transition-all"
                  >
                    Trade History
                    <span className="ml-1.5 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">{filteredTrades.length}</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              {loadingOrders || loadingTrades ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-4 w-20 bg-[#f0f0f5]" />
                      <Skeleton className="h-4 w-16 bg-[#f0f0f5]" />
                      <Skeleton className="h-4 w-16 bg-[#f0f0f5]" />
                      <Skeleton className="h-4 w-20 bg-[#f0f0f5]" />
                      <Skeleton className="h-4 w-20 bg-[#f0f0f5]" />
                      <Skeleton className="h-4 w-20 bg-[#f0f0f5]" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <TabsContent value="open" className="mt-0">
                    <OpenOrdersTable />
                  </TabsContent>
                  <TabsContent value="history" className="mt-0">
                    <TradeHistoryTable />
                  </TabsContent>
                </>
              )}
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
