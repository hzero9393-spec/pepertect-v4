'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Star,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  RefreshCw,
  Search,
  StarOff,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { useWatchlistStore } from '@/lib/watchlist-store'
import { formatINR, formatPercent } from '@/lib/format'
import { StockLogo } from '@/components/pepertect/ui/stock-logo'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Types ────────────────────────────────────────────────────────────────

interface StockData {
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
  marketCap: number | null
  week52High: number | null
  week52Low: number | null
  peRatio: number | null
}

interface WatchlistItem {
  id: string
  symbol: string
  addedAt: string
  stock: StockData | null
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Skeleton className="size-9 rounded-lg bg-[#f0f0f5]" />
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
        <Skeleton className="h-6 w-6 bg-[#f0f0f5] rounded-full" />
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export function WatchlistPage() {
  const { token } = useAuthStore()
  const { navigateToStock } = useAppStore()
  const { removeSymbol } = useWatchlistStore()

  const [items, setItems] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [clearingAll, setClearingAll] = useState(false)

  // ── Fetch Watchlist ──────────────────────────────────────────────────
  const fetchWatchlist = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch('/api/trade/watchlist', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setItems(data.data)
      }
    } catch {
      toast.error('Failed to load watchlist')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  // ── Remove from Watchlist ────────────────────────────────────────────
  const handleRemove = async (item: WatchlistItem) => {
    setRemovingId(item.id)
    try {
      const res = await fetch('/api/trade/watchlist', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: item.id }),
      })
      const data = await res.json()
      if (data.success) {
        setItems(prev => prev.filter(i => i.id !== item.id))
        removeSymbol(item.symbol)
        toast.success(data.message || `${item.symbol} removed from watchlist`)
      } else {
        toast.error(data.error || 'Failed to remove')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setRemovingId(null)
    }
  }

  // ── Clear All from Watchlist ─────────────────────────────────────────
  const handleClearAll = async () => {
    if (!token || items.length === 0) return
    setClearingAll(true)
    try {
      // Delete all items one by one (parallel)
      const deletePromises = items.map(item =>
        fetch('/api/trade/watchlist', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: item.id }),
        })
      )
      await Promise.allSettled(deletePromises)
      setItems([])
      useWatchlistStore.getState().clear()
      toast.success('Watchlist cleared')
    } catch {
      toast.error('Failed to clear watchlist')
    } finally {
      setClearingAll(false)
    }
  }

  // ── Navigate to stock ────────────────────────────────────────────────
  const handleStockClick = (symbol: string) => {
    navigateToStock(symbol)
  }

  // ── Filter items by search ───────────────────────────────────────────
  const filteredItems = searchQuery.trim()
    ? items.filter(item => {
        const q = searchQuery.toLowerCase()
        return (
          item.symbol.toLowerCase().includes(q) ||
          (item.stock?.name?.toLowerCase().includes(q) ?? false)
        )
      })
    : items

  // ── Stats ────────────────────────────────────────────────────────────
  const stocksOnly = items.filter(i => i.stock !== null)
  const gainersCount = stocksOnly.filter(i => i.stock!.changePercent > 0).length
  const losersCount = stocksOnly.filter(i => i.stock!.changePercent < 0).length

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
              <div className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #00D09C 0%, #00A67E 100%)' }}>
                <Star className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-[#1a1a1a] tracking-tight">
                  Watchlist
                </h1>
                <p className="text-xs text-[#6b7280] mt-0.5">
                  Track your favourite stocks
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Search bar */}
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#6b7280]" />
                <input
                  placeholder="Search watchlist..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 w-full sm:w-72 bg-[#f5f7fa] border border-[#e5e7eb] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C] px-4"
                />
              </div>
              {/* Refresh button */}
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0 rounded-xl border-[#e5e7eb] text-[#6b7280] hover:text-[#00D09C] hover:border-[#00D09C]/30"
                onClick={fetchWatchlist}
              >
                <RefreshCw className="size-4" />
              </Button>
              {/* Clear All button */}
              {items.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 rounded-xl border-[#EB5B3C]/20 text-[#EB5B3C] hover:bg-[#EB5B3C]/5 hover:border-[#EB5B3C]/30 gap-1.5 font-semibold text-xs"
                  onClick={handleClearAll}
                  disabled={clearingAll}
                >
                  <Trash2 className="size-3.5" />
                  {clearingAll ? 'Clearing...' : 'Clear All'}
                </Button>
              )}
            </div>
          </div>

          {/* Stats bar */}
          {!loading && items.length > 0 && (
            <div className="flex items-center gap-4 mt-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1">
                <Star className="size-3 text-[#00D09C]" />
                <span className="text-[#1a1a1a]">{items.length} stocks</span>
              </span>
              {gainersCount > 0 && (
                <span className="flex items-center gap-1 text-[#00B386]">
                  <ArrowUpRight className="size-3" />
                  {gainersCount} Gainers
                </span>
              )}
              {losersCount > 0 && (
                <span className="flex items-center gap-1 text-[#EB5B3C]">
                  <ArrowDownRight className="size-3" />
                  {losersCount} Losers
                </span>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </Card>
            </motion.div>
          ) : filteredItems.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Card className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm">
                <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                  <div className="size-16 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-4">
                    {searchQuery ? (
                      <Search className="size-7 text-[#6b7280]/40" />
                    ) : (
                      <StarOff className="size-7 text-[#6b7280]/40" />
                    )}
                  </div>
                  <p className="text-[#1a1a1a] font-bold text-base">
                    {searchQuery ? 'No matches found' : 'Your watchlist is empty'}
                  </p>
                  <p className="text-[#6b7280] text-sm mt-1.5 max-w-sm">
                    {searchQuery
                      ? 'Try a different search term'
                      : 'Add stocks to your watchlist by clicking the star icon on any stock page'}
                  </p>
                  {!searchQuery && (
                    <Button
                      className="mt-5 gap-2 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-xl"
                      onClick={() => useAppStore.getState().setCurrentPage('trading')}
                    >
                      <TrendingUp className="size-4" />
                      Browse Stocks
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
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
                    <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider w-8" />
                  </div>
                </div>

                {/* Watchlist rows */}
                <div className="max-h-[calc(100vh-320px)] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#e5e7eb transparent' }}>
                  {filteredItems.map((item, index) => {
                    const stock = item.stock
                    const isPositive = stock ? stock.changePercent >= 0 : true
                    const isRemoving = removingId === item.id

                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: isRemoving ? 0.4 : 1, y: 0, x: isRemoving ? -20 : 0 }}
                        exit={{ opacity: 0, x: -50 }}
                        transition={{ delay: Math.min(index * 0.02, 0.3), duration: 0.25 }}
                        className="flex items-center justify-between px-5 py-4 hover:bg-[#f8f9fb] transition-colors border-b border-[#f0f2f5] last:border-b-0 group"
                      >
                        {/* Stock Info */}
                        <button
                          onClick={() => handleStockClick(item.symbol)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        >
                          <StockLogo
                            symbol={item.symbol}
                            name={stock?.name || item.symbol}
                            sector={stock?.sector || ''}
                            size="md"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#1a1a1a] truncate">{item.symbol}</span>
                              {stock?.isFnoBan && (
                                <span className="text-[8px] font-bold bg-[#EB5B3C]/10 text-[#EB5B3C] px-1.5 py-0.5 rounded uppercase tracking-wider">
                                  F&O Ban
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#6b7280] truncate mt-0.5 max-w-[200px]">
                              {stock?.name || 'Stock data unavailable'}
                            </p>
                          </div>
                        </button>

                        {/* Right section */}
                        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                          {/* Sector tag */}
                          {stock?.sector && (
                            <span className="hidden md:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f0f2f5] text-[#6b7280]">
                              {stock.sector}
                            </span>
                          )}

                          {/* LTP */}
                          <div className="text-right min-w-[90px]">
                            {stock ? (
                              <span className="text-base font-bold font-mono font-tabular text-[#1a1a1a]">
                                {formatINR(stock.currentPrice)}
                              </span>
                            ) : (
                              <span className="text-sm text-[#6b7280]">—</span>
                            )}
                          </div>

                          {/* Change pill */}
                          {stock ? (
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
                          ) : (
                            <div className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold min-w-[72px] justify-center bg-gray-100 text-gray-400">
                              N/A
                            </div>
                          )}

                          {/* Remove button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemove(item)
                            }}
                            disabled={isRemoving}
                            className="flex size-8 items-center justify-center rounded-lg text-[#9ca3af] hover:text-[#EB5B3C] hover:bg-[#EB5B3C]/10 transition-all duration-200 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                            title="Remove from watchlist"
                            aria-label={`Remove ${item.symbol} from watchlist`}
                          >
                            <Trash2 className="size-[15px]" />
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
