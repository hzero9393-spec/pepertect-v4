'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Star,
  X,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  TrendingUp,
  ChevronRight,
  Minus,
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
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <div className="size-8 rounded-lg bg-[#f0f0f5] animate-pulse shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="h-3 w-16 bg-[#f0f0f5] rounded animate-pulse mb-1.5" />
        <div className="h-2.5 w-24 bg-[#f0f0f5] rounded animate-pulse" />
      </div>
      <div className="text-right shrink-0">
        <div className="h-3 w-14 bg-[#f0f0f5] rounded animate-pulse mb-1.5 ml-auto" />
        <div className="h-2.5 w-12 bg-[#f0f0f5] rounded animate-pulse ml-auto" />
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export function WatchlistSidebar() {
  const { token } = useAuthStore()
  const { watchlistSidebarOpen, setWatchlistSidebarOpen, navigateToStock, setCurrentPage } = useAppStore()
  const { addSymbol, removeSymbol } = useWatchlistStore()

  const [items, setItems] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // ── Fetch Watchlist ──────────────────────────────────────────────────
  const fetchWatchlist = useCallback(async (showRefreshing = false) => {
    if (!token) return
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await fetch('/api/trade/watchlist', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setItems(data.data)
      }
    } catch {
      // Silent fail for background refreshes
      if (!showRefreshing) toast.error('Failed to load watchlist')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [token])

  // Fetch when sidebar opens
  useEffect(() => {
    if (watchlistSidebarOpen && token) {
      fetchWatchlist()
    }
  }, [watchlistSidebarOpen, token, fetchWatchlist])

  // Auto-refresh every 30s when sidebar is open (prices update via WS)
  useEffect(() => {
    if (watchlistSidebarOpen && token) {
      intervalRef.current = setInterval(() => {
        fetchWatchlist(false)
      }, 30000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [watchlistSidebarOpen, token, fetchWatchlist])

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

  // ── Navigate to stock ────────────────────────────────────────────────
  const handleStockClick = (symbol: string) => {
    navigateToStock(symbol)
  }

  // ── Stats ────────────────────────────────────────────────────────────
  const stocksOnly = items.filter(i => i.stock !== null)
  const gainersCount = stocksOnly.filter(i => i.stock!.changePercent > 0).length
  const losersCount = stocksOnly.filter(i => i.stock!.changePercent < 0).length

  return (
    <>
      {/* ═══ Sidebar Panel ═════════════════════════════════════════════════ */}
      <AnimatePresence>
        {watchlistSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="fixed right-0 top-14 z-20 hidden md:flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
            style={{
              background: '#ffffff',
              borderLeft: '1px solid #e8ecf0',
              boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8ecf0] shrink-0">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex size-7 items-center justify-center rounded-lg"
                  style={{ background: 'linear-gradient(135deg, #00D09C 0%, #00A67E 100%)' }}
                >
                  <Star className="size-3.5 text-white fill-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#1a1a1a]">Watchlist</h2>
                  {!loading && items.length > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-semibold text-[#6b7280]">{items.length} stocks</span>
                      {gainersCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[#00B386]">
                          <ArrowUpRight className="size-2.5" />
                          {gainersCount}
                        </span>
                      )}
                      {losersCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[#EB5B3C]">
                          <ArrowDownRight className="size-2.5" />
                          {losersCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchWatchlist(true)}
                  disabled={refreshing}
                  className="flex size-7 items-center justify-center rounded-lg text-[#9ca3af] hover:text-[#00D09C] hover:bg-[#00D09C]/5 transition-all"
                  title="Refresh"
                >
                  <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setWatchlistSidebarOpen(false)}
                  className="flex size-7 items-center justify-center rounded-lg text-[#9ca3af] hover:text-[#1a1a1a] hover:bg-[#f4f6f8] transition-all"
                  title="Close"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Stock List */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#e5e7eb transparent' }}>
              <AnimatePresence mode="wait">
                {loading ? (
                  <div key="loading" className="py-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-12 px-4 text-center"
                  >
                    <div className="size-12 rounded-full bg-[#f5f7fa] flex items-center justify-center mb-3">
                      <Star className="size-5 text-[#9ca3af]/50" />
                    </div>
                    <p className="text-sm font-semibold text-[#1a1a1a]">No stocks yet</p>
                    <p className="text-[11px] text-[#6b7280] mt-1 max-w-[180px]">
                      Add stocks to your watchlist by clicking the star icon on any stock page
                    </p>
                    <button
                      onClick={() => setCurrentPage('trading')}
                      className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-[#00D09C] hover:text-[#00b88a] transition-colors"
                    >
                      <TrendingUp className="size-3" />
                      Browse Stocks
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="list" className="py-1">
                    {items.map((item, index) => {
                      const stock = item.stock
                      const isPositive = stock ? stock.changePercent >= 0 : true
                      const isRemoving = removingId === item.id
                      const changeColor = isPositive ? '#00B386' : '#EB5B3C'

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: isRemoving ? 0.3 : 1, x: isRemoving ? -10 : 0 }}
                          exit={{ opacity: 0, x: -30, height: 0 }}
                          transition={{ delay: Math.min(index * 0.02, 0.2), duration: 0.2 }}
                          className="group relative flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f8f9fb] transition-colors border-b border-[#f0f2f5] last:border-b-0"
                        >
                          {/* Stock Info - Clickable */}
                          <button
                            onClick={() => handleStockClick(item.symbol)}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                          >
                            <StockLogo
                              symbol={item.symbol}
                              name={stock?.name || item.symbol}
                              sector={stock?.sector || ''}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-bold text-[#1a1a1a] truncate">{item.symbol}</span>
                                {stock?.isFnoBan && (
                                  <span className="text-[7px] font-bold bg-[#EB5B3C]/10 text-[#EB5B3C] px-1 py-px rounded uppercase tracking-wider">
                                    Ban
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-[#9ca3af] truncate max-w-[140px]">
                                {stock?.name || '—'}
                              </p>
                            </div>
                          </button>

                          {/* Price + Change */}
                          <div className="flex flex-col items-end shrink-0 gap-0.5">
                            {stock ? (
                              <>
                                <span className="text-[12px] font-bold font-mono text-[#1a1a1a]">
                                  {formatINR(stock.currentPrice)}
                                </span>
                                <span
                                  className="text-[10px] font-bold flex items-center gap-0.5"
                                  style={{ color: changeColor }}
                                >
                                  {isPositive ? (
                                    <ArrowUpRight className="size-2.5" />
                                  ) : stock.changePercent === 0 ? (
                                    <Minus className="size-2.5" />
                                  ) : (
                                    <ArrowDownRight className="size-2.5" />
                                  )}
                                  {formatPercent(stock.changePercent)}
                                </span>
                              </>
                            ) : (
                              <span className="text-[10px] text-[#9ca3af]">N/A</span>
                            )}
                          </div>

                          {/* Remove button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemove(item)
                            }}
                            disabled={isRemoving}
                            className="flex size-6 items-center justify-center rounded-md text-[#9ca3af]/0 group-hover:text-[#EB5B3C] hover:bg-[#EB5B3C]/10 transition-all duration-200 shrink-0"
                            title="Remove from watchlist"
                            aria-label={`Remove ${item.symbol} from watchlist`}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer - Go to full watchlist page */}
            {items.length > 0 && (
              <div className="shrink-0 border-t border-[#e8ecf0] px-3 py-2.5">
                <button
                  onClick={() => setCurrentPage('watchlist')}
                  className="flex items-center justify-center gap-1.5 w-full text-[11px] font-semibold text-[#00D09C] hover:text-[#00b88a] transition-colors py-1.5 rounded-lg hover:bg-[#00D09C]/5"
                >
                  View Full Watchlist
                  <ChevronRight className="size-3" />
                </button>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
