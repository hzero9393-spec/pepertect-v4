'use client'

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  RefreshCw,
  Minus,
  Plus,
  Loader2,
  ShoppingCart,
  Star,
  Zap,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { useWatchlistStore } from '@/lib/watchlist-store'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'
import { TradeConfirmModal, TradeConfirmData } from '@/components/pepertect/ui/trade-confirm-modal'
import { motion, AnimatePresence } from 'framer-motion'
import { formatINR, formatVolume, formatPercent, calculateBrokerage } from '@/lib/format'
import { StockLogo } from '@/components/pepertect/ui/stock-logo'
import { useStockData, useDerivedData, usePositions, type WsStockQuote, type WsPositionUpdate, type DerivedMarketData } from '@/hooks/use-market-data'

// ─── Types ────────────────────────────────────────────────────────────────

interface TradeableStock {
  id: string
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  sector: string
  lotSize: number
  isFnoBan: boolean
  isFuturesAvailable: boolean
  isOptionsAvailable: boolean
  volume: number
  marketCap: number
  week52High: number
  week52Low: number
  peRatio: number | null
}

interface Position {
  id: string
  segment: string
  productType: string
  tradeDirection: string
  symbol: string
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
  initialCapital: number
  openPositionsCount: number
}

// ─── Tab Filter Types ─────────────────────────────────────────────────────

type StockTab = 'all' | 'nifty50' | 'bankNifty' | 'fno' | 'gainers' | 'losers' | 'banking' | 'it' | 'pharma' | 'auto' | 'fmcg' | 'energy' | 'metals' | 'oilGas' | 'finance' | 'telecom' | 'infrastructure' | 'paints' | 'textiles' | 'retail' | 'cement' | 'defence'

const sectorMap: Record<string, string> = {
  banking: 'Banking',
  it: 'IT',
  pharma: 'Pharma',
  auto: 'Automobile',
  fmcg: 'FMCG',
  energy: 'Energy',
  metals: 'Metals',
  oilGas: 'Oil & Gas',
  finance: 'Finance',
  telecom: 'Telecom',
  infrastructure: 'Infrastructure',
  paints: 'Paints',
  textiles: 'Textiles',
  retail: 'Retail',
  cement: 'Cement',
  defence: 'Defence',
}

const tabs: { id: StockTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'nifty50', label: 'NIFTY 50' },
  { id: 'bankNifty', label: 'Bank Nifty' },
  { id: 'fno', label: 'F&O' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'banking', label: 'Banking' },
  { id: 'it', label: 'IT' },
  { id: 'pharma', label: 'Pharma' },
  { id: 'auto', label: 'Auto' },
  { id: 'fmcg', label: 'FMCG' },
  { id: 'energy', label: 'Energy' },
  { id: 'metals', label: 'Metals' },
  { id: 'oilGas', label: 'Oil & Gas' },
  { id: 'finance', label: 'Finance' },
  { id: 'telecom', label: 'Telecom' },
  { id: 'infrastructure', label: 'Infra' },
  { id: 'paints', label: 'Paints' },
  { id: 'textiles', label: 'Textiles' },
  { id: 'retail', label: 'Retail' },
  { id: 'cement', label: 'Cement' },
  { id: 'defence', label: 'Defence' },
]

// NIFTY 50 symbols (major constituents)
const NIFTY50_SYMBOLS = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR',
  'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT', 'AXISBANK',
  'BAJFINANCE', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA', 'TATAMOTORS',
  'WIPRO', 'HCLTECH', 'ULTRACEMCO', 'TITAN', 'NESTLEIND', 'NTPC',
  'POWERGRID', 'ONGC', 'TATASTEEL', 'ADANIENT', 'ADANIPORTS',
  'JSWSTEEL', 'COALINDIA', 'BPCL', 'HINDALCO', 'GRASIM',
  'TECHM', 'BAJAJFINSV', 'DRREDDY', 'CIPLA', 'EICHERMOT',
  'TATACONSUM', 'HEROMOTOCO', 'M&M', 'APOLLOHOSP', 'DIVISLAB',
  'BRITANNIA', 'INDUSINDBK', 'HDFCLIFE', 'SBILIFE', 'TATAMTRDVR',
])

// Bank Nifty symbols
const BANKNIFTY_SYMBOLS = new Set([
  'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK',
  'BANKBARODA', 'PNB', 'INDUSINDBK', 'AUBANK', 'BANDHANBNK',
  'FEDERALBNK', 'IDFCFIRSTB', 'CANBK', 'UNIONBANK', 'IOB',
  'CENTRALBK', 'BANKINDIA', 'MAHABANK', 'UCOBANK', 'INDIANB',
])

// ─── Helpers ──────────────────────────────────────────────────────────────

function getSectorColor(sector: string): string {
  const colors: Record<string, string> = {
    'Banking': 'bg-[#00D09C]/8 text-[#00D09C]',
    'IT': 'bg-[#00B386]/8 text-[#00B386]',
    'Pharma': 'bg-purple-500/8 text-purple-600',
    'Automobile': 'bg-orange-500/8 text-orange-600',
    'Auto': 'bg-orange-500/8 text-orange-600',
    'FMCG': 'bg-pink-500/8 text-pink-600',
    'Energy': 'bg-yellow-500/8 text-yellow-700',
    'Metals': 'bg-gray-500/8 text-gray-600',
    'Oil & Gas': 'bg-amber-500/8 text-amber-700',
    'Finance': 'bg-[#00D09C]/8 text-[#00D09C]',
    'Financial Services': 'bg-[#00D09C]/8 text-[#00D09C]',
    'Telecom': 'bg-teal-500/8 text-teal-600',
    'Cement': 'bg-amber-500/8 text-amber-700',
    'Infrastructure': 'bg-sky-500/8 text-sky-600',
    'Insurance': 'bg-emerald-500/8 text-emerald-600',
    'Conglomerate': 'bg-violet-500/8 text-violet-600',
    'Healthcare': 'bg-rose-500/8 text-rose-600',
    'Construction': 'bg-slate-500/8 text-slate-600',
    'Mining': 'bg-stone-500/8 text-stone-600',
  }
  return colors[sector] || 'bg-[#6b7280]/8 text-[#6b7280]'
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0">
          <Skeleton className="h-4 w-20 mb-1.5 bg-[#f0f0f5]" />
          <Skeleton className="h-3 w-28 bg-[#f0f0f5]" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-5 w-14 bg-[#f0f0f5] rounded-full" />
        <div className="text-right min-w-[100px]">
          <Skeleton className="h-5 w-20 mb-1 bg-[#f0f0f5] ml-auto" />
        </div>
        <Skeleton className="h-6 w-16 bg-[#f0f0f5] rounded-full" />
      </div>
    </div>
  )
}

// ─── Stock Row Component ──────────────────────────────────────────────────

function StockRow({ stock, onClick }: { stock: TradeableStock; onClick: () => void }) {
  const isPositive = stock.changePercent >= 0
  const { token } = useAuthStore()
  const { isInWatchlist, addSymbol, removeSymbol } = useWatchlistStore()
  const [starLoading, setStarLoading] = useState(false)
  const inWatchlist = isInWatchlist(stock.symbol)

  const handleToggleWatchlist = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token || starLoading) return
    setStarLoading(true)
    try {
      if (inWatchlist) {
        const res = await fetch('/api/trade/watchlist', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: stock.symbol }),
        })
        const data = await res.json()
        if (data.success) {
          removeSymbol(stock.symbol)
          toast.success(data.message || `${stock.symbol} removed from watchlist`)
        } else {
          toast.error(data.error || 'Failed to remove')
        }
      } else {
        const res = await fetch('/api/trade/watchlist', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: stock.symbol }),
        })
        const data = await res.json()
        if (data.success) {
          addSymbol(stock.symbol)
          toast.success(data.message || `${stock.symbol} added to watchlist`)
        } else {
          toast.error(data.error || 'Failed to add')
        }
      }
    } catch {
      toast.error('Network error')
    } finally {
      setStarLoading(false)
    }
  }

  return (
    <motion.div
      className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#f8f9fb] transition-colors cursor-pointer text-left border-b border-[#f0f2f5] last:border-b-0 group"
      whileTap={{ scale: 0.998 }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1" onClick={onClick}>
        <StockLogo symbol={stock.symbol} name={stock.name} sector={stock.sector} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#1a1a1a] truncate">{stock.symbol}</span>
            {(stock.isFuturesAvailable || stock.isOptionsAvailable) && !stock.isFnoBan && (
              <span className="text-[8px] font-bold bg-[#00D09C]/10 text-[#00D09C] px-1.5 py-0.5 rounded uppercase tracking-wider">
                F&O
              </span>
            )}
            {stock.isFnoBan && (
              <span className="text-[8px] font-bold bg-[#EB5B3C]/10 text-[#EB5B3C] px-1.5 py-0.5 rounded uppercase tracking-wider">
                F&O Ban
              </span>
            )}
          </div>
          <p className="text-xs text-[#6b7280] truncate mt-0.5 max-w-[200px]">{stock.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        {/* Sector tag - hidden on very small screens */}
        <span className={`hidden md:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${getSectorColor(stock.sector)}`}>
          {stock.sector}
        </span>
        {/* LTP */}
        <div className="text-right min-w-[90px]">
          <span className="text-base font-bold font-mono font-tabular text-[#1a1a1a]">
            {formatINR(stock.currentPrice)}
          </span>
        </div>
        {/* Change pill */}
        <div className={`inline-flex items-center gap-0.5 px-2.5 py-1 rounded-md text-xs font-bold min-w-[72px] justify-center ${
          isPositive
            ? 'bg-[#00B386]/10 text-[#00B386]'
            : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
        }`}>
          {isPositive ? (
            <ArrowUpRight className="size-3" />
          ) : (
            <ArrowDownRight className="size-3" />
          )}
          {formatPercent(stock.changePercent)}
        </div>
        {/* Watchlist Star */}
        <button
          onClick={handleToggleWatchlist}
          disabled={starLoading}
          className={`flex size-7 items-center justify-center rounded-lg transition-all duration-200 shrink-0 ${
            inWatchlist
              ? 'text-[#00D09C] hover:bg-[#00D09C]/10'
              : 'text-[#d1d5db] hover:text-[#00D09C] hover:bg-[#00D09C]/5'
          }`}
          title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          aria-label={inWatchlist ? `Remove ${stock.symbol} from watchlist` : `Add ${stock.symbol} to watchlist`}
        >
          <Star className={`size-4 ${inWatchlist ? 'fill-[#00D09C]' : ''}`} />
        </button>
      </div>
    </motion.div>
  )
}

// ─── Order Panel Component ────────────────────────────────────────────────

function OrderPanel({
  selectedStock,
  token,
  onTradeSuccess: handleTradeSuccess,
  portfolio,
  user,
}: {
  selectedStock: TradeableStock | null
  token: string | null
  onTradeSuccess: () => Promise<void>
  portfolio: PortfolioData | null
  user: { virtualBalance?: number; marginUsed?: number } | null
}) {
  const { showTradeSuccess } = useTradeSuccess()
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState('MARKET')
  const [productType, setProductType] = useState('INTRADAY')
  const [quantity, setQuantity] = useState(10)
  const [price, setPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [target, setTarget] = useState('')
  const [placingOrder, setPlacingOrder] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmData, setConfirmData] = useState<TradeConfirmData | null>(null)

  // Derive price from selectedStock without useEffect to avoid cascading renders
  const derivedPrice = selectedStock?.currentPrice.toFixed(2) ?? price
  const effectivePrice = orderType === 'MARKET' ? derivedPrice : price

  const estimatedTotal = useMemo(() => {
    const p = orderType === 'MARKET'
      ? (selectedStock?.currentPrice ?? 0)
      : (parseFloat(price) || 0)
    return quantity * p
  }, [quantity, price, orderType, selectedStock?.currentPrice])

  const estimatedBrokerage = useMemo(() => {
    return calculateBrokerage(estimatedTotal)
  }, [estimatedTotal])

  const availableBalance = portfolio?.virtualBalance ?? user?.virtualBalance ?? 0
  const buyingPower = portfolio?.availableMargin ?? ((user?.virtualBalance ?? 0) - (user?.marginUsed ?? 0))

  const handlePlaceOrder = async () => {
    if (!token || !selectedStock) return

    if (orderType === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      toast.error('Please enter a valid price for LIMIT orders')
      return
    }

    if (quantity <= 0) {
      toast.error('Quantity must be at least 1')
      return
    }

    // Open confirmation modal instead of directly placing order
    const direction = orderSide === 'buy' ? 'BUY' : 'SELL'
    const fillPrice = orderType === 'MARKET' ? selectedStock.currentPrice : parseFloat(price)
    setConfirmData({
      symbol: selectedStock.symbol,
      direction: direction as 'BUY' | 'SELL',
      segment: 'EQUITY',
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
    if (!token || !selectedStock) return { success: false, error: 'No stock selected' }

    const direction = orderSide === 'buy' ? 'BUY' : 'SELL'
    const body: Record<string, unknown> = {
      symbol: selectedStock.symbol,
      direction,
      orderType,
      segment: 'EQUITY',
      productType,
      quantity,
    }

    if (orderType === 'LIMIT' && price) {
      body.price = parseFloat(price)
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
        const fillPrice = orderType === 'MARKET' ? selectedStock.currentPrice : parseFloat(price)
        showTradeSuccess({
          symbol: selectedStock.symbol,
          type: direction as 'BUY' | 'SELL',
          qty: quantity,
          price: fillPrice,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
          orderId: data.order?.id?.slice(-8).toUpperCase() || 'N/A',
          segment: 'EQUITY',
          totalValue: data.order?.totalValue,
          brokerage: data.order?.brokerage,
        })
        bumpTradeSignal() // notify positions page to refetch
        // Set SL/Target if provided
        if ((stopLoss || target) && token && data.order?.id) {
          const slBody: Record<string, unknown> = { stopLoss: null, target: null }
          if (stopLoss) slBody.stopLoss = parseFloat(stopLoss)
          if (target) slBody.target = parseFloat(target)
          fetch('/api/trade/sl-set', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ positionId: data.positionId, ...slBody }),
          }).catch(() => {})
        }
        await handleTradeSuccess()
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

  if (!selectedStock) {
    return (
      <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="size-12 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-3">
              <TrendingUp className="size-6 text-[#6b7280]/40" />
            </div>
            <p className="text-[#1a1a1a] font-semibold text-sm">No Stock Selected</p>
            <p className="text-[#6b7280] text-xs mt-1">
              Click on a stock to start trading
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isPositive = selectedStock.changePercent >= 0

  return (
    <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
      <CardContent className="p-6 space-y-5">
        {/* Stock Info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <StockLogo symbol={selectedStock.symbol} name={selectedStock.name} sector={selectedStock.sector} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-[#00D09C]">{selectedStock.symbol}</span>
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  isPositive
                    ? 'bg-[#00B386]/10 text-[#00B386]'
                    : 'bg-[#EB5B3C]/10 text-[#EB5B3C]'
                }`}>
                  {isPositive ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                  {formatPercent(selectedStock.changePercent)}
                </span>
              </div>
              <p className="text-xs text-[#6b7280] mt-0.5 truncate max-w-[180px]">{selectedStock.name}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold font-mono font-tabular text-[#1a1a1a]">
              {formatINR(selectedStock.currentPrice)}
            </span>
            <p className={`text-xs font-medium ${isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'}`}>
              {isPositive ? '+' : ''}{formatINR(selectedStock.change)} today
            </p>
          </div>
        </div>

        {/* Buy/Sell Toggle */}
        <div className="flex rounded-xl bg-[#f5f7fa] p-1">
          <button
            className={`flex-1 h-10 rounded-lg text-sm font-bold transition-all ${
              orderSide === 'buy'
                ? 'bg-[#00d09c] text-white shadow-sm'
                : 'text-[#6b7280] hover:text-[#1a1a1a]'
            }`}
            onClick={() => setOrderSide('buy')}
          >
            Buy
          </button>
          <button
            className={`flex-1 h-10 rounded-lg text-sm font-bold transition-all ${
              orderSide === 'sell'
                ? 'bg-[#eb5b3c] text-white shadow-sm'
                : 'text-[#6b7280] hover:text-[#1a1a1a]'
            }`}
            onClick={() => setOrderSide('sell')}
          >
            Sell
          </button>
        </div>

        {/* Order Type & Product Type */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
              Order Type
            </label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full h-9 rounded-lg border border-[#e5e7eb] bg-white text-sm text-[#1a1a1a] px-3 focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C]"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
              Product
            </label>
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="w-full h-9 rounded-lg border border-[#e5e7eb] bg-white text-sm text-[#1a1a1a] px-3 focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C]"
            >
              <option value="INTRADAY">Intraday</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>
        </div>

        {/* Quantity */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
            Quantity
          </label>
          <div className="flex items-center gap-2">
            <button
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f5f7fa] hover:text-[#1a1a1a] transition-colors"
              onClick={() => setQuantity(Math.max(1, quantity - 10))}
            >
              <Minus className="size-3.5" />
            </button>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-9 text-center font-mono font-tabular border-[#e5e7eb] bg-white text-[#1a1a1a] focus:ring-[#00D09C]/20 focus:border-[#00D09C]"
            />
            <button
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f5f7fa] hover:text-[#1a1a1a] transition-colors"
              onClick={() => setQuantity(quantity + 10)}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Limit Price */}
        {orderType === 'LIMIT' && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
              Limit Price
            </label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-9 font-mono font-tabular border-[#e5e7eb] bg-white text-[#1a1a1a] focus:ring-[#00D09C]/20 focus:border-[#00D09C]"
              placeholder="0.00"
            />
          </div>
        )}

        {/* SL / Target */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#EB5B3C] uppercase tracking-wider">Stop Loss</label>
            <Input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="h-9 font-mono font-tabular border-[#e5e7eb] bg-white text-[#1a1a1a] focus:ring-[#EB5B3C]/20 focus:border-[#EB5B3C]"
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#00B386] uppercase tracking-wider">Target</label>
            <Input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 font-mono font-tabular border-[#e5e7eb] bg-white text-[#1a1a1a] focus:ring-[#00B386]/20 focus:border-[#00B386]"
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Order Summary */}
        <div className="rounded-xl bg-[#f5f7fa] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#6b7280]">Estimated Total</span>
            <span className="font-mono font-tabular text-lg font-bold text-[#1a1a1a]">
              {formatINR(estimatedTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#6b7280]">Est. Brokerage (0.05%)</span>
            <span className="font-mono font-tabular text-[10px] font-medium text-[#6b7280]">
              {formatINR(estimatedBrokerage)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-[#e5e7eb]">
            <span className="text-[10px] text-[#6b7280]">Total (incl. brokerage)</span>
            <span className="font-mono font-tabular text-xs font-bold text-[#1a1a1a]">
              {formatINR(estimatedTotal + estimatedBrokerage)}
            </span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          className={`w-full h-12 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            orderSide === 'buy'
              ? 'bg-[#00d09c] hover:bg-[#00b888] active:scale-[0.98]'
              : 'bg-[#eb5b3c] hover:bg-[#d14e31] active:scale-[0.98]'
          }`}
          onClick={handlePlaceOrder}
          disabled={placingOrder || !selectedStock}
        >
          {placingOrder ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Placing Order...
            </span>
          ) : (
            orderSide === 'buy' ? `Review Buy Order` : `Review Sell Order`
          )}
        </button>

        {/* Account Info */}
        <div className="space-y-2 pt-3 border-t border-[#e5e7eb]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#6b7280]">Available Balance</span>
            <span className="font-mono font-tabular text-xs font-semibold text-[#1a1a1a]">
              {formatINR(availableBalance)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#6b7280]">Buying Power</span>
            <span className="font-mono font-tabular text-xs font-semibold text-[#1a1a1a]">
              {formatINR(Math.max(0, buyingPower))}
            </span>
          </div>
        </div>
      </CardContent>

      {/* Trade Confirmation Modal */}
      <TradeConfirmModal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        tradeData={confirmData}
        onConfirm={executeTrade}
        onSuccess={() => {
          useAppStore.getState().setCurrentPage('positions')
        }}
      />
    </Card>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export function TradingPage() {
  const { token, user } = useAuthStore()
  const { setCurrentPage, navigateToStock, bumpTradeSignal } = useAppStore()
  const { showTradeSuccess } = useTradeSuccess()
  const { setSymbols: setWatchlistSymbols, loaded: watchlistLoaded } = useWatchlistStore()

  // ── WebSocket Real-Time Data ──────────────────────────────────────────
  const { stocks: wsStockQuotes, status: wsStatus } = useStockData()
  const { derived } = useDerivedData()
  const wsPositions = usePositions()

  // ── State ─────────────────────────────────────────────────────────────
  const [stocks, setStocks] = useState<TradeableStock[]>([])
  const [gainers, setGainers] = useState<TradeableStock[]>([])
  const [losers, setLosers] = useState<TradeableStock[]>([])
  const [selectedStock, setSelectedStock] = useState<TradeableStock | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)

  const [loadingStocks, setLoadingStocks] = useState(true)
  const [loadingGainers, setLoadingGainers] = useState(true)
  const [loadingLosers, setLoadingLosers] = useState(true)
  const [apiError, setApiError] = useState(false)

  const [activeTab, setActiveTab] = useState<StockTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showOrderPanel, setShowOrderPanel] = useState(false)
  const [stockPage, setStockPage] = useState(1)
  const [totalStocks, setTotalStocks] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch Stocks (with pagination, search, and sector filter) ──────
  const fetchStocks = useCallback(async (isBackgroundRefresh = false, page = 1, append = false) => {
    if (!token) { setLoadingStocks(false); return }
    if (!isBackgroundRefresh && !append) setLoadingStocks(true)
    if (append) setLoadingMore(true)
    setApiError(false)
    try {
      const params = new URLSearchParams()
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      if (activeTab !== 'all' && activeTab !== 'gainers' && activeTab !== 'losers') {
        if (activeTab === 'nifty50') {
          // Nifty 50 - just load top 50 by market cap
        } else if (activeTab === 'bankNifty') {
          params.set('sector', 'Banking')
        } else if (activeTab === 'fno') {
          params.set('fnoOnly', 'true')
        } else if (activeTab in sectorMap) {
          params.set('sector', sectorMap[activeTab])
        }
      }
      params.set('page', String(page))
      params.set('limit', '50')

      const res = await fetch(`/api/stocks?${params.toString()}`)
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        if (append) {
          setStocks(prev => [...prev, ...data.data])
        } else {
          setStocks(data.data)
        }
        setTotalStocks(data.total || 0)
        if (data.data.length > 0 && !selectedStock && !append) {
          setSelectedStock(data.data[0])
        }
      } else {
        if (!isBackgroundRefresh && !append) setApiError(true)
      }
    } catch {
      if (!isBackgroundRefresh && !append) setApiError(true)
    } finally {
      if (!isBackgroundRefresh && !append) setLoadingStocks(false)
      setLoadingMore(false)
    }
  }, [token, searchQuery, activeTab, selectedStock])

  // ── Fetch Gainers ────────────────────────────────────────────────────
  const fetchGainers = useCallback(async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setLoadingGainers(true)
    try {
      const res = await fetch('/api/stocks/gainers')
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setGainers(data.data)
      }
    } catch {
      // Silent - will show empty state
    } finally {
      if (!isBackgroundRefresh) setLoadingGainers(false)
    }
  }, [])

  // ── Fetch Losers ─────────────────────────────────────────────────────
  const fetchLosers = useCallback(async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setLoadingLosers(true)
    try {
      const res = await fetch('/api/stocks/losers')
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setLosers(data.data)
      }
    } catch {
      // Silent - will show empty state
    } finally {
      if (!isBackgroundRefresh) setLoadingLosers(false)
    }
  }, [])

  // ── Fetch Positions ──────────────────────────────────────────────────
  const fetchPositions = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/trade/positions', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setPositions(data.data)
      }
    } catch {
      // Silent
    }
  }, [token])

  // ── Fetch Portfolio ──────────────────────────────────────────────────
  const fetchPortfolio = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/trade/portfolio', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && data.data) {
        setPortfolio(data.data)
      }
    } catch {
      // Silent
    }
  }, [token])

  // ── Refresh After Trade ──────────────────────────────────────────────
  const refreshAfterTrade = useCallback(async () => {
    await Promise.all([fetchPositions(), fetchPortfolio()])
  }, [fetchPositions, fetchPortfolio])

  // ── Select Stock Handler ─────────────────────────────────────────────
  const handleSelectStock = (stock: TradeableStock) => {
    setSelectedStock(stock)
    // Always navigate to Stock Overview page first (like Groww)
    // Users can then trade from the overview page
    navigateToStock(stock.symbol)
  }

  // ── Effects ──────────────────────────────────────────────────────────
  // Fetch stocks when tab or search changes
  useEffect(() => {
    setStockPage(1)
    fetchStocks(false, 1, false)
  }, [activeTab])

  // Debounced search - trigger API call after 300ms of inactivity
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setStockPage(1)
      fetchStocks(false, 1, false)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  useEffect(() => {
    fetchGainers()
  }, [fetchGainers])

  useEffect(() => {
    fetchLosers()
  }, [fetchLosers])

  useEffect(() => {
    fetchPositions()
  }, [fetchPositions])

  useEffect(() => {
    fetchPortfolio()
  }, [fetchPortfolio])

  // WebSocket: Merge real-time stock price updates into existing stock data
  // This replaces the 2s polling - WebSocket pushes data every 500ms
  useEffect(() => {
    if (wsStatus !== 'connected' || Object.keys(wsStockQuotes).length === 0) return

    setStocks(prev => prev.map(stock => {
      const wsQuote = wsStockQuotes[stock.symbol]
      if (!wsQuote || wsQuote.last_price <= 0) return stock

      const previousClose = wsQuote.ohlc.close - wsQuote.net_change
      const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : stock.changePercent

      return {
        ...stock,
        currentPrice: wsQuote.last_price,
        change: wsQuote.net_change,
        changePercent,
        volume: wsQuote.volume || stock.volume,
      }
    }))

    // Also update gainers/losers with WS data
    setGainers(prev => prev.map(stock => {
      const wsQuote = wsStockQuotes[stock.symbol]
      if (!wsQuote || wsQuote.last_price <= 0) return stock
      const previousClose = wsQuote.ohlc.close - wsQuote.net_change
      const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : stock.changePercent
      return { ...stock, currentPrice: wsQuote.last_price, change: wsQuote.net_change, changePercent, volume: wsQuote.volume || stock.volume }
    }))

    setLosers(prev => prev.map(stock => {
      const wsQuote = wsStockQuotes[stock.symbol]
      if (!wsQuote || wsQuote.last_price <= 0) return stock
      const previousClose = wsQuote.ohlc.close - wsQuote.net_change
      const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : stock.changePercent
      return { ...stock, currentPrice: wsQuote.last_price, change: wsQuote.net_change, changePercent, volume: wsQuote.volume || stock.volume }
    }))

    // Update selected stock if it's in the WS data
    setSelectedStock(prev => {
      if (!prev) return prev
      const wsQuote = wsStockQuotes[prev.symbol]
      if (!wsQuote || wsQuote.last_price <= 0) return prev
      const previousClose = wsQuote.ohlc.close - wsQuote.net_change
      const changePercent = previousClose > 0 ? (wsQuote.net_change / previousClose) * 100 : prev.changePercent
      return { ...prev, currentPrice: wsQuote.last_price, change: wsQuote.net_change, changePercent, volume: wsQuote.volume || prev.volume }
    })
  }, [wsStockQuotes, wsStatus])

  // ── WS: Update gainers from derived data (zero polling) ──────────────
  useEffect(() => {
    if (derived?.gainers?.length) {
      setGainers(derived.gainers.map(g => ({
        id: g.symbol,
        symbol: g.symbol, name: g.name,
        currentPrice: g.currentPrice, change: g.change,
        changePercent: g.changePercent, volume: g.volume ?? 0,
        sector: '', lotSize: 0, isFnoBan: false,
        isFuturesAvailable: false, isOptionsAvailable: false,
        marketCap: 0, week52High: 0, week52Low: 0,
        peRatio: null,
      })))
    }
  }, [derived?.gainers])

  // ── WS: Update losers from derived data (zero polling) ────────────────
  useEffect(() => {
    if (derived?.losers?.length) {
      setLosers(derived.losers.map(l => ({
        id: l.symbol,
        symbol: l.symbol, name: l.name,
        currentPrice: l.currentPrice, change: l.change,
        changePercent: l.changePercent, volume: l.volume ?? 0,
        sector: '', lotSize: 0, isFnoBan: false,
        isFuturesAvailable: false, isOptionsAvailable: false,
        marketCap: 0, week52High: 0, week52Low: 0,
        peRatio: null,
      })))
    }
  }, [derived?.losers])

  // ── WS: Update positions from WebSocket (zero polling) ────────────────
  useEffect(() => {
    if (wsPositions.length > 0) {
      setPositions(wsPositions.map(p => ({
        id: p.positionId,
        segment: p.segment,
        productType: '',
        tradeDirection: p.tradeDirection,
        symbol: p.symbol,
        quantity: 0,
        entryPrice: 0,
        currentPrice: p.currentPrice,
        totalInvested: 0,
        currentValue: 0,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
        marginUsed: 0,
        isOpen: p.isOpen,
        createdAt: '',
      })))
      // Also update portfolio P&L
      const totalPnl = wsPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
      setPortfolio(prev => prev ? { ...prev, totalUnrealizedPnl: totalPnl } : prev)
    }
  }, [wsPositions])

  // Load watchlist symbols into shared store on mount
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

  // ── Display Stocks ──────────────────────────────────────────────────
  const displayStocks = useMemo(() => {
    // For gainers/losers tabs, use the separate gainers/losers data
    if (activeTab === 'gainers') return gainers
    if (activeTab === 'losers') return losers

    // For all other tabs (all, nifty50, bankNifty, fno, sector tabs),
    // the API already returned the filtered/paginated results in `stocks`
    // Only filter Nifty50 client-side since it's a specific symbol set
    if (activeTab === 'nifty50') {
      return stocks.filter((s) => NIFTY50_SYMBOLS.has(s.symbol))
    }

    return stocks
  }, [stocks, gainers, losers, activeTab])

  // ── Has More Stocks for Pagination ──────────────────────────────────
  const hasMore = useMemo(() => {
    if (activeTab === 'gainers' || activeTab === 'losers') return false
    if (activeTab === 'nifty50') return false
    return stocks.length < totalStocks
  }, [stocks.length, totalStocks, activeTab])

  // ── Loading state for current tab ────────────────────────────────────
  const isCurrentTabLoading = useMemo(() => {
    switch (activeTab) {
      case 'gainers':
        return loadingGainers
      case 'losers':
        return loadingLosers
      default:
        return loadingStocks
    }
  }, [activeTab, loadingStocks, loadingGainers, loadingLosers])

  // ── Market summary stats ─────────────────────────────────────────────
  const marketStats = useMemo(() => {
    const advancing = stocks.filter((s) => s.changePercent > 0).length
    const declining = stocks.filter((s) => s.changePercent < 0).length
    const unchanged = stocks.filter((s) => s.changePercent === 0).length
    return { advancing, declining, unchanged, total: totalStocks }
  }, [stocks, totalStocks])

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      {/* ═══ Header ═════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white border-b border-[#e5e7eb] sticky top-0 z-30"
      >
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-bold text-[#1a1a1a] tracking-tight">
                    Stocks
                  </h1>
                  {wsStatus === 'connected' && (
                    <span className="flex items-center gap-1 text-[9px] font-bold bg-[#00D09C]/10 text-[#00D09C] px-2 py-0.5 rounded-full">
                      <Zap className="size-2.5" />
                      LIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6b7280] mt-0.5">
                  Browse and trade Indian equities
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Search bar */}
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#6b7280]" />
                <Input
                  placeholder="Search stocks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 w-full sm:w-72 bg-[#f5f7fa] border-[#e5e7eb] text-sm text-[#1a1a1a] placeholder:text-[#6b7280] focus:ring-[#00D09C]/20 focus:border-[#00D09C] rounded-xl"
                />
              </div>
              {/* Refresh button */}
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0 rounded-xl border-[#e5e7eb] text-[#6b7280] hover:text-[#00D09C] hover:border-[#00D09C]/30"
                onClick={() => {
                  setStockPage(1)
                  fetchStocks(false, 1, false)
                  fetchGainers()
                  fetchLosers()
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>

          {/* Market stats bar */}
          {!loadingStocks && stocks.length > 0 && (
            <div className="flex items-center gap-4 mt-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1 text-[#00B386]">
                <TrendingUp className="size-3" />
                {marketStats.advancing} Advancing
              </span>
              <span className="flex items-center gap-1 text-[#EB5B3C]">
                <TrendingDown className="size-3" />
                {marketStats.declining} Declining
              </span>
              <span className="text-[#6b7280]">
                {marketStats.unchanged} Unchanged
              </span>
              <span className="text-[#6b7280] ml-auto">
                {marketStats.total} stocks
              </span>
            </div>
          )}
        </div>

        {/* Tab filters */}
        <div className="px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {tabs.map((tab, idx) => (
              <React.Fragment key={tab.id}>
                {idx === 6 && (
                  <span className="shrink-0 w-px h-5 bg-[#e5e7eb] mx-1" />
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                    activeTab === tab.id
                      ? 'bg-[#00D09C] text-white shadow-sm shadow-[#00D09C]/20'
                      : 'bg-[#f5f7fa] text-[#6b7280] hover:bg-[#e5e7eb] hover:text-[#1a1a1a]'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'gainers' && gainers.length > 0 && (
                    <span className={`ml-1 text-[10px] ${activeTab === tab.id ? 'text-white/70' : 'text-[#00B386]'}`}>
                      +{gainers.length}
                    </span>
                  )}
                  {tab.id === 'losers' && losers.length > 0 && (
                    <span className={`ml-1 text-[10px] ${activeTab === tab.id ? 'text-white/70' : 'text-[#EB5B3C]'}`}>
                      {losers.length}
                    </span>
                  )}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        {/* API Error State */}
        {apiError && !loadingStocks && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Card className="bg-white border border-[#eb5b3c]/20 rounded-xl shadow-sm">
              <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                <div className="size-14 rounded-full bg-[#EB5B3C]/10 flex items-center justify-center mb-4">
                  <AlertCircle className="size-7 text-[#EB5B3C]" />
                </div>
                <p className="text-[#1a1a1a] font-bold text-base">Markets data unavailable</p>
                <p className="text-[#6b7280] text-sm mt-1 max-w-md">
                  We couldn&apos;t connect to the market data service. Please check your connection and try again.
                </p>
                <Button
                  size="sm"
                  className="mt-4 gap-1.5 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg"
                  onClick={() => {
                    setStockPage(1)
                    fetchStocks(false, 1, false)
                    fetchGainers()
                    fetchLosers()
                  }}
                >
                  <RefreshCw className="size-3.5" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Stock List - Left 2/3 ────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
              {/* Table header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[#f8f9fb] border-b border-[#e5e7eb]">
                <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
                  Instrument
                </span>
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="hidden md:inline text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
                    Sector
                  </span>
                  <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider text-right min-w-[90px]">
                    LTP
                  </span>
                  <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider min-w-[72px] text-center">
                    Change
                  </span>
                </div>
              </div>

              {/* Stock rows */}
              <AnimatePresence mode="wait">
                {isCurrentTabLoading ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {Array.from({ length: 8 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </motion.div>
                ) : displayStocks.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-16 text-center"
                  >
                    <div className="size-14 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
                      {searchQuery ? (
                        <Search className="size-7 text-[#6b7280]/40" />
                      ) : activeTab === 'gainers' ? (
                        <TrendingUp className="size-7 text-[#6b7280]/40" />
                      ) : activeTab === 'losers' ? (
                        <TrendingDown className="size-7 text-[#6b7280]/40" />
                      ) : (
                        <AlertCircle className="size-7 text-[#6b7280]/40" />
                      )}
                    </div>
                    <p className="text-[#1a1a1a] font-semibold text-sm">
                      {searchQuery
                        ? 'No stocks match your search'
                        : activeTab === 'gainers'
                          ? 'No gainers found'
                          : activeTab === 'losers'
                            ? 'No losers found'
                            : 'No stocks found'}
                    </p>
                    <p className="text-[#6b7280] text-xs mt-1">
                      {searchQuery
                        ? 'Try a different search term'
                        : 'Market data may be temporarily unavailable'}
                    </p>
                  </motion.div>
                ) : (
                  <div className="max-h-[calc(100vh-280px)] overflow-y-auto"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#e5e7eb transparent',
                    }}
                  >
                    <motion.div
                      key={`list-${activeTab}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {displayStocks.map((stock, index) => (
                        <motion.div
                          key={stock.id || stock.symbol}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(index * 0.02, 0.4), duration: 0.3 }}
                        >
                          <StockRow
                            stock={stock}
                            onClick={() => handleSelectStock(stock)}
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                    {/* Load More Button */}
                    {hasMore && (
                      <div className="flex justify-center py-4 border-t border-[#f0f2f5]">
                        <Button
                          variant="ghost"
                          className="gap-1.5 text-[#00D09C] hover:text-[#00b88a] hover:bg-[#00D09C]/5 font-semibold text-sm"
                          disabled={loadingMore}
                          onClick={() => {
                            const nextPage = stockPage + 1
                            setStockPage(nextPage)
                            fetchStocks(false, nextPage, true)
                          }}
                        >
                          {loadingMore ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <ChevronDown className="size-4" />
                              Load More ({totalStocks - stocks.length} remaining)
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </AnimatePresence>
            </Card>
          </div>

          {/* ── Order Panel - Right 1/3 ──────────────────────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-[140px]">
              <OrderPanel
                selectedStock={selectedStock}
                token={token}
                onTradeSuccess={refreshAfterTrade}
                portfolio={portfolio}
                user={user}
              />
            </div>
          </div>
        </div>

        {/* ── Mobile Order Panel Overlay ────────────────────────────────── */}
        <AnimatePresence>
          {showOrderPanel && selectedStock && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 lg:hidden"
              onClick={() => setShowOrderPanel(false)}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto bg-[#f5f7fa] rounded-t-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 bg-white border-b border-[#e5e7eb] px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
                  <span className="font-bold text-[#1a1a1a]">Place Order</span>
                  <button
                    className="size-8 rounded-full flex items-center justify-center hover:bg-[#f5f7fa] text-[#6b7280]"
                    onClick={() => setShowOrderPanel(false)}
                  >
                    ✕
                  </button>
                </div>
                <div className="p-4">
                  <OrderPanel
                    selectedStock={selectedStock}
                    token={token}
                    onTradeSuccess={async () => {
                      await refreshAfterTrade()
                      setShowOrderPanel(false)
                    }}
                    portfolio={portfolio}
                    user={user}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Open Positions Quick View ─────────────────────────────────── */}
        {positions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6"
          >
            <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[#1a1a1a]">Open Positions</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[#00D09C] text-xs font-bold hover:underline px-0"
                    onClick={() => setCurrentPage('positions')}
                  >
                    VIEW ALL
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {positions.slice(0, 3).map((pos) => {
                    const isPositive = pos.unrealizedPnl >= 0
                    return (
                      <div
                        key={pos.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#f5f7fa] border border-[#e5e7eb]"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-sm text-[#1a1a1a]">{pos.symbol}</span>
                          <p className="text-[10px] text-[#6b7280] mt-0.5">
                            {pos.tradeDirection === 'BUY' ? 'Long' : 'Short'} • {pos.quantity} qty
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold font-mono font-tabular ${
                            isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                          }`}>
                            {isPositive ? '+' : ''}{formatINR(pos.unrealizedPnl)}
                          </span>
                          <p className={`text-[10px] font-medium ${
                            isPositive ? 'text-[#00B386]' : 'text-[#EB5B3C]'
                          }`}>
                            {formatPercent(pos.unrealizedPnlPercent)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* ═══ Floating Buy/Sell Bar (Mobile) ══════════════════════════════ */}
      {selectedStock && !showOrderPanel && (
        <div className="fixed bottom-16 left-0 right-0 z-40 lg:hidden px-4 pb-3">
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="flex gap-2"
          >
            <Button
              className="flex-1 h-12 bg-[#00D09C] hover:bg-[#00b88a] text-white font-bold rounded-xl text-sm gap-1.5 shadow-lg"
              onClick={() => setShowOrderPanel(true)}
            >
              <ShoppingCart className="size-4" />
              Buy {selectedStock.symbol}
            </Button>
            <Button
              className="flex-1 h-12 bg-[#EB5B3C] hover:bg-[#d44f33] text-white font-bold rounded-xl text-sm gap-1.5 shadow-lg"
              onClick={() => setShowOrderPanel(true)}
            >
              Sell {selectedStock.symbol}
            </Button>
          </motion.div>
        </div>
      )}
    </div>
  )
}
