'use client'

import { useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Zap, WifiOff } from 'lucide-react'
import { formatPercent, formatPrice } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useIndexData, useDerivedData, type WsIndexQuote } from '@/hooks/use-market-data'

interface IndexData {
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
}

interface MarketStatus {
  status: string
  message: string
}

// Index name mapping
const INDEX_NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50',
  BANKNIFTY: 'Bank Nifty',
  FINNIFTY: 'Fin Nifty',
  SENSEX: 'Sensex',
  MIDCPNIFTY: 'Midcap Nifty',
}

// Fixed display order for indices
const INDEX_ORDER = ['BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTY', 'SENSEX']

export function IndexTicker() {
  const { navigateToIndex } = useAppStore()

  // ALL data via WebSocket — ZERO polling
  const { indices, status: wsStatus } = useIndexData()
  const { derived } = useDerivedData()

  // Transform WS index data to display format
  const displayIndices = useMemo(() => {
    return Object.entries(indices)
      .map(([symbol, quote]: [string, WsIndexQuote]) => {
        const previousClose = quote.ohlc.close - quote.net_change
        const changePercent = previousClose > 0 ? (quote.net_change / previousClose) * 100 : 0
        return {
          symbol,
          name: INDEX_NAMES[symbol] || symbol,
          currentPrice: quote.last_price,
          change: quote.net_change,
          changePercent,
        }
      })
      .sort((a, b) => {
        const idxA = INDEX_ORDER.indexOf(a.symbol)
        const idxB = INDEX_ORDER.indexOf(b.symbol)
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
      })
  }, [indices])

  // Market status from WS derived data (no REST call)
  const marketStatus: MarketStatus | null = derived?.marketStatus
    ? { status: derived.marketStatus.status, message: derived.marketStatus.message }
    : null

  const isOpen = marketStatus?.status === 'OPEN'
  const statusLabel = marketStatus?.status || (wsStatus === 'connected' ? 'LOADING' : 'OFFLINE')

  return (
    <div className="fixed left-0 right-0 top-[56px] z-20 md:left-[220px]">
      <div
        className="border-b"
        style={{
          background: '#fafafa',
          borderColor: '#f0f0f0',
          height: '36px',
        }}
      >
        <div className="flex items-center h-full px-3 gap-0 overflow-x-auto custom-scrollbar">
          {/* Market Status */}
          <div className="flex items-center gap-2 shrink-0 pr-3 border-r mr-2" style={{ borderColor: '#f0f0f0' }}>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: isOpen ? 'rgba(0,208,156,0.08)' : 'rgba(235,91,60,0.08)',
                color: isOpen ? '#00D09C' : '#eb5b3c',
              }}
            >
              <span className="relative flex size-1.5">
                {isOpen && (
                  <span className="absolute inline-flex size-1.5 animate-ping rounded-full opacity-75" style={{ background: '#00D09C' }} />
                )}
                <span
                  className="relative inline-flex size-1.5 rounded-full"
                  style={{ background: isOpen ? '#00D09C' : '#eb5b3c' }}
                />
              </span>
              {statusLabel}
            </span>
            {/* Connection indicator — WS or fallback */}
            {wsStatus === 'connected' ? (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-[#00D09C]">
                <Zap className="size-2.5" />
                LIVE
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-gray-400">
                <WifiOff className="size-2.5" />
                10s
              </span>
            )}
          </div>

          {/* Index Ticker */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {displayIndices.map((idx) => {
              const isPositive = idx.change >= 0
              return (
                <button
                  key={idx.symbol}
                  type="button"
                  className="flex items-center gap-1.5 shrink-0 cursor-pointer hover:bg-white px-2.5 py-1 rounded-md transition-colors"
                  onClick={() => navigateToIndex(idx.symbol)}
                >
                  <span className="text-[11px] font-semibold" style={{ color: '#4a4a4a' }}>
                    {idx.symbol}
                  </span>
                  <span className="text-[12px] font-semibold font-tabular" style={{ color: '#1a1a1a' }}>
                    {formatPrice(idx.currentPrice)}
                  </span>
                  <span
                    className="flex items-center gap-0.5 text-[11px] font-semibold font-tabular"
                    style={{ color: isPositive ? '#00B386' : '#eb5b3c' }}
                  >
                    {isPositive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                    {isPositive ? '+' : ''}{formatPercent(idx.changePercent)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}