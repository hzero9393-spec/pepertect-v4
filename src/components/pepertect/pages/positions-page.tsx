'use client'

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  TrendingUp,
  Clock,
  Zap,
  ChevronRight,
  X,
  Eye,
  IndianRupee,
  Layers,
  BarChart3,
  Calendar,
  Hash,
  Tag,
  Activity,
  Briefcase,
  LineChart,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { toast } from 'sonner'
import { formatINR, formatINRWhole, formatPrice } from '@/lib/format'
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
  realizedPnl?: number | null
  exitPrice?: number | null
  exitReason?: string | null
  closedAt?: string | null
  marginUsed: number
  lots: number
  lotSize: number
  isOpen: boolean
  createdAt: string
  stopLoss?: number | null
  target?: number | null
}

// Helper to determine if a position is a Stock (EQUITY) or Index (FUTURES/OPTIONS)
function isStockPosition(pos: PositionData): boolean {
  return pos.segment === 'EQUITY'
}

function isIndexPosition(pos: PositionData): boolean {
  return pos.segment === 'FUTURES' || pos.segment === 'OPTIONS'
}

function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const diffMs = end - start
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '< 1m'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  const remMin = diffMin % 60
  if (diffHr < 24) return `${diffHr}h ${remMin}m`
  const diffDay = Math.floor(diffHr / 24)
  const remHr = diffHr % 24
  return `${diffDay}d ${remHr}h`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Groww-Style Live Price Cell ────────────────────────────────

const LivePriceCell = memo(function LivePriceCell({
  price,
  prevPrice,
}: {
  price: number
  prevPrice: number | undefined
}) {
  const direction = prevPrice !== undefined && price !== prevPrice
    ? (price > prevPrice ? 'up' : 'down')
    : null

  return (
    <span className={`font-mono-data font-tabular text-[15px] font-semibold inline-block px-1.5 py-0.5 rounded ${
      direction === 'up' ? 'animate-flash-green text-[#00B386]' : direction === 'down' ? 'animate-flash-red text-[#EB5B3C]' : 'text-[#1a1a1a]'
    }`}>
      {formatPrice(price)}
    </span>
  )
})

// ─── Groww-Style P&L Cell with BIG FILL ────────────────────────

const PnLFillCell = memo(function PnLFillCell({
  pnl,
  pnlPercent,
  prevPnl,
}: {
  pnl: number
  pnlPercent: number
  prevPnl: number | undefined
}) {
  const isPositive = pnl >= 0
  const shouldFlash = prevPnl !== undefined && pnl !== prevPnl
  const absPnl = Math.abs(pnl)

  return (
    <div className={`flex flex-col items-end px-3 py-2 rounded-xl ${
      shouldFlash ? 'animate-pnl-flash' : ''
    } ${
      isPositive
        ? 'bg-[#00B386]/12 border border-[#00B386]/20'
        : 'bg-[#EB5B3C]/10 border border-[#EB5B3C]/18'
    }`}>
      <span className={`font-mono-data font-tabular text-[15px] font-bold ${
        isPositive ? 'text-[#009e76]' : 'text-[#d44a2d]'
      }`}>
        {isPositive ? '+' : '-'}₹{absPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`font-mono-data font-tabular text-[11px] font-semibold mt-0.5 ${
        isPositive ? 'text-[#009e76]/80' : 'text-[#d44a2d]/80'
      }`}>
        {isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%
      </span>
    </div>
  )
})

// ─── Groww-Style Open Position Card ─────────────────────────────

const OpenPositionCard = memo(function OpenPositionCard({
  pos,
  livePrice,
  prevPrice,
  prevPnl,
  isLive,
  onSquareOff,
  isSquaringOff,
  onViewDetails,
}: {
  pos: PositionData
  livePrice: number
  prevPrice: number | undefined
  prevPnl: number | undefined
  isLive: boolean
  onSquareOff: (id: string, symbol: string) => void
  isSquaringOff: boolean
  onViewDetails: (pos: PositionData) => void
}) {
  const isLong = pos.tradeDirection === 'BUY'

  // Calculate live P&L
  const livePnl = isLong
    ? (livePrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - livePrice) * pos.quantity
  const livePnlPercent = pos.totalInvested > 0
    ? (livePnl / pos.totalInvested) * 100
    : 0

  const isProfit = livePnl >= 0

  return (
    <div className="bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden transition-shadow hover:shadow-md">
      {/* Top section: Symbol + P&L fill */}
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-[15px] text-[#1a1a1a] truncate">{pos.symbol}</span>
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase shrink-0 ${
              isLong
                ? 'bg-[#00B386]/10 text-[#00B386]'
                : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
            }`}>
              {isLong ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
              {isLong ? 'BUY' : 'SELL'}
            </span>
            {isLive && (
              <span className="flex items-center gap-0.5 text-[8px] font-bold text-[#00B386] bg-[#00B386]/8 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                <Zap className="size-2" />
                LIVE
              </span>
            )}
            {pos.stopLoss && pos.stopLoss > 0 && (
              <span className="text-[8px] font-bold text-[#EB5B3C] bg-[#EB5B3C]/10 px-1.5 py-0.5 rounded-full shrink-0">SL</span>
            )}
            {pos.target && pos.target > 0 && (
              <span className="text-[8px] font-bold text-[#00B386] bg-[#00B386]/10 px-1.5 py-0.5 rounded-full shrink-0">TGT</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#6b7280]">
            {pos.segment === 'OPTIONS' && pos.strikePrice && (
              <span>{pos.strikePrice} {pos.optionType}</span>
            )}
            {pos.segment === 'FUTURES' && <span>FUT</span>}
            <span>·</span>
            <span>Qty: {pos.quantity}</span>
            <span>·</span>
            <span>{pos.segment}</span>
          </div>
        </div>

        {/* BIG P&L fill */}
        <div className="shrink-0 ml-3">
          <PnLFillCell
            pnl={Math.round(livePnl * 100) / 100}
            pnlPercent={Math.round(livePnlPercent * 100) / 100}
            prevPnl={prevPnl}
          />
        </div>
      </div>

      {/* Bottom section: Price info + View Details + Exit */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-t ${
        isProfit ? 'bg-[#00B386]/[0.03] border-[#00B386]/10' : 'bg-[#EB5B3C]/[0.03] border-[#EB5B3C]/10'
      }`}>
        <div className="flex items-center gap-3 text-[12px]">
          <div className="flex flex-col">
            <span className="text-[#6b7280] text-[10px] font-medium">Entry</span>
            <span className="font-mono-data font-tabular text-[#1a1a1a] font-medium">{formatPrice(pos.entryPrice)}</span>
          </div>
          <ChevronRight className="size-3 text-[#9ca3af]" />
          <div className="flex flex-col">
            <span className="text-[#6b7280] text-[10px] font-medium">LTP</span>
            <LivePriceCell price={livePrice} prevPrice={prevPrice} />
          </div>
          {pos.stopLoss && pos.stopLoss > 0 && (
            <>
              <ChevronRight className="size-3 text-[#9ca3af]" />
              <div className="flex flex-col">
                <span className="text-[#EB5B3C] text-[10px] font-medium">SL</span>
                <span className="font-mono-data font-tabular text-[#EB5B3C] font-medium">{formatPrice(pos.stopLoss)}</span>
              </div>
            </>
          )}
          {pos.target && pos.target > 0 && (
            <>
              <ChevronRight className="size-3 text-[#9ca3af]" />
              <div className="flex flex-col">
                <span className="text-[#00B386] text-[10px] font-medium">TGT</span>
                <span className="font-mono-data font-tabular text-[#00B386] font-medium">{formatPrice(pos.target)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View Details button */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold active:scale-95 transition-all border-[#00D09C]/30 text-[#00D09C] bg-transparent hover:bg-[#00D09C] hover:text-white hover:border-[#00D09C]"
            onClick={() => onViewDetails(pos)}
          >
            <Eye className="size-3 mr-1" />
            View Details
          </Button>

          {/* Exit button */}
          <Button
            variant="outline"
            size="sm"
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold active:scale-95 transition-all shrink-0 ${
              isSquaringOff
                ? 'border-[#d1d5db] text-[#9ca3af]'
                : 'border-[#EB5B3C]/30 text-[#EB5B3C] bg-transparent hover:bg-[#EB5B3C] hover:text-white hover:border-[#EB5B3C]'
            }`}
            disabled={isSquaringOff}
            onClick={() => onSquareOff(pos.id, pos.symbol)}
          >
            {isSquaringOff ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3 mr-1" />
            )}
            {isSquaringOff ? '' : 'Exit'}
          </Button>
        </div>
      </div>
    </div>
  )
})

// ─── Groww-Style Closed Position Card ──────────────────────────

const ClosedPositionCard = memo(function ClosedPositionCard({
  pos,
  onViewDetails,
}: {
  pos: PositionData
  onViewDetails: (pos: PositionData) => void
}) {
  const isLong = pos.tradeDirection === 'BUY'
  const isPositive = (pos.realizedPnl ?? 0) >= 0
  const realizedPnl = pos.realizedPnl ?? 0

  return (
    <div className="bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-[15px] text-[#1a1a1a] truncate">{pos.symbol}</span>
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase shrink-0 ${
              isLong
                ? 'bg-[#00B386]/10 text-[#00B386]'
                : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
            }`}>
              {isLong ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
              {isLong ? 'BUY' : 'SELL'}
            </span>
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-[#6b7280]/10 text-[#6b7280] font-semibold uppercase shrink-0">
              Closed
            </Badge>
            {pos.exitReason && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                pos.exitReason === 'TARGET'
                  ? 'bg-[#00B386]/10 text-[#00B386]'
                  : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
              }`}>
                {pos.exitReason === 'TARGET' ? 'Target Hit' : 'SL Hit'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#6b7280]">
            {pos.segment === 'OPTIONS' && pos.strikePrice && (
              <span>{pos.strikePrice} {pos.optionType}</span>
            )}
            {pos.segment === 'FUTURES' && <span>FUT</span>}
            <span>·</span>
            <span>Qty: {pos.quantity}</span>
          </div>
        </div>

        {/* Closed P&L fill */}
        <div className={`flex flex-col items-end px-3 py-2 rounded-xl shrink-0 ml-3 ${
          isPositive
            ? 'bg-[#00B386]/12 border border-[#00B386]/20'
            : 'bg-[#EB5B3C]/10 border border-[#EB5B3C]/18'
        }`}>
          <span className={`font-mono-data font-tabular text-[15px] font-bold ${
            isPositive ? 'text-[#009e76]' : 'text-[#d44a2d]'
          }`}>
            {isPositive ? '+' : '-'}₹{Math.abs(realizedPnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`font-mono-data font-tabular text-[11px] font-semibold mt-0.5 ${
            isPositive ? 'text-[#009e76]/80' : 'text-[#d44a2d]/80'
          }`}>
            Realized P&L
          </span>
        </div>
      </div>

      <div className={`flex items-center justify-between px-4 py-2.5 border-t ${
        isPositive ? 'bg-[#00B386]/[0.03] border-[#00B386]/10' : 'bg-[#EB5B3C]/[0.03] border-[#EB5B3C]/10'
      }`}>
        <div className="flex items-center gap-3 text-[12px]">
          <div className="flex flex-col">
            <span className="text-[#6b7280] text-[10px] font-medium">Entry</span>
            <span className="font-mono-data font-tabular text-[#1a1a1a] font-medium">{formatPrice(pos.entryPrice)}</span>
          </div>
          <ChevronRight className="size-3 text-[#9ca3af]" />
          <div className="flex flex-col">
            <span className="text-[#6b7280] text-[10px] font-medium">Exit</span>
            <span className="font-mono-data font-tabular text-[#1a1a1a] font-medium">{pos.exitPrice ? formatPrice(pos.exitPrice) : '—'}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-[#6b7280] ml-2">
            <Clock className="size-3" />
            {formatDuration(pos.createdAt, pos.closedAt)}
          </div>
        </div>

        {/* View Details button */}
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold active:scale-95 transition-all border-[#00D09C]/30 text-[#00D09C] bg-transparent hover:bg-[#00D09C] hover:text-white hover:border-[#00D09C]"
          onClick={() => onViewDetails(pos)}
        >
          <Eye className="size-3 mr-1" />
          View Details
        </Button>
      </div>
    </div>
  )
})

// ─── Groww-Style Total P&L Banner (only P&L, no investment) ────

const TotalPnLBanner = memo(function TotalPnLBanner({
  totalPnl,
  openCount,
  isLive,
}: {
  totalPnl: number
  openCount: number
  isLive: boolean
}) {
  const isProfit = totalPnl >= 0

  return (
    <div className={`rounded-2xl p-5 border ${
      isProfit
        ? 'bg-gradient-to-br from-[#00B386]/10 via-[#00B386]/5 to-transparent border-[#00B386]/20'
        : 'bg-gradient-to-br from-[#EB5B3C]/10 via-[#EB5B3C]/5 to-transparent border-[#EB5B3C]/20'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-[#6b7280] uppercase tracking-wider">Total P&L</span>
            {isLive && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-[#00B386] bg-[#00B386]/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                <span className="size-1.5 rounded-full bg-[#00B386] animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`font-mono-data font-tabular text-[28px] font-bold tracking-tight ${
              isProfit ? 'text-[#009e76]' : 'text-[#d44a2d]'
            }`}>
              {isProfit ? '+' : '-'}₹{Math.abs(totalPnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#6b7280] mt-1">
            {openCount} {openCount === 1 ? 'position' : 'positions'} open
          </div>
        </div>
      </div>
    </div>
  )
})

// ─── Detail Sheet Row ───────────────────────────────────────────

function DetailRow({ icon: Icon, label, value, valueClass }: {
  icon: React.ElementType
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#f0f2f5] last:border-b-0">
      <div className="flex items-center gap-2.5">
        <div className="size-7 rounded-lg bg-[#f5f7fa] flex items-center justify-center">
          <Icon className="size-3.5 text-[#6b7280]" />
        </div>
        <span className="text-[13px] text-[#6b7280] font-medium">{label}</span>
      </div>
      <span className={`font-mono-data font-tabular text-[13px] font-semibold ${valueClass || 'text-[#1a1a1a]'}`}>
        {value}
      </span>
    </div>
  )
}

// ─── SL / Target Editor ────────────────────────────────────────

function SLEditor({ position, onUpdated }: { position: PositionData; onUpdated?: (pos: Partial<PositionData>) => void }) {
  const token = useAuthStore(s => s.token)
  const [sl, setSl] = useState(position.stopLoss ? String(position.stopLoss) : '')
  const [tgt, setTgt] = useState(position.target ? String(position.target) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!token || (!sl && !tgt)) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { positionId: position.id, stopLoss: null, target: null }
      if (sl) body.stopLoss = parseFloat(sl)
      if (tgt) body.target = parseFloat(tgt)
      const res = await fetch('/api/trade/sl-set', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(`SL/Target updated for ${position.symbol}`)
        onUpdated?.({
          stopLoss: sl ? parseFloat(sl) : null,
          target: tgt ? parseFloat(tgt) : null,
        })
      } else {
        toast.error(data.error || 'Failed to update SL/Target')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/trade/sl-set', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: position.id }),
      })
      if (res.ok) {
        setSl('')
        setTgt('')
        toast.success('SL/Target removed')
        onUpdated?.({ stopLoss: null, target: null })
      }
    } catch {
      toast.error('Failed to remove')
    } finally {
      setSaving(false)
    }
  }

  const hasSL = position.stopLoss && position.stopLoss > 0
  const hasTarget = position.target && position.target > 0
  const entry = position.entryPrice
  const isBuy = position.tradeDirection === 'BUY'

  return (
    <div className="mt-3 pt-3 border-t border-[#e5e7eb] space-y-2.5">
      <div className="text-[11px] font-bold text-[#6b7280] uppercase tracking-wider">Stop Loss / Target</div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#EB5B3C] uppercase tracking-wider">Stop Loss</label>
          <Input
            type="number"
            value={sl}
            onChange={e => setSl(e.target.value)}
            className="h-9 font-mono text-xs border-[#e5e7eb] bg-white focus:ring-[#EB5B3C]/20 focus:border-[#EB5B3C]"
            placeholder={isBuy ? `Below ${entry}` : `Above ${entry}`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#00B386] uppercase tracking-wider">Target</label>
          <Input
            type="number"
            value={tgt}
            onChange={e => setTgt(e.target.value)}
            className="h-9 font-mono text-xs border-[#e5e7eb] bg-white focus:ring-[#00B386]/20 focus:border-[#00B386]"
            placeholder={isBuy ? `Above ${entry}` : `Below ${entry}`}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!sl && !tgt)}
          className="flex-1 h-9 rounded-lg text-[11px] font-bold bg-[#00D09C] hover:bg-[#00b386] text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
        >
          {saving ? 'Saving...' : 'Update'}
        </button>
        {(hasSL || hasTarget) && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="h-9 px-3 rounded-lg text-[11px] font-bold bg-[#f5f7fa] hover:bg-[#e5e7eb] text-[#6b7280] disabled:opacity-40 transition-all"
          >
            Remove
          </button>
        )}
      </div>

      {(hasSL || hasTarget) && (
        <div className="flex gap-3 text-[10px] text-[#6b7280]">
          {hasSL && <span>SL: <b className="text-[#EB5B3C]">₹{position.stopLoss}</b></span>}
          {hasTarget && <span>Target: <b className="text-[#00B386]">₹{position.target}</b></span>}
        </div>
      )}
    </div>
  )
}

// ─── Position Detail Sheet ──────────────────────────────────────

function PositionDetailSheet({
  position,
  livePrice,
  open,
  onOpenChange,
  onSquareOff,
  isSquaringOff,
}: {
  position: PositionData | null
  livePrice: number | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onSquareOff: (id: string, symbol: string) => void
  isSquaringOff: boolean
}) {
  if (!position) return null

  const isLong = position.tradeDirection === 'BUY'
  const isProfit = position.isOpen !== false
    ? isLong
      ? (livePrice ?? position.currentPrice) > position.entryPrice
      : position.entryPrice > (livePrice ?? position.currentPrice)
    : (position.realizedPnl ?? 0) >= 0

  const currentPrice = livePrice ?? position.currentPrice
  const livePnl = isLong
    ? (currentPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - currentPrice) * position.quantity
  const livePnlPercent = position.totalInvested > 0
    ? (livePnl / position.totalInvested) * 100
    : 0

  const isPositionOpen = position.isOpen !== false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-[18px] font-bold text-[#1a1a1a]">
              {position.symbol}
            </SheetTitle>
            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
              isLong
                ? 'bg-[#00B386]/10 text-[#00B386]'
                : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
            }`}>
              {isLong ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {isLong ? 'BUY' : 'SELL'}
            </span>
            {!isPositionOpen && (
              <Badge variant="secondary" className="text-[9px] px-2 py-0 bg-[#6b7280]/10 text-[#6b7280] font-semibold uppercase">
                Closed
              </Badge>
            )}
          </div>
          <SheetDescription className="sr-only">
            Trade details for {position.symbol}
          </SheetDescription>
        </SheetHeader>

        {/* P&L Hero */}
        <div className={`rounded-2xl p-4 mb-4 border ${
          isProfit
            ? 'bg-gradient-to-br from-[#00B386]/10 via-[#00B386]/5 to-transparent border-[#00B386]/20'
            : 'bg-gradient-to-br from-[#EB5B3C]/10 via-[#EB5B3C]/5 to-transparent border-[#EB5B3C]/20'
        }`}>
          <div className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">
            {isPositionOpen ? 'Unrealized P&L' : 'Realized P&L'}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`font-mono-data font-tabular text-[26px] font-bold ${
              isProfit ? 'text-[#009e76]' : 'text-[#d44a2d]'
            }`}>
              {isPositionOpen
                ? `${livePnl >= 0 ? '+' : '-'}₹${Math.abs(livePnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `${(position.realizedPnl ?? 0) >= 0 ? '+' : '-'}₹${Math.abs(position.realizedPnl ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </span>
            {isPositionOpen && (
              <span className={`font-mono-data font-tabular text-[13px] font-semibold ${
                isProfit ? 'text-[#009e76]/70' : 'text-[#d44a2d]/70'
              }`}>
                {livePnl >= 0 ? '+' : ''}{livePnlPercent.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* All Trade Details */}
        <div className="px-1">
          <DetailRow icon={Tag} label="Symbol" value={position.symbol} />
          <DetailRow icon={Activity} label="Trade Type" value={isLong ? 'BUY (Long)' : 'SELL (Short)'} valueClass={isLong ? 'text-[#00B386]' : 'text-[#EB5B3C]'} />
          <DetailRow icon={Layers} label="Segment" value={position.segment} />

          {position.segment === 'OPTIONS' && position.strikePrice && (
            <DetailRow icon={Hash} label="Strike / Option" value={`${position.strikePrice} ${position.optionType || ''}`} />
          )}

          {position.segment === 'FUTURES' && (
            <DetailRow icon={Layers} label="Lot Size" value={`${position.lotSize} × ${position.lots} lots`} />
          )}

          {position.expiryDate && (
            <DetailRow icon={Calendar} label="Expiry" value={formatDate(position.expiryDate)} />
          )}

          <DetailRow icon={Hash} label="Quantity" value={String(position.quantity)} />
          <DetailRow icon={IndianRupee} label="Entry Price" value={formatINR(position.entryPrice)} />

          {isPositionOpen ? (
            <DetailRow icon={BarChart3} label="Current LTP" value={formatINR(currentPrice)} />
          ) : (
            <DetailRow icon={BarChart3} label="Exit Price" value={position.exitPrice ? formatINR(position.exitPrice) : '—'} />
          )}

          <DetailRow icon={IndianRupee} label="Total Invested" value={formatINR(position.totalInvested)} />
          <DetailRow icon={IndianRupee} label="Current Value" value={formatINR(currentPrice * position.quantity)} />
          <DetailRow icon={IndianRupee} label="Margin Used" value={formatINR(position.marginUsed)} />
          <DetailRow icon={Calendar} label="Opened At" value={formatDate(position.createdAt)} />

          {!isPositionOpen && position.closedAt && (
            <DetailRow icon={Clock} label="Closed At" value={formatDate(position.closedAt)} />
          )}

          {!isPositionOpen && (
            <DetailRow icon={Clock} label="Duration" value={formatDuration(position.createdAt, position.closedAt)} />
          )}

          {isPositionOpen && (
            <DetailRow icon={Clock} label="Holding Duration" value={formatDuration(position.createdAt)} />
          )}
        </div>

        {/* SL / Target Edit */}
        {isPositionOpen && (
          <SLEditor
            position={position}
            onUpdated={(updates) => {
              setDetailPosition(prev => prev ? { ...prev, ...updates } : null)
              // Also update the main positions list so SL/Target badges update immediately
              setPositions(prev => prev.map(p =>
                p.id === position.id ? { ...p, ...updates } : p
              ))
            }}
          />
        )}

        {/* Square Off button for open positions */}
        {isPositionOpen && (
          <div className="mt-4 pt-4 border-t border-[#e5e7eb]">
            <Button
              className="w-full rounded-xl py-3 text-[14px] font-semibold bg-[#EB5B3C] hover:bg-[#d44a2d] text-white active:scale-[0.98] transition-all"
              disabled={isSquaringOff}
              onClick={() => {
                onSquareOff(position.id, position.symbol)
                onOpenChange(false)
              }}
            >
              {isSquaringOff ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <X className="size-4 mr-2" />
              )}
              {isSquaringOff ? 'Squaring Off...' : `Square Off ${position.symbol}`}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Segment Sub-Tab ────────────────────────────────────────────

type SegmentTab = 'stocks' | 'index' | 'nifty' | 'banknifty' | 'finnifty'

// ─── Main Component ─────────────────────────────────────────────

export function PositionsPage() {
  const { token } = useAuthStore()
  const tradeSignal = useAppStore(s => s.tradeSignal)
  const { setCurrentPage, positionsTab, setPositionsTab } = useAppStore()
  const [positions, setPositions] = useState<PositionData[]>([])
  const [loading, setLoading] = useState(true)
  const [squaringOff, setSquaringOff] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open')
  const segmentTab: SegmentTab = positionsTab
  const [detailPosition, setDetailPosition] = useState<PositionData | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // ─── Real-Time Market Data ──────────────────────────────────
  const { stocks: wsStockQuotes, status: wsStatus, marketClosed } = useStockData()

  // Market status from poller
  const marketOpen = !marketClosed

  // ─── Live prices - separate refs for stable rendering ───────
  const livePricesRef = useRef<Record<string, number>>({})
  const prevPricesRef = useRef<Record<string, number>>({})
  const prevPnlRef = useRef<Record<string, number>>({})
  const [livePrices, setLivePrices] = useState<Record<string, number>>({})
  const [prevPnlMap, setPrevPnlMap] = useState<Record<string, number>>({})

  // Update live prices from market data (only when price actually changes AND market is open)
  useEffect(() => {
    // Don't update live prices if market is closed
    if (!marketOpen) return
    if (wsStatus !== 'connected') return

    const priceUpdates: Record<string, number> = {}
    const pnlUpdates: Record<string, number> = {}
    let hasChanges = false

    for (const pos of positions) {
      if (pos.segment === 'EQUITY') {
        const quote = wsStockQuotes[pos.symbol]
        if (quote && quote.last_price > 0) {
          const newPrice = quote.last_price
          const currentLive = livePricesRef.current[pos.symbol]
          if (currentLive !== newPrice) {
            if (currentLive !== undefined) {
              prevPricesRef.current[pos.symbol] = currentLive
            }
            if (currentLive !== undefined && currentLive > 0) {
              const prevPnl = pos.tradeDirection === 'BUY'
                ? (currentLive - pos.entryPrice) * pos.quantity
                : (pos.entryPrice - currentLive) * pos.quantity
              pnlUpdates[pos.id] = Math.round(prevPnl * 100) / 100
            }
            priceUpdates[pos.symbol] = newPrice
            hasChanges = true
          }
        }
      }
    }

    if (hasChanges) {
      livePricesRef.current = { ...livePricesRef.current, ...priceUpdates }
      setLivePrices(prev => ({ ...prev, ...priceUpdates }))
      if (Object.keys(pnlUpdates).length > 0) {
        prevPnlRef.current = { ...prevPnlRef.current, ...pnlUpdates }
        setPrevPnlMap(prev => ({ ...prev, ...pnlUpdates }))
      }
    }
  }, [wsStockQuotes, wsStatus, positions, marketOpen])

  // ─── Fetch Positions ──────────────────────────────────────
  const fetchPositions = useCallback(async () => {
    if (!token) { setLoading(false); return }
    try {
      const res = await fetch('/api/trade/positions', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        const newPos = json.data || []
        setPositions(newPos)
        const initialPrices: Record<string, number> = {}
        for (const pos of newPos) {
          if (pos.segment !== 'EQUITY' || wsStatus !== 'connected') {
            initialPrices[pos.symbol] = pos.currentPrice
          }
        }
        if (Object.keys(initialPrices).length > 0) {
          livePricesRef.current = { ...livePricesRef.current, ...initialPrices }
          setLivePrices(prev => ({ ...prev, ...initialPrices }))
        }
      } else {
        setPositions([])
      }
    } catch {
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [token, wsStatus, tradeSignal])

  useEffect(() => {
    fetchPositions()
    // Initial fetch + refresh on trade signal
    return () => {}
  }, [fetchPositions])

  // ─── SSE Position Stream (REAL-TIME PRICES + P&L) ──────────
  // Server pushes live prices every 500ms + instant exit events
  useEffect(() => {
    if (!token) return

    const eventSource = new EventSource('/api/positions/stream')

    eventSource.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'positions' && msg.data) {
          // Update live prices from server
          const updates: Record<string, number> = {}
          const pnlUpdates: Record<string, number> = {}
          const pnlPercentUpdates: Record<string, number> = {}
          const exitEvents: Record<string, { reason: string; exitPrice: number; pnl: number; timestamp: number }> = {}

          for (const update of msg.data) {
            // Store live price
            updates[update.positionId] = update.currentPrice
            pnlUpdates[update.positionId] = update.unrealizedPnl
            pnlPercentUpdates[update.positionId] = update.unrealizedPnlPercent

            // Check for exit event
            if (update.exitEvent) {
              exitEvents[update.positionId] = update.exitEvent
            }
          }

          if (Object.keys(updates).length > 0) {
            setLivePrices(prev => ({ ...prev, ...updates }))
            setPrevPnlMap(prev => ({ ...prev, ...pnlUpdates }))
            // Update positions with new prices
            setPositions(prev => prev.map(pos => {
              if (updates[pos.id] !== undefined) {
                return {
                  ...pos,
                  currentPrice: updates[pos.id],
                  unrealizedPnl: pnlUpdates[pos.id] ?? pos.unrealizedPnl,
                  unrealizedPnlPercent: pnlPercentUpdates[pos.id] ?? pos.unrealizedPnlPercent,
                }
              }
              return pos
            }))
          }

          // Handle exit events — show toast and refetch
          for (const [posId, evt] of Object.entries(exitEvents)) {
            const reasonLabel = evt.reason === 'STOP_LOSS' ? 'Stop Loss' : 'Target'
            toast.success(`${reasonLabel} hit! Auto-exited @ ₹${evt.exitPrice}`, {
              description: `P&L: ${evt.pnl >= 0 ? '+' : ''}₹${Math.abs(evt.pnl).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
              duration: 5000,
            })
            // Refetch after a short delay to get updated position list
            setTimeout(() => fetchPositions(), 500)
          }
        }

        if (msg.type === 'exit' && msg.data) {
          const evt = msg.data
          const reasonLabel = evt.reason === 'STOP_LOSS' ? 'Stop Loss' : 'Target'
          toast.success(`${reasonLabel} hit! ${evt.symbol} @ ₹${evt.exitPrice}`, {
            description: `P&L: ${evt.pnl >= 0 ? '+' : ''}₹${Math.abs(evt.pnl).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            duration: 5000,
          })
          setTimeout(() => fetchPositions(), 500)
        }
      } catch { /* ignore parse errors */ }
    })

    eventSource.onerror = () => {
      // EventSource auto-reconnects, but if it fails permanently,
      // fall back to 5s polling
      console.log('[Positions] SSE error — falling back to polling')
      const fallbackInterval = setInterval(fetchPositions, 5000)
      const reconnectTimer = setTimeout(() => {
        clearInterval(fallbackInterval)
      }, 30000)
      eventSource.close = () => {
        clearInterval(fallbackInterval)
        clearTimeout(reconnectTimer)
      }
    }

    return () => {
      eventSource.close()
    }
  }, [token, fetchPositions])

  // ─── Square Off ───────────────────────────────────────────
  const handleSquareOff = useCallback(async (positionId: string, symbol: string) => {
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
        const pnlStr = data.closedPosition
          ? `P&L: ${data.closedPosition.realizedPnl >= 0 ? '+' : ''}₹${Math.abs(data.closedPosition.realizedPnl).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
          : ''
        toast.success(`✅ ${symbol} squared off successfully!`, {
          description: pnlStr,
        })
        setPositions(prev => prev.filter(p => p.id !== positionId))
        fetchPositions()
      } else {
        toast.error(data.error || 'Failed to square off position')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSquaringOff(null)
    }
  }, [token, fetchPositions])

  // ─── View Details handler ─────────────────────────────────
  const handleViewDetails = useCallback((pos: PositionData) => {
    setDetailPosition(pos)
    setDetailOpen(true)
  }, [])

  // ─── Split positions by open/closed and segment ───────────
  const openStockPositions = useMemo(() =>
    positions.filter(p => p.isOpen !== false && isStockPosition(p)),
    [positions]
  )

  const openIndexPositions = useMemo(() =>
    positions.filter(p => p.isOpen !== false && isIndexPosition(p)),
    [positions]
  )

  // Closed positions: Only show trades from the last 24 hours (today)
  const closedStockPositions = useMemo(() => {
    const now = Date.now()
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000
    return positions.filter(p => {
      if (p.isOpen !== false) return false
      if (!isStockPosition(p)) return false
      // Use closedAt (from API), fallback to createdAt
      const closedTime = p.closedAt ? new Date(p.closedAt).getTime() : p.createdAt ? new Date(p.createdAt).getTime() : 0
      return closedTime >= twentyFourHoursAgo
    })
  }, [positions])

  const closedIndexPositions = useMemo(() => {
    const now = Date.now()
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000
    return positions.filter(p => {
      if (p.isOpen !== false) return false
      if (!isIndexPosition(p)) return false
      const closedTime = p.closedAt ? new Date(p.closedAt).getTime() : p.createdAt ? new Date(p.createdAt).getTime() : 0
      return closedTime >= twentyFourHoursAgo
    })
  }, [positions])

  // All open positions combined for banner
  const allOpenPositions = useMemo(() =>
    positions.filter(p => p.isOpen !== false),
    [positions]
  )

  // Current segment's open/closed positions (nifty/banknifty/finnifty all use index positions)
  const isStockSegment = segmentTab === 'stocks'
  const currentOpenPositions = isStockSegment ? openStockPositions : openIndexPositions
  const currentClosedPositions = isStockSegment ? closedStockPositions : closedIndexPositions

  // ─── Total P&L (real-time) ────────────────────────────────
  const totalPnl = useMemo(() => {
    return allOpenPositions.reduce((s, pos) => {
      const livePrice = livePrices[pos.symbol] ?? pos.currentPrice
      let pnl: number
      if (pos.tradeDirection === 'BUY') {
        pnl = (livePrice - pos.entryPrice) * pos.quantity
      } else {
        pnl = (pos.entryPrice - livePrice) * pos.quantity
      }
      return s + pnl
    }, 0)
  }, [allOpenPositions, livePrices])

  const isLive = wsStatus === 'connected' && marketOpen

  // Get live price for detail position
  const detailLivePrice = detailPosition ? (livePrices[detailPosition.symbol] ?? detailPosition.currentPrice) : undefined

  return (
    <div className="min-h-screen bg-[#f5f7fa] flex flex-col">
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl mx-auto w-full">
        {/* ── Page Header ─────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Positions
          </h1>
          {isLive && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#00B386] bg-[#00B386]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
              <span className="size-1.5 rounded-full bg-[#00B386] animate-pulse" />
              Live
            </span>
          )}
        </div>
        <p className="text-[#6b7280] text-sm -mt-3">
          Track and manage your trades with real-time P&amp;L updates.
        </p>

        {/* ── Total P&L Banner - only P&L, no investment ──────── */}
        {allOpenPositions.length > 0 && (
          <TotalPnLBanner
            totalPnl={totalPnl}
            openCount={allOpenPositions.length}
            isLive={isLive}
          />
        )}

        {/* ── Tab Switcher: Open / Closed ──────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#e5e7eb]/60 p-1 rounded-xl w-fit">
            <button
              className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                activeTab === 'open'
                  ? 'bg-white text-[#1a1a1a] shadow-sm'
                  : 'text-[#6b7280] hover:text-[#1a1a1a]'
              }`}
              onClick={() => setActiveTab('open')}
            >
              Open
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === 'open' ? 'bg-[#00D09C]/10 text-[#00D09C]' : 'bg-[#6b7280]/10 text-[#6b7280]'
              }`}>
                {allOpenPositions.length}
              </span>
            </button>
            <button
              className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                activeTab === 'closed'
                  ? 'bg-white text-[#1a1a1a] shadow-sm'
                  : 'text-[#6b7280] hover:text-[#1a1a1a]'
              }`}
              onClick={() => setActiveTab('closed')}
            >
              Closed
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === 'closed' ? 'bg-[#6b7280]/10 text-[#1a1a1a]' : 'bg-[#6b7280]/10 text-[#6b7280]'
              }`}>
                {closedStockPositions.length + closedIndexPositions.length}
              </span>
            </button>
          </div>
        </div>

        {/* ── Segment Sub-Tabs: Stocks / Nifty / BankNifty / Finnifty / Index ── */}
        <div className="flex items-center gap-1 bg-white border border-[#e5e7eb] p-1 rounded-xl w-fit overflow-x-auto">
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
              segmentTab === 'stocks'
                ? 'bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/20'
                : 'text-[#6b7280] hover:text-[#1a1a1a] border border-transparent'
            }`}
            onClick={() => setPositionsTab('stocks')}
          >
            <Briefcase className="size-3.5" />
            Stocks
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              segmentTab === 'stocks'
                ? 'bg-[#00D09C]/15 text-[#00D09C]'
                : 'bg-[#6b7280]/10 text-[#6b7280]'
            }`}>
              {activeTab === 'open' ? openStockPositions.length : closedStockPositions.length}
            </span>
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
              segmentTab === 'nifty'
                ? 'bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/20'
                : 'text-[#6b7280] hover:text-[#1a1a1a] border border-transparent'
            }`}
            onClick={() => setPositionsTab('nifty')}
          >
            <LineChart className="size-3.5" />
            Nifty
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
              segmentTab === 'banknifty'
                ? 'bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/20'
                : 'text-[#6b7280] hover:text-[#1a1a1a] border border-transparent'
            }`}
            onClick={() => setPositionsTab('banknifty')}
          >
            <LineChart className="size-3.5" />
            BankNifty
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
              segmentTab === 'finnifty'
                ? 'bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/20'
                : 'text-[#6b7280] hover:text-[#1a1a1a] border border-transparent'
            }`}
            onClick={() => setPositionsTab('finnifty')}
          >
            <LineChart className="size-3.5" />
            Finnifty
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${
              segmentTab === 'index'
                ? 'bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/20'
                : 'text-[#6b7280] hover:text-[#1a1a1a] border border-transparent'
            }`}
            onClick={() => setPositionsTab('index')}
          >
            <LineChart className="size-3.5" />
            All Index
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              !isStockSegment
                ? 'bg-[#00D09C]/15 text-[#00D09C]'
                : 'bg-[#6b7280]/10 text-[#6b7280]'
            }`}>
              {activeTab === 'open' ? openIndexPositions.length : closedIndexPositions.length}
            </span>
          </button>
        </div>

        {/* ── Positions List ──────────────────────────────────── */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#e5e7eb] p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-24 bg-[#f0f0f5]" />
                    <Skeleton className="h-3 w-32 bg-[#f0f0f5]" />
                  </div>
                  <Skeleton className="h-12 w-28 rounded-xl bg-[#f0f0f5]" />
                </div>
                <div className="flex gap-4 mt-3">
                  <Skeleton className="h-8 w-16 bg-[#f0f0f5]" />
                  <Skeleton className="h-8 w-16 bg-[#f0f0f5]" />
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'open' ? (
          currentOpenPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-20 rounded-full bg-[#f0f2f5] flex items-center justify-center mb-5">
                {isStockSegment ? (
                  <Briefcase className="size-9 text-[#6b7280]/30" />
                ) : (
                  <LineChart className="size-9 text-[#6b7280]/30" />
                )}
              </div>
              <p className="text-[#1a1a1a] font-semibold text-[16px]">
                No open {isStockSegment ? 'stock' : 'index'} positions
              </p>
              <p className="text-[#6b7280] text-[13px] mt-1.5">
                Place a {isStockSegment ? 'stock' : 'index'} trade to see your positions here
              </p>
              <Button
                size="sm"
                className="mt-6 gap-1.5 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-xl px-5"
                onClick={() => setCurrentPage(isStockSegment ? 'trading' : 'futures')}
              >
                <TrendingUp className="size-3.5" />
                Start {isStockSegment ? 'Stock' : 'Index'} Trading
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {currentOpenPositions.map((pos) => {
                const livePrice = livePrices[pos.symbol] ?? pos.currentPrice
                const prevPrice = prevPricesRef.current[pos.symbol]
                const isPositionLive = pos.segment === 'EQUITY' && wsStatus === 'connected' && !!wsStockQuotes[pos.symbol] && marketOpen

                return (
                  <OpenPositionCard
                    key={pos.id}
                    pos={pos}
                    livePrice={livePrice}
                    prevPrice={prevPrice}
                    prevPnl={prevPnlMap[pos.id]}
                    isLive={isPositionLive}
                    onSquareOff={handleSquareOff}
                    isSquaringOff={squaringOff === pos.id}
                    onViewDetails={handleViewDetails}
                  />
                )
              })}
            </div>
          )
        ) : (
          currentClosedPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-20 rounded-full bg-[#f0f2f5] flex items-center justify-center mb-5">
                <Clock className="size-9 text-[#6b7280]/30" />
              </div>
              <p className="text-[#1a1a1a] font-semibold text-[16px]">
                No closed {isStockSegment ? 'stock' : 'index'} positions today
              </p>
              <p className="text-[#6b7280] text-[13px] mt-1.5">
                Your today&apos;s closed {isStockSegment ? 'stock' : 'index'} trades will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {currentClosedPositions.map((pos) => (
                <ClosedPositionCard key={pos.id} pos={pos} onViewDetails={handleViewDetails} />
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Detail Sheet ────────────────────────────────────── */}
      <PositionDetailSheet
        position={detailPosition}
        livePrice={detailLivePrice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSquareOff={handleSquareOff}
        isSquaringOff={squaringOff === detailPosition?.id}
      />

      {/* ── Sticky Footer ────────────────────────────────────── */}
      <footer className="mt-auto border-t border-[#e5e7eb] bg-white px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-[11px] text-[#6b7280]">
          <span>{isLive ? 'Live prices updating' : 'Market closed · showing last prices'}</span>
          {isLive ? (
            <span className="flex items-center gap-1 text-[#00B386] font-semibold">
              <span className="size-1.5 rounded-full bg-[#00B386] animate-pulse" />
              Market Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[#EB5B3C] font-semibold">
              <span className="size-1.5 rounded-full bg-[#EB5B3C]" />
              Market Closed
            </span>
          )}
        </div>
      </footer>
    </div>
  )
}
